/**
 * Tribe — Contract v2: Canonical Entity Snippets
 * 
 * RULE: Every handler MUST use these snippet builders when embedding entities in responses.
 * Raw DB documents MUST NOT leak into API responses without passing through a snippet.
 * 
 * CONTRACT VERSION: v2
 * STATUS: ENFORCED
 */

// ========== USER SNIPPET ==========
/**
 * Minimal user snippet for embedding in content responses.
 * Used in: post.author, comment.author, event.creator, reel.creator, notice.creator
 * 
 * @param {Object} user - Full user document from DB
 * @returns {Object|null} Canonical user snippet
 */
export function toUserSnippet(user) {
  if (!user) return null
  return {
    id: user.id,
    displayName: user.displayName || null,
    username: user.username || null,
    avatar: user.avatar || null,
    role: user.role || 'USER',
    collegeId: user.collegeId || null,
    collegeName: user.collegeName || null,
    houseId: user.houseId || null,
    houseName: user.houseName || null,
    tribeId: user.tribeId || null,
    tribeCode: user.tribeCode || null,
  }
}

// ========== USER PROFILE ==========
/**
 * Full user profile for profile pages. sanitizeUser + explicit field list.
 * Used in: /users/:id, /auth/me, /auth/login, /auth/register
 * 
 * @param {Object} user - Full user document from DB
 * @returns {Object|null} Sanitized user profile
 */
export function toUserProfile(user) {
  if (!user) return null
  const { _id, pinHash, pinSalt, ...safe } = user
  return safe
}

// ========== MEDIA OBJECT ==========
/**
 * Canonical media object for resolved media assets.
 * Used in: posts, stories (resolved from media_assets collection)
 * 
 * @param {Object} asset - Media asset document from DB
 * @returns {Object|null} Canonical media object
 */
export function toMediaObject(asset) {
  if (!asset) return null
  return {
    id: asset.id,
    url: asset.url || null,
    type: asset.type || asset.mimeType || null,     // IMAGE, VIDEO, AUDIO
    thumbnailUrl: asset.thumbnailUrl || null,
    width: asset.width || null,
    height: asset.height || null,
    duration: asset.duration || null,
    mimeType: asset.mimeType || null,
    size: asset.size || null,
  }
}

// ========== REEL MEDIA (inline, not asset-referenced) ==========
/**
 * Reel-specific media fields. Reels don't use media_assets — they have inline URLs.
 * This is a DOCUMENTED EXCEPTION to the MediaObject pattern.
 * 
 * Used in: reel detail, reel feed items
 * 
 * Reel media fields (part of the reel document itself):
 *   - playbackUrl: string       Primary video URL
 *   - thumbnailUrl: string      Thumbnail image
 *   - posterFrameUrl: string    Poster frame
 *   - mediaStatus: string       UPLOADING | PROCESSING | READY | FAILED
 *   - durationMs: number        Duration in milliseconds
 *   - aspectRatio: string       e.g., "9:16"
 */

// ========== COLLEGE SNIPPET ==========
/**
 * Minimal college snippet for embedding in content/profile responses.
 * 
 * @param {Object} college - College document from DB
 * @returns {Object|null} Canonical college snippet
 */
export function toCollegeSnippet(college) {
  if (!college) return null
  return {
    id: college.id,
    officialName: college.officialName || null,
    shortName: college.shortName || null,
    city: college.city || null,
    state: college.state || null,
    type: college.type || null,
    membersCount: college.membersCount || 0,
  }
}

// ========== TRIBE SNIPPET ==========
/**
 * Minimal tribe snippet for embedding in responses.
 * 
 * @param {Object} tribe - Tribe document from DB
 * @returns {Object|null} Canonical tribe snippet
 */
export function toTribeSnippet(tribe) {
  if (!tribe) return null
  return {
    id: tribe.id,
    name: tribe.name || null,
    code: tribe.code || null,
    awardee: tribe.awardee || null,
    color: tribe.color || null,
    membersCount: tribe.membersCount || 0,
  }
}

// ========== CONTEST SNIPPET ==========
/**
 * Minimal contest snippet for embedding in responses.
 * 
 * @param {Object} contest - Contest document from DB
 * @returns {Object|null} Canonical contest snippet
 */
export function toContestSnippet(contest) {
  if (!contest) return null
  return {
    id: contest.id,
    title: contest.title || null,
    type: contest.type || null,
    status: contest.status || null,
    seasonId: contest.seasonId || null,
    startsAt: contest.startsAt || null,
    endsAt: contest.endsAt || null,
  }
}

// ========== SNIPPET ADOPTION MAP ==========
/**
 * Contract v2 snippet adoption rules:
 * 
 * | Snippet         | Used By                                             |
 * |-----------------|-----------------------------------------------------|
 * | toUserSnippet   | enrichPosts.author, comments.author, event.creator, |
 * |                 | reel.creator, notice.creator, notification.actor     |
 * | toUserProfile   | /auth/me, /auth/login, /auth/register, /users/:id   |
 * | toMediaObject   | posts.media, stories.media (resolved assets)         |
 * | toCollegeSnippet| college references in profiles/search               |
 * | toTribeSnippet  | tribe references in standings/profiles               |
 * | toContestSnippet| contest references in feeds/notifications            |
 * 
 * NOTE: sanitizeUser() in auth-utils.js is EQUIVALENT to toUserProfile().
 * Both strip _id, pinHash, pinSalt. sanitizeUser is kept for backward compat.
 * New handlers SHOULD prefer toUserProfile/toUserSnippet.
 */
