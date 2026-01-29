/**
 * Mutation tools for Flywheel Crank
 * Tools: vault_add_to_section, vault_remove_from_section, vault_replace_in_section
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  readVaultFile,
  writeVaultFile,
  findSection,
  formatContent,
  insertInSection,
  removeFromSection,
  replaceInSection,
  type MatchMode,
} from '../core/writer.js';
import type { MutationResult, FormatType, Position } from '../core/types.js';
import { commitChange } from '../core/git.js';
import { maybeApplyWikilinks, suggestRelatedLinks } from '../core/wikilinks.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Register mutation tools with the MCP server
 */
export function registerMutationTools(
  server: McpServer,
  vaultPath: string
): void {
  // ========================================
  // Tool: vault_add_to_section
  // ========================================
  server.tool(
    'vault_add_to_section',
    'Add content to a specific section in a markdown note',
    {
      path: z.string().describe('Vault-relative path to the note (e.g., "daily-notes/2026-01-28.md")'),
      section: z.string().describe('Heading text to add to (e.g., "Log" or "## Log")'),
      content: z.string().describe('Content to add to the section'),
      position: z.enum(['append', 'prepend']).default('append').describe('Where to insert content'),
      format: z
        .enum(['plain', 'bullet', 'task', 'numbered', 'timestamp-bullet'])
        .default('plain')
        .describe('How to format the content'),
      commit: z.boolean().default(false).describe('If true, commit this change to git (creates undo point)'),
      skipWikilinks: z.boolean().default(false).describe('If true, skip auto-wikilink application (wikilinks are applied by default)'),
      preserveListNesting: z.boolean().default(false).describe('If true, detect and preserve the indentation level of surrounding list items'),
      suggestOutgoingLinks: z.boolean().default(true).describe('Append suggested outgoing wikilinks based on content (e.g., "→ [[AI]] [[Philosophy]]"). Set false to disable.'),
    },
    async ({ path: notePath, section, content, position, format, commit, skipWikilinks, preserveListNesting, suggestOutgoingLinks }) => {
      try {
        // 1. Validate path (security check)
        const fullPath = path.join(vaultPath, notePath);

        // 2. Check if file exists
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

        // 3. Read file with frontmatter
        const { content: fileContent, frontmatter } = await readVaultFile(vaultPath, notePath);

        // 4. Find the section
        const sectionBoundary = findSection(fileContent, section);
        if (!sectionBoundary) {
          const result: MutationResult = {
            success: false,
            message: `Section not found: ${section}`,
            path: notePath,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 5. Apply wikilinks to content (unless skipped)
        let { content: processedContent, wikilinkInfo } = maybeApplyWikilinks(content, skipWikilinks);

        // 5b. Suggest outgoing links (enabled by default)
        let suggestInfo: string | undefined;
        if (suggestOutgoingLinks && !skipWikilinks) {
          const result = suggestRelatedLinks(processedContent);
          if (result.suffix) {
            processedContent = processedContent + ' ' + result.suffix;
            suggestInfo = `Suggested: ${result.suggestions.join(', ')}`;
          }
        }

        // 6. Format the content
        const formattedContent = formatContent(processedContent, format as FormatType);

        // 7. Insert at position
        const updatedContent = insertInSection(
          fileContent,
          sectionBoundary,
          formattedContent,
          position as Position,
          { preserveListNesting }
        );

        // 8. Write file (preserving frontmatter)
        await writeVaultFile(vaultPath, notePath, updatedContent, frontmatter);

        // 9. Commit if requested
        let gitCommit: string | undefined;
        let gitError: string | undefined;
        if (commit) {
          const gitResult = await commitChange(vaultPath, notePath, '[Crank:Add]');
          if (gitResult.success) {
            gitCommit = gitResult.hash;
          } else {
            gitError = gitResult.error;
          }
        }

        // 10. Generate preview (show the added line)
        const infoLines = [wikilinkInfo, suggestInfo].filter(Boolean);
        const preview = formattedContent + (infoLines.length > 0 ? `\n(${infoLines.join('; ')})` : '');

        const result: MutationResult = {
          success: true,
          message: `Added content to section "${sectionBoundary.name}" in ${notePath}`,
          path: notePath,
          preview,
          gitCommit,
          gitError,
        };

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const result: MutationResult = {
          success: false,
          message: `Failed to add content: ${error instanceof Error ? error.message : String(error)}`,
          path: notePath,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    }
  );

  // ========================================
  // Tool: vault_remove_from_section
  // ========================================
  server.tool(
    'vault_remove_from_section',
    'Remove content from a specific section in a markdown note',
    {
      path: z.string().describe('Vault-relative path to the note'),
      section: z.string().describe('Heading text to remove from (e.g., "Log" or "## Log")'),
      pattern: z.string().describe('Text or pattern to match for removal'),
      mode: z.enum(['first', 'last', 'all']).default('first').describe('Which matches to remove'),
      useRegex: z.boolean().default(false).describe('Treat pattern as regex'),
      commit: z.boolean().default(false).describe('If true, commit this change to git (creates undo point)'),
    },
    async ({ path: notePath, section, pattern, mode, useRegex, commit }) => {
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
        const { content: fileContent, frontmatter } = await readVaultFile(vaultPath, notePath);

        // 3. Find the section
        const sectionBoundary = findSection(fileContent, section);
        if (!sectionBoundary) {
          const result: MutationResult = {
            success: false,
            message: `Section not found: ${section}`,
            path: notePath,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 4. Remove matching content
        const removeResult = removeFromSection(
          fileContent,
          sectionBoundary,
          pattern,
          mode as MatchMode,
          useRegex
        );

        if (removeResult.removedCount === 0) {
          const result: MutationResult = {
            success: false,
            message: `No content matching "${pattern}" found in section "${sectionBoundary.name}"`,
            path: notePath,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 5. Write file
        await writeVaultFile(vaultPath, notePath, removeResult.content, frontmatter);

        // 6. Commit if requested
        let gitCommit: string | undefined;
        let gitError: string | undefined;
        if (commit) {
          const gitResult = await commitChange(vaultPath, notePath, '[Crank:Remove]');
          if (gitResult.success) {
            gitCommit = gitResult.hash;
          } else {
            gitError = gitResult.error;
          }
        }

        const result: MutationResult = {
          success: true,
          message: `Removed ${removeResult.removedCount} line(s) from section "${sectionBoundary.name}" in ${notePath}`,
          path: notePath,
          preview: removeResult.removedLines.join('\n'),
          gitCommit,
          gitError,
        };

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const result: MutationResult = {
          success: false,
          message: `Failed to remove content: ${error instanceof Error ? error.message : String(error)}`,
          path: notePath,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    }
  );

  // ========================================
  // Tool: vault_replace_in_section
  // ========================================
  server.tool(
    'vault_replace_in_section',
    'Replace content in a specific section in a markdown note',
    {
      path: z.string().describe('Vault-relative path to the note'),
      section: z.string().describe('Heading text to search in (e.g., "Log" or "## Log")'),
      search: z.string().describe('Text or pattern to search for'),
      replacement: z.string().describe('Text to replace with'),
      mode: z.enum(['first', 'last', 'all']).default('first').describe('Which matches to replace'),
      useRegex: z.boolean().default(false).describe('Treat search as regex'),
      commit: z.boolean().default(false).describe('If true, commit this change to git (creates undo point)'),
      skipWikilinks: z.boolean().default(false).describe('If true, skip auto-wikilink application on replacement text'),
      suggestOutgoingLinks: z.boolean().default(true).describe('Append suggested outgoing wikilinks based on content (e.g., "→ [[AI]] [[Philosophy]]"). Set false to disable.'),
    },
    async ({ path: notePath, section, search, replacement, mode, useRegex, commit, skipWikilinks, suggestOutgoingLinks }) => {
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
        const { content: fileContent, frontmatter } = await readVaultFile(vaultPath, notePath);

        // 3. Find the section
        const sectionBoundary = findSection(fileContent, section);
        if (!sectionBoundary) {
          const result: MutationResult = {
            success: false,
            message: `Section not found: ${section}`,
            path: notePath,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 4. Apply wikilinks to replacement text (unless skipped)
        let { content: processedReplacement, wikilinkInfo } = maybeApplyWikilinks(replacement, skipWikilinks);

        // 4b. Suggest outgoing links (enabled by default)
        let suggestInfo: string | undefined;
        if (suggestOutgoingLinks && !skipWikilinks) {
          const result = suggestRelatedLinks(processedReplacement);
          if (result.suffix) {
            processedReplacement = processedReplacement + ' ' + result.suffix;
            suggestInfo = `Suggested: ${result.suggestions.join(', ')}`;
          }
        }

        // 5. Replace matching content
        const replaceResult = replaceInSection(
          fileContent,
          sectionBoundary,
          search,
          processedReplacement,
          mode as MatchMode,
          useRegex
        );

        if (replaceResult.replacedCount === 0) {
          const result: MutationResult = {
            success: false,
            message: `No content matching "${search}" found in section "${sectionBoundary.name}"`,
            path: notePath,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 5. Write file
        await writeVaultFile(vaultPath, notePath, replaceResult.content, frontmatter);

        // 6. Commit if requested
        let gitCommit: string | undefined;
        let gitError: string | undefined;
        if (commit) {
          const gitResult = await commitChange(vaultPath, notePath, '[Crank:Replace]');
          if (gitResult.success) {
            gitCommit = gitResult.hash;
          } else {
            gitError = gitResult.error;
          }
        }

        // Generate preview showing before/after
        const previewLines = replaceResult.originalLines.map((orig, i) =>
          `- ${orig}\n+ ${replaceResult.newLines[i]}`
        );

        const result: MutationResult = {
          success: true,
          message: `Replaced ${replaceResult.replacedCount} occurrence(s) in section "${sectionBoundary.name}" in ${notePath}`,
          path: notePath,
          preview: previewLines.join('\n'),
          gitCommit,
          gitError,
        };

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const result: MutationResult = {
          success: false,
          message: `Failed to replace content: ${error instanceof Error ? error.message : String(error)}`,
          path: notePath,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    }
  );

  console.error('[Crank] Mutation tools registered (vault_add_to_section, vault_remove_from_section, vault_replace_in_section)');
}
