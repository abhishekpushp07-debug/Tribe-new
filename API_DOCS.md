# Tribe API Documentation — Frontend Integration Guide
**Version**: 3.0 | **Last Updated**: 2026-03-12 | **Base URL**: `/api`

---

## Authentication
All authenticated endpoints require:
```
Authorization: Bearer <accessToken>
```

### Login
```
POST /api/auth/login
Body: { "phone": "7777099001", "pin": "1234" }
Response: { "accessToken": "at_...", "refreshToken": "rt_...", "user": { id, displayName, username, ... } }
```

### Get Current User
```
GET /api/auth/me
Response: { "id": "...", "displayName": "...", "username": "...", "phone": "...", "bio": "...", "avatarMediaId": "...", ... }
```

---

## 1. FEED (Posts)

### Home Feed (Smart Ranked)
```
GET /api/feed?limit=20&cursor=<nextCursor>
Auth: Required
Response: {
  "items": [{ id, authorId, caption, media, likeCount, commentCount, saveCount, shareCount, _feedScore, _feedRank, ... }],
  "pagination": { "nextCursor": "...", "hasMore": true },
  "feedType": "home",
  "rankingAlgorithm": "engagement_weighted_v1"
}
```
**Algorithm**: Posts are ranked by 9 signals: recency decay, engagement velocity (likes×1, comments×3, saves×5, shares×2), author affinity, content type affinity, quality signals, virality detection, diversity penalty, negative signals, unseen boost.

### Public Feed
```
GET /api/feed/public?limit=20&cursor=<nextCursor>
Auth: Optional
Response: { "items": [...], "pagination": {...}, "rankingAlgorithm": "engagement_weighted_v1" }
```

### Following Feed
```
GET /api/feed/following?limit=20&cursor=<nextCursor>
Auth: Required
Response: { "items": [...], "pagination": {...} }
```

### Feed Debug (Scoring Breakdown)
```
GET /api/feed/debug?limit=10
Auth: Required
Response: {
  "algorithm": "smart_feed_v2",
  "signals": ["recency_decay", "engagement_velocity", "author_affinity", ...],
  "weights": { "like": 1, "comment": 3, "save": 5, "share": 2 },
  "context": { "viewerId", "viewerTribeId", "followingCount", "trackedAuthors", "mutedAuthors", "contentTypeWeights" },
  "posts": [{ "postId", "ageHours", "recencyScore", "engagement": { likes, comments, saves, shares, raw, velocity }, "affinity", "contentType", "finalScore", "rank" }]
}
```

---

## 2. REELS

### Reel Discovery Feed (Smart Ranked)
```
GET /api/reels/feed?limit=20&cursor=<nextCursor>
Auth: Required
Response: {
  "items": [{ id, creatorId, mediaUrl, likeCount, commentCount, viewCount, _feedScore, _feedRank, creator: { displayName, avatarMediaId }, likedByMe, savedByMe }],
  "pagination": { "nextCursor", "hasMore" },
  "feedType": "personalized",
  "rankingAlgorithm": "smart_reel_ranking_v1"
}
```

### Following Reels
```
GET /api/reels/following?limit=20
Auth: Required
```

### Trending Reels
```
GET /api/reels/trending?limit=20
Auth: Required
```

### Single Reel Detail
```
GET /api/reels/:reelId
Auth: Required
Response: { id, creatorId, mediaUrl, caption, likeCount, viewCount, commentCount, ... }
```

---

## 3. STORIES

### Story Rail (All Users)
```
GET /api/stories
Auth: Required
Response: {
  "items": [{ "authorId", "stories": [{ id, mediaUrl, mediaType, viewCount, ... }], "author": { displayName, avatarMediaId } }],
  "count": 15
}
```
**Note**: Shows stories from ALL users (not just followed).

### Story Feed
```
GET /api/stories/feed
Auth: Required
```

---

## 4. TRIBES

