/**
 * Tribe B5 — Hashtag Service
 * Extraction, normalization, and persistence for hashtags.
 *
 * Normalization rules:
 *   - Lowercase
 *   - Strip leading "#"
 *   - Must be 1-50 chars after strip
 *   - Must match /^[a-z0-9_]+$/ (alphanumeric + underscore)
 *   - Deduplicate within a single post
 */

const HASHTAG_REGEX = /#([a-zA-Z0-9_]+)/g
const MAX_TAG_LENGTH = 50
const VALID_TAG_PATTERN = /^[a-z0-9_]+$/

/**
 * Extract and normalize hashtags from text.
 * Returns a deduplicated array of normalized tags.
 */
export function extractHashtags(text) {
  if (!text || typeof text !== 'string') return []

  const seen = new Set()
  const tags = []
  let match

  while ((match = HASHTAG_REGEX.exec(text)) !== null) {
    const raw = match[1].toLowerCase()
    if (raw.length > 0 && raw.length <= MAX_TAG_LENGTH && VALID_TAG_PATTERN.test(raw) && !seen.has(raw)) {
      seen.add(raw)
      tags.push(raw)
    }
  }

  return tags
}

/**
 * Sync hashtag collection stats after create/edit.
 * Increments count for added tags, decrements for removed tags.
 */
export async function syncHashtags(db, oldTags, newTags) {
  const oldSet = new Set(oldTags || [])
  const newSet = new Set(newTags || [])

  const added = newTags.filter(t => !oldSet.has(t))
  const removed = (oldTags || []).filter(t => !newSet.has(t))

  const ops = []

  for (const tag of added) {
    ops.push(
      db.collection('hashtags').updateOne(
        { tag },
        {
          $inc: { postCount: 1 },
          $set: { lastUsedAt: new Date(), updatedAt: new Date() },
          $setOnInsert: { tag, createdAt: new Date() },
        },
        { upsert: true }
      )
    )
  }

  for (const tag of removed) {
    ops.push(
      db.collection('hashtags').updateOne(
        { tag, postCount: { $gt: 0 } },
        {
          $inc: { postCount: -1 },
          $set: { updatedAt: new Date() },
        }
      )
    )
  }

  if (ops.length > 0) {
    await Promise.all(ops)
  }
}
