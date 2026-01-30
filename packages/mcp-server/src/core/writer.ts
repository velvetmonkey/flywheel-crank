/**
 * Core utilities for vault file operations
 */

import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter';
import { HEADING_REGEX } from './constants.js';
import type { FormatType, Position, InsertionOptions } from './types.js';

/**
 * Sensitive file patterns that should never be written via vault mutations.
 * These patterns protect credentials, secrets, and system configuration.
 */
const SENSITIVE_PATH_PATTERNS: RegExp[] = [
  /\.env($|\..*)/i,              // .env, .env.local, .env.production, etc.
  /\.git\/config$/i,             // Git config (may contain tokens)
  /\.git\/credentials$/i,        // Git credentials
  /\.pem$/i,                     // SSL/TLS certificates
  /\.key$/i,                     // Private keys
  /\.p12$/i,                     // PKCS#12 certificates
  /\.pfx$/i,                     // Windows certificate format
  /\.jks$/i,                     // Java keystore
  /id_rsa/i,                     // SSH private key
  /id_ed25519/i,                 // SSH private key (ed25519)
  /id_ecdsa/i,                   // SSH private key (ecdsa)
  /credentials\.json$/i,         // Cloud credentials files
  /secrets\.json$/i,             // Secrets files
  /secrets\.ya?ml$/i,            // Secrets YAML files
  /\.htpasswd$/i,                // Apache password file
  /shadow$/,                     // Unix shadow password file
  /passwd$/,                     // Unix password file
];

/**
 * Result of secure path validation
 */
export interface PathValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Check if a path matches any sensitive file pattern
 */
export function isSensitivePath(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return SENSITIVE_PATH_PATTERNS.some(pattern => pattern.test(normalizedPath));
}

/**
 * Line ending types
 */
export type LineEnding = 'LF' | 'CRLF';

/**
 * Detect the line ending style used in content.
 * Returns 'CRLF' if Windows-style line endings are detected, 'LF' otherwise.
 */
export function detectLineEnding(content: string): LineEnding {
  // Count occurrences of each line ending type
  const crlfCount = (content.match(/\r\n/g) || []).length;
  const lfCount = (content.match(/(?<!\r)\n/g) || []).length;

  // If CRLF appears more frequently, treat as Windows file
  return crlfCount > lfCount ? 'CRLF' : 'LF';
}

/**
 * Normalize line endings to LF for internal processing.
 */
export function normalizeLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

/**
 * Convert line endings to the specified style.
 */
export function convertLineEndings(content: string, style: LineEnding): string {
  // First normalize to LF, then convert if needed
  const normalized = content.replace(/\r\n/g, '\n');
  return style === 'CRLF' ? normalized.replace(/\n/g, '\r\n') : normalized;
}

/**
 * Ensure content ends with exactly one newline.
 */
export function normalizeTrailingNewline(content: string): string {
  // Remove all trailing whitespace/newlines, then add exactly one
  return content.replace(/[\r\n\s]+$/, '') + '\n';
}

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
 * Detect the base indentation level for a section.
 * Returns the indentation string (spaces) of the first list item in the section,
 * which represents the "top level" for that section.
 *
 * This should be used when appending new entries to ensure they're added at
 * the section's base level, not nested inside existing sublists.
 */
