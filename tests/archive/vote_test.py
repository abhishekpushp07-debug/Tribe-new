#!/usr/bin/env python3
"""
Quick test for vote system fix
"""

import requests
import json

BASE_URL = "https://pages-ultimate-gate.preview.emergentagent.com/api"
ADMIN_PHONE = "9000000501"
USER_PHONE = "9000000502" 
PIN = "1234"

# Login admin
admin_response = requests.post(f"{BASE_URL}/auth/login", json={"phone": ADMIN_PHONE, "pin": PIN})
admin_token = admin_response.json()['token']

# Login user
user_response = requests.post(f"{BASE_URL}/auth/login", json={"phone": USER_PHONE, "pin": PIN})
user_token = user_response.json()['token']

# Get a resource to test
search_response = requests.get(f"{BASE_URL}/resources/search?limit=1")
resources = search_response.json()['resources']

if resources:
    resource_id = resources[0]['id']
    print(f"Testing vote on resource: {resource_id}")
    
    # Test user vote
    headers = {"Authorization": f"Bearer {user_token}"}
    vote_response = requests.post(f"{BASE_URL}/resources/{resource_id}/vote", 
                                json={"vote": "UP"}, headers=headers)
    
    print(f"Vote response: {vote_response.status_code} - {vote_response.text}")
    
    if vote_response.status_code in [200, 201]:
        print("✅ Vote successful!")
        
        # Test vote removal
        remove_response = requests.delete(f"{BASE_URL}/resources/{resource_id}/vote", headers=headers)
        print(f"Remove vote: {remove_response.status_code} - {remove_response.text}")
    else:
        print("❌ Vote failed")
else:
    print("No resources found to test")