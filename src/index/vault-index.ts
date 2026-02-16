/**
 * Vault Index Builder - uses Obsidian MetadataCache
 *
 * Builds VaultIndex from Obsidian's built-in metadata parsing,
 * replacing the fs-based scanner from flywheel-memory.
 */

import { App, TFile, CachedMetadata, getLinkpath } from 'obsidian';
import type { VaultIndex, VaultNote, Backlink, OutLink } from '../core/types';

/** Directories to exclude from indexing */
const EXCLUDED_DIRS = new Set([
  '.obsidian',
  '.trash',
  '.git',
  'node_modules',
  'templates',
  '.claude',
  '.flywheel',
]);

/** Normalize a link target for matching */
export function normalizeTarget(target: string): string {
  return target.toLowerCase().replace(/\.md$/, '');
}

/** Normalize a note path to a matchable key */
function normalizeNotePath(path: string): string {
  return path.toLowerCase().replace(/\.md$/, '');
}

/** Get the title from a path (filename without extension) */
function getTitleFromPath(path: string): string {
  return path.replace(/\.md$/, '').split('/').pop() || path;
}

/** Check if a file should be indexed */
function shouldIndex(file: TFile): boolean {
  const parts = file.path.split('/');
  return !parts.some(part => EXCLUDED_DIRS.has(part));
}

/**
 * Build the complete vault index from Obsidian MetadataCache
 */
export function buildVaultIndex(app: App): VaultIndex {
  const files = app.vault.getMarkdownFiles().filter(shouldIndex);

  const notes = new Map<string, VaultNote>();
  const entities = new Map<string, string>();
  const backlinks = new Map<string, Backlink[]>();
  const tags = new Map<string, Set<string>>();

  // First pass: build notes and entities
  for (const file of files) {
    const cache = app.metadataCache.getFileCache(file);
    const note = buildNoteFromCache(file, cache);
    notes.set(file.path, note);

    // Map by title
    const normalizedTitle = normalizeTarget(note.title);
    if (!entities.has(normalizedTitle)) {
      entities.set(normalizedTitle, note.path);
    }

    // Map by full path (without extension)
    const normalizedPath = normalizeNotePath(note.path);
    entities.set(normalizedPath, note.path);

    // Map by aliases
    for (const alias of note.aliases) {
      const normalizedAlias = normalizeTarget(alias);
      if (!entities.has(normalizedAlias)) {
        entities.set(normalizedAlias, note.path);
      }
    }

    // Build tags index
    for (const tag of note.tags) {
      if (!tags.has(tag)) {
        tags.set(tag, new Set());
      }
      tags.get(tag)!.add(note.path);
    }
  }

  // Second pass: build backlinks (deduplicated by source path per target)
  for (const note of notes.values()) {
    const seenTargets = new Set<string>();
    for (const link of note.outlinks) {
      const normalizedTarget = normalizeTarget(link.target);
      const targetPath = entities.get(normalizedTarget);
      const key = targetPath ? normalizeNotePath(targetPath) : normalizedTarget;

      // Skip duplicate links from the same source to the same target
      const dedupeKey = `${note.path}::${key}`;
      if (seenTargets.has(dedupeKey)) continue;
      seenTargets.add(dedupeKey);

      if (!backlinks.has(key)) {
        backlinks.set(key, []);
      }

      backlinks.get(key)!.push({
        source: note.path,
        line: link.line,
      });
    }
  }

  return {
    notes,
    backlinks,
    entities,
    tags,
    builtAt: new Date(),
  };
}

/**
 * Build a VaultNote from a file and its cached metadata
 */
function buildNoteFromCache(file: TFile, cache: CachedMetadata | null): VaultNote {
  const title = getTitleFromPath(file.path);

  // Extract aliases from frontmatter
  const aliases: string[] = [];
  if (cache?.frontmatter?.aliases) {
    const raw = cache.frontmatter.aliases;
    if (Array.isArray(raw)) {
      aliases.push(...raw.filter((a: unknown) => typeof a === 'string'));
    } else if (typeof raw === 'string') {
      aliases.push(raw);
    }
  }

  // Extract outlinks from cache
  const outlinks: OutLink[] = [];
  if (cache?.links) {
    for (const link of cache.links) {
      outlinks.push({
        target: link.link,
        alias: link.displayText !== link.link ? link.displayText : undefined,
        line: link.position.start.line + 1,
      });
    }
  }

  // Extract tags
  const tagSet = new Set<string>();
  if (cache?.tags) {
    for (const tag of cache.tags) {
      tagSet.add(tag.tag);
    }
  }
  // Also include frontmatter tags
  if (cache?.frontmatter?.tags) {
    const fmTags = cache.frontmatter.tags;
    if (Array.isArray(fmTags)) {
      for (const t of fmTags) {
        if (typeof t === 'string') {
          tagSet.add(t.startsWith('#') ? t : `#${t}`);
        }
      }
    } else if (typeof fmTags === 'string') {
      tagSet.add(fmTags.startsWith('#') ? fmTags : `#${fmTags}`);
    }
  }

  return {
    path: file.path,
    title,
    aliases,
    frontmatter: cache?.frontmatter ? { ...cache.frontmatter } : {},
    outlinks,
    tags: Array.from(tagSet),
    modified: new Date(file.stat.mtime),
    created: file.stat.ctime ? new Date(file.stat.ctime) : undefined,
  };
}

