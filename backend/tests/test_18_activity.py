"""Category 18: ACTIVITY STATUS — Regression Tests"""
import pytest


class TestActivity:
    def test_heartbeat(self, api):
        """Update last seen."""
        r = api.post("/activity/heartbeat")
        assert r.status_code == 200
        d = r.json()
        data = d.get("data") or d
        assert data.get("status") == "active"

    def test_activity_friends(self, api):
        """Get activity of followed users."""
        r = api.get("/activity/friends")
        assert r.status_code == 200
        d = r.json()
        data = d.get("data") or d
        assert "items" in data
        assert "activeNow" in data

    def test_activity_status_by_id(self, api, user1_data):
        uid = user1_data.get("id") or user1_data.get("user", {}).get("id")
        if not uid:
            pytest.skip("No user id")
        r = api.get(f"/activity/status/{uid}")
        assert r.status_code == 200
        d = r.json()
        data = d.get("data") or d
        assert "status" in data
        assert data["status"] in ("active", "recently_active", "away", "offline", "hidden")

    def test_activity_settings(self, api):
        """Toggle activity visibility."""
        r = api.put("/activity/settings", json={"showActivityStatus": True})
        assert r.status_code == 200
        d = r.json()
        data = d.get("data") or d
        assert data.get("showActivityStatus") == True

    def test_activity_settings_hide(self, api):
        r = api.put("/activity/settings", json={"showActivityStatus": False})
        assert r.status_code == 200
        # Restore
        api.put("/activity/settings", json={"showActivityStatus": True})

    def test_activity_settings_validation(self, api):
        r = api.put("/activity/settings", json={"showActivityStatus": "yes"})
        assert r.status_code == 400

    def test_heartbeat_unauthenticated(self, anon):
        r = anon.post("/activity/heartbeat")
        assert r.status_code in (401, 403)
