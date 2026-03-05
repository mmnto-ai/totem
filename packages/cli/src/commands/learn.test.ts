import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Readable, Writable } from 'node:stream';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { appendLessons, confirmLessons, parseLessons } from './learn.js';

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

// ─── appendLessons ──────────────────────────────────────

describe('appendLessons', () => {
  let tmpDir: string;
  let lessonsPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-learn-'));
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

  it('includes ISO timestamp in heading', () => {
    appendLessons([{ tags: ['test'], text: 'Timestamped.' }], lessonsPath);
    const content = fs.readFileSync(lessonsPath, 'utf-8');
    // Match ISO 8601 pattern in heading
    expect(content).toMatch(/## Lesson — \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

// ─── confirmLessons ─────────────────────────────────────

function makeInput(response: string): Readable {
  const input = new Readable({ read() {} });
  // Push response after a tick so readline can consume it
  setImmediate(() => {
    input.push(response + '\n');
    input.push(null);
  });
  return input;
}

const nullOutput = new Writable({
  write(_chunk, _enc, cb) {
    cb();
  },
});

describe('confirmLessons', () => {
  it('returns true when --yes is set', async () => {
    const result = await confirmLessons(3, { yes: true, isTTY: false });
    expect(result).toBe(true);
  });

  it('throws in non-TTY without --yes', async () => {
    await expect(confirmLessons(3, { isTTY: false })).rejects.toThrow(
      '[Totem Error] Refusing to write lessons in non-interactive mode',
    );
  });

  it('returns true when user confirms with empty input (default Y)', async () => {
    const result = await confirmLessons(2, {
      isTTY: true,
      input: makeInput(''),
      output: nullOutput,
    });
    expect(result).toBe(true);
  });

  it('returns true when user types y', async () => {
    const result = await confirmLessons(2, {
      isTTY: true,
      input: makeInput('y'),
      output: nullOutput,
    });
    expect(result).toBe(true);
  });

  it('returns false when user types n', async () => {
    const result = await confirmLessons(2, {
      isTTY: true,
      input: makeInput('n'),
      output: nullOutput,
    });
    expect(result).toBe(false);
  });

  it('returns false when user types N', async () => {
    const result = await confirmLessons(1, {
      isTTY: true,
      input: makeInput('N'),
      output: nullOutput,
    });
    expect(result).toBe(false);
  });
});
