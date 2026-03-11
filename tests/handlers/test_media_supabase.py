"""
Tribe — Media Infrastructure Tests (Supabase Storage)

Tests the complete media upload pipeline:
- POST /api/media/upload-init (signed URL generation)
- POST /api/media/upload-complete (finalize after direct upload)
- GET /api/media/upload-status/:id (check status)
- POST /api/media/upload (legacy base64, now via Supabase)
- GET /api/media/:id (serve / redirect)

Validation: mime types, file sizes, kind/mime mismatch, auth
"""
import pytest
import requests
import os
import base64

API_URL = os.environ.get('TEST_API_URL', 'http://localhost:3000/api')

# Minimal valid JPEG bytes (1x1 pixel)
TINY_JPEG = bytes([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
    0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
    0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
    0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
    0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
    0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
    0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
    0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
    0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03,
    0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D,
    0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
    0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08,
    0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72,
    0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28,
    0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45,
    0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
    0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x73, 0x74, 0x75,
    0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
    0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3,
    0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6,
    0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9,
    0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
    0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4,
    0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01,
    0x00, 0x00, 0x3F, 0x00, 0x7B, 0x94, 0x11, 0x00, 0x00, 0x00, 0x00, 0xFF,
    0xD9
])


def _headers(token=None, ip=None):
    """Build request headers with rate limit bypass."""
    import random
    h = {
        'Content-Type': 'application/json',
        'X-Forwarded-For': ip or f'10.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(0,255)}'
    }
    if token:
        h['Authorization'] = f'Bearer {token}'
    return h


def _post_with_retry(url, json, headers, max_retries=3):
    """POST with 429 retry."""
    import time
    for attempt in range(max_retries):
        resp = requests.post(url, json=json, headers=headers)
        if resp.status_code != 429:
            return resp
        time.sleep(2 * (attempt + 1))
    return resp


def _get_with_retry(url, headers, max_retries=3, **kwargs):
    """GET with 429 retry."""
    import time
    for attempt in range(max_retries):
        resp = requests.get(url, headers=headers, **kwargs)
        if resp.status_code != 429:
            return resp
        time.sleep(2 * (attempt + 1))
    return resp


@pytest.fixture(scope='module')
def media_user(api_url):
    """Register/login a dedicated test user for media tests."""
    import random
    phone = f'99999{random.randint(40000,49999)}'
    ip = f'10.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(0,255)}'
    h = _headers(ip=ip)
    resp = requests.post(f'{api_url}/auth/register', json={
        'phone': phone, 'pin': '1234', 'displayName': 'Media Test User'
    }, headers=h)
    if resp.status_code not in (200, 201):
        resp = requests.post(f'{api_url}/auth/login', json={
            'phone': phone, 'pin': '1234'
        }, headers=h)
    data = resp.json()
    token = data.get('accessToken') or data.get('token')
    user_id = data.get('user', {}).get('id')
    return {'token': token, 'userId': user_id, 'phone': phone, 'ip': ip}


@pytest.fixture(scope='module')
def media_user_child(api_url, db):
    """A CHILD user for age-restriction tests."""
    import random
    phone = f'99999{random.randint(50000,59999)}'
    ip = f'10.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(0,255)}'
    h = _headers(ip=ip)
    resp = requests.post(f'{api_url}/auth/register', json={
        'phone': phone, 'pin': '1234', 'displayName': 'Child Media User'
    }, headers=h)
    if resp.status_code not in (200, 201):
        resp = requests.post(f'{api_url}/auth/login', json={
            'phone': phone, 'pin': '1234'
        }, headers=h)
    data = resp.json()
    token = data.get('accessToken') or data.get('token')
    user_id = data.get('user', {}).get('id')
    db.users.update_one({'id': user_id}, {'$set': {'ageStatus': 'CHILD'}})
    return {'token': token, 'userId': user_id, 'phone': phone, 'ip': ip}


