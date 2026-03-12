/**
 * Tribe Notifications 2.0 — Handler (Gold-Proof)
 * Endpoints:
 *   GET    /notifications                  — List (with optional grouping)
 *   PATCH  /notifications/read             — Mark read
 *   GET    /notifications/unread-count     — Lightweight unread count
 *   POST   /notifications/register-device  — Register push device token
 *   DELETE /notifications/unregister-device — Deactivate device token
 *   GET    /notifications/preferences      — Get notification preferences
 *   PATCH  /notifications/preferences      — Update notification preferences
 *
 * Gold-proof additions:
 *   - Structured observability via logger (NOTIFICATION category)
 *   - Deleted/blocked actor degradation safety in enrichment
 *   - Target existence check for degradation signal
 */

import { v4 as uuidv4 } from 'uuid'
import { requireAuth, sanitizeUser, parsePagination } from '../auth-utils.js'
import { ErrorCode } from '../constants.js'
import { filterBlockedNotifications } from '../access-policy.js'
import { getUserPreferences, groupNotifications, DEFAULT_PREFERENCES } from '../services/notification-service.js'
import logger from '../logger.js'

const NOTIF_LOG = 'NOTIFICATION'
const VALID_PLATFORMS = ['IOS', 'ANDROID', 'WEB']
const VALID_PREF_KEYS = Object.keys(DEFAULT_PREFERENCES)

// Target collection map for existence checks
const TARGET_COLLECTIONS = {
  CONTENT: 'content_items',
  REEL: 'reels',
  STORY: 'stories',
  USER: 'users',
  PAGE: 'pages',
}

