# ============================================================================
# TRIBE — COMPLETE FRONTEND HANDOFF PACKAGE
# ============================================================================
# Backend URL: https://tribe-feed-engine-1.preview.emergentagent.com
# All APIs:    https://tribe-feed-engine-1.preview.emergentagent.com/api/*
# Health:      GET /api/healthz → {"status":"ok"}
# Auth:        Phone/PIN → Bearer token
# Last Updated: 2026-03-11
# ============================================================================


# ============================================================================
# PART 1: FRONTEND INTEGRATION GUIDE (Master Reference)
# ============================================================================

## Table of Contents
1. Authentication
2. User Lifecycle & Onboarding
3. Content System (Posts)
4. Edit Post (B4)
5. Comments & Comment Like (B4)
6. Share/Repost (B4)
7. Social Interactions (Like/Save/React)
8. Feed System
9. Pages System (B3)
10. Social Graph (Follow/Block)
11. Stories
12. Reels
13. Notifications
14. Search & Discovery
15. Tribes & Contests
16. Events
17. Media Upload & Rendering (Supabase)
18. Error Handling
19. Pagination

---

## 1. Authentication

### Register
```
POST /api/auth/register
Body: { "phone": "7777000001", "pin": "1234", "displayName": "Name", "username": "uname" }
```
**Response (201):**
```json
{
  "accessToken": "at_xxx...",
  "refreshToken": "rt_xxx...",
  "user": {
    "id": "uuid",
    "displayName": "Name",
    "username": "uname",
    "phone": "7777000001",
    "bio": "",
    "avatarUrl": null,
    "avatarMediaId": null,
    "role": "USER",
    "ageStatus": "NONE",
    "collegeId": null,
    "collegeName": null,
    "houseId": null,
    "houseName": null,
    "tribeId": null,
    "tribeCode": null,
    "followerCount": 0,
    "followingCount": 0,
    "postCount": 0,
    "onboardingStep": "AGE",
    "createdAt": "ISO...",
    "updatedAt": "ISO..."
  }
}
```

### Login
```
POST /api/auth/login
Body: { "phone": "7777000001", "pin": "1234" }
```
Same response shape as register.

### Refresh Token
```
POST /api/auth/refresh
Body: { "refreshToken": "rt_xxx..." }
```
Returns: `{ "accessToken": "at_new..." }`

### Auth Headers (all authenticated endpoints)
```
Authorization: Bearer {accessToken}
Content-Type: application/json
```

### Flow
1. Register/Login → store `accessToken` + `refreshToken`
2. Use `accessToken` in all requests
3. On `401` → try `POST /auth/refresh` with refreshToken
4. On refresh fail → redirect to login screen

---

## 2. User Lifecycle & Onboarding

Check `user.onboardingStep`:
- `"AGE"` → show age verification
- `"COLLEGE"` → show college selection
- `null` → onboarding complete

```
PATCH /api/me/age          → { "birthDate": "2000-01-15" }
PATCH /api/me/college      → { "collegeId": "college-uuid" }
PATCH /api/me/onboarding   → { "step": "COMPLETE" }
PATCH /api/me/profile      → { "displayName": "...", "bio": "...", "avatarMediaId": "..." }
```

---

## 3. Content System (Posts)

### Create Post
```
POST /api/content/posts
Body: {
  "caption": "Hello world!",
  "kind": "POST",
  "mediaIds": ["media-uuid"],
  "visibility": "PUBLIC"
}
```

### Get/Delete Post
```
GET /api/content/:id
DELETE /api/content/:id
```

---

## 4. Edit Post (B4)
```
PATCH /api/content/:id
Body: { "caption": "Updated text" }
```
- Returns `editedAt` timestamp when edited
- Show "(edited)" if `editedAt !== null`
- NOT optimistic: moderation re-checks text

---

## 5. Comments & Comment Like (B4)
```
GET /api/content/:postId/comments?cursor=...&limit=20
POST /api/content/:postId/comments              → { "text": "Great!" }
POST /api/content/:postId/comments/:cid/like    → { "liked": true, "commentLikeCount": 4 }
DELETE /api/content/:postId/comments/:cid/like   → { "liked": false, "commentLikeCount": 3 }
```

---

