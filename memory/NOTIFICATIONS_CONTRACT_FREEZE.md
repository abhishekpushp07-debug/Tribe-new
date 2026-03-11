# Notifications 2.0 — Contract Freeze
## B6 Phase 4 | Tribe Backend

> This document captures the production-grade Notifications 2.0 subsystem truth.
> Derived from code, not imagination.

---

## 1. Architecture Decision

### Canonical Write Path
All notification creation flows through `createNotificationV2` in `/app/lib/services/notification-service.js`.

The legacy `createNotification` function in `/app/lib/auth-utils.js` now delegates to `createNotificationV2`:
```js
export async function createNotification(db, userId, type, actorId, targetType, targetId, message) {
  return createNotificationV2(db, { userId, type, actorId, targetType, targetId, message })
}
```

### Why No Split-Brain
- All existing callers (social.js, reels.js, stories.js, pages.js, content.js) import `createNotification` from `auth-utils.js`
- That function now delegates to `createNotificationV2`
- All notification writes pass through the same V2 pipeline: self-suppress → preference check → block check → dedup → insert
- Zero code paths bypass this pipeline

### V2 Pipeline Rules (Applied to Every Notification)
1. **Self-notify suppression**: `userId === actorId` → suppressed (always)
2. **Preference check**: User's stored preference for `type` must be `true` (defaults: all enabled)
3. **Force-deliver override**: Types `REPORT_RESOLVED`, `STRIKE_ISSUED`, `APPEAL_DECIDED` bypass preferences
4. **Block check**: Bidirectional block between recipient and actor → suppressed
5. **Dedup window**: Same `{userId, type, actorId, targetId}` within 5 minutes → suppressed

---

## 2. API Endpoints

### GET /api/notifications
**Auth**: Required  
**Tier**: READ (120/min)  
**Query Params**:
- `limit` (int, default 20, max 50)
- `cursor` (ISO datetime string)
- `grouped` ("true" to enable grouping)

**Response**:
```json
{
  "items": [...],
  "notifications": [...],  // backward-compat alias
  "pagination": { "nextCursor": "...", "hasMore": true },
  "nextCursor": "...",
  "unreadCount": 5
}
```

### PATCH /api/notifications/read
**Auth**: Required  
**Tier**: WRITE (30/min)  
**Body**: `{ "ids": ["notif-id-1", "notif-id-2"] }` (empty/missing = mark all read)  
**Response**: `{ "message": "Notifications marked as read", "unreadCount": 0 }`

### GET /api/notifications/unread-count
**Auth**: Required  
**Tier**: READ  
**Response**: `{ "unreadCount": 3 }`

### POST /api/notifications/register-device
**Auth**: Required  
**Tier**: WRITE  
**Body**:
```json
{
  "token": "fcm_or_apns_token_string",
  "platform": "IOS" | "ANDROID" | "WEB",
  "deviceId": "optional-device-id",
  "appVersion": "optional-version"
}
```
**Response (201 created)**: `{ "message": "Device token registered", "registered": true }`  
**Response (200 updated)**: `{ "message": "Device token updated", "registered": true }`

### DELETE /api/notifications/unregister-device
**Auth**: Required  
**Tier**: WRITE  
**Body**: `{ "token": "the_token_to_deactivate" }`  
**Response**: `{ "message": "Device token deactivated", "deactivated": true }`

### GET /api/notifications/preferences
**Auth**: Required  
**Tier**: READ  
**Response**:
```json
{
  "preferences": {
    "FOLLOW": true, "LIKE": true, "COMMENT": true, "COMMENT_LIKE": true,
    "SHARE": true, "MENTION": true, "REEL_LIKE": true, "REEL_COMMENT": true,
    "REEL_SHARE": true, "STORY_REACTION": true, "STORY_REPLY": true,
    "STORY_REMOVED": true, "REPORT_RESOLVED": true, "STRIKE_ISSUED": true,
    "APPEAL_DECIDED": true, "HOUSE_POINTS": true
  }
}
```

### PATCH /api/notifications/preferences
**Auth**: Required  
**Tier**: WRITE  
**Body**: `{ "preferences": { "LIKE": false, "FOLLOW": true } }`  
**Validation**: Only known keys, boolean values only  
**Response**: `{ "preferences": {...full merged prefs...}, "message": "Preferences updated" }`

---

## 3. Object Shapes

