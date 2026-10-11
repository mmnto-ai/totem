import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  attestRecordsHash,
  EMPTY_RECORDS_HASH,
  generateOutputHash,
  hashLesson,
  readAllLessons,
  readCompileManifest,
  renderLessonExportsForRules,
} from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import { lessonArchiveCommand } from './lesson.js';

// ─── Helpers ─────────────────────────────────────────
//
// Exercise `totem lesson archive <hash> [--reason <string>]` — the atomic
// archive verb from mmnto-ai/totem#1587 Task 3. The command mirrors
// `rulePromoteCommand` (rule.ts:300-394) in shape: preflight manifest read,
// atomic tmp+rename write of rules.json, refresh manifest output_hash.
// Idempotent on rerun: archivedReason refreshes, archivedAt is preserved
// across invocations.

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-lesson-archive-'));
}

interface RuleSeed {
  lessonHash: string;
  lessonHeading: string;
  status?: 'archived';
  archivedReason?: string;
  archivedAt?: string;
}

function setupWorkspace(tmpDir: string, rules: RuleSeed[]): void {
  fs.writeFileSync(
    path.join(tmpDir, 'totem.config.ts'),
    [
      'export default {',
      '  targets: [{ glob: "**/*.ts", type: "code", strategy: "typescript-ast" }],',
      '  totemDir: ".totem",',
      '};',
      '',
    ].join('\n'),
    'utf-8',
  );

  const totemDir = path.join(tmpDir, '.totem');
  fs.mkdirSync(totemDir, { recursive: true });

  const rulesPath = path.join(totemDir, 'compiled-rules.json');
  const now = '2026-04-22T00:00:00Z';
  fs.writeFileSync(
    rulesPath,
    JSON.stringify(
      {
        version: 1,
        rules: rules.map((r) => ({
          lessonHash: r.lessonHash,
          lessonHeading: r.lessonHeading,
          pattern: 'dummy-never-matches',
          message: r.lessonHeading,
          engine: 'regex',
          severity: 'warning',
          compiledAt: now,
          ...(r.status ? { status: r.status } : {}),
          ...(r.archivedReason ? { archivedReason: r.archivedReason } : {}),
          ...(r.archivedAt ? { archivedAt: r.archivedAt } : {}),
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
        input_hash: '0000000000000000000000000000000000000000000000000000000000000000',
        output_hash: generateOutputHash(rulesPath),
        rule_count: rules.length,
      },
      null,
      2,
    ) + '\n',
    'utf-8',
  );
}

describe('lessonArchiveCommand (#1587)', () => {
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

  it('archives the target rule, refreshes manifest output_hash, and stamps archivedAt', async () => {
    setupWorkspace(tmpDir, [{ lessonHash: 'abc123def456abcd', lessonHeading: 'Use err in catch' }]);

    const totemDir = path.join(tmpDir, '.totem');
    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    const manifestPath = path.join(totemDir, 'compile-manifest.json');

    await lessonArchiveCommand('abc123def456abcd', { reason: 'Over-broad in test contexts' });

    const rulesAfter = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    const rule = rulesAfter.rules.find(
      (r: { lessonHash: string }) => r.lessonHash === 'abc123def456abcd',
    );
    expect(rule.status).toBe('archived');
    expect(rule.archivedReason).toBe('Over-broad in test contexts');
    expect(typeof rule.archivedAt).toBe('string');
    expect(rule.archivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const manifestAfter = readCompileManifest(manifestPath);
    expect(manifestAfter.output_hash).toBe(generateOutputHash(rulesPath));
  });

  // ── Prop 310 § Design 1 (MIN-8) — this writer attests the record class ──
  it('refreshes records_hash — the shipping writer reaches attestRecordsHash', async () => {
    // The wiring check, not a helper check: without the call site this manifest
    // keeps no `records_hash`, and `verify-manifest` then hard-FAILS "unattested
    // file class" on any repo carrying a tracked record. Run in a REAL git repo
    // with one STAGED record, so the attested value is neither the empty-set
    // constant nor an untracked-inclusive walk — a missing call site cannot
    // coincidentally produce it.
    setupWorkspace(tmpDir, [{ lessonHash: 'abc123def456abcd', lessonHeading: 'Use err in catch' }]);
    const totemDir = path.join(tmpDir, '.totem');
    const recordsDir = path.join(totemDir, 'rules');
    fs.mkdirSync(recordsDir, { recursive: true });
    fs.writeFileSync(path.join(recordsDir, 'tracked.rule.yaml'), 'schemaVersion: 1\n', 'utf-8');
    fs.writeFileSync(path.join(recordsDir, 'draft.rule.yaml'), 'schemaVersion: 1\n', 'utf-8');
    execFileSync('git', ['init', '-q'], { cwd: tmpDir });
    execFileSync('git', ['add', '.totem/rules/tracked.rule.yaml'], { cwd: tmpDir });

    await lessonArchiveCommand('abc123def456abcd', { reason: 'Over-broad in test contexts' });

    const manifestAfter = readCompileManifest(path.join(totemDir, 'compile-manifest.json'));
    expect(manifestAfter.records_hash).toBe(attestRecordsHash(totemDir, tmpDir));
    expect(manifestAfter.records_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(manifestAfter.records_hash).not.toBe(EMPTY_RECORDS_HASH);
    // …and it is the TRACKED-set value, not the untracked-inclusive walk.
    expect(manifestAfter.records_hash).not.toBe(attestRecordsHash(totemDir));
  });

  it('is idempotent on rerun: archivedReason refreshes, archivedAt is preserved', async () => {
    const originalArchivedAt = '2026-04-15T00:00:00.000Z';
    setupWorkspace(tmpDir, [
      {
        lessonHash: 'abc123def456abcd',
        lessonHeading: 'Use err in catch',
        status: 'archived',
        archivedReason: 'Original reason',
        archivedAt: originalArchivedAt,
      },
    ]);

    const totemDir = path.join(tmpDir, '.totem');
    const rulesPath = path.join(totemDir, 'compiled-rules.json');

    await lessonArchiveCommand('abc123def456abcd', { reason: 'Updated reason' });

    const rulesAfter = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    const rule = rulesAfter.rules.find(
      (r: { lessonHash: string }) => r.lessonHash === 'abc123def456abcd',
    );
    expect(rule.status).toBe('archived');
    expect(rule.archivedReason).toBe('Updated reason');
    expect(rule.archivedAt).toBe(originalArchivedAt);
  });

  it('accepts a hash prefix and resolves unambiguously', async () => {
    setupWorkspace(tmpDir, [
      { lessonHash: 'abc123def456abcd', lessonHeading: 'Rule A' },
      { lessonHash: 'def789ghi012efgh', lessonHeading: 'Rule B' },
    ]);

    const totemDir = path.join(tmpDir, '.totem');
    const rulesPath = path.join(totemDir, 'compiled-rules.json');

    await lessonArchiveCommand('abc12', { reason: 'prefix match' });

    const rulesAfter = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    const ruleA = rulesAfter.rules.find(
      (r: { lessonHash: string }) => r.lessonHash === 'abc123def456abcd',
    );
    const ruleB = rulesAfter.rules.find(
      (r: { lessonHash: string }) => r.lessonHash === 'def789ghi012efgh',
    );
    expect(ruleA.status).toBe('archived');
    expect(ruleB.status).toBeUndefined();
  });

  it('fails fast on unknown hash without mutating any files', async () => {
    setupWorkspace(tmpDir, [{ lessonHash: 'abc123def456abcd', lessonHeading: 'Use err in catch' }]);

    const totemDir = path.join(tmpDir, '.totem');
    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    const manifestPath = path.join(totemDir, 'compile-manifest.json');
    const rulesBefore = fs.readFileSync(rulesPath, 'utf-8');
    const manifestBefore = fs.readFileSync(manifestPath, 'utf-8');

    await lessonArchiveCommand('ffff', { reason: 'not matching anything' });

    expect(process.exitCode).toBe(1);
    process.exitCode = 0;

    expect(fs.readFileSync(rulesPath, 'utf-8')).toBe(rulesBefore);
    expect(fs.readFileSync(manifestPath, 'utf-8')).toBe(manifestBefore);
  });

  it('fails fast on ambiguous prefix without mutating any files', async () => {
    setupWorkspace(tmpDir, [
      { lessonHash: 'abc123def456abcd', lessonHeading: 'Rule A' },
      { lessonHash: 'abc999ghi012efgh', lessonHeading: 'Rule B' },
    ]);

    const totemDir = path.join(tmpDir, '.totem');
    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    const manifestPath = path.join(totemDir, 'compile-manifest.json');
    const rulesBefore = fs.readFileSync(rulesPath, 'utf-8');
    const manifestBefore = fs.readFileSync(manifestPath, 'utf-8');

    await lessonArchiveCommand('abc', { reason: 'ambiguous' });

    expect(process.exitCode).toBe(1);
    process.exitCode = 0;

    expect(fs.readFileSync(rulesPath, 'utf-8')).toBe(rulesBefore);
    expect(fs.readFileSync(manifestPath, 'utf-8')).toBe(manifestBefore);
  });

  it('fails before mutating compiled-rules.json when compile-manifest.json is corrupt', async () => {
    // Load-bearing atomicity contract (CR finding on PR #1629): the
    // preflight manifest read must fail out BEFORE any write to
    // compiled-rules.json. A corrupt manifest must not leave the rules
    // file half-archived.
    setupWorkspace(tmpDir, [{ lessonHash: 'abc123def456abcd', lessonHeading: 'Use err in catch' }]);

    const totemDir = path.join(tmpDir, '.totem');
    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    const manifestPath = path.join(totemDir, 'compile-manifest.json');

    fs.writeFileSync(manifestPath, '{ this is: not valid json }', 'utf-8');
    const rulesBefore = fs.readFileSync(rulesPath, 'utf-8'); // totem-ignore — test-fixture read, not static-analysis path

    await expect(
      lessonArchiveCommand('abc123def456abcd', { reason: 'should not apply' }),
    ).rejects.toMatchObject({ code: 'PARSE_FAILED' });

    // compiled-rules.json must be untouched.
    expect(fs.readFileSync(rulesPath, 'utf-8')).toBe(rulesBefore); // totem-ignore — test-fixture read, not static-analysis path
  });

  it('fails before mutating compiled-rules.json when compiled-rules.json itself has duplicate hashes', async () => {
    // Data-corruption surface (CR finding on PR mmnto-ai/totem#1629): duplicate full
    // hashes are not prefix ambiguity; fail fast with a distinct signal.
    setupWorkspace(tmpDir, [{ lessonHash: 'abc123def456abcd', lessonHeading: 'Rule A' }]);

    const totemDir = path.join(tmpDir, '.totem');
    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    const manifestPath = path.join(totemDir, 'compile-manifest.json');

    // Rewrite the rules file with two entries carrying the SAME lessonHash.
    const rulesJson = JSON.parse(fs.readFileSync(rulesPath, 'utf-8')); // totem-ignore — test-fixture read, not static-analysis path
    rulesJson.rules.push({ ...rulesJson.rules[0], lessonHeading: 'Rule A duplicate' });
    fs.writeFileSync(rulesPath, JSON.stringify(rulesJson, null, 2) + '\n', 'utf-8');

    const rulesBefore = fs.readFileSync(rulesPath, 'utf-8'); // totem-ignore — test-fixture read, not static-analysis path
    const manifestBefore = fs.readFileSync(manifestPath, 'utf-8'); // totem-ignore — test-fixture read, not static-analysis path

    await lessonArchiveCommand('abc123def456abcd', { reason: 'duplicate' });

    expect(process.exitCode).toBe(1);
    process.exitCode = 0;

    expect(fs.readFileSync(rulesPath, 'utf-8')).toBe(rulesBefore);
    expect(fs.readFileSync(manifestPath, 'utf-8')).toBe(manifestBefore);
  });

  it('uses a default reason when --reason is omitted', async () => {
    setupWorkspace(tmpDir, [{ lessonHash: 'abc123def456abcd', lessonHeading: 'Use err in catch' }]);

    const totemDir = path.join(tmpDir, '.totem');
    const rulesPath = path.join(totemDir, 'compiled-rules.json');

    await lessonArchiveCommand('abc123def456abcd', {});

    const rulesAfter = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    const rule = rulesAfter.rules.find(
      (r: { lessonHash: string }) => r.lessonHash === 'abc123def456abcd',
    );
    expect(rule.status).toBe('archived');
    expect(typeof rule.archivedReason).toBe('string');
    expect(rule.archivedReason.length).toBeGreaterThan(0);
  });
});

// ── The export path through the shared helper (mmnto-ai/totem#3036 B2, fold F10) ──

describe('lessonArchiveCommand regenerates the exports through exportLessonsForRules', () => {
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

  it('writes the archived rule with its reason, drops an untested rule, and matches the helper byte for byte', async () => {
    const kept = { heading: 'Use err in catch', body: 'Name the catch binding err.' };
    const untested = { heading: 'Untested lesson', body: 'Stage 4 could not tell.' };
    const keptHash = hashLesson(kept.heading, kept.body);
    const untestedHash = hashLesson(untested.heading, untested.body);
    setupWorkspace(tmpDir, [
      { lessonHash: keptHash, lessonHeading: kept.heading },
      { lessonHash: untestedHash, lessonHeading: untested.heading },
    ]);
    const totemDir = path.join(tmpDir, '.totem');
    const rulesPath = path.join(totemDir, 'compiled-rules.json');
    // Mark the second rule untested, and configure one export target.
    const file = JSON.parse(fs.readFileSync(rulesPath, 'utf-8')) as {
      rules: Array<Record<string, unknown>>;
    };
    file.rules[1]!['status'] = 'untested-against-codebase';
    fs.writeFileSync(rulesPath, JSON.stringify(file, null, 2) + '\n', 'utf-8');
    fs.writeFileSync(
      path.join(tmpDir, 'totem.config.ts'),
      [
        'export default {',
        '  targets: [{ glob: "**/*.ts", type: "code", strategy: "typescript-ast" }],',
        '  totemDir: ".totem",',
        '  exports: { agents: "EXPORTED.md" },',
        '};',
        '',
      ].join('\n'),
      'utf-8',
    );
    const lessonsDir = path.join(totemDir, 'lessons');
    fs.mkdirSync(lessonsDir, { recursive: true });
    for (const [name, l] of [
      ['kept.md', kept],
      ['untested.md', untested],
    ] as const) {
      fs.writeFileSync(
        path.join(lessonsDir, name),
        `## Lesson — ${l.heading}\n\n**Tags:** test\n\n${l.body}\n`,
        'utf-8',
      );
    }

    await lessonArchiveCommand(keptHash, { reason: 'Over-broad in tests' });

    const exported = fs.readFileSync(path.join(tmpDir, 'EXPORTED.md'), 'utf-8');
    expect(exported).toContain('Use err in catch');
    expect(exported).toContain('_(archived: Over-broad in tests)_');
    expect(exported).not.toContain('Untested lesson');
    const rulesAfter = (JSON.parse(fs.readFileSync(rulesPath, 'utf-8')) as { rules: never[] })
      .rules;
    // The bytes are what the shared helper renders for the rules on disk.
    const [rendered] = renderLessonExportsForRules(
      readAllLessons(totemDir),
      rulesAfter,
      { agents: 'EXPORTED.md' },
      tmpDir,
    );
    expect(rendered!.content).toBe(exported);
  });
});
