/*
 * Auto-Seed Module — runs once on first DB init
 * Creates canonical seed users, page, follows, and diverse content
 * Idempotent: checks for existing seed marker before running
 */
import { v4 as uuidv4 } from 'uuid'
import { generateSalt, hashPin, generateToken } from './auth-utils.js'

const SEED_MARKER = '__tribe_seed_v1__'

// Seed user definitions
const SEED_USERS = [
  { phone: '9999960001', name: 'Seed Creator Alpha', username: 'seed_alpha' },
  { phone: '9999960002', name: 'Seed Creator Beta',  username: 'seed_beta' },
  { phone: '7777099001', name: 'FE Test User', username: 'fe_test_1', role: 'ADMIN' },
  { phone: '7777099002', name: 'FE Test User 2', username: 'fe_test_2', role: 'USER' },
  { phone: '9876543210', name: 'Arjun Sharma', username: 'arjun_admin', role: 'ADMIN' },
  { phone: '9000000001', name: 'Priya Sharma', username: 'priya_super', role: 'SUPER_ADMIN' },
]

const SEED_PAGE = {
  name: 'Tribe Campus Memes',
  slug: 'tribe-campus-memes-seed',
  category: 'MEME',
  bio: 'The best meme page for Tribe campus life',
}

const SEED_POSTS = [
  { caption: 'When you realize finals are next week but you still have not started studying #CampusLife #TribeMemes', authorIdx: 0, isPagePost: true },
  { caption: 'New campus panorama shot from the rooftop! #TribeViews', authorIdx: 0, isPagePost: true },
  { caption: 'Morning vibes at the library #StudyGram', authorIdx: 0 },
  { caption: 'College fest highlights! Swipe for more! #FestLife', authorIdx: 0 },
  { caption: 'Hot take: The canteen samosa is overrated. Fight me.', authorIdx: 0 },
  { caption: 'Update: Day got way better! Just found out I passed my exam! (edited)', authorIdx: 0 },
]

