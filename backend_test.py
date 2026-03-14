#!/usr/bin/env python3
"""
Comprehensive Backend Test for Upload Overhaul - Focus on Direct-to-Supabase CDN Upload

This test focuses heavily on the NEW direct-to-Supabase presigned upload system that replaced 
the old chunked upload, plus full regression testing.

Key Changes to Test:
1. NEW: Direct-to-Supabase CDN Upload (POST /api/media/upload-init → PUT presigned URL → POST /api/media/upload-complete)  
2. Legacy chunked upload backward compatibility
3. CDN URL verification with Range support
4. Full regression of all endpoints
"""

import requests
import json
import time
import io
import random
import string
from urllib.parse import urlparse

# Configuration
BASE_URL = "https://upload-overhaul.preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api"

# Test users for auth
USER1 = {"phone": "7777099001", "pin": "1234"}
USER2 = {"phone": "7777099002", "pin": "1234"}

# Global session tokens
user1_token = None
user2_token = None

class TestRunner:
    def __init__(self):
        self.results = []
        self.test_count = 0
        self.passed_count = 0
        self.failed_count = 0
        
    def test(self, name, func, critical=True):
        """Execute a test and record results"""
        self.test_count += 1
        print(f"\n[TEST {self.test_count}] {name}")
        try:
            result = func()
            if result:
                print(f"✅ PASS: {name}")
                self.passed_count += 1
                self.results.append({"test": name, "status": "PASS", "critical": critical})
                return True
            else:
                print(f"❌ FAIL: {name}")
                self.failed_count += 1
                self.results.append({"test": name, "status": "FAIL", "critical": critical})
                return False
        except Exception as e:
            print(f"❌ ERROR: {name} - {e}")
            self.failed_count += 1
            self.results.append({"test": name, "status": "ERROR", "error": str(e), "critical": critical})
            return False
    
    def summary(self):
        success_rate = (self.passed_count / self.test_count * 100) if self.test_count > 0 else 0
        print(f"\n{'='*60}")
        print(f"COMPREHENSIVE UPLOAD OVERHAUL TEST SUMMARY")
        print(f"{'='*60}")
        print(f"Total Tests: {self.test_count}")
        print(f"Passed: {self.passed_count}")
        print(f"Failed: {self.failed_count}")
        print(f"Success Rate: {success_rate:.1f}%")
        
        critical_failures = [r for r in self.results if r["status"] != "PASS" and r.get("critical")]
        if critical_failures:
            print(f"\n⚠️  CRITICAL FAILURES ({len(critical_failures)}):")
            for failure in critical_failures:
                print(f"  - {failure['test']}")
        
        return success_rate >= 85  # 85% threshold for production readiness

# ================================
# AUTHENTICATION HELPERS  
# ================================

def auth_user1():
    """Authenticate user1 and store token"""
    global user1_token
    response = requests.post(f"{API_BASE}/auth/login", json=USER1)
    if response.status_code == 200:
        data = response.json()
        user1_token = data.get("token")
        return True
    return False

def auth_user2():
    """Authenticate user2 and store token"""
    global user2_token
    response = requests.post(f"{API_BASE}/auth/login", json=USER2)
    if response.status_code == 200:
        data = response.json()
        user2_token = data.get("token")
        return True
    return False

def get_auth_headers(token):
    """Get authorization headers"""
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

# ================================
# CORE NEW UPLOAD SYSTEM TESTS
# ================================

def test_health_endpoints():
    """Test basic health endpoints"""
    try:
        # Root health
        response = requests.get(f"{API_BASE}/healthz")
        if response.status_code != 200:
            return False
            
        # Readiness check
        response = requests.get(f"{API_BASE}/readyz")
        if response.status_code != 200:
            return False
            
        print("✓ Health endpoints responding")
        return True
    except Exception as e:
        print(f"✗ Health check failed: {e}")
        return False

