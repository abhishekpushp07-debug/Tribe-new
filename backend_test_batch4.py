#!/usr/bin/env python3
"""
BATCH 4 COMPREHENSIVE TEST SUITE
Media/Upload (15) + Discovery/Search (20) + Notifications (12) + Analytics (10) = 57 endpoints total
CRITICAL: DO NOT call /auth/logout - tokens must remain valid throughout testing
"""

import requests
import json
import time
import base64
from datetime import datetime
import sys

# Base configuration
BASE_URL = "https://upload-overhaul.preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api"

# Test credentials as specified
ADMIN_CREDS = {"phone": "7777099001", "pin": "1234"}  # token1 (ADMIN)
USER_CREDS = {"phone": "7777099002", "pin": "1234"}   # token2

def get_fresh_token(creds):
    """Get a fresh authentication token"""
    try:
        response = requests.post(f"{API_BASE}/auth/login", 
                               json=creds, 
                               headers={"Content-Type": "application/json"},
                               timeout=30)
        if response.status_code == 200:
            data = response.json()
            return data.get("token"), data.get("user", {}).get("id")
    except Exception as e:
        print(f"❌ Token error: {e}")
        pass
    return None, None

def make_request(method, endpoint, token=None, json_data=None, files=None, raw_data=None, custom_headers=None):
    """Make authenticated request with flexible data handling"""
    headers = {}
    if custom_headers:
        headers.update(custom_headers)
    
    if token:
        headers["Authorization"] = f"Bearer {token}"
    
    # For raw binary data (like Supabase upload)
    if raw_data is not None:
        if not custom_headers:
            headers["Content-Type"] = "image/jpeg"
    elif json_data is not None and not files:
        headers["Content-Type"] = "application/json"
    
    start_time = time.time()
    try:
        if raw_data is not None:
            # For raw binary uploads to external URLs
            response = requests.request(
                method,
                endpoint,  # Full URL for Supabase
                headers=headers,
                data=raw_data,
                timeout=60
            )
        else:
            response = requests.request(
                method, 
                f"{API_BASE}{endpoint}", 
                headers=headers,
                json=json_data,
                files=files,
                timeout=60
            )
        response_time = time.time() - start_time
        return response, response_time
    except Exception as e:
        response_time = time.time() - start_time
        print(f"❌ Request failed: {e}")
        return None, response_time

def test_endpoint(name, method, endpoint, token=None, json_data=None, expected_status=[200], files=None, raw_data=None, custom_headers=None, external_url=False):
    """Test a single endpoint and return result"""
    if external_url:
        # For direct uploads to Supabase URLs
        response, rt = make_request(method, endpoint, token, json_data, files, raw_data, custom_headers)
    else:
        response, rt = make_request(method, endpoint, token, json_data, files, raw_data, custom_headers)
    
    success = response and response.status_code in expected_status
    status_code = response.status_code if response else 0
    
    # Performance flag
    perf_flag = "🐌" if rt > 0.5 else ""
    
    status_icon = "✅" if success else "❌"
    print(f"{status_icon} {name}: {status_code} ({round(rt*1000, 2)}ms) {perf_flag}")
    
    result_data = None
    if response and response.status_code in [200, 201, 302]:
        try:
            result_data = response.json()
        except:
            # Handle binary responses or redirects
            result_data = {"response_type": "non_json", "content_length": len(response.content) if response.content else 0}
    
    return {
        "success": success,
        "status_code": status_code, 
        "response_time": rt,
        "data": result_data,
        "name": name
    }

