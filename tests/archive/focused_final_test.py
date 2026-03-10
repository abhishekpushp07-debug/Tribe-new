#!/usr/bin/env python3
"""
FOCUSED FINAL ACCEPTANCE TEST - Social Features & Missing Endpoints
Completing the remaining tests with existing users and verifying API responses
"""

import requests
import json
import sys
import time
from typing import Dict, Any, Optional

# Configuration
BASE_URL = "https://pages-ultimate-gate.preview.emergentagent.com/api"
HEADERS = {"Content-Type": "application/json"}

# Test credentials - use existing users
EXISTING_USERS = [
    {"phone": "9000000001", "pin": "1234"},
    {"phone": "9000000002", "pin": "5678"},
]

test_data = {
    "users": [],
    "tokens": [],
    "posts": [],
    "media_ids": []
}

class TestResult:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.errors = []
    
    def success(self, test_name: str, status_code: int, message: str = ""):
        self.passed += 1
        detail = f"✅ {test_name}: PASS (HTTP {status_code}) {message}"
        print(detail)
    
    def fail(self, test_name: str, status_code: int = None, message: str = ""):
        self.failed += 1
        detail = f"❌ {test_name}: FAIL (HTTP {status_code or 'N/A'}) - {message}"
        self.errors.append(f"{test_name}: {message}")
        print(detail)
    
    def summary(self):
        total = self.passed + self.failed
        print(f"\n{'='*80}")
        print(f"FOCUSED TEST SUMMARY")
        print(f"{'='*80}")
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
                headers: Dict[str, str] = None, token: str = None, 
                timeout: int = 30) -> tuple:
    """Make HTTP request and return (response, success)"""
    url = f"{BASE_URL}{endpoint}"
    req_headers = HEADERS.copy()
    
    if headers:
        req_headers.update(headers)
    
    if token:
        req_headers["Authorization"] = f"Bearer {token}"
    
    try:
        if method == "GET":
            response = requests.get(url, headers=req_headers, timeout=timeout)
        elif method == "POST":
            response = requests.post(url, json=data, headers=req_headers, timeout=timeout)
        elif method == "PATCH":
            response = requests.patch(url, json=data, headers=req_headers, timeout=timeout)
        elif method == "DELETE":
            response = requests.delete(url, headers=req_headers, timeout=timeout)
        else:
            return None, False
        
        return response, True
    except Exception as e:
        print(f"Request failed: {e}")
        return None, False

def setup_users():
    """Login existing users for testing"""
    print("🔧 Setting up users...")
    
    for i, user_creds in enumerate(EXISTING_USERS):
        login_data = {"phone": user_creds["phone"], "pin": user_creds["pin"]}
        response, success = make_request("POST", "/auth/login", login_data)
        
        if success and response.status_code == 200:
            data = response.json()
            if "token" in data and "user" in data:
                test_data["users"].append(data["user"])
                test_data["tokens"].append(data["token"])
                print(f"✅ User {i+1} logged in: {data['user']['id']}")
            else:
                print(f"❌ User {i+1} login missing token/user")
                return False
        else:
            print(f"❌ User {i+1} login failed: {response.status_code if response else 'No response'}")
            return False
    
    return True

