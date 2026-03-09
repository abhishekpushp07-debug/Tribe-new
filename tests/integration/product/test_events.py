"""Integration Tests — Events Domain

P0-B: Event lifecycle, RSVP, feed, validation, auth guards.
Uses product_user_a for event creation.
"""
import pytest
import requests
from datetime import datetime, timedelta
from tests.conftest import _next_test_ip, _make_headers, auth_header

pytestmark = pytest.mark.integration


def create_event(api_url, token, title='Test Event 4B', ip=None, **kwargs):
    h = auth_header(token, ip=ip or _next_test_ip())
    start = (datetime.utcnow() + timedelta(days=7)).isoformat() + 'Z'
    payload = {'title': title, 'startAt': start, 'category': 'SOCIAL', **kwargs}
    resp = requests.post(f'{api_url}/events', json=payload, headers=h)
    return resp, resp.json()


def rsvp_event(api_url, event_id, token, status='GOING', ip=None):
    h = auth_header(token, ip=ip or _next_test_ip())
    resp = requests.post(f'{api_url}/events/{event_id}/rsvp', json={'status': status}, headers=h)
    return resp, resp.json()


def cancel_rsvp(api_url, event_id, token, ip=None):
    h = auth_header(token, ip=ip or _next_test_ip())
    return requests.delete(f'{api_url}/events/{event_id}/rsvp', headers=h)


class TestCreateEvent:
    def test_create_event_success(self, api_url, product_user_a):
        resp, data = create_event(api_url, product_user_a['token'])
        assert resp.status_code == 201, f'Expected 201: {data}'
        event = data['event']
        assert event['title'] == 'Test Event 4B'
        assert event['category'] == 'SOCIAL'
        assert event['status'] == 'PUBLISHED'
        assert event['goingCount'] == 0

    def test_create_event_contract_shape(self, api_url, product_user_a):
        resp, data = create_event(api_url, product_user_a['token'], title='Shape check')
        assert resp.status_code == 201
        event = data['event']
        for field in ['id', 'creatorId', 'title', 'category', 'status', 'startAt',
                      'goingCount', 'interestedCount', 'createdAt']:
            assert field in event, f'Missing field: {field}'
        assert '_id' not in event

    def test_create_event_missing_title_rejected(self, api_url, product_user_a):
        h = auth_header(product_user_a['token'], ip=_next_test_ip())
        start = (datetime.utcnow() + timedelta(days=7)).isoformat() + 'Z'
        resp = requests.post(f'{api_url}/events', json={'startAt': start}, headers=h)
        assert resp.status_code == 400
        assert resp.json()['code'] == 'VALIDATION_ERROR'

    def test_create_event_invalid_category_rejected(self, api_url, product_user_a):
        resp, data = create_event(api_url, product_user_a['token'], title='Bad cat', category='INVALID')
        assert resp.status_code == 400
        assert data['code'] == 'VALIDATION_ERROR'

    def test_create_event_no_auth_blocked(self, api_url):
        h = _make_headers()
        start = (datetime.utcnow() + timedelta(days=7)).isoformat() + 'Z'
        resp = requests.post(f'{api_url}/events', json={'title': 'Fail', 'startAt': start}, headers=h)
        assert resp.status_code == 401


class TestGetEvent:
    def test_get_event_detail(self, api_url, product_user_a):
        _, created = create_event(api_url, product_user_a['token'], title='Detail test')
        event_id = created['event']['id']
        h = auth_header(product_user_a['token'], ip=_next_test_ip())
        resp = requests.get(f'{api_url}/events/{event_id}', headers=h)
        assert resp.status_code == 200
        assert resp.json()['event']['id'] == event_id

    def test_get_nonexistent_event_404(self, api_url, product_user_a):
        h = auth_header(product_user_a['token'], ip=_next_test_ip())
        resp = requests.get(f'{api_url}/events/fake-event-id', headers=h)
        assert resp.status_code == 404


