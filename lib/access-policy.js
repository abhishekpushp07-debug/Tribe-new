/**
 * Tribe — Centralized Access Policy Module
 * Stage B2: Visibility, Permission & Feed Safety
 *
 * RULE: ALL read surfaces MUST use these functions for access control.
 * No ad-hoc visibility checks scattered across handlers.
 *
 * CANONICAL VISIBILITY MODEL:
 *   content_items: PUBLIC | LIMITED | SHADOW_LIMITED | HELD_FOR_REVIEW | REMOVED
 *   reels:         visibility (PUBLIC|FOLLOWERS|PRIVATE) + status (DRAFT|PUBLISHED|ARCHIVED|REMOVED|HELD)
 *   stories:       status (ACTIVE|EXPIRED|REMOVED|HELD) + privacy (EVERYONE|FOLLOWERS|CLOSE_FRIENDS)
 *   events:        visibility (PUBLIC|COLLEGE) + status (DRAFT|PUBLISHED|CANCELLED|ARCHIVED|HELD|REMOVED)
 *   resources:     status (PUBLIC|HELD|REMOVED)
 *   board_notices: status (DRAFT|PENDING_REVIEW|PUBLISHED|REJECTED|ARCHIVED|REMOVED)
 */

const ADMIN_ROLES = ['MODERATOR', 'ADMIN', 'SUPER_ADMIN']

// ════════════════════════════════════════════════════════════════════
// §1  BLOCK RELATIONSHIP
// ════════════════════════════════════════════════════════════════════

/**
 * Bidirectional block check.
 * Returns true if EITHER user has blocked the other.
 */
export async function isBlocked(db, userA, userB) {
  if (!userA || !userB || userA === userB) return false
  const block = await db.collection('blocks').findOne({
    $or: [
      { blockerId: userA, blockedId: userB },
      { blockerId: userB, blockedId: userA },
    ],
  })
  return !!block
}

/**
 * Batch block check. Given a viewer and a list of candidate user IDs,
 * returns a Set of user IDs that are blocked (in either direction).
 */
export async function getBlockedUserIds(db, viewerId, candidateIds) {
  if (!viewerId || !candidateIds || !candidateIds.length) return new Set()
  const blocks = await db.collection('blocks')
    .find({
      $or: [
        { blockerId: viewerId, blockedId: { $in: candidateIds } },
        { blockedId: viewerId, blockerId: { $in: candidateIds } },
      ],
    })
    .project({ blockerId: 1, blockedId: 1, _id: 0 })
    .toArray()
  const set = new Set()
  for (const b of blocks) {
    set.add(b.blockerId === viewerId ? b.blockedId : b.blockerId)
  }
  return set
}

// ════════════════════════════════════════════════════════════════════
// §2  CONTENT ITEMS (Posts) — visibility evaluation
// ════════════════════════════════════════════════════════════════════

/**
 * Can a viewer see a specific content item in detail view?
 *
 * Rules:
 *   REMOVED → nobody sees (404)
 *   HELD_FOR_REVIEW / HELD → owner + admin/mod only
 *   SHADOW_LIMITED → owner + admin/mod only (others see 404)
 *   PUBLIC / LIMITED → visible (subject to block check)
 */
export function canViewContent(content, viewerId, viewerRole) {
  if (!content) return false
  const v = content.visibility
  const isOwner = viewerId && viewerId === content.authorId
  const isPrivileged = ADMIN_ROLES.includes(viewerRole)

  if (v === 'REMOVED') return false
  if (v === 'HELD_FOR_REVIEW' || v === 'HELD') return isOwner || isPrivileged
  if (v === 'SHADOW_LIMITED') return isOwner || isPrivileged
  return true // PUBLIC, LIMITED
}

/**
 * Should a content item appear in feed/list surfaces?
 * Stricter than detail view — excludes HELD, SHADOW_LIMITED from lists.
 *
 * Rules:
 *   REMOVED → never
 *   HELD_FOR_REVIEW / HELD → never in public lists (admin-only queue)
 *   SHADOW_LIMITED → only visible to owner in their own profile
 *   PUBLIC → yes
 *   LIMITED → yes (scoped feeds already handle college/house filtering)
 */
export function isContentListable(content, viewerId, viewerRole) {
  if (!content) return false
  const v = content.visibility
  const isOwner = viewerId && viewerId === content.authorId
  const isPrivileged = ADMIN_ROLES.includes(viewerRole)

  if (v === 'REMOVED' || v === 'HELD_FOR_REVIEW' || v === 'HELD') return false
  if (v === 'SHADOW_LIMITED') return isOwner || isPrivileged
  return true // PUBLIC, LIMITED
}

