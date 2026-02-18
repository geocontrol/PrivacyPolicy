import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MockedFunction } from 'vitest'
import { readFile } from 'node:fs/promises'
import {
  getDocumentById,
  insertPolicyAnalysis,
  upsertThirdParty,
  insertSupplyChainEdge,
} from '../db/queries.js'
import { analyseDocument, AnalyserError } from './analyser.js'
import {
  makePolicyDocument,
  makePolicyAnalysis,
  makeThirdParty,
  SAMPLE_PRIVACY_HTML,
  SAMPLE_LLM_RESPONSE_JSON,
} from '../../../tests/fixtures/index.js'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCreate = vi.fn()

vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    messages = { create: mockCreate }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_opts: { apiKey: string }) {}
  }
  return { default: Anthropic }
})

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}))

vi.mock('../db/queries.js', () => ({
  getDocumentById: vi.fn(),
  insertPolicyAnalysis: vi.fn(),
  upsertThirdParty: vi.fn(),
  insertSupplyChainEdge: vi.fn(),
}))

const mockedReadFile = readFile as MockedFunction<typeof readFile>
const mockedGetDocumentById = getDocumentById as MockedFunction<typeof getDocumentById>
const mockedInsertPolicyAnalysis = insertPolicyAnalysis as MockedFunction<typeof insertPolicyAnalysis>
const mockedUpsertThirdParty = upsertThirdParty as MockedFunction<typeof upsertThirdParty>
const mockedInsertSupplyChainEdge = insertSupplyChainEdge as MockedFunction<typeof insertSupplyChainEdge>

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ANTHROPIC_API_KEY = 'test-api-key-12345'
  process.env.LLM_PROVIDER = 'anthropic'

  // Happy-path defaults
  mockedGetDocumentById.mockReturnValue(makePolicyDocument())
  mockedReadFile.mockResolvedValue(SAMPLE_PRIVACY_HTML as unknown as Buffer)
  mockCreate.mockResolvedValue({
    content: [{ type: 'text', text: SAMPLE_LLM_RESPONSE_JSON }],
  })
  mockedInsertPolicyAnalysis.mockReturnValue(makePolicyAnalysis())
  mockedUpsertThirdParty.mockReturnValue(makeThirdParty())
  mockedInsertSupplyChainEdge.mockReturnValue(undefined)
})

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('analyseDocument() — happy path', () => {
  it('returns a PolicyAnalysis record on success', async () => {
    const result = await analyseDocument('doc-001', 'svc-001')
    expect(result).toMatchObject({ id: makePolicyAnalysis().id })
  })

  it('reads the file at doc.file_path', async () => {
    const doc = makePolicyDocument({ file_path: '/data/policies/svc-001/test.html' })
    mockedGetDocumentById.mockReturnValue(doc)
    await analyseDocument('doc-001', 'svc-001')
    expect(mockedReadFile).toHaveBeenCalledWith('/data/policies/svc-001/test.html', 'utf-8')
  })

  it('persists the analysis with the correct document id and provider', async () => {
    await analyseDocument('doc-001', 'svc-001')
    expect(mockedInsertPolicyAnalysis).toHaveBeenCalledWith(
      'doc-001',
      'anthropic',
      expect.objectContaining({ summary: expect.any(String) }),
      expect.any(Object),
    )
  })

  it('upserts each third party mentioned in the LLM response', async () => {
    await analyseDocument('doc-001', 'svc-001')
    // SAMPLE_LLM_RESPONSE_JSON contains Google Analytics and Stripe
    expect(mockedUpsertThirdParty).toHaveBeenCalledTimes(2)
    expect(mockedUpsertThirdParty).toHaveBeenCalledWith(
      'Google Analytics',
      'https://analytics.google.com',
      'analytics',
    )
    expect(mockedUpsertThirdParty).toHaveBeenCalledWith(
      'Stripe',
      undefined,
      'payment processing',
    )
  })

  it('inserts a supply chain edge for each third party', async () => {
    await analyseDocument('doc-001', 'svc-001')
    expect(mockedInsertSupplyChainEdge).toHaveBeenCalledTimes(2)
    expect(mockedInsertSupplyChainEdge).toHaveBeenCalledWith(
      'svc-001',
      makeThirdParty().id,
      'doc-001',
      expect.any(String),
    )
  })

  it('does not throw CONFIG_ERROR when a valid API key is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-api-key-12345'
    await expect(analyseDocument('doc-001', 'svc-001')).resolves.toBeDefined()
  })

  it('calls the LLM with model claude-opus-4-5 and max_tokens 4096', async () => {
    await analyseDocument('doc-001', 'svc-001')
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-opus-4-5',
        max_tokens: 4096,
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// Document not found
// ---------------------------------------------------------------------------

describe('analyseDocument() — document not found', () => {
  it('throws AnalyserError with NOT_FOUND when document is missing from DB', async () => {
    mockedGetDocumentById.mockReturnValue(undefined)
    await expect(analyseDocument('missing-doc', 'svc-001')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('does not call readFile when document is not found', async () => {
    mockedGetDocumentById.mockReturnValue(undefined)
    await expect(analyseDocument('missing', 'svc-001')).rejects.toThrow()
    expect(mockedReadFile).not.toHaveBeenCalled()
  })

  it('throws an AnalyserError instance', async () => {
    mockedGetDocumentById.mockReturnValue(undefined)
    await expect(analyseDocument('missing', 'svc-001')).rejects.toBeInstanceOf(AnalyserError)
  })
})

// ---------------------------------------------------------------------------
// File read errors
// ---------------------------------------------------------------------------

describe('analyseDocument() — file read errors', () => {
  it('throws AnalyserError with FILE_READ_ERROR when readFile rejects', async () => {
    mockedReadFile.mockRejectedValue(new Error('ENOENT: no such file'))
    await expect(analyseDocument('doc-001', 'svc-001')).rejects.toMatchObject({
      code: 'FILE_READ_ERROR',
    })
  })

  it('does not call the LLM when file cannot be read', async () => {
    mockedReadFile.mockRejectedValue(new Error('ENOENT'))
    await expect(analyseDocument('doc-001', 'svc-001')).rejects.toThrow()
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Content too short
// ---------------------------------------------------------------------------

describe('analyseDocument() — content too short', () => {
  it('throws AnalyserError with CONTENT_TOO_SHORT when stripped text is under 100 chars', async () => {
    mockedReadFile.mockResolvedValue('<html><body><p>Short.</p></body></html>' as unknown as Buffer)
    await expect(analyseDocument('doc-001', 'svc-001')).rejects.toMatchObject({
      code: 'CONTENT_TOO_SHORT',
    })
  })

  it('does not call the LLM when content is too short', async () => {
    mockedReadFile.mockResolvedValue('<p>Tiny.</p>' as unknown as Buffer)
    await expect(analyseDocument('doc-001', 'svc-001')).rejects.toThrow()
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// LLM configuration errors
// ---------------------------------------------------------------------------

describe('analyseDocument() — LLM configuration errors', () => {
  it('throws AnalyserError with CONFIG_ERROR when ANTHROPIC_API_KEY is not set', async () => {
    delete process.env.ANTHROPIC_API_KEY
    await expect(analyseDocument('doc-001', 'svc-001')).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
    })
  })

  it('throws AnalyserError with CONFIG_ERROR when API key is the placeholder string', async () => {
    process.env.ANTHROPIC_API_KEY = 'your_api_key_here'
    await expect(analyseDocument('doc-001', 'svc-001')).rejects.toMatchObject({
      code: 'CONFIG_ERROR',
    })
  })

  it('throws AnalyserError with PROVIDER_NOT_SUPPORTED for an unrecognised LLM_PROVIDER', async () => {
    process.env.LLM_PROVIDER = 'openai'
    await expect(analyseDocument('doc-001', 'svc-001')).rejects.toMatchObject({
      code: 'PROVIDER_NOT_SUPPORTED',
    })
  })
})

// ---------------------------------------------------------------------------
// LLM response parsing
// ---------------------------------------------------------------------------

describe('analyseDocument() — LLM response parsing', () => {
  it('throws AnalyserError with PARSE_ERROR when LLM returns invalid JSON', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'not valid json at all {{{' }],
    })
    await expect(analyseDocument('doc-001', 'svc-001')).rejects.toMatchObject({
      code: 'PARSE_ERROR',
    })
  })

  it('throws AnalyserError with PARSE_ERROR when LLM returns a non-text content block', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'tu_1', name: 'some_tool', input: {} }],
    })
    await expect(analyseDocument('doc-001', 'svc-001')).rejects.toMatchObject({
      code: 'PARSE_ERROR',
    })
  })

  it('successfully parses a valid JSON response wrapped in markdown code fences', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '```json\n' + SAMPLE_LLM_RESPONSE_JSON + '\n```' }],
    })
    await expect(analyseDocument('doc-001', 'svc-001')).resolves.toBeDefined()
  })

  it('maps null arrays in LLM response to empty arrays without throwing', async () => {
    const nullResponse = JSON.stringify({
      summary: 'A summary.',
      dataCollected: null,
      purposes: null,
      legalBases: null,
      retention: null,
      userRights: null,
      contact: null,
      thirdParties: null,
    })
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: nullResponse }],
    })
    await expect(analyseDocument('doc-001', 'svc-001')).resolves.toBeDefined()
    expect(mockedInsertPolicyAnalysis).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({
        dataCollected: [],
        purposes: [],
        legalBases: [],
        userRights: [],
        thirdParties: [],
      }),
      expect.any(Object),
    )
  })

  it('silently ignores third party entries with an empty or missing name', async () => {
    const responseWithInvalidTp = JSON.stringify({
      summary: 'Summary.',
      dataCollected: [],
      purposes: [],
      legalBases: [],
      retention: null,
      userRights: [],
      contact: null,
      thirdParties: [
        { name: '', url: null, role: 'analytics', contextSnippet: 'no name' },
        { url: null, role: 'payment', contextSnippet: 'completely missing name' },
      ],
    })
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: responseWithInvalidTp }],
    })
    await analyseDocument('doc-001', 'svc-001')
    expect(mockedUpsertThirdParty).not.toHaveBeenCalled()
    expect(mockedInsertSupplyChainEdge).not.toHaveBeenCalled()
  })
})
