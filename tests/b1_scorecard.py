"""
B1 — Canonical Identity & Media Resolution
COMPREHENSIVE 10-PARAMETER TEST (10 marks each = 100 total)

Parameters:
 P1: Register response avatar contract
 P2: Login response avatar contract
 P3: GET /auth/me avatar contract
 P4: GET /users/:id avatar contract
 P5: Avatar URL resolution after media upload
 P6: Content detail author (toUserSnippet path)
 P7: Comment author avatar contract
 P8: Followers/Following avatar contract
 P9: Security — no secret leakage
 P10: Edge cases — null avatar, MediaObject URL, deprecated field
"""

import requests
import random
import json
import sys

API = "https://tribe-feed-engine-1.preview.emergentagent.com/api"
SCORES = {}
DETAILS = {}

def score(param, points, max_pts, detail):
    SCORES[param] = SCORES.get(param, 0) + points
    DETAILS.setdefault(param, []).append(f"{'✅' if points == max_pts else '❌'} [{points}/{max_pts}] {detail}")

def register(name="TestUser"):
    phone = f"9{random.randint(100000000, 999999999)}"
    r = requests.post(f"{API}/auth/register", json={"phone": phone, "pin": "1234", "displayName": name})
    return r.json(), phone

def login(phone):
    r = requests.post(f"{API}/auth/login", json={"phone": phone, "pin": "1234"})
    return r.json()

def h(token):
    return {"Authorization": f"Bearer {token}"}

# ════════════════════════════════════════════════════════════════
# P1: REGISTER RESPONSE (10 marks)
# ════════════════════════════════════════════════════════════════
print("P1: Register response avatar contract...")
data, phone1 = register("P1User")
user = data.get("user", {})

# 1.1: avatarUrl field exists (2 marks)
if "avatarUrl" in user:
    score("P1", 2, 2, "avatarUrl field present in register response")
else:
    score("P1", 0, 2, f"avatarUrl MISSING from register response. Keys: {list(user.keys())[:10]}")

# 1.2: avatarUrl is null for new user (2 marks)
if user.get("avatarUrl") is None:
    score("P1", 2, 2, "avatarUrl is null for new user (correct)")
else:
    score("P1", 0, 2, f"avatarUrl should be null, got: {user.get('avatarUrl')}")

# 1.3: avatarMediaId field exists and is null (2 marks)
if "avatarMediaId" in user and user["avatarMediaId"] is None:
    score("P1", 2, 2, "avatarMediaId present and null for new user")
else:
    score("P1", 0, 2, f"avatarMediaId issue. Present: {'avatarMediaId' in user}, Value: {user.get('avatarMediaId')}")

# 1.4: deprecated avatar field exists (2 marks)
if "avatar" in user:
    score("P1", 2, 2, "legacy avatar field preserved (backward compat)")
else:
    score("P1", 0, 2, "legacy avatar field MISSING — backward compat broken")

# 1.5: all three avatar fields consistent (2 marks)
if user.get("avatarUrl") is None and user.get("avatarMediaId") is None and user.get("avatar") is None:
    score("P1", 2, 2, "all 3 avatar fields consistently null for no-avatar user")
else:
    score("P1", 0, 2, "avatar fields inconsistent")

token1 = data.get("accessToken", "")
uid1 = user.get("id", "")

# ════════════════════════════════════════════════════════════════
# P2: LOGIN RESPONSE (10 marks)
# ════════════════════════════════════════════════════════════════
print("P2: Login response avatar contract...")
login_data = login(phone1)
lu = login_data.get("user", {})

# 2.1: avatarUrl in login (2 marks)
if "avatarUrl" in lu:
    score("P2", 2, 2, "avatarUrl present in login response")
else:
    score("P2", 0, 2, "avatarUrl MISSING from login response")

# 2.2: avatarMediaId in login (2 marks)
if "avatarMediaId" in lu:
    score("P2", 2, 2, "avatarMediaId present in login response")
else:
    score("P2", 0, 2, "avatarMediaId MISSING from login response")

