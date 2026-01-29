/**
 * Golden file tests for format preservation
 *
 * These tests verify that mutations preserve file formatting:
 * - Bullet styles (-, *, +)
 * - Checkbox formats ([ ], [x], [X])
 * - Frontmatter structure
 * - Line ending style (LF vs CRLF)
 * - Trailing newlines
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  readVaultFile,
  writeVaultFile,
  findSection,
  insertInSection,
  detectLineEnding,
  convertLineEndings,
  normalizeLineEndings,
  normalizeTrailingNewline,
} from '../../src/core/writer.js';
import { createTempVault, cleanupTempVault } from '../helpers/testUtils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT_DIR = path.join(__dirname, 'input');
const EXPECTED_DIR = path.join(__dirname, 'expected');

/**
 * Read a golden file
 */
async function readGoldenFile(dir: string, filename: string): Promise<string> {
  return await fs.readFile(path.join(dir, filename), 'utf-8');
}

describe('Golden File Tests', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  describe('Bullet style preservation', () => {
    it('should append to dash-style bullet list', async () => {
      const input = await readGoldenFile(INPUT_DIR, 'bullets.md');
      const expected = await readGoldenFile(EXPECTED_DIR, 'bullets.add-append.md');

      // Write input to temp vault
      await fs.writeFile(path.join(tempVault, 'test.md'), input);

      // Read, modify, write
      const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
      const section = findSection(content, 'Dash Style')!;
      const modified = insertInSection(content, section, '- New item', 'append');
      await writeVaultFile(tempVault, 'test.md', modified, frontmatter, lineEnding);

      // Compare result
      const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
      expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));
    });
  });

  describe('Checkbox handling', () => {
    it('should toggle unchecked to checked', async () => {
      const input = await readGoldenFile(INPUT_DIR, 'checkboxes.md');
      const expected = await readGoldenFile(EXPECTED_DIR, 'checkboxes.toggle.md');

      await fs.writeFile(path.join(tempVault, 'test.md'), input);

      const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
      // Toggle the first unchecked task
      const toggled = content.replace('- [ ] Unchecked task', '- [x] Unchecked task');
      await writeVaultFile(tempVault, 'test.md', toggled, frontmatter, lineEnding);

      const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
      expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));
    });
  });

  describe('Heading level operations', () => {
    it('should add content to level 3 heading', async () => {
      const input = await readGoldenFile(INPUT_DIR, 'headings.md');
      const expected = await readGoldenFile(EXPECTED_DIR, 'headings.add-to-level3.md');

      await fs.writeFile(path.join(tempVault, 'test.md'), input);

      const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
      const section = findSection(content, 'Level 3')!;
      const modified = insertInSection(content, section, 'New content in level 3', 'append');
      await writeVaultFile(tempVault, 'test.md', modified, frontmatter, lineEnding);

      const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
      expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));
    });
  });

  describe('Frontmatter preservation', () => {
    it('should preserve frontmatter structure when updating field', async () => {
      const input = await readGoldenFile(INPUT_DIR, 'frontmatter.md');
      const expected = await readGoldenFile(EXPECTED_DIR, 'frontmatter.update.md');

      await fs.writeFile(path.join(tempVault, 'test.md'), input);

      const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'test.md');
      // Update status field
      frontmatter.status = 'completed';
      await writeVaultFile(tempVault, 'test.md', content, frontmatter, lineEnding);

      const result = await fs.readFile(path.join(tempVault, 'test.md'), 'utf-8');
      expect(normalizeLineEndings(result)).toBe(normalizeLineEndings(expected));
    });
  });
});

describe('Line Ending Detection', () => {
  it('should detect LF line endings', () => {
    const content = 'Line 1\nLine 2\nLine 3\n';
    expect(detectLineEnding(content)).toBe('LF');
  });

  it('should detect CRLF line endings', () => {
    const content = 'Line 1\r\nLine 2\r\nLine 3\r\n';
    expect(detectLineEnding(content)).toBe('CRLF');
  });

  it('should detect CRLF when majority are CRLF', () => {
    const content = 'Line 1\r\nLine 2\r\nLine 3\nLine 4\r\n';
    expect(detectLineEnding(content)).toBe('CRLF');
  });

  it('should detect LF for empty or single-line content', () => {
    expect(detectLineEnding('')).toBe('LF');
    expect(detectLineEnding('Single line')).toBe('LF');
  });
});

