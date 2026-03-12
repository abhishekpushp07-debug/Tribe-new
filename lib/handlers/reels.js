/**
 * Tribe — Stage 10: World's Best Reels Backend
 * Instagram-grade short-form video backend
 *
 * 39 endpoints, 12 collections, 36 indexes
 * Features: creation, feeds, interactions, watch metrics, moderation,
 *   creator tools, media pipeline, social (remix/series), block integration
 */

import { v4 as uuidv4 } from 'uuid'
import { requireAuth, authenticate, requireRole, writeAudit, sanitizeUser, parsePagination, createNotification } from '../auth-utils.js'
import { ErrorCode, Config, NotificationType } from '../constants.js'
import { cache, CacheTTL, CacheNS, invalidateOnEvent } from '../cache.js'
import { rankReels, buildAffinityContext } from '../services/feed-ranking.js'
import { moderateCreateContent } from '../moderation/middleware/moderate-create-content.js'
import { publishStoryEvent, StoryEventType } from '../realtime.js'
import { checkEngagementAbuse, logSuspiciousAction, ActionType } from '../services/anti-abuse-service.js'
import {
  isBlocked as isBlockedService, batchBlockCheck as batchBlockCheckService,
  canViewReel as canViewReelService, computeReelScore as computeReelScoreService,
  addViewerFields as addViewerFieldsService,
  sanitizeReel as sanitizeReelService, sanitizeReels as sanitizeReelsService,
  sanitizeComment as sanitizeCommentService,
} from '../services/reel-service.js'

// ========== CONSTANTS ==========
const REEL_MAX_DURATION_MS = 90_000 // 90 seconds
const REEL_MAX_CAPTION_LEN = 2200
const REEL_MAX_HASHTAGS = 30
const REEL_MAX_MENTIONS = 20
const REEL_CREATE_RATE_LIMIT = 20 // per hour
const REEL_COMMENT_RATE_LIMIT = 60 // per hour
const REEL_REPORT_AUTO_HOLD = 3
const ALLOWED_VISIBILITIES = ['PUBLIC', 'FOLLOWERS', 'PRIVATE']
const ALLOWED_MEDIA_STATUSES = ['UPLOADING', 'PROCESSING', 'READY', 'FAILED']
const ALLOWED_REEL_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED', 'REMOVED', 'HELD']
const ALLOWED_MODERATION_STATUSES = ['PENDING', 'APPROVED', 'HELD', 'REMOVED']
const REEL_FEED_LIMIT = 20
const REEL_FEED_MAX = 200

// ========== REEL EVENT TYPES ==========
const ReelEvent = {
  VIEWED: 'reel.viewed',
  LIKED: 'reel.liked',
  COMMENTED: 'reel.commented',
  SAVED: 'reel.saved',
  SHARED: 'reel.shared',
  PUBLISHED: 'reel.published',
}

// ========== HELPERS ==========

