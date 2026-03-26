import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  lessonFileName,
  readAllLessons,
  writeLessonFile,
  writeLessonFileAsync,
} from './lesson-io.js';
import { cleanTmpDir } from './test-utils.js';

describe('lessonFileName', () => {
  it('generates deterministic filename from content', () => {
    const name = lessonFileName('some lesson content');
    expect(name).toMatch(/^lesson-[a-f0-9]{8}\.md$/);
  });

  it('is idempotent — same content produces same filename', () => {
    const a = lessonFileName('same content');
    const b = lessonFileName('same content');
    expect(a).toBe(b);
  });

  it('produces different filenames for different content', () => {
    const a = lessonFileName('content A');
    const b = lessonFileName('content B');
    expect(a).not.toBe(b);
  });
});

describe('writeLessonFile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-lesson-io-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('creates directory if missing and writes file', () => {
    const lessonsDir = path.join(tmpDir, 'lessons');
    const entry = '## Lesson — Test\n\n**Tags:** test\n\nTest content.\n';
    const filePath = writeLessonFile(lessonsDir, entry);

    expect(fs.existsSync(filePath)).toBe(true);
    expect(path.dirname(filePath)).toBe(lessonsDir);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('## Lesson — Test');
    expect(content).toContain('Test content.');
    expect(content.endsWith('\n')).toBe(true);
  });

  it('is idempotent — writing same content overwrites same file', () => {
    const lessonsDir = path.join(tmpDir, 'lessons');
    const entry = '## Lesson — Same\n\n**Tags:** test\n\nSame.\n';
    const path1 = writeLessonFile(lessonsDir, entry);
    const path2 = writeLessonFile(lessonsDir, entry);
    expect(path1).toBe(path2);
    const files = fs.readdirSync(lessonsDir);
    expect(files.filter((f) => f.endsWith('.md'))).toHaveLength(1);
  });

  it('truncates headings exceeding 60 characters (#690)', () => {
    const lessonsDir = path.join(tmpDir, 'lessons');
    const longHeading =
      'This is a very long lesson heading that definitely exceeds the sixty character limit we enforce';
    const entry = `## Lesson — ${longHeading}\n\n**Tags:** test\n\nBody.\n`;
    const filePath = writeLessonFile(lessonsDir, entry);
    const content = fs.readFileSync(filePath, 'utf-8');
    const headingMatch = content.match(/^## Lesson — (.+)$/m);
    expect(headingMatch).toBeTruthy();
    expect(headingMatch![1]!.length).toBeLessThanOrEqual(60);
  });

  it('preserves headings within the 60-char limit', () => {
    const lessonsDir = path.join(tmpDir, 'lessons');
    const shortHeading = 'Short heading';
    const entry = `## Lesson — ${shortHeading}\n\n**Tags:** test\n\nBody.\n`;
    const filePath = writeLessonFile(lessonsDir, entry);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain(`## Lesson — ${shortHeading}`);
  });
});

describe('writeLessonFileAsync', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-lesson-io-async-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('creates directory and writes file asynchronously', async () => {
    const lessonsDir = path.join(tmpDir, 'lessons');
    const entry = '## Lesson — Async\n\n**Tags:** async\n\nAsync content.\n';
    const filePath = await writeLessonFileAsync(lessonsDir, entry);

    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('Async content.');
  });
});

