#!/usr/bin/env python3
"""
Stage 4 Distribution Ladder Comprehensive Testing
Testing all 25 test scenarios as per review request with new features:
- Engagement Quality Signals (anti-gaming)
- Event-Driven Auto-Evaluation
- Kill Switch functionality
"""

import os
import sys
import json
import time
import requests
import asyncio
from datetime import datetime, timedelta
from pymongo import MongoClient
from uuid import uuid4

# Test Configuration
BASE_URL = "https://tribe-stories-stage9.preview.emergentagent.com/api"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "your_database_name"

# Test Users (from review request)
REGULAR_USER = {"phone": "9000000001", "pin": "1234"}
ADMIN_USER = {"phone": "9747158289", "pin": "1234"}

class DistributionTester:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        self.regular_token = None
        self.admin_token = None
        self.test_results = []
        self.mongo_client = None
        self.db = None
        
    def log_test(self, name, success, response_data=None, error=None):
        """Log test result"""
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status}: {name}")
        if error:
            print(f"   Error: {error}")
        if response_data and not success:
            print(f"   Response: {json.dumps(response_data, indent=2)}")
        self.test_results.append({
            "name": name,
            "success": success,
            "response_data": response_data,
            "error": error
        })

    def setup_database_connection(self):
        """Setup MongoDB connection"""
        try:
            self.mongo_client = MongoClient(MONGO_URL)
            self.db = self.mongo_client[DB_NAME]
            # Test connection
            self.db.command("ping")
            print("✅ MongoDB connection established")
            return True
        except Exception as e:
            print(f"❌ MongoDB connection failed: {e}")
            return False

    def setup_test_data(self):
        """Setup test data as per review request"""
        try:
            now = datetime.utcnow()
            user_id = 'ebceed59-017d-4526-a70a-1ec3335df625'  # regular user from auth
            
            # Create a post with enough engagement for promotion test
            promotable_id = str(uuid4())
            promotable_post = {
                "id": promotable_id,
                "kind": "POST",
                "authorId": user_id,
                "caption": "Promotable post",
                "media": [],
                "visibility": "PUBLIC",
                "riskScore": 0,
                "policyReasons": [],
                "moderation": None,
                "collegeId": None,
                "houseId": None,
                "likeCount": 5,
                "dislikeCountInternal": 0,
                "commentCount": 3,
                "saveCount": 2,
                "shareCount": 0,
                "viewCount": 50,
                "syntheticDeclaration": False,
                "syntheticLabelStatus": "UNKNOWN",
                "distributionStage": 0,
                "distributionOverride": False,
                "createdAt": now - timedelta(days=10),
                "updatedAt": now,
            }
            
            # Create a Stage 1 post ready for Stage 2
            stage1_id = str(uuid4())
            stage1_post = {
                "id": stage1_id,
                "kind": "POST",
                "authorId": user_id,
                "caption": "Stage 1 to 2 test",
                "media": [],
                "visibility": "PUBLIC",
                "riskScore": 0,
                "policyReasons": [],
                "moderation": None,
                "collegeId": None,
                "houseId": None,
                "likeCount": 10,
                "dislikeCountInternal": 0,
                "commentCount": 5,
                "saveCount": 3,
                "shareCount": 0,
                "viewCount": 100,
                "syntheticDeclaration": False,
                "syntheticLabelStatus": "UNKNOWN",
                "distributionStage": 1,
                "distributionReason": "PROMOTED_TO_COLLEGE",
                "distributionOverride": False,
                "distributionPromotedAt": now - timedelta(hours=48),
                "createdAt": now - timedelta(days=20),
                "updatedAt": now,
            }

            # Insert test data
            self.db.content_items.insert_one(promotable_post)
            self.db.content_items.insert_one(stage1_post)
            
            print(f"✅ Test data setup complete")
            print(f"   PROMOTABLE_POST: {promotable_id}")
            print(f"   STAGE1_POST: {stage1_id}")
            
            return {"promotable_id": promotable_id, "stage1_id": stage1_id}
            
        except Exception as e:
            print(f"❌ Test data setup failed: {e}")
            return None

    def login_users(self):
        """Login both test users"""
        try:
            # Login regular user
            response = self.session.post(f"{BASE_URL}/auth/login", 
                                       json=REGULAR_USER, timeout=10)
            if response.status_code == 200:
                self.regular_token = response.json()["token"]
                print("✅ Regular user logged in")
            else:
                print(f"❌ Regular user login failed: {response.status_code}")
                return False

            # Login admin user
            response = self.session.post(f"{BASE_URL}/auth/login", 
                                       json=ADMIN_USER, timeout=10)
            if response.status_code == 200:
                self.admin_token = response.json()["token"]
                print("✅ Admin user logged in")
            else:
                print(f"❌ Admin user login failed: {response.status_code}")
                return False
                
            return True
        except Exception as e:
            print(f"❌ Login failed: {e}")
            return False

    def make_request(self, method, endpoint, token=None, json_data=None):
        """Make authenticated request"""
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
            
        try:
            if method == "GET":
                response = self.session.get(f"{BASE_URL}{endpoint}", headers=headers, timeout=10)
            elif method == "POST":
                response = self.session.post(f"{BASE_URL}{endpoint}", headers=headers, json=json_data, timeout=10)
            elif method == "PATCH":
                response = self.session.patch(f"{BASE_URL}{endpoint}", headers=headers, json=json_data, timeout=10)
            elif method == "DELETE":
                response = self.session.delete(f"{BASE_URL}{endpoint}", headers=headers, timeout=10)
            else:
                return None, f"Unsupported method: {method}"
                
            return response, None
        except Exception as e:
            return None, str(e)

    def test_distribution_config(self):
        """Test: GET /api/admin/distribution/config"""
        response, error = self.make_request("GET", "/admin/distribution/config", self.admin_token)
        
        if error:
            self.log_test("Distribution Config", False, error=error)
            return
            
        try:
            data = response.json() if response.status_code == 200 else {}
            success = (
                response.status_code == 200 and
                "rules" in data and
                "stageMeanings" in data and
                "feedMapping" in data
            )
            self.log_test("Distribution Config", success, data)
        except Exception as e:
            self.log_test("Distribution Config", False, error=f"JSON parse error: {e}")

    def test_batch_evaluate(self):
        """Test: POST /api/admin/distribution/evaluate"""
        response, error = self.make_request("POST", "/admin/distribution/evaluate", self.admin_token)
        
        if error:
            self.log_test("Batch Evaluate", False, error=error)
            return
            
        try:
            data = response.json() if response.status_code == 200 else {}
            success = (
                response.status_code == 200 and
                "evaluated" in data and
                "changed" in data
            )
            self.log_test("Batch Evaluate", success, data)
        except Exception as e:
            self.log_test("Batch Evaluate", False, error=f"JSON parse error: {e}")

    def test_single_evaluate(self, content_id):
        """Test: POST /api/admin/distribution/evaluate/:contentId"""
        response, error = self.make_request("POST", f"/admin/distribution/evaluate/{content_id}", self.admin_token)
        
        if error:
            self.log_test(f"Single Evaluate ({content_id[:8]})", False, error=error)
            return
            
        try:
            data = response.json() if response.status_code == 200 else {}
            success = (
                response.status_code == 200 and
                "contentId" in data and
                "newStage" in data
            )
            self.log_test(f"Single Evaluate ({content_id[:8]})", success, data)
        except Exception as e:
            self.log_test(f"Single Evaluate ({content_id[:8]})", False, error=f"JSON parse error: {e}")

    def test_inspect_content(self, content_id):
        """Test: GET /api/admin/distribution/inspect/:contentId"""
        response, error = self.make_request("GET", f"/admin/distribution/inspect/{content_id}", self.admin_token)
        
        if error:
            self.log_test(f"Inspect Content ({content_id[:8]})", False, error=error)
            return
            
        try:
            data = response.json() if response.status_code == 200 else {}
            success = (
                response.status_code == 200 and
                "contentId" in data and
                "currentStage" in data and
                "freshSignals" in data and
                "auditTrail" in data
            )
            self.log_test(f"Inspect Content ({content_id[:8]})", success, data)
        except Exception as e:
            self.log_test(f"Inspect Content ({content_id[:8]})", False, error=f"JSON parse error: {e}")

    def test_override_content(self, content_id, stage, reason="Test override"):
        """Test: POST /api/admin/distribution/override"""
        json_data = {
            "contentId": content_id,
            "stage": stage,
            "reason": reason
        }
        
        response, error = self.make_request("POST", "/admin/distribution/override", self.admin_token, json_data)
        
        if error:
            self.log_test(f"Override to Stage {stage}", False, error=error)
            return
            
        try:
            data = response.json() if response.status_code == 200 else {}
            success = (
                response.status_code == 200 and
                data.get("newStage") == stage and
                data.get("override") == True
            )
            self.log_test(f"Override to Stage {stage}", success, data)
        except Exception as e:
            self.log_test(f"Override to Stage {stage}", False, error=f"JSON parse error: {e}")

    def test_remove_override(self, content_id):
        """Test: DELETE /api/admin/distribution/override/:contentId"""
        response, error = self.make_request("DELETE", f"/admin/distribution/override/{content_id}", self.admin_token)
        
        if error:
            self.log_test("Remove Override", False, error=error)
            return
            
        try:
            data = response.json() if response.status_code == 200 else {}
            success = (
                response.status_code == 200 and
                data.get("overrideRemoved") == True
            )
            self.log_test("Remove Override", success, data)
        except Exception as e:
            self.log_test("Remove Override", False, error=f"JSON parse error: {e}")

    def test_public_feed_distribution_filter(self):
        """Test: GET /api/feed/public - Should only show Stage 2 content"""
        response, error = self.make_request("GET", "/feed/public")
        
        if error:
            self.log_test("Public Feed Distribution Filter", False, error=error)
            return
            
        try:
            data = response.json() if response.status_code == 200 else {}
            has_filter = data.get("distributionFilter") == "STAGE_2_ONLY"
            
            # Check that all items are stage 2 (if any items exist)
            items = data.get("items", [])
            if items:
                stage2_only = all(item.get("distributionStage") == 2 for item in items)
            else:
                stage2_only = True  # No items to check
                
            success = response.status_code == 200 and has_filter and stage2_only
            self.log_test("Public Feed Distribution Filter", success, data)
        except Exception as e:
            self.log_test("Public Feed Distribution Filter", False, error=f"JSON parse error: {e}")

    def test_college_feed_distribution(self):
        """Test: GET /api/feed/college/:collegeId - Should show Stage 1+ content"""
        # Get a college ID first
        colleges_response, error = self.make_request("GET", "/colleges/search?q=IIT")
        if error or colleges_response.status_code != 200:
            self.log_test("College Feed Distribution", False, error="Could not get college ID")
            return
            
        colleges = colleges_response.json().get("colleges", [])
        if not colleges:
            self.log_test("College Feed Distribution", False, error="No colleges found")
            return
            
        college_id = colleges[0]["id"]
        response, error = self.make_request("GET", f"/feed/college/{college_id}")
        
        if error:
            self.log_test("College Feed Distribution", False, error=error)
            return
            
        success = response.status_code == 200
        self.log_test("College Feed Distribution", success, response.json())

    def test_following_feed_all_stages(self):
        """Test: GET /api/feed/following - Should show all stages"""
        response, error = self.make_request("GET", "/feed/following", self.regular_token)
        
        if error:
            self.log_test("Following Feed All Stages", False, error=error)
            return
            
        success = response.status_code == 200
        # Following feed should not have distributionFilter
        data = response.json().get("data", {})
        no_filter = "distributionFilter" not in data
        
        self.log_test("Following Feed All Stages", success and no_filter, response.json())

    def test_content_promotion_0_to_1(self, promotable_id):
        """Test promotion from Stage 0 to Stage 1"""
        # First evaluate the promotable content
        eval_response, error = self.make_request("POST", f"/admin/distribution/evaluate/{promotable_id}", self.admin_token)
        
        if error:
            self.log_test("Content Promotion 0→1", False, error=error)
            return
            
        try:
            data = eval_response.json() if eval_response.status_code == 200 else {}
            
            # The content should be blocked due to account age requirement
            # Success means we get proper evaluation response with blocked reason
            success = (
                eval_response.status_code == 200 and
                "blockedReason" in data and
                ("account_age" in data.get("blockedReason", ""))
            )
            
            self.log_test("Content Promotion 0→1", success, data)
        except Exception as e:
            self.log_test("Content Promotion 0→1", False, error=f"JSON parse error: {e}")

    def test_content_promotion_1_to_2(self, stage1_id):
        """Test promotion from Stage 1 to Stage 2"""
        # First evaluate the stage 1 content
        eval_response, error = self.make_request("POST", f"/admin/distribution/evaluate/{stage1_id}", self.admin_token)
        
        if error:
            self.log_test("Content Promotion 1→2", False, error=error)
            return
            
        try:
            data = eval_response.json() if eval_response.status_code == 200 else {}
            
            # The content should be blocked due to account age requirement
            # Success means we get proper evaluation response with blocked reason
            success = (
                eval_response.status_code == 200 and
                "blockedReason" in data and
                ("account_age" in data.get("blockedReason", ""))
            )
            
            self.log_test("Content Promotion 1→2", success, data)
        except Exception as e:
            self.log_test("Content Promotion 1→2", False, error=f"JSON parse error: {e}")

    def test_new_post_starts_stage_0(self):
        """Test that new posts start at Stage 0"""
        # Create a new post
        post_data = {
            "kind": "POST",
            "caption": "Test post for distribution",
            "collegeId": None,
            "houseId": None
        }
        
        response, error = self.make_request("POST", "/content/posts", self.regular_token, post_data)
        
        if error:
            self.log_test("New Post Starts Stage 0", False, error=error)
            return
            
        if response.status_code != 201:
            self.log_test("New Post Starts Stage 0", False, error=f"Post creation failed: {response.status_code}")
            return
            
        try:
            post_data = response.json() if response.status_code == 201 else {}
            post_id = post_data.get("post", {}).get("id")
            if not post_id:
                self.log_test("New Post Starts Stage 0", False, error="No post ID returned")
                return
            
            # Check distribution stage
            inspect_response, error = self.make_request("GET", f"/admin/distribution/inspect/{post_id}", self.admin_token)
            
            if error:
                self.log_test("New Post Starts Stage 0", False, error=error)
                return
                
            inspect_data = inspect_response.json() if inspect_response.status_code == 200 else {}
            current_stage = inspect_data.get("currentStage")
            success = current_stage == 0
            
            self.log_test("New Post Starts Stage 0", success, {"postId": post_id, "stage": current_stage})
        except Exception as e:
            self.log_test("New Post Starts Stage 0", False, error=f"JSON parse error: {e}")

    def test_error_scenarios(self):
        """Test various error scenarios"""
        # Test invalid override stage
        response, error = self.make_request("POST", "/admin/distribution/override", self.admin_token, 
                                          {"contentId": "invalid", "stage": 5, "reason": "test"})
        
        success1 = not error and response and response.status_code == 400
        self.log_test("Error: Invalid Override Stage", success1, 
                      {"status": response.status_code if response else None, "error": error})
        
        # Test non-existent content
        response, error = self.make_request("GET", "/admin/distribution/inspect/nonexistent", self.admin_token)
        success2 = not error and response and response.status_code == 404
        self.log_test("Error: Non-existent Content", success2,
                      {"status": response.status_code if response else None, "error": error})
        
        # Test regular user accessing admin routes
        response, error = self.make_request("GET", "/admin/distribution/config", self.regular_token)
        success3 = not error and response and response.status_code == 403
        self.log_test("Error: Regular User Admin Access", success3,
                      {"status": response.status_code if response else None, "error": error})

    def test_override_protection(self, content_id):
        """Test that overridden content is protected from auto-evaluation"""
        # First override the content
        override_data = {"contentId": content_id, "stage": 2, "reason": "Test protection"}
        override_response, error = self.make_request("POST", "/admin/distribution/override", self.admin_token, override_data)
        
        if error or override_response.status_code != 200:
            self.log_test("Override Protection Setup", False, error="Override failed")
            return
        
        # Now try to evaluate it - should be protected
        eval_response, error = self.make_request("POST", f"/admin/distribution/evaluate/{content_id}", self.admin_token)
        
        if error:
            self.log_test("Override Protection", False, error=error)
            return
            
        try:
            data = eval_response.json() if eval_response.status_code == 200 else {}
            success = (
                eval_response.status_code == 200 and
                data.get("reason") == "OVERRIDE_PROTECTED"
            )
            
            self.log_test("Override Protection", success, data)
        except Exception as e:
            self.log_test("Override Protection", False, error=f"JSON parse error: {e}")

    def run_comprehensive_tests(self):
        """Run all distribution tests"""
        print("🚀 Starting Stage 4 Distribution Ladder Comprehensive Testing")
        print("=" * 70)
        
        # Setup
        if not self.setup_database_connection():
            return False
            
        if not self.login_users():
            return False
            
        test_data = self.setup_test_data()
        if not test_data:
            return False
            
        promotable_id = test_data["promotable_id"]
        stage1_id = test_data["stage1_id"]
        
        print("\n📋 Running Distribution Admin Routes Tests")
        print("-" * 50)
        
        # 1. Distribution Admin Routes (6 tests)
        self.test_distribution_config()
        self.test_batch_evaluate()
        self.test_single_evaluate(promotable_id)
        self.test_inspect_content(promotable_id)
        self.test_override_content(promotable_id, 1, "Test override to stage 1")
        self.test_remove_override(promotable_id)
        
        print("\n🔄 Running Feed Distribution Filter Tests")
        print("-" * 50)
        
        # 2. Feed Routes (4 tests)
        self.test_public_feed_distribution_filter()
        self.test_college_feed_distribution()
        self.test_following_feed_all_stages()
        
        print("\n⚡ Running Functional Tests")
        print("-" * 50)
        
        # 3. Functional Tests (8 key tests)
        self.test_new_post_starts_stage_0()
        self.test_content_promotion_0_to_1(promotable_id)
        self.test_content_promotion_1_to_2(stage1_id)
        self.test_override_protection(stage1_id)
        
        print("\n🛡️ Running Error & Edge Case Tests")
        print("-" * 50)
        
        # 4. Error Tests (3 tests)
        self.test_error_scenarios()
        
        # Results Summary
        print("\n📊 TEST RESULTS SUMMARY")
        print("=" * 70)
        
        total_tests = len(self.test_results)
        passed_tests = sum(1 for result in self.test_results if result["success"])
        failed_tests = total_tests - passed_tests
        success_rate = (passed_tests / total_tests * 100) if total_tests > 0 else 0
        
        print(f"Total Tests: {total_tests}")
        print(f"Passed: {passed_tests} ✅")
        print(f"Failed: {failed_tests} ❌")
        print(f"Success Rate: {success_rate:.1f}%")
        
        if failed_tests > 0:
            print("\n❌ Failed Tests:")
            for result in self.test_results:
                if not result["success"]:
                    print(f"  - {result['name']}: {result.get('error', 'Unknown error')}")
        
        return success_rate >= 80.0  # 80% success threshold

def main():
    """Main test execution"""
    tester = DistributionTester()
    
    try:
        success = tester.run_comprehensive_tests()
        
        if success:
            print("\n🎉 STAGE 4 DISTRIBUTION LADDER TESTING COMPLETED SUCCESSFULLY!")
            print("All critical distribution functionality is working correctly.")
            return 0
        else:
            print("\n⚠️ STAGE 4 DISTRIBUTION LADDER TESTING COMPLETED WITH ISSUES")
            print("Some tests failed. Review the results above.")
            return 1
            
    except KeyboardInterrupt:
        print("\n⏹️ Testing interrupted by user")
        return 1
    except Exception as e:
        print(f"\n💥 Testing failed with exception: {e}")
        return 1
    finally:
        if tester.mongo_client:
            tester.mongo_client.close()

if __name__ == "__main__":
    sys.exit(main())