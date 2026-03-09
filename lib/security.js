// ========== TRIBE SECURITY MODULE (Stage 2) ==========
// Per-user + per-IP + per-endpoint rate limiting
// Security headers
// Input sanitization baseline
// PII masking for logs

import { ErrorCode } from './constants.js'

// ========== RATE LIMIT TIERS ==========
// Each tier defines: windowMs, maxRequests
// Applied per (IP + endpoint-tier) for unauthenticated, per (userId + endpoint-tier) for authenticated
export const RateLimitTier = {
  AUTH:        { windowMs: 60_000, max: 10,  name: 'AUTH' },         // login/register/refresh: 10/min
  WRITE:       { windowMs: 60_000, max: 30,  name: 'WRITE' },       // create post/comment/reel/story: 30/min
  READ:        { windowMs: 60_000, max: 120, name: 'READ' },        // feed/search/profile: 120/min
  ADMIN:       { windowMs: 60_000, max: 60,  name: 'ADMIN' },       // admin/moderation routes: 60/min
  SOCIAL:      { windowMs: 60_000, max: 40,  name: 'SOCIAL' },      // follow/unfollow/like/report: 40/min
  SENSITIVE:   { windowMs: 60_000, max: 5,   name: 'SENSITIVE' },   // PIN change, session revoke: 5/min
  GLOBAL:      { windowMs: 60_000, max: 500, name: 'GLOBAL' },      // fallback global per-IP
}

// ========== ENDPOINT → TIER MAPPING ==========
// Returns the rate limit tier for a given route + method
export function getEndpointTier(route, method) {
  // Auth endpoints
  if (route.startsWith('/auth/login') || route.startsWith('/auth/register')) return RateLimitTier.AUTH
  if (route.startsWith('/auth/refresh')) return RateLimitTier.AUTH
  if (route.startsWith('/auth/pin')) return RateLimitTier.SENSITIVE
  if (route === '/auth/sessions' && method === 'DELETE') return RateLimitTier.SENSITIVE
  if (route.startsWith('/auth/sessions/') && method === 'DELETE') return RateLimitTier.SENSITIVE

  // Admin/moderation
  if (route.startsWith('/admin/') || route.startsWith('/moderation/') || route.startsWith('/ops/')) return RateLimitTier.ADMIN

  // Write operations
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
    if (route.startsWith('/content/') || route.startsWith('/stories/') || route.startsWith('/reels/') ||
        route.startsWith('/events') || route.startsWith('/board/') || route.startsWith('/resources')) {
      // Social actions are lighter
      if (route.includes('/like') || route.includes('/save') || route.includes('/comments') ||
          route.includes('/reaction') || route.includes('/rsvp')) {
        return RateLimitTier.SOCIAL
      }
      return RateLimitTier.WRITE
    }
    if (route.startsWith('/follow/') || route.startsWith('/reports')) return RateLimitTier.SOCIAL
    return RateLimitTier.WRITE
  }

  // Read operations
  return RateLimitTier.READ
}

// ========== TIERED RATE LIMITER ==========
// Dual-key: per-IP (always) + per-user (when authenticated)
const rateLimitStores = {
  ip: new Map(),    // key: `${ip}:${tierName}` → { windowStart, count }
  user: new Map(),  // key: `${userId}:${tierName}` → { windowStart, count }
}

export function checkTieredRateLimit(ip, userId, tier) {
  const now = Date.now()

  // Per-IP check
  const ipKey = `${ip}:${tier.name}`
  const ipEntry = rateLimitStores.ip.get(ipKey)
  if (ipEntry && now - ipEntry.windowStart < tier.windowMs) {
    ipEntry.count++
    if (ipEntry.count > tier.max) {
      const retryAfter = Math.ceil((tier.windowMs - (now - ipEntry.windowStart)) / 1000)
      return { allowed: false, retryAfter, limitedBy: 'ip', tier: tier.name }
    }
  } else {
    rateLimitStores.ip.set(ipKey, { windowStart: now, count: 1 })
  }

  // Per-user check (only if authenticated)
  if (userId) {
    const userKey = `${userId}:${tier.name}`
    const userEntry = rateLimitStores.user.get(userKey)
    if (userEntry && now - userEntry.windowStart < tier.windowMs) {
      userEntry.count++
      if (userEntry.count > tier.max) {
        const retryAfter = Math.ceil((tier.windowMs - (now - userEntry.windowStart)) / 1000)
        return { allowed: false, retryAfter, limitedBy: 'user', tier: tier.name }
      }
    } else {
      rateLimitStores.user.set(userKey, { windowStart: now, count: 1 })
    }
  }

  return { allowed: true }
}

