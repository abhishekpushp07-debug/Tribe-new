# 05 — Content Pipeline

## Overview

The content pipeline handles all user-generated content: **posts, polls, threads, carousels, link shares, reposts, and drafts**. It includes content moderation, media attachment, engagement tracking, and distribution controls.

**Source files**: `lib/handlers/content.js`, `lib/handlers/social.js`, `lib/auth-utils.js` (enrichPosts)

---

## Content Types

| SubType | Description | Required Fields |
|---------|-------------|-----------------|
| (none/POST) | Standard text/media post | `caption` or `mediaIds` |
| `POLL` | Poll with 2-4 options | `caption`, `poll.options[]` |
| `THREAD_HEAD` | First post in a thread | `caption`, `thread.parts[]` |
| `THREAD_PART` | Subsequent thread post | Auto-created from parts |
| `LINK` | Link share with preview | `linkPreview.url` |
| `REPOST` | Repost/quote of another post | `originalContentId` |

---

## Post Creation Flow

```
POST /api/content
Authorization: Bearer <token>

┌───────────────────────────────────────────────────┐
│  1. Authentication                                 │
│     requireAuth() → user object                    │
│                                                    │
│  2. Age Verification                               │
│     UNKNOWN → 403 AGE_REQUIRED                     │
│     CHILD → 403 CHILD_RESTRICTED                   │
│                                                    │
│  3. Rate Limiting                                  │
│     Max posts per hour (configurable)              │
│                                                    │
│  4. Input Validation                               │
│     Caption: max 2200 chars                        │
│     Hashtags: max 30                               │
│     Mentions: max 20                               │
│     Media: validate ownership                      │
│                                                    │
│  5. Content Moderation                             │
│     moderateCreateContent() → ALLOW/ESCALATE/REJECT│
│     REJECT → 422 CONTENT_REJECTED                  │
│     ESCALATE → visibility = HELD_FOR_REVIEW        │
│                                                    │
│  6. Media Resolution                               │
│     Resolve mediaIds → media_assets                │
│     Build media[] array with URLs, types, dims     │
│                                                    │
│  7. Poll Processing (if subType=POLL)              │
│     Validate 2-4 options                           │
│     Set votingEndsAt if duration provided           │
│                                                    │
│  8. Thread Processing (if subType=THREAD_HEAD)     │
│     Create head post                               │
│     Create thread parts as separate content_items  │
│     Link via thread.headId                         │
│                                                    │
│  9. Document Creation                              │
│     Insert into content_items collection           │
│     Set counters to 0                              │
│     Set visibility based on moderation             │
│                                                    │
│  10. Post-Creation                                 │
│      Update user.postsCount                        │
│      Invalidate feed caches                        │
│      Audit log                                     │
│      Notify mentioned users                        │
└───────────────────────────────────────────────────┘
```

---

## Content Item Schema

```json
{
  "id": "uuid-v4",
  "authorId": "user-uuid",
  "authorType": "USER",
  "kind": "POST",
  "subType": null,
  "caption": "My first post! #tribe",
  "hashtags": ["tribe"],
  "mentions": [],
  "media": [
    {
      "id": "media-uuid",
      "url": "/api/media/media-uuid",
      "type": "IMAGE",
      "mimeType": "image/jpeg",
      "width": 1080,
      "height": 1350
    }
  ],
  "mediaIds": ["media-uuid"],
  "visibility": "PUBLIC",
  "isDraft": false,
  "collegeId": "college-uuid",
  "tribeId": "tribe-uuid",
  "houseId": null,
  "poll": null,
  "thread": null,
  "linkPreview": null,
  "originalContentId": null,
  "likeCount": 0,
  "dislikeCount": 0,
  "commentCount": 0,
  "shareCount": 0,
  "saveCount": 0,
  "viewCount": 0,
  "reportCount": 0,
  "createdAt": "2026-03-12T15:00:00Z",
  "updatedAt": "2026-03-12T15:00:00Z"
}
```

---

## Poll System

### Creating a Poll
```json
POST /api/content
{
  "caption": "What's your favorite language?",
  "subType": "POLL",
  "poll": {
    "options": [
      { "text": "JavaScript" },
      { "text": "Python" },
      { "text": "Rust" },
      { "text": "Go" }
    ],
    "durationHours": 24,
    "allowMultiple": false
  }
}
```

