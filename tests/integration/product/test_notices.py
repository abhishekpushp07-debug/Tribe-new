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


class TestUpdateNotice:
    """PATCH /board/notices/:id — edit notice title/body/category."""

    def test_admin_can_update_notice(self, api_url, admin_user):
        _, created = create_notice(api_url, admin_user['token'], title='Before update')
        notice_id = created['notice']['id']
        h = auth_header(admin_user['token'], ip=_next_test_ip())
        resp = requests.patch(f'{api_url}/board/notices/{notice_id}',
                              json={'title': 'After update'}, headers=h)
        assert resp.status_code == 200
        assert resp.json()['notice']['title'] == 'After update'

    def test_update_nonexistent_notice_404(self, api_url, admin_user):
        h = auth_header(admin_user['token'], ip=_next_test_ip())
        resp = requests.patch(f'{api_url}/board/notices/fake-id',
                              json={'title': 'Nope'}, headers=h)
        assert resp.status_code == 404

    def test_update_removed_notice_rejected(self, api_url, admin_user, db):
        """Cannot edit a REMOVED notice."""
        _, created = create_notice(api_url, admin_user['token'], title='Will remove')
        notice_id = created['notice']['id']
        db.board_notices.update_one({'id': notice_id}, {'$set': {'status': 'REMOVED'}})
        h = auth_header(admin_user['token'], ip=_next_test_ip())
        resp = requests.patch(f'{api_url}/board/notices/{notice_id}',
                              json={'title': 'Edit removed'}, headers=h)
        assert resp.status_code == 400

    def test_regular_user_cannot_update_others_notice(self, api_url, admin_user, test_user):
        _, created = create_notice(api_url, admin_user['token'], title='Admin notice')
        notice_id = created['notice']['id']
        h = auth_header(test_user['token'], ip=_next_test_ip())
        resp = requests.patch(f'{api_url}/board/notices/{notice_id}',
                              json={'title': 'Hijack'}, headers=h)
        assert resp.status_code == 403


class TestDeleteNotice:
    """DELETE /board/notices/:id — soft-delete (sets status=REMOVED)."""

    def test_admin_can_delete_notice(self, api_url, admin_user):
        _, created = create_notice(api_url, admin_user['token'], title='To delete')
        notice_id = created['notice']['id']
        h = auth_header(admin_user['token'], ip=_next_test_ip())
        resp = requests.delete(f'{api_url}/board/notices/{notice_id}', headers=h)
        assert resp.status_code == 200
        assert resp.json()['message'] == 'Notice removed'
        # Verify it's now 410
        resp2 = requests.get(f'{api_url}/board/notices/{notice_id}',
                             headers=auth_header(admin_user['token'], ip=_next_test_ip()))
        assert resp2.status_code == 410

    def test_delete_nonexistent_notice_404(self, api_url, admin_user):
        h = auth_header(admin_user['token'], ip=_next_test_ip())
        resp = requests.delete(f'{api_url}/board/notices/fake-id', headers=h)
        assert resp.status_code == 404

    def test_regular_user_cannot_delete_others_notice(self, api_url, admin_user, test_user):
        _, created = create_notice(api_url, admin_user['token'], title='Protected')
        notice_id = created['notice']['id']
        h = auth_header(test_user['token'], ip=_next_test_ip())
        resp = requests.delete(f'{api_url}/board/notices/{notice_id}', headers=h)
        assert resp.status_code == 403


