import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RetiredLesson } from './retired-lessons.js';
import {
  isRetiredHeading,
  readRetiredLessons,
  retireLesson,
  writeRetiredLessons,
} from './retired-lessons.js';

// ─── Helpers ────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), `totem-retired-${crypto.randomUUID()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
});

function makeLedgerFile(entries: RetiredLesson[]): void {
  fs.writeFileSync(
    path.join(tmpDir, 'retired-lessons.json'),
    JSON.stringify(entries, null, 2),
    'utf-8',
  );
}

// ─── readRetiredLessons ─────────────────────────────────

describe('readRetiredLessons', () => {
  it('returns empty array when file does not exist', () => {
    const result = readRetiredLessons(tmpDir);
    expect(result).toEqual([]);
  });

  it('parses valid JSON correctly', () => {
    const entries: RetiredLesson[] = [
      { heading: 'Avoid eval()', reason: 'Too broad', retiredAt: '2026-04-01T00:00:00.000Z' },
      {
        heading: 'Use strict mode',
        reason: 'Duplicates compiler flag',
        retiredAt: '2026-04-02T00:00:00.000Z',
      },
    ];
    makeLedgerFile(entries);

    const result = readRetiredLessons(tmpDir);
    expect(result).toHaveLength(2);
    expect(result[0]!.heading).toBe('Avoid eval()');
    expect(result[1]!.reason).toBe('Duplicates compiler flag');
  });

  it('returns empty array on malformed JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'retired-lessons.json'), '{{{not json', 'utf-8');
    const result = readRetiredLessons(tmpDir);
    expect(result).toEqual([]);
  });
});

// ─── retireLesson ───────────────────────────────────────

describe('retireLesson', () => {
  it('creates the file if it does not exist', () => {
    retireLesson(tmpDir, 'Never use var', 'Superseded by let/const rule');

    const filePath = path.join(tmpDir, 'retired-lessons.json');
    expect(fs.existsSync(filePath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content).toHaveLength(1);
    expect(content[0].heading).toBe('Never use var');
    expect(content[0].reason).toBe('Superseded by let/const rule');
    expect(content[0].retiredAt).toBeTruthy();
  });

  it('appends without duplicating existing entries (same heading)', () => {
    retireLesson(tmpDir, 'Avoid eval()', 'Too broad');
    retireLesson(tmpDir, 'Avoid eval()', 'Still too broad');

    const result = readRetiredLessons(tmpDir);
    expect(result).toHaveLength(1);
    expect(result[0]!.reason).toBe('Too broad');
  });

  it('deduplicates case-insensitively', () => {
    retireLesson(tmpDir, 'Avoid Eval()', 'First');
    retireLesson(tmpDir, 'avoid eval()', 'Second');

    const result = readRetiredLessons(tmpDir);
    expect(result).toHaveLength(1);
  });
});

// ─── writeRetiredLessons ────────────────────────────────

describe('writeRetiredLessons', () => {
  it('writes JSON with 2-space indent', () => {
    const entries: RetiredLesson[] = [
      { heading: 'Test', reason: 'Testing', retiredAt: '2026-04-01T00:00:00.000Z' },
    ];
    writeRetiredLessons(tmpDir, entries);

    const raw = fs.readFileSync(path.join(tmpDir, 'retired-lessons.json'), 'utf-8');
    // 2-space indent produces "  " before keys
    expect(raw).toContain('  "heading"');
    expect(raw.endsWith('\n')).toBe(true);
  });
});

// ─── isRetiredHeading ───────────────────────────────────

describe('isRetiredHeading', () => {
  const retired: RetiredLesson[] = [
    { heading: 'Avoid eval()', reason: 'Too broad', retiredAt: '2026-04-01T00:00:00.000Z' },
    { heading: 'Use strict mode', reason: 'Duplicate', retiredAt: '2026-04-02T00:00:00.000Z' },
  ];

  it('matches exact heading', () => {
    expect(isRetiredHeading('Avoid eval()', retired)).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(isRetiredHeading('AVOID EVAL()', retired)).toBe(true);
    expect(isRetiredHeading('use STRICT mode', retired)).toBe(true);
  });

  it('matches when retired heading is a substring of candidate', () => {
    expect(isRetiredHeading('Always Avoid eval() in production code', retired)).toBe(true);
  });

  it('matches when candidate is a substring of retired heading', () => {
    expect(isRetiredHeading('strict mode', retired)).toBe(true);
  });

  it('returns false for unrelated headings', () => {
    expect(isRetiredHeading('Prefer const over let', retired)).toBe(false);
    expect(isRetiredHeading('Enable TypeScript strict', retired)).toBe(false);
  });
});
