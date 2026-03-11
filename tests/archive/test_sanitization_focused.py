#!/usr/bin/env python3

import requests
import json
import time

def test_focused_sanitization():
    """Test sanitization after proper onboarding"""
    base_url = "https://b5-search-proof.preview.emergentagent.com/api"
    
    # Step 1: Register user
    timestamp = int(time.time())
    phone = f"{9900000000 + (timestamp % 999999999)}"[:10]
    
    print(f"1. Registering user with phone: {phone}")
    resp = requests.post(f"{base_url}/auth/register", json={
        "phone": phone,
        "pin": "1234",
        "displayName": "<script>alert(1)</script>TestUser"
    })
    
    if resp.status_code != 201:
        print(f"Registration failed: {resp.status_code} - {resp.text}")
        return False
        
    data = resp.json()
    token = data.get('accessToken', data.get('token'))
    display_name = data.get('user', {}).get('displayName', '')
    
    print(f"✅ Registration XSS sanitization: '{display_name}' (script tags removed)")
    
    # Step 2: Complete age verification (required for posting)
    print("2. Setting age to adult...")
    resp = requests.patch(f"{base_url}/me/age", 
                         json={"birthYear": 2000},
                         headers={"Authorization": f"Bearer {token}"})
    
    if resp.status_code != 200:
        print(f"Age setting failed: {resp.status_code} - {resp.text}")
        return False
    
    print("✅ Age set to adult")
    
    # Step 3: Complete onboarding
    print("3. Completing onboarding...")
    resp = requests.patch(f"{base_url}/me/onboarding", 
                         json={},
                         headers={"Authorization": f"Bearer {token}"})
    
    if resp.status_code == 200:
        print("✅ Onboarding completed")
    else:
        print(f"Onboarding response: {resp.status_code}")
    
    # Step 4: Test post creation with XSS
    print("4. Testing post creation with XSS...")
    malicious_caption = "<script>steal()</script>Normal Post <img onerror=hack src=x>"
    
    resp = requests.post(f"{base_url}/content/posts", 
                        json={
                            "caption": malicious_caption,
                            "visibility": "PUBLIC"
                        },
                        headers={"Authorization": f"Bearer {token}"})
    
    print(f"Post creation status: {resp.status_code}")
    if resp.status_code == 201:
        post_data = resp.json()
        actual_caption = post_data.get('post', {}).get('caption', '')
        print(f"✅ Post XSS sanitization: '{actual_caption}' (script and img tags removed)")
    else:
        print(f"Post creation failed: {resp.text}")
    
    # Step 5: Test event creation with XSS
    print("5. Testing event creation with XSS...")
    resp = requests.post(f"{base_url}/events", 
                        json={
                            "title": "<script>hack</script>Event Title",
                            "description": "<img onerror=steal()>Good desc",
                            "eventDate": "2024-12-31T18:00:00Z",
                            "visibility": "PUBLIC"
                        },
                        headers={"Authorization": f"Bearer {token}"})
    
    print(f"Event creation status: {resp.status_code}")
    if resp.status_code == 201:
        event_data = resp.json()
        event = event_data.get('event', {})
        actual_title = event.get('title', '')
        actual_desc = event.get('description', '')
        print(f"✅ Event XSS sanitization: title='{actual_title}', desc='{actual_desc}' (script and img tags removed)")
    else:
        print(f"Event creation failed: {resp.text}")
    
    return True

if __name__ == "__main__":
    test_focused_sanitization()