def test_media_and_content_with_viewcount():
    """Test media upload and content creation with viewCount"""
    print("\n📸 Testing Media Upload and Content with ViewCount...")
    
    if not test_data["tokens"]:
        result.fail("Media Setup", None, "No tokens available")
        return
    
    token = test_data["tokens"][0]
    
    # Test media upload
    media_data = {
        "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "mimeType": "image/png",
        "type": "IMAGE"
    }
    
    response, success = make_request("POST", "/media/upload", media_data, token=token)
    
    if success and response.status_code == 201:
        data = response.json()
        if "id" in data and "url" in data:
            media_id = data["id"]
            test_data["media_ids"].append(media_id)
            result.success("Media Upload", 201, f"Media ID: {media_id}")
            
            # Create post with media
            media_post = {
                "caption": "Post with uploaded image media for testing viewCount",
                "mediaIds": [media_id]
            }
            response, success = make_request("POST", "/content/posts", media_post, token=token)
            
            if success and response.status_code == 201:
                data = response.json()
                if "post" in data and data["post"].get("mediaIds"):
                    post = data["post"]
                    test_data["posts"].append(post)
                    result.success("Media Post Creation", 201, f"Post with mediaIds: {post.get('mediaIds')}")
                    
                    # Test viewCount by getting the content
                    post_id = post["id"]
                    response, success = make_request("GET", f"/content/{post_id}")
                    
                    if success and response.status_code == 200:
                        content_data = response.json()
                        if "viewCount" in content_data:
                            result.success("Content ViewCount", 200, f"ViewCount: {content_data['viewCount']}")
                        else:
                            result.fail("Content ViewCount", 200, "Missing viewCount field")
                    else:
                        result.fail("Content Get", response.status_code if response else None, "Failed to get content")
                else:
                    result.fail("Media Post Creation", 201, "Missing post or mediaIds in response")
            else:
                result.fail("Media Post Creation", response.status_code if response else None, "Failed to create media post")
        else:
            result.fail("Media Upload", 201, "Missing id or url in response")
    else:
        result.fail("Media Upload", response.status_code if response else None, "Failed to upload media")

def test_stories_feed_with_auth():
    """Test stories feed with proper authentication"""
    print("\n📚 Testing Stories Feed with Authentication...")
    
    if not test_data["tokens"]:
        result.fail("Stories Feed", None, "No tokens available")
        return
    
    token = test_data["tokens"][0]
    
    # Test stories feed with auth
    response, success = make_request("GET", "/feed/stories", token=token)
    
    if success and response.status_code == 200:
        data = response.json()
        if "stories" in data:
            result.success("Stories Feed with Auth", 200, "Story rail retrieved successfully")
        else:
            # Check the actual response structure
            print(f"Stories response structure: {list(data.keys())}")
            result.fail("Stories Feed with Auth", 200, f"Missing stories field, got: {list(data.keys())}")
    else:
        result.fail("Stories Feed with Auth", response.status_code if response else None, "Failed to get stories feed")

def test_complete_social_interactions():
    """Test complete social interactions with 2 users"""
    print("\n❤️ Testing Complete Social Interactions...")
    
    if len(test_data["tokens"]) < 2 or len(test_data["users"]) < 2:
        result.fail("Social Setup", None, f"Have {len(test_data['tokens'])} tokens, need 2")
        return
    
    user1_token = test_data["tokens"][0]
    user1_id = test_data["users"][0]["id"]
    user2_token = test_data["tokens"][1]
    user2_id = test_data["users"][1]["id"]
    
    # Create a test post if we don't have any
    if not test_data["posts"]:
        post_data = {"caption": "Test post for social interactions"}
        response, success = make_request("POST", "/content/posts", post_data, token=user1_token)
        
        if success and response.status_code == 201:
            data = response.json()
            test_data["posts"].append(data["post"])
        else:
            result.fail("Social Post Setup", response.status_code if response else None, "Failed to create test post")
            return
    
    post_id = test_data["posts"][0]["id"]
    
    # Test follow
    response, success = make_request("POST", f"/follow/{user2_id}", token=user1_token)
    
    if success and response.status_code == 200:
        result.success("Social Follow", 200, "User followed successfully")
    else:
        result.fail("Social Follow", response.status_code if response else None, "Failed to follow user")
    
    # Test self-follow rejection
    response, success = make_request("POST", f"/follow/{user1_id}", token=user1_token)
    
    if success and response.status_code == 400:
        result.success("Self Follow Blocked", 400, "Self-follow properly rejected")
    else:
        result.fail("Self Follow Blocked", response.status_code if response else None, "Should reject self-follow")
    
    # Test like
    response, success = make_request("POST", f"/content/{post_id}/like", token=user2_token)
    
    if success and response.status_code == 200:
        result.success("Social Like", 200, "Post liked successfully")
    else:
        result.fail("Social Like", response.status_code if response else None, "Failed to like post")
    
    # Test comment
    comment_data = {"body": "Great post! This is a test comment with proper user interaction."}
    response, success = make_request("POST", f"/content/{post_id}/comments", comment_data, token=user2_token)
    
    if success and response.status_code == 201:
        result.success("Social Comment", 201, "Comment created successfully")
    else:
        result.fail("Social Comment", response.status_code if response else None, "Failed to create comment")
    
    # Test save
    response, success = make_request("POST", f"/content/{post_id}/save", token=user2_token)
    
    if success and response.status_code == 200:
        result.success("Social Save", 200, "Post saved successfully")
    else:
        result.fail("Social Save", response.status_code if response else None, "Failed to save post")

