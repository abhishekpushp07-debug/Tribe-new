import crypto from 'crypto'

// ========== 12 HOUSES ==========
// Deterministic assignment at signup: SHA256(userId) mod 12
// Permanent. Cannot be changed.
export const HOUSES = [
  {
    slug: 'aryabhatta',
    name: 'Aryabhatta',
    motto: 'Numbers illuminate the universe',
    color: '#3B82F6',
    domain: 'Mathematics & Innovation',
    icon: 'calculator',
  },
  {
    slug: 'chanakya',
    name: 'Chanakya',
    motto: 'Strategy conquers chaos',
    color: '#8B5CF6',
    domain: 'Strategy & Leadership',
    icon: 'crown',
  },
  {
    slug: 'shivaji',
    name: 'Veer Shivaji',
    motto: 'Courage is the first virtue',
    color: '#F97316',
    domain: 'Courage & Valor',
    icon: 'sword',
  },
  {
    slug: 'saraswati',
    name: 'Saraswati',
    motto: 'Knowledge flows like a river',
    color: '#F0F0F0',
    domain: 'Knowledge & Arts',
    icon: 'book-open',
  },
  {
    slug: 'dhoni',
    name: 'Dhoni',
    motto: 'Cool under fire, finish strong',
    color: '#EAB308',
    domain: 'Persistence & Composure',
    icon: 'target',
  },
  {
    slug: 'kalpana',
    name: 'Kalpana',
    motto: 'The sky is not the limit',
    color: '#14B8A6',
    domain: 'Dreams & Exploration',
    icon: 'rocket',
  },
  {
    slug: 'raman',
    name: 'Raman',
    motto: 'Question everything, prove it',
    color: '#22C55E',
    domain: 'Discovery & Science',
    icon: 'microscope',
  },
  {
    slug: 'lakshmibai',
    name: 'Rani Lakshmibai',
    motto: 'Freedom is never given, it is won',
    color: '#EF4444',
    domain: 'Justice & Fearlessness',
    icon: 'flame',
  },
  {
    slug: 'tagore',
    name: 'Tagore',
    motto: 'Where the mind is without fear',
    color: '#D4A843',
    domain: 'Creativity & Expression',
    icon: 'feather',
  },
  {
    slug: 'kalam',
    name: 'APJ Kalam',
    motto: 'Dream, dream, dream',
    color: '#0EA5E9',
    domain: 'Vision & Engineering',
    icon: 'lightbulb',
  },
  {
    slug: 'shakuntala',
    name: 'Shakuntala',
    motto: 'The mind is the fastest computer',
    color: '#EC4899',
    domain: 'Logic & Brilliance',
    icon: 'brain',
  },
  {
    slug: 'vikram',
    name: 'Vikram',
    motto: 'Failure is a stepping stone',
    color: '#6366F1',
    domain: 'Innovation & Perseverance',
    icon: 'satellite',
  },
]

// ========== ENUMS ==========
export const ContentKind = { POST: 'POST', REEL: 'REEL', STORY: 'STORY' }

export const Visibility = {
  PUBLIC: 'PUBLIC',
  LIMITED: 'LIMITED',
  SHADOW_LIMITED: 'SHADOW_LIMITED',
  HELD_FOR_REVIEW: 'HELD_FOR_REVIEW',
  REMOVED: 'REMOVED',
}

export const AgeStatus = { UNKNOWN: 'UNKNOWN', ADULT: 'ADULT', CHILD: 'CHILD' }

export const Role = {
  USER: 'USER',
  MODERATOR: 'MODERATOR',
  ADMIN: 'ADMIN',
  SUPER_ADMIN: 'SUPER_ADMIN',
}

export const ReportStatus = { OPEN: 'OPEN', REVIEWING: 'REVIEWING', RESOLVED: 'RESOLVED', DISMISSED: 'DISMISSED' }

export const AppealStatus = { PENDING: 'PENDING', REVIEWING: 'REVIEWING', APPROVED: 'APPROVED', DENIED: 'DENIED' }

export const ReactionType = { LIKE: 'LIKE', DISLIKE: 'DISLIKE' }

// ========== COLLEGE CLAIM STATUS ==========
export const ClaimStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  WITHDRAWN: 'WITHDRAWN',
  FRAUD_REVIEW: 'FRAUD_REVIEW',
}

