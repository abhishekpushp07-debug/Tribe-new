/**
 * Tribe — Contract v2.1: Canonical Entity Snippets
 * 
 * RULE: Every handler MUST use these snippet builders when embedding entities in responses.
 * Raw DB documents MUST NOT leak into API responses without passing through a snippet.
 * 
 * CONTRACT VERSION: v2.1 (B1 — Canonical Identity & Media Resolution)
 * STATUS: ENFORCED
 * 
 * CHANGELOG:
 *   v2.1 (B1): Added resolveMediaUrl(), fixed avatar resolution in toUserSnippet,
 *              added avatarUrl/avatarMediaId to canonical shapes, fixed toMediaObject URL fallback.
 */

// ════════════════════════════════════════════════════════════════════
// §0  SHARED MEDIA URL RESOLVER
// ════════════════════════════════════════════════════════════════════
/**
 * Central media URL resolver. ALL media ID → URL conversions MUST go through this.
 * Future-safe: when CDN, signed URLs, or reverse proxy changes happen, update HERE only.
 *
 * @param {string|null|undefined} mediaId - Raw media asset ID from DB
 * @returns {string|null} Resolved URL path, or null if no media
 */
export function resolveMediaUrl(mediaId) {
  if (!mediaId) return null
  return `/api/media/${mediaId}`
}

// ════════════════════════════════════════════════════════════════════
// §1  USER SNIPPET (lightweight, embedded in content/comments/notifications)
// ════════════════════════════════════════════════════════════════════
/**
 * Minimal user snippet for embedding in content responses.
 * Used in: post.author, comment.author, event.creator, reel.creator,
 *          notice.creator, notification.actor, followers/following cards
 * 
 * B1 contract shape:
 *   - avatarUrl:     resolved display URL (use this in <img src>)
 *   - avatarMediaId: raw media ID (use this for profile edit forms)
 *   - avatar:        DEPRECATED legacy alias for avatarMediaId (will be removed in B4+)
 *
 * @param {Object} user - Full user document from DB
 * @returns {Object|null} Canonical user snippet
 */
export function toUserSnippet(user) {
  if (!user) return null
  // DB stores avatar as 'avatarMediaId'; some older docs may use 'avatar'
  const mid = user.avatarMediaId || user.avatar || null
  return {
    id: user.id,
    displayName: user.displayName || null,
    username: user.username || null,
    avatarUrl: resolveMediaUrl(mid),
    avatarMediaId: mid,
    avatar: mid,  // DEPRECATED — kept for backward compatibility
    role: user.role || 'USER',
    collegeId: user.collegeId || null,
    collegeName: user.collegeName || null,
    houseId: user.houseId || null,   // DEPRECATED — legacy, will be removed
    houseName: user.houseName || null, // DEPRECATED — legacy, will be removed
    tribeId: user.tribeId || null,
    tribeCode: user.tribeCode || null,
    tribeName: user.tribeName || null,
    tribeHeroName: user.tribeHeroName || null,
  }
}

// ════════════════════════════════════════════════════════════════════
// §2  USER PROFILE (full, for /auth/me, /auth/login, /users/:id)
// ════════════════════════════════════════════════════════════════════
/**
 * Full user profile for profile pages. Strips secrets, adds resolved avatar.
 * Used in: /users/:id, /auth/me, /auth/login, /auth/register
 * 
 * NOTE: sanitizeUser() in auth-utils.js delegates to this function.
 *
 * @param {Object} user - Full user document from DB
 * @returns {Object|null} Sanitized user profile with resolved avatarUrl
 */
export function toUserProfile(user) {
  if (!user) return null
  const { _id, pinHash, pinSalt, ...safe } = user
  const mid = safe.avatarMediaId || safe.avatar || null
  return {
    ...safe,
    avatarUrl: resolveMediaUrl(mid),
    avatarMediaId: mid,
    avatar: mid,  // DEPRECATED — kept for backward compatibility
  }
}

// ════════════════════════════════════════════════════════════════════
// §3  MEDIA OBJECT (resolved asset)
// ════════════════════════════════════════════════════════════════════
/**
 * Canonical media object for resolved media assets.
 * Used in: posts, stories (resolved from media_assets collection)
 * 
 * B1 rule: if media exists (has an id), url MUST be resolvable.
 * Falls back to resolveMediaUrl(id) when asset.url is null/empty (DB-stored media).
 *
 * @param {Object} asset - Media asset document from DB
 * @returns {Object|null} Canonical media object with guaranteed url if id exists
 */
export function toMediaObject(asset) {
  if (!asset) return null
  return {
    id: asset.id,
    url: asset.url || resolveMediaUrl(asset.id),
    type: asset.type || asset.mimeType || null,     // IMAGE, VIDEO, AUDIO
    thumbnailUrl: asset.thumbnailUrl || null,
    width: asset.width || null,
    height: asset.height || null,
    duration: asset.duration || null,
    mimeType: asset.mimeType || null,
    size: asset.size || null,
  }
}

