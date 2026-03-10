"""Product test helpers — shared utilities for Stage 4B/4C tests.

Provides factory functions for creating posts, comments, follows, blocks,
events, resources, notices, and reels using canonical conftest fixtures.
"""
import requests
import uuid
from datetime import datetime, timezone, timedelta
from tests.conftest import _next_test_ip, _make_headers, auth_header


def create_post(api_url, token, caption='Test post from Stage 4B', ip=None):
    """Create a text post. Returns (response, data)."""
    h = auth_header(token, ip=ip or _next_test_ip())
    resp = requests.post(f'{api_url}/content/posts', json={
        'caption': caption,
    }, headers=h)
    return resp, resp.json() if resp.status_code in (200, 201) else resp.json()


def get_post(api_url, post_id, token=None, ip=None):
    """Get a post by ID. Returns (response, data)."""
    h = auth_header(token, ip=ip or _next_test_ip()) if token else _make_headers(ip=ip or _next_test_ip())
    resp = requests.get(f'{api_url}/content/{post_id}', headers=h)
    return resp, resp.json()


def delete_post(api_url, post_id, token, ip=None):
    """Delete a post. Returns response."""
    h = auth_header(token, ip=ip or _next_test_ip())
    return requests.delete(f'{api_url}/content/{post_id}', headers=h)


def get_feed(api_url, feed_type='public', token=None, ip=None, params=None):
    """Get feed. feed_type: 'public', 'following'. Returns (response, data)."""
    h = auth_header(token, ip=ip or _next_test_ip()) if token else _make_headers(ip=ip or _next_test_ip())
    resp = requests.get(f'{api_url}/feed/{feed_type}', headers=h, params=params)
    return resp, resp.json()


def get_college_feed(api_url, college_id, token=None, ip=None, params=None):
    """Get college feed. Returns (response, data)."""
    h = auth_header(token, ip=ip or _next_test_ip()) if token else _make_headers(ip=ip or _next_test_ip())
    resp = requests.get(f'{api_url}/feed/college/{college_id}', headers=h, params=params)
    return resp, resp.json()


def get_house_feed(api_url, house_id, token=None, ip=None, params=None):
    """Get house feed. Returns (response, data)."""
    h = auth_header(token, ip=ip or _next_test_ip()) if token else _make_headers(ip=ip or _next_test_ip())
    resp = requests.get(f'{api_url}/feed/house/{house_id}', headers=h, params=params)
    return resp, resp.json()


def follow_user(api_url, target_id, token, ip=None):
    """Follow a user. Returns response."""
    h = auth_header(token, ip=ip or _next_test_ip())
    return requests.post(f'{api_url}/follow/{target_id}', headers=h)


def unfollow_user(api_url, target_id, token, ip=None):
    """Unfollow a user. Returns response."""
    h = auth_header(token, ip=ip or _next_test_ip())
    return requests.delete(f'{api_url}/follow/{target_id}', headers=h)


def like_post(api_url, post_id, token, ip=None):
    """Like a post. Returns (response, data)."""
    h = auth_header(token, ip=ip or _next_test_ip())
    resp = requests.post(f'{api_url}/content/{post_id}/like', headers=h)
    return resp, resp.json()


def dislike_post(api_url, post_id, token, ip=None):
    """Dislike a post. Returns (response, data)."""
    h = auth_header(token, ip=ip or _next_test_ip())
    resp = requests.post(f'{api_url}/content/{post_id}/dislike', headers=h)
    return resp, resp.json()


def remove_reaction(api_url, post_id, token, ip=None):
    """Remove reaction from a post. Returns (response, data)."""
    h = auth_header(token, ip=ip or _next_test_ip())
    resp = requests.delete(f'{api_url}/content/{post_id}/reaction', headers=h)
    return resp, resp.json()