@pytest.fixture(scope='module')
def media_user_b(api_url):
    """A second dedicated media test user for later test classes."""
    import random
    phone = f'99999{random.randint(70000,79999)}'
    ip = f'10.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(0,255)}'
    h = _headers(ip=ip)
    resp = requests.post(f'{api_url}/auth/register', json={
        'phone': phone, 'pin': '1234', 'displayName': 'Media Test User B'
    }, headers=h)
    if resp.status_code not in (200, 201):
        resp = requests.post(f'{api_url}/auth/login', json={
            'phone': phone, 'pin': '1234'
        }, headers=h)
    data = resp.json()
    token = data.get('accessToken') or data.get('token')
    user_id = data.get('user', {}).get('id')
    return {'token': token, 'userId': user_id, 'phone': phone, 'ip': ip}


# ============================================================
# UPLOAD-INIT TESTS
# ============================================================

class TestUploadInit:
    """Tests for POST /api/media/upload-init"""

    def test_init_image_jpeg(self, api_url, media_user):
        """Should return signed URL for JPEG image upload."""
        resp = requests.post(f'{api_url}/media/upload-init', json={
            'kind': 'image', 'mimeType': 'image/jpeg', 'sizeBytes': 500000, 'scope': 'posts'
        }, headers=_headers(media_user['token'], media_user['ip']))
        assert resp.status_code == 201
        data = resp.json()
        assert 'mediaId' in data
        assert 'uploadUrl' in data
        assert 'publicUrl' in data
        assert 'token' in data
        assert data['expiresIn'] == 7200
        assert 'supabase.co' in data['uploadUrl']
        assert 'posts/' in data['path']

    def test_init_image_png(self, api_url, media_user):
        """Should return signed URL for PNG image upload."""
        resp = requests.post(f'{api_url}/media/upload-init', json={
            'kind': 'image', 'mimeType': 'image/png', 'sizeBytes': 200000, 'scope': 'stories'
        }, headers=_headers(media_user['token'], media_user['ip']))
        assert resp.status_code == 201
        data = resp.json()
        assert 'stories/' in data['path']
        assert data['path'].endswith('.png')

    def test_init_image_webp(self, api_url, media_user):
        """Should return signed URL for WebP image upload."""
        resp = requests.post(f'{api_url}/media/upload-init', json={
            'kind': 'image', 'mimeType': 'image/webp', 'sizeBytes': 100000, 'scope': 'thumbnails'
        }, headers=_headers(media_user['token'], media_user['ip']))
        assert resp.status_code == 201
        data = resp.json()
        assert 'thumbnails/' in data['path']

    def test_init_video_mp4(self, api_url, media_user):
        """Should return signed URL for MP4 video upload."""
        resp = requests.post(f'{api_url}/media/upload-init', json={
            'kind': 'video', 'mimeType': 'video/mp4', 'sizeBytes': 10000000, 'scope': 'reels'
        }, headers=_headers(media_user['token'], media_user['ip']))
        assert resp.status_code == 201
        data = resp.json()
        assert 'reels/' in data['path']
        assert data['path'].endswith('.mp4')

    def test_init_video_quicktime(self, api_url, media_user):
        """Should return signed URL for QuickTime video upload."""
        resp = requests.post(f'{api_url}/media/upload-init', json={
            'kind': 'video', 'mimeType': 'video/quicktime', 'sizeBytes': 5000000, 'scope': 'reels'
        }, headers=_headers(media_user['token'], media_user['ip']))
        assert resp.status_code == 201
        data = resp.json()
        assert data['path'].endswith('.mov')

    def test_init_default_scope(self, api_url, media_user):
        """Should default to 'posts' scope when not provided."""
        resp = requests.post(f'{api_url}/media/upload-init', json={
            'kind': 'image', 'mimeType': 'image/jpeg', 'sizeBytes': 1000
        }, headers=_headers(media_user['token'], media_user['ip']))
        assert resp.status_code == 201
        assert 'posts/' in resp.json()['path']

    def test_init_invalid_scope_defaults_to_posts(self, api_url, media_user):
        """Should default to posts for invalid scope."""
        resp = requests.post(f'{api_url}/media/upload-init', json={
            'kind': 'image', 'mimeType': 'image/jpeg', 'sizeBytes': 1000, 'scope': 'invalid'
        }, headers=_headers(media_user['token'], media_user['ip']))
        assert resp.status_code == 201
        assert 'posts/' in resp.json()['path']

    # ---- Validation errors ----

    def test_init_invalid_mime_type(self, api_url, media_user):
        """Should reject unsupported MIME types."""
        resp = requests.post(f'{api_url}/media/upload-init', json={
            'kind': 'image', 'mimeType': 'application/pdf', 'sizeBytes': 1000
        }, headers=_headers(media_user['token'], media_user['ip']))
        assert resp.status_code == 400
        assert 'mimeType' in resp.json()['error'].lower() or 'allowed' in resp.json()['error'].lower()

    def test_init_kind_mime_mismatch_image(self, api_url, media_user):
        """Should reject when kind=image but mime is video."""
        resp = requests.post(f'{api_url}/media/upload-init', json={
            'kind': 'image', 'mimeType': 'video/mp4', 'sizeBytes': 1000
        }, headers=_headers(media_user['token'], media_user['ip']))
        assert resp.status_code == 400
        assert 'image' in resp.json()['error'].lower()

    def test_init_kind_mime_mismatch_video(self, api_url, media_user):
        """Should reject when kind=video but mime is image."""
        resp = requests.post(f'{api_url}/media/upload-init', json={
            'kind': 'video', 'mimeType': 'image/jpeg', 'sizeBytes': 1000
        }, headers=_headers(media_user['token'], media_user['ip']))
        assert resp.status_code == 400
        assert 'video' in resp.json()['error'].lower()

    def test_init_invalid_kind(self, api_url, media_user):
        """Should reject invalid kind values."""
        resp = requests.post(f'{api_url}/media/upload-init', json={
            'kind': 'audio', 'mimeType': 'image/jpeg', 'sizeBytes': 1000
        }, headers=_headers(media_user['token'], media_user['ip']))
        assert resp.status_code == 400

    def test_init_missing_required_fields(self, api_url, media_user):
        """Should reject when required fields are missing."""
        resp = requests.post(f'{api_url}/media/upload-init', json={
            'kind': 'image'
        }, headers=_headers(media_user['token'], media_user['ip']))
        assert resp.status_code == 400

    def test_init_file_too_large(self, api_url, media_user):
        """Should reject files exceeding 200MB."""
        resp = requests.post(f'{api_url}/media/upload-init', json={
            'kind': 'video', 'mimeType': 'video/mp4', 'sizeBytes': 210_000_000
        }, headers=_headers(media_user['token'], media_user['ip']))
        assert resp.status_code == 413
        assert resp.json()['code'] == 'PAYLOAD_TOO_LARGE'

    def test_init_zero_size(self, api_url, media_user):
        """Should reject zero-byte files."""
        resp = requests.post(f'{api_url}/media/upload-init', json={
            'kind': 'image', 'mimeType': 'image/jpeg', 'sizeBytes': 0
        }, headers=_headers(media_user['token'], media_user['ip']))
        assert resp.status_code in (400, 413)

    def test_init_requires_auth(self, api_url):
        """Should require authentication."""
        resp = requests.post(f'{api_url}/media/upload-init', json={
            'kind': 'image', 'mimeType': 'image/jpeg', 'sizeBytes': 1000
        }, headers=_headers())
        assert resp.status_code == 401

    def test_init_child_restricted(self, api_url, media_user_child):
        """Should block CHILD users from uploading."""
        resp = requests.post(f'{api_url}/media/upload-init', json={
            'kind': 'image', 'mimeType': 'image/jpeg', 'sizeBytes': 1000
        }, headers=_headers(media_user_child['token'], media_user_child['ip']))
        assert resp.status_code == 403


