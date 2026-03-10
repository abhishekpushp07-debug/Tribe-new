# Tribe — Frontend Known Gotchas & Edge Cases
**Version**: 2.1 (Post B4 + FH1-U)
**Verified from actual backend code**

---

## GOTCHA 1: Dual Author System (MOST CRITICAL)
**Affects**: Every screen that shows content (feed, post detail, search, page posts)

```javascript
// WRONG — will crash on page posts:
<Text>{post.author.displayName}</Text>

// RIGHT:
<Text>{post.authorType === 'PAGE' ? post.author.name : (post.author.displayName || post.author.username || 'Anonymous')}</Text>
```

- `authorType: "USER"` → author is UserSnippet → has `displayName`, `username`, NO `slug`
- `authorType: "PAGE"` → author is PageSnippet → has `name`, `slug`, NO `username`, NO `displayName`
- Following feed mixes both. Every PostCard MUST branch on `authorType`.

---

## GOTCHA 2: Repost Rendering (B4 NEW)
**Affects**: Feed, post detail

- If `post.isRepost === true`, it's a repost
- `post.author` = the reposter (always a UserSnippet)
- `post.originalContent` = the original post (has its own `author`)
- `post.originalContent` can be `null` if original was deleted → show placeholder
- Repost has its OWN counters (likeCount, commentCount etc. start at 0)
- The ORIGINAL post's `shareCount` is what incremented

```javascript
if (post.isRepost) {
  if (post.originalContent) {
    // Render: "{reposter} reposted" + original content card
  } else {
    // Render: "{reposter} reposted" + "Original content was removed"
  }
}
```

---

## GOTCHA 3: Avatar URL Resolution
- `avatarUrl` = display URL. Use directly: `<img src={avatarUrl} />`
- If `avatarUrl === null` → show default placeholder
- `avatarMediaId` = raw media ID. Use for profile edit forms only
- `avatar` = DEPRECATED alias for `avatarMediaId`. Don't use.
- URL format is typically `/api/media/{id}` (relative path)

---

## GOTCHA 4: Pagination Inconsistency
- Most endpoints: `{ items: [...], pagination: { nextCursor, hasMore } }`
- Some endpoints: `{ posts: [...], pagination: {...} }`
- Comment endpoint: has BOTH `items` AND `comments` (same array)
- Always check for both keys: `data.items || data.posts || data.comments || []`

---

## GOTCHA 5: Age Gate for Content Creation
- Users with `ageStatus !== "ADULT"` CANNOT create posts/stories/reels
- API returns: `{ "error": "Please complete age verification before posting", "code": "AGE_REQUIRED" }`
- Check `user.ageStatus` BEFORE showing create button
- Age verification: `PATCH /me/age` with `{ "birthDate": "2000-01-15" }`

---

## GOTCHA 6: editedAt Field (B4 NEW)
- `editedAt: null` → post was never edited
- `editedAt: "2026-03-10T..."` → post was edited, show "(edited)" label
- Only set after `PATCH /content/:id` succeeds
- Does NOT exist on old posts (treat `undefined` same as `null`)

---

## GOTCHA 7: Comment likeCount Can Be Slightly Off
- In rare edge case: if backend fails between delete and decrement, `likeCount` might be -1 temporarily
- Frontend: `Math.max(0, comment.likeCount)` for display
- Eventually consistent — not a permanent state

---

## GOTCHA 8: Share/Repost Constraints
- One repost per user per original → `409 "Already shared this content"`
- Cannot repost a repost → `400 "Cannot repost a repost"`
- Cannot repost deleted content → `404`
- `shareCount` lives on the ORIGINAL post, not the repost
- Frontend should disable share button after successful share (or show "Shared")

---

## GOTCHA 9: Page Posts in Following Feed
- After following a page, its posts appear in `GET /feed/following`
- These posts have `authorType: "PAGE"` and `pageId` set
- Tapping author should navigate to `/page/${author.slug}`, NOT `/profile/`
- Page posts can be mixed with user posts in the same feed

---

## GOTCHA 10: Reel Media is DIFFERENT
- Reels DON'T use the `MediaObject` pattern
- Reels have INLINE fields: `playbackUrl`, `thumbnailUrl`, `posterFrameUrl`, `mediaStatus`, `durationMs`
- Also use `creatorId` instead of `authorId`
- Do NOT try `/api/media/:id` for reel media
- Use `playbackUrl` directly for video player

---

## GOTCHA 11: Story Expiry
- Stories expire after 24h (field: `expiresAt`)
- Expired story detail returns `410 GONE`
- Frontend: handle 410 by removing from rail, showing "Story expired"
- Don't show stories where `expiresAt < now`

---

## GOTCHA 12: Search Limitations
- `GET /search?type=posts` → NOT functional (deferred to B5)
- Working types: `users`, `colleges`, `houses`, `pages`
- Page search also via: `GET /pages?q=...&category=...`

---

