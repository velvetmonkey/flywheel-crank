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
import type { SuggestOptions, SuggestResult, SuggestionConfig, StrictnessMode } from './types.js';
import { stem, tokenize } from './stemmer.js';
import {
  mineCooccurrences,
  getCooccurrenceBoost,
  serializeCooccurrenceIndex,
  deserializeCooccurrenceIndex,
  type CooccurrenceIndex,
} from './cooccurrence.js';

/**
 * Global entity index state
 */
let entityIndex: EntityIndex | null = null;
let indexReady = false;
let indexError: Error | null = null;

/**
 * Global co-occurrence index state
 */
let cooccurrenceIndex: CooccurrenceIndex | null = null;

/**
 * Folders to exclude from entity scanning
 * Includes periodic notes, working folders, and clippings/external content
 */
const DEFAULT_EXCLUDE_FOLDERS = [
  // Periodic notes
  'daily-notes',
  'daily',
  'weekly',
  'weekly-notes',
  'monthly',
  'monthly-notes',
  'quarterly',
  'yearly-notes',
  'periodic',
  'journal',
  // Working folders
  'inbox',
  'templates',
  'attachments',
  'tmp',
  'new',
  // Clippings & external content (article titles are not concepts)
  'clippings',
  'readwise',
  'articles',
  'bookmarks',
  'web-clips',
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
  const entityDuration = Date.now() - startTime;
  console.error(`[Crank] Entity index built: ${entityIndex._metadata.total_entities} entities in ${entityDuration}ms`);

  // Mine co-occurrences for conceptual suggestions
  try {
    const cooccurrenceStart = Date.now();
    const entities = getAllEntities(entityIndex);
    cooccurrenceIndex = await mineCooccurrences(vaultPath, entities);
    const cooccurrenceDuration = Date.now() - cooccurrenceStart;
    console.error(`[Crank] Co-occurrence index built: ${cooccurrenceIndex._metadata.total_associations} associations in ${cooccurrenceDuration}ms`);
  } catch (e) {
    console.error(`[Crank] Failed to build co-occurrence index: ${e}`);
  }

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
 * Uses the shared stemmer module for consistent tokenization
 * @param content - Content to tokenize
 * @returns Array of significant words (lowercase, 4+ chars, no stopwords)
 */
function tokenizeContent(content: string): string[] {
  return tokenize(content);
}

/**
 * Tokenize content and compute stems for matching
 * @param content - Content to tokenize
 * @returns Object with tokens set and stems set
 */
function tokenizeForMatching(content: string): {
  tokens: Set<string>;
  stems: Set<string>;
} {
  const tokens = tokenize(content);
  const tokenSet = new Set(tokens);
  const stems = new Set(tokens.map(t => stem(t)));
  return { tokens: tokenSet, stems };
}

/**
 * Maximum entity name length for suggestions
 * Filters out article titles, clippings, and other long names
 */
const MAX_ENTITY_LENGTH = 25;

/**
 * Maximum word count for entity names
 * Concepts are typically 1-3 words; longer names are article titles
 */
const MAX_ENTITY_WORDS = 3;

/**
 * Patterns that indicate an entity is an article title, not a concept
 * Case-insensitive matching
 */
const ARTICLE_PATTERNS = [
  /\bguide\s+to\b/i,
  /\bhow\s+to\b/i,
  /\bcomplete\s+/i,
  /\bultimate\s+/i,
  /\bchecklist\b/i,
  /\bcheatsheet\b/i,
  /\bcheat\s+sheet\b/i,
  /\bbest\s+practices\b/i,
  /\bintroduction\s+to\b/i,
  /\btutorial\b/i,
  /\bworksheet\b/i,
];

/**
 * Check if an entity name looks like an article title rather than a concept
 *
 * Heuristics:
 * - Matches known article patterns ("Guide to", "How to", etc.)
 * - Has more than 3 words (concepts are usually 1-3 words)
 *
 * @param name - Entity name to check
 * @returns true if this looks like an article title
 */
export function isLikelyArticleTitle(name: string): boolean {
  // Check against article patterns
  if (ARTICLE_PATTERNS.some(pattern => pattern.test(name))) {
    return true;
  }

  // Count words (split on whitespace, filter empty)
  const words = name.split(/\s+/).filter(w => w.length > 0);
  if (words.length > MAX_ENTITY_WORDS) {
    return true;
  }

  return false;
}

/**
 * Strictness mode configurations for suggestion scoring
 *
 * Each mode provides different trade-offs between precision and recall:
 * - conservative: High precision, fewer false positives (default)
 * - balanced: Moderate precision, matches v0.7 behavior
 * - aggressive: Maximum recall, may include loose matches
 */
const STRICTNESS_CONFIGS: Record<StrictnessMode, SuggestionConfig> = {
  conservative: {
    minWordLength: 5,
    minSuggestionScore: 15,    // Requires exact match (10) + at least one stem (5)
    minMatchRatio: 0.6,        // 60% of multi-word entity must match
    requireMultipleMatches: true, // Single-word entities need multiple content matches
    stemMatchBonus: 3,         // Lower bonus for stem-only matches
    exactMatchBonus: 10,       // Standard bonus for exact matches
  },
  balanced: {
    minWordLength: 4,
    minSuggestionScore: 8,     // At least one exact match or two stem matches
    minMatchRatio: 0.4,        // 40% of multi-word entity must match
    requireMultipleMatches: false,
    stemMatchBonus: 5,         // Standard bonus for stem matches
    exactMatchBonus: 10,       // Standard bonus for exact matches
  },
  aggressive: {
    minWordLength: 4,
    minSuggestionScore: 5,     // Single stem match is enough
    minMatchRatio: 0.3,        // 30% of multi-word entity must match
    requireMultipleMatches: false,
    stemMatchBonus: 6,         // Higher bonus for stem matches
    exactMatchBonus: 10,       // Standard bonus for exact matches
  },
};

/**
 * Default strictness mode
 */
const DEFAULT_STRICTNESS: StrictnessMode = 'conservative';

// Legacy constants (kept for backward compatibility, use STRICTNESS_CONFIGS instead)
const MIN_SUGGESTION_SCORE = STRICTNESS_CONFIGS.balanced.minSuggestionScore;
const MIN_MATCH_RATIO = STRICTNESS_CONFIGS.balanced.minMatchRatio;

/**
 * Score an entity based on word overlap with content
 *
 * Scoring layers:
 * - Exact match: +exactMatchBonus per word (highest confidence)
 * - Stem match: +stemMatchBonus per word (medium confidence)
 *
 * The config determines thresholds and bonuses based on strictness mode.
 *
 * @param entityName - Name of the entity
 * @param contentTokens - Set of tokenized content words
 * @param contentStems - Set of stemmed content words
 * @param config - Scoring configuration from strictness mode
 * @returns Score (higher = more relevant), 0 if doesn't meet threshold
 */
function scoreEntity(
  entityName: string,
  contentTokens: Set<string>,
  contentStems: Set<string>,
  config: SuggestionConfig
): number {
  // Tokenize entity name
  const entityTokens = tokenize(entityName);
  if (entityTokens.length === 0) return 0;

  // Pre-compute entity stems
  const entityStems = entityTokens.map(t => stem(t));

  let score = 0;
  let matchedWords = 0;
  let exactMatches = 0;

  for (let i = 0; i < entityTokens.length; i++) {
    const token = entityTokens[i];
    const entityStem = entityStems[i];

    if (contentTokens.has(token)) {
      // Exact word match - highest confidence
      score += config.exactMatchBonus;
      matchedWords++;
      exactMatches++;
    } else if (contentStems.has(entityStem)) {
      // Stem match only - medium confidence
      score += config.stemMatchBonus;
      matchedWords++;
    }
  }

  // Multi-word entities need minimum match ratio
  if (entityTokens.length > 1) {
    const matchRatio = matchedWords / entityTokens.length;
    if (matchRatio < config.minMatchRatio) {
      return 0;
    }
  }

  // For conservative mode: single-word entities need multiple content word matches
  // This prevents "Complete" matching just because content has "completed"
  if (config.requireMultipleMatches && entityTokens.length === 1) {
    // Check if the entity word appears multiple times or has strong context
    // For single-word entities, require at least one exact match
    if (exactMatches === 0) {
      return 0;
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
 * Filtering layers:
 * 1a. Length filter: Skip entities >25 chars (article titles, clippings)
 * 1b. Article pattern filter: Skip "Guide to", "How to", etc. and >3 words
 *
 * Scoring layers:
 * 2. Exact match: +10 per word (highest confidence)
 * 3. Stem match: +5 per word (medium confidence)
 * 4. Co-occurrence boost: +3 per related entity (conceptual links)
 *
 * Multi-word entities require 40% of words to match.
 * Minimum score of 5 required (at least one stem match).
 *
 * @param content - Content to analyze for suggestions
 * @param options - Configuration options
 * @returns Suggestion result with entity names and formatted suffix
 */
export function suggestRelatedLinks(
  content: string,
  options: SuggestOptions = {}
): SuggestResult {
  const {
    maxSuggestions = 3,
    excludeLinked = true,
    strictness = DEFAULT_STRICTNESS
  } = options;

  // Get config for the specified strictness mode
  const config = STRICTNESS_CONFIGS[strictness];

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

  // Tokenize content and compute stems for matching
  const { tokens: contentTokens, stems: contentStems } = tokenizeForMatching(content);
  if (contentTokens.size === 0) {
    return emptyResult;
  }

  // Get already-linked entities
  const linkedEntities = excludeLinked ? extractLinkedEntities(content) : new Set<string>();

  // First pass: Score entities and track which ones matched directly
  const scoredEntities: Array<{ name: string; score: number }> = [];
  const directlyMatchedEntities = new Set<string>();

  for (const entity of entities) {
    // Handle both string entities (from scanVaultEntities) and
    // object entities with .name property (from cache format)
    const entityName = typeof entity === 'string' ? entity : (entity as { name?: string }).name;
    if (!entityName) continue;

    // Layer 1a: Length filter - skip article titles, clippings (>25 chars)
    if (entityName.length > MAX_ENTITY_LENGTH) {
      continue;
    }

    // Layer 1b: Article pattern filter - skip "Guide to", "How to", >3 words, etc.
    if (isLikelyArticleTitle(entityName)) {
      continue;
    }

    // Skip if already linked
    if (linkedEntities.has(entityName.toLowerCase())) {
      continue;
    }

    // Layers 2+3: Exact match and stem match scoring (bonuses depend on strictness)
    const score = scoreEntity(entityName, contentTokens, contentStems, config);

    if (score > 0) {
      directlyMatchedEntities.add(entityName);
    }

    // Minimum threshold depends on strictness mode
    if (score >= config.minSuggestionScore) {
      scoredEntities.push({ name: entityName, score });
    }
  }

  // Layer 4: Add co-occurrence boost for entities related to matched ones
  // This allows entities that didn't match directly but are conceptually related
  // to be suggested
  if (cooccurrenceIndex && directlyMatchedEntities.size > 0) {
    for (const entity of entities) {
      const entityName = typeof entity === 'string' ? entity : (entity as { name?: string }).name;
      if (!entityName) continue;

      // Skip if already scored, already linked, too long, or article-like
      if (entityName.length > MAX_ENTITY_LENGTH) continue;
      if (isLikelyArticleTitle(entityName)) continue;
      if (linkedEntities.has(entityName.toLowerCase())) continue;

      // Get co-occurrence boost
      const boost = getCooccurrenceBoost(entityName, directlyMatchedEntities, cooccurrenceIndex);

      if (boost > 0) {
        // Check if entity is already in scored list
        const existing = scoredEntities.find(e => e.name === entityName);
        if (existing) {
          existing.score += boost;
        } else if (boost >= config.minSuggestionScore) {
          // Add entity if boost alone meets threshold
          scoredEntities.push({ name: entityName, score: boost });
        }
      }
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
