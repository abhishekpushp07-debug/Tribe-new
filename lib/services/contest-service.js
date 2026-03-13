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
  ENTRY_TYPES: ['reel', 'post', 'story', 'manual', 'tribe_team', 'live_event'],
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
  scoring_content_engagement_v1: {
    name: 'Content Engagement v1 — Salutes from Reels/Posts/Stories',
    weights: { likes: 0.25, views: 0.20, comments: 0.20, saves: 0.15, shares: 0.15, judge: 0.05 },
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
 * Fetch real engagement metrics from the actual content (reel/post/story).
 * Returns { likes, views, comments, saves, shares } normalized metrics.
 */
async function fetchContentEngagement(db, entry) {
  const metrics = { likes: 0, views: 0, comments: 0, saves: 0, shares: 0 }
  if (!entry.contentId) return metrics

  if (entry.entryType === 'reel') {
    const reel = await db.collection('reels').findOne({ id: entry.contentId }, { projection: { _id: 0, likeCount: 1, viewCount: 1, commentCount: 1, saveCount: 1, shareCount: 1 } })
    if (reel) {
      metrics.likes = reel.likeCount || 0
      metrics.views = reel.viewCount || 0
      metrics.comments = reel.commentCount || 0
      metrics.saves = reel.saveCount || 0
      metrics.shares = reel.shareCount || 0
    }
  } else if (entry.entryType === 'post') {
    const post = await db.collection('content_items').findOne({ id: entry.contentId }, { projection: { _id: 0, likeCount: 1, viewCount: 1, commentCount: 1, saveCount: 1, shareCount: 1 } })
    if (post) {
      metrics.likes = post.likeCount || 0
      metrics.views = post.viewCount || 0
      metrics.comments = post.commentCount || 0
      metrics.saves = post.saveCount || 0
      metrics.shares = post.shareCount || 0
    }
  } else if (entry.entryType === 'story') {
    const story = await db.collection('stories').findOne({ id: entry.contentId }, { projection: { _id: 0, viewCount: 1, reactionCount: 1, replyCount: 1 } })
    if (story) {
      metrics.likes = story.reactionCount || 0
      metrics.views = story.viewCount || 0
      metrics.comments = story.replyCount || 0
    }
  }
  return metrics
}

/**
 * Compute scores for all valid entries in a contest.
 * Pulls REAL engagement data from linked content (reels/posts/stories).
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

    // Fetch REAL engagement from linked content
    const contentMetrics = await fetchContentEngagement(db, entry)

    const penaltyScore = entry.isDisqualified ? 100 : 0
    const weights = scoringModel.weights
    let finalScore = 0

    if (contest.scoringModelId === 'scoring_judge_only_v1') {
      finalScore = judgeAvg - penaltyScore
    } else if (contest.scoringModelId === 'scoring_participation_v1') {
      finalScore = 10 + (voteCount * 2) - penaltyScore
    } else if (contest.scoringModelId === 'scoring_content_engagement_v1') {
      // Content-driven scoring: purely from reel/post/story salutes (engagement)
      finalScore = (contentMetrics.likes * (weights.likes || 0.25)) +
                   (contentMetrics.views * 0.01 * (weights.views || 0.20)) +
                   (contentMetrics.comments * (weights.comments || 0.20)) +
                   (contentMetrics.saves * (weights.saves || 0.15)) +
                   (contentMetrics.shares * (weights.shares || 0.15)) +
                   (judgeAvg * (weights.judge || 0.05)) -
                   penaltyScore
    } else {
      // Hybrid: judge + real content engagement + votes
      finalScore = (judgeAvg * (weights.judge || 0.35)) +
                   (contentMetrics.likes * (weights.valid_likes || 0.10)) +
                   (contentMetrics.saves * (weights.saves || 0.15)) +
                   (contentMetrics.shares * (weights.shares || 0.10)) +
                   (contentMetrics.views * 0.01 * (weights.completion || 0.20)) +
                   (contentMetrics.comments * (weights.comment_quality || 0.10)) +
                   (voteCount * 2 * 0.05) -
                   penaltyScore
    }

    finalScore = Math.round(finalScore * 100) / 100

    await db.collection('tribe_contest_scores').updateOne(
      { contestId, entryId: entry.id },
      {
        $set: {
          tribeId: entry.tribeId, userId: entry.userId,
          judgeScore: judgeAvg,
          engagementScore: contentMetrics.likes + contentMetrics.comments + contentMetrics.saves + contentMetrics.shares,
          contentMetrics,
          qualityScore: judgeAvg,
          participationScore: 10, penaltyScore, finalScore,
          scoringVersion: contest.scoringModelId,
          breakdown: {
            judgeCount: judgeScores.length, voteCount, judgeAverage: judgeAvg,
            contentLikes: contentMetrics.likes, contentViews: contentMetrics.views,
            contentComments: contentMetrics.comments, contentSaves: contentMetrics.saves,
            contentShares: contentMetrics.shares,
          },
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
