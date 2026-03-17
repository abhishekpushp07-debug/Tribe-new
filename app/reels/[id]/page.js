/**
 * Tribe — Reel Open Graph Page
 * 
 * Renders OG meta tags for WhatsApp/Telegram/Twitter rich preview cards.
 * When a reel link is shared, crawlers hit this page and get:
 *   og:video → playable video preview
 *   og:image → poster/thumbnail
 *   og:title → creator name + caption
 * 
 * Mobile users get redirected to the app via deep link.
 */

import { getDb } from '@/lib/db'

export async function generateMetadata({ params }) {
  const { id } = params
  const db = await getDb()

  const reel = await db.collection('reels').findOne(
    { id, status: 'PUBLISHED' },
    { projection: { _id: 0, id: 1, caption: 1, creatorId: 1, playbackUrl: 1, thumbnailUrl: 1, posterFrameUrl: 1, mediaId: 1, durationMs: 1, likeCount: 1, viewCount: 1, width: 1, height: 1 } }
  )

  if (!reel) {
    return {
      title: 'Reel Not Found — Tribe',
      description: 'This reel is no longer available.',
    }
  }

  // Resolve media asset for best URLs
  let videoUrl = reel.playbackUrl || ''
  let posterUrl = reel.posterFrameUrl || reel.thumbnailUrl || ''

  if (reel.mediaId) {
    const asset = await db.collection('media_assets').findOne(
      { id: reel.mediaId },
      { projection: { _id: 0, publicUrl: 1, playbackUrl: 1, thumbnailUrl: 1, posterFrameUrl: 1, variants: 1 } }
    )
    if (asset) {
      const v = asset.variants || {}
      videoUrl = v['720p']?.url || v.ultrafast_720p?.url || asset.playbackUrl || asset.publicUrl || videoUrl
      posterUrl = asset.posterFrameUrl || asset.thumbnailUrl || v.poster?.url || v.thumbnail?.url || posterUrl
    }
  }

  // Get creator name
  const creator = await db.collection('users').findOne(
    { id: reel.creatorId },
    { projection: { _id: 0, displayName: 1, username: 1 } }
  )
  const creatorName = creator?.displayName || creator?.username || 'Tribe User'
  const caption = reel.caption || ''
  const title = caption ? `${creatorName}: "${caption.slice(0, 60)}"` : `${creatorName} on Tribe`
  const description = caption ? caption.slice(0, 200) : `Watch this reel by ${creatorName} on Tribe — College Social Platform`

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://tribeapp.pro'
  const reelUrl = `${baseUrl}/reels/${id}`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: reelUrl,
      siteName: 'Tribe',
      type: 'video.other',
      videos: videoUrl ? [
        {
          url: videoUrl,
          secureUrl: videoUrl,
          type: 'video/mp4',
          width: reel.width || 720,
          height: reel.height || 1280,
        },
      ] : [],
      images: posterUrl ? [
        {
          url: posterUrl,
          width: 480,
          height: 854,
          alt: title,
        },
      ] : [],
    },
    twitter: {
      card: posterUrl ? 'summary_large_image' : 'summary',
      title,
      description,
      images: posterUrl ? [posterUrl] : [],
    },
    other: {
      'og:video:url': videoUrl,
      'og:video:secure_url': videoUrl,
      'og:video:type': 'video/mp4',
      'og:video:width': String(reel.width || 720),
      'og:video:height': String(reel.height || 1280),
      'al:android:url': `tribe://reels/${id}`,
      'al:android:package': 'com.tribe.app',
      'al:android:app_name': 'Tribe',
      'al:ios:url': `tribe://reels/${id}`,
      'al:ios:app_name': 'Tribe',
    },
  }
}

export default async function ReelPage({ params }) {
  const { id } = params
  const db = await getDb()

  const reel = await db.collection('reels').findOne(
    { id, status: 'PUBLISHED' },
    { projection: { _id: 0, id: 1, caption: 1, creatorId: 1, playbackUrl: 1, mediaId: 1, likeCount: 1, viewCount: 1 } }
  )

  // Resolve video URL
  let videoUrl = reel?.playbackUrl || ''
  if (reel?.mediaId) {
    const asset = await db.collection('media_assets').findOne(
      { id: reel.mediaId },
      { projection: { _id: 0, playbackUrl: 1, publicUrl: 1, variants: 1 } }
    )
    if (asset) {
      const v = asset.variants || {}
      videoUrl = v['720p']?.url || asset.playbackUrl || asset.publicUrl || videoUrl
    }
  }

  const creator = reel ? await db.collection('users').findOne(
    { id: reel.creatorId },
    { projection: { _id: 0, displayName: 1, username: 1 } }
  ) : null

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://tribeapp.pro'
  const deepLink = `tribe://reels/${id}`

  if (!reel) {
    return (
      <div style={{ background: '#000', color: '#fff', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 24, marginBottom: 8 }}>Reel Not Found</h1>
          <p style={{ color: '#888' }}>This reel may have been removed.</p>
          <a href={baseUrl} style={{ color: '#3b82f6', marginTop: 16, display: 'inline-block' }}>Open Tribe</a>
        </div>
      </div>
    )
  }

  return (
    <div style={{ background: '#000', color: '#fff', minHeight: '100vh', fontFamily: 'system-ui' }}>
      {/* Auto-redirect to app */}
      <script dangerouslySetInnerHTML={{ __html: `
        if (/Android|iPhone|iPad/i.test(navigator.userAgent)) {
          window.location.href = "${deepLink}";
          setTimeout(() => { window.location.href = "${baseUrl}"; }, 2000);
        }
      `}} />

      <div style={{ maxWidth: 480, margin: '0 auto', padding: 20 }}>
        {/* Video player */}
        {videoUrl && (
          <video
            src={videoUrl}
            controls
            playsInline
            loop
            preload="metadata"
            style={{ width: '100%', borderRadius: 12, background: '#111' }}
            poster=""
          />
        )}

        {/* Creator info */}
        <div style={{ marginTop: 16 }}>
          <p style={{ fontWeight: 600, fontSize: 16 }}>
            {creator?.displayName || creator?.username || 'Tribe User'}
          </p>
          {reel.caption && <p style={{ color: '#ccc', marginTop: 4 }}>{reel.caption}</p>}
          <p style={{ color: '#888', marginTop: 8, fontSize: 13 }}>
            {reel.viewCount || 0} views · {reel.likeCount || 0} likes
          </p>
        </div>

        {/* CTA */}
        <a href={deepLink} style={{
          display: 'block', textAlign: 'center', marginTop: 24,
          background: '#3b82f6', color: '#fff', padding: '14px 0',
          borderRadius: 12, fontWeight: 600, fontSize: 16, textDecoration: 'none',
        }}>
          Open in Tribe App
        </a>
        <a href={baseUrl} style={{
          display: 'block', textAlign: 'center', marginTop: 12,
          color: '#888', fontSize: 14, textDecoration: 'none',
        }}>
          Download Tribe
        </a>
      </div>
    </div>
  )
}
