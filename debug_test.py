#!/usr/bin/env python3
"""
Debug script to investigate critical failures in the upload overhaul tests
"""

import requests
import json

# Configuration
BASE_URL = "https://upload-overhaul.preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api"
USER1 = {"phone": "7777099001", "pin": "1234"}

def debug_auth():
    """Debug authentication"""
    print("=== DEBUGGING AUTH ===")
    response = requests.post(f"{API_BASE}/auth/login", json=USER1)
    print(f"Auth status: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"Auth response keys: {list(data.keys())}")
        return data.get("token")
    else:
        print(f"Auth error: {response.text}")
        return None

def debug_post_creation(token):
    """Debug post creation with video"""
    print("\n=== DEBUGGING POST CREATION ===")
    
    if not token:
        print("No token available")
        return
    
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    
    # First create video media
    print("Creating video media...")
    init_response = requests.post(f"{API_BASE}/media/upload-init", headers=headers, json={
        "kind": "video",
        "mimeType": "video/mp4", 
        "sizeBytes": 2097152,
        "scope": "posts"
    })
    
    print(f"Init status: {init_response.status_code}")
    
    if init_response.status_code != 201:
        print(f"Init error: {init_response.text}")
        return
        
    init_data = init_response.json()
    print(f"Init data keys: {list(init_data.keys())}")
    
    # Upload video
    video_data = b'\x00' * 2097152
    upload_response = requests.put(init_data["uploadUrl"], data=video_data, headers={"Content-Type": "video/mp4"})
    print(f"Upload status: {upload_response.status_code}")
    
    # Complete upload
    complete_response = requests.post(f"{API_BASE}/media/upload-complete", headers=headers, json={"mediaId": init_data["mediaId"]})
    print(f"Complete status: {complete_response.status_code}")
    
    if complete_response.status_code != 200:
        print(f"Complete error: {complete_response.text}")
        return
        
    complete_data = complete_response.json()
    print(f"Complete data keys: {list(complete_data.keys())}")
    media_id = complete_data["id"]
    
    # Now create post
    print(f"\nCreating post with mediaId: {media_id}")
    
    post_payload = {
        "caption": "Debug test post with video",
        "mediaIds": [media_id]
    }
    
    print(f"Post payload: {json.dumps(post_payload, indent=2)}")
    
    post_response = requests.post(f"{API_BASE}/content/posts", headers=headers, json=post_payload)
    print(f"Post creation status: {post_response.status_code}")
    print(f"Post response: {post_response.text}")
    
    if post_response.status_code in [200, 201]:
        post_data = post_response.json()
        print(f"Post response keys: {list(post_data.keys())}")
        
        if "media" in post_data:
            print(f"Media in response: {post_data['media']}")
        else:
            print("No 'media' key in response")
            
        return post_data
    
    return None

def debug_simple_post_creation(token):
    """Debug simple text post creation"""
    print("\n=== DEBUGGING SIMPLE POST CREATION ===")
    
    if not token:
        return
    
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    
    post_payload = {
        "caption": "Simple debug test post",
        "mediaIds": []
    }
    
    response = requests.post(f"{API_BASE}/content/posts", headers=headers, json=post_payload)
    print(f"Simple post status: {response.status_code}")
    print(f"Simple post response: {response.text}")
    
    if response.status_code in [200, 201]:
        data = response.json()
        print(f"Simple post keys: {list(data.keys())}")
        return data
        
    return None

def debug_cache_stats():
    """Debug cache stats endpoint"""
    print("\n=== DEBUGGING CACHE STATS ===")
    
    response = requests.get(f"{API_BASE}/cache/stats")
    print(f"Cache stats status: {response.status_code}")
    print(f"Cache stats response: {response.text}")

def debug_stories_feed():
    """Debug stories feed"""
    print("\n=== DEBUGGING STORIES FEED ===")
    
    response = requests.get(f"{API_BASE}/stories/feed")
    print(f"Stories feed status: {response.status_code}")
    print(f"Stories feed response: {response.text}")

def main():
    print("DEBUGGING CRITICAL FAILURES")
    print("=" * 50)
    
    # Debug authentication
    token = debug_auth()
    
    # Debug post creation
    debug_simple_post_creation(token)
    debug_post_creation(token)
    
    # Debug other failing endpoints
    debug_cache_stats()
    debug_stories_feed()

if __name__ == "__main__":
    main()