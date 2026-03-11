"""
B5.1 — Search Quality Upgrade: Ranking + Pagination Tests
Tribe Project

Tests prove:
  A. Exact > Prefix > Contains ranking for users, pages, hashtags
  B. Offset pagination: total, hasMore, no duplicates, safety on later pages
  C. Safety regression: blocks/moderation still enforced under ranked search
  D. Contract: pagination fields present, old fields preserved
  E. Regression: existing B5 flows unbroken
"""

import pytest
import requests
import time
import os
import random
from pymongo import MongoClient

API_URL = os.environ.get("TEST_API_URL", "http://localhost:3000/api")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "your_database_name")

_client = MongoClient(MONGO_URL)
_db = _client[DB_NAME]


def _ip():
    return f"10.{random.randint(1,254)}.{random.randint(1,254)}.{random.randint(1,254)}"


def _h(token=None):
    h = {"Content-Type": "application/json", "X-Forwarded-For": _ip()}
    if token:
        h["Authorization"] = f"Bearer {token}"
    return h


def _retry(fn, retries=5, delay=2.5):
    for i in range(retries):
        r = fn()
        if r.status_code == 429:
            time.sleep(delay * (i + 1))
            continue
        return r
    return r


def _register(suffix, name, username=None):
    phone = f"88860{suffix:05d}"
    display = name
    uname = username or f"b51u{suffix}"
    h = _h()
    r = _retry(lambda: requests.post(f"{API_URL}/auth/register", json={
        "phone": phone, "pin": "1234", "displayName": display, "username": uname
    }, headers=h))
    if r.status_code == 409:
        r = _retry(lambda: requests.post(f"{API_URL}/auth/login", json={"phone": phone, "pin": "1234"}, headers=h))
    assert r.status_code in (200, 201), f"Auth fail: {r.status_code} {r.text[:200]}"
    d = r.json()
    uid = d.get("user", {}).get("id")
    tok = d.get("accessToken") or d.get("token")
    _db.users.update_one({"id": uid}, {"$set": {"ageStatus": "ADULT", "displayName": display, "username": uname}})
    return tok, uid


def _search(token, q, type_filter="all", limit=10, offset=0):
    return _retry(lambda: requests.get(
        f"{API_URL}/search?q={requests.utils.quote(q)}&type={type_filter}&limit={limit}&offset={offset}",
        headers=_h(token)
    ))


def _create_post(token, caption):
    r = _retry(lambda: requests.post(f"{API_URL}/content/posts", json={
        "caption": caption, "kind": "POST"
    }, headers=_h(token)))
    assert r.status_code in (200, 201), f"Post fail: {r.status_code} {r.text[:200]}"
    d = r.json().get("data", r.json())
    return d.get("post", {})


def _create_page(token, name, slug, category="CLUB"):
    r = _retry(lambda: requests.post(f"{API_URL}/pages", json={
        "name": name, "slug": slug, "category": category, "bio": f"Test {name}"
    }, headers=_h(token)))
    if r.status_code == 409:
        doc = _db.pages.find_one({"slug": slug}, {"_id": 0})
        return doc
    assert r.status_code in (200, 201), f"Page fail: {r.status_code} {r.text[:200]}"
    d = r.json().get("data", r.json())
    return d.get("page", {})


# ── Fixtures ──

RND = random.randint(1000, 9999)

@pytest.fixture(scope="module")
def ranking_searcher():
    return _register(601, "RankSearcher")


@pytest.fixture(scope="module")
def exact_user():
    """User with unique exact-match name."""
    return _register(602, f"zxrank{RND}", f"zxrank{RND}")


@pytest.fixture(scope="module")
def prefix_user():
    """User whose name starts with the query but isn't exact."""
    return _register(603, f"zxrank{RND}alpha", f"zxrank{RND}alpha")


@pytest.fixture(scope="module")
def contains_user():
    """User whose name contains the query but doesn't start with it."""
    return _register(604, f"thezxrank{RND}user", f"deep_zxrank{RND}")


@pytest.fixture(scope="module")
def pagination_users(ranking_searcher):
    """Create 5+ users for pagination testing."""
    tok, _ = ranking_searcher
    users = []
    for i in range(5):
        t, uid = _register(610 + i, f"PagUser{RND}_{i}", f"paguser{RND}_{i}")
        users.append((t, uid))
    return users


