'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Home, Search, PlusSquare, User, Heart, MessageCircle, Bookmark, BookmarkCheck,
  MoreHorizontal, ArrowLeft, Camera, LogOut, Send, GraduationCap, Shield, Users,
  Flag, X, Loader2, ChevronRight, Eye, Globe, UserPlus, MapPin, Building2,
  ThumbsDown, ImagePlus, Sparkles, TrendingUp, Flame, Crown, Check, Film, Upload
} from 'lucide-react'
import { Progress } from '@/components/ui/progress'

// ===== HELPERS =====
function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date)) / 1000)
  if (s < 60) return 'now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  return `${Math.floor(d / 7)}w`
}

function initials(name) {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

function formatCount(n) {
  if (!n) return '0'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return n.toString()
}

const AVATAR_COLORS = [
  'bg-violet-600', 'bg-blue-600', 'bg-emerald-600', 'bg-amber-600',
  'bg-rose-600', 'bg-cyan-600', 'bg-fuchsia-600', 'bg-lime-600'
]

function avatarColor(id) {
  if (!id) return AVATAR_COLORS[0]
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

// ===== LOGIN VIEW =====
function LoginView({ onAuth }) {
  const [mode, setMode] = useState('login')
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (mode === 'register') {
        const data = await api.register(phone, pin, displayName)
        onAuth(data.user, true)
      } else {
        const data = await api.login(phone, pin)
        onAuth(data.user, false)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background effects */}
      <div className="absolute inset-0 bg-gradient-to-br from-violet-950/30 via-background to-fuchsia-950/20" />
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-violet-600/10 rounded-full blur-3xl" />
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-fuchsia-600/10 rounded-full blur-3xl" />

      <div className="relative z-10 w-full max-w-sm fade-in">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-3">
            <div className="w-10 h-10 gradient-bg rounded-xl flex items-center justify-center">
              <Flame className="w-6 h-6 text-white" />
            </div>
          </div>
          <h1 className="text-4xl font-bold gradient-text tracking-tight">Tribe</h1>
          <p className="text-muted-foreground mt-2 text-sm">Your college. Your community. Your voice.</p>
        </div>

        <Card className="border-border/50 bg-card/80 backdrop-blur-xl shadow-2xl">
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              {mode === 'register' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Your Name</label>
                  <Input
                    placeholder="What should we call you?"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    className="bg-secondary/50 border-border/50 h-11 text-sm"
                    required
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Phone Number</label>
                <div className="flex gap-2">
                  <div className="flex items-center px-3 bg-secondary/50 border border-border/50 rounded-md text-sm text-muted-foreground">
                    +91
                  </div>
                  <Input
                    type="tel"
                    placeholder="10-digit number"
                    value={phone}
                    onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    className="bg-secondary/50 border-border/50 h-11 text-sm flex-1"
                    maxLength={10}
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">4-Digit PIN</label>
                <Input
                  type="password"
                  placeholder="Create a secure PIN"
                  value={pin}
                  onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className="bg-secondary/50 border-border/50 h-11 text-sm tracking-[0.5em] text-center"
                  maxLength={4}
                  required
                />
              </div>

              {error && (
                <p className="text-destructive text-xs bg-destructive/10 px-3 py-2 rounded-md">{error}</p>
              )}

              <Button
                type="submit"
                className="w-full h-11 gradient-bg hover:opacity-90 text-white font-semibold"
                disabled={loading}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === 'register' ? 'Create Account' : 'Log In'}
              </Button>
            </form>

            <Separator className="my-5" />

            <p className="text-center text-sm text-muted-foreground">
              {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
              <button
                className="text-violet-400 hover:text-violet-300 font-medium transition-colors"
                onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError('') }}
              >
                {mode === 'login' ? 'Sign up' : 'Log in'}
              </button>
            </p>
          </CardContent>
        </Card>

        <p className="text-center text-[10px] text-muted-foreground/60 mt-6 px-8">
          By continuing, you agree to Tribe's Terms of Service and Privacy Policy
        </p>
      </div>
    </div>
  )
}

