import { Router } from 'express'
import {
  findServiceByNormalizedDomain,
  insertService,
} from '../db/queries.js'
import { fetchAndStorePolicyDocument, CrawlerError } from '../services/crawler.js'
import { analyseDocument, AnalyserError } from '../services/analyser.js'
import { enqueueDiscovery } from '../services/legal-discovery.js'

export const extensionRouter = Router()

interface SignupBody {
  url?: string
  name?: string
  category?: string
}

extensionRouter.post('/signup', async (req, res) => {
  const expectedToken = process.env.EXTENSION_API_TOKEN
  const providedToken = req.header('x-extension-token')

  if (!expectedToken || !providedToken || providedToken !== expectedToken) {
    res.status(401).json({ error: 'Unauthorized extension request' })
    return
  }

  const { url, name, category } = req.body as SignupBody
  if (!url) {
    res.status(400).json({ error: 'url is required' })
    return
  }

  const normalizedDomain = normaliseDomain(url)
  if (!normalizedDomain) {
    res.status(400).json({ error: 'url is not a valid URL' })
    return
  }

  let service = findServiceByNormalizedDomain(normalizedDomain)
  const created = !service

  if (!service) {
    service = insertService(name?.trim() || normalizedDomain, normalizedDomain, category)
  }

  enqueueDiscovery(service.id)

  try {
    const fetchResult = await fetchAndStorePolicyDocument(service.id, service.url)
    const analysis = await analyseDocument(fetchResult.documentId, service.id)

    res.status(created ? 201 : 200).json({
      service,
      created,
      fetch: {
        documentId: fetchResult.documentId,
        resolvedUrl: fetchResult.resolvedUrl,
      },
      analysis: {
        id: analysis.id,
        analysed_at: analysis.analysed_at,
      },
      message: created
        ? 'Service added and processing complete'
        : 'Service already exists; processing complete',
    })
  } catch (err) {
    if (err instanceof CrawlerError) {
      const status = err.code === 'POLICY_NOT_FOUND' ? 404 : 502
      res.status(status).json({ error: err.message, code: err.code })
      return
    }

    if (err instanceof AnalyserError) {
      const status = err.code === 'CONFIG_ERROR' ? 503 : 502
      res.status(status).json({ error: err.message, code: err.code })
      return
    }

    console.error('Unexpected extension integration error:', err)
    res.status(500).json({ error: 'An unexpected error occurred during extension signup processing' })
  }
})

function normaliseDomain(input: string): string | null {
  try {
    const withProtocol = input.startsWith('http') ? input : `https://${input}`
    const parsed = new URL(withProtocol)
    const hostname = parsed.hostname.trim().toLowerCase().replace(/^www\./, '')
    return hostname || null
  } catch {
    return null
  }
}
