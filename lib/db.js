import { MongoClient } from 'mongodb'

let client = null
let db = null
let initialized = false

export async function getDb() {
  if (!client) {
    client = new MongoClient(process.env.MONGO_URL)
    await client.connect()
    db = client.db(process.env.DB_NAME)
  }
  if (!initialized) {
    await ensureIndexes(db)
    initialized = true
  }
  return db
}

async function ensureIndexes(db) {
  try {
    // Drop problematic legacy indexes
    try { await db.collection('users').dropIndex('username_1') } catch {}
    // Drop old TTL index for stories (had overly restrictive partial filter)
    try { await db.collection('stories').dropIndex('expiresAt_ttl_cleanup') } catch {}
    try { await db.collection('stories').dropIndex('expiresAt_1') } catch {}

    await Promise.all([
      // === USERS ===
      db.collection('users').createIndex({ id: 1 }, { unique: true }),
      db.collection('users').createIndex({ phone: 1 }, { unique: true }),
      db.collection('users').createIndex({ username: 1 }, { unique: true, partialFilterExpression: { username: { $type: 'string' } } }),
      db.collection('users').createIndex({ collegeId: 1, followersCount: -1 }),
      db.collection('users').createIndex({ houseId: 1 }),
      db.collection('users').createIndex({ role: 1 }),
      db.collection('users').createIndex({ displayName: 'text', username: 'text' }),
      db.collection('users').createIndex({ createdAt: -1 }),

      // === SESSIONS (TTL) ===
      db.collection('sessions').createIndex({ token: 1 }, { unique: true }),
      db.collection('sessions').createIndex({ userId: 1 }),
      db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),

      // === HOUSES ===
      db.collection('houses').createIndex({ id: 1 }, { unique: true }),
      db.collection('houses').createIndex({ slug: 1 }, { unique: true }),

      // === HOUSE LEDGER ===
      db.collection('house_ledger').createIndex({ houseId: 1, createdAt: -1 }),
      db.collection('house_ledger').createIndex({ userId: 1, createdAt: -1 }),

      // === COLLEGES ===
      db.collection('colleges').createIndex({ id: 1 }, { unique: true }),
      db.collection('colleges').createIndex({ normalizedName: 1 }),
      db.collection('colleges').createIndex({ state: 1, type: 1 }),
      db.collection('colleges').createIndex({ aisheCode: 1 }, { sparse: true }),
      db.collection('colleges').createIndex({ membersCount: -1 }),

      // === CONTENT ITEMS (Posts, Reels, Stories) ===
      db.collection('content_items').createIndex({ id: 1 }, { unique: true }),
      db.collection('content_items').createIndex({ authorId: 1, createdAt: -1 }),
      db.collection('content_items').createIndex({ kind: 1, visibility: 1, createdAt: -1 }),
      db.collection('content_items').createIndex({ collegeId: 1, kind: 1, visibility: 1, createdAt: -1 }),
      db.collection('content_items').createIndex({ houseId: 1, kind: 1, visibility: 1, createdAt: -1 }),
      db.collection('content_items').createIndex({ kind: 1, visibility: 1, distributionStage: 1, createdAt: -1 }),
      db.collection('content_items').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { kind: 'STORY' } }),

      // === FOLLOWS ===
      db.collection('follows').createIndex({ followerId: 1, followeeId: 1 }, { unique: true }),
      db.collection('follows').createIndex({ followeeId: 1, createdAt: -1 }),
      db.collection('follows').createIndex({ followerId: 1, createdAt: -1 }),

      // === REACTIONS ===
      db.collection('reactions').createIndex({ userId: 1, contentId: 1 }, { unique: true }),
      db.collection('reactions').createIndex({ contentId: 1, type: 1 }),

      // === SAVES ===
      db.collection('saves').createIndex({ userId: 1, contentId: 1 }, { unique: true }),
      db.collection('saves').createIndex({ userId: 1, createdAt: -1 }),

      // === COMMENTS ===
      db.collection('comments').createIndex({ id: 1 }, { unique: true }),
      db.collection('comments').createIndex({ contentId: 1, createdAt: -1 }),
      db.collection('comments').createIndex({ authorId: 1, createdAt: -1 }),
      db.collection('comments').createIndex({ parentId: 1 }, { sparse: true }),

      // === REPORTS ===
      db.collection('reports').createIndex({ id: 1 }, { unique: true }),
      db.collection('reports').createIndex({ status: 1, createdAt: -1 }),
      db.collection('reports').createIndex({ targetId: 1, targetType: 1 }),
      db.collection('reports').createIndex({ reporterId: 1 }),

      // === MODERATION EVENTS (immutable audit) ===
      db.collection('moderation_events').createIndex({ id: 1 }, { unique: true }),
      db.collection('moderation_events').createIndex({ targetId: 1, createdAt: -1 }),
      db.collection('moderation_events').createIndex({ actorId: 1, createdAt: -1 }),

      // === STRIKES ===
      db.collection('strikes').createIndex({ userId: 1, createdAt: -1 }),
      db.collection('strikes').createIndex({ contentId: 1 }),

      // === SUSPENSIONS ===
      db.collection('suspensions').createIndex({ userId: 1, endAt: -1 }),

      // === APPEALS ===
      db.collection('appeals').createIndex({ id: 1 }, { unique: true }),
      db.collection('appeals').createIndex({ userId: 1, createdAt: -1 }),
      db.collection('appeals').createIndex({ status: 1, createdAt: -1 }),

      // === GRIEVANCE TICKETS ===
      db.collection('grievance_tickets').createIndex({ id: 1 }, { unique: true }),
      db.collection('grievance_tickets').createIndex({ status: 1, dueAt: 1 }),
      db.collection('grievance_tickets').createIndex({ userId: 1 }),

      // === NOTIFICATIONS ===
      db.collection('notifications').createIndex({ userId: 1, createdAt: -1 }),
      db.collection('notifications').createIndex({ userId: 1, read: 1 }),

      // === MEDIA ASSETS ===
      db.collection('media_assets').createIndex({ id: 1 }, { unique: true }),
      db.collection('media_assets').createIndex({ ownerId: 1, createdAt: -1 }),

      // === AUDIT LOGS ===
      db.collection('audit_logs').createIndex({ createdAt: -1 }),
      db.collection('audit_logs').createIndex({ actorId: 1, createdAt: -1 }),
      db.collection('audit_logs').createIndex({ targetType: 1, targetId: 1 }),

      // === CONSENT ===
      db.collection('consent_notices').createIndex({ active: 1 }),
      db.collection('consent_acceptances').createIndex({ userId: 1, noticeVersion: 1 }),

      // === FEATURE FLAGS ===
      db.collection('feature_flags').createIndex({ key: 1 }, { unique: true }),

      // ═══════════════════════════════════════════════════
      // STAGE 9 — Stories
      // ═══════════════════════════════════════════════════

      // === STORIES ===
      db.collection('stories').createIndex({ id: 1 }, { unique: true }),
      db.collection('stories').createIndex({ authorId: 1, status: 1, expiresAt: -1 }),
      db.collection('stories').createIndex({ status: 1, expiresAt: 1 }),
      db.collection('stories').createIndex({ authorId: 1, createdAt: -1 }),
      db.collection('stories').createIndex({ collegeId: 1, status: 1, createdAt: -1 }),
      // TTL: auto-delete EXPIRED stories 30 days after their expiresAt date
      db.collection('stories').createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 2592000, partialFilterExpression: { status: 'EXPIRED' } }
      ),

      // === STORY VIEWS ===
      db.collection('story_views').createIndex({ storyId: 1, viewerId: 1 }, { unique: true }),
      db.collection('story_views').createIndex({ storyId: 1, viewedAt: -1 }),
      db.collection('story_views').createIndex({ viewerId: 1, viewedAt: -1 }),
      db.collection('story_views').createIndex({ authorId: 1, viewedAt: -1 }),

      // === STORY REACTIONS ===
      db.collection('story_reactions').createIndex({ storyId: 1, userId: 1 }, { unique: true }),
      db.collection('story_reactions').createIndex({ storyId: 1, createdAt: -1 }),
      db.collection('story_reactions').createIndex({ authorId: 1, createdAt: -1 }),

      // === STORY STICKER RESPONSES ===
      db.collection('story_sticker_responses').createIndex({ storyId: 1, stickerId: 1, userId: 1 }, { unique: true }),
      db.collection('story_sticker_responses').createIndex({ storyId: 1, stickerId: 1, createdAt: -1 }),
      db.collection('story_sticker_responses').createIndex({ authorId: 1, stickerType: 1, createdAt: -1 }),

      // === STORY REPLIES ===
      db.collection('story_replies').createIndex({ id: 1 }, { unique: true }),
      db.collection('story_replies').createIndex({ storyId: 1, createdAt: -1 }),
      db.collection('story_replies').createIndex({ authorId: 1, createdAt: -1 }),
      db.collection('story_replies').createIndex({ senderId: 1, createdAt: -1 }),

      // === STORY HIGHLIGHTS ===
      db.collection('story_highlights').createIndex({ id: 1 }, { unique: true }),
      db.collection('story_highlights').createIndex({ userId: 1, createdAt: -1 }),

      // === STORY HIGHLIGHT ITEMS ===
      db.collection('story_highlight_items').createIndex({ highlightId: 1, storyId: 1 }, { unique: true }),
      db.collection('story_highlight_items').createIndex({ highlightId: 1, order: 1 }),

      // === CLOSE FRIENDS ===
      db.collection('close_friends').createIndex({ userId: 1, friendId: 1 }, { unique: true }),
      db.collection('close_friends').createIndex({ userId: 1, addedAt: -1 }),
      db.collection('close_friends').createIndex({ friendId: 1 }),

      // === STORY SETTINGS ===
      db.collection('story_settings').createIndex({ userId: 1 }, { unique: true }),

      // === BLOCKS ===
      db.collection('blocks').createIndex({ blockerId: 1, blockedId: 1 }, { unique: true }),
      db.collection('blocks').createIndex({ blockedId: 1, blockerId: 1 }),
      db.collection('blocks').createIndex({ blockerId: 1, createdAt: -1 }),

      // ============================================================
      // STAGE 10: REELS — 36 indexes across 12 collections
      // ============================================================

      // === REELS ===
      db.collection('reels').createIndex({ id: 1 }, { unique: true }),
      db.collection('reels').createIndex({ creatorId: 1, status: 1, publishedAt: -1 }),
      db.collection('reels').createIndex({ status: 1, moderationStatus: 1, mediaStatus: 1, visibility: 1, score: -1 }),
      db.collection('reels').createIndex({ collegeId: 1, status: 1, publishedAt: -1 }),
      db.collection('reels').createIndex({ mediaStatus: 1, createdAt: 1 }),
      db.collection('reels').createIndex({ 'audioMeta.audioId': 1, publishedAt: -1 }),
      db.collection('reels').createIndex({ 'remixOf.reelId': 1, publishedAt: -1 }),
      db.collection('reels').createIndex({ seriesId: 1, seriesOrder: 1 }),
      db.collection('reels').createIndex({ creatorId: 1, pinnedToProfile: -1, publishedAt: -1 }),

      // === REEL LIKES ===
      db.collection('reel_likes').createIndex({ reelId: 1, userId: 1 }, { unique: true }),
      db.collection('reel_likes').createIndex({ reelId: 1, createdAt: -1 }),
      db.collection('reel_likes').createIndex({ userId: 1, createdAt: -1 }),
      db.collection('reel_likes').createIndex({ creatorId: 1, createdAt: -1 }),

      // === REEL SAVES ===
      db.collection('reel_saves').createIndex({ reelId: 1, userId: 1 }, { unique: true }),
      db.collection('reel_saves').createIndex({ userId: 1, createdAt: -1 }),
      db.collection('reel_saves').createIndex({ creatorId: 1, createdAt: -1 }),

      // === REEL COMMENTS ===
      db.collection('reel_comments').createIndex({ id: 1 }, { unique: true }),
      db.collection('reel_comments').createIndex({ reelId: 1, parentId: 1, createdAt: -1 }),
      db.collection('reel_comments').createIndex({ senderId: 1, createdAt: -1 }),
      db.collection('reel_comments').createIndex({ creatorId: 1, createdAt: -1 }),

      // === REEL VIEWS ===
      db.collection('reel_views').createIndex({ reelId: 1, viewerId: 1 }, { unique: true }),
      db.collection('reel_views').createIndex({ reelId: 1, viewedAt: -1 }),
      db.collection('reel_views').createIndex({ viewerId: 1, viewedAt: -1 }),
      db.collection('reel_views').createIndex({ creatorId: 1, viewedAt: -1 }),

      // === REEL WATCH EVENTS ===
      db.collection('reel_watch_events').createIndex({ reelId: 1, userId: 1, createdAt: -1 }),
      db.collection('reel_watch_events').createIndex({ reelId: 1, createdAt: -1 }),

      // === REEL REPORTS ===
      db.collection('reel_reports').createIndex({ reelId: 1, reporterId: 1 }, { unique: true }),
      db.collection('reel_reports').createIndex({ reelId: 1, createdAt: -1 }),

      // === REEL HIDDEN ===
      db.collection('reel_hidden').createIndex({ userId: 1, reelId: 1 }, { unique: true }),
      db.collection('reel_hidden').createIndex({ userId: 1, createdAt: -1 }),

      // === REEL NOT INTERESTED ===
      db.collection('reel_not_interested').createIndex({ userId: 1, reelId: 1 }, { unique: true }),
      db.collection('reel_not_interested').createIndex({ userId: 1, createdAt: -1 }),

      // === REEL SHARES ===
      db.collection('reel_shares').createIndex({ reelId: 1, createdAt: -1 }),
      db.collection('reel_shares').createIndex({ reelId: 1, userId: 1, createdAt: -1 }),

      // === REEL PROCESSING JOBS ===
      db.collection('reel_processing_jobs').createIndex({ reelId: 1 }, { unique: true }),
      db.collection('reel_processing_jobs').createIndex({ status: 1, createdAt: 1 }),

      // === REEL SERIES ===
      db.collection('reel_series').createIndex({ id: 1 }, { unique: true }),
      db.collection('reel_series').createIndex({ creatorId: 1, createdAt: -1 }),

      // ============================================================
      // STAGE 6: EVENTS — 16 indexes across 4 collections
      // ============================================================

      // === EVENTS ===
      db.collection('events').createIndex({ id: 1 }, { unique: true }),
      db.collection('events').createIndex({ creatorId: 1, status: 1, startAt: -1 }),
      db.collection('events').createIndex({ status: 1, visibility: 1, score: -1, startAt: 1 }),
      db.collection('events').createIndex({ collegeId: 1, status: 1, startAt: 1 }),
      db.collection('events').createIndex({ category: 1, status: 1, startAt: 1 }),
      db.collection('events').createIndex({ status: 1, startAt: 1 }),
      db.collection('events').createIndex({ creatorId: 1, createdAt: -1 }),

      // === EVENT RSVPS ===
      db.collection('event_rsvps').createIndex({ eventId: 1, userId: 1 }, { unique: true }),
      db.collection('event_rsvps').createIndex({ eventId: 1, status: 1, createdAt: -1 }),
      db.collection('event_rsvps').createIndex({ userId: 1, status: 1, createdAt: -1 }),
      db.collection('event_rsvps').createIndex({ creatorId: 1, createdAt: -1 }),

      // === EVENT REPORTS ===
      db.collection('event_reports').createIndex({ eventId: 1, reporterId: 1 }, { unique: true }),
      db.collection('event_reports').createIndex({ eventId: 1, createdAt: -1 }),

      // === EVENT REMINDERS ===
      db.collection('event_reminders').createIndex({ eventId: 1, userId: 1 }, { unique: true }),
      db.collection('event_reminders').createIndex({ userId: 1, createdAt: -1 }),
      db.collection('event_reminders').createIndex({ remindAt: 1 }),

      // ============================================================
      // STAGE 7: BOARD NOTICES + AUTHENTICITY — 16 indexes across 4 collections
      // ============================================================

      // === BOARD NOTICES ===
      db.collection('board_notices').createIndex({ id: 1 }, { unique: true }),
      db.collection('board_notices').createIndex({ collegeId: 1, status: 1, pinnedToBoard: -1, publishedAt: -1 }),
      db.collection('board_notices').createIndex({ creatorId: 1, status: 1, createdAt: -1 }),
      db.collection('board_notices').createIndex({ status: 1, createdAt: 1 }),
      db.collection('board_notices').createIndex({ collegeId: 1, category: 1, status: 1 }),
      db.collection('board_notices').createIndex({ expiresAt: 1 }),

      // === BOARD SEATS ===
      db.collection('board_seats').createIndex({ id: 1 }, { unique: true }),
      db.collection('board_seats').createIndex({ collegeId: 1, status: 1 }),
      db.collection('board_seats').createIndex({ userId: 1, status: 1 }),

      // === AUTHENTICITY TAGS ===
      db.collection('authenticity_tags').createIndex({ id: 1 }, { unique: true }),
      db.collection('authenticity_tags').createIndex({ targetType: 1, targetId: 1, actorId: 1 }, { unique: true }),
      db.collection('authenticity_tags').createIndex({ targetType: 1, targetId: 1, tag: 1 }),
      db.collection('authenticity_tags').createIndex({ actorId: 1, createdAt: -1 }),

      // === NOTICE ACKNOWLEDGMENTS ===
      db.collection('notice_acknowledgments').createIndex({ noticeId: 1, userId: 1 }, { unique: true }),
      db.collection('notice_acknowledgments').createIndex({ noticeId: 1, createdAt: -1 }),
      db.collection('notice_acknowledgments').createIndex({ userId: 1, createdAt: -1 }),

      // ============================================================
      // STAGE 12: TRIBE SYSTEM — 30+ indexes across 14 collections
      // ============================================================

      // === TRIBES ===
      db.collection('tribes').createIndex({ id: 1 }, { unique: true }),
      db.collection('tribes').createIndex({ tribeCode: 1 }, { unique: true }),
      db.collection('tribes').createIndex({ sortOrder: 1 }),
      db.collection('tribes').createIndex({ isActive: 1, totalSalutes: -1 }),

      // === USER TRIBE MEMBERSHIPS ===
      db.collection('user_tribe_memberships').createIndex({ userId: 1, isPrimary: 1 }, { unique: true }),
      db.collection('user_tribe_memberships').createIndex({ tribeId: 1, isPrimary: 1, status: 1, assignedAt: -1 }),
      db.collection('user_tribe_memberships').createIndex({ tribeId: 1, status: 1 }),
      db.collection('user_tribe_memberships').createIndex({ migrationSource: 1 }),

      // === TRIBE ASSIGNMENT EVENTS ===
      db.collection('tribe_assignment_events').createIndex({ userId: 1, createdAt: -1 }),
      db.collection('tribe_assignment_events').createIndex({ tribeId: 1, action: 1, createdAt: -1 }),

      // === TRIBE BOARDS ===
      db.collection('tribe_boards').createIndex({ tribeId: 1, status: 1 }),

      // === TRIBE BOARD MEMBERS ===
      db.collection('tribe_board_members').createIndex({ boardId: 1, status: 1 }),
      db.collection('tribe_board_members').createIndex({ tribeId: 1, userId: 1 }),

      // === TRIBE SEASONS ===
      db.collection('tribe_seasons').createIndex({ id: 1 }, { unique: true }),
      db.collection('tribe_seasons').createIndex({ status: 1, year: -1 }),

      // === TRIBE CONTESTS ===
      db.collection('tribe_contests').createIndex({ id: 1 }, { unique: true }),
      db.collection('tribe_contests').createIndex({ seasonId: 1, status: 1, createdAt: -1 }),

      // === TRIBE SALUTE LEDGER ===
      db.collection('tribe_salute_ledger').createIndex({ tribeId: 1, createdAt: -1 }),
      db.collection('tribe_salute_ledger').createIndex({ seasonId: 1, tribeId: 1, createdAt: -1 }),
      db.collection('tribe_salute_ledger').createIndex({ contestId: 1 }),
      db.collection('tribe_salute_ledger').createIndex({ reversalOf: 1 }),

      // === TRIBE STANDINGS ===
      db.collection('tribe_standings').createIndex({ seasonId: 1, tribeId: 1 }, { unique: true }),
      db.collection('tribe_standings').createIndex({ seasonId: 1, totalSalutes: -1 }),

      // === TRIBE AWARDS ===
      db.collection('tribe_awards').createIndex({ seasonId: 1 }, { unique: true }),
      db.collection('tribe_awards').createIndex({ year: -1 }),

      // === TRIBE FUND ACCOUNTS ===
      db.collection('tribe_fund_accounts').createIndex({ tribeId: 1 }, { unique: true }),

      // === TRIBE FUND LEDGER ===
      db.collection('tribe_fund_ledger').createIndex({ tribeId: 1, createdAt: -1 }),
      db.collection('tribe_fund_ledger').createIndex({ seasonId: 1 }),
    ])
  } catch {
    // Indexes may already exist with different options — safe to ignore on startup
  }
}
