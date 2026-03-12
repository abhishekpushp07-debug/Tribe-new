# Tribe — Product Requirements Document
**Version**: 8.0
**Last Updated**: 2026-03-12

## Problem Statement
Build a world-best social media backend for "Tribe" — a college-centric social platform with Posts, Reels, Stories, and Pages.

## Core Architecture
- **Application**: Next.js 14 monolithic API with Service-Oriented Architecture
- **Database**: MongoDB (local) with 80+ indexes
- **Cache**: Redis (ioredis) with in-memory fallback, TTL jitter, stampede protection
- **Media Storage**: Supabase Storage (bucket: `tribe-media`)
- **Video Processing**: ffmpeg (HLS transcoding, multi-quality, thumbnail extraction)
- **Auth**: Phone + PIN with JWT tokens

## Feature Status (as of 2026-03-12)

### Smart Feed Algorithm ✅ (NEW)
- Multi-signal ranking engine: recency decay (6h half-life), engagement velocity (likes×1 + comments×3 + saves×5 + shares×2), author affinity, content type affinity, virality detection, diversity penalty
- Applied to: posts feed, reels feed
- Debug endpoint: `GET /api/feed/debug` — full scoring breakdown per post
- Tests: 8 dedicated tests in `test_15_smart_feed.py`

### Pytest Regression Suite ✅
- 99 tests across 15 categories — **100% pass rate** (10.77s)
- Categories: Auth (6), Feed (8), Reels (9), Stories (4), Tribes (11), Search (11), Analytics (12), Transcode (6), Follow Requests (4), Social (6), Cache (4), Notifications (2), Users (3), Cross-User (5), Smart Feed (8)
- Location: `/app/backend/tests/`
- Run: `python -m pytest backend/tests/ -v`

### Redis Caching Layer ✅ (NEW)
- Redis installed + running (256MB, allkeys-lru)
- 20+ cache namespaces: feeds, reels, tribes, search, analytics, explore
- TTL ranges: 10s (story feed) to 600s (college search)
- Stampede protection via SETNX lock
- Event-driven invalidation matrix
- Cache stats endpoint: `GET /api/cache/stats`

### Feed Visibility ✅
- All posts visible to all users (no distributionStage gate)
- All reels visible (PUBLISHED + READY)
- All stories visible (not just followed users)

### 54+ Social Features ✅
### 4 World-Class Systems ✅ (Search, Analytics, Follow Requests, Video Transcoding)
### 90+ Enhancement Pass ✅
### Database Indexes ✅ (80+ indexes across all collections)

## Remaining Roadmap
- **P1:** Write pytest tests for all new features
- **P2:** Smart Feed Algorithm (ML-like ranking with engagement prediction)
- **P3:** Content Recommendations ("Suggested Posts")
- **P4:** Activity Status ("Active now")
- **P5:** Smart Suggestions ("People you may know")
- **P6:** Content Quality Scoring
- **P7:** Phase 2-6 Master Prompt sprints

## Test Credentials
- Admin: `7777099001` / PIN: `1234`
- User: `7777099002` / PIN: `1234`
