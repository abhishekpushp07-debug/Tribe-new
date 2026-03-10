# B0.5 — Response Contracts
> Generated: 2026-03-10 | Updated: 2026-03-10 (B1 — Canonical Identity & Media Resolution)
> Source: entity-snippets.js + all handler files
> Purpose: Frontend knows EXACTLY what backend returns. No guesswork.

---

## Canonical Shared Objects

These shapes are used across multiple endpoints. Defined once here, referenced everywhere.

### UserSnippet (embedded in content, comments, notifications)
```json
{
  "id": "string (UUID)",
  "displayName": "string | null",
  "username": "string | null",
  "avatarUrl": "string | null (B1: CANONICAL display field — resolved URL like /api/media/<id>, or null)",
  "avatarMediaId": "string | null (B1: raw media ID for edit forms)",
  "avatar": "string | null (DEPRECATED — legacy alias for avatarMediaId, will be removed post-B4)",
  "role": "string (USER | MODERATOR | ADMIN | SUPER_ADMIN)",
  "collegeId": "string | null",
  "collegeName": "string | null",
  "houseId": "string | null",
  "houseName": "string | null",
  "tribeId": "string | null",
  "tribeCode": "string | null"
}
```
> Source: `toUserSnippet()` in entity-snippets.js

### PageSnippet (B3 — embedded in content, feeds, search results)
```json
{
  "id": "string (UUID)",
  "slug": "string",
  "name": "string",
  "avatarUrl": "string | null (resolved /api/media/<id>)",
  "avatarMediaId": "string | null",
  "category": "string (COLLEGE_OFFICIAL | DEPARTMENT | CLUB | TRIBE_OFFICIAL | FEST | MEME | STUDY_GROUP | HOSTEL | STUDENT_COUNCIL | ALUMNI_CELL | PLACEMENT_CELL | OTHER)",
  "isOfficial": "boolean",
  "verificationStatus": "string (NONE | PENDING | VERIFIED | REJECTED)",
  "linkedEntityType": "string | null",
  "linkedEntityId": "string | null",
  "collegeId": "string | null",
  "tribeId": "string | null",
  "status": "string (ACTIVE | ARCHIVED)"
}
```
> Source: `toPageSnippet()` in entity-snippets.js

### PageProfile (B3 — full page detail)
```json
{
  "...PageSnippet fields...": "all PageSnippet fields above",
  "bio": "string",
  "subcategory": "string",
  "coverUrl": "string | null",
  "coverMediaId": "string | null",
  "followerCount": "number",
  "memberCount": "number",
  "postCount": "number",
  "createdAt": "ISO8601",
  "updatedAt": "ISO8601",
  "viewerIsFollowing": "boolean",
  "viewerRole": "string | null (OWNER | ADMIN | EDITOR | MODERATOR | null)"
}
```
> Source: `toPageProfile()` in entity-snippets.js

### Content Author Shape (B3 — USER or PAGE)
```json
{
  "authorType": "USER | PAGE",
  "author": "UserSnippet (if authorType=USER) | PageSnippet (if authorType=PAGE)"
}
```
> B3 CONTRACT: When authorType=PAGE, the `author` field is a PageSnippet.
> When authorType=USER (default), the `author` field is a UserSnippet.
> Audit fields (actingUserId, actingRole, createdAs) are included in page-authored posts for backend audit.

> B1 Change: `avatar` was always null (bug: read non-existent field). Now correctly reads `avatarMediaId` from DB. Added `avatarUrl` (resolved) and `avatarMediaId` (raw). Legacy `avatar` kept as deprecated alias.

