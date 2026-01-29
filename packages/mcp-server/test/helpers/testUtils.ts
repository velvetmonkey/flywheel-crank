/**
 * Test utilities for creating temporary vaults and test fixtures
 */

import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { mkdir } from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Create a temporary vault directory for testing
 * Returns the absolute path to the temp vault
 */
export async function createTempVault(): Promise<string> {
  const tmpDir = os.tmpdir();
  const vaultPath = await mkdtemp(path.join(tmpDir, 'flywheel-test-'));
  return vaultPath;
}

/**
 * Create a test note within the vault
 * @param vaultPath - Absolute path to the vault
 * @param notePath - Relative path within the vault (e.g., "daily-notes/2026-01-28.md")
 * @param content - Markdown content including frontmatter
 */
export async function createTestNote(
  vaultPath: string,
  notePath: string,
  content: string
): Promise<void> {
  const fullPath = path.join(vaultPath, notePath);
  const dir = path.dirname(fullPath);

  // Ensure parent directories exist
  await mkdir(dir, { recursive: true });

  await writeFile(fullPath, content, 'utf-8');
}

/**
 * Read a test note from the vault
 * @param vaultPath - Absolute path to the vault
 * @param notePath - Relative path within the vault
 * @returns The file content as a string
 */
export async function readTestNote(
  vaultPath: string,
  notePath: string
): Promise<string> {
  const fullPath = path.join(vaultPath, notePath);
  return await readFile(fullPath, 'utf-8');
}

/**
 * Clean up a temporary vault
 * @param vaultPath - Absolute path to the vault
 */
export async function cleanupTempVault(vaultPath: string): Promise<void> {
  await rm(vaultPath, { recursive: true, force: true });
}

/**
 * Create a sample note with frontmatter and sections
 */
export function createSampleNote(): string {
  return `---
type: test
tags:
  - tag1
  - tag2
nested:
  key: value
---
# Test Note

## Log

- Existing entry

## Another Section

Content here
`;
}

/**
 * Create a simple daily note fixture
 */
export function createDailyNote(): string {
  return `---
date: 2026-01-28
type: daily
---
# 2026-01-28

## Habits

- [ ] Exercise
- [ ] Meditation

## Log

- **09:00** Started work

## Tasks

- [ ] Complete project
`;
}

/**
 * Create a note without frontmatter
 */
export function createNoteWithoutFrontmatter(): string {
  return `# Simple Note

## Section 1

Some content

## Section 2

More content
`;
}
