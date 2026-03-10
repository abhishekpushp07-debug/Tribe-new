/**
 * Tribe — B3: Page Slug Utilities
 * Slug normalization, validation, reserved slug protection, and official spoof detection.
 */

const RESERVED_SLUGS = new Set([
  'admin', 'api', 'auth', 'me', 'settings', 'pages', 'search',
  'official', 'support', 'moderator', 'tribe', 'college', 'house',
  'feed', 'content', 'media', 'notifications', 'reports', 'help',
  'about', 'terms', 'privacy', 'null', 'undefined', 'system',
])

export function normalizeSlug(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
}

export function validateSlug(slug) {
  if (!slug || slug.length < 3) return 'Slug must be at least 3 characters'
  if (slug.length > 40) return 'Slug must be at most 40 characters'
  if (!/^[a-z0-9][a-z0-9\-_]*[a-z0-9]$/.test(slug) && slug.length > 2) {
    if (!/^[a-z0-9]{3,}$/.test(slug) && !/^[a-z0-9][a-z0-9\-_]*[a-z0-9]$/.test(slug)) {
      return 'Slug must start and end with a letter or number, and contain only lowercase letters, numbers, hyphens, and underscores'
    }
  }
  if (RESERVED_SLUGS.has(slug)) return 'This slug is reserved'
  return null
}

export function containsOfficialSpoof(text) {
  const v = String(text || '').toLowerCase()
  return /\bofficial\b/.test(v)
}
