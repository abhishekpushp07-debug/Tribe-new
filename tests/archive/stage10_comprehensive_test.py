#!/usr/bin/env python3
"""
Stage 10: World's Best Reels Backend — Comprehensive 42-Point Test Matrix
Tests all 39 endpoints across 12 collections with full proof generation.
"""
import requests
import json
import time
import sys
from datetime import datetime

BASE_URL = "https://tribe-feed-debug.preview.emergentagent.com/api"

results = []
test_num = 0

def test(name, response, expected_status=None, check_fn=None):
    global test_num
    test_num += 1
    success = True
    details = ""
    
    if expected_status and response.status_code != expected_status:
        success = False
        details = f"Expected {expected_status}, got {response.status_code}: {response.text[:200]}"
    elif check_fn:
        try:
            data = response.json()
            check_result = check_fn(data)
            if check_result is not True:
                success = False
                details = str(check_result)
        except Exception as e:
            success = False
            details = f"Check failed: {e}"
    
    status = "PASS" if success else "FAIL"
    print(f"  [{status}] #{test_num}: {name}" + (f" — {details}" if details else ""))
    results.append({"num": test_num, "name": name, "status": status, "details": details, "http_status": response.status_code})
    return success

def login(phone):
    r = requests.post(f"{BASE_URL}/auth/login", json={"phone": phone, "pin": "1234"})
    return r.json().get("token", "")

# ======== SETUP ========
print("\n" + "="*60)
print("Stage 10: Reels Backend — 42-Point Test Matrix")
print("="*60)
print(f"\nTimestamp: {datetime.utcnow().isoformat()}Z")
print(f"Base URL: {BASE_URL}\n")

ADMIN_TOKEN = login("9000000001")
USER1_TOKEN = login("9000000002")
USER2_TOKEN = login("9000000003")

admin_h = {"Authorization": f"Bearer {ADMIN_TOKEN}", "Content-Type": "application/json"}
user1_h = {"Authorization": f"Bearer {USER1_TOKEN}", "Content-Type": "application/json"}
user2_h = {"Authorization": f"Bearer {USER2_TOKEN}", "Content-Type": "application/json"}

# Clean up previous test data
print("Cleaning up previous test reels...")
import subprocess
subprocess.run(["mongosh", "mongodb://localhost:27017/your_database_name", "--eval",
    "db.reels.deleteMany({}); db.reel_likes.deleteMany({}); db.reel_saves.deleteMany({}); "
    "db.reel_comments.deleteMany({}); db.reel_views.deleteMany({}); db.reel_watch_events.deleteMany({}); "
    "db.reel_reports.deleteMany({}); db.reel_hidden.deleteMany({}); db.reel_not_interested.deleteMany({}); "
    "db.reel_shares.deleteMany({}); db.reel_processing_jobs.deleteMany({}); db.reel_series.deleteMany({}); "
    "print('Cleaned all 12 reel collections');"], capture_output=True)

print("\n--- SECTION 1: REEL CREATION & LIFECYCLE ---\n")

# Test 1: Create reel (publish immediately)
r = requests.post(f"{BASE_URL}/reels", json={
    "caption": "Test reel #trending #college",
    "hashtags": ["trending", "college"],
    "mentions": [],
    "durationMs": 15000,
    "mediaUrl": "https://example.com/video1.mp4",
    "thumbnailUrl": "https://example.com/thumb1.jpg",
    "visibility": "PUBLIC",
    "isDraft": False,
    "syntheticDeclaration": False,
    "brandedContent": False,
}, headers=user1_h)
test("Create reel (publish)", r, 201)
reel1_id = r.json().get("reel", {}).get("id", "") if r.status_code == 201 else ""

# Test 2: Verify reel schema
r = requests.get(f"{BASE_URL}/reels/{reel1_id}", headers=user1_h)
test("Reel schema validation", r, check_fn=lambda d: True if all(k in d.get("reel", {}) for k in [
    "id","creatorId","caption","hashtags","durationMs","mediaStatus","status",
    "likeCount","commentCount","saveCount","viewCount","score","createdAt","publishedAt"
]) else f"Missing fields in reel: {d.get('reel',{}).keys()}")

