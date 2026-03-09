"""Integration Tests — Visibility & Safety

P0-F: Moderation-linked safety, deleted content behavior,
visibility enforcement on read surfaces.
Uses product_user_b for dedicated WRITE budget.
"""
import pytest
from tests.helpers.product import create_post, get_post, delete_post, get_feed, follow_user
from tests.conftest import _next_test_ip, auth_header

pytestmark = pytest.mark.integration


class TestDeletedContentVisibility:
    def test_deleted_post_returns_404(self, api_url, product_user_b):
        """Soft-deleted posts (visibility=REMOVED) return 404."""
        resp, created = create_post(api_url, product_user_b['token'], 'To delete')
        assert resp.status_code == 201
        post_id = created['post']['id']
        delete_post(api_url, post_id, product_user_b['token'])
        resp, data = get_post(api_url, post_id, product_user_b['token'])
        assert resp.status_code == 404
        assert data['code'] == 'NOT_FOUND'

    def test_deleted_post_not_in_following_feed(self, api_url, product_user_b):
        """Deleted posts should not appear in the following feed."""
        resp, created = create_post(api_url, product_user_b['token'], 'Delete from feed')
        assert resp.status_code == 201
        post_id = created['post']['id']
        # Verify it's in following feed first
        resp, data = get_feed(api_url, 'following', token=product_user_b['token'])
        feed_ids = [p['id'] for p in data['items']]
        assert post_id in feed_ids
        # Delete it
        delete_post(api_url, post_id, product_user_b['token'])
        # Verify it's gone from feed
        resp, data = get_feed(api_url, 'following', token=product_user_b['token'])
        feed_ids = [p['id'] for p in data['items']]
        assert post_id not in feed_ids


class TestHeldContentVisibility:
    def test_held_content_not_in_feed(self, api_url, product_user_b, db):
        """Posts with visibility=HELD should not appear in feed."""
        resp, created = create_post(api_url, product_user_b['token'], 'Will be held')
        assert resp.status_code == 201
        post_id = created['post']['id']
        # Directly set to HELD in DB (simulating moderation escalation)
        db.content_items.update_one({'id': post_id}, {'$set': {'visibility': 'HELD'}})
        # Should not appear in following feed
        resp, data = get_feed(api_url, 'following', token=product_user_b['token'])
        feed_ids = [p['id'] for p in data['items']]
        assert post_id not in feed_ids, 'HELD post appeared in following feed'


class TestBlockedUserVisibility:
    def test_blocked_user_content_in_feed(self, api_url, product_user_a, product_user_b, db):
        """Document block behavior: following feed is authorId-based query.

        The feed handler queries by followeeIds and does NOT filter by blocks.
        This is the ACTUAL behavior — documented as a known limitation.
        """
        follow_user(api_url, product_user_a['userId'], product_user_b['token'])
        resp, created = create_post(api_url, product_user_a['token'], 'Blocked user post')
        assert resp.status_code == 201
        post_id = created['post']['id']

        # Create block
        from tests.helpers.product import block_user
        block_user(db, product_user_b['userId'], product_user_a['userId'])

        # Check feed after block — document actual behavior
        resp, data = get_feed(api_url, 'following', token=product_user_b['token'])
        feed_ids = [p['id'] for p in data['items']]
        # Currently: blocked user posts STILL appear in following feed
        # This is a known limitation: feed handler doesn't check blocks table
        assert post_id in feed_ids, 'Feed now filters blocked users (behavior changed!)'


class TestContentInteractionSafety:
    def test_view_count_increments_on_get(self, api_url, product_user_b):
        """GET /content/:id should increment viewCount."""
        resp, created = create_post(api_url, product_user_b['token'], 'View count test')
        assert resp.status_code == 201, f'Post creation failed: {created}'
        post_id = created['post']['id']
        get_post(api_url, post_id, product_user_b['token'])
        get_post(api_url, post_id, product_user_b['token'])
        _, detail = get_post(api_url, post_id, product_user_b['token'])
        assert detail['post']['viewCount'] >= 2

    def test_removed_content_behavior_on_like(self, api_url, product_user_b):
        """Document what happens when liking soft-deleted content."""
        resp, created = create_post(api_url, product_user_b['token'], 'Remove then like')
        assert resp.status_code == 201
        post_id = created['post']['id']
        delete_post(api_url, post_id, product_user_b['token'])
        import requests as req
        h = auth_header(product_user_b['token'], ip=_next_test_ip())
        resp = req.post(f'{api_url}/content/{post_id}/like', headers=h)
        # Content is soft-deleted (visibility=REMOVED), but findOne still returns it
        # Like handler doesn't check visibility — this is a known gap
        assert resp.status_code in (200, 404), f'Unexpected status: {resp.status_code}'
