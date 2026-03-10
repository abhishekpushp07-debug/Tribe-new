# Tribe — Changelog

## 2026-03-10: Stage FH1-U — Frontend Readiness Gate (PASS)
### Validation
- Full backend discovery: 16 handler files, 150+ routes enumerated from actual code
- All domains validated: auth, profile, media, content, comments, stories, reels, social graph, notifications, tribes, contests, events, governance, pages, B4 features, search
- **633/633 tests passing** (B3 107 + B4 72 + existing 454 = zero regressions)

### Frontend Handoff Pack (7 Docs)
1. **API_REFERENCE.md** — Complete route reference for all 150+ endpoints across 16 domains
2. **SERIALIZER_CONTRACTS.md** — Frozen canonical shapes: UserSnippet, PageSnippet, PostObject, RepostObject, CommentObject, MediaObject, NotificationObject, CollegeSnippet, TribeSnippet, ContestSnippet
3. **SCREEN_TO_ENDPOINT_MAP.md** — 22 frontend screens mapped to exact backend endpoints
4. **STATE_AND_PERMISSIONS.md** — Page role matrix, content visibility, edit/share/like permissions, optimistic UI safety table
5. **NOTIFICATION_EVENT_GUIDE.md** — All 10 notification types with trigger, recipient, deep-link behavior
6. **FE_KNOWN_GOTCHAS.md** — 20 documented edge cases (dual author, avatar resolution, pagination, age gate, repost rendering, etc.)
7. **FRONTEND_INTEGRATION_GUIDE.md** — Complete integration guide by domain

### Contract Freeze Status
- All serializer shapes frozen and verified against actual code
- No route drift detected
- No serializer drift detected
- Dual author (USER/PAGE) rendering rules documented
- Repost serializer shape documented

---

## 2026-03-10: Stage B4 + B4-U — Core Social Gaps (PASS)
### Features Implemented
- **Edit Post Caption** (`PATCH /content/:id`): Owner/page-role edit with moderation re-check, editedAt timestamp, enriched response. B2 ownership + page-role guard.
- **Comment Like/Unlike** (`POST/DELETE /content/:postId/comments/:commentId/like`): Idempotent like/unlike with `commentLikeCount`, B2 parent-content visibility guard, self-notify suppression. Separate `comment_likes` collection with unique index.
- **Share/Repost** (`POST /content/:id/share`): Creates new content_item linked via `originalContentId`. One-repost-per-user-per-original. Cannot repost a repost. B2 visibility/block checks. Original content embedded in serializer. Increment `shareCount` on original.
- **Counter Integration**: commentLikeCount, shareCount — proven exact, idempotent, never-negative.
- **Notification Integration**: COMMENT_LIKE → comment author, SHARE → original author (page-aware for page-owned content). Self-notify suppressed.
- **Serializer/enrichPosts Updated**: Repost items embed `originalContent` with resolved author. `editedAt` exposed on edited posts.
- **Content creation fixed**: User-authored posts now always include `authorType: 'USER'`, `createdAs: 'USER'`.
- **Index setup**: `comment_likes` unique on (userId, commentId), `content_items` sparse on (authorId, originalContentId).

### B4-U Test Gate: PASS
- **72/72 tests passing** across 14 phases
- Covers: routes, edit, comment-like, share/repost, counters, notifications, snapshots, B2 safety, page compat, concurrency, failure/rollback, performance, backward compat, observability
- **Full regression: 633/633 PASS** (zero regressions), 2x idempotent

### Files Changed
- `/app/lib/constants.js` — Added COMMENT_LIKE, SHARE to NotificationType
- `/app/lib/handlers/content.js` — Added PATCH /content/:id, added authorType/createdAs to POST
- `/app/lib/handlers/social.js` — Added comment like/unlike, share/repost handlers + B4 indexes
- `/app/lib/auth-utils.js` — Updated enrichPosts for repost embedding
- `/app/app/api/[[...path]]/route.js` — Updated routing for PATCH and path.length >= 3
- `/app/tests/handlers/test_b4_ultimate.py` — 72-test B4-U gate

---

## 2026-03-10: Stage B3-U — Ultimate World-Best Test Gate (PASS)
### Verdict: PASS
- **107 tests, 0 failures** across all 19 phases
- Covered: route/contract, identity, lifecycle, roles, follow/counters, publishing/audit, post mutation, content reads, feed, search, notifications, contract snapshots, security/abuse, concurrency, failure/rollback, performance/index, migration, backward compat, observability
- Fixed 8 previously failing tests (429 rate limiting) by distributing writes across dedicated per-phase users
- Added 17 new tests: Phase 11 (notifications, 4), Phase 15 (failure/rollback, 4), Phase 16 (performance/index, 6), Phase 13 (verification field protection, 1), Phase 14 (follow/unfollow race + duplicate archive, 2)
- Full suite: **561/561 passed**, 2x idempotent (104s, 48s)
- Proof pack: `/app/memory/b3u_proof_pack.md`

