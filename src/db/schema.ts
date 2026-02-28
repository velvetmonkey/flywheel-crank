/**
 * Database schema for flywheel-crank.
 *
 * Crank is a lightweight consumer of memory's schema. Memory owns the full
 * DDL (v11+, 27+ tables, migrations). This file only defines the tables
 * crank directly writes to, as fallback for standalone/fresh DBs.
 */

import type Database from './sql-js-adapter';

/** Minimum schema version crank can operate against */
export const MIN_SCHEMA_VERSION = 11;

/** Minimal DDL — only tables crank directly writes to.
 * Memory owns the full schema; this is fallback for standalone crank. */
const CRANK_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT DEFAULT (datetime('now'))
);
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  path, title, frontmatter, content,
  tokenize='porter'
);
CREATE TABLE IF NOT EXISTS fts_metadata (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS note_embeddings (
  path TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  content_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS entity_embeddings (
  entity_name TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  source_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

/**
 * Initialize the schema for crank's use.
 *
 * If memory has already created the DB (version >= 11), crank uses it as-is.
 * If the DB is fresh, crank creates only the tables it needs.
 * If the DB is pre-v11 (stale memory), throws — user must restart memory
 * so its migrations bring the schema up to date.
 */
export function initSchema(db: Database): void {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Check if schema_version table exists
  const hasVersionTable = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'`,
  ).get();

  if (hasVersionTable) {
    // Existing DB — check version
    const versionRow = db.prepare(
      'SELECT MAX(version) as version FROM schema_version',
    ).get() as { version: number | null } | undefined;

    const currentVersion = versionRow?.version ?? 0;

    if (currentVersion > 0 && currentVersion < MIN_SCHEMA_VERSION) {
      throw new Error(
        `[flywheel-crank] Database schema version ${currentVersion} is too old (need >= ${MIN_SCHEMA_VERSION}). ` +
        `Restart flywheel-memory to run migrations.`,
      );
    }

    // version >= 11 (or 0 meaning empty table): nothing to do, memory owns the schema
  } else {
    // Fresh DB — create only the tables crank needs
    db.exec(CRANK_TABLES_SQL);
    db.prepare(
      'INSERT OR IGNORE INTO schema_version (version) VALUES (?)',
    ).run(MIN_SCHEMA_VERSION);
  }
}
