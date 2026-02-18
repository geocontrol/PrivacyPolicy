import { Router } from 'express'
import {
  getAllServices,
  getServiceById,
  insertService,
  deleteService,
  getDocumentsForService,
  getLatestDocumentForService,
} from '../db/queries.js'
import { fetchAndStorePolicyDocument, CrawlerError } from '../services/crawler.js'

export const servicesRouter = Router()

// GET /api/services — list all registered services
servicesRouter.get('/', (_req, res) => {
  const services = getAllServices()
  res.json(services)
})

// GET /api/services/:id — get a single service with its latest document status
servicesRouter.get('/:id', (req, res) => {
  const service = getServiceById(req.params.id)
  if (!service) {
    res.status(404).json({ error: 'Service not found' })
    return
  }
  const latestDocument = getLatestDocumentForService(service.id) ?? null
  res.json({ ...service, latestDocument })
})

// POST /api/services — register a new service
servicesRouter.post('/', (req, res) => {
  const { name, url, category } = req.body as {
    name?: string
    url?: string
    category?: string
  }

  if (!name || !url) {
    res.status(400).json({ error: 'name and url are required' })
    return
  }

  try {
    new URL(url.startsWith('http') ? url : `https://${url}`)
  } catch {
    res.status(400).json({ error: 'url is not a valid URL' })
    return
  }

  const service = insertService(name, url, category)
  res.status(201).json(service)
})

// DELETE /api/services/:id — remove a service and all its documents
servicesRouter.delete('/:id', (req, res) => {
  const service = getServiceById(req.params.id)
  if (!service) {
    res.status(404).json({ error: 'Service not found' })
    return
  }
  deleteService(req.params.id)
  res.status(204).send()
})

// GET /api/services/:id/documents — list all policy document versions
servicesRouter.get('/:id/documents', (req, res) => {
  const service = getServiceById(req.params.id)
  if (!service) {
    res.status(404).json({ error: 'Service not found' })
    return
  }
  const documents = getDocumentsForService(req.params.id)
  res.json(documents)
})

// POST /api/services/:id/fetch — trigger a policy fetch for this service
servicesRouter.post('/:id/fetch', async (req, res) => {
  const service = getServiceById(req.params.id)
  if (!service) {
    res.status(404).json({ error: 'Service not found' })
    return
  }

  try {
    const result = await fetchAndStorePolicyDocument(service.id, service.url)
    res.status(201).json({
      documentId: result.documentId,
      resolvedUrl: result.resolvedUrl,
      message: 'Policy document retrieved and stored successfully',
    })
  } catch (err) {
    if (err instanceof CrawlerError) {
      const status = err.code === 'POLICY_NOT_FOUND' ? 404 : 502
      res.status(status).json({ error: err.message, code: err.code })
      return
    }
    console.error('Unexpected crawler error:', err)
    res.status(500).json({ error: 'An unexpected error occurred during policy retrieval' })
  }
})
