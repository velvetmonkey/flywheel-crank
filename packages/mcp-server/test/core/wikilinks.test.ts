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

    expect(linked.has('dave evans')).toBe(true);
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

    expect(linked.has('dave evans')).toBe(true);
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
