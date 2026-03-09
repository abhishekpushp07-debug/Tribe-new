import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import { Config, ErrorCode } from './constants.js'

// ========== PIN HASHING ==========
export function generateSalt() {
  return crypto.randomBytes(32).toString('hex')
}

export function hashPin(pin, salt) {
  return crypto.pbkdf2Sync(
    pin.toString(),
    salt,
    Config.PBKDF2_ITERATIONS,
    Config.PBKDF2_KEY_LENGTH,
    Config.PBKDF2_DIGEST
  ).toString('hex')
}

export function verifyPin(pin, salt, hash) {
  return crypto.timingSafeEqual(
    Buffer.from(hashPin(pin, salt), 'hex'),
    Buffer.from(hash, 'hex')
  )
}

// ========== TOKEN ==========
export function generateToken() {
  return crypto.randomBytes(48).toString('hex')
}

// ========== BRUTE FORCE PROTECTION ==========
// In-memory login attempt tracker per phone number
const loginAttempts = new Map()
const MAX_LOGIN_ATTEMPTS = 5
const LOCKOUT_DURATION_MS = 15 * 60 * 1000 // 15 minutes

export function checkLoginThrottle(phone) {
  const entry = loginAttempts.get(phone)
  if (!entry) return { allowed: true }
  if (entry.count >= MAX_LOGIN_ATTEMPTS) {
    if (Date.now() > entry.lockedUntil) {
      loginAttempts.delete(phone)
      return { allowed: true }
    }
    const retryAfterSec = Math.ceil((entry.lockedUntil - Date.now()) / 1000)
    return { allowed: false, retryAfterSec }
  }
  return { allowed: true }
}

export function recordLoginFailure(phone) {
  const entry = loginAttempts.get(phone) || { count: 0, lockedUntil: 0 }
  entry.count++
  if (entry.count >= MAX_LOGIN_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_DURATION_MS
  }
  loginAttempts.set(phone, entry)
}

export function clearLoginFailures(phone) {
  loginAttempts.delete(phone)
}

// Cleanup stale entries every 10 minutes
setInterval(() => {
  const now = Date.now()
  for (const [phone, entry] of loginAttempts) {
    if (now > entry.lockedUntil + LOCKOUT_DURATION_MS) {
      loginAttempts.delete(phone)
    }
  }
}, 10 * 60 * 1000)

// ========== AUTHENTICATE ==========
export async function authenticate(request, db) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  if (!token || token.length < 10) return null // Basic token format check
  const session = await db.collection('sessions').findOne({
    token,
    expiresAt: { $gt: new Date() },
  })
  if (!session) return null
  const user = await db.collection('users').findOne({ id: session.userId })
  if (!user || user.isBanned) return null
  // Check active suspension
  if (user.suspendedUntil && new Date(user.suspendedUntil) > new Date()) return null
  return user
}

// Require auth — throws structured error
export async function requireAuth(request, db) {
  const user = await authenticate(request, db)
  if (!user) {
    const error = new Error('Authentication required')
    error.status = 401
    error.code = ErrorCode.UNAUTHORIZED
    throw error
  }
  return user
}

// Require specific roles
export function requireRole(user, ...roles) {
  if (!roles.includes(user.role)) {
    const error = new Error('Insufficient permissions')
    error.status = 403
    error.code = ErrorCode.FORBIDDEN
    throw error
  }
}

// ========== IDOR PROTECTION ==========
// Ensures a user can only access their own resources (or moderator+)
export function requireOwnerOrMod(user, resourceOwnerId) {
  if (user.id !== resourceOwnerId && !['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
    const error = new Error('Access denied: not the resource owner')
    error.status = 403
    error.code = ErrorCode.FORBIDDEN
    throw error
  }
}

// ========== SANITIZE USER ==========
export function sanitizeUser(user) {
  if (!user) return null
  const { _id, pinHash, pinSalt, ...safe } = user
  return safe
}

// ========== AUDIT LOG ==========
export async function writeAudit(db, eventType, actorId, targetType, targetId, metadata = {}) {
  await db.collection('audit_logs').insertOne({
    id: uuidv4(),
    eventType,
    actorId,
    targetType,
    targetId,
    metadata,
    createdAt: new Date(),
  })
}

// ========== NOTIFICATION ==========
export async function createNotification(db, userId, type, actorId, targetType, targetId, message) {
  if (userId === actorId) return // Don't notify self
  await db.collection('notifications').insertOne({
    id: uuidv4(),
    userId,
    type,
    actorId,
    targetType,
    targetId,
    message,
    read: false,
    createdAt: new Date(),
  })
}

// ========== PAGINATION ==========
export function parsePagination(url, defaults = {}) {
  const limit = Math.min(
    parseInt(url.searchParams.get('limit') || String(defaults.limit || Config.DEFAULT_PAGE_LIMIT)),
    Config.MAX_PAGE_LIMIT
  )
  const cursor = url.searchParams.get('cursor') || null
  const offset = parseInt(url.searchParams.get('offset') || '0')
  return { limit, cursor, offset }
}

// ========== ENRICH POSTS ==========
// Contract v2: Uses toUserSnippet for embedded author
import { toUserSnippet } from './entity-snippets.js'

export async function enrichPosts(db, posts, viewerId) {
  if (posts.length === 0) return []

  const authorIds = [...new Set(posts.map(p => p.authorId))]
  const authors = await db.collection('users').find({ id: { $in: authorIds } }).toArray()
  const authorMap = Object.fromEntries(authors.map(a => [a.id, toUserSnippet(a)]))

  let viewerReactions = {}
  let viewerSaves = {}

  if (viewerId) {
    const contentIds = posts.map(p => p.id)
    const [reactions, saves] = await Promise.all([
      db.collection('reactions').find({ userId: viewerId, contentId: { $in: contentIds } }).toArray(),
      db.collection('saves').find({ userId: viewerId, contentId: { $in: contentIds } }).toArray(),
    ])
    reactions.forEach(r => { viewerReactions[r.contentId] = r.type })
    saves.forEach(s => { viewerSaves[s.contentId] = true })
  }

  return posts.map(p => {
    const { _id, dislikeCountInternal, ...clean } = p
    return {
      ...clean,
      mediaIds: (p.media || []).map(m => m.id),
      author: authorMap[p.authorId] || null,
      viewerHasLiked: viewerReactions[p.id] === 'LIKE',
      viewerHasDisliked: viewerReactions[p.id] === 'DISLIKE',
      viewerHasSaved: !!viewerSaves[p.id],
    }
  })
}
