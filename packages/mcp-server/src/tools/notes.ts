/**
 * Note creation tools for Flywheel Crank
 * Tools: vault_create_note, vault_delete_note
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { writeVaultFile, validatePath } from '../core/writer.js';
import type { MutationResult } from '../core/types.js';
import { commitChange } from '../core/git.js';
import { maybeApplyWikilinks, suggestRelatedLinks } from '../core/wikilinks.js';
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
      skipWikilinks: z.boolean().default(false).describe('If true, skip auto-wikilink application (wikilinks are applied by default)'),
      suggestOutgoingLinks: z.boolean().default(true).describe('Append suggested outgoing wikilinks based on content (e.g., "→ [[AI]] [[Philosophy]]"). Set false to disable.'),
      maxSuggestions: z.number().min(1).max(10).default(3).describe('Maximum number of suggested wikilinks to append (1-10, default: 3)'),
    },
    async ({ path: notePath, content, frontmatter, overwrite, commit, skipWikilinks, suggestOutgoingLinks, maxSuggestions }) => {
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

        // 4. Apply wikilinks to content (unless skipped)
        let { content: processedContent, wikilinkInfo } = maybeApplyWikilinks(content, skipWikilinks, notePath);

        // 5. Suggest outgoing links (enabled by default)
        let suggestInfo: string | undefined;
        if (suggestOutgoingLinks && !skipWikilinks) {
          const result = suggestRelatedLinks(processedContent, { maxSuggestions, notePath });
          if (result.suffix) {
            processedContent = processedContent + ' ' + result.suffix;
            suggestInfo = `Suggested: ${result.suggestions.join(', ')}`;
          }
        }

        // 6. Write the note
        await writeVaultFile(vaultPath, notePath, processedContent, frontmatter);

        // 5. Commit if requested
        let gitCommit: string | undefined;
        let undoAvailable: boolean | undefined;
        let staleLockDetected: boolean | undefined;
        let lockAgeMs: number | undefined;
        if (commit) {
          const gitResult = await commitChange(vaultPath, notePath, '[Crank:Create]');
          if (gitResult.success && gitResult.hash) {
            gitCommit = gitResult.hash;
            undoAvailable = gitResult.undoAvailable;
          }
          if (gitResult.staleLockDetected) {
            staleLockDetected = gitResult.staleLockDetected;
            lockAgeMs = gitResult.lockAgeMs;
          }
        }

        // Build preview with wikilink info
        const infoLines = [wikilinkInfo, suggestInfo].filter(Boolean);
        const previewLines = [
          `Frontmatter fields: ${Object.keys(frontmatter).join(', ') || 'none'}`,
          `Content length: ${processedContent.length} chars`,
        ];
        if (infoLines.length > 0) {
          previewLines.push(`(${infoLines.join('; ')})`);
        }

        const result: MutationResult = {
          success: true,
          message: `Created note: ${notePath}`,
          path: notePath,
          preview: previewLines.join('\n'),
          gitCommit,
          undoAvailable,
          staleLockDetected,
          lockAgeMs,
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
        let undoAvailable: boolean | undefined;
        let staleLockDetected: boolean | undefined;
        let lockAgeMs: number | undefined;
        if (commit) {
          const gitResult = await commitChange(vaultPath, notePath, '[Crank:Delete]');
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
          message: `Deleted note: ${notePath}`,
          path: notePath,
          gitCommit,
          undoAvailable,
          staleLockDetected,
          lockAgeMs,
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
