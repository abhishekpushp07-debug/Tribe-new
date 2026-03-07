/**
 * Tribe — Moderation Config (ENV-driven provider selection)
 *
 * Single source of truth for moderation config and provider switching.
 * Change provider with MODERATION_PROVIDER env var. Zero handler refactor.
 */

function toBool(v, fallback = false) {
  if (v === undefined || v === null) return fallback
  return String(v).toLowerCase() === 'true'
}

function toNum(v, fallback) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export const moderationConfig = {
  provider: process.env.MODERATION_PROVIDER || 'composite',
  failOpen: toBool(process.env.MODERATION_FAIL_OPEN, false),
  openAiTimeoutMs: toNum(process.env.MODERATION_OPENAI_TIMEOUT_MS, 5000),
  openAiModel: process.env.MODERATION_OPENAI_MODEL || 'omni-moderation-latest',
  openAiApiKey: process.env.OPENAI_API_KEY || '',
  openAiBaseUrl: process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1',
  thresholds: {
    autoReject: toNum(process.env.MODERATION_AUTO_REJECT_THRESHOLD, 0.85),
    escalate: toNum(process.env.MODERATION_ESCALATE_THRESHOLD, 0.50),
  },
}
