#!/usr/bin/env python3
"""
Page-Level Endpoints Testing for Tribe Social Platform

Testing NEW page-level endpoints that were just implemented:
- POST/GET /api/pages/:id/reels (Create/List page reels)
- POST/GET /api/pages/:id/stories (Create/List page stories) 
- POST/DELETE /api/pages/:id/posts/:postId/pin (Pin/Unpin page post)
- POST/GET/PATCH /api/pages/:id/posts with scheduling (Scheduled/Draft posts)
- POST/DELETE /api/pages/:id/reels/:reelId/pin (Pin/Unpin page reel)
- GET /api/content/:postId with authorType=PAGE verification
- Authorization tests with different user roles

Base URL: https://latency-crusher.preview.emergentagent.com/api
Test Credentials:
- Phone: 7777099001, PIN: 1234 (ADMIN role)
- Phone: 7777099002, PIN: 1234 (regular user)

IMPORTANT: API responses are NOT wrapped in `data`. For example:
- POST /api/pages returns `{"page":{...}}` (not `{"data":{"page":{...}}}`)
- POST /api/pages/:id/posts returns `{"post":{...},"page":{...}}`
"""

import requests
import json
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any

# Configuration
BASE_URL = "https://latency-crusher.preview.emergentagent.com/api"

# Test state
test_results = []
tokens = {}
user_data = {}
test_page_id = None
test_post_id = None
test_reel_id = None
test_story_id = None

def log_test(test_name: str, success: bool, response_time: float = 0, details: str = "", status_code: int = 0):
    """Log test result"""
    result = {
        'test': test_name,
        'success': success,
        'response_time_ms': round(response_time * 1000, 2),
        'details': details,
        'status_code': status_code
    }
    test_results.append(result)
    
    status = "✅" if success else "❌"
    print(f"{status} {test_name} ({result['response_time_ms']}ms) - {details}")

def make_request(method: str, endpoint: str, token: str = None, data: dict = None, expect_status: int = 200) -> tuple:
    """Make HTTP request and return (success, response_time, response_json, status_code)"""
    url = f"{BASE_URL}{endpoint}"
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    
    start_time = time.time()
    try:
        if method == "GET":
            response = requests.get(url, headers=headers, timeout=15)
        elif method == "POST":
            response = requests.post(url, headers=headers, json=data, timeout=15)
        elif method == "PATCH":
            response = requests.patch(url, headers=headers, json=data, timeout=15)
        elif method == "PUT":
            response = requests.put(url, headers=headers, json=data, timeout=15)
        elif method == "DELETE":
            response = requests.delete(url, headers=headers, timeout=15)
        
        response_time = time.time() - start_time
        
        try:
            response_json = response.json()
        except:
            response_json = {"raw_text": response.text[:500]}
        
        success = response.status_code == expect_status
        return success, response_time, response_json, response.status_code
        
    except Exception as e:
        response_time = time.time() - start_time
        return False, response_time, {"error": str(e)}, 0

def setup_authentication():
    """Setup admin and regular user tokens"""
    print("\n🔐 Setting up authentication...")
    global tokens, user_data
    
    # Admin token (7777099001)
    success, resp_time, resp_json, status = make_request(
        "POST", "/auth/login", 
        data={"phone": "7777099001", "pin": "1234"}
    )
    
    if success and 'token' in resp_json:
        tokens['admin'] = resp_json['token']
        user_data['admin'] = resp_json.get('user', {})
        log_test("Admin Authentication", True, resp_time, f"Admin token obtained", status)
    else:
        log_test("Admin Authentication", False, resp_time, f"Failed: {resp_json}", status)
        return False
    
    # Regular user token (7777099002)  
    success, resp_time, resp_json, status = make_request(
        "POST", "/auth/login",
        data={"phone": "7777099002", "pin": "1234"}
    )
    
    if success and 'token' in resp_json:
        tokens['user'] = resp_json['token']
        user_data['user'] = resp_json.get('user', {})
        log_test("User Authentication", True, resp_time, f"User token obtained", status)
    else:
        log_test("User Authentication", False, resp_time, f"Failed: {resp_json}", status)
        return False
    
    return True