### UserProfile (full profile, /auth/me, /users/:id)
```json
{
  "id": "string",
  "phone": "string",
  "displayName": "string",
  "username": "string | null",
  "bio": "string | null",
  "avatarUrl": "string | null (B1: CANONICAL display field — /api/media/<id> or null)",
  "avatarMediaId": "string | null (B1: raw media ID for edit forms)",
  "avatar": "string | null (DEPRECATED — legacy alias for avatarMediaId)",
  "role": "string",
  "ageStatus": "string (UNKNOWN | ADULT | CHILD)",
  "ageVerified": "boolean",
  "birthYear": "number | null",
  "collegeId": "string | null",
  "collegeName": "string | null",
  "collegeVerified": "boolean",
  "houseId": "string | null",
  "houseName": "string | null",
  "tribeId": "string | null",
  "tribeCode": "string | null",
  "tribeName": "string | null",
  "onboardingStep": "string (FRESH | PROFILE | AGE | COLLEGE | DONE)",
  "followersCount": "number",
  "followingCount": "number",
  "postsCount": "number",
  "strikes": "number",
  "isBanned": "boolean",
  "suspendedUntil": "ISO date | null",
  "isFollowing": "boolean (only when viewer is authenticated)",
  "createdAt": "ISO date",
  "updatedAt": "ISO date"
}
```
> Source: `toUserProfile()` / `sanitizeUser()`. Strips `_id`, `pinHash`, `pinSalt`.

### MediaObject (resolved media asset)
```json
{
  "id": "string",
  "url": "string | null (QUIRK: may be null if stored in DB, use /api/media/<id> as fallback)",
  "type": "string (IMAGE | VIDEO | AUDIO) | null",
  "thumbnailUrl": "string | null",
  "width": "number | null",
  "height": "number | null",
  "duration": "number | null (seconds)",
  "mimeType": "string | null",
  "size": "number | null (bytes)"
}
```
> Source: `toMediaObject()` in entity-snippets.js

### CollegeSnippet
```json
{
  "id": "string",
  "officialName": "string | null",
  "shortName": "string | null",
  "city": "string | null",
  "state": "string | null",
  "type": "string | null",
  "membersCount": "number"
}
```

### TribeSnippet
```json
{
  "id": "string",
  "name": "string | null",
  "code": "string | null",
  "awardee": "string | null",
  "color": "string | null",
  "membersCount": "number"
}
```

### ContestSnippet
```json
{
  "id": "string",
  "title": "string | null",
  "type": "string | null",
  "status": "string | null",
  "seasonId": "string | null",
  "startsAt": "ISO date | null",
  "endsAt": "ISO date | null"
}
```

---

## Auth Responses

### `POST /api/auth/register` (201)
```json
{
  "data": {
    "user": "UserProfile",
    "accessToken": "string (at_...)",
    "refreshToken": "string (rt_...)",
    "expiresIn": "number (seconds)"
  }
}
```

### `POST /api/auth/login` (200)
```json
{
  "data": {
    "user": "UserProfile",
    "accessToken": "string",
    "refreshToken": "string",
    "expiresIn": "number"
  }
}
```

### `POST /api/auth/refresh` (200)
```json
{
  "data": {
    "accessToken": "string",
    "refreshToken": "string",
    "expiresIn": "number",
    "user": "UserProfile"
  }
}
```

### `GET /api/auth/me` (200)
```json
{
  "data": { "user": "UserProfile" }
}
```

### `GET /api/auth/sessions` (200)
```json
{
  "data": {
    "sessions": [
      {
        "id": "string",
        "ipAddress": "string",
        "deviceInfo": "string",
        "lastAccessedAt": "ISO date",
        "createdAt": "ISO date",
        "isCurrent": "boolean"
      }
    ]
  }
}
```

---

## Content / Post Responses

### `POST /api/content/posts` (201)
```json
{
  "data": {
    "id": "string",
    "authorId": "string",
    "kind": "POST | REEL | STORY",
    "caption": "string",
    "media": "MediaObject[]",
    "visibility": "PUBLIC | HELD | HELD_FOR_REVIEW",
    "distributionStage": "number (0 initially)",
    "likeCount": 0,
    "dislikeCount": 0,
    "commentCount": 0,
    "viewCount": 0,
    "saveCount": 0,
    "collegeId": "string | null",
    "houseId": "string | null",
    "syntheticDeclaration": "boolean",
    "moderationResult": "object | null",
    "createdAt": "ISO date",
    "updatedAt": "ISO date"
  }
}
```

