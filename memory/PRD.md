# Tribe — Trust-First Social Platform for Indian College Students

## Vision
World-class social media backend for Indian college students, built stage-by-stage with proof-based acceptance.

## Core Architecture
- **Backend**: Monolithic Next.js API
- **Database**: MongoDB (60+ collections, 200+ indexes)
- **Cache**: Redis (with in-memory fallback)
- **Real-time**: SSE via Redis Pub/Sub + EventEmitter fallback
- **Moderation**: OpenAI GPT-4o-mini (provider-adapter pattern)
- **Storage**: Emergent Object Storage

## Stage Status

| Stage | Feature | Status | Test Results |
|-------|---------|--------|-------------|
| 1 | Appeal Decision Workflow | PASSED | — |
| 2 | College Claim Workflow | PASSED | — |
| 3 | Story Expiry Cleanup | PASSED | — |
| 4 | Distribution Ladder | PASSED | — |
| 5 | Notes/PYQs Library | PASSED | — |
| 9 | World's Best Stories | PASSED | — |
| 10 | World's Best Reels | PASSED | 53/53 manual + 46/46 auto + 39/39 IXSCAN |
| 6 | World's Best Events + RSVP | PROOF DELIVERED | 43/43 auto + 32/32 IXSCAN |
| 7 | Board Notices + Authenticity | PROOF DELIVERED | 43/43 auto + 32/32 IXSCAN |
| **12** | **21-Tribe System (Safe Cutover)** | **STRONG PASS (89/100)** | **19/21 auto + 28/28 IXSCAN** |
| **12X** | **Tribe Contest Engine** | **IMPLEMENTED + TESTED** | **12/15 auto + 15/15 IXSCAN + Ledger 100%** |
| 8 | OTP Challenge Flow | REMOVED | User request |
| 11 | Scale/Reliability Excellence | UPCOMING | — |

## Stage 12X: Tribe Contest Engine — Summary

### Product Vision
Full in-app Tribe Contest Module for competitive social engagement:
- **Layer A**: Social graph (reels, posts, likes, comments, shares, follows)
- **Layer B**: Tribe competition graph (contests, entries, scoring, salutes, standings, trophy)

### Golden Rule: Like ≠ Vote ≠ Score ≠ Salute ≠ Fund

### New Collections (7)
- `tribe_contest_rules` — Versioned rules per contest
- `tribe_contest_scores` — Derived scoring rows
- `tribe_contest_results` — Locked official results
- `contest_votes` — Anti-cheat protected voting
- `contest_judge_scores` — Rubric-based judge scoring
- Upgraded: `tribe_contests` (full lifecycle), `tribe_contest_entries` (validation states)

### 27 New Indexes (15/15 IXSCAN verified)

### Contest Types Supported
- reel_creative, tribe_battle, participation, judge, hybrid, seasonal

### Contest Lifecycle
DRAFT → PUBLISHED → ENTRY_OPEN → ENTRY_CLOSED → EVALUATING → LOCKED → RESOLVED

### Scoring Models
- `scoring_reel_hybrid_v1` — Judge(35%) + Completion(20%) + Saves(15%) + Shares(10%) + Likes(10%) + Comments(10%)
- `scoring_participation_v1` — Entries(50%) + Verified(20%) + Completion(15%) + Clean(15%)
- `scoring_judge_only_v1` — Creativity + Originality + Execution + Impact
- `scoring_tribe_battle_v1` — Top entries sum(60%) + Participation(20%) - Penalties(20%)

### Anti-Cheat Controls
- One vote per user per entry per contest (unique index)
- Self-vote blocking (configurable)
- Vote cap per user per contest (default 5)
- Duplicate content detection
- Max entries per user/tribe enforcement
- Idempotent contest resolution (no double salutes)
- Entry withdrawal and disqualification

### Salute Distribution (Default)
- Rank 1: 1000 salutes
- Rank 2: 600 salutes
- Rank 3: 300 salutes
- Finalist: 100 salutes
- Participation bonus: 25 (configurable)

### RBAC Matrix
| Role | Create | Publish | Resolve | Judge Score | Adjust Salutes | Enter | Vote |
|------|--------|---------|---------|-------------|----------------|-------|------|
| SUPER_ADMIN | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| ADMIN | ✅ | ✅ | ✅ | ✅ | ✅ | — | — |
| JUDGE | — | — | — | ✅ | — | — | — |
| USER | — | — | — | — | — | ✅ | ✅ |

### API Endpoints (25+)

#### Public (10)
- GET /tribe-contests (list)
- GET /tribe-contests/:id (detail)
- POST /tribe-contests/:id/enter
- GET /tribe-contests/:id/entries
- GET /tribe-contests/:id/leaderboard
- GET /tribe-contests/:id/results
- POST /tribe-contests/:id/vote
- POST /tribe-contests/:id/withdraw
- GET /tribe-contests/seasons
- GET /tribe-contests/seasons/:id/standings

#### Admin (15)
- POST /admin/tribe-contests (create)
- GET /admin/tribe-contests (list)
- GET /admin/tribe-contests/:id (detail + stats)
- POST /admin/tribe-contests/:id/publish
- POST /admin/tribe-contests/:id/open-entries
- POST /admin/tribe-contests/:id/close-entries
- POST /admin/tribe-contests/:id/lock
- POST /admin/tribe-contests/:id/resolve (idempotent)
- POST /admin/tribe-contests/:id/disqualify
- POST /admin/tribe-contests/:id/judge-score
- POST /admin/tribe-contests/:id/compute-scores
- POST /admin/tribe-contests/:id/cancel
- POST /admin/tribe-contests/rules (versioned)
- POST /admin/tribe-salutes/adjust
- GET /admin/tribe-contests/dashboard

### Key Features Proven
- ✅ Full contest lifecycle with strict status transitions
- ✅ Idempotent resolution (replay returns same result, no double salutes)
- ✅ Salute ledger integrity (standings = ledger sum, 100% verified)
- ✅ Anti-cheat: duplicate votes, self-votes, entry limits all enforced
- ✅ RBAC: unauthorized users cannot resolve/adjust/disqualify
- ✅ Zero COLLSCAN on all 15 hot query paths
- ✅ Auto tribe assignment on user registration

## Key Files
- `/app/lib/handlers/tribe-contests.js` — Stage 12X Contest Engine (NEW)
- `/app/lib/tribe-constants.js` — 21 tribes + assignTribeV3()
- `/app/lib/handlers/tribes.js` — Tribe + TribeAdmin handlers
- `/app/lib/handlers/events.js` — Stage 6 handler
- `/app/lib/handlers/board-notices.js` — Stage 7 handler
- `/app/lib/handlers/reels.js` — Stage 10 handler
- `/app/lib/handlers/stories.js` — Stage 9 handler
- `/app/lib/handlers/auth.js` — Registration (now with auto tribe assignment)
- `/app/lib/db.js` — All indexes (200+)
- `/app/app/api/[[...path]]/route.js` — Route dispatcher

## Next Tasks
1. Stage 12 Gold Freeze closure items (remaining: legacy House cleanup, post-cleanup health proof)
2. Stage 11: Scale / Reliability / Disaster Excellence
3. Stage 5 formal proof pack
4. Stage 4 test failures fix
