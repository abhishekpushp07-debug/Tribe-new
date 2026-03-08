# Tribe — Complete Android Agent Handoff Document

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Authentication](#authentication)
3. [User Model](#user-model)
4. [21 Tribes Reference](#21-tribes-reference)
5. [Pagination & Error Patterns](#pagination--error-patterns)
6. [API Reference by Stage](#api-reference-by-stage)
   - [Auth (Stage 0)](#auth-stage-0)
   - [Onboarding & Profile](#onboarding--profile)
   - [Content CRUD](#content-crud)
   - [Feeds](#feeds)
   - [Social (Follow, Like, Comment, Save)](#social)
   - [Users & Discovery](#users--discovery)
   - [Media Upload](#media-upload)
   - [Stage 1: Appeal Decision](#stage-1-appeal-decision)
   - [Stage 2: College Claims](#stage-2-college-claims)
   - [Stage 4: Distribution Ladder (Admin)](#stage-4-distribution-ladder)
   - [Stage 5: Notes/PYQs Library](#stage-5-notespyqs-library)
   - [Stage 6: Events + RSVP](#stage-6-events--rsvp)
   - [Stage 7: Board Notices + Authenticity](#stage-7-board-notices--authenticity)
   - [Stage 9: Stories](#stage-9-stories)
   - [Stage 10: Reels](#stage-10-reels)
   - [Stage 12: Tribes](#stage-12-tribes)
   - [Stage 12X: Tribe Contest Engine](#stage-12x-tribe-contest-engine)
   - [Stage 12X-RT: Real-Time SSE](#stage-12x-rt-real-time-sse)
   - [Governance](#governance)
   - [Admin / Moderation / Reports](#admin--moderation--reports)
   - [Ops / Health](#ops--health)
7. [Constants & Enums](#constants--enums)
8. [Key Business Rules](#key-business-rules)

---

## Architecture Overview

- **Backend**: Monolithic Next.js API (all routes under `/api/*`)
- **Database**: MongoDB (60+ collections, 200+ indexes)
- **Cache**: Redis (with in-memory fallback)
- **Real-time**: Server-Sent Events (SSE) via Redis Pub/Sub
- **Content Moderation**: OpenAI GPT-4o-mini (provider-adapter pattern)
- **Storage**: Emergent Object Storage (with base64 fallback)
- **Base URL**: `{YOUR_BACKEND_URL}/api`

All API calls must be prefixed with `/api`. Example: `GET /api/auth/me`

---

## Authentication

**Mechanism**: Bearer token (session-based, 30-day TTL)

### Headers
```
Authorization: Bearer {token}
Content-Type: application/json
```

### Auth Flow
1. **Register** → `POST /api/auth/register` → returns `{ token, user }`
2. **Login** → `POST /api/auth/login` → returns `{ token, user }`
3. Use `token` in `Authorization: Bearer {token}` header for all authenticated requests
4. **Token expiry**: 30 days. After that, user must re-login.

### Brute Force Protection
- Login: 5 failed attempts → lockout with `Retry-After` header
- Rate limit: 500 requests/minute per IP

---

## User Model

The `user` object returned from all endpoints (after sanitization — `pinHash`, `pinSalt`, `_id` are stripped):

```json
{
  "id": "uuid",
  "phone": "9876543210",
  "displayName": "Rahul",
  "username": "rahul.dev",
  "bio": "IIT Delhi CS",
  "avatarMediaId": "uuid or null",
  "ageStatus": "ADULT | CHILD | UNKNOWN",
  "birthYear": 2002,
  "role": "USER | MODERATOR | ADMIN | SUPER_ADMIN",
  "collegeId": "uuid or null",
  "collegeName": "IIT Delhi",
  "collegeVerified": true,
  "houseId": "uuid (legacy)",
  "houseSlug": "kalam (legacy)",
  "houseName": "APJ Kalam (legacy)",
  "isBanned": false,
  "isVerified": false,
  "suspendedUntil": null,
  "strikeCount": 0,
  "consentVersion": "1.0",
  "consentAcceptedAt": "ISO date",
  "personalizedFeed": true,
  "targetedAds": true,
  "followersCount": 42,
  "followingCount": 15,
  "postsCount": 7,
  "onboardingComplete": true,
  "onboardingStep": "DONE | AGE | COLLEGE | CONSENT",
  "lastActiveAt": "ISO date",
  "createdAt": "ISO date",
  "updatedAt": "ISO date"
}
```

### Onboarding Steps (sequential)
`AGE` → `COLLEGE` → `CONSENT` → `DONE`

---

## 21 Tribes Reference

Each tribe is named after a Param Vir Chakra awardee. Tribes are assigned deterministically at signup using `SHA256(userId) % 21`.

| # | tribeCode | tribeName | heroName | animalIcon | primaryColor | quote |
|---|-----------|-----------|----------|------------|--------------|-------|
| 1 | SOMNATH | Somnath Tribe | Major Somnath Sharma | lion | #B71C1C | Stand first. Stand firm. Stand for all. |
| 2 | JADUNATH | Jadunath Tribe | Naik Jadunath Singh | tiger | #E65100 | Courage does not wait for numbers. |
| 3 | PIRU | Piru Tribe | CHM Piru Singh | panther | #4A148C | Advance through fear. Never around it. |
| 4 | KARAM | Karam Tribe | Lance Naik Karam Singh | wolf | #1B5E20 | Duty is the calm inside chaos. |
| 5 | RANE | Rane Tribe | 2Lt Rama Raghoba Rane | rhino | #37474F | Break the obstacle. Build the path. |
| 6 | SALARIA | Salaria Tribe | Capt Gurbachan Singh Salaria | falcon | #0D47A1 | Strike with speed. Rise with honour. |
| 7 | THAPA | Thapa Tribe | Maj Dhan Singh Thapa | snow_leopard | #006064 | Hold the heights. Hold the line. |
| 8 | JOGINDER | Joginder Tribe | Sub Joginder Singh | bear | #5D4037 | Strength means staying when others fall. |
| 9 | SHAITAN | Shaitan Tribe | Maj Shaitan Singh | eagle | #263238 | Sacrifice turns duty into legend. |
| 10 | HAMID | Hamid Tribe | CQMH Abdul Hamid | cobra | #1A237E | Precision defeats power. |
| 11 | TARAPORE | Tarapore Tribe | Lt Col AB Tarapore | bull | #880E4F | Lead from the front. Always. |
| 12 | EKKA | Ekka Tribe | LNk Albert Ekka | jaguar | #2E7D32 | Silent grit. Relentless spirit. |
| 13 | SEKHON | Sekhon Tribe | FO NJ Singh Sekhon | hawk | #1565C0 | Own the sky. Fear nothing. |
| 14 | HOSHIAR | Hoshiar Tribe | Maj Hoshiar Singh | bison | #6D4C41 | True force protects before it conquers. |
| 15 | KHETARPAL | Khetarpal Tribe | 2Lt Arun Khetarpal | stallion | #3E2723 | Charge beyond doubt. |
| 16 | BANA | Bana Tribe | NSub Bana Singh | mountain_wolf | #004D40 | Impossible is a peak to be climbed. |
| 17 | PARAMESWARAN | Parameswaran Tribe | Maj R Parameswaran | black_panther | #311B92 | Resolve is the sharpest weapon. |
| 18 | PANDEY | Pandey Tribe | Lt Manoj Kumar Pandey | leopard | #C62828 | If the mission is worthy, give all. |
| 19 | YADAV | Yadav Tribe | Gdr Yogendra Singh Yadav | iron_tiger | #AD1457 | Endurance is courage over time. |
| 20 | SANJAY | Sanjay Tribe | Rfn Sanjay Kumar | honey_badger | #2C3E50 | Keep going. Then go further. |
| 21 | BATRA | Batra Tribe | Capt Vikram Batra | phoenix_wolf | #D32F2F | Victory belongs to the fearless. |

Each tribe also has `secondaryColor` and `sortOrder`.

---

## Pagination & Error Patterns

### Cursor-Based Pagination (most endpoints)
```
GET /api/feed/public?limit=20&cursor={ISO_date_of_last_item}
```
Response includes:
```json
{
  "items": [...],
  "nextCursor": "2025-01-15T12:00:00.000Z" // or null if no more
}
```

### Offset-Based Pagination (some endpoints)
```
GET /api/users/:id/followers?limit=20&offset=0
```
Response includes `{ users: [...], total: 42 }`

### Error Response Shape
```json
{
  "error": "Human-readable message",
  "code": "ERROR_CODE"
}
```
HTTP status codes: 400, 401, 403, 404, 409, 410, 413, 422, 429, 500, 503

### Common Error Codes
- `VALIDATION_ERROR` — bad input
- `UNAUTHORIZED` — missing/invalid token
- `FORBIDDEN` — insufficient permissions
- `NOT_FOUND` — resource doesn't exist
- `CONFLICT` — duplicate action (already followed, etc.)
- `RATE_LIMITED` — too many requests (has `Retry-After`)
- `BANNED` / `SUSPENDED` — account state
- `AGE_REQUIRED` — must complete age verification
- `CHILD_RESTRICTED` — action blocked for under-18
- `EXPIRED` — story has expired (HTTP 410)
- `DEPRECATED` — feature removed (HTTP 410)

---

## API Reference by Stage

### Auth (Stage 0)

#### `POST /api/auth/register`
**Body**: `{ phone: "9876543210", pin: "1234", displayName: "Rahul" }`
**Response** (201): `{ token: "...", user: {...} }`
**Notes**: Phone = exactly 10 digits. PIN = exactly 4 digits. Auto-assigns house + tribe at signup.

#### `POST /api/auth/login`
**Body**: `{ phone: "9876543210", pin: "1234" }`
**Response**: `{ token: "...", user: {...} }`
**Errors**: 401 (invalid), 403 (banned/suspended), 429 (rate limited)

#### `POST /api/auth/logout`
**Auth required**. Revokes current session token.
**Response**: `{ message: "Logged out" }`

#### `GET /api/auth/me`
**Auth required**. Returns current user.
**Response**: `{ user: {...} }`

#### `GET /api/auth/sessions`
**Auth required**. Lists active sessions.
**Response**: `{ sessions: [{ id, deviceInfo, createdAt, expiresAt, isCurrent }] }`

#### `DELETE /api/auth/sessions`
**Auth required**. Revokes ALL sessions (force logout everywhere).
**Response**: `{ message: "All sessions revoked", revokedCount: 3 }`

#### `PATCH /api/auth/pin`
**Auth required**. Change PIN.
**Body**: `{ currentPin: "1234", newPin: "5678" }`
**Response**: `{ message: "PIN changed. All other sessions revoked." }`

---

### Onboarding & Profile

#### `PATCH /api/me/profile`
**Auth required**. Update displayName, username, bio, avatarMediaId.
**Body**: `{ displayName?, username?, bio?, avatarMediaId? }`
**Response**: `{ user: {...} }`
**Rules**: username = 3-30 chars, lowercase, letters/numbers/dots/underscores. Must be unique.

#### `PATCH /api/me/age`
**Auth required**. Set birth year (onboarding step).
**Body**: `{ birthYear: 2002 }`
**Response**: `{ user: {...} }`
**Rules**: CHILD→ADULT upgrade requires admin review. Children get personalizedFeed=false, targetedAds=false.

#### `PATCH /api/me/college`
**Auth required**. Link to college (onboarding step).
**Body**: `{ collegeId: "uuid" }`
**Response**: `{ user: {...} }`

#### `PATCH /api/me/onboarding`
**Auth required**. Mark onboarding complete.
**Response**: `{ user: {...} }` (onboardingComplete=true)

---

### Content CRUD

#### `POST /api/content/posts`
**Auth required**. Create POST, REEL, or STORY.
**Body**:
```json
{
  "caption": "My first post!",
  "mediaIds": ["uuid1", "uuid2"],
  "kind": "POST | REEL | STORY",
  "syntheticDeclaration": false
}
```
**Response** (201): `{ post: { id, kind, authorId, caption, media, visibility, likeCount, ... } }`
**Rules**:
- Age verification required before posting
- Children can only post text-only POSTs
- REELs and STORYs require mediaIds
- POSTs require caption or media
- AI moderation runs on caption text
- Story auto-expires in 24h

#### `GET /api/content/{contentId}`
**Optional auth**. Get single content item.
**Response**: `{ post: { ...enriched with author, viewerHasLiked, viewerHasSaved, viewerHasDisliked } }`
**Note**: Increments viewCount. Returns 410 for expired stories.

#### `DELETE /api/content/{contentId}`
**Auth required**. Soft-delete content (REMOVED visibility).
**Rules**: Only author or moderator/admin can delete.

---

### Feeds

#### `GET /api/feed/public`
**Optional auth**. Public discovery feed (Stage 2 distributed content only).
**Query**: `?limit=20&cursor={ISO_date}`
**Response**: `{ items: [...], nextCursor, feedType: "public", distributionFilter: "STAGE_2_ONLY" }`

#### `GET /api/feed/following`
**Auth required**. Posts from followed users + own posts.
**Query**: `?limit=20&cursor={ISO_date}`
**Response**: `{ items: [...], nextCursor, feedType: "following" }`

#### `GET /api/feed/college/{collegeId}`
**Optional auth**. College-scoped feed (Stage 1+ content).
**Query**: `?limit=20&cursor={ISO_date}`
**Response**: `{ items: [...], nextCursor, feedType: "college" }`

#### `GET /api/feed/house/{houseId}`
**Optional auth**. House feed (legacy, Stage 1+ content).
**Query**: `?limit=20&cursor={ISO_date}`

#### `GET /api/feed/stories`
**Auth required**. Story rail grouped by author (followed users + own).
**Response**:
```json
{
  "storyRail": [
    {
      "author": { ...user },
      "stories": [ { id, caption, media, expiresAt, ... } ],
      "latestAt": "ISO date"
    }
  ]
}
```
**Note**: Own stories appear first, then sorted by recency.

#### `GET /api/feed/reels`
**Optional auth**. Reels discovery feed.
**Query**: `?limit=20&cursor={ISO_date}`

---

### Social

#### `POST /api/follow/{userId}`
**Auth required**. Follow a user.
**Response**: `{ message: "Followed", isFollowing: true }`
**Errors**: 409 (self-follow), 404 (user not found)

#### `DELETE /api/follow/{userId}`
**Auth required**. Unfollow a user.
**Response**: `{ message: "Unfollowed", isFollowing: false }`

#### `POST /api/content/{contentId}/like`
**Auth required**. Like content (auto-switches from dislike).
**Response**: `{ likeCount, viewerHasLiked: true, viewerHasDisliked: false }`

#### `POST /api/content/{contentId}/dislike`
**Auth required**. Internal dislike (not visible to author).
**Response**: `{ viewerHasLiked: false, viewerHasDisliked: true }`

#### `DELETE /api/content/{contentId}/reaction`
**Auth required**. Remove like/dislike.
**Response**: `{ viewerHasLiked: false, viewerHasDisliked: false }`

#### `POST /api/content/{contentId}/save`
**Auth required**. Save/bookmark content.
**Response**: `{ saved: true }`

#### `DELETE /api/content/{contentId}/save`
**Auth required**. Unsave content.
**Response**: `{ saved: false }`

#### `POST /api/content/{contentId}/comments`
**Auth required**. Add comment.
**Body**: `{ body: "Great post!", parentId: null }`
**Response** (201): `{ comment: { id, contentId, authorId, body, text, author, ... } }`
**Notes**: AI moderation on comment text. Supports threaded replies via `parentId`.

#### `GET /api/content/{contentId}/comments`
**Public**. List comments.
**Query**: `?limit=20&cursor={ISO_date}&parentId={optional_for_replies}`
**Response**: `{ comments: [...with author], nextCursor }`

---

### Users & Discovery

#### `GET /api/users/{userId}`
**Optional auth**. Get user profile.
**Response**: `{ user: {...}, isFollowing: bool }`

#### `GET /api/users/{userId}/posts`
**Optional auth**. User's posts.
**Query**: `?limit=20&cursor={ISO_date}&kind=POST|REEL|STORY`

#### `GET /api/users/{userId}/followers`
**Query**: `?limit=20&offset=0`
**Response**: `{ users: [...], total }`

#### `GET /api/users/{userId}/following`
**Query**: `?limit=20&offset=0`
**Response**: `{ users: [...], total }`

#### `GET /api/users/{userId}/saved`
**Auth required**. Own saved items only.
**Query**: `?limit=20&cursor={ISO_date}`

#### `GET /api/search`
**Query**: `?q=text&type=all|users|colleges|houses&limit=10`
**Response**: `{ users: [...], colleges: [...], houses: [...] }`
**Note**: Minimum 2 characters for query.

#### `GET /api/suggestions/users`
**Auth required**. Follow suggestions (same college > same house > popular).
**Response**: `{ users: [...] }` (max 15)

#### `GET /api/colleges/search`
**Query**: `?q=IIT&state=Delhi&type=University&limit=20&offset=0`
**Response**: `{ colleges: [...], total, offset, limit }`

#### `GET /api/colleges/states`
**Response**: `{ states: ["Delhi", "Maharashtra", ...] }`

#### `GET /api/colleges/types`
**Response**: `{ types: ["University", "College", ...] }`

#### `GET /api/colleges/{collegeId}`
**Response**: `{ college: { id, officialName, city, state, type, membersCount, ... } }`

#### `GET /api/colleges/{collegeId}/members`
**Query**: `?limit=20&offset=0`
**Response**: `{ members: [...users], total }`

#### `GET /api/houses`
**Response**: `{ houses: [...] }` (12 legacy houses, sorted by totalPoints)

#### `GET /api/houses/leaderboard`
**Response**: `{ leaderboard: [...with rank] }`

#### `GET /api/houses/{idOrSlug}`
**Response**: `{ house: {...}, topMembers: [...users] }`

---

### Media Upload

#### `POST /api/media/upload`
**Auth required**. Upload media (base64).
**Body**:
```json
{
  "data": "base64_encoded_data",
  "mimeType": "image/jpeg",
  "type": "IMAGE | VIDEO",
  "width": 1080,
  "height": 1920,
  "duration": 15
}
```
**Response** (201): `{ id, url, type, size, mimeType, storageType }`
**Limits**: Images 5MB, Videos 30MB, Video max 30s. Children cannot upload.

#### `GET /api/media/{mediaId}`
**Public**. Serves media binary. Returns Content-Type header. Cached immutably for 1 year.

---

### Stage 1: Appeal Decision

#### `PATCH /api/appeals/{appealId}/decide` (also POST)
**Auth: MODERATOR+**
**Body**: `{ action: "APPROVE|REJECT|REQUEST_MORE_INFO", reasonCodes: ["code1"], notes: "optional" }`
**Response**: `{ appeal: { id, status, decision, decidedBy, decidedAt }, message }`
**Side effects**: APPROVE restores content visibility, reverses linked strike, lifts suspension if strike count drops.

---

### Stage 2: College Claims

#### `POST /api/colleges/{collegeId}/claim`
**Auth required**. Submit college verification claim.
**Body**: `{ claimType: "STUDENT_ID|EMAIL|DOCUMENT|ENROLLMENT_NUMBER", evidence: "..." }`
**Response** (201): `{ claim: {...}, message }`
**Rules**: One active claim at a time. 7-day cooldown after rejection. 3+ lifetime rejections → auto-fraud flag.

#### `GET /api/me/college-claims`
**Auth required**. My claim history.
**Response**: `{ claims: [...with college info], total }`

#### `DELETE /api/me/college-claims/{claimId}`
**Auth required**. Withdraw pending claim.

#### `GET /api/admin/college-claims` (MODERATOR+)
**Query**: `?status=PENDING&fraudOnly=true&limit=20`
**Response**: `{ claims: [...with user], filter, queue: { totalPending, totalFraudReview, totalFraudFlaggedPending } }`

#### `GET /api/admin/college-claims/{claimId}` (MODERATOR+)
**Response**: Full enriched claim detail with claimant, college, reviewer, history, audit trail.

#### `PATCH /api/admin/college-claims/{claimId}/flag-fraud` (MODERATOR+)
**Body**: `{ reason: "..." }`
Move PENDING claim to FRAUD_REVIEW.

#### `PATCH /api/admin/college-claims/{claimId}/decide` (MODERATOR+)
**Body**: `{ approve: true|false, reasonCodes: [...], notes: "..." }`
**Side effects**: Approve → links user to college, sets collegeVerified=true. Reject → sets 7-day cooldown.

---

### Stage 4: Distribution Ladder

Content distribution stages: **STAGE_0** (profile only) → **STAGE_1** (college) → **STAGE_2** (public)

#### `POST /api/admin/distribution/evaluate` (ADMIN+)
Batch evaluate all Stage 0/1 content for promotion.

#### `POST /api/admin/distribution/evaluate/{contentId}` (MODERATOR+)
Single content evaluation.

#### `GET /api/admin/distribution/config` (MODERATOR+)
View distribution rules and thresholds.

#### `GET /api/admin/distribution/inspect/{contentId}` (MODERATOR+)
Detailed distribution signals, fresh signals, audit trail.

#### `POST /api/admin/distribution/override` (MODERATOR+)
**Body**: `{ contentId, stage: 0|1|2, reason: "..." }`
Manual override (survives auto-eval).

#### `DELETE /api/admin/distribution/override/{contentId}` (ADMIN+)
Remove override, re-enable auto-eval.

#### `POST /api/admin/distribution/kill-switch` (ADMIN+)
**Body**: `{ enabled: true|false }`
Toggle auto-evaluation globally.

---

### Stage 5: Notes/PYQs Library

#### `POST /api/resources`
**Auth required (ADULT)**. Create resource.
**Body**:
```json
{
  "kind": "NOTE|PYQ|ASSIGNMENT|SYLLABUS|LAB_FILE",
  "collegeId": "uuid",
  "title": "Data Structures Notes",
  "description": "...",
  "branch": "CSE",
  "subject": "DSA",
  "semester": 3,
  "year": 2024,
  "fileAssetId": "uuid (optional)"
}
```
**Response** (201): `{ resource: {...} }`
**Rules**: Must be member of the college. Rate limit: 10/hour. AI moderation on title+description.

#### `GET /api/resources/search`
**Public**. Faceted search.
**Query**: `?collegeId=...&kind=NOTE&branch=CSE&subject=DSA&semester=3&year=2024&q=text&sort=recent|popular|most_downloaded&limit=20&cursor=...`
**Response**: `{ items: [...with uploader], facets: { kinds, semesters, branches }, nextCursor }`

#### `GET /api/resources/{resourceId}`
**Optional auth**. Resource detail.
**Response**: `{ resource: {...with uploader, viewerVote} }`

#### `POST /api/resources/{resourceId}/vote`
**Auth required**. Upvote/downvote.
**Body**: `{ vote: "UP|DOWN" }`
**Response**: `{ voteScore, trustedVoteScore, voteCount, viewerVote }`
**Notes**: Low-trust accounts get 0.5x vote weight. Toggles on repeat.

#### `POST /api/resources/{resourceId}/download`
**Auth required**. Record download. Rate limit: 50/day.
**Response**: `{ downloadCount, fileAssetId, fileUrl }`

#### `POST /api/resources/{resourceId}/report`
**Auth required**. Report resource.
**Body**: `{ reasonCode: "...", reason: "..." }`
**Rules**: 3+ reports → auto-hold.

#### `GET /api/me/resources`
**Auth required**. My uploaded resources.

#### `GET /api/admin/resources` (MODERATOR+)
Admin resource queue.

#### `PATCH /api/admin/resources/{resourceId}/moderate` (MODERATOR+)
**Body**: `{ action: "APPROVE|HOLD|REMOVE", reason: "..." }`

---

### Stage 6: Events + RSVP

#### `POST /api/events`
**Auth required (ADULT)**. Create event.
**Body**:
```json
{
  "title": "Hackathon 2025",
  "description": "...",
  "category": "ACADEMIC|CULTURAL|SPORTS|SOCIAL|WORKSHOP|PLACEMENT|OTHER",
  "visibility": "PUBLIC|COLLEGE|PRIVATE",
  "startAt": "ISO date",
  "endAt": "ISO date (optional)",
  "locationText": "Main Auditorium",
  "locationUrl": "https://maps.google.com/...",
  "organizerText": "CS Department",
  "capacity": 200,
  "isDraft": false,
  "coverImageUrl": "url",
  "tags": ["hackathon", "coding"]
}
```
**Response** (201): `{ event: {...} }`
**Rate limit**: 10 events/hour.

#### `GET /api/events/feed`
**Auth required**. Upcoming events, score-ranked.
**Query**: `?limit=20&cursor={score}&category=ACADEMIC`
**Response**: `{ items: [...with creator, myRsvp], nextCursor, hasMore }`

#### `GET /api/events/search`
**Optional auth**. Search events.
**Query**: `?q=text&collegeId=...&category=...&upcoming=true&limit=20&cursor={ISO_date}`

#### `GET /api/events/college/{collegeId}`
College-scoped upcoming events.

#### `GET /api/events/{eventId}`
**Optional auth**. Event detail with creator, myRsvp, myReminder, authenticityTags.

#### `PATCH /api/events/{eventId}`
**Auth required (owner or admin)**. Edit event fields.

#### `DELETE /api/events/{eventId}`
**Auth required (owner or admin)**. Soft delete.

#### `POST /api/events/{eventId}/publish`
Owner publishes a draft event.

#### `POST /api/events/{eventId}/cancel`
**Body**: `{ reason: "..." }`

#### `POST /api/events/{eventId}/archive`

#### `POST /api/events/{eventId}/rsvp`
**Auth required**.
**Body**: `{ status: "GOING|INTERESTED" }`
**Notes**: Auto-waitlist if capacity full. Block check enforced.

#### `DELETE /api/events/{eventId}/rsvp`
Cancel RSVP. Auto-promotes from waitlist if slot freed.

#### `GET /api/events/{eventId}/attendees`
**Query**: `?limit=20&offset=0&status=GOING`
**Response**: `{ items: [...with user], total, eventId }`

#### `POST /api/events/{eventId}/report`
**Body**: `{ reasonCode: "...", reason: "..." }`
3+ reports → auto-hold.

#### `POST /api/events/{eventId}/remind`
Set 1-hour-before reminder.

#### `DELETE /api/events/{eventId}/remind`
Remove reminder.

#### `GET /api/me/events`
My created events. `?limit=20&cursor={ISO_date}`

#### `GET /api/me/events/rsvps`
Events I've RSVP'd to. `?limit=20`

**Admin endpoints**: `GET /api/admin/events`, `PATCH /api/admin/events/{id}/moderate`, `GET /api/admin/events/analytics`, `POST /api/admin/events/{id}/recompute-counters`

---

### Stage 7: Board Notices + Authenticity

#### `POST /api/board/notices`
**Auth: Board member or Admin**. Create notice.
**Body**:
```json
{
  "title": "Exam Schedule Update",
  "body": "...",
  "category": "ACADEMIC|ADMINISTRATIVE|EXAMINATION|PLACEMENT|CULTURAL|GENERAL",
  "priority": "URGENT|IMPORTANT|NORMAL|FYI",
  "isDraft": false,
  "attachments": [{ "name": "schedule.pdf", "url": "...", "type": "PDF" }],
  "expiresAt": "ISO date (optional)"
}
```
**Rules**: Admin-created notices are auto-published. Board member notices go to PENDING_REVIEW.

#### `GET /api/board/notices/{noticeId}`
Notice detail with creator, acknowledgedByMe, authenticityTags.

#### `PATCH /api/board/notices/{noticeId}`
Edit notice. Non-admin edits to published notices reset status to PENDING_REVIEW.

#### `DELETE /api/board/notices/{noticeId}`
Soft delete.

#### `POST /api/board/notices/{noticeId}/pin`
Pin notice (max 3 per college). Board member or Admin.

#### `DELETE /api/board/notices/{noticeId}/pin`
Unpin notice.

#### `POST /api/board/notices/{noticeId}/acknowledge`
**Auth required**. Acknowledge a notice (like "read receipt").

#### `GET /api/board/notices/{noticeId}/acknowledgments`
List who acknowledged. `?limit=20&offset=0`

#### `GET /api/colleges/{collegeId}/notices`
Public college notices. Pinned first, then by publishedAt.
**Query**: `?limit=20&cursor={ISO_date}&category=...&priority=...`

#### `GET /api/me/board/notices`
My created notices.

#### Authenticity Tags

#### `POST /api/authenticity/tag`
**Auth: Board member or Moderator+**.
**Body**: `{ targetType: "RESOURCE|EVENT|NOTICE", targetId: "uuid", tag: "VERIFIED|USEFUL|OUTDATED|MISLEADING" }`

#### `GET /api/authenticity/tags/{targetType}/{targetId}`
**Response**: `{ tags: [...with actor], summary: { VERIFIED: 2, USEFUL: 1, ... }, total }`

#### `DELETE /api/authenticity/tags/{tagId}`
Remove tag (own or admin).

**Admin**: `GET /api/moderation/board-notices`, `POST /api/moderation/board-notices/{id}/decide`, `GET /api/admin/board-notices/analytics`, `GET /api/admin/authenticity/stats`

---

### Stage 9: Stories

#### `POST /api/stories`
**Auth required (ADULT)**. Create story.
**Body**:
```json
{
  "type": "IMAGE|VIDEO|TEXT",
  "mediaIds": ["uuid"],
  "caption": "...",
  "stickers": [
    { "type": "POLL", "question": "Best course?", "options": ["DSA", "OS", "DBMS"] },
    { "type": "QUESTION", "question": "Ask me anything!" },
    { "type": "QUIZ", "question": "Capital of India?", "options": ["Delhi", "Mumbai"], "correctIndex": 0 },
    { "type": "EMOJI_SLIDER", "question": "Rate this!", "emoji": "🔥" }
  ],
  "privacy": "EVERYONE|FOLLOWERS|CLOSE_FRIENDS",
  "replyPrivacy": "EVERYONE|FOLLOWERS|CLOSE_FRIENDS|OFF",
  "backgroundType": "SOLID|GRADIENT|IMAGE",
  "backgroundColor": "#FF0000",
  "gradientColors": ["#FF0000", "#0000FF"],
  "textFont": "serif",
  "textAlign": "center"
}
```
**Expires**: 24 hours from creation. Max 5 stickers per story.

#### `GET /api/stories/feed`
**Auth required**. Story rail with seen/unseen status.
**Response**: `{ storyRail: [{ author, stories, latestAt, seenAll, seenStoryIds }] }`

#### `GET /api/stories/{storyId}`
**Auth required**. View story (auto-tracks view). Returns 410 if expired.
**Response**: `{ story: {...with author, stickers, viewerReaction, viewerStickerResponses, isViewerCloseFriend, myView} }`

#### `DELETE /api/stories/{storyId}`
Delete own story.

#### `GET /api/stories/{storyId}/views`
**Owner/admin only**. Viewers list.
**Response**: `{ viewers: [...with user, reactionEmoji, viewedAt], total, storyId }`

#### `POST /api/stories/{storyId}/react`
**Body**: `{ emoji: "❤️|🔥|😂|😮|😢|👏" }`

#### `DELETE /api/stories/{storyId}/react`
Remove reaction.

#### `POST /api/stories/{storyId}/reply`
**Body**: `{ text: "..." }`

#### `GET /api/stories/{storyId}/replies`
**Owner only**. `?limit=20&cursor={ISO_date}`

#### `POST /api/stories/{storyId}/sticker/{stickerId}/respond`
Respond to interactive sticker.
**Body**: `{ optionIndex: 0 }` (POLL/QUIZ) or `{ value: 0.75 }` (EMOJI_SLIDER) or `{ answer: "..." }` (QUESTION)

#### `GET /api/stories/{storyId}/sticker/{stickerId}/results`
Sticker results (e.g., poll percentages, average slider value).

#### `POST /api/stories/{storyId}/report`
**Body**: `{ reasonCode, reason }`

#### Close Friends
- `GET /api/me/close-friends` — list (max 500)
- `POST /api/me/close-friends/{userId}` — add
- `DELETE /api/me/close-friends/{userId}` — remove

#### Highlights
- `POST /api/me/highlights` — create highlight `{ name, coverStoryId?, storyIds[] }`
- `GET /api/users/{userId}/highlights` — user's highlights with stories
- `PATCH /api/me/highlights/{highlightId}` — edit (add/remove stories, rename)
- `DELETE /api/me/highlights/{highlightId}` — delete

#### Story Settings
- `GET /api/me/story-settings` — `{ privacy, replyPrivacy, autoArchive, ... }`
- `PATCH /api/me/story-settings` — update defaults

#### `GET /api/me/stories/archive`
Archived/expired stories.

#### `GET /api/users/{userId}/stories`
Active stories for a user.

#### Blocks
- `POST /api/me/blocks/{userId}` — block user
- `DELETE /api/me/blocks/{userId}` — unblock user
- `GET /api/me/blocks` — list blocked users

#### SSE Real-Time
`GET /api/stories/events/stream` — SSE stream for story events.

**Admin**: `GET /api/admin/stories`, `PATCH /api/admin/stories/{id}/moderate`, `GET /api/admin/stories/analytics`, `POST /api/admin/stories/{id}/recompute-counters`, `POST /api/admin/stories/cleanup`

---

### Stage 10: Reels

#### `POST /api/reels`
**Auth required (ADULT)**. Create reel.
**Body**:
```json
{
  "mediaId": "uuid",
  "caption": "...",
  "hashtags": ["coding", "tech"],
  "mentions": ["userId1"],
  "visibility": "PUBLIC|FOLLOWERS|PRIVATE",
  "isDraft": false,
  "audioId": "uuid (optional)",
  "isRemixOf": "reelId (optional)",
  "seriesId": "seriesId (optional)",
  "duration": 15000
}
```

#### `GET /api/reels/feed`
Main discovery feed. `?limit=20&cursor={ISO_date}&category=...`

#### `GET /api/reels/following`
Following feed. `?limit=20&cursor={ISO_date}`

#### `GET /api/reels/{reelId}`
Detail with creator, interactions, myLike, mySave, myView.

#### `PATCH /api/reels/{reelId}`
Edit caption, hashtags, mentions, visibility.

#### `DELETE /api/reels/{reelId}`
Soft delete.

#### `POST /api/reels/{reelId}/publish`
Publish draft.

#### `POST /api/reels/{reelId}/archive` / `POST /api/reels/{reelId}/restore`

#### `POST /api/reels/{reelId}/pin` / `DELETE /api/reels/{reelId}/pin`

#### `POST /api/reels/{reelId}/like` / `DELETE /api/reels/{reelId}/like`
**Response**: `{ likeCount, viewerLiked }`

#### `POST /api/reels/{reelId}/save` / `DELETE /api/reels/{reelId}/save`

#### `POST /api/reels/{reelId}/comment`
**Body**: `{ text: "...", parentId: null }`

#### `GET /api/reels/{reelId}/comments`
`?limit=20&cursor={ISO_date}`

#### `POST /api/reels/{reelId}/report`
**Body**: `{ reasonCode, reason }`

#### `GET /api/reels/audio/{audioId}`
Audio track details + reels using it.

#### `GET /api/reels/{reelId}/remixes`
Remixes of a reel.

#### Creator Tools
- `POST /api/me/reels/series` — create series `{ name, description }`
- `GET /api/users/{userId}/reels/series` — user's series
- `GET /api/me/reels/archive` — archived reels
- `GET /api/me/reels/analytics` — creator analytics (views, likes, reach, etc.)

#### `GET /api/users/{userId}/reels`
User's profile reels. `?limit=20&cursor={ISO_date}&pinned=true`

#### Processing Pipeline
- `POST /api/reels/{reelId}/processing` — update processing status (internal)
- `GET /api/reels/{reelId}/processing` — get processing status

**Admin**: `GET /api/admin/reels`, `PATCH /api/admin/reels/{id}/moderate`, `GET /api/admin/reels/analytics`, `POST /api/admin/reels/{id}/recompute-counters`

---

### Stage 12: Tribes

#### `GET /api/tribes`
**Public**. List all 21 tribes.
**Response**: `{ tribes: [...with membersCount, totalSalutes] }`

#### `GET /api/tribes/{tribeIdOrCode}`
**Public**. Tribe detail with board, top members, stats.
**Response**: `{ tribe: {...}, topMembers, board, activeSeason, memberStats }`

#### `GET /api/tribes/{tribeId}/members`
`?limit=20&offset=0`
**Response**: `{ members: [...users], total, tribeId }`

#### `GET /api/tribes/{tribeId}/board`
Tribe governance board.
**Response**: `{ boardSeats: [...with user], tribeId }`

#### `GET /api/tribes/{tribeId}/fund`
Tribe fund info.
**Response**: `{ fund: { currentBalance, totalEarned, totalSpent, ... } }`

#### `GET /api/tribes/{tribeId}/salutes`
Salute history for tribe. `?limit=20&cursor={ISO_date}`
**Response**: `{ items: [...ledger entries], nextCursor }`

#### `GET /api/tribes/standings/current`
Current season standings for all 21 tribes.
**Response**: `{ standings: [...ranked by totalSalutes], season }`

#### `GET /api/me/tribe`
**Auth required**. My tribe info + membership.
**Response**: `{ tribe: {...}, membership: { tribeCode, assignedAt, ... } }`

#### `GET /api/users/{userId}/tribe`
**Response**: `{ tribe: {...}, membership }`

#### Admin Tribe Endpoints
- `GET /api/admin/tribes/distribution` — distribution stats across 21 tribes
- `POST /api/admin/tribes/reassign` — `{ userId, tribeCode, reason }` reassign user
- `POST /api/admin/tribe-seasons` — create/manage season
- `GET /api/admin/tribe-seasons` — list seasons
- `POST /api/admin/tribes/migrate` — migrate house→tribe
- `POST /api/admin/tribes/boards` — create/update tribe board
- `POST /api/admin/tribe-awards/resolve` — resolve annual award

---

### Stage 12X: Tribe Contest Engine

#### Contest Lifecycle
`DRAFT → PUBLISHED → ENTRY_OPEN → ENTRY_CLOSED → EVALUATING → LOCKED → RESOLVED`

#### Contest Types
`reel_creative`, `tribe_battle`, `participation`, `judge`, `hybrid`, `seasonal`

#### Public Endpoints

##### `GET /api/tribe-contests`
List contests (public). `?page=1&limit=20&status=ENTRY_OPEN&contest_type=reel_creative&season_id=...`
**Response**: `{ items: [...], total, page, limit }`

##### `GET /api/tribe-contests/{contestId}`
Contest detail with rules, stats.

##### `POST /api/tribe-contests/{contestId}/enter`
**Auth required**. Submit contest entry.
**Body**: `{ entryType: "reel|post|manual|tribe_team|live_event", contentId: "uuid (optional)", submissionData: { ... } }`
**Rules**: Contest must be ENTRY_OPEN. Max entries per user/tribe enforced. Duplicate content detection.

##### `GET /api/tribe-contests/{contestId}/entries`
List entries. `?page=1&limit=20`

##### `GET /api/tribe-contests/{contestId}/leaderboard`
Ranked leaderboard with scores.

##### `GET /api/tribe-contests/{contestId}/results`
Official results (only when RESOLVED/LOCKED).

##### `POST /api/tribe-contests/{contestId}/vote`
**Auth required**. Vote on an entry.
**Body**: `{ entryId: "uuid", voteType: "upvote|support" }`
**Rules**: One vote per user per entry per contest. Self-vote blocked. Vote cap per contest (default 5).

##### `POST /api/tribe-contests/{contestId}/withdraw`
**Auth required**. Withdraw own entry.

##### `GET /api/tribe-contests/seasons`
List seasons.

##### `GET /api/tribe-contests/seasons/{seasonId}/standings`
Season standings for all 21 tribes.

#### Admin Contest Endpoints

##### `POST /api/admin/tribe-contests`
Create contest (full schema).
**Body**:
```json
{
  "title": "Best Reel Challenge",
  "description": "...",
  "contestType": "reel_creative",
  "format": "individual",
  "seasonId": "uuid",
  "entryMode": "self_submit",
  "entryTypes": ["reel"],
  "audienceScope": "all_users",
  "scoringModel": "scoring_reel_hybrid_v1",
  "saluteDistribution": { "rank_1": 1000, "rank_2": 600, "rank_3": 300 },
  "maxEntriesPerUser": 3,
  "maxEntriesPerTribe": 50,
  "selfVoteAllowed": false,
  "voteCapPerUserPerContest": 5,
  "deadlines": { "entryOpen": "ISO", "entryClosed": "ISO", "evaluationEnd": "ISO" }
}
```

##### Status Transitions (all POST)
- `POST /api/admin/tribe-contests/{id}/publish` — DRAFT → PUBLISHED
- `POST /api/admin/tribe-contests/{id}/open-entries` — PUBLISHED → ENTRY_OPEN
- `POST /api/admin/tribe-contests/{id}/close-entries` — ENTRY_OPEN → ENTRY_CLOSED
- `POST /api/admin/tribe-contests/{id}/lock` — EVALUATING → LOCKED
- `POST /api/admin/tribe-contests/{id}/resolve` — LOCKED → RESOLVED (IDEMPOTENT)
- `POST /api/admin/tribe-contests/{id}/cancel` — any → CANCELLED

##### `POST /api/admin/tribe-contests/{id}/judge-score`
**Body**: `{ entryId, scores: { creativity: 9, originality: 8, execution: 7, impact: 8 }, notes: "..." }`
Only JUDGE/ADMIN.

##### `POST /api/admin/tribe-contests/{id}/compute-scores`
Compute/recompute all entry scores using the contest's scoring model.

##### `POST /api/admin/tribe-contests/{id}/disqualify`
**Body**: `{ entryId, reason }`

##### `POST /api/admin/tribe-contests/rules`
Add versioned rules to contest.
**Body**: `{ contestId, ruleVersion, ruleBody: {...} }`

##### `POST /api/admin/tribe-salutes/adjust`
Manual salute adjustment.
**Body**: `{ tribeId, amount: 500, reason: "ADMIN_AWARD", contestId (optional), notes }`

##### `GET /api/admin/tribe-contests/dashboard`
Contest dashboard stats (total, by status, by type, etc.)

---

### Stage 12X-RT: Real-Time SSE

Three SSE (Server-Sent Events) endpoints for live data. Connect using `EventSource`.

#### `GET /api/tribe-contests/{contestId}/live`
Live contest scoreboard. Sends snapshot on connect, then streaming deltas.
**Event types**: `entry.submitted`, `vote.cast`, `score.updated`, `rank.changed`, `contest.transition`, `contest.resolved`

#### `GET /api/tribe-contests/seasons/{seasonId}/live-standings`
Live season standings for all 21 tribes.
**Event types**: `standings.updated`

#### `GET /api/tribe-contests/live-feed`
Global contest activity feed.
**Event types**: All contest events across all contests.

**SSE Protocol**:
- Sends `data: {JSON}\n\n` format
- Heartbeat every 10s: `data: {"type":"heartbeat"}\n\n`
- Auto-refresh snapshots (30s contest, 60s standings)
- Reconnect hint: 3s (`retry: 3000`)

---

### Governance

#### `GET /api/governance/college/{collegeId}/board`
Current college board seats.

#### `POST /api/governance/college/{collegeId}/apply`
Apply for board seat. `{ role: "CAPTAIN|VICE_CAPTAIN|...", statement: "..." }`

#### `GET /api/governance/college/{collegeId}/applications`
Pending board applications.

#### `POST /api/governance/applications/{appId}/vote`
Vote on board application. `{ support: true|false }`

#### `POST /api/governance/college/{collegeId}/proposals`
Create governance proposal. `{ title, description, proposalType }`

#### `GET /api/governance/college/{collegeId}/proposals`
List proposals.

#### `POST /api/governance/proposals/{proposalId}/vote`
Vote on proposal. `{ support: true|false }`

#### `POST /api/governance/college/{collegeId}/seed-board` (ADMIN)
Seed initial board.

---

### Admin / Moderation / Reports

#### `POST /api/reports`
**Auth required**. Report content.
**Body**: `{ targetId, targetType, reasonCode, reason }`

#### `GET /api/moderation/queue` (MODERATOR+)
Moderation queue with filters.

#### `POST /api/moderation/{contentId}/action` (MODERATOR+)
Take moderation action. `{ action: "APPROVE|HOLD|REMOVE|SHADOW_LIMIT|STRIKE|SUSPEND|BAN", reason, ... }`

#### `POST /api/appeals`
**Auth required**. File appeal against moderation action.
**Body**: `{ targetId, targetType, reason }`

#### `GET /api/appeals`
My appeals.

#### `GET /api/notifications`
**Auth required**. `?limit=20&unread=true`

#### `PATCH /api/notifications/read`
Mark notifications read. `{ notificationIds: [...] }`

#### `GET /api/legal/consent`
Current consent document.

#### `POST /api/legal/accept`
Accept consent. `{ version: "1.0" }`

#### `POST /api/admin/colleges/seed` (ADMIN)
Seed colleges database.

#### `GET /api/admin/stats` (ADMIN)
Platform statistics.

#### `POST /api/grievances`
Submit grievance. `{ subject, description, category }`

#### `GET /api/grievances`
My grievances.

---

### Ops / Health

#### `GET /api/` — API info
#### `GET /api/healthz` — Health check `{ ok: true }`
#### `GET /api/readyz` — Readiness (includes DB ping)
#### `GET /api/ops/health` — Deep health (MongoDB, Redis, Moderation, Storage)
#### `GET /api/ops/metrics` — Platform metrics (users, posts, sessions, reports)
#### `GET /api/ops/backup-check` — Backup readiness info
#### `GET /api/cache/stats` — Cache hit rates

---

## Constants & Enums

### Content Kinds
`POST`, `REEL`, `STORY`

### Visibility
`PUBLIC`, `LIMITED`, `SHADOW_LIMITED`, `HELD_FOR_REVIEW`, `REMOVED`

### User Roles
`USER`, `MODERATOR`, `ADMIN`, `SUPER_ADMIN`

### Age Status
`UNKNOWN`, `ADULT`, `CHILD`

### Report Status
`OPEN`, `REVIEWING`, `RESOLVED`, `DISMISSED`

### Appeal Status
`PENDING`, `REVIEWING`, `APPROVED`, `DENIED`, `MORE_INFO_REQUESTED`

### Claim Status
`PENDING`, `APPROVED`, `REJECTED`, `WITHDRAWN`, `FRAUD_REVIEW`

### Resource Kinds
`NOTE`, `PYQ`, `ASSIGNMENT`, `SYLLABUS`, `LAB_FILE`

### Resource Status
`PUBLIC`, `HELD`, `UNDER_REVIEW`, `REMOVED`

### Event Categories
`ACADEMIC`, `CULTURAL`, `SPORTS`, `SOCIAL`, `WORKSHOP`, `PLACEMENT`, `OTHER`

### Event RSVP Status
`GOING`, `INTERESTED`, `WAITLISTED`

### Notice Priorities
`URGENT`, `IMPORTANT`, `NORMAL`, `FYI`

### Notice Categories
`ACADEMIC`, `ADMINISTRATIVE`, `EXAMINATION`, `PLACEMENT`, `CULTURAL`, `GENERAL`

### Authenticity Tags
`VERIFIED`, `USEFUL`, `OUTDATED`, `MISLEADING`

### Contest Types
`reel_creative`, `tribe_battle`, `participation`, `judge`, `hybrid`, `seasonal`

### Contest Statuses
`DRAFT`, `PUBLISHED`, `ENTRY_OPEN`, `ENTRY_CLOSED`, `EVALUATING`, `LOCKED`, `RESOLVED`, `CANCELLED`

### Scoring Models
- `scoring_reel_hybrid_v1` — Judge(35%) + Completion(20%) + Saves(15%) + Shares(10%) + Likes(10%) + Comments(10%)
- `scoring_participation_v1` — Entries(50%) + Verified(20%) + Completion(15%) + Clean(15%)
- `scoring_judge_only_v1` — Creativity(25%) + Originality(25%) + Execution(25%) + Impact(25%)
- `scoring_tribe_battle_v1` — Top entries(60%) + Participation(20%) - Penalties(20%)

### Salute Distribution (Default)
Rank 1: 1000, Rank 2: 600, Rank 3: 300, Finalist: 100, Participation: 25

### Story Reactions
`❤️`, `🔥`, `😂`, `😮`, `😢`, `👏`

### Story Privacy
`EVERYONE`, `FOLLOWERS`, `CLOSE_FRIENDS`

### Story Types
`IMAGE`, `VIDEO`, `TEXT`

### Sticker Types
`POLL`, `QUESTION`, `QUIZ`, `EMOJI_SLIDER`, `MENTION`, `LOCATION`, `HASHTAG`, `LINK`, `COUNTDOWN`, `MUSIC`

---

## Key Business Rules

1. **Tribe Assignment**: Deterministic via SHA256(userId) % 21. Same user always gets same tribe. Assigned automatically at signup. Cannot be changed by user (only admin reassign).

2. **House System**: Legacy (deprecated). Still present in user model but `house-points` endpoint returns 410 DEPRECATED.

3. **Distribution Ladder**: Content starts at Stage 0. Must earn promotion through engagement signals. Public feed only shows Stage 2. College feed shows Stage 1+.

4. **Story Expiry**: Stories auto-expire after 24 hours. Expired stories return 410. All interactions blocked on expired stories.

5. **Content Moderation**: AI moderation (GPT-4o-mini) runs on all text content (posts, comments, resources). Content can be rejected, held, or flagged.

6. **Children (CHILD ageStatus)**: Cannot post media/reels/stories. Cannot upload media. personalizedFeed=false, targetedAds=false.

7. **Block System**: Bidirectional. Blocking hides all content between users. Applied in feeds, events, reels, stories.

8. **Anti-Cheat (Contests)**: One vote per user per entry per contest. Self-vote blocking. Vote cap per user per contest. Duplicate content detection. Idempotent resolution (no double salutes).

9. **Salute Ledger**: Append-only. Standings are derived from ledger sums. Zero-drift verified.

10. **RBAC Matrix**: SUPER_ADMIN > ADMIN > MODERATOR > USER. Contest-specific: CONTEST_ADMIN, JUDGE roles.

11. **College Claims**: One active claim per user. 7-day cooldown after rejection. 3+ rejections → auto-fraud flag.

12. **Rate Limits**: 500 req/min per IP globally. Plus per-feature limits (10 events/hour, 20 reels/hour, 30 stories/hour, etc.)
