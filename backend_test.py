#!/usr/bin/env python3
"""
Comprehensive Backend API Testing for Tribe Social Platform
Tests all endpoints according to the test flow specified in the review request.

Base URL: http://localhost:3000/api
Auth: Phone (10 digits) + PIN (4 digits) → returns session token as Bearer token
Test users: 9999999001, 9999999002, etc.
PIN: 4 digits like "1234"
"""

import requests
import json
import sys
import time
from typing import Dict, Any, Optional

# Configuration
BASE_URL = "http://localhost:3000/api"
HEADERS = {"Content-Type": "application/json"}

# Test data
TEST_USERS = [
    {"phone": "9999999001", "pin": "1234", "displayName": "Test User 1"},
    {"phone": "9999999002", "pin": "1235", "displayName": "Test User 2"},
    {"phone": "9999999003", "pin": "1236", "displayName": "Test User 3"},
]

# Global storage for test data
test_data = {
    "users": [],
    "tokens": [],
    "posts": [],
    "colleges": [],
    "comments": [],
    "reports": []
}

class TestResult:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.errors = []
    
    def success(self, test_name: str, message: str = ""):
        self.passed += 1
        print(f"✅ {test_name}: PASSED {message}")
    
    def fail(self, test_name: str, message: str):
        self.failed += 1
        self.errors.append(f"{test_name}: {message}")
        print(f"❌ {test_name}: FAILED - {message}")
    
    def summary(self):
        total = self.passed + self.failed
        print(f"\n{'='*60}")
        print(f"TEST SUMMARY")
        print(f"{'='*60}")
        print(f"Total Tests: {total}")
        print(f"Passed: {self.passed}")
        print(f"Failed: {self.failed}")
        print(f"Success Rate: {(self.passed/total*100) if total > 0 else 0:.1f}%")
        
        if self.errors:
            print(f"\nFAILURES:")
            for error in self.errors:
                print(f"  - {error}")

result = TestResult()

def make_request(method: str, endpoint: str, data: Dict[Any, Any] = None, 
                headers: Dict[str, str] = None, token: str = None) -> tuple:
    """Make HTTP request and return (response, success)"""
    url = f"{BASE_URL}{endpoint}"
    req_headers = HEADERS.copy()
    
    if headers:
        req_headers.update(headers)
    
    if token:
        req_headers["Authorization"] = f"Bearer {token}"
    
    try:
        if method == "GET":
            response = requests.get(url, headers=req_headers, timeout=10)
        elif method == "POST":
            response = requests.post(url, json=data, headers=req_headers, timeout=10)
        elif method == "PATCH":
            response = requests.patch(url, json=data, headers=req_headers, timeout=10)
        elif method == "DELETE":
            response = requests.delete(url, headers=req_headers, timeout=10)
        else:
            return None, False
        
        return response, True
    except Exception as e:
        print(f"Request failed: {e}")
        return None, False

def test_health_endpoints():
    """Test health check endpoints"""
    print("\n🔍 Testing Health Endpoints...")
    
    # Test root endpoint
    response, success = make_request("GET", "/")
    if success and response.status_code == 200:
        result.success("Root endpoint", f"Status: {response.status_code}")
    else:
        result.fail("Root endpoint", f"Status: {response.status_code if response else 'No response'}")
    
    # Test healthz
    response, success = make_request("GET", "/healthz")
    if success and response.status_code == 200:
        result.success("Health check", f"Status: {response.status_code}")
    else:
        result.fail("Health check", f"Status: {response.status_code if response else 'No response'}")
    
    # Test readyz (DB connection)
    response, success = make_request("GET", "/readyz")
    if success and response.status_code == 200:
        result.success("Readiness check", f"Status: {response.status_code}")
    else:
        result.fail("Readiness check", f"Status: {response.status_code if response else 'No response'}")

def test_user_registration():
    """Test user registration"""
    print("\n🔍 Testing User Registration...")
    
    for i, user_data in enumerate(TEST_USERS):
        response, success = make_request("POST", "/auth/register", user_data)
        
        if success and response.status_code == 201:
            data = response.json()
            if "token" in data and "user" in data:
                test_data["users"].append(data["user"])
                test_data["tokens"].append(data["token"])
                result.success(f"Register User {i+1}", f"ID: {data['user']['id']}")
            else:
                result.fail(f"Register User {i+1}", "Missing token or user in response")
        else:
            result.fail(f"Register User {i+1}", 
                       f"Status: {response.status_code if response else 'No response'}")

