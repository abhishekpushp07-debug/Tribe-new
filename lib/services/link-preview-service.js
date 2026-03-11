/**
 * Link Preview Service
 * Safe URL metadata extraction for post link previews.
 * 
 * Security: SSRF protection, timeout, content-length cap, no internal network access.
 */

const FETCH_TIMEOUT = 5000 // 5s
const MAX_CONTENT_LENGTH = 512 * 1024 // 512KB max to parse
const BLOCKED_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254', '10.', '172.16.', '192.168.']

function isSafeUrl(urlStr) {
  try {
    const parsed = new URL(urlStr)
    if (!['http:', 'https:'].includes(parsed.protocol)) return false
    const host = parsed.hostname.toLowerCase()
    if (BLOCKED_HOSTS.some(b => host === b || host.startsWith(b))) return false
    if (host.endsWith('.local') || host.endsWith('.internal')) return false
    return true
  } catch {
    return false
  }
}

function extractMetaTags(html) {
  const meta = {}
  // Extract <title>
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (titleMatch) meta.title = titleMatch[1].trim().slice(0, 300)

  // Extract og: and twitter: meta tags
  const metaRegex = /<meta\s+(?:[^>]*?\s+)?(?:property|name)\s*=\s*["']([^"']+)["'][^>]*?\s+content\s*=\s*["']([^"']*?)["'][^>]*?\/?>/gi
  const metaRegex2 = /<meta\s+(?:[^>]*?\s+)?content\s*=\s*["']([^"']*?)["'][^>]*?\s+(?:property|name)\s*=\s*["']([^"']+)["'][^>]*?\/?>/gi
  
  let match
  while ((match = metaRegex.exec(html)) !== null) {
    meta[match[1].toLowerCase()] = match[2].slice(0, 1000)
  }
  while ((match = metaRegex2.exec(html)) !== null) {
    meta[match[2].toLowerCase()] = match[1].slice(0, 1000)
  }
  return meta
}

/**
 * Fetch link preview metadata from a URL safely.
 * Returns null on failure (safe degradation).
 */
export async function fetchLinkPreview(url) {
  if (!url || !isSafeUrl(url)) return null

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'TribeBot/1.0 (link-preview)',
        'Accept': 'text/html',
      },
      redirect: 'follow',
    })
    clearTimeout(timeout)

    if (!response.ok) return null

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/html')) return null

    const contentLength = parseInt(response.headers.get('content-length') || '0', 10)
    if (contentLength > MAX_CONTENT_LENGTH) return null

    const html = (await response.text()).slice(0, MAX_CONTENT_LENGTH)
    const meta = extractMetaTags(html)

    const preview = {
      url,
      title: meta['og:title'] || meta['twitter:title'] || meta.title || null,
      description: meta['og:description'] || meta['twitter:description'] || meta.description || null,
      image: meta['og:image'] || meta['twitter:image'] || null,
      siteName: meta['og:site_name'] || null,
      type: meta['og:type'] || 'website',
      fetchedAt: new Date().toISOString(),
    }

    // Must have at least a title
    if (!preview.title) return null

    return preview
  } catch {
    return null
  }
}
