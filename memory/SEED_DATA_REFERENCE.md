# Tribe — Seed Data Reference
**Last Updated**: 2026-03-11  
**Backend URL**: `https://tribe-feed-debug.preview.emergentagent.com`

> This document provides a complete inventory of all seeded and test data in the Tribe database. Use this as the definitive reference for frontend integration and testing.

---

## Table of Contents
1. [Quick Start — Key Test Accounts](#1-quick-start--key-test-accounts)
2. [Auth & Login](#2-auth--login)
3. [Users](#3-users)
4. [Content — Posts](#4-content--posts)
5. [Content — Reels](#5-content--reels)
6. [Content — Stories](#6-content--stories)
7. [Social Graph](#7-social-graph)
8. [Pages](#8-pages)
9. [Tribes](#9-tribes)
10. [Colleges & Houses](#10-colleges--houses)
11. [Events](#11-events)
12. [Media Assets](#12-media-assets)
13. [Moderation & Reports](#13-moderation--reports)
14. [Governance & Boards](#14-governance--boards)
15. [Other Collections](#15-other-collections)
16. [Important Architecture Notes](#16-important-architecture-notes)

---

## 1. Quick Start — Key Test Accounts

**Universal PIN for all seeded accounts: `1234`**

| Phone | Display Name | Role | Purpose |
|-------|-------------|------|---------|
| `7777099001` | FE Test User | ADMIN | Primary frontend test account |
| `7777099002` | FE Test User 2 | USER | Secondary frontend test account |
| `9876543210` | Arjun Sharma | ADMIN | Original admin account |
| `9000000001` | Priya Sharma | SUPER_ADMIN | Super admin — tribe/season management |
| `9000099001` | Test User F2 | SUPER_ADMIN | Super admin test |
| `1111222233` | Admin User | ADMIN | General admin test |
| `9999960001` | Seed Creator Alpha | USER | Auto-seeded content creator (posts & reels) |
| `9999960002` | Seed Creator Beta | USER | Auto-seeded content creator |

### Quick Login Example
```bash
curl -X POST https://tribe-feed-debug.preview.emergentagent.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"7777099001","pin":"1234"}'
```
Response: `{ "token": "eyJ...", "refreshToken": "...", "user": {...} }`

Use the `token` as `Authorization: Bearer <token>` for all authenticated requests.

---

## 2. Auth & Login

**Endpoint**: `POST /api/auth/login`  
**Body**: `{ "phone": "<phone>", "pin": "<4-digit-pin>" }`

**Register New User**: `POST /api/auth/register`  
**Body**: `{ "phone": "<phone>", "pin": "<pin>", "displayName": "<name>" }`

> **Rate Limiting**: Auth endpoints have strict rate limits. If you get `429 RATE_LIMITED`, wait 60 seconds before retrying.

---

## 3. Users

**Total Users**: 996

### Role Distribution
| Role | Count |
|------|-------|
| USER | 956 |
| ADMIN | 34 |
| MODERATOR | 4 |
| SUPER_ADMIN | 2 |

### Notable User Groups

#### Admin Accounts
| Phone | Display Name | ID |
|-------|-------------|-----|
| `7777099001` | FE Test User | `514164c7-c889-4edf-b394-5a0985f4bc5a` |
| `9876543210` | Arjun Sharma | `f74ff007-045f-4e5b-8da2-bf03838c9a55` |
| `9747158289` | Admin2 | `90b8522c-498b-4ecf-8558-30ec57822e7e` |
| `9775879259` | Admin3 | `7bccba47-f992-4ac4-9a74-3a7e80030e71` |
| `9967776561` | ClaimAdmin | `209858a8-6a8a-4529-8c4e-1e13da750a4f` |
| `5550000001` | GoldFreeze Admin | `76b26405-90c4-4c33-911d-d87d8b34a523` |
| `8800010001` | ReelProof_Alpha | `e58e904c-0861-4560-ae5c-a14e2e9a06b1` |

#### Super Admin Accounts
| Phone | Display Name | ID |
|-------|-------------|-----|
| `9000000001` | Priya Sharma | `ebceed59-017d-4526-a70a-1ec3335df625` |
| `9000099001` | Test User F2 | `e0f2b7b8-e079-41c0-baad-44dd0dc268ab` |

#### Moderator Accounts
| Phone | Display Name | ID |
|-------|-------------|-----|
| `9964224173` | ModeratorUser | `5128aaad-4df2-428d-aed2-213c154e1bbd` |
| `9786435088` | ModV2 | `ee68fe3d-5057-4425-b41e-393d3e2c7d6a` |
| `9152078122` | ClosureMod | `885031c0-86ce-4d12-b98c-26f54937e491` |
| `9715755084` | Mod2 | `97887e76-8d4b-4b15-9ca6-54cdb100d751` |

#### Reel Test Users
| Phone | Display Name | ID |
|-------|-------------|-----|
| `8888813116` | Reel Tester | `7042d63f-8c9d-4714-8401-b6ad05284832` |
| `8888819535` | Reel Tester | `fd48ddef-f11d-4e0c-905a-d4fb4714a774` |
| `8888819982` | Reel Tester | `6ad747dc-92c2-4d87-86d5-d0fdf6de0389` |
| `8888814099` | Reel Tester | `0601424c-f8c7-4c8a-973d-1f7a50c3e1c4` |
| `8888810039` | Reel Tester | `ac17e98a-a092-4f4d-9dbb-0e3e7011d65c` |
| `8888814675` | Reel Tester | `99c1a536-dd9b-43b9-aa49-34b1b565f4dd` |

#### Story Test Users
| Phone | Display Name | Role | ID |
|-------|-------------|------|-----|
| `9111111001` | Alice Stories | USER | `60f6699b-0162-4ef5-b361-2400d8cb6a5a` |
| `9111111002` | Bob Stories | USER | `2d4d2954-71d1-42b1-b060-98809c381ec5` |
| `9111111003` | Charlie Stories | ADMIN | `e91bca8b-e4ae-44a1-a9f5-e4d142b06c30` |

#### Phase Test Users (earliest created)
| Phone | Display Name | Role | ID |
|-------|-------------|------|-----|
| `7777000001` | Alice Phase | ADMIN | `272e3b75-2c1b-4e92-bf52-129cb2c9a3da` |
| `7777000002` | Bob Phase | USER | `7c5e4e27-441b-4a8e-92d4-98da7eaaf82f` |
| `7777000003` | Charlie Phase | USER | `20b5d1ff-64de-4579-8327-3328eb34860b` |

#### Other Notable Accounts
| Phone | Display Name | Purpose |
|-------|-------------|---------|
| `2211009988` | ReelViewer | Reel viewing tests |
| `4433221100` | ReelFinal | Final reel tests |
| `5544332211` | ReelTest3 | Reel test account |
| `1122334455` | VideoChecker | Video validation |
| `5550001111` | Block Test A | Block feature testing |
| `5550002222` | Block Test B | Block feature testing |
| `5551000000`–`5551000009` | GF User 0–9 | Gold Freeze test battery (10 users) |

#### Bulk Test Users
| Phone Range | Name Pattern | Count | Purpose |
|------------|-------------|-------|---------|
| `7777020001`–`7777020053` | UltUser200XX | ~20 | Ultimate test users |
| `9100050001`–`9100050050` | TestUserXXX | 50 | Scale test users |
| `7778030001`–`7778030016` | various | 16 | Scale seeding |
| `8886000001`–`8886000013` | various | 13 | Feature test users |
| `9000000xxx` | Stage testers | 35 | Multi-stage testing |

---

## 4. Content — Posts

**Collection**: `content_items` (field `kind: "POST"`)

### Counts
| Metric | Value |
|--------|-------|
| Total Posts | 6,461 |
| Public | 6,033 |
| Private | 38 |
| Held (moderation) | 9 |
| Removed | 381 |

### Distribution Stage (content promotion pipeline)
| Stage | Count | Meaning |
|-------|-------|---------|
| 0 | 5,187 | New / not yet eligible |
| 1 | 11 | Community stage |
| 2 | 1,113 | Wide distribution |
| null | 150 | Legacy (pre-pipeline) |

### Auto-Seeded Posts (from seed.js)
The auto-seed creates 6 posts by **Seed Creator Alpha** (`9999960001`):
1. `"When you realize finals are next week..."` — Page post, #CampusLife #TribeMemes
2. `"New campus panorama shot from the rooftop!"` — Page post, #TribeViews
3. `"Morning vibes at the library"` — User post, #StudyGram
4. `"College fest highlights!"` — User post, #FestLife
5. `"Hot take: The canteen samosa is overrated."` — User post
6. `"Update: Day got way better!"` — User post (edited flag)

### Scale Test Posts
The database includes ~6,400 scale-test posts created by automated test scripts. These use captions like `"Scale test post #XX - <random text>"` with varied `likeCount` and `commentCount` values for testing feed ranking.

### Post Types (ContentKind/postSubType)
| Sub-Type | Description | Endpoint |
|----------|-------------|----------|
| STANDARD | Regular post | `POST /api/content/posts` |
| POLL | Post with poll options | `POST /api/content/posts` with `poll` field |
| LINK | Post with link preview | `POST /api/content/posts` with `link` field |
| THREAD_HEAD | Thread parent | Auto-set when thread parts are added |
| THREAD_PART | Thread child | `POST /api/content/posts` with `thread` field |

### Key API Endpoints
```
GET  /api/feed                    # Ranked home feed
GET  /api/feed/latest             # Chronological feed
GET  /api/content/posts           # List posts
POST /api/content/posts           # Create post
GET  /api/content/:id             # Get single post
POST /api/content/:id/vote        # Vote on poll
GET  /api/content/:id/poll-results # Poll results
GET  /api/content/:id/thread      # Full thread view
```

---

## 5. Content — Reels

> **IMPORTANT**: Reels live in a **separate `reels` collection**, NOT in `content_items`. The `content_items` collection has 33 legacy reel entries (kind=REEL), but the primary reel system uses the dedicated `reels` collection.

### Counts (reels collection)
| Metric | Value |
|--------|-------|
| Total Reels | 549 |
| Published | 510 |
| Removed | 39 |
| Media Ready | 547 |
| Media Uploading | 2 |
| All Public | 549 |

### Reel Schema (key fields)
```json
{
  "id": "uuid",
  "creatorId": "uuid (user ID)",
  "caption": "string",
  "hashtags": ["string"],
  "mediaId": "uuid (media_assets reference)",
  "playbackUrl": "string (Supabase URL or /api/media/xxx)",
  "thumbnailUrl": "string | null",
  "durationMs": 15000,
  "mediaStatus": "READY | UPLOADING | PROCESSING | FAILED",
  "status": "PUBLISHED | REMOVED | DRAFT",
  "visibility": "PUBLIC",
  "moderationStatus": "APPROVED | PENDING | REJECTED",
  "likeCount": 0, "commentCount": 0, "shareCount": 0,
  "viewCount": 0, "saveCount": 0,
  "createdAt": "ISODate", "updatedAt": "ISODate"
}
```

### Auto-Seeded Reels (from seed.js)
3 reels created by seed users with actual uploaded video to Supabase:
1. `"Campus morning walk vibe check"` — by Seed Creator Alpha, #CampusLife #Reels
2. `"Library speed run challenge accepted"` — by Seed Creator Alpha, #StudyGram #FunnyReels
3. `"Canteen food review — honest edition"` — by Seed Creator Beta, #FoodReview

### Test-Created Reels
Most reels (~546) were created by automated test scripts. Key creators:
- `Reel Tester (8888813116)` — Multiple reels with Supabase URLs
- `Reel Tester (8888819535)` — Multiple reels with Supabase URLs
- Various B6/B3 test users — Reels with `example.com` placeholder URLs (legacy)

### Playback URL Types
| Type | Count (approx) | Example |
|------|----------------|---------|
| Supabase (real) | ~200+ | `https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/reels/...` |
| example.com (placeholder) | ~300+ | `https://example.com/test-video.mp4` |
| Local media API | ~40 | `/api/media/<mediaId>` |

> **Frontend Note**: Some reels have `example.com` placeholder URLs from test data. The frontend should gracefully handle playback failures.

### Key API Endpoints
```
GET  /api/reels/feed              # Reel feed (paginated)
POST /api/reels                   # Create reel
GET  /api/reels/:id               # Get single reel
POST /api/reels/:id/like          # Like reel
POST /api/reels/:id/comment       # Comment on reel
POST /api/reels/:id/save          # Save reel
POST /api/reels/:id/share         # Share reel
POST /api/reels/:id/view          # Record view
GET  /api/reels/:id/comments      # Get reel comments
```

### Related Collections
| Collection | Count | Purpose |
|-----------|-------|---------|
| `reel_views` | 47 | View tracking |
| `reel_hidden` | 78 | User-hidden reels |
| `reel_processing_jobs` | 47 | Transcoding job history |

---

## 6. Content — Stories

**Collection**: `stories`

### Counts
| Metric | Value |
|--------|-------|
| Total Stories | 28 |
| All Active | 28 |
| All Privacy: EVERYONE | 28 |

### Story Types
| Type | Count |
|------|-------|
| IMAGE | 14 |
| VIDEO | 12 |
| TEXT | 2 |

### Story Schema (key fields)
```json
{
  "id": "uuid",
  "authorId": "uuid",
  "type": "IMAGE | VIDEO | TEXT",
  "media": [{ "id": "uuid", "url": "string", "type": "IMAGE|VIDEO", "mimeType": "string" }],
  "caption": "string | null",
  "text": "string | null (for TEXT type)",
  "privacy": "EVERYONE | CLOSE_FRIENDS | CUSTOM",
  "status": "ACTIVE | EXPIRED",
  "viewCount": 0,
  "reactionCount": 0,
  "replyCount": 0,
  "expiresAt": "ISODate (24 hours after creation)",
  "createdAt": "ISODate"
}
```

> **IMPORTANT**: Stories expire 24 hours after creation. The current 28 stories were created during test runs on 2026-03-11 and may be expired by now. Create fresh stories for testing.

### Story Authors (all test-created during test runs)
Stories were created by various test users during automated test suite runs. Each test user typically created 1 IMAGE + 1 VIDEO story.

### Related Collections
| Collection | Count | Purpose |
|-----------|-------|---------|
| `story_reactions` | 5 | Emoji reactions to stories |
| `story_replies` | 9 | DM-style replies to stories |
| `story_highlights` | 13 | Saved story highlights |
| `story_settings` | 4 | Per-user story privacy settings |
| `close_friends` | 2 | Close friends list for story privacy |

### Key API Endpoints
```
GET  /api/stories                 # Story rail (active, non-expired)
POST /api/stories                 # Create story
GET  /api/stories/:id             # Get single story
POST /api/stories/:id/view        # Record view
POST /api/stories/:id/react       # React to story
POST /api/stories/:id/reply       # Reply to story
GET  /api/stories/highlights       # Story highlights
```

---

## 7. Social Graph

### Follows
| Metric | Value |
|--------|-------|
| Total Follows | 485 |

The seed script creates 1 follow relationship: **Seed Creator Beta** follows **Seed Creator Alpha**. The remaining ~484 follows were created by automated tests.

### Interactions
| Collection | Count |
|-----------|-------|
| Comments | 581 |
| Saves | 11 |
| Blocks | 0 |
| Reports | 39 |
| Notifications | 2,916 |

### Key API Endpoints
```
POST /api/social/follow           # Follow user
POST /api/social/unfollow         # Unfollow user
GET  /api/social/followers/:id    # Get followers
GET  /api/social/following/:id    # Get following
POST /api/social/like             # Like content
POST /api/social/comment          # Comment on content
POST /api/social/share            # Share content
POST /api/social/save             # Save content
POST /api/social/block            # Block user
GET  /api/notifications           # Get notifications
```

---

## 8. Pages

**Collection**: `pages`

### Counts
| Metric | Value |
|--------|-------|
| Total Pages | 1,685 |
| Active | 1,309 |
| Archived | 376 |

### By Category
| Category | Count |
|----------|-------|
| STUDY_GROUP | 1,174 |
| CLUB | 324 |
| MEME | 187 |

### Auto-Seeded Page
| Field | Value |
|-------|-------|
| Name | Tribe Campus Memes |
| Slug | `tribe-campus-memes-seed` |
| ID | `83d29a4c-4d33-48a9-b7ad-614a54b37123` |
| Category | MEME |
| Status | ACTIVE |
| isOfficial | true |
| verificationStatus | VERIFIED |
| Owner | Seed Creator Alpha |
| Post Count | 14 |

### Notable Test Pages
| Slug | Name | Category | Status |
|------|------|----------|--------|
| `tribe-campus-memes-seed` | Tribe Campus Memes | MEME | ACTIVE |
| `test-club` | Test Club Page | CLUB | ACTIVE |
| `b3-del-test` | B3 Delete Test | MEME | ACTIVE |
| `valid-page-59300` | Valid Page | MEME | ACTIVE |

### Page Members: 2,354 total  
### Page Follows: 4 total

### Key API Endpoints
```
GET  /api/pages                   # List pages
POST /api/pages                   # Create page
GET  /api/pages/:idOrSlug         # Get page
PUT  /api/pages/:id               # Update page
GET  /api/pages/:id/members       # Page members
POST /api/pages/:id/follow        # Follow page
GET  /api/pages/:id/posts         # Posts by page
```

---

## 9. Tribes

**Collection**: `tribes`

### All 5 Tribes
| Tribe Code | Name | Hero | Animal | Color | Members |
|-----------|------|------|--------|-------|---------|
| SOMNATH | Somnath Tribe | Major Somnath Sharma | lion | #B71C1C | 281 |
| JADUNATH | Jadunath Tribe | Naik Jadunath Singh | tiger | #E65100 | 291 |
| PIRU | Piru Tribe | CHM Piru Singh | panther | #4A148C | 269 |
| KARAM | Karam Tribe | Lance Naik Karam Singh | wolf | #1B5E20 | 302 |
| RANE | Rane Tribe | 2Lt Rama Raghoba Rane | rhino | #37474F | 303 |

### Tribe IDs
| Tribe Code | ID |
|-----------|-----|
| SOMNATH | `d8d6786e-db54-4d01-b440-93cdc2950ec4` |
| JADUNATH | `a0142cde-9305-45f8-bd59-0adddd9f8be1` |
| PIRU | `0742a677-61b3-4da0-927a-5b3aec39a6bd` |
| KARAM | `df364f71-b660-4c44-84aa-c7f9797336c7` |
| RANE | `03d329eb-9454-40cc-a840-60ee67614c4c` |

### Related Collections
| Collection | Count | Purpose |
|-----------|-------|---------|
| `user_tribe_memberships` | 1,001 | User-to-tribe mapping |
| `tribe_contests` | 25 | Active/past contests |
| `tribe_contest_entries` | 41 | Contest submissions |
| `tribe_contest_results` | 8 | Contest outcomes |
| `tribe_salute_ledger` | 32 | Salute tracking |
| `tribe_fund_accounts` | 1 | Fund pool |
| `tribe_fund_ledger` | 1 | Fund transactions |
| `tribe_seasons` | 3 | Season definitions |

### Seasons
| Name | Year | Status | Prize |
|------|------|--------|-------|
| Emerald Season 2026 | 2026 | ACTIVE | 10,00,000 INR |
| Test Season 2024 | 2024 | DRAFT | 5,00,000 INR |
| SSE Test Season | 2024 | DRAFT | 10,00,000 INR |

### Key API Endpoints
```
GET  /api/tribes                  # List tribes
GET  /api/tribes/:id              # Get tribe details
GET  /api/tribes/:id/leaderboard  # Tribe leaderboard
POST /api/tribes/:id/salute       # Salute a tribe
GET  /api/tribes/contests         # List contests
GET  /api/tribes/seasons          # List seasons
```

---

## 10. Colleges & Houses

### Colleges
**Total**: 1,369

Sample colleges (from IITs and major institutions):
| ID | City | State |
|----|------|-------|
| `e871b1b6-...` | Chennai | Tamil Nadu |
| `1020e686-...` | New Delhi | Delhi |
| `7b61691b-...` | Mumbai | Maharashtra |
| `f5825a13-...` | Kanpur | Uttar Pradesh |
| `e41bda53-...` | Kharagpur | West Bengal |

### Houses
**Total**: 12

| Name | ID |
|------|-----|
| Aryabhatta | `a159df7c-6f2d-4423-a0b2-9645f77ba066` |
| Chanakya | `b31bd495-044d-45f1-98f4-0c403a7099d9` |
| Veer Shivaji | `71dafcc6-2897-4f66-b59b-3d296a992d98` |
| Saraswati | `dbc4e3ef-f9c8-4f3f-a528-8ef0ee5a5df0` |
| Dhoni | `a3a733d0-4e56-4a80-a576-6a4997844bf4` |
| Kalpana | `d7a665b6-2bb1-43b3-9aa4-f8c57681f683` |
| Raman | `790c72de-a4fd-492e-b5a2-0dc5efbb4d85` |
| Rani Lakshmibai | `05bd1f4d-246c-430f-8f84-f747dea55ffe` |
| Tagore | `e4e53629-b853-435f-97ce-fe21bee67a34` |
| APJ Kalam | `ed0d7c5d-0b25-4d27-aea8-2ec0549a31d7` |
| Shakuntala | `09bbf1db-2dc7-4b1f-bacc-b209be3479cb` |
| Vikram | `54bd1160-865b-42ea-ae62-ae8ed6ffc0f3` |

### Key API Endpoints
```
GET  /api/colleges                # List/search colleges
GET  /api/colleges/:id            # Get college
POST /api/colleges/claim          # Claim college membership
GET  /api/houses                  # List houses
```

---

## 11. Events

**Total**: 27

### Sample Events
| Title | Status |
|-------|--------|
| Campus Tech Fest 2026 | PUBLIC |
| Annual Tech Fest 2024 | PUBLIC |
| Code Jam 2026 | PUBLISHED |

### Related Collections
| Collection | Count |
|-----------|-------|
| `event_rsvps` | 5 |

### Key API Endpoints
```
GET  /api/events                  # List events
POST /api/events                  # Create event
GET  /api/events/:id              # Get event
POST /api/events/:id/rsvp         # RSVP to event
```

---

## 12. Media Assets

**Collection**: `media_assets`

### Counts
| Metric | Value |
|--------|-------|
| Total Assets | 786 |
| All Supabase Storage | 786 |

### By Status
| Status | Count |
|--------|-------|
| READY | 289 |
| PENDING_UPLOAD | 262 |
| ORPHAN_CLEANED | 155 |
| DELETED | 79 |
| EXPIRED | 1 |

### By Type
| Type | Count |
|------|-------|
| IMAGE | 575 |
| VIDEO | 183 |
| null | 28 |

### Storage
All media is stored in **Supabase Storage** bucket: `tribe-media`  
Base URL: `https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/`

### Key API Endpoints
```
POST /api/media/initiate          # Initiate upload
PUT  /api/media/:id/upload        # Upload chunk
POST /api/media/:id/complete      # Complete upload
GET  /api/media/:id               # Get media (proxy/redirect)
DELETE /api/media/:id             # Delete media
```

---

## 13. Moderation & Reports

| Collection | Count | Purpose |
|-----------|-------|---------|
| `reports` | 39 | User-submitted content reports |
| `appeals` | 17 | Moderation appeals |
| `content_appeals` | 1 | Content-specific appeals |
| `moderation_review_queue` | 18 | Pending mod reviews |
| `moderation_audit_logs` | 18,047 | Full moderation audit trail |
| `content_review_queue` | 1 | Content pending review |
| `content_provenance_state` | 2 | Content provenance tracking |
| `abuse_audit_log` | (check) | Anti-abuse detection log |

### Key API Endpoints
```
POST /api/content/:id/report      # Report content
GET  /api/moderation/queue        # Mod review queue (MOD+)
POST /api/moderation/:id/action   # Take mod action (MOD+)
GET  /api/admin/abuse-dashboard   # Anti-abuse dashboard (ADMIN)
GET  /api/admin/abuse-log         # Anti-abuse audit log (ADMIN)
```

---

## 14. Governance & Boards

| Collection | Count |
|-----------|-------|
| `tribe_boards` | 1 |
| `tribe_board_members` | 3 |
| `board_seats` | 2 |
| `board_notices` | 11 |
| `board_proposals` | 0 |
| `board_applications` | 1 |
| `consent_notices` | 1 |
| `notice_acknowledgments` | 3 |
| `grievance_tickets` | 32 |

---

## 15. Other Collections

| Collection | Count | Purpose |
|-----------|-------|---------|
| `resources` | 30 | Shared resources/files |
| `resource_downloads` | 6 | Download tracking |
| `resource_votes` | 7 | Resource voting |
| `hashtags` | 0 | Hashtag aggregation (reset) |
| `college_claims` | 14 | College verification claims |
| `feature_flags` | 1 | Feature toggle system |
| `device_tokens` | 0 | Push notification tokens |
| `notification_preferences` | 0 | User notification settings |
| `audit_logs` | 25,230 | System-wide audit trail |
| `content_signal_events` | 19 | Content ranking signals |

### Feature Flags
| Key | Enabled |
|-----|---------|
| `DISTRIBUTION_AUTO_EVAL` | true |

---

## 16. Important Architecture Notes

### Two Content Systems
The backend has two parallel content storage patterns:

1. **`content_items` collection** — Unified content store using `kind` field:
   - `kind: "POST"` — 6,461 posts
   - `kind: "REEL"` — 33 legacy reel entries
   - Uses `authorId` for the author
   - Accessed via `/api/content/*` and `/api/feed/*` endpoints

2. **`reels` collection** — Dedicated reel store (V2):
   - 549 reels with full reel-specific schema
   - Uses `creatorId` for the creator
   - Accessed via `/api/reels/*` endpoints
   - **This is the primary reels system — frontend should use this**

3. **`stories` collection** — Dedicated story store:
   - 28 stories (expire after 24h)
   - Uses `authorId` for the author
   - Accessed via `/api/stories/*` endpoints

### Field Naming
| Collection | Author Field | Content Type Field |
|-----------|-------------|-------------------|
| `content_items` | `authorId` | `kind` (POST, REEL) |
| `reels` | `creatorId` | N/A (always reel) |
| `stories` | `authorId` | `type` (IMAGE, VIDEO, TEXT) |

### Media URL Patterns
1. **Supabase direct**: `https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/...`
2. **API proxy**: `/api/media/<mediaId>`
3. **Placeholder** (test data): `https://example.com/test-video.mp4`

### Rate Limiting
- **AUTH tier**: Strict — login/register endpoints
- **READ tier**: Open — feed/content endpoints
- **WRITE tier**: Moderate — create/update endpoints
- **Anti-abuse**: Velocity checks on social actions (like, comment, follow, share)

All rate limits use in-memory storage (Redis planned for future).

---

*This document was generated from live database queries on 2026-03-11.*
