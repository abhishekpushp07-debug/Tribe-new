import { ContentKind, Visibility } from '../constants.js'
import { authenticate, requireAuth, enrichPosts, parsePagination, sanitizeUser } from '../auth-utils.js'
import { cache, CacheNS, CacheTTL } from '../cache.js'
import { applyFeedPolicy, getBlockedUserIds } from '../access-policy.js'

export async function handleFeed(path, method, request, db) {
  const route = path.join('/')

  // ========================
  // GET /feed/public
  // ========================
  if (route === 'feed/public' && method === 'GET') {
    const url = new URL(request.url)
    const { limit, cursor } = parsePagination(url)

    // Cache first page (no cursor) only
    const cacheKey = cursor ? null : `page1:limit${limit}`
    if (cacheKey) {
      const cached = await cache.get(CacheNS.PUBLIC_FEED, cacheKey)
      if (cached) return { data: cached }
    }

    const query = { visibility: Visibility.PUBLIC, kind: ContentKind.POST, distributionStage: 2 }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }

    const posts = await db.collection('content_items')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = posts.length > limit
    const items = posts.slice(0, limit)
    const currentUser = await authenticate(request, db)
    // B2: Block filter for public feed
    const safeItems = await applyFeedPolicy(db, currentUser?.id, currentUser?.role, items)
    const enriched = await enrichPosts(db, safeItems, currentUser?.id)

    const result = {
      items: enriched,
      pagination: {
        nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
        hasMore,
      },
      nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
      feedType: 'public',
      distributionFilter: 'STAGE_2_ONLY',
    }

    if (cacheKey) await cache.set(CacheNS.PUBLIC_FEED, cacheKey, result, CacheTTL.PUBLIC_FEED)
    return { data: result }
  }

  // ========================
  // GET /feed/following
  // ========================
  if (route === 'feed/following' && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const { limit, cursor } = parsePagination(url)

    const follows = await db.collection('follows').find({ followerId: user.id }).toArray()
    const followeeIds = follows.map(f => f.followeeId)
    followeeIds.push(user.id) // Include own posts

    const query = {
      authorId: { $in: followeeIds },
      visibility: Visibility.PUBLIC,
      kind: ContentKind.POST,
    }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }

    const posts = await db.collection('content_items')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = posts.length > limit
    const items = posts.slice(0, limit)
    // B2: Block filter for following feed
    const safeItems = await applyFeedPolicy(db, user.id, user.role, items)
    const enriched = await enrichPosts(db, safeItems, user.id)

    return {
      data: {
        items: enriched,
        pagination: {
          nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
          hasMore,
        },
        nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
        feedType: 'following',
      },
    }
  }

  // ========================
  // GET /feed/college/:collegeId
  // ========================
  if (path[0] === 'feed' && path[1] === 'college' && path.length === 3 && method === 'GET') {
    const collegeId = path[2]
    const url = new URL(request.url)
    const { limit, cursor } = parsePagination(url)

    const cacheKey = cursor ? null : `${collegeId}:limit${limit}`
    if (cacheKey) {
      const cached = await cache.get(CacheNS.COLLEGE_FEED, cacheKey)
      if (cached) return { data: cached }
    }

    const query = {
      collegeId,
      visibility: Visibility.PUBLIC,
      kind: ContentKind.POST,
      distributionStage: { $gte: 1 },
    }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }

    const posts = await db.collection('content_items')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = posts.length > limit
    const items = posts.slice(0, limit)
    const currentUser = await authenticate(request, db)
    // B2: Block filter for college feed
    const safeItems = await applyFeedPolicy(db, currentUser?.id, currentUser?.role, items)
    const enriched = await enrichPosts(db, safeItems, currentUser?.id)

    const result = {
      items: enriched,
      pagination: {
        nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
        hasMore,
      },
      nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
      feedType: 'college',
    }

    if (cacheKey) await cache.set(CacheNS.COLLEGE_FEED, cacheKey, result, CacheTTL.COLLEGE_FEED)
    return { data: result }
  }

  // ========================
  // GET /feed/house/:houseId
  // ========================
  if (path[0] === 'feed' && path[1] === 'house' && path.length === 3 && method === 'GET') {
    const houseId = path[2]
    const url = new URL(request.url)
    const { limit, cursor } = parsePagination(url)

    const cacheKey = cursor ? null : `${houseId}:limit${limit}`
    if (cacheKey) {
      const cached = await cache.get(CacheNS.HOUSE_FEED, cacheKey)
      if (cached) return { data: cached }
    }

    const query = {
      houseId,
      visibility: Visibility.PUBLIC,
      kind: ContentKind.POST,
      distributionStage: { $gte: 1 },
    }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }

    const posts = await db.collection('content_items')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = posts.length > limit
    const items = posts.slice(0, limit)
    const currentUser = await authenticate(request, db)
    // B2: Block filter for house feed
    const safeItems = await applyFeedPolicy(db, currentUser?.id, currentUser?.role, items)
    const enriched = await enrichPosts(db, safeItems, currentUser?.id)

    const result = {
      items: enriched,
      pagination: {
        nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
        hasMore,
      },
      nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
      feedType: 'house',
    }

    if (cacheKey) await cache.set(CacheNS.HOUSE_FEED, cacheKey, result, CacheTTL.HOUSE_FEED)
    return { data: result }
  }

  // ========================
  // GET /feed/stories — Story rail grouped by author
  // ========================
  if (route === 'feed/stories' && method === 'GET') {
    const user = await requireAuth(request, db)

    // Get stories from followed users + own stories (not expired)
    const follows = await db.collection('follows').find({ followerId: user.id }).toArray()
    const userIds = [user.id, ...follows.map(f => f.followeeId)]

    // B2: Filter out blocked users from story rail
    const blockedIds = await getBlockedUserIds(db, user.id, userIds)
    const safeUserIds = userIds.filter(id => !blockedIds.has(id))

    const stories = await db.collection('content_items')
      .find({
        authorId: { $in: safeUserIds },
        kind: ContentKind.STORY,
        visibility: Visibility.PUBLIC,
        expiresAt: { $gt: new Date() },
      })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray()

    // Group by author
    const grouped = {}
    for (const story of stories) {
      if (!grouped[story.authorId]) grouped[story.authorId] = []
      grouped[story.authorId].push(story)
    }

    // Enrich authors
    const authorIds = Object.keys(grouped)
    const authors = await db.collection('users').find({ id: { $in: authorIds } }).toArray()
    const authorMap = Object.fromEntries(authors.map(a => [a.id, sanitizeUser(a)]))

    const storyRail = authorIds.map(authorId => ({
      author: authorMap[authorId] || null,
      stories: grouped[authorId].map(s => {
        const { _id, dislikeCountInternal, ...clean } = s
        return clean
      }),
      latestAt: grouped[authorId][0].createdAt.toISOString(),
    }))

    // Sort: own stories first, then by latest
    storyRail.sort((a, b) => {
      if (a.author?.id === user.id) return -1
      if (b.author?.id === user.id) return 1
      return new Date(b.latestAt) - new Date(a.latestAt)
    })

    return { data: { storyRail, stories: storyRail } }
  }

  // ========================
  // GET /feed/reels
  // ========================
  if (route === 'feed/reels' && method === 'GET') {
    const url = new URL(request.url)
    const { limit, cursor } = parsePagination(url)

    const cacheKey = cursor ? null : `page1:limit${limit}`
    if (cacheKey) {
      const cached = await cache.get(CacheNS.REELS_FEED, cacheKey)
      if (cached) return { data: cached }
    }

    const query = {
      kind: ContentKind.REEL,
      visibility: Visibility.PUBLIC,
    }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }

    const reels = await db.collection('content_items')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = reels.length > limit
    const items = reels.slice(0, limit)
    const currentUser = await authenticate(request, db)
    // B2: Block filter for reels feed
    const safeItems = await applyFeedPolicy(db, currentUser?.id, currentUser?.role, items)
    const enriched = await enrichPosts(db, safeItems, currentUser?.id)

    const result = {
      items: enriched,
      pagination: {
        nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
        hasMore,
      },
      nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
      feedType: 'reels',
    }

    if (cacheKey) await cache.set(CacheNS.REELS_FEED, cacheKey, result, CacheTTL.REELS_FEED)
    return { data: result }
  }

  return null
}
