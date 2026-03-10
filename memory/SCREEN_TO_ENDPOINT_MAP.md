# Tribe — Screen-to-Endpoint Map
Verified backend truth. FH1-U gate.

## 1. Splash / Auth
- **Check auth**: `GET /auth/me` (200 = logged in, 401 = not)
- **Register**: `POST /auth/register` → { accessToken, user }
- **Login**: `POST /auth/login` → { accessToken, user }
- **Refresh**: `POST /auth/refresh` → { accessToken }
- **Store**: accessToken in secure storage

## 2. Onboarding / Edit Profile
- **Update profile**: `PATCH /me/profile` → { user }
- **Set age**: `PATCH /me/age` → { user }
- **Set college**: `PATCH /me/college` → { user }
- **Complete onboarding**: `PATCH /me/onboarding` → { user }
- **Upload avatar**: `POST /media/upload` → { id, url }, then `PATCH /me/profile` with `{ avatarMediaId: id }`

## 3. Home Feed
- **Public feed**: `GET /feed/public?cursor=...&limit=20` → { items: PostObject[], pagination }
- **Following feed**: `GET /feed/following?cursor=...&limit=20` → { items: PostObject[] }
- **Pagination**: cursor-based. Use `pagination.nextCursor` for next page.
- **Mixed authors**: Items can be `authorType: USER` or `authorType: PAGE`. Render author snippet accordingly.
- **Reposts**: If `item.isRepost === true`, render repost wrapper with `item.originalContent` embedded.

## 4. Post Detail
- **Fetch**: `GET /content/:id` → { post: PostObject }
- **Like**: `POST /content/:id/like` → { reaction }
- **Unlike**: `DELETE /content/:id/reaction` → { removed }
- **Save**: `POST /content/:id/save`
- **Unsave**: `DELETE /content/:id/save`
- **Share/Repost**: `POST /content/:id/share` → { post: RepostObject } (201)
- **Delete own**: `DELETE /content/:id` (200)

## 5. Comment Sheet
- **List**: `GET /content/:postId/comments?cursor=...` → { items: CommentObject[], pagination }
- **Create**: `POST /content/:postId/comments` → { comment }
- **Like comment**: `POST /content/:postId/comments/:commentId/like` → { liked, commentLikeCount }
- **Unlike comment**: `DELETE /content/:postId/comments/:commentId/like` → { liked, commentLikeCount }

## 6. Create Post
- **Upload media**: `POST /media/upload` (multipart) → { id, url }
- **Create**: `POST /content/posts` → { post: PostObject }
- Body: `{ caption, kind: "POST", media: [mediaId1, ...], visibility: "PUBLIC" }`
- **Age requirement**: ageStatus must be ADULT to post.

## 7. Edit Post (B4)
- **Edit**: `PATCH /content/:id` → { post: PostObject }
- Body: `{ caption: "new text" }`
- **Permission**: Owner only (or page role OWNER/ADMIN/EDITOR for page posts)
- **editedAt**: Set on response. Show "edited" indicator if not null.

## 8. Share/Repost Flow (B4)
- **Share**: `POST /content/:id/share` → 201 { post: RepostObject }
- **Duplicate**: Returns 409 (one repost per user per original)
- **Cannot repost repost**: Returns 400
- **Cannot repost deleted**: Returns 404

## 9. Notifications List
- **Fetch**: `GET /notifications?cursor=...` → { notifications: NotificationObject[] }
- **Mark read**: `PATCH /notifications/read` → {}
- **Types**: FOLLOW, LIKE, COMMENT, COMMENT_LIKE, SHARE, MENTION, REPORT_RESOLVED, STRIKE_ISSUED, APPEAL_DECIDED
- **Deep link**: Use `targetType` + `targetId` to navigate (CONTENT → post detail, USER → profile, COMMENT → comment sheet)

## 10. Search Screen
- **Unified**: `GET /search?q=query&type=users|colleges|houses|pages` → { users/colleges/houses/pages: [] }
- **Page search**: `GET /pages?q=query&category=CLUB` → { pages: PageSnippet[] }
- **User suggestions**: `GET /suggestions/users` → { users: [] }
- **NOTE**: `type=posts` is NOT functional (deferred to B5)

