"""Product test helpers — shared utilities for Stage 4B tests.

Provides factory functions for creating posts, comments, follows, blocks
using canonical conftest fixtures.
"""
import requests
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
    import uuid
    from datetime import datetime
    db.blocks.insert_one({
        'id': str(uuid.uuid4()),
        'blockerId': blocker_id,
        'blockedId': blocked_id,
        'createdAt': datetime.utcnow(),
    })
