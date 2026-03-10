"""Stage 4C — P0-B: Visibility + Permission Matrix

Proves that every role boundary and content-state gate is enforced correctly.
This is AUTHORIZATION TRUTH testing — not endpoint coverage.

Five dimensions tested:
  1. Anonymous access matrix (reads allowed, writes denied)
  2. Age-gate matrix (UNKNOWN blocked from posting, CHILD restricted from media)
  3. Role-gate matrix (USER vs ADMIN vs BOARD_MEMBER)
  4. Ownership enforcement (only owner or admin can mutate)
  5. Content-state visibility matrix (DRAFT, HELD, REMOVED, CANCELLED)
"""
import pytest
import requests as req
from datetime import datetime, timezone, timedelta
from tests.helpers.product import (
    create_post, get_post, like_post, create_comment,
    create_event, get_event, rsvp_event,
    create_resource, get_resource, vote_resource, search_resources,
    create_notice, get_notice, acknowledge_notice, get_college_notices,
    seed_reel, get_reel, like_reel,
    follow_user, get_feed,
)
from tests.conftest import _next_test_ip, _make_headers, auth_header

pytestmark = pytest.mark.integration

PERM_COLLEGE = 'permission-college-4c'


@pytest.fixture(scope='module', autouse=True)
def setup_permission_college(db, permission_user_a, permission_user_b):
    """Ensure college exists and permission users are assigned to it."""
    db.colleges.update_one(
        {'id': PERM_COLLEGE},
        {'$setOnInsert': {'id': PERM_COLLEGE, 'name': 'Permission Test College'}},
        upsert=True
    )
    for user in [permission_user_a, permission_user_b]:
        db.users.update_one({'id': user['userId']},
                            {'$set': {'collegeId': PERM_COLLEGE}})
    yield
    db.colleges.delete_one({'id': PERM_COLLEGE})


# ═══════════════════════════════════════════════════════════════════
# DIMENSION 1: ANONYMOUS ACCESS MATRIX
# ═══════════════════════════════════════════════════════════════════

class TestAnonymousReadAccess:
    """Anonymous (no token) CAN read public surfaces."""

    def test_anon_can_view_public_feed(self, api_url):
        h = _make_headers()
        resp = req.get(f'{api_url}/feed/public', headers=h)
        assert resp.status_code == 200, f'Anon public feed denied: {resp.status_code}'

    def test_anon_can_search_events(self, api_url):
        h = _make_headers()
        resp = req.get(f'{api_url}/events/search', headers=h)
        assert resp.status_code == 200, f'Anon event search denied: {resp.status_code}'

    def test_anon_can_search_resources(self, api_url):
        _, data = search_resources(api_url)
        assert 'items' in data, 'Anon resource search failed'

    def test_anon_can_view_college_notices(self, api_url):
        _, data = get_college_notices(api_url, PERM_COLLEGE)
        assert isinstance(data.get('items', data), list) or 'items' in data

    def test_anon_can_view_post_detail(self, api_url, permission_user_a):
        """Anon can view a specific public post."""
        _, created = create_post(api_url, permission_user_a['token'], 'Anon viewable post')
        post_id = created['post']['id']
        resp, detail = get_post(api_url, post_id)  # No token
        assert resp.status_code == 200, f'Anon post detail denied: {resp.status_code}'

    def test_anon_can_view_event_detail(self, api_url, permission_user_a):
        """Anon can view a specific published event."""
        _, created = create_event(api_url, permission_user_a['token'], title='Anon viewable event')
        event_id = created['event']['id']
        resp, _ = get_event(api_url, event_id)  # No token
        assert resp.status_code == 200, f'Anon event detail denied: {resp.status_code}'

    def test_anon_can_view_resource_detail(self, api_url, permission_user_a):
        """Anon can view a specific resource."""
        _, created = create_resource(api_url, permission_user_a['token'],
                                     title='Anon viewable resource', college_id=PERM_COLLEGE)
        assert 'resource' in created, f'Resource creation failed: {created}'
        resource_id = created['resource']['id']
        resp, _ = get_resource(api_url, resource_id)  # No token
        assert resp.status_code == 200, f'Anon resource detail denied: {resp.status_code}'


