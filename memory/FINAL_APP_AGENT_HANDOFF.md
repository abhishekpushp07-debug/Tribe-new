# TRIBE — FINAL APP AGENT HANDOFF PACK
**Version**: 3.0 FINAL
**Source**: Verified backend code + live API responses (7 source docs consolidated)
**Last verified**: 2026-03-10
**Status**: FROZEN — build from this, not from assumptions

---

## 1. BACKEND STATUS SNAPSHOT

### What Is Built & Frozen
| Domain | Status | Test Count |
|--------|--------|------------|
| Auth (register, login, refresh, logout, sessions, PIN change) | FROZEN | Covered |
| User profiles, onboarding, age gate | FROZEN | Covered |
| Content engine (create, read, delete) | FROZEN | Covered |
| Edit post caption (B4) | FROZEN | 72 tests |
| Comment like/unlike (B4) | FROZEN | 72 tests |
| Share/repost (B4) | FROZEN | 72 tests |
| Feeds (public, following, college, house, stories rail, reels) | FROZEN | Covered |
| Social graph (follow, unfollow, block) | FROZEN | Covered |
| Pages system — full CRUD, team, publishing, analytics (B3) | FROZEN | 107 tests |
| Comments (create, list, threading) | FROZEN | Covered |
| Notifications (list, mark read — 10 types) | FROZEN | Covered |
| Stories (create, feed, react, reply, highlights, close friends, settings) | FROZEN | Covered |
| Reels (create, feed, like, save, comment, share, watch, analytics) | FROZEN | Covered |
| Search (users, colleges, houses, pages) | FROZEN | Covered |
| Events (create, feed, RSVP, cancel, attendees) | FROZEN | Covered |
| Board notices (create, acknowledge, pin) | FROZEN | Covered |
| Resources (create, search, vote, download) | FROZEN | Covered |
| Tribes & contests | FROZEN | Covered |
| Governance (board, proposals, voting) | FROZEN | Covered |
| Media upload + resolve | FROZEN | Covered |
| Moderation pipeline (auto + manual) | FROZEN | Covered |
| **Total passing tests** | **633** | **Zero regressions** |

### What Is Intentionally Deferred
| Feature | Status | Stage |
|---------|--------|-------|
| `GET /search?type=posts` | NOT FUNCTIONAL | Deferred to B5 |
| `POST /reels/:id/comment` may 400 in edge cases | KNOWN BUG | Deferred to B6 |
| `POST /reels/:id/report` may 400 in edge cases | KNOWN BUG | Deferred to B6 |
| Separate test database | Not implemented | Deferred to B8 |
| Audit log TTL | Not implemented | Deferred to B8 |

---

## 2. MOBILE APP CRITICAL FEATURES

### 2.1 Feed
- **Public feed**: `GET /api/feed/public?cursor=...&limit=20`
- **Following feed**: `GET /api/feed/following?cursor=...&limit=20` — NOW includes posts from followed PAGES (B3)
- **College feed**: `GET /api/feed/college/:collegeId?cursor=...`
- **House feed**: `GET /api/feed/house/:houseId?cursor=...`
- All return `{ items: [PostObject, ...], pagination: { nextCursor, hasMore } }`
- Feed items can be: **normal user post**, **page-authored post** (B3), **repost** (B4), **edited post** (B4)
- Cursor-paginated. First request: omit cursor. Stop when `hasMore === false` or `nextCursor === null`

### 2.2 Post Detail
- **Fetch**: `GET /api/content/:id` → enriched PostObject
- **Like**: `POST /api/content/:id/like` → optimistic OK
- **Unlike**: `DELETE /api/content/:id/reaction` → optimistic OK
- **Save**: `POST /api/content/:id/save` → optimistic OK
- **Unsave**: `DELETE /api/content/:id/save` → optimistic OK
- **Edit** (B4): `PATCH /api/content/:id` body: `{ "caption": "..." }` → NOT optimistic (moderation re-check)
- **Share** (B4): `POST /api/content/:id/share` body: `{ "caption": "optional quote" }` → NOT optimistic (dup check)
- **Delete**: `DELETE /api/content/:id` → soft-delete, confirm first
- Show edit button ONLY if: user is author OR has page role OWNER/ADMIN/EDITOR
- Show "(edited)" if `editedAt !== null`
- If `isRepost === true`, embed original content card inside

### 2.3 Comments + Comment Like
- **List**: `GET /api/content/:postId/comments?cursor=...&limit=20`
  - Returns: `{ items: [CommentObject, ...], comments: [...], pagination: { nextCursor, hasMore } }`
  - `items` and `comments` are same array (backward-compat alias). Use `items`.
- **Create**: `POST /api/content/:postId/comments` body: `{ "text": "..." }`
- **Like comment** (B4): `POST /api/content/:postId/comments/:commentId/like` → `{ liked: true, commentLikeCount: N }`
- **Unlike comment** (B4): `DELETE /api/content/:postId/comments/:commentId/like` → `{ liked: false, commentLikeCount: N }`
- Comment like is optimistic-safe. Toggle heart + update count immediately.
- Comments have `parentId` for threading (null = top-level, set = reply). API returns flat list — frontend nests.
- Display `Math.max(0, comment.likeCount)` for safety (rare edge-case can produce -1 temporarily).