### List All Tribes
```
GET /api/tribes
Auth: Optional (public)
Response: { "items": [{ id, tribeCode, tribeName, primaryColor, animalIcon, membersCount, totalSalutes }], "count": 21 }
```
**Cached**: 120s Redis TTL

### Tribe Leaderboard
```
GET /api/tribes/leaderboard?period=30d
Auth: Optional | Periods: 7d, 30d, 90d, all
Response: { "items": [{ rank, tribeId, tribeCode, tribeName, score, ... }] }
```
**Cached**: 60s Redis TTL

### Current Standings
```
GET /api/tribes/standings/current
Auth: Optional
Response: { "season": {...} | null, "standings": [{ rank, tribeId, tribeCode, tribeName, totalSalutes, membersCount, salutesPerMember }] }
```

### Tribe Detail / Members / Stats / Feed
```
GET /api/tribes/:tribeId                — Tribe detail
GET /api/tribes/:tribeId/members        — Members list (pagination: { total, hasMore, limit, offset })
GET /api/tribes/:tribeId/stats          — Statistics
GET /api/tribes/:tribeId/feed           — Tribe content feed
```

### My Tribe
```
GET /api/me/tribe
Auth: Required
Response: { "tribe": { id, tribeCode, tribeName, ... }, "membership": { tribeId, isPrimary, tribeCode } }
```

### Cheer for Tribe
```
POST /api/tribes/:tribeId/cheer
Auth: Required | Rate limited: 1 per day
Response: { "message": "Cheered for X Tribe!", "cheerCount": 1 }
Error: { "error": "Already cheered today", "code": "RATE_LIMITED" } (429)
```

### Join / Leave Tribe
```
POST /api/tribes/:tribeId/join    — Join tribe (409 if already member)
POST /api/tribes/:tribeId/leave   — Leave tribe
```

---

## 5. SEARCH

### Unified Search
```
GET /api/search?q=<query>&type=<type>&limit=10
Auth: Optional | Types: users, content, posts, reels, hashtags, pages, tribes
Response: { "query": "test", "type": "all", "results": { "users": [...], "posts": [...], "reels": [...], "hashtags": [...] }, "totalResults": 25 }
Error: Invalid type → 400
```

### Autocomplete
```
GET /api/search/autocomplete?q=<prefix>&limit=8
Auth: Optional
Response: { "suggestions": ["..."], "query": "te" }
```
**Cached**: 15s Redis TTL

### Specialized Search
```
GET /api/search/users?q=<query>       — User search
GET /api/search/hashtags?q=<query>    — Hashtag search (returns: { hashtag, postCount, reelCount, totalCount, totalLikes })
GET /api/search/content?q=<query>     — Content search
```

### Recent Searches
```
GET /api/search/recent                 — Get recent searches (auth required)
DELETE /api/search/recent              — Clear recent searches
```

---

## 6. ANALYTICS

### Track Event
```
POST /api/analytics/track
Auth: Optional
Body: { "eventType": "PROFILE_VISIT" | "CONTENT_VIEW" | "REEL_VIEW" | "STORY_VIEW", "targetId": "..." }
```

### Overview Dashboard
```
GET /api/analytics/overview?period=7d|30d|90d
Auth: Required
Response: {
  "period": "7d",
  "account": { totalFollowers, totalFollowing, totalPosts, totalReels },
  "engagement": { likes, comments, saves, shares, total, rate, growthPercent },
  "reach": { profileVisits, contentImpressions, profileVisitGrowth },
  "audience": { newFollowers, lostFollowers, netGrowth }
}
```
**Cached**: 60s per user+period

### Content / Audience / Reach / Profile Visits / Reels / Stories
```
GET /api/analytics/content              — Content performance breakdown
GET /api/analytics/audience             — Audience demographics
GET /api/analytics/reach                — Reach & impressions (with uniqueVisitors)
GET /api/analytics/profile-visits       — Profile visit history
GET /api/analytics/reels                — Reel performance
GET /api/analytics/stories              — Story performance (totalStories, viewsByDay, per-story metrics)
```

---

