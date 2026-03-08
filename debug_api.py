#!/usr/bin/env python3
"""
Debug specific API issues for final test
"""
import asyncio
import aiohttp
import json

BASE_URL = "https://realtime-standings-1.preview.emergentagent.com/api"
TEST_USER_PHONE = "9000000001"
TEST_USER_PIN = "1234"

async def debug_issues():
    session = aiohttp.ClientSession()
    
    # Login test user
    async with session.post(f"{BASE_URL}/auth/login", 
                           json={"phone": TEST_USER_PHONE, "pin": TEST_USER_PIN}) as resp:
        data = await resp.json()
        auth_token = data["token"]
    
    headers = {"Authorization": f"Bearer {auth_token}"}
    
    print("=== DEBUGGING API ISSUES ===")
    
    # 1. Test age setting (should be PUT, not PATCH)
    print("\n1. Testing age setting:")
    for method in ["PUT", "PATCH"]:
        async with session.request(method, f"{BASE_URL}/me/age", 
                                  headers=headers,
                                  json={"birthYear": 2000}) as resp:
            status = resp.status
            try:
                data = await resp.json()
            except:
                data = await resp.text()
            print(f"   {method} /me/age: {status} - {data}")
    
    # 2. Test college setting (should be PUT, not PATCH)
    print("\n2. Testing college setting:")
    # First get a college ID
    async with session.get(f"{BASE_URL}/colleges/search?q=IIT", headers=headers) as resp:
        colleges_data = await resp.json()
        college_id = colleges_data["colleges"][0]["id"] if colleges_data.get("colleges") else None
    
    if college_id:
        for method in ["PUT", "PATCH"]:
            async with session.request(method, f"{BASE_URL}/me/college", 
                                      headers=headers,
                                      json={"collegeId": college_id}) as resp:
                status = resp.status
                try:
                    data = await resp.json()
                except:
                    data = await resp.text()
                print(f"   {method} /me/college: {status} - {data}")
    
    # 3. Test media upload
    print("\n3. Testing media upload:")
    async with session.post(f"{BASE_URL}/media/upload", 
                           headers=headers,
                           json={"data": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==", 
                                 "mimeType": "image/png", "type": "IMAGE"}) as resp:
        status = resp.status
        try:
            data = await resp.json()
        except:
            data = await resp.text()
        print(f"   POST /media/upload: {status}")
        if status == 201:
            print(f"   Response keys: {list(data.keys()) if isinstance(data, dict) else 'Not dict'}")
            if isinstance(data, dict):
                for key, value in data.items():
                    print(f"     {key}: {value}")
    
    await session.close()

if __name__ == "__main__":
    asyncio.run(debug_issues())