/**
 * Resolve a link target to a note path
 */
export function resolveTarget(index: VaultIndex, target: string): string | undefined {
  return index.entities.get(normalizeTarget(target));
}

/**
 * Get backlinks for a note
 */
export function getBacklinksForNote(index: VaultIndex, notePath: string): Backlink[] {
  return index.backlinks.get(normalizeNotePath(notePath)) || [];
}

/**
 * Get forward links for a note with resolution info
 */
export function getForwardLinksForNote(
  index: VaultIndex,
  notePath: string
): Array<{ target: string; alias?: string; line: number; resolvedPath?: string; exists: boolean }> {
  const note = index.notes.get(notePath);
  if (!note) return [];

  const seen = new Set<string>();
  return note.outlinks
    .filter((link) => {
      const key = normalizeTarget(link.target);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((link) => {
      const resolvedPath = resolveTarget(index, link.target);
      return {
        target: link.target,
        alias: link.alias,
        line: link.line,
        resolvedPath,
        exists: resolvedPath !== undefined,
      };
    });
}

/**
 * Find orphan notes (notes with no backlinks)
 */
export function findOrphanNotes(
  index: VaultIndex,
  folder?: string
): Array<{ path: string; title: string; modified: Date }> {
  const orphans: Array<{ path: string; title: string; modified: Date }> = [];

  for (const note of index.notes.values()) {
    if (folder && !note.path.startsWith(folder)) continue;

    const bl = getBacklinksForNote(index, note.path);
    if (bl.length === 0) {
      orphans.push({ path: note.path, title: note.title, modified: note.modified });
    }
  }

  return orphans.sort((a, b) => b.modified.getTime() - a.modified.getTime());
}

/**
 * Find hub notes (highly connected notes)
 */
export function findHubNotes(
  index: VaultIndex,
  minLinks: number = 5
): Array<{
  path: string;
  title: string;
  backlink_count: number;
  forward_link_count: number;
  total_connections: number;
}> {
  const hubs: Array<{
    path: string;
    title: string;
    backlink_count: number;
    forward_link_count: number;
    total_connections: number;
  }> = [];

  for (const note of index.notes.values()) {
    const backlinkCount = getBacklinksForNote(index, note.path).length;
    const forwardLinkCount = note.outlinks.length;
    const totalConnections = backlinkCount + forwardLinkCount;

    if (totalConnections >= minLinks) {
      hubs.push({
        path: note.path,
        title: note.title,
        backlink_count: backlinkCount,
        forward_link_count: forwardLinkCount,
        total_connections: totalConnections,
      });
    }
  }

  return hubs.sort((a, b) => b.total_connections - a.total_connections);
}

/**
 * Find dead links (links to non-existent notes)
 */
export function findDeadLinks(
  index: VaultIndex
): Array<{ source: string; target: string; line: number }> {
  const dead: Array<{ source: string; target: string; line: number }> = [];

  for (const note of index.notes.values()) {
    for (const link of note.outlinks) {
      const resolved = resolveTarget(index, link.target);
      if (!resolved) {
        dead.push({
          source: note.path,
          target: link.target,
          line: link.line,
        });
      }
    }
  }

  return dead;
}

/**
 * Find stale notes (oldest modified)
 */
export function findStaleNotes(
  index: VaultIndex,
  limit: number = 20
): Array<{ path: string; title: string; modified: Date; daysSinceModified: number }> {
  const now = Date.now();
  const notes = Array.from(index.notes.values())
    .map(note => ({
      path: note.path,
      title: note.title,
      modified: note.modified,
      daysSinceModified: Math.floor((now - note.modified.getTime()) / (1000 * 60 * 60 * 24)),
    }))
    .sort((a, b) => a.modified.getTime() - b.modified.getTime());

  return notes.slice(0, limit);
}
