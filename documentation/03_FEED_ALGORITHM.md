# 03 — Feed Algorithm

## Overview

Tribe implements an **Instagram-level smart feed ranking engine** with multi-signal scoring, virality detection, diversity penalties, and content-type affinity. The system supports **8 distinct feed types** and seamlessly falls back to chronological ordering for paginated pages.

**Source files**: `lib/services/feed-ranking.js` (331 lines), `lib/handlers/feed.js` (823 lines)

---

## Scoring Formula

```
feedScore = recency × (1 + engagement) × affinity × quality × viralityBoost × typeBoost
```

| Signal | Weight Range | Description |
|--------|-------------|-------------|
| Recency | 0.0 – 1.0 | Exponential decay with 6-hour half-life |
| Engagement | 0.0 – ∞ (log-scaled) | Weighted interactions per hour |
| Affinity | 1.0 – 2.8+ | Follow + tribe + interaction history |
| Quality | 0.5 – 1.3+ | Media, caption length, unseen boost |
| Virality | 1.0 or 1.2 | 20% boost if 2× average velocity |
| Type Boost | 0.8 – 1.4 | Based on viewer's content type preference |

---

## Signal Breakdown

### 1. Recency (Exponential Decay)
```javascript
const HALF_LIFE_MS = 6 * 60 * 60 * 1000  // 6 hours
const recency = Math.exp(-LN2 * ageMs / HALF_LIFE_MS)
```

| Age | Score |
|-----|-------|
| 0 hours | 1.000 |
| 3 hours | 0.707 |
| 6 hours | 0.500 |
| 12 hours | 0.250 |
| 24 hours | 0.063 |
| 48 hours | 0.004 |

### 2. Engagement Velocity
```javascript
const W_LIKE = 1, W_COMMENT = 3, W_SAVE = 5, W_SHARE = 2

const engagementRaw = (likes × 1) + (comments × 3) + (saves × 5) + (shares × 2)
const engagementVelocity = engagementRaw / ageHours
const engagement = Math.log2(1 + engagementVelocity)
```

**Why log-scaled?** Prevents viral posts from completely dominating. A post with 1000 likes scores ~10, not 1000.

### 3. Author Affinity (0.0 – 2.8+)
```
Base: 1.0
+ 0.5 if viewer follows this author
+ 0.3 if same tribe as viewer
+ 0.0–1.0 per-author interaction score (normalized from 30-day history)
```

**Per-author interaction scoring:**
- Each like from viewer on this author's content: +1 point
- Each comment: +3 points
- Each save: +5 points
- Normalized to 0.0–1.0 range against the viewer's most-interacted author

### 4. Content Type Affinity
```javascript
// Built from viewer's like history (last 30 days)
// Range: 0.8 to 1.4 based on preference ratio
contentTypeWeights[type] = 0.8 + (count / totalLikes) * 0.6
```

Supported content types:
- `poll`, `thread`, `link`, `carousel`, `video`, `image`, `text`

### 5. Quality Signals
```
Base: 1.0
× 1.15 if has media (image/video)
× 1.05 if carousel (multiple media)
× 1.05 if caption 50-500 chars (optimal length)
× 1.30 if unseen post from followed user (30% boost)
× 0.50 if 3+ reports
```

### 6. Virality Detection
```javascript
// If post's engagement velocity > 2× the average of all candidate posts
viralityBoost = engagementVelocity > avgEngagementVelocity * 2 ? 1.2 : 1.0
```

### 7. Negative Signals
```
Muted author → score = 0.01 (near-zero, not removed)
Hidden post → score = 0 (filtered out)
3+ reports → quality × 0.5
```

---

## Diversity Controls

### Author Diversity
```
1st post from author: normal score
2nd post from author: score × 0.7 (30% penalty)
3rd+ post from author: score × 0.4 (60% penalty)
```

### Content Type Diversity
```
If 3 consecutive items have the same content type:
  3rd item: score × 0.85 (15% penalty)
```

After diversity penalties, the list is re-sorted.

---

## Affinity Context Builder

