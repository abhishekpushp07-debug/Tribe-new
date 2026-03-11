// Tribe — Media Cleanup Worker
// Handles orphaned PENDING_UPLOAD cleanup and thumbnail generation
// Pattern follows stories.js expiry worker (lazy init + setInterval)

import { deleteFile } from '../supabase-storage.js'
import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { uploadBuffer } from '../supabase-storage.js'

const execAsync = promisify(exec)

const CLEANUP_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes
const ORPHAN_THRESHOLD_MS = 24 * 60 * 60 * 1000 // 24 hours fallback
const CLEANUP_BATCH_SIZE = 100

let workerStarted = false

export function startMediaCleanupWorker(db) {
  if (workerStarted) return
  workerStarted = true

  async function runCleanup() {
    try {
      const now = new Date()
      const fallbackCutoff = new Date(now.getTime() - ORPHAN_THRESHOLD_MS)

      // Find stale PENDING_UPLOAD records:
      // 1. expiresAt has passed (explicit expiration), OR
      // 2. No expiresAt set AND createdAt older than 24h (legacy fallback)
      const staleUploads = await db.collection('media_assets')
        .find({
          status: 'PENDING_UPLOAD',
          isDeleted: { $ne: true },
          $or: [
            { expiresAt: { $lt: now } },
            { expiresAt: { $exists: false }, createdAt: { $lt: fallbackCutoff } },
            { expiresAt: null, createdAt: { $lt: fallbackCutoff } },
          ],
        })
        .limit(CLEANUP_BATCH_SIZE)
        .toArray()

      if (staleUploads.length === 0) return

      let cleanedCount = 0
      let remoteDeletedCount = 0
      let failedCount = 0

      for (const asset of staleUploads) {
        try {
          // Try to delete remote file if it exists in Supabase
          if (asset.storageType === 'SUPABASE' && asset.storagePath) {
            try {
              await deleteFile(asset.storagePath)
              remoteDeletedCount++
            } catch {
              // File may not exist — that's fine for orphan cleanup
            }
          }

          // Mark as deleted in DB
          await db.collection('media_assets').updateOne(
            { id: asset.id, status: 'PENDING_UPLOAD' },
            {
              $set: {
                status: 'ORPHAN_CLEANED',
                isDeleted: true,
                cleanedAt: new Date(),
              },
            }
          )
          cleanedCount++
        } catch {
          failedCount++
        }
      }

      if (cleanedCount > 0) {
        const { default: logger } = await import('@/lib/logger')
        logger.info('MEDIA_CLEANUP', 'orphan_cleanup_complete', {
          found: staleUploads.length,
          cleaned: cleanedCount,
          remoteDeleted: remoteDeletedCount,
          failed: failedCount,
        })
      }
    } catch (err) {
      try {
        const { default: logger } = await import('@/lib/logger')
        logger.error('MEDIA_CLEANUP', 'orphan_cleanup_error', { error: err.message })
      } catch { /* ignore logging errors */ }
    }
  }

  // Run immediately, then every 30 minutes
  runCleanup()
  setInterval(runCleanup, CLEANUP_INTERVAL_MS)
}

