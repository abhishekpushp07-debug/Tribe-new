import { ContentKind, Visibility } from '../constants.js'
import { authenticate, requireAuth, enrichPosts, parsePagination, sanitizeUser } from '../auth-utils.js'
import { cache, CacheNS, CacheTTL } from '../cache.js'
import { applyFeedPolicy, getBlockedUserIds } from '../access-policy.js'
import { rankFeed, buildAffinityContext } from '../services/feed-ranking.js'

export async function handleFeed(path, method, request, db) {
  const route = path.join('/')

  // ========================
  // GET /feed — Home feed (alias for /feed/public)
  // ========================
  if (route === 'feed' && method === 'GET') {
    const url = new URL(request.url)
    const { limit, cursor } = parsePagination(url)
    const currentUser = await authenticate(request, db)

    const cacheKey = cursor || currentUser?.id ? null : `anon:limit${limit}`
    if (cacheKey) {
      const cached = await cache.get(CacheNS.FEED, cacheKey)
      if (cached) return { data: cached }
    }

    const query = {
      kind: ContentKind.POST,
      visibility: Visibility.PUBLIC,
      distributionStage: { $gte: 2 },
      isDraft: { $ne: true },
    }
    if (cursor) {
      const cursorDate = new Date(cursor)
      if (!isNaN(cursorDate.getTime())) query.createdAt = { $lt: cursorDate }
    }

    const fetchMultiplier = cursor ? 1 : 3
    let posts = await db.collection('content_items')
      .find(query)
      .sort({ createdAt: -1 })
      .limit((limit * fetchMultiplier) + 1)
      .toArray()

    const hasMore = posts.length > limit
    const candidatePool = cursor ? posts.slice(0, limit) : posts

    const safeItems = await applyFeedPolicy(db, currentUser?.id, currentUser?.role, candidatePool)

    let ranked
    if (!cursor && currentUser?.id) {
      const affinity = await buildAffinityContext(db, currentUser.id)
      ranked = rankFeed(safeItems, affinity).slice(0, limit)
    } else {
      ranked = safeItems.slice(0, limit)
    }

    const items = ranked
    const enriched = await enrichPosts(db, items, currentUser?.id)
    const nextCursor = hasMore && items.length > 0 ? items[items.length - 1].createdAt?.toISOString() : null

    const result = { items: enriched, pagination: { nextCursor, hasMore }, nextCursor, feedType: 'home' }
    if (cacheKey) await cache.set(CacheNS.FEED, cacheKey, result, CacheTTL.SHORT)
    return { data: result }
  }

  // ========================
  // GET /feed/public
  // ========================
  if (route === 'feed/public' && method === 'GET') {
    const url = new URL(request.url)
    const { limit, cursor } = parsePagination(url)
    const currentUser = await authenticate(request, db)

    // Cache only ANONYMOUS first page — authenticated users get fresh ranked feed
    // This prevents user A's personalized ranking from leaking to user B
    const cacheKey = cursor || currentUser?.id ? null : `anon:limit${limit}`
    if (cacheKey) {
      const cached = await cache.get(CacheNS.PUBLIC_FEED, cacheKey)
      if (cached) {
        // B2: Apply block filter even on cached results
        if (currentUser?.id && cached.items) {
          const safeItems = await applyFeedPolicy(db, currentUser.id, currentUser.role, cached.items)
          return { data: { ...cached, items: safeItems } }
        }
        return { data: cached }
      }
    }

    const query = { visibility: Visibility.PUBLIC, kind: ContentKind.POST, distributionStage: 2 }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }

    // Fetch 3× the limit to give the ranking algorithm a wider candidate pool
    const fetchMultiplier = cursor ? 1 : 3
    const posts = await db.collection('content_items')
      .find(query)
      .sort({ createdAt: -1 })
      .limit((limit * fetchMultiplier) + 1)
      .toArray()

    const hasMore = posts.length > limit
    const candidatePool = cursor ? posts.slice(0, limit) : posts

    // B2: Block filter
    const safeItems = await applyFeedPolicy(db, currentUser?.id, currentUser?.role, candidatePool)

    // Algorithmic ranking: first page gets ranked, paginated pages stay chronological
    let ranked
    if (!cursor && currentUser?.id) {
      const affinityCtx = await buildAffinityContext(db, currentUser.id)
      ranked = rankFeed(safeItems, affinityCtx).slice(0, limit)
    } else {
      ranked = safeItems.slice(0, limit)
    }

    const enriched = await enrichPosts(db, ranked, currentUser?.id)

    // Use the last item from the original chronological fetch for cursor stability
    const lastChronoItem = posts[Math.min(posts.length - 1, limit - 1)]
    const result = {
      items: enriched,
      pagination: {
        nextCursor: hasMore && lastChronoItem ? lastChronoItem.createdAt.toISOString() : null,
        hasMore,
      },
      nextCursor: hasMore && lastChronoItem ? lastChronoItem.createdAt.toISOString() : null,
      feedType: 'public',
      distributionFilter: 'STAGE_2_ONLY',
      rankingAlgorithm: !cursor && currentUser?.id ? 'engagement_weighted_v1' : 'chronological',
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

    // B3: Fetch both followed users and followed pages
    const [follows, pageFollows] = await Promise.all([
      db.collection('follows').find({ followerId: user.id }).toArray(),
      db.collection('page_follows').find({ userId: user.id }).toArray(),
    ])
    const followeeIds = follows.map(f => f.followeeId)
    followeeIds.push(user.id) // Include own posts
    const followedPageIds = pageFollows.map(f => f.pageId)

    // B3: Query both USER and PAGE authored content
    const orClauses = [
      { authorId: { $in: followeeIds }, authorType: { $ne: 'PAGE' } },
    ]
    if (followedPageIds.length > 0) {
      orClauses.push({ authorType: 'PAGE', pageId: { $in: followedPageIds } })
    }

    const query = {
      $or: orClauses,
      visibility: Visibility.PUBLIC,
      kind: ContentKind.POST,
    }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }

    // Fetch wider pool for ranking on first page
    const fetchMultiplier = cursor ? 1 : 3
    const posts = await db.collection('content_items')
      .find(query)
      .sort({ createdAt: -1 })
      .limit((limit * fetchMultiplier) + 1)
      .toArray()

    const hasMore = posts.length > limit
    const candidatePool = cursor ? posts.slice(0, limit) : posts

    // B2: Block filter
    const safeItems = await applyFeedPolicy(db, user.id, user.role, candidatePool)

    // Algorithmic ranking on first page
    let ranked
    if (!cursor) {
      const affinityCtx = await buildAffinityContext(db, user.id)
      ranked = rankFeed(safeItems, affinityCtx).slice(0, limit)
    } else {
      ranked = safeItems.slice(0, limit)
    }

    const enriched = await enrichPosts(db, ranked, user.id)

    const lastChronoItem = posts[Math.min(posts.length - 1, limit - 1)]
    return {
      data: {
        items: enriched,
        pagination: {
          nextCursor: hasMore && lastChronoItem ? lastChronoItem.createdAt.toISOString() : null,
          hasMore,
        },
        nextCursor: hasMore && lastChronoItem ? lastChronoItem.createdAt.toISOString() : null,
        feedType: 'following',
        rankingAlgorithm: !cursor ? 'engagement_weighted_v1' : 'chronological',
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
    const currentUser = await authenticate(request, db)

    const cacheKey = cursor || currentUser?.id ? null : `anon:${collegeId}:limit${limit}`
    if (cacheKey) {
      const cached = await cache.get(CacheNS.COLLEGE_FEED, cacheKey)
      if (cached) {
        if (currentUser?.id && cached.items) {
          const safeItems = await applyFeedPolicy(db, currentUser.id, currentUser.role, cached.items)
          return { data: { ...cached, items: safeItems } }
        }
        return { data: cached }
      }
    }

    const query = {
      collegeId,
      visibility: Visibility.PUBLIC,
      kind: ContentKind.POST,
      distributionStage: { $gte: 1 },
    }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }

    const fetchMultiplier = cursor ? 1 : 3
    const posts = await db.collection('content_items')
      .find(query)
      .sort({ createdAt: -1 })
      .limit((limit * fetchMultiplier) + 1)
      .toArray()

    const hasMore = posts.length > limit
    const candidatePool = cursor ? posts.slice(0, limit) : posts
    const safeItems = await applyFeedPolicy(db, currentUser?.id, currentUser?.role, candidatePool)

    let ranked
    if (!cursor && currentUser?.id) {
      const affinityCtx = await buildAffinityContext(db, currentUser.id)
      ranked = rankFeed(safeItems, affinityCtx).slice(0, limit)
    } else {
      ranked = safeItems.slice(0, limit)
    }

    const enriched = await enrichPosts(db, ranked, currentUser?.id)

    const lastChronoItem = posts[Math.min(posts.length - 1, limit - 1)]
    const result = {
      items: enriched,
      pagination: {
        nextCursor: hasMore && lastChronoItem ? lastChronoItem.createdAt.toISOString() : null,
        hasMore,
      },
      nextCursor: hasMore && lastChronoItem ? lastChronoItem.createdAt.toISOString() : null,
      feedType: 'college',
      rankingAlgorithm: !cursor && currentUser?.id ? 'engagement_weighted_v1' : 'chronological',
    }

    if (cacheKey) await cache.set(CacheNS.COLLEGE_FEED, cacheKey, result, CacheTTL.COLLEGE_FEED)
    return { data: result }
  }

  // ========================
  // GET /feed/tribe/:tribeId  (also supports legacy /feed/house/:houseId)
  // ========================
  if (path[0] === 'feed' && (path[1] === 'tribe' || path[1] === 'house') && path.length === 3 && method === 'GET') {
    const tribeId = path[2]
    const url = new URL(request.url)
    const { limit, cursor } = parsePagination(url)
    const currentUser = await authenticate(request, db)

    const cacheKey = cursor || currentUser?.id ? null : `anon:${tribeId}:limit${limit}`
    if (cacheKey) {
      const cached = await cache.get(CacheNS.HOUSE_FEED, cacheKey)
      if (cached) {
        if (currentUser?.id && cached.items) {
          const safeItems = await applyFeedPolicy(db, currentUser.id, currentUser.role, cached.items)
          return { data: { ...cached, items: safeItems } }
        }
        return { data: cached }
      }
    }

    // Query by tribeId first, fall back to houseId for legacy content
    const query = {
      $or: [{ tribeId }, { houseId: tribeId }],
      visibility: Visibility.PUBLIC,
      kind: ContentKind.POST,
      distributionStage: { $gte: 1 },
    }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }

    const fetchMultiplier = cursor ? 1 : 3
    const posts = await db.collection('content_items')
      .find(query)
      .sort({ createdAt: -1 })
      .limit((limit * fetchMultiplier) + 1)
      .toArray()

    const hasMore = posts.length > limit
    const candidatePool = cursor ? posts.slice(0, limit) : posts
    const safeItems = await applyFeedPolicy(db, currentUser?.id, currentUser?.role, candidatePool)

    let ranked
    if (!cursor && currentUser?.id) {
      const affinityCtx = await buildAffinityContext(db, currentUser.id)
      ranked = rankFeed(safeItems, affinityCtx).slice(0, limit)
    } else {
      ranked = safeItems.slice(0, limit)
    }

    const enriched = await enrichPosts(db, ranked, currentUser?.id)

    const lastChronoItem = posts[Math.min(posts.length - 1, limit - 1)]
    const result = {
      items: enriched,
      pagination: {
        nextCursor: hasMore && lastChronoItem ? lastChronoItem.createdAt.toISOString() : null,
        hasMore,
      },
      nextCursor: hasMore && lastChronoItem ? lastChronoItem.createdAt.toISOString() : null,
      feedType: 'tribe',
      rankingAlgorithm: !cursor && currentUser?.id ? 'engagement_weighted_v1' : 'chronological',
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

    // Query the stories collection (stories are stored here, not in content_items)
    const stories = await db.collection('stories')
      .find({
        authorId: { $in: safeUserIds },
        status: { $in: ['ACTIVE', 'PUBLISHED'] },
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
        const { _id, ...clean } = s
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
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
      mediaStatus: 'READY',
    }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }

    const reels = await db.collection('reels')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = reels.length > limit
    const items = reels.slice(0, limit)
    const currentUser = await authenticate(request, db)

    // Block filter for reels
    let safeItems = items
    if (currentUser?.id) {
      const creatorIds = [...new Set(items.map(r => r.creatorId).filter(Boolean))]
      if (creatorIds.length > 0) {
        const blockedIds = await getBlockedUserIds(db, currentUser.id, creatorIds)
        if (blockedIds.size > 0) {
          safeItems = items.filter(r => !blockedIds.has(r.creatorId))
        }
      }
    }

    // Enrich with creator info
    const creatorIds = [...new Set(safeItems.map(r => r.creatorId).filter(Boolean))]
    const creators = creatorIds.length > 0
      ? await db.collection('users').find({ id: { $in: creatorIds } }).toArray()
      : []
    const creatorMap = Object.fromEntries(creators.map(u => [u.id, sanitizeUser(u)]))

    const enriched = safeItems.map(r => {
      const { _id, ...clean } = r
      return { ...clean, creator: creatorMap[r.creatorId] || null }
    })

    const result = {
      items: enriched,
      pagination: {
        nextCursor: hasMore && items.length > 0 ? items[items.length - 1].createdAt.toISOString() : null,
        hasMore,
      },
      nextCursor: hasMore && items.length > 0 ? items[items.length - 1].createdAt.toISOString() : null,
      feedType: 'reels',
    }

    if (cacheKey) await cache.set(CacheNS.REELS_FEED, cacheKey, result, CacheTTL.REELS_FEED)
    return { data: result }
  }

  // ========================
  // GET /explore — Explore page (mixed trending content)
  // ========================
  if (route === 'explore' && method === 'GET') {
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '30'), 50)
    const currentUser = await authenticate(request, db)

    // Fetch trending posts (highest engagement in last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const [trendingPosts, trendingReels, popularHashtags] = await Promise.all([
      db.collection('content_items')
        .find({ kind: ContentKind.POST, visibility: Visibility.PUBLIC, distributionStage: { $gte: 2 }, createdAt: { $gte: sevenDaysAgo } })
        .sort({ likeCount: -1, commentCount: -1 })
        .limit(Math.ceil(limit * 0.6))
        .toArray(),
      db.collection('reels')
        .find({ status: 'PUBLISHED', visibility: 'PUBLIC', mediaStatus: 'READY', createdAt: { $gte: sevenDaysAgo } })
        .sort({ viewCount: -1, likeCount: -1 })
        .limit(Math.ceil(limit * 0.4))
        .toArray(),
      db.collection('content_items').aggregate([
        { $match: { createdAt: { $gte: sevenDaysAgo }, hashtags: { $exists: true, $ne: [] } } },
        { $unwind: '$hashtags' },
        { $group: { _id: '$hashtags', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]).toArray(),
    ])

    const enrichedPosts = await enrichPosts(db, trendingPosts, currentUser?.id)
    const reelCreatorIds = [...new Set(trendingReels.map(r => r.creatorId).filter(Boolean))]
    const reelCreators = reelCreatorIds.length > 0
      ? await db.collection('users').find({ id: { $in: reelCreatorIds } }).toArray()
      : []
    const creatorMap = Object.fromEntries(reelCreators.map(u => [u.id, sanitizeUser(u)]))
    const enrichedReels = trendingReels.map(r => {
      const { _id, ...clean } = r
      return { ...clean, type: 'REEL', creator: creatorMap[r.creatorId] || null }
    })

    return {
      data: {
        posts: enrichedPosts,
        reels: enrichedReels,
        trendingHashtags: popularHashtags.map(h => ({ tag: h._id, count: h.count })),
        feedType: 'explore',
      },
    }
  }

  // ========================
  // GET /explore/creators — Popular/suggested creators
  // ========================
  if (route === 'explore/creators' && method === 'GET') {
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
    const currentUser = await authenticate(request, db)

    // Creators with most followers
    const topCreators = await db.collection('follows').aggregate([
      { $group: { _id: '$followeeId', followerCount: { $sum: 1 } } },
      { $sort: { followerCount: -1 } },
      { $limit: limit },
    ]).toArray()

    const creatorIds = topCreators.map(c => c._id).filter(Boolean)
    const users = creatorIds.length > 0
      ? await db.collection('users').find({ id: { $in: creatorIds } }).toArray()
      : []
    const userMap = Object.fromEntries(users.map(u => [u.id, sanitizeUser(u)]))

    // Add post counts
    const postCounts = creatorIds.length > 0
      ? await db.collection('content_items').aggregate([
          { $match: { authorId: { $in: creatorIds }, kind: 'POST', visibility: 'PUBLIC' } },
          { $group: { _id: '$authorId', count: { $sum: 1 } } },
        ]).toArray()
      : []
    const countMap = Object.fromEntries(postCounts.map(p => [p._id, p.count]))

    // Check which ones current user follows
    let followingSet = new Set()
    if (currentUser?.id) {
      const myFollows = await db.collection('follows').find({ followerId: currentUser.id, followeeId: { $in: creatorIds } }).toArray()
      followingSet = new Set(myFollows.map(f => f.followeeId))
    }

    const items = topCreators.map(c => ({
      user: userMap[c._id] || null,
      followerCount: c.followerCount,
      postCount: countMap[c._id] || 0,
      isFollowing: followingSet.has(c._id),
    })).filter(c => c.user)

    return { data: { items } }
  }

  // ========================
  // GET /explore/reels — Explore reels (trending)
  // ========================
  if (route === 'explore/reels' && method === 'GET') {
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
    const cursor = url.searchParams.get('cursor')

    const query = { status: 'PUBLISHED', visibility: 'PUBLIC', mediaStatus: 'READY' }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }

    const reels = await db.collection('reels')
      .find(query)
      .sort({ viewCount: -1, likeCount: -1, createdAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = reels.length > limit
    const items = reels.slice(0, limit)
    const creatorIds = [...new Set(items.map(r => r.creatorId).filter(Boolean))]
    const creators = creatorIds.length > 0
      ? await db.collection('users').find({ id: { $in: creatorIds } }).toArray()
      : []
    const creatorMap = Object.fromEntries(creators.map(u => [u.id, sanitizeUser(u)]))

    const enriched = items.map(r => {
      const { _id, ...clean } = r
      return { ...clean, creator: creatorMap[r.creatorId] || null }
    })

    return {
      data: {
        items: enriched,
        pagination: { nextCursor: hasMore && items.length > 0 ? items[items.length - 1].createdAt.toISOString() : null, hasMore },
        feedType: 'explore_reels',
      },
    }
  }

  // ========================
  // GET /feed/mixed — Mixed feed (posts + reels interleaved)
  // ========================
  if (route === 'feed/mixed' && method === 'GET') {
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
    const currentUser = await authenticate(request, db)

    const [posts, reels] = await Promise.all([
      db.collection('content_items')
        .find({ kind: ContentKind.POST, visibility: Visibility.PUBLIC, distributionStage: { $gte: 2 } })
        .sort({ createdAt: -1 })
        .limit(Math.ceil(limit * 0.7))
        .toArray(),
      db.collection('reels')
        .find({ status: 'PUBLISHED', visibility: 'PUBLIC', mediaStatus: 'READY' })
        .sort({ createdAt: -1 })
        .limit(Math.ceil(limit * 0.3))
        .toArray(),
    ])

    const enrichedPosts = await enrichPosts(db, posts, currentUser?.id)
    const reelCreatorIds = [...new Set(reels.map(r => r.creatorId).filter(Boolean))]
    const reelCreators = reelCreatorIds.length > 0
      ? await db.collection('users').find({ id: { $in: reelCreatorIds } }).toArray()
      : []
    const creatorMap = Object.fromEntries(reelCreators.map(u => [u.id, sanitizeUser(u)]))

    // Interleave: every 3rd item is a reel
    const mixed = []
    let postIdx = 0, reelIdx = 0
    for (let i = 0; i < limit && (postIdx < enrichedPosts.length || reelIdx < reels.length); i++) {
      if ((i + 1) % 4 === 0 && reelIdx < reels.length) {
        const { _id, ...clean } = reels[reelIdx++]
        mixed.push({ ...clean, type: 'REEL', creator: creatorMap[clean.creatorId] || null })
      } else if (postIdx < enrichedPosts.length) {
        mixed.push({ ...enrichedPosts[postIdx++], type: 'POST' })
      } else if (reelIdx < reels.length) {
        const { _id, ...clean } = reels[reelIdx++]
        mixed.push({ ...clean, type: 'REEL', creator: creatorMap[clean.creatorId] || null })
      }
    }

    return { data: { items: mixed, feedType: 'mixed' } }
  }

  // ========================
  // GET /feed/personalized — Personalized feed based on interests/activity
  // ========================
  if (route === 'feed/personalized' && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
    const cursor = url.searchParams.get('cursor')

    // Get user's interests and followed users
    const [follows, userData] = await Promise.all([
      db.collection('follows').find({ followerId: user.id }).toArray(),
      db.collection('users').findOne({ id: user.id }),
    ])
    const followeeIds = follows.map(f => f.followeeId)
    const interests = userData?.interests || []

    // Personalized scoring: following authors get higher priority
    const query = { kind: ContentKind.POST, visibility: Visibility.PUBLIC, distributionStage: { $gte: 2 } }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }

    const posts = await db.collection('content_items')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 3)
      .toArray()

    // Score each post
    const scored = posts.map(p => {
      let score = 0
      if (followeeIds.includes(p.authorId)) score += 100
      if (p.hashtags && interests.length > 0) {
        const matchCount = (p.hashtags || []).filter(h => interests.includes(h.toLowerCase())).length
        score += matchCount * 20
      }
      score += (p.likeCount || 0) * 2 + (p.commentCount || 0) * 3
      return { ...p, _personalScore: score }
    })

    scored.sort((a, b) => b._personalScore - a._personalScore)
    const topPosts = scored.slice(0, limit)
    const enriched = await enrichPosts(db, topPosts, user.id)
    const hasMore = posts.length > limit

    return {
      data: {
        items: enriched.map(p => { const { _personalScore, ...rest } = p; return rest }),
        pagination: { nextCursor: hasMore && topPosts.length > 0 ? topPosts[topPosts.length - 1].createdAt?.toISOString() : null, hasMore },
        feedType: 'personalized',
      },
    }
  }

  // ========================
  // GET /trending/topics — Trending topics/hashtags
  // ========================
  if (route === 'trending/topics' && method === 'GET') {
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
    const period = url.searchParams.get('period') || '7d'

    const periodDays = period === '24h' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : 7
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000)

    const topics = await db.collection('content_items').aggregate([
      { $match: { createdAt: { $gte: since }, hashtags: { $exists: true, $ne: [] } } },
      { $unwind: '$hashtags' },
      { $group: { _id: '$hashtags', postCount: { $sum: 1 }, totalLikes: { $sum: '$likeCount' }, totalComments: { $sum: '$commentCount' } } },
      { $addFields: { score: { $add: ['$postCount', { $multiply: ['$totalLikes', 0.5] }, { $multiply: ['$totalComments', 0.3] }] } } },
      { $sort: { score: -1 } },
      { $limit: limit },
    ]).toArray()

    return {
      data: {
        items: topics.map((t, i) => ({
          rank: i + 1,
          hashtag: t._id,
          postCount: t.postCount,
          totalEngagement: t.totalLikes + t.totalComments,
          score: Math.round(t.score * 10) / 10,
        })),
        period,
      },
    }
  }

  return null
}
