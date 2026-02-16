/**
 * Flywheel MCP Client
 *
 * Thin wrapper around the MCP SDK Client that spawns a flywheel-memory
 * server process and provides typed helper methods for search, similarity,
 * and graph tools.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

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
}

export interface McpSearchResponse {
  scope: string;
  method: 'fts5' | 'hybrid';
  query: string;
  total_results: number;
  results: McpSearchResult[];
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
   */
  async connect(vaultPath: string): Promise<void> {
    if (this._connected) return;

    // Resolve flywheel-memory binary — try the local dev build first,
    // fall back to npx (for published package).
    const serverPath = '/home/ben/src/flywheel-memory/packages/mcp-server/dist/index.js';

    this.transport = new StdioClientTransport({
      command: 'node',
      args: [serverPath],
      env: {
        ...process.env,
        VAULT_PATH: vaultPath,
        FLYWHEEL_TOOLS: 'search,backlinks,schema',
        FLYWHEEL_WATCH: 'true',
      },
    });

    this.client = new Client({
      name: 'flywheel-crank',
      version: '0.1.0',
    });

    await this.client.connect(this.transport);
    this._connected = true;
    console.log('Flywheel Crank: MCP client connected');
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
  private async callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
    if (!this.client || !this._connected) {
      throw new Error('MCP client not connected');
    }

    const result = await this.client.callTool({ name, arguments: args });

    // The MCP SDK returns content as an array of content blocks.
    // Tool responses are JSON-stringified in the first text block.
    const content = result.content as Array<{ type: string; text?: string }>;
    const textBlock = content?.find(c => c.type === 'text');
    if (!textBlock?.text) {
      throw new Error(`No text response from tool ${name}`);
    }

    return JSON.parse(textBlock.text) as T;
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
}
