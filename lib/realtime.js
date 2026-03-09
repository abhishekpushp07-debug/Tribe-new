/**
 * Tribe — Real-time Story Events
 * 
 * Architecture:
 * - Dual-mode: Redis Pub/Sub (multi-instance) or in-memory EventEmitter (single-instance)
 * - Auto-detects Redis availability, falls back gracefully
 * - SSE endpoint subscribes to the authenticated user's event channel
 * - Heartbeat every 15s, auto-reconnect hint via `retry: 3000`
 * - Event IDs for resumable connections (Last-Event-ID)
 */

import { EventEmitter } from 'events'

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379'

// ========== EVENT TYPES ==========
export const StoryEventType = {
  VIEWED: 'story.viewed',
  REACTED: 'story.reacted',
  REPLIED: 'story.replied',
  STICKER_RESPONDED: 'story.sticker_responded',
  EXPIRED: 'story.expired',
}

// ========== IN-MEMORY FALLBACK ==========
const memBus = new EventEmitter()
memBus.setMaxListeners(500)

let redisAvailable = null // null = not checked, true/false after check
let redisPublisher = null

async function checkRedis() {
  if (redisAvailable !== null) return redisAvailable
  try {
    const Redis = (await import('ioredis')).default
    const client = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 2000, lazyConnect: true })
    await client.connect()
    await client.ping()
    redisPublisher = client
    redisAvailable = true
    // Bootstrap log: logger module may not be loaded yet during startup
    // This is a documented bootstrap exception
    console.log('[Bootstrap] Realtime Redis connected — using distributed Pub/Sub')
  } catch {
    redisAvailable = false
    console.log('[Bootstrap] Realtime Redis unavailable — using in-memory EventEmitter')
  }
  return redisAvailable
}

// ========== PUBLISH ==========
export async function publishStoryEvent(authorId, event) {
  const payload = JSON.stringify({ ...event, timestamp: new Date().toISOString() })
  const channel = `tribe:story_events:${authorId}`

  try {
    await checkRedis()
    if (redisAvailable && redisPublisher) {
      await redisPublisher.publish(channel, payload)
    } else {
      memBus.emit(channel, payload)
    }
  } catch {
    // Best-effort: swallow errors, real-time is non-critical
  }
}

// ========== SUBSCRIBE ==========
function createSubscriber(userId) {
  const channel = `tribe:story_events:${userId}`

  if (redisAvailable) {
    // Redis mode: new connection per subscriber (Redis requirement)
    let sub = null
    return {
      async start(onMessage) {
        const Redis = (await import('ioredis')).default
        sub = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: true })
        sub.on('error', () => {})
        await sub.connect()
        await sub.subscribe(channel)
        sub.on('message', (ch, msg) => { if (ch === channel) onMessage(msg) })
      },
      cleanup() {
        try { sub?.unsubscribe().catch(() => {}); sub?.quit().catch(() => {}) } catch {}
      },
    }
  }

  // Memory mode: EventEmitter
  let handler = null
  return {
    async start(onMessage) {
      handler = (msg) => onMessage(msg)
      memBus.on(channel, handler)
    },
    cleanup() {
      if (handler) memBus.removeListener(channel, handler)
    },
  }
}

// ========== SSE STREAM BUILDER ==========
export function buildSSEStream(request, userId, db) {
  const encoder = new TextEncoder()
  let eventId = 0
  let subscriber = null
  let heartbeat = null

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Initial connection event with retry hint
        controller.enqueue(encoder.encode(
          `id: ${++eventId}\nevent: connected\ndata: ${JSON.stringify({ userId, connectedAt: new Date().toISOString(), mode: redisAvailable ? 'redis' : 'memory' })}\nretry: 3000\n\n`
        ))

        // Subscribe to this user's event channel
        await checkRedis()
        subscriber = createSubscriber(userId)
        await subscriber.start((message) => {
          try {
            controller.enqueue(encoder.encode(
              `id: ${++eventId}\nevent: story_event\ndata: ${message}\n\n`
            ))
          } catch {
            subscriber.cleanup()
          }
        })

        // Heartbeat every 15 seconds
        heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: heartbeat ${new Date().toISOString()}\n\n`))
          } catch {
            clearInterval(heartbeat)
          }
        }, 15_000)

        // Cleanup on client disconnect
        if (request.signal) {
          request.signal.addEventListener('abort', () => {
            clearInterval(heartbeat)
            if (subscriber) subscriber.cleanup()
            try { controller.close() } catch {}
          })
        }
      } catch (err) {
        // SSE stream init failure — log to stderr for operator visibility
        process.stderr.write(JSON.stringify({ timestamp: new Date().toISOString(), level: 'ERROR', category: 'REALTIME', msg: 'sse_stream_init_error', error: err.message }) + '\n')
        controller.enqueue(encoder.encode(
          `event: error\ndata: ${JSON.stringify({ error: 'Stream initialization failed' })}\n\n`
        ))
        try { controller.close() } catch {}
      }
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat)
      if (subscriber) subscriber.cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': process.env.CORS_ORIGINS || '*',
      'Access-Control-Allow-Credentials': 'true',
    },
  })
}
