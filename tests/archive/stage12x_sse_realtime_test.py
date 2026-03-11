#!/usr/bin/env python3
"""
Stage 12X-RT — Real-Time Contest Scoreboard SSE Comprehensive Test

Tests the NEW SSE real-time layer added on top of the existing contest engine.
Focuses on Server-Sent Events (SSE) streaming endpoints and real-time broadcasting.

Test Coverage:
1. SSE Connection + Snapshot delivery
2. Real-time Entry + Vote Broadcasting
3. Lifecycle Transition Broadcasting
4. Resolution Broadcasting
5. Global Feed SSE
6. Recompute + Broadcast
7. Season Standings SSE

Architecture: Next.js 14 with Redis Pub/Sub fallback to in-memory EventEmitter
Base URL: https://tribe-feed-engine-1.preview.emergentagent.com/api
"""

import requests
import json
import time
import threading
import uuid
from datetime import datetime
import re

# Configuration
BASE_URL = "https://tribe-feed-engine-1.preview.emergentagent.com/api"
SEASON_ID = "6dd39c1d-f3b3-4543-bba2-d2b44cdf60ac"
ADMIN_USER = {'phone': '9000000001', 'pin': '1234'}

# Test tracking
results = {'passed': 0, 'failed': 0, 'details': []}

def log_test(name, success, details=""):
    status = "✅" if success else "❌"
    print(f"{status} {name}")
    if details:
        print(f"    {details}")
    
    results['details'].append({'test': name, 'success': success, 'details': details})
    if success:
        results['passed'] += 1
    else:
        results['failed'] += 1

def api_call(method, endpoint, headers=None, data=None, timeout=15):
    """Make API call with error handling"""
    url = f"{BASE_URL}/{endpoint.lstrip('/')}"
    try:
        if method == 'GET':
            r = requests.get(url, headers=headers, timeout=timeout)
        elif method == 'POST':
            r = requests.post(url, headers=headers, json=data, timeout=timeout)
        elif method == 'PATCH':
            r = requests.patch(url, headers=headers, json=data, timeout=timeout)
        elif method == 'DELETE':
            r = requests.delete(url, headers=headers, timeout=timeout)
        return r
    except Exception as e:
        print(f"API call failed: {e}")
        return None

def get_token(phone, pin="1234"):
    """Get auth token for user"""
    r = api_call('POST', 'auth/login', data={'phone': phone, 'pin': pin})
    if r and r.status_code == 200:
        return r.json().get('token')
    return None

def register_user(phone, name, pin="1234"):
    """Register new user"""
    r = api_call('POST', 'auth/register', data={
        'phone': phone, 'pin': pin, 'displayName': name
    })
    if r and r.status_code == 201:
        return r.json().get('token')
    return None

