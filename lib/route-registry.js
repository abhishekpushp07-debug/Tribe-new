/**
 * Tribe — Route Registry
 * 
 * Maps path prefixes to their handler functions.
 * Replaces the massive if/else chain in route.js.
 * 
 * Order matters: more specific routes are checked first.
 */

export function buildRouteRegistry(handlers) {
  const {
    handleAuth, handleOnboarding, handleContent, handleFeed, handleSocial,
    handleUsers, handleDiscovery, handleMedia, handleAdmin, handleGovernance,
    handleModerationRoutes, handleAppealDecision, handleCollegeClaims,
    handleDistribution, handleResources, handleEvents, handleBoardNotices,
    handleAuthenticityTags, handleStories, handleReels, handleTribes,
    handleTribeAdmin, handleTribeContests, handleTribeContestAdmin,
    handlePages, handleNotifications, handleSearch, handleTranscode,
    handleAnalytics, handleFollowRequests, handleQuality,
    handleRecommendations, handleActivity, handleSuggestions,
    handleMediaCleanup,
  } = handlers

  // User-facing routes: prefix → handler
  const userRoutes = [
    { prefix: 'auth', handler: handleAuth },
    { prefix: 'onboarding', handler: handleOnboarding },
    { prefix: 'content', handler: handleContent },
    { prefix: 'feed', handler: handleFeed },
    { prefix: 'social', handler: handleSocial },
    { prefix: 'users', handler: handleUsers },
    { prefix: 'discover', handler: handleDiscovery },
    { prefix: 'media', handler: handleMedia },
    { prefix: 'stories', handler: handleStories },
    { prefix: 'reels', handler: handleReels },
    { prefix: 'tribe-contests', handler: handleTribeContests },
    { prefix: 'tribe-rivalries', handler: handleTribes },
    { prefix: 'tribes', handler: handleTribes },
    { prefix: 'pages', handler: handlePages },
    { prefix: 'notifications', handler: handleNotifications },
    { prefix: 'search', handler: handleSearch },
    { prefix: 'transcode', handler: handleTranscode },
    { prefix: 'analytics', handler: handleAnalytics },
    { prefix: 'follow-requests', handler: handleFollowRequests },
    { prefix: 'quality', handler: handleQuality },
    { prefix: 'recommendations', handler: handleRecommendations },
    { prefix: 'activity', handler: handleActivity },
    { prefix: 'suggestions', handler: handleSuggestions },
    { prefix: 'resources', handler: handleResources },
    { prefix: 'events', handler: handleEvents },
    { prefix: 'board', handler: handleBoardNotices },
    { prefix: 'authenticity', handler: handleAuthenticityTags },
    { prefix: 'governance', handler: handleGovernance },
    { prefix: 'distribution', handler: handleDistribution },
    { prefix: 'college-claims', handler: handleCollegeClaims },
    { prefix: 'appeals', handler: handleAppealDecision },
  ]

  // Admin routes: prefix[1] → handler (when prefix[0] === 'admin')
  const adminRoutes = [
    { prefix: 'tribe-contests', handler: handleTribeContestAdmin },
    { prefix: 'tribe-awards', handler: handleTribeAdmin },
    { prefix: 'tribe-rivalries', handler: handleTribeAdmin },
    { prefix: 'tribes', handler: handleTribeAdmin },
    { prefix: 'abuse-dashboard', handler: handleAdmin },
    { prefix: 'abuse-log', handler: handleAdmin },
    { prefix: 'media', handler: handleMediaCleanup },
    { prefix: 'moderation', handler: handleModerationRoutes },
  ]

  return { userRoutes, adminRoutes }
}

/**
 * Resolve a path to its handler
 * Returns the handler function or null
 */
export function resolveRoute(path, registry) {
  const { userRoutes, adminRoutes } = registry

  // Admin routes
  if (path[0] === 'admin' && path.length >= 2) {
    // Check specific admin routes first
    for (const route of adminRoutes) {
      if (path[1] === route.prefix) {
        return route.handler
      }
    }
    // Fallback: generic admin handler will be checked by caller
    return null
  }

  // User routes
  for (const route of userRoutes) {
    if (path[0] === route.prefix) {
      return route.handler
    }
  }

  return null
}
