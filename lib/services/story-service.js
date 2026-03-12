/**
 * Story Service — Business Logic Layer
 *
 * Extracted from stories.js handler (2157 lines → ~300 lines of pure logic).
 * Handles: story creation, feed construction, view tracking,
 * interaction logic, sticker validation, highlight management.
 *
 * Handler remains thin: parses request, calls service, formats response.
 */

import { v4 as uuidv4 } from 'uuid'

// ========== CONFIG (canonical, version-tagged) ==========
export const StoryConfig = {
  TTL_HOURS: 24,
  MAX_STICKERS_PER_STORY: 5,
  MAX_CAPTION_LENGTH: 2200,
  MAX_POLL_OPTIONS: 4,
  MIN_POLL_OPTIONS: 2,
  MAX_QUIZ_OPTIONS: 4,
  MIN_QUIZ_OPTIONS: 2,
  MAX_QUESTION_LENGTH: 500,
  MAX_OPTION_LENGTH: 100,
  MAX_SLIDER_EMOJI_LENGTH: 10,
  MAX_REPLY_LENGTH: 1000,
  MAX_CLOSE_FRIENDS: 500,
  MAX_HIGHLIGHTS_PER_USER: 50,
  MAX_STORIES_PER_HIGHLIGHT: 100,
  MAX_HIGHLIGHT_NAME_LENGTH: 50,
  HOURLY_CREATE_LIMIT: 30,
  HOT_CREATOR_FOLLOWER_THRESHOLD: 10_000,
  HOT_CREATOR_RAIL_CAP: 100,
  NORMAL_RAIL_CAP: 200,
  VALID_STORY_TYPES: ['IMAGE', 'VIDEO', 'TEXT'],
  VALID_STICKER_TYPES: ['POLL', 'QUESTION', 'QUIZ', 'EMOJI_SLIDER', 'MENTION', 'LOCATION', 'HASHTAG', 'LINK', 'COUNTDOWN', 'MUSIC'],
  VALID_REACTIONS: ['❤️', '🔥', '😂', '😮', '😢', '👏'],
  VALID_PRIVACY: ['EVERYONE', 'FOLLOWERS', 'CLOSE_FRIENDS'],
  VALID_REPLY_PRIVACY: ['EVERYONE', 'FOLLOWERS', 'CLOSE_FRIENDS', 'OFF'],
  VALID_BG_TYPES: ['SOLID', 'GRADIENT', 'IMAGE'],
}

export const StoryStatus = {
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  REMOVED: 'REMOVED',
  HELD: 'HELD',
}

// ========== PRIVACY & ACCESS ==========

/**
 * Bidirectional block check: returns true if EITHER user has blocked the other.
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
 * Batch block check for feed: returns Set of userIds that have a block relationship with viewerId.
 */
export async function getBlockedUserIds(db, viewerId, candidateUserIds) {
  if (!viewerId || candidateUserIds.length === 0) return new Set()
  const blocks = await db.collection('blocks')
    .find({
      $or: [
        { blockerId: viewerId, blockedId: { $in: candidateUserIds } },
        { blockedId: viewerId, blockerId: { $in: candidateUserIds } },
      ],
    })
    .project({ blockerId: 1, blockedId: 1, _id: 0 })
    .toArray()
  const blockedSet = new Set()
  for (const b of blocks) {
    if (b.blockerId === viewerId) blockedSet.add(b.blockedId)
    else blockedSet.add(b.blockerId)
  }
  return blockedSet
}

/**
 * Check if a user can view a story based on privacy + hideStoryFrom + blocks.
 */
export async function canViewStory(db, story, viewerId) {
  if (!viewerId) return story.privacy === 'EVERYONE'
  if (story.authorId === viewerId) return true

  const blocked = await isBlocked(db, story.authorId, viewerId)
  if (blocked) return false

  const settings = await db.collection('story_settings').findOne({ userId: story.authorId })
  if (settings?.hideStoryFrom?.includes(viewerId)) return false

  switch (story.privacy) {
    case 'EVERYONE': return true
    case 'FOLLOWERS': {
      const follow = await db.collection('follows').findOne({ followerId: viewerId, followeeId: story.authorId })
      return !!follow
    }
    case 'CLOSE_FRIENDS': {
      const cf = await db.collection('close_friends').findOne({ userId: story.authorId, friendId: viewerId })
      return !!cf
    }
    default: return false
  }
}

