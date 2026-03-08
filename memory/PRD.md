# Tribe — Trust-First Social Platform for Indian College Students

## Vision
World-class social media backend for Indian college students, built stage-by-stage with proof-based acceptance.

## Core Architecture
- **Backend**: Monolithic Next.js API
- **Database**: MongoDB (25+ collections, 140+ indexes)
- **Cache**: Redis (with in-memory fallback)
- **Real-time**: SSE via Redis Pub/Sub + EventEmitter fallback
- **Moderation**: OpenAI GPT-4o-mini (provider-adapter pattern)
- **Storage**: Emergent Object Storage

## Stage Status

| Stage | Feature | Status |
|-------|---------|--------|
| 1 | Appeal Decision Workflow | PASSED |
| 2 | College Claim Workflow | PASSED |
| 3 | Story Expiry Cleanup | PASSED |
| 4 | Distribution Ladder | PASSED (2 test failures from prev session) |
| 5 | Notes/PYQs Library | BUILT + HARDENED (pending formal PASS) |
| 9 | World's Best Stories | BUILT + HARDENED (pending user PASS) |
| **10** | **World's Best Reels** | **BUILT (39 endpoints, 12 collections, 38 indexes)** |
| 6 | Events + RSVP | UPCOMING |
| 7 | Board Notices + Authenticity | UPCOMING |
| 8 | OTP Challenge Flow | UPCOMING |
| 11 | Scale/Reliability Excellence | FUTURE |
| 12 | Final Launch Readiness Gate | FUTURE |

## Stage 10: World's Best Reels — Feature Set

### Endpoints (39 total)
**CRUD**: Create (draft/publish), Get detail, Edit, Delete, Publish, Archive, Restore, Pin/Unpin
**Feeds**: Discovery (score-ranked), Following (chronological), Creator profile, College-scoped
**Interactions**: Like/Unlike, Save/Unsave, Comment (threaded), Report (dedup+auto-hold), Hide, Not-interested, Share tracking
**Watch Metrics**: View impression, Watch event (duration+completion+replay)
**Admin**: Moderation queue, Moderate (HOLD/REMOVE/APPROVE/RESTORE), Platform analytics, Counter recompute
**Creator**: Own analytics, Archived reels
**Media**: Processing status update/read
**Social**: Remix/duet/stitch relationships, Audio-based discovery, Series/episodes

### Collections (12)
reels, reel_likes, reel_saves, reel_comments, reel_views, reel_watch_events,
reel_reports, reel_hidden, reel_not_interested, reel_shares, reel_processing_jobs, reel_series

### Indexes: 38 custom across 12 collections

### Key Technical Achievements
- Video processing state machine: UPLOADING -> PROCESSING -> READY -> FAILED
- Reel lifecycle: DRAFT -> PUBLISHED -> ARCHIVED/HELD/REMOVED
- Composite ranking score (freshness + engagement + quality - penalty)
- All counters recomputable from source collections
- Bidirectional block integration on every surface
- Hidden/not-interested feed exclusion
- Rate limiting (20 reels/hr, 60 comments/hr)
- Remix/duet/stitch relationship model
- Series/episode grouping
- Pin to profile (max 3)
- Real-time events via SSE
- Pre-publish content moderation
- Auto-hold at 3+ reports
- Creator and admin analytics dashboards

### Reel Document Schema (key fields)
```
id, creatorId, collegeId, caption, hashtags[], mentions[],
audioMeta, durationMs, mediaStatus, playbackUrl, thumbnailUrl,
variants[], visibility, moderationStatus, syntheticDeclaration,
brandedContent, status, remixOf, collabCreators[], seriesId,
pinnedToProfile, likeCount, commentCount, saveCount, shareCount,
viewCount, uniqueViewerCount, impressionCount, completionCount,
avgWatchTimeMs, replayCount, reportCount, score,
createdAt, publishedAt, removedAt, heldAt, archivedAt
```

## Key Files
- `/app/lib/handlers/stories.js` — Story handler (Stage 9)
- `/app/lib/handlers/reels.js` — Reel handler (Stage 10)
- `/app/lib/realtime.js` — SSE + Redis/memory event system
- `/app/lib/db.js` — DB init + all indexes
- `/app/app/api/[[...path]]/route.js` — Route dispatcher
- `/app/lib/cache.js` — Redis/memory cache
