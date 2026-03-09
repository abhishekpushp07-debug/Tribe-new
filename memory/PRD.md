# Tribe — Product Requirements Document

## Original Problem Statement
Build a world-best social media backend API targeting 900+/1000 quality score.
Multi-stage plan: 12 stages from Security to Production Hardening.

## Architecture
- **Framework**: Monolithic Next.js backend API
- **Database**: MongoDB (with 86 collections, 391 indexes)
- **Cache/PubSub**: Redis (optional, graceful degradation when unavailable)
- **Central Gateway**: `/app/api/[[...path]]/route.js`
- **Handlers**: `/app/lib/handlers/` (18 handler files)
- **Security**: `/app/lib/security.js` (rate limiting, sanitization, audit)
- **Observability**: `/app/lib/logger.js`, `/app/lib/metrics.js`, `/app/lib/health.js`

## Completed Stages

### Stage 2: Security & Session Hardening — PASS (88/100)
- Access/refresh token model with rotation and replay detection
- Full session management (list, revoke-one, revoke-all)
- 7 security headers on all responses
- Tiered rate limiting (per-IP + per-user)
- Centralized input sanitization (deep XSS stripping)
- Structured security audit logging with PII masking
- 7 admin/ops endpoints secured with ADMIN role

### Stage 3: Observability Baseline + Health Intelligence — PASS (91/100)
**Date**: 2026-03-09
- Structured JSON logger (NDJSON, 5 levels, 12+ categories, PII redaction)
- Request ID generation + propagation (x-request-id on every response)
- Access logging (method, route, status, latency, requestId, userId, IP)
- Three-tier health: /healthz (liveness), /readyz (readiness), /ops/health (deep)
- Redis-backed rate limiting with Lua script + per-tier fallback policies
- In-memory metrics: request counts, latency histogram, p50/p95/p99, error rates
- SLI dashboard (/ops/slis): errorRate, latency percentiles, dep failure counts
- Unified canonical audit pipeline (merged writeAudit + writeSecurityAudit)
- All 7 empty catch blocks fixed with structured error logging
- Zero raw console.* on active request paths (2 documented bootstrap exceptions)

## Key Endpoints

### Public (no auth)
- GET /api/healthz — Liveness probe (runs before rate limiting + DB)
- GET /api/readyz — Readiness probe (checks MongoDB + Redis)

### Admin Only
- GET /api/ops/health — Deep dependency health (mongodb, redis, rateLimiter, moderation, storage, audit)
- GET /api/ops/metrics — Full observability metrics + business counts
- GET /api/ops/slis — SLI dashboard (error rate, p50/p95/p99 latency)
- GET /api/ops/backup-check — Database backup readiness check

## Known Limitations (Exception Register)
1. Metrics are in-memory only (per-instance). Redis-backed deferred to Stage 10.
2. Rate limiting falls back to in-memory when Redis is down. STRICT tiers use 50% limits.
3. 2 console.log statements in realtime.js startup (documented bootstrap exception).
4. ioredis unhandled error events from cache.js/realtime.js (pre-existing).
5. No OpenTelemetry (overkill for monolith; requestId provides correlation).
6. Legacy token-in-URL pattern in stories.js (noted in Stage 2).

## Key Files
- `/app/lib/logger.js` — Structured JSON logger
- `/app/lib/metrics.js` — In-memory metrics collector
- `/app/lib/health.js` — Three-tier health checks
- `/app/lib/security.js` — Rate limiting, sanitization, canonical audit
- `/app/app/api/[[...path]]/route.js` — Central gateway with observability wrapper
- `/app/lib/auth-utils.js` — Token/session logic, writeAudit wrapper
- `/app/lib/db.js` — MongoDB connection + indexes

## Prioritized Backlog

### P0: Next Up
- **Stage 4**: Test Pyramid + CI Gate v1 (unit/integration tests)

### P1: Planned
- **Stage 5**: Scalability Foundation Refactor (service/repository layers)
- **Stage 6**: Async Backbone + Job System + CQRS-lite
- **Stage 7**: Real-Time Reliability Layer

### P2: Future
- **Stage 8**: Moderation v2
- **Stage 9**: Feature Depth (Pages, Push Notifications, DMs)
- **Stages 10-12**: Production Hardening, Load/Chaos Testing, Final 900+ Gate
