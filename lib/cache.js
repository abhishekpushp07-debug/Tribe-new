/**
 * Tribe — World-Class Distributed Cache Layer
 * 
 * 3-tier cache architecture:
 *   Tier 1: In-memory LRU (0ms, per-instance, hot data)
 *   Tier 2: MongoDB TTL cache (5-10ms, distributed, shared across replicas)
 *   Tier 3: Redis (1-3ms, if available — optional)
 * 
 * Why MongoDB cache? Instagram/Meta use distributed caching with DB fallback.
 * MongoDB TTL indexes auto-expire documents. Zero maintenance. Works everywhere.
 * When Redis is available, it's used as Tier 3 (fastest distributed).
 * When Redis is down, MongoDB cache keeps replicas in sync.
 */

import Redis from 'ioredis'

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379'
const VERSION = 'v2'

// ========== CIRCUIT BREAKER ==========
const circuitBreaker = {
  failures: 0,
  threshold: 5,          // Open after 5 consecutive failures
  resetTimeout: 30_000,  // Try again after 30s
  lastFailure: 0,
  state: 'CLOSED',       // CLOSED → OPEN → HALF_OPEN → CLOSED

  recordFailure() {
    this.failures++
    this.lastFailure = Date.now()
    if (this.failures >= this.threshold) {
      this.state = 'OPEN'
      console.warn(`[CACHE] Circuit breaker OPEN — Redis failures: ${this.failures}`)
    }
  },

  recordSuccess() {
    if (this.state !== 'CLOSED') {
      console.log(`[CACHE] Circuit breaker CLOSED — Redis recovered`)
    }
    this.failures = 0
    this.state = 'CLOSED'
  },

  canAttempt() {
    if (this.state === 'CLOSED') return true
    if (this.state === 'OPEN' && Date.now() - this.lastFailure > this.resetTimeout) {
      this.state = 'HALF_OPEN'
      return true
    }
    return this.state === 'HALF_OPEN'
  },
}

// ========== REDIS CONNECTION POOL ==========
let redis = null
let redisReady = false
const fallbackStore = new Map()

function getRedis() {
  if (!circuitBreaker.canAttempt()) return null

  if (!redis) {
    if (!process.env.REDIS_URL) return null
    redis = new Redis(REDIS_URL, {
      // Connection pooling
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 3000,
      commandTimeout: 2000,
      keepAlive: 10000,
      // Pool settings via ioredis lazy connections
      lazyConnect: false,
      enableReadyCheck: true,
      // Retry with exponential backoff
      retryStrategy(times) {
        if (times > 10) return null // Stop retrying after 10 attempts
        return Math.min(times * 200, 5000)
      },
      reconnectOnError(err) {
        // Only reconnect on connection-type errors
        return err.message.includes('READONLY') || err.message.includes('ECONNREFUSED')
      },
    })
    redis.on('ready', () => {
      redisReady = true
      circuitBreaker.recordSuccess()
      console.log('[CACHE] Redis connected (pooled)')
    })
    redis.on('error', () => { redisReady = false })
    redis.on('close', () => { redisReady = false })
    redis.on('reconnecting', () => { redisReady = false })
  }
  return redis
}

// ========== MONGODB DISTRIBUTED CACHE (Tier 2) ==========
let _mongoCacheDb = null
let _mongoCacheReady = false

async function getMongoCacheDb() {
  if (_mongoCacheReady) return _mongoCacheDb
  try {
    const { getDb } = await import('./db.js')
    _mongoCacheDb = await getDb()
    if (_mongoCacheDb) {
      // Ensure TTL index — auto-deletes expired documents
      await _mongoCacheDb.collection('_cache').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {})
      await _mongoCacheDb.collection('_cache').createIndex({ key: 1 }, { unique: true }).catch(() => {})
      _mongoCacheReady = true
    }
  } catch {}
  return _mongoCacheDb
}

