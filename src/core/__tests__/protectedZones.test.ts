import { describe, it, expect } from 'vitest';
import {
  findFrontmatterEnd,
  getProtectedZones,
  isInProtectedZone,
  rangeOverlapsProtectedZone,
} from '../protectedZones';

describe('findFrontmatterEnd', () => {
  it('returns 0 when no frontmatter', () => {
    expect(findFrontmatterEnd('Hello world')).toBe(0);
  });

  it('detects valid YAML frontmatter', () => {
    const content = '---\ntitle: Test\ntags: [a]\n---\nBody text';
    const end = findFrontmatterEnd(content);
    expect(end).toBeGreaterThan(0);
    expect(content.slice(end).trimStart()).toBe('Body text');
  });

  it('returns 0 for unclosed frontmatter', () => {
    const content = '---\ntitle: Test\ntags: [a]\nNo closing delimiter';
    expect(findFrontmatterEnd(content)).toBe(0);
  });

  it('returns 0 when --- is not at start', () => {
    expect(findFrontmatterEnd('Hello\n---\nfoo\n---')).toBe(0);
  });

  it('returns 0 for single line starting with ---', () => {
    expect(findFrontmatterEnd('---')).toBe(0);
  });

  it('handles frontmatter with extra whitespace on closing', () => {
    const content = '---\ntitle: X\n---  \nBody';
    // closing line trims to '---'
    const end = findFrontmatterEnd(content);
    expect(end).toBeGreaterThan(0);
  });
});

describe('getProtectedZones', () => {
  it('detects frontmatter zone', () => {
    const content = '---\ntitle: X\n---\nBody';
    const zones = getProtectedZones(content);
    const fm = zones.find(z => z.type === 'frontmatter');
    expect(fm).toBeDefined();
    expect(fm!.start).toBe(0);
  });

  it('detects fenced code blocks', () => {
    const content = 'Before\n```js\nconst x = 1;\n```\nAfter';
    const zones = getProtectedZones(content);
    const codeBlocks = zones.filter(z => z.type === 'code_block');
    expect(codeBlocks).toHaveLength(1);
    expect(content.slice(codeBlocks[0].start, codeBlocks[0].end)).toContain('const x = 1;');
  });

  it('detects inline code', () => {
    const content = 'Use `foo()` here';
    const zones = getProtectedZones(content);
    const inline = zones.filter(z => z.type === 'inline_code');
    expect(inline).toHaveLength(1);
    expect(content.slice(inline[0].start, inline[0].end)).toBe('`foo()`');
  });

  it('detects existing wikilinks', () => {
    const content = 'See [[My Note]] for details';
    const zones = getProtectedZones(content);
    const wikilinks = zones.filter(z => z.type === 'wikilink');
    expect(wikilinks).toHaveLength(1);
    expect(content.slice(wikilinks[0].start, wikilinks[0].end)).toBe('[[My Note]]');
  });

  it('detects wikilinks with display text', () => {
    const content = 'See [[Target|display text]] here';
    const zones = getProtectedZones(content);
    const wikilinks = zones.filter(z => z.type === 'wikilink');
    expect(wikilinks).toHaveLength(1);
    expect(content.slice(wikilinks[0].start, wikilinks[0].end)).toBe('[[Target|display text]]');
  });

  it('detects markdown links', () => {
    const content = 'Click [here](https://example.com) now';
    const zones = getProtectedZones(content);
    const mdLinks = zones.filter(z => z.type === 'markdown_link');
    expect(mdLinks).toHaveLength(1);
    expect(content.slice(mdLinks[0].start, mdLinks[0].end)).toBe('[here](https://example.com)');
  });

  it('detects bare URLs', () => {
    const content = 'Visit https://example.com/path today';
    const zones = getProtectedZones(content);
    const urls = zones.filter(z => z.type === 'url');
    expect(urls).toHaveLength(1);
    expect(content.slice(urls[0].start, urls[0].end)).toBe('https://example.com/path');
  });

  it('detects hashtags', () => {
    const content = 'Tagged #project-x here';
    const zones = getProtectedZones(content);
    const tags = zones.filter(z => z.type === 'hashtag');
    expect(tags).toHaveLength(1);
    expect(content.slice(tags[0].start, tags[0].end)).toBe('#project-x');
  });

  it('detects HTML tags', () => {
    const content = 'Some <div class="x">text</div> here';
    const zones = getProtectedZones(content);
    const htmlTags = zones.filter(z => z.type === 'html_tag');
    expect(htmlTags.length).toBeGreaterThanOrEqual(2);
  });

  it('detects Obsidian comments', () => {
    const content = 'Before %%hidden comment%% after';
    const zones = getProtectedZones(content);
    const comments = zones.filter(z => z.type === 'obsidian_comment');
    expect(comments).toHaveLength(1);
    expect(content.slice(comments[0].start, comments[0].end)).toBe('%%hidden comment%%');
  });

  it('detects inline math', () => {
    const content = 'The formula $x^2 + y^2$ is important';
    const zones = getProtectedZones(content);
    const math = zones.filter(z => z.type === 'math');
    expect(math).toHaveLength(1);
    expect(content.slice(math[0].start, math[0].end)).toBe('$x^2 + y^2$');
  });

  it('detects block math', () => {
    const content = 'Before\n$$\nE = mc^2\n$$\nAfter';
    const zones = getProtectedZones(content);
    const math = zones.filter(z => z.type === 'math');
    expect(math).toHaveLength(1);
    expect(content.slice(math[0].start, math[0].end)).toContain('E = mc^2');
  });

  it('detects headers', () => {
    const content = '# Title\n\nBody\n\n## Subtitle\n\nMore';
    const zones = getProtectedZones(content);
    const headers = zones.filter(z => z.type === 'header');
    expect(headers).toHaveLength(2);
  });

  it('detects callouts', () => {
    const content = '> [!note] Important\n> This is a callout';
    const zones = getProtectedZones(content);
    const callouts = zones.filter(z => z.type === 'obsidian_callout');
    expect(callouts).toHaveLength(1);
  });

  it('returns zones sorted by start position', () => {
    const content = '# Header\n\n`inline` and [[link]] and https://url.com';
    const zones = getProtectedZones(content);
    for (let i = 1; i < zones.length; i++) {
      expect(zones[i].start).toBeGreaterThanOrEqual(zones[i - 1].start);
    }
  });

  it('handles content with no protected zones', () => {
    const content = 'Just plain text with nothing special';
    const zones = getProtectedZones(content);
    expect(zones).toHaveLength(0);
  });

  it('handles empty content', () => {
    expect(getProtectedZones('')).toHaveLength(0);
  });
});

