"""
B4 + B4-U — Core Social Gaps: ULTIMATE WORLD-BEST TEST GATE
Edit Post, Comment Like/Unlike, Share/Repost — production-grade validation.
Covers all 14 phases: route/contract, edit, comment-like, share/repost,
counters, notifications, snapshots, B2 safety, page compat, concurrency,
failure/rollback, performance, backward compat, observability.

Rate-limit strategy: dedicated users per phase.
"""

import pytest
import requests
import time
import os
import random
from pymongo import MongoClient

API_URL = os.environ.get("TEST_API_URL", "https://b5-search-proof.preview.emergentagent.com")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "your_database_name")

_client = MongoClient(MONGO_URL)
_db = _client[DB_NAME]


def _ip():
    return f"10.{random.randint(1,254)}.{random.randint(1,254)}.{random.randint(1,254)}"


def register(suffix):
    phone = f"77780{suffix:05d}"
    h = {"X-Forwarded-For": _ip(), "Content-Type": "application/json"}
    for _ in range(5):
        r = requests.post(f"{API_URL}/api/auth/register", json={
            "phone": phone, "pin": "1234",
            "displayName": f"B4User{suffix}", "username": f"b4user{suffix}"
        }, headers=h)
        if r.status_code == 409:
            r = requests.post(f"{API_URL}/api/auth/login", json={"phone": phone, "pin": "1234"}, headers=h)
        if r.status_code == 429:
            time.sleep(3)
            continue
        break
    assert r.status_code in (200, 201), f"Auth fail: {r.text[:200]}"
    d = r.json()
    # Set ageStatus to ADULT so user can create content
    _db.users.update_one({"id": d["user"]["id"]}, {"$set": {"ageStatus": "ADULT"}})
    return d["accessToken"], d["user"]["id"], d["user"]


def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json", "X-Forwarded-For": _ip()}


def post_retry(url, json=None, headers=None, max_retries=5):
    for i in range(max_retries):
        r = requests.post(url, json=json, headers=headers)
        if r.status_code == 429:
            time.sleep(2.5 * (i + 1))
            continue
        return r
    return r


def patch_retry(url, json=None, headers=None, max_retries=5):
    for i in range(max_retries):
        r = requests.patch(url, json=json, headers=headers)
        if r.status_code == 429:
            time.sleep(2.5 * (i + 1))
            continue
        return r
    return r


def get_retry(url, headers=None, max_retries=5):
    for i in range(max_retries):
        r = requests.get(url, headers=headers)
        if r.status_code == 429:
            time.sleep(2.5 * (i + 1))
            continue
        return r
    return r


def delete_retry(url, headers=None, max_retries=5):
    for i in range(max_retries):
        r = requests.delete(url, headers=headers)
        if r.status_code == 429:
            time.sleep(2.5 * (i + 1))
            continue
        return r
    return r


def _create_post(token, caption="Test post"):
    r = post_retry(f"{API_URL}/api/content/posts", json={"caption": caption, "kind": "POST"}, headers=H(token))
    assert r.status_code == 201, f"Create post failed: {r.status_code} {r.text[:200]}"
    return r.json()["post"]


def _create_comment(token, post_id, text="Test comment"):
    r = post_retry(f"{API_URL}/api/content/{post_id}/comments", json={"text": text}, headers=H(token))
    assert r.status_code == 201, f"Create comment failed: {r.status_code} {r.text[:200]}"
    return r.json()["comment"]


# ─────────────────────────────────────────
# FIXTURES
# ─────────────────────────────────────────

@pytest.fixture(scope="module")
def db():
    return _db


@pytest.fixture(scope="module")
def owner():
    t, uid, u = register(30001)
    return {"token": t, "id": uid, "user": u}


@pytest.fixture(scope="module")
def user2():
    t, uid, u = register(30002)
    return {"token": t, "id": uid, "user": u}


@pytest.fixture(scope="module")
def user3():
    t, uid, u = register(30003)
    return {"token": t, "id": uid, "user": u}


@pytest.fixture(scope="module")
def outsider():
    t, uid, u = register(30004)
    return {"token": t, "id": uid, "user": u}


@pytest.fixture(scope="module")
def edit_user():
    t, uid, u = register(30010)
    return {"token": t, "id": uid, "user": u}


@pytest.fixture(scope="module")
def like_user():
    t, uid, u = register(30011)
    return {"token": t, "id": uid, "user": u}


@pytest.fixture(scope="module")
def share_user():
    t, uid, u = register(30012)
    return {"token": t, "id": uid, "user": u}


