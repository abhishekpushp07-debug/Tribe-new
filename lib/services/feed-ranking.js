/**
 * Tribe — World-Class Smart Feed Ranking Engine
 *
 * Instagram-level algorithmic feed with multi-signal scoring.
 *
 * Scoring formula:
 *   feedScore = recencyScore × engagementScore × affinityBoost × qualityBoost × diversityPenalty
 *
 * Signals:
 *   1. Recency: exponential decay (half-life = 6 hours)
 *   2. Engagement velocity: likes×1 + comments×3 + saves×5 + shares×2 per hour (log-scaled)
 *   3. Author affinity: follow=+0.5, same tribe=+0.3, per-author interaction history=+0.0–1.0
 *   4. Content type affinity: boost content types the viewer engages with most
 *   5. Quality signals: media boost, caption length, hashtag relevance
 *   6. Negative signals: hide/mute/report = heavy downrank
 *   7. Unseen boost: unseen posts from followed users get +30% bump
 *   8. Virality detection: posts with above-average engagement velocity get +20%
 */

const HALF_LIFE_MS = 6 * 60 * 60 * 1000 // 6 hours
const LN2 = Math.LN2

// Engagement weights
const W_LIKE = 1
const W_COMMENT = 3
const W_SAVE = 5
const W_SHARE = 2

/**
 * Score a single post for feed ranking.
 */
function scorePost(post, ctx) {
  const ageMs = Math.max(1, ctx.now - (post.createdAt?.getTime?.() || Date.parse(post.createdAt) || ctx.now))
  const ageHours = Math.max(0.1, ageMs / 3600000)

  // 1. Recency: exponential decay with 6h half-life
  const recency = Math.exp(-LN2 * ageMs / HALF_LIFE_MS)

  // 2. Engagement velocity: weighted interactions per hour (log-scaled)
  const likes = post.likeCount || 0
  const comments = post.commentCount || 0
  const saves = post.saveCount || post.savedCount || 0
  const shares = post.shareCount || 0
  const engagementRaw = (likes * W_LIKE) + (comments * W_COMMENT) + (saves * W_SAVE) + (shares * W_SHARE)
  const engagementVelocity = engagementRaw / ageHours
  const engagement = Math.log2(1 + engagementVelocity)

  // 3. Virality detection: compare to average engagement velocity
  const viralityBoost = ctx.avgEngagementVelocity > 0 && engagementVelocity > ctx.avgEngagementVelocity * 2
    ? 1.2  // 20% boost for viral posts
    : 1.0

  // 4. Author affinity
  const authorId = post.authorId || post.creatorId
  let affinity = 1.0
  if (ctx.followeeIds?.has?.(authorId)) affinity += 0.5
  if (ctx.viewerTribeId && post.tribeId === ctx.viewerTribeId) affinity += 0.3

  // Per-author interaction score: 0.0 to 1.0 based on how much viewer interacts with this author
  const authorInteractionScore = ctx.authorScores?.[authorId] || 0
  affinity += authorInteractionScore

  // 5. Content type affinity
  const contentType = detectContentType(post)
  const typeBoost = ctx.contentTypeWeights?.[contentType] || 1.0

  // 6. Quality signals
  let quality = 1.0
  if (post.media?.length > 0 || post.mediaId) quality *= 1.15
  if (post.media?.length > 1) quality *= 1.05 // carousel bonus
  const captionLen = (post.caption || post.text || '').length
  if (captionLen > 50 && captionLen < 500) quality *= 1.05 // good caption length

  // 7. Unseen boost: new posts from follows that viewer hasn't seen
  if (ctx.followeeIds?.has?.(authorId) && !ctx.seenPostIds?.has?.(post.id)) {
    quality *= 1.3
  }

  // 8. Negative signals
  if (ctx.mutedAuthorIds?.has?.(authorId)) return 0.01 // near-zero but not removed
  if (ctx.hiddenPostIds?.has?.(post.id)) return 0
  if (post.reportCount > 3) quality *= 0.5

  const finalScore = recency * (1 + engagement) * affinity * quality * viralityBoost * typeBoost
  return finalScore
}

/**
 * Score a reel using similar but reel-optimized weights.
 */
function scoreReel(reel, ctx) {
  const ageMs = Math.max(1, ctx.now - (reel.createdAt?.getTime?.() || Date.parse(reel.createdAt) || ctx.now))
  const ageHours = Math.max(0.1, ageMs / 3600000)

  // Reels have a longer half-life (12h) since they're more discoverable
  const reelHalfLife = 12 * 60 * 60 * 1000
  const recency = Math.exp(-LN2 * ageMs / reelHalfLife)

  // Engagement: views matter more for reels
  const views = reel.viewCount || 0
  const likes = reel.likeCount || 0
  const comments = reel.commentCount || 0
  const saves = reel.saveCount || reel.savedCount || 0
  const shares = reel.shareCount || 0
  const engagementRaw = (views * 0.1) + (likes * W_LIKE) + (comments * W_COMMENT) + (saves * W_SAVE) + (shares * W_SHARE)
  const engagement = Math.log2(1 + engagementRaw / ageHours)

  // Completion rate: reels watched to end are more engaging
  const completionRate = views > 0 && reel.completionCount ? (reel.completionCount / views) : 0.5
  const completionBoost = 0.8 + (completionRate * 0.4) // 0.8 to 1.2

  // Author affinity
  const authorId = reel.authorId || reel.creatorId
  let affinity = 1.0
  if (ctx.followeeIds?.has?.(authorId)) affinity += 0.5
  if (ctx.viewerTribeId && reel.tribeId === ctx.viewerTribeId) affinity += 0.3
  affinity += (ctx.authorScores?.[authorId] || 0)

  // Negative signals
  if (ctx.mutedAuthorIds?.has?.(authorId)) return 0.01
  if (ctx.hiddenPostIds?.has?.(reel.id)) return 0

  return recency * (1 + engagement) * affinity * completionBoost
}

