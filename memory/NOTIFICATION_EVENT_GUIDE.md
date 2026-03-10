# Tribe — Notification Event Guide
Verified backend truth. FH1-U gate.

## All Notification Types

### 1. FOLLOW
- **Trigger**: User follows another user
- **Recipient**: The followed user
- **Actor**: The follower
- **Self-notify**: No (suppressed)
- **targetType**: USER
- **targetId**: Followed user's ID
- **Message**: "{actor.displayName} followed you"
- **Deep link**: Navigate to actor's profile

### 2. LIKE
- **Trigger**: User likes a content item
- **Recipient**: Content author (for user-authored), or page managers OWNER/ADMIN (for page-authored)
- **Actor**: The liker
- **Self-notify**: No
- **targetType**: CONTENT
- **targetId**: Content ID
- **Message**: "{actor.displayName} liked your post"
- **Deep link**: Navigate to post detail

### 3. COMMENT
- **Trigger**: User comments on content
- **Recipient**: Content author
- **Actor**: The commenter
- **Self-notify**: No
- **targetType**: CONTENT
- **targetId**: Content ID
- **Message**: "{actor.displayName} commented on your post"
- **Deep link**: Navigate to comment sheet

### 4. COMMENT_LIKE (B4)
- **Trigger**: User likes a comment
- **Recipient**: Comment author
- **Actor**: The liker
- **Self-notify**: No
- **targetType**: COMMENT
- **targetId**: Comment ID
- **Message**: "{actor.displayName} liked your comment"
- **Deep link**: Navigate to comment sheet of parent post

### 5. SHARE (B4)
- **Trigger**: User reposts/shares content
- **Recipient**: Original content author (for user-authored). For page-authored content, OWNER + ADMIN members of the page.
- **Actor**: The reposter
- **Self-notify**: No
- **targetType**: CONTENT
- **targetId**: Original content ID
- **Message**: "{actor.displayName} shared your post"
- **Deep link**: Navigate to original post detail

### 6. MENTION
- **Trigger**: User mentions another user in content/comment
- **Recipient**: Mentioned user
- **Actor**: The mentioner

### 7. REPORT_RESOLVED
- **Trigger**: Admin resolves a report
- **Recipient**: Report submitter
- **No deep link typically**

### 8. STRIKE_ISSUED
- **Trigger**: Admin issues a strike
- **Recipient**: Struck user

### 9. APPEAL_DECIDED
- **Trigger**: Admin decides an appeal
- **Recipient**: Appellant

### 10. HOUSE_POINTS
- **Trigger**: House points awarded
- **Recipient**: House members

## Notification DB Schema
```json
{
  "id": "uuid",
  "userId": "recipient user ID",
  "type": "FOLLOW|LIKE|COMMENT|COMMENT_LIKE|SHARE|MENTION|...",
  "actorId": "actor user ID",
  "targetType": "USER|CONTENT|COMMENT|PAGE",
  "targetId": "target entity ID",
  "message": "human-readable string",
  "read": false,
  "createdAt": "ISO date"
}
```

## Frontend Rendering Rules
1. Always show actor's avatar + displayName
2. Use `type` to determine icon/color
3. Use `targetType` + `targetId` for deep-link navigation
4. `message` is pre-formatted — safe to render as-is
5. Never expose `actorId` raw — always resolve to display name
6. For page-authored content notifications, the notification still goes to the human user (page manager), not the page entity
