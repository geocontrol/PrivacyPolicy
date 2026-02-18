import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import type { MockedFunction } from 'vitest'
import express from 'express'
import supertest from 'supertest'
import {
  getDocumentById,
  getServiceById,
  getLatestDocumentForService,
  getLatestAnalysisForDocument,
  getEdgesForService,
  getThirdPartyById,
  getAllThirdParties,
} from '../db/queries.js'
import { analyseDocument } from '../services/analyser.js'
import { analysesRouter } from './analyses.js'
import {
  makeService,
  makePolicyDocument,
  makePolicyAnalysis,
  makeThirdParty,
  makeSupplyChainEdge,
} from '../../../tests/fixtures/index.js'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../db/queries.js', () => ({
  getDocumentById: vi.fn(),
  getServiceById: vi.fn(),
  getLatestDocumentForService: vi.fn(),
  getLatestAnalysisForDocument: vi.fn(),
  getEdgesForService: vi.fn(),
  getThirdPartyById: vi.fn(),
  getAllThirdParties: vi.fn(),
}))

// Re-create AnalyserError in the mock so instanceof checks in the route work
vi.mock('../services/analyser.js', () => {
  class AnalyserError extends Error {
    code: string
    constructor(message: string, code: string) {
      super(message)
      this.name = 'AnalyserError'
      this.code = code
    }
  }
  return {
    analyseDocument: vi.fn(),
    AnalyserError,
  }
})

const mockedGetDocumentById = getDocumentById as MockedFunction<typeof getDocumentById>
const mockedGetServiceById = getServiceById as MockedFunction<typeof getServiceById>
const mockedGetLatestDocumentForService = getLatestDocumentForService as MockedFunction<typeof getLatestDocumentForService>
const mockedGetLatestAnalysisForDocument = getLatestAnalysisForDocument as MockedFunction<typeof getLatestAnalysisForDocument>
const mockedGetEdgesForService = getEdgesForService as MockedFunction<typeof getEdgesForService>
const mockedGetThirdPartyById = getThirdPartyById as MockedFunction<typeof getThirdPartyById>
const mockedGetAllThirdParties = getAllThirdParties as MockedFunction<typeof getAllThirdParties>
const mockedAnalyseDocument = analyseDocument as MockedFunction<typeof analyseDocument>

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

let app: express.Express

beforeAll(() => {
  app = express()
  app.use(express.json())
  app.use('/', analysesRouter)
})

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// POST /documents/:documentId
// ---------------------------------------------------------------------------

describe('POST /documents/:documentId', () => {
  it('returns 201 with the analysis on success', async () => {
    mockedGetDocumentById.mockReturnValue(makePolicyDocument())
    mockedAnalyseDocument.mockResolvedValue(makePolicyAnalysis())

    const res = await supertest(app).post('/documents/doc-001')
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(makePolicyAnalysis().id)
  })

  it('returns 404 when the document does not exist in the DB', async () => {
    mockedGetDocumentById.mockReturnValue(undefined)
    const res = await supertest(app).post('/documents/missing-doc')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Document not found')
    expect(mockedAnalyseDocument).not.toHaveBeenCalled()
  })

  it('returns 404 on AnalyserError with code NOT_FOUND', async () => {
    mockedGetDocumentById.mockReturnValue(makePolicyDocument())
    const { AnalyserError } = await import('../services/analyser.js')
    mockedAnalyseDocument.mockRejectedValue(new AnalyserError('Not found', 'NOT_FOUND'))
    const res = await supertest(app).post('/documents/doc-001')
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('NOT_FOUND')
  })

  it('returns 503 on AnalyserError with code CONFIG_ERROR', async () => {
    mockedGetDocumentById.mockReturnValue(makePolicyDocument())
    const { AnalyserError } = await import('../services/analyser.js')
    mockedAnalyseDocument.mockRejectedValue(new AnalyserError('No API key', 'CONFIG_ERROR'))
    const res = await supertest(app).post('/documents/doc-001')
    expect(res.status).toBe(503)
    expect(res.body.code).toBe('CONFIG_ERROR')
  })

  it('returns 502 on AnalyserError with code PARSE_ERROR', async () => {
    mockedGetDocumentById.mockReturnValue(makePolicyDocument())
    const { AnalyserError } = await import('../services/analyser.js')
    mockedAnalyseDocument.mockRejectedValue(new AnalyserError('Bad JSON', 'PARSE_ERROR'))
    const res = await supertest(app).post('/documents/doc-001')
    expect(res.status).toBe(502)
    expect(res.body.code).toBe('PARSE_ERROR')
  })

  it('returns 502 on AnalyserError with code CONTENT_TOO_SHORT', async () => {
    mockedGetDocumentById.mockReturnValue(makePolicyDocument())
    const { AnalyserError } = await import('../services/analyser.js')
    mockedAnalyseDocument.mockRejectedValue(new AnalyserError('Too short', 'CONTENT_TOO_SHORT'))
    const res = await supertest(app).post('/documents/doc-001')
    expect(res.status).toBe(502)
  })

  it('returns 500 for unexpected non-AnalyserError exceptions', async () => {
    mockedGetDocumentById.mockReturnValue(makePolicyDocument())
    mockedAnalyseDocument.mockRejectedValue(new Error('Unknown crash'))
    const res = await supertest(app).post('/documents/doc-001')
    expect(res.status).toBe(500)
  })
})