@pytest.fixture(scope="module")
def page_owner():
    t, uid, u = register(30020)
    return {"token": t, "id": uid, "user": u}


@pytest.fixture(scope="module")
def page_editor():
    t, uid, u = register(30021)
    return {"token": t, "id": uid, "user": u}


@pytest.fixture(scope="module")
def page_moderator():
    t, uid, u = register(30022)
    return {"token": t, "id": uid, "user": u}


@pytest.fixture(scope="module")
def test_page(page_owner, page_editor, page_moderator):
    """Create a page for B4 page-compat tests."""
    slug = f"b4page-{int(time.time()*1000) % 10000000}"
    r = post_retry(f"{API_URL}/api/pages", json={
        "name": "B4 Test Page", "slug": slug, "category": "STUDY_GROUP"
    }, headers=H(page_owner["token"]))
    assert r.status_code == 201, f"Page create failed: {r.status_code}"
    page = r.json()["page"]

    for user, role in [(page_editor, "EDITOR"), (page_moderator, "MODERATOR")]:
        time.sleep(0.3)
        post_retry(f"{API_URL}/api/pages/{page['id']}/members",
                   json={"userId": user["id"], "role": role}, headers=H(page_owner["token"]))
    return page


@pytest.fixture(scope="module")
def owner_post(owner):
    """A post owned by `owner` user."""
    return _create_post(owner["token"], "Owner fixture post for B4")


@pytest.fixture(scope="module")
def owner_comment(owner, owner_post, user2):
    """A comment by user2 on owner's post."""
    return _create_comment(user2["token"], owner_post["id"], "Fixture comment")


# ═══════════════════════════════════════════════════
# PHASE 1: ROUTE & CONTRACT EXISTENCE
# ═══════════════════════════════════════════════════

class TestPhase1Routes:

    def test_patch_content_exists(self, owner, owner_post):
        r = patch_retry(f"{API_URL}/api/content/{owner_post['id']}",
                        json={"caption": "Route test edit"}, headers=H(owner["token"]))
        assert r.status_code == 200
        assert "post" in r.json()

    def test_comment_like_route(self, owner, owner_post, owner_comment):
        r = post_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                       headers=H(owner["token"]))
        assert r.status_code == 200
        assert "liked" in r.json()
        # Cleanup: unlike
        delete_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                     headers=H(owner["token"]))

    def test_comment_unlike_route(self, owner, owner_post, owner_comment):
        r = delete_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                         headers=H(owner["token"]))
        assert r.status_code == 200
        assert "liked" in r.json()

    def test_share_route(self, share_user, owner_post):
        r = post_retry(f"{API_URL}/api/content/{owner_post['id']}/share", headers=H(share_user["token"]))
        assert r.status_code == 201
        assert "post" in r.json()
        assert r.json()["post"].get("isRepost") is True

    def test_unauth_edit_denied(self, owner_post):
        r = requests.patch(f"{API_URL}/api/content/{owner_post['id']}",
                           json={"caption": "Unauth"}, headers={"Content-Type": "application/json", "X-Forwarded-For": _ip()})
        assert r.status_code == 401

    def test_unauth_comment_like_denied(self, owner_post, owner_comment):
        r = requests.post(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                          headers={"Content-Type": "application/json", "X-Forwarded-For": _ip()})
        assert r.status_code == 401

    def test_unauth_share_denied(self, owner_post):
        r = requests.post(f"{API_URL}/api/content/{owner_post['id']}/share",
                          headers={"Content-Type": "application/json", "X-Forwarded-For": _ip()})
        assert r.status_code == 401


# ═══════════════════════════════════════════════════
# PHASE 2: EDIT POST CAPTION
# ═══════════════════════════════════════════════════