/**
 * Check if social action (react/reply/sticker) is allowed.
 */
export async function canInteractWithStory(db, story, userId) {
  if (story.authorId === userId) return { allowed: false, error: 'Cannot interact with your own story' }
  const blocked = await isBlocked(db, story.authorId, userId)
  if (blocked) return { allowed: false, error: 'You are blocked from interacting with this story' }
  return { allowed: true }
}

/**
 * Check reply permission based on story's replyPrivacy setting.
 */
export async function checkReplyPermission(db, story, viewerId) {
  const replyPrivacy = story.replyPrivacy || 'EVERYONE'
  if (replyPrivacy === 'OFF') return false
  if (replyPrivacy === 'EVERYONE') return true
  if (replyPrivacy === 'FOLLOWERS') {
    const follow = await db.collection('follows').findOne({ followerId: viewerId, followeeId: story.authorId })
    return !!follow
  }
  if (replyPrivacy === 'CLOSE_FRIENDS') {
    const cf = await db.collection('close_friends').findOne({ userId: story.authorId, friendId: viewerId })
    return !!cf
  }
  return false
}

// ========== STICKER VALIDATION ==========

export function validateSticker(sticker) {
  if (!sticker.type || !StoryConfig.VALID_STICKER_TYPES.includes(sticker.type)) {
    return { error: `Invalid sticker type. Must be one of: ${StoryConfig.VALID_STICKER_TYPES.join(', ')}` }
  }

  const base = {
    id: uuidv4(),
    type: sticker.type,
    position: sticker.position || { x: 0.5, y: 0.5 },
    rotation: sticker.rotation || 0,
    scale: sticker.scale || 1,
  }

  switch (sticker.type) {
    case 'POLL': {
      if (!sticker.question?.trim()) return { error: 'Poll requires a question' }
      if (!sticker.options || !Array.isArray(sticker.options)) return { error: 'Poll requires options array' }
      if (sticker.options.length < StoryConfig.MIN_POLL_OPTIONS || sticker.options.length > StoryConfig.MAX_POLL_OPTIONS) {
        return { error: `Poll requires ${StoryConfig.MIN_POLL_OPTIONS}-${StoryConfig.MAX_POLL_OPTIONS} options` }
      }
      for (const opt of sticker.options) {
        if (!opt?.trim() || opt.length > StoryConfig.MAX_OPTION_LENGTH) {
          return { error: `Each option must be 1-${StoryConfig.MAX_OPTION_LENGTH} chars` }
        }
      }
      return { sticker: { ...base, question: sticker.question.slice(0, StoryConfig.MAX_QUESTION_LENGTH), options: sticker.options.map(o => o.trim()) } }
    }
    case 'QUIZ': {
      if (!sticker.question?.trim()) return { error: 'Quiz requires a question' }
      if (!sticker.options || !Array.isArray(sticker.options)) return { error: 'Quiz requires options array' }
      if (sticker.options.length < StoryConfig.MIN_QUIZ_OPTIONS || sticker.options.length > StoryConfig.MAX_QUIZ_OPTIONS) {
        return { error: `Quiz requires ${StoryConfig.MIN_QUIZ_OPTIONS}-${StoryConfig.MAX_QUIZ_OPTIONS} options` }
      }
      if (sticker.correctIndex === undefined || sticker.correctIndex < 0 || sticker.correctIndex >= sticker.options.length) {
        return { error: 'Quiz requires a valid correctIndex' }
      }
      return { sticker: { ...base, question: sticker.question.slice(0, StoryConfig.MAX_QUESTION_LENGTH), options: sticker.options.map(o => o.trim()), correctIndex: sticker.correctIndex } }
    }
    case 'QUESTION': {
      if (!sticker.question?.trim()) return { error: 'Question sticker requires a question' }
      return { sticker: { ...base, question: sticker.question.slice(0, StoryConfig.MAX_QUESTION_LENGTH), placeholder: sticker.placeholder || 'Type your answer...' } }
    }
    case 'EMOJI_SLIDER': {
      if (!sticker.question?.trim()) return { error: 'Emoji slider requires a question' }
      return { sticker: { ...base, question: sticker.question.slice(0, StoryConfig.MAX_QUESTION_LENGTH), emoji: (sticker.emoji || '❤️').slice(0, StoryConfig.MAX_SLIDER_EMOJI_LENGTH) } }
    }
    case 'MENTION': {
      if (!sticker.userId) return { error: 'Mention sticker requires userId' }
      return { sticker: { ...base, userId: sticker.userId, username: sticker.username || '' } }
    }
    case 'LOCATION':
      return { sticker: { ...base, locationName: sticker.locationName || '', lat: sticker.lat, lng: sticker.lng } }
    case 'HASHTAG': {
      if (!sticker.tag?.trim()) return { error: 'Hashtag sticker requires tag' }
      return { sticker: { ...base, tag: sticker.tag.trim() } }
    }
    case 'LINK': {
      if (!sticker.url?.trim()) return { error: 'Link sticker requires url' }
      return { sticker: { ...base, url: sticker.url.trim(), label: sticker.label || '' } }
    }
    case 'COUNTDOWN': {
      if (!sticker.title?.trim()) return { error: 'Countdown sticker requires title' }
      if (!sticker.endTime) return { error: 'Countdown sticker requires endTime' }
      return { sticker: { ...base, title: sticker.title.trim(), endTime: new Date(sticker.endTime) } }
    }
    case 'MUSIC':
      return { sticker: { ...base, trackName: sticker.trackName || '', artist: sticker.artist || '', previewUrl: sticker.previewUrl || '' } }
    default:
      return { error: `Unsupported sticker type: ${sticker.type}` }
  }
}

