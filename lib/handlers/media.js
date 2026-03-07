import { v4 as uuidv4 } from 'uuid'
import { NextResponse } from 'next/server'
import { requireAuth } from '../auth-utils.js'
import { Config, ErrorCode } from '../constants.js'
import { uploadToStorage, downloadFromStorage, isStorageAvailable } from '../storage.js'

export async function handleMedia(path, method, request, db) {
  // ========================
  // POST /media/upload
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

    // Try object storage first
    try {
      const storageAvailable = await isStorageAvailable()
      if (storageAvailable) {
        const result = await uploadToStorage(user.id, data, mimeType, mediaType)
        storagePath = result.storagePath
        storageType = 'OBJECT_STORAGE'
      }
    } catch (err) {
      console.warn('Object storage upload failed, falling back to base64:', err.message)
    }

    const asset = {
      id: assetId,
      ownerId: user.id,
      type: mediaType,
      mimeType,
      size: rawSize,
      width: width || null,
      height: height || null,
      duration: duration || null,
      thumbnailId: null,
      status: 'READY',
      storageType,
      storagePath,
      // Only store base64 if object storage failed
      data: storageType === 'BASE64' ? data : null,
      isDeleted: false,
      createdAt: new Date(),
    }

    await db.collection('media_assets').insertOne(asset)

    return {
      data: {
        id: asset.id,
        url: `/api/media/${asset.id}`,
        type: asset.type,
        size: asset.size,
        mimeType: asset.mimeType,
        storageType: asset.storageType,
      },
      status: 201,
    }
  }

  // ========================
  // GET /media/:id — Serve media binary
  // ========================
  if (path[0] === 'media' && path.length === 2 && method === 'GET') {
    const assetId = path[1]
    if (assetId === 'upload') return null

    const asset = await db.collection('media_assets').findOne({ id: assetId, isDeleted: { $ne: true } })
    if (!asset) return { error: 'Media not found', code: ErrorCode.NOT_FOUND, status: 404 }

    let buffer
    let contentType = asset.mimeType

    if (asset.storageType === 'OBJECT_STORAGE' && asset.storagePath) {
      // Serve from object storage
      try {
        const result = await downloadFromStorage(asset.storagePath)
        buffer = result.buffer
        contentType = result.contentType || asset.mimeType
      } catch (err) {
        // Fallback to base64 if stored
        if (asset.data) {
          buffer = Buffer.from(asset.data, 'base64')
        } else {
          return { error: 'Media temporarily unavailable', code: ErrorCode.INTERNAL, status: 503 }
        }
      }
    } else if (asset.data) {
      // Legacy base64 storage
      buffer = Buffer.from(asset.data, 'base64')
    } else {
      return { error: 'Media data not available', code: ErrorCode.NOT_FOUND, status: 404 }
    }

    return {
      raw: new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': buffer.length.toString(),
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Accept-Ranges': 'bytes',
        },
      }),
    }
  }

  return null
}
