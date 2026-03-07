#!/usr/bin/env python3
"""
Focused Backend API Re-Testing for Tribe Social Platform
Re-testing ONLY the previously failed scenarios from 54-test run.

Previous failures to address:
1. Stories feed (forgot auth token)
2. Profile updates (timeout) 
3. Registration with new users (timeout)
4. Appeals endpoint (timeout)
5. Grievances flow
6. Full social interaction flow
7. Media upload + content with media

Base URL: https://tribe-backend.preview.emergentagent.com/api
"""

import requests
import json
import sys
import time
from typing import Dict, Any, Optional

# Configuration
BASE_URL = "https://tribe-backend.preview.emergentagent.com/api"
HEADERS = {"Content-Type": "application/json"}

# Test credentials from review request
EXISTING_USERS = [
    {"phone": "9000000001", "pin": "1234"},  # User 1 (fully onboarded, House Vikram)
    {"phone": "9000000002", "pin": "5678"},  # User 2 (House Aryabhatta)
]

# NEW test user for retry testing
NEW_TEST_USER = {"phone": "9000000088", "pin": "4321", "displayName": "Test User Retry"}

# Global storage for test data
test_data = {
    "tokens": [],
    "users": [],
    "new_user_token": None,
    "new_user": None,
    "posts": [],
    "colleges": [],
    "media": []
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
        print(f"FOCUSED RE-TEST SUMMARY")
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
                headers: Dict[str, str] = None, token: str = None, retry=True) -> tuple:
    """Make HTTP request with optional retry on timeout"""
    url = f"{BASE_URL}{endpoint}"
    req_headers = HEADERS.copy()
    
    if headers:
        req_headers.update(headers)
    
    if token:
        req_headers["Authorization"] = f"Bearer {token}"
    
    for attempt in range(2 if retry else 1):
        try:
            if method == "GET":
                response = requests.get(url, headers=req_headers, timeout=45)
            elif method == "POST":
                response = requests.post(url, json=data, headers=req_headers, timeout=45)
            elif method == "PATCH":
                response = requests.patch(url, json=data, headers=req_headers, timeout=45)
            elif method == "DELETE":
                response = requests.delete(url, headers=req_headers, timeout=45)
            else:
                return None, False
            
            return response, True
            
        except requests.exceptions.Timeout:
            if attempt == 0 and retry:
                print(f"⏰ Timeout on {method} {endpoint}, retrying...")
                time.sleep(2)
                continue
            else:
                print(f"⏰ Timeout on {method} {endpoint} after retries")
                return None, False
        except Exception as e:
            if attempt == 0 and retry:
                print(f"⚠️  Error on {method} {endpoint}: {e}, retrying...")
                time.sleep(2)
                continue
            else:
                print(f"❌ Error on {method} {endpoint}: {e}")
                return None, False
    
    return None, False

def login_existing_users():
    """Login existing users to get tokens"""
    print("\n🔍 Step 1: Login with Existing Users...")
    
    for i, user_data in enumerate(EXISTING_USERS):
        login_data = {"phone": user_data["phone"], "pin": user_data["pin"]}
        response, success = make_request("POST", "/auth/login", login_data)
        
        if success and response.status_code == 200:
            data = response.json()
            if "token" in data and "user" in data:
                test_data["tokens"].append(data["token"])
                test_data["users"].append(data["user"])
                result.success(f"Login Existing User {i+1}", f"Phone: {user_data['phone']}")
            else:
                result.fail(f"Login Existing User {i+1}", "Missing token in response")
        else:
            result.fail(f"Login Existing User {i+1}", 
                       f"Status: {response.status_code if response else 'Timeout/Error'}")

def test_stories_feed_with_auth():
    """Test stories feed WITH proper authentication (previously failed due to missing auth)"""
    print("\n🔍 Step 2: Stories Feed with Authentication...")
    
    if not test_data["tokens"]:
        result.fail("Stories Feed", "No auth tokens available")
        return
    
    # Use first user's token for authenticated request
    token = test_data["tokens"][0]
    response, success = make_request("GET", "/feed/stories", token=token)
    
    if success and response.status_code == 200:
        data = response.json()
        if "storyRail" in data:
            result.success("Stories Feed (Auth)", f"Got stories feed with authentication - {len(data['storyRail'])} story groups")
        else:
            result.fail("Stories Feed (Auth)", "Missing storyRail in response")
    else:
        result.fail("Stories Feed (Auth)", 
                   f"Status: {response.status_code if response else 'Timeout/Error'}")

def test_new_user_registration_and_profile_flow():
    """Test complete registration + profile flow with NEW user (previously timed out)"""
    print("\n🔍 Step 3: NEW User Registration + Full Profile Flow...")
    
