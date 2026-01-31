/**
 * Wikilink integration for Flywheel Crank
 *
 * Manages entity index lifecycle and provides wikilink processing
 * for mutation tools. Mirrors Flywheel's startup pattern.
 *
 * ARCHITECTURE NOTE: Crank maintains its own entity index independent of Flywheel.
 * This is by design for resilience - Crank works even if Flywheel isn't running.
 * Both Flywheel and Crank use @velvetmonkey/vault-core for consistent scanning
 * logic, but each maintains its own cached copy of the entity index.
 *
 * Cache file: .claude/wikilink-entities.json (managed by vault-core)
 *
 * Lifecycle:
 * 1. On startup: Load from cache file if valid, else full vault scan
 * 2. Cache includes version number for migration detection
 * 3. Index is held in memory for the duration of the MCP session
 * 4. Flywheel exposes entity data via MCP for LLM queries
 * 5. Crank uses its local copy for wikilink application during mutations
 */

import {
  scanVaultEntities,
  getAllEntities,
  getAllEntitiesWithTypes,
  getEntityName,
  getEntityAliases,
  applyWikilinks,
  loadEntityCache,
  saveEntityCache,
  ENTITY_CACHE_VERSION,
  type EntityIndex,
  type EntityCategory,
  type EntityWithType,
  type WikilinkResult,
  type Entity,
} from '@velvetmonkey/vault-core';
import path from 'path';
import type { SuggestOptions, SuggestResult, SuggestionConfig, StrictnessMode, NoteContext } from './types.js';
import { stem, tokenize } from './stemmer.js';
import {
  mineCooccurrences,
  getCooccurrenceBoost,
  serializeCooccurrenceIndex,
  deserializeCooccurrenceIndex,
  type CooccurrenceIndex,
} from './cooccurrence.js';
import {
  buildRecencyIndex,
  getRecencyBoost,
  loadRecencyCache,
  saveRecencyCache,
  RECENCY_CACHE_VERSION,
  type RecencyIndex,
} from './recency.js';

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
 * Global recency index state
 */
