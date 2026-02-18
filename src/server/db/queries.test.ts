import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { setDb, resetDb, getDb, initialiseDb } from './schema.js'
import {
  insertService,
  getServiceById,
  getAllServices,
  deleteService,
  insertPolicyDocument,
  getDocumentById,
  getLatestDocumentForService,
  getDocumentsForService,
  insertPolicyAnalysis,
  getAnalysisById,
  getLatestAnalysisForDocument,
  upsertThirdParty,
  getAllThirdParties,
  getThirdPartyById,
  insertSupplyChainEdge,
  getEdgesForService,
} from './queries.js'
import { makePolicyAnalysisResult } from '../../../tests/fixtures/index.js'

let testDb: Database.Database

beforeAll(() => {
  testDb = new Database(':memory:')
  setDb(testDb)
  initialiseDb(testDb) // explicitly initialise schema on the injected instance
})

afterAll(() => {
  testDb.close()
  resetDb()
})

afterEach(() => {
  // Wipe all rows between tests — faster than recreating schema
  testDb.exec(`
    DELETE FROM supply_chain_edges;
    DELETE FROM policy_analyses;
    DELETE FROM policy_documents;
    DELETE FROM third_parties;
    DELETE FROM services;
  `)
})

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

describe('insertService', () => {
  it('inserts and returns a Service with a generated UUID', () => {
    const svc = insertService('Example', 'https://example.com', 'Technology')
    expect(svc.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(svc.name).toBe('Example')
    expect(svc.url).toBe('https://example.com')
    expect(svc.category).toBe('Technology')
  })

  it('stores null when category is omitted', () => {
    const svc = insertService('No Category', 'https://nc.com')
    expect(svc.category).toBeNull()
  })

  it('stores multiple services independently', () => {
    insertService('Alpha', 'https://alpha.com')
    insertService('Beta', 'https://beta.com')
    expect(getAllServices()).toHaveLength(2)
  })

  it('populates created_at timestamp', () => {
    const svc = insertService('Timestamped', 'https://ts.com')
    expect(svc.created_at).toBeTruthy()
  })
})

describe('getServiceById', () => {
  it('returns the service for a known id', () => {
    const svc = insertService('Known', 'https://known.com')
    expect(getServiceById(svc.id)).toMatchObject({ id: svc.id, name: 'Known' })
  })

  it('returns undefined for an unknown id', () => {
    expect(getServiceById('nonexistent-id')).toBeUndefined()
  })
})

describe('getAllServices', () => {
  it('returns an empty array when no services exist', () => {
    expect(getAllServices()).toEqual([])
  })

  it('returns services sorted alphabetically by name', () => {
    insertService('Zeta', 'https://zeta.com')
    insertService('Alpha', 'https://alpha.com')
    insertService('Mu', 'https://mu.com')
    const names = getAllServices().map(s => s.name)
    expect(names).toEqual(['Alpha', 'Mu', 'Zeta'])
  })
})

describe('deleteService', () => {
  it('removes the service record', () => {
    const svc = insertService('Deletable', 'https://del.com')
    deleteService(svc.id)
    expect(getServiceById(svc.id)).toBeUndefined()
  })

  it('is a no-op for a nonexistent id — does not throw', () => {
    expect(() => deleteService('ghost-id')).not.toThrow()
  })

  it('cascades delete to policy_documents', () => {
    const svc = insertService('Cascade', 'https://cascade.com')
    insertPolicyDocument(svc.id, 'https://cascade.com/p', '/tmp/p.html', 'hash')
    deleteService(svc.id)
    expect(getDocumentsForService(svc.id)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Policy documents
// ---------------------------------------------------------------------------

describe('insertPolicyDocument', () => {
  it('inserts and returns a PolicyDocument with a generated UUID', () => {
    const svc = insertService('DocSvc', 'https://docsvc.com')
    const doc = insertPolicyDocument(svc.id, 'https://docsvc.com/privacy', '/tmp/p.html', 'hash1')
    expect(doc.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(doc.service_id).toBe(svc.id)
    expect(doc.source_url).toBe('https://docsvc.com/privacy')
    expect(doc.content_hash).toBe('hash1')
  })

  it('defaults status to "retrieved"', () => {
    const svc = insertService('S', 'https://s.com')
    const doc = insertPolicyDocument(svc.id, 'https://s.com/p', '/tmp/p.html', 'h')
    expect(doc.status).toBe('retrieved')
  })
})

describe('getDocumentById', () => {
  it('returns the document for a known id', () => {
    const svc = insertService('S', 'https://s.com')
    const doc = insertPolicyDocument(svc.id, 'https://s.com/p', '/tmp/p.html', 'h')
    expect(getDocumentById(doc.id)).toMatchObject({ id: doc.id })
  })

  it('returns undefined for an unknown id', () => {
    expect(getDocumentById('missing')).toBeUndefined()
  })
})

describe('getLatestDocumentForService', () => {
  it('returns undefined when no documents exist for the service', () => {
    const svc = insertService('Empty', 'https://empty.com')
    expect(getLatestDocumentForService(svc.id)).toBeUndefined()
  })

  it('returns the most recently inserted document', async () => {
    const svc = insertService('Multi', 'https://multi.com')
    insertPolicyDocument(svc.id, 'https://multi.com/p', '/tmp/p1.html', 'h1')
    await new Promise(r => setTimeout(r, 1100))
    const doc2 = insertPolicyDocument(svc.id, 'https://multi.com/p', '/tmp/p2.html', 'h2')
    const latest = getLatestDocumentForService(svc.id)
    expect(latest?.id).toBe(doc2.id)
  })
})

describe('getDocumentsForService', () => {
  it('returns all documents for a service', () => {
    const svc = insertService('Docs', 'https://docs.com')
    insertPolicyDocument(svc.id, 'https://docs.com/p', '/tmp/p1.html', 'h1')
    insertPolicyDocument(svc.id, 'https://docs.com/p', '/tmp/p2.html', 'h2')
    expect(getDocumentsForService(svc.id)).toHaveLength(2)
  })

  it('returns empty array when service has no documents', () => {
    const svc = insertService('NoDocs', 'https://nodocs.com')
    expect(getDocumentsForService(svc.id)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Policy analyses
// ---------------------------------------------------------------------------

describe('insertPolicyAnalysis', () => {
  it('inserts and returns a PolicyAnalysis record', () => {
    const svc = insertService('AS', 'https://as.com')
    const doc = insertPolicyDocument(svc.id, 'https://as.com/p', '/tmp/p.html', 'h')
    const result = makePolicyAnalysisResult()
    const analysis = insertPolicyAnalysis(doc.id, 'anthropic', result, { raw: 'response' })
    expect(analysis.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(analysis.document_id).toBe(doc.id)
    expect(analysis.llm_provider).toBe('anthropic')
    expect(analysis.summary).toBe(result.summary)
  })

  it('serialises array fields as JSON strings', () => {
    const svc = insertService('J', 'https://j.com')
    const doc = insertPolicyDocument(svc.id, 'https://j.com/p', '/tmp/p.html', 'h')
    const result = makePolicyAnalysisResult()
    const analysis = insertPolicyAnalysis(doc.id, 'anthropic', result, {})
    expect(typeof analysis.data_collected).toBe('string')
    expect(JSON.parse(analysis.data_collected!)).toEqual(result.dataCollected)
    expect(JSON.parse(analysis.purposes!)).toEqual(result.purposes)
    expect(JSON.parse(analysis.legal_bases!)).toEqual(result.legalBases)
    expect(JSON.parse(analysis.user_rights!)).toEqual(result.userRights)
    expect(JSON.parse(analysis.contact!)).toEqual(result.contact)
  })
})

describe('getAnalysisById', () => {
  it('returns the analysis for a known id', () => {
    const svc = insertService('S', 'https://s.com')
    const doc = insertPolicyDocument(svc.id, 'https://s.com/p', '/tmp/p.html', 'h')
    const analysis = insertPolicyAnalysis(doc.id, 'anthropic', makePolicyAnalysisResult(), {})
    expect(getAnalysisById(analysis.id)).toMatchObject({ id: analysis.id })
  })

  it('returns undefined for an unknown id', () => {
    expect(getAnalysisById('ghost')).toBeUndefined()
  })
})

describe('getLatestAnalysisForDocument', () => {
  it('returns undefined when no analysis exists', () => {
    const svc = insertService('NA', 'https://na.com')
    const doc = insertPolicyDocument(svc.id, 'https://na.com/p', '/tmp/p.html', 'h')
    expect(getLatestAnalysisForDocument(doc.id)).toBeUndefined()
  })

  it('returns the most recent analysis when multiple exist', async () => {
    const svc = insertService('LA', 'https://la.com')
    const doc = insertPolicyDocument(svc.id, 'https://la.com/p', '/tmp/p.html', 'h')
    const result = makePolicyAnalysisResult()
    insertPolicyAnalysis(doc.id, 'anthropic', result, {})
    await new Promise(r => setTimeout(r, 1100))
    const ana2 = insertPolicyAnalysis(doc.id, 'anthropic', result, {})
    expect(getLatestAnalysisForDocument(doc.id)?.id).toBe(ana2.id)
  })
})

// ---------------------------------------------------------------------------
// Third parties
// ---------------------------------------------------------------------------

describe('upsertThirdParty', () => {
  it('creates a new third party when the name does not exist', () => {
    const tp = upsertThirdParty('Google Analytics', 'https://analytics.google.com', 'analytics')
    expect(tp.id).toBeTruthy()
    expect(tp.name).toBe('Google Analytics')
    expect(tp.url).toBe('https://analytics.google.com')
    expect(tp.category).toBe('analytics')
  })

  it('returns the existing record when the same name is inserted again', () => {
    const tp1 = upsertThirdParty('Stripe')
    const tp2 = upsertThirdParty('Stripe')
    expect(tp1.id).toBe(tp2.id)
  })

  it('does not create duplicate rows on repeated calls', () => {
    upsertThirdParty('Datadog')
    upsertThirdParty('Datadog')
    upsertThirdParty('Datadog')
    expect(getAllThirdParties().filter(t => t.name === 'Datadog')).toHaveLength(1)
  })

  it('stores null url and category when omitted', () => {
    const tp = upsertThirdParty('Minimal')
    expect(tp.url).toBeNull()
    expect(tp.category).toBeNull()
  })
})

describe('getAllThirdParties', () => {
  it('returns an empty array when none exist', () => {
    expect(getAllThirdParties()).toEqual([])
  })

  it('returns third parties sorted alphabetically by name', () => {
    upsertThirdParty('Zendesk')
    upsertThirdParty('Amplitude')
    upsertThirdParty('Hotjar')
    const names = getAllThirdParties().map(t => t.name)
    expect(names).toEqual(['Amplitude', 'Hotjar', 'Zendesk'])
  })
})

describe('getThirdPartyById', () => {
  it('returns the third party for a known id', () => {
    const tp = upsertThirdParty('Intercom', 'https://intercom.com', 'customer support')
    expect(getThirdPartyById(tp.id)).toMatchObject({ id: tp.id, name: 'Intercom' })
  })

  it('returns undefined for an unknown id', () => {
    expect(getThirdPartyById('ghost')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Supply chain edges
// ---------------------------------------------------------------------------

describe('insertSupplyChainEdge', () => {
  it('inserts an edge and it is retrievable via getEdgesForService', () => {
    const svc = insertService('EdgeSvc', 'https://edge.com')
    const doc = insertPolicyDocument(svc.id, 'https://edge.com/p', '/tmp/p.html', 'h')
    const tp = upsertThirdParty('Hotjar')
    insertSupplyChainEdge(svc.id, tp.id, doc.id, 'We use Hotjar for session recording.')
    const edges = getEdgesForService(svc.id)
    expect(edges).toHaveLength(1)
    expect(edges[0].to_third_party_id).toBe(tp.id)
    expect(edges[0].context_snippet).toBe('We use Hotjar for session recording.')
  })

  it('is idempotent — duplicate edge is silently ignored', () => {
    const svc = insertService('IdempSvc', 'https://idemp.com')
    const doc = insertPolicyDocument(svc.id, 'https://idemp.com/p', '/tmp/p.html', 'h')
    const tp = upsertThirdParty('Mixpanel')
    insertSupplyChainEdge(svc.id, tp.id, doc.id)
    insertSupplyChainEdge(svc.id, tp.id, doc.id) // duplicate
    expect(getEdgesForService(svc.id)).toHaveLength(1)
  })

  it('stores null context_snippet when not provided', () => {
    const svc = insertService('NoCtx', 'https://noctx.com')
    const doc = insertPolicyDocument(svc.id, 'https://noctx.com/p', '/tmp/p.html', 'h')
    const tp = upsertThirdParty('Segment')
    insertSupplyChainEdge(svc.id, tp.id, doc.id)
    const edges = getEdgesForService(svc.id)
    expect(edges[0].context_snippet).toBeNull()
  })
})

describe('getEdgesForService', () => {
  it('returns an empty array when no edges exist for the service', () => {
    const svc = insertService('NoEdges', 'https://noedges.com')
    expect(getEdgesForService(svc.id)).toEqual([])
  })

  it('returns only edges for the requested service', () => {
    const svc1 = insertService('Svc1', 'https://svc1.com')
    const svc2 = insertService('Svc2', 'https://svc2.com')
    const doc1 = insertPolicyDocument(svc1.id, 'https://svc1.com/p', '/tmp/p.html', 'h1')
    const doc2 = insertPolicyDocument(svc2.id, 'https://svc2.com/p', '/tmp/p.html', 'h2')
    const tp = upsertThirdParty('SharedTp')
    insertSupplyChainEdge(svc1.id, tp.id, doc1.id)
    insertSupplyChainEdge(svc2.id, tp.id, doc2.id)
    expect(getEdgesForService(svc1.id)).toHaveLength(1)
    expect(getEdgesForService(svc2.id)).toHaveLength(1)
  })
})
