# B0.1 — Route Census: Human-Readable Inventory
> Generated: 2026-03-10 | Source: Programmatic code scan of all 18 handler files + route.js dispatcher
> Mantra: **Observe truth first. Change later.**

---

## Architecture Overview

- **Framework**: Next.js App Router — single catch-all `[[...path]]/route.js` (632 lines)
- **Dispatch**: Path-prefix matching to 24 handler functions across 16 active handler files
- **Base prefix**: All routes live under `/api/`
- **Auth**: JWT Bearer token via `requireAuth()` / `authenticate()` middleware
- **Not imported / Dead**: `house-points.js` (5 routes, 237 lines) — never imported, 410 returned inline
- **Dead code in stages.js**: Lines 2247-2623 contain duplicate event/board/authenticity handlers that shadow active handlers in `events.js` and `board-notices.js`. These are **never exported or called**.

---

## Summary Counts

| Metric | Count |
|---|---|
| **Total callable routes** | **271** |
| Handler files scanned | 18 |
| Active handler files | 16 |
| Dead handler files | 1 (house-points.js) |
| Inline routes (route.js) | 11 |

### By Method

| Method | Count |
|---|---|
| GET | 121 |
| POST | 107 |
| DELETE | 23 |
| PATCH | 17 |
| PUT | 0 (PATCH handlers accept PUT as alias) |

### By Auth Level

| Level | Count |
|---|---|
| Public (no auth) | 38 |
| Authenticated (logged-in user) | 160 |
| Admin/Mod only | 73 |

### By Route Type

| Type | Count |
|---|---|
| JSON_READ | 105 |
| JSON_WRITE | 115 |
| ADMIN_ACTION | 45 |
| STREAM_SSE | 1 |
| MEDIA_UPLOAD | 1 |
| MEDIA_BINARY | 1 |
| HEALTHCHECK | 2 |
| DEPRECATED | 1 |

---

# Domain 1: SYSTEM / OPS / HEALTH (11 routes)

| # | Method | Path | Auth | Handler | Type | P | Notes |
|---|---|---|---|---|---|---|---|
| 1 | GET | `/api/healthz` | none | route.js:inline | HEALTHCHECK | P0 | Liveness probe. `{status, uptime, timestamp}` |
| 2 | GET | `/api/readyz` | none | route.js:inline | HEALTHCHECK | P1 | Readiness probe. Checks DB connection. |
| 3 | GET | `/api/` | none | route.js:inline | JSON_READ | P2 | API root info. Lists endpoint groups. |
| 4 | GET | `/api/cache/stats` | ADMIN | route.js:inline | ADMIN | P2 | Cache statistics. ADMIN/SUPER_ADMIN. |
| 5 | GET | `/api/ops/health` | ADMIN | route.js:checkDeepHealth | ADMIN | P1 | Deep health. DB + Redis + storage check. |
| 6 | GET | `/api/ops/metrics` | ADMIN | route.js:inline | ADMIN | P1 | Observability metrics. |
| 7 | GET | `/api/ops/slis` | ADMIN | route.js:metrics.getSLIs | ADMIN | P2 | SLI data. |
| 8 | GET | `/api/ops/backup-check` | ADMIN | route.js:inline | ADMIN | P2 | Backup readiness check. |
| 9 | GET | `/api/moderation/config` | MOD+ | moderation.routes.js | ADMIN | P2 | AI moderation provider config. |
| 10 | POST | `/api/moderation/check` | MOD+ | moderation.routes.js | ADMIN | P2 | Manual content moderation check. |
| 11 | * | `/api/house-points/*` | — | route.js:inline | DEPRECATED | P2 | Returns 410. "Use /tribe-contests". |

---

# Domain 2: AUTH (9 routes)

| # | Method | Path | Auth | Handler | Type | P | Notes |
|---|---|---|---|---|---|---|---|
| 12 | POST | `/api/auth/register` | none | auth.js | JSON_WRITE | P0 | Signup. Requires `phone`(10-digit), `pin`(4-digit), `displayName`. Returns `{accessToken, refreshToken, user}`. Auto-assigns house. |
| 13 | POST | `/api/auth/login` | none | auth.js | JSON_WRITE | P0 | Login. `{phone, pin}`. Brute-force protected (5 attempts → 15min lockout). Returns tokens + user. |
| 14 | POST | `/api/auth/refresh` | none | auth.js | JSON_WRITE | P0 | Rotate refresh token. Token-reuse detection → revokes entire family. |
| 15 | POST | `/api/auth/logout` | optional | auth.js | JSON_WRITE | P0 | Logout. Deletes session if Bearer present. Always 200. |
| 16 | GET | `/api/auth/me` | required | auth.js | JSON_READ | P0 | Current user profile. `requireAuth`. |
| 17 | GET | `/api/auth/sessions` | required | auth.js | JSON_READ | P1 | List active sessions. `isCurrent` flag. |
| 18 | DELETE | `/api/auth/sessions` | required | auth.js | JSON_WRITE | P1 | Revoke ALL sessions (force logout everywhere). |
| 19 | DELETE | `/api/auth/sessions/:sessionId` | required | auth.js | JSON_WRITE | P1 | Revoke one session. Cannot revoke current (use logout). |
| 20 | PATCH | `/api/auth/pin` | required | auth.js | JSON_WRITE | P1 | Change PIN. Re-auths with `currentPin`. Revokes other sessions. Also accepts PUT. |

---

# Domain 3: ME / PROFILE / ONBOARDING (4 routes)

| # | Method | Path | Auth | Handler | Type | P | Notes |
|---|---|---|---|---|---|---|---|
| 21 | PATCH | `/api/me/profile` | required | onboarding.js | JSON_WRITE | P0 | Update profile: `displayName, username, bio, avatarMediaId`. Also PUT. |
| 22 | PATCH | `/api/me/age` | required | onboarding.js | JSON_WRITE | P0 | Set age via `birthYear`. Child→Adult upgrade blocked. Also PUT. |
| 23 | PATCH | `/api/me/college` | required | onboarding.js | JSON_WRITE | P0 | Link/unlink college via `collegeId`. Also PUT. |
| 24 | PATCH | `/api/me/onboarding` | required | onboarding.js | JSON_WRITE | P0 | Mark onboarding complete. Also PUT. |

---

# Domain 4: CONTENT / POSTS (3 routes)

