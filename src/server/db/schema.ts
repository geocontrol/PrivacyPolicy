import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.resolve(__dirname, '../../../data/db.sqlite')

let db: Database.Database

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    initialise(db)
  }
  return db
}

function initialise(db: Database.Database): void {
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

    CREATE INDEX IF NOT EXISTS idx_policy_documents_service_id
      ON policy_documents(service_id);

    CREATE INDEX IF NOT EXISTS idx_policy_analyses_document_id
      ON policy_analyses(document_id);

    CREATE INDEX IF NOT EXISTS idx_supply_chain_edges_from
      ON supply_chain_edges(from_service_id);

    CREATE INDEX IF NOT EXISTS idx_supply_chain_edges_to
      ON supply_chain_edges(to_third_party_id);
  `)
}