### 2.4 Edit Post (B4)
- `PATCH /api/content/:id` body: `{ "caption": "new text" }`
- Returns full enriched PostObject with `editedAt` set
- **NOT optimistic** — backend runs moderation re-check. Wait for 200. On 422: moderation rejected.
- Who can edit: post owner, OR page role OWNER/ADMIN/EDITOR for page posts
- What can't change: media, visibility, author fields
- Cannot edit REMOVED posts (404) or posts on ARCHIVED pages (400)
- Empty caption on text-only post → 400

### 2.5 Repost/Share (B4)
- `POST /api/content/:id/share` body: `{ "caption": "optional quote" }` (caption optional)
- Returns 201 with `{ post: RepostObject }`
- **NOT optimistic** — wait for server response
- Rules: one repost per user per original (409 on duplicate), cannot repost a repost (400), cannot repost deleted (404)
- `shareCount` increments on the ORIGINAL post, not the repost
- After successful share: disable share button or show "Shared"
- Repost rendering: show reposter header + embedded original content card
- If `originalContent === null`, original was deleted → show "Original content was removed"

### 2.6 User Profiles
- **Self**: `GET /api/auth/me` → full UserProfile
- **Other**: `GET /api/users/:id` → UserProfile + `isFollowing` field
- **User posts**: `GET /api/users/:id/posts?cursor=...`
- **Followers**: `GET /api/users/:id/followers?cursor=...`
- **Following**: `GET /api/users/:id/following?cursor=...`
- **Saved** (self only): `GET /api/users/:id/saved?cursor=...`
- **Follow**: `POST /api/follow/:userId` → optimistic OK
- **Unfollow**: `DELETE /api/follow/:userId` → optimistic OK
- **Update profile**: `PATCH /api/me/profile` body: `{ displayName, bio, avatarMediaId }`
- **Change PIN**: `PATCH /api/auth/pin` body: `{ currentPin, newPin }`

### 2.7 Stories
- **Create**: `POST /api/stories` (media required)
- **Story rail**: `GET /api/stories/feed`
- **Detail**: `GET /api/stories/:id`
- **Delete**: `DELETE /api/stories/:id`
- **React**: `POST /api/stories/:id/react`
- **Reply**: `POST /api/stories/:id/reply`
- **Archive**: `GET /api/me/stories/archive`
- **Highlights**: `POST /api/me/highlights`, `GET /api/users/:id/highlights`
- **Settings**: `GET/PATCH /api/me/story-settings`
- **Close friends**: `GET /api/me/close-friends`, `POST/DELETE /api/me/close-friends/:userId`
- Stories expire 24h after creation (`expiresAt`). API returns 410 for expired. Remove from rail.

### 2.8 Reels
- **Create**: `POST /api/reels`
- **Feed**: `GET /api/reels/feed?cursor=...`
- **Following**: `GET /api/reels/following`
- **Detail**: `GET /api/reels/:id`
- **Like/Unlike**: `POST/DELETE /api/reels/:id/like`
- **Save/Unsave**: `POST/DELETE /api/reels/:id/save`
- **Comment**: `POST /api/reels/:id/comment` (may 400 in edge cases — known B6 bug)
- **Comments list**: `GET /api/reels/:id/comments`
- **Share**: `POST /api/reels/:id/share`
- **Report**: `POST /api/reels/:id/report` (may 400 in edge cases — known B6 bug)
- **Watch**: `POST /api/reels/:id/watch`
- **Analytics**: `GET /api/me/reels/analytics`
- **User reels**: `GET /api/users/:id/reels`
- **CRITICAL**: Reels use `playbackUrl`/`thumbnailUrl` directly — NOT MediaObject. Use `creatorId` not `authorId`.

### 2.9 Notifications
- **List**: `GET /api/notifications?cursor=...`
- **Mark read**: `PATCH /api/notifications/read`
- 10 types: FOLLOW, LIKE, COMMENT, COMMENT_LIKE (B4), SHARE (B4), MENTION, REPORT_RESOLVED, STRIKE_ISSUED, APPEAL_DECIDED, HOUSE_POINTS
- Backend pre-formats `message` field — render as-is
- Self-notifications suppressed by backend — no frontend filtering needed
- Deep-link by `targetType`: CONTENT→post detail, USER→profile, COMMENT→comment sheet, PAGE→page detail

### 2.10 Search
- Unified: `GET /api/search?q=...&type=users|colleges|houses|pages`
- Page-specific: `GET /api/pages?q=...&category=...`
- User suggestions: `GET /api/suggestions/users`
- College search: `GET /api/colleges/search?q=...`
- **NOT FUNCTIONAL**: `type=posts` (deferred to B5)

### 2.11 Pages System (B3)
- **Browse**: `GET /api/pages?q=...&category=...` → `{ pages: [PageSnippet, ...] }`
- **My pages**: `GET /api/me/pages` → `{ pages: [...] }`
- **Detail**: `GET /api/pages/:idOrSlug` → `{ page: PageProfile }` (includes `viewerRole`, `viewerIsFollowing`)
- **Create**: `POST /api/pages` body: `{ name, slug, category, bio?, avatarMediaId? }`
- **Update**: `PATCH /api/pages/:id` body: `{ name?, bio?, avatarMediaId? }`
- **Archive**: `POST /api/pages/:id/archive` (OWNER only)
- **Restore**: `POST /api/pages/:id/restore` (OWNER only)
- **Follow/Unfollow**: `POST/DELETE /api/pages/:id/follow` → optimistic OK
- **Followers**: `GET /api/pages/:id/followers`
- **Analytics** (OWNER/ADMIN): `GET /api/pages/:id/analytics?period=30d`
- Categories: CLUB, MEME, STUDY_GROUP, DEPARTMENT, EVENT_HUB, NEWS, ALUMNI, CULTURAL, SPORTS, OTHER
- Slug validation: 3+ chars, lowercase, URL-safe. Reserved words rejected. "official" in name rejected.

