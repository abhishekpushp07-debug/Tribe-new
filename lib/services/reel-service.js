/**
 * Reel Service — Business Logic Layer
 *
 * Extracted from reels.js handler (1708 lines).
 * Handles: reel scoring, visibility checks, viewer personalization,
 * feed construction, block integration, and creator tools.
 *
 * Handler remains thin: parses request, calls service, formats response.
 */

// ========== CONFIG ==========
export const ReelConfig = {
  MAX_DURATION_MS: 90_000,
  MAX_CAPTION_LEN: 2200,
  MAX_HASHTAGS: 30,
  MAX_MENTIONS: 20,
  CREATE_RATE_LIMIT: 20,
  COMMENT_RATE_LIMIT: 60,
  REPORT_AUTO_HOLD: 3,
  ALLOWED_VISIBILITIES: ['PUBLIC', 'FOLLOWERS', 'PRIVATE'],
  ALLOWED_MEDIA_STATUSES: ['UPLOADING', 'PROCESSING', 'READY', 'FAILED'],
  ALLOWED_REEL_STATUSES: ['DRAFT', 'PUBLISHED', 'ARCHIVED', 'REMOVED', 'HELD'],
  ALLOWED_MODERATION_STATUSES: ['PENDING', 'APPROVED', 'HELD', 'REMOVED'],
  FEED_LIMIT: 20,
  FEED_MAX: 200,
}

export const ReelEvent = {
  VIEWED: 'reel.viewed',
  LIKED: 'reel.liked',
  COMMENTED: 'reel.commented',
  SAVED: 'reel.saved',
  SHARED: 'reel.shared',
  PUBLISHED: 'reel.published',
}

// ========== BLOCK & PRIVACY ==========

/**
 * Bidirectional block check.
 */
export async function isBlocked(db, userA, userB) {
  if (!userA || !userB || userA === userB) return false
  const block = await db.collection('blocks').findOne({
    $or: [
      { blockerId: userA, blockedId: userB },
      { blockerId: userB, blockedId: userA },
    ],
  })
  return !!block
}

/**
 * Batch block check — returns Set of blocked user IDs.
 */
export async function batchBlockCheck(db, userId, otherIds) {
  if (!otherIds.length) return new Set()
  const blocks = await db.collection('blocks').find({
    $or: [
      { blockerId: userId, blockedId: { $in: otherIds } },
      { blockedId: userId, blockerId: { $in: otherIds } },
    ],
  }).toArray()
  const blockedSet = new Set()
  for (const b of blocks) {
    blockedSet.add(b.blockerId === userId ? b.blockedId : b.blockerId)
  }
  return blockedSet
}

/**
 * Check if viewer can view a reel (privacy + moderation + block).
 */
export async function canViewReel(db, reel, viewerId) {
  if (['REMOVED', 'FAILED'].includes(reel.status)) return false
  if (reel.status === 'HELD') return viewerId === reel.creatorId
  if (reel.status === 'DRAFT') return viewerId === reel.creatorId
  if (reel.status === 'ARCHIVED') return viewerId === reel.creatorId
  if (reel.mediaStatus !== 'READY') return viewerId === reel.creatorId
  if (viewerId && await isBlocked(db, reel.creatorId, viewerId)) return false
  if (reel.visibility === 'PUBLIC') return true
  if (reel.visibility === 'PRIVATE') return viewerId === reel.creatorId
  if (reel.visibility === 'FOLLOWERS') {
    if (!viewerId) return false
    if (viewerId === reel.creatorId) return true
    const follow = await db.collection('follows').findOne({ followerId: viewerId, followingId: reel.creatorId })
    return !!follow
  }
  return false
}

// ========== SCORING ==========

/**
 * Compute ranking score for a reel.
 * Factors: freshness decay, engagement rate, completion rate, replay rate, reports.
 */
export function computeReelScore(reel) {
  const hoursSincePublish = (Date.now() - new Date(reel.publishedAt || reel.createdAt).getTime()) / 3_600_000
  const freshness = 1 / (1 + hoursSincePublish / 24)
  const views = Math.max(reel.viewCount || 0, 1)
  const engagement = ((reel.likeCount || 0) * 1 + (reel.saveCount || 0) * 2 + (reel.commentCount || 0) * 1.5 + (reel.shareCount || 0) * 3) / views
  const completionRate = (reel.completionCount || 0) / views
  const replayRate = (reel.replayCount || 0) / views
  const quality = completionRate * 0.5 + replayRate * 0.3
  const penalty = (reel.reportCount || 0) * 0.1
  return Math.round((freshness * 40 + engagement * 30 + quality * 30 - penalty * 10) * 1000) / 1000
}

