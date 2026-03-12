# TRIBE — Complete API Reference (309 Endpoints)
**Generated**: 2026-03-11 | **Backend URL**: `https://dev-hub-39.preview.emergentagent.com`
**Total Endpoints**: 309 | **Domains**: 24

All routes prefixed with `/api/`. Auth header: `Authorization: Bearer {accessToken}`

---

## Quick Stats
| Domain | Endpoints | Auth Required |
|--------|-----------|---------------|
| Auth & Sessions | 9 | Mixed |
| Profile & Onboarding | 4 | Yes |
| Users | 10 | Mixed |
| Content / Posts | 7 | Mixed |
| Social Interactions | 12 | Yes |
| Feed | 6 | Mixed |
| Stories | 33 | Mixed |
| Reels | 36 | Mixed |
| Pages | 20 | Mixed |
| Notifications | 7 | Yes |
| Media | 6 | Yes |
| Search & Discovery | 14 | Mixed |
| Events | 22 | Mixed |
| Tribes | 10 | Mixed |
| Tribe Contests | 14 | Mixed |
| Tribe Admin | 17 | Admin |
| Board Notices | 13 | Mixed |
| Authenticity Tags | 4 | Yes |
| Resources | 12 | Mixed |
| Governance | 8 | Yes |
| House Points | 5 | Mixed |
| Admin & Moderation | 13 | Admin |
| Admin Media | 4 | Admin |
| Admin Distribution | 7 | Admin |
| College Claims | 6 | Mixed |
| Health | 3 | No |
| **TOTAL** | **309** | |

---

## 1. AUTH & SESSIONS (9)
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 1 | POST | `/auth/register` | No | Register with phone/PIN |
| 2 | POST | `/auth/login` | No | Login with phone/PIN |
| 3 | POST | `/auth/refresh` | No | Refresh access token |
| 4 | POST | `/auth/logout` | Yes | Logout current session |
| 5 | GET | `/auth/me` | Yes | Get current user profile |
| 6 | GET | `/auth/sessions` | Yes | List all active sessions |
| 7 | DELETE | `/auth/sessions` | Yes | Terminate all sessions |
| 8 | DELETE | `/auth/sessions/:id` | Yes | Terminate specific session |
| 9 | PATCH | `/auth/pin` | Yes | Change PIN |

### Register
```
POST /api/auth/register
{ "phone": "7777099001", "pin": "1234", "displayName": "My Name" }
→ { accessToken, refreshToken, user }
```

### Login
```
POST /api/auth/login
{ "phone": "7777099001", "pin": "1234" }
→ { accessToken, refreshToken, user }
```

### Refresh
```
POST /api/auth/refresh
{ "refreshToken": "rt_..." }
→ { accessToken, refreshToken }
```

---

## 2. PROFILE & ONBOARDING (4)
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 10 | PATCH | `/me/profile` | Yes | Update display name, username, bio, avatar |
| 11 | PATCH | `/me/age` | Yes | Set age/DOB (ageStatus → ADULT/MINOR) |
| 12 | PATCH | `/me/college` | Yes | Set college, house, graduation year |
| 13 | PATCH | `/me/onboarding` | Yes | Mark onboarding complete |

---

## 3. USERS (10)
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 14 | GET | `/users/:id` | No | Get user public profile |
| 15 | GET | `/users/:id/posts` | Mixed | Get user's posts (cursor paginated) |
| 16 | GET | `/users/:id/followers` | Mixed | Get user's followers list |
| 17 | GET | `/users/:id/following` | Mixed | Get user's following list |
| 18 | GET | `/users/:id/saved` | Yes | Get user's saved content (own only) |
| 19 | GET | `/users/:id/reels` | Mixed | Get user's published reels |
| 20 | GET | `/users/:id/reels/series` | Mixed | Get user's reel series |
| 21 | GET | `/users/:id/stories` | Yes | Get user's active stories |
| 22 | GET | `/users/:id/highlights` | Mixed | Get user's highlight reels |
| 23 | GET | `/users/:id/tribe` | Mixed | Get user's tribe info |

---

## 4. CONTENT / POSTS (7)
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 24 | POST | `/content/posts` | Yes | Create post (standard/poll/link/thread) |
| 25 | GET | `/content/:id` | Mixed | Get single post detail |
| 26 | PATCH | `/content/:id` | Yes | Edit post caption |
| 27 | DELETE | `/content/:id` | Yes | Soft-delete post |
| 28 | POST | `/content/:id/vote` | Yes | Vote on poll post |
| 29 | GET | `/content/:id/poll-results` | Mixed | Get poll results + viewer vote |
| 30 | GET | `/content/:id/thread` | Mixed | Get full thread view |

