"""
Tribe B6 Phase 1 — Reels Polish Test Suite
Tests all 4 bug fixes:
  A. Moderation function call signature (correct db + object)
  B. Reel comment accepts both text AND body fields
  C. REEL_LIKE, REEL_COMMENT in NotificationType enum
  D. Reel report path works end-to-end
"""

import pytest
import requests
import time
import random

BASE_URL = "https://tribe-feed-debug.preview.emergentagent.com/api"

# ======================== HELPERS ========================

def unique_phone():
    return f"9{random.randint(100000000, 999999999)}"

def random_ip():
    return f"10.{random.randint(1,254)}.{random.randint(1,254)}.{random.randint(1,254)}"

def register_user(suffix="", retries=3):
    for attempt in range(retries):
        phone = unique_phone()
        time.sleep(0.3 + attempt * 1.0)
        resp = requests.post(f"{BASE_URL}/auth/register", json={
            "phone": phone,
            "pin": "1234",
            "displayName": f"B6Test{suffix}{phone[-4:]}",
            "username": f"b6t{suffix.lower()}{phone[-6:]}",
        }, headers={"Content-Type": "application/json", "X-Forwarded-For": random_ip()})
        if resp.status_code == 429:
            time.sleep(3)
            continue
        assert resp.status_code in (200, 201), f"Register failed ({resp.status_code}): {resp.text}"
        data = resp.json()
        token = data.get("accessToken") or data.get("token")
        user = data.get("user", {})
        user_id = user.get("id")
        display_name = user.get("displayName")
        assert token, f"No token in register response: {data}"
        return {"token": token, "id": user_id, "displayName": display_name}
    pytest.fail("Could not register user after retries (rate limited)")

