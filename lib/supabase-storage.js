// Tribe — Supabase Storage Service
// Handles bucket initialization, signed URL generation, and public URL resolution
// Used for all new media uploads (reels, stories, posts, thumbnails)

import { createClient } from '@supabase/supabase-js'

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'tribe-media'

const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/webp',
  'video/mp4', 'video/quicktime',
]

const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB (Supabase Pro)

let _adminClient = null
let _bucketReady = false

function getAdminClient() {
  if (_adminClient) return _adminClient
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required')
  _adminClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return _adminClient
}

// Ensure bucket exists with correct settings (idempotent)
export async function ensureBucket() {
  if (_bucketReady) return
  const client = getAdminClient()

  const { data: buckets } = await client.storage.listBuckets()
  const exists = buckets?.some(b => b.id === BUCKET)

  if (!exists) {
    const { error } = await client.storage.createBucket(BUCKET, {
      public: true,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
      fileSizeLimit: MAX_FILE_SIZE,
    })
    if (error && !error.message?.includes('already exists')) {
      throw new Error(`Bucket creation failed: ${error.message}`)
    }
    console.log(`[SUPABASE] Created bucket: ${BUCKET}`)
  } else {
    // Update existing bucket settings (e.g., after plan upgrade)
    await client.storage.updateBucket(BUCKET, {
      public: true,
      allowedMimeTypes: ALLOWED_MIME_TYPES,
      fileSizeLimit: MAX_FILE_SIZE,
    })
  }
  _bucketReady = true
}

// Generate a signed upload URL for direct client-to-Supabase upload
// Returns { signedUrl, token, path, publicUrl }
export async function createSignedUploadUrl(filePath) {
  await ensureBucket()
  const client = getAdminClient()

  const { data, error } = await client.storage
    .from(BUCKET)
    .createSignedUploadUrl(filePath)

  if (error) throw new Error(`Signed URL creation failed: ${error.message}`)

  const publicUrl = getPublicUrl(filePath)

  return {
    signedUrl: data.signedUrl,
    token: data.token,
    path: data.path || filePath,
    publicUrl,
  }
}

// Get public CDN URL for a file
export function getPublicUrl(filePath) {
  const client = getAdminClient()
  const { data } = client.storage.from(BUCKET).getPublicUrl(filePath)
  return data.publicUrl
}

// Verify a file exists in storage (after client uploads)
export async function verifyFileExists(filePath) {
  const client = getAdminClient()

  // List objects to check the file exists  
  // Use download with head-like approach
  const { data, error } = await client.storage
    .from(BUCKET)
    .list(filePath.substring(0, filePath.lastIndexOf('/')), {
      search: filePath.substring(filePath.lastIndexOf('/') + 1),
      limit: 1,
    })

  if (error) return false
  return data && data.length > 0
}

// Delete a file from storage
export async function deleteFile(filePath) {
  const client = getAdminClient()
  const { error } = await client.storage.from(BUCKET).remove([filePath])
  if (error) throw new Error(`Delete failed: ${error.message}`)
}

// Server-side upload (for seeding or migrations)
export async function uploadBuffer(filePath, buffer, contentType) {
  await ensureBucket()
  const client = getAdminClient()

  const { data, error } = await client.storage
    .from(BUCKET)
    .upload(filePath, buffer, {
      contentType,
      upsert: true,
    })

  if (error) throw new Error(`Upload failed: ${error.message}`)

  return {
    path: data.path || filePath,
    publicUrl: getPublicUrl(filePath),
  }
}

// Validation helpers
export function validateMimeType(mimeType) {
  return ALLOWED_MIME_TYPES.includes(mimeType)
}

export function validateFileSize(sizeBytes) {
  return sizeBytes > 0 && sizeBytes <= MAX_FILE_SIZE
}

export { ALLOWED_MIME_TYPES, MAX_FILE_SIZE, BUCKET }
