/**
 * Tribe — Stage 12: World's Best Tribe System Handler
 *
 * Phase 12A-12K: Canonical 21-Tribe system with governance, contests,
 * salute ledger, standings, fund accounting, and safe migration bridge.
 *
 * ~17 API endpoints, 14 collections, 30+ indexes
 */

import { v4 as uuidv4 } from 'uuid'
import { requireAuth, authenticate, requireRole, writeAudit, sanitizeUser, parsePagination } from '../auth-utils.js'
import { ErrorCode } from '../constants.js'
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
    const tribes = await db.collection('tribes').find({ isActive: true }).sort({ sortOrder: 1 }).toArray()
    return { data: { items: sanitizeDocs(tribes), tribes: sanitizeDocs(tribes), count: tribes.length } }
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

    const result = await computeLeaderboard(db, { period })
    return { data: result }
  }

  // ========================
  // GET /tribes/standings/current — Current season standings
  // ========================
  if (path[0] === 'tribes' && path[1] === 'standings' && path[2] === 'current' && path.length === 3 && method === 'GET') {
    // Find active season
    const season = await db.collection('tribe_seasons').findOne({ status: 'ACTIVE' })
    if (!season) {
      // Fallback: derive from all-time salute ledger
      const tribes = await db.collection('tribes').find({ isActive: true }).sort({ totalSalutes: -1 }).toArray()
      return {
        data: {
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
        },
      }
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

    return { data: { season: sanitizeDoc(season), standings: enriched } }
  }

  // ========================
  // GET /tribes/:id — Tribe detail
  // ========================
  if (path[0] === 'tribes' && path.length === 2 && method === 'GET' && !['standings', 'leaderboard'].includes(path[1])) {
    const tribeIdOrCode = path[1]
    const tribe = await db.collection('tribes').findOne({
      $or: [{ id: tribeIdOrCode }, { tribeCode: tribeIdOrCode.toUpperCase() }],
    })
    if (!tribe) return { error: 'Tribe not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const topMembers = await db.collection('user_tribe_memberships')
      .find({ tribeId: tribe.id, isPrimary: true, status: 'ACTIVE' })
      .sort({ createdAt: 1 })
      .limit(10)
      .toArray()

    const userIds = topMembers.map(m => m.userId)
    const users = userIds.length > 0
      ? await db.collection('users').find({ id: { $in: userIds } }).toArray()
      : []
    const userMap = Object.fromEntries(users.map(u => [u.id, sanitizeUser(u)]))

    // Board info
    const board = await db.collection('tribe_boards').findOne({ tribeId: tribe.id, status: 'ACTIVE' })
    let boardMembers = []
    if (board) {
      boardMembers = await db.collection('tribe_board_members')
        .find({ boardId: board.id, status: 'ACTIVE' })
        .toArray()
      const bmUserIds = boardMembers.map(bm => bm.userId)
      const bmUsers = bmUserIds.length > 0
        ? await db.collection('users').find({ id: { $in: bmUserIds } }).toArray()
        : []
      const bmUserMap = Object.fromEntries(bmUsers.map(u => [u.id, sanitizeUser(u)]))
      boardMembers = sanitizeDocs(boardMembers).map(bm => ({ ...bm, user: bmUserMap[bm.userId] || null }))
    }

    // Recent salute activity
    const recentSalutes = await db.collection('tribe_salute_ledger')
      .find({ tribeId: tribe.id })
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray()

    return {
      data: {
        tribe: sanitizeDoc(tribe),
        topMembers: topMembers.map(m => ({ ...sanitizeDoc(m), user: userMap[m.userId] || null })),
        board: board ? { ...sanitizeDoc(board), members: boardMembers } : null,
        recentSalutes: sanitizeDocs(recentSalutes),
      },
    }
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

    return { data: { tribe: sanitizeDoc(tribe), items, pagination: { total }, total } }
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

    return { data: { items: sanitizeDocs(entries), pagination: { total }, total } }
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

  return null
}
