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
  MENTION: 'MENTION',
  REPORT_RESOLVED: 'REPORT_RESOLVED',
  STRIKE_ISSUED: 'STRIKE_ISSUED',
  APPEAL_DECIDED: 'APPEAL_DECIDED',
  HOUSE_POINTS: 'HOUSE_POINTS',
}

// ========== ERROR CODES ==========
export const ErrorCode = {
  VALIDATION: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  INTERNAL: 'INTERNAL_ERROR',
  AGE_REQUIRED: 'AGE_REQUIRED',
  CHILD_RESTRICTED: 'CHILD_RESTRICTED',
  BANNED: 'BANNED',
  SUSPENDED: 'SUSPENDED',
}

// ========== CONFIG ==========
export const Config = {
  SESSION_TTL_MS: 30 * 24 * 60 * 60 * 1000, // 30 days
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