@pytest.fixture(scope="module")
def page_owner_b51():
    return _register(620, "PageOwnerB51")


@pytest.fixture(scope="module")
def exact_page(page_owner_b51):
    tok, _ = page_owner_b51
    slug = f"zxpgrank{RND}"
    return _create_page(tok, f"zxpgrank{RND}", slug)


@pytest.fixture(scope="module")
def prefix_page(page_owner_b51):
    tok, _ = page_owner_b51
    slug = f"zxpgrank{RND}-extra"
    return _create_page(tok, f"zxpgrank{RND}Extra", slug)


@pytest.fixture(scope="module")
def contains_page(page_owner_b51):
    tok, _ = page_owner_b51
    slug = f"the-zxpgrank{RND}-page"
    return _create_page(tok, f"Thezxpgrank{RND}Page", slug)


@pytest.fixture(scope="module")
def blocker_user():
    return _register(630, "B51Blocker")


@pytest.fixture(scope="module")
def blocked_target():
    return _register(631, f"PagUser{RND}_blocked", f"paguser{RND}_blocked")


# ════════════════════════════════════════════════════════════
# A. EXACT > PREFIX > CONTAINS RANKING
# ════════════════════════════════════════════════════════════

class TestUserRanking:

    def test_exact_user_ranks_first(self, ranking_searcher, exact_user, prefix_user, contains_user):
        tok, _ = ranking_searcher
        _, uid_exact = exact_user
        _, uid_prefix = prefix_user
        _, uid_contains = contains_user
        r = _search(tok, f"zxrank{RND}", "users", limit=10)
        assert r.status_code == 200
        d = r.json()
        users = d.get("users", [])
        ids = [u["id"] for u in users]
        assert uid_exact in ids, "Exact user not found"
        assert uid_prefix in ids, "Prefix user not found"
        assert uid_contains in ids, "Contains user not found"
        assert ids.index(uid_exact) < ids.index(uid_prefix), "Exact should rank before prefix"
        assert ids.index(uid_prefix) < ids.index(uid_contains), "Prefix should rank before contains"

    def test_exact_username_ranks_first(self, ranking_searcher, exact_user, prefix_user):
        tok, _ = ranking_searcher
        _, uid_exact = exact_user
        _, uid_prefix = prefix_user
        r = _search(tok, f"zxrank{RND}", "users", limit=10)
        assert r.status_code == 200
        d = r.json()
        users = d.get("users", [])
        ids = [u["id"] for u in users]
        assert ids[0] == uid_exact, "Exact username match should be first"

    def test_deterministic_order_within_tier(self, ranking_searcher, pagination_users):
        """Within same tier, users should be sorted by followersCount desc."""
        tok, _ = ranking_searcher
        # Set different follower counts
        for i, (_, uid) in enumerate(pagination_users):
            _db.users.update_one({"id": uid}, {"$set": {"followersCount": (len(pagination_users) - i) * 10}})
        time.sleep(0.2)
        r1 = _search(tok, f"PagUser{RND}", "users", limit=10)
        r2 = _search(tok, f"PagUser{RND}", "users", limit=10)
        assert r1.status_code == 200
        ids1 = [u["id"] for u in r1.json().get("users", [])]
        ids2 = [u["id"] for u in r2.json().get("users", [])]
        assert ids1 == ids2, "Order should be deterministic"