describe('isInProtectedZone', () => {
  it('returns true for position inside a zone', () => {
    const zones = getProtectedZones('Hello `code` world');
    const codeStart = 'Hello '.length;
    expect(isInProtectedZone(codeStart + 1, zones)).toBe(true);
  });

  it('returns false for position outside all zones', () => {
    const zones = getProtectedZones('Hello `code` world');
    expect(isInProtectedZone(0, zones)).toBe(false);
  });

  it('returns true at zone start (inclusive)', () => {
    const zones = [{ start: 5, end: 10, type: 'code_block' as const }];
    expect(isInProtectedZone(5, zones)).toBe(true);
  });

  it('returns false at zone end (exclusive)', () => {
    const zones = [{ start: 5, end: 10, type: 'code_block' as const }];
    expect(isInProtectedZone(10, zones)).toBe(false);
  });
});

describe('rangeOverlapsProtectedZone', () => {
  const zones = [{ start: 10, end: 20, type: 'code_block' as const }];

  it('returns true when range starts inside zone', () => {
    expect(rangeOverlapsProtectedZone(15, 25, zones)).toBe(true);
  });

  it('returns true when range ends inside zone', () => {
    expect(rangeOverlapsProtectedZone(5, 15, zones)).toBe(true);
  });

  it('returns true when range fully contains zone', () => {
    expect(rangeOverlapsProtectedZone(5, 25, zones)).toBe(true);
  });

  it('returns true when range is fully inside zone', () => {
    expect(rangeOverlapsProtectedZone(12, 18, zones)).toBe(true);
  });

  it('returns false when range is completely before zone', () => {
    expect(rangeOverlapsProtectedZone(0, 5, zones)).toBe(false);
  });

  it('returns false when range is completely after zone', () => {
    expect(rangeOverlapsProtectedZone(25, 30, zones)).toBe(false);
  });

  it('returns false when range ends exactly at zone start', () => {
    expect(rangeOverlapsProtectedZone(5, 10, zones)).toBe(false);
  });

  it('returns true when range starts exactly at zone start', () => {
    expect(rangeOverlapsProtectedZone(10, 15, zones)).toBe(true);
  });
});
