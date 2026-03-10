# B0.6 — Error Contract & Status Code Map
> Generated: 2026-03-10 | Source: All handler files + constants.js ErrorCode enum
> Purpose: Frontend knows every error shape, when to retry, when to show user message

---

## Universal Error Envelope

All errors follow this shape:
```json
{
  "error": "string (human-readable message)",
  "code": "string (machine-readable error code)",
  "status": "number (HTTP status, also in HTTP response)"
}
```

Some errors include additional fields:
```json
{
  "error": "...",
  "code": "...",
  "details": "string (optional, extra context)",
  "retryAfterSec": "number (optional, for rate limits)"
}
```

---

## Error Code Registry (from constants.js)

| Code | HTTP Status | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request body/params invalid |
| `UNAUTHORIZED` | 401 | No valid auth token |
| `ACCESS_TOKEN_EXPIRED` | 401 | Access token expired, use refresh |
| `FORBIDDEN` | 403 | Authenticated but not allowed |
| `NOT_FOUND` | 404 | Resource doesn't exist (or hidden) |
| `CONFLICT` | 409 | Duplicate action (re-follow, re-vote same direction) |
| `RATE_LIMITED` | 429 | Too many requests |
| `CONTENT_HELD` | 200 | Content created but held for review (not error, but flagged) |
| `MODERATION_FAILED` | 500 | AI moderation service error |
| `INTERNAL_ERROR` | 500 | Unexpected server error |
| `MAX_ENTRIES_REACHED` | 409 | Contest max entries hit |
| `TRIBE_MAX_ENTRIES` | 409 | Per-tribe entry limit hit |
| `INVALID_STATE` | 400 | State machine transition invalid |
| `CLAIM_COOLDOWN` | 400 | College claim cooldown active |
| `CLAIM_FRAUD` | 403 | Account flagged for claim fraud |

---

## Per-Domain Error Semantics

### AUTH

| Scenario | Status | Code | Body |
|---|---|---|---|
| Missing phone/pin/displayName | 400 | `VALIDATION_ERROR` | `"phone, pin, and displayName are required"` |
| Phone not 10 digits | 400 | `VALIDATION_ERROR` | `"phone must be 10 digits"` |
| PIN not 4 digits | 400 | `VALIDATION_ERROR` | `"pin must be 4 digits"` |
| Phone already registered | 409 | `CONFLICT` | `"Phone already registered"` |
| Wrong PIN | 401 | `UNAUTHORIZED` | `"Invalid credentials"` |
| Account locked (brute force) | 429 | `RATE_LIMITED` | `"Too many login attempts. Retry after X seconds"` + `retryAfterSec` |
| User banned | 403 | `FORBIDDEN` | `"Account banned"` |
| User suspended | 403 | `FORBIDDEN` | `"Account suspended until <date>"` |
| Invalid refresh token | 401 | `UNAUTHORIZED` | `"Invalid refresh token"` |
| Refresh token reuse detected | 401 | `UNAUTHORIZED` | `"Token reuse detected"` (entire family revoked!) |
| Expired refresh token | 401 | `UNAUTHORIZED` | `"Refresh token expired"` |

### CONTENT

| Scenario | Status | Code | Body |
|---|---|---|---|
| Not age-verified | 403 | `FORBIDDEN` | `"Age verification required"` |
| Invalid content kind | 400 | `VALIDATION_ERROR` | `"Invalid content kind"` |
| REEL/STORY without media | 400 | `VALIDATION_ERROR` | `"Media required for REEL/STORY"` |
| POST without caption or media | 400 | `VALIDATION_ERROR` | `"Post must have caption or media"` |
| Content not found | 404 | `NOT_FOUND` | `"Content not found"` |
| Content held by AI | 200 | — | `visibility: "HELD"` in response (not an error) |
| Not author (delete) | 403 | `FORBIDDEN` | `"Access denied"` |

### SOCIAL

| Scenario | Status | Code | Body |
|---|---|---|---|
| Self-follow | 409 | `CONFLICT` | `"Cannot follow yourself"` |
| Already following (re-follow) | 200 | — | Idempotent success |
| Content not found (like/save) | 404 | `NOT_FOUND` | `"Content not found"` |
| Duplicate like | 200 | — | Idempotent (switches from dislike) |
| Comment too long | 400 | `VALIDATION_ERROR` | `"Comment exceeds max length"` |
| Comment empty | 400 | `VALIDATION_ERROR` | `"Comment text required"` |
| Comment held by AI | 200 | — | `visibility: "HELD"` in response |

### USERS

| Scenario | Status | Code | Body |
|---|---|---|---|
| User not found | 404 | `NOT_FOUND` | `"User not found"` |
| Saved posts: not self | 403 | `FORBIDDEN` | `"Access denied: not your saved posts"` |

