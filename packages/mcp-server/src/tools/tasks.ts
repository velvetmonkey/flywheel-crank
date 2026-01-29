/**
 * Task tools for Flywheel Crank
 * Tools: vault_toggle_task, vault_add_task
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  readVaultFile,
  writeVaultFile,
  findSection,
  insertInSection,
  type SectionBoundary,
} from '../core/writer.js';
import type { MutationResult, Position } from '../core/types.js';
import { commitChange } from '../core/git.js';
import { maybeApplyWikilinks, suggestRelatedLinks } from '../core/wikilinks.js';
import fs from 'fs/promises';
import path from 'path';

// Task regex patterns
const TASK_REGEX = /^(\s*)-\s*\[([ xX])\]\s*(.*)$/;
const UNCHECKED_TASK = '- [ ]';
const CHECKED_TASK = '- [x]';

export interface TaskInfo {
  line: number;
  text: string;
  completed: boolean;
  indent: string;
  rawLine: string;
}

/**
 * Find all tasks in content, optionally within a section
 */
export function findTasks(content: string, section?: SectionBoundary): TaskInfo[] {
  const lines = content.split('\n');
  const tasks: TaskInfo[] = [];

  const startLine = section?.contentStartLine ?? 0;
  const endLine = section?.endLine ?? lines.length - 1;

  for (let i = startLine; i <= endLine; i++) {
    const line = lines[i];
    const match = line.match(TASK_REGEX);

    if (match) {
      tasks.push({
        line: i,
        text: match[3].trim(),
        completed: match[2].toLowerCase() === 'x',
        indent: match[1],
        rawLine: line,
      });
    }
  }

  return tasks;
}

/**
 * Toggle a task's completion state
 */
export function toggleTask(content: string, lineNumber: number): { content: string; newState: boolean } | null {
  const lines = content.split('\n');

  if (lineNumber < 0 || lineNumber >= lines.length) {
    return null;
  }

  const line = lines[lineNumber];
  const match = line.match(TASK_REGEX);

  if (!match) {
    return null;
  }

  const wasCompleted = match[2].toLowerCase() === 'x';
  const newState = !wasCompleted;

  // Toggle the checkbox
  if (wasCompleted) {
    lines[lineNumber] = line.replace(/\[[ xX]\]/, '[ ]');
  } else {
    lines[lineNumber] = line.replace(/\[[ xX]\]/, '[x]');
  }

  return {
    content: lines.join('\n'),
    newState,
  };
}

