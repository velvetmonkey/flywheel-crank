/**
 * Semantic Search Embeddings Module
 *
 * Local embedding-based semantic search using @huggingface/transformers
 * with all-MiniLM-L6-v2. Ported from flywheel-memory for Obsidian.
 *
 * Pattern: module-level db handle via setEmbeddingsDatabase(),
 * lazy initialization (model loads on first use).
 */

import { App, TFile, Notice } from 'obsidian';
import { createRequire } from 'module';
import type { FTS5Result } from '../core/types';
import { isDailyNote } from './fts5';

// =============================================================================
// Types
// =============================================================================

export interface ScoredNote {
  path: string;
  title: string;
  score: number;
}

interface EmbeddingRow {
  path: string;
  embedding: Uint8Array;
  content_hash: string;
}

export interface BuildProgress {
  total: number;
  current: number;
  skipped: number;
}

// =============================================================================
// Constants
// =============================================================================

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIMS = 384;

const EXCLUDED_DIRS = new Set([
  '.obsidian', '.trash', '.git', 'node_modules',
  'templates', '.claude', '.flywheel',
]);

const MAX_FILE_SIZE = 5 * 1024 * 1024;

// =============================================================================
// Module State
// =============================================================================

let db: any = null;
let pipeline: any = null;
let initPromise: Promise<void> | null = null;

/** LRU cache for embedText results */
const embeddingCache = new Map<string, Float32Array>();
const EMBEDDING_CACHE_MAX = 500;

/** In-memory entity embeddings for fast cosine search */
const entityEmbeddingsMap = new Map<string, Float32Array>();

// =============================================================================
// Database Injection
// =============================================================================

export function setEmbeddingsDatabase(database: any): void {
  db = database;
}

// =============================================================================
// Lazy Initialization
// =============================================================================

/** Set the plugin directory so we can find node_modules at runtime */
let pluginDir: string | null = null;

export function setPluginDir(dir: string): void {
  pluginDir = dir;
}

/**
 * Load the transformer model. Cached after first call.
 * Downloads ~23MB model on first use to ~/.cache/huggingface/
 */
export async function initEmbeddings(): Promise<void> {
  if (pipeline) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      if (!pluginDir) {
        throw new Error('Plugin directory not set — cannot load transformers');
      }

      // Use Node's createRequire to resolve from the plugin directory.
      // @huggingface/transformers has conditional exports:
      //   exports.node.require → dist/transformers.node.cjs (CJS webpack bundle)
      // This avoids ESM loading issues in Electron's renderer.
      const pluginRequire = createRequire(pluginDir + '/package.json');
      const transformers = pluginRequire('@huggingface/transformers');

      // Configure model cache in plugin directory
      transformers.env.cacheDir = pluginDir + '/models';
      transformers.env.allowLocalModels = true;

      pipeline = await transformers.pipeline('feature-extraction', MODEL_ID, {
        dtype: 'fp32',
      });
    } catch (err: unknown) {
      initPromise = null;
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Flywheel Crank: embeddings init failed:', msg);
      if (
        msg.includes('Cannot find package') ||
        msg.includes('MODULE_NOT_FOUND') ||
        msg.includes('Cannot find module') ||
        msg.includes('ERR_MODULE_NOT_FOUND') ||
        msg.includes('ERR_DLOPEN_FAILED')
      ) {
        throw new Error(
          'Semantic search requires @huggingface/transformers + onnxruntime-node. ' +
          'Ensure they are installed in the plugin folder.'
        );
      }
      throw err;
    }
  })();

  return initPromise;
}

/** Check if model is loaded */
export function isEmbeddingsReady(): boolean {
  return pipeline !== null;
}

// =============================================================================
// Embedding Generation
// =============================================================================

/**
 * Generate embedding for a text string.
 * Returns Float32Array of 384 dimensions.
 */
export async function embedText(text: string): Promise<Float32Array> {
  await initEmbeddings();

  // Truncate to ~512 tokens (~2000 chars)
  const truncated = text.slice(0, 2000);
  const result = await pipeline(truncated, { pooling: 'mean', normalize: true });
  return new Float32Array(result.data);
}

/**
 * LRU-cached wrapper around embedText().
 */
