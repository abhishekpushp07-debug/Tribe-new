"""Integration Tests — Feed Behavior

P0-B: Feed retrieval, visibility rules, pagination contract.
Uses product_user_b for dedicated rate-limit budget.

IMPORTANT: New posts have distributionStage=0.
- Public feed requires distributionStage=2 (won't show new posts)
- Following feed has NO distributionStage filter (will show new posts)
- College/house feed requires distributionStage>=1
"""
import pytest
import requests
from tests.helpers.product import create_post, get_feed, follow_user
from tests.conftest import _next_test_ip, _make_headers, auth_header

pytestmark = pytest.mark.integration


class TestPublicFeed:
    def test_public_feed_returns_items(self, api_url):
        """Public feed returns structured response even if empty."""
        resp, data = get_feed(api_url, 'public')
        assert resp.status_code == 200
        assert 'items' in data
        assert 'pagination' in data
        assert 'hasMore' in data['pagination']
        assert data['feedType'] == 'public'

    def test_public_feed_pagination_contract(self, api_url):
        resp, data = get_feed(api_url, 'public', params={'limit': 2})
        assert resp.status_code == 200
        assert 'nextCursor' in data['pagination']
        assert isinstance(data['pagination']['hasMore'], bool)

    def test_new_post_not_in_public_feed(self, api_url, product_user_b):
        """New posts have distributionStage=0, public feed requires 2."""
        resp, created = create_post(api_url, product_user_b['token'], 'Should NOT be in public feed')
        assert resp.status_code == 201
        post_id = created['post']['id']
        resp, data = get_feed(api_url, 'public')
        assert resp.status_code == 200
        feed_ids = [p['id'] for p in data['items']]
        assert post_id not in feed_ids, 'New post (distributionStage=0) appeared in public feed'


class TestFollowingFeed:
    def test_following_feed_requires_auth(self, api_url):
        h = _make_headers()
        resp = requests.get(f'{api_url}/feed/following', headers=h)
        assert resp.status_code == 401

    def test_own_post_in_following_feed(self, api_url, product_user_b):
        """User's own posts appear in their following feed."""
        resp, created = create_post(api_url, product_user_b['token'], 'My own post in following feed')
        assert resp.status_code == 201
        post_id = created['post']['id']
        resp, data = get_feed(api_url, 'following', token=product_user_b['token'])
        assert resp.status_code == 200
        feed_ids = [p['id'] for p in data['items']]
        assert post_id in feed_ids, 'Own post missing from following feed'
        assert data['feedType'] == 'following'

    def test_followed_user_post_in_feed(self, api_url, product_user_a, product_user_b):
        """After following user_a, their posts appear in user_b's following feed."""
        follow_user(api_url, product_user_a['userId'], product_user_b['token'])
        resp, created = create_post(api_url, product_user_a['token'], 'Post from followed user')
        assert resp.status_code == 201
        post_id = created['post']['id']
        resp, data = get_feed(api_url, 'following', token=product_user_b['token'])
        assert resp.status_code == 200
        feed_ids = [p['id'] for p in data['items']]
        assert post_id in feed_ids, 'Followed user post missing from following feed'


class TestFeedContract:
    def test_feed_items_have_required_fields(self, api_url, product_user_b):
        """Each feed item must have core contract fields."""
        create_post(api_url, product_user_b['token'], 'Contract check feed item')
        resp, data = get_feed(api_url, 'following', token=product_user_b['token'])
        assert resp.status_code == 200
        if data['items']:
            item = data['items'][0]
            for field in ['id', 'kind', 'authorId', 'caption', 'visibility', 'createdAt']:
                assert field in item, f'Feed item missing field: {field}'

    def test_feed_no_id_leak(self, api_url, product_user_b):
        """Feed items must not leak MongoDB _id."""
        create_post(api_url, product_user_b['token'], 'No leak test')
        resp, data = get_feed(api_url, 'following', token=product_user_b['token'])
        if data['items']:
            assert '_id' not in data['items'][0]



TEST_COLLEGE_ID = 'test-college-4b'
TEST_HOUSE_ID = 'test-house-4b'