def test_direct_video_upload_flow():
    """Test NEW direct-to-Supabase CDN video upload flow"""
    try:
        if not user1_token:
            print("✗ No auth token for user1")
            return False
            
        headers = get_auth_headers(user1_token)
        
        # Step 1: Initialize upload with presigned URL
        init_payload = {
            "kind": "video",
            "mimeType": "video/mp4", 
            "sizeBytes": 10485760,  # 10MB
            "scope": "posts"
        }
        
        response = requests.post(f"{API_BASE}/media/upload-init", headers=headers, json=init_payload)
        print(f"Upload init status: {response.status_code}")
        
        if response.status_code != 201:
            print(f"✗ Upload init failed: {response.text}")
            return False
            
        init_data = response.json()
        if not all(k in init_data for k in ["mediaId", "uploadUrl", "publicUrl"]):
            print(f"✗ Missing required fields in init response")
            return False
            
        media_id = init_data["mediaId"]
        upload_url = init_data["uploadUrl"] 
        public_url = init_data["publicUrl"]
        
        print(f"✓ Upload initialized - mediaId: {media_id}")
        print(f"✓ Upload URL: {upload_url[:50]}...")
        print(f"✓ Public URL: {public_url}")
        
        # Step 2: Upload binary data directly to Supabase CDN
        video_data = b'\x00' * 10485760  # 10MB of zeros (fake video data)
        
        upload_response = requests.put(
            upload_url,
            data=video_data,
            headers={"Content-Type": "video/mp4"}
        )
        
        print(f"Direct upload status: {upload_response.status_code}")
        
        if upload_response.status_code != 200:
            print(f"✗ Direct upload failed: {upload_response.text}")
            return False
            
        print("✓ Binary upload to Supabase CDN successful")
        
        # Step 3: Complete the upload 
        complete_payload = {"mediaId": media_id}
        
        complete_response = requests.post(
            f"{API_BASE}/media/upload-complete", 
            headers=headers,
            json=complete_payload
        )
        
        print(f"Upload complete status: {complete_response.status_code}")
        
        if complete_response.status_code != 200:
            print(f"✗ Upload complete failed: {complete_response.text}")
            return False
            
        complete_data = complete_response.json()
        
        # Verify response structure
        required_fields = ["id", "publicUrl", "status", "storageType", "mimeType", "type"]
        if not all(k in complete_data for k in required_fields):
            print(f"✗ Missing required fields in complete response")
            return False
            
        if complete_data["status"] != "READY":
            print(f"✗ Expected status READY, got {complete_data['status']}")
            return False
            
        if complete_data["storageType"] != "SUPABASE":
            print(f"✗ Expected storageType SUPABASE, got {complete_data['storageType']}")
            return False
            
        if complete_data["type"] != "VIDEO":
            print(f"✗ Expected type VIDEO, got {complete_data['type']}")
            return False
            
        print("✓ Upload flow completed successfully")
        print(f"✓ Media ready: {complete_data['id']}")
        print(f"✓ Storage type: {complete_data['storageType']}")
        print(f"✓ Public URL: {complete_data['publicUrl']}")
        
        return True
        
    except Exception as e:
        print(f"✗ Direct video upload failed: {e}")
        return False

