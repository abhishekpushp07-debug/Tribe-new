#!/usr/bin/env python3
"""
Debug failed Stories and Reels endpoints to get specific error messages
"""

import requests
import json

# Base configuration
BASE_URL = "https://upload-overhaul.preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api"

# Test credentials
ADMIN_CREDS = {"phone": "7777099001", "pin": "1234"}

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
        print(f"Token error: {e}")
    return None, None

def debug_endpoint(name, method, endpoint, token, json_data=None):
    """Debug a specific endpoint"""
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    
    try:
        response = requests.request(
            method, 
            f"{API_BASE}{endpoint}", 
            headers=headers,
            json=json_data,
            timeout=30
        )
        
        print(f"\n🔍 {name}")
        print(f"   Status: {response.status_code}")
        print(f"   URL: {method} {API_BASE}{endpoint}")
        
        if json_data:
            print(f"   Payload: {json_data}")
        
        try:
            resp_data = response.json()
            print(f"   Response: {json.dumps(resp_data, indent=2)}")
        except:
            print(f"   Raw Response: {response.text[:500]}")
            
    except Exception as e:
        print(f"\n❌ {name}: Exception - {e}")

def main():
    print("🔍 DEBUGGING FAILED ENDPOINTS")
    
    # Get admin token
    token1, user1_id = get_fresh_token(ADMIN_CREDS)
    
    if not token1:
        print("❌ Failed to get admin token")
        return
    
    print(f"✅ Admin token obtained - User ID: {user1_id}")
    
    # Debug failed stories endpoints
    print("\n📖 DEBUGGING STORIES FAILURES")
    
    # 1. POST /api/stories
    debug_endpoint(
        "POST /api/stories", "POST", "/stories", token1,
        {"storyType":"TEXT","text":"Batch3 test story","background":"#ff5722"}
    )
    
    # Debug failed reels endpoints  
    print("\n🎬 DEBUGGING REELS FAILURES")
    
    # First create a test reel
    debug_endpoint(
        "POST /api/reels (for testing)", "POST", "/reels", token1,
        {"caption":"Debug test reel","audioName":"Test Audio"}
    )
    
    # Let's create reel manually to get an ID for other tests
    try:
        response = requests.post(f"{API_BASE}/reels", 
                               json={"caption":"Debug test reel","audioName":"Test Audio"},
                               headers={"Content-Type": "application/json", "Authorization": f"Bearer {token1}"},
                               timeout=30)
        if response.status_code in [200, 201]:
            reel_data = response.json()
            reel_id = reel_data.get("reel", {}).get("id") or reel_data.get("id")
            print(f"✅ Created test reel ID: {reel_id}")
            
            # Now test failed endpoints
            debug_endpoint("POST /api/reels/{reelId}/report", "POST", f"/reels/{reel_id}/report", token1, {"reason":"spam"})
            debug_endpoint("POST /api/reels/{reelId}/watch", "POST", f"/reels/{reel_id}/watch", token1, {"watchDuration":15,"totalDuration":30})
            debug_endpoint("POST /api/reels/{reelId}/publish", "POST", f"/reels/{reel_id}/publish", token1)
            debug_endpoint("POST /api/me/reels/series", "POST", "/me/reels/series", token1, {"title":"Test Series","description":"batch test"})
        else:
            print(f"❌ Failed to create test reel: {response.status_code}")
    except Exception as e:
        print(f"❌ Exception creating test reel: {e}")

if __name__ == "__main__":
    main()