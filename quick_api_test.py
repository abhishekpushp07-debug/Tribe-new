#!/usr/bin/env python3
import asyncio
import aiohttp
import json

async def test_api():
    BASE_URL = "https://realtime-standings-1.preview.emergentagent.com/api"
    
    async with aiohttp.ClientSession() as session:
        # Login first
        async with session.post(f"{BASE_URL}/auth/login", 
                               json={"phone": "9000000001", "pin": "1234"}) as resp:
            if resp.status == 200:
                data = await resp.json()
                token = data["token"]
                print(f"✅ Login successful, got token")
                
                # Get user info
                headers = {"Authorization": f"Bearer {token}"}
                async with session.get(f"{BASE_URL}/auth/me", headers=headers) as resp:
                    user_data = await resp.json()
                    print(f"📋 User data: {json.dumps(user_data, indent=2)}")
                    
                # Test age setting
                async with session.patch(f"{BASE_URL}/me/age", 
                                       headers=headers,
                                       json={"birthYear": 2000}) as resp:
                    print(f"Age setting status: {resp.status}")
                    age_data = await resp.json() 
                    print(f"Age response: {json.dumps(age_data, indent=2)}")
                    
                # Test media upload
                async with session.post(f"{BASE_URL}/media/upload",
                                      headers=headers,
                                      json={"data": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="}) as resp:
                    print(f"Media upload status: {resp.status}")
                    if resp.status != 201:
                        media_error = await resp.text()
                        print(f"Media upload error: {media_error}")
                    
                # Test story creation
                async with session.post(f"{BASE_URL}/content/posts",
                                      headers=headers,
                                      json={"caption": "Test story", "kind": "STORY"}) as resp:
                    print(f"Story creation status: {resp.status}")
                    if resp.status != 201:
                        story_error = await resp.text()
                        print(f"Story creation error: {story_error}")
                        
            else:
                print(f"❌ Login failed: {resp.status}")

if __name__ == "__main__":
    asyncio.run(test_api())