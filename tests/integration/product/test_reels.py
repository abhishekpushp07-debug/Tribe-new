"""Integration Tests — Reels Core Backend

P0-E: Reel feeds, interactions, visibility.
Note: Reel creation requires media processing pipeline which is not
deterministic. We test feeds and interactions using DB-seeded reels.
"""
import pytest
import requests
import uuid
from datetime import datetime
from tests.conftest import _next_test_ip, _make_headers, auth_header

pytestmark = pytest.mark.integration


@pytest.fixture(scope='module')
def seeded_reel(db, product_user_a):
    """Seed a published reel directly in DB for deterministic testing.
    Creator is product_user_a — other users can interact with it."""
    reel_id = str(uuid.uuid4())
    now = datetime.utcnow()
    db.reels.insert_one({
        'id': reel_id,
        'creatorId': product_user_a['userId'],
        'collegeId': None,
        'caption': 'Seeded reel for 4B testing',
        'videoUrl': 'https://example.com/test-reel.mp4',
        'thumbnailUrl': 'https://example.com/thumb.jpg',
        'duration': 15,
        'status': 'PUBLISHED',
        'visibility': 'PUBLIC',
        'likeCount': 0,
        'commentCount': 0,
        'shareCount': 0,
        'saveCount': 0,
        'viewCount': 0,
        'watchTimeTotal': 0,
        'reportCount': 0,
        'tags': [],
        'audioId': None,
        'seriesId': None,
        'processingStatus': 'COMPLETED',
        'createdAt': now,
        'updatedAt': now,
        'publishedAt': now,
        'archivedAt': None,
        'removedAt': None,
    })
    yield reel_id
    db.reels.delete_one({'id': reel_id})
    db.reel_likes.delete_many({'reelId': reel_id})
    db.reel_saves.delete_many({'reelId': reel_id})
    db.reel_comments.delete_many({'reelId': reel_id})
    db.reel_watch_events.delete_many({'reelId': reel_id})


class TestReelFeeds:
    def test_discovery_feed_requires_auth(self, api_url):
        h = _make_headers()
        resp = requests.get(f'{api_url}/reels/feed', headers=h)
        assert resp.status_code == 401

    def test_discovery_feed_returns_structure(self, api_url, product_user_a):
        h = auth_header(product_user_a['token'], ip=_next_test_ip())
        resp = requests.get(f'{api_url}/reels/feed', headers=h)
        assert resp.status_code == 200
        data = resp.json()
        assert 'items' in data
        assert 'pagination' in data

    def test_following_feed_returns_structure(self, api_url, product_user_a):
        h = auth_header(product_user_a['token'], ip=_next_test_ip())
        resp = requests.get(f'{api_url}/reels/following', headers=h)
        assert resp.status_code == 200
        data = resp.json()
        assert 'items' in data


class TestReelDetail:
    def test_get_reel_detail(self, api_url, product_user_a, seeded_reel):
        h = auth_header(product_user_a['token'], ip=_next_test_ip())
        resp = requests.get(f'{api_url}/reels/{seeded_reel}', headers=h)
        assert resp.status_code == 200
        reel = resp.json()['reel']
        assert reel['id'] == seeded_reel
        assert reel['caption'] == 'Seeded reel for 4B testing'
        assert '_id' not in reel

    def test_get_nonexistent_reel_404(self, api_url, product_user_a):
        h = auth_header(product_user_a['token'], ip=_next_test_ip())
        resp = requests.get(f'{api_url}/reels/fake-reel-id', headers=h)
        assert resp.status_code == 404


class TestReelInteractions:
    """Reel interactions return { message: '...', reelId } shape.
    Note: Cannot like own reel (returns 400 SELF_ACTION)."""

    def test_like_reel(self, api_url, product_user_b, seeded_reel):
        h = auth_header(product_user_b['token'], ip=_next_test_ip())
        resp = requests.post(f'{api_url}/reels/{seeded_reel}/like', headers=h)
        assert resp.status_code == 200
        assert resp.json()['message'] == 'Liked'
        assert resp.json()['reelId'] == seeded_reel

    def test_unlike_reel(self, api_url, product_user_b, seeded_reel):
        h = auth_header(product_user_b['token'], ip=_next_test_ip())
        requests.post(f'{api_url}/reels/{seeded_reel}/like', headers=h)
        resp = requests.delete(f'{api_url}/reels/{seeded_reel}/like',
                               headers=auth_header(product_user_b['token'], ip=_next_test_ip()))
        assert resp.status_code == 200
        assert resp.json()['message'] == 'Unliked'

    def test_save_reel(self, api_url, product_user_b, seeded_reel):
        h = auth_header(product_user_b['token'], ip=_next_test_ip())
        resp = requests.post(f'{api_url}/reels/{seeded_reel}/save', headers=h)
        assert resp.status_code == 200
        assert resp.json()['message'] == 'Saved'

    def test_unsave_reel(self, api_url, product_user_b, seeded_reel):
        h = auth_header(product_user_b['token'], ip=_next_test_ip())
        requests.post(f'{api_url}/reels/{seeded_reel}/save', headers=h)
        resp = requests.delete(f'{api_url}/reels/{seeded_reel}/save',
                               headers=auth_header(product_user_b['token'], ip=_next_test_ip()))
        assert resp.status_code == 200
        assert resp.json()['message'] == 'Unsaved'

    def test_comment_on_reel(self, api_url, product_user_b, seeded_reel):
        h = auth_header(product_user_b['token'], ip=_next_test_ip())
        resp = requests.post(f'{api_url}/reels/{seeded_reel}/comment',
                             json={'text': 'Great reel!'}, headers=h)
        assert resp.status_code == 201

    def test_reel_watch_analytics(self, api_url, product_user_b, seeded_reel):
        """Watch event uses watchTimeMs (milliseconds), not watchTime."""
        h = auth_header(product_user_b['token'], ip=_next_test_ip())
        resp = requests.post(f'{api_url}/reels/{seeded_reel}/watch',
                             json={'watchTimeMs': 10000, 'completed': True}, headers=h)
        assert resp.status_code == 200

    def test_self_like_reel_forbidden(self, api_url, product_user_a, seeded_reel):
        """Creator cannot like own reel."""
        h = auth_header(product_user_a['token'], ip=_next_test_ip())
        resp = requests.post(f'{api_url}/reels/{seeded_reel}/like', headers=h)
        assert resp.status_code == 400

    def test_like_reel_no_auth_blocked(self, api_url, seeded_reel):
        h = _make_headers()
        resp = requests.post(f'{api_url}/reels/{seeded_reel}/like', headers=h)
        assert resp.status_code == 401

    def test_like_nonexistent_reel_404(self, api_url, product_user_b):
        h = auth_header(product_user_b['token'], ip=_next_test_ip())
        resp = requests.post(f'{api_url}/reels/fake-reel-id/like', headers=h)
        assert resp.status_code == 404
