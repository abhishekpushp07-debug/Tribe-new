// Tribe API Client v2.0
const API_BASE = '/api'

class TribeAPI {
  constructor() {
    this.token = null
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('tribe_token')
    }
  }

  setToken(token) {
    this.token = token
    if (typeof window !== 'undefined') {
      if (token) localStorage.setItem('tribe_token', token)
      else localStorage.removeItem('tribe_token')
    }
  }

  getToken() {
    if (!this.token && typeof window !== 'undefined') {
      this.token = localStorage.getItem('tribe_token')
    }
    return this.token
  }

  async fetch(path, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...options.headers }
    const token = this.getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Request failed')
    return data
  }

  // ===== Auth =====
  async register(phone, pin, displayName) {
    const data = await this.fetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ phone, pin, displayName }),
    })
    this.setToken(data.token)
    return data
  }

  async login(phone, pin) {
    const data = await this.fetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, pin }),
    })
    this.setToken(data.token)
    return data
  }

  async logout() {
    try { await this.fetch('/auth/logout', { method: 'POST' }) } catch {}
    this.setToken(null)
  }

  async me() { return this.fetch('/auth/me') }

  // ===== Profile & Onboarding =====
  async updateProfile(data) {
    return this.fetch('/me/profile', { method: 'PATCH', body: JSON.stringify(data) })
  }
  async setAge(birthYear) {
    return this.fetch('/me/age', { method: 'PATCH', body: JSON.stringify({ birthYear }) })
  }
  async setCollege(collegeId) {
    return this.fetch('/me/college', { method: 'PATCH', body: JSON.stringify({ collegeId }) })
  }
  async completeOnboarding() {
    return this.fetch('/me/onboarding', { method: 'PATCH', body: JSON.stringify({}) })
  }

  // ===== Users =====
  async getUser(userId) { return this.fetch(`/users/${userId}`) }
  async getUserPosts(userId, cursor, kind) {
    const params = new URLSearchParams()
    if (cursor) params.set('cursor', cursor)
    if (kind) params.set('kind', kind)
    const qs = params.toString()
    return this.fetch(`/users/${userId}/posts${qs ? '?' + qs : ''}`)
  }
  async getUserFollowers(userId, offset) {
    const params = offset ? `?offset=${offset}` : ''
    return this.fetch(`/users/${userId}/followers${params}`)
  }
  async getUserFollowing(userId, offset) {
    const params = offset ? `?offset=${offset}` : ''
    return this.fetch(`/users/${userId}/following${params}`)
  }
  async getUserSaved(userId, cursor) {
    const params = cursor ? `?cursor=${cursor}` : ''
    return this.fetch(`/users/${userId}/saved${params}`)
  }

  // ===== Colleges =====
  async searchColleges(q, state, type, limit = 20, offset = 0) {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (state) params.set('state', state)
    if (type) params.set('type', type)
    params.set('limit', limit)
    params.set('offset', offset)
    return this.fetch(`/colleges/search?${params}`)
  }
  async getCollege(id) { return this.fetch(`/colleges/${id}`) }
  async getCollegeMembers(id, offset) {
    const params = offset ? `?offset=${offset}` : ''
    return this.fetch(`/colleges/${id}/members${params}`)
  }
  async getCollegeStates() { return this.fetch('/colleges/states') }
  async getCollegeTypes() { return this.fetch('/colleges/types') }

  // ===== Houses =====
  async getHouses() { return this.fetch('/houses') }
  async getHouse(idOrSlug) { return this.fetch(`/houses/${idOrSlug}`) }
  async getHouseLeaderboard() { return this.fetch('/houses/leaderboard') }
  async getHouseMembers(idOrSlug, offset) {
    const params = offset ? `?offset=${offset}` : ''
    return this.fetch(`/houses/${idOrSlug}/members${params}`)
  }

  // ===== Content =====
  async createPost(data) {
    return this.fetch('/content/posts', { method: 'POST', body: JSON.stringify(data) })
  }
  async createReel(data) {
    return this.fetch('/content/posts', { method: 'POST', body: JSON.stringify({ ...data, kind: 'REEL' }) })
  }
  async createStory(data) {
    return this.fetch('/content/posts', { method: 'POST', body: JSON.stringify({ ...data, kind: 'STORY' }) })
  }
  async getPost(id) { return this.fetch(`/content/${id}`) }
  async deletePost(id) { return this.fetch(`/content/${id}`, { method: 'DELETE' }) }

  // ===== Feeds =====
  async getPublicFeed(cursor) {
    const params = cursor ? `?cursor=${cursor}` : ''
    return this.fetch(`/feed/public${params}`)
  }
  async getFollowingFeed(cursor) {
    const params = cursor ? `?cursor=${cursor}` : ''
    return this.fetch(`/feed/following${params}`)
  }
  async getCollegeFeed(collegeId, cursor) {
    const params = cursor ? `?cursor=${cursor}` : ''
    return this.fetch(`/feed/college/${collegeId}${params}`)
  }
  async getHouseFeed(houseId, cursor) {
    const params = cursor ? `?cursor=${cursor}` : ''
    return this.fetch(`/feed/house/${houseId}${params}`)
  }
  async getStoryRail() { return this.fetch('/feed/stories') }
  async getReelsFeed(cursor) {
    const params = cursor ? `?cursor=${cursor}` : ''
    return this.fetch(`/feed/reels${params}`)
  }

  // ===== Social =====
  async follow(userId) { return this.fetch(`/follow/${userId}`, { method: 'POST' }) }
  async unfollow(userId) { return this.fetch(`/follow/${userId}`, { method: 'DELETE' }) }
  async like(contentId) { return this.fetch(`/content/${contentId}/like`, { method: 'POST' }) }
  async dislike(contentId) { return this.fetch(`/content/${contentId}/dislike`, { method: 'POST' }) }
  async removeReaction(contentId) { return this.fetch(`/content/${contentId}/reaction`, { method: 'DELETE' }) }
  async save(contentId) { return this.fetch(`/content/${contentId}/save`, { method: 'POST' }) }
  async unsave(contentId) { return this.fetch(`/content/${contentId}/save`, { method: 'DELETE' }) }
  async getComments(contentId, cursor) {
    const params = cursor ? `?cursor=${cursor}` : ''
    return this.fetch(`/content/${contentId}/comments${params}`)
  }
  async addComment(contentId, body, parentId) {
    return this.fetch(`/content/${contentId}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body, parentId }),
    })
  }

  // ===== Reports & Appeals =====
  async report(targetType, targetId, reasonCode, details) {
    return this.fetch('/reports', {
      method: 'POST',
      body: JSON.stringify({ targetType, targetId, reasonCode, details }),
    })
  }
  async createAppeal(targetType, targetId, reason) {
    return this.fetch('/appeals', {
      method: 'POST',
      body: JSON.stringify({ targetType, targetId, reason }),
    })
  }
  async getAppeals() { return this.fetch('/appeals') }

  // ===== Grievances =====
  async createGrievance(ticketType, subject, description) {
    return this.fetch('/grievances', {
      method: 'POST',
      body: JSON.stringify({ ticketType, subject, description }),
    })
  }
  async getGrievances() { return this.fetch('/grievances') }

  // ===== Notifications =====
  async getNotifications(cursor) {
    const params = cursor ? `?cursor=${cursor}` : ''
    return this.fetch(`/notifications${params}`)
  }
  async markNotificationsRead(ids) {
    return this.fetch('/notifications/read', {
      method: 'PATCH',
      body: JSON.stringify({ ids }),
    })
  }

  // ===== Media =====

  /**
   * World's Best Upload: Direct-to-Supabase CDN via presigned URL.
   * Flow: Get signed URL → Upload binary directly to CDN → Confirm
   * Zero base64, zero server bottleneck, zero MongoDB temp storage.
   *
   * @param {File} file - File to upload
   * @param {Function} onProgress - (pct: 0-100, phase: string, stats: {speed, eta, bytes})
   * @param {Object} options - {scope, width, height, duration}
   * @returns {Promise<{id, url, publicUrl, type, mimeType}>}
   */
  async uploadFile(file, onProgress = () => {}, options = {}) {
    const isVideo = file.type.startsWith('video/')
    const kind = isVideo ? 'video' : 'image'
    const scope = options.scope || (isVideo ? 'posts' : 'posts')

    // Phase 1: Get presigned upload URL from our server
    onProgress(0, 'Preparing upload...', {})
    const initData = await this.fetch('/media/upload-init', {
      method: 'POST',
      body: JSON.stringify({
        kind,
        mimeType: file.type,
        sizeBytes: file.size,
        scope,
      }),
    })

    const { mediaId, uploadUrl } = initData

    // Phase 2: Upload binary directly to Supabase CDN with XHR progress
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      const startTime = Date.now()
      let lastLoaded = 0
      let lastTime = startTime

      xhr.upload.addEventListener('progress', (e) => {
        if (!e.lengthComputable) return
        const pct = Math.round((e.loaded / e.total) * 90) + 5 // 5-95% range
        const now = Date.now()
        const elapsed = (now - lastTime) / 1000
        const bytesPerSec = elapsed > 0 ? (e.loaded - lastLoaded) / elapsed : 0
        const remaining = e.total - e.loaded
        const eta = bytesPerSec > 0 ? Math.ceil(remaining / bytesPerSec) : 0

        lastLoaded = e.loaded
        lastTime = now

        const speedMB = (bytesPerSec / (1024 * 1024)).toFixed(1)
        const loadedMB = (e.loaded / (1024 * 1024)).toFixed(1)
        const totalMB = (e.total / (1024 * 1024)).toFixed(1)

        const etaStr = eta > 60 ? `${Math.floor(eta / 60)}m ${eta % 60}s` : `${eta}s`
        const phase = `Uploading ${loadedMB}/${totalMB} MB • ${speedMB} MB/s • ${etaStr} left`

        onProgress(pct, phase, {
          speed: bytesPerSec,
          speedMB: parseFloat(speedMB),
          eta,
          bytes: e.loaded,
          total: e.total,
        })
      })

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve()
        else reject(new Error(`Upload failed: HTTP ${xhr.status}`))
      })
      xhr.addEventListener('error', () => reject(new Error('Upload failed: network error')))
      xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')))

      xhr.open('PUT', uploadUrl)
      xhr.setRequestHeader('Content-Type', file.type)
      xhr.send(file) // Raw binary — zero encoding overhead
    })

    // Phase 3: Confirm upload with our server
    onProgress(96, 'Finalizing...', {})
    const result = await this.fetch('/media/upload-complete', {
      method: 'POST',
      body: JSON.stringify({
        mediaId,
        width: options.width || null,
        height: options.height || null,
        duration: options.duration || null,
      }),
    })

    onProgress(100, 'Done!', {})
    return result
  }

  // Legacy base64 upload (kept for small images <1MB where simplicity wins)
  async uploadMedia(base64Data, mimeType, type = 'IMAGE', options = {}) {
    return this.fetch('/media/upload', {
      method: 'POST',
      body: JSON.stringify({
        data: base64Data,
        mimeType,
        type,
        width: options.width,
        height: options.height,
        duration: options.duration,
      }),
    })
  }

  // ===== Legal =====
  async getConsent() { return this.fetch('/legal/consent') }
  async acceptConsent(version) {
    return this.fetch('/legal/accept', { method: 'POST', body: JSON.stringify({ version }) })
  }

  // ===== Search =====
  async search(q, type = 'all') {
    return this.fetch(`/search?q=${encodeURIComponent(q)}&type=${type}`)
  }

  // ===== Suggestions =====
  async getSuggestions() { return this.fetch('/suggestions/users') }

  // ===== Moderation (moderator+) =====
  async getModerationQueue(bucket = 'held', offset = 0) {
    return this.fetch(`/moderation/queue?bucket=${bucket}&offset=${offset}`)
  }
  async moderateContent(contentId, action, reason) {
    return this.fetch(`/moderation/${contentId}/action`, {
      method: 'POST',
      body: JSON.stringify({ action, reason }),
    })
  }

  // ===== Admin =====
  async seedColleges() { return this.fetch('/admin/colleges/seed', { method: 'POST' }) }
  async getStats() { return this.fetch('/admin/stats') }
}

export const api = new TribeAPI()