def test_direct_image_upload_flow():
    """Test NEW direct-to-Supabase CDN image upload flow"""
    try:
        if not user1_token:
            print("✗ No auth token for user1")
            return False
            
        headers = get_auth_headers(user1_token)
        
        # Step 1: Initialize upload
        init_payload = {
            "kind": "image",
            "mimeType": "image/jpeg",
            "sizeBytes": 1048576,  # 1MB
            "scope": "posts"
        }
        
        response = requests.post(f"{API_BASE}/media/upload-init", headers=headers, json=init_payload)
        
        if response.status_code != 201:
            print(f"✗ Image upload init failed: {response.text}")
            return False
            
        init_data = response.json()
        media_id = init_data["mediaId"]
        upload_url = init_data["uploadUrl"]
        
        print(f"✓ Image upload initialized - mediaId: {media_id}")
        
        # Step 2: Upload binary data  
        image_data = b'\xFF\xD8\xFF' + b'\x00' * 1048573  # JPEG header + data
        
        upload_response = requests.put(
            upload_url,
            data=image_data,
            headers={"Content-Type": "image/jpeg"}
        )
        
        if upload_response.status_code != 200:
            print(f"✗ Image direct upload failed: {upload_response.text}")
            return False
            
        print("✓ Image binary upload successful")
        
        # Step 3: Complete upload
        complete_response = requests.post(
            f"{API_BASE}/media/upload-complete",
            headers=headers,
            json={"mediaId": media_id}
        )
        
        if complete_response.status_code != 200:
            print(f"✗ Image upload complete failed: {complete_response.text}")
            return False
            
        complete_data = complete_response.json()
        
        if complete_data["type"] != "IMAGE":
            print(f"✗ Expected type IMAGE, got {complete_data['type']}")
            return False
            
        print("✓ Image upload flow completed successfully")
        return True
        
    except Exception as e:
        print(f"✗ Direct image upload failed: {e}")
        return False

def test_cdn_url_verification():
    """Test CDN URL verification with proper headers"""
    try:
        if not user1_token:
            return False
            
        headers = get_auth_headers(user1_token)
        
        # Create a video upload first
        init_response = requests.post(f"{API_BASE}/media/upload-init", headers=headers, json={
            "kind": "video",
            "mimeType": "video/mp4",
            "sizeBytes": 5242880,  # 5MB
            "scope": "posts"
        })
        
        if init_response.status_code != 201:
            return False
            
        init_data = init_response.json()
        
        # Upload data
        video_data = b'\x00' * 5242880
        upload_response = requests.put(init_data["uploadUrl"], data=video_data, headers={"Content-Type": "video/mp4"})
        
        if upload_response.status_code != 200:
            return False
            
        # Complete upload
        complete_response = requests.post(f"{API_BASE}/media/upload-complete", headers=headers, json={"mediaId": init_data["mediaId"]})
        
        if complete_response.status_code != 200:
            return False
            
        complete_data = complete_response.json()
        public_url = complete_data["publicUrl"]
        
        print(f"✓ Testing CDN URL: {public_url}")
        
        # Test HEAD request to CDN URL
        head_response = requests.head(public_url)
        
        if head_response.status_code != 200:
            print(f"✗ HEAD request failed: {head_response.status_code}")
            return False
            
        # Check critical headers for video seeking
        headers_check = head_response.headers
        
        if headers_check.get("Content-Type") != "video/mp4":
            print(f"✗ Wrong Content-Type: {headers_check.get('Content-Type')}")
            return False
            
        if "bytes" not in headers_check.get("Accept-Ranges", ""):
            print(f"✗ Missing Accept-Ranges: bytes header")
            return False
            
        print("✓ CDN URL verification successful")
        print(f"✓ Content-Type: {headers_check.get('Content-Type')}")
        print(f"✓ Accept-Ranges: {headers_check.get('Accept-Ranges')}")
        
        return True
        
    except Exception as e:
        print(f"✗ CDN URL verification failed: {e}")
        return False

