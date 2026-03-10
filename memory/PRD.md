# Tribe — Product Requirements Document

## Original Problem Statement
Build the "Tribe" social media backend to world-best standard, targeting quality score >900/1000.
Executed through staged plan: Security → Observability → Testing → Scalability → Production.

## Architecture
- **Framework**: Monolithic Next.js API (backend-only)
- **Database**: MongoDB
- **Cache/Pub-Sub**: Redis (with in-memory fallback)
- **AI**: OpenAI GPT-4o-mini (moderation)
- **Storage**: Emergent Object Storage
- **Context**: AsyncLocalStorage for request lineage
- **Testing**: pytest (canonical runner) with JS bridge for unit tests

## Stage Completion Status

### Stage 2: Security Hardening — PASS (88/100)
- Access/refresh token system with replay detection
- Session management (list, revoke-one, revoke-all)
- Layered rate limiting (7 tiers, Redis-backed with Lua)
- Centralized input sanitization (XSS, payload size)

### Stage 3 + 3B: Observability — PASS (93/100)
- Structured JSON logging, request lineage, health checks, metrics, Redis resilience

### Stage 4A: Test Foundation — GOLD CLOSURE (87/100)
- 78 unit tests, JS eval bridge, CI gate, coverage baseline (96%), execution hooks

### Stage 4B: Product-Domain Coverage — COMPLETE (96/100) — SCORECARD DELIVERED
- **328 total tests** (78 unit + 242 integration + 8 smoke)
- 10 product domains covered with comprehensive lifecycle testing:
  - Posts (13), Feed 4 surfaces (18), Social 9/9 endpoints (29)
  - Events: CRUD + state machine (publish/cancel/archive) + RSVP + search + college feed (36)
  - Resources: CRUD + voting + search + download tracking (32)
  - Notices: CRUD + pin/unpin + college listing + acknowledgment list (26)
  - Reels: feeds + interactions + comments + hide/not-interested/share (25)
  - Visibility Safety (10), Cross-Surface Consistency (4), Smoke (4)
- 10 dedicated test users for WRITE rate-limit isolation
- 2x idempotent (328/328, 32.15s + 29.95s), full cleanup (20+ collections)
- True Deep Audit Scorecard: `/app/memory/stage_4b_true_scorecard.md`

### Stage 4C-P0A: Cross-Surface Entity Consistency — PERFECT (24/24)
- 5 entity domains: Posts (8), Events (6), Resources (4), Notices (3), Reels (3)
- Proves truth-field consistency across detail, feeds, search, college listings, cross-user reads
- Mutation→Read consistency for like, dislike, comment, RSVP, vote, acknowledge
- Delete/Remove consistency (404/410) across all entities
- 3 dedicated consistency users, full cleanup, idempotent (2x 352/352)
- Proof pack: `/app/memory/stage_4c_p0a_proof_pack.md`

### Stage 4C-P0B: Visibility + Permission Matrix — PERFECT (44/44)
- 5 dimensions: Anonymous (18), Age-Gate (5), Role-Gate (5), Ownership (7), Content-State (10)
- Anonymous: 7 read-allowed + 11 write-denied (401) across all entity types
- Age-gate: UNKNOWN→403, CHILD→text OK but media/reel/story→403 CHILD_RESTRICTED
- Role-gate: USER→403 notices, ADMIN→creates/deletes/pins
- Ownership: self-mutations OK, cross-user mutations→403, self-vote/like→403/400
- Content-state: REMOVED→404/410, HELD→absent from feeds, DRAFT→invisible to non-creator, CANCELLED→accessible
- Banned user→403 on login
- 4 dedicated users (permission_user_a/b, permission_admin), idempotent (2x 396/396)
- Proof pack: `/app/memory/stage_4c_p0b_proof_pack.md`

## In Progress

### Stage 4C: World-Class Product Consistency (P0) — Awaiting P0-C
- P0-A ✅ Cross-surface entity consistency (24 tests, PERFECT)
- P0-B ✅ Visibility + Permission Matrix (44 tests, PERFECT)
- P0-C ⬜ Moderation-State Exposure Rules
- P0-D ⬜ Counter and Aggregate Truth
- P0-E ⬜ Pagination/Cursor Correctness
- P0-F ⬜ Illegal State Transitions
- P1-A ⬜ Contract Hardening
- P1-B ⬜ Auditability / Request Lineage
- P1-C ⬜ Domain Matrix README

## Upcoming Tasks

### Stage 4D: Gold-Freeze / Launch-Readiness (P1)

### Stage 5: Scalability Foundation Refactor (P2)
- Service/Repository layer separation
- handler.js → service.js → repository.js pattern

### Future Stages (P3)
- Stage 6: Async Backbone + Job System + CQRS-lite
- Stage 10+: Production Hardening (separate test DB, TTL, Redis-backed metrics)

## Known Product Behaviors (Documented by Tests)
1. Following feed does NOT filter blocked users' posts (code gap)
2. Like handler does NOT check content visibility (removed content can be liked)
3. New posts have distributionStage=0, excluded from public/college/house feeds
4. Self-vote on resources returns 403, self-like reel returns 400
5. REMOVED notices return 410 Gone
6. Regular users cannot create board notices (403)
7. Duplicate same-direction vote on resources returns 409 CONFLICT
