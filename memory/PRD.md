# Tribe — Product Requirements Document

## Original Problem Statement
Build a "world-best" social media backend for the app "Tribe" — a campus-native social platform. Development follows a rigid multi-stage plan (B0-B8) with contract-driven development, centralized policy enforcement, and canonical data objects.

## User Personas
- **Students**: Primary users. Browse feeds, create posts, follow users/pages, join tribes.
- **Community Managers**: Run club/dept/fest pages, publish as page, manage team.
- **Admins**: Moderate content, verify official pages, manage platform.

## Architecture
- **Stack**: Monolithic Next.js API backend + MongoDB + Supabase Storage
- **Testing**: pytest suite (962+ tests)
- **Key Patterns**: Contract-Driven Development, Centralized Policy (access-policy.js), Canonical Serializers (entity-snippets.js)
- **Collections**: users, sessions, content_items, follows, reactions, saves, comments, notifications, media_assets, audit_logs, pages, page_members, page_follows, reels, stories, ...

## Core Requirements

### Content Engine
- User-authored posts (authorType=USER)
- Page-authored posts (authorType=PAGE) — B3
- Media upload via Supabase Storage (signed URL direct upload), moderation pipeline, visibility control

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

### Media Infrastructure (NEW — Supabase Storage)
- **Provider**: Supabase Storage with public CDN bucket `tribe-media`
- **Upload Flow**: Signed URL direct-to-Supabase (client never sends bytes to app server)
- **Endpoints**:
  - `POST /api/media/upload-init` → Returns signed URL + mediaId
  - `POST /api/media/upload-complete` → Finalizes upload, returns public CDN URL
  - `GET /api/media/upload-status/:id` → Check upload status
  - `POST /api/media/upload` → Legacy base64 (now also routes to Supabase)
  - `GET /api/media/:id` → 302 redirect to Supabase CDN
- **Scopes**: reels/, stories/, posts/, thumbnails/
- **Allowed MIME**: image/jpeg, image/png, image/webp, video/mp4, video/quicktime
- **Max size**: 50MB (Supabase free tier)
- **Legacy compatibility**: Existing base64 and Emergent Object Storage media still served

## Stage Completion Status

| Stage | Name | Status | Tests |
|-------|------|--------|-------|
| B0 | API Contract & Manifest | ✅ DONE | - |
| B1 | Canonical Identity & Media | ✅ DONE | - |
| B2 | Visibility & Feed Safety | ✅ DONE | - |
| B3 | Pages System | ✅ DONE | 50 |
| B3-U | Ultimate Test Gate | ✅ PASS | 107 |
| B4 | Core Social Gaps | ✅ DONE | 72 |
| B5 | Discovery & Hashtag Engine | ✅ DONE (PROVEN) | 77 |
| B5.1 | Search Quality Upgrade | ✅ DONE (PROVEN) | 27 |
| B6 | Notifications 2.0 | ✅ DONE (GOLD PROOF) | 78 |
| **Media Infra** | **Supabase Storage Integration** | **✅ DONE** | **36** |
| B7 | Test Hardening | ⬜ NOT STARTED | - |
| B8 | Infra & Scale | ⬜ NOT STARTED | - |

**Total test suite: 962+ tests**

## Known Issues
1. **Separate Test DB** — deferred to B8
2. **Audit Log TTL** — deferred to B8
3. **B6-P3 rate-limit flake** (low) — intermittent 429
4. **House → Tribe data mismatch** — legacy "Rani Laxmibai" house names still appear

## 3rd Party Integrations
- **Supabase Storage**: Public bucket `tribe-media` for all media uploads (images, videos)
  - Keys: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
- **Emergent Object Storage**: Legacy, still functional as fallback
- **Redis**: Present but not actively used

## Next Priority
- **P1: Integrate content creation (Reels, Stories, Posts) with new media pipeline** — Accept `mediaId` from completed uploads
- **P2: Fix B — Tribe/House Cutover** — Migrate legacy house data
- **P3: B7 — Test Hardening + Gold Freeze** — 950+ tests

## Key Files
- `/app/lib/supabase-storage.js` — Supabase Storage client (bucket init, signed URLs, public URLs)
- `/app/lib/handlers/media.js` — Media upload/serve handler (Supabase + legacy)
- `/app/lib/storage.js` — Legacy Emergent Object Storage (kept for backward compat)
- `/app/tests/handlers/test_media_supabase.py` — 36 comprehensive media tests
