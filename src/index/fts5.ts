/**
 * FTS5 Full-Text Search for vault content
 *
 * Uses the sql.js-fts5 database (via adapter) for full-text search
 * with BM25 ranking, porter stemming, and snippet highlighting.
 */

import { App, TFile } from 'obsidian';
import type { FTS5Result } from '../core/types';

/** Directories to exclude from indexing */
const EXCLUDED_DIRS = new Set([
  '.obsidian', '.trash', '.git', 'node_modules',
  'templates', '.claude', '.flywheel',
]);

/** Maximum file size to index (5MB) */
const MAX_INDEX_FILE_SIZE = 5 * 1024 * 1024;

/** FTS5 index state */
export interface FTS5State {
  ready: boolean;
  lastBuilt: Date | null;
  noteCount: number;
  error: string | null;
}

let db: any = null;
let state: FTS5State = {
  ready: false,
  lastBuilt: null,
  noteCount: 0,
  error: null,
};

/**
 * Set the database handle (from our sql-js adapter)
 */
export function setFTS5Database(database: any): void {
  db = database;

  try {
    const row = db.prepare('SELECT value FROM fts_metadata WHERE key = ?').get('last_built');
    if (row) {
      const lastBuilt = new Date(row.value);
      const countRow = db.prepare('SELECT COUNT(*) as count FROM notes_fts').get();
      state = {
        ready: countRow.count > 0,
        lastBuilt,
        noteCount: countRow.count,
        error: null,
      };
    }
  } catch {
    // Tables may not have data yet
  }
}

/** Check if a file should be indexed */
function shouldIndexFile(filePath: string): boolean {
  const parts = filePath.split('/');
  return !parts.some(part => EXCLUDED_DIRS.has(part));
}

/**
 * Build FTS5 index from vault content
 */
export async function buildFTS5Index(app: App): Promise<FTS5State> {
  try {
    state.error = null;
    if (!db) throw new Error('FTS5 database not initialized');

    // Clear existing index
    db.exec('DELETE FROM notes_fts');

    const files = app.vault.getMarkdownFiles().filter(f => shouldIndexFile(f.path));
    const insert = db.prepare('INSERT INTO notes_fts (path, title, frontmatter, content) VALUES (?, ?, ?, ?)');

    let indexed = 0;

    for (const file of files) {
      if (file.stat.size > MAX_INDEX_FILE_SIZE) continue;

      try {
        const content = await app.vault.cachedRead(file);
        const title = file.basename;
        insert.run(file.path, title, '', content);
        indexed++;
      } catch {
        // Skip files we can't read
      }
    }

    // Update metadata
    const now = new Date();
    db.prepare('INSERT OR REPLACE INTO fts_metadata (key, value) VALUES (?, ?)').run('last_built', now.toISOString());

    state = { ready: true, lastBuilt: now, noteCount: indexed, error: null };
    console.log(`[Flywheel Crank] FTS5 indexed ${indexed} notes`);
    return state;
  } catch (err) {
    state = { ready: false, lastBuilt: null, noteCount: 0, error: err instanceof Error ? err.message : String(err) };
    throw err;
  }
}

/**
 * Check if a path is a daily/periodic note (e.g. 2024-01-15.md, periodicals/*, daily/*, journal/*)
 */
export function isDailyNote(path: string): boolean {
  const basename = path.split('/').pop()?.replace(/\.md$/, '') || '';
  if (/^\d{4}-\d{2}-\d{2}/.test(basename)) return true;
  const lowerPath = path.toLowerCase();
  return lowerPath.includes('periodicals/') || lowerPath.includes('daily/') || lowerPath.includes('journal/');
}

/**
 * Search the FTS5 index
 */
export function searchFTS5(query: string, limit: number = 10): FTS5Result[] {
  if (!db) throw new Error('FTS5 database not initialized');

  try {
    const stmt = db.prepare(`
      SELECT
        path,
        title,
        snippet(notes_fts, 3, '<mark>', '</mark>', '...', 20) as snippet,
        rank
      FROM notes_fts
      WHERE notes_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);

    const raw = stmt.all(query, limit) as Array<{ path: string; title: string; snippet: string; rank: number }>;

    // Normalize BM25 rank to 0-1 score and demote daily notes
    const results: FTS5Result[] = raw.map(r => ({
      path: r.path,
      title: r.title,
      snippet: r.snippet,
      score: 1 / (1 - r.rank),
    }));

    // Stable sort: non-daily notes first, daily notes last (preserving BM25 order within each group)
    const regular = results.filter(r => !isDailyNote(r.path));
    const daily = results.filter(r => isDailyNote(r.path));
    return [...regular, ...daily];
  } catch (err) {
    if (err instanceof Error && err.message.includes('fts5: syntax error')) {
      throw new Error(`Invalid search query: ${query}`);
    }
    throw err;
  }
}

/**
 * Escape FTS5 special characters
 */
export function escapeFts5Query(query: string): string {
  if (!query?.trim()) return '';
  return query
    .replace(/"/g, '""')
    .replace(/[(){}[\]^~:-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Get current FTS5 state */
export function getFTS5State(): FTS5State {
  return { ...state };
}

/**
 * Index a single file (for incremental updates)
 */
export async function indexSingleFile(app: App, file: TFile): Promise<void> {
  if (!db || !shouldIndexFile(file.path)) return;

  try {
    // Remove old entry
    db.prepare('DELETE FROM notes_fts WHERE path = ?').run(file.path);

    // Add new entry
    const content = await app.vault.cachedRead(file);
    const title = file.basename;
    db.prepare('INSERT INTO notes_fts (path, title, frontmatter, content) VALUES (?, ?, ?, ?)').run(file.path, title, '', content);
  } catch {
    // Skip on error
  }
}

/**
 * Remove a file from the index
 */
export function removeFromIndex(filePath: string): void {
  if (!db) return;
  try {
    db.prepare('DELETE FROM notes_fts WHERE path = ?').run(filePath);
  } catch {
    // Ignore
  }
}
