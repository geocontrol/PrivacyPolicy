import Anthropic from '@anthropic-ai/sdk'
import axios from 'axios'
import * as cheerio from 'cheerio'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createDiscoveryRun,
  getServiceById,
  insertOrUpdateLegalDocument,
  insertServiceSitemap,
  replaceSitemapPages,
  upsertLegalChecklistItem,
  upsertServiceResourceHub,
  updateDiscoveryRunStatus,
  type Service,
} from '../db/queries.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LEGAL_DOCS_DIR = path.resolve(__dirname, '../../../data/legal-documents')

const HTTP_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (compatible; PrivacyPolicyDashboard/0.1; +https://github.com/local/privacy-dashboard)',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
}

const CORE_DOC_TYPES = [
  'privacy_policy',
  'data_policy',
  'security_policy',
  'terms_of_use',
  'terms_and_conditions',
] as const

const REGULATION_DOC_TYPES: Array<{ docType: string; regulation: string; keywords: RegExp[] }> = [
  { docType: 'hipaa_notice', regulation: 'HIPAA', keywords: [/hipaa/i, /health information/i, /phi\b/i] },
  { docType: 'sox_compliance', regulation: 'SOX', keywords: [/\bsox\b/i, /sarbanes[-\s]?oxley/i] },
  { docType: 'gdpr_addendum', regulation: 'GDPR', keywords: [/\bgdpr\b/i, /data processing addendum/i, /dpa\b/i] },
]

const DOC_TYPE_PATTERNS: Record<string, RegExp[]> = {
  privacy_policy: [/privacy\s*policy/i, /privacy\s*notice/i, /data\s*protection/i, /privacy/i],
  data_policy: [/data\s*policy/i, /data\s*usage/i, /data\s*handling/i],
  security_policy: [/security\s*policy/i, /security/i, /trust\s*center/i],
  terms_of_use: [/terms\s*of\s*use/i, /user\s*agreement/i],
  terms_and_conditions: [/terms\s*(and|&)\s*conditions/i, /terms/i, /conditions/i],
  hipaa_notice: [/hipaa/i, /health\s*privacy/i],
  sox_compliance: [/sarbanes[-\s]?oxley/i, /sox/i],
  gdpr_addendum: [/gdpr/i, /data\s*processing\s*addendum/i, /dpa/i],
}

const COMMON_PATHS: Record<string, string[]> = {
  privacy_policy: ['/privacy', '/privacy-policy', '/legal/privacy', '/privacy-notice'],
  data_policy: ['/data-policy', '/legal/data-policy', '/data-protection'],
  security_policy: ['/security', '/security-policy', '/trust', '/trust-center'],
  terms_of_use: ['/terms-of-use', '/legal/terms-of-use', '/user-agreement'],
  terms_and_conditions: ['/terms', '/terms-and-conditions', '/legal/terms'],
  hipaa_notice: ['/hipaa', '/hipaa-notice', '/legal/hipaa'],
  sox_compliance: ['/sox', '/compliance/sox', '/legal/sox'],
  gdpr_addendum: ['/gdpr', '/dpa', '/data-processing-addendum'],
}

type ChecklistItem = {
  docType: string
  required: boolean
  regulationTag?: string
}

type Candidate = {
  url: string
  score: number
  source: 'links' | 'paths' | 'sitemap' | 'targeted'
  label?: string
}

type LlmPlan = {
  candidateDocTypes: string[]
  potentialRegulations: string[]
  candidatePaths: Record<string, string[]>
  hubClues: Array<{ type: string; label: string }>
}

const queue: string[] = []
const inFlight = new Set<string>()
const MAX_CONCURRENT = 2

export function enqueueDiscovery(serviceId: string): void {
  if (queue.includes(serviceId) || inFlight.has(serviceId)) return
  queue.push(serviceId)
  drainQueue()
}

function drainQueue(): void {
  while (inFlight.size < MAX_CONCURRENT && queue.length > 0) {
    const serviceId = queue.shift()!
    inFlight.add(serviceId)

    void runDiscovery(serviceId)
      .catch((err) => {
        console.error('Discovery run failed:', err)
      })
      .finally(() => {
        inFlight.delete(serviceId)
        drainQueue()
      })
  }
}

