#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerMutationTools } from './tools/mutations.js';
import { registerTaskTools } from './tools/tasks.js';
import { registerFrontmatterTools } from './tools/frontmatter.js';
import { registerNoteTools } from './tools/notes.js';
import { registerMoveNoteTools } from './tools/move-notes.js';
import { registerSystemTools } from './tools/system.js';
import { registerPolicyTools } from './tools/policy.js';
import { findVaultRoot } from './core/vaultRoot.js';
import { initializeEntityIndex, setCrankStateDb } from './core/wikilinks.js';
import { initializeLogger, flushLogs } from './core/logging.js';
import { openStateDb, type StateDb } from '@velvetmonkey/vault-core';
import { registerEntitySearchTools } from './tools/entity-search.js';

const server = new McpServer({
  name: 'flywheel-crank',
  version: '0.3.0',
});

const vaultPath = process.env.PROJECT_PATH || findVaultRoot();

// State database (SQLite with FTS5) - initialized after server starts
let stateDb: StateDb | null = null;

console.error(`[Crank] Starting Flywheel Crank MCP server`);
console.error(`[Crank] Vault path: ${vaultPath}`);

// Register all tool modules (uses lazy getter for stateDb)
registerMutationTools(server, vaultPath);
registerTaskTools(server, vaultPath);
registerFrontmatterTools(server, vaultPath);
registerNoteTools(server, vaultPath);
registerMoveNoteTools(server, vaultPath);
registerSystemTools(server, vaultPath);
registerPolicyTools(server, vaultPath);
registerEntitySearchTools(server, vaultPath, () => stateDb);

async function main() {
  // Start server FIRST (fast startup - don't wait for StateDb or entity index)
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[Crank] Flywheel Crank MCP server started successfully`);

  // Initialize logging in background (for operation metrics)
  initializeLogger(vaultPath).catch(err => {
    console.error(`[Crank] Logger initialization failed: ${err}`);
  });

  // Initialize StateDb and entity index in background AFTER server is ready
  // Use setImmediate to yield to event loop and allow MCP handshake to complete
  setImmediate(async () => {
    try {
      // Initialize StateDb first (needed for entity cache)
      stateDb = openStateDb(vaultPath);
      console.error('[Crank] StateDb initialized');

      // Set StateDb for all core modules (git, hints, recency, wikilinks)
      setCrankStateDb(stateDb);

      // Initialize entity index (will scan vault if no cache, or load from SQLite)
      await initializeEntityIndex(vaultPath);
    } catch (err) {
      console.error('[Crank] Background initialization failed:', err);
      // Non-fatal - entity features will be disabled but other tools work
    }
  });
}

main().catch((error) => {
  console.error('[Crank] Fatal error:', error);
  process.exit(1);
});

// Flush logs on exit
process.on('beforeExit', async () => {
  await flushLogs();
});
