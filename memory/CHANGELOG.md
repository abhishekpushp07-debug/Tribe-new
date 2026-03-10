# Tribe — Changelog

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
