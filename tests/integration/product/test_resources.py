"""Integration Tests — Resources / PYQs / Voting

P0-C: Resource lifecycle, voting behavior, validation, auth guards.
Uses resource_user for resource creation, product_user_b for voting.
Note: Resources require collegeId (must match user's college + exist in DB).
"""
import pytest
import requests
import uuid
from tests.conftest import _next_test_ip, _make_headers, auth_header

pytestmark = pytest.mark.integration

TEST_COLLEGE_ID_RES = 'test-college-resources-4b'


@pytest.fixture(scope='module', autouse=True)
def setup_college_for_resources(db, resource_user, product_user_b):
    """Ensure college exists in DB and users have collegeId set."""
    db.colleges.update_one(
        {'id': TEST_COLLEGE_ID_RES},
        {'$setOnInsert': {'id': TEST_COLLEGE_ID_RES, 'name': 'Test College for Resources'}},
        upsert=True
    )
    db.users.update_one({'id': resource_user['userId']}, {'$set': {'collegeId': TEST_COLLEGE_ID_RES}})
    db.users.update_one({'id': product_user_b['userId']}, {'$set': {'collegeId': TEST_COLLEGE_ID_RES}})
    yield
    db.colleges.delete_one({'id': TEST_COLLEGE_ID_RES})


def create_resource(api_url, token, title='Test PYQ 4B', ip=None, **kwargs):
    h = auth_header(token, ip=ip or _next_test_ip())
    payload = {
        'title': title,
        'kind': 'PYQ',
        'collegeId': TEST_COLLEGE_ID_RES,
        'subject': 'Mathematics',
        'year': 2025,
        'semester': 1,
        'fileUrl': 'https://example.com/test.pdf',
        **kwargs
    }
    resp = requests.post(f'{api_url}/resources', json=payload, headers=h)
    return resp, resp.json()


def vote_resource(api_url, resource_id, token, vote_type='UP', ip=None):
    h = auth_header(token, ip=ip or _next_test_ip())
    resp = requests.post(f'{api_url}/resources/{resource_id}/vote',
                         json={'vote': vote_type}, headers=h)
    return resp, resp.json()


def remove_vote(api_url, resource_id, token, ip=None):
    h = auth_header(token, ip=ip or _next_test_ip())
    return requests.delete(f'{api_url}/resources/{resource_id}/vote', headers=h)


class TestCreateResource:
    def test_create_resource_success(self, api_url, resource_user):
        resp, data = create_resource(api_url, resource_user['token'])
        assert resp.status_code == 201, f'Expected 201: {data}'
        res = data['resource']
        assert res['title'] == 'Test PYQ 4B'
        assert res['kind'] == 'PYQ'
        assert res['status'] == 'PUBLIC'

    def test_create_resource_contract_shape(self, api_url, resource_user):
        resp, data = create_resource(api_url, resource_user['token'], title='Shape check')
        assert resp.status_code == 201
        res = data['resource']
        for field in ['id', 'uploaderId', 'title', 'kind', 'status', 'createdAt',
                      'voteScore', 'voteCount']:
            assert field in res, f'Missing field: {field}'
        assert '_id' not in res

    def test_create_resource_missing_title_rejected(self, api_url, resource_user):
        h = auth_header(resource_user['token'], ip=_next_test_ip())
        resp = requests.post(f'{api_url}/resources', json={
            'kind': 'PYQ', 'collegeId': TEST_COLLEGE_ID_RES,
            'fileUrl': 'https://example.com/test.pdf'
        }, headers=h)
        assert resp.status_code == 400

    def test_create_resource_no_auth_blocked(self, api_url):
        h = _make_headers()
        resp = requests.post(f'{api_url}/resources', json={
            'title': 'Fail', 'kind': 'PYQ', 'collegeId': TEST_COLLEGE_ID_RES,
            'fileUrl': 'https://example.com/test.pdf'
        }, headers=h)
        assert resp.status_code == 401


