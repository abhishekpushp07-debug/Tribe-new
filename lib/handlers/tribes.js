/**
 * Tribe — Stage 12: World's Best Tribe System Handler
 *
 * Phase 12A-12K: Canonical 21-Tribe system with governance, contests,
 * salute ledger, standings, fund accounting, and safe migration bridge.
 *
 * ~17 API endpoints, 14 collections, 30+ indexes
 */

import { v4 as uuidv4 } from 'uuid'
import { requireAuth, authenticate, requireRole, writeAudit, sanitizeUser, parsePagination, enrichPosts } from '../auth-utils.js'
import { ErrorCode } from '../constants.js'
import { cache, CacheTTL, CacheNS, invalidateOnEvent } from '../cache.js'
import { TRIBES, assignTribeV3, HOUSE_TO_TRIBE_MAP } from '../tribe-constants.js'
import { computeLeaderboard, invalidateLeaderboardCache } from '../services/scoring.js'

// ========== CONSTANTS ==========

const BOARD_ROLES = ['CAPTAIN', 'VICE_CAPTAIN', 'WELFARE_LEAD', 'EVENTS_LEAD', 'FINANCE_LEAD', 'DISCIPLINE_LEAD', 'COMMUNITY_LEAD']
const CONTEST_STATUSES = ['DRAFT', 'OPEN', 'CLOSED', 'RESOLVED']
const SEASON_STATUSES = ['DRAFT', 'ACTIVE', 'COMPLETED']
const SALUTE_REASONS = [
  'CONTEST_WIN', 'CONTEST_RUNNER_UP', 'CONTENT_BONUS', 'ADMIN_AWARD',
  'ADMIN_DEDUCT', 'REVERSAL', 'MIGRATION_CARRYOVER', 'WEEKLY_BONUS',
]
const DEFAULT_AWARD_TITLE = 'Emerald Tribe of the Year'
const DEFAULT_PRIZE_FUND = 1000000 // INR 10,00,000

