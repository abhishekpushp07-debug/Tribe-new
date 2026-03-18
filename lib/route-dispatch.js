/**
 * Tribe — Route Dispatch Registry
 * 
 * Clean route dispatch extracted from the monolithic route.js.
 * Maps path[0] → handler function(s) with optional sub-routing logic.
 */

import { handleAuth } from '@/lib/handlers/auth'
import { handleOnboarding } from '@/lib/handlers/onboarding'
import { handleContent } from '@/lib/handlers/content'
import { handleFeed } from '@/lib/handlers/feed'
import { handleSocial } from '@/lib/handlers/social'
import { handleUsers } from '@/lib/handlers/users'
import { handleDiscovery } from '@/lib/handlers/discovery'
import { handleMedia } from '@/lib/handlers/media'
import { handleMediaCleanup, startMediaCleanupWorker } from '@/lib/handlers/media-cleanup'
import { startCleanupWorker } from '@/lib/services/cleanup-worker'
import { handleAdmin } from '@/lib/handlers/admin'
import { handleGovernance } from '@/lib/handlers/governance'
import { handleAppealDecision, handleCollegeClaims, handleDistribution, handleResources } from '@/lib/handlers/stages'
import { handleEvents } from '@/lib/handlers/events'
import { handleBoardNotices, handleAuthenticityTags } from '@/lib/handlers/board-notices'
import { handleStories } from '@/lib/handlers/stories'
import { handleReels } from '@/lib/handlers/reels'
import { handleTribes, handleTribeAdmin } from '@/lib/handlers/tribes'
import { handleTribeContests, handleTribeContestAdmin } from '@/lib/handlers/tribe-contests'
import { handlePages } from '@/lib/handlers/pages'
import { handleNotifications } from '@/lib/handlers/notifications'
import { handleSearch } from '@/lib/handlers/search'
import { handleTranscode } from '@/lib/handlers/transcode'
import { handleAnalytics } from '@/lib/handlers/analytics'
import { handleFollowRequests, interceptFollowForPrivateAccount } from '@/lib/handlers/follow-requests'
import { handleQuality } from '@/lib/handlers/quality'
import { handleRecommendations } from '@/lib/handlers/recommendations'
import { handleActivity } from '@/lib/handlers/activity'
import { handleSuggestions } from '@/lib/handlers/suggestions'
import { handleOps } from '@/lib/handlers/ops'
import { getAnalyticsDb } from '@/lib/db'

// Admin sub-route map for /admin/:resource
const adminRouteMap = {
  'college-claims': handleCollegeClaims,
  'distribution': handleDistribution,
  'resources': handleResources,
  'stories': handleStories,
  'reels': handleReels,
  'pages': handlePages,
  'events': handleEvents,
  'board-notices': handleBoardNotices,
  'authenticity': handleAuthenticityTags,
  'media': handleMediaCleanup,
  'tribes': handleTribeAdmin,
  'tribe-seasons': handleTribeAdmin,
  'tribe-awards': handleTribeAdmin,
  'tribe-rivalries': handleTribeAdmin,
  'tribe-contests': handleTribeContestAdmin,
  'tribe-salutes': handleTribeContestAdmin,
  'abuse-dashboard': handleAdmin,
  'abuse-log': handleAdmin,
}

// /me/* sub-routes that need special handler delegation
const meSubRoutes = {
  'stories': handleStories,
  'close-friends': handleStories,
  'highlights': handleStories,
  'story-settings': handleStories,
  'story-mutes': handleStories,
  'blocks': handleStories,
  'reels': handleReels,
  'events': handleEvents,
  'board': handleBoardNotices,
  'tribe': handleTribes,
  'college-claims': handleCollegeClaims,
  'resources': handleResources,
  'pages': handlePages,
  'media': handleMedia,
}

// Special /me/stories sub-paths that also go to stories handler
const meStoriesSubPaths = new Set(['archive', 'insights'])

/**
 * Dispatch a request to the appropriate handler.
 * Returns handler result or null if no route matched.
 */
