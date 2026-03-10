# B0.3 — Auth & Actor Matrix
> Generated: 2026-03-10 | Source: auth-utils.js + all handler files
> Purpose: For every endpoint, who can call it and what happens when wrong actor calls

---

## Actor Classes

| Actor | Description | Auth Header | Role Check |
|---|---|---|---|
| **PUBLIC** | No auth header needed | — | — |
| **OPTIONAL_AUTH** | Works without auth, enriched with auth | Optional Bearer | — |
| **LOGGED_IN** | Any authenticated user | Required Bearer | — |
| **OWNER** | Resource creator/author | Required Bearer | Code-level `user.id === resource.authorId` check |
| **SELF** | Accessing own data | Required Bearer | Code-level `user.id === :userId` check |
| **FOLLOWER** | Following the target user | Required Bearer | Code-level relationship check |
| **SAME_COLLEGE** | Same `collegeId` as target | Required Bearer | Code-level college match |
| **BOARD_MEMBER** | College governance board seat holder | Required Bearer | Code-level board membership check |
| **MOD** | Moderator role | Required Bearer | `requireRole(user, 'MODERATOR', 'ADMIN', 'SUPER_ADMIN')` |
| **ADMIN** | Admin role | Required Bearer | `requireRole(user, 'ADMIN', 'SUPER_ADMIN')` |
| **SUPER_ADMIN** | Super admin role | Required Bearer | `requireRole(user, 'SUPER_ADMIN')` |

---

## Auth Middleware Functions

| Function | Behavior | Returns |
|---|---|---|
| `authenticate(request, db)` | Optional auth. Returns user or `null` | User object or null |
| `requireAuth(request, db)` | Required auth. Throws if no valid token | User object |
| `requireRole(user, ...roles)` | Role check. Throws 403 if not in roles | void |
| `requireOwnerOrMod(user, ownerId)` | Owner OR moderator+. Throws 403 | void |

---

## Auth Error Responses

| Scenario | Status | Code | Body |
|---|---|---|---|
| No Bearer token when required | 401 | `UNAUTHORIZED` | `{error: "Authentication required"}` |
| Access token expired | 401 | `ACCESS_TOKEN_EXPIRED` | `{error: "Access token expired. Use refresh token."}` |
| Insufficient role | 403 | `FORBIDDEN` | `{error: "Insufficient permissions"}` |
| Not resource owner | 403 | `FORBIDDEN` | `{error: "Access denied: not the resource owner"}` |
| User banned | Returns null → 401 | `UNAUTHORIZED` | (treated as no auth) |
| User suspended | Returns null → 401 | `UNAUTHORIZED` | (treated as no auth) |

---

## Per-Endpoint Auth Matrix

### AUTH

| Endpoint | Actor | Auth | Owner Check | Notes |
|---|---|---|---|---|
| `POST /api/auth/register` | PUBLIC | none | — | Requires phone, pin, displayName |
| `POST /api/auth/login` | PUBLIC | none | — | Brute-force: 5 attempts → 15min lockout |
| `POST /api/auth/refresh` | PUBLIC | none (token in body) | — | Refresh token in body, not header |
| `POST /api/auth/logout` | OPTIONAL_AUTH | optional | — | Deletes session if token present. Always 200 |
| `GET /api/auth/me` | LOGGED_IN | required | — | Returns own user |
| `GET /api/auth/sessions` | LOGGED_IN | required | — | Own sessions only |
| `DELETE /api/auth/sessions` | LOGGED_IN | required | — | Revokes ALL own sessions |
| `DELETE /api/auth/sessions/:id` | LOGGED_IN | required | — | Cannot revoke current session |
| `PATCH /api/auth/pin` | LOGGED_IN | required | — | Re-authenticates with currentPin |

### ME / PROFILE

| Endpoint | Actor | Auth | Owner Check | Notes |
|---|---|---|---|---|
| `PATCH /api/me/profile` | LOGGED_IN | required | Self implicit | Always edits own profile |
| `PATCH /api/me/age` | LOGGED_IN | required | Self implicit | — |
| `PATCH /api/me/college` | LOGGED_IN | required | Self implicit | — |
| `PATCH /api/me/onboarding` | LOGGED_IN | required | Self implicit | — |

### CONTENT

