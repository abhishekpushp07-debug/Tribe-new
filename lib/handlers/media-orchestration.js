/**
 * Tribe — Media Pipeline Orchestration Layer (Stage 2, Block 5)
 * 
 * TRUTH HIERARCHY:
 *   1. tribeapp.pro (upstream) = GOD source of truth
 *   2. Supabase object existence = storage substrate, NOT readiness
 *   3. Local MongoDB = orchestration cache ONLY, never outranks upstream
 * 
 * This layer WRAPS existing media endpoints. It does NOT replace them.
 * Zero breaking changes. Old flows continue to work.
 */

import { v4 as uuidv4 } from 'uuid'
import { requireAuth } from '../auth-utils.js'
import { ErrorCode } from '../constants.js'

// Status domain enums — NEVER collapse into one flat field
const UploadState = {
  NOT_STARTED: 'not_started',
  SESSION_CREATED: 'session_created',
  UPLOAD_IN_PROGRESS: 'upload_in_progress',
  UPLOAD_FINISHED_LOCAL: 'upload_finished_local',
  COMPLETION_NOTIFIED: 'completion_notified',
  COMPLETION_CONFIRMED: 'completion_confirmed',
  FAILED: 'failed',
  CANCELED: 'canceled',
  SUSPECT: 'suspect',
  RETRY_PENDING: 'retry_pending',
}

const ProcessingState = {
  NOT_APPLICABLE: 'not_applicable',
  NOT_STARTED: 'not_started',
  QUEUED: 'queued',
  PROCESSING: 'processing',
  READY: 'ready',
  FAILED: 'failed',
  UNKNOWN: 'unknown',
}

const PlaybackState = {
  NOT_APPLICABLE: 'not_applicable',
  RAW_ORIGINAL_ONLY: 'raw_original_only',
  POSTER_READY: 'poster_ready',
  PROCESSED_READY: 'processed_ready',
  READY: 'ready',
  FAILED: 'failed',
  UNKNOWN: 'unknown',
}

const CancelState = {
  NOT_REQUESTED: 'not_requested',
  REQUESTED: 'requested',
  CONFIRMED: 'confirmed',
  NOT_POSSIBLE: 'not_possible',
  ALREADY_COMPLETED: 'already_completed',
}

// Structured logging — never log signed URLs or secrets
function logEvent(logger, event, data) {
  const safe = { ...data }
  delete safe.uploadUrl
  delete safe.signedUrl
  delete safe.token
  if (safe.objectPath) safe.objectPath = safe.objectPath.slice(-40)
  logger.info('MEDIA_ORCHESTRATION', event, safe)
}

