/**
 * Wikilink integration for Flywheel Crank
 *
 * Manages entity index lifecycle and provides wikilink processing
 * for mutation tools. Mirrors Flywheel's startup pattern.
 */

import {
  scanVaultEntities,
  getAllEntities,
  applyWikilinks,
  loadEntityCache,
  saveEntityCache,
  type EntityIndex,
  type WikilinkResult,
} from '@velvetmonkey/vault-core';
import path from 'path';
import type { SuggestOptions, SuggestResult } from './types.js';

/**
 * Global entity index state
 */
let entityIndex: EntityIndex | null = null;
let indexReady = false;
let indexError: Error | null = null;

/**
 * Folders to exclude from entity scanning (periodic notes, etc.)
 */
const DEFAULT_EXCLUDE_FOLDERS = [
  'daily-notes',
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'periodic',
  'journal',
  'inbox',
  'templates',
];

/**
 * Initialize entity index in background
 * Called at MCP server startup - returns immediately, builds in background
 */
export async function initializeEntityIndex(vaultPath: string): Promise<void> {
  const cacheFile = path.join(vaultPath, '.claude', 'wikilink-entities.json');

  try {
    // Try loading from cache first (fast path)
    const cached = await loadEntityCache(cacheFile);
    if (cached) {
      entityIndex = cached;
      indexReady = true;
      console.error(`[Crank] Loaded ${cached._metadata.total_entities} entities from cache`);

      // Optionally rebuild in background if cache is old (>1 hour)
      const cacheAge = Date.now() - new Date(cached._metadata.generated_at).getTime();
      if (cacheAge > 60 * 60 * 1000) {
        rebuildIndexInBackground(vaultPath, cacheFile);
      }
      return;
    }

    // No cache - build index
    await rebuildIndex(vaultPath, cacheFile);
  } catch (error) {
    indexError = error instanceof Error ? error : new Error(String(error));
    console.error(`[Crank] Failed to initialize entity index: ${indexError.message}`);
    // Don't throw - wikilinks will just be disabled
  }
}

/**
 * Rebuild index synchronously
 */
async function rebuildIndex(vaultPath: string, cacheFile: string): Promise<void> {
  console.error(`[Crank] Scanning vault for entities...`);
  const startTime = Date.now();

  entityIndex = await scanVaultEntities(vaultPath, {
    excludeFolders: DEFAULT_EXCLUDE_FOLDERS,
  });

  indexReady = true;
  const duration = Date.now() - startTime;
  console.error(`[Crank] Entity index built: ${entityIndex._metadata.total_entities} entities in ${duration}ms`);

  // Save to cache
  try {
    await saveEntityCache(cacheFile, entityIndex);
    console.error(`[Crank] Entity cache saved`);
  } catch (e) {
    console.error(`[Crank] Failed to save entity cache: ${e}`);
  }
}

/**
 * Rebuild index in background (non-blocking)
 */
function rebuildIndexInBackground(vaultPath: string, cacheFile: string): void {
  rebuildIndex(vaultPath, cacheFile).catch(error => {
    console.error(`[Crank] Background index rebuild failed: ${error}`);
  });
}

/**
 * Check if entity index is ready
 */
export function isEntityIndexReady(): boolean {
  return indexReady && entityIndex !== null;
}

/**
 * Get the entity index (may be null if not ready)
 */
export function getEntityIndex(): EntityIndex | null {
  return entityIndex;
}

/**
 * Process content through wikilink application
 *
 * @param content - Content to process
 * @returns Content with wikilinks applied, or original if index not ready
 */
export function processWikilinks(content: string): WikilinkResult {
  if (!isEntityIndexReady() || !entityIndex) {
    return {
      content,
      linksAdded: 0,
      linkedEntities: [],
    };
  }

  const entities = getAllEntities(entityIndex);
  return applyWikilinks(content, entities, {
    firstOccurrenceOnly: true,
    caseInsensitive: true,
  });
}

/**
 * Apply wikilinks to content if enabled
 *
 * @param content - Content to potentially wikilink
 * @param skipWikilinks - If true, skip wikilink processing
 * @returns Processed content (with or without wikilinks)
 */
export function maybeApplyWikilinks(
  content: string,
  skipWikilinks: boolean
): { content: string; wikilinkInfo?: string } {
  if (skipWikilinks) {
    return { content };
  }

  const result = processWikilinks(content);

  if (result.linksAdded > 0) {
    return {
      content: result.content,
      wikilinkInfo: `Applied ${result.linksAdded} wikilink(s): ${result.linkedEntities.join(', ')}`,
    };
  }

  return { content: result.content };
}

/**
 * Get entity index statistics (for debugging/status)
 */
