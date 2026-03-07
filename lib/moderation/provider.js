/**
 * Tribe — Provider Factory (ENV-driven selection)
 *
 * One factory. Handlers/services never import concrete providers directly.
 *
 * Swap provider: change MODERATION_PROVIDER env var → zero handler refactor.
 *   MODERATION_PROVIDER=fallback   → keyword only
 *   MODERATION_PROVIDER=openai     → OpenAI Moderations API (needs OPENAI_API_KEY)
 *   MODERATION_PROVIDER=composite  → OpenAI primary + fallback secondary (default)
 */

import { moderationConfig } from './config.js'
import { FallbackKeywordModerationProvider } from './providers/fallback-keyword.provider.js'
import { OpenAIModerationProvider } from './providers/openai.provider.js'
import { CompositeModerationProvider } from './providers/composite.provider.js'

let singleton = null

export function getModerationProvider() {
  if (singleton) return singleton

  const fallback = new FallbackKeywordModerationProvider()
  const openai = new OpenAIModerationProvider()

  switch (moderationConfig.provider) {
    case 'fallback':
      singleton = fallback
      break
    case 'openai':
      singleton = openai
      break
    case 'composite':
    default:
      singleton = new CompositeModerationProvider({
        primary: openai,
        secondary: fallback,
      })
      break
  }

  return singleton
}