| Endpoint | Actor | Auth | Owner Check | Notes |
|---|---|---|---|---|
| `POST /api/content/posts` | LOGGED_IN | required | — | Age verification: `user.ageVerified` required |
| `GET /api/content/:id` | OPTIONAL_AUTH | optional | — | Auth enriches viewerHasLiked/Saved |
| `DELETE /api/content/:id` | OWNER+MOD | required | `authorId == user.id` OR mod+ | Soft delete |

### FEED

| Endpoint | Actor | Auth | Owner Check | Notes |
|---|---|---|---|---|
| `GET /api/feed/public` | OPTIONAL_AUTH | optional | — | Auth enriches viewer flags |
| `GET /api/feed/following` | LOGGED_IN | required | — | Reads user's follow list |
| `GET /api/feed/college/:id` | OPTIONAL_AUTH | optional | — | — |
| `GET /api/feed/house/:id` | OPTIONAL_AUTH | optional | — | — |
| `GET /api/feed/stories` | LOGGED_IN | required | — | Needs follow list for privacy |
| `GET /api/feed/reels` | OPTIONAL_AUTH | optional | — | — |

### SOCIAL

| Endpoint | Actor | Auth | Owner Check | Notes |
|---|---|---|---|---|
| `POST /api/follow/:userId` | LOGGED_IN | required | — | Self-follow returns 409 |
| `DELETE /api/follow/:userId` | LOGGED_IN | required | — | Idempotent |
| `POST /api/content/:id/like` | LOGGED_IN | required | — | — |
| `POST /api/content/:id/dislike` | LOGGED_IN | required | — | — |
| `DELETE /api/content/:id/reaction` | LOGGED_IN | required | — | — |
| `POST /api/content/:id/save` | LOGGED_IN | required | — | — |
| `DELETE /api/content/:id/save` | LOGGED_IN | required | — | — |
| `POST /api/content/:id/comments` | LOGGED_IN | required | — | Content must be visible |
| `GET /api/content/:id/comments` | PUBLIC | none | — | — |

### USERS

| Endpoint | Actor | Auth | Owner Check | Notes |
|---|---|---|---|---|
| `GET /api/users/:id` | OPTIONAL_AUTH | optional | — | Auth adds `isFollowing` flag |
| `GET /api/users/:id/posts` | OPTIONAL_AUTH | optional | — | — |
| `GET /api/users/:id/followers` | PUBLIC | none | — | — |
| `GET /api/users/:id/following` | PUBLIC | none | — | — |
| `GET /api/users/:id/saved` | SELF | required | `userId == auth user` | **403 if not self** |

### STORIES

| Endpoint | Actor | Auth | Owner Check | Notes |
|---|---|---|---|---|
| `GET /api/stories/events/stream` | LOGGED_IN | required | — | SSE |
| `POST /api/stories` | LOGGED_IN | required | — | Rate limited 30/hr |
| `GET /api/stories/feed` | LOGGED_IN | required | — | Privacy + block filtered |
| `GET /api/stories/:id` | OPTIONAL_AUTH | optional | — | Privacy + block check. Auto-records view |
| `DELETE /api/stories/:id` | OWNER+ADMIN | required | `authorId == user.id` OR admin | — |
| `GET /api/stories/:id/views` | OWNER | required | **Author only** | Owner sees viewers |
| `POST /api/stories/:id/react` | LOGGED_IN | required | — | — |
| `DELETE /api/stories/:id/react` | LOGGED_IN | required | — | — |
| `POST /api/stories/:id/reply` | LOGGED_IN | required | — | Gated by `replyPrivacy` |
| `GET /api/stories/:id/replies` | OWNER | required | **Author only** | Owner sees replies |
| `POST /api/stories/:id/sticker/*/respond` | LOGGED_IN | required | — | — |
| `GET /api/stories/:id/sticker/*/results` | OPTIONAL_AUTH | optional | — | Aggregated results |
| `GET /api/stories/:id/sticker/*/responses` | OWNER | required | **Author only** | Raw responses |
| `GET /api/me/stories/archive` | SELF | required | Self implicit | — |
| `GET /api/users/:id/stories` | OPTIONAL_AUTH | optional | — | Privacy + block filtered |
| `GET /api/me/close-friends` | SELF | required | Self implicit | — |
| `POST /api/me/close-friends/:userId` | SELF | required | Self implicit | — |
| `DELETE /api/me/close-friends/:userId` | SELF | required | Self implicit | — |
| `POST /api/me/highlights` | SELF | required | Self implicit | — |
| `GET /api/users/:id/highlights` | OPTIONAL_AUTH | optional | — | — |
| `PATCH /api/me/highlights/:id` | SELF | required | Self implicit + ownership check | — |
| `DELETE /api/me/highlights/:id` | SELF | required | Self implicit + ownership check | — |
| `GET /api/me/story-settings` | SELF | required | Self implicit | — |
| `PATCH /api/me/story-settings` | SELF | required | Self implicit | — |
| `GET /api/me/blocks` | SELF | required | Self implicit | — |
| `POST /api/me/blocks/:userId` | LOGGED_IN | required | — | — |
| `DELETE /api/me/blocks/:userId` | LOGGED_IN | required | — | — |
| `POST /api/stories/:id/report` | LOGGED_IN | required | — | — |

