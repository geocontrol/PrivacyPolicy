import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import type { MockedFunction } from 'vitest'
import express from 'express'
import supertest from 'supertest'
import {
  findServiceByNormalizedDomain,
  insertService,
} from '../db/queries.js'
import { fetchAndStorePolicyDocument } from '../services/crawler.js'
import { analyseDocument } from '../services/analyser.js'
import { extensionRouter } from './extension.js'
import { makeService, makePolicyAnalysis } from '../../../tests/fixtures/index.js'

vi.mock('../db/queries.js', () => ({
  findServiceByNormalizedDomain: vi.fn(),
  insertService: vi.fn(),
}))

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

const mockedFindServiceByNormalizedDomain =
  findServiceByNormalizedDomain as MockedFunction<typeof findServiceByNormalizedDomain>
const mockedInsertService = insertService as MockedFunction<typeof insertService>
const mockedFetchAndStorePolicyDocument =
  fetchAndStorePolicyDocument as MockedFunction<typeof fetchAndStorePolicyDocument>
const mockedAnalyseDocument = analyseDocument as MockedFunction<typeof analyseDocument>

let app: express.Express

beforeAll(() => {
  process.env.EXTENSION_API_TOKEN = 'test-extension-token'

  app = express()
  app.use(express.json())
  app.use('/', extensionRouter)
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('POST /signup', () => {
  it('returns 401 when token is missing', async () => {
    const res = await supertest(app)
      .post('/signup')
      .send({ url: 'https://example.com/signup' })

    expect(res.status).toBe(401)
    expect(res.body.error).toContain('Unauthorized')
  })

  it('returns 401 when token is invalid', async () => {
    const res = await supertest(app)
      .post('/signup')
      .set('x-extension-token', 'wrong-token')
      .send({ url: 'https://example.com/signup' })

    expect(res.status).toBe(401)
  })

  it('returns 400 when url is missing', async () => {
    const res = await supertest(app)
      .post('/signup')
      .set('x-extension-token', 'test-extension-token')
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('url is required')
  })

  it('returns 400 when url is invalid', async () => {
    const res = await supertest(app)
      .post('/signup')
      .set('x-extension-token', 'test-extension-token')
      .send({ url: 'not-a-valid-url-@@' })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('valid URL')
  })

  it('returns 201 for a new domain and runs fetch + analysis', async () => {
    mockedFindServiceByNormalizedDomain.mockReturnValue(undefined)
    mockedInsertService.mockReturnValue(makeService({ id: 'svc-new-001', url: 'example.com' }))
    mockedFetchAndStorePolicyDocument.mockResolvedValue({
      documentId: 'doc-new-001',
      resolvedUrl: 'https://example.com/privacy-policy',
      isNew: true,
    })
    mockedAnalyseDocument.mockResolvedValue(makePolicyAnalysis({ id: 'ana-new-001' }))

    const res = await supertest(app)
      .post('/signup')
      .set('x-extension-token', 'test-extension-token')
      .send({ url: 'https://www.example.com/signup', name: 'Example', category: 'Tech' })

    expect(res.status).toBe(201)
    expect(res.body.created).toBe(true)
    expect(res.body.service.id).toBe('svc-new-001')
    expect(res.body.fetch.documentId).toBe('doc-new-001')
    expect(res.body.analysis.id).toBe('ana-new-001')
    expect(mockedInsertService).toHaveBeenCalledWith('Example', 'example.com', 'Tech')
    expect(mockedFetchAndStorePolicyDocument).toHaveBeenCalledWith('svc-new-001', 'example.com')
    expect(mockedAnalyseDocument).toHaveBeenCalledWith('doc-new-001', 'svc-new-001')
  })

  it('returns 200 for an existing domain and does not create a duplicate', async () => {
    const existing = makeService({ id: 'svc-existing-001', url: 'https://example.com' })
    mockedFindServiceByNormalizedDomain.mockReturnValue(existing)
    mockedFetchAndStorePolicyDocument.mockResolvedValue({
      documentId: 'doc-existing-001',
      resolvedUrl: 'https://example.com/privacy',
      isNew: true,
    })
    mockedAnalyseDocument.mockResolvedValue(makePolicyAnalysis({ id: 'ana-existing-001' }))

    const res = await supertest(app)
      .post('/signup')
      .set('x-extension-token', 'test-extension-token')
      .send({ url: 'http://www.example.com/signup' })

    expect(res.status).toBe(200)
    expect(res.body.created).toBe(false)
    expect(res.body.service.id).toBe('svc-existing-001')
    expect(mockedInsertService).not.toHaveBeenCalled()
    expect(mockedFindServiceByNormalizedDomain).toHaveBeenCalledWith('example.com')
  })

  it('calls functions in order: service upsert, fetch, analyse', async () => {
    mockedFindServiceByNormalizedDomain.mockReturnValue(undefined)
    mockedInsertService.mockReturnValue(makeService({ id: 'svc-order-001', url: 'order.com' }))
    mockedFetchAndStorePolicyDocument.mockResolvedValue({
      documentId: 'doc-order-001',
      resolvedUrl: 'https://order.com/privacy',
      isNew: true,
    })
    mockedAnalyseDocument.mockResolvedValue(makePolicyAnalysis({ id: 'ana-order-001' }))

    await supertest(app)
      .post('/signup')
      .set('x-extension-token', 'test-extension-token')
      .send({ url: 'https://order.com/signup' })

    expect(mockedInsertService.mock.invocationCallOrder[0]).toBeLessThan(
      mockedFetchAndStorePolicyDocument.mock.invocationCallOrder[0],
    )
    expect(mockedFetchAndStorePolicyDocument.mock.invocationCallOrder[0]).toBeLessThan(
      mockedAnalyseDocument.mock.invocationCallOrder[0],
    )
  })

  it('returns 404 on CrawlerError with code POLICY_NOT_FOUND', async () => {
    mockedFindServiceByNormalizedDomain.mockReturnValue(makeService())
    const { CrawlerError } = await import('../services/crawler.js')
    mockedFetchAndStorePolicyDocument.mockRejectedValue(
      new CrawlerError('Policy page missing', 'POLICY_NOT_FOUND'),
    )

    const res = await supertest(app)
      .post('/signup')
      .set('x-extension-token', 'test-extension-token')
      .send({ url: 'https://example.com' })

    expect(res.status).toBe(404)
    expect(res.body.code).toBe('POLICY_NOT_FOUND')
  })

  it('returns 503 on AnalyserError with code CONFIG_ERROR', async () => {
    mockedFindServiceByNormalizedDomain.mockReturnValue(makeService())
    mockedFetchAndStorePolicyDocument.mockResolvedValue({
      documentId: 'doc-analyser-001',
      resolvedUrl: 'https://example.com/privacy',
      isNew: true,
    })

    const { AnalyserError } = await import('../services/analyser.js')
    mockedAnalyseDocument.mockRejectedValue(new AnalyserError('API key missing', 'CONFIG_ERROR'))

    const res = await supertest(app)
      .post('/signup')
      .set('x-extension-token', 'test-extension-token')
      .send({ url: 'https://example.com' })

    expect(res.status).toBe(503)
    expect(res.body.code).toBe('CONFIG_ERROR')
  })

  it('returns 502 on AnalyserError with a non-config code', async () => {
    mockedFindServiceByNormalizedDomain.mockReturnValue(makeService())
    mockedFetchAndStorePolicyDocument.mockResolvedValue({
      documentId: 'doc-analyser-002',
      resolvedUrl: 'https://example.com/privacy',
      isNew: true,
    })

    const { AnalyserError } = await import('../services/analyser.js')
    mockedAnalyseDocument.mockRejectedValue(new AnalyserError('Bad response', 'PARSE_ERROR'))

    const res = await supertest(app)
      .post('/signup')
      .set('x-extension-token', 'test-extension-token')
      .send({ url: 'https://example.com' })

    expect(res.status).toBe(502)
    expect(res.body.code).toBe('PARSE_ERROR')
  })

  it('returns 500 on unexpected errors', async () => {
    mockedFindServiceByNormalizedDomain.mockReturnValue(makeService())
    mockedFetchAndStorePolicyDocument.mockRejectedValue(new Error('Unexpected failure'))

    const res = await supertest(app)
      .post('/signup')
      .set('x-extension-token', 'test-extension-token')
      .send({ url: 'https://example.com' })

    expect(res.status).toBe(500)
  })
})
