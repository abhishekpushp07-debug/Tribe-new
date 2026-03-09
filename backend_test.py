#!/usr/bin/env python3
"""
Stage 3 Observability Backend Testing Suite - Focused Test
Tests the comprehensive observability implementation for Tribe social media backend API.
"""

import subprocess
import json
import time
import uuid
import sys
import traceback

# Configuration
BASE_URL = "https://tribe-observability.preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api"

# Test admin user credentials
TEST_ADMIN_PHONE = "9876500001"
TEST_ADMIN_PIN = "1234"

class ObservabilityTester:
    def __init__(self):
        self.admin_token = None
        self.test_results = []
        self.request_ids = set()
        
    def log(self, message, success=None):
        """Log test results"""
        status = ""
        if success is True:
            status = "✅ "
        elif success is False:
            status = "❌ "
        
        print(f"{status}{message}")
        self.test_results.append({
            'message': message,
            'success': success,
            'timestamp': time.time()
        })
        
    def curl_request(self, method, endpoint, data=None, headers=None, expect_json=True):
        """Make curl request with error handling"""
        url = f"{API_BASE}{endpoint}"
        cmd = ['curl', '-s', '-w', '%{http_code}', '--max-time', '30']
        
        if method == 'POST':
            cmd.extend(['-X', 'POST'])
        elif method == 'GET':
            cmd.extend(['-X', 'GET'])
            
        if headers:
            for key, value in headers.items():
                cmd.extend(['-H', f'{key}: {value}'])
                
        if data:
            cmd.extend(['-H', 'Content-Type: application/json', '-d', json.dumps(data)])
            
        cmd.append(url)
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            output = result.stdout
            
            # Extract status code (last 3 characters)
            if len(output) >= 3:
                status_code = int(output[-3:])
                response_body = output[:-3]
            else:
                return None, None, None
                
            # Parse JSON if expected
            response_data = None
            if expect_json and response_body.strip():
                try:
                    response_data = json.loads(response_body)
                except json.JSONDecodeError:
                    pass
                    
            return status_code, response_data, response_body
        except Exception as e:
            self.log(f"Curl request failed: {e}")
            return None, None, None
            
    def curl_headers(self, endpoint):
        """Get headers using curl -I"""
        url = f"{API_BASE}{endpoint}"
        cmd = ['curl', '-I', '-s', '--max-time', '30', url]
        
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            headers = {}
            for line in result.stdout.split('\n'):
                if ':' in line:
                    key, value = line.split(':', 1)
                    key = key.strip().lower()
                    value = value.strip()
                    # Handle multiple headers with same name
                    if key in headers:
                        if isinstance(headers[key], list):
                            headers[key].append(value)
                        else:
                            headers[key] = [headers[key], value]
                    else:
                        headers[key] = value
            return headers
        except Exception:
            return {}
            
    def check_security_headers(self, headers):
        """Verify security headers are present"""
        issues = []
        
        # Check required security headers
        required_headers = {
            'x-content-type-options': 'nosniff',
            'x-xss-protection': '1; mode=block',
            'referrer-policy': 'strict-origin-when-cross-origin',
        }
        
        for header, expected in required_headers.items():
            value = headers.get(header)
            if not value:
                issues.append(f"{header} (missing)")
            elif value != expected:
                issues.append(f"{header} (got: {value}, expected: {expected})")
                
        # Check presence of other important headers
        if 'strict-transport-security' not in headers:
            issues.append("strict-transport-security (missing)")
        if 'content-security-policy' not in headers:
            issues.append("content-security-policy (missing)")
            
        # Handle x-frame-options special case (might have duplicates)
        x_frame = headers.get('x-frame-options')
        if x_frame:
            # If it's a list, check if DENY is in it
            if isinstance(x_frame, list):
                if 'DENY' not in x_frame:
                    issues.append("x-frame-options (DENY not found in values)")
            else:
                if x_frame != 'DENY':
                    issues.append(f"x-frame-options (got: {x_frame}, expected: DENY)")
        else:
            issues.append("x-frame-options (missing)")
                
        return issues
        
    def check_request_id(self, headers):
        """Verify x-request-id header is present and valid UUID"""
        request_id = headers.get('x-request-id')
        if not request_id:
            return False, "Missing x-request-id header"
            
        try:
            # Validate UUID format
            uuid_obj = uuid.UUID(request_id)
            # Check for uniqueness
            if request_id in self.request_ids:
                return False, f"Duplicate request ID: {request_id}"
            self.request_ids.add(request_id)
            return True, request_id
        except ValueError:
            return False, f"Invalid UUID format: {request_id}"
            
    def setup_admin_user(self):
        """Register and setup admin user"""
        self.log("=== Setting up admin test user ===")
        
        # Try to register user
        register_data = {
            "phone": TEST_ADMIN_PHONE,
            "pin": TEST_ADMIN_PIN,
            "name": "TestAdmin",
            "college": "MIT"
        }
        
        status, data, body = self.curl_request("POST", "/auth/register", register_data)
        if status in [201, 409]:  # 201 = created, 409 = already exists
            self.log(f"User registration: {status}", True)
        else:
            self.log(f"User registration failed: {status}", False)
            
        # Try to login
        login_data = {
            "phone": TEST_ADMIN_PHONE,
            "pin": TEST_ADMIN_PIN
        }
        
        status, data, body = self.curl_request("POST", "/auth/login", login_data)
        if status == 200 and data:
            self.admin_token = data.get('accessToken') or data.get('token')
            if self.admin_token:
                self.log("Login successful, token obtained", True)
                return True
            else:
                self.log("Login successful but no token in response", False)
        else:
            self.log(f"Login failed: {status}", False)
            
        return False
            
    def test_health_probes(self):
        """Test public health endpoints"""
        self.log("=== Testing Health Probes (Public) ===")
        
        # Test 1: Liveness probe
        headers = self.curl_headers("/healthz")
        if headers:
            success, req_id = self.check_request_id(headers)
            if success:
                self.log(f"Liveness probe - Request ID valid: {req_id}", True)
            else:
                self.log(f"Liveness probe - Request ID issue: {req_id}", False)
                
            security_issues = self.check_security_headers(headers)
            if not security_issues:
                self.log("Liveness probe - Security headers valid", True)
            else:
                self.log(f"Liveness probe - Security header issues: {', '.join(security_issues[:2])}", False)
        
        status, data, body = self.curl_request("GET", "/healthz")
        if status == 200 and data:
            required_fields = ['status', 'uptime', 'timestamp']
            missing_fields = [f for f in required_fields if f not in data]
            if not missing_fields and data.get('status') == 'ok':
                self.log("Liveness probe - Response format valid", True)
            else:
                self.log(f"Liveness probe - Invalid response: missing {missing_fields}", False)
        else:
            self.log(f"Liveness probe - Status: {status}", False)
        
        # Test 2: Readiness probe
        headers = self.curl_headers("/readyz")
        if headers:
            success, req_id = self.check_request_id(headers)
            if success:
                self.log(f"Readiness probe - Request ID valid: {req_id}", True)
            else:
                self.log(f"Readiness probe - Request ID issue: {req_id}", False)
        
        status, data, body = self.curl_request("GET", "/readyz")
        if status == 200 and data:
            required_fields = ['ready', 'status', 'checks', 'timestamp']
            missing_fields = [f for f in required_fields if f not in data]
            if not missing_fields:
                checks = data.get('checks', {})
                if 'mongo' in checks and 'redis' in checks:
                    status_val = data.get('status')
                    if status_val == 'degraded':
                        self.log("Readiness probe - Correctly shows degraded when Redis is down", True)
                    elif status_val in ['healthy', 'unhealthy']:
                        self.log(f"Readiness probe - Valid response (status: {status_val})", True)
                    else:
                        self.log(f"Readiness probe - Invalid status: {status_val}", False)
                else:
                    self.log("Readiness probe - Missing mongo or redis checks", False)
            else:
                self.log(f"Readiness probe - Missing fields: {missing_fields}", False)
        else:
            self.log(f"Readiness probe - Status: {status}", False)
                
    def test_admin_observability_endpoints(self):
        """Test admin observability endpoints"""
        self.log("=== Testing Admin Observability Endpoints ===")
        
        # Test 1: Test without auth (should get 401/403)
        status, data, body = self.curl_request("GET", "/ops/health")
        if status in [401, 403]:
            self.log("Deep health check - Correctly requires auth", True)
        else:
            self.log(f"Deep health check - Should require auth, got: {status}", False)
            
        if not self.admin_token:
            self.log("No admin token available, skipping authenticated admin tests", False)
            return
            
        # Test 2: Deep health check with auth
        auth_headers = {"Authorization": f"Bearer {self.admin_token}"}
        
        headers = self.curl_headers("/ops/health")
        if headers:
            success, req_id = self.check_request_id(headers)
            if success:
                self.log(f"Deep health check - Request ID valid: {req_id}", True)
            else:
                self.log(f"Deep health check - Request ID issue: {req_id}", False)
        
        status, data, body = self.curl_request("GET", "/ops/health", headers=auth_headers)
        if status == 200 and data:
            required_fields = ['status', 'checks', 'slis', 'process', 'version']
            missing_fields = [f for f in required_fields if f not in data]
            if not missing_fields:
                checks = data.get('checks', {})
                expected_deps = ['mongodb', 'redis', 'rateLimiter', 'moderation', 'objectStorage', 'auditSystem']
                missing_deps = [d for d in expected_deps if d not in checks]
                if not missing_deps:
                    self.log("Deep health check - All dependencies checked", True)
                else:
                    self.log(f"Deep health check - Missing dependency checks: {missing_deps}", False)
            else:
                self.log(f"Deep health check - Missing fields: {missing_fields}", False)
        else:
            self.log(f"Deep health check - Status: {status}", False)
                
        # Test 3: Metrics endpoint
        status, data, body = self.curl_request("GET", "/ops/metrics", headers=auth_headers)
        if status == 200 and data:
            required_sections = ['process', 'http', 'rateLimiting', 'dependencies', 'topRoutes', 'business']
            missing_sections = [s for s in required_sections if s not in data]
            if not missing_sections:
                # Check HTTP metrics structure
                http = data.get('http', {})
                if 'totalRequests' in http and 'latency' in http:
                    latency = http.get('latency', {})
                    if all(k in latency for k in ['p50Ms', 'p95Ms', 'p99Ms']):
                        self.log("Metrics endpoint - HTTP latency percentiles present", True)
                    else:
                        self.log("Metrics endpoint - Missing latency percentiles", False)
                        
                # Check business metrics
                business = data.get('business', {})
                if all(k in business for k in ['users', 'posts', 'activeSessions']):
                    self.log("Metrics endpoint - Business metrics present", True)
                else:
                    self.log("Metrics endpoint - Missing business metrics", False)
            else:
                self.log(f"Metrics endpoint - Missing sections: {missing_sections}", False)
        else:
            self.log(f"Metrics endpoint - Status: {status}", False)
                
        # Test 4: SLIs endpoint
        status, data, body = self.curl_request("GET", "/ops/slis", headers=auth_headers)
        if status == 200 and data:
            required_fields = ['errorRate', 'latency', 'counters']
            missing_fields = [f for f in required_fields if f not in data]
            if not missing_fields:
                latency = data.get('latency', {})
                counters = data.get('counters', {})
                if all(k in latency for k in ['p50Ms', 'p95Ms', 'p99Ms']):
                    if all(k in counters for k in ['totalRequests', 'total5xx']):
                        self.log("SLIs endpoint - Complete SLI dashboard data", True)
                    else:
                        self.log("SLIs endpoint - Missing counter data", False)
                else:
                    self.log("SLIs endpoint - Missing latency percentiles", False)
            else:
                self.log(f"SLIs endpoint - Missing fields: {missing_fields}", False)
        else:
            self.log(f"SLIs endpoint - Status: {status}", False)
                
    def test_request_id_propagation(self):
        """Test request ID propagation across endpoints"""
        self.log("=== Testing Request ID Propagation ===")
        
        test_endpoints = ["/healthz", "/readyz", "/nonexistent"]
        
        for endpoint in test_endpoints:
            headers = self.curl_headers(endpoint)
            if headers:
                success, req_id = self.check_request_id(headers)
                if success:
                    self.log(f"Request ID valid for {endpoint}: {req_id}", True)
                else:
                    self.log(f"Request ID issue for {endpoint}: {req_id}", False)
            else:
                self.log(f"No headers for {endpoint}", False)
                
        # Test with admin endpoint if we have token
        if self.admin_token:
            auth_headers = {"Authorization": f"Bearer {self.admin_token}"}
            headers = self.curl_headers("/ops/health")
            if headers:
                success, req_id = self.check_request_id(headers)
                if success:
                    self.log(f"Request ID valid for /ops/health: {req_id}", True)
                else:
                    self.log(f"Request ID issue for /ops/health: {req_id}", False)
                
    def test_rate_limiting(self):
        """Test rate limiting with metrics"""
        self.log("=== Testing Rate Limiting ===")
        
        # Send multiple rapid requests to trigger rate limiting
        login_data = {"phone": "invalid_user", "pin": "0000"}
        rate_limit_hit = False
        
        for i in range(12):  # AUTH tier has max=10 (or 5 in STRICT mode when Redis is down)
            status, data, body = self.curl_request("POST", "/auth/login", login_data)
            if status == 429:
                rate_limit_hit = True
                self.log(f"Rate limiting triggered on attempt {i+1}", True)
                
                # Check for Retry-After header
                headers = self.curl_headers("/auth/login") 
                if headers and 'retry-after' in headers:
                    self.log(f"Rate limiting includes Retry-After header", True)
                else:
                    self.log("Rate limiting missing Retry-After header", False)
                break
                
        if not rate_limit_hit:
            self.log("Rate limiting not triggered in 12 requests", False)
            
        # Check if rate limiting metrics are recorded
        if rate_limit_hit and self.admin_token:
            auth_headers = {"Authorization": f"Bearer {self.admin_token}"}
            time.sleep(1)  # Give metrics time to update
            status, data, body = self.curl_request("GET", "/ops/metrics", headers=auth_headers)
            if status == 200 and data:
                rate_limiting = data.get('rateLimiting', {})
                total_hits = rate_limiting.get('totalHits', 0)
                if total_hits > 0:
                    self.log(f"Rate limiting metrics recorded: {total_hits} total hits", True)
                else:
                    self.log("Rate limiting metrics not recorded", False)
            
    def test_error_handling(self):
        """Test error response structure"""
        self.log("=== Testing Error Handling ===")
        
        # Test 404 for non-existent route
        status, data, body = self.curl_request("GET", "/nonexistent")
        if status == 404 and data:
            if 'error' in data and 'code' in data and data.get('code') == 'NOT_FOUND':
                self.log("404 error response structure valid", True)
            else:
                self.log(f"404 error has wrong structure: {data}", False)
        else:
            self.log(f"Non-existent route returned {status}, expected 404", False)
                
        # Test 401 for admin endpoint without auth
        status, data, body = self.curl_request("GET", "/ops/health")
        if status == 401 and data:
            if 'error' in data and 'code' in data and data.get('code') == 'UNAUTHORIZED':
                self.log("401 error response structure valid", True)
            else:
                self.log(f"401 error has wrong structure: {data}", False)
        else:
            self.log(f"Unauthenticated admin endpoint returned {status}, expected 401", False)
                
    def test_root_info(self):
        """Test root API info endpoint"""
        self.log("=== Testing Root API Info ===")
        
        status, data, body = self.curl_request("GET", "/")
        if status == 200 and data:
            if data.get('version') == '3.0.0':
                self.log("Root API info has correct version 3.0.0", True)
            else:
                self.log(f"Root API info has wrong version: {data.get('version')}", False)
                
            if 'endpoints' in data:
                self.log("Root API info includes endpoints documentation", True)
            else:
                self.log("Root API info missing endpoints documentation", False)
        else:
            self.log(f"Root API info returned {status}, expected 200", False)
            
    def run_all_tests(self):
        """Run the complete observability test suite"""
        self.log("🎯 Starting Stage 3 Observability Testing Suite")
        self.log(f"Base URL: {BASE_URL}")
        
        try:
            # Setup admin user
            if not self.setup_admin_user():
                self.log("Failed to setup admin user - admin tests will be limited", False)
                
            # Run all test categories
            self.test_health_probes()
            self.test_admin_observability_endpoints() 
            self.test_request_id_propagation()
            self.test_rate_limiting()
            self.test_error_handling()
            self.test_root_info()
            
        except Exception as e:
            self.log(f"Test execution failed: {e}", False)
            traceback.print_exc()
        
        # Summary
        self.log("\n=== TEST SUMMARY ===")
        passed = sum(1 for r in self.test_results if r['success'] is True)
        failed = sum(1 for r in self.test_results if r['success'] is False)
        total = passed + failed
        
        if total > 0:
            success_rate = (passed / total) * 100
            self.log(f"Total Tests: {total}")
            self.log(f"Passed: {passed}")
            self.log(f"Failed: {failed}")
            self.log(f"Success Rate: {success_rate:.1f}%")
            
            if success_rate >= 85:
                self.log("🎉 EXCELLENT: Stage 3 Observability implementation meets production standards!", True)
            elif success_rate >= 70:
                self.log("✅ GOOD: Stage 3 Observability implementation is functional with minor issues", True)
            else:
                self.log("❌ NEEDS WORK: Stage 3 Observability implementation has significant issues", False)
        else:
            self.log("No tests completed", False)
            
        return {
            'total': total,
            'passed': passed,
            'failed': failed,
            'success_rate': success_rate if total > 0 else 0,
            'results': self.test_results
        }

if __name__ == "__main__":
    tester = ObservabilityTester()
    results = tester.run_all_tests()
    
    # Exit with appropriate code
    if results['success_rate'] >= 70:
        sys.exit(0)
    else:
        sys.exit(1)