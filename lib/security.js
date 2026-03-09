// ========== TRIBE SECURITY MODULE (Stage 2 + Stage 3 Observability) ==========
// Redis-backed per-user + per-IP + per-endpoint rate limiting
// Security headers
// Input sanitization (centralized deep sanitization)
// PII masking for logs
// Unified canonical audit pipeline

import { ErrorCode } from './constants.js'
import logger from './logger.js'
import metrics from './metrics.js'
import { getRequestContext } from './request-context.js'

// ========== RATE LIMIT TIERS ==========
// redisDownPolicy per tier:
//   STRICT   = 50% of max limit + WARN every hit (AUTH, SENSITIVE)
//   DEGRADED = normal limit + periodic WARN (WRITE, SOCIAL, ADMIN)
//   OPEN     = normal limit + periodic INFO (READ, GLOBAL)
export const RateLimitTier = {
  AUTH:        { windowMs: 60_000, max: 10,  name: 'AUTH',       redisDownPolicy: 'STRICT' },
  WRITE:       { windowMs: 60_000, max: 30,  name: 'WRITE',     redisDownPolicy: 'DEGRADED' },
  READ:        { windowMs: 60_000, max: 120, name: 'READ',      redisDownPolicy: 'OPEN' },
  ADMIN:       { windowMs: 60_000, max: 60,  name: 'ADMIN',     redisDownPolicy: 'DEGRADED' },
  SOCIAL:      { windowMs: 60_000, max: 40,  name: 'SOCIAL',    redisDownPolicy: 'DEGRADED' },
  SENSITIVE:   { windowMs: 60_000, max: 5,   name: 'SENSITIVE', redisDownPolicy: 'STRICT' },
  GLOBAL:      { windowMs: 60_000, max: 500, name: 'GLOBAL',    redisDownPolicy: 'OPEN' },
}

// ========== ENDPOINT → TIER MAPPING ==========
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

// ========== REDIS RATE LIMITER ==========
let rlRedis = null
let rlRedisReady = false
let rlRedisInitialized = false

