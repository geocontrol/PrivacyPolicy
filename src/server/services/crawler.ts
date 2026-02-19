import axios from 'axios'
import * as cheerio from 'cheerio'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { insertPolicyDocument } from '../db/queries.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const POLICIES_DIR = path.resolve(__dirname, '../../../data/policies')

// Common URL path patterns that indicate a privacy policy page
const PRIVACY_LINK_PATTERNS = [
  /privacy[\s-_]?policy/i,
  /privacy[\s-_]?notice/i,
  /data[\s-_]?protection/i,
  /\bprivacy\b/i,
]

// Keywords that indicate privacy policy content (for inline detection)
const INLINE_PRIVACY_KEYWORDS = [
  /\bprivacy\b/i,
  /\bpersonal data\b/i,
  /\bcollect\b/i,
  /\bdata protection\b/i,
  /\bcookies?\b/i,
  /\bthird part(y|ies)\b/i,
  /\bGDPR\b/i,
  /\bretention\b/i,
]

const MIN_INLINE_POLICY_LENGTH = 200
const MIN_KEYWORD_MATCHES = 2

interface InlinePolicyResult {
  containerHtml: string
  text: string
  anchorId: string
}

const HTTP_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (compatible; PrivacyPolicyDashboard/0.1; +https://github.com/local/privacy-dashboard)',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CrawlResult {
  resolvedUrl: string
  html: string
  text: string
  contentHash: string
}

/**
 * Given a service's homepage URL, attempts to locate and retrieve its
 * privacy policy page. Returns the raw HTML, plain text, resolved URL,
 * and a SHA-256 hash of the content.
 *
 * Strategy:
 *  1. Fetch the homepage and look for privacy policy links in the footer / nav
 *  2. If not found via links, try common well-known paths (/privacy, /privacy-policy, etc.)
 *  3. Follow redirects automatically
 */
export async function crawlPolicyPage(serviceUrl: string): Promise<CrawlResult> {
  const base = normaliseBaseUrl(serviceUrl)

  // Step 1: load the homepage and look for policy links
  const homepageHtml = await fetchHtml(base)
  const policyUrl = findPolicyLink(homepageHtml, base)

  if (policyUrl) {
    const policyHtml = await fetchHtml(policyUrl)
    const text = extractText(policyHtml)
    const contentHash = sha256(text)
    return { resolvedUrl: policyUrl, html: policyHtml, text, contentHash }
  }

  // Step 2: check for inline/modal policy content in homepage
  const inline = findInlinePolicyContent(homepageHtml)

  if (inline) {
    const resolvedUrl = `${base}#${inline.anchorId}`
    const contentHash = sha256(inline.text)
    return { resolvedUrl, html: inline.containerHtml, text: inline.text, contentHash }
  }

  // Step 3: probe common well-known paths
  const commonUrl = await tryCommonPaths(base)

  if (commonUrl) {
    const policyHtml = await fetchHtml(commonUrl)
    const text = extractText(policyHtml)
    const contentHash = sha256(text)
    return { resolvedUrl: commonUrl, html: policyHtml, text, contentHash }
  }

  throw new CrawlerError(
    `Could not locate a privacy policy page for ${base}. ` +
    'Try providing the direct URL to the policy page.',
    'POLICY_NOT_FOUND',
  )
}

/**
 * Crawls the policy page for a service, saves the raw HTML to disk, and
 * records the document in the database. Returns the new document record ID.
 */