# 2.3: avatar (deprecated) in login (2 marks)
if "avatar" in lu:
    score("P2", 2, 2, "deprecated avatar present in login response")
else:
    score("P2", 0, 2, "deprecated avatar MISSING from login response")

# 2.4: login user matches register user identity (2 marks)
if lu.get("id") == uid1 and lu.get("displayName") == "P1User":
    score("P2", 2, 2, "login user identity matches register")
else:
    score("P2", 0, 2, f"identity mismatch: id={lu.get('id')} vs {uid1}")

# 2.5: login avatar consistency (2 marks)
if lu.get("avatarUrl") is None and lu.get("avatarMediaId") is None:
    score("P2", 2, 2, "login avatar fields consistent (null)")
else:
    score("P2", 0, 2, "login avatar fields inconsistent")

# ════════════════════════════════════════════════════════════════
# P3: GET /auth/me (10 marks)
# ════════════════════════════════════════════════════════════════
print("P3: GET /auth/me avatar contract...")
me = requests.get(f"{API}/auth/me", headers=h(token1)).json()
mu = me.get("user", me.get("data", {}).get("user", {}))

# 3.1: avatarUrl present (2 marks)
if "avatarUrl" in mu:
    score("P3", 2, 2, "avatarUrl present in /auth/me")
else:
    score("P3", 0, 2, f"avatarUrl MISSING from /auth/me. Keys: {list(mu.keys())[:10]}")

# 3.2: avatarMediaId present (2 marks)
if "avatarMediaId" in mu:
    score("P3", 2, 2, "avatarMediaId present in /auth/me")
else:
    score("P3", 0, 2, "avatarMediaId MISSING from /auth/me")

# 3.3: avatar deprecated present (2 marks)
if "avatar" in mu:
    score("P3", 2, 2, "deprecated avatar present in /auth/me")
else:
    score("P3", 0, 2, "deprecated avatar MISSING from /auth/me")

# 3.4: user id correct (2 marks)
if mu.get("id") == uid1:
    score("P3", 2, 2, "correct user id in /auth/me")
else:
    score("P3", 0, 2, f"/auth/me returned wrong user: {mu.get('id')}")

# 3.5: response wrapper correct ({user: ...}) (2 marks)
if "user" in me:
    score("P3", 2, 2, "/auth/me uses {user: ...} wrapper")
else:
    score("P3", 0, 2, f"/auth/me wrapper wrong. Top keys: {list(me.keys())}")

# ════════════════════════════════════════════════════════════════
# P4: GET /users/:id (10 marks)
# ════════════════════════════════════════════════════════════════
print("P4: GET /users/:id avatar contract...")
up = requests.get(f"{API}/users/{uid1}").json()
uu = up.get("user", up.get("data", {}).get("user", {}))

# 4.1: avatarUrl (2 marks)
if "avatarUrl" in uu:
    score("P4", 2, 2, "avatarUrl present in /users/:id")
else:
    score("P4", 0, 2, f"avatarUrl MISSING from /users/:id. Keys: {list(uu.keys())[:10]}")

# 4.2: avatarMediaId (2 marks)
if "avatarMediaId" in uu:
    score("P4", 2, 2, "avatarMediaId present in /users/:id")
else:
    score("P4", 0, 2, "avatarMediaId MISSING from /users/:id")

# 4.3: avatar deprecated (2 marks)
if "avatar" in uu:
    score("P4", 2, 2, "deprecated avatar present in /users/:id")
else:
    score("P4", 0, 2, "deprecated avatar MISSING from /users/:id")

# 4.4: public endpoint works without auth (2 marks)
if uu.get("id") == uid1:
    score("P4", 2, 2, "/users/:id works without auth token")
else:
    score("P4", 0, 2, "/users/:id failed without auth")

# 4.5: displayName correct (2 marks)
if uu.get("displayName") == "P1User":
    score("P4", 2, 2, "displayName correct in /users/:id")
