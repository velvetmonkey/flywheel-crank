import { describe, it, expect } from 'vitest';
import {
  applyWikilinks,
  getSearchTerms,
  shouldExcludeEntity,
  findEntityMatches,
} from '../wikilinks';
import type { EntityWithAliases } from '../types';

describe('shouldExcludeEntity', () => {
  it('rejects day names', () => {
    expect(shouldExcludeEntity('Monday')).toBe(true);
    expect(shouldExcludeEntity('friday')).toBe(true);
  });

  it('rejects month names', () => {
    expect(shouldExcludeEntity('January')).toBe(true);
    expect(shouldExcludeEntity('december')).toBe(true);
  });

  it('rejects common stop words', () => {
    expect(shouldExcludeEntity('the')).toBe(true);
    expect(shouldExcludeEntity('with')).toBe(true);
  });

  it('accepts normal entity names', () => {
    expect(shouldExcludeEntity('TypeScript')).toBe(false);
    expect(shouldExcludeEntity('React')).toBe(false);
    expect(shouldExcludeEntity('John Smith')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(shouldExcludeEntity('MONDAY')).toBe(true);
    expect(shouldExcludeEntity('Today')).toBe(true);
  });
});

describe('getSearchTerms', () => {
  it('returns single term for string entity', () => {
    const terms = getSearchTerms('TypeScript');
    expect(terms).toEqual([{ term: 'TypeScript', entityName: 'TypeScript' }]);
  });

  it('returns name + aliases for EntityWithAliases', () => {
    const entity: EntityWithAliases = {
      name: 'TypeScript',
      path: 'technologies/TypeScript.md',
      aliases: ['TS', 'ts'],
    };
    const terms = getSearchTerms(entity);
    expect(terms).toHaveLength(3);
    expect(terms[0]).toEqual({ term: 'TypeScript', entityName: 'TypeScript' });
    expect(terms[1]).toEqual({ term: 'TS', entityName: 'TypeScript' });
    expect(terms[2]).toEqual({ term: 'ts', entityName: 'TypeScript' });
  });

  it('handles entity with no aliases', () => {
    const entity: EntityWithAliases = {
      name: 'React',
      path: 'technologies/React.md',
      aliases: [],
    };
    const terms = getSearchTerms(entity);
    expect(terms).toHaveLength(1);
    expect(terms[0]).toEqual({ term: 'React', entityName: 'React' });
  });
});

describe('findEntityMatches', () => {
  it('finds word-boundary matches', () => {
    const matches = findEntityMatches('I use React for the UI', 'React', false);
    expect(matches).toHaveLength(1);
    expect(matches[0].matched).toBe('React');
  });

  it('does not match partial words', () => {
    const matches = findEntityMatches('Reactive programming', 'React', false);
    expect(matches).toHaveLength(0);
  });

  it('respects case sensitivity toggle', () => {
    const caseSensitive = findEntityMatches('I use react', 'React', false);
    expect(caseSensitive).toHaveLength(0);

    const caseInsensitive = findEntityMatches('I use react', 'React', true);
    expect(caseInsensitive).toHaveLength(1);
  });

  it('finds multiple occurrences', () => {
    const matches = findEntityMatches('React is great. I love React.', 'React', false);
    expect(matches).toHaveLength(2);
  });

  it('does not match entities with non-word chars at boundaries (\\b limitation)', () => {
    // \b word boundary doesn't trigger after non-word chars like +
    const matches = findEntityMatches('C++ is fast', 'C++', false);
    expect(matches).toHaveLength(0);
  });

  it('returns correct start and end positions', () => {
    const matches = findEntityMatches('Hello React world', 'React', false);
    expect(matches[0].start).toBe(6);
    expect(matches[0].end).toBe(11);
  });
});

describe('applyWikilinks', () => {
  it('links a basic entity', () => {
    const result = applyWikilinks('I use React for the UI', ['React']);
    expect(result.content).toBe('I use [[React]] for the UI');
    expect(result.linksAdded).toBe(1);
    expect(result.linkedEntities).toContain('React');
  });

  it('links first occurrence only by default', () => {
    const result = applyWikilinks('React is great. I love React.', ['React']);
    expect(result.linksAdded).toBe(1);
    // first occurrence linked
    expect(result.content).toBe('[[React]] is great. I love React.');
  });

  it('links all occurrences when firstOccurrenceOnly is false', () => {
    const result = applyWikilinks('React is great. I love React.', ['React'], {
      firstOccurrenceOnly: false,
    });
    expect(result.linksAdded).toBe(2);
    expect(result.content).toBe('[[React]] is great. I love [[React]].');
  });

  it('case-insensitive match uses entity name without display text (same word)', () => {
    // "react" lowered === "React" lowered → [[React]] not [[React|react]]
    const result = applyWikilinks('I use react daily', ['React']);
    expect(result.content).toBe('I use [[React]] daily');
    expect(result.linksAdded).toBe(1);
  });

  it('uses display text when alias differs from entity name', () => {
    const entity: EntityWithAliases = {
      name: 'TypeScript',
      path: 'technologies/TypeScript.md',
      aliases: ['TS'],
    };
    const result = applyWikilinks('I write TS every day', [entity]);
    expect(result.content).toBe('I write [[TypeScript|TS]] every day');
  });

  it('resolves aliases from EntityWithAliases', () => {
    const entity: EntityWithAliases = {
      name: 'TypeScript',
      path: 'technologies/TypeScript.md',
      aliases: ['TS'],
    };
    const result = applyWikilinks('I write TS code', [entity]);
    expect(result.content).toBe('I write [[TypeScript|TS]] code');
    expect(result.linkedEntities).toContain('TypeScript');
  });

  it('prefers longer match when overlapping', () => {
    const result = applyWikilinks('I visited New York City today', [
      'New York',
      'New York City',
    ]);
    expect(result.content).toBe('I visited [[New York City]] today');
    expect(result.linksAdded).toBe(1);
  });

  it('respects frontmatter protected zone', () => {
    const content = '---\ntitle: React\n---\nI use React here';
    const result = applyWikilinks(content, ['React']);
    expect(result.linksAdded).toBe(1);
    // Only the body occurrence should be linked
    expect(result.content).toContain('---\ntitle: React\n---');
    expect(result.content).toContain('I use [[React]] here');
  });

  it('respects code block protected zone', () => {
    const content = '```\nReact code\n```\n\nReact is great';
    const result = applyWikilinks(content, ['React']);
    expect(result.linksAdded).toBe(1);
    expect(result.content).toContain('```\nReact code\n```');
    expect(result.content).toContain('[[React]] is great');
  });

  it('respects inline code protected zone', () => {
    const content = 'Use `React` for the UI. React is popular.';
    const result = applyWikilinks(content, ['React']);
    expect(result.linksAdded).toBe(1);
    expect(result.content).toContain('`React`');
    expect(result.content).toContain('[[React]] is popular');
  });

  it('respects existing wikilinks', () => {
    const content = 'I use [[React]] and React is great';
    const result = applyWikilinks(content, ['React']);
    // The existing wikilink is a protected zone, so second occurrence gets linked
    expect(result.content).toBe('I use [[React]] and [[React]] is great');
  });

  it('does not double-link already linked entities in first-occurrence mode', () => {
    const content = '[[React]] is great';
    const result = applyWikilinks(content, ['React']);
    // No new links needed; "React" only appears inside existing wikilink
    expect(result.linksAdded).toBe(0);
    expect(result.content).toBe('[[React]] is great');
  });

  it('returns empty result for empty content', () => {
    const result = applyWikilinks('', ['React']);
    expect(result.linksAdded).toBe(0);
    expect(result.content).toBe('');
  });

  it('returns empty result for no entities', () => {
    const result = applyWikilinks('Hello world', []);
    expect(result.linksAdded).toBe(0);
    expect(result.content).toBe('Hello world');
  });

  it('handles no matches gracefully', () => {
    const result = applyWikilinks('Hello world', ['React']);
    expect(result.linksAdded).toBe(0);
    expect(result.content).toBe('Hello world');
  });

  it('excludes day/month names', () => {
    const result = applyWikilinks('I work on Monday and Tuesday', ['Monday', 'Tuesday']);
    expect(result.linksAdded).toBe(0);
    expect(result.content).toBe('I work on Monday and Tuesday');
  });

  it('links multiple different entities', () => {
    const result = applyWikilinks('React and TypeScript are great', ['React', 'TypeScript']);
    expect(result.linksAdded).toBe(2);
    expect(result.content).toBe('[[React]] and [[TypeScript]] are great');
  });

  it('does not link entities with non-word boundary chars (\\b limitation)', () => {
    // C++ and C# have non-word chars so \b word boundary fails to match
    const result = applyWikilinks('I use C++ and C#', ['C++', 'C#']);
    expect(result.linksAdded).toBe(0);
  });

  it('handles alias matching case-insensitively with display text', () => {
    const entity: EntityWithAliases = {
      name: 'Model Context Protocol',
      path: 'concepts/MCP.md',
      aliases: ['MCP', 'mcp'],
    };
    const result = applyWikilinks('We use mcp for tools', [entity]);
    expect(result.content).toBe('We use [[Model Context Protocol|mcp]] for tools');
  });
});