// Lua script: atomic INCR + set PEXPIRE on first use
const RL_LUA_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return current
`

async function initRateLimitRedis() {
  if (rlRedisInitialized) return rlRedisReady
  rlRedisInitialized = true

  try {
    const Redis = (await import('ioredis')).default
    rlRedis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy: (times) => {
        if (times > 10) return null // Give up after 10 retries
        return Math.min(times * 1000, 30000) // Exponential backoff, max 30s
      },
    })

    // Set up event handlers BEFORE connecting (prevents unhandled error events)
    rlRedis.on('error', () => { rlRedisReady = false })
    rlRedis.on('close', () => {
      if (rlRedisReady) {
        rlRedisReady = false
        logger.warn('RATE_LIMIT', 'redis_disconnected', { message: 'Rate limiting falling back to in-memory' })
        metrics.recordDependencyEvent('redis', 'disconnected')
      }
    })
    rlRedis.on('ready', () => {
      const wasDown = !rlRedisReady
      rlRedisReady = true
      if (wasDown) {
        logger.info('RATE_LIMIT', 'redis_recovered', { message: 'Rate limiting restored to Redis backend' })
        metrics.recordDependencyEvent('redis', 'recovered')
      }
    })

    await rlRedis.connect()
    rlRedisReady = true

    logger.info('RATE_LIMIT', 'redis_connected', { backend: 'redis' })
    return true
  } catch (e) {
    rlRedisReady = false
    logger.warn('RATE_LIMIT', 'redis_unavailable', {
      error: e.message,
      fallback: 'in-memory (per-instance)',
    })
    return false
  }
}

// In-memory fallback store (used when Redis is down)
const memStores = { ip: new Map(), user: new Map() }

// Cleanup stale in-memory entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const store of [memStores.ip, memStores.user]) {
    for (const [key, entry] of store) {
      if (now - entry.windowStart > 5 * 60_000) store.delete(key)
    }
  }
}, 5 * 60_000)

// Degraded logging throttle (avoid log spam per tier)
const degradedLogTimes = new Map()
function shouldLogDegraded(tierName, policy) {
  if (policy === 'STRICT') return true // Always log for strict tiers
  const now = Date.now()
  const last = degradedLogTimes.get(tierName) || 0
  if (now - last > 60_000) { // Once per minute for DEGRADED/OPEN
    degradedLogTimes.set(tierName, now)
    return true
  }
  return false
}

// ========== TIERED RATE LIMITER (Redis-backed with explicit fallback) ==========
export async function checkTieredRateLimit(ip, userId, tier) {
  await initRateLimitRedis()

  const identifier = ip || userId
  const type = ip ? 'ip' : 'user'
  const redisKey = `rl:${tier.name}:${type}:${identifier}`

  // Try Redis first
  if (rlRedisReady) {
    try {
      const count = await rlRedis.eval(RL_LUA_SCRIPT, 1, redisKey, tier.windowMs)

      if (count > tier.max) {
        metrics.recordRateLimitHit(tier.name, type)
        logger.warn('RATE_LIMIT', 'limit_exceeded', {
          tier: tier.name, type,
          identifier: type === 'ip' ? ip : '***masked***',
          count, max: tier.max, backend: 'redis',
        })
        return {
          allowed: false,
          retryAfter: Math.ceil(tier.windowMs / 1000),
          limitedBy: type,
          tier: tier.name,
          backend: 'redis',
        }
      }

      return { allowed: true, backend: 'redis' }
    } catch (e) {
      // Redis call failed — fall through to in-memory with explicit logging
      metrics.recordDependencyEvent('redis', 'rate_limit_error')
      if (shouldLogDegraded(tier.name, tier.redisDownPolicy)) {
        logger.warn('RATE_LIMIT', 'redis_fallback', {
          tier: tier.name, error: e.message,
          policy: tier.redisDownPolicy,
        })
      }
    }
  } else {
    // Redis not available at all
    if (shouldLogDegraded(tier.name, tier.redisDownPolicy)) {
      logger.warn('RATE_LIMIT', 'redis_down_fallback', {
        tier: tier.name, policy: tier.redisDownPolicy,
        backend: 'memory',
      })
    }
  }

  // ========== IN-MEMORY FALLBACK (explicitly degraded) ==========
  metrics.recordDependencyEvent('redis', 'rate_limit_fallback')

  const store = type === 'ip' ? memStores.ip : memStores.user
  const memKey = `${identifier}:${tier.name}`
  const now = Date.now()

  // Apply policy-based limit adjustment
  let effectiveMax = tier.max
  if (tier.redisDownPolicy === 'STRICT') {
    effectiveMax = Math.ceil(tier.max * 0.5) // 50% limit for STRICT tiers when Redis is down
  }

  const entry = store.get(memKey)
  if (entry && now - entry.windowStart < tier.windowMs) {
    entry.count++
    if (entry.count > effectiveMax) {
      metrics.recordRateLimitHit(tier.name, type)
      logger.warn('RATE_LIMIT', 'limit_exceeded', {
        tier: tier.name, type,
        count: entry.count, max: effectiveMax,
        backend: 'memory', degraded: true,
        policy: tier.redisDownPolicy,
      })
      return {
        allowed: false,
        retryAfter: Math.ceil((tier.windowMs - (now - entry.windowStart)) / 1000),
        limitedBy: type,
        tier: tier.name,
        backend: 'memory',
        degraded: true,
        policy: tier.redisDownPolicy,
      }
    }
  } else {
    store.set(memKey, { windowStart: now, count: 1 })
  }

  return { allowed: true, backend: 'memory', degraded: true }
}

// ========== RATE LIMITER STATUS (for health checks) ==========
export function getRateLimiterStatus() {
  return {
    backend: rlRedisReady ? 'redis' : 'memory',
    redisConnected: rlRedisReady,
    redisInitialized: rlRedisInitialized,
    memoryEntries: {
      ip: memStores.ip.size,
      user: memStores.user.size,
    },
    policy: 'Redis primary, in-memory fallback with policy-based limits',
    tierPolicies: Object.fromEntries(
      Object.entries(RateLimitTier).map(([k, v]) => [k, {
        max: v.max,
        windowMs: v.windowMs,
        redisDownPolicy: v.redisDownPolicy,
        effectiveMaxWhenDegraded: v.redisDownPolicy === 'STRICT' ? Math.ceil(v.max * 0.5) : v.max,
      }])
    ),
  }
}

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
const SCRIPT_BLOCK_PATTERN = /<script[^>]*>[\s\S]*?<\/script>/gi
const STYLE_BLOCK_PATTERN = /<style[^>]*>[\s\S]*?<\/style>/gi
const ALL_HTML_TAGS = /<\/?[a-z][a-z0-9]*[^>]*>/gi
const EVENT_HANDLER_PATTERN = /\bon\w+\s*=[^\s>]*/gi
const JS_PROTOCOL_PATTERN = /javascript\s*:/gi

export function sanitizeTextInput(text) {
  if (typeof text !== 'string') return text
  return text
    .replace(SCRIPT_BLOCK_PATTERN, '')
    .replace(STYLE_BLOCK_PATTERN, '')
    .replace(ALL_HTML_TAGS, '')
    .replace(EVENT_HANDLER_PATTERN, '')
    .replace(JS_PROTOCOL_PATTERN, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .trim()
}

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

// ========== DEEP STRING SANITIZATION ==========
export function deepSanitizeStrings(obj) {
  if (typeof obj === 'string') return sanitizeTextInput(obj)
  if (Array.isArray(obj)) return obj.map(deepSanitizeStrings)
  if (obj !== null && typeof obj === 'object') {
    const result = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = deepSanitizeStrings(value)
    }
    return result
  }
  return obj
}

// ========== PII MASKING FOR AUDIT LOGS ==========
export function maskPII(data) {
  if (!data || typeof data !== 'object') return data
  const masked = { ...data }
  if (masked.phone) masked.phone = `****${String(masked.phone).slice(-4)}`
  if (masked.token) masked.token = '***REDACTED***'
  if (masked.accessToken) masked.accessToken = '***REDACTED***'
  if (masked.refreshToken) masked.refreshToken = '***REDACTED***'
  if (masked.pin) masked.pin = '****'
  if (masked.currentPin) masked.currentPin = '****'
  if (masked.newPin) masked.newPin = '****'
  if (masked.pinHash) masked.pinHash = '***REDACTED***'
  if (masked.pinSalt) masked.pinSalt = '***REDACTED***'
  return masked
}

// ========== CANONICAL AUDIT LOGGER (Stage 3B: Auto-reads request context) ==========
// This is the ONE canonical audit write path. Both the old writeAudit (auth-utils.js)
// and writeSecurityAudit route through this function.
//
// Request lineage: requestId and ip are auto-read from AsyncLocalStorage
// if not explicitly provided. This means ALL audit entries get correlation
// data without changing any handler signatures.
export async function writeSecurityAudit(db, event) {
  const ctx = getRequestContext()
  const entry = {
    id: event.id || crypto.randomUUID(),
    category: event.category || 'SECURITY',
    eventType: event.eventType,
    actorId: event.actorId || null,
    targetType: event.targetType || null,
    targetId: event.targetId || null,
    ip: event.ip || ctx.ip || null,
    userAgent: event.userAgent ? String(event.userAgent).slice(0, 200) : null,
    requestId: event.requestId || ctx.requestId || null,
    route: ctx.route || null,
    method: ctx.method || null,
    metadata: maskPII(event.metadata || {}),
    severity: event.severity || 'INFO',
    createdAt: new Date(),
  }
  try {
    await db.collection('audit_logs').insertOne(entry)
  } catch (e) {
    // Audit logging failure must NOT break the request — log to structured logger instead
    logger.error('AUDIT', 'audit_write_fail', {
      error: e.message,
      eventType: entry.eventType,
      actorId: entry.actorId,
    })
  }
  return entry
}

// ========== PAYLOAD SIZE CHECK ==========
const MAX_JSON_BODY_SIZE = 1_048_576

export function checkPayloadSize(request) {
  const contentLength = request.headers.get('content-length')
  if (contentLength && parseInt(contentLength) > MAX_JSON_BODY_SIZE) {
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