export async function runDiscovery(serviceId: string): Promise<void> {
  const service = getServiceById(serviceId)
  if (!service) return

  const run = createDiscoveryRun(service.id, 'queued')
  updateDiscoveryRunStatus(run.id, 'running')

  try {
    const baseUrl = normaliseBaseUrl(service.url)
    const homepageHtml = await fetchHtml(baseUrl)
    const homepageText = extractText(homepageHtml)

    const llmPlan = await planDiscoveryWithLlm(baseUrl, homepageText)
    const industrySignals = detectIndustrySignals(homepageText, llmPlan)
    const checklist = buildChecklist(industrySignals, llmPlan)

    const discovery = await discoverDocuments(service, homepageHtml, checklist, llmPlan)

    for (const item of checklist) {
      const foundDoc = discovery.foundDocs.find((d) => d.docType === item.docType)
      upsertLegalChecklistItem({
        serviceId: service.id,
        docType: item.docType,
        required: item.required,
        found: Boolean(foundDoc),
        documentId: foundDoc?.documentId,
        notes: foundDoc ? `Found via ${foundDoc.discoveryMethod}` : 'Not found in latest run',
      })
    }

    for (const hub of discovery.resourceHubs) {
      upsertServiceResourceHub({
        serviceId: service.id,
        hubType: hub.type,
        url: hub.url,
        title: hub.title,
        confidence: hub.confidence,
        notes: hub.notes,
      })
    }

    const requiredMissing = checklist.filter(
      (c) => c.required && !discovery.foundDocs.some((f) => f.docType === c.docType),
    )

    const status = requiredMissing.length > 0 ? 'partial' : 'completed'
    updateDiscoveryRunStatus(run.id, status, {
      statsJson: {
        found: discovery.foundDocs.length,
        missingRequired: requiredMissing.map((m) => m.docType),
        hubs: discovery.resourceHubs.length,
        sitemapStored: discovery.sitemap.stored,
        sitemapUrlCount: discovery.sitemap.count,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    updateDiscoveryRunStatus(run.id, 'failed', { error: message })
  }
}

function buildChecklist(industrySignals: string[], llmPlan: LlmPlan): ChecklistItem[] {
  const base = CORE_DOC_TYPES.map((docType) => ({ docType, required: true }))

  const regulationItems = REGULATION_DOC_TYPES
    .filter((r) => industrySignals.includes(r.regulation) || llmPlan.potentialRegulations.includes(r.regulation))
    .map((r) => ({ docType: r.docType, required: true, regulationTag: r.regulation }))

  return [...base, ...regulationItems]
}

function detectIndustrySignals(homepageText: string, llmPlan: LlmPlan): string[] {
  const signals = new Set<string>()
  const text = homepageText.toLowerCase()

  if (/hipaa|health information|medical|patient|phi\b/i.test(text)) signals.add('HIPAA')
  if (/sarbanes|sox|public company|financial reporting/i.test(text)) signals.add('SOX')
  if (/gdpr|eea|eu resident|data processing addendum|dpa/i.test(text)) signals.add('GDPR')

  for (const r of llmPlan.potentialRegulations) {
    signals.add(r)
  }

  return [...signals]
}

async function discoverDocuments(
  service: Service,
  homepageHtml: string,
  checklist: ChecklistItem[],
  llmPlan: LlmPlan,
): Promise<{
  foundDocs: Array<{ docType: string; documentId: string; discoveryMethod: string }>
  resourceHubs: Array<{ type: string; url: string; title?: string; confidence: number; notes?: string }>
  sitemap: { stored: boolean; count: number }
}> {
  const baseUrl = normaliseBaseUrl(service.url)
  const candidates = new Map<string, Candidate[]>()

  for (const item of checklist) {
    candidates.set(item.docType, [])
  }

  const linkCandidates = findCandidatesInLinks(homepageHtml, baseUrl)
  for (const item of checklist) {
    const patterns = DOC_TYPE_PATTERNS[item.docType] ?? []
    for (const c of linkCandidates) {
      if (patterns.some((p) => p.test(c.label || c.url))) {
        candidates.get(item.docType)!.push({ ...c, source: 'links' })
      }
    }
  }

  const hubCandidates = detectResourceHubs(homepageHtml, baseUrl)

  for (const item of checklist) {
    const paths = [
      ...(COMMON_PATHS[item.docType] ?? []),
      ...(llmPlan.candidatePaths[item.docType] ?? []),
    ]

    for (const p of paths) {
      const url = buildAbsoluteUrl(baseUrl, p)
      if (!url) continue
      const exists = await quickHeadExists(url)
      if (exists) {
        candidates.get(item.docType)!.push({ url, score: 2, source: 'paths', label: p })
      }
    }
  }

  const sitemapResult = await parseSitemapUrls(service, baseUrl)
  const sitemapUrls = sitemapResult.urls
  for (const item of checklist) {
    const patterns = DOC_TYPE_PATTERNS[item.docType] ?? []
    for (const url of sitemapUrls) {
      if (patterns.some((p) => p.test(url))) {
        candidates.get(item.docType)!.push({ url, score: 1, source: 'sitemap', label: url })
      }
    }
  }

  const foundDocs: Array<{ docType: string; documentId: string; discoveryMethod: string }> = []

  for (const item of checklist) {
    const ranked = (candidates.get(item.docType) || [])
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)

    let persisted: { id: string; method: string } | null = null

    for (const candidate of ranked) {
      persisted = await tryFetchAndStoreLegalDoc(service, item, candidate.url, candidate.source)
      if (persisted) break
    }

    if (!persisted) {
      // Stage C targeted: inspect homepage and linked pages quickly for a better fit.
      const fallback = await targetedDiscovery(service, item.docType, linkCandidates.map((c) => c.url))
      if (fallback) persisted = fallback
    }

    if (persisted) {
      foundDocs.push({
        docType: item.docType,
        documentId: persisted.id,
        discoveryMethod: persisted.method,
      })
    }
  }

  return {
    foundDocs,
    resourceHubs: hubCandidates,
    sitemap: { stored: sitemapResult.stored, count: sitemapUrls.length },
  }
}

async function targetedDiscovery(
  service: Service,
  docType: string,
  urls: string[],
): Promise<{ id: string; method: string } | null> {
  const patterns = DOC_TYPE_PATTERNS[docType] ?? []
  for (const url of urls.slice(0, 8)) {
    try {
      const html = await fetchHtml(url)
      const text = extractText(html)
      if (!patterns.some((p) => p.test(text) || p.test(url))) continue

      const stored = await persistLegalDocument({
        service,
        docType,
        title: deriveTitle(html),
        sourceUrl: service.url,
        resolvedUrl: url,
        html,
        discoveryMethod: 'targeted',
        isRegulationSpecific: REGULATION_DOC_TYPES.some((r) => r.docType === docType),
        regulationTag: REGULATION_DOC_TYPES.find((r) => r.docType === docType)?.regulation,
      })

      return { id: stored.id, method: 'targeted' }
    } catch {
      // best effort
    }
  }

  return null
}

async function tryFetchAndStoreLegalDoc(
  service: Service,
  checklist: ChecklistItem,
  url: string,
  method: string,
): Promise<{ id: string; method: string } | null> {
  try {
    const html = await fetchHtml(url)
    const text = extractText(html)
    if (text.length < 120) return null

    const patterns = DOC_TYPE_PATTERNS[checklist.docType] ?? []
    const matched = patterns.some((p) => p.test(text) || p.test(url))
    if (!matched) return null

    const saved = await persistLegalDocument({
      service,
      docType: checklist.docType,
      title: deriveTitle(html),
      sourceUrl: service.url,
      resolvedUrl: url,
      html,
      discoveryMethod: method,
      isRegulationSpecific: Boolean(checklist.regulationTag),
      regulationTag: checklist.regulationTag,
    })

    return { id: saved.id, method }
  } catch {
    return null
  }
}

async function persistLegalDocument(input: {
  service: Service
  docType: string
  title?: string
  sourceUrl: string
  resolvedUrl: string
  html: string
  discoveryMethod: string
  isRegulationSpecific?: boolean
  regulationTag?: string
}) {
  const text = extractText(input.html)
  const contentHash = sha256(text)

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.join(LEGAL_DOCS_DIR, input.service.id, input.docType)
  await mkdir(dir, { recursive: true })

  const filePath = path.join(dir, `${timestamp}.html`)
  await writeFile(filePath, input.html, 'utf-8')

  return insertOrUpdateLegalDocument({
    serviceId: input.service.id,
    docType: input.docType,
    title: input.title,
    sourceUrl: input.sourceUrl,
    resolvedUrl: input.resolvedUrl,
    filePath,
    contentHash,
    discoveryMethod: input.discoveryMethod,
    isRegulationSpecific: input.isRegulationSpecific,
    regulationTag: input.regulationTag,
  })
}

async function planDiscoveryWithLlm(baseUrl: string, homepageText: string): Promise<LlmPlan> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || apiKey === 'your_api_key_here') {
    return fallbackPlan()
  }

  try {
    const client = new Anthropic({ apiKey })
    const prompt = `You are a legal-document discovery planner.
Return ONLY valid JSON with this shape:
{
  "candidateDocTypes": ["privacy_policy"],
  "potentialRegulations": ["HIPAA"],
  "candidatePaths": {"privacy_policy": ["/privacy"]},
  "hubClues": [{"type": "privacy_center", "label": "Privacy Center"}]
}
Only use these doc types: privacy_policy, data_policy, security_policy, terms_of_use, terms_and_conditions, hipaa_notice, sox_compliance, gdpr_addendum.

Site: ${baseUrl}
Homepage snippet:
${homepageText.slice(0, 4000)}
`.trim()

    const message = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1200,
      messages: [{ role: 'user', content: prompt }],
    })

    const block = message.content[0]
    if (block.type !== 'text') return fallbackPlan()
    return parsePlannerJson(block.text)
  } catch {
    return fallbackPlan()
  }
}

