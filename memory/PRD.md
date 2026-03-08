# Tribe — Trust-First Social Platform for Indian College Students

## Vision
World-class social media backend for Indian college students, built stage-by-stage with proof-based acceptance.

## Core Architecture
- **Backend**: Monolithic Next.js API
- **Database**: MongoDB (49+ collections, 170+ indexes)
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
| **12** | **21-Tribe System (Safe Cutover)** | **PROOF DELIVERED** | **19/21 auto + 28/28 IXSCAN** |
| 8 | OTP Challenge Flow | REMOVED | User request |
| 11 | Scale/Reliability Excellence | UPCOMING | — |

## Stage 12: Canonical 21-Tribe System — Summary

### Architecture
- **14 new collections**: tribes, user_tribe_memberships, tribe_assignment_events, tribe_boards, tribe_board_members, tribe_seasons, tribe_contests, tribe_contest_entries, tribe_contest_results, tribe_salute_ledger, tribe_standings, tribe_awards, tribe_fund_accounts, tribe_fund_ledger
- **30 new indexes** (28/28 IXSCAN verified)
- **17+ API endpoints** across public, user, and admin routes

### 21 Param Vir Chakra Tribes
Somnath (Lion), Jadunath (Tiger), Piru (Panther), Karam (Wolf), Rane (Rhino), Salaria (Falcon), Thapa (Snow Leopard), Joginder (Bear), Shaitan (Eagle), Hamid (Cobra), Tarapore (Bull), Ekka (Jaguar), Sekhon (Hawk), Hoshiar (Bison), Khetarpal (Stallion), Bana (Mountain Wolf), Parameswaran (Black Panther), Pandey (Leopard), Yadav (Iron Tiger), Sanjay (Honey Badger), Batra (Phoenix Wolf)

### Phased Cutover Status
- **12A: Canonical Tribe Registry** — DONE (21 tribes seeded)
- **12B: Canonical Membership** — DONE (user_tribe_memberships with unique constraint)
- **12C: Assignment Engine** — DONE (assignTribeV3, idempotent, race-safe)
- **12D: Migration Bridge** — DONE (admin/tribes/migrate endpoint)
- **12E: Hard Cutover** — READY (new system is source of truth)
- **12F: Legacy Cleanup** — PENDING (old house system still exists, removable after user approval)
- **12G: Tribe Board Governance** — DONE (7 roles, configurable)
- **12H: Contest Backbone** — DONE (seasons, contests, resolution)
- **12I: Salute Ledger** — DONE (append-only, reversal support)
- **12J: Standings + Awards** — DONE ("Emerald Tribe of the Year")
- **12K: Fund Accounting** — DONE (configurable prize, fund accounts, ledger)

### Key Features
- Deterministic tribe assignment (SHA-256 hash of userId mod 21)
- Admin reassignment with full audit trail
- Batch migration from legacy house system
- Season → Contest → Resolve → Salute → Standings → Award pipeline
- Configurable prize fund (default INR 10,00,000)
- Append-only salute ledger (source of truth for standings)
- Fund accounting with credit on award resolution

## Key Files
- `/app/lib/tribe-constants.js` — 21 tribes + assignTribeV3()
- `/app/lib/handlers/tribes.js` — Tribe + TribeAdmin handlers
- `/app/lib/handlers/events.js` — Stage 6 handler
- `/app/lib/handlers/board-notices.js` — Stage 7 handler
- `/app/lib/handlers/reels.js` — Stage 10 handler
- `/app/lib/handlers/stories.js` — Stage 9 handler
- `/app/lib/db.js` — All indexes
- `/app/app/api/[[...path]]/route.js` — Route dispatcher

## Proof Packs
- `/app/memory/stage_10_deep_proof_pack.md`
- `/app/memory/stage_6_7_deep_proof_pack.md`

## Next Tasks
1. User verdict on Stage 12
2. Phase 12F: Legacy house cleanup (after approval)
3. Stage 11: Scale / Reliability / Disaster Excellence