# ============================================================
# FULL UPLOAD FLOW (init → direct upload → complete)
# ============================================================

class TestFullUploadFlow:
    """Tests the complete 3-step upload process."""

    def test_full_image_upload(self, api_url, media_user):
        """Full flow: init → upload to Supabase → complete."""
        # Step 1: Init
        resp = requests.post(f'{api_url}/media/upload-init', json={
            'kind': 'image', 'mimeType': 'image/jpeg', 'sizeBytes': len(TINY_JPEG), 'scope': 'posts'
        }, headers=_headers(media_user['token'], media_user['ip']))
        assert resp.status_code == 201
        init_data = resp.json()
        media_id = init_data['mediaId']

        # Step 2: Upload directly to Supabase
        upload_resp = requests.put(
            init_data['uploadUrl'],
            data=TINY_JPEG,
            headers={'Content-Type': 'image/jpeg'}
        )
        assert upload_resp.status_code == 200

        # Step 3: Complete
        resp = requests.post(f'{api_url}/media/upload-complete', json={
            'mediaId': media_id, 'width': 1, 'height': 1
        }, headers=_headers(media_user['token'], media_user['ip']))
        assert resp.status_code == 200
        data = resp.json()
        assert data['status'] == 'READY'
        assert data['storageType'] == 'SUPABASE'
        assert 'supabase.co' in data['publicUrl']

        # Step 4: Verify public URL works
        pub_resp = requests.get(data['publicUrl'])
        assert pub_resp.status_code == 200
        assert len(pub_resp.content) == len(TINY_JPEG)

    def test_full_video_upload(self, api_url, media_user):
        """Full flow for video: init → upload → complete with duration."""
        # Create a tiny "video" file (just bytes, Supabase doesn't validate content)
        fake_video = b'\x00' * 1024

        resp = requests.post(f'{api_url}/media/upload-init', json={
            'kind': 'video', 'mimeType': 'video/mp4', 'sizeBytes': len(fake_video), 'scope': 'reels'
        }, headers=_headers(media_user['token'], media_user['ip']))
        assert resp.status_code == 201
        init_data = resp.json()
        media_id = init_data['mediaId']

        # Upload
        upload_resp = requests.put(
            init_data['uploadUrl'],
            data=fake_video,
            headers={'Content-Type': 'video/mp4'}
        )
        assert upload_resp.status_code == 200

        # Complete with duration
        resp = requests.post(f'{api_url}/media/upload-complete', json={
            'mediaId': media_id, 'width': 1080, 'height': 1920, 'duration': 15.5
        }, headers=_headers(media_user['token'], media_user['ip']))
        assert resp.status_code == 200
        data = resp.json()
        assert data['status'] == 'READY'
        assert data['kind'] == 'VIDEO'

    def test_complete_idempotent(self, api_url, media_user):
        """Calling upload-complete twice should be idempotent."""
        # Init + Upload
        resp = requests.post(f'{api_url}/media/upload-init', json={
            'kind': 'image', 'mimeType': 'image/jpeg', 'sizeBytes': len(TINY_JPEG), 'scope': 'posts'
        }, headers=_headers(media_user['token'], media_user['ip']))
        init_data = resp.json()
        media_id = init_data['mediaId']

        requests.put(init_data['uploadUrl'], data=TINY_JPEG,
                     headers={'Content-Type': 'image/jpeg'})

        # Complete first time
        resp1 = requests.post(f'{api_url}/media/upload-complete', json={
            'mediaId': media_id
        }, headers=_headers(media_user['token'], media_user['ip']))
        assert resp1.status_code == 200

        # Complete second time (idempotent)
        resp2 = requests.post(f'{api_url}/media/upload-complete', json={
            'mediaId': media_id
        }, headers=_headers(media_user['token'], media_user['ip']))
        assert resp2.status_code == 200
        assert resp2.json()['status'] == 'READY'


