# Tribe — Product Requirements Document

## Original Problem Statement
Build a "world-best" social media backend for the app "Tribe" — a campus-native social platform. Development follows a rigid multi-stage plan (B0-B8) with contract-driven development, centralized policy enforcement, and canonical data objects.

## User Personas
- **Students**: Primary users. Browse feeds, create posts, follow users/pages, join tribes.
- **Community Managers**: Run club/dept/fest pages, publish as page, manage team.
- **Admins**: Moderate content, verify official pages, manage platform.

## Architecture
- **Stack**: Monolithic Next.js API backend + MongoDB
- **Testing**: pytest suite (446 tests)
- **Key Patterns**: Contract-Driven Development, Centralized Policy (access-policy.js), Canonical Serializers (entity-snippets.js)
- **Collections**: users, sessions, content_items, follows, reactions, saves, comments, notifications, media_assets, audit_logs, pages, page_members, page_follows, reels, stories, ...

## Core Requirements

### Content Engine
- User-authored posts (authorType=USER)
- Page-authored posts (authorType=PAGE) — B3
- Media upload, moderation pipeline, visibility control

### Social Graph
- Follow/unfollow users
- Follow/unfollow pages (B3)
- Blocks

### Identity & Authorization
- Phone/PIN auth with sessions
- Role hierarchy: USER < MODERATOR < ADMIN < SUPER_ADMIN
- Page roles: OWNER > ADMIN > EDITOR > MODERATOR (B3)

### Feed System
- Public, Following, College, House feeds
- B2 visibility/safety policy
- Page posts in following feed (B3)

### Pages System (B3)
- 18 API endpoints for full CRUD, team management, publishing, lifecycle
- Categories: COLLEGE_OFFICIAL, DEPARTMENT, CLUB, TRIBE_OFFICIAL, FEST, MEME, STUDY_GROUP, etc.
- Official page verification guards
- Reuses existing content engine for page-authored posts

## Stage Completion Status

| Stage | Name | Status | Tests |
|-------|------|--------|-------|
| B0 | API Contract & Manifest | ✅ DONE | - |
| B1 | Canonical Identity & Media | ✅ DONE | - |
| B2 | Visibility & Feed Safety | ✅ DONE | - |
| B3 | Pages System | ✅ DONE | 50 |
| B4 | Core Social Gaps | ⬜ NOT STARTED | - |
| B5 | Discovery & Hashtag Engine | ⬜ NOT STARTED | - |
| B6 | Notifications 2.0 | ⬜ NOT STARTED | - |
| B7 | Test Hardening | ⬜ NOT STARTED | - |
| B8 | Infra & Scale | ⬜ NOT STARTED | - |

## Known Issues
1. **Post Search Not Working** (P1) — deferred to B5
2. **Reel Interaction Bugs** (P1) — deferred to B6
3. **Separate Test DB** — deferred to B8
4. **Audit Log TTL** — deferred to B8

## B3 New API Surface (18 endpoints)
| Endpoint | Method | Auth | Role |
|---|---|---|---|
| /api/pages | POST | User | - |
| /api/pages | GET | Public | - |
| /api/pages/:idOrSlug | GET | Public | - |
| /api/pages/:id | PATCH | User | OWNER/ADMIN |
| /api/pages/:id/archive | POST | User | OWNER |
| /api/pages/:id/restore | POST | User | OWNER |
| /api/pages/:id/members | GET | User | Any member |
| /api/pages/:id/members | POST | User | OWNER/ADMIN |
| /api/pages/:id/members/:userId | PATCH | User | OWNER/ADMIN |
| /api/pages/:id/members/:userId | DELETE | User | OWNER/ADMIN |
| /api/pages/:id/transfer-ownership | POST | User | OWNER |
| /api/pages/:id/follow | POST | User | - |
| /api/pages/:id/follow | DELETE | User | - |
| /api/pages/:id/followers | GET | User | Any member |
| /api/pages/:id/posts | GET | Public | - |
| /api/pages/:id/posts | POST | User | OWNER/ADMIN/EDITOR |
| /api/pages/:id/posts/:postId | PATCH | User | OWNER/ADMIN/EDITOR |
| /api/pages/:id/posts/:postId | DELETE | User | OWNER/ADMIN/EDITOR |
| /api/pages/:id/analytics | GET | User | OWNER/ADMIN |
| /api/me/pages | GET | User | - |

## B3 Data Model

### pages collection
id (UUID), slug (unique), name, bio, category, subcategory, avatarMediaId, coverMediaId, status (DRAFT|ACTIVE|ARCHIVED|SUSPENDED), isOfficial, verificationStatus, linkedEntityType, linkedEntityId, collegeId, tribeId, createdByUserId, followerCount, memberCount, postCount, archivedAt, suspendedAt, createdAt, updatedAt

### page_members collection
id, pageId, userId (unique pair), role (OWNER|ADMIN|EDITOR|MODERATOR), status (ACTIVE|REMOVED), addedByUserId

### page_follows collection
id, pageId, userId (unique pair), createdAt

### content_items extensions (B3)
authorType (USER|PAGE), pageId, actingUserId, actingRole, createdAs (USER|PAGE)

## Next Priority
**B4 — Core Social Gaps**: ~8 missing endpoints (edit post, share post, like comment, etc.)
