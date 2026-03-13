import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildLiteHandoff, readRecentLessons } from './handoff.js';

describe('readRecentLessons', () => {
  let tmpDir: string;
  const totemDir = '.totem';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-handoff-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
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
});

// ─── buildLiteHandoff ───────────────────────────────

describe('buildLiteHandoff', () => {
  it('generates clean working tree snapshot', () => {
    const output = buildLiteHandoff(
      'main',
      '',
      '',
      'abc1234 initial commit',
      '## Lesson 1\nContent',
    );
    expect(output).toContain('main; clean working tree');
    expect(output).toContain('Working tree is clean.');
    expect(output).toContain('abc1234 initial commit');
    expect(output).toContain('lines in lessons file'); // totem-ignore
  });

  it('generates dirty working tree snapshot', () => {
    const output = buildLiteHandoff(
      'feat/test',
      ' M src/app.ts\n?? new-file.ts',
      ' src/app.ts | 5 ++---',
      'def5678 second commit\nabc1234 first commit',
      '',
    );
    expect(output).toContain('feat/test; dirty working tree');
    expect(output).toContain('M src/app.ts');
    expect(output).toContain('new-file.ts');
    expect(output).toContain('5 ++---');
    expect(output).toContain('def5678 second commit');
    expect(output).toContain('No lessons file found.');
  });

  it('handles empty commits and lessons', () => {
    const output = buildLiteHandoff('main', '', '', '', '');
    expect(output).toContain('clean working tree');
    expect(output).toContain('No commits found.');
    expect(output).toContain('No lessons file found.');
  });

  it('strips ANSI escape sequences from git output', () => {
    const output = buildLiteHandoff(
      '\x1b[32mmain\x1b[0m',
      ' \x1b[31mM\x1b[0m src/app.ts',
      ' src/app.ts | 5 \x1b[32m++\x1b[31m---\x1b[0m',
      '\x1b[33mabc1234\x1b[0m initial commit',
      '',
    );
    expect(output).not.toContain('\x1b[');
    expect(output).toContain('main; dirty working tree');
    expect(output).toContain('M src/app.ts');
    expect(output).toContain('abc1234 initial commit');
  });
});