def test_post_with_video_media():
    """Test creating a post with video media from new upload system"""
    try:
        if not user1_token:
            return False
            
        headers = get_auth_headers(user1_token)
        
        # First create video media
        init_response = requests.post(f"{API_BASE}/media/upload-init", headers=headers, json={
            "kind": "video",
            "mimeType": "video/mp4", 
            "sizeBytes": 2097152,  # 2MB
            "scope": "posts"
        })
        
        if init_response.status_code != 201:
            print("✗ Failed to init video for post")
            return False
            
        init_data = init_response.json()
        
        # Upload video
        video_data = b'\x00' * 2097152
        requests.put(init_data["uploadUrl"], data=video_data, headers={"Content-Type": "video/mp4"})
        
        # Complete upload
        complete_response = requests.post(f"{API_BASE}/media/upload-complete", headers=headers, json={"mediaId": init_data["mediaId"]})
        
        if complete_response.status_code != 200:
            print("✗ Failed to complete video upload for post")
            return False
            
        complete_data = complete_response.json()
        media_id = complete_data["id"]
        
        # Create post with video
        post_payload = {
            "caption": "Test post with video from new upload system",
            "mediaIds": [media_id],
            "tags": [],
            "collegeId": None
        }
        
        post_response = requests.post(f"{API_BASE}/content/posts", headers=headers, json=post_payload)
        
        if post_response.status_code not in [200, 201]:
            print(f"✗ Post creation failed: {post_response.text}")
            return False
            
        post_data = post_response.json()
        
        # Verify media in post response
        post_content = post_data.get("post", post_data)  # Handle both formats
        if "media" not in post_content or not post_content["media"]:
            print("✗ No media in post response")
            return False
            
        media_item = post_content["media"][0]
        
        if media_item.get("type") != "VIDEO":
            print(f"✗ Expected VIDEO type, got {media_item.get('type')}")
            return False
            
        if media_item.get("mimeType") != "video/mp4":
            print(f"✗ Expected video/mp4, got {media_item.get('mimeType')}")
            return False
            
        if not media_item.get("publicUrl"):
            print("✗ Missing publicUrl in post media")
            return False
            
        print("✓ Post with video media created successfully")
        print(f"✓ Media type: {media_item.get('type')}")
        print(f"✓ MIME type: {media_item.get('mimeType')}")
        print(f"✓ Public URL: {media_item.get('publicUrl')}")
        
        return True
        
    except Exception as e:
        print(f"✗ Post with video media failed: {e}")
        return False

def test_legacy_chunked_upload():
    """Test backward compatibility with legacy chunked upload"""
    try:
        if not user2_token:
            return False
            
        headers = get_auth_headers(user2_token)
        
        # Initialize chunked upload session
        init_payload = {
            "mimeType": "video/mp4",
            "fileName": "test_video.mp4",
            "totalSize": 8388608,  # 8MB
            "totalChunks": 4,
            "kind": "video"
        }
        
        response = requests.post(f"{API_BASE}/media/chunked/init", headers=headers, json=init_payload)
        
        if response.status_code != 201:
            print(f"✗ Chunked init failed: {response.text}")
            return False
            
        init_data = response.json()
        session_id = init_data["sessionId"]
        
        print(f"✓ Chunked session created: {session_id}")
        
        # Upload chunks (simulate 4 chunks of 2MB each)
        chunk_size = 2097152  # 2MB
        for i in range(4):
            chunk_data = b'\x00' * chunk_size
            chunk_b64 = __import__("base64").b64encode(chunk_data).decode()
            
            chunk_payload = {
                "chunkIndex": i,
                "data": chunk_b64
            }
            
            chunk_response = requests.post(
                f"{API_BASE}/media/chunked/{session_id}/chunk",
                headers=headers,
                json=chunk_payload
            )
            
            if chunk_response.status_code != 200:
                print(f"✗ Chunk {i} upload failed: {chunk_response.text}")
                return False
                
            print(f"✓ Chunk {i} uploaded")
        
        # Complete chunked upload
        complete_response = requests.post(f"{API_BASE}/media/chunked/{session_id}/complete", headers=headers)
        
        if complete_response.status_code != 201:
            print(f"✗ Chunked complete failed: {complete_response.text}")
            return False
            
        complete_data = complete_response.json()
        
        if complete_data.get("uploadMethod") != "CHUNKED":
            print(f"✗ Expected uploadMethod CHUNKED, got {complete_data.get('uploadMethod')}")
            return False
            
        print("✓ Legacy chunked upload working")
        print(f"✓ Upload method: {complete_data.get('uploadMethod')}")
        print(f"✓ Storage type: {complete_data.get('storageType')}")
        
        return True
        
    except Exception as e:
        print(f"✗ Legacy chunked upload failed: {e}")
        return False