def test_notifications_with_enrichment():
    """Test notifications with actor enrichment"""
    print("\n🔔 Testing Notifications with Actor Enrichment...")
    
    if not test_data["tokens"]:
        result.fail("Notifications", None, "No tokens available")
        return
    
    token = test_data["tokens"][0]  # User who should receive notifications
    
    # Get notifications
    response, success = make_request("GET", "/notifications", token=token)
    
    if success and response.status_code == 200:
        data = response.json()
        if "notifications" in data:
            notifications = data["notifications"]
            result.success("Notifications Get", 200, f"Got {len(notifications)} notifications")
            
            # Check for actor enrichment
            has_enrichment = False
            for notif in notifications:
                if "actor" in notif and notif.get("actor") and "displayName" in notif.get("actor", {}):
                    has_enrichment = True
                    break
            
            if has_enrichment:
                result.success("Notifications Actor Enrichment", 200, "Actor enrichment present")
            else:
                # Check if we have notifications but no enrichment
                if len(notifications) > 0:
                    result.fail("Notifications Actor Enrichment", 200, "Notifications exist but missing actor enrichment")
                else:
                    result.success("Notifications Actor Enrichment", 200, "No notifications to enrich (expected for clean user)")
        else:
            result.fail("Notifications Get", 200, "Missing notifications field")
    else:
        result.fail("Notifications Get", response.status_code if response else None, "Failed to get notifications")

def test_appeals_endpoint():
    """Test appeals endpoint specifically"""
    print("\n⚖️ Testing Appeals Endpoint...")
    
    if not test_data["tokens"]:
        result.fail("Appeals", None, "No tokens available")
        return
    
    token = test_data["tokens"][0]
    
    # Create appeal (using correct field names)
    appeal_data = {
        "targetType": "CONTENT",
        "targetId": "test-target-id",
        "reason": "This content was incorrectly reported and should be restored"
    }
    
    response, success = make_request("POST", "/appeals", appeal_data, token=token)
    
    if success and response.status_code == 201:
        data = response.json()
        if "appeal" in data:
            result.success("Appeals Create", 201, f"Appeal created: {data['appeal']['id']}")
        else:
            result.fail("Appeals Create", 201, f"Missing appeal field, response keys: {list(data.keys())}")
    else:
        result.fail("Appeals Create", response.status_code if response else None, "Failed to create appeal")
    
    # Get appeals
    response, success = make_request("GET", "/appeals", token=token)
    
    if success and response.status_code == 200:
        data = response.json()
        if "appeals" in data:
            result.success("Appeals Get", 200, f"Got {len(data['appeals'])} appeals")
        else:
            result.fail("Appeals Get", 200, "Missing appeals field")
    else:
        result.fail("Appeals Get", response.status_code if response else None, "Failed to get appeals")

