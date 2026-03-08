import { v4 as uuidv4 } from 'uuid'
import { Config, ContentKind, Visibility, ErrorCode } from '../constants.js'
import { requireAuth, authenticate, sanitizeUser, writeAudit, enrichPosts, parsePagination, createNotification } from '../auth-utils.js'
import { invalidateOnEvent } from '../cache.js'
import { moderateCreateContent } from '../moderation/middleware/moderate-create-content.js'

export async function handleContent(path, method, request, db) {
  const route = path.join('/')

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

    // Validate content kind
    if (!Object.values(ContentKind).includes(contentKind)) {
      return { error: `Invalid content kind. Must be one of: ${Object.values(ContentKind).join(', ')}`, code: ErrorCode.VALIDATION, status: 400 }
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
        url: `/api/media/${a.id}`,
        type: a.type,
        mimeType: a.mimeType,
        width: a.width,
        height: a.height,
        duration: a.duration || null,
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
          houseId: user.houseId,
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
            code: 'CONTENT_REJECTED',
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
      caption: caption ? caption.slice(0, Config.MAX_CAPTION_LENGTH) : '',
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
      houseId: user.houseId || null,
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
      createdAt: now,
      updatedAt: now,
    }

    await db.collection('content_items').insertOne(contentItem)
    await db.collection('users').updateOne({ id: user.id }, { $inc: { postsCount: 1 } })

    if (contentItem.collegeId) {
      await db.collection('colleges').updateOne({ id: contentItem.collegeId }, { $inc: { contentCount: 1 } })
    }

    await writeAudit(db, 'CONTENT_CREATED', user.id, 'CONTENT', contentItem.id, { kind: contentKind })

    await invalidateOnEvent('POST_CREATED', { collegeId: contentItem.collegeId, houseId: contentItem.houseId, kind: contentKind })

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

    // Story expiry invariant: STORY must have valid expiresAt, and it must not be past
    // A STORY without expiresAt is a malformed invariant violation → treat as expired
    if (post.kind === ContentKind.STORY) {
      if (!post.expiresAt || new Date(post.expiresAt) <= new Date()) {
        return { error: 'This story has expired', code: 'EXPIRED', status: 410 }
      }
    }

    // Increment view count
    await db.collection('content_items').updateOne({ id: contentId }, { $inc: { viewCount: 1 } })

    const currentUser = await authenticate(request, db)
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
    if (post.authorId !== user.id && !['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { error: 'Forbidden', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    await db.collection('content_items').updateOne(
      { id: contentId },
      { $set: { visibility: Visibility.REMOVED, updatedAt: new Date() } }
    )
    await db.collection('users').updateOne({ id: post.authorId }, { $inc: { postsCount: -1 } })
    await writeAudit(db, 'CONTENT_REMOVED', user.id, 'CONTENT', contentId, {
      removedBy: user.id === post.authorId ? 'AUTHOR' : 'MODERATOR',
    })

    await invalidateOnEvent('POST_DELETED', { collegeId: post.collegeId, houseId: post.houseId, kind: post.kind })

    return { data: { message: 'Content removed' } }
  }

  return null
}
