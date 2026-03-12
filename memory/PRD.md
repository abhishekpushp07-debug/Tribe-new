# Tribe — Product Requirements Document
**Version**: 9.0
**Last Updated**: 2026-03-12

## Problem Statement
Build a world-best social media backend for "Tribe" — a college-centric social platform with Posts, Reels, Stories, and Pages.

## Core Architecture
- **Application**: Next.js 14 monolithic API with Service-Oriented Architecture
- **Database**: MongoDB (local) with 80+ indexes
- **Cache**: Redis (ioredis) with in-memory fallback, 20+ namespaces
- **Media Storage**: Supabase Storage
- **Video Processing**: ffmpeg (HLS transcoding)
- **Auth**: Phone + PIN with JWT tokens

## Feature Status (as of 2026-03-12)

### Pytest Regression Suite: 121/121 PASSED (100%)
- 19 test files across 19 categories
- Run: `python -m pytest backend/tests/ -v`

### API Documentation: `/app/API_DOCS.md`
- Complete endpoint reference for frontend team
- 70+ endpoints documented with request/response examples

### Phase 1: Content Quality Scoring ✅
- Multi-signal scoring (0–100): caption, media, hashtags, author reputation, engagement, freshness
- Grades: A/B/C/D/F with shadow-ban threshold (25) and low-quality threshold (50)
- Endpoints: score, batch, dashboard, check

### Phase 2: Content Recommendations ✅
- Collaborative filtering: "users who liked X also liked Y"
- Endpoints: suggested posts, reels you may like, creators for you
- Cached 30s per user

### Phase 3: Activity Status ✅
- Heartbeat tracking, "Active now"/"Active 2h ago"/"Yesterday"
- Privacy controls: toggle visibility
- Friends activity list sorted by online status

### Phase 4: Smart Suggestions ✅
- "People You May Know": mutual follows (×3) + same tribe (×2) + same college (×1)
- "Trending": hashtags, top posts, top creators (college-scoped or global)
- "Tribes For You": popular tribes user hasn't joined

### Phase 5: Integration + Documentation ✅
- All new handlers wired to router
- Comprehensive API docs created
- Full regression test coverage

### Previously Completed
- Smart Feed Algorithm (9-signal ranking for posts + reels)
- Redis Caching Layer (20+ namespaces, 80+ DB indexes)
- 54+ Social Features, 4 World-Class Systems
- Feed Visibility (all content visible to all users)
- Critical Bug Fixes, Service Refactoring

## Remaining Roadmap
- **P1:** Frontend integration (hand off API_DOCS.md)
- **P2:** WebSocket real-time push notifications
- **P3:** A/B testing framework for algorithm tuning
- **P4:** Rate limiting dashboard
- **P5:** CDN integration for media delivery

## Test Credentials
- Admin: `7777099001` / PIN: `1234`
- User: `7777099002` / PIN: `1234`