// Generate thumbnail from video using ffmpeg
// Returns { thumbnailMediaId, thumbnailUrl } or null
// Manages explicit thumbnailStatus lifecycle: NONE → PENDING → READY/FAILED
export async function generateVideoThumbnail(db, videoAsset) {
  if (!videoAsset || !videoAsset.storagePath) return null
  if (videoAsset.storageType !== 'SUPABASE' || !videoAsset.publicUrl) return null

  // Skip thumbnail for tiny files (likely test stubs, not real video)
  if (videoAsset.sizeBytes && videoAsset.sizeBytes < 10000) return null

  // Transition: thumbnailStatus → PENDING
  await db.collection('media_assets').updateOne(
    { id: videoAsset.id },
    { $set: { thumbnailStatus: 'PENDING', updatedAt: new Date() } }
  )

  const tmpInput = join(tmpdir(), `tribe-thumb-in-${uuidv4()}.mp4`)
  const tmpOutput = join(tmpdir(), `tribe-thumb-out-${uuidv4()}.jpg`)

  try {
    // Download video from Supabase public URL
    const response = await fetch(videoAsset.publicUrl)
    if (!response.ok) {
      await db.collection('media_assets').updateOne(
        { id: videoAsset.id },
        { $set: { thumbnailStatus: 'FAILED', thumbnailError: `Download failed: HTTP ${response.status}`, updatedAt: new Date() } }
      )
      return null
    }

    const videoBuffer = Buffer.from(await response.arrayBuffer())
    if (videoBuffer.length < 10000) {
      await db.collection('media_assets').updateOne(
        { id: videoAsset.id },
        { $set: { thumbnailStatus: 'FAILED', thumbnailError: 'Video too small for thumbnail', updatedAt: new Date() } }
      )
      return null
    }

    await writeFile(tmpInput, videoBuffer)

    // Extract first frame as JPEG thumbnail
    await execAsync(
      `ffmpeg -i "${tmpInput}" -ss 00:00:00.500 -vframes 1 -q:v 2 -vf "scale=720:-2" "${tmpOutput}" -y 2>/dev/null`,
      { timeout: 15000 }
    )

    let thumbBuffer
    try {
      thumbBuffer = await readFile(tmpOutput)
    } catch {
      await db.collection('media_assets').updateOne(
        { id: videoAsset.id },
        { $set: { thumbnailStatus: 'FAILED', thumbnailError: 'ffmpeg produced no output', updatedAt: new Date() } }
      )
      return null
    }
    if (thumbBuffer.length < 100) {
      await db.collection('media_assets').updateOne(
        { id: videoAsset.id },
        { $set: { thumbnailStatus: 'FAILED', thumbnailError: 'Thumbnail too small', updatedAt: new Date() } }
      )
      return null
    }

    // Upload thumbnail to Supabase
    const thumbId = uuidv4()
    const thumbPath = `thumbnails/${videoAsset.ownerId}/${thumbId}.jpg`
    const { publicUrl } = await uploadBuffer(thumbPath, thumbBuffer, 'image/jpeg')

    // Create thumbnail media record
    const now = new Date()
    await db.collection('media_assets').insertOne({
      id: thumbId,
      ownerId: videoAsset.ownerId,
      kind: 'IMAGE',
      type: 'IMAGE',
      mimeType: 'image/jpeg',
      sizeBytes: thumbBuffer.length,
      size: thumbBuffer.length,
      scope: 'thumbnails',
      width: 720,
      height: null,
      duration: null,
      status: 'READY',
      storageType: 'SUPABASE',
      storagePath: thumbPath,
      publicUrl,
      parentMediaId: videoAsset.id,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    })

    // Transition: thumbnailStatus → READY
    await db.collection('media_assets').updateOne(
      { id: videoAsset.id },
      { $set: {
        thumbnailStatus: 'READY',
        thumbnailUrl: publicUrl,
        thumbnailMediaId: thumbId,
        thumbnailError: null,
        updatedAt: now,
      } }
    )

    return { thumbnailMediaId: thumbId, thumbnailUrl: publicUrl }
  } catch (err) {
    // Transition: thumbnailStatus → FAILED
    await db.collection('media_assets').updateOne(
      { id: videoAsset.id },
      { $set: { thumbnailStatus: 'FAILED', thumbnailError: err.message || 'Unknown error', updatedAt: new Date() } }
    ).catch(() => {})
    return null
  } finally {
    // Cleanup temp files
    try { await unlink(tmpInput) } catch { /* ignore */ }
    try { await unlink(tmpOutput) } catch { /* ignore */ }
  }
}