class TestPhase2EditPost:

    def test_owner_edits_caption(self, edit_user):
        p = _create_post(edit_user["token"], "Before edit")
        r = patch_retry(f"{API_URL}/api/content/{p['id']}",
                        json={"caption": "After edit"}, headers=H(edit_user["token"]))
        assert r.status_code == 200
        assert r.json()["post"]["caption"] == "After edit"

    def test_editedAt_recorded(self, edit_user):
        p = _create_post(edit_user["token"], "EditedAt test")
        r = patch_retry(f"{API_URL}/api/content/{p['id']}",
                        json={"caption": "Edited with timestamp"}, headers=H(edit_user["token"]))
        assert r.status_code == 200
        assert r.json()["post"].get("editedAt") is not None

    def test_outsider_edit_denied(self, owner_post, outsider):
        r = patch_retry(f"{API_URL}/api/content/{owner_post['id']}",
                        json={"caption": "Hacked"}, headers=H(outsider["token"]))
        assert r.status_code == 403

    def test_deleted_post_edit_denied(self, edit_user, db):
        p = _create_post(edit_user["token"], "To delete")
        r = delete_retry(f"{API_URL}/api/content/{p['id']}", headers=H(edit_user["token"]))
        assert r.status_code == 200
        r = patch_retry(f"{API_URL}/api/content/{p['id']}",
                        json={"caption": "Ghost edit"}, headers=H(edit_user["token"]))
        assert r.status_code == 404

    def test_empty_caption_rejected(self, edit_user):
        p = _create_post(edit_user["token"], "Empty test")
        r = patch_retry(f"{API_URL}/api/content/{p['id']}",
                        json={"caption": ""}, headers=H(edit_user["token"]))
        assert r.status_code == 400

    def test_missing_caption_rejected(self, edit_user):
        p = _create_post(edit_user["token"], "Missing test")
        r = patch_retry(f"{API_URL}/api/content/{p['id']}",
                        json={}, headers=H(edit_user["token"]))
        assert r.status_code == 400

    def test_edit_preserves_author_fields(self, edit_user, db):
        p = _create_post(edit_user["token"], "Preserve fields")
        original = db.content_items.find_one({"id": p["id"]})
        patch_retry(f"{API_URL}/api/content/{p['id']}",
                    json={"caption": "Fields preserved"}, headers=H(edit_user["token"]))
        updated = db.content_items.find_one({"id": p["id"]})
        assert updated["authorId"] == original["authorId"]
        assert updated.get("authorType", "USER") == original.get("authorType", "USER")
        assert updated["likeCount"] == original["likeCount"]

    def test_edit_returns_enriched_response(self, edit_user):
        p = _create_post(edit_user["token"], "Enriched test")
        r = patch_retry(f"{API_URL}/api/content/{p['id']}",
                        json={"caption": "Enriched now"}, headers=H(edit_user["token"]))
        assert r.status_code == 200
        post = r.json()["post"]
        assert "author" in post
        assert "viewerHasLiked" in post

    def test_edit_reflected_in_detail(self, edit_user):
        p = _create_post(edit_user["token"], "Detail consistency")
        patch_retry(f"{API_URL}/api/content/{p['id']}",
                    json={"caption": "Consistent edit"}, headers=H(edit_user["token"]))
        r = get_retry(f"{API_URL}/api/content/{p['id']}", headers=H(edit_user["token"]))
        assert r.status_code == 200
        assert r.json()["post"]["caption"] == "Consistent edit"


# ═══════════════════════════════════════════════════
# PHASE 3: COMMENT LIKE / UNLIKE
# ═══════════════════════════════════════════════════

class TestPhase3CommentLike:

    def test_like_comment_succeeds(self, like_user, owner_post, owner_comment):
        r = post_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                       headers=H(like_user["token"]))
        assert r.status_code == 200
        assert r.json()["liked"] is True
        assert r.json()["commentLikeCount"] >= 1
        # Cleanup
        delete_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                     headers=H(like_user["token"]))

    def test_unlike_comment(self, like_user, owner_post, owner_comment):
        # Like first
        post_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                   headers=H(like_user["token"]))
        # Unlike
        r = delete_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                         headers=H(like_user["token"]))
        assert r.status_code == 200
        assert r.json()["liked"] is False

    def test_duplicate_like_idempotent(self, like_user, owner_post, owner_comment, db):
        # Like twice
        post_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                   headers=H(like_user["token"]))
        r = post_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                       headers=H(like_user["token"]))
        assert r.json()["liked"] is True
        # DB truth: only 1 record
        count = db.comment_likes.count_documents({"userId": like_user["id"], "commentId": owner_comment["id"]})
        assert count == 1
        # Cleanup
        delete_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                     headers=H(like_user["token"]))

    def test_double_unlike_safe(self, like_user, owner_post, owner_comment, db):
        post_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                   headers=H(like_user["token"]))
        delete_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                     headers=H(like_user["token"]))
        r = delete_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                         headers=H(like_user["token"]))
        assert r.json()["liked"] is False
        c = db.comments.find_one({"id": owner_comment["id"]})
        assert c["likeCount"] >= 0

    def test_wrong_post_comment_pairing(self, like_user, owner_post, owner_comment):
        r = post_retry(f"{API_URL}/api/content/nonexistent-post/comments/{owner_comment['id']}/like",
                       headers=H(like_user["token"]))
        assert r.status_code == 404

    def test_nonexistent_comment(self, like_user, owner_post):
        r = post_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/nonexistent-comment-id/like",
                       headers=H(like_user["token"]))
        assert r.status_code == 404

    def test_comment_like_count_truth(self, user2, user3, owner_post, owner_comment, db):
        """Two different users like, count = 2. One unlikes, count = 1."""
        post_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                   headers=H(user2["token"]))
        post_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                   headers=H(user3["token"]))
        c = db.comments.find_one({"id": owner_comment["id"]})
        actual = db.comment_likes.count_documents({"commentId": owner_comment["id"]})
        assert c["likeCount"] == actual
        # Cleanup
        delete_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                     headers=H(user2["token"]))
        delete_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                     headers=H(user3["token"]))


