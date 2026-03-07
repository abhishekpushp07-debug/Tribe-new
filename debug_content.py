#!/usr/bin/env python3
"""
Debug Content Creation Response Structure
"""

import asyncio
import aiohttp
import json

BASE_URL = "https://tribe-adapter-v2.preview.emergentagent.com/api"
EXISTING_USER = {"phone": "9000000001", "pin": "1234"}

async def debug_content_creation():
    connector = aiohttp.TCPConnector(limit=100)
    timeout = aiohttp.ClientTimeout(total=30)
    
    async with aiohttp.ClientSession(connector=connector, timeout=timeout) as session:
        # Login
        async with session.post(f"{BASE_URL}/auth/login", json=EXISTING_USER) as response:
            login_data = await response.json()
            token = login_data.get('token')
            
        if not token:
            print("❌ Could not authenticate")
            return
            
        print("✅ Authenticated successfully")
        
        # Create a test post and examine the full response
        headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
        post_data = {
            "caption": "Debug test post to examine response structure",
            "kind": "POST"
        }
        
        async with session.post(f"{BASE_URL}/content/posts", json=post_data, headers=headers) as response:
            print(f"Response Status: {response.status}")
            result = await response.json()
            print(f"Full Response: {json.dumps(result, indent=2)}")

if __name__ == "__main__":
    asyncio.run(debug_content_creation())