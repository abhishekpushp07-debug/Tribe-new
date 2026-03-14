/**
 * Tribe — Production Video Processing Pipeline
 * 
 * Triggered async after upload-complete for every video.
 * Pipeline: probe → faststart → 720p transcode → thumbnail → poster → upload variants → update DB
 * 
 * Guarantees:
 *   1. Every video becomes browser/mobile-playable (H.264+AAC in MP4)
 *   2. Faststart moov atom for instant playback without full download
 *   3. Frontend never plays an asset before processing is READY
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink, readFile, stat, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { uploadBuffer, getPublicUrl } from '../supabase-storage.js'

const execAsync = promisify(exec)
const WORK_DIR = join(tmpdir(), 'tribe-video-pipeline')

// Ensure work directory exists
let dirReady = false
async function ensureWorkDir() {
  if (dirReady) return
  try { await mkdir(WORK_DIR, { recursive: true }) } catch {}
  dirReady = true
}

/**
 * Probe video metadata using ffprobe
 */
async function probeVideo(inputPath) {
  const cmd = `ffprobe -v quiet -print_format json -show_format -show_streams "${inputPath}"`
  const { stdout } = await execAsync(cmd, { timeout: 30000 })
  const info = JSON.parse(stdout)

  const videoStream = (info.streams || []).find(s => s.codec_type === 'video')
  const audioStream = (info.streams || []).find(s => s.codec_type === 'audio')
  const format = info.format || {}

  return {
    durationMs: Math.round((parseFloat(format.duration) || 0) * 1000),
    bitrate: parseInt(format.bit_rate) || null,
    fileSize: parseInt(format.size) || null,
    width: videoStream ? parseInt(videoStream.width) : null,
    height: videoStream ? parseInt(videoStream.height) : null,
    fps: videoStream ? eval(videoStream.r_frame_rate || '0') : null,
    codec: videoStream?.codec_name || null,
    audioCodec: audioStream?.codec_name || null,
    isH264: videoStream?.codec_name === 'h264',
    isAAC: audioStream?.codec_name === 'aac',
    formatName: format.format_name || null,
  }
}

/**
 * Apply faststart to MP4 (moves moov atom to front)
 */
async function applyFaststart(inputPath, outputPath) {
  await execAsync(
    `ffmpeg -i "${inputPath}" -movflags +faststart -c copy "${outputPath}" -y`,
    { timeout: 120000 }
  )
}

/**
 * Transcode to 720p H.264+AAC MP4 with faststart
 */
async function transcodeTo720p(inputPath, outputPath) {
  await execAsync(
    `ffmpeg -i "${inputPath}" -vf "scale=-2:720" -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -movflags +faststart "${outputPath}" -y`,
    { timeout: 300000 } // 5 min timeout
  )
}

/**
 * Generate thumbnail at 1 second
 */
async function generateThumbnail(inputPath, outputPath) {
  await execAsync(
    `ffmpeg -i "${inputPath}" -ss 1 -vframes 1 -vf "scale=480:-2" -q:v 3 "${outputPath}" -y`,
    { timeout: 30000 }
  )
}

/**
 * Generate high-quality poster frame at 0.5 second
 */
async function generatePoster(inputPath, outputPath) {
  await execAsync(
    `ffmpeg -i "${inputPath}" -ss 0.5 -vframes 1 -q:v 1 "${outputPath}" -y`,
    { timeout: 30000 }
  )
}

/**
 * Upload a processed file to Supabase and return public URL
 */
async function uploadProcessedFile(localPath, remotePath, contentType) {
  const buffer = await readFile(localPath)
  if (buffer.length < 100) return null
  const { publicUrl } = await uploadBuffer(remotePath, buffer, contentType)
  return publicUrl
}

/**
 * Main video processing pipeline
 * Called async (fire-and-forget) from upload-complete
 */