// ========== STATS ==========
const stats = {
  hits: 0, misses: 0, sets: 0, invalidations: 0,
  redisErrors: 0, fallbackHits: 0, mongoHits: 0, mongoSets: 0,
  circuitBreakerTrips: 0, pipelineOps: 0,
}

// ========== HELPERS ==========
function makeKey(namespace, id) {
  return `${VERSION}:${namespace}:${id || 'default'}`
}

function jitterTTL(ttlMs) {
  const jitter = ttlMs * 0.2 * (Math.random() * 2 - 1)
  return Math.round(ttlMs + jitter)
}

// ========== CACHE OPERATIONS ==========

async function cacheGet(namespace, id) {
  const key = makeKey(namespace, id)

  // Tier 1: In-memory (0ms)
  const memEntry = fallbackStore.get(key)
  if (memEntry && Date.now() < memEntry.expiresAt) {
    stats.hits++
    stats.fallbackHits++
    return memEntry.value
  }
  if (memEntry) fallbackStore.delete(key)

  // Tier 2: Redis (1-3ms, if available)
  try {
    const r = getRedis()
    if (r && redisReady) {
      const val = await r.get(key)
      if (val) {
        stats.hits++
        circuitBreaker.recordSuccess()
        const parsed = JSON.parse(val)
        // Promote to Tier 1
        fallbackStore.set(key, { value: parsed, expiresAt: Date.now() + 30000 })
        return parsed
      }
    }
  } catch {
    stats.redisErrors++
    circuitBreaker.recordFailure()
  }

  // Tier 3: MongoDB distributed cache (5-10ms)
  try {
    const db = await getMongoCacheDb()
    if (db) {
      const doc = await db.collection('_cache').findOne({ key, expiresAt: { $gt: new Date() } })
      if (doc) {
        stats.hits++
        stats.mongoHits++
        // Promote to Tier 1
        fallbackStore.set(key, { value: doc.value, expiresAt: Date.now() + 30000 })
        return doc.value
      }
    }
  } catch {}

  stats.misses++
  return null
}

