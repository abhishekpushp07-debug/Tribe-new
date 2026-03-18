import { v4 as uuidv4 } from 'uuid'
import { authenticate, requireAuth, sanitizeUser, enrichPosts, parsePagination } from '../auth-utils.js'
import { ErrorCode } from '../constants.js'
import { applyFeedPolicy, isBlocked, filterBlockedUsers } from '../access-policy.js'

export async function handleUsers(path, method, request, db) {
  // ========================
  // GET /users/:id
  // ========================
  if (path[0] === 'users' && path.length === 2 && method === 'GET') {
    const userId = path[1]
    const targetUser = await db.collection('users').findOne({ id: userId })
    if (!targetUser) return { error: 'User not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const currentUser = await authenticate(request, db)

    // B2: Block check — blocked users cannot view each other's profiles
    if (currentUser?.id && currentUser.id !== userId) {
      const blocked = await isBlocked(db, currentUser.id, userId)
      if (blocked) return { error: 'User not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }

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
    // B2: Block check — blocked users cannot see each other's posts
    if (currentUser?.id && currentUser.id !== userId) {
      const blocked = await isBlocked(db, currentUser.id, userId)
      if (blocked) return { data: { items: [], pagination: { nextCursor: null, hasMore: false }, nextCursor: null } }
    }
    // B2: Feed policy (visibility + block filter on authors — though single author here)
    const safeItems = await applyFeedPolicy(db, currentUser?.id, currentUser?.role, items)
    const enriched = await enrichPosts(db, safeItems, currentUser?.id)

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
    // B2: Filter blocked users from follower list
    const currentUser = await authenticate(request, db)
    const safeUsers = await filterBlockedUsers(db, currentUser?.id, enrichedUsers)
    return {
      data: {
        items: safeUsers,
        // Backward-compat alias
        users: safeUsers,
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
    // B2: Filter blocked users from following list
    const currentUser = await authenticate(request, db)
    const safeUsers = await filterBlockedUsers(db, currentUser?.id, enrichedUsers)
    return {
      data: {
        items: safeUsers,
        // Backward-compat alias
        users: safeUsers,
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

  // ========================
  // GET /me — Own profile with stats
  // ========================
  if (path[0] === 'me' && path.length === 1 && method === 'GET') {
    const user = await requireAuth(request, db)
    const [postCount, followerCount, followingCount, reelCount, storyCount] = await Promise.all([
      db.collection('content_items').countDocuments({ authorId: user.id, kind: 'POST', visibility: { $ne: 'REMOVED' } }),
      db.collection('follows').countDocuments({ followeeId: user.id }),
      db.collection('follows').countDocuments({ followerId: user.id }),
      db.collection('reels').countDocuments({ creatorId: user.id, status: { $ne: 'REMOVED' } }),
      db.collection('stories').countDocuments({ authorId: user.id }),
    ])
    return {
      data: {
        user: sanitizeUser(user),
        stats: { postCount, followerCount, followingCount, reelCount, storyCount },
      },
    }
  }

  // ========================
  // GET /users/:id/mutual-followers — Mutual followers
  // ========================
  if (path[0] === 'users' && path.length === 3 && path[2] === 'mutual-followers' && method === 'GET') {
    const user = await requireAuth(request, db)
    const targetId = path[1]
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 20, 50)

    const [myFollowing, theirFollowers] = await Promise.all([
      db.collection('follows').find({ followerId: user.id }).toArray(),
      db.collection('follows').find({ followeeId: targetId }).toArray(),
    ])
    const myFollowingSet = new Set(myFollowing.map(f => f.followeeId))
    const mutualIds = theirFollowers.map(f => f.followerId).filter(id => myFollowingSet.has(id) && id !== user.id)

    const mutualUsers = mutualIds.length > 0
      ? await db.collection('users').find({ id: { $in: mutualIds.slice(0, limit) } }).toArray()
      : []

    return { data: { items: mutualUsers.map(sanitizeUser), total: mutualIds.length } }
  }

  // ========================
  // PATCH /me/privacy — Toggle private/public account
  // ========================
  if (path[0] === 'me' && path[1] === 'privacy' && path.length === 2 && (method === 'PATCH' || method === 'PUT')) {
    const user = await requireAuth(request, db)
    const body = await request.json()
    const updates = {}

    if (body.isPrivate !== undefined) updates.isPrivate = !!body.isPrivate
    if (body.showActivityStatus !== undefined) updates.showActivityStatus = !!body.showActivityStatus
    if (body.allowTagging !== undefined) updates.allowTagging = String(body.allowTagging) // 'EVERYONE' | 'FOLLOWERS' | 'NONE'
    if (body.allowMentions !== undefined) updates.allowMentions = String(body.allowMentions)
    if (body.hideOnlineStatus !== undefined) updates.hideOnlineStatus = !!body.hideOnlineStatus

    if (Object.keys(updates).length === 0) {
      return { error: 'No valid fields', code: 'VALIDATION', status: 400 }
    }

    updates.updatedAt = new Date()
    await db.collection('users').updateOne({ id: user.id }, { $set: updates })

    return { data: { message: 'Privacy settings updated', settings: updates } }
  }

  // ========================
  // GET /me/privacy — Get privacy settings
  // ========================
  if (path[0] === 'me' && path[1] === 'privacy' && path.length === 2 && method === 'GET') {
    const user = await requireAuth(request, db)
    return {
      data: {
        isPrivate: user.isPrivate || false,
        showActivityStatus: user.showActivityStatus !== false,
        allowTagging: user.allowTagging || 'EVERYONE',
        allowMentions: user.allowMentions || 'EVERYONE',
        hideOnlineStatus: user.hideOnlineStatus || false,
      },
    }
  }

  // ========================
  // GET /me/activity — Activity summary
  // ========================
  if (path[0] === 'me' && path[1] === 'activity' && path.length === 2 && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const period = url.searchParams.get('period') || '7d'
    const periodDays = period === '24h' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 7
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000)

    const [postsCreated, likesGiven, likesReceived, commentsGiven, commentsReceived, savesReceived, storiesCreated, reelsCreated] = await Promise.all([
      db.collection('content_items').countDocuments({ authorId: user.id, kind: 'POST', createdAt: { $gte: since } }),
      db.collection('likes').countDocuments({ userId: user.id, createdAt: { $gte: since } }),
      db.collection('likes').countDocuments({ contentAuthorId: user.id, createdAt: { $gte: since } }),
      db.collection('comments').countDocuments({ authorId: user.id, createdAt: { $gte: since } }),
      db.collection('comments').countDocuments({ contentAuthorId: user.id, createdAt: { $gte: since } }),
      db.collection('saves').countDocuments({ contentAuthorId: user.id, createdAt: { $gte: since } }),
      db.collection('stories').countDocuments({ authorId: user.id, createdAt: { $gte: since } }),
      db.collection('reels').countDocuments({ creatorId: user.id, createdAt: { $gte: since } }),
    ])

    const totalEngagement = likesReceived + commentsReceived + savesReceived

    return {
      data: {
        period,
        periodDays,
        since: since.toISOString(),
        content: { postsCreated, storiesCreated, reelsCreated },
        engagement: { likesGiven, likesReceived, commentsGiven, commentsReceived, savesReceived, totalEngagement },
        avgEngagementPerDay: periodDays > 0 ? Math.round(totalEngagement / periodDays * 10) / 10 : 0,
      },
    }
  }

  // ========================
  // POST /me/interests — Set interests
  // ========================
  if (path[0] === 'me' && path[1] === 'interests' && path.length === 2 && method === 'POST') {
    const user = await requireAuth(request, db)
    const body = await request.json()
    if (!Array.isArray(body.interests) || body.interests.length === 0) {
      return { error: 'interests must be a non-empty array', code: 'VALIDATION', status: 400 }
    }
    const interests = body.interests.slice(0, 20).map(i => String(i).toLowerCase().trim()).filter(Boolean)
    await db.collection('users').updateOne({ id: user.id }, { $set: { interests, updatedAt: new Date() } })
    return { data: { interests } }
  }

  // ========================
  // GET /me/interests — Get interests
  // ========================
  if (path[0] === 'me' && path[1] === 'interests' && path.length === 2 && method === 'GET') {
    const user = await requireAuth(request, db)
    return { data: { interests: user.interests || [] } }
  }

  // ========================
  // POST /me/deactivate — Deactivate account
  // ========================
  if (path[0] === 'me' && path[1] === 'deactivate' && path.length === 2 && method === 'POST') {
    const user = await requireAuth(request, db)
    await db.collection('users').updateOne({ id: user.id }, {
      $set: { status: 'DEACTIVATED', deactivatedAt: new Date(), updatedAt: new Date() },
    })
    await db.collection('sessions').deleteMany({ userId: user.id })
    return { data: { message: 'Account deactivated. You can reactivate by logging in again.' } }
  }

  // ========================
  // GET /me/login-activity — Recent login sessions
  // ========================
  if (path[0] === 'me' && path[1] === 'login-activity' && path.length === 2 && method === 'GET') {
    const user = await requireAuth(request, db)
    const sessions = await db.collection('sessions')
      .find({ userId: user.id })
      .sort({ createdAt: -1 })
      .limit(10)
      .project({ _id: 0, id: 1, createdAt: 1, lastAccessedAt: 1, ipAddress: 1, deviceInfo: 1, accessTokenExpiresAt: 1 })
      .toArray()

    const currentSession = request.headers.get('authorization')?.replace('Bearer ', '')
    return {
      data: {
        sessions: sessions.map(s => ({
          ...s,
          isCurrent: false, // could match by token but not needed
          isExpired: s.accessTokenExpiresAt ? new Date(s.accessTokenExpiresAt) < new Date() : false,
        })),
        totalActive: sessions.filter(s => !s.accessTokenExpiresAt || new Date(s.accessTokenExpiresAt) > new Date()).length,
      },
    }
  }

  // ========================
  // GET /me/stats — User dashboard statistics
  // ========================
  if (path[0] === 'me' && path[1] === 'stats' && path.length === 2 && method === 'GET') {
    const user = await requireAuth(request, db)
    const [posts, reels, stories, followers, following, likes, saves, pages] = await Promise.all([
      db.collection('content_items').countDocuments({ authorId: user.id, kind: 'POST', visibility: { $ne: 'REMOVED' } }),
      db.collection('reels').countDocuments({ creatorId: user.id, status: { $ne: 'REMOVED' } }),
      db.collection('stories').countDocuments({ authorId: user.id }),
      db.collection('follows').countDocuments({ followeeId: user.id }),
      db.collection('follows').countDocuments({ followerId: user.id }),
      db.collection('likes').countDocuments({ contentAuthorId: user.id }),
      db.collection('saves').countDocuments({ contentAuthorId: user.id }),
      db.collection('page_members').countDocuments({ userId: user.id, status: 'ACTIVE' }),
    ])
    return {
      data: {
        posts, reels, stories, followers, following,
        totalLikesReceived: likes,
        totalSavesReceived: saves,
        pagesJoined: pages,
        memberSince: user.createdAt,
      },
    }
  }

  // ========================
  // GET /me/bookmarks — All saved content (bookmarks)
  // ========================
  if (path[0] === 'me' && path[1] === 'bookmarks' && path.length === 2 && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const { limit, cursor } = parsePagination(url)
    const type = url.searchParams.get('type') // 'post', 'reel', or null (all)

    const saveQuery = { userId: user.id }
    if (type) saveQuery.contentType = type.toUpperCase()
    if (cursor) saveQuery.createdAt = { $lt: new Date(cursor) }

    const saves = await db.collection('saves')
      .find(saveQuery)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = saves.length > limit
    const items = saves.slice(0, limit)

    // Try to fetch from both collections - handle saves that don't have contentType
    const contentIds = items.map(s => s.contentId)

    const [posts, reels] = await Promise.all([
      contentIds.length > 0 ? db.collection('content_items').find({ id: { $in: contentIds }, visibility: { $ne: 'REMOVED' } }).toArray() : [],
      contentIds.length > 0 ? db.collection('reels').find({ id: { $in: contentIds }, status: { $ne: 'REMOVED' } }).toArray() : [],
    ])

    const postMap = Object.fromEntries(posts.map(p => [p.id, p]))
    const reelMap = Object.fromEntries(reels.map(r => [r.id, r]))

    // Enrich posts
    const enrichedPosts = await enrichPosts(db, posts, user.id)
    const enrichedPostMap = Object.fromEntries(enrichedPosts.map(p => [p.id, p]))

    // Enrich reels with creator info
    const creatorIds = [...new Set(reels.map(r => r.creatorId).filter(Boolean))]
    const creators = creatorIds.length > 0
      ? await db.collection('users').find({ id: { $in: creatorIds } }).toArray()
      : []
    const creatorMap = Object.fromEntries(creators.map(u => [u.id, sanitizeUser(u)]))

    // Build ordered result maintaining save order
    const allItems = items.map(save => {
      if (enrichedPostMap[save.contentId]) {
        return { ...enrichedPostMap[save.contentId], type: 'POST', savedAt: save.createdAt }
      }
      if (reelMap[save.contentId]) {
        const { _id, ...clean } = reelMap[save.contentId]
        return { ...clean, type: 'REEL', creator: creatorMap[clean.creatorId] || null, savedAt: save.createdAt }
      }
      return null
    }).filter(Boolean)

    return {
      data: {
        items: allItems,
        total: allItems.length,
        pagination: {
          nextCursor: hasMore && items.length > 0 ? items[items.length - 1].createdAt.toISOString() : null,
          hasMore,
        },
      },
    }
  }

  // ========================
  // GET /me/settings — Get all user settings
  // ========================
  if (path[0] === 'me' && path[1] === 'settings' && path.length === 2 && method === 'GET') {
    const user = await requireAuth(request, db)
    const notifPrefs = await db.collection('notification_preferences').findOne({ userId: user.id })
    return {
      data: {
        privacy: {
          isPrivate: user.isPrivate || false,
          showActivityStatus: user.showActivityStatus !== false,
          allowTagging: user.allowTagging || 'EVERYONE',
          allowMentions: user.allowMentions || 'EVERYONE',
          hideOnlineStatus: user.hideOnlineStatus || false,
        },
        notifications: notifPrefs ? (({ _id, ...rest }) => rest)(notifPrefs) : {},
        profile: {
          displayName: user.displayName,
          username: user.username || null,
          bio: user.bio || '',
          avatarMediaId: user.avatarMediaId || null,
        },
        interests: user.interests || [],
      },
    }
  }

  // ========================
  // PATCH /me/settings — Update settings (bulk)
  // ========================
  if (path[0] === 'me' && path[1] === 'settings' && path.length === 2 && method === 'PATCH') {
    const user = await requireAuth(request, db)
    const body = await request.json()
    const userUpdates = {}

    if (body.privacy) {
      if (body.privacy.isPrivate !== undefined) userUpdates.isPrivate = !!body.privacy.isPrivate
      if (body.privacy.showActivityStatus !== undefined) userUpdates.showActivityStatus = !!body.privacy.showActivityStatus
      if (body.privacy.allowTagging) userUpdates.allowTagging = String(body.privacy.allowTagging)
      if (body.privacy.allowMentions) userUpdates.allowMentions = String(body.privacy.allowMentions)
      if (body.privacy.hideOnlineStatus !== undefined) userUpdates.hideOnlineStatus = !!body.privacy.hideOnlineStatus
    }

    if (body.notifications) {
      await db.collection('notification_preferences').updateOne(
        { userId: user.id },
        { $set: { ...body.notifications, userId: user.id, updatedAt: new Date() } },
        { upsert: true }
      )
    }

    if (Object.keys(userUpdates).length > 0) {
      userUpdates.updatedAt = new Date()
      await db.collection('users').updateOne({ id: user.id }, { $set: userUpdates })
    }

    return { data: { message: 'Settings updated' } }
  }

  // GET /me/media — Paginated list of user's uploaded media
  if (path[0] === 'me' && path[1] === 'media' && path.length === 2 && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
    const cursor = url.searchParams.get('cursor') || ''
    const kind = url.searchParams.get('kind') || ''
    const status = url.searchParams.get('status') || 'READY'

    const query = { ownerId: user.id, isDeleted: { $ne: true } }
    if (status) query.status = status
    if (kind) query.kind = kind.toUpperCase()
    if (cursor) query.createdAt = { $lt: new Date(cursor) }

    const items = await db.collection('media_assets')
      .find(query, { projection: { _id: 0, id: 1, kind: 1, mimeType: 1, publicUrl: 1, playbackUrl: 1, thumbnailUrl: 1, posterFrameUrl: 1, sizeBytes: 1, width: 1, height: 1, duration: 1, status: 1, playbackStatus: 1, createdAt: 1 } })
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = items.length > limit
    const results = items.slice(0, limit)
    const nextCursor = hasMore && results.length > 0 ? results[results.length - 1].createdAt.toISOString() : ''

    return { data: { items: results, pagination: { nextCursor, hasMore }, filters: { kinds: ['IMAGE', 'VIDEO', 'AUDIO'], statuses: ['READY', 'PROCESSING', 'FAILED'] } } }
  }

  return null
}
