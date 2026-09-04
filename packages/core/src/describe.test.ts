import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadCompiledRules } from './compiler.js';
import { type TotemConfig, TotemConfigSchema } from './config-schema.js';
import { describeProject } from './describe.js';

// ─── Fixture helpers ─────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-describe-'));
}

function makeMinimalConfig(): TotemConfig {
  // Use schema parse to fill in defaults for fields describeProject
  // doesn't read but `TotemConfig` requires (lanceDir, ignorePatterns,
  // shieldIgnorePatterns, contextWarningThreshold, etc).
  return TotemConfigSchema.parse({
    targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
    totemDir: '.totem',
    orchestrator: {
      provider: 'shell',
      command: 'echo unused',
      defaultModel: 'test-model',
    },
  });
}

/**
 * A schema-valid compiled-rules file. `statuses[i]` sets the i-th rule's
 * lifecycle status (absent = legacy/active, mmnto-ai/totem#1345).
 */
function writeRulesFile(
  totemDir: string,
  ruleCount: number,
  statuses: (string | undefined)[] = [],
): void {
  fs.mkdirSync(totemDir, { recursive: true });
  const rules = Array.from({ length: ruleCount }, (_, i) => ({
    lessonHash: `hash${String(i).padStart(8, '0')}`,
    lessonHeading: `Rule ${i}`,
    pattern: 'dummy',
    message: `Rule ${i} message`,
    engine: 'regex',
    compiledAt: '2026-05-11T00:00:00Z',
    ...(statuses[i] !== undefined ? { status: statuses[i] } : {}),
  }));
  fs.writeFileSync(
    path.join(totemDir, 'compiled-rules.json'),
    JSON.stringify({ version: 1, rules, nonCompilable: [] }, null, 2) + '\n',
    'utf-8',
  );
}

// ─── Tests ──────────────────────────────────────────

describe('describeProject — rules count (mmnto-ai/totem#1884 R1)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('reports the rules array length from a well-formed compiled-rules.json', () => {
    // Regression test for the prior `Array.isArray(parsed)` bug that
    // checked the top-level object (always false) instead of `parsed.rules`
    // (the actual array). Pre-fix, this assertion would have failed with
    // `received: 0` for every non-zero rule count.
    const totemDir = path.join(tmpDir, '.totem');
    writeRulesFile(totemDir, 7);

    const result = describeProject(makeMinimalConfig(), tmpDir);

    expect(result.rules).toBe(7);
  });

  // mmnto-ai/totem#2765 — the describe half of the mmnto-ai/totem#2388 parity.
  // On the pre-fix code `rules` is the raw length (10 here) while lint's loader
  // returns 6; the banner quoted a number lint never enforced.
  it('counts the ACTIVE set through the same predicate lint loads with, and reports the inert split', () => {
    const totemDir = path.join(tmpDir, '.totem');
    writeRulesFile(totemDir, 10, [
      undefined, // legacy, no status → active
      'active',
      'archived',
      undefined,
      'untested-against-codebase',
      'archived',
      'pending-verification',
      undefined,
      'archived',
      'active',
    ]);
    const result = describeProject(makeMinimalConfig(), tmpDir);
    expect(result.rulesSource).toBe('compiled-rules');
    expect(result.rules).toBe(5);
    expect(result.rulesCompiled).toBe(10);
    expect(result.rulesArchived).toBe(3);
    expect(result.rulesUntested).toBe(1);
    expect(result.rulesPendingVerification).toBe(1);
    // Parity by construction: the enforcement loader's count IS the banner's count.
    expect(result.rules).toBe(loadCompiledRules(path.join(totemDir, 'compiled-rules.json')).length);
    expect(
      result.rules + result.rulesArchived + result.rulesUntested + result.rulesPendingVerification,
    ).toBe(result.rulesCompiled);
  });

  // A PIN for the new fields, not a falsifier: with nothing inert the old
  // reader already returned 4 for `rules`; only `rulesCompiled` is new here.
  it('a file with nothing inert reports rules === rulesCompiled and a zero split', () => {
    const totemDir = path.join(tmpDir, '.totem');
    writeRulesFile(totemDir, 4);
    const result = describeProject(makeMinimalConfig(), tmpDir);
    expect(result.rules).toBe(4);
    expect(result.rulesCompiled).toBe(4);
    expect(result.rulesArchived + result.rulesUntested + result.rulesPendingVerification).toBe(0);
  });

  it('reports zeros labelled unreadable, and does not throw, when the file is valid JSON but fails the compiled-rules schema', () => {
    const totemDir = path.join(tmpDir, '.totem');
    // The pre-fix reader counted any `rules` array (1 here); lint's loader
    // refuses this file. (`totem status` falls back to the manifest's raw
    // rule_count for it — its own fallback, not mirrored here.)
    fs.mkdirSync(totemDir, { recursive: true });
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify({ version: 1, rules: [{ id: 'not-a-compiled-rule' }] }),
      'utf-8',
    );
    const result = describeProject(makeMinimalConfig(), tmpDir);
    expect(result.rules).toBe(0);
    expect(result.rulesCompiled).toBe(0);
    expect(result.rulesSource).toBe('unreadable');
  });

  it('reports 0 when compiled-rules.json is absent (graceful fallback)', () => {
    fs.mkdirSync(path.join(tmpDir, '.totem'), { recursive: true });
    const result = describeProject(makeMinimalConfig(), tmpDir);
    expect(result.rules).toBe(0);
  });

  it('reports 0 labelled unreadable when compiled-rules.json is not JSON (does not throw)', () => {
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });
    fs.writeFileSync(path.join(totemDir, 'compiled-rules.json'), 'not valid json {', 'utf-8');

    const result = describeProject(makeMinimalConfig(), tmpDir);

    expect(result.rules).toBe(0);
    // The loader WARNS and returns an empty envelope for non-JSON rather than
    // throwing, so the label is read off its warning seam; before that read
    // this file reported `compiled-rules` with zeros (the re-armed leg's F10).
    expect(result.rulesSource).toBe('unreadable');
    expect(result.rulesCompiled).toBe(0);
  });

  it('reports 0 when compiled-rules.json is an array (defensive against schema drift)', () => {
    // The defensive guard returns 0 if `parsed.rules` is not an array,
    // including the degenerate case where someone hand-writes an array at
    // the top level instead of the canonical object envelope.
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });
    fs.writeFileSync(
      path.join(totemDir, 'compiled-rules.json'),
      JSON.stringify([{ lessonHash: 'x', lessonHeading: 'y' }], null, 2),
      'utf-8',
    );

    const result = describeProject(makeMinimalConfig(), tmpDir);

    expect(result.rules).toBe(0);
  });
});
