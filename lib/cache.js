/**
 * Tribe — Production Redis Cache Layer
 * 
 * Distributed cache with TTL, stampede protection, versioned keys,
 * event-driven invalidation, and hot-key control.
 * 
 * Features:
 * - Redis-backed (survives restarts, scales across instances)
 * - Stampede protection via SETNX lock
 * - Versioned keys (bump VERSION on schema changes)
 * - Event-driven invalidation matrix
 * - TTL jitter for hot-key protection (±20%)
 * - Fallback to in-memory on Redis failure
 */

import Redis from 'ioredis'

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379'
const VERSION = 'v1'

// ========== REDIS CLIENT ==========
let redis = null
let redisReady = false
const fallbackStore = new Map()  // in-memory fallback

function getRedis() {
  if (!redis) {
    // Skip Redis entirely if no REDIS_URL is configured
    if (!process.env.REDIS_URL) {
      return null
    }
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy(times) {
        if (times > 3) return null // Stop retrying after 3 attempts
        return Math.min(times * 1000, 5000)
      },
    })
    redis.on('ready', () => { redisReady = true })
    redis.on('error', () => { redisReady = false }) // Silent — no console spam
    redis.on('close', () => { redisReady = false })
    redis.on('reconnecting', () => { redisReady = false })
    redis.connect().catch(() => {}) // Attempt connection, fail silently
  }
  return redis
}

// ========== STATS ==========
const stats = { hits: 0, misses: 0, sets: 0, invalidations: 0, redisErrors: 0, fallbackHits: 0 }

// ========== HELPERS ==========
function makeKey(namespace, id) {
  return `${VERSION}:${namespace}:${id || 'default'}`
}

function jitterTTL(ttlMs) {
  // ±20% jitter to prevent thundering herd on popular keys
  const jitter = ttlMs * 0.2 * (Math.random() * 2 - 1)
  return Math.round(ttlMs + jitter)
}

// ========== CACHE OPERATIONS ==========

async function cacheGet(namespace, id) {
  const key = makeKey(namespace, id)
  try {
    const r = getRedis()
    if (redisReady) {
      const val = await r.get(key)
      if (val) {
        stats.hits++
        return JSON.parse(val)
      }
      stats.misses++
      return null
    }
  } catch {
    stats.redisErrors++
  }
  // Fallback to in-memory
  const entry = fallbackStore.get(key)
  if (entry && Date.now() < entry.expiresAt) {
    stats.hits++
    stats.fallbackHits++
    return entry.value
  }
  if (entry) fallbackStore.delete(key)
  stats.misses++
  return null
}

async function cacheSet(namespace, id, value, ttlMs) {
  const key = makeKey(namespace, id)
  const jitteredTTL = jitterTTL(ttlMs)
  try {
    const r = getRedis()
    if (redisReady) {
      await r.set(key, JSON.stringify(value), 'PX', jitteredTTL)
      stats.sets++
      return
    }
  } catch {
    stats.redisErrors++
  }
  // Fallback
  fallbackStore.set(key, { value, expiresAt: Date.now() + jitteredTTL })
  stats.sets++
}

// Stampede-safe: only one caller computes, others get result
const computeLocks = new Map()

async function cacheGetOrCompute(namespace, id, computeFn, ttlMs) {
  const cached = await cacheGet(namespace, id)
  if (cached !== null) return cached

  const key = makeKey(namespace, id)

  if (computeLocks.has(key)) {
    return computeLocks.get(key)
  }

  const promise = (async () => {
    try {
      // Try to acquire Redis lock for stampede protection
      const lockKey = `lock:${key}`
      try {
        const r = getRedis()
        if (redisReady) {
          const acquired = await r.set(lockKey, '1', 'PX', 5000, 'NX')
          if (!acquired) {
            // Another instance is computing; wait and read
            await new Promise(resolve => setTimeout(resolve, 100))
            const result = await cacheGet(namespace, id)
            if (result !== null) return result
          }
        }
      } catch { /* proceed without lock */ }

      const result = await computeFn()
      await cacheSet(namespace, id, result, ttlMs)
      return result
    } finally {
      computeLocks.delete(key)
    }
  })()

  computeLocks.set(key, promise)
  return promise
}

async function cacheInvalidate(namespace, id) {
  stats.invalidations++
  if (id) {
    const key = makeKey(namespace, id)
    try {
      const r = getRedis()
      if (redisReady) { await r.del(key) }
    } catch { stats.redisErrors++ }
    fallbackStore.delete(key)
  } else {
    // Invalidate all keys in namespace
    const prefix = `${VERSION}:${namespace}:`
    try {
      const r = getRedis()
      if (redisReady) {
        const keys = await r.keys(`${prefix}*`)
        if (keys.length > 0) await r.del(...keys)
      }
    } catch { stats.redisErrors++ }
    for (const key of fallbackStore.keys()) {
      if (key.startsWith(prefix)) fallbackStore.delete(key)
    }
  }
}

