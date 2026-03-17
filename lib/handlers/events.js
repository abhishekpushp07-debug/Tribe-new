/**
 * Tribe — Stage 6: World's Best Events + RSVP Backend
 *
 * ~21 endpoints, 4 collections, 16 indexes
 * Features: full lifecycle, categories, capacity/waitlist, RSVP,
 *   block integration, reports+auto-hold, organizer tools, admin moderation
 */

import { v4 as uuidv4 } from 'uuid'
import { requireAuth, authenticate, requireRole, writeAudit, sanitizeUser, parsePagination } from '../auth-utils.js'
import { ErrorCode } from '../constants.js'
import { publishStoryEvent } from '../realtime.js'

// ========== CONSTANTS ==========
const EVENT_TITLE_MAX = 200
const EVENT_DESC_MAX = 5000
const EVENT_LOCATION_MAX = 300
const EVENT_CREATE_RATE_LIMIT = 10 // per hour
const EVENT_REPORT_AUTO_HOLD = 3
const ALLOWED_CATEGORIES = ['ACADEMIC', 'CULTURAL', 'SPORTS', 'SOCIAL', 'WORKSHOP', 'PLACEMENT', 'OTHER']
const ALLOWED_VISIBILITIES = ['PUBLIC', 'COLLEGE', 'PRIVATE']
const ALLOWED_STATUSES = ['DRAFT', 'PUBLISHED', 'CANCELLED', 'ARCHIVED', 'HELD', 'REMOVED']
const ALLOWED_RSVP = ['GOING', 'INTERESTED']
const EVENT_FEED_LIMIT = 20

