import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import { Config, ErrorCode } from './constants.js'

// Instagram-style helpers
function fmtCount(n) {
  if (!n || n < 0) return '0'
  if (n < 1000) return String(n)
  if (n < 10000) return (n / 1000).toFixed(1).replace('.0', '') + 'K'
  if (n < 1000000) return Math.round(n / 1000) + 'K'
  if (n < 10000000) return (n / 1000000).toFixed(1).replace('.0', '') + 'M'
  return Math.round(n / 1000000) + 'M'
}

function timeAgo(date) {
  if (!date) return ''
  const diff = Date.now() - new Date(date).getTime()
  if (diff < 60000) return 'now'
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm'
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h'
  if (diff < 604800000) return Math.floor(diff / 86400000) + 'd'
  if (diff < 2592000000) return Math.floor(diff / 604800000) + 'w'
  return Math.floor(diff / 2592000000) + 'mo'
}

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

// ========== TOKEN GENERATION ==========
export function generateToken() {
  return crypto.randomBytes(48).toString('hex')
}

export function generateAccessToken() {
  return `at_${crypto.randomBytes(32).toString('hex')}`
}

export function generateRefreshToken() {
  return `rt_${crypto.randomBytes(48).toString('hex')}`
}

// ========== SESSION CREATION (Stage 2: Access + Refresh split) ==========
import { extractIP } from './security.js'

export async function createSession(db, userId, request) {
  const now = new Date()
  const accessToken = generateAccessToken()
  const refreshToken = generateRefreshToken()
  const sessionId = uuidv4()
  const ip = extractIP(request)
  const userAgent = request.headers.get('user-agent') || 'unknown'

  // Enforce max concurrent sessions per user
  const activeSessions = await db.collection('sessions')
    .find({ userId, refreshTokenExpiresAt: { $gt: now } })
    .sort({ lastAccessedAt: 1, createdAt: 1 })
    .toArray()

  if (activeSessions.length >= Config.MAX_SESSIONS_PER_USER) {
    // Evict oldest session(s) to make room
    const toEvict = activeSessions.slice(0, activeSessions.length - Config.MAX_SESSIONS_PER_USER + 1)
    const evictIds = toEvict.map(s => s.id)
    await db.collection('sessions').deleteMany({ id: { $in: evictIds } })
  }

  const session = {
    id: sessionId,
    userId,
    // Access token (short-lived)
    token: accessToken, // 'token' field for backward compat with authenticate()
    accessTokenExpiresAt: new Date(now.getTime() + Config.ACCESS_TOKEN_TTL_MS),
    // Refresh token (long-lived)
    refreshToken,
    refreshTokenFamily: uuidv4(), // family ID for rotation chain
    refreshTokenVersion: 0,
    refreshTokenExpiresAt: new Date(now.getTime() + Config.REFRESH_TOKEN_TTL_MS),
    refreshTokenUsed: false,
    // Session metadata
    ipAddress: ip,
    deviceInfo: userAgent,
    lastAccessedAt: now,
    lastRefreshedAt: null,
    // Legacy compat
    expiresAt: new Date(now.getTime() + Config.REFRESH_TOKEN_TTL_MS),
    createdAt: now,
  }

  await db.collection('sessions').insertOne(session)

  return {
    sessionId,
    accessToken,
    refreshToken,
    accessTokenExpiresAt: session.accessTokenExpiresAt,
    refreshTokenExpiresAt: session.refreshTokenExpiresAt,
    expiresIn: Math.floor(Config.ACCESS_TOKEN_TTL_MS / 1000),
  }
}

