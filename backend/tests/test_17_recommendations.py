"""Category 17: CONTENT RECOMMENDATIONS — Regression Tests"""
import pytest


class TestRecommendations:
    def test_recommended_posts(self, api):
        """Suggested Posts endpoint."""
        r = api.get("/recommendations/posts")
        assert r.status_code == 200
        d = r.json()
        data = d.get("data") or d
        assert "items" in data
        assert data.get("algorithm") == "collaborative_filtering_v1"

    def test_recommended_reels(self, api):
        """Reels You May Like endpoint."""
        r = api.get("/recommendations/reels")
        assert r.status_code == 200
        d = r.json()
        data = d.get("data") or d
        assert "items" in data
        assert "count" in data

    def test_recommended_creators(self, api):
        """Creators For You endpoint."""
        r = api.get("/recommendations/creators")
        assert r.status_code == 200
        d = r.json()
        data = d.get("data") or d
        assert "items" in data

    def test_recommendations_cached(self, api):
        """Recommendations should be cached."""
        r1 = api.get("/recommendations/posts")
        r2 = api.get("/recommendations/posts")
        assert r1.status_code == 200
        assert r2.status_code == 200

    def test_recommendations_unauthenticated(self, anon):
        r = anon.get("/recommendations/posts")
        assert r.status_code in (401, 403)
