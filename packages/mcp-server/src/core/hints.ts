/**
 * Mutation hints for Flywheel integration
 *
 * Writes hints to .claude/crank-mutation-hints.json so Flywheel
 * can prioritize reindexing of recently mutated files.
 *
 * When StateDb is available, hints are also stored in SQLite
 * for faster access and cross-server coordination.
 */

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import {
  setCrankState,
  getCrankState,
  type StateDb,
} from '@velvetmonkey/vault-core';

/**
 * Module-level StateDb reference for hints storage
 * Set via setHintsStateDb() during initialization
 */
let moduleStateDb: StateDb | null = null;

/**
 * Set the StateDb instance for this module
 * Called during MCP server initialization
 */
export function setHintsStateDb(stateDb: StateDb | null): void {
  moduleStateDb = stateDb;
}

/** Maximum number of hints to keep in the file */
const MAX_HINTS = 100;

/** Hint file version for compatibility */
const HINT_VERSION = 1;

/**
 * Single mutation hint
 */
export interface MutationHint {
  /** ISO timestamp of the mutation */
  timestamp: string;
  /** Vault-relative path of the mutated file */
  path: string;
  /** Type of mutation operation */
  operation: string;
  /** Hash of content before mutation */
  beforeHash: string;
  /** Hash of content after mutation */
  afterHash: string;
}

/**
 * Hints file structure
 */
export interface HintsFile {
  version: number;
  mutations: MutationHint[];
}

/**
 * Compute a short hash of content for change tracking
 */
export function computeHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
}

/**
 * Get the path to the hints file
 */
export function getHintsPath(vaultPath: string): string {
  return path.join(vaultPath, '.claude', 'crank-mutation-hints.json');
}

/**
 * Read the current hints file
 *
 * Uses StateDb if available, falls back to JSON file.
 */
export async function readHints(vaultPath: string): Promise<HintsFile> {
  // Try StateDb first
  if (moduleStateDb) {
    try {
      const data = getCrankState<HintsFile>(moduleStateDb, 'mutation_hints');
      if (data && data.version === HINT_VERSION) {
        return data;
      }
    } catch {
      // Fallback to JSON
    }
  }

  // Fallback to JSON file
  const hintsPath = getHintsPath(vaultPath);

  try {
    const content = await fs.readFile(hintsPath, 'utf-8');
    const data = JSON.parse(content) as HintsFile;

    // Validate version
    if (data.version !== HINT_VERSION) {
      // Reset on version mismatch
      return { version: HINT_VERSION, mutations: [] };
    }

    return data;
  } catch {
    // File doesn't exist or is invalid
    return { version: HINT_VERSION, mutations: [] };
  }
}

/**
 * Write hints file
 *
 * Uses StateDb if available, also writes JSON for backward compatibility.
 */
export async function writeHints(vaultPath: string, hints: HintsFile): Promise<void> {
  // Write to StateDb if available
  if (moduleStateDb) {
    try {
      setCrankState(moduleStateDb, 'mutation_hints', hints);
    } catch (e) {
      console.error('[Crank] Failed to write hints to StateDb:', e);
    }
  }

  // Also write to JSON file for backward compatibility
  const hintsPath = getHintsPath(vaultPath);
  const hintsDir = path.dirname(hintsPath);

  // Ensure .claude directory exists
  await fs.mkdir(hintsDir, { recursive: true });

  // Write atomically (write to temp, then rename)
  const tempPath = hintsPath + '.tmp';
  await fs.writeFile(tempPath, JSON.stringify(hints, null, 2), 'utf-8');
  await fs.rename(tempPath, hintsPath);
}

/**
 * Add a mutation hint
 *
 * @param vaultPath - Path to the vault root
 * @param notePath - Vault-relative path to the mutated file
 * @param operation - Name of the mutation operation
 * @param beforeContent - Content before mutation
 * @param afterContent - Content after mutation
 * @returns true if hint was written successfully
 */
export async function addMutationHint(
  vaultPath: string,
  notePath: string,
  operation: string,
  beforeContent: string,
  afterContent: string
): Promise<boolean> {
  try {
    const hints = await readHints(vaultPath);

    // Create new hint
    const hint: MutationHint = {
      timestamp: new Date().toISOString(),
      path: notePath,
      operation,
      beforeHash: computeHash(beforeContent),
      afterHash: computeHash(afterContent),
    };

    // Add to front of list
    hints.mutations.unshift(hint);

    // Trim to max size
    if (hints.mutations.length > MAX_HINTS) {
      hints.mutations = hints.mutations.slice(0, MAX_HINTS);
    }

    await writeHints(vaultPath, hints);
    return true;
  } catch (error) {
    // Log but don't fail the mutation
    console.error('[Crank] Failed to write mutation hint:', error);
    return false;
  }
}

/**
 * Get recent mutations for a specific path
 */
export async function getHintsForPath(
  vaultPath: string,
  notePath: string
): Promise<MutationHint[]> {
  const hints = await readHints(vaultPath);
  return hints.mutations.filter(h => h.path === notePath);
}

/**
 * Get all mutations since a given timestamp
 */
export async function getHintsSince(
  vaultPath: string,
  since: Date
): Promise<MutationHint[]> {
  const hints = await readHints(vaultPath);
  const sinceMs = since.getTime();

  return hints.mutations.filter(h => {
    const hintMs = new Date(h.timestamp).getTime();
    return hintMs >= sinceMs;
  });
}

/**
 * Clear all hints (useful for testing or reset)
 */
export async function clearHints(vaultPath: string): Promise<void> {
  await writeHints(vaultPath, { version: HINT_VERSION, mutations: [] });
}
