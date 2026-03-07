import { MongoClient } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import { NextResponse } from 'next/server'
import crypto from 'crypto'

// ===== MongoDB Connection =====
let client
let db
let indexesCreated = false

async function connectToMongo() {
  if (!client) {
    client = new MongoClient(process.env.MONGO_URL)
    await client.connect()
    db = client.db(process.env.DB_NAME)
  }
  if (!indexesCreated) {
    try {
      // Drop old username index if it exists (fixes null duplicate issue)
      try { await db.collection('users').dropIndex('username_1') } catch {}
      await Promise.all([
        db.collection('users').createIndex({ id: 1 }, { unique: true }),
        db.collection('users').createIndex({ phone: 1 }, { unique: true }),
        db.collection('users').createIndex({ username: 1 }, { unique: true, partialFilterExpression: { username: { $type: 'string' } } }),
        db.collection('sessions').createIndex({ token: 1 }, { unique: true }),
        db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        db.collection('colleges').createIndex({ id: 1 }, { unique: true }),
        db.collection('colleges').createIndex({ normalizedName: 1 }),
        db.collection('colleges').createIndex({ state: 1 }),
        db.collection('colleges').createIndex({ type: 1 }),
        db.collection('content_items').createIndex({ id: 1 }, { unique: true }),
        db.collection('content_items').createIndex({ authorId: 1, createdAt: -1 }),
        db.collection('content_items').createIndex({ collegeId: 1, visibility: 1, createdAt: -1 }),
        db.collection('content_items').createIndex({ visibility: 1, createdAt: -1 }),
        db.collection('follows').createIndex({ followerId: 1, followeeId: 1 }, { unique: true }),
        db.collection('follows').createIndex({ followeeId: 1 }),
        db.collection('follows').createIndex({ followerId: 1 }),
        db.collection('reactions').createIndex({ userId: 1, contentId: 1 }, { unique: true }),
        db.collection('reactions').createIndex({ contentId: 1 }),
        db.collection('saves').createIndex({ userId: 1, contentId: 1 }, { unique: true }),
        db.collection('comments').createIndex({ contentId: 1, createdAt: -1 }),
        db.collection('reports').createIndex({ id: 1 }, { unique: true }),
        db.collection('media_assets').createIndex({ id: 1 }, { unique: true }),
        db.collection('audit_logs').createIndex({ createdAt: -1 }),
        db.collection('consent_notices').createIndex({ active: 1 }),
      ])
      indexesCreated = true
    } catch (e) {
      // Indexes may already exist
      indexesCreated = true
    }
  }
  return db
}

// ===== Auth Helpers =====
function generateSalt() {
  return crypto.randomBytes(16).toString('hex')
}

function hashPin(pin, salt) {
  return crypto.pbkdf2Sync(pin.toString(), salt, 10000, 64, 'sha512').toString('hex')
}

function verifyPin(pin, salt, hash) {
  const computed = hashPin(pin, salt)
  return computed === hash
}

function generateToken() {
  return crypto.randomBytes(48).toString('hex')
}

async function authenticate(request, db) {
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null
  const token = authHeader.slice(7)
  const session = await db.collection('sessions').findOne({ 
    token, 
    expiresAt: { $gt: new Date() } 
  })
  if (!session) return null
  const user = await db.collection('users').findOne({ id: session.userId })
  if (!user || user.isBanned) return null
  return user
}

// ===== Response Helpers =====
function cors(response) {
  response.headers.set('Access-Control-Allow-Origin', process.env.CORS_ORIGINS || '*')
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS')
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  response.headers.set('Access-Control-Allow-Credentials', 'true')
  return response
}

function ok(data, status = 200) {
  return cors(NextResponse.json(data, { status }))
}

function err(message, status = 400) {
  return cors(NextResponse.json({ error: message }, { status }))
}

// ===== Audit Helper =====
async function writeAudit(db, eventType, actorId, targetType, targetId, metadata = {}) {
  await db.collection('audit_logs').insertOne({
    id: uuidv4(),
    eventType,
    actorId,
    targetType,
    targetId,
    metadata,
    createdAt: new Date()
  })
}

// ===== Sanitize User for Response =====
function sanitizeUser(user) {
  if (!user) return null
  const { _id, pinHash, pinSalt, ...safe } = user
  return safe
}

