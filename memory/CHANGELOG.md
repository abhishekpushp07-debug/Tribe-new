# Tribe — Changelog

## Mar 8, 2026 — Stage 5 Notes/PYQs Library (WORLD-CLASS REWRITE)

### What Changed
- **Complete rewrite** of Notes/PYQs Library from 5 basic endpoints to 12 world-class endpoints
- **Vote system**: UP/DOWN helpfulness votes with self-vote prevention, vote switching, atomic score updates
- **Download tracking**: Dedicated endpoint with per-user 24h dedup (prevents bot inflation)
- **Redis caching**: Search results (30s) and detail views (60s) cached with stampede protection + event-driven invalidation
- **College membership guard**: Users can only upload resources to their own college
- **Admin moderation**: Full review queue with APPROVE/HOLD/REMOVE actions and audit trails
- **My uploads**: Dedicated endpoint for users to manage their uploaded resources
- **Report dedup**: Duplicate report prevention (409), atomically incremented reportCount, auto-hold at 3+ reports
- **Faceted search**: Returns kind/semester/branch counts when filtering by college
- **Multi-kind filter**: `kind=NOTE,PYQ` works
- **Sort options**: recent (default), popular (voteScore), most_downloaded
- **PATCH endpoint**: Owners can update resource metadata with moderation check
- **New fields**: year (exam year for PYQs), collegeName (denormalized), voteScore, voteCount

### Files Modified
- `/app/lib/handlers/stages.js` — Complete rewrite of handleResources (~350 lines)
- `/app/lib/constants.js` — Added ResourceKind, ResourceStatus, ResourceConfig
- `/app/lib/cache.js` — Added RESOURCE_SEARCH/RESOURCE_DETAIL namespaces + RESOURCE_CHANGED event
- `/app/app/api/[[...path]]/route.js` — Added routing for /me/resources and /admin/resources

### Routes (12 endpoints)
| Method | Path | Description |
|--------|------|-------------|
| POST | /resources | Create resource (college guard + moderation) |
| GET | /resources/search | Faceted search, cached, 3 sort modes |
| GET | /resources/:id | Detail with uploader + college + tags, cached |
| PATCH | /resources/:id | Update metadata (owner) |
| DELETE | /resources/:id | Soft-remove (owner/mod) |
| POST | /resources/:id/report | Report (dedup, auto-hold at 3+) |
| POST | /resources/:id/vote | UP/DOWN vote (self-vote blocked) |
| DELETE | /resources/:id/vote | Remove vote |
| POST | /resources/:id/download | Track download (24h dedup) |
| GET | /me/resources | My uploads |
| GET | /admin/resources | Admin review queue + stats |
| PATCH | /admin/resources/:id/moderate | APPROVE/HOLD/REMOVE |

### Indexes (11 new)
- resources: 8 indexes (search, uploader, subject, text, popular, admin_queue, downloads, id_unique)
- resource_votes: 2 indexes (unique vote, resource lookup)
- resource_downloads: 1 index (dedup check)
- **ZERO COLLSCANs** confirmed via explain plans on all 5 critical query patterns

### New Collections
- `resource_votes` — Vote tracking
- `resource_downloads` — Download dedup tracking

### Test Results: 32/32 automated tests (100%) + 30 manual curl tests

---

## Mar 8, 2026 — Stage 4 Distribution Ladder (WORLD-CLASS)

### What Changed
- **Complete rewrite** of distribution evaluation engine with stored signals + explainable decisions
- **Feed integration**: Public feed = Stage 2 ONLY, College/House = Stage 1+, Following = all stages
- **New routes**: Single evaluate, inspect (admin detail), override remove
- **Override protection**: Admin overrides survive auto-evaluation (OVERRIDE_PROTECTED)
- **Safety coupling**: Moderation hold, active strikes, suspension, reports → automatic demotion
- **Explainable blocked reasons**: Human-readable strings (e.g., "account_age_1d_need_7d, likes_0_need_1")
- **Decision signals stored** on every evaluation for full auditability

### Files Modified
- `/app/lib/handlers/stages.js` — Complete rewrite of handleDistribution + evaluateDistribution
- `/app/lib/handlers/feed.js` — Added distributionStage filters to public, college, house feeds
- `/app/lib/constants.js` — (no changes needed, rules in handler)

### Routes (7)
| Method | Path | Description |
|--------|------|-------------|
| POST | /admin/distribution/evaluate | Batch evaluate all Stage 0/1 |
| POST | /admin/distribution/evaluate/:id | Single evaluate |
| GET | /admin/distribution/config | Rules + stage meanings |
| GET | /admin/distribution/inspect/:id | Full detail + signals + audit |
| POST | /admin/distribution/override | Manual override (survives eval) |
| DELETE | /admin/distribution/override/:id | Remove override |