## 6. Share/Repost (B4)
```
POST /api/content/:id/share
Body: { "caption": "Optional quote" }
```
- Returns `isRepost: true` with embedded `originalContent`
- 409 if already shared, 400 if trying to repost a repost
- NOT optimistic — wait for 201

---

## 7. Social Interactions
```
POST /api/content/:id/like          → { "likeCount": 43, "viewerHasLiked": true }
POST /api/content/:id/dislike
DELETE /api/content/:id/reaction
POST /api/content/:id/save
DELETE /api/content/:id/save
```
Like/Save are optimistic-safe.

---

## 8. Feed System
```
GET /api/feed/public?cursor=...&limit=20
GET /api/feed/following?cursor=...&limit=20    ← includes followed page posts
GET /api/feed/college/:collegeId
GET /api/feed/house/:houseId
GET /api/feed/stories
GET /api/feed/reels
```

### Feed Item Variants
| Variant | Detection | Rendering |
|---------|-----------|-----------|
| Normal post | `authorType=USER`, `!isRepost` | Standard card |
| Page post | `authorType=PAGE` | Page avatar+name, tap → page detail |
| Repost | `isRepost=true` | Repost wrapper + embedded original |
| Edited | `editedAt !== null` | Show "(edited)" |

---

## 9. Pages System (B3)
```
GET /api/pages?q=...&category=CLUB
GET /api/pages/:idOrSlug
GET /api/pages/:id/posts?cursor=...
GET /api/me/pages
POST /api/pages                               → { name, slug, category, bio?, avatarMediaId? }
PATCH /api/pages/:id
POST /api/pages/:id/follow
DELETE /api/pages/:id/follow
GET /api/pages/:id/members
POST /api/pages/:id/members                   → { userId, role }
PATCH /api/pages/:id/members/:userId          → { role }
DELETE /api/pages/:id/members/:userId
POST /api/pages/:id/transfer-ownership        → { userId }
POST /api/pages/:id/posts                     → Publish as page
GET /api/pages/:id/analytics?period=30d
```

### viewerRole UI Gating
- `null` → Follow button, browse posts
- `MODERATOR` → + view members
- `EDITOR` → + publish/edit posts
- `ADMIN` → + manage members, analytics
- `OWNER` → + archive, transfer ownership

---

## 10. Social Graph
```
POST /api/follow/:userId
DELETE /api/follow/:userId
GET /api/users/:id/followers?cursor=...
GET /api/users/:id/following?cursor=...
POST /api/me/blocks/:userId
DELETE /api/me/blocks/:userId
GET /api/me/blocks
```

---

## 11. Stories
```
POST /api/stories
GET /api/stories/feed
GET /api/stories/:id
DELETE /api/stories/:id
POST /api/stories/:id/react
POST /api/stories/:id/reply
GET /api/me/stories/archive
POST /api/me/highlights
GET /api/users/:id/highlights
GET/PATCH /api/me/story-settings
GET /api/me/close-friends
POST/DELETE /api/me/close-friends/:userId
```
- Stories expire after 24h → 410 GONE

---

## 12. Reels
```
POST /api/reels
GET /api/reels/feed                    ← score-ranked discovery
GET /api/reels/following               ← following feed
GET /api/reels/:id
PATCH /api/reels/:id
DELETE /api/reels/:id
POST /api/reels/:id/like
DELETE /api/reels/:id/like
POST /api/reels/:id/save
DELETE /api/reels/:id/save
POST /api/reels/:id/comment
GET /api/reels/:id/comments
POST /api/reels/:id/share
POST /api/reels/:id/report
POST /api/reels/:id/watch
GET /api/me/reels/analytics
GET /api/users/:id/reels
```

### Reel Object (NOT same as Post!)
- Uses `playbackUrl`, `thumbnailUrl`, `posterFrameUrl` directly
- Uses `creatorId` not `authorId`
- Do NOT use `/api/media/:id` for reel media

---

## 13. Notifications
```
GET /api/notifications?cursor=...&grouped=true
PATCH /api/notifications/read           → { "ids": [...] } or empty=mark all
GET /api/notifications/unread-count
GET /api/notifications/preferences
PATCH /api/notifications/preferences    → { "preferences": { "LIKE": false } }
POST /api/notifications/register-device → { token, platform, deviceId?, appVersion? }
DELETE /api/notifications/unregister-device → { token }
```