def setup_test_page():
    """Create a test page for endpoint testing"""
    print("\n📄 Setting up test page...")
    global test_page_id
    
    # Create page as admin user
    success, resp_time, resp_json, status = make_request(
        "POST", "/pages",
        token=tokens['admin'],
        data={
            "name": "TestPageForEndpoints",
            "category": "CLUB",
            "bio": "Test page for page endpoint testing"
        },
        expect_status=201
    )
    
    if success and 'page' in resp_json:
        test_page_id = resp_json['page']['id']
        log_test("Create Test Page", True, resp_time, f"Page created: {test_page_id}", status)
        return True
    else:
        log_test("Create Test Page", False, resp_time, f"Failed: {resp_json}", status)
        return False

def test_page_reels():
    """Test POST/GET /api/pages/:id/reels endpoints"""
    print("\n🎬 Testing Page Reels endpoints...")
    global test_reel_id
    
    # Test 1: POST /api/pages/:id/reels — Create reel as page
    success, resp_time, resp_json, status = make_request(
        "POST", f"/pages/{test_page_id}/reels",
        token=tokens['admin'],
        data={
            "caption": "Test page reel for endpoint testing",
            "mediaUrl": "https://example.com/test-video.mp4",
            "durationMs": 15000,
            "visibility": "PUBLIC"
        },
        expect_status=201
    )
    
    if success and 'reel' in resp_json:
        test_reel_id = resp_json['reel']['id']
        reel = resp_json['reel']
        
        # Verify response structure and content
        checks = []
        checks.append(reel.get('authorType') == 'PAGE')
        checks.append(reel.get('pageId') == test_page_id)
        checks.append(reel.get('status') == 'PUBLISHED')
        checks.append('page' in resp_json)
        
        if all(checks):
            log_test("POST /pages/:id/reels (Create page reel)", True, resp_time, 
                    f"✓ authorType=PAGE, pageId={test_page_id}, status=PUBLISHED", status)
        else:
            log_test("POST /pages/:id/reels (Create page reel)", False, resp_time, 
                    f"Response validation failed. authorType={reel.get('authorType')}, pageId={reel.get('pageId')}", status)
    else:
        log_test("POST /pages/:id/reels (Create page reel)", False, resp_time, f"Failed: {resp_json}", status)
    
    # Test 2: Validation - caption too long (>2200 chars)
    long_caption = "a" * 2201
    success, resp_time, resp_json, status = make_request(
        "POST", f"/pages/{test_page_id}/reels",
        token=tokens['admin'],
        data={
            "caption": long_caption,
            "mediaUrl": "https://example.com/test-video.mp4",
            "durationMs": 15000
        },
        expect_status=400
    )
    
    if not success and status == 400:
        log_test("POST /pages/:id/reels (Caption validation)", True, resp_time, 
                "✓ Long caption rejected (>2200 chars)", status)
    else:
        log_test("POST /pages/:id/reels (Caption validation)", False, resp_time, 
                f"Should reject long caption: {resp_json}", status)
    
    # Test 3: Validation - invalid visibility
    success, resp_time, resp_json, status = make_request(
        "POST", f"/pages/{test_page_id}/reels",
        token=tokens['admin'],
        data={
            "caption": "Test reel",
            "mediaUrl": "https://example.com/test-video.mp4",
            "durationMs": 15000,
            "visibility": "INVALID_VISIBILITY"
        },
        expect_status=400
    )
    
    if not success and status == 400:
        log_test("POST /pages/:id/reels (Visibility validation)", True, resp_time, 
                "✓ Invalid visibility rejected", status)
    else:
        log_test("POST /pages/:id/reels (Visibility validation)", False, resp_time, 
                f"Should reject invalid visibility: {resp_json}", status)
    
    # Test 4: GET /api/pages/:id/reels — List page reels
    success, resp_time, resp_json, status = make_request(
        "GET", f"/pages/{test_page_id}/reels"
    )
    
    if success and 'reels' in resp_json:
        reels = resp_json['reels']
        page = resp_json.get('page', {})
        
        # Check that we have at least one reel and it's authored by page
        checks = []
        checks.append(isinstance(reels, list))
        checks.append(len(reels) > 0)
        checks.append(all(reel.get('authorType') == 'PAGE' for reel in reels))
        checks.append('pagination' in resp_json or 'page' in resp_json)
        
        if all(checks):
            log_test("GET /pages/:id/reels (List page reels)", True, resp_time, 
                    f"✓ Found {len(reels)} reels, all authorType=PAGE", status)
        else:
            log_test("GET /pages/:id/reels (List page reels)", False, resp_time, 
                    f"Validation failed. reels={len(reels)}, authorTypes={[r.get('authorType') for r in reels]}", status)
    else:
        log_test("GET /pages/:id/reels (List page reels)", False, resp_time, f"Failed: {resp_json}", status)