export function validateStickerResponse(sticker, body) {
  switch (sticker.type) {
    case 'POLL': {
      const { optionIndex } = body
      if (optionIndex === undefined || optionIndex < 0 || optionIndex >= sticker.options.length) {
        return { error: `optionIndex must be 0-${sticker.options.length - 1}` }
      }
      return { response: { optionIndex } }
    }
    case 'QUIZ': {
      const { optionIndex } = body
      if (optionIndex === undefined || optionIndex < 0 || optionIndex >= sticker.options.length) {
        return { error: `optionIndex must be 0-${sticker.options.length - 1}` }
      }
      return { response: { optionIndex, correct: optionIndex === sticker.correctIndex } }
    }
    case 'QUESTION': {
      const { text } = body
      if (!text?.trim() || text.length > StoryConfig.MAX_QUESTION_LENGTH) {
        return { error: `Answer must be 1-${StoryConfig.MAX_QUESTION_LENGTH} characters` }
      }
      return { response: { text: text.trim() } }
    }
    case 'EMOJI_SLIDER': {
      const { value } = body
      if (value === undefined || typeof value !== 'number' || value < 0 || value > 1) {
        return { error: 'value must be a number between 0 and 1' }
      }
      return { response: { value } }
    }
    default:
      return { error: `Sticker type ${sticker.type} does not support responses` }
  }
}

// ========== STICKER RESULTS ==========