def test_new_user_registration_and_profile_flow():
    """Test complete registration + profile flow with NEW user (previously timed out)"""
    print("\n🔍 Step 3: NEW User Registration + Full Profile Flow...")
    
    # Step 1: Register NEW user
    response, success = make_request("POST", "/auth/register", NEW_TEST_USER)
    
    if success and response.status_code == 201:
        # New registration successful
        data = response.json()
        if "token" in data and "user" in data:
            test_data["new_user_token"] = data["token"]
            test_data["new_user"] = data["user"]
            result.success("Register NEW User", f"User ID: {data['user']['id']}")
        else:
            result.fail("Register NEW User", "Missing token/user in response")
            return
    elif success and response.status_code == 409:
        # User exists, login instead
        login_data = {"phone": NEW_TEST_USER["phone"], "pin": NEW_TEST_USER["pin"]}
        response, success = make_request("POST", "/auth/login", login_data)
        
        if success and response.status_code == 200:
            data = response.json()
            if "token" in data and "user" in data:
                test_data["new_user_token"] = data["token"]
                test_data["new_user"] = data["user"]
                result.success("Register NEW User (existing)", f"Logged in existing user: {data['user']['id']}")
            else:
                result.fail("Register NEW User", "Missing token/user in login response")
                return
        else:
            result.fail("Register NEW User", "User exists but login failed")
            return
    else:
        result.fail("Register NEW User", 
                   f"Status: {response.status_code if response else 'Timeout/Error'}")
        return
    
    token = test_data["new_user_token"]
    
    # Step 2: Update Profile
    profile_data = {
        "username": "testretry",
        "bio": "Testing retry flow"
    }
    response, success = make_request("PATCH", "/me/profile", profile_data, token=token)
    
    if success and response.status_code == 200:
        result.success("Profile Update (NEW User)", "Profile updated successfully")
    else:
        result.fail("Profile Update (NEW User)", 
                   f"Status: {response.status_code if response else 'Timeout/Error'}")
    
    # Step 3: Set Age
    age_data = {"birthYear": 2000}
    response, success = make_request("PATCH", "/me/age", age_data, token=token)
    
    if success and response.status_code == 200:
        result.success("Age Setting (NEW User)", "Age set successfully")
    else:
        result.fail("Age Setting (NEW User)", 
                   f"Status: {response.status_code if response else 'Timeout/Error'}")
    
    # Step 4: Search and Link College
    response, success = make_request("GET", "/colleges/search?q=IIT&limit=5")
    
    if success and response.status_code == 200:
        data = response.json()
        if "colleges" in data and len(data["colleges"]) > 0:
            college_id = data["colleges"][0]["id"]
            test_data["colleges"] = data["colleges"]
            
            college_data = {"collegeId": college_id}
            response, success = make_request("PATCH", "/me/college", college_data, token=token)
            
            if success and response.status_code == 200:
                result.success("College Link (NEW User)", "College linked successfully")
            else:
                result.fail("College Link (NEW User)", 
                           f"Status: {response.status_code if response else 'Timeout/Error'}")
        else:
            result.fail("College Search (NEW User)", "No colleges found")
    else:
        result.fail("College Search (NEW User)", 
                   f"Status: {response.status_code if response else 'Timeout/Error'}")
    
    # Step 5: Accept Legal Terms
    legal_data = {"version": "1.0"}
    response, success = make_request("POST", "/legal/accept", legal_data, token=token)
    
    if success and response.status_code == 200:
        result.success("Legal Accept (NEW User)", "Legal terms accepted")
    else:
        result.fail("Legal Accept (NEW User)", 
                   f"Status: {response.status_code if response else 'Timeout/Error'}")
    
    # Step 6: Complete Onboarding
    response, success = make_request("PATCH", "/me/onboarding", {}, token=token)
    
    if success and response.status_code == 200:
        result.success("Onboarding Complete (NEW User)", "Onboarding completed")
    else:
        result.fail("Onboarding Complete (NEW User)", 
                   f"Status: {response.status_code if response else 'Timeout/Error'}")

def test_appeals_flow():
    """Test appeals flow (previously timed out)"""
    print("\n🔍 Step 4: Appeals Flow...")
    
    if not test_data["tokens"]:
        result.fail("Appeals Flow", "No auth tokens available")
        return
    
    token = test_data["tokens"][0]
    
    # Create Appeal
    appeal_data = {
        "targetType": "CONTENT",
        "targetId": f"test-content-{int(time.time())}",  # Use unique ID
        "reason": "Testing appeal"
    }
    response, success = make_request("POST", "/appeals", appeal_data, token=token)
    
    if success and (response.status_code == 201 or 
                   (response.status_code == 409 and "Appeal already pending" in response.text)):
        result.success("Create Appeal", "Appeal created or already exists")
    else:
        result.fail("Create Appeal", 
                   f"Status: {response.status_code if response else 'Timeout/Error'}")
    
    # Get Appeals
    response, success = make_request("GET", "/appeals", token=token)
    
    if success and response.status_code == 200:
        data = response.json()
        if "appeals" in data:
            result.success("Get Appeals", f"Got {len(data['appeals'])} appeals")
        else:
            result.fail("Get Appeals", "Missing appeals in response")
    else:
        result.fail("Get Appeals", 
                   f"Status: {response.status_code if response else 'Timeout/Error'}")

