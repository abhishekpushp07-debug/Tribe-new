# Tribe — Product Requirements Document

## Product Vision
Build the world's best social media application for Indian college students.

## Tech Stack
- **Frontend**: Next.js (React)
- **Backend**: Next.js API Routes (monolithic)
- **Database**: MongoDB (95 collections)
- **Caching**: Redis (ioredis)
- **Media Storage**: Supabase Storage
- **Video Processing**: ffmpeg (HLS transcoding)
- **Testing**: pytest (121 tests, 100% pass rate)

## Architecture
- Central router: `/app/app/api/[[...path]]/route.js`
- Handlers: `/app/lib/handlers/` (22 handler files)
- Services: `/app/lib/services/` (6 service files)
- Cache layer: `/app/lib/cache.js`
- Feed ranking: `/app/lib/services/feed-ranking.js`
- Real-time: `/app/lib/realtime.js` (SSE via Redis Pub/Sub)
- Constants: `/app/lib/constants.js`

## Core Features (All Implemented — 435+ Endpoints)
1. Auth, Sessions, Token Rotation (access + refresh split)
2. Onboarding (age, college, profile, interests)
3. User profiles, settings, privacy, deactivation
4. Content (posts, polls, threads, carousels, drafts, scheduling)
5. Feeds (home, public, following, college, tribe, mixed, personalized)
6. Smart Feed Algorithm (multi-signal ranking)
7. Social interactions (like/dislike, save, share, hide, pin, archive)
8. Comments (threaded, likes, pin, edit, report)
9. Stories (24h expiry, 10 sticker types, reactions, highlights, close friends, SSE)
10. Reels (feeds, interactions, watch metrics, creator tools, series, duets, remixes)
11. Pages (CRUD, RBAC roles, follow, publishing, analytics, verification)
12. Events (CRUD, RSVP, reminders, moderation)
13. Tribes (21-tribe system, contests, seasons, salutes, governance)
14. Tribe Contests (full lifecycle, judging, voting, SSE live feeds)
15. Search (unified full-text, autocomplete, recent searches)
16. Hashtags (trending, feeds, stats)
17. Notifications (16 types, preferences, device push tokens)
18. Follow Requests (private accounts)
19. Analytics (overview, content, audience, reach, stories, reels)
20. Media upload (signed URLs, Supabase, HLS transcoding)
21. Board Notices, Authenticity Tags
22. College Claims & Discovery
23. Governance (board elections, proposals, voting)
24. Resources (study materials, voting, download tracking)
25. Content Distribution (3-stage pipeline)
26. Reports, Moderation & Appeals (auto + manual)
27. Content Quality Scoring (5-signal, 4-tier)
28. Content Recommendations
29. User Activity Status
30. Smart Suggestions
31. Blocks & Mutes
32. Anti-Abuse System
33. Redis Caching Layer (stampede protection, event-driven invalidation)
34. Admin & Ops (stats, abuse dashboard, health checks)

## Documentation Suite (DELIVERED)
| Document | Lines | Purpose |
|----------|-------|---------|
| `/app/API_DOCS.md` | 4,438 | Complete API reference (464 endpoints, 41 sections) |
| `/app/DATA_MODELS.md` | 1,082 | All 95 MongoDB collections with schemas & indexes |
| `/app/ANDROID_GUIDE.md` | 905 | Android/mobile integration guide (15 screens, auth/media/SSE flows) |
| `/app/CONSTANTS_REFERENCE.md` | 754 | All enums, error codes, config values, 21 tribes |
| `/app/FEATURE_SPECS.md` | 625 | Business logic, state machines, algorithms |
| **TOTAL** | **7,804** | **Complete frontend/Android handoff documentation** |

## Test Accounts
- Phone: `7777099001` / PIN: `1234`
- Phone: `7777099002` / PIN: `1234`

## What's Completed
- All 435+ backend API endpoints implemented and tested
- Redis caching layer integrated
- Smart Feed Algorithm with multi-signal ranking
- Complete pytest regression suite (121 tests, 100% pass rate)
- **World-class documentation suite (7,804 lines across 5 documents)**
- **Bug Fix (Feb 2026)**: Backend now honors `visibility` field from frontend for posts, reels, and story-to-post sharing. Added `HOUSE_ONLY`, `COLLEGE_ONLY`, `FOLLOWERS` to allowed visibility values. Fixed draft publish to restore intended visibility.
- **Tribe Competitions Improvement (Mar 2026)**:
  - Scoring engine pulls REAL content engagement from reels/posts/stories (likes, views, comments, saves, shares)
  - New `scoring_content_engagement_v1` model for content-based competitions
  - `story` added to entry types for contests
  - Content validation on entry submission (verifies contentId exists and belongs to user)
- **Rivalry System (Mar 2026)**:
  - Full tribe vs tribe rivalry lifecycle: create → contribute → resolve/cancel
  - Admin: POST /admin/tribe-rivalries, POST /admin/tribe-rivalries/:id/resolve|cancel
  - User: GET /tribe-rivalries, GET /tribe-rivalries/:id, POST /tribe-rivalries/:id/contribute
  - Engagement-based scoring from contributed reels/posts/stories
  - Salute prize awarded to winner on resolution
- **Salute/Cheer Enhancement (Mar 2026)**:
  - Enhanced POST /tribes/:id/cheer with salute ledger tracking and heroName in response
  - New POST /tribes/:id/salute for content-based salutes (rate limited: 10/hr)
  - Cheers/salutes auto-contribute to active rivalries
- **Badge: heroName from Tribe Data (Mar 2026)**:
  - `toTribeSnippet` now returns heroName, primaryColor, secondaryColor, cheerCount, totalSalutes
  - `toUserSnippet` includes tribeHeroName
  - Backfill on login for existing users missing tribeHeroName
  - New users get tribeHeroName at registration

- **Chunked Video Upload (Mar 2026)**:
  - POST /media/chunked/init → POST /media/chunked/:id/chunk (×N) → POST /media/chunked/:id/complete
  - Supports up to 200MB videos in chunks (2MB each recommended)
  - Progress tracking via GET /media/chunked/:id/status
  - 30-min session expiry, duplicate chunk detection, missing chunk validation
  - Legacy base64 limit bumped from 30MB → 50MB
  - Chunks auto-assembled and uploaded to Supabase/Object Storage

## Backlog
- Frontend UI development
- WebSocket real-time push notifications (P2)
- route.js refactoring (P3)
- A/B testing framework (P3)
- CDN integration for media delivery (P4)