class TestGetResource:
    def test_get_resource_detail(self, api_url, resource_user):
        _, created = create_resource(api_url, resource_user['token'], title='Detail test')
        assert 'resource' in created, f'Create failed: {created}'
        resource_id = created['resource']['id']
        h = auth_header(resource_user['token'], ip=_next_test_ip())
        resp = requests.get(f'{api_url}/resources/{resource_id}', headers=h)
        assert resp.status_code == 200
        assert resp.json()['resource']['id'] == resource_id

    def test_get_nonexistent_resource_404(self, api_url, resource_user):
        h = auth_header(resource_user['token'], ip=_next_test_ip())
        resp = requests.get(f'{api_url}/resources/fake-resource-id', headers=h)
        assert resp.status_code == 404


class TestResourceVoting:
    def test_upvote_success(self, api_url, resource_user, product_user_b):
        """product_user_b votes on resource_user's resource (can't vote on own)."""
        _, created = create_resource(api_url, resource_user['token'], title='Upvote target')
        assert 'resource' in created, f'Create failed: {created}'
        resource_id = created['resource']['id']
        resp, data = vote_resource(api_url, resource_id, product_user_b['token'], 'UP')
        assert resp.status_code == 200

    def test_downvote_success(self, api_url, resource_user, product_user_b):
        _, created = create_resource(api_url, resource_user['token'], title='Downvote target')
        assert 'resource' in created
        resource_id = created['resource']['id']
        resp, data = vote_resource(api_url, resource_id, product_user_b['token'], 'DOWN')
        assert resp.status_code == 200

    def test_vote_switch(self, api_url, resource_user, product_user_b):
        """Switch from UP to DOWN should update correctly."""
        _, created = create_resource(api_url, resource_user['token'], title='Vote switch')
        assert 'resource' in created
        resource_id = created['resource']['id']
        vote_resource(api_url, resource_id, product_user_b['token'], 'UP')
        resp, data = vote_resource(api_url, resource_id, product_user_b['token'], 'DOWN')
        assert resp.status_code == 200

    def test_duplicate_vote_returns_conflict(self, api_url, resource_user, product_user_b):
        """Same vote direction twice returns 409 CONFLICT."""
        _, created = create_resource(api_url, resource_user['token'], title='Dup vote')
        assert 'resource' in created
        resource_id = created['resource']['id']
        vote_resource(api_url, resource_id, product_user_b['token'], 'UP')
        resp, data = vote_resource(api_url, resource_id, product_user_b['token'], 'UP')
        assert resp.status_code == 409

    def test_self_vote_forbidden(self, api_url, resource_user):
        """Cannot vote on your own resource."""
        _, created = create_resource(api_url, resource_user['token'], title='Self vote')
        assert 'resource' in created
        resource_id = created['resource']['id']
        resp, data = vote_resource(api_url, resource_id, resource_user['token'], 'UP')
        assert resp.status_code == 403

    def test_remove_vote(self, api_url, resource_user, product_user_b):
        _, created = create_resource(api_url, resource_user['token'], title='Remove vote')
        assert 'resource' in created
        resource_id = created['resource']['id']
        vote_resource(api_url, resource_id, product_user_b['token'], 'UP')
        resp = remove_vote(api_url, resource_id, product_user_b['token'])
        assert resp.status_code == 200

    def test_vote_no_auth_blocked(self, api_url, resource_user):
        _, created = create_resource(api_url, resource_user['token'], title='Auth vote')
        assert 'resource' in created
        h = _make_headers()
        resp = requests.post(f'{api_url}/resources/{created["resource"]["id"]}/vote',
                             json={'vote': 'UP'}, headers=h)
        assert resp.status_code == 401

    def test_vote_nonexistent_resource_404(self, api_url, product_user_b):
        resp, data = vote_resource(api_url, 'fake-resource-id', product_user_b['token'])
        assert resp.status_code == 404