function isAdmin(user) {
  return ['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)
}

function sanitizeReel(reel) {
  if (!reel) return null
  const { _id, ...clean } = reel
  return clean
}

function sanitizeReels(reels) {
  return reels.map(r => sanitizeReel(r)).filter(Boolean)
}

function sanitizeComment(c) {
  if (!c) return null
  const { _id, ...clean } = c
  return clean
}

/** Check if bidirectional block exists */
async function isBlocked(db, userA, userB) {
  if (!userA || !userB || userA === userB) return false
  const block = await db.collection('blocks').findOne({
    $or: [
      { blockerId: userA, blockedId: userB },
      { blockerId: userB, blockedId: userA },
    ],
  })
  return !!block
}

/** Batch block check — returns Set of blocked user IDs */
async function batchBlockCheck(db, userId, otherIds) {
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

/** Check if viewer can view a reel (privacy + moderation + block) */
async function canViewReel(db, reel, viewerId) {
  // REMOVED/FAILED → nobody except admin
  if (['REMOVED', 'FAILED'].includes(reel.status)) return false
  // HELD → only creator or admin
  if (reel.status === 'HELD') return viewerId === reel.creatorId
  // DRAFT → only creator
  if (reel.status === 'DRAFT') return viewerId === reel.creatorId
  // ARCHIVED → only creator
  if (reel.status === 'ARCHIVED') return viewerId === reel.creatorId
  // PUBLISHED checks:
  if (reel.mediaStatus !== 'READY') return viewerId === reel.creatorId
  // Block check
  if (viewerId && await isBlocked(db, reel.creatorId, viewerId)) return false
  // Visibility check
  if (reel.visibility === 'PUBLIC') return true
  if (reel.visibility === 'PRIVATE') return viewerId === reel.creatorId
  if (reel.visibility === 'FOLLOWERS') {
    if (!viewerId) return false
    if (viewerId === reel.creatorId) return true
    const follow = await db.collection('follows').findOne({ followerId: viewerId, followeeId: reel.creatorId })
    return !!follow
  }
  return false
}

/** Compute ranking score for a reel */
function computeReelScore(reel) {
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

/** Publish a reel event (best-effort, non-blocking) */
function publishReelEvent(creatorId, event) {
  publishStoryEvent(creatorId, event).catch(() => {})
}

/** Add personalized fields to reel for viewer */
async function addViewerFields(db, reel, viewerId) {
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

// ========== MAIN HANDLER ==========

export async function handleReels(path, method, request, db) {
  const route = path.join('/')

  // ========================
  // POST /reels — Create reel (draft or publish)
  // ========================
  if (path[0] === 'reels' && path.length === 1 && method === 'POST') {
    const user = await requireAuth(request, db)
    if (user.ageStatus !== 'ADULT') {
      return { error: 'Age verification required', code: ErrorCode.AGE_REQUIRED, status: 403 }
    }

    // Rate limit
    const oneHourAgo = new Date(Date.now() - 3_600_000)
    const recentCount = await db.collection('reels').countDocuments({
      creatorId: user.id, createdAt: { $gte: oneHourAgo },
    })
    if (recentCount >= REEL_CREATE_RATE_LIMIT) {
      return { error: `Rate limit: max ${REEL_CREATE_RATE_LIMIT} reels per hour`, code: ErrorCode.RATE_LIMITED, status: 429 }
    }

    const body = await request.json()
    const {
      caption, hashtags, mentions, audioMeta, durationMs,
      mediaUrl, mediaId, thumbnailUrl, posterFrameUrl,
      visibility = 'PUBLIC', isDraft = false,
      syntheticDeclaration = false, brandedContent = false,
      remixOf, seriesId, seriesOrder,
      variants,
    } = body

    // Validation
    if (caption && caption.length > REEL_MAX_CAPTION_LEN) {
      return { error: `Caption max ${REEL_MAX_CAPTION_LEN} chars`, code: ErrorCode.VALIDATION, status: 400 }
    }
    if (hashtags && hashtags.length > REEL_MAX_HASHTAGS) {
      return { error: `Max ${REEL_MAX_HASHTAGS} hashtags`, code: ErrorCode.VALIDATION, status: 400 }
    }
    if (mentions && mentions.length > REEL_MAX_MENTIONS) {
      return { error: `Max ${REEL_MAX_MENTIONS} mentions`, code: ErrorCode.VALIDATION, status: 400 }
    }
    if (durationMs && (durationMs < 1000 || durationMs > REEL_MAX_DURATION_MS)) {
      return { error: `Duration must be 1-${REEL_MAX_DURATION_MS / 1000}s`, code: ErrorCode.VALIDATION, status: 400 }
    }
    if (!ALLOWED_VISIBILITIES.includes(visibility)) {
      return { error: `Visibility must be: ${ALLOWED_VISIBILITIES.join(', ')}`, code: ErrorCode.VALIDATION, status: 400 }
    }

    // Validate remix reference
    if (remixOf) {
      if (!remixOf.reelId || !['REMIX', 'DUET', 'STITCH'].includes(remixOf.type)) {
        return { error: 'remixOf requires reelId and type (REMIX|DUET|STITCH)', code: ErrorCode.VALIDATION, status: 400 }
      }
      const origReel = await db.collection('reels').findOne({ id: remixOf.reelId, status: 'PUBLISHED' })
      if (!origReel) {
        return { error: 'Original reel not found or not published', code: ErrorCode.NOT_FOUND, status: 404 }
      }
    }

    // Content moderation on caption
    let moderationStatus = 'APPROVED'
    if (caption) {
      try {
        const modResult = await moderateCreateContent(db, {
          entityType: 'reel',
          entityId: null,
          actorUserId: user.id,
          text: caption,
          metadata: { route: 'POST /reels' },
        })
        if (modResult && modResult.decision?.action === 'ESCALATE') moderationStatus = 'HELD'
      } catch (err) {
        if (err.details?.code === 'CONTENT_REJECTED_BY_MODERATION') {
          return { error: 'Reel caption flagged by content safety filter', code: ErrorCode.VALIDATION, status: 400 }
        }
        const { default: logger } = await import('@/lib/logger')
        logger.warn('MODERATION', 'reel_caption_moderation_fail', { error: err.message })
      }
    }

    // Resolve media from mediaId (Supabase) or fall back to mediaUrl (legacy)
    let resolvedPlaybackUrl = mediaUrl || null
    let resolvedMediaStatus = mediaUrl ? 'READY' : 'UPLOADING'
    let resolvedMediaAsset = null

    if (mediaId) {
      const asset = await db.collection('media_assets').findOne({
        id: mediaId, ownerId: user.id, isDeleted: { $ne: true },
      })
      if (!asset) {
        return { error: 'Media asset not found or not owned by you', code: ErrorCode.NOT_FOUND, status: 404 }
      }
      if (asset.status !== 'READY') {
        return { error: 'Media upload not complete. Call /media/upload-complete first.', code: ErrorCode.INVALID_STATE, status: 400 }
      }
      // Reels require video media
      if (asset.kind === 'IMAGE' || (asset.mimeType && asset.mimeType.startsWith('image/'))) {
        return { error: 'Reels require video media, not images', code: ErrorCode.VALIDATION, status: 400 }
      }
      resolvedPlaybackUrl = asset.publicUrl || `/api/media/${asset.id}`
      resolvedMediaStatus = 'READY'
      resolvedMediaAsset = asset
    }

    const now = new Date()
    const reel = {
      id: uuidv4(),
      creatorId: user.id,
      collegeId: user.collegeId || null,
      tribeId: user.tribeId || null,
      caption: caption?.trim() || null,
      hashtags: (hashtags || []).map(h => h.toLowerCase().replace(/^#/, '')).slice(0, REEL_MAX_HASHTAGS),
      mentions: (mentions || []).slice(0, REEL_MAX_MENTIONS),
      audioMeta: audioMeta || null,
      durationMs: durationMs || (resolvedMediaAsset?.duration ? resolvedMediaAsset.duration * 1000 : null),
      mediaStatus: resolvedMediaStatus,
      mediaId: mediaId || null,
      playbackUrl: resolvedPlaybackUrl,
      thumbnailUrl: thumbnailUrl || null,
      posterFrameUrl: posterFrameUrl || null,
      variants: variants || [],
      visibility,
      moderationStatus,
      syntheticDeclaration: !!syntheticDeclaration,
      brandedContent: !!brandedContent,
      status: isDraft ? 'DRAFT' : (moderationStatus === 'HELD' ? 'HELD' : 'PUBLISHED'),
      remixOf: remixOf || null,
      collabCreators: [],
      seriesId: seriesId || null,
      seriesOrder: seriesOrder ?? null,
      pinnedToProfile: false,
      likeCount: 0,
      commentCount: 0,
      saveCount: 0,
      shareCount: 0,
      viewCount: 0,
      uniqueViewerCount: 0,
      impressionCount: 0,
      completionCount: 0,
      avgWatchTimeMs: 0,
      replayCount: 0,
      reportCount: 0,
      score: 0,
      createdAt: now,
      updatedAt: now,
      publishedAt: isDraft ? null : now,
      removedAt: null,
      heldAt: moderationStatus === 'HELD' ? now : null,
      archivedAt: null,
    }

    if (!isDraft) {
      reel.score = computeReelScore(reel)
    }

    await db.collection('reels').insertOne(reel)

    // Create processing job if no media URL provided
    if (!mediaUrl) {
      await db.collection('reel_processing_jobs').insertOne({
        id: uuidv4(),
        reelId: reel.id,
        creatorId: user.id,
        status: 'PENDING',
        attempts: 0,
        maxAttempts: 3,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        failureReason: null,
      })
    }

    await writeAudit(db, 'REEL_CREATED', user.id, 'REEL', reel.id, {
      status: reel.status, visibility, moderationStatus, isDraft,
    })

    if (!isDraft && reel.status === 'PUBLISHED') {
      publishReelEvent(user.id, { type: ReelEvent.PUBLISHED, reelId: reel.id })
    }

    return { data: { reel: sanitizeReel(reel) }, status: 201 }
  }

  // ========================
  // GET /reels/feed — Main discovery feed
  // ========================
  if (path[0] === 'reels' && path[1] === 'feed' && path.length === 2 && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || REEL_FEED_LIMIT), 50)
    const cursor = url.searchParams.get('cursor')

    // Cache first page of reel feed for non-cursored requests (15s TTL)
    const reelCacheKey = !cursor ? `reel_feed:${user.id}:${limit}` : null
    if (reelCacheKey) {
      const cachedReels = await cache.get(CacheNS.REEL_FEED, reelCacheKey)
      if (cachedReels) return { data: cachedReels }
    }

    const query = {
      status: 'PUBLISHED',
      mediaStatus: 'READY',
      moderationStatus: { $in: ['APPROVED', 'PENDING'] },
      visibility: 'PUBLIC',
    }
    if (cursor) {
      // B6-P2: Compound cursor with tie-breaker to prevent duplicate/missing items
      const [cursorScore, cursorId] = cursor.split('|')
      if (cursorId) {
        query.$or = [
          { score: { $lt: parseFloat(cursorScore) } },
          { score: parseFloat(cursorScore), id: { $lt: cursorId } },
        ]
      } else {
        // Backward compat: old cursor format without tie-breaker
        query.score = { $lt: parseFloat(cursorScore) }
      }
    }

    // Exclude blocked users
    const allBlocks = await db.collection('blocks').find({
      $or: [{ blockerId: user.id }, { blockedId: user.id }],
    }).toArray()
    const blockedIds = new Set(allBlocks.map(b => b.blockerId === user.id ? b.blockedId : b.blockerId))

    // Exclude hidden & not-interested
    const [hiddenDocs, niDocs] = await Promise.all([
      db.collection('reel_hidden').find({ userId: user.id }).project({ reelId: 1, _id: 0 }).toArray(),
      db.collection('reel_not_interested').find({ userId: user.id }).project({ reelId: 1, _id: 0 }).toArray(),
    ])
    const excludeReelIds = new Set([...hiddenDocs.map(d => d.reelId), ...niDocs.map(d => d.reelId)])

    if (blockedIds.size > 0) {
      query.creatorId = { $nin: [...blockedIds] }
    }
    if (excludeReelIds.size > 0) {
      query.id = { $nin: [...excludeReelIds] }
    }

    const reels = await db.collection('reels')
      .find(query)
      .sort({ score: -1, publishedAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = reels.length > limit
    const items = sanitizeReels(reels.slice(0, limit))

    // Batch: add creator info and viewer fields
    const creatorIds = [...new Set(items.map(r => r.creatorId))]
    const creators = creatorIds.length > 0
      ? await db.collection('users').find({ id: { $in: creatorIds } }).toArray()
      : []
    const creatorMap = Object.fromEntries(creators.map(u => [u.id, sanitizeUser(u)]))

    // Batch viewer fields
    const reelIds = items.map(r => r.id)
    const [likes, saves] = await Promise.all([
      db.collection('reel_likes').find({ reelId: { $in: reelIds }, userId: user.id }).toArray(),
      db.collection('reel_saves').find({ reelId: { $in: reelIds }, userId: user.id }).toArray(),
    ])
    const likedSet = new Set(likes.map(l => l.reelId))
    const savedSet = new Set(saves.map(s => s.reelId))

    const enriched = items.map(r => ({
      ...r,
      creator: creatorMap[r.creatorId] || null,
      likedByMe: likedSet.has(r.id),
      savedByMe: savedSet.has(r.id),
    }))

    // Smart ranking: apply algorithmic ranking on first page
    let finalItems = enriched
    if (!cursor) {
      const affinityCtx = await buildAffinityContext(db, user.id)
      finalItems = rankReels(enriched, affinityCtx).slice(0, limit)
    }

    // B6-P2: Compound cursor with score|id tie-breaker
    const lastItem = items[items.length - 1]
    const nextCursor = hasMore && lastItem ? `${lastItem.score}|${lastItem.id}` : null

    const reelFeedResult = {
        items: finalItems,
        pagination: {
          nextCursor,
          hasMore,
        },
        nextCursor,
        feedType: 'personalized',
        rankingAlgorithm: !cursor ? 'smart_reel_ranking_v1' : 'db_score',
      }
    if (reelCacheKey) await cache.set(CacheNS.REEL_FEED, reelCacheKey, reelFeedResult, CacheTTL.REEL_FEED)
    return { data: reelFeedResult }
  }

  // ========================
  // GET /reels/following — Following feed
  // ========================
  if (path[0] === 'reels' && path[1] === 'following' && path.length === 2 && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || REEL_FEED_LIMIT), 50)
    const cursor = url.searchParams.get('cursor')

    // Get followed users
    const follows = await db.collection('follows').find({ followerId: user.id }).project({ followingId: 1, _id: 0 }).toArray()
    const followedIds = follows.map(f => f.followingId)
    followedIds.push(user.id) // include own reels

    // Exclude blocked
    const blockedSet = await batchBlockCheck(db, user.id, followedIds)
    const eligibleIds = followedIds.filter(id => !blockedSet.has(id))

    if (eligibleIds.length === 0) {
      return { data: { items: [], pagination: { nextCursor: null, hasMore: false }, nextCursor: null } }
    }

    const query = {
      creatorId: { $in: eligibleIds },
      status: 'PUBLISHED',
      mediaStatus: 'READY',
      moderationStatus: { $in: ['APPROVED', 'PENDING'] },
    }
    if (cursor) {
      query.publishedAt = { $lt: new Date(cursor) }
    }

    const reels = await db.collection('reels')
      .find(query)
      .sort({ publishedAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = reels.length > limit
    const items = sanitizeReels(reels.slice(0, limit))

    const creatorIds = [...new Set(items.map(r => r.creatorId))]
    const creators = creatorIds.length > 0
      ? await db.collection('users').find({ id: { $in: creatorIds } }).toArray()
      : []
    const creatorMap = Object.fromEntries(creators.map(u => [u.id, sanitizeUser(u)]))

    const reelIds = items.map(r => r.id)
    const [likes, saves] = await Promise.all([
      db.collection('reel_likes').find({ reelId: { $in: reelIds }, userId: user.id }).toArray(),
      db.collection('reel_saves').find({ reelId: { $in: reelIds }, userId: user.id }).toArray(),
    ])
    const likedSet = new Set(likes.map(l => l.reelId))
    const savedSet = new Set(saves.map(s => s.reelId))

    const enriched = items.map(r => ({
      ...r,
      creator: creatorMap[r.creatorId] || null,
      likedByMe: likedSet.has(r.id),
      savedByMe: savedSet.has(r.id),
    }))

    return {
      data: {
        items: enriched,
        pagination: {
          nextCursor: hasMore ? items[items.length - 1].publishedAt?.toISOString() : null,
          hasMore,
        },
        nextCursor: hasMore ? items[items.length - 1].publishedAt?.toISOString() : null,
      },
    }
  }

  // ========================
  // GET /users/:userId/reels — Creator profile reels
  // ========================
  if (path[0] === 'users' && path.length === 3 && path[2] === 'reels' && method === 'GET') {
    const viewer = await authenticate(request, db)
    const targetUserId = path[1]
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
    const cursor = url.searchParams.get('cursor')

    // Block check
    if (viewer && await isBlocked(db, viewer.id, targetUserId)) {
      return { error: 'User not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    const isSelf = viewer?.id === targetUserId
    const query = { creatorId: targetUserId }

    if (isSelf) {
      query.status = { $in: ['PUBLISHED', 'DRAFT', 'ARCHIVED'] }
    } else {
      query.status = 'PUBLISHED'
      query.mediaStatus = 'READY'
      query.moderationStatus = { $in: ['APPROVED', 'PENDING'] }
    }
    if (cursor) {
      query.publishedAt = { $lt: new Date(cursor) }
    }

    const reels = await db.collection('reels')
      .find(query)
      .sort({ pinnedToProfile: -1, publishedAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = reels.length > limit
    const items = sanitizeReels(reels.slice(0, limit))

    // Get creator info
    const creator = await db.collection('users').findOne({ id: targetUserId })

    return {
      data: {
        creator: creator ? sanitizeUser(creator) : null,
        items,
        pagination: {
          nextCursor: hasMore ? items[items.length - 1].publishedAt?.toISOString() : null,
          hasMore,
        },
        nextCursor: hasMore ? items[items.length - 1].publishedAt?.toISOString() : null,
        total: await db.collection('reels').countDocuments({ creatorId: targetUserId, status: 'PUBLISHED' }),
      },
    }
  }

  // ========================
  // GET /reels/:id — Reel detail
  // ========================
  if (path[0] === 'reels' && path.length === 2 && method === 'GET' && !['feed', 'following', 'audio', 'trending', 'personalized'].includes(path[1])) {
    const viewer = await authenticate(request, db)
    const reelId = path[1]

    const reel = await db.collection('reels').findOne({ id: reelId })
    if (!reel) {
      return { error: 'Reel not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    if (reel.status === 'REMOVED') {
      return { error: 'This reel has been removed', code: ErrorCode.GONE, status: 410 }
    }

    // Admin can always view
    const isAdminUser = viewer && isAdmin(viewer)
    if (!isAdminUser) {
      const canView = await canViewReel(db, reel, viewer?.id)
      if (!canView) {
        return { error: 'You do not have access to this reel', code: ErrorCode.FORBIDDEN, status: 403 }
      }
    }

    // Track view (only for published, non-self views)
    if (viewer && viewer.id !== reel.creatorId && reel.status === 'PUBLISHED') {
      const viewResult = await db.collection('reel_views').updateOne(
        { reelId, viewerId: viewer.id },
        { $setOnInsert: { id: uuidv4(), reelId, viewerId: viewer.id, creatorId: reel.creatorId, viewedAt: new Date() } },
        { upsert: true }
      )
      if (viewResult.upsertedCount > 0) {
        // New unique viewer
        const newViewCount = await db.collection('reel_views').countDocuments({ reelId })
        await db.collection('reels').updateOne(
          { id: reelId },
          { $set: { viewCount: newViewCount, uniqueViewerCount: newViewCount, updatedAt: new Date() } }
        )
        publishReelEvent(reel.creatorId, {
          type: ReelEvent.VIEWED,
          reelId,
          viewer: { id: viewer.id, displayName: viewer.displayName },
          viewCount: newViewCount,
        })
      }
    }

    // Get creator
    const creator = await db.collection('users').findOne({ id: reel.creatorId })

    let result = { ...sanitizeReel(reel), creator: creator ? sanitizeUser(creator) : null }

    // Add viewer-personalized fields
    if (viewer) {
      result = await addViewerFields(db, result, viewer.id)
    }

    // Add remix source info
    if (reel.remixOf?.reelId) {
      const origReel = await db.collection('reels').findOne({ id: reel.remixOf.reelId })
      if (origReel) {
        const origCreator = await db.collection('users').findOne({ id: origReel.creatorId })
        result.remixSource = {
          reelId: origReel.id,
          creator: origCreator ? sanitizeUser(origCreator) : null,
          caption: origReel.caption,
        }
      }
    }

    return { data: { reel: result } }
  }

  // ========================
  // PATCH /reels/:id — Edit reel metadata
  // ========================
  if (path[0] === 'reels' && path.length === 2 && method === 'PATCH' && !path[1].startsWith('admin')) {
    const user = await requireAuth(request, db)
    const reelId = path[1]

    const reel = await db.collection('reels').findOne({ id: reelId })
    if (!reel) return { error: 'Reel not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (reel.creatorId !== user.id && !isAdmin(user)) {
      return { error: 'Not authorized', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const body = await request.json()
    const updates = {}
    const now = new Date()

    if (body.caption !== undefined) {
      if (body.caption && body.caption.length > REEL_MAX_CAPTION_LEN) {
        return { error: `Caption max ${REEL_MAX_CAPTION_LEN} chars`, code: ErrorCode.VALIDATION, status: 400 }
      }
      updates.caption = body.caption?.trim() || null
      // Re-moderate
      if (updates.caption) {
        try {
          const modResult = await moderateCreateContent(db, {
            entityType: 'reel',
            entityId: reelId,
            actorUserId: user.id,
            text: updates.caption,
            metadata: { route: 'PATCH /reels/:id' },
          })
          if (modResult?.decision?.action === 'ESCALATE') {
            updates.moderationStatus = 'HELD'
            updates.status = 'HELD'
            updates.heldAt = now
          }
        } catch (err) {
          if (err.details?.code === 'CONTENT_REJECTED_BY_MODERATION') {
            return { error: 'Updated caption flagged by content safety filter', code: ErrorCode.VALIDATION, status: 400 }
          }
          const { default: logger } = await import('@/lib/logger')
          logger.warn('MODERATION', 'reel_update_moderation_fail', { error: err.message })
        }
      }
    }
    if (body.hashtags !== undefined) {
      updates.hashtags = (body.hashtags || []).map(h => h.toLowerCase().replace(/^#/, '')).slice(0, REEL_MAX_HASHTAGS)
    }
    if (body.mentions !== undefined) {
      updates.mentions = (body.mentions || []).slice(0, REEL_MAX_MENTIONS)
    }
    if (body.visibility !== undefined) {
      if (!ALLOWED_VISIBILITIES.includes(body.visibility)) {
        return { error: `Visibility must be: ${ALLOWED_VISIBILITIES.join(', ')}`, code: ErrorCode.VALIDATION, status: 400 }
      }
      updates.visibility = body.visibility
    }
    if (body.syntheticDeclaration !== undefined) updates.syntheticDeclaration = !!body.syntheticDeclaration
    if (body.brandedContent !== undefined) updates.brandedContent = !!body.brandedContent
    if (body.thumbnailUrl !== undefined) updates.thumbnailUrl = body.thumbnailUrl
    if (body.posterFrameUrl !== undefined) updates.posterFrameUrl = body.posterFrameUrl

    updates.updatedAt = now

    await db.collection('reels').updateOne({ id: reelId }, { $set: updates })
    const updated = await db.collection('reels').findOne({ id: reelId })

    await writeAudit(db, 'REEL_EDITED', user.id, 'REEL', reelId, { fields: Object.keys(updates) })

    return { data: { reel: sanitizeReel(updated) } }
  }

  // ========================
  // DELETE /reels/:id — Delete reel (soft)
  // ========================
  if (path[0] === 'reels' && path.length === 2 && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const reelId = path[1]

    const reel = await db.collection('reels').findOne({ id: reelId })
    if (!reel) return { error: 'Reel not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (reel.creatorId !== user.id && !isAdmin(user)) {
      return { error: 'Not authorized', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    await db.collection('reels').updateOne(
      { id: reelId },
      { $set: { status: 'REMOVED', removedAt: new Date(), updatedAt: new Date() } }
    )

    await writeAudit(db, 'REEL_DELETED', user.id, 'REEL', reelId, { previousStatus: reel.status })

    return { data: { message: 'Reel removed', reelId } }
  }

  // ========================
  // POST /reels/:id/publish — Publish a draft
  // ========================
  if (path[0] === 'reels' && path.length === 3 && path[2] === 'publish' && method === 'POST') {
    const user = await requireAuth(request, db)
    const reelId = path[1]

    const reel = await db.collection('reels').findOne({ id: reelId })
    if (!reel) return { error: 'Reel not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (reel.creatorId !== user.id) {
      return { error: 'Not authorized', code: ErrorCode.FORBIDDEN, status: 403 }
    }
    if (reel.status !== 'DRAFT') {
      return { error: `Cannot publish reel with status ${reel.status}`, code: ErrorCode.INVALID_STATE, status: 400 }
    }
    if (reel.mediaStatus !== 'READY') {
      return { error: 'Media not ready. Wait for processing to complete.', code: ErrorCode.MEDIA_NOT_READY, status: 400 }
    }

    const now = new Date()
    const newStatus = reel.moderationStatus === 'HELD' ? 'HELD' : 'PUBLISHED'
    const score = computeReelScore({ ...reel, publishedAt: now })

    await db.collection('reels').updateOne(
      { id: reelId },
      { $set: { status: newStatus, publishedAt: now, score, updatedAt: now } }
    )

    await writeAudit(db, 'REEL_PUBLISHED', user.id, 'REEL', reelId, { from: 'DRAFT', to: newStatus })

    if (newStatus === 'PUBLISHED') {
      publishReelEvent(user.id, { type: ReelEvent.PUBLISHED, reelId })
    }

    return { data: { message: 'Reel published', reelId, status: newStatus } }
  }

  // ========================
  // POST /reels/:id/archive — Archive reel
  // ========================
  if (path[0] === 'reels' && path.length === 3 && path[2] === 'archive' && method === 'POST') {
    const user = await requireAuth(request, db)
    const reelId = path[1]

    const reel = await db.collection('reels').findOne({ id: reelId })
    if (!reel) return { error: 'Reel not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (reel.creatorId !== user.id) return { error: 'Not authorized', code: ErrorCode.FORBIDDEN, status: 403 }
    if (!['PUBLISHED', 'DRAFT'].includes(reel.status)) {
      return { error: `Cannot archive reel with status ${reel.status}`, code: ErrorCode.INVALID_STATE, status: 400 }
    }

    await db.collection('reels').updateOne(
      { id: reelId },
      { $set: { status: 'ARCHIVED', archivedAt: new Date(), updatedAt: new Date() } }
    )
    await writeAudit(db, 'REEL_ARCHIVED', user.id, 'REEL', reelId, {})

    return { data: { message: 'Reel archived', reelId } }
  }

  // ========================
  // POST /reels/:id/restore — Restore from archive
  // ========================
  if (path[0] === 'reels' && path.length === 3 && path[2] === 'restore' && method === 'POST') {
    const user = await requireAuth(request, db)
    const reelId = path[1]

    const reel = await db.collection('reels').findOne({ id: reelId })
    if (!reel) return { error: 'Reel not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (reel.creatorId !== user.id) return { error: 'Not authorized', code: ErrorCode.FORBIDDEN, status: 403 }
    if (reel.status !== 'ARCHIVED') {
      return { error: 'Only archived reels can be restored', code: ErrorCode.INVALID_STATE, status: 400 }
    }

    const newStatus = reel.moderationStatus === 'HELD' ? 'HELD' : 'PUBLISHED'
    await db.collection('reels').updateOne(
      { id: reelId },
      { $set: { status: newStatus, archivedAt: null, updatedAt: new Date() } }
    )
    await writeAudit(db, 'REEL_RESTORED', user.id, 'REEL', reelId, { from: 'ARCHIVED', to: newStatus })

    return { data: { message: 'Reel restored', reelId, status: newStatus } }
  }

  // ========================
  // POST /reels/:id/pin — Pin to profile
  // ========================
  if (path[0] === 'reels' && path.length === 3 && path[2] === 'pin' && method === 'POST') {
    const user = await requireAuth(request, db)
    const reel = await db.collection('reels').findOne({ id: path[1] })
    if (!reel) return { error: 'Reel not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (reel.creatorId !== user.id) return { error: 'Not authorized', code: ErrorCode.FORBIDDEN, status: 403 }

    // Max 3 pinned reels
    const pinnedCount = await db.collection('reels').countDocuments({ creatorId: user.id, pinnedToProfile: true })
    if (pinnedCount >= 3 && !reel.pinnedToProfile) {
      return { error: 'Max 3 pinned reels', code: ErrorCode.LIMIT_EXCEEDED, status: 429 }
    }

    await db.collection('reels').updateOne({ id: path[1] }, { $set: { pinnedToProfile: true, updatedAt: new Date() } })
    return { data: { message: 'Reel pinned', reelId: path[1] } }
  }

  // ========================
  // DELETE /reels/:id/pin — Unpin from profile
  // ========================
  if (path[0] === 'reels' && path.length === 3 && path[2] === 'pin' && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const reel = await db.collection('reels').findOne({ id: path[1] })
    if (!reel) return { error: 'Reel not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (reel.creatorId !== user.id) return { error: 'Not authorized', code: ErrorCode.FORBIDDEN, status: 403 }

    await db.collection('reels').updateOne({ id: path[1] }, { $set: { pinnedToProfile: false, updatedAt: new Date() } })
    return { data: { message: 'Reel unpinned', reelId: path[1] } }
  }

  // ========================
  // POST /reels/:id/like — Like reel
  // ========================
  if (path[0] === 'reels' && path.length === 3 && path[2] === 'like' && method === 'POST') {
    const user = await requireAuth(request, db)
    const reelId = path[1]

    const reel = await db.collection('reels').findOne({ id: reelId, status: 'PUBLISHED' })
    if (!reel) return { error: 'Reel not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (user.id === reel.creatorId) return { error: 'Cannot like own reel', code: ErrorCode.SELF_ACTION, status: 400 }
    if (await isBlocked(db, user.id, reel.creatorId)) {
      return { error: 'Action not allowed', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    // Anti-abuse: check reel like velocity
    const abuseCheck = checkEngagementAbuse(user.id, ActionType.LIKE, reelId, reel.creatorId)
    if (abuseCheck.flagged) await logSuspiciousAction(db, user.id, ActionType.LIKE, reelId, abuseCheck)
    if (!abuseCheck.allowed) {
      return { error: abuseCheck.reason, code: 'ABUSE_DETECTED', status: 429 }
    }

    const result = await db.collection('reel_likes').updateOne(
      { reelId, userId: user.id },
      { $setOnInsert: { id: uuidv4(), reelId, userId: user.id, creatorId: reel.creatorId, createdAt: new Date() } },
      { upsert: true }
    )

    if (result.upsertedCount > 0) {
      const likeCount = await db.collection('reel_likes').countDocuments({ reelId })
      await db.collection('reels').updateOne({ id: reelId }, { $set: { likeCount, updatedAt: new Date() } })
      await createNotification(db, reel.creatorId, NotificationType.REEL_LIKE, user.id, 'REEL', reelId,
        `${user.displayName || user.username} liked your reel`)
      publishReelEvent(reel.creatorId, {
        type: ReelEvent.LIKED, reelId,
        user: { id: user.id, displayName: user.displayName },
        likeCount,
      })
    }

    return { data: { message: 'Liked', reelId } }
  }

  // ========================
  // DELETE /reels/:id/like — Unlike reel
  // ========================
  if (path[0] === 'reels' && path.length === 3 && path[2] === 'like' && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const reelId = path[1]

    const result = await db.collection('reel_likes').deleteOne({ reelId, userId: user.id })
    if (result.deletedCount > 0) {
      const likeCount = await db.collection('reel_likes').countDocuments({ reelId })
      await db.collection('reels').updateOne({ id: reelId }, { $set: { likeCount, updatedAt: new Date() } })
    }

    return { data: { message: 'Unliked', reelId } }
  }

  // ========================
  // POST /reels/:id/save — Save reel
  // ========================
  if (path[0] === 'reels' && path.length === 3 && path[2] === 'save' && method === 'POST') {
    const user = await requireAuth(request, db)
    const reelId = path[1]

    const reel = await db.collection('reels').findOne({ id: reelId, status: 'PUBLISHED' })
    if (!reel) return { error: 'Reel not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (await isBlocked(db, user.id, reel.creatorId)) {
      return { error: 'Action not allowed', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    // Anti-abuse: check reel save velocity
    const abuseCheck = checkEngagementAbuse(user.id, ActionType.SAVE, reelId, reel.creatorId)
    if (abuseCheck.flagged) await logSuspiciousAction(db, user.id, ActionType.SAVE, reelId, abuseCheck)
    if (!abuseCheck.allowed) {
      return { error: abuseCheck.reason, code: 'ABUSE_DETECTED', status: 429 }
    }

    const result = await db.collection('reel_saves').updateOne(
      { reelId, userId: user.id },
      { $setOnInsert: { id: uuidv4(), reelId, userId: user.id, creatorId: reel.creatorId, createdAt: new Date() } },
      { upsert: true }
    )

    if (result.upsertedCount > 0) {
      const saveCount = await db.collection('reel_saves').countDocuments({ reelId })
      await db.collection('reels').updateOne({ id: reelId }, { $set: { saveCount, updatedAt: new Date() } })
      publishReelEvent(reel.creatorId, {
        type: ReelEvent.SAVED, reelId,
        user: { id: user.id, displayName: user.displayName },
        saveCount,
      })
    }

    return { data: { message: 'Saved', reelId } }
  }

  // ========================
  // DELETE /reels/:id/save — Unsave reel
  // ========================
  if (path[0] === 'reels' && path.length === 3 && path[2] === 'save' && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const reelId = path[1]

    const result = await db.collection('reel_saves').deleteOne({ reelId, userId: user.id })
    if (result.deletedCount > 0) {
      const saveCount = await db.collection('reel_saves').countDocuments({ reelId })
      await db.collection('reels').updateOne({ id: reelId }, { $set: { saveCount, updatedAt: new Date() } })
    }

    return { data: { message: 'Unsaved', reelId } }
  }

  // ========================
  // POST /reels/:id/comment — Create comment
  // ========================
  if (path[0] === 'reels' && path.length === 3 && path[2] === 'comment' && method === 'POST') {
    const user = await requireAuth(request, db)
    const reelId = path[1]

    const reel = await db.collection('reels').findOne({ id: reelId, status: 'PUBLISHED' })
    if (!reel) return { error: 'Reel not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (await isBlocked(db, user.id, reel.creatorId)) {
      return { error: 'Action not allowed', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const body = await request.json()
    // B6: Accept both `text` and `body` fields (canonical precedence: body || text, matching post comment behavior)
    const commentText = body.body || body.text
    const { parentId } = body
    if (!commentText || commentText.trim().length === 0) {
      return { error: 'Comment text required', code: ErrorCode.VALIDATION, status: 400 }
    }
    if (commentText.length > 1000) {
      return { error: 'Comment max 1000 chars', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Anti-abuse: check reel comment velocity (after input validation, so invalid input doesn't count)
    const abuseCheck = checkEngagementAbuse(user.id, ActionType.COMMENT, reelId, reel.creatorId)
    if (abuseCheck.flagged) await logSuspiciousAction(db, user.id, ActionType.COMMENT, reelId, abuseCheck)
    if (!abuseCheck.allowed) {
      return { error: abuseCheck.reason, code: 'ABUSE_DETECTED', status: 429 }
    }

    // Rate limit
    const oneHourAgo = new Date(Date.now() - 3_600_000)
    const recentComments = await db.collection('reel_comments').countDocuments({
      senderId: user.id, createdAt: { $gte: oneHourAgo },
    })
    if (recentComments >= REEL_COMMENT_RATE_LIMIT) {
      return { error: `Rate limit: max ${REEL_COMMENT_RATE_LIMIT} comments per hour`, code: ErrorCode.RATE_LIMITED, status: 429 }
    }

    // Validate parent if reply
    if (parentId) {
      const parent = await db.collection('reel_comments').findOne({ id: parentId, reelId })
      if (!parent) return { error: 'Parent comment not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    // B6: Moderation with canonical signature (db + object)
    let modStatus = 'APPROVED'
    try {
      const modResult = await moderateCreateContent(db, {
        entityType: 'reel_comment',
        entityId: reelId,
        actorUserId: user.id,
        text: commentText.trim(),
        metadata: { route: 'POST /reels/:id/comment' },
      })
      if (modResult?.decision?.action === 'ESCALATE') modStatus = 'HELD'
    } catch (err) {
      if (err.details?.code === 'CONTENT_REJECTED_BY_MODERATION') {
        return { error: 'Comment flagged by content safety filter', code: ErrorCode.VALIDATION, status: 400 }
      }
      const { default: logger } = await import('@/lib/logger')
      logger.warn('MODERATION', 'reel_comment_moderation_fail', { error: err.message })
    }

    const trimmedText = commentText.trim()
    const comment = {
      id: uuidv4(),
      reelId,
      creatorId: reel.creatorId,
      senderId: user.id,
      text: trimmedText,
      body: trimmedText,
      parentId: parentId || null,
      moderationStatus: modStatus,
      likeCount: 0,
      replyCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    await db.collection('reel_comments').insertOne(comment)

    // Update reel comment count
    const commentCount = await db.collection('reel_comments').countDocuments({ reelId, moderationStatus: 'APPROVED' })
    await db.collection('reels').updateOne({ id: reelId }, { $set: { commentCount, updatedAt: new Date() } })

    // Update parent reply count
    if (parentId) {
      const replyCount = await db.collection('reel_comments').countDocuments({ parentId })
      await db.collection('reel_comments').updateOne({ id: parentId }, { $set: { replyCount } })
    }

    // B6: Use canonical NotificationType.REEL_COMMENT enum
    if (user.id !== reel.creatorId) {
      await createNotification(db, reel.creatorId, NotificationType.REEL_COMMENT, user.id, 'REEL', reelId,
        `${user.displayName || user.username} commented on your reel`)
      publishReelEvent(reel.creatorId, {
        type: ReelEvent.COMMENTED, reelId,
        sender: { id: user.id, displayName: user.displayName },
        preview: trimmedText.slice(0, 50),
        commentCount,
      })
    }

    return { data: { comment: sanitizeComment(comment) }, status: 201 }
  }

  // ========================
  // GET /reels/:id/comments — List comments
  // ========================
  if (path[0] === 'reels' && path.length === 3 && path[2] === 'comments' && method === 'GET') {
    const viewer = await authenticate(request, db)
    const reelId = path[1]
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
    const offset = parseInt(url.searchParams.get('offset') || '0')
    const parentId = url.searchParams.get('parentId') || null // null = top-level

    const reel = await db.collection('reels').findOne({ id: reelId })
    if (!reel || reel.status === 'REMOVED') {
      return { error: 'Reel not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    const query = { reelId, parentId, moderationStatus: 'APPROVED' }

    // If viewer is admin, show held comments too
    if (viewer && isAdmin(viewer)) {
      delete query.moderationStatus
    }

    // B6-P2: Filter blocked users from comment list
    if (viewer) {
      const allBlocks = await db.collection('blocks').find({
        $or: [{ blockerId: viewer.id }, { blockedId: viewer.id }],
      }).toArray()
      const blockedUserIds = allBlocks.map(b => b.blockerId === viewer.id ? b.blockedId : b.blockerId)
      if (blockedUserIds.length > 0) {
        query.senderId = { $nin: blockedUserIds }
      }
    }

    const [comments, total] = await Promise.all([
      db.collection('reel_comments').find(query).sort({ createdAt: -1 }).skip(offset).limit(limit).toArray(),
      db.collection('reel_comments').countDocuments(query),
    ])

    // Batch get senders
    const senderIds = [...new Set(comments.map(c => c.senderId))]
    const senders = senderIds.length > 0
      ? await db.collection('users').find({ id: { $in: senderIds } }).toArray()
      : []
    const senderMap = Object.fromEntries(senders.map(u => [u.id, sanitizeUser(u)]))

    const items = comments.map(c => ({
      ...sanitizeComment(c),
      sender: senderMap[c.senderId] || null,
    }))

    return { data: { items, pagination: { total, offset, limit, hasMore: offset + items.length < total }, total, reelId } }
  }

  // ========================
  // POST /reels/:id/report — Report reel
  // ========================
  if (path[0] === 'reels' && path.length === 3 && path[2] === 'report' && method === 'POST') {
    const user = await requireAuth(request, db)
    const reelId = path[1]

    const reel = await db.collection('reels').findOne({ id: reelId })
    if (!reel) return { error: 'Reel not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (user.id === reel.creatorId) return { error: 'Cannot report own reel', code: ErrorCode.SELF_ACTION, status: 400 }

    // B6: Safe body parsing — prevents crash on empty/malformed body
    let body = {}
    try { body = await request.json() } catch {
      return { error: 'Request body required (JSON with reasonCode)', code: ErrorCode.VALIDATION, status: 400 }
    }
    const { reasonCode, reason } = body
    if (!reasonCode) return { error: 'reasonCode required', code: ErrorCode.VALIDATION, status: 400 }

    // Dedup
    const existing = await db.collection('reel_reports').findOne({ reelId, reporterId: user.id })
    if (existing) return { error: 'Already reported', code: ErrorCode.DUPLICATE, status: 409 }

    const report = {
      id: uuidv4(),
      reelId,
      reporterId: user.id,
      creatorId: reel.creatorId,
      reasonCode,
      reason: reason?.trim() || null,
      createdAt: new Date(),
    }

    await db.collection('reel_reports').insertOne(report)

    const reportCount = await db.collection('reel_reports').countDocuments({ reelId })
    const updates = { reportCount, updatedAt: new Date() }

    // Auto-hold at threshold
    if (reportCount >= REEL_REPORT_AUTO_HOLD && reel.status === 'PUBLISHED') {
      updates.status = 'HELD'
      updates.moderationStatus = 'HELD'
      updates.heldAt = new Date()
    }

    await db.collection('reels').updateOne({ id: reelId }, { $set: updates })
    await writeAudit(db, 'REEL_REPORTED', user.id, 'REEL', reelId, { reasonCode, reportCount })

    const { _id, ...cleanReport } = report
    return { data: { report: cleanReport, reportCount }, status: 201 }
  }

  // ========================
  // POST /reels/:id/hide — Hide from feed
  // ========================
  if (path[0] === 'reels' && path.length === 3 && path[2] === 'hide' && method === 'POST') {
    const user = await requireAuth(request, db)
    await db.collection('reel_hidden').updateOne(
      { reelId: path[1], userId: user.id },
      { $setOnInsert: { id: uuidv4(), reelId: path[1], userId: user.id, createdAt: new Date() } },
      { upsert: true }
    )
    return { data: { message: 'Reel hidden', reelId: path[1] } }
  }

  // ========================
  // POST /reels/:id/not-interested — Mark not interested
  // ========================
  if (path[0] === 'reels' && path.length === 3 && path[2] === 'not-interested' && method === 'POST') {
    const user = await requireAuth(request, db)
    await db.collection('reel_not_interested').updateOne(
      { reelId: path[1], userId: user.id },
      { $setOnInsert: { id: uuidv4(), reelId: path[1], userId: user.id, createdAt: new Date() } },
      { upsert: true }
    )
    return { data: { message: 'Marked not interested', reelId: path[1] } }
  }

  // ========================
  // POST /reels/:id/share — Track share
  // ========================
  if (path[0] === 'reels' && path.length === 3 && path[2] === 'share' && method === 'POST') {
    const user = await requireAuth(request, db)
    const reelId = path[1]

    const reel = await db.collection('reels').findOne({ id: reelId, status: 'PUBLISHED' })
    if (!reel) return { error: 'Reel not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Anti-abuse: check reel share velocity
    const abuseCheck = checkEngagementAbuse(user.id, ActionType.SHARE, reelId, reel.creatorId)
    if (abuseCheck.flagged) await logSuspiciousAction(db, user.id, ActionType.SHARE, reelId, abuseCheck)
    if (!abuseCheck.allowed) {
      return { error: abuseCheck.reason, code: 'ABUSE_DETECTED', status: 429 }
    }

    const body = await request.json().catch(() => ({}))

    await db.collection('reel_shares').insertOne({
      id: uuidv4(),
      reelId,
      userId: user.id,
      creatorId: reel.creatorId,
      platform: body.platform || 'INTERNAL',
      createdAt: new Date(),
    })

    const shareCount = await db.collection('reel_shares').countDocuments({ reelId })
    await db.collection('reels').updateOne({ id: reelId }, { $set: { shareCount, updatedAt: new Date() } })

    publishReelEvent(reel.creatorId, {
      type: ReelEvent.SHARED, reelId,
      user: { id: user.id, displayName: user.displayName },
      shareCount,
    })

    // B6-P2: Notify creator about share
    if (user.id !== reel.creatorId) {
      await createNotification(db, reel.creatorId, NotificationType.REEL_SHARE, user.id, 'REEL', reelId,
        `${user.displayName || user.username} shared your reel`)
    }

    return { data: { message: 'Share tracked', reelId, shareCount } }
  }

  // ========================
  // POST /reels/:id/watch — Track watch event (duration, completion, replay)
  // ========================
  if (path[0] === 'reels' && path.length === 3 && path[2] === 'watch' && method === 'POST') {
    const user = await requireAuth(request, db)
    const reelId = path[1]

    const body = await request.json()
    const { watchTimeMs, completed = false, replayed = false } = body

    if (!watchTimeMs || watchTimeMs < 0) {
      return { error: 'watchTimeMs required (positive integer)', code: ErrorCode.VALIDATION, status: 400 }
    }

    const reel = await db.collection('reels').findOne({ id: reelId })
    if (!reel) return { error: 'Reel not found', code: ErrorCode.NOT_FOUND, status: 404 }

    await db.collection('reel_watch_events').insertOne({
      id: uuidv4(),
      reelId,
      userId: user.id,
      creatorId: reel.creatorId,
      watchTimeMs: Math.min(watchTimeMs, REEL_MAX_DURATION_MS * 2),
      completed: !!completed,
      replayed: !!replayed,
      createdAt: new Date(),
    })

    // Update reel aggregate counters
    const updates = { updatedAt: new Date() }
    if (completed) {
      updates.$inc = { completionCount: 1 }
    }
    if (replayed) {
      updates.$inc = { ...(updates.$inc || {}), replayCount: 1 }
    }

    // Compute average watch time from events (sampled — last 1000)
    const recentEvents = await db.collection('reel_watch_events')
      .find({ reelId })
      .sort({ createdAt: -1 })
      .limit(1000)
      .project({ watchTimeMs: 1, _id: 0 })
      .toArray()

    const avgWatch = recentEvents.length > 0
      ? Math.round(recentEvents.reduce((sum, e) => sum + e.watchTimeMs, 0) / recentEvents.length)
      : 0

    if (updates.$inc) {
      await db.collection('reels').updateOne({ id: reelId }, {
        $inc: updates.$inc,
        $set: { avgWatchTimeMs: avgWatch, updatedAt: new Date() },
      })
    } else {
      await db.collection('reels').updateOne({ id: reelId }, {
        $set: { avgWatchTimeMs: avgWatch, updatedAt: new Date() },
      })
    }

    return { data: { message: 'Watch event recorded', reelId } }
  }

  // ========================
  // POST /reels/:id/view — Track impression
  // ========================
  if (path[0] === 'reels' && path.length === 3 && path[2] === 'view' && method === 'POST') {
    const user = await requireAuth(request, db)
    const reelId = path[1]

    // Increment impression count (not deduplicated — every scroll counts)
    await db.collection('reels').updateOne(
      { id: reelId },
      { $inc: { impressionCount: 1 }, $set: { updatedAt: new Date() } }
    )

    return { data: { message: 'Impression tracked', reelId } }
  }

  // ========================
  // GET /reels/audio/:audioId — Reels using this audio
  // ========================
  if (path[0] === 'reels' && path[1] === 'audio' && path.length === 3 && method === 'GET') {
    const viewer = await authenticate(request, db)
    const audioId = path[2]
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
    const offset = parseInt(url.searchParams.get('offset') || '0')

    const query = {
      'audioMeta.audioId': audioId,
      status: 'PUBLISHED',
      mediaStatus: 'READY',
    }

    // B6-P2: Filter blocked creators from audio browse
    if (viewer) {
      const blockedSet = await batchBlockCheck(db, viewer.id, [])
      // Get all blocked IDs for this viewer
      const allBlocks = await db.collection('blocks').find({
        $or: [{ blockerId: viewer.id }, { blockedId: viewer.id }],
      }).toArray()
      const blockedIds = allBlocks.map(b => b.blockerId === viewer.id ? b.blockedId : b.blockerId)
      if (blockedIds.length > 0) {
        query.creatorId = { $nin: blockedIds }
      }
    }

    const [reels, total] = await Promise.all([
      db.collection('reels').find(query).sort({ publishedAt: -1 }).skip(offset).limit(limit).toArray(),
      db.collection('reels').countDocuments(query),
    ])

    return { data: { items: sanitizeReels(reels), pagination: { total, offset, limit, hasMore: offset + reels.length < total }, total } }
  }

  // ========================
  // GET /reels/:id/remixes — Get remixes of a reel
  // ========================
  if (path[0] === 'reels' && path.length === 3 && path[2] === 'remixes' && method === 'GET') {
    const viewer = await authenticate(request, db)
    const reelId = path[1]
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
    const offset = parseInt(url.searchParams.get('offset') || '0')

    const query = {
      'remixOf.reelId': reelId,
      status: 'PUBLISHED',
      mediaStatus: 'READY',
    }

    // B6-P2: Filter blocked creators from remix browse
    if (viewer) {
      const allBlocks = await db.collection('blocks').find({
        $or: [{ blockerId: viewer.id }, { blockedId: viewer.id }],
      }).toArray()
      const blockedIds = allBlocks.map(b => b.blockerId === viewer.id ? b.blockedId : b.blockerId)
      if (blockedIds.length > 0) {
        query.creatorId = { $nin: blockedIds }
      }
    }

    const [reels, total] = await Promise.all([
      db.collection('reels').find(query).sort({ publishedAt: -1 }).skip(offset).limit(limit).toArray(),
      db.collection('reels').countDocuments(query),
    ])

    return { data: { items: sanitizeReels(reels), pagination: { total, offset, limit, hasMore: offset + reels.length < total }, total, originalReelId: reelId } }
  }

  // ========================
  // POST /me/reels/series — Create series
  // ========================
  if (path[0] === 'me' && path[1] === 'reels' && path[2] === 'series' && path.length === 3 && method === 'POST') {
    const user = await requireAuth(request, db)
    const body = await request.json()
    const { name, description } = body

    if (!name || name.trim().length === 0) {
      return { error: 'Series name required', code: ErrorCode.VALIDATION, status: 400 }
    }

    const series = {
      id: uuidv4(),
      creatorId: user.id,
      name: name.trim(),
      description: description?.trim() || null,
      reelCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    await db.collection('reel_series').insertOne(series)
    return { data: { series: sanitizeComment(series) }, status: 201 }
  }

  // ========================
  // GET /users/:userId/reels/series — Get user's series
  // ========================
  if (path[0] === 'users' && path.length === 4 && path[2] === 'reels' && path[3] === 'series' && method === 'GET') {
    const targetUserId = path[1]
    const seriesList = await db.collection('reel_series')
      .find({ creatorId: targetUserId })
      .sort({ createdAt: -1 })
      .toArray()

    return { data: { items: seriesList.map(s => sanitizeComment(s)), count: seriesList.length } }
  }

  // ========================
  // GET /me/reels/archive — Creator's archived reels
  // ========================
  if (path[0] === 'me' && path[1] === 'reels' && path[2] === 'archive' && path.length === 3 && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
    const cursor = url.searchParams.get('cursor')

    const query = { creatorId: user.id, status: 'ARCHIVED' }
    if (cursor) query.archivedAt = { $lt: new Date(cursor) }

    const reels = await db.collection('reels')
      .find(query)
      .sort({ archivedAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = reels.length > limit
    const items = sanitizeReels(reels.slice(0, limit))

    return {
      data: {
        items,
        pagination: {
          nextCursor: hasMore ? items[items.length - 1].archivedAt?.toISOString() : null,
          hasMore,
        },
        nextCursor: hasMore ? items[items.length - 1].archivedAt?.toISOString() : null,
        total: await db.collection('reels').countDocuments({ creatorId: user.id, status: 'ARCHIVED' }),
      },
    }
  }

  // ========================
  // GET /me/reels/analytics — Creator's own analytics
  // ========================
  if (path[0] === 'me' && path[1] === 'reels' && path[2] === 'analytics' && path.length === 3 && method === 'GET') {
    const user = await requireAuth(request, db)

    const [totalReels, publishedReels, totalViews, totalLikes, totalComments, totalSaves, totalShares] = await Promise.all([
      db.collection('reels').countDocuments({ creatorId: user.id }),
      db.collection('reels').countDocuments({ creatorId: user.id, status: 'PUBLISHED' }),
      db.collection('reel_views').countDocuments({ creatorId: user.id }),
      db.collection('reel_likes').countDocuments({ creatorId: user.id }),
      db.collection('reel_comments').countDocuments({ creatorId: user.id }),
      db.collection('reel_saves').countDocuments({ creatorId: user.id }),
      db.collection('reel_shares').countDocuments({ creatorId: user.id }),
    ])

    // Top performing reels
    const topReels = await db.collection('reels')
      .find({ creatorId: user.id, status: 'PUBLISHED' })
      .sort({ viewCount: -1 })
      .limit(5)
      .toArray()

    return {
      data: {
        totalReels,
        publishedReels,
        totalViews,
        totalLikes,
        totalComments,
        totalSaves,
        totalShares,
        topReels: sanitizeReels(topReels),
      },
    }
  }

  // ========================
  // POST /reels/:id/processing — Update processing status (internal)
  // ========================
  if (path[0] === 'reels' && path.length === 3 && path[2] === 'processing' && method === 'POST') {
    const user = await requireAuth(request, db)
    const reelId = path[1]

    const reel = await db.collection('reels').findOne({ id: reelId })
    if (!reel) return { error: 'Reel not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (reel.creatorId !== user.id && !isAdmin(user)) {
      return { error: 'Not authorized', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const body = await request.json()
    const { mediaStatus, playbackUrl, thumbnailUrl, posterFrameUrl, variants, failureReason } = body

    if (!ALLOWED_MEDIA_STATUSES.includes(mediaStatus)) {
      return { error: `mediaStatus must be: ${ALLOWED_MEDIA_STATUSES.join(', ')}`, code: ErrorCode.VALIDATION, status: 400 }
    }

    const updates = { mediaStatus, updatedAt: new Date() }
    if (playbackUrl) updates.playbackUrl = playbackUrl
    if (thumbnailUrl) updates.thumbnailUrl = thumbnailUrl
    if (posterFrameUrl) updates.posterFrameUrl = posterFrameUrl
    if (variants) updates.variants = variants

    // If READY and reel was DRAFT waiting for processing, keep as DRAFT
    // If READY and reel was PUBLISHED, just update media
    // If FAILED, don't change reel status

    await db.collection('reels').updateOne({ id: reelId }, { $set: updates })

    // Update processing job
    const jobUpdate = { status: mediaStatus === 'READY' ? 'COMPLETED' : mediaStatus === 'FAILED' ? 'FAILED' : 'PROCESSING', updatedAt: new Date() }
    if (failureReason) jobUpdate.failureReason = failureReason
    if (mediaStatus === 'READY' || mediaStatus === 'FAILED') jobUpdate.completedAt = new Date()
    await db.collection('reel_processing_jobs').updateOne({ reelId }, { $set: jobUpdate, $inc: { attempts: 1 } })

    await writeAudit(db, 'REEL_PROCESSING_UPDATE', user.id, 'REEL', reelId, { mediaStatus })

    return { data: { message: 'Processing status updated', reelId, mediaStatus } }
  }

  // ========================
  // GET /reels/:id/processing — Get processing status
  // ========================
  if (path[0] === 'reels' && path.length === 3 && path[2] === 'processing' && method === 'GET') {
    const user = await requireAuth(request, db)
    const reelId = path[1]

    const reel = await db.collection('reels').findOne({ id: reelId })
    if (!reel) return { error: 'Reel not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (reel.creatorId !== user.id && !isAdmin(user)) {
      return { error: 'Not authorized', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const job = await db.collection('reel_processing_jobs').findOne({ reelId })

    return {
      data: {
        reelId,
        mediaStatus: reel.mediaStatus,
        job: job ? sanitizeComment(job) : null,
      },
    }
  }

  // ========================
  // ADMIN ROUTES
  // ========================

  // GET /admin/reels — Admin moderation queue
  if (path[0] === 'admin' && path[1] === 'reels' && path.length === 2 && method === 'GET') {
    const user = await requireAuth(request, db)
    requireRole(user, 'MODERATOR', 'ADMIN', 'SUPER_ADMIN')

    const url = new URL(request.url)
    const status = url.searchParams.get('status')
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100)
    const offset = parseInt(url.searchParams.get('offset') || '0')

    const query = {}
    if (status) query.status = status

    const [items, total, stats] = await Promise.all([
      db.collection('reels').find(query).sort({ createdAt: -1 }).skip(offset).limit(limit).toArray(),
      db.collection('reels').countDocuments(query),
      Promise.all([
        db.collection('reels').countDocuments({ status: 'PUBLISHED' }),
        db.collection('reels').countDocuments({ status: 'HELD' }),
        db.collection('reels').countDocuments({ status: 'REMOVED' }),
        db.collection('reels').countDocuments({ status: 'DRAFT' }),
        db.collection('reels').countDocuments({ status: 'ARCHIVED' }),
      ]),
    ])

    return {
      data: {
        items: sanitizeReels(items),
        pagination: { total, offset, limit, hasMore: offset + items.length < total },
        total,
        stats: {
          PUBLISHED: stats[0], HELD: stats[1], REMOVED: stats[2], DRAFT: stats[3], ARCHIVED: stats[4],
        },
      },
    }
  }

  // PATCH /admin/reels/:id/moderate — Moderate reel
  if (path[0] === 'admin' && path[1] === 'reels' && path.length === 4 && path[3] === 'moderate' && method === 'PATCH') {
    const user = await requireAuth(request, db)
    requireRole(user, 'MODERATOR', 'ADMIN', 'SUPER_ADMIN')

    const reelId = path[2]
    const reel = await db.collection('reels').findOne({ id: reelId })
    if (!reel) return { error: 'Reel not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const body = await request.json()
    const { action, reason } = body

    if (!['APPROVE', 'HOLD', 'REMOVE', 'RESTORE'].includes(action)) {
      return { error: 'action must be APPROVE, HOLD, REMOVE, or RESTORE', code: ErrorCode.VALIDATION, status: 400 }
    }

    const now = new Date()
    const updates = { updatedAt: now, moderatedBy: user.id, moderatedAt: now, moderationReason: reason || null }

    switch (action) {
      case 'APPROVE':
        updates.status = 'PUBLISHED'
        updates.moderationStatus = 'APPROVED'
        updates.heldAt = null
        if (!reel.publishedAt) updates.publishedAt = now
        break
      case 'HOLD':
        updates.status = 'HELD'
        updates.moderationStatus = 'HELD'
        updates.heldAt = now
        break
      case 'REMOVE':
        updates.status = 'REMOVED'
        updates.moderationStatus = 'REMOVED'
        updates.removedAt = now
        break
      case 'RESTORE':
        updates.status = 'PUBLISHED'
        updates.moderationStatus = 'APPROVED'
        updates.removedAt = null
        updates.heldAt = null
        break
    }

    await db.collection('reels').updateOne({ id: reelId }, { $set: updates })
    await writeAudit(db, 'REEL_MODERATED', user.id, 'REEL', reelId, {
      action, previousStatus: reel.status, newStatus: updates.status, reason,
    })

    return { data: { message: `Reel ${action.toLowerCase()}d`, reelId, status: updates.status } }
  }

  // GET /admin/reels/analytics — Platform analytics
  if (path[0] === 'admin' && path[1] === 'reels' && path[2] === 'analytics' && path.length === 3 && method === 'GET') {
    const user = await requireAuth(request, db)
    requireRole(user, 'ADMIN', 'SUPER_ADMIN')

    const [totalReels, published, held, removed, drafts, totalViews, totalLikes, totalComments, totalShares, processingPending, processingFailed] = await Promise.all([
      db.collection('reels').countDocuments({}),
      db.collection('reels').countDocuments({ status: 'PUBLISHED' }),
      db.collection('reels').countDocuments({ status: 'HELD' }),
      db.collection('reels').countDocuments({ status: 'REMOVED' }),
      db.collection('reels').countDocuments({ status: 'DRAFT' }),
      db.collection('reel_views').countDocuments({}),
      db.collection('reel_likes').countDocuments({}),
      db.collection('reel_comments').countDocuments({}),
      db.collection('reel_shares').countDocuments({}),
      db.collection('reel_processing_jobs').countDocuments({ status: 'PENDING' }),
      db.collection('reel_processing_jobs').countDocuments({ status: 'FAILED' }),
    ])

    return {
      data: {
        totalReels, published, held, removed, drafts,
        totalViews, totalLikes, totalComments, totalShares,
        processing: { pending: processingPending, failed: processingFailed },
      },
    }
  }

  // POST /admin/reels/:id/recompute-counters — Recompute all counters
  if (path[0] === 'admin' && path[1] === 'reels' && path.length === 4 && path[3] === 'recompute-counters' && method === 'POST') {
    const user = await requireAuth(request, db)
    requireRole(user, 'ADMIN', 'SUPER_ADMIN')

    const reelId = path[2]
    const reel = await db.collection('reels').findOne({ id: reelId })
    if (!reel) return { error: 'Reel not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const before = {
      likeCount: reel.likeCount, commentCount: reel.commentCount,
      saveCount: reel.saveCount, shareCount: reel.shareCount,
      viewCount: reel.viewCount, reportCount: reel.reportCount,
    }

    const [likeCount, commentCount, saveCount, shareCount, viewCount, reportCount] = await Promise.all([
      db.collection('reel_likes').countDocuments({ reelId }),
      db.collection('reel_comments').countDocuments({ reelId, moderationStatus: 'APPROVED' }),
      db.collection('reel_saves').countDocuments({ reelId }),
      db.collection('reel_shares').countDocuments({ reelId }),
      db.collection('reel_views').countDocuments({ reelId }),
      db.collection('reel_reports').countDocuments({ reelId }),
    ])

    const after = { likeCount, commentCount, saveCount, shareCount, viewCount, reportCount }

    await db.collection('reels').updateOne({ id: reelId }, {
      $set: { ...after, uniqueViewerCount: viewCount, updatedAt: new Date() },
    })

    await writeAudit(db, 'REEL_COUNTERS_RECOMPUTED', user.id, 'REEL', reelId, { before, after })

    return { data: { reelId, before, after, drifted: JSON.stringify(before) !== JSON.stringify(after) } }
  }

  // ========================
  // GET /reels/trending — Trending/viral reels feed
  // ========================
  if (path[0] === 'reels' && path[1] === 'trending' && path.length === 2 && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
    const cursor = url.searchParams.get('cursor')
    const timeWindow = url.searchParams.get('window') || '24h'

    // Time window for trending calculation
    const windowMs = { '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 }
    const windowSince = new Date(Date.now() - (windowMs[timeWindow] || windowMs['24h']))

    // Trending score = recent engagement velocity (likes+comments+shares+views in window / age_hours)
    const pipeline = [
      { $match: { status: 'PUBLISHED', mediaStatus: 'READY', visibility: 'PUBLIC', publishedAt: { $gte: windowSince } } },
      { $addFields: {
        ageHours: { $max: [1, { $divide: [{ $subtract: [new Date(), '$publishedAt'] }, 3600000] }] },
        engagementTotal: { $add: [
          { $multiply: ['$likeCount', 2] },
          { $multiply: ['$commentCount', 3] },
          { $multiply: ['$shareCount', 5] },
          '$viewCount',
        ]},
      }},
      { $addFields: { trendingScore: { $divide: ['$engagementTotal', '$ageHours'] } } },
      { $sort: { trendingScore: -1, publishedAt: -1 } },
    ]

    if (cursor) {
      const cursorScore = parseFloat(cursor)
      pipeline.push({ $match: { trendingScore: { $lt: cursorScore } } })
    }

    pipeline.push({ $limit: limit + 1 })

    const reels = await db.collection('reels').aggregate(pipeline).toArray()
    const hasMore = reels.length > limit
    const items = sanitizeReels(reels.slice(0, limit))

    // Enrich with creator info
    const creatorIds = [...new Set(items.map(r => r.creatorId))]
    const creators = creatorIds.length > 0
      ? await db.collection('users').find({ id: { $in: creatorIds } }).toArray()
      : []
    const creatorMap = Object.fromEntries(creators.map(u => [u.id, sanitizeUser(u)]))

    const reelIds = items.map(r => r.id)
    const [likes, saves] = await Promise.all([
      db.collection('reel_likes').find({ reelId: { $in: reelIds }, userId: user.id }).toArray(),
      db.collection('reel_saves').find({ reelId: { $in: reelIds }, userId: user.id }).toArray(),
    ])
    const likedSet = new Set(likes.map(l => l.reelId))
    const savedSet = new Set(saves.map(s => s.reelId))

    const enriched = items.map(r => ({
      ...r,
      creator: creatorMap[r.creatorId] || null,
      likedByMe: likedSet.has(r.id),
      savedByMe: savedSet.has(r.id),
      trendingScore: r.trendingScore || 0,
    }))

    const lastItem = reels[Math.min(reels.length, limit) - 1]
    const nextCursor = hasMore && lastItem ? `${lastItem.trendingScore}` : null

    return { data: { items: enriched, pagination: { nextCursor, hasMore }, nextCursor, timeWindow } }
  }

  // ========================
  // GET /reels/personalized — Personalized feed with user-aware ranking
  // ========================
  if (path[0] === 'reels' && path[1] === 'personalized' && path.length === 2 && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
    const cursor = url.searchParams.get('cursor')

    // Build personalization context
    const [following, recentLikes, recentViews] = await Promise.all([
      db.collection('follows').find({ followerId: user.id }).project({ followeeId: 1, _id: 0 }).toArray(),
      db.collection('reel_likes').find({ userId: user.id }).sort({ createdAt: -1 }).limit(100).project({ creatorId: 1, _id: 0 }).toArray(),
      db.collection('reel_views').find({ userId: user.id }).sort({ createdAt: -1 }).limit(200).project({ reelId: 1, _id: 0 }).toArray(),
    ])

    const followingIds = new Set(following.map(f => f.followeeId))
    const viewedReelIds = new Set(recentViews.map(v => v.reelId))

    // Preferred creators: creators whose reels user has liked
    const preferredCreators = {}
    for (const l of recentLikes) {
      if (l.creatorId) preferredCreators[l.creatorId] = (preferredCreators[l.creatorId] || 0) + 1
    }

    // Block filter
    const allBlocks = await db.collection('blocks').find({
      $or: [{ blockerId: user.id }, { blockedId: user.id }],
    }).toArray()
    const blockedIds = new Set(allBlocks.map(b => b.blockerId === user.id ? b.blockedId : b.blockerId))

    const query = {
      status: 'PUBLISHED', mediaStatus: 'READY',
      moderationStatus: { $in: ['APPROVED', 'PENDING'] },
      visibility: 'PUBLIC',
    }
    if (blockedIds.size > 0) query.creatorId = { $nin: [...blockedIds] }

    // Fetch candidate reels (3x limit for re-ranking)
    const candidateLimit = limit * 3
    const queryWithCursor = { ...query }
    if (cursor) {
      const cursorDate = new Date(cursor)
      if (!isNaN(cursorDate.getTime())) {
        queryWithCursor.publishedAt = { $lt: cursorDate }
      }
    }

    const candidates = await db.collection('reels')
      .find(queryWithCursor)
      .sort({ score: -1, publishedAt: -1 })
      .limit(candidateLimit)
      .toArray()

    // Personalized re-ranking
    const scored = candidates.map(r => {
      let personalScore = r.score || 0

      // Boost: following creator (+30%)
      if (followingIds.has(r.creatorId)) personalScore *= 1.3

      // Boost: preferred creator (up to +20%)
      const prefCount = preferredCreators[r.creatorId] || 0
      if (prefCount > 0) personalScore *= (1 + Math.min(prefCount * 0.05, 0.2))

      // Same tribe boost (+10%)
      if (user.tribeId && r.tribeId === user.tribeId) personalScore *= 1.1

      // Same college boost (+10%)
      if (user.collegeId && r.collegeId === user.collegeId) personalScore *= 1.1

      // Diversity: penalize already-viewed (-50%)
      if (viewedReelIds.has(r.id)) personalScore *= 0.5

      return { ...r, personalScore }
    })

    // Sort by personalized score and take limit
    scored.sort((a, b) => b.personalScore - a.personalScore)
    const selected = scored.slice(0, limit + 1)
    const hasMore = selected.length > limit
    const items = sanitizeReels(selected.slice(0, limit))

    // Enrich
    const creatorIds = [...new Set(items.map(r => r.creatorId))]
    const creators = creatorIds.length > 0
      ? await db.collection('users').find({ id: { $in: creatorIds } }).toArray()
      : []
    const creatorMap = Object.fromEntries(creators.map(u => [u.id, sanitizeUser(u)]))

    const reelIds = items.map(r => r.id)
    const [likes, saves] = await Promise.all([
      db.collection('reel_likes').find({ reelId: { $in: reelIds }, userId: user.id }).toArray(),
      db.collection('reel_saves').find({ reelId: { $in: reelIds }, userId: user.id }).toArray(),
    ])
    const likedSet = new Set(likes.map(l => l.reelId))
    const savedSet = new Set(saves.map(s => s.reelId))

    const enriched = items.map(r => ({
      ...r,
      creator: creatorMap[r.creatorId] || null,
      likedByMe: likedSet.has(r.id),
      savedByMe: savedSet.has(r.id),
    }))

    const lastItem = selected[Math.min(selected.length, limit) - 1]
    const nextCursor = hasMore && lastItem ? lastItem.publishedAt?.toISOString() : null

    return { data: { items: enriched, pagination: { nextCursor, hasMore }, nextCursor, feedType: 'personalized' } }
  }

  // ========================
  // GET /me/reels/analytics/detailed — Deeper creator analytics
  // ========================
  if (path[0] === 'me' && path[1] === 'reels' && path[2] === 'analytics' && path[3] === 'detailed' && path.length === 4 && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const days = Math.min(parseInt(url.searchParams.get('days') || '30'), 90)
    const since = new Date(Date.now() - days * 86400000)

    // Daily views trend
    const dailyViews = await db.collection('reel_views').aggregate([
      { $match: { creatorId: user.id, createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, views: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).toArray()

    // Daily likes trend
    const dailyLikes = await db.collection('reel_likes').aggregate([
      { $match: { creatorId: user.id, createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, likes: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).toArray()

    // Retention curve: average view completion by reel
    const retentionCurve = await db.collection('reel_views').aggregate([
      { $match: { creatorId: user.id, watchDurationMs: { $exists: true, $gt: 0 } } },
      { $lookup: { from: 'reels', localField: 'reelId', foreignField: 'id', as: 'reel' } },
      { $unwind: { path: '$reel', preserveNullAndEmptyArrays: true } },
      { $addFields: { completionPct: { $cond: [
        { $and: [{ $gt: ['$reel.durationMs', 0] }, { $gt: ['$watchDurationMs', 0] }] },
        { $min: [100, { $multiply: [{ $divide: ['$watchDurationMs', '$reel.durationMs'] }, 100] }] },
        0,
      ]}}},
      { $group: { _id: null, avgCompletion: { $avg: '$completionPct' }, total: { $sum: 1 } } },
    ]).toArray()

    // Audience slices: top viewers by engagement
    const topEngagers = await db.collection('reel_likes').aggregate([
      { $match: { creatorId: user.id, createdAt: { $gte: since } } },
      { $group: { _id: '$userId', engagements: { $sum: 1 } } },
      { $sort: { engagements: -1 } },
      { $limit: 10 },
    ]).toArray()

    const topEngagerIds = topEngagers.map(e => e._id)
    const engagerUsers = topEngagerIds.length > 0
      ? await db.collection('users').find({ id: { $in: topEngagerIds } }).toArray()
      : []
    const engagerMap = Object.fromEntries(engagerUsers.map(u => [u.id, sanitizeUser(u)]))

    // Performance over time: avg score of reels by week
    const weeklyPerformance = await db.collection('reels').aggregate([
      { $match: { creatorId: user.id, status: 'PUBLISHED', publishedAt: { $gte: since } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-W%V', date: '$publishedAt' } },
        avgScore: { $avg: '$score' },
        avgViews: { $avg: '$viewCount' },
        avgLikes: { $avg: '$likeCount' },
        reelCount: { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]).toArray()

    // Totals
    const [totalReels, totalViews, totalLikes, totalComments, totalShares, totalSaves] = await Promise.all([
      db.collection('reels').countDocuments({ creatorId: user.id, status: 'PUBLISHED' }),
      db.collection('reel_views').countDocuments({ creatorId: user.id }),
      db.collection('reel_likes').countDocuments({ creatorId: user.id }),
      db.collection('reel_comments').countDocuments({ creatorId: user.id }),
      db.collection('reel_shares').countDocuments({ creatorId: user.id }),
      db.collection('reel_saves').countDocuments({ creatorId: user.id }),
    ])

    return {
      data: {
        period: { days, since: since.toISOString() },
        totals: { totalReels, totalViews, totalLikes, totalComments, totalShares, totalSaves },
        dailyViews: dailyViews.map(d => ({ date: d._id, views: d.views })),
        dailyLikes: dailyLikes.map(d => ({ date: d._id, likes: d.likes })),
        retention: retentionCurve[0] ? { avgCompletionPct: Math.round(retentionCurve[0].avgCompletion || 0), sampledViews: retentionCurve[0].total } : { avgCompletionPct: 0, sampledViews: 0 },
        topEngagers: topEngagers.map(e => ({ user: engagerMap[e._id] || null, engagements: e.engagements })),
        weeklyPerformance: weeklyPerformance.map(w => ({ week: w._id, avgScore: Math.round((w.avgScore || 0) * 100) / 100, avgViews: Math.round(w.avgViews || 0), avgLikes: Math.round(w.avgLikes || 0), reelCount: w.reelCount })),
      },
    }
  }

  // ========================
  // GET /reels/:id/likers — Who liked a reel
  // ========================
  if (path[0] === 'reels' && path.length === 3 && path[2] === 'likers' && method === 'GET') {
    const reelId = path[1]
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 20, 50)
    const offset = parseInt(url.searchParams.get('offset')) || 0

    const likes = await db.collection('reel_likes')
      .find({ reelId })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray()

    const userIds = likes.map(l => l.userId)
    const users = userIds.length > 0
      ? await db.collection('users').find({ id: { $in: userIds } }).toArray()
      : []
    const total = await db.collection('reel_likes').countDocuments({ reelId })
    const sanitize = (u) => { const { _id, pinHash, pinSalt, ...safe } = u; return safe }

    return { data: { items: users.map(sanitize), total, pagination: { limit, offset, hasMore: offset + likes.length < total } } }
  }

  // ========================
  // GET /me/reels/saved — Saved reels list
  // ========================
  if (path[0] === 'me' && path[1] === 'reels' && path[2] === 'saved' && path.length === 3 && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 20, 50)
    const offset = parseInt(url.searchParams.get('offset')) || 0

    const saves = await db.collection('reel_saves')
      .find({ userId: user.id })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit + 1)
      .toArray()

    const hasMore = saves.length > limit
    const items = saves.slice(0, limit)
    const reelIds = items.map(s => s.reelId)
    const reels = reelIds.length > 0
      ? await db.collection('reels').find({ id: { $in: reelIds } }).toArray()
      : []

    const creatorIds = [...new Set(reels.map(r => r.creatorId).filter(Boolean))]
    const creators = creatorIds.length > 0
      ? await db.collection('users').find({ id: { $in: creatorIds } }).toArray()
      : []
    const creatorMap = Object.fromEntries(creators.map(u => { const { _id, pinHash, pinSalt, ...safe } = u; return [u.id, safe] }))

    const enriched = reels.map(r => {
      const { _id, ...clean } = r
      return { ...clean, creator: creatorMap[r.creatorId] || null }
    })

    return { data: { items: enriched, pagination: { hasMore, limit, offset } } }
  }

  // ========================
  // POST /reels/:id/duet — Create a duet reference
  // ========================
  if (path[0] === 'reels' && path.length === 3 && path[2] === 'duet' && method === 'POST') {
    const user = await requireAuth(request, db)
    const originalReelId = path[1]
    const body = await request.json()

    const original = await db.collection('reels').findOne({ id: originalReelId })
    if (!original) return { error: 'Reel not found', code: 'NOT_FOUND', status: 404 }

    const duet = {
      id: uuidv4(),
      creatorId: user.id,
      caption: (body.caption || '').slice(0, 2200),
      mediaUrl: body.mediaUrl || null,
      durationMs: body.durationMs || 0,
      visibility: 'PUBLIC',
      status: body.mediaUrl ? 'PUBLISHED' : 'DRAFT',
      mediaStatus: body.mediaUrl ? 'READY' : 'PENDING',
      isDuet: true,
      originalReelId,
      originalCreatorId: original.creatorId,
      likeCount: 0, commentCount: 0, shareCount: 0, saveCount: 0, viewCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    await db.collection('reels').insertOne(duet)
    await db.collection('reels').updateOne({ id: originalReelId }, { $inc: { duetCount: 1 } })

    if (original.creatorId !== user.id) {
      await createNotification(db, original.creatorId, 'DUET', user.id, 'REEL', duet.id,
        `${user.displayName} created a duet with your reel`)
    }

    const { _id, ...clean } = duet
    return { data: { reel: clean }, status: 201 }
  }

  // ========================
  // GET /reels/sounds/popular — Popular sounds
  // ========================
  if (path[0] === 'reels' && path[1] === 'sounds' && path[2] === 'popular' && path.length === 3 && method === 'GET') {
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 20, 50)

    const sounds = await db.collection('reels').aggregate([
      { $match: { audioId: { $ne: null }, status: 'PUBLISHED' } },
      { $group: { _id: '$audioId', title: { $first: '$audioTitle' }, artist: { $first: '$audioArtist' }, useCount: { $sum: 1 }, latestReel: { $first: '$id' } } },
      { $sort: { useCount: -1 } },
      { $limit: limit },
    ]).toArray()

    const items = sounds.map(s => ({
      audioId: s._id,
      title: s.title || 'Original Sound',
      artist: s.artist || 'Unknown',
      useCount: s.useCount,
      sampleReelId: s.latestReel,
    }))

    return { data: { items } }
  }

  return null
}
