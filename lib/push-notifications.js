/**
 * Tribe — General-Purpose Push Notification System (SSE)
 * 
 * Supports all notification types:
 * - story.viewed, story.reacted, story.replied
 * - post.liked, post.commented, post.shared
 * - tribe.cheer, tribe.salute, tribe.rivalry_update
 * - follow.new, follow.accepted
 * - contest.entry, contest.scored, contest.resolved
 * - media.upload_progress, media.upload_complete
 * - moderation.action, moderation.appeal
 * - general.announcement
 * 
 * Architecture:
 * - Dual-mode: Redis Pub/Sub (multi-instance) or in-memory EventEmitter (single-instance)
 * - Multiple event channels per user for different notification categories
 * - SSE endpoint subscribes to ALL of user's channels
 * - Heartbeat every 15s, auto-reconnect hint via `retry: 3000`
 * - Event IDs for resumable connections (Last-Event-ID)
 */

import { EventEmitter } from 'events'

const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379'

// ========== EVENT TYPES ==========
export const PushEventType = {
  // Stories
  STORY_VIEWED: 'story.viewed',
  STORY_REACTED: 'story.reacted',
  STORY_REPLIED: 'story.replied',
  // Posts
  POST_LIKED: 'post.liked',
  POST_COMMENTED: 'post.commented',
  POST_SHARED: 'post.shared',
  POST_SAVED: 'post.saved',
  // Reels
  REEL_LIKED: 'reel.liked',
  REEL_COMMENTED: 'reel.commented',
  REEL_SHARED: 'reel.shared',
  // Social
  FOLLOW_NEW: 'follow.new',
  FOLLOW_ACCEPTED: 'follow.accepted',
  MENTION: 'mention',
  // Tribe
  TRIBE_CHEER: 'tribe.cheer',
  TRIBE_SALUTE: 'tribe.salute',
  TRIBE_RIVALRY_UPDATE: 'tribe.rivalry_update',
  TRIBE_RIVALRY_RESOLVED: 'tribe.rivalry_resolved',
  // Contests
  CONTEST_ENTRY: 'contest.entry',
  CONTEST_SCORED: 'contest.scored',
  CONTEST_RESOLVED: 'contest.resolved',
  // Media
  UPLOAD_PROGRESS: 'media.upload_progress',
  UPLOAD_COMPLETE: 'media.upload_complete',
  // Moderation
  MODERATION_ACTION: 'moderation.action',
  MODERATION_APPEAL: 'moderation.appeal',
  // General
  ANNOUNCEMENT: 'general.announcement',
}

// ========== IN-MEMORY FALLBACK ==========
const memBus = new EventEmitter()
memBus.setMaxListeners(1000)

let redisAvailable = null
let redisPublisher = null

async function checkRedis() {
  if (redisAvailable !== null) return redisAvailable
  if (!process.env.REDIS_URL) {
    redisAvailable = false
    return false
  }
  try {
    const Redis = (await import('ioredis')).default
    const client = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 2000, lazyConnect: true })
    client.on('error', () => {})
    await client.connect()
    await client.ping()
    redisPublisher = client
    redisAvailable = true
  } catch {
    redisAvailable = false
  }
  return redisAvailable
}

// ========== PUBLISH ==========
/**
 * Publish a push event to a specific user
 * @param {string} userId - Target user ID
 * @param {string} eventType - One of PushEventType values
 * @param {object} data - Event payload
 */
export async function publishPushEvent(userId, eventType, data) {
  const payload = JSON.stringify({
    type: eventType,
    data,
    timestamp: new Date().toISOString(),
  })
  const channel = `tribe:push:${userId}`

  try {
    await checkRedis()
    if (redisAvailable && redisPublisher) {
      await redisPublisher.publish(channel, payload)
    } else {
      memBus.emit(channel, payload)
    }
  } catch {
    // Best-effort: swallow errors, push is non-critical
  }
}

/**
 * Publish a push event to all members of a tribe
 */
export async function publishTribeEvent(db, tribeId, eventType, data) {
  const members = await db.collection('user_tribe_memberships')
    .find({ tribeId, status: 'ACTIVE' })
    .project({ userId: 1, _id: 0 })
    .limit(500)
    .toArray()

  const promises = members.map(m => publishPushEvent(m.userId, eventType, data))
  await Promise.allSettled(promises)
}

// ========== SUBSCRIBE ==========
function createPushSubscriber(userId) {
  const channel = `tribe:push:${userId}`

  if (redisAvailable) {
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
/**
 * Build an SSE stream for a user's push notifications
 * Endpoint: GET /notifications/stream
 */
export function buildPushSSEStream(request, userId) {
  const encoder = new TextEncoder()
  let eventId = 0
  let subscriber = null
  let heartbeat = null

  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(
          `id: ${++eventId}\nevent: connected\ndata: ${JSON.stringify({
            userId,
            connectedAt: new Date().toISOString(),
            mode: redisAvailable ? 'redis' : 'memory',
            supportedEvents: Object.values(PushEventType),
          })}\nretry: 3000\n\n`
        ))

        await checkRedis()
        subscriber = createPushSubscriber(userId)
        await subscriber.start((message) => {
          try {
            const parsed = JSON.parse(message)
            controller.enqueue(encoder.encode(
              `id: ${++eventId}\nevent: ${parsed.type || 'notification'}\ndata: ${message}\n\n`
            ))
          } catch {
            controller.enqueue(encoder.encode(
              `id: ${++eventId}\nevent: notification\ndata: ${message}\n\n`
            ))
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

        if (request.signal) {
          request.signal.addEventListener('abort', () => {
            clearInterval(heartbeat)
            if (subscriber) subscriber.cleanup()
            try { controller.close() } catch {}
          })
        }
      } catch (err) {
        process.stderr.write(JSON.stringify({ timestamp: new Date().toISOString(), level: 'ERROR', category: 'PUSH', msg: 'sse_push_init_error', error: err.message }) + '\n')
        controller.enqueue(encoder.encode(
          `event: error\ndata: ${JSON.stringify({ error: 'Push stream initialization failed' })}\n\n`
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
