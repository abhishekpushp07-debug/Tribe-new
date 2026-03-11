import { v4 as uuidv4 } from 'uuid'
import { Config, ContentKind, Visibility, ErrorCode } from '../constants.js'
import { requireAuth, authenticate, sanitizeUser, writeAudit, enrichPosts, parsePagination, createNotification } from '../auth-utils.js'
import { invalidateOnEvent } from '../cache.js'
import { moderateCreateContent } from '../moderation/middleware/moderate-create-content.js'
import { canViewContent, isBlocked } from '../access-policy.js'
import { extractHashtags, syncHashtags } from '../services/hashtag-service.js'
import { fetchLinkPreview } from '../services/link-preview-service.js'

// Post sub-types (additive, does not change ContentKind)
const PostSubType = {
  STANDARD: 'STANDARD',
  POLL: 'POLL',
  LINK: 'LINK',
  THREAD_HEAD: 'THREAD_HEAD',
  THREAD_PART: 'THREAD_PART',
}

const MAX_POLL_OPTIONS = 6
const MIN_POLL_OPTIONS = 2
const MAX_POLL_OPTION_LENGTH = 120
const DEFAULT_POLL_HOURS = 24
const MAX_POLL_HOURS = 168 // 7 days
const MAX_THREAD_PARTS = 20

