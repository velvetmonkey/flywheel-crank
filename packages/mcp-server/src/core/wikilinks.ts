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
