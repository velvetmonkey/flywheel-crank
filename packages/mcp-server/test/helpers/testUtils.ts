/**
 * Test utilities for creating temporary vaults and test fixtures
 */

import { mkdtemp, writeFile, readFile, rm, mkdir } from 'fs/promises';
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

// ========================================
// Entity Cache Helpers (for wikilink tests)
// ========================================

/**
 * Entity categories for createEntityCache
 */
export interface EntityCategories {
  people?: string[];
  projects?: string[];
  technologies?: string[];
  acronyms?: string[];
  other?: string[];
}

/**
 * Create a minimal vault structure with entity-rich notes
 */
export async function createVaultWithEntities(vaultPath: string): Promise<void> {
  // Create .claude directory for cache
  await mkdir(path.join(vaultPath, '.claude'), { recursive: true });

  // Create a person note
  await createTestNote(
    vaultPath,
    'people/Jordan Smith.md',
    `---
type: person
tags:
  - team-member
---
# Jordan Smith

Senior engineer working on [[MCP Server]].
`
  );

  // Create a project note
  await createTestNote(
    vaultPath,
    'projects/MCP Server.md',
    `---
type: project
tags:
  - active
---
# MCP Server

Model Context Protocol server implementation.
`
  );

  // Create a technology note
  await createTestNote(
    vaultPath,
    'technologies/TypeScript.md',
    `---
type: technology
tags:
  - language
---
# TypeScript

JavaScript with static types.
`
  );

  // Create an acronym note
  await createTestNote(
    vaultPath,
    'glossary/API.md',
    `---
type: acronym
aliases:
  - Application Programming Interface
---
# API

Application Programming Interface.
`
  );
}

/**
 * Create a pre-populated entity cache file
 */
export async function createEntityCache(
  vaultPath: string,
  entities: EntityCategories,
  generatedAt?: Date
): Promise<void> {
  const cacheDir = path.join(vaultPath, '.claude');
  await mkdir(cacheDir, { recursive: true });

  const cache = {
    _metadata: {
      generated_at: (generatedAt || new Date()).toISOString(),
      vault_path: vaultPath,
      source: 'test-utils createEntityCache',
      version: 2, // Current cache version with alias support
      total_entities:
        (entities.people?.length || 0) +
        (entities.projects?.length || 0) +
        (entities.technologies?.length || 0) +
        (entities.acronyms?.length || 0) +
        (entities.other?.length || 0),
    },
    people: (entities.people || []).map((name) => ({
      name,
      path: `people/${name}.md`,
      aliases: [],
    })),
    projects: (entities.projects || []).map((name) => ({
      name,
      path: `projects/${name}.md`,
      aliases: [],
    })),
    technologies: (entities.technologies || []).map((name) => ({
      name,
      path: `technologies/${name}.md`,
      aliases: [],
    })),
    acronyms: (entities.acronyms || []).map((name) => ({
      name,
      path: `glossary/${name}.md`,
      aliases: [],
    })),
    other: (entities.other || []).map((name) => ({
      name,
      path: `other/${name}.md`,
      aliases: [],
    })),
  };

  await writeFile(
    path.join(cacheDir, 'wikilink-entities.json'),
    JSON.stringify(cache, null, 2)
  );
}