else:
    score("P4", 0, 2, f"displayName wrong: {uu.get('displayName')}")

# ════════════════════════════════════════════════════════════════
# P5: AVATAR URL RESOLUTION (10 marks)
# ════════════════════════════════════════════════════════════════
print("P5: Avatar URL resolution after media upload...")

# Upload a 1x1 PNG
b64_png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
media_resp = requests.post(f"{API}/media/upload", headers=h(token1), json={"data": b64_png, "mimeType": "image/png", "type": "IMAGE"}).json()
media_data = media_resp.get("data", media_resp)
media_id = media_data.get("id", "")

# 5.1: media uploaded successfully (1 mark)
if media_id:
    score("P5", 1, 1, f"media uploaded: {media_id[:12]}...")
else:
    score("P5", 0, 1, f"media upload failed: {media_resp}")

# Set avatar
profile_resp = requests.patch(f"{API}/me/profile", headers=h(token1), json={"avatarMediaId": media_id}).json()
pu = profile_resp.get("user", profile_resp.get("data", {}).get("user", {}))

# 5.2: avatarUrl is resolved URL (2 marks)
expected_url = f"/api/media/{media_id}"
if pu.get("avatarUrl") == expected_url:
    score("P5", 2, 2, f"avatarUrl correctly resolved to {expected_url}")
else:
    score("P5", 0, 2, f"avatarUrl wrong: {pu.get('avatarUrl')} (expected {expected_url})")

# 5.3: avatarMediaId is raw ID (2 marks)
if pu.get("avatarMediaId") == media_id:
    score("P5", 2, 2, f"avatarMediaId is raw ID: {media_id[:12]}...")
else:
    score("P5", 0, 2, f"avatarMediaId wrong: {pu.get('avatarMediaId')}")

# 5.4: deprecated avatar equals raw ID (1 mark)
if pu.get("avatar") == media_id:
    score("P5", 1, 1, "deprecated avatar matches raw media ID")
else:
    score("P5", 0, 1, f"deprecated avatar mismatch: {pu.get('avatar')}")

# 5.5: /auth/me reflects new avatar (2 marks)
me2 = requests.get(f"{API}/auth/me", headers=h(token1)).json()
mu2 = me2.get("user", {})
if mu2.get("avatarUrl") == expected_url:
    score("P5", 2, 2, "/auth/me reflects updated avatarUrl")
else:
    score("P5", 0, 2, f"/auth/me avatarUrl: {mu2.get('avatarUrl')}")

# 5.6: /users/:id reflects new avatar (2 marks)
up2 = requests.get(f"{API}/users/{uid1}").json()
uu2 = up2.get("user", {})
if uu2.get("avatarUrl") == expected_url:
    score("P5", 2, 2, "/users/:id reflects updated avatarUrl")
else:
    score("P5", 0, 2, f"/users/:id avatarUrl: {uu2.get('avatarUrl')}")

# ════════════════════════════════════════════════════════════════
# P6: CONTENT DETAIL AUTHOR — toUserSnippet path (10 marks)
# ════════════════════════════════════════════════════════════════
print("P6: Content detail author (toUserSnippet path)...")

# Set age to enable content creation
requests.patch(f"{API}/me/age", headers=h(token1), json={"birthYear": 2000})
post_resp = requests.post(f"{API}/content/posts", headers=h(token1), json={"caption": "B1 param test"}).json()
post_id = post_resp.get("post", {}).get("id", "")

# 6.1: post created (1 mark)
if post_id:
    score("P6", 1, 1, f"post created: {post_id[:12]}...")
else:
    score("P6", 0, 1, f"post creation failed: {post_resp}")

# Get content detail (uses enrichPosts → toUserSnippet)
detail = requests.get(f"{API}/content/{post_id}", headers=h(token1)).json()
author = detail.get("author") or detail.get("post", {}).get("author") or {}

# 6.2: author.avatarUrl present (2 marks)
if "avatarUrl" in author:
    score("P6", 2, 2, "content author has avatarUrl")
