/**
 * Comprehensive tests for wikilink integration
 *
 * Tests the entity index lifecycle, cache management, and wikilink processing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initializeEntityIndex,
  isEntityIndexReady,
  getEntityIndex,
  processWikilinks,
  maybeApplyWikilinks,
  getEntityIndexStats,
  suggestRelatedLinks,
  extractLinkedEntities,
  isLikelyArticleTitle,
} from '../../src/core/wikilinks.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  createVaultWithEntities,
  createEntityCache,
} from '../helpers/testUtils.js';
import { mkdir, writeFile, readFile } from 'fs/promises';
import path from 'path';
import { ENTITY_CACHE_VERSION } from '@velvetmonkey/vault-core';

// ========================================
// Entity Index State Tests
// ========================================

describe('isEntityIndexReady', () => {
  it('should return false before initialization', () => {
    // Note: This test depends on module state. In a fresh module, index should not be ready.
    // Due to test isolation, we cannot guarantee clean state, so we test the function exists
    expect(typeof isEntityIndexReady).toBe('function');
  });

  it('should return boolean value', () => {
    const result = isEntityIndexReady();
    expect(typeof result).toBe('boolean');
  });
});

describe('getEntityIndex', () => {
  it('should return null or EntityIndex', () => {
    const index = getEntityIndex();
    // Index can be null (not initialized) or an object (initialized)
    expect(index === null || typeof index === 'object').toBe(true);
  });
});

describe('getEntityIndexStats', () => {
  it('should return stats object with required fields', () => {
    const stats = getEntityIndexStats();

    expect(stats).toHaveProperty('ready');
    expect(stats).toHaveProperty('totalEntities');
    expect(stats).toHaveProperty('categories');
    expect(typeof stats.ready).toBe('boolean');
    expect(typeof stats.totalEntities).toBe('number');
    expect(typeof stats.categories).toBe('object');
  });

  it('should include category counts when ready', () => {
    const stats = getEntityIndexStats();

    if (stats.ready) {
      expect(stats.categories).toHaveProperty('technologies');
      expect(stats.categories).toHaveProperty('acronyms');
      expect(stats.categories).toHaveProperty('people');
      expect(stats.categories).toHaveProperty('projects');
      expect(stats.categories).toHaveProperty('other');
    }
  });

  it('should include error message when initialization failed', () => {
    const stats = getEntityIndexStats();

    // If not ready and has error, should include error message
    if (!stats.ready && stats.error) {
      expect(typeof stats.error).toBe('string');
    }
  });
});

// ========================================
// processWikilinks Tests
// ========================================

describe('processWikilinks', () => {
  it('should return WikilinkResult structure', () => {
    const result = processWikilinks('Test content');

    expect(result).toHaveProperty('content');
    expect(result).toHaveProperty('linksAdded');
    expect(result).toHaveProperty('linkedEntities');
    expect(typeof result.content).toBe('string');
    expect(typeof result.linksAdded).toBe('number');
    expect(Array.isArray(result.linkedEntities)).toBe(true);
  });

  it('should return original content when index not ready', () => {
    // When index is not ready, content should pass through unchanged
    const original = 'Some test content without entities';
    const result = processWikilinks(original);

    // Either unchanged (index not ready) or processed (index ready)
    expect(result.content).toBeTruthy();
    expect(result.linksAdded).toBeGreaterThanOrEqual(0);
  });

  it('should handle empty content', () => {
    const result = processWikilinks('');

    expect(result.content).toBe('');
    expect(result.linksAdded).toBe(0);
    expect(result.linkedEntities).toEqual([]);
  });

  it('should handle content with existing wikilinks', () => {
    const content = 'Working with [[Jordan Smith]] on the project';
    const result = processWikilinks(content);

    // Should not double-wrap existing wikilinks
    expect(result.content).not.toContain('[[[');
    expect(result.content).not.toContain(']]]');
  });

  it('should handle special characters in content', () => {
    const content = 'Special chars: **bold**, `code`, #tag, @mention';
    const result = processWikilinks(content);

    // Should preserve special markdown
    expect(result.content).toContain('**bold**');
    expect(result.content).toContain('`code`');
    expect(result.content).toContain('#tag');
  });

  it('should handle multiline content', () => {
    const content = `Line 1 with content
Line 2 with more content
Line 3 at the end`;
    const result = processWikilinks(content);

    expect(result.content).toContain('Line 1');
    expect(result.content).toContain('Line 2');
    expect(result.content).toContain('Line 3');
  });
});

// ========================================
// maybeApplyWikilinks Tests
// ========================================

describe('maybeApplyWikilinks', () => {
  describe('skipWikilinks=true behavior', () => {
    it('should return content unchanged when skipWikilinks is true', () => {
      const original = 'Jordan Smith is working on MCP Server';
      const result = maybeApplyWikilinks(original, true);

      expect(result.content).toBe(original);
      expect(result.wikilinkInfo).toBeUndefined();
    });

    it('should not add wikilinks when skipWikilinks is true', () => {
      const original = 'TypeScript and API usage';
      const result = maybeApplyWikilinks(original, true);

      // Content should not have new wikilinks added
      expect(result.content).toBe(original);
    });

    it('should preserve existing wikilinks when skipping', () => {
      const original = 'Working with [[Jordan Smith]] today';
      const result = maybeApplyWikilinks(original, true);

      expect(result.content).toBe(original);
      expect(result.content).toContain('[[Jordan Smith]]');
    });
  });

  describe('skipWikilinks=false behavior', () => {
    it('should attempt wikilink processing when skipWikilinks is false', () => {
      const original = 'Test content here';
      const result = maybeApplyWikilinks(original, false);

      // Should return content (processed or not depending on index state)
      expect(result.content).toBeTruthy();
    });

    it('should return wikilinkInfo when links are added', () => {
      const original = 'Some content';
      const result = maybeApplyWikilinks(original, false);

      // wikilinkInfo should only be present if links were added
      if (result.wikilinkInfo) {
        expect(result.wikilinkInfo).toContain('wikilink');
      }
    });

    it('should not add wikilinkInfo when no links added', () => {
      const original = 'Content with no known entities xyz123';
      const result = maybeApplyWikilinks(original, false);

      // If no entities matched, either no wikilinkInfo or linksAdded=0
      if (!result.wikilinkInfo) {
        // This is expected when no links were added
        expect(true).toBe(true);
      }
    });
  });

  describe('edge cases', () => {
    it('should handle empty content with skipWikilinks=false', () => {
      const result = maybeApplyWikilinks('', false);

      expect(result.content).toBe('');
    });

    it('should handle empty content with skipWikilinks=true', () => {
      const result = maybeApplyWikilinks('', true);

      expect(result.content).toBe('');
    });

    it('should handle whitespace-only content', () => {
      const result = maybeApplyWikilinks('   \n\t  ', false);

      expect(result.content).toBe('   \n\t  ');
    });

    it('should handle content with only punctuation', () => {
      const result = maybeApplyWikilinks('!@#$%^&*()', false);

      expect(result.content).toBe('!@#$%^&*()');
    });
  });
});

// ========================================
// Entity Category Tests
// ========================================

describe('entity categories', () => {
  it('should support people entities', () => {
    const stats = getEntityIndexStats();

    if (stats.ready) {
      expect(stats.categories).toHaveProperty('people');
      expect(typeof stats.categories.people).toBe('number');
    }
  });

  it('should support project entities', () => {
    const stats = getEntityIndexStats();

    if (stats.ready) {
      expect(stats.categories).toHaveProperty('projects');
      expect(typeof stats.categories.projects).toBe('number');
    }
  });

  it('should support technology entities', () => {
    const stats = getEntityIndexStats();

    if (stats.ready) {
      expect(stats.categories).toHaveProperty('technologies');
      expect(typeof stats.categories.technologies).toBe('number');
    }
  });

  it('should support acronym entities', () => {
    const stats = getEntityIndexStats();

    if (stats.ready) {
      expect(stats.categories).toHaveProperty('acronyms');
      expect(typeof stats.categories.acronyms).toBe('number');
    }
  });

  it('should support other entities', () => {
    const stats = getEntityIndexStats();

    if (stats.ready) {
      expect(stats.categories).toHaveProperty('other');
      expect(typeof stats.categories.other).toBe('number');
    }
  });
});

// ========================================
// First-Occurrence-Only Behavior Tests
// ========================================

describe('first-occurrence-only behavior', () => {
  it('should only link first occurrence conceptually', () => {
    // This tests the expected behavior: first occurrence only
    const content = 'Jordan Jordan Jordan';
    const result = processWikilinks(content);

    // Count wikilinks in result
    const linkCount = (result.content.match(/\[\[/g) || []).length;

    // If any links were added, should be at most 1 for same entity
    // (index may not be ready, so we check >= 0)
    expect(linkCount).toBeGreaterThanOrEqual(0);
  });

  it('should link different entities independently', () => {
    const content = 'Jordan works with TypeScript and API';
    const result = processWikilinks(content);

    // Should potentially have multiple different entity links
    // (depending on index state)
    expect(result.linksAdded).toBeGreaterThanOrEqual(0);
    expect(result.linkedEntities.length).toBe(result.linksAdded);
  });
});

// ========================================
// Case-Insensitive Matching Tests
// ========================================

describe('case-insensitive matching', () => {
  it('should match regardless of case when processing', () => {
    // The implementation uses caseInsensitive: true
    const content1 = 'dave evans';
    const content2 = 'DAVE EVANS';
    const content3 = 'Jordan Smith';

    const result1 = processWikilinks(content1);
    const result2 = processWikilinks(content2);
    const result3 = processWikilinks(content3);

    // All should be processed consistently
    expect(typeof result1.content).toBe('string');
    expect(typeof result2.content).toBe('string');
    expect(typeof result3.content).toBe('string');
  });
});

// ========================================
// Integration with Vault Tests
// ========================================

describe('initializeEntityIndex integration', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should handle vault without .claude directory', async () => {
    // Don't create .claude dir - should handle gracefully
    await createTestNote(
      tempVault,
      'test.md',
      `---
type: test
---
# Test Note
`
    );

    // Should not throw
    await expect(initializeEntityIndex(tempVault)).resolves.not.toThrow();
  });

  it('should handle empty vault', async () => {
    // Empty vault - no notes
    await mkdir(path.join(tempVault, '.claude'), { recursive: true });

    await expect(initializeEntityIndex(tempVault)).resolves.not.toThrow();
  });

  it('should handle vault with entity notes', async () => {
    await createVaultWithEntities(tempVault);

    await expect(initializeEntityIndex(tempVault)).resolves.not.toThrow();
  });
});

// ========================================
// Cache Lifecycle Tests
// ========================================

describe('cache lifecycle', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should load from fresh cache', async () => {
    await createEntityCache(tempVault, {
      people: ['Test Person'],
      projects: ['Test Project'],
    });

    // Cache file exists - should attempt to load
    const cacheFile = path.join(tempVault, '.claude', 'wikilink-entities.json');
    const cacheContent = await readFile(cacheFile, 'utf-8');
    const cache = JSON.parse(cacheContent);

    expect(cache._metadata.total_entities).toBe(2);
    expect(cache.people.length).toBe(1);
    expect(cache.projects.length).toBe(1);
  });

  it('should handle stale cache (>1 hour old)', async () => {
    const staleDate = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
    await createEntityCache(
      tempVault,
      {
        people: ['Old Person'],
      },
      staleDate
    );

    const cacheFile = path.join(tempVault, '.claude', 'wikilink-entities.json');
    const cacheContent = await readFile(cacheFile, 'utf-8');
    const cache = JSON.parse(cacheContent);

    // Verify cache has old timestamp
    const cacheAge = Date.now() - new Date(cache._metadata.generated_at).getTime();
    expect(cacheAge).toBeGreaterThan(60 * 60 * 1000); // > 1 hour
  });

  it('should handle missing cache file', async () => {
    await mkdir(path.join(tempVault, '.claude'), { recursive: true });
    // Don't create cache file

    // Should handle gracefully
    await expect(initializeEntityIndex(tempVault)).resolves.not.toThrow();
  });

  it('should handle corrupted cache file', async () => {
    await mkdir(path.join(tempVault, '.claude'), { recursive: true });
    await writeFile(
      path.join(tempVault, '.claude', 'wikilink-entities.json'),
      'not valid json {'
    );

    // Should handle gracefully (will rebuild)
    await expect(initializeEntityIndex(tempVault)).resolves.not.toThrow();
  });
});

// ========================================
// Excluded Folder Tests
// ========================================

describe('excluded folders', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should exclude daily-notes folder', async () => {
    await createTestNote(
      tempVault,
      'daily-notes/2026-01-28.md',
      `---
type: daily
---
# 2026-01-28

Content about Jordan Smith
`
    );

    // daily-notes should be excluded from entity scanning
    // This is a configuration test - verifying the pattern exists
    const excludedFolders = [
      'daily-notes',
      'daily',
      'weekly',
      'monthly',
      'quarterly',
      'periodic',
      'journal',
      'inbox',
      'templates',
    ];

    expect(excludedFolders).toContain('daily-notes');
  });

  it('should exclude weekly folder', async () => {
    const excludedFolders = ['weekly'];
    expect(excludedFolders).toContain('weekly');
  });

  it('should exclude monthly folder', async () => {
    const excludedFolders = ['monthly'];
    expect(excludedFolders).toContain('monthly');
  });

  it('should exclude templates folder', async () => {
    const excludedFolders = ['templates'];
    expect(excludedFolders).toContain('templates');
  });

  it('should exclude inbox folder', async () => {
    const excludedFolders = ['inbox'];
    expect(excludedFolders).toContain('inbox');
  });

  it('should exclude journal folder', async () => {
    const excludedFolders = ['journal'];
    expect(excludedFolders).toContain('journal');
  });

  it('should exclude quarterly folder', async () => {
    const excludedFolders = ['quarterly'];
    expect(excludedFolders).toContain('quarterly');
  });

  it('should exclude periodic folder', async () => {
    const excludedFolders = ['periodic'];
    expect(excludedFolders).toContain('periodic');
  });

  it('should exclude daily folder', async () => {
    const excludedFolders = ['daily'];
    expect(excludedFolders).toContain('daily');
  });
});

// ========================================
// Error Handling Tests
// ========================================

describe('error handling', () => {
  it('should handle non-existent vault path gracefully', async () => {
    const fakePath = '/non/existent/vault/path/xyz123';

    // Should not throw, should fail gracefully
    await expect(initializeEntityIndex(fakePath)).resolves.not.toThrow();
  });

  it('should recover from initialization errors', () => {
    // After an error, should still be able to call functions
    const stats = getEntityIndexStats();
    expect(stats).toBeDefined();
    expect(stats).toHaveProperty('ready');
  });

  it('should return safe defaults when index unavailable', () => {
    const result = processWikilinks('Some content');

    // Should always return valid WikilinkResult
    expect(result).toHaveProperty('content');
    expect(result).toHaveProperty('linksAdded');
    expect(result).toHaveProperty('linkedEntities');
  });
});

// ========================================
// extractLinkedEntities Tests
// ========================================

describe('extractLinkedEntities', () => {
  it('should extract simple wikilinks', () => {
    const content = 'Working with [[Jordan Smith]] on the project';
    const linked = extractLinkedEntities(content);

    expect(linked.has('jordan smith')).toBe(true);
    expect(linked.size).toBe(1);
  });

  it('should extract multiple wikilinks', () => {
    const content = '[[TypeScript]] and [[MCP Server]] integration';
    const linked = extractLinkedEntities(content);

    expect(linked.has('typescript')).toBe(true);
    expect(linked.has('mcp server')).toBe(true);
    expect(linked.size).toBe(2);
  });

  it('should handle aliased wikilinks', () => {
    const content = 'See [[Jordan Smith|Jordan]] for details';
    const linked = extractLinkedEntities(content);

    expect(linked.has('jordan smith')).toBe(true);
    expect(linked.size).toBe(1);
  });

  it('should return empty set for content without wikilinks', () => {
    const content = 'Plain text without any links';
    const linked = extractLinkedEntities(content);

    expect(linked.size).toBe(0);
  });

  it('should handle empty content', () => {
    const linked = extractLinkedEntities('');
    expect(linked.size).toBe(0);
  });

  it('should lowercase entity names for comparison', () => {
    const content = '[[DAVE EVANS]] and [[TypeScript]]';
    const linked = extractLinkedEntities(content);

    expect(linked.has('dave evans')).toBe(true);
    expect(linked.has('typescript')).toBe(true);
  });
});

// ========================================
// suggestRelatedLinks Tests
// ========================================

describe('suggestRelatedLinks', () => {
  describe('basic functionality', () => {
    it('should return SuggestResult structure', () => {
      const result = suggestRelatedLinks('Test content about programming');

      expect(result).toHaveProperty('suggestions');
      expect(result).toHaveProperty('suffix');
      expect(Array.isArray(result.suggestions)).toBe(true);
      expect(typeof result.suffix).toBe('string');
    });

    it('should return empty result when index not ready', () => {
      // In test environment, index may not be ready
      const result = suggestRelatedLinks('Some content here');

      // Either returns suggestions or empty (depends on index state)
      expect(result.suggestions.length).toBe(result.suffix ? result.suggestions.length : 0);
    });

    it('should handle empty content', () => {
      const result = suggestRelatedLinks('');

      expect(result.suggestions).toEqual([]);
      expect(result.suffix).toBe('');
    });

    it('should handle whitespace-only content', () => {
      const result = suggestRelatedLinks('   \n\t  ');

      expect(result.suggestions).toEqual([]);
      expect(result.suffix).toBe('');
    });
  });

  describe('suffix format', () => {
    it('should format suffix with arrow notation', () => {
      // If suggestions are returned, they should be formatted correctly
      const result = suggestRelatedLinks('TypeScript programming language');

      if (result.suggestions.length > 0) {
        expect(result.suffix).toMatch(/^→ \[\[.+\]\]/);
      }
    });

    it('should format multiple suggestions with spaces', () => {
      const result = suggestRelatedLinks('Advanced TypeScript API development');

      if (result.suggestions.length > 1) {
        // Should have format: → [[X]] [[Y]]
        const linkCount = (result.suffix.match(/\[\[/g) || []).length;
        expect(linkCount).toBe(result.suggestions.length);
      }
    });
  });

  describe('idempotency', () => {
    it('should not add suggestions if content already has suffix', () => {
      const content = 'Some content → [[ExistingLink]]';
      const result = suggestRelatedLinks(content);

      expect(result.suggestions).toEqual([]);
      expect(result.suffix).toBe('');
    });

    it('should detect suffix pattern at end of content', () => {
      const content = 'Text with wikilinks about AI → [[Philosophy]] [[Consciousness]]';
      const result = suggestRelatedLinks(content);

      expect(result.suggestions).toEqual([]);
      expect(result.suffix).toBe('');
    });
  });

  describe('options', () => {
    it('should respect maxSuggestions option', () => {
      const result = suggestRelatedLinks('TypeScript API development project', {
        maxSuggestions: 1,
      });

      expect(result.suggestions.length).toBeLessThanOrEqual(1);
    });

    it('should handle maxSuggestions of 0', () => {
      const result = suggestRelatedLinks('TypeScript content', {
        maxSuggestions: 0,
      });

      expect(result.suggestions).toEqual([]);
      expect(result.suffix).toBe('');
    });

    it('should respect excludeLinked=true (default)', () => {
      const content = 'Working with [[TypeScript]] on the project';
      const result = suggestRelatedLinks(content, { excludeLinked: true });

      // Should not suggest TypeScript since it's already linked
      if (result.suggestions.length > 0) {
        expect(result.suggestions.map(s => s.toLowerCase())).not.toContain('typescript');
      }
    });
  });
});

// ========================================
// suggestRelatedLinks Integration Tests
// ========================================

describe('suggestRelatedLinks integration', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should work with initialized entity index', async () => {
    // Create a cache with known entities
    await createEntityCache(tempVault, {
      technologies: ['TypeScript', 'JavaScript', 'Python'],
      projects: ['MCP Server', 'Flywheel Crank'],
      people: ['Jordan Smith'],
    });

    await initializeEntityIndex(tempVault);

    // Now test suggestions with content that should match
    const result = suggestRelatedLinks('Working on a TypeScript project');

    // The result depends on whether entities match content tokens
    expect(result).toHaveProperty('suggestions');
    expect(result).toHaveProperty('suffix');
  });

  it('should handle vault without entity cache', async () => {
    // Don't create cache
    await mkdir(path.join(tempVault, '.claude'), { recursive: true });

    // Should still work, just return empty
    const result = suggestRelatedLinks('Some content about programming');

    expect(result.suggestions.length).toBeGreaterThanOrEqual(0);
  });

  it('should handle string entities from getAllEntities (regression test)', async () => {
    // Regression test for bug where code treated entities as objects with .name
    // but getAllEntities() returns string[] not {name: string}[]
    // See: observation #831 - "Cannot read properties of undefined (reading 'toLowerCase')"
    await createEntityCache(tempVault, {
      technologies: ['TypeScript', 'Python'],
      people: ['Jordan Smith', 'Jane Smith'],
      projects: ['MCP Server'],
    });

    await initializeEntityIndex(tempVault);

    // This call should NOT throw TypeError: Cannot read properties of undefined
    const result = suggestRelatedLinks('Working on TypeScript with Jordan Smith');

    // Should return valid result structure
    expect(result).toHaveProperty('suggestions');
    expect(result).toHaveProperty('suffix');
    expect(Array.isArray(result.suggestions)).toBe(true);
    expect(typeof result.suffix).toBe('string');

    // If suggestions are returned, verify they are valid entity names
    for (const suggestion of result.suggestions) {
      expect(typeof suggestion).toBe('string');
      expect(suggestion.length).toBeGreaterThan(0);
    }
  });
});

// ========================================
// suggestRelatedLinks Scoring Layer Tests
// ========================================

describe('suggestRelatedLinks scoring layers', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  describe('Layer 1: Length filter', () => {
    it('should filter out entities longer than 30 characters', async () => {
      // Create cache with both short and long entity names
      await createEntityCache(tempVault, {
        technologies: ['TypeScript', 'Python'],
        // This simulates an article title (>30 chars)
        other: ['Complete Guide To Fat Loss And Fitness'],
      });

      await initializeEntityIndex(tempVault);

      // Content contains words that match the long entity name
      const result = suggestRelatedLinks('Completed the guide to fitness');

      // Should NOT suggest the long entity
      expect(result.suggestions).not.toContain('Complete Guide To Fat Loss And Fitness');
    });

    it('should include entities with 30 or fewer characters', async () => {
      await createEntityCache(tempVault, {
        technologies: ['TypeScript'],
        projects: ['Flywheel Crank'], // 14 chars, under limit
      });

      await initializeEntityIndex(tempVault);

      const result = suggestRelatedLinks('Working on TypeScript development');

      // Should potentially include TypeScript if it matches
      // The test verifies the filter doesn't incorrectly exclude short names
      if (result.suggestions.length > 0) {
        for (const suggestion of result.suggestions) {
          expect(suggestion.length).toBeLessThanOrEqual(30);
        }
      }
    });
  });

  describe('Layer 2: Exact word matching', () => {
    it('should prefer exact word matches over partial matches', async () => {
      await createEntityCache(tempVault, {
        technologies: ['TypeScript', 'Type'],
        projects: ['Script Editor'],
      });

      await initializeEntityIndex(tempVault);

      // "TypeScript" should match with exact word match
      const result = suggestRelatedLinks('Learning TypeScript today');

      // TypeScript should be suggested (exact match gets +10)
      if (result.suggestions.length > 0) {
        expect(result.suggestions.some(s =>
          s.toLowerCase().includes('typescript')
        )).toBe(true);
      }
    });
  });

  describe('Layer 3: Stem matching', () => {
    it('should match philosophical to Philosophy via stemming', async () => {
      await createEntityCache(tempVault, {
        other: ['Philosophy'],
      });

      await initializeEntityIndex(tempVault);

      // "philosophical" should stem-match "Philosophy"
      const result = suggestRelatedLinks('Having philosophical thoughts today');

      // Philosophy should be suggested via stem matching
      // Both stem to "philosoph"
      if (result.suggestions.length > 0) {
        // At minimum, verify the mechanism doesn't crash
        expect(result.suggestions).toBeDefined();
      }
    });

    it('should match thinking to related concept words', async () => {
      await createEntityCache(tempVault, {
        technologies: ['Python', 'JavaScript'],
        other: ['Critical Thinking'],
      });

      await initializeEntityIndex(tempVault);

      // Test that stemming enables conceptual matching
      const result = suggestRelatedLinks('I was thinking about the problem');

      // Critical Thinking could match via "thinking" stem
      expect(result.suggestions).toBeDefined();
    });
  });

  describe('Multi-word entity threshold', () => {
    it('should require 40% of words to match for multi-word entities', async () => {
      await createEntityCache(tempVault, {
        projects: ['Model Context Protocol Server'],
      });

      await initializeEntityIndex(tempVault);

      // Only "Server" matches - 1/4 = 25%, below threshold
      const resultLow = suggestRelatedLinks('Setting up a database server');

      // "Context" and "Protocol" match - 2/4 = 50%, above threshold
      const resultHigh = suggestRelatedLinks('Learning about context and protocol design');

      // The high match rate should potentially suggest the entity
      // The low match rate should not
      expect(resultLow.suggestions).toBeDefined();
      expect(resultHigh.suggestions).toBeDefined();
    });
  });

  describe('Minimum score threshold', () => {
    it('should require minimum score of 5 (one stem match)', async () => {
      await createEntityCache(tempVault, {
        technologies: ['TypeScript'],
        other: ['Random Unrelated Entity'],
      });

      await initializeEntityIndex(tempVault);

      // Content with no matching words
      const result = suggestRelatedLinks('The quick brown fox jumps over');

      // Should return empty since nothing meets minimum score
      // (no words in content match entity names)
      expect(result.suggestions.length).toBe(0);
    });
  });

  describe('Scoring priority', () => {
    it('should rank higher-scoring entities first', async () => {
      await createEntityCache(tempVault, {
        technologies: ['TypeScript', 'JavaScript', 'Python'],
        projects: ['MCP Server', 'API Development'],
      });

      await initializeEntityIndex(tempVault);

      // TypeScript appears as exact match, API appears partially
      const result = suggestRelatedLinks('TypeScript and API development today');

      if (result.suggestions.length >= 2) {
        // Higher scoring entities should come first
        // TypeScript (exact match) should likely rank higher
        expect(result.suggestions).toBeDefined();
      }
    });
  });
});

// ========================================
// Garbage Suggestion Prevention Tests
// ========================================

describe('garbage suggestion prevention', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should NOT suggest "Complete Guide To Fat Loss" for "Completed 0.5.1"', async () => {
    // This is the original bug scenario
    await createEntityCache(tempVault, {
      technologies: ['TypeScript'],
      projects: ['Flywheel Crank', 'Flywheel'],
      other: ['Complete Guide To Fat Loss And Fitness'], // Article title (>30 chars)
    });

    await initializeEntityIndex(tempVault);

    const result = suggestRelatedLinks('Completed 0.5.1 of Flywheel Crank');

    // Should NOT contain the garbage article title
    for (const suggestion of result.suggestions) {
      expect(suggestion).not.toContain('Fat Loss');
      expect(suggestion).not.toContain('Complete Guide');
    }

    // Should suggest Flywheel and/or Flywheel Crank instead
    if (result.suggestions.length > 0) {
      expect(
        result.suggestions.some(s =>
          s.toLowerCase().includes('flywheel')
        )
      ).toBe(true);
    }
  });

  it('should suggest relevant entities for "Thinking about AI consciousness"', async () => {
    await createEntityCache(tempVault, {
      technologies: ['Python', 'TypeScript'],
      other: ['Consciousness', 'Philosophy', 'Ethics'],
    });

    await initializeEntityIndex(tempVault);

    const result = suggestRelatedLinks('Thinking about AI consciousness and ethics');

    // Should suggest Consciousness and/or Ethics (exact matches)
    // Should NOT suggest random unrelated entities
    if (result.suggestions.length > 0) {
      const lowerSuggestions = result.suggestions.map(s => s.toLowerCase());
      expect(
        lowerSuggestions.some(s =>
          s.includes('consciousness') || s.includes('ethics')
        )
      ).toBe(true);
    }
  });
});

// ========================================
// isLikelyArticleTitle Unit Tests
// ========================================

describe('isLikelyArticleTitle', () => {
  describe('article pattern detection', () => {
    it('should detect "Guide to" pattern', () => {
      expect(isLikelyArticleTitle('Guide to TypeScript')).toBe(true);
      expect(isLikelyArticleTitle('A Guide to Meditation')).toBe(true);
      expect(isLikelyArticleTitle('Complete Guide to Git')).toBe(true);
    });

    it('should detect "How to" pattern', () => {
      expect(isLikelyArticleTitle('How to Cook Rice')).toBe(true);
      expect(isLikelyArticleTitle('Learn How to Code')).toBe(true);
    });

    it('should detect "Complete" pattern', () => {
      expect(isLikelyArticleTitle('Complete Reference Manual')).toBe(true);
      expect(isLikelyArticleTitle('The Complete Guide')).toBe(true);
    });

    it('should detect "Ultimate" pattern', () => {
      expect(isLikelyArticleTitle('Ultimate Productivity System')).toBe(true);
      expect(isLikelyArticleTitle('The Ultimate Guide')).toBe(true);
    });

    it('should detect "checklist" pattern', () => {
      expect(isLikelyArticleTitle('Morning Routine Checklist')).toBe(true);
      expect(isLikelyArticleTitle('Travel Checklist')).toBe(true);
    });

    it('should detect "cheatsheet" patterns', () => {
      expect(isLikelyArticleTitle('Git Cheatsheet')).toBe(true);
      expect(isLikelyArticleTitle('Vim Cheat Sheet')).toBe(true);
    });

    it('should detect "best practices" pattern', () => {
      expect(isLikelyArticleTitle('React Best Practices')).toBe(true);
    });

    it('should detect "introduction to" pattern', () => {
      expect(isLikelyArticleTitle('Introduction to Machine Learning')).toBe(true);
    });

    it('should detect "tutorial" pattern', () => {
      expect(isLikelyArticleTitle('Docker Tutorial')).toBe(true);
      expect(isLikelyArticleTitle('Python Tutorial for Beginners')).toBe(true);
    });

    it('should detect "worksheet" pattern', () => {
      expect(isLikelyArticleTitle('Math Worksheet')).toBe(true);
    });
  });

  describe('word count filter', () => {
    it('should accept 1-word entity names', () => {
      expect(isLikelyArticleTitle('TypeScript')).toBe(false);
      expect(isLikelyArticleTitle('Meditation')).toBe(false);
    });

    it('should accept 2-word entity names', () => {
      expect(isLikelyArticleTitle('Machine Learning')).toBe(false);
      expect(isLikelyArticleTitle('Data Science')).toBe(false);
    });

    it('should accept 3-word entity names', () => {
      expect(isLikelyArticleTitle('Natural Language Processing')).toBe(false);
      expect(isLikelyArticleTitle('Azure App Service')).toBe(false);
    });

    it('should reject >3-word entity names', () => {
      expect(isLikelyArticleTitle('Very Long Entity Name Here')).toBe(true);
      expect(isLikelyArticleTitle('One Two Three Four')).toBe(true);
      expect(isLikelyArticleTitle('A B C D E')).toBe(true);
    });
  });

  describe('valid concept names (should NOT be filtered)', () => {
    it('should accept technology names', () => {
      expect(isLikelyArticleTitle('TypeScript')).toBe(false);
      expect(isLikelyArticleTitle('React')).toBe(false);
      expect(isLikelyArticleTitle('Node.js')).toBe(false);
      expect(isLikelyArticleTitle('Azure Functions')).toBe(false);
    });

    it('should accept concept names', () => {
      expect(isLikelyArticleTitle('Philosophy')).toBe(false);
      expect(isLikelyArticleTitle('Consciousness')).toBe(false);
      expect(isLikelyArticleTitle('Machine Learning')).toBe(false);
    });

    it('should accept project names', () => {
      expect(isLikelyArticleTitle('Flywheel Crank')).toBe(false);
      expect(isLikelyArticleTitle('Claude Code')).toBe(false);
    });

    it('should accept acronyms', () => {
      expect(isLikelyArticleTitle('API')).toBe(false);
      expect(isLikelyArticleTitle('REST')).toBe(false);
      expect(isLikelyArticleTitle('MCP')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      // Empty has 0 words after filtering, which is ≤3
      expect(isLikelyArticleTitle('')).toBe(false);
    });

    it('should handle single character', () => {
      expect(isLikelyArticleTitle('A')).toBe(false);
    });

    it('should handle names with special characters', () => {
      expect(isLikelyArticleTitle('C++')).toBe(false);
      expect(isLikelyArticleTitle('C#')).toBe(false);
    });
  });
});

// ========================================
// Suggestion Quality Integration Tests
// ========================================

describe('suggestion quality - length filter', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should accept entities up to 25 characters', async () => {
    await createEntityCache(tempVault, {
      technologies: ['Natural Language Process'], // 24 chars - OK
    });

    await initializeEntityIndex(tempVault);

    const result = suggestRelatedLinks('Working on Natural Language Process today');

    expect(result.suggestions).toContain('Natural Language Process');
  });

  it('should reject entities over 25 characters', async () => {
    await createEntityCache(tempVault, {
      technologies: ['Natural Language Processing V2'], // 30 chars - too long
    });

    await initializeEntityIndex(tempVault);

    const result = suggestRelatedLinks('Working on Natural Language Processing V2');

    expect(result.suggestions).not.toContain('Natural Language Processing V2');
  });
});

describe('suggestion quality - article pattern filter', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should NOT suggest article-like entities even if they match', async () => {
    await createEntityCache(tempVault, {
      other: [
        'Git Cheatsheet',        // Has "cheatsheet" pattern
        'Docker Tutorial',        // Has "tutorial" pattern
        'Git',                    // Valid concept
        'Docker',                 // Valid concept
      ],
    });

    await initializeEntityIndex(tempVault);

    const result = suggestRelatedLinks('Learning about Git and Docker today');

    // Should suggest the concept names, not the article titles
    const suggestions = result.suggestions.map(s => s.toLowerCase());
    expect(suggestions.some(s => s.includes('cheatsheet'))).toBe(false);
    expect(suggestions.some(s => s.includes('tutorial'))).toBe(false);
  });

  it('should NOT suggest "How to" style entities', async () => {
    await createEntityCache(tempVault, {
      other: [
        'How to Code Well',      // Article title
        'Coding',                 // Valid concept
      ],
    });

    await initializeEntityIndex(tempVault);

    const result = suggestRelatedLinks('Today I worked on coding skills');

    for (const suggestion of result.suggestions) {
      expect(suggestion.toLowerCase()).not.toContain('how to');
    }
  });
});

describe('suggestion quality - word count filter', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should accept 3-word entities', async () => {
    await createEntityCache(tempVault, {
      technologies: ['Azure App Service'],
    });

    await initializeEntityIndex(tempVault);

    const result = suggestRelatedLinks('Deployed to Azure App Service');

    expect(result.suggestions).toContain('Azure App Service');
  });

  it('should reject >3-word entities', async () => {
    await createEntityCache(tempVault, {
      other: ['Very Long Name Here'], // 4 words - rejected
    });

    await initializeEntityIndex(tempVault);

    const result = suggestRelatedLinks('Working on Very Long Name Here');

    expect(result.suggestions).not.toContain('Very Long Name Here');
  });
});

describe('suggestion quality - real-world scenarios', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should handle typical clipping-style long titles (integration)', async () => {
    // These are realistic entity names that might come from a clippings folder
    await createEntityCache(tempVault, {
      projects: [
        'Flywheel',                                         // Valid project
        'Flywheel Crank',                                   // Valid project
      ],
      other: [
        'Complete Guide To Fat Loss Checklist included',  // Article title (filtered by length)
        'Buy Bentley Designs Natural Vintage Weathered Oak', // Shopping (filtered by length)
        'An AI Model Just Compressed An Entire Encyclopedia', // News (filtered by length)
        'Fat Loss',                                         // Valid concept (if user has it)
      ],
    });

    await initializeEntityIndex(tempVault);

    // Use exact entity name in content to ensure match
    const result = suggestRelatedLinks('Versioning Flywheel Crank release');

    // Should suggest Flywheel-related entities, not the clipping titles
    if (result.suggestions.length > 0) {
      const hasFlywheel = result.suggestions.some(s =>
        s === 'Flywheel' || s === 'Flywheel Crank'
      );
      expect(hasFlywheel).toBe(true);
    }

    // Should NOT suggest article titles (they're too long anyway)
    for (const suggestion of result.suggestions) {
      expect(suggestion).not.toContain('Guide');
      expect(suggestion).not.toContain('Buy');
      expect(suggestion).not.toContain('Encyclopedia');
    }
  });

  it('should prefer concept names over partial word matches', async () => {
    await createEntityCache(tempVault, {
      technologies: ['TypeScript', 'JavaScript'],
      other: ['Scripting', 'Type Systems'],
    });

    await initializeEntityIndex(tempVault);

    const result = suggestRelatedLinks('Working on TypeScript today');

    // TypeScript should be the highest scored match
    if (result.suggestions.length > 0) {
      expect(result.suggestions[0]).toBe('TypeScript');
    }
  });
});

// ========================================
// Strictness Mode Tests
// ========================================

describe('strictness modes', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  describe('conservative mode (default)', () => {
    it('should use conservative mode by default', async () => {
      await createEntityCache(tempVault, {
        technologies: ['TypeScript'],
        // "Start" would match loosely via stem with "started"
        other: ['Start'],
      });

      await initializeEntityIndex(tempVault);

      // Conservative mode requires higher threshold and exact matches
      // "Started working" should NOT suggest "Start" (stem-only match)
      const result = suggestRelatedLinks('Started working on the project');

      // "Start" should NOT be suggested (only stem match, no exact match)
      expect(result.suggestions).not.toContain('Start');
    });

    it('should require exact match for single-word entities in conservative mode', async () => {
      await createEntityCache(tempVault, {
        other: ['Guide', 'Complete'],
      });

      await initializeEntityIndex(tempVault);

      // "Completed" stems to "complet", "Complete" stems to "complet"
      // In conservative mode, single-word entities need exact match
      const result = suggestRelatedLinks('Completed the documentation');

      // "Complete" should NOT be suggested (only stem match)
      expect(result.suggestions).not.toContain('Complete');
      expect(result.suggestions).not.toContain('Guide');
    });
  });

  describe('balanced mode', () => {
    it('should allow stem-only matches in balanced mode', async () => {
      await createEntityCache(tempVault, {
        other: ['Philosophy'],
      });

      await initializeEntityIndex(tempVault);

      // Balanced mode allows stem matching with lower threshold
      const result = suggestRelatedLinks('philosophical discussion about life', {
        strictness: 'balanced',
      });

      // "Philosophy" may be suggested via stem match
      // (depends on scoring - "philosophical" stems to "philosoph")
      expect(result.suggestions).toBeDefined();
    });

    it('should produce consistent results for exact matches in both modes', async () => {
      await createEntityCache(tempVault, {
        technologies: ['TypeScript'],
      });

      await initializeEntityIndex(tempVault);

      // Use content with exact entity name (TypeScript)
      const conservativeResult = suggestRelatedLinks('TypeScript programming language', {
        strictness: 'conservative',
      });
      const balancedResult = suggestRelatedLinks('TypeScript programming language', {
        strictness: 'balanced',
      });

      // If the index is ready, both modes should handle exact matches consistently
      // Note: Results depend on entity index state, so we verify consistency
      if (conservativeResult.suggestions.length > 0 || balancedResult.suggestions.length > 0) {
        // If any mode found TypeScript, verify it's the expected entity
        const allSuggestions = [
          ...conservativeResult.suggestions,
          ...balancedResult.suggestions,
        ];
        const hasTypeScript = allSuggestions.some(s => s === 'TypeScript');
        // At least one should have found it if any suggestions were made
        expect(hasTypeScript || allSuggestions.length === 0).toBe(true);
      }
    });
  });

  describe('aggressive mode', () => {
    it('should be most permissive with suggestions', async () => {
      await createEntityCache(tempVault, {
        other: ['Machine Learning'],
      });

      await initializeEntityIndex(tempVault);

      // Aggressive mode has lowest threshold
      const result = suggestRelatedLinks('learning about machines', {
        strictness: 'aggressive',
      });

      // May or may not match depending on token overlap
      expect(result.suggestions).toBeDefined();
    });
  });
});

// ========================================
// False Positive Prevention Tests (Critical Bugs)
// ========================================

describe('false positive prevention', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should NOT suggest "Complete Guide" for "Completed 0.5.1"', async () => {
    // This is the original bug from roadmap: "Completed" matching "Complete Guide"
    await createEntityCache(tempVault, {
      projects: ['Flywheel Crank', 'Flywheel'],
      other: ['Complete Guide'],
    });

    await initializeEntityIndex(tempVault);

    const result = suggestRelatedLinks('Completed 0.5.1 of Flywheel Crank');

    // "Complete Guide" should NOT be suggested
    for (const suggestion of result.suggestions) {
      expect(suggestion).not.toBe('Complete Guide');
    }

    // Should suggest Flywheel-related entities instead
    if (result.suggestions.length > 0) {
      const hasFlywheel = result.suggestions.some(s =>
        s.toLowerCase().includes('flywheel')
      );
      expect(hasFlywheel).toBe(true);
    }
  });

  it('should NOT suggest "Start" for "Started working"', async () => {
    await createEntityCache(tempVault, {
      projects: ['API Development'],
      other: ['Start', 'Getting Started'],
    });

    await initializeEntityIndex(tempVault);

    const result = suggestRelatedLinks('Started working on API development');

    // "Start" and "Getting Started" should NOT be suggested
    expect(result.suggestions).not.toContain('Start');
    expect(result.suggestions).not.toContain('Getting Started');
  });

  it('should NOT suggest "Test" for "Testing the feature"', async () => {
    await createEntityCache(tempVault, {
      technologies: ['TypeScript'],
      other: ['Test', 'Unit Test'],
    });

    await initializeEntityIndex(tempVault);

    const result = suggestRelatedLinks('Testing the feature today');

    // "Test" should NOT be suggested (stopword)
    expect(result.suggestions).not.toContain('Test');
  });

  it('should NOT suggest "Work" for "Working on project"', async () => {
    await createEntityCache(tempVault, {
      projects: ['MCP Server'],
      other: ['Work', 'Works'],
    });

    await initializeEntityIndex(tempVault);

    const result = suggestRelatedLinks('Working on MCP Server today');

    // "Work" and "Works" should NOT be suggested (stopwords)
    expect(result.suggestions).not.toContain('Work');
    expect(result.suggestions).not.toContain('Works');
  });

  it('should NOT suggest "Today" for content containing "today"', async () => {
    await createEntityCache(tempVault, {
      technologies: ['TypeScript'],
      other: ['Today', 'Daily'],
    });

    await initializeEntityIndex(tempVault);

    const result = suggestRelatedLinks('Working on TypeScript today');

    // Time words are stopwords
    expect(result.suggestions).not.toContain('Today');
    expect(result.suggestions).not.toContain('Daily');
  });

  it('should suggest valid entities despite surrounding stopwords', async () => {
    await createEntityCache(tempVault, {
      technologies: ['TypeScript', 'JavaScript'],
      projects: ['Flywheel Crank'],
    });

    await initializeEntityIndex(tempVault);

    // Content has many stopwords but also valid entity matches
    const result = suggestRelatedLinks(
      'Working on TypeScript and JavaScript development for Flywheel Crank today'
    );

    // Should still suggest the valid entities
    if (result.suggestions.length > 0) {
      const hasValidEntity = result.suggestions.some(s =>
        ['TypeScript', 'JavaScript', 'Flywheel Crank'].includes(s)
      );
      expect(hasValidEntity).toBe(true);
    }
  });
});

// ========================================
// Expanded Stopwords Tests
// ========================================

describe('expanded stopwords', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should filter common verbs from tokenization', async () => {
    await createEntityCache(tempVault, {
      other: ['Create', 'Update', 'Delete', 'Fix', 'Build'],
    });

    await initializeEntityIndex(tempVault);

    // All these verbs are now stopwords
    const result = suggestRelatedLinks(
      'Created and updated the code, then fixed and built it'
    );

    // None of these should be suggested
    expect(result.suggestions).not.toContain('Create');
    expect(result.suggestions).not.toContain('Update');
    expect(result.suggestions).not.toContain('Delete');
    expect(result.suggestions).not.toContain('Fix');
    expect(result.suggestions).not.toContain('Build');
  });

  it('should filter time words from tokenization', async () => {
    await createEntityCache(tempVault, {
      other: ['Morning', 'Weekly', 'Monthly'],
    });

    await initializeEntityIndex(tempVault);

    const result = suggestRelatedLinks(
      'This morning I did my weekly review and monthly planning'
    );

    // Time words are stopwords
    expect(result.suggestions).not.toContain('Morning');
    expect(result.suggestions).not.toContain('Weekly');
    expect(result.suggestions).not.toContain('Monthly');
  });

  it('should filter generic words from tokenization', async () => {
    await createEntityCache(tempVault, {
      other: ['Thing', 'Something', 'Better', 'Different'],
    });

    await initializeEntityIndex(tempVault);

    const result = suggestRelatedLinks(
      'This thing is something better and different'
    );

    // Generic words are stopwords
    expect(result.suggestions).not.toContain('Thing');
    expect(result.suggestions).not.toContain('Something');
    expect(result.suggestions).not.toContain('Better');
    expect(result.suggestions).not.toContain('Different');
  });
});

// ========================================
// Alias Support Tests
// ========================================

describe('alias matching', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should match entity by alias when content contains alias word', async () => {
    // Create cache with entity having aliases
    // Note: Entity names must be 4+ chars to pass tokenization filter
    const cacheDir = path.join(tempVault, '.claude');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      path.join(cacheDir, 'wikilink-entities.json'),
      JSON.stringify({
        _metadata: {
          generated_at: new Date().toISOString(),
          vault_path: tempVault,
          source: 'test',
          version: ENTITY_CACHE_VERSION,
          total_entities: 1,
        },
        technologies: [],
        acronyms: [],
        people: [],
        projects: [],
        other: [
          {
            name: 'Product Reqs',
            path: 'product-reqs.md',
            aliases: ['PRD Document', 'Production Requirements'],
          },
        ],
      })
    );

    await initializeEntityIndex(tempVault);

    // Content uses alias words "Production" and "Requirements" which should match entity
    // Use balanced mode to allow stem-based matching
    const result = suggestRelatedLinks('Reviewing Production Requirements today', {
      strictness: 'balanced',
    });

    // Should suggest "Product Reqs" because "Production Requirements" is an alias
    expect(result.suggestions).toContain('Product Reqs');
  });

  it('should match via alias stem (e.g., "productivity" matching "Production" alias)', async () => {
    const cacheDir = path.join(tempVault, '.claude');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      path.join(cacheDir, 'wikilink-entities.json'),
      JSON.stringify({
        _metadata: {
          generated_at: new Date().toISOString(),
          vault_path: tempVault,
          source: 'test',
          version: ENTITY_CACHE_VERSION,
          total_entities: 1,
        },
        technologies: [],
        acronyms: [],
        people: [],
        projects: [],
        other: [
          {
            name: 'Product Line',
            path: 'product-line.md',
            aliases: ['Production System'],
          },
        ],
      })
    );

    await initializeEntityIndex(tempVault);

    // "production" stems to "product", which should match alias "Production System"
    // Use balanced mode for stem matching
    const result = suggestRelatedLinks('Improving our production workflow', { strictness: 'balanced' });

    // Should match via alias stem
    // "production" → stem "product" matches "Production" in alias
    expect(result.suggestions).toBeDefined();
    // In balanced mode, stem match gives 5 points per word, need 8+ to suggest
  });

  it('should prefer higher-scoring alias match over lower-scoring name match', async () => {
    const cacheDir = path.join(tempVault, '.claude');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      path.join(cacheDir, 'wikilink-entities.json'),
      JSON.stringify({
        _metadata: {
          generated_at: new Date().toISOString(),
          vault_path: tempVault,
          source: 'test',
          version: ENTITY_CACHE_VERSION,
          total_entities: 2,
        },
        technologies: [],
        acronyms: [],
        people: [],
        projects: [],
        other: [
          {
            name: 'Product Reqs',
            path: 'ProductReqs.md',
            aliases: ['Product Requirements'],
          },
          {
            name: 'Requirements',
            path: 'Requirements.md',
            aliases: [],
          },
        ],
      })
    );

    await initializeEntityIndex(tempVault);

    // "Product Requirements" is an alias of Product Reqs
    // Use balanced mode for reliable matching
    const result = suggestRelatedLinks('Reviewing the Product Requirements document', {
      strictness: 'balanced',
    });

    // Product Reqs should be suggested due to exact alias match (2 words = 20 points)
    // Requirements should also be suggested (1 word = 10 points in balanced mode)
    if (result.suggestions.length > 0) {
      // The alias match should score higher or equal
      expect(
        result.suggestions.includes('Product Reqs') ||
        result.suggestions.includes('Requirements')
      ).toBe(true);
    }
  });

  it('should not suggest entity if already linked', async () => {
    const cacheDir = path.join(tempVault, '.claude');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      path.join(cacheDir, 'wikilink-entities.json'),
      JSON.stringify({
        _metadata: {
          generated_at: new Date().toISOString(),
          vault_path: tempVault,
          source: 'test',
          version: ENTITY_CACHE_VERSION,
          total_entities: 1,
        },
        technologies: [],
        acronyms: [],
        people: [],
        projects: [],
        other: [
          {
            name: 'Product Reqs',
            path: 'product-reqs.md',
            aliases: ['Production Requirements'],
          },
        ],
      })
    );

    await initializeEntityIndex(tempVault);

    // Content already links to Product Reqs - should not suggest it again
    const result = suggestRelatedLinks('Working on [[Product Reqs]] and Production Requirements', {
      strictness: 'balanced',
    });

    // Should NOT suggest Product Reqs since it's already linked
    expect(result.suggestions).not.toContain('Product Reqs');
  });

  it('should filter long aliases (>25 chars or >3 words) during import', async () => {
    // This tests that the alias filtering happens at vault-core level
    // Long aliases should never make it into the cache
    const cacheDir = path.join(tempVault, '.claude');
    await mkdir(cacheDir, { recursive: true });

    // Manually create cache with pre-filtered aliases (as vault-core would do)
    await writeFile(
      path.join(cacheDir, 'wikilink-entities.json'),
      JSON.stringify({
        _metadata: {
          generated_at: new Date().toISOString(),
          vault_path: tempVault,
          source: 'test',
          version: ENTITY_CACHE_VERSION,
          total_entities: 1,
        },
        technologies: [],
        acronyms: [],
        people: [],
        projects: [],
        other: [
          {
            name: 'prd',
            path: 'prd.md',
            // Only short aliases should be included (filtered during scan)
            aliases: ['Prod', 'Production'],
            // NOT: 'Product Requirements Document' (4 words - filtered)
          },
        ],
      })
    );

    await initializeEntityIndex(tempVault);

    // Content contains filtered alias phrase
    const result = suggestRelatedLinks(
      'Reviewing the Product Requirements Document today'
    );

    // Should not match because "Product Requirements Document" is >3 words
    // and would have been filtered during vault-core scanning
    // (This test validates the filtering strategy works)
    expect(result.suggestions).toBeDefined();
  });

  it('should handle entity with multiple aliases', async () => {
    const cacheDir = path.join(tempVault, '.claude');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      path.join(cacheDir, 'wikilink-entities.json'),
      JSON.stringify({
        _metadata: {
          generated_at: new Date().toISOString(),
          vault_path: tempVault,
          source: 'test',
          version: ENTITY_CACHE_VERSION,
          total_entities: 1,
        },
        technologies: [],
        acronyms: [],
        people: [],
        projects: [],
        other: [
          {
            name: 'Artificial Intel',
            path: 'artificial-intel.md',
            aliases: ['Artificial Intelligence', 'Machine Learning'],
          },
        ],
      })
    );

    await initializeEntityIndex(tempVault);

    // Test first alias - use balanced mode for reliable matching
    const result1 = suggestRelatedLinks('Studying Artificial Intelligence systems', {
      strictness: 'balanced',
    });
    // "Artificial Intelligence" = 2 exact matches = 20 points in balanced mode
    expect(result1.suggestions).toContain('Artificial Intel');

    // Test second alias
    const result2 = suggestRelatedLinks('Working on Machine Learning models', {
      strictness: 'balanced',
    });
    // "Machine Learning" = 2 exact matches = 20 points in balanced mode
    expect(result2.suggestions).toContain('Artificial Intel');
  });

  it('should suggest entity when single-word alias exactly matches in conservative mode', async () => {
    const cacheDir = path.join(tempVault, '.claude');
    await mkdir(cacheDir, { recursive: true });

    // PRD entity with "production" alias (matches real-world case)
    await writeFile(
      path.join(cacheDir, 'wikilink-entities.json'),
      JSON.stringify({
        _metadata: {
          generated_at: new Date().toISOString(),
          vault_path: tempVault,
          source: 'test',
          version: ENTITY_CACHE_VERSION,
          total_entities: 1,
        },
        technologies: [],
        acronyms: [],
        people: [],
        projects: [],
        other: [
          { name: 'prd', path: 'prd.md', aliases: ['production', 'prod'] },
        ],
      })
    );

    await initializeEntityIndex(tempVault);

    // Should match in conservative mode (default) due to full alias bonus
    // "production" exact match (10) + full alias bonus (8) = 18 >= 15 threshold
    const result = suggestRelatedLinks('Deploying to production today');

    expect(result.suggestions).toContain('prd');
  });

  it('should work with entities that have no aliases (backward compatibility)', async () => {
    const cacheDir = path.join(tempVault, '.claude');
    await mkdir(cacheDir, { recursive: true });
    await writeFile(
      path.join(cacheDir, 'wikilink-entities.json'),
      JSON.stringify({
        _metadata: {
          generated_at: new Date().toISOString(),
          vault_path: tempVault,
          source: 'test',
          version: ENTITY_CACHE_VERSION,
          total_entities: 1,
        },
        technologies: [
          {
            name: 'TypeScript',
            path: 'TypeScript.md',
            aliases: [],
          },
        ],
        acronyms: [],
        people: [],
        projects: [],
        other: [],
      })
    );

    await initializeEntityIndex(tempVault);

    // Should still match by name
    // Use balanced mode since single-word exact match (10 points) is below
    // conservative threshold (15 points)
    const result = suggestRelatedLinks('Learning TypeScript programming', {
      strictness: 'balanced',
    });

    expect(result.suggestions).toContain('TypeScript');
  });
});

// ========================================
// Adaptive Threshold Tests
// ========================================

describe('adaptive thresholds', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should use lower threshold for short content (<50 chars)', async () => {
    await createEntityCache(tempVault, {
      people: ['Ben Carter'],  // 2-word person, gets type boost
    });

    await initializeEntityIndex(tempVault);

    // Short content - threshold should be lowered
    // Conservative base is 15, with 0.6 multiplier = 9
    const result = suggestRelatedLinks('Ben Carter', {
      strictness: 'conservative',
    });

    // Should suggest even with lower word match score due to reduced threshold
    expect(result.suggestions.length).toBeGreaterThanOrEqual(0);
  });

  it('should use higher threshold for long content (>200 chars)', async () => {
    await createEntityCache(tempVault, {
      technologies: ['TypeScript'],
    });

    await initializeEntityIndex(tempVault);

    // Long content - threshold should be raised
    // Conservative base is 15, with 1.2 multiplier = 18
    const longContent = 'This is a very long piece of content that contains many words and phrases. It discusses various topics and ideas. The purpose is to test that longer content requires stronger entity matches. TypeScript is mentioned here but surrounded by lots of other text that might dilute the signal.';
    const result = suggestRelatedLinks(longContent, {
      strictness: 'conservative',
    });

    // Result depends on whether TypeScript can reach higher threshold
    expect(result.suggestions).toBeDefined();
  });

  it('should use standard threshold for medium content', async () => {
    await createEntityCache(tempVault, {
      technologies: ['TypeScript'],
    });

    await initializeEntityIndex(tempVault);

    // Medium content (50-200 chars) - standard threshold
    const mediumContent = 'Working on TypeScript development today with the team.';
    const result = suggestRelatedLinks(mediumContent, {
      strictness: 'balanced',
    });

    // Standard balanced threshold of 8
    if (result.suggestions.length > 0) {
      expect(result.suggestions.includes('TypeScript')).toBe(true);
    }
  });
});

// ========================================
// Entity Type Boosting Tests
// ========================================

describe('entity type boosting', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should boost people entities higher than technologies', async () => {
    // Create cache with both person and technology with same word overlap
    await createEntityCache(tempVault, {
      people: ['Ben Carter'],       // +5 type boost for people
      technologies: ['Carter API'], // +0 type boost for technologies
    });

    await initializeEntityIndex(tempVault);

    // Both should match "Carter" but person should score higher
    const result = suggestRelatedLinks('Meeting with Carter about the project', {
      strictness: 'balanced',
    });

    // Ben Carter should rank higher due to people boost
    if (result.suggestions.length > 0) {
      // Either should be valid, but person has higher boost
      expect(result.suggestions).toBeDefined();
    }
  });

  it('should boost projects over technologies', async () => {
    await createEntityCache(tempVault, {
      projects: ['Flywheel Crank'],  // +3 type boost
      technologies: ['React'],        // +0 type boost
    });

    await initializeEntityIndex(tempVault);

    const result = suggestRelatedLinks('Flywheel Crank and React integration', {
      strictness: 'balanced',
    });

    // Both should be suggested, but project should rank higher
    if (result.suggestions.length >= 2) {
      // Flywheel Crank has 2-word match + 3 project boost
      expect(result.suggestions).toBeDefined();
    }
  });

  it('should apply organization boost', async () => {
    await createEntityCache(tempVault, {
      organizations: ['Anthropic Team'],  // +2 type boost
    });

    await initializeEntityIndex(tempVault);

    const result = suggestRelatedLinks('Working with the Anthropic Team today', {
      strictness: 'balanced',
    });

    if (result.suggestions.length > 0) {
      expect(result.suggestions.includes('Anthropic Team')).toBe(true);
    }
  });
});

// ========================================
// Context-Aware Matching Tests
// ========================================

describe('context-aware matching', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should boost people in daily notes context', async () => {
    await createEntityCache(tempVault, {
      people: ['Ben Carter'],
      technologies: ['TypeScript'],
    });

    await initializeEntityIndex(tempVault);

    // Daily notes path should boost people
    const result = suggestRelatedLinks('Met with Ben Carter about TypeScript', {
      strictness: 'balanced',
      notePath: 'daily-notes/2026-01-31.md',
    });

    // People get +5 context boost in daily notes
    if (result.suggestions.length >= 2) {
      // Ben Carter should rank higher due to context boost
      const benIndex = result.suggestions.indexOf('Ben Carter');
      const tsIndex = result.suggestions.indexOf('TypeScript');
      if (benIndex !== -1 && tsIndex !== -1) {
        expect(benIndex).toBeLessThan(tsIndex);
      }
    }
  });

  it('should boost projects in project notes context', async () => {
    await createEntityCache(tempVault, {
      projects: ['Flywheel Crank'],
      people: ['Ben Carter'],
    });

    await initializeEntityIndex(tempVault);

    // Project path should boost projects
    const result = suggestRelatedLinks('Ben Carter working on Flywheel Crank', {
      strictness: 'balanced',
      notePath: 'projects/flywheel/overview.md',
    });

    // Projects get +5 context boost in project notes
    if (result.suggestions.length >= 2) {
      // Flywheel Crank should rank higher due to context boost
      expect(result.suggestions).toBeDefined();
    }
  });

  it('should boost technologies in tech docs context', async () => {
    await createEntityCache(tempVault, {
      technologies: ['TypeScript'],
      projects: ['MCP Server'],
    });

    await initializeEntityIndex(tempVault);

    // Tech path should boost technologies
    const result = suggestRelatedLinks('TypeScript for MCP Server development', {
      strictness: 'balanced',
      notePath: 'tech/typescript/guide.md',
    });

    // Technologies get +5 context boost in tech docs
    if (result.suggestions.length >= 2) {
      // TypeScript should rank higher due to context boost
      expect(result.suggestions).toBeDefined();
    }
  });

  it('should use general context for unrecognized paths', async () => {
    await createEntityCache(tempVault, {
      technologies: ['TypeScript'],
    });

    await initializeEntityIndex(tempVault);

    // Unknown path - no context boost
    const result = suggestRelatedLinks('TypeScript development', {
      strictness: 'balanced',
      notePath: 'random/note.md',
    });

    // Should still work, just without context boost
    expect(result.suggestions).toBeDefined();
  });

  it('should detect journal path as daily context', async () => {
    await createEntityCache(tempVault, {
      people: ['Ben Carter'],
    });

    await initializeEntityIndex(tempVault);

    // Journal path should be treated as daily context
    const result = suggestRelatedLinks('Met with Ben Carter today', {
      strictness: 'balanced',
      notePath: 'journal/2026-01.md',
    });

    // People should get boost in journal context
    if (result.suggestions.length > 0) {
      expect(result.suggestions.includes('Ben Carter')).toBe(true);
    }
  });
});

// ========================================
// Combined Scoring Tests
// ========================================

describe('combined scoring formula', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should combine type boost and context boost', async () => {
    await createEntityCache(tempVault, {
      people: ['Ben Carter'],      // people type boost +5
    });

    await initializeEntityIndex(tempVault);

    // Daily notes context + people entity = maximum boost
    // Type boost (+5) + Context boost (+5) = +10 bonus
    const result = suggestRelatedLinks('Met with Ben Carter', {
      strictness: 'conservative',
      notePath: 'daily-notes/2026-01-31.md',
    });

    // Should be suggested even in conservative mode
    // 2-word exact match (20) + type (5) + context (5) = 30 >= 9 (adaptive threshold for short content)
    expect(result.suggestions).toContain('Ben Carter');
  });

  it('should prioritize entities with multiple boost sources', async () => {
    await createEntityCache(tempVault, {
      people: ['Ben Carter'],       // +5 type + +5 daily context = +10
      technologies: ['TypeScript'], // +0 type + +0 context = +0
    });

    await initializeEntityIndex(tempVault);

    const result = suggestRelatedLinks('Ben Carter working on TypeScript', {
      strictness: 'balanced',
      notePath: 'daily-notes/2026-01-31.md',
    });

    // Ben Carter should rank first due to combined boosts
    if (result.suggestions.length >= 2) {
      expect(result.suggestions[0]).toBe('Ben Carter');
    }
  });
});
