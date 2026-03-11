# Feed Cache Policy
**Last Updated**: 2026-03-11

## Cache Segmentation

### Ranked Feed (/feed)
- **Authenticated users**: NO CACHE — fresh per-request
- **Anonymous users (first page)**: Cached as `anon:limit{N}` key
  - TTL: 5 minutes
  - Only first page (no cursor) for anonymous users
  - Segmented by limit parameter only
- **Result**: Zero cross-user cache leakage risk

### Why This Works
1. User A and User B always get independent database queries
2. Feed ranking includes user-specific signals (following, tribe, college)
3. Block/privacy filters are applied per-request
4. Only generic anonymous feed is cached (no personalization needed)

### Cache Invalidation
- Event-driven invalidation via `invalidateOnEvent()`
- Events: POST_CREATED, POST_UPDATED, POST_DELETED, STORY_CHANGED
- Anonymous cache auto-expires in 5 minutes

### Performance Optimization
- Feed queries use compound indexes on (kind, visibility, distributionStage, createdAt)
- Block checks batched per-feed-load
- Story rail uses batched privacy/mute checks

## Other Cached Data
- Page detail: Per-page ID, 5 min TTL
- College list: Global, 30 min TTL
- House list: Global, 30 min TTL
- Feed ranking scores: Computed per-request, not cached
