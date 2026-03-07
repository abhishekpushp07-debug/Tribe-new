/**
 * Tribe — Moderation Middleware for Content Creation
 *
 * Reusable middleware for posts/comments/stories/reels.
 * Adapted for Next.js handler pattern (not Express).
 */

import { MongoModerationRepository } from '../repositories/moderation.repository.js'
import { ModerationService } from '../services/moderation.service.js'

/**
 * Run moderation on content before creation.
 * Returns { decision, reviewTicketId } on ALLOW/ESCALATE.
 * Throws structured error on REJECT.
 *
 * @param {import('mongodb').Db} db
 * @param {object} input - ModerationInput shape
 * @returns {Promise<{ decision: object, reviewTicketId?: string }>}
 */
export async function moderateCreateContent(db, input) {
  const repo = new MongoModerationRepository(db)
  const service = new ModerationService(repo)
  return await service.moderateOrThrow(input)
}

/**
 * Get moderation config via the service layer.
 *
 * @param {import('mongodb').Db} db
 * @returns {object}
 */
export function getModerationServiceConfig(db) {
  const repo = new MongoModerationRepository(db)
  const service = new ModerationService(repo)
  return service.getConfig()
}