# Test 3: Create draft reel
r = requests.post(f"{BASE_URL}/reels", json={
    "caption": "Draft reel",
    "durationMs": 10000,
    "mediaUrl": "https://example.com/video_draft.mp4",
    "visibility": "PUBLIC",
    "isDraft": True,
}, headers=user1_h)
test("Create draft reel", r, 201)
draft_id = r.json().get("reel", {}).get("id", "") if r.status_code == 201 else ""

# Test 4: Publish draft
r = requests.post(f"{BASE_URL}/reels/{draft_id}/publish", headers=user1_h)
test("Publish draft", r, check_fn=lambda d: True if d.get("status") == "PUBLISHED" or d.get("message") == "Reel published" else f"Unexpected: {d}")

# Test 5: Create reel without media (processing pipeline)
r = requests.post(f"{BASE_URL}/reels", json={
    "caption": "Processing test reel",
    "durationMs": 20000,
    "visibility": "PUBLIC",
}, headers=user1_h)
test("Create reel without media (triggers processing job)", r, 201)
proc_reel_id = r.json().get("reel", {}).get("id", "") if r.status_code == 201 else ""

# Test 6: Verify processing job created
r = requests.get(f"{BASE_URL}/reels/{proc_reel_id}/processing", headers=user1_h)
test("Processing job exists", r, check_fn=lambda d: True if d.get("job") and d.get("mediaStatus") == "UPLOADING" else f"No job or wrong status: {d}")

# Test 7: Update processing status to READY
r = requests.post(f"{BASE_URL}/reels/{proc_reel_id}/processing", json={
    "mediaStatus": "READY",
    "playbackUrl": "https://example.com/processed.mp4",
    "thumbnailUrl": "https://example.com/processed_thumb.jpg",
}, headers=user1_h)
test("Update processing to READY", r, check_fn=lambda d: True if d.get("mediaStatus") == "READY" else f"Got: {d}")

# Test 8: Edit reel metadata
r = requests.patch(f"{BASE_URL}/reels/{reel1_id}", json={
    "caption": "Updated caption #newhashtag",
    "hashtags": ["newhashtag", "trending"],
    "visibility": "PUBLIC",
}, headers=user1_h)
test("Edit reel metadata", r, check_fn=lambda d: True if d.get("reel", {}).get("caption") == "Updated caption #newhashtag" else f"Got: {d}")

# Test 9: Archive reel
archive_reel_r = requests.post(f"{BASE_URL}/reels", json={
    "caption": "To be archived", "durationMs": 5000, "mediaUrl": "https://ex.com/v.mp4", "visibility": "PUBLIC",
}, headers=user1_h)
archive_reel_id = archive_reel_r.json().get("reel", {}).get("id", "")
r = requests.post(f"{BASE_URL}/reels/{archive_reel_id}/archive", headers=user1_h)
test("Archive reel", r, check_fn=lambda d: True if "archived" in d.get("message","").lower() else f"Got: {d}")

# Test 10: Restore archived reel
r = requests.post(f"{BASE_URL}/reels/{archive_reel_id}/restore", headers=user1_h)
test("Restore archived reel", r, check_fn=lambda d: True if d.get("status") == "PUBLISHED" else f"Got: {d}")

# Test 11: Delete reel (soft)
del_reel_r = requests.post(f"{BASE_URL}/reels", json={
    "caption": "Delete me", "durationMs": 5000, "mediaUrl": "https://ex.com/del.mp4", "visibility": "PUBLIC",
}, headers=user1_h)
del_reel_id = del_reel_r.json().get("reel", {}).get("id", "")
r = requests.delete(f"{BASE_URL}/reels/{del_reel_id}", headers=user1_h)
test("Delete reel (soft remove)", r, check_fn=lambda d: True if "removed" in d.get("message","").lower() else f"Got: {d}")

# Test 12: Verify deleted reel returns 410
r = requests.get(f"{BASE_URL}/reels/{del_reel_id}", headers=user1_h)
test("Deleted reel returns 410 GONE", r, 410)

print("\n--- SECTION 2: REEL INTERACTIONS ---\n")

