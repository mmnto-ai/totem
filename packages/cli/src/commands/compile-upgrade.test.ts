import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hashLesson } from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import { buildTelemetryPrefix, compileCommand } from './compile.js';

// ─── Helpers ─────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-compile-upgrade-'));
}

function setupWorkspace(tmpDir: string, lessonFiles: Record<string, string>): void {
  // Minimal Lite-tier config so loadConfig succeeds. No orchestrator → no LLM call.
  fs.writeFileSync(
    path.join(tmpDir, 'totem.yaml'),
    [
      'targets:',
      '  - glob: "**/*.ts"',
      '    type: code',
      '    strategy: typescript-ast',
      'totemDir: .totem',
    ].join('\n') + '\n',
    'utf-8',
  );

  const lessonsDir = path.join(tmpDir, '.totem', 'lessons');
  fs.mkdirSync(lessonsDir, { recursive: true });
  for (const [name, body] of Object.entries(lessonFiles)) {
    fs.writeFileSync(path.join(lessonsDir, name), body, 'utf-8');
  }
}

/** Build a valid `## Lesson —` markdown block that readAllLessons can parse. */
function lessonMarkdown(heading: string, body: string): string {
  return `## Lesson — ${heading}\n\n**Tags:** test\n\n${body}\n`;
}

// ─── buildTelemetryPrefix ──────────────────────────

describe('buildTelemetryPrefix', () => {
  it('builds a directive describing the non-code ratio', () => {
    const prefix = buildTelemetryPrefix({
      code: 2,
      string: 5,
      comment: 3,
      regex: 0,
      unknown: 0,
    });
    // 8 non-code / 10 total = 80%
    expect(prefix).toContain('80%');
    expect(prefix).toContain('strings: 5');
    expect(prefix).toContain('comments: 3');
    expect(prefix).toContain('regex literals: 0');
    expect(prefix).toContain('ast-grep');
  });

  it('reports 0% when all matches are in code', () => {
    const prefix = buildTelemetryPrefix({
      code: 10,
      string: 0,
      comment: 0,
      regex: 0,
      unknown: 0,
    });
    expect(prefix).toContain('0%');
  });

  it('does not divide by zero when there are no matches', () => {
    const prefix = buildTelemetryPrefix({
      code: 0,
      string: 0,
      comment: 0,
      regex: 0,
      unknown: 0,
    });
    expect(prefix).toContain('0%');
  });

  it('excludes the unknown bucket from both numerator and denominator', () => {
    // 100 unclassified historical hits + 5 recent classified (all code).
    // Old math would report (100 + 0) / 105 = 95% "non-code" — a false positive.
    // New math: 0 / 5 = 0% non-code. Unknown is surfaced as a side note.
    const prefix = buildTelemetryPrefix({
      code: 5,
      string: 0,
      comment: 0,
      regex: 0,
      unknown: 100,
    });
    expect(prefix).toContain('0%');
    expect(prefix).toContain('Unclassified (historical) matches: 100');
  });

  it('computes the ratio from classified buckets only when unknown is large', () => {
    // 500 historical + 5 classified (2 code, 3 string). Classified total = 5,
    // non-code = 3, pct = 60%. Unknown is reported but does not move the ratio.
    const prefix = buildTelemetryPrefix({
      code: 2,
      string: 3,
      comment: 0,
      regex: 0,
      unknown: 500,
    });
    expect(prefix).toContain('60%');
    expect(prefix).toContain('Unclassified (historical) matches: 500');
  });
});

// ─── compileCommand --upgrade error paths ──────────

describe('compileCommand --upgrade', () => {
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
  });

  it('errors cleanly when --upgrade hash matches no lesson', async () => {
    setupWorkspace(tmpDir, {
      'rule-a.md': lessonMarkdown('Use err in catch', 'Do not use error in catch blocks.'),
    });
    await expect(compileCommand({ upgrade: 'deadbeefcafebabe' })).rejects.toMatchObject({
      code: 'UPGRADE_HASH_NOT_FOUND',
    });
  });

  it('rejects --upgrade combined with --cloud (not yet supported)', async () => {
    setupWorkspace(tmpDir, {
      'rule-a.md': lessonMarkdown('Use err in catch', 'Do not use error in catch blocks.'),
    });
    await expect(
      compileCommand({ upgrade: 'deadbeef', cloud: 'https://example.invalid' }),
    ).rejects.toMatchObject({
      code: 'UPGRADE_CLOUD_UNSUPPORTED',
    });
  });

  it('rejects --upgrade combined with --force', async () => {
    setupWorkspace(tmpDir, {
      'rule-a.md': lessonMarkdown('Use err in catch', 'Do not use error in catch blocks.'),
    });
    // --force would empty the cache before scoped eviction runs, silently
    // turning --upgrade into a full recompile. Must be rejected.
    await expect(compileCommand({ upgrade: 'deadbeef', force: true })).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
    });
  });

  it('matches a known lesson by full hash and proceeds past the filter', async () => {
    setupWorkspace(tmpDir, {
      'rule-a.md': lessonMarkdown('Use err in catch', 'Do not use error in catch blocks.'),
      'rule-b.md': lessonMarkdown('Avoid console.log', 'Do not commit console.log calls.'),
    });
    // Compute the hash that the parser will produce for rule-a
    const hashA = hashLesson('Use err in catch', 'Do not use error in catch blocks.');

    // The Lite-tier config has no orchestrator, so once the upgrade filter passes,
    // the next gate (`if (config.orchestrator)`) is skipped and we land in the
    // export branch which throws CONFIG_MISSING. The fact that we get past
    // UPGRADE_HASH_NOT_FOUND proves the filter matched.
    await expect(compileCommand({ upgrade: hashA })).rejects.toMatchObject({
      code: 'CONFIG_MISSING',
    });
  });

  it('matches a known lesson by short hash prefix', async () => {
    setupWorkspace(tmpDir, {
      'rule-a.md': lessonMarkdown('Use err in catch', 'Do not use error in catch blocks.'),
    });
    const hashA = hashLesson('Use err in catch', 'Do not use error in catch blocks.');
    const shortPrefix = hashA.slice(0, 8);

    await expect(compileCommand({ upgrade: shortPrefix })).rejects.toMatchObject({
      code: 'CONFIG_MISSING',
    });
  });
});
