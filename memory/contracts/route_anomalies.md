# B0.1 — Route Anomalies Report
> Generated: 2026-03-10 | Source: Code-level analysis of route.js + all handler files

---

## ANOMALY 1: Dead Handler File — house-points.js (SEVERITY: LOW)

**Symptom**: `lib/handlers/house-points.js` (237 lines, 5 route handlers) exists but is NEVER imported in route.js.

**Actual truth**: The route.js dispatcher returns a 410 DEPRECATED response inline for ALL `/api/house-points/*` requests before any handler dispatch occurs. The handler file is dead code.

**Dead routes (never callable):**
- `GET /api/house-points/config`
- `GET /api/house-points/ledger`
- `GET /api/house-points/house/:id`
- `POST /api/house-points/award`
- `GET /api/house-points/leaderboard`

**Frontend implication**: Do NOT attempt to call any `/api/house-points/*` endpoint. Use `/api/tribe-contests/*` and `/api/tribes/*/salutes` instead.

**Do not assume**: That house-points.js code paths are tested or maintained.

---

## ANOMALY 2: Dead Code in stages.js (SEVERITY: MEDIUM)

**Symptom**: `lib/handlers/stages.js` lines 2247-2623 (~376 lines) contain duplicate implementations of event, board notice, and authenticity tag handlers.

**Actual truth**: These functions are NEVER exported from stages.js and NEVER imported in route.js. The active handlers for these domains are:
- Events → `handleEvents` from `events.js`
- Board Notices → `handleBoardNotices` from `board-notices.js`
- Authenticity Tags → `handleAuthenticityTags` from `board-notices.js`

**Risk**: If someone modifies the stages.js copies thinking they're active, changes won't take effect. The real handlers are in their dedicated files.

**Frontend implication**: None — the correct routes work. This is an internal code hygiene issue.

---

## ANOMALY 3: Dual-Method Routes (SEVERITY: INFO)

Several routes accept both PATCH and POST (or PUT alias) for the same path:

| Path | Primary | Also Accepts | Handler |
|---|---|---|---|
| `/api/appeals/:id/decide` | PATCH | POST | stages.js |
| `/api/admin/college-claims/:id/decide` | PATCH | POST | stages.js |
| `/api/admin/college-claims/:id/flag-fraud` | PATCH | POST | stages.js |
| `/api/me/profile` | PATCH | PUT | onboarding.js |
| `/api/me/age` | PATCH | PUT | onboarding.js |
| `/api/me/college` | PATCH | PUT | onboarding.js |
| `/api/me/onboarding` | PATCH | PUT | onboarding.js |
| `/api/auth/pin` | PATCH | PUT | auth.js |
| `/api/admin/distribution/evaluate` | POST | GET | stages.js |
| `/api/admin/distribution/evaluate/:contentId` | POST | GET | stages.js |

**Frontend implication**: Use the primary method. PUT/POST aliases exist for backward compat.

---

## ANOMALY 4: Admin Routes Split Across Multiple Handlers (SEVERITY: INFO)

Admin routes (`/api/admin/*`) are NOT all in `admin.js`. They're split across 9 handler files:

| Admin Path Prefix | Actual Handler File |
|---|---|
| `/api/admin/stats`, `/api/admin/colleges/seed` | admin.js |
| `/api/admin/college-claims/*` | stages.js (handleCollegeClaims) |
| `/api/admin/distribution/*` | stages.js (handleDistribution) |
| `/api/admin/resources/*` | stages.js (handleResources) |
| `/api/admin/stories/*` | stories.js |
| `/api/admin/reels/*` | reels.js |
| `/api/admin/events/*` | events.js |
| `/api/admin/board-notices/*` | board-notices.js |
| `/api/admin/authenticity/*` | board-notices.js |
| `/api/admin/tribes/*`, `/api/admin/tribe-seasons/*`, `/api/admin/tribe-awards/*` | tribes.js (handleTribeAdmin) |
| `/api/admin/tribe-contests/*`, `/api/admin/tribe-salutes/*` | tribe-contests.js (handleTribeContestAdmin) |

**Frontend implication**: All admin routes require `MOD/ADMIN/SUPER_ADMIN` role regardless of which handler serves them.

---

## ANOMALY 5: Two Content Storage Models (SEVERITY: HIGH)

**Symptom**: The backend uses two parallel content storage systems:

1. **`content_items` collection**: Used by `content.js`, `feed.js`, `social.js`. Stores posts, reels, and stories (differentiated by `kind` field: POST, REEL, STORY).
2. **`stories` collection**: Used by `stories.js` (Stage 9 stories system). Full Instagram-grade stories with stickers, reactions, privacy settings.
3. **`reels` collection**: Used by `reels.js`. Dedicated reels with audio, series, remixes, watch time tracking.

