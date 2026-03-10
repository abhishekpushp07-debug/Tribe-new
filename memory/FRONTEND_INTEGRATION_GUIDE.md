# Tribe — Frontend Integration Guide
Verified backend truth. FH1-U gate.

## Quick Start

### Authentication Flow
1. Register: `POST /api/auth/register` with { phone, pin, displayName, username }
2. Login: `POST /api/auth/login` with { phone, pin }
3. Store `accessToken` from response
4. All authenticated requests: `Authorization: Bearer {accessToken}`
5. On 401, try refresh: `POST /api/auth/refresh` with { refreshToken }
6. On refresh fail, redirect to login

### User Lifecycle
1. Register → get token + user
2. Check `user.onboardingStep` → if not null, show onboarding
3. Set age → `PATCH /api/me/age` (required for posting)
4. Set college → `PATCH /api/me/college`
5. Complete → `PATCH /api/me/onboarding`

---

## Content System

### Creating Content
1. Upload media (optional): `POST /api/media/upload` (multipart form-data)
2. Create post: `POST /api/content/posts`
```json
{
  "caption": "Hello world!",
  "kind": "POST",
  "media": ["media-id-1"],
  "visibility": "PUBLIC"
}
```
3. Response: enriched PostObject with author, counters, viewer flags

### Reading Content
- **Feed**: `GET /api/feed/public` or `GET /api/feed/following`
- **Detail**: `GET /api/content/:id`
- **User posts**: `GET /api/users/:id/posts`
- **Page posts**: `GET /api/pages/:id/posts`

### Interacting with Content
- **Like**: `POST /api/content/:id/like` (optimistic UI safe)
- **Unlike**: `DELETE /api/content/:id/reaction` (optimistic UI safe)
- **Save**: `POST /api/content/:id/save` (optimistic UI safe)
- **Unsave**: `DELETE /api/content/:id/save` (optimistic UI safe)
- **Comment**: `POST /api/content/:id/comments`
- **Comment like**: `POST /api/content/:postId/comments/:commentId/like` (optimistic UI safe)
- **Share**: `POST /api/content/:id/share` (NOT optimistic — wait for 201)
- **Edit**: `PATCH /api/content/:id` (NOT optimistic — moderation re-check)

---

## Pages System (B3)

### Browsing Pages
- Search: `GET /api/pages?q=keyword&category=CLUB`
- Detail: `GET /api/pages/:idOrSlug` → PageProfile with viewerRole
- Posts: `GET /api/pages/:id/posts`

### Following Pages
- Follow: `POST /api/pages/:id/follow`
- Unfollow: `DELETE /api/pages/:id/follow`
- Followed page posts appear in `GET /api/feed/following`

### Managing Pages (role-gated)
1. Create: `POST /api/pages`
2. Edit: `PATCH /api/pages/:id`
3. Members: `GET/POST/PATCH/DELETE /api/pages/:id/members[/:userId]`
4. Publish: `POST /api/pages/:id/posts`
5. Analytics: `GET /api/pages/:id/analytics`
6. Transfer: `POST /api/pages/:id/transfer-ownership`

### Role Detection
Use `PageProfile.viewerRole`:
- `null` → outsider (can follow, view posts)
- `"MODERATOR"` → can view members
- `"EDITOR"` → can publish/edit posts
- `"ADMIN"` → can manage members, view analytics
- `"OWNER"` → full control including archive/transfer

---

## Social Graph
- Follow: `POST /api/follow/:userId`
- Unfollow: `DELETE /api/follow/:userId`
- Followers: `GET /api/users/:id/followers`
- Following: `GET /api/users/:id/following`
- Block: `POST /api/me/blocks/:userId`
- Unblock: `DELETE /api/me/blocks/:userId`

---

## Stories
- Create: `POST /api/stories` (media required)
- Feed rails: `GET /api/stories/feed`
- User stories: `GET /api/users/:id/stories`
- React: `POST /api/stories/:id/react`
- Reply: `POST /api/stories/:id/reply`
- Archive: `GET /api/me/stories/archive`
- Highlights: `POST /api/me/highlights`, `GET /api/users/:id/highlights`
- Settings: `GET/PATCH /api/me/story-settings`
- Close friends: `GET /api/me/close-friends`, `POST/DELETE /api/me/close-friends/:userId`

---

## Reels
- Create: `POST /api/reels`
- Feed: `GET /api/reels/feed`
- Following: `GET /api/reels/following`
- Detail: `GET /api/reels/:id`
- Like/Save/Comment/Share/Report/Hide/Watch
- Analytics: `GET /api/me/reels/analytics`
- Series: `POST /api/me/reels/series`

---

## Notifications
- List: `GET /api/notifications`
- Mark read: `PATCH /api/notifications/read`
- See NOTIFICATION_EVENT_GUIDE.md for all types and rendering rules

---

## Search & Discovery
- Unified: `GET /api/search?q=...&type=users|colleges|houses|pages`
- Colleges: `GET /api/colleges/search?q=...`
- Suggestions: `GET /api/suggestions/users`

---

## Error Handling
All errors follow: `{ error: "message", code: "ERROR_CODE" }`

Common codes:
- `VALIDATION_ERROR` (400) — bad input
- `AUTH_REQUIRED` (401) — not authenticated
- `FORBIDDEN` (403) — not authorized
- `NOT_FOUND` (404) — resource doesn't exist or not accessible
- `DUPLICATE` (409) — already exists
- `EXPIRED` (410) — story expired
- `CONTENT_REJECTED` (422) — moderation rejected
- `RATE_LIMITED` (429) — too many requests

---

## Key Design Decisions

1. **Dual Author Model**: Every content has `authorType` (USER or PAGE). Always check this to render correctly.
2. **Cursor Pagination**: All lists use cursor-based pagination. Never use offset/page number.
3. **Soft Deletes**: Content is soft-deleted (visibility=REMOVED). It vanishes from queries but the ID persists.
4. **Media Resolution**: All media URLs resolve through `/api/media/:id`. The `avatarUrl` field is pre-resolved.
5. **Rate Limits**: WRITE operations limited to 30/min per user. Show appropriate feedback on 429.
