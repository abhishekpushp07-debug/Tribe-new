/**
 * Tribe — Stage 1-7 Feature Handlers
 * 
 * Stage 1: Appeal Decision Workflow
 * Stage 2: College Claim Workflow
 * Stage 3: Story Expiry (handled via TTL + feed filter)
 * Stage 4: Distribution Ladder
 * Stage 5: Notes/PYQs Library
 * Stage 6: Events + RSVP
 * Stage 7: Board Notices + Authenticity Tags
 */

import { v4 as uuidv4 } from 'uuid'
import { requireAuth, writeAudit, sanitizeUser, parsePagination } from '../auth-utils.js'
import { ErrorCode, Visibility, AppealStatus, ModerationAction, ClaimStatus, ClaimConfig } from '../constants.js'
import { moderateCreateContent } from '../moderation/middleware/moderate-create-content.js'

// ═══════════════════════════════════════════════════
// STAGE 1 — Appeal Decision Workflow
// ═══════════════════════════════════════════════════

export async function handleAppealDecision(path, method, request, db) {
  const route = path.join('/')

  // PATCH /appeals/:id/decide — Moderator decides on appeal
  if (path[0] === 'appeals' && path.length === 3 && path[2] === 'decide' && (method === 'PATCH' || method === 'POST')) {
    const user = await requireAuth(request, db)
    if (!['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { error: 'Moderator access required', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const appealId = path[1]
    const body = await request.json()
    const { action, reasonCodes, notes } = body

    // Support both old {approve} and new {action} contract
    let resolvedAction = action
    if (!resolvedAction && typeof body.approve === 'boolean') {
      resolvedAction = body.approve ? 'APPROVE' : 'REJECT'
    }

    if (!resolvedAction || !['APPROVE', 'REJECT', 'REQUEST_MORE_INFO'].includes(resolvedAction)) {
      return { error: 'action must be one of: APPROVE, REJECT, REQUEST_MORE_INFO', code: ErrorCode.VALIDATION, status: 400 }
    }
    if (!reasonCodes || !Array.isArray(reasonCodes) || reasonCodes.length === 0) {
      return { error: 'reasonCodes (array) is required', code: ErrorCode.VALIDATION, status: 400 }
    }

    const appeal = await db.collection('appeals').findOne({ id: appealId })
    if (!appeal) return { error: 'Appeal not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Duplicate decision guard — check FIRST before status check
    if (appeal.decidedBy && appeal.status !== 'PENDING' && appeal.status !== 'REVIEWING' && appeal.status !== 'MORE_INFO_REQUESTED') {
      return { error: 'Appeal already decided', code: ErrorCode.CONFLICT, status: 409 }
    }

    if (!['PENDING', 'REVIEWING', 'MORE_INFO_REQUESTED'].includes(appeal.status)) {
      return { error: 'Appeal is not in a decidable state', code: ErrorCode.VALIDATION, status: 400 }
    }

    const now = new Date()

    // REQUEST_MORE_INFO — intermediate state, not a final decision
    if (resolvedAction === 'REQUEST_MORE_INFO') {
      await db.collection('appeals').updateOne(
        { id: appealId },
        { $set: { status: 'MORE_INFO_REQUESTED', updatedAt: now, lastRequestedInfoAt: now, lastRequestedInfoBy: user.id, lastRequestedInfoReason: reasonCodes } }
      )

      // Notify user
      await db.collection('notifications').insertOne({
        id: uuidv4(),
        userId: appeal.userId,
        type: 'APPEAL_INFO_REQUESTED',
        message: `More information requested for your appeal. Reason: ${reasonCodes.join(', ')}`,
        metadata: { appealId, reasonCodes, notes: notes || '' },
        read: false,
        createdAt: now,
      })

      await db.collection('moderation_events').insertOne({
        id: uuidv4(),
        eventType: 'APPEAL_INFO_REQUESTED',
        actorId: user.id,
        targetType: appeal.targetType,
        targetId: appeal.targetId,
        previousState: appeal.status,
        newState: 'MORE_INFO_REQUESTED',
        reason: reasonCodes.join(', '),
        metadata: { appealId, notes, reasonCodes },
        createdAt: now,
      })

      await writeAudit(db, 'APPEAL_INFO_REQUESTED', user.id, appeal.targetType, appeal.targetId, { appealId, reasonCodes, notes })

      return {
        data: {
          appeal: { id: appealId, status: 'MORE_INFO_REQUESTED' },
          message: 'More information requested from the user',
        },
      }
    }

    // Final decision: APPROVE or REJECT
    const decision = resolvedAction === 'APPROVE' ? 'APPROVED' : 'REJECTED'

    await db.collection('appeals').updateOne(
      { id: appealId },
      {
        $set: {
          status: decision,
          decision,
          decidedBy: user.id,
          decidedAt: now,
          decisionReason: reasonCodes,
          decisionNotes: notes || '',
          updatedAt: now,
        },
      }
    )

    // If APPROVED: restore content visibility + reverse strike
    if (resolvedAction === 'APPROVE' && appeal.targetType === 'CONTENT') {
      await db.collection('content_items').updateOne(
        { id: appeal.targetId },
        { $set: { visibility: Visibility.PUBLIC, updatedAt: now } }
      )

      // Reverse related strike (only if strike is linked to this content)
      const strike = await db.collection('strikes').findOne({
        userId: appeal.userId,
        $or: [{ contentId: appeal.targetId }, { targetId: appeal.targetId }],
        reversed: { $ne: true },
      })

      if (strike) {
        await db.collection('strikes').updateOne(
          { id: strike.id },
          { $set: { reversed: true, reversedBy: user.id, reversedAt: now, reversalReason: 'APPEAL_APPROVED' } }
        )
        await db.collection('users').updateOne(
          { id: strike.userId },
          { $inc: { strikeCount: -1 } }
        )

        // Lift suspension if strike count drops below threshold
        const targetUser = await db.collection('users').findOne({ id: strike.userId })
        if (targetUser && targetUser.strikeCount <= 2 && targetUser.suspendedUntil) {
          await db.collection('users').updateOne(
            { id: strike.userId },
            { $set: { suspendedUntil: null } }
          )
        }
      }
    }

    // Record moderation event
    await db.collection('moderation_events').insertOne({
      id: uuidv4(),
      eventType: `APPEAL_${decision}`,
      actorId: user.id,
      targetType: appeal.targetType,
      targetId: appeal.targetId,
      previousState: appeal.status,
      newState: decision,
      reason: reasonCodes.join(', '),
      metadata: { appealId, notes, reasonCodes },
      createdAt: now,
    })

    await writeAudit(db, `APPEAL_${decision}`, user.id, appeal.targetType, appeal.targetId, {
      appealId, reasonCodes, notes, action: resolvedAction,
    })

    // Notify user of decision
    await db.collection('notifications').insertOne({
      id: uuidv4(),
      userId: appeal.userId,
      type: `APPEAL_${decision}`,
      message: resolvedAction === 'APPROVE'
        ? 'Your appeal has been approved. Content restored.'
        : `Your appeal has been rejected. Reason: ${reasonCodes.join(', ')}`,
      metadata: { appealId, decision, reasonCodes, notes: notes || '' },
      read: false,
      createdAt: now,
    })

    return {
      data: {
        appeal: { id: appealId, status: decision, decision, decidedBy: user.id, decidedAt: now },
        message: resolvedAction === 'APPROVE' ? 'Appeal approved — content restored' : 'Appeal rejected',
      },
    }
  }

  return null
}

// ═══════════════════════════════════════════════════
// STAGE 2 — College Claim Workflow
// World-class trust-graph backend
//
// State Machine:
//   PENDING → APPROVED | REJECTED | WITHDRAWN | FRAUD_REVIEW
//   FRAUD_REVIEW → APPROVED | REJECTED
//
// Rules:
//   - One active claim (PENDING|FRAUD_REVIEW) per user across ALL colleges
//   - 7-day cooldown after rejection (per college, stored as cooldownUntil)
//   - Already-verified users blocked from redundant claims
//   - Auto-fraud flag at 3+ lifetime rejections
//   - Every decision creates audit log + user notification
// ═══════════════════════════════════════════════════

export async function handleCollegeClaims(path, method, request, db) {
  const route = path.join('/')

  // ──────────────────────────────────────────────
  // POST /colleges/:collegeId/claim — Submit claim
  // ──────────────────────────────────────────────
  if (path[0] === 'colleges' && path.length === 3 && path[2] === 'claim' && method === 'POST') {
    const user = await requireAuth(request, db)
    const collegeId = path[1]

    // 1. College must exist
    const college = await db.collection('colleges').findOne({ id: collegeId })
    if (!college) return { error: 'College not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // 2. Already-verified user guard
    if (user.collegeId === collegeId && user.collegeVerified) {
      return { error: 'You are already verified for this college', code: ErrorCode.CONFLICT, status: 409 }
    }

    // 3. One active claim per user (PENDING or FRAUD_REVIEW) across ALL colleges
    const activeClaim = await db.collection('college_claims').findOne({
      userId: user.id,
      status: { $in: [ClaimStatus.PENDING, ClaimStatus.FRAUD_REVIEW] },
    })
    if (activeClaim) {
      return {
        error: `You already have an active claim (for ${activeClaim.collegeName || activeClaim.collegeId}). Wait for review or withdraw it first.`,
        code: ErrorCode.CONFLICT,
        status: 409,
        data: { existingClaimId: activeClaim.id, existingClaimStatus: activeClaim.status },
      }
    }

    // 4. Cooldown: check explicit cooldownUntil from most recent rejection for SAME college
    const recentRejection = await db.collection('college_claims').findOne({
      userId: user.id,
      collegeId,
      status: ClaimStatus.REJECTED,
      cooldownUntil: { $gt: new Date() },
    }, { sort: { reviewedAt: -1 } })

    if (recentRejection) {
      return {
        error: `Claim was recently rejected. Cooldown active until ${recentRejection.cooldownUntil.toISOString()}.`,
        code: 'COOLDOWN_ACTIVE',
        status: 429,
        data: {
          cooldownUntil: recentRejection.cooldownUntil.toISOString(),
          rejectedAt: recentRejection.reviewedAt,
          claimId: recentRejection.id,
        },
      }
    }

    // 5. Parse & validate body
    const body = await request.json()
    const { claimType, evidence } = body

    if (!claimType || !ClaimConfig.VALID_CLAIM_TYPES.includes(claimType)) {
      return {
        error: `claimType must be one of: ${ClaimConfig.VALID_CLAIM_TYPES.join(', ')}`,
        code: ErrorCode.VALIDATION,
        status: 400,
      }
    }

    // 6. Auto-fraud detection: 3+ lifetime rejections → auto flag
    const lifetimeRejections = await db.collection('college_claims').countDocuments({
      userId: user.id, status: ClaimStatus.REJECTED,
    })
    const autoFraud = lifetimeRejections >= ClaimConfig.AUTO_FRAUD_REJECTION_THRESHOLD

    const now = new Date()
    const claim = {
      id: uuidv4(),
      userId: user.id,
      collegeId,
      collegeName: college.officialName || college.name,
      claimType,
      evidence: evidence || null,
      status: autoFraud ? ClaimStatus.FRAUD_REVIEW : ClaimStatus.PENDING,
      fraudFlag: autoFraud,
      fraudReason: autoFraud ? `Auto-flagged: ${lifetimeRejections} lifetime rejections` : null,
      reviewedBy: null,
      reviewedAt: null,
      reviewReasonCodes: [],
      reviewNotes: null,
      cooldownUntil: null,
      submittedAt: now,
      updatedAt: now,
    }

    // 7. Insert with race-condition guard
    // Partial unique index idx_one_active_claim_per_user ensures only ONE
    // active claim (PENDING|FRAUD_REVIEW) per user at the database level.
    // If two concurrent requests pass the app-level check, the second
    // insertOne will fail with E11000 duplicate key → caught here as 409.
    try {
      await db.collection('college_claims').insertOne(claim)
    } catch (err) {
      if (err.code === 11000) {
        return {
          error: 'You already have an active claim. Concurrent request detected.',
          code: ErrorCode.CONFLICT,
          status: 409,
        }
      }
      throw err
    }

    await writeAudit(db, 'COLLEGE_CLAIM_SUBMITTED', user.id, 'COLLEGE', collegeId, {
      claimId: claim.id, claimType, fraudFlag: autoFraud, lifetimeRejections,
    })

    const { _id, ...clean } = claim
    return {
      data: {
        claim: clean,
        message: autoFraud
          ? 'Claim submitted but auto-flagged for fraud review due to previous rejections.'
          : 'Claim submitted successfully. Pending admin review.',
      },
      status: 201,
    }
  }

  // ──────────────────────────────────────────────
  // GET /me/college-claims — User's own claims
  // ──────────────────────────────────────────────
  if (route === 'me/college-claims' && method === 'GET') {
    const user = await requireAuth(request, db)
    const claims = await db.collection('college_claims')
      .find({ userId: user.id }, { projection: { _id: 0 } })
      .sort({ submittedAt: -1 })
      .limit(ClaimConfig.MAX_CLAIMS_HISTORY)
      .toArray()

    // Enrich with college info
    const collegeIds = [...new Set(claims.map(c => c.collegeId))]
    const colleges = await db.collection('colleges').find({ id: { $in: collegeIds } }).toArray()
    const collegeMap = Object.fromEntries(colleges.map(c => [c.id, { id: c.id, officialName: c.officialName || c.name }]))

    const enriched = claims.map(c => ({
      ...c,
      college: collegeMap[c.collegeId] || null,
    }))

    return { data: { claims: enriched, total: claims.length } }
  }

  // ──────────────────────────────────────────────
  // DELETE /me/college-claims/:id — Withdraw pending claim
  // ──────────────────────────────────────────────
  if (path[0] === 'me' && path[1] === 'college-claims' && path.length === 3 && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const claimId = path[2]

    const claim = await db.collection('college_claims').findOne({ id: claimId, userId: user.id })
    if (!claim) return { error: 'Claim not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Only PENDING claims can be withdrawn (not FRAUD_REVIEW — admin must handle those)
    if (claim.status !== ClaimStatus.PENDING) {
      return {
        error: `Only PENDING claims can be withdrawn. Current status: ${claim.status}`,
        code: ErrorCode.VALIDATION,
        status: 400,
      }
    }

    const now = new Date()
    await db.collection('college_claims').updateOne(
      { id: claimId },
      { $set: { status: ClaimStatus.WITHDRAWN, updatedAt: now } }
    )

    await writeAudit(db, 'COLLEGE_CLAIM_WITHDRAWN', user.id, 'COLLEGE_CLAIM', claimId, {
      collegeId: claim.collegeId,
    })

    return { data: { claim: { id: claimId, status: ClaimStatus.WITHDRAWN }, message: 'Claim withdrawn successfully.' } }
  }

  // ──────────────────────────────────────────────
  // GET /admin/college-claims — Admin review queue
  // ──────────────────────────────────────────────
  if (path[0] === 'admin' && path[1] === 'college-claims' && path.length === 2 && method === 'GET') {
    const user = await requireAuth(request, db)
    if (!['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { error: 'Admin access required', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const url = new URL(request.url)
    const statusFilter = url.searchParams.get('status') || 'PENDING'
    const fraudOnly = url.searchParams.get('fraudOnly') === 'true'
    const { limit } = parsePagination(url)

    const query = { status: statusFilter }
    if (fraudOnly) query.fraudFlag = true

    const claims = await db.collection('college_claims')
      .find(query, { projection: { _id: 0 } })
      .sort({ fraudFlag: -1, submittedAt: 1 }) // fraud-flagged first, then oldest
      .limit(limit)
      .toArray()

    // Enrich with user info
    const userIds = [...new Set(claims.map(c => c.userId))]
    const users = await db.collection('users').find({ id: { $in: userIds } }).toArray()
    const userMap = Object.fromEntries(users.map(u => [u.id, sanitizeUser(u)]))

    // Aggregate counts for queue dashboard
    const [totalPending, totalFraudReview, totalFraudFlaggedPending] = await Promise.all([
      db.collection('college_claims').countDocuments({ status: ClaimStatus.PENDING }),
      db.collection('college_claims').countDocuments({ status: ClaimStatus.FRAUD_REVIEW }),
      db.collection('college_claims').countDocuments({ status: ClaimStatus.PENDING, fraudFlag: true }),
    ])

    const enriched = claims.map(c => ({ ...c, user: userMap[c.userId] || null }))

    return {
      data: {
        claims: enriched,
        filter: { status: statusFilter, fraudOnly },
        queue: { totalPending, totalFraudReview, totalFraudFlaggedPending },
      },
    }
  }

  // ──────────────────────────────────────────────
  // GET /admin/college-claims/:id — Admin claim detail
  // ──────────────────────────────────────────────
  if (path[0] === 'admin' && path[1] === 'college-claims' && path.length === 3 && method === 'GET') {
    const user = await requireAuth(request, db)
    if (!['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { error: 'Admin access required', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const claimId = path[2]
    const claim = await db.collection('college_claims').findOne({ id: claimId }, { projection: { _id: 0 } })
    if (!claim) return { error: 'Claim not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Enrich: claimant user, college, reviewer, claim history for this user
    const [claimant, college, reviewer, userClaimHistory, auditTrail] = await Promise.all([
      db.collection('users').findOne({ id: claim.userId }),
      db.collection('colleges').findOne({ id: claim.collegeId }),
      claim.reviewedBy ? db.collection('users').findOne({ id: claim.reviewedBy }) : null,
      db.collection('college_claims')
        .find({ userId: claim.userId }, { projection: { _id: 0 } })
        .sort({ submittedAt: -1 })
        .limit(20)
        .toArray(),
      db.collection('audit_logs')
        .find({ targetId: claimId, targetType: 'COLLEGE_CLAIM' }, { projection: { _id: 0 } })
        .sort({ createdAt: -1 })
        .limit(20)
        .toArray(),
    ])

    return {
      data: {
        claim,
        claimant: claimant ? sanitizeUser(claimant) : null,
        college: college ? { id: college.id, officialName: college.officialName || college.name, city: college.city, state: college.state } : null,
        reviewer: reviewer ? sanitizeUser(reviewer) : null,
        userClaimHistory,
        auditTrail,
      },
    }
  }

  // ──────────────────────────────────────────────
  // PATCH /admin/college-claims/:id/flag-fraud — Move to FRAUD_REVIEW
  // ──────────────────────────────────────────────
  if (path[0] === 'admin' && path[1] === 'college-claims' && path.length === 4 && path[3] === 'flag-fraud' && (method === 'PATCH' || method === 'POST')) {
    const user = await requireAuth(request, db)
    if (!['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { error: 'Admin access required', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const claimId = path[2]
    const body = await request.json()

    const claim = await db.collection('college_claims').findOne({ id: claimId })
    if (!claim) return { error: 'Claim not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Only PENDING claims can be escalated to FRAUD_REVIEW
    // If claim is already decided/withdrawn/in-fraud-review → 409 state conflict
    if (claim.status !== ClaimStatus.PENDING) {
      return {
        error: `Cannot flag for fraud: claim is in ${claim.status} state (expected PENDING).`,
        code: ErrorCode.CONFLICT,
        status: 409,
      }
    }

    const now = new Date()
    await db.collection('college_claims').updateOne(
      { id: claimId },
      {
        $set: {
          status: ClaimStatus.FRAUD_REVIEW,
          fraudFlag: true,
          fraudReason: body.reason || 'Manually flagged by admin',
          updatedAt: now,
        },
      }
    )

    await writeAudit(db, 'COLLEGE_CLAIM_FRAUD_FLAGGED', user.id, 'COLLEGE_CLAIM', claimId, {
      reason: body.reason || 'Manually flagged by admin',
      previousStatus: claim.status,
      userId: claim.userId,
      collegeId: claim.collegeId,
    })

    return {
      data: {
        claim: { id: claimId, status: ClaimStatus.FRAUD_REVIEW, fraudFlag: true, fraudReason: body.reason || 'Manually flagged by admin' },
        message: 'Claim moved to FRAUD_REVIEW.',
      },
    }
  }

  // ──────────────────────────────────────────────
  // PATCH /admin/college-claims/:id/decide — Admin approve/reject
  // Accepts claims in PENDING or FRAUD_REVIEW state
  // ──────────────────────────────────────────────
  if (path[0] === 'admin' && path[1] === 'college-claims' && path.length === 4 && path[3] === 'decide' && (method === 'PATCH' || method === 'POST')) {
    const user = await requireAuth(request, db)
    if (!['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { error: 'Admin access required', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const claimId = path[2]
    const body = await request.json()
    const { approve, reasonCodes, notes } = body

    if (typeof approve !== 'boolean') {
      return { error: 'approve (boolean) is required', code: ErrorCode.VALIDATION, status: 400 }
    }

    const claim = await db.collection('college_claims').findOne({ id: claimId })
    if (!claim) return { error: 'Claim not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Only PENDING or FRAUD_REVIEW claims can be decided
    if (![ClaimStatus.PENDING, ClaimStatus.FRAUD_REVIEW].includes(claim.status)) {
      return { error: `Claim already decided. Current status: ${claim.status}`, code: ErrorCode.CONFLICT, status: 409 }
    }

    const now = new Date()
    const newStatus = approve ? ClaimStatus.APPROVED : ClaimStatus.REJECTED
    const cooldownUntil = approve ? null : new Date(now.getTime() + ClaimConfig.COOLDOWN_DAYS * 24 * 60 * 60 * 1000)

    // Update claim
    await db.collection('college_claims').updateOne(
      { id: claimId },
      {
        $set: {
          status: newStatus,
          reviewedBy: user.id,
          reviewedAt: now,
          reviewReasonCodes: Array.isArray(reasonCodes) ? reasonCodes : [],
          reviewNotes: notes || null,
          cooldownUntil,
          updatedAt: now,
        },
      }
    )

    // === APPROVE SIDE EFFECTS ===
    if (approve) {
      const claimant = await db.collection('users').findOne({ id: claim.userId })

      // If user was previously linked to a different college, decrement old count
      if (claimant?.collegeId && claimant.collegeId !== claim.collegeId) {
        await db.collection('colleges').updateOne(
          { id: claimant.collegeId },
          { $inc: { membersCount: -1 } }
        )
      }

      // Link user → college + set verified
      await db.collection('users').updateOne(
        { id: claim.userId },
        {
          $set: {
            collegeId: claim.collegeId,
            collegeVerified: true,
            verifiedCollegeId: claim.collegeId,
            updatedAt: now,
          },
        }
      )

      // Increment college member count
      await db.collection('colleges').updateOne(
        { id: claim.collegeId },
        { $inc: { membersCount: 1 } }
      )
    }

    // === AUDIT LOG ===
    await writeAudit(db, `COLLEGE_CLAIM_${newStatus}`, user.id, 'COLLEGE_CLAIM', claimId, {
      approve,
      previousStatus: claim.status,
      reasonCodes: Array.isArray(reasonCodes) ? reasonCodes : [],
      notes: notes || null,
      userId: claim.userId,
      collegeId: claim.collegeId,
      fraudFlag: claim.fraudFlag,
      cooldownUntil: cooldownUntil ? cooldownUntil.toISOString() : null,
    })

    // === USER NOTIFICATION ===
    const notificationMessage = approve
      ? `Your college claim for ${claim.collegeName} has been approved! You are now verified.`
      : `Your college claim for ${claim.collegeName} has been rejected.${notes ? ' Reason: ' + notes : ''}${cooldownUntil ? ' You may reapply after ' + cooldownUntil.toISOString().split('T')[0] + '.' : ''}`

    await db.collection('notifications').insertOne({
      id: uuidv4(),
      userId: claim.userId,
      type: `COLLEGE_CLAIM_${newStatus}`,
      message: notificationMessage,
      metadata: {
        claimId,
        collegeId: claim.collegeId,
        collegeName: claim.collegeName,
        decision: newStatus,
        reasonCodes: Array.isArray(reasonCodes) ? reasonCodes : [],
        notes: notes || null,
        cooldownUntil: cooldownUntil ? cooldownUntil.toISOString() : null,
      },
      read: false,
      createdAt: now,
    })

    return {
      data: {
        claim: {
          id: claimId,
          status: newStatus,
          previousStatus: claim.status,
          reviewedBy: user.id,
          reviewedAt: now.toISOString(),
          reviewReasonCodes: Array.isArray(reasonCodes) ? reasonCodes : [],
          reviewNotes: notes || null,
          collegeName: claim.collegeName,
          fraudFlag: claim.fraudFlag,
          cooldownUntil: cooldownUntil ? cooldownUntil.toISOString() : null,
        },
        sideEffects: approve
          ? { userVerified: true, collegeId: claim.collegeId, collegeMembersIncremented: true }
          : { cooldownSet: true, cooldownUntil: cooldownUntil.toISOString() },
        message: approve ? 'Claim approved — user verified for college.' : 'Claim rejected — cooldown applied.',
      },
    }
  }

  return null
}

// ═══════════════════════════════════════════════════
// STAGE 4 — Distribution Ladder
// World-class trust-first content distribution
//
// Stage Meanings (FROZEN):
//   STAGE_0 = Profile + Following only (author's existing audience)
//   STAGE_1 = College-level distribution (local graph)
//   STAGE_2 = Public/Discovery distribution (platform-wide)
//
// Promotion: 0 → 1 → 2 (earned, never automatic)
// Demotion:  2 → 0, 1 → 0 (safety-triggered)
// Override:  Admin can set any stage, survives auto-eval
//
// Feed Integration:
//   /feed/public      → Stage 2 only
//   /feed/college/:id → Stage 1 + Stage 2
//   /feed/following   → All stages (your network, no filter)
//   /feed/house/:id   → Stage 1 + Stage 2
//   /feed/stories     → No distribution filter (stories are ephemeral)
// ═══════════════════════════════════════════════════

const DISTRIBUTION_RULES = {
  STAGE_0_TO_1: {
    minAccountAgeDays: 7,
    maxActiveStrikes: 0,
    notSuspended: true,
    moderationClean: true,
    notSyntheticUnlabeled: true,
    minLikes: 1,
    minEngagement: 1,      // likes + saves + comments
    noActiveReports: true,
    requireCollegeVerified: false,
  },
  STAGE_1_TO_2: {
    minAccountAgeDays: 14,
    minTimeInStage1Hours: 24,
    maxActiveStrikes: 0,
    notSuspended: true,
    moderationClean: true,
    minLikes: 3,
    minSavesOrComments: 1,  // at least 1 save or comment
    minEngagement: 5,       // total: likes + saves*2 + comments*2
    noActiveReports: true,
    requireCollegeVerified: false,
  },
  DEMOTION: {
    reportsForFreeze: 1,    // 1 report → freeze (no promotion)
    reportsForDemote: 2,    // 2+ reports → demote to 0
    strikesForDemote: 1,    // any active strike → demote
    suspendedDemote: true,  // suspended author → demote
    moderationHoldDemote: true, // content held by moderation → demote
  },
}

/**
 * Collect all distribution signals for a content item.
 * Includes engagement QUALITY signals (anti-gaming).
 */
async function collectDistributionSignals(db, content) {
  const author = await db.collection('users').findOne({ id: content.authorId })
  if (!author) return null

  const now = new Date()
  const accountAgeDays = (now - new Date(author.createdAt)) / (1000 * 60 * 60 * 24)
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000)
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000

  const [activeStrikes, activeReports, activeSuspension] = await Promise.all([
    db.collection('strikes').countDocuments({
      userId: author.id, reversed: { $ne: true }, expiresAt: { $gt: now },
    }),
    db.collection('reports').countDocuments({
      targetId: content.id, status: { $in: ['OPEN', 'REVIEWING'] },
    }),
    db.collection('suspensions').findOne({
      userId: author.id, liftedAt: null,
      $or: [{ expiresAt: { $gt: now } }, { type: 'PERMANENT' }],
    }),
  ])

  const isSuspended = !!activeSuspension
  const moderationClean = !content.moderation || content.moderation.action === 'ALLOW'
  const isModerationHeld = content.visibility === 'HELD'
  const isSyntheticUnlabeled = content.syntheticDeclaration && content.syntheticLabelStatus !== 'LABELED'
  const isCollegeVerified = !!author.collegeVerified

  const likeCount = content.likeCount || 0
  const saveCount = content.saveCount || 0
  const commentCount = content.commentCount || 0

  // ── ENGAGEMENT QUALITY SIGNALS (anti-gaming) ──
  const [allReactions, recentReactions, allComments, recentComments, allSaves, recentSaves] = await Promise.all([
    db.collection('reactions').find({ contentId: content.id, type: 'LIKE' }).toArray(),
    db.collection('reactions').countDocuments({ contentId: content.id, type: 'LIKE', createdAt: { $gt: oneHourAgo } }),
    db.collection('comments').find({ contentId: content.id }).toArray(),
    db.collection('comments').countDocuments({ contentId: content.id, createdAt: { $gt: oneHourAgo } }),
    db.collection('saves').find({ contentId: content.id }).toArray(),
    db.collection('saves').countDocuments({ contentId: content.id, createdAt: { $gt: oneHourAgo } }),
  ])

  // Unique engager IDs across reactions, comments, saves
  const allEngagerIds = new Set([
    ...allReactions.map(r => r.userId),
    ...allComments.map(c => c.authorId || c.userId),
    ...allSaves.map(s => s.userId),
  ])
  const uniqueEngagerCount = allEngagerIds.size

  // Low-trust engager detection: accounts < 7 days old or with active strikes
  let lowTrustEngagerCount = 0
  if (allEngagerIds.size > 0) {
    const engagerUsers = await db.collection('users')
      .find({ id: { $in: [...allEngagerIds] } })
      .toArray()
    const engagerStrikes = await db.collection('strikes')
      .find({
        userId: { $in: [...allEngagerIds] },
        reversed: { $ne: true },
        expiresAt: { $gt: now },
      })
      .toArray()
    const struckUserIds = new Set(engagerStrikes.map(s => s.userId))

    for (const u of engagerUsers) {
      const uAge = (now - new Date(u.createdAt)) / (1000 * 60 * 60 * 24)
      if (uAge < 7 || struckUserIds.has(u.id)) {
        lowTrustEngagerCount++
      }
    }
  }

  // Trusted engagement: low-trust engagers count as 0.5x
  const trustedLikes = Math.max(0, likeCount - (lowTrustEngagerCount * 0.5))
  const trustedEngagementScore = Math.round((trustedLikes + (saveCount * 2) + (commentCount * 2)) * 10) / 10

  // Burst detection: if >50% of total engagement happened in last hour → suspicious
  const totalRecent = recentReactions + recentComments + recentSaves
  const totalAll = allReactions.length + allComments.length + allSaves.length
  const burstRatio = totalAll > 0 ? totalRecent / totalAll : 0
  const burstSuspicion = burstRatio > 0.5 && totalAll >= 3 // only flag if meaningful volume

  const rawEngagementScore = likeCount + (saveCount * 2) + (commentCount * 2)

  const timeInCurrentStage = content.distributionPromotedAt
    ? (now - new Date(content.distributionPromotedAt)) / (1000 * 60 * 60)
    : (now - new Date(content.createdAt)) / (1000 * 60 * 60)

  return {
    // Author signals
    accountAgeDays: Math.round(accountAgeDays * 10) / 10,
    activeStrikes,
    isSuspended,
    isCollegeVerified,
    // Raw engagement
    likeCount,
    saveCount,
    commentCount,
    rawEngagementScore,
    // Quality engagement (anti-gaming)
    uniqueEngagerCount,
    lowTrustEngagerCount,
    trustedEngagementScore,
    burstRatio: Math.round(burstRatio * 100) / 100,
    burstSuspicion,
    // Safety
    moderationClean,
    isModerationHeld,
    isSyntheticUnlabeled,
    activeReports,
    timeInCurrentStageHours: Math.round(timeInCurrentStage * 10) / 10,
    // Current state
    currentStage: content.distributionStage || 0,
    isOverridden: !!content.distributionOverride,
    overriddenBy: content.distributionOverrideBy || null,
    // Timestamps
    evaluatedAt: now.toISOString(),
  }
}

/**
 * Event-driven auto-evaluation trigger.
 * Called after engagement events (like, save, comment).
 * Rate-limited: won't re-evaluate within 5 minutes.
 * Respects kill switch, override protection, and moderation holds.
 */
export async function triggerAutoEval(db, contentId) {
  // Kill switch check
  const flag = await db.collection('feature_flags').findOne({ key: 'DISTRIBUTION_AUTO_EVAL' })
  if (flag && flag.enabled === false) return null // auto-eval disabled

  const content = await db.collection('content_items').findOne({ id: contentId })
  if (!content) return null
  if (content.kind === 'STORY') return null // stories don't distribute
  if (content.distributionOverride) return null // override-protected
  if (content.distributionStage >= 2) return null // already at max

  // Rate limit: skip if evaluated within last 5 minutes
  if (content.distributionEvaluatedAt) {
    const msSinceLastEval = Date.now() - new Date(content.distributionEvaluatedAt).getTime()
    if (msSinceLastEval < 5 * 60 * 1000) return null
  }

  return evaluateDistribution(db, contentId)
}

/**
 * Evaluate distribution for a single content item.
 * Returns: { contentId, previousStage, newStage, reason, signals, blocked, blockedReason }
 */
export async function evaluateDistribution(db, contentId) {
  const content = await db.collection('content_items').findOne({ id: contentId })
  if (!content) return null

  // Override protection: if admin-overridden, skip automatic evaluation
  if (content.distributionOverride) {
    return {
      contentId,
      previousStage: content.distributionStage || 0,
      newStage: content.distributionStage || 0,
      reason: 'OVERRIDE_PROTECTED',
      signals: { isOverridden: true, overriddenBy: content.distributionOverrideBy },
      blocked: false,
      blockedReason: null,
    }
  }

  const signals = await collectDistributionSignals(db, content)
  if (!signals) return null

  const currentStage = signals.currentStage
  let newStage = currentStage
  let reason = 'NO_CHANGE'
  let blocked = false
  let blockedReason = null

  // ── DEMOTION CHECKS (run first, highest priority) ──
  const demRules = DISTRIBUTION_RULES.DEMOTION

  if (signals.isModerationHeld && currentStage > 0) {
    newStage = 0; reason = 'DEMOTED_MODERATION_HOLD'
  } else if (signals.isSuspended && currentStage > 0) {
    newStage = 0; reason = 'DEMOTED_AUTHOR_SUSPENDED'
  } else if (signals.activeStrikes >= demRules.strikesForDemote && currentStage > 0) {
    newStage = 0; reason = 'DEMOTED_ACTIVE_STRIKES'
  } else if (signals.activeReports >= demRules.reportsForDemote && currentStage > 0) {
    newStage = 0; reason = 'DEMOTED_EXCESSIVE_REPORTS'
  } else if (signals.activeReports >= demRules.reportsForFreeze) {
    // Freeze: don't demote, but block promotion
    blocked = true; blockedReason = 'FROZEN_PENDING_REPORTS'
  }

  // ── PROMOTION CHECKS (only if not demoted/frozen) ──
  if (newStage === currentStage && !blocked) {
    // Burst suspicion blocks promotion entirely
    if (signals.burstSuspicion) {
      blocked = true
      blockedReason = `BURST_SUSPECTED_ratio_${signals.burstRatio}`
    } else if (currentStage === 0) {
      const r = DISTRIBUTION_RULES.STAGE_0_TO_1
      const eligible =
        signals.accountAgeDays >= r.minAccountAgeDays &&
        signals.activeStrikes <= r.maxActiveStrikes &&
        !signals.isSuspended &&
        signals.moderationClean &&
        !signals.isModerationHeld &&
        (!r.notSyntheticUnlabeled || !signals.isSyntheticUnlabeled) &&
        signals.likeCount >= r.minLikes &&
        signals.trustedEngagementScore >= r.minEngagement &&
        signals.activeReports === 0

      if (eligible) {
        newStage = 1; reason = 'PROMOTED_TO_COLLEGE'
      } else {
        blockedReason = buildBlockedReason(signals, r, 'STAGE_0_TO_1')
      }
    } else if (currentStage === 1) {
      const r = DISTRIBUTION_RULES.STAGE_1_TO_2
      const eligible =
        signals.accountAgeDays >= r.minAccountAgeDays &&
        signals.timeInCurrentStageHours >= r.minTimeInStage1Hours &&
        signals.activeStrikes <= r.maxActiveStrikes &&
        !signals.isSuspended &&
        signals.moderationClean &&
        !signals.isModerationHeld &&
        signals.likeCount >= r.minLikes &&
        (signals.saveCount + signals.commentCount) >= r.minSavesOrComments &&
        signals.trustedEngagementScore >= r.minEngagement &&
        signals.activeReports === 0

      if (eligible) {
        newStage = 2; reason = 'PROMOTED_TO_PUBLIC'
      } else {
        blockedReason = buildBlockedReason(signals, r, 'STAGE_1_TO_2')
      }
    }
  }

  // ── APPLY CHANGES ──
  if (newStage !== currentStage) {
    const now = new Date()
    await db.collection('content_items').updateOne(
      { id: contentId },
      {
        $set: {
          distributionStage: newStage,
          distributionReason: reason,
          distributionSignals: signals,
          distributionEvaluatedAt: now,
          distributionEligible: newStage > currentStage,
          distributionBlockedReason: null,
          ...(newStage > currentStage ? { distributionPromotedAt: now } : {}),
          updatedAt: now,
        },
      }
    )
  } else {
    // Update evaluation timestamp and blocked reason even if no change
    await db.collection('content_items').updateOne(
      { id: contentId },
      {
        $set: {
          distributionEvaluatedAt: new Date(),
          distributionSignals: signals,
          distributionEligible: false,
          distributionBlockedReason: blockedReason,
        },
      }
    )
  }

  return { contentId, previousStage: currentStage, newStage, reason, signals, blocked, blockedReason }
}

function buildBlockedReason(signals, rules, transitionName) {
  const reasons = []
  if (rules.minAccountAgeDays && signals.accountAgeDays < rules.minAccountAgeDays)
    reasons.push(`account_age_${Math.round(signals.accountAgeDays)}d_need_${rules.minAccountAgeDays}d`)
  if (signals.activeStrikes > (rules.maxActiveStrikes || 0))
    reasons.push(`active_strikes_${signals.activeStrikes}`)
  if (signals.isSuspended) reasons.push('author_suspended')
  if (!signals.moderationClean) reasons.push('moderation_not_clean')
  if (signals.isModerationHeld) reasons.push('content_held')
  if (rules.minLikes && signals.likeCount < rules.minLikes)
    reasons.push(`likes_${signals.likeCount}_need_${rules.minLikes}`)
  if (rules.minEngagement && signals.trustedEngagementScore < rules.minEngagement)
    reasons.push(`trusted_engagement_${signals.trustedEngagementScore}_need_${rules.minEngagement}`)
  if (signals.activeReports > 0) reasons.push(`active_reports_${signals.activeReports}`)
  if (rules.minTimeInStage1Hours && signals.timeInCurrentStageHours < rules.minTimeInStage1Hours)
    reasons.push(`time_in_stage_${Math.round(signals.timeInCurrentStageHours)}h_need_${rules.minTimeInStage1Hours}h`)
  if (rules.minSavesOrComments && (signals.saveCount + signals.commentCount) < rules.minSavesOrComments)
    reasons.push(`saves_comments_${signals.saveCount + signals.commentCount}_need_${rules.minSavesOrComments}`)
  if (signals.lowTrustEngagerCount > 0)
    reasons.push(`low_trust_engagers_${signals.lowTrustEngagerCount}_of_${signals.uniqueEngagerCount}`)
  if (signals.burstSuspicion)
    reasons.push(`burst_suspected_ratio_${signals.burstRatio}`)
  return reasons.length > 0 ? reasons.join(', ') : null
}

export async function handleDistribution(path, method, request, db) {
  const route = path.join('/')

  // ──────────────────────────────────────────────
  // POST /admin/distribution/evaluate — Batch evaluate all Stage 0/1 content
  // ──────────────────────────────────────────────
  if (route === 'admin/distribution/evaluate' && (method === 'GET' || method === 'POST')) {
    const user = await requireAuth(request, db)
    if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { error: 'Admin access required', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const candidates = await db.collection('content_items')
      .find({
        visibility: Visibility.PUBLIC,
        distributionStage: { $in: [0, 1] },
        kind: { $in: ['POST', 'REEL'] },
        distributionOverride: { $ne: true }, // skip overridden
      })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray()

    const changes = []
    const skipped = []
    for (const c of candidates) {
      const result = await evaluateDistribution(db, c.id)
      if (result && result.previousStage !== result.newStage) {
        changes.push(result)
      } else if (result) {
        skipped.push({ contentId: result.contentId, reason: result.reason, blocked: result.blocked, blockedReason: result.blockedReason })
      }
    }

    await writeAudit(db, 'DISTRIBUTION_BATCH_EVALUATE', user.id, 'SYSTEM', 'batch', {
      evaluated: candidates.length, changed: changes.length,
    })

    return { data: { evaluated: candidates.length, changed: changes.length, changes, skippedSample: skipped.slice(0, 10) } }
  }

  // ──────────────────────────────────────────────
  // POST /admin/distribution/evaluate/:contentId — Single content evaluate
  // ──────────────────────────────────────────────
  if (path[0] === 'admin' && path[1] === 'distribution' && path[2] === 'evaluate' && path.length === 4 && (method === 'POST' || method === 'GET')) {
    const user = await requireAuth(request, db)
    if (!['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { error: 'Admin access required', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const contentId = path[3]
    const result = await evaluateDistribution(db, contentId)
    if (!result) return { error: 'Content not found', code: ErrorCode.NOT_FOUND, status: 404 }

    return { data: result }
  }

  // ──────────────────────────────────────────────
  // GET /admin/distribution/config — View distribution rules
  // ──────────────────────────────────────────────
  if (route === 'admin/distribution/config' && method === 'GET') {
    const user = await requireAuth(request, db)
    if (!['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { error: 'Admin access required', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    return {
      data: {
        rules: DISTRIBUTION_RULES,
        stageMeanings: {
          STAGE_0: 'Profile + Following only (author audience)',
          STAGE_1: 'College-level distribution (local graph)',
          STAGE_2: 'Public/Discovery distribution (platform-wide)',
        },
        feedMapping: {
          'feed/public': 'Stage 2 only',
          'feed/college/:id': 'Stage 1 + Stage 2',
          'feed/following': 'All stages',
          'feed/house/:id': 'Stage 1 + Stage 2',
        },
      },
    }
  }

  // ──────────────────────────────────────────────
  // POST /admin/distribution/kill-switch — Toggle auto-evaluation
  // ──────────────────────────────────────────────
  if (route === 'admin/distribution/kill-switch' && method === 'POST') {
    const user = await requireAuth(request, db)
    if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { error: 'Admin access required', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const body = await request.json()
    const enabled = body.enabled !== false // default true

    await db.collection('feature_flags').updateOne(
      { key: 'DISTRIBUTION_AUTO_EVAL' },
      { $set: { key: 'DISTRIBUTION_AUTO_EVAL', enabled, updatedBy: user.id, updatedAt: new Date() } },
      { upsert: true }
    )

    await writeAudit(db, 'DISTRIBUTION_KILL_SWITCH', user.id, 'SYSTEM', 'auto-eval', {
      enabled, toggedBy: user.id,
    })

    return { data: { autoEvalEnabled: enabled, message: enabled ? 'Auto-evaluation ENABLED' : 'Auto-evaluation DISABLED (kill switch active)' } }
  }

  // ──────────────────────────────────────────────
  // GET /admin/distribution/inspect/:contentId — View distribution detail
  // ──────────────────────────────────────────────
  if (path[0] === 'admin' && path[1] === 'distribution' && path[2] === 'inspect' && path.length === 4 && method === 'GET') {
    const user = await requireAuth(request, db)
    if (!['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { error: 'Admin access required', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const contentId = path[3]
    const content = await db.collection('content_items').findOne({ id: contentId }, { projection: { _id: 0 } })
    if (!content) return { error: 'Content not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Collect fresh signals for comparison
    const freshSignals = await collectDistributionSignals(db, content)

    // Get audit history
    const auditTrail = await db.collection('audit_logs')
      .find({ targetId: contentId, eventType: { $regex: /^DISTRIBUTION/ } }, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray()

    return {
      data: {
        contentId,
        currentStage: content.distributionStage || 0,
        reason: content.distributionReason || 'INITIAL',
        evaluatedAt: content.distributionEvaluatedAt || null,
        storedSignals: content.distributionSignals || null,
        freshSignals,
        override: content.distributionOverride ? {
          active: true,
          by: content.distributionOverrideBy,
          at: content.distributionOverrideAt,
          reason: content.distributionReason,
        } : { active: false },
        eligible: content.distributionEligible || false,
        blockedReason: content.distributionBlockedReason || null,
        promotedAt: content.distributionPromotedAt || null,
        auditTrail,
      },
    }
  }

  // ──────────────────────────────────────────────
  // POST /admin/distribution/override — Manual override (survives auto-eval)
  // ──────────────────────────────────────────────
  if (route === 'admin/distribution/override' && method === 'POST') {
    const user = await requireAuth(request, db)
    if (!['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { error: 'Moderator access required', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const body = await request.json()
    const { contentId, stage, reason } = body

    if (!contentId || typeof stage !== 'number' || stage < 0 || stage > 2) {
      return { error: 'contentId and stage (0-2) required', code: ErrorCode.VALIDATION, status: 400 }
    }

    const content = await db.collection('content_items').findOne({ id: contentId })
    if (!content) return { error: 'Content not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const previousStage = content.distributionStage || 0
    const now = new Date()

    await db.collection('content_items').updateOne(
      { id: contentId },
      {
        $set: {
          distributionStage: stage,
          distributionReason: reason || `MANUAL_OVERRIDE_BY_${user.role}`,
          distributionOverride: true,
          distributionOverrideBy: user.id,
          distributionOverrideAt: now,
          distributionEvaluatedAt: now,
          distributionEligible: null,
          distributionBlockedReason: null,
          ...(stage > previousStage ? { distributionPromotedAt: now } : {}),
          updatedAt: now,
        },
      }
    )

    await writeAudit(db, 'DISTRIBUTION_OVERRIDE', user.id, 'CONTENT', contentId, {
      previousStage,
      newStage: stage,
      reason: reason || `MANUAL_OVERRIDE_BY_${user.role}`,
      overriddenBy: user.id,
    })

    return {
      data: {
        contentId,
        previousStage,
        newStage: stage,
        override: true,
        overriddenBy: user.id,
        reason: reason || `MANUAL_OVERRIDE_BY_${user.role}`,
        message: `Distribution overridden to Stage ${stage}. This content is now protected from automatic evaluation.`,
      },
    }
  }

  // ──────────────────────────────────────────────
  // DELETE /admin/distribution/override/:contentId — Remove override (re-enable auto-eval)
  // ──────────────────────────────────────────────
  if (path[0] === 'admin' && path[1] === 'distribution' && path[2] === 'override' && path.length === 4 && method === 'DELETE') {
    const user = await requireAuth(request, db)
    if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { error: 'Admin access required', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const contentId = path[3]
    const content = await db.collection('content_items').findOne({ id: contentId })
    if (!content) return { error: 'Content not found', code: ErrorCode.NOT_FOUND, status: 404 }

    if (!content.distributionOverride) {
      return { error: 'Content is not overridden', code: ErrorCode.VALIDATION, status: 400 }
    }

    await db.collection('content_items').updateOne(
      { id: contentId },
      {
        $set: {
          distributionOverride: false,
          distributionOverrideBy: null,
          distributionOverrideAt: null,
          updatedAt: new Date(),
        },
      }
    )

    await writeAudit(db, 'DISTRIBUTION_OVERRIDE_REMOVED', user.id, 'CONTENT', contentId, {
      previousOverrideBy: content.distributionOverrideBy,
    })

    return { data: { contentId, overrideRemoved: true, message: 'Override removed. Content is now subject to automatic evaluation.' } }
  }

  return null
}

// ═══════════════════════════════════════════════════
// STAGE 5 — Notes / PYQs Library
// ═══════════════════════════════════════════════════

export async function handleResources(path, method, request, db) {
  const route = path.join('/')

  // POST /resources — Create resource
  if (route === 'resources' && method === 'POST') {
    const user = await requireAuth(request, db)

    if (user.ageStatus === 'CHILD') {
      return { error: 'Resource upload requires adult account', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const body = await request.json()
    const { kind, collegeId, branch, subject, semester, title, description, fileAssetId } = body

    if (!kind || !['NOTE', 'PYQ', 'ASSIGNMENT', 'SYLLABUS', 'LAB_FILE'].includes(kind)) {
      return { error: 'kind must be one of: NOTE, PYQ, ASSIGNMENT, SYLLABUS, LAB_FILE', code: ErrorCode.VALIDATION, status: 400 }
    }
    if (!title || title.length < 3) {
      return { error: 'title must be at least 3 characters', code: ErrorCode.VALIDATION, status: 400 }
    }
    if (!collegeId) {
      return { error: 'collegeId is required', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Moderation on title + description
    const textToModerate = [title, description].filter(Boolean).join(' ')
    try {
      await moderateCreateContent(db, {
        entityType: 'resource',
        actorUserId: user.id,
        text: textToModerate,
        title,
        description,
        metadata: { route: 'POST /resources', kind },
      })
    } catch (err) {
      if (err.details?.code === 'CONTENT_REJECTED_BY_MODERATION') {
        return { error: 'Resource content rejected by moderation', code: 'CONTENT_REJECTED', status: 422 }
      }
      throw err
    }

    const resource = {
      id: uuidv4(),
      kind,
      uploaderId: user.id,
      collegeId,
      branch: branch || null,
      subject: subject || null,
      semester: semester ? Number(semester) : null,
      title: title.slice(0, 200),
      description: (description || '').slice(0, 2000),
      fileAssetId: fileAssetId || null,
      status: 'PUBLIC',
      downloadCount: 0,
      reportCount: 0,
      authenticityTags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    await db.collection('resources').insertOne(resource)
    await writeAudit(db, 'RESOURCE_CREATED', user.id, 'RESOURCE', resource.id, { kind, collegeId })

    const { _id, ...clean } = resource
    return { data: { resource: clean }, status: 201 }
  }

  // GET /resources/search — Search resources
  if (route === 'resources/search' && method === 'GET') {
    const url = new URL(request.url)
    const { limit, cursor } = parsePagination(url)

    const query = { status: 'PUBLIC' }
    const collegeId = url.searchParams.get('collegeId')
    const branch = url.searchParams.get('branch')
    const subject = url.searchParams.get('subject')
    const semester = url.searchParams.get('semester')
    const kind = url.searchParams.get('kind')
    const q = url.searchParams.get('q')

    if (collegeId) query.collegeId = collegeId
    if (branch) query.branch = branch
    if (subject) query.subject = { $regex: subject, $options: 'i' }
    if (semester) query.semester = Number(semester)
    if (kind) query.kind = kind
    if (q) query.title = { $regex: q, $options: 'i' }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }

    const resources = await db.collection('resources')
      .find(query, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = resources.length > limit
    const items = resources.slice(0, limit)

    // Enrich with uploader info
    const uploaderIds = [...new Set(items.map(r => r.uploaderId))]
    const users = await db.collection('users').find({ id: { $in: uploaderIds } }).toArray()
    const userMap = Object.fromEntries(users.map(u => [u.id, sanitizeUser(u)]))
    const enriched = items.map(r => ({ ...r, uploader: userMap[r.uploaderId] || null }))

    return {
      data: {
        resources: enriched,
        nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
      },
    }
  }

  // GET /resources/:id — Detail
  if (path[0] === 'resources' && path.length === 2 && path[1] !== 'search' && method === 'GET') {
    const resource = await db.collection('resources').findOne({ id: path[1] }, { projection: { _id: 0 } })
    if (!resource) return { error: 'Resource not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Increment download count
    await db.collection('resources').updateOne({ id: path[1] }, { $inc: { downloadCount: 1 } })

    const uploader = await db.collection('users').findOne({ id: resource.uploaderId })
    const tags = await db.collection('authenticity_tags')
      .find({ targetType: 'RESOURCE', targetId: path[1] }, { projection: { _id: 0 } })
      .toArray()

    return { data: { resource: { ...resource, uploader: uploader ? sanitizeUser(uploader) : null, authenticityTags: tags } } }
  }

  // DELETE /resources/:id — Soft remove
  if (path[0] === 'resources' && path.length === 2 && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const resource = await db.collection('resources').findOne({ id: path[1] })
    if (!resource) return { error: 'Resource not found', code: ErrorCode.NOT_FOUND, status: 404 }

    if (resource.uploaderId !== user.id && !['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { error: 'Not authorized', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    await db.collection('resources').updateOne(
      { id: path[1] },
      { $set: { status: 'REMOVED', updatedAt: new Date() } }
    )

    return { data: { message: 'Resource removed' } }
  }

  // POST /resources/:id/report — Report resource
  if (path[0] === 'resources' && path.length === 3 && path[2] === 'report' && method === 'POST') {
    const user = await requireAuth(request, db)
    const body = await request.json()

    const report = {
      id: uuidv4(),
      reporterId: user.id,
      targetType: 'RESOURCE',
      targetId: path[1],
      reasonCode: body.reasonCode || 'OTHER',
      details: (body.details || '').slice(0, 500),
      status: 'OPEN',
      createdAt: new Date(),
    }

    await db.collection('reports').insertOne(report)

    // Auto-hold at 3+ reports
    const count = await db.collection('reports').countDocuments({ targetId: path[1], status: 'OPEN' })
    if (count >= 3) {
      await db.collection('resources').updateOne({ id: path[1] }, { $set: { status: 'HELD', updatedAt: new Date() } })
    }

    const { _id, ...clean } = report
    return { data: { report: clean }, status: 201 }
  }

  return null
}

// ═══════════════════════════════════════════════════
// STAGE 6 — Events + RSVP
// ═══════════════════════════════════════════════════

export async function handleEvents(path, method, request, db) {
  const route = path.join('/')

  // POST /events — Create event
  if (route === 'events' && method === 'POST') {
    const user = await requireAuth(request, db)
    const body = await request.json()
    const { collegeId, title, description, startAt, endAt, locationText, organizerText } = body

    if (!title || !startAt) {
      return { error: 'title and startAt are required', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Moderation on title + description
    try {
      await moderateCreateContent(db, {
        entityType: 'event',
        actorUserId: user.id,
        text: [title, description].filter(Boolean).join(' '),
        title,
        description,
        metadata: { route: 'POST /events' },
      })
    } catch (err) {
      if (err.details?.code === 'CONTENT_REJECTED_BY_MODERATION') {
        return { error: 'Event content rejected by moderation', code: 'CONTENT_REJECTED', status: 422 }
      }
      throw err
    }

    const event = {
      id: uuidv4(),
      collegeId: collegeId || user.collegeId || null,
      createdByUserId: user.id,
      title: title.slice(0, 200),
      description: (description || '').slice(0, 2000),
      startAt: new Date(startAt),
      endAt: endAt ? new Date(endAt) : null,
      locationText: (locationText || '').slice(0, 200),
      organizerText: (organizerText || '').slice(0, 200),
      status: 'PUBLIC',
      rsvpCount: { going: 0, interested: 0 },
      reportCount: 0,
      authenticityTags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    await db.collection('events').insertOne(event)
    await writeAudit(db, 'EVENT_CREATED', user.id, 'EVENT', event.id, { collegeId: event.collegeId })

    const { _id, ...clean } = event
    return { data: { event: clean }, status: 201 }
  }

  // GET /events/search — Search events
  if (route === 'events/search' && method === 'GET') {
    const url = new URL(request.url)
    const { limit, cursor } = parsePagination(url)

    const query = { status: 'PUBLIC' }
    const collegeId = url.searchParams.get('collegeId')
    const startAfter = url.searchParams.get('startAfter')

    if (collegeId) query.collegeId = collegeId
    if (startAfter) query.startAt = { $gte: new Date(startAfter) }
    if (cursor) query.createdAt = { $lt: new Date(cursor) }

    const events = await db.collection('events')
      .find(query, { projection: { _id: 0 } })
      .sort({ startAt: 1 })
      .limit(limit + 1)
      .toArray()

    const hasMore = events.length > limit
    const items = events.slice(0, limit)

    // Enrich with creator info
    const creatorIds = [...new Set(items.map(e => e.createdByUserId))]
    const users = await db.collection('users').find({ id: { $in: creatorIds } }).toArray()
    const userMap = Object.fromEntries(users.map(u => [u.id, sanitizeUser(u)]))

    const enriched = items.map(e => ({ ...e, creator: userMap[e.createdByUserId] || null }))

    return {
      data: {
        events: enriched,
        nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
      },
    }
  }

  // GET /events/:id — Detail
  if (path[0] === 'events' && path.length === 2 && path[1] !== 'search' && method === 'GET') {
    const event = await db.collection('events').findOne({ id: path[1] }, { projection: { _id: 0 } })
    if (!event) return { error: 'Event not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const creator = await db.collection('users').findOne({ id: event.createdByUserId })
    const tags = await db.collection('authenticity_tags')
      .find({ targetType: 'EVENT', targetId: path[1] }, { projection: { _id: 0 } })
      .toArray()

    // Check if current user has RSVP'd
    let viewerRsvp = null
    try {
      const currentUser = await requireAuth(request, db)
      const rsvp = await db.collection('event_rsvps').findOne({ eventId: path[1], userId: currentUser.id })
      if (rsvp) viewerRsvp = rsvp.status
    } catch {}

    return {
      data: {
        event: {
          ...event,
          creator: creator ? sanitizeUser(creator) : null,
          authenticityTags: tags,
          viewerRsvp,
        },
      },
    }
  }

  // POST /events/:id/rsvp — RSVP
  if (path[0] === 'events' && path.length === 3 && path[2] === 'rsvp' && method === 'POST') {
    const user = await requireAuth(request, db)
    const eventId = path[1]
    const body = await request.json()
    const { status } = body

    if (!status || !['GOING', 'INTERESTED'].includes(status)) {
      return { error: 'status must be GOING or INTERESTED', code: ErrorCode.VALIDATION, status: 400 }
    }

    const event = await db.collection('events').findOne({ id: eventId })
    if (!event) return { error: 'Event not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Upsert RSVP
    const existing = await db.collection('event_rsvps').findOne({ eventId, userId: user.id })
    if (existing) {
      // Update existing RSVP
      const oldStatus = existing.status
      await db.collection('event_rsvps').updateOne(
        { eventId, userId: user.id },
        { $set: { status, updatedAt: new Date() } }
      )
      // Update counts
      await db.collection('events').updateOne(
        { id: eventId },
        { $inc: { [`rsvpCount.${oldStatus.toLowerCase()}`]: -1, [`rsvpCount.${status.toLowerCase()}`]: 1 } }
      )
    } else {
      await db.collection('event_rsvps').insertOne({
        id: uuidv4(),
        eventId,
        userId: user.id,
        status,
        createdAt: new Date(),
      })
      await db.collection('events').updateOne(
        { id: eventId },
        { $inc: { [`rsvpCount.${status.toLowerCase()}`]: 1 } }
      )
    }

    return { data: { rsvp: { eventId, userId: user.id, status } } }
  }

  // DELETE /events/:id/rsvp — Cancel RSVP
  if (path[0] === 'events' && path.length === 3 && path[2] === 'rsvp' && method === 'DELETE') {
    const user = await requireAuth(request, db)
    const eventId = path[1]

    const existing = await db.collection('event_rsvps').findOne({ eventId, userId: user.id })
    if (!existing) return { error: 'No RSVP found', code: ErrorCode.NOT_FOUND, status: 404 }

    await db.collection('event_rsvps').deleteOne({ eventId, userId: user.id })
    await db.collection('events').updateOne(
      { id: eventId },
      { $inc: { [`rsvpCount.${existing.status.toLowerCase()}`]: -1 } }
    )

    return { data: { message: 'RSVP cancelled' } }
  }

  return null
}

// ═══════════════════════════════════════════════════
// STAGE 7 — Board Notices + Authenticity Tags
// ═══════════════════════════════════════════════════

export async function handleBoardNotices(path, method, request, db) {
  const route = path.join('/')

  // POST /board/notices — Board member creates notice
  if (route === 'board/notices' && method === 'POST') {
    const user = await requireAuth(request, db)

    // Must be active board member
    const seat = await db.collection('board_seats').findOne({ userId: user.id, status: 'ACTIVE' })
    if (!seat) return { error: 'Only board members can create notices', code: ErrorCode.FORBIDDEN, status: 403 }

    const body = await request.json()
    const { title, body: noticeBody } = body

    if (!title || !noticeBody) {
      return { error: 'title and body are required', code: ErrorCode.VALIDATION, status: 400 }
    }

    const notice = {
      id: uuidv4(),
      collegeId: seat.collegeId,
      createdByUserId: user.id,
      title: title.slice(0, 200),
      body: noticeBody.slice(0, 5000),
      status: 'PENDING_REVIEW',
      reviewedById: null,
      publishedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    await db.collection('board_notices').insertOne(notice)
    await writeAudit(db, 'BOARD_NOTICE_CREATED', user.id, 'BOARD_NOTICE', notice.id, { collegeId: seat.collegeId })

    const { _id, ...clean } = notice
    return { data: { notice: clean }, status: 201 }
  }

  // GET /colleges/:id/notices — Public published notices
  if (path[0] === 'colleges' && path.length === 3 && path[2] === 'notices' && method === 'GET') {
    const collegeId = path[1]
    const url = new URL(request.url)
    const { limit } = parsePagination(url)

    const notices = await db.collection('board_notices')
      .find({ collegeId, status: 'PUBLISHED' }, { projection: { _id: 0 } })
      .sort({ publishedAt: -1 })
      .limit(limit)
      .toArray()

    return { data: { notices } }
  }

  // GET /moderation/board-notices — Moderator review queue
  if (route === 'moderation/board-notices' && method === 'GET') {
    const user = await requireAuth(request, db)
    if (!['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { error: 'Moderator access required', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const notices = await db.collection('board_notices')
      .find({ status: 'PENDING_REVIEW' }, { projection: { _id: 0 } })
      .sort({ createdAt: 1 })
      .limit(20)
      .toArray()

    return { data: { notices } }
  }

  // POST /moderation/board-notices/:id/decide — Moderator approves/rejects notice
  if (path[0] === 'moderation' && path[1] === 'board-notices' && path.length === 4 && path[3] === 'decide' && method === 'POST') {
    const user = await requireAuth(request, db)
    if (!['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { error: 'Moderator access required', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const noticeId = path[2]
    const body = await request.json()
    const { approve } = body

    if (typeof approve !== 'boolean') {
      return { error: 'approve (boolean) required', code: ErrorCode.VALIDATION, status: 400 }
    }

    const notice = await db.collection('board_notices').findOne({ id: noticeId })
    if (!notice) return { error: 'Notice not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (notice.status !== 'PENDING_REVIEW') return { error: 'Notice not pending review', code: ErrorCode.CONFLICT, status: 409 }

    const now = new Date()
    await db.collection('board_notices').updateOne(
      { id: noticeId },
      {
        $set: {
          status: approve ? 'PUBLISHED' : 'REJECTED',
          reviewedById: user.id,
          publishedAt: approve ? now : null,
          updatedAt: now,
        },
      }
    )

    return { data: { notice: { id: noticeId, status: approve ? 'PUBLISHED' : 'REJECTED' } } }
  }

  return null
}

// Authenticity Tags
export async function handleAuthenticityTags(path, method, request, db) {
  const route = path.join('/')

  // POST /authenticity/tag — Board member or moderator tags
  if (route === 'authenticity/tag' && method === 'POST') {
    const user = await requireAuth(request, db)

    // Must be board member or moderator
    const isModerator = ['MODERATOR', 'ADMIN', 'SUPER_ADMIN'].includes(user.role)
    const isBoardMember = await db.collection('board_seats').findOne({ userId: user.id, status: 'ACTIVE' })

    if (!isModerator && !isBoardMember) {
      return { error: 'Only board members or moderators can add authenticity tags', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const body = await request.json()
    const { targetType, targetId, tag } = body

    if (!targetType || !['RESOURCE', 'EVENT'].includes(targetType)) {
      return { error: 'targetType must be RESOURCE or EVENT', code: ErrorCode.VALIDATION, status: 400 }
    }
    if (!targetId) return { error: 'targetId is required', code: ErrorCode.VALIDATION, status: 400 }
    if (!tag || !['VERIFIED', 'USEFUL', 'OUTDATED', 'MISLEADING'].includes(tag)) {
      return { error: 'tag must be one of: VERIFIED, USEFUL, OUTDATED, MISLEADING', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Check target exists
    const collection = targetType === 'RESOURCE' ? 'resources' : 'events'
    const target = await db.collection(collection).findOne({ id: targetId })
    if (!target) return { error: `${targetType} not found`, code: ErrorCode.NOT_FOUND, status: 404 }

    // Prevent duplicate tags from same actor
    const duplicate = await db.collection('authenticity_tags').findOne({ targetType, targetId, actorId: user.id })
    if (duplicate) {
      // Update existing tag
      await db.collection('authenticity_tags').updateOne(
        { targetType, targetId, actorId: user.id },
        { $set: { tag, updatedAt: new Date() } }
      )
      return { data: { tag: { targetType, targetId, tag, actorId: user.id, updated: true } } }
    }

    const tagDoc = {
      id: uuidv4(),
      targetType,
      targetId,
      tag,
      actorType: isModerator ? 'MODERATOR' : 'BOARD',
      actorId: user.id,
      createdAt: new Date(),
    }

    await db.collection('authenticity_tags').insertOne(tagDoc)

    const { _id, ...clean } = tagDoc
    return { data: { tag: clean }, status: 201 }
  }

  // GET /authenticity/tags/:targetType/:targetId
  if (path[0] === 'authenticity' && path[1] === 'tags' && path.length === 4 && method === 'GET') {
    const targetType = path[2].toUpperCase()
    const targetId = path[3]

    const tags = await db.collection('authenticity_tags')
      .find({ targetType, targetId }, { projection: { _id: 0 } })
      .sort({ createdAt: -1 })
      .toArray()

    return { data: { tags } }
  }

  return null
}