export async function dispatchRoute(path, method, request, db) {
  const segment = path[0]

  // Ops, health, cache, moderation — these run before feature routes
  if (!segment || segment === 'healthz' || segment === 'readyz' || segment === 'ops' || segment === 'cache' || segment === 'ws' || (segment === 'moderation' && (path[1] === 'config' || path[1] === 'check'))) {
    const opsResult = await handleOps(path, method, request, db)
    if (opsResult) return opsResult
    // If empty path and not handled, fall through to default (404)
    if (!segment) return null
  }

  switch (segment) {
    case 'auth':
      return handleAuth(path, method, request, db)

    case 'me':
      return dispatchMe(path, method, request, db)

    case 'content':
      return dispatchContent(path, method, request, db)

    case 'feed':
    case 'explore':
    case 'trending':
      return handleFeed(path, method, request, db)

    case 'follow':
      return dispatchFollow(path, method, request, db)

    case 'stories':
      return handleStories(path, method, request, db)

    case 'reels':
      return handleReels(path, method, request, db)

    case 'users':
      return dispatchUsers(path, method, request, db)

    case 'colleges':
    case 'houses':
      return dispatchCollegesHouses(path, method, request, db)

    case 'media':
      startMediaCleanupWorker(db)
      startCleanupWorker(db)
      return (await handleMedia(path, method, request, db))
        || handleTranscode(path, method, request, db)

    case 'search':
    case 'hashtags':
      return (await handleSearch(path, method, request, db))
        || handleDiscovery(path, method, request, db)

    case 'analytics': {
      const aDb = await getAnalyticsDb()
      return handleAnalytics(path, method, request, aDb)
    }

    case 'transcode':
      return handleTranscode(path, method, request, db)

    case 'follow-requests':
      return handleFollowRequests(path, method, request, db)

    case 'quality':
      return handleQuality(request, db, { method, path })

    case 'recommendations':
      return handleRecommendations(request, db, { method, path })

    case 'activity':
      return handleActivity(request, db, { method, path })

    case 'suggestions':
      return handleSuggestions(request, db, { method, path })

    case 'house-points':
      return { error: 'House points system deprecated. Use tribe salutes via /tribe-contests', code: 'DEPRECATED', status: 410 }

    case 'governance':
      return handleGovernance(path, method, request, db)

    case 'notifications':
      return handleNotifications(path, method, request, db)

    case 'reports':
    case 'moderation':
    case 'appeals':
    case 'legal':
    case 'admin':
    case 'grievances':
      return dispatchAdminModeration(path, method, request, db)

    case 'pages':
      return handlePages(path, method, request, db)

    case 'resources':
      return handleResources(path, method, request, db)

    case 'events':
      return handleEvents(path, method, request, db)

    case 'board':
      return handleBoardNotices(path, method, request, db)

    case 'authenticity':
      return handleAuthenticityTags(path, method, request, db)

    case 'tribe-contests':
      return handleTribeContests(path, method, request, db)

    case 'tribe-rivalries':
      return handleTribes(path, method, request, db)

    case 'tribes':
      return handleTribes(path, method, request, db)

    default:
      return null
  }
}

// ========== Sub-dispatchers ==========

async function dispatchMe(path, method, request, db) {
  // Check special stories sub-paths first: /me/stories/archive, /me/stories/insights
  if (path[1] === 'stories' && meStoriesSubPaths.has(path[2])) {
    return handleStories(path, method, request, db)
  }

  // Direct sub-route mapping
  const handler = meSubRoutes[path[1]]
  if (handler) {
    return handler(path, method, request, db)
  }

  // Fallback chain: follow-requests → users → onboarding
  let result = await handleFollowRequests(path, method, request, db)
  if (!result) result = await handleUsers(path, method, request, db)
  if (!result) result = await handleOnboarding(path, method, request, db)
  return result
}

async function dispatchContent(path, method, request, db) {
  if (path.length <= 2) {
    return handleContent(path, method, request, db)
  }
  // path.length >= 3: try content handler first (polls, threads), then social (likes, comments)
  return (await handleContent(path, method, request, db))
    || handleSocial(path, method, request, db)
}

async function dispatchFollow(path, method, request, db) {
  // Intercept follows for private accounts first
  const intercepted = await interceptFollowForPrivateAccount(path, method, request, db)
  return intercepted || handleSocial(path, method, request, db)
}

async function dispatchUsers(path, method, request, db) {
  // Special user sub-resources
  if (path.length === 3 && path[2] === 'stories') return handleStories(path, method, request, db)
  if (path.length === 3 && path[2] === 'highlights') return handleStories(path, method, request, db)
  if (path[2] === 'reels') return handleReels(path, method, request, db)
  if (path[2] === 'tribe') return handleTribes(path, method, request, db)
  return handleUsers(path, method, request, db)
}

async function dispatchCollegesHouses(path, method, request, db) {
  if (path[0] === 'colleges' && path.length === 3 && path[2] === 'claim') {
    return handleCollegeClaims(path, method, request, db)
  }
  if (path[0] === 'colleges' && path.length === 3 && path[2] === 'notices') {
    return handleBoardNotices(path, method, request, db)
  }
  return handleDiscovery(path, method, request, db)
}

async function dispatchAdminModeration(path, method, request, db) {
  // Special case: appeals/:id/decide
  if (path[0] === 'appeals' && path.length === 3 && path[2] === 'decide') {
    return handleAppealDecision(path, method, request, db)
  }
  // Special case: moderation/board-notices
  if (path[0] === 'moderation' && path[1] === 'board-notices') {
    return handleBoardNotices(path, method, request, db)
  }
  // Admin sub-routes via map
  if (path[0] === 'admin' && adminRouteMap[path[1]]) {
    return adminRouteMap[path[1]](path, method, request, db)
  }
  // Fallback to generic admin handler
  return handleAdmin(path, method, request, db)
}