# ============================================================
# UPLOAD-COMPLETE VALIDATION
# ============================================================

class TestUploadComplete:
    """Tests for POST /api/media/upload-complete."""

    def test_complete_missing_media_id(self, api_url, media_user):
        """Should reject when mediaId is missing."""
        resp = requests.post(f'{api_url}/media/upload-complete', json={},
                             headers=_headers(media_user['token'], media_user['ip']))
        assert resp.status_code == 400

    def test_complete_nonexistent_media(self, api_url, media_user):
        """Should return 404 for nonexistent mediaId."""
        resp = requests.post(f'{api_url}/media/upload-complete', json={
            'mediaId': 'nonexistent-uuid'
        }, headers=_headers(media_user['token'], media_user['ip']))
        assert resp.status_code == 404

    def test_complete_requires_auth(self, api_url):
        """Should require authentication."""
        resp = requests.post(f'{api_url}/media/upload-complete', json={
            'mediaId': 'some-id'
        }, headers=_headers())
        assert resp.status_code == 401

    def test_complete_wrong_user(self, api_url, media_user):
        """Should not allow completing another user's upload."""
        # Create upload as media_user
        resp = requests.post(f'{api_url}/media/upload-init', json={
            'kind': 'image', 'mimeType': 'image/jpeg', 'sizeBytes': 100, 'scope': 'posts'
        }, headers=_headers(media_user['token'], media_user['ip']))
        media_id = resp.json()['mediaId']

        # Try to complete as different user
        import random
        phone2 = f'99999{random.randint(60000,69999)}'
        ip2 = f'10.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(0,255)}'
        resp2 = requests.post(f'{api_url}/auth/register', json={
            'phone': phone2, 'pin': '1234', 'displayName': 'Other Media User'
        }, headers=_headers(ip=ip2))
        if resp2.status_code not in (200, 201):
            resp2 = requests.post(f'{api_url}/auth/login', json={
                'phone': phone2, 'pin': '1234'
            }, headers=_headers(ip=ip2))
        token2 = resp2.json().get('accessToken') or resp2.json().get('token')

        resp3 = requests.post(f'{api_url}/media/upload-complete', json={
            'mediaId': media_id
        }, headers=_headers(token2, ip2))
        assert resp3.status_code == 404  # Not found for this user


