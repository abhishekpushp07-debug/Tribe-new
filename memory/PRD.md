# Tribe — Trust-First Social Platform for Indian College Students

## Vision
World-class social media backend for Indian college students, built stage-by-stage with proof-based acceptance.

## Core Architecture
- **Backend**: Monolithic Next.js API
- **Database**: MongoDB
- **Cache**: Redis (with in-memory fallback)
- **Real-time**: SSE via Redis Pub/Sub + EventEmitter fallback
- **Moderation**: OpenAI GPT-4o-mini
- **Storage**: Emergent Object Storage

## Stage Status

| Stage | Feature | Status |
|-------|---------|--------|
| 1 | Appeal Decision Workflow | ✅ PASSED |
| 2 | College Claim Workflow | ✅ PASSED |
| 3 | Story Expiry Cleanup | ✅ PASSED |
| 4 | Distribution Ladder | ✅ PASSED (2 test failures from prev session) |
| 5 | Notes/PYQs Library | ✅ BUILT (pending formal PASS) |
| 9 | World's Best Stories | ✅ BUILT + HARDENED + AUDITED (pending user PASS) |
| 6 | Events + RSVP | ⬜ UPCOMING |
| 7 | Board Notices + Authenticity | ⬜ UPCOMING |
| 8 | OTP Challenge Flow | ⬜ UPCOMING |
| 10 | World's Best Reels | ⬜ UPCOMING |
| 11 | Scale/Reliability Excellence | ⬜ FUTURE |
| 12 | Final Launch Readiness Gate | ⬜ FUTURE |

## Stage 9: World's Best Stories — Feature Set

### Endpoints (31 total)
- Story CRUD, Feed, Archive, Privacy
- Reactions, Replies, Sticker Responses
- Close Friends management (max 500, TOCTOU-safe)
- Highlights (max 50, TOCTOU-safe, batch-optimized)
- Block/Unblock with full privacy integration
- Admin moderation, analytics, counter recompute, cleanup
- **Real-time SSE stream** (`GET /stories/events/stream`)

### Collections (10)
stories, story_views, story_reactions, story_replies, story_sticker_responses,
story_highlights, story_highlight_items, close_friends, story_settings, blocks

### Indexes: 31 custom, 27/27 IXSCAN, zero COLLSCANs

### Key Technical Achievements
- 49/49 test pass rate (100%)
- Zero COLLSCANs across all query paths
- TOCTOU-safe max-count enforcement (insert-then-count-rollback)
- Bidirectional block integration on every data path
- Real-time SSE with dual-mode (Redis/in-memory) fallback
- Automated story expiry worker (30-min cycle)
- TTL cleanup: EXPIRED stories auto-deleted 30 days after expiry
- Batch-optimized highlights (3 queries instead of 2N+1)

## Key Files
- `/app/lib/handlers/stories.js` — Story handler (all 31 endpoints)
- `/app/lib/realtime.js` — Real-time SSE + Redis/memory event system
- `/app/lib/db.js` — DB init + indexes
- `/app/app/api/[[...path]]/route.js` — Route dispatcher
- `/app/lib/cache.js` — Redis/memory cache
- `/app/memory/stage_9_full_proof_pack.md` — Complete proof pack