### Notification Types
FOLLOW, LIKE, COMMENT, COMMENT_LIKE, SHARE, MENTION, REEL_LIKE, REEL_COMMENT, REEL_SHARE, STORY_REACTION, STORY_REPLY, STORY_REMOVED, REPORT_RESOLVED, STRIKE_ISSUED, APPEAL_DECIDED, HOUSE_POINTS

### Deep-Link by targetType
- CONTENT → post detail
- USER → profile
- COMMENT → comment sheet
- PAGE → page detail
- REEL → reel detail

---

## 14. Search & Discovery
```
GET /api/search?q=keyword&type=all     → mixed results
GET /api/search?q=keyword&type=users
GET /api/search?q=keyword&type=pages
GET /api/search?q=keyword&type=posts
GET /api/search?q=keyword&type=hashtags
GET /api/search?q=keyword&type=colleges
GET /api/search?q=keyword&type=houses
GET /api/hashtags/trending
GET /api/hashtags/:tag
GET /api/hashtags/:tag/feed?cursor=...
GET /api/suggestions/users
```
Use `_resultType` field to render correct card type in mixed search.

---

## 15. Tribes & Contests
```
GET /api/tribes
GET /api/tribes/:id
GET /api/tribes/standings/current
GET /api/tribes/:id/members
GET /api/me/tribe
GET /api/tribe-contests
GET /api/tribe-contests/:id
POST /api/tribe-contests/:id/enter
GET /api/tribe-contests/:id/leaderboard
POST /api/tribe-contests/:id/vote
GET /api/tribe-contests/seasons
```

---

## 16. Events
```
POST /api/events
GET /api/events/feed
GET /api/events/:id
PATCH /api/events/:id
POST /api/events/:id/rsvp
DELETE /api/events/:id/rsvp
GET /api/events/:id/attendees
GET /api/me/events
GET /api/me/events/rsvps
```

---

## 17. Media Upload & Rendering (Supabase Direct Upload)

### Step 1: Initialize Upload
```
POST /api/media/upload-init
Authorization: Bearer <token>
Body: {
  "kind": "image" | "video",
  "mimeType": "image/jpeg",
  "sizeBytes": 12345,
  "scope": "posts"             // posts | reels | stories | thumbnails
}
```
Response (201):
```json
{
  "mediaId": "uuid",
  "uploadUrl": "https://xxx.supabase.co/storage/v1/upload/sign/...",
  "token": "upload-token",
  "path": "posts/userId/mediaId.jpeg",
  "publicUrl": "https://xxx.supabase.co/storage/v1/object/public/tribe-media/...",
  "expiresIn": 7200
}
```

### Step 2: Upload File Directly to Supabase
```javascript
await fetch(uploadUrl, {
  method: 'PUT',
  headers: { 'Content-Type': mimeType },
  body: fileBlob
});
```

### Step 3: Finalize Upload
```
POST /api/media/upload-complete
Body: { "mediaId": "uuid", "width": 1080, "height": 1920, "duration": 15.5 }
```
Response (200):
```json
{
  "id": "uuid",
  "url": "https://xxx.supabase.co/.../file.jpeg",
  "publicUrl": "...",
  "thumbnailUrl": null,
  "thumbnailStatus": "NONE" | "READY" | "FAILED",
  "type": "IMAGE",
  "kind": "IMAGE",
  "mimeType": "image/jpeg",
  "size": 12345,
  "storageType": "SUPABASE",
  "status": "READY"
}
```

### Step 4: Check Status (Optional)
```
GET /api/media/upload-status/:mediaId
```
Returns: status, thumbnailStatus, thumbnailUrl, expiresAt

### Delete Media
```
DELETE /api/media/:id
```
- 200: `{ "id": "uuid", "status": "DELETED" }`
- 403: not your media
- 404: not found
- 409: attached to content (remove from post/reel/story first)

### Serve Media
```
GET /api/media/:id (no auth)
```
- Supabase: 302 redirect to CDN
- Legacy: 200 with binary body

### Allowed MIME: image/jpeg, image/png, image/webp, video/mp4, video/quicktime
### Max Size: 200MB

