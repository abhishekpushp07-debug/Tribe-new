/**
 * Tribe — Moderation Rules Engine (Provider-Agnostic)
 *
 * Stable internal decision engine, provider-agnostic.
 * Converts raw category scores into one stable decision.
 */

const CATEGORY_WEIGHTS = {
  sexualMinors: 1.0,
  selfHarmInstructions: 0.98,
  selfHarmIntent: 0.96,
  violenceGraphic: 0.95,
  hateThreatening: 0.95,
  harassmentThreatening: 0.92,
  illicitViolent: 0.92,
  violence: 0.85,
  hate: 0.82,
  selfHarm: 0.80,
  illicit: 0.78,
  sexual: 0.74,
  harassment: 0.72,
  bullying: 0.70,
  spam: 0.60,
  profanity: 0.45,
}

export function computeRiskScore(scores = {}) {
  let maxWeighted = 0

  for (const [key, value] of Object.entries(scores)) {
    if (typeof value !== 'number') continue
    const weight = CATEGORY_WEIGHTS[key] || 0.5
    const weighted = value * weight
    if (weighted > maxWeighted) maxWeighted = weighted
  }

  return Number(maxWeighted.toFixed(4))
}

export function deriveAction(riskScore, thresholds) {
  if (riskScore >= thresholds.autoReject) return 'REJECT'
  if (riskScore >= thresholds.escalate) return 'ESCALATE'
  return 'ALLOW'
}

export function extractFlaggedCategories(scores = {}, cutoff = 0.35) {
  return Object.entries(scores)
    .filter(([, value]) => typeof value === 'number' && value >= cutoff)
    .map(([key]) => key)
}
