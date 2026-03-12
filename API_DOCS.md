# Tribe — Complete API Reference
### 435 Endpoints | Version 3.0 | 2026-03-12
### Base URL: `/api`

> **Auth**: `Authorization: Bearer <accessToken>` — Login returns `accessToken` at root level.
> **Login**: `POST /api/auth/login` → `{ "phone": "7777099001", "pin": "1234" }` → `{ "accessToken": "at_..." }`

---

## Table of Contents
1. [Auth & Sessions](#1-auth--sessions)
2. [Onboarding & Profile](#2-onboarding--profile)
3. [Users](#3-users)
4. [Content (Posts)](#4-content-posts)
5. [Feed](#5-feed)
6. [Social Interactions](#6-social-interactions)
7. [Stories](#7-stories)
8. [Reels](#8-reels)
9. [Tribes](#9-tribes)
10. [Tribe Contests](#10-tribe-contests)
11. [Pages](#11-pages)
12. [Events](#12-events)
13. [Search](#13-search)
14. [Analytics](#14-analytics)
15. [Notifications](#15-notifications)
16. [Follow Requests](#16-follow-requests)
17. [Activity Status](#17-activity-status)
18. [Recommendations](#18-recommendations)
19. [Suggestions](#19-suggestions)
20. [Content Quality](#20-content-quality)
21. [Video Transcoding](#21-video-transcoding)
22. [Media Upload](#22-media-upload)
23. [Resources](#23-resources)
24. [Board Notices & Authenticity](#24-board-notices--authenticity)
25. [Governance](#25-governance)
26. [House Points](#26-house-points)
27. [Discovery (Colleges/Houses)](#27-discovery)
28. [Admin & Moderation](#28-admin--moderation)
29. [Ops & Infrastructure](#29-ops--infrastructure)

---

## 1. Auth & Sessions
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/auth/register` | No | Register new user: `{ phone, pin, displayName }` |
| `POST` | `/auth/login` | No | Login: `{ phone, pin }` → `{ accessToken, refreshToken, user }` |
| `POST` | `/auth/refresh` | Yes | Rotate refresh token |
| `POST` | `/auth/logout` | Yes | Logout current session |
| `GET` | `/auth/me` | Yes | Get current user profile |
| `GET` | `/auth/sessions` | Yes | List active sessions (IP, device, lastUsed) |
| `DELETE` | `/auth/sessions` | Yes | Revoke all sessions (force logout everywhere) |
| `DELETE` | `/auth/sessions/:id` | Yes | Revoke one session by ID |
| `PATCH` | `/auth/pin` | Yes | Change PIN (re-auth required) |

---

## 2. Onboarding & Profile
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `PATCH` | `/me/profile` | Yes | Update profile (displayName, bio, avatar) |
| `PATCH` | `/me/age` | Yes | Set age |
| `PATCH` | `/me/college` | Yes | Set college |
| `PATCH` | `/me/onboarding` | Yes | Complete onboarding step |

---

## 3. Users
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/users/:id` | Opt | User profile |
| `GET` | `/users/:id/posts` | Opt | User's posts |
| `GET` | `/users/:id/followers` | Yes | Follower list |
| `GET` | `/users/:id/following` | Yes | Following list |
| `GET` | `/users/:id/saved` | Yes | Saved content (own only) |
| `GET` | `/users/:id/mutual-followers` | Yes | Mutual followers with viewer |
| `GET` | `/me` | Yes | Own profile with stats |
| `GET` | `/me/activity` | Yes | Activity summary |
| `GET` | `/me/login-activity` | Yes | Recent login sessions |
| `GET` | `/me/stats` | Yes | Dashboard statistics |
| `GET` | `/me/bookmarks` | Yes | All saved/bookmarked content |
| `GET` | `/me/settings` | Yes | All user settings |
| `PATCH` | `/me/settings` | Yes | Update settings (bulk) |
| `GET` | `/me/privacy` | Yes | Privacy settings |
| `PATCH` | `/me/privacy` | Yes | Toggle private/public account |
| `GET` | `/me/interests` | Yes | Get interests |
| `POST` | `/me/interests` | Yes | Set interests: `{ interests: ["tech", "art"] }` |
| `POST` | `/me/deactivate` | Yes | Deactivate account |

---

## 4. Content (Posts)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/content/posts` | Yes | Create post: `{ caption, media, hashtags, visibility, subType }` |
| `GET` | `/content/:id` | Opt | Get single post |
| `PATCH` | `/content/:id` | Yes | Edit post caption |
| `DELETE` | `/content/:id` | Yes | Delete post |
| `GET` | `/content/drafts` | Yes | List drafts |
| `GET` | `/content/scheduled` | Yes | List scheduled posts |
| `POST` | `/content/:id/publish` | Yes | Publish draft immediately |
| `PATCH` | `/content/:id/schedule` | Yes | Update schedule for draft |
| `POST` | `/content/:id/vote` | Yes | Vote on poll post: `{ optionIndex }` |
| `GET` | `/content/:id/poll-results` | Yes | Get poll results |
| `GET` | `/content/:id/thread` | Yes | Get full thread view |

**Sub-types**: `STANDARD`, `POLL`, `LINK`, `THREAD_HEAD`, `THREAD_PART`

---

## 5. Feed
| Method | Endpoint | Auth | Cache | Description |
|--------|----------|------|-------|-------------|
| `GET` | `/feed` | Yes | ✓ | Home feed (smart ranked, 9 signals) |
| `GET` | `/feed/public` | Opt | 15s | Public feed (engagement ranked) |
| `GET` | `/feed/following` | Yes | — | Following-only feed |
| `GET` | `/feed/college/:collegeId` | Yes | — | College feed |
| `GET` | `/feed/tribe/:tribeId` | Yes | — | Tribe feed |
| `GET` | `/feed/stories` | Yes | — | Story rail |
| `GET` | `/feed/reels` | Yes | — | Reel feed |
| `GET` | `/feed/mixed` | Yes | — | Posts + reels interleaved |
| `GET` | `/feed/personalized` | Yes | — | ML-like scored feed |
| `GET` | `/feed/debug` | Yes | — | Scoring breakdown per post |
| `GET` | `/explore` | Opt | 30s | Trending posts + reels + hashtags |
| `GET` | `/explore/creators` | Yes | — | Popular creators |
| `GET` | `/explore/reels` | Yes | — | Trending reels |
| `GET` | `/trending/topics` | Opt | — | Trending hashtags |

**Query params**: `?limit=20&cursor=<nextCursor>`

**Feed response**:
```json
{ "items": [{ "id", "_feedScore", "_feedRank", "authorId", "caption", "likeCount", "commentCount", "saveCount" }],
  "pagination": { "nextCursor", "hasMore" }, "feedType": "home", "rankingAlgorithm": "engagement_weighted_v1" }
```

**Smart Feed Algorithm (9 signals)**:
- Recency decay (6h half-life)
- Engagement velocity: likes×1 + comments×3 + saves×5 + shares×2
- Author affinity (follow +0.5, same tribe +0.3, interaction history 0–1.0)
- Content type affinity (photo/video/poll/thread preferences)
- Quality signals (media boost, caption length)
- Virality detection (+20% for 2× average velocity)
- Unseen boost (+30% for new posts from followed users)
- Diversity penalty (max 2 per author, max 3 same type in a row)
- Negative signals (muted → 0.01, hidden → 0, reported → ×0.5)

---

## 6. Social Interactions
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/follow/:userId` | Yes | Follow user |
| `DELETE` | `/follow/:userId` | Yes | Unfollow user |
| `POST` | `/content/:id/like` | Yes | Like post (201, 409 if already) |
| `DELETE` | `/content/:id/like` | Yes | Unlike post |
| `POST` | `/content/:id/dislike` | Yes | Dislike (internal, not visible) |
| `DELETE` | `/content/:id/reaction` | Yes | Remove reaction |
| `POST` | `/content/:id/save` | Yes | Save/bookmark |
| `DELETE` | `/content/:id/save` | Yes | Unsave |
| `POST` | `/content/:id/share` | Yes | Share/repost |
| `POST` | `/content/:id/report` | Yes | Report content |
| `POST` | `/content/:id/archive` | Yes | Archive own post |
| `POST` | `/content/:id/unarchive` | Yes | Restore archived post |
| `POST` | `/content/:id/pin` | Yes | Pin to profile |
| `DELETE` | `/content/:id/pin` | Yes | Unpin |
| `POST` | `/content/:id/hide` | Yes | Hide from feed |
| `DELETE` | `/content/:id/hide` | Yes | Unhide |
| `GET` | `/content/:id/likers` | Yes | Who liked a post |
| `GET` | `/content/:id/shares` | Yes | Who shared a post |
| **Comments** | | | |
| `POST` | `/content/:id/comments` | Yes | Create comment: `{ text }` |
| `GET` | `/content/:id/comments` | Yes | List comments |
| `DELETE` | `/content/:id/comments/:cid` | Yes | Delete comment |
| `POST` | `/content/:id/comments/:cid/reply` | Yes | Reply to comment |
| `PATCH` | `/content/:id/comments/:cid` | Yes | Edit comment |
| `POST` | `/content/:id/comments/:cid/pin` | Yes | Pin comment (author only) |
| `POST` | `/content/:id/comments/:cid/report` | Yes | Report comment |
| `POST` | `/content/:postId/comments/:commentId/like` | Yes | Like comment |
| `DELETE` | `/content/:postId/comments/:commentId/like` | Yes | Unlike comment |

---

## 7. Stories
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/stories` | Yes | Create story: `{ mediaId, mediaType, caption, privacy, stickers }` |
| `GET` | `/stories` | Yes | Story rail (ALL users, not just followed) |
| `GET` | `/stories/feed` | Yes | Story feed with seen/unseen |
| `GET` | `/stories/:id` | Yes | View story (auto-tracks view) |
| `DELETE` | `/stories/:id` | Yes | Delete story |
| `PATCH` | `/stories/:id` | Yes | Edit story (caption, privacy) |
| `GET` | `/stories/:id/views` | Yes | Viewers list (owner/admin) |
| `POST` | `/stories/:id/react` | Yes | React: `{ emoji }` |
| `DELETE` | `/stories/:id/react` | Yes | Remove reaction |
| `POST` | `/stories/:id/reply` | Yes | Reply: `{ text }` |
| `GET` | `/stories/:id/replies` | Yes | Replies (owner only) |
| `POST` | `/stories/:id/report` | Yes | Report story |
| `POST` | `/stories/:id/share` | Yes | Share story as post |
| `POST` | `/stories/:id/view` | Yes | Mark viewed |
| `POST` | `/stories/:id/view-duration` | Yes | Track view duration |
| `GET` | `/stories/:id/view-analytics` | Yes | View analytics (owner/admin) |
| `GET` | `/stories/events/stream` | Yes | SSE real-time events |
| **Stickers** | | | |
| `POST` | `/stories/:id/sticker/:stickerId/respond` | Yes | Respond to poll/quiz/slider sticker |
| `GET` | `/stories/:id/sticker/:stickerId/results` | Yes | Sticker results |
| `GET` | `/stories/:id/sticker/:stickerId/responses` | Yes | All responses (owner/admin) |
| **User Stories** | | | |
| `GET` | `/users/:userId/stories` | Yes | User's active stories |
| `GET` | `/me/stories/archive` | Yes | Archived/expired stories |
| `GET` | `/me/stories/insights` | Yes | Story insights |
| **Close Friends** | | | |
| `GET` | `/me/close-friends` | Yes | List close friends |
| `POST` | `/me/close-friends/:userId` | Yes | Add to close friends |
| `DELETE` | `/me/close-friends/:userId` | Yes | Remove from close friends |
| **Highlights** | | | |
| `POST` | `/me/highlights` | Yes | Create highlight |
| `PATCH` | `/me/highlights/:id` | Yes | Edit highlight |
| `DELETE` | `/me/highlights/:id` | Yes | Delete highlight |
| `GET` | `/users/:userId/highlights` | Yes | User's highlights |
| **Settings & Mutes** | | | |
| `GET` | `/me/story-settings` | Yes | Story settings |
| `PATCH` | `/me/story-settings` | Yes | Update settings |
| `POST` | `/me/story-mutes/:userId` | Yes | Mute user's stories |
| `DELETE` | `/me/story-mutes/:userId` | Yes | Unmute |
| `GET` | `/me/story-mutes` | Yes | List muted users |
| **Blocks** | | | |
| `POST` | `/me/blocks/:userId` | Yes | Block user |
| `DELETE` | `/me/blocks/:userId` | Yes | Unblock |
| `GET` | `/me/blocks` | Yes | List blocked |

---

## 8. Reels
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/reels` | Yes | Create reel (draft or publish) |
| `GET` | `/reels/feed` | Yes | Discovery feed (smart ranked, cached 15s) |
| `GET` | `/reels/following` | Yes | Following reels |
| `GET` | `/reels/trending` | Yes | Trending/viral reels |
| `GET` | `/reels/personalized` | Yes | Personalized feed |
| `GET` | `/reels/:id` | Yes | Reel detail |
| `PATCH` | `/reels/:id` | Yes | Edit reel metadata |
| `DELETE` | `/reels/:id` | Yes | Soft delete |
| `POST` | `/reels/:id/publish` | Yes | Publish draft |
| `POST` | `/reels/:id/archive` | Yes | Archive |
| `POST` | `/reels/:id/restore` | Yes | Restore from archive |
| `POST` | `/reels/:id/pin` | Yes | Pin to profile |
| `DELETE` | `/reels/:id/pin` | Yes | Unpin |
| `POST` | `/reels/:id/like` | Yes | Like reel |
| `DELETE` | `/reels/:id/like` | Yes | Unlike |
| `POST` | `/reels/:id/save` | Yes | Save reel |
| `DELETE` | `/reels/:id/save` | Yes | Unsave |
| `POST` | `/reels/:id/comment` | Yes | Comment on reel |
| `GET` | `/reels/:id/comments` | Yes | List comments |
| `GET` | `/reels/:id/likers` | Yes | Who liked |
| `POST` | `/reels/:id/report` | Yes | Report |
| `POST` | `/reels/:id/hide` | Yes | Hide from feed |
| `POST` | `/reels/:id/not-interested` | Yes | Mark not interested |
| `POST` | `/reels/:id/share` | Yes | Track share |
| `POST` | `/reels/:id/watch` | Yes | Track watch `{ duration, completed, replayed }` |
| `POST` | `/reels/:id/view` | Yes | Track impression |
| `POST` | `/reels/:id/duet` | Yes | Create duet reference |
| `GET` | `/reels/:id/remixes` | Yes | Get remixes |
| `GET` | `/reels/audio/:audioId` | Yes | Reels using audio |
| `GET` | `/reels/sounds/popular` | Yes | Popular sounds |
| **Creator** | | | |
| `GET` | `/users/:userId/reels` | Yes | Creator's reels |
| `GET` | `/users/:userId/reels/series` | Yes | Creator's series |
| `POST` | `/me/reels/series` | Yes | Create series |
| `GET` | `/me/reels/archive` | Yes | Archived reels |
| `GET` | `/me/reels/saved` | Yes | Saved reels |
| `GET` | `/me/reels/analytics` | Yes | Creator analytics |
| `GET` | `/me/reels/analytics/detailed` | Yes | Detailed analytics |
| **Processing** | | | |
| `POST` | `/reels/:id/processing` | Yes | Update processing status (internal) |
| `GET` | `/reels/:id/processing` | Yes | Get processing status |

---

## 9. Tribes
| Method | Endpoint | Auth | Cache | Description |
|--------|----------|------|-------|-------------|
| `GET` | `/tribes` | No | 120s | List all 21 tribes |
| `GET` | `/tribes/leaderboard` | No | 60s | Leaderboard `?period=7d|30d|90d|all` |
| `GET` | `/tribes/standings/current` | No | 60s | Season standings |
| `GET` | `/tribes/:id` | No | — | Tribe detail |
| `GET` | `/tribes/:id/members` | Yes | — | Members (pagination: hasMore, limit, offset) |
| `GET` | `/tribes/:id/board` | Yes | — | Tribe board governance |
| `GET` | `/tribes/:id/fund` | Yes | — | Tribe fund info |
| `GET` | `/tribes/:id/salutes` | Yes | — | Salute history (pagination) |
| `GET` | `/tribes/:id/feed` | Yes | — | Tribe content feed |
| `GET` | `/tribes/:id/events` | Yes | — | Tribe events |
| `GET` | `/tribes/:id/stats` | Yes | — | Statistics |
| `GET` | `/me/tribe` | Yes | — | My tribe + membership |
| `GET` | `/users/:id/tribe` | Yes | — | User's tribe |
| `POST` | `/tribes/:id/join` | Yes | — | Join tribe (409 if duplicate) |
| `POST` | `/tribes/:id/leave` | Yes | — | Leave tribe |
| `POST` | `/tribes/:id/cheer` | Yes | — | Cheer (1/day rate limit) |

---

## 10. Tribe Contests
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/tribe-contests` | No | List contests |
| `GET` | `/tribe-contests/:id` | No | Contest detail |
| `GET` | `/tribe-contests/:id/entries` | Yes | Contest entries |
| `GET` | `/tribe-contests/:id/leaderboard` | No | Contest leaderboard |
| `GET` | `/tribe-contests/:id/results` | No | Official results |
| `GET` | `/tribe-contests/:id/live` | No | SSE live scoreboard |
| `GET` | `/tribe-contests/live-feed` | No | SSE global activity |
| `GET` | `/tribe-contests/seasons` | No | List seasons |
| `GET` | `/tribe-contests/seasons/:id/standings` | No | Season standings |
| `GET` | `/tribe-contests/seasons/:id/live-standings` | No | SSE live standings |
| `POST` | `/tribe-contests/:id/enter` | Yes | Submit entry |
| `POST` | `/tribe-contests/:id/vote` | Yes | Vote on entry |
| `POST` | `/tribe-contests/:id/withdraw` | Yes | Withdraw entry |

---

## 11. Pages
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/pages` | Yes | Create page: `{ name, slug, description, category }` |
| `GET` | `/pages` | Opt | Search/list pages |
| `GET` | `/pages/:idOrSlug` | Opt | Page detail |
| `PATCH` | `/pages/:id` | Yes | Update page |
| `DELETE` | `/pages/:id` | Yes | Delete page (owner/admin) |
| `POST` | `/pages/:id/archive` | Yes | Archive page |
| `POST` | `/pages/:id/restore` | Yes | Restore |
| `POST` | `/pages/:id/follow` | Yes | Follow page |
| `DELETE` | `/pages/:id/follow` | Yes | Unfollow |
| `GET` | `/pages/:id/followers` | Yes | Followers (owner/admin) |
| `GET` | `/pages/:id/members` | Yes | Members |
| `POST` | `/pages/:id/members` | Yes | Add member |
| `PATCH` | `/pages/:id/members/:userId` | Yes | Change role |
| `DELETE` | `/pages/:id/members/:userId` | Yes | Remove member |
| `POST` | `/pages/:id/transfer-ownership` | Yes | Transfer ownership |
| `POST` | `/pages/:id/invite` | Yes | Invite user |
| `GET` | `/pages/:id/posts` | Opt | Page posts |
| `POST` | `/pages/:id/posts` | Yes | Create post as page |
| `PATCH` | `/pages/:id/posts/:postId` | Yes | Edit page post |
| `DELETE` | `/pages/:id/posts/:postId` | Yes | Delete page post |
| `POST` | `/pages/:id/report` | Yes | Report page |
| `POST` | `/pages/:id/request-verification` | Yes | Request verification |
| `GET` | `/pages/:id/analytics` | Yes | Page analytics |
| `GET` | `/me/pages` | Yes | My managed pages |

---

## 12. Events
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/events` | Yes | Create event |
| `GET` | `/events/feed` | Yes | Discovery feed (upcoming, ranked) |
| `GET` | `/events/search` | Yes | Search events |
| `GET` | `/events/college/:collegeId` | Yes | College events |
| `GET` | `/events/:id` | Yes | Event detail |
| `PATCH` | `/events/:id` | Yes | Edit event |
| `DELETE` | `/events/:id` | Yes | Soft delete |
| `POST` | `/events/:id/publish` | Yes | Publish draft |
| `POST` | `/events/:id/cancel` | Yes | Cancel event |
| `POST` | `/events/:id/archive` | Yes | Archive past event |
| `POST` | `/events/:id/rsvp` | Yes | RSVP: `{ status: "GOING"|"INTERESTED"|"NOT_GOING" }` |
| `DELETE` | `/events/:id/rsvp` | Yes | Cancel RSVP |
| `GET` | `/events/:id/attendees` | Yes | RSVP list |
| `POST` | `/events/:id/report` | Yes | Report event |
| `POST` | `/events/:id/remind` | Yes | Set reminder |
| `DELETE` | `/events/:id/remind` | Yes | Remove reminder |
| `GET` | `/me/events` | Yes | My created events |
| `GET` | `/me/events/rsvps` | Yes | Events I've RSVP'd to |

---

## 13. Search
| Method | Endpoint | Auth | Cache | Description |
|--------|----------|------|-------|-------------|
| `GET` | `/search?q=<query>&type=<type>` | Opt | 20s | Unified search (types: users, content, posts, reels, hashtags, pages, tribes) |
| `GET` | `/search/autocomplete?q=<prefix>` | No | 15s | Quick suggestions |
| `GET` | `/search/users?q=<query>` | Yes | — | User search |
| `GET` | `/search/hashtags?q=<query>` | Yes | — | Hashtag search (reelCount, totalCount) |
| `GET` | `/search/content?q=<query>` | Yes | — | Content search |
| `GET` | `/search/recent` | Yes | — | Recent searches |
| `DELETE` | `/search/recent` | Yes | — | Clear recent |
| `GET` | `/hashtags/:tag` | Opt | — | Hashtag detail + stats |
| `GET` | `/hashtags/:tag/feed` | Opt | — | Content for hashtag |
| `GET` | `/hashtags/trending` | No | — | Top hashtags |

---

## 14. Analytics
| Method | Endpoint | Auth | Cache | Description |
|--------|----------|------|-------|-------------|
| `POST` | `/analytics/track` | Opt | — | Track event: `{ eventType, targetId }` |
| `GET` | `/analytics/overview?period=7d` | Yes | 60s | Dashboard: account, engagement, reach, audience |
| `GET` | `/analytics/content` | Yes | — | Content performance |
| `GET` | `/analytics/content/:id` | Yes | — | Single content deep analytics |
| `GET` | `/analytics/audience` | Yes | — | Audience demographics |
| `GET` | `/analytics/reach` | Yes | — | Reach & impressions (uniqueVisitors) |
| `GET` | `/analytics/profile-visits` | Yes | — | Profile visit history |
| `GET` | `/analytics/reels` | Yes | — | Reel performance |
| `GET` | `/analytics/stories` | Yes | — | Story performance |

**Event types**: `PROFILE_VISIT`, `CONTENT_VIEW`, `REEL_VIEW`, `STORY_VIEW`

---

## 15. Notifications
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/notifications?limit=20` | Yes | List notifications (grouped view) |
| `GET` | `/notifications/unread-count` | Yes | Unread count (for badge) |
| `PATCH` | `/notifications/read` | Yes | Mark read: `{ ids: [...] }` or all |
| `POST` | `/notifications/read-all` | Yes | Mark all as read |
| `DELETE` | `/notifications/clear` | Yes | Clear all notifications |
| `GET` | `/notifications/preferences` | Yes | Notification preferences |
| `PATCH` | `/notifications/preferences` | Yes | Update preferences |
| `POST` | `/notifications/register-device` | Yes | Register push token |
| `DELETE` | `/notifications/unregister-device` | Yes | Remove device token |

---

## 16. Follow Requests
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/me/follow-requests` | Yes | Incoming pending requests |
| `GET` | `/me/follow-requests/sent` | Yes | Sent requests |
| `GET` | `/me/follow-requests/count` | Yes | Pending count `{ count: 3 }` |
| `POST` | `/follow-requests/:id/accept` | Yes | Accept request |
| `POST` | `/follow-requests/:id/reject` | Yes | Reject request |
| `DELETE` | `/follow-requests/:id` | Yes | Cancel sent request |
| `POST` | `/follow-requests/accept-all` | Yes | Bulk accept all |

Rate limit: 30 follow requests/hour. Block check: blocked users can't send requests.

---

## 17. Activity Status ⭐
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/activity/heartbeat` | Yes | Update last seen → `{ status: "active" }` |
| `GET` | `/activity/status/:userId` | Opt | Status: active / recently_active / away / offline / hidden |
| `GET` | `/activity/friends?limit=20` | Yes | Friends online (sorted: active first) → `{ items, activeNow }` |
| `PUT` | `/activity/settings` | Yes | Toggle visibility: `{ showActivityStatus: bool }` |

**Labels**: "Active now", "Active 5m ago", "Active 2h ago", "Active yesterday", "Active 3d ago", "Offline"
**Frontend**: Call heartbeat every 60 seconds while user is active.

---

## 18. Recommendations ⭐
| Method | Endpoint | Auth | Cache | Description |
|--------|----------|------|-------|-------------|
| `GET` | `/recommendations/posts?limit=20` | Yes | 30s | Suggested posts (collaborative filtering) |
| `GET` | `/recommendations/reels?limit=20` | Yes | 30s | Reels you may like |
| `GET` | `/recommendations/creators?limit=10` | Yes | — | Creators for you |

**Algorithm**: `collaborative_filtering_v1` — finds users who liked the same posts → recommends what they also liked. Falls back to trending content.

---

## 19. Suggestions ⭐
| Method | Endpoint | Auth | Cache | Description |
|--------|----------|------|-------|-------------|
| `GET` | `/suggestions/people?limit=15` | Yes | 60s | People you may know |
| `GET` | `/suggestions/trending?limit=10` | Yes | — | Trending (college/global) |
| `GET` | `/suggestions/tribes?limit=5` | Yes | — | Tribes for you |

**People algorithm** (`social_graph_v1`): mutual follows ×3 + same tribe ×2 + same college ×1.
Response includes `reasons`, `mutualFollows`, `sameTribe`, `sameCollege` per person.

---

## 20. Content Quality ⭐
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/quality/score` | Yes | Score single: `{ contentId, contentType }` → `{ score, grade, breakdown }` |
| `POST` | `/quality/batch` | Yes | Batch score unscored: `{ limit }` → `{ posts, reels, total }` |
| `GET` | `/quality/dashboard` | Yes | Overview: grades, shadow-banned count, top/worst |
| `GET` | `/quality/check/:contentId` | Yes | Check existing score |

**Scoring (0–100)**: caption(20) + media(15) + hashtags(15) + author(20) + engagement(15) + freshness(10) - reports(5)
**Grades**: A(90+) B(70+) C(50+) D(25+) F(0-24) | Shadow ban: <25 | Low quality: <50

---

## 21. Video Transcoding
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/transcode/:mediaId` | Yes | Trigger transcoding |
| `GET` | `/transcode/:jobId/status` | Yes | Job status |
| `GET` | `/transcode/media/:mediaId` | Yes | Transcode info for media |
| `GET` | `/transcode/queue?status=COMPLETED` | Yes | Queue (filter: PENDING/PROCESSING/COMPLETED/FAILED/CANCELLED) |
| `POST` | `/transcode/:jobId/cancel` | Yes | Cancel job |
| `POST` | `/transcode/:jobId/retry` | Yes | Retry failed (max 3) |
| `GET` | `/media/:id/stream` | No | HLS master playlist |
| `GET` | `/media/:id/thumbnails` | No | Video thumbnails |

---

## 22. Media Upload
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/media/upload-init` | Yes | Get signed URL for Supabase upload |
| `POST` | `/media/upload-complete` | Yes | Finalize after upload |
| `POST` | `/media/upload` | Yes | Legacy base64 upload |
| `GET` | `/media/upload-status/:mediaId` | Yes | Check upload status |
| `GET` | `/media/:id` | No | Serve media (CDN redirect) |
| `DELETE` | `/media/:id` | Yes | Delete owned media |

---

## 23. Resources
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/resources` | Yes | Create resource |
| `GET` | `/resources/search` | Yes | Faceted search (cached) |
| `GET` | `/resources/:id` | Yes | Detail (cached) |
| `PATCH` | `/resources/:id` | Yes | Update (owner) |
| `DELETE` | `/resources/:id` | Yes | Remove (owner/mod) |
| `POST` | `/resources/:id/report` | Yes | Report |
| `POST` | `/resources/:id/vote` | Yes | Upvote/downvote |
| `DELETE` | `/resources/:id/vote` | Yes | Remove vote |
| `POST` | `/resources/:id/download` | Yes | Track download |
| `GET` | `/me/resources` | Yes | My uploads |

---

## 24. Board Notices & Authenticity
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/board/notices` | Yes | Create notice (board member) |
| `GET` | `/board/notices/:id` | Yes | Notice detail |
| `PATCH` | `/board/notices/:id` | Yes | Edit notice |
| `DELETE` | `/board/notices/:id` | Yes | Delete |
| `POST` | `/board/notices/:id/pin` | Yes | Pin notice |
| `DELETE` | `/board/notices/:id/pin` | Yes | Unpin |
| `POST` | `/board/notices/:id/acknowledge` | Yes | Acknowledge |
| `GET` | `/board/notices/:id/acknowledgments` | Yes | Acknowledgment list |
| `GET` | `/colleges/:id/notices` | No | Public college notices |
| `GET` | `/me/board/notices` | Yes | My created notices |
| `POST` | `/authenticity/tag` | Yes | Create/update tag |
| `GET` | `/authenticity/tags/:targetType/:targetId` | Yes | Get tags |
| `DELETE` | `/authenticity/tags/:id` | Yes | Remove tag |

---

## 25. Governance
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/governance/college/:collegeId/board` | Yes | Current board |
| `POST` | `/governance/college/:collegeId/apply` | Yes | Apply for seat |
| `GET` | `/governance/college/:collegeId/applications` | Yes | Pending applications |
| `POST` | `/governance/applications/:appId/vote` | Yes | Vote on application |
| `POST` | `/governance/college/:collegeId/proposals` | Yes | Create proposal |
| `GET` | `/governance/college/:collegeId/proposals` | Yes | List proposals |
| `POST` | `/governance/proposals/:proposalId/vote` | Yes | Vote on proposal |

---

## 26. House Points
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/house-points/config` | Yes | Point config |
| `GET` | `/house-points/ledger` | Yes | Own point history |
| `GET` | `/house-points/house/:houseId` | Yes | House history |
| `GET` | `/house-points/leaderboard` | Yes | Extended leaderboard |
| `POST` | `/house-points/award` | Admin | Award points |

---

## 27. Discovery
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/colleges/search` | No | Search colleges |
| `GET` | `/colleges/states` | No | List states |
| `GET` | `/colleges/types` | No | List types |
| `GET` | `/colleges/:id` | No | College detail |
| `GET` | `/colleges/:id/members` | Yes | College members |
| `POST` | `/colleges/:collegeId/claim` | Yes | Claim college |
| `GET` | `/me/college-claims` | Yes | My claims |
| `DELETE` | `/me/college-claims/:id` | Yes | Withdraw claim |
| `GET` | `/houses` | No | List houses |
| `GET` | `/houses/:idOrSlug` | No | House detail |
| `GET` | `/houses/:idOrSlug/members` | Yes | House members |
| `GET` | `/houses/leaderboard` | No | House leaderboard |

---

## 28. Admin & Moderation
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/reports` | Yes | Report content/user |
| `GET` | `/moderation/queue` | Admin | Moderation queue |
| `POST` | `/moderation/:contentId/action` | Admin | Moderate content |
| `POST` | `/appeals` | Yes | Appeal decision |
| `GET` | `/appeals` | Yes | My appeals |
| `PATCH` | `/appeals/:id/decide` | Admin | Decide appeal |
| `POST` | `/grievances` | Yes | File grievance |
| `GET` | `/grievances` | Yes | My grievances |
| `GET` | `/legal/consent` | No | Consent notice |
| `POST` | `/legal/accept` | Yes | Accept consent |
| `GET` | `/admin/stats` | Admin | Platform statistics |
| `GET` | `/admin/abuse-dashboard` | Admin | Abuse overview |
| `GET` | `/admin/abuse-log` | Admin | Audit log |
| **Admin: Distribution** | | | |
| `POST` | `/admin/distribution/evaluate` | Admin | Batch evaluate content |
| `POST` | `/admin/distribution/evaluate/:contentId` | Admin | Single evaluate |
| `GET` | `/admin/distribution/config` | Admin | Distribution rules |
| `POST` | `/admin/distribution/kill-switch` | Admin | Toggle auto-eval |
| `GET` | `/admin/distribution/inspect/:contentId` | Admin | Inspect detail |
| `POST` | `/admin/distribution/override` | Admin | Manual override |
| `DELETE` | `/admin/distribution/override/:contentId` | Admin | Remove override |
| **Admin: College Claims** | | | |
| `GET` | `/admin/college-claims` | Admin | Review queue |
| `GET` | `/admin/college-claims/:id` | Admin | Claim detail |
| `PATCH` | `/admin/college-claims/:id/decide` | Admin | Approve/reject |
| `PATCH` | `/admin/college-claims/:id/flag-fraud` | Admin | Flag fraud |
| **Admin: Tribes** | | | |
| `GET` | `/admin/tribes/distribution` | Admin | Distribution stats |
| `POST` | `/admin/tribes/reassign` | Admin | Reassign user |
| `POST` | `/admin/tribes/migrate` | Admin | Mass migrate |
| `POST` | `/admin/tribes/boards` | Admin | Create/update board |
| `POST` | `/admin/tribe-seasons` | Admin | Manage seasons |
| `GET` | `/admin/tribe-seasons` | Admin | List seasons |
| `POST` | `/admin/tribe-salutes/adjust` | Admin | Manual salute adjustment |
| `POST` | `/admin/tribe-awards/resolve` | Admin | Resolve annual award |
| **Admin: Resources** | | | |
| `GET` | `/admin/resources` | Admin | Review queue |
| `PATCH` | `/admin/resources/:id/moderate` | Admin | Moderate |
| `POST` | `/admin/resources/:id/recompute-counters` | Admin | Recompute |
| `POST` | `/admin/resources/reconcile` | Admin | Bulk reconciliation |
| **Admin: Stories** | | | |
| `GET` | `/admin/stories` | Admin | Moderation queue |
| `GET` | `/admin/stories/analytics` | Admin | Analytics |
| `PATCH` | `/admin/stories/:id/moderate` | Admin | Moderate story |
| `POST` | `/admin/stories/:id/recompute-counters` | Admin | Recompute |
| `POST` | `/admin/stories/bulk-moderate` | Admin | Batch moderate |
| `POST` | `/admin/stories/cleanup` | Admin | Trigger expiry cleanup |
| **Admin: Reels** | | | |
| `GET` | `/admin/reels` | Admin | Moderation queue |
| `GET` | `/admin/reels/analytics` | Admin | Platform analytics |
| `PATCH` | `/admin/reels/:id/moderate` | Admin | Moderate reel |
| `POST` | `/admin/reels/:id/recompute-counters` | Admin | Recompute |
| **Admin: Pages** | | | |
| `GET` | `/admin/pages/verification-requests` | Admin | Verification queue |
| `POST` | `/admin/pages/verification-decide` | Admin | Decide verification |
| **Admin: Events** | | | |
| `GET` | `/admin/events` | Admin | Moderation queue |
| `GET` | `/admin/events/analytics` | Admin | Platform analytics |
| `PATCH` | `/admin/events/:id/moderate` | Admin | Moderate event |
| `POST` | `/admin/events/:id/recompute-counters` | Admin | Recompute |
| **Admin: Board Notices** | | | |
| `GET` | `/moderation/board-notices` | Mod | Review queue |
| `POST` | `/moderation/board-notices/:id/decide` | Mod | Approve/reject |
| `GET` | `/admin/board-notices/analytics` | Admin | Analytics |
| `GET` | `/admin/authenticity/stats` | Admin | Tag statistics |
| **Admin: Media** | | | |
| `POST` | `/admin/media/cleanup` | Admin | Trigger orphan cleanup |
| `GET` | `/admin/media/metrics` | Admin | Media lifecycle metrics |
| `POST` | `/admin/media/batch-seed` | Admin | Batch seed records |
| `POST` | `/admin/media/backfill-legacy` | Admin | Backfill legacy |
| **Admin: Contests** | | | |
| `POST` | `/admin/tribe-contests` | Admin | Create contest |
| `GET` | `/admin/tribe-contests` | Admin | List all |
| `GET` | `/admin/tribe-contests/:id` | Admin | Detail |
| `GET` | `/admin/tribe-contests/dashboard` | Admin | Dashboard stats |
| `POST` | `/admin/tribe-contests/:id/publish` | Admin | DRAFT→PUBLISHED |
| `POST` | `/admin/tribe-contests/:id/open-entries` | Admin | →ENTRY_OPEN |
| `POST` | `/admin/tribe-contests/:id/close-entries` | Admin | →ENTRY_CLOSED |
| `POST` | `/admin/tribe-contests/:id/lock` | Admin | →LOCKED |
| `POST` | `/admin/tribe-contests/:id/resolve` | Admin | →RESOLVED |
| `POST` | `/admin/tribe-contests/:id/cancel` | Admin | Cancel |
| `POST` | `/admin/tribe-contests/:id/disqualify` | Admin | Disqualify entry |
| `POST` | `/admin/tribe-contests/:id/judge-score` | Admin | Submit judge score |
| `POST` | `/admin/tribe-contests/:id/compute-scores` | Admin | Compute scores |
| `POST` | `/admin/tribe-contests/:id/recompute-broadcast` | Admin | Compute + broadcast |
| `POST` | `/admin/tribe-contests/rules` | Admin | Add versioned rule |

---

## 29. Ops & Infrastructure
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/healthz` | No | Health check: `{ status: "ok", uptime }` |
| `GET` | `/readyz` | No | Readiness check |
| `GET` | `/ops/health` | Yes | Detailed health |
| `GET` | `/ops/metrics` | Yes | System metrics |
| `GET` | `/ops/slis` | Yes | SLI indicators |
| `GET` | `/ops/backup-check` | Yes | Backup status |
| `GET` | `/cache/stats` | Yes | Redis cache stats |
| `GET` | `/moderation/config` | Yes | Moderation config |
| `POST` | `/moderation/check` | Yes | Run moderation check |

---

## Error Format
```json
{ "error": "Description", "code": "ERROR_CODE" }
```
| Code | Status | Meaning |
|------|--------|---------|
| `UNAUTHORIZED` | 401 | Missing/invalid token |
| `VALIDATION_ERROR` | 400 | Invalid input |
| `NOT_FOUND` | 404 | Resource not found |
| `FORBIDDEN` | 403 | No permission |
| `RATE_LIMITED` | 429 | Too many requests |
| `DUPLICATE` | 409 | Already exists |
| `BLOCKED` | 403 | Blocked user |

---

## Test Credentials
| Phone | PIN | Role |
|-------|-----|------|
| `7777099001` | `1234` | Admin |
| `7777099002` | `1234` | User |

---

## Frontend Integration Checklist
1. Call `POST /activity/heartbeat` every 60s while active
2. Use `_feedScore` / `_feedRank` from feed items
3. Show quality grade badges (A/B/C) on posts
4. Build "For You" tab → `/recommendations/posts`
5. Build "People You May Know" → `/suggestions/people`
6. Show "Active now" dots → `/activity/friends`
7. Show trending sidebar → `/suggestions/trending`
8. Track views → `POST /analytics/track`
9. Handle pagination with `?limit=N&cursor=<nextCursor>`
10. Check `hasMore` in pagination before showing "Load More"
