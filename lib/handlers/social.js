import { v4 as uuidv4 } from 'uuid'
import { Config, ErrorCode, NotificationType, ContentKind, Visibility } from '../constants.js'
import { requireAuth, authenticate, sanitizeUser, createNotification, parsePagination, enrichPosts, writeAudit } from '../auth-utils.js'
import { moderateCreateContent } from '../moderation/middleware/moderate-create-content.js'
import { triggerAutoEval } from './stages.js'
import { canViewComments, canViewContent, filterBlockedComments, isBlocked } from '../access-policy.js'
import { invalidateOnEvent } from '../cache.js'
import { checkEngagementAbuse, logSuspiciousAction, ActionType } from '../services/anti-abuse-service.js'

// Guard: block interactions on expired/malformed stories
// STORY invariant: must have valid expiresAt AND it must be in the future
function isExpiredStory(post) {
  return post.kind === ContentKind.STORY && (!post.expiresAt || new Date(post.expiresAt) <= new Date())
}
const EXPIRED_RESPONSE = { error: 'This story has expired', code: ErrorCode.EXPIRED, status: 410 }

// B4: Index setup for new collections
let b4IndexesCreated = false
async function ensureB4Indexes(db) {
  if (b4IndexesCreated) return
  b4IndexesCreated = true
  try {
    await Promise.all([
      db.collection('comment_likes').createIndex({ userId: 1, commentId: 1 }, { unique: true }),
      db.collection('comment_likes').createIndex({ commentId: 1 }),
      db.collection('content_items').createIndex({ authorId: 1, originalContentId: 1 }, { sparse: true }),
    ])
  } catch {}
}