### Poll Document Structure
```json
{
  "poll": {
    "options": [
      { "id": "opt-uuid-1", "text": "JavaScript", "voteCount": 0 },
      { "id": "opt-uuid-2", "text": "Python", "voteCount": 0 },
      { "id": "opt-uuid-3", "text": "Rust", "voteCount": 0 },
      { "id": "opt-uuid-4", "text": "Go", "voteCount": 0 }
    ],
    "totalVotes": 0,
    "votingEndsAt": "2026-03-13T15:00:00Z",
    "allowMultiple": false
  }
}
```

### Voting on a Poll
```
POST /api/content/:contentId/vote
{ "optionId": "opt-uuid-2" }
```

- One vote per user per poll (stored in `poll_votes` collection)
- Vote counts recomputed from source of truth
- Returns updated poll with `viewerPollVote` field

---

## Thread System

### Creating a Thread
```json
POST /api/content
{
  "caption": "Thread about API design (1/3)",
  "subType": "THREAD_HEAD",
  "thread": {
    "parts": [
      { "caption": "Part 2: Authentication patterns" },
      { "caption": "Part 3: Error handling best practices" }
    ]
  }
}
```

### Thread Structure
- Head post: `subType = 'THREAD_HEAD'`, has `thread.headId = self.id`
- Part posts: `subType = 'THREAD_PART'`, has `thread.headId = head.id`, `thread.position = N`
- All parts share the same visibility and moderation status
- Thread parts are separate `content_items` documents

---

## Repost System

### Creating a Repost
```json
POST /api/content
{
  "caption": "Great take on this!",
  "originalContentId": "original-post-uuid"
}
```

- Cannot repost your own content
- Original content is embedded in feed responses as `originalContent`
- If original is deleted, `originalContent = null` but `isRepost = true` remains
- Repost increments `shareCount` on the original

---

## Content Enrichment Pipeline

The `enrichPosts(db, posts, viewerId)` function transforms raw DB documents into API responses:

```
Raw Posts from DB
      │
      ▼
┌──────────────────────────────┐
│ 1. Separate USER vs PAGE     │
│    authored posts             │
│ 2. Collect original content   │
│    IDs for reposts            │
└──────────────────────────────┘
      │
      ▼
┌──────────────────────────────┐
│ 3. Batch fetch:              │
│    - User authors             │
│    - Page authors             │
│    - Original content (reposts)│
│    - Original authors         │
│    All in parallel            │
└──────────────────────────────┘
      │
      ▼
┌──────────────────────────────┐
│ 4. Viewer-specific fields:   │
│    - viewerHasLiked           │
│    - viewerHasDisliked        │
│    - viewerHasSaved           │
│    - viewerPollVote           │
│    Batch fetched (3 queries)  │
└──────────────────────────────┘
      │
      ▼
┌──────────────────────────────┐
│ 5. Assembly:                  │
│    - Strip _id, internal fields│
│    - Attach author snippet    │
│    - Attach viewer states     │
│    - Embed original content   │
│      for reposts              │
└──────────────────────────────┘
```

### Enriched Post Response
```json
{
  "id": "post-uuid",
  "authorType": "USER",
  "author": {
    "id": "user-uuid",
    "displayName": "John Doe",
    "username": "johnd",
    "avatarUrl": "/api/media/avatar-id"
  },
  "caption": "My post",
  "media": [...],
  "mediaIds": ["media-uuid"],
  "likeCount": 42,
  "commentCount": 7,
  "saveCount": 3,
  "viewerHasLiked": true,
  "viewerHasDisliked": false,
  "viewerHasSaved": false,
  "viewerPollVote": null,
  "isRepost": false,
  "createdAt": "2026-03-12T15:00:00Z"
}
```

---

## Visibility States

| State | Description | Who Can See |
|-------|-------------|------------|
| `PUBLIC` | Normal published post | Everyone |
| `LIMITED` | Restricted distribution | Followers only |
| `SHADOW_LIMITED` | Soft-restricted (user unaware) | Author sees normally, others rarely |
| `HELD_FOR_REVIEW` | Awaiting moderation | Author + moderators |
| `REMOVED` | Deleted/moderated | No one (soft delete) |