def test_user_login():
    """Test user login"""
    print("\n🔍 Testing User Login...")
    
    for i, user_data in enumerate(TEST_USERS[:2]):  # Test first 2 users
        login_data = {"phone": user_data["phone"], "pin": user_data["pin"]}
        response, success = make_request("POST", "/auth/login", login_data)
        
        if success and response.status_code == 200:
            data = response.json()
            if "token" in data:
                result.success(f"Login User {i+1}", f"Got token")
            else:
                result.fail(f"Login User {i+1}", "Missing token in response")
        else:
            result.fail(f"Login User {i+1}", 
                       f"Status: {response.status_code if response else 'No response'}")

def test_auth_me():
    """Test getting current user info"""
    print("\n🔍 Testing Auth Me...")
    
    if not test_data["tokens"]:
        result.fail("Auth Me", "No tokens available")
        return
    
    for i, token in enumerate(test_data["tokens"][:2]):
        response, success = make_request("GET", "/auth/me", token=token)
        
        if success and response.status_code == 200:
            data = response.json()
            if "user" in data:
                result.success(f"Auth Me User {i+1}", f"Got user data")
            else:
                result.fail(f"Auth Me User {i+1}", "Missing user in response")
        else:
            result.fail(f"Auth Me User {i+1}", 
                       f"Status: {response.status_code if response else 'No response'}")

def test_update_profile():
    """Test updating user profile"""
    print("\n🔍 Testing Profile Updates...")
    
    if not test_data["tokens"]:
        result.fail("Update Profile", "No tokens available")
        return
    
    token = test_data["tokens"][0]
    profile_data = {
        "displayName": "Updated Test User 1",
        "username": "testuser001",
        "bio": "Updated bio for testing"
    }
    
    response, success = make_request("PATCH", "/me/profile", profile_data, token=token)
    
    if success and response.status_code == 200:
        data = response.json()
        if "user" in data:
            result.success("Update Profile", f"Profile updated")
        else:
            result.fail("Update Profile", "Missing user in response")
    else:
        result.fail("Update Profile", 
                   f"Status: {response.status_code if response else 'No response'}")

def test_set_age():
    """Test setting user age"""
    print("\n🔍 Testing Age Setting...")
    
    if not test_data["tokens"]:
        result.fail("Set Age", "No tokens available")
        return
    
    for i, token in enumerate(test_data["tokens"][:2]):
        age_data = {"birthYear": 2000 + i}  # Make users adults
        response, success = make_request("PATCH", "/me/age", age_data, token=token)
        
        if success and response.status_code == 200:
            data = response.json()
            if "user" in data and data["user"].get("ageStatus") == "ADULT":
                result.success(f"Set Age User {i+1}", f"Age set to adult")
            else:
                result.fail(f"Set Age User {i+1}", "Age not set properly")
        else:
            result.fail(f"Set Age User {i+1}", 
                       f"Status: {response.status_code if response else 'No response'}")

def test_seed_colleges():
    """Test college seeding"""
    print("\n🔍 Testing College Seeding...")
    
    response, success = make_request("POST", "/admin/colleges/seed")
    
    if success and response.status_code == 200:
        data = response.json()
        result.success("Seed Colleges", f"Seeded colleges")
    else:
        result.fail("Seed Colleges", 
                   f"Status: {response.status_code if response else 'No response'}")

def test_search_colleges():
    """Test college search"""
    print("\n🔍 Testing College Search...")
    
    # Test with IIT search
    response, success = make_request("GET", "/colleges/search?q=IIT&limit=5")
    
    if success and response.status_code == 200:
        data = response.json()
        if "colleges" in data and len(data["colleges"]) > 0:
            test_data["colleges"] = data["colleges"][:2]  # Store first 2 for linking
            result.success("Search Colleges", f"Found {len(data['colleges'])} colleges")
        else:
            result.fail("Search Colleges", "No colleges found")
    else:
        result.fail("Search Colleges", 
                   f"Status: {response.status_code if response else 'No response'}")

def test_link_college():
    """Test linking user to college"""
    print("\n🔍 Testing College Linking...")
    
    if not test_data["tokens"] or not test_data["colleges"]:
        result.fail("Link College", "No tokens or colleges available")
        return
    
    token = test_data["tokens"][0]
    college_data = {"collegeId": test_data["colleges"][0]["id"]}
    
    response, success = make_request("PATCH", "/me/college", college_data, token=token)
    
    if success and response.status_code == 200:
        data = response.json()
        if "user" in data and data["user"].get("collegeId"):
            result.success("Link College", f"College linked")
        else:
            result.fail("Link College", "College not linked properly")
    else:
        result.fail("Link College", 
                   f"Status: {response.status_code if response else 'No response'}")