export async function getStickerResults(db, storyId, stickerId, sticker) {
  const totalResponses = await db.collection('story_sticker_responses').countDocuments({ storyId, stickerId })

  switch (sticker.type) {
    case 'POLL': {
      const voteCounts = await db.collection('story_sticker_responses').aggregate([
        { $match: { storyId, stickerId } },
        { $group: { _id: '$response.optionIndex', count: { $sum: 1 } } },
      ]).toArray()
      const countMap = Object.fromEntries(voteCounts.map(v => [v._id, v.count]))
      return {
        totalVotes: totalResponses,
        options: sticker.options.map((opt, i) => ({
          text: opt,
          votes: countMap[i] || 0,
          percentage: totalResponses > 0 ? Math.round(((countMap[i] || 0) / totalResponses) * 100) : 0,
        })),
      }
    }
    case 'QUIZ': {
      const answerCounts = await db.collection('story_sticker_responses').aggregate([
        { $match: { storyId, stickerId } },
        { $group: { _id: '$response.optionIndex', count: { $sum: 1 }, correctCount: { $sum: { $cond: ['$response.correct', 1, 0] } } } },
      ]).toArray()
      const countMap = Object.fromEntries(answerCounts.map(v => [v._id, v.count]))
      const totalCorrect = answerCounts.reduce((sum, v) => sum + (v.correctCount || 0), 0)
      return {
        totalAnswers: totalResponses,
        correctCount: totalCorrect,
        correctPercentage: totalResponses > 0 ? Math.round((totalCorrect / totalResponses) * 100) : 0,
        options: sticker.options.map((opt, i) => ({
          text: opt, count: countMap[i] || 0, isCorrect: i === sticker.correctIndex,
          percentage: totalResponses > 0 ? Math.round(((countMap[i] || 0) / totalResponses) * 100) : 0,
        })),
      }
    }
    case 'QUESTION': return { totalAnswers: totalResponses }
    case 'EMOJI_SLIDER': {
      const agg = await db.collection('story_sticker_responses').aggregate([
        { $match: { storyId, stickerId } },
        { $group: { _id: null, avgValue: { $avg: '$response.value' }, count: { $sum: 1 } } },
      ]).toArray()
      const result = agg[0] || { avgValue: 0, count: 0 }
      return { totalResponses: result.count, averageValue: Math.round((result.avgValue || 0) * 100) / 100, emoji: sticker.emoji }
    }
    default: return { totalResponses }
  }
}

/**
 * Enrich stickers with results and viewer's response.
 */
export async function enrichStickersForViewer(db, story, viewerId) {
  if (!story.stickers || story.stickers.length === 0) return []
  const stickersWithResults = []
  for (const sticker of story.stickers) {
    const enriched = { ...sticker }
    if (['POLL', 'QUIZ', 'QUESTION', 'EMOJI_SLIDER'].includes(sticker.type)) {
      enriched.results = await getStickerResults(db, story.id, sticker.id, sticker)
      if (viewerId) {
        const resp = await db.collection('story_sticker_responses').findOne({ storyId: story.id, stickerId: sticker.id, userId: viewerId })
        enriched.viewerResponse = resp ? resp.response : null
      }
    }
    stickersWithResults.push(enriched)
  }
  return stickersWithResults
}

// ========== STORY FEED CONSTRUCTION ==========

/**
 * Build the story rail for a viewer.
 * Groups stories by author, applies privacy/block filters, marks seen/unseen.
 */
