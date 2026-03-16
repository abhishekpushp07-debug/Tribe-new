import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { applyFreezeHeaders } from '@/lib/freeze-registry'
import { applySecurityHeaders, getEndpointTier, checkTieredRateLimit, extractIP, checkPayloadSize, deepSanitizeStrings } from '@/lib/security'
import logger from '@/lib/logger'
import metrics from '@/lib/metrics'
import { requestContext } from '@/lib/request-context'
import { dispatchRoute } from '@/lib/route-dispatch'

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
  const resp = cors(NextResponse.json(data, { status }))
  resp.headers.set('x-contract-version', 'v2')
  applySecurityHeaders(resp)
  return resp
}

function jsonErr(message, code, status = 400, extraHeaders = {}) {
  const resp = cors(NextResponse.json({ error: message, code }, { status }))
  resp.headers.set('x-contract-version', 'v2')
  applySecurityHeaders(resp)
  for (const [k, v] of Object.entries(extraHeaders)) resp.headers.set(k, v)
  return resp
}

// ========== OPTIONS ==========
export async function OPTIONS(request, context) {
  const { path = [] } = context.params
  const route = `/${path.join('/')}`
  const startTime = Date.now()
  const requestId = crypto.randomUUID()

  const resp = cors(new NextResponse(null, { status: 200 }))
  applySecurityHeaders(resp)
  resp.headers.set('x-request-id', requestId)
  applyFreezeHeaders(resp, route, 'OPTIONS')

  metrics.recordRequest(route, 'OPTIONS', 200, Date.now() - startTime)
  return resp
}

// ========== MAIN ROUTER ==========
async function handleRouteCore(request, { params }, reqCtx) {
  const { path = [] } = params
  const route = `/${path.join('/')}`
  const method = request.method
  const ip = extractIP(request)

  // Tiered rate limiting — Phase 1: Per-IP
  const tier = getEndpointTier(route, method)
  const ipRateResult = await checkTieredRateLimit(ip, null, tier)
  if (!ipRateResult.allowed) {
    reqCtx.rateLimited = true
    reqCtx.errorCode = 'RATE_LIMITED'
    return jsonErr(`Rate limit exceeded (${tier.name}). Try again later.`, 'RATE_LIMITED', 429, { 'Retry-After': String(ipRateResult.retryAfter) })
  }

  // Payload size check (non-media routes)
  if (['POST', 'PUT', 'PATCH'].includes(method) && !route.startsWith('/media')) {
    if (!checkPayloadSize(request)) {
      reqCtx.errorCode = 'PAYLOAD_TOO_LARGE'
      return jsonErr('Request payload too large', 'PAYLOAD_TOO_LARGE', 413)
    }
  }

  // Input sanitization for JSON bodies
  if (['POST', 'PUT', 'PATCH'].includes(method) && !route.startsWith('/media')) {
    const contentType = request.headers.get('content-type')
    if (contentType?.includes('application/json')) {
      try {
        const rawBodyText = await request.text()
        if (rawBodyText) {
          const parsed = JSON.parse(rawBodyText)
          const sanitized = deepSanitizeStrings(parsed)
          request = new Request(request.url, {
            method: request.method,
            headers: request.headers,
            body: JSON.stringify(sanitized),
          })
        }
      } catch (e) {
        logger.warn('HTTP', 'body_parse_failed', { requestId: reqCtx.requestId, route, method, error: e.message })
      }
    }
  }

  try {
    const db = await getDb()

    // Per-user rate limiting — Phase 2 (extract userId from token)
    let authUserId = null
    try {
      const authHeader = request.headers.get('authorization')
      if (authHeader?.startsWith('Bearer ')) {
        const tkn = authHeader.slice(7)
        if (tkn.length > 10) {
          const sess = await db.collection('sessions').findOne({ token: tkn }, { projection: { userId: 1, _id: 0 } })
          if (sess) {
            authUserId = sess.userId
            reqCtx.userId = sess.userId
            const ctx = requestContext.getStore()
            if (ctx) ctx.userId = sess.userId
          }
        }
      }
    } catch {}

    if (authUserId) {
      const userRateResult = await checkTieredRateLimit(null, authUserId, tier)
      if (!userRateResult.allowed) {
        reqCtx.rateLimited = true
        reqCtx.errorCode = 'RATE_LIMITED'
        return jsonErr(`Rate limit exceeded (${tier.name}). Try again later.`, 'RATE_LIMITED', 429, { 'Retry-After': String(userRateResult.retryAfter) })
      }
    }

    // ---- DISPATCH (all routing logic lives in route-dispatch.js) ----
    const result = await dispatchRoute(path, method, request, db)

    if (result === null) {
      reqCtx.errorCode = 'NOT_FOUND'
      return jsonErr(`Route ${route} [${method}] not found`, 'NOT_FOUND', 404)
    }

    if (result.raw) {
      const rawResp = cors(result.raw)
      applySecurityHeaders(rawResp)
      return rawResp
    }

    if (result.error) {
      reqCtx.errorCode = result.code || 'ERROR'
      return jsonErr(result.error, result.code || 'ERROR', result.status || 400, result.headers || {})
    }

    const resp = jsonOk(result.data, result.status || 200)
    if (result.headers) {
      for (const [key, value] of Object.entries(result.headers)) resp.headers.set(key, value)
    }
    return resp

  } catch (error) {
    if (error.status && error.code) {
      reqCtx.errorCode = error.code
      return jsonErr(error.message, error.code, error.status)
    }
    reqCtx.errorCode = 'INTERNAL_ERROR'
    logger.error('HTTP', 'unhandled_error', {
      requestId: reqCtx.requestId,
      route: `/${(params?.path || []).join('/')}`,
      method: request.method,
      error: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join(' | '),
    })
    return jsonErr('Internal server error', 'INTERNAL_ERROR', 500)
  }
}

