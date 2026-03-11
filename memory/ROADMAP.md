# Tribe — Roadmap

## Completed
- Stage B0: API Contract & Manifest
- Stage B1: Canonical Identity & Media
- Stage B2: Visibility & Feed Safety
- Stage B3: Pages System (107 tests)
- Stage B3-U: Ultimate Test Gate (107 tests)
- Stage B4: Core Social Gaps (72 tests)
- Stage B5: Discovery & Hashtag Engine (77 tests)
- Stage B5.1: Search Quality Upgrade (27 tests)
- Stage B6: Notifications 2.0 — Gold Proof (78 tests)
- Media Infra: Supabase Storage Integration (54 tests)
- Media Lifecycle: Hardening — Delete, Expiry, Thumbs (21 tests)
- Tribe/House Cutover: Legacy house → tribes migration
- Tribe Leaderboard v1 & v2: Engagement-ranked leaderboard (31 tests)
- Judge Hardening: 50-param audit — security, perf, caching, indexes
- Stage 9: World's Best Stories (hardened + audited)
- Stage 10: World's Best Reels (39 endpoints, 12 collections)
- Service Layer Files Created: scoring.js, feed-ranking.js

## In Progress (P0)
- **Service Layer Wiring**: Connect scoring.js → tribes.js, feed-ranking.js → feed.js
- Algorithmic feed ranking (replace chronological with engagement-weighted)
- Tiered viral bonuses (1K/5K/10K thresholds) in leaderboard scoring

## Upcoming (P1)
- **Service Extraction**: StoryService (stories.js 2157 lines), ReelService (reels.js 1708 lines), ContestService (tribe-contests.js 1599 lines)
- Thin all large handlers to pure request/response routing

## Future (P2)
- B7: Test Hardening + Gold Freeze — zero-flake suite
- B8: Infra, Observability, Scale Path — Redis job queues, dedicated test DB
- Audit Log TTL policy

## Backlog
- Redis installation for production Pub/Sub
- Video transcoding pipeline
- Recommendation engine / ML ranking
- Push notifications
- Content recommendations AI
- Native Android app shell

## Backend URL
`https://tribal-architecture.preview.emergentagent.com`