### 2.12 Page Posts
- **List**: `GET /api/pages/:id/posts?cursor=...` → `{ posts: [PostObject, ...] }`
- **Publish as page**: `POST /api/pages/:id/posts` body: `{ caption }` → returns PostObject with `authorType: "PAGE"`
- **Edit page post**: `PATCH /api/pages/:id/posts/:postId` body: `{ caption }`
- **Delete page post**: `DELETE /api/pages/:id/posts/:postId`
- Also editable via generic: `PATCH /api/content/:postId` (checks page role)
- Required page role for post actions: OWNER, ADMIN, or EDITOR

### 2.13 Page Member Management
- **List**: `GET /api/pages/:id/members` → `{ members: [...] }`
- **Add**: `POST /api/pages/:id/members` body: `{ userId, role }` — OWNER/ADMIN only
- **Change role**: `PATCH /api/pages/:id/members/:userId` body: `{ role }` — OWNER/ADMIN only
- **Remove**: `DELETE /api/pages/:id/members/:userId` — OWNER/ADMIN only
- **Transfer ownership**: `POST /api/pages/:id/transfer-ownership` body: `{ userId }` — OWNER only
- Role hierarchy: OWNER > ADMIN > EDITOR > MODERATOR
- ADMIN cannot promote to OWNER or mutate OWNER
- Transfer side effects: old owner → ADMIN, new owner → OWNER. Refresh page detail after.

### 2.14 Mixed User/Page Author Rendering
```
DECISION TREE FOR EVERY POST CARD:

1. Is post.isRepost === true?
   YES → render repost layout:
         - Header: post.author (reposter) + "reposted"
         - Body: embedded post.originalContent (check originalContent.authorType)
         - If originalContent === null → "Original content was removed"
   NO → continue to step 2

2. Is post.authorType === "PAGE"?
   YES → author is PageSnippet:
         - Display name: post.author.name
         - Avatar: post.author.avatarUrl || defaultPagePlaceholder
         - Tap → navigate to /page/{post.author.slug}
         - Show verification badge if verificationStatus === "VERIFIED"
   NO → author is UserSnippet:
         - Display name: post.author.displayName || post.author.username || "Anonymous"
         - Avatar: post.author.avatarUrl || defaultAvatarPlaceholder
         - Tap → navigate to /profile/{post.author.id}

3. Is post.editedAt !== null?
   YES → show "(edited)" indicator next to timestamp
```

---

## 3. CANONICAL OBJECTS

### UserSnippet
```json
{
  "id": "uuid",
  "displayName": "string | null",
  "username": "string | null",
  "avatarUrl": "string | null",
  "avatarMediaId": "string | null",
  "avatar": "string | null (DEPRECATED — same as avatarMediaId)",
  "role": "USER | MODERATOR | ADMIN | SUPER_ADMIN",
  "collegeId": "string | null",
  "collegeName": "string | null",
  "houseId": "string | null",
  "houseName": "string | null",
  "tribeId": "string | null",
  "tribeCode": "string | null"
}
```

### PageSnippet
```json
{
  "id": "uuid",
  "slug": "string",
  "name": "string",
  "avatarUrl": "string | null",
  "avatarMediaId": "string | null",
  "category": "CLUB | MEME | STUDY_GROUP | DEPARTMENT | EVENT_HUB | NEWS | ALUMNI | CULTURAL | SPORTS | OTHER",
  "isOfficial": "boolean",
  "verificationStatus": "NONE | PENDING | VERIFIED | REJECTED",
  "linkedEntityType": "string | null",
  "linkedEntityId": "string | null",
  "collegeId": "string | null",
  "tribeId": "string | null",
  "status": "ACTIVE | ARCHIVED | SUSPENDED"
}
```
**KEY**: PageSnippet has `name` + `slug`. UserSnippet has `displayName` + `username`. They are DIFFERENT shapes.

### MediaObject
```json
{
  "id": "uuid",
  "url": "/api/media/{id}",
  "type": "IMAGE | VIDEO | AUDIO | null",
  "thumbnailUrl": "string | null",
  "width": "number | null",
  "height": "number | null",
  "duration": "number | null",
  "mimeType": "string",
  "size": "number"
}
```
Rule: When `media[].id` exists, `media[].url` is always present.