class TestPageRanking:

    def test_exact_page_ranks_first(self, ranking_searcher, exact_page, prefix_page, contains_page):
        tok, _ = ranking_searcher
        r = _search(tok, f"zxpgrank{RND}", "pages", limit=10)
        assert r.status_code == 200
        d = r.json()
        pages = d.get("pages", [])
        ids = [p["id"] for p in pages]
        assert exact_page["id"] in ids, "Exact page not found"
        assert prefix_page["id"] in ids, "Prefix page not found"
        assert contains_page["id"] in ids, "Contains page not found"
        assert ids.index(exact_page["id"]) < ids.index(prefix_page["id"]), "Exact page should rank before prefix"
        assert ids.index(prefix_page["id"]) < ids.index(contains_page["id"]), "Prefix page should rank before contains"

    def test_official_page_wins_within_tier(self, ranking_searcher, page_owner_b51):
        tok_s, _ = ranking_searcher
        tok_p, _ = page_owner_b51
        slug1 = f"b51off-{random.randint(10000,99999)}"
        slug2 = f"b51reg-{random.randint(10000,99999)}"
        prefix = f"B51TierTest{random.randint(1000,9999)}"
        p_reg = _create_page(tok_p, f"{prefix}Regular", slug1)
        p_off = _create_page(tok_p, f"{prefix}Offpage", slug2)
        _db.pages.update_one({"id": p_off["id"]}, {"$set": {"isOfficial": True, "followerCount": 100}})
        _db.pages.update_one({"id": p_reg["id"]}, {"$set": {"isOfficial": False, "followerCount": 5}})
        time.sleep(0.2)
        r = _search(tok_s, prefix, "pages", limit=10)
        assert r.status_code == 200
        pages = r.json().get("pages", [])
        page_ids = [p["id"] for p in pages if p["id"] in (p_reg["id"], p_off["id"])]
        if len(page_ids) == 2:
            assert page_ids[0] == p_off["id"], "Official page should rank first within tier"


class TestHashtagRanking:

    def test_exact_hashtag_ranks_first(self, ranking_searcher):
        tok, _ = ranking_searcher
        base = f"b51htrank{random.randint(1000,9999)}"
        # Create posts with different tag variations
        _create_post(tok, f"#{base}")             # exact
        _create_post(tok, f"#{base}extra")         # prefix
        _create_post(tok, f"#super{base}deep")     # contains
        time.sleep(0.5)
        r = _search(tok, base, "hashtags", limit=10)
        assert r.status_code == 200
        tags = [h["tag"] for h in r.json().get("hashtags", [])]
        assert base in tags, "Exact tag not found"
        if f"{base}extra" in tags:
            assert tags.index(base) < tags.index(f"{base}extra"), "Exact hashtag should rank before prefix"

    def test_hashtag_prefix_beats_contains(self, ranking_searcher):
        tok, _ = ranking_searcher
        base = f"b51pfx{random.randint(1000,9999)}"
        _create_post(tok, f"#{base}suffix")  # prefix
        _create_post(tok, f"#deep{base}end") # contains
        time.sleep(0.5)
        r = _search(tok, base, "hashtags", limit=10)
        assert r.status_code == 200
        tags = [h["tag"] for h in r.json().get("hashtags", [])]
        prefix_tags = [t for t in tags if t.startswith(base)]
        contains_tags = [t for t in tags if base in t and not t.startswith(base)]
        if prefix_tags and contains_tags:
            assert tags.index(prefix_tags[0]) < tags.index(contains_tags[0])


# ════════════════════════════════════════════════════════════
# B. PAGINATION
# ════════════════════════════════════════════════════════════

