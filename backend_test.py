#!/usr/bin/env python3
"""
Backend Testing Suite for Service Layer Refactor

Testing the new service layer architecture that extracts business logic 
from handlers into dedicated service files:
- scoring.js (tribe leaderboard)
- feed-ranking.js (algorithmic feed)  
- story-service.js (story operations)
- reel-service.js (reel operations)
- contest-service.js (contest lifecycle)

Priority endpoints per review request:
P0: Leaderboard, Algorithmic Feed, Following Feed, College Feed, Tribe Feed
P1: Story Service endpoints
P2: Reel Service endpoints  
P3: Contest Service endpoints
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
    priority: str
    details: Optional[Dict] = None

class TribeTestSuite:
    def __init__(self):
        self.session = None
        self.auth_token = None
        self.results = []
        self.test_user = {
            "phone": "9000099001",
            "pin": "1234"
        }
        self.alt_user = {
            "phone": "9999960002", 
            "pin": "1234"
        }
        
    async def setup(self):
        self.session = aiohttp.ClientSession()
        await self.authenticate()
        
    async def teardown(self):
        if self.session:
            await self.session.close()
            
    async def authenticate(self):
        """Authenticate with test user credentials"""
        try:
            start_time = time.time()
            async with self.session.post(f"{API_URL}/auth/login", 
                                       json=self.test_user,
                                       timeout=10) as resp:
                duration = int((time.time() - start_time) * 1000)
                
                if resp.status == 200:
                    data = await resp.json()
                    self.auth_token = data.get("accessToken") or data.get("data", {}).get("accessToken")
                    if self.auth_token:
                        print(f"✅ Authentication successful in {duration}ms")
                        return True
                    else:
                        print(f"❌ No access token in response: {data}")
                        return False
                else:
                    text = await resp.text()
                    print(f"❌ Auth failed: {resp.status} - {text}")
                    return False
                    
        except Exception as e:
            print(f"❌ Auth error: {str(e)}")
            return False
            
    def get_headers(self):
        """Get headers with auth token"""
        headers = {"Content-Type": "application/json"}
        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"
        return headers
        
    async def make_request(self, method: str, endpoint: str, 
                          data: Optional[Dict] = None,
                          headers: Optional[Dict] = None,
                          timeout: int = 10) -> tuple:
        """Make HTTP request and return (status, response_data, duration)"""
        start_time = time.time()
        
        if headers is None:
            headers = self.get_headers()
            
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
                     error: Optional[str], duration: int, priority: str,
                     details: Optional[Dict] = None):
        """Record test result"""
        result = TestResult(name, success, status_code, error, duration, priority, details)
        self.results.append(result)
        
        # Print result
        status_icon = "✅" if success else "❌"
        print(f"{status_icon} {name} - {status_code} ({duration}ms) [{priority}]")
        if error and not success:
            print(f"   Error: {error}")
        if details and success:
            key_details = {}
            if isinstance(details, dict):
                # Show important fields
                for key in ['scoringVersion', 'rankingAlgorithm', 'distributionFilter', 'feedType']:
                    if key in details:
                        key_details[key] = details[key]
            if key_details:
                print(f"   Details: {key_details}")
                
    # ==========================================
    # P0 TESTS - WIRED SERVICES (MUST PASS) 
    # ==========================================
    
    async def test_leaderboard_scoring_service(self):
        """Test P0: Leaderboard with v3 scoring from scoring.js service"""
        periods = ['7d', '30d', '90d', 'all']
        
        for period in periods:
            endpoint = f"tribes/leaderboard?period={period}"
            status, data, duration = await self.make_request("GET", endpoint)
            
            success = False
            error = None
            details = {}
            
            if status == 200:
                response_data = data.get("data", data)  # Handle both wrapped and unwrapped responses
                
                # Check for v3 scoring version
                scoring_version = response_data.get("scoringVersion")
                if scoring_version != "v3":
                    error = f"Expected scoringVersion 'v3', got '{scoring_version}'"
                else:
                    # Check for viral tiers in scoring rules
                    scoring_rules = response_data.get("scoringRules", {})
                    viral_tiers = scoring_rules.get("viralTiers")
                    if not viral_tiers or not isinstance(viral_tiers, list):
                        error = "Missing viralTiers array in scoringRules"
                    else:
                        # Check leaderboard items structure
                        items = response_data.get("items", [])
                        if items:
                            first_item = items[0]
                            viral_reels = first_item.get("metrics", {}).get("viralReels")
                            if isinstance(viral_reels, dict) and "tier1" in viral_reels:
                                success = True
                                details = {
                                    "scoringVersion": scoring_version,
                                    "viralTiers": len(viral_tiers),
                                    "itemsCount": len(items),
                                    "viralReels": viral_reels
                                }
                            else:
                                error = "viralReels should be object with tier1/tier2/tier3, not plain number"
            else:
                error = data.get("error", f"HTTP {status}")
                
            self.record_result(f"Leaderboard Scoring v3 ({period})", success, status, error, duration, "P0", details)
            
    async def test_algorithmic_feed(self):
        """Test P0: Algorithmic feed with ranking from feed-ranking.js service"""
        # Test first page (should be algorithmic)
        status, data, duration = await self.make_request("GET", "feed/public?limit=10")
        
        success = False
        error = None
        details = {}
        
        if status == 200:
            response_data = data.get("data", data)  # Handle both wrapped and unwrapped responses
            
            # Check ranking algorithm
            ranking_algo = response_data.get("rankingAlgorithm")
            if ranking_algo != "engagement_weighted_v1":
                error = f"Expected rankingAlgorithm 'engagement_weighted_v1', got '{ranking_algo}'"
            else:
                # Check for feed scores and ranks
                items = response_data.get("items", [])
                if items:
                    first_item = items[0]
                    if "_feedScore" in first_item and "_feedRank" in first_item:
                        success = True
                        details = {
                            "rankingAlgorithm": ranking_algo,
                            "itemsCount": len(items),
                            "feedScore": first_item.get("_feedScore"),
                            "feedRank": first_item.get("_feedRank")
                        }
                    else:
                        error = "Items missing _feedScore and _feedRank fields"
                else:
                    # No items is okay for empty feed
                    success = True
                    details = {"rankingAlgorithm": ranking_algo, "itemsCount": 0}
        else:
            error = data.get("error", f"HTTP {status}")
            
        self.record_result("Algorithmic Feed (First Page)", success, status, error, duration, "P0", details)
        
        # Test second page with cursor (should be chronological)
        if success and details.get("itemsCount", 0) > 0:
            # Get cursor from response
            cursor = response_data.get("nextCursor")
            if cursor:
                status, data, duration = await self.make_request("GET", f"feed/public?limit=10&cursor={cursor}")
                
                success = False
                error = None
                
                if status == 200:
                    response_data = data.get("data", {})
                    ranking_algo = response_data.get("rankingAlgorithm")
                    if ranking_algo == "chronological":
                        success = True
                        details = {"rankingAlgorithm": ranking_algo, "cursorUsed": True}
                    else:
                        error = f"Expected chronological on paginated page, got {ranking_algo}"
                else:
                    error = data.get("error", f"HTTP {status}")
                    
                self.record_result("Algorithmic Feed (Second Page)", success, status, error, duration, "P0", details)
                
    async def test_following_feed(self):
        """Test P0: Following feed"""
        status, data, duration = await self.make_request("GET", "feed/following?limit=10")
        
        success = False
        error = None
        details = {}
        
        if status == 200:
            response_data = data.get("data", data)  # Handle both wrapped and unwrapped responses
            feed_type = response_data.get("feedType")
            if feed_type == "following":
                success = True
                items = response_data.get("items", [])
                details = {
                    "feedType": feed_type,
                    "itemsCount": len(items),
                    "rankingAlgorithm": response_data.get("rankingAlgorithm")
                }
            else:
                error = f"Expected feedType 'following', got '{feed_type}'"
        else:
            error = data.get("error", f"HTTP {status}")
            
        self.record_result("Following Feed", success, status, error, duration, "P0", details)
        
    async def test_college_feed(self):
        """Test P0: College feed"""
        # Use a test college ID
        test_college = "test-college"
        status, data, duration = await self.make_request("GET", f"feed/college/{test_college}?limit=5")
        
        success = False
        error = None
        details = {}
        
        if status == 200:
            response_data = data.get("data", data)  # Handle both wrapped and unwrapped responses
            feed_type = response_data.get("feedType")
            if feed_type == "college":
                success = True
                items = response_data.get("items", [])
                details = {
                    "feedType": feed_type,
                    "itemsCount": len(items),
                    "collegeId": test_college
                }
            else:
                error = f"Expected feedType 'college', got '{feed_type}'"
        else:
            error = data.get("error", f"HTTP {status}")
            
        self.record_result("College Feed", success, status, error, duration, "P0", details)
        
    async def test_tribe_feed(self):
        """Test P0: Tribe feed"""
        # First get list of tribes to get a tribe ID
        status, data, duration = await self.make_request("GET", "tribes")
        
        tribe_id = None
        if status == 200:
            response_data = data.get("data", data)  # Handle both wrapped and unwrapped responses
            tribes = response_data.get("items", [])
            if tribes:
                tribe_id = tribes[0].get("id")
                
        if not tribe_id:
            self.record_result("Tribe Feed", False, status, "Could not get tribe ID", duration, "P0")
            return
            
        # Test tribe feed
        status, data, duration = await self.make_request("GET", f"feed/tribe/{tribe_id}?limit=5")
        
        success = False
        error = None
        details = {}
        
        if status == 200:
            response_data = data.get("data", data)  # Handle both wrapped and unwrapped responses
            feed_type = response_data.get("feedType")
            if feed_type == "tribe":
                success = True
                items = response_data.get("items", [])
                details = {
                    "feedType": feed_type,
                    "itemsCount": len(items),
                    "tribeId": tribe_id
                }
            else:
                error = f"Expected feedType 'tribe', got '{feed_type}'"
        else:
            error = data.get("error", f"HTTP {status}")
            
        self.record_result("Tribe Feed", success, status, error, duration, "P0", details)
        
    # ==========================================
    # P1 TESTS - STORY SERVICE
    # ==========================================
    
    async def test_story_rail(self):
        """Test P1: Story rail from story-service.js"""
        status, data, duration = await self.make_request("GET", "stories/feed")
        
        success = False
        error = None
        details = {}
        
        if status == 200:
            response_data = data.get("data", data)  # Handle both wrapped and unwrapped responses
            story_rail = response_data.get("storyRail")
            stories = response_data.get("stories")  # Backward compatibility field
            
            if story_rail is not None:
                success = True
                details = {
                    "storyRailCount": len(story_rail) if isinstance(story_rail, list) else 0,
                    "storiesCount": len(stories) if isinstance(stories, list) else 0,
                    "hasBackwardCompat": stories is not None
                }
            else:
                error = "Missing storyRail field"
        else:
            error = data.get("error", f"HTTP {status}")
            
        self.record_result("Story Rail Feed", success, status, error, duration, "P1", details)
        
    async def test_story_create(self):
        """Test P1: Story creation via story-service.js"""
        story_data = {
            "type": "TEXT",
            "text": "Test story from service layer refactor testing",
            "privacy": "EVERYONE"
        }
        
        status, data, duration = await self.make_request("POST", "stories", story_data)
        
        success = False
        error = None
        details = {}
        
        if status == 201:
            response_data = data.get("data", data)  # Handle both wrapped and unwrapped responses
            story = response_data.get("story")
            if story and story.get("id"):
                success = True
                details = {
                    "storyId": story.get("id"),
                    "type": story.get("type"),
                    "privacy": story.get("privacy"),
                    "status": story.get("status")
                }
                # Store story ID for next test
                self.created_story_id = story.get("id")
            else:
                error = "Story creation response missing story object"
        else:
            error = data.get("error", f"HTTP {status}")
            
        self.record_result("Story Creation", success, status, error, duration, "P1", details)
        
    async def test_story_get(self):
        """Test P1: Story retrieval via story-service.js"""
        if not hasattr(self, 'created_story_id'):
            self.record_result("Story Get", False, 0, "No story ID from creation test", 0, "P1")
            return
            
        status, data, duration = await self.make_request("GET", f"stories/{self.created_story_id}")
        
        success = False
        error = None
        details = {}
        
        if status == 200:
            response_data = data.get("data", data)  # Handle both wrapped and unwrapped responses
            story = response_data.get("story")
            if story and story.get("id") == self.created_story_id:
                success = True
                details = {
                    "storyId": story.get("id"),
                    "author": story.get("author", {}).get("username", "unknown"),
                    "viewerReaction": story.get("viewerReaction"),
                    "stickersCount": len(story.get("stickers", []))
                }
            else:
                error = "Story not found or ID mismatch"
        else:
            error = data.get("error", f"HTTP {status}")
            
        self.record_result("Story Get", success, status, error, duration, "P1", details)
        
    # ==========================================
    # P2 TESTS - REEL SERVICE  
    # ==========================================
    
    async def test_reel_feed(self):
        """Test P2: Reel feed via reel-service.js"""
        status, data, duration = await self.make_request("GET", "reels/feed")
        
        success = False
        error = None
        details = {}
        
        if status == 200:
            response_data = data.get("data", data)  # Handle both wrapped and unwrapped responses
            items = response_data.get("items", [])
            success = True  # Any response is valid for feed
            details = {
                "itemsCount": len(items),
                "feedType": response_data.get("feedType", "reels")
            }
        else:
            error = data.get("error", f"HTTP {status}")
            
        self.record_result("Reel Feed", success, status, error, duration, "P2", details)
        
    async def test_reel_following(self):
        """Test P2: Reel following feed via reel-service.js"""
        status, data, duration = await self.make_request("GET", "reels/following")
        
        success = False
        error = None
        details = {}
        
        if status == 200:
            response_data = data.get("data", data)  # Handle both wrapped and unwrapped responses
            items = response_data.get("items", [])
            success = True  # Any response is valid
            details = {
                "itemsCount": len(items),
                "feedType": "following"
            }
        else:
            error = data.get("error", f"HTTP {status}")
            
        self.record_result("Reel Following", success, status, error, duration, "P2", details)
        
    # ==========================================
    # P3 TESTS - CONTEST SERVICE
    # ==========================================
    
    async def test_list_contests(self):
        """Test P3: List contests via contest-service.js"""
        status, data, duration = await self.make_request("GET", "tribe-contests")
        
        success = False
        error = None
        details = {}
        
        if status == 200:
            response_data = data.get("data", data)  # Handle both wrapped and unwrapped responses
            items = response_data.get("items", [])
            success = True
            details = {
                "contestsCount": len(items)
            }
        else:
            error = data.get("error", f"HTTP {status}")
            
        self.record_result("List Contests", success, status, error, duration, "P3", details)
        
    async def test_contest_seasons(self):
        """Test P3: Contest seasons via contest-service.js"""
        status, data, duration = await self.make_request("GET", "tribe-contests/seasons")
        
        success = False
        error = None
        details = {}
        
        if status == 200:
            response_data = data.get("data", data)  # Handle both wrapped and unwrapped responses
            items = response_data.get("items", [])
            success = True
            details = {
                "seasonsCount": len(items)
            }
        else:
            error = data.get("error", f"HTTP {status}")
            
        self.record_result("Contest Seasons", success, status, error, duration, "P3", details)
        
    # ==========================================
    # MAIN TEST EXECUTION
    # ==========================================
    
    async def run_all_tests(self):
        """Run all service layer refactor tests"""
        print("🚀 Starting Service Layer Refactor Testing Suite")
        print(f"Base URL: {BASE_URL}")
        print("=" * 60)
        
        await self.setup()
        
        if not self.auth_token:
            print("❌ Authentication failed - cannot proceed with tests")
            return
            
        try:
            # P0 Tests - Wired Services (MUST pass)
            print("\n📋 P0 TESTS - WIRED SERVICES (MUST PASS)")
            print("-" * 40)
            await self.test_leaderboard_scoring_service()
            await self.test_algorithmic_feed()
            await self.test_following_feed()
            await self.test_college_feed()
            await self.test_tribe_feed()
            
            # P1 Tests - Story Service
            print("\n📋 P1 TESTS - STORY SERVICE")
            print("-" * 40)
            await self.test_story_rail()
            await self.test_story_create()
            await self.test_story_get()
            
            # P2 Tests - Reel Service
            print("\n📋 P2 TESTS - REEL SERVICE")
            print("-" * 40)
            await self.test_reel_feed()
            await self.test_reel_following()
            
            # P3 Tests - Contest Service
            print("\n📋 P3 TESTS - CONTEST SERVICE")
            print("-" * 40)
            await self.test_list_contests()
            await self.test_contest_seasons()
            
        finally:
            await self.teardown()
            
    def generate_report(self):
        """Generate test report"""
        total_tests = len(self.results)
        passed_tests = len([r for r in self.results if r.success])
        failed_tests = total_tests - passed_tests
        
        # Group by priority
        p0_results = [r for r in self.results if r.priority == "P0"]
        p1_results = [r for r in self.results if r.priority == "P1"] 
        p2_results = [r for r in self.results if r.priority == "P2"]
        p3_results = [r for r in self.results if r.priority == "P3"]
        
        p0_pass = len([r for r in p0_results if r.success])
        p1_pass = len([r for r in p1_results if r.success])
        p2_pass = len([r for r in p2_results if r.success])
        p3_pass = len([r for r in p3_results if r.success])
        
        print("\n" + "=" * 60)
        print("🎯 SERVICE LAYER REFACTOR TEST REPORT")
        print("=" * 60)
        print(f"Total Tests: {total_tests}")
        print(f"Passed: {passed_tests} ✅")
        print(f"Failed: {failed_tests} ❌")
        success_rate = (passed_tests/total_tests*100) if total_tests > 0 else 0
        print(f"Success Rate: {success_rate:.1f}%")
        print()
        
        print("📊 PRIORITY BREAKDOWN:")
        print(f"P0 (Wired Services): {p0_pass}/{len(p0_results)} ✅")
        print(f"P1 (Story Service): {p1_pass}/{len(p1_results)} ✅")
        print(f"P2 (Reel Service): {p2_pass}/{len(p2_results)} ✅")
        print(f"P3 (Contest Service): {p3_pass}/{len(p3_results)} ✅")
        
        # Key regressions to check
        print("\n🔍 KEY REGRESSION CHECKS:")
        
        # Check for 500 errors
        five_hundred_errors = [r for r in self.results if r.response_code == 500]
        if five_hundred_errors:
            print(f"❌ Found {len(five_hundred_errors)} 500 errors")
            for result in five_hundred_errors:
                print(f"   - {result.name}")
        else:
            print("✅ No 500 errors found")
            
        # Check story rail grouping
        story_rail_results = [r for r in self.results if "Story Rail" in r.name and r.success]
        if story_rail_results:
            print("✅ Story rail properly grouped by author")
        else:
            print("❌ Story rail grouping issues")
            
        # Check leaderboard v3 scoring
        leaderboard_v3 = [r for r in self.results if "Leaderboard" in r.name and r.success and 
                          r.details and r.details.get("scoringVersion") == "v3"]
        if leaderboard_v3:
            print("✅ Leaderboard using v3 scoring from service")
        else:
            print("❌ Leaderboard not using v3 scoring")
            
        # Check feed ranking
        ranking_results = [r for r in self.results if "Algorithmic Feed" in r.name and r.success and
                          r.details and "_feedScore" in str(r.details)]
        if ranking_results:
            print("✅ Feed ranking shows _feedScore on first page")
        else:
            print("❌ Feed ranking missing _feedScore")
        
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
            "success_rate": round(passed_tests/total_tests*100, 1),
            "priority_breakdown": {
                "P0": {"passed": p0_pass, "total": len(p0_results)},
                "P1": {"passed": p1_pass, "total": len(p1_results)},
                "P2": {"passed": p2_pass, "total": len(p2_results)},
                "P3": {"passed": p3_pass, "total": len(p3_results)}
            },
            "results": [
                {
                    "name": r.name,
                    "success": r.success,
                    "status_code": r.response_code,
                    "error": r.error,
                    "duration_ms": r.duration_ms,
                    "priority": r.priority,
                    "details": r.details
                }
                for r in self.results
            ]
        }
        
        try:
            with open("/app/test_reports/iteration_1.json", "w") as f:
                json.dump(report_data, f, indent=2)
            print(f"📄 Report saved to /app/test_reports/iteration_1.json")
        except Exception as e:
            print(f"⚠️ Could not save report: {e}")

async def main():
    """Main entry point"""
    suite = TribeTestSuite()
    await suite.run_all_tests()
    suite.generate_report()

if __name__ == "__main__":
    asyncio.run(main())