# ============================================================
# UPLOAD-STATUS TESTS
# ============================================================

class TestUploadStatus:
    """Tests for GET /api/media/upload-status/:id."""

    def test_status_pending(self, api_url, media_user):
        """Should show PENDING_UPLOAD for unfinished upload."""
        resp = requests.post(f'{api_url}/media/upload-init', json={
            'kind': 'image', 'mimeType': 'image/jpeg', 'sizeBytes': 1000, 'scope': 'posts'
        }, headers=_headers(media_user['token'], media_user['ip']))
        media_id = resp.json()['mediaId']

        status_resp = requests.get(f'{api_url}/media/upload-status/{media_id}',
                                   headers=_headers(media_user['token'], media_user['ip']))
        assert status_resp.status_code == 200
        data = status_resp.json()
        assert data['status'] == 'PENDING_UPLOAD'
        assert data['storageType'] == 'SUPABASE'

    def test_status_ready(self, api_url, media_user):
        """Should show READY after completion."""
        # Full flow
        resp = requests.post(f'{api_url}/media/upload-init', json={
            'kind': 'image', 'mimeType': 'image/jpeg', 'sizeBytes': len(TINY_JPEG), 'scope': 'posts'
        }, headers=_headers(media_user['token'], media_user['ip']))
        init_data = resp.json()
        requests.put(init_data['uploadUrl'], data=TINY_JPEG,
                     headers={'Content-Type': 'image/jpeg'})
        requests.post(f'{api_url}/media/upload-complete', json={
            'mediaId': init_data['mediaId']
        }, headers=_headers(media_user['token'], media_user['ip']))

        status_resp = requests.get(f'{api_url}/media/upload-status/{init_data["mediaId"]}',
                                   headers=_headers(media_user['token'], media_user['ip']))
        assert status_resp.status_code == 200
        assert status_resp.json()['status'] == 'READY'

    def test_status_not_found(self, api_url, media_user):
        """Should 404 for nonexistent ID."""
        resp = requests.get(f'{api_url}/media/upload-status/nonexistent-id',
                            headers=_headers(media_user['token'], media_user['ip']))
        assert resp.status_code == 404

    def test_status_requires_auth(self, api_url):
        """Should require authentication."""
        resp = requests.get(f'{api_url}/media/upload-status/some-id',
                            headers=_headers())
        assert resp.status_code == 401