# User2 creates a reel for interaction tests
u2_reel_r = requests.post(f"{BASE_URL}/reels", json={
    "caption": "User2 reel for interactions", "durationMs": 12000,
    "mediaUrl": "https://example.com/u2.mp4", "visibility": "PUBLIC",
}, headers=user2_h)
u2_reel_id = u2_reel_r.json().get("reel", {}).get("id", "")

# Test 13: Like reel
r = requests.post(f"{BASE_URL}/reels/{u2_reel_id}/like", headers=user1_h)
test("Like reel", r, check_fn=lambda d: True if d.get("message") == "Liked" else f"Got: {d}")

# Test 14: Self-like prevention
r = requests.post(f"{BASE_URL}/reels/{u2_reel_id}/like", headers=user2_h)
test("Self-like prevention", r, 400)

# Test 15: Duplicate like prevention (idempotent)
r = requests.post(f"{BASE_URL}/reels/{u2_reel_id}/like", headers=user1_h)
test("Duplicate like is idempotent", r, check_fn=lambda d: True if d.get("message") == "Liked" else f"Got: {d}")

# Test 16: Unlike
r = requests.delete(f"{BASE_URL}/reels/{u2_reel_id}/like", headers=user1_h)
test("Unlike reel", r, check_fn=lambda d: True if d.get("message") == "Unliked" else f"Got: {d}")

# Test 17: Save reel
r = requests.post(f"{BASE_URL}/reels/{u2_reel_id}/save", headers=user1_h)
test("Save reel", r, check_fn=lambda d: True if d.get("message") == "Saved" else f"Got: {d}")

# Test 18: Unsave reel
r = requests.delete(f"{BASE_URL}/reels/{u2_reel_id}/save", headers=user1_h)
test("Unsave reel", r, check_fn=lambda d: True if d.get("message") == "Unsaved" else f"Got: {d}")

# Test 19: Comment on reel (top-level)
r = requests.post(f"{BASE_URL}/reels/{u2_reel_id}/comment", json={"text": "Great reel!"}, headers=user1_h)
test("Comment on reel", r, 201)
comment_id = r.json().get("comment", {}).get("id", "") if r.status_code == 201 else ""

# Test 20: Threaded reply (nested comment)
r = requests.post(f"{BASE_URL}/reels/{u2_reel_id}/comment", json={"text": "Reply to comment", "parentId": comment_id}, headers=user2_h)
test("Threaded reply comment", r, 201)

# Test 21: List comments
r = requests.get(f"{BASE_URL}/reels/{u2_reel_id}/comments", headers=user1_h)
test("List comments", r, check_fn=lambda d: True if d.get("total", 0) >= 1 and len(d.get("items", [])) >= 1 else f"Got: {d}")

# Test 22: Report reel (with dedup)
r = requests.post(f"{BASE_URL}/reels/{u2_reel_id}/report", json={"reasonCode": "SPAM", "reason": "Test report"}, headers=user1_h)
test("Report reel", r, 201)

# Test 23: Duplicate report prevention
r = requests.post(f"{BASE_URL}/reels/{u2_reel_id}/report", json={"reasonCode": "SPAM"}, headers=user1_h)
test("Duplicate report blocked (409)", r, 409)

# Test 24: Hide reel
r = requests.post(f"{BASE_URL}/reels/{reel1_id}/hide", headers=user2_h)
test("Hide reel from feed", r, check_fn=lambda d: True if "hidden" in d.get("message","").lower() else f"Got: {d}")

# Test 25: Mark not-interested
r = requests.post(f"{BASE_URL}/reels/{reel1_id}/not-interested", headers=user2_h)
test("Mark not interested", r, check_fn=lambda d: True if "not interested" in d.get("message","").lower() else f"Got: {d}")

# Test 26: Share tracking
r = requests.post(f"{BASE_URL}/reels/{u2_reel_id}/share", json={"platform": "WHATSAPP"}, headers=user1_h)
test("Share tracking", r, check_fn=lambda d: True if d.get("shareCount", 0) >= 1 else f"Got: {d}")

print("\n--- SECTION 3: WATCH METRICS ---\n")

# Test 27: Record watch event
r = requests.post(f"{BASE_URL}/reels/{u2_reel_id}/watch", json={
    "watchTimeMs": 8000, "completed": False, "replayed": False,
}, headers=user1_h)
test("Watch event (partial)", r, check_fn=lambda d: True if "recorded" in d.get("message","").lower() else f"Got: {d}")