function parsePlannerJson(raw: string): LlmPlan {
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(cleaned) as Record<string, unknown>

    const candidateDocTypes = Array.isArray(parsed.candidateDocTypes)
      ? parsed.candidateDocTypes.filter((d): d is string => typeof d === 'string')
      : []

    const potentialRegulations = Array.isArray(parsed.potentialRegulations)
      ? parsed.potentialRegulations
        .filter((r): r is string => typeof r === 'string')
        .map((r) => r.toUpperCase())
      : []

    const candidatePathsRaw = typeof parsed.candidatePaths === 'object' && parsed.candidatePaths !== null
      ? parsed.candidatePaths as Record<string, unknown>
      : {}

    const candidatePaths: Record<string, string[]> = {}
    for (const [key, val] of Object.entries(candidatePathsRaw)) {
      if (!Array.isArray(val)) continue
      candidatePaths[key] = val.filter((v): v is string => typeof v === 'string')
    }

    const hubClues = Array.isArray(parsed.hubClues)
      ? parsed.hubClues.flatMap((h): Array<{ type: string; label: string }> => {
        if (typeof h !== 'object' || h === null) return []
        const obj = h as Record<string, unknown>
        if (typeof obj.type !== 'string' || typeof obj.label !== 'string') return []
        return [{ type: obj.type, label: obj.label }]
      })
      : []

    return {
      candidateDocTypes,
      potentialRegulations,
      candidatePaths,
      hubClues,
    }
  } catch {
    return fallbackPlan()
  }
}

