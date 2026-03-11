# Tribe — Complete Frontend Integration Guide
**Version**: 2.1 (Post B4 + FH1-U)
**Generated from**: Verified backend code + live API responses
**Last verified**: 2026-03-10

---

## Table of Contents
1. [What's New (B3 + B4)](#whats-new)
2. [Authentication](#authentication)
3. [User Lifecycle & Onboarding](#onboarding)
4. [Content System (Posts)](#content)
5. [NEW: Edit Post (B4)](#edit-post)
6. [Comments & NEW: Comment Like (B4)](#comments)
7. [NEW: Share/Repost (B4)](#share-repost)
8. [Social Interactions (Like/Save/React)](#interactions)
9. [Feed System](#feeds)
10. [NEW: Pages System (B3)](#pages)
11. [Social Graph (Follow/Block)](#social-graph)
12. [Stories](#stories)
13. [Reels](#reels)
14. [Notifications](#notifications)
15. [Search & Discovery](#search)
16. [Tribes & Contests](#tribes)
17. [Events](#events)
18. [Media Upload & Rendering](#media)
19. [Error Handling](#errors)
20. [Pagination](#pagination)

---

## <a name="whats-new"></a>1. What's New (B3 + B4)

### B3 — Pages System (NEW DOMAIN)
- **What**: Community pages that publish content as a page entity (not a user)
- **Key concept**: Posts can now have `authorType: "PAGE"` — frontend MUST handle dual-author rendering
- **New screens needed**: Page list, page detail, page create/edit, page member management, page posts
- **Feed impact**: Following feed now includes posts from followed pages
- **Search impact**: `type=pages` now works in unified search

### B4 — Core Social Gaps (NEW FEATURES)
| Feature | Endpoint | What It Does |
|---------|----------|-------------|
| **Edit Post** | `PATCH /content/:id` | Edit caption of existing post. Returns `editedAt` timestamp |
| **Comment Like** | `POST /content/:postId/comments/:commentId/like` | Like a comment (idempotent) |
| **Comment Unlike** | `DELETE /content/:postId/comments/:commentId/like` | Unlike a comment |
| **Share/Repost** | `POST /content/:id/share` | Create a repost. Returns new content item with `isRepost: true` and embedded `originalContent` |

### Critical Frontend Changes Required
1. **PostCard component** must now handle 3 variants:
   - Normal post (`isRepost` absent or false, `authorType: USER`)
   - Page-authored post (`authorType: PAGE` — author has `slug`/`name` instead of `username`/`displayName`)
   - Repost (`isRepost: true` — show reposter + embedded original post)
2. **Comment component** needs a like button + `likeCount` display
3. **Post detail** needs Edit button (visible only to owner/page-role) and Share button
4. **Feed items** can now show "(edited)" indicator when `editedAt` is not null

---

## <a name="authentication"></a>2. Authentication

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
    "createdAt": "2026-03-10T...",
    "updatedAt": "2026-03-10T..."
  }
}
```

**Validation errors:**
- Phone must be exactly 10 digits → `400 VALIDATION_ERROR`
- Phone already registered → `409` (try login instead)
- Username taken → `409`

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

### Auth Headers
All authenticated endpoints require:
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

## <a name="onboarding"></a>3. User Lifecycle & Onboarding

Check `user.onboardingStep`:
- `"AGE"` → show age verification
- `"COLLEGE"` → show college selection
- Other non-null → show relevant step
- `null` → onboarding complete

### Set Age
```
PATCH /api/me/age
Body: { "birthDate": "2000-01-15" }
```
After this, `ageStatus` becomes `"ADULT"` or `"MINOR"`. **Only ADULT can create content.**

### Set College
```
PATCH /api/me/college
Body: { "collegeId": "college-uuid" }
```

### Complete Onboarding
```
PATCH /api/me/onboarding
Body: { "step": "COMPLETE" }
```

### Update Profile
```
PATCH /api/me/profile
Body: { "displayName": "New Name", "bio": "Hello!", "avatarMediaId": "media-uuid" }
```

---

## <a name="content"></a>4. Content System (Posts)

### Create Post
```
POST /api/content/posts
Body: {
  "caption": "Hello world!",
  "kind": "POST",         // POST | REEL | STORY
  "media": ["media-id"],  // optional array of media IDs
  "visibility": "PUBLIC"   // PUBLIC | COLLEGE_ONLY | HOUSE_ONLY | PRIVATE
}
```
**Response (201):**
```json
{
  "post": {
    "id": "uuid",
    "kind": "POST",
    "caption": "Hello world!",
    "media": [{ "id": "media-id", "url": "/api/media/media-id", "type": "IMAGE", ... }],
    "mediaIds": ["media-id"],
    "authorId": "user-uuid",
    "authorType": "USER",
    "author": { /* UserSnippet */ },
    "visibility": "PUBLIC",
    "likeCount": 0,
    "commentCount": 0,
    "saveCount": 0,
    "shareCount": 0,
    "viewCount": 0,
    "viewerHasLiked": false,
    "viewerHasDisliked": false,
    "viewerHasSaved": false,
    "editedAt": null,
    "createdAt": "ISO...",
    "updatedAt": "ISO...",
    "collegeId": "...|null",
    "houseId": "...|null"
  }
}
```

**Prerequisites**: `ageStatus === "ADULT"`. Otherwise returns 403 with `"Please complete age verification before posting"`.

### Get Post Detail
```
GET /api/content/:id
```
Returns same enriched PostObject.

### Delete Post (Soft)
```
DELETE /api/content/:id
```
Sets `visibility: REMOVED`. Post disappears from feeds/queries. Detail returns 404 after delete.

---

## <a name="edit-post"></a>5. NEW: Edit Post Caption (B4)

### Endpoint
```
PATCH /api/content/:id
Body: { "caption": "Updated caption text" }
```

### Response (200)
Same enriched PostObject with `editedAt` now set:
```json
{
  "post": {
    "id": "...",
    "caption": "Updated caption text",
    "editedAt": "2026-03-10T17:30:00.000Z",  // <-- NEW: non-null after edit
    "author": { /* preserved */ },
    "authorType": "USER",
    "likeCount": 5,  // unchanged
    ...
  }
}
```

### Permission Rules
| Scenario | Allowed? | HTTP Status |
|----------|----------|-------------|
| Owner edits own post | Yes | 200 |
| Outsider edits | No | 403 |
| Unauthenticated | No | 401 |
| Deleted post | No | 404 |
| Empty caption (text-only post) | No | 400 |
| Missing caption field | No | 400 |
| Page post by OWNER/ADMIN/EDITOR | Yes | 200 |
| Page post by MODERATOR | No | 403 |
| Page post on ARCHIVED page | No | 400 |

### Frontend Rendering
- Show "(edited)" indicator if `editedAt !== null`
- Edit button visible only if current user is the author OR has page role OWNER/ADMIN/EDITOR
- **NOT optimistic UI safe**: Backend runs moderation re-check on edited text. If moderation rejects → 422. Wait for server response before updating UI.

### What DOES NOT change on edit
- `authorId`, `authorType`, `pageId`, `actingUserId` — all preserved
- `likeCount`, `commentCount`, `saveCount`, `shareCount` — unchanged
- `media` — not editable (caption only)

---

## <a name="comments"></a>6. Comments & NEW: Comment Like (B4)

### List Comments
```
GET /api/content/:postId/comments?cursor=...&limit=20
```
**Response:**
```json
{
  "items": [
    {
      "id": "comment-uuid",
      "contentId": "post-uuid",
      "authorId": "user-uuid",
      "author": { /* UserSnippet */ },
      "text": "Great post!",
      "likeCount": 3,          // <-- Available for display
      "parentId": null,         // null = top-level, set = reply
      "createdAt": "ISO..."
    }
  ],
  "comments": [ /* same array, backward-compat alias */ ],
  "pagination": { "nextCursor": "...", "hasMore": true }
}
```

### Create Comment
```
POST /api/content/:postId/comments
Body: { "text": "Great post!" }
```

### NEW: Like Comment (B4)
```
POST /api/content/:postId/comments/:commentId/like
```
**Response (200):**
```json
{
  "liked": true,
  "commentLikeCount": 4
}
```

### NEW: Unlike Comment (B4)
```
DELETE /api/content/:postId/comments/:commentId/like
```
**Response (200):**
```json
{
  "liked": false,
  "commentLikeCount": 3
}
```

### Comment Like Rules
- **Idempotent**: Liking twice returns same result (no double-count)
- **Optimistic UI safe**: Yes — toggle heart immediately, update count, rollback on error
- **Self-notify suppressed**: Liking your own comment creates no notification
- **Parent access required**: If parent post is deleted/hidden/blocked → 404
- **Wrong pairing**: If commentId doesn't belong to postId → 404

### Frontend Component Changes
Each comment row needs:
- Heart icon (filled if liked, outlined if not)
- `likeCount` display (use `Math.max(0, count)` for safety)
- Tap heart → `POST .../like`, tap again → `DELETE .../like`

---

## <a name="share-repost"></a>7. NEW: Share/Repost (B4)

### Endpoint
```
POST /api/content/:id/share
Body: { "caption": "Optional quote text" }   // caption is optional
```

### Response (201)
```json
{
  "post": {
    "id": "new-repost-uuid",
    "kind": "POST",
    "caption": "",
    "media": [],
    "authorId": "reposter-uuid",
    "authorType": "USER",
    "author": { /* reposter's UserSnippet */ },
    "isRepost": true,                        // <-- KEY FLAG
    "originalContentId": "original-post-uuid",
    "originalContent": {                     // <-- EMBEDDED ORIGINAL
      "id": "original-post-uuid",
      "caption": "Original post text",
      "authorType": "USER",
      "author": { /* original author's UserSnippet or PageSnippet */ },
      "media": [...],
      "likeCount": 42,
      "commentCount": 7,
      ...
    },
    "likeCount": 0,
    "commentCount": 0,
    "shareCount": 0,
    "viewerHasLiked": false,
    "viewerHasSaved": false,
    "createdAt": "ISO..."
  }
}
```

### Repost Rules
| Rule | Behavior |
|------|----------|
| Duplicate repost | 409 "Already shared this content" (one repost per user per original) |
| Repost a repost | 400 "Cannot repost a repost" (only originals) |
| Repost deleted content | 404 |
| Repost hidden/blocked content | 404 |
| Unauthenticated | 401 |
| Self-repost (own post) | Allowed (creates repost, no self-notification) |

### Frontend Rendering (CRITICAL)
```
┌─────────────────────────────────────┐
│  [reposter avatar] reposter reposted│   ← post.author (reposter)
│─────────────────────────────────────│
│ ┌─────────────────────────────────┐ │
│ │ [original avatar] Original Name │ │   ← post.originalContent.author
│ │ Original caption text...        │ │   ← post.originalContent.caption
│ │ [media if any]                  │ │   ← post.originalContent.media
│ └─────────────────────────────────┘ │
│  ❤ 0  💬 0  🔄 0                    │   ← repost's own counters
└─────────────────────────────────────┘
```

**If original was deleted**: `originalContent` will be `null`.
Show: "Original content was removed" placeholder.

### Share Count
- `shareCount` on the ORIGINAL post increments by 1
- The repost item itself starts with `shareCount: 0`
- **NOT optimistic UI safe**: Wait for 201 response (duplicate check is server-side)

---

## <a name="interactions"></a>8. Social Interactions

### Like Post
```
POST /api/content/:id/like
Response: { "likeCount": 43, "viewerHasLiked": true, "viewerHasDisliked": false }
```
Optimistic UI safe: Yes.

### Dislike Post
```
POST /api/content/:id/dislike
Response: { "viewerHasLiked": false, "viewerHasDisliked": true }
```

### Remove Reaction
```
DELETE /api/content/:id/reaction
Response: { "viewerHasLiked": false, "viewerHasDisliked": false }
```

### Save Post
```
POST /api/content/:id/save
```
Optimistic UI safe: Yes.

### Unsave Post
```
DELETE /api/content/:id/save
```

---

## <a name="feeds"></a>9. Feed System

### Public Feed
```
GET /api/feed/public?cursor=...&limit=20
```

### Following Feed (includes page posts!)
```
GET /api/feed/following?cursor=...&limit=20
```
**Key change (B3)**: Now includes posts from followed PAGES, not just followed users.

### Feed Response Shape
```json
{
  "items": [
    {
      "id": "...",
      "kind": "POST",
      "caption": "...",
      "authorType": "USER",     // or "PAGE"
      "author": { /* UserSnippet or PageSnippet */ },
      "isRepost": false,        // or true (B4)
      "originalContent": null,  // or {...} if isRepost=true (B4)
      "editedAt": null,         // or ISO string if edited (B4)
      "likeCount": 5,
      "commentCount": 2,
      "saveCount": 1,
      "shareCount": 0,
      "viewerHasLiked": false,
      "viewerHasSaved": false,
      ...
    }
  ],
  "pagination": {
    "nextCursor": "2026-03-10T...",
    "hasMore": true
  }
}
```

### Feed Item Variants to Handle
| Variant | How to Detect | Rendering |
|---------|---------------|-----------|
| Normal user post | `authorType === "USER"` AND `!isRepost` | Standard post card |
| Page post | `authorType === "PAGE"` AND `!isRepost` | Post card with page avatar + page name. Tap author → page detail |
| Repost | `isRepost === true` | Repost wrapper (see Section 7) |
| Edited post | `editedAt !== null` | Show "(edited)" label |

### Other Feeds
- College: `GET /api/feed/college/:collegeId`
- House: `GET /api/feed/house/:houseId`
- Stories rail: `GET /api/feed/stories`
- Reel feed: `GET /api/feed/reels`

---

## <a name="pages"></a>10. NEW: Pages System (B3)

### What Are Pages?
Community-managed publishing accounts. Think Facebook Pages for college communities.

### Browse Pages
```
GET /api/pages?q=search&category=CLUB    → { "pages": [PageSnippet, ...] }
GET /api/pages/:idOrSlug                 → { "page": PageProfile }
GET /api/pages/:id/posts?cursor=...      → { "posts": [PostObject, ...] }
GET /api/me/pages                        → { "pages": [...] } (user's pages)
```

### Categories
`CLUB`, `MEME`, `STUDY_GROUP`, `DEPARTMENT`, `EVENT_HUB`, `NEWS`, `ALUMNI`, `CULTURAL`, `SPORTS`, `OTHER`

### Create Page
```
POST /api/pages
Body: {
  "name": "Meme Lords",
  "slug": "meme-lords",     // 3+ chars, lowercase, URL-safe
  "category": "MEME",
  "bio": "Best memes",       // optional
  "avatarMediaId": "uuid"    // optional
}
```
**Validation**: Slug must be unique. Reserved words (`admin`, `api`, `official`, `search`, `pages`) rejected. Name containing "official" rejected. `isOfficial: true` rejected (admin-only).

### Page Detail Response
```json
{
  "page": {
    "id": "uuid",
    "slug": "meme-lords",
    "name": "Meme Lords",
    "avatarUrl": "/api/media/xxx",
    "avatarMediaId": "xxx",
    "category": "MEME",
    "isOfficial": false,
    "verificationStatus": "NONE",
    "linkedEntityType": null,
    "linkedEntityId": null,
    "collegeId": null,
    "tribeId": null,
    "status": "ACTIVE",
    "bio": "Best memes",
    "subcategory": "",
    "coverUrl": null,
    "coverMediaId": null,
    "followerCount": 42,
    "memberCount": 3,
    "postCount": 15,
    "createdAt": "ISO...",
    "updatedAt": "ISO...",
    "viewerIsFollowing": true,    // <-- for current user
    "viewerRole": "EDITOR"         // <-- null if outsider
  }
}
```

### Follow/Unfollow Page
```
POST /api/pages/:id/follow      → { "followed": true }
DELETE /api/pages/:id/follow     → { "followed": false }
```
Optimistic UI safe: Yes.

### Page Member Management (role-gated)
```
GET /api/pages/:id/members                     → { "members": [...] }
POST /api/pages/:id/members                    → { "member": {...} }
   Body: { "userId": "uuid", "role": "EDITOR" }
PATCH /api/pages/:id/members/:userId           → { "member": {...} }
   Body: { "role": "ADMIN" }
DELETE /api/pages/:id/members/:userId           → 200
POST /api/pages/:id/transfer-ownership          → 200
   Body: { "userId": "uuid" }
```

### Publish as Page
```
POST /api/pages/:id/posts
Body: { "caption": "Page announcement" }
```
Returns PostObject with `authorType: "PAGE"`.

### Page Role Detection for UI
Use `viewerRole` from PageProfile:
```javascript
if (viewerRole === null) → show: Follow button, view posts
if (viewerRole === 'MODERATOR') → + view members
if (viewerRole === 'EDITOR') → + publish/edit posts
if (viewerRole === 'ADMIN') → + manage members, analytics
if (viewerRole === 'OWNER') → + archive/restore, transfer ownership
```

### Page Analytics (OWNER/ADMIN only)
```
GET /api/pages/:id/analytics?period=30d
```
**Response:**
```json
{
  "pageId": "uuid",
  "pageName": "Meme Lords",
  "period": "30d",
  "daysBack": 30,
  "overview": {
    "followerCount": 42,
    "memberCount": 3,
    "totalPosts": 15,
    "engagementRate": 4.5
  },
  "lifetime": {
    "totalLikes": 120,
    "totalComments": 45,
    "totalSaves": 20,
    "totalShares": 8,
    "totalViews": 500
  },
  "periodMetrics": {
    "postsCreated": 5,
    "likes": 30,
    "comments": 12,
    "saves": 5,
    "shares": 2,
    "views": 150,
    "newFollowers": 8,
    "engagementRate": 5.2
  },
  "topPosts": [ /* PostObjects ranked by engagement */ ],
  "postTimeline": [ /* { date, count } per day */ ],
  "followerTimeline": [ /* { date, count } per day */ ],
  "membersByRole": { "OWNER": 1, "ADMIN": 1, "EDITOR": 1 }
}
```

---

## <a name="social-graph"></a>11. Social Graph

### Follow/Unfollow User
```
POST /api/follow/:userId       → { "following": true }
DELETE /api/follow/:userId     → { "following": false }
```

### Lists
```
GET /api/users/:id/followers?cursor=...   → { "users": [UserSnippet, ...] }
GET /api/users/:id/following?cursor=...   → { "users": [UserSnippet, ...] }
```

### Block/Unblock
```
POST /api/me/blocks/:userId    → 200
DELETE /api/me/blocks/:userId  → 200
GET /api/me/blocks             → { "users": [...] }
```
**Effect**: Blocked user's content returns 404. Bidirectional visibility block.

---

## <a name="stories"></a>12. Stories

### Story Object Shape
```json
{
  "id": "uuid",
  "authorId": "user-uuid",
  "type": "IMAGE|VIDEO|TEXT",
  "media": { "id": "...", "url": "...", "type": "IMAGE", ... },
  "text": "Story text",
  "caption": "Caption text",
  "background": { "type": "solid|gradient", "colors": ["#fff"] },
  "stickers": [...],
  "privacy": "PUBLIC|CLOSE_FRIENDS|COLLEGE_ONLY|HOUSE_ONLY",
  "replyPrivacy": "EVERYONE|CLOSE_FRIENDS|NOBODY",
  "status": "ACTIVE|EXPIRED|ARCHIVED",
  "viewCount": 42,
  "reactionCount": 5,
  "replyCount": 3,
  "expiresAt": "ISO...",
  "archived": false,
  "createdAt": "ISO..."
}
```

### Key Endpoints
| Endpoint | Description |
|----------|-------------|
| `POST /stories` | Create story (media required) |
| `GET /stories/feed` | Story rails |
| `GET /stories/:id` | Story detail (includes author) |
| `DELETE /stories/:id` | Delete story |
| `POST /stories/:id/react` | React to story |
| `POST /stories/:id/reply` | Reply to story |
| `GET /me/stories/archive` | Archived stories |
| `POST /me/highlights` | Create highlight |
| `GET /users/:id/highlights` | User highlights |

### Story Gotchas
- Stories expire after 24 hours (`expiresAt`)
- API returns `410 GONE` for expired stories → remove from rail
- Close friends: `GET /me/close-friends`, `POST/DELETE /me/close-friends/:userId`
- Settings: `GET/PATCH /me/story-settings`

---

## <a name="reels"></a>13. Reels

### Reel Object Shape (Different from Posts!)
```json
{
  "id": "uuid",
  "creatorId": "user-uuid",
  "caption": "Check this out!",
  "hashtags": ["trending", "funny"],
  "mentions": [],
  "playbackUrl": "https://...",        // Direct video URL
  "thumbnailUrl": "https://...",
  "posterFrameUrl": "https://...",
  "mediaStatus": "READY|UPLOADING",
  "durationMs": 15000,
  "visibility": "PUBLIC",
  "status": "PUBLISHED|DRAFT|ARCHIVED|HELD",
  "likeCount": 100,
  "commentCount": 20,
  "saveCount": 10,
  "shareCount": 5,
  "viewCount": 500,
  "pinnedToProfile": false,
  "remixOf": null,
  "seriesId": null,
  "audioMeta": null,
  "createdAt": "ISO..."
}
```

**IMPORTANT**: Reels use `playbackUrl`/`thumbnailUrl` directly — NOT the MediaObject pattern. Do NOT try to resolve via `/api/media/:id`.

### Key Endpoints
| Endpoint | Description |
|----------|-------------|
| `POST /reels` | Create reel |
| `GET /reels/feed` | Reel feed |
| `GET /reels/following` | Following reels |
| `GET /reels/:id` | Reel detail |
| `PATCH /reels/:id` | Edit reel |
| `POST /reels/:id/like` | Like reel |
| `DELETE /reels/:id/like` | Unlike reel |
| `POST /reels/:id/comment` | Comment on reel |
| `GET /reels/:id/comments` | Reel comments |
| `POST /reels/:id/share` | Share reel |
| `POST /reels/:id/watch` | Record watch |
| `POST /reels/:id/view` | Record view |
| `GET /me/reels/analytics` | Analytics |
| `GET /me/reels/archive` | Archived reels |

### Known Issues (Deferred to B6)
- `POST /reels/:id/comment` may return 400 in some cases
- `POST /reels/:id/report` may return 400 in some cases

---

## <a name="notifications"></a>14. Notifications

### List Notifications
```
GET /api/notifications?cursor=...
```
**Response:**
```json
{
  "notifications": [
    {
      "id": "uuid",
      "userId": "recipient-uuid",
      "type": "COMMENT_LIKE",
      "actorId": "actor-uuid",
      "targetType": "COMMENT",
      "targetId": "comment-uuid",
      "message": "B4User30001 liked your comment",
      "read": false,
      "createdAt": "ISO..."
    }
  ]
}
```

### Mark as Read
```
PATCH /api/notifications/read
```

### All Notification Types
| Type | Trigger | Navigate To |
|------|---------|------------|
| `FOLLOW` | User follows you | Actor's profile |
| `LIKE` | Someone liked your post | Post detail |
| `COMMENT` | Someone commented on your post | Comment sheet |
| `COMMENT_LIKE` | Someone liked your comment **(B4 NEW)** | Comment sheet |
| `SHARE` | Someone reposted your content **(B4 NEW)** | Original post detail |
| `MENTION` | Someone mentioned you | Post/comment |
| `REPORT_RESOLVED` | Your report was resolved | — |
| `STRIKE_ISSUED` | You got a strike | — |
| `APPEAL_DECIDED` | Appeal result | — |
| `HOUSE_POINTS` | House points event | — |

### Deep-Link Logic
```javascript
switch (notification.targetType) {
  case 'CONTENT': navigate(`/post/${notification.targetId}`); break;
  case 'USER':    navigate(`/profile/${notification.targetId}`); break;
  case 'COMMENT': navigate(`/post/${notification.contentId}#comment-${notification.targetId}`); break;
  case 'PAGE':    navigate(`/page/${notification.targetId}`); break;
}
```

### Self-notification Prevention
Backend suppresses all self-notifications. If you like your own post, comment, or share your own content — no notification is created. Frontend does NOT need to filter.

---

## <a name="search"></a>15. Search & Discovery

### Unified Search
```
GET /api/search?q=keyword&type=users       → { "users": [...] }
GET /api/search?q=keyword&type=colleges    → { "colleges": [...] }
GET /api/search?q=keyword&type=houses      → { "houses": [...] }
GET /api/search?q=keyword&type=pages       → { "pages": [PageSnippet, ...] }   // B3 NEW
```

### Page-Specific Search
```
GET /api/pages?q=keyword&category=CLUB     → { "pages": [PageSnippet, ...] }
```

### User Suggestions
```
GET /api/suggestions/users                 → { "users": [...] }
```

### NOT YET FUNCTIONAL
- `GET /search?type=posts` — deferred to B5 (Hashtag/Discovery stage)

---

## <a name="tribes"></a>16. Tribes & Contests

### Tribes
```
GET /api/tribes                           → { "tribes": [...] }
GET /api/tribes/:id                       → { "tribe": TribeDetail }
GET /api/tribes/standings/current          → { "standings": [...] }
GET /api/tribes/:id/members               → { "members": [...] }
GET /api/me/tribe                         → { "tribe": {...} }
```

### Contests
```
GET /api/tribe-contests                   → { "contests": [...] }
GET /api/tribe-contests/:id               → { "contest": ContestDetail }
POST /api/tribe-contests/:id/enter        → 200
GET /api/tribe-contests/:id/leaderboard   → { "leaderboard": [...] }
POST /api/tribe-contests/:id/vote         → 200
GET /api/tribe-contests/seasons           → { "seasons": [...] }
```

---

## <a name="events"></a>17. Events

```
POST /api/events                          → create event
GET /api/events/feed                      → event feed
GET /api/events/:id                       → event detail
PATCH /api/events/:id                     → update event
POST /api/events/:id/rsvp                 → RSVP
DELETE /api/events/:id/rsvp               → cancel RSVP
GET /api/events/:id/attendees             → attendee list
GET /api/me/events                        → my created events
GET /api/me/events/rsvps                  → my RSVPs
```

---

## <a name="media"></a>18. Media Upload & Rendering

### Supabase Direct Upload (Recommended — All New Uploads)

**Step 1: Initialize Upload**
```
POST /api/media/upload-init
Authorization: Bearer <token>
Body: {
  "kind": "image" | "video",
  "mimeType": "image/jpeg",    // image/jpeg, image/png, image/webp, video/mp4, video/quicktime
  "sizeBytes": 12345,          // 1 byte to 200MB
  "scope": "posts"             // posts | reels | stories | thumbnails
}
```
**Response (201):**
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

**Step 2: Upload File Directly to Supabase**
```javascript
// Client uploads binary directly — NOT through our backend
await fetch(uploadUrl, {
  method: 'PUT',
  headers: { 'Content-Type': mimeType },
  body: fileBlob
});
```

**Step 3: Finalize Upload**
```
POST /api/media/upload-complete
Authorization: Bearer <token>
Body: {
  "mediaId": "uuid",
  "width": 1080,      // optional
  "height": 1920,     // optional
  "duration": 15.5    // optional, seconds (for video)
}
```
**Response (200):**
```json
{
  "id": "uuid",
  "url": "https://xxx.supabase.co/.../file.jpeg",
  "publicUrl": "https://xxx.supabase.co/.../file.jpeg",
  "thumbnailUrl": "https://..." | null,
  "thumbnailStatus": "NONE" | "READY" | "FAILED",
  "type": "IMAGE",
  "kind": "IMAGE",
  "mimeType": "image/jpeg",
  "size": 12345,
  "storageType": "SUPABASE",
  "status": "READY"
}
```

**Step 4: Check Upload Status (Optional)**
```
GET /api/media/upload-status/:mediaId
Authorization: Bearer <token>
```
**Response:**
```json
{
  "id": "uuid",
  "status": "PENDING_UPLOAD" | "READY",
  "thumbnailStatus": "NONE" | "PENDING" | "READY" | "FAILED",
  "thumbnailUrl": null | "https://...",
  "expiresAt": "2026-03-11T17:00:00.000Z",
  "publicUrl": "https://...",
  "type": "IMAGE",
  "kind": "IMAGE",
  "mimeType": "image/jpeg",
  "size": 12345,
  "storageType": "SUPABASE"
}
```

### Delete Media (NEW)
```
DELETE /api/media/:id
Authorization: Bearer <token>
```
**Response (200):** `{ "id": "uuid", "status": "DELETED" }`
**Errors:** 403 (not yours), 404 (not found), 409 (attached to content — remove from post/reel/story first)

### Media Serve
```
GET /api/media/:id (no auth required)
```
- Supabase: 302 redirect to CDN URL
- Legacy: 200 with binary body

### Rendering Rules
- **`avatarUrl`**: Pre-resolved URL for display. Use directly in `<img src>`.
- **`avatarUrl === null`**: Show default placeholder avatar.
- **`media[].url`**: Always present when `media[].id` exists. Direct Supabase CDN URL.
- **Reels**: Use `playbackUrl`/`thumbnailUrl` directly (NOT MediaObject pattern).
- **Frontend does NOT need to distinguish old/new** — `url` field always works.

### Thumbnail Status (Video uploads)
- After `upload-complete`, video thumbnails are auto-generated
- `thumbnailStatus`: `NONE` → `PENDING` → `READY`/`FAILED`
- Poll `upload-status` to check `thumbnailStatus` if needed
- `thumbnailUrl` available when `thumbnailStatus === "READY"`

---

## <a name="errors"></a>19. Error Handling

### Standard Error Response
```json
{
  "error": "Human-readable message",
  "code": "ERROR_CODE"
}
```

### Error Codes
| Code | HTTP | Meaning |
|------|------|---------|
| `VALIDATION_ERROR` | 400 | Bad input |
| `AUTH_REQUIRED` | 401 | Not authenticated |
| `FORBIDDEN` | 403 | Not authorized |
| `NOT_FOUND` | 404 | Resource doesn't exist or not accessible |
| `DUPLICATE` | 409 | Already exists |
| `EXPIRED` | 410 | Story expired |
| `CONTENT_REJECTED` | 422 | Moderation rejected |
| `RATE_LIMITED` | 429 | Too many requests |
| `INVALID_STATE` | 400 | Wrong state for action (e.g., edit archived page post) |

---

## <a name="pagination"></a>20. Pagination

All list endpoints use cursor-based pagination:

### Request
```
GET /api/feed/public?cursor=2026-03-10T17:00:00.000Z&limit=20
```

### Response
```json
{
  "items": [...],
  "pagination": {
    "nextCursor": "2026-03-10T16:45:00.000Z",
    "hasMore": true
  }
}
```

### Rules
- First request: omit `cursor`
- Subsequent: use `pagination.nextCursor`
- Stop when `hasMore === false` or `nextCursor === null`
- Default limit: 20
- Some endpoints return `posts` key instead of `items` (check response)
