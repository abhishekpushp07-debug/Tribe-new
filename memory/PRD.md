# Tribe — Product Requirements Document

## Original Problem Statement
Build a "world-best" social media backend for "Tribe" — a campus-community social media platform. The backend is ~95% feature-complete with ~266 routes across 21 domains. The project follows a staged plan (B0-B8) focusing on documentation, identity fixes, permissions, new features, and hardening.

## Core Architecture
- **Framework**: Next.js App Router (monolithic API)
- **Database**: MongoDB
- **Auth**: Phone+PIN, JWT (access+refresh tokens with rotation)
- **Handler Files**: 16 active handler files in `/app/lib/handlers/`
- **Router**: Single catch-all `[[...path]]/route.js` dispatcher (632 lines)
- **Testing**: pytest (396 tests passing)
- **3rd Party**: Redis (rate limiting), OpenAI GPT-4o-mini (moderation), Emergent Object Storage (media)

## Completed Stages

### Stage B0: API Contract & Truth Bridge ✅ (2026-03-10)
All 12 sub-stages completed:
- **B0.1**: Route Census — 266 live routes catalogued across 21 domains
- **B0.2**: Domain Classification — screen mapping, cross-domain tags
- **B0.3**: Auth & Actor Matrix — per-endpoint auth behavior documented
- **B0.4**: Request Contracts — exact request body specs for all write endpoints
- **B0.5**: Response Contracts — canonical shared objects (UserSnippet, MediaObject, etc.)
- **B0.6**: Error Contracts — error codes, status patterns, edge cases
- **B0.7**: Pagination & Streams — cursor/offset per endpoint, SSE contract
- **B0.8**: Quirk Ledger — 17 non-obvious gotchas documented
- **B0.9**: API_REFERENCE.md — master reference document
- **B0.10**: Machine manifests (route_manifest.json, route_inventory_raw.json)
- **B0.11**: Drift governance rules
- **B0.12**: Freeze package with known unknowns

**Deliverables**: 15 files in `/app/memory/contracts/` + `/app/memory/API_REFERENCE.md`

### Earlier Stages (Pre-B0)
- Stages 1-9 of original development plan completed
- 396 tests passing (78 unit + 242 integration + 8 smoke + 68 consistency/permission)

## Prioritized Backlog

### P0: Stage B1 — Canonical Identity, Avatar & Media Resolution
- Fix avatar URLs (raw mediaId → resolved URL)
- Standardize UserSnippet shape across all endpoints
- Standardize MediaObject resolution

### P1: Stage B2 — Visibility, Permission & Feed Safety
- Enforce content visibility rules (PUBLIC/FOLLOWERS/LIMITED) across feeds
- Fix following feed to show FOLLOWERS-only content

### P1: Stage B3 — Pages System
- Build Instagram/Facebook-style "Pages" from scratch
- ~15 new endpoints for CRUD, roles, posting-as-page, feed integration

### P2: Stage B4 — Core Social Gaps
- ~8 missing endpoints: edit post, share post, like comment, explore feed, trending hashtags, notification device registration

### P2: Stage B5 — Discovery, Search & Hashtag Engine
- Hashtag extraction from captions
- Post content search indexing
- Fix broken post search

### P2: Stage B6 — Notifications 2.0 + Reel/Post Polish
- Fix reel comment/report 400 bugs
- Notification grouping and preferences

### P3: Stage B7 — Test Hardening + Gold Freeze
- Scale test coverage to 900+

### P4: Stage B8 — Infra, Observability, Scale Path
- 3-layer refactor
- Separate test DB
- Job queues, Redis caching
- Audit log TTL

## Known Issues
1. Avatar returns raw media ID, not URL (B1)
2. Post search not working (B5)
3. Reel comment/report return 400 (B6)
4. Visibility field not fully enforced in feeds (B2)
5. Dead code: house-points.js (16 files active, 1 dead)
6. Dead code: stages.js lines 2247-2623