// ════════════════════════════════════════════════════════════════════
// §3  FEED SAFETY — Post-query filtering for block + visibility
// ════════════════════════════════════════════════════════════════════

/**
 * Filter a list of content items for feed safety.
 * Removes items from blocked authors and non-listable visibility states.
 *
 * @param {Object} db - MongoDB database
 * @param {string|null} viewerId - Current user ID or null for anonymous
 * @param {string|null} viewerRole - Current user's role
 * @param {Array} items - Array of content item documents
 * @returns {Promise<Array>} Filtered items
 */
export async function applyFeedPolicy(db, viewerId, viewerRole, items) {
  if (!items || !items.length) return []

  // Step 1: Visibility filter
  let filtered = items.filter(item => isContentListable(item, viewerId, viewerRole))

  // Step 2: Block filter (only for authenticated users)
  if (viewerId) {
    const authorIds = [...new Set(filtered.map(i => i.authorId).filter(Boolean))]
    if (authorIds.length) {
      const blockedIds = await getBlockedUserIds(db, viewerId, authorIds)
      if (blockedIds.size > 0) {
        filtered = filtered.filter(i => !blockedIds.has(i.authorId))
      }
    }
  }

  return filtered
}

// ════════════════════════════════════════════════════════════════════
// §4  USER LIST SAFETY — Filter blocked users from follower/following/member lists
// ════════════════════════════════════════════════════════════════════

/**
 * Filter a list of user objects to exclude blocked relationships.
 *
 * @param {Object} db - MongoDB database
 * @param {string|null} viewerId - Current user ID
 * @param {Array} users - Array of user documents with .id field
 * @returns {Promise<Array>} Filtered users
 */
export async function filterBlockedUsers(db, viewerId, users) {
  if (!viewerId || !users || !users.length) return users || []
  const userIds = users.map(u => u.id).filter(Boolean)
  if (!userIds.length) return users
  const blockedIds = await getBlockedUserIds(db, viewerId, userIds)
  if (!blockedIds.size) return users
  return users.filter(u => !blockedIds.has(u.id))
}

// ════════════════════════════════════════════════════════════════════
// §5  COMMENT SAFETY — Parent access check
// ════════════════════════════════════════════════════════════════════

/**
 * Can comments on a content item be viewed?
 * If parent content is hidden/removed, comments should not be accessible.
 */
export function canViewComments(parentContent, viewerId, viewerRole) {
  return canViewContent(parentContent, viewerId, viewerRole)
}

/**
 * Filter comment list to exclude comments from blocked authors.
 */
export async function filterBlockedComments(db, viewerId, comments) {
  if (!viewerId || !comments || !comments.length) return comments || []
  const authorIds = [...new Set(comments.map(c => c.authorId).filter(Boolean))]
  if (!authorIds.length) return comments
  const blockedIds = await getBlockedUserIds(db, viewerId, authorIds)
  if (!blockedIds.size) return comments
  return comments.filter(c => !blockedIds.has(c.authorId))
}

// ════════════════════════════════════════════════════════════════════
// §6  NOTIFICATION SAFETY
// ════════════════════════════════════════════════════════════════════

/**
 * Filter notifications to exclude those from blocked actors.
 */
export async function filterBlockedNotifications(db, viewerId, notifications) {
  if (!viewerId || !notifications || !notifications.length) return notifications || []
  const actorIds = [...new Set(notifications.map(n => n.actorId).filter(Boolean))]
  if (!actorIds.length) return notifications
  const blockedIds = await getBlockedUserIds(db, viewerId, actorIds)
  if (!blockedIds.size) return notifications
  return notifications.filter(n => !blockedIds.has(n.actorId))
}

// ════════════════════════════════════════════════════════════════════
// §7  EXPORTS SUMMARY
// ════════════════════════════════════════════════════════════════════
/**
 * Usage matrix:
 *
 * | Function               | Used By                                  |
 * |------------------------|------------------------------------------|
 * | isBlocked              | content detail, comments, user profile   |
 * | getBlockedUserIds      | feed policy, user lists, notifications   |
 * | canViewContent         | content detail, comment parent check     |
 * | isContentListable      | feed filtering, user posts               |
 * | applyFeedPolicy        | all feed endpoints                       |
 * | filterBlockedUsers     | followers, following, member lists       |
 * | filterBlockedComments  | comment list endpoints                   |
 * | filterBlockedNotifications | notification list                    |
 * | canViewComments        | comment list parent check                |
 */
