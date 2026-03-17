import { v4 as uuidv4 } from 'uuid'
import { NextResponse } from 'next/server'
import { requireAuth } from '../auth-utils.js'
import { ErrorCode, Config } from '../constants.js'
import { uploadToStorage, downloadFromStorage, isStorageAvailable } from '../storage.js'
import {
  createSignedUploadUrl, getPublicUrl, verifyFileExists,
  validateMimeType, validateFileSize, ensureBucket,
  ALLOWED_MIME_TYPES, MAX_FILE_SIZE,
} from '../supabase-storage.js'
import { startRetryWorker as startVideoRetryWorker } from '../services/video-pipeline.js'

const MEDIA_PROVIDER = process.env.MEDIA_PROVIDER || 'legacy'

export async function handleMedia(path, method, request, db) {

  // Start retry worker for failed video transcodes (lazy init)
  startVideoRetryWorker(db)

  // ========================
  // POST /media/upload-init OR /media/initiate — Get signed URL for direct-to-Supabase upload
  // ========================
  if ((path.join('/') === 'media/upload-init' || path.join('/') === 'media/initiate') && method === 'POST') {
    const user = await requireAuth(request, db)

    if (user.ageStatus === 'CHILD') {
      return { error: 'Media upload not available for users under 18', code: ErrorCode.CHILD_RESTRICTED, status: 403 }
    }

    const body = await request.json()
    // Accept both naming conventions:
    // Standard: kind, mimeType, sizeBytes, scope
    // Alternative: type/fileName, mimeType, size
    const kind = body.kind || (body.type ? body.type.toLowerCase() : (body.mimeType?.startsWith('video/') ? 'video' : body.mimeType?.startsWith('image/') ? 'image' : null))
    const mimeType = body.mimeType || body.contentType
    const sizeBytes = body.sizeBytes || body.size || body.fileSize
    const scope = body.scope

    // Validate required fields
    if (!kind || !mimeType || !sizeBytes) {
      return { error: 'kind (or type), mimeType, and sizeBytes (or size) are required', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Validate kind
    if (!['image', 'video'].includes(kind)) {
      return { error: 'kind must be "image" or "video"', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Validate scope
    const validScopes = ['reels', 'stories', 'posts', 'thumbnails']
    const fileScope = validScopes.includes(scope) ? scope : 'posts'

    // Validate mime type
    if (!validateMimeType(mimeType)) {
      return {
        error: `Invalid mimeType. Allowed: ${ALLOWED_MIME_TYPES.join(', ')}`,
        code: ErrorCode.VALIDATION,
        status: 400,
      }
    }

    // Validate kind matches mime
    if (kind === 'image' && !mimeType.startsWith('image/')) {
      return { error: 'kind=image requires an image mimeType', code: ErrorCode.VALIDATION, status: 400 }
    }
    if (kind === 'video' && !mimeType.startsWith('video/') && !mimeType.startsWith('audio/')) {
      return { error: 'kind=video requires a video or audio mimeType', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Validate file size
    if (!validateFileSize(sizeBytes)) {
      return {
        error: `File size must be between 1 byte and ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB`,
        code: ErrorCode.PAYLOAD_TOO_LARGE,
        status: 413,
      }
    }

    // Generate unique file path
    const ext = mimeType.split('/')[1] === 'quicktime' ? 'mov' : (mimeType.split('/')[1] || 'bin')
    const mediaId = uuidv4()
    const filePath = `${fileScope}/${user.id}/${mediaId}.${ext}`

    try {
      const { signedUrl, token, publicUrl } = await createSignedUploadUrl(filePath)

      // Create pending media record with explicit lifecycle fields
      const now = new Date()
      const UPLOAD_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours
      const asset = {
        id: mediaId,
        ownerId: user.id,
        kind: kind.toUpperCase(),
        type: kind.toUpperCase(),
        mimeType,
        sizeBytes,
        size: sizeBytes,
        scope: fileScope,
        width: null,
        height: null,
        duration: null,
        status: 'PENDING_UPLOAD',
        storageType: 'SUPABASE',
        storagePath: filePath,
        publicUrl,
        isDeleted: false,
        // Lifecycle fields
        expiresAt: new Date(now.getTime() + UPLOAD_TTL_MS),
        thumbnailStatus: 'NONE',
        thumbnailUrl: null,
        thumbnailMediaId: null,
        thumbnailError: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      }

      await db.collection('media_assets').insertOne(asset)

      // Upload mode: resumable for large videos (>5MB), signed URL for small files
      const RESUMABLE_THRESHOLD = 5 * 1024 * 1024 // 5MB
      const isLargeVideo = kind === 'video' && sizeBytes > RESUMABLE_THRESHOLD
      const isVideo = kind === 'video'

      let uploadMethod, resumableConfig
      if (isLargeVideo) {
        // TUS resumable upload for large videos — survives network drops
        const { createResumableUploadUrl } = await import('../supabase-storage.js')
        resumableConfig = await createResumableUploadUrl(filePath)
        uploadMethod = 'resumable'
      } else {
        uploadMethod = 'signed'
      }

      return {
        data: {
          mediaId,
          uploadUrl: signedUrl,
          token,
          path: filePath,
          publicUrl,
          expiresIn: 7200,
          expiresAt: asset.expiresAt.toISOString(),
          thumbnailStatus: 'NONE',
          status: 'PENDING_UPLOAD',
          // World best: upload optimization
          uploadMethod, // "signed" (small files) or "resumable" (large videos)
          ...(resumableConfig ? {
            resumable: {
              endpoint: resumableConfig.tusEndpoint,
              headers: resumableConfig.headers,
              bucketId: resumableConfig.bucketId,
              objectName: resumableConfig.objectName,
              chunkSize: 6 * 1024 * 1024, // 6MB chunks recommended
            },
          } : {}),
          // Compression recommendations for frontend
          ...(isVideo ? {
            compressionHints: {
              recommended: true,
              maxWidth: 1080,
              maxHeight: 1920,
              maxBitrate: 4000000, // 4Mbps
              maxFps: 30,
              codec: 'h264',
              container: 'mp4',
              quality: 'medium', // expo-av VideoCodec.H264, quality 0.6-0.7
              estimatedCompressedSize: Math.round(sizeBytes * 0.3), // ~70% reduction
              message: 'Compress video before upload for 3x faster upload speed',
            },
          } : {}),
        },
        status: 201,
      }
    } catch (err) {
      const { default: logger } = await import('@/lib/logger')
      logger.error('MEDIA', 'upload_init_failed', { error: err.message, userId: user.id })
      return { error: 'Failed to initialize upload', code: ErrorCode.INTERNAL, status: 500 }
    }
  }

  // ========================
  // POST /media/upload-complete — Finalize upload after client uploads to Supabase
  // ========================
  if ((path.join('/') === 'media/upload-complete' || path.join('/') === 'media/complete') && method === 'POST') {
    const user = await requireAuth(request, db)

    const body = await request.json()
    const { mediaId, width, height, duration } = body

    if (!mediaId) {
      return { error: 'mediaId is required', code: ErrorCode.VALIDATION, status: 400 }
    }

    const asset = await db.collection('media_assets').findOne({
      id: mediaId, ownerId: user.id, isDeleted: { $ne: true },
    })

    if (!asset) {
      return { error: 'Media asset not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    if (asset.status === 'READY') {
      // Already completed — idempotent
      return {
        data: {
          id: asset.id,
          url: asset.publicUrl || `/api/media/${asset.id}`,
          publicUrl: asset.publicUrl,
          type: asset.type,
          kind: asset.kind,
          mimeType: asset.mimeType,
          size: asset.sizeBytes || asset.size,
          storageType: asset.storageType,
          status: 'READY',
        },
        status: 200,
      }
    }

    if (asset.status !== 'PENDING_UPLOAD') {
      return { error: `Cannot complete upload in status: ${asset.status}`, code: ErrorCode.INVALID_STATE, status: 400 }
    }

    // WORKSTREAM C: Reject expired upload sessions explicitly
    if (asset.expiresAt && new Date(asset.expiresAt) < new Date()) {
      await db.collection('media_assets').updateOne(
        { id: mediaId, status: 'PENDING_UPLOAD' },
        { $set: { status: 'EXPIRED', updatedAt: new Date() } }
      )
      return {
        error: 'Upload session expired. Please start a new upload.',
        code: 'UPLOAD_EXPIRED',
        status: 410,
        data: { expiredAt: asset.expiresAt },
      }
    }

    // Verify file exists in Supabase
    try {
      const exists = await verifyFileExists(asset.storagePath)
      if (!exists) {
        return { error: 'File not found in storage. Please upload the file first.', code: ErrorCode.NOT_FOUND, status: 404 }
      }
    } catch (err) {
      // If verification fails, still mark as ready (Supabase may have latency on list)
      const { default: logger } = await import('@/lib/logger')
      logger.warn('MEDIA', 'verify_file_skipped', { error: err.message, mediaId })
    }

    const now = new Date()
    const updates = {
      status: 'READY',
      updatedAt: now,
      completedAt: now,
    }
    if (width) updates.width = width
    if (height) updates.height = height
    if (duration) updates.duration = duration

    await db.collection('media_assets').updateOne(
      { id: mediaId },
      { $set: updates }
    )

    // VIDEO PROCESSING PIPELINE — async, non-blocking
    // Runs: probe → faststart → 720p transcode → thumbnail → poster → update DB
    let thumbnailStatus = 'NONE'
    let playbackStatus = 'READY'
    if (asset.kind === 'VIDEO' || (asset.mimeType && asset.mimeType.startsWith('video/'))) {
      thumbnailStatus = 'PENDING'
      playbackStatus = 'PROCESSING'

      // Set initial processing state
      await db.collection('media_assets').updateOne(
        { id: mediaId },
        { $set: { playbackStatus: 'PROCESSING', thumbnailStatus: 'PENDING', processing: { started: false }, updatedAt: new Date() } }
      )

      // Fire-and-forget: full video pipeline
      ;(async () => {
        try {
          const { processVideo } = await import('../services/video-pipeline.js')
          const updatedAsset = { ...asset, ...updates }
          await processVideo(db, updatedAsset)
        } catch (err) {
          const { default: logger } = await import('@/lib/logger')
          logger.error('MEDIA', 'video_pipeline_trigger_failed', { error: err.message, mediaId })
          // Fallback: try old thumbnail generator
          try {
            const { generateVideoThumbnail } = await import('./media-cleanup.js')
            await generateVideoThumbnail(db, { ...asset, ...updates })
          } catch {}
        }
      })()
    }

    return {
      data: {
        id: asset.id,
        url: asset.publicUrl || `/api/media/${asset.id}`,
        publicUrl: asset.publicUrl,
        thumbnailUrl: null,
        thumbnailStatus,
        playbackStatus,
        type: asset.type,
        kind: asset.kind,
        mimeType: asset.mimeType,
        size: asset.sizeBytes || asset.size,
        storageType: asset.storageType,
        status: 'READY',
        processing: playbackStatus === 'PROCESSING' ? { faststart: false, transcoded: false, thumbnailGenerated: false, posterGenerated: false } : undefined,
      },
      status: 200,
    }
  }

  // ========================
  // GET /media/upload-status/:mediaId — Check upload status
  // ========================
  if (path[0] === 'media' && path[1] === 'upload-status' && path.length === 3 && method === 'GET') {
    const user = await requireAuth(request, db)
    const mediaId = path[2]

    const asset = await db.collection('media_assets').findOne(
      { id: mediaId, ownerId: user.id, isDeleted: { $ne: true } },
      { projection: { _id: 0, data: 0 } }
    )

    if (!asset) {
      return { error: 'Media asset not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    return {
      data: {
        id: asset.id,
        status: asset.status,
        playbackStatus: asset.playbackStatus || (asset.status === 'READY' ? 'READY' : 'UPLOADING'),
        playbackUrl: asset.playbackUrl || asset.publicUrl,
        publicUrl: asset.publicUrl,
        type: asset.type,
        kind: asset.kind,
        mimeType: asset.mimeType,
        size: asset.sizeBytes || asset.size,
        storageType: asset.storageType,
        thumbnailStatus: asset.thumbnailStatus || 'NONE',
        thumbnailUrl: asset.thumbnailUrl || null,
        posterFrameUrl: asset.posterFrameUrl || null,
        variants: asset.variants || {},
        processing: asset.processing || {},
        videoMeta: asset.videoMeta || {},
        expiresAt: asset.expiresAt || null,
      },
    }
  }

  // ========================
  // GET /media/:mediaId/processing — Video processing status (detailed)
  // ========================
  if (path[0] === 'media' && path.length === 3 && path[2] === 'processing' && method === 'GET') {
    const user = await requireAuth(request, db)
    const mediaId = path[1]

    const { getProcessingStatus } = await import('../services/video-pipeline.js')
    const status = await getProcessingStatus(db, mediaId)
    if (!status) return { error: 'Media not found', code: ErrorCode.NOT_FOUND, status: 404 }
    return { data: status }
  }

  // ========================
  // POST /media/:mediaId/compress — Server-side video compression
  // Frontend uploads raw video → backend compresses → re-uploads compressed version
  // ========================
  if (path[0] === 'media' && path.length === 3 && path[2] === 'compress' && method === 'POST') {
    const user = await requireAuth(request, db)
    const mediaId = path[1]

    const asset = await db.collection('media_assets').findOne({ id: mediaId, ownerId: user.id, isDeleted: { $ne: true } })
    if (!asset) return { error: 'Media not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (!asset.publicUrl) return { error: 'No source file to compress', code: ErrorCode.VALIDATION, status: 400 }
    if (asset.mimeType && !asset.mimeType.startsWith('video/')) {
      return { error: 'Only video files can be compressed', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Mark as compressing
    await db.collection('media_assets').updateOne(
      { id: mediaId },
      { $set: { playbackStatus: 'COMPRESSING', updatedAt: new Date() } }
    )

    // Fire-and-forget: compress in background
    ;(async () => {
      try {
        const { processVideo } = await import('../services/video-pipeline.js')
        await processVideo(db, asset)
      } catch (err) {
        const { default: logger } = await import('@/lib/logger')
        logger.error('MEDIA', 'compress_failed', { mediaId, error: err.message })
        await db.collection('media_assets').updateOne(
          { id: mediaId },
          { $set: { playbackStatus: 'READY', updatedAt: new Date() } }
        ).catch(() => {})
      }
    })()

    return {
      data: {
        mediaId,
        status: 'COMPRESSING',
        message: 'Video compression started. Poll GET /media/:id/processing for status.',
        estimatedTime: '5-15 seconds',
      },
    }
  }

  // ========================
  // PATCH /media/:mediaId/metadata — Update media asset metadata (thumbnails, variants, processing)
  // Admin or owner can set thumbnailUrl, posterFrameUrl, variants, playbackUrl
  // ========================
  if (path[0] === 'media' && path.length === 3 && path[2] === 'metadata' && method === 'PATCH') {
    const user = await requireAuth(request, db)
    const mediaId = path[1]

    const asset = await db.collection('media_assets').findOne({ id: mediaId, isDeleted: { $ne: true } })
    if (!asset) return { error: 'Media not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(user.role)
    if (asset.ownerId !== user.id && !isAdmin) {
      return { error: 'Not your media', code: ErrorCode.FORBIDDEN, status: 403 }
    }

    const body = await request.json()
    const updates = { updatedAt: new Date() }

    if (body.thumbnailUrl !== undefined) updates.thumbnailUrl = body.thumbnailUrl
    if (body.posterFrameUrl !== undefined) updates.posterFrameUrl = body.posterFrameUrl
    if (body.playbackUrl !== undefined) updates.playbackUrl = body.playbackUrl
    if (body.thumbnailStatus !== undefined) updates.thumbnailStatus = body.thumbnailStatus
    if (body.playbackStatus !== undefined) updates.playbackStatus = body.playbackStatus
    if (body.variants !== undefined) updates.variants = body.variants
    if (body.videoMeta !== undefined) updates.videoMeta = body.videoMeta
    if (body.width !== undefined) updates.width = body.width
    if (body.height !== undefined) updates.height = body.height
    if (body.duration !== undefined) updates.duration = body.duration

    await db.collection('media_assets').updateOne({ id: mediaId }, { $set: updates })

    return { data: { mediaId, updated: Object.keys(updates).filter(k => k !== 'updatedAt') } }
  }

  // ========================
  // POST /media/chunked/init — Initialize a chunked upload session (for large videos)
  // ========================
  if (path.join('/') === 'media/chunked/init' && method === 'POST') {
    const user = await requireAuth(request, db)

    if (user.ageStatus === 'CHILD') {
      return { error: 'Media upload not available for users under 18', code: ErrorCode.CHILD_RESTRICTED, status: 403 }
    }

    const body = await request.json()
    const { mimeType, fileName, totalSize, totalChunks, kind, width, height, duration } = body
    const mediaKind = kind || (mimeType?.startsWith('video/') ? 'video' : 'image')

    if (!mimeType || !totalSize || !totalChunks) {
      return { error: 'mimeType, totalSize, and totalChunks required', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Allow up to 200MB for chunked uploads
    const MAX_CHUNKED_SIZE = 200 * 1024 * 1024
    if (totalSize > MAX_CHUNKED_SIZE) {
      return { error: `File too large. Max ${Math.round(MAX_CHUNKED_SIZE / 1024 / 1024)}MB`, code: ErrorCode.PAYLOAD_TOO_LARGE, status: 413 }
    }

    if (mediaKind === 'video' && duration && duration > 120) {
      return { error: 'Video too long. Max 120 seconds for chunked uploads', code: ErrorCode.VALIDATION, status: 400 }
    }

    if (totalChunks > 200) {
      return { error: 'Too many chunks. Max 200 chunks per upload', code: ErrorCode.VALIDATION, status: 400 }
    }

    const sessionId = uuidv4()
    const assetId = uuidv4()
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 30 * 60 * 1000) // 30 min expiry

    await db.collection('chunked_upload_sessions').insertOne({
      id: sessionId,
      assetId,
      userId: user.id,
      mimeType,
      fileName: fileName || null,
      kind: mediaKind,
      totalSize,
      totalChunks,
      receivedChunks: [],
      receivedBytes: 0,
      width: width || null,
      height: height || null,
      duration: duration || null,
      status: 'UPLOADING',
      expiresAt,
      createdAt: now,
      updatedAt: now,
    })

    return {
      data: {
        sessionId,
        assetId,
        totalChunks,
        maxChunkSize: 2 * 1024 * 1024, // 2MB per chunk recommended
        expiresAt: expiresAt.toISOString(),
        message: `Upload session created. Send ${totalChunks} chunks to /media/chunked/${sessionId}/chunk`,
      },
      status: 201,
    }
  }

  // ========================
  // POST /media/chunked/:sessionId/chunk — Upload a single chunk
  // ========================
  if (path[0] === 'media' && path[1] === 'chunked' && path.length === 4 && path[3] === 'chunk' && method === 'POST') {
    const user = await requireAuth(request, db)
    const sessionId = path[2]

    const session = await db.collection('chunked_upload_sessions').findOne({ id: sessionId, userId: user.id })
    if (!session) return { error: 'Upload session not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (session.status !== 'UPLOADING') return { error: `Session is ${session.status}`, code: ErrorCode.INVALID_STATE, status: 400 }
    if (new Date() > new Date(session.expiresAt)) {
      await db.collection('chunked_upload_sessions').updateOne({ id: sessionId }, { $set: { status: 'EXPIRED' } })
      return { error: 'Upload session expired. Start a new upload.', code: ErrorCode.EXPIRED, status: 410 }
    }

    const body = await request.json()
    const { chunkIndex, data } = body

    if (chunkIndex === undefined || !data) {
      return { error: 'chunkIndex and data (base64) required', code: ErrorCode.VALIDATION, status: 400 }
    }

    if (chunkIndex < 0 || chunkIndex >= session.totalChunks) {
      return { error: `chunkIndex must be 0-${session.totalChunks - 1}`, code: ErrorCode.VALIDATION, status: 400 }
    }

    if (session.receivedChunks.includes(chunkIndex)) {
      return { data: { message: `Chunk ${chunkIndex} already received`, chunkIndex, status: 'DUPLICATE' } }
    }

    const chunkBuffer = Buffer.from(data, 'base64')

    // Store chunk in DB temporarily
    await db.collection('chunked_upload_data').insertOne({
      sessionId,
      chunkIndex,
      data: chunkBuffer,
      size: chunkBuffer.length,
      createdAt: new Date(),
    })

    await db.collection('chunked_upload_sessions').updateOne(
      { id: sessionId },
      {
        $push: { receivedChunks: chunkIndex },
        $inc: { receivedBytes: chunkBuffer.length },
        $set: { updatedAt: new Date() },
      }
    )

    const receivedCount = session.receivedChunks.length + 1
    const progress = Math.round((receivedCount / session.totalChunks) * 100)

    return {
      data: {
        chunkIndex,
        received: receivedCount,
        total: session.totalChunks,
        progress,
        message: receivedCount === session.totalChunks
          ? 'All chunks received! Call /media/chunked/:sessionId/complete to finalize.'
          : `Chunk ${chunkIndex} received (${progress}%)`,
      },
    }
  }

  // ========================
  // POST /media/chunked/:sessionId/complete — Finalize chunked upload
  // ========================
  if (path[0] === 'media' && path[1] === 'chunked' && path.length === 4 && path[3] === 'complete' && method === 'POST') {
    const user = await requireAuth(request, db)
    const sessionId = path[2]

    const session = await db.collection('chunked_upload_sessions').findOne({ id: sessionId, userId: user.id })
    if (!session) return { error: 'Upload session not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (session.status !== 'UPLOADING') return { error: `Session is ${session.status}`, code: ErrorCode.INVALID_STATE, status: 400 }

    if (session.receivedChunks.length < session.totalChunks) {
      const missing = []
      for (let i = 0; i < session.totalChunks; i++) {
        if (!session.receivedChunks.includes(i)) missing.push(i)
      }
      return {
        error: `Missing ${missing.length} chunks: [${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '...' : ''}]`,
        code: ErrorCode.INCOMPLETE_UPLOAD,
        status: 400,
      }
    }

    // Mark as assembling
    await db.collection('chunked_upload_sessions').updateOne(
      { id: sessionId },
      { $set: { status: 'ASSEMBLING', updatedAt: new Date() } }
    )

    // Fetch and assemble all chunks in order
    const chunks = await db.collection('chunked_upload_data')
      .find({ sessionId })
      .sort({ chunkIndex: 1 })
      .toArray()

    const buffers = chunks.map(c => c.data.buffer ? Buffer.from(c.data.buffer) : c.data)
    const fullBuffer = Buffer.concat(buffers)

    let storageType = 'BASE64'
    let storagePath = null
    let publicUrl = null

    // Try Supabase first
    if (MEDIA_PROVIDER === 'supabase') {
      try {
        const ext = session.mimeType.split('/')[1] === 'quicktime' ? 'mov' : (session.mimeType.split('/')[1] || 'bin')
        const filePath = `posts/${user.id}/${session.assetId}.${ext}`
        const { uploadBuffer } = await import('../supabase-storage.js')
        const result = await uploadBuffer(filePath, fullBuffer, session.mimeType)
        storagePath = filePath
        publicUrl = result.publicUrl
        storageType = 'SUPABASE'
      } catch (err) {
        const { default: logger } = await import('@/lib/logger')
        logger.warn('STORAGE', 'chunked_supabase_upload_fallback', { error: err.message })
      }
    }

    // Fallback to Emergent Object Storage
    if (storageType === 'BASE64') {
      try {
        const storageAvailable = await isStorageAvailable()
        if (storageAvailable) {
          const { putObject } = await import('../storage.js')
          const ext = session.mimeType.split('/')[1] || 'bin'
          const objPath = `tribe/uploads/${user.id}/${session.assetId}.${ext}`
          const result = await putObject(objPath, fullBuffer, session.mimeType)
          storagePath = result.path || objPath
          storageType = 'OBJECT_STORAGE'
        }
      } catch (err) {
        const { default: logger } = await import('@/lib/logger')
        logger.warn('STORAGE', 'chunked_object_storage_fallback', { error: err.message })
      }
    }

    // Create the media asset
    const now = new Date()
    const asset = {
      id: session.assetId,
      ownerId: user.id,
      type: session.kind === 'video' ? 'VIDEO' : 'IMAGE',
      kind: session.kind === 'video' ? 'VIDEO' : 'IMAGE',
      mimeType: session.mimeType,
      size: fullBuffer.length,
      sizeBytes: fullBuffer.length,
      width: session.width || null,
      height: session.height || null,
      duration: session.duration || null,
      thumbnailId: null,
      status: 'READY',
      storageType,
      storagePath,
      publicUrl,
      data: storageType === 'BASE64' ? fullBuffer.toString('base64') : null,
      uploadMethod: 'CHUNKED',
      isDeleted: false,
      createdAt: now,
    }

    await db.collection('media_assets').insertOne(asset)

    // Clean up chunks
    await db.collection('chunked_upload_data').deleteMany({ sessionId })
    await db.collection('chunked_upload_sessions').updateOne(
      { id: sessionId },
      { $set: { status: 'COMPLETED', completedAt: now, updatedAt: now } }
    )

    return {
      data: {
        id: asset.id,
        url: publicUrl || `/api/media/${asset.id}`,
        publicUrl,
        type: asset.type,
        size: asset.size,
        sizeBytes: asset.sizeBytes,
        mimeType: asset.mimeType,
        storageType: asset.storageType,
        uploadMethod: 'CHUNKED',
        message: 'Upload complete!',
      },
      status: 201,
    }
  }

  // ========================
  // GET /media/chunked/:sessionId/status — Check upload progress
  // ========================
  if (path[0] === 'media' && path[1] === 'chunked' && path.length === 4 && path[3] === 'status' && method === 'GET') {
    const user = await requireAuth(request, db)
    const sessionId = path[2]

    const session = await db.collection('chunked_upload_sessions').findOne(
      { id: sessionId, userId: user.id },
      { projection: { _id: 0 } }
    )
    if (!session) return { error: 'Upload session not found', code: ErrorCode.NOT_FOUND, status: 404 }

    const missing = []
    for (let i = 0; i < session.totalChunks; i++) {
      if (!session.receivedChunks.includes(i)) missing.push(i)
    }

    return {
      data: {
        sessionId: session.id,
        assetId: session.assetId,
        status: session.status,
        totalChunks: session.totalChunks,
        receivedChunks: session.receivedChunks.length,
        receivedBytes: session.receivedBytes,
        totalSize: session.totalSize,
        progress: Math.round((session.receivedChunks.length / session.totalChunks) * 100),
        missingChunks: missing.slice(0, 20),
        expiresAt: session.expiresAt,
      },
    }
  }

  // ========================
  // PATCH /media/tus/:sessionId — TUS-compatible binary chunk upload (no base64 overhead)
  // Clients send raw binary chunks with Content-Type: application/offset+octet-stream
  // Headers: Upload-Offset (byte offset), Content-Length
  // ========================
  if (path[0] === 'media' && path[1] === 'tus' && path.length === 3 && method === 'PATCH') {
    const user = await requireAuth(request, db)
    const sessionId = path[2]

    const session = await db.collection('chunked_upload_sessions').findOne({ id: sessionId, userId: user.id })
    if (!session) return { error: 'Upload session not found', code: ErrorCode.NOT_FOUND, status: 404 }
    if (session.status !== 'UPLOADING') return { error: `Session is ${session.status}`, code: ErrorCode.INVALID_STATE, status: 400 }
    if (new Date() > new Date(session.expiresAt)) {
      await db.collection('chunked_upload_sessions').updateOne({ id: sessionId }, { $set: { status: 'EXPIRED' } })
      return { error: 'Upload session expired', code: ErrorCode.EXPIRED, status: 410 }
    }

    const uploadOffset = parseInt(request.headers.get('upload-offset') || '0')

    // Read raw binary from request body
    const arrayBuffer = await request.arrayBuffer()
    const chunkBuffer = Buffer.from(arrayBuffer)

    if (chunkBuffer.length === 0) {
      return { error: 'Empty chunk', code: ErrorCode.VALIDATION, status: 400 }
    }

    // Calculate chunk index from offset
    const chunkSize = 2 * 1024 * 1024 // 2MB chunks
    const chunkIndex = Math.floor(uploadOffset / chunkSize)

    if (session.receivedChunks.includes(chunkIndex)) {
      // TUS resume: duplicate chunk, acknowledge
      return {
        data: { chunkIndex, status: 'DUPLICATE' },
        headers: { 'Upload-Offset': String(uploadOffset + chunkBuffer.length), 'Tus-Resumable': '1.0.0' },
      }
    }

    await db.collection('chunked_upload_data').insertOne({
      sessionId,
      chunkIndex,
      data: chunkBuffer,
      size: chunkBuffer.length,
      offset: uploadOffset,
      createdAt: new Date(),
    })

    const newOffset = uploadOffset + chunkBuffer.length
    await db.collection('chunked_upload_sessions').updateOne(
      { id: sessionId },
      {
        $push: { receivedChunks: chunkIndex },
        $inc: { receivedBytes: chunkBuffer.length },
        $set: { updatedAt: new Date() },
      }
    )

    const receivedCount = session.receivedChunks.length + 1
    const progress = Math.round((newOffset / session.totalSize) * 100)

    return {
      data: {
        chunkIndex,
        uploadOffset: newOffset,
        received: receivedCount,
        total: session.totalChunks,
        progress: Math.min(progress, 100),
      },
      headers: {
        'Upload-Offset': String(newOffset),
        'Tus-Resumable': '1.0.0',
      },
    }
  }

  // ========================
  // HEAD /media/tus/:sessionId — TUS resume: get current offset
  // ========================
  if (path[0] === 'media' && path[1] === 'tus' && path.length === 3 && method === 'HEAD') {
    const user = await requireAuth(request, db)
    const sessionId = path[2]

    const session = await db.collection('chunked_upload_sessions').findOne({ id: sessionId, userId: user.id })
    if (!session) return { error: 'Upload session not found', code: ErrorCode.NOT_FOUND, status: 404 }

    return {
      data: {},
      headers: {
        'Upload-Offset': String(session.receivedBytes || 0),
        'Upload-Length': String(session.totalSize),
        'Tus-Resumable': '1.0.0',
        'Upload-Metadata': `mimeType ${Buffer.from(session.mimeType).toString('base64')}`,
      },
    }
  }

  // ========================
  // POST /media/upload — Legacy base64 upload (kept for backward compatibility)
  // ========================
  if (path.join('/') === 'media/upload' && method === 'POST') {
    const user = await requireAuth(request, db)

    if (user.ageStatus === 'CHILD') {
      return { error: 'Media upload not available for users under 18', code: ErrorCode.CHILD_RESTRICTED, status: 403 }
    }

    const body = await request.json()
    const { data, mimeType, type, width, height, duration } = body

    if (!data || !mimeType) {
      return { error: 'data (base64) and mimeType are required', code: ErrorCode.VALIDATION, status: 400 }
    }

    const mediaType = type || 'IMAGE'
    const maxSize = mediaType === 'VIDEO' ? Config.MAX_VIDEO_SIZE_BYTES : Config.MAX_MEDIA_SIZE_BYTES
    const rawSize = Buffer.from(data, 'base64').length

    if (rawSize > maxSize) {
      return {
        error: `File too large. Max ${Math.round(maxSize / 1024 / 1024)}MB for ${mediaType.toLowerCase()}s`,
        code: ErrorCode.PAYLOAD_TOO_LARGE,
        status: 413,
      }
    }

    if (mediaType === 'VIDEO' && duration && duration > Config.MAX_REEL_DURATION_SEC) {
      return {
        error: `Video too long. Max ${Config.MAX_REEL_DURATION_SEC} seconds`,
        code: ErrorCode.VALIDATION,
        status: 400,
      }
    }

    const assetId = uuidv4()
    let storageType = 'BASE64'
    let storagePath = null
    let publicUrl = null

    // Try Supabase first if configured
    if (MEDIA_PROVIDER === 'supabase') {
      try {
        const ext = mimeType.split('/')[1] === 'quicktime' ? 'mov' : (mimeType.split('/')[1] || 'bin')
        const filePath = `posts/${user.id}/${assetId}.${ext}`
        const buffer = Buffer.from(data, 'base64')

        const { uploadBuffer } = await import('../supabase-storage.js')
        const result = await uploadBuffer(filePath, buffer, mimeType)
        storagePath = filePath
        publicUrl = result.publicUrl
        storageType = 'SUPABASE'
      } catch (err) {
        const { default: logger } = await import('@/lib/logger')
        logger.warn('STORAGE', 'supabase_upload_fallback', { error: err.message })
      }
    }

    // Fallback to Emergent Object Storage
    if (storageType === 'BASE64') {
      try {
        const storageAvailable = await isStorageAvailable()
        if (storageAvailable) {
          const result = await uploadToStorage(user.id, data, mimeType, mediaType)
          storagePath = result.storagePath
          storageType = 'OBJECT_STORAGE'
        }
      } catch (err) {
        const { default: logger } = await import('@/lib/logger')
        logger.warn('STORAGE', 'upload_fallback_to_base64', { error: err.message })
      }
    }

    const asset = {
      id: assetId,
      ownerId: user.id,
      type: mediaType,
      kind: mediaType,
      mimeType,
      size: rawSize,
      sizeBytes: rawSize,
      width: width || null,
      height: height || null,
      duration: duration || null,
      thumbnailId: null,
      status: 'READY',
      storageType,
      storagePath,
      publicUrl,
      data: storageType === 'BASE64' ? data : null,
      isDeleted: false,
      createdAt: new Date(),
    }

    await db.collection('media_assets').insertOne(asset)

    return {
      data: {
        id: asset.id,
        url: publicUrl || `/api/media/${asset.id}`,
        publicUrl,
        type: asset.type,
        size: asset.size,
        mimeType: asset.mimeType,
        storageType: asset.storageType,
      },
      status: 201,
    }
  }

  // ========================
  // GET /media/:id — Serve media (redirect to Supabase CDN or stream with Range support)
  // ========================
  if (path[0] === 'media' && path.length === 2 && method === 'GET') {
    const assetId = path[1]
    if (['upload', 'upload-init', 'upload-complete', 'upload-status'].includes(assetId)) return null

    const asset = await db.collection('media_assets').findOne({ id: assetId, isDeleted: { $ne: true } })
    if (!asset) return { error: 'Media not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Supabase — redirect to best available URL (processed variant or CDN original)
    if (asset.storageType === 'SUPABASE' && asset.publicUrl) {
      // For video, prefer processed variants (720p > faststart > original)
      let redirectUrl = asset.publicUrl
      if (asset.mimeType?.startsWith('video/') || asset.kind === 'VIDEO') {
        const v = asset.variants || {}
        redirectUrl = asset.playbackUrl || v['720p']?.url || v.faststart?.url || asset.publicUrl
      }
      return {
        raw: new NextResponse(null, {
          status: 302,
          headers: {
            'Location': redirectUrl,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'Accept-Ranges': 'bytes',
            ...(asset.duration ? { 'X-Content-Duration': String(asset.duration) } : {}),
          },
        }),
      }
    }

    // Helper: serve buffer with HTTP 206 Range support for video seeking
    function serveWithRange(buffer, contentType, cacheControl) {
      const rangeHeader = request.headers.get('range')
      const totalSize = buffer.length

      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/)
        if (match) {
          const start = parseInt(match[1], 10)
          const end = match[2] ? parseInt(match[2], 10) : Math.min(start + 5 * 1024 * 1024 - 1, totalSize - 1) // 5MB chunks
          const chunkSize = end - start + 1
          const slice = buffer.subarray(start, end + 1)

          return {
            raw: new NextResponse(slice, {
              status: 206,
              headers: {
                'Content-Type': contentType,
                'Content-Length': chunkSize.toString(),
                'Content-Range': `bytes ${start}-${end}/${totalSize}`,
                'Accept-Ranges': 'bytes',
                'Cache-Control': cacheControl,
              },
            }),
          }
        }
      }

      return {
        raw: new NextResponse(buffer, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Content-Length': totalSize.toString(),
            'Accept-Ranges': 'bytes',
            'Cache-Control': cacheControl,
          },
        }),
      }
    }

    // Emergent Object Storage
    if (asset.storageType === 'OBJECT_STORAGE' && asset.storagePath) {
      try {
        const result = await downloadFromStorage(asset.storagePath)
        return serveWithRange(
          Buffer.from(result.buffer),
          result.contentType || asset.mimeType,
          'public, max-age=31536000, immutable'
        )
      } catch (err) {
        if (asset.data) {
          return serveWithRange(
            Buffer.from(asset.data, 'base64'),
            asset.mimeType,
            'public, max-age=86400'
          )
        }
        return { error: 'Media temporarily unavailable', code: ErrorCode.INTERNAL, status: 503 }
      }
    }

    // Legacy base64
    if (asset.data) {
      return serveWithRange(
        Buffer.from(asset.data, 'base64'),
        asset.mimeType,
        'public, max-age=86400'
      )
    }

    return { error: 'Media data not available', code: ErrorCode.NOT_FOUND, status: 404 }
  }

  // ========================
  // DELETE /media/:id — Delete owned media (with attachment safety)
  // ========================
  if (path[0] === 'media' && path.length === 2 && method === 'DELETE') {
    const mediaId = path[1]
    if (['upload', 'upload-init', 'upload-complete', 'upload-status'].includes(mediaId)) return null

    const user = await requireAuth(request, db)

    const asset = await db.collection('media_assets').findOne(
      { id: mediaId, isDeleted: { $ne: true } },
      { projection: { _id: 0 } }
    )

    if (!asset) {
      // Check if already deleted — return idempotent success
      const deletedAsset = await db.collection('media_assets').findOne(
        { id: mediaId, isDeleted: true },
        { projection: { _id: 0, id: 1, status: 1, deletedAt: 1 } }
      )
      if (deletedAsset) {
        return { data: { id: mediaId, status: 'ALREADY_DELETED', deletedAt: deletedAsset.deletedAt }, status: 200 }
      }
      return { error: 'Media not found', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    // Ownership check (admins can delete any media)
    if (asset.ownerId !== user.id && !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { error: 'You can only delete your own media', code: 'FORBIDDEN', status: 403 }
    }

    // Attachment safety: check if media is used in content_items, reels, or stories
    const [contentRef, reelRef, storyRef] = await Promise.all([
      db.collection('content_items').findOne(
        { 'media.id': mediaId, isDeleted: { $ne: true } },
        { projection: { _id: 0, id: 1 } }
      ),
      db.collection('reels').findOne(
        { mediaId, isDeleted: { $ne: true } },
        { projection: { _id: 0, id: 1 } }
      ),
      db.collection('stories').findOne(
        { mediaIds: mediaId, isDeleted: { $ne: true } },
        { projection: { _id: 0, id: 1 } }
      ),
    ])

    const attachments = []
    if (contentRef) attachments.push({ type: 'post', id: contentRef.id })
    if (reelRef) attachments.push({ type: 'reel', id: reelRef.id })
    if (storyRef) attachments.push({ type: 'story', id: storyRef.id })

    if (attachments.length > 0) {
      return {
        error: 'Cannot delete media that is attached to content. Remove it from the content first.',
        code: 'MEDIA_ATTACHED',
        status: 409,
        data: { attachments },
      }
    }

    // Delete from Supabase storage
    if (asset.storageType === 'SUPABASE' && asset.storagePath) {
      try {
        const { deleteFile } = await import('../supabase-storage.js')
        await deleteFile(asset.storagePath)
      } catch (err) {
        const { default: logger } = await import('@/lib/logger')
        logger.warn('MEDIA', 'storage_delete_failed', { error: err.message, mediaId })
        // Continue with soft-delete even if remote delete fails
      }
    }

    // Also delete associated thumbnail if exists
    if (asset.thumbnailMediaId) {
      try {
        const thumbAsset = await db.collection('media_assets').findOne(
          { id: asset.thumbnailMediaId },
          { projection: { _id: 0, storagePath: 1, storageType: 1 } }
        )
        if (thumbAsset?.storageType === 'SUPABASE' && thumbAsset.storagePath) {
          const { deleteFile } = await import('../supabase-storage.js')
          await deleteFile(thumbAsset.storagePath)
        }
        await db.collection('media_assets').updateOne(
          { id: asset.thumbnailMediaId },
          { $set: { isDeleted: true, deletedAt: new Date(), deletedBy: user.id } }
        )
      } catch (err) {
        // Non-critical — thumbnail cleanup is best-effort
      }
    }

    // Soft-delete the asset
    await db.collection('media_assets').updateOne(
      { id: mediaId },
      {
        $set: {
          isDeleted: true,
          status: 'DELETED',
          deletedAt: new Date(),
          deletedBy: user.id,
        },
      }
    )

    return { data: { id: mediaId, status: 'DELETED' }, status: 200 }
  }

  return null
}
