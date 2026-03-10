# Tribe — Frontend Known Gotchas
Verified backend truth. FH1-U gate.

## 1. Author Type Duality (CRITICAL)
- Every content item has `authorType: "USER" | "PAGE"`
- When `authorType === "USER"`: `author` is UserSnippet (has `username`, `displayName`)
- When `authorType === "PAGE"`: `author` is PageSnippet (has `slug`, `name`, `category`)
- **NEVER assume** author has `username`. Check `authorType` FIRST.
- Feed items can be mixed. Use a single PostCard component that branches on authorType.

## 2. Repost Rendering (B4)
- If `post.isRepost === true`, it's a repost
- `post.originalContent` contains the original post (can be null if original was deleted)
- `post.author` = the reposter
- `post.originalContent.author` = original author
- Frontend must render: "{reposter} reposted" header + original content card
- If `post.originalContent === null`, show "Original content was removed" placeholder

## 3. Avatar URL Resolution
- `avatarUrl` is the display URL. Use directly in `<img src>`.
- If `avatarUrl === null`, show default placeholder.
- Don't use `avatarMediaId` for display — it's a raw ID, not a URL.
- URL format: `/api/media/{mediaId}` — relative path.

## 4. Pagination
- All list endpoints use cursor-based pagination
- Request: `?cursor=...&limit=20`
- Response: `{ items: [...], pagination: { nextCursor: "..."|null, hasMore: boolean } }`
- When `nextCursor` is null or `hasMore` is false, stop loading
- Some endpoints use `posts` key instead of `items` — check response shape

## 5. Age Gate
- Users with `ageStatus !== "ADULT"` cannot create content (posts, stories, reels)
- API returns `{ error: "Please complete age verification before posting" }`
- Frontend should check `user.ageStatus` and show age verification screen before create flows

## 6. Comment Like Count Can Go Negative (Edge Case)
- If backend fails between delete and decrement, `likeCount` might briefly be incorrect
- Frontend should use `Math.max(0, count)` for display
- This is an eventually-consistent edge case, not a bug

## 7. Share Count
- `shareCount` on a post = number of times it was reposted
- Increments on successful repost
- Duplicate repost returns 409 (frontend should show "Already shared")

## 8. EditedAt
- If `post.editedAt` is not null, show "(edited)" indicator
- Only set after PATCH /content/:id succeeds
- New posts have `editedAt: null` (not present or null)

## 9. Page-authored Content in Feeds
- Following feed includes posts from followed pages
- Page posts have `authorType: PAGE`, `pageId` set
- Tapping page author navigates to `/pages/:slug` not `/users/:id`

## 10. Reel Media Exception
- Reels DON'T use the MediaObject pattern
- Reels have inline: `playbackUrl`, `thumbnailUrl`, `posterFrameUrl`, `mediaStatus`, `durationMs`
- Don't try to resolve reel media through /api/media/:id

## 11. Story Expiry
- Stories expire after 24h (`expiresAt` field)
- API returns 410 GONE for expired stories
- Frontend should handle 410 gracefully (remove from rail)

## 12. Search Type Limitation
- `GET /search?type=posts` is NOT functional (deferred to B5)
- Only `type=users`, `type=colleges`, `type=houses`, `type=pages` work
- Page search also available via `GET /pages?q=...`

## 13. Rate Limiting
- Backend has tiered rate limits: AUTH (10/min), READ (120/min), WRITE (30/min), STRICT (5/min)
- 429 responses include `Retry-After` header
- Frontend should respect 429 and show "Too many requests" message

## 14. Deprecated Fields
- `user.avatar` → deprecated, use `user.avatarMediaId` instead
- Both are the same value currently. `avatar` will be removed in a future version.

## 15. Page Slug vs ID
- `GET /pages/:idOrSlug` accepts both page ID and slug
- In links, prefer slug for SEO: `/pages/{slug}`
- In API calls, either works

## 16. No Optimistic UI for Moderated Actions
- Post creation, post edit, and page post publish go through moderation
- If moderation rejects: 422 with `"Edited content rejected by moderation"`
- Frontend must NOT optimistically add these to feed

## 17. Content Delete is Soft
- `DELETE /content/:id` sets `visibility: REMOVED`
- Content disappears from feeds/lists but ID still exists
- Detail route returns 404 for REMOVED content

## 18. Transfer Ownership
- After transfer, old owner becomes ADMIN
- PageProfile.viewerRole updates accordingly
- Frontend should refresh member list after transfer

## 19. Notification Self-suppression
- Backend never creates self-notifications
- If you like your own post, no notification
- Frontend doesn't need to filter — backend handles it

## 20. Block Behavior
- Blocked user's content returns 404 (as if it doesn't exist)
- Block is bidirectional for content visibility
- Frontend: if user blocks someone, their content disappears from feed on next load
