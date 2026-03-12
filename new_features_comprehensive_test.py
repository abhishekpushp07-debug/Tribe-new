#!/usr/bin/env python3
"""
Comprehensive Testing Suite for 50 New Features
Tribe Social Media API Testing

Testing all 50 new features across 8 groups:
1. Profile & User Settings (12 endpoints)
2. Content Interactions (12 endpoints) 
3. Comment Operations (5 endpoints)
4. Stories (4 endpoints)
5. Reels (4 endpoints)
6. Tribes (8 endpoints)  
7. Feed & Discovery (7 endpoints)
8. Notifications (2 endpoints)

Base URL: https://tribe-feed-debug.preview.emergentagent.com
"""

import asyncio
import aiohttp
import json
import time
import sys
from dataclasses import dataclass
from typing import Dict, List, Optional, Any

BASE_URL = "https://tribe-feed-debug.preview.emergentagent.com"
API_URL = f"{BASE_URL}/api"

@dataclass
class TestResult:
    name: str
    success: bool
    response_code: int
    error: Optional[str]
    duration_ms: int
    group: str
    details: Optional[Dict] = None

class TribeNewFeaturesTestSuite:
    def __init__(self):
        self.session = None
        self.user1_token = None
        self.user2_token = None
        self.results = []
        
        # Test users as specified in requirements
        self.user1 = {"phone": "7777099001", "pin": "1234"}
        self.user2 = {"phone": "7777099002", "pin": "1234"}
        
        # Store created content IDs for tests
        self.created_post_id = None
        self.created_comment_id = None
        self.created_story_id = None
        self.tribe_id = None
        self.user2_id = None
        
    async def setup(self):
        """Setup test session and authenticate both users"""
        self.session = aiohttp.ClientSession()
        
        # Authenticate user 1
        await self.authenticate_user1()
        await asyncio.sleep(6)  # 5+ second delay as specified
        
        # Authenticate user 2
        await self.authenticate_user2()
        
    async def teardown(self):
        if self.session:
            await self.session.close()
            
    async def authenticate_user1(self):
        """Authenticate user 1"""
        try:
            start_time = time.time()
            async with self.session.post(f"{API_URL}/auth/login", 
                                       json=self.user1,
                                       timeout=15) as resp:
                duration = int((time.time() - start_time) * 1000)
                
                if resp.status == 200:
                    data = await resp.json()
                    # Try different token field names
                    self.user1_token = (data.get("token") or 
                                      data.get("accessToken") or 
                                      data.get("data", {}).get("token") or
                                      data.get("data", {}).get("accessToken"))
                    if self.user1_token:
                        print(f"✅ User 1 authenticated in {duration}ms")
                        return True
                    else:
                        print(f"❌ No token in user 1 response: {data}")
                        return False
                else:
                    text = await resp.text()
                    print(f"❌ User 1 auth failed: {resp.status} - {text}")
                    return False
        except Exception as e:
            print(f"❌ User 1 auth error: {str(e)}")
            return False
            
    async def authenticate_user2(self):
        """Authenticate user 2"""
        try:
            start_time = time.time()
            async with self.session.post(f"{API_URL}/auth/login", 
                                       json=self.user2,
                                       timeout=15) as resp:
                duration = int((time.time() - start_time) * 1000)
                
                if resp.status == 200:
                    data = await resp.json()
                    # Try different token field names
                    self.user2_token = (data.get("token") or 
                                      data.get("accessToken") or 
                                      data.get("data", {}).get("token") or
                                      data.get("data", {}).get("accessToken"))
                    
                    # Get user2 ID for mutual followers test
                    user_data = data.get("user") or data.get("data", {}).get("user")
                    if user_data:
                        self.user2_id = user_data.get("id")
                        
                    if self.user2_token:
                        print(f"✅ User 2 authenticated in {duration}ms")
                        return True
                    else:
                        print(f"❌ No token in user 2 response: {data}")
                        return False
                else:
                    text = await resp.text()
                    print(f"❌ User 2 auth failed: {resp.status} - {text}")
                    return False
        except Exception as e:
            print(f"❌ User 2 auth error: {str(e)}")
            return False

    def get_headers(self, user_num: int = 1):
        """Get headers with auth token for specified user"""
        headers = {"Content-Type": "application/json"}
        token = self.user1_token if user_num == 1 else self.user2_token
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    async def make_request(self, method: str, endpoint: str, 
                          data: Optional[Dict] = None,
                          user_num: int = 1,
                          timeout: int = 15) -> tuple:
        """Make HTTP request and return (status, response_data, duration)"""
        start_time = time.time()
        
        headers = self.get_headers(user_num)
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
                     error: Optional[str], duration: int, group: str,
                     details: Optional[Dict] = None):
        """Record test result"""
        result = TestResult(name, success, status_code, error, duration, group, details)
        self.results.append(result)
        
        # Print result
        status_icon = "✅" if success else "❌"
        print(f"{status_icon} {name} - {status_code} ({duration}ms)")
        if error and not success:
            print(f"   Error: {error}")

    # ==========================================
    # GROUP 1: Profile & User Settings (12 endpoints)
    # ==========================================
    
    async def test_get_me(self):
        """GET /api/me — own profile with stats"""
        status, data, duration = await self.make_request("GET", "me")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            # Check for profile data and stats
            user_data = data.get("user") or data
            if user_data:
                details = {
                    "hasStats": bool(user_data.get("stats")),
                    "userId": user_data.get("id"),
                    "username": user_data.get("username")
                }
        
        self.record_result("GET /api/me - Own Profile", success, status, error, duration, "Profile", details)

    async def test_get_me_stats(self):
        """GET /api/me/stats — user dashboard stats"""
        status, data, duration = await self.make_request("GET", "me/stats")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            stats = data.get("stats") or data
            if stats:
                details = {
                    "posts": stats.get("posts"),
                    "reels": stats.get("reels"), 
                    "stories": stats.get("stories"),
                    "followers": stats.get("followers"),
                    "following": stats.get("following"),
                    "totalLikesReceived": stats.get("totalLikesReceived")
                }
        
        self.record_result("GET /api/me/stats - Dashboard Stats", success, status, error, duration, "Profile", details)

    async def test_get_me_settings(self):
        """GET /api/me/settings — all user settings"""
        status, data, duration = await self.make_request("GET", "me/settings")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            settings = data.get("settings") or data
            if settings:
                details = {
                    "hasPrivacy": bool(settings.get("privacy")),
                    "hasNotifications": bool(settings.get("notifications")),
                    "hasProfile": bool(settings.get("profile")),
                    "hasInterests": bool(settings.get("interests"))
                }
        
        self.record_result("GET /api/me/settings - All Settings", success, status, error, duration, "Profile", details)

    async def test_patch_me_settings(self):
        """PATCH /api/me/settings — update settings"""
        settings_update = {"privacy": {"isPrivate": False}}
        status, data, duration = await self.make_request("PATCH", "me/settings", settings_update)
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("PATCH /api/me/settings - Update Settings", success, status, error, duration, "Profile")

    async def test_get_me_privacy(self):
        """GET /api/me/privacy — privacy settings"""
        status, data, duration = await self.make_request("GET", "me/privacy")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            privacy = data.get("privacy") or data
            if privacy:
                details = {
                    "allowTagging": privacy.get("allowTagging"),
                    "hideOnlineStatus": privacy.get("hideOnlineStatus"),
                    "isPrivate": privacy.get("isPrivate")
                }
        
        self.record_result("GET /api/me/privacy - Privacy Settings", success, status, error, duration, "Profile", details)

    async def test_patch_me_privacy(self):
        """PATCH /api/me/privacy — update privacy"""
        privacy_update = {"allowTagging": "FOLLOWERS", "hideOnlineStatus": True}
        status, data, duration = await self.make_request("PATCH", "me/privacy", privacy_update)
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("PATCH /api/me/privacy - Update Privacy", success, status, error, duration, "Profile")

    async def test_get_me_activity(self):
        """GET /api/me/activity — activity summary"""
        status, data, duration = await self.make_request("GET", "me/activity")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            activity = data.get("activity") or data
            if activity:
                details = {
                    "period": activity.get("period"),
                    "postsThisWeek": activity.get("postsThisWeek"),
                    "hasStats": bool(activity.get("stats"))
                }
        
        self.record_result("GET /api/me/activity - Activity Summary", success, status, error, duration, "Profile", details)

    async def test_post_me_interests(self):
        """POST /api/me/interests — set interests"""
        interests_data = {"interests": ["sports", "music", "tech"]}
        status, data, duration = await self.make_request("POST", "me/interests", interests_data)
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("POST /api/me/interests - Set Interests", success, status, error, duration, "Profile")

    async def test_get_me_interests(self):
        """GET /api/me/interests — get interests"""
        status, data, duration = await self.make_request("GET", "me/interests")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            interests = data.get("interests") or data
            if isinstance(interests, list):
                details = {"interestsCount": len(interests)}
        
        self.record_result("GET /api/me/interests - Get Interests", success, status, error, duration, "Profile", details)

    async def test_get_me_login_activity(self):
        """GET /api/me/login-activity — recent login sessions"""
        status, data, duration = await self.make_request("GET", "me/login-activity")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            sessions = data.get("sessions") or data.get("items") or []
            details = {"sessionsCount": len(sessions) if isinstance(sessions, list) else 0}
        
        self.record_result("GET /api/me/login-activity - Login Sessions", success, status, error, duration, "Profile", details)

    async def test_get_me_bookmarks(self):
        """GET /api/me/bookmarks — saved content"""
        status, data, duration = await self.make_request("GET", "me/bookmarks")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            bookmarks = data.get("bookmarks") or data.get("items") or []
            details = {"bookmarksCount": len(bookmarks) if isinstance(bookmarks, list) else 0}
        
        self.record_result("GET /api/me/bookmarks - Saved Content", success, status, error, duration, "Profile", details)

    # ==========================================
    # GROUP 2: Content Interactions (12 endpoints)
    # ==========================================

    async def test_create_post(self):
        """POST /api/content/posts — create post"""
        post_data = {"caption": "Test post for new features testing"}
        status, data, duration = await self.make_request("POST", "content/posts", post_data)
        
        success = status in [200, 201]
        error = None if success else data.get("error", f"HTTP {status}")
        
        if success:
            post = data.get("post") or data.get("data", {}).get("post") or data
            if post and post.get("id"):
                self.created_post_id = post.get("id")
                
        self.record_result("POST /api/content/posts - Create Post", success, status, error, duration, "Content")

    async def test_pin_post(self):
        """POST /api/content/{postId}/pin — pin post"""
        if not self.created_post_id:
            self.record_result("POST /api/content/{postId}/pin - Pin Post", False, 0, "No post ID available", 0, "Content")
            return
            
        status, data, duration = await self.make_request("POST", f"content/{self.created_post_id}/pin")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("POST /api/content/{postId}/pin - Pin Post", success, status, error, duration, "Content")

    async def test_unpin_post(self):
        """DELETE /api/content/{postId}/pin — unpin post"""
        if not self.created_post_id:
            self.record_result("DELETE /api/content/{postId}/pin - Unpin Post", False, 0, "No post ID available", 0, "Content")
            return
            
        status, data, duration = await self.make_request("DELETE", f"content/{self.created_post_id}/pin")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("DELETE /api/content/{postId}/pin - Unpin Post", success, status, error, duration, "Content")

    async def test_archive_post(self):
        """POST /api/content/{postId}/archive — archive post"""
        if not self.created_post_id:
            self.record_result("POST /api/content/{postId}/archive - Archive Post", False, 0, "No post ID available", 0, "Content")
            return
            
        status, data, duration = await self.make_request("POST", f"content/{self.created_post_id}/archive")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("POST /api/content/{postId}/archive - Archive Post", success, status, error, duration, "Content")

    async def test_unarchive_post(self):
        """POST /api/content/{postId}/unarchive — restore post"""
        if not self.created_post_id:
            self.record_result("POST /api/content/{postId}/unarchive - Restore Post", False, 0, "No post ID available", 0, "Content")
            return
            
        status, data, duration = await self.make_request("POST", f"content/{self.created_post_id}/unarchive")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("POST /api/content/{postId}/unarchive - Restore Post", success, status, error, duration, "Content")

    async def test_hide_post(self):
        """POST /api/content/{postId}/hide — hide from feed"""
        if not self.created_post_id:
            self.record_result("POST /api/content/{postId}/hide - Hide Post", False, 0, "No post ID available", 0, "Content")
            return
            
        status, data, duration = await self.make_request("POST", f"content/{self.created_post_id}/hide", {})
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("POST /api/content/{postId}/hide - Hide Post", success, status, error, duration, "Content")

    async def test_get_post_likers(self):
        """GET /api/content/{postId}/likers — who liked"""
        if not self.created_post_id:
            self.record_result("GET /api/content/{postId}/likers - Post Likers", False, 0, "No post ID available", 0, "Content")
            return
            
        status, data, duration = await self.make_request("GET", f"content/{self.created_post_id}/likers")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            items = data.get("items") or []
            total = data.get("total", len(items))
            details = {"likersCount": len(items), "total": total}
        
        self.record_result("GET /api/content/{postId}/likers - Post Likers", success, status, error, duration, "Content", details)

    async def test_get_post_shares(self):
        """GET /api/content/{postId}/shares — who shared"""
        if not self.created_post_id:
            self.record_result("GET /api/content/{postId}/shares - Post Shares", False, 0, "No post ID available", 0, "Content")
            return
            
        status, data, duration = await self.make_request("GET", f"content/{self.created_post_id}/shares")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            items = data.get("items") or []
            total = data.get("total", len(items))
            details = {"sharesCount": len(items), "total": total}
        
        self.record_result("GET /api/content/{postId}/shares - Post Shares", success, status, error, duration, "Content", details)

    async def test_report_post(self):
        """POST /api/content/{postId}/report — report post (use user2's post)"""
        # Need to create a post with user2 first, then report it with user1
        post_data = {"caption": "Test post to be reported"}
        status, data, duration = await self.make_request("POST", "content/posts", post_data, user_num=2)
        
        if status not in [200, 201]:
            self.record_result("POST /api/content/{postId}/report - Report Post", False, status, "Could not create post to report", duration, "Content")
            return
            
        post = data.get("post") or data.get("data", {}).get("post") or data
        if not post or not post.get("id"):
            self.record_result("POST /api/content/{postId}/report - Report Post", False, 0, "No post ID from creation", 0, "Content")
            return
            
        report_post_id = post.get("id")
        
        # Now report it with user1
        report_data = {"reason": "inappropriate", "details": "Test report"}
        status, data, duration = await self.make_request("POST", f"content/{report_post_id}/report", report_data, user_num=1)
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("POST /api/content/{postId}/report - Report Post", success, status, error, duration, "Content")

    # ==========================================
    # GROUP 3: Comment Operations (5 endpoints)
    # ==========================================

    async def test_create_comment(self):
        """POST /api/content/{postId}/comments — create comment"""
        if not self.created_post_id:
            self.record_result("POST /api/content/{postId}/comments - Create Comment", False, 0, "No post ID available", 0, "Comments")
            return
            
        comment_data = {"text": "Hello! This is a test comment."}
        status, data, duration = await self.make_request("POST", f"content/{self.created_post_id}/comments", comment_data)
        
        success = status in [200, 201]
        error = None if success else data.get("error", f"HTTP {status}")
        
        if success:
            comment = data.get("comment") or data.get("data", {}).get("comment") or data
            if comment and comment.get("id"):
                self.created_comment_id = comment.get("id")
        
        self.record_result("POST /api/content/{postId}/comments - Create Comment", success, status, error, duration, "Comments")

    async def test_reply_to_comment(self):
        """POST /api/content/{postId}/comments/{commentId}/reply — reply"""
        if not self.created_post_id or not self.created_comment_id:
            self.record_result("POST /api/content/{postId}/comments/{commentId}/reply - Reply Comment", False, 0, "Missing post/comment ID", 0, "Comments")
            return
            
        reply_data = {"text": "This is a reply to the comment!"}
        status, data, duration = await self.make_request("POST", f"content/{self.created_post_id}/comments/{self.created_comment_id}/reply", reply_data)
        
        success = status in [200, 201]
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("POST /api/content/{postId}/comments/{commentId}/reply - Reply Comment", success, status, error, duration, "Comments")

    async def test_edit_comment(self):
        """PATCH /api/content/{postId}/comments/{commentId} — edit"""
        if not self.created_post_id or not self.created_comment_id:
            self.record_result("PATCH /api/content/{postId}/comments/{commentId} - Edit Comment", False, 0, "Missing post/comment ID", 0, "Comments")
            return
            
        edit_data = {"text": "Updated comment text!"}
        status, data, duration = await self.make_request("PATCH", f"content/{self.created_post_id}/comments/{self.created_comment_id}", edit_data)
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("PATCH /api/content/{postId}/comments/{commentId} - Edit Comment", success, status, error, duration, "Comments")

    async def test_pin_comment(self):
        """POST /api/content/{postId}/comments/{commentId}/pin — pin comment"""
        if not self.created_post_id or not self.created_comment_id:
            self.record_result("POST /api/content/{postId}/comments/{commentId}/pin - Pin Comment", False, 0, "Missing post/comment ID", 0, "Comments")
            return
            
        status, data, duration = await self.make_request("POST", f"content/{self.created_post_id}/comments/{self.created_comment_id}/pin")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("POST /api/content/{postId}/comments/{commentId}/pin - Pin Comment", success, status, error, duration, "Comments")

    async def test_delete_comment(self):
        """DELETE /api/content/{postId}/comments/{commentId} — delete comment"""
        # Create a new comment to delete
        if not self.created_post_id:
            self.record_result("DELETE /api/content/{postId}/comments/{commentId} - Delete Comment", False, 0, "No post ID available", 0, "Comments")
            return
            
        comment_data = {"text": "Comment to be deleted"}
        status, data, duration = await self.make_request("POST", f"content/{self.created_post_id}/comments", comment_data)
        
        if status not in [200, 201]:
            self.record_result("DELETE /api/content/{postId}/comments/{commentId} - Delete Comment", False, status, "Could not create comment to delete", duration, "Comments")
            return
            
        comment = data.get("comment") or data.get("data", {}).get("comment") or data
        if not comment or not comment.get("id"):
            self.record_result("DELETE /api/content/{postId}/comments/{commentId} - Delete Comment", False, 0, "No comment ID from creation", 0, "Comments")
            return
            
        comment_to_delete_id = comment.get("id")
        
        # Now delete it
        status, data, duration = await self.make_request("DELETE", f"content/{self.created_post_id}/comments/{comment_to_delete_id}")
        
        success = status in [200, 204]
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("DELETE /api/content/{postId}/comments/{commentId} - Delete Comment", success, status, error, duration, "Comments")

    # ==========================================
    # GROUP 4: Stories (4 endpoints)
    # ==========================================

    async def test_create_story(self):
        """POST /api/stories — create story"""
        story_data = {
            "type": "TEXT",
            "text": "Test story for new features",
            "privacy": "EVERYONE"
        }
        status, data, duration = await self.make_request("POST", "stories", story_data)
        
        success = status in [200, 201]
        error = None if success else data.get("error", f"HTTP {status}")
        
        if success:
            story = data.get("story") or data.get("data", {}).get("story") or data
            if story and story.get("id"):
                self.created_story_id = story.get("id")
        
        self.record_result("POST /api/stories - Create Story", success, status, error, duration, "Stories")

    async def test_view_story(self):
        """POST /api/stories/{storyId}/view — mark as viewed"""
        if not self.created_story_id:
            self.record_result("POST /api/stories/{storyId}/view - View Story", False, 0, "No story ID available", 0, "Stories")
            return
            
        status, data, duration = await self.make_request("POST", f"stories/{self.created_story_id}/view", {})
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("POST /api/stories/{storyId}/view - View Story", success, status, error, duration, "Stories")

    async def test_share_story(self):
        """POST /api/stories/{storyId}/share — share story to post"""
        if not self.created_story_id:
            self.record_result("POST /api/stories/{storyId}/share - Share Story", False, 0, "No story ID available", 0, "Stories")
            return
            
        status, data, duration = await self.make_request("POST", f"stories/{self.created_story_id}/share", {})
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("POST /api/stories/{storyId}/share - Share Story", success, status, error, duration, "Stories")

    async def test_get_story_insights(self):
        """GET /api/me/stories/insights — story insights"""
        status, data, duration = await self.make_request("GET", "me/stories/insights")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            insights = data.get("insights") or data
            if insights:
                details = {
                    "totalViews": insights.get("totalViews"),
                    "totalStories": insights.get("totalStories"),
                    "hasMetrics": bool(insights.get("metrics"))
                }
        
        self.record_result("GET /api/me/stories/insights - Story Insights", success, status, error, duration, "Stories", details)

    # ==========================================
    # GROUP 5: Reels (4 endpoints) 
    # ==========================================

    async def test_get_reel_likers(self):
        """GET /api/reels/{reelId}/likers — who liked reel"""
        # First get a reel from the reels feed
        status, data, duration = await self.make_request("GET", "feed/reels?limit=1")
        
        if status != 200:
            self.record_result("GET /api/reels/{reelId}/likers - Reel Likers", False, status, "Could not get reels feed", duration, "Reels")
            return
            
        reels = data.get("items") or []
        if not reels:
            self.record_result("GET /api/reels/{reelId}/likers - Reel Likers", False, 0, "No reels in feed", 0, "Reels")
            return
            
        reel_id = reels[0].get("id")
        if not reel_id:
            self.record_result("GET /api/reels/{reelId}/likers - Reel Likers", False, 0, "No reel ID found", 0, "Reels")
            return
            
        # Now get the likers
        status, data, duration = await self.make_request("GET", f"reels/{reel_id}/likers")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            items = data.get("items") or []
            total = data.get("total", len(items))
            details = {"likersCount": len(items), "total": total}
        
        self.record_result("GET /api/reels/{reelId}/likers - Reel Likers", success, status, error, duration, "Reels", details)

    async def test_get_saved_reels(self):
        """GET /api/me/reels/saved — saved reels"""
        status, data, duration = await self.make_request("GET", "me/reels/saved")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            items = data.get("items") or []
            details = {"savedReelsCount": len(items)}
        
        self.record_result("GET /api/me/reels/saved - Saved Reels", success, status, error, duration, "Reels", details)

    async def test_create_duet(self):
        """POST /api/reels/{reelId}/duet — create duet"""
        # First get a reel ID
        status, data, duration = await self.make_request("GET", "feed/reels?limit=1")
        
        if status != 200:
            self.record_result("POST /api/reels/{reelId}/duet - Create Duet", False, status, "Could not get reels feed", duration, "Reels")
            return
            
        reels = data.get("items") or []
        if not reels:
            self.record_result("POST /api/reels/{reelId}/duet - Create Duet", False, 0, "No reels in feed", 0, "Reels")
            return
            
        reel_id = reels[0].get("id")
        if not reel_id:
            self.record_result("POST /api/reels/{reelId}/duet - Create Duet", False, 0, "No reel ID found", 0, "Reels")
            return
            
        duet_data = {
            "caption": "Test duet reel",
            "mediaUrl": "https://example.com/d.mp4",
            "durationMs": 3000
        }
        
        status, data, duration = await self.make_request("POST", f"reels/{reel_id}/duet", duet_data)
        
        success = status in [200, 201]
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("POST /api/reels/{reelId}/duet - Create Duet", success, status, error, duration, "Reels")

    async def test_get_popular_sounds(self):
        """GET /api/reels/sounds/popular — popular sounds"""
        status, data, duration = await self.make_request("GET", "reels/sounds/popular")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            items = data.get("items") or []
            details = {"soundsCount": len(items)}
        
        self.record_result("GET /api/reels/sounds/popular - Popular Sounds", success, status, error, duration, "Reels", details)

    # ==========================================
    # GROUP 6: Tribes (8 endpoints)
    # ==========================================

    async def test_get_tribes(self):
        """GET /api/tribes — list all tribes"""
        status, data, duration = await self.make_request("GET", "tribes")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            items = data.get("items") or []
            count = data.get("count", len(items))
            details = {"tribesCount": len(items), "totalCount": count}
            
            # Store first tribe ID for other tests
            if items:
                self.tribe_id = items[0].get("id")
        
        self.record_result("GET /api/tribes - List Tribes", success, status, error, duration, "Tribes", details)

    async def test_get_tribe_stats(self):
        """GET /api/tribes/{tribeId}/stats — tribe statistics"""
        if not self.tribe_id:
            self.record_result("GET /api/tribes/{tribeId}/stats - Tribe Stats", False, 0, "No tribe ID available", 0, "Tribes")
            return
            
        status, data, duration = await self.make_request("GET", f"tribes/{self.tribe_id}/stats")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            stats = data.get("stats") or data
            if stats:
                details = {
                    "members": stats.get("members"),
                    "posts": stats.get("posts"),
                    "reels": stats.get("reels")
                }
        
        self.record_result("GET /api/tribes/{tribeId}/stats - Tribe Stats", success, status, error, duration, "Tribes", details)

    async def test_get_tribe_feed(self):
        """GET /api/tribes/{tribeId}/feed — tribe content feed"""
        if not self.tribe_id:
            self.record_result("GET /api/tribes/{tribeId}/feed - Tribe Feed", False, 0, "No tribe ID available", 0, "Tribes")
            return
            
        status, data, duration = await self.make_request("GET", f"tribes/{self.tribe_id}/feed")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            items = data.get("items") or []
            details = {"feedItemsCount": len(items)}
        
        self.record_result("GET /api/tribes/{tribeId}/feed - Tribe Feed", success, status, error, duration, "Tribes", details)

    async def test_get_tribe_events(self):
        """GET /api/tribes/{tribeId}/events — tribe events"""
        if not self.tribe_id:
            self.record_result("GET /api/tribes/{tribeId}/events - Tribe Events", False, 0, "No tribe ID available", 0, "Tribes")
            return
            
        status, data, duration = await self.make_request("GET", f"tribes/{self.tribe_id}/events")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            events = data.get("events") or data.get("items") or []
            details = {"eventsCount": len(events)}
        
        self.record_result("GET /api/tribes/{tribeId}/events - Tribe Events", success, status, error, duration, "Tribes", details)

    async def test_join_tribe(self):
        """POST /api/tribes/{tribeId}/join — join tribe"""
        if not self.tribe_id:
            self.record_result("POST /api/tribes/{tribeId}/join - Join Tribe", False, 0, "No tribe ID available", 0, "Tribes")
            return
            
        status, data, duration = await self.make_request("POST", f"tribes/{self.tribe_id}/join", {})
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("POST /api/tribes/{tribeId}/join - Join Tribe", success, status, error, duration, "Tribes")

    async def test_cheer_tribe(self):
        """POST /api/tribes/{tribeId}/cheer — cheer for tribe"""
        if not self.tribe_id:
            self.record_result("POST /api/tribes/{tribeId}/cheer - Cheer Tribe", False, 0, "No tribe ID available", 0, "Tribes")
            return
            
        status, data, duration = await self.make_request("POST", f"tribes/{self.tribe_id}/cheer", {})
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("POST /api/tribes/{tribeId}/cheer - Cheer Tribe", success, status, error, duration, "Tribes")

    async def test_leave_tribe(self):
        """POST /api/tribes/{tribeId}/leave — leave tribe"""
        if not self.tribe_id:
            self.record_result("POST /api/tribes/{tribeId}/leave - Leave Tribe", False, 0, "No tribe ID available", 0, "Tribes")
            return
            
        status, data, duration = await self.make_request("POST", f"tribes/{self.tribe_id}/leave", {})
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("POST /api/tribes/{tribeId}/leave - Leave Tribe", success, status, error, duration, "Tribes")

    async def test_get_mutual_followers(self):
        """GET /api/users/{userId}/mutual-followers — mutual followers"""
        if not self.user2_id:
            self.record_result("GET /api/users/{userId}/mutual-followers - Mutual Followers", False, 0, "No user2 ID available", 0, "Tribes")
            return
            
        status, data, duration = await self.make_request("GET", f"users/{self.user2_id}/mutual-followers")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            followers = data.get("mutualFollowers") or data.get("items") or []
            details = {"mutualFollowersCount": len(followers)}
        
        self.record_result("GET /api/users/{userId}/mutual-followers - Mutual Followers", success, status, error, duration, "Tribes", details)

    # ==========================================
    # GROUP 7: Feed & Discovery (7 endpoints)
    # ==========================================

    async def test_get_explore(self):
        """GET /api/explore — explore page"""
        status, data, duration = await self.make_request("GET", "explore")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            posts = data.get("posts") or []
            reels = data.get("reels") or []
            trending_hashtags = data.get("trendingHashtags") or []
            details = {
                "postsCount": len(posts),
                "reelsCount": len(reels), 
                "trendingHashtagsCount": len(trending_hashtags)
            }
        
        self.record_result("GET /api/explore - Explore Page", success, status, error, duration, "Discovery", details)

    async def test_get_explore_creators(self):
        """GET /api/explore/creators — popular creators"""
        status, data, duration = await self.make_request("GET", "explore/creators")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            creators = data.get("creators") or data.get("items") or []
            details = {"creatorsCount": len(creators)}
            
            # Check for required fields
            if creators:
                first_creator = creators[0]
                has_follower_count = "followerCount" in first_creator
                has_is_following = "isFollowing" in first_creator
                details.update({
                    "hasFollowerCount": has_follower_count,
                    "hasIsFollowing": has_is_following
                })
        
        self.record_result("GET /api/explore/creators - Popular Creators", success, status, error, duration, "Discovery", details)

    async def test_get_explore_reels(self):
        """GET /api/explore/reels — trending reels"""
        status, data, duration = await self.make_request("GET", "explore/reels")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            reels = data.get("reels") or data.get("items") or []
            details = {"trendingReelsCount": len(reels)}
        
        self.record_result("GET /api/explore/reels - Trending Reels", success, status, error, duration, "Discovery", details)

    async def test_get_mixed_feed(self):
        """GET /api/feed/mixed — mixed feed (posts + reels interleaved)"""
        status, data, duration = await self.make_request("GET", "feed/mixed")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            items = data.get("items") or []
            details = {"mixedItemsCount": len(items)}
            
            # Check for type field on items
            if items:
                has_type_field = "type" in items[0]
                details["hasTypeField"] = has_type_field
        
        self.record_result("GET /api/feed/mixed - Mixed Feed", success, status, error, duration, "Discovery", details)

    async def test_get_personalized_feed(self):
        """GET /api/feed/personalized — personalized feed"""
        status, data, duration = await self.make_request("GET", "feed/personalized")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            items = data.get("items") or []
            details = {"personalizedItemsCount": len(items)}
        
        self.record_result("GET /api/feed/personalized - Personalized Feed", success, status, error, duration, "Discovery", details)

    async def test_get_trending_topics(self):
        """GET /api/trending/topics — trending hashtags"""
        status, data, duration = await self.make_request("GET", "trending/topics")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            topics = data.get("topics") or data.get("items") or []
            details = {"trendingTopicsCount": len(topics)}
            
            # Check for rank and score fields
            if topics:
                first_topic = topics[0]
                has_rank = "rank" in first_topic
                has_score = "score" in first_topic
                details.update({
                    "hasRank": has_rank,
                    "hasScore": has_score
                })
        
        self.record_result("GET /api/trending/topics - Trending Topics", success, status, error, duration, "Discovery", details)

    # ==========================================
    # GROUP 8: Notifications (2 endpoints)
    # ==========================================

    async def test_read_all_notifications(self):
        """POST /api/notifications/read-all — mark all read"""
        status, data, duration = await self.make_request("POST", "notifications/read-all")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("POST /api/notifications/read-all - Mark All Read", success, status, error, duration, "Notifications")

    async def test_clear_all_notifications(self):
        """DELETE /api/notifications/clear — clear all notifications"""
        status, data, duration = await self.make_request("DELETE", "notifications/clear")
        
        success = status in [200, 204]
        error = None if success else data.get("error", f"HTTP {status}")
        
        self.record_result("DELETE /api/notifications/clear - Clear All", success, status, error, duration, "Notifications")

    # ==========================================
    # CORE VERIFICATION TESTS
    # ==========================================

    async def test_core_feed(self):
        """GET /api/feed — home feed (anon + auth)"""
        status, data, duration = await self.make_request("GET", "feed")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            items = data.get("items") or []
            feed_type = data.get("feedType", "unknown")
            details = {"feedItemsCount": len(items), "feedType": feed_type}
        
        self.record_result("GET /api/feed - Core Feed", success, status, error, duration, "Core", details)

    async def test_core_stories(self):
        """GET /api/feed/stories — story rail"""
        status, data, duration = await self.make_request("GET", "feed/stories")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            stories = data.get("stories") or []
            story_rail = data.get("storyRail") or []
            details = {"storiesCount": len(stories), "storyRailCount": len(story_rail)}
        
        self.record_result("GET /api/feed/stories - Core Stories", success, status, error, duration, "Core", details)

    async def test_core_reels(self):
        """GET /api/feed/reels — reels feed"""
        status, data, duration = await self.make_request("GET", "feed/reels")
        
        success = status == 200
        error = None if success else data.get("error", f"HTTP {status}")
        details = {}
        
        if success:
            items = data.get("items") or []
            details = {"reelsCount": len(items)}
        
        self.record_result("GET /api/feed/reels - Core Reels", success, status, error, duration, "Core", details)

    # ==========================================
    # MAIN TEST EXECUTION
    # ==========================================

    async def run_all_tests(self):
        """Run all 50 new feature tests"""
        print("🚀 Starting Comprehensive 50 New Features Test Suite")
        print(f"Base URL: {BASE_URL}")
        print("=" * 80)
        
        await self.setup()
        
        if not self.user1_token or not self.user2_token:
            print("❌ Authentication failed for one or both users - cannot proceed")
            return
            
        try:
            # GROUP 1: Profile & User Settings (12 endpoints)
            print(f"\n📋 GROUP 1: PROFILE & USER SETTINGS (12 endpoints)")
            print("-" * 60)
            await self.test_get_me()
            await self.test_get_me_stats()
            await self.test_get_me_settings()
            await self.test_patch_me_settings()
            await self.test_get_me_privacy()
            await self.test_patch_me_privacy()
            await self.test_get_me_activity()
            await self.test_post_me_interests()
            await self.test_get_me_interests()
            await self.test_get_me_login_activity()
            await self.test_get_me_bookmarks()
            # Skip /me/deactivate as specified
            
            # GROUP 2: Content Interactions (12 endpoints)
            print(f"\n📋 GROUP 2: CONTENT INTERACTIONS (12 endpoints)")
            print("-" * 60)
            await self.test_create_post()
            await self.test_pin_post()
            await self.test_unpin_post()
            await self.test_archive_post()
            await self.test_unarchive_post()
            await self.test_hide_post()
            await self.test_get_post_likers()
            await self.test_get_post_shares()
            await self.test_report_post()
            
            # GROUP 3: Comment Operations (5 endpoints)
            print(f"\n📋 GROUP 3: COMMENT OPERATIONS (5 endpoints)")
            print("-" * 60)
            await self.test_create_comment()
            await self.test_reply_to_comment()
            await self.test_edit_comment()
            await self.test_pin_comment()
            await self.test_delete_comment()
            
            # GROUP 4: Stories (4 endpoints)
            print(f"\n📋 GROUP 4: STORIES (4 endpoints)")
            print("-" * 60)
            await self.test_create_story()
            await self.test_view_story()
            await self.test_share_story()
            await self.test_get_story_insights()
            
            # GROUP 5: Reels (4 endpoints)
            print(f"\n📋 GROUP 5: REELS (4 endpoints)")
            print("-" * 60)
            await self.test_get_reel_likers()
            await self.test_get_saved_reels()
            await self.test_create_duet()
            await self.test_get_popular_sounds()
            
            # GROUP 6: Tribes (8 endpoints)
            print(f"\n📋 GROUP 6: TRIBES (8 endpoints)")
            print("-" * 60)
            await self.test_get_tribes()
            await self.test_get_tribe_stats()
            await self.test_get_tribe_feed()
            await self.test_get_tribe_events()
            await self.test_join_tribe()
            await self.test_cheer_tribe()
            await self.test_leave_tribe()
            await self.test_get_mutual_followers()
            
            # GROUP 7: Feed & Discovery (7 endpoints)
            print(f"\n📋 GROUP 7: FEED & DISCOVERY (7 endpoints)")
            print("-" * 60)
            await self.test_get_explore()
            await self.test_get_explore_creators()
            await self.test_get_explore_reels()
            await self.test_get_mixed_feed()
            await self.test_get_personalized_feed()
            await self.test_get_trending_topics()
            
            # GROUP 8: Notifications (2 endpoints)
            print(f"\n📋 GROUP 8: NOTIFICATIONS (2 endpoints)")
            print("-" * 60)
            await self.test_read_all_notifications()
            await self.test_clear_all_notifications()
            
            # CORE VERIFICATION
            print(f"\n📋 CORE VERIFICATION (3 endpoints)")
            print("-" * 60)
            await self.test_core_feed()
            await self.test_core_stories()
            await self.test_core_reels()
            
        finally:
            await self.teardown()

    def generate_report(self):
        """Generate comprehensive test report"""
        total_tests = len(self.results)
        passed_tests = len([r for r in self.results if r.success])
        failed_tests = total_tests - passed_tests
        
        # Group by category
        groups = {}
        for result in self.results:
            group = result.group
            if group not in groups:
                groups[group] = {"total": 0, "passed": 0}
            groups[group]["total"] += 1
            if result.success:
                groups[group]["passed"] += 1
        
        print("\n" + "=" * 80)
        print("🎯 COMPREHENSIVE 50 NEW FEATURES TEST REPORT")
        print("=" * 80)
        print(f"Total Tests: {total_tests}")
        print(f"Passed: {passed_tests} ✅")
        print(f"Failed: {failed_tests} ❌")
        success_rate = (passed_tests/total_tests*100) if total_tests > 0 else 0
        print(f"Success Rate: {success_rate:.1f}%")
        print()
        
        print("📊 GROUP BREAKDOWN:")
        for group, stats in groups.items():
            group_rate = (stats["passed"]/stats["total"]*100) if stats["total"] > 0 else 0
            print(f"{group}: {stats['passed']}/{stats['total']} ({group_rate:.1f}%) ✅")
        
        # Failed tests
        failed_results = [r for r in self.results if not r.success]
        if failed_results:
            print(f"\n❌ FAILED TESTS ({len(failed_results)}):")
            for result in failed_results:
                print(f"   - {result.name} ({result.response_code}): {result.error}")
        else:
            print("\n✅ ALL TESTS PASSED!")
            
        # Key insights
        print(f"\n🔍 KEY INSIGHTS:")
        
        # Check critical endpoints
        auth_issues = [r for r in self.results if r.response_code == 401]
        if auth_issues:
            print(f"⚠️  Found {len(auth_issues)} authentication issues")
            
        server_errors = [r for r in self.results if r.response_code >= 500]
        if server_errors:
            print(f"❌ Found {len(server_errors)} server errors")
        else:
            print("✅ No server errors found")
            
        not_found = [r for r in self.results if r.response_code == 404]
        if not_found:
            print(f"⚠️  Found {len(not_found)} missing endpoints")
        else:
            print("✅ All endpoints found")
            
        print("=" * 80)
        
        # Save report
        report_data = {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "test_suite": "50_new_features_comprehensive",
            "total_tests": total_tests,
            "passed_tests": passed_tests,
            "failed_tests": failed_tests,
            "success_rate": round(success_rate, 1),
            "group_breakdown": {
                group: {
                    "passed": stats["passed"],
                    "total": stats["total"],
                    "success_rate": round((stats["passed"]/stats["total"]*100) if stats["total"] > 0 else 0, 1)
                }
                for group, stats in groups.items()
            },
            "results": [
                {
                    "name": r.name,
                    "success": r.success,
                    "status_code": r.response_code,
                    "error": r.error,
                    "duration_ms": r.duration_ms,
                    "group": r.group,
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
    suite = TribeNewFeaturesTestSuite()
    await suite.run_all_tests()
    suite.generate_report()

if __name__ == "__main__":
    asyncio.run(main())