// ========== REFRESH TOKEN ROTATION (Stage 2) ==========
export async function rotateRefreshToken(db, oldRefreshToken, request) {
  const now = new Date()
  const ip = extractIP(request)

  // Find session by refresh token
  const session = await db.collection('sessions').findOne({ refreshToken: oldRefreshToken })

  if (!session) {
    // Check if this is a REUSED refresh token (replay attack)
    const reusedSession = await db.collection('sessions').findOne({
      'rotatedRefreshTokens': oldRefreshToken,
    })
    if (reusedSession) {
      // CRITICAL: Replay detected — invalidate the ENTIRE family
      await db.collection('sessions').deleteMany({
        refreshTokenFamily: reusedSession.refreshTokenFamily,
      })
      return { error: 'REUSE_DETECTED', familyRevoked: true }
    }
    return { error: 'INVALID_REFRESH_TOKEN' }
  }

  // Check refresh token expiry
  if (session.refreshTokenExpiresAt < now) {
    await db.collection('sessions').deleteOne({ id: session.id })
    return { error: 'REFRESH_TOKEN_EXPIRED' }
  }

  // Check if user is still valid
  const user = await db.collection('users').findOne({ id: session.userId })
  if (!user || user.isBanned) {
    await db.collection('sessions').deleteOne({ id: session.id })
    return { error: 'USER_INVALID' }
  }
  if (user.suspendedUntil && new Date(user.suspendedUntil) > now) {
    return { error: 'USER_SUSPENDED' }
  }

  // Generate new tokens
  const newAccessToken = generateAccessToken()
  const newRefreshToken = generateRefreshToken()

  // Rotate: update session with new tokens, track old refresh token for reuse detection
  await db.collection('sessions').updateOne(
    { id: session.id },
    {
      $set: {
        token: newAccessToken,
        accessTokenExpiresAt: new Date(now.getTime() + Config.ACCESS_TOKEN_TTL_MS),
        refreshToken: newRefreshToken,
        refreshTokenVersion: (session.refreshTokenVersion || 0) + 1,
        refreshTokenUsed: false,
        lastRefreshedAt: now,
        lastAccessedAt: now,
        ipAddress: ip,
      },
      $push: {
        rotatedRefreshTokens: {
          $each: [oldRefreshToken],
          $slice: -5, // Keep last 5 for reuse detection window
        },
      },
    }
  )

  return {
    sessionId: session.id,
    userId: session.userId,
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    accessTokenExpiresAt: new Date(now.getTime() + Config.ACCESS_TOKEN_TTL_MS),
    expiresIn: Math.floor(Config.ACCESS_TOKEN_TTL_MS / 1000),
    user,
  }
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

// ========== AUTHENTICATE (Stage 2: Dual-mode — legacy + access token) ==========
export async function authenticate(request, db) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  if (!token || token.length < 10) return null

  const now = new Date()

  let session = null

  // New model: Access token starts with 'at_'
  if (token.startsWith('at_')) {
    session = await db.collection('sessions').findOne({ token })
    if (!session) return null

    // Check access token expiry
    if (session.accessTokenExpiresAt && session.accessTokenExpiresAt < now) {
      // Access token expired — return special marker for middleware
      const err = new Error('Access token expired. Use refresh token.')
      err.status = 401
      err.code = ErrorCode.ACCESS_TOKEN_EXPIRED
      throw err
    }
  } else {
    // Legacy model: Old-style tokens without prefix
    session = await db.collection('sessions').findOne({
      token,
      expiresAt: { $gt: now },
    })
    if (!session) return null
  }

  // Update lastAccessedAt (throttled: max once per minute to reduce writes)
  const lastAccess = session.lastAccessedAt ? new Date(session.lastAccessedAt).getTime() : 0
  if (now.getTime() - lastAccess > 60_000) {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') || 'unknown'
    db.collection('sessions').updateOne(
      { id: session.id },
      { $set: { lastAccessedAt: now, ipAddress: ip } }
    ).catch(() => {}) // non-blocking
  }

  const user = await db.collection('users').findOne({ id: session.userId })
  if (!user || user.isBanned) return null
  // Check active suspension
  if (user.suspendedUntil && new Date(user.suspendedUntil) > now) return null
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
// B1: Now delegates to toUserProfile() for canonical avatar resolution.
// This ensures avatarUrl is present in ALL surfaces using sanitizeUser.
import { toUserProfile, toUserProfileWithCdn, toUserSnippet, toPageSnippet, resolveAvatarUrl } from './entity-snippets.js'
export function sanitizeUser(user) {
  return toUserProfile(user)
}
export async function sanitizeUserCdn(user, db) {
  return toUserProfileWithCdn(user, db)
}

// ========== AUDIT LOG (Stage 3: Unified pipeline) ==========
// Delegates to the canonical writeSecurityAudit in security.js
// This preserves backward compatibility for all 50+ existing call sites
// while routing through the unified audit pipeline with PII masking + severity
import { writeSecurityAudit } from './security.js'

export async function writeAudit(db, eventType, actorId, targetType, targetId, metadata = {}) {
  return writeSecurityAudit(db, {
    category: 'SYSTEM',
    eventType,
    actorId,
    targetType,
    targetId,
    metadata,
    severity: 'INFO',
  })
}

// ========== NOTIFICATION ==========
// B6-P4: Canonical write path — delegates to NotificationV2 service for
// preference checking, dedup, block suppression, and self-notify prevention.
// All existing callers (social, reels, stories, pages) automatically get V2 behavior.
import { createNotificationV2 } from './services/notification-service.js'

export async function createNotification(db, userId, type, actorId, targetType, targetId, message) {
  return createNotificationV2(db, { userId, type, actorId, targetType, targetId, message })
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
// Contract v2.1: Uses toUserSnippet for embedded author (imported at top of sanitizeUser block)
// B3: Extended to support authorType=PAGE with toPageSnippet

export async function enrichPosts(db, posts, viewerId) {
  if (posts.length === 0) return []

  // B3: Separate user-authored and page-authored posts
  const userAuthorIds = [...new Set(posts.filter(p => p.authorType !== 'PAGE').map(p => p.authorId))]
  const pageAuthorIds = [...new Set(posts.filter(p => p.authorType === 'PAGE').map(p => p.pageId || p.authorId))]

  // B4: Collect original content IDs for reposts
  const originalContentIds = [...new Set(posts.filter(p => p.originalContentId).map(p => p.originalContentId))]

  // Collect all media asset IDs from posts for thumbnail resolution
  const allMediaIds = []
  for (const p of posts) {
    if (p.media && Array.isArray(p.media)) {
      for (const m of p.media) {
        if (m.id) allMediaIds.push(m.id)
      }
    }
  }
  const uniqueMediaIds = [...new Set(allMediaIds)]

  // Batch-fetch authors + media assets in parallel
  const [authors, pages, mediaAssets] = await Promise.all([
    userAuthorIds.length > 0
      ? db.collection('users').find({ id: { $in: userAuthorIds } }).toArray()
      : [],
    pageAuthorIds.length > 0
      ? db.collection('pages').find({ id: { $in: pageAuthorIds } }, { projection: { _id: 0 } }).toArray()
      : [],
    uniqueMediaIds.length > 0
      ? db.collection('media_assets').find(
          { id: { $in: uniqueMediaIds } },
          { projection: { _id: 0, id: 1, publicUrl: 1, playbackUrl: 1, hlsUrl: 1, dashUrl: 1, thumbnailUrl: 1, posterFrameUrl: 1, thumbnailStatus: 1, playbackStatus: 1, width: 1, height: 1, duration: 1, mimeType: 1, storageType: 1, variants: 1 } }
        ).toArray()
      : [],
  ])

  // B4: Fetch original content for reposts
  let originalContentMap = {}
  if (originalContentIds.length > 0) {
    const originals = await db.collection('content_items')
      .find({ id: { $in: originalContentIds } })
      .toArray()
    // Resolve original authors
    const origUserIds = [...new Set(originals.filter(p => p.authorType !== 'PAGE').map(p => p.authorId))]
    const origPageIds = [...new Set(originals.filter(p => p.authorType === 'PAGE').map(p => p.pageId || p.authorId))]

    const [origAuthors, origPages] = await Promise.all([
      origUserIds.length > 0
        ? db.collection('users').find({ id: { $in: origUserIds } }).toArray()
        : [],
      origPageIds.length > 0
        ? db.collection('pages').find({ id: { $in: origPageIds } }, { projection: { _id: 0 } }).toArray()
        : [],
    ])
    const origAuthorMap = Object.fromEntries(origAuthors.map(a => [a.id, toUserSnippet(a)]))
    const origPageMap = Object.fromEntries(origPages.map(p => [p.id, toPageSnippet(p)]))

    for (const o of originals) {
      const { _id, dislikeCountInternal, ...clean } = o
      let oAuthor = null
      const oType = o.authorType || 'USER'
      if (oType === 'PAGE') {
        oAuthor = origPageMap[o.pageId || o.authorId] || null
      } else {
        oAuthor = origAuthorMap[o.authorId] || null
      }
      originalContentMap[o.id] = {
        ...clean,
        authorType: oType,
        author: oAuthor,
        mediaIds: (o.media || []).map(m => m.id),
      }
    }
  }

  const authorMap = Object.fromEntries(authors.map(a => [a.id, toUserSnippet(a)]))
  const pageMap = Object.fromEntries(pages.map(p => [p.id, toPageSnippet(p)]))

  // Resolve author avatar CDN URLs (not /api/media/ proxy)
  const avatarMediaIds = [...new Set(authors.map(a => a.avatarMediaId || a.avatar).filter(Boolean))]
  const avatarAssets = avatarMediaIds.length > 0
    ? await db.collection('media_assets').find({ id: { $in: avatarMediaIds } }, { projection: { _id: 0, id: 1, publicUrl: 1 } }).toArray()
    : []
  const avatarCdnMap = Object.fromEntries(avatarAssets.filter(a => a.publicUrl).map(a => [a.id, a.publicUrl]))

  // Inject CDN avatar into author snippets
  for (const author of authors) {
    const mid = author.avatarMediaId || author.avatar
    const cdnUrl = mid ? avatarCdnMap[mid] : null
    const snippet = authorMap[author.id]
    if (snippet) {
      snippet.avatarUrl = cdnUrl || author.profilePicUrl || snippet.avatarUrl || ''
      snippet.profilePicUrl = author.profilePicUrl || cdnUrl || ''
    }
  }

  // Build media asset lookup for thumbnail/CDN resolution
  const mediaAssetMap = Object.fromEntries(mediaAssets.map(a => [a.id, a]))

  let viewerReactions = {}
  let viewerSaves = {}
  let viewerPollVotes = {}

  if (viewerId) {
    const contentIds = posts.map(p => p.id)
    const pollPostIds = posts.filter(p => p.poll).map(p => p.id)
    const [reactions, saves, pollVotes] = await Promise.all([
      db.collection('reactions').find({ userId: viewerId, contentId: { $in: contentIds } }).toArray(),
      db.collection('saves').find({ userId: viewerId, contentId: { $in: contentIds } }).toArray(),
      pollPostIds.length > 0
        ? db.collection('poll_votes').find({ userId: viewerId, contentId: { $in: pollPostIds } }).toArray()
        : [],
    ])
    reactions.forEach(r => { viewerReactions[r.contentId] = r.type })
    saves.forEach(s => { viewerSaves[s.contentId] = true })
    pollVotes.forEach(v => { viewerPollVotes[v.contentId] = v.optionId })
  }

  return posts.map(p => {
    const { _id, dislikeCountInternal, ...clean } = p

    // B3: Resolve author based on authorType
    let author = null
    let authorType = p.authorType || 'USER'
    if (authorType === 'PAGE') {
      author = pageMap[p.pageId || p.authorId] || null
    } else {
      author = authorMap[p.authorId] || null
    }

    // Resolve media with thumbnails, CDN URLs, and video variants from media_assets
    let resolvedMedia = clean.media
    if (Array.isArray(clean.media) && clean.media.length > 0) {
      resolvedMedia = clean.media.map(m => {
        const asset = mediaAssetMap[m.id]
        if (!asset) return m
        const isVideo = (m.mimeType || m.type || '').toLowerCase().includes('video')

        // Use 720p variant for crisp quality, provide original as HD
        const variants = asset.variants || {}
        const feedUrl = (isVideo && (variants['720p']?.url || variants.ultrafast_720p?.url || variants['480p']?.url || variants.faststart?.url))
          || asset.playbackUrl || asset.publicUrl || m.publicUrl || m.url
        const hdUrl = (isVideo && (asset.publicUrl || variants.faststart?.url || variants['720p']?.url))
          || asset.playbackUrl || asset.publicUrl || m.publicUrl || m.url

        return {
          ...m,
          url: feedUrl,
          hdUrl: isVideo ? hdUrl : undefined,
          processedUrl: isVideo ? feedUrl : undefined,
          publicUrl: asset.publicUrl || m.publicUrl || null,
          playbackUrl: isVideo ? feedUrl : undefined,
          hlsUrl: isVideo ? (asset.hlsUrl || variants.hls?.url || null) : undefined,
          dashUrl: isVideo ? (asset.dashUrl || variants.dash?.url || null) : undefined,
          thumbnailUrl: asset.thumbnailUrl || variants.thumbnail?.url || m.thumbnailUrl || null,
          posterFrameUrl: asset.posterFrameUrl || variants.poster?.url || asset.thumbnailUrl || m.thumbnailUrl || null,
          width: asset.width || m.width || null,
          height: asset.height || m.height || null,
          duration: asset.duration || m.duration || null,
          storageType: asset.storageType || m.storageType || null,
          playbackStatus: isVideo ? (asset.playbackStatus || 'READY') : undefined,
          processingState: isVideo ? (asset.playbackStatus === 'PROCESSING' ? 'processing' : asset.playbackStatus === 'READY' ? 'ready' : asset.playbackStatus === 'FAILED' ? 'failed' : 'not_applicable') : undefined,
          variants: isVideo ? variants : undefined,
          recommended: isVideo ? {
            primary: feedUrl,
            mp4: feedUrl,
            poster: asset.posterFrameUrl || variants.poster?.url || asset.thumbnailUrl || m.thumbnailUrl || null,
            hd: hdUrl,
          } : undefined,
          ...(isVideo ? {
            playbackHints: {
              preload: 'metadata',
              loop: false,
              playsInline: true,
            },
          } : {}),
        }
      })
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://tribeapp.pro'

    const enriched = {
      ...clean,
      media: resolvedMedia,
      authorType,
      mediaIds: (p.media || []).map(m => m.id),
      author,
      viewerHasLiked: viewerReactions[p.id] === 'LIKE',
      viewerHasDisliked: viewerReactions[p.id] === 'DISLIKE',
      viewerHasSaved: !!viewerSaves[p.id],
      // Video content flag
      hasVideo: Array.isArray(resolvedMedia) && resolvedMedia.some(m => (m.mimeType || m.type || '').toLowerCase().includes('video')),
      // Instagram-level fields
      shareUrl: `${baseUrl}/posts/${p.id}`,
      deepLink: `tribe://posts/${p.id}`,
      timeAgo: timeAgo(p.publishedAt || p.createdAt),
      formatted: {
        likes: fmtCount(p.likeCount || 0),
        comments: fmtCount(p.commentCount || 0),
        shares: fmtCount(p.shareCount || 0),
        views: fmtCount(p.viewCount || 0),
        saves: fmtCount(p.saveCount || 0),
      },
      // Phase D: Poll/thread/link enrichment
      ...(p.poll ? { viewerPollVote: viewerPollVotes[p.id] || null } : {}),
      ...(p.thread ? { isThreadPart: true } : {}),
    }

    // B4: Embed original content for reposts
    if (p.originalContentId && originalContentMap[p.originalContentId]) {
      enriched.originalContent = originalContentMap[p.originalContentId]
      enriched.isRepost = true
    } else if (p.originalContentId) {
      enriched.originalContent = null
      enriched.isRepost = true
    }

    return enriched
  })
}
