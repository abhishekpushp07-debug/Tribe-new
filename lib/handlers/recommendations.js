/**
 * Tribe — Content Recommendations Engine
 *
 * "Suggested Posts", "Reels You May Like", "Similar Creators"
 * Uses collaborative filtering + affinity graph.
 */

import { v4 as uuidv4 } from 'uuid'
import { requireAuth, authenticate, sanitizeUser, enrichPosts } from '../auth-utils.js'
import { ErrorCode } from '../constants.js'
import { cache, CacheTTL, CacheNS } from '../cache.js'

export async function handleRecommendations(request, db, { method, path }) {
  const route = path.join('/')

  // ========================
  // GET /recommendations/posts — "Suggested Posts" for you
  // ========================
  if (route === 'recommendations/posts' && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)

    // Cache per user (30s TTL)
    const cKey = `rec_posts:${user.id}:${limit}`
    const cached = await cache.get('recommendations', cKey)
    if (cached) return { data: cached }

    // Step 1: Find authors the user engages with most (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const [recentLikes, recentSaves, follows] = await Promise.all([
      db.collection('likes').find({ userId: user.id, createdAt: { $gte: thirtyDaysAgo } }).project({ _id: 0, contentAuthorId: 1, contentId: 1 }).limit(200).toArray(),
      db.collection('saves').find({ userId: user.id, createdAt: { $gte: thirtyDaysAgo } }).project({ _id: 0, contentAuthorId: 1, contentId: 1 }).limit(100).toArray(),
      db.collection('follows').find({ followerId: user.id }).project({ _id: 0, followeeId: 1 }).toArray(),
    ])

    const followedIds = new Set(follows.map(f => f.followeeId))
    const likedPostIds = new Set(recentLikes.map(l => l.contentId).filter(Boolean))

    // Step 2: Find "similar users" — people who liked the same posts
    const likedPostIdArr = [...likedPostIds].slice(0, 50)
    let similarUserLikes = []
    if (likedPostIdArr.length > 0) {
      similarUserLikes = await db.collection('likes')
        .find({ contentId: { $in: likedPostIdArr }, userId: { $ne: user.id } })
        .project({ _id: 0, userId: 1, contentId: 1 })
        .limit(500)
        .toArray()
    }

    // Count overlap: users who liked the same posts (collaborative filtering)
    const userOverlap = {}
    for (const like of similarUserLikes) {
      userOverlap[like.userId] = (userOverlap[like.userId] || 0) + 1
    }
    const similarUserIds = Object.entries(userOverlap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([uid]) => uid)

    // Step 3: Get posts liked by similar users that the current user hasn't seen
    let recommendedPosts = []
    if (similarUserIds.length > 0) {
      const similarLikes = await db.collection('likes')
        .find({ userId: { $in: similarUserIds }, contentId: { $nin: [...likedPostIds] } })
        .project({ _id: 0, contentId: 1 })
        .limit(200)
        .toArray()

      const recPostIds = [...new Set(similarLikes.map(l => l.contentId))].slice(0, limit * 2)
      if (recPostIds.length > 0) {
        recommendedPosts = await db.collection('content_items')
          .find({ id: { $in: recPostIds }, visibility: 'PUBLIC', isDraft: { $ne: true } })
          .sort({ likeCount: -1 })
          .limit(limit)
          .project({ _id: 0 })
          .toArray()
      }
    }

    // Step 4: Fill with trending if not enough recommendations
    if (recommendedPosts.length < limit) {
      const fill = limit - recommendedPosts.length
      const existingIds = new Set(recommendedPosts.map(p => p.id))
      const trending = await db.collection('content_items')
        .find({ visibility: 'PUBLIC', isDraft: { $ne: true }, id: { $nin: [...existingIds, ...likedPostIds] } })
        .sort({ likeCount: -1, createdAt: -1 })
        .limit(fill)
        .project({ _id: 0 })
        .toArray()
      recommendedPosts = [...recommendedPosts, ...trending]
    }

    // Enrich with author info
    const enriched = await enrichPosts(db, recommendedPosts, user.id)

    const result = {
      items: enriched,
      count: enriched.length,
      algorithm: 'collaborative_filtering_v1',
      signals: ['liked_same_posts', 'saved_same_content', 'trending_backfill'],
    }
    await cache.set('recommendations', cKey, result, 30_000)
    return { data: result }
  }

  // ========================
  // GET /recommendations/reels — "Reels You May Like"
  // ========================
  if (route === 'recommendations/reels' && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)

    const cKey = `rec_reels:${user.id}:${limit}`
    const cached = await cache.get('recommendations', cKey)
    if (cached) return { data: cached }

    // Get creators the user watches/likes
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const [reelLikes, reelSaves] = await Promise.all([
      db.collection('reel_likes').find({ userId: user.id, createdAt: { $gte: thirtyDaysAgo } }).project({ _id: 0, reelId: 1 }).limit(100).toArray(),
      db.collection('reel_saves').find({ userId: user.id, createdAt: { $gte: thirtyDaysAgo } }).project({ _id: 0, reelId: 1 }).limit(100).toArray(),
    ])
    const interactedReelIds = new Set([...reelLikes.map(l => l.reelId), ...reelSaves.map(s => s.reelId)])

    // Find similar users (who liked same reels)
    const interactedArr = [...interactedReelIds].slice(0, 30)
    let similarLikes = []
    if (interactedArr.length > 0) {
      similarLikes = await db.collection('reel_likes')
        .find({ reelId: { $in: interactedArr }, userId: { $ne: user.id } })
        .project({ _id: 0, userId: 1 })
        .limit(300)
        .toArray()
    }

    const userOverlap = {}
    for (const l of similarLikes) userOverlap[l.userId] = (userOverlap[l.userId] || 0) + 1
    const topSimilarUsers = Object.entries(userOverlap).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([uid]) => uid)

    // Get reels liked by similar users
    let recReels = []
    if (topSimilarUsers.length > 0) {
      const theirLikes = await db.collection('reel_likes')
        .find({ userId: { $in: topSimilarUsers }, reelId: { $nin: [...interactedReelIds] } })
        .project({ _id: 0, reelId: 1 })
        .limit(100)
        .toArray()
      const recIds = [...new Set(theirLikes.map(l => l.reelId))].slice(0, limit * 2)
      if (recIds.length > 0) {
        recReels = await db.collection('reels')
          .find({ id: { $in: recIds }, status: 'PUBLISHED', visibility: 'PUBLIC' })
          .sort({ likeCount: -1 })
          .limit(limit)
          .project({ _id: 0 })
          .toArray()
      }
    }

    // Backfill with trending reels
    if (recReels.length < limit) {
      const existingIds = new Set(recReels.map(r => r.id))
      const trending = await db.collection('reels')
        .find({ status: 'PUBLISHED', visibility: 'PUBLIC', id: { $nin: [...existingIds, ...interactedReelIds] } })
        .sort({ likeCount: -1, createdAt: -1 })
        .limit(limit - recReels.length)
        .project({ _id: 0 })
        .toArray()
      recReels = [...recReels, ...trending]
    }

    const result = {
      items: recReels.slice(0, limit),
      count: Math.min(recReels.length, limit),
      algorithm: 'collaborative_filtering_v1',
    }
    await cache.set('recommendations', cKey, result, 30_000)
    return { data: result }
  }

  // ========================
  // GET /recommendations/creators — "Creators for you"
  // ========================
  if (route === 'recommendations/creators' && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 30)

    const follows = await db.collection('follows').find({ followerId: user.id }).project({ _id: 0, followeeId: 1 }).toArray()
    const followedIds = new Set([user.id, ...follows.map(f => f.followeeId)])

    // Find creators with most engagement who the user doesn't follow
    const topCreators = await db.collection('content_items').aggregate([
      { $match: { visibility: 'PUBLIC', authorId: { $nin: [...followedIds] } } },
      { $group: { _id: '$authorId', totalLikes: { $sum: '$likeCount' }, totalComments: { $sum: '$commentCount' }, postCount: { $sum: 1 } } },
      { $addFields: { engagementScore: { $add: ['$totalLikes', { $multiply: ['$totalComments', 3] }] } } },
      { $sort: { engagementScore: -1 } },
      { $limit: limit },
    ]).toArray()

    const creatorIds = topCreators.map(c => c._id).filter(Boolean)
    const users = creatorIds.length > 0
      ? await db.collection('users').find({ id: { $in: creatorIds } }).toArray()
      : []
    const userMap = Object.fromEntries(users.map(u => [u.id, sanitizeUser(u)]))

    const items = topCreators
      .filter(c => userMap[c._id])
      .map(c => ({
        user: userMap[c._id],
        stats: { posts: c.postCount, likes: c.totalLikes, comments: c.totalComments, engagement: c.engagementScore },
        reason: 'popular_creator',
      }))

    return { data: { items, count: items.length } }
  }

  return null
}
