/**
 * Tribe — Composite Moderation Provider
 *
 * OpenAI primary, fallback secondary.
 * Handler code remains unchanged even if provider changes later.
 */

import { moderationConfig } from '../config.js'

export class CompositeModerationProvider {
  constructor({ primary, secondary }) {
    this.name = 'composite'
    this.primary = primary
    this.secondary = secondary
  }

  async check(input) {
    try {
      const primaryResult = await this.primary.check(input)
      return {
        ...primaryResult,
        provider: 'composite',
        raw: {
          primaryProvider: this.primary.name,
          primaryRaw: primaryResult.raw,
        },
      }
    } catch (error) {
      const fallbackResult = await this.secondary.check(input)
      return {
        ...fallbackResult,
        provider: 'composite',
        reasons: [
          ...fallbackResult.reasons,
          'Primary provider failed; fallback used',
        ],
        raw: {
          primaryProvider: this.primary.name,
          fallbackProvider: this.secondary.name,
          primaryError: error && error.message ? error.message : 'UNKNOWN_PRIMARY_ERROR',
          fallbackRaw: fallbackResult.raw,
          failOpen: moderationConfig.failOpen,
        },
      }
    }
  }
}
