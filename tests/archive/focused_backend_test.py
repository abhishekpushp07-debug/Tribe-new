#!/usr/bin/env python3
"""
Focused Tribe Backend Test - Validates KEY CONTRACT FIXES and Core Functionality
Avoids rate limiting by using fresh user accounts
"""

import requests
import json
import random
import base64
from datetime import datetime

BASE_URL = "https://tribe-handoff-v1.preview.emergentagent.com/api"

class FocusedTester:
    def __init__(self):
        self.tests_passed = 0
        self.tests_failed = 0
        self.failed_tests = []

    def log(self, message):
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] {message}")

    def generate_phone(self):
        return f"91{random.randint(10000000, 99999999)}"

    def generate_pin(self):
        return f"{random.randint(1000, 9999)}"

    def create_authenticated_user(self, adult=True):
        """Create and authenticate a new user"""
        phone = self.generate_phone()
        pin = self.generate_pin()
        
        # Register
        register_data = {
            "phone": phone,
            "pin": pin,
            "displayName": f"Test User {random.randint(1000, 9999)}"
        }
        
        response = requests.post(f"{BASE_URL}/auth/register", json=register_data)
        if response.status_code != 201:
            return None, None
            
        token = response.json().get('token')
        headers = {'Authorization': f'Bearer {token}'}
        
        # Set age
        current_year = datetime.now().year
        birth_year = current_year - (25 if adult else 15)
        age_data = {"birthYear": birth_year}
        
        requests.patch(f"{BASE_URL}/me/age", json=age_data, headers=headers)
        
        return token, headers

    def test_result(self, condition, test_name):
        if condition:
            self.tests_passed += 1
            self.log(f"✅ {test_name}: PASSED")
            return True
        else:
            self.tests_failed += 1
            self.failed_tests.append(test_name)
            self.log(f"❌ {test_name}: FAILED")
            return False

    def run_focused_tests(self):
        self.log("Starting Focused Tribe Backend Test Suite")
        self.log("Focus: CONTRACT FIXES + Core Functionality")
        
        # Test 1: Health Endpoints
        self.log("\n=== HEALTH ENDPOINTS ===")
        
        response = requests.get(f"{BASE_URL}/")
        self.test_result(response.status_code == 200, "Root endpoint")
        
        response = requests.get(f"{BASE_URL}/healthz")
        self.test_result(response.status_code == 200, "Health check")
        
        response = requests.get(f"{BASE_URL}/readyz")
        self.test_result(response.status_code == 200, "Readiness check")
        
        # Test 2: Core Registration & Onboarding
        self.log("\n=== REGISTRATION & ONBOARDING ===")
        
        phone = self.generate_phone()
        pin = self.generate_pin()
        register_data = {
            "phone": phone,
            "pin": pin,
            "displayName": f"Test User {random.randint(1000, 9999)}"
        }
        
        response = requests.post(f"{BASE_URL}/auth/register", json=register_data)
        registration_success = self.test_result(response.status_code == 201 and 'token' in response.json(), "User registration")
        
        if registration_success:
            token = response.json().get('token')
            headers = {'Authorization': f'Bearer {token}'}
            
            # Age setting
            age_data = {"birthYear": 2000}
            response = requests.patch(f"{BASE_URL}/me/age", json=age_data, headers=headers)
            self.test_result(response.status_code == 200, "Age setting")
            
            # College search & linking
            response = requests.get(f"{BASE_URL}/colleges/search?q=IIT")
            college_search_success = self.test_result(response.status_code == 200 and len(response.json().get('colleges', [])) > 0, "College search")
            
            if college_search_success:
                college_id = response.json()['colleges'][0]['id']
                college_data = {"collegeId": college_id}
                response = requests.patch(f"{BASE_URL}/me/college", json=college_data, headers=headers)
                self.test_result(response.status_code == 200, "College linking")
            
            # Legal consent
            consent_data = {"version": "1.0"}
            response = requests.post(f"{BASE_URL}/legal/accept", consent_data, headers=headers)
            self.test_result(response.status_code == 200, "Legal consent")
            
            # Login verification
            login_data = {"phone": phone, "pin": pin}
            response = requests.post(f"{BASE_URL}/auth/login", json=login_data)
            self.test_result(response.status_code == 200 and 'token' in response.json(), "Login verification")
        
        # Test 3: CRITICAL CONTRACT FIXES
        self.log("\n=== CRITICAL CONTRACT FIXES ===")
        
        token, headers = self.create_authenticated_user()
        if token:
            # Contract Fix 1: Stories feed
            response = requests.get(f"{BASE_URL}/feed/stories", headers=headers)
            if response.status_code == 200:
                data = response.json()
                has_both_fields = 'stories' in data and 'storyRail' in data
                self.test_result(has_both_fields, "Stories feed contract (stories + storyRail)")
            else:
                self.test_result(False, "Stories feed contract (stories + storyRail)")
            
            # Contract Fix 2: Content mediaIds field
            post_data = {"caption": "Test post for mediaIds validation"}
            response = requests.post(f"{BASE_URL}/content/posts", json=post_data, headers=headers)
            if response.status_code == 201:
                post = response.json().get('post', {})
                has_media_ids = 'mediaIds' in post
                self.test_result(has_media_ids, "Content mediaIds field")
            else:
                self.test_result(False, "Content mediaIds field")
            
            # Contract Fix 3: Grievance POST (both grievance + ticket)
            grievance_data = {
                "ticketType": "LEGAL_NOTICE",
                "subject": "Test legal grievance",
                "description": "Test description"
            }
            response = requests.post(f"{BASE_URL}/grievances", json=grievance_data, headers=headers)
            if response.status_code == 201:
                data = response.json()
                has_both_fields = 'grievance' in data and 'ticket' in data
                self.test_result(has_both_fields, "Grievance POST contract (grievance + ticket)")
            else:
                self.test_result(False, "Grievance POST contract (grievance + ticket)")
            
            # Contract Fix 4: Grievance GET (both grievances + tickets arrays)
            response = requests.get(f"{BASE_URL}/grievances", headers=headers)
            if response.status_code == 200:
                data = response.json()
                has_both_arrays = 'grievances' in data and 'tickets' in data
                self.test_result(has_both_arrays, "Grievance GET contract (grievances + tickets)")
            else:
                self.test_result(False, "Grievance GET contract (grievances + tickets)")
        
        # Test 4: Content Lifecycle
        self.log("\n=== CONTENT LIFECYCLE ===")
        
        token, headers = self.create_authenticated_user()
        if token:
            # Text post
            post_data = {"caption": f"Test post {datetime.now().isoformat()}"}
            response = requests.post(f"{BASE_URL}/content/posts", json=post_data, headers=headers)
            post_creation_success = self.test_result(response.status_code == 201, "Text post creation")
            
            post_id = None
            if post_creation_success:
                post_id = response.json().get('post', {}).get('id')
                
                # Get post
                if post_id:
                    response = requests.get(f"{BASE_URL}/content/{post_id}", headers=headers)
                    self.test_result(response.status_code == 200, "Content retrieval")
                    
                    # Delete post
                    response = requests.delete(f"{BASE_URL}/content/{post_id}", headers=headers)
                    self.test_result(response.status_code == 200, "Content deletion")
        
        # Test 5: Feed Endpoints
        self.log("\n=== FEED ENDPOINTS ===")
        
        response = requests.get(f"{BASE_URL}/feed/public")
        self.test_result(response.status_code == 200, "Public feed")
        
        token, headers = self.create_authenticated_user()
        if token:
            response = requests.get(f"{BASE_URL}/feed/following", headers=headers)
            self.test_result(response.status_code == 200, "Following feed")
            
            response = requests.get(f"{BASE_URL}/feed/reels", headers=headers)
            self.test_result(response.status_code == 200, "Reels feed")
        
        # Test 6: Social Features
        self.log("\n=== SOCIAL FEATURES ===")
        
        token, headers = self.create_authenticated_user()
        if token:
            # Get users to follow
            response = requests.get(f"{BASE_URL}/suggestions/users", headers=headers)
            if response.status_code == 200 and response.json().get('users'):
                user_id = response.json()['users'][0]['id']
                
                # Follow/unfollow
                response = requests.post(f"{BASE_URL}/follow/{user_id}", headers=headers)
                self.test_result(response.status_code == 200, "Follow user")
                
                response = requests.delete(f"{BASE_URL}/follow/{user_id}", headers=headers)
                self.test_result(response.status_code == 200, "Unfollow user")
            
            # Create content to interact with
            post_data = {"caption": "Test post for interactions"}
            response = requests.post(f"{BASE_URL}/content/posts", json=post_data, headers=headers)
            if response.status_code == 201:
                post_id = response.json().get('post', {}).get('id')
                if post_id:
                    # Like
                    response = requests.post(f"{BASE_URL}/content/{post_id}/like", headers=headers)
                    self.test_result(response.status_code == 200, "Like content")
                    
                    # Save
                    response = requests.post(f"{BASE_URL}/content/{post_id}/save", headers=headers)
                    self.test_result(response.status_code == 200, "Save content")
                    
                    # Comment
                    comment_data = {"body": "Test comment"}
                    response = requests.post(f"{BASE_URL}/content/{post_id}/comments", json=comment_data, headers=headers)
                    self.test_result(response.status_code == 200, "Create comment")
        
        # Test 7: DPDP Child Protection
        self.log("\n=== DPDP CHILD PROTECTION ===")
        
        token, headers = self.create_authenticated_user(adult=False)  # Child user
        if token:
            # Child cannot upload media
            media_data = {
                "data": base64.b64encode(b"fake image").decode(),
                "mimeType": "image/jpeg",
                "filename": "test.jpg"
            }
            response = requests.post(f"{BASE_URL}/media/upload", json=media_data, headers=headers)
            self.test_result(response.status_code == 403, "Child media upload restriction")
            
            # Child CAN create text posts
            post_data = {"caption": "Child text post"}
            response = requests.post(f"{BASE_URL}/content/posts", json=post_data, headers=headers)
            self.test_result(response.status_code == 201, "Child text post creation")
            
            # Check privacy settings
            response = requests.get(f"{BASE_URL}/auth/me", headers=headers)
            if response.status_code == 200:
                user = response.json().get('user', {})
                privacy_correct = (user.get('personalizedFeed') == False and 
                                 user.get('targetedAds') == False)
                self.test_result(privacy_correct, "Child privacy settings")
        
        # Test 8: Discovery
        self.log("\n=== DISCOVERY ===")
        
        response = requests.get(f"{BASE_URL}/colleges/search?q=IIT")
        self.test_result(response.status_code == 200 and len(response.json().get('colleges', [])) > 0, "College search")
        
        response = requests.get(f"{BASE_URL}/houses")
        self.test_result(response.status_code == 200, "Houses listing")
        
        response = requests.get(f"{BASE_URL}/search?q=test")
        self.test_result(response.status_code == 200, "Global search")
        
        # Test 9: Security
        self.log("\n=== SECURITY FEATURES ===")
        
        token, headers = self.create_authenticated_user()
        if token:
            # Unauthenticated access protection
            response = requests.get(f"{BASE_URL}/feed/following")
            self.test_result(response.status_code == 401, "Auth protection")
            
            # Valid token works
            response = requests.get(f"{BASE_URL}/feed/following", headers=headers)
            self.test_result(response.status_code == 200, "Valid token access")

        # Results Summary
        total_tests = self.tests_passed + self.tests_failed
        success_rate = (self.tests_passed / total_tests * 100) if total_tests > 0 else 0
        
        self.log(f"\n{'='*50}")
        self.log(f"FOCUSED TEST SUITE COMPLETED")
        self.log(f"Total Tests: {total_tests}")
        self.log(f"Passed: {self.tests_passed}")
        self.log(f"Failed: {self.tests_failed}")
        self.log(f"Success Rate: {success_rate:.1f}%")
        
        # Highlight contract fixes status
        contract_fixes = [
            "Stories feed contract (stories + storyRail)",
            "Content mediaIds field", 
            "Grievance POST contract (grievance + ticket)",
            "Grievance GET contract (grievances + tickets)"
        ]
        
        working_fixes = [fix for fix in contract_fixes if fix not in self.failed_tests]
        self.log(f"\nCONTRACT FIXES STATUS:")
        for fix in contract_fixes:
            status = "✅ WORKING" if fix not in self.failed_tests else "❌ BROKEN"
            self.log(f"  {fix}: {status}")
        
        if self.failed_tests:
            self.log(f"\nFailed Tests:")
            for i, test in enumerate(self.failed_tests, 1):
                self.log(f"  {i}. {test}")
        
        # Final assessment
        contract_success_rate = (len(working_fixes) / len(contract_fixes)) * 100
        self.log(f"\nCONTRACT FIXES: {contract_success_rate:.0f}% ({len(working_fixes)}/{len(contract_fixes)})")
        
        if contract_success_rate == 100:
            self.log("🎉 ALL CONTRACT FIXES VERIFIED!")
        
        return success_rate, contract_success_rate

if __name__ == "__main__":
    tester = FocusedTester()
    overall_rate, contract_rate = tester.run_focused_tests()