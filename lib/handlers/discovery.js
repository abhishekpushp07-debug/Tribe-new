import { v4 as uuidv4 } from 'uuid'
import { authenticate, sanitizeUser, parsePagination, enrichPosts } from '../auth-utils.js'
import { ErrorCode } from '../constants.js'
import { cache, CacheNS, CacheTTL } from '../cache.js'

export async function handleDiscovery(path, method, request, db) {
  const route = path.join('/')

  // ========================
  // GET /colleges/search
  // ========================
  if (route === 'colleges/search' && method === 'GET') {
    const url = new URL(request.url)
    const q = url.searchParams.get('q') || ''
    const state = url.searchParams.get('state')
    const type = url.searchParams.get('type')
    const { limit, offset } = parsePagination(url)

    const query = {}
    if (q) {
      const words = q.trim().split(/\s+/).filter(w => w.length > 0)
      if (words.length > 0) {
        query.$and = words.map(word => ({
          $or: [
            { officialName: { $regex: word, $options: 'i' } },
            { normalizedName: { $regex: word, $options: 'i' } },
            { city: { $regex: word, $options: 'i' } },
            { type: { $regex: word, $options: 'i' } },
          ],
        }))
      }
    }
    if (state) query.state = state
    if (type) query.type = type

    const [colleges, total] = await Promise.all([
      db.collection('colleges').find(query).sort({ membersCount: -1, officialName: 1 }).skip(offset).limit(limit).toArray(),
      db.collection('colleges').countDocuments(query),
    ])

    const cleanColleges = colleges.map(c => { const { _id, ...rest } = c; return rest })
    return {
      data: {
        items: cleanColleges,
        // Backward-compat alias
        colleges: cleanColleges,
        pagination: { total, limit, offset, hasMore: offset + cleanColleges.length < total },
        total,
        offset,
        limit,
      },
    }
  }

  // ========================
  // GET /colleges/states
  // ========================
  if (route === 'colleges/states' && method === 'GET') {
    const states = await db.collection('colleges').distinct('state')
    const cleanStates = states.sort()
    return { data: { items: cleanStates, states: cleanStates, count: cleanStates.length } }
  }

  // ========================
  // GET /colleges/types
  // ========================
  if (route === 'colleges/types' && method === 'GET') {
    const types = await db.collection('colleges').distinct('type')
    const cleanTypes = types.sort()
    return { data: { items: cleanTypes, types: cleanTypes, count: cleanTypes.length } }
  }

  // ========================
  // GET /colleges/:id
  // ========================
  if (path[0] === 'colleges' && path.length === 2 && method === 'GET') {
    const collegeId = path[1]
    if (collegeId === 'search' || collegeId === 'states' || collegeId === 'types') return null
    const college = await db.collection('colleges').findOne({ id: collegeId })
    if (!college) return { error: 'College not found', code: ErrorCode.NOT_FOUND, status: 404 }
    const { _id, ...rest } = college
    return { data: { college: rest } }
  }

  // ========================
  // GET /colleges/:id/members
  // ========================
  if (path[0] === 'colleges' && path.length === 3 && path[2] === 'members' && method === 'GET') {
    const collegeId = path[1]
    const url = new URL(request.url)
    const { limit, offset } = parsePagination(url)

    const [members, total] = await Promise.all([
      db.collection('users').find({ collegeId }).sort({ followersCount: -1 }).skip(offset).limit(limit).toArray(),
      db.collection('users').countDocuments({ collegeId }),
    ])

    const cleanCollegeMembers = members.map(sanitizeUser)
    return { data: { items: cleanCollegeMembers, members: cleanCollegeMembers, pagination: { total, limit, offset, hasMore: offset + cleanCollegeMembers.length < total }, total } }
  }

  // ========================
  // GET /houses
  // ========================
  if (route === 'houses' && method === 'GET') {
    const cached = await cache.get(CacheNS.HOUSES_LIST, 'all')
    if (cached) return { data: cached }

    const houses = await db.collection('houses').find({}).sort({ totalPoints: -1 }).toArray()
    const cleanHouses = houses.map(h => { const { _id, ...rest } = h; return rest })
    const result = { items: cleanHouses, houses: cleanHouses, count: cleanHouses.length }
    await cache.set(CacheNS.HOUSES_LIST, 'all', result, CacheTTL.HOUSES_LIST)
    return { data: result }
  }

  // ========================
  // GET /houses/leaderboard
  // ========================
  if (route === 'houses/leaderboard' && method === 'GET') {
    const cached = await cache.get(CacheNS.HOUSE_LEADERBOARD, 'all')
    if (cached) return { data: cached }

    const houses = await db.collection('houses').find({}).sort({ totalPoints: -1 }).toArray()
    const leaderboard = houses.map((h, rank) => {
      const { _id, ...rest } = h
      return { ...rest, rank: rank + 1 }
    })
    const result = { items: leaderboard, leaderboard, count: leaderboard.length }
    await cache.set(CacheNS.HOUSE_LEADERBOARD, 'all', result, CacheTTL.HOUSE_LEADERBOARD)
    return { data: result }
  }

  // ========================
  // GET /houses/:idOrSlug
  // ========================
  if (path[0] === 'houses' && path.length === 2 && method === 'GET') {
    const idOrSlug = path[1]
    if (idOrSlug === 'leaderboard') return null
    const house = await db.collection('houses').findOne({
      $or: [{ id: idOrSlug }, { slug: idOrSlug }],
    })
    if (!house) return { error: 'House not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const { _id, ...rest } = house

    // Get top members by points
    const topMembers = await db.collection('users')
      .find({ houseId: house.id })
      .sort({ followersCount: -1 })
      .limit(10)
      .toArray()

    return { data: { house: rest, topMembers: topMembers.map(sanitizeUser) } }
  }

  // ========================
  // GET /houses/:idOrSlug/members
  // ========================
  if (path[0] === 'houses' && path.length === 3 && path[2] === 'members' && method === 'GET') {
    const idOrSlug = path[1]
    const house = await db.collection('houses').findOne({
      $or: [{ id: idOrSlug }, { slug: idOrSlug }],
    })
    if (!house) return { error: 'House not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const url = new URL(request.url)
    const { limit, offset } = parsePagination(url)

    const [members, total] = await Promise.all([
      db.collection('users').find({ houseId: house.id }).sort({ followersCount: -1 }).skip(offset).limit(limit).toArray(),
      db.collection('users').countDocuments({ houseId: house.id }),
    ])

    // House members — offset pagination
    const cleanHouseMembers = members.map(sanitizeUser)
    return { data: { items: cleanHouseMembers, members: cleanHouseMembers, pagination: { total, limit, offset, hasMore: offset + cleanHouseMembers.length < total }, total } }
  }

  // ========================
  // GET /search
  // ========================
  if (route === 'search' && method === 'GET') {
    const user = await authenticate(request, db)
    const url = new URL(request.url)
    const q = (url.searchParams.get('q') || '').trim()
    const type = url.searchParams.get('type') || 'all'
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 20)

    if (q.length < 2) return { data: { items: [], users: [], colleges: [], houses: [], pages: [], posts: [], hashtags: [] } }

    // Escape regex special chars for safe regex matching
    const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    // B5: Block safety — get blocked user IDs
    let blockedIds = []
    if (user) {
      const blocks = await db.collection('blocks').find({
        $or: [{ blockerId: user.id }, { blockedId: user.id }],
      }).toArray()
      blockedIds = blocks.map(b => b.blockerId === user.id ? b.blockedId : b.blockerId)
    }

    const results = {}

    if (type === 'all' || type === 'users') {
      const userFilter = {
        $or: [
          { displayName: { $regex: safeQ, $options: 'i' } },
          { username: { $regex: safeQ, $options: 'i' } },
        ],
        isBanned: false,
      }
      if (blockedIds.length > 0) userFilter.id = { $nin: blockedIds }
      const users = await db.collection('users')
        .find(userFilter)
        .limit(limit)
        .toArray()
      results.users = users.map(sanitizeUser)
    }

    if (type === 'all' || type === 'colleges') {
      const colleges = await db.collection('colleges')
        .find({ normalizedName: { $regex: safeQ.toLowerCase(), $options: 'i' } })
        .limit(limit)
        .toArray()
      results.colleges = colleges.map(c => { const { _id, ...rest } = c; return rest })
    }

    if (type === 'all' || type === 'houses') {
      const houses = await db.collection('houses')
        .find({ name: { $regex: safeQ, $options: 'i' } })
        .limit(limit)
        .toArray()
      results.houses = houses.map(h => { const { _id, ...rest } = h; return rest })
    }

    // B3: Pages search
    if (type === 'all' || type === 'pages') {
      const pageFilter = {
        status: { $in: ['ACTIVE', 'ARCHIVED'] },
        $or: [
          { name: { $regex: safeQ, $options: 'i' } },
          { slug: { $regex: safeQ, $options: 'i' } },
        ],
      }
      const pages = await db.collection('pages')
        .find(pageFilter, { projection: { _id: 0 } })
        .sort({ isOfficial: -1, followerCount: -1 })
        .limit(limit)
        .toArray()
      const { toPageSnippet } = await import('../entity-snippets.js')
      results.pages = pages.map(toPageSnippet)
    }

    // B5: Posts/content search
    if (type === 'all' || type === 'posts') {
      const postFilter = {
        caption: { $regex: safeQ, $options: 'i' },
        visibility: 'PUBLIC',
        kind: 'POST',
        moderationHold: { $ne: true },
        isRemoved: { $ne: true },
        isDeleted: { $ne: true },
      }
      if (blockedIds.length > 0) postFilter.authorId = { $nin: blockedIds }
      const posts = await db.collection('content_items')
        .find(postFilter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray()
      const enriched = await enrichPosts(db, posts, user?.id || null)
      results.posts = enriched
    }

    // B5: Hashtag search
    if (type === 'all' || type === 'hashtags') {
      const tagQuery = q.startsWith('#') ? q.slice(1).toLowerCase() : q.toLowerCase()
      const safeTagQ = tagQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (safeTagQ.length >= 1) {
        const hashtags = await db.collection('hashtags')
          .find({ tag: { $regex: safeTagQ, $options: 'i' }, postCount: { $gt: 0 } })
          .sort({ postCount: -1 })
          .limit(limit)
          .toArray()
        results.hashtags = hashtags.map(h => {
          const { _id, ...rest } = h
          return rest
        })
      } else {
        results.hashtags = []
      }
    }

    // Flatten all results into canonical items array with type markers
    const allItems = [
      ...(results.users || []).map(u => ({ ...u, _resultType: 'user' })),
      ...(results.pages || []).map(p => ({ ...p, _resultType: 'page' })),
      ...(results.hashtags || []).map(h => ({ ...h, _resultType: 'hashtag' })),
      ...(results.posts || []).map(p => ({ ...p, _resultType: 'post' })),
      ...(results.colleges || []).map(c => ({ ...c, _resultType: 'college' })),
      ...(results.houses || []).map(h => ({ ...h, _resultType: 'house' })),
    ]

    return { 
      data: { 
        items: allItems,
        // Backward-compat + type-specific aliases
        ...results 
      } 
    }
  }

  // ========================
  // GET /hashtags/:tag — Hashtag detail + stats
  // ========================
  if (path[0] === 'hashtags' && path.length === 2 && path[1] !== 'trending' && method === 'GET') {
    const rawTag = decodeURIComponent(path[1])
    const tag = rawTag.startsWith('#') ? rawTag.slice(1).toLowerCase() : rawTag.toLowerCase()

    if (!tag || tag.length === 0) {
      return { error: 'Invalid hashtag', code: ErrorCode.VALIDATION, status: 400 }
    }

    const hashtagDoc = await db.collection('hashtags').findOne({ tag })
    if (!hashtagDoc) {
      // Still return valid response even if never used — count from content
      const count = await db.collection('content_items').countDocuments({
        hashtags: tag, visibility: 'PUBLIC', moderationHold: { $ne: true },
        isRemoved: { $ne: true }, isDeleted: { $ne: true },
      })
      return { data: { tag, postCount: count, createdAt: null } }
    }

    const { _id, ...clean } = hashtagDoc
    return { data: clean }
  }

  // ========================
  // GET /hashtags/trending — Top hashtags
  // ========================
  if (path[0] === 'hashtags' && path[1] === 'trending' && method === 'GET') {
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)

    const trending = await db.collection('hashtags')
      .find({ postCount: { $gt: 0 } })
      .sort({ postCount: -1, lastUsedAt: -1 })
      .limit(limit)
      .toArray()

    const items = trending.map(h => { const { _id, ...rest } = h; return rest })
    return { data: { items, count: items.length } }
  }

  // ========================
  // GET /hashtags/:tag/feed — Content feed for a hashtag
  // ========================
  if (path[0] === 'hashtags' && path.length === 3 && path[2] === 'feed' && method === 'GET') {
    const user = await authenticate(request, db)
    const rawTag = decodeURIComponent(path[1])
    const tag = rawTag.startsWith('#') ? rawTag.slice(1).toLowerCase() : rawTag.toLowerCase()

    if (!tag || tag.length === 0) {
      return { error: 'Invalid hashtag', code: ErrorCode.VALIDATION, status: 400 }
    }

    const url = new URL(request.url)
    const { limit, cursor } = parsePagination(url)

    // Block safety
    let blockedIds = []
    if (user) {
      const blocks = await db.collection('blocks').find({
        $or: [{ blockerId: user.id }, { blockedId: user.id }],
      }).toArray()
      blockedIds = blocks.map(b => b.blockerId === user.id ? b.blockedId : b.blockerId)
    }

    const query = {
      hashtags: tag,
      visibility: 'PUBLIC',
      kind: 'POST',
      moderationHold: { $ne: true },
      isRemoved: { $ne: true },
      isDeleted: { $ne: true },
    }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }
    if (blockedIds.length > 0) query.authorId = { $nin: blockedIds }

    const posts = await db.collection('content_items')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = posts.length > limit
    const items = posts.slice(0, limit)
    const enriched = await enrichPosts(db, items, user?.id || null)
    const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null

    return {
      data: {
        items: enriched,
        tag,
        pagination: { nextCursor, hasMore },
      },
    }
  }

  // ========================
  // GET /suggestions/users
  // ========================
  if (route === 'suggestions/users' && method === 'GET') {
    const user = await authenticate(request, db)
    if (!user) return { error: 'Unauthorized', code: ErrorCode.UNAUTHORIZED, status: 401 }

    const follows = await db.collection('follows').find({ followerId: user.id }).toArray()
    const excludeIds = [user.id, ...follows.map(f => f.followeeId)]

    const baseQuery = { id: { $nin: excludeIds }, isBanned: false, onboardingComplete: true }

    // Priority: same college > same house > popular
    const suggestions = []

    if (user.collegeId) {
      const collegeUsers = await db.collection('users')
        .find({ ...baseQuery, collegeId: user.collegeId })
        .sort({ followersCount: -1 })
        .limit(5)
        .toArray()
      suggestions.push(...collegeUsers)
    }

    if (user.houseId && suggestions.length < 10) {
      const houseUsers = await db.collection('users')
        .find({ ...baseQuery, houseId: user.houseId, id: { $nin: [...excludeIds, ...suggestions.map(s => s.id)] } })
        .sort({ followersCount: -1 })
        .limit(5)
        .toArray()
      suggestions.push(...houseUsers)
    }

    if (suggestions.length < 15) {
      const popular = await db.collection('users')
        .find({ ...baseQuery, id: { $nin: [...excludeIds, ...suggestions.map(s => s.id)] } })
        .sort({ followersCount: -1 })
        .limit(15 - suggestions.length)
        .toArray()
      suggestions.push(...popular)
    }

    const cleanSuggestions = suggestions.slice(0, 15).map(sanitizeUser)
    return { data: { items: cleanSuggestions, users: cleanSuggestions, count: cleanSuggestions.length } }
  }

  return null
}
