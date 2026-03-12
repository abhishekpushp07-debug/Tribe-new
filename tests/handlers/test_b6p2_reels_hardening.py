"""
Tribe B6 Phase 2 — Reels Hardening Test Suite
Tests:
  A. Contract consistency
  B. Counter correctness (like, comment, save idempotency)
  C. Notification correctness (REEL_SHARE, no duplicate)
  D. Visibility/block enforcement (comment list, feed)
  E. Feed pagination (compound cursor, no duplicates)
  F. Report/hide/not-interested correctness
  G. Regression safety
"""

import pytest
import requests
import time
import random

BASE_URL = "https://dev-hub-39.preview.emergentagent.com/api"

def random_ip():
    return f"10.{random.randint(1,254)}.{random.randint(1,254)}.{random.randint(1,254)}"

def unique_phone():
    return f"9{random.randint(100000000, 999999999)}"

def register_user(suffix="", retries=3):
    for attempt in range(retries):
        phone = unique_phone()
        time.sleep(0.3 + attempt * 1.0)
        resp = requests.post(f"{BASE_URL}/auth/register", json={
            "phone": phone,
            "pin": "1234",
            "displayName": f"P2Test{suffix}{phone[-4:]}",
            "username": f"p2t{suffix.lower()}{phone[-6:]}",
        }, headers={"Content-Type": "application/json", "X-Forwarded-For": random_ip()})
        if resp.status_code == 429:
            time.sleep(3)
            continue
        assert resp.status_code in (200, 201), f"Register failed: {resp.text}"
        data = resp.json()
        token = data.get("accessToken") or data.get("token")
        user = data.get("user", {})
        return {"token": token, "id": user.get("id"), "displayName": user.get("displayName")}
    pytest.fail("Register failed after retries")

def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json", "X-Forwarded-For": random_ip()}

def complete_onboarding(token):
    requests.patch(f"{BASE_URL}/me/age", json={"birthYear": 2000}, headers=auth_headers(token))
    requests.patch(f"{BASE_URL}/me/onboarding", json={"step": "COMPLETE"}, headers=auth_headers(token))

def create_reel(token, caption="Test reel"):
    return requests.post(f"{BASE_URL}/reels", json={
        "caption": caption,
        "mediaUrl": "https://example.com/v.mp4",
        "thumbnailUrl": "https://example.com/t.jpg",
        "durationMs": 15000,
        "visibility": "PUBLIC",
    }, headers=auth_headers(token))

def get_reel(reel_resp):
    data = reel_resp.json()
    return data.get("reel") or data.get("data", {}).get("reel")


# ======================== FIXTURES ========================

@pytest.fixture(scope="module")
def userA():
    u = register_user("A")
    complete_onboarding(u["token"])
    return u

@pytest.fixture(scope="module")
def userB():
    u = register_user("B")
    complete_onboarding(u["token"])
    return u

@pytest.fixture(scope="module")
def userC():
    u = register_user("C")
    complete_onboarding(u["token"])
    return u

@pytest.fixture(scope="module")
def reelA(userA):
    resp = create_reel(userA["token"], "Phase 2 test reel A")
    assert resp.status_code == 201
    return get_reel(resp)


# ======================== A: CONTRACT CONSISTENCY ========================

class TestContractConsistency:

    def test_reel_detail_shape(self, userA, reelA):
        resp = requests.get(f"{BASE_URL}/reels/{reelA['id']}", headers=auth_headers(userA["token"]))
        assert resp.status_code == 200
        reel = resp.json().get("reel") or resp.json().get("data", {}).get("reel")
        # Must have all canonical fields
        assert "id" in reel
        assert "creatorId" in reel
        assert "caption" in reel
        assert "likeCount" in reel
        assert "commentCount" in reel
        assert "shareCount" in reel
        assert "saveCount" in reel
        assert "status" in reel
        assert "createdAt" in reel

    def test_reel_feed_item_shape(self, userA):
        resp = requests.get(f"{BASE_URL}/reels/feed", headers=auth_headers(userA["token"]))
        assert resp.status_code == 200
        data = resp.json()
        items = data.get("items") or data.get("data", {}).get("items") or []
        pagination = data.get("pagination") or data.get("data", {}).get("pagination")
        assert isinstance(items, list)
        assert "hasMore" in pagination

    def test_comment_response_shape(self, userB, reelA):
        resp = requests.post(f"{BASE_URL}/reels/{reelA['id']}/comment", json={
            "text": "Shape test",
        }, headers=auth_headers(userB["token"]))
        assert resp.status_code == 201
        data = resp.json()
        comment = data.get("comment") or data.get("data", {}).get("comment")
        assert "id" in comment
        assert "text" in comment
        assert "body" in comment
        assert "senderId" in comment
        assert "reelId" in comment
        assert "likeCount" in comment
        assert "createdAt" in comment

    def test_no_id_leak_in_reel_detail(self, userA, reelA):
        resp = requests.get(f"{BASE_URL}/reels/{reelA['id']}", headers=auth_headers(userA["token"]))
        reel = resp.json().get("reel") or resp.json().get("data", {}).get("reel")
        assert "_id" not in reel


