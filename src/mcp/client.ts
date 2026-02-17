/**
 * Flywheel MCP Client
 *
 * Thin wrapper around the MCP SDK Client that spawns a flywheel-memory
 * server process and provides typed helper methods for search, similarity,
 * and graph tools.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

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
  config?: Record<string, unknown>;
  last_rebuild?: {
    trigger: string;
    timestamp: number;
    duration_ms: number;
    ago_seconds: number;
  };
  fts5_ready?: boolean;
  fts5_building?: boolean;
  embeddings_building?: boolean;
  embeddings_ready?: boolean;
  embeddings_count?: number;
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

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class FlywheelMcpClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private _connected = false;

  get connected(): boolean {
    return this._connected;
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
        command = 'wsl';
        args = [
          'bash', '-c',
          `VAULT_PATH="${wslVault}" FLYWHEEL_TOOLS="search,backlinks,schema,health,wikilinks" FLYWHEEL_WATCH="true" exec node "${serverPath}"`,
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
        FLYWHEEL_TOOLS: 'search,backlinks,schema,health,wikilinks',
        FLYWHEEL_WATCH: 'true',
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
    if (!this._connected) return;

    try {
      await this.client?.close();
    } catch {
      // ignore close errors
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

    const result = await this.client.callTool(
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
    return this.callTool<McpRefreshIndexResponse>('refresh_index', {});
  }
}
