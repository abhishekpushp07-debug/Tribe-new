"""Integration Tests — Dislike + Reaction Remove

P0-A: Complete the social interaction model. Like alone is incomplete.
Covers dislike, reaction remove/undo, toggle semantics, counter effects.
"""
import pytest
import requests
from tests.helpers.product import create_post, like_post, get_post
from tests.conftest import _next_test_ip, _make_headers, auth_header

pytestmark = pytest.mark.integration


def dislike_post(api_url, post_id, token, ip=None):
    h = auth_header(token, ip=ip or _next_test_ip())
    resp = requests.post(f'{api_url}/content/{post_id}/dislike', headers=h)
    return resp, resp.json()


def remove_reaction(api_url, post_id, token, ip=None):
    h = auth_header(token, ip=ip or _next_test_ip())
    resp = requests.delete(f'{api_url}/content/{post_id}/reaction', headers=h)
    return resp, resp.json()


class TestDislike:
    def test_dislike_success(self, api_url, social_user):
        _, created = create_post(api_url, social_user['token'], 'Dislike target')
        post_id = created['post']['id']
        resp, data = dislike_post(api_url, post_id, social_user['token'])
        assert resp.status_code == 200
        assert data['viewerHasDisliked'] is True
        assert data['viewerHasLiked'] is False

    def test_dislike_idempotent(self, api_url, social_user):
        _, created = create_post(api_url, social_user['token'], 'Dislike idem')
        post_id = created['post']['id']
        dislike_post(api_url, post_id, social_user['token'])
        resp, data = dislike_post(api_url, post_id, social_user['token'])
        assert resp.status_code == 200
        assert data['viewerHasDisliked'] is True

    def test_switch_like_to_dislike(self, api_url, social_user):
        """Like then dislike should toggle reaction type."""
        _, created = create_post(api_url, social_user['token'], 'Toggle test')
        post_id = created['post']['id']
        like_post(api_url, post_id, social_user['token'])
        resp, data = dislike_post(api_url, post_id, social_user['token'])
        assert resp.status_code == 200
        assert data['viewerHasDisliked'] is True
        assert data['viewerHasLiked'] is False

    def test_dislike_nonexistent_404(self, api_url, social_user):
        resp, data = dislike_post(api_url, 'nonexistent-post-id', social_user['token'])
        assert resp.status_code == 404

    def test_dislike_no_auth_blocked(self, api_url, social_user):
        _, created = create_post(api_url, social_user['token'], 'Auth dislike')
        h = _make_headers()
        resp = requests.post(f'{api_url}/content/{created["post"]["id"]}/dislike', headers=h)
        assert resp.status_code == 401


class TestReactionRemove:
    def test_remove_like_reaction(self, api_url, social_user):
        _, created = create_post(api_url, social_user['token'], 'Remove like')
        post_id = created['post']['id']
        like_post(api_url, post_id, social_user['token'])
        resp, data = remove_reaction(api_url, post_id, social_user['token'])
        assert resp.status_code == 200
        assert data['viewerHasLiked'] is False
        assert data['viewerHasDisliked'] is False

    def test_remove_dislike_reaction(self, api_url, social_user):
        _, created = create_post(api_url, social_user['token'], 'Remove dislike')
        post_id = created['post']['id']
        dislike_post(api_url, post_id, social_user['token'])
        resp, data = remove_reaction(api_url, post_id, social_user['token'])
        assert resp.status_code == 200
        assert data['viewerHasLiked'] is False
        assert data['viewerHasDisliked'] is False

    def test_remove_no_reaction_is_noop(self, api_url, social_user):
        """Removing when no reaction exists is a safe no-op."""
        _, created = create_post(api_url, social_user['token'], 'No reaction')
        post_id = created['post']['id']
        resp, data = remove_reaction(api_url, post_id, social_user['token'])
        assert resp.status_code == 200
        assert data['viewerHasLiked'] is False

    def test_like_count_decrements_on_remove(self, api_url, social_user, test_user_2):
        """Like count should go down when reaction is removed."""
        _, created = create_post(api_url, social_user['token'], 'Count decrement')
        post_id = created['post']['id']
        like_post(api_url, post_id, test_user_2['token'])
        _, detail_before = get_post(api_url, post_id, social_user['token'])
        count_before = detail_before['post']['likeCount']
        remove_reaction(api_url, post_id, test_user_2['token'])
        _, detail_after = get_post(api_url, post_id, social_user['token'])
        assert detail_after['post']['likeCount'] < count_before
