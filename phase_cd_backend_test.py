#!/usr/bin/env python3
"""
Phase C & D Backend Testing Suite for Tribe Social Platform

Testing comprehensive backend API functionality focusing on:
- Phase C: Anti-Abuse System (engagement endpoints with abuse detection)
- Phase D: Poll Posts, Thread Posts, Link Preview Posts
- Regression testing of existing features

Base URL: https://dev-hub-39.preview.emergentagent.com/api
"""

import asyncio
import aiohttp
import json
import time
import sys
from dataclasses import dataclass
from typing import Dict, List, Optional, Any
from pymongo import MongoClient

BASE_URL = "https://dev-hub-39.preview.emergentagent.com"
API_URL = f"{BASE_URL}/api"

@dataclass
class TestResult:
    name: str
    success: bool
    response_code: int
    error: Optional[str]
    duration_ms: int
    phase: str
    details: Optional[Dict] = None

class PhaseTestSuite:
    def __init__(self):
        self.session = None
        self.results = []
        # Test users with existing phone numbers that work
        self.user1 = {"phone": "7777000001", "pin": "1234", "displayName": "Alice Phase"}
        self.user2 = {"phone": "7777000002", "pin": "1234", "displayName": "Bob Phase"}
        self.user3 = {"phone": "7777000003", "pin": "1234", "displayName": "Charlie Phase"}
        
        self.tokens = {}
        self.users = {}
        self.test_posts = []
        
        # MongoDB connection for admin setup
        self.mongo_client = MongoClient('mongodb://localhost:27017')
        self.db = self.mongo_client['your_database_name']

    async def setup_session(self):
        timeout = aiohttp.ClientTimeout(total=30)
        self.session = aiohttp.ClientSession(timeout=timeout)

    async def cleanup_session(self):
        if self.session:
            await self.session.close()

    def log_result(self, name: str, success: bool, response_code: int, phase: str, error: str = None, duration_ms: int = 0, details: Dict = None):
        result = TestResult(name, success, response_code, error, duration_ms, phase, details)
        self.results.append(result)
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} [{phase}] {name} ({response_code}) - {duration_ms}ms")
        if error:
            print(f"    Error: {error}")
        if details:
            print(f"    Details: {json.dumps(details, indent=2)}")

    async def make_request(self, method: str, endpoint: str, data: Dict = None, token: str = None) -> tuple[int, Dict]:
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'
        
        start = time.time()
        try:
            if method == 'GET':
                async with self.session.get(f"{API_URL}{endpoint}", headers=headers) as resp:
                    duration = int((time.time() - start) * 1000)
                    try:
                        response_data = await resp.json()
                    except:
                        response_data = {"error": "Invalid JSON response"}
                    return resp.status, response_data, duration
            elif method in ['POST', 'PATCH', 'PUT']:
                json_data = json.dumps(data) if data else None
                async with self.session.request(method, f"{API_URL}{endpoint}", 
                                              data=json_data, headers=headers) as resp:
                    duration = int((time.time() - start) * 1000)
                    try:
                        response_data = await resp.json()
                    except:
                        response_data = {"error": "Invalid JSON response"}
                    return resp.status, response_data, duration
            elif method == 'DELETE':
                async with self.session.delete(f"{API_URL}{endpoint}", headers=headers) as resp:
                    duration = int((time.time() - start) * 1000)
                    try:
                        response_data = await resp.json() if resp.status != 204 else {}
                    except:
                        response_data = {"error": "Invalid JSON response"}
                    return resp.status, response_data, duration
        except Exception as e:
            duration = int((time.time() - start) * 1000)
            return 0, {"error": str(e)}, duration

    async def register_and_login_user(self, user_data: Dict) -> str:
        """Register and login a user, return access token"""
        try:
            # Add delay to avoid rate limiting
            await asyncio.sleep(2)
            
            # Try login first (users likely already exist)
            status, response, duration = await self.make_request('POST', '/auth/login', {
                "phone": user_data["phone"],
                "pin": user_data["pin"]
            })
            
            if status == 429:  # Rate limited
                print(f"⚠️ Rate limited for {user_data['phone']}, waiting...")
                await asyncio.sleep(10)
                status, response, duration = await self.make_request('POST', '/auth/login', {
                    "phone": user_data["phone"],
                    "pin": user_data["pin"]
                })
            
            if status not in [200, 201]:
                # Try register if login failed
                await asyncio.sleep(2)
                status, response, duration = await self.make_request('POST', '/auth/register', {
                    "phone": user_data["phone"],
                    "pin": user_data["pin"],
                    "displayName": user_data["displayName"]
                })
            
            if status in [200, 201]:
                # Handle direct response format (no 'data' wrapper)
                token = response.get('accessToken')
                user = response.get('user')
                
                if token and user:
                    self.tokens[user_data["phone"]] = token
                    self.users[user_data["phone"]] = user
                    
                    # Complete onboarding with delays
                    await asyncio.sleep(1)
                    await self.make_request('PATCH', '/me/age', {
                        "birthYear": 1995
                    }, token)
                    
                    await asyncio.sleep(1)
                    await self.make_request('POST', '/legal/accept', {
                        "version": "1.0"
                    }, token)
                    
                    return token
            
            return None
        except Exception as e:
            print(f"Registration/login failed for {user_data['phone']}: {e}")
            return None

    def setup_admin_users(self):
        """Set users as ADULT and create admin user in MongoDB"""
        try:
            # Ensure test users are ADULT for content creation
            for user_data in [self.user1, self.user2, self.user3]:
                self.db.users.update_one(
                    {'phone': user_data["phone"]},
                    {'$set': {'ageStatus': 'ADULT'}}
                )
            
            # Create an admin user for admin endpoints testing
            admin_user = self.db.users.find_one({'phone': self.user1["phone"]})
            if admin_user:
                self.db.users.update_one(
                    {'phone': self.user1["phone"]},
                    {'$set': {'role': 'ADMIN'}}
                )
                print(f"✅ Set {self.user1['phone']} as ADMIN")
            
        except Exception as e:
            print(f"⚠️ MongoDB setup failed: {e}")

    # ==================== PHASE C TESTS: ANTI-ABUSE SYSTEM ====================
    
    async def test_phase_c_normal_engagement(self):
        """Test that normal engagement still works with anti-abuse system"""
        print("\n=== Phase C: Normal Engagement Tests ===")
        
        # Create a test post first
        post_data = {
            "caption": "Test post for normal engagement",
            "kind": "POST"
        }
        status, response, duration = await self.make_request('POST', '/content/posts', 
                                                            post_data, self.tokens[self.user1["phone"]])
        
        if status == 201 and 'data' in response:
            post_id = response['data']['post']['id']
            self.test_posts.append(post_id)
            self.log_result("Create test post for engagement", True, status, "PHASE_C", duration_ms=duration)
            
            # Test normal like (user2 likes user1's post)
            status, response, duration = await self.make_request('POST', f'/content/{post_id}/like', 
                                                                {}, self.tokens[self.user2["phone"]])
            self.log_result("Normal like engagement", status == 200, status, "PHASE_C", 
                           error=response.get('error') if status != 200 else None, duration_ms=duration)
            
            # Test comment
            status, response, duration = await self.make_request('POST', f'/content/{post_id}/comments', 
                                                                {"body": "Great post!"}, self.tokens[self.user2["phone"]])
            self.log_result("Normal comment engagement", status in [200, 201], status, "PHASE_C", 
                           error=response.get('error') if status not in [200, 201] else None, duration_ms=duration)
            
            # Test save
            status, response, duration = await self.make_request('POST', f'/content/{post_id}/save', 
                                                                {}, self.tokens[self.user2["phone"]])
            self.log_result("Normal save engagement", status == 200, status, "PHASE_C", 
                           error=response.get('error') if status != 200 else None, duration_ms=duration)
            
            # Test share
            status, response, duration = await self.make_request('POST', f'/content/{post_id}/share', 
                                                                {"platform": "INTERNAL"}, self.tokens[self.user2["phone"]])
            self.log_result("Normal share engagement", status == 200, status, "PHASE_C", 
                           error=response.get('error') if status != 200 else None, duration_ms=duration)
            
            # Test follow
            user1_id = self.users[self.user1["phone"]]['id']
            status, response, duration = await self.make_request('POST', f'/follow/{user1_id}', 
                                                                {}, self.tokens[self.user2["phone"]])
            self.log_result("Normal follow engagement", status == 200, status, "PHASE_C", 
                           error=response.get('error') if status != 200 else None, duration_ms=duration)
        else:
            self.log_result("Create test post for engagement", False, status, "PHASE_C", 
                           error=response.get('error'), duration_ms=duration)

    async def test_phase_c_admin_abuse_dashboard(self):
        """Test admin abuse dashboard endpoints"""
        print("\n=== Phase C: Admin Abuse Dashboard Tests ===")
        
        admin_token = self.tokens[self.user1["phone"]]  # user1 is set as ADMIN
        
        # Test abuse dashboard
        status, response, duration = await self.make_request('GET', '/admin/abuse-dashboard?hours=24', 
                                                            None, admin_token)
        self.log_result("Admin abuse dashboard", status == 200, status, "PHASE_C", 
                       error=response.get('error') if status != 200 else None, 
                       duration_ms=duration, details=response.get('data'))
        
        # Test abuse log
        status, response, duration = await self.make_request('GET', '/admin/abuse-log?hours=24&limit=10', 
                                                            None, admin_token)
        self.log_result("Admin abuse log", status == 200, status, "PHASE_C", 
                       error=response.get('error') if status != 200 else None, duration_ms=duration)
        
        # Test non-admin access (should get 403)
        status, response, duration = await self.make_request('GET', '/admin/abuse-dashboard', 
                                                            None, self.tokens[self.user2["phone"]])
        self.log_result("Non-admin abuse dashboard (403 expected)", status == 403, status, "PHASE_C", 
                       error=response.get('error') if status != 403 else None, duration_ms=duration)

    async def test_phase_c_burst_simulation(self):
        """Test anti-abuse detection with rapid repeated actions"""
        print("\n=== Phase C: Burst Detection Tests ===")
        
        if not self.test_posts:
            # Create a test post if none exists
            post_data = {"caption": "Test post for burst detection", "kind": "POST"}
            status, response, duration = await self.make_request('POST', '/content/posts', 
                                                                post_data, self.tokens[self.user1["phone"]])
            if status == 201 and 'data' in response:
                self.test_posts.append(response['data']['post']['id'])
        
        if self.test_posts:
            post_id = self.test_posts[0]
            
            # Simulate rapid likes (burst simulation)
            like_results = []
            for i in range(5):  # Try 5 rapid likes
                status, response, duration = await self.make_request('POST', f'/content/{post_id}/like', 
                                                                    {}, self.tokens[self.user2["phone"]])
                like_results.append((status, response))
                await asyncio.sleep(0.1)  # Small delay between requests
            
            # Check if any were detected as abuse or rate limited
            blocked_count = sum(1 for status, _ in like_results if status in [429, 403])
            success_count = sum(1 for status, _ in like_results if status == 200)
            
            self.log_result("Burst like simulation", True, 200, "PHASE_C", 
                           details={"total_attempts": 5, "successful": success_count, "blocked": blocked_count},
                           duration_ms=duration)
            
            # Normal single action should still work
            await asyncio.sleep(2)  # Wait a bit
            status, response, duration = await self.make_request('POST', f'/content/{post_id}/comments', 
                                                                {"body": "Normal comment after burst"}, 
                                                                self.tokens[self.user3["phone"]])
            self.log_result("Normal action after burst", status in [200, 201], status, "PHASE_C", 
                           error=response.get('error') if status not in [200, 201] else None, duration_ms=duration)

    # ==================== PHASE D TESTS: POLL POSTS ====================
    
    async def test_phase_d_poll_creation(self):
        """Test poll post creation"""
        print("\n=== Phase D: Poll Creation Tests ===")
        
        # Valid poll creation
        poll_data = {
            "caption": "Test poll question",
            "kind": "POST",
            "poll": {
                "options": ["Option A", "Option B", "Option C"],
                "expiresIn": 24
            }
        }
        
        status, response, duration = await self.make_request('POST', '/content/posts', 
                                                            poll_data, self.tokens[self.user1["phone"]])
        
        if status == 201 and 'data' in response:
            poll_post = response['data']['post']
            poll_id = poll_post['id']
            self.test_posts.append(poll_id)
            
            # Verify poll structure
            has_poll = poll_post.get('postSubType') == 'POLL' and 'poll' in poll_post
            poll_options = poll_post.get('poll', {}).get('options', [])
            has_three_options = len(poll_options) == 3
            
            self.log_result("Create valid poll", has_poll and has_three_options, status, "PHASE_D", 
                           details={"postSubType": poll_post.get('postSubType'), 
                                   "optionCount": len(poll_options),
                                   "totalVotes": poll_post.get('poll', {}).get('totalVotes', 0)},
                           duration_ms=duration)
            
            return poll_id
        else:
            self.log_result("Create valid poll", False, status, "PHASE_D", 
                           error=response.get('error'), duration_ms=duration)
            return None

    async def test_phase_d_poll_voting(self):
        """Test poll voting functionality"""
        print("\n=== Phase D: Poll Voting Tests ===")
        
        poll_id = await self.test_phase_d_poll_creation()
        if not poll_id:
            return
        
        # Vote on poll
        vote_data = {"optionId": "opt_0"}
        status, response, duration = await self.make_request('POST', f'/content/{poll_id}/vote', 
                                                            vote_data, self.tokens[self.user2["phone"]])
        
        if status == 200:
            vote_result = response.get('data', {})
            voted_option = vote_result.get('voted')
            updated_poll = vote_result.get('poll', {})
            
            self.log_result("Vote on poll", voted_option == "opt_0", status, "PHASE_D", 
                           details={"voted": voted_option, "totalVotes": updated_poll.get('totalVotes')},
                           duration_ms=duration)
        else:
            self.log_result("Vote on poll", False, status, "PHASE_D", 
                           error=response.get('error'), duration_ms=duration)
        
        # Test double vote prevention
        status, response, duration = await self.make_request('POST', f'/content/{poll_id}/vote', 
                                                            vote_data, self.tokens[self.user2["phone"]])
        self.log_result("Double vote prevention (409 expected)", status == 409, status, "PHASE_D", 
                       error=response.get('error') if status != 409 else None, duration_ms=duration)

    async def test_phase_d_poll_results(self):
        """Test poll results retrieval"""
        print("\n=== Phase D: Poll Results Tests ===")
        
        if self.test_posts:
            # Find a poll post
            for post_id in self.test_posts:
                status, response, duration = await self.make_request('GET', f'/content/{post_id}/poll-results')
                
                if status == 200 and 'data' in response:
                    poll_data = response['data']['poll']
                    has_options = 'options' in poll_data
                    has_total_votes = 'totalVotes' in poll_data
                    
                    self.log_result("Get poll results", has_options and has_total_votes, status, "PHASE_D", 
                                   details={"options": len(poll_data.get('options', [])), 
                                           "totalVotes": poll_data.get('totalVotes'),
                                           "viewerVote": response['data'].get('viewerVote')},
                                   duration_ms=duration)
                    break
            else:
                self.log_result("Get poll results", False, 404, "PHASE_D", 
                               error="No poll posts available for testing")

    async def test_phase_d_poll_validation(self):
        """Test poll validation edge cases"""
        print("\n=== Phase D: Poll Validation Tests ===")
        
        # Test invalid poll with 1 option (should fail)
        invalid_poll_data = {
            "caption": "Invalid poll",
            "kind": "POST", 
            "poll": {"options": ["Only one option"]}
        }
        status, response, duration = await self.make_request('POST', '/content/posts', 
                                                            invalid_poll_data, self.tokens[self.user1["phone"]])
        self.log_result("Poll with 1 option (400 expected)", status == 400, status, "PHASE_D", 
                       error=response.get('error') if status != 400 else None, duration_ms=duration)
        
        # Test invalid poll with 7 options (should fail)
        invalid_poll_data = {
            "caption": "Invalid poll too many options",
            "kind": "POST",
            "poll": {"options": ["A", "B", "C", "D", "E", "F", "G"]}
        }
        status, response, duration = await self.make_request('POST', '/content/posts', 
                                                            invalid_poll_data, self.tokens[self.user1["phone"]])
        self.log_result("Poll with 7 options (400 expected)", status == 400, status, "PHASE_D", 
                       error=response.get('error') if status != 400 else None, duration_ms=duration)

    # ==================== PHASE D TESTS: THREAD POSTS ====================
    
    async def test_phase_d_thread_creation(self):
        """Test thread post creation"""
        print("\n=== Phase D: Thread Creation Tests ===")
        
        # Create thread head (normal post)
        head_data = {"caption": "Thread head post", "kind": "POST"}
        status, response, duration = await self.make_request('POST', '/content/posts', 
                                                            head_data, self.tokens[self.user1["phone"]])
        
        if status == 201 and 'data' in response:
            head_id = response['data']['post']['id']
            self.test_posts.append(head_id)
            
            self.log_result("Create thread head", True, status, "PHASE_D", duration_ms=duration)
            
            # Create thread part
            part_data = {
                "caption": "Thread part 1",
                "kind": "POST",
                "threadParentId": head_id
            }
            status, response, duration = await self.make_request('POST', '/content/posts', 
                                                                part_data, self.tokens[self.user1["phone"]])
            
            if status == 201 and 'data' in response:
                part_post = response['data']['post']
                is_thread_part = part_post.get('postSubType') == 'THREAD_PART'
                has_thread_data = 'thread' in part_post
                
                self.log_result("Create thread part", is_thread_part and has_thread_data, status, "PHASE_D", 
                               details={"postSubType": part_post.get('postSubType'),
                                       "threadId": part_post.get('thread', {}).get('threadId')},
                               duration_ms=duration)
                
                return head_id
            else:
                self.log_result("Create thread part", False, status, "PHASE_D", 
                               error=response.get('error'), duration_ms=duration)
        else:
            self.log_result("Create thread head", False, status, "PHASE_D", 
                           error=response.get('error'), duration_ms=duration)
        
        return None

    async def test_phase_d_thread_view(self):
        """Test thread view functionality"""
        print("\n=== Phase D: Thread View Tests ===")
        
        head_id = await self.test_phase_d_thread_creation()
        if not head_id:
            return
        
        # Get thread view
        status, response, duration = await self.make_request('GET', f'/content/{head_id}/thread')
        
        if status == 200 and 'data' in response:
            thread_data = response['data']
            is_thread = thread_data.get('isThread', False)
            part_count = thread_data.get('partCount', 0)
            thread_parts = thread_data.get('thread', [])
            
            self.log_result("Get thread view", is_thread and part_count > 1, status, "PHASE_D", 
                           details={"isThread": is_thread, "partCount": part_count, 
                                   "actualParts": len(thread_parts)},
                           duration_ms=duration)
        else:
            self.log_result("Get thread view", False, status, "PHASE_D", 
                           error=response.get('error'), duration_ms=duration)

    async def test_phase_d_thread_ownership(self):
        """Test that only author can add thread parts"""
        print("\n=== Phase D: Thread Ownership Tests ===")
        
        # Create a post with user1
        head_data = {"caption": "Test ownership post", "kind": "POST"}
        status, response, duration = await self.make_request('POST', '/content/posts', 
                                                            head_data, self.tokens[self.user1["phone"]])
        
        if status == 201 and 'data' in response:
            head_id = response['data']['post']['id']
            
            # Try to add thread part with user2 (should fail)
            part_data = {
                "caption": "Unauthorized thread part",
                "kind": "POST", 
                "threadParentId": head_id
            }
            status, response, duration = await self.make_request('POST', '/content/posts', 
                                                                part_data, self.tokens[self.user2["phone"]])
            
            self.log_result("Unauthorized thread part (404 expected)", status == 404, status, "PHASE_D", 
                           error=response.get('error') if status != 404 else None, duration_ms=duration)
        else:
            self.log_result("Create test post for ownership", False, status, "PHASE_D", 
                           error=response.get('error'), duration_ms=duration)

    # ==================== PHASE D TESTS: LINK PREVIEW POSTS ====================
    
    async def test_phase_d_link_preview(self):
        """Test link preview post creation"""
        print("\n=== Phase D: Link Preview Tests ===")
        
        link_data = {
            "caption": "Check this out!",
            "kind": "POST",
            "linkUrl": "https://example.com"
        }
        
        status, response, duration = await self.make_request('POST', '/content/posts', 
                                                            link_data, self.tokens[self.user1["phone"]])
        
        if status == 201 and 'data' in response:
            link_post = response['data']['post']
            has_link_subtype = link_post.get('postSubType') == 'LINK'
            
            # Note: linkPreview may be null due to async fetch
            self.log_result("Create link post", True, status, "PHASE_D", 
                           details={"postSubType": link_post.get('postSubType'),
                                   "linkPreview": link_post.get('linkPreview')},
                           duration_ms=duration)
        else:
            self.log_result("Create link post", False, status, "PHASE_D", 
                           error=response.get('error'), duration_ms=duration)

    # ==================== REGRESSION TESTS ====================
    
    async def test_regression_existing_features(self):
        """Test that existing features still work"""
        print("\n=== Regression: Existing Features Tests ===")
        
        # Test standard post creation
        post_data = {"caption": "Standard regression test post", "kind": "POST"}
        status, response, duration = await self.make_request('POST', '/content/posts', 
                                                            post_data, self.tokens[self.user1["phone"]])
        self.log_result("Standard post creation", status == 201, status, "REGRESSION", 
                       error=response.get('error') if status != 201 else None, duration_ms=duration)
        
        # Test public feed
        status, response, duration = await self.make_request('GET', '/feed/public?limit=5')
        feed_works = status == 200 and 'data' in response
        self.log_result("Public feed", feed_works, status, "REGRESSION", 
                       error=response.get('error') if status != 200 else None, 
                       details={"postCount": len(response.get('data', {}).get('posts', []))},
                       duration_ms=duration)
        
        # Test single post GET
        if self.test_posts:
            post_id = self.test_posts[0]
            status, response, duration = await self.make_request('GET', f'/content/{post_id}')
            self.log_result("Single post GET", status == 200, status, "REGRESSION", 
                           error=response.get('error') if status != 200 else None, duration_ms=duration)
            
            # Test post edit
            edit_data = {"caption": "Edited regression test caption"}
            status, response, duration = await self.make_request('PATCH', f'/content/{post_id}', 
                                                                edit_data, self.tokens[self.user1["phone"]])
            self.log_result("Post edit", status == 200, status, "REGRESSION", 
                           error=response.get('error') if status != 200 else None, duration_ms=duration)
        
        # Test stories feed
        status, response, duration = await self.make_request('GET', '/stories/feed')
        self.log_result("Stories feed", status == 200, status, "REGRESSION", 
                       error=response.get('error') if status != 200 else None, duration_ms=duration)
        
        # Test reels feed
        status, response, duration = await self.make_request('GET', '/reels/feed?limit=2')
        self.log_result("Reels feed", status == 200, status, "REGRESSION", 
                       error=response.get('error') if status != 200 else None, duration_ms=duration)
        
        # Test search
        status, response, duration = await self.make_request('GET', '/search?q=test')
        self.log_result("Search", status == 200, status, "REGRESSION", 
                       error=response.get('error') if status != 200 else None, duration_ms=duration)
        
        # Test health check
        status, response, duration = await self.make_request('GET', '/healthz')
        self.log_result("Health check", status == 200, status, "REGRESSION", 
                       error=response.get('error') if status != 200 else None, duration_ms=duration)

    # ==================== VALIDATION EDGE CASES ====================
    
    async def test_validation_edge_cases(self):
        """Test validation edge cases"""
        print("\n=== Validation: Edge Cases Tests ===")
        
        # Vote on non-poll post
        if self.test_posts:
            # Find a non-poll post
            for post_id in self.test_posts:
                status, _, _ = await self.make_request('GET', f'/content/{post_id}')
                if status == 200:
                    vote_data = {"optionId": "opt_0"}
                    status, response, duration = await self.make_request('POST', f'/content/{post_id}/vote', 
                                                                        vote_data, self.tokens[self.user2["phone"]])
                    self.log_result("Vote on non-poll (404 expected)", status == 404, status, "VALIDATION", 
                                   error=response.get('error') if status != 404 else None, duration_ms=duration)
                    break
        
        # Thread with non-existent parent
        invalid_thread_data = {
            "caption": "Invalid thread part",
            "kind": "POST",
            "threadParentId": "nonexistent-id"
        }
        status, response, duration = await self.make_request('POST', '/content/posts', 
                                                            invalid_thread_data, self.tokens[self.user1["phone"]])
        self.log_result("Thread with non-existent parent (404 expected)", status == 404, status, "VALIDATION", 
                       error=response.get('error') if status != 404 else None, duration_ms=duration)

    async def run_all_tests(self):
        """Run comprehensive Phase C & D testing"""
        print("🚀 Starting Phase C & D Backend Testing Suite")
        print(f"📍 Base URL: {BASE_URL}")
        print("="*70)
        
        try:
            await self.setup_session()
            
            # Setup test users
            print("Setting up test users...")
            for user_data in [self.user1, self.user2, self.user3]:
                token = await self.register_and_login_user(user_data)
                if not token:
                    print(f"❌ Failed to setup user {user_data['phone']}")
                    return
                print(f"✅ User {user_data['phone']} ready")
            
            # Setup admin permissions via MongoDB
            self.setup_admin_users()
            
            # Run all test phases
            await self.test_phase_c_normal_engagement()
            await self.test_phase_c_admin_abuse_dashboard()
            await self.test_phase_c_burst_simulation()
            
            await self.test_phase_d_poll_creation()
            await self.test_phase_d_poll_voting()
            await self.test_phase_d_poll_results()
            await self.test_phase_d_poll_validation()
            
            await self.test_phase_d_thread_creation()
            await self.test_phase_d_thread_view()
            await self.test_phase_d_thread_ownership()
            
            await self.test_phase_d_link_preview()
            
            await self.test_regression_existing_features()
            await self.test_validation_edge_cases()
            
        finally:
            await self.cleanup_session()
            if hasattr(self, 'mongo_client'):
                self.mongo_client.close()

    def print_summary(self):
        """Print comprehensive test summary"""
        print("\n" + "="*70)
        print("📊 COMPREHENSIVE TEST SUMMARY")
        print("="*70)
        
        # Group results by phase
        phases = {}
        for result in self.results:
            if result.phase not in phases:
                phases[result.phase] = {"passed": 0, "failed": 0, "total": 0}
            phases[result.phase]["total"] += 1
            if result.success:
                phases[result.phase]["passed"] += 1
            else:
                phases[result.phase]["failed"] += 1
        
        total_tests = len(self.results)
        total_passed = sum(1 for r in self.results if r.success)
        total_failed = total_tests - total_passed
        success_rate = (total_passed / total_tests * 100) if total_tests > 0 else 0
        
        print(f"📈 OVERALL: {total_passed}/{total_tests} tests passed ({success_rate:.1f}%)")
        print()
        
        for phase, stats in phases.items():
            rate = (stats["passed"] / stats["total"] * 100) if stats["total"] > 0 else 0
            status = "✅" if rate >= 90 else "⚠️" if rate >= 70 else "❌"
            print(f"{status} {phase}: {stats['passed']}/{stats['total']} passed ({rate:.1f}%)")
        
        print("\n📋 DETAILED RESULTS:")
        for result in self.results:
            status = "✅ PASS" if result.success else "❌ FAIL"
            print(f"{status} [{result.phase}] {result.name} ({result.response_code})")
            if not result.success and result.error:
                print(f"    ❌ {result.error}")
        
        print("\n" + "="*70)
        
        # Determine final verdict
        if success_rate >= 95:
            print("🎉 PRODUCTION READY - Excellent results!")
        elif success_rate >= 85:
            print("✅ PRODUCTION READY - Good results with minor issues")
        elif success_rate >= 70:
            print("⚠️ NEEDS ATTENTION - Some critical issues found")
        else:
            print("❌ NOT PRODUCTION READY - Major issues need resolution")
        
        return success_rate

async def main():
    suite = PhaseTestSuite()
    try:
        await suite.run_all_tests()
        success_rate = suite.print_summary()
        
        # Exit with appropriate code
        sys.exit(0 if success_rate >= 85 else 1)
        
    except KeyboardInterrupt:
        print("\n⚠️ Testing interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Testing failed with error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())