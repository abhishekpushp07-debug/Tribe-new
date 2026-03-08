# Tribe — Changelog

## 2026-03-08 — Stage 9 Final Fixes (4 items)

### Fix 1: Test 49/49 (100%)
- Confirmed FOLLOWERS privacy returns 403 (not 401) for authenticated non-followers
- 403 = Forbidden (correct), 401 = Unauthorized (would be wrong since user IS authenticated)
- Test matrix updated to 49/49 PASSED

### Fix 2: N+1 Highlights → Batch Optimized
- Replaced 2N+1 query pattern with 3-query batch approach
- 1 query for highlights, 1 for all items, 1 for all stories
- In-memory grouping and assembly

### Fix 3: Real-time SSE Events
- New module: `/app/lib/realtime.js`
- New endpoint: `GET /api/stories/events/stream`
- Event types: story.viewed, story.reacted, story.replied, story.sticker_responded, story.expired
- Dual-mode: Redis Pub/Sub (multi-instance) or in-memory EventEmitter (single-instance)
- Auto-detects Redis availability, falls back gracefully
- Features: heartbeat (15s), retry hint (3s), event IDs for resumable connections
- Auth via query param `?token=xxx` or Authorization header

### Fix 4: Story Expiry Worker + TTL Cleanup
- Background worker runs every 30 minutes
- Marks expired ACTIVE stories as EXPIRED, respects per-user autoArchive setting
- New admin endpoint: `POST /api/admin/stories/cleanup` for manual trigger
- TTL index updated: deletes EXPIRED stories 30 days after expiry (removed archived-only restriction)
- Old restrictive TTL index (`expiresAt_ttl_cleanup`) dropped

---

## 2026-03-08 — Stage 9 Hardening (Previous Session)
- Built ~31 endpoints for full-featured stories module
- Fixed TTL index bug, privacy leaks, N+1 queries
- Added block integration, TOCTOU concurrency fixes
- Achieved zero COLLSCANs on 27 critical query paths
- 97.96% test pass rate (48/49, 1 quarantined)

## Earlier Sessions
- Stage 1-5: Core features built and hardened
