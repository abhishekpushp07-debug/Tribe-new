# Tribe — Product Requirements Document

## Original Problem Statement
Build a "world-best" social media backend for the app "Tribe" — a campus-native social platform. Development follows a rigid multi-stage plan (B0-B8) with contract-driven development, centralized policy enforcement, and canonical data objects.

## Architecture
- **Stack**: Monolithic Next.js API backend + MongoDB
- **Testing**: pytest suite
- **Key Patterns**: Contract-Driven Development, Centralized Policy (access-policy.js), Canonical Serializers (entity-snippets.js)
- **Collections**: users, sessions, content_items, follows, reactions, saves, comments, notifications, media_assets, audit_logs, pages (B3), page_members (B3), page_follows (B3), reels, stories, ...

## Stage Completion Status

### ✅ B0 — API Contract & Manifest (DONE)
- 266 live API routes documented
- Full route manifest, domain map, response contracts, quirk ledger
- TypeScript API client generated

### ✅ B1 — Canonical Identity & Media Resolution (DONE)
- `toUserSnippet()`, `toUserProfile()`, `toMediaObject()`, `resolveMediaUrl()` in entity-snippets.js
- All avatar URLs resolved consistently across all surfaces

### ✅ B2 — Visibility, Permission & Feed Safety (DONE)
- Centralized `access-policy.js` with `canViewContent()`, `isContentListable()`, `applyFeedPolicy()`
- Block relationships enforced across all feeds and content detail endpoints
- Cache-bypass bug fixed for block filters

### ✅ B3 — Pages System (DONE)
- First-class Page entity with 18+ new API endpoints
- Multi-role team management (OWNER > ADMIN > EDITOR > MODERATOR)
- Publishing as page — reuses existing content engine
- Public author = Page (PageSnippet), Audit actor = real user (actingUserId + actingRole)
- Follow/unfollow pages with counter management
- Feed integration: followed page posts appear in following feed
- Search integration: pages searchable by name/slug/category
- Notification integration: page interactions notify OWNER+ADMIN members
- Official page spoofing prevention
- Page lifecycle: ACTIVE → ARCHIVED → restored
- Migration backfill for legacy content (authorType=USER)
- 50 targeted B3 tests + 396 existing tests = 446 total tests passing

### ⬜ B4 — Core Social Gaps (NOT STARTED)
- ~8 missing endpoints: edit post, share post, like comment, etc.

### ⬜ B5 — Discovery, Search & Hashtag Engine (NOT STARTED)
- Hashtag extraction, fix post search (Issue 1)

### ⬜ B6 — Notifications 2.0 + Reels/Post Polish (NOT STARTED)
- Advanced notifications, fix reel interaction bugs (Issue 2)

### ⬜ B7 — Test Hardening + Gold Freeze (NOT STARTED)
- Target 900+ tests

### ⬜ B8 — Infra, Observability, Scale Path (NOT STARTED)
- 3-layer refactor, job queues, Redis, separate test DB, audit log TTL

## Known Issues
1. **Post Search Not Working** (P1) — deferred to B5
2. **Reel Interaction Bugs** (P1) — deferred to B6
3. **Separate Test DB** — deferred to B8
4. **Audit Log TTL** — deferred to B8

## B3 New API Surface (18 endpoints)
| Endpoint | Auth | Role |
|---|---|---|
| POST /api/pages | User | - |
| GET /api/pages | Public | - |
| GET /api/pages/:idOrSlug | Public | - |
| PATCH /api/pages/:id | User | OWNER/ADMIN |
| POST /api/pages/:id/archive | User | OWNER |
| POST /api/pages/:id/restore | User | OWNER |
| GET /api/pages/:id/members | User | Any member |
| POST /api/pages/:id/members | User | OWNER/ADMIN |
| PATCH /api/pages/:id/members/:userId | User | OWNER/ADMIN |
| DELETE /api/pages/:id/members/:userId | User | OWNER/ADMIN (or self) |
| POST /api/pages/:id/transfer-ownership | User | OWNER |
| POST /api/pages/:id/follow | User | - |
| DELETE /api/pages/:id/follow | User | - |
| GET /api/pages/:id/followers | User | Any member |
| GET /api/pages/:id/posts | Public | - |
| POST /api/pages/:id/posts | User | OWNER/ADMIN/EDITOR |
| PATCH /api/pages/:id/posts/:postId | User | OWNER/ADMIN/EDITOR |
| DELETE /api/pages/:id/posts/:postId | User | OWNER/ADMIN/EDITOR |
| GET /api/me/pages | User | - |

## B3 Data Model
### pages collection
slug (unique), name, bio, category, subcategory, avatarMediaId, coverMediaId, status, isOfficial, verificationStatus, linkedEntityType, linkedEntityId, collegeId, tribeId, createdByUserId, followerCount, memberCount, postCount

### page_members collection
pageId, userId, role, status, addedByUserId

### page_follows collection
pageId, userId

### content_items extensions (B3)
authorType (USER|PAGE), pageId, actingUserId, actingRole, createdAs (USER|PAGE)