def test_page_stories():
    """Test POST/GET /api/pages/:id/stories endpoints"""
    print("\n📖 Testing Page Stories endpoints...")
    global test_story_id
    
    # Test 1: POST /api/pages/:id/stories — Create TEXT story as page
    success, resp_time, resp_json, status = make_request(
        "POST", f"/pages/{test_page_id}/stories",
        token=tokens['admin'],
        data={
            "type": "TEXT",
            "text": "Test page story for endpoint testing",
            "background": {
                "type": "SOLID",
                "color": "#FF5722"
            },
            "privacy": "EVERYONE"
        },
        expect_status=201
    )
    
    if success and 'story' in resp_json:
        test_story_id = resp_json['story']['id']
        story = resp_json['story']
        
        # Verify response structure and content
        checks = []
        checks.append(story.get('authorType') == 'PAGE')
        checks.append(story.get('pageId') == test_page_id)
        checks.append(story.get('type') == 'TEXT')
        checks.append('page' in resp_json)
        
        if all(checks):
            log_test("POST /pages/:id/stories (Create page story)", True, resp_time, 
                    f"✓ authorType=PAGE, pageId={test_page_id}, type=TEXT", status)
        else:
            log_test("POST /pages/:id/stories (Create page story)", False, resp_time, 
                    f"Response validation failed. authorType={story.get('authorType')}, type={story.get('type')}", status)
    else:
        log_test("POST /pages/:id/stories (Create page story)", False, resp_time, f"Failed: {resp_json}", status)
    
    # Test 2: Validation - missing text for TEXT story
    success, resp_time, resp_json, status = make_request(
        "POST", f"/pages/{test_page_id}/stories",
        token=tokens['admin'],
        data={
            "type": "TEXT",
            "background": {"type": "SOLID", "color": "#FF5722"}
        },
        expect_status=400
    )
    
    if not success and status == 400:
        log_test("POST /pages/:id/stories (Text validation)", True, resp_time, 
                "✓ Missing text for TEXT story rejected", status)
    else:
        log_test("POST /pages/:id/stories (Text validation)", False, resp_time, 
                f"Should reject TEXT story without text: {resp_json}", status)
    
    # Test 3: Validation - invalid story type
    success, resp_time, resp_json, status = make_request(
        "POST", f"/pages/{test_page_id}/stories",
        token=tokens['admin'],
        data={
            "type": "INVALID_TYPE",
            "text": "Test story"
        },
        expect_status=400
    )
    
    if not success and status == 400:
        log_test("POST /pages/:id/stories (Type validation)", True, resp_time, 
                "✓ Invalid story type rejected", status)
    else:
        log_test("POST /pages/:id/stories (Type validation)", False, resp_time, 
                f"Should reject invalid story type: {resp_json}", status)
    
    # Test 4: GET /api/pages/:id/stories — List page stories
    success, resp_time, resp_json, status = make_request(
        "GET", f"/pages/{test_page_id}/stories"
    )
    
    if success and 'stories' in resp_json:
        stories = resp_json['stories']
        page = resp_json.get('page', {})
        
        # Check that we have stories and they're authored by page
        checks = []
        checks.append(isinstance(stories, list))
        checks.append(all(story.get('authorType') == 'PAGE' for story in stories))
        checks.append('count' in resp_json or 'page' in resp_json)
        
        if all(checks):
            log_test("GET /pages/:id/stories (List page stories)", True, resp_time, 
                    f"✓ Found {len(stories)} stories, all authorType=PAGE", status)
        else:
            log_test("GET /pages/:id/stories (List page stories)", False, resp_time, 
                    f"Validation failed. stories={len(stories)}, authorTypes={[s.get('authorType') for s in stories]}", status)
    else:
        log_test("GET /pages/:id/stories (List page stories)", False, resp_time, f"Failed: {resp_json}", status)

