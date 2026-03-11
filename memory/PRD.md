# Tribe — Product Requirements Document (PRD)
**Last Updated**: 2026-03-11

## Original Problem Statement
Build a "world-best" social media backend for the Tribe app. The project has gone through multiple phases of hardening, refactoring, and feature expansion to achieve near-world-best backend standard.

## Core Architecture
- **Runtime**: Next.js 15 (App Router) API routes
- **Database**: MongoDB (local)
- **Media Storage**: Supabase Storage
- **Video Processing**: ffmpeg (system dependency)
- **Cache**: In-memory (Redis planned for future)
- **Auth**: Phone/PIN with JWT Bearer tokens

## What's Been Implemented

### Phase 1-3: Foundation (Completed)
- Full auth system (phone/PIN, JWT, refresh tokens)
- Content CRUD (posts, reels, stories)
- Social graph (follow, block, notifications)
- Pages system with dual-author model
- Tribes & contests with leaderboard
- Events, resources, governance, college/house systems
- Full moderation pipeline
- Search with hashtag system

### Phase 4: Service Layer Refactor (Completed)
- Extracted ScoringService, FeedService, StoryService, ReelService, ContestService, MediaService
- Algorithmic feed ranking
- Tiered viral bonuses for leaderboard

### Phase 5: Media Lifecycle Hardening (Completed)
- Batch seeding, thumbnail/expiration states
- Pollution control, safe idempotent deletion
- Media lifecycle state machine (UPLOADING → PROCESSING → READY → FAILED)

### Phase 6: Top 6 Gap Closure (COMPLETED ✅)

#### Phase A — Core Correctness (Completed)
- **Gap 1**: Fixed post distributionStage auto-promotion pipeline
- **Gap 2**: Fixed ranked feed cache key collision (per-user keys)
- **Gap 3**: Verified story rail N+1 already solved by service refactor

#### Phase B — Media Production Readiness (Completed)
- **Gap 4**: Implemented real reel transcoding with ffmpeg

#### Phase C — Anti-Abuse Hardening (COMPLETED ✅)
- **Gap 5**: Full anti-abuse system with 5-layer detection
  - Velocity checks, burst detection, same-author concentration
  - Rapid diverse targeting, cumulative escalation
  - Wired into ALL engagement surfaces: like, comment, share, save, follow, story reactions (in social.js, stories.js, reels.js)
  - Admin abuse dashboard + detailed audit log endpoints
  - Honest scope documentation

#### Phase D — Post Subsystem Expansion (COMPLETED ✅)
- **Gap 6**: Posts upgraded to match reels/stories product depth
  - **Poll Posts**: Create with 2-6 options, vote, prevent double-votes, expiry, results endpoint
  - **Link Preview Enrichment**: Async URL metadata fetch with SSRF protection, safe degradation
  - **Thread/Long-Form Mode**: Multi-part linked posts (max 20 parts), thread reader endpoint, auto-promoting parent to THREAD_HEAD
  - Feed serializers updated with postSubType, viewerPollVote, isThreadPart fields
  - All existing post/media functionality preserved (regression-free)

## Test Credentials
Register new: `POST /api/auth/register { phone, pin, displayName }`
- `7777099001` / `1234` (ADMIN, ADULT)
- `7777099002` / `1234` (USER)

## DB Collections Added in Phase 6
- `poll_votes`: { id, contentId, userId, optionId, createdAt }
- `abuse_audit_log`: { userId, actionType, targetId, severity, reason, blocked, timestamp }

## Freeze Documents
- ANTI_ABUSE_POLICY.md
- POST_FEATURES_CONTRACT_FREEZE.md
- MEDIA_CONTRACT_FREEZE.md
- REELS_CONTRACT_FREEZE.md
- SEARCH_CONTRACT_FREEZE.md
- NOTIFICATIONS_CONTRACT_FREEZE.md

## API Endpoint Count: 150+ across 16+ domains

## Remaining Roadmap
- **P1: B7 — Test Hardening + Gold Freeze** (zero-flake test suite)
- **P2: B8 — Infra, Observability, Scale Path** (Redis, job queues, dedicated test DB)
- **P3: Audit Log TTL policy**
- **P4: Recommendation engine / ML ranking**
- **P5: Push notifications infrastructure**