---

## 2026-03-10: Stage B3 — Pages System (COMPLETE)
### New Features
- **Pages as first-class entities**: Full CRUD with slug-based identity, 12 page categories
- **Multi-role team management**: OWNER > ADMIN > EDITOR > MODERATOR with strict cascading permissions
- **Publish as page**: Reuses existing content engine. Public author = Page, audit actor = real user
- **Page follow/unfollow**: With follower count management, idempotent operations
- **Feed integration**: Followed page posts appear in following feed alongside user-authored posts
- **Search integration**: Pages searchable by name/slug/category via both /pages?q= and /search?type=pages
- **Notification targeting**: Likes/comments on page-authored content notify OWNER+ADMIN members
- **Official page safety**: Cannot self-assert official status, "official" keyword restricted in names/slugs
- **Page lifecycle**: ACTIVE → ARCHIVED → restored. No publishing on archived pages.
- **Ownership transfer**: Safe atomic transfer with last-owner protection
- **Migration backfill**: 380 legacy content items backfilled with authorType=USER

### Files Added
- `/app/lib/handlers/pages.js` — Main pages handler (18 endpoints)
- `/app/lib/page-permissions.js` — Centralized page role system
- `/app/lib/page-slugs.js` — Slug normalization, validation, reserved slugs
- `/app/tests/handlers/test_b3_pages.py` — 50 targeted B3 tests
- `/app/scripts/b3_backfill_author_fields.py` — Idempotent migration script

### Files Modified
- `/app/lib/entity-snippets.js` — Added `toPageSnippet()`, `toPageProfile()`
- `/app/lib/auth-utils.js` — Extended `enrichPosts()` for PAGE authorship
- `/app/lib/access-policy.js` — Updated block checks for page-authored content
- `/app/lib/handlers/feed.js` — Following feed includes followed page posts
- `/app/lib/handlers/discovery.js` — Search supports type=pages
- `/app/lib/handlers/content.js` — Content delete supports page-authored posts
- `/app/lib/handlers/social.js` — Notifications target page OWNER+ADMIN for page content
- `/app/app/api/[[...path]]/route.js` — Wired pages handler

