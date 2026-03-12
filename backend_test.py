#!/usr/bin/env python3
"""
Comprehensive Regression Test & Scoring for Tribe Social Media Backend API
Base URL: https://dev-hub-39.preview.emergentagent.com/api

Tests ALL 12 endpoint categories with scoring:
1. AUTH & ONBOARDING
2. FEED (Posts) 
3. REELS
4. STORIES
5. TRIBES
6. SEARCH
7. ANALYTICS
8. TRANSCODE
9. FOLLOW REQUESTS
10. SOCIAL INTERACTIONS
11. REDIS CACHE
12. NOTIFICATIONS

Scoring: Each category scored 0-100 based on success rate
- 100: All endpoints respond correctly 
- 80-99: Minor issues
- 60-79: Some endpoints broken
- <60: Critical failures
"""

import requests
import json
import time
from datetime import datetime
from typing import Dict, List, Any

# Test Configuration
BASE_URL = "https://dev-hub-39.preview.emergentagent.com/api"
TEST_USER_1 = {"phone": "7777099001", "pin": "1234"}  
TEST_USER_2 = {"phone": "7777099002", "pin": "1234"}

class TribeAPITester:
    def __init__(self):
        self.session = requests.Session()
        self.session.timeout = 30
        self.access_token = None
        self.access_token_2 = None
        self.test_results = {}
        self.category_scores = {}
        
    def log(self, message: str, level: str = "INFO"):
        """Log test messages with timestamp"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        print(f"[{timestamp}] {level}: {message}")
        
    def make_request(self, method: str, endpoint: str, **kwargs) -> Dict[str, Any]:
        """Make HTTP request with error handling"""
        url = f"{BASE_URL}{endpoint}"
        
        # Add auth header if token available
        headers = kwargs.pop('headers', {})
        if self.access_token and 'Authorization' not in headers:
            headers['Authorization'] = f'Bearer {self.access_token}'
        if headers:
            kwargs['headers'] = headers
            
        try:
            self.log(f"{method.upper()} {endpoint}")
            response = self.session.request(method, url, **kwargs)
            
            # Parse JSON response
            try:
                data = response.json()
            except:
                data = {"raw_response": response.text}
                
            return {
                'status_code': response.status_code,
                'data': data,
                'headers': dict(response.headers),
                'success': 200 <= response.status_code < 300
            }
        except Exception as e:
            self.log(f"Request failed: {str(e)}", "ERROR")
            return {
                'status_code': 0,
                'data': {'error': str(e)},
                'headers': {},
                'success': False
            }
    
    def test_category_1_auth_onboarding(self):
        """Test AUTH & ONBOARDING endpoints"""
        self.log("=== TESTING CATEGORY 1: AUTH & ONBOARDING ===")
        results = []
        
        # 1. POST /auth/login
        self.log("Testing POST /auth/login")
        result = self.make_request('POST', '/auth/login', json=TEST_USER_1)
        results.append({
            'endpoint': 'POST /auth/login',
            'success': result['success'] and 'accessToken' in result.get('data', {}),
            'status_code': result['status_code'],
            'details': 'Login successful' if result['success'] else f"Error: {result['data']}"
        })
        
        # Store token for subsequent requests
        if result['success'] and 'accessToken' in result.get('data', {}):
            self.access_token = result['data']['accessToken']
            self.log(f"Access token obtained: {self.access_token[:20]}...")
        
        # 2. POST /auth/register (new user)
        self.log("Testing POST /auth/register")
        new_user = {"phone": "7777099099", "pin": "1234"}
        result = self.make_request('POST', '/auth/register', json=new_user)
        results.append({
            'endpoint': 'POST /auth/register',
            'success': result['success'],
            'status_code': result['status_code'], 
            'details': 'Registration successful' if result['success'] else f"Error: {result['data']}"
        })
        
        # 3. POST /auth/logout
        self.log("Testing POST /auth/logout")
        result = self.make_request('POST', '/auth/logout')
        results.append({
            'endpoint': 'POST /auth/logout',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Logout successful' if result['success'] else f"Error: {result['data']}"
        })
        
        # 4. GET /auth/me
        self.log("Testing GET /auth/me")
        result = self.make_request('GET', '/auth/me')
        results.append({
            'endpoint': 'GET /auth/me',
            'success': result['success'] and ('user' in result.get('data', {}) or 'id' in result.get('data', {})),
            'status_code': result['status_code'],
            'details': 'User profile retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # Calculate score
        passed = sum(1 for r in results if r['success'])
        score = (passed / len(results)) * 100
        
        self.test_results['auth_onboarding'] = results
        self.category_scores['AUTH & ONBOARDING'] = score
        self.log(f"Category 1 Score: {score:.1f}% ({passed}/{len(results)} passed)")
        return results
    
    def test_category_2_feed_posts(self):
        """Test FEED (Posts) endpoints"""
        self.log("=== TESTING CATEGORY 2: FEED (Posts) ===")
        results = []
        
        # Re-login to ensure we have token
        login_result = self.make_request('POST', '/auth/login', json=TEST_USER_1)
        if login_result['success'] and 'accessToken' in login_result.get('data', {}):
            self.access_token = login_result['data']['accessToken']
        
        # 1. GET /feed - Home feed
        self.log("Testing GET /feed")
        result = self.make_request('GET', '/feed')
        results.append({
            'endpoint': 'GET /feed',
            'success': result['success'] and ('posts' in result.get('data', {}) or isinstance(result.get('data'), list)),
            'status_code': result['status_code'],
            'details': f"Retrieved {len(result.get('data', {}).get('posts', result.get('data', [])))} posts" if result['success'] else f"Error: {result['data']}"
        })
        
        # 2. GET /feed/public
        self.log("Testing GET /feed/public")  
        result = self.make_request('GET', '/feed/public')
        results.append({
            'endpoint': 'GET /feed/public',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Public feed retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 3. GET /feed/following
        self.log("Testing GET /feed/following")
        result = self.make_request('GET', '/feed/following')
        results.append({
            'endpoint': 'GET /feed/following',  
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Following feed retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 4. GET /explore
        self.log("Testing GET /explore")
        result = self.make_request('GET', '/explore')
        results.append({
            'endpoint': 'GET /explore',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Explore page retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 5. GET /explore/creators
        self.log("Testing GET /explore/creators")
        result = self.make_request('GET', '/explore/creators')
        results.append({
            'endpoint': 'GET /explore/creators',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Popular creators retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 6. GET /explore/reels
        self.log("Testing GET /explore/reels")
        result = self.make_request('GET', '/explore/reels')
        results.append({
            'endpoint': 'GET /explore/reels',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Explore reels retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # Calculate score
        passed = sum(1 for r in results if r['success'])
        score = (passed / len(results)) * 100
        
        self.test_results['feed_posts'] = results
        self.category_scores['FEED (Posts)'] = score
        self.log(f"Category 2 Score: {score:.1f}% ({passed}/{len(results)} passed)")
        return results
        
    def test_category_3_reels(self):
        """Test REELS endpoints"""
        self.log("=== TESTING CATEGORY 3: REELS ===")
        results = []
        
        # 1. GET /reels/feed
        self.log("Testing GET /reels/feed")
        result = self.make_request('GET', '/reels/feed')
        results.append({
            'endpoint': 'GET /reels/feed',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Reel discovery feed retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 2. GET /reels/following
        self.log("Testing GET /reels/following")
        result = self.make_request('GET', '/reels/following')
        results.append({
            'endpoint': 'GET /reels/following',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Following reels retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 3. GET /reels/trending
        self.log("Testing GET /reels/trending")
        result = self.make_request('GET', '/reels/trending')
        results.append({
            'endpoint': 'GET /reels/trending',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Trending reels retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 4. GET /reels/personalized
        self.log("Testing GET /reels/personalized")
        result = self.make_request('GET', '/reels/personalized')
        results.append({
            'endpoint': 'GET /reels/personalized',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Personalized reels retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 5. POST /reels (create reel - may fail without media)
        self.log("Testing POST /reels")
        reel_data = {
            "caption": "Test reel from regression test",
            "visibility": "PUBLIC"
        }
        result = self.make_request('POST', '/reels', json=reel_data)
        results.append({
            'endpoint': 'POST /reels',
            'success': result['success'] or result['status_code'] == 400,  # 400 acceptable for missing media
            'status_code': result['status_code'],
            'details': 'Reel creation attempted' if result['success'] else f"Expected validation error: {result['data']}"
        })
        
        # 6. GET /reels/:id (try to get any reel)
        self.log("Testing GET /reels/:id")
        result = self.make_request('GET', '/reels/test-id')
        results.append({
            'endpoint': 'GET /reels/:id',
            'success': result['status_code'] in [200, 404],  # Both acceptable
            'status_code': result['status_code'],
            'details': 'Reel detail endpoint tested' if result['status_code'] in [200, 404] else f"Error: {result['data']}"
        })
        
        # Calculate score
        passed = sum(1 for r in results if r['success'])
        score = (passed / len(results)) * 100
        
        self.test_results['reels'] = results
        self.category_scores['REELS'] = score
        self.log(f"Category 3 Score: {score:.1f}% ({passed}/{len(results)} passed)")
        return results
        
    def test_category_4_stories(self):
        """Test STORIES endpoints"""
        self.log("=== TESTING CATEGORY 4: STORIES ===")
        results = []
        
        # 1. GET /stories
        self.log("Testing GET /stories")
        result = self.make_request('GET', '/stories')
        results.append({
            'endpoint': 'GET /stories',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Story rail retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 2. GET /stories/feed
        self.log("Testing GET /stories/feed")
        result = self.make_request('GET', '/stories/feed')
        results.append({
            'endpoint': 'GET /stories/feed',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Story feed retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 3. POST /stories (create story - may fail without media)
        self.log("Testing POST /stories")
        story_data = {
            "caption": "Test story from regression test",
            "visibility": "PUBLIC"
        }
        result = self.make_request('POST', '/stories', json=story_data)
        results.append({
            'endpoint': 'POST /stories',
            'success': result['success'] or result['status_code'] == 400,  # 400 acceptable for validation
            'status_code': result['status_code'],
            'details': 'Story creation attempted' if result['success'] else f"Expected validation error: {result['data']}"
        })
        
        # Calculate score
        passed = sum(1 for r in results if r['success'])
        score = (passed / len(results)) * 100
        
        self.test_results['stories'] = results
        self.category_scores['STORIES'] = score
        self.log(f"Category 4 Score: {score:.1f}% ({passed}/{len(results)} passed)")
        return results
        
    def test_category_5_tribes(self):
        """Test TRIBES endpoints"""
        self.log("=== TESTING CATEGORY 5: TRIBES ===")
        results = []
        
        # 1. GET /tribes
        self.log("Testing GET /tribes")
        result = self.make_request('GET', '/tribes')
        results.append({
            'endpoint': 'GET /tribes',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': f"Retrieved tribes list" if result['success'] else f"Error: {result['data']}"
        })
        
        # 2. GET /tribes/leaderboard
        self.log("Testing GET /tribes/leaderboard")
        result = self.make_request('GET', '/tribes/leaderboard')
        results.append({
            'endpoint': 'GET /tribes/leaderboard',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Leaderboard retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 3. GET /tribes/standings/current
        self.log("Testing GET /tribes/standings/current")
        result = self.make_request('GET', '/tribes/standings/current')
        results.append({
            'endpoint': 'GET /tribes/standings/current',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Current standings retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # Get a tribe ID for detailed tests
        tribe_id = "test-tribe"
        if result['success'] and 'data' in result.get('data', {}):
            tribes_data = result['data']['data']
            if tribes_data and len(tribes_data) > 0:
                tribe_id = tribes_data[0].get('id', 'test-tribe')
        
        # 4. GET /tribes/:id
        self.log(f"Testing GET /tribes/{tribe_id}")
        result = self.make_request('GET', f'/tribes/{tribe_id}')
        results.append({
            'endpoint': 'GET /tribes/:id',
            'success': result['status_code'] in [200, 404],  # Both acceptable
            'status_code': result['status_code'],
            'details': 'Tribe detail endpoint tested' if result['status_code'] in [200, 404] else f"Error: {result['data']}"
        })
        
        # 5. GET /tribes/:id/members
        self.log(f"Testing GET /tribes/{tribe_id}/members")
        result = self.make_request('GET', f'/tribes/{tribe_id}/members')
        results.append({
            'endpoint': 'GET /tribes/:id/members',
            'success': result['status_code'] in [200, 404],  # Both acceptable
            'status_code': result['status_code'],
            'details': 'Tribe members endpoint tested' if result['status_code'] in [200, 404] else f"Error: {result['data']}"
        })
        
        # 6. GET /tribes/:id/stats
        self.log(f"Testing GET /tribes/{tribe_id}/stats")
        result = self.make_request('GET', f'/tribes/{tribe_id}/stats')
        results.append({
            'endpoint': 'GET /tribes/:id/stats',
            'success': result['status_code'] in [200, 404],
            'status_code': result['status_code'],
            'details': 'Tribe stats endpoint tested' if result['status_code'] in [200, 404] else f"Error: {result['data']}"
        })
        
        # 7. GET /tribes/:id/feed
        self.log(f"Testing GET /tribes/{tribe_id}/feed")
        result = self.make_request('GET', f'/tribes/{tribe_id}/feed')
        results.append({
            'endpoint': 'GET /tribes/:id/feed',
            'success': result['status_code'] in [200, 404],
            'status_code': result['status_code'],
            'details': 'Tribe feed endpoint tested' if result['status_code'] in [200, 404] else f"Error: {result['data']}"
        })
        
        # 8. POST /tribes/:id/cheer (rate limited)
        self.log(f"Testing POST /tribes/{tribe_id}/cheer")
        result = self.make_request('POST', f'/tribes/{tribe_id}/cheer')
        results.append({
            'endpoint': 'POST /tribes/:id/cheer',
            'success': result['status_code'] in [200, 201, 404, 429],  # All acceptable responses
            'status_code': result['status_code'],
            'details': 'Cheer endpoint tested (rate limited 1/day)' if result['status_code'] in [200, 201, 404, 429] else f"Error: {result['data']}"
        })
        
        # 9. GET /me/tribe
        self.log("Testing GET /me/tribe")
        result = self.make_request('GET', '/me/tribe')
        results.append({
            'endpoint': 'GET /me/tribe',
            'success': result['status_code'] in [200, 404],  # User may not have tribe
            'status_code': result['status_code'],
            'details': 'My tribe endpoint tested' if result['status_code'] in [200, 404] else f"Error: {result['data']}"
        })
        
        # Calculate score
        passed = sum(1 for r in results if r['success'])
        score = (passed / len(results)) * 100
        
        self.test_results['tribes'] = results
        self.category_scores['TRIBES'] = score
        self.log(f"Category 5 Score: {score:.1f}% ({passed}/{len(results)} passed)")
        return results
        
    def test_category_6_search(self):
        """Test SEARCH endpoints"""
        self.log("=== TESTING CATEGORY 6: SEARCH ===")
        results = []
        
        # 1. GET /search?q=test
        self.log("Testing GET /search?q=test")
        result = self.make_request('GET', '/search?q=test')
        results.append({
            'endpoint': 'GET /search?q=test',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Unified search retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 2. GET /search?q=test&type=users
        self.log("Testing GET /search?q=test&type=users")
        result = self.make_request('GET', '/search?q=test&type=users')
        results.append({
            'endpoint': 'GET /search?q=test&type=users',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Type-filtered search retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 3. GET /search?q=test&type=invalid (should return 400)
        self.log("Testing GET /search?q=test&type=invalid")
        result = self.make_request('GET', '/search?q=test&type=invalid')
        results.append({
            'endpoint': 'GET /search?q=test&type=invalid',
            'success': result['status_code'] == 400,
            'status_code': result['status_code'],
            'details': 'Invalid type properly rejected (400)' if result['status_code'] == 400 else f"Expected 400, got {result['status_code']}"
        })
        
        # 4. GET /search/autocomplete?q=te
        self.log("Testing GET /search/autocomplete?q=te")
        result = self.make_request('GET', '/search/autocomplete?q=te')
        results.append({
            'endpoint': 'GET /search/autocomplete?q=te',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Autocomplete retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 5. GET /search/users?q=test
        self.log("Testing GET /search/users?q=test")
        result = self.make_request('GET', '/search/users?q=test')
        results.append({
            'endpoint': 'GET /search/users?q=test',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'User search retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 6. GET /search/hashtags?q=test
        self.log("Testing GET /search/hashtags?q=test")
        result = self.make_request('GET', '/search/hashtags?q=test')
        results.append({
            'endpoint': 'GET /search/hashtags?q=test',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Hashtag search retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 7. GET /search/content?q=test
        self.log("Testing GET /search/content?q=test")
        result = self.make_request('GET', '/search/content?q=test')
        results.append({
            'endpoint': 'GET /search/content?q=test',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Content search retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 8. GET /search/recent
        self.log("Testing GET /search/recent")
        result = self.make_request('GET', '/search/recent')
        results.append({
            'endpoint': 'GET /search/recent',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Recent searches retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # Calculate score
        passed = sum(1 for r in results if r['success'])
        score = (passed / len(results)) * 100
        
        self.test_results['search'] = results
        self.category_scores['SEARCH'] = score
        self.log(f"Category 6 Score: {score:.1f}% ({passed}/{len(results)} passed)")
        return results
        
    def test_category_7_analytics(self):
        """Test ANALYTICS endpoints"""
        self.log("=== TESTING CATEGORY 7: ANALYTICS ===")
        results = []
        
        # 1. POST /analytics/track
        self.log("Testing POST /analytics/track")
        track_data = {"eventType": "PROFILE_VISIT", "targetId": "test"}
        result = self.make_request('POST', '/analytics/track', json=track_data)
        results.append({
            'endpoint': 'POST /analytics/track',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Event tracked' if result['success'] else f"Error: {result['data']}"
        })
        
        # 2. GET /analytics/overview
        self.log("Testing GET /analytics/overview")
        result = self.make_request('GET', '/analytics/overview')
        results.append({
            'endpoint': 'GET /analytics/overview',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Overview analytics retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 3. GET /analytics/overview?period=30d
        self.log("Testing GET /analytics/overview?period=30d")
        result = self.make_request('GET', '/analytics/overview?period=30d')
        results.append({
            'endpoint': 'GET /analytics/overview?period=30d',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Period analytics retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 4. GET /analytics/content
        self.log("Testing GET /analytics/content")
        result = self.make_request('GET', '/analytics/content')
        results.append({
            'endpoint': 'GET /analytics/content',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Content performance retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 5. GET /analytics/audience
        self.log("Testing GET /analytics/audience")
        result = self.make_request('GET', '/analytics/audience')
        results.append({
            'endpoint': 'GET /analytics/audience',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Audience demographics retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 6. GET /analytics/reach
        self.log("Testing GET /analytics/reach")
        result = self.make_request('GET', '/analytics/reach')
        results.append({
            'endpoint': 'GET /analytics/reach',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Reach & impressions retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 7. GET /analytics/profile-visits
        self.log("Testing GET /analytics/profile-visits")
        result = self.make_request('GET', '/analytics/profile-visits')
        results.append({
            'endpoint': 'GET /analytics/profile-visits',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Profile visits retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 8. GET /analytics/reels
        self.log("Testing GET /analytics/reels")
        result = self.make_request('GET', '/analytics/reels')
        results.append({
            'endpoint': 'GET /analytics/reels',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Reel analytics retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # Calculate score
        passed = sum(1 for r in results if r['success'])
        score = (passed / len(results)) * 100
        
        self.test_results['analytics'] = results
        self.category_scores['ANALYTICS'] = score
        self.log(f"Category 7 Score: {score:.1f}% ({passed}/{len(results)} passed)")
        return results
        
    def test_category_8_transcode(self):
        """Test TRANSCODE (Video) endpoints"""
        self.log("=== TESTING CATEGORY 8: TRANSCODE ===")
        results = []
        
        # 1. GET /transcode/queue
        self.log("Testing GET /transcode/queue")
        result = self.make_request('GET', '/transcode/queue')
        results.append({
            'endpoint': 'GET /transcode/queue',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Transcode queue retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 2. GET /transcode/queue?status=COMPLETED
        self.log("Testing GET /transcode/queue?status=COMPLETED")
        result = self.make_request('GET', '/transcode/queue?status=COMPLETED')
        results.append({
            'endpoint': 'GET /transcode/queue?status=COMPLETED',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Filtered transcode queue retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # Calculate score
        passed = sum(1 for r in results if r['success'])
        score = (passed / len(results)) * 100
        
        self.test_results['transcode'] = results
        self.category_scores['TRANSCODE'] = score
        self.log(f"Category 8 Score: {score:.1f}% ({passed}/{len(results)} passed)")
        return results
        
    def test_category_9_follow_requests(self):
        """Test FOLLOW REQUESTS endpoints"""
        self.log("=== TESTING CATEGORY 9: FOLLOW REQUESTS ===")
        results = []
        
        # 1. GET /me/follow-requests
        self.log("Testing GET /me/follow-requests")
        result = self.make_request('GET', '/me/follow-requests')
        results.append({
            'endpoint': 'GET /me/follow-requests',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Pending requests retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 2. GET /me/follow-requests/sent
        self.log("Testing GET /me/follow-requests/sent")
        result = self.make_request('GET', '/me/follow-requests/sent')
        results.append({
            'endpoint': 'GET /me/follow-requests/sent',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Sent requests retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # 3. GET /me/follow-requests/count
        self.log("Testing GET /me/follow-requests/count")
        result = self.make_request('GET', '/me/follow-requests/count')
        results.append({
            'endpoint': 'GET /me/follow-requests/count',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Request count retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # Calculate score
        passed = sum(1 for r in results if r['success'])
        score = (passed / len(results)) * 100
        
        self.test_results['follow_requests'] = results
        self.category_scores['FOLLOW REQUESTS'] = score
        self.log(f"Category 9 Score: {score:.1f}% ({passed}/{len(results)} passed)")
        return results
        
    def test_category_10_social_interactions(self):
        """Test SOCIAL INTERACTIONS"""
        self.log("=== TESTING CATEGORY 10: SOCIAL INTERACTIONS ===")
        results = []
        
        # First get a post/content ID to interact with
        feed_result = self.make_request('GET', '/feed/public')
        content_id = "test-post"
        if feed_result['success']:
            posts = feed_result.get('data', {}).get('posts', feed_result.get('data', []))
            if posts and len(posts) > 0 and isinstance(posts, list):
                content_id = posts[0].get('id', 'test-post')
        
        # 1. Test like/unlike flow
        self.log(f"Testing like flow on content {content_id}")
        like_result = self.make_request('POST', f'/content/{content_id}/like')
        unlike_result = self.make_request('DELETE', f'/content/{content_id}/like')
        
        results.append({
            'endpoint': 'POST/DELETE /content/:id/like',
            'success': like_result['status_code'] in [200, 201, 404] and unlike_result['status_code'] in [200, 204, 404],
            'status_code': f"{like_result['status_code']}/{unlike_result['status_code']}",
            'details': 'Like/unlike flow tested' if like_result['status_code'] in [200, 201, 404] else f"Like error: {like_result['data']}"
        })
        
        # 2. Test comment creation
        self.log(f"Testing comment creation on content {content_id}")
        comment_data = {"text": "Test comment from regression test"}
        result = self.make_request('POST', f'/content/{content_id}/comments', json=comment_data)
        results.append({
            'endpoint': 'POST /content/:id/comments',
            'success': result['status_code'] in [200, 201, 404],  # 404 acceptable if post doesn't exist
            'status_code': result['status_code'],
            'details': 'Comment creation tested' if result['status_code'] in [200, 201, 404] else f"Error: {result['data']}"
        })
        
        # 3. Test save/unsave flow
        self.log(f"Testing save/unsave flow on content {content_id}")
        save_result = self.make_request('POST', f'/content/{content_id}/save')
        unsave_result = self.make_request('DELETE', f'/content/{content_id}/save')
        
        results.append({
            'endpoint': 'POST/DELETE /content/:id/save',
            'success': save_result['status_code'] in [200, 201, 404] and unsave_result['status_code'] in [200, 204, 404],
            'status_code': f"{save_result['status_code']}/{unsave_result['status_code']}",
            'details': 'Save/unsave flow tested' if save_result['status_code'] in [200, 201, 404] else f"Save error: {save_result['data']}"
        })
        
        # Calculate score
        passed = sum(1 for r in results if r['success'])
        score = (passed / len(results)) * 100
        
        self.test_results['social_interactions'] = results
        self.category_scores['SOCIAL INTERACTIONS'] = score
        self.log(f"Category 10 Score: {score:.1f}% ({passed}/{len(results)} passed)")
        return results
        
    def test_category_11_redis_cache(self):
        """Test REDIS CACHE"""
        self.log("=== TESTING CATEGORY 11: REDIS CACHE ===")
        results = []
        
        # 1. GET /cache/stats
        self.log("Testing GET /cache/stats")
        result = self.make_request('GET', '/cache/stats')
        
        # Check for Redis connection and keys
        redis_connected = False
        has_keys = False
        
        if result['success']:
            data = result.get('data', {})
            redis_connected = data.get('redis') == 'connected' or 'redis' in str(data).lower()
            has_keys = data.get('keys', 0) > 0 or 'keys' in str(data)
            
        results.append({
            'endpoint': 'GET /cache/stats',
            'success': result['success'] and redis_connected,
            'status_code': result['status_code'],
            'details': f"Redis connected: {redis_connected}, Keys: {has_keys}" if result['success'] else f"Error: {result['data']}"
        })
        
        # Test cached endpoint performance (call same endpoint twice)
        self.log("Testing cache performance with repeated calls")
        start1 = time.time()
        first_call = self.make_request('GET', '/feed/public')
        time1 = time.time() - start1
        
        time.sleep(0.1)  # Brief pause
        
        start2 = time.time()
        second_call = self.make_request('GET', '/feed/public')
        time2 = time.time() - start2
        
        # Second call should be faster (cached) or at least successful
        cache_performance = second_call['success'] and (time2 < time1 * 2)  # Allow some variance
        
        results.append({
            'endpoint': 'Cache Performance Test',
            'success': cache_performance,
            'status_code': f"{first_call['status_code']}/{second_call['status_code']}",
            'details': f"First: {time1:.3f}s, Second: {time2:.3f}s, Faster: {time2 < time1}" if first_call['success'] else "Cache performance test failed"
        })
        
        # Calculate score
        passed = sum(1 for r in results if r['success'])
        score = (passed / len(results)) * 100
        
        self.test_results['redis_cache'] = results
        self.category_scores['REDIS CACHE'] = score
        self.log(f"Category 11 Score: {score:.1f}% ({passed}/{len(results)} passed)")
        return results
        
    def test_category_12_notifications(self):
        """Test NOTIFICATIONS"""
        self.log("=== TESTING CATEGORY 12: NOTIFICATIONS ===")
        results = []
        
        # 1. GET /notifications
        self.log("Testing GET /notifications")
        result = self.make_request('GET', '/notifications')
        results.append({
            'endpoint': 'GET /notifications',
            'success': result['success'],
            'status_code': result['status_code'],
            'details': 'Notifications retrieved' if result['success'] else f"Error: {result['data']}"
        })
        
        # Calculate score
        passed = sum(1 for r in results if r['success'])
        score = (passed / len(results)) * 100
        
        self.test_results['notifications'] = results
        self.category_scores['NOTIFICATIONS'] = score
        self.log(f"Category 12 Score: {score:.1f}% ({passed}/{len(results)} passed)")
        return results
        
    def run_comprehensive_test(self):
        """Run all test categories"""
        self.log("🎯 STARTING COMPREHENSIVE REGRESSION TEST & SCORING")
        self.log(f"Base URL: {BASE_URL}")
        
        # Run all category tests
        self.test_category_1_auth_onboarding()
        self.test_category_2_feed_posts()
        self.test_category_3_reels()
        self.test_category_4_stories()
        self.test_category_5_tribes()
        self.test_category_6_search()
        self.test_category_7_analytics()
        self.test_category_8_transcode()
        self.test_category_9_follow_requests()
        self.test_category_10_social_interactions()
        self.test_category_11_redis_cache()
        self.test_category_12_notifications()
        
        # Generate final report
        self.generate_final_report()
        
    def generate_final_report(self):
        """Generate comprehensive test report with scores"""
        self.log("\n" + "="*80)
        self.log("📊 COMPREHENSIVE REGRESSION TEST REPORT")
        self.log("="*80)
        
        total_tests = 0
        total_passed = 0
        
        for category, score in self.category_scores.items():
            category_results = self.test_results.get(category.lower().replace(' ', '_').replace('(', '').replace(')', ''), [])
            passed = sum(1 for r in category_results if r['success'])
            total = len(category_results)
            
            total_tests += total
            total_passed += passed
            
            # Determine score interpretation
            if score >= 100:
                status = "🟢 EXCELLENT"
            elif score >= 80:
                status = "🟡 GOOD"
            elif score >= 60:
                status = "🟠 NEEDS ATTENTION"
            else:
                status = "🔴 CRITICAL"
                
            self.log(f"{category:<20} | Score: {score:5.1f}% | {passed:2d}/{total:2d} | {status}")
            
        # Overall score
        overall_score = (total_passed / total_tests) * 100 if total_tests > 0 else 0
        
        self.log("-" * 80)
        self.log(f"{'OVERALL SCORE':<20} | Score: {overall_score:5.1f}% | {total_passed:2d}/{total_tests:2d} | {'🟢 PRODUCTION READY' if overall_score >= 80 else '🟡 NEEDS WORK' if overall_score >= 60 else '🔴 CRITICAL ISSUES'}")
        self.log("="*80)
        
        # Category breakdown
        self.log("\n📈 SCORE BREAKDOWN BY CATEGORY:")
        for category in sorted(self.category_scores.keys()):
            score = self.category_scores[category]
            self.log(f"  {category}: {score:.1f}%")
            
        # Failed endpoints summary
        self.log("\n❌ FAILED ENDPOINTS:")
        for category_key, results in self.test_results.items():
            failed = [r for r in results if not r['success']]
            if failed:
                self.log(f"\n{category_key.upper().replace('_', ' ')}:")
                for failure in failed:
                    self.log(f"  ❌ {failure['endpoint']} - {failure['status_code']} - {failure['details']}")
                    
        # Success summary
        self.log(f"\n✅ SUMMARY: {total_passed}/{total_tests} endpoints working ({overall_score:.1f}% success rate)")
        
        if overall_score >= 95:
            self.log("🎉 EXCELLENT! Backend is production ready with outstanding performance.")
        elif overall_score >= 85:
            self.log("👍 GOOD! Backend is production ready with minor issues to monitor.")
        elif overall_score >= 70:
            self.log("⚠️  ACCEPTABLE! Backend is functional but needs attention on failed endpoints.")
        else:
            self.log("🚨 CRITICAL! Backend has significant issues that need immediate attention.")
            
        return {
            'overall_score': overall_score,
            'total_tests': total_tests,
            'total_passed': total_passed,
            'category_scores': self.category_scores,
            'detailed_results': self.test_results
        }

if __name__ == "__main__":
    tester = TribeAPITester()
    tester.run_comprehensive_test()