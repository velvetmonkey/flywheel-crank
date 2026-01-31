/**
 * Git auto-commit utilities
 */

import { simpleGit, SimpleGit, CheckRepoActions } from 'simple-git';
import path from 'path';
import fs from 'fs/promises';

const LAST_COMMIT_FILE = '.claude/last-crank-commit.json';

/**
 * Tracking data for the last successful Crank commit.
 * Used to prevent accidental undo of unrelated commits.
 */
export interface LastCrankCommit {
  hash: string;
  message: string;
  timestamp: string;
}

/**
 * Save tracking info for the last successful Crank commit.
 * This enables safe undo verification.
 */
export async function saveLastCrankCommit(
  vaultPath: string,
  hash: string,
  message: string
): Promise<void> {
  const filePath = path.join(vaultPath, LAST_COMMIT_FILE);
  const dirPath = path.dirname(filePath);

  // Ensure .claude directory exists
  await fs.mkdir(dirPath, { recursive: true });

  const data: LastCrankCommit = {
    hash,
    message,
    timestamp: new Date().toISOString(),
  };
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

/**
 * Get the last tracked Crank commit, if any.
 */
export async function getLastCrankCommit(
  vaultPath: string
): Promise<LastCrankCommit | null> {
  try {
    const filePath = path.join(vaultPath, LAST_COMMIT_FILE);
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as LastCrankCommit;
  } catch {
    return null;
  }
}

/**
 * Clear the last Crank commit tracking (after successful undo).
 */
export async function clearLastCrankCommit(vaultPath: string): Promise<void> {
  try {
    const filePath = path.join(vaultPath, LAST_COMMIT_FILE);
    await fs.unlink(filePath);
  } catch {
    // File doesn't exist, ignore
  }
}

export interface GitCommitResult {
  success: boolean;
  hash?: string;
  error?: string;
}

/**
 * Check if the vault is a git repository
 */
export async function isGitRepo(vaultPath: string): Promise<boolean> {
  try {
    const git: SimpleGit = simpleGit(vaultPath);
    const isRepo = await git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT);
    return isRepo;
  } catch {
    return false;
  }
}

/**
 * Commit a change to a specific file
 * Non-blocking - returns success even if commit fails
 */
export async function commitChange(
  vaultPath: string,
  filePath: string,
  messagePrefix: string
): Promise<GitCommitResult> {
  try {
    const git: SimpleGit = simpleGit(vaultPath);

    // Check if repo
    const isRepo = await isGitRepo(vaultPath);
    if (!isRepo) {
      return {
        success: false,
        error: 'Not a git repository',
      };
    }

    // Stage the file
    await git.add(filePath);

    // Create commit message
    const fileName = path.basename(filePath);
    const commitMessage = `${messagePrefix} Update ${fileName}`;

    // Commit
    const result = await git.commit(commitMessage);

    // Track this commit for safe undo verification
    if (result.commit) {
      await saveLastCrankCommit(vaultPath, result.commit, commitMessage);
    }

    return {
      success: true,
      hash: result.commit,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface CommitInfo {
  hash: string;
  message: string;
  date: string;
  author: string;
}

/**
 * Get information about the last commit
 */
export async function getLastCommit(vaultPath: string): Promise<CommitInfo | null> {
  try {
    const git: SimpleGit = simpleGit(vaultPath);

    const isRepo = await isGitRepo(vaultPath);
    if (!isRepo) {
      return null;
    }

    const log = await git.log({ maxCount: 1 });
    if (!log.latest) {
      return null;
    }

    return {
      hash: log.latest.hash,
      message: log.latest.message,
      date: log.latest.date,
      author: log.latest.author_name,
    };
  } catch {
    return null;
  }
}

export interface UndoResult {
  success: boolean;
  message: string;
  undoneCommit?: CommitInfo;
}

/**
 * Undo the last commit by resetting to HEAD~1
 * This is a soft reset - changes are preserved in working directory
 */
export async function undoLastCommit(vaultPath: string): Promise<UndoResult> {
  try {
    const git: SimpleGit = simpleGit(vaultPath);

    const isRepo = await isGitRepo(vaultPath);
    if (!isRepo) {
      return {
        success: false,
        message: 'Not a git repository',
      };
    }

    // Get the commit we're about to undo
    const lastCommit = await getLastCommit(vaultPath);
    if (!lastCommit) {
      return {
        success: false,
        message: 'No commits to undo',
      };
    }

    // Perform soft reset (keeps file changes)
    await git.reset(['--soft', 'HEAD~1']);

    return {
      success: true,
      message: `Undone commit: ${lastCommit.message}`,
      undoneCommit: lastCommit,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Check if there are uncommitted changes
 */
export async function hasUncommittedChanges(vaultPath: string): Promise<boolean> {
  try {
    const git: SimpleGit = simpleGit(vaultPath);
    const status = await git.status();
    return !status.isClean();
  } catch {
    return false;
  }
}