### Contract Docs Updated
- `domain_map.md` — Added Pages domain (#40, 18 routes)
- `response_contracts.md` — Added PageSnippet, PageProfile, Content Author Shape
- `quirk_ledger.md` — Added Quirk 18 (authorType) and Quirk 19 (slug lookup)

### Test Results
- 50 B3 targeted tests passing
- 396 existing tests passing (zero regressions)
- 446 total tests

## 2026-03-10: Stage 4C-P0B — Visibility + Permission Matrix — PERFECT
- **44 tests, 0 skipped, 0 failures** across 5 authorization dimensions
- Anonymous: 7 read-allowed (200) + 11 write-denied (401) across all entity types
- Age-gate: UNKNOWN→403 AGE_REQUIRED, CHILD→text OK / media+reel+story→403 CHILD_RESTRICTED
- Role-gate: USER→403 notices, ADMIN→creates/deletes/pins across entities
- Ownership: own mutations OK, cross-user→403, self-vote→403, self-like→400
- Content-state: REMOVED→404/410, HELD→absent, DRAFT→invisible to non-creator, CANCELLED→accessible, Banned→403 login
- Created `permission_user_a`, `permission_user_b`, `permission_admin` fixtures (14th user)
- Fixed admin WRITE rate limit interference: isolated P0-B admin from shared `admin_user`
- Fixed admin state leakage: P0-A now saves/restores `admin_user.collegeId`
- Suite: **396/396 passed**, 2x idempotent (42.40s, 41.47s)
- Proof pack: `/app/memory/stage_4c_p0b_proof_pack.md`

---

## 2026-03-10: Stage 4C-P0A — Cross-Surface Entity Consistency — PERFECT
- **24 tests, 0 skipped, 0 failures** across 5 entity domains
- Posts (8): detail↔feed, college/house feed, like/dislike/comment/reaction-remove consistency
- Events (6): detail↔feed↔search, RSVP/cancel count, college event feed, delete→410
- Resources (4): detail↔search, upvote/downvote voteScore consistency, remove→410
- Notices (3): detail↔college listing, acknowledge count consistency, remove→410
- Reels (3): like count consistency cross-user, remove→404/410
- Fixed 3 field-name bugs: `dislikeCount`→`viewerHasDisliked`, `upvoteCount`/`downvoteCount`→`voteScore`/`voteCount`
- Suite: **352/352 passed**, 2x idempotent (38.33s, 37.22s)
- Proof pack: `/app/memory/stage_4c_p0a_proof_pack.md`

---

## 2026-03-10: Stage 4B P4+P5 Fix — Events + Resources 8/10 → 10/10
- **Events (18 new tests)**: PATCH update + validation, DELETE soft-remove → 410, publish DRAFT→PUBLISHED state transition, cancel + archive lifecycle, search (structure + query + category), college event feed
- **Resources (18 new tests)**: PATCH update + validation, DELETE soft-remove → 410, search (structure + query + college + kind facets), download tracking + auth
- Created `event_lifecycle_user` and `resource_lifecycle_user` fixtures (10th user) for rate-limit isolation
- Updated conftest.py cleanup for `event_reports`, `event_reminders`, `resource_downloads`
- Suite: 328/328 passed, 2x idempotent (32.15s, 29.95s)
- Scorecard updated: 90/100 → **96/100**

---

## 2026-03-10: Stage 4B P6 Fix — Notices + Reels 7/10 → 9/10
- Added 15 new notice tests: update (PATCH), delete (soft-remove→410), pin/unpin, college listing, acknowledgment list
- Added 11 new reel tests: comment list (GET), hide, not-interested, share + idempotency + auth checks
- Created `reel_signal_user` fixture (8th user) for rate-limit isolation
- Updated conftest.py cleanup for `reel_hidden`, `reel_not_interested`, `reel_shares`
- Suite: 296/296 passed, 2x idempotent (30.92s, 30.00s)
- Scorecard updated to reflect earned 90/100

---

## 2026-03-10: Stage 4B True Deep Audit Scorecard — DELIVERED
- Full endpoint-by-endpoint audit across all 18 handlers
- Mapped 38 covered endpoints against ~150+ total handler endpoints
- Scorecard: `/app/memory/stage_4b_true_scorecard.md`
- Awaiting user judgment

---

## 2026-03-09: Stage 4B Complete — DONE (88/100)

### What Was Added (131 new tests: 139→270)
- **Dislike + Reaction-Remove** (10 tests): dislike, toggle like→dislike, reaction-remove, counter decrement
- **Events** (16 tests): create, detail, RSVP GOING/INTERESTED, duplicate RSVP, cancel, feed, auth, validation
- **Resources/PYQs** (14 tests): create with collegeId, detail, vote UP/DOWN/switch, duplicate vote 409, self-vote 403, remove vote
- **Board Notices** (10 tests): admin-only create, detail, REMOVED→410, acknowledge, duplicate ack, permission boundary
- **Reels** (14 tests): discovery/following feed, detail, like/unlike, save/unsave, comment, watch analytics, self-like forbidden
- **Cross-Surface** (4 tests): like count detail↔feed, comment count detail↔feed, delete consistency, contract stability
- **Product Smoke Expansion** (2 tests): event lifecycle, resource lifecycle
- **College + House Feed** (10 tests): distributionStage gating, cross-college/house isolation

### Infrastructure Changes
- 7 dedicated test users: test_user, test_user_2, product_user_a/b, resource_user, social_user, admin_user
- Cleanup extended to 20+ collections (events, resources, notices, reels, etc.)
- Fixed flaky OPTIONS metrics test for high-volume suite runs
- Cache-bypass strategy for college/house feed tests (cursor=2099)

### Discoveries
- Resource create requires collegeId in body + matching user college + college exists in DB
- Resource vote field is `vote` (not `type`), duplicate same-direction = 409
- Reel interactions return `{ message: 'Liked' }` (not `viewerHasLiked`)
- Event creation has 10/hour per-user rate limit
- Notice creation restricted to board members or admin role

---

## 2026-03-09: Stage 4B-1 — Posts + Feed + Social + Visibility
- 49 new tests, product_user_a/b fixtures, extended cleanup
- Proof pack: `/app/memory/stage_4b1_proof_pack.md`

## 2026-03-09: Stage 4A Gold Closure — COMPLETE (87/100)
- Proof pack: `/app/memory/stage_4a_gold_closure_proof_pack.md`

## Earlier: Stage 3 + 3B (93/100), Stage 2 (88/100)
