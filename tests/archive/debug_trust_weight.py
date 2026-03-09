#!/usr/bin/env python3
"""
Quick diagnostic to check user trust weight calculation
"""

import asyncio
import aiohttp
import json
from datetime import datetime

BASE_URL = "https://tribe-audit-proof.preview.emergentagent.com/api"

async def investigate_trust_weight():
    async with aiohttp.ClientSession() as session:
        # Login as the "older" user
        async with session.post(f"{BASE_URL}/auth/login", 
                               json={"phone": "9000000502", "pin": "1234"},
                               headers={"Content-Type": "application/json"}) as response:
            if response.status == 200:
                data = await response.json()
                token = data["token"]
                print(f"✅ Logged in as user: {data['user']['id']}")
                print(f"   Created: {data['user']['createdAt']}")
                
                # Calculate account age
                created_at = datetime.fromisoformat(data['user']['createdAt'].replace('Z', '+00:00'))
                now = datetime.now(created_at.tzinfo)
                age_days = (now - created_at).days
                print(f"   Account age: {age_days} days")
                
                if age_days < 7:
                    print(f"❌ Account is less than 7 days old - this explains trustWeight=0.5")
                else:
                    print(f"✅ Account is {age_days} days old (>7 days)")
                    print("   Need to check for active strikes...")
            else:
                print(f"❌ Failed to login: {response.status}")

if __name__ == "__main__":
    asyncio.run(investigate_trust_weight())