// Manual cleanup endpoint for admin
export async function handleMediaCleanup(path, method, request, db) {
  // POST /admin/media/cleanup — Manually trigger orphan cleanup
  if (path[0] === 'admin' && path[1] === 'media' && path[2] === 'cleanup' && method === 'POST') {
    const { requireAuth } = await import('../auth-utils.js')
    const user = await requireAuth(request, db)
    if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { error: 'Admin access required', status: 403 }
    }

    const body = await request.json().catch(() => ({}))
    const dryRun = body.dryRun !== false
    const now = new Date()

    // WORKSTREAM C: Use expiresAt-first cleanup, consistent with background worker
    const staleUploads = await db.collection('media_assets')
      .find({
        status: 'PENDING_UPLOAD',
        isDeleted: { $ne: true },
        $or: [
          { expiresAt: { $lt: now } },
          { expiresAt: { $exists: false }, createdAt: { $lt: new Date(now.getTime() - ORPHAN_THRESHOLD_MS) } },
          { expiresAt: null, createdAt: { $lt: new Date(now.getTime() - ORPHAN_THRESHOLD_MS) } },
        ],
      })
      .project({ _id: 0, id: 1, storagePath: 1, storageType: 1, createdAt: 1, expiresAt: 1, ownerId: 1 })
      .limit(500)
      .toArray()

    if (dryRun) {
      return {
        data: {
          mode: 'DRY_RUN',
          staleCount: staleUploads.length,
          oldestStale: staleUploads.length > 0 ? staleUploads[0].createdAt : null,
          items: staleUploads.slice(0, 20),
        },
      }
    }

    let cleaned = 0
    let remoteDeleted = 0

    for (const asset of staleUploads) {
      try {
        if (asset.storageType === 'SUPABASE' && asset.storagePath) {
          try {
            await deleteFile(asset.storagePath)
            remoteDeleted++
          } catch { /* ignore */ }
        }
        await db.collection('media_assets').updateOne(
          { id: asset.id, status: 'PENDING_UPLOAD' },
          { $set: { status: 'ORPHAN_CLEANED', isDeleted: true, cleanedAt: new Date() } }
        )
        cleaned++
      } catch { /* ignore individual failures */ }
    }

    return {
      data: {
        mode: 'EXECUTE',
        found: staleUploads.length,
        cleaned,
        remoteDeleted,
      },
    }
  }

  // ========================
  // GET /admin/media/metrics — WORKSTREAM D: Media lifecycle metrics
  // ========================
  if (path[0] === 'admin' && path[1] === 'media' && path[2] === 'metrics' && method === 'GET') {
    const { requireAuth } = await import('../auth-utils.js')
    const user = await requireAuth(request, db)
    if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { error: 'Admin access required', status: 403 }
    }

    const { getMediaLifecycleMetrics } = await import('../services/media-service.js')
    const metrics = await getMediaLifecycleMetrics(db)
    return { data: metrics }
  }

  // ========================
  // POST /admin/media/batch-seed — WORKSTREAM A: Batch seed media records
  // ========================
  if (path[0] === 'admin' && path[1] === 'media' && path[2] === 'batch-seed' && method === 'POST') {
    const { requireAuth } = await import('../auth-utils.js')
    const user = await requireAuth(request, db)
    if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { error: 'Admin access required', status: 403 }
    }

    const body = await request.json()
    const { assets, dryRun } = body

    if (!assets || !Array.isArray(assets) || assets.length === 0) {
      return { error: 'assets array is required', status: 400 }
    }
    if (assets.length > 1000) {
      return { error: 'Max 1000 assets per batch', status: 400 }
    }

    const { batchCreateMediaRecords } = await import('../services/media-service.js')
    const result = await batchCreateMediaRecords(db, assets, { skipExisting: true, dryRun: dryRun === true })
    return { data: result, status: 201 }
  }

  // ========================
  // POST /admin/media/backfill-legacy — WORKSTREAM A: Backfill legacy records
  // ========================
  if (path[0] === 'admin' && path[1] === 'media' && path[2] === 'backfill-legacy' && method === 'POST') {
    const { requireAuth } = await import('../auth-utils.js')
    const user = await requireAuth(request, db)
    if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { error: 'Admin access required', status: 403 }
    }

    const body = await request.json().catch(() => ({}))
    const { backfillLegacyMediaFields } = await import('../services/media-service.js')
    const result = await backfillLegacyMediaFields(db, { batchSize: body.batchSize || 500, dryRun: body.dryRun === true })
    return { data: result }
  }

  return null
}
