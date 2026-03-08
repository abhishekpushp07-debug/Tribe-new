import { v4 as uuidv4 } from 'uuid'
import { requireAuth, authenticate, sanitizeUser, writeAudit, parsePagination } from '../auth-utils.js'
import { ErrorCode, ReportStatus, AppealStatus, ModerationAction, Visibility } from '../constants.js'
import { cache, CacheNS, CacheTTL } from '../cache.js'

export async function handleAdmin(path, method, request, db) {
  const route = path.join('/')

  // ========================
  // POST /reports
  // ========================
  if (route === 'reports' && method === 'POST') {
    const user = await requireAuth(request, db)
    const body = await request.json()
    const { targetType, targetId, reasonCode, details } = body

    if (!targetType || !targetId || !reasonCode) {
      return { error: 'targetType, targetId, and reasonCode are required', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Check for duplicate report
    const duplicate = await db.collection('reports').findOne({
      reporterId: user.id,
      targetId,
      status: { $in: [ReportStatus.OPEN, ReportStatus.REVIEWING] },
    })
    if (duplicate) {
      return { error: 'You have already reported this', code: ErrorCode.CONFLICT, status: 409 }
    }

    const report = {
      id: uuidv4(),
      reporterId: user.id,
      targetType,
      targetId,
      reasonCode,
      details: details?.slice(0, 500) || '',
      status: ReportStatus.OPEN,
      assignedTo: null,
      resolution: null,
      resolvedAt: null,
      createdAt: new Date(),
    }

    await db.collection('reports').insertOne(report)
    await writeAudit(db, 'REPORT_CREATED', user.id, targetType, targetId, { reasonCode })

    // Auto-hold content with 3+ reports
    if (targetType === 'CONTENT') {
      const reportCount = await db.collection('reports').countDocuments({
        targetId,
        status: { $in: [ReportStatus.OPEN, ReportStatus.REVIEWING] },
      })
      if (reportCount >= 3) {
        await db.collection('content_items').updateOne(
          { id: targetId, visibility: Visibility.PUBLIC },
          { $set: { visibility: Visibility.HELD_FOR_REVIEW, updatedAt: new Date() } }
        )
      }
    }

    const { _id, ...clean } = report
    return { data: { report: clean }, status: 201 }
  }

  // ========================
  // GET /moderation/queue
  // ========================
  if (route === 'moderation/queue' && method === 'GET') {
    const user = await requireAuth(request, db)
    if (!['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { error: 'Moderator access required', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const url = new URL(request.url)
    const bucket = url.searchParams.get('bucket') || 'held'
    const { limit, offset } = parsePagination(url)

    let query = {}
    if (bucket === 'held') {
      query = { visibility: Visibility.HELD_FOR_REVIEW }
    } else if (bucket === 'reports') {
      const openReports = await db.collection('reports')
        .find({ status: ReportStatus.OPEN })
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .toArray()
      return { data: { items: openReports.map(r => { const { _id, ...rest } = r; return rest }), bucket } }
    } else if (bucket === 'appeals') {
      const appeals = await db.collection('appeals')
        .find({ status: AppealStatus.PENDING })
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .toArray()
      return { data: { items: appeals.map(a => { const { _id, ...rest } = a; return rest }), bucket } }
    }

    const items = await db.collection('content_items')
      .find(query)
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .toArray()

    return {
      data: {
        items: items.map(i => { const { _id, dislikeCountInternal, ...rest } = i; return { ...rest, dislikeCountInternal } }),
        bucket,
      },
    }
  }

  // ========================
  // POST /moderation/:contentId/action
  // ========================
  if (path[0] === 'moderation' && path.length === 3 && path[2] === 'action' && method === 'POST') {
    const user = await requireAuth(request, db)
    if (!['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { error: 'Moderator access required', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const contentId = path[1]
    const body = await request.json()
    const { action, reason } = body

    if (!action || !Object.values(ModerationAction).includes(action)) {
      return { error: `Invalid action. Must be one of: ${Object.values(ModerationAction).join(', ')}`, code: ErrorCode.VALIDATION, status: 400 }
    }

    const content = await db.collection('content_items').findOne({ id: contentId })
    if (!content) return { error: 'Content not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const previousVisibility = content.visibility
    let newVisibility = content.visibility

    switch (action) {
      case ModerationAction.APPROVE:
        newVisibility = Visibility.PUBLIC
        break
      case ModerationAction.REMOVE:
        newVisibility = Visibility.REMOVED
        break
      case ModerationAction.SHADOW_LIMIT:
        newVisibility = Visibility.SHADOW_LIMITED
        break
      case ModerationAction.HOLD:
        newVisibility = Visibility.HELD_FOR_REVIEW
        break
    }

    await db.collection('content_items').updateOne(
      { id: contentId },
      { $set: { visibility: newVisibility, updatedAt: new Date() } }
    )

    // Record moderation event (immutable)
    await db.collection('moderation_events').insertOne({
      id: uuidv4(),
      eventType: `MODERATION_${action}`,
      actorId: user.id,
      targetType: 'CONTENT',
      targetId: contentId,
      previousState: previousVisibility,
      newState: newVisibility,
      reason: reason || '',
      createdAt: new Date(),
    })

    // Handle strikes
    if (action === ModerationAction.STRIKE || action === ModerationAction.REMOVE) {
      await db.collection('strikes').insertOne({
        id: uuidv4(),
        userId: content.authorId,
        contentId,
        reason: reason || 'Policy violation',
        severity: action === ModerationAction.STRIKE ? 'MAJOR' : 'MINOR',
        issuedBy: user.id,
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
        createdAt: new Date(),
      })
      await db.collection('users').updateOne({ id: content.authorId }, { $inc: { strikeCount: 1 } })

      // Auto-suspend at 3 strikes
      const author = await db.collection('users').findOne({ id: content.authorId })
      if (author && author.strikeCount >= 3) {
        const suspendUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        await db.collection('users').updateOne({ id: content.authorId }, { $set: { suspendedUntil: suspendUntil } })
        await db.collection('suspensions').insertOne({
          id: uuidv4(),
          userId: content.authorId,
          reason: 'Auto-suspension: 3 strikes',
          startAt: new Date(),
          endAt: suspendUntil,
          issuedBy: user.id,
          createdAt: new Date(),
        })
      }
    }

    // Resolve related reports
    await db.collection('reports').updateMany(
      { targetId: contentId, status: ReportStatus.OPEN },
      { $set: { status: ReportStatus.RESOLVED, resolution: action, resolvedAt: new Date() } }
    )

    await writeAudit(db, `MODERATION_${action}`, user.id, 'CONTENT', contentId, { reason, previousVisibility, newVisibility })

    return { data: { message: `Action ${action} applied`, contentId, newVisibility } }
  }

  // ========================
  // POST /appeals
  // ========================
  if (route === 'appeals' && method === 'POST') {
    const user = await requireAuth(request, db)
    const body = await request.json()
    const { targetType, targetId, reason } = body

    if (!targetType || !targetId || !reason) {
      return { error: 'targetType, targetId, and reason are required', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Check for existing pending appeal
    const existing = await db.collection('appeals').findOne({
      userId: user.id,
      targetId,
      status: { $in: [AppealStatus.PENDING, AppealStatus.REVIEWING] },
    })
    if (existing) {
      return { error: 'Appeal already pending for this item', code: ErrorCode.CONFLICT, status: 409 }
    }

    const appeal = {
      id: uuidv4(),
      userId: user.id,
      targetType,
      targetId,
      reason: reason.slice(0, 1000),
      status: AppealStatus.PENDING,
      decidedBy: null,
      decidedAt: null,
      decision: null,
      createdAt: new Date(),
    }

    await db.collection('appeals').insertOne(appeal)
    await writeAudit(db, 'APPEAL_CREATED', user.id, targetType, targetId)

    const { _id, ...clean } = appeal
    return { data: { appeal: clean }, status: 201 }
  }

  // ========================
  // GET /appeals (user's own)
  // ========================
  if (route === 'appeals' && method === 'GET') {
    const user = await requireAuth(request, db)
    const appeals = await db.collection('appeals')
      .find({ userId: user.id })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray()
    return { data: { appeals: appeals.map(a => { const { _id, ...rest } = a; return rest }) } }
  }

  // ========================
  // GET /notifications
  // ========================
  if (route === 'notifications' && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const { limit, cursor } = parsePagination(url)

    const query = { userId: user.id }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }

    const notifications = await db.collection('notifications')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = notifications.length > limit
    const items = notifications.slice(0, limit)

    // Enrich with actor info
    const actorIds = [...new Set(items.map(n => n.actorId).filter(Boolean))]
    const actors = await db.collection('users').find({ id: { $in: actorIds } }).toArray()
    const actorMap = Object.fromEntries(actors.map(a => {
      const { _id, pinHash, pinSalt, ...safe } = a
      return [a.id, safe]
    }))

    const enriched = items.map(n => {
      const { _id, ...clean } = n
      return { ...clean, actor: actorMap[n.actorId] || null }
    })

    const unreadCount = await db.collection('notifications').countDocuments({ userId: user.id, read: false })

    return {
      data: {
        notifications: enriched,
        unreadCount,
        nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
      },
    }
  }

  // ========================
  // PATCH /notifications/read
  // ========================
  if (route === 'notifications/read' && method === 'PATCH') {
    const user = await requireAuth(request, db)
    const body = await request.json()

    if (body.ids?.length > 0) {
      // Mark specific notifications as read
      await db.collection('notifications').updateMany(
        { id: { $in: body.ids }, userId: user.id },
        { $set: { read: true } }
      )
    } else {
      // Mark all as read
      await db.collection('notifications').updateMany(
        { userId: user.id, read: false },
        { $set: { read: true } }
      )
    }

    return { data: { message: 'Notifications marked as read' } }
  }

  // ========================
  // GET /legal/consent
  // ========================
  if (route === 'legal/consent' && method === 'GET') {
    let notice = await db.collection('consent_notices').findOne({ active: true })
    if (!notice) {
      notice = {
        id: uuidv4(),
        version: '1.0',
        title: 'Tribe Privacy & Data Protection Notice',
        body: 'By using Tribe, you agree to our Terms of Service and Privacy Policy under the Digital Personal Data Protection Act (DPDP), 2023.\n\nWhat we collect: Phone number, display name, age, college affiliation, and content you create.\n\nHow we use it: To provide the Tribe social platform, personalize your experience, and ensure community safety.\n\nYour rights: You can access, correct, or delete your personal data at any time. For users under 18, we apply additional protections including restricted features, no behavioral tracking, and no targeted advertising.\n\nData storage: Your data is stored securely in India and is never sold to third parties.\n\nGrievance officer: For any privacy concerns, use the in-app grievance system. We respond within 72 hours as required by law.',
        active: true,
        createdAt: new Date(),
      }
      await db.collection('consent_notices').insertOne(notice)
    }
    const { _id, ...clean } = notice
    return { data: { notice: clean } }
  }

  // ========================
  // POST /legal/accept
  // ========================
  if (route === 'legal/accept' && method === 'POST') {
    const user = await requireAuth(request, db)
    const body = await request.json()
    const { version } = body

    await db.collection('consent_acceptances').insertOne({
      id: uuidv4(),
      userId: user.id,
      noticeVersion: version || '1.0',
      acceptedAt: new Date(),
      ip: request.headers.get('x-forwarded-for') || 'unknown',
      userAgent: request.headers.get('user-agent') || 'unknown',
    })

    await db.collection('users').updateOne({ id: user.id }, {
      $set: {
        consentVersion: version || '1.0',
        consentAcceptedAt: new Date(),
        onboardingStep: 'DONE',
        updatedAt: new Date(),
      },
    })

    return { data: { accepted: true } }
  }

  // ========================
  // POST /admin/colleges/seed
  // ========================
  if (route === 'admin/colleges/seed' && method === 'POST') {
    const { collegesData } = await import('/app/lib/colleges-data.js')

    const existing = await db.collection('colleges').countDocuments()
    if (existing > 50) {
      return { data: { message: `Already seeded (${existing} colleges)`, count: existing } }
    }

    const seen = new Set()
    const uniqueColleges = collegesData.filter(c => {
      const key = (c.aisheCode || `${c.name}|${c.city}|${c.state}`).toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    const docs = uniqueColleges.map(c => ({
      id: uuidv4(),
      officialName: c.name,
      normalizedName: c.name.toLowerCase(),
      city: c.city,
      state: c.state,
      type: c.type,
      institutionType: c.type,
      aisheCode: c.aisheCode || null,
      verificationStatus: 'SEEDED',
      aliases: [],
      riskFlags: [],
      membersCount: 0,
      contentCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))

    try {
      const result = await db.collection('colleges').insertMany(docs, { ordered: false })
      return { data: { message: 'Colleges seeded', count: result.insertedCount } }
    } catch {
      return { data: { message: 'Colleges seeded (some skipped)', count: docs.length } }
    }
  }

  // ========================
  // GET /admin/stats
  // ========================
  if (route === 'admin/stats' && method === 'GET') {
    const cached = await cache.get(CacheNS.ADMIN_STATS, 'all')
    if (cached) return { data: cached }

    const [users, posts, reels, stories, colleges, houses, openReports, pendingAppeals] = await Promise.all([
      db.collection('users').countDocuments(),
      db.collection('content_items').countDocuments({ kind: 'POST', visibility: 'PUBLIC' }),
      db.collection('content_items').countDocuments({ kind: 'REEL', visibility: 'PUBLIC' }),
      db.collection('content_items').countDocuments({ kind: 'STORY', visibility: 'PUBLIC', expiresAt: { $gt: new Date() } }),
      db.collection('colleges').countDocuments(),
      db.collection('houses').countDocuments(),
      db.collection('reports').countDocuments({ status: 'OPEN' }),
      db.collection('appeals').countDocuments({ status: 'PENDING' }),
    ])
    const result = { users, posts, reels, stories, colleges, houses, openReports, pendingAppeals }
    await cache.set(CacheNS.ADMIN_STATS, 'all', result, CacheTTL.ADMIN_STATS)
    return { data: result }
  }

  // ========================
  // POST /grievances
  // ========================
  if (route === 'grievances' && method === 'POST') {
    const user = await requireAuth(request, db)
    const body = await request.json()
    const { ticketType, subject, description } = body

    if (!ticketType || !subject) {
      return { error: 'ticketType and subject are required', code: ErrorCode.VALIDATION, status: 400 }
    }

    // SLA based on ticket type
    const slaHours = ticketType === 'LEGAL_NOTICE' ? 3 : ticketType === 'GOVERNMENT_ORDER' ? 3 : 72
    const dueAt = new Date(Date.now() + slaHours * 60 * 60 * 1000)

    const ticket = {
      id: uuidv4(),
      userId: user.id,
      ticketType,
      subject: subject.slice(0, 200),
      description: (description || '').slice(0, 2000),
      status: 'OPEN',
      priority: ticketType === 'LEGAL_NOTICE' ? 'CRITICAL' : 'NORMAL',
      slaCategory: ticketType,
      slaHours,
      dueAt,
      assignedTo: null,
      resolvedAt: null,
      createdAt: new Date(),
    }

    await db.collection('grievance_tickets').insertOne(ticket)
    await writeAudit(db, 'GRIEVANCE_CREATED', user.id, 'GRIEVANCE', ticket.id, { ticketType, slaHours })

    const { _id, ...clean } = ticket
    return { data: { grievance: clean, ticket: clean }, status: 201 }
  }

  // ========================
  // GET /grievances (user's own)
  // ========================
  if (route === 'grievances' && method === 'GET') {
    const user = await requireAuth(request, db)
    const tickets = await db.collection('grievance_tickets')
      .find({ userId: user.id })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray()
    const cleaned = tickets.map(t => { const { _id, ...rest } = t; return rest })
    return { data: { grievances: cleaned, tickets: cleaned } }
  }

  return null
}
