#!/usr/bin/env python3
"""
DIAGNOSTIC TEST FOR FAILING ENDPOINTS
Quick check of specific failing endpoints to provide detailed error information
"""

import requests
import json

BASE_URL = "https://tribe-feed-engine-1.preview.emergentagent.com/api"
HEADERS = {"Content-Type": "application/json"}

def make_request(method: str, endpoint: str, data=None, token=None):
    url = f"{BASE_URL}{endpoint}"
    headers = HEADERS.copy()
    
    if token:
        headers["Authorization"] = f"Bearer {token}"
    
    try:
        if method == "GET":
            response = requests.get(url, headers=headers, timeout=30)
        elif method == "POST":
            response = requests.post(url, json=data, headers=headers, timeout=30)
        elif method == "PUT":
            response = requests.put(url, json=data, headers=headers, timeout=30)
        elif method == "PATCH":
            response = requests.patch(url, json=data, headers=headers, timeout=30)
        
        print(f"\n{method} {endpoint}")
        print(f"Status: {response.status_code}")
        
        try:
            response_data = response.json()
            print(f"Response: {json.dumps(response_data, indent=2)}")
        except:
            print(f"Response (text): {response.text[:500]}")
        
        return response
    except Exception as e:
        print(f"ERROR: {e}")
        return None

# Get auth token first
print("=== GETTING AUTH TOKEN ===")
login_data = {"phone": "9000000001", "pin": "1234"}
response = make_request("POST", "/auth/login", login_data)
token = None
if response and response.status_code == 200:
    token = response.json()["token"]
    print(f"Token obtained: {token[:50]}...")
else:
    print("Failed to get token")
    exit(1)

print("\n" + "="*60)
print("DIAGNOSING FAILING ENDPOINTS")
print("="*60)

# Test 1: PIN Change issue
print("\n=== 1. PIN Change Issue ===")
pin_data = {"currentPin": "1234", "newPin": "5555"}
make_request("PUT", "/auth/pin", pin_data, token)

# Test 2: Set Age issue  
print("\n=== 2. Set Age Issue ===")
age_data = {"birthYear": 2000}
make_request("PUT", "/me/age", age_data, token)

# Test 3: Link College issue
print("\n=== 3. Link College Issue ===")
college_data = {"collegeId": "7b61691b-5a7c-48dd-a221-464d04e48e11"}
make_request("PUT", "/me/college", college_data, token)

# Test 4: Stories Feed issue
print("\n=== 4. Stories Feed Issue ===")
make_request("GET", "/feed/stories", token=token)

# Test 5: Create Appeal issue
print("\n=== 5. Create Appeal Issue ===")
# First create a report to appeal
report_data = {
    "targetType": "CONTENT", 
    "targetId": "test-post-id",
    "reasonCode": "INAPPROPRIATE",
    "details": "Test report for appeal"
}
report_response = make_request("POST", "/reports", report_data, token)
if report_response and report_response.status_code == 201:
    report_id = report_response.json()["report"]["id"]
    
    appeal_data = {
        "reportId": report_id,
        "reason": "This was reported incorrectly",
        "details": "Test appeal"
    }
    make_request("POST", "/appeals", appeal_data, token)

# Test 6: House Points Config issue
print("\n=== 6. House Points Config Issue ===")
make_request("GET", "/house-points/config")

# Test 7: House Points Leaderboard issue
print("\n=== 7. House Points Leaderboard Issue ===")  
make_request("GET", "/house-points/leaderboard")

print("\n" + "="*60)
print("DIAGNOSTIC COMPLETE")
print("="*60)