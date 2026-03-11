/**
 * Contest Service — Business Logic Layer
 *
 * Extracted from tribe-contests.js handler (1599 lines).
 * Handles: contest lifecycle, scoring models, entry management,
 * vote processing, score computation, season standings.
 *
 * Handler remains thin: parses request, calls service, formats response.
 */

import { v4 as uuidv4 } from 'uuid'

// ========== CONFIG ==========
export const ContestConfig = {
  TYPES: ['reel_creative', 'tribe_battle', 'participation', 'judge', 'hybrid', 'seasonal'],
  FORMATS: ['individual', 'tribe_vs_tribe', 'open_tribe', 'league_round'],
  STATUSES: ['DRAFT', 'PUBLISHED', 'ENTRY_OPEN', 'ENTRY_CLOSED', 'EVALUATING', 'LOCKED', 'RESOLVED', 'CANCELLED'],
  ENTRY_TYPES: ['reel', 'post', 'manual', 'tribe_team', 'live_event'],
  ENTRY_STATUSES: ['submitted', 'validated', 'rejected', 'withdrawn', 'disqualified', 'locked'],
  ENTRY_MODES: ['self_submit', 'tribe_nomination', 'auto_pick', 'admin_only'],
  AUDIENCE_SCOPES: ['all_users', 'verified_users', 'specific_tribes', 'campus_scoped'],
  VOTE_TYPES: ['upvote', 'support'],
  RESOLUTION_MODES: ['manual', 'automatic', 'hybrid'],
}

// ========== STATUS MACHINE ==========
export const STATUS_TRANSITIONS = {
  DRAFT: ['PUBLISHED', 'CANCELLED'],
  PUBLISHED: ['ENTRY_OPEN', 'CANCELLED'],
  ENTRY_OPEN: ['ENTRY_CLOSED', 'CANCELLED'],
  ENTRY_CLOSED: ['EVALUATING', 'CANCELLED'],
  EVALUATING: ['LOCKED', 'CANCELLED'],
  LOCKED: ['RESOLVED'],
  RESOLVED: [],
  CANCELLED: [],
}

export function canTransition(currentStatus, targetStatus) {
  return (STATUS_TRANSITIONS[currentStatus] || []).includes(targetStatus)
}

// ========== SALUTE DISTRIBUTION ==========
export const DEFAULT_SALUTE_DISTRIBUTION = {
  rank_1: 1000,
  rank_2: 600,
  rank_3: 300,
  finalist: 100,
  participation_bonus: 25,
}

// ========== SCORING MODELS ==========
export const SCORING_MODELS = {
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

// ========== ROLE CHECKS ==========
export function isAdmin(user) {
  return ['ADMIN', 'SUPER_ADMIN'].includes(user.role)
}

export function isContestAdmin(user) {
  return ['ADMIN', 'SUPER_ADMIN', 'CONTEST_ADMIN'].includes(user.role)
}

export function isJudge(user) {
  return ['JUDGE', 'ADMIN', 'SUPER_ADMIN', 'CONTEST_ADMIN'].includes(user.role)
}

// ========== SCORE COMPUTATION ==========

/**
 * Compute scores for all valid entries in a contest.
 * Returns { computed, scores } with ranked results.
 */
export async function computeContestScores(db, contestId) {
  const contest = await db.collection('tribe_contests').findOne({ id: contestId })
  if (!contest) return { error: 'Contest not found' }

  const scoringModel = SCORING_MODELS[contest.scoringModelId] || SCORING_MODELS.scoring_reel_hybrid_v1

  const entries = await db.collection('tribe_contest_entries')
    .find({ contestId, submissionStatus: { $nin: ['withdrawn', 'disqualified', 'rejected'] } })
    .toArray()

  const now = new Date()
  let computed = 0

  for (const entry of entries) {
    const judgeScores = await db.collection('contest_judge_scores')
      .find({ contestId, entryId: entry.id })
      .toArray()

    const voteCount = await db.collection('contest_votes')
      .countDocuments({ contestId, entryId: entry.id })

    let judgeAvg = 0
    if (judgeScores.length > 0) {
      judgeAvg = judgeScores.reduce((s, js) => s + js.totalScore, 0) / judgeScores.length
    }

    const engagementScore = voteCount * 2
    const qualityScore = judgeAvg
    const participationScore = 10
    const penaltyScore = entry.isDisqualified ? 100 : 0

    const weights = scoringModel.weights
    let finalScore = 0
    if (contest.scoringModelId === 'scoring_judge_only_v1') {
      finalScore = judgeAvg - penaltyScore
    } else if (contest.scoringModelId === 'scoring_participation_v1') {
      finalScore = participationScore + engagementScore - penaltyScore
    } else {
      finalScore = (judgeAvg * (weights.judge || 0.35)) +
                   (engagementScore * (weights.valid_likes || 0.10)) +
                   (qualityScore * 0.1) +
                   (participationScore * 0.05) -
                   penaltyScore
    }

    finalScore = Math.round(finalScore * 100) / 100

    await db.collection('tribe_contest_scores').updateOne(
      { contestId, entryId: entry.id },
      {
        $set: {
          tribeId: entry.tribeId, userId: entry.userId,
          judgeScore: judgeAvg, engagementScore, qualityScore,
          participationScore, penaltyScore, finalScore,
          scoringVersion: contest.scoringModelId,
          breakdown: { judgeCount: judgeScores.length, voteCount, judgeAverage: judgeAvg },
          lastComputedAt: now, updatedAt: now,
        },
        $setOnInsert: { id: uuidv4(), contestId, entryId: entry.id, createdAt: now },
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

  return { computed, contestId, totalScored: computed }
}

// ========== ENTRY VALIDATION ==========

/**
 * Validate a contest entry submission.
 */
export function validateEntry({ contest, userId, tribeId, entryType, contentId }) {
  if (!ContestConfig.STATUSES.includes(contest.status)) {
    return { error: 'Invalid contest state' }
  }
  if (contest.status !== 'ENTRY_OPEN') {
    return { error: 'Contest is not accepting entries' }
  }
  if (contest.audienceScope === 'specific_tribes' && contest.eligibleTribes?.length > 0) {
    if (!contest.eligibleTribes.includes(tribeId)) {
      return { error: 'Your tribe is not eligible for this contest' }
    }
  }
  if (contest.allowedEntryTypes?.length > 0 && !contest.allowedEntryTypes.includes(entryType)) {
    return { error: `Entry type ${entryType} not allowed for this contest` }
  }
  return { valid: true }
}

// ========== SEASON STANDINGS ==========

/**
 * Compute or retrieve season standings.
 */
export async function getSeasonStandings(db, seasonId) {
  const standings = await db.collection('tribe_contest_standings')
    .find({ seasonId })
    .sort({ totalSalutes: -1 })
    .toArray()

  return standings.map((s, i) => ({
    rank: i + 1,
    ...sanitizeDoc(s),
  }))
}

// ========== SANITIZERS ==========

export function sanitizeDoc(d) {
  if (!d) return null
  const { _id, ...clean } = d
  return clean
}

export function sanitizeDocs(arr) {
  return (arr || []).map(sanitizeDoc).filter(Boolean)
}
