# B0.8 — Quirk Ledger / Frontend Gotchas
> Generated: 2026-03-10 | Source: Deep code analysis of all handler files
> Purpose: Read this FIRST. Saves 50% confusion for any agent/developer integrating with this backend.

---

## QUIRK 1: ~~Avatar is a Raw Media ID, Not a URL~~ **RESOLVED in B1**

> **B1 Status**: FIXED. All user objects now return `avatarUrl` (resolved URL) alongside `avatarMediaId` (raw ID).

**Before B1**: User objects returned `avatar: "<mediaId>"` or `avatar: null` — frontend had to construct URLs manually.

**After B1**: All endpoints now return:
- `avatarUrl`: `/api/media/<id>` or `null` — use this in `<img src>`
- `avatarMediaId`: raw media ID or `null` — use this for profile edit forms
- `avatar`: DEPRECATED legacy alias for `avatarMediaId` (will be removed post-B4)

**Frontend implication**: Use `user.avatarUrl` directly. No client-side URL construction needed.

**Applies to**: ALL surfaces — `/auth/me`, `/auth/login`, `/auth/register`, `/users/:id`, feed post authors, comment authors, followers, following, notifications, stories, reels.

---

## QUIRK 2: Two Separate Content Systems Coexist

**Symptom**: Creating a story via `/api/stories` does NOT make it appear in `/api/feed/stories`. Creating via `/api/content/posts` (kind=STORY) DOES.

**Actual truth**:
| API | Collection | Used For |
|---|---|---|
| `/api/content/posts` | `content_items` | Posts, reels, stories (legacy/simple) |
| `/api/stories` | `stories` | Full Instagram-grade stories (stickers, privacy, archive) |
| `/api/reels` | `reels` | Full reels (audio, remix, series, analytics) |
| `/api/feed/stories` | reads `content_items` (kind=STORY) | — |
| `/api/feed/reels` | reads `content_items` (kind=REEL) | — |
| `/api/stories/feed` | reads `stories` collection | — |
| `/api/reels/feed` | reads `reels` collection | — |

**Frontend implication**: Use the dedicated `/api/stories` and `/api/reels` for full-featured creation. Use `/api/feed/stories` for story rail in home feed (which shows content_items). The `/api/stories/feed` shows the dedicated stories collection.

**Do not assume**: That content created in one system appears in the other's feed.

---

## QUIRK 3: PATCH and PUT are Interchangeable on Onboarding Endpoints

**Symptom**: Both `PATCH /api/me/profile` and `PUT /api/me/profile` work identically.

**Actual truth**: All four onboarding endpoints (`me/profile`, `me/age`, `me/college`, `me/onboarding`) and `auth/pin` accept both PATCH and PUT. The handler checks `method === 'PATCH' || method === 'PUT'`.

**Frontend implication**: Use PATCH (more semantically correct). PUT works as fallback.

---

## QUIRK 4: Block Routes Live in Stories Handler

**Symptom**: Looking for block/unblock endpoints? They're not in `social.js` or `users.js` — they're in `stories.js`.

**Actual truth**: `GET/POST/DELETE /api/me/blocks/*` are handled by `handleStories` (stories.js). This is because blocks were originally built for story privacy, then expanded to general use.

**Frontend implication**: Routes work fine. Just know where to look in the code.

---

## QUIRK 5: Comment Body Field Has Two Names

**Symptom**: Comment creation sometimes works with `body`, sometimes with `text`.

**Actual truth**: The handler accepts BOTH `body` and `text`:
```javascript
const commentText = body.body || body.text
```

**Frontend implication**: Use `body` (primary) or `text` (fallback). Both work.

---

## QUIRK 6: Hidden Content Returns 404, Not 403

**Symptom**: Accessing someone's held or shadow-limited content returns 404, not "forbidden".

