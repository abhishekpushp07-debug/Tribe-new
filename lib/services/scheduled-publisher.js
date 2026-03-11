/**
 * Scheduled Post Publisher — Background Worker
 *
 * Polls for draft posts with publishAt <= now and publishes them automatically.
 * Runs every 60 seconds via lazy-init from the content handler.
 */

import { Visibility } from '../constants.js'

let workerStarted = false
const POLL_INTERVAL_MS = 60_000

export function startScheduledPublisher(db) {
  if (workerStarted) return
  workerStarted = true

  async function publishDue() {
    try {
      const now = new Date()
      const duePosts = await db.collection('content_items')
        .find({
          isDraft: true,
          publishAt: { $lte: now, $ne: null },
          visibility: { $ne: Visibility.REMOVED },
        })
        .project({ id: 1, authorId: 1, _id: 0 })
        .limit(50)
        .toArray()

      if (duePosts.length === 0) return

      const ids = duePosts.map(p => p.id)
      await db.collection('content_items').updateMany(
        { id: { $in: ids } },
        { $set: { isDraft: false, visibility: Visibility.PUBLIC, publishAt: null, publishedAt: now, distributionStage: 2, updatedAt: now } }
      )

      // Increment postsCount for each author
      const authorCounts = {}
      for (const p of duePosts) {
        authorCounts[p.authorId] = (authorCounts[p.authorId] || 0) + 1
      }
      for (const [authorId, count] of Object.entries(authorCounts)) {
        await db.collection('users').updateOne({ id: authorId }, { $inc: { postsCount: count } })
      }

      // Audit
      await db.collection('audit_logs').insertOne({
        action: 'SCHEDULED_PUBLISH_BATCH',
        actorId: 'SYSTEM',
        entityType: 'CONTENT',
        details: { publishedCount: duePosts.length, postIds: ids },
        createdAt: now,
      })
    } catch (err) {
      // Non-fatal: log and retry on next interval
    }
  }

  publishDue()
  setInterval(publishDue, POLL_INTERVAL_MS)
}