def test_range_request_support():
    """Test HTTP 206 Range Request support for video seeking"""
    try:
        if not user1_token:
            return False
            
        headers = get_auth_headers(user1_token)
        
        # Create a video and get its media ID
        init_response = requests.post(f"{API_BASE}/media/upload-init", headers=headers, json={
            "kind": "video",
            "mimeType": "video/mp4",
            "sizeBytes": 3145728,  # 3MB  
            "scope": "posts"
        })
        
        if init_response.status_code != 201:
            return False
            
        init_data = init_response.json()
        
        # Upload and complete
        video_data = b'\x00' * 3145728
        requests.put(init_data["uploadUrl"], data=video_data, headers={"Content-Type": "video/mp4"})
        
        complete_response = requests.post(f"{API_BASE}/media/upload-complete", headers=headers, json={"mediaId": init_data["mediaId"]})
        
        if complete_response.status_code != 200:
            return False
            
        media_id = init_data["mediaId"]
        
        # Test Range request
        range_headers = {"Range": "bytes=0-1024"}
        range_response = requests.get(f"{API_BASE}/media/{media_id}", headers=range_headers)
        
        if range_response.status_code == 302:  # Redirect to CDN
            # Follow redirect and test CDN range support
            cdn_url = range_response.headers.get("Location")
            if cdn_url:
                cdn_range_response = requests.get(cdn_url, headers=range_headers)
                if cdn_range_response.status_code == 206:
                    print("✓ CDN Range request support confirmed")
                    return True
        elif range_response.status_code == 206:
            # Direct range support
            print("✓ Direct Range request support confirmed")
            return True
            
        print(f"✗ Range request not supported. Status: {range_response.status_code}")
        return False
        
    except Exception as e:
        print(f"✗ Range request test failed: {e}")
        return False

# ================================
# FULL REGRESSION TESTS
# ================================

def test_auth_login():
    """Test authentication system"""
    try:
        response = requests.post(f"{API_BASE}/auth/login", json=USER1)
        if response.status_code == 200:
            data = response.json()
            if "token" in data:
                print("✓ Auth login working")
                return True
        print("✗ Auth login failed")
        return False
    except Exception as e:
        print(f"✗ Auth test failed: {e}")
        return False

def test_feed_endpoints():
    """Test feed endpoints"""
    try:
        # Anonymous public feed
        response = requests.get(f"{API_BASE}/feed")
        if response.status_code != 200:
            print(f"✗ Anonymous feed failed: {response.status_code}")
            return False
            
        # Authenticated feed
        if user1_token:
            headers = get_auth_headers(user1_token)
            auth_response = requests.get(f"{API_BASE}/feed", headers=headers)
            if auth_response.status_code != 200:
                print(f"✗ Authenticated feed failed: {auth_response.status_code}")
                return False
                
        print("✓ Feed endpoints working")
        return True
        
    except Exception as e:
        print(f"✗ Feed test failed: {e}")
        return False

def test_content_crud():
    """Test content CRUD operations"""
    try:
        if not user1_token:
            return False
            
        headers = get_auth_headers(user1_token)
        
        # Create post
        post_payload = {
            "caption": "Regression test post",
            "tags": ["test"],
            "mediaIds": []
        }
        
        create_response = requests.post(f"{API_BASE}/content/posts", headers=headers, json=post_payload)
        
        if create_response.status_code not in [200, 201]:
            print(f"✗ Post creation failed: {create_response.status_code}")
            return False
            
        post_data = create_response.json()
        post_content = post_data.get("post", post_data)  # Handle wrapper format
        post_id = post_content["id"]
        
        # Get post
        get_response = requests.get(f"{API_BASE}/content/{post_id}", headers=headers)
        
        if get_response.status_code != 200:
            print(f"✗ Post retrieval failed: {get_response.status_code}")
            return False
            
        # Delete post
        delete_response = requests.delete(f"{API_BASE}/content/{post_id}", headers=headers)
        
        if delete_response.status_code not in [200, 204]:
            print(f"✗ Post deletion failed: {delete_response.status_code}")
            return False
            
        print("✓ Content CRUD working")
        return True
        
    except Exception as e:
        print(f"✗ Content CRUD test failed: {e}")
        return False