export function registerTaskTools(
  server: McpServer,
  vaultPath: string
): void {
  // ========================================
  // Tool: vault_toggle_task
  // ========================================
  server.tool(
    'vault_toggle_task',
    'Toggle a task checkbox between checked and unchecked',
    {
      path: z.string().describe('Vault-relative path to the note'),
      task: z.string().describe('Task text to find (partial match supported)'),
      section: z.string().optional().describe('Optional: limit search to this section'),
      commit: z.boolean().default(false).describe('If true, commit this change to git (creates undo point)'),
    },
    async ({ path: notePath, task, section, commit }) => {
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

        // 2. Read file
        const { content: fileContent, frontmatter } = await readVaultFile(vaultPath, notePath);

        // 3. Find section if specified
        let sectionBoundary: SectionBoundary | undefined;
        if (section) {
          const found = findSection(fileContent, section);
          if (!found) {
            const result: MutationResult = {
              success: false,
              message: `Section not found: ${section}`,
              path: notePath,
            };
            return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
          }
          sectionBoundary = found;
        }

        // 4. Find tasks
        const tasks = findTasks(fileContent, sectionBoundary);

        // 5. Find matching task (case-insensitive partial match)
        const searchLower = task.toLowerCase();
        const matchingTask = tasks.find((t) =>
          t.text.toLowerCase().includes(searchLower)
        );

        if (!matchingTask) {
          const result: MutationResult = {
            success: false,
            message: `No task found matching "${task}"${section ? ` in section "${section}"` : ''}`,
            path: notePath,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 6. Toggle the task
        const toggleResult = toggleTask(fileContent, matchingTask.line);
        if (!toggleResult) {
          const result: MutationResult = {
            success: false,
            message: 'Failed to toggle task',
            path: notePath,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 7. Write file
        await writeVaultFile(vaultPath, notePath, toggleResult.content, frontmatter);

        // 8. Commit if requested
        let gitCommit: string | undefined;
        let gitError: string | undefined;
        if (commit) {
          const gitResult = await commitChange(vaultPath, notePath, '[Crank:Task]');
          if (gitResult.success) {
            gitCommit = gitResult.hash;
          } else {
            gitError = gitResult.error;
          }
        }

        const newStatus = toggleResult.newState ? 'completed' : 'incomplete';
        const checkbox = toggleResult.newState ? '[x]' : '[ ]';

        const result: MutationResult = {
          success: true,
          message: `Toggled task to ${newStatus} in ${notePath}`,
          path: notePath,
          preview: `${checkbox} ${matchingTask.text}`,
          gitCommit,
          gitError,
        };

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const result: MutationResult = {
          success: false,
          message: `Failed to toggle task: ${error instanceof Error ? error.message : String(error)}`,
          path: notePath,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    }
  );

  // ========================================
  // Tool: vault_add_task
  // ========================================
  server.tool(
    'vault_add_task',
    'Add a new task to a section in a markdown note',
    {
      path: z.string().describe('Vault-relative path to the note'),
      section: z.string().describe('Section to add the task to'),
      task: z.string().describe('Task text (without checkbox)'),
      position: z.enum(['append', 'prepend']).default('append').describe('Where to add the task'),
      completed: z.boolean().default(false).describe('Whether the task should start as completed'),
      commit: z.boolean().default(false).describe('If true, commit this change to git (creates undo point)'),
      skipWikilinks: z.boolean().default(false).describe('If true, skip auto-wikilink application (wikilinks are applied by default)'),
      suggestOutgoingLinks: z.boolean().default(true).describe('Append suggested outgoing wikilinks based on content (e.g., "→ [[AI]] [[Philosophy]]"). Set false to disable.'),
    },
    async ({ path: notePath, section, task, position, completed, commit, skipWikilinks, suggestOutgoingLinks }) => {
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

        // 2. Read file
        const { content: fileContent, frontmatter } = await readVaultFile(vaultPath, notePath);

        // 3. Find section
        const sectionBoundary = findSection(fileContent, section);
        if (!sectionBoundary) {
          const result: MutationResult = {
            success: false,
            message: `Section not found: ${section}`,
            path: notePath,
          };
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }

        // 4. Apply wikilinks to task text (unless skipped)
        let { content: processedTask, wikilinkInfo } = maybeApplyWikilinks(task.trim(), skipWikilinks);

        // 4b. Suggest outgoing links (enabled by default)
        let suggestInfo: string | undefined;
        if (suggestOutgoingLinks && !skipWikilinks) {
          const result = suggestRelatedLinks(processedTask);
          if (result.suffix) {
            processedTask = processedTask + ' ' + result.suffix;
            suggestInfo = `Suggested: ${result.suggestions.join(', ')}`;
          }
        }

        // 5. Format the task
        const checkbox = completed ? '[x]' : '[ ]';
        const taskLine = `- ${checkbox} ${processedTask}`;

        // 6. Insert into section
        const updatedContent = insertInSection(
          fileContent,
          sectionBoundary,
          taskLine,
          position as Position
        );

        // 7. Write file
        await writeVaultFile(vaultPath, notePath, updatedContent, frontmatter);

        // 8. Commit if requested
        let gitCommit: string | undefined;
        let gitError: string | undefined;
        if (commit) {
          const gitResult = await commitChange(vaultPath, notePath, '[Crank:Task]');
          if (gitResult.success) {
            gitCommit = gitResult.hash;
          } else {
            gitError = gitResult.error;
          }
        }

        const infoLines = [wikilinkInfo, suggestInfo].filter(Boolean);
        const result: MutationResult = {
          success: true,
          message: `Added task to section "${sectionBoundary.name}" in ${notePath}`,
          path: notePath,
          preview: taskLine + (infoLines.length > 0 ? `\n(${infoLines.join('; ')})` : ''),
          gitCommit,
          gitError,
        };

        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        const result: MutationResult = {
          success: false,
          message: `Failed to add task: ${error instanceof Error ? error.message : String(error)}`,
          path: notePath,
        };
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    }
  );

  console.error('[Crank] Task tools registered (vault_toggle_task, vault_add_task)');
}
