# Tribe — Frozen Contracts (Phase 0)

> These contracts are LOCKED. No breaking changes without formal migration plan.

## Frozen Routes

### Auth (7 routes)
- `POST /api/auth/register` → `{ token, user }`
- `POST /api/auth/login` → `{ token, user }`
- `POST /api/auth/logout` → `{ message }`
- `PATCH /api/me/profile` → `{ user }`
- `PATCH /api/me/age` → `{ user }`
- `POST /api/me/college` → `{ user }`
- `GET /api/me` → `{ user }`

### Content (4 routes)
- `POST /api/content/posts` → `{ post }` (with moderation metadata)
- `GET /api/content/:id` → `{ content }`
- `DELETE /api/content/:id` → soft-remove (visibility=REMOVED)
- `GET /api/content/posts` → `{ items, nextCursor }`

### Feeds (6 routes)
- `GET /api/feed/public` → `{ items, nextCursor, feedType }`
- `GET /api/feed/following` → `{ items, nextCursor, feedType }`
- `GET /api/feed/college/:collegeId` → `{ items, nextCursor, feedType }`
- `GET /api/feed/house/:houseId` → `{ items, nextCursor, feedType }`
- `GET /api/feed/stories` → `{ storyRail }`
- `GET /api/feed/reels` → `{ items, nextCursor, feedType }`

### Social (8 routes)
- `POST /api/follow/:userId` → follow
- `DELETE /api/follow/:userId` → unfollow
- `POST /api/content/:id/like` → like
- `POST /api/content/:id/dislike` → dislike (internal only)
- `DELETE /api/content/:id/reaction` → remove reaction
- `POST /api/content/:id/save` → save
- `DELETE /api/content/:id/save` → unsave
- `POST /api/content/:id/comments` → `{ comment }`

### Moderation Adapter (3 routes)
- `GET /api/moderation/config` → provider chain info
- `POST /api/moderation/check` → `{ action, confidence, scores }`
- `GET /api/moderation/queue` → `{ items, bucket }`

### Governance (8 routes)
- Board: GET board, POST apply, POST vote (application), POST proposals, GET proposals, POST vote (proposal), POST seed-board
- House Points: GET config, GET ledger, GET house/:id, POST award, GET leaderboard

### Ops (4 routes)
- `GET /api/healthz`, `GET /api/readyz`, `GET /api/ops/health`, `GET /api/ops/metrics`

## Frozen Collections (27)

| Collection | Key Indexes | Purpose |
|---|---|---|
| users | id, phone, collegeId, houseId, normalizedName | User profiles |
| sessions | token, userId, expiresAt | Auth sessions |
| audit_logs | eventType+createdAt, actorId, targetId | Append-only audit |
| content_items | authorId, visibility+kind+createdAt, collegeId, houseId | Posts/reels/stories |
| follows | followerId+followeeId, followeeId | Social graph |
| reactions | userId+contentId, contentId | Likes/dislikes |
| comments | contentId+createdAt, authorId | Comments |
| saves | userId+contentId | Bookmarks |
| reports | targetId, status+createdAt, reporterId | Reports |
| appeals | userId+targetId, status | Appeals |
| moderation_events | targetId, eventType+createdAt, actorId | Moderation audit |
| moderation_audit_logs | - | AI moderation audit |
| moderation_review_queue | - | AI moderation review |
| strikes | userId | Policy strikes |
| suspensions | userId | Suspensions |
| grievance_tickets | userId, status+dueAt, ticketType, priority | Grievance SLA |
| colleges | normalizedName, aisheCode, state, type | College registry |
| houses | - | House entities |
| house_ledger | userId, houseId, idempotencyKey | Points ledger |
| board_seats | collegeId+status, userId | Board seats |
| board_applications | collegeId+status, userId | Board applications |
| board_proposals | collegeId+status | Board proposals |
| media_assets | ownerId, id | Media storage |
| consent_notices | active | Consent versioning |
| consent_acceptances | userId | Consent records |
| notifications | userId+createdAt | User notifications |
| feature_flags | key | Feature flags |

## Breaking Change Rules

1. **Never rename** a frozen collection or its indexed fields
2. **Never change** response shape of frozen routes (additive fields OK)
3. **Never remove** a frozen route — deprecate with 30-day notice
4. **New indexes** on frozen collections are allowed (additive)
5. **New fields** on frozen documents are allowed (additive, must have defaults)
