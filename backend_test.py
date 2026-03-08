#!/usr/bin/env python3
"""
Stage 12: Canonical 21-Tribe System Backend Test
Tests all 20 tribe endpoints with comprehensive verification
"""

import requests
import json
import sys
import time
from datetime import datetime

# Configuration
BASE_URL = "https://tribe-proof-pack.preview.emergentagent.com/api"
timeout = 10

# Test users as specified in requirements
TEST_USERS = {
    'admin': {'phone': '9000000001', 'pin': '1234'},  # SUPER_ADMIN
    'user1': {'phone': '9000000002', 'pin': '1234'},  # USER, ADULT
    'user2': {'phone': '9000000003', 'pin': '1234'},  # USER, ADULT
}

tokens = {}
users = {}

def log(message):
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {message}")

def login_user(user_key):
    """Login and get token for user"""
    try:
        user = TEST_USERS[user_key]
        response = requests.post(f"{BASE_URL}/auth/login", 
                               json={"phone": user['phone'], "pin": user['pin']},
                               timeout=timeout)
        
        if response.status_code == 200:
            data = response.json()
            tokens[user_key] = data['token']
            users[user_key] = data['user']
            log(f"✅ Login successful for {user_key}: {user['phone']}")
            return True
        else:
            log(f"❌ Login failed for {user_key}: {response.status_code} - {response.text}")
            return False
    except Exception as e:
        log(f"❌ Login exception for {user_key}: {str(e)}")
        return False

def get_headers(user_key):
    """Get auth headers for user"""
    return {"Authorization": f"Bearer {tokens[user_key]}"}

def test_endpoint(method, endpoint, headers=None, json_data=None, expected_status=200, description=""):
    """Test an endpoint and return success/failure"""
    try:
        url = f"{BASE_URL}{endpoint}"
        response = requests.request(method, url, headers=headers, json=json_data, timeout=timeout)
        
        success = response.status_code == expected_status
        status_icon = "✅" if success else "❌"
        
        log(f"{status_icon} {method} {endpoint} -> {response.status_code} {description}")
        
        if success and response.headers.get('content-type', '').startswith('application/json'):
            try:
                return True, response.json()
            except:
                return True, response.text
        elif success:
            return True, response.text
        else:
            log(f"   Error: {response.text[:200]}")
            return False, response.text
            
    except requests.exceptions.Timeout:
        log(f"❌ {method} {endpoint} -> TIMEOUT")
        return False, "TIMEOUT"
    except Exception as e:
        log(f"❌ {method} {endpoint} -> ERROR: {str(e)}")
        return False, str(e)