// ========== HELPERS ==========
function isAdmin(user) {
  return ['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)
}

function sanitizeEvent(e) {
  if (!e) return null
  const { _id, ...clean } = e
  return clean
}

function sanitizeEvents(arr) {
  return arr.map(sanitizeEvent).filter(Boolean)
}

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

async function batchBlockCheck(db, userId, otherIds) {
  if (!otherIds.length) return new Set()
  const blocks = await db.collection('blocks').find({
    $or: [
      { blockerId: userId, blockedId: { $in: otherIds } },
      { blockedId: userId, blockerId: { $in: otherIds } },
    ],
  }).toArray()
  const s = new Set()
  for (const b of blocks) s.add(b.blockerId === userId ? b.blockedId : b.blockerId)
  return s
}

function computeEventScore(event) {
  const hoursUntilStart = (new Date(event.startAt).getTime() - Date.now()) / 3_600_000
  const urgency = hoursUntilStart > 0 ? 1 / (1 + hoursUntilStart / 48) : 0
  const popularity = ((event.goingCount || 0) * 2 + (event.interestedCount || 0)) / Math.max(1, (event.goingCount || 0) + (event.interestedCount || 0) + 1)
  const penalty = (event.reportCount || 0) * 0.15
  return Math.round((urgency * 50 + popularity * 50 - penalty * 10) * 1000) / 1000
}

function publishEventNotification(creatorId, event) {
  publishStoryEvent(creatorId, event).catch(() => {})
}

// ========== MAIN HANDLER ==========
export async function handleEvents(path, method, request, db) {

  // ========================
  // POST /events — Create event
  // ========================
  if (path[0] === 'events' && path.length === 1 && method === 'POST') {
    const user = await requireAuth(request, db)

    // Rate limit
    const oneHourAgo = new Date(Date.now() - 3_600_000)
    const recentCount = await db.collection('events').countDocuments({
      creatorId: user.id, createdAt: { $gte: oneHourAgo },
    })
    if (recentCount >= EVENT_CREATE_RATE_LIMIT) {
      return { error: `Rate limit: max ${EVENT_CREATE_RATE_LIMIT} events per hour`, code: ErrorCode.RATE_LIMITED, status: 429 }
    }

    const body = await request.json()
    const {
      title, description, category = 'OTHER', visibility = 'PUBLIC',
      startAt, endAt, locationText, locationUrl,
      organizerText, capacity, isDraft = false,
      coverImageUrl, tags,
    } = body

    if (!title || !startAt) {
      return { error: 'title and startAt are required', code: ErrorCode.VALIDATION, status: 400 }
    }
    if (title.length > EVENT_TITLE_MAX) {
      return { error: `Title max ${EVENT_TITLE_MAX} chars`, code: ErrorCode.VALIDATION, status: 400 }
    }
    if (description && description.length > EVENT_DESC_MAX) {
      return { error: `Description max ${EVENT_DESC_MAX} chars`, code: ErrorCode.VALIDATION, status: 400 }
    }
    if (!ALLOWED_CATEGORIES.includes(category)) {
      return { error: `Category must be: ${ALLOWED_CATEGORIES.join(', ')}`, code: ErrorCode.VALIDATION, status: 400 }
    }
    if (!ALLOWED_VISIBILITIES.includes(visibility)) {
      return { error: `Visibility must be: ${ALLOWED_VISIBILITIES.join(', ')}`, code: ErrorCode.VALIDATION, status: 400 }
    }
    const startDate = new Date(startAt)
    if (isNaN(startDate.getTime())) {
      return { error: 'Invalid startAt date', code: ErrorCode.VALIDATION, status: 400 }
    }
    if (endAt) {
      const endDate = new Date(endAt)
      if (isNaN(endDate.getTime()) || endDate <= startDate) {
        return { error: 'endAt must be after startAt', code: ErrorCode.VALIDATION, status: 400 }
      }
    }
    if (capacity !== undefined && capacity !== null && (capacity < 1 || capacity > 100000)) {
      return { error: 'Capacity must be 1-100000', code: ErrorCode.VALIDATION, status: 400 }
    }

    const now = new Date()
    const event = {
      id: uuidv4(),
      creatorId: user.id,
      collegeId: user.collegeId || null,
      title: title.trim().slice(0, EVENT_TITLE_MAX),
      description: (description || '').trim().slice(0, EVENT_DESC_MAX) || null,
      category,
      visibility,
      startAt: startDate,
      endAt: endAt ? new Date(endAt) : null,
      locationText: (locationText || '').trim().slice(0, EVENT_LOCATION_MAX) || null,
      locationUrl: locationUrl || null,
      organizerText: (organizerText || '').trim().slice(0, EVENT_LOCATION_MAX) || null,
      coverImageUrl: coverImageUrl || null,
      tags: (tags || []).map(t => t.toLowerCase().trim()).slice(0, 10),
      capacity: capacity || null,
      status: isDraft ? 'DRAFT' : 'PUBLISHED',
      goingCount: 0,
      interestedCount: 0,
      waitlistCount: 0,
      reportCount: 0,
      reminderCount: 0,
      score: 0,
      createdAt: now,
      updatedAt: now,
      publishedAt: isDraft ? null : now,
      cancelledAt: null,
      archivedAt: null,
      heldAt: null,
      removedAt: null,
    }

    if (!isDraft) event.score = computeEventScore(event)

    await db.collection('events').insertOne(event)
    await writeAudit(db, 'EVENT_CREATED', user.id, 'EVENT', event.id, { category, visibility, isDraft })

    return { data: { event: sanitizeEvent(event) }, status: 201 }
  }

  // ========================
  // GET /events/feed — Discovery feed (upcoming, score-ranked)
  // ========================
  if (path[0] === 'events' && path[1] === 'feed' && path.length === 2 && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || EVENT_FEED_LIMIT), 50)
    const cursor = url.searchParams.get('cursor')
    const category = url.searchParams.get('category')

    const query = {
      status: 'PUBLISHED',
      visibility: { $in: ['PUBLIC', 'COLLEGE'] },
      startAt: { $gte: new Date() }, // upcoming only
    }
    if (cursor) query.score = { $lt: parseFloat(cursor) }
    if (category && ALLOWED_CATEGORIES.includes(category)) query.category = category

    // Exclude blocked users
    const allBlocks = await db.collection('blocks').find({
      $or: [{ blockerId: user.id }, { blockedId: user.id }],
    }).toArray()
    const blockedIds = new Set(allBlocks.map(b => b.blockerId === user.id ? b.blockedId : b.blockerId))
    if (blockedIds.size > 0) query.creatorId = { $nin: [...blockedIds] }

    // College visibility: if COLLEGE, only show if same college
    const events = await db.collection('events')
      .find(query)
      .sort({ score: -1, startAt: 1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = events.length > limit
    let items = sanitizeEvents(events.slice(0, limit))

    // Filter COLLEGE visibility for non-same-college users
    items = items.filter(e => e.visibility === 'PUBLIC' || e.collegeId === user.collegeId)

    // Batch: creator info + viewer RSVP
    const creatorIds = [...new Set(items.map(e => e.creatorId))]
    const creators = creatorIds.length > 0
      ? await db.collection('users').find({ id: { $in: creatorIds } }).toArray()
      : []
    const creatorMap = Object.fromEntries(creators.map(u => [u.id, sanitizeUser(u)]))

    const eventIds = items.map(e => e.id)
    const myRsvps = eventIds.length > 0
      ? await db.collection('event_rsvps').find({ eventId: { $in: eventIds }, userId: user.id }).toArray()
      : []
    const rsvpMap = Object.fromEntries(myRsvps.map(r => [r.eventId, r.status]))

    const enriched = items.map(e => ({
      ...e,
      creator: creatorMap[e.creatorId] || null,
      myRsvp: rsvpMap[e.id] || null,
      viewerRsvp: rsvpMap[e.id] || null,
    }))

    return {
      data: {
        items: enriched,
        pagination: {
          nextCursor: hasMore ? items[items.length - 1]?.score?.toString() : null,
          hasMore,
        },
        nextCursor: hasMore ? items[items.length - 1]?.score?.toString() : null,
      },
    }
  }

  // ========================
  // GET /events/search — Search events
  // ========================
  if (path[0] === 'events' && path[1] === 'search' && path.length === 2 && method === 'GET') {
    const viewer = await authenticate(request, db)
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
    const cursor = url.searchParams.get('cursor')
    const q = url.searchParams.get('q')
    const collegeId = url.searchParams.get('collegeId')
    const category = url.searchParams.get('category')
    const upcoming = url.searchParams.get('upcoming') !== 'false'

    const query = { status: 'PUBLISHED' }
    if (collegeId) query.collegeId = collegeId
    if (category && ALLOWED_CATEGORIES.includes(category)) query.category = category
    if (upcoming) query.startAt = { $gte: new Date() }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }
    if (q) {
      query.$or = [
        { title: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
        { tags: { $in: [q.toLowerCase()] } },
      ]
    }

    const events = await db.collection('events')
      .find(query)
      .sort({ startAt: 1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = events.length > limit
    const items = sanitizeEvents(events.slice(0, limit))

    const creatorIds = [...new Set(items.map(e => e.creatorId))]
    const creators = creatorIds.length > 0
      ? await db.collection('users').find({ id: { $in: creatorIds } }).toArray()
      : []
    const creatorMap = Object.fromEntries(creators.map(u => [u.id, sanitizeUser(u)]))

    const enriched = items.map(e => ({ ...e, creator: creatorMap[e.creatorId] || null }))

    return {
      data: {
        items: enriched,
        pagination: {
          nextCursor: hasMore ? items[items.length - 1]?.createdAt?.toISOString() : null,
          hasMore,
        },
        nextCursor: hasMore ? items[items.length - 1]?.createdAt?.toISOString() : null,
      },
    }
  }

  // ========================
  // GET /events/college/:collegeId — College-scoped events
  // ========================
  if (path[0] === 'events' && path[1] === 'college' && path.length === 3 && method === 'GET') {
    const collegeId = path[2]
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
    const cursor = url.searchParams.get('cursor')
    const category = url.searchParams.get('category')

    const query = { collegeId, status: 'PUBLISHED', startAt: { $gte: new Date() } }
    if (category && ALLOWED_CATEGORIES.includes(category)) query.category = category
    if (cursor) query.startAt = { ...query.startAt, $gt: new Date(cursor) }

    const events = await db.collection('events')
      .find(query)
      .sort({ startAt: 1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = events.length > limit
    const items = sanitizeEvents(events.slice(0, limit))

    return {
      data: {
        items,
        pagination: {
          nextCursor: hasMore ? items[items.length - 1]?.startAt?.toISOString() : null,
          hasMore,
        },
        nextCursor: hasMore ? items[items.length - 1]?.startAt?.toISOString() : null,
      },
    }
  }

  // ========================
  // GET /events/:id — Event detail
  // ========================
  if (path[0] === 'events' && path.length === 2 && method === 'GET' && !['feed', 'search', 'college'].includes(path[1])) {
    const viewer = await authenticate(request, db)
    const eventId = path[1]

    const event = await db.collection('events').findOne({ id: eventId })
    if (!event) return { error: 'Event not found', code: ErrorCode.NOT_FOUND, status: 404 }

    if (event.status === 'REMOVED') {
      return { error: 'This event has been removed', code: ErrorCode.GONE, status: 410 }
    }

    const isOwner = viewer?.id === event.creatorId
    const isAdminUser = viewer && isAdmin(viewer)

    if (['HELD'].includes(event.status) && !isOwner && !isAdminUser) {
      return { error: 'Event not available', code: ErrorCode.FORBIDDEN, status: 403 }
    }
    if (event.status === 'DRAFT' && !isOwner) {
      return { error: 'Event not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    // Block check
    if (viewer && !isOwner && await isBlocked(db, viewer.id, event.creatorId)) {
      return { error: 'Event not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    const creator = await db.collection('users').findOne({ id: event.creatorId })

    let result = { ...sanitizeEvent(event), creator: creator ? sanitizeUser(creator) : null }

    // Viewer RSVP
    if (viewer) {
      const rsvp = await db.collection('event_rsvps').findOne({ eventId, userId: viewer.id })
      result.myRsvp = rsvp ? rsvp.status : null
      result.viewerRsvp = result.myRsvp
      const reminder = await db.collection('event_reminders').findOne({ eventId, userId: viewer.id })
      result.myReminder = !!reminder
    }

    // Authenticity tags
    const tags = await db.collection('authenticity_tags')
      .find({ targetType: 'EVENT', targetId: eventId }, { projection: { _id: 0 } })
      .toArray()
    result.authenticityTags = tags

    return { data: { event: result } }
  }

  // ========================
  // PATCH /events/:id — Edit event
  // ========================
  if (path[0] === 'events' && path.length === 2 && method === 'PATCH' && !['feed', 'search', 'college'].includes(path[1])) {
    const user = await requireAuth(request, db)
    const eventId = path[1]

    const event = await db.collection('events').findOne({ id: eventId })
    if (!event) return { error: 'Event not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (event.creatorId !== user.id && !isAdmin(user)) {
      return { error: 'Not authorized', code: ErrorCode.FORBIDDEN, status: 403 }
    }
    if (['REMOVED', 'CANCELLED'].includes(event.status)) {
      return { error: `Cannot edit event with status ${event.status}`, code: ErrorCode.INVALID_STATE, status: 400 }
    }

    const body = await request.json()
    const updates = { updatedAt: new Date() }

    if (body.title !== undefined) {
      if (!body.title || body.title.length > EVENT_TITLE_MAX) return { error: `Title required, max ${EVENT_TITLE_MAX}`, code: ErrorCode.VALIDATION, status: 400 }
      updates.title = body.title.trim()
    }
    if (body.description !== undefined) updates.description = (body.description || '').trim().slice(0, EVENT_DESC_MAX) || null
    if (body.category !== undefined) {
      if (!ALLOWED_CATEGORIES.includes(body.category)) return { error: 'Invalid category', code: ErrorCode.VALIDATION, status: 400 }
      updates.category = body.category
    }
    if (body.visibility !== undefined) {
      if (!ALLOWED_VISIBILITIES.includes(body.visibility)) return { error: 'Invalid visibility', code: ErrorCode.VALIDATION, status: 400 }
      updates.visibility = body.visibility
    }
    if (body.startAt !== undefined) updates.startAt = new Date(body.startAt)
    if (body.endAt !== undefined) updates.endAt = body.endAt ? new Date(body.endAt) : null
    if (body.locationText !== undefined) updates.locationText = (body.locationText || '').trim().slice(0, EVENT_LOCATION_MAX) || null
    if (body.locationUrl !== undefined) updates.locationUrl = body.locationUrl || null
    if (body.organizerText !== undefined) updates.organizerText = (body.organizerText || '').trim().slice(0, EVENT_LOCATION_MAX) || null
    if (body.coverImageUrl !== undefined) updates.coverImageUrl = body.coverImageUrl || null
    if (body.capacity !== undefined) updates.capacity = body.capacity || null
    if (body.tags !== undefined) updates.tags = (body.tags || []).map(t => t.toLowerCase().trim()).slice(0, 10)

    // Recompute score if start time changed
    if (updates.startAt) {
      updates.score = computeEventScore({ ...event, ...updates })
    }

    await db.collection('events').updateOne({ id: eventId }, { $set: updates })
    const updated = await db.collection('events').findOne({ id: eventId })
    await writeAudit(db, 'EVENT_EDITED', user.id, 'EVENT', eventId, { fields: Object.keys(updates) })

    return { data: { event: sanitizeEvent(updated) } }
  }

  // ========================
  // DELETE /events/:id — Soft delete
  // ========================
  if (path[0] === 'events' && path.length === 2 && method === 'DELETE' && !['feed', 'search', 'college'].includes(path[1])) {
    const user = await requireAuth(request, db)
    const eventId = path[1]

    const event = await db.collection('events').findOne({ id: eventId })
    if (!event) return { error: 'Event not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (event.creatorId !== user.id && !isAdmin(user)) {
      return { error: 'Not authorized', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    await db.collection('events').updateOne(
      { id: eventId },
      { $set: { status: 'REMOVED', removedAt: new Date(), updatedAt: new Date() } }
    )
    await writeAudit(db, 'EVENT_DELETED', user.id, 'EVENT', eventId, { previousStatus: event.status })

    return { data: { message: 'Event removed', eventId } }
  }

  // ========================
  // POST /events/:id/publish — Publish draft
  // ========================
  if (path[0] === 'events' && path.length === 3 && path[2] === 'publish' && method === 'POST') {
    const user = await requireAuth(request, db)
    const eventId = path[1]

    const event = await db.collection('events').findOne({ id: eventId })
    if (!event) return { error: 'Event not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (event.creatorId !== user.id) return { error: 'Not authorized', code: ErrorCode.FORBIDDEN, status: 403 }
    if (event.status !== 'DRAFT') return { error: `Cannot publish event with status ${event.status}`, code: ErrorCode.INVALID_STATE, status: 400 }

    const now = new Date()
    const score = computeEventScore({ ...event, publishedAt: now })
    await db.collection('events').updateOne({ id: eventId }, {
      $set: { status: 'PUBLISHED', publishedAt: now, score, updatedAt: now },
    })

    await writeAudit(db, 'EVENT_PUBLISHED', user.id, 'EVENT', eventId, {})
    return { data: { message: 'Event published', eventId, status: 'PUBLISHED' } }
  }

  // ========================
  // POST /events/:id/cancel — Cancel event
  // ========================
  if (path[0] === 'events' && path.length === 3 && path[2] === 'cancel' && method === 'POST') {
    const user = await requireAuth(request, db)
    const eventId = path[1]

    const event = await db.collection('events').findOne({ id: eventId })
    if (!event) return { error: 'Event not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (event.creatorId !== user.id && !isAdmin(user)) return { error: 'Not authorized', code: ErrorCode.FORBIDDEN, status: 403 }
    if (!['PUBLISHED', 'DRAFT'].includes(event.status)) {
      return { error: `Cannot cancel event with status ${event.status}`, code: ErrorCode.INVALID_STATE, status: 400 }
    }

    const body = await request.json().catch(() => ({}))
    await db.collection('events').updateOne({ id: eventId }, {
      $set: { status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date(), cancellationReason: body.reason || null },
    })

    await writeAudit(db, 'EVENT_CANCELLED', user.id, 'EVENT', eventId, { reason: body.reason })
    return { data: { message: 'Event cancelled', eventId } }
  }

  // ========================
  // POST /events/:id/archive — Archive past event
  // ========================
  if (path[0] === 'events' && path.length === 3 && path[2] === 'archive' && method === 'POST') {
    const user = await requireAuth(request, db)
    const eventId = path[1]

    const event = await db.collection('events').findOne({ id: eventId })
    if (!event) return { error: 'Event not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (event.creatorId !== user.id && !isAdmin(user)) return { error: 'Not authorized', code: ErrorCode.FORBIDDEN, status: 403 }
    if (!['PUBLISHED', 'CANCELLED'].includes(event.status)) {
      return { error: `Cannot archive event with status ${event.status}`, code: ErrorCode.INVALID_STATE, status: 400 }
    }

    await db.collection('events').updateOne({ id: eventId }, {
      $set: { status: 'ARCHIVED', archivedAt: new Date(), updatedAt: new Date() },
    })
    await writeAudit(db, 'EVENT_ARCHIVED', user.id, 'EVENT', eventId, {})
    return { data: { message: 'Event archived', eventId } }
  }

  // ========================
  // POST /events/:id/rsvp — RSVP to event
  // ========================
  if (path[0] === 'events' && path.length === 3 && path[2] === 'rsvp' && method === 'POST') {
    const user = await requireAuth(request, db)
    const eventId = path[1]

    const event = await db.collection('events').findOne({ id: eventId, status: 'PUBLISHED' })
    if (!event) return { error: 'Event not found or not published', code: ErrorCode.NOT_FOUND, status: 404 }

    // Block check
    if (await isBlocked(db, user.id, event.creatorId)) {
      return { error: 'Action not allowed', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const body = await request.json()
    const { status } = body
    if (!status || !ALLOWED_RSVP.includes(status)) {
      return { error: `status must be: ${ALLOWED_RSVP.join(', ')}`, code: ErrorCode.VALIDATION, status: 400 }
    }

    // Check capacity for GOING
    if (status === 'GOING' && event.capacity) {
      const goingCount = await db.collection('event_rsvps').countDocuments({ eventId, status: 'GOING' })
      if (goingCount >= event.capacity) {
        // Auto-waitlist
        const result = await db.collection('event_rsvps').updateOne(
          { eventId, userId: user.id },
          { $setOnInsert: { id: uuidv4(), eventId, userId: user.id, creatorId: event.creatorId, status: 'WAITLISTED', createdAt: new Date(), updatedAt: new Date() } },
          { upsert: true }
        )
        if (result.upsertedCount > 0) {
          const wlCount = await db.collection('event_rsvps').countDocuments({ eventId, status: 'WAITLISTED' })
          await db.collection('events').updateOne({ id: eventId }, { $set: { waitlistCount: wlCount, updatedAt: new Date() } })
        }
        return { data: { rsvp: { eventId, status: 'WAITLISTED', message: 'Event at capacity, added to waitlist' } } }
      }
    }

    // Upsert RSVP
    const existing = await db.collection('event_rsvps').findOne({ eventId, userId: user.id })
    if (existing) {
      const oldStatus = existing.status
      if (oldStatus === status) return { data: { rsvp: { eventId, userId: user.id, status } } }
      await db.collection('event_rsvps').updateOne(
        { eventId, userId: user.id },
        { $set: { status, updatedAt: new Date() } }
      )
    } else {
      await db.collection('event_rsvps').insertOne({
        id: uuidv4(), eventId, userId: user.id, creatorId: event.creatorId,
        status, createdAt: new Date(), updatedAt: new Date(),
      })
    }

    // Recompute counts from source
    const [goingCount, interestedCount, waitlistCount] = await Promise.all([
      db.collection('event_rsvps').countDocuments({ eventId, status: 'GOING' }),
      db.collection('event_rsvps').countDocuments({ eventId, status: 'INTERESTED' }),
      db.collection('event_rsvps').countDocuments({ eventId, status: 'WAITLISTED' }),
    ])
    await db.collection('events').updateOne({ id: eventId }, {
      $set: { goingCount, interestedCount, waitlistCount, updatedAt: new Date() },
    })

    return { data: { rsvp: { eventId, userId: user.id, status, goingCount, interestedCount } } }
  }

  // ========================
  // DELETE /events/:id/rsvp — Cancel RSVP
  // ========================
  if (path[0] === 'events' && path.length === 3 && path[2] === 'rsvp' && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const eventId = path[1]

    const existing = await db.collection('event_rsvps').findOne({ eventId, userId: user.id })
    if (!existing) return { error: 'No RSVP found', code: ErrorCode.NOT_FOUND, status: 404 }

    await db.collection('event_rsvps').deleteOne({ eventId, userId: user.id })

    // Recompute counts
    const [goingCount, interestedCount, waitlistCount] = await Promise.all([
      db.collection('event_rsvps').countDocuments({ eventId, status: 'GOING' }),
      db.collection('event_rsvps').countDocuments({ eventId, status: 'INTERESTED' }),
      db.collection('event_rsvps').countDocuments({ eventId, status: 'WAITLISTED' }),
    ])
    await db.collection('events').updateOne({ id: eventId }, {
      $set: { goingCount, interestedCount, waitlistCount, updatedAt: new Date() },
    })

    // Promote from waitlist if capacity freed
    const event = await db.collection('events').findOne({ id: eventId })
    if (event?.capacity && existing.status === 'GOING' && waitlistCount > 0) {
      const nextInLine = await db.collection('event_rsvps').findOne({ eventId, status: 'WAITLISTED' }, { sort: { createdAt: 1 } })
      if (nextInLine && goingCount < event.capacity) {
        await db.collection('event_rsvps').updateOne({ _id: nextInLine._id }, { $set: { status: 'GOING', updatedAt: new Date() } })
        const newGoing = await db.collection('event_rsvps').countDocuments({ eventId, status: 'GOING' })
        const newWaitlist = await db.collection('event_rsvps').countDocuments({ eventId, status: 'WAITLISTED' })
        await db.collection('events').updateOne({ id: eventId }, { $set: { goingCount: newGoing, waitlistCount: newWaitlist } })
      }
    }

    return { data: { message: 'RSVP cancelled', eventId } }
  }

  // ========================
  // GET /events/:id/attendees — RSVP list
  // ========================
  if (path[0] === 'events' && path.length === 3 && path[2] === 'attendees' && method === 'GET') {
    const viewer = await authenticate(request, db)
    const eventId = path[1]
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100)
    const offset = parseInt(url.searchParams.get('offset') || '0')
    const statusFilter = url.searchParams.get('status')

    const event = await db.collection('events').findOne({ id: eventId })
    if (!event || event.status === 'REMOVED') return { error: 'Event not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const query = { eventId }
    if (statusFilter && ALLOWED_RSVP.includes(statusFilter)) query.status = statusFilter

    const [rsvps, total] = await Promise.all([
      db.collection('event_rsvps').find(query).sort({ createdAt: -1 }).skip(offset).limit(limit).toArray(),
      db.collection('event_rsvps').countDocuments(query),
    ])

    const userIds = rsvps.map(r => r.userId)
    const users = userIds.length > 0
      ? await db.collection('users').find({ id: { $in: userIds } }).toArray()
      : []

    // Filter blocked users
    let userMap = Object.fromEntries(users.map(u => [u.id, sanitizeUser(u)]))
    if (viewer) {
      const blockedSet = await batchBlockCheck(db, viewer.id, userIds)
      userMap = Object.fromEntries(users.filter(u => !blockedSet.has(u.id)).map(u => [u.id, sanitizeUser(u)]))
    }

    const items = rsvps
      .filter(r => userMap[r.userId])
      .map(r => ({ userId: r.userId, status: r.status, createdAt: r.createdAt, user: userMap[r.userId] }))

    return { data: { items, pagination: { total, offset: skip, limit, hasMore: skip + items.length < total }, total, eventId } }
  }

  // ========================
  // POST /events/:id/report — Report event
  // ========================
  if (path[0] === 'events' && path.length === 3 && path[2] === 'report' && method === 'POST') {
    const user = await requireAuth(request, db)
    const eventId = path[1]

    const event = await db.collection('events').findOne({ id: eventId })
    if (!event) return { error: 'Event not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (user.id === event.creatorId) return { error: 'Cannot report own event', code: ErrorCode.SELF_ACTION, status: 400 }

    const body = await request.json()
    const { reasonCode, reason } = body
    if (!reasonCode) return { error: 'reasonCode required', code: ErrorCode.VALIDATION, status: 400 }

    // Dedup
    const existing = await db.collection('event_reports').findOne({ eventId, reporterId: user.id })
    if (existing) return { error: 'Already reported', code: ErrorCode.DUPLICATE, status: 409 }

    await db.collection('event_reports').insertOne({
      id: uuidv4(), eventId, reporterId: user.id, creatorId: event.creatorId,
      reasonCode, reason: reason?.trim() || null, createdAt: new Date(),
    })

    const reportCount = await db.collection('event_reports').countDocuments({ eventId })
    const updates = { reportCount, updatedAt: new Date() }
    if (reportCount >= EVENT_REPORT_AUTO_HOLD && event.status === 'PUBLISHED') {
      updates.status = 'HELD'
      updates.heldAt = new Date()
    }
    await db.collection('events').updateOne({ id: eventId }, { $set: updates })

    await writeAudit(db, 'EVENT_REPORTED', user.id, 'EVENT', eventId, { reasonCode, reportCount })
    return { data: { reportCount }, status: 201 }
  }

  // ========================
  // POST /events/:id/remind — Set reminder
  // ========================
  if (path[0] === 'events' && path.length === 3 && path[2] === 'remind' && method === 'POST') {
    const user = await requireAuth(request, db)
    const eventId = path[1]

    const event = await db.collection('events').findOne({ id: eventId, status: 'PUBLISHED' })
    if (!event) return { error: 'Event not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const result = await db.collection('event_reminders').updateOne(
      { eventId, userId: user.id },
      { $setOnInsert: { id: uuidv4(), eventId, userId: user.id, remindAt: new Date(event.startAt.getTime() - 3_600_000), createdAt: new Date() } },
      { upsert: true }
    )

    if (result.upsertedCount > 0) {
      const reminderCount = await db.collection('event_reminders').countDocuments({ eventId })
      await db.collection('events').updateOne({ id: eventId }, { $set: { reminderCount, updatedAt: new Date() } })
    }

    return { data: { message: 'Reminder set', eventId } }
  }

  // ========================
  // DELETE /events/:id/remind — Remove reminder
  // ========================
  if (path[0] === 'events' && path.length === 3 && path[2] === 'remind' && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const eventId = path[1]

    const result = await db.collection('event_reminders').deleteOne({ eventId, userId: user.id })
    if (result.deletedCount > 0) {
      const reminderCount = await db.collection('event_reminders').countDocuments({ eventId })
      await db.collection('events').updateOne({ id: eventId }, { $set: { reminderCount, updatedAt: new Date() } })
    }

    return { data: { message: 'Reminder removed', eventId } }
  }

  // ========================
  // GET /me/events — My created events
  // ========================
  if (path[0] === 'me' && path[1] === 'events' && path.length === 2 && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
    const cursor = url.searchParams.get('cursor')

    const query = { creatorId: user.id }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }

    const events = await db.collection('events')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = events.length > limit
    const items = sanitizeEvents(events.slice(0, limit))

    return {
      data: { items, pagination: { nextCursor: hasMore ? items[items.length - 1]?.createdAt?.toISOString() : null, hasMore }, nextCursor: hasMore ? items[items.length - 1]?.createdAt?.toISOString() : null },
    }
  }

  // ========================
  // GET /me/events/rsvps — Events I've RSVP'd to
  // ========================
  if (path[0] === 'me' && path[1] === 'events' && path[2] === 'rsvps' && path.length === 3 && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)

    const rsvps = await db.collection('event_rsvps')
      .find({ userId: user.id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray()

    const eventIds = rsvps.map(r => r.eventId)
    const events = eventIds.length > 0
      ? await db.collection('events').find({ id: { $in: eventIds } }).toArray()
      : []
    const eventMap = Object.fromEntries(events.map(e => [e.id, sanitizeEvent(e)]))

    const items = rsvps.map(r => ({
      eventId: r.eventId,
      rsvpStatus: r.status,
      rsvpAt: r.createdAt,
      event: eventMap[r.eventId] || null,
    })).filter(r => r.event)

    return { data: { items, count: items.length } }
  }

  // ========================
  // ADMIN ROUTES
  // ========================

  // GET /admin/events — Admin moderation queue
  if (path[0] === 'admin' && path[1] === 'events' && path.length === 2 && method === 'GET') {
    const user = await requireAuth(request, db)
    requireRole(user, 'MODERATOR', 'ADMIN', 'SUPER_ADMIN')

    const url = new URL(request.url)
    const statusFilter = url.searchParams.get('status')
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100)
    const offset = parseInt(url.searchParams.get('offset') || '0')

    const query = {}
    if (statusFilter) query.status = statusFilter

    const [items, total, stats] = await Promise.all([
      db.collection('events').find(query).sort({ createdAt: -1 }).skip(offset).limit(limit).toArray(),
      db.collection('events').countDocuments(query),
      Promise.all([
        db.collection('events').countDocuments({ status: 'PUBLISHED' }),
        db.collection('events').countDocuments({ status: 'HELD' }),
        db.collection('events').countDocuments({ status: 'REMOVED' }),
        db.collection('events').countDocuments({ status: 'CANCELLED' }),
        db.collection('events').countDocuments({ status: 'DRAFT' }),
      ]),
    ])

    return {
      data: {
        items: sanitizeEvents(items),
        pagination: { total, offset: skip, limit, hasMore: skip + items.length < total },
        total,
        stats: { PUBLISHED: stats[0], HELD: stats[1], REMOVED: stats[2], CANCELLED: stats[3], DRAFT: stats[4] },
      },
    }
  }

  // PATCH /admin/events/:id/moderate — Moderate event
  if (path[0] === 'admin' && path[1] === 'events' && path.length === 4 && path[3] === 'moderate' && method === 'PATCH') {
    const user = await requireAuth(request, db)
    requireRole(user, 'MODERATOR', 'ADMIN', 'SUPER_ADMIN')

    const eventId = path[2]
    const event = await db.collection('events').findOne({ id: eventId })
    if (!event) return { error: 'Event not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const body = await request.json()
    const { action, reason } = body
    if (!['APPROVE', 'HOLD', 'REMOVE', 'RESTORE'].includes(action)) {
      return { error: 'action must be APPROVE, HOLD, REMOVE, or RESTORE', code: ErrorCode.VALIDATION, status: 400 }
    }

    const now = new Date()
    const updates = { updatedAt: now, moderatedBy: user.id, moderatedAt: now, moderationReason: reason || null }

    switch (action) {
      case 'APPROVE': updates.status = 'PUBLISHED'; updates.heldAt = null; if (!event.publishedAt) updates.publishedAt = now; break
      case 'HOLD': updates.status = 'HELD'; updates.heldAt = now; break
      case 'REMOVE': updates.status = 'REMOVED'; updates.removedAt = now; break
      case 'RESTORE': updates.status = 'PUBLISHED'; updates.removedAt = null; updates.heldAt = null; break
    }

    await db.collection('events').updateOne({ id: eventId }, { $set: updates })
    await writeAudit(db, 'EVENT_MODERATED', user.id, 'EVENT', eventId, { action, previousStatus: event.status, newStatus: updates.status })

    return { data: { message: `Event ${action.toLowerCase()}d`, eventId, status: updates.status } }
  }

  // GET /admin/events/analytics — Platform analytics
  if (path[0] === 'admin' && path[1] === 'events' && path[2] === 'analytics' && path.length === 3 && method === 'GET') {
    const user = await requireAuth(request, db)
    requireRole(user, 'ADMIN', 'SUPER_ADMIN')

    const [total, published, held, removed, cancelled, drafts, totalRsvps, totalReports] = await Promise.all([
      db.collection('events').countDocuments({}),
      db.collection('events').countDocuments({ status: 'PUBLISHED' }),
      db.collection('events').countDocuments({ status: 'HELD' }),
      db.collection('events').countDocuments({ status: 'REMOVED' }),
      db.collection('events').countDocuments({ status: 'CANCELLED' }),
      db.collection('events').countDocuments({ status: 'DRAFT' }),
      db.collection('event_rsvps').countDocuments({}),
      db.collection('event_reports').countDocuments({}),
    ])

    // Category breakdown
    const categories = {}
    for (const cat of ALLOWED_CATEGORIES) {
      categories[cat] = await db.collection('events').countDocuments({ category: cat, status: 'PUBLISHED' })
    }

    return {
      data: { total, published, held, removed, cancelled, drafts, totalRsvps, totalReports, categories },
    }
  }

  // POST /admin/events/:id/recompute-counters — Recompute counters
  if (path[0] === 'admin' && path[1] === 'events' && path.length === 4 && path[3] === 'recompute-counters' && method === 'POST') {
    const user = await requireAuth(request, db)
    requireRole(user, 'ADMIN', 'SUPER_ADMIN')

    const eventId = path[2]
    const event = await db.collection('events').findOne({ id: eventId })
    if (!event) return { error: 'Event not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const before = {
      goingCount: event.goingCount, interestedCount: event.interestedCount,
      waitlistCount: event.waitlistCount, reportCount: event.reportCount, reminderCount: event.reminderCount,
    }

    const [goingCount, interestedCount, waitlistCount, reportCount, reminderCount] = await Promise.all([
      db.collection('event_rsvps').countDocuments({ eventId, status: 'GOING' }),
      db.collection('event_rsvps').countDocuments({ eventId, status: 'INTERESTED' }),
      db.collection('event_rsvps').countDocuments({ eventId, status: 'WAITLISTED' }),
      db.collection('event_reports').countDocuments({ eventId }),
      db.collection('event_reminders').countDocuments({ eventId }),
    ])

    const after = { goingCount, interestedCount, waitlistCount, reportCount, reminderCount }
    await db.collection('events').updateOne({ id: eventId }, { $set: { ...after, updatedAt: new Date() } })
    await writeAudit(db, 'EVENT_COUNTERS_RECOMPUTED', user.id, 'EVENT', eventId, { before, after })

    return { data: { eventId, before, after, drifted: JSON.stringify(before) !== JSON.stringify(after) } }
  }

  return null
}