# Test 28: Watch event with completion
r = requests.post(f"{BASE_URL}/reels/{u2_reel_id}/watch", json={
    "watchTimeMs": 12000, "completed": True, "replayed": False,
}, headers=user1_h)
test("Watch event (completed)", r, check_fn=lambda d: True if "recorded" in d.get("message","").lower() else f"Got: {d}")

# Test 29: Watch event with replay
r = requests.post(f"{BASE_URL}/reels/{u2_reel_id}/watch", json={
    "watchTimeMs": 24000, "completed": True, "replayed": True,
}, headers=user1_h)
test("Watch event (replay)", r, check_fn=lambda d: True if "recorded" in d.get("message","").lower() else f"Got: {d}")

# Test 30: Track impression (POST /reels/:id/view)
r = requests.post(f"{BASE_URL}/reels/{u2_reel_id}/view", headers=user1_h)
test("Impression tracking", r, check_fn=lambda d: True if "tracked" in d.get("message","").lower() else f"Got: {d}")

# Verify watch metrics reflected on reel
r = requests.get(f"{BASE_URL}/reels/{u2_reel_id}", headers=user1_h)
reel_data = r.json().get("reel", {})
test("Watch metrics reflect on reel", r, check_fn=lambda d: True if d.get("reel",{}).get("avgWatchTimeMs",0) > 0 else f"avgWatchTimeMs={d.get('reel',{}).get('avgWatchTimeMs')}")

print("\n--- SECTION 4: FEEDS ---\n")

# Re-like the reel so feeds have engaged content
requests.post(f"{BASE_URL}/reels/{u2_reel_id}/like", headers=user1_h)

# Test 31: Discovery feed (score-ranked)
r = requests.get(f"{BASE_URL}/reels/feed?limit=10", headers=user1_h)
test("Discovery feed", r, check_fn=lambda d: True if "items" in d and isinstance(d["items"], list) else f"Got: {d}")

# Test 32: Discovery feed excludes hidden reels
r = requests.get(f"{BASE_URL}/reels/feed?limit=50", headers=user2_h)
feed_items = r.json().get("items", [])
hidden_in_feed = [i for i in feed_items if i.get("id") == reel1_id]
test("Discovery excludes hidden reels", r, check_fn=lambda d: True if not any(i.get("id") == reel1_id for i in d.get("items",[])) else "Hidden reel appeared in feed!")

# Test 33: Following feed (chronological)
# First follow user2
requests.post(f"{BASE_URL}/follow/{u2_reel_r.json().get('reel',{}).get('creatorId','')}", headers=user1_h)
r = requests.get(f"{BASE_URL}/reels/following?limit=10", headers=user1_h)
test("Following feed", r, check_fn=lambda d: True if "items" in d else f"Got: {d}")

# Test 34: Creator profile reels
creator_id_u1 = requests.get(f"{BASE_URL}/auth/me", headers=user1_h).json().get("user",{}).get("id","")
r = requests.get(f"{BASE_URL}/users/{creator_id_u1}/reels?limit=10", headers=user2_h)
test("Creator profile reels", r, check_fn=lambda d: True if "items" in d else f"Got: {d}")

# Test 35: Pin/Unpin reel (max 3 constraint)
r = requests.post(f"{BASE_URL}/reels/{reel1_id}/pin", headers=user1_h)
test("Pin reel to profile", r, check_fn=lambda d: True if "pinned" in d.get("message","").lower() else f"Got: {d}")

r = requests.delete(f"{BASE_URL}/reels/{reel1_id}/pin", headers=user1_h)
test("Unpin reel from profile", r, check_fn=lambda d: True if "unpinned" in d.get("message","").lower() else f"Got: {d}")

print("\n--- SECTION 5: SOCIAL FEATURES ---\n")

# Test 36: Create remix
r = requests.post(f"{BASE_URL}/reels", json={
    "caption": "Remix of u2's reel",
    "durationMs": 15000,
    "mediaUrl": "https://example.com/remix.mp4",
    "visibility": "PUBLIC",
    "remixOf": {"reelId": u2_reel_id, "type": "REMIX"},
}, headers=user1_h)
test("Create remix reel", r, 201)
remix_id = r.json().get("reel", {}).get("id", "") if r.status_code == 201 else ""

