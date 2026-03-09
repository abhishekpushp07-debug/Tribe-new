"""Integration Tests — Social Actions

P0-C: Like, save, comment, follow/unfollow — correctness, idempotency, counters.
Uses test_user + test_user_2 for social interactions (lighter WRITE load).
"""
import pytest
from tests.helpers.product import (
    create_post, like_post, save_post, unsave_post,
    create_comment, get_comments, follow_user, unfollow_user, get_post
)
from tests.conftest import _next_test_ip, _make_headers, auth_header
import requests

pytestmark = pytest.mark.integration


class TestLike:
    def test_like_post_success(self, api_url, test_user):
        _, created = create_post(api_url, test_user['token'], 'Like target')
        post_id = created['post']['id']
        resp, data = like_post(api_url, post_id, test_user['token'])
        assert resp.status_code == 200
        assert data['viewerHasLiked'] is True
        assert data['likeCount'] >= 1

    def test_like_idempotent(self, api_url, test_user):
        """Liking the same post twice should not increase count."""
        _, created = create_post(api_url, test_user['token'], 'Idempotent like')
        post_id = created['post']['id']
        _, data1 = like_post(api_url, post_id, test_user['token'])
        _, data2 = like_post(api_url, post_id, test_user['token'])
        assert data1['likeCount'] == data2['likeCount']

    def test_like_nonexistent_post_404(self, api_url, test_user):
        h = auth_header(test_user['token'], ip=_next_test_ip())
        resp = requests.post(f'{api_url}/content/fake-post-id/like', headers=h)
        assert resp.status_code == 404

    def test_like_no_auth_blocked(self, api_url, test_user):
        _, created = create_post(api_url, test_user['token'], 'Auth like test')
        h = _make_headers()
        resp = requests.post(f'{api_url}/content/{created["post"]["id"]}/like', headers=h)
        assert resp.status_code == 401

    def test_like_updates_post_count(self, api_url, test_user, test_user_2):
        """Like from another user should increment likeCount."""
        _, created = create_post(api_url, test_user['token'], 'Count check')
        post_id = created['post']['id']
        like_post(api_url, post_id, test_user_2['token'])
        _, detail = get_post(api_url, post_id, test_user['token'])
        assert detail['post']['likeCount'] >= 1


class TestSave:
    def test_save_post_success(self, api_url, test_user):
        _, created = create_post(api_url, test_user['token'], 'Save target')
        post_id = created['post']['id']
        resp, data = save_post(api_url, post_id, test_user['token'])
        assert resp.status_code == 200
        assert data['saved'] is True

    def test_save_idempotent(self, api_url, test_user):
        _, created = create_post(api_url, test_user['token'], 'Idempotent save')
        post_id = created['post']['id']
        save_post(api_url, post_id, test_user['token'])
        resp, data = save_post(api_url, post_id, test_user['token'])
        assert resp.status_code == 200
        assert data['saved'] is True

    def test_unsave_post(self, api_url, test_user):
        _, created = create_post(api_url, test_user['token'], 'Unsave target')
        post_id = created['post']['id']
        save_post(api_url, post_id, test_user['token'])
        resp, data = unsave_post(api_url, post_id, test_user['token'])
        assert resp.status_code == 200
        assert data['saved'] is False


class TestComment:
    def test_create_comment_success(self, api_url, test_user):
        _, created = create_post(api_url, test_user['token'], 'Comment target')
        post_id = created['post']['id']
        resp, data = create_comment(api_url, post_id, test_user['token'], 'Nice post!')
        assert resp.status_code == 201
        assert 'comment' in data
        assert data['comment']['body'] == 'Nice post!' or data['comment']['text'] == 'Nice post!'

    def test_comment_empty_body_rejected(self, api_url, test_user):
        _, created = create_post(api_url, test_user['token'], 'Empty comment target')
        post_id = created['post']['id']
        resp, data = create_comment(api_url, post_id, test_user['token'], '')
        assert resp.status_code == 400
        assert data['code'] == 'VALIDATION_ERROR'

    def test_comment_no_auth_blocked(self, api_url, test_user):
        _, created = create_post(api_url, test_user['token'], 'Auth comment test')
        h = _make_headers()
        resp = requests.post(f'{api_url}/content/{created["post"]["id"]}/comments',
                             json={'body': 'fail'}, headers=h)
        assert resp.status_code == 401

    def test_comment_on_nonexistent_post(self, api_url, test_user):
        resp, data = create_comment(api_url, 'fake-post-id', test_user['token'], 'Ghost')
        assert resp.status_code == 404

    def test_get_comments_success(self, api_url, test_user):
        _, created = create_post(api_url, test_user['token'], 'List comments target')
        post_id = created['post']['id']
        create_comment(api_url, post_id, test_user['token'], 'Comment 1')
        create_comment(api_url, post_id, test_user['token'], 'Comment 2')
        resp, data = get_comments(api_url, post_id, test_user['token'])
        assert resp.status_code == 200
        assert 'items' in data
        assert len(data['items']) >= 2

    def test_comment_increments_count(self, api_url, test_user):
        _, created = create_post(api_url, test_user['token'], 'Count comment target')
        post_id = created['post']['id']
        create_comment(api_url, post_id, test_user['token'], 'Counting')
        _, detail = get_post(api_url, post_id, test_user['token'])
        assert detail['post']['commentCount'] >= 1


class TestFollow:
    def test_follow_success(self, api_url, test_user, test_user_2):
        resp = follow_user(api_url, test_user_2['userId'], test_user['token'])
        assert resp.status_code == 200
        data = resp.json()
        assert data['isFollowing'] is True

    def test_follow_idempotent(self, api_url, test_user, test_user_2):
        follow_user(api_url, test_user_2['userId'], test_user['token'])
        resp = follow_user(api_url, test_user_2['userId'], test_user['token'])
        assert resp.status_code == 200
        assert resp.json()['isFollowing'] is True

    def test_self_follow_blocked(self, api_url, test_user):
        resp = follow_user(api_url, test_user['userId'], test_user['token'])
        assert resp.status_code == 409

    def test_follow_nonexistent_user_404(self, api_url, test_user):
        resp = follow_user(api_url, 'nonexistent-user-id', test_user['token'])
        assert resp.status_code == 404

    def test_unfollow_success(self, api_url, test_user, test_user_2):
        follow_user(api_url, test_user_2['userId'], test_user['token'])
        resp = unfollow_user(api_url, test_user_2['userId'], test_user['token'])
        assert resp.status_code == 200
        assert resp.json()['isFollowing'] is False

    def test_follow_no_auth_blocked(self, api_url, test_user_2):
        h = _make_headers()
        resp = requests.post(f'{api_url}/follow/{test_user_2["userId"]}', headers=h)
        assert resp.status_code == 401
