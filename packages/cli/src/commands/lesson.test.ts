import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';

// ─── Mock utils to bypass real config loading ───────────

vi.mock('../utils.js', async () => {
  const actual = await vi.importActual<typeof import('../utils.js')>('../utils.js');
  return {
    ...actual,
    resolveConfigPath: (cwd: string) => path.join(cwd, 'totem.config.ts'),
    loadConfig: async () => ({
      targets: [],
      totemDir: '.totem',
      ignorePatterns: [],
    }),
    IS_WIN: process.platform === 'win32',
    sanitize: (s: string) => s,
  };
});

// Mock child_process.spawn to prevent background sync from locking tmpDir
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawn: vi.fn(() => ({ unref: vi.fn() })),
  };
});

// ─── Helpers ────────────────────────────────────────────

/** Strip ANSI escape codes for assertion matching. */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, ''); // totem-context: ANSI regex — not user input
}

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-lesson-'));
}

/** Scaffold a .totem directory with config and optional lesson files. */
function scaffold(cwd: string, lessonContents?: string[]) {
  const totemDir = path.join(cwd, '.totem');
  const lessonsDir = path.join(totemDir, 'lessons');
  fs.mkdirSync(lessonsDir, { recursive: true });
  fs.writeFileSync(path.join(cwd, 'totem.config.ts'), 'export default {};', 'utf-8');

  if (lessonContents) {
    for (let i = 0; i < lessonContents.length; i++) {
      fs.writeFileSync(path.join(lessonsDir, `lesson-test${i}.md`), lessonContents[i]!, 'utf-8');
    }
  }
  return { totemDir, lessonsDir };
}

const SAMPLE_LESSONS = [
  [
    '## Lesson \u2014 Always use strict equality',
    '',
    '**Tags:** best-practice, typescript',
    '',
    'Use === instead of == to avoid type coercion.',
    '',
  ].join('\n'),
  [
    '## Lesson \u2014 Avoid console.log in production',
    '',
    '**Tags:** lint, cleanup',
    '',
    'Remove console.log statements before shipping.',
    '',
  ].join('\n'),
  [
    '## Lesson \u2014 Never commit secrets to version control',
    '',
    '**Tags:** security',
    '',
    'Use environment variables and .env files for sensitive values.',
    '',
  ].join('\n'),
];

// ─── Tests ──────────────────────────────────────────────

describe('lesson list', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.restoreAllMocks();
  });

  it('outputs correct count and format', async () => {
    scaffold(tmpDir, SAMPLE_LESSONS);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { lessonListCommand } = await import('./lesson.js');
    await lessonListCommand();

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('3 lesson(s) total');
    expect(output).toContain('Always use strict equality');
    expect(output).toContain('Avoid console.log in production');
    expect(output).toContain('Never commit secrets');
    expect(output).toContain('HASH');
    expect(output).toContain('HEADING');
    expect(output).toContain('TAGS');
  });

  it('handles empty lessons directory', async () => {
    scaffold(tmpDir); // no lesson files
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { lessonListCommand } = await import('./lesson.js');
    await lessonListCommand();

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('No lessons found');
    expect(output).toContain('totem lesson add');
  });

  it('truncates long headings', async () => {
    const longLesson = [
      '## Lesson \u2014 This is a very long heading that exceeds sixty characters and should definitely be truncated properly with an ellipsis',
      '',
      '**Tags:** verbose',
      '',
      'Some body text.',
      '',
    ].join('\n');
    scaffold(tmpDir, [longLesson]);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { lessonListCommand } = await import('./lesson.js');
    await lessonListCommand();

    const output = consoleSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(output).toContain('\u2026');
    expect(output).not.toContain('truncated properly');
  });
});

describe('lesson add', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanTmpDir(tmpDir);
    vi.restoreAllMocks();
  });

  it('writes a lesson file', async () => {
    scaffold(tmpDir);
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { lessonAddCommand } = await import('./lesson.js');
    await lessonAddCommand('Always validate user input before processing.');

    const lessonsDir = path.join(tmpDir, '.totem', 'lessons');
    const files = fs.readdirSync(lessonsDir).filter((f) => f.endsWith('.md'));
    expect(files.length).toBe(1);

    const content = fs.readFileSync(path.join(lessonsDir, files[0]!), 'utf-8');
    expect(content).toContain('Always validate user input');
    expect(content).toContain('## Lesson');
    expect(content).toContain('**Tags:** manual');
  });

  it('shows confirmation message', async () => {
    scaffold(tmpDir);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { lessonAddCommand } = await import('./lesson.js');
    await lessonAddCommand('Test lesson content.');

    const output = stripAnsi(consoleSpy.mock.calls.map((c) => String(c[0])).join('\n'));
    expect(output).toContain('Lesson saved to');
    expect(output).toContain('.totem/lessons/');
  });
});

describe('deprecated aliases', () => {
  it('compile alias emits deprecation warning', async () => {
    // We test this at the registration level by checking index.ts structure.
    // The integration-level test (like review-alias.test.ts) requires the
    // built dist, so we validate the deprecation pattern structurally here.
    const indexSrc = fs.readFileSync(path.join(process.cwd(), 'src/index.ts'), 'utf-8');
    expect(indexSrc).toContain("'totem compile' is deprecated");
    expect(indexSrc).toContain('totem lesson compile');
  });

  it('extract alias emits deprecation warning', async () => {
    const indexSrc = fs.readFileSync(path.join(process.cwd(), 'src/index.ts'), 'utf-8');
    expect(indexSrc).toContain("'totem extract' is deprecated");
    expect(indexSrc).toContain('totem lesson extract');
  });

  it('add-lesson alias emits deprecation warning', async () => {
    const indexSrc = fs.readFileSync(path.join(process.cwd(), 'src/index.ts'), 'utf-8');
    expect(indexSrc).toContain("'totem add-lesson' is deprecated");
    expect(indexSrc).toContain('totem lesson add');
  });
});