### STORIES

| Scenario | Status | Code | Body |
|---|---|---|---|
| Invalid type | 400 | `VALIDATION_ERROR` | `"type must be TEXT, IMAGE, or VIDEO"` |
| TEXT without text | 400 | `VALIDATION_ERROR` | `"text required for TEXT story"` |
| IMAGE/VIDEO without media | 400 | `VALIDATION_ERROR` | `"mediaId required"` |
| Rate limited (30/hr) | 429 | `RATE_LIMITED` | `"Story creation rate limit exceeded"` |
| Story not found | 404 | `NOT_FOUND` | — |
| Story expired | 404 | `NOT_FOUND` | (expired = not found) |
| Privacy denied | 404 | `NOT_FOUND` | (private story returns 404, NOT 403 — hides existence) |
| Blocked user | 404 | `NOT_FOUND` | (blocked = not found) |
| Not author (views/replies) | 403 | `FORBIDDEN` | `"Only the story author can view this"` |
| Invalid emoji | 400 | `VALIDATION_ERROR` | `"Invalid emoji"` |
| Reply privacy off | 403 | `FORBIDDEN` | `"Replies disabled"` |

### REELS

| Scenario | Status | Code | Body |
|---|---|---|---|
| Not owner (edit/publish/archive) | 403 | `FORBIDDEN` | `"Not the reel owner"` |
| Not owner (delete) + not admin | 403 | `FORBIDDEN` | — |
| Comment on reel | 400 | — | **KNOWN BUG: currently returns 400** |
| Report reel | 400 | — | **KNOWN BUG: currently returns 400** |
| Reel not found | 404 | `NOT_FOUND` | — |

### REPORTS

| Scenario | Status | Code | Body |
|---|---|---|---|
| Missing targetType/targetId | 400 | `VALIDATION_ERROR` | — |
| Target not found | 404 | `NOT_FOUND` | — |
| 3+ reports auto-hold | 200 | — | Content auto-held (background) |

### APPEALS

| Scenario | Status | Code | Body |
|---|---|---|---|
| Already have pending appeal | 409 | `CONFLICT` | `"Appeal already pending"` |
| Invalid action | 400 | `VALIDATION_ERROR` | — |

### RESOURCES

| Scenario | Status | Code | Body |
|---|---|---|---|
| Wrong college | 403 | `FORBIDDEN` | `"Can only share resources for your college"` |
| Rate limited (10/hr) | 429 | `RATE_LIMITED` | `"Upload limit exceeded"` |
| Duplicate same-direction vote | 409 | `CONFLICT` | `"Already voted in this direction"` |
| Resource not found | 404 | `NOT_FOUND` | — |

### COLLEGE CLAIMS

| Scenario | Status | Code | Body |
|---|---|---|---|
| Already have active claim | 409 | `CONFLICT` | `"Active claim exists"` |
| Cooldown active (7 days after rejection) | 400 | `CLAIM_COOLDOWN` | `"Claim cooldown active"` |
| Fraud flagged (3+ rejections) | 403 | `CLAIM_FRAUD` | `"Account flagged for fraud"` |

### TRIBE CONTESTS

| Scenario | Status | Code | Body |
|---|---|---|---|
| Contest not in correct state | 400 | `INVALID_STATE` | `"Contest not accepting entries/votes"` |
| Max entries reached | 409 | `MAX_ENTRIES_REACHED` | — |
| Already entered | 409 | `CONFLICT` | `"Already entered"` |
| Cross-tribe voting violation | 403 | `FORBIDDEN` | — |

---

## Special Error Semantics

### 404 vs 403 for Hidden Content
- **Held content**: Returns 404 to non-owners (hides existence). Owner sees it.
- **Shadow-limited**: Returns 404 to non-owners. Author doesn't know it's limited.
- **Removed content**: Returns 404 to everyone except admin.
- **Blocked user**: Blocked user sees 404 on blocker's stories (not 403).
- **Private story**: Non-close-friends see 404 on close-friends-only stories.

**Rule**: Backend prefers 404 over 403 to avoid information leakage.

### Rate Limit Response Shape
```json
{
  "error": "Rate limit exceeded",
  "code": "RATE_LIMITED",
  "retryAfterSec": 900
}
```
HTTP Header: `Retry-After: 900`

### Moderation Hold (Not Error)
When AI moderation flags content, it's still created but with `visibility: "HELD"` or `"HELD_FOR_REVIEW"`. The 200/201 response includes the held content.

---

## B0.6 EXIT GATE: PASS

Error codes, status patterns, and edge-case semantics documented for all domains.
404 vs 403 hidden-content pattern explicitly called out.
