/**
 * Integration tests for system tools
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  readVaultFile,
  extractHeadings,
  validatePath,
} from '../../src/core/writer.js';
import {
  isGitRepo,
  getLastCommit,
  undoLastCommit,
  commitChange,
} from '../../src/core/git.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
} from '../helpers/testUtils.js';
import { simpleGit } from 'simple-git';
import path from 'path';

/**
 * Helper to simulate vault_list_sections workflow
 */
async function listSections(
  vaultPath: string,
  notePath: string,
  minLevel: number = 1,
  maxLevel: number = 6
): Promise<{
  success: boolean;
  message: string;
  sections?: Array<{ level: number; name: string; line: number }>;
}> {
  try {
    if (!validatePath(vaultPath, notePath)) {
      return {
        success: false,
        message: 'Invalid path: path traversal not allowed',
      };
    }

    const { content: fileContent } = await readVaultFile(vaultPath, notePath);
    const headings = extractHeadings(fileContent);

    const filteredHeadings = headings.filter(
      (h) => h.level >= minLevel && h.level <= maxLevel
    );

    const sections = filteredHeadings.map((h) => ({
      level: h.level,
      name: h.text,
      line: h.line + 1, // 1-indexed
    }));

    return {
      success: true,
      message: `Found ${sections.length} section(s)`,
      sections,
    };
  } catch (error) {
    return {
      success: false,
      message: `Failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

describe('vault_list_sections integration workflow', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should list all sections in a note', async () => {
    const note = `---
type: test
---
# Main Title

## Section A

Content A

## Section B

Content B

### Subsection B1

Content B1
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await listSections(tempVault, 'test.md');

    expect(result.success).toBe(true);
    expect(result.sections?.length).toBe(4);
    // Line numbers are 1-indexed and relative to content (after frontmatter)
    expect(result.sections?.[0]).toEqual({ level: 1, name: 'Main Title', line: 1 });
    expect(result.sections?.[1]).toEqual({ level: 2, name: 'Section A', line: 3 });
    expect(result.sections?.[2]).toEqual({ level: 2, name: 'Section B', line: 7 });
    expect(result.sections?.[3]).toEqual({ level: 3, name: 'Subsection B1', line: 11 });
  });

  it('should filter sections by level', async () => {
    const note = `---
type: test
---
# H1

## H2

### H3

#### H4
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await listSections(tempVault, 'test.md', 2, 3);

    expect(result.success).toBe(true);
    expect(result.sections?.length).toBe(2);
    expect(result.sections?.[0].name).toBe('H2');
    expect(result.sections?.[1].name).toBe('H3');
  });

  it('should return empty array for file with no headings', async () => {
    const note = `---
type: test
---
Just some content without any headings.

More content here.
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await listSections(tempVault, 'test.md');

    expect(result.success).toBe(true);
    expect(result.sections?.length).toBe(0);
  });

  it('should ignore headings inside code blocks', async () => {
    const note = `---
type: test
---
# Real Heading

\`\`\`markdown
# Fake Heading in Code
\`\`\`

## Another Real Heading
`;
    await createTestNote(tempVault, 'test.md', note);

    const result = await listSections(tempVault, 'test.md');

    expect(result.success).toBe(true);
    expect(result.sections?.length).toBe(2);
    expect(result.sections?.[0].name).toBe('Real Heading');
    expect(result.sections?.[1].name).toBe('Another Real Heading');
  });

  it('should return error for non-existent file', async () => {
    const result = await listSections(tempVault, 'nonexistent.md');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Failed');
  });

  it('should return error for path traversal', async () => {
    const result = await listSections(tempVault, '../../../etc/passwd');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid path');
  });
});

describe('vault_undo_last_mutation integration workflow', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
    // Initialize git repo
    const git = simpleGit(tempVault);
    await git.init();
    await git.addConfig('user.email', 'test@test.com');
    await git.addConfig('user.name', 'Test User');
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should undo the last commit', async () => {
    // Create a note and commit it
    await createTestNote(tempVault, 'test.md', '# Test\n\nOriginal content');
    await commitChange(tempVault, 'test.md', '[Crank]');

    // Make a change and commit it
    await createTestNote(tempVault, 'test.md', '# Test\n\nModified content');
    await commitChange(tempVault, 'test.md', '[Crank]');

    // Get the commit we're about to undo
    const beforeUndo = await getLastCommit(tempVault);
    expect(beforeUndo?.message).toContain('test.md');

    // Undo
    const result = await undoLastCommit(tempVault);

    expect(result.success).toBe(true);
    expect(result.undoneCommit?.hash).toBe(beforeUndo?.hash);

    // Verify we're now back to the previous commit
    const afterUndo = await getLastCommit(tempVault);
    expect(afterUndo?.hash).not.toBe(beforeUndo?.hash);
  });

  it('should return error when no commits exist', async () => {
    // Empty git repo with no commits
    const result = await undoLastCommit(tempVault);

    expect(result.success).toBe(false);
    expect(result.message).toContain('No commits');
  });

  it('should return error for non-git directory', async () => {
    // Create a new temp vault without git
    const nonGitVault = await createTempVault();

    const result = await undoLastCommit(nonGitVault);

    expect(result.success).toBe(false);
    expect(result.message).toContain('Not a git repository');

    await cleanupTempVault(nonGitVault);
  });

  it('getLastCommit should return null for non-git directory', async () => {
    const nonGitVault = await createTempVault();

    const result = await getLastCommit(nonGitVault);

    expect(result).toBeNull();

    await cleanupTempVault(nonGitVault);
  });

  it('getLastCommit should return commit info', async () => {
    await createTestNote(tempVault, 'test.md', '# Test');
    await commitChange(tempVault, 'test.md', '[Crank]');

    const result = await getLastCommit(tempVault);

    expect(result).not.toBeNull();
    expect(result?.hash).toBeDefined();
    expect(result?.message).toContain('test.md');
    expect(result?.author).toBe('Test User');
  });

  it('isGitRepo should return true for git directory', async () => {
    const result = await isGitRepo(tempVault);
    expect(result).toBe(true);
  });

  it('isGitRepo should return false for non-git directory', async () => {
    const nonGitVault = await createTempVault();

    const result = await isGitRepo(nonGitVault);
    expect(result).toBe(false);

    await cleanupTempVault(nonGitVault);
  });
});