export async function handleMediaOrchestration(path, method, request, db) {
  const { default: logger } = await import('@/lib/logger')

  // ══════════════════════════════════════════════════════════════
  // POST /api/media/upload-sessions — Create orchestration session
  // ══════════════════════════════════════════════════════════════
  if (path.join('/') === 'media/upload-sessions' && method === 'POST') {
    const user = await requireAuth(request, db)
    const body = await request.json()

    const { moduleType, mediaKind, mimeType, sizeBytes, durationMs, fileName, visibility, correlationId: clientCorrelation } = body

    // Validate required fields
    if (!mediaKind || !mimeType || !sizeBytes) {
      return { error: 'mediaKind, mimeType, sizeBytes required', code: ErrorCode.VALIDATION, status: 400 }
    }

    const correlationId = clientCorrelation || uuidv4()
    const localSessionId = uuidv4()
    const lineageId = uuidv4()

    logEvent(logger, 'media_upload_session_requested', { correlationId, localSessionId, moduleType, mediaKind, mimeType, sizeBytes, userId: user.id })

    // Call existing upload-init (the real upstream truth)
    const { handleMedia } = await import('./media.js')
    const initRequest = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({ kind: mediaKind, mimeType, sizeBytes, scope: moduleType || 'posts', fileName }),
    })

    let upstreamResult
    try {
      upstreamResult = await handleMedia(['media', 'upload-init'], 'POST', initRequest, db)
    } catch (err) {
      logEvent(logger, 'media_upload_session_failed', { correlationId, localSessionId, error: err.message })
      // Create failed session record
      await db.collection('media_sessions').insertOne({
        localSessionId, correlationId, lineageId, userId: user.id,
        moduleType: moduleType || 'posts', mediaKind, mimeType, sizeBytes, durationMs, fileName,
        uploadState: UploadState.FAILED, processingState: ProcessingState.NOT_APPLICABLE,
        playbackState: PlaybackState.NOT_APPLICABLE, cancelState: CancelState.NOT_REQUESTED,
        attemptNumber: 1, lastErrorCode: 'UPSTREAM_INIT_FAILED', lastErrorMessage: err.message,
        createdAt: new Date(), updatedAt: new Date(),
      })
      return { error: 'Upstream upload-init failed', code: 'UPSTREAM_ERROR', status: 502, data: { correlationId, localSessionId } }
    }

    const upstreamData = upstreamResult?.data || {}
    const upstreamMediaId = upstreamData.mediaId || ''
    const uploadUrl = upstreamData.uploadUrl || ''
    const objectPath = upstreamData.path || ''
    const publicUrl = upstreamData.publicUrl || ''
    const uploadMethod = upstreamData.uploadMethod || 'signed'

    // Create orchestration session record
    const session = {
      localSessionId,
      upstreamMediaId,
      correlationId,
      lineageId,
      userId: user.id,
      moduleType: moduleType || 'posts',
      mediaKind,
      mimeType,
      sizeBytes,
      durationMs: durationMs || 0,
      fileName: fileName || '',
      visibility: visibility || 'PUBLIC',
      uploadStrategy: uploadMethod,
      transportUsed: '',
      attemptNumber: 1,
      uploadState: UploadState.SESSION_CREATED,
      processingState: ProcessingState.NOT_STARTED,
      playbackState: PlaybackState.NOT_APPLICABLE,
      cancelState: CancelState.NOT_REQUESTED,
      lastKnownUpstreamState: 'PENDING_UPLOAD',
      objectPath,
      finalPlaybackPath: '',
      lastErrorCode: '',
      lastErrorMessage: '',
      cleanupState: 'none',
      truthSource: 'upstream_init',
      createdAt: new Date(),
      updatedAt: new Date(),
      completedAt: null,
      canceledAt: null,
    }

    await db.collection('media_sessions').insertOne(session)

    logEvent(logger, 'media_upload_session_created', { correlationId, localSessionId, upstreamMediaId, uploadStrategy: uploadMethod })

    return {
      data: {
        success: true,
        mediaAssetId: upstreamMediaId,
        uploadSessionId: localSessionId,
        uploadStrategy: uploadMethod,
        uploadUrl,
        publicUrl,
        objectPath,
        expiresAt: upstreamData.expiresAt || '',
        correlationId,
        status: { uploadState: UploadState.SESSION_CREATED, processingState: ProcessingState.NOT_STARTED },
        compressionHints: upstreamData.compressionHints || null,
        resumable: upstreamData.resumable || null,
      },
      status: 201,
    }
  }

  // ══════════════════════════════════════════════════════════════
  // POST /api/media/{id}/upload-complete — Forward completion
  // ══════════════════════════════════════════════════════════════
  if (path[0] === 'media' && path.length === 3 && path[2] === 'upload-complete' && method === 'POST') {
    const user = await requireAuth(request, db)
    const mediaId = path[1]
    const body = await request.json()

    // Find local session
    const session = await db.collection('media_sessions').findOne({
      $or: [{ upstreamMediaId: mediaId }, { localSessionId: mediaId }],
      userId: user.id,
    })

    const correlationId = session?.correlationId || body.correlationId || ''

    logEvent(logger, 'media_upload_complete_requested', { correlationId, mediaId, hasSession: !!session })

    // Idempotency: if already confirmed, return success
    if (session?.uploadState === UploadState.COMPLETION_CONFIRMED) {
      return { data: { success: true, message: 'Already completed', uploadState: UploadState.COMPLETION_CONFIRMED, correlationId } }
    }

    // Forward to existing upload-complete
    const { handleMedia } = await import('./media.js')
    const completeRequest = new Request(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify({ mediaId: session?.upstreamMediaId || mediaId, ...body }),
    })

    let upstreamResult
    try {
      upstreamResult = await handleMedia(['media', 'upload-complete'], 'POST', completeRequest, db)
    } catch (err) {
      logEvent(logger, 'media_upload_complete_failed', { correlationId, mediaId, error: err.message })
      if (session) {
        await db.collection('media_sessions').updateOne(
          { localSessionId: session.localSessionId },
          { $set: { uploadState: UploadState.SUSPECT, lastErrorMessage: err.message, lastErrorCode: 'COMPLETION_FAILED', updatedAt: new Date() } }
        )
      }
      return { error: 'Upload completion failed upstream', code: 'COMPLETION_FAILED', status: 502, data: { correlationId, uploadState: UploadState.SUSPECT } }
    }

    // Update session
    const upstreamData = upstreamResult?.data || {}
    const newUploadState = upstreamData.status === 'READY' ? UploadState.COMPLETION_CONFIRMED : UploadState.COMPLETION_NOTIFIED
    const newProcessingState = upstreamData.playbackStatus === 'PROCESSING' ? ProcessingState.PROCESSING : ProcessingState.NOT_STARTED

    if (session) {
      await db.collection('media_sessions').updateOne(
        { localSessionId: session.localSessionId },
        { $set: {
          uploadState: newUploadState,
          processingState: newProcessingState,
          lastKnownUpstreamState: upstreamData.playbackStatus || upstreamData.status || 'READY',
          truthSource: 'upstream_complete',
          completedAt: new Date(),
          updatedAt: new Date(),
        }}
      )
    }

    logEvent(logger, 'media_upload_complete_confirmed', { correlationId, mediaId, uploadState: newUploadState, processingState: newProcessingState })

    return { data: { success: true, uploadState: newUploadState, processingState: newProcessingState, correlationId, ...upstreamData } }
  }

  // ══════════════════════════════════════════════════════════════
  // GET /api/media/{id}/pipeline-status — Separated status domains
  // ══════════════════════════════════════════════════════════════
  if (path[0] === 'media' && path.length === 3 && path[2] === 'pipeline-status' && method === 'GET') {
    const user = await requireAuth(request, db)
    const mediaId = path[1]

    // Get local session
    const session = await db.collection('media_sessions').findOne({
      $or: [{ upstreamMediaId: mediaId }, { localSessionId: mediaId }],
    })

    // Get upstream truth from media_assets
    const asset = await db.collection('media_assets').findOne(
      { id: session?.upstreamMediaId || mediaId },
      { projection: { _id: 0, id: 1, status: 1, playbackStatus: 1, playbackUrl: 1, hlsUrl: 1, thumbnailUrl: 1, posterFrameUrl: 1, variants: 1, processing: 1, videoMeta: 1, publicUrl: 1 } }
    )

    // Reconciliation: determine honest status for each domain
    let uploadState = session?.uploadState || (asset?.status === 'READY' ? UploadState.COMPLETION_CONFIRMED : UploadState.UNKNOWN)
    let processingState = ProcessingState.NOT_STARTED
    let playbackState = PlaybackState.NOT_APPLICABLE

    if (asset) {
      // Processing state from upstream
      if (asset.playbackStatus === 'READY') processingState = ProcessingState.READY
      else if (asset.playbackStatus === 'PROCESSING') processingState = ProcessingState.PROCESSING
      else if (asset.playbackStatus === 'FAILED') processingState = ProcessingState.FAILED
      else if (asset.status === 'READY') processingState = ProcessingState.NOT_STARTED

      // Playback state — HONEST: check actual URLs exist
      const v = asset.variants || {}
      const hasProcessedMp4 = !!(v['720p']?.url || v.ultrafast_720p?.url || v['480p']?.url)
      const hasPoster = !!(asset.posterFrameUrl || asset.thumbnailUrl || v.poster?.url || v.thumbnail?.url)
      const hasHls = !!asset.hlsUrl

      if (hasProcessedMp4 || hasHls) {
        playbackState = PlaybackState.PROCESSED_READY
      } else if (hasPoster) {
        playbackState = PlaybackState.POSTER_READY
      } else if (asset.publicUrl) {
        playbackState = PlaybackState.RAW_ORIGINAL_ONLY
      }

      // RECONCILIATION RULE: if upstream says ready but no playback URL → suspect
      if (asset.playbackStatus === 'READY' && !hasProcessedMp4 && !asset.publicUrl) {
        playbackState = PlaybackState.FAILED
        if (session) {
          logEvent(logger, 'media_status_truth_disagreement', {
            correlationId: session.correlationId, mediaId,
            reason: 'upstream_ready_but_no_playback_url',
          })
        }
      }

      // RECONCILIATION RULE: object might be missing
      if (asset.status === 'READY' && !asset.publicUrl) {
        uploadState = UploadState.SUSPECT
        if (session) {
          logEvent(logger, 'media_orphan_detected', { correlationId: session.correlationId, mediaId })
        }
      }
    }

    const canRetry = [UploadState.FAILED, UploadState.SUSPECT, UploadState.CANCELED].includes(uploadState)
    const canCancel = [UploadState.SESSION_CREATED, UploadState.UPLOAD_IN_PROGRESS].includes(uploadState)

    return { data: {
      mediaId: session?.upstreamMediaId || mediaId,
      localSessionId: session?.localSessionId || '',
      correlationId: session?.correlationId || '',
      moduleType: session?.moduleType || '',
      mediaKind: session?.mediaKind || '',
      attemptNumber: session?.attemptNumber || 1,
      // Separated status domains — NEVER collapsed
      uploadState,
      processingState,
      playbackState,
      cancelState: session?.cancelState || CancelState.NOT_REQUESTED,
      // Actions
      canRetry,
      canCancel,
      // Error
      lastError: session?.lastErrorMessage ? { code: session.lastErrorCode, message: session.lastErrorMessage } : null,
      // Upstream truth
      upstreamRef: { status: asset?.status || '', playbackStatus: asset?.playbackStatus || '' },
      // Playback URLs (only if actually ready)
      recommendedPlaybackUrl: playbackState === PlaybackState.PROCESSED_READY || playbackState === PlaybackState.RAW_ORIGINAL_ONLY
        ? (asset?.playbackUrl || asset?.variants?.['720p']?.url || asset?.publicUrl || '') : '',
      posterUrl: asset?.posterFrameUrl || asset?.thumbnailUrl || asset?.variants?.poster?.url || '',
      hlsUrl: asset?.hlsUrl || '',
      // Metadata
      truthSource: session?.truthSource || 'upstream_asset',
      transportUsed: session?.transportUsed || '',
    }}
  }

  // ══════════════════════════════════════════════════════════════
  // POST /api/media/{id}/cancel — Cancel upload session
  // ══════════════════════════════════════════════════════════════
  if (path[0] === 'media' && path.length === 3 && path[2] === 'cancel' && method === 'POST') {
    const user = await requireAuth(request, db)
    const mediaId = path[1]

    const session = await db.collection('media_sessions').findOne({
      $or: [{ upstreamMediaId: mediaId }, { localSessionId: mediaId }],
      userId: user.id,
    })

    if (!session) return { error: 'Session not found', code: ErrorCode.NOT_FOUND, status: 404 }

    logEvent(logger, 'media_cancel_requested', { correlationId: session.correlationId, localSessionId: session.localSessionId, currentState: session.uploadState })

    let cancelResult
    // Determine if cancelable
    if (session.uploadState === UploadState.CANCELED) {
      cancelResult = 'already_canceled'
    } else if (session.uploadState === UploadState.COMPLETION_CONFIRMED) {
      cancelResult = 'already_completed_cannot_cancel'
    } else if (session.uploadState === UploadState.FAILED) {
      cancelResult = 'already_failed'
    } else if ([UploadState.SESSION_CREATED, UploadState.UPLOAD_IN_PROGRESS].includes(session.uploadState)) {
      cancelResult = 'canceled_before_completion'
      await db.collection('media_sessions').updateOne(
        { localSessionId: session.localSessionId },
        { $set: { uploadState: UploadState.CANCELED, cancelState: CancelState.CONFIRMED, canceledAt: new Date(), updatedAt: new Date() } }
      )
    } else {
      cancelResult = 'cancel_requested_but_transport_non_cancelable'
      await db.collection('media_sessions').updateOne(
        { localSessionId: session.localSessionId },
        { $set: { cancelState: CancelState.REQUESTED, updatedAt: new Date() } }
      )
    }

    logEvent(logger, 'media_cancel_result', { correlationId: session.correlationId, cancelResult })

    return { data: { cancelResult, correlationId: session.correlationId, localSessionId: session.localSessionId } }
  }

  // ══════════════════════════════════════════════════════════════
  // POST /api/media/{id}/retry — Fresh retry with lineage
  // ══════════════════════════════════════════════════════════════
  if (path[0] === 'media' && path.length === 3 && path[2] === 'retry' && method === 'POST') {
    const user = await requireAuth(request, db)
    const mediaId = path[1]

    const session = await db.collection('media_sessions').findOne({
      $or: [{ upstreamMediaId: mediaId }, { localSessionId: mediaId }],
      userId: user.id,
    })

    if (!session) return { error: 'Session not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Only retry if failed/suspect/canceled
    if (![UploadState.FAILED, UploadState.SUSPECT, UploadState.CANCELED].includes(session.uploadState)) {
      return { error: 'Cannot retry: current state does not allow retry', code: ErrorCode.VALIDATION, status: 400, data: { currentState: session.uploadState } }
    }

    logEvent(logger, 'media_retry_requested', { correlationId: session.correlationId, localSessionId: session.localSessionId, attemptNumber: session.attemptNumber })

    // Mark old session as retry_pending
    await db.collection('media_sessions').updateOne(
      { localSessionId: session.localSessionId },
      { $set: { uploadState: UploadState.RETRY_PENDING, updatedAt: new Date() } }
    )

    // Create fresh attempt via upload-sessions
    const newBody = {
      moduleType: session.moduleType,
      mediaKind: session.mediaKind,
      mimeType: session.mimeType,
      sizeBytes: session.sizeBytes,
      durationMs: session.durationMs,
      fileName: session.fileName,
      visibility: session.visibility,
      correlationId: session.correlationId, // preserve correlation
    }

    const initRequest = new Request(request.url.replace(/\/retry$/, '').replace(/\/[^/]+\/retry$/, '/upload-sessions'), {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(newBody),
    })

    const result = await handleMediaOrchestration(['media', 'upload-sessions'], 'POST', initRequest, db)

    // Update new session with lineage
    if (result?.data?.uploadSessionId) {
      await db.collection('media_sessions').updateOne(
        { localSessionId: result.data.uploadSessionId },
        { $set: {
          lineageId: session.lineageId,
          attemptNumber: session.attemptNumber + 1,
          previousSessionId: session.localSessionId,
        }}
      )
    }

    logEvent(logger, 'media_retry_created', { correlationId: session.correlationId, newSessionId: result?.data?.uploadSessionId, attemptNumber: session.attemptNumber + 1 })

    return result
  }

  return null
}