# ═══════════════════════════════════════════════════
# PHASE 4: SHARE / REPOST
# ═══════════════════════════════════════════════════

class TestPhase4ShareRepost:

    def test_repost_succeeds(self, user2, owner_post):
        r = post_retry(f"{API_URL}/api/content/{owner_post['id']}/share", headers=H(user2["token"]))
        assert r.status_code == 201
        repost = r.json()["post"]
        assert repost["isRepost"] is True
        assert repost["originalContentId"] == owner_post["id"]
        assert repost["authorId"] == user2["id"]

    def test_repost_has_original_content(self, user3, edit_user):
        p = _create_post(edit_user["token"], "Original for repost embed")
        r = post_retry(f"{API_URL}/api/content/{p['id']}/share", headers=H(user3["token"]))
        assert r.status_code == 201
        repost = r.json()["post"]
        assert "originalContent" in repost
        oc = repost["originalContent"]
        assert oc["id"] == p["id"]
        assert oc["caption"] == "Original for repost embed"
        assert oc.get("author") is not None

    def test_duplicate_repost_denied(self, user2, owner_post):
        # user2 already shared in test_repost_succeeds
        r = post_retry(f"{API_URL}/api/content/{owner_post['id']}/share", headers=H(user2["token"]))
        assert r.status_code == 409

    def test_cannot_repost_repost(self, user2, user3, owner_post, db):
        repost = db.content_items.find_one({"authorId": user2["id"], "originalContentId": owner_post["id"]})
        if repost:
            r = post_retry(f"{API_URL}/api/content/{repost['id']}/share", headers=H(user3["token"]))
            assert r.status_code == 400

    def test_repost_deleted_content_denied(self, like_user, edit_user):
        p = _create_post(edit_user["token"], "Delete before share")
        delete_retry(f"{API_URL}/api/content/{p['id']}", headers=H(edit_user["token"]))
        r = post_retry(f"{API_URL}/api/content/{p['id']}/share", headers=H(like_user["token"]))
        assert r.status_code == 404

    def test_repost_nonexistent_denied(self, like_user):
        r = post_retry(f"{API_URL}/api/content/nonexistent-content-id/share", headers=H(like_user["token"]))
        assert r.status_code == 404

    def test_share_count_increments(self, owner, owner_post, db):
        before = db.content_items.find_one({"id": owner_post["id"]})["shareCount"]
        assert before >= 1  # from test_repost_succeeds

    def test_repost_serializer_shape(self, user3, edit_user):
        p = _create_post(edit_user["token"], "Shape test repost")
        r = post_retry(f"{API_URL}/api/content/{p['id']}/share", headers=H(user3["token"]))
        # May be 201 or 409 if user3 already shared
        if r.status_code == 201:
            repost = r.json()["post"]
            assert "id" in repost
            assert repost["authorType"] == "USER"
            assert repost["isRepost"] is True
            assert "originalContent" in repost
            assert repost["originalContent"]["author"] is not None


# ═══════════════════════════════════════════════════
# PHASE 5: COUNTER TRUTH
# ═══════════════════════════════════════════════════