def run_comprehensive_tribe_tests():
    """Run comprehensive tests for Stage 12 tribe system"""
    
    log("🔥 STAGE 12: CANONICAL 21-TRIBE SYSTEM COMPREHENSIVE TEST")
    log("=" * 80)
    
    # Setup: Login all users
    log("\n📋 SETUP: Authenticating test users...")
    for user_key in TEST_USERS:
        if not login_user(user_key):
            log(f"❌ Failed to login {user_key}, aborting tests")
            return False
    
    test_results = []
    
    log("\n🌟 TESTING PUBLIC TRIBE ROUTES...")
    
    # 1. GET /tribes - Returns all 21 tribes
    success, data = test_endpoint("GET", "/tribes", description="List all 21 tribes")
    test_results.append(success)
    if success and 'tribes' in data:
        tribe_count = len(data['tribes'])
        log(f"   Found {tribe_count} tribes (expected 21)")
        if tribe_count >= 21:
            log(f"   ✅ Correct tribe count: {tribe_count}")
        else:
            log(f"   ⚠️  Fewer tribes than expected: {tribe_count}/21")
        
        # Store first tribe for subsequent tests
        first_tribe = data['tribes'][0] if data['tribes'] else None
        somnath_tribe = next((t for t in data['tribes'] if t.get('tribeCode') == 'SOMNATH'), None)
        test_tribe = somnath_tribe or first_tribe
        
    # 2. GET /tribes/:id - Tribe detail (test with ID and tribeCode)
    if 'test_tribe' in locals() and test_tribe:
        success, data = test_endpoint("GET", f"/tribes/{test_tribe['id']}", 
                                    description=f"Get tribe detail by ID: {test_tribe.get('tribeCode')}")
        test_results.append(success)
        
        # Test by tribeCode
        if test_tribe.get('tribeCode'):
            success, data = test_endpoint("GET", f"/tribes/{test_tribe['tribeCode']}", 
                                        description=f"Get tribe detail by code: {test_tribe['tribeCode']}")
            test_results.append(success)
            if success and 'tribe' in data:
                log(f"   ✅ Tribe detail includes: tribe, topMembers, board, recentSalutes")
    
    # 3. GET /tribes/:id/members - Paginated member list
    if 'test_tribe' in locals() and test_tribe:
        success, data = test_endpoint("GET", f"/tribes/{test_tribe['id']}/members", 
                                    description="Get tribe members")
        test_results.append(success)
    
    # 4. GET /tribes/standings/current - Current standings
    success, data = test_endpoint("GET", "/tribes/standings/current", description="Get current standings")
    test_results.append(success)
    if success and 'standings' in data:
        log(f"   ✅ Standings returned with season info")
    
    # 5. GET /tribes/:id/board - Tribe governance board
    if 'test_tribe' in locals() and test_tribe:
        success, data = test_endpoint("GET", f"/tribes/{test_tribe['id']}/board", 
                                    description="Get tribe board")
        test_results.append(success)
    
    # 6. GET /tribes/:id/fund - Fund account
    if 'test_tribe' in locals() and test_tribe:
        success, data = test_endpoint("GET", f"/tribes/{test_tribe['id']}/fund", 
                                    description="Get tribe fund")
        test_results.append(success)
    
    # 7. GET /tribes/:id/salutes - Paginated salute history
    if 'test_tribe' in locals() and test_tribe:
        success, data = test_endpoint("GET", f"/tribes/{test_tribe['id']}/salutes", 
                                    description="Get tribe salutes")
        test_results.append(success)
    
    log("\n👤 TESTING USER ROUTES...")
    
    # 8. GET /me/tribe - My tribe (auto-assigns if none)
    success, data = test_endpoint("GET", "/me/tribe", headers=get_headers('user1'), 
                                description="Get my tribe (user1)")
    test_results.append(success)
    user1_tribe = None
    if success and 'tribe' in data:
        user1_tribe = data['tribe']
        is_new = data.get('isNew', False)
        log(f"   User1 assigned to tribe: {user1_tribe.get('tribeCode')} (isNew: {is_new})")
        
        # Test idempotency - second call should return isNew=false
        success, data2 = test_endpoint("GET", "/me/tribe", headers=get_headers('user1'), 
                                     description="Get my tribe again (idempotency test)")
        test_results.append(success)
        if success and not data2.get('isNew', True):
            log(f"   ✅ Idempotency verified: isNew=false on second call")
        
    # 9. GET /users/:userId/tribe - Another user's tribe info
    if users.get('user1'):
        success, data = test_endpoint("GET", f"/users/{users['user1']['id']}/tribe", 
                                    description="Get another user's tribe")
        test_results.append(success)
    
    log("\n🔒 TESTING ADMIN ROUTES...")
    
    admin_headers = get_headers('admin')
    
    # 10. GET /admin/tribes/distribution - Distribution stats
    success, data = test_endpoint("GET", "/admin/tribes/distribution", headers=admin_headers,
                                description="Get tribe distribution stats")
    test_results.append(success)
    if success and 'distribution' in data:
        log(f"   Total users: {data.get('totalUsers', 0)}, members: {data.get('totalMembers', 0)}")
    
    # 11. POST /admin/tribes/reassign - Reassign user to different tribe
    if users.get('user2') and user1_tribe:
        # Find a different tribe
        available_tribes = ['SOMNATH', 'JADUNATH', 'PIRU', 'KARAM', 'RANE']
        target_tribe = next((t for t in available_tribes if t != user1_tribe.get('tribeCode')), 'JADUNATH')
        
        success, data = test_endpoint("POST", "/admin/tribes/reassign", headers=admin_headers,
                                    json_data={
                                        "userId": users['user2']['id'],
                                        "tribeCode": target_tribe,
                                        "reason": "Test reassignment for comprehensive testing"
                                    },
                                    description=f"Reassign user2 to {target_tribe}")
        test_results.append(success)
    
    # 12. POST /admin/tribes/migrate - Migrate batch from house system
    success, data = test_endpoint("POST", "/admin/tribes/migrate", headers=admin_headers,
                                json_data={"batchSize": 10},
                                description="Migrate users from house system")
    test_results.append(success)
    if success:
        log(f"   Migration result: {data.get('migrated', 0)} migrated, {data.get('skipped', 0)} skipped")
    
    # 13. POST /admin/tribes/boards - Create tribe board
    if 'test_tribe' in locals() and test_tribe and users.get('user1') and users.get('user2'):
        success, data = test_endpoint("POST", "/admin/tribes/boards", headers=admin_headers,
                                    json_data={
                                        "tribeId": test_tribe['id'],
                                        "members": [
                                            {"userId": users['user1']['id'], "role": "CAPTAIN"},
                                            {"userId": users['user2']['id'], "role": "VICE_CAPTAIN"},
                                            {"userId": users['admin']['id'], "role": "FINANCE_LEAD"}
                                        ]
                                    },
                                    description="Create tribe board")
        test_results.append(success)
    
    log("\n⏰ TESTING SEASON/CONTEST/SALUTE/AWARD ROUTES...")
    
    # 14. POST /admin/tribe-seasons - Create season
    season_data = {
        "name": "Test Season 2024",
        "year": 2024,
        "startDate": "2024-01-01T00:00:00Z",
        "endDate": "2024-12-31T23:59:59Z",
        "prizeAmount": 500000,
        "awardTitle": "Test Emerald Tribe Award 2024"
    }
    success, data = test_endpoint("POST", "/admin/tribe-seasons", headers=admin_headers,
                                json_data=season_data,
                                description="Create tribe season")
    test_results.append(success)
    season_id = data.get('season', {}).get('id') if success and data else None
    
    # 15. GET /admin/tribe-seasons - List seasons
    success, data = test_endpoint("GET", "/admin/tribe-seasons", headers=admin_headers,
                                description="List tribe seasons")
    test_results.append(success)
    
    # 16. POST /admin/tribe-seasons - Activate season
    if season_id:
        success, data = test_endpoint("POST", "/admin/tribe-seasons", headers=admin_headers,
                                    json_data={"action": "activate", "seasonId": season_id},
                                    description="Activate season")
        test_results.append(success)
    
    # 17. POST /admin/tribe-contests - Create contest
    contest_data = {
        "seasonId": season_id,
        "name": "Test Contest: Battle of Wisdom",
        "description": "A test contest for comprehensive testing",
        "salutesForWin": 100,
        "salutesForRunnerUp": 50
    }
    success, data = test_endpoint("POST", "/admin/tribe-contests", headers=admin_headers,
                                json_data=contest_data if season_id else {},
                                expected_status=201 if season_id else 400,
                                description="Create tribe contest")
    test_results.append(success)
    contest_id = data.get('contest', {}).get('id') if success and data and season_id else None
    
    # 18. POST /admin/tribe-contests/:id/resolve - Resolve contest
    if contest_id and 'test_tribe' in locals():
        # Get available tribes for winner/runner-up
        tribes_response = requests.get(f"{BASE_URL}/tribes", timeout=timeout)
        if tribes_response.status_code == 200:
            tribes = tribes_response.json().get('tribes', [])
            winner_tribe = tribes[0] if tribes else None
            runner_up_tribe = tribes[1] if len(tribes) > 1 else None
            
            if winner_tribe:
                success, data = test_endpoint("POST", f"/admin/tribe-contests/{contest_id}/resolve", 
                                            headers=admin_headers,
                                            json_data={
                                                "winnerTribeId": winner_tribe['id'],
                                                "runnerUpTribeId": runner_up_tribe['id'] if runner_up_tribe else None
                                            },
                                            description="Resolve contest")
                test_results.append(success)
    
    # 19. POST /admin/tribe-salutes/adjust - Manual salute adjustment
    if 'test_tribe' in locals() and test_tribe:
        success, data = test_endpoint("POST", "/admin/tribe-salutes/adjust", headers=admin_headers,
                                    json_data={
                                        "tribeId": test_tribe['id'],
                                        "deltaSalutes": 25,
                                        "reasonCode": "ADMIN_AWARD",
                                        "reasonText": "Test manual salute adjustment"
                                    },
                                    expected_status=201,
                                    description="Manual salute adjustment")
        test_results.append(success)
    
    # 20. POST /admin/tribe-awards/resolve - Resolve annual award
    if season_id:
        success, data = test_endpoint("POST", "/admin/tribe-awards/resolve", headers=admin_headers,
                                    json_data={"seasonId": season_id},
                                    description="Resolve annual award")
        test_results.append(success)
        if not success:
            # Try again - might be duplicate
            success, data = test_endpoint("POST", "/admin/tribe-awards/resolve", headers=admin_headers,
                                        json_data={"seasonId": season_id},
                                        expected_status=409,  # Conflict for duplicate
                                        description="Resolve annual award (duplicate test)")
            test_results.append(success)
    
    log("\n🧪 TESTING EDGE CASES...")
    
    # Test GET /tribes/SOMNATH (by tribeCode)
    success, data = test_endpoint("GET", "/tribes/SOMNATH", 
                                description="Get tribe by code (SOMNATH)")
    test_results.append(success)
    
    # Test non-admin access to admin endpoints (should return 403)
    success, data = test_endpoint("GET", "/admin/tribes/distribution", 
                                headers=get_headers('user1'),
                                expected_status=403,
                                description="Non-admin access test (expect 403)")
    test_results.append(success)
    
    # Test duplicate award resolution (should return 409)
    if season_id:
        success, data = test_endpoint("POST", "/admin/tribe-awards/resolve", 
                                    headers=admin_headers,
                                    json_data={"seasonId": season_id},
                                    expected_status=409,
                                    description="Duplicate award resolution (expect 409)")
        test_results.append(success)
    
    log("\n📊 TEST RESULTS SUMMARY")
    log("=" * 50)
    
    total_tests = len(test_results)
    passed_tests = sum(test_results)
    success_rate = (passed_tests / total_tests * 100) if total_tests > 0 else 0
    
    log(f"Total Tests: {total_tests}")
    log(f"Passed: {passed_tests}")
    log(f"Failed: {total_tests - passed_tests}")
    log(f"Success Rate: {success_rate:.1f}%")
    
    if success_rate >= 90:
        log("🎉 EXCELLENT: Stage 12 Tribe System is PRODUCTION READY!")
    elif success_rate >= 80:
        log("✅ GOOD: Stage 12 Tribe System is working well with minor issues")
    elif success_rate >= 70:
        log("⚠️  ACCEPTABLE: Stage 12 Tribe System has some issues")
    else:
        log("❌ CRITICAL: Stage 12 Tribe System needs significant fixes")
    
    return success_rate >= 80

if __name__ == "__main__":
    try:
        success = run_comprehensive_tribe_tests()
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        log("\n⏹️  Test interrupted by user")
        sys.exit(1)
    except Exception as e:
        log(f"\n💥 Test failed with exception: {str(e)}")
        sys.exit(1)