def save_post(api_url, post_id, token, ip=None):
    """Save a post. Returns (response, data)."""
    h = auth_header(token, ip=ip or _next_test_ip())
    resp = requests.post(f'{api_url}/content/{post_id}/save', headers=h)
    return resp, resp.json()


def unsave_post(api_url, post_id, token, ip=None):
    """Unsave a post. Returns (response, data)."""
    h = auth_header(token, ip=ip or _next_test_ip())
    resp = requests.delete(f'{api_url}/content/{post_id}/save', headers=h)
    return resp, resp.json()


def create_comment(api_url, post_id, token, text='Test comment', ip=None):
    """Create a comment on a post. Returns (response, data)."""
    h = auth_header(token, ip=ip or _next_test_ip())
    resp = requests.post(f'{api_url}/content/{post_id}/comments', json={
        'body': text,
    }, headers=h)
    return resp, resp.json()


def get_comments(api_url, post_id, token=None, ip=None):
    """Get comments for a post. Returns (response, data)."""
    h = auth_header(token, ip=ip or _next_test_ip()) if token else _make_headers(ip=ip or _next_test_ip())
    resp = requests.get(f'{api_url}/content/{post_id}/comments', headers=h)
    return resp, resp.json()


def block_user(db, blocker_id, blocked_id):
    """Create a block directly in DB (admin-level operation)."""
    db.blocks.insert_one({
        'id': str(uuid.uuid4()),
        'blockerId': blocker_id,
        'blockedId': blocked_id,
        'createdAt': datetime.now(timezone.utc),
    })


# ── Event helpers ──

def create_event(api_url, token, title='Test Event 4C', ip=None, **kwargs):
    """Create an event. Returns (response, data)."""
    h = auth_header(token, ip=ip or _next_test_ip())
    start = (datetime.utcnow() + timedelta(days=7)).isoformat() + 'Z'
    body = {'title': title, 'startAt': start, 'category': 'SOCIAL'}
    body.update(kwargs)
    resp = requests.post(f'{api_url}/events', json=body, headers=h)
    return resp, resp.json()


def get_event(api_url, event_id, token=None, ip=None):
    """Get event detail. Returns (response, data)."""
    h = auth_header(token, ip=ip or _next_test_ip()) if token else _make_headers(ip=ip or _next_test_ip())
    resp = requests.get(f'{api_url}/events/{event_id}', headers=h)
    return resp, resp.json()


def rsvp_event(api_url, event_id, token, status='GOING', ip=None):
    """RSVP to an event. Returns (response, data)."""
    h = auth_header(token, ip=ip or _next_test_ip())
    resp = requests.post(f'{api_url}/events/{event_id}/rsvp', json={'status': status}, headers=h)
    return resp, resp.json()


def cancel_rsvp(api_url, event_id, token, ip=None):
    """Cancel RSVP. Returns response."""
    h = auth_header(token, ip=ip or _next_test_ip())
    return requests.delete(f'{api_url}/events/{event_id}/rsvp', headers=h)


# ── Resource helpers ──

def create_resource(api_url, token, title='Test Resource 4C', college_id=None, ip=None, **kwargs):
    """Create a resource. Returns (response, data)."""
    h = auth_header(token, ip=ip or _next_test_ip())
    body = {'title': title, 'kind': 'PYQ', 'subject': 'Mathematics',
            'semester': 1, 'year': 2025}
    if college_id:
        body['collegeId'] = college_id
    body.update(kwargs)
    resp = requests.post(f'{api_url}/resources', json=body, headers=h)
    return resp, resp.json()


def get_resource(api_url, resource_id, token=None, ip=None):
    """Get resource detail. Returns (response, data)."""
    h = auth_header(token, ip=ip or _next_test_ip()) if token else _make_headers(ip=ip or _next_test_ip())
    resp = requests.get(f'{api_url}/resources/{resource_id}', headers=h)
    return resp, resp.json()


