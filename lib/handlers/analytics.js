/**
 * Tribe — World-Class Engagement Analytics Dashboard
 *
 * Instagram-level insights: reach, impressions, profile visits,
 * audience growth, content performance, time-series data.
 */

import { v4 as uuidv4 } from 'uuid'
import { requireAuth, authenticate, sanitizeUser } from '../auth-utils.js'
import { ErrorCode } from '../constants.js'

export async function handleAnalytics(path, method, request, db) {
  const route = path.join('/')

  // ========================
  // POST /analytics/track — Track an impression/view/profile-visit event
  // ========================
  if (route === 'analytics/track' && method === 'POST') {
    const currentUser = await authenticate(request, db)
    const body = await request.json()
    const { eventType, targetId, targetType, metadata } = body

    const validTypes = ['IMPRESSION', 'VIEW', 'PROFILE_VISIT', 'CONTENT_VIEW', 'REEL_VIEW', 'STORY_VIEW', 'LINK_CLICK', 'SHARE']
    if (!validTypes.includes(eventType)) {
      return { error: `Invalid eventType. Valid: ${validTypes.join(', ')}`, code: ErrorCode.VALIDATION, status: 400 }
    }

    const event = {
      id: uuidv4(),
      eventType,
      targetId: targetId || null,
      targetType: targetType || null,
      viewerId: currentUser?.id || null,
      metadata: metadata || {},
      createdAt: new Date(),
      day: new Date().toISOString().slice(0, 10), // '2026-03-12' for aggregation
    }
    await db.collection('analytics_events').insertOne(event)

    // Update counters
    if (eventType === 'PROFILE_VISIT' && targetId) {
      await db.collection('profile_visits').updateOne(
        { profileId: targetId, day: event.day },
        { $inc: { visitCount: 1, uniqueVisitors: currentUser?.id ? 1 : 0 }, $setOnInsert: { profileId: targetId, day: event.day, createdAt: new Date() } },
        { upsert: true }
      )
    }

    if (['CONTENT_VIEW', 'IMPRESSION'].includes(eventType) && targetId) {
      await db.collection('content_items').updateOne({ id: targetId }, { $inc: { viewCount: 1, impressionCount: 1 } })
    }

    if (eventType === 'REEL_VIEW' && targetId) {
      await db.collection('reels').updateOne({ id: targetId }, { $inc: { viewCount: 1 } })
    }

    return { data: { tracked: true } }
  }

  // ========================
  // GET /analytics/overview — Overall account analytics
  // ========================
  if (route === 'analytics/overview' && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const period = url.searchParams.get('period') || '7d'
    const periodDays = period === '24h' ? 1 : period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 7
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000)
    const prevSince = new Date(Date.now() - periodDays * 2 * 24 * 60 * 60 * 1000)

    const [
      totalFollowers, totalFollowing, totalPosts, totalReels,
      likesReceived, commentsReceived, savesReceived, sharesReceived,
      profileVisits, contentImpressions,
      prevLikes, prevComments, prevProfileVisits,
      newFollowers, lostFollowers,
    ] = await Promise.all([
      db.collection('follows').countDocuments({ followeeId: user.id }),
      db.collection('follows').countDocuments({ followerId: user.id }),
      db.collection('content_items').countDocuments({ authorId: user.id, kind: 'POST', visibility: { $ne: 'REMOVED' } }),
      db.collection('reels').countDocuments({ creatorId: user.id, status: { $ne: 'REMOVED' } }),
      db.collection('likes').countDocuments({ contentAuthorId: user.id, createdAt: { $gte: since } }),
      db.collection('comments').countDocuments({ contentAuthorId: user.id, createdAt: { $gte: since } }),
      db.collection('saves').countDocuments({ contentAuthorId: user.id, createdAt: { $gte: since } }),
      db.collection('content_items').aggregate([
        { $match: { authorId: user.id, createdAt: { $gte: since } } },
        { $group: { _id: null, total: { $sum: '$shareCount' } } },
      ]).toArray().then(r => r[0]?.total || 0),
      db.collection('profile_visits').aggregate([
        { $match: { profileId: user.id, day: { $gte: since.toISOString().slice(0, 10) } } },
        { $group: { _id: null, total: { $sum: '$visitCount' } } },
      ]).toArray().then(r => r[0]?.total || 0),
      db.collection('analytics_events').countDocuments({ targetType: 'CONTENT', eventType: 'IMPRESSION', targetId: { $exists: true }, createdAt: { $gte: since } }),
      // Previous period for comparison
      db.collection('likes').countDocuments({ contentAuthorId: user.id, createdAt: { $gte: prevSince, $lt: since } }),
      db.collection('comments').countDocuments({ contentAuthorId: user.id, createdAt: { $gte: prevSince, $lt: since } }),
      db.collection('profile_visits').aggregate([
        { $match: { profileId: user.id, day: { $gte: prevSince.toISOString().slice(0, 10), $lt: since.toISOString().slice(0, 10) } } },
        { $group: { _id: null, total: { $sum: '$visitCount' } } },
      ]).toArray().then(r => r[0]?.total || 0),
      db.collection('follows').countDocuments({ followeeId: user.id, createdAt: { $gte: since } }),
      db.collection('follows').countDocuments({ followeeId: user.id, unfollowedAt: { $gte: since } }),
    ])

    const totalEngagement = likesReceived + commentsReceived + savesReceived + sharesReceived
    const prevEngagement = prevLikes + prevComments
    const engagementGrowth = prevEngagement > 0 ? Math.round(((totalEngagement - prevEngagement) / prevEngagement) * 100) : 0
    const followerGrowth = newFollowers - lostFollowers
    const engagementRate = totalFollowers > 0 ? Math.round((totalEngagement / totalFollowers) * 10000) / 100 : 0

    return {
      data: {
        period,
        account: { totalFollowers, totalFollowing, totalPosts, totalReels },
        engagement: {
          likes: likesReceived,
          comments: commentsReceived,
          saves: savesReceived,
          shares: sharesReceived,
          total: totalEngagement,
          rate: engagementRate,
          growthPercent: engagementGrowth,
        },
        reach: {
          profileVisits,
          contentImpressions,
          profileVisitGrowth: prevProfileVisits > 0 ? Math.round(((profileVisits - prevProfileVisits) / prevProfileVisits) * 100) : 0,
        },
        audience: {
          newFollowers,
          lostFollowers,
          netGrowth: followerGrowth,
        },
      },
    }
  }

  // ========================
  // GET /analytics/content — Content performance analytics
  // ========================
  if (route === 'analytics/content' && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
    const sort = url.searchParams.get('sort') || 'engagement' // 'engagement', 'reach', 'recent'

    const sortField = sort === 'reach' ? { viewCount: -1 } : sort === 'recent' ? { createdAt: -1 } :
      { likeCount: -1, commentCount: -1 }

    const posts = await db.collection('content_items')
      .find({ authorId: user.id, kind: 'POST', visibility: { $ne: 'REMOVED' } })
      .sort(sortField)
      .limit(limit)
      .toArray()

    const items = posts.map(p => {
      const { _id, ...clean } = p
      const engagement = (p.likeCount || 0) + (p.commentCount || 0) + (p.saveCount || 0) + (p.shareCount || 0)
      return {
        id: p.id,
        caption: (p.caption || '').slice(0, 100),
        kind: p.kind,
        createdAt: p.createdAt,
        metrics: {
          likes: p.likeCount || 0,
          comments: p.commentCount || 0,
          saves: p.saveCount || 0,
          shares: p.shareCount || 0,
          views: p.viewCount || 0,
          impressions: p.impressionCount || 0,
          engagement,
          engagementRate: (p.viewCount || 0) > 0 ? Math.round((engagement / p.viewCount) * 10000) / 100 : 0,
        },
      }
    })

    return { data: { items, sort } }
  }

  // ========================
  // GET /analytics/content/:id — Single content deep analytics
  // ========================
  if (path[0] === 'analytics' && path[1] === 'content' && path.length === 3 && method === 'GET') {
    const user = await requireAuth(request, db)
    const contentId = path[2]

    const content = await db.collection('content_items').findOne({ id: contentId })
    if (!content) return { error: 'Content not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (content.authorId !== user.id && !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { error: 'Not your content', code: 'FORBIDDEN', status: 403 }
    }

    // Time-series: likes per day over last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const [likesByDay, commentsByDay, topLikers] = await Promise.all([
      db.collection('likes').aggregate([
        { $match: { contentId, createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]).toArray(),
      db.collection('comments').aggregate([
        { $match: { contentId, createdAt: { $gte: thirtyDaysAgo } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]).toArray(),
      db.collection('likes')
        .find({ contentId })
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray(),
    ])

    // Enrich top likers
    const likerIds = topLikers.map(l => l.userId).filter(Boolean)
    const likerUsers = likerIds.length > 0
      ? await db.collection('users').find({ id: { $in: likerIds } }).toArray()
      : []
    const likerMap = Object.fromEntries(likerUsers.map(u => [u.id, sanitizeUser(u)]))

    const engagement = (content.likeCount || 0) + (content.commentCount || 0) + (content.saveCount || 0) + (content.shareCount || 0)

    return {
      data: {
        content: {
          id: content.id,
          caption: (content.caption || '').slice(0, 200),
          createdAt: content.createdAt,
        },
        metrics: {
          likes: content.likeCount || 0,
          comments: content.commentCount || 0,
          saves: content.saveCount || 0,
          shares: content.shareCount || 0,
          views: content.viewCount || 0,
          impressions: content.impressionCount || 0,
          engagement,
          engagementRate: (content.viewCount || 0) > 0 ? Math.round((engagement / content.viewCount) * 10000) / 100 : 0,
        },
        timeSeries: {
          likes: likesByDay.map(d => ({ date: d._id, count: d.count })),
          comments: commentsByDay.map(d => ({ date: d._id, count: d.count })),
        },
        topLikers: topLikers.slice(0, 5).map(l => ({
          user: likerMap[l.userId] || null,
          likedAt: l.createdAt,
        })),
      },
    }
  }

  // ========================
  // GET /analytics/audience — Audience demographics & growth
  // ========================
  if (route === 'analytics/audience' && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const period = url.searchParams.get('period') || '30d'
    const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : period === '90d' ? 90 : 30
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000)

    // Follower growth by day
    const followerGrowth = await db.collection('follows').aggregate([
      { $match: { followeeId: user.id, createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).toArray()

    // Audience college distribution
    const followers = await db.collection('follows')
      .find({ followeeId: user.id })
      .project({ followerId: 1, _id: 0 })
      .limit(5000)
      .toArray()
    const followerIds = followers.map(f => f.followerId)

    const [collegeDist, tribeDist, genderDist] = await Promise.all([
      followerIds.length > 0 ? db.collection('users').aggregate([
        { $match: { id: { $in: followerIds }, collegeName: { $exists: true, $ne: null } } },
        { $group: { _id: '$collegeName', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]).toArray() : [],
      followerIds.length > 0 ? db.collection('user_tribe_memberships').aggregate([
        { $match: { userId: { $in: followerIds }, status: 'ACTIVE' } },
        { $lookup: { from: 'tribes', localField: 'tribeId', foreignField: 'id', as: 'tribe' } },
        { $unwind: { path: '$tribe', preserveNullAndEmptyArrays: true } },
        { $group: { _id: '$tribe.tribeName', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]).toArray() : [],
      followerIds.length > 0 ? db.collection('users').aggregate([
        { $match: { id: { $in: followerIds }, gender: { $exists: true } } },
        { $group: { _id: '$gender', count: { $sum: 1 } } },
      ]).toArray() : [],
    ])

    // Most active followers (who engage most with your content)
    const activeFollowers = await db.collection('likes').aggregate([
      { $match: { contentAuthorId: user.id, createdAt: { $gte: since } } },
      { $group: { _id: '$userId', engagementCount: { $sum: 1 } } },
      { $sort: { engagementCount: -1 } },
      { $limit: 10 },
    ]).toArray()

    const activeIds = activeFollowers.map(a => a._id).filter(Boolean)
    const activeUsers = activeIds.length > 0
      ? await db.collection('users').find({ id: { $in: activeIds } }).toArray()
      : []
    const activeMap = Object.fromEntries(activeUsers.map(u => [u.id, sanitizeUser(u)]))

    return {
      data: {
        period,
        totalFollowers: followerIds.length,
        growth: {
          byDay: followerGrowth.map(d => ({ date: d._id, newFollowers: d.count })),
          totalNew: followerGrowth.reduce((s, d) => s + d.count, 0),
        },
        demographics: {
          colleges: collegeDist.map(c => ({ name: c._id, count: c.count })),
          tribes: tribeDist.map(t => ({ name: t._id || 'None', count: t.count })),
          gender: genderDist.map(g => ({ gender: g._id, count: g.count })),
        },
        topEngagers: activeFollowers.map(a => ({
          user: activeMap[a._id] || null,
          engagementCount: a.engagementCount,
        })),
      },
    }
  }

  // ========================
  // GET /analytics/reach — Reach & impressions time series
  // ========================
  if (route === 'analytics/reach' && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const period = url.searchParams.get('period') || '30d'
    const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : 90
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000)

    // Profile visits by day
    const profileVisitsByDay = await db.collection('profile_visits')
      .find({ profileId: user.id, day: { $gte: since.toISOString().slice(0, 10) } })
      .sort({ day: 1 })
      .toArray()

    // Content views aggregate by day
    const contentViewsByDay = await db.collection('analytics_events').aggregate([
      { $match: { eventType: { $in: ['CONTENT_VIEW', 'IMPRESSION'] }, createdAt: { $gte: since } } },
      { $lookup: { from: 'content_items', localField: 'targetId', foreignField: 'id', as: 'content' } },
      { $match: { 'content.authorId': user.id } },
      { $group: { _id: '$day', views: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).toArray()

    // Top performing content in period
    const topContent = await db.collection('content_items')
      .find({ authorId: user.id, kind: 'POST', createdAt: { $gte: since }, visibility: 'PUBLIC' })
      .sort({ viewCount: -1 })
      .limit(5)
      .project({ _id: 0, id: 1, caption: 1, viewCount: 1, likeCount: 1, createdAt: 1 })
      .toArray()

    return {
      data: {
        period,
        profileVisits: {
          byDay: profileVisitsByDay.map(d => ({ date: d.day, visits: d.visitCount || 0 })),
          total: profileVisitsByDay.reduce((s, d) => s + (d.visitCount || 0), 0),
        },
        contentReach: {
          byDay: contentViewsByDay.map(d => ({ date: d._id, views: d.views })),
          total: contentViewsByDay.reduce((s, d) => s + d.views, 0),
        },
        topContent: topContent.map(c => ({
          id: c.id,
          caption: (c.caption || '').slice(0, 80),
          views: c.viewCount || 0,
          likes: c.likeCount || 0,
          createdAt: c.createdAt,
        })),
      },
    }
  }

  // ========================
  // GET /analytics/profile-visits — Profile visit details
  // ========================
  if (route === 'analytics/profile-visits' && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const period = url.searchParams.get('period') || '30d'
    const periodDays = period === '7d' ? 7 : period === '30d' ? 30 : 90
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000)

    const visits = await db.collection('profile_visits')
      .find({ profileId: user.id, day: { $gte: since.toISOString().slice(0, 10) } })
      .sort({ day: -1 })
      .toArray()

    const totalVisits = visits.reduce((s, v) => s + (v.visitCount || 0), 0)
    const avgPerDay = visits.length > 0 ? Math.round(totalVisits / visits.length) : 0

    // Get recent unique visitors
    const recentVisitors = await db.collection('analytics_events')
      .find({ eventType: 'PROFILE_VISIT', targetId: user.id, viewerId: { $ne: null }, createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray()

    const visitorIds = [...new Set(recentVisitors.map(v => v.viewerId).filter(Boolean))]
    const visitors = visitorIds.length > 0
      ? await db.collection('users').find({ id: { $in: visitorIds.slice(0, 20) } }).toArray()
      : []

    return {
      data: {
        period,
        totalVisits,
        avgPerDay,
        byDay: visits.map(v => ({ date: v.day, visits: v.visitCount || 0 })),
        recentVisitors: visitors.map(v => sanitizeUser(v)),
      },
    }
  }

  // ========================
  // GET /analytics/reels — Reel performance analytics
  // ========================
  if (route === 'analytics/reels' && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)

    const reels = await db.collection('reels')
      .find({ creatorId: user.id, status: { $ne: 'REMOVED' } })
      .sort({ viewCount: -1, likeCount: -1 })
      .limit(limit)
      .toArray()

    const totalViews = reels.reduce((s, r) => s + (r.viewCount || 0), 0)
    const totalLikes = reels.reduce((s, r) => s + (r.likeCount || 0), 0)

    return {
      data: {
        totalReels: reels.length,
        totalViews,
        totalLikes,
        avgViewsPerReel: reels.length > 0 ? Math.round(totalViews / reels.length) : 0,
        items: reels.map(r => ({
          id: r.id,
          caption: (r.caption || '').slice(0, 80),
          views: r.viewCount || 0,
          likes: r.likeCount || 0,
          comments: r.commentCount || 0,
          shares: r.shareCount || 0,
          saves: r.saveCount || 0,
          createdAt: r.createdAt,
          engagementRate: (r.viewCount || 0) > 0 ? Math.round(((r.likeCount || 0) + (r.commentCount || 0)) / r.viewCount * 10000) / 100 : 0,
        })),
      },
    }
  }

  return null
}