### `GET /api/content/:id` (200)
Same shape as above, plus:
```json
{
  "data": {
    "...all post fields",
    "author": "UserSnippet",
    "viewerHasLiked": "boolean (if authenticated)",
    "viewerHasDisliked": "boolean (if authenticated)",
    "viewerHasSaved": "boolean (if authenticated)"
  }
}
```

---

## Feed Responses

### `GET /api/feed/public` | `/feed/following` | `/feed/college/:id` | `/feed/house/:id` (200)
```json
{
  "data": {
    "items": [
      {
        "id": "string",
        "authorId": "string",
        "author": "UserSnippet",
        "kind": "POST | REEL | STORY",
        "caption": "string",
        "mediaIds": "string[]",
        "visibility": "string",
        "distributionStage": "number",
        "likeCount": "number",
        "commentCount": "number",
        "viewCount": "number",
        "viewerHasLiked": "boolean",
        "viewerHasDisliked": "boolean",
        "viewerHasSaved": "boolean",
        "createdAt": "ISO date"
      }
    ],
    "nextCursor": "string | null (ISO date for next page)",
    "hasMore": "boolean"
  }
}
```

### `GET /api/feed/stories` (200)
```json
{
  "data": {
    "storyGroups": [
      {
        "user": "UserSnippet",
        "stories": ["content_items with kind=STORY"],
        "hasUnviewed": "boolean"
      }
    ]
  }
}
```

---

## Comments Response

### `GET /api/content/:id/comments` (200)
```json
{
  "data": {
    "comments": [
      {
        "id": "string",
        "contentId": "string",
        "authorId": "string",
        "author": "UserSnippet",
        "body": "string",
        "parentId": "string | null",
        "likeCount": "number",
        "createdAt": "ISO date"
      }
    ],
    "nextCursor": "string | null",
    "hasMore": "boolean"
  }
}
```

---

## User Responses

### `GET /api/users/:id` (200)
```json
{
  "data": { "user": "UserProfile (with isFollowing if authed)" }
}
```

### `GET /api/users/:id/followers` | `/following` (200)
```json
{
  "data": {
    "users": ["UserSnippet[]"],
    "total": "number",
    "offset": "number",
    "limit": "number"
  }
}
```

---

## Notifications Response

### `GET /api/notifications` (200)
```json
{
  "data": {
    "notifications": [
      {
        "id": "string",
        "type": "string (FOLLOW | LIKE | COMMENT | MENTION | REPORT_UPDATE | APPEAL_UPDATE | etc.)",
        "actorId": "string",
        "actor": "UserSnippet (enriched)",
        "targetType": "string",
        "targetId": "string",
        "message": "string",
        "read": "boolean",
        "createdAt": "ISO date"
      }
    ],
    "unreadCount": "number",
    "nextCursor": "string | null",
    "hasMore": "boolean"
  }
}
```

---

## Tribe / Contest Responses

### `GET /api/tribes` (200)
```json
{
  "data": {
    "tribes": [
      {
        "id": "string",
        "name": "string",
        "code": "string",
        "color": "string",
        "mascot": "string",
        "motto": "string",
        "membersCount": "number",
        "totalPoints": "number"
      }
    ]
  }
}
```

### `GET /api/tribe-contests/:id` (200)
```json
{
  "data": {
    "contest": {
      "id": "string",
      "title": "string",
      "description": "string",
      "type": "string",
      "status": "DRAFT | PUBLISHED | ENTRIES_OPEN | ENTRIES_CLOSED | JUDGING | RESOLVED | CANCELLED",
      "seasonId": "string",
      "startsAt": "ISO date",
      "endsAt": "ISO date",
      "entryCount": "number",
      "voteCount": "number",
      "prizes": "object",
      "rules": "object",
      "createdAt": "ISO date"
    }
  }
}
```

---

## Standard Envelope

All successful responses use:
```json
{
  "data": { "...response payload" }
}
```

Some older endpoints may return data directly without the `data` envelope.
Known inconsistency — check per-endpoint.

---

## B0.5 EXIT GATE: PASS

All canonical shared objects defined with exact field names, types, and nullability.
High-priority endpoint responses documented.
Known quirks (avatar, media URL) flagged inline.