function fallbackPlan(): LlmPlan {
  return {
    candidateDocTypes: [...CORE_DOC_TYPES],
    potentialRegulations: [],
    candidatePaths: {},
    hubClues: [{ type: 'privacy_center', label: 'Privacy Center' }],
  }
}

function findCandidatesInLinks(html: string, baseUrl: string): Candidate[] {
  const $ = cheerio.load(html)
  const out: Candidate[] = []

  $('a[href]').each((_idx, el) => {
    const href = ($(el).attr('href') || '').trim()
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return
    const label = ($(el).text() || '').trim()

    try {
      const absolute = new URL(href, baseUrl).href
      const score = /(privacy|terms|security|data|compliance|hipaa|sox|gdpr)/i.test(`${label} ${absolute}`)
        ? 2
        : 1
      out.push({ url: absolute, label, score, source: 'links' })
    } catch {
      // skip malformed links
    }
  })

  return dedupeCandidates(out)
}

function detectResourceHubs(
  html: string,
  baseUrl: string,
): Array<{ type: string; url: string; title?: string; confidence: number; notes?: string }> {
  const $ = cheerio.load(html)
  const hubs: Array<{ type: string; url: string; title?: string; confidence: number; notes?: string }> = []

  $('a[href]').each((_idx, el) => {
    const href = ($(el).attr('href') || '').trim()
    const text = ($(el).text() || '').trim()
    if (!href) return

    const combined = `${href} ${text}`
    const isPrivacyCenter = /(privacy\s*center|privacy\s*choices|privacy\s*hub)/i.test(combined)
    const isSecurityCenter = /(security\s*center|trust\s*center)/i.test(combined)
    if (!isPrivacyCenter && !isSecurityCenter) return

    try {
      const url = new URL(href, baseUrl).href
      hubs.push({
        type: isPrivacyCenter ? 'privacy_center' : 'security_center',
        url,
        title: text || undefined,
        confidence: 0.8,
        notes: 'Detected from homepage navigation',
      })
    } catch {
      // ignore invalid urls
    }
  })

  return hubs
}

