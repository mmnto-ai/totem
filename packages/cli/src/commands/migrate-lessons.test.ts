import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BASELINE_MARKER } from '../assets/universal-lessons.js';

vi.mock('../ui.js', () => ({
  log: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn(), dim: vi.fn() },
}));

vi.mock('../utils.js', async () => {
  const actual = await vi.importActual<typeof import('../utils.js')>('../utils.js');
  return {
    ...actual,
    resolveConfigPath: (cwd: string) => path.join(cwd, 'totem.config.ts'),
    loadConfig: async () => ({
      targets: [],
      totemDir: '.totem',
      lanceDir: '.lancedb',
      ignorePatterns: [],
    }),
  };
});

import { migrateLessonsCommand } from './migrate-lessons.js';

describe('migrateLessonsCommand', () => {
  let tmpDir: string;
  let savedCwd: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-migrate-'));
    savedCwd = process.cwd();
    process.chdir(tmpDir);
    // Create a dummy config file so resolveConfigPath doesn't fail
    fs.writeFileSync(path.join(tmpDir, 'totem.config.ts'), 'export default {}', 'utf-8');
  });

  afterEach(() => {
    process.chdir(savedCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does nothing when no lessons.md exists', async () => {
    await migrateLessonsCommand();
    const lessonsDir = path.join(tmpDir, '.totem', 'lessons');
    expect(fs.existsSync(lessonsDir)).toBe(false);
  });

  it('migrates individual lessons to separate files', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });
    fs.writeFileSync(
      path.join(totemDir, 'lessons.md'),
      '# Header\n\n## Lesson — First\n\n**Tags:** a\n\nFirst content.\n\n## Lesson — Second\n\n**Tags:** b\n\nSecond content.\n',
      'utf-8',
    );

    await migrateLessonsCommand();

    const lessonsDir = path.join(totemDir, 'lessons');
    expect(fs.existsSync(lessonsDir)).toBe(true);
    const files = fs.readdirSync(lessonsDir).filter((f) => f.endsWith('.md'));
    expect(files).toHaveLength(2);

    // Check content
    const allContent = files
      .map((f) => fs.readFileSync(path.join(lessonsDir, f), 'utf-8'))
      .join('\n');
    expect(allContent).toContain('First content.');
    expect(allContent).toContain('Second content.');

    // Legacy file should be backed up
    expect(fs.existsSync(path.join(totemDir, 'lessons.md.bak'))).toBe(true);
    expect(fs.existsSync(path.join(totemDir, 'lessons.md'))).toBe(false);
  });

  it('handles baseline lessons by writing them to baseline.md', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });
    fs.writeFileSync(
      path.join(totemDir, 'lessons.md'),
      `## Lesson — User lesson\n\n**Tags:** user\n\nUser content.\n\n${BASELINE_MARKER}\n\n## Lesson — Baseline lesson\n\n**Tags:** baseline\n\nBaseline content.\n`,
      'utf-8',
    );

    await migrateLessonsCommand();

    const lessonsDir = path.join(totemDir, 'lessons');
    expect(fs.existsSync(path.join(lessonsDir, 'baseline.md'))).toBe(true);
    const baselineContent = fs.readFileSync(path.join(lessonsDir, 'baseline.md'), 'utf-8');
    expect(baselineContent).toContain(BASELINE_MARKER);
    expect(baselineContent).toContain('Baseline content.');

    // User lesson should be in a separate file
    const files = fs
      .readdirSync(lessonsDir)
      .filter((f) => f.endsWith('.md') && f !== 'baseline.md');
    expect(files.length).toBeGreaterThanOrEqual(1);
    const userContent = files
      .map((f) => fs.readFileSync(path.join(lessonsDir, f), 'utf-8'))
      .join('\n');
    expect(userContent).toContain('User content.');
  });

  it('does nothing when lessons.md has no lessons', async () => {
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });
    fs.writeFileSync(path.join(totemDir, 'lessons.md'), '# Empty lessons file\n', 'utf-8');

    await migrateLessonsCommand();

    // Should not create lessons directory or backup
    expect(fs.existsSync(path.join(totemDir, 'lessons'))).toBe(false);
    expect(fs.existsSync(path.join(totemDir, 'lessons.md'))).toBe(true);
  });
});