// Cleanup stale rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  const maxAge = 5 * 60_000 // 5 minutes
  for (const store of [rateLimitStores.ip, rateLimitStores.user]) {
    for (const [key, entry] of store) {
      if (now - entry.windowStart > maxAge) store.delete(key)
    }
  }
}, 5 * 60_000)

// ========== SECURITY HEADERS ==========
export function applySecurityHeaders(response) {
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  response.headers.set('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'")
  return response
}

// ========== INPUT SANITIZATION ==========
// Strip dangerous HTML/script tags and their contents from user text input
const SCRIPT_BLOCK_PATTERN = /<script[^>]*>[\s\S]*?<\/script>/gi
const DANGEROUS_TAG_PATTERN = /<\/?(?:script|iframe|object|embed|form|meta|link|style)[^>]*>/gi
const EVENT_HANDLER_PATTERN = /\bon\w+\s*=\s*["'][^"']*["']/gi
const JS_PROTOCOL_PATTERN = /javascript\s*:/gi

export function sanitizeTextInput(text) {
  if (typeof text !== 'string') return text
  return text
    .replace(SCRIPT_BLOCK_PATTERN, '')      // Remove <script>...</script> blocks entirely
    .replace(DANGEROUS_TAG_PATTERN, '')      // Remove remaining dangerous tags
    .replace(EVENT_HANDLER_PATTERN, '')      // Remove event handlers like onclick="..."
    .replace(JS_PROTOCOL_PATTERN, '')        // Remove javascript: protocol
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // control chars except \t \n \r
    .trim()
}

// Validate and sanitize request body fields
export function sanitizeBody(body, fields) {
  if (!body || typeof body !== 'object') return body
  const sanitized = { ...body }
  for (const field of fields) {
    if (typeof sanitized[field] === 'string') {
      sanitized[field] = sanitizeTextInput(sanitized[field])
    }
  }
  return sanitized
}

// ========== PII MASKING FOR LOGS ==========
export function maskPII(data) {
  if (!data || typeof data !== 'object') return data
  const masked = { ...data }
  // Mask phone numbers: show last 4 digits only
  if (masked.phone) masked.phone = `****${String(masked.phone).slice(-4)}`
  // Never log tokens
  if (masked.token) masked.token = '***REDACTED***'
  if (masked.accessToken) masked.accessToken = '***REDACTED***'
  if (masked.refreshToken) masked.refreshToken = '***REDACTED***'
  // Never log PINs
  if (masked.pin) masked.pin = '****'
  if (masked.currentPin) masked.currentPin = '****'
  if (masked.newPin) masked.newPin = '****'
  if (masked.pinHash) masked.pinHash = '***REDACTED***'
  if (masked.pinSalt) masked.pinSalt = '***REDACTED***'
  return masked
}

// ========== SECURITY AUDIT LOGGER ==========
// Structured security event logging — writes to audit_logs with security-specific schema
export async function writeSecurityAudit(db, event) {
  const entry = {
    id: event.id || crypto.randomUUID(),
    category: 'SECURITY',
    eventType: event.eventType,
    actorId: event.actorId || null,
    targetType: event.targetType || null,
    targetId: event.targetId || null,
    ip: event.ip || null,
    userAgent: event.userAgent ? String(event.userAgent).slice(0, 200) : null,
    metadata: maskPII(event.metadata || {}),
    severity: event.severity || 'INFO', // INFO, WARN, CRITICAL
    createdAt: new Date(),
  }
  try {
    await db.collection('audit_logs').insertOne(entry)
  } catch (e) {
    // Audit logging failure must NOT break the request
    console.error('[SECURITY_AUDIT_WRITE_FAIL]', e.message)
  }
  return entry
}

// ========== PAYLOAD SIZE CHECK ==========
const MAX_JSON_BODY_SIZE = 1_048_576 // 1MB for JSON payloads (media handled separately)

export function checkPayloadSize(request) {
  const contentLength = request.headers.get('content-length')
  if (contentLength && parseInt(contentLength) > MAX_JSON_BODY_SIZE) {
    // Media upload routes are exempted (handled by their own limits)
    return false
  }
  return true
}

// ========== REQUEST IP EXTRACTION ==========
export function extractIP(request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
}