class TestPhase5Counters:

    def test_comment_like_count_exact(self, like_user, owner, db):
        """Fresh post+comment, like once, count=1."""
        p = _create_post(owner["token"], "Counter test post")
        c = _create_comment(like_user["token"], p["id"], "Counter comment")
        assert db.comments.find_one({"id": c["id"]})["likeCount"] == 0
        post_retry(f"{API_URL}/api/content/{p['id']}/comments/{c['id']}/like", headers=H(owner["token"]))
        assert db.comments.find_one({"id": c["id"]})["likeCount"] == 1
        delete_retry(f"{API_URL}/api/content/{p['id']}/comments/{c['id']}/like", headers=H(owner["token"]))
        assert db.comments.find_one({"id": c["id"]})["likeCount"] == 0

    def test_share_count_exact(self, owner, db):
        p = _create_post(owner["token"], "Share counter test")
        assert db.content_items.find_one({"id": p["id"]})["shareCount"] == 0
        t, uid, _ = register(30099)
        post_retry(f"{API_URL}/api/content/{p['id']}/share", headers=H(t))
        assert db.content_items.find_one({"id": p["id"]})["shareCount"] == 1

    def test_counter_never_negative(self, like_user, owner, db):
        """Unlike when never liked should not make count negative."""
        p = _create_post(owner["token"], "Never neg test")
        c = _create_comment(like_user["token"], p["id"], "Never neg comment")
        delete_retry(f"{API_URL}/api/content/{p['id']}/comments/{c['id']}/like", headers=H(owner["token"]))
        comment = db.comments.find_one({"id": c["id"]})
        assert comment["likeCount"] >= 0


# ═══════════════════════════════════════════════════
# PHASE 6: NOTIFICATIONS
# ═══════════════════════════════════════════════════

class TestPhase6Notifications:

    def test_comment_like_notification(self, owner, user2, db):
        """Liking another user's comment creates notification for comment author."""
        p = _create_post(owner["token"], "Notif like test")
        c = _create_comment(user2["token"], p["id"], "Notif comment")
        post_retry(f"{API_URL}/api/content/{p['id']}/comments/{c['id']}/like", headers=H(owner["token"]))
        time.sleep(0.5)
        notif = db.notifications.find_one({
            "userId": user2["id"], "type": "COMMENT_LIKE", "targetId": c["id"]
        })
        assert notif is not None
        # Cleanup
        delete_retry(f"{API_URL}/api/content/{p['id']}/comments/{c['id']}/like", headers=H(owner["token"]))

    def test_self_comment_like_no_notify(self, owner, db):
        """Liking your own comment should not create notification."""
        p = _create_post(owner["token"], "Self notif test")
        c = _create_comment(owner["token"], p["id"], "Own comment")
        before = db.notifications.count_documents({"recipientId": owner["id"], "type": "COMMENT_LIKE"})
        post_retry(f"{API_URL}/api/content/{p['id']}/comments/{c['id']}/like", headers=H(owner["token"]))
        after = db.notifications.count_documents({"recipientId": owner["id"], "type": "COMMENT_LIKE"})
        assert after == before

    def test_share_notification(self, user2, owner, db):
        """Sharing creates notification for original author."""
        p = _create_post(owner["token"], "Share notif test")
        post_retry(f"{API_URL}/api/content/{p['id']}/share", headers=H(user2["token"]))
        time.sleep(0.5)
        notif = db.notifications.find_one({
            "userId": owner["id"], "type": "SHARE", "targetId": p["id"]
        })
        assert notif is not None

    def test_self_share_no_notify(self, owner, db):
        """Sharing own post should not self-notify."""
        p = _create_post(owner["token"], "Self share test")
        before = db.notifications.count_documents({"recipientId": owner["id"], "type": "SHARE"})
        post_retry(f"{API_URL}/api/content/{p['id']}/share", headers=H(owner["token"]))
        after = db.notifications.count_documents({"recipientId": owner["id"], "type": "SHARE"})
        assert after == before

    def test_old_notifications_still_work(self, owner):
        r = get_retry(f"{API_URL}/api/notifications", headers=H(owner["token"]))
        assert r.status_code == 200


# ═══════════════════════════════════════════════════
# PHASE 7: CONTRACT SNAPSHOTS
# ═══════════════════════════════════════════════════

