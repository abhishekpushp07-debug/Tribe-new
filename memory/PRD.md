# Tribe — Product Requirements Document

## Problem Statement
World-class social media backend for Indian college students, named **Tribe**. Features 21 tribes (Param Vir Chakra awardees), college verification, content distribution ladder, stories, reels, events, board notices, governance, and a full contest engine.

Target: Backend quality score 900+/1000 across 10 parameters.

## Architecture
- **Backend**: Monolithic Next.js API (all routes under `/api/*`)
- **Database**: MongoDB (60+ collections, 200+ indexes)
- **Cache/PubSub**: Redis (with in-memory fallback)
- **Real-time**: Server-Sent Events (SSE) via Redis Pub/Sub
- **Content Moderation**: OpenAI GPT-4o-mini
- **Storage**: Emergent Object Storage (with base64 fallback)

## Completed Stages

| Stage | Name | Status | Date |
|-------|------|--------|------|
| 0 | Auth & Core | DONE | — |
| 1 | Appeal Decision | DONE | — |
| 2 | College Claims | DONE | — |
| 4 | Distribution Ladder | DONE (2 test failures) | — |
| 5 | Notes/PYQs Library | DONE (needs formal proof pack) | — |
| 6 | Events + RSVP | DONE | — |
| 7 | Board Notices + Authenticity | DONE | — |
| 9 | Stories (full) | DONE | — |
| 10 | Reels (full) | DONE | — |
| 12 | Tribe System | DONE | — |
| 12X | Tribe Contest Engine | GOLD FROZEN (69/69 tests) | — |
| 12X-RT | Real-Time SSE Layer | GOLD FROZEN | — |
| B0 | Backend Source of Truth Freeze | COMPLETE (8/8 sub-stages) | 2026-02 |
| B0-E | Backend Freeze Code Enforcement | COMPLETE (85/85 tests) | 2026-03 |
| **S1** | **Canonical Contract Freeze v2** | **COMPLETE (51/51 tests, 100%)** | **2026-03** |
| **S1B** | **Semantic Contract Completion** | **COMPLETE (8/8 tests, 100%)** | **2026-03** |
| **S2** | **Security & Session Hardening** | **COMPLETE (87/100, 8 exceptions documented)** | **2026-03** |


## Stage S2 — Security & Session Hardening (COMPLETED)

Goal: Harden identity/session/security foundation. Score 75 → 87.

### What was done:
1. **Access + Refresh Token Split**: 15-min access tokens (`at_` prefix), 30-day refresh tokens (`rt_` prefix)
2. **Refresh Token Rotation**: `POST /auth/refresh` with family tracking and replay/reuse detection (entire family revoked on reuse)
3. **Session Inventory**: List/revoke-one/revoke-all with IP, device, lastAccessed metadata. Max 10 concurrent sessions.
4. **PIN Change Hardening**: Revokes ALL sessions, issues fresh token pair
5. **Security Headers**: 7 headers on ALL responses (HSTS, X-Frame-Options, CSP, etc.)
6. **Tiered Rate Limiting**: 7 tiers (AUTH 10/min, WRITE 30/min, READ 120/min, ADMIN 60/min, etc.)
7. **Privileged Route Hardening**: 7 previously unprotected routes fixed (/ops/health, /ops/metrics, /ops/backup-check, /cache/stats, /admin/colleges/seed, /moderation/config, /moderation/check)
8. **Security Audit Logging**: Structured events with severity, PII masking, actor/target attribution
9. **Input Sanitization**: Script blocks, event handlers, js: protocol stripped
10. **Migration-safe**: Legacy tokens still work, backward-compat `token` field preserved

### Files created/modified:
- **NEW**: `/app/lib/security.js` — Rate limiting, security headers, sanitization, audit logging, PII masking
- **NEW**: `/app/memory/freeze/S2-security-session-hardening.md` — Full audit + proof pack
- **MODIFIED**: `/app/lib/auth-utils.js` — createSession, rotateRefreshToken, dual-mode authenticate
- **MODIFIED**: `/app/lib/constants.js` — 6 new ErrorCodes, 3 new Config values
- **MODIFIED**: `/app/lib/handlers/auth.js` — Refresh endpoint, revoke-one, enhanced PIN change, audit logging
- **MODIFIED**: `/app/lib/handlers/admin.js` — Protected /admin/colleges/seed
- **MODIFIED**: `/app/app/api/[[...path]]/route.js` — Security headers, tiered rate limiting, protected ops/mod routes

### Exceptions (8 documented):
1. In-memory rate limiting (Redis in S3)
2. Per-user post-auth rate limiting partial (IP-only pre-auth)
3. No auto-invalidation on role downgrade (role checked per-request)
4. CDN/proxy header conflict (infrastructure issue)
5. Reuse detection window limited to 5 tokens
6. No explicit blacklist (session deletion = effective blacklist)
7. No phone verification at registration (OTP in S9)
8. Login brute force in-memory (Redis in S3)

### Scorecard: 87/100


## Stage S1B — Semantic Contract Completion (COMPLETED)

Goal: Complete the hard semantic work Stage 1A left unfinished.