def test_create_posts():
    """Test creating posts"""
    print("\n🔍 Testing Post Creation...")
    
    if not test_data["tokens"]:
        result.fail("Create Posts", "No tokens available")
        return
    
    posts = [
        {"caption": "This is my first test post! 🚀"},
        {"caption": "Another test post with different content"},
        {"caption": "Third post for testing purposes"}
    ]
    
    for i, post_data in enumerate(posts):
        token = test_data["tokens"][i % len(test_data["tokens"])]
        response, success = make_request("POST", "/content/posts", post_data, token=token)
        
        if success and response.status_code == 201:
            data = response.json()
            if "post" in data:
                test_data["posts"].append(data["post"])
                result.success(f"Create Post {i+1}", f"Post ID: {data['post']['id']}")
            else:
                result.fail(f"Create Post {i+1}", "Missing post in response")
        else:
            result.fail(f"Create Post {i+1}", 
                       f"Status: {response.status_code if response else 'No response'}")

def test_public_feed():
    """Test public feed"""
    print("\n🔍 Testing Public Feed...")
    
    response, success = make_request("GET", "/feed/public?limit=10")
    
    if success and response.status_code == 200:
        data = response.json()
        if "items" in data:
            result.success("Public Feed", f"Got {len(data['items'])} posts")
        else:
            result.fail("Public Feed", "Missing items in response")
    else:
        result.fail("Public Feed", 
                   f"Status: {response.status_code if response else 'No response'}")

def test_following_feed():
    """Test following feed"""
    print("\n🔍 Testing Following Feed...")
    
    if not test_data["tokens"]:
        result.fail("Following Feed", "No tokens available")
        return
    
    token = test_data["tokens"][0]
    response, success = make_request("GET", "/feed/following?limit=10", token=token)
    
    if success and response.status_code == 200:
        data = response.json()
        if "items" in data:
            result.success("Following Feed", f"Got {len(data['items'])} posts")
        else:
            result.fail("Following Feed", "Missing items in response")
    else:
        result.fail("Following Feed", 
                   f"Status: {response.status_code if response else 'No response'}")

def test_follow_unfollow():
    """Test follow/unfollow functionality"""
    print("\n🔍 Testing Follow/Unfollow...")
    
    if len(test_data["tokens"]) < 2 or len(test_data["users"]) < 2:
        result.fail("Follow/Unfollow", "Need at least 2 users")
        return
    
    user1_token = test_data["tokens"][0]
    user2_id = test_data["users"][1]["id"]
    
    # Test follow
    response, success = make_request("POST", f"/follow/{user2_id}", token=user1_token)
    
    if success and response.status_code == 200:
        result.success("Follow User", "User followed successfully")
    else:
        result.fail("Follow User", 
                   f"Status: {response.status_code if response else 'No response'}")
    
    # Test unfollow
    response, success = make_request("DELETE", f"/follow/{user2_id}", token=user1_token)
    
    if success and response.status_code == 200:
        result.success("Unfollow User", "User unfollowed successfully")
    else:
        result.fail("Unfollow User", 
                   f"Status: {response.status_code if response else 'No response'}")

def test_likes_reactions():
    """Test like/dislike functionality"""
    print("\n🔍 Testing Likes and Reactions...")
    
    if not test_data["tokens"] or not test_data["posts"]:
        result.fail("Likes/Reactions", "No tokens or posts available")
        return
    
    token = test_data["tokens"][0]
    post_id = test_data["posts"][0]["id"]
    
    # Test like
    response, success = make_request("POST", f"/content/{post_id}/like", token=token)
    
    if success and response.status_code == 200:
        result.success("Like Post", "Post liked successfully")
    else:
        result.fail("Like Post", 
                   f"Status: {response.status_code if response else 'No response'}")
    
    # Test dislike
    response, success = make_request("POST", f"/content/{post_id}/dislike", token=token)
    
    if success and response.status_code == 200:
        result.success("Dislike Post", "Post disliked successfully")
    else:
        result.fail("Dislike Post", 
                   f"Status: {response.status_code if response else 'No response'}")
    
    # Test remove reaction
    response, success = make_request("DELETE", f"/content/{post_id}/reaction", token=token)
    
    if success and response.status_code == 200:
        result.success("Remove Reaction", "Reaction removed successfully")
    else:
        result.fail("Remove Reaction", 
                   f"Status: {response.status_code if response else 'No response'}")

