/**
 * System tools for Flywheel Crank
 * Tools: vault_list_sections, vault_undo_last_mutation
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { readVaultFile, extractHeadings, validatePath } from '../core/writer.js';
import {
  undoLastCommit,
  getLastCommit,
  isGitRepo,
  getLastCrankCommit,
  clearLastCrankCommit,
} from '../core/git.js';
import type { MutationResult } from '../core/types.js';
import fs from 'fs/promises';
import path from 'path';

export interface SectionListResult {
  success: boolean;
  message: string;
  path: string;
  sections?: Array<{
    level: number;
    name: string;
    line: number;
  }>;
}

export function registerSystemTools(
  server: McpServer,
  vaultPath: string
): void {
  // ========================================
  // Tool: vault_list_sections
  // ========================================
  server.tool(
    'vault_list_sections',
    'List all sections (headings) in a markdown note',
    {
      path: z.string().describe('Vault-relative path to the note'),
      minLevel: z.number().min(1).max(6).default(1).describe('Minimum heading level to include'),
      maxLevel: z.number().min(1).max(6).default(6).describe('Maximum heading level to include'),
    },
    async ({ path: notePath, minLevel, maxLevel }) => {
      try {
        // 1. Validate path
        if (!validatePath(vaultPath, notePath)) {
          const result: SectionListResult = {
            success: false,
            message: 'Invalid path: path traversal not allowed',
            path: notePath,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 2. Check if file exists
        const fullPath = path.join(vaultPath, notePath);
        try {
          await fs.access(fullPath);
        } catch {
          const result: SectionListResult = {
            success: false,
            message: `File not found: ${notePath}`,
            path: notePath,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 3. Read file
        const { content: fileContent } = await readVaultFile(vaultPath, notePath);

        // 4. Extract headings
        const headings = extractHeadings(fileContent);

        // 5. Filter by level
        const filteredHeadings = headings.filter(
          (h) => h.level >= minLevel && h.level <= maxLevel
        );

        // 6. Format result
        const sections = filteredHeadings.map((h) => ({
          level: h.level,
          name: h.text,
          line: h.line + 1, // 1-indexed for user display
        }));

        const result: SectionListResult = {
          success: true,
          message: `Found ${sections.length} section(s) in ${notePath}`,
          path: notePath,
          sections,
        };

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const result: SectionListResult = {
          success: false,
          message: `Failed to list sections: ${error instanceof Error ? error.message : String(error)}`,
          path: notePath,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    }
  );

  // ========================================
  // Tool: vault_undo_last_mutation
  // ========================================
  server.tool(
    'vault_undo_last_mutation',
    'Undo the last git commit (typically the last Crank mutation). Performs a soft reset.',
    {
      confirm: z.boolean().default(false).describe('Must be true to confirm undo operation'),
    },
    async ({ confirm }) => {
      try {
        // 1. Require confirmation
        if (!confirm) {
          // Show what would be undone
          const lastCommit = await getLastCommit(vaultPath);

          if (!lastCommit) {
            const result: MutationResult = {
              success: false,
              message: 'No commits found to undo',
              path: '',
            };
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }

          const result: MutationResult = {
            success: false,
            message: `Undo requires confirmation (confirm=true). Would undo: "${lastCommit.message}"`,
            path: '',
            preview: `Commit: ${lastCommit.hash.substring(0, 7)}\nMessage: ${lastCommit.message}\nDate: ${lastCommit.date}`,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 2. Check if git repo
        const isRepo = await isGitRepo(vaultPath);
        if (!isRepo) {
          const result: MutationResult = {
            success: false,
            message: 'Vault is not a git repository. Undo is only available for git-tracked vaults.',
            path: '',
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 3. Verify HEAD matches expected Crank commit (safety check)
        const lastCrankCommit = await getLastCrankCommit(vaultPath);
        const lastCommit = await getLastCommit(vaultPath);

        if (lastCrankCommit && lastCommit) {
          if (lastCommit.hash !== lastCrankCommit.hash) {
            const result: MutationResult = {
              success: false,
              message: `Cannot undo: HEAD (${lastCommit.hash.substring(0, 7)}) doesn't match last Crank commit (${lastCrankCommit.hash.substring(0, 7)}). Another process may have committed since your mutation.`,
              path: '',
              preview: `Expected: ${lastCrankCommit.hash.substring(0, 7)} "${lastCrankCommit.message}"\nActual HEAD: ${lastCommit.hash.substring(0, 7)} "${lastCommit.message}"`,
            };
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
        }

        // 4. Perform undo
        const undoResult = await undoLastCommit(vaultPath);

        if (!undoResult.success) {
          const result: MutationResult = {
            success: false,
            message: undoResult.message,
            path: '',
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 5. Clear tracking after successful undo
        await clearLastCrankCommit(vaultPath);

        const result: MutationResult = {
          success: true,
          message: undoResult.message,
          path: '',
          preview: undoResult.undoneCommit
            ? `Commit: ${undoResult.undoneCommit.hash.substring(0, 7)}\nMessage: ${undoResult.undoneCommit.message}`
            : undefined,
        };

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const result: MutationResult = {
          success: false,
          message: `Failed to undo: ${error instanceof Error ? error.message : String(error)}`,
          path: '',
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    }
  );

  console.error('[Crank] System tools registered (vault_list_sections, vault_undo_last_mutation)');
}