// ========== VIEWER PERSONALIZATION ==========

/**
 * Add personalized fields to reel for viewer (liked, saved, hidden, notInterested).
 */
export async function addViewerFields(db, reel, viewerId) {
  if (!viewerId) return reel
  const [liked, saved, hidden, notInterested] = await Promise.all([
    db.collection('reel_likes').findOne({ reelId: reel.id, userId: viewerId }),
    db.collection('reel_saves').findOne({ reelId: reel.id, userId: viewerId }),
    db.collection('reel_hidden').findOne({ reelId: reel.id, userId: viewerId }),
    db.collection('reel_not_interested').findOne({ reelId: reel.id, userId: viewerId }),
  ])
  return {
    ...reel,
    likedByMe: !!liked,
    savedByMe: !!saved,
    hiddenByMe: !!hidden,
    notInterestedByMe: !!notInterested,
  }
}

// ========== FEED CONSTRUCTION ==========

/**
 * Build discovery feed for reels — scored, block-filtered, personalized.
 */
export async function buildReelFeed(db, { viewerId, limit, cursor, blockedCreatorIds }) {
  const query = {
    status: 'PUBLISHED',
    visibility: 'PUBLIC',
    mediaStatus: 'READY',
    moderationStatus: { $ne: 'REMOVED' },
  }

  if (blockedCreatorIds?.size > 0) {
    query.creatorId = { $nin: [...blockedCreatorIds] }
  }

  // Exclude hidden/not-interested reels
  if (viewerId) {
    const [hidden, notInterested] = await Promise.all([
      db.collection('reel_hidden').find({ userId: viewerId }).project({ reelId: 1, _id: 0 }).toArray(),
      db.collection('reel_not_interested').find({ userId: viewerId }).project({ reelId: 1, _id: 0 }).toArray(),
    ])
    const excludeIds = [...hidden.map(h => h.reelId), ...notInterested.map(n => n.reelId)]
    if (excludeIds.length > 0) {
      query.id = { $nin: excludeIds }
    }
  }

  if (cursor) {
    // Cursor format: "score|id"
    const parts = cursor.split('|')
    if (parts.length === 2) {
      const cursorScore = parseFloat(parts[0])
      const cursorId = parts[1]
      query.$or = [
        { _feedScore: { $lt: cursorScore } },
        { _feedScore: cursorScore, id: { $lt: cursorId } },
      ]
    }
  }

  const reels = await db.collection('reels')
    .find(query)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .toArray()

  // Score and sort
  const scored = reels.map(r => ({
    ...r,
    _feedScore: computeReelScore(r),
  }))
  scored.sort((a, b) => b._feedScore - a._feedScore)

  const hasMore = scored.length > limit
  return { items: scored.slice(0, limit), hasMore }
}

/**
 * Build following feed for reels.
 */
export async function buildFollowingReelFeed(db, { userId, limit, cursor }) {
  const follows = await db.collection('follows').find({ followerId: userId }).toArray()
  const followeeIds = follows.map(f => f.followeeId)
  followeeIds.push(userId)

  const blockedSet = await batchBlockCheck(db, userId, followeeIds)
  const safeIds = followeeIds.filter(id => !blockedSet.has(id))

  const query = {
    creatorId: { $in: safeIds },
    status: 'PUBLISHED',
    visibility: { $in: ['PUBLIC', 'FOLLOWERS'] },
    mediaStatus: 'READY',
  }
  if (cursor) query.createdAt = { $lt: new Date(cursor) }

  const reels = await db.collection('reels')
    .find(query)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .toArray()

  const hasMore = reels.length > limit
  return { items: reels.slice(0, limit), hasMore }
}

// ========== SANITIZERS ==========

export function sanitizeReel(reel) {
  if (!reel) return null
  const { _id, ...clean } = reel
  return clean
}

export function sanitizeReels(reels) {
  return reels.map(r => sanitizeReel(r)).filter(Boolean)
}

export function sanitizeComment(c) {
  if (!c) return null
  const { _id, ...clean } = c
  return clean
}