export async function handleContent(path, method, request, db) {
  const route = path.join('/')

  // ========================
  // PATCH /content/:id — Edit Post Caption
  // ========================
  if (path[0] === 'content' && path.length === 2 && method === 'PATCH') {
    const user = await requireAuth(request, db)
    const contentId = path[1]
    const post = await db.collection('content_items').findOne({ id: contentId })
    if (!post || post.visibility === Visibility.REMOVED) {
      return { error: 'Content not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    // Ownership check
    const isUserAuthor = !post.authorType || post.authorType === 'USER'
    if (isUserAuthor) {
      if (post.authorId !== user.id && !['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
        return { error: 'Forbidden', code: ErrorCode.FORBIDDEN, status: 403 }
      }
    } else if (post.authorType === 'PAGE') {
      // Page-authored: require page role OWNER/ADMIN/EDITOR
      const pageMember = await db.collection('page_members').findOne({ pageId: post.pageId, userId: user.id, status: 'ACTIVE' })
      if (!pageMember || !['OWNER', 'ADMIN', 'EDITOR'].includes(pageMember.role)) {
        return { error: 'Forbidden', code: ErrorCode.FORBIDDEN, status: 403 }
      }
    }

    // Cannot edit archived page content
    if (post.pageId) {
      const page = await db.collection('pages').findOne({ id: post.pageId })
      if (page && page.status === 'ARCHIVED') {
        return { error: 'Cannot edit content on archived page', code: ErrorCode.INVALID_STATE, status: 400 }
      }
    }

    const body = await request.json()
    const caption = body.caption

    if (caption === undefined || caption === null) {
      return { error: 'Caption is required', code: ErrorCode.VALIDATION, status: 400 }
    }
    if (typeof caption === 'string' && caption.trim().length === 0 && (!post.media || post.media.length === 0)) {
      return { error: 'Caption cannot be empty on text-only post', code: ErrorCode.VALIDATION, status: 400 }
    }
    if (typeof caption === 'string' && caption.length > Config.MAX_CAPTION_LENGTH) {
      return { error: `Caption too long (max ${Config.MAX_CAPTION_LENGTH})`, code: ErrorCode.VALIDATION, status: 400 }
    }

    // Moderation re-check on updated caption
    const textToModerate = caption || ''
    if (textToModerate.length > 0) {
      try {
        const modResult = await moderateCreateContent(db, {
          entityType: post.kind?.toLowerCase() || 'post',
          actorUserId: user.id,
          caption: caption,
          text: textToModerate,
          metadata: { route: 'PATCH /content/:id', editOf: contentId },
        })
        if (modResult.decision?.action === 'REJECT') {
          return { error: 'Edited content rejected by moderation', code: ErrorCode.CONTENT_REJECTED, status: 422 }
        }
      } catch (err) {
        if (err.details?.code === 'CONTENT_REJECTED_BY_MODERATION') {
          return { error: 'Edited content rejected by content safety filter', code: ErrorCode.CONTENT_REJECTED, status: 422 }
        }
      }
    }

    const now = new Date()
    const newHashtags = extractHashtags(caption)
    await db.collection('content_items').updateOne(
      { id: contentId },
      { $set: { caption: caption.slice(0, Config.MAX_CAPTION_LENGTH), hashtags: newHashtags, editedAt: now, updatedAt: now } }
    )

    // Sync hashtag stats (add new, decrement removed)
    const oldHashtags = post.hashtags || []
    await syncHashtags(db, oldHashtags, newHashtags)

    await writeAudit(db, 'CONTENT_EDITED', user.id, 'CONTENT', contentId, {
      editedBy: user.id,
      isPageContent: post.authorType === 'PAGE',
      pageId: post.pageId || null,
    })

    const updated = await db.collection('content_items').findOne({ id: contentId })
    const enriched = await enrichPosts(db, [updated], user.id)
    return { data: { post: enriched[0] } }
  }

  // ========================
  // POST /content/posts — Create Post, Reel, or Story
  // ========================
  if (route === 'content/posts' && method === 'POST') {
    const user = await requireAuth(request, db)

    if (user.ageStatus === 'UNKNOWN') {
      return { error: 'Please complete age verification before posting', code: ErrorCode.AGE_REQUIRED, status: 403 }
    }

    const body = await request.json()
    const { caption, mediaIds, kind, syntheticDeclaration } = body
    const contentKind = kind || ContentKind.POST

    // Phase D: Extract new post sub-type fields
    const { poll, linkUrl, threadParentId } = body

    // Validate content kind
    if (!Object.values(ContentKind).includes(contentKind)) {
      return { error: `Invalid content kind. Must be one of: ${Object.values(ContentKind).join(', ')}`, code: ErrorCode.VALIDATION, status: 400 }
    }

    // ── POLL VALIDATION ──
    let pollData = null
    if (poll && contentKind === ContentKind.POST) {
      if (!Array.isArray(poll.options) || poll.options.length < MIN_POLL_OPTIONS || poll.options.length > MAX_POLL_OPTIONS) {
        return { error: `Poll must have ${MIN_POLL_OPTIONS}-${MAX_POLL_OPTIONS} options`, code: ErrorCode.VALIDATION, status: 400 }
      }
      for (const opt of poll.options) {
        if (typeof opt !== 'string' || opt.trim().length === 0 || opt.length > MAX_POLL_OPTION_LENGTH) {
          return { error: `Poll option must be 1-${MAX_POLL_OPTION_LENGTH} chars`, code: ErrorCode.VALIDATION, status: 400 }
        }
      }
      const expiresInHours = Math.min(parseInt(poll.expiresIn || DEFAULT_POLL_HOURS, 10), MAX_POLL_HOURS)
      pollData = {
        options: poll.options.map((text, idx) => ({ id: `opt_${idx}`, text: text.trim(), voteCount: 0 })),
        totalVotes: 0,
        expiresAt: new Date(Date.now() + expiresInHours * 3600000),
        allowMultipleVotes: poll.allowMultipleVotes === true,
      }
    }

    // ── THREAD VALIDATION ──
    let threadData = null
    if (threadParentId && contentKind === ContentKind.POST) {
      const parent = await db.collection('content_items').findOne({ id: threadParentId, authorId: user.id })
      if (!parent || parent.visibility === Visibility.REMOVED) {
        return { error: 'Thread parent not found or not owned by you', code: ErrorCode.NOT_FOUND, status: 404 }
      }
      const threadId = parent.thread?.threadId || parent.id
      const existingParts = await db.collection('content_items').countDocuments({
        $or: [{ id: threadId }, { 'thread.threadId': threadId }],
        visibility: { $ne: Visibility.REMOVED },
      })
      if (existingParts >= MAX_THREAD_PARTS) {
        return { error: `Thread cannot exceed ${MAX_THREAD_PARTS} parts`, code: ErrorCode.VALIDATION, status: 400 }
      }
      threadData = { threadId, partIndex: existingParts + 1, parentId: threadParentId }
      // Mark parent as THREAD_HEAD if not already
      if (!parent.thread) {
        await db.collection('content_items').updateOne(
          { id: threadParentId },
          { $set: { thread: { threadId: threadParentId, partIndex: 0 }, postSubType: PostSubType.THREAD_HEAD, updatedAt: new Date() } }
        )
      }
    }

    // Children cannot post media, reels, or stories
    if (user.ageStatus === 'CHILD') {
      if (mediaIds?.length > 0 || contentKind !== ContentKind.POST) {
        return { error: 'Media content not available for users under 18', code: ErrorCode.CHILD_RESTRICTED, status: 403 }
      }
    }

    // Reels and stories require media
    if ((contentKind === ContentKind.REEL || contentKind === ContentKind.STORY) && (!mediaIds || mediaIds.length === 0)) {
      return { error: `${contentKind} requires at least one media attachment`, code: ErrorCode.VALIDATION, status: 400 }
    }

    // Posts need either caption or media
    if (contentKind === ContentKind.POST && !caption?.trim() && (!mediaIds || mediaIds.length === 0)) {
      return { error: 'Post must have caption or media', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Resolve media
    let media = []
    if (mediaIds?.length > 0) {
      const assets = await db.collection('media_assets')
        .find({ id: { $in: mediaIds }, ownerId: user.id })
        .toArray()
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

    const now = new Date()

    // AI Content Moderation via Provider-Adapter pattern
    const textToModerate = caption || ''
    let moderationDecision = null
    let reviewTicketId = null
    let visibility = Visibility.PUBLIC

    if (textToModerate.length > 0) {
      try {
        const modResult = await moderateCreateContent(db, {
          entityType: contentKind.toLowerCase(),
          actorUserId: user.id,
          collegeId: user.collegeId,
          tribeId: user.tribeId,
          caption: caption,
          text: textToModerate,
          metadata: { route: 'POST /content/posts', kind: contentKind },
        })
        moderationDecision = modResult.decision
        reviewTicketId = modResult.reviewTicketId
        if (moderationDecision.action === 'ESCALATE') {
          visibility = 'HELD'
        }
      } catch (err) {
        if (err.details?.code === 'CONTENT_REJECTED_BY_MODERATION') {
          return {
            error: 'Content rejected by moderation',
            code: ErrorCode.CONTENT_REJECTED,
            status: 422,
            data: { moderation: err.details.moderation, reviewTicketId: err.details.reviewTicketId },
          }
        }
        throw err
      }
    }

    const contentItem = {
      id: uuidv4(),
      kind: contentKind,
      authorId: user.id,
      authorType: 'USER',
      createdAs: 'USER',
      caption: caption ? caption.slice(0, Config.MAX_CAPTION_LENGTH) : '',
      hashtags: extractHashtags(caption || ''),
      media,
      visibility,
      riskScore: moderationDecision?.confidence || 0,
      policyReasons: moderationDecision?.flaggedCategories || [],
      moderation: moderationDecision ? {
        action: moderationDecision.action,
        provider: moderationDecision.provider,
        providerModel: moderationDecision.providerModel,
        confidence: moderationDecision.confidence,
        flaggedCategories: moderationDecision.flaggedCategories,
        reasons: moderationDecision.reasons,
        reviewTicketId: reviewTicketId || null,
        checkedAt: now,
      } : null,
      collegeId: user.collegeId || null,
      tribeId: user.tribeId || null,
      likeCount: 0,
      dislikeCountInternal: 0,
      commentCount: 0,
      saveCount: 0,
      shareCount: 0,
      viewCount: 0,
      syntheticDeclaration: syntheticDeclaration || false,
      syntheticLabelStatus: syntheticDeclaration ? 'DECLARED' : 'UNKNOWN',
      distributionStage: 0,
      duration: body.duration || null,
      expiresAt: contentKind === ContentKind.STORY
        ? new Date(now.getTime() + Config.STORY_TTL_HOURS * 60 * 60 * 1000)
        : null,
      // Phase D: Post sub-type fields
      postSubType: pollData ? PostSubType.POLL
        : threadData ? PostSubType.THREAD_PART
        : linkUrl ? PostSubType.LINK
        : PostSubType.STANDARD,
      poll: pollData || null,
      linkPreview: null, // populated async below
      thread: threadData || null,
      createdAt: now,
      updatedAt: now,
    }

    // ── AUTO-PROMOTION: distributionStage pipeline ──
    // Stage 0 → 1: Immediate if content passes moderation and is PUBLIC
    // Stage 1 → 2: Immediate for eligible content (PUBLIC + no HELD/ESCALATE moderation)
    // HELD/ESCALATE content stays at stage 0 until manual review
    const moderationAction = moderationDecision?.action
    if (moderationAction === 'HOLD' || moderationAction === 'ESCALATE' || moderationAction === 'REJECT') {
      contentItem.distributionStage = 0 // Stays at 0 until manual review
    } else if (visibility === Visibility.PUBLIC) {
      // Auto-promote to stage 2 (public-discoverable) for clean PUBLIC content
      contentItem.distributionStage = 2
    } else {
      // Non-public content gets stage 1 (visible in following/tribe/college feeds)
      contentItem.distributionStage = 1
    }

    await db.collection('content_items').insertOne(contentItem)
    await db.collection('users').updateOne({ id: user.id }, { $inc: { postsCount: 1 } })

    // Phase D: Async link preview fetch (non-blocking, updates after creation)
    if (linkUrl && contentKind === ContentKind.POST && !pollData && !threadData) {
      fetchLinkPreview(linkUrl).then(async preview => {
        if (preview) {
          await db.collection('content_items').updateOne(
            { id: contentItem.id },
            { $set: { linkPreview: preview, postSubType: PostSubType.LINK, updatedAt: new Date() } }
          )
        }
      }).catch(() => {}) // safe degradation
    }

    // B5: Sync hashtag stats
    if (contentItem.hashtags.length > 0) {
      await syncHashtags(db, [], contentItem.hashtags)
    }

    if (contentItem.collegeId) {
      await db.collection('colleges').updateOne({ id: contentItem.collegeId }, { $inc: { contentCount: 1 } })
    }

    await writeAudit(db, 'CONTENT_CREATED', user.id, 'CONTENT', contentItem.id, { kind: contentKind })

    await invalidateOnEvent('POST_CREATED', { collegeId: contentItem.collegeId, tribeId: contentItem.tribeId, kind: contentKind })

    // Legacy house points removed — tribe salute system replaces this (Stage 12X)

    const enriched = await enrichPosts(db, [contentItem], user.id)
    return { data: { post: enriched[0] }, status: 201 }
  }

  // ========================
  // GET /content/:id
  // ========================
  if (path[0] === 'content' && path.length === 2 && method === 'GET') {
    const contentId = path[1]
    const post = await db.collection('content_items').findOne({ id: contentId })
    if (!post || post.visibility === Visibility.REMOVED) {
      return { error: 'Content not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    // B2: Centralized visibility check
    const currentUser = await authenticate(request, db)
    if (!canViewContent(post, currentUser?.id, currentUser?.role)) {
      return { error: 'Content not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    // B2: Block check — blocked users cannot view each other's content
    if (currentUser?.id && post.authorId !== currentUser.id) {
      const blocked = await isBlocked(db, currentUser.id, post.authorId)
      if (blocked) return { error: 'Content not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    // Story expiry invariant: STORY must have valid expiresAt, and it must not be past
    // A STORY without expiresAt is a malformed invariant violation → treat as expired
    if (post.kind === ContentKind.STORY) {
      if (!post.expiresAt || new Date(post.expiresAt) <= new Date()) {
        return { error: 'This story has expired', code: ErrorCode.EXPIRED, status: 410 }
      }
    }

    // Increment view count
    await db.collection('content_items').updateOne({ id: contentId }, { $inc: { viewCount: 1 } })

    const enriched = await enrichPosts(db, [post], currentUser?.id)
    return { data: { post: enriched[0] } }
  }

  // ========================
  // DELETE /content/:id
  // ========================
  if (path[0] === 'content' && path.length === 2 && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const contentId = path[1]
    const post = await db.collection('content_items').findOne({ id: contentId })
    if (!post) return { error: 'Content not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Only author or moderators/admins can delete
    // B3: For page-authored posts, the page handler manages deletion.
    // But if someone deletes via /content/:id directly, check ownership.
    const isUserAuthor = !post.authorType || post.authorType === 'USER'
    if (isUserAuthor && post.authorId !== user.id && !['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { error: 'Forbidden', code: ErrorCode.FORBIDDEN, status: 403 }
    }
    if (post.authorType === 'PAGE' && !['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      // For page-authored content, require page role or system admin
      const pageMember = await db.collection('page_members').findOne({ pageId: post.pageId, userId: user.id, status: 'ACTIVE' })
      if (!pageMember || !['OWNER', 'ADMIN', 'EDITOR'].includes(pageMember.role)) {
        return { error: 'Forbidden', code: ErrorCode.FORBIDDEN, status: 403 }
      }
    }

    await db.collection('content_items').updateOne(
      { id: contentId },
      { $set: { visibility: Visibility.REMOVED, updatedAt: new Date() } }
    )
    await db.collection('users').updateOne({ id: post.authorId }, { $inc: { postsCount: -1 } })
    await writeAudit(db, 'CONTENT_REMOVED', user.id, 'CONTENT', contentId, {
      removedBy: user.id === post.authorId ? 'AUTHOR' : 'MODERATOR',
    })

    await invalidateOnEvent('POST_DELETED', { collegeId: post.collegeId, tribeId: post.tribeId, kind: post.kind })

    return { data: { message: 'Content removed' } }
  }

  // ========================
  // POST /content/:id/vote — Vote on a poll post
  // ========================
  if (path[0] === 'content' && path.length === 3 && path[2] === 'vote' && method === 'POST') {
    const user = await requireAuth(request, db)
    const contentId = path[1]
    const body = await request.json()
    const { optionId } = body

    if (!optionId) {
      return { error: 'optionId required', code: ErrorCode.VALIDATION, status: 400 }
    }

    const post = await db.collection('content_items').findOne({ id: contentId })
    if (!post || post.visibility === Visibility.REMOVED || !post.poll) {
      return { error: 'Poll not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    // Check poll expiry
    if (post.poll.expiresAt && new Date(post.poll.expiresAt) < new Date()) {
      return { error: 'Poll has expired', code: 'POLL_EXPIRED', status: 410 }
    }

    // Validate option exists
    const validOption = post.poll.options.find(o => o.id === optionId)
    if (!validOption) {
      return { error: 'Invalid option', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Block check
    if (user.id !== post.authorId) {
      if (await isBlocked(db, user.id, post.authorId)) {
        return { error: 'Action not allowed', code: ErrorCode.FORBIDDEN, status: 403 }
      }
    }

    // Check if already voted
    const existingVote = await db.collection('poll_votes').findOne({ contentId, userId: user.id })
    if (existingVote && !post.poll.allowMultipleVotes) {
      return { error: 'Already voted', code: ErrorCode.CONFLICT, status: 409 }
    }

    // Record vote
    await db.collection('poll_votes').updateOne(
      { contentId, userId: user.id, optionId },
      { $setOnInsert: { id: uuidv4(), contentId, userId: user.id, optionId, createdAt: new Date() } },
      { upsert: true }
    )

    // Update vote counts atomically
    const optionVoteCounts = await db.collection('poll_votes').aggregate([
      { $match: { contentId } },
      { $group: { _id: '$optionId', count: { $sum: 1 } } },
    ]).toArray()
    const countMap = Object.fromEntries(optionVoteCounts.map(v => [v._id, v.count]))
    const totalVotes = optionVoteCounts.reduce((sum, v) => sum + v.count, 0)

    const updatedOptions = post.poll.options.map(o => ({
      ...o,
      voteCount: countMap[o.id] || 0,
    }))

    await db.collection('content_items').updateOne(
      { id: contentId },
      { $set: { 'poll.options': updatedOptions, 'poll.totalVotes': totalVotes, updatedAt: new Date() } }
    )

    return { data: { voted: optionId, poll: { options: updatedOptions, totalVotes, expiresAt: post.poll.expiresAt } } }
  }

  // ========================
  // GET /content/:id/poll-results — Get poll results
  // ========================
  if (path[0] === 'content' && path.length === 3 && path[2] === 'poll-results' && method === 'GET') {
    const contentId = path[1]
    const post = await db.collection('content_items').findOne({ id: contentId })
    if (!post || post.visibility === Visibility.REMOVED || !post.poll) {
      return { error: 'Poll not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    const currentUser = await authenticate(request, db)
    let viewerVote = null
    if (currentUser) {
      const vote = await db.collection('poll_votes').findOne({ contentId, userId: currentUser.id })
      if (vote) viewerVote = vote.optionId
    }

    return {
      data: {
        poll: {
          options: post.poll.options,
          totalVotes: post.poll.totalVotes,
          expiresAt: post.poll.expiresAt,
          expired: post.poll.expiresAt ? new Date(post.poll.expiresAt) < new Date() : false,
          allowMultipleVotes: post.poll.allowMultipleVotes || false,
        },
        viewerVote,
      }
    }
  }

  // ========================
  // GET /content/:id/thread — Get full thread view
  // ========================
  if (path[0] === 'content' && path.length === 3 && path[2] === 'thread' && method === 'GET') {
    const contentId = path[1]
    const head = await db.collection('content_items').findOne({ id: contentId })
    if (!head || head.visibility === Visibility.REMOVED) {
      return { error: 'Content not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    const currentUser = await authenticate(request, db)

    // Determine thread ID
    const threadId = head.thread?.threadId || head.id

    // Fetch all thread parts
    const threadParts = await db.collection('content_items')
      .find({
        $or: [
          { id: threadId }, // the head
          { 'thread.threadId': threadId },
        ],
        visibility: { $ne: Visibility.REMOVED },
      })
      .sort({ 'thread.partIndex': 1, createdAt: 1 })
      .toArray()

    if (threadParts.length <= 1) {
      // Single post, not a thread — return it as a standalone
      const enriched = await enrichPosts(db, [head], currentUser?.id)
      return { data: { thread: enriched, isThread: false, partCount: 1 } }
    }

    const enriched = await enrichPosts(db, threadParts, currentUser?.id)
    return { data: { thread: enriched, isThread: true, partCount: enriched.length, threadId } }
  }

  return null
}
