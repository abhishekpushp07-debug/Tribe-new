/**
 * Media Service — Business Logic Layer
 *
 * WORKSTREAM A: Batch seed/backfill strategy
 * WORKSTREAM B: Thumbnail lifecycle truth (supplements media-cleanup.js)
 * WORKSTREAM C: Cleanup race safety (supplements media-cleanup.js)
 * WORKSTREAM D: Pending upload pollution control
 * WORKSTREAM E: Media deletion lifecycle (supplements media.js)
 *
 * Extracted as service to provide reusable, testable media lifecycle operations.
 */

import { v4 as uuidv4 } from 'uuid'

// ========== MEDIA LIFECYCLE STATUSES ==========
export const MediaStatus = {
  PENDING_UPLOAD: 'PENDING_UPLOAD',
  READY: 'READY',
  EXPIRED: 'EXPIRED',
  DELETED: 'DELETED',
  ORPHAN_CLEANED: 'ORPHAN_CLEANED',
  FAILED: 'FAILED',
}

export const ThumbnailStatus = {
  NONE: 'NONE',
  PENDING: 'PENDING',
  READY: 'READY',
  FAILED: 'FAILED',
}

export const UPLOAD_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours

// ========== WORKSTREAM A: BATCH SEED / BACKFILL ==========

/**
 * Batch-create media asset records (for seeding or migration).
 * Idempotent: skips records where `id` already exists.
 * Does NOT upload to storage — assumes objects already exist or will be uploaded separately.
 *
 * @param {Db} db - MongoDB database
 * @param {Array} assets - Array of { id, ownerId, kind, mimeType, sizeBytes, scope, storagePath, publicUrl, ... }
 * @param {Object} opts - { skipExisting: true, dryRun: false }
 * @returns {{ created, skipped, failed, errors }}
 */
export async function batchCreateMediaRecords(db, assets, opts = {}) {
  const { skipExisting = true, dryRun = false } = opts
  const now = new Date()
  let created = 0, skipped = 0, failed = 0
  const errors = []

  // Pre-check existing IDs in one query
  const inputIds = assets.map(a => a.id).filter(Boolean)
  const existingIds = new Set()
  if (inputIds.length > 0) {
    const existing = await db.collection('media_assets')
      .find({ id: { $in: inputIds } })
      .project({ id: 1, _id: 0 })
      .toArray()
    for (const e of existing) existingIds.add(e.id)
  }

  // Build batch of new records
  const toInsert = []
  for (const asset of assets) {
    const id = asset.id || uuidv4()
    if (existingIds.has(id)) {
      if (skipExisting) { skipped++; continue }
    }

    toInsert.push({
      id,
      ownerId: asset.ownerId,
      kind: (asset.kind || 'IMAGE').toUpperCase(),
      type: (asset.kind || 'IMAGE').toUpperCase(),
      mimeType: asset.mimeType || 'image/jpeg',
      sizeBytes: asset.sizeBytes || 0,
      size: asset.sizeBytes || 0,
      scope: asset.scope || 'posts',
      width: asset.width || null,
      height: asset.height || null,
      duration: asset.duration || null,
      status: asset.status || MediaStatus.READY,
      storageType: asset.storageType || 'SUPABASE',
      storagePath: asset.storagePath || null,
      publicUrl: asset.publicUrl || null,
      isDeleted: false,
      thumbnailStatus: asset.thumbnailStatus || ThumbnailStatus.NONE,
      thumbnailUrl: asset.thumbnailUrl || null,
      thumbnailMediaId: asset.thumbnailMediaId || null,
      thumbnailError: null,
      expiresAt: null, // READY assets don't expire
      createdAt: asset.createdAt ? new Date(asset.createdAt) : now,
      updatedAt: now,
      completedAt: now,
      batchImport: true,
      batchImportedAt: now,
    })
  }

  if (dryRun) {
    return { created: toInsert.length, skipped, failed: 0, errors: [], dryRun: true }
  }

  // Bulk insert in chunks of 500
  const CHUNK_SIZE = 500
  for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
    const chunk = toInsert.slice(i, i + CHUNK_SIZE)
    try {
      const result = await db.collection('media_assets').insertMany(chunk, { ordered: false })
      created += result.insertedCount
    } catch (err) {
      // Handle duplicate key errors gracefully (race condition with parallel inserts)
      if (err.code === 11000) {
        const insertedCount = err.result?.insertedCount || 0
        created += insertedCount
        skipped += chunk.length - insertedCount
      } else {
        failed += chunk.length
        errors.push({ chunk: i, error: err.message })
      }
    }
  }

  return { created, skipped, failed, errors, total: assets.length }
}