class TestPinNotice:
    """POST/DELETE /board/notices/:id/pin — pin/unpin (admin or board seat required)."""

    def test_admin_can_pin_notice(self, api_url, admin_user):
        _, created = create_notice(api_url, admin_user['token'], title='Pin me')
        notice_id = created['notice']['id']
        h = auth_header(admin_user['token'], ip=_next_test_ip())
        resp = requests.post(f'{api_url}/board/notices/{notice_id}/pin', headers=h)
        assert resp.status_code == 200
        assert resp.json()['message'] == 'Notice pinned'

    def test_admin_can_unpin_notice(self, api_url, admin_user):
        _, created = create_notice(api_url, admin_user['token'], title='Unpin me')
        notice_id = created['notice']['id']
        h = auth_header(admin_user['token'], ip=_next_test_ip())
        requests.post(f'{api_url}/board/notices/{notice_id}/pin', headers=h)
        resp = requests.delete(f'{api_url}/board/notices/{notice_id}/pin',
                               headers=auth_header(admin_user['token'], ip=_next_test_ip()))
        assert resp.status_code == 200
        assert resp.json()['message'] == 'Notice unpinned'

    def test_pin_nonexistent_notice_404(self, api_url, admin_user):
        h = auth_header(admin_user['token'], ip=_next_test_ip())
        resp = requests.post(f'{api_url}/board/notices/fake-id/pin', headers=h)
        assert resp.status_code == 404

    def test_regular_user_cannot_pin(self, api_url, admin_user, test_user):
        """Regular user without board seat cannot pin."""
        _, created = create_notice(api_url, admin_user['token'], title='No pin')
        notice_id = created['notice']['id']
        h = auth_header(test_user['token'], ip=_next_test_ip())
        resp = requests.post(f'{api_url}/board/notices/{notice_id}/pin', headers=h)
        assert resp.status_code == 403


class TestCollegeNoticeListing:
    """GET /colleges/:id/notices — public college notice board."""

    NOTICE_COLLEGE_ID = 'test-college-notices-4b'

    def test_college_notice_listing_returns_structure(self, api_url, admin_user, db):
        # Ensure admin has this collegeId so the notice inherits it
        db.users.update_one({'id': admin_user['userId']}, {'$set': {'collegeId': self.NOTICE_COLLEGE_ID}})
        create_notice(api_url, admin_user['token'], title='College notice')
        h = _make_headers()
        resp = requests.get(f'{api_url}/colleges/{self.NOTICE_COLLEGE_ID}/notices', headers=h)
        assert resp.status_code == 200
        data = resp.json()
        assert 'items' in data
        assert 'pagination' in data

    def test_college_notice_listing_has_creator_info(self, api_url, admin_user, db):
        db.users.update_one({'id': admin_user['userId']}, {'$set': {'collegeId': self.NOTICE_COLLEGE_ID}})
        create_notice(api_url, admin_user['token'], title='Creator info test')
        h = _make_headers()
        resp = requests.get(f'{api_url}/colleges/{self.NOTICE_COLLEGE_ID}/notices', headers=h)
        assert resp.status_code == 200
        items = resp.json()['items']
        if items:
            assert 'creator' in items[0], 'College notice listing should include creator info'


class TestAcknowledgmentList:
    """GET /board/notices/:id/acknowledgments — list who acknowledged."""

    def test_acknowledgment_list_returns_structure(self, api_url, admin_user, test_user):
        _, created = create_notice(api_url, admin_user['token'], title='Ack list test')
        notice_id = created['notice']['id']
        acknowledge_notice(api_url, notice_id, test_user['token'])
        h = auth_header(admin_user['token'], ip=_next_test_ip())
        resp = requests.get(f'{api_url}/board/notices/{notice_id}/acknowledgments', headers=h)
        assert resp.status_code == 200
        data = resp.json()
        assert 'items' in data
        assert 'total' in data
        assert data['total'] >= 1

    def test_acknowledgment_list_contains_user_info(self, api_url, admin_user, test_user):
        _, created = create_notice(api_url, admin_user['token'], title='Ack user info')
        notice_id = created['notice']['id']
        acknowledge_notice(api_url, notice_id, test_user['token'])
        h = auth_header(admin_user['token'], ip=_next_test_ip())
        resp = requests.get(f'{api_url}/board/notices/{notice_id}/acknowledgments', headers=h)
        items = resp.json()['items']
        assert len(items) >= 1
        assert 'userId' in items[0]
        assert 'acknowledgedAt' in items[0]