### Create Standard Post
```json
POST /api/content/posts
{ "caption": "Hello world!", "kind": "POST" }
```

### Create Poll Post
```json
POST /api/content/posts
{ "caption": "Which is best?", "kind": "POST",
  "poll": { "options": ["React", "Vue", "Svelte"], "expiresIn": 24 } }
```

### Create Link Post
```json
POST /api/content/posts
{ "caption": "Check this!", "kind": "POST", "linkUrl": "https://example.com" }
```

### Create Thread Part
```json
POST /api/content/posts
{ "caption": "Part 2...", "kind": "POST", "threadParentId": "<head-id>" }
```

### Vote on Poll
```json
POST /api/content/:id/vote
{ "optionId": "opt_0" }
```

---

## 5. SOCIAL INTERACTIONS (12)
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 31 | POST | `/follow/:id` | Yes | Follow user |
| 32 | DELETE | `/follow/:id` | Yes | Unfollow user |
| 33 | POST | `/content/:id/like` | Yes | Like content |
| 34 | POST | `/content/:id/dislike` | Yes | Dislike content |
| 35 | DELETE | `/content/:id/reaction` | Yes | Remove like/dislike |
| 36 | POST | `/content/:id/save` | Yes | Save/bookmark content |
| 37 | DELETE | `/content/:id/save` | Yes | Unsave content |
| 38 | POST | `/content/:id/comments` | Yes | Add comment |
| 39 | GET | `/content/:id/comments` | Mixed | List comments (cursor paginated) |
| 40 | POST | `/content/:id/comments/:cid/like` | Yes | Like a comment |
| 41 | DELETE | `/content/:id/comments/:cid/like` | Yes | Unlike a comment |
| 42 | POST | `/content/:id/share` | Yes | Share/repost content |

---

## 6. FEED (6)
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 43 | GET | `/feed/public` | Mixed | Algorithmically ranked public feed |
| 44 | GET | `/feed/following` | Yes | Following-only feed |
| 45 | GET | `/feed/college/:id` | Mixed | College-scoped feed |
| 46 | GET | `/feed/tribe/:id` | Mixed | Tribe-scoped feed |
| 47 | GET | `/feed/stories` | Yes | Story rail feed |
| 48 | GET | `/feed/reels` | Mixed | Reel discovery feed |

Query params: `?limit=20&cursor=<id>&sort=recent|top`

---

## 7. STORIES (33)
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 49 | POST | `/stories` | Yes | Create story |
| 50 | GET | `/stories/feed` | Yes | Story rail (grouped by author) |
| 51 | GET | `/stories/:id` | Yes | Get single story |
| 52 | DELETE | `/stories/:id` | Yes | Delete own story |
| 53 | GET | `/stories/:id/views` | Yes | Get story view list (author only) |
| 54 | POST | `/stories/:id/react` | Yes | React to story (emoji) |
| 55 | DELETE | `/stories/:id/react` | Yes | Remove reaction |
| 56 | POST | `/stories/:id/reply` | Yes | Reply to story |
| 57 | GET | `/stories/:id/replies` | Yes | Get story replies (author only) |
| 58 | POST | `/stories/:id/sticker/:sid/respond` | Yes | Respond to sticker (poll/question/etc) |
| 59 | GET | `/stories/:id/sticker/:sid/results` | Yes | Get sticker aggregated results |
| 60 | GET | `/stories/:id/sticker/:sid/responses` | Yes | Get sticker individual responses |
| 61 | POST | `/stories/:id/report` | Yes | Report story |
| 62 | GET | `/stories/events/stream` | Yes | SSE live story events |
| 63 | GET | `/me/stories/archive` | Yes | My archived/expired stories |
| 64 | GET | `/me/close-friends` | Yes | My close friends list |
| 65 | POST | `/me/close-friends/:id` | Yes | Add close friend |
| 66 | DELETE | `/me/close-friends/:id` | Yes | Remove close friend |
| 67 | POST | `/me/highlights` | Yes | Create highlight reel |
| 68 | GET | `/me/highlights/:id` | Yes | — |
| 69 | PATCH | `/me/highlights/:id` | Yes | Edit highlight |
| 70 | DELETE | `/me/highlights/:id` | Yes | Delete highlight |
| 71 | GET | `/me/story-settings` | Yes | Get story privacy settings |
| 72 | PATCH | `/me/story-settings` | Yes | Update story settings |
| 73 | POST | `/me/blocks/:id` | Yes | Block user |
| 74 | DELETE | `/me/blocks/:id` | Yes | Unblock user |
| 75 | GET | `/me/blocks` | Yes | List blocked users |
| 76 | GET | `/admin/stories/analytics` | Admin | Story system analytics |
| 77 | GET | `/admin/stories` | Admin | Admin story listing |
| 78 | PATCH | `/admin/stories/:id/moderate` | Admin | Moderate story |
| 79 | POST | `/admin/stories/:id/recompute-counters` | Admin | Recompute counters |
| 80 | POST | `/admin/stories/cleanup` | Admin | Cleanup expired stories |