class TestAnonymousWriteDenied:
    """Anonymous CANNOT perform any write actions — all must return 401."""

    def test_anon_cannot_create_post(self, api_url):
        h = _make_headers()
        resp = req.post(f'{api_url}/content/posts', json={'caption': 'anon'}, headers=h)
        assert resp.status_code == 401

    def test_anon_cannot_like_post(self, api_url, permission_user_a):
        _, created = create_post(api_url, permission_user_a['token'], 'Like target')
        post_id = created['post']['id']
        h = _make_headers()
        resp = req.post(f'{api_url}/content/{post_id}/like', headers=h)
        assert resp.status_code == 401

    def test_anon_cannot_comment(self, api_url, permission_user_a):
        _, created = create_post(api_url, permission_user_a['token'], 'Comment target')
        post_id = created['post']['id']
        h = _make_headers()
        resp = req.post(f'{api_url}/content/{post_id}/comments',
                        json={'body': 'anon comment'}, headers=h)
        assert resp.status_code == 401

    def test_anon_cannot_follow(self, api_url, permission_user_a):
        h = _make_headers()
        resp = req.post(f'{api_url}/follow/{permission_user_a["userId"]}', headers=h)
        assert resp.status_code == 401

    def test_anon_cannot_create_event(self, api_url):
        h = _make_headers()
        start = (datetime.utcnow() + timedelta(days=7)).isoformat() + 'Z'
        resp = req.post(f'{api_url}/events',
                        json={'title': 'anon event', 'startAt': start, 'category': 'SOCIAL'}, headers=h)
        assert resp.status_code == 401

    def test_anon_cannot_rsvp_event(self, api_url, permission_user_a):
        _, created = create_event(api_url, permission_user_a['token'], title='RSVP target')
        event_id = created['event']['id']
        h = _make_headers()
        resp = req.post(f'{api_url}/events/{event_id}/rsvp',
                        json={'status': 'GOING'}, headers=h)
        assert resp.status_code == 401

    def test_anon_cannot_create_resource(self, api_url):
        h = _make_headers()
        resp = req.post(f'{api_url}/resources',
                        json={'title': 'anon res', 'kind': 'PYQ'}, headers=h)
        assert resp.status_code == 401

    def test_anon_cannot_vote_resource(self, api_url, permission_user_a):
        _, created = create_resource(api_url, permission_user_a['token'],
                                     title='Vote target', college_id=PERM_COLLEGE)
        assert 'resource' in created
        resource_id = created['resource']['id']
        h = _make_headers()
        resp = req.post(f'{api_url}/resources/{resource_id}/vote',
                        json={'vote': 'UP'}, headers=h)
        assert resp.status_code == 401

    def test_anon_cannot_create_notice(self, api_url):
        h = _make_headers()
        resp = req.post(f'{api_url}/board/notices',
                        json={'title': 'anon notice', 'body': 'x', 'category': 'GENERAL'}, headers=h)
        assert resp.status_code == 401

    def test_anon_cannot_like_reel(self, api_url, db, permission_user_a):
        reel_id = seed_reel(db, permission_user_a['userId'])
        h = _make_headers()
        resp = req.post(f'{api_url}/reels/{reel_id}/like', headers=h)
        assert resp.status_code == 401
        db.reels.delete_one({'id': reel_id})


# ═══════════════════════════════════════════════════════════════════
# DIMENSION 2: AGE-GATE MATRIX
# ═══════════════════════════════════════════════════════════════════