def test_page_post_management():
    """Test POST creation and POST/DELETE pin operations for page posts"""
    print("\n📌 Testing Page Post Management...")
    global test_post_id
    
    # Test 1: Create a regular post as page first
    success, resp_time, resp_json, status = make_request(
        "POST", "/content/posts",
        token=tokens['admin'],
        data={
            "caption": "Test page post for pin testing",
            "kind": "POST"
        },
        expect_status=201
    )
    
    if success and 'post' in resp_json:
        test_post_id = resp_json['post']['id']
        log_test("Create Page Post (for pin test)", True, resp_time, f"Post created: {test_post_id}", status)
    else:
        # Try alternative endpoint structure - maybe need to post as page
        success, resp_time, resp_json, status = make_request(
            "POST", f"/pages/{test_page_id}/posts",
            token=tokens['admin'],
            data={
                "caption": "Test page post for pin testing"
            },
            expect_status=201
        )
        
        if success and 'post' in resp_json:
            test_post_id = resp_json['post']['id']
            log_test("Create Page Post (for pin test)", True, resp_time, f"Post created via /pages/:id/posts: {test_post_id}", status)
        else:
            log_test("Create Page Post (for pin test)", False, resp_time, f"Failed both methods: {resp_json}", status)
            return
    
    # Test 2: POST /api/pages/:id/posts/:postId/pin — Pin page post
    success, resp_time, resp_json, status = make_request(
        "POST", f"/pages/{test_page_id}/posts/{test_post_id}/pin",
        token=tokens['admin']
    )
    
    if success and ('message' in resp_json or 'success' in str(resp_json).lower()):
        log_test("POST /pages/:id/posts/:postId/pin", True, resp_time, 
                "✓ Post pinned to page profile", status)
    else:
        log_test("POST /pages/:id/posts/:postId/pin", False, resp_time, f"Failed: {resp_json}", status)
    
    # Test 3: Create second post and verify only one can be pinned
    success, resp_time, resp_json, status = make_request(
        "POST", "/content/posts",
        token=tokens['admin'],
        data={
            "caption": "Second test page post for pin testing",
            "kind": "POST"
        },
        expect_status=201
    )
    
    if success and 'post' in resp_json:
        second_post_id = resp_json['post']['id']
        
        # Pin second post (should unpin first)
        success, resp_time, resp_json, status = make_request(
            "POST", f"/pages/{test_page_id}/posts/{second_post_id}/pin",
            token=tokens['admin']
        )
        
        if success:
            log_test("POST /pages/:id/posts/:postId/pin (Second post)", True, resp_time, 
                    "✓ Second post pinned (first should be unpinned)", status)
        else:
            log_test("POST /pages/:id/posts/:postId/pin (Second post)", False, resp_time, f"Failed: {resp_json}", status)
    
    # Test 4: DELETE /api/pages/:id/posts/:postId/pin — Unpin page post
    success, resp_time, resp_json, status = make_request(
        "DELETE", f"/pages/{test_page_id}/posts/{test_post_id}/pin",
        token=tokens['admin']
    )
    
    if success and ('message' in resp_json or 'success' in str(resp_json).lower()):
        log_test("DELETE /pages/:id/posts/:postId/pin", True, resp_time, 
                "✓ Post unpinned from page profile", status)
    else:
        log_test("DELETE /pages/:id/posts/:postId/pin", False, resp_time, f"Failed: {resp_json}", status)