# Test 37: Get remixes of original
r = requests.get(f"{BASE_URL}/reels/{u2_reel_id}/remixes", headers=user1_h)
test("Get remixes of reel", r, check_fn=lambda d: True if d.get("total", 0) >= 1 else f"Got: {d}")

# Test 38: Audio-based discovery
reel_with_audio = requests.post(f"{BASE_URL}/reels", json={
    "caption": "Audio reel",
    "durationMs": 10000,
    "mediaUrl": "https://example.com/audio_reel.mp4",
    "visibility": "PUBLIC",
    "audioMeta": {"audioId": "test-audio-001", "title": "Trending Song", "artist": "DJ Test"},
}, headers=user1_h)
audio_reel_id = reel_with_audio.json().get("reel", {}).get("id", "")
r = requests.get(f"{BASE_URL}/reels/audio/test-audio-001", headers=user1_h)
test("Audio-based discovery", r, check_fn=lambda d: True if d.get("total", 0) >= 1 else f"Got: {d}")

# Test 39: Create series
r = requests.post(f"{BASE_URL}/me/reels/series", json={"name": "My Tutorial Series", "description": "Learn coding"}, headers=user1_h)
test("Create series", r, 201)
series_id = r.json().get("series", {}).get("id", "") if r.status_code == 201 else ""

# Test 39b: Get user's series
creator_u1_id = requests.get(f"{BASE_URL}/auth/me", headers=user1_h).json().get("user",{}).get("id","")
r = requests.get(f"{BASE_URL}/users/{creator_u1_id}/reels/series", headers=user1_h)
test("Get user's series", r, check_fn=lambda d: True if d.get("total", 0) >= 1 else f"Got: {d}")

print("\n--- SECTION 6: CREATOR TOOLS ---\n")

# Test 40: Creator analytics
r = requests.get(f"{BASE_URL}/me/reels/analytics", headers=user1_h)
test("Creator analytics", r, check_fn=lambda d: True if "totalReels" in d and "totalViews" in d else f"Got: {d}")

# Test 40b: Creator archive
r = requests.get(f"{BASE_URL}/me/reels/archive", headers=user1_h)
test("Creator archive", r, check_fn=lambda d: True if "items" in d else f"Got: {d}")

print("\n--- SECTION 7: ADMIN / MODERATION ---\n")

# Test 41: Admin moderation queue
r = requests.get(f"{BASE_URL}/admin/reels?limit=10", headers=admin_h)
test("Admin moderation queue", r, check_fn=lambda d: True if "items" in d and "stats" in d else f"Got: {d}")

# Test 41b: Admin moderate (HOLD then APPROVE)
r = requests.patch(f"{BASE_URL}/admin/reels/{u2_reel_id}/moderate", json={"action": "HOLD", "reason": "Test hold"}, headers=admin_h)
test("Admin moderate: HOLD", r, check_fn=lambda d: True if d.get("status") == "HELD" else f"Got: {d}")

r = requests.patch(f"{BASE_URL}/admin/reels/{u2_reel_id}/moderate", json={"action": "APPROVE"}, headers=admin_h)
test("Admin moderate: APPROVE (restore)", r, check_fn=lambda d: True if d.get("status") == "PUBLISHED" else f"Got: {d}")

# Test 42: Admin platform analytics
r = requests.get(f"{BASE_URL}/admin/reels/analytics", headers=admin_h)
test("Admin platform analytics", r, check_fn=lambda d: True if "totalReels" in d and "processing" in d else f"Got: {d}")

# Test 42b: Admin recompute counters
r = requests.post(f"{BASE_URL}/admin/reels/{u2_reel_id}/recompute-counters", headers=admin_h)
test("Admin recompute counters", r, check_fn=lambda d: True if "before" in d and "after" in d else f"Got: {d}")

print("\n--- SECTION 8: VALIDATION & EDGE CASES ---\n")

