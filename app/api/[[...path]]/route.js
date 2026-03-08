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
// Legacy house-points import removed (Stage 12X cleanup)
import { handleGovernance } from '@/lib/handlers/governance'
import { handleModerationRoutes } from '@/lib/moderation/routes/moderation.routes'
import { handleAppealDecision, handleCollegeClaims, handleDistribution, handleResources } from '@/lib/handlers/stages'
import { handleEvents } from '@/lib/handlers/events'
import { handleBoardNotices, handleAuthenticityTags } from '@/lib/handlers/board-notices'
import { handleStories } from '@/lib/handlers/stories'
import { handleReels } from '@/lib/handlers/reels'
import { handleTribes, handleTribeAdmin } from '@/lib/handlers/tribes'
import { handleTribeContests, handleTribeContestAdmin } from '@/lib/handlers/tribe-contests'
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
const RATE_LIMIT_MAX = 500 // requests per window (production: adjust based on expected traffic)

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
        version: '3.0.0',
        status: 'running',
        timestamp: new Date().toISOString(),
        stages: 'Stages 1-9 complete (Appeal, Claims, Distribution, Resources, Events, Notices, Authenticity, Stories)',
        endpoints: {
          auth: '/api/auth/*',
          profile: '/api/me/*',
          users: '/api/users/*',
          content: '/api/content/*',
          feed: '/api/feed/*',
          social: '/api/follow/*, /api/content/*/like|save|comments',
          colleges: '/api/colleges/*',
          collegeClaims: '/api/colleges/:id/claim, /api/admin/college-claims',
          houses: '/api/houses/*',
          media: '/api/media/*',
          search: '/api/search',
          notifications: '/api/notifications',
          moderation: '/api/moderation/*',
          reports: '/api/reports',
          appeals: '/api/appeals, /api/appeals/:id/decide',
          grievances: '/api/grievances',
          legal: '/api/legal/*',
          admin: '/api/admin/*',
          resources: '/api/resources, /api/resources/search, /api/resources/:id, /api/resources/:id/vote, /api/resources/:id/download, /api/resources/:id/report, /api/me/resources, /api/admin/resources',
          events: '/api/events, /api/events/search, /api/events/:id/rsvp',
          boardNotices: '/api/board/notices, /api/colleges/:id/notices',
          authenticity: '/api/authenticity/tag, /api/authenticity/tags/:type/:id',
          distribution: '/api/admin/distribution/*',
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
      // Stage 9: Story archive (GET /me/stories/archive)
      if (path[1] === 'stories' && path[2] === 'archive') {
        result = await handleStories(path, method, request, db)
      }
      // Stage 9: Close friends
      else if (path[1] === 'close-friends') {
        result = await handleStories(path, method, request, db)
      }
      // Stage 9: Highlights
      else if (path[1] === 'highlights') {
        result = await handleStories(path, method, request, db)
      }
      // Stage 9: Story settings
      else if (path[1] === 'story-settings') {
        result = await handleStories(path, method, request, db)
      }
      // Stage 9: User blocks
      else if (path[1] === 'blocks') {
        result = await handleStories(path, method, request, db)
      }
      // Stage 10: Creator reels routes (archive, analytics, series)
      else if (path[1] === 'reels') {
        result = await handleReels(path, method, request, db)
      }
      // Stage 6: My events (GET /me/events, GET /me/events/rsvps)
      else if (path[1] === 'events') {
        result = await handleEvents(path, method, request, db)
      }
      // Stage 7: My board notices (GET /me/board/notices)
      else if (path[1] === 'board') {
        result = await handleBoardNotices(path, method, request, db)
      }
      // Stage 12: My tribe (GET /me/tribe)
      else if (path[1] === 'tribe') {
        result = await handleTribes(path, method, request, db)
      }
      // Stage 2: College claims (GET /me/college-claims)
      else if (path[1] === 'college-claims') {
        result = await handleCollegeClaims(path, method, request, db)
      }
      // Stage 5: My resources (GET /me/resources)
      else if (path[1] === 'resources') {
        result = await handleResources(path, method, request, db)
      }
      if (!result) {
        result = await handleOnboarding(path, method, request, db)
      }
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
    } else if (path[0] === 'stories') {
      result = await handleStories(path, method, request, db)
    } else if (path[0] === 'reels') {
      result = await handleReels(path, method, request, db)
    } else if (path[0] === 'users') {
      // Stage 9: User stories (GET /users/:id/stories)
      if (path.length === 3 && path[2] === 'stories') {
        result = await handleStories(path, method, request, db)
      }
      // Stage 9: User highlights (GET /users/:id/highlights)
      else if (path.length === 3 && path[2] === 'highlights') {
        result = await handleStories(path, method, request, db)
      }
      // Stage 10: User reels (GET /users/:id/reels, GET /users/:id/reels/series)
      else if (path[2] === 'reels') {
        result = await handleReels(path, method, request, db)
      }
      // Stage 12: User tribe (GET /users/:id/tribe)
      else if (path[2] === 'tribe') {
        result = await handleTribes(path, method, request, db)
      }
      if (!result) {
        result = await handleUsers(path, method, request, db)
      }
    } else if (path[0] === 'colleges' || path[0] === 'houses' || path[0] === 'search' || path[0] === 'suggestions') {
      // Stage 2: College claims (POST /colleges/:id/claim)
      if (path[0] === 'colleges' && path.length === 3 && path[2] === 'claim') {
        result = await handleCollegeClaims(path, method, request, db)
      }
      // Stage 7: College notices (GET /colleges/:id/notices)
      else if (path[0] === 'colleges' && path.length === 3 && path[2] === 'notices') {
        result = await handleBoardNotices(path, method, request, db)
      }
      if (!result) {
        result = await handleDiscovery(path, method, request, db)
      }
    } else if (path[0] === 'media') {
      result = await handleMedia(path, method, request, db)
    // Legacy house-points route deprecated (Stage 12X: tribe salutes replace this)
    } else if (path[0] === 'house-points') {
      result = { error: 'House points system deprecated. Use tribe salutes via /tribe-contests', code: 'DEPRECATED', status: 410 }
    } else if (path[0] === 'governance') {
      result = await handleGovernance(path, method, request, db)
    } else if (['reports', 'moderation', 'appeals', 'notifications', 'legal', 'admin', 'grievances'].includes(path[0])) {
      // Stage 1: Appeal decisions
      if (path[0] === 'appeals' && path.length === 3 && path[2] === 'decide') {
        result = await handleAppealDecision(path, method, request, db)
      }
      // Stage 2: College claim admin decisions
      else if (path[0] === 'admin' && path[1] === 'college-claims') {
        result = await handleCollegeClaims(path, method, request, db)
      }
      // Stage 4: Distribution admin
      else if (path[0] === 'admin' && path[1] === 'distribution') {
        result = await handleDistribution(path, method, request, db)
      }
      // Stage 5: Admin resources (GET /admin/resources, PATCH /admin/resources/:id/moderate)
      else if (path[0] === 'admin' && path[1] === 'resources') {
        result = await handleResources(path, method, request, db)
      }
      // Stage 9: Admin stories (GET /admin/stories, PATCH /admin/stories/:id/moderate, GET /admin/stories/analytics)
      else if (path[0] === 'admin' && path[1] === 'stories') {
        result = await handleStories(path, method, request, db)
      }
      // Stage 10: Admin reels (GET /admin/reels, PATCH /admin/reels/:id/moderate, GET /admin/reels/analytics)
      else if (path[0] === 'admin' && path[1] === 'reels') {
        result = await handleReels(path, method, request, db)
      }
      // Stage 6: Admin events (GET /admin/events, PATCH /admin/events/:id/moderate, GET /admin/events/analytics, POST /admin/events/:id/recompute-counters)
      else if (path[0] === 'admin' && path[1] === 'events') {
        result = await handleEvents(path, method, request, db)
      }
      // Stage 7: Admin board-notices analytics
      else if (path[0] === 'admin' && path[1] === 'board-notices') {
        result = await handleBoardNotices(path, method, request, db)
      }
      // Stage 7: Admin authenticity stats
      else if (path[0] === 'admin' && path[1] === 'authenticity') {
        result = await handleAuthenticityTags(path, method, request, db)
      }
      // Stage 12: Admin tribe routes (distribution, reassign, migrate, boards)
      else if (path[0] === 'admin' && path[1] === 'tribes') {
        result = await handleTribeAdmin(path, method, request, db)
      }
      // Stage 12: Admin tribe seasons
      else if (path[0] === 'admin' && path[1] === 'tribe-seasons') {
        result = await handleTribeAdmin(path, method, request, db)
      }
      // Stage 12: Admin tribe contests (upgraded contest engine)
      else if (path[0] === 'admin' && path[1] === 'tribe-contests') {
        result = await handleTribeContestAdmin(path, method, request, db)
      }
      // Stage 12: Admin tribe salutes (upgraded)
      else if (path[0] === 'admin' && path[1] === 'tribe-salutes') {
        result = await handleTribeContestAdmin(path, method, request, db)
      }
      // Stage 12: Admin tribe awards
      else if (path[0] === 'admin' && path[1] === 'tribe-awards') {
        result = await handleTribeAdmin(path, method, request, db)
      }
      // Stage 7: Board notices moderation
      else if (path[0] === 'moderation' && path[1] === 'board-notices') {
        result = await handleBoardNotices(path, method, request, db)
      }
      // Default admin handler
      if (!result) {
        result = await handleAdmin(path, method, request, db)
      }
    } else if (path[0] === 'resources') {
      result = await handleResources(path, method, request, db)
    } else if (path[0] === 'events') {
      result = await handleEvents(path, method, request, db)
    } else if (path[0] === 'board') {
      result = await handleBoardNotices(path, method, request, db)
    } else if (path[0] === 'authenticity') {
      result = await handleAuthenticityTags(path, method, request, db)
    } else if (path[0] === 'tribe-contests') {
      result = await handleTribeContests(path, method, request, db)
    } else if (path[0] === 'tribes') {
      result = await handleTribes(path, method, request, db)
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
