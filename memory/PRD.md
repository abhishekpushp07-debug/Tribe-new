# Tribe — Product Requirements Document
**Version**: 6.0
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

### Session 2 — Critical Bug Fixes (4 bugs)
- Home feed `cache.get()` not awaited → fixed
- Story rail queried wrong collection → fixed
- Reels feed queried wrong collection → fixed
- Reels follow field name mismatch → fixed

### Session 2 — 50 Social Features Added
- Profile & Settings (12), Content Interactions (9), Comment Operations (5)
- Stories (3), Reels (4), Tribes (8), Feed & Discovery (7), Notifications (2)

### Session 2 — 4 World-Class Features Added

#### 1. Full-Text Search with Autocomplete (8 endpoints)
- `GET /search?q=` — Unified search across users, hashtags, content, pages, tribes
- `GET /search/autocomplete?q=` — Real-time suggestions as you type
- `GET /search/users?q=` — Dedicated user search with follow status
- `GET /search/hashtags?q=` — Hashtag search with post counts
- `GET /search/content?q=` — Content/post search
- `GET /hashtags/:tag` — Hashtag detail page (top + recent, total posts)
- `GET /search/recent` — Recent search history
- `DELETE /search/recent` — Clear search history

#### 2. Engagement Analytics Dashboard (8 endpoints)
- `POST /analytics/track` — Track impressions, views, profile visits, clicks
- `GET /analytics/overview` — Full account analytics (engagement, reach, audience, growth %)
- `GET /analytics/content` — Content performance ranking (likes, comments, saves, shares, engagement rate)
- `GET /analytics/content/:id` — Deep analytics per post (time-series, top likers)
- `GET /analytics/audience` — Audience demographics (colleges, tribes, gender, top engagers)
- `GET /analytics/reach` — Reach & impressions time series + top performing content
- `GET /analytics/reels` — Reel performance analytics
- `GET /analytics/profile-visits` — Profile visit details with recent visitors

#### 3. Follow Request System (7 endpoints)
- Private account toggle via `PATCH /me/privacy` with `{"isPrivate": true}`
- `POST /follow/:id` — Auto-creates follow request for private accounts
- `GET /me/follow-requests` — View pending requests received
- `GET /me/follow-requests/sent` — View sent requests
- `GET /me/follow-requests/count` — Badge count for pending requests
- `POST /follow-requests/:id/accept` — Accept request (creates follow)
- `POST /follow-requests/:id/reject` — Reject request
- `DELETE /follow-requests/:id` — Cancel sent request
- `POST /follow-requests/accept-all` — Bulk accept all

#### 4. Video Transcoding (HLS Streaming) (6 endpoints)
- `POST /transcode/:mediaId` — Start transcoding job with quality presets
- `GET /transcode/:jobId/status` — Real-time job status tracking
- `GET /transcode/media/:mediaId` — Get transcode info for any media
- `GET /transcode/queue` — View job queue with aggregate stats
- `GET /media/:id/stream` — HLS master playlist (adaptive bitrate variants)
- `GET /media/:id/thumbnails` — Auto-generated thumbnails at key frames
- Quality presets: 1080p, 720p, 480p, 360p, 240p
- Background processing with progress tracking

### Pre-existing Features
- Full Story/Reel/Post CRUD with all interactions
- Pages, Events, Tribes, Notifications, Discovery
- Complete social graph (follow, like, comment, save, share, report, block)

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