### Thumbnail Status (video uploads)
- After upload-complete, video thumbnails auto-generated
- NONE → PENDING → READY/FAILED
- Poll upload-status for thumbnailStatus
- thumbnailUrl available when READY

---

## 18. Error Handling

### Standard Error Response
```json
{ "error": "Human-readable message", "code": "ERROR_CODE" }
```

| Code | HTTP | Meaning |
|------|------|---------|
| VALIDATION_ERROR | 400 | Bad input |
| AUTH_REQUIRED | 401 | Not authenticated |
| FORBIDDEN | 403 | Not authorized |
| NOT_FOUND | 404 | Not found |
| DUPLICATE | 409 | Already exists |
| MEDIA_ATTACHED | 409 | Media in use by content |
| EXPIRED | 410 | Story expired |
| CONTENT_REJECTED | 422 | Moderation rejected |
| RATE_LIMITED | 429 | Too many requests |

---

## 19. Pagination

All list endpoints use cursor-based pagination:
```
GET /api/feed/public?cursor=2026-03-10T17:00:00.000Z&limit=20
```
Response:
```json
{
  "items": [...],
  "pagination": { "nextCursor": "...", "hasMore": true }
}
```
- First request: omit cursor
- Next: use pagination.nextCursor
- Stop when hasMore === false


# ============================================================================
# PART 2: SCREEN-TO-ENDPOINT MAP
# ============================================================================

## Splash / Auth
| Action | Endpoint |
|--------|----------|
| Check login | GET /auth/me → 200=logged in, 401=not |

## Login
| Action | Endpoint | Body |
|--------|----------|------|
| Login | POST /auth/login | { phone, pin } |

## Register
| Action | Endpoint | Body |
|--------|----------|------|
| Register | POST /auth/register | { phone, pin, displayName, username } |

## Onboarding
| Step | Endpoint | Body |
|------|----------|------|
| Set age | PATCH /me/age | { birthDate } |
| Set college | PATCH /me/college | { collegeId } |
| Find colleges | GET /colleges/search?q=... | — |
| Complete | PATCH /me/onboarding | { step: "COMPLETE" } |

## Edit Profile
| Action | Endpoint |
|--------|----------|
| Update | PATCH /me/profile → { displayName, bio, avatarMediaId } |
| Change PIN | PATCH /auth/pin → { currentPin, newPin } |

## Home Feed
| Action | Endpoint | Optimistic? |
|--------|----------|-------------|
| Public feed | GET /feed/public?cursor=...&limit=20 | — |
| Following feed | GET /feed/following?cursor=... | — |
| Story rail | GET /stories/feed | — |
| Like | POST /content/:id/like | Yes |
| Save | POST /content/:id/save | Yes |
| Share | POST /content/:id/share | NO |

## Post Detail
| Action | Endpoint |
|--------|----------|
| Fetch | GET /content/:id |
| Like/Unlike | POST /content/:id/like, DELETE /content/:id/reaction |
| Edit | PATCH /content/:id → { caption } (NOT optimistic) |
| Share | POST /content/:id/share (NOT optimistic) |
| Delete | DELETE /content/:id |

## Comment Sheet
| Action | Endpoint |
|--------|----------|
| List | GET /content/:postId/comments?cursor=... |
| Create | POST /content/:postId/comments → { text } |
| Like | POST /content/:postId/comments/:cid/like |
| Unlike | DELETE /content/:postId/comments/:cid/like |

## Create Post
| Action | Endpoint |
|--------|----------|
| Upload media | POST /media/upload-init → upload to Supabase → POST /media/upload-complete |
| Create | POST /content/posts → { caption, mediaIds, visibility } |

## Profile
| Action | Endpoint |
|--------|----------|
| Self | GET /auth/me |
| Other | GET /users/:id |
| Posts | GET /users/:id/posts?cursor=... |
| Followers | GET /users/:id/followers |
| Following | GET /users/:id/following |
| Saved | GET /users/:id/saved |
| Follow | POST /follow/:userId |
| Unfollow | DELETE /follow/:userId |

## Stories
| Action | Endpoint |
|--------|----------|
| Rail | GET /stories/feed |
| View | GET /stories/:id |
| Create | POST /stories |
| React | POST /stories/:id/react |
| Reply | POST /stories/:id/reply |
| Delete | DELETE /stories/:id |

