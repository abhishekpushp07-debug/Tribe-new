# 06 — Stories System

## Overview

Tribe implements an **Instagram-grade Stories system** with 24-hour auto-expiry, interactive stickers, close friends, highlights, real-time SSE updates, view tracking, emoji reactions, replies, privacy controls, and admin moderation.

**Source files**: `lib/handlers/stories.js` (2017 lines), `lib/services/story-service.js`

---

## Story Lifecycle

```
        ┌─────────┐
        │  CREATE  │  POST /api/stories
        └────┬─────┘
             │
     ┌───────▼────────┐
     │    ACTIVE       │ ← 24-hour countdown starts
     │  (visible)      │
     └───────┬─────────┘
             │
    ┌────────┼─────────┐
    │        │         │
    ▼        ▼         ▼
 ┌──────┐ ┌──────┐ ┌──────┐
 │EXPIRED│ │ HELD │ │REMOVED│
 │(archive)│ │(review)│ │(deleted)│
 └──────┘ └──────┘ └──────┘
```

| Status | Description | TTL |
|--------|-------------|-----|
| `ACTIVE` | Live and visible | 24 hours from creation |
| `EXPIRED` | Auto-expired, moved to archive | Permanent |
| `HELD` | Under moderation review | Until moderated |
| `REMOVED` | Deleted by author or moderator | Permanent |

---

## Story Types

| Type | Required | Description |
|------|----------|-------------|
| `IMAGE` | `mediaIds[]` | Photo story with optional caption |
| `VIDEO` | `mediaIds[]` | Video story (short clip) |
| `TEXT` | `text` | Text-on-background story |

### Text Story Backgrounds
```json
{
  "background": {
    "type": "SOLID",       // SOLID | GRADIENT | IMAGE
    "color": "#FF5722",
    "gradientColors": null,
    "imageUrl": null
  }
}
```

---

## Configuration

| Parameter | Value |
|-----------|-------|
| `TTL_HOURS` | 24 |
| `HOURLY_CREATE_LIMIT` | 30 |
| `MAX_CAPTION_LENGTH` | 2200 |
| `MAX_STICKERS_PER_STORY` | 10 |
| `MAX_CLOSE_FRIENDS` | 500 |
| `MAX_HIGHLIGHTS_PER_USER` | 100 |
| `MAX_STORIES_PER_HIGHLIGHT` | 100 |
| `MAX_HIGHLIGHT_NAME_LENGTH` | 50 |
| `MAX_REPLY_LENGTH` | 1000 |

---

## API Endpoints

### Core Story CRUD

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| `POST` | `/api/stories` | Create story | Required |
| `GET` | `/api/stories` | Story rail (grouped by author) | Required |
| `GET` | `/api/stories/feed` | Story rail with seen/unseen | Required |
| `GET` | `/api/stories/:id` | View single story (tracks view) | Optional |
| `PATCH` | `/api/stories/:id` | Edit caption/privacy | Required |
| `DELETE` | `/api/stories/:id` | Delete story | Required |

### Interactions

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/stories/:id/react` | React with emoji |
| `DELETE` | `/api/stories/:id/react` | Remove reaction |
| `POST` | `/api/stories/:id/reply` | Reply to story |
| `GET` | `/api/stories/:id/replies` | List replies (owner only) |
| `GET` | `/api/stories/:id/views` | Viewers list (owner only) |
| `POST` | `/api/stories/:id/report` | Report story |

### Interactive Stickers

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/stories/:id/sticker/:stickerId/respond` | Respond to sticker |
| `GET` | `/api/stories/:id/sticker/:stickerId/results` | Get sticker results |
| `GET` | `/api/stories/:id/sticker/:stickerId/responses` | All responses (owner) |

### Close Friends

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/me/close-friends` | List close friends |
| `POST` | `/api/me/close-friends/:userId` | Add to close friends |
| `DELETE` | `/api/me/close-friends/:userId` | Remove from close friends |

### Highlights

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/me/highlights` | Create highlight |
| `PATCH` | `/api/me/highlights/:id` | Edit highlight |
| `DELETE` | `/api/me/highlights/:id` | Delete highlight |
| `GET` | `/api/users/:userId/highlights` | User's highlights |