// ========== OBSERVABILITY WRAPPER ==========
async function handleRoute(request, context) {
  const requestId = crypto.randomUUID()
  const startTime = Date.now()
  const { path = [] } = context.params
  const route = `/${path.join('/')}`
  const method = request.method
  const ip = extractIP(request)

  const reqCtx = { requestId, userId: null, rateLimited: false, errorCode: null }
  const correlationStore = { requestId, ip, method, route, userId: null }

  const response = await requestContext.run(correlationStore, () =>
    handleRouteCore(request, context, reqCtx)
  )

  const statusCode = response.status
  const latencyMs = Date.now() - startTime

  response.headers.set('x-request-id', requestId)
  response.headers.set('x-latency-ms', String(latencyMs))
  applyFreezeHeaders(response, route, method)

  // ═══ WORLD BEST: Response optimization for minimal network overhead ═══
  
  // 1. ETag for conditional requests (304 Not Modified — zero body transfer)
  if (method === 'GET' && statusCode === 200) {
    // Generate ETag from latency + route + userId (lightweight, no body clone needed)
    const { createHash } = await import('crypto')
    const etagSource = `${route}:${reqCtx.userId || 'anon'}:${Math.floor(Date.now() / 5000)}`
    const etag = `"${createHash('md5').update(etagSource).digest('hex').slice(0, 16)}"`
    response.headers.set('ETag', etag)
    
    const ifNoneMatch = request.headers.get('if-none-match')
    if (ifNoneMatch === etag) {
      const notModified = cors(new NextResponse(null, { status: 304 }))
      notModified.headers.set('ETag', etag)
      notModified.headers.set('x-request-id', requestId)
      notModified.headers.set('x-latency-ms', String(latencyMs))
      applySecurityHeaders(notModified)
      metrics.recordRequest(route, method, 304, latencyMs)
      return notModified
    }
  }

  // 2. Cache-Control — aggressive for reads
  if (method === 'GET' && statusCode === 200) {
    if (route === '/auth/me' || route === '/auth/check' || route === '/auth/sessions') {
      response.headers.set('Cache-Control', 'private, max-age=30, stale-while-revalidate=60')
    } else if (route.includes('/feed') || route.includes('/reels/feed') || route.includes('/discover')) {
      response.headers.set('Cache-Control', 'private, max-age=10, stale-while-revalidate=30')
    } else if (route.includes('/tribes') || route.includes('/tribe-contests')) {
      response.headers.set('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=120')
    } else if (route.includes('/media/') && !route.includes('/upload')) {
      response.headers.set('Cache-Control', 'public, max-age=3600, s-maxage=86400, immutable')
    } else if (route.includes('/notifications/unread')) {
      response.headers.set('Cache-Control', 'private, max-age=5, stale-while-revalidate=10')
    } else {
      response.headers.set('Cache-Control', 'private, max-age=5, stale-while-revalidate=15')
    }
  }

  // 3. Vary header for proper cache keying
  response.headers.set('Vary', 'Authorization, Accept-Encoding')

  logger.info('HTTP', 'request_completed', {
    requestId, method, route, statusCode, latencyMs, ip,
    userId: reqCtx.userId, rateLimited: reqCtx.rateLimited, errorCode: reqCtx.errorCode,
  })
  metrics.recordRequest(route, method, statusCode, latencyMs)
  if (reqCtx.errorCode) metrics.recordError(reqCtx.errorCode)

  return response
}

export const GET = handleRoute
export const POST = handleRoute
export const PUT = handleRoute
export const DELETE = handleRoute
export const PATCH = handleRoute