## 11. Profile Screen
- **Self**: `GET /auth/me` → { user: UserProfile }
- **Other**: `GET /users/:id` → { user: UserProfile }
- **Posts**: `GET /users/:id/posts?cursor=...` → { posts: PostObject[] }
- **Followers**: `GET /users/:id/followers` → { users }
- **Following**: `GET /users/:id/following` → { users }
- **Saved**: `GET /users/:id/saved` (self only) → { posts }
- **Follow**: `POST /follow/:userId`
- **Unfollow**: `DELETE /follow/:userId`

## 12. Stories Rail / Viewer
- **Feed**: `GET /stories/feed` → rails of active stories
- **Detail**: `GET /stories/:id` → story detail
- **Create**: `POST /stories` with media
- **React**: `POST /stories/:id/react`
- **Reply**: `POST /stories/:id/reply`
- **Archive**: `GET /me/stories/archive`
- **Settings**: `GET/PATCH /me/story-settings`

## 13. Reels Feed / Detail
- **Feed**: `GET /reels/feed?cursor=...` → { reels }
- **Following**: `GET /reels/following`
- **Detail**: `GET /reels/:id`
- **Like**: `POST /reels/:id/like`
- **Comment**: `POST /reels/:id/comment`
- **Share**: `POST /reels/:id/share`

## 14. Page List / Search
- **List**: `GET /pages?q=...&category=...` → { pages: PageSnippet[] }
- **My pages**: `GET /me/pages` → { pages }

## 15. Page Detail
- **Detail**: `GET /pages/:idOrSlug` → { page: PageProfile }
- **Posts**: `GET /pages/:id/posts?cursor=...` → { posts: PostObject[] }
- **Follow**: `POST /pages/:id/follow`
- **Unfollow**: `DELETE /pages/:id/follow`
- **Analytics**: `GET /pages/:id/analytics` (owner/admin only)

## 16. Page Create / Edit
- **Create**: `POST /pages` → { page }
- Body: `{ name, slug, category, bio?, avatarMediaId? }`
- **Edit**: `PATCH /pages/:id` → { page }
- **Archive**: `POST /pages/:id/archive`
- **Restore**: `POST /pages/:id/restore`

## 17. Page Member Management
- **List**: `GET /pages/:id/members` → { members }
- **Add**: `POST /pages/:id/members` → { member }
- **Change role**: `PATCH /pages/:id/members/:userId` → { member }
- **Remove**: `DELETE /pages/:id/members/:userId`
- **Transfer**: `POST /pages/:id/transfer-ownership`
- **Permission**: OWNER/ADMIN only for member management

## 18. Page Posts Flow
- **List**: `GET /pages/:id/posts` → { posts }
- **Publish**: `POST /pages/:id/posts` → { post } (OWNER/ADMIN/EDITOR)
- **Edit**: `PATCH /pages/:id/posts/:postId` → { post }
- **Delete**: `DELETE /pages/:id/posts/:postId`
- **Also editable via**: `PATCH /content/:postId` (checks page role)

## 19. Tribe Detail / Standings
- **List**: `GET /tribes` → { tribes }
- **Detail**: `GET /tribes/:id` → { tribe }
- **Standings**: `GET /tribes/standings/current` → { standings }
- **My tribe**: `GET /me/tribe`

## 20. Contest List / Detail / Leaderboard
- **List**: `GET /tribe-contests` → { contests }
- **Detail**: `GET /tribe-contests/:id` → { contest }
- **Enter**: `POST /tribe-contests/:id/enter`
- **Leaderboard**: `GET /tribe-contests/:id/leaderboard`
- **Vote**: `POST /tribe-contests/:id/vote`

## 21. Events
- **Feed**: `GET /events/feed` → { events }
- **Detail**: `GET /events/:id` → { event }
- **Create**: `POST /events`
- **RSVP**: `POST /events/:id/rsvp`
- **My events**: `GET /me/events`

## 22. Block Management
- **Block**: `POST /me/blocks/:userId`
- **Unblock**: `DELETE /me/blocks/:userId`
- **List**: `GET /me/blocks`
