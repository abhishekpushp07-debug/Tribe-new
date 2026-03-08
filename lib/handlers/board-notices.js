/**
 * Tribe — Stage 7: World's Best Board Notices + Authenticity Tags
 *
 * ~17 endpoints, 4 collections, 16 indexes
 * Features: full lifecycle, categories, priority, pinning, acknowledgments,
 *   admin moderation, authenticity tagging, tag stats, block integration
 */

import { v4 as uuidv4 } from 'uuid'
import { requireAuth, authenticate, requireRole, writeAudit, sanitizeUser, parsePagination } from '../auth-utils.js'
import { ErrorCode } from '../constants.js'

// ========== CONSTANTS ==========
const NOTICE_TITLE_MAX = 300
const NOTICE_BODY_MAX = 10000
const NOTICE_MAX_PINNED = 3
const ALLOWED_PRIORITIES = ['URGENT', 'IMPORTANT', 'NORMAL', 'FYI']
const ALLOWED_CATEGORIES = ['ACADEMIC', 'ADMINISTRATIVE', 'EXAMINATION', 'PLACEMENT', 'CULTURAL', 'GENERAL']
const ALLOWED_NOTICE_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'ARCHIVED', 'REMOVED']
const ALLOWED_TAGS = ['VERIFIED', 'USEFUL', 'OUTDATED', 'MISLEADING']
const ALLOWED_TAG_TARGETS = ['RESOURCE', 'EVENT', 'NOTICE']

