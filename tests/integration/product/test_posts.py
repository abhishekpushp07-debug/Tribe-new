"""Integration Tests — Posts / Content Creation

P0-A: Post lifecycle — create, get, delete, validation, auth guards, contract shape.
Uses product_user_a for dedicated WRITE rate-limit budget.
"""
import pytest
import requests
from tests.helpers.product import create_post, get_post, delete_post
from tests.conftest import _next_test_ip, _make_headers, auth_header

pytestmark = pytest.mark.integration


class TestCreatePost:
    def test_create_post_success(self, api_url, product_user_a):
        resp, data = create_post(api_url, product_user_a['token'], 'Hello world from 4B')
        assert resp.status_code == 201, f'Expected 201, got {resp.status_code}: {data}'
        post = data['post']
        assert post['caption'] == 'Hello world from 4B'
        assert post['kind'] == 'POST'
        assert post['authorId'] == product_user_a['userId']
        assert post['visibility'] == 'PUBLIC'
        assert post['likeCount'] == 0
        assert post['commentCount'] == 0

    def test_create_post_contract_shape(self, api_url, product_user_a):
        resp, data = create_post(api_url, product_user_a['token'], 'Contract shape test')
        assert resp.status_code == 201
        post = data['post']
        required_fields = ['id', 'kind', 'authorId', 'caption', 'visibility',
                           'likeCount', 'commentCount', 'saveCount', 'createdAt']
        for field in required_fields:
            assert field in post, f'Missing field: {field}'
        assert '_id' not in post, 'MongoDB _id leaked in response'

    def test_create_post_empty_caption_rejected(self, api_url, product_user_a):
        h = auth_header(product_user_a['token'], ip=_next_test_ip())
        resp = requests.post(f'{api_url}/content/posts', json={
            'caption': '', 'mediaIds': [],
        }, headers=h)
        assert resp.status_code == 400
        assert resp.json()['code'] == 'VALIDATION_ERROR'

    def test_create_post_no_auth_blocked(self, api_url):
        h = _make_headers()
        resp = requests.post(f'{api_url}/content/posts', json={
            'caption': 'Should fail',
        }, headers=h)
        assert resp.status_code == 401

    def test_create_post_invalid_kind_rejected(self, api_url, product_user_a):
        h = auth_header(product_user_a['token'], ip=_next_test_ip())
        resp = requests.post(f'{api_url}/content/posts', json={
            'caption': 'Bad kind', 'kind': 'INVALID_TYPE',
        }, headers=h)
        assert resp.status_code == 400
        assert resp.json()['code'] == 'VALIDATION_ERROR'

    def test_create_post_has_request_id(self, api_url, product_user_a):
        resp, _ = create_post(api_url, product_user_a['token'], 'Request ID check')
        assert 'x-request-id' in resp.headers


class TestGetPost:
    def test_get_post_success(self, api_url, product_user_a):
        _, created = create_post(api_url, product_user_a['token'], 'Get test')
        post_id = created['post']['id']
        resp, data = get_post(api_url, post_id, product_user_a['token'])
        assert resp.status_code == 200
        assert data['post']['id'] == post_id
        assert data['post']['caption'] == 'Get test'

    def test_get_nonexistent_post_404(self, api_url, product_user_a):
        resp, data = get_post(api_url, 'nonexistent-post-id', product_user_a['token'])
        assert resp.status_code == 404
        assert data['code'] == 'NOT_FOUND'


class TestDeletePost:
    def test_delete_own_post(self, api_url, product_user_a):
        _, created = create_post(api_url, product_user_a['token'], 'To be deleted')
        post_id = created['post']['id']
        resp = delete_post(api_url, post_id, product_user_a['token'])
        assert resp.status_code == 200
        # Verify post is now REMOVED (404 on get)
        resp2, data2 = get_post(api_url, post_id, product_user_a['token'])
        assert resp2.status_code == 404

    def test_delete_other_user_post_forbidden(self, api_url, product_user_a, product_user_b):
        _, created = create_post(api_url, product_user_a['token'], 'Not yours')
        post_id = created['post']['id']
        resp = delete_post(api_url, post_id, product_user_b['token'])
        assert resp.status_code == 403
        assert resp.json()['code'] == 'FORBIDDEN'

    def test_delete_nonexistent_post_404(self, api_url, product_user_a):
        resp = delete_post(api_url, 'fake-id-123', product_user_a['token'])
        assert resp.status_code == 404

    def test_delete_no_auth_blocked(self, api_url, product_user_a):
        _, created = create_post(api_url, product_user_a['token'], 'No auth delete')
        post_id = created['post']['id']
        h = _make_headers()
        resp = requests.delete(f'{api_url}/content/{post_id}', headers=h)
        assert resp.status_code == 401

    def test_admin_can_delete_any_post(self, api_url, product_user_a, admin_user):
        _, created = create_post(api_url, product_user_a['token'], 'Admin deletable')
        post_id = created['post']['id']
        resp = delete_post(api_url, post_id, admin_user['token'])
        assert resp.status_code == 200
