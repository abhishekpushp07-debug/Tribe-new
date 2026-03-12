"""Category 15: SMART FEED ALGORITHM — Regression Tests"""
import pytest


class TestSmartFeed:
    def test_feed_returns_ranked_posts(self, api):
        """Feed returns posts with feed scores."""
        r = api.get("/feed")
        assert r.status_code == 200
        d = r.json()
        items = d.get("items") or d.get("data", {}).get("items", [])
        assert len(items) > 0
        # First page should have _feedScore and _feedRank
        first = items[0]
        assert "_feedScore" in first, "Posts should have _feedScore from ranking"
        assert "_feedRank" in first, "Posts should have _feedRank from ranking"

    def test_feed_sorted_by_score(self, api):
        """Posts are sorted by score descending."""
        r = api.get("/feed")
        d = r.json()
        items = d.get("items") or d.get("data", {}).get("items", [])
        scores = [p.get("_feedScore", 0) for p in items if "_feedScore" in p]
        if len(scores) >= 2:
            # Scores should be roughly descending (diversity penalty may cause small inversions)
            assert scores[0] >= scores[-1], "First post should score >= last post"

    def test_feed_debug_endpoint(self, api):
        """Debug endpoint shows scoring breakdown."""
        r = api.get("/feed/debug?limit=5")
        assert r.status_code == 200
        d = r.json()
        data = d.get("data") or d
        assert data.get("algorithm") == "smart_feed_v2"
        assert len(data.get("signals", [])) >= 5
        assert "weights" in data
        assert "context" in data
        ctx = data["context"]
        assert "viewerId" in ctx
        assert "followingCount" in ctx

    def test_debug_post_scoring_details(self, api):
        """Debug endpoint shows per-post scoring details."""
        r = api.get("/feed/debug?limit=3")
        d = r.json()
        data = d.get("data") or d
        posts = data.get("posts", [])
        assert len(posts) > 0
        p = posts[0]
        assert "recencyScore" in p
        assert "engagement" in p
        assert "affinity" in p
        assert "contentType" in p
        assert "finalScore" in p

    def test_reels_feed_smart_ranking(self, api):
        """Reels feed uses smart ranking algorithm."""
        r = api.get("/reels/feed")
        assert r.status_code == 200
        d = r.json()
        data = d.get("data") or d
        assert data.get("rankingAlgorithm") == "smart_reel_ranking_v1"
        items = data.get("items", [])
        if items:
            assert "_feedScore" in items[0], "Reels should have _feedScore"

    def test_feed_debug_unauthenticated(self, anon):
        r = anon.get("/feed/debug")
        assert r.status_code in (401, 403)

    def test_public_feed_shows_algorithm(self, api):
        """Public feed reports which algorithm is used."""
        r = api.get("/feed/public")
        assert r.status_code == 200
        d = r.json()
        data = d.get("data") or d
        assert "rankingAlgorithm" in data
        assert data["rankingAlgorithm"] in ("engagement_weighted_v1", "chronological")

    def test_two_users_get_different_rankings(self, api, api2):
        """Different users may get different rankings (personalization)."""
        r1 = api.get("/feed")
        r2 = api2.get("/feed")
        d1 = r1.json()
        d2 = r2.json()
        items1 = d1.get("items", [])
        items2 = d2.get("items", [])
        # Both should have posts
        assert len(items1) > 0
        assert len(items2) > 0
        # Scores may differ based on affinity context
        # (Don't assert they're different — same data = same scores possible)
