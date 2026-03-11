/**
 * Tribe Notifications 2.0 — Service Layer
 * Centralized notification creation with:
 *   - Preference checking
 *   - Block/self-notify suppression
 *   - Duplicate prevention within time window
 *   - Delivery eligibility
 */

import { v4 as uuidv4 } from 'uuid'

// Default preference state — all enabled
const DEFAULT_PREFERENCES = {
  FOLLOW: true,
  LIKE: true,
  COMMENT: true,
  COMMENT_LIKE: true,
  SHARE: true,
  MENTION: true,
  REEL_LIKE: true,
  REEL_COMMENT: true,
  REEL_SHARE: true,
  STORY_REACTION: true,
  STORY_REPLY: true,
  STORY_REMOVED: true,
  REPORT_RESOLVED: true,
  STRIKE_ISSUED: true,
  APPEAL_DECIDED: true,
  HOUSE_POINTS: true,
}

// Types that are always delivered regardless of preferences (system-critical)
const FORCE_DELIVER_TYPES = new Set([
  'REPORT_RESOLVED',
  'STRIKE_ISSUED',
  'APPEAL_DECIDED',
])

// Dedup window (5 minutes) — same {type, actorId, targetId} within this window is suppressed
const DEDUP_WINDOW_MS = 5 * 60 * 1000

/**
 * Get user's notification preferences with defaults
 */
export async function getUserPreferences(db, userId) {
  const doc = await db.collection('notification_preferences').findOne({ userId })
  if (!doc) return { ...DEFAULT_PREFERENCES }
  const { _id, userId: _, updatedAt: __, ...prefs } = doc
  return { ...DEFAULT_PREFERENCES, ...prefs }
}

/**
 * Check if a notification type is enabled for a user
 */
async function isTypeEnabled(db, userId, type) {
  if (FORCE_DELIVER_TYPES.has(type)) return true
  const prefs = await getUserPreferences(db, userId)
  return prefs[type] !== false
}

/**
 * Check if actor is blocked by recipient
 */
async function isBlockedByRecipient(db, recipientId, actorId) {
  const block = await db.collection('blocks').findOne({
    $or: [
      { blockerId: recipientId, blockedId: actorId },
      { blockerId: actorId, blockedId: recipientId },
    ],
  })
  return !!block
}

/**
 * Check for duplicate notification within dedup window
 */
async function isDuplicate(db, userId, type, actorId, targetId) {
  const cutoff = new Date(Date.now() - DEDUP_WINDOW_MS)
  const existing = await db.collection('notifications').findOne({
    userId,
    type,
    actorId,
    targetId,
    createdAt: { $gte: cutoff },
  })
  return !!existing
}

/**
 * Create a notification with full delivery hygiene.
 * Returns the notification doc if created, null if suppressed.
 */
export async function createNotificationV2(db, {
  userId,
  type,
  actorId,
  targetType,
  targetId,
  message,
}) {
  // Rule 1: No self-notification
  if (userId === actorId) return null

  // Rule 2: Check preferences
  const enabled = await isTypeEnabled(db, userId, type)
  if (!enabled) return null

  // Rule 3: Check block relationship
  if (actorId) {
    const blocked = await isBlockedByRecipient(db, userId, actorId)
    if (blocked) return null
  }

  // Rule 4: Dedup within time window (same type + actor + target)
  const dup = await isDuplicate(db, userId, type, actorId, targetId)
  if (dup) return null

  const notification = {
    id: uuidv4(),
    userId,
    type,
    actorId,
    targetType,
    targetId,
    message,
    read: false,
    createdAt: new Date(),
  }

  await db.collection('notifications').insertOne(notification)

  const { _id, ...clean } = notification
  return clean
}

/**
 * Backward-compatible wrapper — matches old createNotification signature
 */
export async function createNotificationCompat(db, userId, type, actorId, targetType, targetId, message) {
  return createNotificationV2(db, { userId, type, actorId, targetType, targetId, message })
}

/**
 * Group notifications by {type, targetId} for cleaner inbox display.
 * Returns grouped array where same-type same-target notifications are merged.
 */
export function groupNotifications(notifications) {
  if (!notifications || !notifications.length) return []

  const groupMap = new Map()

  for (const notif of notifications) {
    const key = `${notif.type}:${notif.targetId || 'none'}`

    if (groupMap.has(key)) {
      const group = groupMap.get(key)
      group.actorIds.add(notif.actorId)
      group.actors.push(notif.actor)
      group.count++
      if (!notif.read) group.unreadCount++
      // Keep latest notification's data
      if (new Date(notif.createdAt) > new Date(group.latestAt)) {
        group.latestAt = notif.createdAt
        group.latestMessage = notif.message
        group.latestId = notif.id
      }
    } else {
      groupMap.set(key, {
        id: notif.id,
        type: notif.type,
        targetType: notif.targetType,
        targetId: notif.targetId,
        actorIds: new Set([notif.actorId]),
        actors: notif.actor ? [notif.actor] : [],
        count: 1,
        unreadCount: notif.read ? 0 : 1,
        latestAt: notif.createdAt,
        latestMessage: notif.message,
        latestId: notif.id,
        read: notif.read,
      })
    }
  }

  return Array.from(groupMap.values()).map(g => ({
    id: g.latestId,
    type: g.type,
    targetType: g.targetType,
    targetId: g.targetId,
    actorCount: g.actorIds.size,
    actors: g.actors.filter(Boolean).slice(0, 3), // Preview up to 3 actors
    count: g.count,
    unreadCount: g.unreadCount,
    message: g.actorIds.size > 1
      ? `${g.actors[0]?.displayName || 'Someone'} and ${g.actorIds.size - 1} others`
      : g.latestMessage,
    read: g.unreadCount === 0,
    createdAt: g.latestAt,
  }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
}

export { DEFAULT_PREFERENCES }