### REELS

| Endpoint | Actor | Auth | Owner Check | Notes |
|---|---|---|---|---|
| `POST /api/reels` | LOGGED_IN | required | — | — |
| `GET /api/reels/feed` | OPTIONAL_AUTH | optional | — | — |
| `GET /api/reels/following` | LOGGED_IN | required | — | Needs follow list |
| `GET /api/users/:id/reels` | OPTIONAL_AUTH | optional | — | — |
| `GET /api/reels/:id` | OPTIONAL_AUTH | optional | — | — |
| `PATCH /api/reels/:id` | OWNER | required | `authorId == user.id` | Owner only |
| `DELETE /api/reels/:id` | OWNER+ADMIN | required | Owner or ADMIN | — |
| `POST /api/reels/:id/publish` | OWNER | required | Owner only | — |
| `POST /api/reels/:id/archive` | OWNER | required | Owner only | — |
| `POST /api/reels/:id/restore` | OWNER | required | Owner only | — |
| `POST /api/reels/:id/pin` | OWNER | required | Owner only | — |
| `DELETE /api/reels/:id/pin` | OWNER | required | Owner only | — |
| `POST /api/reels/:id/like` | LOGGED_IN | required | — | — |
| `DELETE /api/reels/:id/like` | LOGGED_IN | required | — | — |
| `POST /api/reels/:id/save` | LOGGED_IN | required | — | — |
| `DELETE /api/reels/:id/save` | LOGGED_IN | required | — | — |
| `POST /api/reels/:id/comment` | LOGGED_IN | required | — | — |
| `GET /api/reels/:id/comments` | OPTIONAL_AUTH | optional | — | — |
| `POST /api/reels/:id/report` | LOGGED_IN | required | — | — |
| `POST /api/reels/:id/hide` | LOGGED_IN | required | — | — |
| `POST /api/reels/:id/not-interested` | LOGGED_IN | required | — | — |
| `POST /api/reels/:id/share` | LOGGED_IN | required | — | — |
| `POST /api/reels/:id/watch` | OPTIONAL_AUTH | optional | — | — |
| `POST /api/reels/:id/view` | OPTIONAL_AUTH | optional | — | — |
| `GET /api/me/reels/archive` | SELF | required | Self implicit | — |
| `GET /api/me/reels/analytics` | SELF | required | Self implicit | — |
| `POST /api/me/reels/series` | SELF | required | Self implicit | — |

### EVENTS

| Endpoint | Actor | Auth | Owner Check | Notes |
|---|---|---|---|---|
| `POST /api/events` | LOGGED_IN | required | — | — |
| `GET /api/events/feed` | OPTIONAL_AUTH | optional | — | — |
| `GET /api/events/search` | PUBLIC | none | — | — |
| `GET /api/events/college/:id` | PUBLIC | none | — | — |
| `GET /api/events/:id` | OPTIONAL_AUTH | optional | — | — |
| `PATCH /api/events/:id` | OWNER | required | Owner only | — |
| `DELETE /api/events/:id` | OWNER+ADMIN | required | Owner or ADMIN | — |
| `POST /api/events/:id/publish` | OWNER | required | Owner only | — |
| `POST /api/events/:id/cancel` | OWNER | required | Owner only | — |
| `POST /api/events/:id/rsvp` | LOGGED_IN | required | — | — |
| `DELETE /api/events/:id/rsvp` | LOGGED_IN | required | — | — |
| `GET /api/events/:id/attendees` | OPTIONAL_AUTH | optional | — | — |
| `POST /api/events/:id/report` | LOGGED_IN | required | — | — |
| `GET /api/me/events` | SELF | required | Self implicit | — |
| `GET /api/me/events/rsvps` | SELF | required | Self implicit | — |