class TestEventRSVP:
    def test_rsvp_going_success(self, api_url, product_user_a, product_user_b):
        _, created = create_event(api_url, product_user_a['token'], title='RSVP test')
        event_id = created['event']['id']
        resp, data = rsvp_event(api_url, event_id, product_user_b['token'], 'GOING')
        assert resp.status_code == 200
        assert data['rsvp']['status'] == 'GOING'

    def test_rsvp_interested_success(self, api_url, product_user_a, product_user_b):
        _, created = create_event(api_url, product_user_a['token'], title='Interested')
        event_id = created['event']['id']
        resp, data = rsvp_event(api_url, event_id, product_user_b['token'], 'INTERESTED')
        assert resp.status_code == 200
        assert data['rsvp']['status'] == 'INTERESTED'

    def test_rsvp_duplicate_idempotent(self, api_url, product_user_a, product_user_b):
        _, created = create_event(api_url, product_user_a['token'], title='Dup RSVP')
        event_id = created['event']['id']
        rsvp_event(api_url, event_id, product_user_b['token'], 'GOING')
        resp, data = rsvp_event(api_url, event_id, product_user_b['token'], 'GOING')
        assert resp.status_code == 200
        assert data['rsvp']['status'] == 'GOING'

    def test_rsvp_invalid_status_rejected(self, api_url, product_user_a, product_user_b):
        _, created = create_event(api_url, product_user_a['token'], title='Bad RSVP')
        event_id = created['event']['id']
        h = auth_header(product_user_b['token'], ip=_next_test_ip())
        resp = requests.post(f'{api_url}/events/{event_id}/rsvp', json={'status': 'MAYBE'}, headers=h)
        assert resp.status_code == 400

    def test_rsvp_nonexistent_event_404(self, api_url, product_user_b):
        resp, data = rsvp_event(api_url, 'fake-event-id', product_user_b['token'])
        assert resp.status_code == 404

    def test_cancel_rsvp_success(self, api_url, product_user_a, product_user_b):
        _, created = create_event(api_url, product_user_a['token'], title='Cancel RSVP')
        event_id = created['event']['id']
        rsvp_event(api_url, event_id, product_user_b['token'], 'GOING')
        resp = cancel_rsvp(api_url, event_id, product_user_b['token'])
        assert resp.status_code == 200

    def test_cancel_rsvp_without_existing_404(self, api_url, product_user_a, product_user_b):
        _, created = create_event(api_url, product_user_a['token'], title='No RSVP cancel')
        event_id = created['event']['id']
        resp = cancel_rsvp(api_url, event_id, product_user_b['token'])
        assert resp.status_code == 404

    def test_rsvp_updates_count(self, api_url, product_user_a, product_user_b):
        """RSVP GOING should increment goingCount."""
        _, created = create_event(api_url, product_user_a['token'], title='Count RSVP')
        event_id = created['event']['id']
        resp, data = rsvp_event(api_url, event_id, product_user_b['token'], 'GOING')
        assert resp.status_code == 200
        assert data['rsvp']['goingCount'] >= 1

    def test_rsvp_no_auth_blocked(self, api_url, product_user_b):
        """Use product_user_b for event creation to avoid product_user_a's 10/hr limit."""
        resp, data = create_event(api_url, product_user_b['token'], title='Auth RSVP')
        assert resp.status_code == 201, f'Event creation failed: {data}'
        h = _make_headers()
        resp = requests.post(f'{api_url}/events/{data["event"]["id"]}/rsvp',
                             json={'status': 'GOING'}, headers=h)
        assert resp.status_code == 401


class TestEventFeed:
    def test_event_feed_requires_auth(self, api_url):
        h = _make_headers()
        resp = requests.get(f'{api_url}/events/feed', headers=h)
        assert resp.status_code == 401

    def test_event_feed_returns_structure(self, api_url, product_user_a):
        h = auth_header(product_user_a['token'], ip=_next_test_ip())
        resp = requests.get(f'{api_url}/events/feed', headers=h)
        assert resp.status_code == 200
        data = resp.json()
        assert 'items' in data
        assert 'pagination' in data
