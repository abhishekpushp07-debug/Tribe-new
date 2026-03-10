# Tribe — API Reference (Contract v2.1)
Generated from verified backend truth. FH1-U gate.

## Base URL
`/api/` prefix required for all routes.

---

## Auth Domain
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /auth/register | No | Register with phone+pin |
| POST | /auth/login | No | Login with phone+pin |
| POST | /auth/refresh | No | Refresh access token |
| POST | /auth/logout | Yes | Logout |
| GET | /auth/me | Yes | Current user profile |
| GET | /auth/sessions | Yes | List sessions |
| DELETE | /auth/sessions | Yes | Logout all sessions |
| DELETE | /auth/sessions/:id | Yes | Kill specific session |
| PATCH | /auth/pin | Yes | Change PIN |

### Register Request
```json
{ "phone": "7777000001", "pin": "1234", "displayName": "Name", "username": "uname" }
```
### Register/Login Response
```json
{
  "accessToken": "at_...",
  "refreshToken": "rt_...",
  "user": { /* UserProfile */ }
}
```

---

## Profile / Onboarding Domain
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| PATCH | /me/profile | Yes | Update profile fields |
| PATCH | /me/age | Yes | Set age/birthDate |
| PATCH | /me/college | Yes | Set college |
| PATCH | /me/onboarding | Yes | Complete onboarding |

---

## Media Domain
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /media/upload | Yes | Upload media file |
| GET | /media/:id | No | Resolve media by ID (returns binary) |

---

## Content / Posts Domain
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /content/posts | Yes | Create post/reel/story |
| GET | /content/:id | Yes | Get content detail |
| PATCH | /content/:id | Yes | Edit post caption (B4) |
| DELETE | /content/:id | Yes | Soft-delete content |

### Create Post Request
```json
{ "caption": "Hello world", "kind": "POST", "media": ["media-id-1"] }
```
kinds: `POST`, `REEL`, `STORY`

### Edit Post Request (B4)
```json
{ "caption": "Updated caption" }
```
Returns enriched PostObject with `editedAt` set.

---

## Social / Interactions Domain
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /follow/:userId | Yes | Follow user |
| DELETE | /follow/:userId | Yes | Unfollow user |
| POST | /content/:id/like | Yes | Like content |
| POST | /content/:id/dislike | Yes | Dislike content |
| DELETE | /content/:id/reaction | Yes | Remove reaction |
| POST | /content/:id/save | Yes | Save/bookmark |
| DELETE | /content/:id/save | Yes | Unsave |
| POST | /content/:id/comments | Yes | Create comment |
| GET | /content/:id/comments | Optional | List comments |
| POST | /content/:postId/comments/:commentId/like | Yes | Like comment (B4) |
| DELETE | /content/:postId/comments/:commentId/like | Yes | Unlike comment (B4) |
| POST | /content/:id/share | Yes | Repost/share content (B4) |

### Comment Like Response (B4)
```json
{ "liked": true, "commentLikeCount": 3 }
```

### Share/Repost Response (B4)
Returns `201` with `{ "post": { /* RepostObject */ } }`

---

## Feed Domain
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | /feed/public | Yes | Public feed |
| GET | /feed/following | Yes | Following feed (includes page posts) |
| GET | /feed/college/:collegeId | Yes | College feed |
| GET | /feed/house/:houseId | Yes | House feed |
| GET | /feed/stories | Yes | Story rails |
| GET | /feed/reels | Yes | Reel feed |

All feeds return `{ items: PostObject[], pagination: { nextCursor, hasMore } }`

---

## Users Domain
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | /users/:id | Optional | User profile |
| GET | /users/:id/posts | Optional | User's posts |
| GET | /users/:id/followers | Optional | User's followers |
| GET | /users/:id/following | Optional | User's following |
| GET | /users/:id/saved | Yes (self) | User's saved posts |

---

## Stories Domain
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /stories | Yes | Create story |
| GET | /stories/feed | Yes | Story feed/rails |
| GET | /stories/:id | Yes | Story detail |
| DELETE | /stories/:id | Yes | Delete story |
| GET | /stories/:id/views | Yes | View list |
| POST | /stories/:id/react | Yes | React to story |
| DELETE | /stories/:id/react | Yes | Remove reaction |
| POST | /stories/:id/reply | Yes | Reply to story |
| GET | /stories/:id/replies | Yes | List replies |
| POST | /stories/:id/sticker/:stickerId/respond | Yes | Respond to sticker |
| GET | /stories/:id/sticker/:stickerId/results | Yes | Sticker results |
| GET | /stories/:id/sticker/:stickerId/responses | Yes | Sticker responses |
| GET | /me/stories/archive | Yes | Story archive |
| GET | /users/:id/stories | Yes | User's active stories |
| GET | /me/close-friends | Yes | Close friends list |
| POST | /me/close-friends/:userId | Yes | Add close friend |
| DELETE | /me/close-friends/:userId | Yes | Remove close friend |
| POST | /me/highlights | Yes | Create highlight |
| GET | /users/:id/highlights | Yes | User's highlights |
| PATCH | /me/highlights/:id | Yes | Update highlight |
| DELETE | /me/highlights/:id | Yes | Delete highlight |
| GET | /me/story-settings | Yes | Get story settings |
| PATCH | /me/story-settings | Yes | Update story settings |

