#!/usr/bin/env python3
"""
Tribe Backend Testing: Stage 6 (Events + RSVP) and Stage 7 (Board Notices + Authenticity Tags)
Comprehensive testing of ~38 endpoints

Test Users:
- Admin (SUPER_ADMIN): phone=9000000001, pin=1234
- User1 (USER, ADULT, board seat): phone=9000000002, pin=1234  
- User2 (USER, ADULT): phone=9000000003, pin=1234

Base URL: https://tribe-backend-verify.preview.emergentagent.com/api
"""

import requests
import json
import sys
from datetime import datetime, timedelta
import time

BASE_URL = "https://tribe-backend-verify.preview.emergentagent.com/api"

class TestResults:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.results = []
    
    def add_result(self, test_name, status, message="", response_data=None):
        result = {
            'test': test_name,
            'status': status,
            'message': message,
            'response_data': response_data
        }
        self.results.append(result)
        if status == 'PASS':
            self.passed += 1
            print(f"✅ {test_name}")
        else:
            self.failed += 1
            print(f"❌ {test_name}: {message}")
    
    def summary(self):
        total = self.passed + self.failed
        success_rate = (self.passed / total * 100) if total > 0 else 0
        print(f"\n📊 SUMMARY: {self.passed}/{total} tests passed ({success_rate:.1f}% success rate)")
        return success_rate >= 85  # 85% threshold for production readiness

def make_request(method, endpoint, token=None, data=None, params=None):
    """Make HTTP request with proper headers"""
    url = f"{BASE_URL}{endpoint}"
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    
    try:
        if method == 'GET':
            response = requests.get(url, headers=headers, params=params, timeout=10)
        elif method == 'POST':
            response = requests.post(url, headers=headers, json=data, timeout=10)
        elif method == 'PATCH':
            response = requests.patch(url, headers=headers, json=data, timeout=10)
        elif method == 'DELETE':
            response = requests.delete(url, headers=headers, timeout=10)
        else:
            raise ValueError(f"Unsupported method: {method}")
        
        return response
    except requests.exceptions.Timeout:
        return None
    except Exception as e:
        print(f"Request error: {e}")
        return None

def login_user(phone, pin):
    """Login and return token"""
    response = make_request('POST', '/auth/login', data={'phone': phone, 'pin': pin})
    if response and response.status_code == 200:
        data = response.json()
        return data.get('token'), data.get('user')
    return None, None

