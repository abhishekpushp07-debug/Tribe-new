# Tribe — Post Features Contract Freeze (Phase D)
**Version**: 1.0 | **Date**: 2026-03-11

## Overview
Posts now support 4 sub-types beyond standard text/media posts: STANDARD, POLL, LINK, THREAD_HEAD, THREAD_PART.

## Post Sub-Types
```
postSubType: 'STANDARD' | 'POLL' | 'LINK' | 'THREAD_HEAD' | 'THREAD_PART'
```
All sub-types use `kind: 'POST'` — postSubType is additive, not a replacement for ContentKind.

---

## 1. Poll Posts

### Create
```
POST /api/content/posts
{
  "caption": "Which is best?",
  "kind": "POST",
  "poll": {
    "options": ["React", "Vue", "Svelte"],
    "expiresIn": 48,          // hours (default 24, max 168)
    "allowMultipleVotes": false // optional
  }
}
```

### Response Shape (in feed & detail)
```json
{
  "postSubType": "POLL",
  "poll": {
    "options": [
      { "id": "opt_0", "text": "React", "voteCount": 5 },
      { "id": "opt_1", "text": "Vue", "voteCount": 3 },
      { "id": "opt_2", "text": "Svelte", "voteCount": 1 }
    ],
    "totalVotes": 9,
    "expiresAt": "2026-03-13T10:00:00Z",
    "allowMultipleVotes": false
  },
  "viewerPollVote": "opt_0"  // null if not voted
}
```

### Vote
```
POST /api/content/:id/vote
{ "optionId": "opt_0" }
```
Returns updated poll results.

### Get Results
```
GET /api/content/:id/poll-results
```
Returns poll options, counts, expiry status, and viewer's vote.

### Constraints
- 2-6 options
- Option text max 120 chars
- Duplicate vote returns 409 (unless allowMultipleVotes)
- Expired poll returns 410 on vote attempt
- Poll results always visible (even after expiry)

---

## 2. Link Preview Posts

### Create
```
POST /api/content/posts
{
  "caption": "Check this article!",
  "kind": "POST",
  "linkUrl": "https://example.com/article"
}
```

### Response Shape
```json
{
  "postSubType": "LINK",
  "linkPreview": {
    "url": "https://example.com/article",
    "title": "Article Title",
    "description": "Brief description...",
    "image": "https://example.com/og-image.jpg",
    "siteName": "Example",
    "type": "article",
    "fetchedAt": "2026-03-11T10:00:00Z"
  }
}
```

### Behavior
- Link preview is fetched **asynchronously** after post creation
- Initial response has `linkPreview: null` — re-fetch post to get preview
- Safe degradation: if URL is unreachable or blocked, linkPreview stays null
- SSRF protection: internal/private IPs blocked, 5s timeout, 512KB max content
- Only `text/html` content types parsed
- Requires at least og:title or <title> to generate a preview

---

## 3. Thread / Long-Form Posts

### Create Thread Head (standard post, becomes head on first reply)
A regular post becomes a THREAD_HEAD when the first thread part is added.

### Add Thread Part
```
POST /api/content/posts
{
  "caption": "Part 2: More details...",
  "kind": "POST",
  "threadParentId": "<id-of-head-or-previous-part>"
}
```

### Response Shape
```json
{
  "postSubType": "THREAD_PART",
  "thread": {
    "threadId": "<head-post-id>",
    "partIndex": 2,
    "parentId": "<previous-part-id>"
  },
  "isThreadPart": true
}
```

### Read Full Thread
```
GET /api/content/:id/thread
```
Returns all thread parts in order:
```json
{
  "thread": [ /* array of enriched posts */ ],
  "isThread": true,
  "partCount": 3,
  "threadId": "<head-id>"
}
```

### Constraints
- Only the original author can add parts
- Max 20 parts per thread
- Thread parts appear in the feed independently
- Each part can have its own media, likes, comments
- Deleting a part doesn't break the thread (removed parts excluded from view)

---

## 4. Feed Impact
- Feed items now include `postSubType`, `poll`, `linkPreview`, `thread` fields
- Frontend must render based on `postSubType`:
  - STANDARD → normal post card
  - POLL → post card + poll options UI
  - LINK → post card + link preview card
  - THREAD_HEAD → post card + "Show thread" link
  - THREAD_PART → post card + "Part of thread" indicator
- `viewerPollVote` is included for authenticated users viewing poll posts
- `isThreadPart` flag helps frontend identify thread context

---

## 5. Compatibility
- All existing text/media posts continue to work unchanged (postSubType=STANDARD)
- New fields are additive — null/undefined when not applicable
- Moderation applies to all sub-types equally
- Block/privacy rules apply to all sub-types
- Search/hashtag/edit flows unaffected
- Old posts without postSubType field treated as STANDARD

## DB Collections Added
- `poll_votes`: { id, contentId, userId, optionId, createdAt }
  - Index: `{ contentId: 1, userId: 1 }` (compound unique for non-multiple-vote polls)