def test_page_post_scheduling():
    """Test scheduled and draft post management for pages"""
    print("\n📅 Testing Page Post Scheduling...")
    
    # Test 1: Create scheduled post
    future_time = (datetime.now() + timedelta(hours=2)).isoformat() + "Z"
    success, resp_time, resp_json, status = make_request(
        "POST", f"/pages/{test_page_id}/posts",
        token=tokens['admin'],
        data={
            "caption": "Scheduled page post",
            "publishAt": future_time
        },
        expect_status=201
    )
    
    if success and 'post' in resp_json:
        post = resp_json['post']
        scheduled_post_id = post['id']
        
        # Verify scheduling attributes
        checks = []
        checks.append(post.get('isDraft') == True)
        checks.append(post.get('visibility') == 'DRAFT')
        checks.append('publishAt' in post)
        
        if all(checks):
            log_test("POST /pages/:id/posts (Scheduled)", True, resp_time, 
                    "✓ isDraft=true, visibility=DRAFT, publishAt set", status)
        else:
            log_test("POST /pages/:id/posts (Scheduled)", False, resp_time, 
                    f"Validation failed: isDraft={post.get('isDraft')}, visibility={post.get('visibility')}", status)
    else:
        log_test("POST /pages/:id/posts (Scheduled)", False, resp_time, f"Failed: {resp_json}", status)
        return
    
    # Test 2: Create draft post
    success, resp_time, resp_json, status = make_request(
        "POST", f"/pages/{test_page_id}/posts",
        token=tokens['admin'],
        data={
            "caption": "Draft page post",
            "status": "DRAFT"
        },
        expect_status=201
    )
    
    if success and 'post' in resp_json:
        draft_post_id = resp_json['post']['id']
        log_test("POST /pages/:id/posts (Draft)", True, resp_time, f"Draft post created: {draft_post_id}", status)
    else:
        log_test("POST /pages/:id/posts (Draft)", False, resp_time, f"Failed: {resp_json}", status)
        draft_post_id = None
    
    # Test 3: Validation - publishAt in the past should fail
    past_time = (datetime.now() - timedelta(hours=1)).isoformat() + "Z"
    success, resp_time, resp_json, status = make_request(
        "POST", f"/pages/{test_page_id}/posts",
        token=tokens['admin'],
        data={
            "caption": "Past scheduled post",
            "publishAt": past_time
        },
        expect_status=400
    )
    
    if not success and status == 400:
        log_test("POST /pages/:id/posts (Past publishAt validation)", True, resp_time, 
                "✓ Past publishAt rejected", status)
    else:
        log_test("POST /pages/:id/posts (Past publishAt validation)", False, resp_time, 
                f"Should reject past publishAt: {resp_json}", status)
    
    # Test 4: Validation - publishAt > 30 days should fail
    far_future = (datetime.now() + timedelta(days=35)).isoformat() + "Z"
    success, resp_time, resp_json, status = make_request(
        "POST", f"/pages/{test_page_id}/posts",
        token=tokens['admin'],
        data={
            "caption": "Far future scheduled post",
            "publishAt": far_future
        },
        expect_status=400
    )
    
    if not success and status == 400:
        log_test("POST /pages/:id/posts (Far future validation)", True, resp_time, 
                "✓ Far future publishAt (>30 days) rejected", status)
    else:
        log_test("POST /pages/:id/posts (Far future validation)", False, resp_time, 
                f"Should reject far future publishAt: {resp_json}", status)
    
    # Test 5: GET /api/pages/:id/posts/scheduled — List scheduled posts
    success, resp_time, resp_json, status = make_request(
        "GET", f"/pages/{test_page_id}/posts/scheduled",
        token=tokens['admin']
    )
    
    if success and ('posts' in resp_json or 'items' in resp_json):
        posts = resp_json.get('posts', resp_json.get('items', []))
        log_test("GET /pages/:id/posts/scheduled", True, resp_time, 
                f"✓ Found {len(posts)} scheduled posts", status)
    else:
        log_test("GET /pages/:id/posts/scheduled", False, resp_time, f"Failed: {resp_json}", status)
    
    # Test 6: GET /api/pages/:id/posts/drafts — List draft posts
    success, resp_time, resp_json, status = make_request(
        "GET", f"/pages/{test_page_id}/posts/drafts",
        token=tokens['admin']
    )
    
    if success and ('posts' in resp_json or 'items' in resp_json):
        posts = resp_json.get('posts', resp_json.get('items', []))
        log_test("GET /pages/:id/posts/drafts", True, resp_time, 
                f"✓ Found {len(posts)} draft posts", status)
    else:
        log_test("GET /pages/:id/posts/drafts", False, resp_time, f"Failed: {resp_json}", status)
    
    # Test 7: POST /api/pages/:id/posts/:postId/publish — Publish a draft
    if draft_post_id:
        success, resp_time, resp_json, status = make_request(
            "POST", f"/pages/{test_page_id}/posts/{draft_post_id}/publish",
            token=tokens['admin']
        )
        
        if success and ('post' in resp_json or 'message' in resp_json):
            log_test("POST /pages/:id/posts/:postId/publish", True, resp_time, 
                    "✓ Draft post published", status)
        else:
            log_test("POST /pages/:id/posts/:postId/publish", False, resp_time, f"Failed: {resp_json}", status)
    
    # Test 8: PATCH /api/pages/:id/posts/:postId/schedule — Update schedule
    new_future_time = (datetime.now() + timedelta(hours=3)).isoformat() + "Z"
    success, resp_time, resp_json, status = make_request(
        "PATCH", f"/pages/{test_page_id}/posts/{scheduled_post_id}/schedule",
        token=tokens['admin'],
        data={
            "publishAt": new_future_time
        }
    )
    
    if success and ('post' in resp_json or 'message' in resp_json):
        log_test("PATCH /pages/:id/posts/:postId/schedule", True, resp_time, 
                "✓ Schedule updated", status)
    else:
        log_test("PATCH /pages/:id/posts/:postId/schedule", False, resp_time, f"Failed: {resp_json}", status)