// ===== ONBOARDING VIEW =====
function OnboardingView({ user, onComplete, onUpdate }) {
  const [step, setStep] = useState(1) // 1: age, 2: college, 3: consent
  const [birthYear, setBirthYear] = useState('')
  const [collegeSearch, setCollegeSearch] = useState('')
  const [colleges, setColleges] = useState([])
  const [selectedCollege, setSelectedCollege] = useState(null)
  const [loading, setLoading] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [consentNotice, setConsentNotice] = useState(null)
  const searchTimeout = useRef(null)

  useEffect(() => {
    api.getConsent().then(d => setConsentNotice(d.notice)).catch(() => {})
    api.seedColleges().catch(() => {}) // Seed colleges on first visit
  }, [])

  useEffect(() => {
    if (collegeSearch.length < 2) { setColleges([]); return }
    clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(async () => {
      setSearchLoading(true)
      try {
        const data = await api.searchColleges(collegeSearch, null, null, 15)
        setColleges(data.colleges)
      } catch {}
      setSearchLoading(false)
    }, 300)
  }, [collegeSearch])

  async function handleAge() {
    setLoading(true)
    try {
      const data = await api.setAge(parseInt(birthYear))
      onUpdate(data.user)
      setStep(2)
    } catch (err) {
      alert(err.message)
    }
    setLoading(false)
  }

  async function handleCollege(skip) {
    setLoading(true)
    try {
      if (!skip && selectedCollege) {
        const data = await api.setCollege(selectedCollege.id)
        onUpdate(data.user)
      }
      setStep(3)
    } catch (err) {
      alert(err.message)
    }
    setLoading(false)
  }

  async function handleConsent() {
    setLoading(true)
    try {
      await api.acceptConsent(consentNotice?.version || '1.0')
      await api.completeOnboarding()
      onComplete()
    } catch (err) {
      alert(err.message)
    }
    setLoading(false)
  }

  const years = []
  const currentYear = new Date().getFullYear()
  for (let y = currentYear - 10; y >= currentYear - 60; y--) years.push(y)

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-violet-950/20 via-background to-background" />

      <div className="relative z-10 w-full max-w-md fade-in">
        {/* Progress */}
        <div className="flex gap-1.5 mb-8 px-4">
          {[1, 2, 3].map(s => (
            <div key={s} className={`h-1 flex-1 rounded-full transition-all duration-500 ${s <= step ? 'gradient-bg' : 'bg-secondary'}`} />
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-6 slide-up">
            <div className="text-center">
              <div className="w-16 h-16 gradient-bg rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Shield className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold">How old are you?</h2>
              <p className="text-muted-foreground text-sm mt-2">This helps us keep Tribe safe for everyone</p>
            </div>

            <Card className="border-border/50 bg-card/80 backdrop-blur">
              <CardContent className="p-6">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Birth Year</label>
                <select
                  value={birthYear}
                  onChange={e => setBirthYear(e.target.value)}
                  className="w-full mt-2 h-11 px-3 bg-secondary/50 border border-border/50 rounded-md text-sm text-foreground appearance-none"
                >
                  <option value="">Select your birth year</option>
                  {years.map(y => <option key={y} value={y}>{y}</option>)}
                </select>

                <Button
                  className="w-full mt-4 gradient-bg hover:opacity-90 text-white font-semibold h-11"
                  disabled={!birthYear || loading}
                  onClick={handleAge}
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Continue'}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6 slide-up">
            <div className="text-center">
              <div className="w-16 h-16 gradient-bg rounded-2xl flex items-center justify-center mx-auto mb-4">
                <GraduationCap className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold">Find your college</h2>
              <p className="text-muted-foreground text-sm mt-2">Connect with your campus community</p>
            </div>

            <Card className="border-border/50 bg-card/80 backdrop-blur">
              <CardContent className="p-6 space-y-3">
                <Input
                  placeholder="Search 1000+ colleges..."
                  value={collegeSearch}
                  onChange={e => setCollegeSearch(e.target.value)}
                  className="bg-secondary/50 border-border/50 h-11"
                />

                {searchLoading && <div className="flex justify-center py-3"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}

                <ScrollArea className="max-h-64">
                  <div className="space-y-1">
                    {colleges.map(c => (
                      <button
                        key={c.id}
                        onClick={() => setSelectedCollege(c)}
                        className={`w-full text-left p-3 rounded-lg transition-all text-sm ${
                          selectedCollege?.id === c.id
                            ? 'bg-violet-600/20 border border-violet-500/30'
                            : 'hover:bg-secondary/80'
                        }`}
                      >
                        <div className="font-medium text-foreground">{c.officialName}</div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3" />
                          {c.city}, {c.state}
                          <Badge variant="outline" className="ml-2 text-[10px] px-1.5 py-0">{c.type}</Badge>
                        </div>
                      </button>
                    ))}
                    {collegeSearch.length >= 2 && !searchLoading && colleges.length === 0 && (
                      <p className="text-center text-sm text-muted-foreground py-4">No colleges found</p>
                    )}
                  </div>
                </ScrollArea>

                <div className="flex gap-2 pt-2">
                  <Button variant="outline" className="flex-1 h-11" onClick={() => handleCollege(true)}>
                    Skip for now
                  </Button>
                  <Button
                    className="flex-1 h-11 gradient-bg hover:opacity-90 text-white font-semibold"
                    disabled={!selectedCollege || loading}
                    onClick={() => handleCollege(false)}
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Join College'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6 slide-up">
            <div className="text-center">
              <div className="w-16 h-16 gradient-bg rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Check className="w-8 h-8 text-white" />
              </div>
              <h2 className="text-2xl font-bold">Almost there!</h2>
              <p className="text-muted-foreground text-sm mt-2">Review and accept our privacy terms</p>
            </div>

            <Card className="border-border/50 bg-card/80 backdrop-blur">
              <CardContent className="p-6 space-y-4">
                <div className="bg-secondary/50 rounded-lg p-4 text-xs text-muted-foreground leading-relaxed max-h-48 overflow-y-auto">
                  {consentNotice?.body || 'Loading...'}
                </div>

                <Button
                  className="w-full h-11 gradient-bg hover:opacity-90 text-white font-semibold"
                  disabled={loading}
                  onClick={handleConsent}
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Accept & Start Exploring'}
                </Button>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}

// ===== POST CARD =====
function PostCard({ post, currentUser, onUserClick, onLike, onSave, onComment, onDelete }) {
  const [liked, setLiked] = useState(post.viewerHasLiked)
  const [likeCount, setLikeCount] = useState(post.likeCount || 0)
  const [saved, setSaved] = useState(post.viewerHasSaved)
  const [showComments, setShowComments] = useState(false)
  const [comments, setComments] = useState([])
  const [commentText, setCommentText] = useState('')
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [likeAnim, setLikeAnim] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [showMore, setShowMore] = useState(false)

  async function handleLike() {
    setLikeAnim(true)
    setTimeout(() => setLikeAnim(false), 350)
    if (liked) {
      setLiked(false)
      setLikeCount(c => c - 1)
      api.removeReaction(post.id).catch(() => { setLiked(true); setLikeCount(c => c + 1) })
    } else {
      setLiked(true)
      setLikeCount(c => c + 1)
      api.like(post.id).catch(() => { setLiked(false); setLikeCount(c => c - 1) })
    }
  }

  async function handleSave() {
    setSaved(!saved)
    if (saved) {
      api.unsave(post.id).catch(() => setSaved(true))
    } else {
      api.save(post.id).catch(() => setSaved(false))
    }
  }

  async function loadComments() {
    setShowComments(!showComments)
    if (!showComments && comments.length === 0) {
      setCommentsLoading(true)
      try {
        const data = await api.getComments(post.id)
        setComments(data.comments || [])
      } catch {}
      setCommentsLoading(false)
    }
  }

  async function handleComment(e) {
    e.preventDefault()
    if (!commentText.trim()) return
    try {
      const data = await api.addComment(post.id, commentText.trim())
      setComments([data.comment, ...comments])
      setCommentText('')
    } catch {}
  }

  const author = post.author || {}
  const caption = post.caption || ''
  const isLong = caption.length > 120

  return (
    <div className="border-b border-border/30 pb-1">
      {/* Header */}
      <div className="flex items-center px-4 py-3">
        <button onClick={() => onUserClick?.(author.id)} className="flex items-center gap-3 flex-1 min-w-0">
          <Avatar className="w-9 h-9 ring-2 ring-border/30">
            <AvatarFallback className={`${avatarColor(author.id)} text-white text-xs font-semibold`}>
              {initials(author.displayName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-sm truncate">{author.displayName}</span>
              {author.collegeName && (
                <Badge variant="outline" className="text-[9px] px-1 py-0 border-violet-500/30 text-violet-400 hidden sm:inline-flex">
                  <GraduationCap className="w-2.5 h-2.5 mr-0.5" />
                  {author.collegeName?.split(' ').slice(0, 3).join(' ')}
                </Badge>
              )}
            </div>
            <span className="text-[11px] text-muted-foreground">{timeAgo(post.createdAt)}</span>
          </div>
        </button>
        {post.syntheticDeclaration && (
          <Badge className="text-[9px] bg-amber-500/20 text-amber-400 border-amber-500/30 mr-2">
            <Sparkles className="w-2.5 h-2.5 mr-0.5" />AI
          </Badge>
        )}
        {currentUser?.id === post.authorId && (
          <button onClick={() => onDelete?.(post.id)} className="text-muted-foreground hover:text-foreground p-1">
            <MoreHorizontal className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* Media */}
      {post.media && post.media.length > 0 && (
        <div className="relative bg-secondary/30" onDoubleClick={handleLike}>
          {post.media[0].mimeType?.startsWith('video/') || post.media[0].type === 'VIDEO' ? (
            <video
              src={post.media[0].publicUrl || post.media[0].url}
              className="w-full object-cover max-h-[600px] bg-black"
              controls
              playsInline
              preload="metadata"
              data-testid="post-video"
            />
          ) : (
            <img
              src={post.media[0].publicUrl || post.media[0].url}
              alt=""
              className="w-full object-cover max-h-[600px]"
              loading="lazy"
            />
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center px-4 pt-3 pb-1">
        <div className="flex items-center gap-4 flex-1">
          <button onClick={handleLike} className={`transition-all ${likeAnim ? 'like-animation' : ''}`}>
            <Heart className={`w-6 h-6 ${liked ? 'fill-red-500 text-red-500' : 'text-foreground hover:text-muted-foreground'}`} />
          </button>
          <button onClick={loadComments} className="hover:text-muted-foreground transition-colors">
            <MessageCircle className="w-6 h-6" />
          </button>
          <button className="hover:text-muted-foreground transition-colors">
            <Send className="w-5 h-5 -rotate-12" />
          </button>
        </div>
        <button onClick={handleSave} className="transition-all">
          {saved ? <BookmarkCheck className="w-6 h-6 text-foreground fill-foreground" /> : <Bookmark className="w-6 h-6 hover:text-muted-foreground" />}
        </button>
      </div>

      {/* Like count */}
      {likeCount > 0 && (
        <div className="px-4 pt-1">
          <span className="text-sm font-semibold">{formatCount(likeCount)} {likeCount === 1 ? 'like' : 'likes'}</span>
        </div>
      )}

      {/* Caption */}
      {caption && (
        <div className="px-4 pt-1.5">
          <p className="text-sm">
            <button onClick={() => onUserClick?.(author.id)} className="font-semibold mr-1.5 hover:opacity-80">{author.displayName}</button>
            {isLong && !expanded ? (
              <>
                {caption.slice(0, 120)}...
                <button className="text-muted-foreground ml-1" onClick={() => setExpanded(true)}>more</button>
              </>
            ) : caption}
          </p>
        </div>
      )}

      {/* Comment count */}
      {(post.commentCount || 0) > 0 && !showComments && (
        <button className="px-4 pt-1 text-sm text-muted-foreground hover:text-foreground/80" onClick={loadComments}>
          View {post.commentCount === 1 ? '1 comment' : `all ${post.commentCount} comments`}
        </button>
      )}

      {/* Comments section */}
      {showComments && (
        <div className="px-4 pt-2 space-y-2">
          {commentsLoading ? (
            <div className="flex justify-center py-2"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
          ) : (
            <>
              {comments.map(c => (
                <div key={c.id} className="text-sm">
                  <button onClick={() => onUserClick?.(c.author?.id)} className="font-semibold mr-1.5 hover:opacity-80">
                    {c.author?.displayName}
                  </button>
                  <span className="text-foreground/90">{c.body}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">{timeAgo(c.createdAt)}</span>
                </div>
              ))}
            </>
          )}
          <form onSubmit={handleComment} className="flex items-center gap-2 pt-1">
            <Input
              placeholder="Add a comment..."
              value={commentText}
              onChange={e => setCommentText(e.target.value)}
              className="bg-transparent border-none text-sm h-8 px-0 focus-visible:ring-0 placeholder:text-muted-foreground/50"
            />
            {commentText.trim() && (
              <button type="submit" className="text-violet-400 font-semibold text-sm hover:text-violet-300">Post</button>
            )}
          </form>
        </div>
      )}

      <div className="h-2" />
    </div>
  )
}

// ===== COMPOSE DIALOG =====
function ComposeDialog({ open, onClose, user, onPost }) {
  const [caption, setCaption] = useState('')
  const [file, setFile] = useState(null)
  const [filePreview, setFilePreview] = useState(null)
  const [fileType, setFileType] = useState(null) // 'image' | 'video'
  const [videoDuration, setVideoDuration] = useState(null)
  const [loading, setLoading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadPhase, setUploadPhase] = useState('')
  const [uploadStats, setUploadStats] = useState({})
  const fileRef = useRef(null)

  function handleFile(e) {
    const f = e.target.files?.[0]
    if (!f) return
    const isVideo = f.type.startsWith('video/')
    const maxSize = 200 * 1024 * 1024
    if (f.size > maxSize) { alert('Max 200MB'); return }

    setFile(f)
    setFileType(isVideo ? 'video' : 'image')
    setVideoDuration(null)

    const url = URL.createObjectURL(f)
    setFilePreview(url)

    // Extract video duration
    if (isVideo) {
      const vid = document.createElement('video')
      vid.preload = 'metadata'
      vid.onloadedmetadata = () => {
        setVideoDuration(Math.round(vid.duration))
        URL.revokeObjectURL(vid.src)
      }
      vid.src = url
    }
  }

  function clearFile() {
    if (filePreview) URL.revokeObjectURL(filePreview)
    setFile(null)
    setFilePreview(null)
    setFileType(null)
    setVideoDuration(null)
    setUploadProgress(0)
    setUploadPhase('')
    setUploadStats({})
  }

  async function handlePost() {
    if (!caption.trim() && !file) return
    setLoading(true)
    setUploadProgress(0)
    setUploadPhase('')
    setUploadStats({})

    try {
      let mediaIds = []

      if (file) {
        // Direct-to-CDN upload via presigned URL
        const result = await api.uploadFile(file, (pct, phase, stats) => {
          setUploadProgress(pct)
          setUploadPhase(phase)
          setUploadStats(stats || {})
        }, { duration: videoDuration })
        mediaIds = [result.id]
      }

      const data = await api.createPost({ caption: caption.trim(), mediaIds })
      onPost(data.post)
      setCaption('')
      clearFile()
      onClose()
    } catch (err) {
      alert(err.message)
    }
    setLoading(false)
  }

  const fileSizeMB = file ? (file.size / (1024 * 1024)).toFixed(1) : 0

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg bg-card border-border/50 p-0" data-testid="compose-dialog">
        <DialogHeader className="p-4 pb-0">
          <DialogTitle className="text-center font-semibold">Create Post</DialogTitle>
        </DialogHeader>
        <Separator />
        <div className="p-4 space-y-4">
          <div className="flex gap-3">
            <Avatar className="w-10 h-10">
              <AvatarFallback className={`${avatarColor(user?.id)} text-white text-sm font-semibold`}>
                {initials(user?.displayName)}
              </AvatarFallback>
            </Avatar>
            <Textarea
              placeholder="What's on your mind?"
              value={caption}
              onChange={e => setCaption(e.target.value)}
              className="min-h-[100px] bg-transparent border-none resize-none focus-visible:ring-0 text-sm"
              maxLength={2200}
              data-testid="compose-caption"
            />
          </div>

          {/* Media Preview */}
          {filePreview && (
            <div className="relative rounded-lg overflow-hidden" data-testid="media-preview">
              {fileType === 'video' ? (
                <video
                  src={filePreview}
                  className="w-full max-h-80 object-cover rounded-lg bg-black"
                  controls
                  muted
                />
              ) : (
                <img src={filePreview} alt="Preview" className="w-full max-h-80 object-cover rounded-lg" />
              )}
              {!loading && (
                <button
                  onClick={clearFile}
                  className="absolute top-2 right-2 bg-black/60 rounded-full p-1 hover:bg-black/80 transition-colors"
                  data-testid="clear-media-btn"
                >
                  <X className="w-4 h-4 text-white" />
                </button>
              )}
              {/* File info badge */}
              <div className="absolute bottom-2 left-2 flex gap-1.5">
                <Badge className="bg-black/60 text-white border-none text-[10px]">
                  {fileType === 'video' ? <Film className="w-3 h-3 mr-1" /> : <ImagePlus className="w-3 h-3 mr-1" />}
                  {fileSizeMB} MB
                </Badge>
                {videoDuration && (
                  <Badge className="bg-black/60 text-white border-none text-[10px]">
                    {Math.floor(videoDuration / 60)}:{String(videoDuration % 60).padStart(2, '0')}
                  </Badge>
                )}
                <Badge className="bg-emerald-600/80 text-white border-none text-[10px]">
                  <Upload className="w-3 h-3 mr-1" />CDN Direct
                </Badge>
              </div>
            </div>
          )}

          {/* Upload Progress */}
          {loading && file && (
            <div className="space-y-2 bg-muted/30 rounded-lg p-3" data-testid="upload-progress">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground font-medium">{uploadPhase}</span>
                <span className="text-xs font-bold text-emerald-400">{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} className="h-2.5" />
              {uploadStats.speedMB > 0 && (
                <div className="flex justify-between text-[10px] text-muted-foreground/70">
                  <span>{uploadStats.speedMB} MB/s</span>
                  <span>
                    {((uploadStats.bytes || 0) / (1024 * 1024)).toFixed(1)} / {((uploadStats.total || file.size) / (1024 * 1024)).toFixed(1)} MB
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <input ref={fileRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFile} />
              {user?.ageStatus === 'ADULT' && (
                <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={loading} data-testid="add-media-btn">
                  <ImagePlus className="w-5 h-5 text-violet-400 mr-1" />
                  <span className="text-xs text-muted-foreground">Photo/Video</span>
                </Button>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">{caption.length}/2200</span>
              <Button
                onClick={handlePost}
                disabled={loading || (!caption.trim() && !file)}
                className="gradient-bg hover:opacity-90 text-white px-6"
                size="sm"
                data-testid="share-post-btn"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Share'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ===== PROFILE VIEW =====
function ProfileView({ userId, currentUser, onBack, onUserClick, isOwn }) {
  const [profile, setProfile] = useState(null)
  const [posts, setPosts] = useState([])
  const [isFollowing, setIsFollowing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [cursor, setCursor] = useState(null)

  useEffect(() => {
    loadProfile()
  }, [userId])

  async function loadProfile() {
    setLoading(true)
    try {
      const data = await api.getUser(userId)
      setProfile(data.user)
      setIsFollowing(data.isFollowing)
      const postsData = await api.getUserPosts(userId)
      setPosts(postsData.items || [])
      setCursor(postsData.nextCursor)
    } catch {}
    setLoading(false)
  }

  async function toggleFollow() {
    if (isFollowing) {
      setIsFollowing(false)
      setProfile(p => ({ ...p, followersCount: (p.followersCount || 0) - 1 }))
      api.unfollow(userId).catch(() => { setIsFollowing(true) })
    } else {
      setIsFollowing(true)
      setProfile(p => ({ ...p, followersCount: (p.followersCount || 0) + 1 }))
      api.follow(userId).catch(() => { setIsFollowing(false) })
    }
  }

  if (loading) return (
    <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
  )

  if (!profile) return (
    <div className="text-center py-20 text-muted-foreground">User not found</div>
  )

  return (
    <div className="fade-in">
      {/* Header */}
      {!isOwn && (
        <div className="flex items-center px-4 py-3 border-b border-border/30">
          <button onClick={onBack} className="mr-4"><ArrowLeft className="w-5 h-5" /></button>
          <span className="font-semibold text-sm">{profile.displayName}</span>
        </div>
      )}

      {/* Profile Info */}
      <div className="px-6 py-6">
        <div className="flex items-start gap-6">
          <Avatar className="w-20 h-20 ring-2 ring-violet-500/30">
            <AvatarFallback className={`${avatarColor(profile.id)} text-white text-2xl font-bold`}>
              {initials(profile.displayName)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 pt-1">
            <div className="flex gap-6 justify-around text-center">
              <div><div className="font-bold text-lg">{profile.postsCount || 0}</div><div className="text-xs text-muted-foreground">Posts</div></div>
              <div><div className="font-bold text-lg">{formatCount(profile.followersCount)}</div><div className="text-xs text-muted-foreground">Followers</div></div>
              <div><div className="font-bold text-lg">{formatCount(profile.followingCount)}</div><div className="text-xs text-muted-foreground">Following</div></div>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <h2 className="font-bold">{profile.displayName}</h2>
          {profile.username && <p className="text-sm text-muted-foreground">@{profile.username}</p>}
          {profile.bio && <p className="text-sm mt-1">{profile.bio}</p>}
          {profile.collegeName && (
            <div className="flex items-center gap-1.5 mt-2 text-sm text-violet-400">
              <GraduationCap className="w-4 h-4" />
              <span>{profile.collegeName}</span>
            </div>
          )}
        </div>

        {!isOwn && currentUser && currentUser.id !== profile.id && (
          <div className="flex gap-2 mt-4">
            <Button
              onClick={toggleFollow}
              className={`flex-1 h-9 ${isFollowing ? 'bg-secondary hover:bg-secondary/80 text-foreground' : 'gradient-bg hover:opacity-90 text-white'}`}
              size="sm"
            >
              {isFollowing ? 'Following' : 'Follow'}
            </Button>
          </div>
        )}
      </div>

      <Separator />

      {/* Posts grid */}
      <div className="grid grid-cols-3 gap-0.5 p-0.5">
        {posts.map(p => (
          <div key={p.id} className="aspect-square bg-secondary/30 relative group cursor-pointer">
            {p.media && p.media.length > 0 ? (
              <img src={p.media[0].url} alt="" className="w-full h-full object-cover" loading="lazy" />
            ) : (
              <div className="w-full h-full flex items-center justify-center p-2">
                <p className="text-xs text-muted-foreground line-clamp-4 text-center">{p.caption}</p>
              </div>
            )}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-4">
              <span className="flex items-center gap-1 text-white text-sm font-semibold">
                <Heart className="w-4 h-4 fill-white" />{p.likeCount || 0}
              </span>
              <span className="flex items-center gap-1 text-white text-sm font-semibold">
                <MessageCircle className="w-4 h-4 fill-white" />{p.commentCount || 0}
              </span>
            </div>
          </div>
        ))}
      </div>

      {posts.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Camera className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">No posts yet</p>
        </div>
      )}
    </div>
  )
}

// ===== SEARCH VIEW =====
function SearchView({ onUserClick, onCollegeClick }) {
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState('users')
  const [results, setResults] = useState({ users: [], colleges: [] })
  const [loading, setLoading] = useState(false)
  const searchRef = useRef(null)

  useEffect(() => {
    if (query.length < 2) { setResults({ users: [], colleges: [] }); return }
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const data = await api.search(query)
        setResults(data)
      } catch {}
      setLoading(false)
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  return (
    <div className="fade-in">
      <div className="sticky top-0 bg-background/95 backdrop-blur-md z-10 px-4 pt-4 pb-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            ref={searchRef}
            placeholder="Search people and colleges..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="pl-10 bg-secondary/50 border-border/30 h-10"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          )}
        </div>

        {query.length >= 2 && (
          <Tabs value={tab} onValueChange={setTab} className="mt-3">
            <TabsList className="bg-secondary/50 w-full">
              <TabsTrigger value="users" className="flex-1 text-xs">People</TabsTrigger>
              <TabsTrigger value="colleges" className="flex-1 text-xs">Colleges</TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      </div>

      <div className="px-4 pt-2">
        {loading && <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>}

        {!loading && tab === 'users' && results.users?.map(u => (
          <button
            key={u.id}
            onClick={() => onUserClick(u.id)}
            className="flex items-center gap-3 w-full py-3 hover:bg-secondary/30 rounded-lg px-2 transition-colors"
          >
            <Avatar className="w-11 h-11">
              <AvatarFallback className={`${avatarColor(u.id)} text-white text-sm font-semibold`}>
                {initials(u.displayName)}
              </AvatarFallback>
            </Avatar>
            <div className="text-left min-w-0">
              <div className="font-semibold text-sm truncate">{u.displayName}</div>
              {u.username && <div className="text-xs text-muted-foreground">@{u.username}</div>}
              {u.collegeName && <div className="text-xs text-violet-400 truncate">{u.collegeName}</div>}
            </div>
          </button>
        ))}

        {!loading && tab === 'colleges' && results.colleges?.map(c => (
          <button
            key={c.id}
            onClick={() => onCollegeClick(c.id)}
            className="flex items-center gap-3 w-full py-3 hover:bg-secondary/30 rounded-lg px-2 transition-colors"
          >
            <div className="w-11 h-11 bg-violet-600/20 rounded-xl flex items-center justify-center">
              <Building2 className="w-5 h-5 text-violet-400" />
            </div>
            <div className="text-left min-w-0">
              <div className="font-semibold text-sm truncate">{c.officialName}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <MapPin className="w-3 h-3" />{c.city}, {c.state}
              </div>
            </div>
            <Badge variant="outline" className="text-[9px] ml-auto shrink-0">{c.type}</Badge>
          </button>
        ))}

        {query.length < 2 && (
          <div className="text-center py-16">
            <Search className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-muted-foreground text-sm">Search for people, colleges, and more</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ===== COLLEGE VIEW =====
function CollegeView({ collegeId, onBack, onUserClick }) {
  const [college, setCollege] = useState(null)
  const [posts, setPosts] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('posts')

  useEffect(() => {
    loadCollege()
  }, [collegeId])

  async function loadCollege() {
    setLoading(true)
    try {
      const [cd, fd, md] = await Promise.all([
        api.getCollege(collegeId),
        api.getCollegeFeed(collegeId),
        api.getCollegeMembers(collegeId)
      ])
      setCollege(cd.college)
      setPosts(fd.items || [])
      setMembers(md.members || [])
    } catch {}
    setLoading(false)
  }

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
  if (!college) return <div className="text-center py-20 text-muted-foreground">College not found</div>

  return (
    <div className="fade-in">
      <div className="flex items-center px-4 py-3 border-b border-border/30">
        <button onClick={onBack} className="mr-4"><ArrowLeft className="w-5 h-5" /></button>
        <span className="font-semibold text-sm truncate">{college.officialName}</span>
      </div>

      {/* College Header */}
      <div className="px-6 py-6">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 gradient-bg rounded-2xl flex items-center justify-center shrink-0">
            <GraduationCap className="w-8 h-8 text-white" />
          </div>
          <div className="min-w-0">
            <h2 className="font-bold text-lg leading-tight">{college.officialName}</h2>
            <div className="flex items-center gap-1.5 mt-1 text-sm text-muted-foreground">
              <MapPin className="w-3.5 h-3.5" />
              {college.city}, {college.state}
            </div>
            <div className="flex gap-4 mt-3">
              <div className="text-center">
                <div className="font-bold">{college.membersCount || 0}</div>
                <div className="text-[10px] text-muted-foreground">Members</div>
              </div>
              <div className="text-center">
                <div className="font-bold">{college.contentCount || 0}</div>
                <div className="text-[10px] text-muted-foreground">Posts</div>
              </div>
            </div>
          </div>
        </div>
        <Badge className="mt-3" variant="outline">{college.type}</Badge>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-secondary/30 w-full rounded-none border-b border-border/30">
          <TabsTrigger value="posts" className="flex-1">Posts</TabsTrigger>
          <TabsTrigger value="members" className="flex-1">Members</TabsTrigger>
        </TabsList>
      </Tabs>

      {activeTab === 'posts' && (
        <div>
          {posts.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Camera className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No posts from this college yet</p>
            </div>
          ) : (
            posts.map(p => (
              <PostCard key={p.id} post={p} onUserClick={onUserClick} />
            ))
          )}
        </div>
      )}

      {activeTab === 'members' && (
        <div className="px-4 py-2">
          {members.map(m => (
            <button
              key={m.id}
              onClick={() => onUserClick(m.id)}
              className="flex items-center gap-3 w-full py-2.5 hover:bg-secondary/30 rounded-lg px-2"
            >
              <Avatar className="w-10 h-10">
                <AvatarFallback className={`${avatarColor(m.id)} text-white text-sm font-semibold`}>{initials(m.displayName)}</AvatarFallback>
              </Avatar>
              <div className="text-left">
                <div className="font-semibold text-sm">{m.displayName}</div>
                {m.username && <div className="text-xs text-muted-foreground">@{m.username}</div>}
              </div>
            </button>
          ))}
          {members.length === 0 && <p className="text-center py-8 text-muted-foreground text-sm">No members yet</p>}
        </div>
      )}
    </div>
  )
}

// ===== SUGGESTIONS WIDGET =====
function SuggestionsWidget({ suggestions, onFollow, onUserClick }) {
  if (!suggestions || suggestions.length === 0) return null
  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-muted-foreground">Suggested for you</span>
      </div>
      <div className="space-y-3">
        {suggestions.slice(0, 5).map(u => (
          <div key={u.id} className="flex items-center gap-3">
            <button onClick={() => onUserClick(u.id)}>
              <Avatar className="w-9 h-9">
                <AvatarFallback className={`${avatarColor(u.id)} text-white text-xs font-semibold`}>{initials(u.displayName)}</AvatarFallback>
              </Avatar>
            </button>
            <div className="flex-1 min-w-0">
              <button onClick={() => onUserClick(u.id)} className="block">
                <div className="font-semibold text-xs truncate">{u.displayName}</div>
                {u.collegeName && <div className="text-[10px] text-muted-foreground truncate">{u.collegeName?.split(' ').slice(0, 3).join(' ')}</div>}
              </button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-violet-400 text-xs h-7 px-3 hover:text-violet-300"
              onClick={() => onFollow(u.id)}
            >
              Follow
            </Button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ===== MAIN APP =====
function App() {
  // Auth state
  const [view, setView] = useState('loading') // loading, login, onboarding, app
  const [currentUser, setCurrentUser] = useState(null)

  // Navigation
  const [activeTab, setActiveTab] = useState('home')
  const [feedTab, setFeedTab] = useState('public')
  const [subView, setSubView] = useState(null) // null, user-profile, college-page
  const [subViewId, setSubViewId] = useState(null)

  // Data
  const [posts, setPosts] = useState([])
  const [cursor, setCursor] = useState(null)
  const [feedLoading, setFeedLoading] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [showCompose, setShowCompose] = useState(false)

  // Scroll ref
  const feedRef = useRef(null)
  const observerRef = useRef(null)

  // ===== AUTH CHECK =====
  useEffect(() => {
    checkAuth()
  }, [])

  async function checkAuth() {
    if (!api.getToken()) { setView('login'); return }
    try {
      const data = await api.me()
      setCurrentUser(data.user)
      if (!data.user.onboardingComplete) {
        setView('onboarding')
      } else {
        setView('app')
      }
    } catch {
      api.setToken(null)
      setView('login')
    }
  }

  // ===== FEED LOADING =====
  useEffect(() => {
    if (view === 'app' && activeTab === 'home' && !subView) {
      loadFeed(true)
      loadSuggestions()
    }
  }, [view, activeTab, feedTab, subView])

  async function loadFeed(fresh = false) {
    setFeedLoading(true)
    try {
      let data
      if (feedTab === 'public') {
        data = await api.getPublicFeed(fresh ? null : cursor)
      } else if (feedTab === 'following') {
        data = await api.getFollowingFeed(fresh ? null : cursor)
      } else if (feedTab === 'college' && currentUser?.collegeId) {
        data = await api.getCollegeFeed(currentUser.collegeId, fresh ? null : cursor)
      } else {
        data = { items: [], nextCursor: null }
      }
      setPosts(fresh ? (data.items || []) : [...posts, ...(data.items || [])])
      setCursor(data.nextCursor)
    } catch {}
    setFeedLoading(false)
  }

  async function loadSuggestions() {
    try {
      const data = await api.getSuggestions()
      setSuggestions(data.users || [])
    } catch {}
  }

  // ===== HANDLERS =====
  function handleAuth(user, isNew) {
    setCurrentUser(user)
    if (isNew || !user.onboardingComplete) setView('onboarding')
    else setView('app')
  }

  function handleUserClick(userId) {
    if (!userId) return
    if (userId === currentUser?.id) {
      setActiveTab('profile')
      setSubView(null)
    } else {
      setSubView('user-profile')
      setSubViewId(userId)
    }
  }

  function handleCollegeClick(collegeId) {
    setSubView('college-page')
    setSubViewId(collegeId)
  }

  function handleBack() {
    setSubView(null)
    setSubViewId(null)
  }

  function handleNewPost(post) {
    setPosts([post, ...posts])
  }

  async function handleFollow(userId) {
    try {
      await api.follow(userId)
      setSuggestions(suggestions.filter(s => s.id !== userId))
    } catch {}
  }

  async function handleDeletePost(postId) {
    if (!confirm('Delete this post?')) return
    try {
      await api.deletePost(postId)
      setPosts(posts.filter(p => p.id !== postId))
    } catch {}
  }

  async function handleLogout() {
    await api.logout()
    setCurrentUser(null)
    setView('login')
    setPosts([])
  }

  // ===== RENDER =====
  if (view === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 gradient-bg rounded-2xl flex items-center justify-center mx-auto mb-3">
            <Flame className="w-7 h-7 text-white" />
          </div>
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground mx-auto" />
        </div>
      </div>
    )
  }

  if (view === 'login') return <LoginView onAuth={handleAuth} />

  if (view === 'onboarding') {
    return (
      <OnboardingView
        user={currentUser}
        onUpdate={u => setCurrentUser(u)}
        onComplete={() => { setView('app'); checkAuth() }}
      />
    )
  }

  // ===== MAIN APP LAYOUT =====
  const navItems = [
    { id: 'home', icon: Home, label: 'Home' },
    { id: 'search', icon: Search, label: 'Search' },
    { id: 'create', icon: PlusSquare, label: 'Create' },
    { id: 'notifications', icon: Heart, label: 'Activity' },
    { id: 'profile', icon: User, label: 'Profile' },
  ]

  return (
    <div className="min-h-screen flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex flex-col w-[72px] xl:w-[240px] border-r border-border/30 fixed h-full bg-background z-20">
        <div className="p-4 xl:px-6 pt-8">
          <div className="xl:hidden flex justify-center">
            <div className="w-8 h-8 gradient-bg rounded-lg flex items-center justify-center">
              <Flame className="w-5 h-5 text-white" />
            </div>
          </div>
          <h1 className="hidden xl:block text-2xl font-bold gradient-text">Tribe</h1>
        </div>

        <nav className="flex-1 px-2 xl:px-3 py-4 space-y-1">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => {
                if (item.id === 'create') { setShowCompose(true); return }
                setActiveTab(item.id)
                setSubView(null)
              }}
              className={`flex items-center gap-4 w-full p-3 rounded-lg transition-all text-sm ${
                activeTab === item.id && !subView
                  ? 'bg-secondary/80 font-semibold'
                  : 'hover:bg-secondary/40 text-muted-foreground hover:text-foreground'
              }`}
            >
              <item.icon className={`w-6 h-6 ${activeTab === item.id && !subView ? 'text-foreground' : ''}`} />
              <span className="hidden xl:inline">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-2 xl:p-3 pb-6">
          <button
            onClick={handleLogout}
            className="flex items-center gap-4 w-full p-3 rounded-lg hover:bg-secondary/40 text-muted-foreground hover:text-foreground transition-all text-sm"
          >
            <LogOut className="w-6 h-6" />
            <span className="hidden xl:inline">Log out</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 lg:ml-[72px] xl:ml-[240px] pb-16 lg:pb-0">
        <div className="max-w-[935px] mx-auto flex">
          {/* Content area */}
          <div className="flex-1 max-w-[470px] mx-auto lg:mx-0 lg:max-w-[630px] w-full">

            {/* Mobile Header */}
            <div className="lg:hidden sticky top-0 bg-background/95 backdrop-blur-md z-10 flex items-center justify-between px-4 h-12 border-b border-border/30">
              <h1 className="text-xl font-bold gradient-text">Tribe</h1>
              <div className="flex items-center gap-3">
                <button onClick={() => setShowCompose(true)}>
                  <PlusSquare className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Sub views */}
            {subView === 'user-profile' && (
              <ProfileView
                userId={subViewId}
                currentUser={currentUser}
                onBack={handleBack}
                onUserClick={handleUserClick}
              />
            )}
            {subView === 'college-page' && (
              <CollegeView
                collegeId={subViewId}
                onBack={handleBack}
                onUserClick={handleUserClick}
              />
            )}

            {/* Home Feed */}
            {activeTab === 'home' && !subView && (
              <div ref={feedRef}>
                <Tabs value={feedTab} onValueChange={f => { setFeedTab(f); setPosts([]); setCursor(null) }} className="sticky top-12 lg:top-0 bg-background/95 backdrop-blur-md z-10">
                  <TabsList className="bg-transparent w-full justify-start px-4 gap-0 border-b border-border/30 rounded-none h-11">
                    <TabsTrigger value="public" className="text-xs data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-violet-500 rounded-none px-4">
                      <Globe className="w-3.5 h-3.5 mr-1.5" />Public
                    </TabsTrigger>
                    <TabsTrigger value="following" className="text-xs data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-violet-500 rounded-none px-4">
                      <Users className="w-3.5 h-3.5 mr-1.5" />Following
                    </TabsTrigger>
                    {currentUser?.collegeId && (
                      <TabsTrigger value="college" className="text-xs data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-violet-500 rounded-none px-4">
                        <GraduationCap className="w-3.5 h-3.5 mr-1.5" />College
                      </TabsTrigger>
                    )}
                  </TabsList>
                </Tabs>

                {feedLoading && posts.length === 0 ? (
                  <div className="space-y-6 p-4">
                    {[1, 2, 3].map(i => (
                      <div key={i} className="space-y-3">
                        <div className="flex items-center gap-3">
                          <Skeleton className="w-9 h-9 rounded-full" />
                          <div><Skeleton className="w-24 h-3" /><Skeleton className="w-16 h-2 mt-1" /></div>
                        </div>
                        <Skeleton className="w-full h-64 rounded-lg" />
                        <Skeleton className="w-full h-4" />
                      </div>
                    ))}
                  </div>
                ) : posts.length === 0 ? (
                  <div className="text-center py-20 px-6">
                    <div className="w-16 h-16 bg-secondary/50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                      <Camera className="w-8 h-8 text-muted-foreground/50" />
                    </div>
                    <h3 className="font-semibold text-lg">
                      {feedTab === 'following' ? 'Follow people to see their posts' : 'No posts yet'}
                    </h3>
                    <p className="text-muted-foreground text-sm mt-1">
                      {feedTab === 'following'
                        ? 'Start following people to see their content here'
                        : 'Be the first to share something!'}
                    </p>
                    <Button onClick={() => setShowCompose(true)} className="mt-4 gradient-bg text-white" size="sm">
                      Create Post
                    </Button>
                  </div>
                ) : (
                  <>
                    {posts.map(p => (
                      <PostCard
                        key={p.id}
                        post={p}
                        currentUser={currentUser}
                        onUserClick={handleUserClick}
                        onDelete={handleDeletePost}
                      />
                    ))}
                    {cursor && (
                      <div className="py-4 text-center">
                        <Button variant="ghost" size="sm" onClick={() => loadFeed()} disabled={feedLoading}>
                          {feedLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Load more'}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Search */}
            {activeTab === 'search' && !subView && (
              <SearchView onUserClick={handleUserClick} onCollegeClick={handleCollegeClick} />
            )}

            {/* Notifications placeholder */}
            {activeTab === 'notifications' && !subView && (
              <div className="text-center py-20">
                <Heart className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
                <h3 className="font-semibold">Activity</h3>
                <p className="text-muted-foreground text-sm mt-1">When people interact with your posts, you'll see it here</p>
              </div>
            )}

            {/* Profile */}
            {activeTab === 'profile' && !subView && (
              <ProfileView
                userId={currentUser?.id}
                currentUser={currentUser}
                onUserClick={handleUserClick}
                isOwn
              />
            )}
          </div>

          {/* Right Sidebar (Desktop) */}
          <div className="hidden lg:block w-[305px] pl-8 pt-8 shrink-0">
            {/* Current user */}
            <div className="flex items-center gap-3 mb-6">
              <Avatar className="w-11 h-11">
                <AvatarFallback className={`${avatarColor(currentUser?.id)} text-white text-sm font-semibold`}>
                  {initials(currentUser?.displayName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="font-semibold text-sm">{currentUser?.displayName}</div>
                {currentUser?.collegeName && (
                  <div className="text-xs text-muted-foreground truncate">{currentUser.collegeName}</div>
                )}
              </div>
            </div>

            <SuggestionsWidget
              suggestions={suggestions}
              onFollow={handleFollow}
              onUserClick={handleUserClick}
            />

            <div className="px-4 pt-6 text-[10px] text-muted-foreground/40 leading-relaxed">
              Tribe &middot; Trust-first college social platform<br/>
              &copy; 2025 Tribe. Built with governance and safety at its core.
            </div>
          </div>
        </div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-md border-t border-border/30 z-20">
        <div className="flex items-center justify-around h-14 max-w-lg mx-auto">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => {
                if (item.id === 'create') { setShowCompose(true); return }
                setActiveTab(item.id)
                setSubView(null)
              }}
              className={`flex flex-col items-center gap-0.5 p-2 transition-colors ${
                activeTab === item.id && !subView ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              <item.icon className={`w-6 h-6 ${item.id === 'create' ? '' : activeTab === item.id && !subView ? 'fill-foreground' : ''}`} />
            </button>
          ))}
        </div>
      </nav>

      {/* Compose Dialog */}
      <ComposeDialog
        open={showCompose}
        onClose={() => setShowCompose(false)}
        user={currentUser}
        onPost={handleNewPost}
      />
    </div>
  )
}

export default App