// ===== Time Ago Helper =====
function timeAgo(date) {
  const seconds = Math.floor((new Date() - new Date(date)) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.floor(days / 7)
  return `${weeks}w`
}

// ===== OPTIONS Handler =====
export async function OPTIONS() {
  return cors(new NextResponse(null, { status: 200 }))
}

// ===== Main Route Handler =====
async function handleRoute(request, { params }) {
  const { path = [] } = params
  const route = `/${path.join('/')}`
  const method = request.method

  try {
    const db = await connectToMongo()

    // ========================
    // HEALTH ROUTES
    // ========================
    if (route === '/' && method === 'GET') {
      return ok({ message: 'Tribe API v1.0', status: 'running' })
    }
    if (route === '/healthz' && method === 'GET') {
      return ok({ ok: true, timestamp: new Date().toISOString() })
    }
    if (route === '/readyz' && method === 'GET') {
      try {
        await db.command({ ping: 1 })
        return ok({ ok: true, db: 'connected' })
      } catch {
        return err('Database not ready', 503)
      }
    }

    // ========================
    // AUTH ROUTES
    // ========================
    if (route === '/auth/register' && method === 'POST') {
      const body = await request.json()
      const { phone, pin, displayName } = body

      if (!phone || !pin || !displayName) {
        return err('phone, pin, and displayName are required')
      }
      if (!/^\d{10}$/.test(phone)) {
        return err('Phone must be exactly 10 digits')
      }
      if (!/^\d{4}$/.test(pin.toString())) {
        return err('PIN must be exactly 4 digits')
      }
      if (displayName.length < 2 || displayName.length > 50) {
        return err('displayName must be 2-50 characters')
      }

      const existing = await db.collection('users').findOne({ phone })
      if (existing) {
        return err('Phone number already registered. Please login.', 409)
      }

      const salt = generateSalt()
      const pinH = hashPin(pin, salt)
      const userId = uuidv4()
      const now = new Date()

      const user = {
        id: userId,
        phone,
        pinHash: pinH,
        pinSalt: salt,
        displayName: displayName.trim(),
        username: null,
        bio: '',
        avatarUrl: null,
        ageStatus: 'UNKNOWN',
        birthYear: null,
        role: 'USER',
        collegeId: null,
        collegeName: null,
        houseId: null,
        houseName: null,
        isBanned: false,
        isVerified: false,
        personalizedFeed: true,
        targetedAds: true,
        followersCount: 0,
        followingCount: 0,
        postsCount: 0,
        onboardingComplete: false,
        createdAt: now,
        updatedAt: now
      }

      await db.collection('users').insertOne(user)

      const token = generateToken()
      const session = {
        id: uuidv4(),
        userId,
        token,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      }
      await db.collection('sessions').insertOne(session)

      await writeAudit(db, 'USER_REGISTERED', userId, 'USER', userId)

      return ok({ token, user: sanitizeUser(user) }, 201)
    }

    if (route === '/auth/login' && method === 'POST') {
      const body = await request.json()
      const { phone, pin } = body

      if (!phone || !pin) {
        return err('phone and pin are required')
      }

      const user = await db.collection('users').findOne({ phone })
      if (!user) {
        return err('Invalid phone or PIN', 401)
      }
      if (user.isBanned) {
        return err('Account suspended', 403)
      }
      if (!verifyPin(pin, user.pinSalt, user.pinHash)) {
        return err('Invalid phone or PIN', 401)
      }

      const token = generateToken()
      const now = new Date()
      await db.collection('sessions').insertOne({
        id: uuidv4(),
        userId: user.id,
        token,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
      })

      await writeAudit(db, 'USER_LOGIN', user.id, 'USER', user.id)

      return ok({ token, user: sanitizeUser(user) })
    }

    if (route === '/auth/logout' && method === 'POST') {
      const authHeader = request.headers.get('authorization')
      if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.slice(7)
        await db.collection('sessions').deleteOne({ token })
      }
      return ok({ message: 'Logged out' })
    }

    if (route === '/auth/me' && method === 'GET') {
      const user = await authenticate(request, db)
      if (!user) return err('Unauthorized', 401)
      return ok({ user: sanitizeUser(user) })
    }

    // ========================
    // PROFILE ROUTES
    // ========================
    if (route === '/me/profile' && method === 'PATCH') {
      const user = await authenticate(request, db)
      if (!user) return err('Unauthorized', 401)

      const body = await request.json()
      const updates = {}
      
      if (body.displayName !== undefined) {
        if (body.displayName.length < 2 || body.displayName.length > 50) {
          return err('displayName must be 2-50 characters')
        }
        updates.displayName = body.displayName.trim()
      }
      if (body.username !== undefined) {
        const un = body.username.toLowerCase().trim()
        if (!/^[a-z0-9._]{3,30}$/.test(un)) {
          return err('Username must be 3-30 chars: letters, numbers, dots, underscores')
        }
        const taken = await db.collection('users').findOne({ username: un, id: { $ne: user.id } })
        if (taken) return err('Username already taken', 409)
        updates.username = un
      }
      if (body.bio !== undefined) {
        updates.bio = (body.bio || '').slice(0, 150)
      }
      if (body.avatarUrl !== undefined) {
        updates.avatarUrl = body.avatarUrl
      }

      if (Object.keys(updates).length === 0) {
        return err('No valid fields to update')
      }

      updates.updatedAt = new Date()
      await db.collection('users').updateOne({ id: user.id }, { $set: updates })

      const updated = await db.collection('users').findOne({ id: user.id })
      return ok({ user: sanitizeUser(updated) })
    }

    if (route === '/me/age' && method === 'PATCH') {
      const user = await authenticate(request, db)
      if (!user) return err('Unauthorized', 401)

      const body = await request.json()
      const { birthYear } = body

      if (!birthYear || birthYear < 1940 || birthYear > new Date().getFullYear()) {
        return err('Invalid birth year')
      }

      const age = new Date().getFullYear() - birthYear
      const ageStatus = age < 18 ? 'CHILD' : 'ADULT'

      if (user.ageStatus === 'CHILD' && ageStatus === 'ADULT') {
        return err('Cannot change from child to adult without admin review')
      }

      const updates = {
        birthYear,
        ageStatus,
        updatedAt: new Date()
      }

      if (ageStatus === 'CHILD') {
        updates.personalizedFeed = false
        updates.targetedAds = false
      }

      await db.collection('users').updateOne({ id: user.id }, { $set: updates })
      await writeAudit(db, 'AGE_SET', user.id, 'USER', user.id, { birthYear, ageStatus })

      const updated = await db.collection('users').findOne({ id: user.id })
      return ok({ user: sanitizeUser(updated) })
    }

    if (route === '/me/college' && method === 'PATCH') {
      const user = await authenticate(request, db)
      if (!user) return err('Unauthorized', 401)

      const body = await request.json()
      const { collegeId } = body

      if (!collegeId) {
        // Unlink college
        await db.collection('users').updateOne({ id: user.id }, { 
          $set: { collegeId: null, collegeName: null, updatedAt: new Date() } 
        })
        const updated = await db.collection('users').findOne({ id: user.id })
        return ok({ user: sanitizeUser(updated) })
      }

      const college = await db.collection('colleges').findOne({ id: collegeId })
      if (!college) return err('College not found', 404)

      await db.collection('users').updateOne({ id: user.id }, { 
        $set: { 
          collegeId: college.id, 
          collegeName: college.officialName,
          updatedAt: new Date() 
        } 
      })

      await db.collection('colleges').updateOne({ id: college.id }, { $inc: { membersCount: 1 } })
      await writeAudit(db, 'COLLEGE_LINKED', user.id, 'COLLEGE', college.id)

      const updated = await db.collection('users').findOne({ id: user.id })
      return ok({ user: sanitizeUser(updated) })
    }

    if (route === '/me/onboarding' && method === 'PATCH') {
      const user = await authenticate(request, db)
      if (!user) return err('Unauthorized', 401)

      await db.collection('users').updateOne({ id: user.id }, { 
        $set: { onboardingComplete: true, updatedAt: new Date() } 
      })
      const updated = await db.collection('users').findOne({ id: user.id })
      return ok({ user: sanitizeUser(updated) })
    }

    // ========================
    // USER ROUTES
    // ========================
    if (path[0] === 'users' && path.length === 2 && method === 'GET') {
      const userId = path[1]
      const targetUser = await db.collection('users').findOne({ id: userId })
      if (!targetUser) return err('User not found', 404)

      const currentUser = await authenticate(request, db)
      let isFollowing = false
      if (currentUser) {
        const follow = await db.collection('follows').findOne({
          followerId: currentUser.id,
          followeeId: userId
        })
        isFollowing = !!follow
      }

      return ok({ 
        user: sanitizeUser(targetUser),
        isFollowing
      })
    }

    if (path[0] === 'users' && path.length === 3 && path[2] === 'posts' && method === 'GET') {
      const userId = path[1]
      const url = new URL(request.url)
      const cursor = url.searchParams.get('cursor')
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)

      const query = { 
        authorId: userId, 
        visibility: { $in: ['PUBLIC', 'LIMITED'] },
        kind: 'POST'
      }
      if (cursor) {
        query.createdAt = { $lt: new Date(cursor) }
      }

      const posts = await db.collection('content_items')
        .find(query)
        .sort({ createdAt: -1 })
        .limit(limit + 1)
        .toArray()

      const hasMore = posts.length > limit
      const items = posts.slice(0, limit)

      const currentUser = await authenticate(request, db)
      const enriched = await enrichPosts(db, items, currentUser?.id)

      return ok({
        items: enriched,
        nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null
      })
    }

    if (path[0] === 'users' && path.length === 3 && path[2] === 'followers' && method === 'GET') {
      const userId = path[1]
      const url = new URL(request.url)
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100)
      const offset = parseInt(url.searchParams.get('offset') || '0')

      const follows = await db.collection('follows')
        .find({ followeeId: userId })
        .skip(offset)
        .limit(limit)
        .toArray()

      const followerIds = follows.map(f => f.followerId)
      const users = await db.collection('users')
        .find({ id: { $in: followerIds } })
        .toArray()

      return ok({ users: users.map(sanitizeUser) })
    }

    if (path[0] === 'users' && path.length === 3 && path[2] === 'following' && method === 'GET') {
      const userId = path[1]
      const url = new URL(request.url)
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100)
      const offset = parseInt(url.searchParams.get('offset') || '0')

      const follows = await db.collection('follows')
        .find({ followerId: userId })
        .skip(offset)
        .limit(limit)
        .toArray()

      const followeeIds = follows.map(f => f.followeeId)
      const users = await db.collection('users')
        .find({ id: { $in: followeeIds } })
        .toArray()

      return ok({ users: users.map(sanitizeUser) })
    }

    // ========================
    // COLLEGE ROUTES
    // ========================
    if (route === '/colleges/search' && method === 'GET') {
      const url = new URL(request.url)
      const q = url.searchParams.get('q') || ''
      const state = url.searchParams.get('state')
      const type = url.searchParams.get('type')
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100)
      const offset = parseInt(url.searchParams.get('offset') || '0')

      const query = {}
      if (q) {
        // Smart search: split query into words and match each
        const words = q.trim().split(/\s+/).filter(w => w.length > 0)
        if (words.length > 0) {
          query.$and = words.map(word => ({
            $or: [
              { officialName: { $regex: word, $options: 'i' } },
              { normalizedName: { $regex: word, $options: 'i' } },
              { city: { $regex: word, $options: 'i' } },
              { type: { $regex: word, $options: 'i' } },
            ]
          }))
        }
      }
      if (state) query.state = state
      if (type) query.type = type

      const colleges = await db.collection('colleges')
        .find(query)
        .sort({ membersCount: -1, officialName: 1 })
        .skip(offset)
        .limit(limit)
        .toArray()

      const total = await db.collection('colleges').countDocuments(query)

      return ok({ colleges: colleges.map(c => { const { _id, ...rest } = c; return rest }), total })
    }

    if (path[0] === 'colleges' && path.length === 2 && method === 'GET') {
      const collegeId = path[1]
      const college = await db.collection('colleges').findOne({ id: collegeId })
      if (!college) return err('College not found', 404)
      const { _id, ...rest } = college
      return ok({ college: rest })
    }

    if (route === '/colleges/states' && method === 'GET') {
      const states = await db.collection('colleges').distinct('state')
      return ok({ states: states.sort() })
    }

    if (route === '/colleges/types' && method === 'GET') {
      const types = await db.collection('colleges').distinct('type')
      return ok({ types: types.sort() })
    }

    if (path[0] === 'colleges' && path.length === 3 && path[2] === 'members' && method === 'GET') {
      const collegeId = path[1]
      const url = new URL(request.url)
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)

      const members = await db.collection('users')
        .find({ collegeId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray()

      return ok({ members: members.map(sanitizeUser) })
    }

    // ========================
    // CONTENT ROUTES
    // ========================
    if (route === '/content/posts' && method === 'POST') {
      const user = await authenticate(request, db)
      if (!user) return err('Unauthorized', 401)

      if (user.ageStatus === 'UNKNOWN') {
        return err('Please set your age before posting', 403)
      }

      const body = await request.json()
      const { caption, mediaIds, collegeId } = body

      if (!caption && (!mediaIds || mediaIds.length === 0)) {
        return err('Post must have caption or media')
      }

      // Child users can only post text
      if (user.ageStatus === 'CHILD' && mediaIds && mediaIds.length > 0) {
        return err('Media posting not available for users under 18', 403)
      }

      let media = []
      if (mediaIds && mediaIds.length > 0) {
        const assets = await db.collection('media_assets')
          .find({ id: { $in: mediaIds }, ownerId: user.id })
          .toArray()
        media = assets.map(a => ({ id: a.id, url: `/api/media/${a.id}`, type: a.type, width: a.width, height: a.height }))
      }

      const now = new Date()
      const post = {
        id: uuidv4(),
        kind: 'POST',
        authorId: user.id,
        caption: caption ? caption.slice(0, 2200) : '',
        media,
        visibility: 'PUBLIC',
        riskScore: 0,
        policyReasons: [],
        collegeId: collegeId || user.collegeId || null,
        houseId: user.houseId || null,
        likeCount: 0,
        dislikeCountInternal: 0,
        commentCount: 0,
        saveCount: 0,
        shareCount: 0,
        syntheticDeclaration: body.syntheticDeclaration || false,
        syntheticLabelStatus: body.syntheticDeclaration ? 'DECLARED' : 'UNKNOWN',
        distributionStage: 0,
        createdAt: now,
        updatedAt: now
      }

      await db.collection('content_items').insertOne(post)
      await db.collection('users').updateOne({ id: user.id }, { $inc: { postsCount: 1 } })

      if (post.collegeId) {
        await db.collection('colleges').updateOne({ id: post.collegeId }, { $inc: { contentCount: 1 } })
      }

      await writeAudit(db, 'CONTENT_CREATED', user.id, 'CONTENT', post.id)

      const enriched = await enrichPosts(db, [post], user.id)
      return ok({ post: enriched[0] }, 201)
    }

    if (path[0] === 'content' && path.length === 2 && method === 'GET') {
      const contentId = path[1]
      const post = await db.collection('content_items').findOne({ id: contentId })
      if (!post || post.visibility === 'REMOVED') return err('Content not found', 404)

      const currentUser = await authenticate(request, db)
      const enriched = await enrichPosts(db, [post], currentUser?.id)
      return ok({ post: enriched[0] })
    }

    if (path[0] === 'content' && path.length === 2 && method === 'DELETE') {
      const user = await authenticate(request, db)
      if (!user) return err('Unauthorized', 401)

      const contentId = path[1]
      const post = await db.collection('content_items').findOne({ id: contentId })
      if (!post) return err('Content not found', 404)
      if (post.authorId !== user.id && user.role === 'USER') {
        return err('Forbidden', 403)
      }

      await db.collection('content_items').updateOne(
        { id: contentId },
        { $set: { visibility: 'REMOVED', updatedAt: new Date() } }
      )
      await db.collection('users').updateOne({ id: post.authorId }, { $inc: { postsCount: -1 } })
      await writeAudit(db, 'CONTENT_REMOVED', user.id, 'CONTENT', contentId)

      return ok({ message: 'Content removed' })
    }

    // ========================
    // FEED ROUTES
    // ========================
    if (route === '/feed/public' && method === 'GET') {
      const url = new URL(request.url)
      const cursor = url.searchParams.get('cursor')
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)

      const query = {
        visibility: 'PUBLIC',
        kind: 'POST'
      }
      if (cursor) {
        query.createdAt = { $lt: new Date(cursor) }
      }

      const posts = await db.collection('content_items')
        .find(query)
        .sort({ createdAt: -1 })
        .limit(limit + 1)
        .toArray()

      const hasMore = posts.length > limit
      const items = posts.slice(0, limit)

      const currentUser = await authenticate(request, db)
      const enriched = await enrichPosts(db, items, currentUser?.id)

      return ok({
        items: enriched,
        nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null
      })
    }

    if (route === '/feed/following' && method === 'GET') {
      const user = await authenticate(request, db)
      if (!user) return err('Unauthorized', 401)

      const url = new URL(request.url)
      const cursor = url.searchParams.get('cursor')
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)

      const follows = await db.collection('follows')
        .find({ followerId: user.id })
        .toArray()
      const followeeIds = follows.map(f => f.followeeId)
      followeeIds.push(user.id) // Include own posts

      const query = {
        authorId: { $in: followeeIds },
        visibility: 'PUBLIC',
        kind: 'POST'
      }
      if (cursor) {
        query.createdAt = { $lt: new Date(cursor) }
      }

      const posts = await db.collection('content_items')
        .find(query)
        .sort({ createdAt: -1 })
        .limit(limit + 1)
        .toArray()

      const hasMore = posts.length > limit
      const items = posts.slice(0, limit)
      const enriched = await enrichPosts(db, items, user.id)

      return ok({
        items: enriched,
        nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null
      })
    }

    if (path[0] === 'feed' && path[1] === 'college' && path.length === 3 && method === 'GET') {
      const collegeId = path[2]
      const url = new URL(request.url)
      const cursor = url.searchParams.get('cursor')
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)

      const query = {
        collegeId,
        visibility: 'PUBLIC',
        kind: 'POST'
      }
      if (cursor) {
        query.createdAt = { $lt: new Date(cursor) }
      }

      const posts = await db.collection('content_items')
        .find(query)
        .sort({ createdAt: -1 })
        .limit(limit + 1)
        .toArray()

      const hasMore = posts.length > limit
      const items = posts.slice(0, limit)

      const currentUser = await authenticate(request, db)
      const enriched = await enrichPosts(db, items, currentUser?.id)

      return ok({
        items: enriched,
        nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null
      })
    }

    // ========================
    // SOCIAL ROUTES - Follow
    // ========================
    if (path[0] === 'follow' && path.length === 2 && method === 'POST') {
      const user = await authenticate(request, db)
      if (!user) return err('Unauthorized', 401)

      const targetId = path[1]
      if (targetId === user.id) return err('Cannot follow yourself')

      const target = await db.collection('users').findOne({ id: targetId })
      if (!target) return err('User not found', 404)

      const existing = await db.collection('follows').findOne({
        followerId: user.id,
        followeeId: targetId
      })
      if (existing) return ok({ message: 'Already following' })

      await db.collection('follows').insertOne({
        id: uuidv4(),
        followerId: user.id,
        followeeId: targetId,
        createdAt: new Date()
      })

      await db.collection('users').updateOne({ id: user.id }, { $inc: { followingCount: 1 } })
      await db.collection('users').updateOne({ id: targetId }, { $inc: { followersCount: 1 } })

      return ok({ message: 'Followed', isFollowing: true })
    }

    if (path[0] === 'follow' && path.length === 2 && method === 'DELETE') {
      const user = await authenticate(request, db)
      if (!user) return err('Unauthorized', 401)

      const targetId = path[1]
      const result = await db.collection('follows').deleteOne({
        followerId: user.id,
        followeeId: targetId
      })

      if (result.deletedCount > 0) {
        await db.collection('users').updateOne({ id: user.id }, { $inc: { followingCount: -1 } })
        await db.collection('users').updateOne({ id: targetId }, { $inc: { followersCount: -1 } })
      }

      return ok({ message: 'Unfollowed', isFollowing: false })
    }

    // ========================
    // SOCIAL ROUTES - Reactions
    // ========================
    if (path[0] === 'content' && path.length === 3 && path[2] === 'like' && method === 'POST') {
      const user = await authenticate(request, db)
      if (!user) return err('Unauthorized', 401)

      const contentId = path[1]
      const post = await db.collection('content_items').findOne({ id: contentId })
      if (!post) return err('Content not found', 404)

      const existing = await db.collection('reactions').findOne({ userId: user.id, contentId })

      if (existing) {
        if (existing.type === 'LIKE') return ok({ message: 'Already liked' })
        // Change from dislike to like
        await db.collection('reactions').updateOne(
          { userId: user.id, contentId },
          { $set: { type: 'LIKE', updatedAt: new Date() } }
        )
        await db.collection('content_items').updateOne(
          { id: contentId },
          { $inc: { likeCount: 1, dislikeCountInternal: -1 } }
        )
      } else {
        await db.collection('reactions').insertOne({
          id: uuidv4(),
          userId: user.id,
          contentId,
          type: 'LIKE',
          createdAt: new Date()
        })
        await db.collection('content_items').updateOne(
          { id: contentId },
          { $inc: { likeCount: 1 } }
        )
      }

      const updated = await db.collection('content_items').findOne({ id: contentId })
      return ok({ likeCount: updated.likeCount, viewerHasLiked: true, viewerHasDisliked: false })
    }

    if (path[0] === 'content' && path.length === 3 && path[2] === 'dislike' && method === 'POST') {
      const user = await authenticate(request, db)
      if (!user) return err('Unauthorized', 401)

      const contentId = path[1]
      const post = await db.collection('content_items').findOne({ id: contentId })
      if (!post) return err('Content not found', 404)

      const existing = await db.collection('reactions').findOne({ userId: user.id, contentId })

      if (existing) {
        if (existing.type === 'DISLIKE') return ok({ message: 'Already disliked' })
        await db.collection('reactions').updateOne(
          { userId: user.id, contentId },
          { $set: { type: 'DISLIKE', updatedAt: new Date() } }
        )
        await db.collection('content_items').updateOne(
          { id: contentId },
          { $inc: { likeCount: -1, dislikeCountInternal: 1 } }
        )
      } else {
        await db.collection('reactions').insertOne({
          id: uuidv4(),
          userId: user.id,
          contentId,
          type: 'DISLIKE',
          createdAt: new Date()
        })
        await db.collection('content_items').updateOne(
          { id: contentId },
          { $inc: { dislikeCountInternal: 1 } }
        )
      }

      return ok({ viewerHasLiked: false, viewerHasDisliked: true })
    }

    if (path[0] === 'content' && path.length === 3 && path[2] === 'reaction' && method === 'DELETE') {
      const user = await authenticate(request, db)
      if (!user) return err('Unauthorized', 401)

      const contentId = path[1]
      const existing = await db.collection('reactions').findOne({ userId: user.id, contentId })
      if (!existing) return ok({ message: 'No reaction' })

      await db.collection('reactions').deleteOne({ userId: user.id, contentId })

      if (existing.type === 'LIKE') {
        await db.collection('content_items').updateOne({ id: contentId }, { $inc: { likeCount: -1 } })
      } else {
        await db.collection('content_items').updateOne({ id: contentId }, { $inc: { dislikeCountInternal: -1 } })
      }

      return ok({ viewerHasLiked: false, viewerHasDisliked: false })
    }

    // ========================
    // SOCIAL ROUTES - Save
    // ========================
    if (path[0] === 'content' && path.length === 3 && path[2] === 'save' && method === 'POST') {
      const user = await authenticate(request, db)
      if (!user) return err('Unauthorized', 401)

      const contentId = path[1]
      const existing = await db.collection('saves').findOne({ userId: user.id, contentId })
      if (existing) return ok({ saved: true })

      await db.collection('saves').insertOne({
        id: uuidv4(),
        userId: user.id,
        contentId,
        createdAt: new Date()
      })
      await db.collection('content_items').updateOne({ id: contentId }, { $inc: { saveCount: 1 } })

      return ok({ saved: true })
    }

    if (path[0] === 'content' && path.length === 3 && path[2] === 'save' && method === 'DELETE') {
      const user = await authenticate(request, db)
      if (!user) return err('Unauthorized', 401)

      const contentId = path[1]
      const result = await db.collection('saves').deleteOne({ userId: user.id, contentId })
      if (result.deletedCount > 0) {
        await db.collection('content_items').updateOne({ id: contentId }, { $inc: { saveCount: -1 } })
      }

      return ok({ saved: false })
    }

    // ========================
    // SOCIAL ROUTES - Comments
    // ========================
    if (path[0] === 'content' && path.length === 3 && path[2] === 'comments' && method === 'POST') {
      const user = await authenticate(request, db)
      if (!user) return err('Unauthorized', 401)

      const contentId = path[1]
      const post = await db.collection('content_items').findOne({ id: contentId })
      if (!post) return err('Content not found', 404)

      const body = await request.json()
      if (!body.body || body.body.trim().length === 0) {
        return err('Comment body is required')
      }

      const comment = {
        id: uuidv4(),
        contentId,
        authorId: user.id,
        body: body.body.slice(0, 1000),
        createdAt: new Date()
      }

      await db.collection('comments').insertOne(comment)
      await db.collection('content_items').updateOne({ id: contentId }, { $inc: { commentCount: 1 } })

      const author = await db.collection('users').findOne({ id: user.id })
      const { _id, ...cleanComment } = comment

      return ok({
        comment: {
          ...cleanComment,
          author: sanitizeUser(author)
        }
      }, 201)
    }

    if (path[0] === 'content' && path.length === 3 && path[2] === 'comments' && method === 'GET') {
      const contentId = path[1]
      const url = new URL(request.url)
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50)
      const cursor = url.searchParams.get('cursor')

      const query = { contentId }
      if (cursor) {
        query.createdAt = { $lt: new Date(cursor) }
      }

      const comments = await db.collection('comments')
        .find(query)
        .sort({ createdAt: -1 })
        .limit(limit + 1)
        .toArray()

      const hasMore = comments.length > limit
      const items = comments.slice(0, limit)

      const authorIds = [...new Set(items.map(c => c.authorId))]
      const authors = await db.collection('users').find({ id: { $in: authorIds } }).toArray()
      const authorMap = {}
      authors.forEach(a => { authorMap[a.id] = sanitizeUser(a) })

      const enriched = items.map(c => {
        const { _id, ...clean } = c
        return { ...clean, author: authorMap[c.authorId] || null }
      })

      return ok({
        comments: enriched,
        nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null
      })
    }

    // ========================
    // REPORT ROUTES
    // ========================
    if (route === '/reports' && method === 'POST') {
      const user = await authenticate(request, db)
      if (!user) return err('Unauthorized', 401)

      const body = await request.json()
      const { targetType, targetId, reasonCode, details } = body

      if (!targetType || !targetId || !reasonCode) {
        return err('targetType, targetId, and reasonCode are required')
      }

      const report = {
        id: uuidv4(),
        reporterId: user.id,
        targetType,
        targetId,
        reasonCode,
        details: details?.slice(0, 500) || '',
        status: 'OPEN',
        createdAt: new Date()
      }

      await db.collection('reports').insertOne(report)
      await writeAudit(db, 'REPORT_CREATED', user.id, targetType, targetId, { reasonCode })

      return ok({ report: { id: report.id, status: 'OPEN' } }, 201)
    }

    // ========================
    // MEDIA ROUTES
    // ========================
    if (route === '/media/upload' && method === 'POST') {
      const user = await authenticate(request, db)
      if (!user) return err('Unauthorized', 401)

      if (user.ageStatus === 'CHILD') {
        return err('Media upload not available for users under 18', 403)
      }

      const body = await request.json()
      const { data, mimeType, type } = body

      if (!data || !mimeType) {
        return err('data (base64) and mimeType are required')
      }

      // Limit to ~5MB base64
      if (data.length > 7 * 1024 * 1024) {
        return err('File too large. Max 5MB.', 413)
      }

      const asset = {
        id: uuidv4(),
        ownerId: user.id,
        type: type || 'IMAGE',
        mimeType,
        data,
        width: body.width || null,
        height: body.height || null,
        status: 'READY',
        createdAt: new Date()
      }

      await db.collection('media_assets').insertOne(asset)

      return ok({ 
        id: asset.id, 
        url: `/api/media/${asset.id}`,
        type: asset.type 
      }, 201)
    }

    if (path[0] === 'media' && path.length === 2 && method === 'GET') {
      const assetId = path[1]
      const asset = await db.collection('media_assets').findOne({ id: assetId })
      if (!asset) return err('Media not found', 404)

      // Return as image
      const buffer = Buffer.from(asset.data, 'base64')
      const response = new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Type': asset.mimeType,
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      })
      return cors(response)
    }

    // ========================
    // CONSENT ROUTES
    // ========================
    if (route === '/legal/consent' && method === 'GET') {
      let notice = await db.collection('consent_notices').findOne({ active: true })
      if (!notice) {
        // Create default notice
        notice = {
          id: uuidv4(),
          version: '1.0',
          title: 'Tribe Privacy & Terms',
          body: 'By using Tribe, you agree to our Terms of Service and Privacy Policy. We collect minimal personal data (phone number, display name, age, college affiliation) to provide our services. Your data is stored securely and never sold to third parties. For users under 18, we apply additional protections including restricted features and no behavioral tracking. You can request deletion of your data at any time.',
          active: true,
          createdAt: new Date()
        }
        await db.collection('consent_notices').insertOne(notice)
      }
      const { _id, ...clean } = notice
      return ok({ notice: clean })
    }

    if (route === '/legal/accept' && method === 'POST') {
      const user = await authenticate(request, db)
      if (!user) return err('Unauthorized', 401)

      const body = await request.json()
      const { version } = body

      await db.collection('consent_acceptances').insertOne({
        id: uuidv4(),
        userId: user.id,
        noticeVersion: version || '1.0',
        acceptedAt: new Date(),
        ip: request.headers.get('x-forwarded-for') || 'unknown',
        userAgent: request.headers.get('user-agent') || 'unknown'
      })

      return ok({ accepted: true })
    }

    // ========================
    // SUGGESTION ROUTES
    // ========================
    if (route === '/suggestions/users' && method === 'GET') {
      const user = await authenticate(request, db)
      if (!user) return err('Unauthorized', 401)

      const follows = await db.collection('follows')
        .find({ followerId: user.id })
        .toArray()
      const followingIds = follows.map(f => f.followeeId)
      followingIds.push(user.id)

      // Suggest users from same college, then popular users
      const query = { id: { $nin: followingIds }, isBanned: false }
      if (user.collegeId) {
        const collegeUsers = await db.collection('users')
          .find({ ...query, collegeId: user.collegeId })
          .sort({ followersCount: -1 })
          .limit(10)
          .toArray()

        const otherUsers = await db.collection('users')
          .find({ ...query, collegeId: { $ne: user.collegeId } })
          .sort({ followersCount: -1 })
          .limit(10)
          .toArray()

        return ok({ users: [...collegeUsers, ...otherUsers].slice(0, 15).map(sanitizeUser) })
      }

      const users = await db.collection('users')
        .find(query)
        .sort({ followersCount: -1 })
        .limit(15)
        .toArray()

      return ok({ users: users.map(sanitizeUser) })
    }

    // ========================
    // ADMIN ROUTES
    // ========================
    if (route === '/admin/colleges/seed' && method === 'POST') {
      const { collegesData } = await import('/app/lib/colleges-data.js')
      
      const existing = await db.collection('colleges').countDocuments()
      if (existing > 50) {
        return ok({ message: `Already seeded (${existing} colleges)`, count: existing })
      }

      // Create unique key using aisheCode or name+city to prevent duplicates
      const seen = new Set()
      const uniqueColleges = collegesData.filter(c => {
        const key = (c.aisheCode || `${c.name}|${c.city}|${c.state}`).toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      const docs = uniqueColleges.map(c => ({
        id: uuidv4(),
        officialName: c.name,
        normalizedName: c.name.toLowerCase(),
        city: c.city,
        state: c.state,
        type: c.type,
        institutionType: c.type,
        aisheCode: c.aisheCode || null,
        verificationStatus: 'SEEDED',
        aliases: [],
        riskFlags: [],
        membersCount: 0,
        contentCount: 0,
        createdAt: new Date(),
        updatedAt: new Date()
      }))

      // Use ordered:false to skip duplicates
      try {
        const result = await db.collection('colleges').insertMany(docs, { ordered: false })
        return ok({ message: 'Colleges seeded', count: result.insertedCount })
      } catch (e) {
        // Some might be duplicates
        return ok({ message: 'Colleges seeded (some skipped)', count: docs.length })
      }
    }

    if (route === '/admin/stats' && method === 'GET') {
      const [users, posts, colleges, reports] = await Promise.all([
        db.collection('users').countDocuments(),
        db.collection('content_items').countDocuments({ visibility: 'PUBLIC' }),
        db.collection('colleges').countDocuments(),
        db.collection('reports').countDocuments({ status: 'OPEN' }),
      ])
      return ok({ users, posts, colleges, openReports: reports })
    }

    // ========================
    // SEARCH ROUTES
    // ========================
    if (route === '/search' && method === 'GET') {
      const url = new URL(request.url)
      const q = url.searchParams.get('q') || ''
      const type = url.searchParams.get('type') || 'all'

      if (q.length < 2) return ok({ users: [], colleges: [] })

      const results = {}

      if (type === 'all' || type === 'users') {
        const users = await db.collection('users')
          .find({
            $or: [
              { displayName: { $regex: q, $options: 'i' } },
              { username: { $regex: q, $options: 'i' } }
            ],
            isBanned: false
          })
          .limit(10)
          .toArray()
        results.users = users.map(sanitizeUser)
      }

      if (type === 'all' || type === 'colleges') {
        const colleges = await db.collection('colleges')
          .find({ normalizedName: { $regex: q.toLowerCase(), $options: 'i' } })
          .limit(10)
          .toArray()
        results.colleges = colleges.map(c => { const { _id, ...rest } = c; return rest })
      }

      return ok(results)
    }

    // Route not found
    return err(`Route ${route} not found`, 404)

  } catch (error) {
    console.error('API Error:', error)
    return err('Internal server error: ' + error.message, 500)
  }
}

