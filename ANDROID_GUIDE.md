# Tribe — Android & Frontend Integration Guide

> Complete technical guide for building the Tribe mobile app (Android/iOS/Flutter/React Native)
> **Backend URL**: `https://dev-hub-39.preview.emergentagent.com`
> **API Prefix**: All endpoints prefixed with `/api`

---

## Table of Contents
1. [Architecture Overview](#1-architecture-overview)
2. [Authentication Implementation](#2-authentication-implementation)
3. [Media Upload Pipeline](#3-media-upload-pipeline)
4. [Feed Implementation](#4-feed-implementation)
5. [Real-Time (SSE) Integration](#5-real-time-sse-integration)
6. [Screen-by-Screen Specifications](#6-screen-by-screen-specifications)
7. [Navigation Architecture](#7-navigation-architecture)
8. [Offline & Caching Strategy](#8-offline--caching-strategy)
9. [Push Notifications](#9-push-notifications)
10. [Performance Guidelines](#10-performance-guidelines)
11. [Error Handling Matrix](#11-error-handling-matrix)
12. [Deep Linking Scheme](#12-deep-linking-scheme)

---

## 1. Architecture Overview

### Backend Contract
```
Base URL: https://dev-hub-39.preview.emergentagent.com/api
Content-Type: application/json
Auth: Bearer token in Authorization header
```

### Token Architecture
```
┌─────────────────────────────────────────┐
│ Access Token (at_...)                    │
│ TTL: 15 minutes                         │
│ Storage: In-memory (ViewModel/State)    │
│ Use: Every API call                      │
├─────────────────────────────────────────┤
│ Refresh Token (rt_...)                   │
│ TTL: 30 days                             │
│ Storage: EncryptedSharedPreferences     │
│ Use: Only for /auth/refresh              │
├─────────────────────────────────────────┤
│ Session ID (uuid)                        │
│ TTL: Bound to refresh token              │
│ Max Concurrent: 10 per user              │
└─────────────────────────────────────────┘
```

### Data Flow Architecture
```
┌──────────┐     ┌──────────┐     ┌──────────┐
│  UI/View │────>│ ViewModel│────>│Repository│
└──────────┘     └──────────┘     └──────────┘
                                       │
                 ┌─────────────────────┤
                 │                     │
           ┌─────────┐          ┌──────────┐
           │ Local DB │          │  Remote  │
           │(Room/SQL)│          │  (API)   │
           └─────────┘          └──────────┘
```

---

## 2. Authentication Implementation

### Registration Flow
```
1. User enters phone (10 digits) + PIN (4 digits) + display name
2. POST /api/auth/register → accessToken, refreshToken, user
3. Store tokens securely
4. Navigate to onboarding flow:
   a. PATCH /api/me/age → set birth year → ageStatus
   b. GET /api/colleges/search → user picks college
   c. PATCH /api/me/college → link college
   d. PATCH /api/me/profile → set username, bio, avatar
   e. PATCH /api/me/onboarding → mark complete
5. Navigate to home feed
```

### Login Flow
```
1. User enters phone + PIN
2. POST /api/auth/login → tokens + user
3. If 429 (rate limited) → show countdown timer from Retry-After header
4. If 401 → show "Invalid phone or PIN"
5. Store tokens → navigate to home
```

### Token Refresh Flow (CRITICAL)
```kotlin
// Pseudocode for token refresh interceptor
class AuthInterceptor {
    fun intercept(chain) {
        val response = chain.proceed(addAuthHeader(request))
        
        if (response.code == 401) {
            val errorCode = parseErrorCode(response)
            
            if (errorCode == "ACCESS_TOKEN_EXPIRED") {
                // Try refresh
                val refreshResult = refreshToken()
                if (refreshResult.success) {
                    // Retry original request with new token
                    return chain.proceed(addAuthHeader(request, refreshResult.accessToken))
                }
            }
            
            if (errorCode == "REFRESH_TOKEN_REUSED") {
                // SECURITY BREACH: Someone stole our refresh token
                // Force logout immediately, clear ALL local data
                forceLogout()
                showSecurityAlert("Your session was compromised. Please log in again.")
                return response
            }
            
            if (errorCode == "REFRESH_TOKEN_INVALID") {
                // Token expired naturally
                forceLogout()
                navigateToLogin()
                return response
            }
        }
        return response
    }
}
```

### Token Refresh Request
```
POST /api/auth/refresh
Body: { "refreshToken": "rt_abc123..." }

Success 200: { accessToken, refreshToken, expiresIn, user }
→ Store BOTH new tokens (old refresh token is now invalidated)

Error: REFRESH_TOKEN_REUSED → FORCE LOGOUT (replay attack detected)
Error: REFRESH_TOKEN_INVALID → Navigate to login
```

### Secure Token Storage (Android)
```kotlin
// Use EncryptedSharedPreferences
val masterKey = MasterKey.Builder(context)
    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
    .build()

val securePrefs = EncryptedSharedPreferences.create(
    context, "tribe_auth",
    masterKey,
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
)

// Store
securePrefs.edit().putString("refresh_token", refreshToken).apply()

// Access token: keep in memory only (ViewModel/singleton)
```

---

## 3. Media Upload Pipeline

### 3-Step Upload Flow
```
Step 1: Initialize upload
  POST /api/media/upload-init
  Body: { filename: "photo.jpg", mimeType: "image/jpeg", fileSize: 2048000 }
  Response: { mediaId, uploadUrl, expiresIn, headers }

Step 2: Upload directly to Supabase (bypasses our server)
  PUT {uploadUrl}
  Headers: { Content-Type: "image/jpeg" }
  Body: raw file bytes
  
Step 3: Confirm upload
  POST /api/media/upload-complete
  Body: { mediaId: "media-uuid" }
  Response: { media: { id, publicUrl, type, status } }
```

### Upload Progress Tracking
```
After Step 3, poll for status:
  GET /api/media/upload-status/{mediaId}
  Response: { mediaId, status: "READY", publicUrl }

Status values: PENDING → UPLOADING → PROCESSING → READY (or FAILED)
```

### Video Upload + Transcoding
```
Same 3-step flow, then:
  POST /api/transcode/{mediaId}   → triggers HLS transcoding
  GET /api/transcode/{jobId}/status → poll until COMPLETED
  GET /api/media/{mediaId}/stream   → HLS playlist URL
  GET /api/media/{mediaId}/thumbnails → generated thumbnails
```

### Size Limits
| Type | Max Size | Format |
|------|----------|--------|
| Image | 5 MB | JPEG, PNG, WebP |
| Video | 30 MB | MP4, MOV |
| Reel | 90 seconds | MP4 |
| Avatar | 5 MB | JPEG, PNG |

### Upload Implementation (Android)
```kotlin
suspend fun uploadMedia(file: File, mimeType: String): MediaResult {
    // Step 1: Get signed URL
    val initResponse = api.initUpload(
        UploadInitRequest(file.name, mimeType, file.length())
    )
    
    // Step 2: Upload to Supabase
    val uploadRequest = Request.Builder()
        .url(initResponse.uploadUrl)
        .put(file.asRequestBody(mimeType.toMediaType()))
        .build()
    httpClient.newCall(uploadRequest).execute()
    
    // Step 3: Confirm
    return api.completeUpload(
        UploadCompleteRequest(initResponse.mediaId)
    )
}
```

---

## 4. Feed Implementation

### Feed Types & Endpoints

| Feed | Endpoint | Auth | Pagination | Ranking |
|------|----------|------|------------|---------|
| Home | `GET /api/feed` | Optional | Cursor | Smart Feed |
| Public | `GET /api/feed/public` | Optional | Cursor | Smart Feed (page 1) |
| Following | `GET /api/feed/following` | Required | Cursor | Smart Feed |
| College | `GET /api/feed/college/{id}` | Optional | Cursor | Chronological |
| Tribe | `GET /api/feed/tribe/{id}` | Optional | Cursor | Chronological |
| Mixed | `GET /api/feed/mixed` | Optional | Limit | Interleaved |
| Personalized | `GET /api/feed/personalized` | Required | Cursor | ML-like |
| Explore | `GET /api/explore` | Optional | Limit | Trending |
| Reels | `GET /api/reels/feed` | Optional | Cursor | Smart Reel |
| Reels Trending | `GET /api/reels/trending` | Optional | Cursor | Viral |
| Stories | `GET /api/feed/stories` | Required | — | Rail format |

### Infinite Scroll Pattern
```kotlin
// Cursor-based pagination
class FeedPaginator(private val api: TribeApi) {
    private var nextCursor: String? = null
    private var hasMore = true
    
    suspend fun loadNextPage(): List<Post> {
        if (!hasMore) return emptyList()
        
        val response = api.getFeed(
            limit = 20,
            cursor = nextCursor
        )
        
        nextCursor = response.pagination.nextCursor
        hasMore = response.pagination.hasMore
        
        return response.items
    }
    
    fun reset() {
        nextCursor = null
        hasMore = true
    }
}
```

### Smart Feed Algorithm (Client Awareness)
The backend ranks posts using these signals:
1. **Recency** — 6-hour half-life exponential decay
2. **Engagement velocity** — likes×1 + comments×3 + saves×5 + shares×2 per hour
3. **Author affinity** — follow +0.5, same tribe +0.3, interaction history 0-1.0
4. **Content type preference** — boosts types you engage with most
5. **Unseen boost** — +30% for unseen posts from followed users
6. **Virality** — +20% for above-average engagement velocity
7. **Diversity** — penalizes same author appearing consecutively

**Client action**: The first page is algorithm-ranked. Subsequent pages are chronological. Use `cursor` pagination.

### Enriched Post Object (what you receive)
```json
{
  "id": "uuid",
  "kind": "POST",
  "authorId": "uuid",
  "author": {
    "id": "uuid",
    "displayName": "Aarav",
    "username": "aarav.21",
    "avatarMediaId": "media-uuid"
  },
  "caption": "Hello! #firstpost",
  "hashtags": ["firstpost"],
  "media": [
    { "id": "media-uuid", "url": "/api/media/media-uuid", "type": "IMAGE", "width": 1080, "height": 1080 }
  ],
  "visibility": "PUBLIC",
  "likeCount": 42,
  "commentCount": 5,
  "saveCount": 3,
  "shareCount": 1,
  "viewCount": 1200,
  "viewerHasLiked": false,
  "viewerHasDisliked": false,
  "viewerHasSaved": false,
  "postSubType": "STANDARD",
  "poll": null,
  "isDraft": false,
  "createdAt": "2025-01-15T10:00:00.000Z"
}
```

### Post Subtypes to Handle in UI
| SubType | UI Treatment |
|---------|-------------|
| `STANDARD` | Normal post card |
| `POLL` | Show poll options with vote UI |
| `THREAD_HEAD` | Show "Thread" indicator, load thread |
| `THREAD_PART` | Part of a thread (show in thread view) |
| `LINK` | Show link preview card |
| `CAROUSEL` | Horizontal swipeable media gallery |

---

## 5. Real-Time (SSE) Integration

### Story Events Stream
```
GET /api/stories/events/stream?token={accessToken}

Content-Type: text/event-stream

Events:
  event: connected
  data: { userId, connectedAt, mode }

  event: story_event  
  data: { type: "story.viewed|story.reacted|story.replied|story.sticker_responded|story.expired", ... }

Heartbeat every 15s:
  : heartbeat 2025-01-15T10:30:00.000Z

Retry hint: retry: 3000 (auto-reconnect after 3s)
```

### Contest Live Feeds
```
GET /api/tribe-contests/live-feed         → Global contest activity
GET /api/tribe-contests/{id}/live         → Single contest scoreboard
GET /api/tribe-contests/seasons/{id}/live-standings → Season standings
```

### Android SSE Implementation
```kotlin
class StoryEventSource(private val token: String) {
    private var eventSource: EventSource? = null
    
    fun connect(onEvent: (StoryEvent) -> Unit) {
        val request = Request.Builder()
            .url("$BASE_URL/api/stories/events/stream?token=$token")
            .build()
        
        eventSource = EventSources.createFactory(httpClient)
            .newEventSource(request, object : EventSourceListener() {
                override fun onEvent(es: EventSource, id: String?, type: String?, data: String) {
                    when (type) {
                        "story_event" -> {
                            val event = gson.fromJson(data, StoryEvent::class.java)
                            onEvent(event)
                        }
                    }
                }
                
                override fun onFailure(es: EventSource, t: Throwable?, response: Response?) {
                    // Auto-reconnect after 3s (server sends retry: 3000)
                    Handler(Looper.getMainLooper()).postDelayed({ connect(onEvent) }, 3000)
                }
            })
    }
    
    fun disconnect() { eventSource?.cancel() }
}
```

---

## 6. Screen-by-Screen Specifications

### 1. Splash / Auth Screen
- Phone number input (10 digits, Indian format)
- PIN input (4 digits, hidden)
- "Register" and "Login" tabs
- Error display for invalid credentials
- Rate limit countdown timer

### 2. Onboarding Flow (4 screens)
```
Screen 1: Age Verification
  - Birth year picker (dropdown or wheel)
  - PATCH /api/me/age
  - If CHILD → restricted experience warning

Screen 2: College Selection
  - Search field → GET /api/colleges/search?q={query}
  - College list with state/type filters
  - GET /api/colleges/states, GET /api/colleges/types
  - PATCH /api/me/college
  - "Skip" option (collegeId: null)

Screen 3: Profile Setup
  - Avatar upload (camera/gallery → media upload pipeline)
  - Username input (live availability check)
  - Bio textarea
  - PATCH /api/me/profile

Screen 4: Interests Selection
  - Grid of interest tags (technology, cricket, photography, etc.)
  - POST /api/me/interests
  - PATCH /api/me/onboarding → complete
```

### 3. Home Feed (Main Screen)
```
Top Bar:
  - "Tribe" logo
  - Notification bell → GET /api/notifications/unread-count (badge)
  - Search icon → Search screen
  - DM icon (future)

Story Rail (horizontal scrollable):
  - "Your Story" (+ icon if no active story)
  - Followed users' stories → GET /api/feed/stories
  - Circle avatar with colored ring (unseen = gradient, seen = grey)
  
Feed Tabs:
  - "For You" (GET /api/feed) → Smart ranked
  - "Following" (GET /api/feed/following) → Following only
  - "College" (GET /api/feed/college/{id}) → College feed
  
Post Cards:
  - Author avatar + name + tribe badge + time
  - Caption with hashtag links and @mentions
  - Media (image/video/carousel)
  - Action bar: Like/Comment/Share/Save
  - Like count, comment count
  - "View all N comments" link
  
Pull-to-refresh: Reset feed cursor, reload
```

### 4. Post Detail Screen
```
GET /api/content/{contentId}

Full post with:
  - Author info
  - Full caption
  - Media viewer
  - Like/comment/save/share actions
  - Comments list (GET /api/content/{id}/comments)
  - Comment input with send button
  - Nested replies (load on tap)
```

### 5. Create Post Screen
```
Modes: Standard | Poll | Thread

Standard Post:
  - Caption input (max 2200 chars)
  - Media picker (gallery/camera, multi-select for carousel)
  - Hashtag suggestions as you type
  - @mention autocomplete
  - "Draft" save option
  - "Schedule" option with date picker
  - AI content declaration toggle
  
Poll Post:
  - Question input
  - 2-4 option inputs
  - Duration picker (hours)
  - "Allow multiple votes" toggle

Thread Post:
  - Multiple post parts (swipe to add)
  - Each part has caption + media
```

### 6. Stories Viewer
```
Full-screen story viewer (Instagram-style):
  - Tap left/right to navigate
  - Progress bar per story
  - Long press to pause
  - Swipe down to close
  - Reply input at bottom
  - Emoji quick reactions (❤️ 🔥 😂 😮 😢 👏)
  - Interactive stickers (polls, questions, quizzes, sliders)
  - Viewer list (swipe up, owner only)
```

### 7. Create Story Screen
```
Camera/gallery picker
  - Text story (colored backgrounds, fonts)
  - Image story (filters, stickers)
  - Video story (15s max visible duration)
  
Sticker tray:
  - Poll sticker
  - Question sticker
  - Quiz sticker
  - Emoji slider
  - Mention (@user)
  - Location
  - Hashtag
  - Link
  - Countdown
  - Music

Privacy selector: Everyone / Close Friends / Custom
```

### 8. Reels Feed (TikTok-style)
```
Full-screen vertical scroll
  - Video auto-plays on visible
  - Swipe up = next reel
  - Right side: Like/Comment/Share/Save buttons
  - Bottom: Creator info + caption + audio info
  - Tap to pause
  
Track events:
  - POST /api/reels/{id}/view → on appear
  - POST /api/reels/{id}/watch → on scroll away (send duration, completion)
```

### 9. Profile Screen
```
GET /api/me (own) or GET /api/users/{id} (other)

Header:
  - Avatar, display name, username
  - Tribe badge (color + animal icon)
  - Stats: Posts / Followers / Following
  - Bio text
  - College name
  - Action buttons: Follow/Unfollow, Message, More (...)
  
Tabs:
  - Grid (posts) → GET /api/users/{id}/posts
  - Reels → GET /api/users/{id}/reels
  - Saved (own only) → GET /api/users/{id}/saved
  - Highlights → GET /api/users/{id}/highlights
```

### 10. Search/Explore Screen
```
Search bar → GET /api/search/autocomplete?q={input}
  - Shows: users, hashtags, pages as you type
  
Full search → GET /api/search?q={query}&type={filter}
  - Tab filters: All, Users, Posts, Reels, Hashtags, Pages, Tribes
  
Explore grid → GET /api/explore
  - Trending posts in grid layout
  - Trending hashtags chips
  - Trending reels carousel
```

### 11. Notifications Screen
```
GET /api/notifications

Sections:
  - Today
  - This Week
  - Earlier

Notification types with UI:
  - FOLLOW → avatar + "started following you" → navigate to profile
  - LIKE → avatar + "liked your post" → navigate to post
  - COMMENT → avatar + "commented: {preview}" → navigate to post
  - MENTION → avatar + "mentioned you" → navigate to content
  - REEL_LIKE → "liked your reel" → navigate to reel
  - STORY_REACTION → "reacted to your story" → navigate to story
  
Mark as read: PATCH /api/notifications/read
Badge: GET /api/notifications/unread-count (poll every 30s or use SSE)
```

### 12. Tribes Screen
```
GET /api/tribes → all 21 tribes
GET /api/me/tribe → user's tribe

My Tribe card:
  - Tribe name, hero, quote, animal icon
  - Primary/secondary colors
  - Members count
  - Rank in leaderboard
  - "Cheer" button → POST /api/tribes/{id}/cheer

Leaderboard → GET /api/tribes/leaderboard
  - Ranked list with engagement scores
  - Period filter: 7d / 30d / 90d / All

Season Standings → GET /api/tribes/standings/current
  - Current season results

Contests → GET /api/tribe-contests
  - Active contests list
  - Entry submission
  - Voting UI
```

### 13. Events Screen
```
GET /api/events/search

Event cards:
  - Cover image, title, date/time
  - Location, category badge
  - RSVP count (Going / Interested)
  - RSVP button → POST /api/events/{id}/rsvp

Filters: category, date range
My Events: GET /api/me/events + GET /api/me/events/rsvps
```

### 14. Pages Screen
```
GET /api/pages → search/list
GET /api/pages/{slug} → detail

Page detail:
  - Cover, avatar, name, category
  - Follower count
  - Follow/Unfollow button
  - Posts feed (GET /api/pages/{id}/posts)
  - Members list
  - About section
```

### 15. Settings Screen
```
GET /api/me/settings

Sections:
  - Profile: Edit name, username, bio, avatar
  - Privacy: Private account, activity status, tagging, mentions
  - Notifications: Per-type toggles
  - Sessions: Active sessions list, logout others
  - Blocks: Blocked users list
  - Interests: Edit interests
  - Legal: Consent, terms
  - Account: Deactivate, change PIN
```

---

## 7. Navigation Architecture

### Bottom Navigation (5 tabs)
```
┌─────┬─────┬─────┬─────┬─────┐
│Home │Search│ (+) │Reels│ Me  │
└─────┴─────┴─────┴─────┴─────┘
```

### Navigation Graph
```
Home ─── Feed
     ├── Story Rail → Story Viewer
     ├── Post Detail → Comments → User Profile
     ├── Notifications
     └── Create Post/Story

Search ── Explore Grid
       ├── Search Results (tabs)
       ├── Hashtag Feed
       └── User/Page Profile

(+) ──── Create Post
      ├── Create Story
      ├── Create Reel
      └── Create Event

Reels ─── Reel Feed (vertical scroll)
       ├── Reel Comments
       └── Creator Profile

Me ────── Own Profile
       ├── Edit Profile
       ├── Settings
       ├── My Tribe
       ├── Analytics Dashboard
       ├── Saved/Bookmarks
       ├── Highlights
       └── My Pages
```

---

## 8. Offline & Caching Strategy

### Cache Layers
| Data | Cache Duration | Strategy |
|------|---------------|----------|
| User profile | 1 min | Stale-while-revalidate |
| Feed posts | 15 sec | Refresh on pull-down |
| Stories | No cache | Always fresh |
| Tribes list | 5 min | Background refresh |
| College list | 10 min | Long-lived |
| Media files | Disk cache | LRU, 100MB limit |
| Notifications | 10 sec | Poll + SSE |

### Optimistic Updates
Perform these actions instantly in UI, then sync:
- Like/unlike (toggle immediately, revert on error)
- Save/unsave
- Follow/unfollow
- Comment post (show immediately, retry on failure)
- Block/unblock

---

## 9. Push Notifications

### Device Registration
```
POST /api/notifications/register-device
Body: { token: "fcm_token", platform: "android" }

Call on:
  - First login
  - Token refresh (FCM onNewToken)
  - App foreground after background
```

### Notification Payloads
```json
{
  "type": "LIKE",
  "title": "Aarav liked your post",
  "body": "\"Hello world! #firstpost\"",
  "data": {
    "targetType": "CONTENT",
    "targetId": "post-uuid",
    "actorId": "user-uuid"
  }
}
```

### Deep Link from Notification
| Type | Navigate To |
|------|------------|
| `FOLLOW` | User profile |
| `LIKE`, `COMMENT`, `SHARE` | Post detail |
| `REEL_LIKE`, `REEL_COMMENT` | Reel viewer |
| `STORY_REACTION`, `STORY_REPLY` | Story viewer |
| `MENTION` | Content where mentioned |

---

## 10. Performance Guidelines

### Image Loading
- Use Coil (Android) or SDWebImage (iOS)
- Load thumbnails for lists, full size on detail
- Media URL format: `/api/media/{mediaId}`
- Supabase CDN handles resizing

### Network Optimization
- Request compression: `Accept-Encoding: gzip`
- Batch API calls where possible (e.g., feed + stories + unread count on home load)
- Use cursor pagination (not offset) for feeds
- Debounce search autocomplete (300ms)
- Cancel in-flight requests on screen change

### Memory Management
- Lazy load images in lists
- Recycle views (RecyclerView/LazyColumn)
- Release video players when off-screen
- Clear image cache on memory warning

---

## 11. Error Handling Matrix

| HTTP Status | Error Code | User Action |
|-------------|-----------|-------------|
| 400 | `VALIDATION_ERROR` | Show field-level error |
| 401 | `ACCESS_TOKEN_EXPIRED` | Auto-refresh, retry |
| 401 | `UNAUTHORIZED` | Show login screen |
| 401 | `REFRESH_TOKEN_REUSED` | Force logout + security alert |
| 403 | `FORBIDDEN` | Show "access denied" toast |
| 403 | `AGE_REQUIRED` | Navigate to age verification |
| 403 | `CHILD_RESTRICTED` | Show restriction message |
| 403 | `BANNED` | Show ban screen, disable app |
| 403 | `SUSPENDED` | Show suspension notice with date |
| 404 | `NOT_FOUND` | Show "content not found" |
| 409 | `CONFLICT` | Show "already exists" |
| 409 | `DUPLICATE` | Silent (e.g., already liked) |
| 410 | `EXPIRED` | Show "story expired" |
| 422 | `CONTENT_REJECTED` | Show moderation rejection |
| 429 | `RATE_LIMITED` | Show timer, disable button |
| 500 | `INTERNAL_ERROR` | Show generic error, offer retry |

### Error Response Format
```json
{
  "error": "Human-readable message (display to user)",
  "code": "MACHINE_CODE (use for logic)"
}
```

---

## 12. Deep Linking Scheme

### URL Scheme
```
tribe://                          → Home
tribe://profile/{userId}          → User profile
tribe://post/{contentId}          → Post detail
tribe://reel/{reelId}             → Reel viewer
tribe://story/{storyId}           → Story viewer
tribe://page/{pageId}             → Page detail
tribe://tribe/{tribeId}           → Tribe detail
tribe://event/{eventId}           → Event detail
tribe://hashtag/{tag}             → Hashtag feed
tribe://search?q={query}          → Search results
tribe://settings                  → Settings
tribe://notifications             → Notifications
tribe://contest/{contestId}       → Contest detail
```

### Web Deep Links
```
https://tribe.app/u/{username}       → Profile
https://tribe.app/p/{postId}         → Post
https://tribe.app/r/{reelId}         → Reel
https://tribe.app/page/{slug}        → Page
https://tribe.app/event/{eventId}    → Event
https://tribe.app/t/{tribeCode}      → Tribe
https://tribe.app/tag/{hashtag}      → Hashtag feed
```

---

## Appendix: API Call Checklist per Screen

### Home Screen (on load)
```
Parallel calls:
  1. GET /api/feed?limit=20                    → Feed posts
  2. GET /api/feed/stories                     → Story rail
  3. GET /api/notifications/unread-count       → Badge
  4. GET /api/me/tribe                         → Tribe info
```

### Profile Screen (on load)
```
Parallel calls:
  1. GET /api/users/{id}                       → Profile data
  2. GET /api/users/{id}/posts?limit=20        → Posts grid
  3. GET /api/users/{id}/highlights            → Highlights
  4. GET /api/users/{id}/tribe                 → Tribe badge
```

### Reel Feed (on load)
```
  1. GET /api/reels/feed?limit=10              → First batch
  2. On each reel visible: POST /api/reels/{id}/view
  3. On scroll away: POST /api/reels/{id}/watch (with duration)
```

### Search (on type)
```
  Debounced 300ms:
  GET /api/search/autocomplete?q={input}&limit=8

  On submit:
  GET /api/search?q={query}&type={filter}&limit=20
```

---

*Complete Android/Frontend integration guide for Tribe v3.0.0*
