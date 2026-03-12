# Tribe — Changelog
**Last Updated**: 2026-03-12

## 2026-03-12: Redis Caching Layer + Full Test Suite

### Redis Installation & Configuration
- Installed Redis server (256MB maxmemory, allkeys-lru eviction)
- Set REDIS_URL=redis://127.0.0.1:6379 in .env
- Removed lazyConnect for immediate connection
- Verified Redis connected status via /api/cache/stats

### Cache Added to Handlers
- **tribes.js**: Cached tribe list (120s), leaderboard (60s), standings (60s)
- **search.js**: Cached unified search results (20s), autocomplete (15s)
- **analytics.js**: Cached analytics overview per user+period (60s)
- **reels.js**: Cached reel discovery feed (15s)
- **feed.js**: Cached explore page (30s)
- New cache namespaces: REEL_FEED, TRIBE_LEADERBOARD, TRIBE_STANDINGS, TRIBE_LIST, SEARCH_RESULTS, SEARCH_AUTOCOMPLETE, ANALYTICS_OVERVIEW, EXPLORE_PAGE, TRENDING

### Database Indexes
- 80+ indexes across all collections
- New: follow_requests, recent_searches, analytics_events, profile_visits, transcode_jobs, tribe_cheers, likes, shares

### Comprehensive Test Suite
- 51 endpoints tested across 12 categories
- **98% success rate** (50/51 passing)
- 10/12 categories scored 100%
- Report: /app/test_reports/comprehensive_regression_report.md

---

## 2026-03-12: Feed Visibility — Open All Content

### Posts Feed (feed.js)
- Removed distributionStage filter from ALL feed endpoints
- All published posts now visible to all users

### Stories Rail (story-service.js)
- Changed buildStoryRail() from "followed users only" to ALL active stories

---

## 2026-03-12: "90+ Enhancement Pass" — Complete

### Database Indexes (db.js)
- Added 30+ new indexes

### Tribes Handler (tribes.js)
- Enhanced pagination: hasMore, limit, offset
- Audit trail for join/leave/cheer
- Fixed duplicate key 500→409

### Search Handler (search.js)
- Type validation, totalResults count, reelCount in hashtag search

### Analytics Handler (analytics.js)
- NEW story analytics endpoint
- Time-series gap filling, unique visitor dedup

### Transcode Handler (transcode.js)
- NEW cancel/retry endpoints
- Status filters, mid-process cancellation

### Follow Requests Handler (follow-requests.js)
- Block checking + rate limiting (30/hr)

---

## Earlier Phases (2026-03-09 through 2026-03-11)
- Foundation build, 50+ features, 4 world-class systems
- Critical bug fixes, service layer refactor
- Anti-abuse hardening, post subsystem expansion
