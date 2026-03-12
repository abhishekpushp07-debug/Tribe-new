/**
 * Tribe — Activity Status System
 *
 * "Active now", "Active 2h ago", "Active yesterday"
 * Heartbeat tracking + privacy controls.
 */

import { requireAuth, authenticate, sanitizeUser } from '../auth-utils.js'
import { ErrorCode } from '../constants.js'

const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes = "Active now"

function formatActivityStatus(lastSeenAt) {
  if (!lastSeenAt) return { status: 'offline', label: 'Offline', lastSeen: null }

  const now = Date.now()
  const lastSeen = lastSeenAt.getTime?.() || Date.parse(lastSeenAt)
  const diffMs = now - lastSeen
  const diffMin = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMs < ACTIVE_THRESHOLD_MS) {
    return { status: 'active', label: 'Active now', lastSeen: lastSeenAt }
  } else if (diffMin < 60) {
    return { status: 'recently_active', label: `Active ${diffMin}m ago`, lastSeen: lastSeenAt }
  } else if (diffHours < 24) {
    return { status: 'recently_active', label: `Active ${diffHours}h ago`, lastSeen: lastSeenAt }
  } else if (diffDays === 1) {
    return { status: 'away', label: 'Active yesterday', lastSeen: lastSeenAt }
  } else if (diffDays < 7) {
    return { status: 'away', label: `Active ${diffDays}d ago`, lastSeen: lastSeenAt }
  } else {
    return { status: 'offline', label: 'Offline', lastSeen: lastSeenAt }
  }
}

export async function handleActivity(request, db, { method, path }) {
  const route = path.join('/')

  // ========================
  // POST /activity/heartbeat — Update "last seen" timestamp
  // ========================
  if (route === 'activity/heartbeat' && method === 'POST') {
    const user = await requireAuth(request, db)

    await db.collection('users').updateOne(
      { id: user.id },
      { $set: { lastSeenAt: new Date(), isOnline: true } }
    )

    return { data: { status: 'active', lastSeen: new Date() } }
  }

  // ========================
  // GET /activity/status/:userId — Get user's activity status
  // ========================
  if (path[0] === 'activity' && path[1] === 'status' && path[2] && method === 'GET') {
    const currentUser = await authenticate(request, db)
    const targetUserId = path[2]

    const targetUser = await db.collection('users').findOne(
      { id: targetUserId },
      { projection: { _id: 0, id: 1, lastSeenAt: 1, isOnline: 1, showActivityStatus: 1, displayName: 1, username: 1 } }
    )
    if (!targetUser) return { error: 'User not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Privacy check: user can hide activity status
    if (targetUser.showActivityStatus === false && currentUser?.id !== targetUserId) {
      return { data: { userId: targetUserId, status: 'hidden', label: 'Activity status hidden', lastSeen: null } }
    }

    const activity = formatActivityStatus(targetUser.lastSeenAt)
    return { data: { userId: targetUserId, ...activity } }
  }

  // ========================
  // GET /activity/friends — Activity status of followed users
  // ========================
  if (route === 'activity/friends' && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)

    const follows = await db.collection('follows')
      .find({ followerId: user.id })
      .project({ _id: 0, followeeId: 1 })
      .toArray()
    const followedIds = follows.map(f => f.followeeId)

    if (followedIds.length === 0) {
      return { data: { items: [], activeNow: 0, total: 0 } }
    }

    const friends = await db.collection('users')
      .find({ id: { $in: followedIds } })
      .project({ _id: 0, id: 1, displayName: 1, username: 1, avatarMediaId: 1, lastSeenAt: 1, isOnline: 1, showActivityStatus: 1 })
      .toArray()

    const items = friends
      .filter(f => f.showActivityStatus !== false)
      .map(f => {
        const activity = formatActivityStatus(f.lastSeenAt)
        return {
          userId: f.id,
          displayName: f.displayName,
          username: f.username,
          avatarMediaId: f.avatarMediaId,
          ...activity,
        }
      })
      .sort((a, b) => {
        // Sort: active first, then recently_active, then away, then offline
        const order = { active: 0, recently_active: 1, away: 2, offline: 3 }
        return (order[a.status] || 4) - (order[b.status] || 4)
      })
      .slice(0, limit)

    const activeNow = items.filter(i => i.status === 'active').length

    return { data: { items, activeNow, total: items.length } }
  }

  // ========================
  // PUT /activity/settings — Toggle activity status visibility
  // ========================
  if (route === 'activity/settings' && method === 'PUT') {
    const user = await requireAuth(request, db)
    const body = await request.json()
    const { showActivityStatus } = body

    if (typeof showActivityStatus !== 'boolean') {
      return { error: 'showActivityStatus must be boolean', code: ErrorCode.VALIDATION, status: 400 }
    }

    await db.collection('users').updateOne(
      { id: user.id },
      { $set: { showActivityStatus, updatedAt: new Date() } }
    )

    return { data: { showActivityStatus, message: showActivityStatus ? 'Activity status visible' : 'Activity status hidden' } }
  }

  return null
}
