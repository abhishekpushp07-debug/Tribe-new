#!/usr/bin/env python3
"""
Critical Endpoints Testing Suite for Tribe Social Media API
Focused on recently fixed bugs in feed endpoints, stories, reels, posts, and media upload

Test Users:
- User 1: phone="7777099001", pin="1234"  
- User 2: phone="7777099002", pin="1234"

Critical Endpoints to Test (recently fixed):
1. Feed endpoints - GET /api/feed, /api/feed/public, /api/feed/following, /api/feed/stories, /api/feed/reels
2. Story CRUD - POST /api/stories, GET /api/stories, GET /api/stories/:id
3. Reel CRUD - POST /api/reels, GET /api/reels/feed, GET /api/reels/:id  
4. Post CRUD - POST /api/content/posts, GET /api/content/:id, PATCH /api/content/:id
5. Media Upload - POST /api/media/upload-init, POST /api/media/upload
6. Social - POST /api/follow
"""

import asyncio
import aiohttp
import json
import time
import base64
from dataclasses import dataclass
from typing import Dict, List, Optional, Any

BASE_URL = "https://media-platform-api.preview.emergentagent.com"
API_URL = f"{BASE_URL}/api"

@dataclass
class TestResult:
    name: str
    success: bool
    response_code: int
    error: Optional[str]
    duration_ms: int
    details: Optional[Dict] = None