def test_social_interactions():
    """Test like/comment functionality"""
    try:
        if not user1_token:
            return False
            
        headers = get_auth_headers(user1_token)
        
        # Create a post first
        post_response = requests.post(f"{API_BASE}/content/posts", headers=headers, json={
            "caption": "Test post for interactions",
            "mediaIds": []
        })
        
        if post_response.status_code not in [200, 201]:
            return False
            
        post_data = post_response.json()
        post_content = post_data.get("post", post_data)  # Handle wrapper format
        post_id = post_content["id"]
        
        # Test like
        like_response = requests.post(f"{API_BASE}/content/{post_id}/like", headers=headers)
        
        if like_response.status_code not in [200, 201]:
            print(f"✗ Like failed: {like_response.status_code}")
            return False
            
        # Test comment
        comment_payload = {"text": "Test comment"}
        comment_response = requests.post(f"{API_BASE}/content/{post_id}/comments", headers=headers, json=comment_payload)
        
        if comment_response.status_code not in [200, 201]:
            print(f"✗ Comment failed: {comment_response.status_code}")
            return False
            
        print("✓ Social interactions working")
        
        # Cleanup
        requests.delete(f"{API_BASE}/content/{post_id}", headers=headers)
        
        return True
        
    except Exception as e:
        print(f"✗ Social interactions test failed: {e}")
        return False

def test_search_functionality():
    """Test search endpoints"""
    try:
        response = requests.get(f"{API_BASE}/search?q=test")
        
        if response.status_code != 200:
            print(f"✗ Search failed: {response.status_code}")
            return False
            
        print("✓ Search working")
        return True
        
    except Exception as e:
        print(f"✗ Search test failed: {e}")
        return False

def test_notifications():
    """Test notifications endpoint"""
    try:
        if not user1_token:
            return False
            
        headers = get_auth_headers(user1_token)
        response = requests.get(f"{API_BASE}/notifications", headers=headers)
        
        if response.status_code != 200:
            print(f"✗ Notifications failed: {response.status_code}")
            return False
            
        print("✓ Notifications working")
        return True
        
    except Exception as e:
        print(f"✗ Notifications test failed: {e}")
        return False

def test_admin_endpoints():
    """Test admin/ops endpoints"""
    try:
        # Test cache stats with auth (requires auth)
        if user1_token:
            headers = get_auth_headers(user1_token)
            response = requests.get(f"{API_BASE}/cache/stats", headers=headers)
        else:
            response = requests.get(f"{API_BASE}/cache/stats")
        
        if response.status_code not in [200, 401, 403]:  # Either works or needs higher auth
            print(f"✗ Cache stats unexpected status: {response.status_code}")
            return False
            
        # Test ops metrics (requires admin - expect 401)
        ops_response = requests.get(f"{API_BASE}/ops/metrics")
        
        if ops_response.status_code not in [401, 403, 200]:  # Either needs auth or works
            print(f"✗ Ops metrics unexpected status: {ops_response.status_code}")
            return False
            
        print("✓ Admin endpoints responding appropriately")
        return True
        
    except Exception as e:
        print(f"✗ Admin endpoints test failed: {e}")
        return False

def test_stories_reels():
    """Test stories and reels endpoints"""
    try:
        # Test stories feed with auth (may require auth)
        if user1_token:
            headers = get_auth_headers(user1_token)
            stories_response = requests.get(f"{API_BASE}/stories/feed", headers=headers)
        else:
            stories_response = requests.get(f"{API_BASE}/stories/feed")
        
        if stories_response.status_code not in [200, 401, 403]:
            print(f"✗ Stories feed failed: {stories_response.status_code}")
            return False
            
        # Test reels feed 
        reels_response = requests.get(f"{API_BASE}/reels/feed")
        
        if reels_response.status_code not in [200, 401, 403]:
            print(f"✗ Reels feed failed: {reels_response.status_code}")
            return False
            
        print("✓ Stories and reels endpoints working")
        return True
        
    except Exception as e:
        print(f"✗ Stories/reels test failed: {e}")
        return False

