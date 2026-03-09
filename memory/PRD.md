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

### Stage 4B: Product-Domain Coverage — COMPLETE (88/100)
- **270 total tests** (78 unit + 184 integration + 8 smoke)
- 10 product domains covered: Posts, Feed (4 surfaces), Social (like/dislike/save/comment/follow/reaction-remove), Events+RSVP, Resources+Voting, Notices+Ack, Reels, Visibility Safety, Cross-Surface Consistency
- 7 dedicated test users for WRITE rate-limit isolation
- 2x idempotent, full cleanup (20+ collections)

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
