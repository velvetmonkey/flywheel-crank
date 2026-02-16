/**
 * Entity scanning via Obsidian API
 *
 * Replaces the fs-based scanner from flywheel-memory/packages/core/src/entities.ts
 * Uses app.vault.getMarkdownFiles() and app.metadataCache instead of fs.readdir/readFile
 */

import { App, TFile } from 'obsidian';
import type { EntityIndex, EntityCategory, EntityWithAliases, Entity } from '../core/types';

/** Maximum entity name/alias length */
const MAX_ENTITY_LENGTH = 25;

/** Maximum word count for entity names */
const MAX_ENTITY_WORDS = 3;

/** Default exclude patterns for periodic notes */
const DEFAULT_EXCLUDE_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}$/,
  /^\d{1,2}\/\d{1,2}\/\d{4}$/,
  /^\d{4}-W\d{2}$/,
  /^\d{4}-\d{2}$/,
  /^\d{4}-Q\d$/,
  /^\d+$/,
  /^@/,
  /^</,
  /^\{\{/,
  /\\$/,
  /\.(?:md|js|py|json|jpg|png|pdf|csv)$/i,
  /^[a-z0-9_-]+\.[a-z]+$/i,
];

/** Default tech keywords */
const DEFAULT_TECH_KEYWORDS = [
  'databricks', 'api', 'code', 'azure', 'sql', 'git',
  'node', 'react', 'powerbi', 'excel', 'copilot',
  'fabric', 'apim', 'endpoint', 'synology', 'tailscale',
  'obsidian', 'claude', 'powershell', 'mcp', 'typescript',
  'javascript', 'python', 'docker', 'kubernetes',
  'adf', 'adb', 'net', 'aws', 'gcp', 'terraform',
  'chatgpt', 'langchain', 'openai', 'huggingface', 'pytorch', 'tensorflow',
  'anthropic', 'llm', 'embedding', 'vector', 'rag', 'prompt', 'agent',
  'transformer', 'ollama', 'gemini',
  'swift', 'kotlin', 'rust', 'golang', 'elixir', 'scala', 'julia',
  'ruby', 'php', 'csharp',
  'ansible', 'nginx', 'redis', 'postgres', 'mongodb', 'graphql', 'grpc', 'kafka',
];

const ORG_SUFFIXES = ['inc', 'corp', 'llc', 'ltd', 'team', 'group', 'co', 'company'];
const LOCATION_KEYWORDS = ['city', 'county', 'region', 'district', 'province'];
const REGION_PATTERNS = ['eu', 'apac', 'emea', 'latam', 'amer'];

/** Default folders to exclude */
const DEFAULT_EXCLUDE_FOLDERS = [
  'daily-notes', 'daily', 'weekly', 'weekly-notes', 'monthly', 'monthly-notes',
  'quarterly', 'yearly-notes', 'periodic', 'journal',
  'inbox', 'templates', 'attachments', 'tmp',
  'clippings', 'readwise', 'articles', 'bookmarks', 'web-clips',
];

function isValidAlias(alias: string): boolean {
  if (typeof alias !== 'string' || alias.length === 0) return false;
  if (alias.length > MAX_ENTITY_LENGTH) return false;
  const words = alias.split(/\s+/).filter(w => w.length > 0);
  return words.length <= MAX_ENTITY_WORDS;
}

function matchesExcludePattern(name: string): boolean {
  return DEFAULT_EXCLUDE_PATTERNS.some(p => p.test(name));
}

function categorizeEntity(name: string, techKeywords: string[]): EntityCategory {
  const nameLower = name.toLowerCase();
  const words = name.split(/\s+/);

  if (techKeywords.some(tech => nameLower.includes(tech))) return 'technologies';
  if (name === name.toUpperCase() && name.length >= 2 && name.length <= 6) return 'acronyms';
  if (words.length >= 2 && ORG_SUFFIXES.includes(words[words.length - 1].toLowerCase())) return 'organizations';
  if (words.length >= 2 && LOCATION_KEYWORDS.includes(words[words.length - 1].toLowerCase())) return 'locations';
  if (REGION_PATTERNS.includes(nameLower)) return 'locations';
  if (words.length === 2) {
    const [first, last] = words;
    if (first[0] === first[0].toUpperCase() && last[0] === last[0].toUpperCase()) return 'people';
  }
  if (words.length >= 2 && name === name.toLowerCase()) return 'concepts';
  if (name.includes(' ')) return 'projects';
  return 'other';
}

/**
 * Scan vault entities using Obsidian API
 */
export function scanVaultEntities(
  app: App,
  options: { excludeFolders?: string[]; techKeywords?: string[] } = {}
): EntityIndex {
  const excludeFolders = new Set(
    (options.excludeFolders ?? DEFAULT_EXCLUDE_FOLDERS).map(f => f.toLowerCase())
  );
  const techKeywords = options.techKeywords ?? DEFAULT_TECH_KEYWORDS;

  const files = app.vault.getMarkdownFiles();
  const seenNames = new Set<string>();

  const index: EntityIndex = {
    technologies: [],
    acronyms: [],
    people: [],
    projects: [],
    organizations: [],
    locations: [],
    concepts: [],
    other: [],
    _metadata: {
      total_entities: 0,
      generated_at: new Date().toISOString(),
      vault_path: '',
      source: 'flywheel-crank scanVaultEntities',
    },
  };

  for (const file of files) {
    // Skip excluded folders
    const parts = file.path.split('/');
    if (parts.some(p => excludeFolders.has(p.toLowerCase()) || p.startsWith('.'))) {
      continue;
    }

    const stem = file.basename;
    if (stem.length < 2 || matchesExcludePattern(stem)) continue;

    const nameLower = stem.toLowerCase();
    if (seenNames.has(nameLower)) continue;
    seenNames.add(nameLower);

    // Get aliases from metadata cache
    const aliases: string[] = [];
    const cache = app.metadataCache.getFileCache(file);
    if (cache?.frontmatter?.aliases) {
      const raw = cache.frontmatter.aliases;
      if (Array.isArray(raw)) {
        for (const a of raw) {
          if (typeof a === 'string' && isValidAlias(a)) aliases.push(a);
        }
      } else if (typeof raw === 'string' && isValidAlias(raw)) {
        aliases.push(raw);
      }
    }

    const category = categorizeEntity(stem, techKeywords);
    const entityObj: EntityWithAliases = {
      name: stem,
      path: file.path,
      aliases,
    };

    index[category].push(entityObj);
  }

  // Sort and count
  const sortByName = (a: Entity, b: Entity) => {
    const nameA = typeof a === 'string' ? a : a.name;
    const nameB = typeof b === 'string' ? b : b.name;
    return nameA.localeCompare(nameB);
  };

  for (const cat of ['technologies', 'acronyms', 'people', 'projects', 'organizations', 'locations', 'concepts', 'other'] as const) {
    index[cat].sort(sortByName);
  }

  index._metadata.total_entities =
    index.technologies.length + index.acronyms.length +
    index.people.length + index.projects.length +
    index.organizations.length + index.locations.length +
    index.concepts.length + index.other.length;

  return index;
}

/**
 * Get all entities as a flat array
 */
export function getAllEntities(index: EntityIndex): Entity[] {
  return [
    ...index.technologies, ...index.acronyms,
    ...index.people, ...index.projects,
    ...index.organizations, ...index.locations,
    ...index.concepts, ...index.other,
  ];
}

/**
 * Get all entities with their category type preserved
 */
export function getAllEntitiesWithTypes(index: EntityIndex): Array<{ entity: EntityWithAliases; category: EntityCategory }> {
  const result: Array<{ entity: EntityWithAliases; category: EntityCategory }> = [];
  const categories: EntityCategory[] = [
    'technologies', 'acronyms', 'people', 'projects',
    'organizations', 'locations', 'concepts', 'other',
  ];

  for (const category of categories) {
    const entities = index[category];
    if (!entities?.length) continue;
    for (const entity of entities) {
      const obj = typeof entity === 'string'
        ? { name: entity, path: '', aliases: [] }
        : entity;
      result.push({ entity: obj, category });
    }
  }

  return result;
}

/** Get entity name from Entity */
export function getEntityName(entity: Entity): string {
  return typeof entity === 'string' ? entity : entity.name;
}

/** Get entity aliases from Entity */
export function getEntityAliases(entity: Entity): string[] {
  return typeof entity === 'string' ? [] : entity.aliases;
}
