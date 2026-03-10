# Tribe — Serializer Contracts (Frozen)
Verified from actual backend code. FH1-U gate.

## UserSnippet
Embedded in: post.author, comment.author, notification.actor, follower/following cards
```json
{
  "id": "string",
  "displayName": "string|null",
  "username": "string|null",
  "avatarUrl": "string|null (resolved URL: /api/media/{mediaId})",
  "avatarMediaId": "string|null",
  "avatar": "string|null (DEPRECATED, same as avatarMediaId)",
  "role": "USER|MODERATOR|ADMIN|SUPER_ADMIN",
  "collegeId": "string|null",
  "collegeName": "string|null",
  "houseId": "string|null",
  "houseName": "string|null",
  "tribeId": "string|null",
  "tribeCode": "string|null"
}
```

## UserProfile
Returned by: /auth/me, /auth/login, /auth/register, /users/:id
```json
{
  "id": "string",
  "displayName": "string|null",
  "username": "string|null",
  "phone": "string",
  "bio": "string",
  "avatarUrl": "string|null",
  "avatarMediaId": "string|null",
  "avatar": "string|null (DEPRECATED)",
  "role": "string",
  "ageStatus": "NONE|MINOR|ADULT",
  "collegeId": "string|null",
  "collegeName": "string|null",
  "houseId": "string|null",
  "houseName": "string|null",
  "tribeId": "string|null",
  "tribeCode": "string|null",
  "followerCount": "number",
  "followingCount": "number",
  "postCount": "number",
  "onboardingStep": "string|null",
  "createdAt": "ISO string",
  "updatedAt": "ISO string"
}
```
**Note**: pinHash, pinSalt, _id are STRIPPED. Never in response.

## PageSnippet
Embedded in: post.author (when authorType=PAGE), search results, feed items
```json
{
  "id": "string",
  "slug": "string",
  "name": "string",
  "avatarUrl": "string|null",
  "avatarMediaId": "string|null",
  "category": "CLUB|MEME|STUDY_GROUP|DEPARTMENT|EVENT_HUB|NEWS|ALUMNI|CULTURAL|SPORTS|OTHER",
  "isOfficial": "boolean",
  "verificationStatus": "NONE|PENDING|VERIFIED|REJECTED",
  "linkedEntityType": "string|null",
  "linkedEntityId": "string|null",
  "collegeId": "string|null",
  "tribeId": "string|null",
  "status": "ACTIVE|ARCHIVED|SUSPENDED"
}
```
**Key difference from UserSnippet**: PageSnippet has `slug`, `category`, `isOfficial`, `verificationStatus`. Does NOT have `username` or `displayName`.

## PageProfile
Returned by: GET /pages/:idOrSlug
```json
{
  ...PageSnippet,
  "bio": "string",
  "subcategory": "string",
  "coverUrl": "string|null",
  "coverMediaId": "string|null",
  "followerCount": "number",
  "memberCount": "number",
  "postCount": "number",
  "createdAt": "ISO string",
  "updatedAt": "ISO string",
  "viewerIsFollowing": "boolean",
  "viewerRole": "OWNER|ADMIN|EDITOR|MODERATOR|null"
}
```

## PostObject (Enriched)
Returned by: feeds, content detail, page posts
```json
{
  "id": "string",
  "kind": "POST|REEL|STORY",
  "caption": "string",
  "media": [MediaObject],
  "mediaIds": ["string"],
  "authorId": "string",
  "authorType": "USER|PAGE",
  "author": "UserSnippet (if USER) | PageSnippet (if PAGE)",
  "pageId": "string|null (only if authorType=PAGE)",
  "visibility": "PUBLIC|COLLEGE_ONLY|HOUSE_ONLY|PRIVATE",
  "likeCount": "number",
  "commentCount": "number",
  "saveCount": "number",
  "shareCount": "number",
  "viewCount": "number",
  "viewerHasLiked": "boolean",
  "viewerHasDisliked": "boolean",
  "viewerHasSaved": "boolean",
  "editedAt": "ISO string|null (B4: set when caption edited)",
  "createdAt": "ISO string",
  "updatedAt": "ISO string",
  "collegeId": "string|null",
  "houseId": "string|null"
}
```

### RepostObject (B4 extension of PostObject)
When `isRepost === true`:
```json
{
  ...PostObject,
  "isRepost": true,
  "originalContentId": "string",
  "originalContent": {
    "id": "string",
    "caption": "string",
    "authorType": "USER|PAGE",
    "author": "UserSnippet|PageSnippet",
    "media": [...],
    ...other PostObject fields
  } | null (null if original deleted/hidden)
}
```
**Frontend rule**: If `post.isRepost === true`, render as repost wrapper. Show `post.author` as reposter and `post.originalContent.author` as original author.

## CommentObject
```json
{
  "id": "string",
  "contentId": "string (parent post id)",
  "authorId": "string",
  "author": "UserSnippet",
  "text": "string",
  "likeCount": "number",
  "parentId": "string|null (for replies)",
  "createdAt": "ISO string"
}
```

## MediaObject
```json
{
  "id": "string",
  "url": "string (always resolved: /api/media/{id} or CDN URL)",
  "type": "IMAGE|VIDEO|AUDIO|null",
  "thumbnailUrl": "string|null",
  "width": "number|null",
  "height": "number|null",
  "duration": "number|null",
  "mimeType": "string|null",
  "size": "number|null"
}
```
**Rule**: If `media.id` exists, `media.url` is ALWAYS present (never null).

## NotificationObject
```json
{
  "id": "string",
  "userId": "string (recipient)",
  "type": "FOLLOW|LIKE|COMMENT|COMMENT_LIKE|SHARE|MENTION|REPORT_RESOLVED|STRIKE_ISSUED|APPEAL_DECIDED|HOUSE_POINTS",
  "actorId": "string",
  "targetType": "string (USER|CONTENT|COMMENT|PAGE)",
  "targetId": "string",
  "message": "string",
  "read": "boolean",
  "createdAt": "ISO string"
}
```

## CollegeSnippet
```json
{
  "id": "string",
  "officialName": "string|null",
  "shortName": "string|null",
  "city": "string|null",
  "state": "string|null",
  "type": "string|null",
  "membersCount": "number"
}
```

## TribeSnippet
```json
{
  "id": "string",
  "name": "string|null",
  "code": "string|null",
  "awardee": "string|null",
  "color": "string|null",
  "membersCount": "number"
}
```

## ContestSnippet
```json
{
  "id": "string",
  "title": "string|null",
  "type": "string|null",
  "status": "string|null",
  "seasonId": "string|null",
  "startsAt": "ISO string|null",
  "endsAt": "ISO string|null"
}
```

## Author Rendering Rule
**CRITICAL FRONTEND CONTRACT**:
- Check `post.authorType` first
- If `"USER"` → `post.author` is `UserSnippet` → render `author.displayName`, `author.username`, `author.avatarUrl`
- If `"PAGE"` → `post.author` is `PageSnippet` → render `author.name`, `author.slug`, `author.avatarUrl`, `author.category`
- PageSnippet does NOT have `username` or `displayName`
- UserSnippet does NOT have `slug` or `category`

## Avatar URL Rule
- `avatarUrl` is the display field. Use in `<img src>`.
- If `avatarUrl === null`, show default avatar placeholder.
- `avatarMediaId` is the raw ID. Use for profile edit forms (to delete/replace).