---

## 8. REELS (36)
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 81 | POST | `/reels` | Yes | Create reel (draft) |
| 82 | GET | `/reels/feed` | Mixed | Discovery reel feed |
| 83 | GET | `/reels/following` | Yes | Following reels feed |
| 84 | GET | `/reels/:id` | Mixed | Get single reel |
| 85 | PATCH | `/reels/:id` | Yes | Edit reel metadata |
| 86 | DELETE | `/reels/:id` | Yes | Delete reel |
| 87 | POST | `/reels/:id/publish` | Yes | Publish draft reel |
| 88 | POST | `/reels/:id/archive` | Yes | Archive reel |
| 89 | POST | `/reels/:id/restore` | Yes | Restore archived reel |
| 90 | POST | `/reels/:id/pin` | Yes | Pin reel to profile |
| 91 | DELETE | `/reels/:id/pin` | Yes | Unpin reel |
| 92 | POST | `/reels/:id/like` | Yes | Like reel |
| 93 | DELETE | `/reels/:id/like` | Yes | Unlike reel |
| 94 | POST | `/reels/:id/save` | Yes | Save reel |
| 95 | DELETE | `/reels/:id/save` | Yes | Unsave reel |
| 96 | POST | `/reels/:id/comment` | Yes | Comment on reel |
| 97 | GET | `/reels/:id/comments` | Mixed | Get reel comments |
| 98 | POST | `/reels/:id/report` | Yes | Report reel |
| 99 | POST | `/reels/:id/hide` | Yes | Hide reel from feed |
| 100 | POST | `/reels/:id/not-interested` | Yes | Mark not interested |
| 101 | POST | `/reels/:id/share` | Yes | Share reel |
| 102 | POST | `/reels/:id/watch` | Yes | Log watch event (duration) |
| 103 | POST | `/reels/:id/view` | Yes | Log view impression |
| 104 | GET | `/reels/audio/:audioId` | Mixed | Get reels by audio |
| 105 | GET | `/reels/:id/remixes` | Mixed | Get remixes of a reel |
| 106 | POST | `/me/reels/series` | Yes | Create reel series |
| 107 | GET | `/me/reels/archive` | Yes | My archived reels |
| 108 | GET | `/me/reels/analytics` | Yes | Creator analytics |
| 109 | POST | `/reels/:id/processing` | Yes | Trigger reel processing |
| 110 | GET | `/reels/:id/processing` | Yes | Get processing status |
| 111 | GET | `/admin/reels` | Admin | Admin reel listing |
| 112 | PATCH | `/admin/reels/:id/moderate` | Admin | Moderate reel |
| 113 | GET | `/admin/reels/analytics` | Admin | System reel analytics |
| 114 | POST | `/admin/reels/:id/recompute-counters` | Admin | Recompute counters |

---

