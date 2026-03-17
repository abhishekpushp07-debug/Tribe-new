/**
 * Tribe — World-Class Full-Text Search with Autocomplete
 *
 * Unified search across users, hashtags, content, pages, tribes.
 * MongoDB text indexes, weighted scoring, recent searches tracking.
 */

import { v4 as uuidv4 } from 'uuid'
import { requireAuth, authenticate, sanitizeUser, parsePagination } from '../auth-utils.js'
import { ErrorCode } from '../constants.js'

function fmtCount(n) {
  if (!n || n < 0) return '0'
  if (n < 1000) return String(n)
  if (n < 10000) return (n / 1000).toFixed(1).replace('.0', '') + 'K'
  if (n < 1000000) return Math.round(n / 1000) + 'K'
  if (n < 10000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'M'
  return Math.round(n / 1000000) + 'M'
}
import { cache, CacheTTL, CacheNS } from '../cache.js'

// Ensure text indexes exist
let indexesCreated = false
async function ensureSearchIndexes(db) {
  if (indexesCreated) return
  indexesCreated = true
  try {
    await Promise.allSettled([
      db.collection('users').createIndex(
        { displayName: 'text', username: 'text', bio: 'text' },
        { weights: { displayName: 10, username: 8, bio: 2 }, name: 'search_users_text' }
      ),
      db.collection('content_items').createIndex(
        { caption: 'text', hashtags: 'text' },
        { weights: { hashtags: 5, caption: 3 }, name: 'search_content_text' }
      ),
      db.collection('reels').createIndex(
        { caption: 'text', hashtags: 'text' },
        { weights: { hashtags: 5, caption: 3 }, name: 'search_reels_text' }
      ),
      db.collection('pages').createIndex(
        { name: 'text', description: 'text', category: 'text' },
        { weights: { name: 10, category: 5, description: 2 }, name: 'search_pages_text' }
      ),
      db.collection('tribes').createIndex(
        { tribeName: 'text', tribeCode: 'text' },
        { weights: { tribeName: 10, tribeCode: 5 }, name: 'search_tribes_text' }
      ),
    ])
  } catch { /* indexes may already exist */ }
}

export async function handleSearch(path, method, request, db) {
  const route = path.join('/')
  await ensureSearchIndexes(db)

  // ========================
  // GET /search — Unified search across all types
  // ========================
  if (route === 'search' && method === 'GET') {
    const url = new URL(request.url)
    const q = (url.searchParams.get('q') || '').trim()
    const type = url.searchParams.get('type') // 'users', 'content', 'reels', 'hashtags', 'pages', 'tribes' or null (all)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 30)
    const currentUser = await authenticate(request, db)

    if (!q || q.length < 1) {
      return { error: 'Search query required (min 1 char)', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Validate type filter
    const validTypes = ['users', 'content', 'posts', 'reels', 'hashtags', 'pages', 'tribes']
    if (type && !validTypes.includes(type)) {
      return { error: `Invalid search type. Valid: ${validTypes.join(', ')}`, code: ErrorCode.VALIDATION, status: 400 }
    }

    // Cache anonymous searches
    const cacheKey = !currentUser?.id ? `${q}:${type || 'all'}:${limit}` : null
    if (cacheKey) {
      const cached = await cache.get(CacheNS.SEARCH_RESULTS, cacheKey)
      if (cached) return { data: cached }
    }

    // Track search if authenticated
    if (currentUser?.id) {
      trackSearch(db, currentUser.id, q).catch(() => {})
    }

    const results = {}

    // Search users
    if (!type || type === 'users') {
      results.users = await searchUsers(db, q, limit, currentUser?.id)
    }

    // Search content (posts)
    if (!type || type === 'content' || type === 'posts') {
      results.posts = await searchContent(db, q, limit)
    }

    // Search reels
    if (!type || type === 'reels') {
      results.reels = await searchReels(db, q, limit)
    }

    // Search hashtags
    if (!type || type === 'hashtags') {
      results.hashtags = await searchHashtags(db, q, limit)
    }

    // Search pages
    if (!type || type === 'pages') {
      results.pages = await searchPages(db, q, limit)
    }

    // Search tribes
    if (!type || type === 'tribes') {
      results.tribes = await searchTribes(db, q, limit)
    }

    const searchResult = { query: q, type: type || 'all', results, totalResults: Object.values(results).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0) }
    if (cacheKey) await cache.set(CacheNS.SEARCH_RESULTS, cacheKey, searchResult, CacheTTL.SEARCH_RESULTS)
    return { data: searchResult }
  }

  // ========================
  // GET /search/autocomplete — Quick suggestions as you type
  // ========================
  if (route === 'search/autocomplete' && method === 'GET') {
    const url = new URL(request.url)
    const q = (url.searchParams.get('q') || '').trim()
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '8'), 15)

    if (!q || q.length < 1) {
      return { data: { suggestions: [] } }
    }

    // Cache autocomplete results
    const acCacheKey = `ac:${q.toLowerCase()}:${limit}`
    const acCached = await cache.get(CacheNS.SEARCH_AUTOCOMPLETE, acCacheKey)
    if (acCached) return { data: acCached }

    const regex = new RegExp(`^${escapeRegex(q)}`, 'i')

    // Fast autocomplete: users by name, hashtags, pages
    const [users, hashtags, pages] = await Promise.all([
      db.collection('users')
        .find({ $or: [{ displayName: regex }, { username: regex }], status: { $ne: 'DEACTIVATED' } })
        .project({ _id: 0, id: 1, displayName: 1, username: 1, avatarMediaId: 1 })
        .limit(limit)
        .toArray(),
      db.collection('content_items').aggregate([
        { $match: { hashtags: { $elemMatch: { $regex: `^${escapeRegex(q)}`, $options: 'i' } } } },
        { $unwind: '$hashtags' },
        { $match: { hashtags: { $regex: `^${escapeRegex(q)}`, $options: 'i' } } },
        { $group: { _id: '$hashtags', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: Math.ceil(limit / 2) },
      ]).toArray(),
      db.collection('pages')
        .find({ name: regex, status: { $ne: 'REMOVED' } })
        .project({ _id: 0, id: 1, name: 1, category: 1, avatarMediaId: 1 })
        .limit(Math.ceil(limit / 3))
        .toArray(),
    ])

    const suggestions = [
      ...users.map(u => ({ type: 'user', id: u.id, text: u.displayName, subtitle: u.username ? `@${u.username}` : null, avatar: u.avatarMediaId })),
      ...hashtags.map(h => ({ type: 'hashtag', text: `#${h._id}`, count: h.count })),
      ...pages.map(p => ({ type: 'page', id: p.id, text: p.name, subtitle: p.category, avatar: p.avatarMediaId })),
    ].slice(0, limit)

    const acResult = { suggestions, query: q }
    await cache.set(CacheNS.SEARCH_AUTOCOMPLETE, acCacheKey, acResult, CacheTTL.SEARCH_AUTOCOMPLETE)
    return { data: acResult }
  }

  // ========================
  // GET /search/users — Search users specifically
  // ========================
  if (route === 'search/users' && method === 'GET') {
    const url = new URL(request.url)
    const q = (url.searchParams.get('q') || '').trim()
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
    const offset = parseInt(url.searchParams.get('offset') || '0')
    const currentUser = await authenticate(request, db)

    if (!q) return { error: 'Query required', code: ErrorCode.VALIDATION, status: 400 }
    const users = await searchUsers(db, q, limit + 1, currentUser?.id, offset)
    const hasMore = users.length > limit

    return { data: { items: users.slice(0, limit), hasMore, query: q } }
  }

  // ========================
  // GET /search/hashtags — Search and rank hashtags
  // ========================
  if (route === 'search/hashtags' && method === 'GET') {
    const url = new URL(request.url)
    const q = (url.searchParams.get('q') || '').trim()
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)

    if (!q) return { error: 'Query required', code: ErrorCode.VALIDATION, status: 400 }
    const hashtags = await searchHashtags(db, q, limit)
    return { data: { items: hashtags, query: q } }
  }

  // ========================
  // GET /search/content — Search posts/content
  // ========================
  if (route === 'search/content' && method === 'GET') {
    const url = new URL(request.url)
    const q = (url.searchParams.get('q') || '').trim()
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)

    if (!q) return { error: 'Query required', code: ErrorCode.VALIDATION, status: 400 }
    const posts = await searchContent(db, q, limit)
    return { data: { items: posts, query: q } }
  }

  // ========================
  // GET /hashtags/:tag — Hashtag detail page (top + recent posts)
  // ========================
  if (path[0] === 'hashtags' && path.length === 2 && method === 'GET') {
    const tag = path[1].toLowerCase().replace(/^#/, '')
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
    const sort = url.searchParams.get('sort') || 'top' // 'top' or 'recent'

    const query = { hashtags: tag, visibility: 'PUBLIC', kind: 'POST' }
    const sortField = sort === 'recent' ? { createdAt: -1 } : { likeCount: -1, commentCount: -1 }

    const [posts, totalPosts, recentCount] = await Promise.all([
      db.collection('content_items')
        .find(query)
        .sort(sortField)
        .limit(limit)
        .project({ _id: 0 })
        .toArray(),
      db.collection('content_items').countDocuments({ hashtags: tag }),
      db.collection('content_items').countDocuments({ hashtags: tag, createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } }),
    ])

    // Enrich with author info
    const authorIds = [...new Set(posts.map(p => p.authorId).filter(Boolean))]
    const authors = authorIds.length > 0
      ? await db.collection('users').find({ id: { $in: authorIds } }).toArray()
      : []
    const authorMap = Object.fromEntries(authors.map(a => [a.id, sanitizeUser(a)]))
    const enriched = posts.map(p => ({ ...p, author: authorMap[p.authorId] || null }))

    return {
      data: {
        hashtag: tag,
        totalPosts,
        postsThisWeek: recentCount,
        sort,
        items: enriched,
      },
    }
  }

  // ========================
  // GET /search/recent — Recent searches
  // ========================
  if (route === 'search/recent' && method === 'GET') {
    const user = await requireAuth(request, db)
    const recents = await db.collection('recent_searches')
      .find({ userId: user.id })
      .sort({ updatedAt: -1 })
      .limit(20)
      .project({ _id: 0, query: 1, updatedAt: 1, searchCount: 1 })
      .toArray()
    return { data: { items: recents } }
  }

  // ========================
  // DELETE /search/recent — Clear recent searches
  // ========================
  if (route === 'search/recent' && method === 'DELETE') {
    const user = await requireAuth(request, db)
    await db.collection('recent_searches').deleteMany({ userId: user.id })
    return { data: { message: 'Recent searches cleared' } }
  }

  return null
}