export async function processVideo(db, asset) {
  if (!asset || !asset.id) return
  if (!asset.publicUrl && !asset.storagePath) return
  if (asset.storageType !== 'SUPABASE') return

  const mediaId = asset.id
  const ownerId = asset.ownerId
  const jobId = uuidv4()

  // Import logger lazily
  const { default: logger } = await import('@/lib/logger')

  // Transition: playbackStatus → PROCESSING
  await db.collection('media_assets').updateOne(
    { id: mediaId },
    { $set: {
      playbackStatus: 'PROCESSING',
      'processing.started': true,
      'processing.jobId': jobId,
      'processing.startedAt': new Date(),
      updatedAt: new Date(),
    }}
  )

  await ensureWorkDir()
  const inputPath = join(WORK_DIR, `${jobId}-input.mp4`)
  const faststartPath = join(WORK_DIR, `${jobId}-faststart.mp4`)
  const transcodePath = join(WORK_DIR, `${jobId}-720p.mp4`)
  const thumbPath = join(WORK_DIR, `${jobId}-thumb.jpg`)
  const posterPath = join(WORK_DIR, `${jobId}-poster.jpg`)

  const cleanup = async () => {
    for (const f of [inputPath, faststartPath, transcodePath, thumbPath, posterPath]) {
      try { await unlink(f) } catch {}
    }
  }

  try {
    // Step 0: Download source video from CDN
    logger.info('VIDEO_PIPELINE', 'downloading', { mediaId, url: asset.publicUrl?.slice(0, 80) })
    const response = await fetch(asset.publicUrl)
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`)
    const videoBuffer = Buffer.from(await response.arrayBuffer())
    if (videoBuffer.length < 1000) throw new Error('Video too small')
    await writeFile(inputPath, videoBuffer)

    // Step 1: Probe video metadata
    logger.info('VIDEO_PIPELINE', 'probing', { mediaId })
    let meta
    try {
      meta = await probeVideo(inputPath)
    } catch {
      meta = { durationMs: 0, width: null, height: null, codec: 'unknown', audioCodec: 'unknown', isH264: false, isAAC: false }
    }

    // Store videoMeta immediately
    await db.collection('media_assets').updateOne(
      { id: mediaId },
      { $set: {
        videoMeta: {
          durationMs: meta.durationMs,
          bitrate: meta.bitrate,
          codec: meta.codec,
          fps: meta.fps ? Math.round(meta.fps) : null,
          audioCodec: meta.audioCodec,
          width: meta.width,
          height: meta.height,
        },
        width: meta.width || asset.width,
        height: meta.height || asset.height,
        duration: meta.durationMs ? meta.durationMs / 1000 : asset.duration,
        updatedAt: new Date(),
      }}
    )

    const basePath = `processed/${ownerId}/${mediaId}`
    const variants = {}

    // Step 2: Original variant reference
    variants.original = {
      url: asset.publicUrl,
      size: videoBuffer.length,
      width: meta.width,
      height: meta.height,
    }

    // Step 3: Faststart MP4
    logger.info('VIDEO_PIPELINE', 'faststart', { mediaId })
    let faststartUrl = asset.publicUrl // fallback to original
    try {
      if (meta.isH264 && meta.formatName?.includes('mp4')) {
        // Already H.264 MP4 — just apply faststart
        await applyFaststart(inputPath, faststartPath)
        faststartUrl = await uploadProcessedFile(faststartPath, `${basePath}/faststart.mp4`, 'video/mp4')
        if (faststartUrl) {
          variants.faststart = { url: faststartUrl, size: (await stat(faststartPath)).size, width: meta.width, height: meta.height }
        }
      }
    } catch (err) {
      logger.warn('VIDEO_PIPELINE', 'faststart_failed', { mediaId, error: err.message })
    }

    await db.collection('media_assets').updateOne(
      { id: mediaId },
      { $set: { 'processing.faststart': !!variants.faststart, updatedAt: new Date() } }
    )

    // Step 4: 720p transcode
    logger.info('VIDEO_PIPELINE', 'transcoding_720p', { mediaId })
    try {
      await transcodeTo720p(inputPath, transcodePath)
      const transcodeUrl = await uploadProcessedFile(transcodePath, `${basePath}/720p.mp4`, 'video/mp4')
      if (transcodeUrl) {
        const tStat = await stat(transcodePath)
        let tMeta
        try { tMeta = await probeVideo(transcodePath) } catch { tMeta = {} }
        variants['720p'] = {
          url: transcodeUrl,
          size: tStat.size,
          width: tMeta.width || null,
          height: 720,
        }
      }
    } catch (err) {
      logger.warn('VIDEO_PIPELINE', 'transcode_720p_failed', { mediaId, error: err.message })
    }

    await db.collection('media_assets').updateOne(
      { id: mediaId },
      { $set: { 'processing.transcoded': !!variants['720p'], updatedAt: new Date() } }
    )

    // Step 5: Thumbnail
    logger.info('VIDEO_PIPELINE', 'thumbnail', { mediaId })
    try {
      await generateThumbnail(inputPath, thumbPath)
      const thumbUrl = await uploadProcessedFile(thumbPath, `${basePath}/thumb.jpg`, 'image/jpeg')
      if (thumbUrl) {
        variants.thumbnail = { url: thumbUrl, width: 480, height: null }
      }
    } catch (err) {
      logger.warn('VIDEO_PIPELINE', 'thumbnail_failed', { mediaId, error: err.message })
    }

    await db.collection('media_assets').updateOne(
      { id: mediaId },
      { $set: { 'processing.thumbnailGenerated': !!variants.thumbnail, updatedAt: new Date() } }
    )

    // Step 6: Poster frame
    logger.info('VIDEO_PIPELINE', 'poster', { mediaId })
    try {
      await generatePoster(inputPath, posterPath)
      const posterUrl = await uploadProcessedFile(posterPath, `${basePath}/poster.jpg`, 'image/jpeg')
      if (posterUrl) {
        variants.poster = { url: posterUrl, width: meta.width, height: meta.height }
      }
    } catch (err) {
      logger.warn('VIDEO_PIPELINE', 'poster_failed', { mediaId, error: err.message })
    }

    await db.collection('media_assets').updateOne(
      { id: mediaId },
      { $set: { 'processing.posterGenerated': !!variants.poster, updatedAt: new Date() } }
    )

    // Step 7: Final update — mark READY with all variants
    const bestPlaybackUrl = variants['720p']?.url || variants.faststart?.url || asset.publicUrl
    const thumbnailUrl = variants.thumbnail?.url || null
    const posterFrameUrl = variants.poster?.url || null

    await db.collection('media_assets').updateOne(
      { id: mediaId },
      { $set: {
        playbackStatus: 'READY',
        playbackUrl: bestPlaybackUrl,
        thumbnailUrl,
        posterFrameUrl,
        thumbnailStatus: thumbnailUrl ? 'READY' : 'FAILED',
        thumbnailMediaId: null,
        variants,
        'processing.completed': true,
        'processing.completedAt': new Date(),
        'processing.error': null,
        updatedAt: new Date(),
      }}
    )

    logger.info('VIDEO_PIPELINE', 'complete', {
      mediaId,
      hasTranscode: !!variants['720p'],
      hasFaststart: !!variants.faststart,
      hasThumbnail: !!variants.thumbnail,
      hasPoster: !!variants.poster,
      playbackUrl: bestPlaybackUrl?.slice(0, 80),
    })

  } catch (err) {
    logger.error('VIDEO_PIPELINE', 'failed', { mediaId, error: err.message, stack: err.stack?.split('\n').slice(0, 3).join(' | ') })

    await db.collection('media_assets').updateOne(
      { id: mediaId },
      { $set: {
        playbackStatus: 'FAILED',
        'processing.completed': true,
        'processing.error': err.message,
        'processing.completedAt': new Date(),
        updatedAt: new Date(),
      }}
    ).catch(() => {})
  } finally {
    await cleanup()
  }
}

/**
 * GET /media/:id/processing — Check video processing status
 */
export async function getProcessingStatus(db, mediaId) {
  const asset = await db.collection('media_assets').findOne(
    { id: mediaId },
    { projection: {
      _id: 0, id: 1, playbackStatus: 1, playbackUrl: 1, thumbnailUrl: 1,
      posterFrameUrl: 1, variants: 1, processing: 1, videoMeta: 1,
      publicUrl: 1, status: 1,
    }}
  )
  if (!asset) return null
  return {
    id: asset.id,
    status: asset.status,
    playbackStatus: asset.playbackStatus || (asset.status === 'READY' ? 'READY' : 'UPLOADING'),
    playbackUrl: asset.playbackUrl || asset.publicUrl,
    thumbnailUrl: asset.thumbnailUrl,
    posterFrameUrl: asset.posterFrameUrl,
    variants: asset.variants || {},
    processing: asset.processing || {},
    videoMeta: asset.videoMeta || {},
  }
}
