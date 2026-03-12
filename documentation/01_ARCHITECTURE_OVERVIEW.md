# 01 — Architecture Overview

## System Design

Tribe is a **monolithic Next.js API** (v14+ App Router) serving 464+ REST endpoints from a single process. The architecture uses a **service-oriented handler pattern** where a central router delegates to 29 specialized handler modules.

### Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Runtime | Node.js 18+ / Next.js 14+ | API server (App Router) |
| Database | MongoDB 6+ | Primary data store (95 collections) |
| Cache | Redis 7+ (ioredis) | Distributed caching, stampede protection |
| Media Storage | Supabase Storage | File uploads, signed URLs |
| Video Processing | ffmpeg | HLS transcoding, thumbnails |
| Realtime | Server-Sent Events (SSE) | Live story/reel updates |
| Observability | Custom logger + metrics | Structured JSON logging, SLI tracking |

---

## Folder Structure

```
/app
├── app/
│   └── api/
│       └── [[...path]]/
│           └── route.js          # ← Master router (702 lines)
├── lib/
│   ├── handlers/                 # 29 handler modules
│   │   ├── auth.js               # Authentication (544 lines)
│   │   ├── feed.js               # Feed & explore (823 lines)
│   │   ├── content.js            # Posts, polls, threads
│   │   ├── social.js             # Likes, comments, follows
│   │   ├── stories.js            # Stories system (2017 lines)
│   │   ├── reels.js              # Reels system (2156 lines)
│   │   ├── search.js             # Full-text search (421 lines)
│   │   ├── notifications.js      # Notifications (358 lines)
│   │   ├── media.js              # Media upload/serve
│   │   ├── media-cleanup.js      # Orphan cleanup worker
│   │   ├── transcode.js          # Video transcoding
│   │   ├── tribes.js             # Tribe system
│   │   ├── tribe-contests.js     # Contests & salutes
│   │   ├── pages.js              # Business pages
│   │   ├── events.js             # Events & RSVP
│   │   ├── governance.js         # Board governance
│   │   ├── admin.js              # Admin operations
│   │   ├── analytics.js          # Analytics endpoints
│   │   ├── users.js              # User profiles
│   │   ├── onboarding.js         # Onboarding flow
│   │   ├── discovery.js          # Colleges, houses
│   │   ├── follow-requests.js    # Private account follows
│   │   ├── quality.js            # Content quality scoring
│   │   ├── recommendations.js    # User recommendations
│   │   ├── activity.js           # Activity feed
│   │   ├── suggestions.js        # Follow suggestions
│   │   ├── board-notices.js      # Board notices & authenticity
│   │   └── stages.js             # Appeals, claims, distribution, resources
│   ├── services/                 # Business logic services
│   │   ├── feed-ranking.js       # Smart feed scoring engine (331 lines)
│   │   ├── story-service.js      # Story business logic
│   │   ├── reel-service.js       # Reel business logic
│   │   ├── notification-service.js # Notification V2 pipeline
│   │   ├── anti-abuse-service.js # Engagement abuse detection
│   │   ├── scoring.js            # Content quality scoring
│   │   ├── event-publisher.js    # Realtime event publisher
│   │   └── ...
│   ├── moderation/               # Moderation subsystem
│   │   ├── middleware/            # Content moderation middleware
│   │   └── routes/               # Moderation API routes
│   ├── auth-utils.js             # Auth helpers (472 lines)
│   ├── cache.js                  # Redis cache layer (340 lines)
│   ├── constants.js              # All enums & config (308 lines)
│   ├── security.js               # Security headers, rate limiting
│   ├── access-policy.js          # Block/mute content filtering
│   ├── logger.js                 # Structured JSON logger
│   ├── metrics.js                # SLI/SLO metrics collector
│   ├── health.js                 # Health check endpoints
│   ├── realtime.js               # SSE event system
│   ├── entity-snippets.js        # Canonical user/page snippets
│   ├── tribe-constants.js        # 21 tribe definitions
│   ├── freeze-registry.js        # API contract freeze headers
│   ├── request-context.js        # AsyncLocalStorage correlation
│   └── db.js                     # MongoDB connection singleton
├── backend/
│   └── tests/                    # pytest regression suite (121 tests)
└── documentation/                # This documentation suite
```

