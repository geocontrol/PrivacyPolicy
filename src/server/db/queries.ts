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

export interface LegalDocument {
  id: string
  service_id: string
  doc_type: string
  title: string | null
  source_url: string
  resolved_url: string
  file_path: string
  content_hash: string
  retrieved_at: string
  status: string
  discovery_method: string
  is_regulation_specific: number
  regulation_tag: string | null
}

export interface LegalChecklistItem {
  id: string
  service_id: string
  doc_type: string
  required: number
  found: number
  document_id: string | null
  notes: string | null
  updated_at: string
}

export interface ServiceResourceHub {
  id: string
  service_id: string
  hub_type: string
  url: string
  title: string | null
  confidence: number
  notes: string | null
  detected_at: string
}

export interface ServiceDiscoveryRun {
  id: string
  service_id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'partial'
  started_at: string
  finished_at: string | null
  error: string | null
  stats_json: string | null
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
// Legal discovery documents/checklists/resource hubs/runs
// ---------------------------------------------------------------------------

export function insertOrUpdateLegalDocument(input: {
  serviceId: string
  docType: string
  title?: string
  sourceUrl: string
  resolvedUrl: string
  filePath: string
  contentHash: string
  status?: string
  discoveryMethod: string
  isRegulationSpecific?: boolean
  regulationTag?: string
}): LegalDocument {
  const db = getDb()

  const existing = db.prepare(`
    SELECT * FROM legal_documents
    WHERE service_id = ? AND doc_type = ? AND resolved_url = ?
  `).get(input.serviceId, input.docType, input.resolvedUrl) as LegalDocument | undefined

  if (existing) {
    db.prepare(`
      UPDATE legal_documents
      SET title = ?, source_url = ?, file_path = ?, content_hash = ?, status = ?,
          discovery_method = ?, is_regulation_specific = ?, regulation_tag = ?,
          retrieved_at = datetime('now')
      WHERE id = ?
    `).run(
      input.title ?? null,
      input.sourceUrl,
      input.filePath,
      input.contentHash,
      input.status ?? 'retrieved',
      input.discoveryMethod,
      input.isRegulationSpecific ? 1 : 0,
      input.regulationTag ?? null,
      existing.id,
    )
    return getLegalDocumentById(existing.id)!
  }

  const id = randomUUID()
  db.prepare(`
    INSERT INTO legal_documents
      (id, service_id, doc_type, title, source_url, resolved_url, file_path, content_hash,
       status, discovery_method, is_regulation_specific, regulation_tag)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.serviceId,
    input.docType,
    input.title ?? null,
    input.sourceUrl,
    input.resolvedUrl,
    input.filePath,
    input.contentHash,
    input.status ?? 'retrieved',
    input.discoveryMethod,
    input.isRegulationSpecific ? 1 : 0,
    input.regulationTag ?? null,
  )

  return getLegalDocumentById(id)!
}

export function getLegalDocumentById(id: string): LegalDocument | undefined {
  return getDb()
    .prepare('SELECT * FROM legal_documents WHERE id = ?')
    .get(id) as LegalDocument | undefined
}

export function getLegalDocumentsForService(serviceId: string): LegalDocument[] {
  return getDb()
    .prepare(`
      SELECT * FROM legal_documents
      WHERE service_id = ?
      ORDER BY retrieved_at DESC
    `)
    .all(serviceId) as LegalDocument[]
}

export function upsertLegalChecklistItem(input: {
  serviceId: string
  docType: string
  required: boolean
  found: boolean
  documentId?: string
  notes?: string
}): LegalChecklistItem {
  const db = getDb()
  const existing = db.prepare(`
    SELECT * FROM legal_checklist_items
    WHERE service_id = ? AND doc_type = ?
  `).get(input.serviceId, input.docType) as LegalChecklistItem | undefined

  if (existing) {
    db.prepare(`
      UPDATE legal_checklist_items
      SET required = ?, found = ?, document_id = ?, notes = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(
      input.required ? 1 : 0,
      input.found ? 1 : 0,
      input.documentId ?? null,
      input.notes ?? null,
      existing.id,
    )
    return getLegalChecklistItemById(existing.id)!
  }

  const id = randomUUID()
  db.prepare(`
    INSERT INTO legal_checklist_items
      (id, service_id, doc_type, required, found, document_id, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.serviceId,
    input.docType,
    input.required ? 1 : 0,
    input.found ? 1 : 0,
    input.documentId ?? null,
    input.notes ?? null,
  )
  return getLegalChecklistItemById(id)!
}

export function getLegalChecklistForService(serviceId: string): LegalChecklistItem[] {
  return getDb()
    .prepare(`
      SELECT * FROM legal_checklist_items
      WHERE service_id = ?
      ORDER BY doc_type ASC
    `)
    .all(serviceId) as LegalChecklistItem[]
}

function getLegalChecklistItemById(id: string): LegalChecklistItem | undefined {
  return getDb()
    .prepare('SELECT * FROM legal_checklist_items WHERE id = ?')
    .get(id) as LegalChecklistItem | undefined
}

export function upsertServiceResourceHub(input: {
  serviceId: string
  hubType: string
  url: string
  title?: string
  confidence?: number
  notes?: string
}): ServiceResourceHub {
  const db = getDb()
  const existing = db.prepare(`
    SELECT * FROM service_resource_hubs
    WHERE service_id = ? AND hub_type = ? AND url = ?
  `).get(input.serviceId, input.hubType, input.url) as ServiceResourceHub | undefined

  if (existing) {
    db.prepare(`
      UPDATE service_resource_hubs
      SET title = ?, confidence = ?, notes = ?, detected_at = datetime('now')
      WHERE id = ?
    `).run(input.title ?? null, input.confidence ?? 0.5, input.notes ?? null, existing.id)
    return getServiceResourceHubById(existing.id)!
  }

  const id = randomUUID()
  db.prepare(`
    INSERT INTO service_resource_hubs
      (id, service_id, hub_type, url, title, confidence, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.serviceId,
    input.hubType,
    input.url,
    input.title ?? null,
    input.confidence ?? 0.5,
    input.notes ?? null,
  )
  return getServiceResourceHubById(id)!
}

export function getResourceHubsForService(serviceId: string): ServiceResourceHub[] {
  return getDb()
    .prepare(`
      SELECT * FROM service_resource_hubs
      WHERE service_id = ?
      ORDER BY detected_at DESC
    `)
    .all(serviceId) as ServiceResourceHub[]
}

function getServiceResourceHubById(id: string): ServiceResourceHub | undefined {
  return getDb()
    .prepare('SELECT * FROM service_resource_hubs WHERE id = ?')
    .get(id) as ServiceResourceHub | undefined
}

export function createDiscoveryRun(
  serviceId: string,
  status: ServiceDiscoveryRun['status'] = 'queued',
): ServiceDiscoveryRun {
  const db = getDb()
  const id = randomUUID()
  db.prepare(`
    INSERT INTO service_discovery_runs (id, service_id, status)
    VALUES (?, ?, ?)
  `).run(id, serviceId, status)
  return getDiscoveryRunById(id)!
}

export function updateDiscoveryRunStatus(
  runId: string,
  status: ServiceDiscoveryRun['status'],
  options?: { error?: string; statsJson?: unknown },
): ServiceDiscoveryRun | undefined {
  const db = getDb()
  const finishedAt = status === 'running' || status === 'queued' ? null : "datetime('now')"
  db.prepare(`
    UPDATE service_discovery_runs
    SET status = ?,
        finished_at = ${finishedAt ?? 'NULL'},
        error = ?,
        stats_json = ?
    WHERE id = ?
  `).run(
    status,
    options?.error ?? null,
    options?.statsJson ? JSON.stringify(options.statsJson) : null,
    runId,
  )
  return getDiscoveryRunById(runId)
}

export function getLatestDiscoveryRunForService(serviceId: string): ServiceDiscoveryRun | undefined {
  return getDb()
    .prepare(`
      SELECT * FROM service_discovery_runs
      WHERE service_id = ?
      ORDER BY started_at DESC
      LIMIT 1
    `)
    .get(serviceId) as ServiceDiscoveryRun | undefined
}

function getDiscoveryRunById(id: string): ServiceDiscoveryRun | undefined {
  return getDb()
    .prepare('SELECT * FROM service_discovery_runs WHERE id = ?')
    .get(id) as ServiceDiscoveryRun | undefined
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