async function parseSitemapUrls(
  service: Service,
  baseUrl: string,
): Promise<{ urls: string[]; stored: boolean }> {
  const urls = [
    `${baseUrl}/sitemap.xml`,
    `${baseUrl}/sitemap_index.xml`,
  ]

  const discovered = new Set<string>()
  let firstSitemapUrl: string | null = null
  let firstSitemapXml = ''

  for (const url of urls) {
    try {
      const response = await axios.get<string>(url, { headers: HTTP_HEADERS, timeout: 8000 })
      const xml = response.data
      if (!firstSitemapUrl) {
        firstSitemapUrl = url
        firstSitemapXml = xml
      }
      const locs = xml.match(/<loc>(.*?)<\/loc>/g) || []
      for (const loc of locs) {
        const match = loc.match(/<loc>(.*?)<\/loc>/)
        if (match?.[1]) discovered.add(match[1])
      }
    } catch {
      // sitemap optional
    }
  }

  const parsedUrls = [...discovered]

  if (!firstSitemapUrl || !firstSitemapXml) {
    return { urls: parsedUrls, stored: false }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.resolve(__dirname, '../../../data/sitemaps', service.id)
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, `${timestamp}.xml`)
  await writeFile(filePath, firstSitemapXml, 'utf-8')

  const sitemap = insertServiceSitemap({
    serviceId: service.id,
    sitemapUrl: firstSitemapUrl,
    filePath,
    pageCount: parsedUrls.length,
    status: 'retrieved',
    message: parsedUrls.length > 0
      ? `Sitemap parsed with ${parsedUrls.length} URLs`
      : 'Sitemap fetched but no URLs matched',
  })
  replaceSitemapPages(sitemap.id, parsedUrls)

  return { urls: parsedUrls, stored: true }
}

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const map = new Map<string, Candidate>()
  for (const c of candidates) {
    const existing = map.get(c.url)
    if (!existing || c.score > existing.score) {
      map.set(c.url, c)
    }
  }
  return [...map.values()]
}

function buildAbsoluteUrl(baseUrl: string, candidatePath: string): string | null {
  try {
    return new URL(candidatePath, baseUrl).href
  } catch {
    return null
  }
}

async function quickHeadExists(url: string): Promise<boolean> {
  try {
    const res = await axios.head(url, {
      headers: HTTP_HEADERS,
      timeout: 8000,
      maxRedirects: 5,
      validateStatus: () => true,
    })
    return res.status >= 200 && res.status < 400
  } catch {
    return false
  }
}

async function fetchHtml(url: string): Promise<string> {
  const response = await axios.get<string>(url, {
    headers: HTTP_HEADERS,
    timeout: 15000,
    maxRedirects: 5,
    responseType: 'text',
  })
  return response.data
}

function extractText(html: string): string {
  return cheerio.load(html).text().replace(/\s+/g, ' ').trim()
}

function deriveTitle(html: string): string | undefined {
  const $ = cheerio.load(html)
  const title = $('title').first().text().trim()
  return title || undefined
}

function normaliseBaseUrl(url: string): string {
  const withProtocol = url.startsWith('http') ? url : `https://${url}`
  const parsed = new URL(withProtocol)
  return parsed.origin
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}
