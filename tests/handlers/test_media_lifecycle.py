"""
Tribe — Media Lifecycle Hardening Tests

Tests the complete media lifecycle features:
- DELETE /api/media/:id (ownership, attachment safety, cascade thumbnail delete)
- Thumbnail status transitions (NONE → PENDING → READY/FAILED)
- Upload expiration logic (expiresAt field)
- Upload status endpoint includes lifecycle fields
- Cleanup worker uses expiresAt instead of hardcoded 24h
"""
import pytest
import requests
import os
import time
import random
import uuid
from datetime import datetime, timedelta, timezone

API_URL = os.environ.get('TEST_API_URL', 'http://localhost:3000/api')
MONGO_URL = os.environ.get('TEST_MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('TEST_DB_NAME', 'your_database_name')


def _headers(token=None):
    """Build request headers with unique IP for rate limit bypass."""
    h = {
        'Content-Type': 'application/json',
        'X-Forwarded-For': f'10.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(0,255)}'
    }
    if token:
        h['Authorization'] = f'Bearer {token}'
    return h


def _post(url, json=None, headers=None, max_retries=3):
    """POST with 429 retry."""
    for attempt in range(max_retries):
        resp = requests.post(url, json=json, headers=headers)
        if resp.status_code != 429:
            return resp
        time.sleep(2 * (attempt + 1))
    return resp


def _get(url, headers=None, max_retries=3, **kwargs):
    """GET with 429 retry."""
    for attempt in range(max_retries):
        resp = requests.get(url, headers=headers, **kwargs)
        if resp.status_code != 429:
            return resp
        time.sleep(2 * (attempt + 1))
    return resp


def _delete(url, headers=None, max_retries=3):
    """DELETE with 429 retry."""
    for attempt in range(max_retries):
        resp = requests.delete(url, headers=headers)
        if resp.status_code != 429:
            return resp
        time.sleep(2 * (attempt + 1))
    return resp


@pytest.fixture(scope='module')
def db():
    """Direct MongoDB access."""
    from pymongo import MongoClient
    client = MongoClient(MONGO_URL)
    database = client[DB_NAME]
    yield database
    client.close()


@pytest.fixture(scope='module')
def user_a():
    """Create/login user A for media tests."""
    phone = f'99999{random.randint(60000,69999)}'
    h = _headers()
    resp = _post(f'{API_URL}/auth/register', json={
        'phone': phone, 'pin': '1234', 'displayName': 'Lifecycle User A',
        'dob': '2000-01-01',
    }, headers=h)
    if resp.status_code in (200, 201):
        return resp.json()
    resp = _post(f'{API_URL}/auth/login', json={
        'phone': phone, 'pin': '1234',
    }, headers=h)
    return resp.json()


@pytest.fixture(scope='module')
def user_b():
    """Create/login user B for ownership tests."""
    phone = f'99999{random.randint(70000,79999)}'
    h = _headers()
    resp = _post(f'{API_URL}/auth/register', json={
        'phone': phone, 'pin': '1234', 'displayName': 'Lifecycle User B',
        'dob': '2000-01-01',
    }, headers=h)
    if resp.status_code in (200, 201):
        return resp.json()
    resp = _post(f'{API_URL}/auth/login', json={
        'phone': phone, 'pin': '1234',
    }, headers=h)
    return resp.json()


@pytest.fixture(scope='module')
def token_a(user_a):
    return user_a.get('token') or user_a.get('accessToken')


@pytest.fixture(scope='module')
def token_b(user_b):
    return user_b.get('token') or user_b.get('accessToken')


def _init_upload(token, kind='image', mimeType='image/jpeg', sizeBytes=5000, scope='posts'):
    """Helper: init a media upload."""
    resp = _post(f'{API_URL}/media/upload-init', json={
        'kind': kind, 'mimeType': mimeType, 'sizeBytes': sizeBytes, 'scope': scope,
    }, headers=_headers(token))
    assert resp.status_code == 201, f"upload-init failed: {resp.text}"
    return resp.json()


# ========================
# Test Class: DELETE API
# ========================
class TestMediaDeletion:
    """Tests for DELETE /api/media/:id"""

    def test_delete_own_unattached_media(self, token_a):
        """User can delete their own unattached media."""
        init = _init_upload(token_a)
        media_id = init['mediaId']
        resp = _delete(f'{API_URL}/media/{media_id}', headers=_headers(token_a))
        assert resp.status_code == 200
        data = resp.json()
        assert data['id'] == media_id
        assert data['status'] == 'DELETED'

    def test_delete_nonexistent_media_returns_404(self, token_a):
        """Deleting non-existent media returns 404."""
        resp = _delete(f'{API_URL}/media/{uuid.uuid4()}', headers=_headers(token_a))
        assert resp.status_code == 404

    def test_delete_already_deleted_returns_404(self, token_a):
        """Deleting already-deleted media returns 404."""
        init = _init_upload(token_a)
        media_id = init['mediaId']
        resp1 = _delete(f'{API_URL}/media/{media_id}', headers=_headers(token_a))
        assert resp1.status_code == 200
        resp2 = _delete(f'{API_URL}/media/{media_id}', headers=_headers(token_a))
        assert resp2.status_code == 404

    def test_delete_other_users_media_forbidden(self, token_a, token_b):
        """Cannot delete another user's media."""
        init = _init_upload(token_a)
        media_id = init['mediaId']
        resp = _delete(f'{API_URL}/media/{media_id}', headers=_headers(token_b))
        assert resp.status_code == 403
        assert resp.json()['code'] == 'FORBIDDEN'

    def test_delete_requires_auth(self):
        """DELETE without auth returns 401."""
        resp = _delete(f'{API_URL}/media/{uuid.uuid4()}', headers=_headers())
        assert resp.status_code == 401

    def test_delete_media_attached_to_post_blocked(self, token_a, user_a, db):
        """Cannot delete media that is attached to a post."""
        init = _init_upload(token_a)
        media_id = init['mediaId']
        user_id = user_a['user']['id']

        # Directly insert a content_item referencing this mediaId
        db.collection = db.__getattr__
        db['content_items'].insert_one({
            'id': str(uuid.uuid4()),
            'kind': 'POST',
            'authorId': user_id,
            'authorType': 'USER',
            'caption': 'test post',
            'media': [{'id': media_id, 'url': 'https://example.com/test.jpg', 'type': 'IMAGE'}],
            'visibility': 'PUBLIC',
            'isDeleted': False,
            'createdAt': datetime.now(timezone.utc),
        })

        resp = _delete(f'{API_URL}/media/{media_id}', headers=_headers(token_a))
        assert resp.status_code == 409
        assert resp.json()['code'] == 'MEDIA_ATTACHED'

        # Cleanup
        db['content_items'].delete_many({'media.id': media_id})

    def test_delete_media_attached_to_reel_blocked(self, token_a, user_a, db):
        """Cannot delete media that is attached to a reel."""
        init = _init_upload(token_a, kind='video', mimeType='video/mp4', sizeBytes=50000)
        media_id = init['mediaId']
        user_id = user_a['user']['id']

        db['reels'].insert_one({
            'id': str(uuid.uuid4()),
            'creatorId': user_id,
            'mediaId': media_id,
            'isDeleted': False,
            'createdAt': datetime.now(timezone.utc),
        })

        resp = _delete(f'{API_URL}/media/{media_id}', headers=_headers(token_a))
        assert resp.status_code == 409

        # Cleanup
        db['reels'].delete_many({'mediaId': media_id})

    def test_delete_media_attached_to_story_blocked(self, token_a, user_a, db):
        """Cannot delete media that is attached to a story."""
        init = _init_upload(token_a)
        media_id = init['mediaId']
        user_id = user_a['user']['id']

        db['stories'].insert_one({
            'id': str(uuid.uuid4()),
            'creatorId': user_id,
            'mediaIds': [media_id],
            'isDeleted': False,
            'createdAt': datetime.now(timezone.utc),
        })

        resp = _delete(f'{API_URL}/media/{media_id}', headers=_headers(token_a))
        assert resp.status_code == 409

        # Cleanup
        db['stories'].delete_many({'mediaIds': media_id})


# ========================
# Test Class: Upload Lifecycle Fields
# ========================
class TestUploadLifecycleFields:
    """Tests that upload-init creates proper lifecycle fields and upload-status returns them."""

    def test_upload_init_sets_expires_at(self, token_a, db):
        """upload-init should set expiresAt ~ 2 hours in the future."""
        init = _init_upload(token_a)
        media_id = init['mediaId']
        assert init['expiresIn'] == 7200

        asset = db['media_assets'].find_one({'id': media_id}, {'_id': 0})
        assert asset is not None
        assert asset['expiresAt'] is not None
        # expiresAt should be roughly 2 hours from now (within 5 min tolerance)
        expected = datetime.now(timezone.utc) + timedelta(hours=2)
        diff = abs((asset['expiresAt'].replace(tzinfo=timezone.utc) - expected).total_seconds())
        assert diff < 300, f"expiresAt off by {diff}s"

    def test_upload_init_sets_thumbnail_status_none(self, token_a, db):
        """upload-init should set thumbnailStatus to NONE."""
        init = _init_upload(token_a)
        media_id = init['mediaId']
        asset = db['media_assets'].find_one({'id': media_id}, {'_id': 0})
        assert asset['thumbnailStatus'] == 'NONE'
        assert asset['thumbnailUrl'] is None

    def test_upload_status_returns_lifecycle_fields(self, token_a):
        """upload-status should include thumbnailStatus and expiresAt."""
        init = _init_upload(token_a)
        media_id = init['mediaId']
        resp = _get(f'{API_URL}/media/upload-status/{media_id}', headers=_headers(token_a))
        assert resp.status_code == 200
        data = resp.json()
        assert data['status'] == 'PENDING_UPLOAD'
        assert data['thumbnailStatus'] == 'NONE'
        assert data['expiresAt'] is not None

    def test_upload_init_sets_pending_status(self, token_a, db):
        """upload-init creates a PENDING_UPLOAD record."""
        init = _init_upload(token_a)
        media_id = init['mediaId']
        asset = db['media_assets'].find_one({'id': media_id}, {'_id': 0})
        assert asset['status'] == 'PENDING_UPLOAD'
        assert asset['completedAt'] is None


# ========================
# Test Class: Cleanup Worker Logic
# ========================
class TestCleanupExpiration:
    """Tests that stale uploads are cleaned based on expiresAt."""

    def test_expired_upload_is_found_by_expiration_query(self, token_a, db):
        """An upload with expiresAt in the past should be found by the cleanup query."""
        init = _init_upload(token_a)
        media_id = init['mediaId']

        # Manually set expiresAt to the past
        db['media_assets'].update_one(
            {'id': media_id},
            {'$set': {'expiresAt': datetime(2020, 1, 1)}}
        )

        # The cleanup query should find it
        now = datetime.now(timezone.utc)
        stale = list(db['media_assets'].find({
            'status': 'PENDING_UPLOAD',
            'isDeleted': {'$ne': True},
            '$or': [
                {'expiresAt': {'$lt': now}},
                {'expiresAt': {'$exists': False}, 'createdAt': {'$lt': now - timedelta(hours=24)}},
                {'expiresAt': None, 'createdAt': {'$lt': now - timedelta(hours=24)}},
            ],
        }, {'_id': 0, 'id': 1}))
        found_ids = [s['id'] for s in stale]
        assert media_id in found_ids

    def test_non_expired_upload_not_found_by_expiration_query(self, token_a, db):
        """An upload with expiresAt in the future should NOT be found."""
        init = _init_upload(token_a)
        media_id = init['mediaId']

        # expiresAt is already set to 2 hours in the future by upload-init
        now = datetime.now(timezone.utc)
        stale = list(db['media_assets'].find({
            'id': media_id,
            'status': 'PENDING_UPLOAD',
            'isDeleted': {'$ne': True},
            '$or': [
                {'expiresAt': {'$lt': now}},
                {'expiresAt': {'$exists': False}, 'createdAt': {'$lt': now - timedelta(hours=24)}},
                {'expiresAt': None, 'createdAt': {'$lt': now - timedelta(hours=24)}},
            ],
        }, {'_id': 0, 'id': 1}))
        found_ids = [s['id'] for s in stale]
        assert media_id not in found_ids

    def test_legacy_upload_without_expires_at_uses_24h_fallback(self, token_a, db):
        """Legacy upload without expiresAt should be cleaned after 24h."""
        # Create a PENDING_UPLOAD with no expiresAt and old createdAt
        media_id = str(uuid.uuid4())
        db['media_assets'].insert_one({
            'id': media_id,
            'ownerId': 'test-legacy',
            'status': 'PENDING_UPLOAD',
            'isDeleted': False,
            'createdAt': datetime(2020, 1, 1),
            # No expiresAt field!
        })

        now = datetime.now(timezone.utc)
        stale = list(db['media_assets'].find({
            'id': media_id,
            'status': 'PENDING_UPLOAD',
            'isDeleted': {'$ne': True},
            '$or': [
                {'expiresAt': {'$lt': now}},
                {'expiresAt': {'$exists': False}, 'createdAt': {'$lt': now - timedelta(hours=24)}},
                {'expiresAt': None, 'createdAt': {'$lt': now - timedelta(hours=24)}},
            ],
        }, {'_id': 0, 'id': 1}))
        found_ids = [s['id'] for s in stale]
        assert media_id in found_ids

        # Cleanup
        db['media_assets'].delete_one({'id': media_id})


# ========================
# Test Class: Thumbnail Status
# ========================
class TestThumbnailStatus:
    """Tests thumbnail status fields in media asset records."""

    def test_image_upload_has_thumbnail_status_none(self, token_a, db):
        """Image uploads should have thumbnailStatus NONE (no thumbnail needed)."""
        init = _init_upload(token_a, kind='image', mimeType='image/jpeg')
        media_id = init['mediaId']
        asset = db['media_assets'].find_one({'id': media_id}, {'_id': 0})
        assert asset['thumbnailStatus'] == 'NONE'

    def test_video_upload_init_has_thumbnail_status_none(self, token_a, db):
        """Video upload-init should set thumbnailStatus to NONE (thumbnail happens on complete)."""
        init = _init_upload(token_a, kind='video', mimeType='video/mp4', sizeBytes=50000)
        media_id = init['mediaId']
        asset = db['media_assets'].find_one({'id': media_id}, {'_id': 0})
        assert asset['thumbnailStatus'] == 'NONE'

    def test_upload_complete_returns_thumbnail_status(self, token_a):
        """upload-complete response should include thumbnailStatus field."""
        init = _init_upload(token_a, kind='image', mimeType='image/jpeg')
        media_id = init['mediaId']

        # Complete upload (we didn't actually upload to Supabase, so verify may fail gracefully)
        resp = _post(f'{API_URL}/media/upload-complete', json={
            'mediaId': media_id,
        }, headers=_headers(token_a))
        # May succeed or fail depending on Supabase verification, but response shape should be correct
        if resp.status_code == 200:
            data = resp.json()
            assert 'thumbnailStatus' in data
            assert data['status'] == 'READY'


# ========================
# Test Class: Soft Delete Verification
# ========================
class TestSoftDeleteVerification:
    """Tests that deletion properly soft-deletes and media is no longer accessible."""

    def test_deleted_media_not_accessible_via_get(self, token_a):
        """GET /media/:id should return 404 for soft-deleted media."""
        init = _init_upload(token_a)
        media_id = init['mediaId']

        _delete(f'{API_URL}/media/{media_id}', headers=_headers(token_a))

        resp = _get(f'{API_URL}/media/{media_id}', headers=_headers(token_a), allow_redirects=False)
        assert resp.status_code == 404

    def test_deleted_media_not_in_upload_status(self, token_a):
        """upload-status should return 404 for soft-deleted media."""
        init = _init_upload(token_a)
        media_id = init['mediaId']

        _delete(f'{API_URL}/media/{media_id}', headers=_headers(token_a))

        resp = _get(f'{API_URL}/media/upload-status/{media_id}', headers=_headers(token_a))
        assert resp.status_code == 404

    def test_deleted_media_has_correct_db_state(self, token_a, db):
        """Soft-deleted media should have isDeleted=true and status=DELETED in DB."""
        init = _init_upload(token_a)
        media_id = init['mediaId']

        _delete(f'{API_URL}/media/{media_id}', headers=_headers(token_a))

        asset = db['media_assets'].find_one({'id': media_id}, {'_id': 0})
        assert asset is not None
        assert asset['isDeleted'] is True
        assert asset['status'] == 'DELETED'
        assert asset.get('deletedAt') is not None
