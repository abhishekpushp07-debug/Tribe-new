# Tribe — Product Requirements Document
**Version**: 4.0
**Last Updated**: 2026-03-11

## Problem Statement
Build a world-best social media backend for "Tribe" — a college-centric social platform. The system serves users across colleges, tribes, houses with content types including Posts, Reels, Stories, and Pages.

## Core Architecture
- **Application**: Next.js 14 monolithic API with Service-Oriented Architecture
- **Database**: MongoDB (local)
- **Media Storage**: Supabase Storage (bucket: `tribe-media`)
- **Video Processing**: ffmpeg (real transcoding pipeline)
- **Testing**: pytest (~1001 tests, 99.9% pass rate)
- **Auth**: Phone + PIN with JWT tokens

## User Personas
1. **Student**: Creates posts, stories, reels. Joins tribes, follows pages
2. **Page Admin**: Manages pages, creates page-authored content
3. **Moderator**: Reviews flagged content, manages reports
4. **Admin/Super Admin**: Platform governance, tribe management, analytics

## Current Feature Status (as of 2026-03-11)

### Stories — 100% ✅
- CRUD: Create, Read, Edit, Delete
- Privacy: EVERYONE, CLOSE_FRIENDS, CUSTOM, hideStoryFrom
- Interactions: Views, Reactions, Replies, Sticker responses
- Story Mutes: Mute/unmute user stories without blocking
- View Duration Tracking: Per-viewer duration + completion analytics
- Bulk Moderation: Batch HOLD/REMOVE/RESTORE/APPROVE (MOD+)
- Sticker Rate Limits: 30/hour per user
- Story Rail: Batched privacy/mute/block filtering (no N+1)
- Admin: Moderate, analytics, archive
- Contract Freeze: STORIES_CONTRACT_FREEZE.md

### Posts — 100% ✅
- CRUD: Create, Read, Edit, Delete
- Post Types: STANDARD, POLL, LINK, THREAD, CAROUSEL
- Polls: Create, Vote, Results with expiry
- Link Previews: Auto-fetched metadata (SSRF-safe)
- Threads: Multi-part threaded posts
- Carousel: Multi-media with explicit ordering (max 10 items)
- Drafts: Create draft, list drafts, publish draft
- Scheduling: Schedule future publish (max 30 days), reschedule, auto-publish worker
- Distribution Pipeline: Stage 0→1→2 auto-promotion
- Feed Cache: Zero cross-user leakage (auth users bypass cache)
- Moderation: On create, on edit, content rejection
- Contract Freeze: POSTS_CONTRACT_FREEZE.md

### Reels — 100% ✅
- CRUD: Create, Read, Patch, Delete, Publish, Archive, Restore
- Video Processing: Real ffmpeg transcoding (MP4 H.264), thumbnail generation
- Feed Types: Default (score), Trending (velocity/age), Personalized (user-aware), Following, Audio
- Creator Analytics: Detailed — daily views/likes trend, retention curve, top engagers, weekly performance
- Interactions: Like, Comment, Share, Save, View tracking
- Anti-abuse: Rate-limited via AntiAbuseService
- Moderation: Full lifecycle
- Contract Freeze: REELS_CONTRACT_FREEZE.md + REEL_PROCESSING_POLICY.md

### Pages — 100% ✅
- CRUD: Create, Read, Update, Archive, Restore, Delete
- Verification Workflow: Request → Admin Review → Approve/Reject with notifications
- Audience: Members, Followers, Admins, Moderators, Editors
- Page Invite System: Invite users with role assignment
- Page Posts: Create as page, page posts in feed
- Page Report: Dedicated report endpoint
- Page Analytics: Daily activity, follower growth, engagement, top posts
- Page Search: Text, category, college-based with verified boost
- Visibility: ACTIVE/ARCHIVED/SUSPENDED/DELETED with proper filtering
- Contract Freeze: PAGES_CONTRACT_FREEZE.md

### Shared Systems — Complete ✅
- Anti-Abuse: 5-layer detection (velocity, burst, same-author, rapid-diverse, cumulative)
- Feed Cache: Zero cross-user leakage, event-driven invalidation
- Moderation Pipeline: Content moderation on create/edit, multi-tier review
- Media Pipeline: Supabase storage, chunked upload, real video transcoding
- Notifications: 12+ types, grouped view, preferences
- Search: Multi-type (users, pages, posts, hashtags, colleges, houses)
- Age Protection: CHILD/ADULT content restrictions
- Audit Trail: 25,000+ audit log entries

## Documentation (22 documents)
All contract freeze docs, operational policies, integration guides, and seed data references are in `/app/memory/`.

## Remaining Roadmap
- **P1: B7 — Test Hardening + Gold Freeze** (zero-flake test suite)
- **P2: B8 — Infra, Observability, Scale Path** (Redis, job queues, dedicated test DB)
- **P3: Audit Log TTL policy**
- **P4: Recommendation engine / ML ranking**
- **P5: Push notifications infrastructure**

## Test Credentials
- All seeded accounts use PIN: `1234`
- Primary test: `7777099001` (ADMIN), `7777099002` (USER)
- Super Admin: `9000000001`, `9000099001`
- See SEED_DATA_REFERENCE.md for full inventory
