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
  const policyUrl = findPolicyLink(homepageHtml, base) ?? await tryCommonPaths(base)

  if (!policyUrl) {
    throw new CrawlerError(
      `Could not locate a privacy policy page for ${base}. ` +
      'Try providing the direct URL to the policy page.',
      'POLICY_NOT_FOUND',
    )
  }

  // Step 2: fetch the actual policy page
  const policyHtml = await fetchHtml(policyUrl)
  const text = extractText(policyHtml)
  const contentHash = sha256(text)

  return { resolvedUrl: policyUrl, html: policyHtml, text, contentHash }
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
