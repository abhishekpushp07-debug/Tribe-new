import { MongoClient, ReadPreference } from 'mongodb'
import { autoSeed } from './seed.js'
import { v4 as uuidv4 } from 'uuid'

// Ensure page tribe inheritance — fix mismatches on startup
async function ensurePageTribeInheritance(db) {
  try {
    const pages = await db.collection('pages').find({ status: 'ACTIVE' }, { projection: { _id: 0, id: 1, ownerId: 1, tribeId: 1 } }).toArray()
    let fixed = 0
    for (const page of pages) {
      const owner = await db.collection('users').findOne({ id: page.ownerId }, { projection: { _id: 0, tribeId: 1, tribeCode: 1, tribeName: 1 } })
      if (owner && owner.tribeId && page.tribeId !== owner.tribeId) {
        await db.collection('pages').updateOne({ id: page.id }, { $set: { tribeId: owner.tribeId, tribeCode: owner.tribeCode, tribeName: owner.tribeName } })
        fixed++
      }
    }
    if (fixed > 0) console.log(`[PAGE-TRIBE] Fixed ${fixed} page tribe mismatches`)
  } catch (e) {
    console.log('[PAGE-TRIBE] Check error (non-fatal):', e.message)
  }
}

// Ensure music library is populated
async function ensureMusicLibrary(db) {
  try {
    const count = await db.collection('music_library').countDocuments()
    if (count >= 20) return
    
    const tracks = [
      { category:'trending', title:'Summer Vibes', artist:'Tribe Audio', durationMs:30000, bpm:120, audioUrl:'https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/posts/93f1da1b-3ecd-410c-b203-bb75df49820c/67a45edd-ecc2-43ed-a596-548f0b0cf8bb.mp4' },
      { category:'trending', title:'Neon Nights', artist:'Tribe Audio', durationMs:25000, bpm:128, audioUrl:'https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/posts/93f1da1b-3ecd-410c-b203-bb75df49820c/f0548aaa-62fb-475d-b287-e67147b1d6f0.mp4' },
      { category:'trending', title:'Golden Hour', artist:'Tribe Beats', durationMs:35000, bpm:110, audioUrl:'https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/posts/93f1da1b-3ecd-410c-b203-bb75df49820c/553474ff-db42-4481-83d2-886399b32af4.mp4' },
      { category:'chill', title:'Morning Coffee', artist:'LoFi Tribe', durationMs:40000, bpm:85, audioUrl:'https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/posts/93f1da1b-3ecd-410c-b203-bb75df49820c/88dae6bf-f42a-4c12-aeec-404c754fe582.mp4' },
      { category:'chill', title:'Rainy Day', artist:'LoFi Tribe', durationMs:32000, bpm:80, audioUrl:'https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/posts/93f1da1b-3ecd-410c-b203-bb75df49820c/04ab2d5c-0246-4964-b484-c9f58ff5d2f7.mp4' },
      { category:'chill', title:'Sunset Drive', artist:'Chill Lab', durationMs:28000, bpm:90, audioUrl:'https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/posts/93f1da1b-3ecd-410c-b203-bb75df49820c/14e74eac-d406-4d55-88e8-8d685e479cd7.mp4' },
      { category:'energetic', title:'Pump It Up', artist:'Tribe Beats', durationMs:20000, bpm:140, audioUrl:'https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/posts/93f1da1b-3ecd-410c-b203-bb75df49820c/5eec90e1-40aa-4866-b2ce-3ba791b47f4c.mp4' },
      { category:'energetic', title:'Game On', artist:'Bass Nation', durationMs:22000, bpm:150, audioUrl:'https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/posts/93f1da1b-3ecd-410c-b203-bb75df49820c/17ba25c2-c5e7-4f42-8bef-716c7eebf23b.mp4' },
      { category:'energetic', title:'Unstoppable', artist:'Tribe Beats', durationMs:25000, bpm:145, audioUrl:'https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/posts/93f1da1b-3ecd-410c-b203-bb75df49820c/1393dd03-e3ab-4762-a51c-9e3329ed3c70.mp4' },
      { category:'happy', title:'Feel Good', artist:'Sunny Sounds', durationMs:30000, bpm:115, audioUrl:'https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/posts/93f1da1b-3ecd-410c-b203-bb75df49820c/04fd2cef-3f4a-4c01-9200-6256c4262b3b.mp4' },
      { category:'happy', title:'Party Time', artist:'Sunny Sounds', durationMs:28000, bpm:125, audioUrl:'https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/posts/93f1da1b-3ecd-410c-b203-bb75df49820c/52200068-f421-4a85-896f-e01be014fefa.mp4' },
      { category:'happy', title:'Celebrate', artist:'Tribe Audio', durationMs:33000, bpm:118, audioUrl:'https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/posts/93f1da1b-3ecd-410c-b203-bb75df49820c/9f51eabd-7788-41da-a287-ad508e16fd9c.mp4' },
      { category:'sad', title:'Memories', artist:'Piano Tales', durationMs:35000, bpm:70, audioUrl:'https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/posts/93f1da1b-3ecd-410c-b203-bb75df49820c/258b5aaa-557e-41e4-9f1f-1c425ed7ae4a.mp4' },
      { category:'sad', title:'Letting Go', artist:'Piano Tales', durationMs:40000, bpm:65, audioUrl:'https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/posts/93f1da1b-3ecd-410c-b203-bb75df49820c/8a18e20d-aad5-476c-8716-6cdfa8dc5889.mp4' },
      { category:'epic', title:'Rise Up', artist:'Cinematic Lab', durationMs:30000, bpm:100, audioUrl:'https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/posts/93f1da1b-3ecd-410c-b203-bb75df49820c/3cc71869-c2c0-4a33-bbed-657183c8a6b2.mp4' },
      { category:'epic', title:'The Journey', artist:'Cinematic Lab', durationMs:45000, bpm:95, audioUrl:'https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/posts/93f1da1b-3ecd-410c-b203-bb75df49820c/ab8d03e8-5255-4540-8261-fe4f3870ecf1.mp4' },
      { category:'lofi', title:'Study Session', artist:'LoFi Tribe', durationMs:50000, bpm:75, audioUrl:'https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/posts/93f1da1b-3ecd-410c-b203-bb75df49820c/d14a254c-e118-4516-9dc2-8569c742904d.mp4' },
      { category:'lofi', title:'Late Night Code', artist:'LoFi Tribe', durationMs:45000, bpm:78, audioUrl:'https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/posts/93f1da1b-3ecd-410c-b203-bb75df49820c/ac2ca162-1090-4727-9378-d19a86badae5.mp4' },
      { category:'pop', title:'Catch My Vibe', artist:'Pop Central', durationMs:28000, bpm:120, audioUrl:'https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/posts/93f1da1b-3ecd-410c-b203-bb75df49820c/5835565c-6e2d-48d2-900a-efbfffe12310.mp4' },
      { category:'pop', title:'On My Way', artist:'Pop Central', durationMs:25000, bpm:115, audioUrl:'https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/posts/93f1da1b-3ecd-410c-b203-bb75df49820c/db9aa71f-dca4-4af1-9c23-a2ec07eafc68.mp4' },
      { category:'hiphop', title:'Street Flow', artist:'Beat Factory', durationMs:30000, bpm:90, audioUrl:'https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/posts/93f1da1b-3ecd-410c-b203-bb75df49820c/2dd543a0-d5c8-45eb-adf9-a8ae0442e8ed.mp4' },
      { category:'hiphop', title:'Real Talk', artist:'Beat Factory', durationMs:35000, bpm:95, audioUrl:'https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/posts/93f1da1b-3ecd-410c-b203-bb75df49820c/9dcec46a-f4c2-4691-b157-81e43d193d89.mp4' },
      { category:'electronic', title:'Digital Dreams', artist:'Synth Wave', durationMs:32000, bpm:130, audioUrl:'https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/posts/93f1da1b-3ecd-410c-b203-bb75df49820c/fdd1c353-2b35-4e4a-9704-e8d1fae63a1f.mp4' },
      { category:'electronic', title:'Neon Pulse', artist:'Synth Wave', durationMs:28000, bpm:135, audioUrl:'https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/posts/93f1da1b-3ecd-410c-b203-bb75df49820c/59caf590-276f-4d23-a719-5a2ca522aaec.mp4' },
      { category:'electronic', title:'Future Bass', artist:'EDM Lab', durationMs:25000, bpm:140, audioUrl:'https://ruagnjipmwipgcmgnsum.supabase.co/storage/v1/object/public/tribe-media/posts/93f1da1b-3ecd-410c-b203-bb75df49820c/8bbbf5b1-f6fe-4168-a3c0-ac0493588edc.mp4' },
    ].map(t => ({ id: uuidv4(), type:'MUSIC', status:'ACTIVE', license:'ROYALTY_FREE', useCount: Math.floor(Math.random()*500), coverUrl:'', createdAt: new Date(), ...t }))
    
    await db.collection('music_library').insertMany(tracks)
    await db.collection('music_library').createIndex({ category: 1, useCount: -1 }).catch(() => {})
    console.log(`[MUSIC] Auto-seeded ${tracks.length} tracks with Supabase audio`)
  } catch (e) {
    console.log('[MUSIC] Seed error (non-fatal):', e.message)
  }
}

