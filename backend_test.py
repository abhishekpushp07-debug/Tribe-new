#!/usr/bin/env python3
"""
Stage 3: Story Expiry TTL - Comprehensive Backend Test Suite

Tests the 12 core test matrix requirements:
1. Create story → 201, verify expiresAt = createdAt + 24h
2. Read story before expiry (direct fetch) → 200
3. Rail shows active story in grouped format
4. Rail hides expired story
5. Direct fetch expired story → 410 Gone
6. Profile stories exclude expired (kind=STORY)
7. Mixed expiry: same author has active + expired, rail shows only active
8. Social actions (like/comment/dislike) on expired → 410
9. Public/following feeds never include stories (kind isolation)
10. Admin stats count only active stories
11. Malformed story (null expiresAt) → not in rail, but accessible via direct fetch
12. TTL index configuration verified (expireAfterSeconds=0, partial filter kind=STORY)
"""

import requests
import time
import json
from datetime import datetime, timedelta
from pymongo import MongoClient

# Base configuration
BASE_URL = "https://college-verify-tribe.preview.emergentagent.com/api"
TEST_USERS = {
    'regular': {'phone': '9000000001', 'pin': '1234'},
    'admin': {'phone': '9747158289', 'pin': '1234'}
}

class StoryTTLTester:
    def __init__(self):
        self.sessions = {}
        self.test_data = {}
        self.mongo_client = None
        self.db = None

    def setup_mongo_connection(self):
        """Setup MongoDB connection for direct database operations"""
        try:
            self.mongo_client = MongoClient('mongodb://localhost:27017')
            self.db = self.mongo_client.get_database('your_database_name')
            print("✅ MongoDB connection established")
            return True
        except Exception as e:
            print(f"❌ MongoDB connection failed: {e}")
            return False

    def login_user(self, user_type):
        """Login and get session token"""
        try:
            user_creds = TEST_USERS[user_type]
            response = requests.post(
                f"{BASE_URL}/auth/login",
                json=user_creds,
                timeout=10
            )
            if response.status_code == 200:
                data = response.json()
                self.sessions[user_type] = {
                    'token': data['token'],
                    'user': data['user']
                }
                print(f"✅ {user_type.title()} user logged in successfully")
                return True
            else:
                print(f"❌ {user_type.title()} login failed: {response.status_code} - {response.text}")
                return False
        except Exception as e:
            print(f"❌ {user_type.title()} login error: {e}")
            return False

    def create_media_asset(self, user_type):
        """Create a media asset for story testing"""
        try:
            headers = {'Authorization': f"Bearer {self.sessions[user_type]['token']}"}
            
            # Create a test image (base64 encoded 1x1 pixel PNG)
            test_image_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=="
            
            response = requests.post(
                f"{BASE_URL}/media/upload",
                json={
                    'data': test_image_b64,
                    'mimeType': 'image/png',
                    'type': 'IMAGE'
                },
                headers=headers,
                timeout=10
            )
            
            if response.status_code == 201:
                media_data = response.json()
                media_id = media_data['id']
                print(f"✅ Media asset created: {media_id}")
                return media_id
            else:
                print(f"❌ Media creation failed: {response.status_code} - {response.text}")
                return None
        except Exception as e:
            print(f"❌ Media creation error: {e}")
            return None

    def create_expired_story_in_db(self, user_id, media_id):
        """Create an already-expired story directly in MongoDB"""
        try:
            now = datetime.utcnow()
            # Story expired 2 hours ago, created 26 hours ago
            expired_story = {
                'id': f'expired-story-{int(time.time())}',
                'kind': 'STORY',
                'authorId': user_id,
                'caption': 'EXPIRED TEST STORY',
                'media': [{
                    'id': media_id,
                    'url': f'/api/media/{media_id}',
                    'type': 'IMAGE'
                }],
                'visibility': 'PUBLIC',
                'riskScore': 0,
                'policyReasons': [],
                'moderation': None,
                'collegeId': None,
                'houseId': None,
                'likeCount': 0,
                'dislikeCountInternal': 0,
                'commentCount': 0,
                'saveCount': 0,
                'shareCount': 0,
                'viewCount': 0,
                'syntheticDeclaration': False,
                'syntheticLabelStatus': 'UNKNOWN',
                'distributionStage': 0,
                'duration': None,
                'expiresAt': now - timedelta(hours=2),  # Already expired
                'createdAt': now - timedelta(hours=26),
                'updatedAt': now - timedelta(hours=26)
            }
            
            self.db.content_items.insert_one(expired_story)
            print(f"✅ Expired story created in DB: {expired_story['id']}")
            return expired_story['id']
        except Exception as e:
            print(f"❌ Failed to create expired story in DB: {e}")
            return None

    def create_malformed_story_in_db(self, user_id, media_id):
        """Create a malformed story with null expiresAt directly in MongoDB"""
        try:
            now = datetime.utcnow()
            malformed_story = {
                'id': f'malformed-story-{int(time.time())}',
                'kind': 'STORY',
                'authorId': user_id,
                'caption': 'MALFORMED TEST STORY',
                'media': [{
                    'id': media_id,
                    'url': f'/api/media/{media_id}',
                    'type': 'IMAGE'
                }],
                'visibility': 'PUBLIC',
                'riskScore': 0,
                'policyReasons': [],
                'moderation': None,
                'collegeId': None,
                'houseId': None,
                'likeCount': 0,
                'dislikeCountInternal': 0,
                'commentCount': 0,
                'saveCount': 0,
                'shareCount': 0,
                'viewCount': 0,
                'syntheticDeclaration': False,
                'syntheticLabelStatus': 'UNKNOWN',
                'distributionStage': 0,
                'duration': None,
                'expiresAt': None,  # Malformed - null expiry
                'createdAt': now,
                'updatedAt': now
            }
            
            self.db.content_items.insert_one(malformed_story)
            print(f"✅ Malformed story created in DB: {malformed_story['id']}")
            return malformed_story['id']
        except Exception as e:
            print(f"❌ Failed to create malformed story in DB: {e}")
            return None

    def verify_ttl_index(self):
        """Verify MongoDB TTL index configuration"""
        try:
            indexes = list(self.db.content_items.list_indexes())
            ttl_index = None
            
            for index in indexes:
                if 'expiresAt' in index.get('key', {}):
                    ttl_index = index
                    break
            
            if ttl_index:
                expected_config = {
                    'expireAfterSeconds': 0,
                    'partialFilterExpression': {'kind': 'STORY'}
                }
                
                actual_expire_seconds = ttl_index.get('expireAfterSeconds', 'not_set')
                actual_partial_filter = ttl_index.get('partialFilterExpression', {})
                
                print(f"✅ TTL Index Found:")
                print(f"   - expireAfterSeconds: {actual_expire_seconds}")
                print(f"   - partialFilterExpression: {actual_partial_filter}")
                
                # Check configuration
                if (actual_expire_seconds == 0 and 
                    actual_partial_filter.get('kind') == 'STORY'):
                    print("✅ TTL index configuration is correct")
                    return True
                else:
                    print("❌ TTL index configuration mismatch")
                    return False
            else:
                print("❌ TTL index on expiresAt field not found")
                return False
                
        except Exception as e:
            print(f"❌ TTL index verification error: {e}")
            return False

    def test_1_create_story(self):
        """Test 1: Create story → 201, verify expiresAt = createdAt + 24h"""
        print("\n🧪 Test 1: Create story with proper TTL")
        try:
            headers = {'Authorization': f"Bearer {self.sessions['regular']['token']}"}
            media_id = self.create_media_asset('regular')
            
            if not media_id:
                print("❌ Test 1 failed: Could not create media asset")
                return False
            
            before_creation = datetime.utcnow()
            
            response = requests.post(
                f"{BASE_URL}/content/posts",
                json={
                    'caption': 'Test Story for TTL',
                    'mediaIds': [media_id],
                    'kind': 'STORY'
                },
                headers=headers,
                timeout=10
            )
            
            after_creation = datetime.utcnow()
            
            if response.status_code == 201:
                story_data = response.json()['post']
                story_id = story_data['id']
                
                # Verify expiresAt is set correctly (24 hours from creation)
                expires_at = datetime.fromisoformat(story_data['expiresAt'].replace('Z', '+00:00'))
                created_at = datetime.fromisoformat(story_data['createdAt'].replace('Z', '+00:00'))
                
                expected_expiry = created_at + timedelta(hours=24)
                time_diff = abs((expires_at - expected_expiry).total_seconds())
                
                if time_diff < 60:  # Allow 1 minute tolerance
                    self.test_data['active_story_id'] = story_id
                    self.test_data['media_id'] = media_id
                    print(f"✅ Test 1 PASSED: Story created with proper 24h TTL")
                    print(f"   Story ID: {story_id}")
                    print(f"   Created: {story_data['createdAt']}")
                    print(f"   Expires: {story_data['expiresAt']}")
                    return True
                else:
                    print(f"❌ Test 1 FAILED: TTL not set correctly. Time diff: {time_diff}s")
                    return False
            else:
                print(f"❌ Test 1 FAILED: Story creation failed: {response.status_code} - {response.text}")
                return False
        except Exception as e:
            print(f"❌ Test 1 ERROR: {e}")
            return False

    def test_2_read_active_story(self):
        """Test 2: Read story before expiry (direct fetch) → 200"""
        print("\n🧪 Test 2: Read active story via direct fetch")
        try:
            story_id = self.test_data.get('active_story_id')
            if not story_id:
                print("❌ Test 2 SKIPPED: No active story ID available")
                return False
            
            response = requests.get(
                f"{BASE_URL}/content/{story_id}",
                timeout=10
            )
            
            if response.status_code == 200:
                story_data = response.json()['post']
                print(f"✅ Test 2 PASSED: Active story retrieved successfully")
                print(f"   Story ID: {story_data['id']}")
                print(f"   Caption: {story_data['caption']}")
                print(f"   Kind: {story_data['kind']}")
                return True
            else:
                print(f"❌ Test 2 FAILED: {response.status_code} - {response.text}")
                return False
        except Exception as e:
            print(f"❌ Test 2 ERROR: {e}")
            return False

    def test_3_story_rail_shows_active(self):
        """Test 3: Rail shows active story in grouped format"""
        print("\n🧪 Test 3: Story rail shows active stories")
        try:
            headers = {'Authorization': f"Bearer {self.sessions['regular']['token']}"}
            
            response = requests.get(
                f"{BASE_URL}/feed/stories",
                headers=headers,
                timeout=10
            )
            
            if response.status_code == 200:
                feed_data = response.json()
                story_rail = feed_data.get('storyRail', [])
                stories_field = feed_data.get('stories', [])
                
                # Check if our active story appears in the rail
                active_story_id = self.test_data.get('active_story_id')
                found_active = False
                
                for author_group in story_rail:
                    for story in author_group.get('stories', []):
                        if story['id'] == active_story_id:
                            found_active = True
                            break
                    if found_active:
                        break
                
                if found_active:
                    print(f"✅ Test 3 PASSED: Active story found in story rail")
                    print(f"   Story rail groups: {len(story_rail)}")
                    print(f"   Has 'stories' field: {len(stories_field) > 0}")
                    return True
                else:
                    print(f"❌ Test 3 FAILED: Active story not found in story rail")
                    print(f"   Story rail groups: {len(story_rail)}")
                    return False
            else:
                print(f"❌ Test 3 FAILED: Story rail request failed: {response.status_code} - {response.text}")
                return False
        except Exception as e:
            print(f"❌ Test 3 ERROR: {e}")
            return False

    def test_4_and_5_expired_story_behavior(self):
        """Test 4 & 5: Rail hides expired story + Direct fetch expired story → 410"""
        print("\n🧪 Test 4 & 5: Expired story handling")
        try:
            # Create expired story in DB
            user_id = self.sessions['regular']['user']['id']
            media_id = self.test_data.get('media_id')
            
            if not media_id:
                media_id = self.create_media_asset('regular')
            
            expired_story_id = self.create_expired_story_in_db(user_id, media_id)
            if not expired_story_id:
                print("❌ Test 4 & 5 FAILED: Could not create expired story")
                return False
            
            # Test 5: Direct fetch should return 410 Gone
            print("\n   Testing direct fetch of expired story...")
            response = requests.get(
                f"{BASE_URL}/content/{expired_story_id}",
                timeout=10
            )
            
            direct_fetch_success = False
            if response.status_code == 410:
                print("✅ Test 5 PASSED: Expired story returns 410 Gone")
                direct_fetch_success = True
            elif response.status_code == 404:
                print("✅ Test 5 PASSED: Expired story auto-deleted by TTL (404 is acceptable)")
                direct_fetch_success = True
            else:
                print(f"❌ Test 5 FAILED: Expected 410 or 404, got {response.status_code}")
            
            # Test 4: Story rail should exclude expired stories
            print("\n   Testing story rail excludes expired story...")
            headers = {'Authorization': f"Bearer {self.sessions['regular']['token']}"}
            response = requests.get(
                f"{BASE_URL}/feed/stories",
                headers=headers,
                timeout=10
            )
            
            rail_test_success = False
            if response.status_code == 200:
                feed_data = response.json()
                story_rail = feed_data.get('storyRail', [])
                
                # Check that expired story is NOT in the rail
                found_expired = False
                for author_group in story_rail:
                    for story in author_group.get('stories', []):
                        if story['id'] == expired_story_id:
                            found_expired = True
                            break
                    if found_expired:
                        break
                
                if not found_expired:
                    print("✅ Test 4 PASSED: Expired story excluded from story rail")
                    rail_test_success = True
                else:
                    print("❌ Test 4 FAILED: Expired story found in story rail")
            else:
                print(f"❌ Test 4 FAILED: Story rail request failed: {response.status_code}")
            
            return direct_fetch_success and rail_test_success
            
        except Exception as e:
            print(f"❌ Test 4 & 5 ERROR: {e}")
            return False

    def test_6_profile_stories_exclude_expired(self):
        """Test 6: Profile stories exclude expired (kind=STORY)"""
        print("\n🧪 Test 6: Profile stories exclude expired")
        try:
            user_id = self.sessions['regular']['user']['id']
            
            response = requests.get(
                f"{BASE_URL}/users/{user_id}/posts?kind=STORY",
                timeout=10
            )
            
            if response.status_code == 200:
                posts_data = response.json()
                items = posts_data.get('items', [])
                
                # Check that all stories in profile are not expired
                all_valid = True
                expired_found = 0
                
                for story in items:
                    if story.get('expiresAt'):
                        expires_at_str = story['expiresAt']
                        # Handle both Z and +00:00 timezone formats
                        if expires_at_str.endswith('Z'):
                            expires_at = datetime.fromisoformat(expires_at_str.replace('Z', '+00:00'))
                        else:
                            expires_at = datetime.fromisoformat(expires_at_str)
                        
                        # Make sure we're comparing UTC datetimes
                        now_utc = datetime.utcnow().replace(tzinfo=expires_at.tzinfo)
                        if expires_at <= now_utc:
                            expired_found += 1
                            all_valid = False
                
                if all_valid:
                    print(f"✅ Test 6 PASSED: Profile stories exclude expired ({len(items)} active stories)")
                    return True
                else:
                    print(f"❌ Test 6 FAILED: Found {expired_found} expired stories in profile")
                    return False
            else:
                print(f"❌ Test 6 FAILED: Profile request failed: {response.status_code} - {response.text}")
                return False
        except Exception as e:
            print(f"❌ Test 6 ERROR: {e}")
            return False

    def test_7_mixed_expiry_rail_behavior(self):
        """Test 7: Same author has active + expired, rail shows only active"""
        print("\n🧪 Test 7: Mixed expiry behavior in story rail")
        try:
            user_id = self.sessions['regular']['user']['id']
            
            headers = {'Authorization': f"Bearer {self.sessions['regular']['token']}"}
            response = requests.get(
                f"{BASE_URL}/feed/stories",
                headers=headers,
                timeout=10
            )
            
            if response.status_code == 200:
                feed_data = response.json()
                story_rail = feed_data.get('storyRail', [])
                
                # Find our user's group
                user_group = None
                for author_group in story_rail:
                    if author_group.get('author', {}).get('id') == user_id:
                        user_group = author_group
                        break
                
                if user_group:
                    stories = user_group.get('stories', [])
                    
                    # Verify all stories in the group are active (not expired)
                    all_active = True
                    for story in stories:
                        if story.get('expiresAt'):
                            expires_at_str = story['expiresAt']
                            # Handle both Z and +00:00 timezone formats  
                            if expires_at_str.endswith('Z'):
                                expires_at = datetime.fromisoformat(expires_at_str.replace('Z', '+00:00'))
                            else:
                                expires_at = datetime.fromisoformat(expires_at_str)
                            
                            # Make sure we're comparing UTC datetimes
                            now_utc = datetime.utcnow().replace(tzinfo=expires_at.tzinfo)
                            if expires_at <= now_utc:
                                all_active = False
                                break
                    
                    if all_active:
                        print(f"✅ Test 7 PASSED: User group shows only active stories ({len(stories)} stories)")
                        return True
                    else:
                        print(f"❌ Test 7 FAILED: User group contains expired stories")
                        return False
                else:
                    print("✅ Test 7 PASSED: No stories in rail (acceptable if user has no active stories)")
                    return True
            else:
                print(f"❌ Test 7 FAILED: Story rail request failed: {response.status_code}")
                return False
        except Exception as e:
            print(f"❌ Test 7 ERROR: {e}")
            return False

    def test_8_social_actions_on_expired(self):
        """Test 8: Social actions (like/comment/dislike) on expired → 410"""
        print("\n🧪 Test 8: Social actions on expired stories return 410")
        try:
            # Create another expired story for this test
            user_id = self.sessions['regular']['user']['id']
            media_id = self.test_data.get('media_id')
            
            if not media_id:
                media_id = self.create_media_asset('regular')
            
            expired_story_id = self.create_expired_story_in_db(user_id, media_id)
            if not expired_story_id:
                print("❌ Test 8 FAILED: Could not create expired story")
                return False
            
            headers = {'Authorization': f"Bearer {self.sessions['regular']['token']}"}
            
            # Test like on expired story
            like_response = requests.post(
                f"{BASE_URL}/content/{expired_story_id}/like",
                headers=headers,
                timeout=10
            )
            
            # Test comment on expired story
            comment_response = requests.post(
                f"{BASE_URL}/content/{expired_story_id}/comments",
                json={'body': 'Test comment on expired story'},
                headers=headers,
                timeout=10
            )
            
            # Test dislike on expired story
            dislike_response = requests.post(
                f"{BASE_URL}/content/{expired_story_id}/dislike",
                headers=headers,
                timeout=10
            )
            
            # Check all responses
            like_ok = like_response.status_code == 410
            comment_ok = comment_response.status_code == 410
            dislike_ok = dislike_response.status_code == 410
            
            # Note: If TTL has already deleted the story, 404 is also acceptable
            if not like_ok:
                like_ok = like_response.status_code == 404
            if not comment_ok:
                comment_ok = comment_response.status_code == 404
            if not dislike_ok:
                dislike_ok = dislike_response.status_code == 404
            
            if like_ok and comment_ok and dislike_ok:
                print(f"✅ Test 8 PASSED: All social actions blocked on expired story")
                print(f"   Like: {like_response.status_code}")
                print(f"   Comment: {comment_response.status_code}")
                print(f"   Dislike: {dislike_response.status_code}")
                return True
            else:
                print(f"❌ Test 8 FAILED: Social actions not properly blocked")
                print(f"   Like: {like_response.status_code} (expected 410/404)")
                print(f"   Comment: {comment_response.status_code} (expected 410/404)")
                print(f"   Dislike: {dislike_response.status_code} (expected 410/404)")
                return False
                
        except Exception as e:
            print(f"❌ Test 8 ERROR: {e}")
            return False

    def test_9_feed_isolation(self):
        """Test 9: Public/following feeds never include stories (kind isolation)"""
        print("\n🧪 Test 9: Feed isolation - stories never appear in POST feeds")
        try:
            headers = {'Authorization': f"Bearer {self.sessions['regular']['token']}"}
            
            # Test public feed
            public_response = requests.get(
                f"{BASE_URL}/feed/public",
                timeout=10
            )
            
            # Test following feed
            following_response = requests.get(
                f"{BASE_URL}/feed/following",
                headers=headers,
                timeout=10
            )
            
            public_ok = True
            following_ok = True
            
            if public_response.status_code == 200:
                public_items = public_response.json().get('items', [])
                for item in public_items:
                    if item.get('kind') == 'STORY':
                        public_ok = False
                        break
            else:
                public_ok = False
            
            if following_response.status_code == 200:
                following_items = following_response.json().get('items', [])
                for item in following_items:
                    if item.get('kind') == 'STORY':
                        following_ok = False
                        break
            else:
                following_ok = False
            
            if public_ok and following_ok:
                print(f"✅ Test 9 PASSED: No stories found in POST feeds")
                print(f"   Public feed items: {len(public_items) if public_response.status_code == 200 else 'N/A'}")
                print(f"   Following feed items: {len(following_items) if following_response.status_code == 200 else 'N/A'}")
                return True
            else:
                print(f"❌ Test 9 FAILED: Stories found in POST feeds")
                print(f"   Public feed OK: {public_ok}")
                print(f"   Following feed OK: {following_ok}")
                return False
                
        except Exception as e:
            print(f"❌ Test 9 ERROR: {e}")
            return False

    def test_10_admin_stats_exclude_expired(self):
        """Test 10: Admin stats count only active stories"""
        print("\n🧪 Test 10: Admin stats exclude expired stories")
        try:
            headers = {'Authorization': f"Bearer {self.sessions['admin']['token']}"}
            
            response = requests.get(
                f"{BASE_URL}/admin/stats",
                headers=headers,
                timeout=10
            )
            
            if response.status_code == 200:
                stats = response.json()
                story_count = stats.get('stories', 0)
                
                # Get actual count from database (active stories only)
                actual_count = self.db.content_items.count_documents({
                    'kind': 'STORY',
                    'visibility': 'PUBLIC',
                    'expiresAt': {'$gt': datetime.utcnow()}
                })
                
                if story_count == actual_count:
                    print(f"✅ Test 10 PASSED: Admin stats count matches active stories ({story_count})")
                    return True
                else:
                    print(f"❌ Test 10 FAILED: Count mismatch - API: {story_count}, DB: {actual_count}")
                    return False
            else:
                print(f"❌ Test 10 FAILED: Admin stats request failed: {response.status_code} - {response.text}")
                return False
                
        except Exception as e:
            print(f"❌ Test 10 ERROR: {e}")
            return False

    def test_11_malformed_story_behavior(self):
        """Test 11: Malformed story (null expiresAt) → not in rail, but accessible via direct fetch"""
        print("\n🧪 Test 11: Malformed story behavior")
        try:
            user_id = self.sessions['regular']['user']['id']
            media_id = self.test_data.get('media_id')
            
            if not media_id:
                media_id = self.create_media_asset('regular')
            
            malformed_story_id = self.create_malformed_story_in_db(user_id, media_id)
            if not malformed_story_id:
                print("❌ Test 11 FAILED: Could not create malformed story")
                return False
            
            # Test direct fetch should work
            direct_response = requests.get(
                f"{BASE_URL}/content/{malformed_story_id}",
                timeout=10
            )
            
            direct_ok = direct_response.status_code == 200
            
            # Test story rail should NOT include malformed story
            headers = {'Authorization': f"Bearer {self.sessions['regular']['token']}"}
            rail_response = requests.get(
                f"{BASE_URL}/feed/stories",
                headers=headers,
                timeout=10
            )
            
            rail_excludes_malformed = True
            if rail_response.status_code == 200:
                story_rail = rail_response.json().get('storyRail', [])
                for author_group in story_rail:
                    for story in author_group.get('stories', []):
                        if story['id'] == malformed_story_id:
                            rail_excludes_malformed = False
                            break
                    if not rail_excludes_malformed:
                        break
            
            if direct_ok and rail_excludes_malformed:
                print(f"✅ Test 11 PASSED: Malformed story accessible via direct fetch but excluded from rail")
                return True
            else:
                print(f"❌ Test 11 FAILED:")
                print(f"   Direct fetch OK: {direct_ok} (status: {direct_response.status_code})")
                print(f"   Rail excludes malformed: {rail_excludes_malformed}")
                return False
                
        except Exception as e:
            print(f"❌ Test 11 ERROR: {e}")
            return False

    def test_12_ttl_index_configuration(self):
        """Test 12: TTL index configuration verified"""
        print("\n🧪 Test 12: TTL index configuration")
        return self.verify_ttl_index()

    def run_all_tests(self):
        """Run the complete test suite"""
        print("=" * 80)
        print("🚀 STAGE 3: STORY EXPIRY TTL - COMPREHENSIVE TEST SUITE")
        print("=" * 80)
        
        # Setup
        if not self.setup_mongo_connection():
            print("❌ Cannot proceed without MongoDB connection")
            return
        
        if not self.login_user('regular'):
            print("❌ Cannot proceed without regular user login")
            return
            
        if not self.login_user('admin'):
            print("❌ Cannot proceed without admin user login")
            return
        
        # Run tests
        results = []
        
        results.append(("TTL Index Configuration", self.test_12_ttl_index_configuration()))
        results.append(("Create Story with TTL", self.test_1_create_story()))
        results.append(("Read Active Story", self.test_2_read_active_story()))
        results.append(("Story Rail Shows Active", self.test_3_story_rail_shows_active()))
        results.append(("Expired Story Handling", self.test_4_and_5_expired_story_behavior()))
        results.append(("Profile Stories Exclude Expired", self.test_6_profile_stories_exclude_expired()))
        results.append(("Mixed Expiry Rail Behavior", self.test_7_mixed_expiry_rail_behavior()))
        results.append(("Social Actions on Expired", self.test_8_social_actions_on_expired()))
        results.append(("Feed Isolation", self.test_9_feed_isolation()))
        results.append(("Admin Stats Exclude Expired", self.test_10_admin_stats_exclude_expired()))
        results.append(("Malformed Story Behavior", self.test_11_malformed_story_behavior()))
        
        # Summary
        print("\n" + "=" * 80)
        print("📊 TEST RESULTS SUMMARY")
        print("=" * 80)
        
        passed = sum(1 for _, result in results if result)
        total = len(results)
        
        for test_name, result in results:
            status = "✅ PASS" if result else "❌ FAIL"
            print(f"{status} {test_name}")
        
        print(f"\n🎯 OVERALL: {passed}/{total} tests passed ({passed/total*100:.1f}%)")
        
        if passed == total:
            print("\n🎉 ALL TESTS PASSED - STAGE 3 STORY EXPIRY TTL IS FULLY FUNCTIONAL!")
        else:
            print(f"\n⚠️  {total-passed} tests failed - review failed tests above")
        
        # Cleanup
        if self.mongo_client:
            self.mongo_client.close()

if __name__ == "__main__":
    tester = StoryTTLTester()
    tester.run_all_tests()