class TestAgeGateRestrictions:
    """Users with ageStatus=UNKNOWN or CHILD have restricted capabilities."""

    @pytest.fixture(scope='class')
    def child_user(self, api_url, db):
        """A CHILD user — can post text but NOT media/reels/stories."""
        from tests.conftest import _register_or_login, _next_phone
        user = _register_or_login(api_url, _next_phone(40), display_name='Child Permission User')
        db.users.update_one({'id': user['userId']}, {'$set': {'ageStatus': 'CHILD'}})
        return user

    @pytest.fixture(scope='class')
    def unknown_age_user(self, api_url, db):
        """A user with ageStatus=UNKNOWN — blocked from posting entirely."""
        from tests.conftest import _register_or_login, _next_phone
        user = _register_or_login(api_url, _next_phone(41), display_name='Unknown Age User')
        db.users.update_one({'id': user['userId']}, {'$set': {'ageStatus': 'UNKNOWN'}})
        return user

    def test_unknown_age_cannot_create_post(self, api_url, unknown_age_user):
        """ageStatus=UNKNOWN → 403 AGE_REQUIRED on post creation."""
        h = auth_header(unknown_age_user['token'], ip=_next_test_ip())
        resp = req.post(f'{api_url}/content/posts',
                        json={'caption': 'unknown age post'}, headers=h)
        assert resp.status_code == 403
        assert resp.json().get('code') == 'AGE_REQUIRED'

    def test_child_can_create_text_post(self, api_url, child_user):
        """CHILD can create text-only posts."""
        h = auth_header(child_user['token'], ip=_next_test_ip())
        resp = req.post(f'{api_url}/content/posts',
                        json={'caption': 'child text post'}, headers=h)
        assert resp.status_code == 201, f'Child text post failed: {resp.status_code} {resp.text[:100]}'

    def test_child_cannot_create_reel(self, api_url, child_user):
        """CHILD → 403 CHILD_RESTRICTED on reel creation."""
        h = auth_header(child_user['token'], ip=_next_test_ip())
        resp = req.post(f'{api_url}/content/posts',
                        json={'caption': 'child reel', 'kind': 'REEL', 'mediaIds': ['fake']}, headers=h)
        assert resp.status_code == 403
        assert resp.json().get('code') == 'CHILD_RESTRICTED'

    def test_child_cannot_create_story(self, api_url, child_user):
        """CHILD → 403 CHILD_RESTRICTED on story creation."""
        h = auth_header(child_user['token'], ip=_next_test_ip())
        resp = req.post(f'{api_url}/content/posts',
                        json={'caption': 'child story', 'kind': 'STORY', 'mediaIds': ['fake']}, headers=h)
        assert resp.status_code == 403
        assert resp.json().get('code') == 'CHILD_RESTRICTED'

    def test_child_cannot_create_media_post(self, api_url, child_user):
        """CHILD → 403 CHILD_RESTRICTED on media post creation."""
        h = auth_header(child_user['token'], ip=_next_test_ip())
        resp = req.post(f'{api_url}/content/posts',
                        json={'caption': 'child media', 'mediaIds': ['fake']}, headers=h)
        assert resp.status_code == 403
        assert resp.json().get('code') == 'CHILD_RESTRICTED'


# ═══════════════════════════════════════════════════════════════════
# DIMENSION 3: ROLE-GATE MATRIX
# ═══════════════════════════════════════════════════════════════════

class TestRoleGateMatrix:
    """Tests boundaries between USER and ADMIN roles."""

    def test_regular_user_cannot_create_notice(self, api_url, permission_user_a):
        """Regular USER → 403 on board notice creation."""
        h = auth_header(permission_user_a['token'], ip=_next_test_ip())
        resp = req.post(f'{api_url}/board/notices',
                        json={'title': 'User notice', 'body': 'test', 'category': 'GENERAL'},
                        headers=h)
        assert resp.status_code == 403

    def test_admin_can_create_notice(self, api_url, permission_admin, db):
        """ADMIN → 201 on board notice creation."""
        db.users.update_one({'id': permission_admin['userId']},
                            {'$set': {'collegeId': PERM_COLLEGE}})
        _, data = create_notice(api_url, permission_admin['token'], title='Admin perm notice')
        assert 'notice' in data, f'Admin notice creation failed: {data}'

    def test_admin_can_delete_any_post(self, api_url, permission_user_a, permission_admin):
        """ADMIN can delete any user's post."""
        _, created = create_post(api_url, permission_user_a['token'], 'Admin deletable')
        post_id = created['post']['id']
        h = auth_header(permission_admin['token'], ip=_next_test_ip())
        resp = req.delete(f'{api_url}/content/{post_id}', headers=h)
        assert resp.status_code in (200, 204), f'Admin delete failed: {resp.status_code}'

    def test_regular_user_cannot_delete_others_post(self, api_url, permission_user_a, permission_user_b):
        """Regular USER → 403 when deleting another user's post."""
        _, created = create_post(api_url, permission_user_a['token'], 'Not yours to delete')
        post_id = created['post']['id']
        h = auth_header(permission_user_b['token'], ip=_next_test_ip())
        resp = req.delete(f'{api_url}/content/{post_id}', headers=h)
        assert resp.status_code == 403

    def test_regular_user_cannot_pin_notice(self, api_url, permission_admin, permission_user_b, db):
        """Regular USER → 403 on notice pin."""
        db.users.update_one({'id': permission_admin['userId']},
                            {'$set': {'collegeId': PERM_COLLEGE}})
        _, created = create_notice(api_url, permission_admin['token'], title='Pin target notice')
        notice_id = created['notice']['id']
        h = auth_header(permission_user_b['token'], ip=_next_test_ip())
        resp = req.post(f'{api_url}/board/notices/{notice_id}/pin', headers=h)
        assert resp.status_code == 403