export async function handleSocial(path, method, request, db) {
  await ensureB4Indexes(db)
  // ========================
  // POST /follow/:userId
  // ========================
  if (path[0] === 'follow' && path.length === 2 && method === 'POST') {
    const user = await requireAuth(request, db)
    const targetId = path[1]

    if (targetId === user.id) {
      return { error: 'Cannot follow yourself', code: ErrorCode.VALIDATION, status: 409, message: 'Self-follow is not allowed' }
    }

    // Anti-abuse: check follow velocity
    const abuseCheck = checkEngagementAbuse(user.id, ActionType.FOLLOW, targetId, targetId)
    if (abuseCheck.flagged) await logSuspiciousAction(db, user.id, ActionType.FOLLOW, targetId, abuseCheck)
    if (!abuseCheck.allowed) {
      return { error: abuseCheck.reason, code: 'ABUSE_DETECTED', status: 429 }
    }

    const target = await db.collection('users').findOne({ id: targetId })
    if (!target) return { error: 'User not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const existing = await db.collection('follows').findOne({
      followerId: user.id,
      followeeId: targetId,
    })
    if (existing) return { data: { message: 'Already following', isFollowing: true, viewerIsFollowing: true } }

    await db.collection('follows').insertOne({
      id: uuidv4(),
      followerId: user.id,
      followeeId: targetId,
      createdAt: new Date(),
    })

    await Promise.all([
      db.collection('users').updateOne({ id: user.id }, { $inc: { followingCount: 1 } }),
      db.collection('users').updateOne({ id: targetId }, { $inc: { followersCount: 1 } }),
    ])

    await createNotification(db, targetId, NotificationType.FOLLOW, user.id, 'USER', user.id, `${user.displayName} started following you`)

    return { data: { message: 'Followed', isFollowing: true, viewerIsFollowing: true } }
  }

  // ========================
  // DELETE /follow/:userId
  // ========================
  if (path[0] === 'follow' && path.length === 2 && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const targetId = path[1]

    const result = await db.collection('follows').deleteOne({
      followerId: user.id,
      followeeId: targetId,
    })

    if (result.deletedCount > 0) {
      await Promise.all([
        db.collection('users').updateOne({ id: user.id }, { $inc: { followingCount: -1 } }),
        db.collection('users').updateOne({ id: targetId }, { $inc: { followersCount: -1 } }),
      ])
    }

    return { data: { message: 'Unfollowed', isFollowing: false, viewerIsFollowing: false } }
  }

  // ========================
  // POST /content/:id/like
  // ========================
  if (path[0] === 'content' && path.length === 3 && path[2] === 'like' && method === 'POST') {
    const user = await requireAuth(request, db)
    const contentId = path[1]
    const post = await db.collection('content_items').findOne({ id: contentId })
    if (!post) return { error: 'Content not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (isExpiredStory(post)) return EXPIRED_RESPONSE

    // Anti-abuse: check engagement velocity
    const abuseCheck = checkEngagementAbuse(user.id, ActionType.LIKE, contentId, post.authorId)
    if (abuseCheck.flagged) await logSuspiciousAction(db, user.id, ActionType.LIKE, contentId, abuseCheck)
    if (!abuseCheck.allowed) {
      return { error: abuseCheck.reason, code: 'ABUSE_DETECTED', status: 429 }
    }

    const existing = await db.collection('reactions').findOne({ userId: user.id, contentId })

    if (existing) {
      if (existing.type === 'LIKE') return { data: { likeCount: post.likeCount, viewerHasLiked: true, viewerHasDisliked: false } }
      // Switch from dislike to like
      await db.collection('reactions').updateOne(
        { userId: user.id, contentId },
        { $set: { type: 'LIKE', updatedAt: new Date() } }
      )
      await db.collection('content_items').updateOne(
        { id: contentId },
        { $inc: { likeCount: 1, dislikeCountInternal: -1 } }
      )
    } else {
      await db.collection('reactions').insertOne({
        id: uuidv4(),
        userId: user.id,
        contentId,
        type: 'LIKE',
        createdAt: new Date(),
      })
      await db.collection('content_items').updateOne({ id: contentId }, { $inc: { likeCount: 1 } })
    }

    if (post.authorId !== user.id) {
      // B3: For page-authored content, notify page owner+admin members
      if (post.authorType === 'PAGE' && post.pageId) {
        const pageMembers = await db.collection('page_members')
          .find({ pageId: post.pageId, status: 'ACTIVE', role: { $in: ['OWNER', 'ADMIN'] } })
          .toArray()
        for (const m of pageMembers) {
          if (m.userId !== user.id) {
            await createNotification(db, m.userId, NotificationType.LIKE, user.id, 'CONTENT', contentId, `${user.displayName} liked your page's ${post.kind.toLowerCase()}`)
          }
        }
      } else {
        await createNotification(db, post.authorId, NotificationType.LIKE, user.id, 'CONTENT', contentId, `${user.displayName} liked your ${post.kind.toLowerCase()}`)
      }
    }

    // Event-driven distribution auto-eval (fire-and-forget, safe)
    triggerAutoEval(db, contentId).catch(() => {})

    const updated = await db.collection('content_items').findOne({ id: contentId })
    return { data: { likeCount: updated.likeCount, viewerHasLiked: true, viewerHasDisliked: false } }
  }

  // ========================
  // POST /content/:id/dislike (internal only — not visible to author)
  // ========================
  if (path[0] === 'content' && path.length === 3 && path[2] === 'dislike' && method === 'POST') {
    const user = await requireAuth(request, db)
    const contentId = path[1]
    const post = await db.collection('content_items').findOne({ id: contentId })
    if (!post) return { error: 'Content not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (isExpiredStory(post)) return EXPIRED_RESPONSE

    const existing = await db.collection('reactions').findOne({ userId: user.id, contentId })

    if (existing) {
      if (existing.type === 'DISLIKE') return { data: { viewerHasLiked: false, viewerHasDisliked: true } }
      await db.collection('reactions').updateOne(
        { userId: user.id, contentId },
        { $set: { type: 'DISLIKE', updatedAt: new Date() } }
      )
      await db.collection('content_items').updateOne(
        { id: contentId },
        { $inc: { likeCount: -1, dislikeCountInternal: 1 } }
      )
    } else {
      await db.collection('reactions').insertOne({
        id: uuidv4(),
        userId: user.id,
        contentId,
        type: 'DISLIKE',
        createdAt: new Date(),
      })
      await db.collection('content_items').updateOne({ id: contentId }, { $inc: { dislikeCountInternal: 1 } })
    }

    // No notification for dislikes — internal signal only
    return { data: { viewerHasLiked: false, viewerHasDisliked: true } }
  }

  // ========================
  // DELETE /content/:id/reaction
  // ========================
  if (path[0] === 'content' && path.length === 3 && path[2] === 'reaction' && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const contentId = path[1]
    const existing = await db.collection('reactions').findOne({ userId: user.id, contentId })
    if (!existing) return { data: { viewerHasLiked: false, viewerHasDisliked: false } }

    await db.collection('reactions').deleteOne({ userId: user.id, contentId })
    const field = existing.type === 'LIKE' ? 'likeCount' : 'dislikeCountInternal'
    await db.collection('content_items').updateOne({ id: contentId }, { $inc: { [field]: -1 } })

    return { data: { viewerHasLiked: false, viewerHasDisliked: false } }
  }

  // ========================
  // POST /content/:id/save
  // ========================
  if (path[0] === 'content' && path.length === 3 && path[2] === 'save' && method === 'POST') {
    const user = await requireAuth(request, db)
    const contentId = path[1]

    // Anti-abuse: check save velocity
    const abuseCheck = checkEngagementAbuse(user.id, ActionType.SAVE, contentId, null)
    if (abuseCheck.flagged) await logSuspiciousAction(db, user.id, ActionType.SAVE, contentId, abuseCheck)
    if (!abuseCheck.allowed) {
      return { error: abuseCheck.reason, code: 'ABUSE_DETECTED', status: 429 }
    }

    const existing = await db.collection('saves').findOne({ userId: user.id, contentId })
    if (existing) return { data: { saved: true } }

    await db.collection('saves').insertOne({
      id: uuidv4(),
      userId: user.id,
      contentId,
      createdAt: new Date(),
    })
    await db.collection('content_items').updateOne({ id: contentId }, { $inc: { saveCount: 1 } })

    return { data: { saved: true } }
  }

  // ========================
  // DELETE /content/:id/save
  // ========================
  if (path[0] === 'content' && path.length === 3 && path[2] === 'save' && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const contentId = path[1]
    const result = await db.collection('saves').deleteOne({ userId: user.id, contentId })
    if (result.deletedCount > 0) {
      await db.collection('content_items').updateOne({ id: contentId }, { $inc: { saveCount: -1 } })
    }
    return { data: { saved: false } }
  }

  // ========================
  // POST /content/:id/comments
  // ========================
  if (path[0] === 'content' && path.length === 3 && path[2] === 'comments' && method === 'POST') {
    const user = await requireAuth(request, db)
    const contentId = path[1]
    const post = await db.collection('content_items').findOne({ id: contentId })
    if (!post) return { error: 'Content not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (isExpiredStory(post)) return EXPIRED_RESPONSE

    // Anti-abuse: check comment velocity
    const abuseCheck = checkEngagementAbuse(user.id, ActionType.COMMENT, contentId, post.authorId)
    if (abuseCheck.flagged) await logSuspiciousAction(db, user.id, ActionType.COMMENT, contentId, abuseCheck)
    if (!abuseCheck.allowed) {
      return { error: abuseCheck.reason, code: 'ABUSE_DETECTED', status: 429 }
    }

    const body = await request.json()
    const commentText = body.body || body.text
    if (!commentText?.trim()) {
      return { error: 'Comment body is required', code: ErrorCode.VALIDATION, status: 400 }
    }

    // AI moderation on comment text via Provider-Adapter pattern
    let commentModeration = null
    let commentReviewTicketId = null
    try {
      const modResult = await moderateCreateContent(db, {
        entityType: 'comment',
        entityId: contentId,
        actorUserId: user.id,
        text: commentText,
        metadata: { route: 'POST /content/:id/comments' },
      })
      commentModeration = modResult.decision
      commentReviewTicketId = modResult.reviewTicketId
    } catch (err) {
      if (err.details?.code === 'CONTENT_REJECTED_BY_MODERATION') {
        return { error: 'Comment flagged by content safety filter', code: ErrorCode.VALIDATION, status: 400 }
      }
      throw err
    }

    const comment = {
      id: uuidv4(),
      contentId,
      authorId: user.id,
      parentId: body.parentId || null,
      body: commentText.slice(0, Config.MAX_COMMENT_LENGTH),
      text: commentText.slice(0, Config.MAX_COMMENT_LENGTH),
      likeCount: 0,
      moderation: commentModeration ? {
        action: commentModeration.action,
        provider: commentModeration.provider,
        confidence: commentModeration.confidence,
        flaggedCategories: commentModeration.flaggedCategories,
        reviewTicketId: commentReviewTicketId || null,
      } : null,
      createdAt: new Date(),
    }

    await db.collection('comments').insertOne(comment)
    await db.collection('content_items').updateOne({ id: contentId }, { $inc: { commentCount: 1 } })

    if (post.authorId !== user.id) {
      // B3: For page-authored content, notify page owner+admin members
      if (post.authorType === 'PAGE' && post.pageId) {
        const pageMembers = await db.collection('page_members')
          .find({ pageId: post.pageId, status: 'ACTIVE', role: { $in: ['OWNER', 'ADMIN'] } })
          .toArray()
        for (const m of pageMembers) {
          if (m.userId !== user.id) {
            await createNotification(db, m.userId, NotificationType.COMMENT, user.id, 'CONTENT', contentId, `${user.displayName} commented on your page's ${post.kind.toLowerCase()}`)
          }
        }
      } else {
        await createNotification(db, post.authorId, NotificationType.COMMENT, user.id, 'CONTENT', contentId, `${user.displayName} commented on your ${post.kind.toLowerCase()}`)
      }
    }

    // Event-driven distribution auto-eval
    triggerAutoEval(db, contentId).catch(() => {})

    const { _id, ...cleanComment } = comment
    return {
      data: {
        comment: { ...cleanComment, author: sanitizeUser(await db.collection('users').findOne({ id: user.id })) },
      },
      status: 201,
    }
  }

  // ========================
  // GET /content/:id/comments
  // ========================
  if (path[0] === 'content' && path.length === 3 && path[2] === 'comments' && method === 'GET') {
    const contentId = path[1]

    // B2: Parent content access check — if parent is hidden/removed, comments are inaccessible
    const parentContent = await db.collection('content_items').findOne({ id: contentId })
    const currentUser = await authenticate(request, db)
    if (!parentContent || !canViewComments(parentContent, currentUser?.id, currentUser?.role)) {
      return { error: 'Content not found', code: 'NOT_FOUND', status: 404 }
    }
    // B2: Block check on parent author
    if (currentUser?.id && parentContent.authorId !== currentUser.id) {
      const blocked = await isBlocked(db, currentUser.id, parentContent.authorId)
      if (blocked) return { error: 'Content not found', code: 'NOT_FOUND', status: 404 }
    }

    const url = new URL(request.url)
    const { limit, cursor } = parsePagination(url)

    const query = { contentId, parentId: null } // Top-level comments
    if (url.searchParams.get('parentId')) {
      query.parentId = url.searchParams.get('parentId')
      delete query.parentId // Actually set it
      query.parentId = url.searchParams.get('parentId')
    }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }

    const comments = await db.collection('comments')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = comments.length > limit
    const items = comments.slice(0, limit)

    // B2: Filter comments from blocked authors
    const safeItems = await filterBlockedComments(db, currentUser?.id, items)

    const authorIds = [...new Set(safeItems.map(c => c.authorId))]
    const authors = await db.collection('users').find({ id: { $in: authorIds } }).toArray()
    const authorMap = Object.fromEntries(authors.map(a => [a.id, sanitizeUser(a)]))

    const enriched = safeItems.map(c => {
      const { _id, ...clean } = c
      return { ...clean, text: c.text || c.body, body: c.body || c.text, author: authorMap[c.authorId] || null }
    })

    const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null
    return {
      data: {
        items: enriched,
        // Backward-compat alias (v1→v2 migration window)
        comments: enriched,
        pagination: {
          nextCursor,
          hasMore,
        },
        nextCursor,
      },
    }
  }

  // ========================
  // POST /content/:postId/comments/:commentId/like — Like Comment
  // ========================
  if (path[0] === 'content' && path[2] === 'comments' && path[4] === 'like' && path.length === 5 && method === 'POST') {
    const user = await requireAuth(request, db)
    const postId = path[1]
    const commentId = path[3]

    // B2: Verify parent content is accessible
    const post = await db.collection('content_items').findOne({ id: postId })
    if (!post || post.visibility === Visibility.REMOVED) {
      return { error: 'Content not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }
    if (!canViewContent(post, user.id, user.role)) {
      return { error: 'Content not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }
    if (user.id && post.authorId !== user.id) {
      const blocked = await isBlocked(db, user.id, post.authorId)
      if (blocked) return { error: 'Content not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    // Verify comment exists and belongs to this post
    const comment = await db.collection('comments').findOne({ id: commentId, contentId: postId })
    if (!comment) {
      return { error: 'Comment not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    // Idempotent: check if already liked
    const existing = await db.collection('comment_likes').findOne({ userId: user.id, commentId })
    if (existing) {
      const updated = await db.collection('comments').findOne({ id: commentId })
      return { data: { liked: true, commentLikeCount: updated?.likeCount || 0 } }
    }

    await db.collection('comment_likes').insertOne({
      id: uuidv4(),
      userId: user.id,
      commentId,
      contentId: postId,
      createdAt: new Date(),
    })
    await db.collection('comments').updateOne({ id: commentId }, { $inc: { likeCount: 1 } })

    // Notification: notify comment author (not self)
    if (comment.authorId !== user.id) {
      // B3: If parent is page-authored, still notify the comment author (who is a user)
      await createNotification(db, comment.authorId, NotificationType.COMMENT_LIKE, user.id, 'COMMENT', commentId,
        `${user.displayName} liked your comment`)
    }

    const updated = await db.collection('comments').findOne({ id: commentId })
    return { data: { liked: true, commentLikeCount: updated?.likeCount || 0 } }
  }

  // ========================
  // DELETE /content/:postId/comments/:commentId/like — Unlike Comment
  // ========================
  if (path[0] === 'content' && path[2] === 'comments' && path[4] === 'like' && path.length === 5 && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const postId = path[1]
    const commentId = path[3]

    const result = await db.collection('comment_likes').deleteOne({ userId: user.id, commentId })
    if (result.deletedCount > 0) {
      await db.collection('comments').updateOne({ id: commentId }, { $inc: { likeCount: -1 } })
    }

    const comment = await db.collection('comments').findOne({ id: commentId })
    return { data: { liked: false, commentLikeCount: comment?.likeCount || 0 } }
  }

  // ========================
  // POST /content/:id/share — Share / Repost
  // ========================
  if (path[0] === 'content' && path.length === 3 && path[2] === 'share' && method === 'POST') {
    const user = await requireAuth(request, db)
    const originalContentId = path[1]
    const original = await db.collection('content_items').findOne({ id: originalContentId })

    if (!original || original.visibility === Visibility.REMOVED) {
      return { error: 'Content not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    // Anti-abuse: check share velocity
    const abuseCheck = checkEngagementAbuse(user.id, ActionType.SHARE, originalContentId, original.authorId)
    if (abuseCheck.flagged) await logSuspiciousAction(db, user.id, ActionType.SHARE, originalContentId, abuseCheck)
    if (!abuseCheck.allowed) {
      return { error: abuseCheck.reason, code: 'ABUSE_DETECTED', status: 429 }
    }

    // B2: Visibility check
    if (!canViewContent(original, user.id, user.role)) {
      return { error: 'Content not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    // B2: Block check
    if (user.id && original.authorId !== user.id) {
      const blocked = await isBlocked(db, user.id, original.authorId)
      if (blocked) return { error: 'Content not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    // Cannot repost a repost (only original content)
    if (original.originalContentId) {
      return { error: 'Cannot repost a repost', code: ErrorCode.VALIDATION, status: 400 }
    }

    // One repost per user per original
    const existingRepost = await db.collection('content_items').findOne({
      authorId: user.id, originalContentId, authorType: 'USER',
      visibility: { $ne: Visibility.REMOVED },
    })
    if (existingRepost) {
      return { error: 'Already shared this content', code: ErrorCode.DUPLICATE, status: 409 }
    }

    const now = new Date()
    const repostId = uuidv4()

    // Optionally include a quote caption
    let body = {}
    try { body = await request.json() } catch {}

    const repost = {
      id: repostId,
      kind: original.kind || ContentKind.POST,
      authorId: user.id,
      authorType: 'USER',
      caption: body.caption ? String(body.caption).slice(0, Config.MAX_CAPTION_LENGTH) : '',
      media: [],
      visibility: Visibility.PUBLIC,
      originalContentId,
      isRepost: true,
      likeCount: 0,
      dislikeCountInternal: 0,
      commentCount: 0,
      saveCount: 0,
      shareCount: 0,
      viewCount: 0,
      collegeId: user.collegeId || null,
      houseId: user.houseId || user.tribeId || null,
      distributionStage: 0,
      createdAt: now,
      updatedAt: now,
    }

    await db.collection('content_items').insertOne(repost)

    // Increment shareCount on original
    await db.collection('content_items').updateOne({ id: originalContentId }, { $inc: { shareCount: 1 } })

    // Notification to original author (not self)
    const originalAuthorId = original.authorId
    if (original.authorType === 'PAGE' && original.pageId) {
      // Notify page owner+admin
      const pageMembers = await db.collection('page_members')
        .find({ pageId: original.pageId, status: 'ACTIVE', role: { $in: ['OWNER', 'ADMIN'] } })
        .toArray()
      for (const m of pageMembers) {
        if (m.userId !== user.id) {
          await createNotification(db, m.userId, NotificationType.SHARE, user.id, 'CONTENT', originalContentId,
            `${user.displayName} shared your page's ${(original.kind || 'post').toLowerCase()}`)
        }
      }
    } else if (originalAuthorId !== user.id) {
      await createNotification(db, originalAuthorId, NotificationType.SHARE, user.id, 'CONTENT', originalContentId,
        `${user.displayName} shared your ${(original.kind || 'post').toLowerCase()}`)
    }

    await writeAudit(db, 'CONTENT_SHARED', user.id, 'CONTENT', originalContentId, {
      repostId, originalAuthorId,
    })

    await invalidateOnEvent('POST_CREATED', { collegeId: repost.collegeId, houseId: repost.houseId })

    const enriched = await enrichPosts(db, [repost], user.id)
    return { data: { post: enriched[0] }, status: 201 }
  }

  return null
}
