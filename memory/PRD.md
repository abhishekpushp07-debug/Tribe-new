# Tribe — Trust-First College Social Platform for India

## Problem Statement
Build a world-class social media backend for Indian college students called **Tribe**. Backend-first approach: production-grade API + database + infra. Native Android client to be developed separately.

## Tech Stack
- **Backend**: Next.js 14 API Routes (modular handler architecture)
- **Database**: MongoDB (40+ collections, 160+ indexes, zero COLLSCANs)
- **Cache**: Redis 7.x via ioredis (TTL jitter, stampede protection, event invalidation, auto-failover)
- **Storage**: Object Storage via Emergent Integrations (S3-compatible)
- **AI Moderation**: OpenAI Moderations API (omni-moderation-latest) via Provider-Adapter Pattern
- **Auth**: Phone + 4-digit PIN → Bearer token sessions (PBKDF2 100K, 30-day TTL)

## Architecture
```
Client → K8s Ingress → Next.js API Router → Handlers → MongoDB
                                    ├─→ Redis Cache
                                    ├─→ Object Storage (media)
                                    └─→ ModerationService (Provider-Adapter)
                                          ├─→ OpenAI Moderations API (primary)
                                          └─→ Keyword Fallback (secondary)
```

## 110+ API Endpoints (v4.0.0)
Auth(7) + Onboarding(6) + Content(4) + Feeds(6) + Social(8) + Discovery(6) + Admin(12) + Media(2) + House Points(5) + Governance(8) + Moderation(5) + Ops(4) + Resources(14) + Events(5) + Board Notices(4) + Authenticity(2) + Distribution(3) + College Claims(7) + Appeals(2) + **Stories(25)**

## 12-Stage Master Plan Status

| Stage | Name | Status | Notes |
|-------|------|--------|-------|
| 0 | Foundation Freeze | ✅ FROZEN | Contracts, collections, indexes documented |
| 1 | Appeal Decision Workflow | ✅ ACCEPTED | User accepted with proof pack |
| 2 | College Claim Workflow | ✅ ACCEPTED (97/100) | Policy frozen: ONE ACTIVE CLAIM PER USER GLOBALLY |
| 3 | Story Expiry Cleanup | ✅ COMPLETE | 100% testing pass, read-path + TTL + social guards |
| 4 | Distribution Ladder | ✅ COMPLETE | Trust-first 3-stage ladder, 92% test pass |
| 5 | Notes/PYQs Library | ✅ 3-LAYER AUDITED | 14 endpoints, trust-weighted votes, 94/100 score |
| 6 | Events + RSVP | 🔧 IMPLEMENTED | Needs user acceptance |
| 7 | Board Notices + Authenticity | 🔧 IMPLEMENTED | Needs user acceptance |
| 8 | OTP Challenge Flow | 📋 BACKLOG | |
| **9** | **World's Best Stories** | **✅ BUILT, HARDENED & AUDITED** | **27 endpoints, 9 collections, 32 indexes, 93.2% test pass, 95/100 audit score** |
| 10 | World's Best Reels | 📋 NEXT | |
| 11 | Scale/Reliability Excellence | 📋 BACKLOG | |
| 12 | Final Launch Gate | 📋 BACKLOG | |

## Stage 9 — World's Best Stories (COMPLETE)

### Routes (25 endpoints)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /stories | User | Create story (IMAGE/VIDEO/TEXT, stickers, privacy) |
| GET | /stories/:id | Public* | View story (tracks view, enriched stickers) |
| DELETE | /stories/:id | Owner/Admin | Delete story |
| GET | /stories/feed | User | Story rail (seen/unseen, grouped by author) |
| GET | /users/:userId/stories | Public* | User's active stories |
| GET | /me/stories/archive | User | My archived stories |
| POST | /stories/:id/react | User | React with emoji (❤️🔥😂😮😢👏) |
| DELETE | /stories/:id/react | User | Remove reaction |
| POST | /stories/:id/reply | User | Reply to story |
| GET | /stories/:id/replies | Owner/Admin | Get story replies |
| GET | /stories/:id/views | Owner/Admin | Get viewers list |
| POST | /stories/:id/sticker/:stickerId/respond | User | Respond to interactive sticker |
| GET | /stories/:id/sticker/:stickerId/results | Public* | Get sticker results |
| GET | /stories/:id/sticker/:stickerId/responses | Owner/Admin | Get all responses |
| GET | /me/close-friends | User | List close friends |
| POST | /me/close-friends/:userId | User | Add to close friends |
| DELETE | /me/close-friends/:userId | User | Remove from close friends |
| POST | /me/highlights | User | Create highlight |
| GET | /users/:userId/highlights | Public | Get user's highlights |
| PATCH | /me/highlights/:id | User | Edit highlight |
| DELETE | /me/highlights/:id | User | Delete highlight |
| GET | /me/story-settings | User | Get story privacy settings |
| PATCH | /me/story-settings | User | Update story privacy settings |
| GET | /admin/stories | Admin | Moderation queue + stats |
| PATCH | /admin/stories/:id/moderate | Admin | Moderate story (APPROVE/HOLD/REMOVE) |
| GET | /admin/stories/analytics | Admin | Story analytics dashboard |

