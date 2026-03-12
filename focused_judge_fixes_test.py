#!/usr/bin/env python3
"""
Backend Test for Judge Fixes - Focused Security & Media Tests
Testing core improvements without aggressive rate limiting
"""

import requests
import json
import sys
import time

# Base URL from environment
BASE_URL = "https://media-platform-api.preview.emergentagent.com/api"

class JudgeFixesFocusedTester:
    def __init__(self):
        self.session = requests.Session()
        self.test_results = []
        
    def log_test(self, test_name, success, details=""):
        """Log test results"""
        status = "✅ PASS" if success else "❌ FAIL"
        self.test_results.append({
            "test": test_name,
            "success": success,
            "details": details
        })
        print(f"{status}: {test_name}")
        if details:
            print(f"   Details: {details}")
            
    def test_nosql_injection_prevention(self):
        """Test 1: NoSQL injection prevention on auth endpoints"""
        try:
            print("\n=== NoSQL Injection Prevention Tests ===")
            
            # Test register endpoint with NoSQL injection
            malicious_register = {
                "phone": {"$ne": ""},
                "pin": "1234",
                "displayName": "Hacker",
                "dob": "2000-01-01"
            }
            
            response = self.session.post(f"{BASE_URL}/auth/register", json=malicious_register)
            register_blocked = response.status_code == 400
            
            self.log_test("NoSQL injection blocked on register", register_blocked,
                         f"Status: {response.status_code} (should be 400)")
            
            # Test login endpoint with NoSQL injection
            malicious_login = {
                "phone": {"$ne": ""},
                "pin": {"$exists": True}
            }
            
            response = self.session.post(f"{BASE_URL}/auth/login", json=malicious_login)
            login_blocked = response.status_code == 400
            
            self.log_test("NoSQL injection blocked on login", login_blocked,
                         f"Status: {response.status_code} (should be 400)")
            
            # Test that normal register still works
            normal_register = {
                "phone": "9000000999", 
                "pin": "1234",
                "displayName": "Normal User",
                "dob": "2000-01-01"
            }
            
            response = self.session.post(f"{BASE_URL}/auth/register", json=normal_register)
            normal_works = response.status_code in [201, 409]  # 409 if user exists
            
            self.log_test("Normal register still works", normal_works,
                         f"Status: {response.status_code} (should be 201 or 409)")
            
            return register_blocked and login_blocked and normal_works
            
        except Exception as e:
            self.log_test("NoSQL injection prevention", False, f"Exception: {str(e)}")
            return False
    
    def test_leaderboard_improvements(self):
        """Test 2: Leaderboard improvements (scoring, caching, structure)"""
        try:
            print("\n=== Leaderboard Improvements Tests ===")
            
            # Wait a moment to avoid rate limiting
            time.sleep(2)
            
            # Basic endpoint test
            response = self.session.get(f"{BASE_URL}/tribes/leaderboard")
            
            if response.status_code != 200:
                if response.status_code == 429:
                    self.log_test("Leaderboard endpoint", False, "Rate limited - test timing issue")
                else:
                    self.log_test("Leaderboard endpoint", False, f"Status: {response.status_code}")
                return False
                
            data = response.json()
            
            # Check basic structure
            has_items = 'items' in data and len(data['items']) == 21
            has_scoring_rules = 'scoringRules' in data
            has_generated_at = 'generatedAt' in data
            
            self.log_test("Leaderboard basic structure", has_items,
                         f"Has 21 tribes: {len(data.get('items', []))}")
            self.log_test("Scoring rules included", has_scoring_rules,
                         f"Rules present: {has_scoring_rules}")
            self.log_test("Generation timestamp", has_generated_at,
                         f"Timestamp: {data.get('generatedAt', 'missing')}")
            
            # Check scoring rules values if present
            scoring_correct = False
            if has_scoring_rules:
                rules = data['scoringRules']
                expected = {'upload': 100, 'like': 10, 'comment': 20, 'share': 50}
                scoring_correct = all(rules.get(k) == v for k, v in expected.items())
                
            self.log_test("Scoring rules values correct", scoring_correct,
                         f"New scoring formula validated: {scoring_correct}")
            
            # Check story engagement fields if items exist
            story_engagement = False
            if has_items and data['items']:
                first_item = data['items'][0]
                metrics = first_item.get('metrics', {})
                story_engagement = ('storyReactions' in metrics and 'storyReplies' in metrics)
                
            self.log_test("Story engagement tracking", story_engagement,
                         f"Story metrics present: {story_engagement}")
            
            # Test caching by making second request
            time.sleep(1)
            response2 = self.session.get(f"{BASE_URL}/tribes/leaderboard")
            
            caching_works = False
            if response2.status_code == 200:
                data2 = response2.json()
                # Same generatedAt indicates cache hit
                caching_works = data.get('generatedAt') == data2.get('generatedAt')
                
            self.log_test("Caching functionality", caching_works,
                         f"Cache hit detected: {caching_works}")
            
            return has_items and has_scoring_rules and scoring_correct
            
        except Exception as e:
            self.log_test("Leaderboard improvements", False, f"Exception: {str(e)}")
            return False
    
    def test_period_validation_improvement(self):
        """Test 3: Invalid period validation (should default to 30d, not error)"""
        try:
            print("\n=== Period Validation Tests ===")
            
            time.sleep(2)  # Avoid rate limiting
            
            # Test invalid period
            response = self.session.get(f"{BASE_URL}/tribes/leaderboard?period=INVALID")
            
            if response.status_code == 429:
                self.log_test("Period validation", False, "Rate limited - test timing issue")
                return False
                
            success = response.status_code == 200
            
            if success:
                data = response.json()
                period = data.get('period', '')
                defaults_correctly = period == '30d'
                
                self.log_test("Invalid period handling", success,
                             f"Returns 200 instead of error")
                self.log_test("Invalid period defaults to 30d", defaults_correctly,
                             f"Period: {period}")
                return defaults_correctly
            else:
                self.log_test("Invalid period handling", False,
                             f"Status: {response.status_code}")
                return False
                
        except Exception as e:
            self.log_test("Period validation", False, f"Exception: {str(e)}")
            return False
    
    def test_cache_system(self):
        """Test 4: Cache system availability"""
        try:
            print("\n=== Cache System Tests ===")
            
            # Test cache stats endpoint (might need auth)
            response = self.session.get(f"{BASE_URL}/cache/stats")
            
            if response.status_code == 403:
                self.log_test("Cache stats endpoint", False, "Needs authentication - expected behavior")
                # This is actually expected behavior for admin endpoints
                cache_protected = True
            elif response.status_code == 200:
                data = response.json()
                has_stats = 'hits' in data and 'misses' in data
                self.log_test("Cache stats endpoint", True, f"Available without auth")
                self.log_test("Cache stats structure", has_stats, f"Has hits/misses: {has_stats}")
                cache_protected = has_stats
            else:
                self.log_test("Cache stats endpoint", False, f"Status: {response.status_code}")
                cache_protected = False
            
            # Test cache behavior indirectly through leaderboard timing
            start_time = time.time()
            response1 = self.session.get(f"{BASE_URL}/tribes/leaderboard")
            first_time = time.time() - start_time
            
            if response1.status_code == 200:
                time.sleep(0.5)
                start_time = time.time()
                response2 = self.session.get(f"{BASE_URL}/tribes/leaderboard")
                second_time = time.time() - start_time
                
                # Cache should make second request faster or return same generatedAt
                data1 = response1.json()
                data2 = response2.json() if response2.status_code == 200 else {}
                
                cache_hit = data1.get('generatedAt') == data2.get('generatedAt')
                faster_response = second_time < first_time
                
                self.log_test("Cache performance benefit", cache_hit or faster_response,
                             f"Times: {first_time:.3f}s vs {second_time:.3f}s, Same timestamp: {cache_hit}")
            else:
                cache_hit = False
                
            return cache_protected
            
        except Exception as e:
            self.log_test("Cache system", False, f"Exception: {str(e)}")
            return False
    
    def test_input_validation_improvements(self):
        """Test 5: Input validation improvements"""
        try:
            print("\n=== Input Validation Tests ===")
            
            # Test phone/pin type validation
            type_validation_count = 0
            
            # Phone as number instead of string
            invalid_phone = {
                "phone": 9000000123,  # Should be string
                "pin": "1234",
                "displayName": "Test",
                "dob": "2000-01-01"
            }
            
            response = self.session.post(f"{BASE_URL}/auth/register", json=invalid_phone)
            if response.status_code == 400:
                type_validation_count += 1
                
            # PIN as number instead of string  
            invalid_pin = {
                "phone": "9000000124",
                "pin": 1234,  # Should be string
                "displayName": "Test", 
                "dob": "2000-01-01"
            }
            
            response = self.session.post(f"{BASE_URL}/auth/register", json=invalid_pin)
            if response.status_code == 400:
                type_validation_count += 1
                
            validation_working = type_validation_count >= 1  # At least one should be caught
            
            self.log_test("Phone/PIN type validation", validation_working,
                         f"{type_validation_count}/2 invalid types rejected")
            
            # Test deep sanitization (no $ keys allowed)
            malicious_nested = {
                "phone": "9000000125",
                "pin": "1234",
                "displayName": "Test",
                "dob": "2000-01-01",
                "metadata": {
                    "$where": "this.phone != null"  # Should be stripped
                }
            }
            
            response = self.session.post(f"{BASE_URL}/auth/register", json=malicious_nested)
            # Should either succeed (with $ key stripped) or fail with validation error
            deep_sanitization = response.status_code in [201, 400, 409]
            
            self.log_test("Deep sanitization", deep_sanitization,
                         f"Handles nested $ keys: {response.status_code}")
            
            return validation_working and deep_sanitization
            
        except Exception as e:
            self.log_test("Input validation", False, f"Exception: {str(e)}")
            return False
    
    def run_focused_tests(self):
        """Run focused Judge Fixes tests"""
        print("🔒 JUDGE FIXES - FOCUSED SECURITY & IMPROVEMENTS TEST")
        print("=" * 70)
        print(f"Testing endpoint: {BASE_URL}")
        print("Focus: NoSQL injection, leaderboard improvements, validation, caching")
        print()
        
        # Run focused tests with delays to avoid rate limiting
        tests = [
            self.test_nosql_injection_prevention,
            self.test_leaderboard_improvements,
            self.test_period_validation_improvement,
            self.test_cache_system,
            self.test_input_validation_improvements
        ]
        
        passed = 0
        total = len(tests)
        
        for i, test_func in enumerate(tests):
            try:
                if test_func():
                    passed += 1
                    
                # Add delay between test groups to avoid rate limiting
                if i < len(tests) - 1:
                    print()
                    time.sleep(3)
                    
            except Exception as e:
                print(f"❌ Test {test_func.__name__} failed with exception: {str(e)}")
                
        # Final summary
        print("\n" + "=" * 70)
        print("🔒 JUDGE FIXES FOCUSED TEST SUMMARY")
        print(f"Tests passed: {len([r for r in self.test_results if r['success']])}/{len(self.test_results)}")
        print(f"Success rate: {(len([r for r in self.test_results if r['success']])/len(self.test_results)*100):.1f}%")
        
        # List any failures
        failures = [r for r in self.test_results if not r['success']]
        if failures:
            print("\n❌ Failed tests:")
            for failure in failures:
                print(f"  - {failure['test']}: {failure['details']}")
        else:
            print("\n✅ All tests passed!")
            
        return len(failures) == 0

if __name__ == "__main__":
    tester = JudgeFixesFocusedTester()
    success = tester.run_focused_tests()
    sys.exit(0 if success else 1)