`buildAffinityContext(db, viewerId)` gathers all personalization data in a **single batched query** (7 parallel queries):

```javascript
const [user, follows, recentLikes, recentComments, recentSaves, muted, hidden] = await Promise.all([
  db.collection('users').findOne({ id: viewerId }),          // Tribe ID
  db.collection('follows').find({ followerId: viewerId }),    // Follow list
  db.collection('likes').find({ userId: viewerId, last30d }), // Like history (500 max)
  db.collection('comments').find({ authorId: viewerId }),     // Comment history (200 max)
  db.collection('saves').find({ userId: viewerId }),          // Save history (200 max)
  db.collection('mutes').find({ muterId: viewerId }),         // Muted users
  db.collection('hidden_content').find({ userId: viewerId }), // Hidden posts (500 max)
])
```

**Returns:**
```javascript
{
  viewerId: "uuid",
  viewerTribeId: "tribe-uuid",
  followeeIds: Set<string>,        // O(1) lookup
  authorScores: { authorId: 0.0-1.0 },
  contentTypeWeights: { image: 1.2, video: 0.9, ... },
  mutedAuthorIds: Set<string>,
  hiddenPostIds: Set<string>,
  seenPostIds: Set<string>
}
```

---

## Feed Types

### 1. Home Feed (`GET /api/feed`)
- Alias for `/feed/public`
- Anonymous users: cached (10s TTL)
- Authenticated users: personalized ranking on first page

### 2. Public Feed (`GET /api/feed/public`)
- All public posts, sorted by ranking score
- **Candidate pool**: Fetches 3× limit, ranks, returns top N
- Cache: Anonymous first page only (15s TTL)
- Block filter applied even on cached results

### 3. Following Feed (`GET /api/feed/following`)
- Posts from followed users + own posts
- Also includes posts from followed Pages (`authorType: 'PAGE'`)
- Requires authentication
- Ranked on first page, chronological on paginated pages

### 4. College Feed (`GET /api/feed/college/:collegeId`)
- Posts from specific college community
- Cache: 30s TTL for anonymous first page

### 5. Tribe Feed (`GET /api/feed/tribe/:tribeId`)
- Posts from tribe members (supports legacy `house` path)
- Cache: 30s TTL for anonymous first page

### 6. Story Rail (`GET /api/feed/stories`)
- Stories grouped by author, sorted: own first, then by latest
- Block-filtered, requires auth

### 7. Reels Feed (`GET /api/feed/reels`)
- Published reels with `mediaStatus: READY`
- Block-filtered, cache: 30s TTL
- Enriched with creator info

### 8. Mixed Feed (`GET /api/feed/mixed`)
- Posts (70%) + Reels (30%) interleaved
- Every 4th item is a reel

### 9. Personalized Feed (`GET /api/feed/personalized`)
- ML-like scoring with 5 factors:
  1. Relationship score (0-100): follow + interaction frequency
  2. Interest match (0-60): hashtag overlap with user interests
  3. Engagement quality (0-50): like+comment+save rate per view
  4. Recency decay (0-40): exponential decay over 48h
  5. Content diversity (0-8): media bonus

### 10. Explore Page (`GET /api/explore`)
- Mixed trending content from last 7 days
- Posts (60%) + Reels (40%) by engagement
- Trending hashtags (top 10 by weighted score)
- Cache: 30s TTL

### 11. Trending Topics (`GET /api/trending/topics`)
- Hashtag aggregation with weighted scoring
- Configurable period: `24h`, `7d`, `30d`
- Score formula: `postCount + (totalLikes × 0.5) + (totalComments × 0.3)`

---

## Reel-Specific Ranking

Reels use a modified scoring algorithm with:
- **Longer half-life**: 12 hours (vs 6 for posts) — reels are more discoverable
- **View weight**: Views count (× 0.1) alongside likes/comments/saves
- **Completion rate**: `completionCount / views` → 0.8 to 1.2 multiplier
- **Replay rate**: Factored into quality score