### PostObject (FeedItem)
```json
{
  "id": "uuid",
  "kind": "POST | REEL | STORY",
  "caption": "string",
  "media": ["MediaObject, ..."],
  "mediaIds": ["string, ..."],
  "authorId": "uuid",
  "authorType": "USER | PAGE",
  "createdAs": "USER | PAGE",
  "author": "UserSnippet (if USER) | PageSnippet (if PAGE)",
  "pageId": "uuid | null",
  "actingUserId": "uuid (real human — audit only, do NOT render)",
  "actingRole": "OWNER | ADMIN | EDITOR | null",
  "visibility": "PUBLIC | COLLEGE_ONLY | HOUSE_ONLY | PRIVATE",
  "likeCount": "number",
  "commentCount": "number",
  "saveCount": "number",
  "shareCount": "number",
  "viewCount": "number",
  "viewerHasLiked": "boolean",
  "viewerHasDisliked": "boolean",
  "viewerHasSaved": "boolean",
  "editedAt": "ISO string | null (B4: non-null if edited)",
  "isRepost": "boolean | undefined (B4: true for reposts)",
  "originalContentId": "uuid | undefined (B4: set for reposts)",
  "originalContent": "PostObject | null | undefined (B4: embedded original for reposts)",
  "syntheticDeclaration": "boolean | null",
  "collegeId": "string | null",
  "houseId": "string | null",
  "distributionStage": "number",
  "duration": "number | null",
  "expiresAt": "ISO string | null",
  "createdAt": "ISO string",
  "updatedAt": "ISO string"
}
```

### RepostObject
Same shape as PostObject, but:
- `isRepost: true`
- `originalContentId: "original-post-uuid"`
- `originalContent: { ...PostObject of original }` (or `null` if deleted)
- `media: []` (reposts have no own media)
- `caption: ""` or optional quote text
- Own counters start at 0

### CommentObject
```json
{
  "id": "uuid",
  "contentId": "uuid (parent post ID)",
  "authorId": "uuid",
  "author": "UserSnippet",
  "text": "string",
  "body": "string (same as text — backward-compat alias)",
  "likeCount": "number",
  "parentId": "uuid | null (null = top-level, set = reply)",
  "moderation": "null",
  "createdAt": "ISO string"
}
```

### StoryObject
```json
{
  "id": "uuid",
  "authorId": "uuid",
  "type": "IMAGE | VIDEO | TEXT",
  "media": "MediaObject | null",
  "text": "string | null",
  "caption": "string | null",
  "background": "{ type: 'solid' | 'gradient', colors: ['#hex', ...] } | null",
  "stickers": "array",
  "privacy": "PUBLIC | CLOSE_FRIENDS | COLLEGE_ONLY | HOUSE_ONLY",
  "replyPrivacy": "EVERYONE | CLOSE_FRIENDS | NOBODY",
  "status": "ACTIVE | EXPIRED | ARCHIVED",
  "viewCount": "number",
  "reactionCount": "number",
  "replyCount": "number",
  "expiresAt": "ISO string",
  "archived": "boolean",
  "createdAt": "ISO string"
}
```

### ReelObject (DIFFERENT from PostObject)
```json
{
  "id": "uuid",
  "creatorId": "uuid (NOT authorId!)",
  "caption": "string | null",
  "hashtags": ["string, ..."],
  "mentions": ["string, ..."],
  "playbackUrl": "string | null (direct video URL — NOT MediaObject)",
  "thumbnailUrl": "string | null",
  "posterFrameUrl": "string | null",
  "mediaStatus": "READY | UPLOADING",
  "durationMs": "number",
  "visibility": "PUBLIC | COLLEGE_ONLY | PRIVATE",
  "status": "PUBLISHED | DRAFT | ARCHIVED | HELD",
  "likeCount": "number",
  "commentCount": "number",
  "saveCount": "number",
  "shareCount": "number",
  "viewCount": "number",
  "uniqueViewerCount": "number",
  "pinnedToProfile": "boolean",
  "remixOf": "uuid | null",
  "seriesId": "uuid | null",
  "audioMeta": "object | null",
  "syntheticDeclaration": "boolean",
  "brandedContent": "boolean",
  "createdAt": "ISO string"
}
```

### NotificationObject
```json
{
  "id": "uuid",
  "userId": "uuid (recipient)",
  "type": "FOLLOW | LIKE | COMMENT | COMMENT_LIKE | SHARE | MENTION | REPORT_RESOLVED | STRIKE_ISSUED | APPEAL_DECIDED | HOUSE_POINTS",
  "actorId": "uuid",
  "targetType": "USER | CONTENT | COMMENT | PAGE",
  "targetId": "uuid",
  "message": "string (pre-formatted — render as-is)",
  "read": "boolean",
  "createdAt": "ISO string"
}
```

### CollegeSnippet
```json
{
  "id": "uuid",
  "officialName": "string",
  "shortName": "string",
  "city": "string",
  "state": "string",
  "type": "string (IIT, NIT, IIIT, etc.)",
  "membersCount": "number"
}
```

---

## 4. SCREEN TO ENDPOINT SUMMARY

### Screen 1: Splash / Auth Check
| Action | Method | Endpoint | Auth | Response | Notes |
|--------|--------|----------|------|----------|-------|
| Check login | GET | /api/auth/me | Yes | UserProfile | 200=logged in, 401=show login |

### Screen 2: Login
| Action | Method | Endpoint | Auth | Body | Response | Errors |
|--------|--------|----------|------|------|----------|--------|
| Login | POST | /api/auth/login | No | `{ phone, pin }` | `{ accessToken, refreshToken, user }` | 401=wrong pin, 404=phone not found |

