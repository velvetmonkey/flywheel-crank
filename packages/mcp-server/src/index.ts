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
import {
  openStateDb,
  type StateDb,
  migrateFromJsonToSqlite,
  getLegacyPaths,
} from '@velvetmonkey/vault-core';
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

// Initialize entity index in background (for wikilink suggestions)
// This runs asynchronously - server starts immediately
initializeEntityIndex(vaultPath).catch(err => {
  console.error(`[Crank] Entity index initialization failed: ${err}`);
});

// Initialize logging in background (for operation metrics)
initializeLogger(vaultPath).catch(err => {
  console.error(`[Crank] Logger initialization failed: ${err}`);
});

// Register all tool modules (uses lazy getter for stateDb)
registerMutationTools(server, vaultPath);
registerTaskTools(server, vaultPath);
registerFrontmatterTools(server, vaultPath);
registerNoteTools(server, vaultPath);
registerMoveNoteTools(server, vaultPath);
registerSystemTools(server, vaultPath);
registerPolicyTools(server, vaultPath);
registerEntitySearchTools(server, vaultPath, () => stateDb);

// Start server FIRST (fast startup - don't wait for StateDb)
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[Crank] Flywheel Crank MCP server started successfully`);

// Initialize StateDb in background AFTER server is ready
// This defers the blocking SQLite open/prepare operations
Promise.resolve().then(() => {
  try {
    stateDb = openStateDb(vaultPath);
    console.error('[Crank] StateDb initialized');

    // Set StateDb for all core modules (git, hints, recency, wikilinks)
    setCrankStateDb(stateDb);

    // Auto-migrate from JSON on first run
    const legacyPaths = getLegacyPaths(vaultPath);
    migrateFromJsonToSqlite(stateDb, legacyPaths).then(migration => {
      if (migration.entitiesMigrated > 0) {
        console.error(`[Crank] Migrated ${migration.entitiesMigrated} entities from JSON`);
      }
      if (migration.recencyMigrated > 0) {
        console.error(`[Crank] Migrated ${migration.recencyMigrated} recency records`);
      }
      if (migration.crankStateMigrated > 0) {
        console.error(`[Crank] Migrated ${migration.crankStateMigrated} crank state entries`);
      }
    }).catch(err => {
      console.error('[Crank] Migration failed:', err);
    });
  } catch (err) {
    console.error('[Crank] StateDb init failed:', err);
    // Non-fatal - entity search will return error but other tools work
  }
});

// Flush logs on exit
process.on('beforeExit', async () => {
  await flushLogs();
});
