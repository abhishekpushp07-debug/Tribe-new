/**
 * Tribe — Moderation Service (Orchestrator)
 *
 * Single orchestration layer used by posts/comments/stories/reels.
 * Handlers call THIS, never providers directly.
 * Provider swap = env change. Zero handler refactor.
 */

import { getModerationProvider } from '../provider.js'
import { moderationConfig } from '../config.js'

export class ModerationService {
  constructor(repo) {
    this.repo = repo
    this.provider = getModerationProvider()
  }

  async moderateOrThrow(input) {
    let decision

    try {
      decision = await this.provider.check(input)
    } catch (error) {
      if (moderationConfig.failOpen) {
        decision = {
          action: 'ALLOW',
          confidence: 0,
          reasons: [
            'Provider unavailable; fail-open active',
            error && error.message ? error.message : 'UNKNOWN_ERROR',
          ],
          flaggedCategories: [],
          scores: {},
          provider: this.provider.name,
        }
      } else {
        decision = {
          action: 'ESCALATE',
          confidence: 1,
          reasons: [
            'Provider unavailable; fail-closed to manual review',
            error && error.message ? error.message : 'UNKNOWN_ERROR',
          ],
          flaggedCategories: ['provider_unavailable'],
          scores: {},
          provider: this.provider.name,
        }
      }
    }

    // Audit log (provider-agnostic schema)
    await this.repo.saveAudit({
      entityType: input.entityType,
      entityId: input.entityId,
      actorUserId: input.actorUserId,
      provider: decision.provider,
      providerModel: decision.providerModel,
      action: decision.action,
      confidence: decision.confidence,
      reasons: decision.reasons,
      flaggedCategories: decision.flaggedCategories,
      scores: decision.scores,
      raw: decision.raw,
      createdAt: new Date(),
      metadata: input.metadata || {},
    })

    // Create review ticket for ESCALATE
    let reviewTicketId
    if (decision.action === 'ESCALATE') {
      reviewTicketId = await this.repo.createReviewTicket({
        entityType: input.entityType,
        entityId: input.entityId,
        actorUserId: input.actorUserId,
        action: decision.action,
        confidence: decision.confidence,
        reasons: decision.reasons,
        createdAt: new Date(),
        payload: {
          text: input.text,
          title: input.title,
          caption: input.caption,
        },
      })
    }

    // REJECT → throw structured error
    if (decision.action === 'REJECT') {
      const err = new Error('CONTENT_REJECTED_BY_MODERATION')
      err.statusCode = 422
      err.details = {
        code: 'CONTENT_REJECTED_BY_MODERATION',
        reviewTicketId,
        moderation: {
          action: decision.action,
          confidence: decision.confidence,
          reasons: decision.reasons,
          flaggedCategories: decision.flaggedCategories,
        },
      }
      throw err
    }

    return { decision, reviewTicketId }
  }

  getConfig() {
    return {
      provider: moderationConfig.provider,
      failOpen: moderationConfig.failOpen,
      thresholds: moderationConfig.thresholds,
      activeProvider: this.provider.name,
      providerChain: moderationConfig.provider === 'composite'
        ? ['openai', 'fallback']
        : [moderationConfig.provider],
    }
  }
}