**Actual truth**:
- `/api/content/posts` creates in `content_items` (kind=POST, REEL, or STORY)
- `/api/stories` creates in `stories` collection (separate system)
- `/api/reels` creates in `reels` collection (separate system)
- `/api/feed/stories` reads from `content_items` (kind=STORY) — NOT from `stories` collection
- `/api/feed/reels` reads from `content_items` (kind=REEL) — NOT from `reels` collection

**Frontend implication**: The "legacy" feed system and the "new" dedicated handlers operate on different collections. Stories created via `/api/stories` won't appear in `/api/feed/stories`. This is a known architectural quirk.

**Do not assume**: That a story created via one API will be visible in the other's feed.

---

## ANOMALY 6: Mixed Pagination Styles (SEVERITY: MEDIUM)

Two pagination styles coexist:

| Style | Used By | Params |
|---|---|---|
| **Cursor-based** | feed, comments, notifications, stories, reels, resources, events, saved posts | `?cursor=<ISO_date>&limit=20` |
| **Offset-based** | followers, following, college members, house members, search, moderation queue | `?offset=0&limit=20` |

**Frontend implication**: Check each endpoint's pagination style. Cannot mix cursor and offset.

---

## ANOMALY 7: Search Does NOT Include Posts (SEVERITY: HIGH)

**Symptom**: `GET /api/search?type=posts` returns nothing. Posts/content are not indexed for search.

**Actual truth**: The search endpoint (discovery.js) only searches:
- `users` (by displayName, username)
- `colleges` (by normalizedName)
- `houses` (by name)

Post/content search is a **known missing feature** (scheduled for Stage B5).

**Frontend implication**: Do not offer post search in the UI until B5 is complete.

---

## ANOMALY 8: Avatar Returns Raw `avatarMediaId`, Not URL (SEVERITY: HIGH)

**Symptom**: User-related API responses include `avatarMediaId` (a raw UUID) or `avatar: null`, never a resolved `avatarUrl`.

**Actual truth**: The `sanitizeUser()` function in `auth-utils.js` strips sensitive fields but does NOT resolve the avatar media ID to a URL. The client must construct the URL as `/api/media/<avatarMediaId>`.

**Frontend implication**: Always construct avatar URL client-side: `${BASE_URL}/api/media/${user.avatarMediaId}`.

**Do not assume**: That any API will return a ready-to-use avatar URL.

---

## ANOMALY 9: Story Visibility Field Not Fully Enforced in Feeds (SEVERITY: MEDIUM)

**Symptom**: Posts have a `visibility` field (PUBLIC, LIMITED, FOLLOWERS, HELD_FOR_REVIEW, SHADOW_LIMITED, REMOVED) but feeds don't consistently filter by all visibility states.

**Actual truth**: 
- `/api/feed/public` filters `visibility: PUBLIC` ✓
- `/api/feed/following` filters `visibility: PUBLIC` ← should include FOLLOWERS content too
- `/api/users/:id/posts` filters `visibility: { $in: ['PUBLIC', 'LIMITED'] }` ← inconsistent

This is a **known gap** scheduled for Stage B2.

---

## ANOMALY 10: Potential Shadow Route — `/api/colleges/:id` vs `/api/colleges/search` (SEVERITY: LOW)

**Symptom**: Both routes match `path[0] === 'colleges' && path.length === 2`.

**Actual truth**: The `handleDiscovery` function explicitly checks `route === 'colleges/search'` BEFORE the generic `colleges/:id` handler, AND the `:id` handler has a guard: `if (collegeId === 'search' || collegeId === 'states' || collegeId === 'types') return null`.

**Risk**: None — properly handled. But the guard shows the developer was aware of the shadow risk.

---

## ANOMALY 11: Tribe Contest Routes Duplicated Across Two Handlers (SEVERITY: LOW)

Routes for creating/resolving tribe contests appear in BOTH `tribes.js` (handleTribeAdmin) and `tribe-contests.js` (handleTribeContestAdmin):
- `POST /api/admin/tribe-contests` — exists in both
- `POST /api/admin/tribe-contests/:id/resolve` — exists in both
- `POST /api/admin/tribe-salutes/adjust` — exists in both

**Actual truth**: The route.js dispatcher sends `/api/admin/tribe-contests/*` to `handleTribeContestAdmin` (tribe-contests.js), and `/api/admin/tribe-seasons/*` + `/api/admin/tribe-awards/*` to `handleTribeAdmin` (tribes.js). But SOME admin/tribe-contest paths also have handlers in tribes.js that are never reached.

**Risk**: Low — the router dispatch is deterministic, but the duplicate code could diverge.