## Reels
| Action | Endpoint |
|--------|----------|
| Feed | GET /reels/feed |
| Following | GET /reels/following |
| Detail | GET /reels/:id |
| Like | POST /reels/:id/like |
| Comment | POST /reels/:id/comment |
| Share | POST /reels/:id/share |
| Watch | POST /reels/:id/watch |

## Pages
| Action | Endpoint |
|--------|----------|
| Browse | GET /pages?q=...&category=... |
| Detail | GET /pages/:idOrSlug |
| Posts | GET /pages/:id/posts |
| Follow | POST /pages/:id/follow |
| Create | POST /pages |
| Members | GET /pages/:id/members |
| Analytics | GET /pages/:id/analytics |

## Notifications
| Action | Endpoint |
|--------|----------|
| List | GET /notifications?cursor=... |
| Mark read | PATCH /notifications/read |
| Unread count | GET /notifications/unread-count |

## Search
| Action | Endpoint |
|--------|----------|
| Search | GET /search?q=...&type=users|pages|posts|hashtags|colleges|houses |
| Trending | GET /hashtags/trending |
| Hashtag feed | GET /hashtags/:tag/feed |


# ============================================================================
# PART 3: KNOWN GOTCHAS & EDGE CASES
# ============================================================================

## CRITICAL: Dual Author System
- `authorType: "USER"` → author has `displayName`, `username`
- `authorType: "PAGE"` → author has `name`, `slug`, NO displayName/username
- Following feed mixes both → every PostCard MUST branch on authorType

## CRITICAL: Repost Rendering
- `isRepost === true` → show reposter + embedded `originalContent`
- `originalContent` can be `null` if deleted → show placeholder

## Avatar
- `avatarUrl` = display URL, use directly
- `null` = show placeholder
- `avatarMediaId` = for edit forms only

## Pagination
- Most: `{ items, pagination: { nextCursor, hasMore } }`
- Some: `{ posts, pagination }` or `{ comments, pagination }`
- Always check: `data.items || data.posts || data.comments || []`

## Age Gate
- `ageStatus !== "ADULT"` → cannot create content
- Check BEFORE showing create button

## Rate Limiting
- AUTH: 10/min, READ: 120/min, WRITE: 30/min
- 429 response → show "Please wait", retry after `Retry-After` header

## Reel Media
- Reels use `playbackUrl`/`thumbnailUrl` directly (NOT MediaObject)
- Use `creatorId` not `authorId`

## Story Expiry
- 24h expiry → 410 GONE response → remove from rail

## Soft Deletes
- DELETE sets `visibility: REMOVED`
- Subsequent GET → 404

## Self-Notification Suppression
- Backend handles all self-suppression → frontend doesn't filter

