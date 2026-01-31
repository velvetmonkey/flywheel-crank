/**
 * Frontmatter tools for Flywheel Crank
 * Tools: vault_update_frontmatter, vault_add_frontmatter_field
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readVaultFile, writeVaultFile } from '../core/writer.js';
import type { MutationResult } from '../core/types.js';
import { commitChange } from '../core/git.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Register frontmatter tools with the MCP server
 */
export function registerFrontmatterTools(
  server: McpServer,
  vaultPath: string
): void {
  // ========================================
  // Tool: vault_update_frontmatter
  // ========================================
  server.tool(
    'vault_update_frontmatter',
    'Update frontmatter fields in a note (merge with existing frontmatter)',
    {
      path: z.string().describe('Vault-relative path to the note'),
      frontmatter: z.record(z.any()).describe('Frontmatter fields to update (JSON object)'),
      commit: z.boolean().default(false).describe('If true, commit this change to git (creates undo point)'),
    },
    async ({ path: notePath, frontmatter: updates, commit }) => {
      try {
        // 1. Check if file exists
        const fullPath = path.join(vaultPath, notePath);
        try {
          await fs.access(fullPath);
        } catch {
          const result: MutationResult = {
            success: false,
            message: `File not found: ${notePath}`,
            path: notePath,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 2. Read file with frontmatter
        const { content, frontmatter } = await readVaultFile(vaultPath, notePath);

        // 3. Merge frontmatter (updates override existing)
        const updatedFrontmatter = { ...frontmatter, ...updates };

        // 4. Write back
        await writeVaultFile(vaultPath, notePath, content, updatedFrontmatter);

        // 5. Commit if requested
        let gitCommit: string | undefined;
        let undoAvailable: boolean | undefined;
        let staleLockDetected: boolean | undefined;
        let lockAgeMs: number | undefined;
        if (commit) {
          const gitResult = await commitChange(vaultPath, notePath, '[Crank:FM]');
          if (gitResult.success && gitResult.hash) {
            gitCommit = gitResult.hash;
            undoAvailable = gitResult.undoAvailable;
          }
          if (gitResult.staleLockDetected) {
            staleLockDetected = gitResult.staleLockDetected;
            lockAgeMs = gitResult.lockAgeMs;
          }
        }

        // 6. Generate preview
        const updatedKeys = Object.keys(updates);
        const preview = updatedKeys.map(k => `${k}: ${JSON.stringify(updates[k])}`).join('\n');

        const result: MutationResult = {
          success: true,
          message: `Updated ${updatedKeys.length} frontmatter field(s) in ${notePath}`,
          path: notePath,
          preview,
          gitCommit,
          undoAvailable,
          staleLockDetected,
          lockAgeMs,
        };

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const result: MutationResult = {
          success: false,
          message: `Failed to update frontmatter: ${error instanceof Error ? error.message : String(error)}`,
          path: notePath,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    }
  );

  // ========================================
  // Tool: vault_add_frontmatter_field
  // ========================================
  server.tool(
    'vault_add_frontmatter_field',
    'Add a new frontmatter field to a note (only if it doesn\'t exist)',
    {
      path: z.string().describe('Vault-relative path to the note'),
      key: z.string().describe('Field name to add'),
      value: z.any().describe('Field value (string, number, boolean, array, object)'),
      commit: z.boolean().default(false).describe('If true, commit this change to git (creates undo point)'),
    },
    async ({ path: notePath, key, value, commit }) => {
      try {
        // 1. Check if file exists
        const fullPath = path.join(vaultPath, notePath);
        try {
          await fs.access(fullPath);
        } catch {
          const result: MutationResult = {
            success: false,
            message: `File not found: ${notePath}`,
            path: notePath,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 2. Read file with frontmatter
        const { content, frontmatter } = await readVaultFile(vaultPath, notePath);

        // 3. Check if key already exists
        if (key in frontmatter) {
          const result: MutationResult = {
            success: false,
            message: `Field "${key}" already exists. Use vault_update_frontmatter to modify existing fields.`,
            path: notePath,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 4. Add new field
        const updatedFrontmatter = { ...frontmatter, [key]: value };

        // 5. Write back
        await writeVaultFile(vaultPath, notePath, content, updatedFrontmatter);

        // 6. Commit if requested
        let gitCommit: string | undefined;
        let undoAvailable: boolean | undefined;
        let staleLockDetected: boolean | undefined;
        let lockAgeMs: number | undefined;
        if (commit) {
          const gitResult = await commitChange(vaultPath, notePath, '[Crank:FM]');
          if (gitResult.success && gitResult.hash) {
            gitCommit = gitResult.hash;
            undoAvailable = gitResult.undoAvailable;
          }
          if (gitResult.staleLockDetected) {
            staleLockDetected = gitResult.staleLockDetected;
            lockAgeMs = gitResult.lockAgeMs;
          }
        }

        const result: MutationResult = {
          success: true,
          message: `Added frontmatter field "${key}" to ${notePath}`,
          path: notePath,
          preview: `${key}: ${JSON.stringify(value)}`,
          gitCommit,
          undoAvailable,
          staleLockDetected,
          lockAgeMs,
        };

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const result: MutationResult = {
          success: false,
          message: `Failed to add frontmatter field: ${error instanceof Error ? error.message : String(error)}`,
          path: notePath,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    }
  );

  console.error('[Crank] Frontmatter tools registered (vault_update_frontmatter, vault_add_frontmatter_field)');
}
