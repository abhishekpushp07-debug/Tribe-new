# 04 — Caching Strategy

## Overview

Tribe uses a **Redis-backed distributed cache** with in-memory fallback, stampede protection, TTL jitter, versioned keys, and event-driven invalidation. The cache is designed to survive Redis outages gracefully.

**Source file**: `lib/cache.js` (340 lines)

---

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Handler    │────▶│  cache.get() │────▶│    Redis     │
│   (feed.js)  │     │  cache.set() │     │  (primary)   │
│              │     │              │     └──────────────┘
│              │     │              │            │
│              │     │              │     ┌──────▼──────────┐
│              │     │              │────▶│  In-Memory Map  │
│              │     │              │     │  (fallback)     │
└──────────────┘     └──────────────┘     └─────────────────┘
```

### Redis Client Configuration
```javascript
redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 2,
  enableOfflineQueue: false,
  connectTimeout: 5000,
  retryStrategy(times) {
    if (times > 5) return null  // Stop retrying after 5 attempts
    return Math.min(times * 500, 3000)  // Backoff: 500ms, 1s, 1.5s, 2s, 2.5s, 3s
  }
})
```

### Graceful Degradation
- If `REDIS_URL` is not set → Redis is skipped entirely, uses in-memory only
- If Redis connection fails → automatic fallback to `Map` (in-memory)
- Cache operations never throw — all errors are silently caught
- `redisReady` flag tracks connection state

---

## Key Format

```
{VERSION}:{namespace}:{id}
```

Example: `v1:feed:public:anon:limit20`

- **VERSION**: `v1` — bump on schema changes to auto-invalidate old keys
- **namespace**: Logical grouping (e.g., `feed:public`, `user:profile`)
- **id**: Specific cache key (e.g., user ID, query hash)

---

## TTL Configuration

### All TTL Values (milliseconds)

| Constant | TTL | Human Readable | Use Case |
|----------|-----|---------------|----------|
| `SHORT` | 10,000 | 10 seconds | Home feed |
| `PUBLIC_FEED` | 15,000 | 15 seconds | Public feed first page |
| `COLLEGE_FEED` | 30,000 | 30 seconds | College-specific feed |
| `HOUSE_FEED` | 30,000 | 30 seconds | Tribe/house feed |
| `REELS_FEED` | 30,000 | 30 seconds | Reels feed |
| `REEL_FEED` | 15,000 | 15 seconds | Individual reel feed |
| `REEL_DETAIL` | 30,000 | 30 seconds | Reel detail page |
| `STORY_FEED` | 10,000 | 10 seconds | Story rail |
| `STORY_DETAIL` | 15,000 | 15 seconds | Individual story |
| `USER_PROFILE` | 60,000 | 1 minute | User profile data |
| `ADMIN_STATS` | 30,000 | 30 seconds | Admin dashboard stats |
| `CONSENT_NOTICE` | 3,600,000 | 1 hour | Legal consent notices |
| `HOUSES_LIST` | 300,000 | 5 minutes | All houses/tribes list |
| `HOUSE_LEADERBOARD` | 60,000 | 1 minute | House leaderboard |
| `COLLEGE_SEARCH` | 600,000 | 10 minutes | College search results |
| `RESOURCE_SEARCH` | 30,000 | 30 seconds | Resource search |
| `RESOURCE_DETAIL` | 60,000 | 1 minute | Individual resource |
| `TRIBE_LEADERBOARD` | 60,000 | 1 minute | Tribe leaderboard |
| `TRIBE_STANDINGS` | 60,000 | 1 minute | Tribe standings |
| `TRIBE_STATS` | 30,000 | 30 seconds | Tribe statistics |
| `TRIBE_LIST` | 120,000 | 2 minutes | All tribes list |
| `SEARCH_RESULTS` | 20,000 | 20 seconds | Search results |
| `SEARCH_AUTOCOMPLETE` | 15,000 | 15 seconds | Autocomplete suggestions |
| `SEARCH_HASHTAGS` | 30,000 | 30 seconds | Hashtag search |
| `ANALYTICS_OVERVIEW` | 60,000 | 1 minute | Analytics overview |
| `ANALYTICS_CONTENT` | 60,000 | 1 minute | Content analytics |
| `ANALYTICS_AUDIENCE` | 120,000 | 2 minutes | Audience analytics |
| `ANALYTICS_REACH` | 60,000 | 1 minute | Reach metrics |
| `EXPLORE_PAGE` | 30,000 | 30 seconds | Explore page |
| `TRENDING` | 30,000 | 30 seconds | Trending topics |
| `NOTIFICATIONS` | 10,000 | 10 seconds | Notification list |

---

## Namespaces

Each cache namespace is a logical partition:

```javascript
const CacheNS = {
  FEED: 'feed:home',
  PUBLIC_FEED: 'feed:public',
  COLLEGE_FEED: 'feed:college',
  HOUSE_FEED: 'feed:house',
  REELS_FEED: 'feed:reels',
  REEL_FEED: 'reel:feed',
  REEL_DETAIL: 'reel:detail',
  HOUSE_LEADERBOARD: 'house:leaderboard',
  HOUSES_LIST: 'house:list',
  COLLEGE_SEARCH: 'college:search',
  ADMIN_STATS: 'admin:stats',
  USER_PROFILE: 'user:profile',
  // ... 20+ namespaces
}
```

---

## Cache Operations

### `cache.get(namespace, id)`
```javascript
// 1. Try Redis
const val = await redis.get(key)
if (val) { stats.hits++; return JSON.parse(val) }