## 7. CONTENT QUALITY SCORING ⭐ NEW

### Score Single Post
```
POST /api/quality/score
Auth: Required
Body: { "contentId": "...", "contentType": "posts" | "reels" }
Response: { "contentId", "score": 78, "grade": "B", "breakdown": { captionQuality, mediaPresence, hashtagHealth, authorReputation, engagementRatio, freshness, reportPenalty }, "isShadowBanned": false, "isLowQuality": false }
```

### Batch Score (All Unscored Content)
```
POST /api/quality/batch
Auth: Required
Body: { "limit": 200 }
Response: { "posts": { scored, shadowBanned, lowQuality }, "reels": { scored, shadowBanned, lowQuality }, "total": 200 }
```

### Quality Dashboard
```
GET /api/quality/dashboard
Auth: Required
Response: {
  "overview": { totalScored, shadowBannedCount, lowQualityCount, avgScore },
  "gradeDistribution": { "A": { count, avgScore }, "B": {...}, ... },
  "topQuality": [top 5 posts],
  "worstQuality": [worst 5 posts],
  "thresholds": { shadowBan: 25, lowQuality: 50 }
}
```

### Check Quality Score
```
GET /api/quality/check/:contentId
Auth: Required
Response: { "contentId", "score", "grade", "breakdown", "isShadowBanned", "isLowQuality", "scoredAt" }
```

**Scoring (0–100)**:
| Signal | Max Points |
|--------|-----------|
| Caption Quality | 20 |
| Media Presence | 15 |
| Hashtag Health | 15 |
| Author Reputation | 20 |
| Engagement Ratio | 15 |
| Freshness | 10 |
| Report Penalty | -5 |

**Grades**: A (90–100), B (70–89), C (50–69), D (25–49), F (0–24)
**Shadow Ban**: Score < 25 → hidden from feeds
**Low Quality**: Score < 50 → deprioritized

---

## 8. CONTENT RECOMMENDATIONS ⭐ NEW

### Suggested Posts
```
GET /api/recommendations/posts?limit=20
Auth: Required
Response: {
  "items": [{ id, caption, authorId, likeCount, ... }],
  "count": 20,
  "algorithm": "collaborative_filtering_v1",
  "signals": ["liked_same_posts", "saved_same_content", "trending_backfill"]
}
```
**Algorithm**: Finds users who liked the same posts as you → recommends what they also liked.

### Reels You May Like
```
GET /api/recommendations/reels?limit=20
Auth: Required
Response: { "items": [...], "count": 20, "algorithm": "collaborative_filtering_v1" }
```

### Creators For You
```
GET /api/recommendations/creators?limit=10
Auth: Required
Response: { "items": [{ "user": {...}, "stats": { posts, likes, comments, engagement }, "reason": "popular_creator" }] }
```

---

## 9. ACTIVITY STATUS ⭐ NEW

### Send Heartbeat (Update Last Seen)
```
POST /api/activity/heartbeat
Auth: Required
Response: { "status": "active", "lastSeen": "2026-03-12T..." }
```
**Frontend**: Call every 60 seconds while user is active.

### Check User's Activity Status
```
GET /api/activity/status/:userId
Auth: Optional
Response: { "userId", "status": "active" | "recently_active" | "away" | "offline" | "hidden", "label": "Active now" | "Active 5m ago" | "Active yesterday", "lastSeen": "..." }
```

### Friends Activity (Who's Online)
```
GET /api/activity/friends?limit=20
Auth: Required
Response: {
  "items": [{ userId, displayName, username, avatarMediaId, status, label, lastSeen }],
  "activeNow": 3,
  "total": 15
}
```
Items sorted: active → recently_active → away → offline

### Toggle Activity Visibility
```
PUT /api/activity/settings
Auth: Required
Body: { "showActivityStatus": true | false }
Response: { "showActivityStatus": true, "message": "Activity status visible" }
```

---

## 10. SMART SUGGESTIONS ⭐ NEW

