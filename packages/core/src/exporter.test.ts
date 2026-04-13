import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ParsedLesson } from './drift-detector.js';
import {
  exportLessons,
  formatLessonsAsMarkdown,
  injectSentinelBlock,
  SENTINEL_END,
  SENTINEL_START,
} from './exporter.js';
import { cleanTmpDir } from './test-utils.js';

// ─── Test fixtures ─────────────────────────────────

const makeLessons = (count: number): ParsedLesson[] =>
  Array.from({ length: count }, (_, i) => ({
    heading: `Lesson ${i + 1}`,
    tags: ['tag-a', 'tag-b'],
    body: `Body of lesson ${i + 1}.`,
    raw: `## Lesson — Lesson ${i + 1}\n\n**Tags:** tag-a, tag-b\n\nBody of lesson ${i + 1}.\n`,
    index: i,
  }));

// ─── formatLessonsAsMarkdown ────────────────────────

describe('formatLessonsAsMarkdown', () => {
  it('returns sentinel block with no rules for empty lessons', () => {
    const result = formatLessonsAsMarkdown([]);
    expect(result).toContain(SENTINEL_START);
    expect(result).toContain(SENTINEL_END);
    expect(result).toContain('## Totem Project Rules');
    expect(result).not.toContain('- **');
  });

  it('formats lessons as bulleted list with sentinels', () => {
    const result = formatLessonsAsMarkdown(makeLessons(2));
    expect(result).toContain(SENTINEL_START);
    expect(result).toContain(SENTINEL_END);
    expect(result).toContain('- **Lesson 1** - Body of lesson 1. _(tag-a, tag-b)_');
    expect(result).toContain('- **Lesson 2** - Body of lesson 2. _(tag-a, tag-b)_');
  });

  it('collapses multi-line bodies to single line', () => {
    const lessons: ParsedLesson[] = [
      {
        heading: 'Multi-line',
        tags: [],
        body: 'Line one.\nLine two.\nLine three.',
        raw: '',
        index: 0,
      },
    ];
    const result = formatLessonsAsMarkdown(lessons);
    expect(result).toContain('- **Multi-line** - Line one. Line two. Line three.');
  });

  it('escapes asterisks and underscores in body and heading to prevent markdown corruption', () => {
    const lessons: ParsedLesson[] = [
      {
        heading: 'Use **/*.ts for glob matching',
        tags: ['linting'],
        body: '**Scope:** packages/core/src/**/*.ts, !**/*.test.*\n\nSome rule_body.',
        raw: '',
        index: 0,
      },
    ];
    const result = formatLessonsAsMarkdown(lessons);
    expect(result).toContain('\\*\\*/\\*.ts for glob matching');
    expect(result).toContain('\\*\\*Scope:\\*\\*');
    expect(result).toContain('rule\\_body');
  });

  it('omits tag suffix when lesson has no tags', () => {
    const lessons: ParsedLesson[] = [
      { heading: 'No tags', tags: [], body: 'Body text.', raw: '', index: 0 },
    ];
    const result = formatLessonsAsMarkdown(lessons);
    expect(result).toContain('- **No tags** - Body text.');
    expect(result).not.toContain('_()');
  });
});

// ─── injectSentinelBlock ─────────────────────────────

describe('injectSentinelBlock', () => {
  it('replaces content between existing sentinels', () => {
    const existing = [
      '# My Config',
      '',
      SENTINEL_START,
      'old content',
      SENTINEL_END,
      '',
      '## Hand-written section',
    ].join('\n');

    const result = injectSentinelBlock(existing, 'NEW BLOCK');
    expect(result).toContain('# My Config');
    expect(result).toContain('NEW BLOCK');
    expect(result).toContain('## Hand-written section');
    expect(result).not.toContain('old content');
  });

  it('appends to end when no sentinels exist', () => {
    const existing = '# My Config\n\nSome content.\n';
    const result = injectSentinelBlock(existing, 'NEW BLOCK');
    expect(result).toContain('# My Config');
    expect(result).toContain('Some content.');
    expect(result).toContain('NEW BLOCK');
    expect(result.indexOf('NEW BLOCK')).toBeGreaterThan(result.indexOf('Some content.'));
  });

  it('throws on start sentinel without end sentinel', () => {
    const existing = `# Config\n\n${SENTINEL_START}\nbroken content`;
    expect(() => injectSentinelBlock(existing, 'NEW')).toThrow('[Totem Error]');
  });

  it('throws when end sentinel appears before start sentinel', () => {
    const existing = `${SENTINEL_END}\nstuff\n${SENTINEL_START}`;
    expect(() => injectSentinelBlock(existing, 'NEW')).toThrow('[Totem Error]');
  });

  it('preserves content before and after sentinels', () => {
    const existing = `BEFORE\n${SENTINEL_START}\nold\n${SENTINEL_END}\nAFTER`;
    const result = injectSentinelBlock(existing, 'REPLACED');
    expect(result).toBe('BEFORE\nREPLACED\nAFTER');
  });

  it('handles empty existing content', () => {
    const result = injectSentinelBlock('', 'BLOCK');
    expect(result).toContain('BLOCK');
  });

  it('does not modify content if generated block is empty and no sentinels exist', () => {
    const result = injectSentinelBlock('# My Config', '');
    expect(result).toBe('# My Config');
  });
});

// ─── exportLessons (integration) ──────────────────

describe('exportLessons', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-export-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('creates file and directories when they do not exist', () => {
    const targetPath = path.join(tmpDir, 'nested', 'dir', 'rules.md');
    exportLessons(makeLessons(1), targetPath);

    expect(fs.existsSync(targetPath)).toBe(true);
    const content = fs.readFileSync(targetPath, 'utf-8');
    expect(content).toContain(SENTINEL_START);
    expect(content).toContain('Lesson 1');
  });

  it('injects into existing file without sentinels', () => {
    const targetPath = path.join(tmpDir, 'existing.md');
    fs.writeFileSync(targetPath, '# Hand-written rules\n\nDo not delete this.\n');

    exportLessons(makeLessons(1), targetPath);

    const content = fs.readFileSync(targetPath, 'utf-8');
    expect(content).toContain('# Hand-written rules');
    expect(content).toContain('Do not delete this.');
    expect(content).toContain(SENTINEL_START);
    expect(content).toContain('Lesson 1');
  });

  it('replaces sentinel block on re-export (idempotent)', () => {
    const targetPath = path.join(tmpDir, 'idempotent.md');

    // First export
    exportLessons(makeLessons(1), targetPath);
    // Second export with different lessons
    exportLessons(makeLessons(2), targetPath);

    const content = fs.readFileSync(targetPath, 'utf-8');
    expect(content).toContain('Lesson 1');
    expect(content).toContain('Lesson 2');
    // Should only have one set of sentinels
    const startCount = content.split(SENTINEL_START).length - 1;
    expect(startCount).toBe(1);
  });
});