export async function embedTextCached(text: string): Promise<Float32Array> {
  const existing = embeddingCache.get(text);
  if (existing) return existing;

  const embedding = await embedText(text);

  if (embeddingCache.size >= EMBEDDING_CACHE_MAX) {
    const firstKey = embeddingCache.keys().next().value;
    if (firstKey !== undefined) embeddingCache.delete(firstKey);
  }

  embeddingCache.set(text, embedding);
  return embedding;
}

// =============================================================================
// Content Hashing (browser-compatible, no Node crypto)
// =============================================================================

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0; // 32-bit int
  }
  // Use two passes with different seeds for collision resistance
  let hash2 = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash2 ^= str.charCodeAt(i);
    hash2 = Math.imul(hash2, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0') + (hash2 >>> 0).toString(16).padStart(8, '0');
}

// =============================================================================
// Float32Array ↔ Uint8Array conversion (for sql.js BLOB storage)
// =============================================================================

function float32ToUint8(arr: Float32Array): Uint8Array {
  return new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
}

function uint8ToFloat32(arr: Uint8Array | ArrayBuffer): Float32Array {
  const bytes = arr instanceof Uint8Array ? arr : new Uint8Array(arr);
  // Ensure alignment by copying to a new buffer
  const aligned = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(aligned).set(bytes);
  return new Float32Array(aligned);
}

// =============================================================================
// Index Building
// =============================================================================

function shouldIndexFile(filePath: string): boolean {
  const parts = filePath.split('/');
  return !parts.some(part => EXCLUDED_DIRS.has(part));
}

/**
 * Build embeddings for all vault notes.
 * Skips notes whose content hasn't changed (by content hash).
 */
