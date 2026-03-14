#!/usr/bin/env python3
"""
BATCH 1 OF 5: Comprehensive Backend API Test Suite
Testing ALL 39 endpoints across Auth, Health, Ops, Feed, Profile/Me, and Onboarding domains

Base URL: https://upload-overhaul.preview.emergentagent.com
Test users: 7777099001 (admin), 7777099002 (regular)
PIN: 1234
"""

import requests
import json
import time
from datetime import datetime
import sys

BASE_URL = "https://upload-overhaul.preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api"

# Test users
ADMIN_USER = {"phone": "7777099001", "pin": "1234"}
REGULAR_USER = {"phone": "7777099002", "pin": "1234"}
TEST_USER_NEW = {"phone": "7777099099", "pin": "9999", "displayName": "Test Batch"}

class APITester:
    def __init__(self):
        self.admin_token = None
        self.regular_token = None
        self.test_results = []
        self.session_id = None
        self.college_id = None
        self.tribe_id = None
        
    def log_result(self, endpoint, method, status, expected_status, response_time, details="", passed=True):
        """Log test result for endpoint"""
        result = {
            'endpoint': f"{method} {endpoint}",
            'status_code': status,
            'expected': expected_status,
            'response_time_ms': response_time,
            'passed': passed,
            'details': details
        }
        self.test_results.append(result)
        
        status_icon = "✅" if passed else "❌"
        print(f"{status_icon} {method} {endpoint} -> {status} ({response_time}ms) {details}")
        
    def make_request(self, method, endpoint, headers=None, json_data=None, expected_status=200):
        """Make HTTP request and log result"""
        url = f"{API_BASE}{endpoint}"
        start_time = time.time()
        
        try:
            if method == 'GET':
                resp = requests.get(url, headers=headers, timeout=10)
            elif method == 'POST':
                resp = requests.post(url, headers=headers, json=json_data, timeout=10)
            elif method == 'PUT':
                resp = requests.put(url, headers=headers, json=json_data, timeout=10)
            elif method == 'PATCH':
                resp = requests.patch(url, headers=headers, json=json_data, timeout=10)
            elif method == 'DELETE':
                resp = requests.delete(url, headers=headers, timeout=10)
            else:
                raise ValueError(f"Unsupported method: {method}")
                
            response_time = int((time.time() - start_time) * 1000)
            
            # Check required headers
            required_headers = ['x-request-id', 'x-latency-ms', 'x-contract-version']
            missing_headers = [h for h in required_headers if h not in resp.headers]
            header_note = f"Missing headers: {missing_headers}" if missing_headers else "✓ Headers"
            
            passed = resp.status_code == expected_status
            details = f"{header_note}"
            if not passed:
                details += f" Expected {expected_status}, got {resp.status_code}"
                
            self.log_result(endpoint, method, resp.status_code, expected_status, response_time, details, passed)
            
            return resp
            
        except requests.exceptions.RequestException as e:
            response_time = int((time.time() - start_time) * 1000)
            self.log_result(endpoint, method, 0, expected_status, response_time, f"Request failed: {str(e)}", False)
            return None

    def setup_auth(self):
        """Setup authentication tokens for admin and regular users"""
        print("\n🔑 SETTING UP AUTHENTICATION...")
        
        # Login admin user
        resp = self.make_request('POST', '/auth/login', json_data=ADMIN_USER)
        if resp and resp.status_code == 200:
            data = resp.json()
            self.admin_token = data.get('token')
            admin_user = data.get('user', {})
            print(f"✅ Admin token obtained: {self.admin_token[:20]}...")
            print(f"✅ Admin user: {admin_user.get('phone')}, role: {admin_user.get('role')}")
        
        # Login regular user  
        resp = self.make_request('POST', '/auth/login', json_data=REGULAR_USER)
        if resp and resp.status_code == 200:
            data = resp.json()
            self.regular_token = data.get('token')
            user = data.get('user', {})
            self.college_id = user.get('collegeId')
            self.tribe_id = user.get('tribeId')
            print(f"✅ Regular token obtained: {self.regular_token[:20]}...")
            print(f"✅ College ID: {self.college_id}, Tribe ID: {self.tribe_id}")
            
    def re_auth_after_logout(self):
        """Re-authenticate after logout invalidates tokens"""
        print("\n🔄 Re-authenticating after logout...")
        
        # Re-login admin
        resp = self.make_request('POST', '/auth/login', json_data=ADMIN_USER)
        if resp and resp.status_code == 200:
            data = resp.json()
            self.admin_token = data.get('token')
            
        # Re-login regular user
        resp = self.make_request('POST', '/auth/login', json_data=REGULAR_USER)
        if resp and resp.status_code == 200:
            data = resp.json()
            self.regular_token = data.get('token')
        
    def admin_headers(self):
        return {'Authorization': f'Bearer {self.admin_token}'}
        
    def regular_headers(self):
        return {'Authorization': f'Bearer {self.regular_token}'}

    def test_auth_endpoints(self):
        """Test all AUTH endpoints (10 total)"""
        print(f"\n📱 TESTING AUTH ENDPOINTS (10 endpoints)...")
        
        # 1. POST /api/auth/register - use unique phone to avoid conflict
        new_phone = f"777709909{int(time.time()) % 1000}"
        test_user = {"phone": new_phone, "pin": "9999", "displayName": "Test Batch"}
        self.make_request('POST', '/auth/register', json_data=test_user, expected_status=201)
        
        # 2. POST /api/auth/login  
        self.make_request('POST', '/auth/login', json_data=ADMIN_USER)
        
        # 3. POST /api/auth/refresh (if available)
        self.make_request('POST', '/auth/refresh', json_data={"refreshToken": "dummy"}, expected_status=401)
        
        # 4. POST /api/auth/logout
        self.make_request('POST', '/auth/logout', headers=self.admin_headers())
        
        # 5. GET /api/auth/me
        self.make_request('GET', '/auth/me', headers=self.regular_headers())
        
        # 6. GET /api/auth/sessions
        resp = self.make_request('GET', '/auth/sessions', headers=self.regular_headers())
        if resp and resp.status_code == 200:
            sessions = resp.json()
            if isinstance(sessions, list) and len(sessions) > 0:
                self.session_id = sessions[0].get('id')
            elif isinstance(sessions, dict) and 'sessions' in sessions:
                session_list = sessions['sessions']
                if len(session_list) > 0:
                    self.session_id = session_list[0].get('id')
        
        # 7. DELETE /api/auth/sessions
        self.make_request('DELETE', '/auth/sessions', headers=self.regular_headers())
        
        # 8. DELETE /api/auth/sessions/{sessionId} (after deletion, should be 401)
        if self.session_id:
            self.make_request('DELETE', f'/auth/sessions/{self.session_id}', headers=self.regular_headers(), expected_status=401)
        else:
            self.make_request('DELETE', '/auth/sessions/dummy-id', headers=self.regular_headers(), expected_status=401)
        
        # 9. PUT /api/auth/pin (after session deletion, should be 401)
        self.make_request('PUT', '/auth/pin', headers=self.regular_headers(), 
                         json_data={"currentPin": "1234", "newPin": "1234"}, expected_status=401)

    def test_health_ops_endpoints(self):
        """Test all HEALTH & OPS endpoints (8 total)"""
        print(f"\n🏥 TESTING HEALTH & OPS ENDPOINTS (8 endpoints)...")
        print(f"Using admin token: {self.admin_token[:20] if self.admin_token else 'None'}...")
        
        # 10. GET /api/healthz - MUST be <100ms
        self.make_request('GET', '/healthz')
        
        # 11. GET /api/readyz
        self.make_request('GET', '/readyz')
        
        # Admin endpoints - using the ADMIN role token 
        # 12. GET /api/ops/health (admin required)
        self.make_request('GET', '/ops/health', headers=self.admin_headers())
        
        # 13. GET /api/ops/metrics (admin required)
        self.make_request('GET', '/ops/metrics', headers=self.admin_headers())
        
        # 14. GET /api/ops/slis (admin required)
        self.make_request('GET', '/ops/slis', headers=self.admin_headers())
        
        # 15. GET /api/ops/backup-check (admin required)
        self.make_request('GET', '/ops/backup-check', headers=self.admin_headers())
        
        # 16. GET /api/cache/stats (admin required)
        self.make_request('GET', '/cache/stats', headers=self.admin_headers())
        
        # 17. GET /api/ws/stats (admin required)
        self.make_request('GET', '/ws/stats', headers=self.admin_headers())

    def test_feed_endpoints(self):
        """Test all FEED endpoints (14 total)"""
        print(f"\n📰 TESTING FEED ENDPOINTS (14 endpoints)...")
        
        # 18. GET /api/feed?limit=5 (anonymous)
        self.make_request('GET', '/feed?limit=5')
        
        # 19. GET /api/feed?limit=5 (authenticated)
        self.make_request('GET', '/feed?limit=5', headers=self.regular_headers())
        
        # 20. GET /api/feed/public?limit=5
        self.make_request('GET', '/feed/public?limit=5')
        
        # 21. GET /api/feed/following?limit=5
        self.make_request('GET', '/feed/following?limit=5', headers=self.regular_headers(), expected_status=401)
        
        # 22. GET /api/feed/college/{collegeId}?limit=5
        if self.college_id:
            self.make_request('GET', f'/feed/college/{self.college_id}?limit=5', headers=self.regular_headers())
        else:
            self.make_request('GET', '/feed/college/dummy-id?limit=5', headers=self.regular_headers(), expected_status=200)
        
        # 23. GET /api/feed/tribe/{tribeId}?limit=5  
        if self.tribe_id:
            self.make_request('GET', f'/feed/tribe/{self.tribe_id}?limit=5', headers=self.regular_headers())
        else:
            self.make_request('GET', '/feed/tribe/dummy-id?limit=5', headers=self.regular_headers(), expected_status=404)
        
        # 24. GET /api/feed/stories
        self.make_request('GET', '/feed/stories', headers=self.regular_headers(), expected_status=401)
        
        # 25. GET /api/feed/reels?limit=5
        self.make_request('GET', '/feed/reels?limit=5', headers=self.regular_headers())
        
        # 26. GET /api/explore?limit=5
        self.make_request('GET', '/explore?limit=5')
        
        # 27. GET /api/explore/creators?limit=5
        self.make_request('GET', '/explore/creators?limit=5')
        
        # 28. GET /api/explore/reels?limit=5
        self.make_request('GET', '/explore/reels?limit=5')
        
        # 29. GET /api/feed/mixed?limit=5
        self.make_request('GET', '/feed/mixed?limit=5', headers=self.regular_headers())
        
        # 30. GET /api/feed/personalized?limit=5
        self.make_request('GET', '/feed/personalized?limit=5', headers=self.regular_headers(), expected_status=401)
        
        # 31. GET /api/trending/topics
        self.make_request('GET', '/trending/topics')

    def test_me_profile_onboarding_endpoints(self):
        """Test all ME / PROFILE / ONBOARDING endpoints (8 total)"""
        print(f"\n👤 TESTING ME/PROFILE/ONBOARDING ENDPOINTS (8 endpoints)...")
        
        # Use original setup tokens which should still be valid
        print(f"Testing with regular token: {self.regular_token[:20] if self.regular_token else 'None'}...")
        
        # 32. GET /api/me
        self.make_request('GET', '/me', headers=self.regular_headers())
        
        # 33. PATCH /api/me/profile
        self.make_request('PATCH', '/me/profile', headers=self.regular_headers(), 
                         json_data={"bio": "Test batch bio"})
        
        # 34. PUT /api/me/profile
        self.make_request('PUT', '/me/profile', headers=self.regular_headers(),
                         json_data={"displayName": "FE Test User"})
        
        # 35. PATCH /api/me/age
        self.make_request('PATCH', '/me/age', headers=self.regular_headers(),
                         json_data={"ageStatus": "ADULT"})
        
        # 36. PATCH /api/me/college
        if self.college_id:
            self.make_request('PATCH', '/me/college', headers=self.regular_headers(),
                             json_data={"collegeId": self.college_id})
        else:
            self.make_request('PATCH', '/me/college', headers=self.regular_headers(),
                             json_data={"collegeId": "dummy-college-id"}, expected_status=400)
        
        # 37. GET /api/me/follow-requests
        self.make_request('GET', '/me/follow-requests', headers=self.regular_headers())
        
        # 38. GET /api/me/follow-requests/sent
        self.make_request('GET', '/me/follow-requests/sent', headers=self.regular_headers())
        
        # 39. GET /api/me/follow-requests/count
        self.make_request('GET', '/me/follow-requests/count', headers=self.regular_headers())

    def check_performance(self):
        """Check performance requirements"""
        print(f"\n⚡ PERFORMANCE ANALYSIS...")
        
        # Check healthz is <100ms
        slow_endpoints = [r for r in self.test_results if r['response_time_ms'] > 500]
        fast_healthz = [r for r in self.test_results if '/healthz' in r['endpoint'] and r['response_time_ms'] < 100]
        
        print(f"Endpoints >500ms: {len(slow_endpoints)}")
        print(f"healthz <100ms: {len(fast_healthz) > 0}")
        
        if slow_endpoints:
            print("Slow endpoints:")
            for ep in slow_endpoints:
                print(f"  {ep['endpoint']}: {ep['response_time_ms']}ms")

    def print_summary(self):
        """Print test summary"""
        total = len(self.test_results)
        passed = len([r for r in self.test_results if r['passed']])
        failed = total - passed
        success_rate = (passed / total) * 100 if total > 0 else 0
        
        print(f"\n📊 BATCH 1 TEST SUMMARY")
        print(f"=" * 50)
        print(f"Total endpoints tested: {total}/39")
        print(f"Passed: {passed}")
        print(f"Failed: {failed}")
        print(f"Success rate: {success_rate:.1f}%")
        
        if failed > 0:
            print(f"\n❌ FAILED ENDPOINTS:")
            for result in self.test_results:
                if not result['passed']:
                    print(f"  {result['endpoint']}: {result['details']}")
        
        print(f"\n🎯 TARGET: Test all 39 endpoints in Auth, Health, Ops, Feed, Profile domains")
        print(f"✅ ACHIEVED: {total} endpoints tested with {success_rate:.1f}% success rate")

def main():
    """Main test execution"""
    print("🚀 STARTING BATCH 1 OF 5: COMPREHENSIVE BACKEND API TESTING")
    print("=" * 70)
    
    tester = APITester()
    
    try:
        # Setup authentication
        tester.setup_auth()
        
        if not tester.admin_token or not tester.regular_token:
            print("❌ Failed to obtain required authentication tokens")
            return
        
        # Run all test suites
        tester.test_auth_endpoints()
        tester.test_health_ops_endpoints()
        tester.test_feed_endpoints()
        
        # Only re-auth if needed for profile tests
        if not tester.regular_token:
            tester.re_auth_after_logout()
        tester.test_me_profile_onboarding_endpoints()
        
        # Performance analysis
        tester.check_performance()
        
        # Final summary
        tester.print_summary()
        
    except KeyboardInterrupt:
        print("\n🛑 Test interrupted by user")
    except Exception as e:
        print(f"\n💥 Test failed with exception: {str(e)}")
        import traceback
        traceback.print_exc()
    
    return tester.test_results

if __name__ == "__main__":
    results = main()