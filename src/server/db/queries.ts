import { randomUUID } from 'node:crypto'
import { getDb } from './schema.js'
import type { PolicyAnalysisResult } from '../services/analyser.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Service {
  id: string
  name: string
  url: string
  category: string | null
  created_at: string
  updated_at: string
}

export interface PolicyDocument {
  id: string
  service_id: string
  retrieved_at: string
  source_url: string
  file_path: string
  content_hash: string
  status: string
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export function insertService(name: string, url: string, category?: string): Service {
  const db = getDb()
  const id = randomUUID()
  db.prepare(`
    INSERT INTO services (id, name, url, category)
    VALUES (?, ?, ?, ?)
  `).run(id, name, url, category ?? null)
  return getServiceById(id)!
}

export function getServiceById(id: string): Service | undefined {
  return getDb()
    .prepare('SELECT * FROM services WHERE id = ?')
    .get(id) as Service | undefined
}

export function getAllServices(): Service[] {
  return getDb()
    .prepare('SELECT * FROM services ORDER BY name ASC')
    .all() as Service[]
}

export function findServiceByNormalizedDomain(domain: string): Service | undefined {
  const target = normaliseHostname(domain)
  if (!target) return undefined

  return getAllServices().find((service) => {
    const serviceDomain = extractNormalisedDomain(service.url)
    return serviceDomain === target
  })
}

export function deleteService(id: string): void {
  getDb().prepare('DELETE FROM services WHERE id = ?').run(id)
}

function extractNormalisedDomain(input: string): string | null {
  try {
    const value = input.startsWith('http') ? input : `https://${input}`
    return normaliseHostname(new URL(value).hostname)
  } catch {
    return null
  }
}

function normaliseHostname(hostname: string): string | null {
  const trimmed = hostname.trim().toLowerCase()
  if (!trimmed) return null
  return trimmed.replace(/^www\./, '')
}

// ---------------------------------------------------------------------------
// Policy documents
// ---------------------------------------------------------------------------

export function insertPolicyDocument(
  serviceId: string,
  sourceUrl: string,
  filePath: string,
  contentHash: string,
): PolicyDocument {
  const db = getDb()
  const id = randomUUID()
  db.prepare(`
    INSERT INTO policy_documents (id, service_id, source_url, file_path, content_hash)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, serviceId, sourceUrl, filePath, contentHash)
  return getDocumentById(id)!
}

export function getDocumentById(id: string): PolicyDocument | undefined {
  return getDb()
    .prepare('SELECT * FROM policy_documents WHERE id = ?')
    .get(id) as PolicyDocument | undefined
}

export function getLatestDocumentForService(serviceId: string): PolicyDocument | undefined {
  return getDb()
    .prepare(`
      SELECT * FROM policy_documents
      WHERE service_id = ?
      ORDER BY retrieved_at DESC
      LIMIT 1
    `)
    .get(serviceId) as PolicyDocument | undefined
}

export function getDocumentsForService(serviceId: string): PolicyDocument[] {
  return getDb()
    .prepare(`
      SELECT * FROM policy_documents
      WHERE service_id = ?
      ORDER BY retrieved_at DESC
    `)
    .all(serviceId) as PolicyDocument[]
}

// ---------------------------------------------------------------------------
// Policy analyses
// ---------------------------------------------------------------------------

export interface PolicyAnalysis {
  id: string
  document_id: string
  analysed_at: string
  llm_provider: string
  summary: string | null
  data_collected: string | null   // JSON array
  purposes: string | null         // JSON array
  legal_bases: string | null      // JSON array
  retention: string | null        // JSON string
  user_rights: string | null      // JSON array
  contact: string | null          // JSON object
  raw_response: string | null     // full LLM response JSON
}

export function insertPolicyAnalysis(
  documentId: string,
  llmProvider: string,
  result: PolicyAnalysisResult,
  rawResponse: unknown,
): PolicyAnalysis {
  const db = getDb()
  const id = randomUUID()
  db.prepare(`
    INSERT INTO policy_analyses
      (id, document_id, llm_provider, summary, data_collected, purposes,
       legal_bases, retention, user_rights, contact, raw_response)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    documentId,
    llmProvider,
    result.summary,
    JSON.stringify(result.dataCollected),
    JSON.stringify(result.purposes),
    JSON.stringify(result.legalBases),
    result.retention,
    JSON.stringify(result.userRights),
    JSON.stringify(result.contact),
    JSON.stringify(rawResponse),
  )
  return getAnalysisById(id)!
}

export function getAnalysisById(id: string): PolicyAnalysis | undefined {
  return getDb()
    .prepare('SELECT * FROM policy_analyses WHERE id = ?')
    .get(id) as PolicyAnalysis | undefined
}

export function getLatestAnalysisForDocument(documentId: string): PolicyAnalysis | undefined {
  return getDb()
    .prepare(`
      SELECT * FROM policy_analyses
      WHERE document_id = ?
      ORDER BY analysed_at DESC
      LIMIT 1
    `)
    .get(documentId) as PolicyAnalysis | undefined
}

// ---------------------------------------------------------------------------
// Third parties
// ---------------------------------------------------------------------------

export interface ThirdParty {
  id: string
  name: string
  url: string | null
  category: string | null
}

export function upsertThirdParty(name: string, url?: string, category?: string): ThirdParty {
  const db = getDb()
  // Try to find existing by name
  const existing = db
    .prepare('SELECT * FROM third_parties WHERE name = ?')
    .get(name) as ThirdParty | undefined
  if (existing) return existing

  const id = randomUUID()
  db.prepare(`
    INSERT INTO third_parties (id, name, url, category)
    VALUES (?, ?, ?, ?)
  `).run(id, name, url ?? null, category ?? null)
  return db.prepare('SELECT * FROM third_parties WHERE id = ?').get(id) as ThirdParty
}

export function getAllThirdParties(): ThirdParty[] {
  return getDb()
    .prepare('SELECT * FROM third_parties ORDER BY name ASC')
    .all() as ThirdParty[]
}

// ---------------------------------------------------------------------------
// Supply chain edges
// ---------------------------------------------------------------------------

export interface SupplyChainEdge {
  id: string
  from_service_id: string
  to_third_party_id: string
  document_id: string
  context_snippet: string | null
}

export function insertSupplyChainEdge(
  fromServiceId: string,
  toThirdPartyId: string,
  documentId: string,
  contextSnippet?: string,
): void {
  const db = getDb()
  const id = randomUUID()
  // INSERT OR IGNORE respects the UNIQUE constraint without throwing
  db.prepare(`
    INSERT OR IGNORE INTO supply_chain_edges
      (id, from_service_id, to_third_party_id, document_id, context_snippet)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, fromServiceId, toThirdPartyId, documentId, contextSnippet ?? null)
}

export function getEdgesForService(serviceId: string): SupplyChainEdge[] {
  return getDb()
    .prepare(`
      SELECT * FROM supply_chain_edges
      WHERE from_service_id = ?
    `)
    .all(serviceId) as SupplyChainEdge[]
}

export function getThirdPartyById(id: string): ThirdParty | undefined {
  return getDb()
    .prepare('SELECT * FROM third_parties WHERE id = ?')
    .get(id) as ThirdParty | undefined
}
