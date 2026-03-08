#!/usr/bin/env python3
"""
Distribution Ladder Test Fixes
Fixing the 3 failing tests from previous run
"""

import json
import requests
from datetime import datetime, timedelta
from pymongo import MongoClient
from uuid import uuid4

# Configuration
BASE_URL = "https://tribe-stories-stage9.preview.emergentagent.com/api"
MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "your_database_name"

# Test Users
REGULAR_USER = {"phone": "9000000001", "pin": "1234"}
ADMIN_USER = {"phone": "9747158289", "pin": "1234"}

class DistributionFixTester:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})
        self.regular_token = None
        self.admin_token = None
        self.mongo_client = None
        self.db = None
        
    def setup(self):
        """Setup database and login"""
        try:
            self.mongo_client = MongoClient(MONGO_URL)
            self.db = self.mongo_client[DB_NAME]
            self.db.command("ping")
            print("✅ MongoDB connected")
            
            # Login users
            response = self.session.post(f"{BASE_URL}/auth/login", json=REGULAR_USER, timeout=10)
            self.regular_token = response.json()["token"]
            
            response = self.session.post(f"{BASE_URL}/auth/login", json=ADMIN_USER, timeout=10)
            self.admin_token = response.json()["token"]
            
            print("✅ Users logged in")
            return True
        except Exception as e:
            print(f"❌ Setup failed: {e}")
            return False

    def make_request(self, method, endpoint, token=None, json_data=None):
        """Make authenticated request"""
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
            
        if method == "GET":
            response = self.session.get(f"{BASE_URL}{endpoint}", headers=headers, timeout=10)
        elif method == "POST":
            response = self.session.post(f"{BASE_URL}{endpoint}", headers=headers, json=json_data, timeout=10)
        else:
            return None, f"Unsupported method: {method}"
            
        return response, None

    def test_fix_1_low_trust_content(self):
        """Fix Test 4: Low-trust content stays at 0 (use unique phone)"""
        print("\n🔧 FIXING TEST 4: Low-trust content stays at 0")
        
        try:
            new_user_id = str(uuid4())
            unique_phone = f"999888{str(uuid4())[:4]}"  # Unique phone number
            now = datetime.utcnow()
            
            # Create new user account (fresh, < 7 days)
            new_user = {
                "id": new_user_id,
                "phone": unique_phone,
                "displayName": "New User Test",
                "createdAt": now - timedelta(days=2),  # Only 2 days old
                "role": "USER",
                "ageStatus": "ADULT",
                "pinHash": "dummy",
                "pinSalt": "dummy"
            }
            self.db.users.insert_one(new_user)
            print(f"   Created new user with phone: {unique_phone}")
            
            # Create content from this new user
            low_trust_id = str(uuid4())
            low_trust_post = {
                "id": low_trust_id,
                "kind": "POST",
                "authorId": new_user_id,
                "caption": "Low trust test content",
                "visibility": "PUBLIC",
                "likeCount": 3,  # Has likes but author is too new
                "distributionStage": 0,
                "createdAt": now,
                "updatedAt": now,
            }
            
            self.db.content_items.insert_one(low_trust_post)
            print(f"   Created low-trust content: {low_trust_id}")
            
            # Try to evaluate - should be blocked
            response, error = self.make_request("POST", f"/admin/distribution/evaluate/{low_trust_id}", self.admin_token)
            
            if error:
                print(f"   ❌ API Error: {error}")
                return False
                
            data = response.json() if response.status_code == 200 else {}
            
            # Should be blocked due to account age
            blocked = data.get("blocked", False) or "account_age" in data.get("blockedReason", "")
            success = response.status_code == 200 and blocked
            
            print(f"   Status: {response.status_code}")
            print(f"   Blocked: {blocked}")
            print(f"   Blocked Reason: {data.get('blockedReason', 'None')}")
            
            if success:
                print("   ✅ FIXED: Low-trust content correctly blocked")
            else:
                print("   ❌ STILL FAILING: Low-trust content not blocked properly")
                
            return success
            
        except Exception as e:
            print(f"   ❌ Setup error: {e}")
            return False

    def test_fix_2_stage_2_visibility(self):
        """Fix Test 15: Stage 2 content visible in public feed"""
        print("\n🔧 FIXING TEST 15: Stage 2 content visible in public feed")
        
        try:
            stage2_id = str(uuid4())
            now = datetime.utcnow()
            
            # Create properly structured Stage 2 content
            stage2_post = {
                "id": stage2_id,
                "kind": "POST",
                "authorId": "ebceed59-017d-4526-a70a-1ec3335df625",  # Valid user
                "caption": "Stage 2 visibility test content",
                "visibility": "PUBLIC",
                "distributionStage": 2,
                "distributionReason": "PROMOTED_TO_PUBLIC",
                "likeCount": 10,
                "commentCount": 3,
                "saveCount": 2,
                "shareCount": 0,
                "viewCount": 50,
                "syntheticDeclaration": False,
                "syntheticLabelStatus": "UNKNOWN",
                "createdAt": now - timedelta(minutes=5),  # Recent but not too fresh
                "updatedAt": now,
            }
            
            # Insert with proper structure
            result = self.db.content_items.insert_one(stage2_post)
            print(f"   Created Stage 2 content: {stage2_id}")
            
            # Wait a moment for any processing
            import time
            time.sleep(2)
            
            # Check public feed
            response, error = self.make_request("GET", "/feed/public")
            
            if error:
                print(f"   ❌ Feed API Error: {error}")
                return False
                
            data = response.json() if response.status_code == 200 else {}
            items = data.get("items", [])
            
            print(f"   Feed Status: {response.status_code}")
            print(f"   Distribution Filter: {data.get('distributionFilter')}")
            print(f"   Total Items: {len(items)}")
            
            # Check if our stage 2 content is in the feed
            found_content = any(item.get("id") == stage2_id for item in items)
            
            if found_content:
                print("   ✅ FIXED: Stage 2 content found in public feed")
            else:
                print("   ❌ STILL FAILING: Stage 2 content not in public feed")
                print("   Feed item IDs:", [item.get("id", "no-id") for item in items[:5]])
                
            return found_content
            
        except Exception as e:
            print(f"   ❌ Setup error: {e}")
            return False

    def test_fix_3_quality_signals(self):
        """Fix Test 16: Quality signals in evaluate response"""
        print("\n🔧 FIXING TEST 16: Quality signals in evaluate response")
        
        try:
            # Create content with proper engagement data
            test_id = str(uuid4())
            now = datetime.utcnow()
            
            test_post = {
                "id": test_id,
                "kind": "POST",
                "authorId": "ebceed59-017d-4526-a70a-1ec3335df625",
                "caption": "Quality signals test content",
                "visibility": "PUBLIC",
                "distributionStage": 0,
                "likeCount": 5,
                "commentCount": 2,
                "saveCount": 1,
                "createdAt": now - timedelta(hours=2),
                "updatedAt": now,
            }
            
            self.db.content_items.insert_one(test_post)
            print(f"   Created test content: {test_id}")
            
            # Add some engagement data to test quality signals
            for i in range(3):
                # Add likes
                like = {
                    "id": str(uuid4()),
                    "contentId": test_id,
                    "userId": f"user_{i}",
                    "type": "LIKE",
                    "createdAt": now - timedelta(minutes=30),
                }
                self.db.reactions.insert_one(like)
                
                # Add comments  
                comment = {
                    "id": str(uuid4()),
                    "contentId": test_id,
                    "authorId": f"user_{i}",
                    "text": f"Test comment {i}",
                    "createdAt": now - timedelta(minutes=20),
                }
                self.db.comments.insert_one(comment)
            
            print(f"   Added engagement data (likes, comments)")
            
            # Evaluate to get signals
            response, error = self.make_request("POST", f"/admin/distribution/evaluate/{test_id}", self.admin_token)
            
            if error:
                print(f"   ❌ Evaluation Error: {error}")
                return False
                
            data = response.json() if response.status_code == 200 else {}
            signals = data.get("signals", {})
            
            print(f"   Evaluation Status: {response.status_code}")
            print(f"   Has Signals: {'signals' in data}")
            
            required_signals = [
                "uniqueEngagerCount",
                "lowTrustEngagerCount", 
                "trustedEngagementScore",
                "burstSuspicion"
            ]
            
            present_signals = {signal: signal in signals for signal in required_signals}
            has_all_signals = all(present_signals.values())
            
            print(f"   Signal Presence: {present_signals}")
            
            if has_all_signals:
                print("   ✅ FIXED: All quality signals present in response")
                print(f"   Sample Values: uniqueEngagers={signals.get('uniqueEngagerCount')}, trustedScore={signals.get('trustedEngagementScore')}")
            else:
                print("   ❌ STILL FAILING: Missing quality signals")
                print(f"   Available signals: {list(signals.keys())}")
                
            return has_all_signals
            
        except Exception as e:
            print(f"   ❌ Setup error: {e}")
            return False

    def run_fixes(self):
        """Run all fixes"""
        print("🔧 DISTRIBUTION LADDER TEST FIXES")
        print("=" * 50)
        
        if not self.setup():
            return False
            
        results = []
        
        # Run the 3 fixes
        results.append(("Low-trust content", self.test_fix_1_low_trust_content()))
        results.append(("Stage 2 visibility", self.test_fix_2_stage_2_visibility()))  
        results.append(("Quality signals", self.test_fix_3_quality_signals()))
        
        # Summary
        print("\n📊 FIX RESULTS SUMMARY")
        print("=" * 50)
        
        passed = sum(1 for _, success in results if success)
        total = len(results)
        
        for name, success in results:
            status = "✅ FIXED" if success else "❌ STILL FAILING"
            print(f"{status}: {name}")
        
        print(f"\nFixed: {passed}/{total}")
        
        if passed == total:
            print("🎉 ALL FIXES SUCCESSFUL! Test suite should now achieve 100% success rate.")
        else:
            print(f"⚠️  {total - passed} test(s) still failing. May need code fixes.")
            
        return passed == total

def main():
    tester = DistributionFixTester()
    try:
        success = tester.run_fixes()
        return 0 if success else 1
    except Exception as e:
        print(f"💥 Fix testing failed: {e}")
        return 1
    finally:
        if tester.mongo_client:
            tester.mongo_client.close()

if __name__ == "__main__":
    import sys
    sys.exit(main())