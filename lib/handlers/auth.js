import { v4 as uuidv4 } from 'uuid'
import { Config, assignHouse, ErrorCode } from '../constants.js'
import { generateSalt, hashPin, verifyPin, generateToken, sanitizeUser, writeAudit, requireAuth, checkLoginThrottle, recordLoginFailure, clearLoginFailures } from '../auth-utils.js'

export async function handleAuth(path, method, request, db) {
  const route = path.join('/')

  // ========================
  // POST /auth/register
  // ========================
  if (route === 'auth/register' && method === 'POST') {
    const body = await request.json()
    const { phone, pin, displayName } = body

    if (!phone || !pin || !displayName) {
      return { error: 'phone, pin, and displayName are required', code: ErrorCode.VALIDATION, status: 400 }
    }
    if (!/^\d{10}$/.test(phone)) {
      return { error: 'Phone must be exactly 10 digits', code: ErrorCode.VALIDATION, status: 400 }
    }
    if (!/^\d{4}$/.test(pin.toString())) {
      return { error: 'PIN must be exactly 4 digits', code: ErrorCode.VALIDATION, status: 400 }
    }
    const trimmedName = displayName.trim()
    if (trimmedName.length < Config.MIN_DISPLAY_NAME || trimmedName.length > Config.MAX_DISPLAY_NAME) {
      return { error: `displayName must be ${Config.MIN_DISPLAY_NAME}-${Config.MAX_DISPLAY_NAME} characters`, code: ErrorCode.VALIDATION, status: 400 }
    }

    const existing = await db.collection('users').findOne({ phone })
    if (existing) {
      return { error: 'Phone number already registered', code: ErrorCode.CONFLICT, status: 409 }
    }

    const salt = generateSalt()
    const pinH = hashPin(pin, salt)
    const userId = uuidv4()
    const now = new Date()

    // Deterministic house assignment
    const house = assignHouse(userId)
    await ensureHouseSeeded(db)
    const houseDoc = await db.collection('houses').findOne({ slug: house.slug })

    const user = {
      id: userId,
      phone,
      pinHash: pinH,
      pinSalt: salt,
      displayName: trimmedName,
      username: null,
      bio: '',
      avatarMediaId: null,
      ageStatus: 'UNKNOWN',
      birthYear: null,
      role: 'USER',
      collegeId: null,
      collegeName: null,
      houseId: houseDoc?.id || null,
      houseSlug: house.slug,
      houseName: house.name,
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

    // Increment house member count
    if (houseDoc) {
      await db.collection('houses').updateOne({ id: houseDoc.id }, { $inc: { membersCount: 1 } })
    }

    const token = generateToken()
    await db.collection('sessions').insertOne({
      id: uuidv4(),
      userId,
      token,
      deviceInfo: request.headers.get('user-agent') || 'unknown',
      createdAt: now,
      expiresAt: new Date(now.getTime() + Config.SESSION_TTL_MS),
    })

    await writeAudit(db, 'USER_REGISTERED', userId, 'USER', userId, { houseSlug: house.slug })

    return { data: { token, user: sanitizeUser(user) }, status: 201 }
  }

  // ========================
  // POST /auth/login
  // ========================
  if (route === 'auth/login' && method === 'POST') {
    const body = await request.json()
    const { phone, pin } = body

    if (!phone || !pin) {
      return { error: 'phone and pin are required', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Brute force protection
    const throttle = checkLoginThrottle(phone)
    if (!throttle.allowed) {
      return {
        error: `Too many failed attempts. Try again in ${throttle.retryAfterSec} seconds`,
        code: ErrorCode.RATE_LIMITED,
        status: 429,
        headers: { 'Retry-After': String(throttle.retryAfterSec) },
      }
    }

    const user = await db.collection('users').findOne({ phone })
    if (!user) {
      recordLoginFailure(phone)
      return { error: 'Invalid phone or PIN', code: ErrorCode.UNAUTHORIZED, status: 401 }
    }
    if (user.isBanned) {
      return { error: 'Account permanently banned', code: ErrorCode.BANNED, status: 403 }
    }
    if (user.suspendedUntil && new Date(user.suspendedUntil) > new Date()) {
      return { error: `Account suspended until ${new Date(user.suspendedUntil).toISOString()}`, code: ErrorCode.SUSPENDED, status: 403 }
    }

    try {
      if (!verifyPin(pin, user.pinSalt, user.pinHash)) {
        recordLoginFailure(phone)
        await writeAudit(db, 'LOGIN_FAILED', null, 'USER', user.id, { phone, reason: 'invalid_pin' })
        return { error: 'Invalid phone or PIN', code: ErrorCode.UNAUTHORIZED, status: 401 }
      }
    } catch {
      recordLoginFailure(phone)
      return { error: 'Invalid phone or PIN', code: ErrorCode.UNAUTHORIZED, status: 401 }
    }

    // Success — clear brute force tracker
    clearLoginFailures(phone)

    const token = generateToken()
    const now = new Date()
    await db.collection('sessions').insertOne({
      id: uuidv4(),
      userId: user.id,
      token,
      deviceInfo: request.headers.get('user-agent') || 'unknown',
      createdAt: now,
      expiresAt: new Date(now.getTime() + Config.SESSION_TTL_MS),
    })

    await db.collection('users').updateOne({ id: user.id }, { $set: { lastActiveAt: now } })
    await writeAudit(db, 'USER_LOGIN', user.id, 'USER', user.id)

    return { data: { token, user: sanitizeUser(user) } }
  }

  // ========================
  // POST /auth/logout
  // ========================
  if (route === 'auth/logout' && method === 'POST') {
    const authHeader = request.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      await db.collection('sessions').deleteOne({ token: authHeader.slice(7) })
    }
    return { data: { message: 'Logged out' } }
  }

  // ========================
  // GET /auth/me
  // ========================
  if (route === 'auth/me' && method === 'GET') {
    const user = await requireAuth(request, db)
    return { data: { user: sanitizeUser(user) } }
  }

  // ========================
  // DELETE /auth/sessions — Revoke all sessions (force logout everywhere)
  // ========================
  if (route === 'auth/sessions' && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const result = await db.collection('sessions').deleteMany({ userId: user.id })
    await writeAudit(db, 'ALL_SESSIONS_REVOKED', user.id, 'USER', user.id, { count: result.deletedCount })
    return { data: { message: 'All sessions revoked', revokedCount: result.deletedCount } }
  }

  // ========================
  // GET /auth/sessions — List active sessions
  // ========================
  if (route === 'auth/sessions' && method === 'GET') {
    const user = await requireAuth(request, db)
    const sessions = await db.collection('sessions')
      .find({ userId: user.id, expiresAt: { $gt: new Date() } })
      .sort({ createdAt: -1 })
      .toArray()
    return {
      data: {
        sessions: sessions.map(s => ({
          id: s.id,
          deviceInfo: s.deviceInfo,
          createdAt: s.createdAt,
          expiresAt: s.expiresAt,
          isCurrent: s.token === request.headers.get('authorization')?.slice(7),
        })),
      },
    }
  }

  // ========================
  // PATCH /auth/pin — Change PIN
  // ========================
  if (route === 'auth/pin' && method === 'PATCH') {
    const user = await requireAuth(request, db)
    const body = await request.json()
    const { currentPin, newPin } = body

    if (!currentPin || !newPin) {
      return { error: 'currentPin and newPin are required', code: ErrorCode.VALIDATION, status: 400 }
    }
    if (!/^\d{4}$/.test(newPin.toString())) {
      return { error: 'New PIN must be exactly 4 digits', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Verify current PIN
    const fullUser = await db.collection('users').findOne({ id: user.id })
    try {
      if (!verifyPin(currentPin, fullUser.pinSalt, fullUser.pinHash)) {
        return { error: 'Current PIN is incorrect', code: ErrorCode.UNAUTHORIZED, status: 401 }
      }
    } catch {
      return { error: 'Current PIN is incorrect', code: ErrorCode.UNAUTHORIZED, status: 401 }
    }

    const newSalt = generateSalt()
    const newHash = hashPin(newPin, newSalt)
    await db.collection('users').updateOne({ id: user.id }, {
      $set: { pinHash: newHash, pinSalt: newSalt, updatedAt: new Date() },
    })

    // Revoke all other sessions for security
    const currentToken = request.headers.get('authorization')?.slice(7)
    await db.collection('sessions').deleteMany({ userId: user.id, token: { $ne: currentToken } })
    await writeAudit(db, 'PIN_CHANGED', user.id, 'USER', user.id)

    return { data: { message: 'PIN changed. All other sessions revoked.' } }
  }

  return null
}

// Seed houses once
let housesSeeded = false
async function ensureHouseSeeded(db) {
  if (housesSeeded) return
  const { HOUSES } = await import('../constants.js')
  const count = await db.collection('houses').countDocuments()
  if (count >= 12) { housesSeeded = true; return }

  for (const h of HOUSES) {
    const existing = await db.collection('houses').findOne({ slug: h.slug })
    if (!existing) {
      await db.collection('houses').insertOne({
        id: uuidv4(),
        slug: h.slug,
        name: h.name,
        motto: h.motto,
        color: h.color,
        domain: h.domain,
        icon: h.icon,
        membersCount: 0,
        totalPoints: 0,
        createdAt: new Date(),
      })
    }
  }
  housesSeeded = true
}
