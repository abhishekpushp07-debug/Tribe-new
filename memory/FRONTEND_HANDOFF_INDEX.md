# TRIBE — Frontend Handoff Master Index
**Last Updated**: 2026-03-11 | **Backend Status**: LIVE ✅

---

## 🔗 Backend URL (Production)
```
https://tribe-feed-engine-1.preview.emergentagent.com
```
All API calls: `https://tribe-feed-engine-1.preview.emergentagent.com/api/*`

### Quick Health Check
```
GET /api/healthz → {"status":"ok"}
GET /api/readyz  → {"status":"ready"}
```

---

## 🔑 Test Credentials (Verified Working)
| Phone | PIN | Name | Notes |
|-------|-----|------|-------|
| `7777099001` | `1234` | FE Test User | Fresh user, ageStatus=UNKNOWN |
| `7777099002` | `1234` | FE Test User 2 | Fresh user, ageStatus=UNKNOWN |

### How to Register New Test Users
```
POST /api/auth/register
{ "phone": "77770XXXXX", "pin": "1234", "displayName": "Test User" }
```
Phone must be exactly 10 digits. Returns `accessToken` + `refreshToken` + `user`.

### Login
```
POST /api/auth/login
{ "phone": "7777099001", "pin": "1234" }
```

### Auth Header for All Protected Endpoints
```
Authorization: Bearer {accessToken}
Content-Type: application/json
```

---

## 📚 Document Index (For Frontend Team)

### MUST-READ (Start Here)
| # | Document | Lines | What It Covers |
|---|----------|-------|----------------|
| 1 | **[API_REFERENCE_COMPLETE.md](./API_REFERENCE_COMPLETE.md)** | 800+ | **THE DEFINITIVE API REFERENCE** — All 309 endpoints, every method, path, auth requirement, request/response examples. 100% coverage. |
| 2 | **[COMPLETE_FRONTEND_HANDOFF.md](./COMPLETE_FRONTEND_HANDOFF.md)** | 840 | Integration guide with screen maps, gotchas, media contract, reel contract |

### Detailed References
| # | Document | Lines | What It Covers |
|---|----------|-------|----------------|
| 2 | [API_REFERENCE.md](./API_REFERENCE.md) | 375 | Complete route table — every endpoint, method, auth requirement |
| 3 | [SERIALIZER_CONTRACTS.md](./SERIALIZER_CONTRACTS.md) | 497 | **Frozen** data shapes — UserSnippet, PageSnippet, PostObject, RepostObject, CommentObject, MediaObject, ReelObject, StoryObject, NotificationObject |
| 4 | [SCREEN_TO_ENDPOINT_MAP.md](./SCREEN_TO_ENDPOINT_MAP.md) | 264 | 28 screens mapped to exact API endpoints + optimistic UI safety |
| 5 | [FRONTEND_INTEGRATION_GUIDE.md](./FRONTEND_INTEGRATION_GUIDE.md) | 1069 | Deep integration guide by domain — auth, posts, comments, feeds, pages, stories, reels, notifications, search, media upload |
| 6 | [FE_KNOWN_GOTCHAS.md](./FE_KNOWN_GOTCHAS.md) | 260 | 24 edge cases and gotchas every frontend dev must know |
| 7 | [STATE_AND_PERMISSIONS.md](./STATE_AND_PERMISSIONS.md) | 93 | User states, content visibility, page roles, optimistic UI safety matrix |
| 8 | [NOTIFICATION_EVENT_GUIDE.md](./NOTIFICATION_EVENT_GUIDE.md) | 120 | All 12+ notification types with triggers, recipients, deep-link targets |

### Frozen Contracts (Do Not Deviate)
| # | Document | What It Freezes |
|---|----------|----------------|
| 9 | [MEDIA_CONTRACT_FREEZE.md](./MEDIA_CONTRACT_FREEZE.md) | Supabase upload init → upload → complete → serve → delete lifecycle |
| 10 | [REELS_CONTRACT_FREEZE.md](./REELS_CONTRACT_FREEZE.md) | 24 reel endpoints, object shapes, pagination, action semantics |
| 11 | [SEARCH_CONTRACT_FREEZE.md](./SEARCH_CONTRACT_FREEZE.md) | Search types (all/users/pages/posts/hashtags/colleges/houses), ranking |
| 12 | [NOTIFICATIONS_CONTRACT_FREEZE.md](./NOTIFICATIONS_CONTRACT_FREEZE.md) | Notification types, preferences, grouped view, device registration |

---

## ⚡ Quick Start (5-Minute Setup)