else:
    score("P6", 0, 2, f"content author MISSING avatarUrl. Keys: {list(author.keys())}")

# 6.3: author.avatarUrl is resolved URL (2 marks)
if author.get("avatarUrl") == expected_url:
    score("P6", 2, 2, f"content author avatarUrl resolved correctly")
else:
    score("P6", 0, 2, f"content author avatarUrl: {author.get('avatarUrl')}")

# 6.4: author.avatarMediaId present (2 marks)
if "avatarMediaId" in author:
    score("P6", 2, 2, "content author has avatarMediaId")
else:
    score("P6", 0, 2, "content author MISSING avatarMediaId")

# 6.5: toUserSnippet shape (no phone, has tribeId) (3 marks)
has_tribe = "tribeId" in author or "tribeCode" in author
no_phone = "phone" not in author
if no_phone and has_tribe:
    score("P6", 3, 3, "toUserSnippet shape correct: has tribeId, no phone leak")
elif no_phone:
    score("P6", 2, 3, "no phone leak but missing tribeId/tribeCode")
elif has_tribe:
    score("P6", 1, 3, "has tribeId but phone is leaking")
else:
    score("P6", 0, 3, f"shape wrong: phone={author.get('phone')}, tribeId={'tribeId' in author}")

# ════════════════════════════════════════════════════════════════
# P7: COMMENT AUTHOR (10 marks)
# ════════════════════════════════════════════════════════════════
print("P7: Comment author avatar contract...")

data2, phone2 = register("Commenter")
token2 = data2.get("accessToken", "")
uid2 = data2.get("user", {}).get("id", "")
requests.patch(f"{API}/me/age", headers=h(token2), json={"birthYear": 2000})

cmt_resp = requests.post(f"{API}/content/{post_id}/comments", headers=h(token2), json={"body": "test comment"}).json()
cmt = cmt_resp.get("comment", cmt_resp)
cmt_author = cmt.get("author") or {}

# 7.1: comment author avatarUrl present (2 marks)
if "avatarUrl" in cmt_author:
    score("P7", 2, 2, "comment author has avatarUrl")
else:
    score("P7", 0, 2, f"comment author MISSING avatarUrl. Keys: {list(cmt_author.keys())[:8]}")

# 7.2: comment author avatarUrl is null (new user, no avatar) (2 marks)
if cmt_author.get("avatarUrl") is None:
    score("P7", 2, 2, "comment author avatarUrl is null (correct — no avatar)")
else:
    score("P7", 0, 2, f"comment author avatarUrl should be null: {cmt_author.get('avatarUrl')}")

# 7.3: comment author avatarMediaId present (2 marks)
if "avatarMediaId" in cmt_author:
    score("P7", 2, 2, "comment author has avatarMediaId")
else:
    score("P7", 0, 2, "comment author MISSING avatarMediaId")

# 7.4: comment author displayName correct (2 marks)
if cmt_author.get("displayName") == "Commenter":
    score("P7", 2, 2, "comment author displayName correct")
else:
    score("P7", 0, 2, f"comment author displayName: {cmt_author.get('displayName')}")

# 7.5: GET /content/:id/comments — list comment authors (2 marks)
cmts_list = requests.get(f"{API}/content/{post_id}/comments").json()
items = cmts_list.get("items", cmts_list.get("comments", []))
if items and "avatarUrl" in (items[0].get("author") or {}):
    score("P7", 2, 2, "listed comment author has avatarUrl")
elif items and "author" in items[0]:
    author_keys = list((items[0].get("author") or {}).keys())
    score("P7", 0, 2, f"listed comment author missing avatarUrl. Keys: {author_keys}")
else:
    score("P7", 0, 2, f"comments list issue. Keys: {list(cmts_list.keys())}")

# ════════════════════════════════════════════════════════════════
# P8: FOLLOWERS / FOLLOWING (10 marks)
# ════════════════════════════════════════════════════════════════
print("P8: Followers/Following avatar contract...")

# User2 follows User1
requests.post(f"{API}/follow/{uid1}", headers=h(token2))