// 2. Fallback to in-memory
const entry = fallbackStore.get(key)
if (entry && Date.now() < entry.expiresAt) { return entry.value }

// 3. Cache miss
stats.misses++
return null
```

### `cache.set(namespace, id, value, ttlMs)`
```javascript
// Apply ±20% TTL jitter
const jitteredTTL = ttlMs + (ttlMs * 0.2 * (Math.random() * 2 - 1))

// Try Redis first
await redis.set(key, JSON.stringify(value), 'PX', jitteredTTL)

// Also set in fallback (if Redis fails)
fallbackStore.set(key, { value, expiresAt: Date.now() + jitteredTTL })
```

### `cache.invalidate(namespace, id?)`
```javascript
// If id provided: delete specific key
await redis.del(key)
fallbackStore.delete(key)

// If no id: delete ALL keys in namespace
const keys = await redis.keys(`${prefix}*`)
if (keys.length > 0) await redis.del(...keys)
```

### `cache.getOrCompute(namespace, id, computeFn, ttlMs)`
Stampede-safe compute: only one caller executes `computeFn`, others wait.

```javascript
// 1. Check cache
const cached = await cacheGet(namespace, id)
if (cached) return cached

// 2. Acquire lock (in-process via Map)
if (computeLocks.has(key)) return computeLocks.get(key)

// 3. Try Redis distributed lock (SETNX)
const acquired = await redis.set(lockKey, '1', 'PX', 5000, 'NX')
if (!acquired) {
  await sleep(100)  // Wait for other instance
  return cacheGet(namespace, id)  // Try again
}

