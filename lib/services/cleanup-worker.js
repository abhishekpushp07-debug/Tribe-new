/**
 * Tribe — Background Cleanup Worker
 * 
 * Runs periodic cleanup tasks:
 * 1. Expired chunked upload sessions (30min expiry)
 * 2. Orphaned chunk data
 * 3. Expired media upload sessions
 * 4. Stale scheduled posts
 */

let cleanupInterval = null
let isRunning = false

export function startCleanupWorker(db) {
  if (cleanupInterval) return // Already running

  const INTERVAL_MS = 5 * 60 * 1000 // Every 5 minutes

  async function runCleanup() {
    if (isRunning) return
    isRunning = true

    try {
      const now = new Date()

      // 1. Expire chunked upload sessions past their expiry
      const expiredSessions = await db.collection('chunked_upload_sessions').find({
        status: 'UPLOADING',
        expiresAt: { $lt: now },
      }).toArray()

      for (const session of expiredSessions) {
        await db.collection('chunked_upload_sessions').updateOne(
          { id: session.id },
          { $set: { status: 'EXPIRED', updatedAt: now } }
        )
        // Clean up chunk data
        await db.collection('chunked_upload_data').deleteMany({ sessionId: session.id })
      }

      // 2. Clean orphaned chunk data (sessions completed/expired more than 1 hour ago)
      const oneHourAgo = new Date(now.getTime() - 3600000)
      const staleSessionIds = await db.collection('chunked_upload_sessions')
        .find({ status: { $in: ['COMPLETED', 'EXPIRED'] }, updatedAt: { $lt: oneHourAgo } })
        .project({ id: 1, _id: 0 })
        .limit(100)
        .toArray()

      if (staleSessionIds.length > 0) {
        const ids = staleSessionIds.map(s => s.id)
        await db.collection('chunked_upload_data').deleteMany({ sessionId: { $in: ids } })
      }

      // 3. Expire pending media uploads older than 1 hour
      await db.collection('media_assets').updateMany(
        { status: 'PENDING_UPLOAD', createdAt: { $lt: oneHourAgo } },
        { $set: { status: 'EXPIRED', updatedAt: now } }
      )

      // 4. Publish overdue scheduled posts
      const overduePosts = await db.collection('content_items').find({
        isDraft: true,
        publishAt: { $lte: now },
        visibility: 'DRAFT',
      }).limit(20).toArray()

      for (const post of overduePosts) {
        const publishVisibility = post.intendedVisibility || 'PUBLIC'
        const publishStage = publishVisibility === 'PUBLIC' ? 2 : 1
        await db.collection('content_items').updateOne(
          { id: post.id },
          { $set: { isDraft: false, visibility: publishVisibility, distributionStage: publishStage, publishedAt: now, updatedAt: now }, $unset: { intendedVisibility: '' } }
        )
      }

      if (expiredSessions.length > 0 || staleSessionIds.length > 0 || overduePosts.length > 0) {
        console.log(`[Cleanup] Expired ${expiredSessions.length} uploads, cleaned ${staleSessionIds.length} stale sessions, published ${overduePosts.length} scheduled posts`)
      }
    } catch (err) {
      console.error('[Cleanup] Error:', err.message)
    } finally {
      isRunning = false
    }
  }

  // Run immediately on startup, then every 5 minutes
  runCleanup()
  cleanupInterval = setInterval(runCleanup, INTERVAL_MS)
  console.log('[Cleanup] Worker started — runs every 5 minutes')
}

export function stopCleanupWorker() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval)
    cleanupInterval = null
    console.log('[Cleanup] Worker stopped')
  }
}