---

## Reels Domain
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /reels | Yes | Create reel |
| GET | /reels/feed | Yes | Reel feed |
| GET | /reels/following | Yes | Following reels |
| GET | /reels/:id | Yes | Reel detail |
| PATCH | /reels/:id | Yes | Edit reel |
| DELETE | /reels/:id | Yes | Delete reel |
| POST | /reels/:id/publish | Yes | Publish draft reel |
| POST | /reels/:id/archive | Yes | Archive reel |
| POST | /reels/:id/restore | Yes | Restore archived reel |
| POST | /reels/:id/pin | Yes | Pin reel |
| DELETE | /reels/:id/pin | Yes | Unpin reel |
| POST | /reels/:id/like | Yes | Like reel |
| DELETE | /reels/:id/like | Yes | Unlike reel |
| POST | /reels/:id/save | Yes | Save reel |
| DELETE | /reels/:id/save | Yes | Unsave reel |
| POST | /reels/:id/comment | Yes | Comment on reel |
| GET | /reels/:id/comments | Yes | Reel comments |
| POST | /reels/:id/report | Yes | Report reel |
| POST | /reels/:id/hide | Yes | Hide reel |
| POST | /reels/:id/not-interested | Yes | Not interested |
| POST | /reels/:id/share | Yes | Share reel |
| POST | /reels/:id/watch | Yes | Record watch |
| POST | /reels/:id/view | Yes | Record view |
| GET | /reels/audio/:audioId | Yes | Audio details |
| GET | /reels/:id/remixes | Yes | Reel remixes |
| POST | /me/reels/series | Yes | Create series |
| GET | /users/:id/reels/series | Yes | User's reel series |
| GET | /me/reels/archive | Yes | Archived reels |
| GET | /me/reels/analytics | Yes | Reel analytics |
| GET | /users/:id/reels | Yes | User's reels |

---

## Notifications Domain
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | /notifications | Yes | List notifications |
| PATCH | /notifications/read | Yes | Mark as read |

---

## Pages Domain (B3)
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /pages | Yes | Create page |
| GET | /pages | No | List/search pages |
| GET | /pages/:idOrSlug | No | Page detail |
| PATCH | /pages/:id | Yes | Update page |
| POST | /pages/:id/archive | Yes | Archive page |
| POST | /pages/:id/restore | Yes | Restore page |
| GET | /pages/:id/members | Yes | List members |
| POST | /pages/:id/members | Yes | Add member |
| PATCH | /pages/:id/members/:userId | Yes | Change role |
| DELETE | /pages/:id/members/:userId | Yes | Remove member |
| POST | /pages/:id/transfer-ownership | Yes | Transfer ownership |
| POST | /pages/:id/follow | Yes | Follow page |
| DELETE | /pages/:id/follow | Yes | Unfollow page |
| GET | /pages/:id/followers | Yes | List followers |
| GET | /pages/:id/posts | No | Page's posts |
| POST | /pages/:id/posts | Yes | Publish as page |
| PATCH | /pages/:id/posts/:postId | Yes | Edit page post |
| DELETE | /pages/:id/posts/:postId | Yes | Delete page post |
| GET | /me/pages | Yes | My pages |
| GET | /pages/:id/analytics | Yes | Page analytics |

---

## Search / Discovery Domain
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | /search?q=...&type=... | No | Unified search (types: users, colleges, houses, pages) |
| GET | /colleges/search | No | Search colleges |
| GET | /colleges/states | No | List states |
| GET | /colleges/types | No | List college types |
| GET | /colleges/:id | No | College detail |
| GET | /colleges/:id/members | No | College members |
| GET | /houses | No | List houses |
| GET | /houses/leaderboard | No | House leaderboard |
| GET | /houses/:id | No | House detail |
| GET | /houses/:id/members | No | House members |
| GET | /suggestions/users | Yes | User suggestions |

---

