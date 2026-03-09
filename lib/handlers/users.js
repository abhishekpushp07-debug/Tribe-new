import { v4 as uuidv4 } from 'uuid'
import { authenticate, requireAuth, sanitizeUser, enrichPosts, parsePagination } from '../auth-utils.js'
import { ErrorCode } from '../constants.js'

export async function handleUsers(path, method, request, db) {
  // ========================
  // GET /users/:id
  // ========================
  if (path[0] === 'users' && path.length === 2 && method === 'GET') {
    const userId = path[1]
    const targetUser = await db.collection('users').findOne({ id: userId })
    if (!targetUser) return { error: 'User not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const currentUser = await authenticate(request, db)
    let isFollowing = false
    if (currentUser) {
      const follow = await db.collection('follows').findOne({
        followerId: currentUser.id,
        followeeId: userId,
      })
      isFollowing = !!follow
    }

    return { data: { user: sanitizeUser(targetUser), isFollowing, viewerIsFollowing: isFollowing } }
  }

  // ========================
  // GET /users/:id/posts
  // ========================
  if (path[0] === 'users' && path.length === 3 && path[2] === 'posts' && method === 'GET') {
    const userId = path[1]
    const url = new URL(request.url)
    const { limit, cursor } = parsePagination(url)

    const query = {
      authorId: userId,
      visibility: { $in: ['PUBLIC', 'LIMITED'] },
    }
    // Filter by kind if requested
    const kind = url.searchParams.get('kind')
    if (kind) query.kind = kind
    else query.kind = 'POST'

    // Story expiry guard: exclude expired stories from profile listings
    if (kind === 'STORY') {
      query.expiresAt = { $gt: new Date() }
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
        pagination: {
          nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
          hasMore,
        },
        nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
      },
    }
  }

  // ========================
  // GET /users/:id/followers
  // ========================
  if (path[0] === 'users' && path.length === 3 && path[2] === 'followers' && method === 'GET') {
    const userId = path[1]
    const url = new URL(request.url)
    const { limit, offset } = parsePagination(url)

    const follows = await db.collection('follows')
      .find({ followeeId: userId })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray()

    const followerIds = follows.map(f => f.followerId)
    const users = await db.collection('users').find({ id: { $in: followerIds } }).toArray()
    const total = await db.collection('follows').countDocuments({ followeeId: userId })

    const enrichedUsers = users.map(sanitizeUser)
    return {
      data: {
        items: enrichedUsers,
        // Backward-compat alias
        users: enrichedUsers,
        pagination: { total, limit, offset, hasMore: offset + enrichedUsers.length < total },
        total,
      },
    }
  }

  // ========================
  // GET /users/:id/following
  // ========================
  if (path[0] === 'users' && path.length === 3 && path[2] === 'following' && method === 'GET') {
    const userId = path[1]
    const url = new URL(request.url)
    const { limit, offset } = parsePagination(url)

    const follows = await db.collection('follows')
      .find({ followerId: userId })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray()

    const followeeIds = follows.map(f => f.followeeId)
    const users = await db.collection('users').find({ id: { $in: followeeIds } }).toArray()
    const total = await db.collection('follows').countDocuments({ followerId: userId })

    const enrichedUsers = users.map(sanitizeUser)
    return {
      data: {
        items: enrichedUsers,
        // Backward-compat alias
        users: enrichedUsers,
        pagination: { total, limit, offset, hasMore: offset + enrichedUsers.length < total },
        total,
      },
    }
  }

  // ========================
  // GET /users/:id/saved
  // ========================
  if (path[0] === 'users' && path.length === 3 && path[2] === 'saved' && method === 'GET') {
    const user = await requireAuth(request, db)
    const userId = path[1]

    // Only own saves viewable
    if (user.id !== userId) {
      return { error: 'Can only view your own saved items', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const url = new URL(request.url)
    const { limit, cursor } = parsePagination(url)

    const query = { userId: user.id }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }

    const saves = await db.collection('saves')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = saves.length > limit
    const items = saves.slice(0, limit)
    const contentIds = items.map(s => s.contentId)
    const posts = await db.collection('content_items').find({ id: { $in: contentIds } }).toArray()
    const enriched = await enrichPosts(db, posts, user.id)

    return {
      data: {
        items: enriched,
        pagination: {
          nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
          hasMore,
        },
        nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
      },
    }
  }

  return null
}