### Screen 3: Register
| Action | Method | Endpoint | Auth | Body | Response | Errors |
|--------|--------|----------|------|------|----------|--------|
| Register | POST | /api/auth/register | No | `{ phone, pin, displayName, username }` | `{ accessToken, refreshToken, user }` | 409=phone/username exists, 400=validation |

### Screen 4: Onboarding
| Step | Method | Endpoint | Auth | Body | Notes |
|------|--------|----------|------|------|-------|
| Check step | — | Read `user.onboardingStep` | — | — | null = complete |
| Set age | PATCH | /api/me/age | Yes | `{ birthDate: "2000-01-15" }` | Sets ageStatus |
| Set college | PATCH | /api/me/college | Yes | `{ collegeId: "uuid" }` | — |
| Find colleges | GET | /api/colleges/search?q=... | No | — | Paginated |
| Complete | PATCH | /api/me/onboarding | Yes | `{ step: "COMPLETE" }` | — |

### Screen 5: Edit Profile
| Action | Method | Endpoint | Auth | Body |
|--------|--------|----------|------|------|
| Update name/bio | PATCH | /api/me/profile | Yes | `{ displayName, bio }` |
| Upload avatar | POST | /api/media/upload | Yes | multipart/form-data |
| Set avatar | PATCH | /api/me/profile | Yes | `{ avatarMediaId: "id" }` |
| Change PIN | PATCH | /api/auth/pin | Yes | `{ currentPin, newPin }` |

### Screen 6: Home Feed
| Action | Method | Endpoint | Auth | Pagination | Notes |
|--------|--------|----------|------|------------|-------|
| Public feed | GET | /api/feed/public | Yes | cursor+limit | Mixed user+page posts |
| Following feed | GET | /api/feed/following | Yes | cursor+limit | Includes followed page posts (B3) |
| College feed | GET | /api/feed/college/:collegeId | Yes | cursor+limit | Requires collegeId |
| Like post | POST | /api/content/:id/like | Yes | — | Optimistic OK |
| Save post | POST | /api/content/:id/save | Yes | — | Optimistic OK |
| Share post (B4) | POST | /api/content/:id/share | Yes | — | NOT optimistic — wait 201 |

### Screen 7: Post Detail
| Action | Method | Endpoint | Auth | Notes |
|--------|--------|----------|------|-------|
| Fetch detail | GET | /api/content/:id | Yes | Enriched PostObject |
| Like | POST | /api/content/:id/like | Yes | Optimistic |
| Unlike | DELETE | /api/content/:id/reaction | Yes | Optimistic |
| Save | POST | /api/content/:id/save | Yes | Optimistic |
| Edit (B4) | PATCH | /api/content/:id | Yes | NOT optimistic (moderation) |
| Share (B4) | POST | /api/content/:id/share | Yes | NOT optimistic |
| Delete | DELETE | /api/content/:id | Yes | Confirm first |

### Screen 8: Comment Sheet
| Action | Method | Endpoint | Auth | Pagination |
|--------|--------|----------|------|------------|
| List comments | GET | /api/content/:postId/comments | Optional | cursor+limit |
| Create comment | POST | /api/content/:postId/comments | Yes | — |
| Like comment (B4) | POST | /api/content/:postId/comments/:commentId/like | Yes | — |
| Unlike comment (B4) | DELETE | /api/content/:postId/comments/:commentId/like | Yes | — |

### Screen 9: Create Post
| Action | Method | Endpoint | Auth | Notes |
|--------|--------|----------|------|-------|
| Upload media | POST | /api/media/upload | Yes | Returns { id, url } |
| Create post | POST | /api/content/posts | Yes | NOT optimistic. Requires ageStatus=ADULT |

### Screen 10: Edit Post (B4)
| Action | Method | Endpoint | Auth | Notes |
|--------|--------|----------|------|-------|
| Edit caption | PATCH | /api/content/:id | Yes | Body: `{ caption }`. NOT optimistic |
| Who: post owner OR page role OWNER/ADMIN/EDITOR | | | | Cannot edit media/visibility |

### Screen 11: Share/Repost (B4)
| Action | Method | Endpoint | Auth | Notes |
|--------|--------|----------|------|-------|
| Share | POST | /api/content/:id/share | Yes | Body: `{ caption? }`. NOT optimistic |
| 409=already shared, 400=repost of repost, 404=deleted | | | | |

### Screen 12: Notifications
| Action | Method | Endpoint | Auth | Pagination |
|--------|--------|----------|------|------------|
| List | GET | /api/notifications | Yes | cursor |
| Mark read | PATCH | /api/notifications/read | Yes | — |
| Deep-link: targetType CONTENT→post, USER→profile, COMMENT→comment sheet, PAGE→page detail |

### Screen 13: Search
| Action | Method | Endpoint | Auth | Notes |
|--------|--------|----------|------|-------|
| Search users | GET | /api/search?q=...&type=users | No | UserSnippets |
| Search colleges | GET | /api/search?q=...&type=colleges | No | CollegeSnippets |
| Search pages (B3) | GET | /api/search?q=...&type=pages | No | PageSnippets |
| Page search + filter | GET | /api/pages?q=...&category=... | No | With category |
| Suggestions | GET | /api/suggestions/users | Yes | Recommendation rail |
| NOT WORKING: type=posts | — | — | — | Deferred B5 |