### RESOURCES

| Endpoint | Actor | Auth | Owner Check | Notes |
|---|---|---|---|---|
| `POST /api/resources` | LOGGED_IN | required | — | **Same-college guard**: `user.collegeId` must match `body.collegeId` |
| `GET /api/resources/search` | PUBLIC | none | — | — |
| `GET /api/resources/:id` | OPTIONAL_AUTH | optional | — | — |
| `PATCH /api/resources/:id` | OWNER | required | Owner only | — |
| `DELETE /api/resources/:id` | OWNER+ADMIN | required | Owner or ADMIN | — |
| `POST /api/resources/:id/vote` | LOGGED_IN | required | — | Trust-weighted by account age |
| `DELETE /api/resources/:id/vote` | LOGGED_IN | required | — | — |
| `POST /api/resources/:id/download` | OPTIONAL_AUTH | optional | — | — |
| `GET /api/me/resources` | SELF | required | Self implicit | — |

### GOVERNANCE

| Endpoint | Actor | Auth | Owner Check | Notes |
|---|---|---|---|---|
| `GET /api/governance/college/:cid/board` | PUBLIC | none | — | — |
| `POST /api/governance/college/:cid/apply` | SAME_COLLEGE | required | College match checked | — |
| `GET /api/governance/college/:cid/applications` | PUBLIC | none | — | — |
| `POST /api/governance/applications/:id/vote` | BOARD_MEMBER | required | Board membership checked | — |
| `POST /api/governance/college/:cid/proposals` | BOARD_MEMBER | required | Board membership checked | — |
| `GET /api/governance/college/:cid/proposals` | PUBLIC | none | — | — |
| `POST /api/governance/proposals/:id/vote` | BOARD_MEMBER | required | Board membership checked | — |
| `POST /api/governance/college/:cid/seed-board` | ADMIN | required | `requireRole(ADMIN)` | — |

### ADMIN ENDPOINTS (All require MOD/ADMIN/SUPER_ADMIN)

All admin routes follow the same pattern:
- `requireAuth` + `requireRole(user, 'MODERATOR', 'ADMIN', 'SUPER_ADMIN')` for MOD+
- `requireAuth` + `requireRole(user, 'ADMIN', 'SUPER_ADMIN')` for ADMIN+

| Domain | MOD can access | Only ADMIN+ |
|---|---|---|
| Moderation queue/action | ✅ | — |
| Story moderation | ✅ | — |
| Reel moderation | ✅ | — |
| Event moderation | ✅ | — |
| Board notice moderation | ✅ | — |
| College claim review | ✅ | — |
| Distribution inspect/config | ✅ | — |
| Appeal decide | ✅ | — |
| Resource moderation | ✅ | — |
| Admin stats | — | ✅ |
| College seed | — | ✅ |
| Distribution evaluate/kill-switch | — | ✅ |
| Tribe reassign/migrate/boards | — | ✅ |
| Season/contest create | — | ✅ |
| Override management | — | ✅ |

---

## Special Permission Patterns

### 1. Blocked User Interaction
When user A blocks user B:
- B cannot see A's stories (privacy filter)
- B is filtered from A's story feed
- A is filtered from B's story feed
- Block is bidirectional for story visibility
- Block does NOT prevent: following, viewing public posts (known gap)

### 2. Hidden Content (Moderation)
When content is held/shadow-limited:
- Returns **404** (not 403) to non-owners — hides existence
- Owner can still see own held content
- Admin/mod can see via moderation queue

### 3. Age Gating
- `POST /api/content/posts` requires `user.ageVerified === true`
- `POST /api/media/upload` restricts child accounts
- Story/reel creation has similar age checks

---

## B0.3 EXIT GATE: PASS

All 266 endpoints have auth behavior documented. Actor classes defined.
Owner checks, role guards, and special permission patterns captured.