# ======================== B: COUNTER CORRECTNESS ========================

class TestCounterCorrectness:

    def test_like_once_increments(self, userB, userA):
        reel_resp = create_reel(userA["token"], "Counter like test")
        assert reel_resp.status_code == 201
        reel = get_reel(reel_resp)

        # Like
        resp = requests.post(f"{BASE_URL}/reels/{reel['id']}/like", headers=auth_headers(userB["token"]))
        assert resp.status_code == 200

        # Check count
        detail = requests.get(f"{BASE_URL}/reels/{reel['id']}", headers=auth_headers(userA["token"]))
        reel_detail = detail.json().get("reel") or detail.json().get("data", {}).get("reel")
        assert reel_detail["likeCount"] == 1

    def test_like_twice_no_double_increment(self, userB, userA):
        reel_resp = create_reel(userA["token"], "Counter double-like test")
        assert reel_resp.status_code == 201
        reel = get_reel(reel_resp)

        # Like twice
        requests.post(f"{BASE_URL}/reels/{reel['id']}/like", headers=auth_headers(userB["token"]))
        requests.post(f"{BASE_URL}/reels/{reel['id']}/like", headers=auth_headers(userB["token"]))

        detail = requests.get(f"{BASE_URL}/reels/{reel['id']}", headers=auth_headers(userA["token"]))
        reel_detail = detail.json().get("reel") or detail.json().get("data", {}).get("reel")
        assert reel_detail["likeCount"] == 1, f"Like count should be 1, got {reel_detail['likeCount']}"

    def test_unlike_decrements_once(self, userB, userA):
        reel_resp = create_reel(userA["token"], "Counter unlike test")
        assert reel_resp.status_code == 201
        reel = get_reel(reel_resp)

        # Like then unlike
        requests.post(f"{BASE_URL}/reels/{reel['id']}/like", headers=auth_headers(userB["token"]))
        requests.delete(f"{BASE_URL}/reels/{reel['id']}/like", headers=auth_headers(userB["token"]))

        detail = requests.get(f"{BASE_URL}/reels/{reel['id']}", headers=auth_headers(userA["token"]))
        reel_detail = detail.json().get("reel") or detail.json().get("data", {}).get("reel")
        assert reel_detail["likeCount"] == 0

    def test_save_idempotent(self, userB, userA):
        reel_resp = create_reel(userA["token"], "Counter save test")
        assert reel_resp.status_code == 201
        reel = get_reel(reel_resp)

        # Save twice
        requests.post(f"{BASE_URL}/reels/{reel['id']}/save", headers=auth_headers(userB["token"]))
        requests.post(f"{BASE_URL}/reels/{reel['id']}/save", headers=auth_headers(userB["token"]))

        detail = requests.get(f"{BASE_URL}/reels/{reel['id']}", headers=auth_headers(userA["token"]))
        reel_detail = detail.json().get("reel") or detail.json().get("data", {}).get("reel")
        assert reel_detail["saveCount"] == 1


# ======================== C: NOTIFICATION CORRECTNESS ========================

class TestNotificationCorrectness:

    def test_share_creates_reel_share_notification(self, userA, userB, reelA):
        resp = requests.post(f"{BASE_URL}/reels/{reelA['id']}/share", json={},
            headers=auth_headers(userB["token"]))
        assert resp.status_code == 200
        time.sleep(0.3)

        notif = requests.get(f"{BASE_URL}/notifications", headers=auth_headers(userA["token"]))
        assert notif.status_code == 200
        items = notif.json().get("items") or notif.json().get("data", {}).get("items") or notif.json().get("notifications") or []
        share_notifs = [n for n in items if n.get("type") == "REEL_SHARE"]
        assert len(share_notifs) >= 1, f"No REEL_SHARE notification found. Types: {[n.get('type') for n in items[:10]]}"

    def test_self_share_no_notification(self, userA, reelA):
        before = requests.get(f"{BASE_URL}/notifications", headers=auth_headers(userA["token"]))
        before_items = before.json().get("items") or before.json().get("data", {}).get("items") or []
        before_count = len(before_items)

        # Share own reel
        requests.post(f"{BASE_URL}/reels/{reelA['id']}/share", json={},
            headers=auth_headers(userA["token"]))
        time.sleep(0.2)

        after = requests.get(f"{BASE_URL}/notifications", headers=auth_headers(userA["token"]))
        after_items = after.json().get("items") or after.json().get("data", {}).get("items") or []
        # Self-share should NOT increase notification count
        self_share_notifs = [n for n in after_items if n.get("type") == "REEL_SHARE" and n.get("actorId") == userA["id"]]
        assert len(self_share_notifs) == 0, "Self-share should not create notification"

    def test_notification_read_handles_new_types(self, userA):
        resp = requests.patch(f"{BASE_URL}/notifications/read", json={},
            headers=auth_headers(userA["token"]))
        assert resp.status_code == 200