// --- Helper functions ---

async function searchUsers(db, q, limit, currentUserId, offset = 0) {
  const regex = new RegExp(escapeRegex(q), 'i')
  const users = await db.collection('users')
    .find({
      $or: [{ displayName: regex }, { username: regex }, { bio: regex }],
      status: { $ne: 'DEACTIVATED' },
    })
    .skip(offset)
    .limit(limit)
    .toArray()

  // Check follow status if authenticated
  let followingSet = new Set()
  if (currentUserId) {
    const userIds = users.map(u => u.id)
    const follows = await db.collection('follows').find({ followerId: currentUserId, followeeId: { $in: userIds } }).toArray()
    followingSet = new Set(follows.map(f => f.followeeId))
  }

  return users.map(u => ({
    ...sanitizeUser(u),
    isFollowing: followingSet.has(u.id),
    followerCount: u.followersCount || 0,
  }))
}

async function searchContent(db, q, limit) {
  const regex = new RegExp(escapeRegex(q), 'i')
  const posts = await db.collection('content_items')
    .find({
      $or: [{ caption: regex }, { hashtags: regex }],
      visibility: 'PUBLIC',
      kind: 'POST',
    })
    .sort({ likeCount: -1, createdAt: -1 })
    .limit(limit)
    .project({ _id: 0 })
    .toArray()

  const authorIds = [...new Set(posts.map(p => p.authorId).filter(Boolean))]
  const authors = authorIds.length > 0
    ? await db.collection('users').find({ id: { $in: authorIds } }).toArray()
    : []
  const authorMap = Object.fromEntries(authors.map(a => [a.id, sanitizeUser(a)]))

  return posts.map(p => ({ ...p, author: authorMap[p.authorId] || null }))
}

