# TRIBE — REELS BACKEND CONTRACT FREEZE
**Status**: FROZEN — B6 Phase 3 Launch-Ready
**Verified**: 2026-03-11 (49 launch gate tests + 238 regression tests)

---

## 1. REEL ENDPOINTS (FROZEN)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | /reels | Yes | Create reel |
| GET | /reels/feed | Yes | Discovery feed (score-ranked) |
| GET | /reels/following | Yes | Following feed |
| GET | /reels/:id | Optional | Reel detail |
| PATCH | /reels/:id | Yes | Edit reel |
| DELETE | /reels/:id | Yes | Delete reel |
| POST | /reels/:id/publish | Yes | Publish draft |
| POST | /reels/:id/archive | Yes | Archive reel |
| POST | /reels/:id/restore | Yes | Restore archived |
| POST | /reels/:id/like | Yes | Like reel |
| DELETE | /reels/:id/like | Yes | Unlike reel |
| POST | /reels/:id/save | Yes | Save reel |
| DELETE | /reels/:id/save | Yes | Unsave reel |
| POST | /reels/:id/comment | Yes | Comment on reel |
| GET | /reels/:id/comments | Optional | List comments |
| POST | /reels/:id/share | Yes | Track share |
| POST | /reels/:id/report | Yes | Report reel |
| POST | /reels/:id/hide | Yes | Hide from feed |
| POST | /reels/:id/not-interested | Yes | Mark not interested |
| POST | /reels/:id/watch | Yes | Track watch event |
| GET | /reels/:id/remixes | Optional | List remixes |
| GET | /reels/audio/:audioId | Optional | Reels using audio |
| GET | /users/:id/reels | Optional | User's reels |
| GET | /me/reels/analytics | Yes | Creator analytics |

---

## 2. FROZEN OBJECT SHAPES

### ReelObject (Feed Item)
```json
{
  "id": "uuid",
  "creatorId": "uuid",
  "caption": "string | null",
  "hashtags": ["string"],
  "mentions": ["string"],
  "playbackUrl": "string | null",
  "thumbnailUrl": "string | null",
  "posterFrameUrl": "string | null",
  "mediaStatus": "READY | UPLOADING",
  "durationMs": "number",
  "visibility": "PUBLIC | COLLEGE_ONLY | PRIVATE",
  "status": "PUBLISHED | DRAFT | ARCHIVED | HELD | REMOVED",
  "moderationStatus": "APPROVED | PENDING | HELD | REJECTED",
  "likeCount": "number",
  "commentCount": "number",
  "shareCount": "number",
  "saveCount": "number",
  "viewCount": "number",
  "uniqueViewerCount": "number",
  "reportCount": "number (admin-visible)",
  "score": "number (feed ranking)",
  "pinnedToProfile": "boolean",
  "remixOf": "{ reelId, creatorId } | null",
  "seriesId": "uuid | null",
  "audioMeta": "object | null",
  "syntheticDeclaration": "boolean",
  "brandedContent": "boolean",
  "publishedAt": "ISO string | null",
  "createdAt": "ISO string",
  "updatedAt": "ISO string"
}
```

### Feed Item Enrichment (GET /reels/feed)
```
base ReelObject + {
  "creator": UserSnippet,
  "likedByMe": boolean,
  "savedByMe": boolean
}
```

### Detail Enrichment (GET /reels/:id)
```
base ReelObject + {
  "creator": UserSnippet,
  "likedByMe": boolean,
  "savedByMe": boolean,
  "hiddenByMe": boolean,
  "notInterestedByMe": boolean,
  "remixSource": { reelId, creator: UserSnippet, caption } | undefined
}
```

**KEY DIFFERENCE**: Feed has 2 viewer fields. Detail has 4. This is intentional — feed is lightweight, detail is complete.

### ReelCommentObject
```json
{
  "id": "uuid",
  "reelId": "uuid",
  "creatorId": "uuid (reel owner)",
  "senderId": "uuid (commenter)",
  "text": "string",
  "body": "string (same as text — backward compat)",
  "parentId": "uuid | null (null = top-level)",
  "moderationStatus": "APPROVED | HELD",
  "likeCount": "number",
  "replyCount": "number",
  "createdAt": "ISO string",
  "updatedAt": "ISO string"
}
```
**INPUT RULE**: Request accepts `{ text }` OR `{ body }`. If both present, `body` takes precedence.
**STORAGE RULE**: Both `text` and `body` fields stored with same value.