async function cacheInvalidatePattern(pattern) {
  stats.invalidations++
  try {
    const r = getRedis()
    if (redisReady) {
      const keys = await r.keys(`${VERSION}:*${pattern}*`)
      if (keys.length > 0) await r.del(...keys)
    }
  } catch { stats.redisErrors++ }
  for (const key of fallbackStore.keys()) {
    if (key.includes(pattern)) fallbackStore.delete(key)
  }
}

async function getCacheStats() {
  const total = stats.hits + stats.misses
  let redisInfo = { status: 'disconnected', keys: 0 }
  try {
    const r = getRedis()
    if (redisReady) {
      const dbSize = await r.dbsize()
      redisInfo = { status: 'connected', keys: dbSize }
    }
  } catch { /* ignore */ }

  return {
    ...stats,
    hitRate: total > 0 ? (stats.hits / total * 100).toFixed(1) + '%' : '0%',
    redis: redisInfo,
    fallbackSize: fallbackStore.size,
    locksActive: computeLocks.size,
  }
}

// ========== TTL CONSTANTS (ms) ==========
export const CacheTTL = {
  PUBLIC_FEED: 15_000,
  COLLEGE_FEED: 30_000,
  HOUSE_FEED: 30_000,
  REELS_FEED: 30_000,
  HOUSE_LEADERBOARD: 60_000,
  HOUSES_LIST: 300_000,
  COLLEGE_SEARCH: 600_000,
  ADMIN_STATS: 30_000,
  USER_PROFILE: 60_000,
  CONSENT_NOTICE: 3600_000,
  RESOURCE_SEARCH: 30_000,
  RESOURCE_DETAIL: 60_000,
  STORY_FEED: 10_000,
  STORY_DETAIL: 15_000,
}

export const CacheNS = {
  PUBLIC_FEED: 'feed:public',
  COLLEGE_FEED: 'feed:college',
  HOUSE_FEED: 'feed:house',
  REELS_FEED: 'feed:reels',
  HOUSE_LEADERBOARD: 'house:leaderboard',
  HOUSES_LIST: 'house:list',
  COLLEGE_SEARCH: 'college:search',
  ADMIN_STATS: 'admin:stats',
  USER_PROFILE: 'user:profile',
  CONSENT_NOTICE: 'legal:consent',
  RESOURCE_SEARCH: 'resource:search',
  RESOURCE_DETAIL: 'resource:detail',
  STORY_FEED: 'story:feed',
  STORY_DETAIL: 'story:detail',
}

// ========== EVENT-DRIVEN INVALIDATION ==========
export async function invalidateOnEvent(event, context = {}) {
  switch (event) {
    case 'POST_CREATED':
    case 'POST_DELETED':
      await cacheInvalidate(CacheNS.PUBLIC_FEED)
      await cacheInvalidate(CacheNS.ADMIN_STATS)
      if (context.collegeId) await cacheInvalidate(CacheNS.COLLEGE_FEED, context.collegeId)
      if (context.tribeId) await cacheInvalidate(CacheNS.HOUSE_FEED, context.tribeId)
      if (context.kind === 'REEL') await cacheInvalidate(CacheNS.REELS_FEED)
      break

    case 'FOLLOW_CHANGED':
      if (context.userId) await cacheInvalidate(CacheNS.USER_PROFILE, context.userId)
      if (context.targetId) await cacheInvalidate(CacheNS.USER_PROFILE, context.targetId)
      break

    case 'REPORT_CREATED':
    case 'MODERATION_ACTION':
      await cacheInvalidate(CacheNS.PUBLIC_FEED)
      await cacheInvalidate(CacheNS.ADMIN_STATS)
      break

    case 'STRIKE_ISSUED':
    case 'USER_SUSPENDED':
      if (context.userId) await cacheInvalidate(CacheNS.USER_PROFILE, context.userId)
      await cacheInvalidate(CacheNS.ADMIN_STATS)
      break

    case 'HOUSE_POINTS_CHANGED':
    case 'LEADERBOARD_CHANGED':
      await cacheInvalidate(CacheNS.HOUSE_LEADERBOARD)
      await cacheInvalidate(CacheNS.HOUSES_LIST)
      break

    case 'RESOURCE_CHANGED':
      await cacheInvalidate(CacheNS.RESOURCE_SEARCH)
      if (context.resourceId) await cacheInvalidate(CacheNS.RESOURCE_DETAIL, context.resourceId)
      break

    case 'STORY_CHANGED':
      await cacheInvalidate(CacheNS.STORY_FEED)
      if (context.storyId) await cacheInvalidate(CacheNS.STORY_DETAIL, context.storyId)
      break
  }
}

// ========== EXPORTS ==========
export const cache = {
  get: cacheGet,
  set: cacheSet,
  getOrCompute: cacheGetOrCompute,
  invalidate: cacheInvalidate,
  invalidatePattern: cacheInvalidatePattern,
  getStats: getCacheStats,
}
export default cache
