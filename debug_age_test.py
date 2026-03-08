#!/usr/bin/env python3
"""
Quick test to debug age verification issue for Reels backend.
"""

import asyncio
import aiohttp
import json
import os

BASE_URL = os.getenv("NEXT_PUBLIC_BASE_URL", "https://tribe-proof-pack.preview.emergentagent.com") + "/api"

async def debug_age_verification():
    connector = aiohttp.TCPConnector(ssl=False)
    timeout = aiohttp.ClientTimeout(total=30)
    
    async with aiohttp.ClientSession(connector=connector, timeout=timeout, headers={"Content-Type": "application/json"}) as session:
        # Login existing user
        async with session.post(f"{BASE_URL}/auth/login", 
                               json={"phone": "7777100001", "pin": "1234"}) as resp:
            if resp.status == 200:
                data = await resp.json()
                token = data.get("token")
                print(f"✅ Logged in. Token: {token[:20]}...")
                
                # Check current user status
                async with session.get(f"{BASE_URL}/auth/me", 
                                     headers={"Authorization": f"Bearer {token}"}) as resp2:
                    if resp2.status == 200:
                        user_data = await resp2.json()
                        user = user_data.get("user", {})
                        print(f"Current user status:")
                        print(f"  - ageVerified: {user.get('ageVerified')}")
                        print(f"  - ageStatus: {user.get('ageStatus')}")
                        print(f"  - birthYear: {user.get('birthYear')}")
                        
                        # Try to set age again
                        async with session.patch(f"{BASE_URL}/me/age", 
                                               json={"birthYear": 1995}, 
                                               headers={"Authorization": f"Bearer {token}"}) as resp3:
                            print(f"Age update response: {resp3.status}")
                            if resp3.status == 200:
                                age_data = await resp3.json()
                                print(f"Age update data: {age_data}")
                                
                                # Check user status again
                                async with session.get(f"{BASE_URL}/auth/me", 
                                                     headers={"Authorization": f"Bearer {token}"}) as resp4:
                                    if resp4.status == 200:
                                        user_data2 = await resp4.json()
                                        user2 = user_data2.get("user", {})
                                        print(f"After age update:")
                                        print(f"  - ageVerified: {user2.get('ageVerified')}")
                                        print(f"  - ageStatus: {user2.get('ageStatus')}")
                                        print(f"  - birthYear: {user2.get('birthYear')}")
                                        
                                        # Try to create a reel
                                        reel_data = {
                                            "caption": "Test reel",
                                            "hashtags": ["test"],
                                            "mediaUrl": "https://cdn.example.com/test.mp4",
                                            "visibility": "PUBLIC",
                                            "isDraft": False
                                        }
                                        
                                        async with session.post(f"{BASE_URL}/reels",
                                                              json=reel_data,
                                                              headers={"Authorization": f"Bearer {token}"}) as resp5:
                                            print(f"\nReel creation attempt: {resp5.status}")
                                            reel_resp = await resp5.json()
                                            print(f"Reel response: {reel_resp}")
                            else:
                                error_data = await resp3.json()
                                print(f"Age update failed: {error_data}")
                    else:
                        print(f"Failed to get user info: {resp2.status}")
            else:
                error_data = await resp.json()
                print(f"Login failed: {resp.status} - {error_data}")

if __name__ == "__main__":
    asyncio.run(debug_age_verification())