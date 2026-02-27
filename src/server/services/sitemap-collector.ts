import axios from 'axios'
import * as cheerio from 'cheerio'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  getServiceById,
  getLatestSitemapForService,
  getSitemapPages,
  markSitemapPageCollected,
  markSitemapPagesSelected,
  insertOrUpdateLegalDocument,
  insertPolicyDocument,
  type Service,
} from '../db/queries.js'
import { analyseDocument } from './analyser.js'

const HTTP_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (compatible; PrivacyPolicyDashboard/0.1; +https://github.com/local/privacy-dashboard)',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
}

const LEGAL_DOCS_DIR = path.resolve(process.cwd(), 'data/legal-documents')

export async function getLatestSitemapWithPages(serviceId: string): Promise<{
  sitemap: ReturnType<typeof getLatestSitemapForService>
  pages: ReturnType<typeof getSitemapPages>
}> {
  const sitemap = getLatestSitemapForService(serviceId)
  if (!sitemap) return { sitemap: undefined, pages: [] }
  const pages = getSitemapPages(sitemap.id)
  return { sitemap, pages }
}

export async function collectSelectedSitemapPages(input: {
  serviceId: string
  urls: string[]
  analyse: boolean
}): Promise<{
  collected: number
  analysed: number
  failed: Array<{ url: string; error: string }>
}> {
  const service = getServiceById(input.serviceId)
  if (!service) {
    throw new Error('Service not found')
  }

  const sitemap = getLatestSitemapForService(service.id)
  if (!sitemap) {
    throw new Error('No sitemap available for this service')
  }

  const selectedUrls = [...new Set(input.urls)].filter(Boolean)
  markSitemapPagesSelected(sitemap.id, selectedUrls)

  let collected = 0
  let analysed = 0
  const failed: Array<{ url: string; error: string }> = []

  for (const url of selectedUrls) {
    try {
      const html = await fetchHtml(url)
      const filePath = await storeLegalHtml(service, 'sitemap_selected_page', html)
      const text = extractText(html)
      const contentHash = sha256(text)

      insertOrUpdateLegalDocument({
        serviceId: service.id,
        docType: 'sitemap_selected_page',
        title: deriveTitle(html),
        sourceUrl: sitemap.sitemap_url,
        resolvedUrl: url,
        filePath,
        contentHash,
        discoveryMethod: 'sitemap_manual',
      })

      let wasAnalysed = false
      if (input.analyse) {
        const policyDoc = insertPolicyDocument(service.id, url, filePath, contentHash)
        await analyseDocument(policyDoc.id, service.id)
        wasAnalysed = true
        analysed += 1
      }

      markSitemapPageCollected({ sitemapId: sitemap.id, url, analysed: wasAnalysed })
      collected += 1
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      failed.push({ url, error: message })
      markSitemapPageCollected({ sitemapId: sitemap.id, url, analysed: false, error: message })
    }
  }

  return { collected, analysed, failed }
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

async function storeLegalHtml(service: Service, docType: string, html: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dir = path.join(LEGAL_DOCS_DIR, service.id, docType)
  await mkdir(dir, { recursive: true })
  const filePath = path.join(dir, `${timestamp}.html`)
  await writeFile(filePath, html, 'utf-8')
  return filePath
}

function extractText(html: string): string {
  return cheerio.load(html).text().replace(/\s+/g, ' ').trim()
}

function deriveTitle(html: string): string | undefined {
  const title = cheerio.load(html)('title').first().text().trim()
  return title || undefined
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}
