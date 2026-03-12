# Tribe — Product Requirements Document
**Version**: 7.0
**Last Updated**: 2026-03-12

## Problem Statement
Build a world-best social media backend for "Tribe" — a college-centric social platform with Posts, Reels, Stories, and Pages.

## Core Architecture
- **Application**: Next.js 14 monolithic API with Service-Oriented Architecture
- **Database**: MongoDB (local)
- **Media Storage**: Supabase Storage (bucket: `tribe-media`)
- **Video Processing**: ffmpeg (HLS transcoding, multi-quality, thumbnail extraction)
- **Testing**: pytest (~1001 tests, 99.9% pass rate)
- **Auth**: Phone + PIN with JWT tokens

## Feature Status (as of 2026-03-12)

### Session 2 — Critical Bug Fixes (4 bugs) ✅
- Home feed `cache.get()` not awaited → fixed
- Story rail queried wrong collection → fixed
- Reels feed queried wrong collection → fixed
- Reels follow field name mismatch → fixed

### Session 2 — 50 Social Features Added ✅
- Profile & Settings (12), Content Interactions (9), Comment Operations (5)
- Stories (3), Reels (4), Tribes (8), Feed & Discovery (7), Notifications (2)

### Session 2 — 4 World-Class Features Added ✅

#### 1. Full-Text Search with Autocomplete (8 endpoints)
- Unified search, autocomplete, user/hashtag/content/page/tribe search
- Recent search tracking, type validation, result counts
- **Enhanced**: Added reelCount in hashtag search, totalResults in unified search, type validation

#### 2. Engagement Analytics Dashboard (9 endpoints)
- Track events, overview, content, audience, reach, profile-visits, reels analytics
- **Enhanced**: Added story analytics endpoint, time-series gap filling, unique visitor deduplication

#### 3. Follow Request System (7 endpoints)
- Private account toggle, send/accept/reject requests, bulk accept
- **Enhanced**: Added block checking, rate limiting (30/hour)

#### 4. Video Transcoding (HLS Streaming) (8 endpoints)
- Transcode, status, queue with filters, stream, thumbnails
- **Enhanced**: Added job cancellation, retry with max 3 attempts, cancellation-during-processing

### Session 3 — "90+ Enhancement Pass" ✅ (COMPLETED)

#### Database Indexes (db.js)
- Added 30+ new indexes: follow_requests, recent_searches, analytics_events, profile_visits, transcode_jobs, tribe_cheers, likes, shares

#### Tribes Handler (tribes.js)
- Enhanced pagination with hasMore/limit/offset in members and salutes lists
- Added audit trail for join/leave/cheer actions
- Added tribeCode in membership records
- Fixed duplicate key error handling for tribe join

#### Search Handler (search.js)
- Added type validation for search filters
- Added totalResults count in unified search
- Added reelCount and totalCount in hashtag search

#### Analytics Handler (analytics.js)
- Added time-series gap filling for consistent charting
- Added unique visitor deduplication using addToSet
- NEW: Story analytics endpoint (totalStories, viewsByDay, per-story metrics)

#### Transcode Handler (transcode.js)
- Added status filter for queue
- NEW: Job cancellation endpoint with mid-process cancellation
- NEW: Job retry endpoint with max 3 attempts
- Added queue total count

#### Follow Requests Handler (follow-requests.js)
- Added block checking before sending follow requests
- Added rate limiting (30 requests/hour)

### Pre-existing Features
- Full Story/Reel/Post CRUD with all interactions
- Pages, Events, Tribes, Notifications, Discovery
- Complete social graph (follow, like, comment, save, share, report, block)
- Anti-abuse system, polls, link previews, threads

## Remaining Roadmap
- **P1:** Write pytest tests for all new features (Master Prompt requirement)
- **P2:** Smart Feed Algorithm (ML-like ranking with engagement prediction)
- **P3:** Content Recommendations ("Suggested Posts", "Reels You May Like")
- **P4:** Activity Status ("Active now", "Active 2h ago")
- **P5:** Smart Suggestions ("People you may know", "Trending in your college")
- **P6:** Content Quality Scoring (auto spam detection, shadow-ban)
- **P7:** Redis caching layer for performance
- **P8:** Phase 2-6 Master Prompt sprints

## Test Credentials
- Admin: `7777099001` / PIN: `1234`
- User: `7777099002` / PIN: `1234`
