/**
 * Tribe — B3: Pages Handler
 * Complete Pages system: CRUD, roles, follow, publishing, search.
 *
 * REUSES existing content engine for page-authored posts.
 * Public author = Page, Audit actor = real user.
 *
 * COLLECTIONS: pages, page_members, page_follows
 * CONTENT EXTENSION: authorType=PAGE on content_items
 */

import { v4 as uuidv4 } from 'uuid'
import { Config, ContentKind, Visibility, ErrorCode } from '../constants.js'
import { requireAuth, authenticate, enrichPosts, parsePagination, writeAudit, createNotification } from '../auth-utils.js'
import { toPageSnippet, toPageProfile } from '../entity-snippets.js'
import { canViewPage, canManagePageIdentity, canPublishAsPage, canArchivePage, canRestorePage, canManageMembers, canChangeRole, canTransferOwnership, PAGE_ROLES, PAGE_CATEGORIES, LINKED_ENTITY_TYPES, VERIFICATION_STATUSES } from '../page-permissions.js'
import { normalizeSlug, validateSlug, containsOfficialSpoof } from '../page-slugs.js'
import { extractHashtags, syncHashtags } from '../services/hashtag-service.js'
import { moderateCreateContent } from '../moderation/middleware/moderate-create-content.js'
import { invalidateOnEvent } from '../cache.js'
import { applyFeedPolicy, isBlocked } from '../access-policy.js'

// ════════════════════════════════════════════════════════════════════
// INDEX SETUP — called once on first request
// ════════════════════════════════════════════════════════════════════
let indexesEnsured = false
async function ensureIndexes(db) {
  if (indexesEnsured) return
  indexesEnsured = true
  try {
    await Promise.all([
      db.collection('pages').createIndex({ slug: 1 }, { unique: true }),
      db.collection('pages').createIndex({ id: 1 }, { unique: true }),
      db.collection('pages').createIndex({ status: 1, category: 1, updatedAt: -1 }),
      db.collection('pages').createIndex({ collegeId: 1, status: 1 }),
      db.collection('pages').createIndex({ tribeId: 1, status: 1 }),
      db.collection('pages').createIndex({ createdByUserId: 1 }),
      db.collection('pages').createIndex(
        { linkedEntityType: 1, linkedEntityId: 1, isOfficial: 1 },
        {
          unique: true,
          partialFilterExpression: {
            isOfficial: true,
            linkedEntityType: { $ne: null },
            linkedEntityId: { $ne: null },
            status: { $in: ['DRAFT', 'ACTIVE'] },
          },
          name: 'uniq_official_per_entity',
        }
      ),
      db.collection('page_members').createIndex({ pageId: 1, userId: 1 }, { unique: true }),
      db.collection('page_members').createIndex({ userId: 1, status: 1 }),
      db.collection('page_members').createIndex({ pageId: 1, status: 1, role: 1 }),
      db.collection('page_follows').createIndex({ pageId: 1, userId: 1 }, { unique: true }),
      db.collection('page_follows').createIndex({ userId: 1, createdAt: -1 }),
      db.collection('page_follows').createIndex({ pageId: 1, createdAt: -1 }),
      // Content index for page-authored posts
      db.collection('content_items').createIndex({ authorType: 1, pageId: 1, createdAt: -1 }),
    ])
  } catch (e) {
    // Indexes may already exist — not a fatal error
  }
}

// ════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════

async function findPageByIdOrSlug(db, idOrSlug) {
  const page = await db.collection('pages').findOne({ id: idOrSlug })
  if (page) return page
  return db.collection('pages').findOne({ slug: String(idOrSlug).toLowerCase() })
}

async function getActiveMembership(db, pageId, userId) {
  return db.collection('page_members').findOne({ pageId, userId, status: 'ACTIVE' })
}

function err(msg, code, status) { return { error: msg, code, status } }

// ════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════════════════════════════════