# ============================================================
# LEGACY BASE64 UPLOAD (backward compatibility)
# ============================================================

class TestLegacyBase64Upload:
    """Tests for POST /api/media/upload (legacy base64)."""

    def test_legacy_upload_stores_in_supabase(self, api_url, media_user, db):
        """Legacy base64 upload should now go to Supabase."""
        b64 = base64.b64encode(TINY_JPEG).decode()
        resp = requests.post(f'{api_url}/media/upload', json={
            'data': b64, 'mimeType': 'image/jpeg', 'type': 'IMAGE'
        }, headers=_headers(media_user['token'], media_user['ip']))
        assert resp.status_code == 201
        data = resp.json()
        assert data['storageType'] == 'SUPABASE'
        assert 'supabase.co' in (data.get('publicUrl') or data.get('url', ''))

    def test_legacy_upload_requires_auth(self, api_url):
        """Should require authentication."""
        resp = requests.post(f'{api_url}/media/upload', json={
            'data': 'dGVzdA==', 'mimeType': 'image/jpeg'
        }, headers=_headers())
        assert resp.status_code == 401

    def test_legacy_upload_child_restricted(self, api_url, media_user_child):
        """Should block CHILD users."""
        resp = requests.post(f'{api_url}/media/upload', json={
            'data': 'dGVzdA==', 'mimeType': 'image/jpeg'
        }, headers=_headers(media_user_child['token'], media_user_child['ip']))
        assert resp.status_code == 403


# ============================================================
# MEDIA SERVE (GET /api/media/:id)
# ============================================================

class TestMediaServe:
    """Tests for GET /api/media/:id."""

    def _fresh_ip(self):
        import random
        return f'10.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(0,255)}'

    def test_serve_supabase_redirects(self, api_url, media_user_b):
        """Should 302 redirect to Supabase CDN for Supabase-stored media."""
        ip = self._fresh_ip()
        resp = _post_with_retry(f'{api_url}/media/upload-init', json={
            'kind': 'image', 'mimeType': 'image/jpeg', 'sizeBytes': len(TINY_JPEG), 'scope': 'posts'
        }, headers=_headers(media_user_b['token'], ip))
        assert resp.status_code == 201, f"Init failed: {resp.text}"
        init_data = resp.json()
        requests.put(init_data['uploadUrl'], data=TINY_JPEG,
                     headers={'Content-Type': 'image/jpeg'})
        _post_with_retry(f'{api_url}/media/upload-complete', json={
            'mediaId': init_data['mediaId']
        }, headers=_headers(media_user_b['token'], ip))

        serve_resp = _get_with_retry(f'{api_url}/media/{init_data["mediaId"]}',
                                     allow_redirects=False,
                                     headers=_headers(media_user_b['token'], ip))
        assert serve_resp.status_code == 302
        assert 'supabase.co' in serve_resp.headers['Location']

    def test_serve_supabase_follows_redirect(self, api_url, media_user_b):
        """Following the redirect should serve the file."""
        ip = self._fresh_ip()
        resp = _post_with_retry(f'{api_url}/media/upload-init', json={
            'kind': 'image', 'mimeType': 'image/jpeg', 'sizeBytes': len(TINY_JPEG), 'scope': 'posts'
        }, headers=_headers(media_user_b['token'], ip))
        assert resp.status_code == 201, f"Init failed: {resp.text}"
        init_data = resp.json()
        requests.put(init_data['uploadUrl'], data=TINY_JPEG,
                     headers={'Content-Type': 'image/jpeg'})
        _post_with_retry(f'{api_url}/media/upload-complete', json={
            'mediaId': init_data['mediaId']
        }, headers=_headers(media_user_b['token'], ip))

        serve_resp = _get_with_retry(f'{api_url}/media/{init_data["mediaId"]}',
                                     headers=_headers(media_user_b['token'], ip))
        assert serve_resp.status_code == 200
        assert len(serve_resp.content) == len(TINY_JPEG)

    def test_serve_nonexistent(self, api_url, media_user_b):
        """Should 404 for nonexistent media."""
        ip = self._fresh_ip()
        resp = _get_with_retry(f'{api_url}/media/nonexistent-id',
                               headers=_headers(media_user_b['token'], ip))
        assert resp.status_code == 404

    def test_serve_public_url_accessible(self, api_url, media_user_b):
        """Public URL from Supabase should be directly accessible without auth."""
        ip = self._fresh_ip()
        resp = _post_with_retry(f'{api_url}/media/upload-init', json={
            'kind': 'image', 'mimeType': 'image/jpeg', 'sizeBytes': len(TINY_JPEG), 'scope': 'posts'
        }, headers=_headers(media_user_b['token'], ip))
        assert resp.status_code == 201, f"Init failed: {resp.text}"
        init_data = resp.json()
        requests.put(init_data['uploadUrl'], data=TINY_JPEG,
                     headers={'Content-Type': 'image/jpeg'})
        complete_resp = _post_with_retry(f'{api_url}/media/upload-complete', json={
            'mediaId': init_data['mediaId']
        }, headers=_headers(media_user_b['token'], ip))
        public_url = complete_resp.json()['publicUrl']

        pub_resp = requests.get(public_url)
        assert pub_resp.status_code == 200


