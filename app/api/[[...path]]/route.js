import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { handleAuth } from '@/lib/handlers/auth'
import { handleOnboarding } from '@/lib/handlers/onboarding'
import { handleContent } from '@/lib/handlers/content'
import { handleFeed } from '@/lib/handlers/feed'
import { handleSocial } from '@/lib/handlers/social'
import { handleUsers } from '@/lib/handlers/users'
import { handleDiscovery } from '@/lib/handlers/discovery'
import { handleMedia } from '@/lib/handlers/media'
import { handleAdmin } from '@/lib/handlers/admin'
import { handleHousePoints } from '@/lib/handlers/house-points'
import { handleGovernance } from '@/lib/handlers/governance'
import { handleModerationRoutes } from '@/lib/moderation/routes/moderation.routes'
import { cache } from '@/lib/cache'

// ========== CORS ==========
function cors(response) {
  response.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGINS || '*')
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  response.headers.set('Access-Control-Allow-Credentials', 'true')
  return response
}

// ========== RESPONSE BUILDERS ==========
function jsonOk(data, status = 200) {
  return cors(NextResponse.json(data, { status }))
}

function jsonErr(message, code, status = 400) {
  return cors(NextResponse.json({ error: message, code }, { status }))
}

// ========== RATE LIMITER (in-memory, per IP) ==========
const rateLimitStore = new Map()
const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 1 minute
const RATE_LIMIT_MAX = 120 // requests per window (production level)

function checkRateLimit(request) {
  const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
  const now = Date.now()
  const entry = rateLimitStore.get(ip)

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(ip, { windowStart: now, count: 1 })
    return true
  }

  entry.count++
  if (entry.count > RATE_LIMIT_MAX) return false
  return true
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of rateLimitStore) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitStore.delete(ip)
    }
  }
}, 5 * 60 * 1000)

// ========== OPTIONS ==========
export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 200 }))
}

