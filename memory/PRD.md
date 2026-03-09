# Tribe — Product Requirements Document

## Original Problem Statement
Build a world-best social media backend API targeting 900+/1000 quality score.
Multi-stage plan: 12 stages from Security to Production Hardening.

## Architecture
- **Framework**: Monolithic Next.js backend API
- **Database**: MongoDB (86 collections, 391+ indexes)
- **Cache/PubSub**: Redis (optional, graceful degradation when unavailable)
- **Central Gateway**: `/app/api/[[...path]]/route.js`
- **Handlers**: `/app/lib/handlers/` (18 handler files)
- **Security**: `/app/lib/security.js` (Redis-backed rate limiting, sanitization, canonical audit)
- **Observability**: `/app/lib/logger.js`, `/app/lib/metrics.js`, `/app/lib/health.js`
- **Correlation**: `/app/lib/request-context.js` (AsyncLocalStorage for end-to-end request lineage)

## Completed Stages

### Stage 2: Security & Session Hardening — PASS (88/100)
- Access/refresh token model with rotation and replay detection
- Full session management (list, revoke-one, revoke-all)
- 7 security headers on all responses
- Tiered rate limiting (per-IP + per-user)
- Centralized input sanitization (deep XSS stripping)
- Structured security audit logging with PII masking
- 7 admin/ops endpoints secured with ADMIN role

### Stage 3 + 3B: Observability Baseline + Gold Remediation — PASS (93/100)
**Initial audit**: 14/100 → **Stage 3**: 81.7 → **Stage 3B**: 91.6 → **Final independent audit**: 93/100

#### Stage 3B fixes (Gold Remediation):
- **AsyncLocalStorage request lineage**: requestId, ip, route, method auto-propagated to all audit writes (DB-verified: 10+ entries with non-null requestId)
- **Error code metrics**: metrics.recordError() wired to real traffic (UNAUTHORIZED, NOT_FOUND, RATE_LIMITED tracked)
- **OPTIONS observability**: CORS preflight now gets requestId + access log + metrics
- **Redis reconnect**: Bounded backoff (1s→30s, max 10 retries) replaces permanent degradation
- **Zero bare catches**: All empty catch blocks replaced with structured logging
- **Honest proof pack**: DB count proofs, negative proofs, complete exception register

#### Core features (Stage 3):
- Structured JSON logger (NDJSON, 5 levels, 12+ categories, PII redaction)
- Request ID on every response (x-request-id header)
- Access logging (method, route, status, latency, requestId, userId, IP, errorCode)
- Three-tier health: /healthz (liveness), /readyz (readiness), /ops/health (deep)
- Redis-backed rate limiting with Lua script + per-tier fallback policies
- In-memory metrics: request counts, latency histogram, p50/p95/p99, error rates
- SLI dashboard (/ops/slis)
- Unified canonical audit pipeline (PII masking, auto-context)

## Key Files
- `/app/lib/request-context.js` — AsyncLocalStorage correlation
- `/app/lib/logger.js` — Structured JSON logger
- `/app/lib/metrics.js` — In-memory metrics collector
- `/app/lib/health.js` — Three-tier health checks
- `/app/lib/security.js` — Rate limiting, sanitization, canonical audit
- `/app/app/api/[[...path]]/route.js` — Central gateway with observability wrapper
- `/app/lib/auth-utils.js` — Token/session logic, writeAudit wrapper

## Known Limitations
1. Metrics are in-memory only (per-instance). Redis-backed deferred to Stage 10.
2. 1995 legacy audit entries lack requestId/category (forward-only migration).
3. Redis reconnect not live-tested (no Redis in test env).
4. ioredis unhandled error spam from cache.js/realtime.js (pre-existing).
5. 2 console.log [Bootstrap] in realtime.js (documented exception).
6. No startup probe, no event loop lag metric (deferred to Stage 10).

## Prioritized Backlog

### P0: Next Up
- **Stage 4**: Test Pyramid + CI Gate v1

### P1: Planned
- **Stage 5**: Scalability Foundation Refactor
- **Stage 6**: Async Backbone + Job System + CQRS-lite
- **Stage 7**: Real-Time Reliability Layer

### P2: Future
- **Stage 8**: Moderation v2
- **Stage 9**: Feature Depth (Pages, Push Notifications, DMs)
- **Stages 10-12**: Production Hardening, Load/Chaos Testing, Final 900+ Gate
