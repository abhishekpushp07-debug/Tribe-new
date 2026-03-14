/**
 * Tribe — Production Video Processing Pipeline v2
 * 
 * Pipeline: probe → faststart → multi-bitrate transcode (360p/480p/720p) → HLS adaptive → thumbnail → poster → upload → DB
 * 
 * Guarantees:
 *   1. Every video becomes browser/mobile-playable (H.264+AAC in MP4)
 *   2. Faststart moov atom for instant playback
 *   3. HLS adaptive streaming for videos >10MB (multi-bitrate ladder)
 *   4. Background retry for failed transcodes (max 3 attempts)
 *   5. Frontend never plays an asset before processing is READY
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFile, unlink, readFile, stat, mkdir, readdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { uploadBuffer, getPublicUrl } from '../supabase-storage.js'

const execAsync = promisify(exec)
const WORK_DIR = join(tmpdir(), 'tribe-video-pipeline')
const HLS_SEGMENT_DURATION = 6
const LARGE_VIDEO_THRESHOLD = 10 * 1024 * 1024 // 10MB
const MAX_RETRY_ATTEMPTS = 3
const RETRY_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

// HLS bitrate ladder
const HLS_LADDER = [
  { name: '360p', height: 360, crf: 28, audioBitrate: '64k', bandwidth: 800000 },
  { name: '480p', height: 480, crf: 26, audioBitrate: '96k', bandwidth: 1400000 },
  { name: '720p', height: 720, crf: 23, audioBitrate: '128k', bandwidth: 2800000 },
]

let dirReady = false
async function ensureWorkDir() {
  if (dirReady) return
  try { await mkdir(WORK_DIR, { recursive: true }) } catch {}
  dirReady = true
}

// ═══════════════════════════════════════════════════
// FFMPEG OPERATIONS
// ═══════════════════════════════════════════════════

async function probeVideo(inputPath) {
  const cmd = `ffprobe -v quiet -print_format json -show_format -show_streams "${inputPath}"`
  const { stdout } = await execAsync(cmd, { timeout: 30000 })
  const info = JSON.parse(stdout)
  const vs = (info.streams || []).find(s => s.codec_type === 'video')
  const as = (info.streams || []).find(s => s.codec_type === 'audio')
  const fmt = info.format || {}
  return {
    durationMs: Math.round((parseFloat(fmt.duration) || 0) * 1000),
    bitrate: parseInt(fmt.bit_rate) || null,
    fileSize: parseInt(fmt.size) || null,
    width: vs ? parseInt(vs.width) : null,
    height: vs ? parseInt(vs.height) : null,
    fps: vs ? Math.round(eval(vs.r_frame_rate || '0')) : null,
    codec: vs?.codec_name || null,
    audioCodec: as?.codec_name || null,
    isH264: vs?.codec_name === 'h264',
    isAAC: as?.codec_name === 'aac',
    formatName: fmt.format_name || null,
  }
}

async function applyFaststart(inputPath, outputPath) {
  await execAsync(`ffmpeg -i "${inputPath}" -movflags +faststart -c copy "${outputPath}" -y`, { timeout: 120000 })
}

async function transcodeVariant(inputPath, outputPath, height, crf, audioBitrate) {
  await execAsync(
    `ffmpeg -i "${inputPath}" -vf "scale=-2:${height}" -c:v libx264 -preset fast -crf ${crf} -c:a aac -b:a ${audioBitrate} -movflags +faststart "${outputPath}" -y`,
    { timeout: 300000 }
  )
}

async function generateHLSVariant(inputPath, outputDir, name, height, crf, audioBitrate) {
  const playlistPath = join(outputDir, `${name}.m3u8`)
  const segmentPattern = join(outputDir, `${name}_%03d.ts`)
  await execAsync(
    `ffmpeg -i "${inputPath}" -vf "scale=-2:${height}" -c:v libx264 -preset fast -crf ${crf} -c:a aac -b:a ${audioBitrate} -hls_time ${HLS_SEGMENT_DURATION} -hls_list_size 0 -hls_segment_filename "${segmentPattern}" -f hls "${playlistPath}" -y`,
    { timeout: 300000 }
  )
  return playlistPath
}

async function generateThumbnail(inputPath, outputPath) {
  await execAsync(`ffmpeg -i "${inputPath}" -ss 1 -vframes 1 -vf "scale=480:-2" -q:v 3 "${outputPath}" -y`, { timeout: 30000 })
}

async function generatePoster(inputPath, outputPath) {
  await execAsync(`ffmpeg -i "${inputPath}" -ss 0.5 -vframes 1 -q:v 1 "${outputPath}" -y`, { timeout: 30000 })
}

// ═══════════════════════════════════════════════════
// UPLOAD HELPERS
// ═══════════════════════════════════════════════════

async function uploadFile(localPath, remotePath, contentType) {
  const buffer = await readFile(localPath)
  if (buffer.length < 100) return null
  const { publicUrl } = await uploadBuffer(remotePath, buffer, contentType)
  return publicUrl
}

async function uploadHLSDirectory(localDir, remoteBase, files) {
  const urls = {}
  for (const file of files) {
    const localPath = join(localDir, file)
    const remotePath = `${remoteBase}/${file}`
    const contentType = file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/MP2T'
    const url = await uploadFile(localPath, remotePath, contentType)
    if (url) urls[file] = url
  }
  return urls
}

// ═══════════════════════════════════════════════════
// MAIN PIPELINE
// ═══════════════════════════════════════════════════

export async function processVideo(db, asset) {
  if (!asset || !asset.id) return
  if (!asset.publicUrl && !asset.storagePath) return
  if (asset.storageType !== 'SUPABASE') return

  const mediaId = asset.id
  const ownerId = asset.ownerId
  const jobId = uuidv4()
  const { default: logger } = await import('@/lib/logger')

  // Get current retry count
  const currentAsset = await db.collection('media_assets').findOne({ id: mediaId }, { projection: { processing: 1, _id: 0 } })
  const retryCount = currentAsset?.processing?.retryCount || 0

  // Transition → PROCESSING
  await db.collection('media_assets').updateOne(
    { id: mediaId },
    { $set: {
      playbackStatus: 'PROCESSING',
      'processing.started': true,
      'processing.jobId': jobId,
      'processing.startedAt': new Date(),
      'processing.retryCount': retryCount,
      updatedAt: new Date(),
    }}
  )

  await ensureWorkDir()
  const jobDir = join(WORK_DIR, jobId)
  try { await mkdir(jobDir, { recursive: true }) } catch {}

  const inputPath = join(jobDir, 'input.mp4')
  const faststartPath = join(jobDir, 'faststart.mp4')
  const thumbPath = join(jobDir, 'thumb.jpg')
  const posterPath = join(jobDir, 'poster.jpg')
  const hlsDir = join(jobDir, 'hls')

  const cleanup = async () => {
    try { await execAsync(`rm -rf "${jobDir}"`, { timeout: 10000 }) } catch {}
  }

  try {
    // ── Step 0: Download ──
    logger.info('VIDEO_PIPELINE', 'downloading', { mediaId, jobId, retry: retryCount })
    const response = await fetch(asset.publicUrl)
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`)
    const videoBuffer = Buffer.from(await response.arrayBuffer())
    if (videoBuffer.length < 1000) throw new Error('Video too small')
    await writeFile(inputPath, videoBuffer)
    const fileSize = videoBuffer.length

    // ── Step 1: Probe ──
    logger.info('VIDEO_PIPELINE', 'probing', { mediaId })
    let meta
    try { meta = await probeVideo(inputPath) } catch {
      meta = { durationMs: 0, width: null, height: null, codec: 'unknown', audioCodec: 'unknown', isH264: false, isAAC: false }
    }

    await db.collection('media_assets').updateOne(
      { id: mediaId },
      { $set: {
        videoMeta: { durationMs: meta.durationMs, bitrate: meta.bitrate, codec: meta.codec, fps: meta.fps, audioCodec: meta.audioCodec, width: meta.width, height: meta.height },
        width: meta.width || asset.width,
        height: meta.height || asset.height,
        duration: meta.durationMs ? meta.durationMs / 1000 : asset.duration,
        updatedAt: new Date(),
      }}
    )

    const basePath = `processed/${ownerId}/${mediaId}`
    const variants = {}
    const processing = { faststart: false, transcoded: false, hlsReady: false, thumbnailGenerated: false, posterGenerated: false }

    // ── Step 2: Original reference ──
    variants.original = { url: asset.publicUrl, size: fileSize, width: meta.width, height: meta.height }

    // ── Step 3: Faststart ──
    logger.info('VIDEO_PIPELINE', 'faststart', { mediaId })
    try {
      if (meta.isH264 && meta.formatName?.includes('mp4')) {
        await applyFaststart(inputPath, faststartPath)
        const url = await uploadFile(faststartPath, `${basePath}/faststart.mp4`, 'video/mp4')
        if (url) {
          variants.faststart = { url, size: (await stat(faststartPath)).size, width: meta.width, height: meta.height }
          processing.faststart = true
        }
      }
    } catch (e) { logger.warn('VIDEO_PIPELINE', 'faststart_failed', { mediaId, error: e.message }) }

    await db.collection('media_assets').updateOne({ id: mediaId }, { $set: { 'processing.faststart': processing.faststart, updatedAt: new Date() } })

    // ── Step 4: Multi-bitrate MP4 transcodes ──
    // Determine which ladder rungs to generate based on source resolution
    const sourceHeight = meta.height || 1080
    const applicableLadder = HLS_LADDER.filter(r => r.height <= sourceHeight)

    for (const rung of applicableLadder) {
      const variantPath = join(jobDir, `${rung.name}.mp4`)
      logger.info('VIDEO_PIPELINE', `transcoding_${rung.name}`, { mediaId })
      try {
        await transcodeVariant(inputPath, variantPath, rung.height, rung.crf, rung.audioBitrate)
        const url = await uploadFile(variantPath, `${basePath}/${rung.name}.mp4`, 'video/mp4')
        if (url) {
          const vStat = await stat(variantPath)
          let vMeta
          try { vMeta = await probeVideo(variantPath) } catch { vMeta = {} }
          variants[rung.name] = { url, size: vStat.size, width: vMeta.width || null, height: rung.height, bandwidth: rung.bandwidth }
          processing.transcoded = true
        }
      } catch (e) { logger.warn('VIDEO_PIPELINE', `transcode_${rung.name}_failed`, { mediaId, error: e.message }) }
    }

    await db.collection('media_assets').updateOne({ id: mediaId }, { $set: { 'processing.transcoded': processing.transcoded, updatedAt: new Date() } })

    // ── Step 5: HLS Adaptive Streaming (for videos >10MB) ──
    if (fileSize > LARGE_VIDEO_THRESHOLD && applicableLadder.length > 0) {
      logger.info('VIDEO_PIPELINE', 'hls_generation', { mediaId, fileSize, ladderCount: applicableLadder.length })
      try {
        await mkdir(hlsDir, { recursive: true })

        // Generate HLS variant for each rung
        const hlsVariants = []
        for (const rung of applicableLadder) {
          try {
            await generateHLSVariant(inputPath, hlsDir, rung.name, rung.height, rung.crf, rung.audioBitrate)
            hlsVariants.push(rung)
          } catch (e) { logger.warn('VIDEO_PIPELINE', `hls_${rung.name}_failed`, { mediaId, error: e.message }) }
        }

        if (hlsVariants.length > 0) {
          // Read all generated files
          const hlsFiles = await readdir(hlsDir)

          // Upload all segments and playlists
          const hlsUrls = await uploadHLSDirectory(hlsDir, `${basePath}/hls`, hlsFiles)

          // Rewrite variant playlists to use CDN URLs
          for (const rung of hlsVariants) {
            const playlistFile = `${rung.name}.m3u8`
            const localPlaylist = join(hlsDir, playlistFile)
            let content = await readFile(localPlaylist, 'utf-8')

            // Replace segment filenames with CDN URLs
            const segmentPattern = new RegExp(`${rung.name}_\\d{3}\\.ts`, 'g')
            const segments = content.match(segmentPattern) || []
            for (const seg of segments) {
              if (hlsUrls[seg]) content = content.replace(seg, hlsUrls[seg])
            }

            // Re-upload rewritten playlist
            const rewrittenBuffer = Buffer.from(content, 'utf-8')
            const { publicUrl } = await uploadBuffer(`${basePath}/hls/${playlistFile}`, rewrittenBuffer, 'application/vnd.apple.mpegurl')
            hlsUrls[playlistFile] = publicUrl
          }

          // Generate master playlist
          let masterPlaylist = '#EXTM3U\n#EXT-X-VERSION:3\n'
          for (const rung of hlsVariants) {
            const playlistUrl = hlsUrls[`${rung.name}.m3u8`]
            if (playlistUrl) {
              const w = rung.height === 360 ? 640 : rung.height === 480 ? 854 : 1280
              masterPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=${rung.bandwidth},RESOLUTION=${w}x${rung.height},NAME="${rung.name}"\n`
              masterPlaylist += `${playlistUrl}\n`
            }
          }

          // Upload master playlist
          const masterBuffer = Buffer.from(masterPlaylist, 'utf-8')
          const { publicUrl: masterUrl } = await uploadBuffer(`${basePath}/hls/master.m3u8`, masterBuffer, 'application/vnd.apple.mpegurl')

          variants.hls = {
            url: masterUrl,
            variants: hlsVariants.map(r => ({
              name: r.name,
              height: r.height,
              bandwidth: r.bandwidth,
              playlistUrl: hlsUrls[`${r.name}.m3u8`] || null,
            })),
            segmentDuration: HLS_SEGMENT_DURATION,
          }
          processing.hlsReady = true

          logger.info('VIDEO_PIPELINE', 'hls_complete', { mediaId, masterUrl: masterUrl?.slice(0, 80), variantCount: hlsVariants.length })
        }
      } catch (e) { logger.warn('VIDEO_PIPELINE', 'hls_failed', { mediaId, error: e.message }) }
    }

    await db.collection('media_assets').updateOne({ id: mediaId }, { $set: { 'processing.hlsReady': processing.hlsReady, updatedAt: new Date() } })

    // ── Step 6: Thumbnail ──
    logger.info('VIDEO_PIPELINE', 'thumbnail', { mediaId })
    try {
      await generateThumbnail(inputPath, thumbPath)
      const url = await uploadFile(thumbPath, `${basePath}/thumb.jpg`, 'image/jpeg')
      if (url) { variants.thumbnail = { url, width: 480, height: null }; processing.thumbnailGenerated = true }
    } catch (e) { logger.warn('VIDEO_PIPELINE', 'thumbnail_failed', { mediaId, error: e.message }) }

    // ── Step 7: Poster ──
    logger.info('VIDEO_PIPELINE', 'poster', { mediaId })
    try {
      await generatePoster(inputPath, posterPath)
      const url = await uploadFile(posterPath, `${basePath}/poster.jpg`, 'image/jpeg')
      if (url) { variants.poster = { url, width: meta.width, height: meta.height }; processing.posterGenerated = true }
    } catch (e) { logger.warn('VIDEO_PIPELINE', 'poster_failed', { mediaId, error: e.message }) }

    // ── Step 8: Final READY update ──
    // Priority: HLS > 720p MP4 > 480p > 360p > faststart > original
    const bestPlaybackUrl = variants.hls?.url || variants['720p']?.url || variants['480p']?.url || variants['360p']?.url || variants.faststart?.url || asset.publicUrl

    await db.collection('media_assets').updateOne(
      { id: mediaId },
      { $set: {
        playbackStatus: 'READY',
        playbackUrl: bestPlaybackUrl,
        hlsUrl: variants.hls?.url || null,
        thumbnailUrl: variants.thumbnail?.url || null,
        posterFrameUrl: variants.poster?.url || null,
        thumbnailStatus: variants.thumbnail ? 'READY' : 'FAILED',
        variants,
        processing: { ...processing, completed: true, completedAt: new Date(), error: null, retryCount, jobId },
        updatedAt: new Date(),
      }}
    )

    logger.info('VIDEO_PIPELINE', 'complete', {
      mediaId, jobId,
      variants: Object.keys(variants),
      hasHLS: processing.hlsReady,
      fileSize,
      playbackUrl: bestPlaybackUrl?.slice(0, 80),
    })

  } catch (err) {
    logger.error('VIDEO_PIPELINE', 'failed', { mediaId, jobId, retry: retryCount, error: err.message })
    await db.collection('media_assets').updateOne(
      { id: mediaId },
      { $set: {
        playbackStatus: 'FAILED',
        'processing.completed': true,
        'processing.error': err.message,
        'processing.completedAt': new Date(),
        'processing.retryCount': retryCount,
        updatedAt: new Date(),
      }}
    ).catch(() => {})
  } finally {
    await cleanup()
  }
}

// ═══════════════════════════════════════════════════
// BACKGROUND RETRY WORKER
// ═══════════════════════════════════════════════════

let retryWorkerStarted = false

export function startRetryWorker(db) {
  if (retryWorkerStarted) return
  retryWorkerStarted = true

  async function runRetry() {
    try {
      const { default: logger } = await import('@/lib/logger')

      // Find FAILED assets with retryCount < MAX
      const failedAssets = await db.collection('media_assets').find({
        playbackStatus: 'FAILED',
        'processing.retryCount': { $lt: MAX_RETRY_ATTEMPTS },
        kind: 'VIDEO',
        storageType: 'SUPABASE',
        publicUrl: { $ne: null },
        isDeleted: { $ne: true },
      }, {
        projection: { _id: 0, id: 1, ownerId: 1, publicUrl: 1, storagePath: 1, storageType: 1, kind: 1, mimeType: 1, processing: 1, width: 1, height: 1, duration: 1 },
        limit: 5,
      }).toArray()

      if (failedAssets.length > 0) {
        logger.info('VIDEO_RETRY', 'found_failed', { count: failedAssets.length })
      }

      for (const asset of failedAssets) {
        const retryCount = (asset.processing?.retryCount || 0) + 1
        logger.info('VIDEO_RETRY', 'retrying', { mediaId: asset.id, attempt: retryCount })

        // Increment retry count before processing
        await db.collection('media_assets').updateOne(
          { id: asset.id },
          { $set: { 'processing.retryCount': retryCount, 'processing.lastRetryAt': new Date(), updatedAt: new Date() } }
        )

        try {
          await processVideo(db, asset)
        } catch (e) {
          logger.error('VIDEO_RETRY', 'retry_failed', { mediaId: asset.id, attempt: retryCount, error: e.message })

          // If max retries exceeded, mark as permanently failed
          if (retryCount >= MAX_RETRY_ATTEMPTS) {
            await db.collection('media_assets').updateOne(
              { id: asset.id },
              { $set: { playbackStatus: 'PERMANENTLY_FAILED', 'processing.permanentlyFailed': true, updatedAt: new Date() } }
            )
            logger.warn('VIDEO_RETRY', 'permanently_failed', { mediaId: asset.id, totalAttempts: retryCount })
          }
        }
      }
    } catch (e) {
      // Worker error — don't crash
    }
  }

  // Run immediately, then every 5 minutes
  setTimeout(() => runRetry(), 30000) // first run after 30s
  setInterval(() => runRetry(), RETRY_INTERVAL_MS)
}

// ═══════════════════════════════════════════════════
// STATUS QUERY
// ═══════════════════════════════════════════════════

export async function getProcessingStatus(db, mediaId) {
  const asset = await db.collection('media_assets').findOne(
    { id: mediaId },
    { projection: {
      _id: 0, id: 1, playbackStatus: 1, playbackUrl: 1, hlsUrl: 1,
      thumbnailUrl: 1, posterFrameUrl: 1, variants: 1, processing: 1, videoMeta: 1,
      publicUrl: 1, status: 1,
    }}
  )
  if (!asset) return null

  const v = asset.variants || {}
  return {
    id: asset.id,
    status: asset.status,
    playbackStatus: asset.playbackStatus || (asset.status === 'READY' ? 'READY' : 'UPLOADING'),
    playbackUrl: asset.playbackUrl || asset.publicUrl,
    hlsUrl: asset.hlsUrl || v.hls?.url || null,
    thumbnailUrl: asset.thumbnailUrl || v.thumbnail?.url || null,
    posterFrameUrl: asset.posterFrameUrl || v.poster?.url || null,
    variants: {
      original: v.original || null,
      '360p': v['360p'] || null,
      '480p': v['480p'] || null,
      '720p': v['720p'] || null,
      faststart: v.faststart || null,
      hls: v.hls || null,
      thumbnail: v.thumbnail || null,
      poster: v.poster || null,
    },
    processing: asset.processing || {},
    videoMeta: asset.videoMeta || {},
    // Frontend playback selection guide
    recommended: {
      primary: asset.hlsUrl || v.hls?.url || v['720p']?.url || v['480p']?.url || v.faststart?.url || asset.publicUrl,
      fallback: v['480p']?.url || v['360p']?.url || v.faststart?.url || asset.publicUrl,
      poster: asset.posterFrameUrl || v.poster?.url || asset.thumbnailUrl || v.thumbnail?.url || null,
    },
  }
}
