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
const RATE_LIMIT_MAX = 5000 // requests per window (elevated for load testing)

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
