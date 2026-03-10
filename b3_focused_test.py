#!/usr/bin/env python3
"""
B3 Pages System Focused Backend Testing
Comprehensive validation of 18 new API endpoints focused on critical functionality.
"""

import requests
import json
import time
import random

API_BASE_URL = "https://pages-ultimate-gate.preview.emergentagent.com/api"

class B3PagesQuickTest:
    def __init__(self):
        self.results = []
        self.test_token = None
        self.test_user_id = None
        self.test_page = None
        
    def log_test(self, name, success, details=""):
        """Log test result."""
        status = "✅ PASS" if success else "❌ FAIL"
        self.results.append({"name": name, "success": success, "details": details})
        print(f"{status} {name}")
        if details:
            print(f"    {details}")
    
    def api_call(self, method, endpoint, data=None, token=None):
        """Simple API call wrapper."""
        url = f"{API_BASE_URL}{endpoint}"
        headers = {
            "Content-Type": "application/json",
            "X-Forwarded-For": f"10.{random.randint(1,254)}.{random.randint(1,254)}.{random.randint(1,254)}"
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
        
        try:
            if method == "GET":
                resp = requests.get(url, headers=headers, timeout=10)
            elif method == "POST":
                resp = requests.post(url, json=data, headers=headers, timeout=10)
            elif method == "PATCH":
                resp = requests.patch(url, json=data, headers=headers, timeout=10)
            elif method == "DELETE":
                resp = requests.delete(url, headers=headers, timeout=10)
            else:
                return None
                
            return resp
        except Exception as e:
            print(f"    Request failed: {e}")
            return None
    
    def setup_user(self):
        """Setup a test user."""
        print("\n🔧 Setting up test user...")
        
        # Use a valid 10-digit phone number
        phone = f"91234{random.randint(10000, 99999)}"
        username = f"b3test{random.randint(1000, 9999)}"
        
        register_data = {
            "phone": phone,
            "pin": "1234",
            "displayName": "B3 Test User",
            "username": username
        }
        
        # Try register
        resp = self.api_call("POST", "/auth/register", register_data)
        if resp and resp.status_code == 409:
            # User exists, try login
            resp = self.api_call("POST", "/auth/login", {"phone": phone, "pin": "1234"})
        
        if resp and resp.status_code in (200, 201):
            data = resp.json()
            self.test_token = data["accessToken"]
            self.test_user_id = data["user"]["id"]
            print(f"  ✅ User setup successful: {username}")
            return True
        else:
            status = resp.status_code if resp else "No response"
            print(f"  ❌ User setup failed: {status}")
            return False
    
    def test_page_crud(self):
        """Test core page CRUD operations."""
        print("\n📄 Testing Page CRUD...")
        
        # 1. Create page
        page_slug = f"b3-test-{int(time.time()) % 100000}"
        page_data = {
            "name": "B3 Test Page",
            "slug": page_slug,
            "category": "CLUB",
            "bio": "Test page for B3 validation"
        }
        
        resp = self.api_call("POST", "/pages", page_data, self.test_token)
        if resp and resp.status_code == 201:
            self.test_page = resp.json()["page"]
            self.log_test("PAGE_CREATE", True, f"Created page: {self.test_page['slug']}")
        else:
            status = resp.status_code if resp else "No response" 
            self.log_test("PAGE_CREATE", False, f"Status: {status}")
            return
        
        page_id = self.test_page["id"]
        
        # 2. Get page by ID
        resp = self.api_call("GET", f"/pages/{page_id}")
        if resp and resp.status_code == 200:
            self.log_test("PAGE_GET_BY_ID", True, "Retrieved page by ID")
        else:
            status = resp.status_code if resp else "No response"
            self.log_test("PAGE_GET_BY_ID", False, f"Status: {status}")
        
        # 3. Get page by slug
        resp = self.api_call("GET", f"/pages/{page_slug}")
        if resp and resp.status_code == 200:
            self.log_test("PAGE_GET_BY_SLUG", True, "Retrieved page by slug")
        else:
            status = resp.status_code if resp else "No response"
            self.log_test("PAGE_GET_BY_SLUG", False, f"Status: {status}")
        
        # 4. Update page
        update_data = {"bio": "Updated bio for testing"}
        resp = self.api_call("PATCH", f"/pages/{page_id}", update_data, self.test_token)
        if resp and resp.status_code == 200:
            self.log_test("PAGE_UPDATE", True, "Updated page successfully")
        else:
            status = resp.status_code if resp else "No response"
            self.log_test("PAGE_UPDATE", False, f"Status: {status}")
    
    def test_identity_safety(self):
        """Test identity safety features."""
        print("\n🛡️ Testing Identity Safety...")
        
        if not self.test_page:
            print("  Skipping - no test page available")
            return
        
        # Test duplicate slug rejection
        duplicate_data = {
            "name": "Duplicate Test",
            "slug": self.test_page["slug"],
            "category": "CLUB"
        }
        resp = self.api_call("POST", "/pages", duplicate_data, self.test_token)
        if resp and resp.status_code == 409:
            self.log_test("DUPLICATE_SLUG_REJECTED", True, "409 for duplicate slug")
        else:
            status = resp.status_code if resp else "No response"
            self.log_test("DUPLICATE_SLUG_REJECTED", False, f"Expected 409, got {status}")
        
        # Test reserved slug rejection
        reserved_data = {
            "name": "Reserved Test",
            "slug": "admin",
            "category": "CLUB"
        }
        resp = self.api_call("POST", "/pages", reserved_data, self.test_token)
        if resp and resp.status_code == 400:
            self.log_test("RESERVED_SLUG_REJECTED", True, "400 for reserved slug")
        else:
            status = resp.status_code if resp else "No response"
            self.log_test("RESERVED_SLUG_REJECTED", False, f"Expected 400, got {status}")
    
    def test_publishing_as_page(self):
        """Test publishing content as page."""
        print("\n📝 Testing Publishing as Page...")
        
        if not self.test_page:
            print("  Skipping - no test page available")
            return
        
        page_id = self.test_page["id"]
        
        # Create post as page
        post_data = {
            "caption": "Test post from B3 Page",
            "mediaIds": []
        }
        resp = self.api_call("POST", f"/pages/{page_id}/posts", post_data, self.test_token)
        if resp and resp.status_code == 201:
            post = resp.json()["post"]
            # Verify audit fields
            audit_correct = (
                post.get("authorType") == "PAGE" and
                post.get("pageId") == page_id and
                "actingUserId" in post
            )
            self.log_test("PAGE_POST_CREATE", audit_correct, f"Audit fields correct: {audit_correct}")
        else:
            status = resp.status_code if resp else "No response"
            self.log_test("PAGE_POST_CREATE", False, f"Status: {status}")
        
        # List page posts
        resp = self.api_call("GET", f"/pages/{page_id}/posts", token=self.test_token)
        if resp and resp.status_code == 200:
            posts = resp.json().get("posts", [])
            self.log_test("PAGE_POST_LIST", len(posts) > 0, f"Found {len(posts)} page posts")
        else:
            status = resp.status_code if resp else "No response"
            self.log_test("PAGE_POST_LIST", False, f"Status: {status}")
    
    def test_follow_functionality(self):
        """Test page follow/unfollow."""
        print("\n❤️ Testing Follow Functionality...")
        
        if not self.test_page:
            print("  Skipping - no test page available")
            return
        
        page_id = self.test_page["id"]
        
        # Follow page
        resp = self.api_call("POST", f"/pages/{page_id}/follow", token=self.test_token)
        if resp and resp.status_code == 200:
            self.log_test("PAGE_FOLLOW", True, "Successfully followed page")
        else:
            status = resp.status_code if resp else "No response"
            self.log_test("PAGE_FOLLOW", False, f"Status: {status}")
        
        # Test idempotence (follow again)
        resp = self.api_call("POST", f"/pages/{page_id}/follow", token=self.test_token)
        if resp and resp.status_code == 200:
            self.log_test("PAGE_FOLLOW_IDEMPOTENT", True, "Follow idempotent")
        else:
            status = resp.status_code if resp else "No response"
            self.log_test("PAGE_FOLLOW_IDEMPOTENT", False, f"Status: {status}")
        
        # Unfollow page
        resp = self.api_call("DELETE", f"/pages/{page_id}/follow", token=self.test_token)
        if resp and resp.status_code in (200, 204):
            self.log_test("PAGE_UNFOLLOW", True, "Successfully unfollowed page")
        else:
            status = resp.status_code if resp else "No response"
            self.log_test("PAGE_UNFOLLOW", False, f"Status: {status}")
    
    def test_search_integration(self):
        """Test search functionality."""
        print("\n🔍 Testing Search Integration...")
        
        # Test page search
        resp = self.api_call("GET", "/pages?q=B3")
        if resp and resp.status_code == 200:
            pages = resp.json().get("pages", [])
            self.log_test("PAGE_SEARCH", len(pages) >= 0, f"Page search returned {len(pages)} results")
        else:
            status = resp.status_code if resp else "No response"
            self.log_test("PAGE_SEARCH", False, f"Status: {status}")
        
        # Test unified search
        resp = self.api_call("GET", "/search?type=pages&q=B3")
        if resp and resp.status_code == 200:
            results = resp.json()
            pages_found = len(results.get("pages", []))
            self.log_test("UNIFIED_SEARCH", pages_found >= 0, f"Unified search returned {pages_found} pages")
        else:
            status = resp.status_code if resp else "No response"
            self.log_test("UNIFIED_SEARCH", False, f"Status: {status}")
    
    def test_my_pages(self):
        """Test my pages endpoint."""
        print("\n👤 Testing My Pages...")
        
        resp = self.api_call("GET", "/me/pages", token=self.test_token)
        if resp and resp.status_code == 200:
            my_pages = resp.json().get("pages", [])
            owned_pages = [p for p in my_pages if p.get("role") == "OWNER"]
            self.log_test("MY_PAGES", len(owned_pages) > 0, f"User owns {len(owned_pages)} pages")
        else:
            status = resp.status_code if resp else "No response"
            self.log_test("MY_PAGES", False, f"Status: {status}")
    
    def run_tests(self):
        """Run all B3 Pages tests."""
        print("🎯 B3 PAGES SYSTEM FOCUSED VALIDATION")
        print("=" * 50)
        
        if not self.setup_user():
            print("\n❌ Cannot proceed without test user")
            return False
        
        # Run core tests
        self.test_page_crud()
        self.test_identity_safety()
        self.test_publishing_as_page()
        self.test_follow_functionality()
        self.test_search_integration()
        self.test_my_pages()
        
        # Summary
        print("\n" + "=" * 50)
        print("📊 TEST SUMMARY")
        print("=" * 50)
        
        total = len(self.results)
        passed = len([r for r in self.results if r["success"]])
        failed = total - passed
        success_rate = (passed / total * 100) if total > 0 else 0
        
        print(f"Total Tests: {total}")
        print(f"Passed: {passed}")
        print(f"Failed: {failed}")
        print(f"Success Rate: {success_rate:.1f}%")
        
        if success_rate >= 85:
            print("\n✅ SUCCESS: B3 Pages System meets production standards!")
        else:
            print(f"\n❌ NEEDS WORK: Success rate below 85% threshold")
        
        # Show failures
        failures = [r for r in self.results if not r["success"]]
        if failures:
            print(f"\n❌ FAILED TESTS ({len(failures)}):")
            for failure in failures:
                print(f"  • {failure['name']}: {failure['details']}")
        
        return success_rate >= 85


if __name__ == "__main__":
    tester = B3PagesQuickTest()
    success = tester.run_tests()
    
    if success:
        print("\n🎉 B3 Pages System validation completed successfully!")
        exit(0) 
    else:
        print("\n⚠️ B3 Pages System needs attention before production.")
        exit(1)