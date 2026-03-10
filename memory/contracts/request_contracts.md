# B0.4 — Request Contracts
> Generated: 2026-03-10 | Source: All handler files, code-verified field extraction
> Purpose: Frontend knows EXACTLY what to send. No guesswork.

---

## Global Conventions

- **Content-Type**: `application/json` for all endpoints (except media upload = base64 JSON)
- **Auth**: `Authorization: Bearer <accessToken>` header
- **Path params**: In URL path, e.g., `/api/users/:id`
- **Query params**: Standard URL query string, e.g., `?cursor=xxx&limit=20`
- **Max payload**: 1MB (enforced by security middleware)

---

## AUTH

### `POST /api/auth/register`
```json
{
  "phone": "string (REQUIRED, exactly 10 digits)",
  "pin": "string (REQUIRED, exactly 4 digits)",
  "displayName": "string (REQUIRED, 2-50 chars)"
}
```

### `POST /api/auth/login`
```json
{
  "phone": "string (REQUIRED, 10 digits)",
  "pin": "string (REQUIRED, 4 digits)"
}
```

### `POST /api/auth/refresh`
```json
{
  "refreshToken": "string (REQUIRED, starts with 'rt_')"
}
```

### `POST /api/auth/logout`
No body required. Session derived from Bearer token if present.

### `PATCH /api/auth/pin`
```json
{
  "currentPin": "string (REQUIRED, 4 digits)",
  "newPin": "string (REQUIRED, 4 digits)"
}
```

---

## ME / PROFILE

### `PATCH /api/me/profile`
```json
{
  "displayName": "string (optional, 2-50 chars)",
  "username": "string (optional, 3-30 chars, lowercase alphanumeric + underscores)",
  "bio": "string (optional, max 150 chars)",
  "avatarMediaId": "string (optional, valid media ID)"
}
```
> All fields optional. Only provided fields are updated.

### `PATCH /api/me/age`
```json
{
  "birthYear": "number (REQUIRED, reasonable year)"
}
```
> Child→Adult upgrade blocked once set.

### `PATCH /api/me/college`
```json
{
  "collegeId": "string (REQUIRED, valid college ID, or null to unlink)"
}
```

### `PATCH /api/me/onboarding`
```json
{}
```
> Empty body or `{ "step": "DONE" }`. Marks onboarding complete.

---

## CONTENT

### `POST /api/content/posts`
```json
{
  "caption": "string (optional, max 2200 chars. REQUIRED if no mediaIds for POST kind)",
  "mediaIds": "string[] (optional, valid media IDs owned by user. REQUIRED for REEL/STORY kind)",
  "kind": "enum: POST | REEL | STORY (optional, default: POST)",
  "syntheticDeclaration": "boolean (optional, AI/synthetic content flag)",
  "collegeId": "string (auto-filled from user profile if not provided)",
  "houseId": "string (auto-filled from user profile if not provided)"
}
```
> Validation: REEL/STORY require at least one media. POST requires caption or media.
> Age gate: `user.ageVerified` must be true.
> AI moderated: caption checked before creation.

---

## SOCIAL

### `POST /api/follow/:userId`
No body. Target user from path param.

### `POST /api/content/:id/like`
No body. Content ID from path.

### `POST /api/content/:id/dislike`
No body.

### `POST /api/content/:id/save`
No body.

### `POST /api/content/:id/comments`
```json
{
  "body": "string (REQUIRED, max 500 chars. Alternative field: 'text')",
  "parentId": "string (optional, for reply threading)"
}
```
> `body` and `text` are interchangeable — handler checks both.
> AI moderated.

---

## MEDIA

### `POST /api/media/upload`
```json
{
  "data": "string (REQUIRED, base64-encoded file data)",
  "mimeType": "string (REQUIRED, e.g., 'image/jpeg', 'video/mp4')",
  "type": "string (optional, 'IMAGE' | 'VIDEO' | 'AUDIO')",
  "width": "number (optional)",
  "height": "number (optional)",
  "duration": "number (optional, seconds for video/audio)"
}
```
> Max image: 5MB. Max video: 30MB.
> Tries object storage first, falls back to MongoDB GridFS-style storage.

---

## STORIES

### `POST /api/stories`
```json
{
  "type": "enum: TEXT | IMAGE | VIDEO (REQUIRED)",
  "text": "string (REQUIRED for TEXT type, optional otherwise)",
  "mediaId": "string (REQUIRED for IMAGE/VIDEO type)",
  "caption": "string (optional)",
  "stickers": [
    {
      "type": "enum: POLL | QUIZ | SLIDER | QUESTION | MENTION | HASHTAG | LINK | COUNTDOWN | EMOJI",
      "id": "string (auto-generated if not provided)",
      "position": { "x": "number", "y": "number" },
      "data": "object (type-specific: options[] for POLL, question+correctIndex for QUIZ, etc.)"
    }
  ],
  "privacy": "enum: EVERYONE | CLOSE_FRIENDS | CUSTOM (optional, default from settings)",
  "background": "object (optional, for TEXT type: { color, gradient })",
  "music": "object (optional, { trackId, startTime, duration })"
}
```
> Rate limited: 30/hr.
> 24h TTL auto-expiry.
> AI moderated.