export async function handleNotifications(path, method, request, db) {
  const route = path.join('/')

  // ========================
  // GET /notifications — List notifications (supports grouped view)
  // ========================
  if (route === 'notifications' && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const { limit, cursor } = parsePagination(url)
    const grouped = url.searchParams.get('grouped') === 'true'

    const query = { userId: user.id }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }

    const notifications = await db.collection('notifications')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = notifications.length > limit
    const items = notifications.slice(0, limit)

    // B2: Filter blocked actors from the list
    const safeItems = await filterBlockedNotifications(db, user.id, items)

    // Enrich with actor info — deleted actors get null safely
    const actorIds = [...new Set(safeItems.map(n => n.actorId).filter(Boolean))]
    const actors = actorIds.length > 0
      ? await db.collection('users').find({ id: { $in: actorIds } }).toArray()
      : []
    const actorMap = Object.fromEntries(actors.map(a => [a.id, sanitizeUser(a)]))

    // Batch target existence check for degradation signal
    const targetChecks = await batchCheckTargets(db, safeItems)

    const enriched = safeItems.map(n => {
      const { _id, dedupKey, ...clean } = n
      return {
        ...clean,
        actor: actorMap[n.actorId] || null,
        targetExists: targetChecks.get(`${n.targetType}:${n.targetId}`) ?? true,
      }
    })

    const unreadCount = await db.collection('notifications').countDocuments({ userId: user.id, read: false })

    const nextCursor = hasMore ? items[items.length - 1].createdAt.toISOString() : null

    // B6-P4: Optional grouping
    const finalItems = grouped ? groupNotifications(enriched) : enriched

    logger.debug(NOTIF_LOG, 'list', { userId: user.id, count: finalItems.length, grouped, unreadCount })

    return {
      data: {
        items: finalItems,
        notifications: finalItems, // backward-compat alias
        pagination: { nextCursor, hasMore },
        nextCursor,
        unreadCount,
      },
    }
  }

  // ========================
  // PATCH /notifications/read — Mark read (specific IDs or all)
  // ========================
  if (route === 'notifications/read' && method === 'PATCH') {
    const user = await requireAuth(request, db)
    const body = await request.json().catch(() => ({}))

    let modifiedCount = 0
    if (body.ids?.length > 0) {
      const result = await db.collection('notifications').updateMany(
        { id: { $in: body.ids }, userId: user.id },
        { $set: { read: true } }
      )
      modifiedCount = result.modifiedCount
    } else {
      const result = await db.collection('notifications').updateMany(
        { userId: user.id, read: false },
        { $set: { read: true } }
      )
      modifiedCount = result.modifiedCount
    }

    const unreadCount = await db.collection('notifications').countDocuments({ userId: user.id, read: false })

    logger.info(NOTIF_LOG, 'mark_read', {
      userId: user.id,
      mode: body.ids?.length > 0 ? 'specific' : 'all',
      modifiedCount,
      unreadCount,
    })

    return { data: { message: 'Notifications marked as read', unreadCount } }
  }

  // ========================
  // GET /notifications/unread-count — Lightweight unread count
  // ========================
  if (route === 'notifications/unread-count' && method === 'GET') {
    const user = await requireAuth(request, db)
    const unreadCount = await db.collection('notifications').countDocuments({ userId: user.id, read: false })
    return { data: { unreadCount } }
  }

  // ========================
  // POST /notifications/register-device — Register push device token
  // ========================
  if (route === 'notifications/register-device' && method === 'POST') {
    const user = await requireAuth(request, db)

    let body
    try { body = await request.json() } catch {
      return { error: 'Request body required', code: ErrorCode.VALIDATION, status: 400 }
    }

    const { token, platform, deviceId, appVersion } = body

    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      return { error: 'token is required (non-empty string)', code: ErrorCode.VALIDATION, status: 400 }
    }
    if (!platform || !VALID_PLATFORMS.includes(platform)) {
      return { error: `platform must be one of: ${VALID_PLATFORMS.join(', ')}`, code: ErrorCode.VALIDATION, status: 400 }
    }

    const trimmedToken = token.trim()

    // Dedup: upsert by userId + token (same user re-registering same token)
    const result = await db.collection('device_tokens').updateOne(
      { userId: user.id, token: trimmedToken },
      {
        $set: {
          userId: user.id,
          token: trimmedToken,
          platform,
          deviceId: deviceId || null,
          appVersion: appVersion || null,
          isActive: true,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        },
        $setOnInsert: {
          id: uuidv4(),
          createdAt: new Date(),
        },
      },
      { upsert: true }
    )

    // Deactivate same token registered to OTHER users (token moved to new device/user)
    await db.collection('device_tokens').updateMany(
      { token: trimmedToken, userId: { $ne: user.id } },
      { $set: { isActive: false, updatedAt: new Date() } }
    )

    logger.info(NOTIF_LOG, result.upsertedCount ? 'device_registered' : 'device_updated', {
      userId: user.id, platform, isNew: !!result.upsertedCount,
    })

    return {
      data: {
        message: result.upsertedCount ? 'Device token registered' : 'Device token updated',
        registered: true,
      },
      status: result.upsertedCount ? 201 : 200,
    }
  }

  // ========================
  // GET /notifications/preferences — Get notification preferences
  // ========================
  if (route === 'notifications/preferences' && method === 'GET') {
    const user = await requireAuth(request, db)
    const preferences = await getUserPreferences(db, user.id)
    return { data: { preferences } }
  }

  // ========================
  // PATCH /notifications/preferences — Update notification preferences
  // ========================
  if (route === 'notifications/preferences' && method === 'PATCH') {
    const user = await requireAuth(request, db)

    let body
    try { body = await request.json() } catch {
      return { error: 'Request body required', code: ErrorCode.VALIDATION, status: 400 }
    }

    const { preferences } = body
    if (!preferences || typeof preferences !== 'object') {
      return { error: 'preferences object required', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Validate keys — only accept known preference types
    const updates = {}
    const unknownKeys = []
    for (const [key, value] of Object.entries(preferences)) {
      if (VALID_PREF_KEYS.includes(key)) {
        if (typeof value !== 'boolean') {
          return { error: `Preference '${key}' must be boolean`, code: ErrorCode.VALIDATION, status: 400 }
        }
        updates[key] = value
      } else {
        unknownKeys.push(key)
      }
    }

    if (unknownKeys.length > 0) {
      return { error: `Unknown preference keys: ${unknownKeys.join(', ')}`, code: ErrorCode.VALIDATION, status: 400 }
    }

    if (Object.keys(updates).length === 0) {
      return { error: 'No valid preference keys provided', code: ErrorCode.VALIDATION, status: 400 }
    }

    await db.collection('notification_preferences').updateOne(
      { userId: user.id },
      { $set: { ...updates, updatedAt: new Date() }, $setOnInsert: { userId: user.id, createdAt: new Date() } },
      { upsert: true }
    )

    const finalPrefs = await getUserPreferences(db, user.id)

    logger.info(NOTIF_LOG, 'preferences_updated', { userId: user.id, changed: Object.keys(updates) })

    return { data: { preferences: finalPrefs, message: 'Preferences updated' } }
  }

  // ========================
  // DELETE /notifications/unregister-device — Remove/deactivate device token
  // ========================
  if (route === 'notifications/unregister-device' && method === 'DELETE') {
    const user = await requireAuth(request, db)

    let body
    try { body = await request.json() } catch {
      return { error: 'Request body required', code: ErrorCode.VALIDATION, status: 400 }
    }

    const { token } = body
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      return { error: 'token is required (non-empty string)', code: ErrorCode.VALIDATION, status: 400 }
    }

    const result = await db.collection('device_tokens').updateOne(
      { userId: user.id, token: token.trim() },
      { $set: { isActive: false, updatedAt: new Date() } }
    )

    logger.info(NOTIF_LOG, 'device_unregistered', {
      userId: user.id, found: result.matchedCount > 0,
    })

    return {
      data: {
        message: result.matchedCount ? 'Device token deactivated' : 'Device token not found',
        deactivated: result.matchedCount > 0,
      },
    }
  }

  // ========================
  // DELETE /notifications/clear — Clear all notifications
  // ========================
  if (route === 'notifications/clear' && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const result = await db.collection('notifications').deleteMany({ userId: user.id })
    return { data: { message: 'All notifications cleared', deletedCount: result.deletedCount } }
  }

  // ========================
  // POST /notifications/read-all — Mark all as read
  // ========================
  if (route === 'notifications/read-all' && method === 'POST') {
    const user = await requireAuth(request, db)
    const result = await db.collection('notifications').updateMany(
      { userId: user.id, read: false },
      { $set: { read: true } }
    )
    return { data: { message: 'All notifications marked as read', modifiedCount: result.modifiedCount } }
  }

  return null
}

/**
 * Batch check target existence for degradation signal.
 * Returns Map<"TYPE:ID", boolean>
 */
async function batchCheckTargets(db, notifications) {
  const result = new Map()
  const checks = new Map() // collection -> Set<id>

  for (const n of notifications) {
    const col = TARGET_COLLECTIONS[n.targetType]
    if (!col || !n.targetId) continue
    const key = `${n.targetType}:${n.targetId}`
    if (result.has(key)) continue
    if (!checks.has(col)) checks.set(col, new Set())
    checks.get(col).add(n.targetId)
  }

  for (const [col, ids] of checks) {
    const idArray = [...ids]
    const existing = await db.collection(col)
      .find({ id: { $in: idArray } }, { projection: { id: 1 } })
      .toArray()
    const existingSet = new Set(existing.map(d => d.id))
    for (const id of idArray) {
      const targetType = Object.entries(TARGET_COLLECTIONS).find(([, v]) => v === col)?.[0]
      result.set(`${targetType}:${id}`, existingSet.has(id))
    }
  }

  return result
}
