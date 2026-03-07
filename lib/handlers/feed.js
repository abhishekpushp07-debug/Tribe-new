import { ContentKind, Visibility } from '../constants.js'
import { authenticate, requireAuth, enrichPosts, parsePagination } from '../auth-utils.js'

export async function handleFeed(path, method, request, db) {
  const route = path.join('/')

  // ========================
  // GET /feed/public
  // ========================
  if (route === 'feed/public' && method === 'GET') {
    const url = new URL(request.url)
    const { limit, cursor } = parsePagination(url)

    const query = { visibility: Visibility.PUBLIC, kind: ContentKind.POST }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }

    const posts = await db.collection('content_items')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = posts.length > limit
    const items = posts.slice(0, limit)
    const currentUser = await authenticate(request, db)
    const enriched = await enrichPosts(db, items, currentUser?.id)

    return {
      data: {
        items: enriched,
        nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
        feedType: 'public',
      },
    }
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
    const enriched = await enrichPosts(db, items, user.id)

    return {
      data: {
        items: enriched,
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

    const query = {
      collegeId,
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
    const currentUser = await authenticate(request, db)
    const enriched = await enrichPosts(db, items, currentUser?.id)

    return {
      data: {
        items: enriched,
        nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
        feedType: 'college',
      },
    }
  }

  // ========================
  // GET /feed/house/:houseId
  // ========================
  if (path[0] === 'feed' && path[1] === 'house' && path.length === 3 && method === 'GET') {
    const houseId = path[2]
    const url = new URL(request.url)
    const { limit, cursor } = parsePagination(url)

    const query = {
      houseId,
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
    const currentUser = await authenticate(request, db)
    const enriched = await enrichPosts(db, items, currentUser?.id)

    return {
      data: {
        items: enriched,
        nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
        feedType: 'house',
      },
    }
  }

  // ========================
  // GET /feed/stories — Story rail grouped by author
  // ========================
  if (route === 'feed/stories' && method === 'GET') {
    const user = await requireAuth(request, db)

    // Get stories from followed users + own stories (not expired)
    const follows = await db.collection('follows').find({ followerId: user.id }).toArray()
    const userIds = [user.id, ...follows.map(f => f.followeeId)]

    const stories = await db.collection('content_items')
      .find({
        authorId: { $in: userIds },
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
    const authorMap = Object.fromEntries(authors.map(a => {
      const { _id, pinHash, pinSalt, ...safe } = a
      return [a.id, safe]
    }))

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
    const enriched = await enrichPosts(db, items, currentUser?.id)

    return {
      data: {
        items: enriched,
        nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
        feedType: 'reels',
      },
    }
  }

  return null
}