## Tribes Domain
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | /tribes | No | List tribes |
| GET | /tribes/standings/current | No | Current standings |
| GET | /tribes/:id | No | Tribe detail |
| GET | /tribes/:id/members | No | Tribe members |
| GET | /tribes/:id/board | No | Tribe board |
| GET | /tribes/:id/fund | No | Tribe fund |
| GET | /tribes/:id/salutes | No | Tribe salutes |
| GET | /me/tribe | Yes | My tribe info |
| GET | /users/:id/tribe | No | User's tribe |

---

## Tribe Contests Domain
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | /tribe-contests | No | List contests |
| GET | /tribe-contests/:id | No | Contest detail |
| POST | /tribe-contests/:id/enter | Yes | Enter contest |
| GET | /tribe-contests/:id/entries | No | Contest entries |
| GET | /tribe-contests/:id/leaderboard | No | Contest leaderboard |
| GET | /tribe-contests/:id/results | No | Contest results |
| POST | /tribe-contests/:id/vote | Yes | Vote on entry |
| POST | /tribe-contests/:id/withdraw | Yes | Withdraw entry |
| GET | /tribe-contests/seasons | No | List seasons |
| GET | /tribe-contests/seasons/:id/standings | No | Season standings |

---

## Events Domain
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /events | Yes | Create event |
| GET | /events/feed | No | Event feed |
| GET | /events/search | No | Search events |
| GET | /events/college/:collegeId | No | College events |
| GET | /events/:id | No | Event detail |
| PATCH | /events/:id | Yes | Update event |
| DELETE | /events/:id | Yes | Delete event |
| POST | /events/:id/publish | Yes | Publish event |
| POST | /events/:id/cancel | Yes | Cancel event |
| POST | /events/:id/archive | Yes | Archive event |
| POST | /events/:id/rsvp | Yes | RSVP to event |
| DELETE | /events/:id/rsvp | Yes | Cancel RSVP |
| GET | /events/:id/attendees | No | Event attendees |
| POST | /events/:id/report | Yes | Report event |
| POST | /events/:id/remind | Yes | Set reminder |
| DELETE | /events/:id/remind | Yes | Remove reminder |
| GET | /me/events | Yes | My events |
| GET | /me/events/rsvps | Yes | My RSVPs |

---

## Governance Domain
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | /governance/college/:id/board | No | College board |
| POST | /governance/college/:id/apply | Yes | Apply for board |
| GET | /governance/college/:id/applications | No | Board applications |
| POST | /governance/applications/:id/vote | Yes | Vote on application |
| POST | /governance/college/:id/proposals | Yes | Create proposal |
| GET | /governance/college/:id/proposals | No | List proposals |
| POST | /governance/proposals/:id/vote | Yes | Vote on proposal |

---

## Reports / Moderation / Admin
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /reports | Yes | Submit report |
| GET | /moderation/queue | Admin | Moderation queue |
| POST | /moderation/:id/action | Admin | Take mod action |
| POST | /appeals | Yes | Submit appeal |
| GET | /appeals | Admin | List appeals |
| POST | /appeals/:id/decide | Admin | Decide appeal |
| GET | /legal/consent | Yes | Get consent status |
| POST | /legal/accept | Yes | Accept legal terms |
| POST | /grievances | Yes | Submit grievance |
| GET | /grievances | Admin | List grievances |

---

## Board Notices Domain
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /board/notices | Yes | Create notice |
| GET | /board/notices/:id | No | Notice detail |
| PATCH | /board/notices/:id | Yes | Update notice |
| DELETE | /board/notices/:id | Yes | Delete notice |
| POST | /board/notices/:id/pin | Yes | Pin notice |
| DELETE | /board/notices/:id/pin | Yes | Unpin notice |
| POST | /board/notices/:id/acknowledge | Yes | Acknowledge notice |
| GET | /board/notices/:id/acknowledgments | Yes | Acknowledgment list |
| GET | /colleges/:id/notices | No | College notices |
| GET | /me/board/notices | Yes | My board notices |

---

## Block / Safety Domain
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /me/blocks/:userId | Yes | Block user |
| DELETE | /me/blocks/:userId | Yes | Unblock user |
| GET | /me/blocks | Yes | Blocked users list |

---

## Resources Domain
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| POST | /resources | Yes | Create resource |
| GET | /resources/search | No | Search resources |
| GET | /resources/:id | No | Resource detail |
| PATCH | /resources/:id | Yes | Update resource |
| DELETE | /resources/:id | Yes | Delete resource |
| POST | /resources/:id/report | Yes | Report resource |
| POST | /resources/:id/vote | Yes | Vote on resource |
| DELETE | /resources/:id/vote | Yes | Remove vote |
| POST | /resources/:id/download | Yes | Track download |
| GET | /me/resources | Yes | My resources |

---

## Health
| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| GET | /healthz | No | Liveness |
| GET | /readyz | No | Readiness |
| GET | /deep-health | No | Deep health check |
