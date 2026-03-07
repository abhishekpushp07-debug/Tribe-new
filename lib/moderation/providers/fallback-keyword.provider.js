/**
 * Tribe — Keyword Fallback Moderation Provider
 *
 * Backup-only fallback provider. Keeps platform safe if OpenAI is down or key missing.
 */

import { moderationConfig } from '../config.js'
import { computeRiskScore, deriveAction, extractFlaggedCategories } from '../rules.js'

const KEYWORD_GROUPS = [
  {
    category: 'sexualMinors',
    weight: 0.99,
    reason: 'Possible CSAM/minor-sexual content terms detected',
    patterns: [/underage/i, /child porn/i, /minor sexual/i],
  },
  {
    category: 'selfHarmInstructions',
    weight: 0.98,
    reason: 'Self-harm instruction terms detected',
    patterns: [/how to kill myself/i, /suicide method/i, /cut yourself/i],
  },
  {
    category: 'hateThreatening',
    weight: 0.94,
    reason: 'Threat + hate terms detected',
    patterns: [/kill all (?:muslims|hindus|christians|dalits|women)/i],
  },
  {
    category: 'violenceGraphic',
    weight: 0.92,
    reason: 'Graphic violence terms detected',
    patterns: [/behead/i, /cut his throat/i, /blood everywhere/i],
  },
  {
    category: 'harassmentThreatening',
    weight: 0.82,
    reason: 'Threatening harassment detected',
    patterns: [/i will kill you/i, /rape you/i, /acid attack/i],
  },
  {
    category: 'spam',
    weight: 0.65,
    reason: 'Spam/scam terms detected',
    patterns: [/free money/i, /guaranteed followers/i, /earn \d+ daily/i],
  },
  {
    category: 'profanity',
    weight: 0.45,
    reason: 'Strong profanity detected',
    patterns: [/\bfuck\b/i, /\bmc\b/i, /\bbc\b/i],
  },
]

export class FallbackKeywordModerationProvider {
  constructor() {
    this.name = 'fallback'
  }

  async check(input) {
    const combined = [input.title, input.caption, input.description, input.text]
      .filter(Boolean)
      .join('\n')
      .trim()

    const scores = {}
    const reasons = []

    for (const group of KEYWORD_GROUPS) {
      for (const pattern of group.patterns) {
        if (pattern.test(combined)) {
          scores[group.category] = Math.max(scores[group.category] || 0, group.weight)
          reasons.push(group.reason)
        }
      }
    }

    const confidence = computeRiskScore(scores)
    const action = deriveAction(confidence, moderationConfig.thresholds)
    const flaggedCategories = extractFlaggedCategories(scores)

    return {
      action,
      confidence,
      reasons,
      flaggedCategories,
      scores,
      provider: this.name,
      providerModel: 'keyword-fallback-v1',
      raw: { textLength: combined.length },
    }
  }
}