---

## Request Lifecycle

Every HTTP request follows this exact pipeline:

```
Client Request
    │
    ▼
┌──────────────────────────────────────────────┐
│  1. OPTIONS Handler (CORS preflight)         │
│     - Sets CORS headers                      │
│     - Returns 200 immediately                │
└──────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────┐
│  2. Observability Wrapper (handleRoute)      │
│     - Generate requestId (crypto.randomUUID) │
│     - Start latency timer                    │
│     - Create AsyncLocalStorage context       │
│     - Wire request correlation               │
└──────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────┐
│  3. Liveness Probe (/healthz)                │
│     - No DB, no auth, no rate limit          │
│     - Returns uptime + timestamp             │
└──────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────┐
│  4. Per-IP Rate Limiting (Tier-based)        │
│     - Extract IP from X-Forwarded-For        │
│     - Check tiered rate limit (Redis/memory) │
│     - Returns 429 + Retry-After if exceeded  │
└──────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────┐
│  5. Payload Size Check                       │
│     - POST/PUT/PATCH non-media routes        │
│     - Returns 413 if too large               │
└──────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────┐
│  6. Input Sanitization                       │
│     - Parse JSON body                        │
│     - deepSanitizeStrings() on all fields    │
│     - Reconstruct sanitized request          │
└──────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────┐
│  7. Database Connection                      │
│     - getDb() singleton connection           │
└──────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────┐
│  8. Per-User Rate Limiting                   │
│     - Extract userId from Bearer token       │
│     - Separate from per-IP limit             │
│     - Only for authenticated requests        │
└──────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────┐
│  9. Route Dispatch                           │
│     - 600-line if/else chain in route.js     │
│     - Maps path[0] to handler function       │
│     - Some routes have sub-routing logic     │
└──────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────┐
│  10. Handler Execution                       │
│     - Auth check (requireAuth/authenticate)  │
│     - Business logic                         │
│     - Returns { data } or { error }          │
└──────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────┐
│  11. Response Processing                     │
│     - jsonOk(data) → 200 + CORS + security   │
│     - jsonErr(msg) → 4xx/5xx + CORS          │
│     - x-contract-version: v2 header          │
│     - x-request-id: UUID header              │
│     - Security headers via applySecurityHeaders │
│     - Freeze headers via applyFreezeHeaders  │
└──────────────────────────────────────────────┘
    │
    ▼
┌──────────────────────────────────────────────┐
│  12. Observability                           │
│     - Structured access log (JSON)           │
│     - Metrics recording (route, method, status) │
│     - Error code tracking                    │
└──────────────────────────────────────────────┘
```

---

## Route Dispatch Map

The master router at `route.js` uses `path[0]` to select the handler:

| path[0] | Handler Function | Sub-routing |
|---------|-----------------|-------------|
| `auth` | `handleAuth` | Direct |
| `me` | Multiple | Routes to stories, reels, events, tribes, pages, users, onboarding based on `path[1]` |
| `content` | `handleContent` + `handleSocial` | Length ≤2 → content; ≥3 → content then social |
| `feed`, `explore`, `trending` | `handleFeed` | Direct |
| `follow` | `interceptFollowForPrivateAccount` → `handleSocial` | Private account intercept |
| `stories` | `handleStories` | Direct |
| `reels` | `handleReels` | Direct |
| `users` | Multiple | `path[2]` checks: stories, highlights, reels, tribe → respective handlers |
| `colleges`, `houses` | `handleDiscovery` | Special cases: claim, notices |
| `media` | `handleMedia` + `handleTranscode` | Lazy-init cleanup worker |
| `search`, `hashtags` | `handleSearch` + `handleDiscovery` | Fallback chain |
| `analytics` | `handleAnalytics` | Direct |
| `notifications` | `handleNotifications` | Direct |
| `governance` | `handleGovernance` | Direct |
| `pages` | `handlePages` | Direct |
| `events` | `handleEvents` | Direct |
| `resources` | `handleResources` | Direct |
| `tribes` | `handleTribes` | Direct |
| `tribe-contests` | `handleTribeContests` | Direct |
| `admin`, `reports`, `moderation`, `appeals`, `legal`, `grievances` | Multiple | 20+ sub-routes to specialized handlers |
| `quality` | `handleQuality` | Direct |
| `recommendations` | `handleRecommendations` | Direct |
| `activity` | `handleActivity` | Direct |
| `suggestions` | `handleSuggestions` | Direct |

