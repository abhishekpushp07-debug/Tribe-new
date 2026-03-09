/**
 * Tribe — In-Memory Metrics Collector (Stage 3)
 *
 * Tracks HTTP metrics, latency histograms, error rates, dependency health,
 * and rate limit effectiveness. Provides SLI views for operational dashboards.
 *
 * Architecture: In-memory per-instance. Redis-backed distributed aggregation
 * deferred to Stage 10 (Production Hardening).
 */

// Fixed latency buckets (ms) — Prometheus-style
const LATENCY_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000]

// Counters
const requestsByRoute = new Map()     // `{method} {routeFamily}` -> count
const statusCodeCounts = new Map()    // statusCode -> count
const errorCodeCounts = new Map()     // errorCode -> count
const depEvents = new Map()           // `{dep}:{event}` -> count
const rateLimitHits = new Map()       // `{tier}:{limitedBy}` -> count

// Global latency histogram
const globalHistogram = {
  buckets: new Map(LATENCY_BUCKETS.map(b => [b, 0])),
  sum: 0, count: 0, min: Infinity, max: 0,
}

// Per-route latency
const routeLatency = new Map()        // routeFamily -> { sum, count, min, max }

// Circular buffer for accurate percentile (last 10000 requests)
const BUFFER_SIZE = 10000
const latencyBuffer = new Float64Array(BUFFER_SIZE)
let bufferIndex = 0
let bufferFilled = false

// Totals
let totalRequests = 0
let total5xx = 0
let total4xx = 0
let totalRateLimitHits = 0

const startedAt = new Date().toISOString()

// Normalize routes: collapse UUIDs into :id
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

function getRouteFamily(route) {
  return route.replace(UUID_RE, ':id')
}

function recordRequest(route, method, statusCode, latencyMs) {
  totalRequests++
  if (statusCode >= 500) total5xx++
  else if (statusCode >= 400) total4xx++

  const family = getRouteFamily(route)
  const routeKey = `${method} ${family}`

  // Per-route request count
  requestsByRoute.set(routeKey, (requestsByRoute.get(routeKey) || 0) + 1)

  // Status code count
  statusCodeCounts.set(statusCode, (statusCodeCounts.get(statusCode) || 0) + 1)

  // Global histogram buckets
  globalHistogram.sum += latencyMs
  globalHistogram.count++
  globalHistogram.min = Math.min(globalHistogram.min, latencyMs)
  globalHistogram.max = Math.max(globalHistogram.max, latencyMs)
  for (const bucket of LATENCY_BUCKETS) {
    if (latencyMs <= bucket) {
      globalHistogram.buckets.set(bucket, globalHistogram.buckets.get(bucket) + 1)
    }
  }

  // Per-route latency
  if (!routeLatency.has(routeKey)) {
    routeLatency.set(routeKey, { sum: 0, count: 0, min: Infinity, max: 0 })
  }
  const rl = routeLatency.get(routeKey)
  rl.sum += latencyMs
  rl.count++
  rl.min = Math.min(rl.min, latencyMs)
  rl.max = Math.max(rl.max, latencyMs)

  // Circular buffer for global percentile
  latencyBuffer[bufferIndex] = latencyMs
  bufferIndex = (bufferIndex + 1) % BUFFER_SIZE
  if (!bufferFilled && bufferIndex === 0) bufferFilled = true
}

function recordError(errorCode) {
  errorCodeCounts.set(errorCode, (errorCodeCounts.get(errorCode) || 0) + 1)
}

function recordDependencyEvent(dep, event) {
  const key = `${dep}:${event}`
  depEvents.set(key, (depEvents.get(key) || 0) + 1)
}

function recordRateLimitHit(tier, limitedBy) {
  totalRateLimitHits++
  const key = `${tier}:${limitedBy}`
  rateLimitHits.set(key, (rateLimitHits.get(key) || 0) + 1)
}

function computePercentiles() {
  const count = bufferFilled ? BUFFER_SIZE : bufferIndex
  if (count === 0) return { p50: 0, p95: 0, p99: 0 }

  const active = Array.from(latencyBuffer.subarray(0, count)).sort((a, b) => a - b)
  return {
    p50: Math.round(active[Math.floor(count * 0.50)]),
    p95: Math.round(active[Math.floor(count * 0.95)]),
    p99: Math.round(active[Math.floor(count * 0.99)]),
  }
}

function getMetrics() {
  const percentiles = computePercentiles()
  const mem = process.memoryUsage()

  return {
    startedAt,
    process: {
      uptimeSeconds: Math.round(process.uptime()),
      memoryMB: {
        rss: Math.round(mem.rss / 1048576),
        heapUsed: Math.round(mem.heapUsed / 1048576),
        heapTotal: Math.round(mem.heapTotal / 1048576),
        external: Math.round(mem.external / 1048576),
      },
    },
    http: {
      totalRequests,
      latency: {
        avgMs: totalRequests > 0 ? Math.round(globalHistogram.sum / globalHistogram.count) : 0,
        minMs: globalHistogram.min === Infinity ? 0 : Math.round(globalHistogram.min),
        maxMs: Math.round(globalHistogram.max),
        p50Ms: percentiles.p50,
        p95Ms: percentiles.p95,
        p99Ms: percentiles.p99,
      },
      histogramBuckets: Object.fromEntries(globalHistogram.buckets),
      statusCodes: Object.fromEntries(statusCodeCounts),
      errors4xx: total4xx,
      errors5xx: total5xx,
      errorRate5xx: totalRequests > 0 ? `${((total5xx / totalRequests) * 100).toFixed(3)}%` : '0%',
    },
    rateLimiting: {
      totalHits: totalRateLimitHits,
      byTierAndType: Object.fromEntries(rateLimitHits),
    },
    dependencies: Object.fromEntries(depEvents),
    errorCodes: Object.fromEntries(errorCodeCounts),
    topRoutes: getTopRoutes(15),
    timestamp: new Date().toISOString(),
  }
}

function getTopRoutes(limit = 15) {
  const routes = []
  for (const [key, rl] of routeLatency) {
    routes.push({
      route: key,
      requests: rl.count,
      avgMs: rl.count > 0 ? Math.round(rl.sum / rl.count) : 0,
      minMs: rl.min === Infinity ? 0 : Math.round(rl.min),
      maxMs: Math.round(rl.max),
    })
  }
  return routes.sort((a, b) => b.requests - a.requests).slice(0, limit)
}

function getSLIs() {
  const percentiles = computePercentiles()
  return {
    errorRate: totalRequests > 0 ? total5xx / totalRequests : 0,
    errorRateFormatted: totalRequests > 0 ? `${((total5xx / totalRequests) * 100).toFixed(3)}%` : '0%',
    latency: {
      p50Ms: percentiles.p50,
      p95Ms: percentiles.p95,
      p99Ms: percentiles.p99,
    },
    counters: {
      totalRequests,
      total5xx,
      total4xx,
      totalRateLimitHits,
      totalDependencyEvents: Array.from(depEvents.values()).reduce((s, v) => s + v, 0),
    },
    timestamp: new Date().toISOString(),
  }
}

export const metrics = {
  recordRequest,
  recordError,
  recordDependencyEvent,
  recordRateLimitHit,
  getMetrics,
  getSLIs,
  getRouteFamily,
}

export default metrics
