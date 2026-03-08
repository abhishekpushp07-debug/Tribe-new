/**
 * Stage 12X — World-Best Tribe Contest Engine
 *
 * Canonical contest module for Tribe social media platform.
 * Supports: reel_creative, tribe_battle, participation, judge, hybrid, seasonal
 *
 * Golden Rule: Like ≠ Vote ≠ Score ≠ Salute ≠ Fund
 *
 * Collections: tribe_contests (upgraded), tribe_contest_rules, tribe_contest_entries,
 *   tribe_contest_scores, tribe_contest_results, contest_votes, contest_judge_scores
 *
 * Lifecycle: DRAFT → PUBLISHED → ENTRY_OPEN → ENTRY_CLOSED → EVALUATING → LOCKED → RESOLVED
 */

import { v4 as uuidv4 } from 'uuid'
import { requireAuth, requireRole, writeAudit, sanitizeUser, authenticate } from '../auth-utils.js'

// ========== CONSTANTS ==========
const CONTEST_TYPES = ['reel_creative', 'tribe_battle', 'participation', 'judge', 'hybrid', 'seasonal']
const CONTEST_FORMATS = ['individual', 'tribe_vs_tribe', 'open_tribe', 'league_round']
const CONTEST_STATUSES = ['DRAFT', 'PUBLISHED', 'ENTRY_OPEN', 'ENTRY_CLOSED', 'EVALUATING', 'LOCKED', 'RESOLVED', 'CANCELLED']
const ENTRY_TYPES = ['reel', 'post', 'manual', 'tribe_team', 'live_event']
const ENTRY_STATUSES = ['submitted', 'validated', 'rejected', 'withdrawn', 'disqualified', 'locked']
const ENTRY_MODES = ['self_submit', 'tribe_nomination', 'auto_pick', 'admin_only']
const AUDIENCE_SCOPES = ['all_users', 'verified_users', 'specific_tribes', 'campus_scoped']
const VOTE_TYPES = ['upvote', 'support']
const RESOLUTION_MODES = ['manual', 'automatic', 'hybrid']

// Valid status transitions
const STATUS_TRANSITIONS = {
  DRAFT: ['PUBLISHED', 'CANCELLED'],
  PUBLISHED: ['ENTRY_OPEN', 'CANCELLED'],
  ENTRY_OPEN: ['ENTRY_CLOSED', 'CANCELLED'],
  ENTRY_CLOSED: ['EVALUATING', 'CANCELLED'],
  EVALUATING: ['LOCKED', 'CANCELLED'],
  LOCKED: ['RESOLVED'],
  RESOLVED: [],
  CANCELLED: [],
}

// Default salute distribution
const DEFAULT_SALUTE_DISTRIBUTION = {
  rank_1: 1000,
  rank_2: 600,
  rank_3: 300,
  finalist: 100,
  participation_bonus: 25,
}

// Scoring model definitions
const SCORING_MODELS = {
  scoring_reel_hybrid_v1: {
    name: 'Reel Hybrid v1',
    weights: { judge: 0.35, completion: 0.20, saves: 0.15, shares: 0.10, valid_likes: 0.10, comment_quality: 0.10 },
  },
  scoring_participation_v1: {
    name: 'Participation v1',
    weights: { valid_entries: 0.50, verified_participants: 0.20, completion_rate: 0.15, moderation_clean: 0.15 },
  },
  scoring_judge_only_v1: {
    name: 'Judge Only v1',
    weights: { creativity: 0.25, originality: 0.25, execution: 0.25, impact: 0.25 },
  },
  scoring_tribe_battle_v1: {
    name: 'Tribe Battle v1',
    weights: { top_entries_sum: 0.60, participation_bonus: 0.20, fraud_penalty: -0.10, moderation_penalty: -0.10 },
  },
}

// ========== HELPERS ==========
function isAdmin(user) {
  return ['ADMIN', 'SUPER_ADMIN'].includes(user.role)
}

function isContestAdmin(user) {
  return ['ADMIN', 'SUPER_ADMIN', 'CONTEST_ADMIN'].includes(user.role)
}

function isJudge(user) {
  return ['JUDGE', 'ADMIN', 'SUPER_ADMIN', 'CONTEST_ADMIN'].includes(user.role)
}

function sanitizeDoc(d) {
  if (!d) return null
  const { _id, ...clean } = d
  return clean
}

function sanitizeDocs(arr) {
  return (arr || []).map(sanitizeDoc).filter(Boolean)
}

function parseQuery(request) {
  const url = new URL(request.url)
  return {
    page: Math.max(1, parseInt(url.searchParams.get('page') || '1')),
    limit: Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20'))),
    status: url.searchParams.get('status') || null,
    contestType: url.searchParams.get('contest_type') || null,
    seasonId: url.searchParams.get('season_id') || null,
    tribeId: url.searchParams.get('tribe_id') || null,
    sort: url.searchParams.get('sort') || 'newest',
  }
}

function canTransition(currentStatus, targetStatus) {
  return (STATUS_TRANSITIONS[currentStatus] || []).includes(targetStatus)
}

