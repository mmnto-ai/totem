import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { downgradeRuleToWarning } from './rule-mutator.js';

// ─── Helpers ────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'totem-rule-mutator-'));
}

function makeCompiledRules(
  rules: Array<{
    lessonHash: string;
    lessonHeading: string;
    severity?: string;
    pattern?: string;
  }>,
): object {
  return {
    version: 1,
    rules: rules.map((r) => ({
      lessonHash: r.lessonHash,
      lessonHeading: r.lessonHeading,
      pattern: r.pattern ?? '\\bconsole\\.log\\b',
      message: `Violation: ${r.lessonHeading}`,
      engine: 'regex',
      compiledAt: '2026-03-25T12:00:00.000Z',
      ...(r.severity !== undefined ? { severity: r.severity } : {}),
    })),
  };
}

function writeRules(dir: string, data: object): string {
  const rulesPath = path.join(dir, 'compiled-rules.json');
  fs.writeFileSync(rulesPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  return rulesPath;
}

// ─── downgradeRuleToWarning ─────────────────────────────

describe('downgradeRuleToWarning', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('changes error to warning', () => {
    const rulesPath = writeRules(
      tmpDir,
      makeCompiledRules([
        { lessonHash: 'abc123', lessonHeading: 'No console.log', severity: 'error' },
      ]),
    );

    const result = downgradeRuleToWarning(rulesPath, 'abc123');
    expect(result.downgraded).toBe(true);
    expect(result.previousSeverity).toBe('error');
    expect(result.ruleHeading).toBe('No console.log');

    // Verify the file was updated
    const updated = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    expect(updated.rules[0].severity).toBe('warning');
  });

  it('downgrades rules with implicit error severity (no severity field)', () => {
    const rulesPath = writeRules(
      tmpDir,
      makeCompiledRules([
        { lessonHash: 'abc123', lessonHeading: 'No console.log' }, // no severity = defaults to error
      ]),
    );

    const result = downgradeRuleToWarning(rulesPath, 'abc123');
    expect(result.downgraded).toBe(true);
    expect(result.previousSeverity).toBe('error');

    const updated = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    expect(updated.rules[0].severity).toBe('warning');
  });

  it('skips rules already at warning (idempotent)', () => {
    const rulesPath = writeRules(
      tmpDir,
      makeCompiledRules([
        { lessonHash: 'abc123', lessonHeading: 'No console.log', severity: 'warning' },
      ]),
    );

    const result = downgradeRuleToWarning(rulesPath, 'abc123');
    expect(result.downgraded).toBe(false);
    expect(result.previousSeverity).toBe('warning');
    expect(result.ruleHeading).toBe('No console.log');
  });

  it('returns false for unknown ruleId', () => {
    const rulesPath = writeRules(
      tmpDir,
      makeCompiledRules([
        { lessonHash: 'abc123', lessonHeading: 'No console.log', severity: 'error' },
      ]),
    );

    const result = downgradeRuleToWarning(rulesPath, 'nonexistent');
    expect(result.downgraded).toBe(false);
    expect(result.previousSeverity).toBeUndefined();
    expect(result.ruleHeading).toBeUndefined();
  });

  it('preserves JSON formatting (2-space indent)', () => {
    const rulesPath = writeRules(
      tmpDir,
      makeCompiledRules([
        { lessonHash: 'abc123', lessonHeading: 'No console.log', severity: 'error' },
      ]),
    );

    downgradeRuleToWarning(rulesPath, 'abc123');

    const content = fs.readFileSync(rulesPath, 'utf-8');
    // Verify 2-space indentation is preserved
    expect(content).toContain('  "version"');
    expect(content).toContain('    "lessonHash"');
    // Verify trailing newline
    expect(content.endsWith('\n')).toBe(true);
  });

  it('preserves other rules unchanged', () => {
    const rulesPath = writeRules(
      tmpDir,
      makeCompiledRules([
        { lessonHash: 'rule-1', lessonHeading: 'First rule', severity: 'error' },
        { lessonHash: 'rule-2', lessonHeading: 'Second rule', severity: 'error' },
        { lessonHash: 'rule-3', lessonHeading: 'Third rule', severity: 'warning' },
      ]),
    );

    downgradeRuleToWarning(rulesPath, 'rule-1');

    const updated = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
    expect(updated.rules[0].severity).toBe('warning'); // downgraded
    expect(updated.rules[1].severity).toBe('error'); // unchanged
    expect(updated.rules[2].severity).toBe('warning'); // unchanged
    expect(updated.rules).toHaveLength(3); // no rules deleted (ADR-027)
  });
});