def test_page_reel_pinning():
    """Test POST/DELETE /api/pages/:id/reels/:reelId/pin"""
    print("\n📍 Testing Page Reel Pinning...")
    
    if not test_reel_id:
        log_test("POST /pages/:id/reels/:reelId/pin", False, 0, "No test reel ID available", 400)
        log_test("DELETE /pages/:id/reels/:reelId/pin", False, 0, "No test reel ID available", 400)
        return
    
    # Test 1: POST /api/pages/:id/reels/:reelId/pin — Pin reel to page profile
    success, resp_time, resp_json, status = make_request(
        "POST", f"/pages/{test_page_id}/reels/{test_reel_id}/pin",
        token=tokens['admin']
    )
    
    if success and ('message' in resp_json or 'success' in str(resp_json).lower()):
        log_test("POST /pages/:id/reels/:reelId/pin", True, resp_time, 
                "✓ Reel pinned to page profile", status)
    else:
        log_test("POST /pages/:id/reels/:reelId/pin", False, resp_time, f"Failed: {resp_json}", status)
    
    # Test 2: DELETE /api/pages/:id/reels/:reelId/pin — Unpin reel
    success, resp_time, resp_json, status = make_request(
        "DELETE", f"/pages/{test_page_id}/reels/{test_reel_id}/pin",
        token=tokens['admin']
    )
    
    if success and ('message' in resp_json or 'success' in str(resp_json).lower()):
        log_test("DELETE /pages/:id/reels/:reelId/pin", True, resp_time, 
                "✓ Reel unpinned from page profile", status)
    else:
        log_test("DELETE /pages/:id/reels/:reelId/pin", False, resp_time, f"Failed: {resp_json}", status)

