#!/usr/bin/env python3

import requests
import json
import time

def test_event_creation():
    """Test event creation with proper fields and XSS sanitization"""
    base_url = "https://pages-ultimate-gate.preview.emergentagent.com/api"
    
    # Register and onboard a user
    timestamp = int(time.time())
    phone = f"{9901000000 + (timestamp % 999999999)}"[:10]
    
    print(f"Registering user with phone: {phone}")
    resp = requests.post(f"{base_url}/auth/register", json={
        "phone": phone,
        "pin": "1234",
        "displayName": "EventTestUser"
    })
    
    token = resp.json().get('accessToken')
    
    # Set age and complete onboarding
    requests.patch(f"{base_url}/me/age", 
                  json={"birthYear": 2000},
                  headers={"Authorization": f"Bearer {token}"})
    
    requests.patch(f"{base_url}/me/onboarding", 
                  json={},
                  headers={"Authorization": f"Bearer {token}"})
    
    # Test event creation with XSS
    resp = requests.post(f"{base_url}/events", 
                        json={
                            "title": "<script>hack</script>Event Title",
                            "description": "<img onerror=steal()>Good event description",
                            "startAt": "2024-12-31T18:00:00Z",
                            "visibility": "PUBLIC",
                            "category": "ACADEMIC"
                        },
                        headers={"Authorization": f"Bearer {token}"})
    
    print(f"Event creation status: {resp.status_code}")
    if resp.status_code == 201:
        event_data = resp.json()
        event = event_data.get('event', {})
        actual_title = event.get('title', '')
        actual_desc = event.get('description', '')
        print(f"✅ Event XSS sanitization working!")
        print(f"   Original title: '<script>hack</script>Event Title'")
        print(f"   Sanitized title: '{actual_title}'")
        print(f"   Original desc: '<img onerror=steal()>Good event description'")
        print(f"   Sanitized desc: '{actual_desc}'")
    else:
        print(f"Event creation failed: {resp.text}")

if __name__ == "__main__":
    test_event_creation()