def test_grievances_flow():
    """Test grievances flow"""
    print("\n🔍 Step 5: Grievances Flow...")
    
    if not test_data["tokens"]:
        result.fail("Grievances Flow", "No auth tokens available")
        return
    
    token = test_data["tokens"][0]
    
    # Create Legal Notice Grievance
    legal_grievance = {
        "ticketType": "LEGAL_NOTICE",
        "subject": "Test Legal Notice",
        "description": "Testing SLA compliance"
    }
    response, success = make_request("POST", "/grievances", legal_grievance, token=token)
    
    if success and response.status_code == 201:
        result.success("Create Legal Grievance", "Legal grievance created")
    else:
        result.fail("Create Legal Grievance", 
                   f"Status: {response.status_code if response else 'Timeout/Error'}")
    
    # Create General Grievance
    general_grievance = {
        "ticketType": "GENERAL",
        "subject": "General test",
        "description": "Testing general grievance"
    }
    response, success = make_request("POST", "/grievances", general_grievance, token=token)
    
    if success and response.status_code == 201:
        result.success("Create General Grievance", "General grievance created")
    else:
        result.fail("Create General Grievance", 
                   f"Status: {response.status_code if response else 'Timeout/Error'}")
    
    # Get Grievances
    response, success = make_request("GET", "/grievances", token=token)
    
    if success and response.status_code == 200:
        data = response.json()
        if "tickets" in data:
            result.success("Get Grievances", f"Got {len(data['tickets'])} grievances")
        else:
            result.fail("Get Grievances", "Missing tickets in response")
    else:
        result.fail("Get Grievances", 
                   f"Status: {response.status_code if response else 'Timeout/Error'}")

def test_media_upload_and_content():
    """Test media upload + content creation with media"""
    print("\n🔍 Step 6: Media Upload + Content with Media...")
    
    if not test_data["new_user_token"]:
        result.fail("Media Upload", "No new user token available")
        return
    
    token = test_data["new_user_token"]
    
    # Upload Media
    media_data = {
        "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "mimeType": "image/png",
        "type": "IMAGE"
    }
    response, success = make_request("POST", "/media/upload", media_data, token=token)
    
    if success and response.status_code == 201:
        data = response.json()
        if "id" in data:
            media_id = data["id"]
            test_data["media"].append(data)
            result.success("Media Upload", f"Media ID: {media_id}")
            
            # Create Post with Media
            post_data = {
                "caption": "Post with uploaded media!",
                "mediaIds": [media_id]
            }
            response, success = make_request("POST", "/content/posts", post_data, token=token)
            
            if success and response.status_code == 201:
                data = response.json()
                if "post" in data:
                    test_data["posts"].append(data["post"])
                    result.success("Post with Media", f"Post ID: {data['post']['id']}")
                else:
                    result.fail("Post with Media", "Missing post in response")
            else:
                result.fail("Post with Media", 
                           f"Status: {response.status_code if response else 'Timeout/Error'}")
            
            # Create Story with Media (should have expiresAt)
            story_data = {
                "caption": "Story with media",
                "mediaIds": [media_id],
                "kind": "STORY"
            }
            response, success = make_request("POST", "/content/posts", story_data, token=token)
            
            if success and response.status_code == 201:
                data = response.json()
                if "post" in data and "expiresAt" in data["post"]:
                    result.success("Story with Media", f"Story with expiresAt: {data['post']['expiresAt']}")
                else:
                    result.fail("Story with Media", "Missing expiresAt or post in response")
            else:
                result.fail("Story with Media", 
                           f"Status: {response.status_code if response else 'Timeout/Error'}")
        else:
            result.fail("Media Upload", "Missing media ID in response")
    else:
        result.fail("Media Upload", 
                   f"Status: {response.status_code if response else 'Timeout/Error'}")

