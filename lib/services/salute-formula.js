/**
 * Tribe — Canonical Salute Formula Service v1
 * 
 * SINGLE source of truth for all salute calculations.
 * No magic numbers scattered across handlers.
 * 
 * Formula v1:
 *   LIKE       = 50 salutes
 *   COMMENT    = 200 salutes
 *   SHARE      = 100 salutes
 *   REEL_VIEW  = 5 salutes (qualified: >3s watch)
 *   STORY_VIEW = 2 salutes
 *   SAVE       = 75 salutes
 * 
 * Rules:
 *   - Self-engagement: BLOCKED (no salute for own content)
 *   - Duplicate: idempotent (same actor+content+type = no double award)
 *   - Reversal: on unlike/unsave, reverse salute
 *   - Deleted content: salutes remain (already earned)
 *   - Held/moderated: salutes still count
 */

import { v4 as uuidv4 } from 'uuid'

export const SALUTE_FORMULA_VERSION = 'v1'

export const SALUTE_WEIGHTS = {
  POST_LIKE: 50,
  POST_COMMENT: 200,
  POST_SHARE: 100,
  POST_SAVE: 75,
  REEL_LIKE: 50,
  REEL_COMMENT: 200,
  REEL_SHARE: 100,
  REEL_SAVE: 75,
  REEL_VIEW: 5,
  STORY_VIEW: 2,
  STORY_REACTION: 50,
}

/**
 * Award salute — idempotent, self-farming blocked
 * Returns { awarded, points, reason }
 */
export async function awardSalute(db, { type, fromUserId, toUserId, contentId, contentType }) {
  // Rule: no self-farming
  if (fromUserId === toUserId) {
    return { awarded: false, points: 0, reason: 'self_engagement' }
  }

  const points = SALUTE_WEIGHTS[type] || 0
  if (points === 0) return { awarded: false, points: 0, reason: 'unknown_type' }

  // Rule: idempotent — same actor+content+type = no double
  const dedupeKey = `${fromUserId}:${contentId}:${type}`
  const existing = await db.collection('salutes').findOne({ dedupeKey })
  if (existing) return { awarded: false, points: 0, reason: 'duplicate' }

  // Get beneficiary tribe
  const beneficiary = await db.collection('users').findOne({ id: toUserId }, { projection: { _id: 0, tribeId: 1, tribeCode: 1 } })

  const salute = {
    id: uuidv4(),
    dedupeKey,
    type,
    points,
    fromUserId,
    toUserId,
    contentId: contentId || '',
    contentType: contentType || '',
    tribeId: beneficiary?.tribeId || '',
    tribeCode: beneficiary?.tribeCode || '',
    formulaVersion: SALUTE_FORMULA_VERSION,
    reversed: false,
    createdAt: new Date(),
  }

  await db.collection('salutes').insertOne(salute)
  await db.collection('users').updateOne({ id: toUserId }, { $inc: { saluteCount: points } })

  return { awarded: true, points, reason: 'ok' }
}

/**
 * Reverse salute — on unlike/unsave
 */
export async function reverseSalute(db, { type, fromUserId, contentId }) {
  const dedupeKey = `${fromUserId}:${contentId}:${type}`
  const salute = await db.collection('salutes').findOne({ dedupeKey, reversed: false })
  if (!salute) return { reversed: false, reason: 'not_found' }

  await db.collection('salutes').updateOne({ id: salute.id }, { $set: { reversed: true, reversedAt: new Date() } })
  await db.collection('users').updateOne({ id: salute.toUserId }, { $inc: { saluteCount: -salute.points } })

  return { reversed: true, points: salute.points }
}

/**
 * Get formula config (for admin/debug)
 */
export function getFormulaConfig() {
  return { version: SALUTE_FORMULA_VERSION, weights: SALUTE_WEIGHTS }
}