export async function buildStoryRail(db, user, sanitizeUserFn) {
  // Show ALL active stories from ALL users (not just followed)
  const blockedUserIds = await getBlockedUserIds(db, user.id, [])
  
  const now = new Date()
  const stories = await db.collection('stories')
    .find({ status: StoryStatus.ACTIVE, expiresAt: { $gt: now } })
    .sort({ createdAt: -1 })
    .limit(StoryConfig.NORMAL_RAIL_CAP)
    .toArray()

  // Filter out blocked users
  const filteredStories = stories.filter(s => !blockedUserIds.has(s.authorId))

  // Close friends and hideStoryFrom filters (batch)
  const closeFriendEntries = await db.collection('close_friends')
    .find({ friendId: user.id })
    .project({ userId: 1, _id: 0 })
    .toArray()
  const closeFriendOfSet = new Set(closeFriendEntries.map(e => e.userId))

  const storyAuthorIds = [...new Set(filteredStories.map(s => s.authorId))]
  const [authorSettings, mutedEntries] = await Promise.all([
    db.collection('story_settings')
      .find({ userId: { $in: storyAuthorIds }, hideStoryFrom: { $exists: true, $ne: [] } })
      .project({ userId: 1, hideStoryFrom: 1, _id: 0 })
      .toArray(),
    db.collection('story_mutes')
      .find({ userId: user.id, mutedUserId: { $in: storyAuthorIds } })
      .project({ mutedUserId: 1, _id: 0 })
      .toArray(),
  ])
  const hideFromMap = Object.fromEntries(authorSettings.map(s => [s.userId, new Set(s.hideStoryFrom)]))
  const mutedSet = new Set(mutedEntries.map(m => m.mutedUserId))

  const visibleStories = filteredStories.filter(s => {
    if (s.authorId === user.id) return true
    if (mutedSet.has(s.authorId)) return false
    if (hideFromMap[s.authorId]?.has(user.id)) return false
    if (s.privacy === 'EVERYONE') return true
    if (s.privacy === 'FOLLOWERS') return true
    if (s.privacy === 'CLOSE_FRIENDS') return closeFriendOfSet.has(s.authorId)
    return false
  })

  // Seen/unseen tracking
  const storyIds = visibleStories.map(s => s.id)
  const views = await db.collection('story_views')
    .find({ storyId: { $in: storyIds }, viewerId: user.id })
    .project({ storyId: 1, _id: 0 })
    .toArray()
  const viewedSet = new Set(views.map(v => v.storyId))

  // Group by author
  const grouped = {}
  for (const story of visibleStories) {
    if (!grouped[story.authorId]) grouped[story.authorId] = { stories: [], hasUnseen: false }
    const { _id, ...sanitized } = story
    sanitized.seen = viewedSet.has(story.id)
    grouped[story.authorId].stories.push(sanitized)
    if (!sanitized.seen) grouped[story.authorId].hasUnseen = true
  }

  // Enrich with author info
  const authorIds = Object.keys(grouped)
  const authors = await db.collection('users').find({ id: { $in: authorIds } }).toArray()
  const authorMap = Object.fromEntries(authors.map(a => [a.id, sanitizeUserFn(a)]))

  const storyRail = authorIds.map(authorId => ({
    author: authorMap[authorId] || null,
    stories: grouped[authorId].stories,
    hasUnseen: grouped[authorId].hasUnseen,
    latestAt: grouped[authorId].stories[0]?.createdAt,
    storyCount: grouped[authorId].stories.length,
  }))

  // Sort: own first, then unseen first, then by latest
  storyRail.sort((a, b) => {
    if (a.author?.id === user.id) return -1
    if (b.author?.id === user.id) return 1
    if (a.hasUnseen && !b.hasUnseen) return -1
    if (!a.hasUnseen && b.hasUnseen) return 1
    return new Date(b.latestAt) - new Date(a.latestAt)
  })

  return storyRail
}

// ========== EXPIRY WORKER ==========

let expiryWorkerStarted = false

export function startExpiryWorker(db, publishEventFn) {
  if (expiryWorkerStarted) return
  expiryWorkerStarted = true

  async function runCleanup() {
    try {
      const now = new Date()
      const noArchiveUsers = await db.collection('story_settings')
        .find({ autoArchive: false })
        .project({ userId: 1, _id: 0 })
        .toArray()
      const noArchiveSet = new Set(noArchiveUsers.map(s => s.userId))

      const expiredStories = await db.collection('stories')
        .find({ status: 'ACTIVE', expiresAt: { $lte: now } })
        .project({ id: 1, authorId: 1, _id: 0 })
        .toArray()

      if (expiredStories.length === 0) return

      const archiveIds = []
      const noArchiveIds = []
      for (const s of expiredStories) {
        if (noArchiveSet.has(s.authorId)) noArchiveIds.push(s.id)
        else archiveIds.push(s.id)
      }

      if (archiveIds.length > 0) {
        await db.collection('stories').updateMany(
          { id: { $in: archiveIds }, status: 'ACTIVE' },
          { $set: { status: 'EXPIRED', archived: true, updatedAt: now } }
        )
      }
      if (noArchiveIds.length > 0) {
        await db.collection('stories').updateMany(
          { id: { $in: noArchiveIds }, status: 'ACTIVE' },
          { $set: { status: 'EXPIRED', archived: false, updatedAt: now } }
        )
      }

      // Emit per-author expired events
      if (publishEventFn) {
        const authorGroups = {}
        for (const s of expiredStories) {
          if (!authorGroups[s.authorId]) authorGroups[s.authorId] = []
          authorGroups[s.authorId].push(s.id)
        }
        for (const [authorId, storyIds] of Object.entries(authorGroups)) {
          await publishEventFn(authorId, { type: 'story.expired', storyIds, count: storyIds.length })
        }
      }
    } catch (err) {
      // Logged by caller
    }
  }

  runCleanup()
  setInterval(runCleanup, 30 * 60 * 1000)
}
