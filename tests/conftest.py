"""
Tribe Stage 4A — Shared Test Fixtures

Provides:
- API URL configuration
- MongoDB direct access for correlation probes
- Test user registration with namespaced phone numbers
- Admin user creation
- Rate limit bypass via unique X-Forwarded-For IPs per test
- Session-scoped cleanup of all test data

Test Isolation Strategy:
- All test phone numbers use prefix 99999 (unlikely to collide with real data)
- Each test gets a unique IP via X-Forwarded-For to avoid rate limit collisions
- Cleanup runs at end of test session
- Tests are idempotent: re-running produces same results
"""
import pytest
import requests
import os
import time
import threading
from pymongo import MongoClient

# Configuration from environment or defaults
API_URL = os.environ.get('TEST_API_URL', 'http://localhost:3000/api')
MONGO_URL = os.environ.get('TEST_MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('TEST_DB_NAME', 'your_database_name')

# Test namespace — all test phone numbers start with this prefix
TEST_PHONE_PREFIX = '99999'
_created_phones = set()
_created_user_ids = set()

# IP counter for unique X-Forwarded-For per fixture/test
# Random offset ensures re-runs don't reuse IPs from previous run's rate limit window
import random as _rng
_ip_counter = _rng.randint(1000, 60000)
_ip_lock = threading.Lock()


def _next_test_ip():
    """Generate a unique X-Forwarded-For IP for rate limit isolation.
    Uses fully random octets to avoid collisions across rapid re-runs."""
    return f'10.{_rng.randint(0,255)}.{_rng.randint(0,255)}.{_rng.randint(0,255)}'


def _next_phone(suffix):
    """Generate a namespaced test phone number."""
    phone = f'{TEST_PHONE_PREFIX}{suffix:05d}'
    _created_phones.add(phone)
    return phone


@pytest.fixture(scope='session')
def api_url():
    """Base API URL for all HTTP tests."""
    return API_URL


@pytest.fixture(scope='session')
def db():
    """Direct MongoDB access for correlation and audit probes."""
    client = MongoClient(MONGO_URL)
    database = client[DB_NAME]
    yield database
    client.close()


def _make_headers(extra=None, ip=None):
    """Build request headers with X-Forwarded-For for rate limit bypass."""
    h = {'Content-Type': 'application/json', 'X-Forwarded-For': ip or _next_test_ip()}
    if extra:
        h.update(extra)
    return h


def _retry_on_429(fn, max_retries=3, base_delay=2.0):
    """Retry a function on 429 (rate limited) with exponential backoff."""
    for attempt in range(max_retries):
        resp = fn()
        if resp.status_code != 429:
            return resp
        time.sleep(base_delay * (2 ** attempt))
    return resp


def _register_or_login(api, phone, pin='1234', display_name='Test User 4A', ip=None):
    """Register a new user or login if already exists. Uses unique IP for rate limiting."""
    test_ip = ip or _next_test_ip()
    headers = _make_headers(ip=test_ip)

    resp = _retry_on_429(lambda: requests.post(f'{api}/auth/register', json={
        'phone': phone, 'pin': pin, 'displayName': display_name
    }, headers=headers))

    if resp.status_code in (200, 201):
        data = resp.json()
        token = data.get('accessToken') or data.get('token')
        user_id = data.get('user', {}).get('id')
        if user_id:
            _created_user_ids.add(user_id)
        return {'phone': phone, 'pin': pin, 'token': token, 'userId': user_id, 'raw': data, 'ip': test_ip}

    # Already exists — login
    resp = _retry_on_429(lambda: requests.post(f'{api}/auth/login', json={'phone': phone, 'pin': pin}, headers=headers))
    if resp.status_code == 200:
        data = resp.json()
        token = data.get('accessToken') or data.get('token')
        user_id = data.get('user', {}).get('id')
        if user_id:
            _created_user_ids.add(user_id)
        return {'phone': phone, 'pin': pin, 'token': token, 'userId': user_id, 'raw': data, 'ip': test_ip}
    raise RuntimeError(f'Failed to register/login test user {phone}: {resp.status_code} {resp.text}')


@pytest.fixture(scope='session')
def test_user(api_url, db):
    """A regular test user with valid token. Set to ADULT for product tests."""
    user = _register_or_login(api_url, _next_phone(1))
    db.users.update_one({'phone': user['phone']}, {'$set': {'ageStatus': 'ADULT'}})
    return user


@pytest.fixture(scope='session')
def test_user_2(api_url, db):
    """A second regular test user (for social/follow tests). Set to ADULT."""
    user = _register_or_login(api_url, _next_phone(2), display_name='Test User 4A-2')
    db.users.update_one({'phone': user['phone']}, {'$set': {'ageStatus': 'ADULT'}})
    return user


@pytest.fixture(scope='session')
def admin_user(api_url, db):
    """An admin test user with valid token."""
    phone = _next_phone(99)
    test_ip = _next_test_ip()
    user_data = _register_or_login(api_url, phone, display_name='Admin Test 4A', ip=test_ip)
    # Promote to ADMIN in DB
    db.users.update_one({'phone': phone}, {'$set': {'role': 'ADMIN'}})
    # Re-login to get a fresh token with admin role
    headers = _make_headers(ip=test_ip)
    resp = _retry_on_429(lambda: requests.post(f'{api_url}/auth/login', json={'phone': phone, 'pin': '1234'}, headers=headers))
    if resp.status_code == 200:
        data = resp.json()
        user_data['token'] = data.get('accessToken') or data.get('token')
    return user_data


# ========== PRODUCT TEST FIXTURES (Stage 4B) ==========
@pytest.fixture(scope='session')
def product_user_a(api_url, db):
    """Dedicated product user A — separate rate-limit budget for content creation tests."""
    user = _register_or_login(api_url, _next_phone(10), display_name='Product User A')
    db.users.update_one({'phone': user['phone']}, {'$set': {'ageStatus': 'ADULT'}})
    return user


@pytest.fixture(scope='session')
def product_user_b(api_url, db):
    """Dedicated product user B — separate rate-limit budget for social/visibility tests."""
    user = _register_or_login(api_url, _next_phone(11), display_name='Product User B')
    db.users.update_one({'phone': user['phone']}, {'$set': {'ageStatus': 'ADULT'}})
    return user


@pytest.fixture(scope='session')
def resource_user(api_url, db):
    """Dedicated user for resource creation — separate WRITE budget."""
    user = _register_or_login(api_url, _next_phone(12), display_name='Resource User')
    db.users.update_one({'phone': user['phone']}, {'$set': {'ageStatus': 'ADULT'}})
    return user


@pytest.fixture(scope='session')
def social_user(api_url, db):
    """Dedicated user for social reaction tests — separate WRITE budget."""
    user = _register_or_login(api_url, _next_phone(13), display_name='Social User')
    db.users.update_one({'phone': user['phone']}, {'$set': {'ageStatus': 'ADULT'}})
    return user


@pytest.fixture
def test_ip():
    """A unique IP for the current test (use in X-Forwarded-For)."""
    return _next_test_ip()


def auth_header(token, ip=None):
    """Helper to create Authorization + X-Forwarded-For headers."""
    return _make_headers(extra={'Authorization': f'Bearer {token}'}, ip=ip)


# ========== SESSION CLEANUP ==========
def pytest_sessionfinish(session, exitstatus):
    """Remove all test-namespaced data after test session completes."""
    try:
        client = MongoClient(MONGO_URL)
        db = client[DB_NAME]
        test_users = list(db.users.find(
            {'phone': {'$regex': f'^{TEST_PHONE_PREFIX}'}},
            {'id': 1, 'phone': 1, '_id': 0}
        ))
        user_ids = [u['id'] for u in test_users]
        phones = [u['phone'] for u in test_users]

        if user_ids:
            # Product data cleanup (Stage 4B)
            del_content = db.content_items.delete_many({'authorId': {'$in': user_ids}})
            del_reactions = db.reactions.delete_many({'userId': {'$in': user_ids}})
            del_saves = db.saves.delete_many({'userId': {'$in': user_ids}})
            del_comments = db.comments.delete_many({'authorId': {'$in': user_ids}})
            del_follows = db.follows.delete_many({
                '$or': [{'followerId': {'$in': user_ids}}, {'followeeId': {'$in': user_ids}}]
            })
            db.blocks.delete_many({
                '$or': [{'blockerId': {'$in': user_ids}}, {'blockedId': {'$in': user_ids}}]
            })
            # Events/Resources/Notices cleanup
            db.events.delete_many({'creatorId': {'$in': user_ids}})
            db.event_rsvps.delete_many({'userId': {'$in': user_ids}})
            db.resources.delete_many({'uploaderId': {'$in': user_ids}})
            db.resource_votes.delete_many({'voterId': {'$in': user_ids}})
            db.board_notices.delete_many({'creatorId': {'$in': user_ids}})
            db.notice_acknowledgments.delete_many({'userId': {'$in': user_ids}})
            # Reels cleanup
            db.reels.delete_many({'creatorId': {'$in': user_ids}})
            db.reel_likes.delete_many({'userId': {'$in': user_ids}})
            db.reel_saves.delete_many({'userId': {'$in': user_ids}})
            db.reel_comments.delete_many({'userId': {'$in': user_ids}})
            db.reel_watches.delete_many({'userId': {'$in': user_ids}})
            # Infra data cleanup (Stage 4A)
            deleted_sessions = db.sessions.delete_many({'userId': {'$in': user_ids}})
            deleted_audits = db.audit_logs.delete_many({'actorId': {'$in': user_ids}})
            db.notifications.delete_many({'userId': {'$in': user_ids}})
            db.user_tribe_memberships.delete_many({'userId': {'$in': user_ids}})
            deleted_users = db.users.delete_many({'phone': {'$in': phones}})
            print(f'\n[CLEANUP] Removed {deleted_users.deleted_count} users, '
                  f'{deleted_sessions.deleted_count} sessions, '
                  f'{deleted_audits.deleted_count} audits, '
                  f'{del_content.deleted_count} posts, '
                  f'{del_reactions.deleted_count} reactions, '
                  f'{del_comments.deleted_count} comments, '
                  f'{del_follows.deleted_count} follows')
        client.close()
    except Exception as e:
        print(f'\n[CLEANUP WARNING] {e}')