// ---------------------------------------------------------------------------
// POST /services/:serviceId
// ---------------------------------------------------------------------------

describe('POST /services/:serviceId', () => {
  it('returns 201 with analysis when service and latest document exist', async () => {
    mockedGetServiceById.mockReturnValue(makeService())
    mockedGetLatestDocumentForService.mockReturnValue(makePolicyDocument())
    mockedAnalyseDocument.mockResolvedValue(makePolicyAnalysis())

    const res = await supertest(app).post('/services/svc-001')
    expect(res.status).toBe(201)
    expect(res.body.id).toBeTruthy()
  })

  it('returns 404 when the service does not exist', async () => {
    mockedGetServiceById.mockReturnValue(undefined)
    const res = await supertest(app).post('/services/nonexistent')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('Service not found')
  })

  it('returns 404 when the service has no policy documents', async () => {
    mockedGetServiceById.mockReturnValue(makeService())
    mockedGetLatestDocumentForService.mockReturnValue(undefined)

    const res = await supertest(app).post('/services/svc-001')
    expect(res.status).toBe(404)
    expect(res.body.error).toContain('No policy document')
  })

  it('applies the same error → HTTP status mapping as the document route', async () => {
    mockedGetServiceById.mockReturnValue(makeService())
    mockedGetLatestDocumentForService.mockReturnValue(makePolicyDocument())
    const { AnalyserError } = await import('../services/analyser.js')
    mockedAnalyseDocument.mockRejectedValue(new AnalyserError('Key not set', 'CONFIG_ERROR'))
    const res = await supertest(app).post('/services/svc-001')
    expect(res.status).toBe(503)
  })
})

// ---------------------------------------------------------------------------
// GET /services/:serviceId
// ---------------------------------------------------------------------------