### People You May Know
```
GET /api/suggestions/people?limit=15
Auth: Required
Response: {
  "items": [{ "user": { id, displayName, username, avatarMediaId }, "score": 5, "reasons": ["3 mutual follows", "Same tribe"], "mutualFollows": 3, "sameTribe": true, "sameCollege": false }],
  "count": 15,
  "algorithm": "social_graph_v1"
}
```
**Signals**: Mutual follows (×3), Same tribe (×2), Same college (×1)

### Trending (In Your College / Globally)
```
GET /api/suggestions/trending?limit=10
Auth: Required
Response: {
  "hashtags": [{ rank, hashtag, postCount, totalLikes, score }],
  "topPosts": [{ id, caption, likeCount, commentCount }],
  "topCreators": [{ user: {...}, totalLikes, postCount }],
  "scope": "college" | "global"
}
```

### Tribes For You
```
GET /api/suggestions/tribes?limit=5
Auth: Required
Response: { "items": [{ id, tribeCode, tribeName, primaryColor, animalIcon, membersCount, reason }], "count": 5 }
```

---

## 11. SOCIAL INTERACTIONS

### Like / Unlike
```
POST /api/content/:contentId/like      — Like (201 or 409 if already liked)
DELETE /api/content/:contentId/like     — Unlike
```

### Comment
```
POST /api/content/:contentId/comments
Body: { "text": "Great post!" }
```

### Save / Unsave
```
POST /api/content/:contentId/save      — Save (201 or 409)
DELETE /api/content/:contentId/save     — Unsave
```

---

## 12. FOLLOW REQUESTS

### Pending / Sent / Count
```
GET /api/me/follow-requests             — Incoming pending requests
GET /api/me/follow-requests/sent        — Sent requests
GET /api/me/follow-requests/count       — Pending count: { "count": 3 }
```

### Accept / Reject
```
POST /api/follow-requests/:requestId/approve
POST /api/follow-requests/:requestId/reject
```

---

## 13. VIDEO TRANSCODING

### Queue
```
GET /api/transcode/queue?status=COMPLETED&limit=20
Auth: Required
Response: { "jobs": [...], "stats": { "COMPLETED": 3, "PENDING": 1 }, "total": 4 }
```

### Cancel / Retry Jobs
```
POST /api/transcode/:jobId/cancel      — Cancel pending/processing (400 if COMPLETED)
POST /api/transcode/:jobId/retry       — Retry failed (max 3 attempts, 429 if exhausted)
```

---

## 14. NOTIFICATIONS
```
GET /api/notifications?limit=20
Auth: Required
Response: { "items": [{ id, type, message, read, createdAt, ... }] }
```

---

## 15. CACHE STATS (Admin)
```
GET /api/cache/stats
Auth: Required
Response: { "hits": 10, "misses": 5, "sets": 8, "hitRate": "66.7%", "redisErrors": 0, "redis": { "status": "connected", "keys": 8 } }
```

---

## Error Format
All errors follow:
```json
{ "error": "Description", "code": "ERROR_CODE" }
```
Common codes: `UNAUTHORIZED` (401), `VALIDATION_ERROR` (400), `NOT_FOUND` (404), `RATE_LIMITED` (429), `FORBIDDEN` (403)

---

## Test Credentials
| Phone | PIN | Role |
|-------|-----|------|
| 7777099001 | 1234 | Admin |
| 7777099002 | 1234 | User |

---

## Quick Integration Checklist for Frontend
1. ✅ Call `POST /api/activity/heartbeat` every 60s when user is active
2. ✅ Use `_feedScore` and `_feedRank` from feed items for ranking display
3. ✅ Show quality `grade` badges (A/B/C) on posts
4. ✅ Build "For You" tab using `/api/recommendations/posts`
5. ✅ Build "People You May Know" widget using `/api/suggestions/people`
6. ✅ Show "Active now" dots using `/api/activity/friends`
7. ✅ Show trending sidebar using `/api/suggestions/trending`
8. ✅ Call `POST /api/analytics/track` on profile visits and content views