| # | Method | Path | Auth | Handler | Type | P | Notes |
|---|---|---|---|---|---|---|---|
| 25 | POST | `/api/content/posts` | required | content.js | JSON_WRITE | P0 | Create POST/REEL/STORY in `content_items`. AI moderated. Age-gated. `{caption, kind, visibility, mediaIds, collegeId, houseId, syntheticDeclaration}`. |
| 26 | GET | `/api/content/:id` | optional | content.js | JSON_READ | P0 | Get single content item. Increments `viewCount`. Optional auth enriches viewer flags. |
| 27 | DELETE | `/api/content/:id` | required | content.js | JSON_WRITE | P0 | Soft-delete (visibility=REMOVED). Author OR MOD/ADMIN. |

---

# Domain 5: FEED (6 routes)

| # | Method | Path | Auth | Handler | Type | P | Notes |
|---|---|---|---|---|---|---|---|
| 28 | GET | `/api/feed/public` | optional | feed.js | JSON_READ | P0 | Public feed. `distributionStage==2` only. Cursor pagination. First page cached. |
| 29 | GET | `/api/feed/following` | required | feed.js | JSON_READ | P0 | Following feed. All stages from followed users + self. Cursor. |
| 30 | GET | `/api/feed/college/:collegeId` | optional | feed.js | JSON_READ | P0 | College feed. Stage 1+ posts. First page cached. |
| 31 | GET | `/api/feed/house/:houseId` | optional | feed.js | JSON_READ | P1 | House feed. Stage 1+ posts. First page cached. |
| 32 | GET | `/api/feed/stories` | required | feed.js | JSON_READ | P0 | Story rail grouped by author. From `content_items(kind=STORY)`. Own first. |
| 33 | GET | `/api/feed/reels` | optional | feed.js | JSON_READ | P0 | Reels feed. From `content_items(kind=REEL)`. Cursor. Cached. |

---

# Domain 6: SOCIAL INTERACTIONS (10 routes)

| # | Method | Path | Auth | Handler | Type | P | Notes |
|---|---|---|---|---|---|---|---|
| 34 | POST | `/api/follow/:userId` | required | social.js | JSON_WRITE | P0 | Follow user. Notification sent. Idempotent (re-follow = success). Self-follow = 409. |
| 35 | DELETE | `/api/follow/:userId` | required | social.js | JSON_WRITE | P0 | Unfollow. Idempotent. |
| 36 | POST | `/api/content/:id/like` | required | social.js | JSON_WRITE | P0 | Like. Switches from dislike if exists. Triggers distribution auto-eval. |
| 37 | POST | `/api/content/:id/dislike` | required | social.js | JSON_WRITE | P1 | Dislike. Internal signal only — not visible to author. |
| 38 | DELETE | `/api/content/:id/reaction` | required | social.js | JSON_WRITE | P1 | Remove like/dislike. |
| 39 | POST | `/api/content/:id/save` | required | social.js | JSON_WRITE | P0 | Bookmark content. Idempotent. |
| 40 | DELETE | `/api/content/:id/save` | required | social.js | JSON_WRITE | P0 | Unbookmark. |
| 41 | POST | `/api/content/:id/comments` | required | social.js | JSON_WRITE | P0 | Comment. AI moderated. `{body/text, parentId}`. Max 500 chars. |
| 42 | GET | `/api/content/:id/comments` | none | social.js | JSON_READ | P0 | List comments. `?parentId` for replies. Cursor pagination. Author-enriched. |

---

# Domain 7: USERS (5 routes)

| # | Method | Path | Auth | Handler | Type | P | Notes |
|---|---|---|---|---|---|---|---|
| 43 | GET | `/api/users/:id` | optional | users.js | JSON_READ | P0 | User profile. Optional auth for `isFollowing` flag. |
| 44 | GET | `/api/users/:id/posts` | optional | users.js | JSON_READ | P0 | User posts. `?kind=POST\|REEL\|STORY`. Cursor. Expired stories excluded. |
| 45 | GET | `/api/users/:id/followers` | none | users.js | JSON_READ | P0 | Followers list. **Offset** pagination. Returns `total`. |
| 46 | GET | `/api/users/:id/following` | none | users.js | JSON_READ | P0 | Following list. **Offset** pagination. Returns `total`. |
| 47 | GET | `/api/users/:id/saved` | required | users.js | JSON_READ | P1 | Saved posts. **SELF-ONLY**: 403 if `userId != auth user`. Cursor. |

---

# Domain 8: DISCOVERY / COLLEGES / HOUSES / SEARCH (11 routes)

| # | Method | Path | Auth | Handler | Type | P | Notes |
|---|---|---|---|---|---|---|---|
| 48 | GET | `/api/colleges/search` | none | discovery.js | JSON_READ | P0 | Search colleges. `?q, ?state, ?type`. Multi-word AND matching. Offset pagination. |
| 49 | GET | `/api/colleges/states` | none | discovery.js | JSON_READ | P1 | Distinct states from colleges. |
| 50 | GET | `/api/colleges/types` | none | discovery.js | JSON_READ | P1 | Distinct college types. |
| 51 | GET | `/api/colleges/:id` | none | discovery.js | JSON_READ | P0 | College detail. |
| 52 | GET | `/api/colleges/:id/members` | none | discovery.js | JSON_READ | P1 | College members. Offset pagination. Sorted by followersCount. |
| 53 | GET | `/api/houses` | none | discovery.js | JSON_READ | P1 | All houses. Cached. Sorted by totalPoints. |
| 54 | GET | `/api/houses/leaderboard` | none | discovery.js | JSON_READ | P1 | House leaderboard with rank. Cached. |
| 55 | GET | `/api/houses/:idOrSlug` | none | discovery.js | JSON_READ | P1 | House by id or slug. Top 10 members. |
| 56 | GET | `/api/houses/:idOrSlug/members` | none | discovery.js | JSON_READ | P1 | House members. Offset pagination. |
| 57 | GET | `/api/search` | none | discovery.js | JSON_READ | P0 | Universal search. `?q, ?type=all\|users\|colleges\|houses`. **Posts NOT indexed (known gap)**. |
| 58 | GET | `/api/suggestions/users` | required | discovery.js | JSON_READ | P1 | Follow suggestions. Priority: same college > house > popular. Max 15. |

---

# Domain 9: MEDIA (2 routes)

| # | Method | Path | Auth | Handler | Type | P | Notes |
|---|---|---|---|---|---|---|---|
| 59 | POST | `/api/media/upload` | required | media.js | MEDIA_UPLOAD | P0 | Upload media via base64. `{data, mimeType, type, width, height, duration}`. Tries object storage → falls back to DB. Child-restricted. |
| 60 | GET | `/api/media/:id` | none | media.js | MEDIA_BINARY | P0 | Serve media binary. Raw buffer + Content-Type. `Cache-Control: immutable`. |

---

# Domain 10: STORIES (33 routes)

