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
| **S1** | **Canonical Contract Freeze v2** | **COMPLETE (16/16 tests)** | **2026-03** |

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
| S2 | Security | 75 | 86-88 | NEXT |
| S3 | Production Readiness (baseline) | 55 | 70 | PLANNED |
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
- `/app/memory/android_agent_handoff.md` — Complete API reference for Android
- `/app/memory/freeze/B0-S1-domain-freeze.md` through `B0-S8-*` — Full freeze package
- `/app/lib/response-contracts.js` — Canonical response builders
- `/app/lib/constants.js` — Centralized ErrorCode registry (36 codes)