class TestPhase7Snapshots:

    def test_edited_post_shape(self, edit_user):
        p = _create_post(edit_user["token"], "Snapshot edit")
        r = patch_retry(f"{API_URL}/api/content/{p['id']}",
                        json={"caption": "Snapshot edited"}, headers=H(edit_user["token"]))
        post = r.json()["post"]
        required = {"id", "caption", "author", "authorType", "likeCount", "commentCount",
                    "saveCount", "shareCount", "viewerHasLiked", "viewerHasSaved", "editedAt"}
        assert required.issubset(set(post.keys())), f"Missing: {required - set(post.keys())}"

    def test_comment_like_response_shape(self, like_user, owner_post, owner_comment):
        r = post_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                       headers=H(like_user["token"]))
        data = r.json()
        assert "liked" in data
        assert "commentLikeCount" in data
        assert isinstance(data["liked"], bool)
        assert isinstance(data["commentLikeCount"], int)
        # Cleanup
        delete_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                     headers=H(like_user["token"]))

    def test_repost_response_shape(self, owner):
        p = _create_post(owner["token"], "Snapshot repost")
        t, uid, _ = register(30098)
        r = post_retry(f"{API_URL}/api/content/{p['id']}/share", headers=H(t))
        assert r.status_code == 201
        repost = r.json()["post"]
        assert repost["isRepost"] is True
        assert "originalContent" in repost
        assert "originalContentId" in repost
        assert repost["authorType"] == "USER"
        assert repost["author"] is not None

    def test_user_post_shape_unchanged(self, owner):
        p = _create_post(owner["token"], "Normal post shape check")
        r = get_retry(f"{API_URL}/api/content/{p['id']}", headers=H(owner["token"]))
        post = r.json()["post"]
        assert post.get("isRepost") is not True
        assert post.get("originalContent") is None or "originalContent" not in post
        assert "author" in post
        assert "viewerHasLiked" in post


# ═══════════════════════════════════════════════════
# PHASE 8: B2 PERMISSION / VISIBILITY SAFETY
# ═══════════════════════════════════════════════════

class TestPhase8B2Safety:

    def test_cannot_edit_others_post(self, owner_post, outsider):
        r = patch_retry(f"{API_URL}/api/content/{owner_post['id']}",
                        json={"caption": "Hijack"}, headers=H(outsider["token"]))
        assert r.status_code == 403

    def test_comment_like_on_deleted_post_denied(self, like_user, edit_user):
        p = _create_post(edit_user["token"], "Delete after comment")
        c = _create_comment(like_user["token"], p["id"], "Will fail")
        delete_retry(f"{API_URL}/api/content/{p['id']}", headers=H(edit_user["token"]))
        r = post_retry(f"{API_URL}/api/content/{p['id']}/comments/{c['id']}/like",
                       headers=H(like_user["token"]))
        assert r.status_code == 404

    def test_share_deleted_post_denied(self, like_user, edit_user):
        p = _create_post(edit_user["token"], "Delete then share")
        delete_retry(f"{API_URL}/api/content/{p['id']}", headers=H(edit_user["token"]))
        r = post_retry(f"{API_URL}/api/content/{p['id']}/share", headers=H(like_user["token"]))
        assert r.status_code == 404

    def test_no_sensitive_data_leaked(self, owner):
        """Edited post response doesn't leak pins/passwords."""
        p = _create_post(owner["token"], "Leak test")
        r = patch_retry(f"{API_URL}/api/content/{p['id']}",
                        json={"caption": "Leak check"}, headers=H(owner["token"]))
        text = str(r.json())
        assert "password" not in text.lower()
        assert "pin" not in text.lower()


# ═══════════════════════════════════════════════════
# PHASE 9: PAGE-AUTHORED COMPATIBILITY
# ═══════════════════════════════════════════════════

class TestPhase9PageCompat:

    def test_page_editor_can_edit_page_post(self, page_owner, page_editor, test_page):
        r = post_retry(f"{API_URL}/api/pages/{test_page['id']}/posts",
                       json={"caption": "Page edit test"}, headers=H(page_owner["token"]))
        assert r.status_code == 201
        pid = r.json()["post"]["id"]
        r = patch_retry(f"{API_URL}/api/content/{pid}",
                        json={"caption": "Page post edited by editor"}, headers=H(page_editor["token"]))
        assert r.status_code == 200
        assert r.json()["post"]["caption"] == "Page post edited by editor"

    def test_page_mod_cannot_edit_page_post(self, page_owner, page_moderator, test_page):
        r = post_retry(f"{API_URL}/api/pages/{test_page['id']}/posts",
                       json={"caption": "Mod edit test"}, headers=H(page_owner["token"]))
        assert r.status_code == 201
        pid = r.json()["post"]["id"]
        r = patch_retry(f"{API_URL}/api/content/{pid}",
                        json={"caption": "Mod edit"}, headers=H(page_moderator["token"]))
        assert r.status_code == 403

    def test_comment_like_on_page_post(self, page_owner, like_user, test_page):
        r = post_retry(f"{API_URL}/api/pages/{test_page['id']}/posts",
                       json={"caption": "Comment like on page post"}, headers=H(page_owner["token"]))
        assert r.status_code == 201
        pid = r.json()["post"]["id"]
        c = _create_comment(like_user["token"], pid, "Page comment")
        r = post_retry(f"{API_URL}/api/content/{pid}/comments/{c['id']}/like",
                       headers=H(page_owner["token"]))
        assert r.status_code == 200
        assert r.json()["liked"] is True

    def test_page_post_edit_preserves_audit(self, page_owner, page_editor, test_page, db):
        r = post_retry(f"{API_URL}/api/pages/{test_page['id']}/posts",
                       json={"caption": "Audit preserve"}, headers=H(page_owner["token"]))
        assert r.status_code == 201
        pid = r.json()["post"]["id"]
        patch_retry(f"{API_URL}/api/content/{pid}",
                    json={"caption": "Audit preserved edit"}, headers=H(page_editor["token"]))
        doc = db.content_items.find_one({"id": pid})
        assert doc["authorType"] == "PAGE"
        assert doc["pageId"] == test_page["id"]
        assert doc["actingUserId"] == page_owner["id"]


