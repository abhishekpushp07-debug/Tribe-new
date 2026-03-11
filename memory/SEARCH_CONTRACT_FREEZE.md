# B5 — Search & Discovery Contract Freeze

## Version: v2.0 (B5.1 UPGRADE)
## Status: FROZEN
## Date: 2026-03-11

---

## 1. Mixed Search — `GET /api/search`

### Query Parameters
| Param | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| q | string | Yes | - | Min 2 chars, trimmed |
| type | string | No | "all" | One of: all, users, pages, posts, hashtags, colleges, houses |
| limit | int | No | 10 | Max 20 |
| offset | int | No | 0 | For pagination — skip N results |

### Response Contract
```json
{
  "data": {
    "items": [
      { "...entityFields", "_resultType": "user|page|hashtag|post|college|house" }
    ],
    "users": [...],
    "pages": [...],
    "hashtags": [...],
    "posts": [...],
    "colleges": [...],
    "houses": [...],
    "pagination": {
      "total": "number",
      "offset": "number",
      "limit": "number",
      "hasMore": "boolean"
    }
  }
}
  }
}
```

### Safety Rules
- Banned users excluded (`isBanned: false`)
- Blocked users excluded (bidirectional)
- Blocked users' posts excluded
- Removed/held/deleted posts excluded
- Only PUBLIC posts returned
- Suspended/draft pages excluded (only ACTIVE/ARCHIVED)
- Safety filtering applied BEFORE pagination (blocked items never appear on later pages)

### Ranking Policy (B5.1)
All entity types use **3-tier ranking**: exact > prefix > contains.

| Entity | Tier 1 (Exact) | Tier 2 (Prefix) | Tier 3 (Contains) | Tie-break |
|--------|---------------|-----------------|-------------------|-----------|
| Users | displayName or username === query (case-insensitive) | startsWith query | contains query | followersCount DESC |
| Pages | name or slug === query (case-insensitive) | startsWith query | contains query | isOfficial DESC, followerCount DESC |
| Hashtags | tag === normalized query | startsWith query | contains query | postCount DESC |
| Posts | N/A (recency-ranked) | N/A | caption contains query | createdAt DESC |
| Colleges | N/A | N/A | normalizedName contains query | membersCount DESC |
| Houses | N/A | N/A | name contains query | totalPoints DESC |

### Pagination Semantics
- `offset` + `limit` based (not cursor)
- `total` = count of all matching results after safety filtering
- `hasMore` = `offset + limit < total`
- Stable ordering: same query returns same order absent data changes
- Frontend can implement "Load More" by incrementing `offset`

---

## 2. User Result Snippet
```json
{
  "id": "string",
  "displayName": "string|null",
  "username": "string|null",
  "avatarUrl": "string|null",
  "avatarMediaId": "string|null",
  "avatar": "string|null",
  "role": "string",
  "collegeId": "string|null",
  "collegeName": "string|null",
  "houseId": "string|null",
  "_resultType": "user"
}
```

---

## 3. Page Result Snippet
```json
{
  "id": "string",
  "slug": "string",
  "name": "string",
  "avatarUrl": "string|null",
  "avatarMediaId": "string|null",
  "category": "string",
  "isOfficial": "boolean",
  "verificationStatus": "string",
  "linkedEntityType": "string|null",
  "linkedEntityId": "string|null",
  "collegeId": "string|null",
  "tribeId": "string|null",
  "status": "string",
  "_resultType": "page"
}
```

### Ranking: `isOfficial DESC, followerCount DESC`

---

## 4. Hashtag Result Object
```json
{
  "tag": "string",
  "postCount": "number",
  "lastUsedAt": "string|null",
  "createdAt": "string|null",
  "updatedAt": "string|null",
  "_resultType": "hashtag"
}
```

### Search behavior
- Query with or without `#` prefix
- Case-insensitive matching
- Only tags with `postCount > 0` returned
- Sorted by `postCount DESC`

---

## 5. Hashtag Detail — `GET /api/hashtags/:tag`

### Response
```json
{
  "data": {
    "tag": "string",
    "postCount": "number",
    "createdAt": "string|null",
    "lastUsedAt": "string|null"
  }
}
```
- Normalizes input: strips `#`, lowercases
- Returns `{ tag, postCount: 0, createdAt: null }` for unknown tags
- Returns 400 for empty tag

---

## 6. Hashtag Trending — `GET /api/hashtags/trending`

### Query Parameters
| Param | Type | Default | Max |
|-------|------|---------|-----|
| limit | int | 20 | 50 |

### Response
```json
{
  "data": {
    "items": [{ "tag", "postCount", "lastUsedAt", "createdAt" }],
    "count": "number"
  }
}
```
- Sorted by `postCount DESC, lastUsedAt DESC`
- No `_id` leak

---

## 7. Hashtag Feed — `GET /api/hashtags/:tag/feed`

### Query Parameters
| Param | Type | Default | Notes |
|-------|------|---------|-------|
| limit | int | 10 | Standard pagination |
| cursor | string | null | ISO date cursor for next page |

### Response
```json
{
  "data": {
    "items": [{ "...enrichedPost" }],
    "tag": "string",
    "pagination": {
      "nextCursor": "string|null",
      "hasMore": "boolean"
    }
  }
}
```

### Safety Rules (same as search)
- PUBLIC visibility only
- kind: POST only
- No moderationHold
- No isRemoved
- No isDeleted
- Blocked users' content excluded (bidirectional)

### Ordering: `createdAt DESC` (cursor-based pagination)

---

## 8. Hashtag Extraction Rules

### Regex: `/#([a-zA-Z0-9_]+)/g`
### Normalization
- Lowercase
- Strip leading `#`
- Max 50 chars
- Must match `/^[a-z0-9_]+$/`
- Deduplicated within single post

### Extraction Points
- `POST /api/content/posts` — user post create
- `PATCH /api/content/:id` — user post edit
- `POST /api/pages/:id/posts` — page post create
- `PATCH /api/pages/:id/posts/:postId` — page post edit

### Stat Sync
- Create: increment `postCount` for all new tags (upsert)
- Edit: increment for added tags, decrement for removed tags
- Stats stored in `hashtags` collection: `{ tag, postCount, lastUsedAt, createdAt, updatedAt }`

---

## 9. Indexes

| Collection | Index | Purpose |
|-----------|-------|---------|
| hashtags | `{ tag: 1 }` UNIQUE | Tag lookup, dedup |
| hashtags | `{ postCount: -1, lastUsedAt: -1 }` | Trending query |
| content_items | `{ hashtags: 1, createdAt: -1 }` | Hashtag feed |
| content_items | `{ caption: 'text' }` | Post search |
| users | `{ displayName: 'text', username: 'text' }` | User search |

---

## 10. Error Semantics

| Scenario | HTTP | Code |
|----------|------|------|
| Empty/short query (< 2 chars) | 200 | Returns empty arrays |
| Invalid hashtag (empty after strip) | 400 | VALIDATION |
| Auth required (search) | 200/401 | Depends on authenticate() |
| Rate limited | 429 | RATE_LIMITED |

---

## 11. Frontend Integration Notes

- Use `_resultType` field to render correct card type in mixed search
- Hashtag feed uses cursor pagination (pass `cursor` param for next page)
- Search uses limit-based pagination (no cursor)
- Always display `tag` without `#` prefix (API stores normalized)
- `postCount` is live-synced on create/edit
- Official pages always sort first in page search results
