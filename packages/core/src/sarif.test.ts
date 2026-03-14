import { describe, expect, it } from 'vitest';

import type { CompiledRule, Violation } from './compiler.js';
import { buildSarifLog, ruleId } from './sarif.js';

// ─── Fixtures ────────────────────────────────────────

const RULE_A: CompiledRule = {
  lessonHash: 'abc12345deadbeef',
  lessonHeading: 'Avoid hardcoded secrets',
  pattern: 'password\\s*=',
  message: 'Do not hardcode passwords in source code.',
  engine: 'regex',
  compiledAt: '2026-03-14T00:00:00Z',
};

const RULE_B: CompiledRule = {
  lessonHash: 'cafebabe12345678',
  lessonHeading: 'Avoid deprecated substr method',
  pattern: '\\.substr\\(',
  message: 'Use .substring() or .slice() instead of deprecated .substr().',
  engine: 'regex',
  compiledAt: '2026-03-14T00:00:00Z',
  fileGlobs: ['*.ts'],
};

const VIOLATION_A: Violation = {
  rule: RULE_A,
  file: 'src/config.ts',
  line: '  const password = "hunter2";',
  lineNumber: 42,
};

const VIOLATION_B: Violation = {
  rule: RULE_B,
  file: 'src/utils.ts',
  line: '  const slug = title.substr(0, 10);',
  lineNumber: 17,
};

// ─── Tests ───────────────────────────────────────────

describe('ruleId', () => {
  it('produces totem/<hash> format', () => {
    expect(ruleId(RULE_A)).toBe('totem/abc12345deadbeef');
  });
});

describe('buildSarifLog', () => {
  it('produces valid SARIF 2.1.0 structure with zero violations', () => {
    const sarif = buildSarifLog([], [RULE_A, RULE_B], { version: '0.31.0' });

    expect(sarif.version).toBe('2.1.0');
    expect(sarif.$schema).toContain('sarif-schema-2.1.0');
    expect(sarif.runs).toHaveLength(1);

    const run = sarif.runs[0]!;
    expect(run.tool.driver.name).toBe('totem-shield');
    expect(run.tool.driver.version).toBe('0.31.0');
    expect(run.tool.driver.properties.llm_calls).toBe(0);
    expect(run.tool.driver.rules).toHaveLength(2);
    expect(run.results).toHaveLength(0);
    expect(run.invocations[0]!.executionSuccessful).toBe(true);
  });

  it('maps violations to SARIF results with correct fields', () => {
    const sarif = buildSarifLog([VIOLATION_A, VIOLATION_B], [RULE_A, RULE_B], {
      version: '0.31.0',
      commitHash: 'abc1234',
    });

    const run = sarif.runs[0]!;
    expect(run.results).toHaveLength(2);

    const result0 = run.results[0]!;
    expect(result0.ruleId).toBe('totem/abc12345deadbeef');
    expect(result0.ruleIndex).toBe(0);
    expect(result0.level).toBe('error');
    expect(result0.message.text).toContain('Do not hardcode passwords');
    expect(result0.message.text).toContain('hunter2');
    expect(result0.locations[0]!.physicalLocation.artifactLocation.uri).toBe('src/config.ts');
    expect(result0.locations[0]!.physicalLocation.region.startLine).toBe(42);

    const result1 = run.results[1]!;
    expect(result1.ruleId).toBe('totem/cafebabe12345678');
    expect(result1.ruleIndex).toBe(1);
    expect(result1.locations[0]!.physicalLocation.region.startLine).toBe(17);
  });

  it('includes commit_hash in tool properties when provided', () => {
    const sarif = buildSarifLog([], [RULE_A], { version: '0.31.0', commitHash: 'deadbeef' });
    expect(sarif.runs[0]!.tool.driver.properties.commit_hash).toBe('deadbeef');
  });

  it('omits commit_hash when not provided', () => {
    const sarif = buildSarifLog([], [RULE_A], { version: '0.31.0' });
    expect(sarif.runs[0]!.tool.driver.properties).not.toHaveProperty('commit_hash');
  });

  it('includes fileGlobs in rule properties when present', () => {
    const sarif = buildSarifLog([], [RULE_B], { version: '0.31.0' });
    const ruleProps = sarif.runs[0]!.tool.driver.rules[0]!.properties;
    expect(ruleProps).toHaveProperty('fileGlobs', ['*.ts']);
  });

  it('deduplicates rules by lessonHash', () => {
    const sarif = buildSarifLog(
      [VIOLATION_A, { ...VIOLATION_A, lineNumber: 99 }],
      [RULE_A, RULE_A],
      { version: '0.31.0' },
    );
    expect(sarif.runs[0]!.tool.driver.rules).toHaveLength(1);
    expect(sarif.runs[0]!.results).toHaveLength(2);
  });

  it('sets executionSuccessful to false when violations exist', () => {
    const sarif = buildSarifLog([VIOLATION_A], [RULE_A], { version: '0.31.0' });
    expect(sarif.runs[0]!.invocations[0]!.executionSuccessful).toBe(false);
  });

  it('records rules_enforced and violations_found in invocation properties', () => {
    const sarif = buildSarifLog([VIOLATION_A], [RULE_A, RULE_B], { version: '0.31.0' });
    const props = sarif.runs[0]!.invocations[0]!.properties;
    expect(props).toEqual({ rules_enforced: 2, violations_found: 1 });
  });
});
