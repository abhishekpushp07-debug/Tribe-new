#!/usr/bin/env python3
"""
DEBUG TEST: Investigate the specific failures from the main test
"""

import json
import asyncio
from datetime import datetime
import httpx

BASE_URL = "https://comprehensive-guide-1.preview.emergentagent.com/api"
TEST_USER = {"phone": "7777099001", "pin": "1234"}

async def debug_issues():
    """Debug the specific issues found in main test"""
    client = httpx.AsyncClient(timeout=30)
    
    try:
        # Authenticate
        auth_response = await client.post(f"{BASE_URL}/auth/login", json=TEST_USER)
        if auth_response.status_code != 200:
            print(f"❌ Auth failed: {auth_response.status_code}")
            return
            
        token = auth_response.json().get("accessToken")
        headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        
        print("🔍 DEBUGGING FAILED TESTS")
        print("=" * 50)
        
        # DEBUG 1: Contest creation 400 error
        print("\n1. DEBUG CONTEST CREATION:")
        
        # First get a season ID (contests need seasonId)
        seasons_response = await client.get(f"{BASE_URL}/admin/tribe-seasons", headers=headers)
        print(f"Seasons endpoint: {seasons_response.status_code}")
        if seasons_response.status_code == 200:
            seasons_data = seasons_response.json()
            print(f"Seasons data: {json.dumps(seasons_data, indent=2)}")
            
            seasons = seasons_data.get("data", {}).get("items", [])
            if seasons:
                season_id = seasons[0].get("id")
                print(f"Using season ID: {season_id}")
            else:
                # Try creating a season first  
                season_data = {
                    "name": "Test Season 2026",
                    "year": 2026,
                    "prizeAmount": 10000
                }
                create_season_response = await client.post(f"{BASE_URL}/admin/tribe-seasons", 
                                                          json=season_data, headers=headers)
                print(f"Create season response: {create_season_response.status_code}")
                if create_season_response.status_code in [200, 201]:
                    season_id = create_season_response.json().get("data", {}).get("season", {}).get("id")
                    print(f"Created season ID: {season_id}")
                else:
                    print(f"Failed to create season: {create_season_response.text}")
                    season_id = None
        else:
            print(f"Failed to get seasons: {seasons_response.text}")
            season_id = None
            
        if season_id:
            contest_data = {
                "seasonId": season_id,
                "contestName": "Engagement Test",
                "scoringModelId": "scoring_content_engagement_v1",
                "entryTypes": ["reel", "post", "story"],
                "prizePool": 100,
                "startsAt": "2026-01-01T00:00:00Z",
                "endsAt": "2027-12-31T23:59:59Z"
            }
            
            contest_response = await client.post(f"{BASE_URL}/admin/tribe-contests", 
                                               json=contest_data, headers=headers)
            print(f"Contest creation: {contest_response.status_code}")
            print(f"Contest response: {contest_response.text}")
        
        # DEBUG 2: User profile heroName
        print("\n2. DEBUG USER PROFILE HERONAME:")
        
        # Check /auth/me response
        me_response = await client.get(f"{BASE_URL}/auth/me", headers=headers)
        print(f"Auth me status: {me_response.status_code}")
        if me_response.status_code == 200:
            me_data = me_response.json()
            print(f"Auth/me data: {json.dumps(me_data, indent=2)}")
            
        # Check /me/tribe response  
        tribe_response = await client.get(f"{BASE_URL}/me/tribe", headers=headers)
        print(f"Me tribe status: {tribe_response.status_code}")
        if tribe_response.status_code == 200:
            tribe_data = tribe_response.json()
            print(f"Me/tribe data: {json.dumps(tribe_data, indent=2)}")
            
        # DEBUG 3: Visibility issues
        print("\n3. DEBUG VISIBILITY:")
        
        # Test HOUSE_ONLY visibility
        house_data = {
            "caption": "House only visibility test",
            "visibility": "HOUSE_ONLY"
        }
        
        house_response = await client.post(f"{BASE_URL}/content/posts", 
                                         json=house_data, headers=headers)
        print(f"HOUSE_ONLY post status: {house_response.status_code}")
        print(f"HOUSE_ONLY response: {house_response.text}")
        
        # Test default visibility
        default_data = {
            "caption": "Default visibility test"
        }
        
        default_response = await client.post(f"{BASE_URL}/content/posts",
                                           json=default_data, headers=headers)
        print(f"Default post status: {default_response.status_code}")
        print(f"Default response: {default_response.text}")
        
    except Exception as e:
        print(f"❌ Exception: {str(e)}")
    finally:
        await client.aclose()

if __name__ == "__main__":
    asyncio.run(debug_issues())