/**
 * Detect content type for affinity scoring.
 */
function detectContentType(post) {
  if (post.subType === 'POLL') return 'poll'
  if (post.subType === 'THREAD_HEAD' || post.subType === 'THREAD_PART') return 'thread'
  if (post.subType === 'LINK') return 'link'
  if (post.media?.length > 1) return 'carousel'
  const firstMedia = post.media?.[0]
  if (firstMedia?.type === 'VIDEO' || post.mediaType === 'VIDEO') return 'video'
  if (firstMedia?.type === 'IMAGE' || post.mediaType === 'IMAGE') return 'image'
  return 'text'
}

/**
 * Rank a batch of posts using the smart feed algorithm.
 * Applies scoring + diversity penalty (max 2 posts from same author in top 20).
 */
export function rankFeed(posts, ctx = {}) {
  if (!posts?.length) return []
  const now = Date.now()

  // Compute average engagement velocity for virality detection
  let totalVelocity = 0
  for (const post of posts) {
    const ageH = Math.max(0.1, (now - (post.createdAt?.getTime?.() || Date.parse(post.createdAt) || now)) / 3600000)
    const raw = ((post.likeCount || 0) * W_LIKE) + ((post.commentCount || 0) * W_COMMENT) + ((post.saveCount || 0) * W_SAVE) + ((post.shareCount || 0) * W_SHARE)
    totalVelocity += raw / ageH
  }
  const avgEngagementVelocity = totalVelocity / posts.length

  const fullCtx = { ...ctx, now, avgEngagementVelocity }

  // Score each post
  const scored = posts.map(post => ({
    ...post,
    _feedScore: scorePost(post, fullCtx),
    _contentType: detectContentType(post),
  }))

  // Sort by score descending
  scored.sort((a, b) => b._feedScore - a._feedScore)

  // Apply diversity penalty — limit same author in consecutive window
  const authorCounts = {}
  // Also inject content type diversity — no more than 3 same type in a row
  const recentTypes = []
  for (const post of scored) {
    const aid = post.authorId || post.creatorId
    const count = (authorCounts[aid] || 0) + 1
    authorCounts[aid] = count

    if (count === 2) post._feedScore *= 0.7
    else if (count >= 3) post._feedScore *= 0.4

    // Content type diversity: penalize 3+ same type in a row
    recentTypes.push(post._contentType)
    if (recentTypes.length >= 3) {
      const last3 = recentTypes.slice(-3)
      if (last3[0] === last3[1] && last3[1] === last3[2]) {
        post._feedScore *= 0.85
      }
    }
  }

  // Re-sort after diversity penalty
  scored.sort((a, b) => b._feedScore - a._feedScore)

  // Assign rank
  scored.forEach((post, i) => { post._feedRank = i + 1 })

  return scored
}

/**
 * Rank a batch of reels using the reel-optimized algorithm.
 */
export function rankReels(reels, ctx = {}) {
  if (!reels?.length) return []
  const now = Date.now()
  const fullCtx = { ...ctx, now, avgEngagementVelocity: 0 }

  const scored = reels.map(reel => ({
    ...reel,
    _feedScore: scoreReel(reel, fullCtx),
  }))

  scored.sort((a, b) => b._feedScore - a._feedScore)

  // Diversity: max 2 reels from same author
  const authorCounts = {}
  for (const reel of scored) {
    const aid = reel.authorId || reel.creatorId
    const count = (authorCounts[aid] || 0) + 1
    authorCounts[aid] = count
    if (count === 2) reel._feedScore *= 0.6
    else if (count >= 3) reel._feedScore *= 0.3
  }

  scored.sort((a, b) => b._feedScore - a._feedScore)
  scored.forEach((r, i) => { r._feedRank = i + 1 })
  return scored
}

/**
 * Build rich affinity context for a viewer.
 * Queries interaction history, content type preferences, muted/hidden lists.
 */
