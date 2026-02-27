import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.resolve(__dirname, '../../../data/db.sqlite')

let db: Database.Database | undefined

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH)
    initialise(db)
  }
  return db
}

/**
 * Replace the singleton DB instance. For test use only — allows tests to
 * inject an in-memory database before any module calls getDb().
 */
export function setDb(instance: Database.Database): void {
  db = instance
}

/**
 * Clear the singleton so the next getDb() call re-initialises from DB_PATH.
 * Call in test teardown (afterAll / afterEach).
 */
export function resetDb(): void {
  db = undefined
}

/**
 * Run the schema initialisation (CREATE TABLE IF NOT EXISTS, PRAGMAs, indexes)
 * on the given database instance. Called automatically by getDb() on first use,
 * but exposed here so tests can call it explicitly after setDb().
 */
export function initialiseDb(instance: Database.Database): void {
  initialise(instance)
}

function initialise(db: Database.Database): void {
  // WAL mode is incompatible with :memory: databases — skip it for in-memory instances
  if (!db.memory) {
    db.pragma('journal_mode = WAL')
  }
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS services (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      url         TEXT NOT NULL,
      category    TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS policy_documents (
      id            TEXT PRIMARY KEY,
      service_id    TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      retrieved_at  TEXT NOT NULL DEFAULT (datetime('now')),
      source_url    TEXT NOT NULL,
      file_path     TEXT NOT NULL,
      content_hash  TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'retrieved'
    );

    CREATE TABLE IF NOT EXISTS policy_analyses (
      id              TEXT PRIMARY KEY,
      document_id     TEXT NOT NULL REFERENCES policy_documents(id) ON DELETE CASCADE,
      analysed_at     TEXT NOT NULL DEFAULT (datetime('now')),
      llm_provider    TEXT NOT NULL DEFAULT 'anthropic',
      summary         TEXT,
      data_collected  TEXT,
      purposes        TEXT,
      legal_bases     TEXT,
      retention       TEXT,
      user_rights     TEXT,
      contact         TEXT,
      raw_response    TEXT
    );

    CREATE TABLE IF NOT EXISTS third_parties (
      id        TEXT PRIMARY KEY,
      name      TEXT NOT NULL UNIQUE,
      url       TEXT,
      category  TEXT
    );

    CREATE TABLE IF NOT EXISTS supply_chain_edges (
      id                TEXT PRIMARY KEY,
      from_service_id   TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      to_third_party_id TEXT NOT NULL REFERENCES third_parties(id) ON DELETE CASCADE,
      document_id       TEXT NOT NULL REFERENCES policy_documents(id) ON DELETE CASCADE,
      context_snippet   TEXT,
      UNIQUE(from_service_id, to_third_party_id, document_id)
    );

    CREATE TABLE IF NOT EXISTS legal_documents (
      id                      TEXT PRIMARY KEY,
      service_id              TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      doc_type                TEXT NOT NULL,
      title                   TEXT,
      source_url              TEXT NOT NULL,
      resolved_url            TEXT NOT NULL,
      file_path               TEXT NOT NULL,
      content_hash            TEXT NOT NULL,
      retrieved_at            TEXT NOT NULL DEFAULT (datetime('now')),
      status                  TEXT NOT NULL DEFAULT 'retrieved',
      discovery_method        TEXT NOT NULL,
      is_regulation_specific  INTEGER NOT NULL DEFAULT 0,
      regulation_tag          TEXT,
      UNIQUE(service_id, doc_type, resolved_url)
    );

    CREATE TABLE IF NOT EXISTS legal_checklist_items (
      id          TEXT PRIMARY KEY,
      service_id  TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      doc_type    TEXT NOT NULL,
      required    INTEGER NOT NULL DEFAULT 1,
      found       INTEGER NOT NULL DEFAULT 0,
      document_id TEXT REFERENCES legal_documents(id) ON DELETE SET NULL,
      notes       TEXT,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(service_id, doc_type)
    );

    CREATE TABLE IF NOT EXISTS service_resource_hubs (
      id          TEXT PRIMARY KEY,
      service_id  TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      hub_type    TEXT NOT NULL,
      url         TEXT NOT NULL,
      title       TEXT,
      confidence  REAL NOT NULL DEFAULT 0.5,
      notes       TEXT,
      detected_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(service_id, hub_type, url)
    );

    CREATE TABLE IF NOT EXISTS service_discovery_runs (
      id          TEXT PRIMARY KEY,
      service_id  TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      status      TEXT NOT NULL,
      started_at  TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      error       TEXT,
      stats_json  TEXT
    );

    CREATE TABLE IF NOT EXISTS service_sitemaps (
      id            TEXT PRIMARY KEY,
      service_id    TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
      sitemap_url   TEXT NOT NULL,
      file_path     TEXT NOT NULL,
      retrieved_at  TEXT NOT NULL DEFAULT (datetime('now')),
      page_count    INTEGER NOT NULL DEFAULT 0,
      status        TEXT NOT NULL DEFAULT 'retrieved',
      message       TEXT
    );

    CREATE TABLE IF NOT EXISTS service_sitemap_pages (
      id                TEXT PRIMARY KEY,
      sitemap_id        TEXT NOT NULL REFERENCES service_sitemaps(id) ON DELETE CASCADE,
      url               TEXT NOT NULL,
      selected          INTEGER NOT NULL DEFAULT 0,
      collected         INTEGER NOT NULL DEFAULT 0,
      analysed          INTEGER NOT NULL DEFAULT 0,
      last_error        TEXT,
      last_collected_at TEXT,
      UNIQUE(sitemap_id, url)
    );

    CREATE INDEX IF NOT EXISTS idx_policy_documents_service_id
      ON policy_documents(service_id);

    CREATE INDEX IF NOT EXISTS idx_policy_analyses_document_id
      ON policy_analyses(document_id);

    CREATE INDEX IF NOT EXISTS idx_supply_chain_edges_from
      ON supply_chain_edges(from_service_id);

    CREATE INDEX IF NOT EXISTS idx_supply_chain_edges_to
      ON supply_chain_edges(to_third_party_id);

    CREATE INDEX IF NOT EXISTS idx_legal_documents_service_doc_type
      ON legal_documents(service_id, doc_type);

    CREATE INDEX IF NOT EXISTS idx_legal_documents_service_content_hash
      ON legal_documents(service_id, content_hash);

    CREATE INDEX IF NOT EXISTS idx_legal_checklist_items_service_doc_type
      ON legal_checklist_items(service_id, doc_type);

    CREATE INDEX IF NOT EXISTS idx_service_discovery_runs_service_started
      ON service_discovery_runs(service_id, started_at DESC);

    CREATE INDEX IF NOT EXISTS idx_service_sitemaps_service_retrieved
      ON service_sitemaps(service_id, retrieved_at DESC);

    CREATE INDEX IF NOT EXISTS idx_service_sitemap_pages_sitemap
      ON service_sitemap_pages(sitemap_id);
  `)
}