async function cacheSet(namespace, id, value, ttlMs) {
  const key = makeKey(namespace, id)
  const jitteredTTL = jitterTTL(ttlMs)

  // Tier 1: In-memory (always)
  fallbackStore.set(key, { value, expiresAt: Date.now() + jitteredTTL })
  stats.sets++
  if (fallbackStore.size > 5000) {
    const keysToDelete = [...fallbackStore.keys()].slice(0, 1000)
    keysToDelete.forEach(k => fallbackStore.delete(k))
  }

  // Tier 2: Redis (if available)
  try {
    const r = getRedis()
    if (r && redisReady) {
      await r.set(key, JSON.stringify(value), 'PX', jitteredTTL)
      circuitBreaker.recordSuccess()
    }
  } catch {
    stats.redisErrors++
    circuitBreaker.recordFailure()
  }

  // Tier 3: MongoDB distributed cache (fire-and-forget, non-blocking)
  ;(async () => {
    try {
      const db = await getMongoCacheDb()
      if (db) {
        await db.collection('_cache').updateOne(
          { key },
          { $set: { key, value, expiresAt: new Date(Date.now() + jitteredTTL), updatedAt: new Date() } },
          { upsert: true }
        )
        stats.mongoSets++
      }
    } catch {}
  })()
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
        if (r && redisReady) {
          const acquired = await r.set(lockKey, '1', 'PX', 5000, 'NX')
          if (!acquired) {
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
      if (r && redisReady) { await r.del(key) }
    } catch { stats.redisErrors++ }
    fallbackStore.delete(key)
  } else {
    // Invalidate all keys in namespace using SCAN (production-safe, no KEYS in hot path)
    const prefix = `${VERSION}:${namespace}:`
    try {
      const r = getRedis()
      if (r && redisReady) {
        let cursor = '0'
        do {
          const [nextCursor, keys] = await r.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 100)
          cursor = nextCursor
          if (keys.length > 0) await r.del(...keys)
        } while (cursor !== '0')
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
    if (r && redisReady) {
      let cursor = '0'
      do {
        const [nextCursor, keys] = await r.scan(cursor, 'MATCH', `${VERSION}:*${pattern}*`, 'COUNT', 100)
        cursor = nextCursor
        if (keys.length > 0) await r.del(...keys)
      } while (cursor !== '0')
    }
  } catch { stats.redisErrors++ }
  for (const key of fallbackStore.keys()) {
    if (key.includes(pattern)) fallbackStore.delete(key)
  }
}

/**
 * Pipeline: batch multiple cache operations in one round-trip
 * Usage: await cachePipeline([ ['set', ns, id, val, ttl], ['invalidate', ns, id] ])
 */
async function cachePipeline(operations) {
  try {
    const r = getRedis()
    if (!r || !redisReady) return
    const pipe = r.pipeline()
    for (const [op, namespace, id, value, ttlMs] of operations) {
      const key = makeKey(namespace, id)
      if (op === 'set') {
        pipe.set(key, JSON.stringify(value), 'PX', jitterTTL(ttlMs))
      } else if (op === 'del' || op === 'invalidate') {
        pipe.del(key)
      }
    }
    await pipe.exec()
    stats.pipelineOps += operations.length
    circuitBreaker.recordSuccess()
  } catch {
    stats.redisErrors++
    circuitBreaker.recordFailure()
  }
}

async function getCacheStats() {
  const total = stats.hits + stats.misses
  let redisInfo = { status: 'disconnected', keys: 0, memory: '0B' }
  try {
    const r = getRedis()
    if (r && redisReady) {
      const [dbSize, info] = await Promise.all([
        r.dbsize(),
        r.info('memory').catch(() => ''),
      ])
      const memMatch = info.match(/used_memory_human:(.+)/)
      redisInfo = {
        status: 'connected',
        keys: dbSize,
        memory: memMatch ? memMatch[1].trim() : 'unknown',
      }
    }
  } catch { /* ignore */ }

  return {
    ...stats,
    hitRate: total > 0 ? (stats.hits / total * 100).toFixed(1) + '%' : '0%',
    redis: redisInfo,
    circuitBreaker: {
      state: circuitBreaker.state,
      failures: circuitBreaker.failures,
    },
    fallbackSize: fallbackStore.size,
    locksActive: computeLocks.size,
  }
}

// ========== TTL CONSTANTS (ms) ==========
export const CacheTTL = {
  SHORT: 10_000,
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
  // World-class TTLs
  REEL_FEED: 15_000,
  REEL_DETAIL: 30_000,
  TRIBE_LEADERBOARD: 60_000,
  TRIBE_STANDINGS: 60_000,
  TRIBE_STATS: 30_000,
  TRIBE_LIST: 120_000,
  TRIBE_DETAIL: 60_000,
  TRIBE_RIVALRIES: 15_000,
  SEARCH_RESULTS: 20_000,
  SEARCH_AUTOCOMPLETE: 15_000,
  SEARCH_HASHTAGS: 30_000,
  ANALYTICS_OVERVIEW: 60_000,
  ANALYTICS_CONTENT: 60_000,
  ANALYTICS_AUDIENCE: 120_000,
  ANALYTICS_REACH: 60_000,
  EXPLORE_PAGE: 30_000,
  TRENDING: 30_000,
  NOTIFICATIONS: 10_000,
  POST_DETAIL: 30_000,
  CONTEST_LIST: 30_000,
  CONTEST_DETAIL: 30_000,
  COMMENT_LIST: 15_000,
}

export const CacheNS = {
  FEED: 'feed:home',
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
  // World-class namespaces
  REEL_FEED: 'reel:feed',
  REEL_DETAIL: 'reel:detail',
  TRIBE_LEADERBOARD: 'tribe:leaderboard',
  TRIBE_STANDINGS: 'tribe:standings',
  TRIBE_STATS: 'tribe:stats',
  TRIBE_LIST: 'tribe:list',
  TRIBE_DETAIL: 'tribe:detail',
  TRIBE_RIVALRIES: 'tribe:rivalries',
  SEARCH_RESULTS: 'search:results',
  SEARCH_AUTOCOMPLETE: 'search:autocomplete',
  SEARCH_HASHTAGS: 'search:hashtags',
  ANALYTICS_OVERVIEW: 'analytics:overview',
  ANALYTICS_CONTENT: 'analytics:content',
  ANALYTICS_AUDIENCE: 'analytics:audience',
  ANALYTICS_REACH: 'analytics:reach',
  EXPLORE_PAGE: 'explore:page',
  TRENDING: 'trending',
  NOTIFICATIONS: 'notifications',
  POST_DETAIL: 'post:detail',
  CONTEST_LIST: 'contest:list',
  CONTEST_DETAIL: 'contest:detail',
  COMMENT_LIST: 'comment:list',
}

// ========== COMPREHENSIVE EVENT-DRIVEN INVALIDATION MATRIX ==========
export async function invalidateOnEvent(event, context = {}) {
  // Use pipeline for multi-invalidation efficiency
  const invalidations = []

  switch (event) {
    // ---- Content Write Operations ----
    case 'POST_CREATED':
    case 'POST_UPDATED':
    case 'POST_DELETED':
      invalidations.push([CacheNS.FEED], [CacheNS.PUBLIC_FEED], [CacheNS.ADMIN_STATS])
      if (context.collegeId) invalidations.push([CacheNS.COLLEGE_FEED, context.collegeId])
      if (context.tribeId) invalidations.push([CacheNS.HOUSE_FEED, context.tribeId])
      if (context.kind === 'REEL') invalidations.push([CacheNS.REELS_FEED], [CacheNS.REEL_FEED])
      if (context.contentId) invalidations.push([CacheNS.POST_DETAIL, context.contentId])
      if (context.authorId) invalidations.push([CacheNS.USER_PROFILE, context.authorId])
      break

    // ---- Comment Operations ----
    case 'COMMENT_CREATED':
    case 'COMMENT_DELETED':
      if (context.contentId) invalidations.push([CacheNS.COMMENT_LIST, context.contentId], [CacheNS.POST_DETAIL, context.contentId])
      break

    // ---- Like/Save/Share Operations ----
    case 'LIKE_TOGGLED':
    case 'SAVE_TOGGLED':
    case 'SHARE_CREATED':
      if (context.contentId) invalidations.push([CacheNS.POST_DETAIL, context.contentId])
      if (context.kind === 'REEL' && context.contentId) invalidations.push([CacheNS.REEL_DETAIL, context.contentId])
      break

    // ---- Social Graph ----
    case 'FOLLOW_CHANGED':
      if (context.userId) invalidations.push([CacheNS.USER_PROFILE, context.userId])
      if (context.targetId) invalidations.push([CacheNS.USER_PROFILE, context.targetId])
      break

    // ---- Tribe Operations ----
    case 'TRIBE_UPDATED':
    case 'TRIBE_CHEER':
    case 'TRIBE_SALUTE':
      invalidations.push([CacheNS.TRIBE_LIST], [CacheNS.TRIBE_STANDINGS])
      if (context.tribeId) invalidations.push([CacheNS.TRIBE_DETAIL, context.tribeId])
      break

    case 'TRIBE_MEMBER_CHANGED':
      invalidations.push([CacheNS.TRIBE_LIST])
      if (context.tribeId) invalidations.push([CacheNS.TRIBE_DETAIL, context.tribeId])
      if (context.userId) invalidations.push([CacheNS.USER_PROFILE, context.userId])
      break

    // ---- Rivalry Operations ----
    case 'RIVALRY_CREATED':
    case 'RIVALRY_RESOLVED':
    case 'RIVALRY_CONTRIBUTION':
    case 'RIVALRY_CANCELLED':
      invalidations.push([CacheNS.TRIBE_RIVALRIES])
      if (context.challengerTribeId) invalidations.push([CacheNS.TRIBE_DETAIL, context.challengerTribeId])
      if (context.defenderTribeId) invalidations.push([CacheNS.TRIBE_DETAIL, context.defenderTribeId])
      break

    // ---- Contest Operations ----
    case 'CONTEST_CREATED':
    case 'CONTEST_UPDATED':
    case 'CONTEST_RESOLVED':
    case 'CONTEST_ENTRY_SUBMITTED':
    case 'CONTEST_SCORED':
      invalidations.push([CacheNS.CONTEST_LIST])
      if (context.contestId) invalidations.push([CacheNS.CONTEST_DETAIL, context.contestId])
      break

    // ---- Reel Operations ----
    case 'REEL_CREATED':
    case 'REEL_DELETED':
      invalidations.push([CacheNS.REELS_FEED], [CacheNS.REEL_FEED])
      if (context.reelId) invalidations.push([CacheNS.REEL_DETAIL, context.reelId])
      if (context.creatorId) invalidations.push([CacheNS.USER_PROFILE, context.creatorId])
      break

    // ---- Story Operations ----
    case 'STORY_CHANGED':
    case 'STORY_CREATED':
    case 'STORY_DELETED':
      invalidations.push([CacheNS.STORY_FEED])
      if (context.storyId) invalidations.push([CacheNS.STORY_DETAIL, context.storyId])
      break

    // ---- Moderation ----
    case 'REPORT_CREATED':
    case 'MODERATION_ACTION':
      invalidations.push([CacheNS.PUBLIC_FEED], [CacheNS.ADMIN_STATS])
      if (context.contentId) invalidations.push([CacheNS.POST_DETAIL, context.contentId])
      break

    case 'STRIKE_ISSUED':
    case 'USER_SUSPENDED':
      if (context.userId) invalidations.push([CacheNS.USER_PROFILE, context.userId])
      invalidations.push([CacheNS.ADMIN_STATS])
      break

    // ---- Leaderboard ----
    case 'HOUSE_POINTS_CHANGED':
    case 'LEADERBOARD_CHANGED':
    case 'SALUTE_LEDGER_CHANGED':
      invalidations.push([CacheNS.HOUSE_LEADERBOARD], [CacheNS.HOUSES_LIST], [CacheNS.TRIBE_LEADERBOARD], [CacheNS.TRIBE_STANDINGS])
      break

    // ---- Resources ----
    case 'RESOURCE_CHANGED':
      invalidations.push([CacheNS.RESOURCE_SEARCH])
      if (context.resourceId) invalidations.push([CacheNS.RESOURCE_DETAIL, context.resourceId])
      break

    // ---- Search / Discovery ----
    case 'TRENDING_CHANGED':
      invalidations.push([CacheNS.TRENDING], [CacheNS.EXPLORE_PAGE], [CacheNS.SEARCH_HASHTAGS])
      break

    // ---- Notifications ----
    case 'NOTIFICATION_READ':
      if (context.userId) invalidations.push([CacheNS.NOTIFICATIONS, context.userId])
      break
  }

  // Execute all invalidations
  const promises = invalidations.map(([ns, id]) => cacheInvalidate(ns, id))
  await Promise.allSettled(promises)
}

// ========== EXPORTS ==========
export const cache = {
  get: cacheGet,
  set: cacheSet,
  getOrCompute: cacheGetOrCompute,
  invalidate: cacheInvalidate,
  invalidatePattern: cacheInvalidatePattern,
  pipeline: cachePipeline,
  getStats: getCacheStats,
}
export default cache
