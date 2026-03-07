# Tribe — Database Schema & Index Documentation

## Collections (22 total)

### 1. users
```json
{
  "id": "uuid",
  "phone": "10-digit string (unique)",
  "pinHash": "hex string (PBKDF2)",
  "pinSalt": "hex string (32 bytes)",
  "displayName": "string (2-50)",
  "username": "string|null (3-30, lowercase alphanumeric+._)",
  "bio": "string (max 150)",
  "avatarMediaId": "uuid|null",
  "ageStatus": "UNKNOWN|ADULT|CHILD",
  "birthYear": "int|null",
  "role": "USER|MODERATOR|ADMIN|SUPER_ADMIN",
  "collegeId": "uuid|null",
  "collegeName": "string|null",
  "houseId": "uuid|null",
  "houseSlug": "string|null",
  "houseName": "string|null",
  "isBanned": "boolean",
  "isVerified": "boolean",
  "suspendedUntil": "date|null",
  "strikeCount": "int",
  "consentVersion": "string|null",
  "consentAcceptedAt": "date|null",
  "personalizedFeed": "boolean",
  "targetedAds": "boolean",
  "followersCount": "int",
  "followingCount": "int",
  "postsCount": "int",
  "onboardingComplete": "boolean",
  "onboardingStep": "AGE|COLLEGE|CONSENT|DONE",
  "lastActiveAt": "date",
  "createdAt": "date",
  "updatedAt": "date"
}
```
**Indexes:**
- `{id: 1}` UNIQUE — primary lookup
- `{phone: 1}` UNIQUE — login/registration
- `{username: 1}` UNIQUE (partial: username exists) — username search
- `{collegeId: 1, followersCount: -1}` — college member listing
- `{houseId: 1}` — house member listing
- `{role: 1}` — moderator lookups
- `{displayName: 'text', username: 'text'}` — search
- `{createdAt: -1}` — newest users

### 2. sessions
```json
{
  "id": "uuid",
  "userId": "uuid",
  "token": "96-char hex",
  "deviceInfo": "user-agent string",
  "createdAt": "date",
  "expiresAt": "date"
}
```
**Indexes:**
- `{token: 1}` UNIQUE — auth lookup
- `{userId: 1}` — session management
- `{expiresAt: 1}` TTL (expireAfterSeconds: 0) — auto-cleanup

### 3. houses (12 fixed docs)
```json
{
  "id": "uuid",
  "slug": "lowercase string (unique)",
  "name": "string",
  "motto": "string",
  "color": "hex color",
  "domain": "string",
  "icon": "string",
  "membersCount": "int",
  "totalPoints": "int",
  "createdAt": "date"
}
```
**Indexes:**
- `{id: 1}` UNIQUE
- `{slug: 1}` UNIQUE

### 4. house_ledger (append-only)
```json
{
  "id": "uuid",
  "houseId": "uuid",
  "userId": "uuid",
  "points": "int (positive or negative)",
  "reason": "string",
  "createdAt": "date"
}
```
**Indexes:**
- `{houseId: 1, createdAt: -1}` — house history
- `{userId: 1, createdAt: -1}` — user contribution history

### 5. colleges (1366 seeded)
```json
{
  "id": "uuid",
  "officialName": "string",
  "normalizedName": "lowercase string",
  "city": "string",
  "state": "string",
  "type": "IIT|NIT|IIIT|Central|State|Private|...",
  "institutionType": "string",
  "aisheCode": "string|null",
  "verificationStatus": "SEEDED|VERIFIED|UNVERIFIED",
  "aliases": "[string]",
  "riskFlags": "[string]",
  "membersCount": "int",
  "contentCount": "int",
  "createdAt": "date",
  "updatedAt": "date"
}
```
**Indexes:**
- `{id: 1}` UNIQUE
- `{normalizedName: 1}` — search
- `{state: 1, type: 1}` — filtered listings
- `{aisheCode: 1}` SPARSE — official code lookup
- `{membersCount: -1}` — sorted by popularity

