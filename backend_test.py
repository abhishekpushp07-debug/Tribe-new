#!/usr/bin/env python3
"""
Backend Test for Tribe Leaderboard Endpoint
Test the new GET /api/tribes/leaderboard endpoint implementation
"""

import requests
import json
import uuid
from datetime import datetime, timedelta
import os
import time

class TribeLeaderboardTester:
    def __init__(self):
        self.base_url = os.getenv('NEXT_PUBLIC_BASE_URL', 'https://media-trust-engine.preview.emergentagent.com')
        self.api_url = f"{self.base_url}/api"
        self.test_results = []
        self.auth_token = None
        
    def log_test(self, test_name, status, details=""):
        result = {
            "test": test_name,
            "status": status,
            "details": details,
            "timestamp": datetime.now().isoformat()
        }
        self.test_results.append(result)
        status_icon = "✅" if status == "PASS" else "❌"
        print(f"{status_icon} {test_name}: {status}")
        if details and status == "FAIL":
            print(f"   Details: {details}")

    def setup_auth(self):
        """Setup authentication for testing"""
        try:
            # Use a test user phone number
            test_phone = "9000000001"
            test_pin = "1234"
            
            # Try to login with existing test user
            login_response = requests.post(f"{self.api_url}/auth/login", json={
                "phone": test_phone,
                "pin": test_pin
            })
            
            if login_response.status_code == 200:
                data = login_response.json()
                self.auth_token = data.get('token')
                self.log_test("Auth Setup (Login)", "PASS", f"Logged in with token: {self.auth_token[:20]}...")
                return True
            else:
                self.log_test("Auth Setup (Login)", "FAIL", f"Login failed: {login_response.status_code}")
                return False
                
        except Exception as e:
            self.log_test("Auth Setup", "FAIL", f"Auth setup error: {str(e)}")
            return False

    def test_leaderboard_default_period(self):
        """Test 1: Default period (30d)"""
        try:
            response = requests.get(f"{self.api_url}/tribes/leaderboard")
            
            if response.status_code == 200:
                data = response.json()
                
                # Validate response structure
                if 'items' in data and 'period' in data:
                    period = data.get('period')
                    if period == '30d':
                        self.log_test("Leaderboard Default Period", "PASS", f"Default period correctly set to {period}")
                        return data
                    else:
                        self.log_test("Leaderboard Default Period", "FAIL", f"Expected period '30d', got '{period}'")
                else:
                    self.log_test("Leaderboard Default Period", "FAIL", "Missing required fields 'items' or 'period'")
            else:
                self.log_test("Leaderboard Default Period", "FAIL", f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_test("Leaderboard Default Period", "FAIL", f"Exception: {str(e)}")
        return None

    def test_leaderboard_7d_period(self):
        """Test 2: 7d period"""
        try:
            response = requests.get(f"{self.api_url}/tribes/leaderboard?period=7d")
            
            if response.status_code == 200:
                data = response.json()
                
                if data.get('period') == '7d':
                    self.log_test("Leaderboard 7d Period", "PASS", "7d period parameter working correctly")
                    return data
                else:
                    self.log_test("Leaderboard 7d Period", "FAIL", f"Expected period '7d', got '{data.get('period')}'")
            else:
                self.log_test("Leaderboard 7d Period", "FAIL", f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_test("Leaderboard 7d Period", "FAIL", f"Exception: {str(e)}")
        return None

    def test_leaderboard_all_period(self):
        """Test 3: All-time period"""
        try:
            response = requests.get(f"{self.api_url}/tribes/leaderboard?period=all")
            
            if response.status_code == 200:
                data = response.json()
                
                if data.get('period') == 'all':
                    self.log_test("Leaderboard All-time Period", "PASS", "All-time period parameter working correctly")
                    return data
                else:
                    self.log_test("Leaderboard All-time Period", "FAIL", f"Expected period 'all', got '{data.get('period')}'")
            else:
                self.log_test("Leaderboard All-time Period", "FAIL", f"HTTP {response.status_code}: {response.text}")
                
        except Exception as e:
            self.log_test("Leaderboard All-time Period", "FAIL", f"Exception: {str(e)}")
        return None

    def test_ranking_correctness(self, leaderboard_data):
        """Test 4: Ranking is correct (sorted by engagementScore descending)"""
        if not leaderboard_data or 'items' not in leaderboard_data:
            self.log_test("Ranking Correctness", "FAIL", "No leaderboard data available")
            return False
            
        items = leaderboard_data['items']
        
        if len(items) == 0:
            self.log_test("Ranking Correctness", "PASS", "Empty leaderboard is correctly ranked")
            return True
            
        # Check ranking order
        correctly_ranked = True
        for i in range(len(items) - 1):
            current_score = items[i].get('engagementScore', 0)
            next_score = items[i + 1].get('engagementScore', 0)
            current_rank = items[i].get('rank', 0)
            
            if current_score < next_score:
                correctly_ranked = False
                break
                
            # Check rank numbering
            if current_rank != i + 1:
                correctly_ranked = False
                break
        
        if correctly_ranked:
            self.log_test("Ranking Correctness", "PASS", f"Items correctly sorted by engagementScore, ranks 1-{len(items)}")
        else:
            self.log_test("Ranking Correctness", "FAIL", "Items not properly sorted by engagementScore or incorrect rank numbering")
        
        return correctly_ranked

    def test_all_tribes_present(self, leaderboard_data):
        """Test 5: All tribes present (should be 21 tribes)"""
        if not leaderboard_data or 'count' not in leaderboard_data:
            self.log_test("All Tribes Present", "FAIL", "No leaderboard data available")
            return False
            
        count = leaderboard_data.get('count', 0)
        items_count = len(leaderboard_data.get('items', []))
        
        if count == 21 and items_count == 21:
            self.log_test("All Tribes Present", "PASS", f"All 21 tribes present in leaderboard")
        else:
            self.log_test("All Tribes Present", "FAIL", f"Expected 21 tribes, got count={count}, items={items_count}")
        
        return count == 21 and items_count == 21

    def test_non_negative_metrics(self, leaderboard_data):
        """Test 6: Metrics are non-negative"""
        if not leaderboard_data or 'items' not in leaderboard_data:
            self.log_test("Non-negative Metrics", "FAIL", "No leaderboard data available")
            return False
            
        items = leaderboard_data['items']
        all_non_negative = True
        
        for item in items:
            metrics = item.get('metrics', {})
            for metric_name, value in metrics.items():
                if value < 0:
                    all_non_negative = False
                    self.log_test("Non-negative Metrics", "FAIL", 
                                f"Negative {metric_name} ({value}) found in tribe {item.get('tribeCode')}")
                    return False
        
        if all_non_negative:
            self.log_test("Non-negative Metrics", "PASS", "All metrics are non-negative")
        
        return all_non_negative

    def test_engagement_score_formula(self, leaderboard_data):
        """Test 7: Engagement score formula verification"""
        if not leaderboard_data or 'items' not in leaderboard_data:
            self.log_test("Engagement Score Formula", "FAIL", "No leaderboard data available")
            return False
            
        items = leaderboard_data['items']
        formula_correct = True
        
        for item in items:
            metrics = item.get('metrics', {})
            engagement_score = item.get('engagementScore', 0)
            
            # Formula: (posts*5) + (reels*10) + (likes*2) + (followers*1) + (active*20)
            posts = metrics.get('posts', 0)
            reels = metrics.get('reels', 0)
            likes = metrics.get('likesReceived', 0)
            followers = metrics.get('followersTotal', 0)
            active = metrics.get('activeMemberCount', 0)
            
            expected_score = (posts * 5) + (reels * 10) + (likes * 2) + (followers * 1) + (active * 20)
            
            if engagement_score != expected_score:
                formula_correct = False
                self.log_test("Engagement Score Formula", "FAIL", 
                            f"Tribe {item.get('tribeCode')}: Expected {expected_score}, got {engagement_score}")
                return False
        
        if formula_correct:
            self.log_test("Engagement Score Formula", "PASS", "Engagement score formula correctly implemented")
        
        return formula_correct

    def test_response_fields_completeness(self, leaderboard_data):
        """Test 8: Response includes all required fields"""
        if not leaderboard_data:
            self.log_test("Response Fields Completeness", "FAIL", "No leaderboard data available")
            return False
            
        # Check top-level fields
        required_top_fields = ['items', 'leaderboard', 'count', 'period', 'generatedAt']
        missing_top_fields = []
        
        for field in required_top_fields:
            if field not in leaderboard_data:
                missing_top_fields.append(field)
        
        if missing_top_fields:
            self.log_test("Response Fields Completeness", "FAIL", 
                        f"Missing top-level fields: {missing_top_fields}")
            return False
        
        # Check item fields
        items = leaderboard_data.get('items', [])
        if len(items) > 0:
            required_item_fields = [
                'rank', 'tribeId', 'tribeCode', 'tribeName', 'primaryColor', 
                'animalIcon', 'quote', 'membersCount', 'metrics', 'engagementScore'
            ]
            
            sample_item = items[0]
            missing_item_fields = []
            
            for field in required_item_fields:
                if field not in sample_item:
                    missing_item_fields.append(field)
            
            # Check metrics fields
            metrics = sample_item.get('metrics', {})
            required_metric_fields = ['posts', 'reels', 'likesReceived', 'followersTotal', 'activeMemberCount']
            missing_metric_fields = []
            
            for field in required_metric_fields:
                if field not in metrics:
                    missing_metric_fields.append(field)
            
            if missing_item_fields or missing_metric_fields:
                missing_str = ""
                if missing_item_fields:
                    missing_str += f"Item fields: {missing_item_fields}"
                if missing_metric_fields:
                    missing_str += f" Metric fields: {missing_metric_fields}"
                self.log_test("Response Fields Completeness", "FAIL", f"Missing fields - {missing_str}")
                return False
        
        self.log_test("Response Fields Completeness", "PASS", "All required fields present")
        return True

    def test_valid_iso_date(self, leaderboard_data):
        """Test 9: generatedAt is valid ISO date"""
        if not leaderboard_data or 'generatedAt' not in leaderboard_data:
            self.log_test("Valid ISO Date", "FAIL", "generatedAt field missing")
            return False
            
        generated_at = leaderboard_data['generatedAt']
        
        try:
            # Try to parse as ISO 8601 datetime
            parsed_date = datetime.fromisoformat(generated_at.replace('Z', '+00:00'))
            
            # Check if it's recent (within last 5 minutes)
            now = datetime.now(parsed_date.tzinfo)
            time_diff = abs((now - parsed_date).total_seconds())
            
            if time_diff < 300:  # 5 minutes
                self.log_test("Valid ISO Date", "PASS", f"Valid and recent ISO date: {generated_at}")
            else:
                self.log_test("Valid ISO Date", "FAIL", f"Date too old: {generated_at} ({time_diff}s ago)")
                return False
                
        except Exception as e:
            self.log_test("Valid ISO Date", "FAIL", f"Invalid ISO date format: {generated_at} - {str(e)}")
            return False
            
        return True

    def run_comprehensive_tests(self):
        """Run all leaderboard tests"""
        print("🏛️ TRIBE LEADERBOARD ENDPOINT COMPREHENSIVE TESTING")
        print("=" * 60)
        
        # Set up authentication (optional for leaderboard, but good to have)
        auth_success = self.setup_auth()
        
        # Test 1: Default period (30d)
        default_data = self.test_leaderboard_default_period()
        
        # Test 2: 7d period  
        seven_day_data = self.test_leaderboard_7d_period()
        
        # Test 3: All-time period
        all_time_data = self.test_leaderboard_all_period()
        
        # Use default data for remaining tests (if available)
        test_data = default_data or seven_day_data or all_time_data
        
        if test_data:
            # Test 4: Ranking correctness
            self.test_ranking_correctness(test_data)
            
            # Test 5: All tribes present
            self.test_all_tribes_present(test_data)
            
            # Test 6: Non-negative metrics
            self.test_non_negative_metrics(test_data)
            
            # Test 7: Engagement score formula
            self.test_engagement_score_formula(test_data)
            
            # Test 8: Response fields completeness
            self.test_response_fields_completeness(test_data)
            
            # Test 9: Valid ISO date
            self.test_valid_iso_date(test_data)
        else:
            self.log_test("Comprehensive Testing", "FAIL", "No valid leaderboard data obtained for detailed tests")
        
        # Summary
        print("\n" + "=" * 60)
        passed = sum(1 for r in self.test_results if r['status'] == 'PASS')
        total = len(self.test_results)
        success_rate = (passed / total * 100) if total > 0 else 0
        
        print(f"🎯 TRIBE LEADERBOARD TESTING COMPLETED")
        print(f"✅ Tests Passed: {passed}/{total} ({success_rate:.1f}%)")
        
        if passed == total:
            print("🏆 ALL TESTS PASSED - Leaderboard endpoint is PRODUCTION READY!")
        elif success_rate >= 90:
            print("🎉 EXCELLENT SUCCESS RATE - Leaderboard endpoint exceeds production standards!")
        elif success_rate >= 75:
            print("✨ GOOD SUCCESS RATE - Leaderboard endpoint meets production standards!")
        else:
            print("⚠️ Issues found - Review failed tests above")
        
        return self.test_results

if __name__ == "__main__":
    tester = TribeLeaderboardTester()
    results = tester.run_comprehensive_tests()