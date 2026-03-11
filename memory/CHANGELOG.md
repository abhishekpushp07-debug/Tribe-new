# Tribe — Changelog
**Last Updated**: 2026-03-11

## 2026-03-11: Top 6 Gap Closure — Phase C & D Complete

### Phase C: Anti-Abuse Hardening (Gap 5) ✅
**Files Changed:**
- `lib/services/anti-abuse-service.js` — 5-layer abuse detection engine (existing, verified)
- `lib/handlers/social.js` — Wired anti-abuse into: like, comment, share, save, follow
- `lib/handlers/stories.js` — Wired anti-abuse into: story reactions
- `lib/handlers/reels.js` — Wired anti-abuse into: reel like, comment, save, share
- `lib/handlers/admin.js` — Added abuse-dashboard + abuse-log endpoints
- `app/api/[[...path]]/route.js` — Added routing for admin/abuse-dashboard, admin/abuse-log

**New Endpoints:**
- `GET /api/admin/abuse-dashboard` — Summary dashboard (admin only)
- `GET /api/admin/abuse-log` — Detailed audit log with filters (admin only)

**New Collections:**
- `abuse_audit_log` — Indexed: (timestamp), (userId, timestamp), (severity, timestamp)

### Phase D: Post Subsystem Expansion (Gap 6) ✅
**Files Changed:**
- `lib/handlers/content.js` — Added poll creation, link preview, thread support, vote endpoint, poll-results endpoint, thread view endpoint
- `lib/services/link-preview-service.js` — NEW: Safe URL metadata extraction with SSRF protection
- `lib/auth-utils.js` — Updated enrichPosts to include viewerPollVote, isThreadPart
- `app/api/[[...path]]/route.js` — Updated content routing for 3-segment paths (vote, poll-results, thread)

**New Endpoints:**
- `POST /api/content/:id/vote` — Vote on poll post
- `GET /api/content/:id/poll-results` — Get poll results with viewer vote
- `GET /api/content/:id/thread` — Get full thread view

**New Post Sub-Types:** STANDARD, POLL, LINK, THREAD_HEAD, THREAD_PART

**New Collections:**
- `poll_votes` — Indexed: (contentId, userId), (contentId, optionId)

### Documentation Created
- `ANTI_ABUSE_POLICY.md` — Full anti-abuse system documentation
- `POST_FEATURES_CONTRACT_FREEZE.md` — Poll/link/thread contract specification
- `FRONTEND_HANDOFF_INDEX.md` — Master index for frontend team

### Testing
- Testing agent: 100% pass rate across all Phase C & D features
- Regression: All existing endpoints (feed, posts, stories, reels, search, health) verified working

---

## Earlier Phases (2026-03-09 through 2026-03-11)
- Phases A & B of Top 6 Gap Closure (distributionStage fix, cache key fix, story rail verification, reel transcoding)
- Media Lifecycle Hardening (5 critical risks addressed)
- Service Layer Refactor (ScoringService, FeedService, StoryService, ReelService, ContestService)
- Full foundation build (auth, content, social, pages, tribes, stories, reels, search, notifications, governance)
