import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HandoffCheckpointSchema } from '../schemas/handoff-checkpoint.js';
import { cleanTmpDir } from '../test-utils.js';
import {
  buildLiteHandoff,
  gatherDeterministicState,
  parseSemanticFields,
  readRecentLessons,
  resolveCheckpointPath,
  writeCheckpoint,
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

// ─── gatherDeterministicState ───────────────────────

vi.mock('../git.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getGitBranch: vi.fn().mockReturnValue('main'),
    getGitStatus: vi.fn().mockReturnValue(''),
  };
});

describe('gatherDeterministicState', () => {
  let mockGetGitBranch: ReturnType<typeof vi.fn>;
  let mockGetGitStatus: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const git = await import('../git.js');
    mockGetGitBranch = git.getGitBranch as unknown as ReturnType<typeof vi.fn>;
    mockGetGitStatus = git.getGitStatus as unknown as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts active files from git status safely handling detached HEAD', async () => {
    mockGetGitBranch.mockImplementation(() => {
      throw new Error('not a git repository');
    });
    mockGetGitStatus.mockReturnValue(' M src/foo.ts\n?? src/bar.ts\nA  src/baz.ts');

    const result = await gatherDeterministicState('/tmp/test');

    expect(result.branch).toBe('HEAD');
    expect(result.active_files).toContain('src/foo.ts');
    expect(result.active_files).toContain('src/bar.ts');
    expect(result.active_files).toContain('src/baz.ts');
    expect(result.active_files).toHaveLength(3);
  });

  it('extracts active files from normal branch', async () => {
    mockGetGitBranch.mockReturnValue('feat/checkpoint');
    mockGetGitStatus.mockReturnValue(' M src/app.ts\n?? README.md');

    const result = await gatherDeterministicState('/tmp/test');

    expect(result.branch).toBe('feat/checkpoint');
    expect(result.active_files).toEqual(['README.md', 'src/app.ts']);
  });

  it('returns empty active_files when working tree is clean', async () => {
    mockGetGitBranch.mockReturnValue('main');
    mockGetGitStatus.mockReturnValue('');

    const result = await gatherDeterministicState('/tmp/test');

    expect(result.active_files).toEqual([]);
  });

  it('sets checkpoint_version to 1 and timestamp is valid ISO', async () => {
    mockGetGitBranch.mockReturnValue('main');
    mockGetGitStatus.mockReturnValue('');

    const result = await gatherDeterministicState('/tmp/test');

    expect(result.checkpoint_version).toBe(1);
    const parsed = new Date(result.timestamp);
    expect(parsed.toISOString()).toBe(result.timestamp);
    expect(result.open_prs).toEqual([]);
  });

  it('strips C-style quotes from paths with spaces', async () => {
    mockGetGitBranch.mockReturnValue('main');
    mockGetGitStatus.mockReturnValue(' M "src/my file.ts"\n?? "docs/read me.md"');

    const result = await gatherDeterministicState('/tmp/test');

    expect(result.active_files).toEqual(['docs/read me.md', 'src/my file.ts']);
  });

  it('falls back to HEAD when getGitBranch returns empty string', async () => {
    mockGetGitBranch.mockReturnValue('');
    mockGetGitStatus.mockReturnValue('');

    const result = await gatherDeterministicState('/tmp/test');

    expect(result.branch).toBe('HEAD');
  });

  it('falls back to HEAD when getGitBranch returns (unknown)', async () => {
    mockGetGitBranch.mockReturnValue('(unknown)');
    mockGetGitStatus.mockReturnValue('');

    const result = await gatherDeterministicState('/tmp/test');

    expect(result.branch).toBe('HEAD');
  });
});

// ─── parseSemanticFields (Task 3) ───────────────────

describe('parseSemanticFields', () => {
  it('extracts sections from markdown', () => {
    const markdown = [
      '### Branch & State',
      'feat/test; dirty working tree.',
      '',
      '### What Was Done',
      '- Implemented the schema validation',
      '- Added unit tests for the parser',
      '',
      '### Uncommitted Changes',
      '- Modified handoff.ts with new logic',
      '',
      '### Lessons & Traps',
      '- Always validate with Zod before writing',
      '- Watch out for Windows path separators',
      '',
      '### Next Steps',
      '1. Wire up the atomic file writer',
      '2. Add integration tests',
      '3. Run the full test suite',
    ].join('\n');

    const result = parseSemanticFields(markdown);

    expect(result.completed).toEqual([
      'Implemented the schema validation',
      'Added unit tests for the parser',
    ]);
    expect(result.remaining).toEqual([
      'Wire up the atomic file writer',
      'Add integration tests',
      'Run the full test suite',
    ]);
    expect(result.context_hints).toEqual([
      'Always validate with Zod before writing',
      'Watch out for Windows path separators',
    ]);
    expect(result.pending_decisions).toEqual(['Modified handoff.ts with new logic']);
  });

  it('returns empty arrays for malformed input', () => {
    const empty = parseSemanticFields('');
    expect(empty.completed).toEqual([]);
    expect(empty.remaining).toEqual([]);
    expect(empty.pending_decisions).toEqual([]);
    expect(empty.context_hints).toEqual([]);

    const garbage = parseSemanticFields('foo bar baz\nno headings here\n!!!');
    expect(garbage.completed).toEqual([]);
    expect(garbage.remaining).toEqual([]);
    expect(garbage.pending_decisions).toEqual([]);
    expect(garbage.context_hints).toEqual([]);
  });

  it('handles ## headings as well as ###', () => {
    const markdown = [
      '## What Was Done',
      '- Finished the feature',
      '',
      '## Next Steps',
      '- Deploy to staging',
    ].join('\n');

    const result = parseSemanticFields(markdown);
    expect(result.completed).toEqual(['Finished the feature']);
    expect(result.remaining).toEqual(['Deploy to staging']);
  });

  it('handles non-bullet content lines', () => {
    const markdown = ['### What Was Done', 'Implemented the schema.', 'Added tests.'].join('\n');

    const result = parseSemanticFields(markdown);
    expect(result.completed).toEqual(['Implemented the schema.', 'Added tests.']);
  });
});