def test_save_unsave():
    """Test save/unsave functionality"""
    print("\n🔍 Testing Save/Unsave...")
    
    if not test_data["tokens"] or not test_data["posts"]:
        result.fail("Save/Unsave", "No tokens or posts available")
        return
    
    token = test_data["tokens"][0]
    post_id = test_data["posts"][0]["id"]
    
    # Test save
    response, success = make_request("POST", f"/content/{post_id}/save", token=token)
    
    if success and response.status_code == 200:
        result.success("Save Post", "Post saved successfully")
    else:
        result.fail("Save Post", 
                   f"Status: {response.status_code if response else 'No response'}")
    
    # Test unsave
    response, success = make_request("DELETE", f"/content/{post_id}/save", token=token)
    
    if success and response.status_code == 200:
        result.success("Unsave Post", "Post unsaved successfully")
    else:
        result.fail("Unsave Post", 
                   f"Status: {response.status_code if response else 'No response'}")

def test_comments():
    """Test comment functionality"""
    print("\n🔍 Testing Comments...")
    
    if not test_data["tokens"] or not test_data["posts"]:
        result.fail("Comments", "No tokens or posts available")
        return
    
    token = test_data["tokens"][0]
    post_id = test_data["posts"][0]["id"]
    
    # Test create comment
    comment_data = {"body": "This is a test comment on the post!"}
    response, success = make_request("POST", f"/content/{post_id}/comments", 
                                   comment_data, token=token)
    
    if success and response.status_code == 201:
        data = response.json()
        if "comment" in data:
            test_data["comments"].append(data["comment"])
            result.success("Create Comment", f"Comment ID: {data['comment']['id']}")
        else:
            result.fail("Create Comment", "Missing comment in response")
    else:
        result.fail("Create Comment", 
                   f"Status: {response.status_code if response else 'No response'}")
    
    # Test get comments
    response, success = make_request("GET", f"/content/{post_id}/comments?limit=10")
    
    if success and response.status_code == 200:
        data = response.json()
        if "comments" in data:
            result.success("Get Comments", f"Got {len(data['comments'])} comments")
        else:
            result.fail("Get Comments", "Missing comments in response")
    else:
        result.fail("Get Comments", 
                   f"Status: {response.status_code if response else 'No response'}")

def test_reports():
    """Test report functionality"""
    print("\n🔍 Testing Reports...")
    
    if not test_data["tokens"] or not test_data["posts"]:
        result.fail("Reports", "No tokens or posts available")
        return
    
    token = test_data["tokens"][0]
    post_id = test_data["posts"][0]["id"]
    
    report_data = {
        "targetType": "CONTENT",
        "targetId": post_id,
        "reasonCode": "INAPPROPRIATE",
        "details": "Testing report functionality"
    }
    
    response, success = make_request("POST", "/reports", report_data, token=token)
    
    if success and response.status_code == 201:
        data = response.json()
        if "report" in data:
            test_data["reports"].append(data["report"])
            result.success("Create Report", f"Report ID: {data['report']['id']}")
        else:
            result.fail("Create Report", "Missing report in response")
    else:
        result.fail("Create Report", 
                   f"Status: {response.status_code if response else 'No response'}")

def test_search():
    """Test search functionality"""
    print("\n🔍 Testing Search...")
    
    # Test user search
    response, success = make_request("GET", "/search?q=Test&type=users")
    
    if success and response.status_code == 200:
        data = response.json()
        if "users" in data:
            result.success("Search Users", f"Found {len(data['users'])} users")
        else:
            result.fail("Search Users", "Missing users in response")
    else:
        result.fail("Search Users", 
                   f"Status: {response.status_code if response else 'No response'}")
    
    # Test college search via main search
    response, success = make_request("GET", "/search?q=IIT&type=colleges")
    
    if success and response.status_code == 200:
        data = response.json()
        if "colleges" in data:
            result.success("Search Colleges", f"Found {len(data['colleges'])} colleges")
        else:
            result.fail("Search Colleges", "Missing colleges in response")
    else:
        result.fail("Search Colleges", 
                   f"Status: {response.status_code if response else 'No response'}")