// ========== PUBLIC CONTEST HANDLER ==========
export async function handleTribeContests(path, method, request, db) {

  // ========================
  // GET /tribe-contests — List contests (public)
  // ========================
  if (path[0] === 'tribe-contests' && path.length === 1 && method === 'GET') {
    const q = parseQuery(request)
    const filter = {}

    // Public users only see non-draft contests
    const user = await authenticate(request, db)
    if (!user || !isContestAdmin(user)) {
      filter.status = { $nin: ['DRAFT', 'CANCELLED'] }
    }

    if (q.status && CONTEST_STATUSES.includes(q.status.toUpperCase())) {
      filter.status = q.status.toUpperCase()
    }
    if (q.contestType && CONTEST_TYPES.includes(q.contestType)) {
      filter.contestType = q.contestType
    }
    if (q.seasonId) filter.seasonId = q.seasonId

    const skip = (q.page - 1) * q.limit
    const sortField = q.sort === 'ending_soon' ? { contestEndAt: 1 } : { createdAt: -1 }

    const [items, total] = await Promise.all([
      db.collection('tribe_contests').find(filter).sort(sortField).skip(skip).limit(q.limit).toArray(),
      db.collection('tribe_contests').countDocuments(filter),
    ])

    // Enrich with season names
    const seasonIds = [...new Set(items.map(i => i.seasonId).filter(Boolean))]
    const seasons = seasonIds.length > 0
      ? await db.collection('tribe_seasons').find({ id: { $in: seasonIds } }).toArray()
      : []
    const seasonMap = Object.fromEntries(seasons.map(s => [s.id, { name: s.name, year: s.year }]))

    const enriched = items.map(c => ({
      ...sanitizeDoc(c),
      seasonName: seasonMap[c.seasonId]?.name || null,
      seasonYear: seasonMap[c.seasonId]?.year || null,
    }))

    return { data: { items: enriched, page: q.page, limit: q.limit, total } }
  }

  // ========================
  // GET /tribe-contests/:id — Contest detail
  // ========================
  if (path[0] === 'tribe-contests' && path.length === 2 && method === 'GET'
    && !['leaderboard', 'results', 'entries', 'seasons'].includes(path[1])) {
    const contestId = path[1]
    const contest = await db.collection('tribe_contests').findOne({ id: contestId })
    if (!contest) return { error: 'Contest not found', code: 'NOT_FOUND', status: 404 }

    // Get season
    const season = contest.seasonId
      ? await db.collection('tribe_seasons').findOne({ id: contest.seasonId })
      : null

    // Get active rules
    const rules = await db.collection('tribe_contest_rules')
      .find({ contestId, isActive: true })
      .sort({ version: -1 })
      .toArray()

    // Get entry count
    const entryCount = await db.collection('tribe_contest_entries')
      .countDocuments({ contestId, submissionStatus: { $nin: ['withdrawn', 'disqualified'] } })

    // Get tribe participation counts
    const tribeParticipation = await db.collection('tribe_contest_entries').aggregate([
      { $match: { contestId, submissionStatus: { $nin: ['withdrawn', 'disqualified'] } } },
      { $group: { _id: '$tribeId', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]).toArray()

    // Get tribe names
    const tribeIds = tribeParticipation.map(tp => tp._id)
    const tribes = tribeIds.length > 0
      ? await db.collection('tribes').find({ id: { $in: tribeIds } }).toArray()
      : []
    const tribeMap = Object.fromEntries(tribes.map(t => [t.id, { tribeName: t.tribeName, tribeCode: t.tribeCode, primaryColor: t.primaryColor, animalIcon: t.animalIcon }]))

    const tribeStrip = tribeParticipation.map(tp => ({
      tribeId: tp._id,
      entries: tp.count,
      ...tribeMap[tp._id],
    }))

    // Get user's own entry if authenticated
    const user = await authenticate(request, db)
    let myEntry = null
    if (user) {
      myEntry = await db.collection('tribe_contest_entries').findOne({ contestId, userId: user.id })
      if (myEntry) myEntry = sanitizeDoc(myEntry)
    }

    // Get result if resolved
    let result = null
    if (contest.status === 'RESOLVED') {
      result = await db.collection('tribe_contest_results').findOne({ contestId })
      if (result) result = sanitizeDoc(result)
    }

    return {
      data: {
        contest: sanitizeDoc(contest),
        season: season ? sanitizeDoc(season) : null,
        rules: sanitizeDocs(rules),
        entryCount,
        tribeStrip,
        myEntry,
        result,
        scoringModel: SCORING_MODELS[contest.scoringModelId] || null,
        saluteDistribution: contest.saluteDistribution || DEFAULT_SALUTE_DISTRIBUTION,
      },
    }
  }

  // ========================
  // POST /tribe-contests/:id/enter — Submit contest entry
  // ========================
  if (path[0] === 'tribe-contests' && path.length === 3 && path[2] === 'enter' && method === 'POST') {
    const user = await requireAuth(request, db)
    const contestId = path[1]

    const contest = await db.collection('tribe_contests').findOne({ id: contestId })
    if (!contest) return { error: 'Contest not found', code: 'NOT_FOUND', status: 404 }
    if (contest.status !== 'ENTRY_OPEN') {
      return { error: 'Contest is not accepting entries', code: 'CONTEST_NOT_OPEN', status: 400 }
    }

    // Check entry window
    const now = new Date()
    if (contest.entryEndAt && now > new Date(contest.entryEndAt)) {
      return { error: 'Entry period has ended', code: 'ENTRY_PERIOD_ENDED', status: 400 }
    }

    // Check user has a tribe
    const membership = await db.collection('user_tribe_memberships').findOne({ userId: user.id, isPrimary: true, status: 'ACTIVE' })
    if (!membership) return { error: 'You must belong to a tribe to enter', code: 'NO_TRIBE', status: 400 }

    // Check tribe eligibility
    if (contest.eligibilityRules?.allowedTribeIds?.length > 0) {
      if (!contest.eligibilityRules.allowedTribeIds.includes(membership.tribeId)) {
        return { error: 'Your tribe is not eligible for this contest', code: 'TRIBE_NOT_ELIGIBLE', status: 403 }
      }
    }

    // Check max entries per user
    const userEntryCount = await db.collection('tribe_contest_entries')
      .countDocuments({ contestId, userId: user.id, submissionStatus: { $nin: ['withdrawn', 'disqualified'] } })
    if (userEntryCount >= (contest.maxEntriesPerUser || 1)) {
      return { error: 'Maximum entries reached for this contest', code: 'MAX_ENTRIES_REACHED', status: 400 }
    }

    // Check max entries per tribe
    if (contest.maxEntriesPerTribe) {
      const tribeEntryCount = await db.collection('tribe_contest_entries')
        .countDocuments({ contestId, tribeId: membership.tribeId, submissionStatus: { $nin: ['withdrawn', 'disqualified'] } })
      if (tribeEntryCount >= contest.maxEntriesPerTribe) {
        return { error: 'Your tribe has reached max entries for this contest', code: 'TRIBE_MAX_ENTRIES', status: 400 }
      }
    }

    const body = await request.json()
    const { entryType, contentId, submissionPayload } = body

    if (!entryType || !ENTRY_TYPES.includes(entryType)) {
      return { error: 'Valid entryType required', code: 'VALIDATION_ERROR', status: 400 }
    }

    // Check content_id uniqueness in this contest (anti-duplicate)
    if (contentId) {
      const existingContent = await db.collection('tribe_contest_entries')
        .findOne({ contestId, contentId, submissionStatus: { $nin: ['withdrawn', 'disqualified'] } })
      if (existingContent) {
        return { error: 'This content has already been submitted to this contest', code: 'DUPLICATE_CONTENT', status: 409 }
      }
    }

    const entry = {
      id: uuidv4(),
      contestId,
      seasonId: contest.seasonId,
      entryType,
      userId: user.id,
      tribeId: membership.tribeId,
      tribeCode: membership.tribeCode,
      contentId: contentId || null,
      submissionPayload: submissionPayload || {},
      submissionStatus: 'submitted',
      validationReason: null,
      submittedAt: now,
      validatedAt: null,
      isDisqualified: false,
      disqualificationReason: null,
      auditRef: uuidv4(),
      createdAt: now,
      updatedAt: now,
    }

    await db.collection('tribe_contest_entries').insertOne(entry)

    await writeAudit(db, 'CONTEST_ENTRY_SUBMITTED', user.id, 'TRIBE_CONTEST_ENTRY', entry.id, {
      contestId, tribeId: membership.tribeId, entryType,
    })

    return { data: { entry: sanitizeDoc(entry) }, status: 201 }
  }

  // ========================
  // GET /tribe-contests/:id/entries — List contest entries
  // ========================
  if (path[0] === 'tribe-contests' && path.length === 3 && path[2] === 'entries' && method === 'GET') {
    const contestId = path[1]
    const contest = await db.collection('tribe_contests').findOne({ id: contestId })
    if (!contest) return { error: 'Contest not found', code: 'NOT_FOUND', status: 404 }

    const q = parseQuery(request)
    const filter = { contestId, submissionStatus: { $nin: ['withdrawn'] } }
    if (q.tribeId) filter.tribeId = q.tribeId
    if (q.status) filter.submissionStatus = q.status

    const skip = (q.page - 1) * q.limit
    const [items, total] = await Promise.all([
      db.collection('tribe_contest_entries').find(filter).sort({ submittedAt: -1 }).skip(skip).limit(q.limit).toArray(),
      db.collection('tribe_contest_entries').countDocuments(filter),
    ])

    // Enrich with user info and tribe info
    const userIds = [...new Set(items.map(e => e.userId))]
    const users = userIds.length > 0
      ? await db.collection('users').find({ id: { $in: userIds } }).toArray()
      : []
    const userMap = Object.fromEntries(users.map(u => [u.id, sanitizeUser(u)]))

    const tribeIds = [...new Set(items.map(e => e.tribeId))]
    const tribes = tribeIds.length > 0
      ? await db.collection('tribes').find({ id: { $in: tribeIds } }).toArray()
      : []
    const tribeMap = Object.fromEntries(tribes.map(t => [t.id, { tribeName: t.tribeName, tribeCode: t.tribeCode, primaryColor: t.primaryColor, animalIcon: t.animalIcon }]))

    const enriched = items.map(e => ({
      ...sanitizeDoc(e),
      user: userMap[e.userId] || null,
      tribe: tribeMap[e.tribeId] || null,
    }))

    return { data: { items: enriched, page: q.page, limit: q.limit, total } }
  }

  // ========================
  // GET /tribe-contests/:id/leaderboard — Contest leaderboard
  // ========================
  if (path[0] === 'tribe-contests' && path.length === 3 && path[2] === 'leaderboard' && method === 'GET') {
    const contestId = path[1]
    const contest = await db.collection('tribe_contests').findOne({ id: contestId })
    if (!contest) return { error: 'Contest not found', code: 'NOT_FOUND', status: 404 }

    const q = parseQuery(request)
    const filter = { contestId }
    if (q.tribeId) filter.tribeId = q.tribeId

    const skip = (q.page - 1) * q.limit
    const scores = await db.collection('tribe_contest_scores')
      .find(filter)
      .sort({ finalScore: -1, lastComputedAt: 1 })
      .skip(skip)
      .limit(q.limit)
      .toArray()

    const total = await db.collection('tribe_contest_scores').countDocuments(filter)

    // Enrich
    const entryIds = scores.map(s => s.entryId)
    const entries = entryIds.length > 0
      ? await db.collection('tribe_contest_entries').find({ id: { $in: entryIds } }).toArray()
      : []
    const entryMap = Object.fromEntries(entries.map(e => [e.id, sanitizeDoc(e)]))

    const tribeIds = [...new Set(scores.map(s => s.tribeId))]
    const tribes = tribeIds.length > 0
      ? await db.collection('tribes').find({ id: { $in: tribeIds } }).toArray()
      : []
    const tribeMap = Object.fromEntries(tribes.map(t => [t.id, { tribeName: t.tribeName, tribeCode: t.tribeCode, primaryColor: t.primaryColor, animalIcon: t.animalIcon }]))

    const userIds = [...new Set(scores.map(s => s.userId))]
    const users = userIds.length > 0
      ? await db.collection('users').find({ id: { $in: userIds } }).toArray()
      : []
    const userMap = Object.fromEntries(users.map(u => [u.id, sanitizeUser(u)]))

    const leaderboard = scores.map((s, i) => ({
      rank: skip + i + 1,
      ...sanitizeDoc(s),
      entry: entryMap[s.entryId] || null,
      tribe: tribeMap[s.tribeId] || null,
      user: userMap[s.userId] || null,
    }))

    return { data: { contestId, leaderboard, page: q.page, limit: q.limit, total, updatedAt: new Date().toISOString() } }
  }

  // ========================
  // GET /tribe-contests/:id/results — Official contest results
  // ========================
  if (path[0] === 'tribe-contests' && path.length === 3 && path[2] === 'results' && method === 'GET') {
    const contestId = path[1]
    const contest = await db.collection('tribe_contests').findOne({ id: contestId })
    if (!contest) return { error: 'Contest not found', code: 'NOT_FOUND', status: 404 }

    if (contest.status !== 'RESOLVED') {
      return { error: 'Contest results not yet available', code: 'NOT_RESOLVED', status: 400 }
    }

    const result = await db.collection('tribe_contest_results').findOne({ contestId })
    if (!result) return { error: 'Results not found', code: 'NOT_FOUND', status: 404 }

    // Enrich top positions with tribe/user info
    const tribeIds = [...new Set((result.topPositions || []).map(p => p.tribeId).filter(Boolean))]
    const tribes = tribeIds.length > 0
      ? await db.collection('tribes').find({ id: { $in: tribeIds } }).toArray()
      : []
    const tribeMap = Object.fromEntries(tribes.map(t => [t.id, { tribeName: t.tribeName, tribeCode: t.tribeCode, primaryColor: t.primaryColor, animalIcon: t.animalIcon }]))

    const enrichedPositions = (result.topPositions || []).map(p => ({
      ...p,
      tribe: tribeMap[p.tribeId] || null,
    }))

    // Get salute entries for this contest
    const saluteEntries = await db.collection('tribe_salute_ledger')
      .find({ contestId })
      .sort({ deltaSalutes: -1 })
      .toArray()

    return {
      data: {
        contest: sanitizeDoc(contest),
        result: { ...sanitizeDoc(result), topPositions: enrichedPositions },
        saluteDistribution: sanitizeDocs(saluteEntries),
      },
    }
  }

  // ========================
  // POST /tribe-contests/:id/vote — Vote on an entry
  // ========================
  if (path[0] === 'tribe-contests' && path.length === 3 && path[2] === 'vote' && method === 'POST') {
    const user = await requireAuth(request, db)
    const contestId = path[1]

    const contest = await db.collection('tribe_contests').findOne({ id: contestId })
    if (!contest) return { error: 'Contest not found', code: 'NOT_FOUND', status: 404 }

    // Voting allowed only in certain statuses
    if (!['ENTRY_OPEN', 'ENTRY_CLOSED', 'EVALUATING'].includes(contest.status)) {
      return { error: 'Voting is not open for this contest', code: 'VOTING_CLOSED', status: 400 }
    }

    // Check if voting is enabled for this contest
    if (contest.votingEnabled === false) {
      return { error: 'Voting is not enabled for this contest', code: 'VOTING_DISABLED', status: 400 }
    }

    const body = await request.json()
    const { entryId, voteType } = body

    if (!entryId) return { error: 'entryId required', code: 'VALIDATION_ERROR', status: 400 }

    // Check entry exists and is valid
    const entry = await db.collection('tribe_contest_entries').findOne({
      id: entryId, contestId, submissionStatus: { $nin: ['withdrawn', 'disqualified', 'rejected'] },
    })
    if (!entry) return { error: 'Entry not found or not eligible', code: 'ENTRY_NOT_FOUND', status: 404 }

    // Anti-cheat: self-vote block (configurable)
    if (contest.selfVoteBlocked !== false && entry.userId === user.id) {
      return { error: 'Cannot vote for your own entry', code: 'SELF_VOTE_BLOCKED', status: 403 }
    }

    // Anti-cheat: one vote per user per entry per contest
    const existingVote = await db.collection('contest_votes').findOne({
      contestId, entryId, voterUserId: user.id,
    })
    if (existingVote) {
      return { error: 'You have already voted for this entry', code: 'DUPLICATE_VOTE', status: 409 }
    }

    // Check per-contest vote cap (default: 5 votes per contest per user)
    const userVoteCount = await db.collection('contest_votes').countDocuments({ contestId, voterUserId: user.id })
    const maxVotesPerContest = contest.maxVotesPerUser || 5
    if (userVoteCount >= maxVotesPerContest) {
      return { error: `Maximum ${maxVotesPerContest} votes per contest reached`, code: 'VOTE_CAP_REACHED', status: 400 }
    }

    // Get voter's tribe
    const voterMembership = await db.collection('user_tribe_memberships').findOne({ userId: user.id, isPrimary: true })

    const vote = {
      id: uuidv4(),
      contestId,
      entryId,
      voterUserId: user.id,
      tribeId: voterMembership?.tribeId || null,
      voteType: VOTE_TYPES.includes(voteType) ? voteType : 'support',
      weight: 1,
      sourceSurface: 'contest_page',
      createdAt: new Date(),
    }

    try {
      await db.collection('contest_votes').insertOne(vote)
    } catch (e) {
      if (e.code === 11000) {
        return { error: 'Duplicate vote', code: 'DUPLICATE_VOTE', status: 409 }
      }
      throw e
    }

    return { data: { vote: sanitizeDoc(vote) }, status: 201 }
  }

  // ========================
  // POST /tribe-contests/:id/withdraw — Withdraw own entry
  // ========================
  if (path[0] === 'tribe-contests' && path.length === 3 && path[2] === 'withdraw' && method === 'POST') {
    const user = await requireAuth(request, db)
    const contestId = path[1]

    const body = await request.json()
    const { entryId } = body
    if (!entryId) return { error: 'entryId required', code: 'VALIDATION_ERROR', status: 400 }

    const entry = await db.collection('tribe_contest_entries').findOne({ id: entryId, contestId, userId: user.id })
    if (!entry) return { error: 'Entry not found', code: 'NOT_FOUND', status: 404 }
    if (['withdrawn', 'disqualified', 'locked'].includes(entry.submissionStatus)) {
      return { error: 'Entry cannot be withdrawn in current status', code: 'INVALID_STATUS', status: 400 }
    }

    await db.collection('tribe_contest_entries').updateOne(
      { id: entryId },
      { $set: { submissionStatus: 'withdrawn', updatedAt: new Date() } }
    )

    return { data: { message: 'Entry withdrawn', entryId } }
  }

  // ========================
  // GET /tribe-contests/seasons — List seasons (public)
  // ========================
  if (path[0] === 'tribe-contests' && path[1] === 'seasons' && path.length === 2 && method === 'GET') {
    const seasons = await db.collection('tribe_seasons')
      .find({ status: { $ne: 'DRAFT' } })
      .sort({ year: -1, createdAt: -1 })
      .toArray()
    return { data: { seasons: sanitizeDocs(seasons) } }
  }

  // ========================
  // GET /tribe-contests/seasons/:id/standings — Season standings
  // ========================
  if (path[0] === 'tribe-contests' && path[1] === 'seasons' && path.length === 4 && path[3] === 'standings' && method === 'GET') {
    const seasonId = path[2]
    const season = await db.collection('tribe_seasons').findOne({ id: seasonId })
    if (!season) return { error: 'Season not found', code: 'NOT_FOUND', status: 404 }

    const standings = await db.collection('tribe_standings')
      .find({ seasonId })
      .sort({ totalSalutes: -1, contestsWon: -1 })
      .toArray()

    const tribeIds = standings.map(s => s.tribeId)
    const tribes = tribeIds.length > 0
      ? await db.collection('tribes').find({ id: { $in: tribeIds } }).toArray()
      : []
    const tribeMap = Object.fromEntries(tribes.map(t => [t.id, sanitizeDoc(t)]))

    const enriched = standings.map((s, i) => ({
      rank: i + 1,
      ...sanitizeDoc(s),
      tribe: tribeMap[s.tribeId] || null,
    }))

    return { data: { season: sanitizeDoc(season), standings: enriched } }
  }

  return null
}

// ========== ADMIN CONTEST HANDLER ==========
export async function handleTribeContestAdmin(path, method, request, db) {

  // ========================
  // POST /admin/tribe-contests — Create contest (UPGRADED)
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribe-contests' && path.length === 2 && method === 'POST') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const body = await request.json()
    const {
      seasonId, contestName, contestCode, contestType, contestFormat,
      description, rulesText, entryMode, audienceScope,
      eligibilityRules, maxEntriesPerUser, maxEntriesPerTribe,
      entryStartAt, entryEndAt, contestStartAt, contestEndAt,
      scoringModelId, tieBreakPolicy, visibility,
      saluteDistribution, votingEnabled, selfVoteBlocked, maxVotesPerUser,
    } = body

    if (!seasonId || !contestName) {
      return { error: 'seasonId and contestName required', code: 'VALIDATION_ERROR', status: 400 }
    }

    const season = await db.collection('tribe_seasons').findOne({ id: seasonId })
    if (!season) return { error: 'Season not found', code: 'NOT_FOUND', status: 404 }

    // Generate contest code if not provided
    const code = contestCode || `CONTEST_${Date.now()}_${uuidv4().slice(0, 8).toUpperCase()}`

    // Check unique code
    const existingCode = await db.collection('tribe_contests').findOne({ contestCode: code })
    if (existingCode) return { error: 'Contest code already exists', code: 'DUPLICATE_CODE', status: 409 }

    const now = new Date()
    const contest = {
      id: uuidv4(),
      seasonId,
      contestCode: code,
      contestName: contestName.trim(),
      contestType: CONTEST_TYPES.includes(contestType) ? contestType : 'reel_creative',
      contestFormat: CONTEST_FORMATS.includes(contestFormat) ? contestFormat : 'individual',
      status: 'DRAFT',
      description: (description || '').trim() || null,
      rulesText: (rulesText || '').trim() || null,
      entryMode: ENTRY_MODES.includes(entryMode) ? entryMode : 'self_submit',
      audienceScope: AUDIENCE_SCOPES.includes(audienceScope) ? audienceScope : 'all_users',
      eligibilityRules: eligibilityRules || { mustHaveTribe: true },
      maxEntriesPerUser: maxEntriesPerUser || 1,
      maxEntriesPerTribe: maxEntriesPerTribe || 50,
      entryStartAt: entryStartAt ? new Date(entryStartAt) : null,
      entryEndAt: entryEndAt ? new Date(entryEndAt) : null,
      contestStartAt: contestStartAt ? new Date(contestStartAt) : null,
      contestEndAt: contestEndAt ? new Date(contestEndAt) : null,
      scoringModelId: scoringModelId || 'scoring_reel_hybrid_v1',
      tieBreakPolicy: tieBreakPolicy || 'higher_judge_then_higher_completion_then_earlier_submit',
      visibility: ['public', 'tribe_only', 'admin_only'].includes(visibility) ? visibility : 'public',
      saluteDistribution: saluteDistribution || DEFAULT_SALUTE_DISTRIBUTION,
      votingEnabled: votingEnabled !== false,
      selfVoteBlocked: selfVoteBlocked !== false,
      maxVotesPerUser: maxVotesPerUser || 5,
      // Legacy compat fields
      salutesForWin: saluteDistribution?.rank_1 || DEFAULT_SALUTE_DISTRIBUTION.rank_1,
      salutesForRunnerUp: saluteDistribution?.rank_2 || DEFAULT_SALUTE_DISTRIBUTION.rank_2,
      winnerId: null,
      runnerUpId: null,
      resolvedAt: null,
      resolvedBy: null,
      createdBy: admin.id,
      createdAt: now,
      updatedAt: now,
    }

    await db.collection('tribe_contests').insertOne(contest)
    await writeAudit(db, 'TRIBE_CONTEST_CREATED', admin.id, 'TRIBE_CONTEST', contest.id, {
      seasonId, contestName, contestType: contest.contestType, contestCode: code,
    })

    return { data: { contest: sanitizeDoc(contest) }, status: 201 }
  }

  // ========================
  // GET /admin/tribe-contests — List all contests (admin)
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribe-contests' && path.length === 2 && method === 'GET') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const q = parseQuery(request)
    const filter = {}
    if (q.status) filter.status = q.status.toUpperCase()
    if (q.seasonId) filter.seasonId = q.seasonId

    const skip = (q.page - 1) * q.limit
    const [items, total] = await Promise.all([
      db.collection('tribe_contests').find(filter).sort({ createdAt: -1 }).skip(skip).limit(q.limit).toArray(),
      db.collection('tribe_contests').countDocuments(filter),
    ])

    return { data: { items: sanitizeDocs(items), page: q.page, limit: q.limit, total } }
  }

  // ========================
  // GET /admin/tribe-contests/:id — Admin contest detail
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribe-contests' && path.length === 3
    && !['publish', 'open-entries', 'close-entries', 'lock', 'resolve', 'disqualify', 'judge-score', 'compute-scores', 'cancel', 'dashboard', 'rules'].includes(path[2])
    && method === 'GET') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const contestId = path[2]
    const contest = await db.collection('tribe_contests').findOne({ id: contestId })
    if (!contest) return { error: 'Contest not found', code: 'NOT_FOUND', status: 404 }

    const [entryCount, voteCount, scoreCount, rules] = await Promise.all([
      db.collection('tribe_contest_entries').countDocuments({ contestId }),
      db.collection('contest_votes').countDocuments({ contestId }),
      db.collection('tribe_contest_scores').countDocuments({ contestId }),
      db.collection('tribe_contest_rules').find({ contestId }).sort({ version: -1 }).toArray(),
    ])

    const result = await db.collection('tribe_contest_results').findOne({ contestId })

    return {
      data: {
        contest: sanitizeDoc(contest),
        stats: { entryCount, voteCount, scoreCount },
        rules: sanitizeDocs(rules),
        result: result ? sanitizeDoc(result) : null,
      },
    }
  }

  // ========================
  // POST /admin/tribe-contests/:id/publish — DRAFT → PUBLISHED
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribe-contests' && path.length === 4 && path[3] === 'publish' && method === 'POST') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const contestId = path[2]
    const contest = await db.collection('tribe_contests').findOne({ id: contestId })
    if (!contest) return { error: 'Contest not found', code: 'NOT_FOUND', status: 404 }
    if (!canTransition(contest.status, 'PUBLISHED')) {
      return { error: `Cannot publish from status ${contest.status}`, code: 'INVALID_TRANSITION', status: 400 }
    }

    await db.collection('tribe_contests').updateOne(
      { id: contestId },
      { $set: { status: 'PUBLISHED', updatedAt: new Date() } }
    )

    await writeAudit(db, 'CONTEST_PUBLISHED', admin.id, 'TRIBE_CONTEST', contestId, {})
    return { data: { message: 'Contest published', contestId, status: 'PUBLISHED' } }
  }

  // ========================
  // POST /admin/tribe-contests/:id/open-entries — PUBLISHED → ENTRY_OPEN
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribe-contests' && path.length === 4 && path[3] === 'open-entries' && method === 'POST') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const contestId = path[2]
    const contest = await db.collection('tribe_contests').findOne({ id: contestId })
    if (!contest) return { error: 'Contest not found', code: 'NOT_FOUND', status: 404 }
    if (!canTransition(contest.status, 'ENTRY_OPEN')) {
      return { error: `Cannot open entries from status ${contest.status}`, code: 'INVALID_TRANSITION', status: 400 }
    }

    await db.collection('tribe_contests').updateOne(
      { id: contestId },
      { $set: { status: 'ENTRY_OPEN', entryStartAt: new Date(), updatedAt: new Date() } }
    )

    await writeAudit(db, 'CONTEST_ENTRIES_OPENED', admin.id, 'TRIBE_CONTEST', contestId, {})
    return { data: { message: 'Entries opened', contestId, status: 'ENTRY_OPEN' } }
  }

  // ========================
  // POST /admin/tribe-contests/:id/close-entries — ENTRY_OPEN → ENTRY_CLOSED
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribe-contests' && path.length === 4 && path[3] === 'close-entries' && method === 'POST') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const contestId = path[2]
    const contest = await db.collection('tribe_contests').findOne({ id: contestId })
    if (!contest) return { error: 'Contest not found', code: 'NOT_FOUND', status: 404 }
    if (!canTransition(contest.status, 'ENTRY_CLOSED')) {
      return { error: `Cannot close entries from status ${contest.status}`, code: 'INVALID_TRANSITION', status: 400 }
    }

    await db.collection('tribe_contests').updateOne(
      { id: contestId },
      { $set: { status: 'ENTRY_CLOSED', entryEndAt: new Date(), updatedAt: new Date() } }
    )

    // Lock all submitted entries
    await db.collection('tribe_contest_entries').updateMany(
      { contestId, submissionStatus: 'submitted' },
      { $set: { submissionStatus: 'validated', validatedAt: new Date(), updatedAt: new Date() } }
    )

    await writeAudit(db, 'CONTEST_ENTRIES_CLOSED', admin.id, 'TRIBE_CONTEST', contestId, {})
    return { data: { message: 'Entries closed, submitted entries validated', contestId, status: 'ENTRY_CLOSED' } }
  }

  // ========================
  // POST /admin/tribe-contests/:id/lock — EVALUATING → LOCKED
  // Also supports ENTRY_CLOSED → EVALUATING first
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribe-contests' && path.length === 4 && path[3] === 'lock' && method === 'POST') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const contestId = path[2]
    const contest = await db.collection('tribe_contests').findOne({ id: contestId })
    if (!contest) return { error: 'Contest not found', code: 'NOT_FOUND', status: 404 }

    // Allow auto-transition through EVALUATING if currently ENTRY_CLOSED
    let targetStatus = 'LOCKED'
    if (contest.status === 'ENTRY_CLOSED') {
      // Auto-transition: ENTRY_CLOSED → EVALUATING → LOCKED
      await db.collection('tribe_contests').updateOne(
        { id: contestId },
        { $set: { status: 'EVALUATING', updatedAt: new Date() } }
      )
      targetStatus = 'LOCKED'
    } else if (!canTransition(contest.status, 'LOCKED')) {
      return { error: `Cannot lock from status ${contest.status}`, code: 'INVALID_TRANSITION', status: 400 }
    }

    // Lock all validated entries
    await db.collection('tribe_contest_entries').updateMany(
      { contestId, submissionStatus: 'validated' },
      { $set: { submissionStatus: 'locked', updatedAt: new Date() } }
    )

    await db.collection('tribe_contests').updateOne(
      { id: contestId },
      { $set: { status: 'LOCKED', updatedAt: new Date() } }
    )

    await writeAudit(db, 'CONTEST_LOCKED', admin.id, 'TRIBE_CONTEST', contestId, {})
    return { data: { message: 'Contest locked', contestId, status: 'LOCKED' } }
  }

  // ========================
  // POST /admin/tribe-contests/:id/resolve — LOCKED → RESOLVED (UPGRADED, IDEMPOTENT)
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribe-contests' && path.length === 4 && path[3] === 'resolve' && method === 'POST') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const contestId = path[2]
    const body = await request.json()
    const { idempotencyKey, resolutionMode, notes, winnerTribeId, runnerUpTribeId } = body

    const contest = await db.collection('tribe_contests').findOne({ id: contestId })
    if (!contest) return { error: 'Contest not found', code: 'NOT_FOUND', status: 404 }

    // IDEMPOTENCY CHECK: If already resolved, return existing result
    if (contest.status === 'RESOLVED') {
      const existingResult = await db.collection('tribe_contest_results').findOne({ contestId })
      return {
        data: {
          message: 'Contest already resolved (idempotent response)',
          contestId,
          result: existingResult ? sanitizeDoc(existingResult) : null,
          idempotent: true,
        },
      }
    }

    if (contest.status !== 'LOCKED') {
      return { error: 'Contest must be locked before resolving', code: 'INVALID_TRANSITION', status: 400 }
    }

    // Check for existing result (double-safety)
    const existingResult = await db.collection('tribe_contest_results').findOne({ contestId })
    if (existingResult) {
      return {
        data: {
          message: 'Result already exists (idempotent response)',
          contestId,
          result: sanitizeDoc(existingResult),
          idempotent: true,
        },
      }
    }

    // If idempotency key provided, check for duplicate resolve attempt
    if (idempotencyKey) {
      const dupResult = await db.collection('tribe_contest_results').findOne({ contestId, idempotencyKey })
      if (dupResult) {
        return { data: { message: 'Idempotent resolve', contestId, result: sanitizeDoc(dupResult), idempotent: true } }
      }
    }

    const now = new Date()
    let topPositions = []
    let winnerType = 'entry'

    const mode = RESOLUTION_MODES.includes(resolutionMode) ? resolutionMode : 'automatic'

    if (mode === 'manual' && winnerTribeId) {
      // Manual resolution: admin specifies winner tribe
      winnerType = 'tribe'
      topPositions.push({ rank: 1, tribeId: winnerTribeId, finalScore: null })
      if (runnerUpTribeId) {
        topPositions.push({ rank: 2, tribeId: runnerUpTribeId, finalScore: null })
      }
    } else {
      // Automatic resolution: use scores
      const scores = await db.collection('tribe_contest_scores')
        .find({ contestId })
        .sort({ finalScore: -1, lastComputedAt: 1 })
        .limit(10)
        .toArray()

      if (scores.length === 0) {
        // Fallback: use entries + votes for tribe-level scoring
        const voteAgg = await db.collection('contest_votes').aggregate([
          { $match: { contestId } },
          { $lookup: { from: 'tribe_contest_entries', localField: 'entryId', foreignField: 'id', as: 'entry' } },
          { $unwind: { path: '$entry', preserveNullAndEmptyArrays: true } },
          { $group: { _id: '$entry.tribeId', totalVotes: { $sum: '$weight' } } },
          { $sort: { totalVotes: -1 } },
        ]).toArray()

        if (voteAgg.length > 0) {
          winnerType = 'tribe'
          topPositions = voteAgg.slice(0, 5).map((v, i) => ({
            rank: i + 1,
            tribeId: v._id,
            finalScore: v.totalVotes,
          }))
        } else if (winnerTribeId) {
          // Fallback to manual if no scores/votes but winnerTribeId provided
          winnerType = 'tribe'
          topPositions.push({ rank: 1, tribeId: winnerTribeId, finalScore: null })
          if (runnerUpTribeId) topPositions.push({ rank: 2, tribeId: runnerUpTribeId, finalScore: null })
        }
      } else {
        topPositions = scores.slice(0, 5).map((s, i) => ({
          rank: i + 1,
          entryId: s.entryId,
          tribeId: s.tribeId,
          userId: s.userId,
          finalScore: s.finalScore,
        }))
      }
    }

    // Create result record
    const resultId = uuidv4()
    const result = {
      id: resultId,
      contestId,
      seasonId: contest.seasonId,
      winnerType,
      winnerEntryId: topPositions[0]?.entryId || null,
      winnerTribeId: topPositions[0]?.tribeId || null,
      topPositions,
      tieBreakApplied: null,
      resolvedAt: now,
      resolvedBy: admin.id,
      resolutionMode: mode,
      idempotencyKey: idempotencyKey || `resolve_${contestId}_${now.getTime()}`,
      notes: notes || null,
      auditRef: uuidv4(),
    }

    try {
      await db.collection('tribe_contest_results').insertOne(result)
    } catch (e) {
      if (e.code === 11000) {
        const dup = await db.collection('tribe_contest_results').findOne({ contestId })
        return { data: { message: 'Result already exists (race condition safe)', result: sanitizeDoc(dup), idempotent: true } }
      }
      throw e
    }

    // SALUTE DISTRIBUTION — Idempotent via result reference
    const distribution = contest.saluteDistribution || DEFAULT_SALUTE_DISTRIBUTION
    const saluteEntries = []

    for (const pos of topPositions) {
      if (!pos.tribeId) continue
      let salutes = 0
      if (pos.rank === 1) salutes = distribution.rank_1 || 1000
      else if (pos.rank === 2) salutes = distribution.rank_2 || 600
      else if (pos.rank === 3) salutes = distribution.rank_3 || 300
      else salutes = distribution.finalist || 100

      if (salutes > 0) {
        const saluteEntry = {
          id: uuidv4(),
          seasonId: contest.seasonId,
          contestId,
          tribeId: pos.tribeId,
          deltaSalutes: salutes,
          reasonCode: pos.rank === 1 ? 'CONTEST_WIN' : pos.rank === 2 ? 'CONTEST_RUNNER_UP' : 'CONTEST_FINALIST',
          reasonText: `Rank #${pos.rank} in ${contest.contestName}`,
          sourceType: 'CONTEST_RESULT',
          referenceId: resultId,
          createdBy: admin.id,
          reversalOf: null,
          auditRef: result.auditRef,
          createdAt: now,
        }
        saluteEntries.push(saluteEntry)
      }
    }

    if (saluteEntries.length > 0) {
      await db.collection('tribe_salute_ledger').insertMany(saluteEntries)

      // Update tribe totalSalutes and standings
      for (const se of saluteEntries) {
        await db.collection('tribes').updateOne(
          { id: se.tribeId },
          { $inc: { totalSalutes: se.deltaSalutes } }
        )
        await db.collection('tribe_standings').updateOne(
          { seasonId: contest.seasonId, tribeId: se.tribeId },
          {
            $inc: {
              totalSalutes: se.deltaSalutes,
              ...(se.reasonCode === 'CONTEST_WIN' ? { contestsWon: 1 } : {}),
            },
            $set: { updatedAt: now },
            $setOnInsert: { id: uuidv4(), seasonId: contest.seasonId, tribeId: se.tribeId, tribeCode: se.tribeId, contestsEntered: 0, rank: 0, createdAt: now },
          },
          { upsert: true }
        )
      }
    }

    // Mark contest resolved
    await db.collection('tribe_contests').updateOne(
      { id: contestId },
      {
        $set: {
          status: 'RESOLVED',
          winnerId: topPositions[0]?.tribeId || null,
          runnerUpId: topPositions[1]?.tribeId || null,
          resolvedAt: now,
          resolvedBy: admin.id,
          updatedAt: now,
        },
      }
    )

    await writeAudit(db, 'TRIBE_CONTEST_RESOLVED', admin.id, 'TRIBE_CONTEST', contestId, {
      winnerTribeId: topPositions[0]?.tribeId, resolutionMode: mode, topPositionCount: topPositions.length,
    })

    return {
      data: {
        message: 'Contest resolved successfully',
        contestId,
        result: sanitizeDoc(result),
        saluteDistribution: sanitizeDocs(saluteEntries),
      },
    }
  }

  // ========================
  // POST /admin/tribe-contests/:id/disqualify — Disqualify an entry
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribe-contests' && path.length === 4 && path[3] === 'disqualify' && method === 'POST') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const contestId = path[2]
    const body = await request.json()
    const { entryId, reason } = body

    if (!entryId || !reason) return { error: 'entryId and reason required', code: 'VALIDATION_ERROR', status: 400 }

    const entry = await db.collection('tribe_contest_entries').findOne({ id: entryId, contestId })
    if (!entry) return { error: 'Entry not found', code: 'NOT_FOUND', status: 404 }

    if (entry.isDisqualified) {
      return { error: 'Entry already disqualified', code: 'ALREADY_DISQUALIFIED', status: 409 }
    }

    await db.collection('tribe_contest_entries').updateOne(
      { id: entryId },
      { $set: { submissionStatus: 'disqualified', isDisqualified: true, disqualificationReason: reason, updatedAt: new Date() } }
    )

    await writeAudit(db, 'CONTEST_ENTRY_DISQUALIFIED', admin.id, 'TRIBE_CONTEST_ENTRY', entryId, { contestId, reason })

    return { data: { message: 'Entry disqualified', entryId, contestId } }
  }

  // ========================
  // POST /admin/tribe-contests/:id/judge-score — Submit judge score
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribe-contests' && path.length === 4 && path[3] === 'judge-score' && method === 'POST') {
    const judge = await requireAuth(request, db)
    // Judges, contest admins, and super admins can submit
    if (!isJudge(judge)) {
      return { error: 'Unauthorized: judge role required', code: 'FORBIDDEN', status: 403 }
    }

    const contestId = path[2]
    const body = await request.json()
    const { entryId, rubricScores } = body

    if (!entryId || !rubricScores) {
      return { error: 'entryId and rubricScores required', code: 'VALIDATION_ERROR', status: 400 }
    }

    const contest = await db.collection('tribe_contests').findOne({ id: contestId })
    if (!contest) return { error: 'Contest not found', code: 'NOT_FOUND', status: 404 }

    const entry = await db.collection('tribe_contest_entries').findOne({ id: entryId, contestId })
    if (!entry) return { error: 'Entry not found', code: 'NOT_FOUND', status: 404 }

    // Compute total from rubric
    const rubricValues = Object.values(rubricScores).filter(v => typeof v === 'number')
    const totalScore = rubricValues.reduce((a, b) => a + b, 0)

    const now = new Date()

    // Upsert: allow judge to update their score
    const judgeScoreId = uuidv4()
    const judgeScore = {
      id: judgeScoreId,
      contestId,
      entryId,
      judgeId: judge.id,
      rubricScores,
      totalScore,
      submittedAt: now,
      version: 1,
    }

    try {
      // Try insert first (unique on contest+entry+judge)
      await db.collection('contest_judge_scores').insertOne(judgeScore)
    } catch (e) {
      if (e.code === 11000) {
        // Update existing
        await db.collection('contest_judge_scores').updateOne(
          { contestId, entryId, judgeId: judge.id },
          { $set: { rubricScores, totalScore, submittedAt: now, $inc: { version: 1 } } }
        )
        return { data: { message: 'Judge score updated', entryId, totalScore } }
      }
      throw e
    }

    return { data: { judgeScore: sanitizeDoc(judgeScore) }, status: 201 }
  }

  // ========================
  // POST /admin/tribe-contests/:id/compute-scores — Compute/recompute scores
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribe-contests' && path.length === 4 && path[3] === 'compute-scores' && method === 'POST') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const contestId = path[2]
    const contest = await db.collection('tribe_contests').findOne({ id: contestId })
    if (!contest) return { error: 'Contest not found', code: 'NOT_FOUND', status: 404 }

    const scoringModel = SCORING_MODELS[contest.scoringModelId] || SCORING_MODELS.scoring_reel_hybrid_v1

    // Get all valid entries
    const entries = await db.collection('tribe_contest_entries')
      .find({ contestId, submissionStatus: { $nin: ['withdrawn', 'disqualified', 'rejected'] } })
      .toArray()

    const now = new Date()
    let computed = 0

    for (const entry of entries) {
      // Get judge scores for this entry
      const judgeScores = await db.collection('contest_judge_scores')
        .find({ contestId, entryId: entry.id })
        .toArray()

      // Get vote count for this entry
      const voteCount = await db.collection('contest_votes')
        .countDocuments({ contestId, entryId: entry.id })

      // Compute judge aggregate
      let judgeAvg = 0
      if (judgeScores.length > 0) {
        judgeAvg = judgeScores.reduce((s, js) => s + js.totalScore, 0) / judgeScores.length
      }

      // Simple scoring: can be enhanced with real engagement data
      const engagementScore = voteCount * 2 // Simple: votes * 2
      const qualityScore = judgeAvg
      const participationScore = 10 // Base participation
      const penaltyScore = entry.isDisqualified ? 100 : 0

      // Weighted final score
      const weights = scoringModel.weights
      let finalScore = 0
      if (contest.scoringModelId === 'scoring_judge_only_v1') {
        finalScore = judgeAvg - penaltyScore
      } else if (contest.scoringModelId === 'scoring_participation_v1') {
        finalScore = participationScore + engagementScore - penaltyScore
      } else {
        // Default hybrid
        finalScore = (judgeAvg * (weights.judge || 0.35)) +
                     (engagementScore * (weights.valid_likes || 0.10)) +
                     (qualityScore * 0.1) +
                     (participationScore * 0.05) -
                     penaltyScore
      }

      finalScore = Math.round(finalScore * 100) / 100

      // Upsert score
      await db.collection('tribe_contest_scores').updateOne(
        { contestId, entryId: entry.id },
        {
          $set: {
            tribeId: entry.tribeId,
            userId: entry.userId,
            judgeScore: judgeAvg,
            engagementScore,
            qualityScore,
            participationScore,
            penaltyScore,
            finalScore,
            scoringVersion: contest.scoringModelId,
            breakdown: {
              judgeCount: judgeScores.length,
              voteCount,
              judgeAverage: judgeAvg,
            },
            lastComputedAt: now,
            updatedAt: now,
          },
          $setOnInsert: {
            id: uuidv4(),
            contestId,
            entryId: entry.id,
            createdAt: now,
          },
        },
        { upsert: true }
      )

      computed++
    }

    // Compute ranks
    const allScores = await db.collection('tribe_contest_scores')
      .find({ contestId })
      .sort({ finalScore: -1, lastComputedAt: 1 })
      .toArray()

    for (let i = 0; i < allScores.length; i++) {
      await db.collection('tribe_contest_scores').updateOne(
        { id: allScores[i].id },
        { $set: { rank: i + 1 } }
      )
    }

    return { data: { message: `Scores computed for ${computed} entries`, contestId, totalScored: computed } }
  }

  // ========================
  // POST /admin/tribe-contests/:id/cancel — Cancel contest
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribe-contests' && path.length === 4 && path[3] === 'cancel' && method === 'POST') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const contestId = path[2]
    const contest = await db.collection('tribe_contests').findOne({ id: contestId })
    if (!contest) return { error: 'Contest not found', code: 'NOT_FOUND', status: 404 }

    if (contest.status === 'RESOLVED') {
      return { error: 'Cannot cancel a resolved contest', code: 'INVALID_TRANSITION', status: 400 }
    }
    if (contest.status === 'CANCELLED') {
      return { data: { message: 'Contest already cancelled', contestId } }
    }

    await db.collection('tribe_contests').updateOne(
      { id: contestId },
      { $set: { status: 'CANCELLED', updatedAt: new Date() } }
    )

    await writeAudit(db, 'CONTEST_CANCELLED', admin.id, 'TRIBE_CONTEST', contestId, {})
    return { data: { message: 'Contest cancelled', contestId, status: 'CANCELLED' } }
  }

  // ========================
  // POST /admin/tribe-contests/rules — Add versioned rule to contest
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribe-contests' && path[2] === 'rules' && path.length === 3 && method === 'POST') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const body = await request.json()
    const { contestId, ruleType, rulePayload } = body

    if (!contestId || !ruleType || !rulePayload) {
      return { error: 'contestId, ruleType, and rulePayload required', code: 'VALIDATION_ERROR', status: 400 }
    }

    const contest = await db.collection('tribe_contests').findOne({ id: contestId })
    if (!contest) return { error: 'Contest not found', code: 'NOT_FOUND', status: 404 }

    // Get latest version
    const latest = await db.collection('tribe_contest_rules')
      .findOne({ contestId, ruleType }, { sort: { version: -1 } })

    const version = (latest?.version || 0) + 1

    // Deactivate previous versions of same rule type
    await db.collection('tribe_contest_rules').updateMany(
      { contestId, ruleType, isActive: true },
      { $set: { isActive: false, effectiveTo: new Date() } }
    )

    const rule = {
      id: uuidv4(),
      contestId,
      version,
      ruleType,
      rulePayload,
      isActive: true,
      effectiveFrom: new Date(),
      effectiveTo: null,
      createdBy: admin.id,
      createdAt: new Date(),
    }

    await db.collection('tribe_contest_rules').insertOne(rule)

    return { data: { rule: sanitizeDoc(rule) }, status: 201 }
  }

  // ========================
  // POST /admin/tribe-salutes/adjust — Manual salute adjustment (UPGRADED)
  // Already exists in tribes.js, but keeping for new routing
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribe-salutes' && path[2] === 'adjust' && path.length === 3 && method === 'POST') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const body = await request.json()
    const { tribeId, seasonId, deltaSalutes, reasonCode, reasonText, reversalOf } = body

    if (!tribeId || deltaSalutes === undefined || !reasonCode) {
      return { error: 'tribeId, deltaSalutes, and reasonCode required', code: 'VALIDATION_ERROR', status: 400 }
    }

    const tribe = await db.collection('tribes').findOne({ id: tribeId })
    if (!tribe) return { error: 'Tribe not found', code: 'NOT_FOUND', status: 404 }

    // Find season
    const season = seasonId
      ? await db.collection('tribe_seasons').findOne({ id: seasonId })
      : await db.collection('tribe_seasons').findOne({ status: 'ACTIVE' })

    const now = new Date()
    const entry = {
      id: uuidv4(),
      seasonId: season?.id || null,
      contestId: null,
      tribeId,
      deltaSalutes: parseInt(deltaSalutes),
      reasonCode,
      reasonText: reasonText || null,
      sourceType: 'ADMIN_ADJUSTMENT',
      referenceId: null,
      createdBy: admin.id,
      reversalOf: reversalOf || null,
      auditRef: uuidv4(),
      createdAt: now,
    }

    await db.collection('tribe_salute_ledger').insertOne(entry)
    await db.collection('tribes').updateOne({ id: tribeId }, { $inc: { totalSalutes: parseInt(deltaSalutes) } })

    if (season) {
      await db.collection('tribe_standings').updateOne(
        { seasonId: season.id, tribeId },
        {
          $inc: { totalSalutes: parseInt(deltaSalutes) },
          $set: { updatedAt: now },
          $setOnInsert: { id: uuidv4(), seasonId: season.id, tribeId, tribeCode: tribe.tribeCode, contestsWon: 0, contestsEntered: 0, rank: 0, createdAt: now },
        },
        { upsert: true }
      )
    }

    await writeAudit(db, 'TRIBE_SALUTE_ADJUSTED', admin.id, 'TRIBE', tribeId, { deltaSalutes: parseInt(deltaSalutes), reasonCode })

    return { data: { entry: sanitizeDoc(entry) }, status: 201 }
  }

  // ========================
  // GET /admin/tribe-contests/dashboard — Contest dashboard stats
  // ========================
  if (path[0] === 'admin' && path[1] === 'tribe-contests' && path[2] === 'dashboard' && path.length === 3 && method === 'GET') {
    const admin = await requireAuth(request, db)
    requireRole(admin, 'ADMIN', 'SUPER_ADMIN')

    const [total, draft, published, entryOpen, entryClosed, evaluating, locked, resolved, cancelled] = await Promise.all([
      db.collection('tribe_contests').countDocuments({}),
      db.collection('tribe_contests').countDocuments({ status: 'DRAFT' }),
      db.collection('tribe_contests').countDocuments({ status: 'PUBLISHED' }),
      db.collection('tribe_contests').countDocuments({ status: 'ENTRY_OPEN' }),
      db.collection('tribe_contests').countDocuments({ status: 'ENTRY_CLOSED' }),
      db.collection('tribe_contests').countDocuments({ status: 'EVALUATING' }),
      db.collection('tribe_contests').countDocuments({ status: 'LOCKED' }),
      db.collection('tribe_contests').countDocuments({ status: 'RESOLVED' }),
      db.collection('tribe_contests').countDocuments({ status: 'CANCELLED' }),
    ])

    const totalEntries = await db.collection('tribe_contest_entries').countDocuments({})
    const totalVotes = await db.collection('contest_votes').countDocuments({})
    const totalJudgeScores = await db.collection('contest_judge_scores').countDocuments({})

    // Active season
    const activeSeason = await db.collection('tribe_seasons').findOne({ status: 'ACTIVE' })

    return {
      data: {
        contests: { total, draft, published, entryOpen, entryClosed, evaluating, locked, resolved, cancelled },
        entries: totalEntries,
        votes: totalVotes,
        judgeScores: totalJudgeScores,
        activeSeason: activeSeason ? sanitizeDoc(activeSeason) : null,
      },
    }
  }

  return null
}
