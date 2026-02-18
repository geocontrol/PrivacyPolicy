import { randomUUID } from 'node:crypto'
import { getDb } from './schema.js'

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

export function deleteService(id: string): void {
  getDb().prepare('DELETE FROM services WHERE id = ?').run(id)
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
