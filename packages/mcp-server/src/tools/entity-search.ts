/**
 * Entity search tools - FTS5 full-text search for vault entities
 *
 * Provides search_entities tool for finding entities (people, projects,
 * technologies, etc.) using SQLite FTS5 with Porter stemming.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  searchEntities,
  searchEntitiesPrefix,
  type StateDb,
  type EntitySearchResult,
} from '@velvetmonkey/vault-core';

/**
 * Register entity search tools
 *
 * @param server - MCP server instance
 * @param vaultPath - Path to the vault root
 * @param getStateDb - Getter function for StateDb instance
 */
export function registerEntitySearchTools(
  server: McpServer,
  vaultPath: string,
  getStateDb: () => StateDb | null
): void {
  // search_entities - Search vault entities using FTS5 full-text search
  const EntityResultSchema = z.object({
    id: z.number().describe('Entity ID'),
    name: z.string().describe('Entity name'),
    path: z.string().describe('Path to entity note'),
    category: z.string().describe('Entity category (technologies, people, projects, etc.)'),
    aliases: z.array(z.string()).describe('Entity aliases'),
    hubScore: z.number().describe('Hub score (backlink count)'),
    rank: z.number().describe('Search relevance rank'),
  });

  const SearchEntitiesOutputSchema = {
    entities: z.array(EntityResultSchema).describe('Matching entities'),
    count: z.number().describe('Number of results returned'),
    query: z.string().describe('The search query that was executed'),
  };

  type SearchEntitiesOutput = {
    entities: EntitySearchResult[];
    count: number;
    query: string;
  };

  server.registerTool(
    'search_entities',
    {
      title: 'Search Entities',
      description:
        'Search vault entities (people, projects, technologies, etc.) using FTS5 full-text search with Porter stemming. Supports word variations (running matches run/runs/ran), prefix matching (auth*), and phrase search.',
      inputSchema: {
        query: z
          .string()
          .describe('Search query. Supports stemming, prefix matching (term*), phrases.'),
        limit: z
          .number()
          .default(20)
          .describe('Maximum number of results to return'),
        prefix: z
          .boolean()
          .default(false)
          .describe('Enable prefix matching (for autocomplete)'),
      },
      outputSchema: SearchEntitiesOutputSchema,
    },
    async ({
      query,
      limit = 20,
      prefix = false,
    }): Promise<{
      content: Array<{ type: 'text'; text: string }>;
      structuredContent: SearchEntitiesOutput;
    }> => {
      const stateDb = getStateDb();

      if (!stateDb) {
        const output: SearchEntitiesOutput = {
          entities: [],
          count: 0,
          query,
        };
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: 'StateDb not initialized', ...output }, null, 2),
            },
          ],
          structuredContent: output,
        };
      }

      // Cap limit to reasonable maximum
      const cappedLimit = Math.min(limit, 100);

      try {
        const results = prefix
          ? searchEntitiesPrefix(stateDb, query, cappedLimit)
          : searchEntities(stateDb, query, cappedLimit);

        const output: SearchEntitiesOutput = {
          entities: results,
          count: results.length,
          query,
        };

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(output, null, 2),
            },
          ],
          structuredContent: output,
        };
      } catch (err) {
        const output: SearchEntitiesOutput = {
          entities: [],
          count: 0,
          query,
        };
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: err instanceof Error ? err.message : String(err), ...output }, null, 2),
            },
          ],
          structuredContent: output,
        };
      }
    }
  );
}
