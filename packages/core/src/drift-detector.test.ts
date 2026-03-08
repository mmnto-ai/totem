import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  detectDrift,
  extractFileReferences,
  parseLessonsFile,
  rewriteLessonsFile,
} from './drift-detector.js';

// ─── parseLessonsFile ─────────────────────────────────

describe('parseLessonsFile', () => {
  it('parses a standard lessons file with multiple entries', () => {
    const content = `# Totem Lessons

Lessons learned from PR reviews and Shield checks.

---

## Lesson — First heading

**Tags:** tag1, tag2

Body of the first lesson.

## Lesson — Second heading

**Tags:** tag3

Body of the second lesson with multiple lines.
And another line.
`;

    const lessons = parseLessonsFile(content);
    expect(lessons).toHaveLength(2);

    expect(lessons[0]!.heading).toBe('First heading');
    expect(lessons[0]!.tags).toEqual(['tag1', 'tag2']);
    expect(lessons[0]!.body).toBe('Body of the first lesson.');
    expect(lessons[0]!.index).toBe(0);

    expect(lessons[1]!.heading).toBe('Second heading');
    expect(lessons[1]!.tags).toEqual(['tag3']);
    expect(lessons[1]!.body).toContain('Body of the second lesson');
    expect(lessons[1]!.body).toContain('And another line.');
    expect(lessons[1]!.index).toBe(1);
  });

  it('handles lessons with timestamp headings', () => {
    const content = `# Totem Lessons

---

## Lesson — 2026-03-06T03:27:22.818Z

**Tags:** lancedb, trap

Some lesson body.
`;

    const lessons = parseLessonsFile(content);
    expect(lessons).toHaveLength(1);
    expect(lessons[0]!.heading).toBe('2026-03-06T03:27:22.818Z');
  });

  it('returns empty array for file with no lessons', () => {
    const content = `# Totem Lessons

Lessons learned from PR reviews.

---
`;

    const lessons = parseLessonsFile(content);
    expect(lessons).toHaveLength(0);
  });

  it('preserves raw text for reconstruction', () => {
    const content = `# Header

---

## Lesson — Test

**Tags:** a

Body text.
`;

    const lessons = parseLessonsFile(content);
    expect(lessons[0]!.raw).toContain('## Lesson — Test');
    expect(lessons[0]!.raw).toContain('Body text.');
  });
});

// ─── extractFileReferences ────────────────────────────

describe('extractFileReferences', () => {
  it('extracts backtick-wrapped file paths', () => {
    const body = 'The issue is in `packages/core/src/sync.ts` and also affects `src/utils.ts`.';
    const refs = extractFileReferences(body);
    expect(refs).toEqual(['packages/core/src/sync.ts', 'src/utils.ts']);
  });

  it('ignores non-path backtick content', () => {
    const body = 'Use `totem sync` to re-index. The `filePath` column uses `ENOBUFS` error code.';
    const refs = extractFileReferences(body);
    expect(refs).toHaveLength(0);
  });

  it('ignores URLs', () => {
    const body = 'See `https://example.com/path/file.ts` for details.';
    const refs = extractFileReferences(body);
    expect(refs).toHaveLength(0);
  });

  it('ignores glob patterns', () => {
    const body = 'Add `src/**/*.ts` to your config.';
    const refs = extractFileReferences(body);
    expect(refs).toHaveLength(0);
  });

  it('ignores npm package names', () => {
    const body = 'Import from `@mmnto/totem` package.';
    const refs = extractFileReferences(body);
    expect(refs).toHaveLength(0);
  });

  it('ignores shell commands with flags', () => {
    const body = 'Run `git diff --name-only HEAD~1` to see changes.';
    const refs = extractFileReferences(body);
    expect(refs).toHaveLength(0);
  });

  it('handles dotfile paths', () => {
    const body = 'Check `.totem/lessons.md` for existing entries.';
    const refs = extractFileReferences(body);
    expect(refs).toEqual(['.totem/lessons.md']);
  });

  it('deduplicates references', () => {
    const body = 'The file `src/index.ts` is important. Also see `src/index.ts` again.';
    const refs = extractFileReferences(body);
    expect(refs).toEqual(['src/index.ts']);
  });

  it('ignores content inside code blocks', () => {
    // Code fences use triple backticks — our regex excludes them
    const body = 'The path `src/real.ts` is referenced but ```\n`src/fake.ts`\n``` is in a block.';
    const refs = extractFileReferences(body);
    expect(refs).toContain('src/real.ts');
  });

  it('handles paths without leading directory', () => {
    const body = 'Edit `config/database.json` to add the new table.';
    const refs = extractFileReferences(body);
    expect(refs).toEqual(['config/database.json']);
  });
});