def vote_resource(api_url, resource_id, token, vote_type='UP', ip=None):
    """Vote on a resource. Returns (response, data)."""
    h = auth_header(token, ip=ip or _next_test_ip())
    resp = requests.post(f'{api_url}/resources/{resource_id}/vote',
                         json={'vote': vote_type}, headers=h)
    return resp, resp.json()


def search_resources(api_url, ip=None, params=None):
    """Search resources. Returns (response, data)."""
    h = _make_headers(ip=ip or _next_test_ip())
    resp = requests.get(f'{api_url}/resources/search', headers=h, params=params)
    return resp, resp.json()


# ── Notice helpers ──

def create_notice(api_url, token, title='Test Notice 4C', body='Notice body', ip=None, **kwargs):
    """Create a board notice. Returns (response, data)."""
    h = auth_header(token, ip=ip or _next_test_ip())
    payload = {'title': title, 'body': body, 'category': 'GENERAL'}
    payload.update(kwargs)
    resp = requests.post(f'{api_url}/board/notices', json=payload, headers=h)
    return resp, resp.json()


def get_notice(api_url, notice_id, token=None, ip=None):
    """Get notice detail. Returns (response, data)."""
    h = auth_header(token, ip=ip or _next_test_ip()) if token else _make_headers(ip=ip or _next_test_ip())
    resp = requests.get(f'{api_url}/board/notices/{notice_id}', headers=h)
    return resp, resp.json()


def acknowledge_notice(api_url, notice_id, token, ip=None):
    """Acknowledge a notice. Returns (response, data)."""
    h = auth_header(token, ip=ip or _next_test_ip())
    resp = requests.post(f'{api_url}/board/notices/{notice_id}/acknowledge', headers=h)
    return resp, resp.json()


def get_college_notices(api_url, college_id, ip=None):
    """Get college notice listing. Returns (response, data)."""
    h = _make_headers(ip=ip or _next_test_ip())
    resp = requests.get(f'{api_url}/colleges/{college_id}/notices', headers=h)
    return resp, resp.json()


# ── Reel helpers ──

def seed_reel(db, creator_id, status='PUBLISHED', college_id=None):
    """Seed a reel directly in DB (media pipeline bypass). Returns reel_id."""
    reel_id = str(uuid.uuid4())
    db.reels.insert_one({
        'id': reel_id,
        'creatorId': creator_id,
        'collegeId': college_id,  # None = public, accessible by all
        'caption': 'Seeded reel for consistency tests',
        'status': status,
        'visibility': 'PUBLIC',
        'mediaStatus': 'READY',  # Required for non-creator access
        'videoUrl': 'https://example.com/test.mp4',
        'thumbnailUrl': 'https://example.com/thumb.jpg',
        'duration': 15,
        'likeCount': 0, 'commentCount': 0, 'saveCount': 0,
        'shareCount': 0, 'watchCount': 0,
        'createdAt': datetime.now(timezone.utc),
        'updatedAt': datetime.now(timezone.utc),
    })
    return reel_id


def get_reel(api_url, reel_id, token=None, ip=None):
    """Get reel detail. Returns (response, data)."""
    h = auth_header(token, ip=ip or _next_test_ip()) if token else _make_headers(ip=ip or _next_test_ip())
    resp = requests.get(f'{api_url}/reels/{reel_id}', headers=h)
    return resp, resp.json()


def like_reel(api_url, reel_id, token, ip=None):
    """Like a reel. Returns (response, data)."""
    h = auth_header(token, ip=ip or _next_test_ip())
    resp = requests.post(f'{api_url}/reels/{reel_id}/like', headers=h)
    return resp, resp.json()


def unlike_reel(api_url, reel_id, token, ip=None):
    """Unlike a reel. Returns (response, data)."""
    h = auth_header(token, ip=ip or _next_test_ip())
    resp = requests.delete(f'{api_url}/reels/{reel_id}/like', headers=h)
    return resp, resp.json()