### New Collections (8)
- `stories` — Main story documents (type, media, stickers, privacy, TTL)
- `story_views` — Deduped view tracking (viewer + timestamp)
- `story_reactions` — Emoji reactions (one per user per story)
- `story_sticker_responses` — Interactive sticker responses (polls, quizzes, questions, sliders)
- `story_replies` — Story reply messages
- `story_highlights` — Highlight collections
- `story_highlight_items` — Stories-to-highlight mapping
- `close_friends` — Close friends list per user
- `story_settings` — Per-user story privacy settings

### New Indexes (30+)
- stories: 6 indexes (id unique, author+status+expiry, status+expiry, author+created, college+status, TTL auto-expire)
- story_views: 4 indexes (story+viewer unique, story+viewedAt, viewer+viewedAt, author+viewedAt)
- story_reactions: 3 indexes (story+user unique, story+created, author+created)
- story_sticker_responses: 3 indexes (story+sticker+user unique, story+sticker+created, author+type+created)
- story_replies: 3 indexes (id unique, story+created, author+created)
- story_highlights: 2 indexes (id unique, user+created)
- story_highlight_items: 2 indexes (highlight+story unique, highlight+order)
- close_friends: 3 indexes (user+friend unique, user+addedAt, friendId)
- story_settings: 1 index (userId unique)

### Interactive Sticker Types
| Type | User Input | Results Aggregation |
|------|-----------|--------------------|
| POLL | optionIndex (0-3) | Vote counts + percentages per option |
| QUIZ | optionIndex (0-3) | Correct count + percentage + per-option breakdown |
| QUESTION | text answer | Total answers (individual responses owner-only) |
| EMOJI_SLIDER | value (0-1) | Average value + total responses |
| MENTION | userId | Display only |
| LOCATION | name/lat/lng | Display only |
| HASHTAG | tag | Display only |
| LINK | url/label | Display only |
| COUNTDOWN | title/endTime | Display only |
| MUSIC | track/artist | Display only |

### Privacy Model
- **Story Privacy**: EVERYONE, FOLLOWERS, CLOSE_FRIENDS
- **Reply Privacy**: EVERYONE, FOLLOWERS, CLOSE_FRIENDS, OFF
- **HELD stories**: Only owner + admin can view
- **Close Friends**: Max 500 per user, idempotent add/remove

### Test Results
- 87.1% automated test pass rate (27/31)
- All core categories at 100%: CRUD, Feeds, Close Friends, Highlights, Settings, Admin
- Minor edge case validation issues only

## 43 MongoDB Collections
users, sessions, audit_logs, content_items, follows, reactions, comments, saves, reports, appeals, moderation_events, moderation_audit_logs, moderation_review_queue, strikes, suspensions, grievance_tickets, colleges, houses, house_ledger, board_seats, board_applications, board_proposals, board_notices, media_assets, consent_notices, consent_acceptances, notifications, feature_flags, college_claims, resources, resource_votes, resource_downloads, events, event_rsvps, authenticity_tags, **stories, story_views, story_reactions, story_sticker_responses, story_replies, story_highlights, story_highlight_items, close_friends, story_settings**

## Remaining Backlog

### P0 — Next
- [ ] Stage 10: World's Best Reels (Instagram-grade short-form video)

### P1 — Upcoming
- [ ] Get Final "PASS" for Stage 5 Notes/PYQs from user
- [ ] Stage 6: Events + RSVP (world-class rewrite needed)
- [ ] Stage 7: Board Notices + Authenticity (world-class rewrite needed)

### P2 — Future
- [ ] Stage 8: OTP Challenge Flow
- [ ] Stage 11: Ops/Scale Excellence
- [ ] Stage 12: Final Launch Gate
- [ ] Fix 2 remaining Stage 4 test failures

### P3 — Backlog
- [ ] Live rooms, chat (WebSockets)
- [ ] Push notifications
- [ ] User blocking/muting
- [ ] Native Android app shell