class TribeCriticalTestSuite:
    def __init__(self):
        self.session = None
        self.user1_token = None
        self.user2_token = None
        self.results = []
        
        # Test users as specified
        self.user1 = {"phone": "7777099001", "pin": "1234"}
        self.user2 = {"phone": "7777099002", "pin": "1234"}
        
        # Test data storage
        self.test_data = {
            "user1_id": None,
            "user2_id": None,
            "story_id": None,
            "reel_id": None,
            "post_id": None,
            "media_id": None
        }
        
    async def setup(self):
        """Setup test session and authenticate both users"""
        self.session = aiohttp.ClientSession()
        
        # Authenticate user 1
        await self.authenticate_user(self.user1, "user1")
        
        # Wait 5+ seconds between logins (rate limit protection)
        print("⏱️ Waiting 5 seconds between logins (rate limit protection)...")
        await asyncio.sleep(5)
        
        # Authenticate user 2
        await self.authenticate_user(self.user2, "user2")
        
    async def teardown(self):
        if self.session:
            await self.session.close()
            
    async def authenticate_user(self, user_creds: Dict, user_label: str):
        """Authenticate a specific user"""
        try:
            start_time = time.time()
            async with self.session.post(f"{API_URL}/auth/login", 
                                       json=user_creds,
                                       timeout=15) as resp:
                duration = int((time.time() - start_time) * 1000)
                
                if resp.status == 200:
                    data = await resp.json()
                    token = data.get("token") or data.get("accessToken") or data.get("data", {}).get("accessToken")
                    user_id = data.get("user", {}).get("id") or data.get("data", {}).get("user", {}).get("id")
                    
                    if token:
                        if user_label == "user1":
                            self.user1_token = token
                            self.test_data["user1_id"] = user_id
                        else:
                            self.user2_token = token
                            self.test_data["user2_id"] = user_id
                            
                        print(f"✅ {user_label} authentication successful in {duration}ms")
                        return True
                    else:
                        print(f"❌ No access token for {user_label}: {data}")
                        return False
                else:
                    text = await resp.text()
                    print(f"❌ {user_label} auth failed: {resp.status} - {text}")
                    return False
                    
        except Exception as e:
            print(f"❌ {user_label} auth error: {str(e)}")
            return False
            
    def get_headers(self, user: str = "user1"):
        """Get headers with auth token for specified user"""
        headers = {"Content-Type": "application/json"}
        token = self.user1_token if user == "user1" else self.user2_token
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers
        
    async def make_request(self, method: str, endpoint: str, 
                          data: Optional[Dict] = None,
                          headers: Optional[Dict] = None,
                          timeout: int = 15,
                          user: str = "user1") -> tuple:
        """Make API request with proper error handling"""
        if headers is None:
            headers = self.get_headers(user)
            
        try:
            start_time = time.time()
            url = f"{API_URL}{endpoint}"
            
            async with self.session.request(method, url, json=data, headers=headers, timeout=timeout) as resp:
                duration = int((time.time() - start_time) * 1000)
                
                try:
                    response_data = await resp.json()
                except:
                    response_data = await resp.text()
                    
                return resp.status, response_data, duration
                
        except Exception as e:
            duration = int((time.time() - start_time) * 1000) if 'start_time' in locals() else 0
            return 500, {"error": str(e)}, duration

    def add_result(self, name: str, success: bool, status: int, error: str = None, duration: int = 0, details: Dict = None):
        """Add test result"""
        result = TestResult(name, success, status, error, duration, details)
        self.results.append(result)
        
        status_icon = "✅" if success else "❌"
        print(f"{status_icon} {name}: {status} ({duration}ms)")
        if error and not success:
            print(f"   Error: {error}")
        if details:
            print(f"   Details: {json.dumps(details, indent=2)}")
            
    # CRITICAL TEST 1: FEED ENDPOINTS (recently fixed - was returning {} or 500)
    async def test_feed_endpoints(self):
        """Test all feed endpoints that were recently fixed"""
        print("\n🔥 CRITICAL TEST 1: FEED ENDPOINTS (Recently Fixed)")
        
        # Test 1.1: Home feed (anonymous)
        try:
            status, data, duration = await self.make_request("GET", "/feed", headers={"Content-Type": "application/json"})
            success = status == 200 and isinstance(data, dict) and "items" in data
            
            if success:
                items_count = len(data.get("items", []))
                has_pagination = "nextCursor" in data or "hasMore" in data
                self.add_result("Feed - Home (anonymous)", True, status, duration=duration, 
                              details={"items_count": items_count, "has_pagination": has_pagination})
            else:
                self.add_result("Feed - Home (anonymous)", False, status, 
                              error=f"Expected items array, got: {type(data)}", duration=duration)
        except Exception as e:
            self.add_result("Feed - Home (anonymous)", False, 500, error=str(e))
        
        # Test 1.2: Home feed (authenticated)  
        try:
            status, data, duration = await self.make_request("GET", "/feed", user="user1")
            success = status == 200 and isinstance(data, dict) and "items" in data
            
            if success:
                items_count = len(data.get("items", []))
                has_pagination = "nextCursor" in data or "hasMore" in data
                self.add_result("Feed - Home (authenticated)", True, status, duration=duration,
                              details={"items_count": items_count, "has_pagination": has_pagination})
            else:
                self.add_result("Feed - Home (authenticated)", False, status,
                              error=f"Expected items array, got: {type(data)}", duration=duration)
        except Exception as e:
            self.add_result("Feed - Home (authenticated)", False, 500, error=str(e))
            
        # Test 1.3: Public feed
        try:
            status, data, duration = await self.make_request("GET", "/feed/public")
            success = status == 200 and isinstance(data, dict) and "items" in data
            
            if success:
                items_count = len(data.get("items", []))
                has_pagination = "nextCursor" in data or "hasMore" in data
                self.add_result("Feed - Public", True, status, duration=duration,
                              details={"items_count": items_count, "has_pagination": has_pagination})
            else:
                self.add_result("Feed - Public", False, status,
                              error=f"Expected items array, got: {type(data)}", duration=duration)
        except Exception as e:
            self.add_result("Feed - Public", False, 500, error=str(e))
            
        # Test 1.4: Following feed (auth required)
        try:
            status, data, duration = await self.make_request("GET", "/feed/following", user="user1")
            success = status == 200 and isinstance(data, dict) and "items" in data
            
            if success:
                items_count = len(data.get("items", []))
                has_pagination = "nextCursor" in data or "hasMore" in data
                self.add_result("Feed - Following", True, status, duration=duration,
                              details={"items_count": items_count, "has_pagination": has_pagination})
            else:
                self.add_result("Feed - Following", False, status,
                              error=f"Expected items array, got: {type(data)}", duration=duration)
        except Exception as e:
            self.add_result("Feed - Following", False, 500, error=str(e))
            
        # Test 1.5: Story rail (auth required) - was returning wrong collection
        try:
            status, data, duration = await self.make_request("GET", "/feed/stories", user="user1")
            success = status == 200 and isinstance(data, dict) and ("items" in data or "stories" in data)
            
            if success:
                items = data.get("items", data.get("stories", []))
                items_count = len(items) if isinstance(items, list) else 0
                has_pagination = "nextCursor" in data or "hasMore" in data
                self.add_result("Feed - Stories", True, status, duration=duration,
                              details={"items_count": items_count, "has_pagination": has_pagination})
            else:
                self.add_result("Feed - Stories", False, status,
                              error=f"Expected items/stories array, got: {type(data)}", duration=duration)
        except Exception as e:
            self.add_result("Feed - Stories", False, 500, error=str(e))
            
        # Test 1.6: Reels feed - was returning wrong collection
        try:
            status, data, duration = await self.make_request("GET", "/feed/reels", user="user1")
            success = status == 200 and isinstance(data, dict) and "items" in data
            
            if success:
                items_count = len(data.get("items", []))
                has_pagination = "nextCursor" in data or "hasMore" in data
                self.add_result("Feed - Reels", True, status, duration=duration,
                              details={"items_count": items_count, "has_pagination": has_pagination})
            else:
                self.add_result("Feed - Reels", False, status,
                              error=f"Expected items array, got: {type(data)}", duration=duration)
        except Exception as e:
            self.add_result("Feed - Reels", False, 500, error=str(e))

    # CRITICAL TEST 2: STORY CRUD
    async def test_story_crud(self):
        """Test story CRUD operations"""
        print("\n🔥 CRITICAL TEST 2: STORY CRUD")
        
        # Test 2.1: Create story
        story_data = {
            "type": "TEXT",
            "text": "Test story content for validation", 
            "privacy": "EVERYONE"
        }
        
        try:
            status, data, duration = await self.make_request("POST", "/stories", data=story_data, user="user1")
            success = status == 201 and isinstance(data, dict) and "id" in data
            
            if success:
                self.test_data["story_id"] = data.get("id") or data.get("story", {}).get("id")
                self.add_result("Story - Create", True, status, duration=duration,
                              details={"story_id": self.test_data["story_id"]})
            else:
                self.add_result("Story - Create", False, status, 
                              error=f"Expected story with id, got: {data}", duration=duration)
        except Exception as e:
            self.add_result("Story - Create", False, 500, error=str(e))
            
        # Test 2.2: List user stories
        try:
            status, data, duration = await self.make_request("GET", "/stories", user="user1")
            success = status == 200 and isinstance(data, dict) and ("items" in data or "stories" in data)
            
            if success:
                items = data.get("items", data.get("stories", []))
                items_count = len(items) if isinstance(items, list) else 0
                self.add_result("Story - List User Stories", True, status, duration=duration,
                              details={"stories_count": items_count})
            else:
                self.add_result("Story - List User Stories", False, status,
                              error=f"Expected stories array, got: {data}", duration=duration)
        except Exception as e:
            self.add_result("Story - List User Stories", False, 500, error=str(e))
            
        # Test 2.3: Get single story (if we have a story ID)
        if self.test_data["story_id"]:
            try:
                endpoint = f"/stories/{self.test_data['story_id']}"
                status, data, duration = await self.make_request("GET", endpoint, user="user1")
                success = status == 200 and isinstance(data, dict) and "id" in data
                
                if success:
                    self.add_result("Story - Get Single", True, status, duration=duration,
                                  details={"story_id": data.get("id")})
                else:
                    self.add_result("Story - Get Single", False, status,
                                  error=f"Expected story object, got: {data}", duration=duration)
            except Exception as e:
                self.add_result("Story - Get Single", False, 500, error=str(e))

    # CRITICAL TEST 3: REEL CRUD  
    async def test_reel_crud(self):
        """Test reel CRUD operations"""
        print("\n🔥 CRITICAL TEST 3: REEL CRUD")
        
        # Test 3.1: Create reel
        reel_data = {
            "caption": "Test reel for validation",
            "mediaUrl": "https://example.com/test-video.mp4",
            "durationMs": 5000,
            "visibility": "PUBLIC"
        }
        
        try:
            status, data, duration = await self.make_request("POST", "/reels", data=reel_data, user="user1")
            success = status == 201 and isinstance(data, dict) and "id" in data
            
            if success:
                self.test_data["reel_id"] = data.get("id") or data.get("reel", {}).get("id")
                self.add_result("Reel - Create", True, status, duration=duration,
                              details={"reel_id": self.test_data["reel_id"]})
            else:
                self.add_result("Reel - Create", False, status,
                              error=f"Expected reel with id, got: {data}", duration=duration)
        except Exception as e:
            self.add_result("Reel - Create", False, 500, error=str(e))
            
        # Test 3.2: Get reels discovery feed (auth required)
        try:
            status, data, duration = await self.make_request("GET", "/reels/feed", user="user1")
            success = status == 200 and isinstance(data, dict) and "items" in data
            
            if success:
                items_count = len(data.get("items", []))
                has_pagination = "nextCursor" in data or "hasMore" in data
                self.add_result("Reel - Discovery Feed", True, status, duration=duration,
                              details={"reels_count": items_count, "has_pagination": has_pagination})
            else:
                self.add_result("Reel - Discovery Feed", False, status,
                              error=f"Expected items array, got: {data}", duration=duration)
        except Exception as e:
            self.add_result("Reel - Discovery Feed", False, 500, error=str(e))
            
        # Test 3.3: Get single reel (if we have reel ID)
        if self.test_data["reel_id"]:
            try:
                endpoint = f"/reels/{self.test_data['reel_id']}"
                status, data, duration = await self.make_request("GET", endpoint, user="user1")
                success = status == 200 and isinstance(data, dict) and "id" in data
                
                if success:
                    self.add_result("Reel - Get Single", True, status, duration=duration,
                                  details={"reel_id": data.get("id")})
                else:
                    self.add_result("Reel - Get Single", False, status,
                                  error=f"Expected reel object, got: {data}", duration=duration)
            except Exception as e:
                self.add_result("Reel - Get Single", False, 500, error=str(e))

    # CRITICAL TEST 4: POST CRUD
    async def test_post_crud(self):
        """Test post CRUD operations"""
        print("\n🔥 CRITICAL TEST 4: POST CRUD")
        
        # Test 4.1: Create post
        post_data = {
            "caption": "Test post for validation testing"
        }
        
        try:
            status, data, duration = await self.make_request("POST", "/content/posts", data=post_data, user="user1")
            success = status == 201 and isinstance(data, dict) and "id" in data
            
            if success:
                self.test_data["post_id"] = data.get("id") or data.get("post", {}).get("id")
                self.add_result("Post - Create", True, status, duration=duration,
                              details={"post_id": self.test_data["post_id"]})
            else:
                self.add_result("Post - Create", False, status,
                              error=f"Expected post with id, got: {data}", duration=duration)
        except Exception as e:
            self.add_result("Post - Create", False, 500, error=str(e))
            
        # Test 4.2: Get single post (if we have post ID)
        if self.test_data["post_id"]:
            try:
                endpoint = f"/content/{self.test_data['post_id']}"
                status, data, duration = await self.make_request("GET", endpoint, user="user1")
                success = status == 200 and isinstance(data, dict) and "id" in data
                
                if success:
                    self.add_result("Post - Get Single", True, status, duration=duration,
                                  details={"post_id": data.get("id")})
                else:
                    self.add_result("Post - Get Single", False, status,
                                  error=f"Expected post object, got: {data}", duration=duration)
            except Exception as e:
                self.add_result("Post - Get Single", False, 500, error=str(e))
                
            # Test 4.3: Edit post caption 
            try:
                edit_data = {"caption": "Updated test post caption"}
                endpoint = f"/content/{self.test_data['post_id']}"
                status, data, duration = await self.make_request("PATCH", endpoint, data=edit_data, user="user1")
                success = status == 200 and isinstance(data, dict) and "id" in data
                
                if success:
                    updated_caption = data.get("caption", "")
                    self.add_result("Post - Edit Caption", True, status, duration=duration,
                                  details={"updated_caption": updated_caption})
                else:
                    self.add_result("Post - Edit Caption", False, status,
                                  error=f"Expected updated post, got: {data}", duration=duration)
            except Exception as e:
                self.add_result("Post - Edit Caption", False, 500, error=str(e))

    # CRITICAL TEST 5: MEDIA UPLOAD FLOW  
    async def test_media_upload(self):
        """Test media upload workflows"""
        print("\n🔥 CRITICAL TEST 5: MEDIA UPLOAD FLOW")
        
        # Test 5.1: Init upload
        init_data = {
            "kind": "image",
            "mimeType": "image/jpeg", 
            "sizeBytes": 50000
        }
        
        try:
            status, data, duration = await self.make_request("POST", "/media/upload-init", data=init_data, user="user1")
            success = status == 200 and isinstance(data, dict)
            
            if success:
                self.add_result("Media - Upload Init", True, status, duration=duration,
                              details={"response_keys": list(data.keys())})
            else:
                self.add_result("Media - Upload Init", False, status,
                              error=f"Expected init response, got: {data}", duration=duration)
        except Exception as e:
            self.add_result("Media - Upload Init", False, 500, error=str(e))
            
        # Test 5.2: Legacy base64 upload
        # Create small test image as base64
        test_image_data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
        
        upload_data = {
            "data": test_image_data,
            "mimeType": "image/jpeg",
            "type": "IMAGE"
        }
        
        try:
            status, data, duration = await self.make_request("POST", "/media/upload", data=upload_data, user="user1")
            success = status == 201 and isinstance(data, dict) and "id" in data
            
            if success:
                self.test_data["media_id"] = data.get("id") or data.get("media", {}).get("id")
                self.add_result("Media - Legacy Upload", True, status, duration=duration,
                              details={"media_id": self.test_data["media_id"]})
            else:
                self.add_result("Media - Legacy Upload", False, status,
                              error=f"Expected media with id, got: {data}", duration=duration)
        except Exception as e:
            self.add_result("Media - Legacy Upload", False, 500, error=str(e))

    # CRITICAL TEST 6: SOCIAL FEATURES
    async def test_social_features(self):
        """Test social interaction features"""
        print("\n🔥 CRITICAL TEST 6: SOCIAL FEATURES")
        
        # Test 6.1: Follow user (user1 follows user2)
        if self.test_data["user2_id"]:
            try:
                follow_data = {"userId": self.test_data["user2_id"]}
                status, data, duration = await self.make_request("POST", "/follow", data=follow_data, user="user1")
                success = status == 200 or status == 201
                
                if success:
                    self.add_result("Social - Follow User", True, status, duration=duration,
                                  details={"followed_user": self.test_data["user2_id"]})
                else:
                    self.add_result("Social - Follow User", False, status,
                                  error=f"Follow failed, got: {data}", duration=duration)
            except Exception as e:
                self.add_result("Social - Follow User", False, 500, error=str(e))
        else:
            self.add_result("Social - Follow User", False, 400, error="No user2_id available")

    # RUN ALL TESTS
    async def run_all_tests(self):
        """Run all critical endpoint tests"""
        print("🚀 Starting Tribe Critical Endpoints Test Suite")
        print(f"🎯 Base URL: {BASE_URL}")
        print(f"🔑 Test Users: {self.user1['phone']} and {self.user2['phone']}")
        
        try:
            await self.setup()
            
            # Run critical tests in sequence
            await self.test_feed_endpoints()
            await self.test_story_crud()
            await self.test_reel_crud() 
            await self.test_post_crud()
            await self.test_media_upload()
            await self.test_social_features()
            
        finally:
            await self.teardown()
            
        # Print summary
        self.print_summary()
        
    def print_summary(self):
        """Print test results summary"""
        total = len(self.results)
        passed = sum(1 for r in self.results if r.success)
        failed = total - passed
        success_rate = (passed / total * 100) if total > 0 else 0
        
        print(f"\n📊 TRIBE CRITICAL ENDPOINTS TEST SUMMARY")
        print(f"=" * 60)
        print(f"Total Tests: {total}")
        print(f"✅ Passed: {passed}")
        print(f"❌ Failed: {failed}")
        print(f"🎯 Success Rate: {success_rate:.1f}%")
        print(f"=" * 60)
        
        # Group results by category
        categories = {}
        for result in self.results:
            category = result.name.split(" - ")[0]
            if category not in categories:
                categories[category] = {"passed": 0, "failed": 0, "results": []}
            
            categories[category]["results"].append(result)
            if result.success:
                categories[category]["passed"] += 1
            else:
                categories[category]["failed"] += 1
                
        # Print category breakdown
        for category, stats in categories.items():
            total_cat = stats["passed"] + stats["failed"]
            success_rate_cat = (stats["passed"] / total_cat * 100) if total_cat > 0 else 0
            print(f"\n{category}: {stats['passed']}/{total_cat} ({success_rate_cat:.1f}%)")
            
            for result in stats["results"]:
                status_icon = "✅" if result.success else "❌"
                print(f"  {status_icon} {result.name}")
                if not result.success and result.error:
                    print(f"      Error: {result.error}")
                    
        # Critical issues summary
        critical_failures = [r for r in self.results if not r.success and "Feed" in r.name]
        if critical_failures:
            print(f"\n🚨 CRITICAL FEED ISSUES:")
            for failure in critical_failures:
                print(f"  ❌ {failure.name}: {failure.error}")
        else:
            print(f"\n🎉 ALL FEED ENDPOINTS WORKING PROPERLY!")

# Main execution
async def main():
    test_suite = TribeCriticalTestSuite()
    await test_suite.run_all_tests()

if __name__ == "__main__":
    asyncio.run(main())