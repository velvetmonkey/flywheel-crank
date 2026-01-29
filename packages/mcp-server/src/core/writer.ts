/**
 * Core utilities for vault file operations
 */

import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import { HEADING_REGEX } from './constants.js';
import type { FormatType, Position } from './types.js';

/**
 * Patterns for detecting empty placeholder lines in templates
 * These are format lines that should be replaced rather than appended after
 */
const EMPTY_PLACEHOLDER_PATTERNS = [
  /^\d+\.\s*$/,           // "1. " or "2. " (numbered list placeholder)
  /^-\s*$/,               // "- " (bullet placeholder)
  /^-\s*\[\s*\]\s*$/,     // "- [ ] " (empty task placeholder)
  /^-\s*\[x\]\s*$/i,      // "- [x] " (completed task placeholder)
  /^\*\s*$/,              // "* " (asterisk bullet placeholder)
];

/**
 * Check if a line is an empty format placeholder that should be replaced
 */
export function isEmptyPlaceholder(line: string): boolean {
  const trimmed = line.trim();
  return EMPTY_PLACEHOLDER_PATTERNS.some(p => p.test(trimmed));
}

export interface Heading {
  level: number;
  text: string;
  line: number;
}

export interface SectionBoundary {
  name: string;
  level: number;
  startLine: number;
  endLine: number;
  contentStartLine: number;
}

/**
 * Extract all headings from markdown content
 */
export function extractHeadings(content: string): Heading[] {
  const lines = content.split('\n');
  const headings: Heading[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track code block boundaries
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    // Skip lines inside code blocks
    if (inCodeBlock) continue;

    // Match heading pattern
    const match = line.match(HEADING_REGEX);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        line: i,
      });
    }
  }

  return headings;
}

/**
 * Find section boundaries by heading name (case-insensitive)
 * Section ends at the next heading of equal or higher level
 */