| # | Method | Path | Auth | Handler | Type | P | Notes |
|---|---|---|---|---|---|---|---|
| 61 | GET | `/api/stories/events/stream` | required | stories.js | STREAM_SSE | P1 | SSE stream for real-time story events. |
| 62 | POST | `/api/stories` | required | stories.js | JSON_WRITE | P0 | Create story. `{type: IMAGE\|VIDEO\|TEXT, mediaId, caption, stickers[], privacy, background}`. AI moderated. 24h TTL. Rate limited (30/hr). |
| 63 | GET | `/api/stories/feed` | required | stories.js | JSON_READ | P0 | Story feed (stories collection). Block-filtered. Privacy-aware. |
| 64 | GET | `/api/stories/:id` | optional | stories.js | JSON_READ | P0 | Get story. Privacy + block check. Auto-records view for auth users. |
| 65 | DELETE | `/api/stories/:id` | required | stories.js | JSON_WRITE | P0 | Delete story. Author or ADMIN. |
| 66 | GET | `/api/stories/:id/views` | required | stories.js | JSON_READ | P1 | Story viewers list. **OWNER-ONLY** (author can see who viewed). |
| 67 | POST | `/api/stories/:id/react` | required | stories.js | JSON_WRITE | P1 | Emoji reaction to story. Valid: ❤️🔥😂😮😢👏. |
| 68 | DELETE | `/api/stories/:id/react` | required | stories.js | JSON_WRITE | P1 | Remove story reaction. |
| 69 | POST | `/api/stories/:id/reply` | required | stories.js | JSON_WRITE | P1 | Reply to story. Privacy-gated (`replyPrivacy`). Max 1000 chars. |
| 70 | GET | `/api/stories/:id/replies` | required | stories.js | JSON_READ | P1 | Story replies. **OWNER-ONLY**. |
| 71 | POST | `/api/stories/:id/sticker/:stickerId/respond` | required | stories.js | JSON_WRITE | P1 | Respond to sticker (poll vote, quiz answer, slider value, question answer). |
| 72 | GET | `/api/stories/:id/sticker/:stickerId/results` | optional | stories.js | JSON_READ | P1 | Sticker aggregated results (poll percentages, etc). |
| 73 | GET | `/api/stories/:id/sticker/:stickerId/responses` | required | stories.js | JSON_READ | P2 | Raw sticker responses. **OWNER-ONLY**. |
| 74 | GET | `/api/me/stories/archive` | required | stories.js | JSON_READ | P1 | Own archived (expired) stories. |
| 75 | GET | `/api/users/:id/stories` | optional | stories.js | JSON_READ | P0 | User's active stories. Privacy + block filtered. |
| 76 | GET | `/api/me/close-friends` | required | stories.js | JSON_READ | P1 | Close friends list. |
| 77 | POST | `/api/me/close-friends/:userId` | required | stories.js | JSON_WRITE | P1 | Add to close friends. Max 500. |
| 78 | DELETE | `/api/me/close-friends/:userId` | required | stories.js | JSON_WRITE | P1 | Remove from close friends. |
| 79 | POST | `/api/me/highlights` | required | stories.js | JSON_WRITE | P1 | Create highlight. `{name, coverStoryId}`. Max 50 per user. |
| 80 | GET | `/api/users/:id/highlights` | optional | stories.js | JSON_READ | P1 | User's highlights list. |
| 81 | PATCH | `/api/me/highlights/:id` | required | stories.js | JSON_WRITE | P1 | Update highlight (name, add/remove stories). |
| 82 | DELETE | `/api/me/highlights/:id` | required | stories.js | JSON_WRITE | P1 | Delete highlight. |
| 83 | GET | `/api/me/story-settings` | required | stories.js | JSON_READ | P1 | Story privacy settings. |
| 84 | PATCH | `/api/me/story-settings` | required | stories.js | JSON_WRITE | P1 | Update story settings. `{defaultPrivacy, replyPrivacy, autoArchive, hideStoryFrom[]}`. |
| 85 | GET | `/api/me/blocks` | required | stories.js | JSON_READ | P1 | Blocked users list. |
| 86 | POST | `/api/me/blocks/:userId` | required | stories.js | JSON_WRITE | P1 | Block user. Bidirectional block effect. |
| 87 | DELETE | `/api/me/blocks/:userId` | required | stories.js | JSON_WRITE | P1 | Unblock user. |
| 88 | POST | `/api/stories/:id/report` | required | stories.js | JSON_WRITE | P1 | Report story. `{reason}`. |
| 89 | POST | `/api/admin/stories/:id/recompute-counters` | ADMIN | stories.js | ADMIN | P2 | Recompute story view/reaction counts from source. |
| 90 | POST | `/api/admin/stories/cleanup` | ADMIN | stories.js | ADMIN | P2 | Cleanup expired stories. |
| 91 | GET | `/api/admin/stories/analytics` | ADMIN | stories.js | ADMIN | P2 | Story platform analytics. |
| 92 | GET | `/api/admin/stories` | MOD+ | stories.js | ADMIN | P2 | Admin story queue. `?status, ?authorId`. |
| 93 | PATCH | `/api/admin/stories/:id/moderate` | MOD+ | stories.js | ADMIN | P1 | Moderate story. `{action: APPROVE\|REMOVE\|HOLD, reason}`. |

---

# Domain 11: REELS (36 routes)

