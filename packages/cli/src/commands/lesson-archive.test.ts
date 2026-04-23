import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { generateOutputHash, readCompileManifest } from '@mmnto/totem';

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