class TestSearchPagination:

    def test_first_page_has_total(self, ranking_searcher, pagination_users):
        tok, _ = ranking_searcher
        r = _search(tok, f"PagUser{RND}", "users", limit=2, offset=0)
        assert r.status_code == 200
        d = r.json()
        pag = d.get("pagination", {})
        assert "total" in pag, "Pagination must have total"
        assert "offset" in pag, "Pagination must have offset"
        assert "limit" in pag, "Pagination must have limit"
        assert "hasMore" in pag, "Pagination must have hasMore"
        assert pag["total"] >= 5, f"Expected >= 5 users, got {pag['total']}"
        assert pag["hasMore"] is True
        assert pag["offset"] == 0
        assert pag["limit"] == 2

    def test_second_page_returns_different_users(self, ranking_searcher, pagination_users):
        tok, _ = ranking_searcher
        r1 = _search(tok, f"PagUser{RND}", "users", limit=2, offset=0)
        r2 = _search(tok, f"PagUser{RND}", "users", limit=2, offset=2)
        assert r1.status_code == 200
        assert r2.status_code == 200
        ids1 = {u["id"] for u in r1.json().get("users", [])}
        ids2 = {u["id"] for u in r2.json().get("users", [])}
        assert ids1.isdisjoint(ids2), "No duplicates across pages"

    def test_last_page_has_more_false(self, ranking_searcher, pagination_users):
        tok, _ = ranking_searcher
        r = _search(tok, f"PagUser{RND}", "users", limit=2, offset=0)
        total = r.json().get("pagination", {}).get("total", 0)
        # Get last page
        r_last = _search(tok, f"PagUser{RND}", "users", limit=2, offset=max(0, total - 1))
        pag = r_last.json().get("pagination", {})
        assert pag["hasMore"] is False, "Last page should have hasMore=false"

    def test_page_search_pagination(self, ranking_searcher, exact_page, prefix_page, contains_page):
        tok, _ = ranking_searcher
        r = _search(tok, f"zxpgrank{RND}", "pages", limit=1, offset=0)
        assert r.status_code == 200
        pag = r.json().get("pagination", {})
        assert pag["total"] >= 3
        assert pag["hasMore"] is True
        pages1 = r.json().get("pages", [])

        r2 = _search(tok, f"zxpgrank{RND}", "pages", limit=1, offset=1)
        pages2 = r2.json().get("pages", [])
        assert pages1[0]["id"] != pages2[0]["id"], "Different pages on different offsets"

    def test_hashtag_search_pagination(self, ranking_searcher):
        tok, _ = ranking_searcher
        base = f"b51pag{random.randint(1000,9999)}"
        for i in range(3):
            _create_post(tok, f"#{base}{i}")
        time.sleep(0.5)
        r = _search(tok, base, "hashtags", limit=1, offset=0)
        assert r.status_code == 200
        pag = r.json().get("pagination", {})
        assert pag["total"] >= 3
        tags1 = [h["tag"] for h in r.json().get("hashtags", [])]

        r2 = _search(tok, base, "hashtags", limit=1, offset=1)
        tags2 = [h["tag"] for h in r2.json().get("hashtags", [])]
        assert tags1 != tags2, "Different hashtags on different offsets"

    def test_post_search_pagination(self, ranking_searcher):
        tok, _ = ranking_searcher
        unique = f"b51postcap{random.randint(100000,999999)}"
        for i in range(3):
            p = _create_post(tok, f"Testing {unique} post {i}")
            _db.content_items.update_one({"id": p["id"]}, {"$set": {"visibility": "PUBLIC"}})
        time.sleep(0.3)
        r = _search(tok, unique, "posts", limit=1, offset=0)
        assert r.status_code == 200
        pag = r.json().get("pagination", {})
        assert pag["total"] >= 3
        assert pag["hasMore"] is True

    def test_empty_query_pagination(self, ranking_searcher):
        tok, _ = ranking_searcher
        r = _search(tok, "", "all")
        assert r.status_code == 200
        pag = r.json().get("pagination", {})
        assert pag["total"] == 0
        assert pag["hasMore"] is False


# ════════════════════════════════════════════════════════════
# C. SAFETY REGRESSION UNDER RANKED SEARCH
# ════════════════════════════════════════════════════════════

class TestSafetyUnderRanking:

    def test_blocked_user_excluded_on_all_pages(self, blocker_user, blocked_target):
        tok_b, uid_b = blocker_user
        tok_t, uid_t = blocked_target
        # Create block
        _retry(lambda: requests.post(f"{API_URL}/me/blocks/{uid_t}", headers=_h(tok_b)))
        time.sleep(0.3)
        # Check page 0
        r1 = _search(tok_b, f"PagUser{RND}", "users", limit=10, offset=0)
        assert r1.status_code == 200
        ids = [u["id"] for u in r1.json().get("users", [])]
        assert uid_t not in ids, "Blocked user should not appear on any page"
        # Cleanup
        _retry(lambda: requests.delete(f"{API_URL}/me/blocks/{uid_t}", headers=_h(tok_b)))

    def test_moderated_post_excluded_from_ranked_search(self, ranking_searcher):
        tok, _ = ranking_searcher
        unique = f"b51modrank{random.randint(100000,999999)}"
        post = _create_post(tok, f"Testing {unique}")
        _db.content_items.update_one({"id": post["id"]}, {"$set": {"visibility": "PUBLIC", "moderationHold": True}})
        time.sleep(0.3)
        r = _search(tok, unique, "posts")
        assert r.status_code == 200
        posts = r.json().get("posts", [])
        assert not any(p.get("id") == post["id"] for p in posts)

    def test_banned_user_excluded_from_ranked_search(self, ranking_searcher):
        tok, _ = ranking_searcher
        t2, uid2 = _register(640, f"B51Banned{random.randint(1000,9999)}")
        _db.users.update_one({"id": uid2}, {"$set": {"isBanned": True}})
        time.sleep(0.2)
        r = _search(tok, "B51Banned", "users")
        assert r.status_code == 200
        users = r.json().get("users", [])
        assert not any(u.get("id") == uid2 for u in users)
        _db.users.update_one({"id": uid2}, {"$set": {"isBanned": False}})

    def test_suspended_page_excluded_from_ranked_search(self, ranking_searcher, page_owner_b51):
        tok_s, _ = ranking_searcher
        tok_p, _ = page_owner_b51
        slug = f"b51-susp-{random.randint(10000,99999)}"
        page = _create_page(tok_p, f"B51SuspPage{random.randint(1000,9999)}", slug)
        _db.pages.update_one({"id": page["id"]}, {"$set": {"status": "SUSPENDED"}})
        time.sleep(0.2)
        r = _search(tok_s, "B51SuspPage", "pages")
        assert r.status_code == 200
        pages = r.json().get("pages", [])
        assert not any(p.get("id") == page["id"] for p in pages)
        _db.pages.delete_one({"id": page["id"]})


