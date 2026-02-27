import { Router } from 'express'
import {
  getAllServices,
  getServiceById,
  insertService,
  deleteService,
  getDocumentsForService,
  getLatestDocumentForService,
  getLegalDocumentsForService,
  getLegalChecklistForService,
  getLatestDiscoveryRunForService,
  getResourceHubsForService,
} from '../db/queries.js'
import { fetchAndStorePolicyDocument, CrawlerError } from '../services/crawler.js'
import { enqueueDiscovery } from '../services/legal-discovery.js'

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
  enqueueDiscovery(service.id)
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

// POST /api/services/:id/discover — queue legal-document discovery run
servicesRouter.post('/:id/discover', (req, res) => {
  const service = getServiceById(req.params.id)
  if (!service) {
    res.status(404).json({ error: 'Service not found' })
    return
  }
  enqueueDiscovery(service.id)
  res.status(202).json({ message: 'Legal discovery queued' })
})

// GET /api/services/:id/legal-documents — list all discovered legal docs for a service
servicesRouter.get('/:id/legal-documents', (req, res) => {
  const service = getServiceById(req.params.id)
  if (!service) {
    res.status(404).json({ error: 'Service not found' })
    return
  }

  const legalDocuments = getLegalDocumentsForService(service.id)
  const resourceHubs = getResourceHubsForService(service.id).map((hub) => ({
    ...hub,
    confidence: Number(hub.confidence),
  }))

  res.json({ legalDocuments, resourceHubs })
})

// GET /api/services/:id/checklist — document checklist state for a service
servicesRouter.get('/:id/checklist', (req, res) => {
  const service = getServiceById(req.params.id)
  if (!service) {
    res.status(404).json({ error: 'Service not found' })
    return
  }

  const checklist = getLegalChecklistForService(service.id).map((item) => ({
    ...item,
    required: Boolean(item.required),
    found: Boolean(item.found),
  }))
  res.json(checklist)
})

// GET /api/services/:id/discovery-runs/latest — latest async discovery run status
servicesRouter.get('/:id/discovery-runs/latest', (req, res) => {
  const service = getServiceById(req.params.id)
  if (!service) {
    res.status(404).json({ error: 'Service not found' })
    return
  }

  const run = getLatestDiscoveryRunForService(service.id)
  if (!run) {
    res.status(404).json({ error: 'No discovery run found for this service' })
    return
  }

  res.json({
    ...run,
    stats_json: run.stats_json ? safeJsonParse(run.stats_json) : null,
  })
})

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}