def test_user_suggestions():
    """Test user suggestions"""
    print("\n🔍 Testing User Suggestions...")
    
    if not test_data["tokens"]:
        result.fail("User Suggestions", "No tokens available")
        return
    
    token = test_data["tokens"][0]
    response, success = make_request("GET", "/suggestions/users", token=token)
    
    if success and response.status_code == 200:
        data = response.json()
        if "users" in data:
            result.success("User Suggestions", f"Got {len(data['users'])} suggestions")
        else:
            result.fail("User Suggestions", "Missing users in response")
    else:
        result.fail("User Suggestions", 
                   f"Status: {response.status_code if response else 'No response'}")

def test_college_feed():
    """Test college-specific feed"""
    print("\n🔍 Testing College Feed...")
    
    if not test_data["colleges"]:
        result.fail("College Feed", "No colleges available")
        return
    
    college_id = test_data["colleges"][0]["id"]
    response, success = make_request("GET", f"/feed/college/{college_id}?limit=10")
    
    if success and response.status_code == 200:
        data = response.json()
        if "items" in data:
            result.success("College Feed", f"Got {len(data['items'])} posts")
        else:
            result.fail("College Feed", "Missing items in response")
    else:
        result.fail("College Feed", 
                   f"Status: {response.status_code if response else 'No response'}")

def test_media_upload():
    """Test media upload (with base64 data)"""
    print("\n🔍 Testing Media Upload...")
    
    if not test_data["tokens"]:
        result.fail("Media Upload", "No tokens available")
        return
    
    token = test_data["tokens"][0]
    
    # Simple 1x1 pixel PNG base64 data
    media_data = {
        "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "mimeType": "image/png",
        "type": "IMAGE"
    }
    
    response, success = make_request("POST", "/media/upload", media_data, token=token)
    
    if success and response.status_code == 201:
        data = response.json()
        if "id" in data and "url" in data:
            result.success("Media Upload", f"Media ID: {data['id']}")
        else:
            result.fail("Media Upload", "Missing id or url in response")
    else:
        result.fail("Media Upload", 
                   f"Status: {response.status_code if response else 'No response'}")

def test_legal_consent():
    """Test legal consent functionality"""
    print("\n🔍 Testing Legal Consent...")
    
    # Test get consent notice
    response, success = make_request("GET", "/legal/consent")
    
    if success and response.status_code == 200:
        data = response.json()
        if "notice" in data:
            result.success("Get Consent Notice", "Got consent notice")
            
            # Test accept consent
            if test_data["tokens"]:
                token = test_data["tokens"][0]
                accept_data = {"version": data["notice"]["version"]}
                response, success = make_request("POST", "/legal/accept", 
                                               accept_data, token=token)
                
                if success and response.status_code == 200:
                    result.success("Accept Consent", "Consent accepted")
                else:
                    result.fail("Accept Consent", 
                               f"Status: {response.status_code if response else 'No response'}")
        else:
            result.fail("Get Consent Notice", "Missing notice in response")
    else:
        result.fail("Get Consent Notice", 
                   f"Status: {response.status_code if response else 'No response'}")

def test_admin_stats():
    """Test admin stats"""
    print("\n🔍 Testing Admin Stats...")
    
    response, success = make_request("GET", "/admin/stats")
    
    if success and response.status_code == 200:
        data = response.json()
        if "users" in data and "posts" in data:
            result.success("Admin Stats", f"Users: {data['users']}, Posts: {data['posts']}")
        else:
            result.fail("Admin Stats", "Missing stats in response")
    else:
        result.fail("Admin Stats", 
                   f"Status: {response.status_code if response else 'No response'}")

def run_all_tests():
    """Run all backend tests in sequence"""
    print("🚀 Starting Comprehensive Backend API Testing for Tribe Social Platform")
    print("=" * 80)
    
    try:
        # Health and infrastructure tests
        test_health_endpoints()
        
        # Authentication flow
        test_user_registration()
        test_user_login() 
        test_auth_me()
        
        # Profile management
        test_update_profile()
        test_set_age()
        
        # College functionality
        test_seed_colleges()
        test_search_colleges()
        test_link_college()
        
        # Content creation and feeds
        test_create_posts()
        test_public_feed()
        test_following_feed()
        test_college_feed()
        
        # Social interactions
        test_follow_unfollow()
        test_likes_reactions()
        test_save_unsave()
        test_comments()
        
        # Other features
        test_reports()
        test_search()
        test_user_suggestions()
        test_media_upload()
        test_legal_consent()
        test_admin_stats()
        
    except Exception as e:
        print(f"\n❌ Unexpected error during testing: {e}")
        result.fail("Test Execution", str(e))
    
    # Print summary
    result.summary()
    
    return result.failed == 0

if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)