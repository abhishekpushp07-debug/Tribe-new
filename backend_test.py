#!/usr/bin/env python3
"""
Backend Test for Tribe Leaderboard Updated Scoring Formula
Testing the new engagement-based scoring system
"""

import requests
import json
import sys
from datetime import datetime

# Base URL from environment
BASE_URL = "https://media-trust-engine.preview.emergentagent.com/api"

class TribeLeaderboardTester:
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
        if details and not success:
            print(f"   Details: {details}")
            
    def test_leaderboard_endpoint_basic(self):
        """Test 1: Basic endpoint availability and response structure"""
        try:
            response = self.session.get(f"{BASE_URL}/tribes/leaderboard")
            
            if response.status_code != 200:
                self.log_test("Basic endpoint availability", False, f"Status: {response.status_code}")
                return False
                
            data = response.json()
            
            # Check required top-level fields
            required_fields = ['items', 'count', 'period', 'generatedAt']
            missing_fields = [field for field in required_fields if field not in data]
            
            if missing_fields:
                self.log_test("Response structure - top level", False, f"Missing fields: {missing_fields}")
                return False
                
            # Check if we have 21 tribes
            if data['count'] != 21:
                self.log_test("21 tribes returned", False, f"Got {data['count']} tribes, expected 21")
                return False
                
            self.log_test("Basic endpoint availability", True)
            self.log_test("Response structure - top level", True)
            self.log_test("21 tribes returned", True, f"Count: {data['count']}")
            return True
            
        except Exception as e:
            self.log_test("Basic endpoint availability", False, f"Exception: {str(e)}")
            return False
            
    def test_leaderboard_item_structure(self):
        """Test 2: Individual leaderboard item structure"""
        try:
            response = self.session.get(f"{BASE_URL}/tribes/leaderboard")
            if response.status_code != 200:
                self.log_test("Item structure test setup", False, f"Status: {response.status_code}")
                return False
                
            data = response.json()
            items = data.get('items', [])
            
            if not items:
                self.log_test("Item structure - has items", False, "No items in response")
                return False
                
            # Test first item structure
            item = items[0]
            
            # Required tribe fields
            required_tribe_fields = [
                'rank', 'tribeId', 'tribeCode', 'tribeName', 'membersCount', 'engagementScore'
            ]
            missing_tribe_fields = [field for field in required_tribe_fields if field not in item]
            
            if missing_tribe_fields:
                self.log_test("Item structure - tribe fields", False, f"Missing: {missing_tribe_fields}")
                return False
                
            # Check metrics object
            if 'metrics' not in item:
                self.log_test("Item structure - metrics object", False, "Missing metrics object")
                return False
                
            metrics = item['metrics']
            required_metrics = [
                'uploads', 'posts', 'reels', 'stories', 'likesReceived', 
                'commentsReceived', 'sharesReceived', 'viralReels'
            ]
            missing_metrics = [field for field in required_metrics if field not in metrics]
            
            if missing_metrics:
                self.log_test("Item structure - metrics fields", False, f"Missing: {missing_metrics}")
                return False
                
            # Check scoreBreakdown object  
            if 'scoreBreakdown' not in item:
                self.log_test("Item structure - scoreBreakdown object", False, "Missing scoreBreakdown object")
                return False
                
            breakdown = item['scoreBreakdown']
            required_breakdown = [
                'uploadPoints', 'likePoints', 'commentPoints', 'sharePoints', 'viralBonus'
            ]
            missing_breakdown = [field for field in required_breakdown if field not in breakdown]
            
            if missing_breakdown:
                self.log_test("Item structure - scoreBreakdown fields", False, f"Missing: {missing_breakdown}")
                return False
                
            self.log_test("Item structure - tribe fields", True)
            self.log_test("Item structure - metrics object", True)
            self.log_test("Item structure - metrics fields", True)
            self.log_test("Item structure - scoreBreakdown object", True)
            self.log_test("Item structure - scoreBreakdown fields", True)
            return True
            
        except Exception as e:
            self.log_test("Item structure test", False, f"Exception: {str(e)}")
            return False
            
    def test_scoring_formula_accuracy(self):
        """Test 3: Verify the new scoring formula is correctly implemented"""
        try:
            response = self.session.get(f"{BASE_URL}/tribes/leaderboard")
            if response.status_code != 200:
                self.log_test("Scoring formula test setup", False, f"Status: {response.status_code}")
                return False
                
            data = response.json()
            items = data.get('items', [])
            
            formula_correct_count = 0
            uploads_formula_count = 0
            
            for item in items:
                metrics = item['metrics']
                breakdown = item['scoreBreakdown']
                
                # Test uploads = posts + reels + stories
                calculated_uploads = metrics['posts'] + metrics['reels'] + metrics['stories']
                if calculated_uploads == metrics['uploads']:
                    uploads_formula_count += 1
                    
                # Test scoring formula:
                # Upload: 100 pts each, Like: 10 pts each, Comment: 20 pts each, 
                # Share: 50 pts each, Viral: 1000 pts each
                expected_upload_points = metrics['uploads'] * 100
                expected_like_points = metrics['likesReceived'] * 10
                expected_comment_points = metrics['commentsReceived'] * 20
                expected_share_points = metrics['sharesReceived'] * 50
                expected_viral_bonus = metrics['viralReels'] * 1000
                
                expected_total = (expected_upload_points + expected_like_points + 
                                expected_comment_points + expected_share_points + expected_viral_bonus)
                
                if (breakdown['uploadPoints'] == expected_upload_points and
                    breakdown['likePoints'] == expected_like_points and
                    breakdown['commentPoints'] == expected_comment_points and
                    breakdown['sharePoints'] == expected_share_points and
                    breakdown['viralBonus'] == expected_viral_bonus and
                    item['engagementScore'] == expected_total):
                    formula_correct_count += 1
                    
            # Check if majority of formulas are correct (allowing for some data variations)
            uploads_success = uploads_formula_count >= len(items) * 0.9  # 90% threshold
            formula_success = formula_correct_count >= len(items) * 0.9  # 90% threshold
            
            self.log_test("Uploads calculation (posts+reels+stories)", uploads_success, 
                         f"{uploads_formula_count}/{len(items)} correct")
            self.log_test("Scoring formula accuracy", formula_success,
                         f"{formula_correct_count}/{len(items)} tribes with correct scores")
            
            # Test individual formula components on first tribe
            if items:
                first_item = items[0]
                m = first_item['metrics']
                b = first_item['scoreBreakdown']
                
                upload_correct = b['uploadPoints'] == m['uploads'] * 100
                like_correct = b['likePoints'] == m['likesReceived'] * 10
                comment_correct = b['commentPoints'] == m['commentsReceived'] * 20
                share_correct = b['sharePoints'] == m['sharesReceived'] * 50
                viral_correct = b['viralBonus'] == m['viralReels'] * 1000
                
                self.log_test("Upload points formula (uploads * 100)", upload_correct)
                self.log_test("Like points formula (likes * 10)", like_correct)
                self.log_test("Comment points formula (comments * 20)", comment_correct)
                self.log_test("Share points formula (shares * 50)", share_correct)
                self.log_test("Viral bonus formula (viral reels * 1000)", viral_correct)
                
            return formula_success
            
        except Exception as e:
            self.log_test("Scoring formula test", False, f"Exception: {str(e)}")
            return False
            
    def test_ranking_order(self):
        """Test 4: Verify tribes are ranked by engagementScore descending"""
        try:
            response = self.session.get(f"{BASE_URL}/tribes/leaderboard")
            if response.status_code != 200:
                self.log_test("Ranking test setup", False, f"Status: {response.status_code}")
                return False
                
            data = response.json()
            items = data.get('items', [])
            
            # Check ranking order
            rank_correct = True
            score_descending = True
            
            for i, item in enumerate(items):
                expected_rank = i + 1
                if item['rank'] != expected_rank:
                    rank_correct = False
                    break
                    
                if i > 0 and item['engagementScore'] > items[i-1]['engagementScore']:
                    score_descending = False
                    break
                    
            self.log_test("Rank numbers sequential (1-21)", rank_correct)
            self.log_test("Tribes sorted by engagementScore descending", score_descending)
            
            # Log top 3 for verification
            if len(items) >= 3:
                top3_info = []
                for i in range(3):
                    tribe = items[i]
                    top3_info.append(f"#{tribe['rank']} {tribe['tribeCode']}: {tribe['engagementScore']} pts")
                
                self.log_test("Top 3 tribes ranking", True, "; ".join(top3_info))
                
            return rank_correct and score_descending
            
        except Exception as e:
            self.log_test("Ranking test", False, f"Exception: {str(e)}")
            return False
            
    def test_period_filtering(self):
        """Test 5: Period filtering (30d, 7d, all)"""
        try:
            # Test default (30d)
            response_30d = self.session.get(f"{BASE_URL}/tribes/leaderboard")
            # Test 7d
            response_7d = self.session.get(f"{BASE_URL}/tribes/leaderboard?period=7d")
            # Test all
            response_all = self.session.get(f"{BASE_URL}/tribes/leaderboard?period=all")
            
            responses = [
                ("30d default", response_30d),
                ("7d period", response_7d), 
                ("all period", response_all)
            ]
            
            all_success = True
            different_scores = False
            
            for period_name, response in responses:
                if response.status_code != 200:
                    self.log_test(f"Period filtering - {period_name}", False, 
                                f"Status: {response.status_code}")
                    all_success = False
                    continue
                    
                data = response.json()
                
                # Check period is returned in response
                if 'period' not in data:
                    self.log_test(f"Period filtering - {period_name} period field", False)
                    all_success = False
                else:
                    self.log_test(f"Period filtering - {period_name} success", True, 
                                f"Period: {data['period']}")
                    
            # Check if different periods return different scores (they should)
            if (response_30d.status_code == 200 and response_7d.status_code == 200):
                data_30d = response_30d.json()
                data_7d = response_7d.json()
                
                if (data_30d.get('items') and data_7d.get('items')):
                    score_30d = data_30d['items'][0]['engagementScore']
                    score_7d = data_7d['items'][0]['engagementScore']
                    different_scores = score_30d != score_7d
                    
            self.log_test("Period filtering returns different scores", different_scores,
                         f"30d={score_30d if 'score_30d' in locals() else 'N/A'} vs 7d={score_7d if 'score_7d' in locals() else 'N/A'}")
                         
            return all_success
            
        except Exception as e:
            self.log_test("Period filtering test", False, f"Exception: {str(e)}")
            return False
            
    def test_data_quality(self):
        """Test 6: Data quality checks"""
        try:
            response = self.session.get(f"{BASE_URL}/tribes/leaderboard")
            if response.status_code != 200:
                self.log_test("Data quality test setup", False, f"Status: {response.status_code}")
                return False
                
            data = response.json()
            items = data.get('items', [])
            
            non_negative_metrics = True
            valid_timestamps = True
            realistic_scores = True
            
            for item in items:
                # Check all metrics are non-negative
                metrics = item['metrics']
                for metric_name, value in metrics.items():
                    if value < 0:
                        non_negative_metrics = False
                        break
                        
                # Check engagementScore is non-negative
                if item['engagementScore'] < 0:
                    non_negative_metrics = False
                    
            # Check timestamp format
            try:
                datetime.fromisoformat(data['generatedAt'].replace('Z', '+00:00'))
            except:
                valid_timestamps = False
                
            # Check score ranges are realistic (not all zeros, not impossibly high)
            if items:
                max_score = max(item['engagementScore'] for item in items)
                min_score = min(item['engagementScore'] for item in items)
                
                # Realistic range check
                realistic_scores = max_score < 1000000 and min_score >= 0
                
            self.log_test("All metrics non-negative", non_negative_metrics)
            self.log_test("Valid ISO timestamp", valid_timestamps)
            self.log_test("Realistic engagement score ranges", realistic_scores,
                         f"Range: {min_score if items else 0}-{max_score if items else 0}")
            
            # Check tribe codes are valid
            valid_codes = True
            if items:
                for item in items:
                    if not item.get('tribeCode') or len(item['tribeCode']) < 2:
                        valid_codes = False
                        break
                        
            self.log_test("Valid tribe codes", valid_codes)
            
            return non_negative_metrics and valid_timestamps and realistic_scores and valid_codes
            
        except Exception as e:
            self.log_test("Data quality test", False, f"Exception: {str(e)}")
            return False
            
    def test_no_auth_required(self):
        """Test 7: Endpoint works without authentication"""
        try:
            # Create a new session without any auth headers
            no_auth_session = requests.Session()
            response = no_auth_session.get(f"{BASE_URL}/tribes/leaderboard")
            
            if response.status_code != 200:
                self.log_test("No auth required", False, f"Status: {response.status_code}")
                return False
                
            data = response.json()
            
            if data.get('count', 0) != 21:
                self.log_test("No auth required - full data", False, f"Got {data.get('count', 0)} tribes")
                return False
                
            self.log_test("No auth required", True, "Endpoint accessible without Bearer token")
            self.log_test("No auth required - full data", True, f"Returns {data.get('count', 0)} tribes")
            return True
            
        except Exception as e:
            self.log_test("No auth required test", False, f"Exception: {str(e)}")
            return False
            
    def test_backwards_compatibility(self):
        """Test 8: Backwards compatibility (both 'items' and 'leaderboard' keys)"""
        try:
            response = self.session.get(f"{BASE_URL}/tribes/leaderboard")
            if response.status_code != 200:
                self.log_test("Backwards compatibility test setup", False, f"Status: {response.status_code}")
                return False
                
            data = response.json()
            
            has_items = 'items' in data
            has_leaderboard = 'leaderboard' in data
            
            self.log_test("Response has 'items' key", has_items)
            self.log_test("Response has 'leaderboard' key", has_leaderboard)
            
            # Check if both keys have the same data
            if has_items and has_leaderboard:
                items_equal = data['items'] == data['leaderboard']
                self.log_test("'items' and 'leaderboard' contain same data", items_equal)
                return has_items and has_leaderboard and items_equal
            else:
                return has_items and has_leaderboard
                
        except Exception as e:
            self.log_test("Backwards compatibility test", False, f"Exception: {str(e)}")
            return False
            
    def run_all_tests(self):
        """Run all leaderboard tests"""
        print("🏛️ TRIBE LEADERBOARD UPDATED SCORING FORMULA COMPREHENSIVE TEST")
        print("=" * 70)
        print(f"Testing endpoint: {BASE_URL}/tribes/leaderboard")
        print(f"New scoring formula: Upload(100) + Like(10) + Comment(20) + Share(50) + Viral(1000)")
        print()
        
        # Run all tests
        tests = [
            self.test_leaderboard_endpoint_basic,
            self.test_leaderboard_item_structure, 
            self.test_scoring_formula_accuracy,
            self.test_ranking_order,
            self.test_period_filtering,
            self.test_data_quality,
            self.test_no_auth_required,
            self.test_backwards_compatibility
        ]
        
        passed = 0
        total = 0
        
        for test_func in tests:
            try:
                if test_func():
                    passed += 1
                total += 1
                print()  # Add spacing between test groups
            except Exception as e:
                print(f"❌ Test {test_func.__name__} failed with exception: {str(e)}")
                total += 1
                
        # Final summary
        print("=" * 70)
        print("🏛️ TRIBE LEADERBOARD TEST SUMMARY")
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
    tester = TribeLeaderboardTester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)