export function getEntityIndexStats(): {
  ready: boolean;
  totalEntities: number;
  categories: Record<string, number>;
  error?: string;
} {
  if (!indexReady || !entityIndex) {
    return {
      ready: false,
      totalEntities: 0,
      categories: {},
      error: indexError?.message,
    };
  }

  return {
    ready: true,
    totalEntities: entityIndex._metadata.total_entities,
    categories: {
      technologies: entityIndex.technologies.length,
      acronyms: entityIndex.acronyms.length,
      people: entityIndex.people.length,
      projects: entityIndex.projects.length,
      other: entityIndex.other.length,
    },
  };
}

// ========================================
// Suggestion Link Logic
// ========================================

/**
 * Pattern to detect existing suggestion suffix (for idempotency)
 */
const SUGGESTION_PATTERN = /→\s*\[\[.+$/;

/**
 * Common stopwords to exclude from tokenization
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'this', 'that',
  'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what',
  'which', 'who', 'whom', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also',
]);

/**
 * Extract entities that are already linked in content
 * @param content - Content to scan for existing wikilinks
 * @returns Set of linked entity names (lowercase for comparison)
 */
export function extractLinkedEntities(content: string): Set<string> {
  const linked = new Set<string>();
  const wikilinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

  let match;
  while ((match = wikilinkRegex.exec(content)) !== null) {
    linked.add(match[1].toLowerCase());
  }

  return linked;
}

/**
 * Tokenize content into significant words for matching
 * @param content - Content to tokenize
 * @returns Array of significant words (lowercase, 4+ chars, no stopwords)
 */
function tokenizeContent(content: string): string[] {
  // Remove wikilinks and markdown formatting for cleaner tokenization
  const cleanContent = content
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1') // Extract wikilink text
    .replace(/[*_`#\[\]()]/g, ' ') // Remove markdown chars
    .toLowerCase();

  // Extract words (4+ chars, not stopwords)
  const words = cleanContent.match(/\b[a-z]{4,}\b/g) || [];
  return words.filter(word => !STOPWORDS.has(word));
}

/**
 * Score an entity based on word overlap with content tokens
 * @param entityName - Name of the entity
 * @param contentTokens - Tokenized content words
 * @returns Score (higher = more relevant)
 */
function scoreEntity(entityName: string, contentTokens: string[]): number {
  const entityWords = entityName.toLowerCase().split(/\s+/);
  let score = 0;

  for (const entityWord of entityWords) {
    if (entityWord.length < 3) continue;

    for (const contentToken of contentTokens) {
      // Exact match gets higher score
      if (contentToken === entityWord) {
        score += 3;
      }
      // Partial match (entity word appears in content token or vice versa)
      else if (contentToken.includes(entityWord) || entityWord.includes(contentToken)) {
        score += 1;
      }
    }
  }

  return score;
}

/**
 * Suggest related wikilinks based on content analysis
 *
 * Analyzes content tokens and scores entities from the cache,
 * returning the top matches as suggested outgoing links.
 *
 * @param content - Content to analyze for suggestions
 * @param options - Configuration options
 * @returns Suggestion result with entity names and formatted suffix
 */
export function suggestRelatedLinks(
  content: string,
  options: SuggestOptions = {}
): SuggestResult {
  const { maxSuggestions = 3, excludeLinked = true } = options;

  // Empty result for quick returns
  const emptyResult: SuggestResult = { suggestions: [], suffix: '' };

  // Check for existing suggestion suffix (idempotency)
  if (SUGGESTION_PATTERN.test(content)) {
    return emptyResult;
  }

  // Check if entity index is ready
  if (!isEntityIndexReady() || !entityIndex) {
    return emptyResult;
  }

  // Get all entities
  const entities = getAllEntities(entityIndex);
  if (entities.length === 0) {
    return emptyResult;
  }

  // Tokenize content
  const contentTokens = tokenizeContent(content);
  if (contentTokens.length === 0) {
    return emptyResult;
  }

  // Get already-linked entities
  const linkedEntities = excludeLinked ? extractLinkedEntities(content) : new Set<string>();

  // Score and filter entities
  const scoredEntities: Array<{ name: string; score: number }> = [];

  for (const entity of entities) {
    // Skip if already linked
    if (linkedEntities.has(entity.name.toLowerCase())) {
      continue;
    }

    const score = scoreEntity(entity.name, contentTokens);
    if (score > 0) {
      scoredEntities.push({ name: entity.name, score });
    }
  }

  // Sort by score (descending) and take top N
  scoredEntities.sort((a, b) => b.score - a.score);
  const topSuggestions = scoredEntities.slice(0, maxSuggestions).map(e => e.name);

  if (topSuggestions.length === 0) {
    return emptyResult;
  }

  // Format suffix: → [[Entity1]] [[Entity2]]
  const suffix = '→ ' + topSuggestions.map(name => `[[${name}]]`).join(' ');

  return {
    suggestions: topSuggestions,
    suffix,
  };
}
