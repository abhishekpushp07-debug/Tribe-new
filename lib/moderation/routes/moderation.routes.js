/**
 * Tribe — Moderation Routes Handler
 *
 * All moderation-specific API endpoints.
 * Uses ModerationService — never calls providers directly.
 */

import { moderateCreateContent, getModerationServiceConfig } from '../middleware/moderate-create-content.js'

export async function handleModerationRoutes(path, method, request, db) {
  const route = path.join('/')

  // GET /moderation/config — Return current moderation configuration
  if (route === 'moderation/config' && method === 'GET') {
    const config = getModerationServiceConfig(db)
    return { data: config }
  }

  // POST /moderation/check — Run moderation check on arbitrary text
  if (route === 'moderation/check' && method === 'POST') {
    const body = await request.json()
    if (!body.text) {
      return { error: 'text is required', code: 'VALIDATION', status: 400 }
    }

    try {
      const result = await moderateCreateContent(db, {
        entityType: 'manual_check',
        actorUserId: 'system',
        text: body.text,
        title: body.title,
        caption: body.caption,
        metadata: { route: 'POST /moderation/check' },
      })

      return {
        data: {
          action: result.decision.action,
          confidence: result.decision.confidence,
          reasons: result.decision.reasons,
          flaggedCategories: result.decision.flaggedCategories,
          scores: result.decision.scores,
          provider: result.decision.provider,
          providerModel: result.decision.providerModel,
          reviewTicketId: result.reviewTicketId || null,
        },
      }
    } catch (err) {
      if (err.details?.code === 'CONTENT_REJECTED_BY_MODERATION') {
        return {
          data: {
            action: 'REJECT',
            confidence: err.details.moderation.confidence,
            reasons: err.details.moderation.reasons,
            flaggedCategories: err.details.moderation.flaggedCategories,
            reviewTicketId: err.details.reviewTicketId || null,
          },
        }
      }
      return { error: err.message, code: 'INTERNAL', status: 500 }
    }
  }

  return null
}