### `POST /api/stories/:id/react`
```json
{
  "emoji": "string (REQUIRED, one of: ❤️ 🔥 😂 😮 😢 👏)"
}
```

### `POST /api/stories/:id/reply`
```json
{
  "text": "string (REQUIRED, max 1000 chars)"
}
```

### `POST /api/stories/:id/sticker/:stickerId/respond`
```json
{
  "response": "string | number (REQUIRED, type-dependent: option index for POLL, answer for QUIZ, value for SLIDER, text for QUESTION)"
}
```

### `POST /api/stories/:id/report`
```json
{
  "reason": "string (REQUIRED)"
}
```

### `POST /api/me/highlights`
```json
{
  "name": "string (REQUIRED)",
  "coverStoryId": "string (optional)"
}
```
> Max 50 highlights per user.

### `PATCH /api/me/highlights/:id`
```json
{
  "name": "string (optional)",
  "addStoryIds": "string[] (optional)",
  "removeStoryIds": "string[] (optional)",
  "coverStoryId": "string (optional)"
}
```

### `PATCH /api/me/story-settings`
```json
{
  "defaultPrivacy": "enum: EVERYONE | CLOSE_FRIENDS (optional)",
  "replyPrivacy": "enum: EVERYONE | CLOSE_FRIENDS | OFF (optional)",
  "autoArchive": "boolean (optional)",
  "hideStoryFrom": "string[] (optional, user IDs)"
}
```

---

## REELS

### `POST /api/reels`
```json
{
  "mediaId": "string (REQUIRED, uploaded video media ID)",
  "caption": "string (optional, max 2200 chars)",
  "audioId": "string (optional, for audio reuse)",
  "isRemixOf": "string (optional, reel ID being remixed)",
  "tags": "string[] (optional, hashtags)",
  "draft": "boolean (optional, create as draft)"
}
```

### `PATCH /api/reels/:id`
```json
{
  "caption": "string (optional)",
  "tags": "string[] (optional)"
}
```

### `POST /api/reels/:id/comment`
```json
{
  "text": "string (REQUIRED, max 1000 chars)",
  "parentId": "string (optional, for reply)"
}
```

### `POST /api/reels/:id/report`
```json
{
  "reason": "string (REQUIRED)",
  "details": "string (optional)"
}
```

### `POST /api/reels/:id/share`
```json
{
  "platform": "string (optional, e.g., 'whatsapp', 'copy_link')"
}
```

### `POST /api/reels/:id/watch`
```json
{
  "watchTimeMs": "number (REQUIRED)",
  "completionRate": "number (optional, 0-1)"
}
```

### `POST /api/me/reels/series`
```json
{
  "name": "string (REQUIRED)"
}
```

---

## EVENTS

### `POST /api/events`
```json
{
  "title": "string (REQUIRED)",
  "description": "string (optional)",
  "eventType": "string (optional)",
  "startDate": "ISO date string (REQUIRED)",
  "endDate": "ISO date string (optional)",
  "location": "string (optional)",
  "collegeId": "string (optional)",
  "maxAttendees": "number (optional)",
  "coverMediaId": "string (optional)",
  "tags": "string[] (optional)"
}
```

### `PATCH /api/events/:id`
Same fields as POST, all optional.

### `POST /api/events/:id/rsvp`
```json
{
  "status": "enum: GOING | INTERESTED | NOT_GOING (REQUIRED)"
}
```

### `POST /api/events/:id/report`
```json
{
  "reason": "string (REQUIRED)",
  "details": "string (optional)"
}
```

---

## BOARD NOTICES

### `POST /api/board/notices`
```json
{
  "title": "string (REQUIRED)",
  "body": "string (REQUIRED)",
  "priority": "enum: NORMAL | IMPORTANT | URGENT (optional, default: NORMAL)",
  "collegeId": "string (REQUIRED)"
}
```
> Board member of the college only.

### `PATCH /api/board/notices/:id`
```json
{
  "title": "string (optional)",
  "body": "string (optional)",
  "priority": "string (optional)"
}
```

---

## REPORTS

### `POST /api/reports`
```json
{
  "targetType": "string (REQUIRED, e.g., 'content', 'user', 'comment', 'story', 'reel', 'event')",
  "targetId": "string (REQUIRED)",
  "reasonCode": "string (REQUIRED, e.g., 'SPAM', 'HARASSMENT', 'INAPPROPRIATE', 'VIOLENCE', 'MISINFORMATION', 'OTHER')",
  "details": "string (optional, additional context)"
}
```

---

## MODERATION

### `POST /api/moderation/:contentId/action`
```json
{
  "action": "enum: APPROVE | REMOVE | SHADOW_LIMIT | HOLD | STRIKE (REQUIRED)",
  "reason": "string (optional)"
}
```

---

## APPEALS