## Block Behavior
- Blocked user content → 404 (as if doesn't exist)
- Bidirectional for content visibility

## Moderation
- Post create/edit goes through moderation → can return 422
- NOT optimistic for content creation

## Media Delete
- Cannot delete media attached to content → 409 MEDIA_ATTACHED
- Must remove from post/reel/story first, then delete media


# ============================================================================
# PART 4: NOTIFICATION TYPES & DEEP LINKS
# ============================================================================

| Type | Trigger | Target | Deep Link |
|------|---------|--------|-----------|
| FOLLOW | User follows you | USER | Actor profile |
| LIKE | Post liked | CONTENT | Post detail |
| COMMENT | Post commented | COMMENT | Comment sheet |
| COMMENT_LIKE | Comment liked | COMMENT | Comment sheet |
| SHARE | Post reposted | CONTENT | Original post |
| MENTION | Mentioned | CONTENT/COMMENT | Post/comment |
| REEL_LIKE | Reel liked | REEL | Reel detail |
| REEL_COMMENT | Reel commented | REEL | Reel comments |
| REEL_SHARE | Reel shared | REEL | Reel detail |
| STORY_REACTION | Story reacted | STORY | Story viewer |
| STORY_REPLY | Story replied | STORY | Story viewer |
| STORY_REMOVED | Story removed (admin) | — | — |
| REPORT_RESOLVED | Report resolved | — | — |
| STRIKE_ISSUED | Strike issued | — | — |
| APPEAL_DECIDED | Appeal decided | — | — |

Force-deliver (ignore user prefs): REPORT_RESOLVED, STRIKE_ISSUED, APPEAL_DECIDED


# ============================================================================
# PART 5: MEDIA CONTRACT (Full Detail)
# ============================================================================

## Upload Init
```
POST /api/media/upload-init
{ "kind": "image|video", "mimeType": "...", "sizeBytes": N, "scope": "posts|reels|stories" }
→ 201: { mediaId, uploadUrl, token, path, publicUrl, expiresIn: 7200 }
```

## Upload Complete
```
POST /api/media/upload-complete
{ "mediaId": "...", "width": N, "height": N, "duration": N }
→ 200: { id, url, publicUrl, thumbnailUrl, thumbnailStatus, type, kind, mimeType, size, storageType, status }
```

## Upload Status
```
GET /api/media/upload-status/:id
→ 200: { id, status, thumbnailStatus, thumbnailUrl, expiresAt, publicUrl, type, kind, mimeType, size, storageType }
```

## Delete Media
```
DELETE /api/media/:id
→ 200: { id, status: "DELETED" }
→ 403: not your media
→ 404: not found
→ 409: { error, code: "MEDIA_ATTACHED", attachments: [{ type, id }] }
```

## Serve Media
```
GET /api/media/:id (no auth)
→ 302 redirect to Supabase CDN (with Cache-Control: immutable)
→ 200 binary for legacy
→ 404 not found
```

## Allowed MIME Types
image/jpeg, image/png, image/webp, video/mp4, video/quicktime

## Max File Size: 200MB

## Thumbnail Lifecycle (video uploads)
- thumbnailStatus: NONE → PENDING → READY | FAILED
- thumbnailUrl: set when READY
- thumbnailError: set when FAILED
- Poll upload-status to check

## Cleanup
- Pending uploads expire after 2h (expiresAt field)
- Auto-cleaned every 30 min
- READY media never touched


# ============================================================================
# PART 6: REEL CONTRACT (Full Detail)
# ============================================================================

## Reel Object Shape
```json
{
  "id": "uuid",
  "creatorId": "uuid",
  "caption": "string",
  "hashtags": ["string"],
  "playbackUrl": "string",
  "thumbnailUrl": "string",
  "posterFrameUrl": "string",
  "mediaStatus": "READY | UPLOADING",
  "durationMs": 15000,
  "visibility": "PUBLIC | COLLEGE_ONLY | PRIVATE",
  "status": "PUBLISHED | DRAFT | ARCHIVED | HELD | REMOVED",
  "likeCount": 0,
  "commentCount": 0,
  "shareCount": 0,
  "saveCount": 0,
  "viewCount": 0,
  "pinnedToProfile": false,
  "remixOf": null,
  "createdAt": "ISO..."
}
```

## Feed Enrichment
```
base + { "creator": UserSnippet, "likedByMe": bool, "savedByMe": bool }
```

## Detail Enrichment
```
base + { "creator", "likedByMe", "savedByMe", "hiddenByMe", "notInterestedByMe", "remixSource" }
```

## Action Semantics
- Like/Unlike/Save/Unsave: Idempotent, optimistic-safe
- Comment/Share: NOT idempotent, NOT optimistic
- Report: Deduplicated (409 on dup)
- Like own reel: 400 SELF_ACTION


# ============================================================================
# PART 7: SEARCH CONTRACT (Full Detail)
# ============================================================================

## Mixed Search
```
GET /api/search?q=keyword&type=all|users|pages|posts|hashtags|colleges|houses&limit=10&offset=0
```

## Response
```json
{
  "data": {
    "items": [{ "...fields", "_resultType": "user|page|hashtag|post|college|house" }],
    "users": [...], "pages": [...], "hashtags": [...], "posts": [...],
    "pagination": { "total": N, "offset": N, "limit": N, "hasMore": bool }
  }
}
```

## Ranking: exact > prefix > contains (all entity types)
## Safety: banned/blocked users excluded, removed posts excluded

## Hashtags
```
GET /api/hashtags/trending?limit=20
GET /api/hashtags/:tag
GET /api/hashtags/:tag/feed?cursor=...&limit=10
```

# ============================================================================
# END OF HANDOFF PACKAGE
# ============================================================================