class TestCollegeFeed:
    def test_college_feed_returns_structure(self, api_url):
        """College feed returns valid structure even if empty."""
        resp, data = get_feed(api_url, f'college/{TEST_COLLEGE_ID}')
        assert resp.status_code == 200
        assert 'items' in data
        assert 'pagination' in data
        assert data['feedType'] == 'college'

    def test_college_feed_pagination_contract(self, api_url):
        resp, data = get_feed(api_url, f'college/{TEST_COLLEGE_ID}', params={'limit': 2})
        assert resp.status_code == 200
        assert 'hasMore' in data['pagination']
        assert isinstance(data['pagination']['hasMore'], bool)

    def test_stage0_post_not_in_college_feed(self, api_url, product_user_b, db):
        """New posts (distributionStage=0) excluded from college feed (requires >=1)."""
        db.users.update_one({'id': product_user_b['userId']}, {'$set': {'collegeId': TEST_COLLEGE_ID}})
        resp, created = create_post(api_url, product_user_b['token'], 'Stage0 college test')
        assert resp.status_code == 201
        post_id = created['post']['id']
        resp, data = get_feed(api_url, f'college/{TEST_COLLEGE_ID}')
        feed_ids = [p['id'] for p in data['items']]
        assert post_id not in feed_ids, 'Stage 0 post appeared in college feed'

    def test_stage1_post_in_college_feed(self, api_url, product_user_b, db):
        """Posts promoted to distributionStage>=1 appear in college feed."""
        db.users.update_one({'id': product_user_b['userId']}, {'$set': {'collegeId': TEST_COLLEGE_ID}})
        resp, created = create_post(api_url, product_user_b['token'], 'Stage1 college test')
        assert resp.status_code == 201
        post_id = created['post']['id']
        # Promote to stage 1 and ensure collegeId is set on the content item
        db.content_items.update_one({'id': post_id}, {'$set': {
            'distributionStage': 1, 'collegeId': TEST_COLLEGE_ID
        }})
        # Use cursor to bypass feed cache (cursor=truthy → no cacheKey)
        resp, data = get_feed(api_url, f'college/{TEST_COLLEGE_ID}',
                              params={'cursor': '2099-01-01T00:00:00.000Z'})
        feed_ids = [p['id'] for p in data['items']]
        assert post_id in feed_ids, 'Stage 1 post missing from college feed'

    def test_different_college_not_leaking(self, api_url, product_user_b, db):
        """Post in college-A must not appear in college-B feed."""
        db.users.update_one({'id': product_user_b['userId']}, {'$set': {'collegeId': TEST_COLLEGE_ID}})
        resp, created = create_post(api_url, product_user_b['token'], 'College isolation test')
        assert resp.status_code == 201
        post_id = created['post']['id']
        db.content_items.update_one({'id': post_id}, {'$set': {'distributionStage': 1}})
        resp, data = get_feed(api_url, 'college/other-college-id')
        feed_ids = [p['id'] for p in data['items']]
        assert post_id not in feed_ids, 'Post leaked to wrong college feed'


class TestHouseFeed:
    def test_house_feed_returns_structure(self, api_url):
        """House feed returns valid structure even if empty."""
        resp, data = get_feed(api_url, f'house/{TEST_HOUSE_ID}')
        assert resp.status_code == 200
        assert 'items' in data
        assert 'pagination' in data
        assert data['feedType'] == 'house'

    def test_house_feed_pagination_contract(self, api_url):
        resp, data = get_feed(api_url, f'house/{TEST_HOUSE_ID}', params={'limit': 2})
        assert resp.status_code == 200
        assert 'hasMore' in data['pagination']

    def test_stage0_post_not_in_house_feed(self, api_url, product_user_b, db):
        """New posts (distributionStage=0) excluded from house feed (requires >=1)."""
        db.users.update_one({'id': product_user_b['userId']}, {'$set': {'houseId': TEST_HOUSE_ID}})
        resp, created = create_post(api_url, product_user_b['token'], 'Stage0 house test')
        assert resp.status_code == 201
        post_id = created['post']['id']
        resp, data = get_feed(api_url, f'house/{TEST_HOUSE_ID}')
        feed_ids = [p['id'] for p in data['items']]
        assert post_id not in feed_ids, 'Stage 0 post appeared in house feed'

    def test_stage1_post_in_house_feed(self, api_url, product_user_b, db):
        """Posts promoted to distributionStage>=1 appear in house feed."""
        db.users.update_one({'id': product_user_b['userId']}, {'$set': {'houseId': TEST_HOUSE_ID}})
        resp, created = create_post(api_url, product_user_b['token'], 'Stage1 house test')
        assert resp.status_code == 201
        post_id = created['post']['id']
        # Promote to stage 1 and ensure houseId is set on the content item
        db.content_items.update_one({'id': post_id}, {'$set': {
            'distributionStage': 1, 'houseId': TEST_HOUSE_ID
        }})
        # Use non-default limit to bypass any cached empty results
        resp, data = get_feed(api_url, f'house/{TEST_HOUSE_ID}',
                              params={'cursor': '2099-01-01T00:00:00.000Z'})
        feed_ids = [p['id'] for p in data['items']]
        assert post_id in feed_ids, 'Stage 1 post missing from house feed'

    def test_different_house_not_leaking(self, api_url, product_user_b, db):
        """Post in house-A must not appear in house-B feed."""
        db.users.update_one({'id': product_user_b['userId']}, {'$set': {'houseId': TEST_HOUSE_ID}})
        resp, created = create_post(api_url, product_user_b['token'], 'House isolation test')
        assert resp.status_code == 201
        post_id = created['post']['id']
        db.content_items.update_one({'id': post_id}, {'$set': {'distributionStage': 1}})
        resp, data = get_feed(api_url, 'house/other-house-id')
        feed_ids = [p['id'] for p in data['items']]
        assert post_id not in feed_ids, 'Post leaked to wrong house feed'