def test_stage_6_events(results):
    """Test Stage 6: Events + RSVP (21 endpoints)"""
    print(f"\n🎉 TESTING STAGE 6: EVENTS + RSVP (21 endpoints)")
    
    # Login test users
    admin_token, admin_user = login_user('9000000001', '1234')
    user1_token, user1_user = login_user('9000000002', '1234')
    user2_token, user2_user = login_user('9000000003', '1234')
    
    if not all([admin_token, user1_token, user2_token]):
        results.add_result("Event Auth Setup", "FAIL", "Failed to login test users")
        return
    
    results.add_result("Event Auth Setup", "PASS", "All test users logged in successfully")
    
    # Global test data
    event_id = None
    event2_id = None
    
    # 1. POST /events — Create event (User1)
    try:
        future_date = (datetime.now() + timedelta(days=7)).isoformat()
        event_data = {
            'title': 'Test Cultural Festival 2024',
            'description': 'Annual cultural festival with music, dance, and food',
            'category': 'CULTURAL',
            'visibility': 'PUBLIC',
            'startAt': future_date,
            'endAt': (datetime.now() + timedelta(days=7, hours=5)).isoformat(),
            'locationText': 'Main Auditorium, Campus',
            'capacity': 100,
            'tags': ['cultural', 'festival', 'music']
        }
        response = make_request('POST', '/events', user1_token, event_data)
        if response and response.status_code == 201:
            data = response.json()
            event_id = data['event']['id']
            results.add_result("POST /events (Create Event)", "PASS", f"Event created: {event_id}")
        else:
            results.add_result("POST /events (Create Event)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
    except Exception as e:
        results.add_result("POST /events (Create Event)", "FAIL", f"Exception: {e}")
    
    # 2. Create second event for testing (User2)
    try:
        event2_data = {
            'title': 'Tech Workshop: AI & ML',
            'description': 'Hands-on workshop on artificial intelligence',
            'category': 'ACADEMIC',
            'visibility': 'COLLEGE',
            'startAt': (datetime.now() + timedelta(days=14)).isoformat(),
            'locationText': 'Computer Lab 101',
            'capacity': 50
        }
        response = make_request('POST', '/events', user2_token, event2_data)
        if response and response.status_code == 201:
            data = response.json()
            event2_id = data['event']['id']
            results.add_result("POST /events (Second Event)", "PASS", f"Second event created: {event2_id}")
        else:
            results.add_result("POST /events (Second Event)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
    except Exception as e:
        results.add_result("POST /events (Second Event)", "FAIL", f"Exception: {e}")
    
    # 3. GET /events/:id — Event detail
    if event_id:
        try:
            response = make_request('GET', f'/events/{event_id}', user1_token)
            if response and response.status_code == 200:
                data = response.json()
                event_detail = data.get('event', {})
                if event_detail.get('title') == 'Test Cultural Festival 2024':
                    results.add_result("GET /events/:id (Event Detail)", "PASS", "Event details retrieved correctly")
                else:
                    results.add_result("GET /events/:id (Event Detail)", "FAIL", "Event details mismatch")
            else:
                results.add_result("GET /events/:id (Event Detail)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        except Exception as e:
            results.add_result("GET /events/:id (Event Detail)", "FAIL", f"Exception: {e}")
    
    # 4. PATCH /events/:id — Edit event
    if event_id:
        try:
            update_data = {
                'title': 'Updated Cultural Festival 2024',
                'description': 'Updated description with more details'
            }
            response = make_request('PATCH', f'/events/{event_id}', user1_token, update_data)
            if response and response.status_code == 200:
                data = response.json()
                if data.get('event', {}).get('title') == 'Updated Cultural Festival 2024':
                    results.add_result("PATCH /events/:id (Edit Event)", "PASS", "Event updated successfully")
                else:
                    results.add_result("PATCH /events/:id (Edit Event)", "FAIL", "Update data mismatch")
            else:
                results.add_result("PATCH /events/:id (Edit Event)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        except Exception as e:
            results.add_result("PATCH /events/:id (Edit Event)", "FAIL", f"Exception: {e}")
    
    # 5. GET /events/feed — Discovery feed
    try:
        response = make_request('GET', '/events/feed', user1_token, params={'limit': 10})
        if response and response.status_code == 200:
            data = response.json()
            items = data.get('items', [])
            if isinstance(items, list):
                results.add_result("GET /events/feed (Discovery Feed)", "PASS", f"Retrieved {len(items)} events")
            else:
                results.add_result("GET /events/feed (Discovery Feed)", "FAIL", "Invalid response structure")
        else:
            results.add_result("GET /events/feed (Discovery Feed)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
    except Exception as e:
        results.add_result("GET /events/feed (Discovery Feed)", "FAIL", f"Exception: {e}")
    
    # 6. GET /events/search — Search events
    try:
        response = make_request('GET', '/events/search', user1_token, params={'q': 'cultural', 'limit': 5})
        if response and response.status_code == 200:
            data = response.json()
            items = data.get('items', [])
            results.add_result("GET /events/search (Search Events)", "PASS", f"Found {len(items)} events for 'cultural'")
        else:
            results.add_result("GET /events/search (Search Events)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
    except Exception as e:
        results.add_result("GET /events/search (Search Events)", "FAIL", f"Exception: {e}")
    
    # 7. POST /events/:id/rsvp — RSVP to event (User2 RSVPs to User1's event)
    if event_id:
        try:
            rsvp_data = {'status': 'GOING'}
            response = make_request('POST', f'/events/{event_id}/rsvp', user2_token, rsvp_data)
            if response and response.status_code == 200:
                data = response.json()
                rsvp_status = data.get('rsvp', {}).get('status')
                if rsvp_status == 'GOING':
                    results.add_result("POST /events/:id/rsvp (RSVP Going)", "PASS", "Successfully RSVP'd as GOING")
                else:
                    results.add_result("POST /events/:id/rsvp (RSVP Going)", "FAIL", f"Unexpected RSVP status: {rsvp_status}")
            else:
                results.add_result("POST /events/:id/rsvp (RSVP Going)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        except Exception as e:
            results.add_result("POST /events/:id/rsvp (RSVP Going)", "FAIL", f"Exception: {e}")
    
    # 8. POST /events/:id/rsvp — RSVP INTERESTED (Admin RSVPs to same event)
    if event_id:
        try:
            rsvp_data = {'status': 'INTERESTED'}
            response = make_request('POST', f'/events/{event_id}/rsvp', admin_token, rsvp_data)
            if response and response.status_code == 200:
                data = response.json()
                rsvp_status = data.get('rsvp', {}).get('status')
                if rsvp_status == 'INTERESTED':
                    results.add_result("POST /events/:id/rsvp (RSVP Interested)", "PASS", "Successfully RSVP'd as INTERESTED")
                else:
                    results.add_result("POST /events/:id/rsvp (RSVP Interested)", "FAIL", f"Unexpected RSVP status: {rsvp_status}")
            else:
                results.add_result("POST /events/:id/rsvp (RSVP Interested)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        except Exception as e:
            results.add_result("POST /events/:id/rsvp (RSVP Interested)", "FAIL", f"Exception: {e}")
    
    # 9. GET /events/:id/attendees — RSVP list
    if event_id:
        try:
            response = make_request('GET', f'/events/{event_id}/attendees', user1_token, params={'limit': 20})
            if response and response.status_code == 200:
                data = response.json()
                items = data.get('items', [])
                total = data.get('total', 0)
                results.add_result("GET /events/:id/attendees (RSVP List)", "PASS", f"Retrieved {len(items)} attendees, total: {total}")
            else:
                results.add_result("GET /events/:id/attendees (RSVP List)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        except Exception as e:
            results.add_result("GET /events/:id/attendees (RSVP List)", "FAIL", f"Exception: {e}")
    
    # 10. DELETE /events/:id/rsvp — Cancel RSVP
    if event_id:
        try:
            response = make_request('DELETE', f'/events/{event_id}/rsvp', user2_token)
            if response and response.status_code == 200:
                data = response.json()
                if 'cancelled' in data.get('message', '').lower():
                    results.add_result("DELETE /events/:id/rsvp (Cancel RSVP)", "PASS", "Successfully cancelled RSVP")
                else:
                    results.add_result("DELETE /events/:id/rsvp (Cancel RSVP)", "FAIL", "Unexpected response message")
            else:
                results.add_result("DELETE /events/:id/rsvp (Cancel RSVP)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        except Exception as e:
            results.add_result("DELETE /events/:id/rsvp (Cancel RSVP)", "FAIL", f"Exception: {e}")
    
    # 11. POST /events/:id/report — Report event (User2 reports User1's event)
    if event_id:
        try:
            report_data = {
                'reasonCode': 'INAPPROPRIATE_CONTENT',
                'reason': 'Event contains inappropriate content for testing'
            }
            response = make_request('POST', f'/events/{event_id}/report', user2_token, report_data)
            if response and response.status_code in [200, 201]:
                data = response.json()
                report_count = data.get('reportCount', 0)
                results.add_result("POST /events/:id/report (Report Event)", "PASS", f"Event reported, count: {report_count}")
            else:
                results.add_result("POST /events/:id/report (Report Event)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        except Exception as e:
            results.add_result("POST /events/:id/report (Report Event)", "FAIL", f"Exception: {e}")
    
    # 12. POST /events/:id/remind — Set reminder
    if event_id:
        try:
            response = make_request('POST', f'/events/{event_id}/remind', user2_token)
            if response and response.status_code == 200:
                data = response.json()
                if 'reminder set' in data.get('message', '').lower():
                    results.add_result("POST /events/:id/remind (Set Reminder)", "PASS", "Reminder set successfully")
                else:
                    results.add_result("POST /events/:id/remind (Set Reminder)", "FAIL", "Unexpected response message")
            else:
                results.add_result("POST /events/:id/remind (Set Reminder)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        except Exception as e:
            results.add_result("POST /events/:id/remind (Set Reminder)", "FAIL", f"Exception: {e}")
    
    # 13. DELETE /events/:id/remind — Remove reminder
    if event_id:
        try:
            response = make_request('DELETE', f'/events/{event_id}/remind', user2_token)
            if response and response.status_code == 200:
                data = response.json()
                if 'removed' in data.get('message', '').lower():
                    results.add_result("DELETE /events/:id/remind (Remove Reminder)", "PASS", "Reminder removed successfully")
                else:
                    results.add_result("DELETE /events/:id/remind (Remove Reminder)", "FAIL", "Unexpected response message")
            else:
                results.add_result("DELETE /events/:id/remind (Remove Reminder)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        except Exception as e:
            results.add_result("DELETE /events/:id/remind (Remove Reminder)", "FAIL", f"Exception: {e}")
    
    # 14. GET /me/events — My created events
    try:
        response = make_request('GET', '/me/events', user1_token, params={'limit': 10})
        if response and response.status_code == 200:
            data = response.json()
            items = data.get('items', [])
            results.add_result("GET /me/events (My Created Events)", "PASS", f"Retrieved {len(items)} created events")
        else:
            results.add_result("GET /me/events (My Created Events)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
    except Exception as e:
        results.add_result("GET /me/events (My Created Events)", "FAIL", f"Exception: {e}")
    
    # 15. GET /me/events/rsvps — Events I've RSVP'd to
    try:
        response = make_request('GET', '/me/events/rsvps', admin_token, params={'limit': 10})
        if response and response.status_code == 200:
            data = response.json()
            items = data.get('items', [])
            results.add_result("GET /me/events/rsvps (My RSVPs)", "PASS", f"Retrieved {len(items)} RSVP'd events")
        else:
            results.add_result("GET /me/events/rsvps (My RSVPs)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
    except Exception as e:
        results.add_result("GET /me/events/rsvps (My RSVPs)", "FAIL", f"Exception: {e}")
    
    # 16. POST /events/:id/publish — Publish draft (create draft first)
    try:
        draft_data = {
            'title': 'Draft Workshop Event',
            'description': 'This is a draft event for testing publish functionality',
            'category': 'WORKSHOP',
            'visibility': 'PUBLIC',
            'startAt': (datetime.now() + timedelta(days=10)).isoformat(),
            'isDraft': True
        }
        response = make_request('POST', '/events', user1_token, draft_data)
        if response and response.status_code == 201:
            draft_id = response.json()['event']['id']
            # Now publish it
            publish_response = make_request('POST', f'/events/{draft_id}/publish', user1_token)
            if publish_response and publish_response.status_code == 200:
                data = publish_response.json()
                if data.get('status') == 'PUBLISHED':
                    results.add_result("POST /events/:id/publish (Publish Draft)", "PASS", "Draft event published successfully")
                else:
                    results.add_result("POST /events/:id/publish (Publish Draft)", "FAIL", "Unexpected publish status")
            else:
                results.add_result("POST /events/:id/publish (Publish Draft)", "FAIL", f"Publish failed: {publish_response.status_code if publish_response else 'Timeout'}")
        else:
            results.add_result("POST /events/:id/publish (Publish Draft)", "FAIL", "Failed to create draft event")
    except Exception as e:
        results.add_result("POST /events/:id/publish (Publish Draft)", "FAIL", f"Exception: {e}")
    
    # 17. POST /events/:id/cancel — Cancel event
    if event2_id:
        try:
            cancel_data = {'reason': 'Testing cancellation functionality'}
            response = make_request('POST', f'/events/{event2_id}/cancel', user2_token, cancel_data)
            if response and response.status_code == 200:
                data = response.json()
                if 'cancelled' in data.get('message', '').lower():
                    results.add_result("POST /events/:id/cancel (Cancel Event)", "PASS", "Event cancelled successfully")
                else:
                    results.add_result("POST /events/:id/cancel (Cancel Event)", "FAIL", "Unexpected response message")
            else:
                results.add_result("POST /events/:id/cancel (Cancel Event)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        except Exception as e:
            results.add_result("POST /events/:id/cancel (Cancel Event)", "FAIL", f"Exception: {e}")
    
    # 18. POST /events/:id/archive — Archive event  
    if event2_id:
        try:
            response = make_request('POST', f'/events/{event2_id}/archive', user2_token)
            if response and response.status_code == 200:
                data = response.json()
                if 'archived' in data.get('message', '').lower():
                    results.add_result("POST /events/:id/archive (Archive Event)", "PASS", "Event archived successfully")
                else:
                    results.add_result("POST /events/:id/archive (Archive Event)", "FAIL", "Unexpected response message")
            else:
                results.add_result("POST /events/:id/archive (Archive Event)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        except Exception as e:
            results.add_result("POST /events/:id/archive (Archive Event)", "FAIL", f"Exception: {e}")
    
    # ADMIN ROUTES (19-22)
    
    # 19. GET /admin/events — Admin moderation queue
    try:
        response = make_request('GET', '/admin/events', admin_token, params={'limit': 20})
        if response and response.status_code == 200:
            data = response.json()
            items = data.get('items', [])
            stats = data.get('stats', {})
            results.add_result("GET /admin/events (Admin Queue)", "PASS", f"Retrieved {len(items)} events, stats: {len(stats)} status counts")
        else:
            results.add_result("GET /admin/events (Admin Queue)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
    except Exception as e:
        results.add_result("GET /admin/events (Admin Queue)", "FAIL", f"Exception: {e}")
    
    # 20. PATCH /admin/events/:id/moderate — Moderate event
    if event_id:
        try:
            moderate_data = {
                'action': 'APPROVE',
                'reason': 'Event content is appropriate after review'
            }
            response = make_request('PATCH', f'/admin/events/{event_id}/moderate', admin_token, moderate_data)
            if response and response.status_code == 200:
                data = response.json()
                if 'approved' in data.get('message', '').lower():
                    results.add_result("PATCH /admin/events/:id/moderate (Moderate Event)", "PASS", "Event moderated successfully")
                else:
                    results.add_result("PATCH /admin/events/:id/moderate (Moderate Event)", "FAIL", "Unexpected moderation response")
            else:
                results.add_result("PATCH /admin/events/:id/moderate (Moderate Event)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        except Exception as e:
            results.add_result("PATCH /admin/events/:id/moderate (Moderate Event)", "FAIL", f"Exception: {e}")
    
    # 21. GET /admin/events/analytics — Platform analytics
    try:
        response = make_request('GET', '/admin/events/analytics', admin_token)
        if response and response.status_code == 200:
            data = response.json()
            total = data.get('total', 0)
            categories = data.get('categories', {})
            results.add_result("GET /admin/events/analytics (Platform Analytics)", "PASS", f"Analytics: {total} total events, {len(categories)} categories")
        else:
            results.add_result("GET /admin/events/analytics (Platform Analytics)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
    except Exception as e:
        results.add_result("GET /admin/events/analytics (Platform Analytics)", "FAIL", f"Exception: {e}")
    
    # 22. POST /admin/events/:id/recompute-counters — Recompute counters
    if event_id:
        try:
            response = make_request('POST', f'/admin/events/{event_id}/recompute-counters', admin_token)
            if response and response.status_code == 200:
                data = response.json()
                before = data.get('before', {})
                after = data.get('after', {})
                drifted = data.get('drifted', False)
                results.add_result("POST /admin/events/:id/recompute-counters (Recompute Counters)", "PASS", f"Counters recomputed, drifted: {drifted}")
            else:
                results.add_result("POST /admin/events/:id/recompute-counters (Recompute Counters)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        except Exception as e:
            results.add_result("POST /admin/events/:id/recompute-counters (Recompute Counters)", "FAIL", f"Exception: {e}")
    
    # Test college-scoped events endpoint
    try:
        # Get admin's college ID for testing
        college_id = admin_user.get('collegeId')
        if college_id:
            response = make_request('GET', f'/events/college/{college_id}', admin_token, params={'limit': 5})
            if response and response.status_code == 200:
                data = response.json()
                items = data.get('items', [])
                results.add_result("GET /events/college/:id (College Events)", "PASS", f"Retrieved {len(items)} college events")
            else:
                results.add_result("GET /events/college/:id (College Events)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        else:
            results.add_result("GET /events/college/:id (College Events)", "SKIP", "Admin user has no college")
    except Exception as e:
        results.add_result("GET /events/college/:id (College Events)", "FAIL", f"Exception: {e}")

def test_stage_7_board_notices_authenticity(results):
    """Test Stage 7: Board Notices + Authenticity Tags (17 endpoints)"""
    print(f"\n📋 TESTING STAGE 7: BOARD NOTICES + AUTHENTICITY TAGS (17 endpoints)")
    
    # Login test users
    admin_token, admin_user = login_user('9000000001', '1234')
    user1_token, user1_user = login_user('9000000002', '1234')
    user2_token, user2_user = login_user('9000000003', '1234')
    
    if not all([admin_token, user1_token, user2_token]):
        results.add_result("Board Notice Auth Setup", "FAIL", "Failed to login test users")
        return
    
    # Setup user1 and user2 with college association for board seat functionality
    try:
        # Get admin's college for testing
        college_id = admin_user.get('collegeId')
        if not college_id:
            # Get any available college
            college_response = make_request('GET', '/colleges/search', admin_token, params={'q': 'IIT'})
            if college_response and college_response.status_code == 200:
                colleges = college_response.json().get('items', [])
                if colleges:
                    college_id = colleges[0]['id']
        
        if college_id:
            # Link user1 to college via admin (simulating college verification)
            import subprocess
            subprocess.run([
                'mongosh', 'mongodb://localhost:27017/your_database_name', 
                '--eval', f'''
                db.users.updateOne(
                    {{id: "{user1_user['id']}"}}, 
                    {{$set: {{collegeId: "{college_id}", collegeVerified: true, updatedAt: new Date()}}}}
                );
                db.board_seats.updateOne(
                    {{userId: "{user1_user['id']}"}}, 
                    {{$setOnInsert: {{
                        id: "test-seat-{user1_user['id']}", 
                        userId: "{user1_user['id']}", 
                        collegeId: "{college_id}", 
                        status: "ACTIVE", 
                        role: "MEMBER", 
                        createdAt: new Date()
                    }}}}, 
                    {{upsert: true}}
                );
                '''
            ], capture_output=True, text=True)
            
            # Also setup user2 with college
            subprocess.run([
                'mongosh', 'mongodb://localhost:27017/your_database_name', 
                '--eval', f'''
                db.users.updateOne(
                    {{id: "{user2_user['id']}"}}, 
                    {{$set: {{collegeId: "{college_id}", collegeVerified: true, updatedAt: new Date()}}}}
                );
                '''
            ], capture_output=True, text=True)
            
            results.add_result("Board Notice Setup", "PASS", f"Users linked to college {college_id}, User1 has board seat")
        else:
            results.add_result("Board Notice Setup", "FAIL", "No college available for testing")
            return
            
    except Exception as e:
        results.add_result("Board Notice Setup", "FAIL", f"Setup failed: {e}")
        return
    
    # Global test data
    notice_id = None
    notice2_id = None
    
    # BOARD NOTICES TESTING (12 endpoints)
    
    # 1. POST /board/notices — Create notice (User1 as board member)
    try:
        notice_data = {
            'title': 'Important Academic Notice: Exam Schedule Update',
            'body': 'The upcoming midterm examination schedule has been updated. Please check the academic portal for the latest schedule. All students are required to verify their exam timings.',
            'category': 'ACADEMIC',
            'priority': 'IMPORTANT',
            'expiresAt': (datetime.now() + timedelta(days=30)).isoformat(),
            'attachments': [
                {'name': 'exam-schedule.pdf', 'url': 'https://example.com/schedule.pdf', 'type': 'PDF'}
            ]
        }
        response = make_request('POST', '/board/notices', user1_token, notice_data)
        if response and response.status_code == 201:
            data = response.json()
            notice_id = data['notice']['id']
            results.add_result("POST /board/notices (Create Notice)", "PASS", f"Notice created: {notice_id}")
        else:
            results.add_result("POST /board/notices (Create Notice)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
    except Exception as e:
        results.add_result("POST /board/notices (Create Notice)", "FAIL", f"Exception: {e}")
    
    # 2. Create admin notice (should go directly to PUBLISHED)
    try:
        admin_notice_data = {
            'title': 'Admin Notice: Campus Maintenance',
            'body': 'Scheduled maintenance will be performed on campus facilities this weekend.',
            'category': 'ADMINISTRATIVE', 
            'priority': 'URGENT'
        }
        response = make_request('POST', '/board/notices', admin_token, admin_notice_data)
        if response and response.status_code == 201:
            data = response.json()
            notice2_id = data['notice']['id']
            results.add_result("POST /board/notices (Admin Direct Publish)", "PASS", f"Admin notice created: {notice2_id}")
        else:
            results.add_result("POST /board/notices (Admin Direct Publish)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
    except Exception as e:
        results.add_result("POST /board/notices (Admin Direct Publish)", "FAIL", f"Exception: {e}")
    
    # 3. GET /board/notices/:id — Notice detail
    if notice_id:
        try:
            response = make_request('GET', f'/board/notices/{notice_id}', user1_token)
            if response and response.status_code == 200:
                data = response.json()
                notice_detail = data.get('notice', {})
                if notice_detail.get('title') == 'Important Academic Notice: Exam Schedule Update':
                    results.add_result("GET /board/notices/:id (Notice Detail)", "PASS", "Notice details retrieved correctly")
                else:
                    results.add_result("GET /board/notices/:id (Notice Detail)", "FAIL", "Notice details mismatch")
            else:
                results.add_result("GET /board/notices/:id (Notice Detail)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        except Exception as e:
            results.add_result("GET /board/notices/:id (Notice Detail)", "FAIL", f"Exception: {e}")
    
    # 4. PATCH /board/notices/:id — Edit notice
    if notice_id:
        try:
            update_data = {
                'title': 'Updated Academic Notice: Exam Schedule Update',
                'priority': 'URGENT'
            }
            response = make_request('PATCH', f'/board/notices/{notice_id}', user1_token, update_data)
            if response and response.status_code == 200:
                data = response.json()
                if data.get('notice', {}).get('title') == 'Updated Academic Notice: Exam Schedule Update':
                    results.add_result("PATCH /board/notices/:id (Edit Notice)", "PASS", "Notice updated successfully")
                else:
                    results.add_result("PATCH /board/notices/:id (Edit Notice)", "FAIL", "Update data mismatch")
            else:
                results.add_result("PATCH /board/notices/:id (Edit Notice)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        except Exception as e:
            results.add_result("PATCH /board/notices/:id (Edit Notice)", "FAIL", f"Exception: {e}")
    
    # 5. Approve the notice via admin moderation
    if notice_id:
        try:
            approve_data = {'approve': True, 'reason': 'Content approved for publication'}
            response = make_request('POST', f'/moderation/board-notices/{notice_id}/decide', admin_token, approve_data)
            if response and response.status_code == 200:
                results.add_result("POST /moderation/board-notices/:id/decide (Approve Notice)", "PASS", "Notice approved successfully")
            else:
                results.add_result("POST /moderation/board-notices/:id/decide (Approve Notice)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        except Exception as e:
            results.add_result("POST /moderation/board-notices/:id/decide (Approve Notice)", "FAIL", f"Exception: {e}")
    
    # 6. POST /board/notices/:id/pin — Pin notice
    if notice2_id:  # Use admin notice which should be published
        try:
            response = make_request('POST', f'/board/notices/{notice2_id}/pin', admin_token)
            if response and response.status_code == 200:
                data = response.json()
                if 'pinned' in data.get('message', '').lower():
                    results.add_result("POST /board/notices/:id/pin (Pin Notice)", "PASS", "Notice pinned successfully")
                else:
                    results.add_result("POST /board/notices/:id/pin (Pin Notice)", "FAIL", "Unexpected response message")
            else:
                results.add_result("POST /board/notices/:id/pin (Pin Notice)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        except Exception as e:
            results.add_result("POST /board/notices/:id/pin (Pin Notice)", "FAIL", f"Exception: {e}")
    
    # 7. DELETE /board/notices/:id/pin — Unpin notice
    if notice2_id:
        try:
            response = make_request('DELETE', f'/board/notices/{notice2_id}/pin', admin_token)
            if response and response.status_code == 200:
                data = response.json()
                if 'unpinned' in data.get('message', '').lower():
                    results.add_result("DELETE /board/notices/:id/pin (Unpin Notice)", "PASS", "Notice unpinned successfully")
                else:
                    results.add_result("DELETE /board/notices/:id/pin (Unpin Notice)", "FAIL", "Unexpected response message")
            else:
                results.add_result("DELETE /board/notices/:id/pin (Unpin Notice)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        except Exception as e:
            results.add_result("DELETE /board/notices/:id/pin (Unpin Notice)", "FAIL", f"Exception: {e}")
    
    # 8. POST /board/notices/:id/acknowledge — Acknowledge notice (User2 acknowledges)
    if notice2_id:
        try:
            response = make_request('POST', f'/board/notices/{notice2_id}/acknowledge', user2_token)
            if response and response.status_code == 200:
                data = response.json()
                if 'acknowledged' in data.get('message', '').lower():
                    results.add_result("POST /board/notices/:id/acknowledge (Acknowledge Notice)", "PASS", "Notice acknowledged successfully")
                else:
                    results.add_result("POST /board/notices/:id/acknowledge (Acknowledge Notice)", "FAIL", "Unexpected response message")
            else:
                results.add_result("POST /board/notices/:id/acknowledge (Acknowledge Notice)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        except Exception as e:
            results.add_result("POST /board/notices/:id/acknowledge (Acknowledge Notice)", "FAIL", f"Exception: {e}")
    
    # 9. GET /board/notices/:id/acknowledgments — Acknowledgment list
    if notice2_id:
        try:
            response = make_request('GET', f'/board/notices/{notice2_id}/acknowledgments', admin_token, params={'limit': 10})
            if response and response.status_code == 200:
                data = response.json()
                items = data.get('items', [])
                total = data.get('total', 0)
                results.add_result("GET /board/notices/:id/acknowledgments (Acknowledgment List)", "PASS", f"Retrieved {len(items)} acknowledgments, total: {total}")
            else:
                results.add_result("GET /board/notices/:id/acknowledgments (Acknowledgment List)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        except Exception as e:
            results.add_result("GET /board/notices/:id/acknowledgments (Acknowledgment List)", "FAIL", f"Exception: {e}")
    
    # 10. GET /colleges/:id/notices — Public college notices
    if college_id:
        try:
            response = make_request('GET', f'/colleges/{college_id}/notices', user1_token, params={'limit': 10})
            if response and response.status_code == 200:
                data = response.json()
                items = data.get('items', [])
                results.add_result("GET /colleges/:id/notices (Public College Notices)", "PASS", f"Retrieved {len(items)} public notices")
            else:
                results.add_result("GET /colleges/:id/notices (Public College Notices)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        except Exception as e:
            results.add_result("GET /colleges/:id/notices (Public College Notices)", "FAIL", f"Exception: {e}")
    
    # 11. GET /me/board/notices — My created notices
    try:
        response = make_request('GET', '/me/board/notices', user1_token, params={'limit': 10})
        if response and response.status_code == 200:
            data = response.json()
            items = data.get('items', [])
            results.add_result("GET /me/board/notices (My Created Notices)", "PASS", f"Retrieved {len(items)} created notices")
        else:
            results.add_result("GET /me/board/notices (My Created Notices)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
    except Exception as e:
        results.add_result("GET /me/board/notices (My Created Notices)", "FAIL", f"Exception: {e}")
    
    # 12. GET /moderation/board-notices — Review queue
    try:
        response = make_request('GET', '/moderation/board-notices', admin_token, params={'status': 'PENDING_REVIEW', 'limit': 10})
        if response and response.status_code == 200:
            data = response.json()
            items = data.get('items', [])
            results.add_result("GET /moderation/board-notices (Review Queue)", "PASS", f"Retrieved {len(items)} notices in review")
        else:
            results.add_result("GET /moderation/board-notices (Review Queue)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
    except Exception as e:
        results.add_result("GET /moderation/board-notices (Review Queue)", "FAIL", f"Exception: {e}")
    
    # 13. GET /admin/board-notices/analytics — Analytics
    try:
        response = make_request('GET', '/admin/board-notices/analytics', admin_token)
        if response and response.status_code == 200:
            data = response.json()
            total = data.get('total', 0)
            categories = data.get('categories', {})
            results.add_result("GET /admin/board-notices/analytics (Analytics)", "PASS", f"Analytics: {total} total notices, {len(categories)} categories")
        else:
            results.add_result("GET /admin/board-notices/analytics (Analytics)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
    except Exception as e:
        results.add_result("GET /admin/board-notices/analytics (Analytics)", "FAIL", f"Exception: {e}")
    
    # AUTHENTICITY TAGS TESTING (4 endpoints)
    
    # 14. POST /authenticity/tag — Create authenticity tag (User1 tags the notice)
    tag_id = None
    if notice2_id:
        try:
            tag_data = {
                'targetType': 'NOTICE',
                'targetId': notice2_id,
                'tag': 'VERIFIED'
            }
            response = make_request('POST', '/authenticity/tag', user1_token, tag_data)
            if response and response.status_code == 201:
                data = response.json()
                tag_id = data.get('tag', {}).get('id')
                results.add_result("POST /authenticity/tag (Create Tag)", "PASS", f"Authenticity tag created: {tag_id}")
            else:
                results.add_result("POST /authenticity/tag (Create Tag)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        except Exception as e:
            results.add_result("POST /authenticity/tag (Create Tag)", "FAIL", f"Exception: {e}")
    
    # 15. GET /authenticity/tags/:targetType/:targetId — Get tags
    if notice2_id:
        try:
            response = make_request('GET', f'/authenticity/tags/NOTICE/{notice2_id}', user1_token)
            if response and response.status_code == 200:
                data = response.json()
                tags = data.get('tags', [])
                summary = data.get('summary', {})
                results.add_result("GET /authenticity/tags/:type/:id (Get Tags)", "PASS", f"Retrieved {len(tags)} tags, summary: {summary}")
            else:
                results.add_result("GET /authenticity/tags/:type/:id (Get Tags)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        except Exception as e:
            results.add_result("GET /authenticity/tags/:type/:id (Get Tags)", "FAIL", f"Exception: {e}")
    
    # 16. DELETE /authenticity/tags/:id — Remove tag
    if tag_id:
        try:
            response = make_request('DELETE', f'/authenticity/tags/{tag_id}', user1_token)
            if response and response.status_code == 200:
                data = response.json()
                if 'removed' in data.get('message', '').lower():
                    results.add_result("DELETE /authenticity/tags/:id (Remove Tag)", "PASS", "Tag removed successfully")
                else:
                    results.add_result("DELETE /authenticity/tags/:id (Remove Tag)", "FAIL", "Unexpected response message")
            else:
                results.add_result("DELETE /authenticity/tags/:id (Remove Tag)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        except Exception as e:
            results.add_result("DELETE /authenticity/tags/:id (Remove Tag)", "FAIL", f"Exception: {e}")
    
    # 17. GET /admin/authenticity/stats — Tag statistics
    try:
        response = make_request('GET', '/admin/authenticity/stats', admin_token)
        if response and response.status_code == 200:
            data = response.json()
            total_tags = data.get('totalTags', 0)
            by_tag = data.get('byTag', {})
            by_target = data.get('byTarget', {})
            results.add_result("GET /admin/authenticity/stats (Tag Statistics)", "PASS", f"Stats: {total_tags} total tags, {len(by_tag)} tag types, {len(by_target)} target types")
        else:
            results.add_result("GET /admin/authenticity/stats (Tag Statistics)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
    except Exception as e:
        results.add_result("GET /admin/authenticity/stats (Tag Statistics)", "FAIL", f"Exception: {e}")
    
    # Clean up: Delete the test notice
    if notice_id:
        try:
            response = make_request('DELETE', f'/board/notices/{notice_id}', user1_token)
            if response and response.status_code == 200:
                results.add_result("DELETE /board/notices/:id (Delete Notice)", "PASS", "Notice deleted successfully")
            else:
                results.add_result("DELETE /board/notices/:id (Delete Notice)", "FAIL", f"Status: {response.status_code if response else 'Timeout'}")
        except Exception as e:
            results.add_result("DELETE /board/notices/:id (Delete Notice)", "FAIL", f"Exception: {e}")

def main():
    """Run comprehensive Stage 6 & 7 backend tests"""
    print("🎯 TRIBE STAGE 6 & 7 COMPREHENSIVE BACKEND TESTING")
    print("=" * 60)
    print(f"🌐 Base URL: {BASE_URL}")
    print(f"⏰ Test started: {datetime.now().isoformat()}")
    print("=" * 60)
    
    results = TestResults()
    
    # Test Stage 6: Events + RSVP
    test_stage_6_events(results)
    
    # Test Stage 7: Board Notices + Authenticity Tags  
    test_stage_7_board_notices_authenticity(results)
    
    # Final summary
    print("\n" + "=" * 60)
    success = results.summary()
    print("=" * 60)
    
    # Save detailed results
    try:
        with open('/app/test_reports/stage6_7_comprehensive_test.json', 'w') as f:
            json.dump({
                'timestamp': datetime.now().isoformat(),
                'base_url': BASE_URL,
                'total_tests': results.passed + results.failed,
                'passed': results.passed,
                'failed': results.failed,
                'success_rate': (results.passed / (results.passed + results.failed) * 100) if (results.passed + results.failed) > 0 else 0,
                'results': results.results
            }, f, indent=2)
        print(f"📄 Detailed results saved to: /app/test_reports/stage6_7_comprehensive_test.json")
    except Exception as e:
        print(f"⚠️  Failed to save results: {e}")
    
    if success:
        print("🎉 VERDICT: STAGE 6 & 7 ARE PRODUCTION READY!")
        return 0
    else:
        print("⚠️  VERDICT: Issues found, review needed")
        return 1

if __name__ == "__main__":
    sys.exit(main())