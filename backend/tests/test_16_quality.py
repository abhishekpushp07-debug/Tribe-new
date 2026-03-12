"""Category 16: CONTENT QUALITY SCORING — Regression Tests"""
import pytest


class TestQuality:
    def test_batch_score(self, api):
        """Batch score unscored content."""
        r = api.post("/quality/batch", json={})
        assert r.status_code == 200
        d = r.json()
        data = d.get("data") or d
        assert "posts" in data
        assert "reels" in data

    def test_dashboard(self, api):
        """Quality dashboard returns overview."""
        r = api.get("/quality/dashboard")
        assert r.status_code == 200
        d = r.json()
        data = d.get("data") or d
        assert "overview" in data
        assert "gradeDistribution" in data
        assert "thresholds" in data

    def test_check_quality(self, api, sample_post_id):
        if not sample_post_id:
            pytest.skip("No posts")
        r = api.get(f"/quality/check/{sample_post_id}")
        assert r.status_code == 200
        d = r.json()
        data = d.get("data") or d
        assert "score" in data
        assert "grade" in data
        assert "breakdown" in data

    def test_score_single_post(self, api, sample_post_id):
        if not sample_post_id:
            pytest.skip("No posts")
        r = api.post("/quality/score", json={"contentId": sample_post_id})
        assert r.status_code == 200
        d = r.json()
        data = d.get("data") or d
        assert data["score"] >= 0
        assert data["score"] <= 100
        assert data["grade"] in ("A", "B", "C", "D", "F")

    def test_quality_not_found(self, api):
        r = api.get("/quality/check/nonexistent-id")
        assert r.status_code == 404
