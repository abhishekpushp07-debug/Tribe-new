# B0.7 — Pagination, Cursor & Stream Contract
> Generated: 2026-03-10 | Source: auth-utils.js parsePagination + all handler files
> Purpose: Frontend infinite scroll, lists, and SSE work correctly first time

---

## Pagination Styles

This backend uses **two pagination styles** (ANOMALY #6 from B0.1):

### Style 1: Cursor-based (preferred for feeds)
```
Request:  ?cursor=<ISO_date>&limit=20
Response: { items: [...], nextCursor: "<ISO_date>" | null, hasMore: boolean }
```

### Style 2: Offset-based (for countable lists)
```
Request:  ?offset=0&limit=20
Response: { users: [...], total: number, offset: number, limit: number }
```

---

## Global Defaults

| Config | Value | Source |
|---|---|---|
| `DEFAULT_PAGE_LIMIT` | 20 | constants.js |
| `MAX_PAGE_LIMIT` | 50 | constants.js |
| Default if no limit param | 20 | — |
| Limit clamped to max | 50 | parsePagination() |

---

## Per-Endpoint Pagination Detail

### CURSOR-BASED ENDPOINTS

| Endpoint | Cursor Field | Sort Order | Default Limit | Notes |
|---|---|---|---|---|
| `GET /api/feed/public` | `createdAt` (desc) | newest first | 20 | First page cached |
| `GET /api/feed/following` | `createdAt` (desc) | newest first | 20 | — |
| `GET /api/feed/college/:id` | `createdAt` (desc) | newest first | 20 | First page cached |
| `GET /api/feed/house/:id` | `createdAt` (desc) | newest first | 20 | First page cached |
| `GET /api/feed/stories` | grouped | own stories first | — | Grouped by author, not paginated in traditional sense |
| `GET /api/feed/reels` | `createdAt` (desc) | newest first | 20 | Cached |
| `GET /api/content/:id/comments` | `createdAt` (asc) | oldest first | 20 | Replies: use `?parentId=<id>` |
| `GET /api/notifications` | `createdAt` (desc) | newest first | 20 | Includes `unreadCount` in response |
| `GET /api/users/:id/saved` | `createdAt` (desc) | newest first | 20 | — |
| `GET /api/stories/feed` | mixed | — | — | Stories collection feed |
| `GET /api/reels/feed` | mixed | — | 20 | Personalized ordering |
| `GET /api/reels/following` | `createdAt` (desc) | newest first | 20 | — |
| `GET /api/reels/:id/comments` | `createdAt` (asc) | oldest first | 20 | — |
| `GET /api/events/feed` | `startDate` (asc) | upcoming first | 20 | — |
| `GET /api/colleges/:id/notices` | `createdAt` (desc) | newest first | 20 | — |
| `GET /api/resources/search` | varies by sort | see below | 20 | Faceted |
| `GET /api/me/resources` | `createdAt` (desc) | newest first | 20 | — |

### Resource Sort Orders
| Sort Param | Cursor Field | Order |
|---|---|---|
| `recent` (default) | `createdAt` | desc |
| `popular` | `voteScore` | desc |
| `most_downloaded` | `downloadCount` | desc |

### OFFSET-BASED ENDPOINTS

| Endpoint | Default Limit | Sort Order | Notes |
|---|---|---|---|
| `GET /api/users/:id/followers` | 20 | `createdAt` desc | Returns `total` count |
| `GET /api/users/:id/following` | 20 | `createdAt` desc | Returns `total` count |
| `GET /api/colleges/search` | 20 | relevance | Multi-word AND matching |
| `GET /api/colleges/:id/members` | 20 | `followersCount` desc | — |
| `GET /api/houses/:id/members` | 20 | `points` desc | — |
| `GET /api/tribes/:id/members` | 20 | `points` desc | — |
| `GET /api/search` | 20 | relevance | — |
| `GET /api/moderation/queue` | 20 | `reportCount` desc | — |

### NON-PAGINATED ENDPOINTS (return all results)

| Endpoint | Max Results | Notes |
|---|---|---|
| `GET /api/houses` | all | Cached, typically 5-10 houses |
| `GET /api/houses/leaderboard` | all | Cached |
| `GET /api/tribes` | all | Typically 5 tribes |
| `GET /api/tribes/standings/current` | all | — |
| `GET /api/suggestions/users` | 15 | Hard capped |
| `GET /api/appeals` | 20 | Hard capped (user's own) |
| `GET /api/grievances` | 20 | Hard capped (user's own) |
| `GET /api/me/college-claims` | 50 | Claim history |

---

## Cursor Format

- Cursors are **ISO 8601 date strings** (e.g., `2026-03-10T12:00:00.000Z`)
- They represent the `createdAt` (or sort field) of the last item on current page
- Next page: server queries `createdAt < cursor` (for desc) or `createdAt > cursor` (for asc)
- First page: omit `cursor` parameter
- Empty page: `nextCursor: null`, `hasMore: false`

---

## Duplicate Handling

- Cursor pagination inherently avoids duplicates (timestamp-based)
- **Edge case**: Multiple items with same `createdAt` timestamp could cause skip. Backend uses `_id` as tiebreaker in some feeds.
- Offset pagination can show duplicates if items are inserted between page loads

---

## Empty Page Semantics

```json
{
  "data": {
    "items": [],
    "nextCursor": null,
    "hasMore": false
  }
}
```
Status: 200 (not 404)

---

## SSE Stream Contract

### `GET /api/stories/events/stream`

**Transport**: Server-Sent Events (SSE)
**Auth**: Required (Bearer token in query param or header)
**Content-Type**: `text/event-stream`

**Event Types**:
| Event | Data Shape | When |
|---|---|---|
| `story_created` | `{ storyId, authorId, type }` | New story from followed user |
| `story_viewed` | `{ storyId, viewerId }` | Someone viewed your story |
| `story_reacted` | `{ storyId, reactorId, emoji }` | Reaction on your story |
| `story_replied` | `{ storyId, replierId }` | Reply on your story |
| `story_expired` | `{ storyId }` | Story hit 24h TTL |
| `heartbeat` | `{ timestamp }` | Keep-alive, every 30s |

**Reconnect**: Client should reconnect on drop. No `Last-Event-ID` support.

**Example SSE stream**:
```
event: story_created
data: {"storyId":"abc","authorId":"xyz","type":"IMAGE"}

event: heartbeat
data: {"timestamp":"2026-03-10T12:00:30.000Z"}
```

---

## Reverse Pagination

Not supported on any endpoint. All feeds are forward-only (newest to oldest for desc, oldest to newest for asc).

---

## B0.7 EXIT GATE: PASS

Pagination styles per endpoint documented. Cursor format clear.
SSE stream contract with event types defined.
Sort orders, defaults, and edge cases captured.