### Screen 14: User Profile
| Action | Method | Endpoint | Auth | Notes |
|--------|--------|----------|------|-------|
| Self profile | GET | /api/auth/me | Yes | Full profile |
| Other profile | GET | /api/users/:id | Optional | + isFollowing |
| User posts | GET | /api/users/:id/posts | Optional | cursor paginated |
| Followers | GET | /api/users/:id/followers | Optional | — |
| Following | GET | /api/users/:id/following | Optional | — |
| Saved | GET | /api/users/:id/saved | Yes (self) | — |
| Follow | POST | /api/follow/:userId | Yes | Optimistic |
| Unfollow | DELETE | /api/follow/:userId | Yes | Optimistic |

### Screen 15: Stories
| Action | Method | Endpoint | Auth |
|--------|--------|----------|------|
| Story rail | GET | /api/stories/feed | Yes |
| View story | GET | /api/stories/:id | Yes |
| Create story | POST | /api/stories | Yes |
| React | POST | /api/stories/:id/react | Yes |
| Reply | POST | /api/stories/:id/reply | Yes |
| Delete | DELETE | /api/stories/:id | Yes |
| Archive | GET | /api/me/stories/archive | Yes |
| Highlights | POST /api/me/highlights, GET /api/users/:id/highlights | Yes |
| Settings | GET/PATCH /api/me/story-settings | Yes |
| Close friends | GET/POST/DELETE /api/me/close-friends[/:userId] | Yes |
| Edge: 410 GONE on expired story — remove from rail |

### Screen 16: Reels
| Action | Method | Endpoint | Auth |
|--------|--------|----------|------|
| Feed | GET | /api/reels/feed?cursor=... | Yes |
| Following | GET | /api/reels/following | Yes |
| Detail | GET | /api/reels/:id | Yes |
| Like/Unlike | POST/DELETE | /api/reels/:id/like | Yes |
| Save/Unsave | POST/DELETE | /api/reels/:id/save | Yes |
| Comment | POST | /api/reels/:id/comment | Yes |
| Comments | GET | /api/reels/:id/comments | Yes |
| Share | POST | /api/reels/:id/share | Yes |
| Watch | POST | /api/reels/:id/watch | Yes |
| Analytics | GET | /api/me/reels/analytics | Yes |
| User reels | GET | /api/users/:id/reels | Yes |
| CRITICAL: Use playbackUrl/thumbnailUrl directly, NOT MediaObject |

### Screen 17: Page List (B3)
| Action | Method | Endpoint | Auth |
|--------|--------|----------|------|
| Browse pages | GET | /api/pages?q=...&category=... | No |
| My pages | GET | /api/me/pages | Yes |

### Screen 18: Page Detail (B3)
| Action | Method | Endpoint | Auth | Notes |
|--------|--------|----------|------|-------|
| Detail | GET | /api/pages/:idOrSlug | No | Returns viewerRole |
| Posts | GET | /api/pages/:id/posts?cursor=... | No | — |
| Follow | POST | /api/pages/:id/follow | Yes | Optimistic |
| Unfollow | DELETE | /api/pages/:id/follow | Yes | Optimistic |
| Analytics | GET | /api/pages/:id/analytics | Yes | OWNER/ADMIN only |
| Use viewerRole to gate admin buttons |

### Screen 19: Page Create/Edit (B3)
| Action | Method | Endpoint | Auth | Body |
|--------|--------|----------|------|------|
| Create | POST | /api/pages | Yes | `{ name, slug, category, bio?, avatarMediaId? }` |
| Update | PATCH | /api/pages/:id | Yes | `{ name?, bio?, avatarMediaId? }` |
| Archive | POST | /api/pages/:id/archive | Yes | OWNER only |
| Restore | POST | /api/pages/:id/restore | Yes | OWNER only |

### Screen 20: Page Members (B3)
| Action | Method | Endpoint | Auth | Who Can |
|--------|--------|----------|------|---------|
| List | GET | /api/pages/:id/members | Yes | Any member |
| Add | POST | /api/pages/:id/members | Yes | OWNER/ADMIN |
| Change role | PATCH | /api/pages/:id/members/:userId | Yes | OWNER/ADMIN |
| Remove | DELETE | /api/pages/:id/members/:userId | Yes | OWNER/ADMIN |
| Transfer | POST | /api/pages/:id/transfer-ownership | Yes | OWNER only |

### Screen 21: Events
| Action | Method | Endpoint | Auth |
|--------|--------|----------|------|
| Feed | GET | /api/events/feed | No |
| Detail | GET | /api/events/:id | No |
| Create | POST | /api/events | Yes |
| RSVP | POST | /api/events/:id/rsvp | Yes |
| Cancel RSVP | DELETE | /api/events/:id/rsvp | Yes |
| My events | GET | /api/me/events | Yes |
| My RSVPs | GET | /api/me/events/rsvps | Yes |

### Screen 22: Resources
| Action | Method | Endpoint | Auth |
|--------|--------|----------|------|
| Search | GET | /api/resources/search?q=... | No |
| Detail | GET | /api/resources/:id | No |
| Create | POST | /api/resources | Yes |
| Vote | POST | /api/resources/:id/vote | Yes |
| My resources | GET | /api/me/resources | Yes |