export async function handlePages(path, method, request, db) {
  await ensureIndexes(db)

  // ========================
  // POST /pages — Create Page
  // ========================
  if (path[0] === 'pages' && path.length === 1 && method === 'POST') {
    const user = await requireAuth(request, db)
    const body = await request.json()

    if (!body.name?.trim()) return err('Page name is required', ErrorCode.VALIDATION, 400)
    if (!body.category || !PAGE_CATEGORIES.includes(body.category)) {
      return err(`Invalid category. Must be one of: ${PAGE_CATEGORIES.join(', ')}`, ErrorCode.VALIDATION, 400)
    }

    const slug = normalizeSlug(body.slug || body.name)
    const slugErr = validateSlug(slug)
    if (slugErr) return err(slugErr, ErrorCode.VALIDATION, 400)

    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(user.role)
    const allowOfficial = isAdmin

    if (!allowOfficial && body.isOfficial) {
      return err('Only admins can create official pages', ErrorCode.FORBIDDEN, 403)
    }
    if (!allowOfficial && (containsOfficialSpoof(body.name) || containsOfficialSpoof(slug))) {
      return err('Use of "official" in page name/slug is restricted', ErrorCode.VALIDATION, 400)
    }

    if (body.linkedEntityType && !LINKED_ENTITY_TYPES.includes(body.linkedEntityType)) {
      return err('Invalid linked entity type', ErrorCode.VALIDATION, 400)
    }

    const now = new Date()
    const pageId = uuidv4()

    const pageDoc = {
      id: pageId,
      slug,
      name: String(body.name).trim().slice(0, 120),
      bio: String(body.bio || '').slice(0, 500),
      category: body.category,
      subcategory: String(body.subcategory || '').slice(0, 80),
      avatarMediaId: body.avatarMediaId || null,
      coverMediaId: body.coverMediaId || null,
      status: 'ACTIVE',
      isOfficial: !!(body.isOfficial && allowOfficial),
      verificationStatus: (allowOfficial && body.verificationStatus && VERIFICATION_STATUSES.includes(body.verificationStatus)) ? body.verificationStatus : 'NONE',
      linkedEntityType: body.linkedEntityType || null,
      linkedEntityId: body.linkedEntityId || null,
      collegeId: body.collegeId || null,
      tribeId: body.tribeId || null,
      createdByUserId: user.id,
      followerCount: 0,
      memberCount: 1,
      postCount: 0,
      archivedAt: null,
      suspendedAt: null,
      createdAt: now,
      updatedAt: now,
    }

    try {
      await db.collection('pages').insertOne(pageDoc)
    } catch (e) {
      if (e.code === 11000) {
        if (e.message?.includes('slug')) return err('Page slug already exists', ErrorCode.CONFLICT, 409)
        if (e.message?.includes('official')) return err('An official page for this entity already exists', ErrorCode.CONFLICT, 409)
        return err('Page already exists', ErrorCode.CONFLICT, 409)
      }
      throw e
    }

    await db.collection('page_members').insertOne({
      id: uuidv4(),
      pageId,
      userId: user.id,
      role: 'OWNER',
      status: 'ACTIVE',
      addedByUserId: user.id,
      createdAt: now,
      updatedAt: now,
    })

    await writeAudit(db, 'PAGE_CREATED', user.id, 'PAGE', pageId, { slug, category: body.category })

    const { _id, ...clean } = pageDoc
    return { data: { page: toPageProfile(clean) }, status: 201 }
  }

  // ========================
  // GET /pages — Search/List Pages
  // ========================
  if (path[0] === 'pages' && path.length === 1 && method === 'GET') {
    const url = new URL(request.url)
    const q = String(url.searchParams.get('q') || '').trim()
    const category = url.searchParams.get('category')
    const collegeId = url.searchParams.get('collegeId')
    const { limit } = parsePagination(url)

    const filter = { status: { $in: ['ACTIVE', 'ARCHIVED'] } }
    if (category && PAGE_CATEGORIES.includes(category)) filter.category = category
    if (collegeId) filter.collegeId = collegeId
    if (q) {
      filter.$or = [
        { name: { $regex: q, $options: 'i' } },
        { slug: { $regex: q, $options: 'i' } },
      ]
    }

    const pages = await db.collection('pages')
      .find(filter, { projection: { _id: 0 } })
      .sort({ isOfficial: -1, followerCount: -1, updatedAt: -1 })
      .limit(limit)
      .toArray()

    return { data: { pages: pages.map(toPageSnippet), count: pages.length } }
  }

  // ========================
  // GET /pages/:idOrSlug — Page Detail
  // ========================
  if (path[0] === 'pages' && path.length === 2 && method === 'GET') {
    const idOrSlug = path[1]
    if (['search'].includes(idOrSlug)) return null

    const page = await findPageByIdOrSlug(db, idOrSlug)
    if (!page || !canViewPage(page)) return err('Page not found', ErrorCode.NOT_FOUND, 404)

    const currentUser = await authenticate(request, db)
    let viewerIsFollowing = false
    let viewerRole = null

    if (currentUser?.id) {
      const [follow, membership] = await Promise.all([
        db.collection('page_follows').findOne({ pageId: page.id, userId: currentUser.id }),
        db.collection('page_members').findOne({ pageId: page.id, userId: currentUser.id, status: 'ACTIVE' }),
      ])
      viewerIsFollowing = !!follow
      viewerRole = membership?.role || null
    }

    const { _id, ...clean } = page
    return { data: { page: toPageProfile(clean, { viewerIsFollowing, viewerRole }) } }
  }

  // ========================
  // PATCH /pages/:id — Update Page
  // ========================
  if (path[0] === 'pages' && path.length === 2 && method === 'PATCH') {
    const user = await requireAuth(request, db)
    const page = await findPageByIdOrSlug(db, path[1])
    if (!page) return err('Page not found', ErrorCode.NOT_FOUND, 404)

    const membership = await getActiveMembership(db, page.id, user.id)
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(user.role)
    if (!membership && !isAdmin) return err('Not a page member', ErrorCode.FORBIDDEN, 403)
    if (membership && !canManagePageIdentity(membership.role) && !isAdmin) {
      return err('Insufficient page role', ErrorCode.FORBIDDEN, 403)
    }

    const body = await request.json()
    const update = { updatedAt: new Date() }

    const allowedFields = ['name', 'bio', 'category', 'subcategory', 'avatarMediaId', 'coverMediaId', 'collegeId', 'tribeId']
    for (const key of allowedFields) {
      if (body[key] !== undefined) {
        if (key === 'name') update.name = String(body.name).trim().slice(0, 120)
        else if (key === 'bio') update.bio = String(body.bio).slice(0, 500)
        else if (key === 'category' && PAGE_CATEGORIES.includes(body.category)) update.category = body.category
        else if (key === 'subcategory') update.subcategory = String(body.subcategory).slice(0, 80)
        else update[key] = body[key]
      }
    }

    // Admin-only fields
    if (isAdmin) {
      if (body.isOfficial !== undefined) update.isOfficial = !!body.isOfficial
      if (body.verificationStatus && VERIFICATION_STATUSES.includes(body.verificationStatus)) update.verificationStatus = body.verificationStatus
      if (body.linkedEntityType !== undefined) update.linkedEntityType = body.linkedEntityType
      if (body.linkedEntityId !== undefined) update.linkedEntityId = body.linkedEntityId
      if (body.status && ['ACTIVE', 'SUSPENDED'].includes(body.status)) {
        update.status = body.status
        if (body.status === 'SUSPENDED') update.suspendedAt = new Date()
      }
    }

    await db.collection('pages').updateOne({ id: page.id }, { $set: update })
    await writeAudit(db, 'PAGE_UPDATED', user.id, 'PAGE', page.id, { fields: Object.keys(update) })

    const updated = await db.collection('pages').findOne({ id: page.id }, { projection: { _id: 0 } })
    return { data: { page: toPageProfile(updated) } }
  }

  // ========================
  // POST /pages/:id/archive — Archive Page
  // ========================
  if (path[0] === 'pages' && path.length === 3 && path[2] === 'archive' && method === 'POST') {
    const user = await requireAuth(request, db)
    const page = await findPageByIdOrSlug(db, path[1])
    if (!page) return err('Page not found', ErrorCode.NOT_FOUND, 404)

    const membership = await getActiveMembership(db, page.id, user.id)
    if (!membership || !canArchivePage(membership.role)) return err('Only page owner can archive', ErrorCode.FORBIDDEN, 403)
    if (page.status === 'ARCHIVED') return err('Page is already archived', ErrorCode.INVALID_STATE, 400)

    await db.collection('pages').updateOne({ id: page.id }, { $set: { status: 'ARCHIVED', archivedAt: new Date(), updatedAt: new Date() } })
    await writeAudit(db, 'PAGE_ARCHIVED', user.id, 'PAGE', page.id, {})

    const updated = await db.collection('pages').findOne({ id: page.id }, { projection: { _id: 0 } })
    return { data: { page: toPageProfile(updated) } }
  }

  // ========================
  // POST /pages/:id/restore — Restore Archived Page
  // ========================
  if (path[0] === 'pages' && path.length === 3 && path[2] === 'restore' && method === 'POST') {
    const user = await requireAuth(request, db)
    const page = await findPageByIdOrSlug(db, path[1])
    if (!page) return err('Page not found', ErrorCode.NOT_FOUND, 404)

    const membership = await getActiveMembership(db, page.id, user.id)
    if (!membership || !canRestorePage(membership.role)) return err('Only page owner can restore', ErrorCode.FORBIDDEN, 403)
    if (page.status !== 'ARCHIVED') return err('Page is not archived', ErrorCode.INVALID_STATE, 400)

    await db.collection('pages').updateOne({ id: page.id }, { $set: { status: 'ACTIVE', archivedAt: null, updatedAt: new Date() } })
    await writeAudit(db, 'PAGE_RESTORED', user.id, 'PAGE', page.id, {})

    const updated = await db.collection('pages').findOne({ id: page.id }, { projection: { _id: 0 } })
    return { data: { page: toPageProfile(updated) } }
  }

  // ========================
  // GET /pages/:id/members — List Page Members
  // ========================
  if (path[0] === 'pages' && path.length === 3 && path[2] === 'members' && method === 'GET') {
    const user = await requireAuth(request, db)
    const page = await findPageByIdOrSlug(db, path[1])
    if (!page) return err('Page not found', ErrorCode.NOT_FOUND, 404)

    const membership = await getActiveMembership(db, page.id, user.id)
    if (!membership) return err('Only page members can view member list', ErrorCode.FORBIDDEN, 403)

    const members = await db.collection('page_members')
      .find({ pageId: page.id, status: 'ACTIVE' }, { projection: { _id: 0 } })
      .sort({ createdAt: 1 })
      .toArray()

    // Enrich with user snippets
    const userIds = members.map(m => m.userId)
    const users = await db.collection('users').find({ id: { $in: userIds } }).toArray()
    const userMap = Object.fromEntries(users.map(u => [u.id, u]))

    const enriched = members.map(m => ({
      userId: m.userId,
      role: m.role,
      displayName: userMap[m.userId]?.displayName || null,
      username: userMap[m.userId]?.username || null,
      createdAt: m.createdAt,
    }))

    return { data: { members: enriched, count: enriched.length } }
  }

  // ========================
  // POST /pages/:id/members — Add Member
  // ========================
  if (path[0] === 'pages' && path.length === 3 && path[2] === 'members' && method === 'POST') {
    const user = await requireAuth(request, db)
    const page = await findPageByIdOrSlug(db, path[1])
    if (!page) return err('Page not found', ErrorCode.NOT_FOUND, 404)

    const actorMembership = await getActiveMembership(db, page.id, user.id)
    if (!actorMembership || !canManageMembers(actorMembership.role)) {
      return err('Not allowed to add members', ErrorCode.FORBIDDEN, 403)
    }

    const body = await request.json()
    if (!body.userId) return err('userId is required', ErrorCode.VALIDATION, 400)
    if (!body.role || !PAGE_ROLES.includes(body.role)) return err('Valid role is required', ErrorCode.VALIDATION, 400)
    if (body.role === 'OWNER') return err('Cannot directly add as owner. Use transfer-ownership.', ErrorCode.VALIDATION, 400)

    // Check if target user exists
    const targetUser = await db.collection('users').findOne({ id: body.userId })
    if (!targetUser) return err('User not found', ErrorCode.NOT_FOUND, 404)

    // Check if already a member
    const existing = await db.collection('page_members').findOne({ pageId: page.id, userId: body.userId })
    if (existing && existing.status === 'ACTIVE') return err('User is already a page member', ErrorCode.CONFLICT, 409)

    const now = new Date()
    if (existing) {
      // Re-activate removed member
      await db.collection('page_members').updateOne(
        { pageId: page.id, userId: body.userId },
        { $set: { role: body.role, status: 'ACTIVE', addedByUserId: user.id, updatedAt: now } }
      )
    } else {
      await db.collection('page_members').insertOne({
        id: uuidv4(),
        pageId: page.id,
        userId: body.userId,
        role: body.role,
        status: 'ACTIVE',
        addedByUserId: user.id,
        createdAt: now,
        updatedAt: now,
      })
    }

    await db.collection('pages').updateOne({ id: page.id }, { $inc: { memberCount: 1 }, $set: { updatedAt: now } })
    await writeAudit(db, 'PAGE_MEMBER_ADDED', user.id, 'PAGE', page.id, { targetUserId: body.userId, role: body.role })

    return { data: { message: 'Member added' }, status: 201 }
  }

  // ========================
  // PATCH /pages/:id/members/:userId — Change Member Role
  // ========================
  if (path[0] === 'pages' && path.length === 4 && path[2] === 'members' && method === 'PATCH') {
    const user = await requireAuth(request, db)
    const page = await findPageByIdOrSlug(db, path[1])
    if (!page) return err('Page not found', ErrorCode.NOT_FOUND, 404)

    const actorMembership = await getActiveMembership(db, page.id, user.id)
    if (!actorMembership) return err('Not a page member', ErrorCode.FORBIDDEN, 403)

    const targetUserId = path[3]
    const target = await db.collection('page_members').findOne({ pageId: page.id, userId: targetUserId, status: 'ACTIVE' })
    if (!target) return err('Page member not found', ErrorCode.NOT_FOUND, 404)

    const body = await request.json()
    if (!body.role || !PAGE_ROLES.includes(body.role)) return err('Valid role is required', ErrorCode.VALIDATION, 400)
    if (body.role === 'OWNER') return err('Cannot promote to owner. Use transfer-ownership.', ErrorCode.VALIDATION, 400)

    if (!canChangeRole(actorMembership.role, target.role, body.role)) {
      return err('Not allowed to change this role', ErrorCode.FORBIDDEN, 403)
    }

    await db.collection('page_members').updateOne(
      { pageId: page.id, userId: targetUserId },
      { $set: { role: body.role, updatedAt: new Date() } }
    )
    await writeAudit(db, 'PAGE_MEMBER_ROLE_CHANGED', user.id, 'PAGE', page.id, { targetUserId, oldRole: target.role, newRole: body.role })

    return { data: { message: 'Role updated' } }
  }

  // ========================
  // DELETE /pages/:id/members/:userId — Remove Member
  // ========================
  if (path[0] === 'pages' && path.length === 4 && path[2] === 'members' && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const page = await findPageByIdOrSlug(db, path[1])
    if (!page) return err('Page not found', ErrorCode.NOT_FOUND, 404)

    const actorMembership = await getActiveMembership(db, page.id, user.id)
    if (!actorMembership) return err('Not a page member', ErrorCode.FORBIDDEN, 403)

    const targetUserId = path[3]
    const isSelfRemoval = targetUserId === user.id

    const target = await db.collection('page_members').findOne({ pageId: page.id, userId: targetUserId, status: 'ACTIVE' })
    if (!target) return err('Page member not found', ErrorCode.NOT_FOUND, 404)

    // Self-removal is allowed (except last owner)
    if (!isSelfRemoval && !canManageMembers(actorMembership.role, target.role)) {
      return err('Not allowed to remove this member', ErrorCode.FORBIDDEN, 403)
    }

    // Last owner protection
    if (target.role === 'OWNER') {
      const ownerCount = await db.collection('page_members').countDocuments({ pageId: page.id, role: 'OWNER', status: 'ACTIVE' })
      if (ownerCount <= 1) return err('Cannot remove the last owner', ErrorCode.VALIDATION, 400)
    }

    await db.collection('page_members').updateOne(
      { pageId: page.id, userId: targetUserId },
      { $set: { status: 'REMOVED', updatedAt: new Date() } }
    )
    await db.collection('pages').updateOne(
      { id: page.id, memberCount: { $gt: 0 } },
      { $inc: { memberCount: -1 }, $set: { updatedAt: new Date() } }
    )
    await writeAudit(db, 'PAGE_MEMBER_REMOVED', user.id, 'PAGE', page.id, { targetUserId, selfRemoval: isSelfRemoval })

    return { data: { message: 'Member removed' } }
  }

  // ========================
  // POST /pages/:id/transfer-ownership — Transfer Ownership
  // ========================
  if (path[0] === 'pages' && path.length === 3 && path[2] === 'transfer-ownership' && method === 'POST') {
    const user = await requireAuth(request, db)
    const page = await findPageByIdOrSlug(db, path[1])
    if (!page) return err('Page not found', ErrorCode.NOT_FOUND, 404)

    const actorMembership = await getActiveMembership(db, page.id, user.id)
    if (!actorMembership || !canTransferOwnership(actorMembership.role)) {
      return err('Only owner can transfer ownership', ErrorCode.FORBIDDEN, 403)
    }

    const body = await request.json()
    if (!body.userId) return err('Target userId is required', ErrorCode.VALIDATION, 400)

    const targetMembership = await db.collection('page_members').findOne({ pageId: page.id, userId: body.userId, status: 'ACTIVE' })
    if (!targetMembership) return err('Target must be an active page member', ErrorCode.NOT_FOUND, 404)

    const now = new Date()
    await db.collection('page_members').updateOne(
      { pageId: page.id, userId: user.id },
      { $set: { role: 'ADMIN', updatedAt: now } }
    )
    await db.collection('page_members').updateOne(
      { pageId: page.id, userId: body.userId },
      { $set: { role: 'OWNER', updatedAt: now } }
    )
    await writeAudit(db, 'PAGE_OWNERSHIP_TRANSFERRED', user.id, 'PAGE', page.id, { newOwnerId: body.userId })

    return { data: { message: 'Ownership transferred' } }
  }

  // ========================
  // POST /pages/:id/follow — Follow Page
  // ========================
  if (path[0] === 'pages' && path.length === 3 && path[2] === 'follow' && method === 'POST') {
    const user = await requireAuth(request, db)
    const page = await findPageByIdOrSlug(db, path[1])
    if (!page) return err('Page not found', ErrorCode.NOT_FOUND, 404)
    if (page.status !== 'ACTIVE') return err('Cannot follow inactive page', ErrorCode.INVALID_STATE, 400)

    try {
      await db.collection('page_follows').insertOne({
        id: uuidv4(),
        pageId: page.id,
        userId: user.id,
        createdAt: new Date(),
      })
      await db.collection('pages').updateOne({ id: page.id }, { $inc: { followerCount: 1 } })
    } catch (e) {
      if (e.code === 11000) return { data: { followed: true, message: 'Already following' } }
      throw e
    }

    return { data: { followed: true, message: 'Followed' } }
  }

  // ========================
  // DELETE /pages/:id/follow — Unfollow Page
  // ========================
  if (path[0] === 'pages' && path.length === 3 && path[2] === 'follow' && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const page = await findPageByIdOrSlug(db, path[1])
    if (!page) return err('Page not found', ErrorCode.NOT_FOUND, 404)

    const result = await db.collection('page_follows').deleteOne({ pageId: page.id, userId: user.id })
    if (result.deletedCount > 0) {
      await db.collection('pages').updateOne(
        { id: page.id, followerCount: { $gt: 0 } },
        { $inc: { followerCount: -1 } }
      )
    }

    return { data: { followed: false, message: 'Unfollowed' } }
  }

  // ========================
  // GET /pages/:id/followers — Page Followers (owner/admin)
  // ========================
  if (path[0] === 'pages' && path.length === 3 && path[2] === 'followers' && method === 'GET') {
    const user = await requireAuth(request, db)
    const page = await findPageByIdOrSlug(db, path[1])
    if (!page) return err('Page not found', ErrorCode.NOT_FOUND, 404)

    const membership = await getActiveMembership(db, page.id, user.id)
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(user.role)
    if (!membership && !isAdmin) return err('Only page members can view followers', ErrorCode.FORBIDDEN, 403)

    const url = new URL(request.url)
    const { limit, cursor } = parsePagination(url)
    const query = { pageId: page.id }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }

    const follows = await db.collection('page_follows')
      .find(query, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = follows.length > limit
    const items = follows.slice(0, limit)

    const userIds = items.map(f => f.userId)
    const users = await db.collection('users').find({ id: { $in: userIds } }).toArray()
    const userMap = Object.fromEntries(users.map(u => [u.id, u]))

    const enriched = items.map(f => ({
      userId: f.userId,
      displayName: userMap[f.userId]?.displayName || null,
      username: userMap[f.userId]?.username || null,
      followedAt: f.createdAt,
    }))

    return {
      data: {
        followers: enriched,
        pagination: {
          nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
          hasMore,
        },
      },
    }
  }

  // ========================
  // GET /pages/:id/posts — List Page-Authored Posts
  // ========================
  if (path[0] === 'pages' && path.length === 3 && path[2] === 'posts' && method === 'GET') {
    const page = await findPageByIdOrSlug(db, path[1])
    if (!page || !canViewPage(page)) return err('Page not found', ErrorCode.NOT_FOUND, 404)

    const currentUser = await authenticate(request, db)
    const url = new URL(request.url)
    const { limit, cursor } = parsePagination(url)

    const query = {
      authorType: 'PAGE',
      pageId: page.id,
      visibility: Visibility.PUBLIC,
      kind: ContentKind.POST,
    }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }

    const posts = await db.collection('content_items')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = posts.length > limit
    const items = posts.slice(0, limit)
    const safeItems = await applyFeedPolicy(db, currentUser?.id, currentUser?.role, items)
    const enriched = await enrichPosts(db, safeItems, currentUser?.id)

    return {
      data: {
        posts: enriched,
        page: toPageSnippet(page),
        pagination: {
          nextCursor: hasMore && items.length > 0 ? items[items.length - 1].createdAt.toISOString() : null,
          hasMore,
        },
      },
    }
  }

  // ========================
  // POST /pages/:id/posts — Create Post as Page
  // ========================
  if (path[0] === 'pages' && path.length === 3 && path[2] === 'posts' && method === 'POST') {
    const user = await requireAuth(request, db)
    const page = await findPageByIdOrSlug(db, path[1])
    if (!page) return err('Page not found', ErrorCode.NOT_FOUND, 404)
    if (page.status !== 'ACTIVE') return err('Page is not active', ErrorCode.INVALID_STATE, 400)

    const membership = await getActiveMembership(db, page.id, user.id)
    if (!membership || !canPublishAsPage(membership.role)) {
      return err('Not allowed to publish as this page', ErrorCode.FORBIDDEN, 403)
    }

    const body = await request.json()
    const { caption, mediaIds } = body

    if (!caption?.trim() && (!mediaIds || mediaIds.length === 0)) {
      return err('Post must have caption or media', ErrorCode.VALIDATION, 400)
    }

    // Resolve media — media belongs to the acting user
    let media = []
    if (mediaIds?.length > 0) {
      const assets = await db.collection('media_assets')
        .find({ id: { $in: mediaIds }, ownerId: user.id })
        .toArray()
      media = assets.map(a => ({
        id: a.id,
        url: `/api/media/${a.id}`,
        type: a.type,
        mimeType: a.mimeType,
        width: a.width,
        height: a.height,
        duration: a.duration || null,
      }))
    }

    const now = new Date()

    // AI Content Moderation — reusing existing pipeline
    let moderationDecision = null
    let reviewTicketId = null
    let visibility = Visibility.PUBLIC

    const textToModerate = caption || ''
    if (textToModerate.length > 0) {
      try {
        const modResult = await moderateCreateContent(db, {
          entityType: 'post',
          actorUserId: user.id,
          collegeId: page.collegeId,
          tribeId: null,
          caption,
          metadata: { route: 'POST /pages/:id/posts', pageId: page.id },
        })
        moderationDecision = modResult.decision
        reviewTicketId = modResult.reviewTicketId
        if (moderationDecision.action === 'ESCALATE') visibility = 'HELD'
      } catch (e) {
        if (e.details?.code === 'CONTENT_REJECTED_BY_MODERATION') {
          return { error: 'Content rejected by moderation', code: ErrorCode.CONTENT_REJECTED, status: 422 }
        }
        throw e
      }
    }

    const contentItem = {
      id: uuidv4(),
      kind: ContentKind.POST,
      // B3: PAGE authorship fields
      authorType: 'PAGE',
      authorId: page.id,
      pageId: page.id,
      actingUserId: user.id,
      actingRole: membership.role,
      createdAs: 'PAGE',
      // Standard content fields
      caption: caption ? caption.slice(0, Config.MAX_CAPTION_LENGTH) : '',
      hashtags: extractHashtags(caption || ''),
      media,
      visibility,
      riskScore: moderationDecision?.confidence || 0,
      policyReasons: moderationDecision?.flaggedCategories || [],
      moderation: moderationDecision ? {
        action: moderationDecision.action,
        provider: moderationDecision.provider,
        providerModel: moderationDecision.providerModel,
        confidence: moderationDecision.confidence,
        flaggedCategories: moderationDecision.flaggedCategories,
        reasons: moderationDecision.reasons,
        reviewTicketId: reviewTicketId || null,
        checkedAt: now,
      } : null,
      collegeId: page.collegeId || null,
      tribeId: null,
      likeCount: 0,
      dislikeCountInternal: 0,
      commentCount: 0,
      saveCount: 0,
      shareCount: 0,
      viewCount: 0,
      syntheticDeclaration: false,
      syntheticLabelStatus: 'UNKNOWN',
      distributionStage: 0,
      duration: null,
      expiresAt: null,
      createdAt: now,
      updatedAt: now,
    }

    await db.collection('content_items').insertOne(contentItem)
    await db.collection('pages').updateOne({ id: page.id }, { $inc: { postCount: 1 } })

    // B5: Sync hashtag stats
    if (contentItem.hashtags.length > 0) {
      await syncHashtags(db, [], contentItem.hashtags)
    }

    await writeAudit(db, 'PAGE_POST_CREATED', user.id, 'CONTENT', contentItem.id, {
      pageId: page.id,
      actingRole: membership.role,
      authorType: 'PAGE',
    })

    await invalidateOnEvent('POST_CREATED', { collegeId: contentItem.collegeId, tribeId: null, kind: ContentKind.POST })

    const enriched = await enrichPosts(db, [contentItem], user.id)
    return { data: { post: enriched[0], page: toPageSnippet(page) }, status: 201 }
  }

  // ========================
  // PATCH /pages/:id/posts/:postId — Edit Page-Authored Post
  // ========================
  if (path[0] === 'pages' && path.length === 4 && path[2] === 'posts' && method === 'PATCH') {
    const user = await requireAuth(request, db)
    const page = await findPageByIdOrSlug(db, path[1])
    if (!page) return err('Page not found', ErrorCode.NOT_FOUND, 404)

    const membership = await getActiveMembership(db, page.id, user.id)
    if (!membership || !canPublishAsPage(membership.role)) {
      return err('Not allowed to edit page posts', ErrorCode.FORBIDDEN, 403)
    }

    const postId = path[3]
    const post = await db.collection('content_items').findOne({ id: postId })
    if (!post) return err('Post not found', ErrorCode.NOT_FOUND, 404)
    if (post.authorType !== 'PAGE' || post.pageId !== page.id) {
      return err('This post does not belong to this page', ErrorCode.FORBIDDEN, 403)
    }

    const body = await request.json()
    const update = { updatedAt: new Date() }
    if (body.caption !== undefined) {
      update.caption = String(body.caption).slice(0, Config.MAX_CAPTION_LENGTH)
      update.hashtags = extractHashtags(update.caption)
      update.editedAt = new Date()
    }

    await db.collection('content_items').updateOne({ id: postId }, { $set: update })

    // B5: Sync hashtag stats on page post edit
    if (update.hashtags) {
      await syncHashtags(db, post.hashtags || [], update.hashtags)
    }

    await writeAudit(db, 'PAGE_POST_UPDATED', user.id, 'CONTENT', postId, { pageId: page.id, actingRole: membership.role })

    const updated = await db.collection('content_items').findOne({ id: postId })
    const enriched = await enrichPosts(db, [updated], user.id)
    return { data: { post: enriched[0] } }
  }

  // ========================
  // DELETE /pages/:id/posts/:postId — Delete Page-Authored Post
  // ========================
  if (path[0] === 'pages' && path.length === 4 && path[2] === 'posts' && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const page = await findPageByIdOrSlug(db, path[1])
    if (!page) return err('Page not found', ErrorCode.NOT_FOUND, 404)

    const membership = await getActiveMembership(db, page.id, user.id)
    if (!membership || !canPublishAsPage(membership.role)) {
      return err('Not allowed to delete page posts', ErrorCode.FORBIDDEN, 403)
    }

    const postId = path[3]
    const post = await db.collection('content_items').findOne({ id: postId })
    if (!post) return err('Post not found', ErrorCode.NOT_FOUND, 404)
    if (post.authorType !== 'PAGE' || post.pageId !== page.id) {
      return err('This post does not belong to this page', ErrorCode.FORBIDDEN, 403)
    }

    await db.collection('content_items').updateOne(
      { id: postId },
      { $set: { visibility: Visibility.REMOVED, updatedAt: new Date() } }
    )
    await db.collection('pages').updateOne(
      { id: page.id, postCount: { $gt: 0 } },
      { $inc: { postCount: -1 } }
    )
    await writeAudit(db, 'PAGE_POST_REMOVED', user.id, 'CONTENT', postId, {
      pageId: page.id,
      actingRole: membership.role,
      removedBy: 'PAGE_MEMBER',
    })

    await invalidateOnEvent('POST_DELETED', { collegeId: post.collegeId, tribeId: post.tribeId, kind: post.kind })

    return { data: { message: 'Post removed' } }
  }

  // ========================
  // DELETE /pages/:id — Delete Page (Owner/Admin only)
  // ========================
  if (path[0] === 'pages' && path.length === 2 && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const page = await findPageByIdOrSlug(db, path[1])
    if (!page) return err('Page not found', ErrorCode.NOT_FOUND, 404)

    const membership = await getActiveMembership(db, page.id, user.id)
    const isAdminUser = ['ADMIN', 'SUPER_ADMIN'].includes(user.role)
    if (!isAdminUser && (!membership || membership.role !== 'OWNER')) {
      return err('Only page owner or admin can delete a page', ErrorCode.FORBIDDEN, 403)
    }

    await db.collection('pages').updateOne({ id: page.id }, {
      $set: { status: 'DELETED', deletedAt: new Date(), deletedByUserId: user.id, updatedAt: new Date() },
    })
    await Promise.all([
      db.collection('page_members').updateMany({ pageId: page.id }, { $set: { status: 'REMOVED', updatedAt: new Date() } }),
      db.collection('page_follows').deleteMany({ pageId: page.id }),
    ])
    await writeAudit(db, 'PAGE_DELETED', user.id, 'PAGE', page.id, { name: page.name, slug: page.slug })
    return { data: { message: 'Page deleted', pageId: page.id } }
  }

  // ========================
  // POST /pages/:id/request-verification — Request page verification
  // ========================
  if (path[0] === 'pages' && path.length === 3 && path[2] === 'request-verification' && method === 'POST') {
    const user = await requireAuth(request, db)
    const page = await findPageByIdOrSlug(db, path[1])
    if (!page) return err('Page not found', ErrorCode.NOT_FOUND, 404)

    const membership = await getActiveMembership(db, page.id, user.id)
    if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) {
      return err('Only page owner/admin can request verification', ErrorCode.FORBIDDEN, 403)
    }
    if (page.verificationStatus === 'VERIFIED') return err('Page is already verified', ErrorCode.INVALID_STATE, 400)
    if (page.verificationStatus === 'PENDING') return err('Verification request already pending', ErrorCode.INVALID_STATE, 400)

    const body = await request.json()
    const reqDoc = {
      id: uuidv4(),
      pageId: page.id,
      requestedByUserId: user.id,
      reason: body.reason ? String(body.reason).slice(0, 500) : null,
      supportingLinks: Array.isArray(body.supportingLinks) ? body.supportingLinks.slice(0, 5).map(l => String(l).slice(0, 500)) : [],
      status: 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    await db.collection('page_verification_requests').insertOne(reqDoc)
    await db.collection('pages').updateOne({ id: page.id }, { $set: { verificationStatus: 'PENDING', updatedAt: new Date() } })
    await writeAudit(db, 'PAGE_VERIFICATION_REQUESTED', user.id, 'PAGE', page.id, { reason: reqDoc.reason })

    const { _id, ...clean } = reqDoc
    return { data: { message: 'Verification request submitted', request: clean }, status: 201 }
  }

  // ========================
  // GET /admin/pages/verification-requests — List verification requests (admin only)
  // ========================
  if (path[0] === 'admin' && path[1] === 'pages' && path[2] === 'verification-requests' && path.length === 3 && method === 'GET') {
    const user = await requireAuth(request, db)
    if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) return err('Admin only', ErrorCode.FORBIDDEN, 403)

    const url = new URL(request.url)
    const { limit, offset } = parsePagination(url)
    const status = url.searchParams.get('status') || 'PENDING'

    const requests = await db.collection('page_verification_requests')
      .find({ status }, { projection: { _id: 0 } })
      .sort({ createdAt: 1 })
      .skip(offset).limit(limit).toArray()

    const pageIds = requests.map(r => r.pageId)
    const pages = pageIds.length > 0 ? await db.collection('pages').find({ id: { $in: pageIds } }).toArray() : []
    const pageMap = Object.fromEntries(pages.map(p => [p.id, toPageSnippet(p)]))
    const enriched = requests.map(r => ({ ...r, page: pageMap[r.pageId] || null }))
    const total = await db.collection('page_verification_requests').countDocuments({ status })

    return { data: { items: enriched, pagination: { total }, total } }
  }

  // ========================
  // POST /admin/pages/verification-decide — Approve/reject verification (admin only)
  // ========================
  if (path[0] === 'admin' && path[1] === 'pages' && path[2] === 'verification-decide' && path.length === 3 && method === 'POST') {
    const user = await requireAuth(request, db)
    if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) return err('Admin only', ErrorCode.FORBIDDEN, 403)

    const body = await request.json()
    const { requestId, decision, reason } = body
    if (!requestId) return err('requestId required', ErrorCode.VALIDATION, 400)
    if (!['APPROVED', 'REJECTED'].includes(decision)) return err('decision must be APPROVED or REJECTED', ErrorCode.VALIDATION, 400)

    const req = await db.collection('page_verification_requests').findOne({ id: requestId })
    if (!req) return err('Verification request not found', ErrorCode.NOT_FOUND, 404)
    if (req.status !== 'PENDING') return err('Request already decided', ErrorCode.INVALID_STATE, 400)

    await db.collection('page_verification_requests').updateOne({ id: requestId }, {
      $set: { status: decision, decidedByUserId: user.id, decisionReason: reason || null, decidedAt: new Date(), updatedAt: new Date() },
    })

    const newVerificationStatus = decision === 'APPROVED' ? 'VERIFIED' : 'REJECTED'
    await db.collection('pages').updateOne({ id: req.pageId }, { $set: { verificationStatus: newVerificationStatus, updatedAt: new Date() } })
    await writeAudit(db, 'PAGE_VERIFICATION_DECIDED', user.id, 'PAGE', req.pageId, { decision, requestId, reason })

    const page = await db.collection('pages').findOne({ id: req.pageId })
    if (page) {
      await createNotification(db, {
        recipientId: req.requestedByUserId,
        type: 'PAGE_VERIFICATION_RESULT',
        actorId: user.id,
        entityType: 'PAGE',
        entityId: req.pageId,
        message: decision === 'APPROVED' ? `Your page "${page.name}" has been verified!` : `Verification for "${page.name}" was not approved.`,
      })
    }

    return { data: { message: `Verification ${decision.toLowerCase()}`, pageId: req.pageId, decision } }
  }

  // ========================
  // POST /pages/:id/report — Report a page
  // ========================
  if (path[0] === 'pages' && path.length === 3 && path[2] === 'report' && method === 'POST') {
    const user = await requireAuth(request, db)
    const page = await findPageByIdOrSlug(db, path[1])
    if (!page) return err('Page not found', ErrorCode.NOT_FOUND, 404)

    const body = await request.json()
    if (!body.reason) return err('Reason is required', ErrorCode.VALIDATION, 400)

    const existing = await db.collection('reports').findOne({ reporterId: user.id, entityType: 'PAGE', entityId: page.id })
    if (existing) return err('You have already reported this page', ErrorCode.CONFLICT, 409)

    const report = {
      id: uuidv4(), reporterId: user.id, entityType: 'PAGE', entityId: page.id,
      reason: String(body.reason).slice(0, 500), category: body.category || 'OTHER',
      status: 'PENDING', createdAt: new Date(), updatedAt: new Date(),
    }
    await db.collection('reports').insertOne(report)
    await writeAudit(db, 'PAGE_REPORTED', user.id, 'PAGE', page.id, { reason: report.reason })
    return { data: { message: 'Page reported', reportId: report.id }, status: 201 }
  }

  // ========================
  // POST /pages/:id/invite — Invite user to page
  // ========================
  if (path[0] === 'pages' && path.length === 3 && path[2] === 'invite' && method === 'POST') {
    const user = await requireAuth(request, db)
    const page = await findPageByIdOrSlug(db, path[1])
    if (!page) return err('Page not found', ErrorCode.NOT_FOUND, 404)

    const membership = await getActiveMembership(db, page.id, user.id)
    const isAdminUser = ['ADMIN', 'SUPER_ADMIN'].includes(user.role)
    if (!isAdminUser && (!membership || !canManageMembers(membership.role))) {
      return err('Insufficient permissions', ErrorCode.FORBIDDEN, 403)
    }

    const body = await request.json()
    if (!body.userId) return err('userId is required', ErrorCode.VALIDATION, 400)
    const target = await db.collection('users').findOne({ id: body.userId })
    if (!target) return err('User not found', ErrorCode.NOT_FOUND, 404)

    const existingMember = await db.collection('page_members').findOne({ pageId: page.id, userId: body.userId, status: 'ACTIVE' })
    if (existingMember) return err('User is already a member', ErrorCode.CONFLICT, 409)

    const role = body.role && PAGE_ROLES.includes(body.role) ? body.role : 'MEMBER'
    const now = new Date()
    await db.collection('page_members').updateOne(
      { pageId: page.id, userId: body.userId },
      {
        $set: { role, status: 'ACTIVE', addedByUserId: user.id, updatedAt: now },
        $setOnInsert: { id: uuidv4(), pageId: page.id, userId: body.userId, createdAt: now },
      },
      { upsert: true }
    )
    await db.collection('pages').updateOne({ id: page.id }, { $inc: { memberCount: 1 }, $set: { updatedAt: now } })
    await createNotification(db, {
      recipientId: body.userId, type: 'PAGE_INVITE', actorId: user.id,
      entityType: 'PAGE', entityId: page.id,
      message: `You've been added to "${page.name}" as ${role}`,
    })
    await writeAudit(db, 'PAGE_MEMBER_INVITED', user.id, 'PAGE', page.id, { invitedUserId: body.userId, role })
    return { data: { message: 'User invited to page', userId: body.userId, role }, status: 201 }
  }

  // ========================
  // GET /me/pages — My Managed Pages
  // ========================
  if (path[0] === 'me' && path[1] === 'pages' && path.length === 2 && method === 'GET') {
    const user = await requireAuth(request, db)

    const memberships = await db.collection('page_members')
      .find({ userId: user.id, status: 'ACTIVE' }, { projection: { _id: 0 } })
      .toArray()

    const pageIds = memberships.map(m => m.pageId)
    if (pageIds.length === 0) return { data: { pages: [], count: 0 } }

    const pages = await db.collection('pages')
      .find({ id: { $in: pageIds } }, { projection: { _id: 0 } })
      .sort({ updatedAt: -1 })
      .toArray()

    const roleByPageId = Object.fromEntries(memberships.map(m => [m.pageId, m.role]))

    const result = pages.map(p => ({
      ...toPageSnippet(p),
      myRole: roleByPageId[p.id] || null,
    }))

    return { data: { pages: result, count: result.length } }
  }

  // ========================
  // GET /pages/:id/analytics — Page Analytics Dashboard
  // ========================
  if (path[0] === 'pages' && path.length === 3 && path[2] === 'analytics' && method === 'GET') {
    const user = await requireAuth(request, db)
    const page = await findPageByIdOrSlug(db, path[1])
    if (!page) return err('Page not found', ErrorCode.NOT_FOUND, 404)

    const membership = await getActiveMembership(db, page.id, user.id)
    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(user.role)
    if (!membership && !isAdmin) return err('Only page members can view analytics', ErrorCode.FORBIDDEN, 403)
    if (membership && !canManagePageIdentity(membership.role) && !isAdmin) {
      return err('Only OWNER/ADMIN can view analytics', ErrorCode.FORBIDDEN, 403)
    }

    const url = new URL(request.url)
    const period = url.searchParams.get('period') || '30d'
    const daysBack = period === '7d' ? 7 : period === '90d' ? 90 : 30
    const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000)

    // ─── 1. Aggregate post engagement metrics ───
    const postAgg = await db.collection('content_items').aggregate([
      {
        $match: {
          authorType: 'PAGE',
          pageId: page.id,
          visibility: Visibility.PUBLIC,
        },
      },
      {
        $group: {
          _id: null,
          totalPosts: { $sum: 1 },
          totalLikes: { $sum: { $ifNull: ['$likeCount', 0] } },
          totalComments: { $sum: { $ifNull: ['$commentCount', 0] } },
          totalSaves: { $sum: { $ifNull: ['$saveCount', 0] } },
          totalShares: { $sum: { $ifNull: ['$shareCount', 0] } },
          totalViews: { $sum: { $ifNull: ['$viewCount', 0] } },
        },
      },
    ]).toArray()

    const totals = postAgg[0] || {
      totalPosts: 0, totalLikes: 0, totalComments: 0,
      totalSaves: 0, totalShares: 0, totalViews: 0,
    }

    // ─── 2. Period-specific metrics ───
    const periodAgg = await db.collection('content_items').aggregate([
      {
        $match: {
          authorType: 'PAGE',
          pageId: page.id,
          visibility: Visibility.PUBLIC,
          createdAt: { $gte: since },
        },
      },
      {
        $group: {
          _id: null,
          postsInPeriod: { $sum: 1 },
          likesInPeriod: { $sum: { $ifNull: ['$likeCount', 0] } },
          commentsInPeriod: { $sum: { $ifNull: ['$commentCount', 0] } },
          savesInPeriod: { $sum: { $ifNull: ['$saveCount', 0] } },
          sharesInPeriod: { $sum: { $ifNull: ['$shareCount', 0] } },
          viewsInPeriod: { $sum: { $ifNull: ['$viewCount', 0] } },
        },
      },
    ]).toArray()

    const periodTotals = periodAgg[0] || {
      postsInPeriod: 0, likesInPeriod: 0, commentsInPeriod: 0,
      savesInPeriod: 0, sharesInPeriod: 0, viewsInPeriod: 0,
    }

    // ─── 3. Top posts by engagement (likes + comments + saves) ───
    const topPosts = await db.collection('content_items').aggregate([
      {
        $match: {
          authorType: 'PAGE',
          pageId: page.id,
          visibility: Visibility.PUBLIC,
        },
      },
      {
        $addFields: {
          engagementScore: {
            $add: [
              { $ifNull: ['$likeCount', 0] },
              { $multiply: [{ $ifNull: ['$commentCount', 0] }, 2] },
              { $multiply: [{ $ifNull: ['$saveCount', 0] }, 3] },
            ],
          },
        },
      },
      { $sort: { engagementScore: -1 } },
      { $limit: 5 },
      {
        $project: {
          _id: 0,
          id: 1,
          caption: { $substrBytes: [{ $ifNull: ['$caption', ''] }, 0, 120] },
          likeCount: { $ifNull: ['$likeCount', 0] },
          commentCount: { $ifNull: ['$commentCount', 0] },
          saveCount: { $ifNull: ['$saveCount', 0] },
          shareCount: { $ifNull: ['$shareCount', 0] },
          viewCount: { $ifNull: ['$viewCount', 0] },
          engagementScore: 1,
          createdAt: 1,
        },
      },
    ]).toArray()

    // ─── 4. Daily post activity (posts per day in period) ───
    const dailyActivity = await db.collection('content_items').aggregate([
      {
        $match: {
          authorType: 'PAGE',
          pageId: page.id,
          visibility: Visibility.PUBLIC,
          createdAt: { $gte: since },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          },
          posts: { $sum: 1 },
          likes: { $sum: { $ifNull: ['$likeCount', 0] } },
          comments: { $sum: { $ifNull: ['$commentCount', 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]).toArray()

    const postTimeline = dailyActivity.map(d => ({
      date: d._id,
      posts: d.posts,
      likes: d.likes,
      comments: d.comments,
    }))

    // ─── 5. Follower growth in period ───
    const followerGrowth = await db.collection('page_follows').aggregate([
      {
        $match: {
          pageId: page.id,
          createdAt: { $gte: since },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          },
          newFollowers: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]).toArray()

    const followerTimeline = followerGrowth.map(d => ({
      date: d._id,
      newFollowers: d.newFollowers,
    }))

    const newFollowersInPeriod = followerTimeline.reduce((sum, d) => sum + d.newFollowers, 0)

    // ─── 6. Engagement rate ───
    const engagementRate = totals.totalPosts > 0
      ? ((totals.totalLikes + totals.totalComments + totals.totalSaves) / totals.totalPosts).toFixed(2)
      : '0.00'

    const periodEngagementRate = periodTotals.postsInPeriod > 0
      ? ((periodTotals.likesInPeriod + periodTotals.commentsInPeriod + periodTotals.savesInPeriod) / periodTotals.postsInPeriod).toFixed(2)
      : '0.00'

    // ─── 7. Member breakdown ───
    const memberBreakdown = await db.collection('page_members').aggregate([
      { $match: { pageId: page.id, status: 'ACTIVE' } },
      { $group: { _id: '$role', count: { $sum: 1 } } },
    ]).toArray()

    const membersByRole = Object.fromEntries(memberBreakdown.map(m => [m._id, m.count]))

    return {
      data: {
        pageId: page.id,
        pageName: page.name,
        period,
        daysBack,
        overview: {
          followerCount: page.followerCount || 0,
          memberCount: page.memberCount || 0,
          totalPosts: totals.totalPosts,
          engagementRate: parseFloat(engagementRate),
        },
        lifetime: {
          totalLikes: totals.totalLikes,
          totalComments: totals.totalComments,
          totalSaves: totals.totalSaves,
          totalShares: totals.totalShares,
          totalViews: totals.totalViews,
        },
        periodMetrics: {
          postsCreated: periodTotals.postsInPeriod,
          likes: periodTotals.likesInPeriod,
          comments: periodTotals.commentsInPeriod,
          saves: periodTotals.savesInPeriod,
          shares: periodTotals.sharesInPeriod,
          views: periodTotals.viewsInPeriod,
          newFollowers: newFollowersInPeriod,
          engagementRate: parseFloat(periodEngagementRate),
        },
        topPosts,
        postTimeline,
        followerTimeline,
        membersByRole,
      },
    }
  }

  return null
}