/**
 * Backfill legacy media records with missing lifecycle fields.
 * Adds thumbnailStatus, expiresAt, etc. to old records.
 */
export async function backfillLegacyMediaFields(db, opts = {}) {
  const { batchSize = 500, dryRun = false } = opts
  const now = new Date()

  // Find records missing thumbnailStatus
  const legacyRecords = await db.collection('media_assets')
    .find({
      thumbnailStatus: { $exists: false },
      isDeleted: { $ne: true },
    })
    .limit(batchSize)
    .toArray()

  if (dryRun) {
    return { found: legacyRecords.length, dryRun: true }
  }

  let updated = 0
  for (const record of legacyRecords) {
    const updates = { updatedAt: now }

    // Set thumbnailStatus based on existing fields
    if (record.thumbnailUrl) {
      updates.thumbnailStatus = ThumbnailStatus.READY
    } else if (record.kind === 'VIDEO' && record.status === 'READY') {
      updates.thumbnailStatus = ThumbnailStatus.NONE // Video without thumbnail — may need generation
    } else {
      updates.thumbnailStatus = ThumbnailStatus.NONE
    }

    // Ensure expiresAt is set for pending uploads
    if (record.status === 'PENDING_UPLOAD' && !record.expiresAt) {
      updates.expiresAt = new Date(new Date(record.createdAt).getTime() + UPLOAD_TTL_MS)
    }

    await db.collection('media_assets').updateOne({ id: record.id }, { $set: updates })
    updated++
  }

  return { found: legacyRecords.length, updated }
}

// ========== WORKSTREAM D: METRICS & POLLUTION CONTROL ==========

/**
 * Get media lifecycle metrics for admin dashboard.
 */
