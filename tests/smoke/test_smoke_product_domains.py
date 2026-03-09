"""Smoke Tests — Product Domain Expansion

P1-B: Tiny E2E flows for events, resources, notices.
"""
import pytest
import requests
from datetime import datetime, timedelta
from tests.conftest import _next_test_ip, _next_phone, _register_or_login, auth_header

pytestmark = pytest.mark.smoke


class TestProductDomainSmoke:
    def test_event_lifecycle_smoke(self, api_url, db):
        """Create event -> RSVP -> verify count."""
        user_a = _register_or_login(api_url, _next_phone(601), display_name='Smoke Event A')
        user_b = _register_or_login(api_url, _next_phone(602), display_name='Smoke Event B')
        db.users.update_one({'phone': user_a['phone']}, {'$set': {'ageStatus': 'ADULT'}})
        db.users.update_one({'phone': user_b['phone']}, {'$set': {'ageStatus': 'ADULT'}})

        # Create event
        h = auth_header(user_a['token'], ip=_next_test_ip())
        start = (datetime.utcnow() + timedelta(days=5)).isoformat() + 'Z'
        resp = requests.post(f'{api_url}/events', json={
            'title': 'Smoke Event', 'startAt': start, 'category': 'SOCIAL'
        }, headers=h)
        assert resp.status_code == 201
        event_id = resp.json()['event']['id']

        # RSVP
        h_b = auth_header(user_b['token'], ip=_next_test_ip())
        resp = requests.post(f'{api_url}/events/{event_id}/rsvp',
                             json={'status': 'GOING'}, headers=h_b)
        assert resp.status_code == 200
        assert resp.json()['rsvp']['goingCount'] >= 1

    def test_resource_lifecycle_smoke(self, api_url, db):
        """Create resource -> vote -> verify."""
        user_a = _register_or_login(api_url, _next_phone(603), display_name='Smoke Res A')
        user_b = _register_or_login(api_url, _next_phone(604), display_name='Smoke Res B')
        college_id = 'test-college-smoke-4b'
        db.users.update_one({'phone': user_a['phone']}, {'$set': {'ageStatus': 'ADULT', 'collegeId': college_id}})
        db.users.update_one({'phone': user_b['phone']}, {'$set': {'ageStatus': 'ADULT', 'collegeId': college_id}})
        db.colleges.update_one({'id': college_id}, {'$setOnInsert': {'id': college_id, 'name': 'Smoke College'}}, upsert=True)

        h = auth_header(user_a['token'], ip=_next_test_ip())
        resp = requests.post(f'{api_url}/resources', json={
            'title': 'Smoke PYQ', 'kind': 'PYQ', 'subject': 'Physics',
            'collegeId': college_id,
            'year': 2025, 'semester': 1, 'fileUrl': 'https://example.com/smoke.pdf'
        }, headers=h)
        assert resp.status_code == 201, f'Resource creation failed: {resp.json()}'
        resource_id = resp.json()['resource']['id']

        # Vote (user_b votes on user_a's resource)
        resp = requests.post(f'{api_url}/resources/{resource_id}/vote',
                             json={'vote': 'UP'},
                             headers=auth_header(user_b['token'], ip=_next_test_ip()))
        assert resp.status_code == 200
