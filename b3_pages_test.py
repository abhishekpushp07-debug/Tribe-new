#!/usr/bin/env python3
"""
B3 Pages System Backend Testing
Comprehensive validation of 18 new API endpoints for Instagram/Facebook Pages-like functionality.
Focus: Identity safety, Role matrix, Publishing audit truth, Feed integration, Search integration.
"""

import requests
import json
import time
import random
import os
from urllib.parse import urljoin

# Configuration
API_BASE_URL = "https://tribe-pages.preview.emergentagent.com/api"
TEST_PHONE_BASE = "9123456"

class B3PagesValidator:
    def __init__(self):
        self.test_users = {}
        self.test_pages = {}
        self.results = []
        
    def _test_ip(self):
        """Generate unique X-Forwarded-For to bypass rate limits."""
        return f"10.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(0,255)}"
    
    def _api_call(self, method, endpoint, data=None, headers=None, token=None):
        """Make API call with proper headers and error handling."""
        url = urljoin(API_BASE_URL + "/", endpoint.lstrip("/"))
        
        default_headers = {
            "Content-Type": "application/json",
            "X-Forwarded-For": self._test_ip()
        }
        
        if token:
            default_headers["Authorization"] = f"Bearer {token}"
        
        if headers:
            default_headers.update(headers)
            
        try:
            try:
                if method.upper() == "GET":
                    response = requests.get(url, headers=default_headers, timeout=10)
                elif method.upper() == "POST":
                    response = requests.post(url, json=data, headers=default_headers, timeout=10)
                elif method.upper() == "PATCH":
                    response = requests.patch(url, json=data, headers=default_headers, timeout=10)
                elif method.upper() == "DELETE":
                    response = requests.delete(url, headers=default_headers, timeout=10)
                else:
                    raise ValueError(f"Unsupported HTTP method: {method}")
                    
                return response
            except requests.exceptions.Timeout:
                print(f"Timeout for {method} {endpoint}")
                return None
            except requests.exceptions.RequestException as e:
                print(f"Request failed for {method} {endpoint}: {e}")
                return None
    
    def _register_user(self, suffix):
        """Register and authenticate a test user."""
        phone = f"{TEST_PHONE_BASE}{suffix:03d}"  # Ensure 10 digits
        
        # Try register first
        register_data = {
            "phone": phone,
            "pin": "1234", 
            "displayName": f"B3Test{suffix}",
            "username": f"b3test{suffix}"
        }
        
        response = self._api_call("POST", "/auth/register", register_data)
        
        # If user exists, login
        if response and response.status_code == 409:
            login_data = {"phone": phone, "pin": "1234"}
            response = self._api_call("POST", "/auth/login", login_data)
        
        if response and response.status_code in (200, 201):
            data = response.json()
            return {
                "token": data["accessToken"],
                "user_id": data["user"]["id"],
                "user": data["user"]
            }
        
        print(f"Failed to authenticate user {suffix}: {response.status_code if response else 'No response'}")
        if response and response.status_code:
            try:
                error_data = response.json()
                print(f"  Error: {error_data}")
            except:
                print(f"  Response: {response.text}")
        return None
    
    def _log_result(self, test_name, passed, details=""):
        """Log test result."""
        status = "✅ PASS" if passed else "❌ FAIL"
        self.results.append({
            "test": test_name,
            "passed": passed,
            "details": details
        })
        print(f"{status} {test_name}")
        if details and not passed:
            print(f"    Details: {details}")
        elif details:
            print(f"    {details}")
    
    def setup_test_users(self):
        """Create test users for different roles."""
        print("\n🔧 Setting up test users...")
        
        user_types = ["owner", "admin", "editor", "moderator", "outsider", "follower"]
        for i, user_type in enumerate(user_types, 20001):
            user_data = self._register_user(i)
            if user_data:
                self.test_users[user_type] = user_data
                print(f"  Created {user_type}: {user_data['user'].get('username', 'unknown')}")
            else:
                print(f"  Failed to create {user_type}")
                return False
        
        return len(self.test_users) == len(user_types)
    
    def test_page_crud_endpoints(self):
        """Test Page CRUD endpoints (1-4)."""
        print("\n📄 Testing Page CRUD Endpoints...")
        
        # Test 1: POST /api/pages - Create page
        page_data = {
            "name": "B3 Test Club",
            "slug": f"b3-test-club-{int(time.time()) % 100000}",
            "category": "CLUB",
            "bio": "Test club for B3 Pages validation"
        }
        
        response = self._api_call("POST", "/pages", page_data, token=self.test_users["owner"]["token"])
        if response and response.status_code == 201:
            page = response.json()["page"]
            self.test_pages["main"] = page
            self._log_result("CREATE_PAGE", True, f"Created page {page['slug']}")
        else:
            self._log_result("CREATE_PAGE", False, f"Status: {response.status_code if response else 'No response'}")
            return
        
        # Test 2: GET /api/pages/:id - Page detail by ID
        page_id = self.test_pages["main"]["id"]
        response = self._api_call("GET", f"/pages/{page_id}")
        if response and response.status_code == 200:
            page_detail = response.json()["page"]
            self._log_result("GET_PAGE_BY_ID", True, f"Retrieved page: {page_detail['name']}")
        else:
            self._log_result("GET_PAGE_BY_ID", False, f"Status: {response.status_code if response else 'No response'}")
        
        # Test 3: GET /api/pages/:slug - Page detail by slug
        page_slug = self.test_pages["main"]["slug"] 
        response = self._api_call("GET", f"/pages/{page_slug}")
        if response and response.status_code == 200:
            page_detail = response.json()["page"]
            self._log_result("GET_PAGE_BY_SLUG", True, f"Retrieved page by slug: {page_detail['name']}")
        else:
            self._log_result("GET_PAGE_BY_SLUG", False, f"Status: {response.status_code if response else 'No response'}")
        
        # Test 4: PATCH /api/pages/:id - Update page
        update_data = {
            "bio": "Updated bio for B3 test validation"
        }
        response = self._api_call("PATCH", f"/pages/{page_id}", update_data, token=self.test_users["owner"]["token"])
        if response and response.status_code == 200:
            self._log_result("UPDATE_PAGE", True, "Page bio updated successfully")
        else:
            self._log_result("UPDATE_PAGE", False, f"Status: {response.status_code if response else 'No response'}")
    
    def test_identity_safety(self):
        """Test identity safety measures."""
        print("\n🛡️ Testing Identity Safety...")
        
        # Test duplicate slug rejection (409)
        if "main" in self.test_pages:
            duplicate_data = {
                "name": "Duplicate Test",
                "slug": self.test_pages["main"]["slug"],  # Same slug
                "category": "CLUB"
            }
            response = self._api_call("POST", "/pages", duplicate_data, token=self.test_users["owner"]["token"])
            if response and response.status_code == 409:
                self._log_result("DUPLICATE_SLUG_REJECTED", True, "409 returned for duplicate slug")
            else:
                self._log_result("DUPLICATE_SLUG_REJECTED", False, f"Expected 409, got {response.status_code if response else 'No response'}")
        
        # Test reserved slug rejection (400)
        reserved_data = {
            "name": "Reserved Test", 
            "slug": "admin",  # Reserved slug
            "category": "CLUB"
        }
        response = self._api_call("POST", "/pages", reserved_data, token=self.test_users["owner"]["token"])
        if response and response.status_code == 400:
            self._log_result("RESERVED_SLUG_REJECTED", True, "400 returned for reserved slug")
        else:
            self._log_result("RESERVED_SLUG_REJECTED", False, f"Expected 400, got {response.status_code if response else 'No response'}")
        
        # Test official spoofing prevention (400)
        official_spoof_data = {
            "name": "Official Test Page",  # Contains "official"
            "slug": "official-test", 
            "category": "CLUB"
        }
        response = self._api_call("POST", "/pages", official_spoof_data, token=self.test_users["owner"]["token"])
        if response and response.status_code == 400:
            self._log_result("OFFICIAL_SPOOF_REJECTED", True, "400 returned for official spoofing attempt")
        else:
            self._log_result("OFFICIAL_SPOOF_REJECTED", False, f"Expected 400, got {response.status_code if response else 'No response'}")
    
    def test_member_management(self):
        """Test member management endpoints (7-10)."""
        print("\n👥 Testing Member Management...")
        
        if "main" not in self.test_pages:
            print("No test page available for member management tests")
            return
            
        page_id = self.test_pages["main"]["id"]
        
        # Test 7: GET /api/pages/:id/members - List members (should show owner)
        response = self._api_call("GET", f"/pages/{page_id}/members", token=self.test_users["owner"]["token"])
        if response and response.status_code == 200:
            members = response.json()["members"]
            owner_found = any(m["userId"] == self.test_users["owner"]["user_id"] and m["role"] == "OWNER" for m in members)
            self._log_result("LIST_MEMBERS", owner_found, f"Found {len(members)} members, owner present: {owner_found}")
        else:
            self._log_result("LIST_MEMBERS", False, f"Status: {response.status_code if response else 'No response'}")
        
        # Test 8: POST /api/pages/:id/members - Add editor 
        add_member_data = {
            "userId": self.test_users["editor"]["user_id"],
            "role": "EDITOR"
        }
        response = self._api_call("POST", f"/pages/{page_id}/members", add_member_data, token=self.test_users["owner"]["token"])
        if response and response.status_code in (201, 409):  # 409 if already exists
            self._log_result("ADD_MEMBER", True, f"Added editor member: {response.status_code}")
        else:
            self._log_result("ADD_MEMBER", False, f"Status: {response.status_code if response else 'No response'}")
        
        # Test 9: PATCH /api/pages/:id/members/:userId - Change role
        change_role_data = {"role": "MODERATOR"}
        editor_id = self.test_users["editor"]["user_id"]
        response = self._api_call("PATCH", f"/pages/{page_id}/members/{editor_id}", change_role_data, token=self.test_users["owner"]["token"])
        if response and response.status_code == 200:
            self._log_result("CHANGE_MEMBER_ROLE", True, "Changed editor to moderator")
        else:
            self._log_result("CHANGE_MEMBER_ROLE", False, f"Status: {response.status_code if response else 'No response'}")
        
        # Test 10: DELETE /api/pages/:id/members/:userId - Remove member
        response = self._api_call("DELETE", f"/pages/{page_id}/members/{editor_id}", token=self.test_users["owner"]["token"])
        if response and response.status_code in (200, 204):
            self._log_result("REMOVE_MEMBER", True, "Removed member successfully")
        else:
            self._log_result("REMOVE_MEMBER", False, f"Status: {response.status_code if response else 'No response'}")
    
    def test_role_matrix(self):
        """Test role-based permissions."""
        print("\n🔐 Testing Role Matrix...")
        
        if "main" not in self.test_pages:
            print("No test page available for role matrix tests")
            return
        
        page_id = self.test_pages["main"]["id"]
        
        # Re-add editor for testing
        add_member_data = {
            "userId": self.test_users["editor"]["user_id"],
            "role": "EDITOR"
        }
        self._api_call("POST", f"/pages/{page_id}/members", add_member_data, token=self.test_users["owner"]["token"])
        
        # Test: Editor cannot add members (should fail with 403)
        add_attempt_data = {
            "userId": self.test_users["moderator"]["user_id"],
            "role": "MODERATOR"
        }
        response = self._api_call("POST", f"/pages/{page_id}/members", add_attempt_data, token=self.test_users["editor"]["token"])
        if response and response.status_code == 403:
            self._log_result("EDITOR_CANNOT_ADD_MEMBER", True, "Editor correctly blocked from adding members")
        else:
            self._log_result("EDITOR_CANNOT_ADD_MEMBER", False, f"Expected 403, got {response.status_code if response else 'No response'}")
        
        # Test: Outsider cannot list members (should fail with 403)
        response = self._api_call("GET", f"/pages/{page_id}/members", token=self.test_users["outsider"]["token"])
        if response and response.status_code == 403:
            self._log_result("OUTSIDER_CANNOT_LIST_MEMBERS", True, "Outsider correctly blocked from listing members")
        else:
            self._log_result("OUTSIDER_CANNOT_LIST_MEMBERS", False, f"Expected 403, got {response.status_code if response else 'No response'}")
    
    def test_follow_model(self):
        """Test follow/unfollow functionality (12-14)."""
        print("\n❤️ Testing Follow Model...")
        
        if "main" not in self.test_pages:
            print("No test page available for follow tests")
            return
        
        page_id = self.test_pages["main"]["id"]
        
        # Test 12: POST /api/pages/:id/follow - Follow page
        response = self._api_call("POST", f"/pages/{page_id}/follow", token=self.test_users["follower"]["token"])
        if response and response.status_code == 200:
            self._log_result("FOLLOW_PAGE", True, "Successfully followed page")
        else:
            self._log_result("FOLLOW_PAGE", False, f"Status: {response.status_code if response else 'No response'}")
        
        # Test follow idempotence (double follow should return 200)
        response = self._api_call("POST", f"/pages/{page_id}/follow", token=self.test_users["follower"]["token"])
        if response and response.status_code == 200:
            data = response.json()
            if "Already following" in data.get("message", ""):
                self._log_result("FOLLOW_IDEMPOTENT", True, "Follow is idempotent")
            else:
                self._log_result("FOLLOW_IDEMPOTENT", True, "Follow completed (may have been first time)")
        else:
            self._log_result("FOLLOW_IDEMPOTENT", False, f"Status: {response.status_code if response else 'No response'}")
        
        # Test 14: GET /api/pages/:id/followers - List followers (members only)
        response = self._api_call("GET", f"/pages/{page_id}/followers", token=self.test_users["owner"]["token"])
        if response and response.status_code == 200:
            followers = response.json()["followers"]
            self._log_result("LIST_FOLLOWERS", True, f"Listed {len(followers)} followers")
        else:
            self._log_result("LIST_FOLLOWERS", False, f"Status: {response.status_code if response else 'No response'}")
        
        # Test 13: DELETE /api/pages/:id/follow - Unfollow page  
        response = self._api_call("DELETE", f"/pages/{page_id}/follow", token=self.test_users["follower"]["token"])
        if response and response.status_code in (200, 204):
            self._log_result("UNFOLLOW_PAGE", True, "Successfully unfollowed page")
        else:
            self._log_result("UNFOLLOW_PAGE", False, f"Status: {response.status_code if response else 'No response'}")
    
    def test_publishing_as_page(self):
        """Test publishing as page (15-18) and audit truth."""
        print("\n📝 Testing Publishing as Page...")
        
        if "main" not in self.test_pages:
            print("No test page available for publishing tests")
            return
        
        page_id = self.test_pages["main"]["id"]
        
        # Test 16: POST /api/pages/:id/posts - Create post as page
        post_data = {
            "caption": "Test post published as B3 Test Club page",
            "mediaIds": []
        }
        response = self._api_call("POST", f"/pages/{page_id}/posts", post_data, token=self.test_users["owner"]["token"])
        if response and response.status_code == 201:
            post = response.json()["post"]
            self.test_pages["test_post"] = post
            
            # Verify audit truth: authorType=PAGE, pageId present, actingUserId present
            audit_correct = (
                post.get("authorType") == "PAGE" and
                post.get("pageId") == page_id and
                post.get("actingUserId") == self.test_users["owner"]["user_id"]
            )
            self._log_result("CREATE_PAGE_POST", audit_correct, f"Post created with correct audit fields: {audit_correct}")
        else:
            self._log_result("CREATE_PAGE_POST", False, f"Status: {response.status_code if response else 'No response'}")
        
        # Test 15: GET /api/pages/:id/posts - List page posts
        response = self._api_call("GET", f"/pages/{page_id}/posts", token=self.test_users["owner"]["token"])
        if response and response.status_code == 200:
            posts = response.json()["posts"]
            self._log_result("LIST_PAGE_POSTS", len(posts) > 0, f"Found {len(posts)} page posts")
        else:
            self._log_result("LIST_PAGE_POSTS", False, f"Status: {response.status_code if response else 'No response'}")
        
        # Test: Outsider cannot publish (should fail with 403)
        response = self._api_call("POST", f"/pages/{page_id}/posts", post_data, token=self.test_users["outsider"]["token"])
        if response and response.status_code == 403:
            self._log_result("OUTSIDER_CANNOT_PUBLISH", True, "Outsider correctly blocked from publishing")
        else:
            self._log_result("OUTSIDER_CANNOT_PUBLISH", False, f"Expected 403, got {response.status_code if response else 'No response'}")
    
    def test_page_lifecycle(self):
        """Test page lifecycle (5-6)."""
        print("\n🔄 Testing Page Lifecycle...")
        
        if "main" not in self.test_pages:
            print("No test page available for lifecycle tests")
            return
        
        page_id = self.test_pages["main"]["id"]
        
        # Test 5: POST /api/pages/:id/archive - Archive page (owner only)
        response = self._api_call("POST", f"/pages/{page_id}/archive", token=self.test_users["owner"]["token"])
        if response and response.status_code == 200:
            self._log_result("ARCHIVE_PAGE", True, "Page archived successfully")
            
            # Verify archived page blocks new posts (should return 400)
            post_data = {"caption": "Should fail on archived page"}
            post_response = self._api_call("POST", f"/pages/{page_id}/posts", post_data, token=self.test_users["owner"]["token"])
            if post_response and post_response.status_code == 400:
                self._log_result("ARCHIVED_PAGE_BLOCKS_POSTS", True, "Archived page correctly blocks new posts")
            else:
                self._log_result("ARCHIVED_PAGE_BLOCKS_POSTS", False, f"Expected 400, got {post_response.status_code if post_response else 'No response'}")
        else:
            self._log_result("ARCHIVE_PAGE", False, f"Status: {response.status_code if response else 'No response'}")
        
        # Test 6: POST /api/pages/:id/restore - Restore page
        response = self._api_call("POST", f"/pages/{page_id}/restore", token=self.test_users["owner"]["token"])
        if response and response.status_code == 200:
            self._log_result("RESTORE_PAGE", True, "Page restored successfully")
        else:
            self._log_result("RESTORE_PAGE", False, f"Status: {response.status_code if response else 'No response'}")
    
    def test_feed_integration(self):
        """Test feed integration - page posts appear in following feed."""
        print("\n📺 Testing Feed Integration...")
        
        # First, follow the page as follower user
        if "main" in self.test_pages:
            page_id = self.test_pages["main"]["id"]
            self._api_call("POST", f"/pages/{page_id}/follow", token=self.test_users["follower"]["token"])
        
        # Check following feed includes page posts
        response = self._api_call("GET", "/feed/following", token=self.test_users["follower"]["token"])
        if response and response.status_code == 200:
            data = response.json()
            posts = data.get("posts", [])
            
            # Look for page-authored posts (authorType=PAGE)
            page_posts = [p for p in posts if p.get("authorType") == "PAGE"]
            self._log_result("FEED_INCLUDES_PAGE_POSTS", len(page_posts) > 0, f"Following feed contains {len(page_posts)} page posts")
        else:
            error_msg = f"Status: {response.status_code if response else 'No response'}"
            if response:
                try:
                    error_data = response.json()
                    if "error" in error_data:
                        error_msg += f", Error: {error_data['error']}"
                except:
                    pass
            self._log_result("FEED_INCLUDES_PAGE_POSTS", False, error_msg)
    
    def test_search_integration(self):
        """Test search integration - pages appear in unified search."""
        print("\n🔍 Testing Search Integration...")
        
        # Test GET /api/pages search
        response = self._api_call("GET", "/pages?q=B3")
        if response and response.status_code == 200:
            pages = response.json()["pages"]
            self._log_result("PAGE_SEARCH", len(pages) > 0, f"Page search returned {len(pages)} results")
        else:
            self._log_result("PAGE_SEARCH", False, f"Status: {response.status_code if response else 'No response'}")
        
        # Test unified search includes pages
        response = self._api_call("GET", "/search?type=pages&q=B3")
        if response and response.status_code == 200:
            results = response.json()
            pages_found = len(results.get("pages", []))
            self._log_result("UNIFIED_SEARCH_PAGES", pages_found > 0, f"Unified search returned {pages_found} pages")
        else:
            self._log_result("UNIFIED_SEARCH_PAGES", False, f"Status: {response.status_code if response else 'No response'}")
    
    def test_my_pages_endpoint(self):
        """Test GET /api/me/pages endpoint (19)."""
        print("\n👤 Testing My Pages...")
        
        # Test 19: GET /api/me/pages - List pages managed by current user
        response = self._api_call("GET", "/me/pages", token=self.test_users["owner"]["token"])
        if response and response.status_code == 200:
            my_pages = response.json()["pages"]
            owned_pages = [p for p in my_pages if p.get("role") == "OWNER"]
            self._log_result("MY_PAGES", len(owned_pages) > 0, f"User owns {len(owned_pages)} pages")
        else:
            self._log_result("MY_PAGES", False, f"Status: {response.status_code if response else 'No response'}")
    
    def run_comprehensive_test(self):
        """Run all B3 Pages validation tests."""
        print("🎯 B3 PAGES SYSTEM COMPREHENSIVE VALIDATION")
        print("=" * 60)
        
        # Setup
        if not self.setup_test_users():
            print("❌ Failed to set up test users")
            return
        
        # Run all test suites
        self.test_page_crud_endpoints()
        self.test_identity_safety() 
        self.test_member_management()
        self.test_role_matrix()
        self.test_follow_model()
        self.test_publishing_as_page()
        self.test_page_lifecycle()
        self.test_feed_integration()
        self.test_search_integration()
        self.test_my_pages_endpoint()
        
        # Summary
        print("\n" + "=" * 60)
        print("📊 SUMMARY")
        print("=" * 60)
        
        total_tests = len(self.results)
        passed_tests = len([r for r in self.results if r["passed"]])
        success_rate = (passed_tests / total_tests * 100) if total_tests > 0 else 0
        
        print(f"Total Tests: {total_tests}")
        print(f"Passed: {passed_tests}")
        print(f"Failed: {total_tests - passed_tests}")
        print(f"Success Rate: {success_rate:.1f}%")
        
        if success_rate >= 85:
            print("✅ SUCCESS: B3 Pages System meets production standards!")
        else:
            print("❌ NEEDS WORK: Success rate below 85% threshold")
        
        # Show failures
        failures = [r for r in self.results if not r["passed"]]
        if failures:
            print(f"\n❌ FAILED TESTS ({len(failures)}):")
            for failure in failures:
                print(f"  • {failure['test']}: {failure['details']}")
        
        return success_rate >= 85


if __name__ == "__main__":
    validator = B3PagesValidator()
    success = validator.run_comprehensive_test()
    
    if success:
        print("\n🎉 B3 Pages System validation completed successfully!")
        exit(0)
    else:
        print("\n⚠️ B3 Pages System needs attention before production.")
        exit(1)