## 9. PAGES (20)
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 115 | POST | `/pages` | Yes | Create page |
| 116 | GET | `/pages` | Mixed | List/search pages |
| 117 | GET | `/pages/:id` | Mixed | Get page detail |
| 118 | PATCH | `/pages/:id` | Yes | Edit page (owner/admin) |
| 119 | POST | `/pages/:id/archive` | Yes | Archive page |
| 120 | POST | `/pages/:id/restore` | Yes | Restore page |
| 121 | GET | `/pages/:id/members` | Mixed | Get page members/roles |
| 122 | POST | `/pages/:id/members` | Yes | Invite member |
| 123 | PATCH | `/pages/:id/members/:uid` | Yes | Change member role |
| 124 | DELETE | `/pages/:id/members/:uid` | Yes | Remove member |
| 125 | POST | `/pages/:id/transfer-ownership` | Yes | Transfer page ownership |
| 126 | POST | `/pages/:id/follow` | Yes | Follow page |
| 127 | DELETE | `/pages/:id/follow` | Yes | Unfollow page |
| 128 | GET | `/pages/:id/followers` | Mixed | Get page followers |
| 129 | GET | `/pages/:id/posts` | Mixed | Get page posts |
| 130 | POST | `/pages/:id/posts` | Yes | Create post as page |
| 131 | PATCH | `/pages/:id/posts/:pid` | Yes | Edit page post |
| 132 | DELETE | `/pages/:id/posts/:pid` | Yes | Delete page post |
| 133 | GET | `/me/pages` | Yes | My pages |
| 134 | GET | `/pages/:id/analytics` | Yes | Page analytics (admin) |

---

## 10. NOTIFICATIONS (7)
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 135 | GET | `/notifications` | Yes | List notifications (cursor paginated) |
| 136 | PATCH | `/notifications/read` | Yes | Mark notifications as read |
| 137 | GET | `/notifications/unread-count` | Yes | Get unread count |
| 138 | POST | `/notifications/register-device` | Yes | Register push device |
| 139 | DELETE | `/notifications/unregister-device` | Yes | Unregister push device |
| 140 | GET | `/notifications/preferences` | Yes | Get notification preferences |
| 141 | PATCH | `/notifications/preferences` | Yes | Update preferences |

---

## 11. MEDIA (6)
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 142 | POST | `/media/upload-init` | Yes | Initialize upload (get Supabase URL) |
| 143 | POST | `/media/upload-complete` | Yes | Mark upload complete |
| 144 | GET | `/media/upload-status/:id` | Yes | Check upload status |
| 145 | POST | `/media/upload` | Yes | Direct upload (small files) |
| 146 | GET | `/media/:id` | Yes | Get media serving URL |
| 147 | DELETE | `/media/:id` | Yes | Delete media asset |

---

## 12. SEARCH & DISCOVERY (14)
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 148 | GET | `/search` | Mixed | Unified search (?q=&type=all/users/pages/posts/hashtags) |
| 149 | GET | `/colleges/search` | No | Search colleges |
| 150 | GET | `/colleges/states` | No | List states |
| 151 | GET | `/colleges/types` | No | List college types |
| 152 | GET | `/colleges/:id` | No | College detail |
| 153 | GET | `/colleges/:id/members` | Mixed | College members |
| 154 | GET | `/houses` | Mixed | List houses |
| 155 | GET | `/houses/leaderboard` | Mixed | House leaderboard |
| 156 | GET | `/houses/:id` | Mixed | House detail |
| 157 | GET | `/houses/:id/members` | Mixed | House members |
| 158 | GET | `/hashtags/:tag` | Mixed | Hashtag detail + count |
| 159 | GET | `/hashtags/trending` | Mixed | Trending hashtags |
| 160 | GET | `/hashtags/:tag/feed` | Mixed | Posts by hashtag |
| 161 | GET | `/suggestions/users` | Yes | Suggested users to follow |

---

## 13. EVENTS (22)
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 162 | POST | `/events` | Yes | Create event |
| 163 | GET | `/events/feed` | Mixed | Event feed |
| 164 | GET | `/events/search` | Mixed | Search events |
| 165 | GET | `/events/college/:id` | Mixed | College events |
| 166 | GET | `/events/:id` | Mixed | Event detail |
| 167 | PATCH | `/events/:id` | Yes | Edit event |
| 168 | DELETE | `/events/:id` | Yes | Delete event |
| 169 | POST | `/events/:id/publish` | Yes | Publish draft event |
| 170 | POST | `/events/:id/cancel` | Yes | Cancel event |
| 171 | POST | `/events/:id/archive` | Yes | Archive event |
| 172 | POST | `/events/:id/rsvp` | Yes | RSVP to event |
| 173 | DELETE | `/events/:id/rsvp` | Yes | Remove RSVP |
| 174 | GET | `/events/:id/attendees` | Mixed | Event attendees |
| 175 | POST | `/events/:id/report` | Yes | Report event |
| 176 | POST | `/events/:id/remind` | Yes | Set event reminder |
| 177 | DELETE | `/events/:id/remind` | Yes | Remove reminder |
| 178 | GET | `/me/events` | Yes | My created events |
| 179 | GET | `/me/events/rsvps` | Yes | My RSVPs |
| 180 | GET | `/admin/events` | Admin | Admin event listing |
| 181 | PATCH | `/admin/events/:id/moderate` | Admin | Moderate event |
| 182 | GET | `/admin/events/analytics` | Admin | Event analytics |
| 183 | POST | `/admin/events/:id/recompute-counters` | Admin | Recompute counters |

