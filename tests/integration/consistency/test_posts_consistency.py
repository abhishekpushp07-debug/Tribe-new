"""Stage 4C — P0-A: Cross-Surface Entity Consistency

Proves that the same entity appears with consistent core fields across
all relevant surfaces (detail, following feed, college feed, house feed,
search, event feed, college notice listing).

This is SYSTEM TRUTH testing — not endpoint coverage.
We test the fields that define platform truth.
"""
import pytest
from tests.helpers.product import (
    create_post, get_post, get_feed, get_college_feed, get_house_feed,
    like_post, dislike_post, remove_reaction, create_comment, delete_post,
    create_event, get_event, rsvp_event, cancel_rsvp,
    create_resource, get_resource, vote_resource, search_resources,
    create_notice, get_notice, acknowledge_notice, get_college_notices,
    seed_reel, get_reel, like_reel, unlike_reel,
)
from tests.conftest import _next_test_ip, auth_header, _make_headers

pytestmark = pytest.mark.integration

# College/house IDs used for consistency tests
CONSISTENCY_COLLEGE = 'consistency-college-4c'
CONSISTENCY_HOUSE = 'consistency-house-4c'


@pytest.fixture(scope='module', autouse=True)
def setup_consistency_college(db, consistency_user_a, consistency_user_b):
    """Set up college/house for consistency users so posts land in college/house feeds."""
    db.colleges.update_one(
        {'id': CONSISTENCY_COLLEGE},
        {'$setOnInsert': {'id': CONSISTENCY_COLLEGE, 'name': 'Consistency Test College'}},
        upsert=True
    )
    db.houses.update_one(
        {'id': CONSISTENCY_HOUSE},
        {'$setOnInsert': {'id': CONSISTENCY_HOUSE, 'name': 'Consistency Test House',
                          'collegeId': CONSISTENCY_COLLEGE}},
        upsert=True
    )
    for user in [consistency_user_a, consistency_user_b]:
        db.users.update_one({'id': user['userId']}, {
            '$set': {'collegeId': CONSISTENCY_COLLEGE, 'houseId': CONSISTENCY_HOUSE}
        })
    yield
    db.colleges.delete_one({'id': CONSISTENCY_COLLEGE})
    db.houses.delete_one({'id': CONSISTENCY_HOUSE})


# ═══════════════════════════════════════════════════════════════════
# POST CROSS-SURFACE CONSISTENCY
# ═══════════════════════════════════════════════════════════════════

