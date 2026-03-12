/**
 * Tribe — Stage 9: World's Best Stories
 * 
 * Complete Instagram-grade Stories backend with:
 * - Story CRUD (image/video/text, 24h auto-expiry via TTL)
 * - Interactive stickers (polls, questions, quizzes, emoji sliders)
 * - View tracking (deduplicated, owner-visible viewers list)
 * - Emoji reactions (6 quick reactions)
 * - Close friends (private audience lists)
 * - Story highlights (persistent collections of expired stories)
 * - Story archive (auto-archive on expiry)
 * - Privacy settings (who can view, who can reply)
 * - Admin moderation queue + analytics
 * - Redis caching with stampede protection
 * - Trust-weighted signals from Stage 4
 * - Full audit trail
 * 
 * Collections: stories, story_views, story_reactions, story_sticker_responses,
 *              story_highlights, story_highlight_items, close_friends, story_settings
 */

import { v4 as uuidv4 } from 'uuid'
import { requireAuth, authenticate, requireRole, writeAudit, sanitizeUser, parsePagination, createNotification } from '../auth-utils.js'
import { ErrorCode, Config } from '../constants.js'
import { cache, CacheTTL, CacheNS, invalidateOnEvent } from '../cache.js'
import { moderateCreateContent } from '../moderation/middleware/moderate-create-content.js'
import { publishStoryEvent, StoryEventType, buildSSEStream } from '../realtime.js'
import {
  StoryConfig, StoryStatus,
  isBlocked, getBlockedUserIds, canViewStory, canInteractWithStory, checkReplyPermission,
  validateSticker, validateStickerResponse, getStickerResults, enrichStickersForViewer,
  buildStoryRail, startExpiryWorker as startExpiryWorkerService,
} from '../services/story-service.js'
import { checkEngagementAbuse, logSuspiciousAction, ActionType } from '../services/anti-abuse-service.js'

// Re-export config for external consumers
export { StoryConfig }

// ========== HELPERS ==========

