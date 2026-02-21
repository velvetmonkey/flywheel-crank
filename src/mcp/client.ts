/**
 * Flywheel MCP Client
 *
 * Thin wrapper around the MCP SDK Client that spawns a flywheel-memory
 * server process and provides typed helper methods for search, similarity,
 * and graph tools.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpCache } from './cache';

// Electron's renderer process may return a number from setTimeout (browser API),
// but the MCP SDK expects a Node.js Timeout object with .unref().
// Add unref() as a no-op on Number.prototype so the SDK doesn't crash.
if (typeof (Number.prototype as any).unref !== 'function') {
  (Number.prototype as any).unref = function () { return this; };
}

// ---------------------------------------------------------------------------
// Response types (match MCP server tool output shapes)
// ---------------------------------------------------------------------------

export interface McpSearchResult {
  path: string;
  title: string;
  snippet?: string;
  rrf_score?: number;
  in_fts5?: boolean;
  in_semantic?: boolean;
  in_entity?: boolean;
}

export interface McpSearchResponse {
  scope: string;
  method: 'fts5' | 'hybrid';
  query: string;
  total_results: number;
  results: McpSearchResult[];
  building?: boolean;
  message?: string;
}

export interface McpSimilarNote {
  path: string;
  title: string;
  score: number;
  snippet: string;
}

export interface McpSimilarResponse {
  source: string;
  method: 'bm25' | 'hybrid';
  exclude_linked: boolean;
  count: number;
  similar: McpSimilarNote[];
}

export interface McpBacklink {
  source: string;
  line: number;
  context?: string;
}

export interface McpBacklinksResponse {
  note: string;
  backlink_count: number;
  returned_count: number;
  backlinks: McpBacklink[];
}

export interface McpForwardLink {
  target: string;
  alias?: string;
  line: number;
  resolved_path?: string;
  exists: boolean;
}

export interface McpForwardLinksResponse {
  note: string;
  forward_link_count: number;
  forward_links: McpForwardLink[];
}

export interface McpPipelineStep {
  name: string;
  duration_ms: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  skipped?: boolean;
  skip_reason?: string;
}

export interface McpHealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  schema_version?: number;
  vault_accessible: boolean;
  vault_path: string;
  index_state: 'building' | 'ready' | 'error';
  index_built: boolean;
  index_age_seconds: number;
  index_stale: boolean;
  note_count: number;
  entity_count: number;
  tag_count: number;
  link_count?: number;
  config?: Record<string, unknown>;
  last_rebuild?: {
    trigger: string;
    timestamp: number;
    duration_ms: number;
    ago_seconds: number;
  };
  last_pipeline?: {
    timestamp: number;
    trigger: string;
    duration_ms: number;
    files_changed: number | null;
    changed_paths: string[] | null;
    steps: McpPipelineStep[];
  };
  recent_pipelines?: Array<{
    timestamp: number;
    trigger: string;
    duration_ms: number;
    files_changed: number | null;
    changed_paths: string[] | null;
    steps: McpPipelineStep[];
  }>;
  fts5_ready?: boolean;
  fts5_building?: boolean;
  embeddings_building?: boolean;
  embeddings_ready?: boolean;
  embeddings_count?: number;
  tasks_ready?: boolean;
  tasks_building?: boolean;
  recommendations: string[];
}

export interface McpSchemaField {
  name: string;
  types: string[];
  count: number;
  examples: unknown[];
  notes_sample: string[];
}

export interface McpSchemaOverviewResponse {
  total_notes: number;
  notes_with_frontmatter: number;
  field_count: number;
  fields: McpSchemaField[];
}

export interface McpInferredField {
  name: string;
  frequency: number;
  inferred_type: string;
  is_required: boolean;
  common_values: unknown[] | null;
  example_notes: string[];
  confidence: number;
}

export interface McpFolderConventionsResponse {
  folder: string;
  note_count: number;
  coverage: number;
  inferred_fields: McpInferredField[];
  computed_field_suggestions: Array<{ name: string; description: string; sample_value: unknown }>;
  naming_pattern: string | null;
}

export interface McpVaultStatsResponse {
  total_notes: number;
  total_links: number;
  total_tags: number;
  orphan_notes: {
    total: number;
    periodic: number;
    content: number;
  };
  broken_links: number;
  average_links_per_note: number;
  most_linked_notes: Array<{ path: string; backlinks: number }>;
  top_tags: Array<{ tag: string; count: number }>;
  folders: Array<{ folder: string; note_count: number }>;
  recent_activity: {
    period_days: number;
    notes_modified: number;
    notes_created: number;
    most_active_day: string | null;
    daily_counts: Record<string, number>;
  };
}

export interface McpInconsistency {
  field: string;
  types_found: string[];
  examples: Array<{ type: string; value: unknown; note: string }>;
}

export interface McpInconsistenciesResponse {
  inconsistency_count: number;
  inconsistencies: McpInconsistency[];
}

export interface McpFolderStructureResponse {
  folder_count: number;
  folders: Array<{ path: string; note_count: number; subfolder_count: number }>;
}

export interface McpInitSemanticResponse {
  success: boolean;
  already_built?: boolean;
  embedded: number;
  skipped?: number;
  total?: number;
  entity_embeddings?: number;
  hint?: string;
}

export interface McpRefreshIndexResponse {
  status: string;
  duration_ms: number;
  note_count: number;
}

export interface McpScoredSuggestion {
  entity: string;
  path: string;
  totalScore: number;
  breakdown: {
    contentMatch: number;
    cooccurrenceBoost: number;
    typeBoost: number;
    contextBoost: number;
    recencyBoost: number;
    crossFolderBoost: number;
    hubBoost: number;
    feedbackAdjustment: number;
    semanticBoost?: number;
  };
  confidence: 'high' | 'medium' | 'low';
}

export interface McpSuggestWikilinksResponse {
  input_length: number;
  suggestion_count: number;
  returned_count: number;
  suggestions: Array<{ entity: string; start: number; end: number; target: string }>;
  scored_suggestions?: McpScoredSuggestion[];
}

// Entity index (from list_entities)
export interface McpEntityItem {
  name: string;
  path: string;
  aliases: string[];
  hubScore?: number;
}

export interface McpEntityIndexResponse {
  technologies: McpEntityItem[];
  acronyms: McpEntityItem[];
  people: McpEntityItem[];
  projects: McpEntityItem[];
  organizations: McpEntityItem[];
  locations: McpEntityItem[];
  concepts: McpEntityItem[];
  animals: McpEntityItem[];
  media: McpEntityItem[];
  events: McpEntityItem[];
  documents: McpEntityItem[];
  vehicles: McpEntityItem[];
  health: McpEntityItem[];
  finance: McpEntityItem[];
  food: McpEntityItem[];
  hobbies: McpEntityItem[];
  other: McpEntityItem[];
  _metadata: {
    total_entities: number;
    generated_at: string;
    vault_path: string;
    source: string;
  };
}

// Graph analysis types
export type GraphAnalysisMode =
  | 'orphans' | 'dead_ends' | 'sources' | 'hubs' | 'stale'
  | 'immature' | 'evolution' | 'emerging_hubs'
  | 'semantic_clusters' | 'semantic_bridges';

export interface McpGraphAnalysisOptions {
  folder?: string;
  min_links?: number;
  min_backlinks?: number;
  min_outlinks?: number;
  days?: number;
  limit?: number;
  offset?: number;
}

export interface McpGraphAnalysisResponse {
  analysis: string;
  [key: string]: unknown;
}

// Unlinked mentions
export interface McpUnlinkedMention {
  path: string;
  line: number;
  context: string;
}

export interface McpUnlinkedMentionsResponse {
  entity: string;
  resolved_path?: string;
  mention_count: number;
  mentions: McpUnlinkedMention[];
}

// Note intelligence
export type NoteIntelligenceMode =
  | 'prose_patterns' | 'suggest_frontmatter' | 'suggest_wikilinks'
  | 'compute' | 'semantic_links' | 'all';

export interface McpNoteIntelligenceResponse {
  path: string;
  analysis: string;
  [key: string]: unknown;
}

// Tasks
export interface McpTask {
  path: string;
  line: number;
  text: string;
  status: 'open' | 'completed' | 'cancelled';
  raw: string;
  context?: string;
  tags: string[];
  due_date?: string;
}

export interface McpTasksResponse {
  total: number;
  returned: number;
  status_filter: string;
  tasks: McpTask[];
  counts?: { open: number; completed: number; cancelled: number };
}

export interface McpToggleTaskResponse {
  success: boolean;
  path: string;
  task: string;
  new_status: string;
  [key: string]: unknown;
}

// Link path
export interface McpLinkPathResponse {
  from: string;
  to: string;
  exists: boolean;
  path: string[];
  length: number;
  total_weight?: number;
  weights?: number[];
}

// Common neighbors
export interface McpCommonNeighbor {
  path: string;
  title: string;
  linked_from_a_line: number;
  linked_from_b_line: number;
}

export interface McpCommonNeighborsResponse {
  note_a: string;
  note_b: string;
  common_count: number;
  common_neighbors: McpCommonNeighbor[];
}

// Connection strength
export interface McpConnectionStrengthResponse {
  note_a: string;
  note_b: string;
  score: number;
  factors: {
    mutual_link: boolean;
    shared_tags: string[];
    shared_outlinks: number;
    same_folder: boolean;
  };
}

// Vault growth
export type VaultGrowthMode = 'current' | 'history' | 'trends' | 'index_activity';

export interface McpVaultGrowthResponse {
  mode: string;
  metrics?: Record<string, number>;
  recorded_at?: number;
  history?: Array<{ timestamp: number; metric: string; value: number }>;
  trends?: Array<{ metric: string; current: number; previous: number; delta: number; pct_change: number }>;
  index_activity?: { summary: Record<string, unknown>; recent_events: Array<Record<string, unknown>> };
}

// Broken links
export interface McpBrokenLink {
  source: string;
  target: string;
  line: number;
  suggestion?: string;
}

export interface McpValidateLinksResponse {
  scope: string;
  total_links: number;
  valid_links: number;
  broken_links: number;
  returned_count: number;
  broken: McpBrokenLink[];
}

// Wikilink feedback
export interface McpFeedbackEntry {
  id: number;
  entity: string;
  context: string;
  note_path: string;
  correct: boolean;
  created_at: string;
}

export interface McpEntityFeedbackStats {
  entity: string;
  total: number;
  correct: number;
  incorrect: number;
  accuracy: number;
  suppressed: boolean;
}

export interface McpWikilinkFeedbackResponse {
  mode: 'list' | 'stats';
  entries?: McpFeedbackEntry[];
  stats?: McpEntityFeedbackStats[];
  total_feedback?: number;
  total_suppressed?: number;
}

export interface McpFeedbackDashboardResponse {
  mode: 'dashboard';
  total_feedback: number;
  total_suppressed: number;
  dashboard: {
    total_feedback: number;
    total_correct: number;
    total_incorrect: number;
    overall_accuracy: number;
    total_suppressed: number;
    feedback_sources: {
      explicit: { count: number; correct: number };
      implicit: { count: number; correct: number };
    };
    applications: { applied: number; removed: number };
    boost_tiers: Array<{
      label: string;
      boost: number;
      min_accuracy: number;
      min_samples: number;
      entities: Array<{ entity: string; accuracy: number; total: number }>;
    }>;
    learning: Array<{ entity: string; accuracy: number; total: number }>;
    suppressed: Array<{ entity: string; false_positive_rate: number }>;
    recent: McpFeedbackEntry[];
    timeline: Array<{ day: string; count: number; correct: number; incorrect: number }>;
    // Phase 4.4 extended fields (optional — present when server supports them)
    layerHealth?: Array<{ layer: string; status: 'contributing' | 'dormant' | 'zero-data'; avgContribution: number; eventCount: number }>;
    topEntities?: Array<{ entity: string; suggestionCount: number; avgScore: number; passRate: number }>;
    feedbackTrend?: Array<{ day: string; count: number }>;
    suppressionChanges?: Array<{ entity: string; falsePositiveRate: number; updatedAt: string }>;
  };
}

// Phase 4 API response types

export interface McpEntityScoreTimelineEntry {
  timestamp: number;
  score: number;
  breakdown: Record<string, number>;
  notePath: string;
  passed: boolean;
  threshold: number;
}

export interface McpEntityTimelineResponse {
  mode: 'entity_timeline';
  entity: string;
  timeline: McpEntityScoreTimelineEntry[];
  count: number;
}

export interface McpLayerContributionBucket {
  bucket: string;
  layers: Record<string, number>;
}

export interface McpLayerTimeseriesResponse {
  mode: 'layer_timeseries';
  granularity: 'day' | 'week';
  timeseries: McpLayerContributionBucket[];
  buckets: number;
}

export interface McpSnapshotDiff {
  metricChanges: Array<{ metric: string; before: number; after: number; delta: number; deltaPercent: number }>;
  hubScoreChanges: Array<{ entity: string; before: number; after: number; delta: number }>;
}

export interface McpSnapshotDiffResponse {
  mode: 'snapshot_diff';
  diff: McpSnapshotDiff;
}

// Server log
export interface McpServerLogEntry {
  ts: number;
  component: string;
  message: string;
  level: 'info' | 'warn' | 'error';
}

export interface McpServerLogResponse {
  entries: McpServerLogEntry[];
  server_uptime_ms: number;
}

// Flywheel config
export interface McpFlywheelConfigResponse {
  vault_name?: string;
  paths?: Record<string, string>;
  templates?: Record<string, string>;
  exclude_task_tags?: string[];
  exclude_analysis_tags?: string[];
  exclude_entities?: string[];
  [key: string]: unknown;
}

// Merge suggestions
export interface McpMergeSuggestion {
  source: { name: string; path: string; category: string; hubScore: number; aliases: string[] };
  target: { name: string; path: string; category: string; hubScore: number; aliases: string[] };
  reason: string;
  confidence: number;
}

export interface McpMergeSuggestionsResponse {
  suggestions: McpMergeSuggestion[];
  total_candidates?: number;
}

export interface McpMergeResult {
  success: boolean;
  message: string;
  path?: string;
  preview?: string;
  backlinks_updated?: number;
}

// Alias suggestions
export interface McpAliasSuggestion {
  entity: string;
  entity_path: string;
  current_aliases: string[];
  candidate: string;
  type: 'acronym' | 'short_form';
  mentions: number;
}

export interface McpAliasSuggestionsResponse {
  suggestion_count: number;
  suggestions: McpAliasSuggestion[];
}

// Write tool responses
export interface McpMutationResponse {
  success: boolean;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class FlywheelMcpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private _connected = false;
  private cache = new McpCache();

  // Centralized health polling
  private healthCallbacks = new Set<(h: McpHealthCheckResponse) => void>();
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  lastHealth: McpHealthCheckResponse | null = null;

  get connected(): boolean {
    return this._connected;
  }

  /**
   * Subscribe to centralized health updates. Returns unsubscribe function.
   * If a cached health result exists, fires the callback immediately.
   */
  onHealthUpdate(cb: (h: McpHealthCheckResponse) => void): () => void {
    this.healthCallbacks.add(cb);
    if (this.lastHealth) cb(this.lastHealth);
    return () => { this.healthCallbacks.delete(cb); };
  }

  /**
   * Start the centralized health poll (3s interval).
   * The poll bypasses cache and populates it for other callers.
   */
  startHealthPoll(): void {
    if (this.healthTimer) return;
    const poll = async () => {
      try {
        this.cache.invalidateTool('health_check');
        const health = await this.healthCheck();
        this.lastHealth = health;
        for (const cb of this.healthCallbacks) { try { cb(health); } catch {} }
      } catch {}
    };
    poll();
    this.healthTimer = setInterval(poll, 3000);
  }

  /** Stop the centralized health poll. */
  stopHealthPoll(): void {
    if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = null; }
  }

  /** Invalidate cache entries related to a file path (for file-watcher driven invalidation). */
  invalidateForPath(path: string): void {
    this.cache.invalidatePath(path);
  }

  /** Invalidate all cached entries for a specific tool. */
  invalidateTool(tool: string): void {
    this.cache.invalidateTool(tool);
  }

  /**
   * Connect to a flywheel-memory MCP server, spawning it as a child process.
   *
   * @param vaultPath - Absolute path to the Obsidian vault (native OS path)
   * @param serverPath - Optional path to the MCP server entry point.
   *   If empty, uses `npx @velvetmonkey/flywheel-memory`.
   *   If a Unix path on Windows, spawns via WSL automatically.
   */
  async connect(vaultPath: string, serverPath = ''): Promise<void> {
    if (this._connected) return;

    const isWindows = process.platform === 'win32';
    const isUnixPath = (p: string) => p.startsWith('/');

    let command: string;
    let args: string[];
    let effectiveVaultPath = vaultPath;

    if (serverPath) {
      // Custom server path provided
      if (isWindows && isUnixPath(serverPath)) {
        // Unix path on Windows → spawn via WSL.
        // WSL doesn't forward custom env vars, so inline them via bash -c.
        const wslVault = this.toWslPath(vaultPath);
        const systemRoot = process.env.SYSTEMROOT || process.env.SystemRoot || 'C:\\Windows';
        command = `${systemRoot}\\System32\\wsl.exe`;
        args = [
          'bash', '-lc',
          `VAULT_PATH="${wslVault}" FLYWHEEL_TOOLS="full" FLYWHEEL_WATCH="true" FLYWHEEL_WATCH_POLL="true" FLYWHEEL_POLL_INTERVAL="15000" exec node "${serverPath}"`,
        ];
        // Don't set effectiveVaultPath since it's baked into the command
        effectiveVaultPath = wslVault;
      } else {
        // Native path on any platform
        command = 'node';
        args = [serverPath];
      }
    } else {
      // No custom path — use npx
      if (isWindows) {
        command = 'npx.cmd';
        args = ['-y', '@velvetmonkey/flywheel-memory'];
      } else {
        command = 'npx';
        args = ['-y', '@velvetmonkey/flywheel-memory'];
      }
    }

    console.log(`Flywheel Crank: serverPath=${JSON.stringify(serverPath)}, isWindows=${isWindows}`);
    console.log(`Flywheel Crank: vaultPath=${JSON.stringify(vaultPath)}, effectiveVaultPath=${JSON.stringify(effectiveVaultPath)}`);
    console.log(`Flywheel Crank: spawning ${command} ${args.join(' ')}`);

    this.transport = new StdioClientTransport({
      command,
      args,
      // Pipe stderr so it doesn't leak into stdout (WSL mixes streams)
      stderr: 'pipe',
      env: {
        ...process.env,
        VAULT_PATH: effectiveVaultPath,
        FLYWHEEL_TOOLS: 'full',
        FLYWHEEL_WATCH: 'true',
        FLYWHEEL_WATCH_POLL: 'true',
        FLYWHEEL_POLL_INTERVAL: '15000',
      },
    });

    // Forward server stderr to console for debugging
    if (this.transport.stderr) {
      this.transport.stderr.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().trim();
        if (lines) console.log(`[flywheel-memory] ${lines}`);
      });
    }

    this.client = new Client({
      name: 'flywheel-crank',
      version: '0.1.0',
    });

    // The server initializes StateDb + entity index before accepting the MCP
    // handshake. Over WSL/cross-fs this can exceed the default 60s timeout.
    await this.client.connect(this.transport, { timeout: 120_000 });
    this._connected = true;
    console.log('Flywheel Crank: MCP client connected');
  }

  /**
   * Convert a Windows path (C:\Users\...) to WSL path (/mnt/c/Users/...).
   */
  private toWslPath(winPath: string): string {
    return winPath
      .replace(/^([A-Za-z]):/, (_m, drive: string) => `/mnt/${drive.toLowerCase()}`)
      .replace(/\\/g, '/');
  }

  /**
   * Disconnect from the MCP server and kill the child process.
   */
  async disconnect(): Promise<void> {
    this.stopHealthPoll();
    this.cache.clear();

    try {
      await this.client?.close();
    } catch {
      // ignore close errors
    }
    try {
      await this.transport?.close();
    } catch {
      // ignore transport close errors
    }
    this.client = null;
    this.transport = null;
    this._connected = false;
    console.log('Flywheel Crank: MCP client disconnected');
  }

  // -------------------------------------------------------------------------
  // Tool helpers
  // -------------------------------------------------------------------------

  /**
   * Call an MCP tool and parse the JSON text response.
   */
  private async callTool<T>(name: string, args: Record<string, unknown>, timeout?: number): Promise<T> {
    if (!this.client || !this._connected) {
      throw new Error('MCP client not connected');
    }

    return this.cache.get<T>(name, args, async () => {
      const result = await this.client!.callTool(
        { name, arguments: args },
        undefined,
        timeout ? { timeout } : undefined,
      );

      // The MCP SDK returns content as an array of content blocks.
      const content = result.content as Array<{ type: string; text?: string }>;
      const textBlock = content?.find(c => c.type === 'text');
      if (!textBlock?.text) {
        throw new Error(`No text response from tool ${name}`);
      }

      // Check for error responses (e.g. index still building)
      if (result.isError) {
        throw new Error(textBlock.text);
      }

      return JSON.parse(textBlock.text) as T;
    });
  }

  /**
   * Wait for the server's vault index to become ready.
   * Polls health_check until index_state === 'ready' or timeout.
   */
  async waitForIndex(timeoutMs = 60_000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const health = await this.healthCheck();
        if (health.index_state === 'ready') return;
        console.log(`[Flywheel Crank] Index state: ${health.index_state}, waiting...`);
      } catch {
        // health_check itself may fail during early startup
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    throw new Error('Timed out waiting for index');
  }

  /**
   * Unified search: FTS5 keyword + semantic hybrid.
   */
  async search(query: string, limit = 20): Promise<McpSearchResponse> {
    return this.callTool<McpSearchResponse>('search', {
      query,
      scope: 'all',
      limit,
    });
  }

  /**
   * Find notes similar to a given note.
   */
  async findSimilar(path: string, limit = 10): Promise<McpSimilarResponse> {
    return this.callTool<McpSimilarResponse>('find_similar', {
      path,
      limit,
      exclude_linked: true,
    });
  }

  /**
   * Get backlinks for a note.
   */
  async getBacklinks(path: string): Promise<McpBacklinksResponse> {
    return this.callTool<McpBacklinksResponse>('get_backlinks', {
      path,
      include_context: true,
      limit: 50,
    });
  }

  /**
   * Get forward links for a note.
   */
  async getForwardLinks(path: string): Promise<McpForwardLinksResponse> {
    return this.callTool<McpForwardLinksResponse>('get_forward_links', {
      path,
    });
  }

  /**
   * Get vault health check — note counts, config, index status.
   */
  async healthCheck(): Promise<McpHealthCheckResponse> {
    return this.callTool<McpHealthCheckResponse>('health_check', {});
  }

  /**
   * Get inferred frontmatter schema overview.
   */
  async schemaOverview(): Promise<McpSchemaOverviewResponse> {
    return this.callTool<McpSchemaOverviewResponse>('vault_schema', {
      analysis: 'overview',
    });
  }

  /**
   * Get inferred folder conventions for a given folder path.
   */
  async folderConventions(folder: string): Promise<McpFolderConventionsResponse> {
    return this.callTool<McpFolderConventionsResponse>('vault_schema', {
      analysis: 'conventions',
      folder,
      min_confidence: 0.2,
    });
  }

  /**
   * Get comprehensive vault statistics.
   */
  async vaultStats(): Promise<McpVaultStatsResponse> {
    return this.callTool<McpVaultStatsResponse>('get_vault_stats', {});
  }

  /**
   * Find frontmatter fields with inconsistent types.
   */
  async schemaInconsistencies(): Promise<McpInconsistenciesResponse> {
    return this.callTool<McpInconsistenciesResponse>('vault_schema', {
      analysis: 'inconsistencies',
    });
  }

  /**
   * Suggest wikilinks for a given text.
   */
  async suggestWikilinks(text: string, detail = false): Promise<McpSuggestWikilinksResponse> {
    return this.callTool<McpSuggestWikilinksResponse>('suggest_wikilinks', {
      text,
      limit: 30,
      detail,
    });
  }

  /**
   * Get folder structure with note counts.
   */
  async folderStructure(): Promise<McpFolderStructureResponse> {
    return this.callTool<McpFolderStructureResponse>('get_folder_structure', {});
  }

  /**
   * Build semantic embeddings (notes + entities) via MCP server.
   */
  async initSemantic(force = false): Promise<McpInitSemanticResponse> {
    return this.callTool<McpInitSemanticResponse>('init_semantic', { force }, 600_000);
  }

  /**
   * Trigger a full index rebuild on the MCP server.
   */
  async refreshIndex(): Promise<McpRefreshIndexResponse> {
    const result = await this.callTool<McpRefreshIndexResponse>('refresh_index', {});
    this.cache.clear();
    return result;
  }

  // -------------------------------------------------------------------------
  // Entities
  // -------------------------------------------------------------------------

  /**
   * List all entities grouped by category with hub scores.
   */
  async listEntities(): Promise<McpEntityIndexResponse> {
    return this.callTool<McpEntityIndexResponse>('list_entities', {});
  }

  /**
   * Get merge suggestions for potentially duplicate entities.
   */
  async suggestEntityMerges(limit = 50): Promise<McpMergeSuggestionsResponse> {
    return this.callTool<McpMergeSuggestionsResponse>('suggest_entity_merges', { limit });
  }

  /**
   * Permanently dismiss a merge suggestion so it never reappears.
   */
  async dismissMergeSuggestion(
    sourcePath: string,
    targetPath: string,
    sourceName: string,
    targetName: string,
    reason: string
  ): Promise<{ dismissed: boolean }> {
    return this.callTool('dismiss_merge_suggestion', {
      source_path: sourcePath,
      target_path: targetPath,
      source_name: sourceName,
      target_name: targetName,
      reason,
    });
  }

  /**
   * Merge two entities: source note is absorbed into target note.
   */
  async mergeEntities(sourcePath: string, targetPath: string): Promise<McpMergeResult> {
    const result = await this.callTool<McpMergeResult>('merge_entities', {
      source_path: sourcePath,
      target_path: targetPath,
    });
    this.cache.invalidateTool('list_entities');
    this.cache.invalidatePath(sourcePath);
    this.cache.invalidatePath(targetPath);
    return result;
  }

  /**
   * Suggest missing aliases (acronyms, short forms) for entities in a folder.
   */
  async suggestEntityAliases(folder?: string): Promise<McpAliasSuggestionsResponse> {
    return this.callTool<McpAliasSuggestionsResponse>('suggest_entity_aliases', {
      ...(folder ? { folder } : {}),
    });
  }

  // -------------------------------------------------------------------------
  // Graph analysis
  // -------------------------------------------------------------------------

  /**
   * Run graph topology analysis (orphans, hubs, stale, semantic bridges, etc.)
   */
  async graphAnalysis(
    analysis: GraphAnalysisMode,
    options: McpGraphAnalysisOptions = {},
  ): Promise<McpGraphAnalysisResponse> {
    return this.callTool<McpGraphAnalysisResponse>('graph_analysis', {
      analysis,
      ...options,
    });
  }

  // -------------------------------------------------------------------------
  // Unlinked mentions
  // -------------------------------------------------------------------------

  /**
   * Find unlinked mentions of an entity across the vault.
   */
  async getUnlinkedMentions(entity: string, limit = 50): Promise<McpUnlinkedMentionsResponse> {
    return this.callTool<McpUnlinkedMentionsResponse>('get_unlinked_mentions', {
      entity,
      limit,
    });
  }

  // -------------------------------------------------------------------------
  // Note intelligence
  // -------------------------------------------------------------------------

  /**
   * Run note intelligence analysis (prose patterns, frontmatter suggestions, etc.)
   */
  async noteIntelligence(
    path: string,
    analysis: NoteIntelligenceMode,
  ): Promise<McpNoteIntelligenceResponse> {
    return this.callTool<McpNoteIntelligenceResponse>('note_intelligence', {
      path,
      analysis,
    });
  }

  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------

  /**
   * Query tasks across the vault with filtering.
   */
  async queryTasks(options: {
    path?: string;
    status?: 'open' | 'completed' | 'cancelled' | 'all';
    has_due_date?: boolean;
    folder?: string;
    tag?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<McpTasksResponse> {
    return this.callTool<McpTasksResponse>('tasks', {
      status: 'open',
      limit: 50,
      ...options,
    });
  }

  /**
   * Toggle a task's completion status.
   */
  async toggleTask(path: string, task: string): Promise<McpToggleTaskResponse> {
    const result = await this.callTool<McpToggleTaskResponse>('vault_toggle_task', {
      path,
      task,
    });
    this.cache.invalidateTool('tasks');
    this.cache.invalidatePath(path);
    return result;
  }

  // -------------------------------------------------------------------------
  // Path & connection analysis
  // -------------------------------------------------------------------------

  /**
   * Find the shortest link path between two notes.
   */
  async getLinkPath(from: string, to: string, weighted = false): Promise<McpLinkPathResponse> {
    return this.callTool<McpLinkPathResponse>('get_link_path', {
      from,
      to,
      weighted,
    });
  }

  /**
   * Find notes linked by both note A and note B.
   */
  async getCommonNeighbors(noteA: string, noteB: string): Promise<McpCommonNeighborsResponse> {
    return this.callTool<McpCommonNeighborsResponse>('get_common_neighbors', {
      note_a: noteA,
      note_b: noteB,
    });
  }

  /**
   * Get connection strength score between two notes.
   */
  async getConnectionStrength(noteA: string, noteB: string): Promise<McpConnectionStrengthResponse> {
    return this.callTool<McpConnectionStrengthResponse>('get_connection_strength', {
      note_a: noteA,
      note_b: noteB,
    });
  }

  // -------------------------------------------------------------------------
  // Vault growth & metrics
  // -------------------------------------------------------------------------

  /**
   * Get vault growth metrics (current snapshot, history, trends, or index activity).
   */
  async vaultGrowth(
    mode: VaultGrowthMode = 'current',
    options: { metric?: string; days_back?: number; limit?: number } = {},
  ): Promise<McpVaultGrowthResponse> {
    return this.callTool<McpVaultGrowthResponse>('vault_growth', {
      mode,
      ...options,
    });
  }

  // -------------------------------------------------------------------------
  // Write tools
  // -------------------------------------------------------------------------

  /**
   * Replace text in a specific section of a note.
   */
  async replaceInSection(
    path: string,
    section: string,
    search: string,
    replacement: string,
  ): Promise<McpMutationResponse> {
    const result = await this.callTool<McpMutationResponse>('vault_replace_in_section', {
      path,
      section,
      search,
      replacement,
      skipWikilinks: true,
      suggestOutgoingLinks: false,
      validate: false,
    });
    this.cache.invalidatePath(path);
    this.cache.invalidateTool('get_backlinks');
    this.cache.invalidateTool('get_forward_links');
    return result;
  }

  /**
   * Validate wikilinks across the vault — find broken links with optional typo suggestions.
   */
  async validateLinks(typosOnly = false, limit = 50): Promise<McpValidateLinksResponse> {
    return this.callTool<McpValidateLinksResponse>('validate_links', {
      typos_only: typosOnly,
      limit,
    });
  }

  /**
   * Get wikilink feedback stats or entries.
   */
  async wikilinkFeedback(mode: 'list' | 'stats', entity?: string, limit?: number): Promise<McpWikilinkFeedbackResponse> {
    return this.callTool<McpWikilinkFeedbackResponse>('wikilink_feedback', {
      mode,
      ...(entity ? { entity } : {}),
      ...(limit ? { limit } : {}),
    });
  }

  /**
   * Get full feedback loop dashboard data.
   */
  async wikilinkFeedbackDashboard(): Promise<McpFeedbackDashboardResponse> {
    return this.callTool<McpFeedbackDashboardResponse>('wikilink_feedback', { mode: 'dashboard' });
  }

  /**
   * Update frontmatter fields on a note.
   */
  async updateFrontmatter(
    path: string,
    frontmatter: Record<string, unknown>,
    onlyIfMissing = false,
  ): Promise<McpMutationResponse> {
    const result = await this.callTool<McpMutationResponse>('vault_update_frontmatter', {
      path,
      frontmatter,
      only_if_missing: onlyIfMissing,
    });
    this.cache.invalidateTool('vault_schema');
    this.cache.invalidatePath(path);
    return result;
  }

  // -------------------------------------------------------------------------
  // Config
  // -------------------------------------------------------------------------

  /**
   * Get the current FlywheelConfig from the MCP server.
   */
  async getFlywheelConfig(): Promise<McpFlywheelConfigResponse> {
    return this.callTool<McpFlywheelConfigResponse>('flywheel_config', { mode: 'get' });
  }

  /**
   * Update a single key in FlywheelConfig.
   */
  async setFlywheelConfig(key: string, value: unknown): Promise<McpFlywheelConfigResponse> {
    return this.callTool<McpFlywheelConfigResponse>('flywheel_config', { mode: 'set', key, value });
  }

  // -------------------------------------------------------------------------
  // Server log
  // -------------------------------------------------------------------------

  /**
   * Query the server's in-memory activity log.
   */
  async getServerLog(options: { since?: number; component?: string; limit?: number } = {}): Promise<McpServerLogResponse> {
    return this.callTool<McpServerLogResponse>('server_log', options);
  }

  // -------------------------------------------------------------------------
  // Phase 4 observability APIs
  // -------------------------------------------------------------------------

  /**
   * Get an entity's score timeline over time.
   */
  async entityScoreTimeline(entity: string, daysBack = 30, limit = 100): Promise<McpEntityTimelineResponse> {
    return this.callTool<McpEntityTimelineResponse>('wikilink_feedback', {
      mode: 'entity_timeline',
      entity,
      days_back: daysBack,
      limit,
    });
  }

  /**
   * Get layer contribution timeseries data.
   */
  async layerContributionTimeseries(granularity: 'day' | 'week' = 'day', daysBack = 30): Promise<McpLayerTimeseriesResponse> {
    return this.callTool<McpLayerTimeseriesResponse>('wikilink_feedback', {
      mode: 'layer_timeseries',
      granularity,
      days_back: daysBack,
    });
  }

  /**
   * Compare two graph snapshots and get the diff.
   */
  async snapshotDiff(timestampBefore: number, timestampAfter: number): Promise<McpSnapshotDiffResponse> {
    return this.callTool<McpSnapshotDiffResponse>('wikilink_feedback', {
      mode: 'snapshot_diff',
      timestamp_before: timestampBefore,
      timestamp_after: timestampAfter,
    });
  }
}
