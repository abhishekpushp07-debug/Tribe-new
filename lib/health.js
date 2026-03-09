/**
 * Tribe — Health Intelligence Module (Stage 3)
 *
 * Three-tier health checks:
 * - Liveness: Is the process alive? (lightweight, no dep checks, no auth)
 * - Readiness: Can this instance receive traffic? (checks critical deps, no auth)
 * - Deep: Detailed dependency-by-dependency intelligence (admin auth)
 *
 * States: HEALTHY, DEGRADED, UNHEALTHY
 *
 * Architecture decisions:
 * - /healthz (liveness) runs BEFORE rate limiting and DB connection
 * - /readyz (readiness) is public for k8s probes
 * - /ops/health (deep) requires ADMIN auth for security
 */

import { cache } from './cache.js'
import metrics from './metrics.js'

// ========== LIVENESS ==========
// Lightweight: process is alive and can serve requests.
// No dependency checks. Used by k8s liveness probe.
export async function checkLiveness() {
  return {
    status: 'ok',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  }
}

// ========== READINESS ==========
// Checks critical dependencies. Instance should not receive traffic if critical deps are down.
// Public endpoint (no auth) for k8s readiness probe.
export async function checkReadiness(db) {
  const checks = {}
  let critical = true

  // MongoDB (CRITICAL — without it, app cannot serve any data)
  try {
    const start = Date.now()
    await db.command({ ping: 1 })
    const latencyMs = Date.now() - start
    checks.mongo = { status: latencyMs > 2000 ? 'slow' : 'ok', latencyMs }
    if (latencyMs > 2000) {
      metrics.recordDependencyEvent('mongo', 'slow')
    }
  } catch (e) {
    checks.mongo = { status: 'error', error: e.message }
    metrics.recordDependencyEvent('mongo', 'readiness_fail')
    critical = false
  }

  // Redis (NON-CRITICAL — app degrades to in-memory fallback)
  try {
    const cacheStats = await cache.getStats()
    const connected = cacheStats.redis.status === 'connected'
    checks.redis = {
      status: connected ? 'ok' : 'degraded',
    }
    if (!connected) {
      checks.redis.impact = 'Cache and rate limiting using in-memory fallback (per-instance only)'
      metrics.recordDependencyEvent('redis', 'readiness_degraded')
    }
  } catch {
    checks.redis = { status: 'degraded', impact: 'Redis check failed' }
  }

  const hasDegraded = Object.values(checks).some(c => c.status === 'degraded' || c.status === 'slow')
  const overallStatus = !critical ? 'unhealthy' : hasDegraded ? 'degraded' : 'healthy'

  return {
    ready: critical, // Ready if critical deps (MongoDB) are up
    status: overallStatus,
    checks,
    timestamp: new Date().toISOString(),
  }
}

// ========== DEEP HEALTH ==========
// Detailed per-dependency check with latency measurements.
// Includes SLI snapshot. Requires ADMIN auth.
export async function checkDeepHealth(db) {
  const checks = {}

  // 1. MongoDB
  try {
    const start = Date.now()
    await db.command({ ping: 1 })
    const pingMs = Date.now() - start
    const statsStart = Date.now()
    const stats = await db.stats()
    const statsMs = Date.now() - statsStart
    checks.mongodb = {
      status: pingMs > 500 ? 'slow' : 'ok',
      pingLatencyMs: pingMs,
      statsLatencyMs: statsMs,
      collections: stats.collections,
      dataSize: stats.dataSize,
      indexes: stats.indexes,
    }
    if (pingMs > 500) {
      checks.mongodb.warning = `Ping latency ${pingMs}ms exceeds 500ms threshold`
    }
  } catch (e) {
    checks.mongodb = { status: 'error', error: e.message }
    metrics.recordDependencyEvent('mongo', 'deep_health_fail')
  }

  // 2. Redis
  try {
    const cacheStats = await cache.getStats()
    const connected = cacheStats.redis.status === 'connected'
    checks.redis = {
      status: connected ? 'ok' : 'degraded',
      keys: cacheStats.redis.keys,
      hitRate: cacheStats.hitRate,
      fallbackSize: cacheStats.fallbackSize,
      redisErrors: cacheStats.redisErrors,
    }
    if (!connected) {
      checks.redis.impact = 'Rate limiting per-instance only. Cache not shared across instances.'
    }
  } catch (e) {
    checks.redis = { status: 'error', error: e.message }
  }

  // 3. Rate Limiter
  try {
    const { getRateLimiterStatus } = await import('./security.js')
    checks.rateLimiter = getRateLimiterStatus()
  } catch {
    checks.rateLimiter = { status: 'unknown' }
  }

  // 4. Moderation (AI provider)
  try {
    const { getModerationServiceConfig } = await import('./moderation/middleware/moderate-create-content.js')
    const modConfig = getModerationServiceConfig(db)
    checks.moderation = {
      status: 'ok',
      provider: modConfig.activeProvider,
      providerChain: modConfig.providerChain,
    }
  } catch (e) {
    checks.moderation = {
      status: 'degraded',
      error: e.message,
      impact: 'Content moderation may use fallback keyword filter',
    }
  }

  // 5. Object Storage
  try {
    const { isStorageAvailable } = await import('./storage.js')
    const available = isStorageAvailable()
    checks.objectStorage = { status: available ? 'ok' : 'degraded' }
    if (!available) {
      checks.objectStorage.impact = 'Media uploads will use base64 fallback'
    }
  } catch {
    checks.objectStorage = { status: 'unknown', impact: 'Storage module unavailable' }
  }

  // 6. Audit System
  try {
    const start = Date.now()
    await db.collection('audit_logs').findOne({}, { projection: { _id: 1 }, sort: { createdAt: -1 } })
    checks.auditSystem = { status: 'ok', latencyMs: Date.now() - start }
  } catch (e) {
    checks.auditSystem = { status: 'error', error: e.message }
  }

  // Compute overall status
  const statuses = Object.values(checks).map(c => c.status)
  const hasError = statuses.includes('error')
  const hasDegraded = statuses.includes('degraded') || statuses.includes('slow')
  const overallStatus = hasError ? 'unhealthy' : hasDegraded ? 'degraded' : 'healthy'

  const slis = metrics.getSLIs()

  return {
    status: overallStatus,
    ready: checks.mongodb?.status !== 'error', // Ready only if MongoDB (critical) is not errored
    checks,
    slis,
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      memoryMB: Math.round(process.memoryUsage().heapUsed / 1048576),
    },
    version: '3.0.0',
    contractVersion: 'v2',
    timestamp: new Date().toISOString(),
  }
}
