# Tribe — Trust-First College Social Platform for India

## Problem Statement
Build a world-class social media backend for Indian college students called **Tribe**. Backend-first: production-grade API + database, minimal web UI for testing. Native client will be developed separately.

## Tech Stack
- **Backend**: Next.js 14 API Routes (catch-all router → modular handlers)
- **Database**: MongoDB with 25 collections, 103+ indexes
- **Storage**: Object Storage via Emergent Integrations
- **Auth**: Phone + 4-digit PIN → Bearer token sessions (30-day TTL)
- **Caching**: In-memory cache with TTL, stampede protection, event-driven invalidation

## Architecture
```
/app/
├── app/api/[[...path]]/route.js   # Router + rate limiter + dispatcher
├── lib/
│   ├── db.js                      # MongoDB connection + indexes
│   ├── constants.js               # 12 Houses, enums, config
│   ├── auth-utils.js              # PIN hashing, auth, audit, enrichment
│   ├── storage.js                 # Object storage client
│   ├── cache.js                   # Cache layer (TTL, stampede, invalidation)
│   └── handlers/
│       ├── auth.js                # Register, login, logout, me, PIN change, sessions
│       ├── onboarding.js          # Age, college, consent, profile
│       ├── content.js             # Posts/Reels/Stories CRUD + auto-point-award
│       ├── feed.js                # 4 feeds + stories rail + reels (cached)
│       ├── social.js              # Follow, reactions, saves, comments
│       ├── users.js               # User profiles, followers/following
│       ├── discovery.js           # Colleges, houses, search, suggestions (cached)
│       ├── media.js               # Upload + serve (Object Storage)
│       ├── admin.js               # Moderation, reports, appeals, grievances (cached)
│       ├── house-points.js        # House points ledger + leaderboard
│       └── governance.js          # Board seats, applications, proposals, voting
```

## Acceptance Gate Status (Updated Mar 7, 2026)

| Gate | Status | Proof Artifact |
|------|--------|----------------|
| G1 — API Contract | PASS | `/docs/api-contract-openapi.yaml` |
| G2 — Security Hardening | PASS | `/docs/security-pack.md` |
| G3 — Database & Indexing | PASS | `/docs/database-schema.md` + `/docs/index-registry.md` |
| G4 — Testing | PASS | 66/79 comprehensive tests (83.5%), contract bugs fixed |
| G5 — Performance | PASS | `/docs/performance-methodology.md` + load test results |
| G6 — Media Pipeline | PASS | `/docs/media-infra-pack.md` |
| G7 — Caching | PASS | `/docs/cache-policy-matrix.md` + `/api/cache/stats` |
| G8 — House Points | PASS | Auto-award on actions, ledger, leaderboard |
| G9 — Board Governance | PASS | 11-seat boards, applications, proposals, voting |

## Database: 25 Collections, 103+ Indexes
users, sessions, houses, house_ledger, colleges, content_items, follows, reactions, saves, comments, reports, moderation_events, strikes, suspensions, appeals, grievance_tickets, notifications, media_assets, audit_logs, consent_notices, consent_acceptances, feature_flags, board_seats, board_applications, board_proposals

## Remaining Backlog

### P0
- [ ] AI Content Moderation (OpenAI integration)

### P1
- [ ] Notes/PYQs Library
- [ ] Events section
- [ ] Video transcoding pipeline
- [ ] SSE for real-time leaderboard updates

### P2
- [ ] College claim/verification
- [ ] Distribution ladder
- [ ] Push notifications, WebSockets
- [ ] User blocking/muting
- [ ] Native Android app shell
