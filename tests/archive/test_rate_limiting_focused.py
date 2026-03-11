#!/usr/bin/env python3

import requests
import json
import time
import concurrent.futures
import threading

def test_auth_rate_limiting():
    """Test AUTH tier rate limiting with rapid requests"""
    base_url = "https://b5-search-proof.preview.emergentagent.com/api"
    
    print("Testing AUTH tier rate limiting (10 requests/minute)...")
    
    # Make rapid login attempts to trigger IP-based rate limiting
    def make_login_request(attempt):
        try:
            phone = f"802000{attempt:04d}"  # Different phone numbers
            resp = requests.post(f"{base_url}/auth/login", 
                               json={
                                   "phone": phone,
                                   "pin": "9999"  # Wrong PIN
                               },
                               timeout=5)
            return attempt, resp.status_code, resp.headers.get('Retry-After', 'none')
        except Exception as e:
            return attempt, 0, str(e)
    
    # Use threading to make requests quickly
    results = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=15) as executor:
        futures = [executor.submit(make_login_request, i) for i in range(15)]
        
        for future in concurrent.futures.as_completed(futures):
            attempt, status, retry_after = future.result()
            results.append((attempt, status, retry_after))
            print(f"Attempt {attempt}: Status {status}, Retry-After: {retry_after}")
            
            if status == 429:
                print(f"✅ AUTH tier rate limiting working! Got 429 on attempt {attempt}")
                print(f"   Retry-After header: {retry_after}")
                return True
    
    print("❌ AUTH tier rate limiting not triggered within 15 attempts")
    return False

def test_per_user_vs_per_ip():
    """Test that per-user and per-IP rate limiting are separate"""
    base_url = "https://b5-search-proof.preview.emergentagent.com/api"
    
    print("\nTesting per-user vs per-IP rate limiting separation...")
    
    # Register two users
    timestamp = int(time.time())
    
    # User 1
    phone1 = f"{9902000000 + (timestamp % 999999999)}"[:10]
    resp1 = requests.post(f"{base_url}/auth/register", json={
        "phone": phone1,
        "pin": "1234",
        "displayName": "User1"
    })
    
    if resp1.status_code != 201:
        print(f"User 1 registration failed: {resp1.status_code}")
        return False
    
    token1 = resp1.json().get('accessToken')
    
    # User 2  
    phone2 = f"{9903000000 + (timestamp % 999999999)}"[:10]
    resp2 = requests.post(f"{base_url}/auth/register", json={
        "phone": phone2,
        "pin": "1234", 
        "displayName": "User2"
    })
    
    if resp2.status_code != 201:
        print(f"User 2 registration failed: {resp2.status_code}")
        return False
        
    token2 = resp2.json().get('accessToken')
    
    print(f"✅ Registered two users: {phone1}, {phone2}")
    
    # Try to exhaust SENSITIVE rate limit for user 1 (5/min)
    print("Exhausting SENSITIVE rate limit for user 1...")
    rate_limited_user1 = False
    
    for attempt in range(6):
        resp = requests.patch(f"{base_url}/auth/pin",
                             json={"currentPin": "wrong", "newPin": "5678"},
                             headers={"Authorization": f"Bearer {token1}"})
        
        print(f"User 1 attempt {attempt + 1}: {resp.status_code}")
        if resp.status_code == 429:
            rate_limited_user1 = True
            print(f"✅ User 1 rate limited on attempt {attempt + 1}")
            break
    
    if not rate_limited_user1:
        print("❌ User 1 was not rate limited")
        return False
    
    # Now test that user 2 can still make requests (separate per-user limit)
    print("Testing user 2 can still make requests...")
    resp = requests.patch(f"{base_url}/auth/pin",
                         json={"currentPin": "wrong", "newPin": "5678"},
                         headers={"Authorization": f"Bearer {token2}"})
    
    if resp.status_code == 401:  # Wrong PIN, but not rate limited
        print("✅ User 2 not rate limited (separate per-user limits working)")
        return True
    elif resp.status_code == 429:
        print("❌ User 2 also rate limited (per-user limits not working correctly)")
        return False
    else:
        print(f"Unexpected status for user 2: {resp.status_code}")
        return False

if __name__ == "__main__":
    print("=" * 60)
    print("TESTING STAGE 2 RECOVERY RATE LIMITING")
    print("=" * 60)
    
    # Test 1: AUTH tier rate limiting
    auth_result = test_auth_rate_limiting()
    
    # Test 2: Per-user vs per-IP separation
    separation_result = test_per_user_vs_per_ip()
    
    print("\n" + "=" * 60)
    print("RATE LIMITING TEST SUMMARY")
    print("=" * 60)
    print(f"AUTH tier rate limiting: {'✅ PASS' if auth_result else '❌ FAIL'}")
    print(f"Per-user rate separation: {'✅ PASS' if separation_result else '❌ FAIL'}")
    
    if auth_result and separation_result:
        print("\n🎉 RATE LIMITING RECOVERY SUCCESSFUL!")
    else:
        print("\n💥 RATE LIMITING RECOVERY NEEDS ATTENTION")