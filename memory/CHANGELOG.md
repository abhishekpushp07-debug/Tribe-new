# Tribe — Changelog

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