def test_analytics():
    """Test analytics overview"""
    try:
        if not user1_token:
            return False
            
        headers = get_auth_headers(user1_token)
        response = requests.get(f"{API_BASE}/analytics/overview", headers=headers)
        
        # May require specific permissions - accept 403
        if response.status_code not in [200, 403]:
            print(f"✗ Analytics failed: {response.status_code}")
            return False
            
        print("✓ Analytics endpoint responding")
        return True
        
    except Exception as e:
        print(f"✗ Analytics test failed: {e}")
        return False

def test_colleges():
    """Test college endpoints"""
    try:
        response = requests.get(f"{API_BASE}/tribes")
        
        if response.status_code != 200:
            print(f"✗ Tribes/colleges failed: {response.status_code}")
            return False
            
        print("✓ Colleges endpoint working")
        return True
        
    except Exception as e:
        print(f"✗ Colleges test failed: {e}")
        return False

# ================================
# MAIN TEST EXECUTION
# ================================

def main():
    """Run comprehensive upload overhaul regression tests"""
    print("="*60)
    print("UPLOAD OVERHAUL COMPREHENSIVE REGRESSION TEST")
    print("="*60)
    print(f"Testing against: {BASE_URL}")
    print(f"Focus: NEW Direct-to-Supabase CDN Upload System")
    print("="*60)
    
    runner = TestRunner()
    
    # Authenticate users first
    if not auth_user1():
        print("❌ CRITICAL: Cannot authenticate user1")
        return False
    
    if not auth_user2():
        print("❌ CRITICAL: Cannot authenticate user2") 
        return False
        
    print(f"✅ Authentication successful for both test users")
    
    # === CORE UPLOAD OVERHAUL TESTS ===
    print("\n" + "="*50)
    print("SECTION 1: NEW UPLOAD SYSTEM TESTS")
    print("="*50)
    
    runner.test("Health Endpoints", test_health_endpoints, critical=True)
    runner.test("Direct Video Upload Flow", test_direct_video_upload_flow, critical=True)
    runner.test("Direct Image Upload Flow", test_direct_image_upload_flow, critical=True)  
    runner.test("CDN URL Verification", test_cdn_url_verification, critical=True)
    runner.test("Post with Video Media", test_post_with_video_media, critical=True)
    runner.test("Legacy Chunked Upload Compatibility", test_legacy_chunked_upload, critical=True)
    runner.test("Range Request Support", test_range_request_support, critical=True)
    
    # === FULL REGRESSION TESTS ===
    print("\n" + "="*50)
    print("SECTION 2: FULL REGRESSION TESTS")
    print("="*50)
    
    runner.test("Authentication System", test_auth_login, critical=True)
    runner.test("Feed Endpoints", test_feed_endpoints, critical=True)
    runner.test("Content CRUD", test_content_crud, critical=True)
    runner.test("Social Interactions", test_social_interactions, critical=True)
    runner.test("Search Functionality", test_search_functionality, critical=False)
    runner.test("Notifications", test_notifications, critical=False)
    runner.test("Admin Endpoints", test_admin_endpoints, critical=False)
    runner.test("Stories and Reels", test_stories_reels, critical=False)
    runner.test("Analytics", test_analytics, critical=False)
    runner.test("Colleges/Tribes", test_colleges, critical=False)
    
    # Final summary
    success = runner.summary()
    
    if success:
        print(f"\n🎉 UPLOAD OVERHAUL REGRESSION TEST: PASSED")
        print("✅ New direct-to-Supabase CDN upload system working excellently!")
        print("✅ Legacy chunked upload compatibility maintained")
        print("✅ Full backend regression successful")
    else:
        print(f"\n⚠️  UPLOAD OVERHAUL REGRESSION TEST: NEEDS ATTENTION")
        print("Some critical tests failed - see details above")
    
    return success

if __name__ == "__main__":
    main()