### Settings & Privacy

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/me/story-settings` | Get settings |
| `PATCH` | `/api/me/story-settings` | Update settings |

### Archive

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/me/stories/archive` | Archived/expired stories |
| `GET` | `/api/users/:userId/stories` | User's active stories |

### Admin

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/admin/stories` | Moderation queue |
| `PATCH` | `/api/admin/stories/:id/moderate` | Approve/remove/hold |
| `GET` | `/api/admin/stories/analytics` | Story analytics |
| `POST` | `/api/admin/stories/:id/recompute-counters` | Fix counter drift |
| `POST` | `/api/admin/stories/cleanup` | Manual expiry cleanup |

---

## Interactive Stickers

### 10 Sticker Types

| Type | Description | Response Format |
|------|-------------|-----------------|
| `POLL` | 2-4 option poll | `{ optionId: "..." }` |
| `QUIZ` | Multiple choice with correct answer | `{ optionId: "..." }` |
| `QUESTION` | Open-ended text question | `{ text: "..." }` |
| `EMOJI_SLIDER` | Emoji slider (0.0-1.0) | `{ value: 0.75 }` |
| `COUNTDOWN` | Countdown timer | View-only (no response) |
| `MENTION` | Mention a user | View-only |
| `LOCATION` | Location tag | View-only |
| `HASHTAG` | Hashtag link | View-only |
| `LINK` | Swipe-up URL | View-only |
| `MUSIC` | Music track info | View-only |

### Creating a Story with Stickers
```json
POST /api/stories
{
  "type": "IMAGE",
  "mediaIds": ["media-uuid"],
  "caption": "What do you think?",
  "stickers": [
    {
      "type": "POLL",
      "question": "Best programming language?",
      "options": ["JavaScript", "Python", "Rust"],
      "position": { "x": 0.5, "y": 0.3 }
    },
    {
      "type": "EMOJI_SLIDER",
      "question": "How excited are you?",
      "emoji": "🔥",
      "position": { "x": 0.5, "y": 0.7 }
    }
  ]
}
```

### Poll Results Response
```json
{
  "stickerId": "sticker-uuid",
  "stickerType": "POLL",
  "results": {
    "totalResponses": 42,
    "options": [
      { "id": "opt-1", "text": "JavaScript", "votes": 18, "percentage": 42.9 },
      { "id": "opt-2", "text": "Python", "votes": 15, "percentage": 35.7 },
      { "id": "opt-3", "text": "Rust", "votes": 9, "percentage": 21.4 }
    ]
  },
  "viewerResponse": { "optionId": "opt-1" }
}
```

---

## Emoji Reactions

6 valid quick reactions:
```
VALID_REACTIONS = ['❤️', '😂', '😮', '😢', '👏', '🔥']
```

- One reaction per user per story
- Can change emoji (upsert)
- Triggers notification to story author
- Real-time SSE event to author

---

## Privacy System

### Story Privacy Levels
| Level | Who Can View |
|-------|-------------|
| `EVERYONE` | All users (default) |
| `CLOSE_FRIENDS` | Only users in close friends list |
| `FOLLOWERS` | Only followers |

### Reply Privacy Levels
| Level | Who Can Reply |
|-------|--------------|
| `EVERYONE` | All viewers (default) |
| `CLOSE_FRIENDS` | Only close friends |
| `NOBODY` | No replies allowed |

### Hide Story From
Specific users can be hidden from viewing stories:
```json
PATCH /api/me/story-settings
{
  "hideStoryFrom": ["user-uuid-1", "user-uuid-2"]
}
```

### Block Integration
- Blocked users cannot view, react, or reply to stories
- Blocking removes from close friends (both directions)
- Block check runs BEFORE privacy check

---

## View Tracking

- **Deduplicated**: One view per viewer per story (upsert pattern)
- **Only non-owners**: Author's own views are not counted
- **Real-time**: SSE event to author on each new view
- **Counter update**: `viewCount` incremented only on first view

### View Tracking Flow
```javascript
const viewResult = await db.collection('story_views').updateOne(
  { storyId: story.id, viewerId: viewer.id },
  { $setOnInsert: { id: uuidv4(), storyId, viewerId, authorId, viewedAt: new Date() } },
  { upsert: true }
)
if (viewResult.upsertedCount > 0) {
  await db.collection('stories').updateOne({ id: story.id }, { $inc: { viewCount: 1 } })
  publishStoryEvent(story.authorId, { type: 'story.viewed', ... })
}
```

---

## Story Rail (Feed)

The story rail groups stories by author and sorts:

```javascript
const storyRail = authorIds.map(authorId => ({
  author: authorMap[authorId],
  stories: grouped[authorId],       // Chronological within author
  latestAt: grouped[authorId][0].createdAt
}))