### `POST /api/appeals`
```json
{
  "targetType": "string (REQUIRED)",
  "targetId": "string (REQUIRED)",
  "reason": "string (REQUIRED)"
}
```

### `PATCH /api/appeals/:id/decide`
```json
{
  "action": "enum: APPROVE | REJECT | REQUEST_MORE_INFO (REQUIRED)",
  "reasonCodes": "string[] (optional)",
  "notes": "string (optional)"
}
```

---

## NOTIFICATIONS

### `PATCH /api/notifications/read`
```json
{
  "ids": "string[] (optional — if empty/absent, marks ALL as read)"
}
```

---

## LEGAL

### `POST /api/legal/accept`
```json
{}
```
> Empty body. Marks consent accepted.

---

## COLLEGE CLAIMS

### `POST /api/colleges/:collegeId/claim`
```json
{
  "claimType": "enum: STUDENT_ID | EMAIL | DOCUMENT | ENROLLMENT_NUMBER (REQUIRED)",
  "evidence": "string (REQUIRED, proof data — ID image, email, doc, etc.)"
}
```

### `PATCH /api/admin/college-claims/:id/decide`
```json
{
  "approve": "boolean (REQUIRED)",
  "reasonCodes": "string[] (optional)",
  "notes": "string (optional)"
}
```

---

## TRIBE CONTESTS

### `POST /api/tribe-contests/:id/enter`
```json
{
  "entryData": "object (contest-type specific, e.g., { mediaId, caption })"
}
```

### `POST /api/tribe-contests/:id/vote`
```json
{
  "entryId": "string (REQUIRED)"
}
```

---

## RESOURCES

### `POST /api/resources`
```json
{
  "kind": "enum: NOTES | PYQ | LAB_MANUAL | QUESTION_BANK | SYLLABUS | OTHER (REQUIRED)",
  "collegeId": "string (REQUIRED, must match user's college)",
  "title": "string (REQUIRED, 3-200 chars)",
  "subject": "string (optional)",
  "branch": "string (optional)",
  "semester": "number (optional, 1-8)",
  "year": "number (optional, 2000-current+1)",
  "description": "string (optional, max 2000 chars)",
  "fileAssetId": "string (REQUIRED, uploaded file media ID)"
}
```
> Rate limited: 10/hr. Same-college guard.

### `PATCH /api/resources/:id`
Same fields as POST, all optional. Owner only.

### `POST /api/resources/:id/vote`
```json
{
  "vote": "enum: UP | DOWN (REQUIRED)"
}
```
> Duplicate same-direction vote returns 409.

---

## GOVERNANCE

### `POST /api/governance/college/:collegeId/apply`
```json
{
  "statement": "string (optional, why applying)"
}
```

### `POST /api/governance/applications/:appId/vote`
```json
{
  "vote": "enum: APPROVE | REJECT (REQUIRED)"
}
```

### `POST /api/governance/college/:collegeId/proposals`
```json
{
  "title": "string (REQUIRED)",
  "description": "string (REQUIRED)",
  "category": "string (optional)"
}
```

### `POST /api/governance/proposals/:proposalId/vote`
```json
{
  "vote": "enum: FOR | AGAINST | ABSTAIN (REQUIRED)"
}
```

---

## GRIEVANCES

### `POST /api/grievances`
```json
{
  "ticketType": "string (REQUIRED)",
  "subject": "string (REQUIRED)",
  "description": "string (REQUIRED)"
}
```

---

## AUTHENTICITY

### `POST /api/authenticity/tag`
```json
{
  "targetType": "string (REQUIRED, e.g., 'content', 'reel', 'story')",
  "targetId": "string (REQUIRED)",
  "declaration": "string (REQUIRED, e.g., 'AI_GENERATED', 'SYNTHETIC')"
}
```

---

## Query Parameter Contracts (Read Endpoints)

### Feed endpoints (`?cursor=&limit=`)
| Param | Type | Default | Max | Notes |
|---|---|---|---|---|
| `cursor` | ISO date string | null (first page) | — | Cursor from previous response `nextCursor` |
| `limit` | number | 20 | 50 | — |

### Search endpoints (`?q=&type=&offset=&limit=`)
| Param | Type | Default | Notes |
|---|---|---|---|
| `q` | string | — | Search query |
| `type` | enum | `all` | `all`, `users`, `colleges`, `houses` |
| `offset` | number | 0 | For offset pagination |
| `limit` | number | 20 | Max 50 |

### Resource search (`?collegeId=&branch=&subject=&semester=&kind=&year=&q=&sort=`)
| Param | Type | Notes |
|---|---|---|
| `collegeId` | string | Filter by college |
| `branch` | string | Filter by branch |
| `subject` | string | Filter by subject |
| `semester` | number | Filter by semester |
| `kind` | enum | NOTES, PYQ, etc. |
| `year` | number | Filter by year |
| `q` | string | Text search |
| `sort` | enum | `recent`, `popular`, `most_downloaded` |

---

## B0.4 EXIT GATE: PASS

All high-value write endpoints documented with exact field names, types, required/optional, enums, and validation rules.