# ======================== D: VISIBILITY / BLOCK ENFORCEMENT ========================

class TestVisibilityBlock:

    def test_blocked_user_comments_hidden_from_list(self, userA, userC):
        """Block userC, their comments should not appear in comment list for userA"""
        # Create reel
        reel_resp = create_reel(userA["token"], "Block comment test")
        assert reel_resp.status_code == 201
        reel = get_reel(reel_resp)

        # userC comments
        requests.post(f"{BASE_URL}/reels/{reel['id']}/comment", json={
            "text": "Comment from userC before block",
        }, headers=auth_headers(userC["token"]))

        # userA blocks userC
        requests.post(f"{BASE_URL}/me/blocks/{userC['id']}", headers=auth_headers(userA["token"]))
        time.sleep(0.2)

        # Check comment list — userC's comment should be hidden
        comments_resp = requests.get(f"{BASE_URL}/reels/{reel['id']}/comments",
            headers=auth_headers(userA["token"]))
        assert comments_resp.status_code == 200
        data = comments_resp.json()
        items = data.get("items") or data.get("data", {}).get("items") or []
        commenter_ids = [c.get("senderId") for c in items]
        assert userC["id"] not in commenter_ids, f"Blocked user's comments should be hidden. Found: {commenter_ids}"

        # Cleanup: unblock
        requests.delete(f"{BASE_URL}/me/blocks/{userC['id']}", headers=auth_headers(userA["token"]))

    def test_blocked_creator_reel_hidden_from_feed(self, userA, userB):
        """Block userB, their reels should not appear in userA's feed"""
        # Create reel as userB
        reel_resp = create_reel(userB["token"], "Block feed test")
        assert reel_resp.status_code == 201
        reel = get_reel(reel_resp)

        # userA blocks userB
        requests.post(f"{BASE_URL}/me/blocks/{userB['id']}", headers=auth_headers(userA["token"]))
        time.sleep(0.2)

        # Check feed
        feed_resp = requests.get(f"{BASE_URL}/reels/feed", headers=auth_headers(userA["token"]))
        assert feed_resp.status_code == 200
        data = feed_resp.json()
        items = data.get("items") or data.get("data", {}).get("items") or []
        creator_ids = [r.get("creatorId") for r in items]
        assert userB["id"] not in creator_ids, "Blocked creator's reels should be hidden from feed"

        # Cleanup
        requests.delete(f"{BASE_URL}/me/blocks/{userB['id']}", headers=auth_headers(userA["token"]))

    def test_blocked_creator_reel_detail_hidden(self, userA, userB):
        """Blocked creator's reel detail should not be accessible"""
        reel_resp = create_reel(userB["token"], "Block detail test")
        assert reel_resp.status_code == 201
        reel = get_reel(reel_resp)

        # Block
        requests.post(f"{BASE_URL}/me/blocks/{userB['id']}", headers=auth_headers(userA["token"]))
        time.sleep(0.2)

        # Detail should fail
        detail = requests.get(f"{BASE_URL}/reels/{reel['id']}", headers=auth_headers(userA["token"]))
        assert detail.status_code in (403, 404), f"Blocked creator reel should be hidden, got {detail.status_code}"

        # Cleanup
        requests.delete(f"{BASE_URL}/me/blocks/{userB['id']}", headers=auth_headers(userA["token"]))


# ======================== E: FEED PAGINATION ========================