### Screen 23: Board Notices
| Action | Method | Endpoint | Auth |
|--------|--------|----------|------|
| Create | POST | /api/board/notices | Yes |
| Detail | GET | /api/board/notices/:id | No |
| College notices | GET | /api/colleges/:id/notices | No |
| Acknowledge | POST | /api/board/notices/:id/acknowledge | Yes |

### Screen 24: Tribes & Contests
| Action | Method | Endpoint | Auth |
|--------|--------|----------|------|
| List tribes | GET | /api/tribes | No |
| Tribe detail | GET | /api/tribes/:id | No |
| Standings | GET | /api/tribes/standings/current | No |
| My tribe | GET | /api/me/tribe | Yes |
| List contests | GET | /api/tribe-contests | No |
| Contest detail | GET | /api/tribe-contests/:id | No |
| Enter | POST | /api/tribe-contests/:id/enter | Yes |
| Leaderboard | GET | /api/tribe-contests/:id/leaderboard | No |
| Vote | POST | /api/tribe-contests/:id/vote | Yes |

### Screen 25: Block Management
| Action | Method | Endpoint | Auth |
|--------|--------|----------|------|
| Block | POST | /api/me/blocks/:userId | Yes |
| Unblock | DELETE | /api/me/blocks/:userId | Yes |
| Blocked list | GET | /api/me/blocks | Yes |

### Screen 26: Governance
| Action | Method | Endpoint | Auth |
|--------|--------|----------|------|
| College board | GET | /api/governance/college/:id/board | No |
| Apply | POST | /api/governance/college/:id/apply | Yes |
| Proposals | GET | /api/governance/college/:id/proposals | No |
| Vote | POST | /api/governance/proposals/:id/vote | Yes |

---

## 5. FRONTEND CRITICAL RULES

### Rule 1: authorType Handling (MOST CRITICAL)
```
WRONG: post.author.displayName  ← CRASHES on page posts
RIGHT: post.authorType === 'PAGE' ? post.author.name : (post.author.displayName || post.author.username || 'Anonymous')
```
- `authorType: "USER"` → author is UserSnippet → has `displayName`, `username`, NO `slug`
- `authorType: "PAGE"` → author is PageSnippet → has `name`, `slug`, NO `displayName`
- Following feed mixes both types. EVERY PostCard MUST branch on authorType.

### Rule 2: avatarUrl Canonical Use
- `avatarUrl` = pre-resolved display URL. Use directly in `<img src>`.
- `avatarUrl === null` → show default placeholder (user avatar or page icon).
- `avatarMediaId` = raw media ID. Only for profile edit (upload flow).
- `avatar` field is DEPRECATED. Ignore it.
- URL format is typically `/api/media/{id}` (relative path).

### Rule 3: Repost Rendering Rules
- Detect: `post.isRepost === true`
- `post.author` = reposter (always UserSnippet)
- `post.originalContent` = embedded original post (has its own `author` which can be UserSnippet OR PageSnippet)
- `post.originalContent === null` → original was deleted → show "Original content was removed"
- Repost has its OWN counters (start at 0). ORIGINAL post's `shareCount` incremented.
- Cannot repost a repost. Cannot repost twice. Frontend should disable share after success.

### Rule 4: Page-Role Gated Actions
Use `viewerRole` from `GET /pages/:idOrSlug`:
```
viewerRole === null       → outsider: Follow button, browse posts only
viewerRole === 'MODERATOR' → + view member list
viewerRole === 'EDITOR'    → + publish/edit/delete posts
viewerRole === 'ADMIN'     → + manage members, view analytics
viewerRole === 'OWNER'     → + archive/restore, transfer ownership
```

### Rule 5: Permission Assumptions Frontend Must NOT Make
- Do NOT assume a user can edit any post — server checks ownership + page role
- Do NOT assume content exists — it may be soft-deleted (404) or blocked (404)
- Do NOT assume age status — always check `user.ageStatus === "ADULT"` before showing create buttons
- Do NOT filter self-notifications — backend handles suppression
- Do NOT assume repost is allowed — server checks duplicates and repost-of-repost

### Rule 6: Optimistic UI Safe/Unsafe
| Action | Optimistic Safe? | Why |
|--------|-----------------|-----|
| Like/Unlike post | YES | Simple toggle, no server validation |
| Save/Unsave post | YES | Simple toggle |
| Follow/Unfollow user | YES | Simple toggle |
| Follow/Unfollow page | YES | Simple toggle |
| Comment like/unlike | YES | Simple toggle |
| Edit post | NO | Backend runs moderation re-check. Can reject (422) |
| Share/Repost | NO | Server checks duplicates (409) and repost-of-repost (400) |
| Create post | NO | Server checks age gate, moderation |
| All page management actions | NO | Server checks role permissions |

### Rule 7: Nullability & Fallback Rules
| Field | Can Be Null | Fallback |
|-------|-------------|----------|
| `author.displayName` | Yes | `author.username || "Anonymous"` |
| `author.username` | Yes | Use displayName |
| `author.avatarUrl` | Yes | Default placeholder |
| `post.editedAt` | Yes (most posts) | Don't show "(edited)" |
| `post.originalContent` | Yes (deleted original) | "Original content was removed" |
| `post.media` | Empty array | No media section |
| `comment.parentId` | Yes (top-level) | Top-level comment |
| `user.collegeId` | Yes | Hide college-specific UI |
| `user.houseId` | Yes | Hide house-specific UI |
| `page.bio` | Yes | Empty or "No description" |
| `page.coverUrl` | Yes | Default cover |
| `story.text` | Yes | Use media only |
| `reel.playbackUrl` | Yes (if UPLOADING) | Show loading state |