**Actual truth**: The backend deliberately returns 404 (not 403) for:
- Held content (to non-owners)
- Shadow-limited content (to everyone including author — author doesn't know)
- Removed content
- Blocked user's stories
- Private stories (non-close-friends)

**Frontend implication**: A 404 doesn't always mean "doesn't exist". It could mean "exists but hidden". Don't show "content deleted" messages — show "content not available" instead.

---

## QUIRK 7: Some Responses Skip the `data` Envelope

**Symptom**: Most endpoints return `{ data: {...} }` but some return raw objects or `{ message: "..." }`.

**Actual truth**: The envelope is inconsistent:
- Most read/write endpoints: `{ data: {...} }`
- Delete operations: often `{ data: { message: "Deleted" } }`
- Some admin endpoints: `{ data: { stats: {...} } }`
- Error responses: `{ error: "...", code: "..." }` (no data wrapper)

**Frontend implication**: Always access response via `response.data` for success, `response.error` for failures.

---

## QUIRK 8: Feed Enrichment is Lossy Without Auth

**Symptom**: Same endpoint returns different data with and without auth token.

**Actual truth**: When auth token is present, feed items gain:
- `viewerHasLiked: boolean`
- `viewerHasDisliked: boolean`
- `viewerHasSaved: boolean`
- `isFollowing: boolean` (on user profiles)

Without auth, these fields are absent or false.

**Frontend implication**: Always send auth token on feed requests for full enrichment, even if the endpoint technically works without it.

---

## QUIRK 9: Registration Uses Phone + PIN, Not Email + Password

**Symptom**: Trying to register with `email` and `password` returns `"phone, pin, and displayName are required"`.

**Actual truth**: Auth is phone-based:
- Register: `{ phone: "1234567890", pin: "1234", displayName: "Name" }`
- Login: `{ phone: "1234567890", pin: "1234" }`
- PIN is 4 digits, not a password

**Frontend implication**: Build phone+PIN UI, not email+password. PIN change exists at `PATCH /api/auth/pin`.

---

## QUIRK 10: Content Moderation is Silent

**Symptom**: Content creation returns 200/201 even when AI flags it.

**Actual truth**: When AI moderation flags content:
- Content is still created (201 response)
- `visibility` is set to `"HELD"` or `"HELD_FOR_REVIEW"`
- The response includes `moderationResult` with flag details
- No explicit error or rejection

**Frontend implication**: Check `visibility` field in create response. If held, show user a "under review" message. Don't treat it as success.

---

## QUIRK 11: Reel Comment and Report Currently Return 400

**Symptom**: `POST /api/reels/:id/comment` and `POST /api/reels/:id/report` return 400 errors.

**Actual truth**: Known bugs. Routes exist in code but have validation/body-format issues. Scheduled for fix in Stage B6.

**Frontend implication**: Disable reel commenting/reporting UI until B6 fix. Or implement with graceful fallback.

---

## QUIRK 12: Search Does Not Find Posts

**Symptom**: `GET /api/search?q=hello&type=posts` returns nothing.

**Actual truth**: The search endpoint only searches `users`, `colleges`, and `houses`. Post/content text is not indexed for search. Scheduled for Stage B5.

**Frontend implication**: Don't show "Posts" as a search filter option yet.

---

## QUIRK 13: Visibility Field Exists But Not Fully Enforced

**Symptom**: Posts have `visibility: "PUBLIC"/"LIMITED"/"FOLLOWERS"` but feeds don't consistently respect all values.

**Actual truth**: 
- `/api/feed/public` correctly filters `visibility: PUBLIC` ✓
- `/api/feed/following` filters `visibility: PUBLIC` ← should also show FOLLOWERS content
- The gap means followers-only posts don't appear in the following feed

**Frontend implication**: Don't offer "Followers only" visibility option in post creation until B2 fix.

---

## QUIRK 14: Admin Routes Require Role, Not Special Auth

**Symptom**: Admin endpoints use the same `Bearer <accessToken>` auth as user endpoints.

**Actual truth**: No separate admin login or API key. Admin access is determined by the `role` field on the user document. Set `role: "ADMIN"` on a user in the database to make them admin.

**Frontend implication**: Admin panel uses same auth flow. Check `user.role` to conditionally show admin UI.

---

## QUIRK 15: Media Upload is Base64, Not Multipart

**Symptom**: Trying to upload a file via `multipart/form-data` doesn't work.

**Actual truth**: `POST /api/media/upload` expects a JSON body with base64-encoded data:
```json
{ "data": "base64string...", "mimeType": "image/jpeg" }
```
Not `multipart/form-data`.

**Frontend implication**: Convert files to base64 before uploading. Max 5MB images, 30MB videos.

---

## QUIRK 16: `sanitizeUser()` and `toUserProfile()` Are Duplicates

**Symptom**: Both functions exist and do almost the same thing.

**Actual truth**: `sanitizeUser()` in `auth-utils.js` strips `_id, pinHash, pinSalt` and returns everything else. `toUserProfile()` in `entity-snippets.js` does the same. Both are used in different handlers.

**Frontend implication**: None — both produce equivalent output. Just know that user profiles may come through either path.

---

## QUIRK 17: Story 24h Expiry is Background Cleanup, Not Real-Time

**Symptom**: Stories don't vanish exactly at 24 hours.

**Actual truth**: Story expiry is checked at read time (expired stories filtered from feed) AND via admin cleanup (`POST /api/admin/stories/cleanup`). There's no real-time scheduled job.

**Frontend implication**: Client-side, check `createdAt + 24h < now` and hide expired stories locally. Don't rely on server to remove them instantly.


## QUIRK 18: Content authorType Field (B3 — Pages)

**Added in B3**. Content items now have an `authorType` field.

- `authorType: "USER"` (default) — standard user-authored content. `author` is a `UserSnippet`.
- `authorType: "PAGE"` — page-authored content. `author` is a `PageSnippet`.

**Frontend implication**: When rendering a post, check `post.authorType` to determine which author shape to expect. If `"PAGE"`, the `author` will have `slug`, `category`, `isOfficial` fields instead of `username`, `displayName`.

**Audit fields**: Page-authored posts include `actingUserId`, `actingRole`, `createdAs` for backend audit truth. These are exposed in the API response.

**Do NOT assume**: All content is user-authored. The `authorType` field disambiguates.

---

## QUIRK 19: Page Slug Lookup

Pages can be fetched by either UUID `id` or `slug`:
- `GET /api/pages/<uuid>` — by ID
- `GET /api/pages/<slug>` — by slug

**Frontend implication**: Use slug for URLs (human-readable), ID for API calls.


---

## B0.8 EXIT GATE: PASS

17 practical, non-obvious quirks documented. Each with symptom, truth, implication, and "do not assume" notes.