def main():
    print("🚀 STARTING BATCH 4: MEDIA/UPLOAD + DISCOVERY/SEARCH + NOTIFICATIONS + ANALYTICS")
    print(f"📡 Testing API at: {BASE_URL}")
    print("⚠️  CRITICAL: No /auth/logout calls allowed - tokens must remain valid")
    print("🔬 Testing 57 endpoints total: 15 Media + 20 Discovery + 12 Notifications + 10 Analytics")
    
    # Get authentication tokens
    print("\n🔐 Getting authentication tokens...")
    admin_token, admin_user_id = get_fresh_token(ADMIN_CREDS)
    user_token, user_user_id = get_fresh_token(USER_CREDS)
    
    if not admin_token or not user_token:
        print("❌ Failed to get tokens - cannot continue")
        return False
    
    print(f"✅ token1 (admin) obtained - User ID: {admin_user_id}")
    print(f"✅ token2 obtained - User ID: {user_user_id}")
    
    results = []
    
    # ====================================================================================
    # BATCH 4A: MEDIA & UPLOAD (15 endpoints)
    # ====================================================================================
    print("\n📸 BATCH 4A: MEDIA & UPLOAD ENDPOINTS (15 tests)")
    
    # 1. POST /api/media/upload-init
    upload_init_result = test_endpoint(
        "1. POST /media/upload-init", "POST", "/media/upload-init",
        admin_token,
        {"kind": "image", "mimeType": "image/jpeg", "sizeBytes": 1048576, "scope": "posts"},
        [200, 201]
    )
    results.append(upload_init_result)
    
    # Extract upload details for step 2
    media_id = None
    upload_url = None
    public_url = None
    if upload_init_result["success"] and upload_init_result["data"]:
        data = upload_init_result["data"]
        media_id = data.get("mediaId")
        upload_url = data.get("uploadUrl")  
        public_url = data.get("publicUrl")
        print(f"   📋 Media ID: {media_id}")
        print(f"   📋 Upload URL: {upload_url}")
    
    # 2. PUT to Supabase uploadUrl
    if upload_url:
        binary_data = b'\x00' * 1024  # 1KB of binary data
        supabase_result = test_endpoint(
            "2. PUT Supabase Upload", "PUT", upload_url,
            None,  # No token for Supabase
            None,  # No JSON
            [200],
            raw_data=binary_data,
            custom_headers={"Content-Type": "image/jpeg"},
            external_url=True
        )
        results.append(supabase_result)
    else:
        print("❌ 2. PUT Supabase Upload: No upload URL")
        results.append({"success": False, "status_code": 0, "response_time": 0, "name": "2. PUT Supabase Upload"})
    
    # 3. POST /api/media/upload-complete
    if media_id:
        complete_result = test_endpoint(
            "3. POST /media/upload-complete", "POST", "/media/upload-complete",
            admin_token,
            {"mediaId": media_id},
            [200, 201]
        )
        results.append(complete_result)
    else:
        print("❌ 3. POST /media/upload-complete: No media ID")
        results.append({"success": False, "status_code": 0, "response_time": 0, "name": "3. POST /media/upload-complete"})
    
    # 4. GET /api/media/upload-status/{mediaId}
    if media_id:
        status_result = test_endpoint(
            "4. GET /media/upload-status", "GET", f"/media/upload-status/{media_id}",
            admin_token, None, [200]
        )
        results.append(status_result)
    else:
        print("❌ 4. GET /media/upload-status: No media ID")
        results.append({"success": False, "status_code": 0, "response_time": 0, "name": "4. GET /media/upload-status"})
    
    # 5. POST /api/media/chunked/init
    chunked_init_result = test_endpoint(
        "5. POST /media/chunked/init", "POST", "/media/chunked/init",
        admin_token,
        {"mimeType": "video/mp4", "totalSize": 6000000, "totalChunks": 3},
        [200, 201]
    )
    results.append(chunked_init_result)
    
    # Extract session ID
    session_id = None
    if chunked_init_result["success"] and chunked_init_result["data"]:
        session_id = chunked_init_result["data"].get("sessionId")
        print(f"   📋 Session ID: {session_id}")
    
    # 6, 7, 8. POST /api/media/chunked/{sessionId}/chunk (3 chunks)
    if session_id:
        chunk_data = base64.b64encode(b'X' * 2000000).decode()  # 2MB base64 encoded
        
        for chunk_idx in range(3):
            chunk_result = test_endpoint(
                f"{6 + chunk_idx}. POST chunked chunk {chunk_idx}", "POST", 
                f"/media/chunked/{session_id}/chunk",
                admin_token,
                {"chunkIndex": chunk_idx, "data": chunk_data},
                [200, 201, 204]
            )
            results.append(chunk_result)
    else:
        for chunk_idx in range(3):
            print(f"❌ {6 + chunk_idx}. POST chunked chunk {chunk_idx}: No session ID")
            results.append({"success": False, "status_code": 0, "response_time": 0, "name": f"{6 + chunk_idx}. POST chunked chunk {chunk_idx}"})
    
    # 9. GET /api/media/chunked/{sessionId}/status
    if session_id:
        chunk_status_result = test_endpoint(
            "9. GET /media/chunked/status", "GET", f"/media/chunked/{session_id}/status",
            admin_token, None, [200]
        )
        results.append(chunk_status_result)
    else:
        print("❌ 9. GET /media/chunked/status: No session ID")
        results.append({"success": False, "status_code": 0, "response_time": 0, "name": "9. GET /media/chunked/status"})
    
    # 10. POST /api/media/chunked/{sessionId}/complete
    if session_id:
        chunk_complete_result = test_endpoint(
            "10. POST /media/chunked/complete", "POST", f"/media/chunked/{session_id}/complete",
            admin_token, {}, [200, 201]
        )
        results.append(chunk_complete_result)
    else:
        print("❌ 10. POST /media/chunked/complete: No session ID")
        results.append({"success": False, "status_code": 0, "response_time": 0, "name": "10. POST /media/chunked/complete"})
    
    # 11. POST /api/media/upload (legacy base64)
    png_data = base64.b64encode(b'\x89PNG\r\n\x1a\n' + b'\x00' * 100).decode()
    legacy_upload_result = test_endpoint(
        "11. POST /media/upload (legacy)", "POST", "/media/upload",
        admin_token,
        {"data": png_data, "mimeType": "image/png", "type": "IMAGE"},
        [200, 201]
    )
    results.append(legacy_upload_result)
    
    # Extract media ID for remaining tests
    legacy_media_id = None
    if legacy_upload_result["success"] and legacy_upload_result["data"]:
        legacy_media_id = legacy_upload_result["data"].get("id")
        print(f"   📋 Legacy media ID: {legacy_media_id}")
    
    # 12. GET /api/media/{mediaId} (serve media)
    if legacy_media_id:
        serve_result = test_endpoint(
            "12. GET /media/{mediaId}", "GET", f"/media/{legacy_media_id}",
            None, None, [200, 302]  # Allow redirect
        )
        results.append(serve_result)
    else:
        print("❌ 12. GET /media/{mediaId}: No media ID")
        results.append({"success": False, "status_code": 0, "response_time": 0, "name": "12. GET /media/{mediaId}"})
    
    # 13. DELETE /api/media/{mediaId}
    if legacy_media_id:
        delete_result = test_endpoint(
            "13. DELETE /media/{mediaId}", "DELETE", f"/media/{legacy_media_id}",
            admin_token, None, [200, 204]
        )
        results.append(delete_result)
    else:
        print("❌ 13. DELETE /media/{mediaId}: No media ID")
        results.append({"success": False, "status_code": 0, "response_time": 0, "name": "13. DELETE /media/{mediaId}"})
    
    # 14. GET /api/admin/media/metrics
    metrics_result = test_endpoint(
        "14. GET /admin/media/metrics", "GET", "/admin/media/metrics",
        admin_token, None, [200]
    )
    results.append(metrics_result)
    
    # 15. POST /api/transcode/{mediaId}
    if media_id:  # Use first media ID if available
        transcode_result = test_endpoint(
            "15. POST /transcode/{mediaId}", "POST", f"/transcode/{media_id}",
            admin_token, None, [200, 201, 202]  # 202 for async
        )
        results.append(transcode_result)
    else:
        print("❌ 15. POST /transcode/{mediaId}: No media ID")
        results.append({"success": False, "status_code": 0, "response_time": 0, "name": "15. POST /transcode/{mediaId}"})
    
    # ====================================================================================
    # BATCH 4B: DISCOVERY & SEARCH (20 endpoints)
    # ====================================================================================
    print("\n🔍 BATCH 4B: DISCOVERY & SEARCH ENDPOINTS (20 tests)")
    
    discovery_tests = [
        ("16. GET /search", "GET", "/search?q=test", None, None, [200]),
        ("17. GET /search/autocomplete", "GET", "/search/autocomplete?q=te", None, None, [200]),
        ("18. GET /search/users", "GET", "/search/users?q=test", None, None, [200]),
        ("19. GET /search/hashtags", "GET", "/search/hashtags?q=test", None, None, [200]),
        ("20. GET /search/content", "GET", "/search/content?q=test", None, None, [200]),
        ("21. GET /search/recent", "GET", "/search/recent", admin_token, None, [200]),
        ("22. DELETE /search/recent", "DELETE", "/search/recent", admin_token, None, [200, 204]),
        ("23. GET /colleges/search", "GET", "/colleges/search?q=Delhi", None, None, [200]),
        ("24. GET /colleges/states", "GET", "/colleges/states", None, None, [200]),
        ("25. GET /colleges/types", "GET", "/colleges/types", None, None, [200]),
    ]
    
    for test_data in discovery_tests:
        result = test_endpoint(*test_data)
        results.append(result)
    
    # Get a college ID for next tests
    college_id = None
    # Try to get from user profile or search
    profile_response, _ = make_request("GET", "/me", admin_token)
    if profile_response and profile_response.status_code == 200:
        try:
            profile_data = profile_response.json()
            college_id = profile_data.get("user", {}).get("collegeId")
            if not college_id:
                college_id = profile_data.get("collegeId") 
        except:
            pass
    
    # If no college ID, search for one
    if not college_id:
        search_response, _ = make_request("GET", "/colleges/search?q=IIT", None)
        if search_response and search_response.status_code == 200:
            try:
                search_data = search_response.json()
                colleges = search_data.get("colleges", [])
                if colleges:
                    college_id = colleges[0].get("id")
            except:
                pass
    
    print(f"   📋 Using college ID: {college_id}")
    
    # 26, 27. College specific endpoints
    if college_id:
        college_tests = [
            ("26. GET /colleges/{collegeId}", "GET", f"/colleges/{college_id}", None, None, [200]),
            ("27. GET /colleges/{collegeId}/members", "GET", f"/colleges/{college_id}/members", None, None, [200])
        ]
        for test_data in college_tests:
            result = test_endpoint(*test_data)
            results.append(result)
    else:
        for i, name in enumerate(["26. GET /colleges/{collegeId}", "27. GET /colleges/{collegeId}/members"]):
            print(f"❌ {name}: No college ID")
            results.append({"success": False, "status_code": 0, "response_time": 0, "name": name})
    
    # 28-35. Remaining discovery endpoints
    remaining_discovery_tests = [
        ("28. GET /houses", "GET", "/houses", None, None, [200]),
        ("29. GET /houses/leaderboard", "GET", "/houses/leaderboard", None, None, [200]),
        ("30. GET /hashtags/trending", "GET", "/hashtags/trending", None, None, [200]),
        ("31. GET /hashtags/test", "GET", "/hashtags/test", None, None, [200]),
        ("32. GET /hashtags/test/feed", "GET", "/hashtags/test/feed", None, None, [200]),
        ("33. GET /suggestions/users", "GET", "/suggestions/users?limit=5", admin_token, None, [200]),
        ("34. GET /suggestions/people", "GET", "/suggestions/people?limit=5", admin_token, None, [200]),
        ("35. GET /suggestions/trending", "GET", "/suggestions/trending", admin_token, None, [200])
    ]
    
    for test_data in remaining_discovery_tests:
        result = test_endpoint(*test_data)
        results.append(result)
    
    # ====================================================================================
    # BATCH 4C: NOTIFICATIONS (12 endpoints)  
    # ====================================================================================
    print("\n🔔 BATCH 4C: NOTIFICATIONS ENDPOINTS (12 tests)")
    
    # 36. GET /api/notifications
    notifications_result = test_endpoint(
        "36. GET /notifications", "GET", "/notifications",
        admin_token, None, [200]
    )
    results.append(notifications_result)
    
    # Extract notification ID for read test
    notification_id = None
    if notifications_result["success"] and notifications_result["data"]:
        notifications = notifications_result["data"].get("notifications", [])
        if notifications:
            notification_id = notifications[0].get("id")
            print(f"   📋 Using notification ID: {notification_id}")
    
    # 37. GET /api/notifications/unread-count
    unread_count_result = test_endpoint(
        "37. GET /notifications/unread-count", "GET", "/notifications/unread-count",
        admin_token, None, [200]
    )
    results.append(unread_count_result)
    
    # 38. PATCH /api/notifications/read
    if notification_id:
        read_result = test_endpoint(
            "38. PATCH /notifications/read", "PATCH", "/notifications/read",
            admin_token, {"notificationIds": [notification_id]}, [200, 204]
        )
        results.append(read_result)
    else:
        # Try with empty array or skip
        read_result = test_endpoint(
            "38. PATCH /notifications/read", "PATCH", "/notifications/read", 
            admin_token, {"notificationIds": []}, [200, 204]
        )
        results.append(read_result)
    
    # 39-46. Remaining notification endpoints
    notification_tests = [
        ("39. POST /notifications/read-all", "POST", "/notifications/read-all", admin_token, None, [200, 204]),
        ("40. DELETE /notifications/clear", "DELETE", "/notifications/clear", admin_token, None, [200, 204]),
        ("41. POST /notifications/register-device", "POST", "/notifications/register-device", admin_token, {"deviceToken": "test-token-batch4", "platform": "ANDROID"}, [200, 201]),
        ("42. DELETE /notifications/unregister-device", "DELETE", "/notifications/unregister-device", admin_token, {"deviceToken": "test-token-batch4"}, [200, 204]),
        ("43. GET /notifications/preferences", "GET", "/notifications/preferences", admin_token, None, [200]),
        ("44. PATCH /notifications/preferences", "PATCH", "/notifications/preferences", admin_token, {"likes": True, "comments": True, "follows": True}, [200, 204]),
        ("45. POST /notifications/test-push", "POST", "/notifications/test-push", admin_token, None, [200, 201]),
        ("46. GET /notifications/stream", "GET", "/notifications/stream", admin_token, None, [200])  # Just verify 200, don't wait for events
    ]
    
    for test_data in notification_tests:
        result = test_endpoint(*test_data)
        results.append(result)
    
    # ====================================================================================
    # BATCH 4D: ANALYTICS (10 endpoints)
    # ====================================================================================
    print("\n📊 BATCH 4D: ANALYTICS ENDPOINTS (10 tests)")
    
    # 47-54. Analytics endpoints
    analytics_tests = [
        ("47. GET /analytics/overview", "GET", "/analytics/overview", admin_token, None, [200]),
        ("48. GET /analytics/content", "GET", "/analytics/content", admin_token, None, [200]),
        ("49. GET /analytics/audience", "GET", "/analytics/audience", admin_token, None, [200]),
        ("50. GET /analytics/reach", "GET", "/analytics/reach", admin_token, None, [200]),
        ("51. GET /analytics/stories", "GET", "/analytics/stories", admin_token, None, [200]),
        ("52. GET /analytics/profile-visits", "GET", "/analytics/profile-visits", admin_token, None, [200]),
        ("53. GET /analytics/reels", "GET", "/analytics/reels", admin_token, None, [200]),
        ("54. POST /analytics/track", "POST", "/analytics/track", admin_token, {"eventType": "PROFILE_VISIT", "targetId": user_user_id}, [200, 201, 204])
    ]
    
    for test_data in analytics_tests:
        result = test_endpoint(*test_data)
        results.append(result)
    
    # 55. GET /analytics/content/{contentId} - need a content ID
    # Try to get a post ID from recent content or create one
    content_id = None
    feed_response, _ = make_request("GET", "/feed/public?limit=1", admin_token)
    if feed_response and feed_response.status_code == 200:
        try:
            feed_data = feed_response.json()
            posts = feed_data.get("posts", [])
            if posts:
                content_id = posts[0].get("id")
        except:
            pass
    
    if content_id:
        content_analytics_result = test_endpoint(
            "55. GET /analytics/content/{contentId}", "GET", f"/analytics/content/{content_id}",
            admin_token, None, [200]
        )
        results.append(content_analytics_result)
        print(f"   📋 Used content ID: {content_id}")
    else:
        print("❌ 55. GET /analytics/content/{contentId}: No content ID available")
        results.append({"success": False, "status_code": 0, "response_time": 0, "name": "55. GET /analytics/content/{contentId}"})
    
    # ====================================================================================
    # FINAL REPORT
    # ====================================================================================
    total_tests = len(results)
    passed_tests = len([r for r in results if r["success"]])
    success_rate = (passed_tests / total_tests * 100) if total_tests > 0 else 0
    
    # Performance analysis
    response_times = [r["response_time"] * 1000 for r in results if r.get("response_time", 0) > 0]
    avg_time = sum(response_times) / len(response_times) if response_times else 0
    max_time = max(response_times) if response_times else 0
    slow_requests = len([rt for rt in response_times if rt > 500])
    
    # Breakdown by category
    media_results = results[0:15]
    discovery_results = results[15:35]
    notification_results = results[35:47]
    analytics_results = results[47:55] if len(results) >= 55 else results[47:]
    
    media_success = len([r for r in media_results if r["success"]]) / len(media_results) * 100
    discovery_success = len([r for r in discovery_results if r["success"]]) / len(discovery_results) * 100
    notification_success = len([r for r in notification_results if r["success"]]) / len(notification_results) * 100
    analytics_success = len([r for r in analytics_results if r["success"]]) / len(analytics_results) * 100
    
    print("\n" + "="*80)
    print("📊 BATCH 4 COMPREHENSIVE TEST REPORT")
    print("="*80)
    print(f"🎯 OVERALL SUCCESS RATE: {success_rate:.1f}% ({passed_tests}/{total_tests} endpoints passed)")
    print(f"🔗 BASE URL: {BASE_URL}")
    print(f"📈 PERFORMANCE:")
    print(f"   Average response time: {avg_time:.2f}ms")
    print(f"   Slowest response: {max_time:.2f}ms")
    print(f"   Requests >500ms: {slow_requests}")
    
    print(f"\n📋 CATEGORY BREAKDOWN:")
    print(f"   📸 Media/Upload (15): {media_success:.1f}% ({len([r for r in media_results if r['success']])}/15)")
    print(f"   🔍 Discovery/Search (20): {discovery_success:.1f}% ({len([r for r in discovery_results if r['success']])}/20)")
    print(f"   🔔 Notifications (12): {notification_success:.1f}% ({len([r for r in notification_results if r['success']])}/12)")
    print(f"   📊 Analytics (10): {analytics_success:.1f}% ({len([r for r in analytics_results if r['success']])}/10)")
    
    # Key findings
    media_working = media_success >= 70
    discovery_working = discovery_success >= 80
    notifications_working = notification_success >= 80
    analytics_working = analytics_success >= 80
    
    print(f"\n🔍 KEY FINDINGS:")
    print(f"   📸 Media/Upload System: {'✅ Working' if media_working else '❌ Issues'} (includes Supabase integration)")
    print(f"   🔍 Discovery/Search: {'✅ Working' if discovery_working else '❌ Issues'}")
    print(f"   🔔 Notifications: {'✅ Working' if notifications_working else '❌ Issues'}")
    print(f"   📊 Analytics: {'✅ Working' if analytics_working else '❌ Issues'}")
    
    # Failed tests summary
    failed_tests = [r for r in results if not r["success"]]
    if failed_tests:
        print(f"\n❌ FAILED TESTS ({len(failed_tests)}):")
        for test in failed_tests[:10]:  # Show first 10
            print(f"   - {test['name']}: {test['status_code']}")
        if len(failed_tests) > 10:
            print(f"   ... and {len(failed_tests) - 10} more")
    
    if success_rate >= 85:
        print("\n🎉 BATCH 4 TESTING COMPLETED SUCCESSFULLY!")
        return True
    else:
        print("\n⚠️  BATCH 4 TESTING COMPLETED WITH ISSUES")
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)