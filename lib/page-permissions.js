/**
 * Tribe — B3: Page Permission System
 * Centralized role-based permission checks for Pages.
 *
 * ROLE HIERARCHY: OWNER(4) > ADMIN(3) > EDITOR(2) > MODERATOR(1)
 *
 * CONTRACT: All page permission checks MUST go through this module.
 */

const ROLE_RANK = { MODERATOR: 1, EDITOR: 2, ADMIN: 3, OWNER: 4 }
const PAGE_ROLES = ['OWNER', 'ADMIN', 'EDITOR', 'MODERATOR']
const PAGE_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED', 'SUSPENDED']
const PAGE_CATEGORIES = [
  'COLLEGE_OFFICIAL', 'DEPARTMENT', 'CLUB', 'TRIBE_OFFICIAL', 'FEST',
  'MEME', 'STUDY_GROUP', 'HOSTEL', 'STUDENT_COUNCIL', 'ALUMNI_CELL',
  'PLACEMENT_CELL', 'OTHER',
]
const LINKED_ENTITY_TYPES = [
  'COLLEGE', 'TRIBE', 'DEPARTMENT', 'CLUB', 'FEST',
  'HOSTEL', 'STUDY_GROUP', 'HOUSE', 'OTHER',
]
const VERIFICATION_STATUSES = ['NONE', 'PENDING', 'VERIFIED', 'REJECTED']

function getRank(role) { return ROLE_RANK[role] || 0 }

/** Page is publicly viewable */
function canViewPage(page) {
  return page && (page.status === 'ACTIVE' || page.status === 'ARCHIVED')
}

/** Can edit page identity/settings (name, bio, avatar, cover, category) */
function canManagePageIdentity(role) {
  return role === 'OWNER' || role === 'ADMIN'
}

/** Can create/edit/delete page-authored content */
function canPublishAsPage(role) {
  return role === 'OWNER' || role === 'ADMIN' || role === 'EDITOR'
}

/** Can moderate page comments/reports */
function canModeratePage(role) {
  return role === 'OWNER' || role === 'ADMIN' || role === 'MODERATOR'
}

/** Can archive a page — owner only */
function canArchivePage(role) { return role === 'OWNER' }

/** Can restore an archived page — owner only */
function canRestorePage(role) { return role === 'OWNER' }

/** Can add/remove members */
function canManageMembers(actorRole, targetRole) {
  if (actorRole !== 'OWNER' && actorRole !== 'ADMIN') return false
  if (!targetRole) return true // adding new member
  // Admin cannot manage same-rank or higher
  if (actorRole === 'ADMIN') return getRank(actorRole) > getRank(targetRole)
  return true // OWNER can manage anyone
}

/** Can change a member's role */
function canChangeRole(actorRole, currentRole, newRole) {
  if (actorRole === 'OWNER') return newRole !== 'OWNER' // owner can set anyone to non-owner
  if (actorRole !== 'ADMIN') return false
  return getRank(actorRole) > getRank(currentRole) && getRank(actorRole) > getRank(newRole)
}

/** Only owner can transfer ownership */
function canTransferOwnership(role) { return role === 'OWNER' }

export {
  ROLE_RANK, PAGE_ROLES, PAGE_STATUSES, PAGE_CATEGORIES,
  LINKED_ENTITY_TYPES, VERIFICATION_STATUSES,
  getRank, canViewPage, canManagePageIdentity, canPublishAsPage,
  canModeratePage, canArchivePage, canRestorePage,
  canManageMembers, canChangeRole, canTransferOwnership,
}