describe('readAllLessons', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-lesson-io-read-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('returns empty array when totemDir does not exist', () => {
    const lessons = readAllLessons(path.join(tmpDir, 'nonexistent'));
    expect(lessons).toEqual([]);
  });

  it('reads from legacy lessons.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'lessons.md'),
      '# Header\n\n## Lesson — Legacy\n\n**Tags:** legacy\n\nLegacy content.\n',
      'utf-8',
    );
    const lessons = readAllLessons(tmpDir);
    expect(lessons).toHaveLength(1);
    expect(lessons[0]!.heading).toBe('Legacy');
    expect(lessons[0]!.sourcePath).toBe(path.join(tmpDir, 'lessons.md'));
  });

  it('reads from lessons directory', () => {
    const lessonsDir = path.join(tmpDir, 'lessons');
    fs.mkdirSync(lessonsDir, { recursive: true });
    fs.writeFileSync(
      path.join(lessonsDir, 'lesson-abc.md'),
      '## Lesson — Dir lesson\n\n**Tags:** dir\n\nDir content.\n',
      'utf-8',
    );
    const lessons = readAllLessons(tmpDir);
    expect(lessons).toHaveLength(1);
    expect(lessons[0]!.heading).toBe('Dir lesson');
    expect(lessons[0]!.sourcePath).toBe(path.join(lessonsDir, 'lesson-abc.md'));
  });

  it('combines both sources with correct indices', () => {
    // Legacy file with 2 lessons
    fs.writeFileSync(
      path.join(tmpDir, 'lessons.md'),
      '## Lesson — L1\n\n**Tags:** a\n\nFirst.\n\n## Lesson — L2\n\n**Tags:** b\n\nSecond.\n',
      'utf-8',
    );
    // Directory with 1 lesson
    const lessonsDir = path.join(tmpDir, 'lessons');
    fs.mkdirSync(lessonsDir, { recursive: true });
    fs.writeFileSync(
      path.join(lessonsDir, 'lesson-001.md'),
      '## Lesson — D1\n\n**Tags:** c\n\nThird.\n',
      'utf-8',
    );

    const lessons = readAllLessons(tmpDir);
    expect(lessons).toHaveLength(3);
    expect(lessons[0]!.heading).toBe('L1');
    expect(lessons[0]!.index).toBe(0);
    expect(lessons[1]!.heading).toBe('L2');
    expect(lessons[1]!.index).toBe(1);
    expect(lessons[2]!.heading).toBe('D1');
    expect(lessons[2]!.index).toBe(2);
  });

  it('skips non-.md files in lessons directory', () => {
    const lessonsDir = path.join(tmpDir, 'lessons');
    fs.mkdirSync(lessonsDir, { recursive: true });
    fs.writeFileSync(path.join(lessonsDir, '.gitkeep'), '', 'utf-8');
    fs.writeFileSync(path.join(lessonsDir, 'notes.txt'), 'not a lesson', 'utf-8');
    fs.writeFileSync(
      path.join(lessonsDir, 'lesson-abc.md'),
      '## Lesson — Real\n\n**Tags:** real\n\nReal lesson.\n',
      'utf-8',
    );
    const lessons = readAllLessons(tmpDir);
    expect(lessons).toHaveLength(1);
    expect(lessons[0]!.heading).toBe('Real');
  });

  it('reads directory files in sorted order', () => {
    const lessonsDir = path.join(tmpDir, 'lessons');
    fs.mkdirSync(lessonsDir, { recursive: true });
    fs.writeFileSync(
      path.join(lessonsDir, 'lesson-zzz.md'),
      '## Lesson — Z\n\n**Tags:** z\n\nZ.\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(lessonsDir, 'lesson-aaa.md'),
      '## Lesson — A\n\n**Tags:** a\n\nA.\n',
      'utf-8',
    );
    const lessons = readAllLessons(tmpDir);
    expect(lessons[0]!.heading).toBe('A');
    expect(lessons[1]!.heading).toBe('Z');
  });
});