---

## Response Format Convention

### Success Response
```javascript
// Handler returns:
{ data: { ...payload }, status: 200 }

// Client receives:
HTTP 200
{
  "field1": "value1",
  "field2": "value2"
}
```

### Error Response
```javascript
// Handler returns:
{ error: 'message', code: 'ERROR_CODE', status: 400 }

// Client receives:
HTTP 400
{
  "error": "message",
  "code": "ERROR_CODE"
}
```

### Raw Response (SSE streams)
```javascript
// Handler returns:
{ raw: NextResponse }  // Bypasses JSON serialization
```

---

## Database Architecture

### Connection Pattern
- Singleton connection via `getDb()` in `lib/db.js`
- Connection string from `MONGO_URL` env var
- Database name from `DB_NAME` env var
- No connection pooling config (uses driver defaults)

### Collection Naming
- Snake_case: `content_items`, `media_assets`, `story_views`
- Plural form: `users`, `sessions`, `follows`
- Junction tables: `user_tribe_memberships`, `page_follows`

### ID Strategy
- All entities use UUID v4 (`id` field, not `_id`)
- MongoDB `_id` is always excluded from responses via `{ _id, ...clean } = doc`
- References use the UUID `id` field, not ObjectId

---

## Key Design Decisions

### 1. No Framework ORM
Raw MongoDB driver used everywhere. This gives full query control but requires manual `_id` exclusion.

### 2. Handler-Level Auth
Each handler calls `requireAuth()` or `authenticate()` internally. There is no middleware layer — auth is explicit per-endpoint.

### 3. Soft Deletes
Most entities use status-based deletion (`status: 'REMOVED'`) rather than physical deletion. This preserves audit trails.

### 4. Eventual Consistency
Counter fields (likeCount, viewCount, etc.) use `$inc` for speed but are periodically recomputed from source-of-truth collections via admin endpoints.

### 5. CORS Wildcard
Development mode uses `Access-Control-Allow-Origin: *`. Production should restrict this via `CORS_ORIGINS` env var.

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGO_URL` | Yes | MongoDB connection string |
| `DB_NAME` | Yes | Database name |
| `REDIS_URL` | No | Redis connection (falls back to in-memory) |
| `SUPABASE_URL` | No | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | No | Supabase service role key |
| `SUPABASE_BUCKET` | No | Storage bucket name |
| `CORS_ORIGINS` | No | Allowed CORS origins (default: `*`) |

---

## Health & Readiness Probes

| Endpoint | Auth | Purpose | Checks |
|----------|------|---------|--------|
| `GET /api/healthz` | None | Liveness probe | Uptime, timestamp |
| `GET /api/readyz` | None | Readiness probe | DB connectivity, critical deps |
| `GET /api/ops/health` | Admin | Deep health | DB + Redis + all services |
| `GET /api/ops/metrics` | Admin | Business metrics | Users, posts, sessions, cache |
| `GET /api/ops/slis` | Admin | SLI/SLO data | Error rates, latency percentiles |
| `GET /api/ops/backup-check` | Admin | Backup readiness | Collection counts, backup commands |

---

## Source Files Referenced
- `/app/app/api/[[...path]]/route.js` — Master router
- `/app/lib/db.js` — Database connection
- `/app/lib/health.js` — Health checks
- `/app/lib/security.js` — Security headers & rate limiting
- `/app/lib/request-context.js` — AsyncLocalStorage correlation
- `/app/lib/logger.js` — Structured logging
- `/app/lib/metrics.js` — Metrics collection
