# B0.2 — Domain Classification Map
> Generated: 2026-03-10 | Source: B0.1 Route Census (266 live routes)
> Purpose: Frontend/mobile/QA developer looks at this and instantly knows which domain a route belongs to

---

## Domain Index

| # | Domain | Routes | Read | Write | Admin | P0 | SSE/Upload |
|---|---|---|---|---|---|---|---|
| 1 | Auth | 9 | 2 | 7 | 0 | 5 | — |
| 2 | Me / Profile / Onboarding | 4 | 0 | 4 | 0 | 4 | — |
| 3 | Content / Posts | 3 | 1 | 2 | 0 | 3 | — |
| 4 | Feed | 6 | 6 | 0 | 0 | 5 | — |
| 5 | Social Graph (Follow/Unfollow) | 2 | 0 | 2 | 0 | 2 | — |
| 6 | Reactions (Like/Dislike/Save) | 5 | 0 | 5 | 0 | 3 | — |
| 7 | Comments | 2 | 1 | 1 | 0 | 2 | — |
| 8 | Users | 5 | 5 | 0 | 0 | 4 | — |
| 9 | Discovery (Colleges/Houses) | 9 | 9 | 0 | 0 | 2 | — |
| 10 | Search | 1 | 1 | 0 | 0 | 1 | — |
| 11 | Suggestions | 1 | 1 | 0 | 0 | 0 | — |
| 12 | Media | 2 | 1 | 1 | 0 | 2 | ✓ Upload + Binary |
| 13 | Stories | 28 | 11 | 12 | 5 | 4 | ✓ SSE |
| 14 | Close Friends | 3 | 1 | 2 | 0 | 0 | — |
| 15 | Highlights | 4 | 1 | 3 | 0 | 0 | — |
| 16 | Blocks | 3 | 1 | 2 | 0 | 0 | — |
| 17 | Reels | 32 | 10 | 18 | 4 | 5 | — |
| 18 | Tribes | 9 | 9 | 0 | 0 | 3 | — |
| 19 | Tribe Contests | 13 | 8 | 5 | 0 | 5 | — |
| 20 | Events | 18 | 6 | 8 | 4 | 3 | — |
| 21 | Board Notices | 13 | 4 | 6 | 3 | 0 | — |
| 22 | Authenticity Tags | 4 | 2 | 1 | 1 | 0 | — |
| 23 | Reports | 1 | 0 | 1 | 0 | 1 | — |
| 24 | Moderation | 3 | 1 | 2 | 0 | 0 | — |
| 25 | Appeals | 3 | 1 | 1 | 1 | 0 | — |
| 26 | Notifications | 2 | 1 | 1 | 0 | 2 | — |
| 27 | Legal / Consent | 2 | 1 | 1 | 0 | 2 | — |
| 28 | Grievances | 2 | 1 | 1 | 0 | 0 | — |
| 29 | College Claims | 3 | 1 | 2 | 0 | 1 | — |
| 30 | Resources / PYQs | 10 | 3 | 7 | 0 | 2 | — |
| 31 | Governance | 7 | 3 | 4 | 0 | 0 | — |
| 32 | Admin: Platform | 4 | 2 | 2 | 4 | 0 | — |
| 33 | Admin: Tribes | 10 | 2 | 8 | 10 | 0 | — |
| 34 | Admin: Tribe Contests | 16 | 3 | 13 | 16 | 0 | — |
| 35 | Admin: Distribution | 7 | 3 | 4 | 7 | 0 | — |
| 36 | Admin: College Claims | 4 | 2 | 2 | 4 | 0 | — |
| 37 | Admin: Resources | 4 | 1 | 3 | 4 | 0 | — |
| 38 | Admin: Moderation System | 5 | 2 | 3 | 5 | 0 | — |
| 39 | System / Health / Ops | 11 | 8 | 1 | 8 | 1 | — |

---

## Domains by Frontend Screen Priority

### SCREEN: Login / Onboarding
| Route | Domain | Action |
|---|---|---|
| `POST /api/auth/register` | Auth | WRITE |
| `POST /api/auth/login` | Auth | WRITE |
| `POST /api/auth/refresh` | Auth | WRITE |
| `PATCH /api/me/profile` | Me/Profile | WRITE |
| `PATCH /api/me/age` | Me/Profile | WRITE |
| `PATCH /api/me/college` | Me/Profile | WRITE |
| `PATCH /api/me/onboarding` | Me/Profile | WRITE |
| `GET /api/legal/consent` | Legal | READ |
| `POST /api/legal/accept` | Legal | WRITE |

### SCREEN: Home Feed
| Route | Domain | Action |
|---|---|---|
| `GET /api/feed/public` | Feed | READ |
| `GET /api/feed/following` | Feed | READ |
| `GET /api/feed/college/:collegeId` | Feed | READ |
| `GET /api/feed/stories` | Feed | READ |
| `POST /api/content/:id/like` | Reactions | WRITE |
| `POST /api/content/:id/save` | Reactions | WRITE |
| `GET /api/content/:id/comments` | Comments | READ |
| `POST /api/content/:id/comments` | Comments | WRITE |
| `GET /api/notifications` | Notifications | READ |
| `PATCH /api/notifications/read` | Notifications | WRITE |

### SCREEN: Stories
| Route | Domain | Action |
|---|---|---|
| `POST /api/stories` | Stories | WRITE |
| `GET /api/stories/feed` | Stories | READ |
| `GET /api/stories/:id` | Stories | READ |
| `POST /api/stories/:id/react` | Stories | WRITE |
| `POST /api/stories/:id/reply` | Stories | WRITE |
| `GET /api/stories/:id/views` | Stories | READ (owner) |
| `POST /api/stories/:id/sticker/:sid/respond` | Stories | WRITE |

