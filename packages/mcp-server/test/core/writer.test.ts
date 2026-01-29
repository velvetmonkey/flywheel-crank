/**
 * Tests for core writer utilities
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  extractHeadings,
  findSection,
  formatContent,
  insertInSection,
  validatePath,
  readVaultFile,
  writeVaultFile,
  isEmptyPlaceholder,
} from '../../src/core/writer.js';
import {
  createTempVault,
  cleanupTempVault,
  createTestNote,
  readTestNote,
  createSampleNote,
  createNoteWithoutFrontmatter,
} from '../helpers/testUtils.js';

describe('extractHeadings', () => {
  it('should extract headings from markdown', () => {
    const content = `# Heading 1
Some text
## Heading 2
More text
### Heading 3
`;
    const headings = extractHeadings(content);
    expect(headings).toHaveLength(3);
    expect(headings[0]).toEqual({ level: 1, text: 'Heading 1', line: 0 });
    expect(headings[1]).toEqual({ level: 2, text: 'Heading 2', line: 2 });
    expect(headings[2]).toEqual({ level: 3, text: 'Heading 3', line: 4 });
  });

  it('should skip headings in code blocks', () => {
    const content = `# Real Heading
\`\`\`
# Fake Heading
\`\`\`
## Another Real Heading
`;
    const headings = extractHeadings(content);
    expect(headings).toHaveLength(2);
    expect(headings[0].text).toBe('Real Heading');
    expect(headings[1].text).toBe('Another Real Heading');
  });

  it('should handle empty content', () => {
    const headings = extractHeadings('');
    expect(headings).toHaveLength(0);
  });

  it('should handle code blocks with triple backticks', () => {
    const content = `# Real Heading
\`\`\`
# Fake Heading 1
\`\`\`
## Another Real Heading
\`\`\`
# Fake Heading 2
\`\`\`
### Yet Another Real Heading
`;
    const headings = extractHeadings(content);
    expect(headings).toHaveLength(3);
    expect(headings[0].text).toBe('Real Heading');
    expect(headings[1].text).toBe('Another Real Heading');
    expect(headings[2].text).toBe('Yet Another Real Heading');
  });

  it('should extract all heading levels (h1-h6)', () => {
    const content = `# H1
## H2
### H3
#### H4
##### H5
###### H6
`;
    const headings = extractHeadings(content);
    expect(headings).toHaveLength(6);
    expect(headings[0].level).toBe(1);
    expect(headings[1].level).toBe(2);
    expect(headings[2].level).toBe(3);
    expect(headings[3].level).toBe(4);
    expect(headings[4].level).toBe(5);
    expect(headings[5].level).toBe(6);
  });

  it('should handle headings with special characters', () => {
    const content = `# Heading with **bold** and *italic*
## Heading with \`code\`
### Heading with [[wikilink]]
`;
    const headings = extractHeadings(content);
    expect(headings).toHaveLength(3);
    expect(headings[0].text).toBe('Heading with **bold** and *italic*');
    expect(headings[1].text).toBe('Heading with `code`');
    expect(headings[2].text).toBe('Heading with [[wikilink]]');
  });

  it('should handle consecutive headings with no content between', () => {
    const content = `# First
## Second
### Third
## Fourth
`;
    const headings = extractHeadings(content);
    expect(headings).toHaveLength(4);
    expect(headings[0].text).toBe('First');
    expect(headings[1].text).toBe('Second');
    expect(headings[2].text).toBe('Third');
    expect(headings[3].text).toBe('Fourth');
  });
});

describe('findSection', () => {
  it('should find section by name', () => {
    const content = `# Heading 1
Content 1
## Log
Log content here
More log content
## Another Section
Other content
`;
    const section = findSection(content, 'Log');
    expect(section).not.toBeNull();
    expect(section?.name).toBe('Log');
    expect(section?.level).toBe(2);
    expect(section?.startLine).toBe(2);
    expect(section?.contentStartLine).toBe(3);
    expect(section?.endLine).toBe(4); // Line before next section
  });

  it('should be case-insensitive', () => {
    const content = `## Log
Content
`;
    const section1 = findSection(content, 'log');
    const section2 = findSection(content, 'LOG');
    const section3 = findSection(content, 'Log');
    expect(section1).not.toBeNull();
    expect(section2).not.toBeNull();
    expect(section3).not.toBeNull();
  });

  it('should handle section names with or without # prefix', () => {
    const content = `## Log
Content
`;
    const section1 = findSection(content, 'Log');
    const section2 = findSection(content, '## Log');
    expect(section1).toEqual(section2);
  });

  it('should return null for non-existent section', () => {
    const content = `## Log
Content
`;
    const section = findSection(content, 'NonExistent');
    expect(section).toBeNull();
  });

  it('should handle section at end of file', () => {
    const content = `# Heading 1
## Last Section
Final content
No more headings after this`;
    const section = findSection(content, 'Last Section');
    expect(section).not.toBeNull();
    expect(section?.endLine).toBe(3);
  });

  it('should handle deeply nested sections (h4/h5/h6)', () => {
    const content = `# H1
## H2
### H3
#### H4
Content in H4
##### H5
Content in H5
###### H6
Content in H6
`;
    const h4Section = findSection(content, 'H4');
    const h5Section = findSection(content, 'H5');
    const h6Section = findSection(content, 'H6');

    expect(h4Section).not.toBeNull();
    expect(h4Section?.level).toBe(4);
    expect(h5Section).not.toBeNull();
    expect(h5Section?.level).toBe(5);
    expect(h6Section).not.toBeNull();
    expect(h6Section?.level).toBe(6);
  });

  it('should handle duplicate section names at different levels', () => {
    const content = `# Notes
## Notes
Content in H2
### Notes
Content in H3
`;
    // Should find the first occurrence
    const section = findSection(content, 'Notes');
    expect(section).not.toBeNull();
    expect(section?.level).toBe(1);
    expect(section?.startLine).toBe(0);
  });

  it('should reject partial matches', () => {
    const content = `## Logging
## Log Entry
`;
    const section = findSection(content, 'Log');
    expect(section).toBeNull();
  });

  it('should handle section with only whitespace content', () => {
    const content = `## Empty Section


## Next Section
`;
    const section = findSection(content, 'Empty Section');
    expect(section).not.toBeNull();
    expect(section?.contentStartLine).toBe(1);
    expect(section?.endLine).toBe(2);
  });
});

describe('formatContent', () => {
  it('should format as plain', () => {
    const result = formatContent('Hello world', 'plain');
    expect(result).toBe('Hello world');
  });

  it('should format as bullet', () => {
    const result = formatContent('Hello world', 'bullet');
    expect(result).toBe('- Hello world');
  });

  it('should format as task', () => {
    const result = formatContent('Hello world', 'task');
    expect(result).toBe('- [ ] Hello world');
  });

  it('should format as numbered', () => {
    const result = formatContent('Hello world', 'numbered');
    expect(result).toBe('1. Hello world');
  });

  it('should format as timestamp-bullet', () => {
    const result = formatContent('Hello world', 'timestamp-bullet');
    expect(result).toMatch(/^- \*\*\d{2}:\d{2}\*\* Hello world$/);
  });

  it('should trim whitespace', () => {
    const result = formatContent('  Hello world  ', 'plain');
    expect(result).toBe('Hello world');
  });
});

describe('insertInSection', () => {
  it('should append content to section', () => {
    const content = `## Log
Existing entry
## Next Section
`;
    const section = findSection(content, 'Log');
    const result = insertInSection(content, section!, 'New entry', 'append');
    expect(result).toContain('Existing entry\nNew entry\n## Next Section');
  });

  it('should prepend content to section', () => {
    const content = `## Log
Existing entry
## Next Section
`;
    const section = findSection(content, 'Log');
    const result = insertInSection(content, section!, 'New entry', 'prepend');
    expect(result).toContain('## Log\nNew entry\nExisting entry');
  });

  it('should handle empty section', () => {
    const content = `## Log
## Next Section
`;
    const section = findSection(content, 'Log');
    const result = insertInSection(content, section!, 'First entry', 'append');
    expect(result).toContain('## Log\nFirst entry\n## Next Section');
  });

  it('should handle multi-line content insertion', () => {
    const content = `## Log
Existing
## Next
`;
    const section = findSection(content, 'Log');
    const multilineContent = 'Line 1\nLine 2\nLine 3';
    const result = insertInSection(content, section!, multilineContent, 'append');
    expect(result).toContain('Existing\nLine 1\nLine 2\nLine 3\n## Next');
  });

  it('should handle content with markdown special characters', () => {
    const content = `## Log
## Next
`;
    const section = findSection(content, 'Log');
    const specialContent = '- **Bold** and *italic* with `code` and [[wikilink]]';
    const result = insertInSection(content, section!, specialContent, 'append');
    expect(result).toContain(specialContent);
  });

  it('should preserve trailing newlines when appending', () => {
    const content = `## Log
Entry

## Next
`;
    const section = findSection(content, 'Log');
    const result = insertInSection(content, section!, 'New entry', 'append');
    const lines = result.split('\n');
    // Check that the new entry is inserted before the ## Next line
    const nextSectionIndex = lines.findIndex((line) => line.includes('## Next'));
    const newEntryIndex = lines.findIndex((line) => line.includes('New entry'));
    expect(newEntryIndex).toBeLessThan(nextSectionIndex);
  });

  // Smart template handling tests
  it('should replace empty numbered placeholder when appending', () => {
    const content = `## Priorities
1.

## Next
`;
    const section = findSection(content, 'Priorities');
    const result = insertInSection(content, section!, '1. First priority', 'append');
    // Should replace "1. " with the new content, not append after it
    expect(result).toContain('## Priorities\n1. First priority\n');
    expect(result).not.toContain('1.\n1. First priority');
  });

  it('should replace empty bullet placeholder when appending', () => {
    const content = `## Notes
-

## Next
`;
    const section = findSection(content, 'Notes');
    const result = insertInSection(content, section!, '- My note', 'append');
    expect(result).toContain('## Notes\n- My note\n');
    expect(result).not.toContain('-\n- My note');
  });

  it('should replace empty task placeholder when appending', () => {
    const content = `## Tasks
- [ ]

## Next
`;
    const section = findSection(content, 'Tasks');
    const result = insertInSection(content, section!, '- [ ] New task', 'append');
    expect(result).toContain('## Tasks\n- [ ] New task\n');
    expect(result).not.toContain('- [ ]\n- [ ] New task');
  });

  it('should append normally when no placeholder exists', () => {
    const content = `## Log
Existing entry

## Next
`;
    const section = findSection(content, 'Log');
    const result = insertInSection(content, section!, 'New entry', 'append');
    expect(result).toContain('Existing entry');
    expect(result).toContain('New entry');
    // Both entries should exist
    const existingIndex = result.indexOf('Existing entry');
    const newIndex = result.indexOf('New entry');
    expect(newIndex).toBeGreaterThan(existingIndex);
  });

  it('should not replace placeholder when prepending', () => {
    const content = `## Priorities
1.

## Next
`;
    const section = findSection(content, 'Priorities');
    const result = insertInSection(content, section!, '1. First priority', 'prepend');
    // Prepend should insert at top, leaving placeholder in place
    expect(result).toContain('## Priorities\n1. First priority\n');
  });

  it('should not accumulate blank lines between multiple appends', () => {
    // Simulate what happens with gray-matter read/write cycles
    // Content often has trailing blank lines within section
    let content = `## Log
- Entry 1

## Next
`;
    let section = findSection(content, 'Log')!;

    // First append
    content = insertInSection(content, section, '- Entry 2', 'append');
    section = findSection(content, 'Log')!;

    // Second append
    content = insertInSection(content, section, '- Entry 3', 'append');

    // Entries should be adjacent - no blank lines between them
    expect(content).toContain('- Entry 1\n- Entry 2\n- Entry 3\n');
    // Should not have multiple blank lines accumulating
    expect(content).not.toMatch(/- Entry 3\n\n\n/);
  });

  it('should handle multiple appends to section with trailing whitespace', () => {
    // Content with trailing blank line inside section (common after gray-matter)
    let content = `## Log
- First

## Next
`;
    let section = findSection(content, 'Log')!;

    content = insertInSection(content, section, '- Second', 'append');
    section = findSection(content, 'Log')!;
    content = insertInSection(content, section, '- Third', 'append');
    section = findSection(content, 'Log')!;
    content = insertInSection(content, section, '- Fourth', 'append');

    // All entries should be adjacent
    expect(content).toContain('- First\n- Second\n- Third\n- Fourth\n');
  });

  it('should remove multiple trailing blank lines within section when appending', () => {
    // Section with multiple trailing blank lines before next section
    const content = `## Log
- Entry 1


## Next
`;
    const section = findSection(content, 'Log')!;
    const result = insertInSection(content, section, '- Entry 2', 'append');

    // Both blank lines should be removed, entries should be adjacent
    expect(result).toContain('- Entry 1\n- Entry 2\n## Next');
    // No blank lines between entries
    expect(result).not.toContain('- Entry 1\n\n- Entry 2');
    // No blank lines between new entry and next section
    expect(result).not.toContain('- Entry 2\n\n## Next');
  });
});

describe('isEmptyPlaceholder', () => {
  it('should detect numbered list placeholder', () => {
    expect(isEmptyPlaceholder('1. ')).toBe(true);
    expect(isEmptyPlaceholder('2. ')).toBe(true);
    expect(isEmptyPlaceholder('10. ')).toBe(true);
    expect(isEmptyPlaceholder('  1. ')).toBe(true);
  });

  it('should detect bullet placeholder', () => {
    expect(isEmptyPlaceholder('- ')).toBe(true);
    expect(isEmptyPlaceholder('  - ')).toBe(true);
    expect(isEmptyPlaceholder('* ')).toBe(true);
  });

  it('should detect task placeholder', () => {
    expect(isEmptyPlaceholder('- [ ] ')).toBe(true);
    expect(isEmptyPlaceholder('- []')).toBe(true);
    expect(isEmptyPlaceholder('- [x] ')).toBe(true);
    expect(isEmptyPlaceholder('- [X] ')).toBe(true);
  });

  it('should not detect non-empty lines as placeholders', () => {
    expect(isEmptyPlaceholder('1. Item')).toBe(false);
    expect(isEmptyPlaceholder('- Item')).toBe(false);
    expect(isEmptyPlaceholder('- [ ] Task')).toBe(false);
    expect(isEmptyPlaceholder('Some text')).toBe(false);
    expect(isEmptyPlaceholder('')).toBe(false);
    expect(isEmptyPlaceholder('## Heading')).toBe(false);
  });
});

describe('validatePath', () => {
  it('should allow valid relative paths', () => {
    const result = validatePath('/vault', 'daily-notes/2026-01-28.md');
    expect(result).toBe(true);
  });

  it('should block path traversal attempts', () => {
    const result = validatePath('/vault', '../../../etc/passwd');
    expect(result).toBe(false);
  });

  it('should block absolute paths outside vault', () => {
    const result = validatePath('/vault', '/etc/passwd');
    expect(result).toBe(false);
  });

  it('should handle encoded path characters', () => {
    const result = validatePath('/vault', 'folder%20name/file%20name.md');
    expect(result).toBe(true);
  });
});

describe('readVaultFile', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should read file with frontmatter', async () => {
    const content = createSampleNote();
    await createTestNote(tempVault, 'test.md', content);

    const result = await readVaultFile(tempVault, 'test.md');

    expect(result.frontmatter).toHaveProperty('type', 'test');
    expect(result.frontmatter).toHaveProperty('tags');
    expect(Array.isArray(result.frontmatter.tags)).toBe(true);
    expect(result.content).toContain('# Test Note');
    expect(result.content).toContain('## Log');
  });

  it('should read file without frontmatter', async () => {
    const content = createNoteWithoutFrontmatter();
    await createTestNote(tempVault, 'simple.md', content);

    const result = await readVaultFile(tempVault, 'simple.md');

    expect(Object.keys(result.frontmatter)).toHaveLength(0);
    expect(result.content).toContain('# Simple Note');
  });

  it('should handle empty frontmatter', async () => {
    const content = `---
---
# Note with empty frontmatter
`;
    await createTestNote(tempVault, 'empty-fm.md', content);

    const result = await readVaultFile(tempVault, 'empty-fm.md');

    expect(Object.keys(result.frontmatter)).toHaveLength(0);
    expect(result.content).toContain('# Note with empty frontmatter');
  });

  it('should handle complex frontmatter', async () => {
    const content = `---
simple: value
array:
  - item1
  - item2
nested:
  key1: value1
  key2: value2
  deep:
    key3: value3
---
# Complex frontmatter note
`;
    await createTestNote(tempVault, 'complex.md', content);

    const result = await readVaultFile(tempVault, 'complex.md');

    expect(result.frontmatter).toHaveProperty('simple', 'value');
    expect(result.frontmatter).toHaveProperty('array');
    expect(result.frontmatter).toHaveProperty('nested');
    expect((result.frontmatter.nested as any).deep.key3).toBe('value3');
  });

  it('should reject path traversal attempts', async () => {
    await expect(
      readVaultFile(tempVault, '../../../etc/passwd')
    ).rejects.toThrow('Invalid path');
  });

  it('should throw error for file not found', async () => {
    await expect(
      readVaultFile(tempVault, 'nonexistent.md')
    ).rejects.toThrow();
  });
});

describe('writeVaultFile', () => {
  let tempVault: string;

  beforeEach(async () => {
    tempVault = await createTempVault();
  });

  afterEach(async () => {
    await cleanupTempVault(tempVault);
  });

  it('should write file preserving frontmatter', async () => {
    const frontmatter = {
      type: 'test',
      tags: ['tag1', 'tag2'],
      nested: { key: 'value' },
    };
    const content = '# New Note\n\n## Section\n\nContent here';

    await writeVaultFile(tempVault, 'new.md', content, frontmatter);

    const written = await readTestNote(tempVault, 'new.md');
    expect(written).toContain('---');
    expect(written).toContain('type: test');
    expect(written).toContain('tags:');
    expect(written).toContain('- tag1');
    expect(written).toContain('# New Note');
  });

  it('should write to new file', async () => {
    await writeVaultFile(tempVault, 'brand-new.md', '# Brand New', {});

    const written = await readTestNote(tempVault, 'brand-new.md');
    expect(written).toContain('# Brand New');
  });

  it('should reject path traversal attempts', async () => {
    await expect(
      writeVaultFile(tempVault, '../../../etc/passwd', 'malicious', {})
    ).rejects.toThrow('Invalid path');
  });

  it('should not accumulate blank lines in section across read/write cycles', async () => {
    // This test reproduces the bug where blank lines appear between entries
    // when using vault_add_to_section multiple times
    const initialContent = `---
type: daily
---

## Log
- Entry 1

## Next Section
Content here
`;
    await createTestNote(tempVault, 'accumulation-test.md', initialContent);

    // Simulate multiple add operations (read -> modify -> write cycle)
    for (const entry of ['- Entry 2', '- Entry 3', '- Entry 4']) {
      // Read
      const { content, frontmatter } = await readVaultFile(tempVault, 'accumulation-test.md');

      // Modify
      const section = findSection(content, 'Log')!;
      const updated = insertInSection(content, section, entry, 'append');

      // Write
      await writeVaultFile(tempVault, 'accumulation-test.md', updated, frontmatter);
    }

    // Verify: entries should be adjacent with no blank lines between
    const final = await readTestNote(tempVault, 'accumulation-test.md');
    expect(final).toContain('- Entry 1\n- Entry 2\n- Entry 3\n- Entry 4\n');
    // Should not have multiple consecutive blank lines anywhere in the Log section
    expect(final).not.toMatch(/- Entry 2\n\n- Entry 3/);
    expect(final).not.toMatch(/- Entry 3\n\n- Entry 4/);
  });

  it('should preserve complex frontmatter structure', async () => {
    const complexFrontmatter = {
      array: [1, 2, 3],
      nested: {
        deep: {
          value: 'test',
        },
      },
      boolean: true,
      number: 42,
    };

    await writeVaultFile(
      tempVault,
      'complex-write.md',
      '# Content',
      complexFrontmatter
    );

    const result = await readVaultFile(tempVault, 'complex-write.md');
    expect(result.frontmatter).toHaveProperty('array');
    expect(result.frontmatter).toHaveProperty('boolean', true);
    expect(result.frontmatter).toHaveProperty('number', 42);
    expect((result.frontmatter.nested as any).deep.value).toBe('test');
  });
});
