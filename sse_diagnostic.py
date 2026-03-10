#!/usr/bin/env python3
"""
Simple SSE Connection Test - Diagnose SSE endpoints
"""

import requests
import time

BASE_URL = "https://tribe-p0a-perfect.preview.emergentagent.com/api"

def test_sse_basic():
    print("🔍 SSE Basic Connection Test")
    print("=" * 50)
    
    # Get a contest ID first
    r = requests.post(f'{BASE_URL}/auth/login', json={'phone': '9000000001', 'pin': '1234'})
    if r.status_code != 200:
        print("❌ Auth failed")
        return
    
    token = r.json().get('token')
    headers = {'Authorization': f'Bearer {token}'}
    
    # Get contests
    r = requests.get(f'{BASE_URL}/tribe-contests', headers=headers)
    if r.status_code != 200:
        print("❌ Failed to get contests")
        return
    
    response_data = r.json()
    contests = response_data.get('data', {}).get('items', []) or response_data.get('items', [])
    if not contests:
        print("❌ No contests found")
        return
    
    contest_id = contests[0]['id']
    print(f"✅ Found contest: {contest_id}")
    
    # Test SSE endpoints with minimal timeout
    sse_endpoints = [
        f"tribe-contests/{contest_id}/live",
        "tribe-contests/live-feed", 
        f"tribe-contests/seasons/6dd39c1d-f3b3-4543-bba2-d2b44cdf60ac/live-standings"
    ]
    
    for endpoint in sse_endpoints:
        print(f"\n🎯 Testing: {endpoint}")
        url = f"{BASE_URL}/{endpoint}"
        
        try:
            # Test just headers first
            response = requests.head(url, timeout=5)
            print(f"   HEAD request: {response.status_code}")
            
            # Test GET with short timeout
            response = requests.get(url, stream=True, timeout=3)
            print(f"   GET status: {response.status_code}")
            print(f"   Content-Type: {response.headers.get('content-type', 'Not set')}")
            
            # Try to read first few chunks
            if response.status_code == 200:
                chunks_read = 0
                for chunk in response.iter_content(chunk_size=1024, decode_unicode=True):
                    if chunk:
                        print(f"   First chunk: {chunk[:100]}...")
                        chunks_read += 1
                        if chunks_read >= 1:  # Just read first chunk
                            break
                print(f"   ✅ SSE stream working")
            else:
                print(f"   ❌ Bad status code")
                
        except requests.exceptions.Timeout:
            print(f"   ⏰ Timeout (expected for SSE)")
        except Exception as e:
            print(f"   ❌ Error: {e}")

if __name__ == "__main__":
    test_sse_basic()