### Indexes Added
- `idx_distribution_feed`: {distributionStage:1, visibility:1, kind:1, createdAt:-1}

### Test Results: 81.2% testing agent + manual proof all passing

---

### What Changed
- **Fixed direct fetch leak**: `GET /content/:id` now returns **410 Gone** for expired stories (was showing them)
- **Fixed profile stories**: `GET /users/:id/posts?kind=STORY` now filters expired stories via `expiresAt: {$gt: new Date()}`
- **Fixed admin stats**: Story count excludes expired stories
- **Fixed social action leak**: Like/dislike/comment on expired stories now returns **410 Gone** (added `isExpiredStory()` guard)
- **TTL index was already correct**: `expiresAt_1` with `partialFilterExpression: {kind: "STORY"}`, `expireAfterSeconds: 0`

### Files Modified
- `/app/lib/handlers/content.js` — Added expired-story guard to `GET /content/:id`
- `/app/lib/handlers/users.js` — Added expired-story filter to `GET /users/:id/posts?kind=STORY`
- `/app/lib/handlers/admin.js` — Admin stats counts only active stories
- `/app/lib/handlers/social.js` — Added `isExpiredStory()` guard to like/dislike/comment

### Read Path Audit (all 7 surfaces)
| Surface | Expired Story Behavior |
|---------|----------------------|
| Story rail (`/feed/stories`) | Hidden (query filter) |
| Direct fetch (`/content/:id`) | 410 Gone |
| Profile (`/users/:id/posts?kind=STORY`) | Hidden (query filter) |
| Public feed (`/feed/public`) | Never shown (kind=POST) |
| Following feed (`/feed/following`) | Never shown (kind=POST) |
| Social actions (like/dislike/comment) | 410 Gone |
| Admin stats | Excludes expired |

### Test Results: 100% pass (testing agent) + 18 manual proof tests

---

### What Changed
- **Complete rewrite** of Stage 2 College Claim handler in `/app/lib/handlers/stages.js`
- **Clean field rename**: proofType→claimType, proofBlobkey→evidence, createdAt→submittedAt, reviewerId→reviewedBy, reviewNote→reviewNotes, fraudSuspicion→fraudFlag
- **New status**: FRAUD_REVIEW added as proper workflow state (not just a boolean)
- **New route**: `GET /api/admin/college-claims/:id` — full admin detail view with claimant, college, review history, audit trail
- **Explicit cooldownUntil**: Stored on rejection (7 days from decision), not calculated dynamically
- **reviewReasonCodes**: Array of reason codes on decisions (not just a string note)
- **Auto-fraud**: 3+ lifetime rejections → claim auto-enters FRAUD_REVIEW status
- **Added ClaimStatus + ClaimConfig** to `/app/lib/constants.js`

### Indexes Rebuilt (4 optimized)
- `idx_user_status` — active claim check
- `idx_user_college_cooldown` — cooldown enforcement
- `idx_admin_queue` — admin review queue with fraud-first sorting
- `idx_claim_id_unique` — unique claim lookup

### Test Results: 94.1% (testing agent) + 25/25 manual proof
- Functional tests (17): All pass
- Contract tests (5): All pass
- Integrity tests (3): All pass
- Auto-fraud detection: Verified
- FRAUD_REVIEW → decide: Verified
- Permission tests: Verified

---

## Mar 8, 2026 — Stage 1 Appeal Decision Workflow (ACCEPTED)

### Stage 1: Appeal Decision Workflow ✅
- `PATCH /api/appeals/:id/decide` — Moderator approves/rejects appeals
- Strike reversal + content visibility restore on approval
- Suspension auto-lift when strike count drops below threshold
- REQUEST_MORE_INFO intermediate state
- Moderation event + audit trail recording
- User notification on every decision

---

## Mar 8, 2026 — Provider-Adapter Moderation Refactor

### Files created/modified
- `/app/lib/moderation/config.js` — ENV-driven config
- `/app/lib/moderation/rules.js` — Risk score engine with category weights
- `/app/lib/moderation/provider.js` — Factory with singleton pattern
- `/app/lib/moderation/providers/openai.provider.js` — OpenAI Moderations API
- `/app/lib/moderation/providers/fallback-keyword.provider.js` — Keyword safety net
- `/app/lib/moderation/providers/composite.provider.js` — OpenAI + fallback chain
- `/app/lib/moderation/repositories/moderation.repository.js` — Audit + review queue
- `/app/lib/moderation/services/moderation.service.js` — Orchestrator
- `/app/lib/moderation/middleware/moderate-create-content.js` — Handler utility
- `/app/lib/moderation/routes/moderation.routes.js` — API endpoints