describe('readAllLessons — YAML frontmatter (ADR-070)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-lesson-io-yaml-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('parses YAML frontmatter from individual lesson files', () => {
    const lessonsDir = path.join(tmpDir, 'lessons');
    fs.mkdirSync(lessonsDir, { recursive: true });
    fs.writeFileSync(
      path.join(lessonsDir, 'lesson-yaml.md'),
      `---
category: security
severity: warning
tags: ["auth", "jwt"]
lifecycle: nursery
---
## Lesson — YAML lesson

Body text.
`,
      'utf-8',
    );
    const lessons = readAllLessons(tmpDir);
    expect(lessons).toHaveLength(1);
    expect(lessons[0]!.heading).toBe('YAML lesson');
    expect(lessons[0]!.frontmatter?.category).toBe('security');
    expect(lessons[0]!.frontmatter?.severity).toBe('warning');
    expect(lessons[0]!.frontmatter?.tags).toEqual(['auth', 'jwt']);
    expect(lessons[0]!.frontmatter?.lifecycle).toBe('nursery');
  });

  it('falls back to legacy parsing with frontmatter populated', () => {
    const lessonsDir = path.join(tmpDir, 'lessons');
    fs.mkdirSync(lessonsDir, { recursive: true });
    fs.writeFileSync(
      path.join(lessonsDir, 'lesson-legacy.md'),
      `## Lesson — Legacy lesson

**Tags:** foo, bar

Body text.
`,
      'utf-8',
    );
    const lessons = readAllLessons(tmpDir);
    expect(lessons).toHaveLength(1);
    expect(lessons[0]!.heading).toBe('Legacy lesson');
    expect(lessons[0]!.tags).toEqual(['foo', 'bar']);
    expect(lessons[0]!.frontmatter).toBeDefined();
    expect(lessons[0]!.frontmatter?.tags).toEqual(['foo', 'bar']);
  });

  it('YAML tags are the source of truth', () => {
    const lessonsDir = path.join(tmpDir, 'lessons');
    fs.mkdirSync(lessonsDir, { recursive: true });
    fs.writeFileSync(
      path.join(lessonsDir, 'lesson-override.md'),
      `---
tags: ["from-yaml"]
---
## Lesson — Override test

Body without inline tags.
`,
      'utf-8',
    );
    const lessons = readAllLessons(tmpDir);
    expect(lessons).toHaveLength(1);
    expect(lessons[0]!.tags).toEqual(['from-yaml']);
  });

  it('falls back to legacy parsing when YAML is invalid', () => {
    const lessonsDir = path.join(tmpDir, 'lessons');
    fs.mkdirSync(lessonsDir, { recursive: true });
    const warnings: string[] = [];
    fs.writeFileSync(
      path.join(lessonsDir, 'lesson-bad-yaml.md'),
      `---
severity: critical
---
## Lesson — Bad yaml fallback

**Tags:** fallback-tag

**Pattern:** \\beval\\(
**Engine:** regex
**Severity:** warning
`,
      'utf-8',
    );
    const lessons = readAllLessons(tmpDir, (msg) => warnings.push(msg));
    expect(lessons).toHaveLength(1);
    expect(lessons[0]!.tags).toEqual(['fallback-tag']);
    expect(lessons[0]!.frontmatter?.compilation?.engine).toBe('regex');
    expect(lessons[0]!.frontmatter?.severity).toBe('warning');
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('lesson-bad-yaml.md');
  });

  it('attaches frontmatter to legacy lessons.md entries', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'lessons.md'),
      '## Lesson — Legacy entry\n\n**Tags:** legacy\n\nLegacy body.\n',
      'utf-8',
    );
    const lessons = readAllLessons(tmpDir);
    expect(lessons).toHaveLength(1);
    expect(lessons[0]!.frontmatter).toBeDefined();
    expect(lessons[0]!.frontmatter?.tags).toEqual(['legacy']);
    expect(lessons[0]!.frontmatter?.type).toBe('trap');
  });

  it('populates frontmatter from legacy Pipeline 1 fields', () => {
    const lessonsDir = path.join(tmpDir, 'lessons');
    fs.mkdirSync(lessonsDir, { recursive: true });
    fs.writeFileSync(
      path.join(lessonsDir, 'lesson-p1.md'),
      `## Lesson — Pipeline 1 lesson

**Tags:** cli, parsing

Explanation text.

**Pattern:** \\beval\\(
**Engine:** regex
**Scope:** **/*.ts, **/*.js
**Severity:** warning
`,
      'utf-8',
    );
    const lessons = readAllLessons(tmpDir);
    expect(lessons).toHaveLength(1);
    expect(lessons[0]!.frontmatter?.compilation?.engine).toBe('regex');
    expect(lessons[0]!.frontmatter?.compilation?.pattern).toBe('\\beval\\(');
    expect(lessons[0]!.frontmatter?.scope?.globs).toEqual(['**/*.ts', '**/*.js']);
    expect(lessons[0]!.frontmatter?.severity).toBe('warning');
  });
});