---

## 6. GOTCHAS SUMMARY (Top Frontend Traps)

| # | Gotcha | Impact | Rule |
|---|--------|--------|------|
| 1 | **Dual author system** | Crash on page posts | Always check `authorType` before accessing author fields |
| 2 | **Repost null original** | Crash on deleted originals | Guard `originalContent === null` |
| 3 | **Avatar resolution** | Broken images | Use `avatarUrl` directly, not `avatarMediaId` |
| 4 | **Pagination key inconsistency** | Missing data | Check `data.items \|\| data.posts \|\| data.comments \|\| []` |
| 5 | **Age gate** | 403 on create | Check `ageStatus === "ADULT"` before showing create UI |
| 6 | **Reel media pattern** | Broken video | Use `playbackUrl`/`thumbnailUrl` directly, NOT `/api/media/:id` |
| 7 | **Story expiry** | 410 errors | Handle 410, remove from rail, check `expiresAt` |
| 8 | **Edit not optimistic** | Stale UI | Wait for server 200 before updating UI (moderation re-check) |
| 9 | **Share not optimistic** | Duplicate reposts | Wait for 201; handle 409 (already shared) |
| 10 | **Comment likeCount can be -1** | Display bug | Use `Math.max(0, count)` |
| 11 | **Page posts in following feed** | Wrong navigation | Tap page-author → page detail, not profile |
| 12 | **actingUserId is audit-only** | Privacy leak | NEVER render actingUserId to end users |
| 13 | **Comment has text AND body** | Confusion | Use `text` field |
| 14 | **Soft deletes return 404** | Error handling | Treat 404 as "gone", remove from UI |
| 15 | **Rate limiting** | 429 errors | Show "Please wait", retry after `Retry-After` header |
| 16 | **Moderation rejection** | 422 on create/edit | Show error, let user modify content |
| 17 | **Block is bidirectional** | Content disappears | On block, content vanishes from BOTH users' views |
| 18 | **Transfer ownership changes viewerRole** | Stale UI | Refresh page detail + members after transfer |
| 19 | **Search type=posts broken** | No results | Don't offer post search (deferred to B5) |
| 20 | **Reel uses creatorId not authorId** | Wrong field access | Check field name carefully |

---

## 7. BUILD ORDER RECOMMENDATION

### Phase 1: Foundation (Must-Have First)
1. **Auth flow** — Login, Register, token storage, refresh flow, 401 handling
2. **Onboarding** — Age, college selection, completion
3. **API client** — Centralized HTTP client with auth headers, error handling, pagination helpers

### Phase 2: Core Feed Loop
4. **Home Feed** — Public feed with PostCard rendering (handle all 4 variants: normal, page-authored, repost, edited)
5. **Post interactions** — Like, unlike, save, unsave (optimistic)
6. **Comment sheet** — List comments, create comment, comment like (B4)
7. **Create post** — Media upload + post creation (with age gate check)

### Phase 3: Social Features
8. **User profile** — Self + other profiles, follow/unfollow
9. **Notifications** — List, mark read, deep-link navigation
10. **Search** — Users, colleges, pages tabs
11. **Following feed** — Add following tab (mixes user + page posts)

### Phase 4: Pages (B3)
12. **Page list/search** — Browse, category filter, my pages
13. **Page detail** — Profile, posts, follow/unfollow, viewerRole gating
14. **Publish as page** — Create post from page context
15. **Page management** — Members, roles, analytics, archive

### Phase 5: B4 Social
16. **Edit post** — Edit button, inline editing, "(edited)" indicator
17. **Share/repost** — Share button, repost card, duplicate handling

### Phase 6: Rich Content
18. **Stories** — Rail, viewer, create, highlights
19. **Reels** — Feed viewer, interactions, analytics
20. **Edit profile** — Name, bio, avatar upload

### Phase 7: Community Features
21. **Events** — Feed, detail, RSVP
22. **Resources** — Search, detail, vote
23. **Board notices** — College notices, acknowledge
24. **Tribes & contests** — Browse, enter, leaderboard
25. **Block management** — Block/unblock from profile
26. **Governance** — Board, proposals (if needed)

### Phase 8: Polish
27. **Empty states** for all screens
28. **Error handling** — 401 refresh, 429 retry, 404 removal, 410 story expiry
29. **Infinite scroll** — Cursor pagination on all list screens
30. **College/House feeds** — Additional feed tabs

---

## APPENDIX: Auth Header Format
```
Authorization: Bearer {accessToken}
Content-Type: application/json
```
All `/api/*` routes. On 401 → refresh with `POST /api/auth/refresh` body: `{ refreshToken }`. On refresh fail → redirect to login.

## APPENDIX: Error Response Format
```json
{ "error": "Human-readable message", "code": "ERROR_CODE" }
```
Codes: VALIDATION_ERROR (400), AUTH_REQUIRED (401), FORBIDDEN (403), NOT_FOUND (404), DUPLICATE (409), EXPIRED (410), CONTENT_REJECTED (422), RATE_LIMITED (429), INVALID_STATE (400)
