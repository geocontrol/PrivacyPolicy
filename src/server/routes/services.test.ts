import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import type { MockedFunction } from 'vitest'
import express from 'express'
import supertest from 'supertest'
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
import { fetchAndStorePolicyDocument } from '../services/crawler.js'
import { servicesRouter } from './services.js'
import { makeService, makePolicyDocument } from '../../../tests/fixtures/index.js'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../db/queries.js', () => ({
  getAllServices: vi.fn(),
  getServiceById: vi.fn(),
  insertService: vi.fn(),
  deleteService: vi.fn(),
  getDocumentsForService: vi.fn(),
  getLatestDocumentForService: vi.fn(),
  getLegalDocumentsForService: vi.fn(),
  getLegalChecklistForService: vi.fn(),
  getLatestDiscoveryRunForService: vi.fn(),
  getResourceHubsForService: vi.fn(),
  createDiscoveryRun: vi.fn(),
  updateDiscoveryRunStatus: vi.fn(),
  insertOrUpdateLegalDocument: vi.fn(),
  upsertLegalChecklistItem: vi.fn(),
  upsertServiceResourceHub: vi.fn(),
}))

// Re-create CrawlerError in the mock so instanceof checks in the route work
vi.mock('../services/crawler.js', () => {
  class CrawlerError extends Error {
    code: string
    constructor(message: string, code: string) {
      super(message)
      this.name = 'CrawlerError'
      this.code = code
    }
  }
  return {
    fetchAndStorePolicyDocument: vi.fn(),
    CrawlerError,
  }
})

vi.mock('../services/legal-discovery.js', () => ({
  enqueueDiscovery: vi.fn(),
}))

const mockedGetAllServices = getAllServices as MockedFunction<typeof getAllServices>
const mockedGetServiceById = getServiceById as MockedFunction<typeof getServiceById>
const mockedInsertService = insertService as MockedFunction<typeof insertService>
const mockedDeleteService = deleteService as MockedFunction<typeof deleteService>
const mockedGetDocumentsForService = getDocumentsForService as MockedFunction<typeof getDocumentsForService>
const mockedGetLatestDocumentForService = getLatestDocumentForService as MockedFunction<typeof getLatestDocumentForService>
const mockedGetLegalDocumentsForService = getLegalDocumentsForService as MockedFunction<typeof getLegalDocumentsForService>
const mockedGetLegalChecklistForService = getLegalChecklistForService as MockedFunction<typeof getLegalChecklistForService>
const mockedGetLatestDiscoveryRunForService = getLatestDiscoveryRunForService as MockedFunction<typeof getLatestDiscoveryRunForService>
const mockedGetResourceHubsForService = getResourceHubsForService as MockedFunction<typeof getResourceHubsForService>
const mockedFetchAndStore = fetchAndStorePolicyDocument as MockedFunction<typeof fetchAndStorePolicyDocument>

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

let app: express.Express

beforeAll(() => {
  app = express()
  app.use(express.json())
  app.use('/', servicesRouter)
})

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// GET /
// ---------------------------------------------------------------------------