export async function fetchAndStorePolicyDocument(
  serviceId: string,
  serviceUrl: string,
): Promise<{ documentId: string; resolvedUrl: string; isNew: boolean }> {
  const result = await crawlPolicyPage(serviceUrl)

  // Save raw HTML to disk: data/policies/{serviceId}/{timestamp}.html
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const serviceDir = path.join(POLICIES_DIR, serviceId)
  await mkdir(serviceDir, { recursive: true })

  const filename = `${timestamp}.html`
  const filePath = path.join(serviceDir, filename)
  await writeFile(filePath, result.html, 'utf-8')

  // Record in DB
  const doc = insertPolicyDocument(serviceId, result.resolvedUrl, filePath, result.contentHash)

  return { documentId: doc.id, resolvedUrl: result.resolvedUrl, isNew: true }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function normaliseBaseUrl(url: string): string {
  const u = url.startsWith('http') ? url : `https://${url}`
  // Strip trailing slashes and paths — we want just the origin for homepage
  const parsed = new URL(u)
  return parsed.origin
}

async function fetchHtml(url: string): Promise<string> {
  try {
    const response = await axios.get<string>(url, {
      headers: HTTP_HEADERS,
      timeout: 15_000,
      maxRedirects: 5,
      responseType: 'text',
    })
    return response.data
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new CrawlerError(`Failed to fetch ${url}: ${msg}`, 'FETCH_ERROR')
  }
}

function findPolicyLink(html: string, baseUrl: string): string | null {
  const $ = cheerio.load(html)
  const candidates: Array<{ href: string; score: number }> = []

  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') ?? ''
    // Skip fragment-only links — these are in-page anchors, not external pages
    if (href.startsWith('#')) return
    const text = $(el).text().trim()
    const combined = `${href} ${text}`

    const score = PRIVACY_LINK_PATTERNS.reduce(
      (acc, pattern) => acc + (pattern.test(combined) ? 1 : 0),
      0,
    )

    if (score > 0) {
      try {
        const absolute = new URL(href, baseUrl).href
        candidates.push({ href: absolute, score })
      } catch {
        // relative URL that couldn't be resolved — skip
      }
    }
  })

  if (candidates.length === 0) return null

  // Return the highest scoring candidate; prefer same-domain links
  candidates.sort((a, b) => {
    const aSameDomain = new URL(a.href).hostname === new URL(baseUrl).hostname ? 1 : 0
    const bSameDomain = new URL(b.href).hostname === new URL(baseUrl).hostname ? 1 : 0
    return b.score + bSameDomain - (a.score + aSameDomain)
  })

  return candidates[0].href
}

const COMMON_POLICY_PATHS = [
  '/privacy-policy',
  '/privacy',
  '/legal/privacy',
  '/legal/privacy-policy',
  '/policies/privacy',
  '/en/privacy',
  '/en/privacy-policy',
  '/about/privacy',
]

async function tryCommonPaths(baseUrl: string): Promise<string | null> {
  for (const p of COMMON_POLICY_PATHS) {
    const url = `${baseUrl}${p}`
    try {
      const response = await axios.head(url, {
        headers: HTTP_HEADERS,
        timeout: 8_000,
        maxRedirects: 3,
      })
      if (response.status >= 200 && response.status < 300) {
        return url
      }
    } catch {
      // not found at this path — continue
    }
  }
  return null
}

function findInlinePolicyContent(html: string): InlinePolicyResult | null {
  const $ = cheerio.load(html)

  const candidates: Array<{ el: cheerio.Element; score: number; anchorId: string }> = []

  function scoreElement(el: cheerio.Element): number {
    const text = $(el).text().replace(/\s+/g, ' ').trim()
    if (text.length < MIN_INLINE_POLICY_LENGTH) return -1
    const matches = INLINE_PRIVACY_KEYWORDS.reduce(
      (acc, kw) => acc + (kw.test(text) ? 1 : 0), 0,
    )
    return matches >= MIN_KEYWORD_MATCHES ? matches : -1
  }

  function addCandidate(el: cheerio.Element, anchorId: string) {
    const score = scoreElement(el)
    if (score > 0) candidates.push({ el, score, anchorId })
  }

  // 1. Anchor links — <a href="#privacy"> pointing to an element by id
  $('a[href^="#"]').each((_i, a) => {
    const href = $(a).attr('href') ?? ''
    const fragment = href.slice(1)
    if (!fragment || !/privacy|policy|data.?protection/i.test(`${fragment} ${$(a).text()}`)) return
    const target = $(`[id="${fragment.replace(/"/g, '\\"')}"]`)
    if (target.length) addCandidate(target[0], fragment)
  })

  // 2. Modal trigger links — data-target, data-bs-target, aria-controls
  $('[data-target], [data-bs-target], [aria-controls]').each((_i, trigger) => {
    const selector = $(trigger).attr('data-target')
      ?? $(trigger).attr('data-bs-target')
      ?? $(trigger).attr('aria-controls')
    if (!selector) return
    const targetSel = selector.startsWith('#') ? selector : `#${selector}`
    try {
      const target = $(targetSel)
      if (target.length) {
        const id = target.attr('id') ?? 'inline-policy'
        addCandidate(target[0], id)
      }
    } catch { /* invalid selector — skip */ }
  })

  // 3. Dialog/modal containers
  $('dialog, [role="dialog"], [aria-modal="true"]').each((_i, el) => {
    const id = $(el).attr('id') ?? 'inline-policy'
    addCandidate(el, id)
  })
  // Elements with modal/dialog class names
  $('[class*="modal"], [class*="dialog"]').each((_i, el) => {
    const id = $(el).attr('id') ?? 'inline-policy'
    addCandidate(el, id)
  })

  // 4. Hidden sections
  $('[hidden], [aria-hidden="true"], [style*="display:none"], [style*="display: none"]').each((_i, el) => {
    const id = $(el).attr('id') ?? 'inline-policy'
    addCandidate(el, id)
  })

  // 5. ID/class scan — sections and divs with privacy-related identifiers
  $('section, div').each((_i, el) => {
    const id = $(el).attr('id') ?? ''
    const cls = $(el).attr('class') ?? ''
    if (/privacy|policy|data-protection/i.test(`${id} ${cls}`)) {
      addCandidate(el, id || 'inline-policy')
    }
  })

  // 6. Script payload extraction (Next.js RSC, __NEXT_DATA__, inline JSON)
  if (candidates.length === 0) {
    const scriptResult = extractScriptPolicyContent(html)
    if (scriptResult) {
      return { containerHtml: scriptResult.html, text: scriptResult.text, anchorId: 'embedded-policy' }
    }
    return null
  }

  // Pick highest-scoring candidate
  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]

  const containerHtml = $.html(best.el)
  const text = $(best.el).text().replace(/\s+/g, ' ').trim()

  return { containerHtml, text, anchorId: best.anchorId }
}