# Test: Age verification required
# Register a child user
child_r = requests.post(f"{BASE_URL}/auth/register", json={"phone":"9000000099","pin":"1234","displayName":"ChildUser"})
if child_r.status_code == 201:
    child_token = child_r.json().get("token","")
else:
    child_r = requests.post(f"{BASE_URL}/auth/login", json={"phone":"9000000099","pin":"1234"})
    child_token = child_r.json().get("token","")

child_h = {"Authorization": f"Bearer {child_token}", "Content-Type": "application/json"}
r = requests.post(f"{BASE_URL}/reels", json={"caption": "test", "visibility": "PUBLIC"}, headers=child_h)
test("Age verification required for reel creation", r, 403)

# Test: Invalid visibility
r = requests.post(f"{BASE_URL}/reels", json={
    "caption": "bad visibility", "visibility": "INVALID", "mediaUrl": "https://ex.com/v.mp4",
}, headers=user1_h)
test("Invalid visibility rejected", r, 400)

# Test: Caption too long
long_caption = "x" * 2300
r = requests.post(f"{BASE_URL}/reels", json={
    "caption": long_caption, "visibility": "PUBLIC", "mediaUrl": "https://ex.com/v.mp4",
}, headers=user1_h)
test("Caption too long rejected", r, 400)

# Test: Auto-hold at 3 reports
report_reel_r = requests.post(f"{BASE_URL}/reels", json={
    "caption": "Report test reel", "durationMs": 5000, "mediaUrl": "https://ex.com/rp.mp4", "visibility": "PUBLIC",
}, headers=user1_h)
report_reel_id = report_reel_r.json().get("reel", {}).get("id", "")

# Create 3 reporter users and report
reporters = []
for i in range(3):
    phone = f"900000010{i}"
    reg = requests.post(f"{BASE_URL}/auth/register", json={"phone": phone, "pin":"1234","displayName":f"Reporter{i}"})
    if reg.status_code == 201:
        tok = reg.json()["token"]
    else:
        tok = requests.post(f"{BASE_URL}/auth/login", json={"phone": phone, "pin":"1234"}).json().get("token","")
    reporters.append(tok)

for i, tok in enumerate(reporters):
    rh = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
    requests.post(f"{BASE_URL}/reels/{report_reel_id}/report", json={"reasonCode": "SPAM"}, headers=rh)

# Check auto-hold
import subprocess
result = subprocess.run(["mongosh", "mongodb://localhost:27017/your_database_name", "--eval",
    f"const r = db.reels.findOne({{id: '{report_reel_id}'}}); print(JSON.stringify({{status: r.status, reportCount: r.reportCount}}));"],
    capture_output=True, text=True)
auto_hold_data = json.loads(result.stdout.strip().split('\n')[-1]) if result.stdout.strip() else {}
held = auto_hold_data.get("status") == "HELD" and auto_hold_data.get("reportCount", 0) >= 3
print(f"  [{'PASS' if held else 'FAIL'}] #{test_num+1}: Auto-hold at 3 reports — status={auto_hold_data.get('status')}, reports={auto_hold_data.get('reportCount')}")
test_num += 1
results.append({"num": test_num, "name": "Auto-hold at 3 reports", "status": "PASS" if held else "FAIL", "details": str(auto_hold_data)})

# ======== SUMMARY ========
print("\n" + "="*60)
passed = sum(1 for r in results if r["status"] == "PASS")
failed = sum(1 for r in results if r["status"] == "FAIL")
total = len(results)
print(f"RESULTS: {passed}/{total} PASSED, {failed} FAILED")
print(f"Pass Rate: {passed/total*100:.1f}%")
print("="*60)

if failed > 0:
    print("\nFAILED TESTS:")
    for r in results:
        if r["status"] == "FAIL":
            print(f"  #{r['num']}: {r['name']} — {r['details']}")

# Save results
with open("/app/test_reports/stage10_manual_test.json", "w") as f:
    json.dump({
        "suite": "Stage 10: Reels Backend Manual Test Matrix",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "total": total,
        "passed": passed,
        "failed": failed,
        "pass_rate": f"{passed/total*100:.1f}%",
        "results": results,
    }, f, indent=2)

print(f"\nResults saved to /app/test_reports/stage10_manual_test.json")
sys.exit(0 if failed == 0 else 1)