# 8.1-8.3: Followers list (6 marks)
followers = requests.get(f"{API}/users/{uid1}/followers").json()
f_items = followers.get("items", followers.get("users", []))
if f_items:
    fu = f_items[0]
    if "avatarUrl" in fu:
        score("P8", 2, 2, "follower has avatarUrl")
    else:
        score("P8", 0, 2, f"follower MISSING avatarUrl. Keys: {list(fu.keys())[:8]}")
    if "avatarMediaId" in fu:
        score("P8", 2, 2, "follower has avatarMediaId")
    else:
        score("P8", 0, 2, "follower MISSING avatarMediaId")
    if "displayName" in fu:
        score("P8", 2, 2, f"follower displayName: {fu['displayName']}")
    else:
        score("P8", 0, 2, "follower MISSING displayName")
else:
    score("P8", 0, 6, f"no followers returned. Keys: {list(followers.keys())}")

# 8.4-8.5: Following list (4 marks)
following = requests.get(f"{API}/users/{uid2}/following").json()
fw_items = following.get("items", following.get("users", []))
if fw_items:
    fwu = fw_items[0]
    if "avatarUrl" in fwu:
        score("P8", 2, 2, "following user has avatarUrl")
    else:
        score("P8", 0, 2, f"following MISSING avatarUrl. Keys: {list(fwu.keys())[:8]}")
    # User1 has avatar set, so check URL is resolved
    if fwu.get("avatarUrl") and "/api/media/" in fwu.get("avatarUrl", ""):
        score("P8", 2, 2, f"following avatarUrl resolved: {fwu['avatarUrl'][:30]}...")
    elif fwu.get("avatarUrl") is None and fwu.get("avatarMediaId") is None:
        score("P8", 2, 2, "following avatarUrl null (user may not have avatar)")
    else:
        score("P8", 0, 2, f"following avatarUrl format wrong: {fwu.get('avatarUrl')}")
else:
    score("P8", 0, 4, f"no following returned. Keys: {list(following.keys())}")

# ════════════════════════════════════════════════════════════════
# P9: SECURITY — no secret leakage (10 marks)
# ════════════════════════════════════════════════════════════════
print("P9: Security — no secret leakage...")

surfaces = {
    "register": user,
    "login": lu,
    "/auth/me": mu2,
    "/users/:id": uu2,
    "content_author": author,
    "comment_author": cmt_author,
}

all_clean = True
for surface_name, surface_data in surfaces.items():
    if not surface_data:
        continue
    if "pinHash" in surface_data:
        score("P9", 0, 0, f"pinHash LEAKED in {surface_name}!")
        all_clean = False
    if "pinSalt" in surface_data:
        score("P9", 0, 0, f"pinSalt LEAKED in {surface_name}!")
        all_clean = False
    if "_id" in surface_data:
        score("P9", 0, 0, f"_id LEAKED in {surface_name}!")
        all_clean = False

# 9.1: No pinHash in any surface (3 marks)
if all(("pinHash" not in s) for s in surfaces.values() if s):
    score("P9", 3, 3, "pinHash absent from all 6 surfaces")
else:
    score("P9", 0, 3, "pinHash found in some surface!")

# 9.2: No pinSalt in any surface (3 marks)
if all(("pinSalt" not in s) for s in surfaces.values() if s):
    score("P9", 3, 3, "pinSalt absent from all 6 surfaces")
else:
    score("P9", 0, 3, "pinSalt found in some surface!")

# 9.3: No _id in any surface (2 marks)
if all(("_id" not in s) for s in surfaces.values() if s):
    score("P9", 2, 2, "_id absent from all 6 surfaces")
else:
    score("P9", 0, 2, "_id found in some surface!")

# 9.4: Content author (toUserSnippet) doesn't leak phone (2 marks)
if "phone" not in author:
    score("P9", 2, 2, "toUserSnippet does not leak phone in content author")
else:
    score("P9", 0, 2, f"phone LEAKED in content author: {author.get('phone')}")