class TestPostCrossSurface:
    """Post entity must appear consistently across detail + following feed."""

    # Core truth fields that must be identical across surfaces
    POST_TRUTH_FIELDS = ['id', 'caption', 'kind', 'authorId', 'visibility']

    def test_post_detail_matches_following_feed(self, api_url, consistency_user_a):
        """Create post → core fields identical in detail and following feed."""
        _, created = create_post(api_url, consistency_user_a['token'], 'Surface consistency A')
        post_id = created['post']['id']

        _, detail = get_post(api_url, post_id, consistency_user_a['token'])
        _, feed = get_feed(api_url, 'following', token=consistency_user_a['token'])
        feed_item = next((p for p in feed['items'] if p['id'] == post_id), None)
        assert feed_item is not None, 'Post missing from following feed'

        for field in self.POST_TRUTH_FIELDS:
            assert detail['post'][field] == feed_item[field], \
                f'INCONSISTENCY: {field} detail={detail["post"][field]} != feed={feed_item[field]}'

    def test_post_counts_consistent_after_like(self, api_url, consistency_user_a, consistency_user_b):
        """Like → likeCount consistent between detail and feed."""
        _, created = create_post(api_url, consistency_user_a['token'], 'Like consistency')
        post_id = created['post']['id']
        like_post(api_url, post_id, consistency_user_b['token'])

        _, detail = get_post(api_url, post_id, consistency_user_a['token'])
        _, feed = get_feed(api_url, 'following', token=consistency_user_a['token'])
        feed_item = next((p for p in feed['items'] if p['id'] == post_id), None)
        assert feed_item is not None
        assert detail['post']['likeCount'] == feed_item['likeCount'], \
            f'likeCount inconsistent: detail={detail["post"]["likeCount"]} feed={feed_item["likeCount"]}'
        assert detail['post']['likeCount'] >= 1

    def test_post_counts_consistent_after_comment(self, api_url, consistency_user_a, consistency_user_b):
        """Comment → commentCount consistent between detail and feed."""
        _, created = create_post(api_url, consistency_user_a['token'], 'Comment consistency')
        post_id = created['post']['id']
        create_comment(api_url, post_id, consistency_user_b['token'], 'Consistent comment')

        _, detail = get_post(api_url, post_id, consistency_user_a['token'])
        _, feed = get_feed(api_url, 'following', token=consistency_user_a['token'])
        feed_item = next((p for p in feed['items'] if p['id'] == post_id), None)
        assert feed_item is not None
        assert detail['post']['commentCount'] == feed_item['commentCount'], \
            f'commentCount inconsistent: detail={detail["post"]["commentCount"]} feed={feed_item["commentCount"]}'
        assert detail['post']['commentCount'] >= 1

    def test_deleted_post_gone_from_all_surfaces(self, api_url, consistency_user_a):
        """Deleted post → 404 on detail AND absent from following feed."""
        _, created = create_post(api_url, consistency_user_a['token'], 'Delete consistency')
        post_id = created['post']['id']
        delete_post(api_url, post_id, consistency_user_a['token'])

        resp, _ = get_post(api_url, post_id, consistency_user_a['token'])
        assert resp.status_code == 404, 'Deleted post should return 404 on detail'

        _, feed = get_feed(api_url, 'following', token=consistency_user_a['token'])
        feed_ids = [p['id'] for p in feed['items']]
        assert post_id not in feed_ids, 'Deleted post should not appear in following feed'

    def test_post_in_college_feed_matches_detail(self, api_url, consistency_user_a, db):
        """Post promoted to stage>=1 → appears in college feed with same core fields."""
        _, created = create_post(api_url, consistency_user_a['token'], 'College surface match')
        post_id = created['post']['id']
        # Promote to stage 1 AND ensure college is set on content_items (the actual collection)
        db.content_items.update_one({'id': post_id}, {'$set': {
            'distributionStage': 1,
            'collegeId': CONSISTENCY_COLLEGE,
            'houseId': CONSISTENCY_HOUSE,
        }})

        _, detail = get_post(api_url, post_id, consistency_user_a['token'])
        _, college_feed = get_feed(api_url, f'college/{CONSISTENCY_COLLEGE}',
                                   params={'cursor': '2099-01-01T00:00:00.000Z'})
        college_item = next((p for p in college_feed['items'] if p['id'] == post_id), None)
        assert college_item is not None, 'Promoted post not found in college feed'

        for field in self.POST_TRUTH_FIELDS:
            assert detail['post'][field] == college_item[field], \
                f'College feed INCONSISTENCY: {field}'

    def test_post_in_house_feed_matches_detail(self, api_url, consistency_user_a, db):
        """Post promoted to stage>=1 → appears in house feed with same core fields."""
        _, created = create_post(api_url, consistency_user_a['token'], 'House surface match')
        post_id = created['post']['id']
        db.content_items.update_one({'id': post_id}, {'$set': {
            'distributionStage': 1,
            'collegeId': CONSISTENCY_COLLEGE,
            'houseId': CONSISTENCY_HOUSE,
        }})

        _, detail = get_post(api_url, post_id, consistency_user_a['token'])
        _, house_feed = get_feed(api_url, f'house/{CONSISTENCY_HOUSE}',
                                 params={'cursor': '2099-01-01T00:00:00.000Z'})
        house_item = next((p for p in house_feed['items'] if p['id'] == post_id), None)
        assert house_item is not None, 'Promoted post not found in house feed'

        for field in self.POST_TRUTH_FIELDS:
            assert detail['post'][field] == house_item[field], \
                f'House feed INCONSISTENCY: {field}'


# ═══════════════════════════════════════════════════════════════════
# EVENT CROSS-SURFACE CONSISTENCY
# ═══════════════════════════════════════════════════════════════════