def test_full_social_interaction_flow():
    """Test full social flow with new user interacting"""
    print("\n🔍 Step 7: Full Social Interaction Flow...")
    
    if not test_data["new_user_token"] or not test_data["tokens"] or not test_data["posts"]:
        result.fail("Social Flow", "Missing required data for social interactions")
        return
    
    new_user_token = test_data["new_user_token"]
    existing_user_token = test_data["tokens"][0]
    post_id = test_data["posts"][0]["id"]
    new_user_id = test_data["new_user"]["id"]
    
    # Existing user likes new user's post
    response, success = make_request("POST", f"/content/{post_id}/like", token=existing_user_token)
    if success and response.status_code == 200:
        result.success("Like Post (Social Flow)", "Post liked")
    else:
        result.fail("Like Post (Social Flow)", 
                   f"Status: {response.status_code if response else 'Timeout/Error'}")
    
    # Existing user comments on new user's post
    comment_data = {"body": "Great post!"}
    response, success = make_request("POST", f"/content/{post_id}/comments", comment_data, token=existing_user_token)
    if success and response.status_code == 201:
        result.success("Comment Post (Social Flow)", "Comment added")
    else:
        result.fail("Comment Post (Social Flow)", 
                   f"Status: {response.status_code if response else 'Timeout/Error'}")
    
    # Existing user follows new user
    response, success = make_request("POST", f"/follow/{new_user_id}", token=existing_user_token)
    if success and response.status_code == 200:
        result.success("Follow User (Social Flow)", "User followed")
    else:
        result.fail("Follow User (Social Flow)", 
                   f"Status: {response.status_code if response else 'Timeout/Error'}")
    
    # Existing user saves new user's post
    response, success = make_request("POST", f"/content/{post_id}/save", token=existing_user_token)
    if success and response.status_code == 200:
        result.success("Save Post (Social Flow)", "Post saved")
    else:
        result.fail("Save Post (Social Flow)", 
                   f"Status: {response.status_code if response else 'Timeout/Error'}")
    
    # Check notifications for new user
    response, success = make_request("GET", "/notifications", token=new_user_token)
    if success and response.status_code == 200:
        data = response.json()
        if "notifications" in data:
            result.success("Check Notifications", f"Got {len(data['notifications'])} notifications")
            
            # Mark notifications as read
            response, success = make_request("PATCH", "/notifications/read", {}, token=new_user_token)
            if success and response.status_code == 200:
                result.success("Mark Notifications Read", "Notifications marked as read")
            else:
                result.fail("Mark Notifications Read", 
                           f"Status: {response.status_code if response else 'Timeout/Error'}")
        else:
            result.fail("Check Notifications", "Missing notifications in response")
    else:
        result.fail("Check Notifications", 
                   f"Status: {response.status_code if response else 'Timeout/Error'}")

def test_moderation_flow():
    """Test moderation and admin functionality"""
    print("\n🔍 Step 8: Moderation Flow...")
    
    if not test_data["tokens"] or not test_data["posts"]:
        result.fail("Moderation Flow", "Missing required data")
        return
    
    token = test_data["tokens"][0]
    post_id = test_data["posts"][0]["id"]
    
    # Report a post
    report_data = {
        "targetType": "CONTENT",
        "targetId": post_id,
        "reasonCode": "INAPPROPRIATE",
        "details": "Testing moderation flow"
    }
    response, success = make_request("POST", "/reports", report_data, token=token)
    
    if success and response.status_code == 201:
        result.success("Report Post", "Post reported successfully")
    else:
        result.fail("Report Post", 
                   f"Status: {response.status_code if response else 'Timeout/Error'}")
    
    # Check admin stats
    response, success = make_request("GET", "/admin/stats")
    
    if success and response.status_code == 200:
        data = response.json()
        if "users" in data and "posts" in data:
            result.success("Admin Stats", f"Users: {data['users']}, Posts: {data['posts']}")
        else:
            result.fail("Admin Stats", "Missing stats data")
    else:
        result.fail("Admin Stats", 
                   f"Status: {response.status_code if response else 'Timeout/Error'}")

def run_focused_tests():
    """Run focused re-tests for previously failed scenarios"""
    print("🎯 Starting FOCUSED RE-TESTING for Previously Failed Scenarios")
    print("=" * 70)
    print("📋 Target: Stories Feed, Registration+Profile, Appeals, Grievances, Social Flow")
    print("=" * 70)
    
    try:
        # Core flow
        login_existing_users()
        test_stories_feed_with_auth()
        test_new_user_registration_and_profile_flow()
        test_appeals_flow()
        test_grievances_flow()
        test_media_upload_and_content()
        test_full_social_interaction_flow()
        test_moderation_flow()
        
    except Exception as e:
        print(f"\n❌ Unexpected error during focused testing: {e}")
        result.fail("Test Execution", str(e))
    
    # Print summary
    result.summary()
    
    return result.failed == 0

if __name__ == "__main__":
    success = run_focused_tests()
    sys.exit(0 if success else 1)