// ========== HELPERS ==========
function isAdmin(user) {
  return ['ADMIN', 'SUPER_ADMIN'].includes(user.role)
}
function isMod(user) {
  return ['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)
}

function sanitizeDoc(d) {
  if (!d) return null
  const { _id, ...clean } = d
  return clean
}

function sanitizeDocs(arr) {
  return arr.map(sanitizeDoc).filter(Boolean)
}

// ========== TRIBE SEEDING ==========
let tribesSeeded = false

async function ensureTribesSeeded(db) {
  if (tribesSeeded) return
  const count = await db.collection('tribes').countDocuments()
  if (count >= 21) { tribesSeeded = true; return }

  for (const t of TRIBES) {
    const existing = await db.collection('tribes').findOne({ tribeCode: t.tribeCode })
    if (!existing) {
      await db.collection('tribes').insertOne({
        id: uuidv4(),
        tribeCode: t.tribeCode,
        tribeName: t.tribeName,
        heroName: t.heroName,
        paramVirChakraName: t.paramVirChakraName,
        animalIcon: t.animalIcon,
        primaryColor: t.primaryColor,
        secondaryColor: t.secondaryColor,
        quote: t.quote,
        sortOrder: t.sortOrder,
        isActive: true,
        membersCount: 0,
        totalSalutes: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    }
  }
  tribesSeeded = true
}

// ========== CORE: assignAndRecordMembership ==========
/**
 * Idempotent, race-safe tribe assignment.
 * If user already has a primary tribe, returns existing.
 * Otherwise assigns via assignTribeV3 and records membership.
 */
async function assignAndRecordMembership(db, userId, method = 'BALANCED_RANDOM_SIGNUP_V3', assignedBy = null, migrationSource = null, legacyHouseId = null) {
  // Check existing primary membership
  const existing = await db.collection('user_tribe_memberships').findOne({ userId, isPrimary: true })
  if (existing) return { membership: sanitizeDoc(existing), isNew: false }

  // Determine tribe
  const tribeData = assignTribeV3(userId)
  await ensureTribesSeeded(db)
  const tribe = await db.collection('tribes').findOne({ tribeCode: tribeData.tribeCode })
  if (!tribe) throw new Error(`Tribe ${tribeData.tribeCode} not found in DB`)

  const membershipId = uuidv4()
  const now = new Date()
  const membership = {
    id: membershipId,
    userId,
    tribeId: tribe.id,
    tribeCode: tribe.tribeCode,
    assignmentMethod: method,
    assignmentVersion: 'V3',
    assignedAt: now,
    assignedBy: assignedBy || 'SYSTEM',
    status: 'ACTIVE',
    isPrimary: true,
    migrationSource: migrationSource || null,
    legacyHouseId: legacyHouseId || null,
    reassignmentCount: 0,
    auditRef: uuidv4(),
    createdAt: now,
    updatedAt: now,
  }

  try {
    await db.collection('user_tribe_memberships').insertOne(membership)
  } catch (e) {
    // Race condition: another request already inserted
    if (e.code === 11000) {
      const dup = await db.collection('user_tribe_memberships').findOne({ userId, isPrimary: true })
      return { membership: sanitizeDoc(dup), isNew: false }
    }
    throw e
  }

  // Increment tribe member count
  await db.collection('tribes').updateOne({ id: tribe.id }, { $inc: { membersCount: 1 }, $set: { updatedAt: now } })

  // Record assignment event
  await db.collection('tribe_assignment_events').insertOne({
    id: uuidv4(),
    userId,
    tribeId: tribe.id,
    tribeCode: tribe.tribeCode,
    action: 'ASSIGNED',
    method,
    assignedBy: assignedBy || 'SYSTEM',
    migrationSource,
    legacyHouseId,
    createdAt: now,
  })

  return { membership: sanitizeDoc(membership), isNew: true, tribe: sanitizeDoc(tribe) }
}

// ========== MAIN HANDLER ==========
export async function handleTribes(path, method, request, db) {
  await ensureTribesSeeded(db)

  // ========================
  // GET /tribes — List all 21 tribes
  // ========================
  if (path[0] === 'tribes' && path.length === 1 && method === 'GET') {
    const cached = await cache.get(CacheNS.TRIBE_LIST, 'all')
    if (cached) return { data: cached }

    const tribes = await db.collection('tribes').find({ isActive: true }).sort({ sortOrder: 1 }).toArray()
    const result = { items: sanitizeDocs(tribes), tribes: sanitizeDocs(tribes), count: tribes.length }
    await cache.set(CacheNS.TRIBE_LIST, 'all', result, CacheTTL.TRIBE_LIST)
    return { data: result }
  }

  // ========================
  // GET /tribes/leaderboard — Engagement-ranked tribe leaderboard
  // Delegated to ScoringService: tiered viral bonuses, caching, anti-cheat
  // ========================
  if (path[0] === 'tribes' && path[1] === 'leaderboard' && path.length === 2 && method === 'GET') {
    const url = new URL(request.url)
    const periodParam = url.searchParams.get('period') || '30d'
    const validPeriods = ['7d', '30d', '90d', 'all']
    const period = validPeriods.includes(periodParam) ? periodParam : '30d'

    const cacheKey = `lb:${period}`
    const cached = await cache.get(CacheNS.TRIBE_LEADERBOARD, cacheKey)
    if (cached) return { data: cached }

    const result = await computeLeaderboard(db, { period })
    await cache.set(CacheNS.TRIBE_LEADERBOARD, cacheKey, result, CacheTTL.TRIBE_LEADERBOARD)
    return { data: result }
  }

  // ========================
  // GET /tribes/standings/current — Current season standings
  // ========================
  if (path[0] === 'tribes' && path[1] === 'standings' && path[2] === 'current' && path.length === 3 && method === 'GET') {
    const cached = await cache.get(CacheNS.TRIBE_STANDINGS, 'current')
    if (cached) return { data: cached }

    // Find active season
    const season = await db.collection('tribe_seasons').findOne({ status: 'ACTIVE' })
    if (!season) {
      // Fallback: derive from all-time salute ledger
      const tribes = await db.collection('tribes').find({ isActive: true }).sort({ totalSalutes: -1 }).toArray()
      const standingsResult = {
          season: null,
          standings: tribes.map((t, i) => ({
            rank: i + 1,
            tribeId: t.id,
            tribeCode: t.tribeCode,
            tribeName: t.tribeName,
            primaryColor: t.primaryColor,
            secondaryColor: t.secondaryColor,
            animalIcon: t.animalIcon,
            quote: t.quote,
            totalSalutes: t.totalSalutes || 0,
            membersCount: t.membersCount || 0,
            salutesPerMember: t.membersCount > 0 ? Math.round((t.totalSalutes || 0) / t.membersCount * 10) / 10 : 0,
          })),
        }
      await cache.set(CacheNS.TRIBE_STANDINGS, 'current', standingsResult, CacheTTL.TRIBE_STANDINGS)
      return { data: standingsResult }
    }

    // Get standings for active season
    const standings = await db.collection('tribe_standings')
      .find({ seasonId: season.id })
      .sort({ totalSalutes: -1 })
      .toArray()

    // Enrich with tribe info
    const tribeIds = standings.map(s => s.tribeId)
    const tribes = await db.collection('tribes').find({ id: { $in: tribeIds } }).toArray()
    const tribeMap = Object.fromEntries(tribes.map(t => [t.id, sanitizeDoc(t)]))

    const enriched = standings.map((s, i) => ({
      rank: i + 1,
      ...sanitizeDoc(s),
      tribe: tribeMap[s.tribeId] || null,
    }))

    const enrichedResult = { season: sanitizeDoc(season), standings: enriched }
    await cache.set(CacheNS.TRIBE_STANDINGS, 'current', enrichedResult, CacheTTL.TRIBE_STANDINGS)
    return { data: enrichedResult }
  }

  // ========================
  // GET /tribes/:id — Tribe detail (CACHED)
  // ========================
  if (path[0] === 'tribes' && path.length === 2 && method === 'GET' && !['standings', 'leaderboard', 'me', 'compare', 'contributors'].includes(path[1])) {
    const tribeIdOrCode = path[1]
    const detailCacheKey = `detail:${tribeIdOrCode}`
    const cached = await cache.get(CacheNS.TRIBE_DETAIL, detailCacheKey)
    if (cached) return { data: cached }

    const tribe = await db.collection('tribes').findOne({
      $or: [{ id: tribeIdOrCode }, { tribeCode: tribeIdOrCode.toUpperCase() }],
    })
    if (!tribe) return { error: 'Tribe not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Batch: members + board + salutes in parallel
    const [topMembers, board, recentSalutes] = await Promise.all([
      db.collection('user_tribe_memberships')
        .find({ tribeId: tribe.id, isPrimary: true, status: 'ACTIVE' })
        .sort({ createdAt: 1 })
        .limit(10)
        .project({ _id: 0, userId: 1, role: 1, createdAt: 1 })
        .toArray(),
      db.collection('tribe_boards').findOne({ tribeId: tribe.id, status: 'ACTIVE' }, { projection: { _id: 0 } }),
      db.collection('tribe_salute_ledger')
        .find({ tribeId: tribe.id })
        .sort({ createdAt: -1 })
        .limit(10)
        .project({ _id: 0 })
        .toArray(),
    ])

    const userIds = topMembers.map(m => m.userId)
    const users = userIds.length > 0
      ? await db.collection('users').find({ id: { $in: userIds } }, { projection: { _id: 0, id: 1, displayName: 1, username: 1, avatarMediaId: 1, role: 1 } }).toArray()
      : []
    const userMap = Object.fromEntries(users.map(u => [u.id, sanitizeUser(u)]))

    let boardMembers = []
    if (board) {
      boardMembers = await db.collection('tribe_board_members')
        .find({ boardId: board.id, status: 'ACTIVE' })
        .project({ _id: 0 })
        .toArray()
      const bmUserIds = boardMembers.map(bm => bm.userId)
      const bmUsers = bmUserIds.length > 0
        ? await db.collection('users').find({ id: { $in: bmUserIds } }, { projection: { _id: 0, id: 1, displayName: 1, username: 1, avatarMediaId: 1, role: 1 } }).toArray()
        : []
      const bmUserMap = Object.fromEntries(bmUsers.map(u => [u.id, sanitizeUser(u)]))
      boardMembers = sanitizeDocs(boardMembers).map(bm => ({ ...bm, user: bmUserMap[bm.userId] || null }))
    }

    const result = {
      tribe: sanitizeDoc(tribe),
      topMembers: topMembers.map(m => ({ ...m, user: userMap[m.userId] || null })),
      board: board ? { ...sanitizeDoc(board), members: boardMembers } : null,
      recentSalutes,
    }
    await cache.set(CacheNS.TRIBE_DETAIL, detailCacheKey, result, CacheTTL.TRIBE_DETAIL)
    return { data: result }
  }

  // ========================
  // GET /tribes/:id/members — Tribe members list
  // ========================
  if (path[0] === 'tribes' && path.length === 3 && path[2] === 'members' && method === 'GET') {
    const tribeIdOrCode = path[1]
    const tribe = await db.collection('tribes').findOne({
      $or: [{ id: tribeIdOrCode }, { tribeCode: tribeIdOrCode.toUpperCase() }],
    })
    if (!tribe) return { error: 'Tribe not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100)
    const offset = parseInt(url.searchParams.get('offset') || '0')

    const [memberships, total] = await Promise.all([
      db.collection('user_tribe_memberships')
        .find({ tribeId: tribe.id, isPrimary: true, status: 'ACTIVE' })
        .sort({ assignedAt: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      db.collection('user_tribe_memberships').countDocuments({ tribeId: tribe.id, isPrimary: true, status: 'ACTIVE' }),
    ])

    const userIds = memberships.map(m => m.userId)
    const users = userIds.length > 0
      ? await db.collection('users').find({ id: { $in: userIds } }).toArray()
      : []
    const userMap = Object.fromEntries(users.map(u => [u.id, sanitizeUser(u)]))

    const items = memberships.map(m => ({
      userId: m.userId,
      assignedAt: m.assignedAt,
      user: userMap[m.userId] || null,
    }))

    const hasMore = offset + limit < total
    return { data: { tribe: sanitizeDoc(tribe), items, pagination: { total, hasMore, limit, offset }, total } }
  }

  // ========================
  // GET /tribes/:id/board — Tribe board governance
  // ========================
  if (path[0] === 'tribes' && path.length === 3 && path[2] === 'board' && method === 'GET') {
    const tribeIdOrCode = path[1]
    const tribe = await db.collection('tribes').findOne({
      $or: [{ id: tribeIdOrCode }, { tribeCode: tribeIdOrCode.toUpperCase() }],
    })
    if (!tribe) return { error: 'Tribe not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const board = await db.collection('tribe_boards').findOne({ tribeId: tribe.id, status: 'ACTIVE' })
    if (!board) return { data: { board: null, members: [] } }

    const members = await db.collection('tribe_board_members')
      .find({ boardId: board.id, status: 'ACTIVE' })
      .sort({ role: 1 })
      .toArray()

    const userIds = members.map(m => m.userId)
    const users = userIds.length > 0
      ? await db.collection('users').find({ id: { $in: userIds } }).toArray()
      : []
    const userMap = Object.fromEntries(users.map(u => [u.id, sanitizeUser(u)]))

    return {
      data: {
        board: sanitizeDoc(board),
        members: sanitizeDocs(members).map(m => ({ ...m, user: userMap[m.userId] || null })),
      },
    }
  }

  // ========================
  // GET /tribes/:id/fund — Tribe fund info
  // ========================
  if (path[0] === 'tribes' && path.length === 3 && path[2] === 'fund' && method === 'GET') {
    const tribeIdOrCode = path[1]
    const tribe = await db.collection('tribes').findOne({
      $or: [{ id: tribeIdOrCode }, { tribeCode: tribeIdOrCode.toUpperCase() }],
    })
    if (!tribe) return { error: 'Tribe not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const account = await db.collection('tribe_fund_accounts').findOne({ tribeId: tribe.id })

    const recentTransactions = await db.collection('tribe_fund_ledger')
      .find({ tribeId: tribe.id })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray()

    return {
      data: {
        fund: account ? sanitizeDoc(account) : { tribeId: tribe.id, balance: 0, currency: 'INR' },
        recentTransactions: sanitizeDocs(recentTransactions),
      },
    }
  }

  // ========================
  // GET /tribes/:id/salutes — Salute history for tribe
  // ========================
  if (path[0] === 'tribes' && path.length === 3 && path[2] === 'salutes' && method === 'GET') {
    const tribeIdOrCode = path[1]
    const tribe = await db.collection('tribes').findOne({
      $or: [{ id: tribeIdOrCode }, { tribeCode: tribeIdOrCode.toUpperCase() }],
    })
    if (!tribe) return { error: 'Tribe not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100)
    const offset = parseInt(url.searchParams.get('offset') || '0')

    const [entries, total] = await Promise.all([
      db.collection('tribe_salute_ledger')
        .find({ tribeId: tribe.id })
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .toArray(),
      db.collection('tribe_salute_ledger').countDocuments({ tribeId: tribe.id }),
    ])

    const hasMore = offset + limit < total
    return { data: { items: sanitizeDocs(entries), pagination: { total, hasMore, limit, offset }, total } }
  }

  // ========================
  // GET /me/tribe — My tribe info
  // ========================
  if (path[0] === 'me' && path[1] === 'tribe' && path.length === 2 && method === 'GET') {
    const user = await requireAuth(request, db)

    // Get or assign tribe
    const { membership, isNew, tribe: assignedTribe } = await assignAndRecordMembership(db, user.id)

    const tribe = assignedTribe || await db.collection('tribes').findOne({ id: membership.tribeId })

    return {
      data: {
        membership: membership,
        tribe: sanitizeDoc(tribe),
        isNew,
      },
    }
  }

  // ========================
  // GET /users/:id/tribe — Another user's tribe
  // ========================
  if (path[0] === 'users' && path.length === 3 && path[2] === 'tribe' && method === 'GET') {
    const targetUserId = path[1]
    const membership = await db.collection('user_tribe_memberships').findOne({ userId: targetUserId, isPrimary: true })
    if (!membership) return { data: { membership: null, tribe: null } }

    const tribe = await db.collection('tribes').findOne({ id: membership.tribeId })
    return { data: { membership: sanitizeDoc(membership), tribe: sanitizeDoc(tribe) } }
  }

  // ========================
  // POST /tribes/:id/join — Join a tribe
  // ========================
  if (path[0] === 'tribes' && path.length === 3 && path[2] === 'join' && method === 'POST') {
    const user = await requireAuth(request, db)
    const tribeIdOrCode = path[1]
    const tribe = await db.collection('tribes').findOne({
      $or: [{ id: tribeIdOrCode }, { tribeCode: tribeIdOrCode.toUpperCase() }],
    })
    if (!tribe) return { error: 'Tribe not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const existing = await db.collection('user_tribe_memberships').findOne({ userId: user.id, tribeId: tribe.id, status: 'ACTIVE' })
    if (existing) return { error: 'Already a member of this tribe', code: 'DUPLICATE', status: 409 }

    // Check if already in another tribe as primary
    const currentPrimary = await db.collection('user_tribe_memberships').findOne({ userId: user.id, isPrimary: true, status: 'ACTIVE' })

    const now = new Date()
    try {
      await db.collection('user_tribe_memberships').insertOne({
        id: uuidv4(), userId: user.id, tribeId: tribe.id,
        tribeCode: tribe.tribeCode,
        isPrimary: !currentPrimary, status: 'ACTIVE',
        assignmentMethod: 'USER_JOIN',
        assignedAt: now, createdAt: now, updatedAt: now,
      })
    } catch (e) {
      if (e.code === 11000) {
        return { error: 'Already a member or duplicate membership', code: 'DUPLICATE', status: 409 }
      }
      throw e
    }
    await db.collection('tribes').updateOne({ id: tribe.id }, { $inc: { membersCount: 1 }, $set: { updatedAt: now } })

    // Audit trail
    await db.collection('tribe_assignment_events').insertOne({
      id: uuidv4(), userId: user.id, tribeId: tribe.id,
      tribeCode: tribe.tribeCode, action: 'JOINED',
      method: 'USER_JOIN', assignedBy: user.id, createdAt: now,
    })

    return { data: { message: `Joined tribe ${tribe.tribeName || tribe.tribeCode}`, tribeId: tribe.id, tribeCode: tribe.tribeCode }, status: 201 }
  }

  // ========================
  // POST /tribes/:id/leave — Leave a tribe
  // ========================
  if (path[0] === 'tribes' && path.length === 3 && path[2] === 'leave' && method === 'POST') {
    const user = await requireAuth(request, db)
    const tribeIdOrCode = path[1]
    const tribe = await db.collection('tribes').findOne({
      $or: [{ id: tribeIdOrCode }, { tribeCode: tribeIdOrCode.toUpperCase() }],
    })
    if (!tribe) return { error: 'Tribe not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const membership = await db.collection('user_tribe_memberships').findOne({ userId: user.id, tribeId: tribe.id, status: 'ACTIVE' })
    if (!membership) return { error: 'Not a member of this tribe', code: 'NOT_FOUND', status: 404 }

    const now = new Date()
    await db.collection('user_tribe_memberships').updateOne({ id: membership.id }, { $set: { status: 'LEFT', leftAt: now, updatedAt: now } })
    await db.collection('tribes').updateOne({ id: tribe.id }, { $inc: { membersCount: -1 }, $set: { updatedAt: now } })

    // Audit trail
    await db.collection('tribe_assignment_events').insertOne({
      id: uuidv4(), userId: user.id, tribeId: tribe.id,
      tribeCode: tribe.tribeCode, action: 'LEFT',
      method: 'USER_LEAVE', assignedBy: user.id, createdAt: now,
    })

    return { data: { message: `Left tribe ${tribe.tribeName || tribe.tribeCode}` } }
  }

  // ========================
  // GET /tribes/:id/feed — Tribe content feed
  // ========================
  if (path[0] === 'tribes' && path.length === 3 && path[2] === 'feed' && method === 'GET') {
    const tribeIdOrCode = path[1]
    const tribe = await db.collection('tribes').findOne({
      $or: [{ id: tribeIdOrCode }, { tribeCode: tribeIdOrCode.toUpperCase() }],
    })
    if (!tribe) return { error: 'Tribe not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
    const cursor = url.searchParams.get('cursor')

    // Get member user IDs
    const memberships = await db.collection('user_tribe_memberships')
      .find({ tribeId: tribe.id, status: 'ACTIVE' })
      .project({ userId: 1, _id: 0 })
      .limit(500)
      .toArray()
    const memberIds = memberships.map(m => m.userId)

    const query = { authorId: { $in: memberIds }, kind: 'POST', visibility: 'PUBLIC' }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }

    const posts = await db.collection('content_items')
      .find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = posts.length > limit
    const items = posts.slice(0, limit)
    const currentUser = await authenticate(request, db)
    const enriched = await enrichPosts(db, items, currentUser?.id)

    return {
      data: {
        tribe: sanitizeDoc(tribe),
        items: enriched,
        pagination: { nextCursor: hasMore && items.length > 0 ? items[items.length - 1].createdAt.toISOString() : null, hasMore },
      },
    }
  }

  // ========================
  // GET /tribes/:id/events — Tribe events
  // ========================
  if (path[0] === 'tribes' && path.length === 3 && path[2] === 'events' && method === 'GET') {
    const tribeIdOrCode = path[1]
    const tribe = await db.collection('tribes').findOne({
      $or: [{ id: tribeIdOrCode }, { tribeCode: tribeIdOrCode.toUpperCase() }],
    })
    if (!tribe) return { error: 'Tribe not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)

    // Get member IDs and find events they created
    const memberships = await db.collection('user_tribe_memberships')
      .find({ tribeId: tribe.id, status: 'ACTIVE' })
      .project({ userId: 1, _id: 0 })
      .limit(500)
      .toArray()
    const memberIds = memberships.map(m => m.userId)

    const events = await db.collection('events')
      .find({ creatorId: { $in: memberIds }, status: { $in: ['PUBLISHED', 'ACTIVE'] } })
      .sort({ startDate: 1 })
      .limit(limit)
      .toArray()

    return { data: { tribe: sanitizeDoc(tribe), items: sanitizeDocs(events) } }
  }

  // ========================
  // GET /tribes/:id/stats — Tribe statistics
  // ========================
  if (path[0] === 'tribes' && path.length === 3 && path[2] === 'stats' && method === 'GET') {
    const tribeIdOrCode = path[1]
    const tribe = await db.collection('tribes').findOne({
      $or: [{ id: tribeIdOrCode }, { tribeCode: tribeIdOrCode.toUpperCase() }],
    })
    if (!tribe) return { error: 'Tribe not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const memberships = await db.collection('user_tribe_memberships')
      .find({ tribeId: tribe.id, status: 'ACTIVE' })
      .project({ userId: 1, _id: 0 })
      .toArray()
    const memberIds = memberships.map(m => m.userId)

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const [totalPosts, postsThisWeek, totalReels, totalSalutes, activeContests] = await Promise.all([
      db.collection('content_items').countDocuments({ authorId: { $in: memberIds }, kind: 'POST', visibility: { $ne: 'REMOVED' } }),
      db.collection('content_items').countDocuments({ authorId: { $in: memberIds }, kind: 'POST', createdAt: { $gte: sevenDaysAgo } }),
      db.collection('reels').countDocuments({ creatorId: { $in: memberIds }, status: { $ne: 'REMOVED' } }),
      db.collection('tribe_salute_ledger').countDocuments({ tribeId: tribe.id }),
      db.collection('tribe_contests').countDocuments({ status: 'ACTIVE' }),
    ])

    return {
      data: {
        tribe: sanitizeDoc(tribe),
        members: memberIds.length,
        totalPosts, postsThisWeek, totalReels,
        totalSalutes: tribe.totalSalutes || totalSalutes,
        activeContests,
        salutesPerMember: memberIds.length > 0 ? Math.round((tribe.totalSalutes || 0) / memberIds.length * 10) / 10 : 0,
      },
    }
  }

  // ========================
  // POST /tribes/:id/cheer — Cheer/Salute for your tribe (enhanced)
  // ========================
  if (path[0] === 'tribes' && path.length === 3 && path[2] === 'cheer' && method === 'POST') {
    const user = await requireAuth(request, db)
    const tribeIdOrCode = path[1]
    const tribe = await db.collection('tribes').findOne({
      $or: [{ id: tribeIdOrCode }, { tribeCode: tribeIdOrCode.toUpperCase() }],
    })
    if (!tribe) return { error: 'Tribe not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Check membership
    const membership = await db.collection('user_tribe_memberships').findOne({ userId: user.id, tribeId: tribe.id, status: 'ACTIVE' })
    if (!membership) return { error: 'Must be a tribe member to cheer', code: 'FORBIDDEN', status: 403 }

    // Rate limit: 1 cheer per day
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const cheeredToday = await db.collection('tribe_cheers').findOne({ userId: user.id, tribeId: tribe.id, createdAt: { $gte: today } })
    if (cheeredToday) return { error: 'Already cheered today. Come back tomorrow!', code: 'RATE_LIMITED', status: 429 }

    const now = new Date()
    await db.collection('tribe_cheers').insertOne({
      id: uuidv4(), userId: user.id, tribeId: tribe.id, createdAt: now,
    })
    await db.collection('tribes').updateOne({ id: tribe.id }, { $inc: { cheerCount: 1, totalSalutes: 1 } })

    // Record in salute ledger for tracking
    await db.collection('tribe_salute_ledger').insertOne({
      id: uuidv4(),
      tribeId: tribe.id,
      deltaSalutes: 1,
      reasonCode: 'MEMBER_CHEER',
      reasonText: `Daily cheer by ${user.displayName || 'member'}`,
      sourceType: 'CHEER',
      referenceId: user.id,
      createdBy: user.id,
      reversalOf: null,
      createdAt: now,
    })

    // Check if this tribe is in an active rivalry and add points
    const activeRivalry = await db.collection('tribe_rivalries').findOne({
      $or: [{ challengerTribeId: tribe.id }, { defenderTribeId: tribe.id }],
      status: 'ACTIVE',
    })
    if (activeRivalry) {
      const scoreField = activeRivalry.challengerTribeId === tribe.id ? 'challengerScore' : 'defenderScore'
      await db.collection('tribe_rivalries').updateOne(
        { id: activeRivalry.id },
        { $inc: { [scoreField]: 1 }, $set: { updatedAt: now } }
      )
    }

    const updated = await db.collection('tribes').findOne({ id: tribe.id }, { projection: { _id: 0, cheerCount: 1, totalSalutes: 1 } })

    return {
      data: {
        message: `Cheered for ${tribe.tribeName || tribe.tribeCode}!`,
        cheerCount: updated?.cheerCount || (tribe.cheerCount || 0) + 1,
        totalSalutes: updated?.totalSalutes || (tribe.totalSalutes || 0) + 1,
        heroName: tribe.heroName || null,
      },
    }
  }

  // ========================
  // POST /tribes/:id/salute — Salute button (content-based cheer for tribe pride)
  // ========================
  if (path[0] === 'tribes' && path.length === 3 && path[2] === 'salute' && method === 'POST') {
    const user = await requireAuth(request, db)
    const tribeIdOrCode = path[1]
    const tribe = await db.collection('tribes').findOne({
      $or: [{ id: tribeIdOrCode }, { tribeCode: tribeIdOrCode.toUpperCase() }],
    })
    if (!tribe) return { error: 'Tribe not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const body = {}
    try { Object.assign(body, await request.json()) } catch {}

    const { contentId, contentType } = body

    // Validate: user can salute any tribe's content (cross-tribe salutes allowed)
    // Rate limit: 10 salutes per hour per user
    const oneHourAgo = new Date(Date.now() - 3600000)
    const recentSalutes = await db.collection('tribe_content_salutes').countDocuments({
      userId: user.id, createdAt: { $gte: oneHourAgo },
    })
    if (recentSalutes >= 10) {
      return { error: 'Salute rate limit: max 10 per hour', code: 'RATE_LIMITED', status: 429 }
    }

    // Check duplicate for same content
    if (contentId) {
      const existing = await db.collection('tribe_content_salutes').findOne({
        userId: user.id, contentId, tribeId: tribe.id,
      })
      if (existing) return { error: 'Already saluted this content for this tribe', code: 'DUPLICATE', status: 409 }
    }

    const now = new Date()
    const salute = {
      id: uuidv4(),
      userId: user.id,
      tribeId: tribe.id,
      contentId: contentId || null,
      contentType: contentType || null,
      createdAt: now,
    }
    await db.collection('tribe_content_salutes').insertOne(salute)
    await db.collection('tribes').updateOne({ id: tribe.id }, { $inc: { totalSalutes: 1, cheerCount: 1 } })

    // Record in salute ledger
    await db.collection('tribe_salute_ledger').insertOne({
      id: uuidv4(),
      tribeId: tribe.id,
      deltaSalutes: 1,
      reasonCode: 'CONTENT_BONUS',
      reasonText: `Content salute${contentId ? ` on ${contentType || 'content'} ${contentId}` : ''}`,
      sourceType: 'CONTENT_SALUTE',
      referenceId: salute.id,
      createdBy: user.id,
      reversalOf: null,
      createdAt: now,
    })

    // Boost rivalry score if active
    const activeRivalry = await db.collection('tribe_rivalries').findOne({
      $or: [{ challengerTribeId: tribe.id }, { defenderTribeId: tribe.id }],
      status: 'ACTIVE',
    })
    if (activeRivalry) {
      const scoreField = activeRivalry.challengerTribeId === tribe.id ? 'challengerScore' : 'defenderScore'
      await db.collection('tribe_rivalries').updateOne(
        { id: activeRivalry.id },
        { $inc: { [scoreField]: 1 }, $set: { updatedAt: now } }
      )
    }

    const updated = await db.collection('tribes').findOne({ id: tribe.id }, { projection: { _id: 0, cheerCount: 1, totalSalutes: 1 } })

    return {
      data: {
        message: `Saluted ${tribe.tribeName || tribe.tribeCode}!`,
        saluteId: salute.id,
        cheerCount: updated?.cheerCount || 0,
        totalSalutes: updated?.totalSalutes || 0,
      },
      status: 201,
    }
  }

  // ========================
  // GET /tribe-rivalries — List active and recent rivalries (CACHED)
  // ========================
  if (path[0] === 'tribe-rivalries' && path.length === 1 && method === 'GET') {
    const url = new URL(request.url)
    const status = url.searchParams.get('status') || 'ACTIVE'
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
    const offset = parseInt(url.searchParams.get('offset') || '0')

    const rivalryCacheKey = `list:${status}:${limit}:${offset}`
    const cached = await cache.get(CacheNS.TRIBE_RIVALRIES, rivalryCacheKey)
    if (cached) return { data: cached }

    const filter = {}
    if (['ACTIVE', 'COMPLETED', 'CANCELLED'].includes(status.toUpperCase())) {
      filter.status = status.toUpperCase()
    }

    const [rivalries, total] = await Promise.all([
      db.collection('tribe_rivalries').find(filter, { projection: { _id: 0 } }).sort({ createdAt: -1 }).skip(offset).limit(limit).toArray(),
      db.collection('tribe_rivalries').countDocuments(filter),
    ])

    // Enrich with tribe info (batch lookup)
    const tribeIds = [...new Set(rivalries.flatMap(r => [r.challengerTribeId, r.defenderTribeId]))]
    const tribes = tribeIds.length > 0
      ? await db.collection('tribes').find({ id: { $in: tribeIds } }, { projection: { _id: 0, id: 1, tribeName: 1, tribeCode: 1, heroName: 1, primaryColor: 1, animalIcon: 1, totalSalutes: 1, cheerCount: 1 } }).toArray()
      : []
    const tribeMap = Object.fromEntries(tribes.map(t => [t.id, t]))

    const enriched = rivalries.map(r => ({
      ...sanitizeDoc(r),
      challengerTribe: tribeMap[r.challengerTribeId] || null,
      defenderTribe: tribeMap[r.defenderTribeId] || null,
    }))

    const result = { items: enriched, total, limit, offset }
    await cache.set(CacheNS.TRIBE_RIVALRIES, rivalryCacheKey, result, CacheTTL.TRIBE_RIVALRIES)
    return { data: result }
  }

  // ========================
  // GET /tribe-rivalries/:id — Rivalry detail with live scores
  // ========================
  if (path[0] === 'tribe-rivalries' && path.length === 2 && method === 'GET') {
    const rivalryId = path[1]
    const rivalry = await db.collection('tribe_rivalries').findOne({ id: rivalryId })
    if (!rivalry) return { error: 'Rivalry not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const [challengerTribe, defenderTribe] = await Promise.all([
      db.collection('tribes').findOne({ id: rivalry.challengerTribeId }),
      db.collection('tribes').findOne({ id: rivalry.defenderTribeId }),
    ])

    // Get recent contributions
    const recentContributions = await db.collection('tribe_rivalry_contributions')
      .find({ rivalryId })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray()

    return {
      data: {
        rivalry: sanitizeDoc(rivalry),
        challengerTribe: sanitizeDoc(challengerTribe),
        defenderTribe: sanitizeDoc(defenderTribe),
        recentContributions: sanitizeDocs(recentContributions),
      },
    }
  }

  // ========================
  // POST /tribe-rivalries/:id/contribute — Contribute content to a rivalry
  // ========================
  if (path[0] === 'tribe-rivalries' && path.length === 3 && path[2] === 'contribute' && method === 'POST') {
    const user = await requireAuth(request, db)
    const rivalryId = path[1]

    const rivalry = await db.collection('tribe_rivalries').findOne({ id: rivalryId })
    if (!rivalry) return { error: 'Rivalry not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (rivalry.status !== 'ACTIVE') return { error: 'Rivalry is not active', code: ErrorCode.INVALID_STATE, status: 400 }

    // Check rivalry window
    const now = new Date()
    if (rivalry.endsAt && now > new Date(rivalry.endsAt)) {
      return { error: 'Rivalry period has ended', code: ErrorCode.ENTRY_PERIOD_ENDED, status: 400 }
    }

    // User must belong to one of the rival tribes
    const membership = await db.collection('user_tribe_memberships').findOne({ userId: user.id, isPrimary: true, status: 'ACTIVE' })
    if (!membership) return { error: 'You must belong to a tribe', code: ErrorCode.NO_TRIBE, status: 400 }
    if (membership.tribeId !== rivalry.challengerTribeId && membership.tribeId !== rivalry.defenderTribeId) {
      return { error: 'Your tribe is not part of this rivalry', code: ErrorCode.TRIBE_NOT_ELIGIBLE, status: 403 }
    }

    const body = await request.json()
    const { contentId, contentType } = body

    if (!contentId || !['reel', 'post', 'story'].includes(contentType)) {
      return { error: 'contentId and contentType (reel/post/story) required', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Check duplicate
    const existing = await db.collection('tribe_rivalry_contributions').findOne({ rivalryId, contentId })
    if (existing) return { error: 'Content already contributed to this rivalry', code: 'DUPLICATE', status: 409 }

    // Validate content exists and belongs to user
    let contentMetrics = { likes: 0, views: 0, comments: 0, saves: 0, shares: 0 }
    if (contentType === 'reel') {
      const reel = await db.collection('reels').findOne({ id: contentId, creatorId: user.id })
      if (!reel) return { error: 'Reel not found or not owned by you', code: ErrorCode.NOT_FOUND, status: 404 }
      contentMetrics = { likes: reel.likeCount || 0, views: reel.viewCount || 0, comments: reel.commentCount || 0, saves: reel.saveCount || 0, shares: reel.shareCount || 0 }
    } else if (contentType === 'post') {
      const post = await db.collection('content_items').findOne({ id: contentId, authorId: user.id })
      if (!post) return { error: 'Post not found or not owned by you', code: ErrorCode.NOT_FOUND, status: 404 }
      contentMetrics = { likes: post.likeCount || 0, views: post.viewCount || 0, comments: post.commentCount || 0, saves: post.saveCount || 0, shares: post.shareCount || 0 }
    } else if (contentType === 'story') {
      const story = await db.collection('stories').findOne({ id: contentId, authorId: user.id })
      if (!story) return { error: 'Story not found or not owned by you', code: ErrorCode.NOT_FOUND, status: 404 }
      contentMetrics = { likes: story.reactionCount || 0, views: story.viewCount || 0, comments: story.replyCount || 0, saves: 0, shares: 0 }
    }

    const engagementPoints = contentMetrics.likes + (contentMetrics.views * 0.01) + contentMetrics.comments + contentMetrics.saves * 2 + contentMetrics.shares * 3
    const roundedPoints = Math.round(engagementPoints * 100) / 100

    const contribution = {
      id: uuidv4(),
      rivalryId,
      userId: user.id,
      tribeId: membership.tribeId,
      contentId,
      contentType,
      contentMetrics,
      engagementPoints: roundedPoints,
      createdAt: now,
    }
    await db.collection('tribe_rivalry_contributions').insertOne(contribution)

    // Update rivalry scores
    const scoreField = membership.tribeId === rivalry.challengerTribeId ? 'challengerScore' : 'defenderScore'
    await db.collection('tribe_rivalries').updateOne(
      { id: rivalryId },
      { $inc: { [scoreField]: roundedPoints, [`${scoreField.replace('Score', 'Contributions')}`]: 1 }, $set: { updatedAt: now } }
    )

    return {
      data: {
        contribution: sanitizeDoc(contribution),
        message: `Contributed ${roundedPoints} engagement points to your tribe!`,
      },
      status: 201,
    }
  }

  // TRIBE CORE — Welcome, Contributors, Board, Comparison  
  // ════════════════════════════════════════════════════════════════════

  // GET /tribes/me/welcome
  if (path[0] === 'tribes' && path[1] === 'me' && path[2] === 'welcome' && path.length === 3 && method === 'GET') {
    const user = await requireAuth(request, db)
    const tc = TRIBES.find(t => t.tribeCode === user.tribeCode) || TRIBES[0]
    return { data: { user: { id: user.id, displayName: user.displayName, tribeCode: user.tribeCode || '' }, tribe: { code: tc.tribeCode, name: tc.tribeName, heroName: tc.heroName, pvcName: tc.paramVirChakraName || tc.heroName, pvcHistory: tc.heroName + ' was awarded the Param Vir Chakra, India\'s highest wartime gallantry award, for extraordinary bravery.', quote: tc.quote || '', animalIcon: tc.animalIcon || '', primaryColor: tc.primaryColor || '', secondaryColor: tc.secondaryColor || '' }, welcome: { headline: 'Welcome to ' + tc.tribeName + '!', message: 'You are part of ' + tc.tribeName + ', named after ' + tc.heroName + '. Earn salutes for your tribe!', cta: 'Start Contributing' } } }
  }

  // GET /tribes/me/summary
  if (path[0] === 'tribes' && path[1] === 'me' && path[2] === 'summary' && path.length === 3 && method === 'GET') {
    const user = await requireAuth(request, db)
    if (!user.tribeId) return { data: { tribe: null } }
    const tc = TRIBES.find(t => t.tribeCode === user.tribeCode) || {}
    const now = new Date(); const ms = new Date(now.getFullYear(), now.getMonth(), 1)
    const [my, board] = await Promise.all([
      db.collection('salutes').aggregate([{ $match: { toUserId: user.id } }, { $group: { _id: null, t: { $sum: '$points' } } }]).toArray(),
      db.collection('salutes').aggregate([{ $match: { createdAt: { $gte: ms } } }, { $lookup: { from: 'users', localField: 'toUserId', foreignField: 'id', as: 'u' } }, { $unwind: '$u' }, { $match: { 'u.tribeId': user.tribeId } }, { $group: { _id: '$toUserId', t: { $sum: '$points' }, n: { $first: '$u.displayName' }, a: { $first: '$u.profilePicUrl' } } }, { $sort: { t: -1 } }, { $limit: 7 }]).toArray()
    ])
    return { data: { tribe: { id: user.tribeId, code: user.tribeCode || '', name: user.tribeName || tc.tribeName || '', heroName: tc.heroName || '', primaryColor: tc.primaryColor || '', animalIcon: tc.animalIcon || '' }, myContribution: { salutes: my[0]?.t || 0 }, board: board.map((b, i) => ({ rank: i + 1, userId: b._id, displayName: b.n || '', avatarUrl: b.a || '', salutes: b.t })) } }
  }

  // GET /tribes/compare
  if (path[0] === 'tribes' && path[1] === 'compare' && path.length === 2 && method === 'GET') {
    const url = new URL(request.url); const tf = url.searchParams.get('timeframe') || 'all_time'
    let df = {}
    if (tf === 'month') df = { createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } }
    else if (tf === 'week') df = { createdAt: { $gte: new Date(Date.now() - 604800000) } }
    const res = await db.collection('salutes').aggregate([{ $match: df }, { $lookup: { from: 'users', localField: 'toUserId', foreignField: 'id', as: 'u' } }, { $unwind: '$u' }, { $match: { 'u.tribeId': { $ne: null } } }, { $group: { _id: '$u.tribeId', s: { $sum: '$points' }, c: { $addToSet: '$toUserId' } } }, { $addFields: { cc: { $size: '$c' } } }]).toArray()
    const tm = Object.fromEntries(res.map(r => [r._id, r]))
    const at = await db.collection('tribes').find({}, { projection: { _id: 0 } }).toArray()
    const comp = at.map(t => { const d = tm[t.id] || { s: 0, cc: 0 }; const tc = TRIBES.find(c => c.tribeCode === t.code) || {}; return { rank: 0, tribeId: t.id, code: t.code || '', name: t.name || '', heroName: tc.heroName || '', animalIcon: tc.animalIcon || '', primaryColor: tc.primaryColor || '', totalSalutes: d.s, contributorCount: d.cc } }).sort((a, b) => b.totalSalutes - a.totalSalutes)
    comp.forEach((t, i) => t.rank = i + 1)
    return { data: { tribes: comp, timeframe: tf, filters: { timeframes: ['all_time', 'month', 'week'] } } }
  }

  // GET /tribes/contributors/top
  if (path[0] === 'tribes' && path[1] === 'contributors' && path[2] === 'top' && path.length === 3 && method === 'GET') {
    const url = new URL(request.url); const lim = Math.min(parseInt(url.searchParams.get('limit') || '100'), 100); const tf = url.searchParams.get('timeframe') || 'all_time'; const tf2 = url.searchParams.get('tribe') || ''
    let df = {}; if (tf === 'month') df = { createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) } }; else if (tf === 'week') df = { createdAt: { $gte: new Date(Date.now() - 604800000) } }
    const res = await db.collection('salutes').aggregate([{ $match: df }, { $group: { _id: '$toUserId', s: { $sum: '$points' }, a: { $sum: 1 } } }, { $lookup: { from: 'users', localField: '_id', foreignField: 'id', as: 'u' } }, { $unwind: '$u' }, ...(tf2 ? [{ $match: { 'u.tribeCode': tf2 } }] : []), { $sort: { s: -1 } }, { $limit: lim }]).toArray()
    const con = res.map((r, i) => { const tc = TRIBES.find(t => t.tribeCode === r.u.tribeCode) || {}; return { rank: i + 1, userId: r._id, displayName: r.u.displayName || '', avatarUrl: r.u.profilePicUrl || '', tribeCode: r.u.tribeCode || '', tribeName: tc.tribeName || '', tribeColor: tc.primaryColor || '', salutes: r.s, actions: r.a } })
    return { data: { contributors: con, count: con.length, timeframe: tf, filters: { timeframes: ['all_time', 'month', 'week'], tribes: TRIBES.map(t => ({ code: t.tribeCode, name: t.tribeName })) } } }
  }

  // GET /tribes/:id/board/current
  if (path[0] === 'tribes' && path.length === 4 && path[2] === 'board' && path[3] === 'current' && method === 'GET') {
    const tribe = await db.collection('tribes').findOne({ $or: [{ id: path[1] }, { code: path[1] }, { slug: path[1] }] }); if (!tribe) return { error: 'Tribe not found', code: ErrorCode.NOT_FOUND, status: 404 }
    const now = new Date(); const ms = new Date(now.getFullYear(), now.getMonth(), 1); const ml = now.toLocaleString('en', { month: 'long' }) + ' ' + now.getFullYear()
    const tc = TRIBES.find(t => t.tribeCode === tribe.code) || {}
    const board = await db.collection('salutes').aggregate([{ $match: { createdAt: { $gte: ms } } }, { $lookup: { from: 'users', localField: 'toUserId', foreignField: 'id', as: 'u' } }, { $unwind: '$u' }, { $match: { 'u.tribeId': tribe.id } }, { $group: { _id: '$toUserId', t: { $sum: '$points' }, n: { $first: '$u.displayName' }, a: { $first: '$u.profilePicUrl' }, un: { $first: '$u.username' } } }, { $sort: { t: -1 } }, { $limit: 7 }]).toArray()
    return { data: { tribe: { id: tribe.id, code: tribe.code, name: tribe.name, heroName: tc.heroName || '', primaryColor: tc.primaryColor || '' }, month: ml, board: board.map((b, i) => ({ rank: i + 1, userId: b._id, displayName: b.n || '', username: b.un || '', avatarUrl: b.a || '', salutes: b.t })), boardSize: 7 } }
  }


  return null
}

// ========== ADMIN HANDLER ==========
export async function handleTribeAdmin(path, method, request, db) {
  await ensureTribesSeeded(db)

  // ========================
  // GET /admin/tribes/distribution — Distribution stats
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribes' && path[2] === 'distribution' && path.length === 3 && method === 'GET') {
    const user = await requireAuth(request, db)
    requireRole(user, 'ADMIN', 'SUPER_ADMIN')

    const tribes = await db.collection('tribes').find({ isActive: true }).sort({ sortOrder: 1 }).toArray()
    const totalMembers = await db.collection('user_tribe_memberships').countDocuments({ isPrimary: true, status: 'ACTIVE' })
    const totalUsers = await db.collection('users').countDocuments({})

    const distribution = tribes.map(t => ({
      tribeId: t.id,
      tribeCode: t.tribeCode,
      tribeName: t.tribeName,
      membersCount: t.membersCount || 0,
      percentage: totalMembers > 0 ? Math.round(((t.membersCount || 0) / totalMembers) * 1000) / 10 : 0,
    }))

    // Migration stats
    const migrated = await db.collection('user_tribe_memberships').countDocuments({ migrationSource: { $ne: null } })
    const unmigrated = totalUsers - totalMembers

    return {
      data: {
        totalUsers,
        totalMembers,
        unmigrated,
        migrated,
        distribution,
      },
    }
  }

  // ========================
  // POST /admin/tribes/reassign — Admin reassign user to different tribe
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribes' && path[2] === 'reassign' && path.length === 3 && method === 'POST') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const body = await request.json()
    const { userId, tribeCode, reason } = body
    if (!userId || !tribeCode || !reason) {
      return { error: 'userId, tribeCode, and reason are required', code: ErrorCode.VALIDATION, status: 400 }
    }

    const targetUser = await db.collection('users').findOne({ id: userId })
    if (!targetUser) return { error: 'User not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const newTribe = await db.collection('tribes').findOne({ tribeCode: tribeCode.toUpperCase() })
    if (!newTribe) return { error: 'Tribe not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const existingMembership = await db.collection('user_tribe_memberships').findOne({ userId, isPrimary: true })
    const now = new Date()

    if (existingMembership) {
      // Deactivate old membership
      await db.collection('user_tribe_memberships').updateOne(
        { id: existingMembership.id },
        { $set: { isPrimary: false, status: 'REASSIGNED', updatedAt: now } }
      )
      // Decrement old tribe
      await db.collection('tribes').updateOne({ id: existingMembership.tribeId }, { $inc: { membersCount: -1 } })
    }

    // Create new membership
    const newMembership = {
      id: uuidv4(),
      userId,
      tribeId: newTribe.id,
      tribeCode: newTribe.tribeCode,
      assignmentMethod: 'ADMIN_REASSIGN',
      assignmentVersion: 'V3',
      assignedAt: now,
      assignedBy: admin.id,
      status: 'ACTIVE',
      isPrimary: true,
      migrationSource: null,
      legacyHouseId: existingMembership?.legacyHouseId || null,
      reassignmentCount: (existingMembership?.reassignmentCount || 0) + 1,
      auditRef: uuidv4(),
      createdAt: now,
      updatedAt: now,
    }

    await db.collection('user_tribe_memberships').insertOne(newMembership)
    await db.collection('tribes').updateOne({ id: newTribe.id }, { $inc: { membersCount: 1 } })

    // Audit
    await db.collection('tribe_assignment_events').insertOne({
      id: uuidv4(),
      userId,
      tribeId: newTribe.id,
      tribeCode: newTribe.tribeCode,
      action: 'REASSIGNED',
      method: 'ADMIN_REASSIGN',
      previousTribeId: existingMembership?.tribeId || null,
      assignedBy: admin.id,
      reason,
      createdAt: now,
    })

    await writeAudit(db, 'TRIBE_REASSIGNED', admin.id, 'USER', userId, {
      oldTribe: existingMembership?.tribeCode, newTribe: newTribe.tribeCode, reason,
    })

    return { data: { membership: sanitizeDoc(newMembership), tribe: sanitizeDoc(newTribe) } }
  }

  // ========================
  // POST /admin/tribe-seasons — Create or manage season
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribe-seasons' && path.length === 2 && method === 'POST') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const body = await request.json()
    const { name, year, startDate, endDate, prizeAmount, awardTitle, action } = body

    // Action: create, activate, complete
    if (action === 'activate') {
      const season = await db.collection('tribe_seasons').findOne({ id: body.seasonId })
      if (!season) return { error: 'Season not found', code: ErrorCode.NOT_FOUND, status: 404 }

      // Deactivate any current active season
      await db.collection('tribe_seasons').updateMany({ status: 'ACTIVE' }, { $set: { status: 'COMPLETED', updatedAt: new Date() } })
      await db.collection('tribe_seasons').updateOne({ id: season.id }, { $set: { status: 'ACTIVE', updatedAt: new Date() } })

      // Initialize standings for all tribes
      const tribes = await db.collection('tribes').find({ isActive: true }).toArray()
      for (const tribe of tribes) {
        await db.collection('tribe_standings').updateOne(
          { seasonId: season.id, tribeId: tribe.id },
          { $setOnInsert: { id: uuidv4(), seasonId: season.id, tribeId: tribe.id, tribeCode: tribe.tribeCode, totalSalutes: 0, contestsWon: 0, contestsEntered: 0, rank: 0, createdAt: new Date(), updatedAt: new Date() } },
          { upsert: true }
        )
      }

      return { data: { season: sanitizeDoc(await db.collection('tribe_seasons').findOne({ id: season.id })), message: 'Season activated' } }
    }

    if (action === 'complete') {
      const season = await db.collection('tribe_seasons').findOne({ id: body.seasonId })
      if (!season) return { error: 'Season not found', code: ErrorCode.NOT_FOUND, status: 404 }
      await db.collection('tribe_seasons').updateOne({ id: season.id }, { $set: { status: 'COMPLETED', updatedAt: new Date() } })
      return { data: { message: 'Season completed' } }
    }

    // Create new season
    if (!name || !year) return { error: 'name and year required', code: ErrorCode.VALIDATION, status: 400 }

    const season = {
      id: uuidv4(),
      name: name.trim(),
      year: parseInt(year),
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      prizeAmount: prizeAmount || DEFAULT_PRIZE_FUND,
      prizeCurrency: 'INR',
      awardTitle: awardTitle || DEFAULT_AWARD_TITLE,
      status: 'DRAFT',
      createdBy: admin.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    await db.collection('tribe_seasons').insertOne(season)
    await writeAudit(db, 'TRIBE_SEASON_CREATED', admin.id, 'TRIBE_SEASON', season.id, { name, year })

    return { data: { season: sanitizeDoc(season) }, status: 201 }
  }

  // ========================
  // GET /admin/tribe-seasons — List seasons
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribe-seasons' && path.length === 2 && method === 'GET') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const seasons = await db.collection('tribe_seasons').find({}).sort({ year: -1, createdAt: -1 }).toArray()
    return { data: { items: sanitizeDocs(seasons), seasons: sanitizeDocs(seasons), count: seasons.length } }
  }

  // ========================
  // POST /admin/tribe-contests — Create contest
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribe-contests' && path.length === 2 && method === 'POST') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const body = await request.json()
    const { seasonId, name, description, salutesForWin, salutesForRunnerUp, startDate, endDate } = body

    if (!seasonId || !name) return { error: 'seasonId and name required', code: ErrorCode.VALIDATION, status: 400 }

    const season = await db.collection('tribe_seasons').findOne({ id: seasonId })
    if (!season) return { error: 'Season not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const contest = {
      id: uuidv4(),
      seasonId,
      name: name.trim(),
      description: (description || '').trim() || null,
      status: 'DRAFT',
      salutesForWin: salutesForWin || 100,
      salutesForRunnerUp: salutesForRunnerUp || 50,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      winnerId: null,
      runnerUpId: null,
      resolvedAt: null,
      resolvedBy: null,
      createdBy: admin.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    await db.collection('tribe_contests').insertOne(contest)
    await writeAudit(db, 'TRIBE_CONTEST_CREATED', admin.id, 'TRIBE_CONTEST', contest.id, { seasonId, name })

    return { data: { contest: sanitizeDoc(contest) }, status: 201 }
  }

  // ========================
  // POST /admin/tribe-contests/:id/resolve — Resolve contest (declare winner)
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribe-contests' && path.length === 4 && path[3] === 'resolve' && method === 'POST') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const contestId = path[2]
    const body = await request.json()
    const { winnerTribeId, runnerUpTribeId } = body

    if (!winnerTribeId) return { error: 'winnerTribeId required', code: ErrorCode.VALIDATION, status: 400 }

    const contest = await db.collection('tribe_contests').findOne({ id: contestId })
    if (!contest) return { error: 'Contest not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (contest.status === 'RESOLVED') return { error: 'Contest already resolved', code: ErrorCode.CONFLICT, status: 409 }

    const now = new Date()

    // Award salutes to winner
    const winnerEntry = {
      id: uuidv4(),
      seasonId: contest.seasonId,
      contestId: contest.id,
      tribeId: winnerTribeId,
      deltaSalutes: contest.salutesForWin,
      reasonCode: 'CONTEST_WIN',
      reasonText: `Won contest: ${contest.name}`,
      sourceType: 'CONTEST',
      createdBy: admin.id,
      reversalOf: null,
      auditRef: uuidv4(),
      createdAt: now,
    }
    await db.collection('tribe_salute_ledger').insertOne(winnerEntry)
    await db.collection('tribes').updateOne({ id: winnerTribeId }, { $inc: { totalSalutes: contest.salutesForWin } })

    // Update standings
    await db.collection('tribe_standings').updateOne(
      { seasonId: contest.seasonId, tribeId: winnerTribeId },
      { $inc: { totalSalutes: contest.salutesForWin, contestsWon: 1 }, $set: { updatedAt: now } },
      { upsert: true }
    )

    // Award runner-up if provided
    if (runnerUpTribeId) {
      const ruEntry = {
        id: uuidv4(),
        seasonId: contest.seasonId,
        contestId: contest.id,
        tribeId: runnerUpTribeId,
        deltaSalutes: contest.salutesForRunnerUp,
        reasonCode: 'CONTEST_RUNNER_UP',
        reasonText: `Runner-up in contest: ${contest.name}`,
        sourceType: 'CONTEST',
        createdBy: admin.id,
        reversalOf: null,
        auditRef: uuidv4(),
        createdAt: now,
      }
      await db.collection('tribe_salute_ledger').insertOne(ruEntry)
      await db.collection('tribes').updateOne({ id: runnerUpTribeId }, { $inc: { totalSalutes: contest.salutesForRunnerUp } })

      await db.collection('tribe_standings').updateOne(
        { seasonId: contest.seasonId, tribeId: runnerUpTribeId },
        { $inc: { totalSalutes: contest.salutesForRunnerUp }, $set: { updatedAt: now } },
        { upsert: true }
      )
    }

    // Mark contest resolved
    await db.collection('tribe_contests').updateOne({ id: contestId }, {
      $set: { status: 'RESOLVED', winnerId: winnerTribeId, runnerUpId: runnerUpTribeId || null, resolvedAt: now, resolvedBy: admin.id, updatedAt: now },
    })

    await writeAudit(db, 'TRIBE_CONTEST_RESOLVED', admin.id, 'TRIBE_CONTEST', contestId, { winnerTribeId, runnerUpTribeId })

    return { data: { message: 'Contest resolved', contestId, winnerTribeId, runnerUpTribeId } }
  }

  // ========================
  // POST /admin/tribe-salutes/adjust — Manual salute adjustment
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribe-salutes' && path[2] === 'adjust' && path.length === 3 && method === 'POST') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const body = await request.json()
    const { tribeId, deltaSalutes, reasonCode, reasonText, reversalOf } = body

    if (!tribeId || deltaSalutes === undefined || !reasonCode) {
      return { error: 'tribeId, deltaSalutes, and reasonCode required', code: ErrorCode.VALIDATION, status: 400 }
    }

    const tribe = await db.collection('tribes').findOne({ id: tribeId })
    if (!tribe) return { error: 'Tribe not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Find active season
    const season = await db.collection('tribe_seasons').findOne({ status: 'ACTIVE' })
    const now = new Date()

    const entry = {
      id: uuidv4(),
      seasonId: season?.id || null,
      contestId: null,
      tribeId,
      deltaSalutes: parseInt(deltaSalutes),
      reasonCode,
      reasonText: reasonText || null,
      sourceType: 'ADMIN',
      createdBy: admin.id,
      reversalOf: reversalOf || null,
      auditRef: uuidv4(),
      createdAt: now,
    }

    await db.collection('tribe_salute_ledger').insertOne(entry)
    await db.collection('tribes').updateOne({ id: tribeId }, { $inc: { totalSalutes: parseInt(deltaSalutes) } })

    // Update standings if season active
    if (season) {
      await db.collection('tribe_standings').updateOne(
        { seasonId: season.id, tribeId },
        { $inc: { totalSalutes: parseInt(deltaSalutes) }, $set: { updatedAt: now } },
        { upsert: true }
      )
    }

    await writeAudit(db, 'TRIBE_SALUTE_ADJUSTED', admin.id, 'TRIBE', tribeId, { deltaSalutes, reasonCode })

    return { data: { entry: sanitizeDoc(entry) }, status: 201 }
  }

  // ========================
  // POST /admin/tribe-awards/resolve — Resolve annual award
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribe-awards' && path[2] === 'resolve' && path.length === 3 && method === 'POST') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const body = await request.json()
    const { seasonId } = body

    if (!seasonId) return { error: 'seasonId required', code: ErrorCode.VALIDATION, status: 400 }

    const season = await db.collection('tribe_seasons').findOne({ id: seasonId })
    if (!season) return { error: 'Season not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Get top tribe by standings
    const standings = await db.collection('tribe_standings')
      .find({ seasonId })
      .sort({ totalSalutes: -1 })
      .toArray()

    if (standings.length === 0) return { error: 'No standings for this season', code: ErrorCode.VALIDATION, status: 400 }

    const winner = standings[0]
    const runnerUp = standings[1] || null
    const winnerTribe = await db.collection('tribes').findOne({ id: winner.tribeId })

    // Check for existing award
    const existingAward = await db.collection('tribe_awards').findOne({ seasonId })
    if (existingAward) return { error: 'Award already resolved for this season', code: ErrorCode.CONFLICT, status: 409 }

    const now = new Date()
    const award = {
      id: uuidv4(),
      seasonId,
      seasonName: season.name,
      year: season.year,
      awardTitle: season.awardTitle || DEFAULT_AWARD_TITLE,
      winnerTribeId: winner.tribeId,
      winnerTribeCode: winner.tribeCode,
      winnerSalutes: winner.totalSalutes,
      runnerUpTribeId: runnerUp?.tribeId || null,
      runnerUpTribeCode: runnerUp?.tribeCode || null,
      runnerUpSalutes: runnerUp?.totalSalutes || 0,
      prizeAmount: season.prizeAmount || DEFAULT_PRIZE_FUND,
      prizeCurrency: season.prizeCurrency || 'INR',
      resolvedBy: admin.id,
      resolvedAt: now,
      createdAt: now,
    }

    await db.collection('tribe_awards').insertOne(award)

    // Credit prize to winner's fund account
    const fundAccountUpdate = await db.collection('tribe_fund_accounts').updateOne(
      { tribeId: winner.tribeId },
      {
        $setOnInsert: { id: uuidv4(), tribeId: winner.tribeId, tribeCode: winner.tribeCode, currency: 'INR', createdAt: now },
        $inc: { balance: award.prizeAmount },
        $set: { updatedAt: now },
      },
      { upsert: true }
    )

    // Record fund transaction
    await db.collection('tribe_fund_ledger').insertOne({
      id: uuidv4(),
      tribeId: winner.tribeId,
      seasonId,
      awardId: award.id,
      amount: award.prizeAmount,
      currency: 'INR',
      type: 'PRIZE_CREDIT',
      description: `${award.awardTitle} ${season.year} — Prize Fund`,
      createdBy: admin.id,
      createdAt: now,
    })

    // Complete season
    await db.collection('tribe_seasons').updateOne({ id: seasonId }, { $set: { status: 'COMPLETED', updatedAt: now } })

    await writeAudit(db, 'TRIBE_AWARD_RESOLVED', admin.id, 'TRIBE_AWARD', award.id, {
      winnerTribeCode: winner.tribeCode, prizeAmount: award.prizeAmount,
    })

    return {
      data: {
        award: sanitizeDoc(award),
        winnerTribe: sanitizeDoc(winnerTribe),
        message: `${award.awardTitle} awarded to ${winnerTribe?.tribeName}`,
      },
    }
  }

  // ========================
  // POST /admin/tribes/migrate — Migrate users from house to tribe
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribes' && path[2] === 'migrate' && path.length === 3 && method === 'POST') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const body = await request.json()
    const batchSize = body.batchSize || 100

    // Find users without tribe membership
    const usersWithoutTribe = await db.collection('users')
      .find({ id: { $nin: await db.collection('user_tribe_memberships').distinct('userId', { isPrimary: true }) } })
      .limit(batchSize)
      .toArray()

    let migrated = 0
    let skipped = 0
    const results = []

    for (const user of usersWithoutTribe) {
      try {
        const legacyHouseId = user.houseId || null
        const { membership, isNew } = await assignAndRecordMembership(
          db, user.id, 'MIGRATION_FROM_HOUSE_V1', admin.id, 'HOUSE_SYSTEM', legacyHouseId
        )
        if (isNew) {
          migrated++
          results.push({ userId: user.id, tribeCode: membership.tribeCode, status: 'MIGRATED' })
        } else {
          skipped++
          results.push({ userId: user.id, tribeCode: membership.tribeCode, status: 'ALREADY_ASSIGNED' })
        }
      } catch (e) {
        results.push({ userId: user.id, status: 'ERROR', error: e.message })
      }
    }

    await writeAudit(db, 'TRIBE_MIGRATION_BATCH', admin.id, 'SYSTEM', 'migration', { migrated, skipped, batchSize })

    const totalUsers = await db.collection('users').countDocuments({})
    const totalMemberships = await db.collection('user_tribe_memberships').countDocuments({ isPrimary: true })

    return {
      data: {
        migrated,
        skipped,
        totalUsersProcessed: usersWithoutTribe.length,
        totalUsers,
        totalMemberships,
        remainingUnmigrated: totalUsers - totalMemberships,
        results: results.slice(0, 20), // limit response size
      },
    }
  }

  // ========================
  // POST /admin/tribes/boards — Create or update tribe board
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribes' && path[2] === 'boards' && path.length === 3 && method === 'POST') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const body = await request.json()
    const { tribeId, members } = body
    if (!tribeId || !members || !Array.isArray(members)) {
      return { error: 'tribeId and members[] required', code: ErrorCode.VALIDATION, status: 400 }
    }

    const tribe = await db.collection('tribes').findOne({ id: tribeId })
    if (!tribe) return { error: 'Tribe not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Deactivate existing board
    await db.collection('tribe_boards').updateMany({ tribeId, status: 'ACTIVE' }, { $set: { status: 'DISSOLVED', updatedAt: new Date() } })

    const now = new Date()
    const board = {
      id: uuidv4(),
      tribeId,
      tribeCode: tribe.tribeCode,
      status: 'ACTIVE',
      maxSize: 7,
      createdBy: admin.id,
      createdAt: now,
      updatedAt: now,
    }
    await db.collection('tribe_boards').insertOne(board)

    // Add members
    const boardMembers = []
    for (const m of members.slice(0, 7)) {
      if (!m.userId || !m.role || !BOARD_ROLES.includes(m.role)) continue
      const bm = {
        id: uuidv4(),
        boardId: board.id,
        tribeId,
        userId: m.userId,
        role: m.role,
        status: 'ACTIVE',
        appointedBy: admin.id,
        createdAt: now,
      }
      await db.collection('tribe_board_members').insertOne(bm)
      boardMembers.push(sanitizeDoc(bm))
    }

    await writeAudit(db, 'TRIBE_BOARD_CREATED', admin.id, 'TRIBE_BOARD', board.id, { tribeCode: tribe.tribeCode, memberCount: boardMembers.length })

    return { data: { board: sanitizeDoc(board), members: boardMembers }, status: 201 }
  }

  // ========================
  // POST /admin/tribe-rivalries — Create a tribe rivalry/challenge
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribe-rivalries' && path.length === 2 && method === 'POST') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const body = await request.json()
    const { challengerTribeId, defenderTribeId, title, description, startsAt, endsAt, contentTypes, salutePrize } = body

    if (!challengerTribeId || !defenderTribeId || !title) {
      return { error: 'challengerTribeId, defenderTribeId, and title required', code: ErrorCode.VALIDATION, status: 400 }
    }
    if (challengerTribeId === defenderTribeId) {
      return { error: 'A tribe cannot rival itself', code: ErrorCode.VALIDATION, status: 400 }
    }

    const [challenger, defender] = await Promise.all([
      db.collection('tribes').findOne({ id: challengerTribeId }),
      db.collection('tribes').findOne({ id: defenderTribeId }),
    ])
    if (!challenger) return { error: 'Challenger tribe not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (!defender) return { error: 'Defender tribe not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Check no active rivalry between these two
    const existingActive = await db.collection('tribe_rivalries').findOne({
      $or: [
        { challengerTribeId, defenderTribeId, status: 'ACTIVE' },
        { challengerTribeId: defenderTribeId, defenderTribeId: challengerTribeId, status: 'ACTIVE' },
      ],
    })
    if (existingActive) return { error: 'Active rivalry already exists between these tribes', code: ErrorCode.CONFLICT, status: 409 }

    const now = new Date()
    const rivalry = {
      id: uuidv4(),
      title,
      description: description || null,
      challengerTribeId,
      challengerTribeCode: challenger.tribeCode,
      challengerTribeName: challenger.tribeName,
      defenderTribeId,
      defenderTribeCode: defender.tribeCode,
      defenderTribeName: defender.tribeName,
      challengerScore: 0,
      defenderScore: 0,
      challengerContributions: 0,
      defenderContributions: 0,
      contentTypes: contentTypes || ['reel', 'post', 'story'],
      salutePrize: salutePrize || 100,
      status: 'ACTIVE',
      startsAt: startsAt ? new Date(startsAt) : now,
      endsAt: endsAt ? new Date(endsAt) : new Date(now.getTime() + 7 * 24 * 3600 * 1000), // Default 7 days
      createdBy: admin.id,
      winnerId: null,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    }
    await db.collection('tribe_rivalries').insertOne(rivalry)

    await writeAudit(db, 'TRIBE_RIVALRY_CREATED', admin.id, 'TRIBE_RIVALRY', rivalry.id, {
      challenger: challenger.tribeCode, defender: defender.tribeCode,
    })

    return {
      data: {
        rivalry: sanitizeDoc(rivalry),
        message: `Rivalry "${title}" created: ${challenger.tribeName} vs ${defender.tribeName}`,
      },
      status: 201,
    }
  }

  // ========================
  // POST /admin/tribe-rivalries/:id/resolve — Resolve a rivalry (pick winner)
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribe-rivalries' && path.length === 3 && path[2] === 'resolve' && method === 'POST') {
    // Handle /admin/tribe-rivalries/resolve — but we need ID from URL
    // Actually, this matches /admin/tribe-rivalries/:id where path[2] is the ID
    return { error: 'Use /admin/tribe-rivalries/:id/resolve', code: ErrorCode.VALIDATION, status: 400 }
  }

  if (path[0] === 'admin' && path[1] === 'tribe-rivalries' && path.length === 4 && path[3] === 'resolve' && method === 'POST') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const rivalryId = path[2]
    const rivalry = await db.collection('tribe_rivalries').findOne({ id: rivalryId })
    if (!rivalry) return { error: 'Rivalry not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (rivalry.status !== 'ACTIVE') return { error: 'Rivalry is not active', code: ErrorCode.INVALID_STATE, status: 400 }

    const now = new Date()
    let winnerId = null
    let isDraw = false

    if (rivalry.challengerScore > rivalry.defenderScore) {
      winnerId = rivalry.challengerTribeId
    } else if (rivalry.defenderScore > rivalry.challengerScore) {
      winnerId = rivalry.defenderTribeId
    } else {
      isDraw = true
    }

    // Award salutes to winner
    if (winnerId && rivalry.salutePrize > 0) {
      await db.collection('tribes').updateOne({ id: winnerId }, { $inc: { totalSalutes: rivalry.salutePrize } })
      await db.collection('tribe_salute_ledger').insertOne({
        id: uuidv4(),
        tribeId: winnerId,
        deltaSalutes: rivalry.salutePrize,
        reasonCode: 'RIVALRY_VICTORY',
        reasonText: `Won rivalry: ${rivalry.title}`,
        sourceType: 'RIVALRY',
        referenceId: rivalry.id,
        createdBy: admin.id,
        reversalOf: null,
        createdAt: now,
      })
    }

    await db.collection('tribe_rivalries').updateOne(
      { id: rivalryId },
      { $set: { status: 'COMPLETED', winnerId, isDraw, resolvedAt: now, resolvedBy: admin.id, updatedAt: now } }
    )

    await writeAudit(db, 'TRIBE_RIVALRY_RESOLVED', admin.id, 'TRIBE_RIVALRY', rivalryId, {
      winnerId, isDraw, challengerScore: rivalry.challengerScore, defenderScore: rivalry.defenderScore,
    })

    return {
      data: {
        message: isDraw ? 'Rivalry ended in a draw!' : `Rivalry resolved! Winner awarded ${rivalry.salutePrize} salutes`,
        winnerId,
        isDraw,
        challengerScore: rivalry.challengerScore,
        defenderScore: rivalry.defenderScore,
      },
    }
  }

  // ========================
  // POST /admin/tribe-rivalries/:id/cancel — Cancel a rivalry
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribe-rivalries' && path.length === 4 && path[3] === 'cancel' && method === 'POST') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const rivalryId = path[2]
    const rivalry = await db.collection('tribe_rivalries').findOne({ id: rivalryId })
    if (!rivalry) return { error: 'Rivalry not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (rivalry.status !== 'ACTIVE') return { error: 'Rivalry is not active', code: ErrorCode.INVALID_STATE, status: 400 }

    const now = new Date()
    await db.collection('tribe_rivalries').updateOne(
      { id: rivalryId },
      { $set: { status: 'CANCELLED', cancelledAt: now, cancelledBy: admin.id, updatedAt: now } }
    )

    await writeAudit(db, 'TRIBE_RIVALRY_CANCELLED', admin.id, 'TRIBE_RIVALRY', rivalryId, {})

    return { data: { message: 'Rivalry cancelled', rivalryId } }
  }


  // ════════════════════════════════════════════════════════════════════
  return null
}