// ========== MAIN ROUTER ==========
async function handleRoute(request, { params }) {
  const { path = [] } = params
  const route = `/${path.join('/')}`
  const method = request.method

  // Rate limiting
  if (!checkRateLimit(request)) {
    return jsonErr('Rate limit exceeded. Try again later.', 'RATE_LIMITED', 429)
  }

  try {
    const db = await getDb()

    // ---- Health endpoints ----
    if (route === '/' && method === 'GET') {
      return jsonOk({
        name: 'Tribe API',
        version: '2.0.0',
        status: 'running',
        timestamp: new Date().toISOString(),
        endpoints: {
          auth: '/api/auth/*',
          profile: '/api/me/*',
          users: '/api/users/*',
          content: '/api/content/*',
          feed: '/api/feed/*',
          social: '/api/follow/*, /api/content/*/like|save|comments',
          colleges: '/api/colleges/*',
          houses: '/api/houses/*',
          media: '/api/media/*',
          search: '/api/search',
          notifications: '/api/notifications',
          moderation: '/api/moderation/*',
          reports: '/api/reports',
          appeals: '/api/appeals',
          grievances: '/api/grievances',
          legal: '/api/legal/*',
          admin: '/api/admin/*',
        },
      })
    }

    if (route === '/healthz' && method === 'GET') {
      return jsonOk({ ok: true, timestamp: new Date().toISOString() })
    }

    if (route === '/readyz' && method === 'GET') {
      try {
        await db.command({ ping: 1 })
        return jsonOk({ ok: true, db: 'connected', timestamp: new Date().toISOString() })
      } catch {
        return jsonErr('Database not ready', 'DB_ERROR', 503)
      }
    }

    if (route === '/cache/stats' && method === 'GET') {
      return jsonOk(await cache.getStats())
    }

    if (route === '/moderation/config' && method === 'GET') {
      const modResult = await handleModerationRoutes(path, method, request, db)
      if (modResult) {
        if (modResult.error) return jsonErr(modResult.error, modResult.code || 'ERROR', modResult.status || 400)
        return jsonOk(modResult.data, modResult.status || 200)
      }
    }

    if (route === '/moderation/check' && method === 'POST') {
      const modResult = await handleModerationRoutes(path, method, request, db)
      if (modResult) {
        if (modResult.error) return jsonErr(modResult.error, modResult.code || 'ERROR', modResult.status || 400)
        return jsonOk(modResult.data, modResult.status || 200)
      }
    }

    // ========================
    // OPS: Deep health check (all dependencies)
    // ========================
    if (route === '/ops/health' && method === 'GET') {
      const checks = {}

      // MongoDB
      try {
        await db.command({ ping: 1 })
        const stats = await db.stats()
        checks.mongodb = { status: 'ok', collections: stats.collections, dataSize: stats.dataSize, indexes: stats.indexes }
      } catch (e) { checks.mongodb = { status: 'error', error: e.message } }

      // Redis
      const cacheStats = await cache.getStats()
      checks.redis = { status: cacheStats.redis.status, keys: cacheStats.redis.keys, hitRate: cacheStats.hitRate }

      // Moderation provider (adapter-based)
      try {
        const { getModerationServiceConfig } = await import('@/lib/moderation/middleware/moderate-create-content')
        const modConfig = getModerationServiceConfig(db)
        checks.moderation = { status: 'ok', provider: modConfig.activeProvider, providerChain: modConfig.providerChain }
      } catch (e) { checks.moderation = { status: 'error', error: e.message } }

      // Object storage
      try {
        const { isStorageAvailable } = await import('@/lib/storage')
        checks.objectStorage = { status: isStorageAvailable() ? 'ok' : 'degraded' }
      } catch { checks.objectStorage = { status: 'unknown' } }

      const allOk = Object.values(checks).every(c => c.status === 'ok')
      return jsonOk({ status: allOk ? 'healthy' : 'degraded', checks, timestamp: new Date().toISOString() })
    }

    // ========================
    // OPS: Metrics endpoint
    // ========================
    if (route === '/ops/metrics' && method === 'GET') {
      const [userCount, postCount, activeSessionCount, reportCount, grievanceCount] = await Promise.all([
        db.collection('users').countDocuments(),
        db.collection('content_items').countDocuments(),
        db.collection('sessions').countDocuments({ expiresAt: { $gt: new Date() } }),
        db.collection('reports').countDocuments({ status: 'OPEN' }),
        db.collection('grievance_tickets').countDocuments({ status: 'OPEN' }),
      ])
      const cacheStats = await cache.getStats()
      return jsonOk({
        users: userCount,
        posts: postCount,
        activeSessions: activeSessionCount,
        openReports: reportCount,
        openGrievances: grievanceCount,
        cache: { hitRate: cacheStats.hitRate, redisStatus: cacheStats.redis.status },
        timestamp: new Date().toISOString(),
      })
    }

    // ========================
    // OPS: Database backup proof (dry-run)
    // ========================
    if (route === '/ops/backup-check' && method === 'GET') {
      try {
        const collections = await db.listCollections().toArray()
        const sizes = await Promise.all(collections.map(async (c) => {
          const count = await db.collection(c.name).countDocuments()
          return { name: c.name, docs: count }
        }))
        const totalDocs = sizes.reduce((s, c) => s + c.docs, 0)
        return jsonOk({
          backupReady: true,
          collections: sizes.length,
          totalDocuments: totalDocs,
          collectionDetails: sizes,
          backupCommand: 'mongodump --db=your_database_name --out=/backup/$(date +%Y%m%d_%H%M%S)',
          restoreCommand: 'mongorestore --db=your_database_name /backup/<timestamp>/',
          timestamp: new Date().toISOString(),
        })
      } catch (e) {
        return jsonErr(`Backup check failed: ${e.message}`, 'INTERNAL', 500)
      }
    }

    // ---- Route dispatch ----
    // Each handler returns: { data, status } | { error, code, status } | { raw: NextResponse } | null
    let result = null

    if (path[0] === 'auth') {
      result = await handleAuth(path, method, request, db)
    } else if (path[0] === 'me') {
      result = await handleOnboarding(path, method, request, db)
    } else if (path[0] === 'content' && path.length <= 2 && (method === 'POST' || method === 'GET' || method === 'DELETE')) {
      // Content CRUD (POST /content/posts, GET /content/:id, DELETE /content/:id)
      result = await handleContent(path, method, request, db)
    } else if (path[0] === 'feed') {
      result = await handleFeed(path, method, request, db)
    } else if (path[0] === 'follow') {
      result = await handleSocial(path, method, request, db)
    } else if (path[0] === 'content' && path.length === 3) {
      // Social actions on content (like, dislike, reaction, save, comments)
      result = await handleSocial(path, method, request, db)
    } else if (path[0] === 'users') {
      result = await handleUsers(path, method, request, db)
    } else if (path[0] === 'colleges' || path[0] === 'houses' || path[0] === 'search' || path[0] === 'suggestions') {
      result = await handleDiscovery(path, method, request, db)
    } else if (path[0] === 'media') {
      result = await handleMedia(path, method, request, db)
    } else if (path[0] === 'house-points') {
      result = await handleHousePoints(path, method, request, db)
    } else if (path[0] === 'governance') {
      result = await handleGovernance(path, method, request, db)
    } else if (['reports', 'moderation', 'appeals', 'notifications', 'legal', 'admin', 'grievances'].includes(path[0])) {
      result = await handleAdmin(path, method, request, db)
    }

    // ---- Process result ----
    if (result === null) {
      return jsonErr(`Route ${route} [${method}] not found`, 'NOT_FOUND', 404)
    }

    // Raw response (e.g., media binary)
    if (result.raw) {
      return cors(result.raw)
    }

    // Error response
    if (result.error) {
      return jsonErr(result.error, result.code || 'ERROR', result.status || 400)
    }

    // Success response
    return jsonOk(result.data, result.status || 200)

  } catch (error) {
    // Structured error from requireAuth etc.
    if (error.status && error.code) {
      return jsonErr(error.message, error.code, error.status)
    }
    console.error('API Error:', error)
    return jsonErr('Internal server error', 'INTERNAL_ERROR', 500)
  }
}

export const GET = handleRoute
export const POST = handleRoute
export const PUT = handleRoute
export const DELETE = handleRoute
export const PATCH = handleRoute