describe('Line Ending Conversion', () => {
  it('should convert LF to CRLF', () => {
    const content = 'Line 1\nLine 2\nLine 3\n';
    const converted = convertLineEndings(content, 'CRLF');
    expect(converted).toBe('Line 1\r\nLine 2\r\nLine 3\r\n');
  });

  it('should convert CRLF to LF', () => {
    const content = 'Line 1\r\nLine 2\r\nLine 3\r\n';
    const converted = convertLineEndings(content, 'LF');
    expect(converted).toBe('Line 1\nLine 2\nLine 3\n');
  });

  it('should handle mixed line endings when converting', () => {
    const content = 'Line 1\r\nLine 2\nLine 3\r\n';
    const toLF = convertLineEndings(content, 'LF');
    expect(toLF).toBe('Line 1\nLine 2\nLine 3\n');

    const toCRLF = convertLineEndings(content, 'CRLF');
    expect(toCRLF).toBe('Line 1\r\nLine 2\r\nLine 3\r\n');
  });
});

describe('Trailing Newline Normalization', () => {
  it('should add trailing newline if missing', () => {
    const content = 'Content without newline';
    expect(normalizeTrailingNewline(content)).toBe('Content without newline\n');
  });

  it('should preserve single trailing newline', () => {
    const content = 'Content with newline\n';
    expect(normalizeTrailingNewline(content)).toBe('Content with newline\n');
  });

  it('should reduce multiple trailing newlines to one', () => {
    const content = 'Content with extra newlines\n\n\n';
    expect(normalizeTrailingNewline(content)).toBe('Content with extra newlines\n');
  });

  it('should handle trailing spaces and newlines', () => {
    const content = 'Content with trailing whitespace  \n\n  \n';
    expect(normalizeTrailingNewline(content)).toBe('Content with trailing whitespace\n');
  });
});

describe('CRLF Round-Trip Preservation', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should preserve CRLF line endings through read/write cycle', async () => {
    // Create a file with CRLF line endings
    const crlfContent = '---\r\ntype: test\r\n---\r\n\r\n# Test\r\n\r\n## Section\r\n- Item 1\r\n';
    await fs.writeFile(path.join(tempVault, 'crlf-test.md'), crlfContent);

    // Read the file
    const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'crlf-test.md');
    expect(lineEnding).toBe('CRLF');

    // Modify and write back
    const section = findSection(content, 'Section')!;
    const modified = insertInSection(content, section, '- Item 2', 'append');
    await writeVaultFile(tempVault, 'crlf-test.md', modified, frontmatter, lineEnding);

    // Verify CRLF is preserved
    const result = await fs.readFile(path.join(tempVault, 'crlf-test.md'), 'utf-8');
    expect(detectLineEnding(result)).toBe('CRLF');
    expect(result).toContain('\r\n');
    expect(result).toContain('- Item 2\r\n');
  });

  it('should preserve LF line endings through read/write cycle', async () => {
    // Create a file with LF line endings
    const lfContent = '---\ntype: test\n---\n\n# Test\n\n## Section\n- Item 1\n';
    await fs.writeFile(path.join(tempVault, 'lf-test.md'), lfContent);

    // Read the file
    const { content, frontmatter, lineEnding } = await readVaultFile(tempVault, 'lf-test.md');
    expect(lineEnding).toBe('LF');

    // Modify and write back
    const section = findSection(content, 'Section')!;
    const modified = insertInSection(content, section, '- Item 2', 'append');
    await writeVaultFile(tempVault, 'lf-test.md', modified, frontmatter, lineEnding);

    // Verify LF is preserved (no CRLF)
    const result = await fs.readFile(path.join(tempVault, 'lf-test.md'), 'utf-8');
    expect(detectLineEnding(result)).toBe('LF');
    expect(result).not.toContain('\r\n');
  });
});