// ════════════════════════════════════════════════════════════════════
// §4  REEL MEDIA (inline, not asset-referenced)
// ════════════════════════════════════════════════════════════════════
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

// ════════════════════════════════════════════════════════════════════
// §5  COLLEGE SNIPPET
// ════════════════════════════════════════════════════════════════════
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

// ════════════════════════════════════════════════════════════════════
// §6  TRIBE SNIPPET
// ════════════════════════════════════════════════════════════════════
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
    name: tribe.tribeName || tribe.name || null,
    code: tribe.tribeCode || tribe.code || null,
    heroName: tribe.heroName || tribe.paramVirChakraName || tribe.awardee || null,
    animalIcon: tribe.animalIcon || null,
    primaryColor: tribe.primaryColor || tribe.color || null,
    secondaryColor: tribe.secondaryColor || null,
    quote: tribe.quote || null,
    membersCount: tribe.membersCount || 0,
    totalSalutes: tribe.totalSalutes || 0,
    cheerCount: tribe.cheerCount || 0,
  }
}

// ════════════════════════════════════════════════════════════════════
// §7  CONTEST SNIPPET
// ════════════════════════════════════════════════════════════════════
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

// ════════════════════════════════════════════════════════════════════
// §8  ADOPTION MAP
// ════════════════════════════════════════════════════════════════════
/**
 * Contract v2.1 snippet adoption rules:
 * 
 * | Snippet          | Used By                                              | B1 Status  |
 * |------------------|------------------------------------------------------|------------|
 * | toUserSnippet    | enrichPosts.author                                   | CANONICAL  |
 * | toUserProfile    | sanitizeUser() delegation in auth-utils.js           | CANONICAL  |
 * | resolveMediaUrl  | toUserSnippet, toUserProfile, toMediaObject          | NEW (B1)   |
 * | toMediaObject    | media asset resolution                               | CANONICAL  |
 * | toCollegeSnippet | college references in profiles/search                | UNCHANGED  |
 * | toTribeSnippet   | tribe references in standings/profiles               | UNCHANGED  |
 * | toContestSnippet | contest references in feeds/notifications            | UNCHANGED  |
 * | toPageSnippet    | page references in content/feeds/search              | NEW (B3)   |
 * | toPageProfile    | full page profile for /pages/:id                     | NEW (B3)   |
 * 
 * NOTE: sanitizeUser() in auth-utils.js NOW DELEGATES to toUserProfile().
 * This is the single source of truth for full profile serialization.
 * 
 * AVATAR CONTRACT (B1):
 *   - avatarUrl:     Canonical display field. Use in <img src>. Always a URL or null.
 *   - avatarMediaId: Canonical raw reference. Use for edit forms / media API calls.
 *   - avatar:        DEPRECATED. Legacy alias for avatarMediaId. Will be removed post-B4.
 */

// ════════════════════════════════════════════════════════════════════
// §9  PAGE SNIPPET (B3 — lightweight, embedded in content/feeds/search)
// ════════════════════════════════════════════════════════════════════
/**
 * Minimal page snippet for embedding in content responses.
 * Used in: post.author (when authorType=PAGE), search results, feed items
 *
 * @param {Object} page - Page document from DB
 * @returns {Object|null} Canonical page snippet
 */
export function toPageSnippet(page) {
  if (!page) return null
  return {
    id: page.id,
    slug: page.slug,
    name: page.name,
    avatarUrl: resolveMediaUrl(page.avatarMediaId),
    avatarMediaId: page.avatarMediaId || null,
    category: page.category,
    isOfficial: !!page.isOfficial,
    verificationStatus: page.verificationStatus || 'NONE',
    linkedEntityType: page.linkedEntityType || null,
    linkedEntityId: page.linkedEntityId || null,
    collegeId: page.collegeId || null,
    tribeId: page.tribeId || null,
    status: page.status,
  }
}

// ════════════════════════════════════════════════════════════════════
// §10  PAGE PROFILE (B3 — full, for /pages/:idOrSlug detail)
// ════════════════════════════════════════════════════════════════════
/**
 * Full page profile for page detail endpoints.
 *
 * @param {Object} page - Page document from DB
 * @param {Object} viewerContext - Optional context (e.g. { viewerIsFollowing, viewerRole })
 * @returns {Object|null} Full page profile
 */
export function toPageProfile(page, viewerContext = {}) {
  if (!page) return null
  return {
    ...toPageSnippet(page),
    bio: page.bio || '',
    subcategory: page.subcategory || '',
    coverUrl: resolveMediaUrl(page.coverMediaId),
    coverMediaId: page.coverMediaId || null,
    followerCount: page.followerCount || 0,
    memberCount: page.memberCount || 0,
    postCount: page.postCount || 0,
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
    viewerIsFollowing: viewerContext.viewerIsFollowing || false,
    viewerRole: viewerContext.viewerRole || null,
  }
}
