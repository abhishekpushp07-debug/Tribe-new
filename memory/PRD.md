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

### Stage 4B: Product-Domain Coverage — COMPLETE (90/100) — SCORECARD DELIVERED
- **296 total tests** (78 unit + 210 integration + 8 smoke)
- 10 product domains covered: Posts, Feed (4 surfaces), Social (like/dislike/save/comment/follow/reaction-remove), Events+RSVP, Resources+Voting, Notices (full CRUD+pin+college listing+ack list), Reels (feeds+interactions+comments+hide/not-interested/share), Visibility Safety, Cross-Surface Consistency
- 8 dedicated test users for WRITE rate-limit isolation (added reel_signal_user)
- 2x idempotent, full cleanup (20+ collections incl. reel_hidden, reel_not_interested, reel_shares)
- True Deep Audit Scorecard: `/app/memory/stage_4b_true_scorecard.md`
- P6 Notices+Reels improved from 7/10 to 9/10 by implementing 26 new tests covering update/delete/pin/unpin/college listing/ack list (notices) and comment list/hide/not-interested/share (reels)

## Upcoming Tasks

### Stage 5: Scalability Foundation Refactor (P1)
- Service/Repository layer separation
- handler.js → service.js → repository.js pattern

### Future Stages (P2-P3)
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