let recencyIndex: RecencyIndex | null = null;

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
      // Check cache version - rebuild if outdated (e.g., no alias support)
      const cacheVersion = cached._metadata.version ?? 1;
      if (cacheVersion < ENTITY_CACHE_VERSION) {
        console.error(`[Crank] Cache version ${cacheVersion} < ${ENTITY_CACHE_VERSION}, rebuilding...`);
        await rebuildIndex(vaultPath, cacheFile);
        return;
      }

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

  // Get entities for secondary indexes
  const entities = getAllEntities(entityIndex);

  // Mine co-occurrences for conceptual suggestions
  try {
    const cooccurrenceStart = Date.now();
    cooccurrenceIndex = await mineCooccurrences(vaultPath, entities);
    const cooccurrenceDuration = Date.now() - cooccurrenceStart;
    console.error(`[Crank] Co-occurrence index built: ${cooccurrenceIndex._metadata.total_associations} associations in ${cooccurrenceDuration}ms`);
  } catch (e) {
    console.error(`[Crank] Failed to build co-occurrence index: ${e}`);
  }

  // Build recency index for temporal suggestions
  const recencyCacheFile = path.join(vaultPath, '.claude', 'entity-recency.json');
  try {
    // Try loading from cache first
    const cachedRecency = await loadRecencyCache(recencyCacheFile);
    const cacheAgeMs = cachedRecency ? Date.now() - cachedRecency.lastUpdated : Infinity;

    if (cachedRecency && cacheAgeMs < 60 * 60 * 1000) {
      // Cache is valid and less than 1 hour old
      recencyIndex = cachedRecency;
      console.error(`[Crank] Recency index loaded from cache (${recencyIndex.lastMentioned.size} entities)`);
    } else {
      // Build fresh recency index
      const recencyStart = Date.now();
      recencyIndex = await buildRecencyIndex(vaultPath, entities);
      const recencyDuration = Date.now() - recencyStart;
      console.error(`[Crank] Recency index built: ${recencyIndex.lastMentioned.size} entities in ${recencyDuration}ms`);

      // Save to cache
      await saveRecencyCache(recencyCacheFile, recencyIndex);
    }
  } catch (e) {
    console.error(`[Crank] Failed to build recency index: ${e}`);
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
      organizations: entityIndex.organizations?.length ?? 0,
      locations: entityIndex.locations?.length ?? 0,
      concepts: entityIndex.concepts?.length ?? 0,
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

/**
 * Type-based score boost per entity category
 *
 * People and projects are typically more useful to link than
 * common technologies (which may over-saturate links).
 */
const TYPE_BOOST: Record<EntityCategory, number> = {
  people: 5,         // Names are high value for connections
  projects: 3,       // Projects provide context
  organizations: 2,  // Companies/teams relevant
  locations: 1,      // Geographic context
  concepts: 1,       // Abstract concepts
  technologies: 0,   // Common, avoid over-suggesting
  acronyms: 0,       // Acronyms may be ambiguous
  other: 0,          // Unknown category
};

/**
 * Context-aware boost per note type and entity category
 *
 * Boosts entity types that are more relevant to specific note contexts:
 * - Daily notes: people are most relevant (who did I interact with?)
 * - Project notes: projects and technologies are most relevant
 * - Tech docs: technologies and acronyms are most relevant
 */
const CONTEXT_BOOST: Record<NoteContext, Partial<Record<EntityCategory, number>>> = {
  daily: {
    people: 5,       // Daily notes often mention people
    projects: 2,     // Work updates reference projects
  },
  project: {
    projects: 5,     // Project docs reference other projects
    technologies: 2, // Technical dependencies
  },
  tech: {
    technologies: 5, // Tech docs reference technologies
    acronyms: 3,     // Technical acronyms
  },
  general: {},       // No context-specific boost
};

/**
 * Detect note context from path
 *
 * Analyzes path segments to determine note type for context-aware boosting.
 *
 * @param notePath - Path to the note (vault-relative)
 * @returns Detected note context
 */
function getNoteContext(notePath: string): NoteContext {
  const lower = notePath.toLowerCase();

  // Daily notes, journals, logs
  if (
    lower.includes('daily-notes') ||
    lower.includes('daily/') ||
    lower.includes('journal') ||
    lower.includes('logs/') ||
    lower.includes('/log/')
  ) {
    return 'daily';
  }

  // Project and systems documentation
  if (
    lower.includes('projects/') ||
    lower.includes('project/') ||
    lower.includes('systems/') ||
    lower.includes('initiatives/')
  ) {
    return 'project';
  }

  // Technical documentation
  if (
    lower.includes('tech/') ||
    lower.includes('code/') ||
    lower.includes('engineering/') ||
    lower.includes('docs/') ||
    lower.includes('documentation/')
  ) {
    return 'tech';
  }

  return 'general';
}

/**
 * Get adaptive minimum score based on content length
 *
 * Short content (<50 chars) needs lower thresholds to get any suggestions.
 * Long content (>200 chars) should require stronger matches to avoid noise.
 *
 * @param contentLength - Length of content in characters
 * @param baseScore - Base minimum score from strictness config
 * @returns Adjusted minimum score
 */
function getAdaptiveMinScore(contentLength: number, baseScore: number): number {
  if (contentLength < 50) {
    // Short content: lower threshold to allow suggestions
    return Math.max(5, Math.floor(baseScore * 0.6));
  }
  if (contentLength > 200) {
    // Long content: higher threshold for stronger matches
    return Math.floor(baseScore * 1.2);
  }
  // Standard threshold for medium-length content
  return baseScore;
}

// Legacy constants (kept for backward compatibility, use STRICTNESS_CONFIGS instead)
const MIN_SUGGESTION_SCORE = STRICTNESS_CONFIGS.balanced.minSuggestionScore;
const MIN_MATCH_RATIO = STRICTNESS_CONFIGS.balanced.minMatchRatio;

/**
 * Bonus for single-word aliases that exactly match a content token
 * This ensures "production" alias matches "production" in content in conservative mode
 */
const FULL_ALIAS_MATCH_BONUS = 8;

/**
 * Score a name (entity name or alias) against content
 *
 * @param name - Entity name or alias to score
 * @param contentTokens - Set of tokenized content words
 * @param contentStems - Set of stemmed content words
 * @param config - Scoring configuration from strictness mode
 * @returns Object with score, matchedWords, and exactMatches
 */
function scoreNameAgainstContent(
  name: string,
  contentTokens: Set<string>,
  contentStems: Set<string>,
  config: SuggestionConfig
): { score: number; matchedWords: number; exactMatches: number; totalTokens: number } {
  const nameTokens = tokenize(name);
  if (nameTokens.length === 0) {
    return { score: 0, matchedWords: 0, exactMatches: 0, totalTokens: 0 };
  }

  const nameStems = nameTokens.map(t => stem(t));

  let score = 0;
  let matchedWords = 0;
  let exactMatches = 0;

  for (let i = 0; i < nameTokens.length; i++) {
    const token = nameTokens[i];
    const nameStem = nameStems[i];

    if (contentTokens.has(token)) {
      // Exact word match - highest confidence
      score += config.exactMatchBonus;
      matchedWords++;
      exactMatches++;
    } else if (contentStems.has(nameStem)) {
      // Stem match only - medium confidence
      score += config.stemMatchBonus;
      matchedWords++;
    }
  }

  return { score, matchedWords, exactMatches, totalTokens: nameTokens.length };
}

/**
 * Score an entity based on word overlap with content
 *
 * Scoring layers:
 * - Exact match: +exactMatchBonus per word (highest confidence)
 * - Stem match: +stemMatchBonus per word (medium confidence)
 * - Alias matching: Also scores against entity aliases
 *
 * The config determines thresholds and bonuses based on strictness mode.
 *
 * @param entity - Entity object (with name and aliases) or string name
 * @param contentTokens - Set of tokenized content words
 * @param contentStems - Set of stemmed content words
 * @param config - Scoring configuration from strictness mode
 * @returns Score (higher = more relevant), 0 if doesn't meet threshold
 */
function scoreEntity(
  entity: Entity,
  contentTokens: Set<string>,
  contentStems: Set<string>,
  config: SuggestionConfig
): number {
  const entityName = getEntityName(entity);
  const aliases = getEntityAliases(entity);

  // Score the primary name
  const nameResult = scoreNameAgainstContent(entityName, contentTokens, contentStems, config);

  // Score each alias and take the best match
  let bestAliasResult = { score: 0, matchedWords: 0, exactMatches: 0, totalTokens: 0 };
  for (const alias of aliases) {
    const aliasResult = scoreNameAgainstContent(alias, contentTokens, contentStems, config);
    if (aliasResult.score > bestAliasResult.score) {
      bestAliasResult = aliasResult;
    }
  }

  // Use the best score between name and aliases
  const bestResult = nameResult.score >= bestAliasResult.score ? nameResult : bestAliasResult;
  let { score, matchedWords, exactMatches, totalTokens } = bestResult;

  if (totalTokens === 0) return 0;

  // Bonus for single-word aliases that exactly match a content token
  // This ensures "production" alias matches "production" in content in conservative mode
  for (const alias of aliases) {
    const aliasLower = alias.toLowerCase();
    // Single-word alias (4+ chars) that matches a content token exactly
    if (aliasLower.length >= 4 &&
        !/\s/.test(aliasLower) &&
        contentTokens.has(aliasLower)) {
      score += FULL_ALIAS_MATCH_BONUS;
      break;  // Only apply bonus once
    }
  }

  // Multi-word entities need minimum match ratio
  if (totalTokens > 1) {
    const matchRatio = matchedWords / totalTokens;
    if (matchRatio < config.minMatchRatio) {
      return 0;
    }
  }

  // For conservative mode: single-word entities need multiple content word matches
  // This prevents "Complete" matching just because content has "completed"
  if (config.requireMultipleMatches && totalTokens === 1) {
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
    strictness = DEFAULT_STRICTNESS,
    notePath
  } = options;

  // Get config for the specified strictness mode
  const config = STRICTNESS_CONFIGS[strictness];

  // Compute adaptive minimum score based on content length
  const adaptiveMinScore = getAdaptiveMinScore(content.length, config.minSuggestionScore);

  // Detect note context for context-aware boosting
  const noteContext = notePath ? getNoteContext(notePath) : 'general';
  const contextBoosts = CONTEXT_BOOST[noteContext];

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

  // Get all entities with type information for category-based boosting
  const entitiesWithTypes = getAllEntitiesWithTypes(entityIndex);
  if (entitiesWithTypes.length === 0) {
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
  const scoredEntities: Array<{ name: string; score: number; category: EntityCategory }> = [];
  const directlyMatchedEntities = new Set<string>();

  for (const { entity, category } of entitiesWithTypes) {
    // Get entity name
    const entityName = entity.name;
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

    // Layers 2+3: Exact match, stem match, and alias matching (bonuses depend on strictness)
    let score = scoreEntity(entity, contentTokens, contentStems, config);

    // Layer 5: Type boost - prioritize people, projects over common technologies
    score += TYPE_BOOST[category] || 0;

    // Layer 6: Context boost - boost types relevant to note context
    score += contextBoosts[category] || 0;

    // Layer 7: Recency boost - boost recently-mentioned entities
    if (recencyIndex) {
      score += getRecencyBoost(entityName, recencyIndex);
    }

    if (score > 0) {
      directlyMatchedEntities.add(entityName);
    }

    // Minimum threshold (adaptive based on content length)
    if (score >= adaptiveMinScore) {
      scoredEntities.push({ name: entityName, score, category });
    }
  }

  // Layer 4: Add co-occurrence boost for entities related to matched ones
  // This allows entities that didn't match directly but are conceptually related
  // to be suggested
  if (cooccurrenceIndex && directlyMatchedEntities.size > 0) {
    for (const { entity, category } of entitiesWithTypes) {
      const entityName = entity.name;
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
        } else {
          // For purely co-occurrence-based suggestions, also add type, context, and recency boost
          const typeBoost = TYPE_BOOST[category] || 0;
          const contextBoost = contextBoosts[category] || 0;
          const recencyBoostVal = recencyIndex ? getRecencyBoost(entityName, recencyIndex) : 0;
          const totalBoost = boost + typeBoost + contextBoost + recencyBoostVal;
          if (totalBoost >= adaptiveMinScore) {
            // Add entity if boost meets threshold
            scoredEntities.push({ name: entityName, score: totalBoost, category });
          }
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