async function searchReels(db, q, limit) {
  const regex = new RegExp(escapeRegex(q), 'i')
  const reels = await db.collection('reels')
    .find({
      $or: [{ caption: regex }, { hashtags: regex }],
      status: 'PUBLISHED',
      visibility: 'PUBLIC',
    })
    .sort({ viewCount: -1, createdAt: -1 })
    .limit(limit)
    .toArray()

  // Batch resolve: creators + media assets (for thumbnails/720p/poster)
  const creatorIds = [...new Set(reels.map(r => r.creatorId).filter(Boolean))]
  const mediaIds = [...new Set(reels.map(r => r.mediaId).filter(Boolean))]

  const [creators, mediaAssets] = await Promise.all([
    creatorIds.length > 0 ? db.collection('users').find({ id: { $in: creatorIds } }).toArray() : [],
    mediaIds.length > 0 ? db.collection('media_assets').find(
      { id: { $in: mediaIds } },
      { projection: { _id: 0, id: 1, publicUrl: 1, playbackUrl: 1, hlsUrl: 1, dashUrl: 1, thumbnailUrl: 1, posterFrameUrl: 1, playbackStatus: 1, variants: 1, duration: 1, width: 1, height: 1 } }
    ).toArray() : [],
  ])

  const { toUserSnippet } = await import('../entity-snippets.js')
  const creatorMap = Object.fromEntries(creators.map(u => [u.id, toUserSnippet(u)]))
  const mediaMap = Object.fromEntries(mediaAssets.map(a => [a.id, a]))

  // Avatar CDN resolution
  const avatarMediaIds = [...new Set(creators.map(a => a.avatarMediaId || a.avatar).filter(Boolean))]
  if (avatarMediaIds.length > 0) {
    const avatarAssets = await db.collection('media_assets').find({ id: { $in: avatarMediaIds } }, { projection: { _id: 0, id: 1, publicUrl: 1 } }).toArray()
    const avatarCdn = Object.fromEntries(avatarAssets.filter(a => a.publicUrl).map(a => [a.id, a.publicUrl]))
    for (const u of creators) {
      const mid = u.avatarMediaId || u.avatar
      const cdn = mid ? avatarCdn[mid] : null
      const s = creatorMap[u.id]
      if (s) { s.avatarUrl = cdn || u.profilePicUrl || s.avatarUrl || ''; s.profilePicUrl = u.profilePicUrl || cdn || '' }
    }
  }

  return reels.map(r => {
    const { _id, ...clean } = r
    const asset = mediaMap[r.mediaId] || {}
    const av = asset.variants || {}
    const thumb = clean.thumbnailUrl || asset.thumbnailUrl || av.thumbnail?.url || ''
    const poster = clean.posterFrameUrl || asset.posterFrameUrl || av.poster?.url || thumb
    const mp4 = av['720p']?.url || av.ultrafast_720p?.url || av['480p']?.url || av.faststart?.url || asset.playbackUrl || clean.playbackUrl || ''

    return {
      id: clean.id || '',
      creatorId: clean.creatorId || '',
      caption: clean.caption || '',
      hashtags: clean.hashtags || [],
      durationMs: clean.durationMs || 0,
      thumbnailUrl: thumb,
      posterFrameUrl: poster,
      playbackUrl: mp4,
      likeCount: clean.likeCount || 0,
      commentCount: clean.commentCount || 0,
      viewCount: clean.viewCount || 0,
      shareCount: clean.shareCount || 0,
      formatted: {
        likes: fmtCount(clean.likeCount || 0),
        comments: fmtCount(clean.commentCount || 0),
        views: fmtCount(clean.viewCount || 0),
      },
      shareUrl: `${process.env.NEXT_PUBLIC_BASE_URL || 'https://tribeapp.pro'}/reels/${clean.id}`,
      recommended: { mp4, poster, hd: asset.publicUrl || mp4 },
      creator: creatorMap[r.creatorId] || { id: '', displayName: '', username: '', avatarUrl: '', profilePicUrl: '', role: 'USER' },
      createdAt: clean.createdAt || '',
    }
  })
}