```javascript
function scoreReel(reel, ctx) {
  const reelHalfLife = 12 * 60 * 60 * 1000  // 12 hours
  const recency = Math.exp(-LN2 * ageMs / reelHalfLife)
  
  const engagementRaw = (views × 0.1) + (likes × 1) + (comments × 3) + (saves × 5) + (shares × 2)
  const engagement = Math.log2(1 + engagementRaw / ageHours)
  
  const completionRate = views > 0 ? completionCount / views : 0.5
  const completionBoost = 0.8 + (completionRate × 0.4)  // 0.8 to 1.2
  
  return recency × (1 + engagement) × affinity × completionBoost
}
```

---

## Pagination Strategy

### First Page (No Cursor)
1. Fetch 3× limit candidates from DB (chronological)
2. Apply block/mute filter
3. Run ranking algorithm
4. Return top N items
5. Use last chronological item's `createdAt` as cursor (not ranked order)

### Subsequent Pages (With Cursor)
1. Fetch limit+1 items with `createdAt < cursor`
2. Apply block/mute filter
3. Return in chronological order (no ranking)
4. Cursor stability: always based on chronological position

**Why?** Ranking only the first page prevents "infinite scroll loops" where re-ranking causes items to appear/disappear.

---

## Debug Endpoint

`GET /api/feed/debug?limit=10` (requires auth)

Returns scoring breakdown for each post:

```json
{
  "algorithm": "smart_feed_v2",
  "signals": ["recency_decay", "engagement_velocity", "author_affinity", ...],
  "weights": { "like": 1, "comment": 3, "save": 5, "share": 2 },
  "halfLife": "6 hours",
  "context": {
    "viewerId": "uuid",
    "viewerTribeId": "tribe-uuid",
    "followingCount": 42,
    "trackedAuthors": 15,
    "mutedAuthors": 2
  },
  "posts": [
    {
      "postId": "uuid",
      "ageHours": 3.5,
      "recencyScore": 0.707,
      "engagement": { "likes": 12, "comments": 3, "saves": 1, "shares": 0, "raw": 26, "velocity": 7.43 },
      "affinity": 1.8,
      "contentType": "image",
      "isFollowed": true,
      "sameTribe": false,
      "authorInteractionScore": 0.45,
      "isMuted": false,
      "finalScore": 4.23,
      "rank": 1
    }
  ]
}
```

---

## Caching Strategy for Feeds

| Feed | Namespace | TTL | Condition |
|------|-----------|-----|-----------|
| Home | `feed:home` | 10s | Anonymous first page only |
| Public | `feed:public` | 15s | Anonymous first page only |
| College | `feed:college` | 30s | Anonymous first page only |
| Tribe | `feed:house` | 30s | Anonymous first page only |
| Reels | `feed:reels` | 30s | First page only |
| Explore | `explore:page` | 30s | Anonymous only |

**Why not cache authenticated feeds?** Personalized ranking differs per user. Caching user A's feed would leak to user B.

---

## Android Integration

### Feed API Call (Retrofit)
```kotlin
@GET("api/feed/public")
suspend fun getPublicFeed(
    @Query("limit") limit: Int = 20,
    @Query("cursor") cursor: String? = null
): FeedResponse

data class FeedResponse(
    val items: List<Post>,
    val pagination: Pagination,
    val feedType: String,
    val rankingAlgorithm: String
)

data class Pagination(
    val nextCursor: String?,
    val hasMore: Boolean
)
```

### Infinite Scroll Pattern
```kotlin
class FeedViewModel : ViewModel() {
    private var nextCursor: String? = null
    private var isLoading = false
    
    fun loadNextPage() {
        if (isLoading) return
        isLoading = true
        
        viewModelScope.launch {
            val response = api.getPublicFeed(cursor = nextCursor)
            nextCursor = response.pagination.nextCursor
            _posts.value = _posts.value + response.items
            isLoading = false
        }
    }
}
```

---

## Source Files
- `/app/lib/services/feed-ranking.js` — Scoring engine
- `/app/lib/handlers/feed.js` — Feed endpoints
- `/app/lib/cache.js` — Cache layer
- `/app/lib/access-policy.js` — Block/mute filtering
