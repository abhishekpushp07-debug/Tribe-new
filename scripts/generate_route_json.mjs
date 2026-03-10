/**
 * B0.1 Route Census — Full JSON Generator
 * Reads all handler files and builds complete route_inventory_raw.json
 */
import fs from 'fs'

const R = (method, path, hf, hfn, domain, type, auth, role, flags, crit, notes) => ({
  method, final_path: `/api/${path}`, handler_file: hf, handler_function: hfn,
  domain, route_type: type, auth_present: auth, role_guard: role,
  stream_flag: flags.includes('S'), upload_flag: flags.includes('U'), binary_flag: flags.includes('B'),
  deprecated_suspect: flags.includes('D'), runtime_confidence: flags.includes('R') ? 'runtime-hit-confirmed' : flags.includes('X') ? 'runtime-bug-observed' : 'code-read-confirmed',
  business_criticality: crit, notes
})

const routes = [
  // === SYSTEM (11) ===
  R('GET','healthz','route.js','inline','System','HEALTHCHECK',false,'none','R','P0','Liveness probe'),
  R('GET','readyz','route.js','inline','System','HEALTHCHECK',false,'none','','P1','Readiness probe, checks DB'),
  R('GET','','route.js','inline','System','JSON_READ',false,'none','','P2','API root info'),
  R('GET','cache/stats','route.js','inline','System','ADMIN_ACTION',true,'admin','','P2','Cache stats'),
  R('GET','ops/health','route.js','checkDeepHealth','System','ADMIN_ACTION',true,'admin','','P1','Deep health check'),
  R('GET','ops/metrics','route.js','inline','System','ADMIN_ACTION',true,'admin','','P1','Observability metrics'),
  R('GET','ops/slis','route.js','metrics.getSLIs','System','ADMIN_ACTION',true,'admin','','P2','SLI data'),
  R('GET','ops/backup-check','route.js','inline','System','ADMIN_ACTION',true,'admin','','P2','Backup check'),
  R('GET','moderation/config','moderation.routes.js','handleModerationRoutes','System','ADMIN_ACTION',true,'mod','','P2','AI mod config'),
  R('POST','moderation/check','moderation.routes.js','handleModerationRoutes','System','ADMIN_ACTION',true,'mod','','P2','Manual mod check'),
  R('GET','house-points','route.js','inline:410','Deprecated','DEPRECATED',false,'none','D','P2','410 GONE'),

  // === AUTH (9) ===
  R('POST','auth/register','auth.js','handleAuth','Auth','JSON_WRITE',false,'none','R','P0','Signup: phone,pin,displayName'),
  R('POST','auth/login','auth.js','handleAuth','Auth','JSON_WRITE',false,'none','R','P0','Login: phone,pin. Brute-force protected'),
  R('POST','auth/refresh','auth.js','handleAuth','Auth','JSON_WRITE',false,'none','','P0','Rotate refresh token. Reuse detection'),
  R('POST','auth/logout','auth.js','handleAuth','Auth','JSON_WRITE',false,'none','','P0','Logout. Always 200'),
  R('GET','auth/me','auth.js','handleAuth','Auth','JSON_READ',true,'none','','P0','Current user'),
  R('GET','auth/sessions','auth.js','handleAuth','Auth','JSON_READ',true,'none','','P1','Active sessions'),
  R('DELETE','auth/sessions','auth.js','handleAuth','Auth','JSON_WRITE',true,'none','','P1','Revoke all sessions'),
  R('DELETE','auth/sessions/:sessionId','auth.js','handleAuth','Auth','JSON_WRITE',true,'none','','P1','Revoke one session'),
  R('PATCH','auth/pin','auth.js','handleAuth','Auth','JSON_WRITE',true,'none','','P1','Change PIN. Also PUT'),

  // === ME/PROFILE (4) ===
  R('PATCH','me/profile','onboarding.js','handleOnboarding','Me/Profile','JSON_WRITE',true,'none','','P0','Update profile. Also PUT'),
  R('PATCH','me/age','onboarding.js','handleOnboarding','Me/Profile','JSON_WRITE',true,'none','','P0','Set age. Also PUT'),
  R('PATCH','me/college','onboarding.js','handleOnboarding','Me/Profile','JSON_WRITE',true,'none','','P0','Link college. Also PUT'),
  R('PATCH','me/onboarding','onboarding.js','handleOnboarding','Me/Profile','JSON_WRITE',true,'none','','P0','Mark onboarding done. Also PUT'),

  // === CONTENT (3) ===
  R('POST','content/posts','content.js','handleContent','Content','JSON_WRITE',true,'none','','P0','Create post/reel/story in content_items'),
  R('GET','content/:id','content.js','handleContent','Content','JSON_READ',false,'none','','P0','Get content item'),
  R('DELETE','content/:id','content.js','handleContent','Content','JSON_WRITE',true,'none','','P0','Soft-delete content'),

  // === FEED (6) ===
  R('GET','feed/public','feed.js','handleFeed','Feed','JSON_READ',false,'none','','P0','Public feed. Stage 2 only. Cursor'),
  R('GET','feed/following','feed.js','handleFeed','Feed','JSON_READ',true,'none','','P0','Following feed. Cursor'),
  R('GET','feed/college/:collegeId','feed.js','handleFeed','Feed','JSON_READ',false,'none','','P0','College feed. Cached'),
  R('GET','feed/house/:houseId','feed.js','handleFeed','Feed','JSON_READ',false,'none','','P1','House feed. Cached'),
  R('GET','feed/stories','feed.js','handleFeed','Feed','JSON_READ',true,'none','','P0','Story rail. content_items(STORY)'),
  R('GET','feed/reels','feed.js','handleFeed','Feed','JSON_READ',false,'none','','P0','Reels feed. content_items(REEL). Cached'),

  // === SOCIAL (10) ===
  R('POST','follow/:userId','social.js','handleSocial','Social','JSON_WRITE',true,'none','','P0','Follow. Idempotent'),
  R('DELETE','follow/:userId','social.js','handleSocial','Social','JSON_WRITE',true,'none','','P0','Unfollow. Idempotent'),
  R('POST','content/:id/like','social.js','handleSocial','Social','JSON_WRITE',true,'none','','P0','Like. Triggers distribution eval'),
  R('POST','content/:id/dislike','social.js','handleSocial','Social','JSON_WRITE',true,'none','','P1','Dislike. Internal signal'),
  R('DELETE','content/:id/reaction','social.js','handleSocial','Social','JSON_WRITE',true,'none','','P1','Remove reaction'),
  R('POST','content/:id/save','social.js','handleSocial','Social','JSON_WRITE',true,'none','','P0','Bookmark. Idempotent'),
  R('DELETE','content/:id/save','social.js','handleSocial','Social','JSON_WRITE',true,'none','','P0','Unbookmark'),
  R('POST','content/:id/comments','social.js','handleSocial','Comments','JSON_WRITE',true,'none','','P0','Comment. AI moderated'),
  R('GET','content/:id/comments','social.js','handleSocial','Comments','JSON_READ',false,'none','','P0','List comments. Cursor'),

  // === USERS (5) ===
  R('GET','users/:id','users.js','handleUsers','Users','JSON_READ',false,'none','','P0','User profile'),
  R('GET','users/:id/posts','users.js','handleUsers','Users','JSON_READ',false,'none','','P0','User posts. ?kind filter'),
  R('GET','users/:id/followers','users.js','handleUsers','Users','JSON_READ',false,'none','','P0','Followers. Offset pagination'),
  R('GET','users/:id/following','users.js','handleUsers','Users','JSON_READ',false,'none','','P0','Following. Offset pagination'),
  R('GET','users/:id/saved','users.js','handleUsers','Users','JSON_READ',true,'none','','P1','Saved posts. SELF-ONLY'),

  // === DISCOVERY (11) ===
  R('GET','colleges/search','discovery.js','handleDiscovery','Discovery','JSON_READ',false,'none','','P0','Search colleges'),
  R('GET','colleges/states','discovery.js','handleDiscovery','Discovery','JSON_READ',false,'none','','P1','College states'),
  R('GET','colleges/types','discovery.js','handleDiscovery','Discovery','JSON_READ',false,'none','','P1','College types'),
  R('GET','colleges/:id','discovery.js','handleDiscovery','Discovery','JSON_READ',false,'none','','P0','College detail'),
  R('GET','colleges/:id/members','discovery.js','handleDiscovery','Discovery','JSON_READ',false,'none','','P1','College members. Offset'),
  R('GET','houses','discovery.js','handleDiscovery','Discovery','JSON_READ',false,'none','','P1','All houses. Cached'),
  R('GET','houses/leaderboard','discovery.js','handleDiscovery','Discovery','JSON_READ',false,'none','','P1','House leaderboard. Cached'),
  R('GET','houses/:idOrSlug','discovery.js','handleDiscovery','Discovery','JSON_READ',false,'none','','P1','House detail'),
  R('GET','houses/:idOrSlug/members','discovery.js','handleDiscovery','Discovery','JSON_READ',false,'none','','P1','House members. Offset'),
  R('GET','search','discovery.js','handleDiscovery','Search','JSON_READ',false,'none','','P0','Universal search. Posts NOT indexed'),
  R('GET','suggestions/users','discovery.js','handleDiscovery','Discovery','JSON_READ',true,'none','','P1','Follow suggestions'),

  // === MEDIA (2) ===
  R('POST','media/upload','media.js','handleMedia','Media','MEDIA_UPLOAD',true,'none','U','P0','Upload base64. Object storage → DB fallback'),
  R('GET','media/:id','media.js','handleMedia','Media','MEDIA_BINARY',false,'none','B','P0','Serve binary. Cache-Control immutable'),

  // === STORIES (33) ===
  R('GET','stories/events/stream','stories.js','handleStories','Stories','STREAM_SSE',true,'none','S','P1','SSE story events'),
  R('POST','stories','stories.js','handleStories','Stories','JSON_WRITE',true,'none','','P0','Create story. 24h TTL'),
  R('GET','stories/feed','stories.js','handleStories','Stories','JSON_READ',true,'none','','P0','Story feed (stories collection)'),
  R('GET','stories/:id','stories.js','handleStories','Stories','JSON_READ',false,'none','','P0','Get story'),
  R('DELETE','stories/:id','stories.js','handleStories','Stories','JSON_WRITE',true,'none','','P0','Delete story'),
  R('GET','stories/:id/views','stories.js','handleStories','Stories','JSON_READ',true,'none','','P1','Story viewers. OWNER-ONLY'),
  R('POST','stories/:id/react','stories.js','handleStories','Stories','JSON_WRITE',true,'none','','P1','Story reaction'),
  R('DELETE','stories/:id/react','stories.js','handleStories','Stories','JSON_WRITE',true,'none','','P1','Remove reaction'),
  R('POST','stories/:id/reply','stories.js','handleStories','Stories','JSON_WRITE',true,'none','','P1','Story reply'),
  R('GET','stories/:id/replies','stories.js','handleStories','Stories','JSON_READ',true,'none','','P1','Story replies. OWNER-ONLY'),
  R('POST','stories/:id/sticker/:stickerId/respond','stories.js','handleStories','Stories','JSON_WRITE',true,'none','','P1','Sticker response'),
  R('GET','stories/:id/sticker/:stickerId/results','stories.js','handleStories','Stories','JSON_READ',false,'none','','P1','Sticker results'),
  R('GET','stories/:id/sticker/:stickerId/responses','stories.js','handleStories','Stories','JSON_READ',true,'none','','P2','Sticker raw responses. OWNER-ONLY'),
  R('GET','me/stories/archive','stories.js','handleStories','Stories','JSON_READ',true,'none','','P1','Own archived stories'),
  R('GET','users/:id/stories','stories.js','handleStories','Stories','JSON_READ',false,'none','','P0','User stories'),
  R('GET','me/close-friends','stories.js','handleStories','Stories','JSON_READ',true,'none','','P1','Close friends list'),
  R('POST','me/close-friends/:userId','stories.js','handleStories','Stories','JSON_WRITE',true,'none','','P1','Add close friend'),
  R('DELETE','me/close-friends/:userId','stories.js','handleStories','Stories','JSON_WRITE',true,'none','','P1','Remove close friend'),
  R('POST','me/highlights','stories.js','handleStories','Stories','JSON_WRITE',true,'none','','P1','Create highlight'),
  R('GET','users/:id/highlights','stories.js','handleStories','Stories','JSON_READ',false,'none','','P1','User highlights'),
  R('PATCH','me/highlights/:id','stories.js','handleStories','Stories','JSON_WRITE',true,'none','','P1','Update highlight'),
  R('DELETE','me/highlights/:id','stories.js','handleStories','Stories','JSON_WRITE',true,'none','','P1','Delete highlight'),
  R('GET','me/story-settings','stories.js','handleStories','Stories','JSON_READ',true,'none','','P1','Story settings'),
  R('PATCH','me/story-settings','stories.js','handleStories','Stories','JSON_WRITE',true,'none','','P1','Update story settings'),
  R('GET','me/blocks','stories.js','handleStories','Blocks','JSON_READ',true,'none','','P1','Blocked users'),
  R('POST','me/blocks/:userId','stories.js','handleStories','Blocks','JSON_WRITE',true,'none','','P1','Block user'),
  R('DELETE','me/blocks/:userId','stories.js','handleStories','Blocks','JSON_WRITE',true,'none','','P1','Unblock user'),
  R('POST','stories/:id/report','stories.js','handleStories','Stories','JSON_WRITE',true,'none','','P1','Report story'),
  R('POST','admin/stories/:id/recompute-counters','stories.js','handleStories','Admin/Stories','ADMIN_ACTION',true,'admin','','P2','Recompute story counters'),
  R('POST','admin/stories/cleanup','stories.js','handleStories','Admin/Stories','ADMIN_ACTION',true,'admin','','P2','Cleanup expired stories'),
  R('GET','admin/stories/analytics','stories.js','handleStories','Admin/Stories','ADMIN_ACTION',true,'admin','','P2','Story analytics'),
  R('GET','admin/stories','stories.js','handleStories','Admin/Stories','ADMIN_ACTION',true,'mod','','P2','Admin story queue'),
  R('PATCH','admin/stories/:id/moderate','stories.js','handleStories','Admin/Stories','ADMIN_ACTION',true,'mod','','P1','Moderate story'),

  // === REELS (36) ===
  R('POST','reels','reels.js','handleReels','Reels','JSON_WRITE',true,'none','','P0','Create reel'),
  R('GET','reels/feed','reels.js','handleReels','Reels','JSON_READ',false,'none','','P0','Reels discovery feed'),
  R('GET','reels/following','reels.js','handleReels','Reels','JSON_READ',true,'none','','P0','Following reels'),
  R('GET','users/:id/reels','reels.js','handleReels','Reels','JSON_READ',false,'none','','P0','User reels'),
  R('GET','reels/:id','reels.js','handleReels','Reels','JSON_READ',false,'none','','P0','Reel detail'),
  R('PATCH','reels/:id','reels.js','handleReels','Reels','JSON_WRITE',true,'none','','P1','Edit reel'),
  R('DELETE','reels/:id','reels.js','handleReels','Reels','JSON_WRITE',true,'none','','P1','Delete reel'),
  R('POST','reels/:id/publish','reels.js','handleReels','Reels','JSON_WRITE',true,'none','','P1','Publish draft'),
  R('POST','reels/:id/archive','reels.js','handleReels','Reels','JSON_WRITE',true,'none','','P1','Archive reel'),
  R('POST','reels/:id/restore','reels.js','handleReels','Reels','JSON_WRITE',true,'none','','P1','Restore reel'),
  R('POST','reels/:id/pin','reels.js','handleReels','Reels','JSON_WRITE',true,'none','','P1','Pin reel'),
  R('DELETE','reels/:id/pin','reels.js','handleReels','Reels','JSON_WRITE',true,'none','','P1','Unpin reel'),
  R('POST','reels/:id/like','reels.js','handleReels','Reels','JSON_WRITE',true,'none','','P0','Like reel'),
  R('DELETE','reels/:id/like','reels.js','handleReels','Reels','JSON_WRITE',true,'none','','P1','Unlike reel'),
  R('POST','reels/:id/save','reels.js','handleReels','Reels','JSON_WRITE',true,'none','','P1','Save reel'),
  R('DELETE','reels/:id/save','reels.js','handleReels','Reels','JSON_WRITE',true,'none','','P1','Unsave reel'),
  R('POST','reels/:id/comment','reels.js','handleReels','Reels','JSON_WRITE',true,'none','X','P0','Comment reel. KNOWN BUG: 400'),
  R('GET','reels/:id/comments','reels.js','handleReels','Reels','JSON_READ',false,'none','','P0','Reel comments'),
  R('POST','reels/:id/report','reels.js','handleReels','Reels','JSON_WRITE',true,'none','X','P1','Report reel. KNOWN BUG: 400'),
  R('POST','reels/:id/hide','reels.js','handleReels','Reels','JSON_WRITE',true,'none','','P2','Hide reel'),
  R('POST','reels/:id/not-interested','reels.js','handleReels','Reels','JSON_WRITE',true,'none','','P2','Not interested'),
  R('POST','reels/:id/share','reels.js','handleReels','Reels','JSON_WRITE',true,'none','','P1','Record share'),
  R('POST','reels/:id/watch','reels.js','handleReels','Reels','JSON_WRITE',false,'none','','P1','Record watch time'),
  R('POST','reels/:id/view','reels.js','handleReels','Reels','JSON_WRITE',false,'none','','P1','Record view'),
  R('GET','reels/audio/:audioId','reels.js','handleReels','Reels','JSON_READ',false,'none','','P2','Reels by audio'),
  R('GET','reels/:id/remixes','reels.js','handleReels','Reels','JSON_READ',false,'none','','P2','Remix chain'),
  R('POST','me/reels/series','reels.js','handleReels','Reels','JSON_WRITE',true,'none','','P2','Create series'),
  R('GET','users/:id/reels/series','reels.js','handleReels','Reels','JSON_READ',false,'none','','P2','User reel series'),
  R('GET','me/reels/archive','reels.js','handleReels','Reels','JSON_READ',true,'none','','P1','Own archived reels'),
  R('GET','me/reels/analytics','reels.js','handleReels','Reels','JSON_READ',true,'none','','P1','Own reel analytics'),
  R('POST','reels/:id/processing','reels.js','handleReels','Reels','JSON_WRITE',true,'none','','P2','Update processing status'),
  R('GET','reels/:id/processing','reels.js','handleReels','Reels','JSON_READ',true,'none','','P2','Check processing status'),
  R('GET','admin/reels','reels.js','handleReels','Admin/Reels','ADMIN_ACTION',true,'mod','','P2','Admin reels queue'),
  R('PATCH','admin/reels/:id/moderate','reels.js','handleReels','Admin/Reels','ADMIN_ACTION',true,'mod','','P1','Moderate reel'),
  R('GET','admin/reels/analytics','reels.js','handleReels','Admin/Reels','ADMIN_ACTION',true,'mod','','P2','Reel analytics'),
  R('POST','admin/reels/:id/recompute-counters','reels.js','handleReels','Admin/Reels','ADMIN_ACTION',true,'admin','','P2','Recompute reel counters'),

  // === TRIBES (19) ===
  R('GET','tribes','tribes.js','handleTribes','Tribes','JSON_READ',false,'none','','P0','List tribes'),
  R('GET','tribes/standings/current','tribes.js','handleTribes','Tribes','JSON_READ',false,'none','','P0','Season standings'),
  R('GET','tribes/:id','tribes.js','handleTribes','Tribes','JSON_READ',false,'none','','P0','Tribe detail'),
  R('GET','tribes/:id/members','tribes.js','handleTribes','Tribes','JSON_READ',false,'none','','P1','Tribe members. Offset'),
  R('GET','tribes/:id/board','tribes.js','handleTribes','Tribes','JSON_READ',false,'none','','P1','Tribe board'),
  R('GET','tribes/:id/fund','tribes.js','handleTribes','Tribes','JSON_READ',false,'none','','P1','Tribe fund'),
  R('GET','tribes/:id/salutes','tribes.js','handleTribes','Tribes','JSON_READ',false,'none','','P1','Tribe salutes'),
  R('GET','me/tribe','tribes.js','handleTribes','Tribes','JSON_READ',true,'none','','P0','My tribe'),
  R('GET','users/:id/tribe','tribes.js','handleTribes','Tribes','JSON_READ',false,'none','','P1','User tribe'),
  R('GET','admin/tribes/distribution','tribes.js','handleTribeAdmin','Admin/Tribes','ADMIN_ACTION',true,'admin','','P1','Tribe distribution stats'),
  R('POST','admin/tribes/reassign','tribes.js','handleTribeAdmin','Admin/Tribes','ADMIN_ACTION',true,'admin','','P1','Reassign users'),
  R('POST','admin/tribe-seasons','tribes.js','handleTribeAdmin','Admin/Tribes','ADMIN_ACTION',true,'admin','','P1','Create season'),
  R('GET','admin/tribe-seasons','tribes.js','handleTribeAdmin','Admin/Tribes','ADMIN_ACTION',true,'admin','','P1','List seasons'),
  R('POST','admin/tribe-contests','tribes.js','handleTribeAdmin','Admin/Tribes','ADMIN_ACTION',true,'admin','','P1','Create contest (tribes handler)'),
  R('POST','admin/tribe-contests/:id/resolve','tribes.js','handleTribeAdmin','Admin/Tribes','ADMIN_ACTION',true,'admin','','P1','Resolve contest (tribes handler)'),
  R('POST','admin/tribe-salutes/adjust','tribes.js','handleTribeAdmin','Admin/Tribes','ADMIN_ACTION',true,'admin','','P2','Adjust salutes'),
  R('POST','admin/tribe-awards/resolve','tribes.js','handleTribeAdmin','Admin/Tribes','ADMIN_ACTION',true,'admin','','P2','Resolve awards'),
  R('POST','admin/tribes/migrate','tribes.js','handleTribeAdmin','Admin/Tribes','ADMIN_ACTION',true,'admin','','P2','Migrate tribe data'),
  R('POST','admin/tribes/boards','tribes.js','handleTribeAdmin','Admin/Tribes','ADMIN_ACTION',true,'admin','','P2','Manage tribe boards'),

  // === TRIBE CONTESTS (28) ===
  R('GET','tribe-contests','tribe-contests.js','handleTribeContests','TribeContests','JSON_READ',false,'none','','P0','List contests'),
  R('GET','tribe-contests/live-feed','tribe-contests.js','handleTribeContests','TribeContests','JSON_READ',false,'none','','P0','Live feed'),
  R('GET','tribe-contests/:id/live','tribe-contests.js','handleTribeContests','TribeContests','JSON_READ',false,'none','','P1','Contest live data'),
  R('GET','tribe-contests/seasons/:seasonId/live-standings','tribe-contests.js','handleTribeContests','TribeContests','JSON_READ',false,'none','','P1','Season live standings'),
  R('GET','tribe-contests/:id','tribe-contests.js','handleTribeContests','TribeContests','JSON_READ',false,'none','','P0','Contest detail'),
  R('POST','tribe-contests/:id/enter','tribe-contests.js','handleTribeContests','TribeContests','JSON_WRITE',true,'none','','P0','Enter contest'),
  R('GET','tribe-contests/:id/entries','tribe-contests.js','handleTribeContests','TribeContests','JSON_READ',false,'none','','P0','Contest entries'),
  R('GET','tribe-contests/:id/leaderboard','tribe-contests.js','handleTribeContests','TribeContests','JSON_READ',false,'none','','P0','Contest leaderboard'),
  R('GET','tribe-contests/:id/results','tribe-contests.js','handleTribeContests','TribeContests','JSON_READ',false,'none','','P1','Contest results'),
  R('POST','tribe-contests/:id/vote','tribe-contests.js','handleTribeContests','TribeContests','JSON_WRITE',true,'none','','P0','Vote'),
  R('POST','tribe-contests/:id/withdraw','tribe-contests.js','handleTribeContests','TribeContests','JSON_WRITE',true,'none','','P1','Withdraw entry'),
  R('GET','tribe-contests/seasons','tribe-contests.js','handleTribeContests','TribeContests','JSON_READ',false,'none','','P1','List seasons'),
  R('GET','tribe-contests/seasons/:seasonId/standings','tribe-contests.js','handleTribeContests','TribeContests','JSON_READ',false,'none','','P1','Season standings'),
  R('POST','admin/tribe-contests','tribe-contests.js','handleTribeContestAdmin','Admin/TribeContests','ADMIN_ACTION',true,'admin','','P1','Create contest (admin)'),
  R('GET','admin/tribe-contests','tribe-contests.js','handleTribeContestAdmin','Admin/TribeContests','ADMIN_ACTION',true,'admin','','P1','List all contests (admin)'),
  R('GET','admin/tribe-contests/:id','tribe-contests.js','handleTribeContestAdmin','Admin/TribeContests','ADMIN_ACTION',true,'admin','','P2','Contest admin detail'),
  R('POST','admin/tribe-contests/:id/publish','tribe-contests.js','handleTribeContestAdmin','Admin/TribeContests','ADMIN_ACTION',true,'admin','','P1','Publish contest'),
  R('POST','admin/tribe-contests/:id/open-entries','tribe-contests.js','handleTribeContestAdmin','Admin/TribeContests','ADMIN_ACTION',true,'admin','','P1','Open entries'),
  R('POST','admin/tribe-contests/:id/close-entries','tribe-contests.js','handleTribeContestAdmin','Admin/TribeContests','ADMIN_ACTION',true,'admin','','P1','Close entries'),
  R('POST','admin/tribe-contests/:id/lock','tribe-contests.js','handleTribeContestAdmin','Admin/TribeContests','ADMIN_ACTION',true,'admin','','P1','Lock for judging'),
  R('POST','admin/tribe-contests/:id/resolve','tribe-contests.js','handleTribeContestAdmin','Admin/TribeContests','ADMIN_ACTION',true,'admin','','P1','Resolve contest (admin)'),
  R('POST','admin/tribe-contests/:id/disqualify','tribe-contests.js','handleTribeContestAdmin','Admin/TribeContests','ADMIN_ACTION',true,'admin','','P2','Disqualify entry'),
  R('POST','admin/tribe-contests/:id/judge-score','tribe-contests.js','handleTribeContestAdmin','Admin/TribeContests','ADMIN_ACTION',true,'admin','','P2','Judge score'),
  R('POST','admin/tribe-contests/:id/compute-scores','tribe-contests.js','handleTribeContestAdmin','Admin/TribeContests','ADMIN_ACTION',true,'admin','','P2','Compute scores'),
  R('POST','admin/tribe-contests/:id/recompute-broadcast','tribe-contests.js','handleTribeContestAdmin','Admin/TribeContests','ADMIN_ACTION',true,'admin','','P2','Recompute broadcast'),
  R('POST','admin/tribe-contests/:id/cancel','tribe-contests.js','handleTribeContestAdmin','Admin/TribeContests','ADMIN_ACTION',true,'admin','','P2','Cancel contest'),
  R('POST','admin/tribe-contests/rules','tribe-contests.js','handleTribeContestAdmin','Admin/TribeContests','ADMIN_ACTION',true,'admin','','P2','Set contest rules'),
  R('GET','admin/tribe-contests/dashboard','tribe-contests.js','handleTribeContestAdmin','Admin/TribeContests','ADMIN_ACTION',true,'admin','','P1','Contest dashboard'),

  // === EVENTS (22) ===
  R('POST','events','events.js','handleEvents','Events','JSON_WRITE',true,'none','','P0','Create event'),
  R('GET','events/feed','events.js','handleEvents','Events','JSON_READ',false,'none','','P0','Event feed. Cursor'),
  R('GET','events/search','events.js','handleEvents','Events','JSON_READ',false,'none','','P1','Search events'),
  R('GET','events/college/:collegeId','events.js','handleEvents','Events','JSON_READ',false,'none','','P1','College events'),
  R('GET','events/:id','events.js','handleEvents','Events','JSON_READ',false,'none','','P0','Event detail'),
  R('PATCH','events/:id','events.js','handleEvents','Events','JSON_WRITE',true,'none','','P1','Update event'),
  R('DELETE','events/:id','events.js','handleEvents','Events','JSON_WRITE',true,'none','','P1','Delete event'),
  R('POST','events/:id/publish','events.js','handleEvents','Events','JSON_WRITE',true,'none','','P1','Publish event'),
  R('POST','events/:id/cancel','events.js','handleEvents','Events','JSON_WRITE',true,'none','','P1','Cancel event'),
  R('POST','events/:id/archive','events.js','handleEvents','Events','JSON_WRITE',true,'none','','P2','Archive event'),
  R('POST','events/:id/rsvp','events.js','handleEvents','Events','JSON_WRITE',true,'none','','P0','RSVP'),
  R('DELETE','events/:id/rsvp','events.js','handleEvents','Events','JSON_WRITE',true,'none','','P1','Cancel RSVP'),
  R('GET','events/:id/attendees','events.js','handleEvents','Events','JSON_READ',false,'none','','P1','Attendees'),
  R('POST','events/:id/report','events.js','handleEvents','Events','JSON_WRITE',true,'none','','P1','Report event'),
  R('POST','events/:id/remind','events.js','handleEvents','Events','JSON_WRITE',true,'none','','P2','Set reminder'),
  R('DELETE','events/:id/remind','events.js','handleEvents','Events','JSON_WRITE',true,'none','','P2','Cancel reminder'),
  R('GET','me/events','events.js','handleEvents','Events','JSON_READ',true,'none','','P1','Own events'),
  R('GET','me/events/rsvps','events.js','handleEvents','Events','JSON_READ',true,'none','','P1','Own RSVPs'),
  R('GET','admin/events','events.js','handleEvents','Admin/Events','ADMIN_ACTION',true,'mod','','P2','Admin events queue'),
  R('PATCH','admin/events/:id/moderate','events.js','handleEvents','Admin/Events','ADMIN_ACTION',true,'mod','','P1','Moderate event'),
  R('GET','admin/events/analytics','events.js','handleEvents','Admin/Events','ADMIN_ACTION',true,'mod','','P2','Event analytics'),
  R('POST','admin/events/:id/recompute-counters','events.js','handleEvents','Admin/Events','ADMIN_ACTION',true,'admin','','P2','Recompute counters'),

  // === BOARD NOTICES + AUTHENTICITY (17) ===
  R('POST','board/notices','board-notices.js','handleBoardNotices','BoardNotices','JSON_WRITE',true,'none','','P1','Create notice. Board member'),
  R('GET','board/notices/:id','board-notices.js','handleBoardNotices','BoardNotices','JSON_READ',false,'none','','P1','Notice detail'),
  R('PATCH','board/notices/:id','board-notices.js','handleBoardNotices','BoardNotices','JSON_WRITE',true,'none','','P1','Update notice'),
  R('DELETE','board/notices/:id','board-notices.js','handleBoardNotices','BoardNotices','JSON_WRITE',true,'none','','P1','Delete notice'),
  R('POST','board/notices/:id/pin','board-notices.js','handleBoardNotices','BoardNotices','JSON_WRITE',true,'none','','P2','Pin notice'),
  R('DELETE','board/notices/:id/pin','board-notices.js','handleBoardNotices','BoardNotices','JSON_WRITE',true,'none','','P2','Unpin notice'),
  R('POST','board/notices/:id/acknowledge','board-notices.js','handleBoardNotices','BoardNotices','JSON_WRITE',true,'none','','P1','Acknowledge notice'),
  R('GET','board/notices/:id/acknowledgments','board-notices.js','handleBoardNotices','BoardNotices','JSON_READ',false,'none','','P2','Acknowledgment list'),
  R('GET','colleges/:id/notices','board-notices.js','handleBoardNotices','BoardNotices','JSON_READ',false,'none','','P1','College notices. Cursor'),
  R('GET','me/board/notices','board-notices.js','handleBoardNotices','BoardNotices','JSON_READ',true,'none','','P1','Own board notices'),
  R('GET','moderation/board-notices','board-notices.js','handleBoardNotices','Admin/BoardNotices','ADMIN_ACTION',true,'mod','','P2','Mod queue'),
  R('POST','moderation/board-notices/:id/decide','board-notices.js','handleBoardNotices','Admin/BoardNotices','ADMIN_ACTION',true,'mod','','P2','Moderate notice'),
  R('GET','admin/board-notices/analytics','board-notices.js','handleBoardNotices','Admin/BoardNotices','ADMIN_ACTION',true,'admin','','P2','Notice analytics'),
  R('POST','authenticity/tag','board-notices.js','handleAuthenticityTags','Authenticity','JSON_WRITE',true,'none','','P2','Declare synthetic content'),
  R('GET','authenticity/tags/:type/:id','board-notices.js','handleAuthenticityTags','Authenticity','JSON_READ',false,'none','','P2','Get tags'),
  R('DELETE','authenticity/tags/:id','board-notices.js','handleAuthenticityTags','Authenticity','JSON_WRITE',true,'none','','P2','Remove tag'),
  R('GET','admin/authenticity/stats','board-notices.js','handleAuthenticityTags','Admin/Authenticity','ADMIN_ACTION',true,'admin','','P2','Tag stats'),

  // === REPORTS/APPEALS/NOTIFICATIONS/LEGAL/GRIEVANCES (14) ===
  R('POST','reports','admin.js','handleAdmin','Reports','JSON_WRITE',true,'none','','P0','Report content/user'),
  R('GET','moderation/queue','admin.js','handleAdmin','Moderation','ADMIN_ACTION',true,'mod','','P1','Mod queue'),
  R('POST','moderation/:contentId/action','admin.js','handleAdmin','Moderation','ADMIN_ACTION',true,'mod','','P1','Mod action'),
  R('POST','appeals','admin.js','handleAdmin','Appeals','JSON_WRITE',true,'none','','P1','Create appeal'),
  R('GET','appeals','admin.js','handleAdmin','Appeals','JSON_READ',true,'none','','P1','Own appeals'),
  R('PATCH','appeals/:id/decide','stages.js','handleAppealDecision','Admin/Appeals','ADMIN_ACTION',true,'mod','','P1','Decide appeal. Also POST'),
  R('GET','notifications','admin.js','handleAdmin','Notifications','JSON_READ',true,'none','','P0','User notifications. Cursor'),
  R('PATCH','notifications/read','admin.js','handleAdmin','Notifications','JSON_WRITE',true,'none','','P0','Mark read'),
  R('GET','legal/consent','admin.js','handleAdmin','Legal','JSON_READ',false,'none','','P0','Consent notice'),
  R('POST','legal/accept','admin.js','handleAdmin','Legal','JSON_WRITE',true,'none','','P0','Accept consent'),
  R('POST','grievances','admin.js','handleAdmin','Grievances','JSON_WRITE',true,'none','','P1','Create grievance'),
  R('GET','grievances','admin.js','handleAdmin','Grievances','JSON_READ',true,'none','','P1','Own grievances'),
  R('POST','admin/colleges/seed','admin.js','handleAdmin','Admin','ADMIN_ACTION',true,'admin','','P2','Seed colleges'),
  R('GET','admin/stats','admin.js','handleAdmin','Admin','ADMIN_ACTION',true,'admin','','P1','Platform stats'),

  // === COLLEGE CLAIMS (7) ===
  R('POST','colleges/:collegeId/claim','stages.js','handleCollegeClaims','CollegeClaims','JSON_WRITE',true,'none','','P0','Submit claim'),
  R('GET','me/college-claims','stages.js','handleCollegeClaims','CollegeClaims','JSON_READ',true,'none','','P1','Own claims'),
  R('DELETE','me/college-claims/:id','stages.js','handleCollegeClaims','CollegeClaims','JSON_WRITE',true,'none','','P1','Withdraw claim'),
  R('GET','admin/college-claims','stages.js','handleCollegeClaims','Admin/CollegeClaims','ADMIN_ACTION',true,'mod','','P1','Admin claim queue'),
  R('GET','admin/college-claims/:id','stages.js','handleCollegeClaims','Admin/CollegeClaims','ADMIN_ACTION',true,'mod','','P1','Claim detail'),
  R('PATCH','admin/college-claims/:id/flag-fraud','stages.js','handleCollegeClaims','Admin/CollegeClaims','ADMIN_ACTION',true,'mod','','P2','Flag fraud. Also POST'),
  R('PATCH','admin/college-claims/:id/decide','stages.js','handleCollegeClaims','Admin/CollegeClaims','ADMIN_ACTION',true,'mod','','P1','Decide claim. Also POST'),

  // === DISTRIBUTION (7) ===
  R('POST','admin/distribution/evaluate','stages.js','handleDistribution','Admin/Distribution','ADMIN_ACTION',true,'admin','','P1','Batch evaluate. Also GET'),
  R('POST','admin/distribution/evaluate/:contentId','stages.js','handleDistribution','Admin/Distribution','ADMIN_ACTION',true,'mod','','P2','Single evaluate. Also GET'),
  R('GET','admin/distribution/config','stages.js','handleDistribution','Admin/Distribution','ADMIN_ACTION',true,'mod','','P2','View rules'),
  R('POST','admin/distribution/kill-switch','stages.js','handleDistribution','Admin/Distribution','ADMIN_ACTION',true,'admin','','P1','Toggle auto-eval'),
  R('GET','admin/distribution/inspect/:contentId','stages.js','handleDistribution','Admin/Distribution','ADMIN_ACTION',true,'mod','','P2','Distribution detail'),
  R('POST','admin/distribution/override','stages.js','handleDistribution','Admin/Distribution','ADMIN_ACTION',true,'mod','','P1','Manual override'),
  R('DELETE','admin/distribution/override/:contentId','stages.js','handleDistribution','Admin/Distribution','ADMIN_ACTION',true,'admin','','P2','Remove override'),

  // === RESOURCES (14) ===
  R('POST','resources','stages.js','handleResources','Resources','JSON_WRITE',true,'none','','P0','Create resource'),
  R('GET','resources/search','stages.js','handleResources','Resources','JSON_READ',false,'none','','P0','Search resources. Faceted'),
  R('GET','resources/:id','stages.js','handleResources','Resources','JSON_READ',false,'none','','P0','Resource detail'),
  R('PATCH','resources/:id','stages.js','handleResources','Resources','JSON_WRITE',true,'none','','P1','Update resource'),
  R('DELETE','resources/:id','stages.js','handleResources','Resources','JSON_WRITE',true,'none','','P1','Delete resource'),
  R('POST','resources/:id/report','stages.js','handleResources','Resources','JSON_WRITE',true,'none','','P1','Report resource'),
  R('POST','resources/:id/vote','stages.js','handleResources','Resources','JSON_WRITE',true,'none','','P1','Vote UP/DOWN'),
  R('DELETE','resources/:id/vote','stages.js','handleResources','Resources','JSON_WRITE',true,'none','','P1','Remove vote'),
  R('POST','resources/:id/download','stages.js','handleResources','Resources','JSON_WRITE',false,'none','','P1','Record download'),
  R('GET','me/resources','stages.js','handleResources','Resources','JSON_READ',true,'none','','P1','Own resources'),
  R('GET','admin/resources','stages.js','handleResources','Admin/Resources','ADMIN_ACTION',true,'mod','','P2','Admin resource queue'),
  R('PATCH','admin/resources/:id/moderate','stages.js','handleResources','Admin/Resources','ADMIN_ACTION',true,'mod','','P2','Moderate resource'),
  R('POST','admin/resources/:id/recompute-counters','stages.js','handleResources','Admin/Resources','ADMIN_ACTION',true,'admin','','P2','Recompute counters'),
  R('POST','admin/resources/reconcile','stages.js','handleResources','Admin/Resources','ADMIN_ACTION',true,'admin','','P2','Reconcile all counters'),

  // === GOVERNANCE (8) ===
  R('GET','governance/college/:collegeId/board','governance.js','handleGovernance','Governance','JSON_READ',false,'none','','P1','College board'),
  R('POST','governance/college/:collegeId/apply','governance.js','handleGovernance','Governance','JSON_WRITE',true,'none','','P1','Apply for board'),
  R('GET','governance/college/:collegeId/applications','governance.js','handleGovernance','Governance','JSON_READ',false,'none','','P1','Board applications'),
  R('POST','governance/applications/:appId/vote','governance.js','handleGovernance','Governance','JSON_WRITE',true,'none','','P1','Vote on application'),
  R('POST','governance/college/:collegeId/proposals','governance.js','handleGovernance','Governance','JSON_WRITE',true,'none','','P1','Create proposal'),
  R('GET','governance/college/:collegeId/proposals','governance.js','handleGovernance','Governance','JSON_READ',false,'none','','P1','List proposals'),
  R('POST','governance/proposals/:proposalId/vote','governance.js','handleGovernance','Governance','JSON_WRITE',true,'none','','P1','Vote on proposal'),
  R('POST','governance/college/:collegeId/seed-board','governance.js','handleGovernance','Admin/Governance','ADMIN_ACTION',true,'admin','','P2','Seed board. ADMIN'),

  // === TRIBE CONTEST ADMIN extra (1) ===
  R('POST','admin/tribe-salutes/adjust','tribe-contests.js','handleTribeContestAdmin','Admin/TribeContests','ADMIN_ACTION',true,'admin','','P2','Adjust salutes (contest admin)'),
]