---

## 14. TRIBES (10)
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 184 | GET | `/tribes` | No | List all 21 tribes |
| 185 | GET | `/tribes/leaderboard` | No | Tribe leaderboard |
| 186 | GET | `/tribes/standings/current` | No | Current season standings |
| 187 | GET | `/tribes/:id` | No | Tribe detail |
| 188 | GET | `/tribes/:id/members` | Mixed | Tribe members |
| 189 | GET | `/tribes/:id/board` | Mixed | Tribe board members |
| 190 | GET | `/tribes/:id/fund` | Mixed | Tribe fund info |
| 191 | GET | `/tribes/:id/salutes` | Mixed | Tribe salutes received |
| 192 | GET | `/me/tribe` | Yes | My tribe info |
| 193 | GET | `/users/:id/tribe` | Mixed | User's tribe |

---

## 15. TRIBE CONTESTS (14 User + 15 Admin = 29)
### User Endpoints
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 194 | GET | `/tribe-contests` | Mixed | List contests |
| 195 | GET | `/tribe-contests/:id` | Mixed | Contest detail |
| 196 | GET | `/tribe-contests/live-feed` | Mixed | Live contest feed |
| 197 | GET | `/tribe-contests/:id/live` | Mixed | Live contest updates |
| 198 | GET | `/tribe-contests/seasons` | Mixed | List seasons |
| 199 | GET | `/tribe-contests/seasons/:id/standings` | Mixed | Season standings |
| 200 | GET | `/tribe-contests/seasons/:id/live-standings` | Mixed | Live standings |
| 201 | POST | `/tribe-contests/:id/enter` | Yes | Enter contest |
| 202 | GET | `/tribe-contests/:id/entries` | Mixed | Contest entries |
| 203 | GET | `/tribe-contests/:id/leaderboard` | Mixed | Contest leaderboard |
| 204 | GET | `/tribe-contests/:id/results` | Mixed | Contest results |
| 205 | POST | `/tribe-contests/:id/vote` | Yes | Vote on entry |
| 206 | POST | `/tribe-contests/:id/withdraw` | Yes | Withdraw from contest |

### Admin Contest Endpoints
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 207 | POST | `/admin/tribe-contests` | Admin | Create contest |
| 208 | GET | `/admin/tribe-contests` | Admin | List all contests |
| 209 | GET | `/admin/tribe-contests/:id` | Admin | Contest admin detail |
| 210 | POST | `/admin/tribe-contests/:id/publish` | Admin | Publish contest |
| 211 | POST | `/admin/tribe-contests/:id/open-entries` | Admin | Open entries |
| 212 | POST | `/admin/tribe-contests/:id/close-entries` | Admin | Close entries |
| 213 | POST | `/admin/tribe-contests/:id/lock` | Admin | Lock contest |
| 214 | POST | `/admin/tribe-contests/:id/resolve` | Admin | Resolve contest |
| 215 | POST | `/admin/tribe-contests/:id/disqualify` | Admin | Disqualify entry |
| 216 | POST | `/admin/tribe-contests/:id/judge-score` | Admin | Add judge score |
| 217 | POST | `/admin/tribe-contests/:id/compute-scores` | Admin | Compute final scores |
| 218 | POST | `/admin/tribe-contests/:id/recompute-broadcast` | Admin | Recompute + broadcast |
| 219 | POST | `/admin/tribe-contests/:id/cancel` | Admin | Cancel contest |
| 220 | POST | `/admin/tribe-contests/rules` | Admin | Set contest rules |
| 221 | GET | `/admin/tribe-contests/dashboard` | Admin | Contest dashboard |

---

