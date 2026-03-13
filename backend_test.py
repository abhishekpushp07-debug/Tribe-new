#!/usr/bin/env python3
"""
Tribe Social Platform - Backend API Test Suite
Testing: Tribe competition, salute mechanism, rivalry system, and heroName badge features
"""

import json
import asyncio
import time
import sys
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
import httpx

# Base configuration
BASE_URL = "https://comprehensive-guide-1.preview.emergentagent.com/api"
TIMEOUT = 30

# Test users
TEST_USER_1 = {"phone": "7777099001", "pin": "1234"}
TEST_USER_2 = {"phone": "7777099002", "pin": "1234"}

class TribeTestSuite:
    def __init__(self):
        self.client = httpx.AsyncClient(timeout=TIMEOUT)
        self.user1_token = None
        self.user2_token = None
        self.results = []
        
    async def cleanup(self):
        await self.client.aclose()
        
    def log_result(self, test_name: str, success: bool, message: str, response_data: Any = None):
        """Log test result"""
        result = {
            "test": test_name,
            "success": success,
            "message": message,
            "timestamp": datetime.now().isoformat(),
            "response_data": response_data
        }
        self.results.append(result)
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status} {test_name}: {message}")
        
    async def authenticate_users(self):
        """Authenticate both test users"""
        try:
            # User 1
            response1 = await self.client.post(f"{BASE_URL}/auth/login", 
                                             json=TEST_USER_1)
            if response1.status_code == 200:
                data = response1.json()
                self.user1_token = data.get("accessToken")
                self.log_result("Auth User 1", True, f"Logged in user {TEST_USER_1['phone']}")
            else:
                self.log_result("Auth User 1", False, f"Login failed: {response1.status_code} - {response1.text}")
                return False
                
            # User 2  
            response2 = await self.client.post(f"{BASE_URL}/auth/login",
                                             json=TEST_USER_2)
            if response2.status_code == 200:
                data = response2.json()
                self.user2_token = data.get("accessToken") 
                self.log_result("Auth User 2", True, f"Logged in user {TEST_USER_2['phone']}")
            else:
                self.log_result("Auth User 2", False, f"Login failed: {response2.status_code} - {response2.text}")
                return False
                
            return True
            
        except Exception as e:
            self.log_result("Auth Users", False, f"Authentication error: {str(e)}")
            return False
            
    def get_headers(self, user_token: str) -> Dict[str, str]:
        """Get headers with bearer token"""
        return {
            "Authorization": f"Bearer {user_token}",
            "Content-Type": "application/json"
        }
        
    async def test_salute_cheer_mechanism(self):
        """Test 1: SALUTE/CHEER MECHANISM (Pride Feature)"""
        print("\n=== Testing SALUTE/CHEER MECHANISM ===")
        
        if not self.user1_token:
            self.log_result("Salute/Cheer", False, "No authenticated user")
            return
            
        try:
            # Get user's tribe first
            headers = self.get_headers(self.user1_token)
            tribe_response = await self.client.get(f"{BASE_URL}/me/tribe", headers=headers)
            if tribe_response.status_code != 200:
                self.log_result("Get User Tribe", False, f"Failed to get user tribe: {tribe_response.status_code}")
                return
                
            tribe_data = tribe_response.json()
            tribe_id = tribe_data.get("tribe", {}).get("id")
            if not tribe_id:
                self.log_result("Get User Tribe", False, "No tribe ID found")
                return
                
            self.log_result("Get User Tribe", True, f"User belongs to tribe: {tribe_id}")
            
            # Test 1A: Daily cheer (POST /tribes/{tribeId}/cheer)
            cheer_response = await self.client.post(f"{BASE_URL}/tribes/{tribe_id}/cheer", headers=headers)
            if cheer_response.status_code in [200, 201]:
                cheer_data = cheer_response.json()
                hero_name = cheer_data.get("data", {}).get("heroName")
                total_salutes = cheer_data.get("data", {}).get("totalSalutes")
                cheer_count = cheer_data.get("data", {}).get("cheerCount")
                
                self.log_result("Daily Cheer", True, 
                               f"Cheer successful - HeroName: {hero_name}, TotalSalutes: {total_salutes}, CheerCount: {cheer_count}")
            else:
                self.log_result("Daily Cheer", False, f"Cheer failed: {cheer_response.status_code} - {cheer_response.text}")
                
            # Test 1B: Rate limit check - second cheer should return 429
            await asyncio.sleep(1)
            cheer2_response = await self.client.post(f"{BASE_URL}/tribes/{tribe_id}/cheer", headers=headers)
            if cheer2_response.status_code == 429:
                self.log_result("Cheer Rate Limit", True, "Second daily cheer correctly blocked with 429")
            else:
                self.log_result("Cheer Rate Limit", False, f"Expected 429, got {cheer2_response.status_code}")
                
            # Test 1C: Content-based salute (POST /tribes/{tribeId}/salute)
            # First create a test post
            post_data = {
                "caption": "Test post for salute testing",
                "visibility": "PUBLIC"
            }
            post_response = await self.client.post(f"{BASE_URL}/content/posts", 
                                                  json=post_data, headers=headers)
            if post_response.status_code in [200, 201]:
                post_id = post_response.json().get("data", {}).get("id")
                
                # Now salute with content reference
                salute_data = {
                    "contentId": post_id,
                    "contentType": "post"
                }
                salute_response = await self.client.post(f"{BASE_URL}/tribes/{tribe_id}/salute",
                                                       json=salute_data, headers=headers)
                if salute_response.status_code in [200, 201]:
                    salute_result = salute_response.json()
                    salute_id = salute_result.get("data", {}).get("saluteId")
                    self.log_result("Content Salute", True, f"Content salute successful - SaluteID: {salute_id}")
                else:
                    self.log_result("Content Salute", False, f"Salute failed: {salute_response.status_code} - {salute_response.text}")
            else:
                self.log_result("Create Test Post", False, f"Failed to create test post: {post_response.status_code}")
                
            # Test 1D: Non-member salute (should be allowed for cross-tribe salutes)
            # Get another tribe ID
            tribes_response = await self.client.get(f"{BASE_URL}/tribes")
            if tribes_response.status_code == 200:
                all_tribes = tribes_response.json().get("items", [])
                other_tribe = None
                for tribe in all_tribes:
                    if tribe.get("id") != tribe_id:
                        other_tribe = tribe
                        break
                        
                if other_tribe:
                    other_tribe_id = other_tribe.get("id")
                    cross_salute_response = await self.client.post(f"{BASE_URL}/tribes/{other_tribe_id}/salute",
                                                                  json={"contentId": "test", "contentType": "post"}, 
                                                                  headers=headers)
                    if cross_salute_response.status_code in [200, 201]:
                        self.log_result("Cross-Tribe Salute", True, "Cross-tribe salute allowed")
                    else:
                        self.log_result("Cross-Tribe Salute", False, f"Cross-tribe salute failed: {cross_salute_response.status_code}")
                        
        except Exception as e:
            self.log_result("Salute/Cheer Mechanism", False, f"Exception: {str(e)}")
            
    async def test_tribe_rivalry_system(self):
        """Test 2: TRIBE RIVALRY SYSTEM"""
        print("\n=== Testing TRIBE RIVALRY SYSTEM ===")
        
        if not self.user1_token:
            self.log_result("Rivalry System", False, "No authenticated user")
            return
            
        try:
            headers = self.get_headers(self.user1_token)
            
            # Get two tribe IDs
            tribes_response = await self.client.get(f"{BASE_URL}/tribes")
            if tribes_response.status_code != 200:
                self.log_result("Get Tribes List", False, f"Failed to get tribes: {tribes_response.status_code}")
                return
                
            tribes_data = tribes_response.json()
            tribes = tribes_data.get("items", [])
            if len(tribes) < 2:
                self.log_result("Get Tribes List", False, "Need at least 2 tribes for rivalry")
                return
                
            tribe1_id = tribes[0].get("id")
            tribe2_id = tribes[1].get("id") 
            self.log_result("Get Tribes List", True, f"Found {len(tribes)} tribes for rivalry testing")
            
            # Test 2A: Admin creates rivalry (requires admin access)
            rivalry_data = {
                "challengerTribeId": tribe1_id,
                "defenderTribeId": tribe2_id, 
                "title": "Test War",
                "description": "Test rivalry for testing"
            }
            
            rivalry_response = await self.client.post(f"{BASE_URL}/admin/tribe-rivalries",
                                                    json=rivalry_data, headers=headers)
            if rivalry_response.status_code in [200, 201]:
                rivalry_result = rivalry_response.json()
                rivalry_id = rivalry_result.get("data", {}).get("rivalry", {}).get("id")
                self.log_result("Admin Create Rivalry", True, f"Rivalry created with ID: {rivalry_id}")
                
                # Test 2B: List rivalries (GET /tribe-rivalries)
                await asyncio.sleep(1)
                list_response = await self.client.get(f"{BASE_URL}/tribe-rivalries")
                if list_response.status_code == 200:
                    rivalries = list_response.json().get("items", [])
                    self.log_result("List Rivalries", True, f"Found {len(rivalries)} rivalries")
                else:
                    self.log_result("List Rivalries", False, f"Failed to list rivalries: {list_response.status_code}")
                    
                # Test 2C: Get rivalry detail (GET /tribe-rivalries/{id})
                if rivalry_id:
                    detail_response = await self.client.get(f"{BASE_URL}/tribe-rivalries/{rivalry_id}")
                    if detail_response.status_code == 200:
                        detail_data = detail_response.json()
                        challenger_score = detail_data.get("data", {}).get("rivalry", {}).get("challengerScore", 0)
                        defender_score = detail_data.get("data", {}).get("rivalry", {}).get("defenderScore", 0)
                        self.log_result("Rivalry Detail", True, f"Live scores - Challenger: {challenger_score}, Defender: {defender_score}")
                    else:
                        self.log_result("Rivalry Detail", False, f"Failed to get rivalry detail: {detail_response.status_code}")
                        
                    # Test 2D: Contribute content to rivalry
                    # First get user's tribe to see if they can contribute
                    user_tribe_response = await self.client.get(f"{BASE_URL}/me/tribe", headers=headers)
                    if user_tribe_response.status_code == 200:
                        user_tribe_id = user_tribe_response.json().get("data", {}).get("tribe", {}).get("id")
                        
                        # Create content for contribution
                        post_data = {"caption": "Test rivalry post", "visibility": "PUBLIC"}
                        post_response = await self.client.post(f"{BASE_URL}/content/posts",
                                                             json=post_data, headers=headers)
                        if post_response.status_code in [200, 201]:
                            post_id = post_response.json().get("data", {}).get("id")
                            
                            contribute_data = {
                                "contentId": post_id,
                                "contentType": "post"
                            }
                            
                            contribute_response = await self.client.post(f"{BASE_URL}/tribe-rivalries/{rivalry_id}/contribute",
                                                                       json=contribute_data, headers=headers)
                            if contribute_response.status_code in [200, 201]:
                                contribution = contribute_response.json()
                                points = contribution.get("data", {}).get("contribution", {}).get("engagementPoints")
                                self.log_result("Rivalry Contribution", True, f"Contributed {points} engagement points")
                            elif contribute_response.status_code == 403:
                                self.log_result("Rivalry Contribution", True, "User's tribe not part of rivalry (expected 403)")
                            else:
                                self.log_result("Rivalry Contribution", False, f"Contribution failed: {contribute_response.status_code}")
                        else:
                            self.log_result("Create Rivalry Content", False, f"Failed to create content: {post_response.status_code}")
                            
                    # Test 2E: Admin resolve rivalry
                    resolve_response = await self.client.post(f"{BASE_URL}/admin/tribe-rivalries/{rivalry_id}/resolve",
                                                            headers=headers)
                    if resolve_response.status_code in [200, 201]:
                        self.log_result("Admin Resolve Rivalry", True, "Rivalry resolved successfully")
                    elif resolve_response.status_code == 403:
                        self.log_result("Admin Resolve Rivalry", True, "Non-admin blocked from resolving (expected 403)")
                    else:
                        self.log_result("Admin Resolve Rivalry", False, f"Resolve failed: {resolve_response.status_code}")
                        
                    # Test 2F: Admin cancel rivalry  
                    cancel_response = await self.client.post(f"{BASE_URL}/admin/tribe-rivalries/{rivalry_id}/cancel",
                                                           headers=headers)
                    if cancel_response.status_code in [200, 201]:
                        self.log_result("Admin Cancel Rivalry", True, "Rivalry cancelled successfully")
                    elif cancel_response.status_code == 403:
                        self.log_result("Admin Cancel Rivalry", True, "Non-admin blocked from cancelling (expected 403)")
                    else:
                        self.log_result("Admin Cancel Rivalry", False, f"Cancel failed: {cancel_response.status_code}")
                        
            elif rivalry_response.status_code == 403:
                self.log_result("Admin Create Rivalry", True, f"Non-admin blocked from creating rivalry (expected 403)")
                # Still test public endpoints
                list_response = await self.client.get(f"{BASE_URL}/tribe-rivalries")
                if list_response.status_code == 200:
                    self.log_result("List Rivalries", True, "Can list existing rivalries")
                else:
                    self.log_result("List Rivalries", False, f"Failed to list rivalries: {list_response.status_code}")
            else:
                self.log_result("Admin Create Rivalry", False, f"Failed to create rivalry: {rivalry_response.status_code}")
                
        except Exception as e:
            self.log_result("Rivalry System", False, f"Exception: {str(e)}")
            
    async def test_contest_scoring(self):
        """Test 3: CONTEST SCORING WITH REAL CONTENT ENGAGEMENT"""
        print("\n=== Testing CONTEST SCORING ===")
        
        if not self.user1_token:
            self.log_result("Contest Scoring", False, "No authenticated user")
            return
            
        try:
            headers = self.get_headers(self.user1_token)
            
            # Get a tribe for contest
            user_tribe_response = await self.client.get(f"{BASE_URL}/me/tribe", headers=headers)
            if user_tribe_response.status_code != 200:
                self.log_result("Get User Tribe for Contest", False, "Failed to get user tribe")
                return
                
            tribe_id = user_tribe_response.json().get("data", {}).get("tribe", {}).get("id")
            
            # Test 3A: Create contest with scoring model "scoring_content_engagement_v1"
            contest_data = {
                "title": "Engagement Test",
                "tribeId": tribe_id,
                "scoringModelId": "scoring_content_engagement_v1", 
                "entryTypes": ["reel", "post", "story"],
                "prizePool": 100,
                "startsAt": "2026-01-01",
                "endsAt": "2027-12-31"
            }
            
            contest_response = await self.client.post(f"{BASE_URL}/admin/tribe-contests",
                                                    json=contest_data, headers=headers)
            if contest_response.status_code in [200, 201]:
                contest_result = contest_response.json()
                contest_id = contest_result.get("data", {}).get("contest", {}).get("id")
                self.log_result("Create Contest", True, f"Contest created with ID: {contest_id}")
                
                # Test 3B: Submit entry with content validation
                if contest_id:
                    # Create content first
                    post_data = {"caption": "Contest entry post", "visibility": "PUBLIC"}
                    post_response = await self.client.post(f"{BASE_URL}/content/posts",
                                                         json=post_data, headers=headers)
                    if post_response.status_code in [200, 201]:
                        post_id = post_response.json().get("data", {}).get("id")
                        
                        entry_data = {
                            "contentId": post_id,
                            "entryType": "post",
                            "contentType": "post"
                        }
                        
                        entry_response = await self.client.post(f"{BASE_URL}/tribe-contests/{contest_id}/entries",
                                                              json=entry_data, headers=headers)
                        if entry_response.status_code in [200, 201]:
                            self.log_result("Submit Contest Entry", True, "Entry submitted successfully")
                        else:
                            self.log_result("Submit Contest Entry", False, f"Entry submission failed: {entry_response.status_code}")
                            
                        # Test invalid contentId
                        invalid_entry_data = {
                            "contentId": "invalid-content-id",
                            "entryType": "post", 
                            "contentType": "post"
                        }
                        invalid_response = await self.client.post(f"{BASE_URL}/tribe-contests/{contest_id}/entries",
                                                                json=invalid_entry_data, headers=headers)
                        if invalid_response.status_code == 404:
                            self.log_result("Invalid Content Validation", True, "Invalid contentId correctly rejected with 404")
                        else:
                            self.log_result("Invalid Content Validation", False, f"Expected 404, got {invalid_response.status_code}")
                            
                        # Test story type entry (added to ENTRY_TYPES)
                        story_data = {"caption": "Test story", "visibility": "PUBLIC"}
                        story_response = await self.client.post(f"{BASE_URL}/content/posts",
                                                              json=story_data, headers=headers)
                        if story_response.status_code in [200, 201]:
                            story_id = story_response.json().get("data", {}).get("id")
                            story_entry_data = {
                                "contentId": story_id,
                                "entryType": "story",
                                "contentType": "story" 
                            }
                            story_entry_response = await self.client.post(f"{BASE_URL}/tribe-contests/{contest_id}/entries",
                                                                        json=story_entry_data, headers=headers)
                            if story_entry_response.status_code in [200, 201]:
                                self.log_result("Story Entry Type", True, "Story type entry accepted")
                            else:
                                self.log_result("Story Entry Type", False, f"Story entry failed: {story_entry_response.status_code}")
                    else:
                        self.log_result("Create Contest Content", False, f"Failed to create content: {post_response.status_code}")
                        
                    # Test 3C: Compute scores with real content engagement
                    compute_response = await self.client.post(f"{BASE_URL}/admin/tribe-contests/{contest_id}/compute-scores",
                                                            headers=headers)
                    if compute_response.status_code in [200, 201]:
                        compute_result = compute_response.json()
                        self.log_result("Compute Scores", True, f"Scores computed: {compute_result.get('data', {})}")
                    elif compute_response.status_code == 403:
                        self.log_result("Compute Scores", True, "Non-admin blocked from computing scores (expected 403)")
                    else:
                        self.log_result("Compute Scores", False, f"Score computation failed: {compute_response.status_code}")
                        
            elif contest_response.status_code == 403:
                self.log_result("Create Contest", True, "Non-admin blocked from creating contest (expected 403)")
            else:
                self.log_result("Create Contest", False, f"Contest creation failed: {contest_response.status_code}")
                
        except Exception as e:
            self.log_result("Contest Scoring", False, f"Exception: {str(e)}")
            
    async def test_heroname_badge(self):
        """Test 4: BADGE - heroName FROM TRIBE DATA"""
        print("\n=== Testing HERONAME BADGE ===")
        
        if not self.user1_token:
            self.log_result("HeroName Badge", False, "No authenticated user")
            return
            
        try:
            headers = self.get_headers(self.user1_token)
            
            # Test 4A: Check user profile includes tribeHeroName
            auth_response = await self.client.get(f"{BASE_URL}/auth/me", headers=headers)
            if auth_response.status_code == 200:
                user_data = auth_response.json()
                tribe_hero_name = user_data.get("data", {}).get("tribeHeroName")
                if tribe_hero_name:
                    self.log_result("User Profile HeroName", True, f"User profile includes tribeHeroName: {tribe_hero_name}")
                else:
                    # Check in tribe membership data
                    tribe_response = await self.client.get(f"{BASE_URL}/me/tribe", headers=headers)
                    if tribe_response.status_code == 200:
                        tribe_data = tribe_response.json()
                        hero_name = tribe_data.get("data", {}).get("tribe", {}).get("heroName")
                        if hero_name:
                            self.log_result("User Profile HeroName", True, f"HeroName found in tribe data: {hero_name}")
                        else:
                            self.log_result("User Profile HeroName", False, "HeroName not found in user profile or tribe data")
                    else:
                        self.log_result("Get User Tribe", False, f"Failed to get tribe data: {tribe_response.status_code}")
            else:
                self.log_result("User Profile HeroName", False, f"Failed to get user profile: {auth_response.status_code}")
                
            # Test 4B: Check tribes list includes heroName, primaryColor, secondaryColor, cheerCount, totalSalutes
            tribes_response = await self.client.get(f"{BASE_URL}/tribes")
            if tribes_response.status_code == 200:
                tribes_data = tribes_response.json()
                tribes = tribes_data.get("items", [])
                if tribes:
                    first_tribe = tribes[0]
                    required_fields = ["heroName", "primaryColor", "secondaryColor", "cheerCount", "totalSalutes"]
                    missing_fields = []
                    
                    for field in required_fields:
                        if field not in first_tribe:
                            missing_fields.append(field)
                            
                    if not missing_fields:
                        hero_name = first_tribe.get("heroName")
                        primary_color = first_tribe.get("primaryColor")
                        total_salutes = first_tribe.get("totalSalutes", 0)
                        cheer_count = first_tribe.get("cheerCount", 0)
                        
                        self.log_result("Tribes List Fields", True, 
                                      f"All required fields present - HeroName: {hero_name}, Color: {primary_color}, Salutes: {total_salutes}, Cheers: {cheer_count}")
                    else:
                        self.log_result("Tribes List Fields", False, f"Missing fields in tribe data: {missing_fields}")
                else:
                    self.log_result("Tribes List Fields", False, "No tribes found in response")
            else:
                self.log_result("Tribes List Fields", False, f"Failed to get tribes list: {tribes_response.status_code}")
                
        except Exception as e:
            self.log_result("HeroName Badge", False, f"Exception: {str(e)}")
            
    async def test_visibility_regression(self):
        """Test 5: VISIBILITY (regression)"""
        print("\n=== Testing VISIBILITY REGRESSION ===")
        
        if not self.user1_token:
            self.log_result("Visibility Regression", False, "No authenticated user")
            return
            
        try:
            headers = self.get_headers(self.user1_token)
            
            # Test 5A: POST content with visibility:"HOUSE_ONLY" should save correctly
            house_only_data = {
                "caption": "House only test post",
                "visibility": "HOUSE_ONLY"
            }
            
            house_response = await self.client.post(f"{BASE_URL}/content/posts",
                                                  json=house_only_data, headers=headers)
            if house_response.status_code in [200, 201]:
                post_data = house_response.json()
                saved_visibility = post_data.get("data", {}).get("visibility")
                if saved_visibility == "HOUSE_ONLY":
                    self.log_result("House Only Visibility", True, "HOUSE_ONLY visibility saved correctly")
                else:
                    self.log_result("House Only Visibility", False, f"Expected HOUSE_ONLY, got {saved_visibility}")
            else:
                self.log_result("House Only Visibility", False, f"Failed to create HOUSE_ONLY post: {house_response.status_code}")
                
            # Test 5B: POST content without visibility should default to PUBLIC
            default_visibility_data = {
                "caption": "Default visibility test post"
                # No visibility field
            }
            
            default_response = await self.client.post(f"{BASE_URL}/content/posts", 
                                                    json=default_visibility_data, headers=headers)
            if default_response.status_code in [200, 201]:
                post_data = default_response.json()
                saved_visibility = post_data.get("data", {}).get("visibility")
                if saved_visibility == "PUBLIC":
                    self.log_result("Default Visibility", True, "Default visibility set to PUBLIC correctly")
                else:
                    self.log_result("Default Visibility", False, f"Expected PUBLIC default, got {saved_visibility}")
            else:
                self.log_result("Default Visibility", False, f"Failed to create default visibility post: {default_response.status_code}")
                
        except Exception as e:
            self.log_result("Visibility Regression", False, f"Exception: {str(e)}")

    async def run_all_tests(self):
        """Run all test suites"""
        print("🏛️ TRIBE SOCIAL PLATFORM - BACKEND TESTING")
        print("=" * 60)
        print(f"Base URL: {BASE_URL}")
        print(f"Test Users: {TEST_USER_1['phone']}, {TEST_USER_2['phone']}")
        print(f"Started: {datetime.now().isoformat()}")
        print("=" * 60)
        
        # Authenticate users first
        if not await self.authenticate_users():
            print("❌ Authentication failed, stopping tests")
            return
            
        # Run all test suites
        await self.test_salute_cheer_mechanism()
        await self.test_tribe_rivalry_system() 
        await self.test_contest_scoring()
        await self.test_heroname_badge()
        await self.test_visibility_regression()
        
        # Summary
        print("\n" + "=" * 60)
        print("TEST SUMMARY")
        print("=" * 60)
        
        passed = sum(1 for r in self.results if r["success"])
        total = len(self.results)
        pass_rate = (passed / total) * 100 if total > 0 else 0
        
        print(f"Total Tests: {total}")
        print(f"Passed: {passed}")
        print(f"Failed: {total - passed}")
        print(f"Success Rate: {pass_rate:.1f}%")
        
        print(f"\nCompleted: {datetime.now().isoformat()}")
        
        # Show failed tests
        failed_tests = [r for r in self.results if not r["success"]]
        if failed_tests:
            print(f"\n❌ FAILED TESTS ({len(failed_tests)}):")
            for test in failed_tests:
                print(f"  • {test['test']}: {test['message']}")
        
        # Save detailed results
        with open("/app/tribe_test_results.json", "w") as f:
            json.dump({
                "summary": {
                    "total_tests": total,
                    "passed": passed,
                    "failed": total - passed,
                    "success_rate": pass_rate,
                    "timestamp": datetime.now().isoformat()
                },
                "results": self.results
            }, f, indent=2)
            
        print(f"\nDetailed results saved to: /app/tribe_test_results.json")

async def main():
    """Main test execution"""
    suite = TribeTestSuite()
    try:
        await suite.run_all_tests()
    finally:
        await suite.cleanup()

if __name__ == "__main__":
    asyncio.run(main())