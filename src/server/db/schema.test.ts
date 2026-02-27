import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import { getDb, setDb, resetDb, initialiseDb } from './schema.js'

let testDb: Database.Database

beforeEach(() => {
  testDb = new Database(':memory:')
  setDb(testDb)
  initialiseDb(testDb) // getDb() skips initialise() when db is already set — call explicitly
})

afterEach(() => {
  testDb.close()
  resetDb()
})

// ---------------------------------------------------------------------------
// Table creation
// ---------------------------------------------------------------------------

describe('table creation', () => {
  it('creates the services table with correct columns', () => {
    getDb()
    const cols = testDb.prepare("PRAGMA table_info('services')").all() as Array<{ name: string }>
    const names = cols.map(c => c.name)
    expect(names).toContain('id')
    expect(names).toContain('name')
    expect(names).toContain('url')
    expect(names).toContain('category')
    expect(names).toContain('created_at')
    expect(names).toContain('updated_at')
  })

  it('creates the policy_documents table with correct columns', () => {
    getDb()
    const cols = testDb.prepare("PRAGMA table_info('policy_documents')").all() as Array<{ name: string }>
    const names = cols.map(c => c.name)
    expect(names).toContain('id')
    expect(names).toContain('service_id')
    expect(names).toContain('retrieved_at')
    expect(names).toContain('source_url')
    expect(names).toContain('file_path')
    expect(names).toContain('content_hash')
    expect(names).toContain('status')
  })

  it('creates the policy_analyses table with correct columns', () => {
    getDb()
    const cols = testDb.prepare("PRAGMA table_info('policy_analyses')").all() as Array<{ name: string }>
    const names = cols.map(c => c.name)
    expect(names).toContain('summary')
    expect(names).toContain('data_collected')
    expect(names).toContain('purposes')
    expect(names).toContain('legal_bases')
    expect(names).toContain('raw_response')
  })

  it('creates the third_parties table with correct columns', () => {
    getDb()
    const cols = testDb.prepare("PRAGMA table_info('third_parties')").all() as Array<{ name: string }>
    const names = cols.map(c => c.name)
    expect(names).toContain('id')
    expect(names).toContain('name')
    expect(names).toContain('url')
    expect(names).toContain('category')
  })

  it('creates the supply_chain_edges table with correct columns', () => {
    getDb()
    const cols = testDb.prepare("PRAGMA table_info('supply_chain_edges')").all() as Array<{ name: string }>
    const names = cols.map(c => c.name)
    expect(names).toContain('from_service_id')
    expect(names).toContain('to_third_party_id')
    expect(names).toContain('document_id')
    expect(names).toContain('context_snippet')
  })

  it('creates the legal_documents table with correct columns', () => {
    getDb()
    const cols = testDb.prepare("PRAGMA table_info('legal_documents')").all() as Array<{ name: string }>
    const names = cols.map(c => c.name)
    expect(names).toContain('doc_type')
    expect(names).toContain('resolved_url')
    expect(names).toContain('discovery_method')
    expect(names).toContain('is_regulation_specific')
  })

  it('creates the legal_checklist_items table with correct columns', () => {
    getDb()
    const cols = testDb.prepare("PRAGMA table_info('legal_checklist_items')").all() as Array<{ name: string }>
    const names = cols.map(c => c.name)
    expect(names).toContain('doc_type')
    expect(names).toContain('required')
    expect(names).toContain('found')
    expect(names).toContain('document_id')
  })

  it('creates the service_resource_hubs table with correct columns', () => {
    getDb()
    const cols = testDb.prepare("PRAGMA table_info('service_resource_hubs')").all() as Array<{ name: string }>
    const names = cols.map(c => c.name)
    expect(names).toContain('hub_type')
    expect(names).toContain('url')
    expect(names).toContain('confidence')
  })

  it('creates the service_discovery_runs table with correct columns', () => {
    getDb()
    const cols = testDb.prepare("PRAGMA table_info('service_discovery_runs')").all() as Array<{ name: string }>
    const names = cols.map(c => c.name)
    expect(names).toContain('status')
    expect(names).toContain('started_at')
    expect(names).toContain('finished_at')
    expect(names).toContain('stats_json')
  })

  it('creates the service_sitemaps table with correct columns', () => {
    getDb()
    const cols = testDb.prepare("PRAGMA table_info('service_sitemaps')").all() as Array<{ name: string }>
    const names = cols.map(c => c.name)
    expect(names).toContain('sitemap_url')
    expect(names).toContain('file_path')
    expect(names).toContain('page_count')
    expect(names).toContain('status')
  })

  it('creates the service_sitemap_pages table with correct columns', () => {
    getDb()
    const cols = testDb.prepare("PRAGMA table_info('service_sitemap_pages')").all() as Array<{ name: string }>
    const names = cols.map(c => c.name)
    expect(names).toContain('sitemap_id')
    expect(names).toContain('url')
    expect(names).toContain('selected')
    expect(names).toContain('collected')
    expect(names).toContain('analysed')
  })

  it('is idempotent — calling getDb() twice does not throw', () => {
    expect(() => { getDb(); getDb() }).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

describe('indexes', () => {
  it('creates idx_policy_documents_service_id', () => {
    getDb()
    const indexes = testDb.prepare("PRAGMA index_list('policy_documents')").all() as Array<{ name: string }>
    expect(indexes.some(i => i.name === 'idx_policy_documents_service_id')).toBe(true)
  })

  it('creates idx_policy_analyses_document_id', () => {
    getDb()
    const indexes = testDb.prepare("PRAGMA index_list('policy_analyses')").all() as Array<{ name: string }>
    expect(indexes.some(i => i.name === 'idx_policy_analyses_document_id')).toBe(true)
  })

  it('creates supply_chain_edges indexes', () => {
    getDb()
    const indexes = testDb.prepare("PRAGMA index_list('supply_chain_edges')").all() as Array<{ name: string }>
    const names = indexes.map(i => i.name)
    expect(names.some(n => n.includes('from'))).toBe(true)
  })

  it('creates legal discovery indexes', () => {
    getDb()
    const docIdx = testDb.prepare("PRAGMA index_list('legal_documents')").all() as Array<{ name: string }>
    const runIdx = testDb.prepare("PRAGMA index_list('service_discovery_runs')").all() as Array<{ name: string }>
    expect(docIdx.some(i => i.name === 'idx_legal_documents_service_doc_type')).toBe(true)
    expect(docIdx.some(i => i.name === 'idx_legal_documents_service_content_hash')).toBe(true)
    expect(runIdx.some(i => i.name === 'idx_service_discovery_runs_service_started')).toBe(true)
  })

  it('creates sitemap indexes', () => {
    getDb()
    const sitemapIdx = testDb.prepare("PRAGMA index_list('service_sitemaps')").all() as Array<{ name: string }>
    const pageIdx = testDb.prepare("PRAGMA index_list('service_sitemap_pages')").all() as Array<{ name: string }>
    expect(sitemapIdx.some(i => i.name === 'idx_service_sitemaps_service_retrieved')).toBe(true)
    expect(pageIdx.some(i => i.name === 'idx_service_sitemap_pages_sitemap')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Foreign key enforcement
// ---------------------------------------------------------------------------

describe('foreign key constraints', () => {
  it('enables foreign key enforcement', () => {
    getDb()
    const result = testDb.pragma('foreign_keys', { simple: true })
    expect(result).toBe(1)
  })

  it('rejects a policy_document referencing a nonexistent service_id', () => {
    getDb()
    expect(() => {
      testDb.prepare(`
        INSERT INTO policy_documents (id, service_id, source_url, file_path, content_hash)
        VALUES ('d1', 'nonexistent-svc', 'https://x.com/p', '/tmp/p.html', 'hash1')
      `).run()
    }).toThrow()
  })

  it('cascades delete from services to policy_documents', () => {
    getDb()
    testDb.prepare(`INSERT INTO services (id, name, url) VALUES ('s1', 'Test', 'https://test.com')`).run()
    testDb.prepare(`
      INSERT INTO policy_documents (id, service_id, source_url, file_path, content_hash)
      VALUES ('d1', 's1', 'https://test.com/p', '/tmp/p.html', 'hash1')
    `).run()
    testDb.prepare(`DELETE FROM services WHERE id = 's1'`).run()
    const docs = testDb.prepare(`SELECT * FROM policy_documents WHERE service_id = 's1'`).all()
    expect(docs).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// setDb / resetDb
// ---------------------------------------------------------------------------

describe('setDb / resetDb', () => {
  it('setDb causes getDb() to return the injected instance', () => {
    const db = getDb()
    expect(db).toBe(testDb)
  })

  it('resetDb does not throw', () => {
    getDb()
    expect(() => resetDb()).not.toThrow()
  })
})