// ─── Lite mode checkpoint (Task 3) ──────────────────

describe('lite mode checkpoint', () => {
  it('bypasses LLM execution when lite flag is provided and returns empty semantic arrays', async () => {
    const git = await import('../git.js');
    const mockBranch = git.getGitBranch as unknown as ReturnType<typeof vi.fn>;
    const mockStatus = git.getGitStatus as unknown as ReturnType<typeof vi.fn>;

    mockBranch.mockReturnValue('feat/lite-test');
    mockStatus.mockReturnValue(' M src/foo.ts');

    const state = await gatherDeterministicState('/tmp/test');
    const checkpoint = HandoffCheckpointSchema.parse(state);

    expect(checkpoint.checkpoint_version).toBe(1);
    expect(checkpoint.branch).toBe('feat/lite-test');
    expect(checkpoint.active_files).toEqual(['src/foo.ts']);
    expect(checkpoint.completed).toEqual([]);
    expect(checkpoint.remaining).toEqual([]);
    expect(checkpoint.pending_decisions).toEqual([]);
    expect(checkpoint.context_hints).toEqual([]);
  });
});

// ─── writeCheckpoint & resolveCheckpointPath (Task 4) ───

describe('writeCheckpoint', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-checkpoint-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('writes checkpoint json atomically alongside markdown', () => {
    const mdPath = path.join(tmpDir, 'handoff.md');
    const jsonPath = path.join(tmpDir, 'handoff.json');

    fs.writeFileSync(mdPath, '### Branch & State\nmain; clean.', 'utf-8');

    const checkpoint = HandoffCheckpointSchema.parse({
      checkpoint_version: 1,
      timestamp: new Date().toISOString(),
      branch: 'main',
      active_files: ['src/app.ts'],
      completed: ['Implemented feature X'],
      remaining: ['Add tests'],
    });
    writeCheckpoint(jsonPath, checkpoint);

    expect(fs.existsSync(mdPath)).toBe(true);
    expect(fs.existsSync(jsonPath)).toBe(true);

    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const parsed = HandoffCheckpointSchema.parse(raw);
    expect(parsed.branch).toBe('main');
    expect(parsed.active_files).toEqual(['src/app.ts']);
    expect(parsed.completed).toEqual(['Implemented feature X']);
    expect(parsed.remaining).toEqual(['Add tests']);

    expect(fs.existsSync(jsonPath + '.tmp')).toBe(false);
  });

  it('creates parent directories if they do not exist', () => {
    const nested = path.join(tmpDir, 'deep', 'nested');
    const jsonPath = path.join(nested, 'checkpoint.json');

    const checkpoint = HandoffCheckpointSchema.parse({
      checkpoint_version: 1,
      timestamp: new Date().toISOString(),
      branch: 'main',
      active_files: [],
    });
    writeCheckpoint(jsonPath, checkpoint);

    expect(fs.existsSync(jsonPath)).toBe(true);
  });

  it('writes checkpoint to .totem/handoff.json when no --out specified', () => {
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });

    const jsonPath = resolveCheckpointPath(tmpDir, '.totem');
    expect(jsonPath).toBe(path.join(tmpDir, '.totem', 'handoff.json'));

    const checkpoint = HandoffCheckpointSchema.parse({
      checkpoint_version: 1,
      timestamp: new Date().toISOString(),
      branch: 'feat/no-out',
      active_files: ['src/index.ts'],
      completed: ['Setup project'],
    });
    writeCheckpoint(jsonPath, checkpoint);

    expect(fs.existsSync(jsonPath)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    const parsed = HandoffCheckpointSchema.parse(raw);
    expect(parsed.branch).toBe('feat/no-out');
    expect(parsed.active_files).toEqual(['src/index.ts']);
  });
});

// ─── resolveCheckpointPath ──────────────────────────

describe('resolveCheckpointPath', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-resolve-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('returns .json companion when --out has .md extension', () => {
    const result = resolveCheckpointPath(tmpDir, '.totem', '/some/path/handoff.md');
    expect(result).toBe('/some/path/handoff.json');
  });

  it('returns .json companion when --out has no extension', () => {
    const result = resolveCheckpointPath(tmpDir, '.totem', '/some/path/handoff');
    expect(result).toBe('/some/path/handoff.json');
  });

  it('returns totemDir/handoff.json when no --out', () => {
    const result = resolveCheckpointPath(tmpDir, '.totem');
    expect(result).toBe(path.join(tmpDir, '.totem', 'handoff.json'));
  });

  it('uses custom totemDir when configured', () => {
    const result = resolveCheckpointPath(tmpDir, '.governance');
    expect(result).toBe(path.join(tmpDir, '.governance', 'handoff.json'));
  });

  it('replaces .txt extension with .json', () => {
    const result = resolveCheckpointPath(tmpDir, '.totem', '/output/report.txt');
    expect(result).toBe('/output/report.json');
  });

  it('avoids collision when --out already ends in .json', () => {
    const result = resolveCheckpointPath(tmpDir, '.totem', '/output/handoff.json');
    expect(result).toBe('/output/handoff.checkpoint.json');
  });
});
