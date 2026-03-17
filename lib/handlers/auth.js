import { v4 as uuidv4 } from 'uuid'
import { Config, ErrorCode } from '../constants.js'
import {
  generateSalt, hashPin, verifyPin, generateToken, sanitizeUser, sanitizeUserCdn,
  writeAudit, requireAuth, checkLoginThrottle, recordLoginFailure,
  clearLoginFailures, createSession, rotateRefreshToken,
} from '../auth-utils.js'
import { assignTribeV3 } from '../tribe-constants.js'
import { writeSecurityAudit, extractIP, sanitizeTextInput } from '../security.js'

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
    if (typeof phone !== 'string' || typeof pin !== 'string' || typeof displayName !== 'string') {
      return { error: 'phone, pin, and displayName must be strings', code: ErrorCode.VALIDATION, status: 400 }
    }
    if (!/^\d{10}$/.test(phone)) {
      return { error: 'Phone must be exactly 10 digits', code: ErrorCode.VALIDATION, status: 400 }
    }
    if (!/^\d{4}$/.test(pin.toString())) {
      return { error: 'PIN must be exactly 4 digits', code: ErrorCode.VALIDATION, status: 400 }
    }
    const trimmedName = sanitizeTextInput(displayName.trim())
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

    // Tribe assignment at signup (replaces legacy house system)
    const tribeData = assignTribeV3(userId)
    const tribeDoc = await db.collection('tribes').findOne({ tribeCode: tribeData.tribeCode })

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
      tribeId: tribeDoc?.id || null,
      tribeCode: tribeDoc?.tribeCode || null,
      tribeName: tribeDoc?.tribeName || null,
      tribeHeroName: tribeDoc?.heroName || null,
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

    // Increment tribe member count
    if (tribeDoc) {
      await db.collection('tribes').updateOne({ id: tribeDoc.id }, { $inc: { membersCount: 1 }, $set: { updatedAt: now } })
    }

    // Stage 2: Create session with access + refresh tokens
    const sessionData = await createSession(db, userId, request)

    await writeAudit(db, 'USER_REGISTERED', userId, 'USER', userId, { tribeCode: tribeDoc?.tribeCode })
    await writeSecurityAudit(db, {
      eventType: 'REGISTER_SUCCESS',
      actorId: userId,
      targetType: 'USER',
      targetId: userId,
      ip: extractIP(request),
      userAgent: request.headers.get('user-agent'),
      severity: 'INFO',
    })

    // Record tribe membership
    try {
      if (tribeDoc) {
        const membershipExists = await db.collection('user_tribe_memberships').findOne({ userId, isPrimary: true })
        if (!membershipExists) {
          await db.collection('user_tribe_memberships').insertOne({
            id: uuidv4(),
            userId,
            tribeId: tribeDoc.id,
            tribeCode: tribeDoc.tribeCode,
            assignmentMethod: 'SIGNUP_AUTO_V3',
            assignmentVersion: 'V3',
            assignedAt: now,
            assignedBy: 'SYSTEM',
            status: 'ACTIVE',
            isPrimary: true,
            migrationSource: null,
            legacyHouseId: null,
            reassignmentCount: 0,
            auditRef: uuidv4(),
            createdAt: now,
            updatedAt: now,
          })
        }
      }
    } catch (e) {
      const { default: logger } = await import('@/lib/logger')
      logger.warn('AUTH', 'tribe_membership_record_failed', { error: e.message })
    }

    return {
      data: {
        // Stage 2: New token model
        accessToken: sessionData.accessToken,
        refreshToken: sessionData.refreshToken,
        expiresIn: sessionData.expiresIn,
        // Backward compat: 'token' = accessToken
        token: sessionData.accessToken,
        user: await sanitizeUserCdn(user, db),
      },
      status: 201,
    }
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
    if (typeof phone !== 'string' || typeof pin !== 'string') {
      return { error: 'phone and pin must be strings', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Brute force protection
    const throttle = checkLoginThrottle(phone)
    if (!throttle.allowed) {
      await writeSecurityAudit(db, {
        eventType: 'LOGIN_THROTTLED',
        actorId: null,
        targetType: 'USER',
        targetId: null,
        ip: extractIP(request),
        userAgent: request.headers.get('user-agent'),
        metadata: { phone: `****${phone.slice(-4)}`, retryAfterSec: throttle.retryAfterSec },
        severity: 'WARN',
      })
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
      await writeSecurityAudit(db, {
        eventType: 'LOGIN_FAILED',
        actorId: null,
        targetType: 'USER',
        targetId: null,
        ip: extractIP(request),
        userAgent: request.headers.get('user-agent'),
        metadata: { phone: `****${phone.slice(-4)}`, reason: 'user_not_found' },
        severity: 'WARN',
      })
      return { error: 'Invalid phone or PIN', code: ErrorCode.UNAUTHORIZED, status: 401 }
    }
    if (user.isBanned) {
      await writeSecurityAudit(db, {
        eventType: 'LOGIN_BLOCKED_BANNED',
        actorId: user.id,
        targetType: 'USER',
        targetId: user.id,
        ip: extractIP(request),
        userAgent: request.headers.get('user-agent'),
        severity: 'WARN',
      })
      return { error: 'Account permanently banned', code: ErrorCode.BANNED, status: 403 }
    }
    if (user.suspendedUntil && new Date(user.suspendedUntil) > new Date()) {
      return { error: `Account suspended until ${new Date(user.suspendedUntil).toISOString()}`, code: ErrorCode.SUSPENDED, status: 403 }
    }

    try {
      if (!verifyPin(pin, user.pinSalt, user.pinHash)) {
        recordLoginFailure(phone)
        await writeSecurityAudit(db, {
          eventType: 'LOGIN_FAILED',
          actorId: user.id,
          targetType: 'USER',
          targetId: user.id,
          ip: extractIP(request),
          userAgent: request.headers.get('user-agent'),
          metadata: { reason: 'invalid_pin' },
          severity: 'WARN',
        })
        return { error: 'Invalid phone or PIN', code: ErrorCode.UNAUTHORIZED, status: 401 }
      }
    } catch (err) {
      // timingSafeEqual can throw if buffer sizes don't match — treat as auth failure
      const { default: logger } = await import('@/lib/logger')
      logger.warn('AUTH', 'pin_verify_error', { error: err.message, phone: `****${phone.slice(-4)}` })
      recordLoginFailure(phone)
      return { error: 'Invalid phone or PIN', code: ErrorCode.UNAUTHORIZED, status: 401 }
    }

    // Success — clear brute force tracker
    clearLoginFailures(phone)

    // Stage 2: Create session with access + refresh tokens
    const sessionData = await createSession(db, user.id, request)

    await db.collection('users').updateOne({ id: user.id }, { $set: { lastActiveAt: new Date() } })

    // Backfill tribeHeroName if missing (for existing users)
    if (user.tribeId && !user.tribeHeroName) {
      const tribe = await db.collection('tribes').findOne({ id: user.tribeId }, { projection: { _id: 0, heroName: 1 } })
      if (tribe?.heroName) {
        await db.collection('users').updateOne({ id: user.id }, { $set: { tribeHeroName: tribe.heroName } })
        user.tribeHeroName = tribe.heroName
      }
    }
    await writeAudit(db, 'USER_LOGIN', user.id, 'USER', user.id)
    await writeSecurityAudit(db, {
      eventType: 'LOGIN_SUCCESS',
      actorId: user.id,
      targetType: 'USER',
      targetId: user.id,
      ip: extractIP(request),
      userAgent: request.headers.get('user-agent'),
      metadata: { sessionId: sessionData.sessionId },
      severity: 'INFO',
    })

    return {
      data: {
        // Stage 2: New token model
        accessToken: sessionData.accessToken,
        refreshToken: sessionData.refreshToken,
        expiresIn: sessionData.expiresIn,
        // Backward compat
        token: sessionData.accessToken,
        user: await sanitizeUserCdn(user, db),
      },
    }
  }

  // ========================
  // POST /auth/refresh — Rotate refresh token (Stage 2)
  // ========================
  if (route === 'auth/refresh' && method === 'POST') {
    const body = await request.json()
    const { refreshToken } = body

    if (!refreshToken) {
      return { error: 'refreshToken is required', code: ErrorCode.VALIDATION, status: 400 }
    }

    const result = await rotateRefreshToken(db, refreshToken, request)

    if (result.error === 'REUSE_DETECTED') {
      await writeSecurityAudit(db, {
        eventType: 'REFRESH_TOKEN_REUSE_DETECTED',
        actorId: null,
        targetType: 'SESSION',
        targetId: null,
        ip: extractIP(request),
        userAgent: request.headers.get('user-agent'),
        metadata: { familyRevoked: true },
        severity: 'CRITICAL',
      })
      return {
        error: 'Refresh token has been reused. All sessions in this family have been revoked for security.',
        code: ErrorCode.REFRESH_TOKEN_REUSED,
        status: 401,
      }
    }
    if (result.error === 'INVALID_REFRESH_TOKEN' || result.error === 'REFRESH_TOKEN_EXPIRED') {
      await writeSecurityAudit(db, {
        eventType: 'REFRESH_FAILED',
        actorId: null,
        targetType: 'SESSION',
        targetId: null,
        ip: extractIP(request),
        userAgent: request.headers.get('user-agent'),
        metadata: { reason: result.error },
        severity: 'WARN',
      })
      return { error: 'Invalid or expired refresh token', code: ErrorCode.REFRESH_TOKEN_INVALID, status: 401 }
    }
    if (result.error === 'USER_INVALID') {
      return { error: 'Account is banned or does not exist', code: ErrorCode.BANNED, status: 403 }
    }
    if (result.error === 'USER_SUSPENDED') {
      return { error: 'Account is suspended', code: ErrorCode.SUSPENDED, status: 403 }
    }

    await writeSecurityAudit(db, {
      eventType: 'REFRESH_SUCCESS',
      actorId: result.userId,
      targetType: 'SESSION',
      targetId: result.sessionId,
      ip: extractIP(request),
      userAgent: request.headers.get('user-agent'),
      severity: 'INFO',
    })

    return {
      data: {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn,
        // Backward compat
        token: result.accessToken,
        user: await sanitizeUserCdn(result.user, db),
      },
    }
  }

  // ========================
  // POST /auth/logout
  // ========================
  if (route === 'auth/logout' && method === 'POST') {
    const authHeader = request.headers.get('authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      const session = await db.collection('sessions').findOneAndDelete({ token })
      if (session) {
        await writeSecurityAudit(db, {
          eventType: 'LOGOUT_CURRENT',
          actorId: session.userId,
          targetType: 'SESSION',
          targetId: session.id,
          ip: extractIP(request),
          userAgent: request.headers.get('user-agent'),
          severity: 'INFO',
        })
      }
    }
    return { data: { message: 'Logged out' } }
  }

  // ========================
  // GET /auth/check — Ultra-fast token validation (1ms, no user data)
  // Frontend uses this on app reopen — instant auth check
  // ========================
  if (route === 'auth/check' && method === 'GET') {
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return { data: { valid: false, reason: 'no_token' } }
    }
    const token = authHeader.slice(7)
    const session = await db.collection('sessions').findOne(
      { token, expiresAt: { $gt: new Date() } },
      { projection: { _id: 0, userId: 1, expiresAt: 1 } }
    )
    if (!session) {
      return { data: { valid: false, reason: 'expired' } }
    }
    return { data: { valid: true, userId: session.userId, expiresAt: session.expiresAt } }
  }

  // ========================
  // GET /auth/me
  // ========================
  if (route === 'auth/me' && method === 'GET') {
    const user = await requireAuth(request, db)
    return { data: { user: await sanitizeUserCdn(user, db) } }
  }

  // ========================
  // DELETE /auth/sessions — Revoke all sessions (force logout everywhere)
  // ========================
  if (route === 'auth/sessions' && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const result = await db.collection('sessions').deleteMany({ userId: user.id })
    await writeAudit(db, 'ALL_SESSIONS_REVOKED', user.id, 'USER', user.id, { count: result.deletedCount })
    await writeSecurityAudit(db, {
      eventType: 'REVOKE_ALL_SESSIONS',
      actorId: user.id,
      targetType: 'USER',
      targetId: user.id,
      ip: extractIP(request),
      userAgent: request.headers.get('user-agent'),
      metadata: { revokedCount: result.deletedCount },
      severity: 'INFO',
    })
    return { data: { message: 'All sessions revoked', revokedCount: result.deletedCount } }
  }

  // ========================
  // DELETE /auth/sessions/:id — Revoke one session by ID (Stage 2)
  // ========================
  if (path[0] === 'auth' && path[1] === 'sessions' && path.length === 3 && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const sessionId = path[2]

    const session = await db.collection('sessions').findOne({ id: sessionId, userId: user.id })
    if (!session) {
      return { error: 'Session not found', code: ErrorCode.SESSION_NOT_FOUND, status: 404 }
    }

    // Check if trying to revoke current session
    const currentToken = request.headers.get('authorization')?.slice(7)
    if (session.token === currentToken) {
      return { error: 'Cannot revoke current session via this endpoint. Use POST /auth/logout instead.', code: ErrorCode.VALIDATION, status: 400 }
    }

    await db.collection('sessions').deleteOne({ id: sessionId })
    await writeSecurityAudit(db, {
      eventType: 'REVOKE_ONE_SESSION',
      actorId: user.id,
      targetType: 'SESSION',
      targetId: sessionId,
      ip: extractIP(request),
      userAgent: request.headers.get('user-agent'),
      severity: 'INFO',
    })
    return { data: { message: 'Session revoked', sessionId } }
  }

  // ========================
  // GET /auth/sessions — List active sessions
  // ========================
  if (route === 'auth/sessions' && method === 'GET') {
    const user = await requireAuth(request, db)
    const now = new Date()
    const sessions = await db.collection('sessions')
      .find({
        userId: user.id,
        $or: [
          { refreshTokenExpiresAt: { $gt: now } },
          { expiresAt: { $gt: now }, refreshToken: { $exists: false } }, // legacy sessions
        ],
      })
      .sort({ createdAt: -1 })
      .toArray()

    const currentToken = request.headers.get('authorization')?.slice(7)

    return {
      data: {
        sessions: sessions.map(s => ({
          id: s.id,
          deviceInfo: s.deviceInfo,
          ipAddress: s.ipAddress || null,
          lastAccessedAt: s.lastAccessedAt || s.createdAt,
          createdAt: s.createdAt,
          expiresAt: s.refreshTokenExpiresAt || s.expiresAt,
          isCurrent: s.token === currentToken,
          // Never expose tokens
        })),
        count: sessions.length,
        maxSessions: Config.MAX_SESSIONS_PER_USER,
      },
    }
  }

  // ========================
  // POST /auth/forgot-pin — Reset PIN without login (phone + new PIN)
  // No OTP, simple: phone → newPin → confirmPin → done
  // ========================
  if (route === 'auth/forgot-pin' && method === 'POST') {
    const body = await request.json()
    const { phone, newPin, confirmPin } = body

    if (!phone || !newPin || !confirmPin) {
      return { error: 'phone, newPin, and confirmPin are required', code: ErrorCode.VALIDATION, status: 400 }
    }
    if (newPin !== confirmPin) {
      return { error: 'newPin and confirmPin do not match', code: ErrorCode.VALIDATION, status: 400 }
    }
    if (!/^\d{4,6}$/.test(newPin)) {
      return { error: 'PIN must be 4-6 digits', code: ErrorCode.VALIDATION, status: 400 }
    }

    const cleanPhone = phone.replace(/\D/g, '').slice(-10)
    const user = await db.collection('users').findOne({ phone: cleanPhone })
    if (!user) {
      return { error: 'No account found with this phone number', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    const salt = generateSalt()
    const pinHash = hashPin(newPin, salt)
    await db.collection('users').updateOne(
      { id: user.id },
      { $set: { pinHash, pinSalt: salt, updatedAt: new Date() } }
    )

    // Revoke all existing sessions for security
    await db.collection('sessions').deleteMany({ userId: user.id })

    await writeAudit(db, 'PIN_RESET', user.id, 'USER', user.id, { method: 'forgot-pin', phone: cleanPhone })

    return { data: { message: 'PIN reset successful. Please login with your new PIN.', phone: cleanPhone } }
  }

  // ========================
  // PATCH /auth/pin — Change PIN (Stage 2: Enhanced with re-auth and full revoke)
  // ========================
  if (route === 'auth/pin' && (method === 'PATCH' || method === 'PUT')) {
    const user = await requireAuth(request, db)
    const body = await request.json()
    const { currentPin, newPin } = body

    if (!currentPin || !newPin) {
      return { error: 'currentPin and newPin are required', code: ErrorCode.VALIDATION, status: 400 }
    }
    if (!/^\d{4}$/.test(newPin.toString())) {
      return { error: 'New PIN must be exactly 4 digits', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Verify current PIN (re-authentication for sensitive action)
    const fullUser = await db.collection('users').findOne({ id: user.id })
    try {
      if (!verifyPin(currentPin, fullUser.pinSalt, fullUser.pinHash)) {
        await writeSecurityAudit(db, {
          eventType: 'PIN_CHANGE_FAILED',
          actorId: user.id,
          targetType: 'USER',
          targetId: user.id,
          ip: extractIP(request),
          userAgent: request.headers.get('user-agent'),
          metadata: { reason: 'invalid_current_pin' },
          severity: 'WARN',
        })
        return { error: 'Current PIN is incorrect', code: ErrorCode.UNAUTHORIZED, status: 401 }
      }
    } catch (err) {
      const { default: logger } = await import('@/lib/logger')
      logger.warn('AUTH', 'pin_change_verify_error', { error: err.message })
      return { error: 'Current PIN is incorrect', code: ErrorCode.UNAUTHORIZED, status: 401 }
    }

    const newSalt = generateSalt()
    const newHash = hashPin(newPin, newSalt)
    await db.collection('users').updateOne({ id: user.id }, {
      $set: { pinHash: newHash, pinSalt: newSalt, updatedAt: new Date() },
    })

    // Stage 2: Revoke ALL other sessions, issue new token pair for current session
    const currentToken = request.headers.get('authorization')?.slice(7)
    const revokeResult = await db.collection('sessions').deleteMany({ userId: user.id, token: { $ne: currentToken } })

    // Create a fresh session for the current device
    const sessionData = await createSession(db, user.id, request)

    // Delete the old current session (replaced by the new one)
    await db.collection('sessions').deleteOne({ token: currentToken })

    await writeAudit(db, 'PIN_CHANGED', user.id, 'USER', user.id)
    await writeSecurityAudit(db, {
      eventType: 'PIN_CHANGED',
      actorId: user.id,
      targetType: 'USER',
      targetId: user.id,
      ip: extractIP(request),
      userAgent: request.headers.get('user-agent'),
      metadata: { otherSessionsRevoked: revokeResult.deletedCount },
      severity: 'INFO',
    })

    return {
      data: {
        message: 'PIN changed. All other sessions revoked. New tokens issued.',
        accessToken: sessionData.accessToken,
        refreshToken: sessionData.refreshToken,
        expiresIn: sessionData.expiresIn,
        // Backward compat
        token: sessionData.accessToken,
        revokedSessionCount: revokeResult.deletedCount,
      },
    }
  }

  return null
}