async function searchHashtags(db, q, limit) {
  const results = await db.collection('content_items').aggregate([
    { $match: { hashtags: { $elemMatch: { $regex: escapeRegex(q), $options: 'i' } } } },
    { $unwind: '$hashtags' },
    { $match: { hashtags: { $regex: escapeRegex(q), $options: 'i' } } },
    { $group: { _id: '$hashtags', postCount: { $sum: 1 }, totalLikes: { $sum: '$likeCount' } } },
    { $sort: { postCount: -1 } },
    { $limit: limit },
  ]).toArray()

  // Also count reels per hashtag
  const tags = results.map(h => h._id)
  let reelCounts = {}
  if (tags.length > 0) {
    const reelAgg = await db.collection('reels').aggregate([
      { $match: { hashtags: { $in: tags }, status: 'PUBLISHED' } },
      { $unwind: '$hashtags' },
      { $match: { hashtags: { $in: tags } } },
      { $group: { _id: '$hashtags', reelCount: { $sum: 1 } } },
    ]).toArray()
    reelCounts = Object.fromEntries(reelAgg.map(r => [r._id, r.reelCount]))
  }

  return results.map(h => ({
    hashtag: h._id,
    postCount: h.postCount,
    reelCount: reelCounts[h._id] || 0,
    totalCount: h.postCount + (reelCounts[h._id] || 0),
    totalLikes: h.totalLikes,
  }))
}

async function searchPages(db, q, limit) {
  const regex = new RegExp(escapeRegex(q), 'i')
  const pages = await db.collection('pages')
    .find({ $or: [{ name: regex }, { category: regex }], status: { $ne: 'REMOVED' } })
    .limit(limit)
    .toArray()
  return pages.map(p => {
    const { _id, ...clean } = p
    return clean
  })
}

async function searchTribes(db, q, limit) {
  const regex = new RegExp(escapeRegex(q), 'i')
  const tribes = await db.collection('tribes')
    .find({ $or: [{ tribeName: regex }, { tribeCode: regex }] })
    .limit(limit)
    .toArray()
  return tribes.map(t => {
    const { _id, ...clean } = t
    return clean
  })
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function trackSearch(db, userId, query) {
  await db.collection('recent_searches').updateOne(
    { userId, query: query.toLowerCase() },
    { $set: { userId, query: query.toLowerCase(), updatedAt: new Date() }, $inc: { searchCount: 1 } },
    { upsert: true }
  )
}
