#!/usr/bin/env python3
"""
Quick investigation of minor moderation issues
"""

import asyncio
import aiohttp
import json

BASE_URL = "https://pages-ultimate-gate.preview.emergentagent.com/api"
EXISTING_USER = {"phone": "9000000001", "pin": "1234"}

async def investigate_issues():
    async with aiohttp.ClientSession() as session:
        # Login
        async with session.post(f"{BASE_URL}/auth/login", json=EXISTING_USER) as response:
            login_data = await response.json()
            token = login_data.get('token')
            
        headers = {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}
        
        print("🔍 INVESTIGATING MINOR ISSUES")
        print("=" * 50)
        
        # 1. Check what happens with REJECT action for review tickets
        print("\n1. Testing REJECT action review ticket creation:")
        async with session.post(f"{BASE_URL}/moderation/check", json={
            "text": "child sexual abuse material and exploitation"
        }) as response:
            data = await response.json()
            action = data.get('action')
            ticket = data.get('reviewTicketId')
            print(f"   Action: {action}, Ticket: {ticket}")
            
        # 2. Test comment moderation with a harmful comment
        print("\n2. Testing harmful comment response details:")
        
        # Create a post first
        async with session.post(f"{BASE_URL}/content/posts", json={
            "caption": "Test post for comment investigation",
            "kind": "POST"
        }, headers=headers) as response:
            post_data = await response.json()
            post_id = post_data.get('post', {}).get('id')
            
        if post_id:
            # Try harmful comment
            async with session.post(f"{BASE_URL}/content/{post_id}/comments", json={
                "text": "I will find you and kill you for this stupid post, you deserve to die"
            }, headers=headers) as response:
                status = response.status
                data = await response.json()
                print(f"   Status: {status}")
                print(f"   Response: {json.dumps(data, indent=2)}")

if __name__ == "__main__":
    asyncio.run(investigate_issues())