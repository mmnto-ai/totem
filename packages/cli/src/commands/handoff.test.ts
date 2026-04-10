import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import {
  buildJournalScaffold,
  readRecentLessons,
  resolveJournalPath,
  slugFromBranch,
} from './handoff.js';

describe('readRecentLessons', () => {
  let tmpDir: string;
  const totemDir = '.totem';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-handoff-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('returns empty string when no lessons exist', () => {
    expect(readRecentLessons(tmpDir, totemDir)).toBe('');
  });

  it('returns full content when lessons are short', () => {
    const totemPath = path.join(tmpDir, totemDir);
    fs.mkdirSync(totemPath, { recursive: true });
    fs.writeFileSync(
      path.join(totemPath, 'lessons.md'),
      '## Lesson — Test\n\n**Tags:** test\n\nSome content\n',
      'utf-8',
    );
    const result = readRecentLessons(tmpDir, totemDir);
    expect(result).toContain('## Lesson — Test');
    expect(result).toContain('Some content');
  });

  it('returns content from directory lessons', () => {
    const lessonsDir = path.join(tmpDir, totemDir, 'lessons');
    fs.mkdirSync(lessonsDir, { recursive: true });
    fs.writeFileSync(
      path.join(lessonsDir, 'lesson-abc.md'),
      '## Lesson — From directory\n\n**Tags:** dir\n\nDirectory lesson content\n',
      'utf-8',
    );
    const result = readRecentLessons(tmpDir, totemDir);
    expect(result).toContain('From directory');
    expect(result).toContain('Directory lesson content');
  });

  it('truncates to last 100 lines for many lessons', () => {
    const lessonsDir = path.join(tmpDir, totemDir, 'lessons');
    fs.mkdirSync(lessonsDir, { recursive: true });
    // Generate enough lessons to exceed 100 lines (30 lessons × 5 lines each = 150 lines)
    for (let i = 0; i < 30; i++) {
      const content = `## Lesson — Lesson ${i}\n\n**Tags:** bulk\n\nContent for lesson ${i}.\n`;
      fs.writeFileSync(
        path.join(lessonsDir, `lesson-${String(i).padStart(3, '0')}.md`),
        content,
        'utf-8',
      );
    }
    const result = readRecentLessons(tmpDir, totemDir);
    // Should contain later lessons but not the earliest (truncated)
    expect(result).toContain('Lesson 29');
    expect(result).toContain('Lesson 20');
    expect(result).not.toContain('Lesson 0\n');
  });
});

// ─── slugFromBranch ───────────────────────────────────

describe('slugFromBranch', () => {
  it('returns session for main/master/HEAD', () => {
    expect(slugFromBranch('main')).toBe('session');
    expect(slugFromBranch('master')).toBe('session');
    expect(slugFromBranch('HEAD')).toBe('session');
    expect(slugFromBranch('')).toBe('session');
    expect(slugFromBranch('(unknown)')).toBe('session');
  });

  it('strips common prefixes', () => {
    expect(slugFromBranch('feat/add-logging')).toBe('add-logging');
    expect(slugFromBranch('fix/null-pointer')).toBe('null-pointer');
    expect(slugFromBranch('chore/cleanup-deps')).toBe('cleanup-deps');
    expect(slugFromBranch('hotfix/1304-sweep')).toBe('1304-sweep');
  });

  it('sanitizes special characters', () => {
    expect(slugFromBranch('feat/UPPER_case')).toBe('upper-case');
    expect(slugFromBranch('feat/dots.and.slashes')).toBe('dots-and-slashes');
  });

  it('truncates long branch names to 60 chars', () => {
    const long = 'feat/' + 'a'.repeat(100);
    const slug = slugFromBranch(long);
    expect(slug.length).toBeLessThanOrEqual(60);
  });
});

// ─── resolveJournalPath ───────────────────────────────

describe('resolveJournalPath', () => {
  it('uses --out path when specified', () => {
    const result = resolveJournalPath('/repo', '.totem', 'main', '/custom/path.md');
    expect(result).toBe('/custom/path.md');
  });

  it('builds date-slug path under .totem/journal/', () => {
    const result = resolveJournalPath('/repo', '.totem', 'feat/add-logging');
    expect(result).toMatch(/\.totem[/\\]journal[/\\]\d{4}-\d{2}-\d{2}-add-logging\.md$/);
  });

  it('uses session slug for main branch', () => {
    const result = resolveJournalPath('/repo', '.totem', 'main');
    expect(result).toMatch(/\.totem[/\\]journal[/\\]\d{4}-\d{2}-\d{2}-session\.md$/);
  });
});

// ─── buildJournalScaffold ─────────────────────────────

describe('buildJournalScaffold', () => {
  it('includes human-editable sections at the top', () => {
    const output = buildJournalScaffold('main', '', '', 'abc1234 initial commit', '');
    expect(output).toContain('## What Shipped');
    expect(output).toContain('## Architectural Decisions');
    expect(output).toContain('## Open Tickets');
    expect(output).toContain('## Next Steps');
  });

  it('includes deterministic git state below the separator', () => {
    const output = buildJournalScaffold(
      'feat/test',
      ' M src/app.ts',
      ' src/app.ts | 5 ++---',
      'def5678 second commit',
      '',
    );
    expect(output).toContain('feat/test; dirty working tree');
    expect(output).toContain('M src/app.ts');
    expect(output).toContain('5 ++---');
    expect(output).toContain('def5678 second commit');
  });

  it('shows clean working tree when status is empty', () => {
    const output = buildJournalScaffold('main', '', '', '', '');
    expect(output).toContain('clean working tree');
    expect(output).toContain('Working tree is clean.');
    expect(output).toContain('No commits found.');
    expect(output).toContain('No lessons file found.');
  });

  it('strips ANSI escape sequences from git output', () => {
    const output = buildJournalScaffold(
      '\x1b[32mmain\x1b[0m',
      ' \x1b[31mM\x1b[0m src/app.ts',
      ' src/app.ts | 5 \x1b[32m++\x1b[31m---\x1b[0m',
      '\x1b[33mabc1234\x1b[0m initial commit',
      '',
    );
    expect(output).not.toContain('\x1b[');
    expect(output).toContain('main');
    expect(output).toContain('abc1234 initial commit');
  });

  it('includes lesson line count when lessons exist', () => {
    const output = buildJournalScaffold('main', '', '', '', 'Line 1\nLine 2\nLine 3');
    expect(output).toContain('3 lines in lessons file');
  });

  it('includes date in the title heading', () => {
    const output = buildJournalScaffold('feat/test', '', '', '', '');
    // Should start with # YYYY-MM-DD — feat/test
    expect(output).toMatch(/^# \d{4}-\d{2}-\d{2} — feat\/test/);
  });
});
