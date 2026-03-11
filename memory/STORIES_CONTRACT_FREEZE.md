# Stories — Contract Freeze
**Last Updated**: 2026-03-11

## Endpoints (28 total)

### Story CRUD
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /stories | User | Create story (IMAGE/VIDEO/TEXT) |
| GET | /stories | User | Story rail (active, non-expired, privacy-filtered) |
| GET | /stories/:id | User | Get single story |
| PATCH | /stories/:id | Owner/Admin | Edit story (caption, privacy, text, background) |
| DELETE | /stories/:id | Owner/Admin | Delete story |

### Story Interactions
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /stories/:id/view | User | Record view |
| POST | /stories/:id/view-duration | User | Track view duration (durationMs, completed) |
| GET | /stories/:id/view-analytics | Owner/Admin | View duration analytics |
| POST | /stories/:id/react | User | React to story (emoji) |
| POST | /stories/:id/reply | User | Reply to story (DM-style) |
| GET | /stories/:id/viewers | Owner/Admin | List story viewers |
| POST | /stories/:id/sticker/:stickerId/respond | User | Respond to interactive sticker |

### Story Mutes
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /me/story-mutes/:userId | User | Mute user's stories |
| DELETE | /me/story-mutes/:userId | User | Unmute user's stories |
| GET | /me/story-mutes | User | List muted users |

### Story Management
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /me/stories | User | My stories |
| GET | /me/stories/archive | User | Story archive |
| GET | /me/story-settings | User | Story privacy settings |
| PUT | /me/story-settings | User | Update story settings |
| GET | /stories/highlights | User | Story highlights |
| POST | /stories/highlights | User | Create highlight |

### Story Admin
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /admin/stories/bulk-moderate | MOD+ | Bulk moderate (HOLD/REMOVE/RESTORE/APPROVE) |
| GET | /admin/stories/:id | ADMIN | Admin story details |
| POST | /admin/stories/:id/moderate | MOD+ | Moderate single story |

## Story Schema
```json
{
  "id": "uuid",
  "authorId": "uuid",
  "type": "IMAGE | VIDEO | TEXT",
  "media": [{ "id": "uuid", "url": "string", "type": "string", "mimeType": "string" }],
  "caption": "string | null (max 500 chars)",
  "text": "string | null (TEXT type, max 500 chars)",
  "stickers": [{ "id": "uuid", "type": "POLL|QUESTION|QUIZ|EMOJI_SLIDER|...", "position": {"x": 0, "y": 0}, ... }],
  "background": { "type": "SOLID|GRADIENT|IMAGE", "color": "#hex", ... } | null,
  "privacy": "EVERYONE | CLOSE_FRIENDS | CUSTOM",
  "replyPrivacy": "EVERYONE | FOLLOWING | CLOSE_FRIENDS | OFF",
  "status": "ACTIVE | HELD | REMOVED | EXPIRED",
  "viewCount": 0,
  "reactionCount": 0,
  "replyCount": 0,
  "expiresAt": "ISODate (24h after creation)",
  "createdAt": "ISODate",
  "updatedAt": "ISODate"
}
```

## Privacy Rules
- **EVERYONE**: All non-blocked users can view
- **CLOSE_FRIENDS**: Only users in author's close friends list
- **CUSTOM**: Based on hideStoryFrom settings
- Blocked users never see stories in either direction
- Muted users are filtered from the story rail only (stories still accessible via direct link)

## Rate Limits
- Story reactions: 10 per 5 minutes per user (anti-abuse service)
- Sticker responses: 30 per hour per user
- View duration tracking: 60 per minute per user
- Story creation: Governed by WRITE tier rate limit

## View Duration Tracking
- Tracks per-viewer duration and completion status
- Analytics available to story owner: avg/min/max duration, completion rate
- Anti-abuse: max 60 duration records per minute per user

## Bulk Moderation
- Actions: HOLD, REMOVE, RESTORE, APPROVE
- Max 50 stories per bulk action
- Requires MODERATOR, ADMIN, or SUPER_ADMIN role
- Audit trail: STORY_BULK_MODERATE event logged

## Story Mutes
- Muted user's stories are hidden from the story rail
- Does NOT affect blocking, following, or other interactions
- Stored in `story_mutes` collection with unique (userId, mutedUserId) index
- Users cannot mute themselves