### ReelCommentListItem (enriched)
```
base ReelCommentObject + {
  "sender": UserSnippet
}
```

### CreatorSnippet (UserSnippet)
```json
{
  "id": "uuid",
  "displayName": "string | null",
  "username": "string | null",
  "avatarUrl": "string | null",
  "avatarMediaId": "string | null",
  "role": "USER | MODERATOR | ADMIN | SUPER_ADMIN",
  "collegeId": "string | null",
  "collegeName": "string | null"
}
```

---

## 3. NOTIFICATION TYPES (FROZEN)

| Type | Trigger | Self-Suppress | Target |
|------|---------|---------------|--------|
| REEL_LIKE | User likes a reel | Yes | Reel creator |
| REEL_COMMENT | User comments on reel | Yes | Reel creator |
| REEL_SHARE | User shares a reel | Yes | Reel creator |

All reel notifications use `targetType: "REEL"`, `targetId: reelId`.
Deep-link: navigate to reel detail.

---

## 4. PAGINATION (FROZEN)

### Discovery Feed (GET /reels/feed)
- **Type**: Cursor-based
- **Cursor format**: `"score|id"` compound (tie-breaker safe)
- **Sort**: `score DESC, id DESC`
- **Response**: `{ items, pagination: { nextCursor, hasMore } }`
- **Backward compat**: Old single-score cursor still accepted

### Following Feed (GET /reels/following)
- **Type**: Cursor-based
- **Cursor format**: `publishedAt` ISO string
- **Sort**: `publishedAt DESC`
- **Response**: Same pagination shape

### Comments (GET /reels/:id/comments)
- **Type**: Offset-based
- **Params**: `offset=0&limit=20`
- **Sort**: `createdAt DESC`
- **Response**: `{ items, pagination: { total, offset, limit, hasMore } }`

### User Reels (GET /users/:id/reels)
- **Type**: Cursor-based
- **Cursor format**: `publishedAt` ISO string
- **Sort**: `pinnedToProfile DESC, publishedAt DESC`

---

## 5. ACTION SEMANTICS (FROZEN)

### Optimistic Safe
| Action | Idempotent | Side Effects |
|--------|-----------|--------------|
| Like | Yes (upsert) | +1 likeCount, REEL_LIKE notification (on new only) |
| Unlike | Yes (delete) | -1 likeCount (on existing only) |
| Save | Yes (upsert) | +1 saveCount (on new only) |
| Unsave | Yes (delete) | -1 saveCount (on existing only) |
| Hide | Yes (upsert) | Removed from feed |
| Not Interested | Yes (upsert) | Removed from feed |

### NOT Optimistic
| Action | Idempotent | Notes |
|--------|-----------|-------|
| Comment | No | Creates new doc each time |
| Share | No | Tracks each share action, +1 shareCount |
| Report | Deduplicated | 409 on duplicate, may auto-hold reel |

### Blocked Actions
| Action | Status | Error |
|--------|--------|-------|
| Like own reel | 400 | SELF_ACTION |
| Report own reel | 400 | SELF_ACTION |

---

## 6. ERROR SEMANTICS (FROZEN)

| Code | Meaning | When |
|------|---------|------|
| 200 | Success | Standard success |
| 201 | Created | Reel/comment/report created |
| 400 | Validation | Missing fields, self-action, invalid state |
| 401 | Unauthorized | Missing/invalid auth token |
| 403 | Forbidden | Blocked user, no access |
| 404 | Not Found | Reel doesn't exist or soft-deleted |
| 409 | Duplicate | Duplicate report |
| 410 | Gone | Reel has been REMOVED |
| 429 | Rate Limited | Too many requests |

Error response shape:
```json
{ "error": "Human-readable message", "code": "ERROR_CODE" }
```

---

## 7. VISIBILITY / STATE MATRIX (FROZEN)

### Reel Status Visibility
| Status | In Feed | Detail | Comment | Like | Report |
|--------|---------|--------|---------|------|--------|
| PUBLISHED | Yes | Yes | Yes | Yes | Yes |
| DRAFT | No | Self only | No | No | No |
| ARCHIVED | No | Self only | No | No | No |
| HELD | No | Admin only | No | No | No |
| REMOVED | No | 410 GONE | No | No | No |

### Block Enforcement (B6 HARDENED)
| Surface | Blocked Creator Hidden |
|---------|----------------------|
| Discovery feed | ✅ Yes |
| Following feed | ✅ Yes |
| Reel detail | ✅ Yes (403) |
| Comment list | ✅ Yes (blocked sender filtered) |
| Audio browse | ✅ Yes |
| Remix browse | ✅ Yes |

