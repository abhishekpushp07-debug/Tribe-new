# Tribe — Changelog
**Last Updated**: 2026-03-12

## 2026-03-12: Phase 1–5 Sprint Complete

### Phase 1: Content Quality Scoring
- New handler: `/app/lib/handlers/quality.js`
- Endpoints: `POST /quality/score`, `POST /quality/batch`, `GET /quality/dashboard`, `GET /quality/check/:id`
- 7-signal scoring: caption quality, media presence, hashtag health, author reputation, engagement ratio, freshness, report penalty
- Shadow-ban threshold: 25, Low-quality threshold: 50

### Phase 2: Content Recommendations
- New handler: `/app/lib/handlers/recommendations.js`
- Endpoints: `GET /recommendations/posts`, `GET /recommendations/reels`, `GET /recommendations/creators`
- Algorithm: collaborative_filtering_v1 (liked_same_posts → recommend unseen)
- Cached 30s per user

### Phase 3: Activity Status
- New handler: `/app/lib/handlers/activity.js`
- Endpoints: `POST /activity/heartbeat`, `GET /activity/status/:id`, `GET /activity/friends`, `PUT /activity/settings`
- Labels: Active now, Active Xm/Xh ago, Active yesterday, Offline
- Privacy: showActivityStatus toggle

### Phase 4: Smart Suggestions
- New handler: `/app/lib/handlers/suggestions.js`
- Endpoints: `GET /suggestions/people`, `GET /suggestions/trending`, `GET /suggestions/tribes`
- People algorithm: social_graph_v1 (mutual follows ×3, same tribe ×2, same college ×1)
- Trending: college-scoped or global hashtags + top posts + top creators

### Phase 5: Integration & Documentation
- All 4 new handlers wired to route.js
- Fixed: suggestions path conflict with discovery handler
- Created: `/app/API_DOCS.md` — complete frontend integration guide (70+ endpoints)
- Test suite: 121 tests, 19 categories, 100% pass rate

---

## 2026-03-12: Smart Feed Algorithm
- World-class 9-signal ranking engine
- Applied to posts feed + reels feed
- Debug endpoint: GET /feed/debug

## 2026-03-12: Redis Caching + Indexing
- Redis installed, 20+ cache namespaces
- 80+ database indexes

## 2026-03-12: Feed Visibility
- Removed distributionStage filters
- Stories visible from all users

## 2026-03-12: "90+ Enhancement Pass"
- tribes.js, search.js, analytics.js, transcode.js, follow-requests.js enhanced

## Earlier (2026-03-09 to 2026-03-11)
- Foundation build, 50+ features, 4 world-class systems
- Critical bug fixes, service layer refactor