def test_content_endpoint_authortype():
    """Test GET /api/content/:postId for authorType=PAGE verification"""
    print("\n🔍 Testing Content Endpoint authorType=PAGE...")
    
    if not test_post_id:
        log_test("GET /content/:postId (authorType=PAGE)", False, 0, "No test post ID available", 400)
        return
    
    # Test: GET /api/content/:postId — Verify authorType=PAGE shows correctly
    success, resp_time, resp_json, status = make_request(
        "GET", f"/content/{test_post_id}"
    )
    
    if success and 'post' in resp_json:
        post = resp_json['post']
        author = post.get('author', {})
        
        # Verify authorType and author name
        checks = []
        checks.append(post.get('authorType') == 'PAGE')
        checks.append('name' in author)  # Page name should be in author
        checks.append(post.get('pageId') is not None)
        
        if all(checks):
            log_test("GET /content/:postId (authorType=PAGE)", True, resp_time, 
                    f"✓ authorType=PAGE, author.name={author.get('name')}, pageId present", status)
        else:
            log_test("GET /content/:postId (authorType=PAGE)", False, resp_time, 
                    f"Validation failed: authorType={post.get('authorType')}, author={author}", status)
    else:
        log_test("GET /content/:postId (authorType=PAGE)", False, resp_time, f"Failed: {resp_json}", status)

def test_authorization():
    """Test authorization scenarios with different users"""
    print("\n🔒 Testing Authorization Scenarios...")
    
    # Test 1: Regular user (7777099002) tries to create content on admin's page → should get 403
    success, resp_time, resp_json, status = make_request(
        "POST", f"/pages/{test_page_id}/reels",
        token=tokens['user'],  # Regular user token
        data={
            "caption": "Unauthorized reel attempt",
            "mediaUrl": "https://example.com/test-video.mp4",
            "durationMs": 15000
        },
        expect_status=403
    )
    
    if not success and status == 403:
        log_test("Authorization: Non-member create reel", True, resp_time, 
                "✓ Non-member correctly blocked from creating page reel (403)", status)
    else:
        log_test("Authorization: Non-member create reel", False, resp_time, 
                f"Should block non-member, got: {resp_json}", status)
    
    # Test 2: Regular user tries to create story on admin's page → should get 403
    success, resp_time, resp_json, status = make_request(
        "POST", f"/pages/{test_page_id}/stories",
        token=tokens['user'],
        data={
            "type": "TEXT",
            "text": "Unauthorized story attempt"
        },
        expect_status=403
    )
    
    if not success and status == 403:
        log_test("Authorization: Non-member create story", True, resp_time, 
                "✓ Non-member correctly blocked from creating page story (403)", status)
    else:
        log_test("Authorization: Non-member create story", False, resp_time, 
                f"Should block non-member, got: {resp_json}", status)
    
    # Test 3: Regular user tries to pin post on admin's page → should get 403
    if test_post_id:
        success, resp_time, resp_json, status = make_request(
            "POST", f"/pages/{test_page_id}/posts/{test_post_id}/pin",
            token=tokens['user'],
            expect_status=403
        )
        
        if not success and status == 403:
            log_test("Authorization: Non-member pin post", True, resp_time, 
                    "✓ Non-member correctly blocked from pinning page post (403)", status)
        else:
            log_test("Authorization: Non-member pin post", False, resp_time, 
                    f"Should block non-member, got: {resp_json}", status)
    
    # Test 4: Regular user tries to access scheduled posts → should get 403
    success, resp_time, resp_json, status = make_request(
        "GET", f"/pages/{test_page_id}/posts/scheduled",
        token=tokens['user'],
        expect_status=403
    )
    
    if not success and status == 403:
        log_test("Authorization: Non-member view scheduled", True, resp_time, 
                "✓ Non-member correctly blocked from viewing scheduled posts (403)", status)
    else:
        log_test("Authorization: Non-member view scheduled", False, resp_time, 
                f"Should block non-member, got: {resp_json}", status)

