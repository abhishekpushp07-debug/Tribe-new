#!/usr/bin/env python3
"""
Focused Phase C & D Testing Suite - Key Features Only

Testing the most critical functionality to understand current state:
- Anti-abuse admin endpoints
- Poll creation and voting
- Thread creation
- Basic regression features
"""

import asyncio
import aiohttp
import json
import time
from pymongo import MongoClient

BASE_URL = "https://media-platform-api.preview.emergentagent.com"
API_URL = f"{BASE_URL}/api"

class FocusedTestSuite:
    def __init__(self):
        self.session = None
        self.token = None
        self.user_id = None
        self.admin_token = None
        
        # MongoDB connection for admin setup
        self.mongo_client = MongoClient('mongodb://localhost:27017')
        self.db = self.mongo_client['your_database_name']

    async def setup_session(self):
        timeout = aiohttp.ClientTimeout(total=30)
        self.session = aiohttp.ClientSession(timeout=timeout)

    async def cleanup_session(self):
        if self.session:
            await self.session.close()

    async def make_request(self, method: str, endpoint: str, data: dict = None, token: str = None):
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'
        
        start = time.time()
        try:
            kwargs = {'headers': headers}
            if data:
                kwargs['data'] = json.dumps(data)
                
            async with self.session.request(method, f"{API_URL}{endpoint}", **kwargs) as resp:
                duration = int((time.time() - start) * 1000)
                try:
                    response_data = await resp.json()
                except:
                    response_data = {"error": "Invalid JSON response"}
                return resp.status, response_data, duration
        except Exception as e:
            duration = int((time.time() - start) * 1000)
            return 0, {"error": str(e)}, duration

    async def setup_user(self):
        """Setup a single test user"""
        print("Setting up test user...")
        
        # Login/register user
        status, response, _ = await self.make_request('POST', '/auth/login', {
            "phone": "7777000001",
            "pin": "1234"
        })
        
        if status != 200:
            status, response, _ = await self.make_request('POST', '/auth/register', {
                "phone": "7777000001",
                "pin": "1234",
                "displayName": "Test User Phase"
            })
        
        if status in [200, 201]:
            self.token = response.get('accessToken')
            self.user_id = response.get('user', {}).get('id')
            
            # Set age to ADULT
            await self.make_request('PATCH', '/me/age', {"birthYear": 1995}, self.token)
            await self.make_request('POST', '/legal/accept', {"version": "1.0"}, self.token)
            
            # Make admin in MongoDB
            try:
                self.db.users.update_one(
                    {'phone': "7777000001"},
                    {'$set': {'role': 'ADMIN', 'ageStatus': 'ADULT'}}
                )
                print("✅ User set as ADMIN")
            except Exception as e:
                print(f"⚠️ MongoDB setup failed: {e}")
            
            self.admin_token = self.token
            return True
        
        print(f"❌ User setup failed: {status}, {response}")
        return False

    async def test_admin_abuse_endpoints(self):
        """Test Phase C admin abuse endpoints"""
        print("\n=== Testing Phase C: Admin Abuse Endpoints ===")
        
        # Test abuse dashboard
        status, response, duration = await self.make_request('GET', '/admin/abuse-dashboard?hours=24', 
                                                            None, self.admin_token)
        print(f"Admin abuse dashboard: {status} ({duration}ms)")
        if status == 200:
            print(f"  ✅ Data keys: {list(response.get('data', {}).keys())}")
        else:
            print(f"  ❌ Error: {response.get('error')}")
        
        # Test abuse log
        status, response, duration = await self.make_request('GET', '/admin/abuse-log?hours=24&limit=5', 
                                                            None, self.admin_token)
        print(f"Admin abuse log: {status} ({duration}ms)")
        if status == 200:
            print(f"  ✅ Log items: {len(response.get('data', {}).get('items', []))}")
        else:
            print(f"  ❌ Error: {response.get('error')}")

    async def test_poll_functionality(self):
        """Test Phase D poll functionality"""
        print("\n=== Testing Phase D: Poll Functionality ===")
        
        # Create poll
        poll_data = {
            "caption": "Test poll question - which is better?",
            "kind": "POST",
            "poll": {
                "options": ["Option A", "Option B", "Option C"],
                "expiresIn": 24
            }
        }
        
        status, response, duration = await self.make_request('POST', '/content/posts', 
                                                            poll_data, self.token)
        print(f"Create poll: {status} ({duration}ms)")
        
        if status == 201:
            poll_post = response.get('data', {}).get('post', {})
            poll_id = poll_post.get('id')
            post_sub_type = poll_post.get('postSubType')
            poll_info = poll_post.get('poll', {})
            
            print(f"  ✅ Poll created - ID: {poll_id}")
            print(f"  ✅ PostSubType: {post_sub_type}")
            print(f"  ✅ Poll options: {len(poll_info.get('options', []))}")
            print(f"  ✅ Total votes: {poll_info.get('totalVotes', 0)}")
            
            # Test voting
            if poll_id:
                vote_data = {"optionId": "opt_0"}
                status, response, duration = await self.make_request('POST', f'/content/{poll_id}/vote', 
                                                                    vote_data, self.token)
                print(f"Vote on poll: {status} ({duration}ms)")
                if status == 200:
                    print(f"  ✅ Voted successfully")
                else:
                    print(f"  ❌ Vote error: {response.get('error')}")
                
                # Test poll results
                status, response, duration = await self.make_request('GET', f'/content/{poll_id}/poll-results')
                print(f"Poll results: {status} ({duration}ms)")
                if status == 200:
                    poll_data = response.get('data', {}).get('poll', {})
                    print(f"  ✅ Results - Total votes: {poll_data.get('totalVotes')}")
                else:
                    print(f"  ❌ Results error: {response.get('error')}")
        else:
            print(f"  ❌ Poll creation failed: {response.get('error')}")

    async def test_thread_functionality(self):
        """Test Phase D thread functionality"""  
        print("\n=== Testing Phase D: Thread Functionality ===")
        
        # Create thread head
        head_data = {"caption": "This is a thread head", "kind": "POST"}
        status, response, duration = await self.make_request('POST', '/content/posts', 
                                                            head_data, self.token)
        print(f"Create thread head: {status} ({duration}ms)")
        
        if status == 201:
            head_post = response.get('data', {}).get('post', {})
            head_id = head_post.get('id')
            print(f"  ✅ Thread head created - ID: {head_id}")
            
            # Create thread part
            if head_id:
                await asyncio.sleep(1)  # Small delay
                part_data = {
                    "caption": "This is thread part 1", 
                    "kind": "POST",
                    "threadParentId": head_id
                }
                status, response, duration = await self.make_request('POST', '/content/posts', 
                                                                    part_data, self.token)
                print(f"Create thread part: {status} ({duration}ms)")
                
                if status == 201:
                    part_post = response.get('data', {}).get('post', {})
                    post_sub_type = part_post.get('postSubType')
                    thread_info = part_post.get('thread', {})
                    
                    print(f"  ✅ Thread part created")
                    print(f"  ✅ PostSubType: {post_sub_type}")
                    print(f"  ✅ ThreadId: {thread_info.get('threadId')}")
                    
                    # Test thread view
                    status, response, duration = await self.make_request('GET', f'/content/{head_id}/thread')
                    print(f"Thread view: {status} ({duration}ms)")
                    if status == 200:
                        thread_data = response.get('data', {})
                        is_thread = thread_data.get('isThread')
                        part_count = thread_data.get('partCount')
                        print(f"  ✅ Thread view - IsThread: {is_thread}, Parts: {part_count}")
                    else:
                        print(f"  ❌ Thread view error: {response.get('error')}")
                else:
                    print(f"  ❌ Thread part failed: {response.get('error')}")
        else:
            print(f"  ❌ Thread head failed: {response.get('error')}")

    async def test_link_preview(self):
        """Test Phase D link preview functionality"""
        print("\n=== Testing Phase D: Link Preview ===")
        
        link_data = {
            "caption": "Check this out!", 
            "kind": "POST",
            "linkUrl": "https://example.com"
        }
        
        status, response, duration = await self.make_request('POST', '/content/posts', 
                                                            link_data, self.token)
        print(f"Create link post: {status} ({duration}ms)")
        
        if status == 201:
            link_post = response.get('data', {}).get('post', {})
            post_sub_type = link_post.get('postSubType')
            link_preview = link_post.get('linkPreview')
            
            print(f"  ✅ Link post created")
            print(f"  ✅ PostSubType: {post_sub_type}")
            print(f"  ℹ️  LinkPreview: {link_preview} (may be null - async fetch)")
        else:
            print(f"  ❌ Link post failed: {response.get('error')}")

    async def test_basic_functionality(self):
        """Test basic regression features"""
        print("\n=== Testing Basic Functionality ===")
        
        # Health check
        status, response, duration = await self.make_request('GET', '/healthz')
        print(f"Health check: {status} ({duration}ms)")
        
        # Public feed 
        status, response, duration = await self.make_request('GET', '/feed/public?limit=3')
        print(f"Public feed: {status} ({duration}ms)")
        if status == 200:
            posts = response.get('data', {}).get('posts', [])
            print(f"  ✅ Posts in feed: {len(posts)}")
        
        # Search
        status, response, duration = await self.make_request('GET', '/search?q=test')
        print(f"Search: {status} ({duration}ms)")
        
        # Simple post creation
        post_data = {"caption": "Basic test post", "kind": "POST"}
        status, response, duration = await self.make_request('POST', '/content/posts', 
                                                            post_data, self.token)
        print(f"Basic post creation: {status} ({duration}ms)")
        if status != 201:
            print(f"  ❌ Error: {response.get('error')}")

    async def run_focused_tests(self):
        """Run focused test suite"""
        print("🎯 Starting Focused Phase C & D Testing")
        print(f"📍 Base URL: {BASE_URL}")
        print("="*50)
        
        try:
            await self.setup_session()
            
            if not await self.setup_user():
                print("❌ User setup failed, aborting tests")
                return False
                
            print("✅ User setup complete")
            
            await self.test_admin_abuse_endpoints()
            await self.test_poll_functionality() 
            await self.test_thread_functionality()
            await self.test_link_preview()
            await self.test_basic_functionality()
            
            print("\n" + "="*50)
            print("🎯 FOCUSED TESTING COMPLETE")
            
            return True
            
        finally:
            await self.cleanup_session()
            if hasattr(self, 'mongo_client'):
                self.mongo_client.close()

async def main():
    suite = FocusedTestSuite()
    try:
        success = await suite.run_focused_tests()
        return 0 if success else 1
    except Exception as e:
        print(f"❌ Testing failed: {e}")
        import traceback
        traceback.print_exc()
        return 1

if __name__ == "__main__":
    exit_code = asyncio.run(main())
    exit(exit_code)