# ═══════════════════════════════════════════════════════════════════
# DIMENSION 4: OWNERSHIP ENFORCEMENT
# ═══════════════════════════════════════════════════════════════════

class TestOwnershipEnforcement:
    """Only the owner (or admin) can mutate their own entities."""

    def test_owner_can_delete_own_post(self, api_url, permission_user_a):
        """Owner → 200 on deleting their own post."""
        _, created = create_post(api_url, permission_user_a['token'], 'My post to delete')
        post_id = created['post']['id']
        h = auth_header(permission_user_a['token'], ip=_next_test_ip())
        resp = req.delete(f'{api_url}/content/{post_id}', headers=h)
        assert resp.status_code in (200, 204)

    def test_non_owner_cannot_update_event(self, api_url, permission_user_a, permission_user_b):
        """Non-owner → 403 on updating another user's event."""
        _, created = create_event(api_url, permission_user_a['token'], title='Not your event')
        event_id = created['event']['id']
        h = auth_header(permission_user_b['token'], ip=_next_test_ip())
        resp = req.patch(f'{api_url}/events/{event_id}',
                         json={'title': 'Hijacked'}, headers=h)
        assert resp.status_code == 403

    def test_non_owner_cannot_delete_event(self, api_url, permission_user_a, permission_user_b):
        """Non-owner → 403 on deleting another user's event."""
        _, created = create_event(api_url, permission_user_a['token'], title='Not your event to delete')
        event_id = created['event']['id']
        h = auth_header(permission_user_b['token'], ip=_next_test_ip())
        resp = req.delete(f'{api_url}/events/{event_id}', headers=h)
        assert resp.status_code == 403

    def test_non_owner_cannot_update_resource(self, api_url, permission_user_a, permission_user_b):
        """Non-owner → 403 on updating another user's resource."""
        _, created = create_resource(api_url, permission_user_a['token'],
                                     title='Not your resource', college_id=PERM_COLLEGE)
        assert 'resource' in created
        resource_id = created['resource']['id']
        h = auth_header(permission_user_b['token'], ip=_next_test_ip())
        resp = req.patch(f'{api_url}/resources/{resource_id}',
                         json={'title': 'Hijacked'}, headers=h)
        assert resp.status_code == 403

    def test_non_owner_cannot_delete_resource(self, api_url, permission_user_a, permission_user_b):
        """Non-owner → 403 on deleting another user's resource."""
        _, created = create_resource(api_url, permission_user_a['token'],
                                     title='Not your resource to delete', college_id=PERM_COLLEGE)
        assert 'resource' in created
        resource_id = created['resource']['id']
        h = auth_header(permission_user_b['token'], ip=_next_test_ip())
        resp = req.delete(f'{api_url}/resources/{resource_id}', headers=h)
        assert resp.status_code == 403

    def test_self_vote_resource_forbidden(self, api_url, permission_user_a):
        """Owner cannot vote on their own resource → 403."""
        _, created = create_resource(api_url, permission_user_a['token'],
                                     title='Self vote target', college_id=PERM_COLLEGE)
        assert 'resource' in created
        resource_id = created['resource']['id']
        resp, data = vote_resource(api_url, resource_id, permission_user_a['token'], 'UP')
        assert resp.status_code == 403

    def test_self_like_reel_forbidden(self, api_url, db, permission_user_a):
        """Owner cannot like their own reel → 400."""
        reel_id = seed_reel(db, permission_user_a['userId'])
        resp, _ = like_reel(api_url, reel_id, permission_user_a['token'])
        assert resp.status_code == 400
        db.reels.delete_one({'id': reel_id})


# ═══════════════════════════════════════════════════════════════════
# DIMENSION 5: CONTENT-STATE VISIBILITY MATRIX
# ═══════════════════════════════════════════════════════════════════