function isAdmin(user) {
  return ['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)
}

function sanitizeStory(story) {
  if (!story) return null
  const { _id, ...clean } = story
  return clean
}

function sanitizeStories(stories) {
  return stories.map(sanitizeStory)
}

// ═══════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════

export async function handleStories(path, method, request, db) {
  const route = path.join('/')

  // Start expiry worker on first request (lazy init) — delegated to StoryService
  startExpiryWorkerService(db, publishStoryEvent)

  // ========================
  // GET /stories/events/stream — Real-time SSE for story events
  // ========================
  if (path[0] === 'stories' && path[1] === 'events' && path[2] === 'stream' && path.length === 3 && method === 'GET') {
    // Auth via query param (EventSource) or header
    const url = new URL(request.url)
    const token = url.searchParams.get('token') || request.headers.get('Authorization')?.replace('Bearer ', '')
    if (!token) {
      return { error: 'Authentication required. Pass token as query param or Authorization header.', code: ErrorCode.UNAUTHORIZED, status: 401 }
    }

    const session = await db.collection('sessions').findOne({ token, expiresAt: { $gt: new Date() } })
    if (!session) {
      return { error: 'Invalid or expired token', code: ErrorCode.UNAUTHORIZED, status: 401 }
    }
    const user = await db.collection('users').findOne({ id: session.userId })
    if (!user) {
      return { error: 'User not found', code: ErrorCode.UNAUTHORIZED, status: 401 }
    }

    return { raw: buildSSEStream(request, user.id, db) }
  }

  // ========================
  // POST /stories — Create a new story
  // ========================
  if (route === 'stories' && method === 'POST') {
    const user = await requireAuth(request, db)

    if (user.ageStatus === 'UNKNOWN') {
      return { error: 'Complete age verification before posting stories', code: ErrorCode.AGE_REQUIRED, status: 403 }
    }
    if (user.ageStatus === 'CHILD') {
      return { error: 'Stories not available for users under 18', code: ErrorCode.CHILD_RESTRICTED, status: 403 }
    }

    // Hourly rate limit
    const hourAgo = new Date(Date.now() - 3600_000)
    const recentCount = await db.collection('stories').countDocuments({
      authorId: user.id,
      createdAt: { $gte: hourAgo },
    })
    if (recentCount >= StoryConfig.HOURLY_CREATE_LIMIT) {
      return { error: `Rate limit: max ${StoryConfig.HOURLY_CREATE_LIMIT} stories per hour`, code: ErrorCode.RATE_LIMITED, status: 429 }
    }

    const body = await request.json()
    const { type, mediaIds, caption, stickers, background, privacy, text } = body

    // Validate story type
    const storyType = type || 'IMAGE'
    if (!StoryConfig.VALID_STORY_TYPES.includes(storyType)) {
      return { error: `Invalid story type. Must be one of: ${StoryConfig.VALID_STORY_TYPES.join(', ')}`, code: ErrorCode.VALIDATION, status: 400 }
    }

    // IMAGE/VIDEO require media; TEXT requires text content
    if ((storyType === 'IMAGE' || storyType === 'VIDEO') && (!mediaIds || mediaIds.length === 0)) {
      return { error: `${storyType} story requires at least one media attachment`, code: ErrorCode.VALIDATION, status: 400 }
    }
    if (storyType === 'TEXT' && (!text || !text.trim())) {
      return { error: 'TEXT story requires text content', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Validate privacy
    const storyPrivacy = privacy || 'EVERYONE'
    if (!StoryConfig.VALID_PRIVACY.includes(storyPrivacy)) {
      return { error: `Invalid privacy. Must be one of: ${StoryConfig.VALID_PRIVACY.join(', ')}`, code: ErrorCode.VALIDATION, status: 400 }
    }

    // Resolve media
    let media = []
    if (mediaIds?.length > 0) {
      const assets = await db.collection('media_assets')
        .find({ id: { $in: mediaIds }, ownerId: user.id })
        .toArray()
      if (assets.length !== mediaIds.length) {
        return { error: 'One or more media assets not found or not owned by you', code: ErrorCode.VALIDATION, status: 400 }
      }
      media = assets.map(a => ({
        id: a.id,
        url: a.publicUrl || `/api/media/${a.id}`,
        type: a.type,
        mimeType: a.mimeType,
        width: a.width,
        height: a.height,
        duration: a.duration || null,
        storageType: a.storageType || null,
      }))
    }

    // Validate stickers
    const validatedStickers = []
    if (stickers && Array.isArray(stickers)) {
      if (stickers.length > StoryConfig.MAX_STICKERS_PER_STORY) {
        return { error: `Maximum ${StoryConfig.MAX_STICKERS_PER_STORY} stickers per story`, code: ErrorCode.VALIDATION, status: 400 }
      }
      for (const sticker of stickers) {
        const validated = validateSticker(sticker)
        if (validated.error) return { error: validated.error, code: ErrorCode.VALIDATION, status: 400 }
        validatedStickers.push(validated.sticker)
      }
    }

    // Validate background for TEXT stories
    let bgConfig = null
    if (storyType === 'TEXT' && background) {
      if (!StoryConfig.VALID_BG_TYPES.includes(background.type)) {
        return { error: `Invalid background type. Must be one of: ${StoryConfig.VALID_BG_TYPES.join(', ')}`, code: ErrorCode.VALIDATION, status: 400 }
      }
      bgConfig = {
        type: background.type,
        color: background.color || '#000000',
        gradientColors: background.gradientColors || null,
        imageUrl: background.imageUrl || null,
      }
    }

    // Content moderation
    const textToModerate = [caption, text, ...validatedStickers.map(s => s.question || '').filter(Boolean)].join(' ').trim()
    let moderationResult = null
    let storyVisibility = 'ACTIVE'

    if (textToModerate.length > 0) {
      try {
        const modResult = await moderateCreateContent(db, {
          entityType: 'story',
          actorUserId: user.id,
          collegeId: user.collegeId,
          tribeId: user.tribeId,
          caption: textToModerate,
          text: textToModerate,
          metadata: { route: 'POST /stories', type: storyType },
        })
        moderationResult = modResult.decision
        if (moderationResult.action === 'ESCALATE') {
          storyVisibility = 'HELD'
        }
      } catch (err) {
        if (err.details?.code === 'CONTENT_REJECTED_BY_MODERATION') {
          return { error: 'Story rejected by moderation', code: ErrorCode.CONTENT_REJECTED, status: 422 }
        }
        // Non-blocking: allow story if moderation service fails
      }
    }

    // Get user's story settings for defaults
    const settings = await db.collection('story_settings').findOne({ userId: user.id })

    const now = new Date()
    const expiresAt = new Date(now.getTime() + StoryConfig.TTL_HOURS * 60 * 60 * 1000)

    const story = {
      id: uuidv4(),
      authorId: user.id,
      collegeId: user.collegeId || null,
      tribeId: user.tribeId || null,
      type: storyType,
      media,
      text: text ? text.slice(0, StoryConfig.MAX_CAPTION_LENGTH) : null,
      caption: caption ? caption.slice(0, StoryConfig.MAX_CAPTION_LENGTH) : null,
      background: bgConfig,
      stickers: validatedStickers,
      privacy: storyPrivacy,
      replyPrivacy: settings?.replyPrivacy || 'EVERYONE',
      status: storyVisibility,
      viewCount: 0,
      reactionCount: 0,
      replyCount: 0,
      moderation: moderationResult ? {
        action: moderationResult.action,
        provider: moderationResult.provider,
        confidence: moderationResult.confidence,
        checkedAt: now,
      } : null,
      expiresAt,
      archived: false,
      createdAt: now,
      updatedAt: now,
    }

    await db.collection('stories').insertOne(story)

    await writeAudit(db, 'STORY_CREATED', user.id, 'STORY', story.id, {
      type: storyType,
      privacy: storyPrivacy,
      stickerCount: validatedStickers.length,
    })

    await invalidateOnEvent('STORY_CHANGED', { authorId: user.id, collegeId: user.collegeId })

    return { data: { story: sanitizeStory(story) }, status: 201 }
  }

  // ========================
  // GET /stories — Story rail (alias for /stories/feed)
  // ========================
  if (route === 'stories' && method === 'GET') {
    const user = await requireAuth(request, db)
    const storyRail = await buildStoryRail(db, user, sanitizeUser)
    return { data: { items: storyRail, storyRail, count: storyRail.length } }
  }

  // ========================
  // GET /stories/feed — Story rail with seen/unseen
  // ========================
  if (route === 'stories/feed' && method === 'GET') {
    const user = await requireAuth(request, db)
    const storyRail = await buildStoryRail(db, user, sanitizeUser)
    return { data: { items: storyRail, storyRail, count: storyRail.length } }
  }

  // ========================
  // GET /stories/:id — View a single story (tracks view)
  // ========================
  if (path[0] === 'stories' && path.length === 2 && method === 'GET' && !['feed', 'search'].includes(path[1])) {
    const storyId = path[1]
    const story = await db.collection('stories').findOne({ id: storyId })

    if (!story || story.status === StoryStatus.REMOVED) {
      return { error: 'Story not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    if (story.status === StoryStatus.ACTIVE && story.expiresAt && new Date(story.expiresAt) <= new Date()) {
      return { error: 'This story has expired', code: ErrorCode.EXPIRED, status: 410 }
    }

    // Single authenticate call for all checks
    const viewer = await authenticate(request, db)

    if (story.status === StoryStatus.HELD) {
      if (!viewer || (viewer.id !== story.authorId && !isAdmin(viewer))) {
        return { error: 'Story is under review', code: ErrorCode.FORBIDDEN, status: 403 }
      }
    }

    // Block check: ALWAYS check regardless of privacy (block overrides everything)
    if (viewer && viewer.id !== story.authorId) {
      const blocked = await isBlocked(db, story.authorId, viewer.id)
      if (blocked) {
        return { error: 'You do not have access to this story', code: ErrorCode.FORBIDDEN, status: 403 }
      }
    }

    // Privacy check
    if (story.privacy !== 'EVERYONE') {
      if (!viewer) {
        return { error: 'Authentication required to view this story', code: ErrorCode.UNAUTHORIZED, status: 401 }
      }
      const canView = await canViewStory(db, story, viewer.id)
      if (!canView) {
        return { error: 'You do not have access to this story', code: ErrorCode.FORBIDDEN, status: 403 }
      }
    } else if (viewer) {
      // Even for EVERYONE stories, check hideStoryFrom
      const settings = await db.collection('story_settings').findOne({ userId: story.authorId })
      if (settings?.hideStoryFrom?.includes(viewer.id)) {
        return { error: 'You do not have access to this story', code: ErrorCode.FORBIDDEN, status: 403 }
      }
    }

    // Track view (deduped per viewer per story)
    if (viewer && viewer.id !== story.authorId) {
      const viewResult = await db.collection('story_views').updateOne(
        { storyId: story.id, viewerId: viewer.id },
        {
          $setOnInsert: {
            id: uuidv4(),
            storyId: story.id,
            viewerId: viewer.id,
            authorId: story.authorId,
            viewedAt: new Date(),
          },
        },
        { upsert: true }
      )
      // Only increment viewCount on first view
      if (viewResult.upsertedCount > 0) {
        await db.collection('stories').updateOne(
          { id: story.id },
          { $inc: { viewCount: 1 } }
        )
        // Real-time event: notify author
        publishStoryEvent(story.authorId, {
          type: StoryEventType.VIEWED,
          storyId: story.id,
          viewer: { id: viewer.id, displayName: viewer.displayName, username: viewer.username },
          viewCount: (story.viewCount || 0) + 1,
        })
      }
    }

    // Get viewer's reaction if any
    let viewerReaction = null
    if (viewer) {
      const reaction = await db.collection('story_reactions').findOne({
        storyId: story.id,
        userId: viewer.id,
      })
      if (reaction) viewerReaction = reaction.emoji
    }

    // Get sticker results for viewer
    const stickersWithResults = await enrichStickersForViewer(db, story, viewer?.id)

    const result = sanitizeStory(story)
    result.stickers = stickersWithResults
    result.viewerReaction = viewerReaction
    result.author = sanitizeUser(await db.collection('users').findOne({ id: story.authorId }))

    return { data: { story: result } }
  }

  // ========================
  // DELETE /stories/:id — Delete a story
  // ========================
  if (path[0] === 'stories' && path.length === 2 && method === 'DELETE' && !['feed'].includes(path[1])) {
    const user = await requireAuth(request, db)
    const storyId = path[1]
    const story = await db.collection('stories').findOne({ id: storyId })

    if (!story) return { error: 'Story not found', code: ErrorCode.NOT_FOUND, status: 404 }

    if (story.authorId !== user.id && !isAdmin(user)) {
      return { error: 'Forbidden', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    await db.collection('stories').updateOne(
      { id: storyId },
      { $set: { status: StoryStatus.REMOVED, updatedAt: new Date() } }
    )

    await writeAudit(db, 'STORY_DELETED', user.id, 'STORY', storyId, {
      deletedBy: user.id === story.authorId ? 'AUTHOR' : 'MODERATOR',
    })

    await invalidateOnEvent('STORY_CHANGED', { authorId: story.authorId, collegeId: story.collegeId })

    return { data: { message: 'Story deleted' } }
  }

  // ========================
  // GET /stories/:id/views — Viewers list (owner/admin only)
  // ========================
  if (path[0] === 'stories' && path.length === 3 && path[2] === 'views' && method === 'GET') {
    const user = await requireAuth(request, db)
    const storyId = path[1]
    const story = await db.collection('stories').findOne({ id: storyId })

    if (!story) return { error: 'Story not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (story.authorId !== user.id && !isAdmin(user)) {
      return { error: 'Only story owner can view the viewers list', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const url = new URL(request.url)
    const { limit, offset } = parsePagination(url)

    const views = await db.collection('story_views')
      .find({ storyId })
      .sort({ viewedAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray()

    const viewerIds = views.map(v => v.viewerId)
    const viewers = await db.collection('users').find({ id: { $in: viewerIds } }).toArray()
    const viewerMap = Object.fromEntries(viewers.map(u => [u.id, sanitizeUser(u)]))

    const totalViews = await db.collection('story_views').countDocuments({ storyId })

    const items = views.map(v => ({
      viewer: viewerMap[v.viewerId] || null,
      viewedAt: v.viewedAt,
    }))

    return { data: { items, pagination: { total: totalViews }, total: totalViews, storyId } }
  }

  // ========================
  // POST /stories/:id/react — React to a story with emoji
  // ========================
  if (path[0] === 'stories' && path.length === 3 && path[2] === 'react' && method === 'POST') {
    const user = await requireAuth(request, db)
    const storyId = path[1]
    const body = await request.json()
    const { emoji } = body

    if (!emoji || !StoryConfig.VALID_REACTIONS.includes(emoji)) {
      return { error: `Invalid reaction. Must be one of: ${StoryConfig.VALID_REACTIONS.join(', ')}`, code: ErrorCode.VALIDATION, status: 400 }
    }

    const story = await db.collection('stories').findOne({ id: storyId, status: StoryStatus.ACTIVE, expiresAt: { $gt: new Date() } })
    if (!story) return { error: 'Story not found or expired', code: ErrorCode.NOT_FOUND, status: 404 }

    // Anti-abuse: check story reaction velocity
    const abuseCheck = checkEngagementAbuse(user.id, ActionType.STORY_REACTION, storyId, story.authorId)
    if (abuseCheck.flagged) await logSuspiciousAction(db, user.id, ActionType.STORY_REACTION, storyId, abuseCheck)
    if (!abuseCheck.allowed) {
      return { error: abuseCheck.reason, code: 'ABUSE_DETECTED', status: 429 }
    }

    if (story.authorId === user.id) {
      return { error: 'Cannot react to your own story', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Block check
    const blockCheck = await canInteractWithStory(db, story, user.id)
    if (!blockCheck.allowed) {
      return { error: blockCheck.error, code: ErrorCode.FORBIDDEN, status: 403 }
    }

    // Privacy check
    const canView = await canViewStory(db, story, user.id)
    if (!canView) return { error: 'Access denied', code: ErrorCode.FORBIDDEN, status: 403 }

    // Upsert reaction (one per user per story, can change emoji)
    await db.collection('story_reactions').updateOne(
      { storyId, userId: user.id },
      {
        $set: { emoji, updatedAt: new Date() },
        $setOnInsert: {
          id: uuidv4(),
          storyId,
          userId: user.id,
          authorId: story.authorId,
          createdAt: new Date(),
        },
      },
      { upsert: true }
    )

    // Recompute reaction count
    const reactionCount = await db.collection('story_reactions').countDocuments({ storyId })
    await db.collection('stories').updateOne({ id: storyId }, { $set: { reactionCount } })

    // Notify author
    await createNotification(db, story.authorId, 'STORY_REACTION', user.id, 'STORY', storyId,
      `${user.displayName || user.username} reacted ${emoji} to your story`)

    // Real-time event
    publishStoryEvent(story.authorId, {
      type: StoryEventType.REACTED,
      storyId,
      reactor: { id: user.id, displayName: user.displayName, username: user.username },
      emoji,
      reactionCount,
    })

    return { data: { message: 'Reaction recorded', emoji, storyId } }
  }

  // ========================
  // DELETE /stories/:id/react — Remove reaction
  // ========================
  if (path[0] === 'stories' && path.length === 3 && path[2] === 'react' && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const storyId = path[1]

    const deleted = await db.collection('story_reactions').deleteOne({ storyId, userId: user.id })
    if (deleted.deletedCount === 0) {
      return { error: 'No reaction found', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    const reactionCount = await db.collection('story_reactions').countDocuments({ storyId })
    await db.collection('stories').updateOne({ id: storyId }, { $set: { reactionCount } })

    return { data: { message: 'Reaction removed' } }
  }

  // ========================
  // POST /stories/:id/reply — Reply to a story
  // ========================
  if (path[0] === 'stories' && path.length === 3 && path[2] === 'reply' && method === 'POST') {
    const user = await requireAuth(request, db)
    const storyId = path[1]
    const body = await request.json()
    const { text } = body

    if (!text?.trim() || text.length > StoryConfig.MAX_REPLY_LENGTH) {
      return { error: `Reply must be 1-${StoryConfig.MAX_REPLY_LENGTH} characters`, code: ErrorCode.VALIDATION, status: 400 }
    }

    // Reply rate limit: max 20 replies per user per hour
    const replyHourAgo = new Date(Date.now() - 3600_000)
    const recentReplies = await db.collection('story_replies').countDocuments({
      senderId: user.id,
      createdAt: { $gte: replyHourAgo },
    })
    if (recentReplies >= 20) {
      return { error: 'Reply rate limit: max 20 replies per hour', code: ErrorCode.RATE_LIMITED, status: 429 }
    }

    const story = await db.collection('stories').findOne({ id: storyId, status: StoryStatus.ACTIVE, expiresAt: { $gt: new Date() } })
    if (!story) return { error: 'Story not found or expired', code: ErrorCode.NOT_FOUND, status: 404 }

    if (story.authorId === user.id) {
      return { error: 'Cannot reply to your own story', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Block check
    const blockCheck = await canInteractWithStory(db, story, user.id)
    if (!blockCheck.allowed) {
      return { error: blockCheck.error, code: ErrorCode.FORBIDDEN, status: 403 }
    }

    // Check reply privacy
    const canReply = await checkReplyPermission(db, story, user.id)
    if (!canReply) {
      return { error: 'Replies are restricted for this story', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    // Moderate reply text
    try {
      await moderateCreateContent(db, {
        entityType: 'story_reply',
        actorUserId: user.id,
        collegeId: user.collegeId,
        text,
        metadata: { storyId },
      })
    } catch (err) {
      if (err.details?.code === 'CONTENT_REJECTED_BY_MODERATION') {
        return { error: 'Reply rejected by moderation', code: ErrorCode.CONTENT_REJECTED, status: 422 }
      }
    }

    const reply = {
      id: uuidv4(),
      storyId,
      authorId: story.authorId,
      senderId: user.id,
      text: text.trim(),
      createdAt: new Date(),
    }

    await db.collection('story_replies').insertOne(reply)

    // Recompute replyCount from source (avoids drift from $inc)
    const replyCount = await db.collection('story_replies').countDocuments({ storyId })
    await db.collection('stories').updateOne({ id: storyId }, { $set: { replyCount } })

    await createNotification(db, story.authorId, 'STORY_REPLY', user.id, 'STORY', storyId,
      `${user.displayName || user.username} replied to your story`)

    // Real-time event
    publishStoryEvent(story.authorId, {
      type: StoryEventType.REPLIED,
      storyId,
      sender: { id: user.id, displayName: user.displayName, username: user.username },
      preview: text.trim().slice(0, 50),
      replyCount,
    })

    const { _id, ...cleanReply } = reply
    return { data: { reply: cleanReply }, status: 201 }
  }

  // ========================
  // GET /stories/:id/replies — Get story replies (owner only)
  // ========================
  if (path[0] === 'stories' && path.length === 3 && path[2] === 'replies' && method === 'GET') {
    const user = await requireAuth(request, db)
    const storyId = path[1]
    const story = await db.collection('stories').findOne({ id: storyId })

    if (!story) return { error: 'Story not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (story.authorId !== user.id && !isAdmin(user)) {
      return { error: 'Only story owner can view replies', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const url = new URL(request.url)
    const { limit, offset } = parsePagination(url)

    const replies = await db.collection('story_replies')
      .find({ storyId })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray()

    const senderIds = [...new Set(replies.map(r => r.senderId))]
    const senders = await db.collection('users').find({ id: { $in: senderIds } }).toArray()
    const senderMap = Object.fromEntries(senders.map(u => [u.id, sanitizeUser(u)]))

    const items = replies.map(r => {
      const { _id, ...clean } = r
      return { ...clean, sender: senderMap[r.senderId] || null }
    })

    const total = await db.collection('story_replies').countDocuments({ storyId })

    return { data: { items, pagination: { total }, total, storyId } }
  }

  // ========================
  // POST /stories/:id/sticker/:stickerId/respond — Respond to interactive sticker
  // ========================
  if (path[0] === 'stories' && path.length === 5 && path[2] === 'sticker' && path[4] === 'respond' && method === 'POST') {
    const user = await requireAuth(request, db)
    const storyId = path[1]
    const stickerId = path[3]
    const body = await request.json()

    const story = await db.collection('stories').findOne({ id: storyId, status: StoryStatus.ACTIVE, expiresAt: { $gt: new Date() } })
    if (!story) return { error: 'Story not found or expired', code: ErrorCode.NOT_FOUND, status: 404 }

    // Rate limit: max 30 sticker responses per user per hour
    const stickerHourAgo = new Date(Date.now() - 3600_000)
    const recentStickerResponses = await db.collection('story_sticker_responses').countDocuments({
      userId: user.id,
      createdAt: { $gte: stickerHourAgo },
    })
    if (recentStickerResponses >= 30) {
      return { error: 'Sticker response rate limit: max 30 per hour', code: ErrorCode.RATE_LIMITED, status: 429 }
    }

    // Block check
    const blockCheck = await canInteractWithStory(db, story, user.id)
    if (!blockCheck.allowed) {
      return { error: blockCheck.error, code: ErrorCode.FORBIDDEN, status: 403 }
    }

    // Privacy check
    const canView = await canViewStory(db, story, user.id)
    if (!canView) return { error: 'Access denied', code: ErrorCode.FORBIDDEN, status: 403 }

    // Find the sticker
    const sticker = story.stickers?.find(s => s.id === stickerId)
    if (!sticker) return { error: 'Sticker not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Validate response based on sticker type
    const responseResult = validateStickerResponse(sticker, body)
    if (responseResult.error) return { error: responseResult.error, code: ErrorCode.VALIDATION, status: 400 }

    // Check if already responded (for POLL and QUIZ, one response only; for QUESTION and EMOJI_SLIDER, also one)
    const existing = await db.collection('story_sticker_responses').findOne({
      storyId, stickerId, userId: user.id,
    })

    if (existing && ['POLL', 'QUIZ'].includes(sticker.type)) {
      return { error: 'You have already responded to this sticker', code: ErrorCode.CONFLICT, status: 409 }
    }

    if (existing) {
      // Update existing response for QUESTION, EMOJI_SLIDER
      await db.collection('story_sticker_responses').updateOne(
        { storyId, stickerId, userId: user.id },
        { $set: { response: responseResult.response, updatedAt: new Date() } }
      )
    } else {
      await db.collection('story_sticker_responses').insertOne({
        id: uuidv4(),
        storyId,
        stickerId,
        stickerType: sticker.type,
        userId: user.id,
        authorId: story.authorId,
        response: responseResult.response,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    }

    // Get updated results
    const results = await getStickerResults(db, storyId, stickerId, sticker)

    // Real-time event
    publishStoryEvent(story.authorId, {
      type: StoryEventType.STICKER_RESPONDED,
      storyId,
      stickerId,
      stickerType: sticker.type,
      responder: { id: user.id, displayName: user.displayName, username: user.username },
    })

    return { data: { message: 'Response recorded', stickerId, results } }
  }

  // ========================
  // GET /stories/:id/sticker/:stickerId/results — Get sticker results
  // ========================
  if (path[0] === 'stories' && path.length === 5 && path[2] === 'sticker' && path[4] === 'results' && method === 'GET') {
    const viewer = await authenticate(request, db)
    const storyId = path[1]
    const stickerId = path[3]

    const story = await db.collection('stories').findOne({ id: storyId })
    if (!story) return { error: 'Story not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const sticker = story.stickers?.find(s => s.id === stickerId)
    if (!sticker) return { error: 'Sticker not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const results = await getStickerResults(db, storyId, stickerId, sticker)

    // Add viewer's response
    let viewerResponse = null
    if (viewer) {
      const resp = await db.collection('story_sticker_responses').findOne({
        storyId, stickerId, userId: viewer.id,
      })
      if (resp) viewerResponse = resp.response
    }

    return { data: { stickerId, stickerType: sticker.type, results, viewerResponse } }
  }

  // ========================
  // GET /stories/:id/sticker/:stickerId/responses — Get all responses (owner/admin)
  // ========================
  if (path[0] === 'stories' && path.length === 5 && path[2] === 'sticker' && path[4] === 'responses' && method === 'GET') {
    const user = await requireAuth(request, db)
    const storyId = path[1]
    const stickerId = path[3]

    const story = await db.collection('stories').findOne({ id: storyId })
    if (!story) return { error: 'Story not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (story.authorId !== user.id && !isAdmin(user)) {
      return { error: 'Only story owner can view all responses', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const url = new URL(request.url)
    const { limit, offset } = parsePagination(url)

    const responses = await db.collection('story_sticker_responses')
      .find({ storyId, stickerId })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray()

    const userIds = [...new Set(responses.map(r => r.userId))]
    const users = await db.collection('users').find({ id: { $in: userIds } }).toArray()
    const userMap = Object.fromEntries(users.map(u => [u.id, sanitizeUser(u)]))

    const items = responses.map(r => {
      const { _id, ...clean } = r
      return { ...clean, user: userMap[r.userId] || null }
    })

    const total = await db.collection('story_sticker_responses').countDocuments({ storyId, stickerId })

    return { data: { items, pagination: { total }, total, storyId, stickerId } }
  }

  // ========================
  // GET /me/stories/archive — My archived/expired stories
  // ========================
  if (path[0] === 'me' && path[1] === 'stories' && path[2] === 'archive' && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const { limit, cursor } = parsePagination(url)

    const query = {
      authorId: user.id,
      status: { $in: [StoryStatus.ACTIVE, StoryStatus.EXPIRED] },
    }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }

    const stories = await db.collection('stories')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = stories.length > limit
    const items = sanitizeStories(stories.slice(0, limit))

    return {
      data: {
        items,
        pagination: {
          nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
          hasMore,
        },
        nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
        total: await db.collection('stories').countDocuments({ authorId: user.id, status: { $ne: StoryStatus.REMOVED } }),
      },
    }
  }

  // ========================
  // GET /users/:userId/stories — User's active stories
  // ========================
  if (path[0] === 'users' && path.length === 3 && path[2] === 'stories' && method === 'GET') {
    const viewer = await authenticate(request, db)
    const targetUserId = path[1]
    const now = new Date()

    const targetUser = await db.collection('users').findOne({ id: targetUserId })
    if (!targetUser) return { error: 'User not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Get active stories
    const stories = await db.collection('stories')
      .find({
        authorId: targetUserId,
        status: StoryStatus.ACTIVE,
        expiresAt: { $gt: now },
      })
      .sort({ createdAt: -1 })
      .toArray()

    // Filter by privacy + hideStoryFrom
    const visibleStories = []
    for (const story of stories) {
      if (viewer) {
        const canView = await canViewStory(db, story, viewer.id)
        if (canView) visibleStories.push(story)
      } else if (story.privacy === 'EVERYONE') {
        visibleStories.push(story)
      }
    }

    // Mark seen/unseen
    let viewedSet = new Set()
    if (viewer) {
      const storyIds = visibleStories.map(s => s.id)
      const views = await db.collection('story_views')
        .find({ storyId: { $in: storyIds }, viewerId: viewer.id })
        .project({ storyId: 1, _id: 0 })
        .toArray()
      viewedSet = new Set(views.map(v => v.storyId))
    }

    const items = visibleStories.map(s => {
      const clean = sanitizeStory(s)
      clean.seen = viewedSet.has(s.id)
      return clean
    })

    return {
      data: {
        user: sanitizeUser(targetUser),
        stories: items,
        total: items.length,
      },
    }
  }

  // ========================
  // CLOSE FRIENDS
  // ========================

  // GET /me/close-friends — List close friends
  if (route === 'me/close-friends' && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const { limit, offset } = parsePagination(url)

    const entries = await db.collection('close_friends')
      .find({ userId: user.id })
      .sort({ addedAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray()

    const friendIds = entries.map(e => e.friendId)
    const friends = await db.collection('users').find({ id: { $in: friendIds } }).toArray()
    const friendMap = Object.fromEntries(friends.map(u => [u.id, sanitizeUser(u)]))

    const items = entries.map(e => ({
      friendId: e.friendId,
      friend: friendMap[e.friendId] || null,
      addedAt: e.addedAt,
    }))

    const total = await db.collection('close_friends').countDocuments({ userId: user.id })

    return { data: { items, pagination: { total }, count: total } }
  }

  // POST /me/close-friends/:userId — Add to close friends (DB-safe max enforcement)
  if (path[0] === 'me' && path[1] === 'close-friends' && path.length === 3 && method === 'POST') {
    const user = await requireAuth(request, db)
    const friendId = path[2]

    if (friendId === user.id) {
      return { error: 'Cannot add yourself to close friends', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Check friend exists
    const friend = await db.collection('users').findOne({ id: friendId })
    if (!friend) return { error: 'User not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Block check: can't add blocked user as close friend
    const blocked = await isBlocked(db, user.id, friendId)
    if (blocked) return { error: 'Cannot add a blocked user to close friends', code: ErrorCode.FORBIDDEN, status: 403 }

    // DB-safe max enforcement: upsert first, then count, rollback if exceeded
    const upsertResult = await db.collection('close_friends').updateOne(
      { userId: user.id, friendId },
      {
        $setOnInsert: {
          id: uuidv4(),
          userId: user.id,
          friendId,
          addedAt: new Date(),
        },
      },
      { upsert: true }
    )

    // If this was an existing entry (idempotent), return success
    if (upsertResult.upsertedCount === 0) {
      return { data: { message: 'Already in close friends', friendId } }
    }

    // Post-insert count check: if over limit, rollback the insert
    const count = await db.collection('close_friends').countDocuments({ userId: user.id })
    if (count > StoryConfig.MAX_CLOSE_FRIENDS) {
      await db.collection('close_friends').deleteOne({ userId: user.id, friendId })
      return { error: `Close friends limit reached (${StoryConfig.MAX_CLOSE_FRIENDS})`, code: ErrorCode.RATE_LIMITED, status: 429 }
    }

    return { data: { message: 'Added to close friends', friendId } }
  }

  // DELETE /me/close-friends/:userId — Remove from close friends
  if (path[0] === 'me' && path[1] === 'close-friends' && path.length === 3 && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const friendId = path[2]

    const result = await db.collection('close_friends').deleteOne({ userId: user.id, friendId })
    if (result.deletedCount === 0) {
      return { error: 'Not in close friends', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    return { data: { message: 'Removed from close friends', friendId } }
  }

  // ========================
  // HIGHLIGHTS
  // ========================

  // POST /me/highlights — Create highlight (DB-safe max enforcement)
  if (route === 'me/highlights' && method === 'POST') {
    const user = await requireAuth(request, db)
    const body = await request.json()
    const { name, coverMediaId, storyIds } = body

    if (!name?.trim() || name.length > StoryConfig.MAX_HIGHLIGHT_NAME_LENGTH) {
      return { error: `Highlight name must be 1-${StoryConfig.MAX_HIGHLIGHT_NAME_LENGTH} characters`, code: ErrorCode.VALIDATION, status: 400 }
    }

    // Resolve cover
    let coverUrl = null
    if (coverMediaId) {
      const asset = await db.collection('media_assets').findOne({ id: coverMediaId, ownerId: user.id })
      if (asset) coverUrl = `/api/media/${asset.id}`
    }

    const highlight = {
      id: uuidv4(),
      userId: user.id,
      name: name.trim(),
      coverUrl,
      coverMediaId: coverMediaId || null,
      storyCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    // Insert first, then count. Rollback if over limit (DB-safe TOCTOU fix)
    await db.collection('story_highlights').insertOne(highlight)

    const count = await db.collection('story_highlights').countDocuments({ userId: user.id })
    if (count > StoryConfig.MAX_HIGHLIGHTS_PER_USER) {
      await db.collection('story_highlights').deleteOne({ id: highlight.id })
      return { error: `Maximum ${StoryConfig.MAX_HIGHLIGHTS_PER_USER} highlights allowed`, code: ErrorCode.RATE_LIMITED, status: 429 }
    }

    // Add initial stories if provided
    if (storyIds && Array.isArray(storyIds) && storyIds.length > 0) {
      const validStories = await db.collection('stories')
        .find({ id: { $in: storyIds }, authorId: user.id })
        .toArray()

      if (validStories.length > 0) {
        const items = validStories.map((s, idx) => ({
          id: uuidv4(),
          highlightId: highlight.id,
          storyId: s.id,
          userId: user.id,
          order: idx,
          addedAt: new Date(),
        }))
        await db.collection('story_highlight_items').insertMany(items)
        await db.collection('story_highlights').updateOne(
          { id: highlight.id },
          { $set: { storyCount: validStories.length } }
        )
        highlight.storyCount = validStories.length
      }
    }

    const { _id, ...cleanHighlight } = highlight
    return { data: { highlight: cleanHighlight }, status: 201 }
  }

  // GET /users/:userId/highlights — User's highlights (BATCH OPTIMIZED: 3 queries, not 2N+1)
  if (path[0] === 'users' && path.length === 3 && path[2] === 'highlights' && method === 'GET') {
    const targetUserId = path[1]

    const highlights = await db.collection('story_highlights')
      .find({ userId: targetUserId })
      .sort({ createdAt: -1 })
      .toArray()

    if (highlights.length === 0) {
      return { data: { items: [], highlights: [], count: 0 } }
    }

    const highlightIds = highlights.map(h => h.id)

    // Batch: get ALL highlight items in one query
    const allItems = await db.collection('story_highlight_items')
      .find({ highlightId: { $in: highlightIds } })
      .sort({ highlightId: 1, order: 1 })
      .toArray()

    // Batch: get ALL referenced stories in one query
    const allStoryIds = [...new Set(allItems.map(i => i.storyId))]
    const allStories = allStoryIds.length > 0
      ? await db.collection('stories').find({ id: { $in: allStoryIds } }).toArray()
      : []
    const storyMap = Object.fromEntries(allStories.map(s => [s.id, s]))

    // Group items by highlight
    const itemsByHighlight = {}
    for (const item of allItems) {
      if (!itemsByHighlight[item.highlightId]) itemsByHighlight[item.highlightId] = []
      itemsByHighlight[item.highlightId].push(item)
    }

    // Assemble: zero additional queries
    const result = highlights.map(h => {
      const { _id, ...clean } = h
      const items = itemsByHighlight[h.id] || []
      clean.stories = sanitizeStories(
        items.map(i => storyMap[i.storyId]).filter(Boolean)
      )
      return clean
    })

    return { data: { items: result, highlights: result, count: result.length } }
  }

  // PATCH /me/highlights/:id — Edit highlight
  if (path[0] === 'me' && path[1] === 'highlights' && path.length === 3 && method === 'PATCH') {
    const user = await requireAuth(request, db)
    const highlightId = path[2]
    const body = await request.json()

    const highlight = await db.collection('story_highlights').findOne({ id: highlightId, userId: user.id })
    if (!highlight) return { error: 'Highlight not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const updates = { updatedAt: new Date() }

    if (body.name !== undefined) {
      if (!body.name?.trim() || body.name.length > StoryConfig.MAX_HIGHLIGHT_NAME_LENGTH) {
        return { error: `Name must be 1-${StoryConfig.MAX_HIGHLIGHT_NAME_LENGTH} characters`, code: ErrorCode.VALIDATION, status: 400 }
      }
      updates.name = body.name.trim()
    }

    if (body.coverMediaId !== undefined) {
      if (body.coverMediaId) {
        const asset = await db.collection('media_assets').findOne({ id: body.coverMediaId, ownerId: user.id })
        if (asset) {
          updates.coverUrl = `/api/media/${asset.id}`
          updates.coverMediaId = asset.id
        }
      } else {
        updates.coverUrl = null
        updates.coverMediaId = null
      }
    }

    // Add stories
    if (body.addStoryIds && Array.isArray(body.addStoryIds)) {
      const validStories = await db.collection('stories')
        .find({ id: { $in: body.addStoryIds }, authorId: user.id })
        .toArray()

      const currentCount = await db.collection('story_highlight_items').countDocuments({ highlightId })
      const maxOrder = currentCount

      if (currentCount + validStories.length > StoryConfig.MAX_STORIES_PER_HIGHLIGHT) {
        return { error: `Maximum ${StoryConfig.MAX_STORIES_PER_HIGHLIGHT} stories per highlight`, code: ErrorCode.VALIDATION, status: 400 }
      }

      for (let i = 0; i < validStories.length; i++) {
        await db.collection('story_highlight_items').updateOne(
          { highlightId, storyId: validStories[i].id },
          {
            $setOnInsert: {
              id: uuidv4(),
              highlightId,
              storyId: validStories[i].id,
              userId: user.id,
              order: maxOrder + i,
              addedAt: new Date(),
            },
          },
          { upsert: true }
        )
      }
    }

    // Remove stories
    if (body.removeStoryIds && Array.isArray(body.removeStoryIds)) {
      await db.collection('story_highlight_items').deleteMany({
        highlightId,
        storyId: { $in: body.removeStoryIds },
      })
    }

    // Recompute story count
    const storyCount = await db.collection('story_highlight_items').countDocuments({ highlightId })
    updates.storyCount = storyCount

    await db.collection('story_highlights').updateOne({ id: highlightId }, { $set: updates })

    const updated = await db.collection('story_highlights').findOne({ id: highlightId })
    const { _id, ...cleanHighlight } = updated
    return { data: { highlight: cleanHighlight } }
  }

  // DELETE /me/highlights/:id — Delete highlight
  if (path[0] === 'me' && path[1] === 'highlights' && path.length === 3 && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const highlightId = path[2]

    const highlight = await db.collection('story_highlights').findOne({ id: highlightId, userId: user.id })
    if (!highlight) return { error: 'Highlight not found', code: ErrorCode.NOT_FOUND, status: 404 }

    await db.collection('story_highlight_items').deleteMany({ highlightId })
    await db.collection('story_highlights').deleteOne({ id: highlightId })

    return { data: { message: 'Highlight deleted' } }
  }

  // ========================
  // STORY SETTINGS
  // ========================

  // GET /me/story-settings
  if (route === 'me/story-settings' && method === 'GET') {
    const user = await requireAuth(request, db)
    const settings = await db.collection('story_settings').findOne({ userId: user.id })

    const defaults = {
      userId: user.id,
      privacy: 'EVERYONE',
      replyPrivacy: 'EVERYONE',
      allowSharing: true,
      autoArchive: true,
      hideStoryFrom: [],
    }

    if (!settings) return { data: { settings: defaults } }
    const { _id, ...clean } = settings
    return { data: { settings: { ...defaults, ...clean } } }
  }

  // PATCH /me/story-settings
  if (route === 'me/story-settings' && method === 'PATCH') {
    const user = await requireAuth(request, db)
    const body = await request.json()
    const updates = { updatedAt: new Date() }

    if (body.privacy !== undefined) {
      if (!StoryConfig.VALID_PRIVACY.includes(body.privacy)) {
        return { error: `Invalid privacy. Must be one of: ${StoryConfig.VALID_PRIVACY.join(', ')}`, code: ErrorCode.VALIDATION, status: 400 }
      }
      updates.privacy = body.privacy
    }
    if (body.replyPrivacy !== undefined) {
      if (!StoryConfig.VALID_REPLY_PRIVACY.includes(body.replyPrivacy)) {
        return { error: `Invalid replyPrivacy. Must be one of: ${StoryConfig.VALID_REPLY_PRIVACY.join(', ')}`, code: ErrorCode.VALIDATION, status: 400 }
      }
      updates.replyPrivacy = body.replyPrivacy
    }
    if (body.allowSharing !== undefined) updates.allowSharing = !!body.allowSharing
    if (body.autoArchive !== undefined) updates.autoArchive = !!body.autoArchive
    if (body.hideStoryFrom !== undefined) {
      if (!Array.isArray(body.hideStoryFrom)) {
        return { error: 'hideStoryFrom must be an array of user IDs', code: ErrorCode.VALIDATION, status: 400 }
      }
      updates.hideStoryFrom = body.hideStoryFrom
    }

    await db.collection('story_settings').updateOne(
      { userId: user.id },
      { $set: updates, $setOnInsert: { userId: user.id, createdAt: new Date() } },
      { upsert: true }
    )

    const updated = await db.collection('story_settings').findOne({ userId: user.id })
    const { _id, ...clean } = updated
    return { data: { settings: clean } }
  }

  // ========================
  // ADMIN
  // ========================

  // GET /admin/stories/analytics — Story analytics (MUST be before generic GET /admin/stories)
  if (path[0] === 'admin' && path[1] === 'stories' && path[2] === 'analytics' && method === 'GET') {
    const user = await requireAuth(request, db)
    requireRole(user, 'ADMIN', 'SUPER_ADMIN')

    const now = new Date()
    const dayAgo = new Date(now.getTime() - 86400_000)
    const weekAgo = new Date(now.getTime() - 7 * 86400_000)

    const [
      totalStories,
      activeStories,
      storiesLast24h,
      storiesLastWeek,
      totalViews,
      totalReactions,
      totalReplies,
      topCreators,
    ] = await Promise.all([
      db.collection('stories').countDocuments(),
      db.collection('stories').countDocuments({ status: StoryStatus.ACTIVE, expiresAt: { $gt: now } }),
      db.collection('stories').countDocuments({ createdAt: { $gte: dayAgo } }),
      db.collection('stories').countDocuments({ createdAt: { $gte: weekAgo } }),
      db.collection('story_views').countDocuments(),
      db.collection('story_reactions').countDocuments(),
      db.collection('story_replies').countDocuments(),
      db.collection('stories').aggregate([
        { $match: { createdAt: { $gte: weekAgo } } },
        { $group: { _id: '$authorId', count: { $sum: 1 }, totalViews: { $sum: '$viewCount' } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]).toArray(),
    ])

    // Enrich top creators
    const creatorIds = topCreators.map(c => c._id)
    const creators = await db.collection('users').find({ id: { $in: creatorIds } }).toArray()
    const creatorMap = Object.fromEntries(creators.map(u => [u.id, sanitizeUser(u)]))

    return {
      data: {
        totalStories,
        activeStories,
        storiesLast24h,
        storiesLastWeek,
        totalViews,
        totalReactions,
        totalReplies,
        topCreators: topCreators.map(c => ({
          user: creatorMap[c._id] || null,
          storyCount: c.count,
          totalViews: c.totalViews,
        })),
        timestamp: now.toISOString(),
      },
    }
  }

  // GET /admin/stories — Moderation queue + stats
  if (path[0] === 'admin' && path[1] === 'stories' && path.length === 2 && method === 'GET') {
    const user = await requireAuth(request, db)
    requireRole(user, 'MODERATOR', 'ADMIN', 'SUPER_ADMIN')

    const url = new URL(request.url)
    const status = url.searchParams.get('status') || 'HELD'
    const { limit, offset } = parsePagination(url)

    const query = {}
    if (status !== 'ALL') query.status = status

    const [stories, total, stats] = await Promise.all([
      db.collection('stories')
        .find(query)
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      db.collection('stories').countDocuments(query),
      db.collection('stories').aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
          },
        },
      ]).toArray(),
    ])

    // Enrich with author
    const authorIds = [...new Set(stories.map(s => s.authorId))]
    const authors = await db.collection('users').find({ id: { $in: authorIds } }).toArray()
    const authorMap = Object.fromEntries(authors.map(a => [a.id, sanitizeUser(a)]))

    const items = stories.map(s => {
      const clean = sanitizeStory(s)
      clean.author = authorMap[s.authorId] || null
      return clean
    })

    const statusCounts = Object.fromEntries(stats.map(s => [s._id, s.count]))

    return {
      data: {
        items,
        total,
        stats: statusCounts,
        filters: { status },
      },
    }
  }

  // PATCH /admin/stories/:id/moderate — Moderate a story
  if (path[0] === 'admin' && path[1] === 'stories' && path.length === 4 && path[3] === 'moderate' && method === 'PATCH') {
    const user = await requireAuth(request, db)
    requireRole(user, 'MODERATOR', 'ADMIN', 'SUPER_ADMIN')

    const storyId = path[2]
    const body = await request.json()
    const { action, reason } = body

    if (!action || !['APPROVE', 'REMOVE', 'HOLD'].includes(action)) {
      return { error: 'action must be one of: APPROVE, REMOVE, HOLD', code: ErrorCode.VALIDATION, status: 400 }
    }

    const story = await db.collection('stories').findOne({ id: storyId })
    if (!story) return { error: 'Story not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const statusMap = { APPROVE: StoryStatus.ACTIVE, REMOVE: StoryStatus.REMOVED, HOLD: StoryStatus.HELD }
    const newStatus = statusMap[action]

    await db.collection('stories').updateOne(
      { id: storyId },
      {
        $set: {
          status: newStatus,
          updatedAt: new Date(),
          moderatedBy: user.id,
          moderatedAt: new Date(),
          moderationReason: reason || null,
        },
      }
    )

    await writeAudit(db, 'STORY_MODERATED', user.id, 'STORY', storyId, {
      action,
      previousStatus: story.status,
      newStatus,
      reason,
    })

    // Notify author
    if (action === 'REMOVE') {
      await createNotification(db, story.authorId, 'STORY_REMOVED', user.id, 'STORY', storyId,
        'Your story has been removed by moderation')
    }

    return { data: { message: `Story ${action === 'HOLD' ? 'held' : action.toLowerCase() + 'd'}`, storyId, status: newStatus } }
  }

  // ========================
  // BLOCK / UNBLOCK USERS
  // ========================

  // POST /me/blocks/:userId — Block a user
  if (path[0] === 'me' && path[1] === 'blocks' && path.length === 3 && method === 'POST') {
    const user = await requireAuth(request, db)
    const blockedId = path[2]

    if (blockedId === user.id) {
      return { error: 'Cannot block yourself', code: ErrorCode.VALIDATION, status: 400 }
    }

    const target = await db.collection('users').findOne({ id: blockedId })
    if (!target) return { error: 'User not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Upsert block (idempotent)
    await db.collection('blocks').updateOne(
      { blockerId: user.id, blockedId },
      {
        $setOnInsert: {
          id: uuidv4(),
          blockerId: user.id,
          blockedId,
          createdAt: new Date(),
        },
      },
      { upsert: true }
    )

    // Also remove from close friends (both directions)
    await Promise.all([
      db.collection('close_friends').deleteOne({ userId: user.id, friendId: blockedId }),
      db.collection('close_friends').deleteOne({ userId: blockedId, friendId: user.id }),
    ])

    await writeAudit(db, 'USER_BLOCKED', user.id, 'USER', blockedId, {})

    return { data: { message: 'User blocked', blockedId } }
  }

  // DELETE /me/blocks/:userId — Unblock a user
  if (path[0] === 'me' && path[1] === 'blocks' && path.length === 3 && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const blockedId = path[2]

    const result = await db.collection('blocks').deleteOne({ blockerId: user.id, blockedId })
    if (result.deletedCount === 0) {
      return { error: 'User is not blocked', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    await writeAudit(db, 'USER_UNBLOCKED', user.id, 'USER', blockedId, {})

    return { data: { message: 'User unblocked', blockedId } }
  }

  // GET /me/blocks — List blocked users
  if (route === 'me/blocks' && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const { limit, offset } = parsePagination(url)

    const blocks = await db.collection('blocks')
      .find({ blockerId: user.id })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray()

    const blockedIds = blocks.map(b => b.blockedId)
    const users = await db.collection('users').find({ id: { $in: blockedIds } }).toArray()
    const userMap = Object.fromEntries(users.map(u => [u.id, sanitizeUser(u)]))

    const items = blocks.map(b => ({
      blockedId: b.blockedId,
      user: userMap[b.blockedId] || null,
      blockedAt: b.createdAt,
    }))

    const total = await db.collection('blocks').countDocuments({ blockerId: user.id })

    return { data: { items, pagination: { total }, count: total } }
  }

  // ========================
  // POST /stories/:id/report — Report a story
  // ========================
  if (path[0] === 'stories' && path.length === 3 && path[2] === 'report' && method === 'POST') {
    const user = await requireAuth(request, db)
    const storyId = path[1]
    const body = await request.json()
    const { reason, reasonCode } = body

    if (!reasonCode?.trim()) {
      return { error: 'reasonCode is required', code: ErrorCode.VALIDATION, status: 400 }
    }

    const story = await db.collection('stories').findOne({ id: storyId })
    if (!story || story.status === StoryStatus.REMOVED) {
      return { error: 'Story not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    if (story.authorId === user.id) {
      return { error: 'Cannot report your own story', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Duplicate report prevention
    const existingReport = await db.collection('reports').findOne({
      targetId: storyId,
      targetType: 'STORY',
      reporterId: user.id,
    })
    if (existingReport) {
      return { error: 'You have already reported this story', code: ErrorCode.CONFLICT, status: 409 }
    }

    const report = {
      id: uuidv4(),
      targetId: storyId,
      targetType: 'STORY',
      reporterId: user.id,
      reasonCode,
      reason: reason?.trim() || null,
      createdAt: new Date(),
    }

    await db.collection('reports').insertOne(report)

    // Increment reportCount and auto-hold at 3+ reports
    const reportCount = await db.collection('reports').countDocuments({ targetId: storyId, targetType: 'STORY' })
    const updateFields = { reportCount }
    if (reportCount >= 3 && story.status === StoryStatus.ACTIVE) {
      updateFields.status = StoryStatus.HELD
    }
    await db.collection('stories').updateOne({ id: storyId }, { $set: updateFields })

    await writeAudit(db, 'STORY_REPORTED', user.id, 'STORY', storyId, { reasonCode, reportCount })

    const { _id, ...cleanReport } = report
    return { data: { report: cleanReport, reportCount }, status: 201 }
  }

  // ========================
  // POST /admin/stories/:id/recompute-counters — Recompute story counters from source of truth
  // ========================
  if (path[0] === 'admin' && path[1] === 'stories' && path.length === 4 && path[3] === 'recompute-counters' && method === 'POST') {
    const user = await requireAuth(request, db)
    requireRole(user, 'ADMIN', 'SUPER_ADMIN')

    const storyId = path[2]
    const story = await db.collection('stories').findOne({ id: storyId })
    if (!story) return { error: 'Story not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Recompute all counters from source of truth
    const [viewCount, reactionCount, replyCount, reportCount] = await Promise.all([
      db.collection('story_views').countDocuments({ storyId }),
      db.collection('story_reactions').countDocuments({ storyId }),
      db.collection('story_replies').countDocuments({ storyId }),
      db.collection('reports').countDocuments({ targetId: storyId, targetType: 'STORY' }),
    ])

    const before = {
      viewCount: story.viewCount,
      reactionCount: story.reactionCount,
      replyCount: story.replyCount,
      reportCount: story.reportCount || 0,
    }
    const after = { viewCount, reactionCount, replyCount, reportCount }

    await db.collection('stories').updateOne(
      { id: storyId },
      { $set: after }
    )

    await writeAudit(db, 'STORY_COUNTERS_RECOMPUTED', user.id, 'STORY', storyId, { before, after })

    return { data: { storyId, before, after, drifted: JSON.stringify(before) !== JSON.stringify(after) } }
  }

  // ========================
  // POST /admin/stories/cleanup — Manually trigger story expiry cleanup
  // ========================
  if (path[0] === 'admin' && path[1] === 'stories' && path[2] === 'cleanup' && path.length === 3 && method === 'POST') {
    const user = await requireAuth(request, db)
    requireRole(user, 'ADMIN', 'SUPER_ADMIN')

    const now = new Date()

    // Get users with autoArchive=false
    const noArchiveUsers = await db.collection('story_settings')
      .find({ autoArchive: false })
      .project({ userId: 1, _id: 0 })
      .toArray()
    const noArchiveSet = new Set(noArchiveUsers.map(s => s.userId))

    const expiredStories = await db.collection('stories')
      .find({ status: 'ACTIVE', expiresAt: { $lte: now } })
      .project({ id: 1, authorId: 1, _id: 0 })
      .toArray()

    let archivedCount = 0
    let expiredOnlyCount = 0

    if (expiredStories.length > 0) {
      const archiveIds = []
      const noArchiveIds = []
      for (const s of expiredStories) {
        if (noArchiveSet.has(s.authorId)) noArchiveIds.push(s.id)
        else archiveIds.push(s.id)
      }

      if (archiveIds.length > 0) {
        await db.collection('stories').updateMany(
          { id: { $in: archiveIds }, status: 'ACTIVE' },
          { $set: { status: 'EXPIRED', archived: true, updatedAt: now } }
        )
        archivedCount = archiveIds.length
      }
      if (noArchiveIds.length > 0) {
        await db.collection('stories').updateMany(
          { id: { $in: noArchiveIds }, status: 'ACTIVE' },
          { $set: { status: 'EXPIRED', archived: false, updatedAt: now } }
        )
        expiredOnlyCount = noArchiveIds.length
      }
    }

    await writeAudit(db, 'STORY_CLEANUP_MANUAL', user.id, 'SYSTEM', 'stories', {
      processed: expiredStories.length,
      archived: archivedCount,
      expiredOnly: expiredOnlyCount,
    })

    return {
      data: {
        message: 'Story cleanup completed',
        processed: expiredStories.length,
        archived: archivedCount,
        expiredOnly: expiredOnlyCount,
        timestamp: now.toISOString(),
      },
    }
  }

  // ========================
  // PATCH /stories/:id — Edit a story (caption, privacy, stickers metadata only)
  // ========================
  if (path[0] === 'stories' && path.length === 2 && method === 'PATCH' && !['feed', 'search'].includes(path[1])) {
    const user = await requireAuth(request, db)
    const storyId = path[1]
    const story = await db.collection('stories').findOne({ id: storyId })

    if (!story) return { error: 'Story not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (story.status === StoryStatus.REMOVED) return { error: 'Cannot edit a removed story', code: ErrorCode.FORBIDDEN, status: 403 }
    if (story.authorId !== user.id && !isAdmin(user)) {
      return { error: 'Only story owner can edit', code: ErrorCode.FORBIDDEN, status: 403 }
    }
    if (story.expiresAt && new Date(story.expiresAt) <= new Date()) {
      return { error: 'Cannot edit an expired story', code: ErrorCode.EXPIRED, status: 410 }
    }

    const body = await request.json()
    const updates = { updatedAt: new Date() }
    const moderatableText = []

    if (body.caption !== undefined) {
      updates.caption = body.caption ? body.caption.slice(0, StoryConfig.MAX_CAPTION_LENGTH) : null
      if (updates.caption) moderatableText.push(updates.caption)
    }
    if (body.text !== undefined && story.type === 'TEXT') {
      updates.text = body.text ? body.text.slice(0, StoryConfig.MAX_CAPTION_LENGTH) : null
      if (updates.text) moderatableText.push(updates.text)
    }
    if (body.privacy !== undefined) {
      if (!StoryConfig.VALID_PRIVACY.includes(body.privacy)) {
        return { error: `Invalid privacy. Must be one of: ${StoryConfig.VALID_PRIVACY.join(', ')}`, code: ErrorCode.VALIDATION, status: 400 }
      }
      updates.privacy = body.privacy
    }
    if (body.replyPrivacy !== undefined) {
      if (!StoryConfig.VALID_REPLY_PRIVACY.includes(body.replyPrivacy)) {
        return { error: `Invalid replyPrivacy`, code: ErrorCode.VALIDATION, status: 400 }
      }
      updates.replyPrivacy = body.replyPrivacy
    }
    if (body.background !== undefined && story.type === 'TEXT') {
      if (body.background && !StoryConfig.VALID_BG_TYPES.includes(body.background.type)) {
        return { error: `Invalid background type`, code: ErrorCode.VALIDATION, status: 400 }
      }
      updates.background = body.background ? {
        type: body.background.type,
        color: body.background.color || '#000000',
        gradientColors: body.background.gradientColors || null,
        imageUrl: body.background.imageUrl || null,
      } : null
    }

    // Moderate text changes
    if (moderatableText.length > 0) {
      const textToModerate = moderatableText.join(' ').trim()
      try {
        const modResult = await moderateCreateContent(db, {
          entityType: 'story_edit',
          actorUserId: user.id,
          collegeId: user.collegeId,
          caption: textToModerate,
          text: textToModerate,
          metadata: { route: 'PATCH /stories/:id', storyId },
        })
        if (modResult.decision?.action === 'ESCALATE') {
          updates.status = StoryStatus.HELD
          updates.moderation = { action: 'ESCALATE', provider: modResult.decision.provider, confidence: modResult.decision.confidence, checkedAt: new Date() }
        }
      } catch (err) {
        if (err.details?.code === 'CONTENT_REJECTED_BY_MODERATION') {
          return { error: 'Edit rejected by moderation', code: ErrorCode.CONTENT_REJECTED, status: 422 }
        }
      }
    }

    await db.collection('stories').updateOne({ id: storyId }, { $set: updates })
    await writeAudit(db, 'STORY_EDITED', user.id, 'STORY', storyId, { fields: Object.keys(updates).filter(k => k !== 'updatedAt') })
    await invalidateOnEvent('STORY_CHANGED', { authorId: story.authorId, collegeId: story.collegeId })

    const updated = await db.collection('stories').findOne({ id: storyId })
    return { data: { story: sanitizeStory(updated) } }
  }

  // ========================
  // STORY MUTES (mute user stories without blocking)
  // ========================

  // POST /me/story-mutes/:userId — Mute a user's stories
  if (path[0] === 'me' && path[1] === 'story-mutes' && path.length === 3 && method === 'POST') {
    const user = await requireAuth(request, db)
    const targetUserId = path[2]
    if (targetUserId === user.id) {
      return { error: 'Cannot mute your own stories', code: ErrorCode.VALIDATION, status: 400 }
    }
    const target = await db.collection('users').findOne({ id: targetUserId })
    if (!target) return { error: 'User not found', code: ErrorCode.NOT_FOUND, status: 404 }

    await db.collection('story_mutes').updateOne(
      { userId: user.id, mutedUserId: targetUserId },
      { $setOnInsert: { id: uuidv4(), userId: user.id, mutedUserId: targetUserId, createdAt: new Date() } },
      { upsert: true }
    )
    return { data: { message: 'User stories muted', mutedUserId: targetUserId } }
  }

  // DELETE /me/story-mutes/:userId — Unmute a user's stories
  if (path[0] === 'me' && path[1] === 'story-mutes' && path.length === 3 && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const targetUserId = path[2]
    await db.collection('story_mutes').deleteOne({ userId: user.id, mutedUserId: targetUserId })
    return { data: { message: 'User stories unmuted', mutedUserId: targetUserId } }
  }

  // GET /me/story-mutes — List muted users
  if (path[0] === 'me' && path[1] === 'story-mutes' && path.length === 2 && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const { limit, offset } = parsePagination(url)
    const mutes = await db.collection('story_mutes')
      .find({ userId: user.id })
      .sort({ createdAt: -1 })
      .skip(offset).limit(limit).toArray()
    const mutedUserIds = mutes.map(m => m.mutedUserId)
    const users = await db.collection('users').find({ id: { $in: mutedUserIds } }).toArray()
    const userMap = Object.fromEntries(users.map(u => [u.id, sanitizeUser(u)]))
    const items = mutes.map(m => ({ mutedUser: userMap[m.mutedUserId] || null, mutedAt: m.createdAt }))
    const total = await db.collection('story_mutes').countDocuments({ userId: user.id })
    return { data: { items, pagination: { total }, total } }
  }

  // ========================
  // POST /stories/:id/view-duration — Track view duration for analytics
  // ========================
  if (path[0] === 'stories' && path.length === 3 && path[2] === 'view-duration' && method === 'POST') {
    const user = await requireAuth(request, db)
    const storyId = path[1]
    const body = await request.json()
    const { durationMs, completed } = body

    if (typeof durationMs !== 'number' || durationMs < 0 || durationMs > 300000) {
      return { error: 'durationMs must be a number between 0 and 300000', code: ErrorCode.VALIDATION, status: 400 }
    }

    const story = await db.collection('stories').findOne({ id: storyId })
    if (!story) return { error: 'Story not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Anti-abuse: prevent view duration spam
    const recentDurations = await db.collection('story_view_durations').countDocuments({
      viewerId: user.id,
      createdAt: { $gte: new Date(Date.now() - 60000) },
    })
    if (recentDurations >= 60) {
      return { error: 'View duration rate limit exceeded', code: ErrorCode.RATE_LIMITED, status: 429 }
    }

    await db.collection('story_view_durations').updateOne(
      { storyId, viewerId: user.id },
      {
        $set: { durationMs, completed: !!completed, updatedAt: new Date() },
        $setOnInsert: { id: uuidv4(), storyId, viewerId: user.id, authorId: story.authorId, createdAt: new Date() },
      },
      { upsert: true }
    )

    return { data: { message: 'View duration recorded', storyId, durationMs } }
  }

  // ========================
  // GET /stories/:id/view-analytics — View duration analytics (owner/admin only)
  // ========================
  if (path[0] === 'stories' && path.length === 3 && path[2] === 'view-analytics' && method === 'GET') {
    const user = await requireAuth(request, db)
    const storyId = path[1]
    const story = await db.collection('stories').findOne({ id: storyId })
    if (!story) return { error: 'Story not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (story.authorId !== user.id && !isAdmin(user)) {
      return { error: 'Only story owner can view analytics', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const agg = await db.collection('story_view_durations').aggregate([
      { $match: { storyId } },
      { $group: {
        _id: null,
        totalViews: { $sum: 1 },
        avgDurationMs: { $avg: '$durationMs' },
        maxDurationMs: { $max: '$durationMs' },
        minDurationMs: { $min: '$durationMs' },
        completedCount: { $sum: { $cond: ['$completed', 1, 0] } },
      }},
    ]).toArray()

    const stats = agg[0] || { totalViews: 0, avgDurationMs: 0, maxDurationMs: 0, minDurationMs: 0, completedCount: 0 }
    delete stats._id
    stats.completionRate = stats.totalViews > 0 ? Math.round((stats.completedCount / stats.totalViews) * 100) : 0
    stats.avgDurationMs = Math.round(stats.avgDurationMs || 0)

    return { data: { storyId, analytics: stats } }
  }

  // ========================
  // POST /admin/stories/bulk-moderate — Batch moderate stories
  // ========================
  if (path[0] === 'admin' && path[1] === 'stories' && path[2] === 'bulk-moderate' && path.length === 3 && method === 'POST') {
    const user = await requireAuth(request, db)
    requireRole(user, 'MODERATOR', 'ADMIN', 'SUPER_ADMIN')

    const body = await request.json()
    const { storyIds, action, reason } = body

    if (!storyIds || !Array.isArray(storyIds) || storyIds.length === 0) {
      return { error: 'storyIds must be a non-empty array', code: ErrorCode.VALIDATION, status: 400 }
    }
    if (storyIds.length > 50) {
      return { error: 'Maximum 50 stories per bulk action', code: ErrorCode.VALIDATION, status: 400 }
    }
    const validActions = ['HOLD', 'REMOVE', 'RESTORE', 'APPROVE']
    if (!validActions.includes(action)) {
      return { error: `action must be one of: ${validActions.join(', ')}`, code: ErrorCode.VALIDATION, status: 400 }
    }

    const statusMap = { HOLD: StoryStatus.HELD, REMOVE: StoryStatus.REMOVED, RESTORE: StoryStatus.ACTIVE, APPROVE: StoryStatus.ACTIVE }
    const newStatus = statusMap[action]

    const result = await db.collection('stories').updateMany(
      { id: { $in: storyIds } },
      { $set: { status: newStatus, updatedAt: new Date(), 'moderation.bulkAction': action, 'moderation.bulkReason': reason || null, 'moderation.bulkBy': user.id, 'moderation.bulkAt': new Date() } }
    )

    await writeAudit(db, 'STORY_BULK_MODERATE', user.id, 'SYSTEM', 'stories', {
      action, storyIds, reason, affected: result.modifiedCount,
    })

    const affected = await db.collection('stories').find({ id: { $in: storyIds } }).project({ authorId: 1, _id: 0 }).toArray()
    const authorIds = [...new Set(affected.map(s => s.authorId))]
    for (const authorId of authorIds) {
      await invalidateOnEvent('STORY_CHANGED', { authorId })
    }

    return { data: { message: `Bulk ${action} completed`, affected: result.modifiedCount, action } }
  }

  // ========================
  // POST /stories/:id/view — Mark story as viewed
  // ========================
  if (path[0] === 'stories' && path.length === 3 && path[2] === 'view' && method === 'POST') {
    const user = await requireAuth(request, db)
    const storyId = path[1]

    const story = await db.collection('stories').findOne({ id: storyId })
    if (!story) return { error: 'Story not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Upsert the view record
    await db.collection('story_views').updateOne(
      { storyId, viewerId: user.id },
      { $setOnInsert: { storyId, viewerId: user.id, createdAt: new Date() }, $set: { lastViewedAt: new Date() }, $inc: { viewCount: 1 } },
      { upsert: true }
    )

    // Increment story view count
    await db.collection('stories').updateOne({ id: storyId }, { $inc: { viewCount: 1 } })

    return { data: { message: 'Story viewed' } }
  }

  // ========================
  // GET /me/stories/insights — Story insights
  // ========================
  if (path[0] === 'me' && path[1] === 'stories' && path[2] === 'insights' && path.length === 3 && method === 'GET') {
    const user = await requireAuth(request, db)

    const stories = await db.collection('stories')
      .find({ authorId: user.id })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray()

    const storyIds = stories.map(s => s.id)
    const [totalViews, uniqueViewers, totalReactions, totalReplies] = await Promise.all([
      db.collection('story_views').countDocuments({ storyId: { $in: storyIds } }),
      db.collection('story_views').aggregate([
        { $match: { storyId: { $in: storyIds } } },
        { $group: { _id: '$viewerId' } },
        { $count: 'count' },
      ]).toArray().then(r => r[0]?.count || 0),
      db.collection('story_reactions').countDocuments({ storyId: { $in: storyIds } }),
      db.collection('story_replies').countDocuments({ storyId: { $in: storyIds } }),
    ])

    const activeStories = stories.filter(s => s.status === 'ACTIVE' && (!s.expiresAt || new Date(s.expiresAt) > new Date()))

    return {
      data: {
        totalStories: stories.length,
        activeStories: activeStories.length,
        totalViews,
        uniqueViewers,
        totalReactions,
        totalReplies,
        avgViewsPerStory: stories.length > 0 ? Math.round(totalViews / stories.length) : 0,
      },
    }
  }

  // ========================
  // POST /stories/:id/share — Share story as a post
  // ========================
  if (path[0] === 'stories' && path.length === 3 && path[2] === 'share' && method === 'POST') {
    const user = await requireAuth(request, db)
    const storyId = path[1]

    const story = await db.collection('stories').findOne({ id: storyId })
    if (!story) return { error: 'Story not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (story.authorId !== user.id) return { error: 'Can only share your own stories', code: 'FORBIDDEN', status: 403 }

    const body = {}
    try { Object.assign(body, await request.json()) } catch {}

    const post = {
      id: uuidv4(),
      kind: 'POST',
      authorId: user.id,
      authorType: 'USER',
      caption: body.caption || story.text || 'Shared from my story',
      media: story.mediaId ? [{ type: story.type || 'IMAGE', mediaId: story.mediaId }] : [],
      mediaIds: story.mediaId ? [story.mediaId] : [],
      visibility: 'PUBLIC',
      originalStoryId: storyId,
      likeCount: 0, commentCount: 0, saveCount: 0, shareCount: 0, viewCount: 0,
      distributionStage: 2,
      collegeId: user.collegeId || null,
      houseId: user.houseId || user.tribeId || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    await db.collection('content_items').insertOne(post)

    const { _id, ...clean } = post
    return { data: { post: clean }, status: 201 }
  }

  return null
}