### 6. content_items
```json
{
  "id": "uuid",
  "kind": "POST|REEL|STORY",
  "authorId": "uuid",
  "caption": "string (max 2200)",
  "media": "[{id, url, type, mimeType, width, height, duration}]",
  "visibility": "PUBLIC|LIMITED|SHADOW_LIMITED|HELD_FOR_REVIEW|REMOVED",
  "riskScore": "float",
  "policyReasons": "[string]",
  "collegeId": "uuid|null",
  "houseId": "uuid|null",
  "likeCount": "int",
  "dislikeCountInternal": "int (hidden from public)",
  "commentCount": "int",
  "saveCount": "int",
  "shareCount": "int",
  "viewCount": "int",
  "syntheticDeclaration": "boolean",
  "syntheticLabelStatus": "UNKNOWN|DECLARED|VERIFIED|REMOVED",
  "distributionStage": "0|1|2",
  "duration": "int|null (seconds)",
  "expiresAt": "date|null (stories only)",
  "createdAt": "date",
  "updatedAt": "date"
}
```
**Indexes:**
- `{id: 1}` UNIQUE
- `{authorId: 1, createdAt: -1}` — user profile posts
- `{kind: 1, visibility: 1, createdAt: -1}` — public feed, reels feed
- `{collegeId: 1, kind: 1, visibility: 1, createdAt: -1}` — college feed
- `{houseId: 1, kind: 1, visibility: 1, createdAt: -1}` — house feed
- `{kind: 1, visibility: 1, distributionStage: 1, createdAt: -1}` — distribution ladder
- `{expiresAt: 1}` TTL (partialFilter: kind=STORY) — auto-expire stories

### 7. follows
```json
{
  "id": "uuid",
  "followerId": "uuid",
  "followeeId": "uuid",
  "createdAt": "date"
}
```
**Indexes:**
- `{followerId: 1, followeeId: 1}` UNIQUE — prevent duplicate follows
- `{followeeId: 1, createdAt: -1}` — follower list
- `{followerId: 1, createdAt: -1}` — following list

### 8. reactions
```json
{
  "id": "uuid",
  "userId": "uuid",
  "contentId": "uuid",
  "type": "LIKE|DISLIKE",
  "createdAt": "date"
}
```
**Indexes:**
- `{userId: 1, contentId: 1}` UNIQUE — one reaction per user per content
- `{contentId: 1, type: 1}` — count queries

### 9. saves
```json
{
  "id": "uuid",
  "userId": "uuid",
  "contentId": "uuid",
  "createdAt": "date"
}
```
**Indexes:**
- `{userId: 1, contentId: 1}` UNIQUE
- `{userId: 1, createdAt: -1}` — saved items feed

### 10. comments
```json
{
  "id": "uuid",
  "contentId": "uuid",
  "authorId": "uuid",
  "parentId": "uuid|null (for threaded replies)",
  "body": "string (max 1000)",
  "likeCount": "int",
  "createdAt": "date"
}
```
**Indexes:**
- `{id: 1}` UNIQUE
- `{contentId: 1, createdAt: -1}` — comment listing
- `{authorId: 1, createdAt: -1}` — user's comments
- `{parentId: 1}` SPARSE — threaded replies

### 11-22. Supporting Collections

| Collection | Purpose | Key Indexes |
|---|---|---|
| `reports` | Content/user reports | status+createdAt, targetId+targetType |
| `moderation_events` | Immutable audit trail | targetId+createdAt, actorId+createdAt |
| `strikes` | User violations | userId+createdAt, contentId |
| `suspensions` | Account suspensions | userId+endAt |
| `appeals` | Moderation appeals | userId+createdAt, status+createdAt |
| `grievance_tickets` | Legal/compliance tickets | status+dueAt, userId |
| `notifications` | Activity feed | userId+createdAt, userId+read |
| `media_assets` | File storage (base64) | ownerId+createdAt |
| `audit_logs` | System audit trail | createdAt, actorId+createdAt |
| `consent_notices` | DPDP notices | active |
| `consent_acceptances` | User consent records | userId+noticeVersion |
| `feature_flags` | Feature toggles | key UNIQUE |

## TTL Indexes

| Collection | Field | Behavior |
|---|---|---|
| sessions | expiresAt | Auto-delete expired sessions (30-day TTL) |
| content_items | expiresAt | Auto-delete expired stories (24h, partial filter: kind=STORY) |

## Unique Constraints

| Collection | Fields | Note |
|---|---|---|
| users | id | Primary key |
| users | phone | One account per phone |
| users | username | Partial (only when username is set) |
| sessions | token | No duplicate tokens |
| houses | id, slug | Immutable house identity |
| follows | followerId + followeeId | No duplicate follows |
| reactions | userId + contentId | One reaction per content |
| saves | userId + contentId | One save per content |
| feature_flags | key | Unique flag keys |
