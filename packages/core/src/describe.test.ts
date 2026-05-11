import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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

function writeRulesFile(totemDir: string, ruleCount: number): void {
  fs.mkdirSync(totemDir, { recursive: true });
  const rules = Array.from({ length: ruleCount }, (_, i) => ({
    lessonHash: `hash${String(i).padStart(8, '0')}`,
    lessonHeading: `Rule ${i}`,
    pattern: 'dummy',
    message: `Rule ${i} message`,
    engine: 'regex',
    compiledAt: '2026-05-11T00:00:00Z',
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

  it('reports 0 when compiled-rules.json is absent (graceful fallback)', () => {
    fs.mkdirSync(path.join(tmpDir, '.totem'), { recursive: true });
    const result = describeProject(makeMinimalConfig(), tmpDir);
    expect(result.rules).toBe(0);
  });

  it('reports 0 when compiled-rules.json is malformed (does not throw)', () => {
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });
    fs.writeFileSync(path.join(totemDir, 'compiled-rules.json'), 'not valid json {', 'utf-8');

    const result = describeProject(makeMinimalConfig(), tmpDir);

    expect(result.rules).toBe(0);
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