// ========== HELPERS ==========
function isAdmin(user) {
  return ['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)
}

function sanitizeDoc(d) {
  if (!d) return null
  const { _id, ...clean } = d
  return clean
}

function sanitizeDocs(arr) {
  return arr.map(sanitizeDoc).filter(Boolean)
}

// ========== BOARD NOTICES HANDLER ==========
export async function handleBoardNotices(path, method, request, db) {

  // ========================
  // POST /board/notices — Create notice
  // ========================
  if (path[0] === 'board' && path[1] === 'notices' && path.length === 2 && method === 'POST') {
    const user = await requireAuth(request, db)

    // Must be active board member or admin
    const seat = await db.collection('board_seats').findOne({ userId: user.id, status: 'ACTIVE' })
    if (!seat && !isAdmin(user)) {
      return { error: 'Only board members or admins can create notices', code: 'FORBIDDEN', status: 403 }
    }

    const body = await request.json()
    const { title, body: noticeBody, category = 'GENERAL', priority = 'NORMAL', isDraft = false, attachments, expiresAt } = body

    if (!title || !noticeBody) {
      return { error: 'title and body are required', code: 'VALIDATION_ERROR', status: 400 }
    }
    if (title.length > NOTICE_TITLE_MAX) return { error: `Title max ${NOTICE_TITLE_MAX} chars`, code: 'VALIDATION_ERROR', status: 400 }
    if (noticeBody.length > NOTICE_BODY_MAX) return { error: `Body max ${NOTICE_BODY_MAX} chars`, code: 'VALIDATION_ERROR', status: 400 }
    if (!ALLOWED_CATEGORIES.includes(category)) return { error: `Category must be: ${ALLOWED_CATEGORIES.join(', ')}`, code: 'VALIDATION_ERROR', status: 400 }
    if (!ALLOWED_PRIORITIES.includes(priority)) return { error: `Priority must be: ${ALLOWED_PRIORITIES.join(', ')}`, code: 'VALIDATION_ERROR', status: 400 }

    const collegeId = seat ? seat.collegeId : user.collegeId
    const now = new Date()
    const notice = {
      id: uuidv4(),
      collegeId: collegeId || null,
      creatorId: user.id,
      title: title.trim().slice(0, NOTICE_TITLE_MAX),
      body: noticeBody.trim().slice(0, NOTICE_BODY_MAX),
      category,
      priority,
      status: isDraft ? 'DRAFT' : (isAdmin(user) ? 'PUBLISHED' : 'PENDING_REVIEW'),
      pinnedToBoard: false,
      attachments: (attachments || []).slice(0, 5).map(a => ({
        name: a.name?.slice(0, 200),
        url: a.url,
        type: a.type || 'OTHER',
      })),
      acknowledgmentCount: 0,
      reportCount: 0,
      reviewedById: isAdmin(user) ? user.id : null,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      publishedAt: isDraft ? null : (isAdmin(user) ? now : null),
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
      removedAt: null,
    }

    await db.collection('board_notices').insertOne(notice)
    await writeAudit(db, 'BOARD_NOTICE_CREATED', user.id, 'BOARD_NOTICE', notice.id, { category, priority, status: notice.status })

    return { data: { notice: sanitizeDoc(notice) }, status: 201 }
  }

  // ========================
  // GET /board/notices/:id — Notice detail
  // ========================
  if (path[0] === 'board' && path[1] === 'notices' && path.length === 3 && method === 'GET') {
    const viewer = await authenticate(request, db)
    const noticeId = path[2]

    const notice = await db.collection('board_notices').findOne({ id: noticeId })
    if (!notice) return { error: 'Notice not found', code: 'NOT_FOUND', status: 404 }

    if (notice.status === 'REMOVED') return { error: 'This notice has been removed', code: 'GONE', status: 410 }

    const isOwner = viewer?.id === notice.creatorId
    const isAdminUser = viewer && isAdmin(viewer)

    if (notice.status === 'DRAFT' && !isOwner) return { error: 'Notice not found', code: 'NOT_FOUND', status: 404 }
    if (notice.status === 'PENDING_REVIEW' && !isOwner && !isAdminUser) return { error: 'Notice not found', code: 'NOT_FOUND', status: 404 }
    if (notice.status === 'REJECTED' && !isOwner && !isAdminUser) return { error: 'Notice not found', code: 'NOT_FOUND', status: 404 }

    const creator = await db.collection('users').findOne({ id: notice.creatorId })
    let result = { ...sanitizeDoc(notice), creator: creator ? sanitizeUser(creator) : null }

    // Viewer acknowledgment
    if (viewer) {
      const ack = await db.collection('notice_acknowledgments').findOne({ noticeId, userId: viewer.id })
      result.acknowledgedByMe = !!ack
    }

    // Authenticity tags
    const tags = await db.collection('authenticity_tags')
      .find({ targetType: 'NOTICE', targetId: noticeId }, { projection: { _id: 0 } })
      .toArray()
    result.authenticityTags = tags

    return { data: { notice: result } }
  }

  // ========================
  // PATCH /board/notices/:id — Edit notice
  // ========================
  if (path[0] === 'board' && path[1] === 'notices' && path.length === 3 && method === 'PATCH') {
    const user = await requireAuth(request, db)
    const noticeId = path[2]

    const notice = await db.collection('board_notices').findOne({ id: noticeId })
    if (!notice) return { error: 'Notice not found', code: 'NOT_FOUND', status: 404 }
    if (notice.creatorId !== user.id && !isAdmin(user)) return { error: 'Not authorized', code: 'FORBIDDEN', status: 403 }
    if (['REMOVED'].includes(notice.status)) return { error: `Cannot edit notice with status ${notice.status}`, code: 'INVALID_STATE', status: 400 }

    const body = await request.json()
    const updates = { updatedAt: new Date() }

    if (body.title !== undefined) {
      if (!body.title || body.title.length > NOTICE_TITLE_MAX) return { error: 'Title required', code: 'VALIDATION_ERROR', status: 400 }
      updates.title = body.title.trim()
    }
    if (body.body !== undefined) {
      if (!body.body || body.body.length > NOTICE_BODY_MAX) return { error: 'Body required', code: 'VALIDATION_ERROR', status: 400 }
      updates.body = body.body.trim()
    }
    if (body.category !== undefined) {
      if (!ALLOWED_CATEGORIES.includes(body.category)) return { error: 'Invalid category', code: 'VALIDATION_ERROR', status: 400 }
      updates.category = body.category
    }
    if (body.priority !== undefined) {
      if (!ALLOWED_PRIORITIES.includes(body.priority)) return { error: 'Invalid priority', code: 'VALIDATION_ERROR', status: 400 }
      updates.priority = body.priority
    }
    if (body.expiresAt !== undefined) updates.expiresAt = body.expiresAt ? new Date(body.expiresAt) : null
    if (body.attachments !== undefined) {
      updates.attachments = (body.attachments || []).slice(0, 5).map(a => ({
        name: a.name?.slice(0, 200), url: a.url, type: a.type || 'OTHER',
      }))
    }

    // If edited while PENDING_REVIEW, reset to PENDING_REVIEW
    if (notice.status === 'PUBLISHED' && !isAdmin(user)) {
      updates.status = 'PENDING_REVIEW'
      updates.publishedAt = null
    }

    await db.collection('board_notices').updateOne({ id: noticeId }, { $set: updates })
    const updated = await db.collection('board_notices').findOne({ id: noticeId })
    await writeAudit(db, 'BOARD_NOTICE_EDITED', user.id, 'BOARD_NOTICE', noticeId, { fields: Object.keys(updates) })

    return { data: { notice: sanitizeDoc(updated) } }
  }

  // ========================
  // DELETE /board/notices/:id — Delete notice
  // ========================
  if (path[0] === 'board' && path[1] === 'notices' && path.length === 3 && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const noticeId = path[2]

    const notice = await db.collection('board_notices').findOne({ id: noticeId })
    if (!notice) return { error: 'Notice not found', code: 'NOT_FOUND', status: 404 }
    if (notice.creatorId !== user.id && !isAdmin(user)) return { error: 'Not authorized', code: 'FORBIDDEN', status: 403 }

    await db.collection('board_notices').updateOne({ id: noticeId }, {
      $set: { status: 'REMOVED', removedAt: new Date(), updatedAt: new Date() },
    })
    await writeAudit(db, 'BOARD_NOTICE_DELETED', user.id, 'BOARD_NOTICE', noticeId, { previousStatus: notice.status })

    return { data: { message: 'Notice removed', noticeId } }
  }

  // ========================
  // POST /board/notices/:id/pin — Pin notice
  // ========================
  if (path[0] === 'board' && path[1] === 'notices' && path.length === 4 && path[3] === 'pin' && method === 'POST') {
    const user = await requireAuth(request, db)
    if (!isAdmin(user)) {
      const seat = await db.collection('board_seats').findOne({ userId: user.id, status: 'ACTIVE' })
      if (!seat) return { error: 'Not authorized', code: 'FORBIDDEN', status: 403 }
    }

    const noticeId = path[2]
    const notice = await db.collection('board_notices').findOne({ id: noticeId })
    if (!notice) return { error: 'Notice not found', code: 'NOT_FOUND', status: 404 }
    if (notice.status !== 'PUBLISHED') return { error: 'Only published notices can be pinned', code: 'INVALID_STATE', status: 400 }

    const pinnedCount = await db.collection('board_notices').countDocuments({
      collegeId: notice.collegeId, pinnedToBoard: true, status: 'PUBLISHED',
    })
    if (pinnedCount >= NOTICE_MAX_PINNED && !notice.pinnedToBoard) {
      return { error: `Max ${NOTICE_MAX_PINNED} pinned notices per college`, code: 'LIMIT_EXCEEDED', status: 429 }
    }

    await db.collection('board_notices').updateOne({ id: noticeId }, { $set: { pinnedToBoard: true, updatedAt: new Date() } })
    return { data: { message: 'Notice pinned', noticeId } }
  }

  // ========================
  // DELETE /board/notices/:id/pin — Unpin notice
  // ========================
  if (path[0] === 'board' && path[1] === 'notices' && path.length === 4 && path[3] === 'pin' && method === 'DELETE') {
    const user = await requireAuth(request, db)
    if (!isAdmin(user)) {
      const seat = await db.collection('board_seats').findOne({ userId: user.id, status: 'ACTIVE' })
      if (!seat) return { error: 'Not authorized', code: 'FORBIDDEN', status: 403 }
    }

    const noticeId = path[2]
    await db.collection('board_notices').updateOne({ id: noticeId }, { $set: { pinnedToBoard: false, updatedAt: new Date() } })
    return { data: { message: 'Notice unpinned', noticeId } }
  }

  // ========================
  // POST /board/notices/:id/acknowledge — Acknowledge notice
  // ========================
  if (path[0] === 'board' && path[1] === 'notices' && path.length === 4 && path[3] === 'acknowledge' && method === 'POST') {
    const user = await requireAuth(request, db)
    const noticeId = path[2]

    const notice = await db.collection('board_notices').findOne({ id: noticeId, status: 'PUBLISHED' })
    if (!notice) return { error: 'Notice not found', code: 'NOT_FOUND', status: 404 }

    const result = await db.collection('notice_acknowledgments').updateOne(
      { noticeId, userId: user.id },
      { $setOnInsert: { id: uuidv4(), noticeId, userId: user.id, collegeId: notice.collegeId, createdAt: new Date() } },
      { upsert: true }
    )

    if (result.upsertedCount > 0) {
      const ackCount = await db.collection('notice_acknowledgments').countDocuments({ noticeId })
      await db.collection('board_notices').updateOne({ id: noticeId }, { $set: { acknowledgmentCount: ackCount, updatedAt: new Date() } })
    }

    return { data: { message: 'Acknowledged', noticeId } }
  }

  // ========================
  // GET /board/notices/:id/acknowledgments — Acknowledgment list
  // ========================
  if (path[0] === 'board' && path[1] === 'notices' && path.length === 4 && path[3] === 'acknowledgments' && method === 'GET') {
    const viewer = await authenticate(request, db)
    const noticeId = path[2]
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100)
    const offset = parseInt(url.searchParams.get('offset') || '0')

    const [acks, total] = await Promise.all([
      db.collection('notice_acknowledgments').find({ noticeId }).sort({ createdAt: -1 }).skip(offset).limit(limit).toArray(),
      db.collection('notice_acknowledgments').countDocuments({ noticeId }),
    ])

    const userIds = acks.map(a => a.userId)
    const users = userIds.length > 0
      ? await db.collection('users').find({ id: { $in: userIds } }).toArray()
      : []
    const userMap = Object.fromEntries(users.map(u => [u.id, sanitizeUser(u)]))

    const items = acks.map(a => ({ userId: a.userId, acknowledgedAt: a.createdAt, user: userMap[a.userId] || null }))

    return { data: { items, total, noticeId } }
  }

  // ========================
  // GET /colleges/:id/notices — Public college notices (pinned first)
  // ========================
  if (path[0] === 'colleges' && path.length === 3 && path[2] === 'notices' && method === 'GET') {
    const collegeId = path[1]
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
    const cursor = url.searchParams.get('cursor')
    const category = url.searchParams.get('category')
    const priority = url.searchParams.get('priority')

    const query = { collegeId, status: 'PUBLISHED' }
    if (category && ALLOWED_CATEGORIES.includes(category)) query.category = category
    if (priority && ALLOWED_PRIORITIES.includes(priority)) query.priority = priority
    if (cursor) query.publishedAt = { $lt: new Date(cursor) }

    // Check expiry
    query.$or = [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }]

    const notices = await db.collection('board_notices')
      .find(query)
      .sort({ pinnedToBoard: -1, publishedAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = notices.length > limit
    const items = sanitizeDocs(notices.slice(0, limit))

    // Batch creator info
    const creatorIds = [...new Set(items.map(n => n.creatorId))]
    const creators = creatorIds.length > 0
      ? await db.collection('users').find({ id: { $in: creatorIds } }).toArray()
      : []
    const creatorMap = Object.fromEntries(creators.map(u => [u.id, sanitizeUser(u)]))

    const enriched = items.map(n => ({ ...n, creator: creatorMap[n.creatorId] || null }))

    return {
      data: {
        items: enriched,
        nextCursor: hasMore ? items[items.length - 1]?.publishedAt?.toISOString() : null,
        hasMore,
      },
    }
  }

  // ========================
  // GET /me/board/notices — My created notices
  // ========================
  if (path[0] === 'me' && path[1] === 'board' && path[2] === 'notices' && path.length === 3 && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)

    const notices = await db.collection('board_notices')
      .find({ creatorId: user.id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray()

    return { data: { items: sanitizeDocs(notices) } }
  }

  // ========================
  // MODERATION ROUTES
  // ========================

  // GET /moderation/board-notices — Review queue
  if (path[0] === 'moderation' && path[1] === 'board-notices' && path.length === 2 && method === 'GET') {
    const user = await requireAuth(request, db)
    requireRole(user, 'MODERATOR', 'ADMIN', 'SUPER_ADMIN')

    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100)
    const statusFilter = url.searchParams.get('status') || 'PENDING_REVIEW'

    const notices = await db.collection('board_notices')
      .find({ status: statusFilter })
      .sort({ createdAt: 1 })
      .limit(limit)
      .toArray()

    // Batch creators
    const creatorIds = [...new Set(notices.map(n => n.creatorId))]
    const creators = creatorIds.length > 0
      ? await db.collection('users').find({ id: { $in: creatorIds } }).toArray()
      : []
    const creatorMap = Object.fromEntries(creators.map(u => [u.id, sanitizeUser(u)]))

    const items = sanitizeDocs(notices).map(n => ({ ...n, creator: creatorMap[n.creatorId] || null }))

    return { data: { items } }
  }

  // POST /moderation/board-notices/:id/decide — Approve or reject
  if (path[0] === 'moderation' && path[1] === 'board-notices' && path.length === 4 && path[3] === 'decide' && method === 'POST') {
    const user = await requireAuth(request, db)
    requireRole(user, 'MODERATOR', 'ADMIN', 'SUPER_ADMIN')

    const noticeId = path[2]
    const body = await request.json()
    const { approve, reason } = body

    if (typeof approve !== 'boolean') return { error: 'approve (boolean) required', code: 'VALIDATION_ERROR', status: 400 }

    const notice = await db.collection('board_notices').findOne({ id: noticeId })
    if (!notice) return { error: 'Notice not found', code: 'NOT_FOUND', status: 404 }
    if (notice.status !== 'PENDING_REVIEW') return { error: 'Notice not pending review', code: 'CONFLICT', status: 409 }

    const now = new Date()
    await db.collection('board_notices').updateOne({ id: noticeId }, {
      $set: {
        status: approve ? 'PUBLISHED' : 'REJECTED',
        reviewedById: user.id,
        publishedAt: approve ? now : null,
        rejectionReason: approve ? null : (reason || null),
        updatedAt: now,
      },
    })

    await writeAudit(db, approve ? 'BOARD_NOTICE_APPROVED' : 'BOARD_NOTICE_REJECTED', user.id, 'BOARD_NOTICE', noticeId, { reason })

    return { data: { notice: { id: noticeId, status: approve ? 'PUBLISHED' : 'REJECTED' } } }
  }

  // GET /admin/board-notices/analytics — Analytics
  if (path[0] === 'admin' && path[1] === 'board-notices' && path[2] === 'analytics' && path.length === 3 && method === 'GET') {
    const user = await requireAuth(request, db)
    requireRole(user, 'ADMIN', 'SUPER_ADMIN')

    const [total, published, pending, rejected, archived, totalAcks] = await Promise.all([
      db.collection('board_notices').countDocuments({}),
      db.collection('board_notices').countDocuments({ status: 'PUBLISHED' }),
      db.collection('board_notices').countDocuments({ status: 'PENDING_REVIEW' }),
      db.collection('board_notices').countDocuments({ status: 'REJECTED' }),
      db.collection('board_notices').countDocuments({ status: 'ARCHIVED' }),
      db.collection('notice_acknowledgments').countDocuments({}),
    ])

    const categories = {}
    for (const cat of ALLOWED_CATEGORIES) {
      categories[cat] = await db.collection('board_notices').countDocuments({ category: cat, status: 'PUBLISHED' })
    }

    return { data: { total, published, pending, rejected, archived, totalAcks, categories } }
  }

  return null
}

// ========== AUTHENTICITY TAGS HANDLER ==========
export async function handleAuthenticityTags(path, method, request, db) {

  // ========================
  // POST /authenticity/tag — Create/update tag
  // ========================
  if (path[0] === 'authenticity' && path[1] === 'tag' && path.length === 2 && method === 'POST') {
    const user = await requireAuth(request, db)

    const isModerator = isAdmin(user)
    const isBoardMember = await db.collection('board_seats').findOne({ userId: user.id, status: 'ACTIVE' })
    if (!isModerator && !isBoardMember) {
      return { error: 'Only board members or moderators can add authenticity tags', code: 'FORBIDDEN', status: 403 }
    }

    const body = await request.json()
    const { targetType, targetId, tag } = body

    if (!targetType || !ALLOWED_TAG_TARGETS.includes(targetType)) {
      return { error: `targetType must be: ${ALLOWED_TAG_TARGETS.join(', ')}`, code: 'VALIDATION_ERROR', status: 400 }
    }
    if (!targetId) return { error: 'targetId is required', code: 'VALIDATION_ERROR', status: 400 }
    if (!tag || !ALLOWED_TAGS.includes(tag)) {
      return { error: `tag must be: ${ALLOWED_TAGS.join(', ')}`, code: 'VALIDATION_ERROR', status: 400 }
    }

    // Check target exists
    const collectionMap = { RESOURCE: 'resources', EVENT: 'events', NOTICE: 'board_notices' }
    const target = await db.collection(collectionMap[targetType]).findOne({ id: targetId })
    if (!target) return { error: `${targetType} not found`, code: 'NOT_FOUND', status: 404 }

    // Upsert: update if same actor already tagged
    const existing = await db.collection('authenticity_tags').findOne({ targetType, targetId, actorId: user.id })
    if (existing) {
      await db.collection('authenticity_tags').updateOne(
        { targetType, targetId, actorId: user.id },
        { $set: { tag, updatedAt: new Date() } }
      )
      return { data: { tag: { targetType, targetId, tag, actorId: user.id, updated: true } } }
    }

    const tagDoc = {
      id: uuidv4(),
      targetType,
      targetId,
      tag,
      actorType: isModerator ? 'MODERATOR' : 'BOARD',
      actorId: user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    await db.collection('authenticity_tags').insertOne(tagDoc)
    await writeAudit(db, 'AUTHENTICITY_TAG_CREATED', user.id, 'AUTHENTICITY_TAG', tagDoc.id, { targetType, targetId, tag })

    return { data: { tag: sanitizeDoc(tagDoc) }, status: 201 }
  }

  // ========================
  // GET /authenticity/tags/:targetType/:targetId — Get tags
  // ========================
  if (path[0] === 'authenticity' && path[1] === 'tags' && path.length === 4 && method === 'GET') {
    const targetType = path[2].toUpperCase()
    const targetId = path[3]

    const tags = await db.collection('authenticity_tags')
      .find({ targetType, targetId })
      .sort({ createdAt: -1 })
      .toArray()

    // Batch actor info
    const actorIds = [...new Set(tags.map(t => t.actorId))]
    const actors = actorIds.length > 0
      ? await db.collection('users').find({ id: { $in: actorIds } }).toArray()
      : []
    const actorMap = Object.fromEntries(actors.map(u => [u.id, sanitizeUser(u)]))

    const items = sanitizeDocs(tags).map(t => ({ ...t, actor: actorMap[t.actorId] || null }))

    // Tag summary
    const summary = {}
    for (const t of ALLOWED_TAGS) {
      summary[t] = items.filter(i => i.tag === t).length
    }

    return { data: { tags: items, summary, total: items.length } }
  }

  // ========================
  // DELETE /authenticity/tags/:id — Remove tag
  // ========================
  if (path[0] === 'authenticity' && path[1] === 'tags' && path.length === 3 && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const tagId = path[2]

    const tag = await db.collection('authenticity_tags').findOne({ id: tagId })
    if (!tag) return { error: 'Tag not found', code: 'NOT_FOUND', status: 404 }
    if (tag.actorId !== user.id && !isAdmin(user)) {
      return { error: 'Not authorized', code: 'FORBIDDEN', status: 403 }
    }

    await db.collection('authenticity_tags').deleteOne({ id: tagId })
    await writeAudit(db, 'AUTHENTICITY_TAG_REMOVED', user.id, 'AUTHENTICITY_TAG', tagId, { targetType: tag.targetType, targetId: tag.targetId })

    return { data: { message: 'Tag removed', tagId } }
  }

  // ========================
  // GET /admin/authenticity/stats — Tag statistics
  // ========================
  if (path[0] === 'admin' && path[1] === 'authenticity' && path[2] === 'stats' && path.length === 3 && method === 'GET') {
    const user = await requireAuth(request, db)
    requireRole(user, 'ADMIN', 'SUPER_ADMIN')

    const totalTags = await db.collection('authenticity_tags').countDocuments({})
    const byTag = {}
    for (const t of ALLOWED_TAGS) {
      byTag[t] = await db.collection('authenticity_tags').countDocuments({ tag: t })
    }
    const byTarget = {}
    for (const t of ALLOWED_TAG_TARGETS) {
      byTarget[t] = await db.collection('authenticity_tags').countDocuments({ targetType: t })
    }

    return { data: { totalTags, byTag, byTarget } }
  }

  return null
}
