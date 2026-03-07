/**
 * Tribe — OpenAI Moderation Provider
 *
 * Official OpenAI Moderations API provider.
 * This is the primary provider in production.
 */

import { moderationConfig } from '../config.js'
import { computeRiskScore, deriveAction, extractFlaggedCategories } from '../rules.js'

function mapOpenAICategoryScores(raw = {}) {
  return {
    harassment: raw['harassment'],
    harassmentThreatening: raw['harassment/threatening'],
    hate: raw['hate'],
    hateThreatening: raw['hate/threatening'],
    illicit: raw['illicit'],
    illicitViolent: raw['illicit/violent'],
    selfHarm: raw['self-harm'],
    selfHarmIntent: raw['self-harm/intent'],
    selfHarmInstructions: raw['self-harm/instructions'],
    sexual: raw['sexual'],
    sexualMinors: raw['sexual/minors'],
    violence: raw['violence'],
    violenceGraphic: raw['violence/graphic'],
  }
}

export class OpenAIModerationProvider {
  constructor() {
    this.name = 'openai'
  }

  async check(input) {
    if (!moderationConfig.openAiApiKey) {
      throw new Error('OPENAI_API_KEY_MISSING')
    }

    const text = [input.title, input.caption, input.description, input.text]
      .filter(Boolean)
      .join('\n')
      .trim()

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), moderationConfig.openAiTimeoutMs)

    try {
      const res = await fetch(`${moderationConfig.openAiBaseUrl}/moderations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${moderationConfig.openAiApiKey}`,
        },
        body: JSON.stringify({
          model: moderationConfig.openAiModel,
          input: text,
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const err = await res.text()
        throw new Error(`OPENAI_MODERATION_HTTP_${res.status}: ${err}`)
      }

      const json = await res.json()
      const first = json.results && json.results[0] ? json.results[0] : {}
      const scores = mapOpenAICategoryScores(first.category_scores || {})

      const confidence = computeRiskScore(scores)
      const action = deriveAction(confidence, moderationConfig.thresholds)
      const flaggedCategories = extractFlaggedCategories(scores)
      const reasons = flaggedCategories.length
        ? flaggedCategories.map((c) => `Flagged category: ${c}`)
        : ['No flagged categories above internal cutoff']

      return {
        action,
        confidence,
        reasons,
        flaggedCategories,
        scores,
        provider: this.name,
        providerModel: json.model,
        raw: json,
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
