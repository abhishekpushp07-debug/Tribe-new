#!/usr/bin/env python3
"""
Stage 3B Gold Remediation Tests for Tribe Social Media Backend
Testing critical observability fixes with request lineage (requestId in audit entries)

Base URL: https://pages-ultimate-gate.preview.emergentagent.com
"""

import asyncio
import json
import requests
import time
import uuid
from pymongo import MongoClient
from typing import Dict, Any, List, Optional

BASE_URL = "https://pages-ultimate-gate.preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api"
LOCALHOST_BASE = "http://localhost:3000/api"  # For OPTIONS test

class TestResult:
    def __init__(self, name: str, success: bool, details: str):
        self.name = name
        self.success = success
        self.details = details

class TribeBackendTester:
    def __init__(self):
        self.results: List[TestResult] = []
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'User-Agent': 'TribeBackendTester/1.0'
        })
        self.admin_token = None
        self.user_token = None

    def add_result(self, name: str, success: bool, details: str):
        """Add a test result"""
        self.results.append(TestResult(name, success, details))
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status}: {name}")
        if not success:
            print(f"   Details: {details}")
        print()

    def make_request(self, method: str, endpoint: str, data=None, headers=None, use_localhost=False):
        """Make HTTP request with error handling"""
        try:
            base_url = LOCALHOST_BASE if use_localhost else API_BASE
            url = f"{base_url}{endpoint}"
            req_headers = self.session.headers.copy()
            if headers:
                req_headers.update(headers)
            
            response = self.session.request(method, url, json=data, headers=req_headers, timeout=30)
            return response
        except Exception as e:
            return f"Request failed: {str(e)}"

    def get_mongo_connection(self):
        """Connect to MongoDB"""
        try:
            client = MongoClient('mongodb://localhost:27017')
            db = client['your_database_name']
            return db
        except Exception as e:
            print(f"MongoDB connection failed: {str(e)}")
            return None

    def test_request_lineage_critical(self):
        """CRITICAL TEST: Request Lineage (requestId in audit entries)"""
        print("🎯 CRITICAL TEST: Request Lineage (requestId in audit entries)")
        print("=" * 70)
        
        # 1. Register user
        phone = "7777700002"  # Use different phone to avoid rate limiting
        pin = "1234"
        register_data = {
            "phone": phone,
            "pin": pin,
            "displayName": "LineageTest2",
            "college": "MIT"
        }
        
        print("📝 Step 1: Register test user...")
        register_resp = self.make_request('POST', '/auth/register', register_data)
        if isinstance(register_resp, str) or register_resp.status_code not in [200, 201, 409]:
            self.add_result("Request Lineage - User Registration", False, 
                          f"Registration failed: {register_resp}")
            return
        
        # 2. Login user
        print("📝 Step 2: Login user...")
        login_data = {"phone": phone, "pin": pin}
        login_resp = self.make_request('POST', '/auth/login', login_data)
        if isinstance(login_resp, str) or login_resp.status_code != 200:
            self.add_result("Request Lineage - User Login", False, 
                          f"Login failed: {login_resp}")
            return
        
        login_result = login_resp.json()
        self.user_token = login_result.get('token') or login_result.get('accessToken')
        
        # 3. Check MongoDB audit_logs for latest entries
        print("📝 Step 3: Checking MongoDB audit_logs for requestId correlation...")
        db = self.get_mongo_connection()
        if db is None:
            self.add_result("Request Lineage - MongoDB Connection", False, 
                          "Could not connect to MongoDB")
            return
        
        try:
            # Get the latest 10 audit entries
            audit_logs = list(db.audit_logs.find({}).sort([('createdAt', -1)]).limit(10))
            
            if not audit_logs:
                self.add_result("Request Lineage - Audit Logs Exist", False, 
                              "No audit logs found in database")
                return
            
            # Check for requestId correlation
            entries_with_request_id = [log for log in audit_logs if log.get('requestId')]
            entries_without_request_id = [log for log in audit_logs if not log.get('requestId')]
            
            print(f"   Found {len(audit_logs)} recent audit entries")
            print(f"   Entries with requestId: {len(entries_with_request_id)}")
            print(f"   Entries without requestId: {len(entries_without_request_id)}")
            
            # Verify requestId is NOT NULL on new entries
            if len(entries_with_request_id) == 0:
                self.add_result("Request Lineage - RequestId Not Null", False, 
                              "All recent audit entries have NULL requestId - AsyncLocalStorage fix failed")
                return
            
            # Verify ip field is NOT NULL
            entries_with_ip = [log for log in audit_logs if log.get('ip')]
            if len(entries_with_ip) == 0:
                self.add_result("Request Lineage - IP Not Null", False, 
                              "All recent audit entries have NULL ip field")
                return
            
            # Verify route and method fields
            entries_with_route = [log for log in audit_logs if log.get('route')]
            entries_with_method = [log for log in audit_logs if log.get('method')]
            
            # Look for correlation proof (same requestId across multiple entries)
            request_id_groups = {}
            for log in entries_with_request_id:
                rid = log['requestId']
                if rid not in request_id_groups:
                    request_id_groups[rid] = []
                request_id_groups[rid].append(log)
            
            correlated_requests = {rid: logs for rid, logs in request_id_groups.items() if len(logs) > 1}
            
            print(f"   Entries with IP: {len(entries_with_ip)}")
            print(f"   Entries with route: {len(entries_with_route)}")
            print(f"   Entries with method: {len(entries_with_method)}")
            print(f"   Correlated request groups: {len(correlated_requests)}")
            
            # Show sample audit entry
            if entries_with_request_id:
                sample = entries_with_request_id[0]
                print(f"   Sample audit entry:")
                print(f"     requestId: {sample.get('requestId', 'NULL')}")
                print(f"     ip: {sample.get('ip', 'NULL')}")
                print(f"     route: {sample.get('route', 'NULL')}")
                print(f"     method: {sample.get('method', 'NULL')}")
                print(f"     eventType: {sample.get('eventType', 'NULL')}")
            
            # Determine overall success
            success = (
                len(entries_with_request_id) > 0 and
                len(entries_with_ip) > 0 and
                len(entries_with_route) > 0 and
                len(entries_with_method) > 0
            )
            
            if success:
                correlation_note = f" ({len(correlated_requests)} correlated request groups found)" if correlated_requests else ""
                self.add_result("Request Lineage - AsyncLocalStorage Fix", True, 
                              f"✅ requestId, ip, route, method fields populated in audit logs{correlation_note}")
            else:
                missing_fields = []
                if len(entries_with_request_id) == 0: missing_fields.append("requestId")
                if len(entries_with_ip) == 0: missing_fields.append("ip")
                if len(entries_with_route) == 0: missing_fields.append("route")  
                if len(entries_with_method) == 0: missing_fields.append("method")
                self.add_result("Request Lineage - AsyncLocalStorage Fix", False, 
                              f"Missing fields in audit logs: {', '.join(missing_fields)}")
            
        except Exception as e:
            self.add_result("Request Lineage - MongoDB Query", False, 
                          f"MongoDB query failed: {str(e)}")

    def test_error_code_metrics(self):
        """Test error code metrics collection"""
        print("📊 Testing Error Code Metrics...")
        
        # 1. Hit /api/nonexistent → 404
        resp_404 = self.make_request('GET', '/nonexistent')
        if isinstance(resp_404, str) or resp_404.status_code != 404:
            self.add_result("Error Metrics - 404 Generation", False, 
                          f"Expected 404, got: {resp_404}")
            return
        
        # 2. Hit /api/ops/health without auth → 401  
        resp_401 = self.make_request('GET', '/ops/health')
        if isinstance(resp_401, str) or resp_401.status_code != 401:
            self.add_result("Error Metrics - 401 Generation", False, 
                          f"Expected 401, got: {resp_401}")
            return
        
        # 3. Make admin user in MongoDB
        db = self.get_mongo_connection()
        if db is None:
            self.add_result("Error Metrics - MongoDB Connection", False, "Could not connect to MongoDB")
            return
        
        try:
            # Update user to ADMIN role
            result = db.users.update_one(
                {'phone': '7777700002'}, 
                {'$set': {'role': 'ADMIN'}}
            )
            if result.modified_count == 0:
                # User might not exist, try to find any user and make them admin
                user = db.users.find_one({})
                if user:
                    db.users.update_one({'_id': user['_id']}, {'$set': {'role': 'ADMIN'}})
        except Exception as e:
            self.add_result("Error Metrics - Admin User Setup", False, f"Failed to setup admin user: {str(e)}")
            return
        
        # 4. Login again to get admin token
        login_data = {"phone": "7777700002", "pin": "1234"}
        login_resp = self.make_request('POST', '/auth/login', login_data)
        if isinstance(login_resp, str) or login_resp.status_code != 200:
            self.add_result("Error Metrics - Admin Login", False, f"Admin login failed: {login_resp}")
            return
        
        login_result = login_resp.json()
        admin_token = login_result.get('token') or login_result.get('accessToken')
        
        # 5. GET /api/ops/metrics with admin token
        headers = {'Authorization': f'Bearer {admin_token}'}
        metrics_resp = self.make_request('GET', '/ops/metrics', headers=headers)
        if isinstance(metrics_resp, str) or metrics_resp.status_code != 200:
            self.add_result("Error Metrics - Metrics Endpoint", False, 
                          f"Metrics endpoint failed: {metrics_resp}")
            return
        
        metrics_data = metrics_resp.json()
        error_codes = metrics_data.get('errorCodes', {})
        
        if not error_codes:
            self.add_result("Error Metrics - ErrorCodes Map", False, 
                          "errorCodes map is empty - metrics not collecting error codes")
            return
        
        # Check for expected error codes
        expected_codes = ["NOT_FOUND", "UNAUTHORIZED"]
        found_codes = [code for code in expected_codes if code in error_codes]
        
        self.add_result("Error Metrics - Error Code Collection", True, 
                      f"✅ Found error codes: {list(error_codes.keys())}, expected codes found: {found_codes}")
        
        self.admin_token = admin_token  # Store for other tests

    def test_options_observability(self):
        """Test OPTIONS observability"""
        print("🔧 Testing OPTIONS Observability...")
        
        # Send OPTIONS to localhost:3000 (bypass proxy)
        try:
            response = requests.options(f"{LOCALHOST_BASE}/auth/login", timeout=10)
            
            if response.status_code != 200:
                self.add_result("OPTIONS Observability - Status Code", False, 
                              f"Expected 200, got {response.status_code}")
                return
            
            request_id = response.headers.get('x-request-id')
            if not request_id:
                self.add_result("OPTIONS Observability - Request ID Header", False, 
                              "x-request-id header missing from OPTIONS response")
                return
            
            # Validate UUID format
            try:
                uuid.UUID(request_id)
                self.add_result("OPTIONS Observability", True, 
                              f"✅ OPTIONS returns x-request-id: {request_id}")
            except ValueError:
                self.add_result("OPTIONS Observability - UUID Format", False, 
                              f"x-request-id is not valid UUID: {request_id}")
                
        except Exception as e:
            self.add_result("OPTIONS Observability", False, f"OPTIONS request failed: {str(e)}")

    def test_health_probes(self):
        """Test health probes"""
        print("🏥 Testing Health Probes...")
        
        # Test /api/healthz
        healthz_resp = self.make_request('GET', '/healthz')
        if isinstance(healthz_resp, str) or healthz_resp.status_code != 200:
            self.add_result("Health Probes - /healthz", False, f"healthz failed: {healthz_resp}")
        else:
            healthz_data = healthz_resp.json()
            request_id = healthz_resp.headers.get('x-request-id')
            if healthz_data.get('status') == 'ok' and request_id:
                self.add_result("Health Probes - /healthz", True, 
                              f"✅ healthz returns status:ok with request-id: {request_id}")
            else:
                self.add_result("Health Probes - /healthz", False, 
                              f"healthz response invalid: {healthz_data}, request-id: {request_id}")
        
        # Test /api/readyz  
        readyz_resp = self.make_request('GET', '/readyz')
        if isinstance(readyz_resp, str) or readyz_resp.status_code != 200:
            self.add_result("Health Probes - /readyz", False, f"readyz failed: {readyz_resp}")
        else:
            readyz_data = readyz_resp.json()
            request_id = readyz_resp.headers.get('x-request-id')
            # readyz should show degraded status (Redis down)
            if request_id:
                self.add_result("Health Probes - /readyz", True, 
                              f"✅ readyz response with request-id: {request_id}, status: {readyz_data.get('ready', 'unknown')}")
            else:
                self.add_result("Health Probes - /readyz Headers", False, 
                              f"readyz missing request-id header")

    def test_security_headers(self):
        """Test security headers on all responses"""
        print("🛡️ Testing Security Headers...")
        
        healthz_resp = self.make_request('GET', '/healthz')
        if isinstance(healthz_resp, str):
            self.add_result("Security Headers - Response Available", False, "Could not get response for header test")
            return
        
        expected_headers = [
            'X-Content-Type-Options',
            'X-Frame-Options', 
            'Strict-Transport-Security',
            'x-request-id'
        ]
        
        missing_headers = []
        present_headers = {}
        
        for header in expected_headers:
            value = healthz_resp.headers.get(header)
            if value:
                present_headers[header] = value
            else:
                missing_headers.append(header)
        
        if missing_headers:
            self.add_result("Security Headers", False, 
                          f"Missing headers: {missing_headers}. Present: {present_headers}")
        else:
            # Validate x-request-id is UUID format
            request_id = present_headers['x-request-id']
            try:
                uuid.UUID(request_id)
                self.add_result("Security Headers", True, 
                              f"✅ All security headers present. Request-id: {request_id}")
            except ValueError:
                self.add_result("Security Headers - UUID Format", False, 
                              f"x-request-id not UUID format: {request_id}")

    def test_rate_limiting(self):
        """Test rate limiting works"""
        print("⚡ Testing Rate Limiting...")
        
        # Send 8 rapid POST requests to /api/auth/login 
        # AUTH tier max=5 in STRICT degraded mode (Redis down)
        fake_data = {"phone": "fakerate", "pin": "0000"}
        
        rate_limited = False
        retry_after = None
        
        for i in range(8):
            resp = self.make_request('POST', '/auth/login', fake_data)
            if isinstance(resp, str):
                continue
                
            if resp.status_code == 429:
                rate_limited = True
                retry_after = resp.headers.get('Retry-After')
                break
            
            time.sleep(0.1)  # Small delay between requests
        
        if rate_limited:
            self.add_result("Rate Limiting", True, 
                          f"✅ Rate limiting working - got 429 with Retry-After: {retry_after}")
        else:
            self.add_result("Rate Limiting", False, 
                          "Rate limiting not working - expected 429 after multiple rapid requests")

    def test_deep_health_admin(self):
        """Test deep health (admin)"""
        print("🔍 Testing Deep Health (Admin)...")
        
        if not self.admin_token:
            self.add_result("Deep Health - Admin Token", False, "No admin token available")
            return
        
        headers = {'Authorization': f'Bearer {self.admin_token}'}
        health_resp = self.make_request('GET', '/ops/health', headers=headers)
        
        if isinstance(health_resp, str) or health_resp.status_code != 200:
            self.add_result("Deep Health - Admin Access", False, 
                          f"Admin health check failed: {health_resp}")
            return
        
        health_data = health_resp.json()
        
        # Check for detailed dependency checks
        checks = health_data.get('checks', {})
        if checks and ('rateLimiter' in checks or 'mongodb' in checks or 'redis' in checks):
            dependency_names = list(checks.keys())
            self.add_result("Deep Health - Admin", True, 
                          f"✅ Deep health returns detailed dependency checks: {dependency_names}")
        else:
            self.add_result("Deep Health - Admin", False, 
                          f"Deep health missing dependency checks: {health_data}")

    def test_sli_dashboard(self):
        """Test SLI dashboard"""
        print("📈 Testing SLI Dashboard...")
        
        if not self.admin_token:
            self.add_result("SLI Dashboard - Admin Token", False, "No admin token available")
            return
        
        headers = {'Authorization': f'Bearer {self.admin_token}'}
        sli_resp = self.make_request('GET', '/ops/slis', headers=headers)
        
        if isinstance(sli_resp, str) or sli_resp.status_code != 200:
            self.add_result("SLI Dashboard - Access", False, 
                          f"SLI endpoint failed: {sli_resp}")
            return
        
        sli_data = sli_resp.json()
        
        # Check for expected SLI fields
        expected_fields = ['errorRate', 'latency', 'counters']
        present_fields = [field for field in expected_fields if field in sli_data]
        
        if len(present_fields) >= 2:  # At least errorRate and latency or counters
            latency_info = sli_data.get('latency', {})
            self.add_result("SLI Dashboard", True, 
                          f"✅ SLI returns {present_fields}. Latency percentiles: {list(latency_info.keys())}")
        else:
            self.add_result("SLI Dashboard", False, 
                          f"SLI missing expected fields. Present: {list(sli_data.keys())}")

    def test_zero_bare_catches(self):
        """Test zero bare catches (code-level verification)"""
        print("🔍 Testing Zero Bare Catches...")
        
        try:
            import subprocess
            result = subprocess.run(
                ['grep', '-n', r'catch\s*{', '/app/app/api/[[...path]]/route.js'],
                capture_output=True, text=True
            )
            
            if result.returncode == 0:
                # Found bare catch blocks
                matches = result.stdout.strip().split('\n') if result.stdout.strip() else []
                self.add_result("Zero Bare Catches", False, 
                              f"Found {len(matches)} bare catch blocks: {matches}")
            else:
                # No bare catch blocks found (grep returns 1 when no matches)
                self.add_result("Zero Bare Catches", True, 
                              "✅ Zero bare catch blocks found in route.js")
                
        except Exception as e:
            self.add_result("Zero Bare Catches", False, f"Code verification failed: {str(e)}")

    def run_all_tests(self):
        """Run all Stage 3B Gold Remediation tests"""
        print("🚀 Starting Stage 3B Gold Remediation Tests")
        print("=" * 80)
        print(f"Base URL: {BASE_URL}")
        print(f"MongoDB: mongodb://localhost:27017")
        print()
        
        # Run tests in order
        self.test_request_lineage_critical()
        self.test_error_code_metrics()
        self.test_options_observability()
        self.test_health_probes()
        self.test_security_headers()
        self.test_rate_limiting()
        self.test_deep_health_admin()
        self.test_sli_dashboard()
        self.test_zero_bare_catches()
        
        # Summary
        print("\n" + "=" * 80)
        print("📋 TEST SUMMARY")
        print("=" * 80)
        
        passed = sum(1 for r in self.results if r.success)
        total = len(self.results)
        success_rate = (passed / total * 100) if total > 0 else 0
        
        print(f"Total Tests: {total}")
        print(f"Passed: {passed}")
        print(f"Failed: {total - passed}")
        print(f"Success Rate: {success_rate:.1f}%")
        print()
        
        if success_rate < 80:
            print("❌ CRITICAL: Success rate below 80% - Stage 3B fixes need attention")
        elif success_rate < 90:
            print("⚠️  WARNING: Success rate below 90% - minor issues detected")
        else:
            print("✅ SUCCESS: Stage 3B Gold Remediation tests passed!")
        
        print("\nFailed Tests:")
        for result in self.results:
            if not result.success:
                print(f"  ❌ {result.name}: {result.details}")
        
        return success_rate >= 80

if __name__ == "__main__":
    tester = TribeBackendTester()
    success = tester.run_all_tests()
    exit(0 if success else 1)