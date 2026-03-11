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
        role: 'USER',
        collegeId: null,
        collegeName: null,
        houseId: null,
        houseSlug: null,
        houseName: null,
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
        onboardingComplete: false,
        onboardingStep: 'AGE',
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
        houseId: author.houseId || null,
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

    // 5. Mark as seeded
    await db.collection('_seed_status').insertOne({
      key: SEED_MARKER,
      seededAt: new Date(),
      users: SEED_USERS.map(u => u.phone),
      pageSlug: SEED_PAGE.slug,
      postCount: createdPostIds.length,
    })

    console.log(`[AUTO-SEED] Complete — ${users.length} users, 1 page, ${createdPostIds.length} posts`)
  } catch (err) {
    console.error('[AUTO-SEED] Error (non-fatal):', err.message)
  }
}