describe('GET /services/:serviceId', () => {
  it('returns 200 with JSON fields parsed from strings into arrays/objects', async () => {
    mockedGetServiceById.mockReturnValue(makeService())
    mockedGetLatestDocumentForService.mockReturnValue(makePolicyDocument())
    mockedGetLatestAnalysisForDocument.mockReturnValue(
      makePolicyAnalysis({
        data_collected: '["email","name"]',
        purposes: '["service delivery"]',
        contact: '{"email":"dpo@example.com"}',
      }),
    )

    const res = await supertest(app).get('/services/svc-001')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.data_collected)).toBe(true)
    expect(res.body.data_collected).toContain('email')
    expect(typeof res.body.contact).toBe('object')
    expect(res.body.contact.email).toBe('dpo@example.com')
  })

  it('returns 404 when the service does not exist', async () => {
    mockedGetServiceById.mockReturnValue(undefined)
    const res = await supertest(app).get('/services/nonexistent')
    expect(res.status).toBe(404)
  })

  it('returns 404 when the service has no documents', async () => {
    mockedGetServiceById.mockReturnValue(makeService())
    mockedGetLatestDocumentForService.mockReturnValue(undefined)
    const res = await supertest(app).get('/services/svc-001')
    expect(res.status).toBe(404)
  })

  it('returns 404 when no analysis exists for the latest document', async () => {
    mockedGetServiceById.mockReturnValue(makeService())
    mockedGetLatestDocumentForService.mockReturnValue(makePolicyDocument())
    mockedGetLatestAnalysisForDocument.mockReturnValue(undefined)
    const res = await supertest(app).get('/services/svc-001')
    expect(res.status).toBe(404)
    expect(res.body.error).toContain('No analysis found')
  })
})

// ---------------------------------------------------------------------------
// GET /services/:serviceId/supply-chain
// ---------------------------------------------------------------------------

describe('GET /services/:serviceId/supply-chain', () => {
  it('returns 200 with service, thirdParties and edges', async () => {
    const svc = makeService()
    const edge = makeSupplyChainEdge()
    const tp = makeThirdParty()
    mockedGetServiceById.mockReturnValue(svc)
    mockedGetEdgesForService.mockReturnValue([edge])
    mockedGetThirdPartyById.mockReturnValue(tp)

    const res = await supertest(app).get('/services/svc-001/supply-chain')
    expect(res.status).toBe(200)
    expect(res.body.service.id).toBe(svc.id)
    expect(res.body.thirdParties).toHaveLength(1)
    expect(res.body.thirdParties[0].name).toBe('Google Analytics')
    expect(res.body.edges).toHaveLength(1)
    expect(res.body.edges[0].from).toBe(edge.from_service_id)
    expect(res.body.edges[0].to).toBe(edge.to_third_party_id)
  })

  it('returns empty thirdParties and edges arrays when no supply chain exists', async () => {
    mockedGetServiceById.mockReturnValue(makeService())
    mockedGetEdgesForService.mockReturnValue([])

    const res = await supertest(app).get('/services/svc-001/supply-chain')
    expect(res.status).toBe(200)
    expect(res.body.thirdParties).toEqual([])
    expect(res.body.edges).toEqual([])
  })

  it('deduplicates third parties when the same party appears in multiple edges', async () => {
    const tp = makeThirdParty()
    const edge1 = makeSupplyChainEdge({ id: 'e1', document_id: 'doc-1' })
    const edge2 = makeSupplyChainEdge({ id: 'e2', document_id: 'doc-2' })
    mockedGetServiceById.mockReturnValue(makeService())
    mockedGetEdgesForService.mockReturnValue([edge1, edge2])
    mockedGetThirdPartyById.mockReturnValue(tp)

    const res = await supertest(app).get('/services/svc-001/supply-chain')
    expect(res.status).toBe(200)
    expect(res.body.thirdParties).toHaveLength(1)
    expect(res.body.edges).toHaveLength(2)
  })

  it('returns 404 when the service does not exist', async () => {
    mockedGetServiceById.mockReturnValue(undefined)
    const res = await supertest(app).get('/services/nonexistent/supply-chain')
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// GET /third-parties
// ---------------------------------------------------------------------------

describe('GET /third-parties', () => {
  it('returns 200 with all third parties', async () => {
    mockedGetAllThirdParties.mockReturnValue([makeThirdParty()])
    const res = await supertest(app).get('/third-parties')
    expect(res.status).toBe(200)
    expect(res.body).toHaveLength(1)
    expect(res.body[0].name).toBe('Google Analytics')
  })

  it('returns 200 with empty array when no third parties exist', async () => {
    mockedGetAllThirdParties.mockReturnValue([])
    const res = await supertest(app).get('/third-parties')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})
