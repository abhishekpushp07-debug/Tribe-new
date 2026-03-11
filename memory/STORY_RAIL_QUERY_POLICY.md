# Story Rail Query Policy
**Last Updated**: 2026-03-11

## Query Strategy
The story rail uses **batched** queries to avoid N+1 problems.

### Batch Operations (single pass per rail load)
1. **Stories fetch**: Single query with status=ACTIVE, expiresAt > now, sorted by createdAt DESC
2. **Block check**: `getBlockedUserIds(userId)` — single query for all blocked/blocking users
3. **Close friends check**: Single query on `close_friends` collection for viewer's memberships
4. **HideStoryFrom check**: Batch query on `story_settings` for all story author IDs
5. **Story mutes check**: Batch query on `story_mutes` for all story author IDs
6. **View status check**: Batch query on `story_views` for all story IDs

### Filter Pipeline (in order)
1. Remove stories from blocked users (both directions)
2. Remove stories from muted users (story_mutes)
3. Remove stories hidden via hideStoryFrom settings
4. Apply privacy filter:
   - EVERYONE: visible
   - CLOSE_FRIENDS: only if viewer is in author's close friends
   - CUSTOM: based on allowed list
5. Group by author
6. Sort: own stories first, then unseen authors, then by recency

### Performance Characteristics
- **Queries per rail load**: 6 (constant, regardless of story count)
- **No N+1**: All privacy/mute/block checks are batched by author ID set
- **Index support**: All queries use compound indexes