## 16. TRIBE ADMIN (7)
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 222 | GET | `/admin/tribes/distribution` | Admin | Tribe distribution stats |
| 223 | POST | `/admin/tribes/reassign` | Admin | Reassign user to tribe |
| 224 | POST | `/admin/tribe-seasons` | Admin | Create new season |
| 225 | GET | `/admin/tribe-seasons` | Admin | List seasons |
| 226 | POST | `/admin/tribe-salutes/adjust` | Admin | Adjust salute points |
| 227 | POST | `/admin/tribe-awards/resolve` | Admin | Resolve awards |
| 228 | POST | `/admin/tribes/migrate` | Admin | Migrate tribe data |
| 229 | POST | `/admin/tribes/boards` | Admin | Manage tribe boards |

---

## 17. BOARD NOTICES (13)
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 230 | POST | `/board/notices` | Yes | Create notice |
| 231 | GET | `/board/notices/:id` | Mixed | Get notice |
| 232 | PATCH | `/board/notices/:id` | Yes | Edit notice |
| 233 | DELETE | `/board/notices/:id` | Yes | Delete notice |
| 234 | POST | `/board/notices/:id/pin` | Yes | Pin notice |
| 235 | DELETE | `/board/notices/:id/pin` | Yes | Unpin notice |
| 236 | POST | `/board/notices/:id/acknowledge` | Yes | Acknowledge notice |
| 237 | GET | `/board/notices/:id/acknowledgments` | Yes | Get acknowledgments |
| 238 | GET | `/colleges/:id/notices` | Mixed | College notice board |
| 239 | GET | `/me/board/notices` | Yes | My notices |
| 240 | GET | `/moderation/board-notices` | Admin | Moderation queue |
| 241 | POST | `/moderation/board-notices/:id/decide` | Admin | Moderate notice |
| 242 | GET | `/admin/board-notices/analytics` | Admin | Notice analytics |

---

## 18. AUTHENTICITY TAGS (4)
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 243 | POST | `/authenticity/tag` | Yes | Create authenticity tag |
| 244 | GET | `/authenticity/tags/:type/:id` | Yes | Get entity tags |
| 245 | DELETE | `/authenticity/tags/:id` | Yes | Remove tag |
| 246 | GET | `/admin/authenticity/stats` | Admin | Authenticity stats |

---

## 19. RESOURCES (12)
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 247 | POST | `/resources` | Yes | Create resource |
| 248 | GET | `/resources/search` | Mixed | Search resources |
| 249 | GET | `/resources/:id` | Mixed | Get resource |
| 250 | PATCH | `/resources/:id` | Yes | Edit resource |
| 251 | DELETE | `/resources/:id` | Yes | Delete resource |
| 252 | POST | `/resources/:id/report` | Yes | Report resource |
| 253 | POST | `/resources/:id/vote` | Yes | Upvote resource |
| 254 | DELETE | `/resources/:id/vote` | Yes | Remove vote |
| 255 | POST | `/resources/:id/download` | Yes | Log download |
| 256 | GET | `/me/resources` | Yes | My resources |
| 257 | GET | `/admin/resources` | Admin | Admin listing |
| 258 | PATCH | `/admin/resources/:id/moderate` | Admin | Moderate resource |
| 259 | POST | `/admin/resources/:id/recompute-counters` | Admin | Recompute counters |
| 260 | POST | `/admin/resources/reconcile` | Admin | Reconcile resources |

---

## 20. GOVERNANCE (8)
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 261 | GET | `/governance/college/:id/board` | Yes | Get college board |
| 262 | POST | `/governance/college/:id/apply` | Yes | Apply for board |
| 263 | GET | `/governance/college/:id/applications` | Yes | List applications |
| 264 | POST | `/governance/applications/:id/vote` | Yes | Vote on application |
| 265 | POST | `/governance/college/:id/proposals` | Yes | Create proposal |
| 266 | GET | `/governance/college/:id/proposals` | Yes | List proposals |
| 267 | POST | `/governance/proposals/:id/vote` | Yes | Vote on proposal |
| 268 | POST | `/governance/college/:id/seed-board` | Admin | Seed initial board |

---

## 21. HOUSE POINTS (5)
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 269 | GET | `/house-points/config` | Mixed | Points config |
| 270 | GET | `/house-points/ledger` | Mixed | Points ledger |
| 271 | GET | `/house-points/house/:id` | Mixed | House points detail |
| 272 | POST | `/house-points/award` | Admin | Award points |
| 273 | GET | `/house-points/leaderboard` | Mixed | Points leaderboard |

---

