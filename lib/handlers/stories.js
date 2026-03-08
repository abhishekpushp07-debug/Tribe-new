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

// ========== STAGE 9 CONSTANTS ==========
export const StoryConfig = {
  TTL_HOURS: 24,
  MAX_STICKERS_PER_STORY: 5,
  MAX_CAPTION_LENGTH: 2200,
  MAX_POLL_OPTIONS: 4,
  MIN_POLL_OPTIONS: 2,
  MAX_QUIZ_OPTIONS: 4,
  MIN_QUIZ_OPTIONS: 2,
  MAX_QUESTION_LENGTH: 500,
  MAX_OPTION_LENGTH: 100,
  MAX_SLIDER_EMOJI_LENGTH: 10,
  MAX_REPLY_LENGTH: 1000,
  MAX_CLOSE_FRIENDS: 500,
  MAX_HIGHLIGHTS_PER_USER: 50,
  MAX_STORIES_PER_HIGHLIGHT: 100,
  MAX_HIGHLIGHT_NAME_LENGTH: 50,
  HOURLY_CREATE_LIMIT: 30,
  VALID_STORY_TYPES: ['IMAGE', 'VIDEO', 'TEXT'],
  VALID_STICKER_TYPES: ['POLL', 'QUESTION', 'QUIZ', 'EMOJI_SLIDER', 'MENTION', 'LOCATION', 'HASHTAG', 'LINK', 'COUNTDOWN', 'MUSIC'],
  VALID_REACTIONS: ['❤️', '🔥', '😂', '😮', '😢', '👏'],
  VALID_PRIVACY: ['EVERYONE', 'FOLLOWERS', 'CLOSE_FRIENDS'],
  VALID_REPLY_PRIVACY: ['EVERYONE', 'FOLLOWERS', 'CLOSE_FRIENDS', 'OFF'],
  VALID_BG_TYPES: ['SOLID', 'GRADIENT', 'IMAGE'],
}

const StoryStatus = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  REMOVED: 'REMOVED',
  HELD: 'HELD',
}

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

// Check if a user can view a story based on privacy + hideStoryFrom settings
async function canViewStory(db, story, viewerId) {
  if (!viewerId) return story.privacy === 'EVERYONE'
  if (story.authorId === viewerId) return true

  // Check hideStoryFrom setting
  const settings = await db.collection('story_settings').findOne({ userId: story.authorId })
  if (settings?.hideStoryFrom?.includes(viewerId)) return false

  switch (story.privacy) {
    case 'EVERYONE':
      return true
    case 'FOLLOWERS': {
      const follow = await db.collection('follows').findOne({
        followerId: viewerId,
        followeeId: story.authorId,
      })
      return !!follow
    }
    case 'CLOSE_FRIENDS': {
      const cf = await db.collection('close_friends').findOne({
        userId: story.authorId,
        friendId: viewerId,
      })
      return !!cf
    }
    default:
      return false
  }
}

// ═══════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════

