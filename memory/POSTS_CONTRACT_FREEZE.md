# Posts — Contract Freeze
**Last Updated**: 2026-03-11

## Endpoints (20+ total)

### Post CRUD
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /content/posts | User | Create post (supports STANDARD, POLL, LINK, THREAD, CAROUSEL, DRAFT, SCHEDULED) |
| GET | /content/:id | Any | Get single post |
| PATCH | /content/:id | Owner/Admin | Edit post |
| DELETE | /content/:id | Owner/Admin | Delete post |

### Post Types
| Sub-Type | Body Fields | Description |
|----------|-------------|-------------|
| STANDARD | caption, mediaIds | Regular text/media post |
| POLL | poll: { options: [...], expiresIn } | Post with voting poll |
| LINK | linkUrl: "https://..." | Post with auto-fetched link preview |
| THREAD_PART | threadParentId: "uuid" | Part of a multi-post thread |
| CAROUSEL | mediaIds: [...], carousel: { order, coverIndex, aspectRatio } | Multi-image carousel |

### Draft & Scheduling
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /content/posts | User | Create draft (body: {status: "DRAFT"}) |
| POST | /content/posts | User | Create scheduled (body: {publishAt: "ISO date"}) |
| GET | /content/drafts | User | List my drafts |
| GET | /content/scheduled | User | List my scheduled posts |
| POST | /content/:id/publish | Owner | Publish draft immediately |
| PATCH | /content/:id/schedule | Owner | Reschedule a draft |

### Post Interactions
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /content/:id/vote | User | Vote on poll post |
| GET | /content/:id/poll-results | Any | Get poll results |
| GET | /content/:id/thread | Any | Get full thread view |

### Feeds
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /feed | Any | Ranked home feed (stage 2+ posts) |
| GET | /feed/latest | Any | Chronological feed |

## Post Schema
```json
{
  "id": "uuid",
  "kind": "POST",
  "authorId": "uuid",
  "authorType": "USER | PAGE",
  "caption": "string",
  "mediaIds": ["uuid"],
  "hashtags": ["string"],
  "visibility": "PUBLIC | PRIVATE | DRAFT | REMOVED | HELD",
  "postSubType": "STANDARD | POLL | LINK | THREAD_PART | CAROUSEL",
  "poll": { "options": [...], "userVotes": {...} } | null,
  "linkPreview": { "url", "title", "description", "image", "siteName" } | null,
  "thread": { "threadId", "partIndex" } | null,
  "carousel": { "isCarousel": true, "itemCount", "order": [...], "coverIndex", "aspectRatio" } | null,
  "isDraft": false,
  "publishAt": "ISODate | null",
  "publishedAt": "ISODate | null",
  "distributionStage": 0 | 1 | 2,
  "likeCount": 0, "commentCount": 0, "shareCount": 0, "viewCount": 0,
  "createdAt": "ISODate",
  "updatedAt": "ISODate"
}
```

## Distribution Stage Pipeline
| Stage | Meaning | Who Sees It |
|-------|---------|-------------|
| 0 | New / under review | Author only, not in public feed |
| 1 | Community stage | Limited distribution |
| 2 | Wide distribution | Full public feed visibility |

### Auto-Promotion Rules
- Clean moderation + PUBLIC visibility → Promoted to stage 2 immediately
- HELD/ESCALATED moderation → Stays at stage 0
- DRAFT posts → Stay at stage 0 with visibility DRAFT
- Admin can override via batch evaluate endpoint
- Engagement signals (likes, comments) can trigger re-evaluation

## Carousel Semantics
- Multi-media posts (2+ mediaIds) automatically get carousel metadata
- Explicit carousel config: order array, coverIndex, aspectRatio (SQUARE, PORTRAIT, LANDSCAPE, MIXED)
- Max 10 items per carousel
- If no carousel config provided with multiple media, auto-generates with sequential order

## Scheduling & Drafts
- Draft: {status: "DRAFT"} — visibility set to DRAFT, not in public feed
- Scheduled: {publishAt: "future ISO date"} — auto-publishes at specified time
- Max scheduling: 30 days ahead
- Background worker checks every 60 seconds for due scheduled posts
- Published drafts get distributionStage 2 immediately
- Scheduled posts increment postsCount only on actual publish

## Feed Cache Policy
- Authenticated users: NO cache (fresh per-request)
- Anonymous users: First page cached as `anon:limit{N}` (5 min TTL)
- No cross-user cache leakage possible