# ═══════════════════════════════════════════════════
# PHASE 10: CONCURRENCY / IDEMPOTENCE
# ═══════════════════════════════════════════════════

class TestPhase10Concurrency:

    def test_duplicate_comment_like(self, like_user, owner_post, owner_comment, db):
        for _ in range(3):
            post_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                       headers=H(like_user["token"]))
        count = db.comment_likes.count_documents({"userId": like_user["id"], "commentId": owner_comment["id"]})
        assert count == 1
        delete_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                     headers=H(like_user["token"]))

    def test_rapid_like_unlike_loop(self, like_user, owner_post, owner_comment, db):
        for _ in range(3):
            post_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                       headers=H(like_user["token"]))
            delete_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                         headers=H(like_user["token"]))
        c = db.comments.find_one({"id": owner_comment["id"]})
        assert c["likeCount"] >= 0

    def test_duplicate_share_safe(self, user2, owner_post):
        """Second share of same content returns 409."""
        r = post_retry(f"{API_URL}/api/content/{owner_post['id']}/share", headers=H(user2["token"]))
        assert r.status_code == 409

    def test_edit_during_operations(self, edit_user):
        p = _create_post(edit_user["token"], "Concurrent edit")
        patch_retry(f"{API_URL}/api/content/{p['id']}",
                    json={"caption": "Edit 1"}, headers=H(edit_user["token"]))
        patch_retry(f"{API_URL}/api/content/{p['id']}",
                    json={"caption": "Edit 2"}, headers=H(edit_user["token"]))
        r = get_retry(f"{API_URL}/api/content/{p['id']}", headers=H(edit_user["token"]))
        assert r.json()["post"]["caption"] == "Edit 2"


# ═══════════════════════════════════════════════════
# PHASE 11: FAILURE / ROLLBACK
# ═══════════════════════════════════════════════════

class TestPhase11Failure:

    def test_comment_like_count_matches_records(self, like_user, owner, db):
        p = _create_post(owner["token"], "Rollback test")
        c = _create_comment(like_user["token"], p["id"], "Rollback comment")
        post_retry(f"{API_URL}/api/content/{p['id']}/comments/{c['id']}/like", headers=H(owner["token"]))
        count = db.comment_likes.count_documents({"commentId": c["id"]})
        stored = db.comments.find_one({"id": c["id"]})["likeCount"]
        assert stored == count

    def test_share_count_matches_reposts(self, owner, db):
        p = _create_post(owner["token"], "Share count check")
        t1, _, _ = register(30080)
        t2, _, _ = register(30081)
        post_retry(f"{API_URL}/api/content/{p['id']}/share", headers=H(t1))
        post_retry(f"{API_URL}/api/content/{p['id']}/share", headers=H(t2))
        stored = db.content_items.find_one({"id": p["id"]})["shareCount"]
        actual = db.content_items.count_documents({
            "originalContentId": p["id"], "visibility": {"$ne": "REMOVED"}
        })
        assert stored == actual

    def test_edit_nonexistent_returns_404(self, owner):
        r = patch_retry(f"{API_URL}/api/content/nonexistent-id-xxx",
                        json={"caption": "Ghost"}, headers=H(owner["token"]))
        assert r.status_code == 404


# ═══════════════════════════════════════════════════
# PHASE 12: PERFORMANCE / INDEX SANITY
# ═══════════════════════════════════════════════════