## GOTCHA 13: Rate Limiting
- Backend enforces per-user rate limits
- AUTH tier: 10/min, READ tier: 120/min, WRITE tier: 30/min, STRICT tier: 5/min
- 429 response includes `Retry-After` header
- Frontend: show "Please wait" message, retry after delay
- Heavy actions (create post, edit, share) most likely to hit limits

---

## GOTCHA 14: Soft Deletes
- `DELETE /content/:id` sets `visibility: REMOVED` (soft delete)
- Content disappears from feeds/lists
- Detail route returns `404` for REMOVED content
- The ID still exists in DB — just not accessible
- Comments/likes on deleted posts become orphaned (no cascade delete)

---

## GOTCHA 15: Page viewerRole for UI Gating
- `viewerRole` from `GET /pages/:idOrSlug` controls what UI to show
- `null` → outsider: show Follow button, browse posts
- `"MODERATOR"` → can view member list
- `"EDITOR"` → can publish/edit posts, view member list
- `"ADMIN"` → can manage members, view analytics
- `"OWNER"` → full control (archive, transfer ownership)
- After ownership transfer, `viewerRole` changes — refresh page detail

---

## GOTCHA 16: Moderation on Content Create/Edit
- Post creation and post editing go through moderation re-check
- If moderation rejects: `422` with `"content rejected by moderation"`
- Frontend: do NOT optimistically add post to feed
- Show error message and let user modify content

---

## GOTCHA 17: Block Behavior
- Blocked user's content returns `404` (as if it doesn't exist)
- Block is bidirectional for content visibility
- After blocking: their content disappears from YOUR feed on next load
- After being blocked: YOUR content disappears from THEIR feed
- Blocking doesn't delete existing likes/comments

---

## GOTCHA 18: Notification Self-Suppression
- Backend NEVER creates self-notifications
- Like your own post → no notification
- Like your own comment → no notification
- Share your own post → no notification
- Frontend does NOT need to filter — backend handles this

---

## GOTCHA 19: Transfer Ownership Side Effects
- After `POST /pages/:id/transfer-ownership`:
  - Old owner becomes ADMIN
  - New owner becomes OWNER
  - `viewerRole` changes for both users
- Frontend should refresh page detail + member list after transfer

---

## GOTCHA 20: actingUserId vs authorId (Page Content)
- For page-authored content:
  - `authorId` = page ID (public-facing)
  - `actingUserId` = real human who posted (audit truth)
  - `actingRole` = role at time of posting (OWNER/ADMIN/EDITOR)
- Frontend: use `author` object for display. NEVER render `actingUserId` to end users.
- `actingUserId` is present in API responses but is for internal use only.

---

## GOTCHA 21: Comment parentId for Threading
- `parentId: null` → top-level comment
- `parentId: "comment-uuid"` → reply to that comment
- Frontend: build comment tree from parentId relationships
- API returns flat list — frontend must nest them

---

## GOTCHA 22: Deprecated Fields
| Field | Deprecated | Use Instead |
|-------|-----------|-------------|
| `user.avatar` | Yes | `user.avatarMediaId` |
| `post.duration` | Partially | Only for stories. Reels use `durationMs` |

---

## GOTCHA 23: Content Kinds
- `POST` → regular post
- `REEL` → reel (uses different object shape!)
- `STORY` → story (expires, different handling)
- All three can be created via `POST /content/posts` with different `kind`
- But reels/stories also have dedicated endpoints with richer features

---

## GOTCHA 24: Empty States to Handle
| Screen | Empty State |
|--------|------------|
| Feed (no posts) | "Nothing to see yet. Follow people or pages!" |
| Comments (none) | "Be the first to comment" |
| Page posts (none) | "No posts yet" |
| Notifications (none) | "You're all caught up!" |
| Search (no results) | "No results found" |
| Followers/Following (none) | "No followers/following yet" |
| User saved (none) | "No saved posts" |
| Page members (just owner) | Show only owner |


---

## B6 Updates — Reel Fixes (March 2026)

### Fixed Issues
| # | Issue | Resolution |
|---|-------|-----------|
| 1 | Reel comment only accepted `text` field | Now accepts both `text` and `body` (body takes precedence) |
| 2 | Reel moderation calls silently failed | Fixed moderation call signature to canonical `(db, {object})` |
| 3 | Reel report crashed on empty body | Added safe JSON parsing, returns clear 400 error |
| 4 | Reel report leaked MongoDB `_id` | Fixed to exclude `_id` from response |

### New Notification Types (B6)
| Type | Trigger | targetType | Deep Link |
|------|---------|------------|-----------|
| `REEL_LIKE` | User likes a reel | REEL | Reel detail |
| `REEL_COMMENT` | User comments on a reel | REEL | Reel comment sheet |

### Reel Comment Contract Update
- **Request**: `{ text: "..." }` OR `{ body: "..." }` — both accepted, `body` takes precedence if both present
- **Response**: Comment object now includes both `text` AND `body` fields (same value, backward compat)
