# Tribe — Changelog
**Last Updated**: 2026-03-12

## 2026-03-12: Feed Visibility — Open All Content

### Posts Feed (feed.js)
- Removed `distributionStage` filter from ALL feed endpoints: `/feed`, `/feed/public`, `/feed/college`, `/explore`, `/trending`, personalized
- All published posts now visible to all users regardless of distribution stage

### Reels Feed (reels.js)
- No changes needed — already showed all published reels with `status: PUBLISHED` + `mediaStatus: READY`

### Stories Rail (story-service.js)
- Changed `buildStoryRail()` from "followed users only" to "ALL active stories from ALL users"
- Blocked users still filtered out for safety
- Privacy/close-friends/mute filters still respected

---

### Database Indexes (db.js)
- Added 30+ new indexes for: follow_requests, recent_searches, analytics_events, profile_visits, transcode_jobs, tribe_cheers, likes, shares

### Tribes Handler (tribes.js)
- Enhanced pagination: hasMore, limit, offset in members and salutes
- Audit trail: tribe_assignment_events for join/leave/cheer
- Fixed: duplicate key 500 → graceful 409 on tribe join
- Added tribeCode in all membership records

### Search Handler (search.js)
- Type validation for search filters (returns 400 for invalid types)
- totalResults count in unified search response
- reelCount + totalCount in hashtag search (cross-collection aggregation)

### Analytics Handler (analytics.js)
- NEW: `GET /analytics/stories` endpoint — story performance analytics
- Time-series gap filling helper for consistent charting
- Unique visitor dedup using $addToSet on profile visits
- uniqueVisitors field in reach response

### Transcode Handler (transcode.js)
- NEW: `POST /transcode/:jobId/cancel` — cancel pending/processing jobs
- NEW: `POST /transcode/:jobId/retry` — retry failed jobs (max 3 attempts)
- Status filter on queue endpoint (`?status=COMPLETED`)
- Total count in queue response
- Mid-process cancellation checking during transcoding loop

### Follow Requests Handler (follow-requests.js)
- Block checking: prevents follow requests between blocked users
- Rate limiting: 30 follow requests per hour per user

### Testing
- Testing agent: 93.9% (31/33) → fixed tribe join 500 → all passing
- Comprehensive 24-endpoint smoke test: all 200 OK

---

## 2026-03-11: Top 6 Gap Closure — Phase C & D Complete

### Phase C: Anti-Abuse Hardening (Gap 5)
- 5-layer abuse detection engine
- Wired anti-abuse into all social interactions
- Admin abuse dashboard + audit log endpoints

### Phase D: Post Subsystem Expansion (Gap 6)
- Poll creation, link preview, thread support
- Vote endpoint, poll-results endpoint, thread view endpoint
- New post sub-types: STANDARD, POLL, LINK, THREAD_HEAD, THREAD_PART

---

## Earlier Phases (2026-03-09 through 2026-03-11)
- Phases A & B of Top 6 Gap Closure
- Media Lifecycle Hardening
- Service Layer Refactor
- Full foundation build (auth, content, social, pages, tribes, stories, reels, search, notifications, governance)
- Stories, Posts, Reels, Pages enhancements to 100%
