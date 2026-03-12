/**
 * Tribe — World-Class Follow Request System
 *
 * Private account support with follow requests: send, accept,
 * reject, cancel, list pending/sent requests.
 */

import { v4 as uuidv4 } from 'uuid'
import { requireAuth, sanitizeUser, createNotification } from '../auth-utils.js'
import { ErrorCode, NotificationType } from '../constants.js'

export async function handleFollowRequests(path, method, request, db) {
  const route = path.join('/')

  // ========================
  // GET /me/follow-requests — Pending requests received
  // ========================
  if (route === 'me/follow-requests' && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
    const offset = parseInt(url.searchParams.get('offset') || '0')

    const requests = await db.collection('follow_requests')
      .find({ targetId: user.id, status: 'PENDING' })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit + 1)
      .toArray()

    const hasMore = requests.length > limit
    const items = requests.slice(0, limit)

    const requesterIds = items.map(r => r.requesterId)
    const users = requesterIds.length > 0
      ? await db.collection('users').find({ id: { $in: requesterIds } }).toArray()
      : []
    const userMap = Object.fromEntries(users.map(u => [u.id, sanitizeUser(u)]))

    // Check mutual follow status
    const mutualFollows = requesterIds.length > 0
      ? await db.collection('follows').find({ followerId: user.id, followeeId: { $in: requesterIds } }).toArray()
      : []
    const mutualSet = new Set(mutualFollows.map(f => f.followeeId))

    const enriched = items.map(r => ({
      id: r.id,
      requester: userMap[r.requesterId] || null,
      status: r.status,
      isFollowingBack: mutualSet.has(r.requesterId),
      createdAt: r.createdAt,
    }))

    const totalPending = await db.collection('follow_requests').countDocuments({ targetId: user.id, status: 'PENDING' })

    return { data: { items: enriched, total: totalPending, pagination: { hasMore, limit, offset } } }
  }

  // ========================
  // GET /me/follow-requests/sent — Requests you've sent
  // ========================
  if (route === 'me/follow-requests/sent' && method === 'GET') {
    const user = await requireAuth(request, db)
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)

    const requests = await db.collection('follow_requests')
      .find({ requesterId: user.id, status: 'PENDING' })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray()

    const targetIds = requests.map(r => r.targetId)
    const users = targetIds.length > 0
      ? await db.collection('users').find({ id: { $in: targetIds } }).toArray()
      : []
    const userMap = Object.fromEntries(users.map(u => [u.id, sanitizeUser(u)]))

    const items = requests.map(r => ({
      id: r.id,
      target: userMap[r.targetId] || null,
      status: r.status,
      createdAt: r.createdAt,
    }))

    return { data: { items } }
  }

  // ========================
  // GET /me/follow-requests/count — Pending count (for badge)
  // ========================
  if (route === 'me/follow-requests/count' && method === 'GET') {
    const user = await requireAuth(request, db)
    const count = await db.collection('follow_requests').countDocuments({ targetId: user.id, status: 'PENDING' })
    return { data: { count } }
  }

  // ========================
  // POST /follow-requests/:id/accept — Accept a follow request
  // ========================
  if (path[0] === 'follow-requests' && path.length === 3 && path[2] === 'accept' && method === 'POST') {
    const user = await requireAuth(request, db)
    const requestId = path[1]

    const req = await db.collection('follow_requests').findOne({ id: requestId })
    if (!req) return { error: 'Follow request not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (req.targetId !== user.id) return { error: 'Not your request to accept', code: 'FORBIDDEN', status: 403 }
    if (req.status !== 'PENDING') return { error: `Request already ${req.status.toLowerCase()}`, code: ErrorCode.VALIDATION, status: 400 }

    // Accept: create follow relationship
    await db.collection('follow_requests').updateOne({ id: requestId }, {
      $set: { status: 'ACCEPTED', respondedAt: new Date() },
    })

    // Check if follow already exists
    const existingFollow = await db.collection('follows').findOne({ followerId: req.requesterId, followeeId: req.targetId })
    if (!existingFollow) {
      await db.collection('follows').insertOne({
        id: uuidv4(),
        followerId: req.requesterId,
        followeeId: req.targetId,
        createdAt: new Date(),
      })
      await Promise.all([
        db.collection('users').updateOne({ id: req.requesterId }, { $inc: { followingCount: 1 } }),
        db.collection('users').updateOne({ id: req.targetId }, { $inc: { followersCount: 1 } }),
      ])
    }

    // Notify requester
    await createNotification(db, req.requesterId, NotificationType.FOLLOW, user.id, 'USER', user.id,
      `${user.displayName} accepted your follow request`)

    return { data: { message: 'Follow request accepted' } }
  }

  // ========================
  // POST /follow-requests/:id/reject — Reject a follow request
  // ========================
  if (path[0] === 'follow-requests' && path.length === 3 && path[2] === 'reject' && method === 'POST') {
    const user = await requireAuth(request, db)
    const requestId = path[1]

    const req = await db.collection('follow_requests').findOne({ id: requestId })
    if (!req) return { error: 'Follow request not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (req.targetId !== user.id) return { error: 'Not your request', code: 'FORBIDDEN', status: 403 }
    if (req.status !== 'PENDING') return { error: `Already ${req.status.toLowerCase()}`, code: ErrorCode.VALIDATION, status: 400 }

    await db.collection('follow_requests').updateOne({ id: requestId }, {
      $set: { status: 'REJECTED', respondedAt: new Date() },
    })

    return { data: { message: 'Follow request rejected' } }
  }

  // ========================
  // DELETE /follow-requests/:id — Cancel a sent request
  // ========================
  if (path[0] === 'follow-requests' && path.length === 2 && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const requestId = path[1]

    const req = await db.collection('follow_requests').findOne({ id: requestId })
    if (!req) return { error: 'Follow request not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (req.requesterId !== user.id) return { error: 'Not your request', code: 'FORBIDDEN', status: 403 }
    if (req.status !== 'PENDING') return { error: `Cannot cancel ${req.status.toLowerCase()} request`, code: ErrorCode.VALIDATION, status: 400 }

    await db.collection('follow_requests').deleteOne({ id: requestId })
    return { data: { message: 'Follow request cancelled' } }
  }

  // ========================
  // POST /follow-requests/accept-all — Accept all pending requests
  // ========================
  if (route === 'follow-requests/accept-all' && method === 'POST') {
    const user = await requireAuth(request, db)

    const pending = await db.collection('follow_requests')
      .find({ targetId: user.id, status: 'PENDING' })
      .toArray()

    let accepted = 0
    for (const req of pending) {
      const existingFollow = await db.collection('follows').findOne({ followerId: req.requesterId, followeeId: user.id })
      if (!existingFollow) {
        await db.collection('follows').insertOne({
          id: uuidv4(), followerId: req.requesterId, followeeId: user.id, createdAt: new Date(),
        })
        await Promise.all([
          db.collection('users').updateOne({ id: req.requesterId }, { $inc: { followingCount: 1 } }),
          db.collection('users').updateOne({ id: user.id }, { $inc: { followersCount: 1 } }),
        ])
      }
      accepted++
    }

    await db.collection('follow_requests').updateMany(
      { targetId: user.id, status: 'PENDING' },
      { $set: { status: 'ACCEPTED', respondedAt: new Date() } }
    )

    return { data: { message: `Accepted ${accepted} follow requests`, accepted } }
  }

  return null
}

/**
 * Enhanced follow handler — integrates with private accounts.
 * Call this BEFORE the existing follow handler to intercept private account follows.
 */
export async function interceptFollowForPrivateAccount(path, method, request, db) {
  if (path[0] !== 'follow' || path.length !== 2 || method !== 'POST') return null

  const user = await requireAuth(request, db)
  const targetId = path[1]
  if (targetId === user.id) return null // let main handler deal with self-follow error

  const target = await db.collection('users').findOne({ id: targetId })
  if (!target) return null // let main handler return 404
  if (!target.isPrivate) return null // public account → normal follow flow

  // Private account: create follow request instead
  const existing = await db.collection('follows').findOne({ followerId: user.id, followeeId: targetId })
  if (existing) return { data: { message: 'Already following', isFollowing: true } }

  const existingRequest = await db.collection('follow_requests').findOne({
    requesterId: user.id, targetId, status: 'PENDING',
  })
  if (existingRequest) return { data: { message: 'Follow request already sent', requestPending: true, requestId: existingRequest.id } }

  const reqId = uuidv4()
  await db.collection('follow_requests').insertOne({
    id: reqId,
    requesterId: user.id,
    targetId,
    status: 'PENDING',
    createdAt: new Date(),
  })

  // Notify target
  await createNotification(db, targetId, NotificationType.FOLLOW, user.id, 'USER', user.id,
    `${user.displayName} requested to follow you`)

  return { data: { message: 'Follow request sent', requestPending: true, requestId: reqId } }
}
