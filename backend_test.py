#!/usr/bin/env python3
"""
B1 Identity & Media Resolution — Targeted Contract Tests

This test suite validates the B1 backend changes for canonical avatar URL resolution
across ALL API surfaces. Tests the specific contract requirements for avatar fields.

Base URL: https://tribe-api-client.preview.emergentagent.com/api
Test Users: Phone numbers like 9000000001, PIN: 1234
"""

import requests
import json
import time
import base64
from datetime import datetime
import uuid
import random

class B1IdentityTests:
    def __init__(self):
        self.base_url = "https://tribe-api-client.preview.emergentagent.com/api"
        self.headers = {"Content-Type": "application/json"}
        
        # Generate unique phone numbers for this test run
        self.base_phone = 9900000000 + random.randint(1000, 9999)
        
        # Test data
        self.test_users = []
        self.tokens = []
        self.user_ids = []
        self.media_id = None
        self.post_id = None
        
        # Results tracking
        self.results = []
        self.passed = 0
        self.failed = 0

    def log_result(self, test_name, success, message, details=None):
        """Log test result with details"""
        status = "✅ PASS" if success else "❌ FAIL"
        self.results.append({
            "test": test_name,
            "status": status,
            "message": message,
            "details": details or {}
        })
        
        if success:
            self.passed += 1
        else:
            self.failed += 1
        
        print(f"{status}: {test_name} - {message}")
        if not success and details:
            print(f"   Details: {json.dumps(details, indent=2)}")

    def make_request(self, method, endpoint, data=None, headers=None, token=None, retries=3):
        """Make HTTP request with proper error handling and retries"""
        url = f"{self.base_url}{endpoint}"
        req_headers = self.headers.copy()
        
        if headers:
            req_headers.update(headers)
            
        if token:
            req_headers["Authorization"] = f"Bearer {token}"
        
        for attempt in range(retries):
            try:
                if method == "GET":
                    response = requests.get(url, headers=req_headers, timeout=60)
                elif method == "POST":
                    response = requests.post(url, json=data, headers=req_headers, timeout=60)
                elif method == "PATCH":
                    response = requests.patch(url, json=data, headers=req_headers, timeout=60)
                elif method == "PUT":
                    response = requests.put(url, json=data, headers=req_headers, timeout=60)
                elif method == "DELETE":
                    response = requests.delete(url, headers=req_headers, timeout=60)
                else:
                    raise ValueError(f"Unsupported method: {method}")
                
                # Handle rate limiting
                if response.status_code == 429:
                    if attempt < retries - 1:
                        wait_time = 30 + (attempt * 10)
                        print(f"⚠️  Rate limited, waiting {wait_time}s before retry...")
                        time.sleep(wait_time)
                        continue
                
                return response
                
            except requests.exceptions.Timeout:
                if attempt < retries - 1:
                    print(f"⚠️  Timeout on attempt {attempt + 1}, retrying...")
                    time.sleep(5)
                    continue
                print(f"⚠️  Request timeout for {method} {endpoint}")
                return None
            except requests.exceptions.RequestException as e:
                if attempt < retries - 1:
                    print(f"⚠️  Request error on attempt {attempt + 1}, retrying...")
                    time.sleep(5)
                    continue
                print(f"⚠️  Request error for {method} {endpoint}: {e}")
                return None
        
        return None

    def check_avatar_fields(self, user_data, context="user"):
        """Validate avatar fields contract: avatarUrl, avatarMediaId, avatar"""
        issues = []
        
        # Check required fields exist
        if "avatarUrl" not in user_data:
            issues.append("Missing avatarUrl field")
        if "avatarMediaId" not in user_data:
            issues.append("Missing avatarMediaId field") 
        if "avatar" not in user_data:
            issues.append("Missing avatar field")
            
        # For null avatar case
        if user_data.get("avatarMediaId") is None:
            if user_data.get("avatarUrl") is not None:
                issues.append("avatarUrl should be null when avatarMediaId is null")
            if user_data.get("avatar") is not None:
                issues.append("avatar should be null when avatarMediaId is null")
                
        # For set avatar case
        elif user_data.get("avatarMediaId"):
            media_id = user_data.get("avatarMediaId")
            expected_url = f"/api/media/{media_id}"
            
            if user_data.get("avatarUrl") != expected_url:
                issues.append(f"avatarUrl should be '{expected_url}', got '{user_data.get('avatarUrl')}'")
            if user_data.get("avatar") != media_id:
                issues.append(f"avatar should equal avatarMediaId '{media_id}', got '{user_data.get('avatar')}'")
                
        return issues

    def check_security_fields(self, user_data):
        """Ensure pinHash and pinSalt are never present"""
        issues = []
        
        if "pinHash" in user_data:
            issues.append("pinHash field leaked in response")
        if "pinSalt" in user_data:
            issues.append("pinSalt field leaked in response")
            
        return issues

    def test_1_register_no_avatar(self):
        """Test 1: Register → verify avatar fields (no-avatar case)"""
        phone = str(self.base_phone)  # Use generated unique phone
        data = {
            "phone": phone,
            "pin": "1234",
            "displayName": "TestUserB1_1"
        }
        
        response = self.make_request("POST", "/auth/register", data)
        
        if not response:
            self.log_result("test_1_register_no_avatar", False, "Request failed")
            return
            
        if response.status_code != 201:
            self.log_result("test_1_register_no_avatar", False, 
                           f"Expected 201, got {response.status_code}", 
                           {"response": response.text})
            return
            
        try:
            result = response.json()
            user = result.get("user", {})
            
            # Store for later tests
            if "accessToken" in result:
                self.tokens.append(result["accessToken"])
                self.user_ids.append(user.get("id"))
                
            # Check avatar fields
            avatar_issues = self.check_avatar_fields(user, "register")
            security_issues = self.check_security_fields(user)
            
            all_issues = avatar_issues + security_issues
            
            if all_issues:
                self.log_result("test_1_register_no_avatar", False, 
                               "Avatar/security field issues", {"issues": all_issues})
            else:
                self.log_result("test_1_register_no_avatar", True, 
                               "All avatar fields correct (null case)")
                
        except json.JSONDecodeError:
            self.log_result("test_1_register_no_avatar", False, 
                           "Invalid JSON response", {"response": response.text})

    def test_2_login_verify_avatar(self):
        """Test 2: Login → verify avatar fields"""
        phone = str(self.base_phone)
        data = {
            "phone": phone,
            "pin": "1234"
        }
        
        response = self.make_request("POST", "/auth/login", data)
        
        if not response:
            self.log_result("test_2_login_verify_avatar", False, "Request failed")
            return
            
        if response.status_code != 200:
            self.log_result("test_2_login_verify_avatar", False, 
                           f"Expected 200, got {response.status_code}", 
                           {"response": response.text})
            return
            
        try:
            result = response.json()
            user = result.get("user", {})
            
            avatar_issues = self.check_avatar_fields(user, "login")
            security_issues = self.check_security_fields(user)
            
            all_issues = avatar_issues + security_issues
            
            if all_issues:
                self.log_result("test_2_login_verify_avatar", False, 
                               "Avatar/security field issues", {"issues": all_issues})
            else:
                self.log_result("test_2_login_verify_avatar", True, 
                               "Avatar fields correct in login")
                
        except json.JSONDecodeError:
            self.log_result("test_2_login_verify_avatar", False, 
                           "Invalid JSON response", {"response": response.text})

    def test_3_auth_me_verify_avatar(self):
        """Test 3: /auth/me → verify avatar fields"""
        if not self.tokens:
            self.log_result("test_3_auth_me_verify_avatar", False, "No token available")
            return
            
        token = self.tokens[0]
        response = self.make_request("GET", "/auth/me", token=token)
        
        if not response:
            self.log_result("test_3_auth_me_verify_avatar", False, "Request failed")
            return
            
        if response.status_code != 200:
            self.log_result("test_3_auth_me_verify_avatar", False, 
                           f"Expected 200, got {response.status_code}", 
                           {"response": response.text})
            return
            
        try:
            result = response.json()
            # /auth/me returns { user: {...} } wrapper
            user = result.get("user", {})
            
            avatar_issues = self.check_avatar_fields(user, "auth/me")
            security_issues = self.check_security_fields(user)
            
            all_issues = avatar_issues + security_issues
            
            if all_issues:
                self.log_result("test_3_auth_me_verify_avatar", False, 
                               "Avatar/security field issues", {"issues": all_issues})
            else:
                self.log_result("test_3_auth_me_verify_avatar", True, 
                               "Avatar fields correct in /auth/me")
                
        except json.JSONDecodeError:
            self.log_result("test_3_auth_me_verify_avatar", False, 
                           "Invalid JSON response", {"response": response.text})

    def test_4_users_id_verify_avatar(self):
        """Test 4: /users/:id → verify avatar fields"""
        if not self.tokens or not self.user_ids:
            self.log_result("test_4_users_id_verify_avatar", False, "No token or user ID available")
            return
            
        token = self.tokens[0]
        user_id = self.user_ids[0]
        
        response = self.make_request("GET", f"/users/{user_id}", token=token)
        
        if not response:
            self.log_result("test_4_users_id_verify_avatar", False, "Request failed")
            return
            
        if response.status_code != 200:
            self.log_result("test_4_users_id_verify_avatar", False, 
                           f"Expected 200, got {response.status_code}", 
                           {"response": response.text})
            return
            
        try:
            result = response.json()
            # /users/:id returns { user: {...} } wrapper
            user = result.get("user", {})
            
            avatar_issues = self.check_avatar_fields(user, "users/:id")
            security_issues = self.check_security_fields(user)
            
            all_issues = avatar_issues + security_issues
            
            if all_issues:
                self.log_result("test_4_users_id_verify_avatar", False, 
                               "Avatar/security field issues", {"issues": all_issues})
            else:
                self.log_result("test_4_users_id_verify_avatar", True, 
                               "Avatar fields correct in /users/:id")
                
        except json.JSONDecodeError:
            self.log_result("test_4_users_id_verify_avatar", False, 
                           "Invalid JSON response", {"response": response.text})

    def test_5_upload_media_set_avatar(self):
        """Test 5: Upload media → set avatar → verify resolved URL"""
        if not self.tokens:
            self.log_result("test_5_upload_media_set_avatar", False, "No token available")
            return
            
        token = self.tokens[0]
        
        # First upload media
        media_data = {
            "data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            "mimeType": "image/png",
            "type": "IMAGE"
        }
        
        media_response = self.make_request("POST", "/media/upload", media_data, token=token)
        
        if not media_response or media_response.status_code != 201:
            self.log_result("test_5_upload_media_set_avatar", False, 
                           f"Media upload failed: {media_response.status_code if media_response else 'No response'}")
            return
            
        try:
            media_result = media_response.json()
            self.media_id = media_result.get("id")
            
            if not self.media_id:
                self.log_result("test_5_upload_media_set_avatar", False, 
                               "No media ID in upload response", {"response": media_result})
                return
                
            # Set avatar
            avatar_data = {"avatarMediaId": self.media_id}
            avatar_response = self.make_request("PATCH", "/me/profile", avatar_data, token=token)
            
            if not avatar_response or avatar_response.status_code != 200:
                self.log_result("test_5_upload_media_set_avatar", False, 
                               f"Avatar set failed: {avatar_response.status_code if avatar_response else 'No response'}")
                return
                
            avatar_result = avatar_response.json()
            user = avatar_result.get("user", {})
            
            # Verify avatar URL resolution
            expected_url = f"/api/media/{self.media_id}"
            
            issues = []
            if user.get("avatarUrl") != expected_url:
                issues.append(f"avatarUrl should be '{expected_url}', got '{user.get('avatarUrl')}'")
            if user.get("avatarMediaId") != self.media_id:
                issues.append(f"avatarMediaId should be '{self.media_id}', got '{user.get('avatarMediaId')}'")
            if user.get("avatar") != self.media_id:
                issues.append(f"avatar should be '{self.media_id}', got '{user.get('avatar')}'")
                
            if issues:
                self.log_result("test_5_upload_media_set_avatar", False, 
                               "Avatar URL resolution issues", {"issues": issues})
            else:
                self.log_result("test_5_upload_media_set_avatar", True, 
                               f"Avatar URL correctly resolved to {expected_url}")
                
        except json.JSONDecodeError as e:
            self.log_result("test_5_upload_media_set_avatar", False, 
                           f"JSON decode error: {e}")

    def test_6_verify_auth_me_with_avatar(self):
        """Test 6: GET /auth/me after avatar set → verify same"""
        if not self.tokens or not self.media_id:
            self.log_result("test_6_verify_auth_me_with_avatar", False, "No token or media ID")
            return
            
        token = self.tokens[0]
        response = self.make_request("GET", "/auth/me", token=token)
        
        if not response or response.status_code != 200:
            self.log_result("test_6_verify_auth_me_with_avatar", False, 
                           f"Request failed: {response.status_code if response else 'No response'}")
            return
            
        try:
            result = response.json()
            # /auth/me returns { user: {...} } wrapper
            user = result.get("user", {})
            expected_url = f"/api/media/{self.media_id}"
            
            issues = []
            if user.get("avatarUrl") != expected_url:
                issues.append(f"avatarUrl should be '{expected_url}', got '{user.get('avatarUrl')}'")
            if user.get("avatarMediaId") != self.media_id:
                issues.append(f"avatarMediaId should be '{self.media_id}', got '{user.get('avatarMediaId')}'")
                
            if issues:
                self.log_result("test_6_verify_auth_me_with_avatar", False, 
                               "Avatar fields inconsistent", {"issues": issues})
            else:
                self.log_result("test_6_verify_auth_me_with_avatar", True, 
                               "/auth/me avatar fields consistent after set")
                
        except json.JSONDecodeError:
            self.log_result("test_6_verify_auth_me_with_avatar", False, "Invalid JSON response")

    def test_7_content_detail_author_avatar(self):
        """Test 7: Content detail → verify enriched author has avatarUrl (toUserSnippet path)"""
        if not self.tokens:
            self.log_result("test_7_content_detail_author_avatar", False, "No token available")
            return
            
        token = self.tokens[0]
        
        # First set age (required for content creation)
        age_response = self.make_request("PATCH", "/me/age", {"birthYear": 2000}, token=token)
        if not age_response or age_response.status_code != 200:
            self.log_result("test_7_content_detail_author_avatar", False, 
                           "Age setting failed")
            return
            
        # Create post
        post_data = {"caption": "test post for avatar check"}
        post_response = self.make_request("POST", "/content/posts", post_data, token=token)
        
        if not post_response or post_response.status_code != 201:
            self.log_result("test_7_content_detail_author_avatar", False, 
                           f"Post creation failed: {post_response.status_code if post_response else 'No response'}")
            return
            
        try:
            post_result = post_response.json()
            post = post_result.get("post", {})
            self.post_id = post.get("id")
            
            if not self.post_id:
                self.log_result("test_7_content_detail_author_avatar", False, "No post ID returned")
                return
                
            # Get post detail
            detail_response = self.make_request("GET", f"/content/{self.post_id}", token=token)
            
            if not detail_response or detail_response.status_code != 200:
                self.log_result("test_7_content_detail_author_avatar", False, 
                               f"Get post detail failed: {detail_response.status_code if detail_response else 'No response'}")
                return
                
            detail_result = detail_response.json()
            # Content detail returns { post: { author: {...} } }
            post = detail_result.get("post", {})
            author = post.get("author", {})
            
            # Verify toUserSnippet contract
            issues = []
            
            # Check avatar fields
            avatar_issues = self.check_avatar_fields(author, "post author")
            issues.extend(avatar_issues)
            
            # Check author has required snippet fields (relaxed for tribeId/tribeCode since they may be null)
            required_fields = ["id", "displayName"]
            for field in required_fields:
                if field not in author:
                    issues.append(f"Missing required author field: {field}")
                    
            # Check author does NOT have phone field (toUserSnippet strips it)
            if "phone" in author:
                issues.append("phone field leaked in author snippet")
                
            if issues:
                self.log_result("test_7_content_detail_author_avatar", False, 
                               "Author snippet issues", {"issues": issues})
            else:
                # Note: tribeId/tribeCode may be null for new users - this is acceptable
                self.log_result("test_7_content_detail_author_avatar", True, 
                               "Author snippet correct with avatar fields")
                
        except json.JSONDecodeError:
            self.log_result("test_7_content_detail_author_avatar", False, "Invalid JSON response")

    def test_8_comment_author_avatar(self):
        """Test 8: Comment author → verify avatarUrl"""
        if not self.tokens or not self.post_id:
            self.log_result("test_8_comment_author_avatar", False, "No token or post ID")
            return
            
        token = self.tokens[0]
        
        # Create comment
        comment_data = {"body": "test comment"}
        comment_response = self.make_request("POST", f"/content/{self.post_id}/comments", 
                                           comment_data, token=token)
        
        if not comment_response or comment_response.status_code != 201:
            self.log_result("test_8_comment_author_avatar", False, 
                           f"Comment creation failed: {comment_response.status_code if comment_response else 'No response'}")
            return
            
        try:
            comment_result = comment_response.json()
            comment = comment_result.get("comment", {})
            author = comment.get("author", {})
            
            # Verify comment author has avatar fields
            issues = self.check_avatar_fields(author, "comment author")
            
            if issues:
                self.log_result("test_8_comment_author_avatar", False, 
                               "Comment author avatar issues", {"issues": issues})
            else:
                self.log_result("test_8_comment_author_avatar", True, 
                               "Comment author has correct avatar fields")
                
        except json.JSONDecodeError:
            self.log_result("test_8_comment_author_avatar", False, "Invalid JSON response")

    def test_9_register_second_user(self):
        """Test 9: Register second user for follow tests"""
        phone = str(self.base_phone + 1)  # Next phone number
        data = {
            "phone": phone,
            "pin": "1234", 
            "displayName": "TestUserB1_2"
        }
        
        response = self.make_request("POST", "/auth/register", data)
        
        if not response or response.status_code != 201:
            self.log_result("test_9_register_second_user", False, 
                           f"Registration failed: {response.status_code if response else 'No response'}")
            return
            
        try:
            result = response.json()
            user = result.get("user", {})
            
            if "accessToken" in result:
                self.tokens.append(result["accessToken"])
                self.user_ids.append(user.get("id"))
                
            # Set age for second user
            age_response = self.make_request("PATCH", "/me/age", {"birthYear": 2000}, 
                                           token=result["accessToken"])
            
            if age_response and age_response.status_code == 200:
                self.log_result("test_9_register_second_user", True, 
                               "Second user registered and age set")
            else:
                self.log_result("test_9_register_second_user", False, "Age setting failed for user 2")
                
        except json.JSONDecodeError:
            self.log_result("test_9_register_second_user", False, "Invalid JSON response")

    def test_10_followers_avatar(self):
        """Test 10: Followers → verify avatarUrl"""
        if len(self.tokens) < 2 or len(self.user_ids) < 2:
            self.log_result("test_10_followers_avatar", False, "Need 2 users for follow test")
            return
            
        user1_token = self.tokens[0]
        user2_token = self.tokens[1] 
        user1_id = self.user_ids[0]
        user2_id = self.user_ids[1]
        
        # User2 follows User1
        follow_response = self.make_request("POST", f"/follow/{user1_id}", token=user2_token)
        
        if not follow_response or follow_response.status_code not in [200, 201]:
            self.log_result("test_10_followers_avatar", False, 
                           f"Follow failed: {follow_response.status_code if follow_response else 'No response'}")
            return
            
        # Get User1's followers
        followers_response = self.make_request("GET", f"/users/{user1_id}/followers", token=user1_token)
        
        if not followers_response or followers_response.status_code != 200:
            self.log_result("test_10_followers_avatar", False, 
                           f"Get followers failed: {followers_response.status_code if followers_response else 'No response'}")
            return
            
        try:
            followers_result = followers_response.json()
            followers = followers_result.get("followers", [])
            
            if not followers:
                self.log_result("test_10_followers_avatar", False, "No followers returned")
                return
                
            # Check first follower avatar fields
            follower = followers[0]
            issues = self.check_avatar_fields(follower, "follower")
            
            if issues:
                self.log_result("test_10_followers_avatar", False, 
                               "Follower avatar issues", {"issues": issues})
            else:
                self.log_result("test_10_followers_avatar", True, 
                               "Follower has correct avatar fields")
                
        except json.JSONDecodeError:
            self.log_result("test_10_followers_avatar", False, "Invalid JSON response")

    def test_11_following_avatar(self):
        """Test 11: /users/:id/following → verify avatarUrl"""
        if len(self.tokens) < 2 or len(self.user_ids) < 2:
            self.log_result("test_11_following_avatar", False, "Need 2 users for following test")
            return
            
        user2_token = self.tokens[1]
        user2_id = self.user_ids[1]
        
        # Get User2's following list
        following_response = self.make_request("GET", f"/users/{user2_id}/following", token=user2_token)
        
        if not following_response or following_response.status_code != 200:
            self.log_result("test_11_following_avatar", False, 
                           f"Get following failed: {following_response.status_code if following_response else 'No response'}")
            return
            
        try:
            following_result = following_response.json()
            following = following_result.get("following", [])
            
            if not following:
                self.log_result("test_11_following_avatar", False, "No following returned")
                return
                
            # Check first following user avatar fields  
            following_user = following[0]
            issues = self.check_avatar_fields(following_user, "following")
            
            if issues:
                self.log_result("test_11_following_avatar", False, 
                               "Following user avatar issues", {"issues": issues})
            else:
                self.log_result("test_11_following_avatar", True, 
                               "Following user has correct avatar fields")
                
        except json.JSONDecodeError:
            self.log_result("test_11_following_avatar", False, "Invalid JSON response")

    def test_12_notifications_structure(self):
        """Test 12: Notifications → verify structure"""
        if len(self.tokens) < 2:
            self.log_result("test_12_notifications_structure", False, "Need 2 users for notifications test")
            return
            
        user1_token = self.tokens[0]  # Should have notifications from follow/comment
        
        notifications_response = self.make_request("GET", "/notifications", token=user1_token)
        
        if not notifications_response or notifications_response.status_code != 200:
            self.log_result("test_12_notifications_structure", False, 
                           f"Get notifications failed: {notifications_response.status_code if notifications_response else 'No response'}")
            return
            
        try:
            notifications_result = notifications_response.json()
            notifications = notifications_result.get("notifications", [])
            
            if not notifications:
                self.log_result("test_12_notifications_structure", True, 
                               "No notifications (expected for new users)")
                return
                
            # Check first notification structure
            notification = notifications[0]
            required_fields = ["type", "actorId", "message"]
            
            issues = []
            for field in required_fields:
                if field not in notification:
                    issues.append(f"Missing notification field: {field}")
                    
            if issues:
                self.log_result("test_12_notifications_structure", False, 
                               "Notification structure issues", {"issues": issues})
            else:
                self.log_result("test_12_notifications_structure", True, 
                               "Notification structure correct")
                
        except json.JSONDecodeError:
            self.log_result("test_12_notifications_structure", False, "Invalid JSON response")

    def run_all_tests(self):
        """Run all B1 Identity & Media Resolution tests"""
        print("🚀 Starting B1 Identity & Media Resolution Tests")
        print(f"📍 Base URL: {self.base_url}")
        print("=" * 80)
        
        # Test sequence
        self.test_1_register_no_avatar()
        time.sleep(0.5)
        
        self.test_2_login_verify_avatar() 
        time.sleep(0.5)
        
        self.test_3_auth_me_verify_avatar()
        time.sleep(0.5)
        
        self.test_4_users_id_verify_avatar()
        time.sleep(0.5)
        
        self.test_5_upload_media_set_avatar()
        time.sleep(0.5)
        
        self.test_6_verify_auth_me_with_avatar()
        time.sleep(0.5)
        
        self.test_7_content_detail_author_avatar()
        time.sleep(0.5)
        
        self.test_8_comment_author_avatar()
        time.sleep(0.5)
        
        self.test_9_register_second_user()
        time.sleep(0.5)
        
        self.test_10_followers_avatar()
        time.sleep(0.5)
        
        self.test_11_following_avatar()
        time.sleep(0.5)
        
        self.test_12_notifications_structure()
        
        # Summary
        print("=" * 80)
        print(f"🎯 B1 IDENTITY & MEDIA RESOLUTION TEST RESULTS")
        print(f"✅ Passed: {self.passed}")
        print(f"❌ Failed: {self.failed}")
        print(f"📊 Success Rate: {(self.passed / (self.passed + self.failed) * 100):.1f}%")
        
        if self.failed > 0:
            print(f"\n❌ FAILED TESTS:")
            for result in self.results:
                if "FAIL" in result["status"]:
                    print(f"   • {result['test']}: {result['message']}")
        
        print("\n🔍 KEY FEATURES TESTED:")
        print("   • Avatar field resolution (avatarUrl, avatarMediaId, avatar)")
        print("   • resolveMediaUrl() central resolver")
        print("   • toUserSnippet() in author enrichment")  
        print("   • toUserProfile() in auth endpoints")
        print("   • Security: pinHash/pinSalt never leaked")
        print("   • Contract compliance across all surfaces")

if __name__ == "__main__":
    tester = B1IdentityTests()
    tester.run_all_tests()