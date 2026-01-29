/**
 * Tests for mutation hints
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import {
  computeHash,
  getHintsPath,
  readHints,
  writeHints,
  addMutationHint,
  getHintsForPath,
  getHintsSince,
  clearHints,
} from '../../src/core/hints.js';
import { createTempVault, cleanupTempVault } from '../helpers/testUtils.js';

describe('computeHash', () => {
  it('should produce consistent hashes', () => {
    const content = 'Hello, World!';
    const hash1 = computeHash(content);
    const hash2 = computeHash(content);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(12);
  });

  it('should produce different hashes for different content', () => {
    const hash1 = computeHash('Hello');
    const hash2 = computeHash('World');

    expect(hash1).not.toBe(hash2);
  });
});

describe('Hints operations', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  describe('getHintsPath', () => {
    it('should return path in .claude directory', () => {
      const hintsPath = getHintsPath('/vault');
      expect(hintsPath).toBe('/vault/.claude/crank-mutation-hints.json');
    });
  });

  describe('readHints/writeHints', () => {
    it('should return empty hints for non-existent file', async () => {
      const hints = await readHints(tempVault);

      expect(hints.version).toBe(1);
      expect(hints.mutations).toHaveLength(0);
    });

    it('should write and read hints', async () => {
      const hints = {
        version: 1,
        mutations: [
          {
            timestamp: '2026-01-29T12:00:00Z',
            path: 'note.md',
            operation: 'add_to_section',
            beforeHash: 'abc123',
            afterHash: 'def456',
          },
        ],
      };

      await writeHints(tempVault, hints);
      const read = await readHints(tempVault);

      expect(read).toEqual(hints);
    });

    it('should create .claude directory if needed', async () => {
      await writeHints(tempVault, { version: 1, mutations: [] });

      const claudeDir = path.join(tempVault, '.claude');
      const stat = await fs.stat(claudeDir);

      expect(stat.isDirectory()).toBe(true);
    });
  });

  describe('addMutationHint', () => {
    it('should add a mutation hint', async () => {
      const result = await addMutationHint(
        tempVault,
        'daily-notes/2026-01-29.md',
        'add_to_section',
        '# Before',
        '# After\n- New item'
      );

      expect(result).toBe(true);

      const hints = await readHints(tempVault);
      expect(hints.mutations).toHaveLength(1);
      expect(hints.mutations[0].path).toBe('daily-notes/2026-01-29.md');
      expect(hints.mutations[0].operation).toBe('add_to_section');
    });

    it('should add new hints at the front', async () => {
      await addMutationHint(tempVault, 'first.md', 'op1', 'a', 'b');
      await addMutationHint(tempVault, 'second.md', 'op2', 'c', 'd');

      const hints = await readHints(tempVault);

      expect(hints.mutations[0].path).toBe('second.md');
      expect(hints.mutations[1].path).toBe('first.md');
    });

    it('should trim old hints at max limit', async () => {
      // Add 105 hints (max is 100)
      for (let i = 0; i < 105; i++) {
        await addMutationHint(tempVault, `note${i}.md`, 'op', `${i}`, `${i + 1}`);
      }

      const hints = await readHints(tempVault);
      expect(hints.mutations).toHaveLength(100);

      // Most recent should be at the front
      expect(hints.mutations[0].path).toBe('note104.md');
    });
  });

  describe('getHintsForPath', () => {
    it('should filter hints by path', async () => {
      await addMutationHint(tempVault, 'note1.md', 'op1', 'a', 'b');
      await addMutationHint(tempVault, 'note2.md', 'op2', 'c', 'd');
      await addMutationHint(tempVault, 'note1.md', 'op3', 'e', 'f');

      const hints = await getHintsForPath(tempVault, 'note1.md');

      expect(hints).toHaveLength(2);
      expect(hints.every(h => h.path === 'note1.md')).toBe(true);
    });

    it('should return empty array for unknown path', async () => {
      await addMutationHint(tempVault, 'known.md', 'op', 'a', 'b');

      const hints = await getHintsForPath(tempVault, 'unknown.md');

      expect(hints).toHaveLength(0);
    });
  });

  describe('getHintsSince', () => {
    it('should filter hints by timestamp', async () => {
      // Add hints with known timestamps
      const hints = {
        version: 1,
        mutations: [
          {
            timestamp: '2026-01-29T12:00:00Z',
            path: 'recent.md',
            operation: 'op1',
            beforeHash: 'a',
            afterHash: 'b',
          },
          {
            timestamp: '2026-01-28T12:00:00Z',
            path: 'older.md',
            operation: 'op2',
            beforeHash: 'c',
            afterHash: 'd',
          },
        ],
      };
      await writeHints(tempVault, hints);

      const since = new Date('2026-01-29T00:00:00Z');
      const filtered = await getHintsSince(tempVault, since);

      expect(filtered).toHaveLength(1);
      expect(filtered[0].path).toBe('recent.md');
    });
  });

  describe('clearHints', () => {
    it('should remove all hints', async () => {
      await addMutationHint(tempVault, 'note.md', 'op', 'a', 'b');
      await clearHints(tempVault);

      const hints = await readHints(tempVault);

      expect(hints.mutations).toHaveLength(0);
    });
  });
});