| # | Method | Path | Auth | Handler | Type | P | Notes |
|---|---|---|---|---|---|---|---|
| 94 | POST | `/api/reels` | required | reels.js | JSON_WRITE | P0 | Create reel. `{mediaId, caption, audioId, isRemixOf, tags, draft}`. AI moderated. |
| 95 | GET | `/api/reels/feed` | optional | reels.js | JSON_READ | P0 | Reels discovery feed. Personalized: block-filtered, not-interested filtered. |
| 96 | GET | `/api/reels/following` | required | reels.js | JSON_READ | P0 | Following reels feed. |
| 97 | GET | `/api/users/:id/reels` | optional | reels.js | JSON_READ | P0 | User's reels. |
| 98 | GET | `/api/reels/:id` | optional | reels.js | JSON_READ | P0 | Get reel detail. View tracking. |
| 99 | PATCH | `/api/reels/:id` | required | reels.js | JSON_WRITE | P1 | Edit reel. Owner only. `{caption, tags}`. |
| 100 | DELETE | `/api/reels/:id` | required | reels.js | JSON_WRITE | P1 | Delete reel. Author or ADMIN. |
| 101 | POST | `/api/reels/:id/publish` | required | reels.js | JSON_WRITE | P1 | Publish draft reel. Owner only. |
| 102 | POST | `/api/reels/:id/archive` | required | reels.js | JSON_WRITE | P1 | Archive reel. Owner only. |
| 103 | POST | `/api/reels/:id/restore` | required | reels.js | JSON_WRITE | P1 | Restore archived reel. Owner only. |
| 104 | POST | `/api/reels/:id/pin` | required | reels.js | JSON_WRITE | P1 | Pin reel to profile. Owner only. |
| 105 | DELETE | `/api/reels/:id/pin` | required | reels.js | JSON_WRITE | P1 | Unpin reel. |
| 106 | POST | `/api/reels/:id/like` | required | reels.js | JSON_WRITE | P0 | Like reel. Notification to author. |
| 107 | DELETE | `/api/reels/:id/like` | required | reels.js | JSON_WRITE | P1 | Unlike reel. |
| 108 | POST | `/api/reels/:id/save` | required | reels.js | JSON_WRITE | P1 | Save reel. |
| 109 | DELETE | `/api/reels/:id/save` | required | reels.js | JSON_WRITE | P1 | Unsave reel. |
| 110 | POST | `/api/reels/:id/comment` | required | reels.js | JSON_WRITE | P0 | Comment on reel. AI moderated. `{text, parentId}`. |
| 111 | GET | `/api/reels/:id/comments` | optional | reels.js | JSON_READ | P0 | Reel comments. Cursor pagination. |
| 112 | POST | `/api/reels/:id/report` | required | reels.js | JSON_WRITE | P1 | Report reel. `{reason, details}`. |
| 113 | POST | `/api/reels/:id/hide` | required | reels.js | JSON_WRITE | P2 | Hide reel from feed. |
| 114 | POST | `/api/reels/:id/not-interested` | required | reels.js | JSON_WRITE | P2 | Mark not interested. |
| 115 | POST | `/api/reels/:id/share` | required | reels.js | JSON_WRITE | P1 | Record share. Increments shareCount. |
| 116 | POST | `/api/reels/:id/watch` | optional | reels.js | JSON_WRITE | P1 | Record watch time. `{watchTimeMs, completionRate}`. |
| 117 | POST | `/api/reels/:id/view` | optional | reels.js | JSON_WRITE | P1 | Record view (alias for simple view tracking). |
| 118 | GET | `/api/reels/audio/:audioId` | none | reels.js | JSON_READ | P2 | Get reels using same audio. |
| 119 | GET | `/api/reels/:id/remixes` | none | reels.js | JSON_READ | P2 | Get remix chain for a reel. |
| 120 | POST | `/api/me/reels/series` | required | reels.js | JSON_WRITE | P2 | Create reel series. `{name}`. |
| 121 | GET | `/api/users/:id/reels/series` | none | reels.js | JSON_READ | P2 | User's reel series list. |
| 122 | GET | `/api/me/reels/archive` | required | reels.js | JSON_READ | P1 | Own archived reels. |
| 123 | GET | `/api/me/reels/analytics` | required | reels.js | JSON_READ | P1 | Own reel analytics. |
| 124 | POST | `/api/reels/:id/processing` | required | reels.js | JSON_WRITE | P2 | Update processing status (callback from encoder). |
| 125 | GET | `/api/reels/:id/processing` | required | reels.js | JSON_READ | P2 | Check processing status. |
| 126 | GET | `/api/admin/reels` | MOD+ | reels.js | ADMIN | P2 | Admin reels queue. |
| 127 | PATCH | `/api/admin/reels/:id/moderate` | MOD+ | reels.js | ADMIN | P1 | Moderate reel. `{action, reason}`. |
| 128 | GET | `/api/admin/reels/analytics` | MOD+ | reels.js | ADMIN | P2 | Reel platform analytics. |
| 129 | POST | `/api/admin/reels/:id/recompute-counters` | ADMIN | reels.js | ADMIN | P2 | Recompute reel counters from source. |

---

# Domain 12: TRIBES (19 routes)

| # | Method | Path | Auth | Handler | Type | P | Notes |
|---|---|---|---|---|---|---|---|
| 130 | GET | `/api/tribes` | none | tribes.js:handleTribes | JSON_READ | P0 | List all tribes. |
| 131 | GET | `/api/tribes/standings/current` | none | tribes.js:handleTribes | JSON_READ | P0 | Current season standings with tribe scores. |
| 132 | GET | `/api/tribes/:id` | none | tribes.js:handleTribes | JSON_READ | P0 | Tribe detail. Members count, board, fund. |
| 133 | GET | `/api/tribes/:id/members` | none | tribes.js:handleTribes | JSON_READ | P1 | Tribe members. Offset pagination. |
| 134 | GET | `/api/tribes/:id/board` | none | tribes.js:handleTribes | JSON_READ | P1 | Tribe board (top contributors). |
| 135 | GET | `/api/tribes/:id/fund` | none | tribes.js:handleTribes | JSON_READ | P1 | Tribe fund/treasury. |
| 136 | GET | `/api/tribes/:id/salutes` | none | tribes.js:handleTribes | JSON_READ | P1 | Tribe salutes (peer recognition). |
| 137 | GET | `/api/me/tribe` | required | tribes.js:handleTribes | JSON_READ | P0 | Current user's tribe info. |
| 138 | GET | `/api/users/:id/tribe` | none | tribes.js:handleTribes | JSON_READ | P1 | User's tribe info. |
| 139 | GET | `/api/admin/tribes/distribution` | ADMIN | tribes.js:handleTribeAdmin | ADMIN | P1 | Tribe member distribution stats. |
| 140 | POST | `/api/admin/tribes/reassign` | ADMIN | tribes.js:handleTribeAdmin | ADMIN | P1 | Reassign users to tribes. |
| 141 | POST | `/api/admin/tribe-seasons` | ADMIN | tribes.js:handleTribeAdmin | ADMIN | P1 | Create tribe season. |
| 142 | GET | `/api/admin/tribe-seasons` | ADMIN | tribes.js:handleTribeAdmin | ADMIN | P1 | List tribe seasons. |
| 143 | POST | `/api/admin/tribe-contests` | ADMIN | tribes.js:handleTribeAdmin | ADMIN | P1 | Create tribe contest (from tribes handler). |
| 144 | POST | `/api/admin/tribe-contests/:id/resolve` | ADMIN | tribes.js:handleTribeAdmin | ADMIN | P1 | Resolve tribe contest (from tribes handler). |
| 145 | POST | `/api/admin/tribe-salutes/adjust` | ADMIN | tribes.js:handleTribeAdmin | ADMIN | P2 | Adjust salute points. |
| 146 | POST | `/api/admin/tribe-awards/resolve` | ADMIN | tribes.js:handleTribeAdmin | ADMIN | P2 | Resolve tribe awards. |
| 147 | POST | `/api/admin/tribes/migrate` | ADMIN | tribes.js:handleTribeAdmin | ADMIN | P2 | Migrate tribe data. |
| 148 | POST | `/api/admin/tribes/boards` | ADMIN | tribes.js:handleTribeAdmin | ADMIN | P2 | Seed/manage tribe boards. |

