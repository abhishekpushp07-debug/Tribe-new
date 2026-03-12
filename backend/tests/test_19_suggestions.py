"""Category 19: SMART SUGGESTIONS — Regression Tests"""
import pytest


class TestSuggestions:
    def test_people_suggestions(self, api):
        """People You May Know."""
        r = api.get("/suggestions/people")
        assert r.status_code == 200
        d = r.json()
        data = d.get("data") or d
        assert "items" in data
        assert data.get("algorithm") == "social_graph_v1"
        if data["items"]:
            person = data["items"][0]
            assert "user" in person
            assert "reasons" in person
            assert "mutualFollows" in person

    def test_trending_suggestions(self, api):
        """Trending in your college/globally."""
        r = api.get("/suggestions/trending")
        assert r.status_code == 200
        d = r.json()
        data = d.get("data") or d
        assert "hashtags" in data
        assert "topPosts" in data
        assert "topCreators" in data
        assert "scope" in data

    def test_tribe_suggestions(self, api):
        """Tribes For You."""
        r = api.get("/suggestions/tribes")
        assert r.status_code == 200
        d = r.json()
        data = d.get("data") or d
        assert "items" in data
        assert "count" in data

    def test_people_suggestions_with_limit(self, api):
        r = api.get("/suggestions/people?limit=5")
        assert r.status_code == 200
        d = r.json()
        data = d.get("data") or d
        assert len(data.get("items", [])) <= 5

    def test_suggestions_unauthenticated(self, anon):
        r = anon.get("/suggestions/people")
        assert r.status_code in (401, 403)
