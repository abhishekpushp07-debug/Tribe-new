/**
 * Tribe — Content Quality Scoring Engine
 *
 * Auto-detect spam/low-quality content using multi-signal rule-based scoring.
 * Integrates with Smart Feed to penalize low-quality posts.
 *
 * Score range: 0–100
 *   90–100: High quality (boosted in feed)
 *   60–89:  Normal quality
 *   30–59:  Low quality (deprioritized)
 *   0–29:   Spam/shadow-banned (hidden from feeds)
 */

import { v4 as uuidv4 } from 'uuid'
import { requireAuth, requireRole } from '../auth-utils.js'
import { ErrorCode } from '../constants.js'

// Quality scoring weights
const QUALITY_WEIGHTS = {
  captionQuality: 20,    // max 20 pts
  mediaPresence: 15,     // max 15 pts
  hashtagHealth: 15,     // max 15 pts
  authorReputation: 20,  // max 20 pts
  engagementRatio: 15,   // max 15 pts
  freshness: 10,         // max 10 pts
  reportPenalty: 5,      // max -5 pts (deduction)
}

const SHADOW_BAN_THRESHOLD = 25
const LOW_QUALITY_THRESHOLD = 50

/**
 * Score a post's quality (0–100).
 */
export function scoreContentQuality(post, authorStats = {}) {
  let score = 0
  const breakdown = {}

  // 1. Caption Quality (0–20)
  const caption = (post.caption || post.text || '').trim()
  const captionLen = caption.length
  let captionScore = 0
  if (captionLen >= 20 && captionLen <= 2000) captionScore = 15
  else if (captionLen >= 5 && captionLen < 20) captionScore = 8
  else if (captionLen > 2000) captionScore = 10
  else if (captionLen === 0 && (post.media?.length > 0 || post.mediaId)) captionScore = 5
  // Bonus: has line breaks/paragraphs (structured text)
  if (caption.includes('\n') && captionLen > 50) captionScore += 3
  // Penalty: ALL CAPS
  if (captionLen > 10 && caption === caption.toUpperCase()) captionScore -= 5
  // Penalty: excessive emojis (>30% of text)
  const emojiCount = (caption.match(/[\u{1F600}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu) || []).length
  if (captionLen > 0 && emojiCount / captionLen > 0.3) captionScore -= 3
  captionScore = Math.max(0, Math.min(20, captionScore))
  breakdown.captionQuality = captionScore
  score += captionScore

  // 2. Media Presence (0–15)
  let mediaScore = 0
  if (post.media?.length > 0 || post.mediaId || post.mediaUrl) mediaScore = 12
  if (post.media?.length > 1) mediaScore = 15 // carousel
  if (post.mediaType === 'VIDEO' || post.media?.[0]?.type === 'VIDEO') mediaScore = 15 // video
  breakdown.mediaPresence = mediaScore
  score += mediaScore

  // 3. Hashtag Health (0–15)
  const hashtags = post.hashtags || []
  let hashtagScore = 10 // default: no hashtags is fine
  if (hashtags.length >= 1 && hashtags.length <= 10) hashtagScore = 15
  else if (hashtags.length > 10 && hashtags.length <= 20) hashtagScore = 8
  else if (hashtags.length > 20) hashtagScore = 2 // hashtag spam
  // Penalty: repetitive hashtags
  const uniqueTags = new Set(hashtags.map(t => t.toLowerCase()))
  if (uniqueTags.size < hashtags.length * 0.7) hashtagScore -= 5
  hashtagScore = Math.max(0, Math.min(15, hashtagScore))
  breakdown.hashtagHealth = hashtagScore
  score += hashtagScore

  // 4. Author Reputation (0–20)
  let authorScore = 10 // default baseline
  const totalPosts = authorStats.totalPosts || 0
  const avgEngagement = authorStats.avgEngagement || 0
  const reportCount = authorStats.reportCount || 0
  if (totalPosts > 10) authorScore += 3
  if (totalPosts > 50) authorScore += 2
  if (avgEngagement > 5) authorScore += 3
  if (reportCount === 0) authorScore += 2
  if (reportCount > 5) authorScore -= 5
  if (reportCount > 20) authorScore -= 10
  authorScore = Math.max(0, Math.min(20, authorScore))
  breakdown.authorReputation = authorScore
  score += authorScore

  // 5. Engagement Ratio (0–15) — Only for posts with some age
  const ageHours = post.createdAt
    ? (Date.now() - (post.createdAt.getTime?.() || Date.parse(post.createdAt))) / 3600000
    : 0
  let engagementScore = 8 // default for new posts
  if (ageHours > 1) {
    const totalEngagement = (post.likeCount || 0) + (post.commentCount || 0) * 3 + (post.saveCount || 0) * 5
    const engRate = totalEngagement / Math.max(1, ageHours)
    if (engRate > 10) engagementScore = 15
    else if (engRate > 5) engagementScore = 12
    else if (engRate > 1) engagementScore = 10
    else if (engRate > 0) engagementScore = 6
    else engagementScore = 3
  }
  breakdown.engagementRatio = engagementScore
  score += engagementScore

  // 6. Freshness (0–10)
  let freshnessScore = 10
  if (ageHours > 168) freshnessScore = 3  // >7 days
  else if (ageHours > 48) freshnessScore = 6  // >2 days
  else if (ageHours > 24) freshnessScore = 8  // >1 day
  breakdown.freshness = freshnessScore
  score += freshnessScore

  // 7. Report Penalty (0 to -5)
  const postReports = post.reportCount || 0
  let reportPenalty = 0
  if (postReports >= 1) reportPenalty = -1
  if (postReports >= 3) reportPenalty = -3
  if (postReports >= 5) reportPenalty = -5
  breakdown.reportPenalty = reportPenalty
  score += reportPenalty

  score = Math.max(0, Math.min(100, score))

  return {
    score,
    grade: score >= 90 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : score >= 25 ? 'D' : 'F',
    isShadowBanned: score < SHADOW_BAN_THRESHOLD,
    isLowQuality: score < LOW_QUALITY_THRESHOLD,
    breakdown,
  }
}

/**
 * Batch-score content and update quality scores in DB.
 */
async function batchScoreContent(db, contentType = 'content_items', limit = 100) {
  const collection = contentType
  const items = await db.collection(collection)
    .find({ qualityScore: { $exists: false } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray()

  if (items.length === 0) return { scored: 0 }

  // Batch fetch author stats
  const authorIds = [...new Set(items.map(i => i.authorId || i.creatorId).filter(Boolean))]
  const authorStatsMap = {}
  if (authorIds.length > 0) {
    const [postCounts, reportCounts] = await Promise.all([
      db.collection(collection).aggregate([
        { $match: { authorId: { $in: authorIds } } },
        { $group: { _id: '$authorId', count: { $sum: 1 }, avgLikes: { $avg: '$likeCount' } } },
      ]).toArray(),
      db.collection('reports').aggregate([
        { $match: { reportedUserId: { $in: authorIds } } },
        { $group: { _id: '$reportedUserId', count: { $sum: 1 } } },
      ]).toArray(),
    ])
    const reportMap = Object.fromEntries(reportCounts.map(r => [r._id, r.count]))
    for (const stat of postCounts) {
      authorStatsMap[stat._id] = {
        totalPosts: stat.count,
        avgEngagement: stat.avgLikes || 0,
        reportCount: reportMap[stat._id] || 0,
      }
    }
  }

  // Score each item
  const ops = []
  let shadowBanned = 0
  let lowQuality = 0
  for (const item of items) {
    const authorId = item.authorId || item.creatorId
    const result = scoreContentQuality(item, authorStatsMap[authorId] || {})
    if (result.isShadowBanned) shadowBanned++
    if (result.isLowQuality) lowQuality++
    ops.push({
      updateOne: {
        filter: { id: item.id },
        update: {
          $set: {
            qualityScore: result.score,
            qualityGrade: result.grade,
            qualityBreakdown: result.breakdown,
            isShadowBanned: result.isShadowBanned,
            isLowQuality: result.isLowQuality,
            qualityScoredAt: new Date(),
          },
        },
      },
    })
  }

  if (ops.length > 0) {
    await db.collection(collection).bulkWrite(ops)
  }

  return { scored: items.length, shadowBanned, lowQuality }
}

export async function handleQuality(request, db, { method, path }) {
  const route = path.join('/')

  // ========================
  // POST /quality/score — Score a single post
  // ========================
  if (route === 'quality/score' && method === 'POST') {
    const user = await requireAuth(request, db)
    const body = await request.json()
    const { contentId, contentType } = body

    if (!contentId) return { error: 'contentId required', code: ErrorCode.VALIDATION, status: 400 }

    const collection = contentType === 'reels' ? 'reels' : 'content_items'
    const item = await db.collection(collection).findOne({ id: contentId })
    if (!item) return { error: 'Content not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Fetch author stats
    const authorId = item.authorId || item.creatorId
    const [postCount, reportCount] = await Promise.all([
      db.collection(collection).countDocuments({ authorId }),
      db.collection('reports').countDocuments({ reportedUserId: authorId }),
    ])

    const result = scoreContentQuality(item, { totalPosts: postCount, reportCount })

    // Update DB
    await db.collection(collection).updateOne({ id: contentId }, {
      $set: {
        qualityScore: result.score,
        qualityGrade: result.grade,
        qualityBreakdown: result.breakdown,
        isShadowBanned: result.isShadowBanned,
        isLowQuality: result.isLowQuality,
        qualityScoredAt: new Date(),
      },
    })

    return { data: { contentId, ...result } }
  }

  // ========================
  // POST /quality/batch — Batch score unscored content (admin)
  // ========================
  if (route === 'quality/batch' && method === 'POST') {
    const user = await requireAuth(request, db)
    const body = await request.json().catch(() => ({}))
    const limit = Math.min(parseInt(body.limit || '200'), 500)
    const contentType = body.contentType || 'content_items'

    const [postResults, reelResults] = await Promise.all([
      batchScoreContent(db, 'content_items', limit),
      batchScoreContent(db, 'reels', limit),
    ])

    return {
      data: {
        posts: postResults,
        reels: reelResults,
        total: postResults.scored + reelResults.scored,
      },
    }
  }

  // ========================
  // GET /quality/dashboard — Quality overview dashboard (admin)
  // ========================
  if (route === 'quality/dashboard' && method === 'GET') {
    const user = await requireAuth(request, db)

    const [gradeDistribution, shadowBannedCount, lowQualityCount, totalScored, topQuality, worstQuality] = await Promise.all([
      db.collection('content_items').aggregate([
        { $match: { qualityGrade: { $exists: true } } },
        { $group: { _id: '$qualityGrade', count: { $sum: 1 }, avgScore: { $avg: '$qualityScore' } } },
        { $sort: { _id: 1 } },
      ]).toArray(),
      db.collection('content_items').countDocuments({ isShadowBanned: true }),
      db.collection('content_items').countDocuments({ isLowQuality: true }),
      db.collection('content_items').countDocuments({ qualityScore: { $exists: true } }),
      db.collection('content_items')
        .find({ qualityScore: { $exists: true } })
        .sort({ qualityScore: -1 })
        .limit(5)
        .project({ _id: 0, id: 1, caption: 1, qualityScore: 1, qualityGrade: 1, qualityBreakdown: 1, authorId: 1 })
        .toArray(),
      db.collection('content_items')
        .find({ qualityScore: { $exists: true } })
        .sort({ qualityScore: 1 })
        .limit(5)
        .project({ _id: 0, id: 1, caption: 1, qualityScore: 1, qualityGrade: 1, qualityBreakdown: 1, authorId: 1 })
        .toArray(),
    ])

    return {
      data: {
        overview: {
          totalScored,
          shadowBannedCount,
          lowQualityCount,
          avgScore: gradeDistribution.reduce((s, g) => s + (g.avgScore || 0) * g.count, 0) / Math.max(1, totalScored),
        },
        gradeDistribution: Object.fromEntries(gradeDistribution.map(g => [g._id, { count: g.count, avgScore: Math.round(g.avgScore) }])),
        topQuality: topQuality.map(p => ({ ...p, caption: (p.caption || '').slice(0, 80) })),
        worstQuality: worstQuality.map(p => ({ ...p, caption: (p.caption || '').slice(0, 80) })),
        thresholds: { shadowBan: SHADOW_BAN_THRESHOLD, lowQuality: LOW_QUALITY_THRESHOLD },
      },
    }
  }

  // ========================
  // GET /quality/check/:contentId — Check quality score for a specific post
  // ========================
  if (path[0] === 'quality' && path[1] === 'check' && path[2] && method === 'GET') {
    const user = await requireAuth(request, db)
    const contentId = path[2]

    let item = await db.collection('content_items').findOne({ id: contentId }, { projection: { _id: 0 } })
    if (!item) item = await db.collection('reels').findOne({ id: contentId }, { projection: { _id: 0 } })
    if (!item) return { error: 'Content not found', code: ErrorCode.NOT_FOUND, status: 404 }

    if (item.qualityScore !== undefined) {
      return {
        data: {
          contentId,
          score: item.qualityScore,
          grade: item.qualityGrade,
          breakdown: item.qualityBreakdown,
          isShadowBanned: item.isShadowBanned,
          isLowQuality: item.isLowQuality,
          scoredAt: item.qualityScoredAt,
        },
      }
    }

    // Score on the fly
    const authorId = item.authorId || item.creatorId
    const postCount = await db.collection('content_items').countDocuments({ authorId })
    const reportCount = await db.collection('reports').countDocuments({ reportedUserId: authorId })
    const result = scoreContentQuality(item, { totalPosts: postCount, reportCount })

    return { data: { contentId, ...result, scoredAt: null } }
  }

  return null
}
