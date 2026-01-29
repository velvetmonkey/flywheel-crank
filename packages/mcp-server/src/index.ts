#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerMutationTools } from './tools/mutations.js';
import { registerTaskTools } from './tools/tasks.js';
import { registerFrontmatterTools } from './tools/frontmatter.js';
import { registerNoteTools } from './tools/notes.js';
import { registerSystemTools } from './tools/system.js';
import { findVaultRoot } from './core/vaultRoot.js';
import { initializeEntityIndex } from './core/wikilinks.js';

const server = new McpServer({
  name: 'flywheel-crank',
  version: '0.3.0',
});

const vaultPath = process.env.PROJECT_PATH || findVaultRoot();

console.error(`[Crank] Starting Flywheel Crank MCP server`);
console.error(`[Crank] Vault path: ${vaultPath}`);

// Initialize entity index in background (for wikilink suggestions)
// This runs asynchronously - server starts immediately
initializeEntityIndex(vaultPath).catch(err => {
  console.error(`[Crank] Entity index initialization failed: ${err}`);
});

// Register all tool modules
registerMutationTools(server, vaultPath);
registerTaskTools(server, vaultPath);
registerFrontmatterTools(server, vaultPath);
registerNoteTools(server, vaultPath);
registerSystemTools(server, vaultPath);

// Start server
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[Crank] Flywheel Crank MCP server started successfully`);