export async function buildAffinityContext(db, viewerId) {
  if (!viewerId) return { viewerId: null, viewerTribeId: null, followeeIds: new Set(), authorScores: {}, contentTypeWeights: {}, mutedAuthorIds: new Set(), hiddenPostIds: new Set(), seenPostIds: new Set() }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const [user, follows, recentLikes, recentComments, recentSaves, muted, hidden] = await Promise.all([
    db.collection('users').findOne({ id: viewerId }, { projection: { _id: 0, tribeId: 1 } }),
    db.collection('follows').find({ followerId: viewerId }, { projection: { _id: 0, followeeId: 1 } }).toArray(),
    // Recent interactions for per-author scoring
    db.collection('likes').find({ userId: viewerId, createdAt: { $gte: thirtyDaysAgo } }, { projection: { _id: 0, contentAuthorId: 1, contentType: 1 } }).limit(500).toArray(),
    db.collection('comments').find({ authorId: viewerId, createdAt: { $gte: thirtyDaysAgo } }, { projection: { _id: 0, contentAuthorId: 1 } }).limit(200).toArray(),
    db.collection('saves').find({ userId: viewerId, createdAt: { $gte: thirtyDaysAgo } }, { projection: { _id: 0, contentAuthorId: 1 } }).limit(200).toArray(),
    db.collection('mutes').find({ muterId: viewerId }, { projection: { _id: 0, mutedId: 1 } }).toArray(),
    db.collection('hidden_content').find({ userId: viewerId }, { projection: { _id: 0, contentId: 1 } }).limit(500).toArray(),
  ])

  // Build per-author interaction scores (0.0 to 1.0)
  const authorInteractions = {}
  for (const like of recentLikes) {
    if (like.contentAuthorId) authorInteractions[like.contentAuthorId] = (authorInteractions[like.contentAuthorId] || 0) + 1
  }
  for (const comment of recentComments) {
    if (comment.contentAuthorId) authorInteractions[comment.contentAuthorId] = (authorInteractions[comment.contentAuthorId] || 0) + 3
  }
  for (const save of recentSaves) {
    if (save.contentAuthorId) authorInteractions[save.contentAuthorId] = (authorInteractions[save.contentAuthorId] || 0) + 5
  }

  // Normalize to 0–1 range
  const maxInteraction = Math.max(1, ...Object.values(authorInteractions))
  const authorScores = {}
  for (const [aid, score] of Object.entries(authorInteractions)) {
    authorScores[aid] = Math.min(1.0, score / maxInteraction)
  }

  // Build content type preferences from like history
  const typeCounts = {}
  for (const like of recentLikes) {
    const ct = like.contentType || 'image'
    typeCounts[ct] = (typeCounts[ct] || 0) + 1
  }
  const totalLikes = recentLikes.length || 1
  const contentTypeWeights = {}
  for (const [type, count] of Object.entries(typeCounts)) {
    // Range: 0.8 to 1.4 based on preference ratio
    contentTypeWeights[type] = 0.8 + (count / totalLikes) * 0.6
  }

  return {
    viewerId,
    viewerTribeId: user?.tribeId || null,
    followeeIds: new Set(follows.map(f => f.followeeId)),
    authorScores,
    contentTypeWeights,
    mutedAuthorIds: new Set(muted.map(m => m.mutedId)),
    hiddenPostIds: new Set(hidden.map(h => h.contentId)),
    seenPostIds: new Set(), // Could be populated from analytics_events if needed
  }
}

/**
 * Debug: Explain why a post got its score (for /feed/debug endpoint).
 */
export function explainScore(post, ctx) {
  const now = ctx.now || Date.now()
  const ageMs = Math.max(1, now - (post.createdAt?.getTime?.() || Date.parse(post.createdAt) || now))
  const ageHours = Math.max(0.1, ageMs / 3600000)
  const recency = Math.exp(-LN2 * ageMs / HALF_LIFE_MS)

  const likes = post.likeCount || 0
  const comments = post.commentCount || 0
  const saves = post.saveCount || post.savedCount || 0
  const shares = post.shareCount || 0
  const engagementRaw = (likes * W_LIKE) + (comments * W_COMMENT) + (saves * W_SAVE) + (shares * W_SHARE)
  const engagementVelocity = engagementRaw / ageHours

  const authorId = post.authorId || post.creatorId
  let affinity = 1.0
  if (ctx.followeeIds?.has?.(authorId)) affinity += 0.5
  if (ctx.viewerTribeId && post.tribeId === ctx.viewerTribeId) affinity += 0.3
  affinity += (ctx.authorScores?.[authorId] || 0)

  return {
    postId: post.id,
    ageHours: Math.round(ageHours * 10) / 10,
    recencyScore: Math.round(recency * 1000) / 1000,
    engagement: { likes, comments, saves, shares, raw: engagementRaw, velocity: Math.round(engagementVelocity * 100) / 100 },
    affinity: Math.round(affinity * 100) / 100,
    contentType: detectContentType(post),
    isFollowed: ctx.followeeIds?.has?.(authorId) || false,
    sameTribe: ctx.viewerTribeId && post.tribeId === ctx.viewerTribeId,
    authorInteractionScore: ctx.authorScores?.[authorId] || 0,
    isMuted: ctx.mutedAuthorIds?.has?.(authorId) || false,
    finalScore: post._feedScore || scorePost(post, { ...ctx, now }),
    rank: post._feedRank,
  }
}
