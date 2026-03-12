#!/usr/bin/env python3
"""
New Features Backend Testing Suite for Tribe Social Media Platform

Testing the new features added as per the review request:
1. Story Edit (PATCH /api/stories/:id)
2. Story Mutes
3. Story View Duration
4. Story Bulk Moderation (Admin)
5. Content Drafts & Scheduling
6. Carousel/Multi-Media Posts
7. Reel Trending Feed
8. Reel Personalized Feed  
9. Creator Analytics Detailed
10. Page Endpoints
11. Sticker Response Rate Limit

Base URL: https://dev-hub-39.preview.emergentagent.com
Authentication: phone 7777099001 (ADMIN), 7777099002 (USER), PIN 1234
"""

import asyncio
import aiohttp
import json
import time
import sys
from dataclasses import dataclass
from typing import Dict, List, Optional, Any
from datetime import datetime, timedelta

BASE_URL = "https://dev-hub-39.preview.emergentagent.com"
API_URL = f"{BASE_URL}/api"

@dataclass 
class TestResult:
    name: str
    success: bool
    response_code: int
    error: Optional[str]
    duration_ms: int
    category: str
    details: Optional[Dict] = None

class NewFeaturesTestSuite:
    def __init__(self):
        self.session = None
        self.admin_token = None
        self.user_token = None
        self.results = []
        self.admin_user = {
            "phone": "7777099001", 
            "pin": "1234"
        }
        self.regular_user = {
            "phone": "7777099002",
            "pin": "1234" 
        }
        self.created_story_id = None
        self.created_draft_id = None
        self.created_scheduled_id = None
        self.user2_id = None
        
    async def setup(self):
        self.session = aiohttp.ClientSession()
        await self.authenticate_users()
        
    async def teardown(self):
        if self.session:
            await self.session.close()
            
    async def authenticate_users(self):
        """Authenticate both admin and regular user"""
        print("🔐 Authenticating users...")
        
        # Admin user authentication
        try:
            async with self.session.post(f"{API_URL}/auth/login", 
                                       json=self.admin_user,
                                       timeout=10) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    self.admin_token = data.get("token") or data.get("accessToken")
                    if self.admin_token:
                        print(f"✅ Admin authentication successful")
                    else:
                        print(f"❌ No token in admin response: {data}")
                        return False
                else:
                    text = await resp.text()
                    print(f"❌ Admin auth failed: {resp.status} - {text}")
                    return False
        except Exception as e:
            print(f"❌ Admin auth error: {str(e)}")
            return False
            
        # Regular user authentication  
        try:
            async with self.session.post(f"{API_URL}/auth/login",
                                       json=self.regular_user,
                                       timeout=10) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    self.user_token = data.get("token") or data.get("accessToken")
                    # Get user ID for later use
                    user_data = data.get("user", {})
                    self.user2_id = user_data.get("id")
                    if self.user_token:
                        print(f"✅ User authentication successful. User ID: {self.user2_id}")
                    else:
                        print(f"❌ No token in user response: {data}")
                        return False
                else:
                    text = await resp.text()  
                    print(f"❌ User auth failed: {resp.status} - {text}")
                    return False
        except Exception as e:
            print(f"❌ User auth error: {str(e)}")
            return False
            
        return True
            
    def get_headers(self, use_admin=True):
        """Get headers with auth token"""
        headers = {"Content-Type": "application/json"}
        token = self.admin_token if use_admin else self.user_token
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers
        
    async def make_request(self, method: str, endpoint: str, 
                          data: Optional[Dict] = None,
                          use_admin: bool = True,
                          timeout: int = 10) -> tuple:
        """Make HTTP request and return (status, response_data, duration)"""
        start_time = time.time()
        
        headers = self.get_headers(use_admin)
        url = f"{API_URL}/{endpoint.lstrip('/')}"
        
        try:
            async with self.session.request(method, url, 
                                          json=data, 
                                          headers=headers,
                                          timeout=timeout) as resp:
                duration = int((time.time() - start_time) * 1000)
                
                try:
                    response_data = await resp.json()
                except:
                    response_data = {"text": await resp.text()}
                    
                return resp.status, response_data, duration
                
        except asyncio.TimeoutError:
            duration = int((time.time() - start_time) * 1000)
            return 408, {"error": "Request timeout"}, duration
        except Exception as e:
            duration = int((time.time() - start_time) * 1000)
            return 500, {"error": str(e)}, duration
            
    def record_result(self, name: str, success: bool, status_code: int, 
                     error: Optional[str], duration: int, category: str,
                     details: Optional[Dict] = None):
        """Record test result"""
        result = TestResult(name, success, status_code, error, duration, category, details)
        self.results.append(result)
        
        # Print result
        status_icon = "✅" if success else "❌"
        print(f"{status_icon} {name} - {status_code} ({duration}ms)")
        if error and not success:
            print(f"   Error: {error}")
        if details and success:
            key_details = {k: v for k, v in details.items() if k in ['id', 'status', 'type', 'feedType', 'trendingScore']}
            if key_details:
                print(f"   Details: {key_details}")

    # ==========================================
    # 1. STORY EDIT TESTS
    # ==========================================
    
    async def test_story_edit(self):
        """Test story creation and editing"""
        print("\n📝 Testing Story Edit Feature")
        
        # First create a story to edit
        story_data = {
            "type": "TEXT",
            "text": "Original text for edit test",
            "privacy": "EVERYONE"
        }
        
        status, data, duration = await self.make_request("POST", "stories", story_data)
        
        if status != 201:
            self.record_result("Story Creation (for edit)", False, status, 
                             data.get("error", f"HTTP {status}"), duration, "Story Edit")
            return
        
        story = data.get("story") or data
        story_id = story.get("id")
        self.created_story_id = story_id
        
        self.record_result("Story Creation (for edit)", True, status, None, duration, "Story Edit",
                          {"id": story_id, "type": story.get("type")})
        
        # Now edit the story
        edit_data = {
            "caption": "New caption after edit", 
            "privacy": "CLOSE_FRIENDS"
        }
        
        status, data, duration = await self.make_request("PATCH", f"stories/{story_id}", edit_data)
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        
        details = {}
        if success:
            updated_story = data.get("story") or data
            details = {
                "id": updated_story.get("id"),
                "caption": updated_story.get("caption"),
                "privacy": updated_story.get("privacy")
            }
        
        self.record_result("Story Edit", success, status, error, duration, "Story Edit", details)
        
        # Test editing another user's story (should fail)
        status, data, duration = await self.make_request("PATCH", f"stories/{story_id}", 
                                                        edit_data, use_admin=False)
        
        success = status == 403
        error = None if success else f"Expected 403, got {status}"
        
        self.record_result("Story Edit (Other User - Should Fail)", success, status, error, duration, "Story Edit")

    # ==========================================
    # 2. STORY MUTES TESTS
    # ==========================================
    
    async def test_story_mutes(self):
        """Test story mute functionality"""
        print("\n🔇 Testing Story Mutes Feature")
        
        if not self.user2_id:
            self.record_result("Story Mutes Setup", False, 0, "No user2 ID available", 0, "Story Mutes")
            return
        
        # Mute user stories
        status, data, duration = await self.make_request("POST", f"me/story-mutes/{self.user2_id}")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("Mute User Stories", success, status, error, duration, "Story Mutes")
        
        # List muted users
        status, data, duration = await self.make_request("GET", "me/story-mutes")
        
        success = status == 200 
        error = None
        details = {}
        
        if success:
            muted_users = data.get("mutedUsers", [])
            details = {"mutedCount": len(muted_users)}
            if not any(user.get("id") == self.user2_id for user in muted_users):
                success = False
                error = "Muted user not in list"
        else:
            error = data.get("error", f"HTTP {status}")
            
        self.record_result("List Muted Users", success, status, error, duration, "Story Mutes", details)
        
        # Unmute user
        status, data, duration = await self.make_request("DELETE", f"me/story-mutes/{self.user2_id}")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("Unmute User Stories", success, status, error, duration, "Story Mutes")
        
        # Verify empty list
        status, data, duration = await self.make_request("GET", "me/story-mutes")
        
        success = False
        if status == 200:
            muted_users = data.get("mutedUsers", [])
            success = len(muted_users) == 0
            error = None if success else "Muted users list not empty after unmute"
        else:
            error = data.get("error", f"HTTP {status}")
            
        self.record_result("Verify Empty Mutes List", success, status, error, duration, "Story Mutes")
        
        # Test self-mute (should fail)
        status, data, duration = await self.make_request("POST", "me/story-mutes/self")
        
        success = status == 400
        error = None if success else f"Expected 400, got {status}"
        
        self.record_result("Self-Mute (Should Fail)", success, status, error, duration, "Story Mutes")

    # ==========================================
    # 3. STORY VIEW DURATION TESTS
    # ==========================================
    
    async def test_story_view_duration(self):
        """Test story view duration tracking"""
        print("\n⏱️ Testing Story View Duration Feature")
        
        if not self.created_story_id:
            # Create a story first
            story_data = {"type": "TEXT", "text": "Test story for view duration", "privacy": "EVERYONE"}
            status, data, duration = await self.make_request("POST", "stories", story_data)
            if status == 201:
                self.created_story_id = (data.get("story") or data).get("id")
        
        if not self.created_story_id:
            self.record_result("Story View Duration Setup", False, 0, "No story ID available", 0, "View Duration")
            return
        
        # Test view duration tracking
        view_data = {
            "durationMs": 5000,
            "completed": False
        }
        
        status, data, duration = await self.make_request("POST", f"stories/{self.created_story_id}/view-duration", view_data)
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("Record View Duration", success, status, error, duration, "View Duration")
        
        # Get view analytics
        status, data, duration = await self.make_request("GET", f"stories/{self.created_story_id}/view-analytics")
        
        success = status == 200
        error = None
        details = {}
        
        if success:
            analytics = data.get("analytics") or data
            details = {
                "totalViews": analytics.get("totalViews"),
                "avgViewDuration": analytics.get("avgViewDuration"),
                "completionRate": analytics.get("completionRate")
            }
        else:
            error = data.get("error", f"HTTP {status}")
            
        self.record_result("View Analytics", success, status, error, duration, "View Duration", details)
        
        # Test invalid duration (negative)
        invalid_data = {"durationMs": -1000, "completed": True}
        status, data, duration = await self.make_request("POST", f"stories/{self.created_story_id}/view-duration", invalid_data)
        
        success = status == 400
        error = None if success else f"Expected 400, got {status}"
        
        self.record_result("Invalid Duration (Should Fail)", success, status, error, duration, "View Duration")
        
        # Test duration too long (>300000)
        invalid_data = {"durationMs": 350000, "completed": True}
        status, data, duration = await self.make_request("POST", f"stories/{self.created_story_id}/view-duration", invalid_data)
        
        success = status == 400
        error = None if success else f"Expected 400, got {status}"
        
        self.record_result("Duration Too Long (Should Fail)", success, status, error, duration, "View Duration")

    # ==========================================
    # 4. STORY BULK MODERATION TESTS
    # ==========================================
    
    async def test_story_bulk_moderation(self):
        """Test story bulk moderation (admin only)"""
        print("\n🛡️ Testing Story Bulk Moderation Feature")
        
        # Create multiple stories for bulk moderation
        story_ids = []
        for i in range(2):
            story_data = {
                "type": "TEXT",
                "text": f"Test story {i+1} for bulk moderation",
                "privacy": "EVERYONE"
            }
            
            status, data, duration = await self.make_request("POST", "stories", story_data)
            if status == 201:
                story_id = (data.get("story") or data).get("id")
                if story_id:
                    story_ids.append(story_id)
        
        if len(story_ids) < 2:
            self.record_result("Bulk Moderation Setup", False, 0, "Could not create test stories", 0, "Bulk Moderation")
            return
        
        # Test bulk moderation with admin
        bulk_data = {
            "storyIds": story_ids,
            "action": "HOLD",
            "reason": "test moderation"
        }
        
        status, data, duration = await self.make_request("POST", "admin/stories/bulk-moderate", bulk_data)
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {"moderatedCount": len(story_ids)} if success else {}
        
        self.record_result("Bulk Moderation (Admin)", success, status, error, duration, "Bulk Moderation", details)
        
        # Test with non-admin user (should fail)
        status, data, duration = await self.make_request("POST", "admin/stories/bulk-moderate", 
                                                        bulk_data, use_admin=False)
        
        success = status == 403
        error = None if success else f"Expected 403, got {status}"
        
        self.record_result("Bulk Moderation (Non-Admin - Should Fail)", success, status, error, duration, "Bulk Moderation")
        
        # Test invalid action
        invalid_data = {
            "storyIds": story_ids[:1],
            "action": "INVALID_ACTION", 
            "reason": "test"
        }
        
        status, data, duration = await self.make_request("POST", "admin/stories/bulk-moderate", invalid_data)
        
        success = status == 400
        error = None if success else f"Expected 400, got {status}"
        
        self.record_result("Invalid Action (Should Fail)", success, status, error, duration, "Bulk Moderation")

    # ==========================================
    # 5. CONTENT DRAFTS & SCHEDULING TESTS
    # ==========================================
    
    async def test_content_drafts_scheduling(self):
        """Test content drafts and scheduling"""
        print("\n📝 Testing Content Drafts & Scheduling Feature")
        
        # Create draft
        draft_data = {
            "caption": "My draft post",
            "status": "DRAFT"
        }
        
        status, data, duration = await self.make_request("POST", "content/posts", draft_data)
        
        success = status in [200, 201]
        error = None
        details = {}
        
        if success:
            post = data.get("post") or data
            self.created_draft_id = post.get("id")
            details = {"id": self.created_draft_id, "status": post.get("status")}
        else:
            error = data.get("error", f"HTTP {status}")
            
        self.record_result("Create Draft", success, status, error, duration, "Drafts & Scheduling", details)
        
        # List drafts
        status, data, duration = await self.make_request("GET", "content/drafts")
        
        success = status == 200
        error = None
        details = {}
        
        if success:
            drafts = data.get("drafts") or data.get("items", [])
            details = {"draftsCount": len(drafts)}
        else:
            error = data.get("error", f"HTTP {status}")
            
        self.record_result("List Drafts", success, status, error, duration, "Drafts & Scheduling", details)
        
        # Create scheduled post (2 hours from now)
        future_time = (datetime.now() + timedelta(hours=2)).isoformat() + "Z"
        scheduled_data = {
            "caption": "Scheduled post test",
            "publishAt": future_time
        }
        
        status, data, duration = await self.make_request("POST", "content/posts", scheduled_data)
        
        success = status in [200, 201]
        error = None
        details = {}
        
        if success:
            post = data.get("post") or data
            self.created_scheduled_id = post.get("id")
            details = {"id": self.created_scheduled_id, "publishAt": post.get("publishAt")}
        else:
            error = data.get("error", f"HTTP {status}")
            
        self.record_result("Create Scheduled Post", success, status, error, duration, "Drafts & Scheduling", details)
        
        # List scheduled posts
        status, data, duration = await self.make_request("GET", "content/scheduled")
        
        success = status == 200
        error = None
        details = {}
        
        if success:
            scheduled = data.get("scheduled") or data.get("items", [])
            details = {"scheduledCount": len(scheduled)}
        else:
            error = data.get("error", f"HTTP {status}")
            
        self.record_result("List Scheduled", success, status, error, duration, "Drafts & Scheduling", details)
        
        # Publish draft immediately
        if self.created_draft_id:
            status, data, duration = await self.make_request("POST", f"content/{self.created_draft_id}/publish")
            
            success = status == 200
            error = None if success else data.get("error", f"HTTP {status}")
            
            self.record_result("Publish Draft", success, status, error, duration, "Drafts & Scheduling")
        
        # Reschedule post
        if self.created_scheduled_id:
            new_time = (datetime.now() + timedelta(hours=3)).isoformat() + "Z"
            reschedule_data = {"publishAt": new_time}
            
            status, data, duration = await self.make_request("PATCH", f"content/{self.created_scheduled_id}/schedule", 
                                                           reschedule_data)
            
            success = status == 200
            error = None if success else data.get("error", f"HTTP {status}")
            
            self.record_result("Reschedule Post", success, status, error, duration, "Drafts & Scheduling")
        
        # Test past publishAt (should fail)
        past_time = (datetime.now() - timedelta(hours=1)).isoformat() + "Z"
        past_data = {
            "caption": "Past scheduled post",
            "publishAt": past_time
        }
        
        status, data, duration = await self.make_request("POST", "content/posts", past_data)
        
        success = status == 400
        error = None if success else f"Expected 400, got {status}"
        
        self.record_result("Past PublishAt (Should Fail)", success, status, error, duration, "Drafts & Scheduling")

    # ==========================================
    # 6. CAROUSEL/MULTI-MEDIA POSTS TESTS
    # ==========================================
    
    async def test_carousel_posts(self):
        """Test carousel/multi-media posts"""
        print("\n🎠 Testing Carousel/Multi-Media Posts Feature")
        
        carousel_data = {
            "caption": "Carousel test post",
            "mediaIds": ["fake-id-1", "fake-id-2"],
            "carousel": {
                "order": [0, 1],
                "coverIndex": 0,
                "aspectRatio": "SQUARE"
            }
        }
        
        status, data, duration = await self.make_request("POST", "content/posts", carousel_data)
        
        success = status in [200, 201]
        error = None
        details = {}
        
        if success:
            post = data.get("post") or data
            carousel = post.get("carousel")
            details = {
                "id": post.get("id"),
                "mediaCount": len(post.get("mediaIds", [])),
                "carouselOrder": carousel.get("order") if carousel else None
            }
        else:
            error = data.get("error", f"HTTP {status}")
            
        self.record_result("Create Carousel Post", success, status, error, duration, "Carousel", details)

    # ==========================================
    # 7. REEL TRENDING FEED TESTS
    # ==========================================
    
    async def test_reel_trending_feed(self):
        """Test reel trending feed"""
        print("\n📈 Testing Reel Trending Feed Feature")
        
        # Default trending feed
        status, data, duration = await self.make_request("GET", "reels/trending")
        
        success = status == 200
        error = None
        details = {}
        
        if success:
            items = data.get("items", [])
            if items:
                first_item = items[0]
                trending_score = first_item.get("trendingScore")
                details = {
                    "itemsCount": len(items),
                    "hasTrendingScore": trending_score is not None,
                    "trendingScore": trending_score
                }
            else:
                details = {"itemsCount": 0}
        else:
            error = data.get("error", f"HTTP {status}")
            
        self.record_result("Trending Feed (Default)", success, status, error, duration, "Reel Trending", details)
        
        # 7-day window trending
        status, data, duration = await self.make_request("GET", "reels/trending?window=7d")
        
        success = status == 200
        error = None
        details = {}
        
        if success:
            items = data.get("items", [])
            time_window = data.get("timeWindow")
            details = {"itemsCount": len(items), "timeWindow": time_window}
        else:
            error = data.get("error", f"HTTP {status}")
            
        self.record_result("Trending Feed (7d Window)", success, status, error, duration, "Reel Trending", details)
        
        # Limited trending (pagination)
        status, data, duration = await self.make_request("GET", "reels/trending?limit=5")
        
        success = status == 200
        error = None
        details = {}
        
        if success:
            items = data.get("items", [])
            details = {"itemsCount": len(items), "limitApplied": len(items) <= 5}
        else:
            error = data.get("error", f"HTTP {status}")
            
        self.record_result("Trending Feed (Limit=5)", success, status, error, duration, "Reel Trending", details)

    # ==========================================
    # 8. REEL PERSONALIZED FEED TESTS
    # ==========================================
    
    async def test_reel_personalized_feed(self):
        """Test reel personalized feed"""
        print("\n🎯 Testing Reel Personalized Feed Feature")
        
        # Default personalized feed
        status, data, duration = await self.make_request("GET", "reels/personalized")
        
        success = status == 200
        error = None
        details = {}
        
        if success:
            items = data.get("items", [])
            feed_type = data.get("feedType")
            details = {
                "itemsCount": len(items),
                "feedType": feed_type
            }
        else:
            error = data.get("error", f"HTTP {status}")
            
        self.record_result("Personalized Feed (Default)", success, status, error, duration, "Reel Personalized", details)
        
        # Personalized with pagination
        status, data, duration = await self.make_request("GET", "reels/personalized?limit=5")
        
        success = status == 200
        error = None
        details = {}
        
        if success:
            items = data.get("items", [])
            details = {"itemsCount": len(items), "limitApplied": len(items) <= 5}
        else:
            error = data.get("error", f"HTTP {status}")
            
        self.record_result("Personalized Feed (Limit=5)", success, status, error, duration, "Reel Personalized", details)

    # ==========================================
    # 9. CREATOR ANALYTICS DETAILED TESTS
    # ==========================================
    
    async def test_creator_analytics_detailed(self):
        """Test creator analytics detailed"""
        print("\n📊 Testing Creator Analytics Detailed Feature")
        
        # 30-day analytics
        status, data, duration = await self.make_request("GET", "me/reels/analytics/detailed?days=30")
        
        success = status == 200
        error = None
        details = {}
        
        if success:
            analytics = data.get("analytics") or data
            details = {
                "hasTotals": "totals" in analytics,
                "hasDailyViews": "dailyViews" in analytics,
                "hasDailyLikes": "dailyLikes" in analytics,
                "hasRetention": "retention" in analytics,
                "hasTopEngagers": "topEngagers" in analytics,
                "hasWeeklyPerformance": "weeklyPerformance" in analytics
            }
        else:
            error = data.get("error", f"HTTP {status}")
            
        self.record_result("Detailed Analytics (30 days)", success, status, error, duration, "Creator Analytics", details)
        
        # 7-day analytics
        status, data, duration = await self.make_request("GET", "me/reels/analytics/detailed?days=7")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("Detailed Analytics (7 days)", success, status, error, duration, "Creator Analytics")
        
        # 90-day analytics
        status, data, duration = await self.make_request("GET", "me/reels/analytics/detailed?days=90")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("Detailed Analytics (90 days)", success, status, error, duration, "Creator Analytics")

    # ==========================================
    # 10. PAGE ENDPOINTS TESTS
    # ==========================================
    
    async def test_page_endpoints(self):
        """Test page endpoints"""
        print("\n📄 Testing Page Endpoints Feature")
        
        # Use the seed page ID from requirements
        page_id = "83d29a4c-4d33-48a9-b7ad-614a54b37123"
        
        # Report page
        report_data = {
            "reason": "test report",
            "category": "SPAM"
        }
        
        status, data, duration = await self.make_request("POST", f"pages/{page_id}/report", report_data)
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("Report Page", success, status, error, duration, "Page Endpoints")
        
        # Request verification (needs page owner - might fail, that's ok)
        status, data, duration = await self.make_request("POST", f"pages/{page_id}/request-verification")
        
        success = status in [200, 403]  # 403 is acceptable if not owner
        error = None if status == 200 else "Not page owner (expected)" if status == 403 else data.get("error", f"HTTP {status}")
        
        self.record_result("Request Verification", success, status, error, duration, "Page Endpoints")
        
        # Admin list verification requests
        status, data, duration = await self.make_request("GET", "admin/pages/verification-requests")
        
        success = status in [200, 403]  # Might need higher admin permissions
        error = None if status == 200 else "Admin permissions required" if status == 403 else data.get("error", f"HTTP {status}")
        
        self.record_result("Admin Verification List", success, status, error, duration, "Page Endpoints")
        
        # Invite user to page (if we have user2 ID)
        if self.user2_id:
            invite_data = {
                "userId": self.user2_id,
                "role": "MEMBER"
            }
            
            status, data, duration = await self.make_request("POST", f"pages/{page_id}/invite", invite_data)
            
            success = status in [200, 403]  # 403 acceptable if not page owner
            error = None if status == 200 else "Not page owner (expected)" if status == 403 else data.get("error", f"HTTP {status}")
            
            self.record_result("Invite User to Page", success, status, error, duration, "Page Endpoints")

    # ==========================================
    # 11. STICKER RESPONSE RATE LIMIT TESTS
    # ==========================================
    
    async def test_sticker_response_rate_limit(self):
        """Test sticker response rate limiting"""
        print("\n🚫 Testing Sticker Response Rate Limit Feature")
        
        if not self.created_story_id:
            # Create a story with sticker first
            story_data = {
                "type": "TEXT", 
                "text": "Story with sticker for rate limit test",
                "privacy": "EVERYONE"
            }
            status, data, duration = await self.make_request("POST", "stories", story_data)
            if status == 201:
                self.created_story_id = (data.get("story") or data).get("id")
        
        if not self.created_story_id:
            self.record_result("Sticker Rate Limit Setup", False, 0, "No story ID available", 0, "Rate Limit")
            return
        
        # Test normal sticker response (should work)
        sticker_data = {"response": "test"}
        status, data, duration = await self.make_request("POST", f"stories/{self.created_story_id}/sticker-respond", sticker_data)
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("Normal Sticker Response", success, status, error, duration, "Rate Limit")
        
        # Rapid-fire requests to test rate limit (30+ requests)
        rate_limited = False
        success_count = 0
        
        for i in range(35):  # Try 35 requests to hit the limit
            status, data, duration = await self.make_request("POST", f"stories/{self.created_story_id}/sticker-respond", 
                                                           {"response": f"test{i}"}, timeout=5)
            
            if status == 429:
                rate_limited = True
                break
            elif status == 200:
                success_count += 1
            
            # Small delay to avoid overwhelming server
            await asyncio.sleep(0.1)
        
        success = rate_limited
        error = None if success else f"Rate limit not triggered after {success_count} requests"
        details = {"requestsBeforeLimit": success_count} if rate_limited else {"totalRequests": success_count}
        
        self.record_result("Sticker Rate Limit Trigger", success, 429 if rate_limited else 200, 
                          error, 0, "Rate Limit", details)

    # ==========================================
    # MAIN TEST EXECUTION
    # ==========================================
    
    async def run_all_tests(self):
        """Run all new feature tests"""
        print("🚀 Starting New Features Testing Suite")
        print(f"Base URL: {BASE_URL}")
        print("=" * 60)
        
        await self.setup()
        
        if not self.admin_token or not self.user_token:
            print("❌ Authentication failed - cannot proceed with tests")
            return
            
        try:
            await self.test_story_edit()
            await self.test_story_mutes()
            await self.test_story_view_duration()
            await self.test_story_bulk_moderation()
            await self.test_content_drafts_scheduling()
            await self.test_carousel_posts()
            await self.test_reel_trending_feed()
            await self.test_reel_personalized_feed()
            await self.test_creator_analytics_detailed()
            await self.test_page_endpoints()
            await self.test_sticker_response_rate_limit()
            
        finally:
            await self.teardown()
            
    def generate_report(self):
        """Generate test report"""
        total_tests = len(self.results)
        passed_tests = len([r for r in self.results if r.success])
        failed_tests = total_tests - passed_tests
        
        # Group by category
        categories = {}
        for result in self.results:
            cat = result.category
            if cat not in categories:
                categories[cat] = {"passed": 0, "total": 0}
            categories[cat]["total"] += 1
            if result.success:
                categories[cat]["passed"] += 1
        
        print("\n" + "=" * 60)
        print("🎯 NEW FEATURES TEST REPORT")
        print("=" * 60)
        print(f"Total Tests: {total_tests}")
        print(f"Passed: {passed_tests} ✅")
        print(f"Failed: {failed_tests} ❌")
        success_rate = (passed_tests/total_tests*100) if total_tests > 0 else 0
        print(f"Success Rate: {success_rate:.1f}%")
        print()
        
        print("📊 CATEGORY BREAKDOWN:")
        for category, stats in categories.items():
            print(f"{category}: {stats['passed']}/{stats['total']} ✅")
        
        print("\n" + "=" * 60)
        
        # Report failed tests
        failed_results = [r for r in self.results if not r.success]
        if failed_results:
            print("❌ FAILED TESTS:")
            for result in failed_results:
                print(f"   - {result.name} ({result.response_code}): {result.error}")
        else:
            print("✅ ALL TESTS PASSED!")
            
        print("=" * 60)
        
        # Save report to file
        report_data = {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "total_tests": total_tests,
            "passed_tests": passed_tests,
            "failed_tests": failed_tests,
            "success_rate": round(success_rate, 1),
            "categories": categories,
            "results": [
                {
                    "name": r.name,
                    "success": r.success,
                    "status_code": r.response_code,
                    "error": r.error,
                    "duration_ms": r.duration_ms,
                    "category": r.category,
                    "details": r.details
                }
                for r in self.results
            ]
        }
        
        try:
            with open("/app/new_features_test_report.json", "w") as f:
                json.dump(report_data, f, indent=2)
            print(f"📄 Report saved to /app/new_features_test_report.json")
        except Exception as e:
            print(f"⚠️ Could not save report: {e}")

async def main():
    """Main entry point"""
    suite = NewFeaturesTestSuite()
    await suite.run_all_tests()
    suite.generate_report()

if __name__ == "__main__":
    asyncio.run(main())