export async function buildEmbeddingsIndex(
  app: App,
  onProgress?: (progress: BuildProgress) => void
): Promise<BuildProgress> {
  if (!db) throw new Error('Embeddings database not initialized');

  await initEmbeddings();

  const files = app.vault.getMarkdownFiles().filter(f => shouldIndexFile(f.path));

  // Load existing hashes for change detection
  const existingHashes = new Map<string, string>();
  try {
    const rows = db.prepare('SELECT path, content_hash FROM note_embeddings').all() as Array<{ path: string; content_hash: string }>;
    for (const row of rows) {
      existingHashes.set(row.path, row.content_hash);
    }
  } catch { /* table might not have data */ }

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO note_embeddings (path, embedding, content_hash, model, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const progress: BuildProgress = { total: files.length, current: 0, skipped: 0 };

  for (const file of files) {
    progress.current++;

    try {
      if (file.stat.size > MAX_FILE_SIZE) {
        progress.skipped++;
        continue;
      }

      const content = await app.vault.cachedRead(file);
      const hash = simpleHash(content);

      // Skip if unchanged
      if (existingHashes.get(file.path) === hash) {
        progress.skipped++;
        if (onProgress) onProgress(progress);
        continue;
      }

      const embedding = await embedText(content);
      upsert.run(file.path, float32ToUint8(embedding), hash, MODEL_ID, Date.now());
    } catch {
      progress.skipped++;
    }

    if (onProgress) onProgress(progress);
  }

  // Remove embeddings for deleted notes
  const currentPaths = new Set(files.map(f => f.path));
  const deleteStmt = db.prepare('DELETE FROM note_embeddings WHERE path = ?');
  for (const existingPath of existingHashes.keys()) {
    if (!currentPaths.has(existingPath)) {
      deleteStmt.run(existingPath);
    }
  }

  console.log(`[Flywheel Crank] Semantic: indexed ${progress.current - progress.skipped} notes, skipped ${progress.skipped}`);
  return progress;
}

/**
 * Update embedding for a single note (incremental).
 */
export async function updateNoteEmbedding(app: App, file: TFile): Promise<void> {
  if (!db || !pipeline) return;
  if (!shouldIndexFile(file.path)) return;

  try {
    const content = await app.vault.cachedRead(file);
    const hash = simpleHash(content);

    const existing = db.prepare('SELECT content_hash FROM note_embeddings WHERE path = ?').get(file.path) as { content_hash: string } | undefined;
    if (existing?.content_hash === hash) return;

    const embedding = await embedText(content);
    db.prepare(`
      INSERT OR REPLACE INTO note_embeddings (path, embedding, content_hash, model, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(file.path, float32ToUint8(embedding), hash, MODEL_ID, Date.now());
  } catch {
    // Skip files we can't process
  }
}

/**
 * Remove embedding for a deleted note.
 */
export function removeNoteEmbedding(notePath: string): void {
  if (!db) return;
  try {
    db.prepare('DELETE FROM note_embeddings WHERE path = ?').run(notePath);
  } catch { /* ignore */ }
}

// =============================================================================
// Entity Embeddings
// =============================================================================

/**
 * Build embedding text for an entity.
 */
async function buildEntityEmbeddingText(
  app: App,
  entity: { name: string; path: string; category: string; aliases: string[] }
): Promise<string> {
  const parts: string[] = [entity.name, entity.name];

  if (entity.aliases.length > 0) {
    parts.push(entity.aliases.join(' '));
  }
  parts.push(entity.category);

  // Read first 500 chars of the entity's backing note
  if (entity.path) {
    try {
      const file = app.vault.getAbstractFileByPath(entity.path);
      if (file instanceof TFile) {
        const content = await app.vault.cachedRead(file);
        parts.push(content.slice(0, 500));
      }
    } catch { /* note might not exist */ }
  }

  return parts.join(' ');
}

/**
 * Batch-build all entity embeddings.
 */
export async function buildEntityEmbeddingsIndex(
  app: App,
  entities: Map<string, { name: string; path: string; category: string; aliases: string[] }>,
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  if (!db) throw new Error('Embeddings database not initialized');

  await initEmbeddings();

  const existingHashes = new Map<string, string>();
  try {
    const rows = db.prepare('SELECT entity_name, source_hash FROM entity_embeddings').all() as Array<{ entity_name: string; source_hash: string }>;
    for (const row of rows) {
      existingHashes.set(row.entity_name, row.source_hash);
    }
  } catch { /* table might not have data */ }

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO entity_embeddings (entity_name, embedding, source_hash, model, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const total = entities.size;
  let done = 0;
  let updated = 0;

  for (const [name, entity] of entities) {
    done++;

    try {
      const text = await buildEntityEmbeddingText(app, entity);
      const hash = simpleHash(text);

      if (existingHashes.get(name) === hash) {
        if (onProgress) onProgress(done, total);
        continue;
      }

      const embedding = await embedTextCached(text);
      upsert.run(name, float32ToUint8(embedding), hash, MODEL_ID, Date.now());
      updated++;
    } catch {
      // Skip entities we can't process
    }

    if (onProgress) onProgress(done, total);
  }

  // Remove embeddings for deleted entities
  const deleteStmt = db.prepare('DELETE FROM entity_embeddings WHERE entity_name = ?');
  for (const existingName of existingHashes.keys()) {
    if (!entities.has(existingName)) {
      deleteStmt.run(existingName);
    }
  }

  console.log(`[Flywheel Crank] Entity embeddings: ${updated} updated, ${total - updated} unchanged`);
  return updated;
}

/**
 * Load all entity embeddings from DB into memory for fast cosine search.
 */
export function loadEntityEmbeddingsToMemory(): void {
  if (!db) return;

  try {
    const rows = db.prepare('SELECT entity_name, embedding FROM entity_embeddings').all() as Array<{ entity_name: string; embedding: Uint8Array | ArrayBuffer }>;
    entityEmbeddingsMap.clear();

    for (const row of rows) {
      entityEmbeddingsMap.set(row.entity_name, uint8ToFloat32(row.embedding));
    }

    if (rows.length > 0) {
      console.log(`[Flywheel Crank] Loaded ${rows.length} entity embeddings into memory`);
    }
  } catch { /* table might not exist */ }
}

// =============================================================================
// Cosine Similarity
// =============================================================================

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

// =============================================================================
// Semantic Search
// =============================================================================

/**
 * Search notes by semantic similarity to a query.
 */
export async function semanticSearch(query: string, limit: number = 10): Promise<ScoredNote[]> {
  if (!db) throw new Error('Embeddings database not initialized');

  const queryEmbedding = await embedText(query);

  const rows = db.prepare('SELECT path, embedding FROM note_embeddings').all() as Array<{ path: string; embedding: Uint8Array | ArrayBuffer }>;

  const scored: ScoredNote[] = [];
  for (const row of rows) {
    const noteEmbedding = uint8ToFloat32(row.embedding);
    const score = cosineSimilarity(queryEmbedding, noteEmbedding);
    const title = row.path.replace(/\.md$/, '').split('/').pop() || row.path;
    scored.push({ path: row.path, title, score: Math.round(score * 1000) / 1000 });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Find notes semantically similar to a given note.
 */
export async function findSemanticallySimilar(
  sourcePath: string,
  limit: number = 10,
  excludePaths?: Set<string>
): Promise<ScoredNote[]> {
  if (!db) throw new Error('Embeddings database not initialized');

  const sourceRow = db.prepare('SELECT embedding FROM note_embeddings WHERE path = ?').get(sourcePath) as { embedding: Uint8Array | ArrayBuffer } | undefined;
  if (!sourceRow) return [];

  const sourceEmbedding = uint8ToFloat32(sourceRow.embedding);

  const rows = db.prepare('SELECT path, embedding FROM note_embeddings WHERE path != ?').all(sourcePath) as Array<{ path: string; embedding: Uint8Array | ArrayBuffer }>;

  const scored: ScoredNote[] = [];
  for (const row of rows) {
    if (excludePaths?.has(row.path)) continue;
    const noteEmbedding = uint8ToFloat32(row.embedding);
    const score = cosineSimilarity(sourceEmbedding, noteEmbedding);
    const title = row.path.replace(/\.md$/, '').split('/').pop() || row.path;
    scored.push({ path: row.path, title, score: Math.round(score * 1000) / 1000 });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// =============================================================================
// Reciprocal Rank Fusion
// =============================================================================

/**
 * Merge ranked lists using RRF. k=60 (standard).
 */
export function reciprocalRankFusion<T extends { path: string }>(
  ...lists: T[][]
): Map<string, number> {
  const k = 60;
  const scores = new Map<string, number>();

  for (const list of lists) {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank];
      const rrfScore = 1 / (k + rank + 1);
      scores.set(item.path, (scores.get(item.path) || 0) + rrfScore);
    }
  }

  return scores;
}

// =============================================================================
// Pseudo-Query Embedding (no model needed at search time)
// =============================================================================

/**
 * Build a pseudo-query embedding by averaging the pre-computed embeddings
 * of the top FTS5 keyword matches. This is a standard "pseudo-relevance
 * feedback" technique — no model loading required at search time.
 */
function buildPseudoQueryEmbedding(topPaths: string[]): Float32Array | null {
  if (!db || topPaths.length === 0) return null;

  const embeddings: Float32Array[] = [];
  for (const path of topPaths.slice(0, 5)) {
    try {
      const row = db.prepare('SELECT embedding FROM note_embeddings WHERE path = ?').get(path) as { embedding: Uint8Array | ArrayBuffer } | undefined;
      if (row) embeddings.push(uint8ToFloat32(row.embedding));
    } catch { /* skip */ }
  }

  if (embeddings.length === 0) return null;

  // Average and normalize
  const avg = new Float32Array(EMBEDDING_DIMS);
  for (const emb of embeddings) {
    for (let i = 0; i < EMBEDDING_DIMS; i++) avg[i] += emb[i];
  }
  for (let i = 0; i < EMBEDDING_DIMS; i++) avg[i] /= embeddings.length;

  let norm = 0;
  for (let i = 0; i < EMBEDDING_DIMS; i++) norm += avg[i] * avg[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < EMBEDDING_DIMS; i++) avg[i] /= norm;
  }

  return avg;
}

/**
 * Semantic search using a pre-computed pseudo-query embedding.
 * Doesn't require the model — uses existing DB embeddings only.
 */
function semanticSearchFromEmbedding(queryEmbedding: Float32Array, limit: number, excludePaths?: Set<string>): ScoredNote[] {
  if (!db) return [];

  const rows = db.prepare('SELECT path, embedding FROM note_embeddings').all() as Array<{ path: string; embedding: Uint8Array | ArrayBuffer }>;

  const scored: ScoredNote[] = [];
  for (const row of rows) {
    if (excludePaths?.has(row.path)) continue;
    const noteEmbedding = uint8ToFloat32(row.embedding);
    const score = cosineSimilarity(queryEmbedding, noteEmbedding);
    const title = row.path.replace(/\.md$/, '').split('/').pop() || row.path;
    scored.push({ path: row.path, title, score: Math.round(score * 1000) / 1000 });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

// =============================================================================
// Hybrid Search (FTS5 + Semantic → RRF)
// =============================================================================

/**
 * Hybrid search: merge FTS5 BM25 results with semantic results via RRF.
 *
 * Uses pseudo-relevance feedback: averages the pre-computed embeddings of
 * top FTS5 results to build a "query embedding", then finds semantically
 * similar notes. This avoids needing the ML model at search time.
 *
 * If the model IS loaded, uses real query embedding instead.
 */
export async function hybridSearch(
  fts5Results: FTS5Result[],
  query: string,
  limit: number = 10
): Promise<FTS5Result[]> {
  if (!hasEmbeddingsIndex()) {
    return fts5Results.slice(0, limit);
  }

  try {
    let semanticResults: ScoredNote[];

    if (pipeline) {
      // Model is loaded — use real query embedding
      semanticResults = await semanticSearch(query, limit * 2);
    } else {
      // Model not loaded — use pseudo-relevance feedback
      const fts5Paths = fts5Results.map(r => r.path);
      const pseudoQuery = buildPseudoQueryEmbedding(fts5Paths);
      if (!pseudoQuery) {
        return fts5Results.slice(0, limit);
      }
      const excludePaths = new Set(fts5Paths.slice(0, 3)); // Don't return top FTS hits as "semantic" results
      semanticResults = semanticSearchFromEmbedding(pseudoQuery, limit * 2, excludePaths);
    }

    const rrfScores = reciprocalRankFusion(
      fts5Results.map(r => ({ path: r.path })),
      semanticResults.map(r => ({ path: r.path }))
    );

    // Demote daily/periodic notes in RRF scores
    for (const [path, score] of rrfScores) {
      if (isDailyNote(path)) {
        rrfScores.set(path, score * 0.3);
      }
    }

    // Build merged result set
    const fts5Map = new Map(fts5Results.map(r => [r.path, r]));
    const semanticMap = new Map(semanticResults.map(r => [r.path, r]));
    const allPaths = new Set([...fts5Results.map(r => r.path), ...semanticResults.map(r => r.path)]);

    const merged: FTS5Result[] = Array.from(allPaths).map(p => {
      const fts5 = fts5Map.get(p);
      const semantic = semanticMap.get(p);
      return {
        path: p,
        title: fts5?.title || semantic?.title || p.replace(/\.md$/, '').split('/').pop() || p,
        snippet: fts5?.snippet || '',
      };
    });

    // Sort by RRF score
    merged.sort((a, b) => (rrfScores.get(b.path) || 0) - (rrfScores.get(a.path) || 0));

    // Normalize scores by max and attach to results
    const maxScore = Math.max(...merged.map(r => rrfScores.get(r.path) || 0), 0.001);
    for (const r of merged) {
      r.score = (rrfScores.get(r.path) || 0) / maxScore;
    }

    return merged.slice(0, limit);
  } catch {
    // If semantic fails, fall back to FTS5 only
    return fts5Results.slice(0, limit);
  }
}

// =============================================================================
// State Queries
// =============================================================================

export function hasEmbeddingsIndex(): boolean {
  if (!db) return false;
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM note_embeddings').get() as { count: number };
    return row.count > 0;
  } catch {
    return false;
  }
}

export function getEmbeddingsCount(): number {
  if (!db) return 0;
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM note_embeddings').get() as { count: number };
    return row.count;
  } catch {
    return 0;
  }
}

export function hasEntityEmbeddingsIndex(): boolean {
  return entityEmbeddingsMap.size > 0;
}

export function getEntityEmbeddingsCount(): number {
  if (!db) return 0;
  try {
    const row = db.prepare('SELECT COUNT(*) as count FROM entity_embeddings').get() as { count: number };
    return row.count;
  } catch {
    return 0;
  }
}