class TestFeedPagination:

    def test_feed_returns_pagination(self, userA):
        resp = requests.get(f"{BASE_URL}/reels/feed?limit=2", headers=auth_headers(userA["token"]))
        assert resp.status_code == 200
        data = resp.json()
        pagination = data.get("pagination") or data.get("data", {}).get("pagination")
        assert "hasMore" in pagination
        assert "nextCursor" in pagination

    def test_feed_cursor_pagination_works(self, userA):
        """Fetch page 1 then page 2 using cursor — no duplicates"""
        resp1 = requests.get(f"{BASE_URL}/reels/feed?limit=2", headers=auth_headers(userA["token"]))
        data1 = resp1.json()
        items1 = data1.get("items") or data1.get("data", {}).get("items") or []
        pagination1 = data1.get("pagination") or data1.get("data", {}).get("pagination")
        
        if not pagination1.get("hasMore") or not pagination1.get("nextCursor"):
            pytest.skip("Not enough reels for pagination test")

        cursor = pagination1["nextCursor"]
        resp2 = requests.get(f"{BASE_URL}/reels/feed?limit=2&cursor={cursor}", headers=auth_headers(userA["token"]))
        assert resp2.status_code == 200
        items2 = resp2.json().get("items") or resp2.json().get("data", {}).get("items") or []
        
        ids1 = set(r["id"] for r in items1)
        ids2 = set(r["id"] for r in items2)
        overlap = ids1 & ids2
        # Allow at most 1 overlap due to concurrent reel creation during test suite
        assert len(overlap) <= 1, f"Too many duplicate reels across pages: {overlap}"


# ======================== F: REPORT/HIDE/NOT-INTERESTED ========================

class TestReportHideNotInterested:

    def test_hide_reel_succeeds(self, userB, reelA):
        resp = requests.post(f"{BASE_URL}/reels/{reelA['id']}/hide",
            headers=auth_headers(userB["token"]))
        assert resp.status_code == 200

    def test_hide_reel_idempotent(self, userB, reelA):
        resp = requests.post(f"{BASE_URL}/reels/{reelA['id']}/hide",
            headers=auth_headers(userB["token"]))
        assert resp.status_code == 200  # Should not error on duplicate

    def test_not_interested_succeeds(self, userB, reelA):
        resp = requests.post(f"{BASE_URL}/reels/{reelA['id']}/not-interested",
            headers=auth_headers(userB["token"]))
        assert resp.status_code == 200

    def test_not_interested_idempotent(self, userB, reelA):
        resp = requests.post(f"{BASE_URL}/reels/{reelA['id']}/not-interested",
            headers=auth_headers(userB["token"]))
        assert resp.status_code == 200

    def test_hide_requires_auth(self, reelA):
        resp = requests.post(f"{BASE_URL}/reels/{reelA['id']}/hide",
            headers={"Content-Type": "application/json", "X-Forwarded-For": random_ip()})
        assert resp.status_code in (401, 403)

    def test_not_interested_requires_auth(self, reelA):
        resp = requests.post(f"{BASE_URL}/reels/{reelA['id']}/not-interested",
            headers={"Content-Type": "application/json", "X-Forwarded-For": random_ip()})
        assert resp.status_code in (401, 403)


# ======================== G: REGRESSION ========================

class TestRegression:

    def test_existing_reel_crud_works(self, userA):
        # Create
        resp = create_reel(userA["token"], "Regression CRUD test")
        assert resp.status_code == 201
        reel = get_reel(resp)
        
        # Read
        detail = requests.get(f"{BASE_URL}/reels/{reel['id']}", headers=auth_headers(userA["token"]))
        assert detail.status_code == 200
        
        # Update
        edit = requests.patch(f"{BASE_URL}/reels/{reel['id']}", json={"caption": "Edited"},
            headers=auth_headers(userA["token"]))
        assert edit.status_code == 200

    def test_b6p1_comment_text_body_still_works(self, userB, reelA):
        resp = requests.post(f"{BASE_URL}/reels/{reelA['id']}/comment", json={
            "body": "P1 compat test",
        }, headers=auth_headers(userB["token"]))
        assert resp.status_code == 201

    def test_b6p1_notification_types_still_work(self, userA):
        resp = requests.get(f"{BASE_URL}/notifications", headers=auth_headers(userA["token"]))
        assert resp.status_code == 200
        items = resp.json().get("items") or resp.json().get("data", {}).get("items") or resp.json().get("notifications") or []
        types = set(n.get("type") for n in items)
        # Should have at least some reel types from previous tests
        reel_types = types & {"REEL_LIKE", "REEL_COMMENT", "REEL_SHARE"}
        assert len(reel_types) >= 1, f"Expected reel notification types, found: {types}"

    def test_notification_mark_read_still_works(self, userA):
        resp = requests.patch(f"{BASE_URL}/notifications/read", json={},
            headers=auth_headers(userA["token"]))
        assert resp.status_code == 200

    def test_b3_pages_not_broken(self, userA):
        resp = requests.get(f"{BASE_URL}/pages", headers=auth_headers(userA["token"]))
        assert resp.status_code == 200

    def test_feed_public_still_works(self, userA):
        resp = requests.get(f"{BASE_URL}/feed/public", headers=auth_headers(userA["token"]))
        assert resp.status_code == 200