---

# Domain 13: TRIBE CONTESTS (28 routes)

| # | Method | Path | Auth | Handler | Type | P | Notes |
|---|---|---|---|---|---|---|---|
| 149 | GET | `/api/tribe-contests` | none | tribe-contests.js:handleTribeContests | JSON_READ | P0 | List active contests. |
| 150 | GET | `/api/tribe-contests/live-feed` | none | tribe-contests.js:handleTribeContests | JSON_READ | P0 | Live contest activity feed. |
| 151 | GET | `/api/tribe-contests/:id/live` | none | tribe-contests.js:handleTribeContests | JSON_READ | P1 | Single contest live data. |
| 152 | GET | `/api/tribe-contests/seasons/:seasonId/live-standings` | none | tribe-contests.js:handleTribeContests | JSON_READ | P1 | Live season standings. |
| 153 | GET | `/api/tribe-contests/:id` | optional | tribe-contests.js:handleTribeContests | JSON_READ | P0 | Contest detail. |
| 154 | POST | `/api/tribe-contests/:id/enter` | required | tribe-contests.js:handleTribeContests | JSON_WRITE | P0 | Enter contest. Validates tribe membership, state, entry limits. |
| 155 | GET | `/api/tribe-contests/:id/entries` | optional | tribe-contests.js:handleTribeContests | JSON_READ | P0 | Contest entries. |
| 156 | GET | `/api/tribe-contests/:id/leaderboard` | optional | tribe-contests.js:handleTribeContests | JSON_READ | P0 | Contest leaderboard. |
| 157 | GET | `/api/tribe-contests/:id/results` | optional | tribe-contests.js:handleTribeContests | JSON_READ | P1 | Contest results (after resolution). |
| 158 | POST | `/api/tribe-contests/:id/vote` | required | tribe-contests.js:handleTribeContests | JSON_WRITE | P0 | Vote in contest. Validates state, duplicate, cross-tribe rules. |
| 159 | POST | `/api/tribe-contests/:id/withdraw` | required | tribe-contests.js:handleTribeContests | JSON_WRITE | P1 | Withdraw entry. |
| 160 | GET | `/api/tribe-contests/seasons` | none | tribe-contests.js:handleTribeContests | JSON_READ | P1 | List all seasons. |
| 161 | GET | `/api/tribe-contests/seasons/:seasonId/standings` | none | tribe-contests.js:handleTribeContests | JSON_READ | P1 | Season standings. |
| 162 | POST | `/api/admin/tribe-contests` | ADMIN | tribe-contests.js:handleTribeContestAdmin | ADMIN | P1 | Create contest (from contest admin handler). |
| 163 | GET | `/api/admin/tribe-contests` | ADMIN | tribe-contests.js:handleTribeContestAdmin | ADMIN | P1 | List all contests (admin view). |
| 164 | GET | `/api/admin/tribe-contests/:id` | ADMIN | tribe-contests.js:handleTribeContestAdmin | ADMIN | P2 | Contest admin detail. |
| 165 | POST | `/api/admin/tribe-contests/:id/publish` | ADMIN | tribe-contests.js:handleTribeContestAdmin | ADMIN | P1 | Publish contest. State: DRAFT→PUBLISHED. |
| 166 | POST | `/api/admin/tribe-contests/:id/open-entries` | ADMIN | tribe-contests.js:handleTribeContestAdmin | ADMIN | P1 | Open entries. State: PUBLISHED→ENTRIES_OPEN. |
| 167 | POST | `/api/admin/tribe-contests/:id/close-entries` | ADMIN | tribe-contests.js:handleTribeContestAdmin | ADMIN | P1 | Close entries. State: ENTRIES_OPEN→ENTRIES_CLOSED. |
| 168 | POST | `/api/admin/tribe-contests/:id/lock` | ADMIN | tribe-contests.js:handleTribeContestAdmin | ADMIN | P1 | Lock for judging. |
| 169 | POST | `/api/admin/tribe-contests/:id/resolve` | ADMIN | tribe-contests.js:handleTribeContestAdmin | ADMIN | P1 | Resolve contest. Awards points. |
| 170 | POST | `/api/admin/tribe-contests/:id/disqualify` | ADMIN | tribe-contests.js:handleTribeContestAdmin | ADMIN | P2 | Disqualify entry. |
| 171 | POST | `/api/admin/tribe-contests/:id/judge-score` | ADMIN | tribe-contests.js:handleTribeContestAdmin | ADMIN | P2 | Judge score entry. |
| 172 | POST | `/api/admin/tribe-contests/:id/compute-scores` | ADMIN | tribe-contests.js:handleTribeContestAdmin | ADMIN | P2 | Compute final scores. |
| 173 | POST | `/api/admin/tribe-contests/:id/recompute-broadcast` | ADMIN | tribe-contests.js:handleTribeContestAdmin | ADMIN | P2 | Recompute + broadcast results. |
| 174 | POST | `/api/admin/tribe-contests/:id/cancel` | ADMIN | tribe-contests.js:handleTribeContestAdmin | ADMIN | P2 | Cancel contest. |
| 175 | POST | `/api/admin/tribe-contests/rules` | ADMIN | tribe-contests.js:handleTribeContestAdmin | ADMIN | P2 | Set contest rules config. |
| 176 | GET | `/api/admin/tribe-contests/dashboard` | ADMIN | tribe-contests.js:handleTribeContestAdmin | ADMIN | P1 | Contest admin dashboard. |

---

# Domain 14: EVENTS (22 routes)