function extractScriptPolicyContent(html: string): { text: string; html: string } | null {
  const $ = cheerio.load(html)
  const textChunks: string[] = []

  $('script').each((_i, el) => {
    const content = $(el).text()
    if (!content) return

    // Next.js RSC payload: self.__next_f.push([1,"..."])
    const rscPattern = /self\.__next_f\.push\(\[1,"(.*)"\]\)/g
    let match: RegExpExecArray | null
    while ((match = rscPattern.exec(content)) !== null) {
      const raw = match[1]
      // Unescape the JSON-encoded string
      let unescaped: string
      try {
        unescaped = JSON.parse(`"${raw}"`)
      } catch {
        unescaped = raw.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
      }
      // Extract "children":"<text>" values, skipping React element refs like $L8, $Lc etc.
      const childrenPattern = /"children":"((?:[^"\\]|\\.)*)"/g
      let cm: RegExpExecArray | null
      while ((cm = childrenPattern.exec(unescaped)) !== null) {
        const val = cm[1]
        if (/^\$L[0-9a-f]+$/i.test(val)) continue // React element ref
        if (val.length > 1) textChunks.push(val)
      }
    }

    // __NEXT_DATA__ JSON blob (older Next.js)
    if (content.includes('__NEXT_DATA__')) {
      try {
        const jsonMatch = content.match(/__NEXT_DATA__\s*=\s*({[\s\S]*?})\s*;?\s*$/)
        if (jsonMatch) {
          const extractFromObj = (obj: unknown): void => {
            if (typeof obj === 'string' && obj.length > 20) textChunks.push(obj)
            else if (Array.isArray(obj)) obj.forEach(extractFromObj)
            else if (obj && typeof obj === 'object') Object.values(obj).forEach(extractFromObj)
          }
          extractFromObj(JSON.parse(jsonMatch[1]))
        }
      } catch { /* malformed JSON — skip */ }
    }
  })

  if (textChunks.length === 0) return null

  const combined = textChunks.join(' ').replace(/\s+/g, ' ').trim()
  if (combined.length < MIN_INLINE_POLICY_LENGTH) return null

  const kwMatches = INLINE_PRIVACY_KEYWORDS.reduce(
    (acc, kw) => acc + (kw.test(combined) ? 1 : 0), 0,
  )
  if (kwMatches < MIN_KEYWORD_MATCHES) return null

  return { text: combined, html: `<div data-source="script-payload">${combined}</div>` }
}

function extractText(html: string): string {
  const $ = cheerio.load(html)
  // Remove nav, footer boilerplate, scripts, styles
  $('script, style, nav, header, footer, noscript, iframe').remove()
  return $('body').text().replace(/\s+/g, ' ').trim()
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class CrawlerError extends Error {
  constructor(
    message: string,
    public readonly code: 'FETCH_ERROR' | 'POLICY_NOT_FOUND',
  ) {
    super(message)
    this.name = 'CrawlerError'
  }
}