// ===== Enrich Posts Helper =====
async function enrichPosts(db, posts, viewerId) {
  if (posts.length === 0) return []

  const authorIds = [...new Set(posts.map(p => p.authorId))]
  const authors = await db.collection('users').find({ id: { $in: authorIds } }).toArray()
  const authorMap = {}
  authors.forEach(a => { authorMap[a.id] = sanitizeUser(a) })

  let viewerReactions = {}
  let viewerSaves = {}

  if (viewerId) {
    const contentIds = posts.map(p => p.id)
    const reactions = await db.collection('reactions')
      .find({ userId: viewerId, contentId: { $in: contentIds } })
      .toArray()
    reactions.forEach(r => { viewerReactions[r.contentId] = r.type })

    const saves = await db.collection('saves')
      .find({ userId: viewerId, contentId: { $in: contentIds } })
      .toArray()
    saves.forEach(s => { viewerSaves[s.contentId] = true })
  }

  return posts.map(p => {
    const { _id, dislikeCountInternal, ...clean } = p
    return {
      ...clean,
      author: authorMap[p.authorId] || null,
      viewerHasLiked: viewerReactions[p.id] === 'LIKE',
      viewerHasDisliked: viewerReactions[p.id] === 'DISLIKE',
      viewerHasSaved: !!viewerSaves[p.id]
    }
  })
}

// Export all HTTP methods
export const GET = handleRoute
export const POST = handleRoute
export const PUT = handleRoute
export const DELETE = handleRoute
export const PATCH = handleRoute