### Individual Notification
```json
{
  "id": "uuid",
  "type": "LIKE",
  "actorId": "user-uuid",
  "targetType": "CONTENT",
  "targetId": "content-uuid",
  "message": "User X liked your post",
  "read": false,
  "createdAt": "2026-03-11T...",
  "actor": { /* sanitized user snippet or null */ }
}
```

### Grouped Notification
```json
{
  "id": "latest-notif-uuid",
  "type": "LIKE",
  "targetType": "CONTENT",
  "targetId": "content-uuid",
  "actorCount": 5,
  "actors": [{ /* up to 3 user snippets */ }],
  "count": 5,
  "unreadCount": 3,
  "message": "User X and 4 others",
  "read": false,
  "createdAt": "2026-03-11T..."
}
```

### Grouping Key
`${type}:${targetId || 'none'}` — same type + same target = 1 group.

---

## 4. Notification Types (Enum)
```
FOLLOW, LIKE, COMMENT, COMMENT_LIKE, SHARE, MENTION,
REEL_LIKE, REEL_COMMENT, REEL_SHARE,
STORY_REACTION, STORY_REPLY, STORY_REMOVED,
REPORT_RESOLVED, STRIKE_ISSUED, APPEAL_DECIDED, HOUSE_POINTS
```

### Force-Deliver Types (Ignore Preferences)
`REPORT_RESOLVED`, `STRIKE_ISSUED`, `APPEAL_DECIDED`

---

## 5. Collections & Indexes

### `notifications` (existing, enhanced)
| Index | Purpose |
|---|---|
| `{userId, createdAt: -1}` | Inbox list |
| `{userId, read}` | Unread count |
| `{userId, type, actorId, targetId, createdAt: -1}` | Dedup window query |
| `{userId, type, targetId, createdAt: -1}` | Grouping support |
| `{id}` | Direct lookup |

### `device_tokens` (new)
| Index | Purpose |
|---|---|
| `{userId, token}` unique | Dedup registration |
| `{token}` | Cross-user token reassignment |
| `{userId, isActive}` | Active token lookup |

### `notification_preferences` (new)
| Index | Purpose |
|---|---|
| `{userId}` unique | Preference lookup |

---

## 6. Device Token Behavior
- **Dedup**: Same userId + token → upsert (updates lastSeenAt, platform, etc.)
- **Reassignment**: Same token registered by different user → old user's token set `isActive: false`
- **Unregister**: `DELETE /unregister-device` sets `isActive: false`
- **Fields**: `id, userId, token, platform, deviceId, appVersion, isActive, lastSeenAt, createdAt, updatedAt`

---

## 7. Files Changed in B6-P4
| File | Change |
|---|---|
| `/app/lib/services/notification-service.js` | Created V2 service (dedup, prefs, blocks, grouping) |
| `/app/lib/handlers/notifications.js` | Created handler (7 endpoints) |
| `/app/app/api/[[...path]]/route.js` | Wired notifications handler, removed from admin catch-all |
| `/app/lib/handlers/admin.js` | Removed old GET/PATCH notifications routes |
| `/app/lib/auth-utils.js` | Canonical write path: createNotification → createNotificationV2 |
| `/app/lib/constants.js` | Added STORY_REACTION, STORY_REPLY, STORY_REMOVED to NotificationType |
| `/app/lib/db.js` | Added indexes for device_tokens, notification_preferences, notification dedup/grouping |
| `/app/tests/conftest.py` | Added cleanup for device_tokens, notification_preferences |
| `/app/tests/handlers/test_b6_p4_notifications.py` | 59-test comprehensive suite |

---

## 8. Test Coverage Summary (59 tests)
- **Route reachability**: 9 tests
- **Device tokens**: 10 tests (register, dedup, reassignment, unregister, validation)
- **Preferences**: 9 tests (defaults, patch, unknown keys, boolean, idempotency)
- **Unread count truth**: 9 tests (increment, self-suppress, block, preference, dedup, mark-read)
- **Grouping truth**: 6 tests (same target, different targets, preview cap, unread semantics, ordering)
- **Canonical write path**: 2 tests (follow→V2, force-deliver)
- **Contract shapes**: 7 tests (all response shapes verified)
- **Idempotency**: 3 tests (mark-read, device register, preferences)
- **Pagination**: 1 test
- **Regression**: 3 tests (old list, mark-read, no _id leak)
