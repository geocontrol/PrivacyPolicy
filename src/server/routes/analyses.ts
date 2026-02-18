import { Router } from 'express'
import {
  getDocumentById,
  getLatestDocumentForService,
  getLatestAnalysisForDocument,
  getServiceById,
  getEdgesForService,
  getThirdPartyById,
  getAllThirdParties,
} from '../db/queries.js'
import { analyseDocument, AnalyserError } from '../services/analyser.js'

export const analysesRouter = Router()

// POST /api/analyses/documents/:documentId
// Trigger LLM analysis of a specific stored policy document
analysesRouter.post('/documents/:documentId', async (req, res) => {
  const doc = getDocumentById(req.params.documentId)
  if (!doc) {
    res.status(404).json({ error: 'Document not found' })
    return
  }

  try {
    const analysis = await analyseDocument(doc.id, doc.service_id)
    res.status(201).json(analysis)
  } catch (err) {
    if (err instanceof AnalyserError) {
      const status = err.code === 'NOT_FOUND' ? 404
        : err.code === 'CONFIG_ERROR' ? 503
        : 502
      res.status(status).json({ error: err.message, code: err.code })
      return
    }
    console.error('Unexpected analyser error:', err)
    res.status(500).json({ error: 'An unexpected error occurred during analysis' })
  }
})

// POST /api/analyses/services/:serviceId
// Convenience: analyse the latest document for a service
analysesRouter.post('/services/:serviceId', async (req, res) => {
  const service = getServiceById(req.params.serviceId)
  if (!service) {
    res.status(404).json({ error: 'Service not found' })
    return
  }

  const doc = getLatestDocumentForService(service.id)
  if (!doc) {
    res.status(404).json({
      error: 'No policy document found for this service. Run a fetch first.',
    })
    return
  }

  try {
    const analysis = await analyseDocument(doc.id, service.id)
    res.status(201).json(analysis)
  } catch (err) {
    if (err instanceof AnalyserError) {
      const status = err.code === 'NOT_FOUND' ? 404
        : err.code === 'CONFIG_ERROR' ? 503
        : 502
      res.status(status).json({ error: err.message, code: err.code })
      return
    }
    console.error('Unexpected analyser error:', err)
    res.status(500).json({ error: 'An unexpected error occurred during analysis' })
  }
})

// GET /api/analyses/services/:serviceId
// Get the latest analysis for a service (including parsed JSON fields)
analysesRouter.get('/services/:serviceId', (req, res) => {
  const service = getServiceById(req.params.serviceId)
  if (!service) {
    res.status(404).json({ error: 'Service not found' })
    return
  }

  const doc = getLatestDocumentForService(service.id)
  if (!doc) {
    res.status(404).json({ error: 'No policy document found for this service' })
    return
  }

  const analysis = getLatestAnalysisForDocument(doc.id)
  if (!analysis) {
    res.status(404).json({ error: 'No analysis found. Trigger an analysis first.' })
    return
  }

  res.json(parseAnalysisJsonFields(analysis))
})

// GET /api/analyses/services/:serviceId/supply-chain
// Get the full supply chain graph for a service (nodes + edges)
analysesRouter.get('/services/:serviceId/supply-chain', (req, res) => {
  const service = getServiceById(req.params.serviceId)
  if (!service) {
    res.status(404).json({ error: 'Service not found' })
    return
  }

  const edges = getEdgesForService(service.id)
  const thirdPartyIds = [...new Set(edges.map(e => e.to_third_party_id))]
  const thirdParties = thirdPartyIds.map(id => getThirdPartyById(id)).filter(Boolean)

  res.json({
    service: { id: service.id, name: service.name, url: service.url },
    thirdParties,
    edges: edges.map(e => ({
      from: e.from_service_id,
      to: e.to_third_party_id,
      documentId: e.document_id,
      contextSnippet: e.context_snippet,
    })),
  })
})

// GET /api/analyses/third-parties
// List all known third parties across all services
analysesRouter.get('/third-parties', (_req, res) => {
  res.json(getAllThirdParties())
})

// ---------------------------------------------------------------------------
// Helper: parse JSON string columns back into objects for API responses
// ---------------------------------------------------------------------------

function parseAnalysisJsonFields(analysis: object): Record<string, unknown> {
  const jsonFields = ['data_collected', 'purposes', 'legal_bases', 'user_rights', 'contact']
  const result: Record<string, unknown> = { ...analysis }
  for (const field of jsonFields) {
    if (typeof result[field] === 'string') {
      try {
        result[field] = JSON.parse(result[field] as string)
      } catch {
        // leave as string if parse fails
      }
    }
  }
  return result
}
