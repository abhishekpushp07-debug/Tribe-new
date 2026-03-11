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

const MEDIA_PROVIDER = process.env.MEDIA_PROVIDER || 'legacy'

export async function handleMedia(path, method, request, db) {

  // ========================
  // POST /media/upload-init — Get signed URL for direct-to-Supabase upload
  // ========================
  if (path.join('/') === 'media/upload-init' && method === 'POST') {
    const user = await requireAuth(request, db)

    if (user.ageStatus === 'CHILD') {
      return { error: 'Media upload not available for users under 18', code: ErrorCode.CHILD_RESTRICTED, status: 403 }
    }

    const body = await request.json()
    const { kind, mimeType, sizeBytes, scope } = body

    // Validate required fields
    if (!kind || !mimeType || !sizeBytes) {
      return { error: 'kind, mimeType, and sizeBytes are required', code: ErrorCode.VALIDATION, status: 400 }
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
    if (kind === 'video' && !mimeType.startsWith('video/')) {
      return { error: 'kind=video requires a video mimeType', code: ErrorCode.VALIDATION, status: 400 }
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

      // Create pending media record
      const now = new Date()
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
        createdAt: now,
        updatedAt: now,
        completedAt: null,
      }

      await db.collection('media_assets').insertOne(asset)

      return {
        data: {
          mediaId,
          uploadUrl: signedUrl,
          token,
          path: filePath,
          publicUrl,
          expiresIn: 7200, // 2 hours
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
  if (path.join('/') === 'media/upload-complete' && method === 'POST') {
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
        publicUrl: asset.publicUrl,
        type: asset.type,
        kind: asset.kind,
        mimeType: asset.mimeType,
        size: asset.sizeBytes || asset.size,
        storageType: asset.storageType,
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
  // GET /media/:id — Serve media (redirect to Supabase CDN or stream legacy)
  // ========================
  if (path[0] === 'media' && path.length === 2 && method === 'GET') {
    const assetId = path[1]
    if (['upload', 'upload-init', 'upload-complete', 'upload-status'].includes(assetId)) return null

    const asset = await db.collection('media_assets').findOne({ id: assetId, isDeleted: { $ne: true } })
    if (!asset) return { error: 'Media not found', code: ErrorCode.NOT_FOUND, status: 404 }

    // Supabase — redirect to CDN public URL
    if (asset.storageType === 'SUPABASE' && asset.publicUrl) {
      return {
        raw: new NextResponse(null, {
          status: 302,
          headers: {
            'Location': asset.publicUrl,
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        }),
      }
    }

    // Emergent Object Storage — stream binary
    if (asset.storageType === 'OBJECT_STORAGE' && asset.storagePath) {
      try {
        const result = await downloadFromStorage(asset.storagePath)
        return {
          raw: new NextResponse(result.buffer, {
            status: 200,
            headers: {
              'Content-Type': result.contentType || asset.mimeType,
              'Content-Length': result.buffer.length.toString(),
              'Cache-Control': 'public, max-age=31536000, immutable',
              'Accept-Ranges': 'bytes',
            },
          }),
        }
      } catch (err) {
        if (asset.data) {
          const buffer = Buffer.from(asset.data, 'base64')
          return {
            raw: new NextResponse(buffer, {
              status: 200,
              headers: {
                'Content-Type': asset.mimeType,
                'Content-Length': buffer.length.toString(),
                'Cache-Control': 'public, max-age=86400',
              },
            }),
          }
        }
        return { error: 'Media temporarily unavailable', code: ErrorCode.INTERNAL, status: 503 }
      }
    }

    // Legacy base64
    if (asset.data) {
      const buffer = Buffer.from(asset.data, 'base64')
      return {
        raw: new NextResponse(buffer, {
          status: 200,
          headers: {
            'Content-Type': asset.mimeType,
            'Content-Length': buffer.length.toString(),
            'Cache-Control': 'public, max-age=86400',
          },
        }),
      }
    }

    return { error: 'Media data not available', code: ErrorCode.NOT_FOUND, status: 404 }
  }

  return null
}