def print_summary():
    """Print comprehensive test summary"""
    print("\n" + "="*80)
    print("🎯 PAGE-LEVEL ENDPOINTS TESTING SUMMARY")
    print("="*80)
    
    total_tests = len(test_results)
    passed_tests = sum(1 for r in test_results if r['success'])
    failed_tests = total_tests - passed_tests
    success_rate = (passed_tests / total_tests * 100) if total_tests > 0 else 0
    
    avg_response_time = sum(r['response_time_ms'] for r in test_results) / total_tests if total_tests > 0 else 0
    
    print(f"📊 OVERALL RESULTS:")
    print(f"   Total Tests: {total_tests}")
    print(f"   ✅ Passed: {passed_tests}")
    print(f"   ❌ Failed: {failed_tests}")
    print(f"   📈 Success Rate: {success_rate:.1f}%")
    print(f"   ⏱️  Average Response Time: {avg_response_time:.1f}ms")
    
    # Category breakdown
    print(f"\n📋 CATEGORY BREAKDOWN:")
    categories = {
        'Authentication': [r for r in test_results if 'authentication' in r['test'].lower()],
        'Page Setup': [r for r in test_results if 'page' in r['test'].lower() and 'create' in r['test'].lower()],
        'Page Reels': [r for r in test_results if 'reel' in r['test'].lower()],
        'Page Stories': [r for r in test_results if 'stories' in r['test'].lower() or 'story' in r['test'].lower()],
        'Page Posts': [r for r in test_results if 'posts' in r['test'].lower() or 'pin' in r['test'].lower()],
        'Scheduling': [r for r in test_results if any(x in r['test'].lower() for x in ['schedul', 'draft', 'publish'])],
        'Content Endpoint': [r for r in test_results if 'content/' in r['test'].lower()],
        'Authorization': [r for r in test_results if 'authorization' in r['test'].lower()],
    }
    
    for category, cat_results in categories.items():
        if cat_results:
            cat_passed = sum(1 for r in cat_results if r['success'])
            cat_total = len(cat_results)
            cat_rate = (cat_passed / cat_total * 100) if cat_total > 0 else 0
            print(f"   {category}: {cat_passed}/{cat_total} ({cat_rate:.1f}%)")
    
    # Failed tests details
    if failed_tests > 0:
        print(f"\n❌ FAILED TESTS DETAILS:")
        for result in test_results:
            if not result['success']:
                print(f"   • {result['test']}: {result['details']} (Status: {result['status_code']})")
    
    print("\n" + "="*80)
    return success_rate >= 80  # Consider 80%+ as good for new endpoints

def main():
    """Main test execution"""
    print("🚀 Starting Page-Level Endpoints Testing")
    print(f"🔗 Base URL: {BASE_URL}")
    print(f"📅 Test Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    # Setup authentication
    if not setup_authentication():
        print("❌ Authentication failed - cannot proceed")
        return
    
    # Setup test page
    if not setup_test_page():
        print("❌ Test page creation failed - cannot proceed")
        return
    
    # Run all tests
    test_page_reels()
    test_page_stories() 
    test_page_post_management()
    test_page_post_scheduling()
    test_page_reel_pinning()
    test_content_endpoint_authortype()
    test_authorization()
    
    # Print summary
    success = print_summary()
    
    if success:
        print("🎉 PAGE ENDPOINTS TESTING COMPLETED SUCCESSFULLY!")
    else:
        print("⚠️  PAGE ENDPOINTS TESTING COMPLETED WITH ISSUES")

if __name__ == "__main__":
    main()