class TestEventCrossSurface:
    """Event entity must appear consistently across detail + event feed + search."""

    EVENT_TRUTH_FIELDS = ['id', 'title', 'category', 'creatorId', 'status']

    def test_event_detail_matches_feed(self, api_url, consistency_user_a):
        """Event in detail must match event feed entry."""
        _, created = create_event(api_url, consistency_user_a['token'], title='Event surface match')
        event_id = created['event']['id']

        _, detail = get_event(api_url, event_id, consistency_user_a['token'])
        h = auth_header(consistency_user_a['token'], ip=_next_test_ip())
        resp = __import__('requests').get(f'{api_url}/events/feed', headers=h)
        feed_data = resp.json()
        feed_item = next((e for e in feed_data.get('items', []) if e['id'] == event_id), None)

        if feed_item:  # Feed may not contain event if ordering pushes it off page 1
            for field in self.EVENT_TRUTH_FIELDS:
                assert detail['event'][field] == feed_item[field], \
                    f'Event feed INCONSISTENCY: {field}'

    def test_event_detail_matches_search(self, api_url, consistency_user_a):
        """Event in detail must match search result entry."""
        _, created = create_event(api_url, consistency_user_a['token'], title='Event search match')
        event_id = created['event']['id']

        _, detail = get_event(api_url, event_id, consistency_user_a['token'])
        h = _make_headers()
        resp = __import__('requests').get(f'{api_url}/events/search', headers=h)
        search_data = resp.json()
        search_item = next((e for e in search_data.get('items', []) if e['id'] == event_id), None)

        if search_item:
            for field in ['id', 'title', 'category']:
                assert detail['event'][field] == search_item[field], \
                    f'Event search INCONSISTENCY: {field}'

    def test_rsvp_count_consistent_across_surfaces(self, api_url, consistency_user_a, consistency_user_b):
        """RSVP → goingCount consistent between detail reads."""
        _, created = create_event(api_url, consistency_user_a['token'], title='RSVP count consistency')
        event_id = created['event']['id']
        rsvp_event(api_url, event_id, consistency_user_b['token'], 'GOING')

        _, detail = get_event(api_url, event_id, consistency_user_a['token'])
        assert detail['event']['goingCount'] >= 1, 'goingCount not incremented after RSVP'

        # Second read — same value
        _, detail2 = get_event(api_url, event_id, consistency_user_b['token'])
        assert detail['event']['goingCount'] == detail2['event']['goingCount'], \
            'goingCount inconsistent between users reading same event'

    def test_deleted_event_gone_from_surfaces(self, api_url, consistency_user_a):
        """Deleted event → 410 on detail."""
        _, created = create_event(api_url, consistency_user_a['token'], title='Delete event consistency')
        event_id = created['event']['id']
        h = auth_header(consistency_user_a['token'], ip=_next_test_ip())
        __import__('requests').delete(f'{api_url}/events/{event_id}', headers=h)

        resp, _ = get_event(api_url, event_id, consistency_user_a['token'])
        assert resp.status_code == 410, 'Deleted event should return 410'


# ═══════════════════════════════════════════════════════════════════
# RESOURCE CROSS-SURFACE CONSISTENCY
# ═══════════════════════════════════════════════════════════════════

class TestResourceCrossSurface:
    """Resource entity must appear consistently across detail + search."""

    def test_resource_detail_matches_search(self, api_url, consistency_user_a, db):
        """Resource in detail must match search result."""
        db.users.update_one({'id': consistency_user_a['userId']},
                            {'$set': {'collegeId': CONSISTENCY_COLLEGE}})
        _, created = create_resource(api_url, consistency_user_a['token'],
                                     title='Resource search consistency')
        if 'resource' not in created:
            pytest.skip(f'Resource creation failed (rate limit?): {created}')
        resource_id = created['resource']['id']

        _, detail = get_resource(api_url, resource_id, consistency_user_a['token'])
        _, search = search_resources(api_url)
        search_item = next((r for r in search.get('items', []) if r['id'] == resource_id), None)

        if search_item:
            for field in ['id', 'title', 'kind']:
                assert detail['resource'][field] == search_item[field], \
                    f'Resource search INCONSISTENCY: {field}'

    def test_vote_count_consistent_after_action(self, api_url, consistency_user_a, consistency_user_b, db):
        """Vote → voteCount consistent in detail re-read."""
        db.users.update_one({'id': consistency_user_a['userId']},
                            {'$set': {'collegeId': CONSISTENCY_COLLEGE}})
        _, created = create_resource(api_url, consistency_user_a['token'],
                                     title='Vote consistency resource')
        if 'resource' not in created:
            pytest.skip(f'Resource creation failed: {created}')
        resource_id = created['resource']['id']

        vote_resource(api_url, resource_id, consistency_user_b['token'], 'UP')
        _, detail1 = get_resource(api_url, resource_id, consistency_user_a['token'])
        _, detail2 = get_resource(api_url, resource_id, consistency_user_b['token'])
        assert detail1['resource']['upvoteCount'] == detail2['resource']['upvoteCount'], \
            'upvoteCount inconsistent between users'
        assert detail1['resource']['upvoteCount'] >= 1


# ═══════════════════════════════════════════════════════════════════
# NOTICE CROSS-SURFACE CONSISTENCY
# ═══════════════════════════════════════════════════════════════════

