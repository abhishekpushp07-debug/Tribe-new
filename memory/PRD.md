# Tribe — Trust-First College Social Platform for India

## Problem Statement
Build a world-class social media app for Indian college students called **Tribe**. Instagram-like UX with trust, safety, and governance at its core.

## Core Differentiators
- **Official College Graph**: 1366+ colleges seeded from AISHE/UGC data
- **12-House System**: Deterministic SHA256 assignment at signup, permanent, cross-college
- **Community Governance**: 11-member boards per college with proposal-based powers
- **Safety & Compliance**: DPDP-aware, IT Rules compliant, age-gating, SLA-driven grievances

## Tech Stack
- **Frontend**: Next.js 14 + shadcn/ui + Tailwind (mobile-first web, demo only)
- **Backend**: Next.js API Routes (catch-all router → modular handlers)
- **Database**: MongoDB with 25+ collections, comprehensive indexes
- **Auth**: Phone + 4-digit PIN → Bearer token sessions (30-day TTL)
- **Target**: Backend API designed for native Android app integration

## Architecture
```
/app/
├── app/api/[[...path]]/route.js   # Clean router + dispatcher
├── lib/
│   ├── db.js                      # MongoDB connection + indexes
│   ├── constants.js               # 12 Houses, enums, config
│   ├── auth-utils.js              # PIN hashing, auth, audit, enrichment
│   ├── api.js                     # Frontend API client
│   └── handlers/
│       ├── auth.js                # Register, login, logout, me
│       ├── onboarding.js          # Age, college, consent, profile
│       ├── content.js             # Posts/Reels/Stories CRUD
│       ├── feed.js                # 4 feeds + stories rail + reels
│       ├── social.js              # Follow, reactions, saves, comments
│       ├── users.js               # User profiles, followers/following
│       ├── discovery.js           # Colleges, houses, search, suggestions
│       ├── media.js               # Upload + serve
│       └── admin.js               # Moderation, reports, appeals, grievances, legal, admin
```

## What's Implemented (Phase 1-3) — Mar 7, 2026

### Phase 1: Foundation ✅
- [x] MongoDB with 25+ collections, 50+ indexes
- [x] Phone + PIN auth (PBKDF2 100K iterations, timing-safe compare)
- [x] JWT-style Bearer token sessions with 30-day TTL
- [x] RBAC roles: USER, MODERATOR, ADMIN, SUPER_ADMIN
- [x] In-memory rate limiting (120 req/min per IP)
- [x] Audit logging on all mutations
- [x] Health endpoints: /healthz, /readyz
- [x] Consistent error format: `{ error, code }` with proper HTTP codes

### Phase 2: Onboarding + Houses ✅
- [x] Age capture → ADULT/CHILD classification
- [x] DPDP child protections (no media, no personalization, no targeted ads)
- [x] College selection from 1366+ real institutions
- [x] DPDP consent flow with version tracking
- [x] **12 House System** — deterministic SHA256(userId) mod 12
  - Aryabhatta, Chanakya, Veer Shivaji, Saraswati, Dhoni, Kalpana, Raman, Rani Lakshmibai, Tagore, APJ Kalam, Shakuntala, Vikram
- [x] Profile management (displayName, username, bio)

### Phase 3: Social Core ✅
- [x] Content creation: POST, REEL, STORY kinds
- [x] Stories with 24h TTL auto-expiry (MongoDB TTL index)
- [x] **4 Feed Types**: Public, Following, College, House
- [x] Story rail grouped by author
- [x] Reels dedicated feed
- [x] Cursor-based pagination on all feeds
- [x] Follow/unfollow with counter management
- [x] Like + internal-only dislike (dislike hidden from public)
- [x] Save/unsave bookmarks
- [x] Comments with threaded replies (parentId)
- [x] Notifications for follow, like, comment (actor-enriched)
- [x] Notification read/unread management
- [x] Content reporting with duplicate prevention
- [x] Auto-hold on 3+ reports
- [x] Moderation queue (held/reports/appeals buckets)
- [x] Strike system with auto-suspend at 3 strikes
- [x] Appeals system
- [x] Grievance tickets with SLA timers (3h legal, 72h general)
- [x] Media upload (image/video as base64, age-gated)
- [x] Global search (users, colleges, houses)
- [x] Smart user suggestions (same college > same house > popular)
- [x] House leaderboard
- [x] Admin stats dashboard

## API Endpoints (50+)
See `/api/` root endpoint for full map.

## Database Collections
users, sessions, houses, house_ledger, colleges, content_items, follows, reactions, saves, comments, reports, moderation_events, strikes, suspensions, appeals, grievance_tickets, notifications, media_assets, audit_logs, consent_notices, consent_acceptances, feature_flags

## Testing Status
- **Smoke test**: 28/28 pass (100%) — `/scripts/smoke-test.sh`
- **Comprehensive test**: 59/63 pass (93.7%) — 4 "failures" are field-name expectations by test agent, all verified working
- **Brute force test**: PASS — 5 wrong → 401, 6th → 429, correct PIN while locked → 429
- **Session management test**: PASS — revocation, PIN change, list sessions
- **IDOR test**: PASS — /users/:otherId/saved → 403
- **DPDP child test**: PASS — media/reels/stories blocked, text posts allowed
- Full acceptance report: `/docs/acceptance-report.md`

## Documentation Artifacts
- OpenAPI 3.1 spec: `/docs/openapi.yaml`
- Error catalog: `/docs/error-catalog.md`
- Permission matrix: `/docs/permission-matrix.md`
- State machines (9): `/docs/state-machines.md`
- Auth flow: `/docs/auth-flow.md`
- Database schema: `/docs/database-schema.md`
- DB explain plans: `/docs/db-explain-plans.md`
- Security pack: `/docs/security-pack.md`
- Production readiness: `/docs/production-readiness.md`
- Benchmark results: `/docs/benchmark-results.txt`
- Acceptance report: `/docs/acceptance-report.md`

## Performance (p50/p95 at 20 iterations)
- Feed endpoints: 15-19ms p50, 73-85ms p95
- Auth/me: 18ms p50, 79ms p95
- Login: 112ms p50 (PBKDF2 100K iterations intentional)
- College search: 20ms p50, 107ms p95 (1366 colleges)
- Content CRUD: 16ms p50, 72-77ms p95

## Backlog

### P0 — Next
- [ ] Video Reels & Stories: actual video upload + playback pipeline
- [ ] Object storage migration (base64 → proper file storage)

### P1
- [ ] OpenAI content moderation integration (omni-moderation-latest)
- [ ] Board Governance system (11-member boards, proposals)
- [ ] House Points ledger + earning mechanics
- [ ] Notes/PYQs Library
- [ ] Events section

### P2
- [ ] College claim/verification workflow
- [ ] Distribution ladder (Stage 0→1→2 earned virality)
- [ ] Synthetic content labeling enforcement
- [ ] PWA manifest + service worker
- [ ] Native Android app shell (React Native/Flutter)