### 1. Set Base URL
```javascript
const API_BASE = 'https://tribe-feed-engine-1.preview.emergentagent.com/api';
```

### 2. Register & Login
```javascript
// Register
const res = await fetch(`${API_BASE}/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone: '7777000XXX', pin: '1234', displayName: 'My Name' })
});
const { accessToken, refreshToken, user } = await res.json();

// Login
const loginRes = await fetch(`${API_BASE}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone: '7777099001', pin: '1234' })
});
const { accessToken } = await loginRes.json();
```

### 3. Make Authenticated Calls
```javascript
const headers = {
  'Authorization': `Bearer ${accessToken}`,
  'Content-Type': 'application/json'
};

// Get feed
const feed = await fetch(`${API_BASE}/feed/public?limit=20`, { headers });
const { items, pagination } = await feed.json();

// Like a post
await fetch(`${API_BASE}/content/${postId}/like`, { method: 'POST', headers });

// Create a post (requires ageStatus=ADULT)
await fetch(`${API_BASE}/content/posts`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ caption: 'Hello world!', kind: 'POST', visibility: 'PUBLIC' })
});
```

### 4. Handle Token Refresh
```javascript
// On 401 response:
const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ refreshToken })
});
const { accessToken: newToken } = await refreshRes.json();
// Retry failed request with newToken
```

---

## 🏗️ Architecture Overview

### Domain Count: 16 handler files, 150+ routes
| Domain | Key Endpoints | Notes |
|--------|--------------|-------|
| Auth | register, login, refresh, me, sessions | Phone/PIN auth |
| Profile | me/profile, me/age, me/college | Onboarding flow |
| Content | posts CRUD, edit (B4) | Caption-only edit |
| Social | like, dislike, save, comment, share (B4) | Comment like (B4) |
| Feed | public, following, college, house, stories, reels | Algorithmic ranking |
| Pages (B3) | CRUD, follow, members, publish-as-page, analytics | Dual author system |
| Stories | create, feed, react, reply, highlights, settings | 24h expiry |
| Reels | create, feed, like, comment, save, share, watch | Different object shape! |
| Notifications | list, mark-read, unread-count, preferences, push | 12+ event types |
| Search | unified search, hashtags, trending | type=all/users/pages/posts/hashtags |
| Tribes | list, detail, standings, members | 21 tribes |
| Contests | list, enter, vote, leaderboard, seasons | Tribe competitions |
| Events | create, feed, RSVP, attendees | With categories |
| Resources | create, search, vote, download | College resources |
| Notices | create, acknowledge, college listing | Board notices |
| Governance | board, applications, proposals, voting | College governance |
| Media | upload-init, upload-complete, serve, delete | Supabase direct upload |
| Blocks | block, unblock, list | Bidirectional visibility |

### Key Architectural Facts
- **Cursor-based pagination** everywhere (never offset-based)
- **Dual author system** (USER vs PAGE) — every PostCard must branch
- **Supabase direct upload** — client uploads binary directly to Supabase CDN
- **Phone/PIN auth** with Bearer token (15-min access, refreshable)
- **Rate limiting** — AUTH: 10/min, READ: 120/min, WRITE: 30/min
- **Soft deletes** — DELETE sets visibility=REMOVED, GET returns 404

---

## ⚠️ Top 5 Gotchas (Read Before Coding)

1. **Dual Author**: `authorType=USER` → `author.displayName`. `authorType=PAGE` → `author.name`. They have DIFFERENT fields. Always branch.

2. **Repost Rendering**: `isRepost=true` → show reposter + embedded `originalContent`. `originalContent` can be `null` if deleted.

3. **Reel ≠ Post**: Reels use `playbackUrl`/`thumbnailUrl` directly, NOT MediaObject. Use `creatorId` not `authorId`.

4. **Age Gate**: `ageStatus !== "ADULT"` → cannot create content. Check before showing create buttons.

5. **Pagination Keys Vary**: Some use `items`, some `posts`, some `comments`. Always: `data.items || data.posts || data.comments || []`

---

## 📱 Screens to Build (Priority Order)
1. Login/Register
2. Onboarding (Age → College → Complete)
3. Home Feed (Public + Following tabs)
4. Post Detail + Comment Sheet
5. Create Post
6. Profile (Self + Other)
7. Stories Rail + Viewer
8. Reels Feed + Player
9. Notifications
10. Search
11. Pages (Browse, Detail, Create, Members)
12. Tribes + Contests
13. Events
14. Settings

---

*For any questions about specific endpoints, see the detailed docs linked above. All endpoints have been verified live.*
