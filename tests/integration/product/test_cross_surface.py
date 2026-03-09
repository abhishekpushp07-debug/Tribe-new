"""Integration Tests — Cross-Surface Consistency

P0-F: Verify that actions are reflected consistently across
detail, feed, and list surfaces. World-best backend standard.
"""
import pytest
from tests.helpers.product import (
    create_post, get_post, get_feed, like_post, delete_post,
    create_comment, follow_user
)
from tests.conftest import _next_test_ip, auth_header

pytestmark = pytest.mark.integration


class TestLikeConsistency:
    def test_like_reflected_in_detail_and_feed(self, api_url, test_user, test_user_2):
        """Like count on detail and feed item should match."""
        _, created = create_post(api_url, test_user['token'], 'Consistency like')
        post_id = created['post']['id']
        like_post(api_url, post_id, test_user_2['token'])

        # Check detail
        _, detail = get_post(api_url, post_id, test_user['token'])
        detail_count = detail['post']['likeCount']
        assert detail_count >= 1

        # Check feed
        _, feed_data = get_feed(api_url, 'following', token=test_user['token'])
        feed_item = next((p for p in feed_data['items'] if p['id'] == post_id), None)
        assert feed_item is not None, 'Post not found in feed'
        assert feed_item['likeCount'] == detail_count, \
            f'Feed likeCount ({feed_item["likeCount"]}) != detail likeCount ({detail_count})'


class TestCommentConsistency:
    def test_comment_count_in_detail_and_feed(self, api_url, test_user):
        """Comment count on detail and feed should be consistent."""
        _, created = create_post(api_url, test_user['token'], 'Consistency comment')
        post_id = created['post']['id']
        create_comment(api_url, post_id, test_user['token'], 'Comment 1')
        create_comment(api_url, post_id, test_user['token'], 'Comment 2')

        # Detail
        _, detail = get_post(api_url, post_id, test_user['token'])
        detail_count = detail['post']['commentCount']
        assert detail_count >= 2

        # Feed
        _, feed_data = get_feed(api_url, 'following', token=test_user['token'])
        feed_item = next((p for p in feed_data['items'] if p['id'] == post_id), None)
        assert feed_item is not None
        assert feed_item['commentCount'] == detail_count


class TestDeleteConsistency:
    def test_deleted_post_gone_everywhere(self, api_url, test_user):
        """Deleted post should return 404 on detail AND be gone from feed."""
        _, created = create_post(api_url, test_user['token'], 'Consistency delete')
        post_id = created['post']['id']
        delete_post(api_url, post_id, test_user['token'])

        # Detail
        resp, _ = get_post(api_url, post_id, test_user['token'])
        assert resp.status_code == 404

        # Feed
        _, feed_data = get_feed(api_url, 'following', token=test_user['token'])
        feed_ids = [p['id'] for p in feed_data['items']]
        assert post_id not in feed_ids


class TestContractStability:
    def test_feed_item_matches_detail_contract(self, api_url, test_user):
        """Same post should have same core fields in detail and feed."""
        _, created = create_post(api_url, test_user['token'], 'Contract stability')
        post_id = created['post']['id']

        _, detail = get_post(api_url, post_id, test_user['token'])
        _, feed_data = get_feed(api_url, 'following', token=test_user['token'])
        feed_item = next((p for p in feed_data['items'] if p['id'] == post_id), None)
        assert feed_item is not None

        # Core fields must be consistent
        for field in ['id', 'kind', 'authorId', 'caption', 'visibility']:
            assert detail['post'][field] == feed_item[field], \
                f'{field}: detail={detail["post"][field]} != feed={feed_item[field]}'
