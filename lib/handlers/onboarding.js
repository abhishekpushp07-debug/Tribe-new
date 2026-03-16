import { Config, ErrorCode } from '../constants.js'
import { requireAuth, sanitizeUser, writeAudit } from '../auth-utils.js'

export async function handleOnboarding(path, method, request, db) {
  const route = path.join('/')

  // ========================
  // PATCH /me/profile
  // ========================
  if (route === 'me/profile' && (method === 'PATCH' || method === 'PUT')) {
    const user = await requireAuth(request, db)
    const body = await request.json()
    const updates = {}

    if (body.displayName !== undefined) {
      const name = body.displayName.trim()
      if (name.length < Config.MIN_DISPLAY_NAME || name.length > Config.MAX_DISPLAY_NAME) {
        return { error: `displayName must be ${Config.MIN_DISPLAY_NAME}-${Config.MAX_DISPLAY_NAME} characters`, code: ErrorCode.VALIDATION, status: 400 }
      }
      updates.displayName = name
    }

    if (body.username !== undefined) {
      if (body.username === null || body.username === '') {
        updates.username = null
      } else {
        const un = body.username.toLowerCase().trim()
        if (!/^[a-z0-9._]{3,30}$/.test(un)) {
          return { error: 'Username: 3-30 chars, letters/numbers/dots/underscores only', code: ErrorCode.VALIDATION, status: 400 }
        }
        const taken = await db.collection('users').findOne({ username: un, id: { $ne: user.id } })
        if (taken) return { error: 'Username already taken', code: ErrorCode.CONFLICT, status: 409 }
        updates.username = un
      }
    }

    if (body.bio !== undefined) {
      updates.bio = (body.bio || '').slice(0, Config.MAX_BIO_LENGTH)
    }

    if (body.avatarMediaId !== undefined) {
      updates.avatarMediaId = body.avatarMediaId
      // World best: auto-resolve CDN URL and save to profilePicUrl
      // So avatar is ALWAYS a direct CDN URL — zero extra queries on every feed request
      if (body.avatarMediaId) {
        const avatarAsset = await db.collection('media_assets').findOne(
          { id: body.avatarMediaId, isDeleted: { $ne: true } },
          { projection: { _id: 0, publicUrl: 1 } }
        )
        if (avatarAsset?.publicUrl) {
          updates.profilePicUrl = avatarAsset.publicUrl
        }
      }
    }

    if (body.profilePicUrl !== undefined) {
      updates.profilePicUrl = body.profilePicUrl
    }

    if (Object.keys(updates).length === 0) {
      return { error: 'No valid fields to update', code: ErrorCode.VALIDATION, status: 400 }
    }

    updates.updatedAt = new Date()
    await db.collection('users').updateOne({ id: user.id }, { $set: updates })
    const updated = await db.collection('users').findOne({ id: user.id })
    return { data: { user: sanitizeUser(updated) } }
  }

  // ========================
  // PATCH /me/age
  // ========================
  if (route === 'me/age' && (method === 'PATCH' || method === 'PUT')) {
    const user = await requireAuth(request, db)
    const body = await request.json()
    const { birthYear } = body
    const currentYear = new Date().getFullYear()

    if (!birthYear || birthYear < 1940 || birthYear > currentYear) {
      return { error: 'Invalid birth year', code: ErrorCode.VALIDATION, status: 400 }
    }

    const age = currentYear - birthYear
    const ageStatus = age < 18 ? 'CHILD' : 'ADULT'

    // Cannot upgrade from CHILD to ADULT without admin review
    if (user.ageStatus === 'CHILD' && ageStatus === 'ADULT') {
      return { error: 'Age change from child to adult requires admin review', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const updates = {
      birthYear,
      ageStatus,
      onboardingStep: user.onboardingStep === 'AGE' ? 'COLLEGE' : user.onboardingStep,
      updatedAt: new Date(),
    }

    // DPDP: Disable behavioral features for children
    if (ageStatus === 'CHILD') {
      updates.personalizedFeed = false
      updates.targetedAds = false
    }

    await db.collection('users').updateOne({ id: user.id }, { $set: updates })
    await writeAudit(db, 'AGE_SET', user.id, 'USER', user.id, { birthYear, ageStatus })

    const updated = await db.collection('users').findOne({ id: user.id })
    return { data: { user: sanitizeUser(updated) } }
  }

  // ========================
  // PATCH /me/college
  // ========================
  if (route === 'me/college' && (method === 'PATCH' || method === 'PUT')) {
    const user = await requireAuth(request, db)
    const body = await request.json()
    const { collegeId } = body

    if (!collegeId) {
      // Unlink college
      if (user.collegeId) {
        await db.collection('colleges').updateOne({ id: user.collegeId }, { $inc: { membersCount: -1 } })
      }
      await db.collection('users').updateOne({ id: user.id }, {
        $set: { collegeId: null, collegeName: null, onboardingStep: 'CONSENT', updatedAt: new Date() },
      })
      const updated = await db.collection('users').findOne({ id: user.id })
      return { data: { user: sanitizeUser(updated) } }
    }

    const college = await db.collection('colleges').findOne({ id: collegeId })
    if (!college) return { error: 'College not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Unlink previous college if different
    if (user.collegeId && user.collegeId !== collegeId) {
      await db.collection('colleges').updateOne({ id: user.collegeId }, { $inc: { membersCount: -1 } })
    }

    await db.collection('users').updateOne({ id: user.id }, {
      $set: {
        collegeId: college.id,
        collegeName: college.officialName,
        onboardingStep: user.onboardingStep === 'COLLEGE' ? 'CONSENT' : user.onboardingStep,
        updatedAt: new Date(),
      },
    })
    await db.collection('colleges').updateOne({ id: college.id }, { $inc: { membersCount: 1 } })
    await writeAudit(db, 'COLLEGE_LINKED', user.id, 'COLLEGE', college.id)

    const updated = await db.collection('users').findOne({ id: user.id })
    return { data: { user: sanitizeUser(updated) } }
  }

  // ========================
  // PATCH /me/onboarding
  // ========================
  if (route === 'me/onboarding' && (method === 'PATCH' || method === 'PUT')) {
    const user = await requireAuth(request, db)
    await db.collection('users').updateOne({ id: user.id }, {
      $set: { onboardingComplete: true, onboardingStep: 'DONE', updatedAt: new Date() },
    })
    const updated = await db.collection('users').findOne({ id: user.id })
    return { data: { user: sanitizeUser(updated) } }
  }

  return null
}