| # | Method | Path | Auth | Handler | Type | P | Notes |
|---|---|---|---|---|---|---|---|
| 177 | POST | `/api/events` | required | events.js | JSON_WRITE | P0 | Create event. `{title, description, eventType, startDate, endDate, location, collegeId, maxAttendees}`. AI moderated. |
| 178 | GET | `/api/events/feed` | optional | events.js | JSON_READ | P0 | Event feed. Public upcoming events. Cursor pagination. |
| 179 | GET | `/api/events/search` | none | events.js | JSON_READ | P1 | Search events. `?q, ?eventType, ?collegeId`. |
| 180 | GET | `/api/events/college/:collegeId` | none | events.js | JSON_READ | P1 | College events. |
| 181 | GET | `/api/events/:id` | optional | events.js | JSON_READ | P0 | Event detail. Enriched with organizer, RSVP status. |
| 182 | PATCH | `/api/events/:id` | required | events.js | JSON_WRITE | P1 | Update event. Owner only. |
| 183 | DELETE | `/api/events/:id` | required | events.js | JSON_WRITE | P1 | Delete event. Owner or ADMIN. |
| 184 | POST | `/api/events/:id/publish` | required | events.js | JSON_WRITE | P1 | Publish event. DRAFT→PUBLISHED. |
| 185 | POST | `/api/events/:id/cancel` | required | events.js | JSON_WRITE | P1 | Cancel event. Notifies attendees. |
| 186 | POST | `/api/events/:id/archive` | required | events.js | JSON_WRITE | P2 | Archive event. |
| 187 | POST | `/api/events/:id/rsvp` | required | events.js | JSON_WRITE | P0 | RSVP to event. `{status: GOING\|INTERESTED\|NOT_GOING}`. Max attendees enforced. |
| 188 | DELETE | `/api/events/:id/rsvp` | required | events.js | JSON_WRITE | P1 | Cancel RSVP. |
| 189 | GET | `/api/events/:id/attendees` | optional | events.js | JSON_READ | P1 | Event attendees list. |
| 190 | POST | `/api/events/:id/report` | required | events.js | JSON_WRITE | P1 | Report event. |
| 191 | POST | `/api/events/:id/remind` | required | events.js | JSON_WRITE | P2 | Set reminder for event. |
| 192 | DELETE | `/api/events/:id/remind` | required | events.js | JSON_WRITE | P2 | Cancel reminder. |
| 193 | GET | `/api/me/events` | required | events.js | JSON_READ | P1 | Own events (organized). |
| 194 | GET | `/api/me/events/rsvps` | required | events.js | JSON_READ | P1 | Own RSVPs. |
| 195 | GET | `/api/admin/events` | MOD+ | events.js | ADMIN | P2 | Admin events queue. |
| 196 | PATCH | `/api/admin/events/:id/moderate` | MOD+ | events.js | ADMIN | P1 | Moderate event. |
| 197 | GET | `/api/admin/events/analytics` | MOD+ | events.js | ADMIN | P2 | Event analytics. |
| 198 | POST | `/api/admin/events/:id/recompute-counters` | ADMIN | events.js | ADMIN | P2 | Recompute event counters. |

---

# Domain 15: BOARD NOTICES + AUTHENTICITY (17 routes)

| # | Method | Path | Auth | Handler | Type | P | Notes |
|---|---|---|---|---|---|---|---|
| 199 | POST | `/api/board/notices` | required | board-notices.js | JSON_WRITE | P1 | Create notice. Board member only. `{title, body, priority, collegeId}`. AI moderated. |
| 200 | GET | `/api/board/notices/:id` | optional | board-notices.js | JSON_READ | P1 | Notice detail. |
| 201 | PATCH | `/api/board/notices/:id` | required | board-notices.js | JSON_WRITE | P1 | Update notice. Author or board member. |
| 202 | DELETE | `/api/board/notices/:id` | required | board-notices.js | JSON_WRITE | P1 | Delete notice. Author or ADMIN. |
| 203 | POST | `/api/board/notices/:id/pin` | required | board-notices.js | JSON_WRITE | P2 | Pin notice. Board member. |
| 204 | DELETE | `/api/board/notices/:id/pin` | required | board-notices.js | JSON_WRITE | P2 | Unpin notice. |
| 205 | POST | `/api/board/notices/:id/acknowledge` | required | board-notices.js | JSON_WRITE | P1 | Acknowledge notice. |
| 206 | GET | `/api/board/notices/:id/acknowledgments` | optional | board-notices.js | JSON_READ | P2 | Notice acknowledgment list. |
| 207 | GET | `/api/colleges/:id/notices` | optional | board-notices.js | JSON_READ | P1 | College notices. Cursor pagination. |
| 208 | GET | `/api/me/board/notices` | required | board-notices.js | JSON_READ | P1 | Own board notices (if board member). |
| 209 | GET | `/api/moderation/board-notices` | MOD+ | board-notices.js | ADMIN | P2 | Board notice moderation queue. |
| 210 | POST | `/api/moderation/board-notices/:id/decide` | MOD+ | board-notices.js | ADMIN | P2 | Moderate board notice. |
| 211 | GET | `/api/admin/board-notices/analytics` | ADMIN | board-notices.js | ADMIN | P2 | Board notice analytics. |
| 212 | POST | `/api/authenticity/tag` | required | board-notices.js:handleAuthenticityTags | JSON_WRITE | P2 | Declare content as synthetic/AI-generated. |
| 213 | GET | `/api/authenticity/tags/:type/:id` | optional | board-notices.js:handleAuthenticityTags | JSON_READ | P2 | Get authenticity tags for content. |
| 214 | DELETE | `/api/authenticity/tags/:id` | required | board-notices.js:handleAuthenticityTags | JSON_WRITE | P2 | Remove authenticity tag. Owner only. |
| 215 | GET | `/api/admin/authenticity/stats` | ADMIN | board-notices.js:handleAuthenticityTags | ADMIN | P2 | Authenticity tag stats. |

---

# Domain 16: REPORTS / APPEALS / NOTIFICATIONS / LEGAL / GRIEVANCES (14 routes)