export function detectSectionBaseIndentation(
  lines: string[],
  sectionStartLine: number,
  sectionEndLine: number
): string {
  // Look forward to find the first list item in the section
  for (let i = sectionStartLine; i <= sectionEndLine; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (trimmed === '') continue;

    // Check if this is a list item (bullet, numbered, or task)
    const listMatch = line.match(/^(\s*)[-*+]\s|^(\s*)\d+\.\s|^(\s*)[-*+]\s*\[[ xX]\]/);
    if (listMatch) {
      // Found the first list item - return its indentation as the base
      const indent = listMatch[1] || listMatch[2] || listMatch[3] || '';
      return indent;
    }

    // If we hit a heading (not the section heading itself), stop searching
    if (i > sectionStartLine && trimmed.match(/^#+\s/)) {
      break;
    }
  }

  return ''; // No list context found, use no indentation
}

/**
 * Detect the indentation level of the list context at a given line.
 * Returns the indentation string (spaces) that should be used for content
 * being inserted at this position to match the surrounding list structure.
 *
 * Walks backward from the insertion point to find the most recent list item,
 * then determines if we're inserting at the same level or nested.
 *
 * NOTE: This function is suitable for continuing a nested list. For adding
 * new top-level entries to a section, use detectSectionBaseIndentation instead.
 */
export function detectListIndentation(
  lines: string[],
  insertLineIndex: number,
  sectionStartLine: number
): string {
  // Walk backward to find the most recent list item
  for (let i = insertLineIndex - 1; i >= sectionStartLine; i--) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines
    if (trimmed === '') continue;

    // Check if this is a list item (bullet, numbered, or task)
    const listMatch = line.match(/^(\s*)[-*+]\s|^(\s*)\d+\.\s|^(\s*)[-*+]\s*\[[ xX]\]/);
    if (listMatch) {
      // Found a list item - return its indentation
      // This ensures new content starts at the same level as existing list items
      const indent = listMatch[1] || listMatch[2] || listMatch[3] || '';
      return indent;
    }

    // If we hit a heading, stop searching
    if (trimmed.match(/^#+\s/)) {
      break;
    }

    // If we hit non-list content (like indented text under a list item),
    // continue searching backward for the parent list item
  }

  return ''; // No list context found, use no indentation
}

/**
 * Insert content into a section at the specified position
 *
 * Smart template handling: When appending, if the last content line is an
 * empty placeholder (like "1. " or "- "), replace it instead of appending after.
 *
 * When preserveListNesting is true, the function will detect the indentation
 * level of the surrounding list and apply it to the inserted content.
 */
export function insertInSection(
  content: string,
  section: SectionBoundary,
  newContent: string,
  position: Position,
  options?: InsertionOptions
): string {
  const lines = content.split('\n');
  const formattedContent = newContent.trim();

  if (position === 'prepend') {
    // Insert right after the heading
    // If preserveListNesting is enabled, detect indentation from the first list item in the section
    if (options?.preserveListNesting) {
      // Look forward to find the first list item in the section
      let indent = '';
      for (let i = section.contentStartLine; i <= section.endLine; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed === '') continue;

        // Check if this is a list item (bullet, numbered, or task)
        const listMatch = line.match(/^(\s*)[-*+]\s|^(\s*)\d+\.\s|^(\s*)[-*+]\s*\[[ xX]\]/);
        if (listMatch) {
          indent = listMatch[1] || listMatch[2] || listMatch[3] || '';
          break;
        }
        // If we hit non-list content, stop searching
        break;
      }

      if (indent) {
        const indentedContent = formattedContent
          .split('\n')
          .map(line => indent + line)
          .join('\n');
        lines.splice(section.contentStartLine, 0, indentedContent);
      } else {
        lines.splice(section.contentStartLine, 0, formattedContent);
      }
    } else {
      lines.splice(section.contentStartLine, 0, formattedContent);
    }
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
      // Apply section base indentation if preserveListNesting is enabled
      if (options?.preserveListNesting) {
        const indent = detectSectionBaseIndentation(lines, section.contentStartLine, section.endLine);
        const indentedContent = formattedContent
          .split('\n')
          .map(line => indent + line)
          .join('\n');
        lines[lastContentLineIdx] = indentedContent;
      } else {
        lines[lastContentLineIdx] = formattedContent;
      }
    } else {
      // Normal append behavior - insert after last non-blank line to avoid
      // accumulating blank lines between entries
      let insertLine: number;

      if (lastContentLineIdx >= section.contentStartLine) {
        // Remove any trailing blank lines within the section before inserting
        // This prevents blank lines from accumulating between entries across
        // read/write cycles (e.g., with gray-matter)
        for (let i = section.endLine; i > lastContentLineIdx; i--) {
          if (lines[i].trim() === '') {
            lines.splice(i, 1);
          }
        }
        // Insert right after the last non-blank content line
        insertLine = lastContentLineIdx + 1;
      } else {
        // Empty section (no non-blank content), add right after heading
        insertLine = section.contentStartLine;
      }

      // Apply section base indentation if preserveListNesting is enabled
      // Use section base (first list item) to add new top-level entries,
      // not the last item's indentation which could be nested
      if (options?.preserveListNesting) {
        const indent = detectSectionBaseIndentation(lines, section.contentStartLine, section.endLine);
        const indentedContent = formattedContent
          .split('\n')
          .map(line => indent + line)
          .join('\n');
        lines.splice(insertLine, 0, indentedContent);
      } else {
        lines.splice(insertLine, 0, formattedContent);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Validate path to prevent traversal attacks (sync version for reads)
 */
export function validatePath(vaultPath: string, notePath: string): boolean {
  const resolvedVault = path.resolve(vaultPath);
  const resolvedNote = path.resolve(vaultPath, notePath);

  // Ensure the resolved note path is within the vault
  return resolvedNote.startsWith(resolvedVault);
}

/**
 * Securely validate path for write operations.
 *
 * This async version:
 * 1. Follows symlinks using fs.realpath() to detect symlink escapes
 * 2. Verifies the resolved path is still within the vault
 * 3. Checks against sensitive file patterns
 *
 * Use this for ALL write operations to prevent:
 * - Symlink attacks (symlink pointing outside vault)
 * - Path traversal attacks (../)
 * - Accidental credential exposure (.env, .pem, etc.)
 */
export async function validatePathSecure(
  vaultPath: string,
  notePath: string
): Promise<PathValidationResult> {
  // First, do the basic path traversal check
  const resolvedVault = path.resolve(vaultPath);
  const resolvedNote = path.resolve(vaultPath, notePath);

  if (!resolvedNote.startsWith(resolvedVault)) {
    return {
      valid: false,
      reason: 'Path traversal not allowed',
    };
  }

  // Check for sensitive file patterns
  if (isSensitivePath(notePath)) {
    return {
      valid: false,
      reason: 'Cannot write to sensitive file (credentials, keys, secrets)',
    };
  }

  // For files that exist, resolve symlinks and verify still in vault
  try {
    // Check if path exists (might be a symlink or regular file)
    const fullPath = path.join(vaultPath, notePath);

    try {
      await fs.access(fullPath);

      // File exists - resolve any symlinks
      const realPath = await fs.realpath(fullPath);
      const realVaultPath = await fs.realpath(vaultPath);

      if (!realPath.startsWith(realVaultPath)) {
        return {
          valid: false,
          reason: 'Symlink target is outside vault',
        };
      }

      // Also check if the resolved path is a sensitive file
      const relativePath = path.relative(realVaultPath, realPath);
      if (isSensitivePath(relativePath)) {
        return {
          valid: false,
          reason: 'Symlink target is a sensitive file',
        };
      }
    } catch {
      // File doesn't exist yet - check parent directory for symlink escape
      const parentDir = path.dirname(fullPath);
      try {
        await fs.access(parentDir);
        const realParentPath = await fs.realpath(parentDir);
        const realVaultPath = await fs.realpath(vaultPath);

        if (!realParentPath.startsWith(realVaultPath)) {
          return {
            valid: false,
            reason: 'Parent directory symlink target is outside vault',
          };
        }
      } catch {
        // Parent directory doesn't exist - that's fine, will be created
        // Just ensure the path we're creating is within vault boundaries
      }
    }
  } catch (error) {
    // This shouldn't happen given our earlier checks, but handle gracefully
    return {
      valid: false,
      reason: `Path validation error: ${(error as Error).message}`,
    };
  }

  return { valid: true };
}

/**
 * Read a vault file with frontmatter parsing.
 *
 * Returns:
 * - content: The file content (after frontmatter), normalized to LF
 * - frontmatter: Parsed YAML frontmatter
 * - rawContent: The original raw content
 * - lineEnding: The detected line ending style (LF or CRLF)
 */
export async function readVaultFile(
  vaultPath: string,
  notePath: string
): Promise<{
  content: string;
  frontmatter: Record<string, unknown>;
  rawContent: string;
  lineEnding: LineEnding;
}> {
  if (!validatePath(vaultPath, notePath)) {
    throw new Error('Invalid path: path traversal not allowed');
  }

  const fullPath = path.join(vaultPath, notePath);
  const rawContent = await fs.readFile(fullPath, 'utf-8');

  // Detect line ending before parsing
  const lineEnding = detectLineEnding(rawContent);

  // Normalize to LF for internal processing
  const normalizedContent = normalizeLineEndings(rawContent);

  const parsed = matter(normalizedContent);

  return {
    content: parsed.content,
    frontmatter: parsed.data as Record<string, unknown>,
    rawContent,
    lineEnding,
  };
}

/**
 * Write a vault file, preserving frontmatter and line endings.
 *
 * Uses validatePathSecure() to:
 * - Follow symlinks and ensure target is within vault
 * - Block writes to sensitive files (.env, .pem, etc.)
 *
 * @param lineEnding - Optional line ending style to use. If not provided, uses LF.
 */
export async function writeVaultFile(
  vaultPath: string,
  notePath: string,
  content: string,
  frontmatter: Record<string, unknown>,
  lineEnding: LineEnding = 'LF'
): Promise<void> {
  // Use secure validation for writes (follows symlinks, checks sensitive paths)
  const validation = await validatePathSecure(vaultPath, notePath);
  if (!validation.valid) {
    throw new Error(`Invalid path: ${validation.reason}`);
  }

  const fullPath = path.join(vaultPath, notePath);

  // Stringify with gray-matter
  let output = matter.stringify(content, frontmatter);

  // Normalize trailing newline (exactly one)
  output = normalizeTrailingNewline(output);

  // Convert to target line ending style
  output = convertLineEndings(output, lineEnding);

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
