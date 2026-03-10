import { v4 as uuidv4 } from 'uuid'
import { Config, ErrorCode, NotificationType, ContentKind } from '../constants.js'
import { requireAuth, authenticate, sanitizeUser, createNotification, parsePagination } from '../auth-utils.js'
import { moderateCreateContent } from '../moderation/middleware/moderate-create-content.js'
import { triggerAutoEval } from './stages.js'
import { canViewComments, filterBlockedComments, isBlocked } from '../access-policy.js'

// Guard: block interactions on expired/malformed stories
// STORY invariant: must have valid expiresAt AND it must be in the future
function isExpiredStory(post) {
  return post.kind === ContentKind.STORY && (!post.expiresAt || new Date(post.expiresAt) <= new Date())
}
const EXPIRED_RESPONSE = { error: 'This story has expired', code: ErrorCode.EXPIRED, status: 410 }

export async function handleSocial(path, method, request, db) {
  // ========================
  // POST /follow/:userId
  // ========================
  if (path[0] === 'follow' && path.length === 2 && method === 'POST') {
    const user = await requireAuth(request, db)
    const targetId = path[1]

    if (targetId === user.id) {
      return { error: 'Cannot follow yourself', code: ErrorCode.VALIDATION, status: 409, message: 'Self-follow is not allowed' }
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
      await createNotification(db, post.authorId, NotificationType.LIKE, user.id, 'CONTENT', contentId, `${user.displayName} liked your ${post.kind.toLowerCase()}`)
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
      await createNotification(db, post.authorId, NotificationType.COMMENT, user.id, 'CONTENT', contentId, `${user.displayName} commented on your ${post.kind.toLowerCase()}`)
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

  return null
}