export function findSection(content: string, sectionName: string): SectionBoundary | null {
  const headings = extractHeadings(content);
  const lines = content.split('\n');

  // Normalize section name (remove # prefix if present)
  const normalizedSearch = sectionName.replace(/^#+\s*/, '').trim().toLowerCase();

  // Find the target heading
  const headingIndex = headings.findIndex(
    (h) => h.text.toLowerCase() === normalizedSearch
  );

  if (headingIndex === -1) return null;

  const targetHeading = headings[headingIndex];
  const startLine = targetHeading.line;
  const contentStartLine = startLine + 1;

  // Find where section ends (next heading of same or higher level)
  let endLine = lines.length - 1;
  for (let i = headingIndex + 1; i < headings.length; i++) {
    if (headings[i].level <= targetHeading.level) {
      endLine = headings[i].line - 1;
      break;
    }
  }

  return {
    name: targetHeading.text,
    level: targetHeading.level,
    startLine,
    endLine,
    contentStartLine,
  };
}

/**
 * Format content according to format type
 */
export function formatContent(content: string, format: FormatType): string {
  const trimmed = content.trim();

  switch (format) {
    case 'plain':
      return trimmed;
    case 'bullet':
      return `- ${trimmed}`;
    case 'task':
      return `- [ ] ${trimmed}`;
    case 'numbered':
      return `1. ${trimmed}`;
    case 'timestamp-bullet': {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      return `- **${hours}:${minutes}** ${trimmed}`;
    }
    default:
      return trimmed;
  }
}

/**
 * Insert content into a section at the specified position
 *
 * Smart template handling: When appending, if the last content line is an
 * empty placeholder (like "1. " or "- "), replace it instead of appending after.
 */
export function insertInSection(
  content: string,
  section: SectionBoundary,
  newContent: string,
  position: Position
): string {
  const lines = content.split('\n');
  const formattedContent = newContent.trim();

  if (position === 'prepend') {
    // Insert right after the heading
    lines.splice(section.contentStartLine, 0, formattedContent);
  } else {
    // Append at end of section
    // First, check if the last non-empty line in the section is a placeholder
    let lastContentLineIdx = -1;
    for (let i = section.endLine; i >= section.contentStartLine; i--) {
      if (lines[i].trim() !== '') {
        lastContentLineIdx = i;
        break;
      }
    }

    // Check if last content line is an empty placeholder to replace
    if (lastContentLineIdx >= section.contentStartLine && isEmptyPlaceholder(lines[lastContentLineIdx])) {
      // Replace the placeholder with the new content
      lines[lastContentLineIdx] = formattedContent;
    } else {
      // Normal append behavior
      let insertLine = section.endLine + 1;

      // If section has content, add after it
      if (section.contentStartLine <= section.endLine) {
        insertLine = section.endLine + 1;
      } else {
        // Empty section, add right after heading
        insertLine = section.contentStartLine;
      }

      lines.splice(insertLine, 0, formattedContent);
    }
  }

  return lines.join('\n');
}

/**
 * Validate path to prevent traversal attacks
 */
export function validatePath(vaultPath: string, notePath: string): boolean {
  const resolvedVault = path.resolve(vaultPath);
  const resolvedNote = path.resolve(vaultPath, notePath);

  // Ensure the resolved note path is within the vault
  return resolvedNote.startsWith(resolvedVault);
}

/**
 * Read a vault file with frontmatter parsing
 */
export async function readVaultFile(
  vaultPath: string,
  notePath: string
): Promise<{
  content: string;
  frontmatter: Record<string, unknown>;
  rawContent: string;
}> {
  if (!validatePath(vaultPath, notePath)) {
    throw new Error('Invalid path: path traversal not allowed');
  }

  const fullPath = path.join(vaultPath, notePath);
  const rawContent = await fs.readFile(fullPath, 'utf-8');

  const parsed = matter(rawContent);

  return {
    content: parsed.content,
    frontmatter: parsed.data as Record<string, unknown>,
    rawContent,
  };
}

/**
 * Write a vault file, preserving frontmatter
 */
export async function writeVaultFile(
  vaultPath: string,
  notePath: string,
  content: string,
  frontmatter: Record<string, unknown>
): Promise<void> {
  if (!validatePath(vaultPath, notePath)) {
    throw new Error('Invalid path: path traversal not allowed');
  }

  const fullPath = path.join(vaultPath, notePath);

  // Stringify with gray-matter
  const output = matter.stringify(content, frontmatter);

  await fs.writeFile(fullPath, output, 'utf-8');
}

export type MatchMode = 'first' | 'last' | 'all';

export interface RemoveResult {
  content: string;
  removedCount: number;
  removedLines: string[];
}

/**
 * Remove content from a section matching a pattern
 */
export function removeFromSection(
  content: string,
  section: SectionBoundary,
  pattern: string,
  mode: MatchMode = 'first',
  useRegex: boolean = false
): RemoveResult {
  const lines = content.split('\n');
  const removedLines: string[] = [];
  const indicesToRemove: number[] = [];

  // Search within section bounds
  for (let i = section.contentStartLine; i <= section.endLine; i++) {
    const line = lines[i];
    let matches = false;

    if (useRegex) {
      const regex = new RegExp(pattern);
      matches = regex.test(line);
    } else {
      // Exact substring match (case-sensitive)
      matches = line.includes(pattern);
    }

    if (matches) {
      indicesToRemove.push(i);
      removedLines.push(line);

      if (mode === 'first') break;
    }
  }

  // If mode is 'last', only keep the last match
  if (mode === 'last' && indicesToRemove.length > 1) {
    const lastIndex = indicesToRemove[indicesToRemove.length - 1];
    const lastLine = removedLines[removedLines.length - 1];
    indicesToRemove.length = 0;
    removedLines.length = 0;
    indicesToRemove.push(lastIndex);
    removedLines.push(lastLine);
  }

  // Remove lines in reverse order to maintain correct indices
  const sortedIndices = [...indicesToRemove].sort((a, b) => b - a);
  for (const idx of sortedIndices) {
    lines.splice(idx, 1);
  }

  return {
    content: lines.join('\n'),
    removedCount: indicesToRemove.length,
    removedLines,
  };
}

export interface ReplaceResult {
  content: string;
  replacedCount: number;
  originalLines: string[];
  newLines: string[];
}

/**
 * Replace content in a section matching a pattern
 */
export function replaceInSection(
  content: string,
  section: SectionBoundary,
  search: string,
  replacement: string,
  mode: MatchMode = 'first',
  useRegex: boolean = false
): ReplaceResult {
  const lines = content.split('\n');
  const originalLines: string[] = [];
  const newLines: string[] = [];
  const indicesToReplace: number[] = [];

  // Find matching lines within section bounds
  for (let i = section.contentStartLine; i <= section.endLine; i++) {
    const line = lines[i];
    let matches = false;

    if (useRegex) {
      const regex = new RegExp(search);
      matches = regex.test(line);
    } else {
      matches = line.includes(search);
    }

    if (matches) {
      indicesToReplace.push(i);
      originalLines.push(line);

      if (mode === 'first') break;
    }
  }

  // If mode is 'last', only keep the last match
  if (mode === 'last' && indicesToReplace.length > 1) {
    const lastIndex = indicesToReplace[indicesToReplace.length - 1];
    const lastLine = originalLines[originalLines.length - 1];
    indicesToReplace.length = 0;
    originalLines.length = 0;
    indicesToReplace.push(lastIndex);
    originalLines.push(lastLine);
  }

  // Perform replacements
  for (const idx of indicesToReplace) {
    const originalLine = lines[idx];
    let newLine: string;

    if (useRegex) {
      const regex = new RegExp(search, 'g');
      newLine = originalLine.replace(regex, replacement);
    } else {
      newLine = originalLine.split(search).join(replacement);
    }

    lines[idx] = newLine;
    newLines.push(newLine);
  }

  return {
    content: lines.join('\n'),
    replacedCount: indicesToReplace.length,
    originalLines,
    newLines,
  };
}