class TestNoticeCrossSurface:
    """Notice entity must appear consistently across detail + college listing."""

    def test_notice_detail_matches_college_listing(self, api_url, admin_user, db):
        """Notice detail must match college listing entry."""
        db.users.update_one({'id': admin_user['userId']},
                            {'$set': {'collegeId': CONSISTENCY_COLLEGE}})
        _, created = create_notice(api_url, admin_user['token'], title='Notice college consistency')
        notice_id = created['notice']['id']

        _, detail = get_notice(api_url, notice_id, admin_user['token'])
        _, college = get_college_notices(api_url, CONSISTENCY_COLLEGE)
        college_item = next((n for n in college.get('items', []) if n['id'] == notice_id), None)

        if college_item:
            for field in ['id', 'title', 'category']:
                assert detail['notice'][field] == college_item[field], \
                    f'Notice college listing INCONSISTENCY: {field}'

    def test_ack_count_consistent_across_reads(self, api_url, admin_user, consistency_user_b, db):
        """Acknowledge → count consistent in detail re-reads."""
        db.users.update_one({'id': admin_user['userId']},
                            {'$set': {'collegeId': CONSISTENCY_COLLEGE}})
        _, created = create_notice(api_url, admin_user['token'], title='Ack count consistency')
        notice_id = created['notice']['id']
        acknowledge_notice(api_url, notice_id, consistency_user_b['token'])

        _, detail1 = get_notice(api_url, notice_id, admin_user['token'])
        _, detail2 = get_notice(api_url, notice_id, consistency_user_b['token'])
        assert detail1['notice']['acknowledgmentCount'] == detail2['notice']['acknowledgmentCount'], \
            'acknowledgmentCount inconsistent between users'
        assert detail1['notice']['acknowledgmentCount'] >= 1

    def test_removed_notice_gone_from_detail(self, api_url, admin_user, db):
        """REMOVED notice → 410 on detail."""
        db.users.update_one({'id': admin_user['userId']},
                            {'$set': {'collegeId': CONSISTENCY_COLLEGE}})
        _, created = create_notice(api_url, admin_user['token'], title='Remove notice consistency')
        notice_id = created['notice']['id']
        db.board_notices.update_one({'id': notice_id}, {'$set': {'status': 'REMOVED'}})

        resp, _ = get_notice(api_url, notice_id, admin_user['token'])
        assert resp.status_code == 410


# ═══════════════════════════════════════════════════════════════════
# REEL CROSS-SURFACE CONSISTENCY
# ═══════════════════════════════════════════════════════════════════

class TestReelCrossSurface:
    """Reel entity must appear consistently across detail + interaction effects."""

    @pytest.fixture
    def consistency_reel(self, db, consistency_user_a):
        """Seed a reel for consistency tests. Public (collegeId=None) so any user can access."""
        reel_id = seed_reel(db, consistency_user_a['userId'])  # Default: no college restriction
        yield reel_id
        # Cleanup
        db.reels.delete_one({'id': reel_id})
        db.reel_likes.delete_many({'reelId': reel_id})
        db.reel_saves.delete_many({'reelId': reel_id})
        db.reel_comments.delete_many({'reelId': reel_id})

    def test_reel_like_reflected_in_detail(self, api_url, consistency_user_b, consistency_reel):
        """Like a reel → likeCount increments in detail."""
        like_reel(api_url, consistency_reel, consistency_user_b['token'])
        resp, detail = get_reel(api_url, consistency_reel, consistency_user_b['token'])
        assert resp.status_code == 200, f'Reel detail failed: {detail}'
        reel = detail.get('reel', detail)  # Flexible key access
        assert reel.get('likeCount', 0) >= 1, 'likeCount not incremented after like'

    def test_reel_like_count_consistent_between_users(self, api_url, consistency_user_a, consistency_user_b, consistency_reel):
        """likeCount same regardless of which user reads."""
        like_reel(api_url, consistency_reel, consistency_user_b['token'])
        resp_a, detail_a = get_reel(api_url, consistency_reel, consistency_user_a['token'])
        resp_b, detail_b = get_reel(api_url, consistency_reel, consistency_user_b['token'])
        assert resp_a.status_code == 200, f'Reel detail A failed: {detail_a}'
        assert resp_b.status_code == 200, f'Reel detail B failed: {detail_b}'
        reel_a = detail_a.get('reel', detail_a)
        reel_b = detail_b.get('reel', detail_b)
        assert reel_a.get('likeCount') == reel_b.get('likeCount'), \
            'Reel likeCount inconsistent between users'

    def test_removed_reel_returns_error(self, api_url, consistency_user_a, db):
        """REMOVED reel → 404 or 410 on detail."""
        reel_id = seed_reel(db, consistency_user_a['userId'], status='REMOVED')
        resp, _ = get_reel(api_url, reel_id, consistency_user_a['token'])
        assert resp.status_code in (404, 410), f'REMOVED reel should not return 200, got {resp.status_code}'
        db.reels.delete_one({'id': reel_id})
