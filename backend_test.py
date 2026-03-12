#!/usr/bin/env python3
"""
Backend Test Suite for Tribe Social Media API - 4 New World-Class Features
Testing 33 total endpoints across 4 new feature sets plus existing features.
"""

import json
import time
import requests
import traceback
from typing import Dict, Any, List, Optional

# Configuration
BASE_URL = "https://tribe-feed-debug.preview.emergentagent.com/api"
TIMEOUT = 30

# Test users with pre-configured credentials
USER1_PHONE = "7777099001"
USER1_PIN = "1234"
USER2_PHONE = "7777099002"
USER2_PIN = "1234"

class TribeAPITester:
    def __init__(self):
        self.base_url = BASE_URL
        self.user1_token = None
        self.user2_token = None
        self.user1_id = None
        self.user2_id = None
        self.test_results = []
        self.session = requests.Session()
        self.session.timeout = TIMEOUT
        
    def log_result(self, test_name: str, success: bool, details: str = "", response_data: Any = None):
        """Log test result with details"""
        result = {
            "test": test_name,
            "success": success,
            "details": details,
            "response_data": response_data if response_data and len(str(response_data)) < 500 else "Large response truncated"
        }
        self.test_results.append(result)
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status}: {test_name} - {details}")
        
    def make_request(self, method: str, endpoint: str, token: str = None, data: Dict = None, params: Dict = None) -> tuple:
        """Make HTTP request with proper headers"""
        url = f"{self.base_url}{endpoint}"
        headers = {"Content-Type": "application/json"}
        
        if token:
            headers["Authorization"] = f"Bearer {token}"
            
        try:
            if method.upper() == "GET":
                response = self.session.get(url, headers=headers, params=params)
            elif method.upper() == "POST":
                response = self.session.post(url, headers=headers, json=data, params=params)
            elif method.upper() == "PATCH":
                response = self.session.patch(url, headers=headers, json=data, params=params)
            elif method.upper() == "DELETE":
                response = self.session.delete(url, headers=headers, json=data, params=params)
            elif method.upper() == "PUT":
                response = self.session.put(url, headers=headers, json=data, params=params)
            else:
                return None, f"Unsupported method: {method}"
                
            return response, None
        except Exception as e:
            return None, f"Request failed: {str(e)}"
    
    def setup_auth(self):
        """Authenticate both test users and get their user IDs"""
        print("\n🔐 Setting up authentication...")
        
        # Login User 1
        response, error = self.make_request("POST", "/auth/login", data={
            "phone": USER1_PHONE,
            "pin": USER1_PIN
        })
        
        if error or not response or response.status_code != 200:
            self.log_result("User 1 Login", False, f"Login failed: {error or response.text if response else 'No response'}")
            return False
            
        data = response.json()
        self.user1_token = data.get("token")
        if not self.user1_token:
            self.log_result("User 1 Login", False, "No token in response")
            return False
            
        # Get User 1 ID
        response, error = self.make_request("GET", "/auth/me", token=self.user1_token)
        if error or not response or response.status_code != 200:
            self.log_result("User 1 Profile", False, f"Get profile failed: {error or response.text if response else 'No response'}")
            return False
            
        user_data = response.json()
        self.user1_id = user_data.get("user", {}).get("id")
        
        self.log_result("User 1 Authentication", True, f"Token obtained, User ID: {self.user1_id}")
        
        # Wait 5+ seconds between login calls as requested
        print("⏰ Waiting 5 seconds between login calls...")
        time.sleep(5)
        
        # Login User 2
        response, error = self.make_request("POST", "/auth/login", data={
            "phone": USER2_PHONE,
            "pin": USER2_PIN
        })
        
        if error or not response or response.status_code != 200:
            self.log_result("User 2 Login", False, f"Login failed: {error or response.text if response else 'No response'}")
            return False
            
        data = response.json()
        self.user2_token = data.get("token")
        if not self.user2_token:
            self.log_result("User 2 Login", False, "No token in response")
            return False
            
        # Get User 2 ID
        response, error = self.make_request("GET", "/auth/me", token=self.user2_token)
        if error or not response or response.status_code != 200:
            self.log_result("User 2 Profile", False, f"Get profile failed: {error or response.text if response else 'No response'}")
            return False
            
        user_data = response.json()
        self.user2_id = user_data.get("user", {}).get("id")
        
        self.log_result("User 2 Authentication", True, f"Token obtained, User ID: {self.user2_id}")
        
        return True

    def test_feature1_full_text_search(self):
        """Test FEATURE 1: Full-Text Search with Autocomplete (8 endpoints)"""
        print("\n🔍 Testing FEATURE 1: Full-Text Search with Autocomplete...")
        
        # Test 1: Unified search
        response, error = self.make_request("GET", "/search", params={"q": "test"})
        if error or not response:
            self.log_result("Unified Search", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            # Should return results with users, posts, reels, hashtags, pages, tribes
            self.log_result("Unified Search", True, f"Returned search results with {len(data)} items")
        else:
            self.log_result("Unified Search", False, f"HTTP {response.status_code}: {response.text}")
            
        # Test 2: Autocomplete
        response, error = self.make_request("GET", "/search/autocomplete", params={"q": "te"})
        if error or not response:
            self.log_result("Search Autocomplete", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            suggestions = data.get("suggestions", []) if isinstance(data, dict) else data
            self.log_result("Search Autocomplete", True, f"Returned {len(suggestions)} suggestions")
        else:
            self.log_result("Search Autocomplete", False, f"HTTP {response.status_code}: {response.text}")
            
        # Test 3: Search users
        response, error = self.make_request("GET", "/search/users", params={"q": "user"})
        if error or not response:
            self.log_result("Search Users", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            items = data.get("items", [])
            has_more = data.get("hasMore", False)
            self.log_result("Search Users", True, f"Found {len(items)} users, hasMore: {has_more}")
        else:
            self.log_result("Search Users", False, f"HTTP {response.status_code}: {response.text}")
            
        # Test 4: Search hashtags
        response, error = self.make_request("GET", "/search/hashtags", params={"q": "a"})
        if error or not response:
            self.log_result("Search Hashtags", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            items = data.get("items", [])
            # Each item should have hashtag and postCount
            self.log_result("Search Hashtags", True, f"Found {len(items)} hashtags")
        else:
            self.log_result("Search Hashtags", False, f"HTTP {response.status_code}: {response.text}")
            
        # Test 5: Search content (posts)
        response, error = self.make_request("GET", "/search/content", params={"q": "test"})
        if error or not response:
            self.log_result("Search Content", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            items = data.get("items", [])
            self.log_result("Search Content", True, f"Found {len(items)} content items")
        else:
            self.log_result("Search Content", False, f"HTTP {response.status_code}: {response.text}")
            
        # Test 6: Hashtag detail page
        response, error = self.make_request("GET", "/hashtags/test")
        if error or not response:
            self.log_result("Hashtag Detail", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            hashtag = data.get("hashtag")
            total_posts = data.get("totalPosts", 0)
            items = data.get("items", [])
            self.log_result("Hashtag Detail", True, f"Hashtag: {hashtag}, Posts: {total_posts}, Items: {len(items)}")
        else:
            self.log_result("Hashtag Detail", False, f"HTTP {response.status_code}: {response.text}")
            
        # Test 7: Recent searches (auth required)
        response, error = self.make_request("GET", "/search/recent", token=self.user1_token)
        if error or not response:
            self.log_result("Recent Searches", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            self.log_result("Recent Searches", True, f"Retrieved recent searches: {len(data) if isinstance(data, list) else 'dict response'}")
        else:
            self.log_result("Recent Searches", False, f"HTTP {response.status_code}: {response.text}")
            
        # Test 8: Clear recent searches (auth required)
        response, error = self.make_request("DELETE", "/search/recent", token=self.user1_token)
        if error or not response:
            self.log_result("Clear Recent Searches", False, f"Request failed: {error}")
        elif response.status_code in [200, 204]:
            self.log_result("Clear Recent Searches", True, "Recent searches cleared successfully")
        else:
            self.log_result("Clear Recent Searches", False, f"HTTP {response.status_code}: {response.text}")

    def test_feature2_engagement_analytics(self):
        """Test FEATURE 2: Engagement Analytics Dashboard (7 endpoints)"""
        print("\n📊 Testing FEATURE 2: Engagement Analytics Dashboard...")
        
        # Test 9: Track event
        response, error = self.make_request("POST", "/analytics/track", 
                                          token=self.user1_token,
                                          data={
                                              "eventType": "PROFILE_VISIT",
                                              "targetId": "test123",
                                              "targetType": "USER"
                                          })
        if error or not response:
            self.log_result("Analytics Track Event", False, f"Request failed: {error}")
        elif response.status_code in [200, 201]:
            self.log_result("Analytics Track Event", True, "Event tracked successfully")
        else:
            self.log_result("Analytics Track Event", False, f"HTTP {response.status_code}: {response.text}")
            
        # Test 10: Overview analytics
        response, error = self.make_request("GET", "/analytics/overview", token=self.user1_token)
        if error or not response:
            self.log_result("Analytics Overview", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            engagement = data.get("engagement", {})
            reach = data.get("reach", {})
            audience = data.get("audience", {})
            self.log_result("Analytics Overview", True, f"Overview with engagement, reach, audience sections")
        else:
            self.log_result("Analytics Overview", False, f"HTTP {response.status_code}: {response.text}")
            
        # Test 11: Content performance
        response, error = self.make_request("GET", "/analytics/content", token=self.user1_token)
        if error or not response:
            self.log_result("Analytics Content", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            items = data.get("items", [])
            self.log_result("Analytics Content", True, f"Content performance for {len(items)} items")
        else:
            self.log_result("Analytics Content", False, f"HTTP {response.status_code}: {response.text}")
            
        # First create a post to get postId for single content analytics
        post_id = None
        response, error = self.make_request("POST", "/content/posts",
                                          token=self.user1_token,
                                          data={
                                              "caption": "Test post for analytics",
                                              "kind": "POST"
                                          })
        if response and response.status_code in [200, 201]:
            post_data = response.json()
            # The post might be in a nested structure
            if "post" in post_data:
                post_id = post_data["post"].get("id")
            else:
                post_id = post_data.get("id")
            
        # Test 12: Single content analytics
        if post_id:
            response, error = self.make_request("GET", f"/analytics/content/{post_id}", token=self.user1_token)
            if error or not response:
                self.log_result("Single Content Analytics", False, f"Request failed: {error}")
            elif response.status_code == 200:
                data = response.json()
                self.log_result("Single Content Analytics", True, f"Analytics for post {post_id}")
            else:
                self.log_result("Single Content Analytics", False, f"HTTP {response.status_code}: {response.text}")
        else:
            self.log_result("Single Content Analytics", False, "No post ID available for testing")
            
        # Test 13: Audience demographics
        response, error = self.make_request("GET", "/analytics/audience", token=self.user1_token)
        if error or not response:
            self.log_result("Analytics Audience", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            demographics = data.get("demographics", {})
            top_engagers = data.get("topEngagers", [])
            self.log_result("Analytics Audience", True, f"Demographics and {len(top_engagers)} top engagers")
        else:
            self.log_result("Analytics Audience", False, f"HTTP {response.status_code}: {response.text}")
            
        # Test 14: Reach & impressions
        response, error = self.make_request("GET", "/analytics/reach", token=self.user1_token)
        if error or not response:
            self.log_result("Analytics Reach", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            # Time series data
            self.log_result("Analytics Reach", True, "Reach & impressions time series retrieved")
        else:
            self.log_result("Analytics Reach", False, f"HTTP {response.status_code}: {response.text}")
            
        # Test 15: Reel analytics
        response, error = self.make_request("GET", "/analytics/reels", token=self.user1_token)
        if error or not response:
            self.log_result("Analytics Reels", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            total_reels = data.get("totalReels", 0)
            total_views = data.get("totalViews", 0)
            items = data.get("items", [])
            self.log_result("Analytics Reels", True, f"Reels: {total_reels}, Views: {total_views}, Items: {len(items)}")
        else:
            self.log_result("Analytics Reels", False, f"HTTP {response.status_code}: {response.text}")
            
        # Test 16: Profile visits
        response, error = self.make_request("GET", "/analytics/profile-visits", token=self.user1_token)
        if error or not response:
            self.log_result("Analytics Profile Visits", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            self.log_result("Analytics Profile Visits", True, "Profile visit details retrieved")
        else:
            self.log_result("Analytics Profile Visits", False, f"HTTP {response.status_code}: {response.text}")

    def test_feature3_follow_requests(self):
        """Test FEATURE 3: Follow Request System (7 endpoints)"""
        print("\n👥 Testing FEATURE 3: Follow Request System...")
        
        # First make User 2 private
        response, error = self.make_request("PATCH", "/me/privacy", 
                                          token=self.user2_token,
                                          data={"isPrivate": True})
        if error or not response:
            self.log_result("Set User 2 Private", False, f"Request failed: {error}")
        elif response.status_code == 200:
            self.log_result("Set User 2 Private", True, "User 2 account set to private")
        else:
            self.log_result("Set User 2 Private", False, f"HTTP {response.status_code}: {response.text}")
            
        # Test 17: Unfollow first (if following)
        response, error = self.make_request("DELETE", f"/follow/{self.user2_id}", token=self.user1_token)
        # This might return 400 if not following, which is fine
        if response and response.status_code in [200, 400, 404]:
            self.log_result("Unfollow User 2", True, f"Unfollow attempted: {response.status_code}")
        else:
            self.log_result("Unfollow User 2", False, f"HTTP {response.status_code if response else 'No response'}: {response.text if response else error}")
            
        # Test 18: Follow private user (should create request)
        response, error = self.make_request("POST", f"/follow/{self.user2_id}", token=self.user1_token)
        if error or not response:
            self.log_result("Follow Private User", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            request_pending = data.get("requestPending")
            if request_pending:
                self.log_result("Follow Private User", True, "Follow request created successfully")
            else:
                self.log_result("Follow Private User", False, "Expected requestPending=true")
        else:
            self.log_result("Follow Private User", False, f"HTTP {response.status_code}: {response.text}")
            
        # Test 19: Get follow requests (User 2)
        response, error = self.make_request("GET", "/me/follow-requests", token=self.user2_token)
        if error or not response:
            self.log_result("Get Follow Requests", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            requests = data if isinstance(data, list) else data.get("requests", [])
            self.log_result("Get Follow Requests", True, f"Found {len(requests)} pending requests")
            
            # Store request ID for later acceptance
            self.request_id = None
            if requests:
                self.request_id = requests[0].get("id")
        else:
            self.log_result("Get Follow Requests", False, f"HTTP {response.status_code}: {response.text}")
            
        # Test 20: Get follow requests count
        response, error = self.make_request("GET", "/me/follow-requests/count", token=self.user2_token)
        if error or not response:
            self.log_result("Follow Requests Count", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            count = data.get("count", 0) if isinstance(data, dict) else data
            if count > 0:
                self.log_result("Follow Requests Count", True, f"Count: {count}")
            else:
                self.log_result("Follow Requests Count", False, f"Expected count > 0, got {count}")
        else:
            self.log_result("Follow Requests Count", False, f"HTTP {response.status_code}: {response.text}")
            
        # Test 21: Get sent requests (User 1)
        response, error = self.make_request("GET", "/me/follow-requests/sent", token=self.user1_token)
        if error or not response:
            self.log_result("Sent Follow Requests", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            sent_requests = data if isinstance(data, list) else data.get("requests", [])
            self.log_result("Sent Follow Requests", True, f"Found {len(sent_requests)} sent requests")
        else:
            self.log_result("Sent Follow Requests", False, f"HTTP {response.status_code}: {response.text}")
            
        # Test 22: Accept follow request
        if hasattr(self, 'request_id') and self.request_id:
            response, error = self.make_request("POST", f"/follow-requests/{self.request_id}/accept", token=self.user2_token)
            if error or not response:
                self.log_result("Accept Follow Request", False, f"Request failed: {error}")
            elif response.status_code == 200:
                self.log_result("Accept Follow Request", True, "Follow request accepted successfully")
            else:
                self.log_result("Accept Follow Request", False, f"HTTP {response.status_code}: {response.text}")
        else:
            self.log_result("Accept Follow Request", False, "No request ID available")
            
        # Create another request for accept-all test
        # First unfollow again
        response, error = self.make_request("DELETE", f"/follow/{self.user2_id}", token=self.user1_token)
        time.sleep(1)
        
        # Send new request
        response, error = self.make_request("POST", f"/follow/{self.user2_id}", token=self.user1_token)
        time.sleep(1)
        
        # Test 23: Accept all requests
        response, error = self.make_request("POST", "/follow-requests/accept-all", token=self.user2_token)
        if error or not response:
            self.log_result("Accept All Follow Requests", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            accepted_count = data.get("acceptedCount", 0) if isinstance(data, dict) else 0
            self.log_result("Accept All Follow Requests", True, f"Accepted {accepted_count} requests")
        else:
            self.log_result("Accept All Follow Requests", False, f"HTTP {response.status_code}: {response.text}")
            
        # Reset User 2 to public after testing
        response, error = self.make_request("PATCH", "/me/privacy", 
                                          token=self.user2_token,
                                          data={"isPrivate": False})
        if response and response.status_code == 200:
            self.log_result("Reset User 2 to Public", True, "User 2 account reset to public")
        else:
            self.log_result("Reset User 2 to Public", False, f"Failed to reset privacy")

    def test_feature4_video_transcoding(self):
        """Test FEATURE 4: Video Transcoding System (6 endpoints)"""
        print("\n🎥 Testing FEATURE 4: Video Transcoding System...")
        
        # Test 24: Upload init
        response, error = self.make_request("POST", "/media/upload-init",
                                          token=self.user1_token,
                                          data={
                                              "kind": "video",
                                              "mimeType": "video/mp4",
                                              "sizeBytes": 5000000
                                          })
        if error or not response:
            self.log_result("Media Upload Init", False, f"Request failed: {error}")
        elif response.status_code in [200, 201]:
            data = response.json()
            media_id = data.get("mediaId")
            if media_id:
                self.log_result("Media Upload Init", True, f"Media ID: {media_id}")
                self.media_id = media_id
            else:
                self.log_result("Media Upload Init", False, "No mediaId in response")
        else:
            self.log_result("Media Upload Init", False, f"HTTP {response.status_code}: {response.text}")
            
        # Test 25: Start transcoding
        if hasattr(self, 'media_id') and self.media_id:
            response, error = self.make_request("POST", f"/transcode/{self.media_id}",
                                              token=self.user1_token,
                                              data={"qualities": ["720p", "480p", "360p"]})
            if error or not response:
                self.log_result("Start Transcode", False, f"Request failed: {error}")
            elif response.status_code in [200, 201, 202]:  # 202 Accepted is valid for async operations
                data = response.json()
                job_id = data.get("job", {}).get("id") if "job" in data else data.get("jobId")
                if job_id:
                    self.log_result("Start Transcode", True, f"Job ID: {job_id}")
                    self.job_id = job_id
                else:
                    self.log_result("Start Transcode", False, "No jobId in response")
            else:
                self.log_result("Start Transcode", False, f"HTTP {response.status_code}: {response.text}")
        else:
            self.log_result("Start Transcode", False, "No media ID available")
            
        # Test 26: Check job status
        if hasattr(self, 'job_id') and self.job_id:
            response, error = self.make_request("GET", f"/transcode/{self.job_id}/status", token=self.user1_token)
            if error or not response:
                self.log_result("Transcode Job Status", False, f"Request failed: {error}")
            elif response.status_code == 200:
                data = response.json()
                status = data.get("status")
                self.log_result("Transcode Job Status", True, f"Job status: {status}")
            else:
                self.log_result("Transcode Job Status", False, f"HTTP {response.status_code}: {response.text}")
        else:
            self.log_result("Transcode Job Status", False, "No job ID available")
            
        # Test 27: Get transcode info for media
        if hasattr(self, 'media_id') and self.media_id:
            response, error = self.make_request("GET", f"/transcode/media/{self.media_id}", token=self.user1_token)
            if error or not response:
                self.log_result("Transcode Media Info", False, f"Request failed: {error}")
            elif response.status_code == 200:
                data = response.json()
                self.log_result("Transcode Media Info", True, f"Media transcode info retrieved")
            else:
                self.log_result("Transcode Media Info", False, f"HTTP {response.status_code}: {response.text}")
        else:
            self.log_result("Transcode Media Info", False, "No media ID available")
            
        # Test 28: View queue and stats
        response, error = self.make_request("GET", "/transcode/queue", token=self.user1_token)
        if error or not response:
            self.log_result("Transcode Queue", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            self.log_result("Transcode Queue", True, "Queue and stats retrieved")
        else:
            self.log_result("Transcode Queue", False, f"HTTP {response.status_code}: {response.text}")
            
        # Test 29: HLS master playlist info
        if hasattr(self, 'media_id') and self.media_id:
            response, error = self.make_request("GET", f"/media/{self.media_id}/stream", token=self.user1_token)
            if error or not response:
                self.log_result("HLS Master Playlist", False, f"Request failed: {error}")
            elif response.status_code == 200:
                data = response.json()
                variants = data.get("variants", []) if isinstance(data, dict) else []
                self.log_result("HLS Master Playlist", True, f"HLS info with {len(variants)} variants")
            else:
                self.log_result("HLS Master Playlist", False, f"HTTP {response.status_code}: {response.text}")
        else:
            self.log_result("HLS Master Playlist", False, "No media ID available")
            
        # Test 30: Thumbnails for media
        if hasattr(self, 'media_id') and self.media_id:
            response, error = self.make_request("GET", f"/media/{self.media_id}/thumbnails", token=self.user1_token)
            if error or not response:
                self.log_result("Media Thumbnails", False, f"Request failed: {error}")
            elif response.status_code == 200:
                data = response.json()
                self.log_result("Media Thumbnails", True, "Thumbnails info retrieved")
            else:
                self.log_result("Media Thumbnails", False, f"HTTP {response.status_code}: {response.text}")
        else:
            self.log_result("Media Thumbnails", False, "No media ID available")

    def test_existing_features(self):
        """Test existing features to verify they still work"""
        print("\n✅ Testing existing features...")
        
        # Test 31: Home feed
        response, error = self.make_request("GET", "/feed", token=self.user1_token)
        if error or not response:
            self.log_result("Home Feed", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            items = data.get("items", []) if isinstance(data, dict) else data
            self.log_result("Home Feed", True, f"Retrieved {len(items)} items")
        else:
            self.log_result("Home Feed", False, f"HTTP {response.status_code}: {response.text}")
            
        # Test 32: Explore page
        response, error = self.make_request("GET", "/explore", token=self.user1_token)
        if error or not response:
            self.log_result("Explore Feed", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            self.log_result("Explore Feed", True, "Explore page loaded successfully")
        else:
            self.log_result("Explore Feed", False, f"HTTP {response.status_code}: {response.text}")
            
        # Test 33: Profile with stats
        response, error = self.make_request("GET", "/me", token=self.user1_token)
        if error or not response:
            self.log_result("User Profile", False, f"Request failed: {error}")
        elif response.status_code == 200:
            data = response.json()
            # Profile might be nested or direct
            user_id = data.get("id") or (data.get("user", {}).get("id"))
            self.log_result("User Profile", True, f"Profile retrieved for user {user_id}")
        else:
            self.log_result("User Profile", False, f"HTTP {response.status_code}: {response.text}")

    def run_all_tests(self):
        """Run all test suites"""
        print("🚀 Starting Tribe API Backend Testing - 4 New World-Class Features")
        print(f"Base URL: {self.base_url}")
        
        if not self.setup_auth():
            print("❌ Authentication setup failed. Cannot proceed with tests.")
            return
            
        try:
            self.test_feature1_full_text_search()
            self.test_feature2_engagement_analytics()
            self.test_feature3_follow_requests()
            self.test_feature4_video_transcoding()
            self.test_existing_features()
            
        except Exception as e:
            print(f"❌ Testing suite failed: {str(e)}")
            traceback.print_exc()
            
        # Print final summary
        self.print_summary()
        
    def print_summary(self):
        """Print test results summary"""
        print("\n" + "="*80)
        print("📊 TEST RESULTS SUMMARY")
        print("="*80)
        
        total_tests = len(self.test_results)
        passed_tests = sum(1 for result in self.test_results if result["success"])
        failed_tests = total_tests - passed_tests
        success_rate = (passed_tests / total_tests * 100) if total_tests > 0 else 0
        
        print(f"Total Tests: {total_tests}")
        print(f"Passed: {passed_tests} ✅")
        print(f"Failed: {failed_tests} ❌")
        print(f"Success Rate: {success_rate:.1f}%")
        
        if failed_tests > 0:
            print("\n❌ FAILED TESTS:")
            for result in self.test_results:
                if not result["success"]:
                    print(f"  • {result['test']}: {result['details']}")
                    
        print("\n✅ PASSED TESTS:")
        for result in self.test_results:
            if result["success"]:
                print(f"  • {result['test']}")
        
        # Feature breakdown
        print(f"\n📋 FEATURE BREAKDOWN:")
        features = {
            "Full-Text Search": [r for r in self.test_results if any(x in r['test'] for x in ['Search', 'Hashtag', 'Recent'])],
            "Analytics Dashboard": [r for r in self.test_results if 'Analytics' in r['test']],
            "Follow Requests": [r for r in self.test_results if any(x in r['test'] for x in ['Follow', 'Private', 'Request'])],
            "Video Transcoding": [r for r in self.test_results if any(x in r['test'] for x in ['Transcode', 'Media', 'HLS'])],
            "Existing Features": [r for r in self.test_results if any(x in r['test'] for x in ['Feed', 'Explore', 'Profile'])]
        }
        
        for feature_name, feature_results in features.items():
            if feature_results:
                feature_passed = sum(1 for r in feature_results if r["success"])
                feature_total = len(feature_results)
                feature_rate = (feature_passed / feature_total * 100) if feature_total > 0 else 0
                print(f"  {feature_name}: {feature_passed}/{feature_total} ({feature_rate:.1f}%)")

if __name__ == "__main__":
    tester = TribeAPITester()
    tester.run_all_tests()