def test_grievances_endpoint():
    """Test grievances endpoint specifically"""
    print("\n📝 Testing Grievances Endpoint...")
    
    if not test_data["tokens"]:
        result.fail("Grievances", None, "No tokens available")
        return
    
    token = test_data["tokens"][0]
    
    # Test LEGAL_NOTICE grievance
    legal_grievance = {
        "ticketType": "LEGAL_NOTICE", 
        "subject": "Legal Notice Test",
        "description": "Testing legal notice grievance functionality"
    }
    
    response, success = make_request("POST", "/grievances", legal_grievance, token=token)
    
    if success and response.status_code == 201:
        data = response.json()
        print(f"Grievance response keys: {list(data.keys())}")
        
        # Check for both possible field names
        if "grievance" in data:
            grievance = data["grievance"]
            result.success("Grievances Legal Notice", 201, f"Grievance created with 'grievance' field")
        elif "ticket" in data:
            grievance = data["ticket"]
            sla_hours = grievance.get("slaHours", 0)
            priority = grievance.get("priority", "")
            if sla_hours == 3 and priority == "CRITICAL":
                result.success("Grievances Legal Notice", 201, f"slaHours=3, priority=CRITICAL (field: ticket)")
            else:
                result.fail("Grievances Legal Notice", 201, f"Expected slaHours=3/CRITICAL, got {sla_hours}/{priority}")
        else:
            result.fail("Grievances Legal Notice", 201, f"Missing grievance/ticket field, got: {list(data.keys())}")
    else:
        result.fail("Grievances Legal Notice", response.status_code if response else None, "Failed to create legal grievance")
    
    # Test GENERAL grievance
    general_grievance = {
        "ticketType": "GENERAL",
        "subject": "General Issue Test", 
        "description": "Testing general grievance functionality"
    }
    
    response, success = make_request("POST", "/grievances", general_grievance, token=token)
    
    if success and response.status_code == 201:
        data = response.json()
        
        if "ticket" in data or "grievance" in data:
            grievance = data.get("ticket", data.get("grievance", {}))
            sla_hours = grievance.get("slaHours", 0)
            priority = grievance.get("priority", "")
            if sla_hours == 72 and priority == "NORMAL":
                result.success("Grievances General", 201, f"slaHours=72, priority=NORMAL")
            else:
                result.fail("Grievances General", 201, f"Expected slaHours=72/NORMAL, got {sla_hours}/{priority}")
        else:
            result.fail("Grievances General", 201, "Missing grievance/ticket field")
    else:
        result.fail("Grievances General", response.status_code if response else None, "Failed to create general grievance")
    
    # Get grievances
    response, success = make_request("GET", "/grievances", token=token)
    
    if success and response.status_code == 200:
        data = response.json()
        if "tickets" in data:
            result.success("Grievances Get", 200, f"Got {len(data['tickets'])} grievances")
        elif "grievances" in data:
            result.success("Grievances Get", 200, f"Got {len(data['grievances'])} grievances")  
        else:
            result.fail("Grievances Get", 200, f"Missing tickets/grievances field, got: {list(data.keys())}")
    else:
        result.fail("Grievances Get", response.status_code if response else None, "Failed to get grievances")

def test_idor_protection():
    """Test IDOR protection with 2 users"""
    print("\n🔐 Testing IDOR Protection...")
    
    if len(test_data["tokens"]) < 2 or len(test_data["users"]) < 2:
        result.fail("IDOR Setup", None, "Need 2 users for IDOR testing")
        return
    
    user1_token = test_data["tokens"][0]
    user2_id = test_data["users"][1]["id"]
    
    # Test accessing another user's saved posts
    response, success = make_request("GET", f"/users/{user2_id}/saved", token=user1_token)
    
    if success and response.status_code == 403:
        result.success("IDOR Protection", 403, "Cannot access others' saved posts")
    else:
        result.fail("IDOR Protection", response.status_code if response else None, 
                   "Should block access to others' saved posts")

def run_focused_tests():
    """Run focused tests for missing functionality"""
    print("🎯 FOCUSED FINAL ACCEPTANCE TEST")
    print("Focus: Social Features, API Response Validation, Missing Endpoints")
    print("="*80)
    
    try:
        # Setup
        if not setup_users():
            print("❌ Failed to setup users, cannot continue")
            return False
        
        # Test missing functionality
        test_media_and_content_with_viewcount()
        test_stories_feed_with_auth()
        test_complete_social_interactions()
        test_notifications_with_enrichment()
        test_appeals_endpoint()
        test_grievances_endpoint()
        test_idor_protection()
        
    except Exception as e:
        print(f"\n❌ Critical error during testing: {e}")
        result.fail("Test Execution", None, str(e))
    
    # Print summary
    result.summary()
    
    return result.failed == 0

if __name__ == "__main__":
    success = run_focused_tests()
    sys.exit(0 if success else 1)