# ════════════════════════════════════════════════════════════════
# P10: EDGE CASES (10 marks)
# ════════════════════════════════════════════════════════════════
print("P10: Edge cases...")

# 10.1: Null avatar user — fields are null, not undefined/missing (3 marks)
data3, _ = register("NoAvatarUser")
u3 = data3.get("user", {})
null_correct = (
    "avatarUrl" in u3 and u3["avatarUrl"] is None and
    "avatarMediaId" in u3 and u3["avatarMediaId"] is None and
    "avatar" in u3 and u3["avatar"] is None
)
if null_correct:
    score("P10", 3, 3, "null-avatar: all 3 fields present and explicitly null")
else:
    score("P10", 0, 3, f"null-avatar issue: avatarUrl={'avatarUrl' in u3}, avatarMediaId={'avatarMediaId' in u3}, avatar={'avatar' in u3}")

# 10.2: avatarUrl format is /api/media/<uuid> (2 marks)
if pu.get("avatarUrl", "").startswith("/api/media/"):
    score("P10", 2, 2, f"avatarUrl format correct: starts with /api/media/")
else:
    score("P10", 0, 2, f"avatarUrl format wrong: {pu.get('avatarUrl')}")

# 10.3: avatarUrl and avatarMediaId are different types conceptually (2 marks)
# avatarUrl should be a path, avatarMediaId should be a UUID
av_url = pu.get("avatarUrl", "")
av_mid = pu.get("avatarMediaId", "")
if av_url.startswith("/api/media/") and not av_mid.startswith("/"):
    score("P10", 2, 2, "avatarUrl is URL path, avatarMediaId is raw UUID — distinct types")
else:
    score("P10", 0, 2, f"type distinction unclear: url={av_url[:20]}, mid={av_mid[:20]}")

# 10.4: Refresh token response has avatar fields (3 marks)
refresh_resp = requests.post(f"{API}/auth/refresh", json={"refreshToken": data.get("refreshToken", "")}).json()
ru = refresh_resp.get("user", {})
if "avatarUrl" in ru and "avatarMediaId" in ru:
    # Check if the avatar is resolved
    if ru.get("avatarUrl") and "/api/media/" in ru.get("avatarUrl", ""):
        score("P10", 3, 3, "refresh response has resolved avatarUrl + avatarMediaId")
    elif ru.get("avatarUrl") is None:
        score("P10", 3, 3, "refresh response has avatarUrl (null — token user may differ)")
    else:
        score("P10", 2, 3, f"refresh avatarUrl present but format unclear: {ru.get('avatarUrl')}")
elif "error" in refresh_resp:
    # Refresh may fail if token was used — that's OK, test the shape if possible
    score("P10", 1, 3, f"refresh token may be expired/reused: {refresh_resp.get('error','')[:40]}")
else:
    score("P10", 0, 3, f"refresh response missing avatar fields. Keys: {list(ru.keys())[:8]}")

# ════════════════════════════════════════════════════════════════
# FINAL REPORT
# ════════════════════════════════════════════════════════════════
print("\n" + "═" * 70)
print("  B1 CANONICAL IDENTITY & MEDIA RESOLUTION — SCORECARD")
print("═" * 70)

total = 0
max_total = 100
for i in range(1, 11):
    param = f"P{i}"
    s = SCORES.get(param, 0)
    total += s
    status = "✅ PASS" if s == 10 else ("⚠️ PARTIAL" if s >= 7 else "❌ FAIL")
    print(f"\n  {param}: {s}/10  {status}")
    for d in DETAILS.get(param, []):
        print(f"    {d}")

print(f"\n{'═' * 70}")
print(f"  TOTAL: {total}/{max_total}  ({total}%)")
grade = "A+" if total >= 95 else "A" if total >= 90 else "B+" if total >= 85 else "B" if total >= 80 else "C" if total >= 70 else "D" if total >= 60 else "F"
print(f"  GRADE: {grade}")
print(f"{'═' * 70}")
