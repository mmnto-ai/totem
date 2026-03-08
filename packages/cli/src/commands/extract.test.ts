import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appendLessons, parseLessons, selectLessons } from './extract.js';

// ─── parseLessons ───────────────────────────────────────

describe('parseLessons', () => {
  it('extracts a single lesson', () => {
    const output = `---LESSON---
Tags: git, cli, trap
Always check for ENOENT separately from other errors.
---END---`;
    const lessons = parseLessons(output);
    expect(lessons).toHaveLength(1);
    expect(lessons[0]).toEqual({
      tags: ['git', 'cli', 'trap'],
      text: 'Always check for ENOENT separately from other errors.',
    });
  });

  it('extracts multiple lessons', () => {
    const output = `---LESSON---
Tags: adapter, DRY
Extract shared fetch logic into a helper immediately.
---END---

---LESSON---
Tags: security, input
Sanitize all user input before writing to files.
---END---`;
    const lessons = parseLessons(output);
    expect(lessons).toHaveLength(2);
    expect(lessons[0]!.tags).toEqual(['adapter', 'DRY']);
    expect(lessons[1]!.tags).toEqual(['security', 'input']);
  });

  it('returns empty array for NONE', () => {
    expect(parseLessons('NONE')).toEqual([]);
  });

  it('returns empty array for NONE with whitespace', () => {
    expect(parseLessons('  NONE  ')).toEqual([]);
  });

  it('handles multi-line lesson text', () => {
    const output = `---LESSON---
Tags: architecture
First line of the lesson.
Second line with more detail.
---END---`;
    const lessons = parseLessons(output);
    expect(lessons).toHaveLength(1);
    expect(lessons[0]!.text).toBe('First line of the lesson.\nSecond line with more detail.');
  });

  it('strips empty tags', () => {
    const output = `---LESSON---
Tags: git, , cli,
A lesson about git.
---END---`;
    const lessons = parseLessons(output);
    expect(lessons[0]!.tags).toEqual(['git', 'cli']);
  });

  it('skips lessons with empty text', () => {
    const output = `---LESSON---
Tags: empty
---END---`;
    const lessons = parseLessons(output);
    expect(lessons).toEqual([]);
  });
});

// sanitize tests are in utils.test.ts (sanitize now lives in utils.ts)

// ─── appendLessons ──────────────────────────────────────

describe('appendLessons', () => {
  let tmpDir: string;
  let lessonsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-extract-'));
    lessonsPath = path.join(tmpDir, '.totem', 'lessons.md');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates directory and file if they do not exist', () => {
    appendLessons([{ tags: ['test'], text: 'A test lesson.' }], lessonsPath);
    expect(fs.existsSync(lessonsPath)).toBe(true);
    const content = fs.readFileSync(lessonsPath, 'utf-8');
    expect(content).toContain('**Tags:** test');
    expect(content).toContain('A test lesson.');
  });

  it('appends to existing file', () => {
    fs.mkdirSync(path.dirname(lessonsPath), { recursive: true });
    fs.writeFileSync(lessonsPath, '# Existing content\n');

    appendLessons([{ tags: ['new'], text: 'New lesson.' }], lessonsPath);
    const content = fs.readFileSync(lessonsPath, 'utf-8');
    expect(content).toContain('# Existing content');
    expect(content).toContain('New lesson.');
  });

  it('writes multiple lessons', () => {
    appendLessons(
      [
        { tags: ['a', 'b'], text: 'First.' },
        { tags: ['c'], text: 'Second.' },
      ],
      lessonsPath,
    );
    const content = fs.readFileSync(lessonsPath, 'utf-8');
    expect(content).toContain('**Tags:** a, b');
    expect(content).toContain('First.');
    expect(content).toContain('**Tags:** c');
    expect(content).toContain('Second.');
  });

  it('uses descriptive heading derived from lesson text', () => {
    appendLessons([{ tags: ['test'], text: 'Timestamped.' }], lessonsPath);
    const content = fs.readFileSync(lessonsPath, 'utf-8');
    expect(content).toContain('## Lesson — Timestamped.');
  });
});

// ─── selectLessons ──────────────────────────────────────

const sampleLessons = [
  { tags: ['git', 'trap'], text: 'Always check ENOENT separately.' },
  { tags: ['security'], text: 'Sanitize all user input before writing.' },
  { tags: ['arch'], text: 'Extract shared fetch logic into a helper.' },
];

describe('selectLessons', () => {
  it('returns all lessons when --yes is set', async () => {
    const result = await selectLessons(sampleLessons, { yes: true, isTTY: false });
    expect(result).toEqual(sampleLessons);
  });

  it('throws in non-TTY without --yes', async () => {
    await expect(selectLessons(sampleLessons, { isTTY: false })).rejects.toThrow(
      '[Totem Error] Refusing to write lessons in non-interactive mode. Use --yes to bypass confirmation.',
    );
  });
});