// ─── detectDrift ──────────────────────────────────────

describe('detectDrift', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-drift-'));
    // Create some files
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'index.ts'), '');
    fs.writeFileSync(path.join(tmpDir, 'src', 'utils.ts'), '');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when all references exist', () => {
    const lessons = parseLessonsFile(`# Header

---

## Lesson — Test

**Tags:** test

The file \`src/index.ts\` works fine.
`);

    const drift = detectDrift(lessons, tmpDir);
    expect(drift).toHaveLength(0);
  });

  it('detects orphaned file references', () => {
    const lessons = parseLessonsFile(`# Header

---

## Lesson — Test

**Tags:** test

The file \`src/deleted.ts\` was removed.
`);

    const drift = detectDrift(lessons, tmpDir);
    expect(drift).toHaveLength(1);
    expect(drift[0]!.orphanedRefs).toEqual(['src/deleted.ts']);
    expect(drift[0]!.lesson.heading).toBe('Test');
  });

  it('skips lessons with no file references', () => {
    const lessons = parseLessonsFile(`# Header

---

## Lesson — General advice

**Tags:** general

Always use \`const\` instead of \`let\` when possible.
`);

    const drift = detectDrift(lessons, tmpDir);
    expect(drift).toHaveLength(0);
  });

  it('reports only orphaned refs, not valid ones', () => {
    const lessons = parseLessonsFile(`# Header

---

## Lesson — Mixed

**Tags:** test

See \`src/index.ts\` (exists) and \`src/gone.ts\` (deleted).
`);

    const drift = detectDrift(lessons, tmpDir);
    expect(drift).toHaveLength(1);
    expect(drift[0]!.orphanedRefs).toEqual(['src/gone.ts']);
  });
});

// ─── rewriteLessonsFile ───────────────────────────────

describe('rewriteLessonsFile', () => {
  const SAMPLE = `# Totem Lessons

Lessons learned.

---

## Lesson — First

**Tags:** a

Body one.

## Lesson — Second

**Tags:** b

Body two.

## Lesson — Third

**Tags:** c

Body three.
`;

  it('removes specified lessons by index', () => {
    const lessons = parseLessonsFile(SAMPLE);
    const result = rewriteLessonsFile(SAMPLE, lessons, new Set([1]));

    expect(result).toContain('## Lesson — First');
    expect(result).not.toContain('## Lesson — Second');
    expect(result).toContain('## Lesson — Third');
  });

  it('removes multiple lessons', () => {
    const lessons = parseLessonsFile(SAMPLE);
    const result = rewriteLessonsFile(SAMPLE, lessons, new Set([0, 2]));

    expect(result).not.toContain('## Lesson — First');
    expect(result).toContain('## Lesson — Second');
    expect(result).not.toContain('## Lesson — Third');
  });

  it('preserves the file header', () => {
    const lessons = parseLessonsFile(SAMPLE);
    const result = rewriteLessonsFile(SAMPLE, lessons, new Set([0, 1, 2]));

    expect(result).toContain('# Totem Lessons');
    expect(result).toContain('Lessons learned.');
    expect(result).not.toContain('## Lesson —');
  });

  it('returns unchanged content when no indices to remove', () => {
    const lessons = parseLessonsFile(SAMPLE);
    const result = rewriteLessonsFile(SAMPLE, lessons, new Set());
    expect(result).toBe(SAMPLE);
  });

  it('ends with a single newline', () => {
    const lessons = parseLessonsFile(SAMPLE);
    const result = rewriteLessonsFile(SAMPLE, lessons, new Set([2]));
    expect(result.endsWith('\n')).toBe(true);
    expect(result.endsWith('\n\n')).toBe(false);
  });
});
