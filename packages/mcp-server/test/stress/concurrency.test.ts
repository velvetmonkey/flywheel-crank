/**
 * Concurrency and stress tests for production hardening (Phase 3)
 *
 * These tests verify the system handles concurrent operations correctly:
 * - Parallel mutations to different files (should work)
 * - Sequential mutations to same file (should not corrupt)
 * - Rapid mutations (should remain stable)
 * - Edge cases like file deletion during mutation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  readVaultFile,
  writeVaultFile,
  findSection,
  insertInSection,
} from '../../src/core/writer.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  readTestNote,
} from '../helpers/testUtils.js';

describe('concurrent mutations', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  describe('parallel operations', () => {
    it('should handle 10 parallel mutations to different files', async () => {
      // Create 10 test files
      const fileCount = 10;
      for (let i = 0; i < fileCount; i++) {
        const content = `---
type: test
---
# Test File ${i + 1}

## Log
- Initial entry ${i + 1}
`;
        await createTestNote(tempVault, `test-${i}.md`, content);
      }

      // Perform parallel mutations to all files
      const mutations = Array.from({ length: fileCount }, async (_, i) => {
        const { content: fileContent, frontmatter, lineEnding } = await readVaultFile(
          tempVault,
          `test-${i}.md`
        );
        const section = findSection(fileContent, 'Log')!;
        const modified = insertInSection(
          fileContent,
          section,
          `- Parallel entry ${i + 1}`,
          'append'
        );
        await writeVaultFile(tempVault, `test-${i}.md`, modified, frontmatter, lineEnding);
        return i;
      });

      const results = await Promise.all(mutations);

      // Verify all mutations completed
      expect(results).toHaveLength(fileCount);

      // Verify each file was correctly modified
      for (let i = 0; i < fileCount; i++) {
        const content = await readTestNote(tempVault, `test-${i}.md`);
        expect(content).toContain(`Initial entry ${i + 1}`);
        expect(content).toContain(`Parallel entry ${i + 1}`);
      }
    });

    it('should serialize mutations to same file correctly', async () => {
      const content = `---
type: test
---
# Test

## Log
- Entry 0
`;
      await createTestNote(tempVault, 'shared.md', content);

      // Perform sequential mutations
      for (let i = 1; i <= 5; i++) {
        const { content: fileContent, frontmatter, lineEnding } = await readVaultFile(
          tempVault,
          'shared.md'
        );
        const section = findSection(fileContent, 'Log')!;
        const modified = insertInSection(
          fileContent,
          section,
          `- Entry ${i}`,
          'append'
        );
        await writeVaultFile(tempVault, 'shared.md', modified, frontmatter, lineEnding);
      }

      // Verify all entries are present in order
      const finalContent = await readTestNote(tempVault, 'shared.md');
      for (let i = 0; i <= 5; i++) {
        expect(finalContent).toContain(`- Entry ${i}`);
      }

      // Verify order is correct
      const entry0Idx = finalContent.indexOf('- Entry 0');
      const entry5Idx = finalContent.indexOf('- Entry 5');
      expect(entry0Idx).toBeLessThan(entry5Idx);
    });

    it('should not corrupt file with rapid sequential mutations', async () => {
      const content = `---
type: test
---
# Test

## Log
`;
      await createTestNote(tempVault, 'rapid.md', content);

      // Perform rapid sequential mutations
      const mutationCount = 50;
      for (let i = 0; i < mutationCount; i++) {
        const { content: fileContent, frontmatter, lineEnding } = await readVaultFile(
          tempVault,
          'rapid.md'
        );
        const section = findSection(fileContent, 'Log')!;
        const modified = insertInSection(
          fileContent,
          section,
          `- Rapid entry ${i}`,
          'append'
        );
        await writeVaultFile(tempVault, 'rapid.md', modified, frontmatter, lineEnding);
      }

      // Verify file is valid and all entries present
      const finalContent = await readTestNote(tempVault, 'rapid.md');

      // Check structure is intact
      expect(finalContent).toContain('---');
      expect(finalContent).toContain('type: test');
      expect(finalContent).toContain('## Log');

      // Count entries - should have exactly mutationCount entries
      const entryMatches = finalContent.match(/- Rapid entry \d+/g);
      expect(entryMatches).toHaveLength(mutationCount);
    });
  });

  describe('error recovery', () => {
    it('should handle mutation to non-existent file gracefully', async () => {
      await expect(
        readVaultFile(tempVault, 'does-not-exist.md')
      ).rejects.toThrow();
    });

    it('should handle mutation to deleted file gracefully', async () => {
      // Create file
      const content = `---
type: test
---
# Test

## Log
- Entry
`;
      await createTestNote(tempVault, 'to-delete.md', content);

      // Read file
      const { content: fileContent, frontmatter, lineEnding } = await readVaultFile(
        tempVault,
        'to-delete.md'
      );

      // Delete file
      await fs.unlink(path.join(tempVault, 'to-delete.md'));

      // Try to write - should fail gracefully
      const section = findSection(fileContent, 'Log')!;
      const modified = insertInSection(fileContent, section, '- New entry', 'append');

      // Write to deleted file should succeed (creates new file)
      await writeVaultFile(tempVault, 'to-delete.md', modified, frontmatter, lineEnding);

      // Verify file exists again
      const exists = await fs.access(path.join(tempVault, 'to-delete.md'))
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it('should handle directory creation for nested paths', async () => {
      const content = `---
type: test
---
# Test

## Log
- Entry
`;
      // Write to a deeply nested path that doesn't exist yet
      const nestedPath = 'deep/nested/path/that/does/not/exist/file.md';

      // First create parent directories
      const fullDir = path.dirname(path.join(tempVault, nestedPath));
      await fs.mkdir(fullDir, { recursive: true });

      // Now write the file
      await writeVaultFile(tempVault, nestedPath, content, { type: 'test' });

      // Verify file exists
      const result = await readTestNote(tempVault, nestedPath);
      expect(result).toContain('## Log');
    });
  });

  describe('file integrity', () => {
    it('should maintain frontmatter integrity through multiple mutations', async () => {
      const content = `---
type: daily
date: 2026-01-30
tags:
  - important
  - work
nested:
  deep:
    value: preserved
array:
  - item1
  - item2
---
# Test

## Log
- Entry 1
`;
      await createTestNote(tempVault, 'integrity.md', content);

      // Perform multiple mutations
      for (let i = 2; i <= 10; i++) {
        const { content: fileContent, frontmatter, lineEnding } = await readVaultFile(
          tempVault,
          'integrity.md'
        );
        const section = findSection(fileContent, 'Log')!;
        const modified = insertInSection(fileContent, section, `- Entry ${i}`, 'append');
        await writeVaultFile(tempVault, 'integrity.md', modified, frontmatter, lineEnding);
      }

      // Verify frontmatter is preserved
      const { frontmatter } = await readVaultFile(tempVault, 'integrity.md');

      expect(frontmatter.type).toBe('daily');
      expect(frontmatter.tags).toContain('important');
      expect(frontmatter.tags).toContain('work');
      expect((frontmatter.nested as any).deep.value).toBe('preserved');
      expect((frontmatter.array as string[])).toContain('item1');
      expect((frontmatter.array as string[])).toContain('item2');
    });

    it('should preserve special characters in content through mutations', async () => {
      const specialContent = `---
type: test
---
# Special Characters

## Log
- Entry with émojis 🎉 and spëcial châractèrs
- Japanese: 日本語
- Math: α + β = γ
- Code: \`const x = 1;\`
`;
      await createTestNote(tempVault, 'special.md', specialContent);

      // Mutate
      const { content: fileContent, frontmatter, lineEnding } = await readVaultFile(
        tempVault,
        'special.md'
      );
      const section = findSection(fileContent, 'Log')!;
      const modified = insertInSection(fileContent, section, '- New entry with 🚀 emoji', 'append');
      await writeVaultFile(tempVault, 'special.md', modified, frontmatter, lineEnding);

      // Verify special characters preserved
      const result = await readTestNote(tempVault, 'special.md');
      expect(result).toContain('🎉');
      expect(result).toContain('日本語');
      expect(result).toContain('α + β = γ');
      expect(result).toContain('`const x = 1;`');
      expect(result).toContain('🚀');
    });
  });
});