export const ClaimType = {
  STUDENT_ID: 'STUDENT_ID',
  EMAIL: 'EMAIL',
  DOCUMENT: 'DOCUMENT',
  ENROLLMENT_NUMBER: 'ENROLLMENT_NUMBER',
}

// ========== COLLEGE CLAIM CONFIG ==========
export const ClaimConfig = {
  COOLDOWN_DAYS: 7,
  AUTO_FRAUD_REJECTION_THRESHOLD: 3, // 3+ rejections → auto fraud flag
  MAX_CLAIMS_HISTORY: 50,
  VALID_CLAIM_TYPES: ['STUDENT_ID', 'EMAIL', 'DOCUMENT', 'ENROLLMENT_NUMBER'],
}

// ========== RESOURCE (STAGE 5) ==========
export const ResourceKind = {
  NOTE: 'NOTE',
  PYQ: 'PYQ',
  ASSIGNMENT: 'ASSIGNMENT',
  SYLLABUS: 'SYLLABUS',
  LAB_FILE: 'LAB_FILE',
}

export const ResourceStatus = {
  PUBLIC: 'PUBLIC',
  HELD: 'HELD',
  UNDER_REVIEW: 'UNDER_REVIEW',
  REMOVED: 'REMOVED',
}

export const ResourceConfig = {
  VALID_KINDS: ['NOTE', 'PYQ', 'ASSIGNMENT', 'SYLLABUS', 'LAB_FILE'],
  MAX_TITLE_LENGTH: 200,
  MIN_TITLE_LENGTH: 3,
  MAX_DESCRIPTION_LENGTH: 2000,
  AUTO_HOLD_REPORT_THRESHOLD: 3,
  VALID_VOTE_TYPES: ['UP', 'DOWN'],
  MAX_YEAR: new Date().getFullYear() + 1,
  MIN_YEAR: 2000,
  VALID_SORT_OPTIONS: ['recent', 'popular', 'most_downloaded'],
  LOW_TRUST_ACCOUNT_AGE_DAYS: 7,
  LOW_TRUST_VOTE_WEIGHT: 0.5,
  DAILY_DOWNLOAD_RATE_LIMIT: 50,
  HOURLY_UPLOAD_RATE_LIMIT: 10,
}

export const ModerationAction = {
  APPROVE: 'APPROVE',
  HOLD: 'HOLD',
  REMOVE: 'REMOVE',
  SHADOW_LIMIT: 'SHADOW_LIMIT',
  STRIKE: 'STRIKE',
  SUSPEND: 'SUSPEND',
  BAN: 'BAN',
}

export const NotificationType = {
  FOLLOW: 'FOLLOW',
  LIKE: 'LIKE',
  COMMENT: 'COMMENT',
  COMMENT_LIKE: 'COMMENT_LIKE',
  SHARE: 'SHARE',
  MENTION: 'MENTION',
  REPORT_RESOLVED: 'REPORT_RESOLVED',
  STRIKE_ISSUED: 'STRIKE_ISSUED',
  APPEAL_DECIDED: 'APPEAL_DECIDED',
  HOUSE_POINTS: 'HOUSE_POINTS',
  // B6: Reel-specific notification types
  REEL_LIKE: 'REEL_LIKE',
  REEL_COMMENT: 'REEL_COMMENT',
}