export async function getMediaLifecycleMetrics(db) {
  const [
    totalAssets,
    pendingUploads,
    readyAssets,
    expiredAssets,
    deletedAssets,
    orphanCleaned,
    failedAssets,
    thumbNone,
    thumbPending,
    thumbReady,
    thumbFailed,
    recentPending24h,
    recentCompleted24h,
    recentCleaned24h,
    supabaseAssets,
    legacyAssets,
    base64Assets,
  ] = await Promise.all([
    db.collection('media_assets').countDocuments({}),
    db.collection('media_assets').countDocuments({ status: 'PENDING_UPLOAD', isDeleted: { $ne: true } }),
    db.collection('media_assets').countDocuments({ status: 'READY', isDeleted: { $ne: true } }),
    db.collection('media_assets').countDocuments({ status: 'EXPIRED' }),
    db.collection('media_assets').countDocuments({ status: 'DELETED' }),
    db.collection('media_assets').countDocuments({ status: 'ORPHAN_CLEANED' }),
    db.collection('media_assets').countDocuments({ status: 'FAILED' }),
    db.collection('media_assets').countDocuments({ thumbnailStatus: 'NONE', isDeleted: { $ne: true } }),
    db.collection('media_assets').countDocuments({ thumbnailStatus: 'PENDING', isDeleted: { $ne: true } }),
    db.collection('media_assets').countDocuments({ thumbnailStatus: 'READY', isDeleted: { $ne: true } }),
    db.collection('media_assets').countDocuments({ thumbnailStatus: 'FAILED', isDeleted: { $ne: true } }),
    db.collection('media_assets').countDocuments({ status: 'PENDING_UPLOAD', createdAt: { $gte: new Date(Date.now() - 86400000) } }),
    db.collection('media_assets').countDocuments({ status: 'READY', completedAt: { $gte: new Date(Date.now() - 86400000) } }),
    db.collection('media_assets').countDocuments({ status: 'ORPHAN_CLEANED', cleanedAt: { $gte: new Date(Date.now() - 86400000) } }),
    db.collection('media_assets').countDocuments({ storageType: 'SUPABASE', isDeleted: { $ne: true } }),
    db.collection('media_assets').countDocuments({ storageType: 'OBJECT_STORAGE', isDeleted: { $ne: true } }),
    db.collection('media_assets').countDocuments({ storageType: 'BASE64', isDeleted: { $ne: true } }),
  ])

  // Find oldest stale pending upload
  const oldestStale = await db.collection('media_assets')
    .find({ status: 'PENDING_UPLOAD', isDeleted: { $ne: true } })
    .sort({ createdAt: 1 })
    .limit(1)
    .project({ createdAt: 1, _id: 0 })
    .toArray()

  // Legacy records without lifecycle fields
  const legacyWithoutThumbStatus = await db.collection('media_assets').countDocuments({
    thumbnailStatus: { $exists: false },
    isDeleted: { $ne: true },
  })

  return {
    lifecycle: {
      total: totalAssets,
      pendingUpload: pendingUploads,
      ready: readyAssets,
      expired: expiredAssets,
      deleted: deletedAssets,
      orphanCleaned,
      failed: failedAssets,
    },
    thumbnail: {
      none: thumbNone,
      pending: thumbPending,
      ready: thumbReady,
      failed: thumbFailed,
    },
    last24h: {
      initiated: recentPending24h,
      completed: recentCompleted24h,
      cleaned: recentCleaned24h,
    },
    storage: {
      supabase: supabaseAssets,
      objectStorage: legacyAssets,
      base64: base64Assets,
    },
    health: {
      oldestStalePending: oldestStale[0]?.createdAt || null,
      legacyRecordsWithoutLifecycleFields: legacyWithoutThumbStatus,
      pollutionRisk: pendingUploads > 100 ? 'HIGH' : pendingUploads > 20 ? 'MEDIUM' : 'LOW',
    },
    generatedAt: new Date().toISOString(),
  }
}

// ========== WORKSTREAM E: SAFE DELETION HELPERS ==========

/**
 * Check if a media asset is attached to any live content.
 * Returns array of attachment references.
 */
export async function getMediaAttachments(db, mediaId) {
  const [contentRef, reelRef, storyRef] = await Promise.all([
    db.collection('content_items').findOne(
      { 'media.id': mediaId, isDeleted: { $ne: true } },
      { projection: { _id: 0, id: 1, kind: 1 } }
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
  if (contentRef) attachments.push({ type: 'post', id: contentRef.id, kind: contentRef.kind })
  if (reelRef) attachments.push({ type: 'reel', id: reelRef.id })
  if (storyRef) attachments.push({ type: 'story', id: storyRef.id })
  return attachments
}

/**
 * Sanitize a media asset for API response.
 * Ensures thumbnailStatus is always present, never ambiguous null.
 */
export function sanitizeMediaAsset(asset) {
  if (!asset) return null
  const { _id, data, ...clean } = asset
  return {
    ...clean,
    thumbnailStatus: clean.thumbnailStatus || ThumbnailStatus.NONE,
    thumbnailUrl: clean.thumbnailUrl || null,
    status: clean.isDeleted ? MediaStatus.DELETED : (clean.status || MediaStatus.READY),
  }
}