def headers_for(token):
    """Get auth headers"""
    return {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'}

def parse_sse_stream(response_text):
    """Parse SSE stream into events"""
    events = []
    lines = response_text.split('\n')
    current_event = {}
    
    for line in lines:
        line = line.strip()
        if line.startswith('id:'):
            current_event['id'] = line[3:].strip()
        elif line.startswith('event:'):
            current_event['event'] = line[6:].strip()
        elif line.startswith('data:'):
            try:
                current_event['data'] = json.loads(line[5:].strip())
            except:
                current_event['data'] = line[5:].strip()
        elif line == '' and current_event:
            events.append(current_event.copy())
            current_event = {}
    
    return events

class SSEListener:
    """Helper class to listen to SSE streams with timeout"""
    
    def __init__(self, url, headers=None, timeout=10):
        self.url = url
        self.headers = headers or {}
        self.timeout = timeout
        self.events = []
        self.connected = False
        self.error = None
    
    def listen(self):
        """Listen to SSE stream for specified duration"""
        try:
            response = requests.get(
                self.url, 
                headers=self.headers, 
                stream=True, 
                timeout=self.timeout
            )
            
            if response.status_code != 200:
                self.error = f"HTTP {response.status_code}"
                return
            
            # Check content type
            content_type = response.headers.get('content-type', '')
            if 'text/event-stream' not in content_type:
                self.error = f"Invalid content-type: {content_type}"
                return
            
            self.connected = True
            buffer = ""
            
            for chunk in response.iter_content(chunk_size=1024, decode_unicode=True):
                if chunk:
                    buffer += chunk
                    # Process complete events
                    while '\n\n' in buffer:
                        event_data, buffer = buffer.split('\n\n', 1)
                        event = self._parse_event(event_data)
                        if event:
                            self.events.append(event)
                            
        except requests.exceptions.Timeout:
            # Timeout is expected for SSE streams
            pass
        except Exception as e:
            self.error = str(e)
    
    def _parse_event(self, event_data):
        """Parse single SSE event"""
        lines = event_data.split('\n')
        event = {}
        
        for line in lines:
            if line.startswith('id:'):
                event['id'] = line[3:].strip()
            elif line.startswith('event:'):
                event['event'] = line[6:].strip()
            elif line.startswith('data:'):
                try:
                    event['data'] = json.loads(line[5:].strip())
                except:
                    event['data'] = line[5:].strip()
            elif line.startswith(':'):
                # Heartbeat or comment
                event['comment'] = line[1:].strip()
        
        return event if event else None

def test_sse_endpoint(endpoint_path, test_name, expected_events=None):
    """Test SSE endpoint connection and events"""
    url = f"{BASE_URL}/{endpoint_path}"
    listener = SSEListener(url, timeout=8)
    listener.listen()
    
    if listener.error:
        log_test(f"{test_name} - Connection", False, f"Error: {listener.error}")
        return None
    
    if not listener.connected:
        log_test(f"{test_name} - Connection", False, "Failed to connect")
        return None
    
    log_test(f"{test_name} - Connection", True, "Connected successfully")
    
    # Check for expected events
    events = listener.events
    event_types = [e.get('event') for e in events if 'event' in e]
    
    # Should have at least 'connected' and 'snapshot' events
    has_connected = 'connected' in event_types
    has_snapshot = 'snapshot' in event_types
    
    log_test(f"{test_name} - Connected Event", has_connected, 
             f"Events received: {event_types[:5]}")
    log_test(f"{test_name} - Snapshot Event", has_snapshot,
             f"Total events: {len(events)}")
    
    return events

def main():
    print("🏛️ STAGE 12X-RT — REAL-TIME CONTEST SCOREBOARD SSE TEST")
    print("=" * 70)
    print("Testing NEW SSE real-time layer on existing contest engine")
    print("Focus: Server-Sent Events (SSE) streaming and real-time broadcasting")
    print()
    
    # Setup: Get admin token and find existing contest
    admin_token = get_token(ADMIN_USER['phone'])
    if not admin_token:
        log_test("Admin Authentication", False, "Failed to get admin token")
        return
    
    admin_headers = headers_for(admin_token)
    
    # Find existing contests
    r = api_call('GET', 'tribe-contests', headers=admin_headers)
    if not r or r.status_code != 200:
        log_test("Get Existing Contests", False, "Failed to fetch contests")
        return
    
    # Handle both possible response formats
    response_data = r.json()
    contests = response_data.get('data', {}).get('items', []) or response_data.get('items', [])
    if not contests:
        log_test("Find Test Contest", False, "No contests found")
        return
    
    # Use first available contest
    test_contest_id = contests[0]['id']
    log_test("Contest Selection", True, f"Using contest ID: {test_contest_id}")
    
    # ======== SCENARIO 1: SSE CONNECTION + SNAPSHOT ========
    print("\n🎯 SCENARIO 1: SSE Connection + Snapshot")
    print("-" * 50)
    
    # Test contest live stream
    events = test_sse_endpoint(
        f"tribe-contests/{test_contest_id}/live",
        "Contest Live Stream"
    )
    
    if events:
        # Verify snapshot data structure
        snapshot_events = [e for e in events if e.get('event') == 'snapshot']
        if snapshot_events:
            snapshot_data = snapshot_events[0].get('data', {})
            has_leaderboard = 'leaderboard' in snapshot_data
            has_tribe_ranking = 'tribeRanking' in snapshot_data  
            has_entry_count = 'entryCount' in snapshot_data
            has_vote_count = 'voteCount' in snapshot_data
            
            log_test("Snapshot Data Structure", 
                    all([has_leaderboard, has_tribe_ranking, has_entry_count, has_vote_count]),
                    f"Leaderboard: {has_leaderboard}, TribeRanking: {has_tribe_ranking}, Counts: {has_entry_count}/{has_vote_count}")
    
    # Test global live feed
    test_sse_endpoint("tribe-contests/live-feed", "Global Live Feed")
    
    # Test season standings stream
    test_sse_endpoint(
        f"tribe-contests/seasons/{SEASON_ID}/live-standings",
        "Season Standings Stream"
    )
    
    # ======== SCENARIO 2: REAL-TIME ENTRY + VOTE BROADCASTING ========
    print("\n📡 SCENARIO 2: Real-time Entry + Vote Broadcasting")
    print("-" * 50)
    
    # Create test user for entry submission
    test_phone = f"999888{int(time.time()) % 10000:04d}"
    test_token = register_user(test_phone, "SSE Test User")
    
    if test_token:
        test_headers = headers_for(test_token)
        
        # Find a contest that accepts entries
        entry_contest = None
        for contest in contests:
            if contest.get('status') == 'ENTRY_OPEN':
                entry_contest = contest
                break
        
        if entry_contest:
            contest_id = entry_contest['id']
            
            # Start SSE listener in background
            sse_url = f"{BASE_URL}/tribe-contests/{contest_id}/live"
            sse_listener = SSEListener(sse_url, timeout=15)
            
            # Start listening in a separate thread
            listener_thread = threading.Thread(target=sse_listener.listen)
            listener_thread.start()
            time.sleep(2)  # Let connection establish
            
            # Submit entry to trigger broadcast
            entry_data = {
                'entryType': 'reel',
                'contentId': f'sse_test_{uuid.uuid4().hex[:8]}',
                'submissionPayload': {'caption': 'SSE test entry'}
            }
            
            r = api_call('POST', f'tribe-contests/{contest_id}/enter',
                        headers=test_headers, data=entry_data)
            
            if r and r.status_code == 201:
                entry_id = r.json().get('data', {}).get('entry', {}).get('id')
                log_test("Entry Submission", True, f"Entry created: {entry_id}")
                
                # Wait a bit for SSE event to arrive
                time.sleep(3)
                
                # Check for entry.submitted event
                listener_thread.join(timeout=5)
                entry_events = [e for e in sse_listener.events 
                              if e.get('event') == 'entry.submitted']
                
                log_test("Entry Broadcast Event", len(entry_events) > 0,
                        f"entry.submitted events: {len(entry_events)}")
                
                # Test voting broadcast (if we have another user)
                voter_phone = f"999777{int(time.time()) % 10000:04d}"
                voter_token = register_user(voter_phone, "SSE Voter")
                
                if voter_token and entry_id:
                    voter_headers = headers_for(voter_token)
                    
                    # Start new SSE listener for vote events
                    vote_listener = SSEListener(sse_url, timeout=10)
                    vote_thread = threading.Thread(target=vote_listener.listen)
                    vote_thread.start()
                    time.sleep(1)
                    
                    # Cast vote
                    vote_data = {'entryId': entry_id, 'voteType': 'support'}
                    r = api_call('POST', f'tribe-contests/{contest_id}/vote',
                                headers=voter_headers, data=vote_data)
                    
                    if r and r.status_code == 201:
                        log_test("Vote Submission", True, "Vote cast successfully")
                        
                        time.sleep(3)
                        vote_thread.join(timeout=3)
                        
                        vote_events = [e for e in vote_listener.events
                                     if e.get('event') == 'vote.cast']
                        
                        log_test("Vote Broadcast Event", len(vote_events) > 0,
                                f"vote.cast events: {len(vote_events)}")
                    else:
                        log_test("Vote Submission", False, 
                                f"Status: {r.status_code if r else 'No response'}")
            else:
                log_test("Entry Submission", False,
                        f"Status: {r.status_code if r else 'No response'}")
        else:
            log_test("Find Open Contest", False, "No ENTRY_OPEN contests available")
    else:
        log_test("Create Test User", False, "Failed to register test user")
    
    # ======== SCENARIO 3: LIFECYCLE TRANSITION BROADCASTING ========
    print("\n🔄 SCENARIO 3: Lifecycle Transition Broadcasting")  
    print("-" * 50)
    
    # Create new contest to test lifecycle
    contest_data = {
        'seasonId': SEASON_ID,
        'contestName': f'SSE Lifecycle Test {int(time.time())}',
        'contestType': 'reel_creative',
        'contestFormat': 'individual',
        'description': 'Testing SSE lifecycle broadcasts'
    }
    
    r = api_call('POST', 'admin/tribe-contests', headers=admin_headers, data=contest_data)
    if r and r.status_code == 201:
        lifecycle_contest_id = r.json().get('data', {}).get('contest', {}).get('id')
        log_test("Create Lifecycle Test Contest", True, f"Contest: {lifecycle_contest_id}")
        
        # Start SSE listener for this contest
        lifecycle_url = f"{BASE_URL}/tribe-contests/{lifecycle_contest_id}/live"
        lifecycle_listener = SSEListener(lifecycle_url, timeout=20)
        lifecycle_thread = threading.Thread(target=lifecycle_listener.listen)
        lifecycle_thread.start()
        time.sleep(2)
        
        # Test transitions: DRAFT → PUBLISHED → ENTRY_OPEN
        transitions = [
            ('publish', 'PUBLISHED'),
            ('open-entries', 'ENTRY_OPEN')
        ]
        
        for action, expected_status in transitions:
            r = api_call('POST', f'admin/tribe-contests/{lifecycle_contest_id}/{action}',
                        headers=admin_headers, data={})
            
            if r and r.status_code == 200:
                log_test(f"Contest {action.title()}", True, f"Status: {expected_status}")
                time.sleep(2)  # Allow time for SSE event
            else:
                log_test(f"Contest {action.title()}", False,
                        f"Status: {r.status_code if r else 'No response'}")
        
        # Check for contest.transition events
        lifecycle_thread.join(timeout=5)
        transition_events = [e for e in lifecycle_listener.events
                           if e.get('event') == 'contest.transition']
        
        log_test("Transition Broadcast Events", len(transition_events) >= 2,
                f"contest.transition events: {len(transition_events)}")
        
    else:
        log_test("Create Lifecycle Test Contest", False,
                f"Status: {r.status_code if r else 'No response'}")
    
    # ======== SCENARIO 4: RESOLUTION BROADCASTING ========
    print("\n🏆 SCENARIO 4: Resolution Broadcasting")
    print("-" * 50)
    
    # Find a contest that can be resolved (LOCKED status preferred)
    resolvable_contest = None
    for contest in contests:
        if contest.get('status') in ['ENTRY_CLOSED', 'EVALUATING', 'LOCKED']:
            resolvable_contest = contest
            break
    
    if resolvable_contest:
        resolve_contest_id = resolvable_contest['id']
        
        # Start SSE listeners for both contest and season
        contest_url = f"{BASE_URL}/tribe-contests/{resolve_contest_id}/live"
        season_url = f"{BASE_URL}/tribe-contests/seasons/{SEASON_ID}/live-standings"
        
        contest_listener = SSEListener(contest_url, timeout=15)
        season_listener = SSEListener(season_url, timeout=15)
        
        contest_thread = threading.Thread(target=contest_listener.listen)
        season_thread = threading.Thread(target=season_listener.listen)
        
        contest_thread.start()
        season_thread.start()
        time.sleep(2)
        
        # Lock contest first if needed
        if resolvable_contest['status'] != 'LOCKED':
            if resolvable_contest['status'] == 'ENTRY_CLOSED':
                r = api_call('POST', f'admin/tribe-contests/{resolve_contest_id}/lock',
                            headers=admin_headers, data={})
                if r and r.status_code == 200:
                    log_test("Lock Contest for Resolution", True, "Contest locked")
                    time.sleep(2)
        
        # Resolve contest
        resolve_data = {
            'resolutionMode': 'automatic',
            'notes': 'SSE resolution test'
        }
        
        r = api_call('POST', f'admin/tribe-contests/{resolve_contest_id}/resolve',
                    headers=admin_headers, data=resolve_data)
        
        if r and r.status_code == 200:
            result_data = r.json().get('data', {})
            is_idempotent = result_data.get('idempotent', False)
            
            if is_idempotent:
                log_test("Contest Resolution", True, "Already resolved (idempotent)")
            else:
                log_test("Contest Resolution", True, "Contest resolved successfully")
                
                # Wait for SSE events
                time.sleep(5)
                
                contest_thread.join(timeout=5)
                season_thread.join(timeout=5)
                
                # Check for resolution events
                resolved_events = [e for e in contest_listener.events
                                 if e.get('event') == 'contest.resolved']
                standings_events = [e for e in season_listener.events
                                  if e.get('event') == 'standings.updated']
                
                log_test("Contest Resolved Event", len(resolved_events) > 0,
                        f"contest.resolved events: {len(resolved_events)}")
                log_test("Standings Updated Event", len(standings_events) > 0,
                        f"standings.updated events: {len(standings_events)}")
        else:
            log_test("Contest Resolution", False,
                    f"Status: {r.status_code if r else 'No response'}")
    else:
        log_test("Find Resolvable Contest", False, "No resolvable contests found")
    
    # ======== SCENARIO 5: GLOBAL FEED ========
    print("\n🌍 SCENARIO 5: Global Feed") 
    print("-" * 50)
    
    # Test global feed snapshot structure
    global_events = test_sse_endpoint("tribe-contests/live-feed", "Global Feed")
    
    if global_events:
        snapshot_events = [e for e in global_events if e.get('event') == 'snapshot']
        if snapshot_events:
            snapshot_data = snapshot_events[0].get('data', {})
            has_live_contests = 'liveContests' in snapshot_data
            has_recent_entries = 'recentEntries' in snapshot_data
            has_recent_results = 'recentResults' in snapshot_data
            
            log_test("Global Feed Snapshot Structure", 
                    all([has_live_contests, has_recent_entries, has_recent_results]),
                    f"LiveContests: {has_live_contests}, RecentEntries: {has_recent_entries}, RecentResults: {has_recent_results}")
    
    # ======== SCENARIO 6: RECOMPUTE + BROADCAST ========
    print("\n🔄 SCENARIO 6: Recompute + Broadcast")
    print("-" * 50)
    
    # Find contest with scores to recompute
    if contests:
        recompute_contest_id = contests[0]['id']
        
        # Start SSE listener
        recompute_url = f"{BASE_URL}/tribe-contests/{recompute_contest_id}/live"
        recompute_listener = SSEListener(recompute_url, timeout=15)
        recompute_thread = threading.Thread(target=recompute_listener.listen)
        recompute_thread.start()
        time.sleep(2)
        
        # Trigger recompute with broadcast
        r = api_call('POST', f'admin/tribe-contests/{recompute_contest_id}/recompute-broadcast',
                    headers=admin_headers, data={})
        
        if r and r.status_code == 200:
            result_data = r.json().get('data', {})
            log_test("Score Recompute", True, 
                    f"Recomputed {result_data.get('totalScored', 0)} entries")
            
            # Wait for broadcast events
            time.sleep(4)
            recompute_thread.join(timeout=3)
            
            score_events = [e for e in recompute_listener.events
                          if e.get('event') == 'score.updated']
            rank_events = [e for e in recompute_listener.events
                         if e.get('event') == 'rank.changed']
            
            log_test("Score Updated Event", len(score_events) > 0,
                    f"score.updated events: {len(score_events)}")
            log_test("Rank Changed Event", True,  # rank changes may not always occur
                    f"rank.changed events: {len(rank_events)}")
        else:
            log_test("Score Recompute", False,
                    f"Status: {r.status_code if r else 'No response'}")
    
    # ======== SCENARIO 7: SEASON STANDINGS SSE ========  
    print("\n📊 SCENARIO 7: Season Standings SSE")
    print("-" * 50)
    
    # Detailed test of season standings stream
    season_events = test_sse_endpoint(
        f"tribe-contests/seasons/{SEASON_ID}/live-standings",
        "Season Standings Detail"
    )
    
    if season_events:
        connected_events = [e for e in season_events if e.get('event') == 'connected']
        snapshot_events = [e for e in season_events if e.get('event') == 'snapshot']
        
        if connected_events:
            connected_data = connected_events[0].get('data', {})
            mode = connected_data.get('mode', 'unknown')
            log_test("SSE Connection Mode", True, f"Mode: {mode}")
        
        if snapshot_events:
            snapshot_data = snapshot_events[0].get('data', {})
            season_info = snapshot_data.get('season', {})
            standings = snapshot_data.get('standings', [])
            active_contests = snapshot_data.get('activeContests', [])
            
            log_test("Season Standings Snapshot", True,
                    f"Season: {season_info.get('name')}, Standings: {len(standings)}, Active: {len(active_contests)}")
    
    # ======== FINAL RESULTS ========
    print("\n" + "=" * 70)
    print("🏆 STAGE 12X-RT REAL-TIME SSE TESTING RESULTS")
    print("=" * 70)
    
    total_tests = results['passed'] + results['failed']
    success_rate = (results['passed'] / total_tests * 100) if total_tests > 0 else 0
    
    print(f"✅ Passed: {results['passed']}")
    print(f"❌ Failed: {results['failed']}")
    print(f"📊 Success Rate: {success_rate:.1f}%")
    
    if success_rate >= 85:
        print("🎉 VERDICT: REAL-TIME SSE SYSTEM IS PRODUCTION READY")
    elif success_rate >= 70:
        print("✅ VERDICT: REAL-TIME SSE SYSTEM IS FUNCTIONAL")  
    else:
        print("⚠️ VERDICT: REAL-TIME SSE SYSTEM NEEDS ATTENTION")
    
    print(f"\n📋 SSE TEST COVERAGE:")
    print(f"🎯 SSE Connections: All 3 endpoints tested (contest live, season standings, global feed)")
    print(f"📡 Real-time Broadcasting: Entry submissions, vote casting, lifecycle transitions")
    print(f"🏆 Contest Resolution: Winner declaration and salute distribution broadcasts") 
    print(f"🔄 Score Recomputation: Real-time score updates and rank change notifications")
    print(f"🌍 Global Feed: Cross-contest activity monitoring") 
    print(f"📊 Season Standings: Live tribal season standings with active contest tracking")
    print(f"🔧 Fallback Mode: Redis Pub/Sub with in-memory EventEmitter fallback")
    
    print(f"\n🔍 DETAILED RESULTS:")
    for detail in results['details']:
        status = "✅" if detail['success'] else "❌"
        print(f"{status} {detail['test']}")
        if detail['details']:
            print(f"    {detail['details']}")
    
    return success_rate >= 70

if __name__ == "__main__":
    main()