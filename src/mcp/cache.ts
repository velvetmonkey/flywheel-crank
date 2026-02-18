/**
 * MCP Client Cache
 *
 * Simple Map-based cache with TTL tiers and in-flight request deduplication.
 * Mutations bypass the cache and invalidate related entries.
 */

interface CacheEntry {
  data: unknown;
  expiry: number; // 0 = never expires (session-lifetime)
}

// TTL tiers by tool name
const SESSION_TOOLS = new Set([
  'get_folder_structure',
  'list_entities',
  'flywheel_config',
]);

const TTL_5S_TOOLS = new Set([
  'get_backlinks',
  'get_forward_links',
  'vault_schema',
  'find_similar',
  'suggest_wikilinks',
  'note_intelligence',
  'graph_analysis',
  'get_vault_stats',
  'tasks',
  'server_log',
  'validate_links',
]);

const TTL_30S_TOOLS = new Set([
  'health_check',
]);

// Tools that should never be cached
const NO_CACHE_TOOLS = new Set([
  'search',
  'vault_toggle_task',
  'vault_update_frontmatter',
  'vault_add_to_section',
  'vault_remove_from_section',
  'vault_replace_in_section',
  'vault_create_note',
  'vault_delete_note',
  'vault_move_note',
  'vault_rename_note',
  'vault_add_task',
  'merge_entities',
  'refresh_index',
  'init_semantic',
  'policy',
  'rename_field',
  'migrate_field_values',
  'rename_tag',
  'vault_undo_last_mutation',
  'dismiss_merge_suggestion',
  'wikilink_feedback',
]);

function getTtl(tool: string): number {
  if (NO_CACHE_TOOLS.has(tool)) return -1; // bypass
  if (SESSION_TOOLS.has(tool)) return 0; // never expires
  if (TTL_30S_TOOLS.has(tool)) return 30_000;
  if (TTL_5S_TOOLS.has(tool)) return 5_000;
  return -1; // unknown tools bypass cache
}

function cacheKey(tool: string, args: Record<string, unknown>): string {
  return `${tool}:${JSON.stringify(args)}`;
}

export class McpCache {
  private cache = new Map<string, CacheEntry>();
  private inflight = new Map<string, Promise<unknown>>();

  /**
   * Get a cached result or execute the function and cache the result.
   * Deduplicates in-flight requests for the same key.
   */
  get<T>(tool: string, args: Record<string, unknown>, execute: () => Promise<T>): Promise<T> {
    const ttl = getTtl(tool);
    if (ttl < 0) return execute(); // no caching

    const key = cacheKey(tool, args);

    // Check cache
    const entry = this.cache.get(key);
    if (entry && (entry.expiry === 0 || entry.expiry > Date.now())) {
      return Promise.resolve(entry.data as T);
    }

    // Deduplicate in-flight requests
    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = execute().then(result => {
      this.inflight.delete(key);
      this.cache.set(key, {
        data: result,
        expiry: ttl === 0 ? 0 : Date.now() + ttl,
      });
      return result;
    }).catch(err => {
      this.inflight.delete(key);
      throw err;
    });

    this.inflight.set(key, promise);
    return promise;
  }

  /** Invalidate all entries for a given tool. */
  invalidateTool(tool: string): void {
    const prefix = `${tool}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) this.cache.delete(key);
    }
  }

  /** Invalidate all entries that reference a given path in their args. */
  invalidatePath(path: string): void {
    for (const key of this.cache.keys()) {
      if (key.includes(path)) this.cache.delete(key);
    }
  }

  /** Clear entire cache. */
  clear(): void {
    this.cache.clear();
    this.inflight.clear();
  }
}