function extractHashtags(text) {
  const matches = text.match(/#([a-zA-Z0-9_]+)/g) || []
  return [...new Set(matches.map(m => m.slice(1).toLowerCase()))]
}

export async function autoSeed(db) {
  try {
    // Check if already seeded
    const marker = await db.collection('_seed_status').findOne({ key: SEED_MARKER })
    if (marker) return // Already seeded

    console.log('[AUTO-SEED] Starting seed...')

    // 1. Create users
    const users = []
    for (const def of SEED_USERS) {
      const existing = await db.collection('users').findOne({ phone: def.phone })
      if (existing) {
        users.push(existing)
        console.log(`[AUTO-SEED] User ${def.phone} exists: ${existing.id}`)
        continue
      }
      const salt = generateSalt()
      const pinH = hashPin('1234', salt)
      const now = new Date()
      const user = {
        id: uuidv4(),
        phone: def.phone,
        pinHash: pinH,
        pinSalt: salt,
        displayName: def.name,
        username: def.username,
        bio: '',
        avatarMediaId: null,
        ageStatus: 'ADULT',
        birthYear: 2000,
        dateOfBirth: '2000-01-15',
        role: def.role || 'USER',
        collegeId: null,
        collegeName: null,
        houseId: null,     // DEPRECATED — cleared in migration
        houseSlug: null,   // DEPRECATED — cleared in migration
        houseName: null,   // DEPRECATED — cleared in migration
        tribeId: null,
        tribeCode: null,
        tribeName: null,
        isBanned: false,
        isVerified: false,
        suspendedUntil: null,
        strikeCount: 0,
        consentVersion: null,
        consentAcceptedAt: null,
        personalizedFeed: true,
        targetedAds: true,
        followersCount: 0,
        followingCount: 0,
        postsCount: 0,
        onboardingComplete: true,
        onboardingStep: 'DONE',
        lastActiveAt: now,
        createdAt: now,
        updatedAt: now,
      }
      await db.collection('users').insertOne(user)
      users.push(user)
      console.log(`[AUTO-SEED] User created: ${def.phone} → ${user.id}`)
    }

    const userA = users[0]
    const userB = users[1]

    // 2. Create page
    let page = await db.collection('pages').findOne({ slug: SEED_PAGE.slug })
    if (!page) {
      const now = new Date()
      page = {
        id: uuidv4(),
        slug: SEED_PAGE.slug,
        name: SEED_PAGE.name,
        bio: SEED_PAGE.bio,
        category: SEED_PAGE.category,
        subcategory: '',
        avatarMediaId: null,
        coverMediaId: null,
        status: 'ACTIVE',
        isOfficial: true,
        verificationStatus: 'VERIFIED',
        linkedEntityType: null,
        linkedEntityId: null,
        collegeId: null,
        tribeId: null,
        createdByUserId: userA.id,
        followerCount: 0,
        memberCount: 1,
        postCount: 0,
        archivedAt: null,
        suspendedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      await db.collection('pages').insertOne(page)
      console.log(`[AUTO-SEED] Page created: ${page.id}`)
    } else {
      console.log(`[AUTO-SEED] Page exists: ${page.id}`)
    }

    // Ensure userA is page OWNER
    const membership = await db.collection('page_members').findOne({ pageId: page.id, userId: userA.id })
    if (!membership) {
      await db.collection('page_members').insertOne({
        id: uuidv4(),
        pageId: page.id,
        userId: userA.id,
        role: 'OWNER',
        status: 'ACTIVE',
        addedByUserId: userA.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    }
    // Set page ownership
    await db.collection('pages').updateOne({ id: page.id }, {
      $set: { createdByUserId: userA.id, isOfficial: true, verificationStatus: 'VERIFIED' }
    })

    // 3. Create follow: B follows A
    const existingFollow = await db.collection('follows').findOne({ followerId: userB.id, followeeId: userA.id })
    if (!existingFollow) {
      await db.collection('follows').insertOne({
        id: uuidv4(),
        followerId: userB.id,
        followeeId: userA.id,
        createdAt: new Date(),
      })
      await db.collection('users').updateOne({ id: userA.id }, { $inc: { followersCount: 1 } })
      await db.collection('users').updateOne({ id: userB.id }, { $inc: { followingCount: 1 } })
    }

    // 4. Create posts
    const createdPostIds = []
    for (let i = 0; i < SEED_POSTS.length; i++) {
      const def = SEED_POSTS[i]
      const author = def.authorIdx === 0 ? userA : userB
      const now = new Date(Date.now() + i * 1000) // stagger timestamps
      const hashtags = extractHashtags(def.caption)
      const post = {
        id: uuidv4(),
        kind: 'POST',
        authorId: def.isPagePost ? page.id : author.id,
        authorType: def.isPagePost ? 'PAGE' : 'USER',
        createdAs: def.isPagePost ? 'PAGE' : 'USER',
        caption: def.caption,
        hashtags,
        media: [],
        visibility: 'PUBLIC',
        riskScore: 0,
        policyReasons: [],
        moderation: { action: 'ALLOW', provider: 'seed', confidence: 1, flaggedCategories: [], reasons: ['Seeded content'] },
        collegeId: null,
        houseId: author.houseId || author.tribeId || null,
        tribeId: author.tribeId || null,
        likeCount: 0,
        dislikeCountInternal: 0,
        commentCount: 0,
        saveCount: 0,
        shareCount: 0,
        viewCount: 0,
        syntheticDeclaration: false,
        syntheticLabelStatus: 'UNKNOWN',
        distributionStage: 2,
        duration: null,
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
      }
      if (def.isPagePost) {
        post.pageId = page.id
        post.publishedByUserId = author.id
        post.actingUserId = author.id
        post.actingRole = 'OWNER'
      }
      await db.collection('content_items').insertOne(post)
      createdPostIds.push(post.id)

      // Sync hashtag stats
      for (const tag of hashtags) {
        await db.collection('hashtags').updateOne(
          { tag },
          { $inc: { postCount: 1 }, $set: { lastUsedAt: now, updatedAt: now }, $setOnInsert: { createdAt: now } },
          { upsert: true }
        )
      }
    }

    // Update post counts
    await db.collection('users').updateOne({ id: userA.id }, { $inc: { postsCount: SEED_POSTS.filter(p => !p.isPagePost && p.authorIdx === 0).length } })
    await db.collection('pages').updateOne({ id: page.id }, { $inc: { postCount: SEED_POSTS.filter(p => p.isPagePost).length } })

    // 5. Seed Reels with actual media
    const SEED_REELS = [
      { caption: 'Campus morning walk vibe check #CampusLife #Reels', creatorIdx: 0 },
      { caption: 'Library speed run challenge accepted #StudyGram #FunnyReels', creatorIdx: 0 },
      { caption: 'Canteen food review — honest edition #FoodReview', creatorIdx: 1 },
    ]

    // Read real sample video for seeding reels
    let seedVideoBuffer
    try {
      const fs = require('fs')
      const path = require('path')
      seedVideoBuffer = fs.readFileSync(path.join(process.cwd(), 'lib/assets/seed-reel.mp4'))
    } catch {
      // Fallback: minimal valid MP4 container
      seedVideoBuffer = Buffer.from('AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIbWRhdA==', 'base64')
    }

    // Try Supabase upload for seed reels
    let useSupabase = false
    try {
      const { ensureBucket, uploadBuffer, getPublicUrl } = await import('./supabase-storage.js')
      await ensureBucket()
      useSupabase = true
    } catch { /* Supabase not available — use BASE64 fallback */ }

    const reelIds = []
    for (let i = 0; i < SEED_REELS.length; i++) {
      const def = SEED_REELS[i]
      const creator = def.creatorIdx === 0 ? userA : userB
      const now = new Date(Date.now() + (SEED_POSTS.length + i) * 1000)

      // Create media asset for each reel
      const mediaId = uuidv4()
      let storageType = 'BASE64'
      let storagePath = null
      let publicUrl = null
      let mediaData = seedVideoBuffer.toString('base64')

      if (useSupabase) {
        try {
          const { uploadBuffer, getPublicUrl } = await import('./supabase-storage.js')
          const filePath = `reels/${creator.id}/${mediaId}.mp4`
          const result = await uploadBuffer(filePath, seedVideoBuffer, 'video/mp4')
          storageType = 'SUPABASE'
          storagePath = filePath
          publicUrl = result.publicUrl
          mediaData = null
        } catch { /* fallback to BASE64 */ }
      }

      await db.collection('media_assets').insertOne({
        id: mediaId,
        ownerId: creator.id,
        type: 'VIDEO',
        kind: 'VIDEO',
        mimeType: 'video/mp4',
        size: seedVideoBuffer.length,
        sizeBytes: seedVideoBuffer.length,
        width: 1080,
        height: 1920,
        duration: 15,
        thumbnailId: null,
        status: 'READY',
        storageType,
        storagePath,
        publicUrl,
        data: mediaData,
        isDeleted: false,
        createdAt: now,
      })

      const reel = {
        id: uuidv4(),
        creatorId: creator.id,
        collegeId: creator.collegeId || null,
        houseId: creator.houseId || creator.tribeId || null,
        tribeId: creator.tribeId || null,
        caption: def.caption,
        hashtags: extractHashtags(def.caption),
        mentions: [],
        audioMeta: null,
        durationMs: 15000,
        mediaStatus: 'READY',
        mediaId,
        playbackUrl: publicUrl || `/api/media/${mediaId}`,
        thumbnailUrl: null,
        posterFrameUrl: null,
        variants: [],
        visibility: 'PUBLIC',
        moderationStatus: 'APPROVED',
        syntheticDeclaration: false,
        brandedContent: false,
        status: 'PUBLISHED',
        remixOf: null,
        collabCreators: [],
        seriesId: null,
        seriesOrder: null,
        isRemoved: false,
        likeCount: 0,
        dislikeCount: 0,
        commentCount: 0,
        shareCount: 0,
        viewCount: 0,
        saveCount: 0,
        reportCount: 0,
        createdAt: now,
        updatedAt: now,
      }
      await db.collection('reels').insertOne(reel)
      reelIds.push(reel.id)
    }

    console.log(`[AUTO-SEED] Reels created: ${reelIds.length}`)

    // 7. Fix any test reels with example.com placeholder URLs — give each its own media
    const existingBadReels = await db.collection('reels').find({
      playbackUrl: { $regex: 'example\\.com|ex\\.com' }
    }).toArray()
    if (existingBadReels.length > 0) {
      for (const badReel of existingBadReels) {
        const fixMediaId = uuidv4()
        let fixStorageType = 'BASE64'
        let fixStoragePath = null
        let fixPublicUrl = null
        let fixMediaData = seedVideoBuffer.toString('base64')

        if (useSupabase) {
          try {
            const { uploadBuffer: upBuf } = await import('./supabase-storage.js')
            const fp = `reels/${badReel.creatorId}/${fixMediaId}.mp4`
            const res = await upBuf(fp, seedVideoBuffer, 'video/mp4')
            fixStorageType = 'SUPABASE'
            fixStoragePath = fp
            fixPublicUrl = res.publicUrl
            fixMediaData = null
          } catch { /* fallback */ }
        }

        await db.collection('media_assets').insertOne({
          id: fixMediaId,
          ownerId: badReel.creatorId || 'system',
          type: 'VIDEO', kind: 'VIDEO',
          mimeType: 'video/mp4',
          size: seedVideoBuffer.length, sizeBytes: seedVideoBuffer.length,
          width: 1080, height: 1920, duration: 15,
          status: 'READY', storageType: fixStorageType,
          storagePath: fixStoragePath, publicUrl: fixPublicUrl,
          data: fixMediaData, isDeleted: false,
          createdAt: new Date(),
        })
        await db.collection('reels').updateOne(
          { id: badReel.id },
          { $set: { playbackUrl: fixPublicUrl || `/api/media/${fixMediaId}`, mediaId: fixMediaId, mediaStatus: 'READY' } }
        )
      }
      console.log(`[AUTO-SEED] Fixed ${existingBadReels.length} reels with example.com URLs (unique media each)`)
    }

    // 8. Mark as seeded
    // Seed royalty-free music library
    const musicCount = await db.collection('music_library').countDocuments()
    if (musicCount === 0) {
      const musicTracks = [
        { category:'trending', title:'Summer Vibes', artist:'Tribe Audio', durationMs:30000, bpm:120 },
        { category:'trending', title:'Neon Nights', artist:'Tribe Audio', durationMs:25000, bpm:128 },
        { category:'trending', title:'Golden Hour', artist:'Tribe Beats', durationMs:35000, bpm:110 },
        { category:'chill', title:'Morning Coffee', artist:'LoFi Tribe', durationMs:40000, bpm:85 },
        { category:'chill', title:'Rainy Day', artist:'LoFi Tribe', durationMs:32000, bpm:80 },
        { category:'chill', title:'Sunset Drive', artist:'Chill Lab', durationMs:28000, bpm:90 },
        { category:'energetic', title:'Pump It Up', artist:'Tribe Beats', durationMs:20000, bpm:140 },
        { category:'energetic', title:'Game On', artist:'Bass Nation', durationMs:22000, bpm:150 },
        { category:'energetic', title:'Unstoppable', artist:'Tribe Beats', durationMs:25000, bpm:145 },
        { category:'happy', title:'Feel Good', artist:'Sunny Sounds', durationMs:30000, bpm:115 },
        { category:'happy', title:'Party Time', artist:'Sunny Sounds', durationMs:28000, bpm:125 },
        { category:'happy', title:'Celebrate', artist:'Tribe Audio', durationMs:33000, bpm:118 },
        { category:'sad', title:'Memories', artist:'Piano Tales', durationMs:35000, bpm:70 },
        { category:'sad', title:'Letting Go', artist:'Piano Tales', durationMs:40000, bpm:65 },
        { category:'epic', title:'Rise Up', artist:'Cinematic Lab', durationMs:30000, bpm:100 },
        { category:'epic', title:'The Journey', artist:'Cinematic Lab', durationMs:45000, bpm:95 },
        { category:'lofi', title:'Study Session', artist:'LoFi Tribe', durationMs:50000, bpm:75 },
        { category:'lofi', title:'Late Night Code', artist:'LoFi Tribe', durationMs:45000, bpm:78 },
        { category:'pop', title:'Catch My Vibe', artist:'Pop Central', durationMs:28000, bpm:120 },
        { category:'pop', title:'On My Way', artist:'Pop Central', durationMs:25000, bpm:115 },
        { category:'hiphop', title:'Street Flow', artist:'Beat Factory', durationMs:30000, bpm:90 },
        { category:'hiphop', title:'Real Talk', artist:'Beat Factory', durationMs:35000, bpm:95 },
        { category:'electronic', title:'Digital Dreams', artist:'Synth Wave', durationMs:32000, bpm:130 },
        { category:'electronic', title:'Neon Pulse', artist:'Synth Wave', durationMs:28000, bpm:135 },
        { category:'electronic', title:'Future Bass', artist:'EDM Lab', durationMs:25000, bpm:140 },
      ].map(t => ({ id: uuidv4(), type:'MUSIC', status:'ACTIVE', license:'ROYALTY_FREE', useCount:Math.floor(Math.random()*500), audioUrl:'', coverUrl:'', createdAt:new Date(), ...t }))
      await db.collection('music_library').insertMany(musicTracks)
      console.log(`[AUTO-SEED] Music library: ${musicTracks.length} tracks`)
    }

    await db.collection('_seed_status').insertOne({
      key: SEED_MARKER,
      seededAt: new Date(),
      users: SEED_USERS.map(u => u.phone),
      pageSlug: SEED_PAGE.slug,
      postCount: createdPostIds.length,
      reelCount: reelIds.length,
    })

    console.log(`[AUTO-SEED] Complete — ${users.length} users, 1 page, ${createdPostIds.length} posts, ${reelIds.length} reels`)
  } catch (err) {
    console.error('[AUTO-SEED] Error (non-fatal):', err.message)
  }
}
