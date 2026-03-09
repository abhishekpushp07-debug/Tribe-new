"""Smoke Tests — Product Domain

P1-C: End-to-end product sanity flows.
1. Register -> login -> create post -> following feed -> verify visibility
2. Two users -> follow -> post -> verify in follower's feed
"""
import pytest
import requests
from tests.conftest import _next_test_ip, _make_headers, _next_phone, _register_or_login, auth_header

pytestmark = pytest.mark.smoke


class TestProductSmoke:
    def test_post_to_feed_flow(self, api_url, db):
        """Full flow: register -> set ADULT -> create post -> see in own following feed."""
        ip = _next_test_ip()
        user = _register_or_login(api_url, _next_phone(501), display_name='Smoke Product 1', ip=ip)
        # Set ADULT for posting
        db.users.update_one({'phone': user['phone']}, {'$set': {'ageStatus': 'ADULT'}})

        # Create post
        h = auth_header(user['token'], ip=_next_test_ip())
        resp = requests.post(f'{api_url}/content/posts', json={
            'caption': 'Smoke test post',
        }, headers=h)
        assert resp.status_code == 201, f'Post creation failed: {resp.text}'
        post_id = resp.json()['post']['id']

        # Verify in following feed
        h2 = auth_header(user['token'], ip=_next_test_ip())
        resp = requests.get(f'{api_url}/feed/following', headers=h2)
        assert resp.status_code == 200
        feed_ids = [p['id'] for p in resp.json()['items']]
        assert post_id in feed_ids, 'Post not found in following feed'

    def test_follow_and_feed_flow(self, api_url, db):
        """Two users: user_a follows user_b -> user_b posts -> appears in user_a's feed."""
        user_a = _register_or_login(api_url, _next_phone(502), display_name='Smoke A')
        user_b = _register_or_login(api_url, _next_phone(503), display_name='Smoke B')
        db.users.update_one({'phone': user_a['phone']}, {'$set': {'ageStatus': 'ADULT'}})
        db.users.update_one({'phone': user_b['phone']}, {'$set': {'ageStatus': 'ADULT'}})

        # A follows B
        h_a = auth_header(user_a['token'], ip=_next_test_ip())
        resp = requests.post(f'{api_url}/follow/{user_b["userId"]}', headers=h_a)
        assert resp.status_code == 200

        # B creates post
        h_b = auth_header(user_b['token'], ip=_next_test_ip())
        resp = requests.post(f'{api_url}/content/posts', json={
            'caption': 'Post from B',
        }, headers=h_b)
        assert resp.status_code == 201
        post_id = resp.json()['post']['id']

        # A's following feed should have B's post
        h_a2 = auth_header(user_a['token'], ip=_next_test_ip())
        resp = requests.get(f'{api_url}/feed/following', headers=h_a2)
        assert resp.status_code == 200
        feed_ids = [p['id'] for p in resp.json()['items']]
        assert post_id in feed_ids, 'Followed user post not in feed'
