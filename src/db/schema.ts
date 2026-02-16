/**
 * Database schema for flywheel-crank.
 *
 * Mirrors the schema from vault-core's sqlite.ts so that the same
 * prepared-statement code works against both better-sqlite3 (Node)
 * and the sql.js-fts5 adapter (Obsidian plugin).
 */

import type Database from './sql-js-adapter';

/** Current schema version — bump when schema changes */
export const SCHEMA_VERSION = 10;

/** The full DDL executed on first open / upgrade */
export const SCHEMA_SQL = `
-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at TEXT DEFAULT (datetime('now'))
);

-- Metadata key-value store
CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Entity index
CREATE TABLE IF NOT EXISTS entities (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  name_lower TEXT NOT NULL,
  path TEXT NOT NULL,
  category TEXT NOT NULL,
  aliases_json TEXT,
  hub_score INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_entities_name_lower ON entities(name_lower);
CREATE INDEX IF NOT EXISTS idx_entities_category ON entities(category);

-- FTS5 for entity search
CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
  name, aliases, category,
  content='entities', content_rowid='id',
  tokenize='porter unicode61'
);

-- Auto-sync triggers for entities_fts
CREATE TRIGGER IF NOT EXISTS entities_ai AFTER INSERT ON entities BEGIN
  INSERT INTO entities_fts(rowid, name, aliases, category)
  VALUES (new.id, new.name,
    COALESCE((SELECT group_concat(value, ' ') FROM json_each(new.aliases_json)), ''),
    new.category);
END;

CREATE TRIGGER IF NOT EXISTS entities_ad AFTER DELETE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, name, aliases, category)
  VALUES ('delete', old.id, old.name,
    COALESCE((SELECT group_concat(value, ' ') FROM json_each(old.aliases_json)), ''),
    old.category);
END;

CREATE TRIGGER IF NOT EXISTS entities_au AFTER UPDATE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, name, aliases, category)
  VALUES ('delete', old.id, old.name,
    COALESCE((SELECT group_concat(value, ' ') FROM json_each(old.aliases_json)), ''),
    old.category);
  INSERT INTO entities_fts(rowid, name, aliases, category)
  VALUES (new.id, new.name,
    COALESCE((SELECT group_concat(value, ' ') FROM json_each(new.aliases_json)), ''),
    new.category);
END;

-- Recency tracking
CREATE TABLE IF NOT EXISTS recency (
  entity_name_lower TEXT PRIMARY KEY,
  last_mentioned_at INTEGER NOT NULL,
  mention_count INTEGER DEFAULT 1
);

-- Write state
CREATE TABLE IF NOT EXISTS write_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Content search FTS5
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  path, title, content,
  tokenize='porter'
);

-- FTS5 build metadata
CREATE TABLE IF NOT EXISTS fts_metadata (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Vault index cache
CREATE TABLE IF NOT EXISTS vault_index_cache (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data BLOB NOT NULL,
  built_at INTEGER NOT NULL,
  note_count INTEGER NOT NULL,
  version INTEGER DEFAULT 1
);

-- Flywheel configuration
CREATE TABLE IF NOT EXISTS flywheel_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Vault metrics (v4)
CREATE TABLE IF NOT EXISTS vault_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vault_metrics_ts ON vault_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_vault_metrics_m ON vault_metrics(metric, timestamp);

-- Wikilink feedback (v4)
CREATE TABLE IF NOT EXISTS wikilink_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  context TEXT NOT NULL,
  note_path TEXT NOT NULL,
  correct INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wl_feedback_entity ON wikilink_feedback(entity);

-- Wikilink suppressions (v4)
CREATE TABLE IF NOT EXISTS wikilink_suppressions (
  entity TEXT PRIMARY KEY,
  false_positive_rate REAL NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Wikilink applications (v5)
CREATE TABLE IF NOT EXISTS wikilink_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity TEXT NOT NULL,
  note_path TEXT NOT NULL,
  applied_at TEXT DEFAULT (datetime('now')),
  status TEXT DEFAULT 'applied'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wl_apps_unique ON wikilink_applications(entity, note_path);

-- Index events (v6)
CREATE TABLE IF NOT EXISTS index_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  trigger TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  success INTEGER NOT NULL DEFAULT 1,
  note_count INTEGER,
  files_changed INTEGER,
  changed_paths TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_index_events_ts ON index_events(timestamp);

-- Tool invocations (v7)
CREATE TABLE IF NOT EXISTS tool_invocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  session_id TEXT,
  note_paths TEXT,
  duration_ms INTEGER,
  success INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_tool_inv_ts ON tool_invocations(timestamp);
CREATE INDEX IF NOT EXISTS idx_tool_inv_tool ON tool_invocations(tool_name, timestamp);
CREATE INDEX IF NOT EXISTS idx_tool_inv_session ON tool_invocations(session_id, timestamp);

-- Graph snapshots (v8)
CREATE TABLE IF NOT EXISTS graph_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  details TEXT
);
CREATE INDEX IF NOT EXISTS idx_graph_snap_ts ON graph_snapshots(timestamp);
CREATE INDEX IF NOT EXISTS idx_graph_snap_m ON graph_snapshots(metric, timestamp);

-- Note embeddings (v9)
CREATE TABLE IF NOT EXISTS note_embeddings (
  path TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  content_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Entity embeddings (v10)
CREATE TABLE IF NOT EXISTS entity_embeddings (
  entity_name TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  source_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`;

/**
 * Initialize the schema and handle version migrations.
 *
 * Safe to call repeatedly — uses CREATE IF NOT EXISTS and checks
 * the schema_version table before applying migrations.
 */
export function initSchema(db: Database): void {
  // WAL mode is a no-op in sql.js but keep for API compat
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run full DDL
  db.exec(SCHEMA_SQL);

  // Verify critical tables were created
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name IN ('entities', 'schema_version', 'metadata')
  `).all() as Array<{ name: string }>;

  if (tables.length < 3) {
    const found = tables.map((t) => t.name).join(', ') || 'none';
    throw new Error(
      `[flywheel-crank] Schema validation failed: expected 3 critical tables, found ${tables.length} (${found}).`,
    );
  }

  // Check current version
  const versionRow = db.prepare(
    'SELECT MAX(version) as version FROM schema_version',
  ).get() as { version: number | null } | undefined;

  const currentVersion = versionRow?.version ?? 0;

  if (currentVersion < SCHEMA_VERSION) {
    // v2: Drop dead notes/links tables from v1
    if (currentVersion < 2) {
      db.exec('DROP TABLE IF EXISTS notes');
      db.exec('DROP TABLE IF EXISTS links');
    }

    // v3: Rename crank_state → write_state
    if (currentVersion < 3) {
      const hasCrankState = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='crank_state'`,
      ).get();
      const hasWriteState = db.prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='write_state'`,
      ).get();
      if (hasCrankState && !hasWriteState) {
        db.exec('ALTER TABLE crank_state RENAME TO write_state');
      } else if (hasCrankState && hasWriteState) {
        db.exec('DROP TABLE crank_state');
      }
    }

    // v4–v10: Tables created by SCHEMA_SQL via CREATE IF NOT EXISTS

    db.prepare(
      'INSERT OR IGNORE INTO schema_version (version) VALUES (?)',
    ).run(SCHEMA_VERSION);
  }
}
