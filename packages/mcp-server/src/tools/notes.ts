/**
 * Note creation tools for Flywheel Crank
 * Tools: vault_create_note, vault_delete_note
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { writeVaultFile, validatePath } from '../core/writer.js';
import type { MutationResult } from '../core/types.js';
import { commitChange } from '../core/git.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Register note CRUD tools with the MCP server
 */
export function registerNoteTools(
  server: McpServer,
  vaultPath: string
): void {
  // ========================================
  // Tool: vault_create_note
  // ========================================
  server.tool(
    'vault_create_note',
    'Create a new note in the vault with optional frontmatter and content',
    {
      path: z.string().describe('Vault-relative path for the new note (e.g., "daily-notes/2026-01-28.md")'),
      content: z.string().default('').describe('Initial content for the note'),
      frontmatter: z.record(z.any()).default({}).describe('Frontmatter fields (JSON object)'),
      overwrite: z.boolean().default(false).describe('If true, overwrite existing file'),
      commit: z.boolean().default(false).describe('If true, commit this change to git (creates undo point)'),
    },
    async ({ path: notePath, content, frontmatter, overwrite, commit }) => {
      try {
        // 1. Validate path
        if (!validatePath(vaultPath, notePath)) {
          const result: MutationResult = {
            success: false,
            message: 'Invalid path: path traversal not allowed',
            path: notePath,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        const fullPath = path.join(vaultPath, notePath);

        // 2. Check if file already exists
        try {
          await fs.access(fullPath);
          if (!overwrite) {
            const result: MutationResult = {
              success: false,
              message: `File already exists: ${notePath}. Use overwrite=true to replace.`,
              path: notePath,
            };
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
        } catch {
          // File doesn't exist, which is what we want
        }

        // 3. Ensure parent directories exist
        const dir = path.dirname(fullPath);
        await fs.mkdir(dir, { recursive: true });

        // 4. Write the note
        await writeVaultFile(vaultPath, notePath, content, frontmatter);

        // 5. Commit if requested
        let gitCommit: string | undefined;
        let gitError: string | undefined;
        if (commit) {
          const gitResult = await commitChange(vaultPath, notePath, '[Crank:Create]');
          if (gitResult.success) {
            gitCommit = gitResult.hash;
          } else {
            gitError = gitResult.error;
          }
        }

        const result: MutationResult = {
          success: true,
          message: `Created note: ${notePath}`,
          path: notePath,
          preview: `Frontmatter fields: ${Object.keys(frontmatter).join(', ') || 'none'}\nContent length: ${content.length} chars`,
          gitCommit,
          gitError,
        };

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const result: MutationResult = {
          success: false,
          message: `Failed to create note: ${error instanceof Error ? error.message : String(error)}`,
          path: notePath,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    }
  );

  // ========================================
  // Tool: vault_delete_note
  // ========================================
  server.tool(
    'vault_delete_note',
    'Delete a note from the vault',
    {
      path: z.string().describe('Vault-relative path to the note to delete'),
      confirm: z.boolean().default(false).describe('Must be true to confirm deletion'),
      commit: z.boolean().default(false).describe('If true, commit this change to git (creates undo point)'),
    },
    async ({ path: notePath, confirm, commit }) => {
      try {
        // 1. Require confirmation
        if (!confirm) {
          const result: MutationResult = {
            success: false,
            message: 'Deletion requires explicit confirmation (confirm=true)',
            path: notePath,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 2. Validate path
        if (!validatePath(vaultPath, notePath)) {
          const result: MutationResult = {
            success: false,
            message: 'Invalid path: path traversal not allowed',
            path: notePath,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        const fullPath = path.join(vaultPath, notePath);

        // 3. Check if file exists
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

        // 4. Delete the file
        await fs.unlink(fullPath);

        // 5. Commit if requested
        let gitCommit: string | undefined;
        let gitError: string | undefined;
        if (commit) {
          const gitResult = await commitChange(vaultPath, notePath, '[Crank:Delete]');
          if (gitResult.success) {
            gitCommit = gitResult.hash;
          } else {
            gitError = gitResult.error;
          }
        }

        const result: MutationResult = {
          success: true,
          message: `Deleted note: ${notePath}`,
          path: notePath,
          gitCommit,
          gitError,
        };

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const result: MutationResult = {
          success: false,
          message: `Failed to delete note: ${error instanceof Error ? error.message : String(error)}`,
          path: notePath,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    }
  );

  console.error('[Crank] Note tools registered (vault_create_note, vault_delete_note)');
}