| # | Method | Path | Auth | Handler | Type | P | Notes |
|---|---|---|---|---|---|---|---|
| 216 | POST | `/api/reports` | required | admin.js | JSON_WRITE | P0 | Report content/user. `{targetType, targetId, reasonCode, details}`. Auto-hold at 3+ reports. |
| 217 | GET | `/api/moderation/queue` | MOD+ | admin.js | ADMIN | P1 | Moderation queue. `?bucket=held\|reports\|appeals`. |
| 218 | POST | `/api/moderation/:contentId/action` | MOD+ | admin.js | ADMIN | P1 | Moderation action. `{action: APPROVE\|REMOVE\|SHADOW_LIMIT\|HOLD\|STRIKE, reason}`. |
| 219 | POST | `/api/appeals` | required | admin.js | JSON_WRITE | P1 | Create appeal. `{targetType, targetId, reason}`. |
| 220 | GET | `/api/appeals` | required | admin.js | JSON_READ | P1 | Own appeals. Max 20. |
| 221 | PATCH | `/api/appeals/:id/decide` | MOD+ | stages.js | ADMIN | P1 | Decide appeal. `{action, reasonCodes[], notes}`. Also POST. |
| 222 | GET | `/api/notifications` | required | admin.js | JSON_READ | P0 | User notifications. Cursor. Enriched with actor. `unreadCount`. |
| 223 | PATCH | `/api/notifications/read` | required | admin.js | JSON_WRITE | P0 | Mark read. `{ids:[]}` or all. |
| 224 | GET | `/api/legal/consent` | none | admin.js | JSON_READ | P0 | Active consent notice. Auto-creates default. |
| 225 | POST | `/api/legal/accept` | required | admin.js | JSON_WRITE | P0 | Accept consent. Sets onboarding=DONE. |
| 226 | POST | `/api/grievances` | required | admin.js | JSON_WRITE | P1 | Create grievance. `{ticketType, subject, description}`. SLA-based. |
| 227 | GET | `/api/grievances` | required | admin.js | JSON_READ | P1 | Own grievances. Max 20. |
| 228 | POST | `/api/admin/colleges/seed` | ADMIN | admin.js | ADMIN | P2 | Seed colleges DB. |
| 229 | GET | `/api/admin/stats` | ADMIN | admin.js | ADMIN | P1 | Platform stats. Cached. |

---

# Domain 17: COLLEGE CLAIMS (7 routes)

| # | Method | Path | Auth | Handler | Type | P | Notes |
|---|---|---|---|---|---|---|---|
| 230 | POST | `/api/colleges/:collegeId/claim` | required | stages.js:handleCollegeClaims | JSON_WRITE | P0 | Submit claim. `{claimType, evidence}`. 1 active per user. 7-day cooldown after reject. Auto-fraud at 3+ rejects. |
| 231 | GET | `/api/me/college-claims` | required | stages.js:handleCollegeClaims | JSON_READ | P1 | Own claims history. |
| 232 | DELETE | `/api/me/college-claims/:id` | required | stages.js:handleCollegeClaims | JSON_WRITE | P1 | Withdraw pending claim. PENDING only. |
| 233 | GET | `/api/admin/college-claims` | MOD+ | stages.js:handleCollegeClaims | ADMIN | P1 | Admin claim queue. `?status, ?fraudOnly`. |
| 234 | GET | `/api/admin/college-claims/:id` | MOD+ | stages.js:handleCollegeClaims | ADMIN | P1 | Admin claim detail + audit trail. |
| 235 | PATCH | `/api/admin/college-claims/:id/flag-fraud` | MOD+ | stages.js:handleCollegeClaims | ADMIN | P2 | Escalate to FRAUD_REVIEW. Also POST. |
| 236 | PATCH | `/api/admin/college-claims/:id/decide` | MOD+ | stages.js:handleCollegeClaims | ADMIN | P1 | Approve/reject. `{approve, reasonCodes, notes}`. Also POST. |

---

# Domain 18: DISTRIBUTION LADDER (7 routes)

| # | Method | Path | Auth | Handler | Type | P | Notes |
|---|---|---|---|---|---|---|---|
| 237 | POST | `/api/admin/distribution/evaluate` | ADMIN | stages.js:handleDistribution | ADMIN | P1 | Batch evaluate Stage 0/1 content. Also GET. |
| 238 | POST | `/api/admin/distribution/evaluate/:contentId` | MOD+ | stages.js:handleDistribution | ADMIN | P2 | Single content evaluate. Also GET. |
| 239 | GET | `/api/admin/distribution/config` | MOD+ | stages.js:handleDistribution | ADMIN | P2 | View distribution rules. |
| 240 | POST | `/api/admin/distribution/kill-switch` | ADMIN | stages.js:handleDistribution | ADMIN | P1 | Toggle auto-evaluation on/off. |
| 241 | GET | `/api/admin/distribution/inspect/:contentId` | MOD+ | stages.js:handleDistribution | ADMIN | P2 | Distribution detail + signals + audit. |
| 242 | POST | `/api/admin/distribution/override` | MOD+ | stages.js:handleDistribution | ADMIN | P1 | Manual override. `{contentId, stage, reason}`. |
| 243 | DELETE | `/api/admin/distribution/override/:contentId` | ADMIN | stages.js:handleDistribution | ADMIN | P2 | Remove override, re-enable auto-eval. |

---

# Domain 19: RESOURCES / PYQs (14 routes)

| # | Method | Path | Auth | Handler | Type | P | Notes |
|---|---|---|---|---|---|---|---|
| 244 | POST | `/api/resources` | required | stages.js:handleResources | JSON_WRITE | P0 | Create resource. `{kind, collegeId, title, subject, semester, year, fileAssetId}`. AI moderated. College-membership guard. Rate limited (10/hr). |
| 245 | GET | `/api/resources/search` | none | stages.js:handleResources | JSON_READ | P0 | Search resources. `?collegeId, ?branch, ?subject, ?semester, ?kind, ?year, ?q, ?sort=recent\|popular\|most_downloaded`. Faceted. Cached. |
| 246 | GET | `/api/resources/:id` | optional | stages.js:handleResources | JSON_READ | P0 | Resource detail. Enriched with uploader, viewer vote status. |
| 247 | PATCH | `/api/resources/:id` | required | stages.js:handleResources | JSON_WRITE | P1 | Update resource. Owner only. |
| 248 | DELETE | `/api/resources/:id` | required | stages.js:handleResources | JSON_WRITE | P1 | Delete resource. Owner or ADMIN. |
| 249 | POST | `/api/resources/:id/report` | required | stages.js:handleResources | JSON_WRITE | P1 | Report resource. |
| 250 | POST | `/api/resources/:id/vote` | required | stages.js:handleResources | JSON_WRITE | P1 | Vote UP/DOWN. Trust-weighted. `{vote: UP\|DOWN}`. Duplicate same-direction = 409. |
| 251 | DELETE | `/api/resources/:id/vote` | required | stages.js:handleResources | JSON_WRITE | P1 | Remove vote. |
| 252 | POST | `/api/resources/:id/download` | optional | stages.js:handleResources | JSON_WRITE | P1 | Record download. Returns file URL. |
| 253 | GET | `/api/me/resources` | required | stages.js:handleResources | JSON_READ | P1 | Own uploaded resources. |
| 254 | GET | `/api/admin/resources` | MOD+ | stages.js:handleResources | ADMIN | P2 | Admin resource queue. `?status, ?collegeId`. |
| 255 | PATCH | `/api/admin/resources/:id/moderate` | MOD+ | stages.js:handleResources | ADMIN | P2 | Moderate resource. `{action, reason}`. |
| 256 | POST | `/api/admin/resources/:id/recompute-counters` | ADMIN | stages.js:handleResources | ADMIN | P2 | Recompute resource vote/download counters. |
| 257 | POST | `/api/admin/resources/reconcile` | ADMIN | stages.js:handleResources | ADMIN | P2 | Reconcile all resource counters. |