### What was done:
1. **Naming Discipline**: `authorId`/`creatorId` split documented and frozen. Viewer state unified with `viewer*` prefix aliases (`viewerIsFollowing`, `viewerRsvp`).
2. **Entity Snippets**: 6 canonical snippets defined in `/lib/entity-snippets.js` (UserSnippet, UserProfile, MediaObject, CollegeSnippet, TribeSnippet, ContestSnippet). `toUserSnippet()` adopted in `enrichPosts()`.
3. **Visibility Model**: 2-dimension semantic model (lifecycle + moderation) documented per content type. No fake enum unification.
4. **Versioning Architecture**: Header-based versioning with rationale, deprecation policy, compatibility windows.
5. **Duplicate Map**: 11 endpoints classified (CANONICAL/LEGACY/SHADOW) with migration decisions.
6. **Frontend Impact**: Per-surface dependency matrix with risk ratings. Zero breaking changes confirmed.

### Files created/modified:
- **NEW**: `/app/lib/entity-snippets.js` — 6 canonical snippet builders
- **NEW**: `/app/memory/freeze/S1B-semantic-contract-completion.md` — Full audit + spec
- **MODIFIED**: `/app/lib/auth-utils.js` — enrichPosts uses toUserSnippet
- **MODIFIED**: `/app/lib/handlers/users.js` — viewerIsFollowing alias
- **MODIFIED**: `/app/lib/handlers/social.js` — viewerIsFollowing alias
- **MODIFIED**: `/app/lib/handlers/events.js` — viewerRsvp alias

### Combined Stage 1 Score: ~86/100

## Stage S1 — Canonical Contract Freeze v2 (COMPLETED)

Goal: Push API Design score from 82 to 90+.

### What was done:
1. **Error Code Centralization**: All 18 handler files converted from raw string error codes to `ErrorCode.*` constants. Registry expanded from 12 to 36 codes.
2. **List Response Standardization**: Every list endpoint now includes canonical `items` key + `pagination` metadata object alongside backward-compat aliases.
3. **Pagination Discipline**: All cursor endpoints include `{ nextCursor, hasMore }` in `pagination`. All offset endpoints include `{ total, limit, offset, hasMore }`.
4. **Contract Version**: `x-contract-version: v2` header on every response.
5. **Response Contract Builders**: `/lib/response-contracts.js` defines `cursorList()`, `offsetList()`, `simpleList()`, `mutationOk()`.
6. **Zero breaking changes**: All additions are additive. Legacy field names preserved.

### Files created/modified:
- **NEW**: `/app/lib/response-contracts.js` — Canonical response builder helpers
- **NEW**: `/app/memory/freeze/S1-contract-freeze-v2.md` — Full audit + freeze spec
- **MODIFIED**: `/app/lib/constants.js` — ErrorCode expanded to 36 codes
- **MODIFIED**: `/app/lib/freeze-registry.js` — CONTRACT_VERSION bumped to v2
- **MODIFIED**: `/app/app/api/[[...path]]/route.js` — v2 header in response builders
- **MODIFIED**: All 18 handlers in `/app/lib/handlers/` — Error codes + list standardization

## 12-Stage Plan to 900+ Score

| Stage | Target Parameter | Current | Target | Status |
|-------|-----------------|---------|--------|--------|
| **S1** | **API Design** | **82** | **90+** | **✅ DONE** |
| **S2** | **Security** | **75** | **86-88** | **✅ DONE (87)** |
| S3 | Production Readiness (baseline) | 55 | 70 | NEXT |
| S4 | Testing | 72 | 84-86 | PLANNED |
| S5 | Scalability Foundation | 60 | 78-80 | PLANNED |
| S6 | Async/CQRS | 80 | 88 | PLANNED |
| S7 | Real-Time | 78 | 88-90 | PLANNED |
| S8 | Moderation v2 | 85 | 91-92 | PLANNED |
| S9 | Feature Depth (Pages, Push, DMs) | 88 | 92+ | PLANNED |
| S10 | Production Hardening | 78 | 90+ | PLANNED |
| S11 | Load/Chaos/Concurrency | 86 | 92 | PLANNED |
| S12 | Final 900+ Gate | — | 900+ | PLANNED |

## Pending Issues (P2)
1. Stage 4: 2 automated test failures (Distribution Ladder)
2. Stage 5: Needs formal deep proof pack for acceptance

## Key Documents
- `/app/memory/freeze/B0-MASTER-INDEX.md` — Master freeze index
- `/app/memory/freeze/S1-contract-freeze-v2.md` — Stage 1 contract audit + spec
- `/app/memory/freeze/S2-security-session-hardening.md` — Stage 2 security audit + proof pack
- `/app/memory/android_agent_handoff.md` — Complete API reference for Android
- `/app/memory/freeze/B0-S1-domain-freeze.md` through `B0-S8-*` — Full freeze package
- `/app/lib/response-contracts.js` — Canonical response builders
- `/app/lib/security.js` — Security module (rate limiting, headers, sanitization, audit)
- `/app/lib/constants.js` — Centralized ErrorCode registry (42 codes)