---

## 8. COUNTER TRUTH (PROVEN)

| Counter | Source of Truth | Idempotent | Proven |
|---------|----------------|------------|--------|
| likeCount | COUNT(reel_likes) | Yes (upsert) | ✅ Concurrent + rapid cycle tested |
| commentCount | COUNT(reel_comments WHERE approved) | No (append) | ✅ Multi-comment tested |
| shareCount | $inc on each share | No | ✅ Duplicate share tested |
| saveCount | COUNT(reel_saves) | Yes (upsert) | ✅ Rapid cycle tested |
| viewCount | COUNT(reel_views) | Yes (upsert) | ✅ Unique viewer tested |
| reportCount | COUNT(reel_reports) | Yes (dedup) | ✅ Duplicate tested |

**Safety**: Unlike/unsave can never make count < 0 (counts from collection, not $inc/$dec).

---

## 9. FRONTEND DECISION GUIDE

### What To Render on Reel Card (Feed)
- `playbackUrl` → video player (if null, show loading state)
- `thumbnailUrl` → poster frame
- `caption` → text overlay
- `creator.displayName || creator.username` → author name
- `creator.avatarUrl` → author avatar (fallback: default placeholder)
- `likeCount`, `commentCount`, `shareCount` → counters
- `likedByMe` → heart icon state
- `savedByMe` → bookmark icon state

### What To Render on Reel Detail
- Everything from feed card PLUS:
- `hiddenByMe`, `notInterestedByMe` → for UI state
- `remixSource` → "Remix of {original}" link if present
- `viewCount` → view counter

### When To Hide/Disable
- `status !== 'PUBLISHED'` → Don't show (shouldn't appear in feed anyway)
- `playbackUrl === null && mediaStatus === 'UPLOADING'` → Show "Processing..." placeholder
- Creator is null → Show "Unknown Creator" fallback

### Fallback/Empty States
- No reels in feed → "No reels yet" empty state
- 404 on detail → "Reel not found" → navigate back
- 410 on detail → "This reel has been removed" → navigate back
- 403 on detail → "You can't view this reel" (blocked)
- Comment list empty → "No comments yet. Be the first!"
- Network error → Retry with exponential backoff

---

## 10. INDEX COVERAGE (VERIFIED)

| Collection | Index | Supports |
|-----------|-------|----------|
| reels | `{id:1}` UNIQUE | Detail lookup |
| reels | `{status,moderationStatus,mediaStatus,visibility,score:-1}` | Discovery feed |
| reels | `{creatorId,status,publishedAt:-1}` | Following feed + creator reels |
| reels | `{creatorId,pinnedToProfile:-1,publishedAt:-1}` | Profile reels |
| reel_likes | `{reelId,userId}` UNIQUE | Like dedup + count |
| reel_saves | `{reelId,userId}` UNIQUE | Save dedup + count |
| reel_comments | `{reelId,moderationStatus,parentId,createdAt:-1}` | Comment list |
| reel_reports | `{reelId,reporterId}` UNIQUE | Report dedup |
| reel_views | `{reelId,viewerId}` UNIQUE | View dedup |
| notifications | `{userId,read,createdAt:-1}` | Notification list + unread |

---

## 11. LAUNCH VERDICT

### Test Evidence
| Suite | Tests | Status |
|-------|-------|--------|
| B6-P1 Reels Polish | 31 | ✅ ALL PASS |
| B6-P2 Reels Hardening | 28 | ✅ ALL PASS |
| B6-P3 Launch Readiness | 49 | ✅ ALL PASS |
| B3 Regression | 107 | ✅ ALL PASS |
| B4 Regression | 72 | ✅ ALL PASS |
| **TOTAL** | **287** | **ZERO REGRESSIONS** |

### Proven
- ✅ Contracts frozen from code truth
- ✅ All 20 edge cases tested
- ✅ Concurrent like test passed (3 users simultaneously)
- ✅ Rapid like/unlike/save/unsave cycles — counters correct
- ✅ Block enforcement on all 6 surfaces
- ✅ Pagination stable (no duplicates across pages)
- ✅ Notification types REEL_LIKE, REEL_COMMENT, REEL_SHARE working
- ✅ Self-notification suppressed
- ✅ Report dedup working

### FINAL VERDICT: **PASS**
Reels backend is frontend-buildable, contract-frozen, and launch-safe.
