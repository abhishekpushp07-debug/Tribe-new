# TRIBE — API Reference v1.0
> **Single Source of Truth for Frontend, Mobile, and QA Integration**
> Generated: 2026-03-10 | 266 live routes | 21 domains
> Backend: Next.js API | Auth: Phone+PIN JWT | DB: MongoDB

---

## Table of Contents

1. [Overview](#overview)
2. [Base Conventions](#base-conventions)
3. [Auth Rules](#auth-rules)
4. [Pagination Rules](#pagination-rules)
5. [Canonical Shared Objects](#canonical-shared-objects)
6. [Domain: Auth](#domain-auth)
7. [Domain: Me / Profile](#domain-me--profile)
8. [Domain: Content / Posts](#domain-content--posts)
9. [Domain: Feed](#domain-feed)
10. [Domain: Social (Follow/React/Save/Comment)](#domain-social)
11. [Domain: Users](#domain-users)
12. [Domain: Discovery (Colleges/Houses/Search)](#domain-discovery)
13. [Domain: Media](#domain-media)
14. [Domain: Stories](#domain-stories)
15. [Domain: Reels](#domain-reels)
16. [Domain: Tribes](#domain-tribes)
17. [Domain: Tribe Contests](#domain-tribe-contests)
18. [Domain: Events](#domain-events)
19. [Domain: Board Notices](#domain-board-notices)
20. [Domain: Resources / PYQs](#domain-resources)
21. [Domain: Governance](#domain-governance)
22. [Domain: Reports / Appeals / Notifications / Legal](#domain-reports-appeals-notifications)
23. [Domain: College Claims](#domain-college-claims)
24. [Domain: Admin / Moderation](#domain-admin)
25. [Error Semantics](#error-semantics)
26. [Quirks & Gotchas](#quirks--gotchas)
27. [Integration Notes](#integration-notes)

---

## Overview

Tribe is a campus-community social media platform. This backend serves 266 API endpoints across 21 domains covering:
- Social networking (follow, feed, content, comments, reactions)
- Instagram-grade stories (stickers, privacy, highlights, close friends)
- TikTok-style reels (audio, remix, series, analytics)
- Campus features (colleges, houses, governance, board notices, PYQ resources)
- Tribal competition (tribes, contests, seasons, leaderboards)
- Full moderation pipeline (AI + human, appeals, strikes)

**Architecture**: Monolithic Next.js catch-all route → 16 handler files → MongoDB

---

## Base Conventions

| Convention | Value |
|---|---|
| Base URL | `{REACT_APP_BACKEND_URL}/api/` |
| Content-Type | `application/json` (all endpoints) |
| Auth | `Authorization: Bearer <accessToken>` |
| Max payload | 1MB |
| IDs | UUIDs (v4) |
| Dates | ISO 8601 strings |
| Pagination | Cursor-based (feeds) or Offset-based (lists) |

**Response Envelope (success)**:
```json
{ "data": { ... } }
```

**Response Envelope (error)**:
```json
{ "error": "message", "code": "ERROR_CODE" }
```

---

## Auth Rules

| Actor | When | Header |
|---|---|---|
| PUBLIC | Endpoint needs no auth | — |
| OPTIONAL | Works without auth, enriched with it | Optional `Bearer` |
| REQUIRED | Any logged-in user | Required `Bearer` |
| SELF | Must be the resource owner | Required `Bearer` + code-level ID match |
| OWNER | Must be content author | Required `Bearer` + code-level author check |
| MOD+ | Moderator, Admin, or Super Admin | Required `Bearer` + role check |
| ADMIN+ | Admin or Super Admin only | Required `Bearer` + role check |

Roles: `USER < MODERATOR < ADMIN < SUPER_ADMIN`

---

## Pagination Rules

**Cursor-based** (for feeds/streams):
```
GET /api/feed/public?cursor=2026-03-10T12:00:00.000Z&limit=20
→ { data: { items: [...], nextCursor: "...", hasMore: true } }
```

**Offset-based** (for countable lists):
```
GET /api/users/:id/followers?offset=0&limit=20
→ { data: { users: [...], total: 150, offset: 0, limit: 20 } }
```

Default limit: 20. Max limit: 50.

---

## Canonical Shared Objects

### UserSnippet
```json
{
  "id": "UUID", "displayName": "string|null", "username": "string|null",
  "avatar": "string|null ⚠️ RAW MEDIA ID — construct URL: /api/media/<avatar>",
  "role": "USER|MODERATOR|ADMIN|SUPER_ADMIN",
  "collegeId": "string|null", "collegeName": "string|null",
  "houseId": "string|null", "houseName": "string|null",
  "tribeId": "string|null", "tribeCode": "string|null"
}
```

### MediaObject
```json
{
  "id": "UUID", "url": "string|null ⚠️ may be null — use /api/media/<id>",
  "type": "IMAGE|VIDEO|AUDIO", "thumbnailUrl": "string|null",
  "width": "number|null", "height": "number|null",
  "duration": "number|null", "mimeType": "string|null", "size": "number|null"
}
```

---

## Domain: Auth

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/register` | none | Signup. Body: `{phone, pin, displayName}` → `{accessToken, refreshToken, user}` |
| POST | `/api/auth/login` | none | Login. Body: `{phone, pin}` → tokens + user. Brute-force: 5 attempts → 15min lock |
| POST | `/api/auth/refresh` | none | Rotate token. Body: `{refreshToken}`. Reuse detection! |
| POST | `/api/auth/logout` | optional | Delete session. Always 200 |
| GET | `/api/auth/me` | required | Current user profile |
| GET | `/api/auth/sessions` | required | Active sessions list |
| DELETE | `/api/auth/sessions` | required | Revoke ALL sessions |
| DELETE | `/api/auth/sessions/:id` | required | Revoke one session |
| PATCH | `/api/auth/pin` | required | Change PIN. Body: `{currentPin, newPin}` |

---

## Domain: Me / Profile

| Method | Path | Auth | Purpose |
|---|---|---|---|
| PATCH | `/api/me/profile` | required | Update: `{displayName, username, bio, avatarMediaId}` |
| PATCH | `/api/me/age` | required | Set age: `{birthYear}` |
| PATCH | `/api/me/college` | required | Link college: `{collegeId}` |
| PATCH | `/api/me/onboarding` | required | Mark onboarding done |

---

## Domain: Content / Posts

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/content/posts` | required | Create. Body: `{caption, mediaIds[], kind, syntheticDeclaration}`. AI moderated |
| GET | `/api/content/:id` | optional | Get single item. View tracked. Auth enriches viewer flags |
| DELETE | `/api/content/:id` | owner/mod | Soft-delete (visibility=REMOVED) |

---

## Domain: Feed

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/feed/public` | optional | Public feed. Stage 2 only. Cursor |
| GET | `/api/feed/following` | required | Following feed. Cursor |
| GET | `/api/feed/college/:collegeId` | optional | College feed. Cached |
| GET | `/api/feed/house/:houseId` | optional | House feed. Cached |
| GET | `/api/feed/stories` | required | Story rail (from content_items) |
| GET | `/api/feed/reels` | optional | Reels feed (from content_items) |

---

## Domain: Social

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/follow/:userId` | required | Follow. Idempotent. Self-follow=409 |
| DELETE | `/api/follow/:userId` | required | Unfollow. Idempotent |
| POST | `/api/content/:id/like` | required | Like. Switches from dislike |
| POST | `/api/content/:id/dislike` | required | Dislike. Internal signal |
| DELETE | `/api/content/:id/reaction` | required | Remove reaction |
| POST | `/api/content/:id/save` | required | Bookmark. Idempotent |
| DELETE | `/api/content/:id/save` | required | Unbookmark |
| POST | `/api/content/:id/comments` | required | Comment. Body: `{body, parentId}`. AI moderated |
| GET | `/api/content/:id/comments` | none | List comments. Cursor pagination |

---

## Domain: Users

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/users/:id` | optional | Profile. Auth adds isFollowing |
| GET | `/api/users/:id/posts` | optional | User posts. `?kind=POST\|REEL\|STORY`. Cursor |
| GET | `/api/users/:id/followers` | none | Followers. **Offset** pagination |
| GET | `/api/users/:id/following` | none | Following. **Offset** pagination |
| GET | `/api/users/:id/saved` | self-only | **403 if not self**. Cursor |

---

## Domain: Discovery

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/colleges/search` | none | `?q, ?state, ?type`. Offset |
| GET | `/api/colleges/states` | none | Distinct states |
| GET | `/api/colleges/types` | none | Distinct types |
| GET | `/api/colleges/:id` | none | College detail |
| GET | `/api/colleges/:id/members` | none | Members. Offset |
| GET | `/api/houses` | none | All houses. Cached |
| GET | `/api/houses/leaderboard` | none | Leaderboard. Cached |
| GET | `/api/houses/:idOrSlug` | none | House detail |
| GET | `/api/houses/:idOrSlug/members` | none | Members. Offset |
| GET | `/api/search` | none | `?q, ?type=all\|users\|colleges\|houses`. ⚠️ Posts NOT searchable |
| GET | `/api/suggestions/users` | required | Follow suggestions. Max 15 |

---

## Domain: Media

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/media/upload` | required | Upload base64. Body: `{data, mimeType}`. Max 5MB img, 30MB vid |
| GET | `/api/media/:id` | none | Serve binary. Cache-Control immutable |

---

## Domain: Stories (33 routes)

**Core**: POST create, GET feed/detail, DELETE, reactions, replies, sticker interactions
**Close Friends**: GET/POST/DELETE `/api/me/close-friends`
**Highlights**: CRUD `/api/me/highlights`
**Settings**: GET/PATCH `/api/me/story-settings`
**Blocks**: GET/POST/DELETE `/api/me/blocks` (⚠️ in stories handler)
**Admin**: moderate, cleanup, analytics, recompute
**SSE**: `GET /api/stories/events/stream` (real-time story events)

Full detail: See `request_contracts.md` and `response_contracts.md`

---

## Domain: Reels (36 routes)

**Core**: POST create, GET feed/detail, PATCH edit, DELETE
**Lifecycle**: publish, archive, restore, pin/unpin
**Interactions**: like/unlike, save/unsave, comment, report, share, watch, view
**Discovery**: audio reels, remix chain
**Creator**: series, archive, analytics, processing status
**Admin**: moderate, analytics, recompute

Full detail: See `request_contracts.md` and `response_contracts.md`

---

## Domain: Tribes (19 routes)

**Public**: list, standings, detail, members, board, fund, salutes
**User**: my tribe, user's tribe
**Admin**: distribution, reassign, seasons, contests, salutes, awards, migrate, boards

---

## Domain: Tribe Contests (28 routes)

**Public**: list, live-feed, detail, entries, leaderboard, results, seasons, standings
**User**: enter, vote, withdraw
**Admin**: full lifecycle (create→publish→open→close→lock→resolve→cancel), scoring, rules, dashboard

Contest states: `DRAFT → PUBLISHED → ENTRIES_OPEN → ENTRIES_CLOSED → JUDGING → RESOLVED`

---

## Domain: Events (22 routes)

**Public**: feed, search, detail, college events, attendees
**User**: create, edit, publish, cancel, archive, RSVP, report, remind
**Admin**: moderate, analytics, recompute

---

## Domain: Board Notices (17 routes)

**Core**: CRUD for notices (board members), pin/unpin, acknowledge
**Read**: college notices, own notices
**Moderation**: mod queue, decide
**Authenticity**: tag/untag synthetic content, stats

---

## Domain: Resources (14 routes)

**Core**: create (same-college guard), search (faceted), detail, edit, delete
**Interactions**: vote (UP/DOWN, trust-weighted), report, download
**Admin**: queue, moderate, recompute, reconcile

---

## Domain: Governance (8 routes)

**Board**: view board, apply, view applications, vote on applications
**Proposals**: create, list, vote
**Admin**: seed board

---

## Domain: Reports/Appeals/Notifications/Legal

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/reports` | required | Report content/user. Auto-hold at 3+ |
| POST | `/api/appeals` | required | Appeal moderation decision |
| GET | `/api/appeals` | required | Own appeals |
| PATCH | `/api/appeals/:id/decide` | mod+ | Decide appeal |
| GET | `/api/notifications` | required | User notifications. Cursor. Enriched |
| PATCH | `/api/notifications/read` | required | Mark read. `{ids:[]}` or all |
| GET | `/api/legal/consent` | none | Active consent notice |
| POST | `/api/legal/accept` | required | Accept consent |
| POST | `/api/grievances` | required | Create grievance ticket |
| GET | `/api/grievances` | required | Own grievances |

---

## Domain: College Claims

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/colleges/:cid/claim` | required | Submit claim. 1 active. 7-day cooldown. Auto-fraud at 3+ rejects |
| GET | `/api/me/college-claims` | required | Own claims |
| DELETE | `/api/me/college-claims/:id` | required | Withdraw pending |
| GET | `/api/admin/college-claims` | mod+ | Admin queue |
| GET | `/api/admin/college-claims/:id` | mod+ | Claim detail |
| PATCH | `/api/admin/college-claims/:id/flag-fraud` | mod+ | Escalate to fraud review |
| PATCH | `/api/admin/college-claims/:id/decide` | mod+ | Approve/reject |

---

## Domain: Admin

**Distribution Ladder** (7 routes): evaluate, config, kill-switch, inspect, override, remove-override
**Platform**: stats, seed colleges
**All admin routes**: Require MOD/ADMIN/SUPER_ADMIN role

---

## Error Semantics

| Status | Meaning | Retry? |
|---|---|---|
| 200 | Success | — |
| 201 | Created | — |
| 204 | No Content (some deletes) | — |
| 400 | Validation error | Fix request |
| 401 | No/invalid auth | Re-auth |
| 403 | Forbidden (wrong role/not owner) | Don't retry |
| 404 | Not found OR hidden content | — |
| 409 | Conflict (duplicate action) | Don't retry |
| 429 | Rate limited | Retry after `retryAfterSec` |
| 500 | Server error | Retry with backoff |

**Critical**: 404 is used for hidden content (held, shadow-limited, blocked) to avoid information leakage.

---

## Quirks & Gotchas

1. **Avatar = raw media ID** — construct URL: `/api/media/<avatar>`
2. **Two content systems** — `content_items` (legacy) vs `stories`/`reels` (dedicated)
3. **Phone+PIN auth** — not email+password
4. **Blocks in stories handler** — `/api/me/blocks/*` handled by stories.js
5. **Comment body field** — accepts both `body` and `text`
6. **Base64 media upload** — not multipart/form-data
7. **AI moderation is silent** — content created with `visibility: "HELD"`, not rejected
8. **Reel comment/report bugs** — currently return 400 (fix in B6)
9. **Search has no posts** — only users/colleges/houses (fix in B5)
10. **Visibility not fully enforced** — FOLLOWERS posts missing from following feed (fix in B2)

---

## Integration Notes

### Quick Start (4 calls to get running)
1. `POST /api/auth/register` → get tokens
2. `POST /api/legal/accept` → accept consent
3. `PATCH /api/me/profile` → set profile
4. `GET /api/feed/public` → see content

### Token Refresh Flow
1. Access token expires → 401 with `code: "ACCESS_TOKEN_EXPIRED"`
2. Call `POST /api/auth/refresh` with `{refreshToken}`
3. Get new access + refresh tokens
4. ⚠️ Old refresh token is immediately invalid (rotation)
5. ⚠️ If reused → entire token family revoked (security)

### Avatar Display
```
const avatarUrl = user.avatar
  ? `${API_BASE}/api/media/${user.avatar}`
  : '/default-avatar.png'
```

### Supporting Contract Documents
- `route_inventory_human.md` — full 266-route census
- `domain_map.md` — domain classification + screen mapping
- `auth_actor_matrix.md` — per-endpoint auth details
- `request_contracts.md` — exact request body specs
- `response_contracts.md` — exact response shapes
- `error_contracts.md` — error codes + edge cases
- `pagination_and_streams.md` — cursor/offset/SSE details
- `quirk_ledger.md` — 17 frontend gotchas

---

## B0.9 EXIT GATE: PASS

Complete API reference with all 266 endpoints, organized by domain.
Request/response contracts, auth rules, error semantics, and quirks documented.
Frontend agent can integrate without reading backend code.