// 4. Compute and cache
const result = await computeFn()
await cacheSet(namespace, id, result, ttlMs)
return result
```

---

## TTL Jitter (Thundering Herd Protection)

Every TTL is jittered by ±20% to prevent simultaneous cache expiration:

```javascript
function jitterTTL(ttlMs) {
  const jitter = ttlMs * 0.2 * (Math.random() * 2 - 1)
  return Math.round(ttlMs + jitter)
}
```

| Base TTL | Min Actual | Max Actual |
|----------|-----------|-----------|
| 10s | 8s | 12s |
| 30s | 24s | 36s |
| 60s | 48s | 72s |
| 5min | 4min | 6min |

---

## Event-Driven Invalidation

The `invalidateOnEvent(event, context)` function provides automatic cache invalidation:

```javascript
// When a post is created:
await invalidateOnEvent('POST_CREATED', { 
  collegeId: user.collegeId, 
  tribeId: user.tribeId 
})
// Invalidates: PUBLIC_FEED, ADMIN_STATS, COLLEGE_FEED, HOUSE_FEED
```

### Invalidation Matrix

| Event | Invalidated Caches |
|-------|-------------------|
| `POST_CREATED` | PUBLIC_FEED, ADMIN_STATS, COLLEGE_FEED (if college), HOUSE_FEED (if tribe), REELS_FEED (if reel) |
| `POST_DELETED` | Same as POST_CREATED |
| `FOLLOW_CHANGED` | USER_PROFILE (both users) |
| `REPORT_CREATED` | PUBLIC_FEED, ADMIN_STATS |
| `MODERATION_ACTION` | PUBLIC_FEED, ADMIN_STATS |
| `STRIKE_ISSUED` | USER_PROFILE, ADMIN_STATS |
| `USER_SUSPENDED` | USER_PROFILE, ADMIN_STATS |
| `HOUSE_POINTS_CHANGED` | HOUSE_LEADERBOARD, HOUSES_LIST |
| `LEADERBOARD_CHANGED` | HOUSE_LEADERBOARD, HOUSES_LIST |
| `RESOURCE_CHANGED` | RESOURCE_SEARCH, RESOURCE_DETAIL (specific) |
| `STORY_CHANGED` | STORY_FEED, STORY_DETAIL (specific) |

---

## Cache Statistics

`GET /api/cache/stats` (Admin only)

```json
{
  "hits": 1234,
  "misses": 567,
  "sets": 890,
  "invalidations": 45,
  "redisErrors": 2,
  "fallbackHits": 12,
  "hitRate": "68.5%",
  "redis": {
    "status": "connected",
    "keys": 156
  },
  "fallbackSize": 23,
  "locksActive": 0
}
```

---

## Caching Patterns in Handlers

### Pattern 1: Cache-First (Anonymous)
```javascript
// Only cache for anonymous users (no personalization leak)
const cacheKey = currentUser?.id ? null : `anon:limit${limit}`
if (cacheKey) {
  const cached = await cache.get(CacheNS.PUBLIC_FEED, cacheKey)
  if (cached) return { data: cached }
}

// ... compute ...

if (cacheKey) await cache.set(CacheNS.PUBLIC_FEED, cacheKey, result, CacheTTL.PUBLIC_FEED)
```

### Pattern 2: Cache with Block Filter Reapplication
```javascript
const cached = await cache.get(CacheNS.PUBLIC_FEED, cacheKey)
if (cached) {
  // Even cached results need block filtering for authenticated users
  if (currentUser?.id && cached.items) {
    const safeItems = await applyFeedPolicy(db, currentUser.id, currentUser.role, cached.items)
    return { data: { ...cached, items: safeItems } }
  }
  return { data: cached }
}
```

### Pattern 3: Per-User Cache (Reel Feed)
```javascript
const reelCacheKey = !cursor ? `reel_feed:${user.id}:${limit}` : null
// Cached per user because reel feed is personalized (blocked users differ)
```

---

## Android Implementation Notes

### Cache Headers
The API does NOT set HTTP cache headers (`Cache-Control`). Clients should implement their own caching:

```kotlin
// OkHttp cache for offline support
val cache = Cache(cacheDir, 50 * 1024 * 1024) // 50 MB
val client = OkHttpClient.Builder()
    .cache(cache)
    .addInterceptor { chain ->
        var request = chain.request()
        if (!isNetworkAvailable()) {
            request = request.newBuilder()
                .cacheControl(CacheControl.FORCE_CACHE)
                .build()
        }
        chain.proceed(request)
    }
    .build()
```

---

## Source Files
- `/app/lib/cache.js` — Full cache implementation
- `/app/lib/handlers/feed.js` — Feed caching patterns
- `/app/lib/handlers/search.js` — Search caching patterns
