"""Integration Tests — Board Notices + Acknowledgment

P0-D: Notice lifecycle, acknowledgment, permission boundaries.
Notice creation requires board member seat or admin role.
Uses admin_user for creation.
"""
import pytest
import requests
from tests.conftest import _next_test_ip, _make_headers, auth_header

pytestmark = pytest.mark.integration


def create_notice(api_url, token, title='Test Notice 4B', body='Test notice body', ip=None, **kwargs):
    h = auth_header(token, ip=ip or _next_test_ip())
    payload = {'title': title, 'body': body, 'category': 'GENERAL', 'priority': 'NORMAL', **kwargs}
    resp = requests.post(f'{api_url}/board/notices', json=payload, headers=h)
    return resp, resp.json()


def acknowledge_notice(api_url, notice_id, token, ip=None):
    h = auth_header(token, ip=ip or _next_test_ip())
    resp = requests.post(f'{api_url}/board/notices/{notice_id}/acknowledge', headers=h)
    return resp, resp.json()


class TestCreateNotice:
    def test_admin_creates_notice_success(self, api_url, admin_user):
        resp, data = create_notice(api_url, admin_user['token'])
        assert resp.status_code == 201, f'Expected 201: {data}'
        notice = data['notice']
        assert notice['title'] == 'Test Notice 4B'
        assert notice['status'] == 'PUBLISHED'  # Admin auto-publishes
        assert notice['acknowledgmentCount'] == 0

    def test_create_notice_contract_shape(self, api_url, admin_user):
        resp, data = create_notice(api_url, admin_user['token'], title='Shape check')
        assert resp.status_code == 201
        notice = data['notice']
        for field in ['id', 'creatorId', 'title', 'body', 'category', 'priority',
                      'status', 'acknowledgmentCount', 'createdAt']:
            assert field in notice, f'Missing field: {field}'
        assert '_id' not in notice

    def test_regular_user_cannot_create_notice(self, api_url, test_user):
        """Regular users without board seat or admin role are forbidden."""
        resp, data = create_notice(api_url, test_user['token'])
        assert resp.status_code == 403
        assert data['code'] == 'FORBIDDEN'

    def test_create_notice_missing_title_rejected(self, api_url, admin_user):
        h = auth_header(admin_user['token'], ip=_next_test_ip())
        resp = requests.post(f'{api_url}/board/notices', json={'body': 'Only body'}, headers=h)
        assert resp.status_code == 400

    def test_create_notice_no_auth_blocked(self, api_url):
        h = _make_headers()
        resp = requests.post(f'{api_url}/board/notices',
                             json={'title': 'Fail', 'body': 'Fail'}, headers=h)
        assert resp.status_code == 401


class TestGetNotice:
    def test_get_notice_detail(self, api_url, admin_user):
        _, created = create_notice(api_url, admin_user['token'], title='Detail test')
        notice_id = created['notice']['id']
        h = auth_header(admin_user['token'], ip=_next_test_ip())
        resp = requests.get(f'{api_url}/board/notices/{notice_id}', headers=h)
        assert resp.status_code == 200
        assert resp.json()['notice']['id'] == notice_id

    def test_get_nonexistent_notice_404(self, api_url, admin_user):
        h = auth_header(admin_user['token'], ip=_next_test_ip())
        resp = requests.get(f'{api_url}/board/notices/fake-notice-id', headers=h)
        assert resp.status_code == 404

    def test_removed_notice_returns_410(self, api_url, admin_user, db):
        """REMOVED notices return HTTP 410 Gone."""
        _, created = create_notice(api_url, admin_user['token'], title='Will be removed')
        notice_id = created['notice']['id']
        db.board_notices.update_one({'id': notice_id}, {'$set': {'status': 'REMOVED'}})
        h = auth_header(admin_user['token'], ip=_next_test_ip())
        resp = requests.get(f'{api_url}/board/notices/{notice_id}', headers=h)
        assert resp.status_code == 410


class TestAcknowledgment:
    def test_acknowledge_notice_success(self, api_url, admin_user, test_user):
        _, created = create_notice(api_url, admin_user['token'], title='Ack test')
        notice_id = created['notice']['id']
        resp, data = acknowledge_notice(api_url, notice_id, test_user['token'])
        assert resp.status_code == 200

    def test_acknowledge_idempotent(self, api_url, admin_user, test_user):
        _, created = create_notice(api_url, admin_user['token'], title='Dup ack')
        notice_id = created['notice']['id']
        acknowledge_notice(api_url, notice_id, test_user['token'])
        resp, data = acknowledge_notice(api_url, notice_id, test_user['token'])
        assert resp.status_code == 200

    def test_acknowledge_no_auth_blocked(self, api_url, admin_user):
        _, created = create_notice(api_url, admin_user['token'], title='Auth ack')
        h = _make_headers()
        resp = requests.post(f'{api_url}/board/notices/{created["notice"]["id"]}/acknowledge', headers=h)
        assert resp.status_code == 401