const meta = {
  generated_at: new Date().toISOString(),
  total_routes: routes.length,
  by_method: {},
  by_domain: {},
  by_auth: { public: 0, authenticated: 0, admin_mod: 0 },
  by_type: {},
  by_criticality: {},
  handler_files: 18,
  active_handler_files: 16,
  dead_handler_files: 1,
}

for (const r of routes) {
  meta.by_method[r.method] = (meta.by_method[r.method] || 0) + 1
  meta.by_domain[r.domain] = (meta.by_domain[r.domain] || 0) + 1
  meta.by_type[r.route_type] = (meta.by_type[r.route_type] || 0) + 1
  meta.by_criticality[r.business_criticality] = (meta.by_criticality[r.business_criticality] || 0) + 1
  if (!r.auth_present) meta.by_auth.public++
  else if (r.role_guard === 'admin' || r.role_guard === 'mod') meta.by_auth.admin_mod++
  else meta.by_auth.authenticated++
}

fs.writeFileSync('/app/memory/contracts/route_inventory_raw.json', JSON.stringify({ meta, routes }, null, 2))
console.log('Total routes: ' + routes.length)
console.log('By method:', JSON.stringify(meta.by_method))
console.log('By auth:', JSON.stringify(meta.by_auth))
console.log('By criticality:', JSON.stringify(meta.by_criticality))
