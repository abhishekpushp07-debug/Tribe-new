/**
 * Tribe — Smart Suggestions Engine
 *
 * "People you may know", "Trending in your college", "Suggested tribes"
 */

import { requireAuth, sanitizeUser } from '../auth-utils.js'
import { ErrorCode } from '../constants.js'
import { cache } from '../cache.js'

export async function handleSuggestions(request, db, { method, path }) {
  const route = path.join('/')

  // ========================
  // GET /suggestions/people — "People you may know"
  // ========================
  if (route === 'suggestions/people' && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '15'), 30)

    const cKey = `sug_people:${user.id}:${limit}`
    const cached = await cache.get('suggestions', cKey)
    if (cached) return { data: cached }

    // Get who the user follows
    const follows = await db.collection('follows')
      .find({ followerId: user.id })
      .project({ _id: 0, followeeId: 1 })
      .toArray()
    const followedIds = new Set([user.id, ...follows.map(f => f.followeeId)])

    // Get blocked users
    const blocks = await db.collection('blocks')
      .find({ $or: [{ blockerId: user.id }, { blockedId: user.id }] })
      .project({ _id: 0, blockerId: 1, blockedId: 1 })
      .toArray()
    const blockedIds = new Set(blocks.map(b => b.blockerId === user.id ? b.blockedId : b.blockerId))

    const excludeIds = new Set([...followedIds, ...blockedIds])

    // Signal 1: Mutual follows (friends of friends)
    const friendFollows = await db.collection('follows')
      .find({ followerId: { $in: [...followedIds].filter(id => id !== user.id) } })
      .project({ _id: 0, followeeId: 1, followerId: 1 })
      .limit(500)
      .toArray()

    const mutualCounts = {}
    for (const f of friendFollows) {
      if (!excludeIds.has(f.followeeId)) {
        mutualCounts[f.followeeId] = (mutualCounts[f.followeeId] || 0) + 1
      }
    }

    // Signal 2: Same tribe
    const userMembership = await db.collection('user_tribe_memberships')
      .findOne({ userId: user.id, status: 'ACTIVE' })
    let tribeMembers = []
    if (userMembership) {
      tribeMembers = await db.collection('user_tribe_memberships')
        .find({ tribeId: userMembership.tribeId, status: 'ACTIVE', userId: { $nin: [...excludeIds] } })
        .project({ _id: 0, userId: 1 })
        .limit(50)
        .toArray()
    }
    const tribeMemberIds = new Set(tribeMembers.map(m => m.userId))

    // Signal 3: Same college
    let collegeMembers = []
    if (user.collegeId) {
      collegeMembers = await db.collection('users')
        .find({ collegeId: user.collegeId, id: { $nin: [...excludeIds] } })
        .project({ _id: 0, id: 1 })
        .limit(50)
        .toArray()
    }
    const collegeMemberIds = new Set(collegeMembers.map(m => m.id))

    // Combine and score suggestions
    const candidateIds = new Set([
      ...Object.keys(mutualCounts),
      ...tribeMemberIds,
      ...collegeMemberIds,
    ])

    const candidates = []
    for (const cid of candidateIds) {
      if (excludeIds.has(cid)) continue
      let score = 0
      const reasons = []

      if (mutualCounts[cid]) {
        score += mutualCounts[cid] * 3
        reasons.push(`${mutualCounts[cid]} mutual follows`)
      }
      if (tribeMemberIds.has(cid)) {
        score += 2
        reasons.push('Same tribe')
      }
      if (collegeMemberIds.has(cid)) {
        score += 1
        reasons.push('Same college')
      }

      candidates.push({ userId: cid, score, reasons })
    }

    candidates.sort((a, b) => b.score - a.score)
    const topCandidates = candidates.slice(0, limit)

    // Enrich with user data
    const userIds = topCandidates.map(c => c.userId)
    const users = userIds.length > 0
      ? await db.collection('users').find({ id: { $in: userIds } }).toArray()
      : []
    const userMap = Object.fromEntries(users.map(u => [u.id, sanitizeUser(u)]))

    const items = topCandidates
      .filter(c => userMap[c.userId])
      .map(c => ({
        user: userMap[c.userId],
        score: c.score,
        reasons: c.reasons,
        mutualFollows: mutualCounts[c.userId] || 0,
        sameTribe: tribeMemberIds.has(c.userId),
        sameCollege: collegeMemberIds.has(c.userId),
      }))

    const result = { items, count: items.length, algorithm: 'social_graph_v1' }
    await cache.set('suggestions', cKey, result, 60_000)
    return { data: result }
  }

  // ========================
  // GET /suggestions/trending — "Trending in your college"
  // ========================
  if (route === 'suggestions/trending' && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 30)

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    // Trending hashtags in the user's college or globally
    const matchStage = user.collegeId
      ? { collegeId: user.collegeId, createdAt: { $gte: sevenDaysAgo }, hashtags: { $exists: true, $ne: [] } }
      : { createdAt: { $gte: sevenDaysAgo }, hashtags: { $exists: true, $ne: [] } }

    const [trendingHashtags, trendingPosts, popularCreators] = await Promise.all([
      db.collection('content_items').aggregate([
        { $match: matchStage },
        { $unwind: '$hashtags' },
        { $group: { _id: '$hashtags', count: { $sum: 1 }, totalLikes: { $sum: '$likeCount' } } },
        { $addFields: { score: { $add: ['$count', { $multiply: ['$totalLikes', 0.5] }] } } },
        { $sort: { score: -1 } },
        { $limit: limit },
      ]).toArray(),

      db.collection('content_items')
        .find({ createdAt: { $gte: sevenDaysAgo }, visibility: 'PUBLIC', isDraft: { $ne: true } })
        .sort({ likeCount: -1 })
        .limit(5)
        .project({ _id: 0, id: 1, caption: 1, likeCount: 1, commentCount: 1, authorId: 1 })
        .toArray(),

      db.collection('content_items').aggregate([
        { $match: { createdAt: { $gte: sevenDaysAgo }, visibility: 'PUBLIC' } },
        { $group: { _id: '$authorId', totalLikes: { $sum: '$likeCount' }, postCount: { $sum: 1 } } },
        { $sort: { totalLikes: -1 } },
        { $limit: 5 },
      ]).toArray(),
    ])

    // Enrich popular creators
    const creatorIds = popularCreators.map(c => c._id).filter(Boolean)
    const creatorUsers = creatorIds.length > 0
      ? await db.collection('users').find({ id: { $in: creatorIds } }).toArray()
      : []
    const creatorMap = Object.fromEntries(creatorUsers.map(u => [u.id, sanitizeUser(u)]))

    return {
      data: {
        hashtags: trendingHashtags.map((h, i) => ({
          rank: i + 1,
          hashtag: h._id,
          postCount: h.count,
          totalLikes: h.totalLikes,
          score: Math.round(h.score * 10) / 10,
        })),
        topPosts: trendingPosts.map(p => ({ ...p, caption: (p.caption || '').slice(0, 100) })),
        topCreators: popularCreators.map(c => ({
          user: creatorMap[c._id] || null,
          totalLikes: c.totalLikes,
          postCount: c.postCount,
        })).filter(c => c.user),
        scope: user.collegeId ? 'college' : 'global',
      },
    }
  }

  // ========================
  // GET /suggestions/tribes — "Tribes for you"
  // ========================
  if (route === 'suggestions/tribes' && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '5'), 20)

    // Find tribes user is NOT in
    const memberships = await db.collection('user_tribe_memberships')
      .find({ userId: user.id, status: 'ACTIVE' })
      .project({ _id: 0, tribeId: 1 })
      .toArray()
    const joinedTribeIds = new Set(memberships.map(m => m.tribeId))

    const tribes = await db.collection('tribes')
      .find({ isActive: true, id: { $nin: [...joinedTribeIds] } })
      .sort({ membersCount: -1, totalSalutes: -1 })
      .limit(limit)
      .project({ _id: 0 })
      .toArray()

    return {
      data: {
        items: tribes.map(t => ({
          id: t.id,
          tribeCode: t.tribeCode,
          tribeName: t.tribeName,
          primaryColor: t.primaryColor,
          animalIcon: t.animalIcon,
          membersCount: t.membersCount || 0,
          reason: 'popular_tribe',
        })),
        count: tribes.length,
      },
    }
  }

  return null
}
