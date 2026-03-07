// Tribe API Client
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

  // Auth
  async register(phone, pin, displayName) {
    const data = await this.fetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ phone, pin, displayName })
    })
    this.setToken(data.token)
    return data
  }

  async login(phone, pin) {
    const data = await this.fetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ phone, pin })
    })
    this.setToken(data.token)
    return data
  }

  async logout() {
    try { await this.fetch('/auth/logout', { method: 'POST' }) } catch {}
    this.setToken(null)
  }

  async me() { return this.fetch('/auth/me') }

  // Profile
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

  // Users
  async getUser(userId) { return this.fetch(`/users/${userId}`) }
  async getUserPosts(userId, cursor) {
    const params = cursor ? `?cursor=${cursor}` : ''
    return this.fetch(`/users/${userId}/posts${params}`)
  }
  async getUserFollowers(userId) { return this.fetch(`/users/${userId}/followers`) }
  async getUserFollowing(userId) { return this.fetch(`/users/${userId}/following`) }

  // Colleges
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
  async getCollegeMembers(id) { return this.fetch(`/colleges/${id}/members`) }
  async getCollegeStates() { return this.fetch('/colleges/states') }

  // Content
  async createPost(data) {
    return this.fetch('/content/posts', { method: 'POST', body: JSON.stringify(data) })
  }
  async getPost(id) { return this.fetch(`/content/${id}`) }
  async deletePost(id) { return this.fetch(`/content/${id}`, { method: 'DELETE' }) }

  // Feeds
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

  // Social
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
  async addComment(contentId, body) {
    return this.fetch(`/content/${contentId}/comments`, {
      method: 'POST', body: JSON.stringify({ body })
    })
  }

  // Reports
  async report(targetType, targetId, reasonCode, details) {
    return this.fetch('/reports', {
      method: 'POST',
      body: JSON.stringify({ targetType, targetId, reasonCode, details })
    })
  }

  // Media
  async uploadMedia(base64Data, mimeType) {
    return this.fetch('/media/upload', {
      method: 'POST',
      body: JSON.stringify({ data: base64Data, mimeType, type: 'IMAGE' })
    })
  }

  // Legal
  async getConsent() { return this.fetch('/legal/consent') }
  async acceptConsent(version) {
    return this.fetch('/legal/accept', { method: 'POST', body: JSON.stringify({ version }) })
  }

  // Search
  async search(q, type = 'all') {
    return this.fetch(`/search?q=${encodeURIComponent(q)}&type=${type}`)
  }

  // Suggestions
  async getSuggestions() { return this.fetch('/suggestions/users') }

  // Admin
  async seedColleges() { return this.fetch('/admin/colleges/seed', { method: 'POST' }) }
  async getStats() { return this.fetch('/admin/stats') }
}

export const api = new TribeAPI()
