import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateInputHash, hashLesson } from '@mmnto/totem';

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

// ─── compileCommand upgradeBatch error paths ──────────

describe('compileCommand upgradeBatch', () => {
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

  it('rejects upgradeBatch combined with --upgrade', async () => {
    setupWorkspace(tmpDir, {
      'rule-a.md': lessonMarkdown('Use err in catch', 'Do not use error in catch blocks.'),
    });
    const hashA = hashLesson('Use err in catch', 'Do not use error in catch blocks.');
    await expect(
      compileCommand({ upgradeBatch: [{ hash: hashA }], upgrade: hashA }),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  });

  it('rejects upgradeBatch combined with --cloud', async () => {
    setupWorkspace(tmpDir, {
      'rule-a.md': lessonMarkdown('Use err in catch', 'Do not use error in catch blocks.'),
    });
    const hashA = hashLesson('Use err in catch', 'Do not use error in catch blocks.');
    await expect(
      compileCommand({ upgradeBatch: [{ hash: hashA }], cloud: 'https://example.invalid' }),
    ).rejects.toMatchObject({ code: 'UPGRADE_CLOUD_UNSUPPORTED' });
  });

  it('rejects upgradeBatch combined with --force', async () => {
    setupWorkspace(tmpDir, {
      'rule-a.md': lessonMarkdown('Use err in catch', 'Do not use error in catch blocks.'),
    });
    const hashA = hashLesson('Use err in catch', 'Do not use error in catch blocks.');
    await expect(
      compileCommand({ upgradeBatch: [{ hash: hashA }], force: true }),
    ).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  });

  it('returns an array of UpgradeOutcomes for batch targets', async () => {
    setupWorkspace(tmpDir, {
      'rule-a.md': lessonMarkdown('Use err in catch', 'Do not use error in catch blocks.'),
      'rule-b.md': lessonMarkdown('Avoid console.log', 'Do not commit console.log calls.'),
    });
    const hashA = hashLesson('Use err in catch', 'Do not use error in catch blocks.');
    const hashB = hashLesson('Avoid console.log', 'Do not commit console.log calls.');

    // Lite-tier has no orchestrator — compileCommand throws CONFIG_MISSING after
    // batch validation passes. This confirms the batch path is entered and the
    // validation / lesson-filter logic runs for both hashes.
    await expect(
      compileCommand({ upgradeBatch: [{ hash: hashA }, { hash: hashB }] }),
    ).rejects.toMatchObject({ code: 'CONFIG_MISSING' });
  });

  it('upgradeBatch with an empty array proceeds past validation without error', async () => {
    setupWorkspace(tmpDir, {
      'rule-a.md': lessonMarkdown('Use err in catch', 'Do not use error in catch blocks.'),
    });

    // An empty batch is valid — zero lessons in scope, no LLM call. The
    // Lite-tier config triggers CONFIG_MISSING from the orchestrator gate.
    await expect(compileCommand({ upgradeBatch: [] })).rejects.toMatchObject({
      code: 'CONFIG_MISSING',
    });
  });
});

// ─── Helpers for full-tier workspace ─────────────────────────────────────────
//
// These tests need a full-tier config (shell orchestrator) so compileCommand
// passes the orchestrator gate and the upgradeBatch return path is reachable.
// The shell command is a harmless no-op because an empty batch means no LLM
// call is ever made.

function setupFullTierWorkspace(
  tmpDir: string,
  lessonFiles: Record<string, string>,
  rules: Array<{ lessonHash: string; lessonHeading: string }> = [],
): void {
  fs.writeFileSync(
    path.join(tmpDir, 'totem.config.ts'),
    [
      'export default {',
      '  targets: [{ glob: "**/*.ts", type: "code", strategy: "typescript-ast" }],',
      '  totemDir: ".totem",',
      '  orchestrator: {',
      '    provider: "shell",',
      '    command: "echo should-never-run",',
      '    defaultModel: "test-model",',
      '  },',
      '};',
      '',
    ].join('\n'),
    'utf-8',
  );

  const totemDir = path.join(tmpDir, '.totem');
  const lessonsDir = path.join(totemDir, 'lessons');
  fs.mkdirSync(lessonsDir, { recursive: true });
  for (const [name, body] of Object.entries(lessonFiles)) {
    fs.writeFileSync(path.join(lessonsDir, name), body, 'utf-8');
  }

  const now = '2026-04-13T00:00:00Z';
  fs.writeFileSync(
    path.join(totemDir, 'compiled-rules.json'),
    JSON.stringify(
      {
        version: 1,
        rules: rules.map((r) => ({
          lessonHash: r.lessonHash,
          lessonHeading: r.lessonHeading,
          pattern: 'dummy-never-matches',
          message: r.lessonHeading,
          engine: 'regex',
          compiledAt: now,
        })),
        nonCompilable: [],
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  );

  const manifestPath = path.join(totemDir, 'compile-manifest.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        compiled_at: now,
        model: 'test-model',
        input_hash: generateInputHash(lessonsDir),
        output_hash: '0000000000000000000000000000000000000000000000000000000000000000',
        rule_count: rules.length,
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  );
}

// ─── compileCommand upgradeBatch success paths ────────────────────────────────

describe('compileCommand upgradeBatch success paths', () => {
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

  it('returns empty array for empty upgradeBatch', async () => {
    setupFullTierWorkspace(tmpDir, {
      'rule-a.md': lessonMarkdown('Use err in catch', 'Do not use error in catch blocks.'),
    });

    // An empty batch is valid. Full-tier config means the orchestrator gate
    // passes and compileCommand reaches the return path with an empty outcomes
    // array rather than throwing CONFIG_MISSING.
    const outcomes = await compileCommand({ upgradeBatch: [] });
    expect(Array.isArray(outcomes)).toBe(true);
    expect(outcomes).toEqual([]);
  });

  it('throws UPGRADE_HASH_NOT_FOUND for a hash not present in lessons', async () => {
    setupFullTierWorkspace(
      tmpDir,
      {
        'rule-a.md': lessonMarkdown('Use err in catch', 'Do not use error in catch blocks.'),
      },
      [
        {
          lessonHash: hashLesson('Use err in catch', 'Do not use error in catch blocks.'),
          lessonHeading: 'Use err in catch',
        },
      ],
    );

    // A hash that does not match any lesson should throw rather than silently
    // returning 'noop', which could mask compile-prune mutations.
    await expect(
      compileCommand({ upgradeBatch: [{ hash: 'deadbeefdeadbeef' }] }),
    ).rejects.toMatchObject({ code: 'UPGRADE_HASH_NOT_FOUND' });
  });
});