export async function handleStories(path, method, request, db) {
  const route = path.join('/')

  // ========================
  // POST /stories — Create a new story
  // ========================
  if (route === 'stories' && method === 'POST') {
    const user = await requireAuth(request, db)

    if (user.ageStatus === 'UNKNOWN') {
      return { error: 'Complete age verification before posting stories', code: ErrorCode.AGE_REQUIRED, status: 403 }
    }
    if (user.ageStatus === 'CHILD') {
      return { error: 'Stories not available for users under 18', code: 'CHILD_RESTRICTED', status: 403 }
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
        url: `/api/media/${a.id}`,
        type: a.type,
        mimeType: a.mimeType,
        width: a.width,
        height: a.height,
        duration: a.duration || null,
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
          houseId: user.houseId,
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
          return { error: 'Story rejected by moderation', code: 'CONTENT_REJECTED', status: 422 }
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
      houseId: user.houseId || null,
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
  // GET /stories/feed — Story rail with seen/unseen
  // ========================
  if (route === 'stories/feed' && method === 'GET') {
    const user = await requireAuth(request, db)

    // Get followed users + self
    const follows = await db.collection('follows').find({ followerId: user.id }).toArray()
    const followeeIds = [user.id, ...follows.map(f => f.followeeId)]

    // Fetch active stories from followed users
    const now = new Date()
    const stories = await db.collection('stories')
      .find({
        authorId: { $in: followeeIds },
        status: StoryStatus.ACTIVE,
        expiresAt: { $gt: now },
      })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray()

    // Filter by privacy: only show stories the user can see
    const closeFriendEntries = await db.collection('close_friends')
      .find({ friendId: user.id })
      .project({ userId: 1, _id: 0 })
      .toArray()
    const closeFriendOfSet = new Set(closeFriendEntries.map(e => e.userId))

    // Get hideStoryFrom lists for all story authors (batch)
    const storyAuthorIds = [...new Set(stories.map(s => s.authorId))]
    const authorSettings = await db.collection('story_settings')
      .find({ userId: { $in: storyAuthorIds }, hideStoryFrom: { $exists: true, $ne: [] } })
      .project({ userId: 1, hideStoryFrom: 1, _id: 0 })
      .toArray()
    const hideFromMap = Object.fromEntries(authorSettings.map(s => [s.userId, new Set(s.hideStoryFrom)]))

    const visibleStories = stories.filter(s => {
      if (s.authorId === user.id) return true
      // Check hideStoryFrom
      if (hideFromMap[s.authorId]?.has(user.id)) return false
      if (s.privacy === 'EVERYONE') return true
      if (s.privacy === 'FOLLOWERS') return true // already filtered by followees
      if (s.privacy === 'CLOSE_FRIENDS') return closeFriendOfSet.has(s.authorId)
      return false
    })

    // Get which stories user has viewed
    const storyIds = visibleStories.map(s => s.id)
    const views = await db.collection('story_views')
      .find({ storyId: { $in: storyIds }, viewerId: user.id })
      .project({ storyId: 1, _id: 0 })
      .toArray()
    const viewedSet = new Set(views.map(v => v.storyId))

    // Group by author
    const grouped = {}
    for (const story of visibleStories) {
      if (!grouped[story.authorId]) grouped[story.authorId] = { stories: [], hasUnseen: false }
      const sanitized = sanitizeStory(story)
      sanitized.seen = viewedSet.has(story.id)
      grouped[story.authorId].stories.push(sanitized)
      if (!sanitized.seen) grouped[story.authorId].hasUnseen = true
    }

    // Enrich with author info
    const authorIds = Object.keys(grouped)
    const authors = await db.collection('users')
      .find({ id: { $in: authorIds } })
      .toArray()
    const authorMap = Object.fromEntries(authors.map(a => [a.id, sanitizeUser(a)]))

    const storyRail = authorIds.map(authorId => ({
      author: authorMap[authorId] || null,
      stories: grouped[authorId].stories,
      hasUnseen: grouped[authorId].hasUnseen,
      latestAt: grouped[authorId].stories[0]?.createdAt,
      storyCount: grouped[authorId].stories.length,
    }))

    // Sort: own first, then unseen first, then by latest
    storyRail.sort((a, b) => {
      if (a.author?.id === user.id) return -1
      if (b.author?.id === user.id) return 1
      if (a.hasUnseen && !b.hasUnseen) return -1
      if (!a.hasUnseen && b.hasUnseen) return 1
      return new Date(b.latestAt) - new Date(a.latestAt)
    })

    return { data: { storyRail, total: storyRail.length } }
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
      return { error: 'This story has expired', code: 'EXPIRED', status: 410 }
    }

    // Single authenticate call for all checks
    const viewer = await authenticate(request, db)

    if (story.status === StoryStatus.HELD) {
      if (!viewer || (viewer.id !== story.authorId && !isAdmin(viewer))) {
        return { error: 'Story is under review', code: ErrorCode.FORBIDDEN, status: 403 }
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

    return { data: { items, total: totalViews, storyId } }
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

    if (story.authorId === user.id) {
      return { error: 'Cannot react to your own story', code: ErrorCode.VALIDATION, status: 400 }
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
        return { error: 'Reply rejected by moderation', code: 'CONTENT_REJECTED', status: 422 }
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

    return { data: { items, total, storyId } }
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

    return { data: { items, total, storyId, stickerId } }
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

    return { data: { items, total } }
  }

  // POST /me/close-friends/:userId — Add to close friends
  if (path[0] === 'me' && path[1] === 'close-friends' && path.length === 3 && method === 'POST') {
    const user = await requireAuth(request, db)
    const friendId = path[2]

    if (friendId === user.id) {
      return { error: 'Cannot add yourself to close friends', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Check friend exists
    const friend = await db.collection('users').findOne({ id: friendId })
    if (!friend) return { error: 'User not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Check limit
    const count = await db.collection('close_friends').countDocuments({ userId: user.id })
    if (count >= StoryConfig.MAX_CLOSE_FRIENDS) {
      return { error: `Close friends limit reached (${StoryConfig.MAX_CLOSE_FRIENDS})`, code: ErrorCode.RATE_LIMITED, status: 429 }
    }

    // Upsert (idempotent)
    await db.collection('close_friends').updateOne(
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

  // POST /me/highlights — Create highlight
  if (route === 'me/highlights' && method === 'POST') {
    const user = await requireAuth(request, db)
    const body = await request.json()
    const { name, coverMediaId, storyIds } = body

    if (!name?.trim() || name.length > StoryConfig.MAX_HIGHLIGHT_NAME_LENGTH) {
      return { error: `Highlight name must be 1-${StoryConfig.MAX_HIGHLIGHT_NAME_LENGTH} characters`, code: ErrorCode.VALIDATION, status: 400 }
    }

    // Check limit
    const count = await db.collection('story_highlights').countDocuments({ userId: user.id })
    if (count >= StoryConfig.MAX_HIGHLIGHTS_PER_USER) {
      return { error: `Maximum ${StoryConfig.MAX_HIGHLIGHTS_PER_USER} highlights allowed`, code: ErrorCode.RATE_LIMITED, status: 429 }
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

    await db.collection('story_highlights').insertOne(highlight)

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

  // GET /users/:userId/highlights — User's highlights
  if (path[0] === 'users' && path.length === 3 && path[2] === 'highlights' && method === 'GET') {
    const targetUserId = path[1]

    const highlights = await db.collection('story_highlights')
      .find({ userId: targetUserId })
      .sort({ createdAt: -1 })
      .toArray()

    // For each highlight, get its stories
    const result = []
    for (const h of highlights) {
      const { _id, ...clean } = h
      const items = await db.collection('story_highlight_items')
        .find({ highlightId: h.id })
        .sort({ order: 1 })
        .toArray()

      const storyIds = items.map(i => i.storyId)
      const stories = await db.collection('stories')
        .find({ id: { $in: storyIds } })
        .toArray()

      clean.stories = sanitizeStories(stories)
      result.push(clean)
    }

    return { data: { highlights: result, total: result.length } }
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

  return null
}


// ═══════════════════════════════════════════════════
// STICKER VALIDATION & HELPERS
// ═══════════════════════════════════════════════════

function validateSticker(sticker) {
  if (!sticker.type || !StoryConfig.VALID_STICKER_TYPES.includes(sticker.type)) {
    return { error: `Invalid sticker type. Must be one of: ${StoryConfig.VALID_STICKER_TYPES.join(', ')}` }
  }

  const base = {
    id: uuidv4(),
    type: sticker.type,
    position: sticker.position || { x: 0.5, y: 0.5 },
    rotation: sticker.rotation || 0,
    scale: sticker.scale || 1,
  }

  switch (sticker.type) {
    case 'POLL': {
      if (!sticker.question?.trim()) return { error: 'Poll requires a question' }
      if (!sticker.options || !Array.isArray(sticker.options)) return { error: 'Poll requires options array' }
      if (sticker.options.length < StoryConfig.MIN_POLL_OPTIONS || sticker.options.length > StoryConfig.MAX_POLL_OPTIONS) {
        return { error: `Poll requires ${StoryConfig.MIN_POLL_OPTIONS}-${StoryConfig.MAX_POLL_OPTIONS} options` }
      }
      for (const opt of sticker.options) {
        if (!opt?.trim() || opt.length > StoryConfig.MAX_OPTION_LENGTH) {
          return { error: `Each option must be 1-${StoryConfig.MAX_OPTION_LENGTH} chars` }
        }
      }
      return {
        sticker: {
          ...base,
          question: sticker.question.slice(0, StoryConfig.MAX_QUESTION_LENGTH),
          options: sticker.options.map(o => o.trim()),
        },
      }
    }
    case 'QUIZ': {
      if (!sticker.question?.trim()) return { error: 'Quiz requires a question' }
      if (!sticker.options || !Array.isArray(sticker.options)) return { error: 'Quiz requires options array' }
      if (sticker.options.length < StoryConfig.MIN_QUIZ_OPTIONS || sticker.options.length > StoryConfig.MAX_QUIZ_OPTIONS) {
        return { error: `Quiz requires ${StoryConfig.MIN_QUIZ_OPTIONS}-${StoryConfig.MAX_QUIZ_OPTIONS} options` }
      }
      if (sticker.correctIndex === undefined || sticker.correctIndex < 0 || sticker.correctIndex >= sticker.options.length) {
        return { error: 'Quiz requires a valid correctIndex' }
      }
      return {
        sticker: {
          ...base,
          question: sticker.question.slice(0, StoryConfig.MAX_QUESTION_LENGTH),
          options: sticker.options.map(o => o.trim()),
          correctIndex: sticker.correctIndex,
        },
      }
    }
    case 'QUESTION': {
      if (!sticker.question?.trim()) return { error: 'Question sticker requires a question' }
      return {
        sticker: {
          ...base,
          question: sticker.question.slice(0, StoryConfig.MAX_QUESTION_LENGTH),
          placeholder: sticker.placeholder || 'Type your answer...',
        },
      }
    }
    case 'EMOJI_SLIDER': {
      if (!sticker.question?.trim()) return { error: 'Emoji slider requires a question' }
      return {
        sticker: {
          ...base,
          question: sticker.question.slice(0, StoryConfig.MAX_QUESTION_LENGTH),
          emoji: (sticker.emoji || '❤️').slice(0, StoryConfig.MAX_SLIDER_EMOJI_LENGTH),
        },
      }
    }
    case 'MENTION': {
      if (!sticker.userId) return { error: 'Mention sticker requires userId' }
      return { sticker: { ...base, userId: sticker.userId, username: sticker.username || '' } }
    }
    case 'LOCATION': {
      return { sticker: { ...base, locationName: sticker.locationName || '', lat: sticker.lat, lng: sticker.lng } }
    }
    case 'HASHTAG': {
      if (!sticker.tag?.trim()) return { error: 'Hashtag sticker requires tag' }
      return { sticker: { ...base, tag: sticker.tag.trim() } }
    }
    case 'LINK': {
      if (!sticker.url?.trim()) return { error: 'Link sticker requires url' }
      return { sticker: { ...base, url: sticker.url.trim(), label: sticker.label || '' } }
    }
    case 'COUNTDOWN': {
      if (!sticker.title?.trim()) return { error: 'Countdown sticker requires title' }
      if (!sticker.endTime) return { error: 'Countdown sticker requires endTime' }
      return { sticker: { ...base, title: sticker.title.trim(), endTime: new Date(sticker.endTime) } }
    }
    case 'MUSIC': {
      return { sticker: { ...base, trackName: sticker.trackName || '', artist: sticker.artist || '', previewUrl: sticker.previewUrl || '' } }
    }
    default:
      return { error: `Unsupported sticker type: ${sticker.type}` }
  }
}

function validateStickerResponse(sticker, body) {
  switch (sticker.type) {
    case 'POLL': {
      const { optionIndex } = body
      if (optionIndex === undefined || optionIndex < 0 || optionIndex >= sticker.options.length) {
        return { error: `optionIndex must be 0-${sticker.options.length - 1}` }
      }
      return { response: { optionIndex } }
    }
    case 'QUIZ': {
      const { optionIndex } = body
      if (optionIndex === undefined || optionIndex < 0 || optionIndex >= sticker.options.length) {
        return { error: `optionIndex must be 0-${sticker.options.length - 1}` }
      }
      return { response: { optionIndex, correct: optionIndex === sticker.correctIndex } }
    }
    case 'QUESTION': {
      const { text } = body
      if (!text?.trim() || text.length > StoryConfig.MAX_QUESTION_LENGTH) {
        return { error: `Answer must be 1-${StoryConfig.MAX_QUESTION_LENGTH} characters` }
      }
      return { response: { text: text.trim() } }
    }
    case 'EMOJI_SLIDER': {
      const { value } = body
      if (value === undefined || typeof value !== 'number' || value < 0 || value > 1) {
        return { error: 'value must be a number between 0 and 1' }
      }
      return { response: { value } }
    }
    default:
      return { error: `Sticker type ${sticker.type} does not support responses` }
  }
}

async function getStickerResults(db, storyId, stickerId, sticker) {
  const totalResponses = await db.collection('story_sticker_responses').countDocuments({ storyId, stickerId })

  switch (sticker.type) {
    case 'POLL': {
      const voteCounts = await db.collection('story_sticker_responses').aggregate([
        { $match: { storyId, stickerId } },
        { $group: { _id: '$response.optionIndex', count: { $sum: 1 } } },
      ]).toArray()
      const countMap = Object.fromEntries(voteCounts.map(v => [v._id, v.count]))
      return {
        totalVotes: totalResponses,
        options: sticker.options.map((opt, i) => ({
          text: opt,
          votes: countMap[i] || 0,
          percentage: totalResponses > 0 ? Math.round(((countMap[i] || 0) / totalResponses) * 100) : 0,
        })),
      }
    }
    case 'QUIZ': {
      const answerCounts = await db.collection('story_sticker_responses').aggregate([
        { $match: { storyId, stickerId } },
        { $group: { _id: '$response.optionIndex', count: { $sum: 1 }, correctCount: { $sum: { $cond: ['$response.correct', 1, 0] } } } },
      ]).toArray()
      const countMap = Object.fromEntries(answerCounts.map(v => [v._id, v.count]))
      const totalCorrect = answerCounts.reduce((sum, v) => sum + (v.correctCount || 0), 0)
      return {
        totalAnswers: totalResponses,
        correctCount: totalCorrect,
        correctPercentage: totalResponses > 0 ? Math.round((totalCorrect / totalResponses) * 100) : 0,
        options: sticker.options.map((opt, i) => ({
          text: opt,
          count: countMap[i] || 0,
          isCorrect: i === sticker.correctIndex,
          percentage: totalResponses > 0 ? Math.round(((countMap[i] || 0) / totalResponses) * 100) : 0,
        })),
      }
    }
    case 'QUESTION': {
      return { totalAnswers: totalResponses }
    }
    case 'EMOJI_SLIDER': {
      const agg = await db.collection('story_sticker_responses').aggregate([
        { $match: { storyId, stickerId } },
        { $group: { _id: null, avgValue: { $avg: '$response.value' }, count: { $sum: 1 } } },
      ]).toArray()
      const result = agg[0] || { avgValue: 0, count: 0 }
      return {
        totalResponses: result.count,
        averageValue: Math.round((result.avgValue || 0) * 100) / 100,
        emoji: sticker.emoji,
      }
    }
    default:
      return { totalResponses }
  }
}

async function enrichStickersForViewer(db, story, viewerId) {
  if (!story.stickers || story.stickers.length === 0) return []

  const stickersWithResults = []
  for (const sticker of story.stickers) {
    const enriched = { ...sticker }

    if (['POLL', 'QUIZ', 'QUESTION', 'EMOJI_SLIDER'].includes(sticker.type)) {
      enriched.results = await getStickerResults(db, story.id, sticker.id, sticker)

      if (viewerId) {
        const resp = await db.collection('story_sticker_responses').findOne({
          storyId: story.id,
          stickerId: sticker.id,
          userId: viewerId,
        })
        enriched.viewerResponse = resp ? resp.response : null
      }
    }
    stickersWithResults.push(enriched)
  }
  return stickersWithResults
}

async function checkReplyPermission(db, story, viewerId) {
  const replyPrivacy = story.replyPrivacy || 'EVERYONE'
  if (replyPrivacy === 'OFF') return false
  if (replyPrivacy === 'EVERYONE') return true

  if (replyPrivacy === 'FOLLOWERS') {
    const follow = await db.collection('follows').findOne({
      followerId: viewerId,
      followeeId: story.authorId,
    })
    return !!follow
  }

  if (replyPrivacy === 'CLOSE_FRIENDS') {
    const cf = await db.collection('close_friends').findOne({
      userId: story.authorId,
      friendId: viewerId,
    })
    return !!cf
  }

  return false
}
