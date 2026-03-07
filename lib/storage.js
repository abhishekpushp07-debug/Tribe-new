// Tribe — Object Storage Service
// Uses Emergent Object Storage for production media (images, videos)
// Replaces base64-in-MongoDB with proper file storage

const STORAGE_URL = 'https://integrations.emergentagent.com/objstore/api/v1/storage'
const APP_NAME = 'tribe'

let storageKey = null

async function initStorage() {
  if (storageKey) return storageKey
  const emergentKey = process.env.EMERGENT_LLM_KEY
  if (!emergentKey) throw new Error('EMERGENT_LLM_KEY not configured')

  const res = await fetch(`${STORAGE_URL}/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emergent_key: emergentKey }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Storage init failed: ${res.status} ${text}`)
  }
  const data = await res.json()
  storageKey = data.storage_key
  return storageKey
}

export async function putObject(path, buffer, contentType) {
  const key = await initStorage()
  const res = await fetch(`${STORAGE_URL}/objects/${path}`, {
    method: 'PUT',
    headers: {
      'X-Storage-Key': key,
      'Content-Type': contentType,
    },
    body: buffer,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Storage put failed: ${res.status} ${text}`)
  }
  return res.json()
}

export async function getObject(path) {
  const key = await initStorage()
  const res = await fetch(`${STORAGE_URL}/objects/${path}`, {
    method: 'GET',
    headers: { 'X-Storage-Key': key },
  })
  if (!res.ok) {
    throw new Error(`Storage get failed: ${res.status}`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  const contentType = res.headers.get('content-type') || 'application/octet-stream'
  return { buffer, contentType }
}

// Upload media to object storage
export async function uploadToStorage(userId, base64Data, mimeType, mediaType) {
  const ext = mimeType.split('/')[1] || 'bin'
  const { v4: uuidv4 } = await import('uuid')
  const fileId = uuidv4()
  const path = `${APP_NAME}/uploads/${userId}/${fileId}.${ext}`

  const buffer = Buffer.from(base64Data, 'base64')
  const result = await putObject(path, buffer, mimeType)

  return {
    storagePath: result.path || path,
    size: result.size || buffer.length,
    etag: result.etag || null,
  }
}

// Download media from object storage
export async function downloadFromStorage(storagePath) {
  return getObject(storagePath)
}

// Check if object storage is available
export async function isStorageAvailable() {
  try {
    await initStorage()
    return true
  } catch {
    return false
  }
}
