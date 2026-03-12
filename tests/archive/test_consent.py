#!/usr/bin/env python3
import asyncio
import aiohttp
import json

async def test_legal_consent():
    BASE_URL = "https://media-platform-api.preview.emergentagent.com/api"
    
    async with aiohttp.ClientSession() as session:
        # Register new user first
        test_phone = f"932000{1000 + int(asyncio.get_event_loop().time()) % 9000}"
        async with session.post(f"{BASE_URL}/auth/register", 
                               json={"phone": test_phone, "pin": "1234", "displayName": "Test User"}) as resp:
            if resp.status == 201:
                data = await resp.json()
                token = data["token"]
                headers = {"Authorization": f"Bearer {token}"}
                
                # Test legal consent
                print("Testing legal consent...")
                async with session.get(f"{BASE_URL}/legal/consent", headers=headers) as resp:
                    print(f"GET consent status: {resp.status}")
                    consent_data = await resp.json()
                    print(f"Consent data: {json.dumps(consent_data, indent=2)}")
                    
                    if "notice" in consent_data:
                        notice_id = consent_data["notice"]["id"]
                        
                        # Try to accept consent
                        async with session.post(f"{BASE_URL}/legal/consent", 
                                              headers=headers,
                                              json={"noticeId": notice_id, "accepted": True}) as resp:
                            print(f"POST consent status: {resp.status}")
                            if resp.status != 200:
                                error_text = await resp.text()
                                print(f"Error: {error_text}")

if __name__ == "__main__":
    asyncio.run(test_legal_consent())