---

## Content Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/content` | Create post/poll/thread/repost |
| `GET` | `/api/content/:id` | Get single post |
| `PATCH` | `/api/content/:id` | Edit caption/hashtags |
| `DELETE` | `/api/content/:id` | Delete post (soft) |
| `POST` | `/api/content/:id/like` | Like/dislike |
| `DELETE` | `/api/content/:id/like` | Remove reaction |
| `POST` | `/api/content/:id/save` | Save post |
| `DELETE` | `/api/content/:id/save` | Unsave post |
| `POST` | `/api/content/:id/share` | Track share |
| `POST` | `/api/content/:id/comments` | Add comment |
| `GET` | `/api/content/:id/comments` | List comments |
| `POST` | `/api/content/:id/vote` | Vote on poll |
| `POST` | `/api/content/:id/report` | Report content |
| `POST` | `/api/content/:id/hide` | Hide from feed |

---

## Comment System

### Comment Schema
```json
{
  "id": "comment-uuid",
  "contentId": "post-uuid",
  "authorId": "user-uuid",
  "body": "Great post!",
  "parentId": null,
  "likeCount": 0,
  "replyCount": 0,
  "createdAt": "2026-03-12T15:30:00Z"
}
```

### Threaded Comments
- `parentId: null` = top-level comment
- `parentId: "comment-uuid"` = reply to another comment
- Replies increment parent's `replyCount`
- Supports up to 2 levels of nesting in practice

### Comment Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/content/:id/comments` | Create comment (body: `{ body, parentId? }`) |
| `GET` | `/api/content/:id/comments` | List comments (`?parentId=` for replies) |
| `DELETE` | `/api/content/:id/comments/:commentId` | Delete comment |
| `POST` | `/api/content/:id/comments/:commentId/like` | Like comment |

---

## Engagement Counter Strategy

### Write Path (Fast)
Counters use `$inc` for atomic increment/decrement:
```javascript
await db.collection('content_items').updateOne(
  { id: contentId },
  { $inc: { likeCount: 1 } }
)
```

### Read Path (Eventually Consistent)
Counters may drift due to race conditions. Admin recompute endpoints fix drift:
```
POST /api/admin/stories/:id/recompute-counters
```

### Source of Truth
| Counter | Source Collection |
|---------|-----------------|
| likeCount | `reactions` (type: LIKE) |
| dislikeCount | `reactions` (type: DISLIKE) |
| commentCount | `comments` |
| saveCount | `saves` |
| shareCount | `shares` |
| viewCount | Dedicated view tracking |

---

## Moderation Integration

Every content creation call passes through `moderateCreateContent()`:

```javascript
const modResult = await moderateCreateContent(db, {
  entityType: 'post',
  actorUserId: user.id,
  collegeId: user.collegeId,
  caption: body.caption,
  text: body.caption,
  metadata: { route: 'POST /content' }
})

if (modResult.decision.action === 'ESCALATE') {
  visibility = 'HELD_FOR_REVIEW'
}
// Throws if CONTENT_REJECTED_BY_MODERATION
```

---

## Android Integration

### Create Post (Retrofit)
```kotlin
@POST("api/content")
suspend fun createPost(@Body request: CreatePostRequest): PostResponse

data class CreatePostRequest(
    val caption: String,
    val mediaIds: List<String>? = null,
    val hashtags: List<String>? = null,
    val visibility: String = "PUBLIC"
)
```

### Like/Unlike Toggle
```kotlin
suspend fun toggleLike(contentId: String, isLiked: Boolean) {
    if (isLiked) {
        api.unlikePost(contentId) // DELETE
    } else {
        api.likePost(contentId)   // POST
    }
}
```

---

## Source Files
- `/app/lib/handlers/content.js` — Content CRUD endpoints
- `/app/lib/handlers/social.js` — Like, save, share, comment endpoints
- `/app/lib/auth-utils.js` — `enrichPosts()` function
- `/app/lib/moderation/middleware/moderate-create-content.js` — Moderation middleware
