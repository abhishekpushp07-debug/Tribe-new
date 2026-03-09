/**
 * Tribe — Structured JSON Logger (Stage 3)
 *
 * JSON-structured, level-filtered, PII-safe logging for all runtime paths.
 * Output: NDJSON (one JSON object per line) for container log aggregation.
 *
 * Levels: DEBUG < INFO < WARN < ERROR < FATAL
 * Categories: HTTP, AUTH, RATE_LIMIT, SECURITY, AUDIT, HEALTH, CACHE, REALTIME, MODERATION, STORAGE, SYSTEM
 *
 * Bootstrap exception: raw console.* allowed only for pre-module initialization
 * (Redis/DB client startup in cache.js, realtime.js). All active request paths
 * MUST use this logger.
 */

const LOG_LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3, FATAL: 4 }
const currentLevel = LOG_LEVELS[(process.env.LOG_LEVEL || 'INFO').toUpperCase()] ?? LOG_LEVELS.INFO

// Fields that must NEVER appear in logs (case-insensitive match)
const REDACT_KEYS = new Set([
  'token', 'accesstoken', 'refreshtoken',
  'pin', 'currentpin', 'newpin',
  'pinhash', 'pinsalt',
  'password', 'secret', 'authorization',
  'cookie', 'x-auth-token',
])

function redactPII(obj, depth = 0) {
  if (depth > 5 || obj === null || obj === undefined) return obj
  if (typeof obj !== 'object') return obj
  if (obj instanceof Date) return obj.toISOString()
  if (Array.isArray(obj)) return obj.map(item => redactPII(item, depth + 1))

  const safe = {}
  for (const [key, value] of Object.entries(obj)) {
    if (REDACT_KEYS.has(key.toLowerCase())) {
      safe[key] = '***REDACTED***'
    } else if (typeof value === 'object' && value !== null) {
      safe[key] = redactPII(value, depth + 1)
    } else {
      safe[key] = value
    }
  }
  return safe
}

function emit(level, category, message, context = {}) {
  if (LOG_LEVELS[level] < currentLevel) return

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    category,
    msg: message,
  }

  // Flatten context into entry (PII-safe)
  if (context && typeof context === 'object') {
    const safe = redactPII(context)
    for (const [key, value] of Object.entries(safe)) {
      if (value !== undefined && value !== null) {
        entry[key] = value
      }
    }
  }

  const json = JSON.stringify(entry)

  if (LOG_LEVELS[level] >= LOG_LEVELS.ERROR) {
    process.stderr.write(json + '\n')
  } else {
    process.stdout.write(json + '\n')
  }
}

export const logger = {
  debug: (category, message, context) => emit('DEBUG', category, message, context),
  info:  (category, message, context) => emit('INFO',  category, message, context),
  warn:  (category, message, context) => emit('WARN',  category, message, context),
  error: (category, message, context) => emit('ERROR', category, message, context),
  fatal: (category, message, context) => emit('FATAL', category, message, context),
}

export default logger