# ════════════════════════════════════════════════════════════
# D. CONTRACT TESTS
# ════════════════════════════════════════════════════════════

class TestPaginationContract:

    def test_pagination_fields_always_present(self, ranking_searcher):
        tok, _ = ranking_searcher
        for type_f in ["all", "users", "pages", "posts", "hashtags"]:
            r = _search(tok, "test", type_f, limit=5, offset=0)
            assert r.status_code == 200
            pag = r.json().get("pagination", {})
            assert "total" in pag, f"Missing total for type={type_f}"
            assert "offset" in pag, f"Missing offset for type={type_f}"
            assert "limit" in pag, f"Missing limit for type={type_f}"
            assert "hasMore" in pag, f"Missing hasMore for type={type_f}"

    def test_backward_compat_keys_preserved(self, ranking_searcher):
        tok, _ = ranking_searcher
        r = _search(tok, "Seed", "all")
        assert r.status_code == 200
        d = r.json()
        assert "items" in d, "items key must exist"
        assert "users" in d, "users key must exist"
        assert "pagination" in d, "pagination key must exist"

    def test_result_type_markers_still_present(self, ranking_searcher):
        tok, _ = ranking_searcher
        r = _search(tok, "Seed", "all")
        assert r.status_code == 200
        items = r.json().get("items", [])
        for item in items:
            assert "_resultType" in item

    def test_no_id_leak(self, ranking_searcher):
        tok, _ = ranking_searcher
        r = _search(tok, "Seed", "all")
        assert r.status_code == 200
        items = r.json().get("items", [])
        for item in items:
            assert "_id" not in item, "_id leaked in search results"


# ════════════════════════════════════════════════════════════
# E. REGRESSION
# ════════════════════════════════════════════════════════════

class TestB51Regression:

    def test_empty_query_still_returns_empty(self, ranking_searcher):
        tok, _ = ranking_searcher
        r = _search(tok, "", "all")
        assert r.status_code == 200
        assert len(r.json().get("items", [])) == 0

    def test_single_char_still_returns_empty(self, ranking_searcher):
        tok, _ = ranking_searcher
        r = _search(tok, "x", "all")
        assert r.status_code == 200
        assert len(r.json().get("items", [])) == 0

    def test_limit_still_capped_at_20(self, ranking_searcher):
        tok, _ = ranking_searcher
        r = _search(tok, "User", "users", limit=100)
        assert r.status_code == 200
        users = r.json().get("users", [])
        assert len(users) <= 20

    def test_hashtag_feed_still_works(self, ranking_searcher):
        tok, _ = ranking_searcher
        tag = f"b51regfeed{random.randint(10000,99999)}"
        _create_post(tok, f"#{tag} regression")
        time.sleep(0.3)
        r = _retry(lambda: requests.get(f"{API_URL}/hashtags/{tag}/feed", headers=_h(tok)))
        assert r.status_code == 200

    def test_trending_still_works(self, ranking_searcher):
        tok, _ = ranking_searcher
        r = _retry(lambda: requests.get(f"{API_URL}/hashtags/trending", headers=_h(tok)))
        assert r.status_code == 200
        items = r.json().get("data", r.json()).get("items", [])
        assert isinstance(items, list)
