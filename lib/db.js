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
      db.collection('stories').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { archived: true, status: 'EXPIRED' } }),

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
    ])
  } catch {
    // Indexes may already exist with different options — safe to ignore on startup
  }
}