let client = null
let db = null
let analyticsDb = null
let initialized = false

export async function getDb() {
  if (!client) {
    client = new MongoClient(process.env.MONGO_URL, {
      // Connection pooling optimization
      maxPoolSize: 50,
      minPoolSize: 5,
      maxIdleTimeMS: 30000,
      waitQueueTimeoutMS: 5000,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 20000,
    })
    await client.connect()
    db = client.db(process.env.DB_NAME)

    // Analytics read replica — uses secondaryPreferred for read-heavy queries
    // In single-instance MongoDB, this automatically falls back to primary
    analyticsDb = client.db(process.env.DB_NAME, {
      readPreference: ReadPreference.SECONDARY_PREFERRED,
    })
  }
  if (!initialized) {
    await ensureIndexes(db)
    await autoSeed(db)
    await ensureMusicLibrary(db)
    await ensurePageTribeInheritance(db)
    initialized = true
  }
  return db
}

/**
 * Get analytics-optimized DB connection.
 * Uses read replicas when available (secondaryPreferred).
 * Falls back to primary in single-node setups.
 */
export async function getAnalyticsDb() {
  await getDb() // Ensure connection is initialized
  return analyticsDb || db
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
      db.collection('users').createIndex({ tribeId: 1 }),
      db.collection('users').createIndex({ tribeId: 1, isBanned: 1 }),
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
      db.collection('content_items').createIndex({ tribeId: 1, kind: 1, visibility: 1, createdAt: -1 }),
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
      // B6-P4: dedup query index (type + actorId + targetId + createdAt for time-window dedup)
      db.collection('notifications').createIndex({ userId: 1, type: 1, actorId: 1, targetId: 1, createdAt: -1 }),
      // B6-P4G: Atomic dedup — unique index on dedupKey for concurrent write safety
      db.collection('notifications').createIndex({ dedupKey: 1 }, { unique: true, sparse: true }),
      // B6-P4: grouping query support (type + targetId for grouped inbox)
      db.collection('notifications').createIndex({ userId: 1, type: 1, targetId: 1, createdAt: -1 }),
      db.collection('notifications').createIndex({ id: 1 }),

      // === DEVICE TOKENS (B6-P4) ===
      db.collection('device_tokens').createIndex({ userId: 1, token: 1 }, { unique: true }),
      db.collection('device_tokens').createIndex({ token: 1 }),
      db.collection('device_tokens').createIndex({ userId: 1, isActive: 1 }),

      // === NOTIFICATION PREFERENCES (B6-P4) ===
      db.collection('notification_preferences').createIndex({ userId: 1 }, { unique: true }),

      // === HASHTAGS (B5) ===
      db.collection('hashtags').createIndex({ tag: 1 }, { unique: true }),
      db.collection('hashtags').createIndex({ postCount: -1, lastUsedAt: -1 }),
      // B5: Content hashtag array index for hashtag feed
      db.collection('content_items').createIndex({ hashtags: 1, createdAt: -1 }),
      // B5: Content caption search support
      db.collection('content_items').createIndex({ caption: 'text' }),

      // === B5.1: SEARCH PERFORMANCE INDEXES ===
      // Case-insensitive collation indexes for prefix/exact matching
      db.collection('users').createIndex(
        { displayName: 1 },
        { collation: { locale: 'en', strength: 2 }, name: 'displayName_ci' }
      ),
      db.collection('pages').createIndex(
        { name: 1 },
        { collation: { locale: 'en', strength: 2 }, name: 'name_ci' }
      ),
      // Compound index for page search filtering + sort
      db.collection('pages').createIndex(
        { status: 1, name: 1 },
        { collation: { locale: 'en', strength: 2 }, name: 'status_name_ci' }
      ),

      // === MEDIA ASSETS ===
      db.collection('media_assets').createIndex({ id: 1 }, { unique: true }),
      db.collection('media_assets').createIndex({ ownerId: 1, createdAt: -1 }),
      // Lifecycle indexes for cleanup worker + admin operations
      db.collection('media_assets').createIndex({ status: 1, expiresAt: 1 }), // stale PENDING_UPLOAD cleanup
      db.collection('media_assets').createIndex({ status: 1, isDeleted: 1, createdAt: -1 }), // metrics queries
      db.collection('media_assets').createIndex({ thumbnailStatus: 1, isDeleted: 1 }), // thumbnail lifecycle queries
      db.collection('media_assets').createIndex({ parentMediaId: 1 }), // thumbnail → parent lookup

      // === AUDIT LOGS ===
      db.collection('audit_logs').createIndex({ createdAt: -1 }),
      db.collection('audit_logs').createIndex({ actorId: 1, createdAt: -1 }),
      db.collection('audit_logs').createIndex({ targetType: 1, targetId: 1 }),
      db.collection('audit_logs').createIndex({ requestId: 1 }),  // Stage 3: correlation
      db.collection('audit_logs').createIndex({ category: 1, createdAt: -1 }),  // Stage 3: unified audit

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

      // === TRIBE CONTESTS (UPGRADED for Contest Engine) ===
      db.collection('tribe_contests').createIndex({ id: 1 }, { unique: true }),
      db.collection('tribe_contests').createIndex({ seasonId: 1, status: 1, createdAt: -1 }),
      db.collection('tribe_contests').createIndex({ contestCode: 1 }, { unique: true }),
      db.collection('tribe_contests').createIndex({ status: 1, contestEndAt: 1 }),
      db.collection('tribe_contests').createIndex({ contestType: 1, status: 1 }),
      db.collection('tribe_contests').createIndex({ seasonId: 1, status: 1, contestStartAt: 1 }),
      db.collection('tribe_contests').createIndex({ status: 1, createdAt: -1 }),

      // === TRIBE CONTEST RULES (NEW) ===
      db.collection('tribe_contest_rules').createIndex({ contestId: 1, version: -1 }),
      db.collection('tribe_contest_rules').createIndex({ contestId: 1, ruleType: 1, isActive: 1 }),

      // === TRIBE CONTEST ENTRIES (UPGRADED) ===
      db.collection('tribe_contest_entries').createIndex({ id: 1 }, { unique: true }),
      db.collection('tribe_contest_entries').createIndex({ contestId: 1, submittedAt: -1 }),
      db.collection('tribe_contest_entries').createIndex({ contestId: 1, tribeId: 1 }),
      db.collection('tribe_contest_entries').createIndex({ contestId: 1, userId: 1 }),
      db.collection('tribe_contest_entries').createIndex({ contestId: 1, contentId: 1 }),
      db.collection('tribe_contest_entries').createIndex({ contestId: 1, submissionStatus: 1 }),

      // === TRIBE CONTEST SCORES (NEW) ===
      db.collection('tribe_contest_scores').createIndex({ contestId: 1, entryId: 1 }, { unique: true }),
      db.collection('tribe_contest_scores').createIndex({ contestId: 1, rank: 1 }),
      db.collection('tribe_contest_scores').createIndex({ contestId: 1, tribeId: 1, finalScore: -1 }),
      db.collection('tribe_contest_scores').createIndex({ contestId: 1, finalScore: -1 }),

      // === TRIBE CONTEST RESULTS (NEW) ===
      db.collection('tribe_contest_results').createIndex({ contestId: 1 }, { unique: true }),
      db.collection('tribe_contest_results').createIndex({ contestId: 1, idempotencyKey: 1 }, { unique: true }),
      db.collection('tribe_contest_results').createIndex({ seasonId: 1, resolvedAt: -1 }),

      // === CONTEST VOTES (NEW) ===
      db.collection('contest_votes').createIndex({ contestId: 1, entryId: 1, voterUserId: 1 }, { unique: true }),
      db.collection('contest_votes').createIndex({ contestId: 1, entryId: 1 }),
      db.collection('contest_votes').createIndex({ contestId: 1, voterUserId: 1 }),

      // === CONTEST JUDGE SCORES (NEW) ===
      db.collection('contest_judge_scores').createIndex({ contestId: 1, entryId: 1, judgeId: 1 }, { unique: true }),
      db.collection('contest_judge_scores').createIndex({ contestId: 1, judgeId: 1 }),

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

      // ============================================================
      // ENHANCEMENT: Missing indexes for search, analytics, follow-requests, transcode
      // ============================================================

      // === FOLLOW REQUESTS ===
      db.collection('follow_requests').createIndex({ id: 1 }, { unique: true }),
      db.collection('follow_requests').createIndex({ targetId: 1, status: 1, createdAt: -1 }),
      db.collection('follow_requests').createIndex({ requesterId: 1, status: 1, createdAt: -1 }),
      db.collection('follow_requests').createIndex({ requesterId: 1, targetId: 1, status: 1 }),

      // === RECENT SEARCHES ===
      db.collection('recent_searches').createIndex({ userId: 1, updatedAt: -1 }),
      db.collection('recent_searches').createIndex({ userId: 1, query: 1 }, { unique: true }),

      // === ANALYTICS EVENTS ===
      db.collection('analytics_events').createIndex({ eventType: 1, targetId: 1, createdAt: -1 }),
      db.collection('analytics_events').createIndex({ viewerId: 1, eventType: 1, createdAt: -1 }),
      db.collection('analytics_events').createIndex({ day: 1, eventType: 1 }),
      db.collection('analytics_events').createIndex({ targetId: 1, eventType: 1, createdAt: -1 }),

      // === PROFILE VISITS ===
      db.collection('profile_visits').createIndex({ profileId: 1, day: 1 }, { unique: true }),
      db.collection('profile_visits').createIndex({ profileId: 1, day: -1 }),

      // === TRANSCODE JOBS ===
      db.collection('transcode_jobs').createIndex({ id: 1 }, { unique: true }),
      db.collection('transcode_jobs').createIndex({ mediaId: 1, status: 1, createdAt: -1 }),
      db.collection('transcode_jobs').createIndex({ requesterId: 1, createdAt: -1 }),
      db.collection('transcode_jobs').createIndex({ status: 1, createdAt: -1 }),

      // === TRIBE CHEERS ===
      db.collection('tribe_cheers').createIndex({ userId: 1, tribeId: 1, createdAt: -1 }),
      db.collection('tribe_cheers').createIndex({ tribeId: 1, createdAt: -1 }),

      // === TRIBE CONTENT SALUTES ===
      db.collection('tribe_content_salutes').createIndex({ userId: 1, contentId: 1, tribeId: 1 }, { unique: true }),
      db.collection('tribe_content_salutes').createIndex({ userId: 1, createdAt: -1 }),
      db.collection('tribe_content_salutes').createIndex({ tribeId: 1, createdAt: -1 }),

      // === TRIBE RIVALRIES ===
      db.collection('tribe_rivalries').createIndex({ id: 1 }, { unique: true }),
      db.collection('tribe_rivalries').createIndex({ status: 1, createdAt: -1 }),
      db.collection('tribe_rivalries').createIndex({ challengerTribeId: 1, status: 1 }),
      db.collection('tribe_rivalries').createIndex({ defenderTribeId: 1, status: 1 }),
      db.collection('tribe_rivalries').createIndex({ endsAt: 1, status: 1 }),

      // === TRIBE RIVALRY CONTRIBUTIONS ===
      db.collection('tribe_rivalry_contributions').createIndex({ rivalryId: 1, tribeId: 1, createdAt: -1 }),
      db.collection('tribe_rivalry_contributions').createIndex({ rivalryId: 1, contentId: 1 }, { unique: true }),
      db.collection('tribe_rivalry_contributions').createIndex({ userId: 1, createdAt: -1 }),

      // === CHUNKED UPLOAD SESSIONS ===
      db.collection('chunked_upload_sessions').createIndex({ id: 1 }, { unique: true }),
      db.collection('chunked_upload_sessions').createIndex({ userId: 1, status: 1, createdAt: -1 }),
      db.collection('chunked_upload_sessions').createIndex({ status: 1, expiresAt: 1 }),

      // === CHUNKED UPLOAD DATA ===
      db.collection('chunked_upload_data').createIndex({ sessionId: 1, chunkIndex: 1 }),

      // === FEED COMPOUND: $or visibility queries ===
      db.collection('content_items').createIndex({ visibility: 1, tribeId: 1, kind: 1, isDraft: 1, createdAt: -1 }),
      db.collection('content_items').createIndex({ visibility: 1, collegeId: 1, kind: 1, isDraft: 1, createdAt: -1 }),

      // === LIKES (analytics enhancement) ===
      db.collection('likes').createIndex({ contentAuthorId: 1, createdAt: -1 }),
      db.collection('likes').createIndex({ contentId: 1, createdAt: -1 }),
      db.collection('likes').createIndex({ userId: 1, createdAt: -1 }),

      // === SHARES ===
      db.collection('shares').createIndex({ contentId: 1, createdAt: -1 }),
      db.collection('shares').createIndex({ userId: 1, createdAt: -1 }),

      // === REEL DRAFTS ===
      db.collection('reel_drafts').createIndex({ creatorId: 1, status: 1, updatedAt: -1 }),

      // === MUSIC LIBRARY ===
      db.collection('music_library').createIndex({ category: 1, useCount: -1 }),
      db.collection('music_library').createIndex({ status: 1, type: 1 }),

      // === SALUTES ===
      db.collection('salutes').createIndex({ toUserId: 1, createdAt: -1 }),
      db.collection('salutes').createIndex({ fromUserId: 1, createdAt: -1 }),
      db.collection('salutes').createIndex({ type: 1, createdAt: -1 }),

      // === MEDIA SESSIONS (orchestration) ===
      db.collection('media_sessions').createIndex({ localSessionId: 1 }, { unique: true }),
      db.collection('media_sessions').createIndex({ upstreamMediaId: 1 }),
      db.collection('media_sessions').createIndex({ userId: 1, createdAt: -1 }),
      db.collection('media_sessions').createIndex({ correlationId: 1 }),
      db.collection('media_sessions').createIndex({ lineageId: 1 }),
      db.collection('media_sessions').createIndex({ uploadState: 1, updatedAt: -1 }),

      // === PROCESSING JOBS ===
      db.collection('processing_jobs').createIndex({ mediaAssetId: 1 }),
      db.collection('processing_jobs').createIndex({ status: 1, createdAt: -1 }),
      db.collection('processing_jobs').createIndex({ moduleType: 1, status: 1 }),
    ])
  } catch {
    // Indexes may already exist with different options — safe to ignore on startup
  }
}