def auth_headers(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json", "X-Forwarded-For": random_ip()}

def complete_onboarding(token):
    requests.patch(f"{BASE_URL}/me/age", json={"birthYear": 2000}, headers=auth_headers(token))
    requests.patch(f"{BASE_URL}/me/onboarding", json={"step": "COMPLETE"}, headers=auth_headers(token))

def create_reel(token, caption="Test reel"):
    resp = requests.post(f"{BASE_URL}/reels", json={
        "caption": caption,
        "mediaUrl": "https://example.com/test.mp4",
        "thumbnailUrl": "https://example.com/thumb.jpg",
        "durationMs": 15000,
        "visibility": "PUBLIC",
    }, headers=auth_headers(token))
    return resp

# ======================== FIXTURES ========================

@pytest.fixture(scope="module")
def creator():
    user = register_user("Cr")
    complete_onboarding(user["token"])
    return user

@pytest.fixture(scope="module")
def commenter():
    user = register_user("Co")
    complete_onboarding(user["token"])
    return user

@pytest.fixture(scope="module")
def reporter():
    user = register_user("Rp")
    complete_onboarding(user["token"])
    return user

@pytest.fixture(scope="module")
def test_reel(creator):
    resp = create_reel(creator["token"], "B6 Phase 1 test reel")
    assert resp.status_code == 201, f"Create reel failed: {resp.text}"
    data = resp.json()
    reel = data.get("reel") or data.get("data", {}).get("reel")
    assert reel and reel.get("id"), f"No reel in response: {data}"
    return reel


# ======================== GROUP A: MODERATION CALL FIXES ========================

class TestModerationCallFixes:

    def test_create_reel_with_caption_no_crash(self, creator):
        resp = create_reel(creator["token"], "Moderation test caption for B6")
        assert resp.status_code == 201, f"Create reel crashed: {resp.text}"
        data = resp.json()
        reel = data.get("reel") or data.get("data", {}).get("reel")
        assert reel["caption"] == "Moderation test caption for B6"

    def test_create_reel_without_caption_succeeds(self, creator):
        resp = requests.post(f"{BASE_URL}/reels", json={
            "mediaUrl": "https://example.com/test2.mp4",
            "thumbnailUrl": "https://example.com/thumb2.jpg",
            "durationMs": 10000,
            "visibility": "PUBLIC",
        }, headers=auth_headers(creator["token"]))
        assert resp.status_code == 201, f"Create reel without caption failed: {resp.text}"

    def test_edit_reel_caption_no_crash(self, creator, test_reel):
        resp = requests.patch(f"{BASE_URL}/reels/{test_reel['id']}", json={
            "caption": "Edited caption for B6 moderation test",
        }, headers=auth_headers(creator["token"]))
        assert resp.status_code == 200, f"Edit reel crashed: {resp.text}"
        data = resp.json()
        reel = data.get("reel") or data.get("data", {}).get("reel")
        assert reel["caption"] == "Edited caption for B6 moderation test"


# ======================== GROUP B: REEL COMMENT text AND body ========================

class TestReelCommentTextBody:

    def test_comment_with_text_field(self, commenter, test_reel):
        resp = requests.post(f"{BASE_URL}/reels/{test_reel['id']}/comment", json={
            "text": "Comment via text field",
        }, headers=auth_headers(commenter["token"]))
        assert resp.status_code == 201, f"Comment with text failed: {resp.text}"
        data = resp.json()
        comment = data.get("comment") or data.get("data", {}).get("comment")
        assert comment["text"] == "Comment via text field"

    def test_comment_with_body_field(self, commenter, test_reel):
        resp = requests.post(f"{BASE_URL}/reels/{test_reel['id']}/comment", json={
            "body": "Comment via body field",
        }, headers=auth_headers(commenter["token"]))
        assert resp.status_code == 201, f"Comment with body failed: {resp.text}"
        data = resp.json()
        comment = data.get("comment") or data.get("data", {}).get("comment")
        assert comment["text"] == "Comment via body field"

    def test_comment_with_both_fields_body_precedence(self, commenter, test_reel):
        resp = requests.post(f"{BASE_URL}/reels/{test_reel['id']}/comment", json={
            "text": "from text",
            "body": "from body",
        }, headers=auth_headers(commenter["token"]))
        assert resp.status_code == 201, f"Comment with both fields failed: {resp.text}"
        data = resp.json()
        comment = data.get("comment") or data.get("data", {}).get("comment")
        assert comment["text"] == "from body"

    def test_comment_empty_text_rejected(self, commenter, test_reel):
        resp = requests.post(f"{BASE_URL}/reels/{test_reel['id']}/comment", json={
            "text": "",
        }, headers=auth_headers(commenter["token"]))
        assert resp.status_code == 400

    def test_comment_whitespace_only_rejected(self, commenter, test_reel):
        resp = requests.post(f"{BASE_URL}/reels/{test_reel['id']}/comment", json={
            "text": "   ",
        }, headers=auth_headers(commenter["token"]))
        assert resp.status_code == 400

    def test_comment_no_text_or_body_rejected(self, commenter, test_reel):
        resp = requests.post(f"{BASE_URL}/reels/{test_reel['id']}/comment", json={},
            headers=auth_headers(commenter["token"]))
        assert resp.status_code == 400

    def test_comment_max_length_enforced(self, commenter, test_reel):
        resp = requests.post(f"{BASE_URL}/reels/{test_reel['id']}/comment", json={
            "text": "x" * 1001,
        }, headers=auth_headers(commenter["token"]))
        assert resp.status_code == 400

    def test_comment_stored_with_both_fields(self, commenter, test_reel):
        resp = requests.post(f"{BASE_URL}/reels/{test_reel['id']}/comment", json={
            "text": "Dual field storage test",
        }, headers=auth_headers(commenter["token"]))
        assert resp.status_code == 201
        data = resp.json()
        comment = data.get("comment") or data.get("data", {}).get("comment")
        assert comment.get("text") == "Dual field storage test"
        assert comment.get("body") == "Dual field storage test"

    def test_comment_on_nonexistent_reel(self, commenter):
        resp = requests.post(f"{BASE_URL}/reels/nonexistent-reel-id/comment", json={
            "text": "Should fail",
        }, headers=auth_headers(commenter["token"]))
        assert resp.status_code == 404

    def test_comment_count_increments(self, creator, commenter):
        reel_resp = create_reel(creator["token"], "Count test reel")
        assert reel_resp.status_code == 201
        reel_data = reel_resp.json()
        reel = reel_data.get("reel") or reel_data.get("data", {}).get("reel")
        reel_id = reel["id"]

        resp = requests.post(f"{BASE_URL}/reels/{reel_id}/comment", json={
            "text": "Count test",
        }, headers=auth_headers(commenter["token"]))
        assert resp.status_code == 201

        detail = requests.get(f"{BASE_URL}/reels/{reel_id}", headers=auth_headers(creator["token"]))
        assert detail.status_code == 200
        detail_data = detail.json()
        reel_detail = detail_data.get("reel") or detail_data.get("data", {}).get("reel")
        assert reel_detail["commentCount"] >= 1


# ======================== GROUP C: NOTIFICATION TYPE ENUM ========================

class TestNotificationTypeEnum:

    def test_reel_like_creates_notification(self, creator, commenter, test_reel):
        resp = requests.post(f"{BASE_URL}/reels/{test_reel['id']}/like",
            headers=auth_headers(commenter["token"]))
        assert resp.status_code == 200, f"Like failed: {resp.text}"
        time.sleep(0.3)

        notif_resp = requests.get(f"{BASE_URL}/notifications",
            headers=auth_headers(creator["token"]))
        assert notif_resp.status_code == 200
        data = notif_resp.json()
        items = data.get("items") or data.get("data", {}).get("items") or data.get("notifications") or []
        reel_like_notifs = [n for n in items if n.get("type") == "REEL_LIKE"]
        assert len(reel_like_notifs) >= 1, f"No REEL_LIKE notification. Types found: {[n.get('type') for n in items[:10]]}"

    def test_reel_comment_creates_notification(self, creator, test_reel):
        user = register_user("Nc")
        complete_onboarding(user["token"])
        
        resp = requests.post(f"{BASE_URL}/reels/{test_reel['id']}/comment", json={
            "text": "Notification test comment",
        }, headers=auth_headers(user["token"]))
        assert resp.status_code == 201
        time.sleep(0.3)

        notif_resp = requests.get(f"{BASE_URL}/notifications",
            headers=auth_headers(creator["token"]))
        assert notif_resp.status_code == 200
        data = notif_resp.json()
        items = data.get("items") or data.get("data", {}).get("items") or data.get("notifications") or []
        reel_comment_notifs = [n for n in items if n.get("type") == "REEL_COMMENT"]
        assert len(reel_comment_notifs) >= 1, f"No REEL_COMMENT notification. Types found: {[n.get('type') for n in items[:10]]}"

    def test_notification_list_handles_reel_types(self, creator):
        resp = requests.get(f"{BASE_URL}/notifications",
            headers=auth_headers(creator["token"]))
        assert resp.status_code == 200
        data = resp.json()
        items = data.get("items") or data.get("data", {}).get("items") or data.get("notifications") or []
        reel_types = [n for n in items if n.get("type") in ("REEL_LIKE", "REEL_COMMENT")]
        assert len(reel_types) >= 1, "Expected at least one reel notification type"


# ======================== GROUP D: REEL REPORT PATH ========================

class TestReelReportPath:

    def test_report_valid(self, reporter, test_reel):
        resp = requests.post(f"{BASE_URL}/reels/{test_reel['id']}/report", json={
            "reasonCode": "SPAM",
            "reason": "This looks like spam",
        }, headers=auth_headers(reporter["token"]))
        assert resp.status_code == 201, f"Report failed: {resp.text}"
        data = resp.json()
        report = data.get("report") or data.get("data", {}).get("report")
        assert report["reasonCode"] == "SPAM"
        report_count = data.get("reportCount") or data.get("data", {}).get("reportCount")
        assert report_count >= 1

    def test_report_duplicate_rejected(self, reporter, test_reel):
        resp = requests.post(f"{BASE_URL}/reels/{test_reel['id']}/report", json={
            "reasonCode": "SPAM",
        }, headers=auth_headers(reporter["token"]))
        assert resp.status_code == 409

    def test_report_nonexistent_reel(self, reporter):
        resp = requests.post(f"{BASE_URL}/reels/nonexistent-reel-id/report", json={
            "reasonCode": "SPAM",
        }, headers=auth_headers(reporter["token"]))
        assert resp.status_code == 404

    def test_report_missing_reason_code(self, commenter, test_reel):
        resp = requests.post(f"{BASE_URL}/reels/{test_reel['id']}/report", json={
            "reason": "Just a reason without code",
        }, headers=auth_headers(commenter["token"]))
        assert resp.status_code == 400

    def test_report_empty_body_no_crash(self, commenter, test_reel):
        """Report with empty body should 400, not 500"""
        resp = requests.post(f"{BASE_URL}/reels/{test_reel['id']}/report",
            data="",
            headers={"Authorization": f"Bearer {commenter['token']}", "Content-Type": "application/json", "X-Forwarded-For": random_ip()})
        assert resp.status_code in (400, 409), f"Expected 400/409, got {resp.status_code}: {resp.text}"

    def test_report_own_reel_rejected(self, creator, test_reel):
        resp = requests.post(f"{BASE_URL}/reels/{test_reel['id']}/report", json={
            "reasonCode": "SPAM",
        }, headers=auth_headers(creator["token"]))
        assert resp.status_code == 400

    def test_report_requires_auth(self, test_reel):
        resp = requests.post(f"{BASE_URL}/reels/{test_reel['id']}/report", json={
            "reasonCode": "SPAM",
        }, headers={"X-Forwarded-For": random_ip()})
        assert resp.status_code in (401, 403)

    def test_report_response_no_mongo_id_leak(self, test_reel):
        user = register_user("Rc")
        complete_onboarding(user["token"])
        resp = requests.post(f"{BASE_URL}/reels/{test_reel['id']}/report", json={
            "reasonCode": "INAPPROPRIATE",
        }, headers=auth_headers(user["token"]))
        assert resp.status_code == 201
        data = resp.json()
        report = data.get("report") or data.get("data", {}).get("report")
        assert "_id" not in report, f"_id leaked in report response: {report}"


# ======================== GROUP E: REGRESSION ========================

class TestReelRegression:

    def test_reel_feed_works(self, commenter):
        resp = requests.get(f"{BASE_URL}/reels/feed",
            headers=auth_headers(commenter["token"]))
        assert resp.status_code == 200

    def test_reel_detail_works(self, commenter, test_reel):
        resp = requests.get(f"{BASE_URL}/reels/{test_reel['id']}",
            headers=auth_headers(commenter["token"]))
        assert resp.status_code == 200
        data = resp.json()
        reel = data.get("reel") or data.get("data", {}).get("reel")
        assert reel["id"] == test_reel["id"]

    def test_reel_like_unlike_cycle(self, commenter, test_reel):
        requests.delete(f"{BASE_URL}/reels/{test_reel['id']}/like",
            headers=auth_headers(commenter["token"]))
        resp = requests.post(f"{BASE_URL}/reels/{test_reel['id']}/like",
            headers=auth_headers(commenter["token"]))
        assert resp.status_code == 200
        resp = requests.delete(f"{BASE_URL}/reels/{test_reel['id']}/like",
            headers=auth_headers(commenter["token"]))
        assert resp.status_code == 200

    def test_reel_save_unsave_cycle(self, commenter, test_reel):
        resp = requests.post(f"{BASE_URL}/reels/{test_reel['id']}/save",
            headers=auth_headers(commenter["token"]))
        assert resp.status_code == 200
        resp = requests.delete(f"{BASE_URL}/reels/{test_reel['id']}/save",
            headers=auth_headers(commenter["token"]))
        assert resp.status_code == 200

    def test_reel_comments_list_works(self, commenter, test_reel):
        resp = requests.get(f"{BASE_URL}/reels/{test_reel['id']}/comments",
            headers=auth_headers(commenter["token"]))
        assert resp.status_code == 200

    def test_notification_list_still_works(self, creator):
        resp = requests.get(f"{BASE_URL}/notifications",
            headers=auth_headers(creator["token"]))
        assert resp.status_code == 200

    def test_notification_mark_read_still_works(self, creator):
        resp = requests.patch(f"{BASE_URL}/notifications/read", json={},
            headers=auth_headers(creator["token"]))
        assert resp.status_code == 200