// Sort: own stories FIRST, then by most recent
storyRail.sort((a, b) => {
  if (a.author?.id === user.id) return -1
  if (b.author?.id === user.id) return 1
  return new Date(b.latestAt) - new Date(a.latestAt)
})
```

Features:
- Shows stories from followed users + own
- Block-filtered (blocked users excluded)
- Seen/unseen tracking per story

---

## Highlights System

Highlights are persistent collections of stories that outlive the 24-hour expiry:

### Creating a Highlight
```json
POST /api/me/highlights
{
  "name": "Travel 2026",
  "coverMediaId": "media-uuid",
  "storyIds": ["story-uuid-1", "story-uuid-2"]
}
```

### Highlight Performance
User highlights use a **batch-optimized query pattern** (3 queries total, not 2N+1):
1. Fetch all highlights for user
2. Batch fetch ALL highlight items across all highlights
3. Batch fetch ALL referenced stories
4. Assemble in memory (zero additional queries)

---

## Real-time SSE Events

Story events are pushed to the author via Server-Sent Events:

| Event Type | Trigger | Data |
|-----------|---------|------|
| `story.viewed` | New unique view | viewer info, viewCount |
| `story.reacted` | New/changed reaction | reactor info, emoji, count |
| `story.replied` | New reply | sender info, preview text |
| `story.sticker_responded` | Sticker response | responder info, sticker type |

### SSE Connection
```
GET /api/stories/events/stream?token=at_xxx
```
Uses query param auth (EventSource doesn't support headers).

---

## Auto-Expiry Worker

A background worker runs periodically to expire stories:

```javascript
// Finds active stories past their expiresAt
const expiredStories = await db.collection('stories')
  .find({ status: 'ACTIVE', expiresAt: { $lte: now } })
  .toArray()

// Respect user's autoArchive setting
if (user.autoArchive) {
  // status → EXPIRED, archived: true
} else {
  // status → EXPIRED, archived: false
}
```

---

## Anti-Abuse Integration

Story interactions are protected by the anti-abuse service:

```javascript
const abuseCheck = checkEngagementAbuse(userId, ActionType.STORY_REACTION, storyId, authorId)
if (!abuseCheck.allowed) {
  return { error: abuseCheck.reason, code: 'ABUSE_DETECTED', status: 429 }
}
```

Checks velocity of reactions per user per time window.

---

## Collections

| Collection | Purpose | Key Fields |
|-----------|---------|------------|
| `stories` | Story documents | id, authorId, type, status, expiresAt |
| `story_views` | View tracking (deduped) | storyId, viewerId, viewedAt |
| `story_reactions` | Emoji reactions | storyId, userId, emoji |
| `story_replies` | Text replies | storyId, senderId, text |
| `story_sticker_responses` | Sticker responses | storyId, stickerId, userId, response |
| `story_highlights` | Highlight collections | userId, name, coverUrl |
| `story_highlight_items` | Stories in highlights | highlightId, storyId, order |
| `close_friends` | Close friends list | userId, friendId |
| `story_settings` | Privacy settings | userId, privacy, replyPrivacy |

---

## Source Files
- `/app/lib/handlers/stories.js` — All story endpoints (2017 lines)
- `/app/lib/services/story-service.js` — Story business logic
- `/app/lib/realtime.js` — SSE event system
- `/app/lib/services/anti-abuse-service.js` — Abuse detection