# ============================================================
# DB RECORD VERIFICATION
# ============================================================

class TestDBRecords:
    """Verify media_assets collection records."""

    def _fresh_ip(self):
        import random
        return f'10.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(0,255)}'

    def test_init_creates_pending_record(self, api_url, media_user_b, db):
        """upload-init should create a PENDING_UPLOAD record in DB."""
        ip = self._fresh_ip()
        resp = _post_with_retry(f'{api_url}/media/upload-init', json={
            'kind': 'image', 'mimeType': 'image/jpeg', 'sizeBytes': 12345, 'scope': 'stories'
        }, headers=_headers(media_user_b['token'], ip))
        assert resp.status_code == 201, f"Init failed: {resp.text}"
        media_id = resp.json()['mediaId']

        record = db.media_assets.find_one({'id': media_id}, {'_id': 0})
        assert record is not None
        assert record['status'] == 'PENDING_UPLOAD'
        assert record['storageType'] == 'SUPABASE'
        assert record['ownerId'] == media_user_b['userId']
        assert record['mimeType'] == 'image/jpeg'
        assert record['sizeBytes'] == 12345
        assert record['scope'] == 'stories'
        assert 'stories/' in record['storagePath']

    def test_complete_updates_record_to_ready(self, api_url, media_user_b, db):
        """upload-complete should update status to READY with dimensions."""
        ip = self._fresh_ip()
        resp = _post_with_retry(f'{api_url}/media/upload-init', json={
            'kind': 'image', 'mimeType': 'image/jpeg', 'sizeBytes': len(TINY_JPEG), 'scope': 'posts'
        }, headers=_headers(media_user_b['token'], ip))
        assert resp.status_code == 201, f"Init failed: {resp.text}"
        init_data = resp.json()
        requests.put(init_data['uploadUrl'], data=TINY_JPEG,
                     headers={'Content-Type': 'image/jpeg'})
        _post_with_retry(f'{api_url}/media/upload-complete', json={
            'mediaId': init_data['mediaId'], 'width': 800, 'height': 600
        }, headers=_headers(media_user_b['token'], ip))

        record = db.media_assets.find_one({'id': init_data['mediaId']}, {'_id': 0})
        assert record['status'] == 'READY'
        assert record['width'] == 800
        assert record['height'] == 600
        assert record['completedAt'] is not None