## 22. ADMIN & MODERATION (13)
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 274 | POST | `/reports` | Yes | Submit report |
| 275 | GET | `/moderation/queue` | Admin | Moderation queue |
| 276 | POST | `/moderation/:id/action` | Admin | Take moderation action |
| 277 | POST | `/appeals` | Yes | Submit appeal |
| 278 | GET | `/appeals` | Admin | List appeals |
| 279 | PATCH | `/appeals/:id/decide` | Admin | Decide appeal |
| 280 | GET | `/legal/consent` | Yes | Get consent status |
| 281 | POST | `/legal/accept` | Yes | Accept legal terms |
| 282 | POST | `/admin/colleges/seed` | Admin | Seed colleges |
| 283 | GET | `/admin/stats` | Admin | System stats |
| 284 | POST | `/grievances` | Yes | Submit grievance |
| 285 | GET | `/grievances` | Admin | List grievances |
| 286 | GET | `/admin/abuse-dashboard` | Admin | Abuse summary dashboard |
| 287 | GET | `/admin/abuse-log` | Admin | Detailed abuse audit log |

---

## 23. ADMIN MEDIA (4)
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 288 | POST | `/admin/media/cleanup` | Admin | Run media cleanup |
| 289 | GET | `/admin/media/metrics` | Admin | Media system metrics |
| 290 | POST | `/admin/media/batch-seed` | Admin | Batch seed media assets |
| 291 | POST | `/admin/media/backfill-legacy` | Admin | Backfill legacy media |

---

## 24. ADMIN DISTRIBUTION (7)
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 292 | GET | `/admin/distribution/evaluate` | Admin | Evaluate distribution rules |
| 293 | POST | `/admin/distribution/evaluate/:id` | Admin | Evaluate specific post |
| 294 | GET | `/admin/distribution/config` | Admin | Distribution config |
| 295 | POST | `/admin/distribution/kill-switch` | Admin | Kill switch |
| 296 | GET | `/admin/distribution/inspect/:id` | Admin | Inspect post distribution |
| 297 | POST | `/admin/distribution/override` | Admin | Override distribution |
| 298 | DELETE | `/admin/distribution/override/:id` | Admin | Remove override |

---

## 25. COLLEGE CLAIMS (6)
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 299 | POST | `/colleges/:id/claim` | Yes | Claim college membership |
| 300 | GET | `/me/college-claims` | Yes | My claims |
| 301 | DELETE | `/me/college-claims/:id` | Yes | Withdraw claim |
| 302 | GET | `/admin/college-claims` | Admin | All pending claims |
| 303 | GET | `/admin/college-claims/:id` | Admin | Claim detail |
| 304 | PATCH | `/admin/college-claims/:id/decide` | Admin | Approve/reject claim |
| 305 | PATCH | `/admin/college-claims/:id/flag-fraud` | Admin | Flag fraudulent claim |

---

## 26. HEALTH (3)
| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 306 | GET | `/healthz` | No | Quick health check |
| 307 | GET | `/readyz` | No | Readiness check |
| 308 | GET | `/deep-health` | No | Deep health check (DB + deps) |

---

## Pagination Standard
All list endpoints use **cursor-based pagination**:
```
?limit=20&cursor=<last-item-id>
→ { items: [...], pagination: { hasMore: bool, nextCursor: "..." } }
```

## Error Codes
| Code | HTTP | Meaning |
|------|------|---------|
| UNAUTHORIZED | 401 | Missing/invalid token |
| FORBIDDEN | 403 | Insufficient permissions |
| NOT_FOUND | 404 | Resource not found |
| VALIDATION | 400 | Invalid input |
| CONFLICT | 409 | Duplicate action |
| RATE_LIMITED | 429 | Too many requests |
| ABUSE_DETECTED | 429 | Anti-abuse triggered |
| POLL_EXPIRED | 410 | Poll has expired |
| INTERNAL_ERROR | 500 | Server error |

## Rate Limits
| Tier | Limit | Applies To |
|------|-------|-----------|
| AUTH | 10/min | Login, register |
| READ | 120/min | GET endpoints |
| WRITE | 30/min | POST, PATCH, DELETE |
| ADMIN | 60/min | Admin endpoints |

## Anti-Abuse (Phase C)
All engagement endpoints (like, comment, share, save, follow, story reactions, reel interactions) have 5-layer anti-abuse detection:
- Velocity check (per-minute threshold)
- Burst detection (same target)
- Same-author concentration
- Rapid diverse targeting
- Cumulative escalation

Normal users are never affected. Abusive patterns return `429 ABUSE_DETECTED`.
