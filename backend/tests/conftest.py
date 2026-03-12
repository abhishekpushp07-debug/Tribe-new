"""Shared fixtures for Tribe API regression tests."""
import os
import pytest
import requests

BASE_URL = "https://dev-hub-39.preview.emergentagent.com/api"
USER1 = {"phone": "7777099001", "pin": "1234"}
USER2 = {"phone": "7777099002", "pin": "1234"}


class APIClient:
    """Simple HTTP client for API testing."""
    def __init__(self, base_url: str):
        self.base = base_url
        self.session = requests.Session()
        self.token = None

    def login(self, phone: str, pin: str):
        r = self.session.post(f"{self.base}/auth/login", json={"phone": phone, "pin": pin})
        assert r.status_code == 200, f"Login failed: {r.text}"
        data = r.json()
        self.token = data.get("accessToken") or data.get("data", {}).get("accessToken")
        assert self.token, f"No token in response: {data}"
        self.session.headers["Authorization"] = f"Bearer {self.token}"
        return data

    def get(self, path: str, **kwargs):
        return self.session.get(f"{self.base}{path}", **kwargs)

    def post(self, path: str, **kwargs):
        return self.session.post(f"{self.base}{path}", **kwargs)

    def put(self, path: str, **kwargs):
        return self.session.put(f"{self.base}{path}", **kwargs)

    def patch(self, path: str, **kwargs):
        return self.session.patch(f"{self.base}{path}", **kwargs)

    def delete(self, path: str, **kwargs):
        return self.session.delete(f"{self.base}{path}", **kwargs)


@pytest.fixture(scope="session")
def api():
    """Authenticated API client for user 1."""
    c = APIClient(BASE_URL)
    c.login(USER1["phone"], USER1["pin"])
    return c


@pytest.fixture(scope="session")
def api2():
    """Authenticated API client for user 2."""
    c = APIClient(BASE_URL)
    c.login(USER2["phone"], USER2["pin"])
    return c


@pytest.fixture(scope="session")
def anon():
    """Unauthenticated API client."""
    return APIClient(BASE_URL)


@pytest.fixture(scope="session")
def user1_data(api):
    """User 1 profile data."""
    r = api.get("/auth/me")
    if r.status_code == 200:
        d = r.json()
        return d.get("data") or d
    return {}


@pytest.fixture(scope="session")
def sample_tribe_id(api):
    """A real tribe ID from the DB."""
    r = api.get("/tribes")
    data = r.json()
    items = data.get("items") or data.get("data", {}).get("items", [])
    assert len(items) > 0, "No tribes found"
    return items[0]["id"]


@pytest.fixture(scope="session")
def sample_post_id(api):
    """A real post ID from the feed."""
    r = api.get("/feed")
    data = r.json()
    items = data.get("items") or data.get("data", {}).get("items", [])
    if items:
        return items[0]["id"]
    return None


@pytest.fixture(scope="session")
def sample_reel_id(api):
    """A real reel ID from the feed."""
    r = api.get("/reels/feed")
    data = r.json()
    items = data.get("items") or data.get("data", {}).get("items", [])
    if items:
        return items[0]["id"]
    return None