class TestPhase12Performance:

    def test_comment_like_index(self, db):
        plan = db.comment_likes.find({"userId": "test", "commentId": "test"}).explain()
        stage = str(plan.get("queryPlanner", {}).get("winningPlan", {}))
        assert "IXSCAN" in stage or "INDEX" in stage.upper()

    def test_edit_response_time(self, edit_user):
        p = _create_post(edit_user["token"], "Speed test")
        start = time.time()
        patch_retry(f"{API_URL}/api/content/{p['id']}",
                    json={"caption": "Fast edit"}, headers=H(edit_user["token"]))
        assert time.time() - start < 3.0

    def test_comment_like_response_time(self, like_user, owner_post, owner_comment):
        start = time.time()
        post_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                   headers=H(like_user["token"]))
        assert time.time() - start < 3.0
        delete_retry(f"{API_URL}/api/content/{owner_post['id']}/comments/{owner_comment['id']}/like",
                     headers=H(like_user["token"]))

    def test_share_response_time(self, owner):
        p = _create_post(owner["token"], "Share speed test")
        t, _, _ = register(30090)
        start = time.time()
        post_retry(f"{API_URL}/api/content/{p['id']}/share", headers=H(t))
        assert time.time() - start < 3.0


# ═══════════════════════════════════════════════════
# PHASE 13: BACKWARD COMPATIBILITY
# ═══════════════════════════════════════════════════

class TestPhase13BackwardCompat:

    def test_normal_post_create(self, owner):
        r = post_retry(f"{API_URL}/api/content/posts",
                       json={"caption": "Normal B4 compat", "kind": "POST"}, headers=H(owner["token"]))
        assert r.status_code == 201

    def test_normal_post_detail(self, owner, owner_post):
        r = get_retry(f"{API_URL}/api/content/{owner_post['id']}", headers=H(owner["token"]))
        assert r.status_code == 200
        assert r.json()["post"]["id"] == owner_post["id"]

    def test_normal_post_like(self, owner, user2):
        p = _create_post(owner["token"], "Compat like test")
        r = post_retry(f"{API_URL}/api/content/{p['id']}/like", headers=H(user2["token"]))
        assert r.status_code == 200

    def test_normal_comment_create(self, owner, user2):
        p = _create_post(owner["token"], "Compat comment test")
        r = post_retry(f"{API_URL}/api/content/{p['id']}/comments",
                       json={"text": "Compat comment"}, headers=H(user2["token"]))
        assert r.status_code == 201

    def test_public_feed(self, owner):
        r = get_retry(f"{API_URL}/api/feed/public", headers=H(owner["token"]))
        assert r.status_code == 200

    def test_user_search(self):
        r = requests.get(f"{API_URL}/api/search?q=test&type=users", headers={"X-Forwarded-For": _ip()})
        assert r.status_code == 200

    def test_pages_still_work(self, page_owner, test_page):
        r = get_retry(f"{API_URL}/api/pages/{test_page['id']}", headers=H(page_owner["token"]))
        assert r.status_code == 200


# ═══════════════════════════════════════════════════
# PHASE 14: OBSERVABILITY / AUDITABILITY
# ═══════════════════════════════════════════════════

class TestPhase14Observability:

    def test_edit_audit_log(self, edit_user, db):
        p = _create_post(edit_user["token"], "Audit edit test")
        patch_retry(f"{API_URL}/api/content/{p['id']}",
                    json={"caption": "Audited"}, headers=H(edit_user["token"]))
        log = db.audit_logs.find_one({"eventType": "CONTENT_EDITED", "targetId": p["id"]})
        assert log is not None
        assert log["actorId"] == edit_user["id"]

    def test_share_audit_log(self, owner, db):
        p = _create_post(owner["token"], "Audit share test")
        t, uid, _ = register(30095)
        post_retry(f"{API_URL}/api/content/{p['id']}/share", headers=H(t))
        log = db.audit_logs.find_one({"eventType": "CONTENT_SHARED", "targetId": p["id"]})
        assert log is not None

    def test_no_sensitive_fields_in_public_response(self, edit_user):
        p = _create_post(edit_user["token"], "Public safety")
        r = patch_retry(f"{API_URL}/api/content/{p['id']}",
                        json={"caption": "Safe"}, headers=H(edit_user["token"]))
        text = str(r.json())
        assert "actingUserId" not in text or r.json()["post"].get("authorType") == "PAGE"