class TestContentStateVisibility:
    """Content in non-active states must be correctly gated."""

    # -- Posts --
    def test_removed_post_returns_404(self, api_url, permission_user_a):
        """REMOVED post → 404 on detail."""
        _, created = create_post(api_url, permission_user_a['token'], 'Will be removed')
        post_id = created['post']['id']
        from tests.helpers.product import delete_post
        delete_post(api_url, post_id, permission_user_a['token'])
        resp, _ = get_post(api_url, post_id, permission_user_a['token'])
        assert resp.status_code == 404

    def test_held_post_not_in_following_feed(self, api_url, permission_user_a, db):
        """HELD post → absent from following feed."""
        _, created = create_post(api_url, permission_user_a['token'], 'Will be held')
        post_id = created['post']['id']
        db.content_items.update_one({'id': post_id}, {'$set': {'visibility': 'HELD'}})
        _, feed = get_feed(api_url, 'following', token=permission_user_a['token'])
        feed_ids = [p['id'] for p in feed['items']]
        assert post_id not in feed_ids, 'HELD post should not appear in feed'

    # -- Events --
    def test_draft_event_invisible_to_non_creator(self, api_url, permission_user_a, permission_user_b, db):
        """DRAFT event → 404 for non-creator."""
        _, created = create_event(api_url, permission_user_a['token'], title='Draft event')
        event_id = created['event']['id']
        db.events.update_one({'id': event_id}, {'$set': {'status': 'DRAFT'}})
        resp, _ = get_event(api_url, event_id, permission_user_b['token'])
        assert resp.status_code == 404, f'DRAFT event visible to non-creator: {resp.status_code}'

    def test_draft_event_visible_to_creator(self, api_url, permission_user_a, db):
        """DRAFT event → 200 for creator."""
        _, created = create_event(api_url, permission_user_a['token'], title='My draft event')
        event_id = created['event']['id']
        db.events.update_one({'id': event_id}, {'$set': {'status': 'DRAFT'}})
        resp, _ = get_event(api_url, event_id, permission_user_a['token'])
        assert resp.status_code == 200, f'Creator cannot see own DRAFT event: {resp.status_code}'

    def test_cancelled_event_still_accessible(self, api_url, permission_user_a, db):
        """CANCELLED event → 200 on detail (informational, not deleted)."""
        _, created = create_event(api_url, permission_user_a['token'], title='Cancelled event')
        event_id = created['event']['id']
        db.events.update_one({'id': event_id}, {'$set': {'status': 'CANCELLED'}})
        resp, data = get_event(api_url, event_id, permission_user_a['token'])
        assert resp.status_code == 200
        assert data['event']['status'] == 'CANCELLED'

    def test_removed_event_returns_410(self, api_url, permission_user_a, db):
        """REMOVED event → 410 Gone."""
        _, created = create_event(api_url, permission_user_a['token'], title='Removed event')
        event_id = created['event']['id']
        db.events.update_one({'id': event_id}, {'$set': {'status': 'REMOVED'}})
        resp, _ = get_event(api_url, event_id, permission_user_a['token'])
        assert resp.status_code == 410

    # -- Resources --
    def test_removed_resource_returns_410(self, api_url, permission_user_a, db):
        """REMOVED resource → 410 Gone."""
        _, created = create_resource(api_url, permission_user_a['token'],
                                     title='Removed resource', college_id=PERM_COLLEGE)
        assert 'resource' in created
        resource_id = created['resource']['id']
        db.resources.update_one({'id': resource_id}, {'$set': {'status': 'REMOVED'}})
        resp, _ = get_resource(api_url, resource_id, permission_user_a['token'])
        assert resp.status_code == 410

    # -- Notices --
    def test_removed_notice_returns_410(self, api_url, permission_admin, db):
        """REMOVED notice → 410 Gone."""
        db.users.update_one({'id': permission_admin['userId']},
                            {'$set': {'collegeId': PERM_COLLEGE}})
        _, created = create_notice(api_url, permission_admin['token'], title='Removed notice')
        notice_id = created['notice']['id']
        db.board_notices.update_one({'id': notice_id}, {'$set': {'status': 'REMOVED'}})
        resp, _ = get_notice(api_url, notice_id, permission_admin['token'])
        assert resp.status_code == 410

    # -- Reels --
    def test_removed_reel_not_accessible(self, api_url, db, permission_user_a):
        """REMOVED reel → 404/410 on detail."""
        reel_id = seed_reel(db, permission_user_a['userId'], status='REMOVED')
        resp, _ = get_reel(api_url, reel_id, permission_user_a['token'])
        assert resp.status_code in (404, 410), f'REMOVED reel accessible: {resp.status_code}'
        db.reels.delete_one({'id': reel_id})

    def test_banned_user_cannot_login(self, api_url, db):
        """Banned user → 403 on login (cannot access anything)."""
        from tests.conftest import _register_or_login, _next_phone
        user = _register_or_login(api_url, _next_phone(42), display_name='Ban Target')
        db.users.update_one({'id': user['userId']}, {'$set': {'isBanned': True}})
        h = _make_headers()
        resp = req.post(f'{api_url}/auth/login',
                        json={'phone': user['phone'], 'pin': '1234'}, headers=h)
        assert resp.status_code == 403, f'Banned user could login: {resp.status_code}'