// ========== ERROR CODES ==========
// Canonical Contract v2: Every error code MUST be defined here.
// Handlers MUST use these constants — no raw strings.
export const ErrorCode = {
  // -- Core HTTP-like --
  VALIDATION: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  INTERNAL: 'INTERNAL_ERROR',
  // -- Auth-specific --
  AGE_REQUIRED: 'AGE_REQUIRED',
  CHILD_RESTRICTED: 'CHILD_RESTRICTED',
  BANNED: 'BANNED',
  SUSPENDED: 'SUSPENDED',
  // -- Domain-specific (Contract v2 additions) --
  INVALID_STATE: 'INVALID_STATE',         // State machine transition violation
  GONE: 'GONE',                           // Resource permanently removed/expired (410)
  EXPIRED: 'EXPIRED',                     // Temporal resource expired (stories, tokens)
  DUPLICATE: 'DUPLICATE',                 // Idempotent action already performed
  SELF_ACTION: 'SELF_ACTION',             // User tried action on own resource
  LIMIT_EXCEEDED: 'LIMIT_EXCEEDED',       // Domain-level limit (not rate limit)
  CONTENT_REJECTED: 'CONTENT_REJECTED',   // Moderation rejection
  COOLDOWN_ACTIVE: 'COOLDOWN_ACTIVE',     // Action in cooldown period
  // -- Domain-specific: Tribe Contest codes --
  CONTEST_NOT_OPEN: 'CONTEST_NOT_OPEN',
  ENTRY_PERIOD_ENDED: 'ENTRY_PERIOD_ENDED',
  NO_TRIBE: 'NO_TRIBE',
  TRIBE_NOT_ELIGIBLE: 'TRIBE_NOT_ELIGIBLE',
  MAX_ENTRIES_REACHED: 'MAX_ENTRIES_REACHED',
  TRIBE_MAX_ENTRIES: 'TRIBE_MAX_ENTRIES',
  DUPLICATE_CONTENT: 'DUPLICATE_CONTENT',
  // -- Domain-specific: Contest lifecycle codes --
  NOT_RESOLVED: 'NOT_RESOLVED',
  VOTING_CLOSED: 'VOTING_CLOSED',
  VOTING_DISABLED: 'VOTING_DISABLED',
  ENTRY_NOT_FOUND: 'ENTRY_NOT_FOUND',
  SELF_VOTE_BLOCKED: 'SELF_VOTE_BLOCKED',
  DUPLICATE_VOTE: 'DUPLICATE_VOTE',
  VOTE_CAP_REACHED: 'VOTE_CAP_REACHED',
  INVALID_STATUS: 'INVALID_STATUS',
  DUPLICATE_CODE: 'DUPLICATE_CODE',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  ALREADY_DISQUALIFIED: 'ALREADY_DISQUALIFIED',
  // -- Domain-specific: Media codes --
  MEDIA_NOT_READY: 'MEDIA_NOT_READY',
  // -- Stage 2: Security & Session codes --
  ACCESS_TOKEN_EXPIRED: 'ACCESS_TOKEN_EXPIRED',   // Access token expired, use refresh
  REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID', // Refresh token invalid/expired
  REFRESH_TOKEN_REUSED: 'REFRESH_TOKEN_REUSED',   // Replay attack detected
  SESSION_LIMIT_EXCEEDED: 'SESSION_LIMIT_EXCEEDED', // Max concurrent sessions
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',          // Session ID not found
  RE_AUTH_REQUIRED: 'RE_AUTH_REQUIRED',            // PIN re-verification needed
}

// ========== CONFIG ==========
export const Config = {
  SESSION_TTL_MS: 30 * 24 * 60 * 60 * 1000, // 30 days (refresh token TTL)
  ACCESS_TOKEN_TTL_MS: 15 * 60 * 1000,       // 15 minutes (access token TTL)
  REFRESH_TOKEN_TTL_MS: 30 * 24 * 60 * 60 * 1000, // 30 days
  MAX_SESSIONS_PER_USER: 10,                  // concurrent device limit
  MAX_CAPTION_LENGTH: 2200,
  MAX_COMMENT_LENGTH: 1000,
  MAX_BIO_LENGTH: 150,
  MAX_DISPLAY_NAME: 50,
  MIN_DISPLAY_NAME: 2,
  MAX_USERNAME: 30,
  MIN_USERNAME: 3,
  MAX_MEDIA_SIZE_BYTES: 5 * 1024 * 1024, // 5MB for images
  MAX_VIDEO_SIZE_BYTES: 30 * 1024 * 1024, // 30MB for videos
  MAX_REEL_DURATION_SEC: 30,
  STORY_TTL_HOURS: 24,
  DEFAULT_PAGE_LIMIT: 20,
  MAX_PAGE_LIMIT: 50,
  PIN_LENGTH: 4,
  PHONE_LENGTH: 10,
  PBKDF2_ITERATIONS: 100000,
  PBKDF2_KEY_LENGTH: 64,
  PBKDF2_DIGEST: 'sha512',
}

// ========== HOUSE ASSIGNMENT ==========
export function assignHouse(userId) {
  const hash = crypto.createHash('sha256').update(userId).digest('hex')
  const index = parseInt(hash.slice(0, 8), 16) % HOUSES.length
  return HOUSES[index]
}