---

# Domain 20: GOVERNANCE (8 routes)

| # | Method | Path | Auth | Handler | Type | P | Notes |
|---|---|---|---|---|---|---|---|
| 258 | GET | `/api/governance/college/:collegeId/board` | none | governance.js | JSON_READ | P1 | College board (11 seats). |
| 259 | POST | `/api/governance/college/:collegeId/apply` | required | governance.js | JSON_WRITE | P1 | Apply for board seat. Same-college only. |
| 260 | GET | `/api/governance/college/:collegeId/applications` | none | governance.js | JSON_READ | P1 | Pending board applications. |
| 261 | POST | `/api/governance/applications/:appId/vote` | required | governance.js | JSON_WRITE | P1 | Vote on application. Board members only. `{vote: APPROVE\|REJECT}`. |
| 262 | POST | `/api/governance/college/:collegeId/proposals` | required | governance.js | JSON_WRITE | P1 | Create proposal. Board members only. `{title, description, category}`. |
| 263 | GET | `/api/governance/college/:collegeId/proposals` | none | governance.js | JSON_READ | P1 | List proposals. `?status=OPEN\|PASSED\|REJECTED`. |
| 264 | POST | `/api/governance/proposals/:proposalId/vote` | required | governance.js | JSON_WRITE | P1 | Vote on proposal. Board members only. `{vote: FOR\|AGAINST\|ABSTAIN}`. |
| 265 | POST | `/api/governance/college/:collegeId/seed-board` | ADMIN | governance.js | ADMIN | P2 | Seed initial board. ADMIN only. Auto-fills from top followers. |

---

# Domain 21: TRIBE CONTEST ADMIN (additional from tribe-contests.js - 1 route)

| # | Method | Path | Auth | Handler | Type | P | Notes |
|---|---|---|---|---|---|---|---|
| 266 | POST | `/api/admin/tribe-salutes/adjust` | ADMIN | tribe-contests.js:handleTribeContestAdmin | ADMIN | P2 | Adjust salute points (from contest admin handler). |

---

## Final Count: **266 confirmed callable routes** + 5 dead routes in house-points.js

> **Note**: Some routes accept both PATCH and POST (e.g., appeal decide, college claim decide). These are counted once under the primary method. The actual callable method count is higher when including aliases (PUT for all onboarding PATCH routes, POST alternatives for appeal/claim decisions).

---

## Route Dispatch Map (how route.js resolves paths)

```
/api/auth/*                    → handleAuth (auth.js)
/api/me/stories/archive        → handleStories (stories.js)
/api/me/close-friends/*        → handleStories (stories.js)
/api/me/highlights/*           → handleStories (stories.js)
/api/me/story-settings         → handleStories (stories.js)
/api/me/blocks/*               → handleStories (stories.js)
/api/me/reels/*                → handleReels (reels.js)
/api/me/events/*               → handleEvents (events.js)
/api/me/board/*                → handleBoardNotices (board-notices.js)
/api/me/tribe                  → handleTribes (tribes.js)
/api/me/college-claims/*       → handleCollegeClaims (stages.js)
/api/me/resources              → handleResources (stages.js)
/api/me/*                      → handleOnboarding (onboarding.js) [fallback]
/api/content (POST,GET,DELETE)  → handleContent (content.js) [when path.length <= 2]
/api/content/:id/*             → handleSocial (social.js) [like, dislike, save, comments]
/api/feed/*                    → handleFeed (feed.js)
/api/follow/*                  → handleSocial (social.js)
/api/stories/*                 → handleStories (stories.js)
/api/reels/*                   → handleReels (reels.js)
/api/users/:id/stories         → handleStories (stories.js)
/api/users/:id/highlights      → handleStories (stories.js)
/api/users/:id/reels           → handleReels (reels.js)
/api/users/:id/tribe           → handleTribes (tribes.js)
/api/users/*                   → handleUsers (users.js) [fallback]
/api/colleges/:id/claim        → handleCollegeClaims (stages.js)
/api/colleges/:id/notices      → handleBoardNotices (board-notices.js)
/api/colleges/*                → handleDiscovery (discovery.js) [fallback]
/api/houses/*                  → handleDiscovery (discovery.js)
/api/search                    → handleDiscovery (discovery.js)
/api/suggestions/*             → handleDiscovery (discovery.js)
/api/media/*                   → handleMedia (media.js)
/api/house-points/*            → DEPRECATED 410 (inline)
/api/governance/*              → handleGovernance (governance.js)
/api/reports                   → handleAdmin (admin.js)
/api/appeals/:id/decide        → handleAppealDecision (stages.js)
/api/appeals/*                 → handleAdmin (admin.js) [fallback]
/api/notifications/*           → handleAdmin (admin.js)
/api/legal/*                   → handleAdmin (admin.js)
/api/grievances                → handleAdmin (admin.js)
/api/moderation/board-notices/* → handleBoardNotices (board-notices.js)
/api/moderation/*              → handleAdmin (admin.js) [fallback]
/api/admin/college-claims/*    → handleCollegeClaims (stages.js)
/api/admin/distribution/*      → handleDistribution (stages.js)
/api/admin/resources/*         → handleResources (stages.js)
/api/admin/stories/*           → handleStories (stories.js)
/api/admin/reels/*             → handleReels (reels.js)
/api/admin/events/*            → handleEvents (events.js)
/api/admin/board-notices/*     → handleBoardNotices (board-notices.js)
/api/admin/authenticity/*      → handleAuthenticityTags (board-notices.js)
/api/admin/tribes/*            → handleTribeAdmin (tribes.js)
/api/admin/tribe-seasons/*     → handleTribeAdmin (tribes.js)
/api/admin/tribe-contests/*    → handleTribeContestAdmin (tribe-contests.js)
/api/admin/tribe-salutes/*     → handleTribeContestAdmin (tribe-contests.js)
/api/admin/tribe-awards/*      → handleTribeAdmin (tribes.js)
/api/admin/*                   → handleAdmin (admin.js) [fallback]
/api/resources/*               → handleResources (stages.js)
/api/events/*                  → handleEvents (events.js)
/api/board/*                   → handleBoardNotices (board-notices.js)
/api/authenticity/*            → handleAuthenticityTags (board-notices.js)
/api/tribe-contests/*          → handleTribeContests (tribe-contests.js)
/api/tribes/*                  → handleTribes (tribes.js)
```