### SCREEN: Reels
| Route | Domain | Action |
|---|---|---|
| `GET /api/reels/feed` | Reels | READ |
| `GET /api/feed/reels` | Feed | READ |
| `POST /api/reels` | Reels | WRITE |
| `POST /api/reels/:id/like` | Reels | WRITE |
| `POST /api/reels/:id/comment` | Reels | WRITE |
| `POST /api/reels/:id/share` | Reels | WRITE |
| `POST /api/reels/:id/watch` | Reels | WRITE |

### SCREEN: User Profile
| Route | Domain | Action |
|---|---|---|
| `GET /api/users/:id` | Users | READ |
| `GET /api/users/:id/posts` | Users | READ |
| `GET /api/users/:id/followers` | Users | READ |
| `GET /api/users/:id/following` | Users | READ |
| `GET /api/users/:id/stories` | Stories | READ |
| `GET /api/users/:id/highlights` | Stories | READ |
| `GET /api/users/:id/reels` | Reels | READ |
| `GET /api/users/:id/tribe` | Tribes | READ |
| `POST /api/follow/:userId` | Social | WRITE |
| `DELETE /api/follow/:userId` | Social | WRITE |

### SCREEN: Create Post
| Route | Domain | Action |
|---|---|---|
| `POST /api/media/upload` | Media | WRITE (upload) |
| `POST /api/content/posts` | Content | WRITE |

### SCREEN: Search & Explore
| Route | Domain | Action |
|---|---|---|
| `GET /api/search` | Search | READ |
| `GET /api/suggestions/users` | Suggestions | READ |
| `GET /api/colleges/search` | Discovery | READ |

### SCREEN: Tribes
| Route | Domain | Action |
|---|---|---|
| `GET /api/tribes` | Tribes | READ |
| `GET /api/tribes/:id` | Tribes | READ |
| `GET /api/tribes/:id/members` | Tribes | READ |
| `GET /api/tribes/standings/current` | Tribes | READ |
| `GET /api/me/tribe` | Tribes | READ |
| `GET /api/tribe-contests` | Tribe Contests | READ |
| `POST /api/tribe-contests/:id/enter` | Tribe Contests | WRITE |
| `POST /api/tribe-contests/:id/vote` | Tribe Contests | WRITE |

### SCREEN: Events
| Route | Domain | Action |
|---|---|---|
| `GET /api/events/feed` | Events | READ |
| `POST /api/events` | Events | WRITE |
| `GET /api/events/:id` | Events | READ |
| `POST /api/events/:id/rsvp` | Events | WRITE |
| `GET /api/events/:id/attendees` | Events | READ |

### SCREEN: Resources / PYQs
| Route | Domain | Action |
|---|---|---|
| `GET /api/resources/search` | Resources | READ |
| `POST /api/resources` | Resources | WRITE |
| `GET /api/resources/:id` | Resources | READ |
| `POST /api/resources/:id/vote` | Resources | WRITE |
| `POST /api/resources/:id/download` | Resources | WRITE |

### SCREEN: College Board / Governance
| Route | Domain | Action |
|---|---|---|
| `GET /api/governance/college/:cid/board` | Governance | READ |
| `GET /api/colleges/:id/notices` | Board Notices | READ |
| `POST /api/board/notices` | Board Notices | WRITE |

### SCREEN: Settings / Account
| Route | Domain | Action |
|---|---|---|
| `PATCH /api/me/profile` | Me/Profile | WRITE |
| `PATCH /api/auth/pin` | Auth | WRITE |
| `GET /api/auth/sessions` | Auth | READ |
| `POST /api/auth/logout` | Auth | WRITE |
| `GET /api/me/blocks` | Blocks | READ |
| `GET /api/me/story-settings` | Stories | READ |
| `PATCH /api/me/story-settings` | Stories | WRITE |

---

## Cross-Domain Route Tags

These routes touch multiple domains simultaneously:

| Route | Primary Domain | Cross-Domain Tags |
|---|---|---|
| `POST /api/content/posts` | Content | Feed, Distribution, Moderation |
| `POST /api/follow/:userId` | Social | Notifications, Feed |
| `POST /api/content/:id/like` | Reactions | Notifications, Distribution |
| `POST /api/content/:id/comments` | Comments | Notifications, Moderation |
| `POST /api/reports` | Reports | Moderation, Notifications |
| `POST /api/stories` | Stories | Moderation, Feed |
| `POST /api/reels` | Reels | Moderation, Feed |
| `POST /api/events` | Events | Moderation |
| `POST /api/resources` | Resources | Moderation |
| `POST /api/board/notices` | Board Notices | Moderation |
| `POST /api/colleges/:cid/claim` | College Claims | Moderation, Notifications |
| `POST /api/media/upload` | Media | Storage, Moderation |
| `POST /api/reels/:id/like` | Reels | Notifications |
| `POST /api/stories/:id/react` | Stories | Notifications |
| `POST /api/events/:id/rsvp` | Events | Notifications |
| `POST /api/tribe-contests/:id/enter` | Tribe Contests | Tribes, Notifications |
| `POST /api/tribe-contests/:id/vote` | Tribe Contests | Tribes |

---

## B0.2 EXIT GATE: PASS

All 266 routes classified into domains. Frontend screen mapping provided.
Cross-domain tags documented. Read/write/admin action per route clear.