describe('GET /', () => {
  it('returns 200 with an array of services', async () => {
    mockedGetAllServices.mockReturnValue([makeService()])
    const res = await supertest(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].name).toBe('Test Service')
  })

  it('returns 200 with an empty array when no services exist', async () => {
    mockedGetAllServices.mockReturnValue([])
    const res = await supertest(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// GET /:id
// ---------------------------------------------------------------------------

describe('GET /:id', () => {
  it('returns 200 with the service and latestDocument when both exist', async () => {
    const svc = makeService()
    const doc = makePolicyDocument()
    mockedGetServiceById.mockReturnValue(svc)
    mockedGetLatestDocumentForService.mockReturnValue(doc)

    const res = await supertest(app).get('/svc-test-id-001')
    expect(res.status).toBe(200)
    expect(res.body.id).toBe(svc.id)
    expect(res.body.latestDocument.id).toBe(doc.id)
  })

  it('returns latestDocument: null when the service has no documents', async () => {
    mockedGetServiceById.mockReturnValue(makeService())
    mockedGetLatestDocumentForService.mockReturnValue(undefined)

    const res = await supertest(app).get('/svc-test-id-001')
    expect(res.status).toBe(200)
    expect(res.body.latestDocument).toBeNull()
  })

  it('returns 404 when the service is not found', async () => {
    mockedGetServiceById.mockReturnValue(undefined)
    const res = await supertest(app).get('/nonexistent-id')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Service not found')
  })
})

// ---------------------------------------------------------------------------
// POST /
// ---------------------------------------------------------------------------

describe('POST /', () => {
  it('returns 201 with the created service on valid input', async () => {
    const svc = makeService()
    mockedInsertService.mockReturnValue(svc)

    const res = await supertest(app)
      .post('/')
      .send({ name: 'Test Service', url: 'https://example.com', category: 'Technology' })

    expect(res.status).toBe(201)
    expect(res.body.id).toBe(svc.id)
  })

  it('returns 400 when name is missing', async () => {
    const res = await supertest(app).post('/').send({ url: 'https://example.com' })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('name')
  })

  it('returns 400 when url is missing', async () => {
    const res = await supertest(app).post('/').send({ name: 'Test' })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('url')
  })

  it('returns 400 when url is not a valid URL', async () => {
    const res = await supertest(app)
      .post('/')
      .send({ name: 'Test', url: 'not-a-url-@@##!!' })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('valid URL')
  })

  it('accepts a URL without a protocol prefix', async () => {
    mockedInsertService.mockReturnValue(makeService())
    const res = await supertest(app).post('/').send({ name: 'Test', url: 'example.com' })
    expect(res.status).toBe(201)
  })

  it('passes name, url and category to insertService', async () => {
    mockedInsertService.mockReturnValue(makeService())
    await supertest(app)
      .post('/')
      .send({ name: 'Svc', url: 'https://svc.com', category: 'fintech' })
    expect(mockedInsertService).toHaveBeenCalledWith('Svc', 'https://svc.com', 'fintech')
  })

  it('passes undefined for category when omitted', async () => {
    mockedInsertService.mockReturnValue(makeService())
    await supertest(app).post('/').send({ name: 'Svc', url: 'https://svc.com' })
    expect(mockedInsertService).toHaveBeenCalledWith('Svc', 'https://svc.com', undefined)
  })
})

// ---------------------------------------------------------------------------
// DELETE /:id
// ---------------------------------------------------------------------------

describe('DELETE /:id', () => {
  it('returns 204 and calls deleteService when the service exists', async () => {
    mockedGetServiceById.mockReturnValue(makeService())
    const res = await supertest(app).delete('/svc-test-id-001')
    expect(res.status).toBe(204)
    expect(mockedDeleteService).toHaveBeenCalledWith('svc-test-id-001')
  })

  it('returns 404 and does not call deleteService when service does not exist', async () => {
    mockedGetServiceById.mockReturnValue(undefined)
    const res = await supertest(app).delete('/nonexistent')
    expect(res.status).toBe(404)
    expect(mockedDeleteService).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// GET /:id/documents
// ---------------------------------------------------------------------------

describe('GET /:id/documents', () => {
  it('returns 200 with the document list when service exists', async () => {
    mockedGetServiceById.mockReturnValue(makeService())
    mockedGetDocumentsForService.mockReturnValue([makePolicyDocument()])

    const res = await supertest(app).get('/svc-test-id-001/documents')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
  })

  it('returns 200 with empty array when service has no documents', async () => {
    mockedGetServiceById.mockReturnValue(makeService())
    mockedGetDocumentsForService.mockReturnValue([])

    const res = await supertest(app).get('/svc-test-id-001/documents')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns 404 when the service is not found', async () => {
    mockedGetServiceById.mockReturnValue(undefined)
    const res = await supertest(app).get('/nonexistent/documents')
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// POST /:id/fetch
// ---------------------------------------------------------------------------

describe('POST /:id/fetch', () => {
  it('returns 201 with documentId and resolvedUrl on success', async () => {
    mockedGetServiceById.mockReturnValue(makeService())
    mockedFetchAndStore.mockResolvedValue({
      documentId: 'doc-001',
      resolvedUrl: 'https://example.com/privacy-policy',
      isNew: true,
    })

    const res = await supertest(app).post('/svc-test-id-001/fetch')
    expect(res.status).toBe(201)
    expect(res.body.documentId).toBe('doc-001')
    expect(res.body.resolvedUrl).toBe('https://example.com/privacy-policy')
    expect(res.body.message).toBeTruthy()
  })

  it('returns 404 when the service is not found', async () => {
    mockedGetServiceById.mockReturnValue(undefined)
    const res = await supertest(app).post('/nonexistent/fetch')
    expect(res.status).toBe(404)
    expect(mockedFetchAndStore).not.toHaveBeenCalled()
  })

  it('returns 404 on CrawlerError with code POLICY_NOT_FOUND', async () => {
    mockedGetServiceById.mockReturnValue(makeService())
    const { CrawlerError } = await import('../services/crawler.js')
    mockedFetchAndStore.mockRejectedValue(
      new CrawlerError('Could not locate privacy policy', 'POLICY_NOT_FOUND'),
    )
    const res = await supertest(app).post('/svc-test-id-001/fetch')
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('POLICY_NOT_FOUND')
  })

  it('returns 502 on CrawlerError with code FETCH_ERROR', async () => {
    mockedGetServiceById.mockReturnValue(makeService())
    const { CrawlerError } = await import('../services/crawler.js')
    mockedFetchAndStore.mockRejectedValue(
      new CrawlerError('Failed to fetch page', 'FETCH_ERROR'),
    )
    const res = await supertest(app).post('/svc-test-id-001/fetch')
    expect(res.status).toBe(502)
    expect(res.body.code).toBe('FETCH_ERROR')
  })

  it('returns 500 for unexpected non-CrawlerError exceptions', async () => {
    mockedGetServiceById.mockReturnValue(makeService())
    mockedFetchAndStore.mockRejectedValue(new Error('Unexpected crash'))
    const res = await supertest(app).post('/svc-test-id-001/fetch')
    expect(res.status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// POST /:id/discover
// ---------------------------------------------------------------------------

describe('POST /:id/discover', () => {
  it('returns 202 when service exists', async () => {
    mockedGetServiceById.mockReturnValue(makeService())
    const res = await supertest(app).post('/svc-test-id-001/discover')
    expect(res.status).toBe(202)
    expect(res.body.message).toContain('queued')
  })

  it('returns 404 when service does not exist', async () => {
    mockedGetServiceById.mockReturnValue(undefined)
    const res = await supertest(app).post('/missing/discover')
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// GET /:id/legal-documents
// ---------------------------------------------------------------------------

describe('GET /:id/legal-documents', () => {
  it('returns legal documents and resource hubs', async () => {
    mockedGetServiceById.mockReturnValue(makeService())
    mockedGetLegalDocumentsForService.mockReturnValue([{
      id: 'ld-1',
      service_id: 'svc-test-id-001',
      doc_type: 'privacy_policy',
      title: 'Privacy Policy',
      source_url: 'https://example.com',
      resolved_url: 'https://example.com/privacy',
      file_path: '/tmp/privacy.html',
      content_hash: 'hash',
      retrieved_at: '2024-01-01 00:00:00',
      status: 'retrieved',
      discovery_method: 'links',
      is_regulation_specific: 0,
      regulation_tag: null,
    }])
    mockedGetResourceHubsForService.mockReturnValue([{
      id: 'hub-1',
      service_id: 'svc-test-id-001',
      hub_type: 'privacy_center',
      url: 'https://example.com/privacy-center',
      title: 'Privacy Center',
      confidence: 0.8,
      notes: null,
      detected_at: '2024-01-01 00:00:00',
    }])

    const res = await supertest(app).get('/svc-test-id-001/legal-documents')
    expect(res.status).toBe(200)
    expect(res.body.legalDocuments).toHaveLength(1)
    expect(res.body.resourceHubs).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// GET /:id/checklist
// ---------------------------------------------------------------------------

describe('GET /:id/checklist', () => {
  it('returns checklist with boolean fields', async () => {
    mockedGetServiceById.mockReturnValue(makeService())
    mockedGetLegalChecklistForService.mockReturnValue([{
      id: 'chk-1',
      service_id: 'svc-test-id-001',
      doc_type: 'privacy_policy',
      required: 1,
      found: 0,
      document_id: null,
      notes: 'not found yet',
      updated_at: '2024-01-01 00:00:00',
    }])

    const res = await supertest(app).get('/svc-test-id-001/checklist')
    expect(res.status).toBe(200)
    expect(res.body[0].required).toBe(true)
    expect(res.body[0].found).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// GET /:id/discovery-runs/latest
// ---------------------------------------------------------------------------

describe('GET /:id/discovery-runs/latest', () => {
  it('returns 404 when no run exists', async () => {
    mockedGetServiceById.mockReturnValue(makeService())
    mockedGetLatestDiscoveryRunForService.mockReturnValue(undefined)
    const res = await supertest(app).get('/svc-test-id-001/discovery-runs/latest')
    expect(res.status).toBe(404)
  })

  it('returns latest run when present', async () => {
    mockedGetServiceById.mockReturnValue(makeService())
    mockedGetLatestDiscoveryRunForService.mockReturnValue({
      id: 'run-1',
      service_id: 'svc-test-id-001',
      status: 'partial',
      started_at: '2024-01-01 00:00:00',
      finished_at: '2024-01-01 00:05:00',
      error: null,
      stats_json: '{"found":2}',
    })

    const res = await supertest(app).get('/svc-test-id-001/discovery-runs/latest')
    expect(res.status).toBe(200)
    expect(res.body.id).toBe('run-1')
    expect(res.body.stats_json.found).toBe(2)
  })
})
