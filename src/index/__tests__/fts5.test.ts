import { describe, it, expect } from 'vitest';
import { escapeFts5Query, isDailyNote, shouldIndexFile } from '../fts5';

describe('escapeFts5Query', () => {
  it('escapes double quotes', () => {
    expect(escapeFts5Query('say "hello"')).toBe('say ""hello""');
  });

  it('removes special FTS5 characters', () => {
    expect(escapeFts5Query('foo(bar)')).toBe('foo bar');
    expect(escapeFts5Query('test[1]')).toBe('test 1');
    expect(escapeFts5Query('{braces}')).toBe('braces');
    expect(escapeFts5Query('caret^')).toBe('caret');
    expect(escapeFts5Query('tilde~')).toBe('tilde');
    expect(escapeFts5Query('colon:')).toBe('colon');
    expect(escapeFts5Query('dash-word')).toBe('dash word');
  });

  it('normalizes whitespace', () => {
    expect(escapeFts5Query('  foo   bar  ')).toBe('foo bar');
  });

  it('handles empty and whitespace-only input', () => {
    expect(escapeFts5Query('')).toBe('');
    expect(escapeFts5Query('   ')).toBe('');
  });

  it('handles null/undefined gracefully', () => {
    expect(escapeFts5Query(null as any)).toBe('');
    expect(escapeFts5Query(undefined as any)).toBe('');
  });

  it('passes through plain text', () => {
    expect(escapeFts5Query('hello world')).toBe('hello world');
  });

  it('handles combined special characters', () => {
    expect(escapeFts5Query('foo(bar) [baz] {qux} ^~:-')).toBe('foo bar baz qux');
  });
});

describe('isDailyNote', () => {
  it('detects date-patterned filenames', () => {
    expect(isDailyNote('2024-01-15.md')).toBe(true);
    expect(isDailyNote('daily/2024-01-15.md')).toBe(true);
    expect(isDailyNote('2024-12-31 Monday.md')).toBe(true);
  });

  it('detects periodicals directory', () => {
    expect(isDailyNote('periodicals/2024-W03.md')).toBe(true);
    expect(isDailyNote('vault/periodicals/weekly.md')).toBe(true);
  });

  it('detects daily directory', () => {
    expect(isDailyNote('daily/today.md')).toBe(true);
  });

  it('detects journal directory', () => {
    expect(isDailyNote('journal/entry.md')).toBe(true);
    expect(isDailyNote('my/journal/2024.md')).toBe(true);
  });

  it('returns false for normal notes', () => {
    expect(isDailyNote('projects/React.md')).toBe(false);
    expect(isDailyNote('notes/meeting.md')).toBe(false);
    expect(isDailyNote('concepts/TypeScript.md')).toBe(false);
  });

  it('is case-insensitive for directory names', () => {
    expect(isDailyNote('Daily/note.md')).toBe(true);
    expect(isDailyNote('JOURNAL/entry.md')).toBe(true);
    expect(isDailyNote('Periodicals/weekly.md')).toBe(true);
  });
});

describe('shouldIndexFile', () => {
  it('excludes .obsidian directory', () => {
    expect(shouldIndexFile('.obsidian/config.json')).toBe(false);
    expect(shouldIndexFile('.obsidian/plugins/my-plugin/main.js')).toBe(false);
  });

  it('excludes .trash directory', () => {
    expect(shouldIndexFile('.trash/deleted-note.md')).toBe(false);
  });

  it('excludes .git directory', () => {
    expect(shouldIndexFile('.git/config')).toBe(false);
  });

  it('excludes node_modules', () => {
    expect(shouldIndexFile('node_modules/package/index.js')).toBe(false);
  });

  it('excludes templates directory', () => {
    expect(shouldIndexFile('templates/daily.md')).toBe(false);
  });

  it('excludes .claude directory', () => {
    expect(shouldIndexFile('.claude/memory.md')).toBe(false);
  });

  it('excludes .flywheel directory', () => {
    expect(shouldIndexFile('.flywheel/state.db')).toBe(false);
  });

  it('includes normal vault files', () => {
    expect(shouldIndexFile('notes/meeting.md')).toBe(true);
    expect(shouldIndexFile('projects/React.md')).toBe(true);
    expect(shouldIndexFile('daily/2024-01-15.md')).toBe(true);
    expect(shouldIndexFile('README.md')).toBe(true);
  });

  it('excludes nested excluded directories', () => {
    expect(shouldIndexFile('some/path/.obsidian/config')).toBe(false);
    expect(shouldIndexFile('deep/nested/.git/objects/abc')).toBe(false);
  });
});
