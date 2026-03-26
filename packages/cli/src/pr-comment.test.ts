import { describe, expect, it } from 'vitest';

import type { CompiledRule, Violation } from '@mmnto/totem';
import type { TotemFinding } from '@mmnto/totem';

import {
  buildPRCommentMarkdown,
  deduplicateFindings,
  deduplicateViolations,
  type PRSummaryData,
} from './pr-comment.js';

// ─── Helpers ─────────────────────────────────────────

function makeRule(overrides: Partial<CompiledRule> = {}): CompiledRule {
  return {
    lessonHash: 'abc123',
    lessonHeading: 'Test rule',
    pattern: '/test/',
    message: 'Test violation message',
    engine: 'regex',
    compiledAt: '2026-01-01T00:00:00Z',
    severity: 'warning',
    ...overrides,
  };
}

function makeViolation(
  overrides: Omit<Partial<Violation>, 'rule'> & { rule?: Partial<CompiledRule> } = {},
): Violation {
  const { rule: ruleOverrides, ...rest } = overrides;
  return {
    rule: makeRule(ruleOverrides),
    file: 'src/index.ts',
    line: 'const x = 1;',
    lineNumber: 10,
    ...rest,
  } as Violation;
}

// ─── deduplicateViolations ───────────────────────────

describe('deduplicateViolations', () => {
  it('deduplicates findings with identical file and line', () => {
    const violations = [
      makeViolation({ rule: { lessonHash: 'a', message: 'Rule A' } }),
      makeViolation({ rule: { lessonHash: 'b', message: 'Rule B' } }),
      makeViolation({ rule: { lessonHash: 'c', message: 'Rule C' } }),
    ];

    const findings = deduplicateViolations(violations);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.ruleCount).toBe(3);
    expect(findings[0]!.file).toBe('src/index.ts');
    expect(findings[0]!.line).toBe(10);
  });

  it('escalates severity to error if any rule is error', () => {
    const violations = [
      makeViolation({ rule: { lessonHash: 'a', severity: 'warning' } }),
      makeViolation({ rule: { lessonHash: 'b', severity: 'error' } }),
      makeViolation({ rule: { lessonHash: 'c', severity: 'warning' } }),
    ];

    const findings = deduplicateViolations(violations);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe('error');
  });

  it('keeps distinct file+line combinations separate', () => {
    const violations = [
      makeViolation({ file: 'a.ts', lineNumber: 1 }),
      makeViolation({ file: 'a.ts', lineNumber: 2 }),
      makeViolation({ file: 'b.ts', lineNumber: 1 }),
    ];

    const findings = deduplicateViolations(violations);
    expect(findings).toHaveLength(3);
  });

  it('sorts errors before warnings, then by file and line', () => {
    const violations = [
      makeViolation({ file: 'z.ts', lineNumber: 1, rule: { severity: 'warning' } }),
      makeViolation({ file: 'a.ts', lineNumber: 1, rule: { severity: 'error' } }),
      makeViolation({ file: 'a.ts', lineNumber: 2, rule: { severity: 'warning' } }),
    ];

    const findings = deduplicateViolations(violations);
    expect(findings[0]!.file).toBe('a.ts');
    expect(findings[0]!.severity).toBe('error');
    expect(findings[1]!.file).toBe('a.ts');
    expect(findings[1]!.line).toBe(2);
    expect(findings[2]!.file).toBe('z.ts');
  });

  it('returns empty array for no violations', () => {
    expect(deduplicateViolations([])).toEqual([]);
  });

  it('treats missing severity as error', () => {
    const violations = [makeViolation({ rule: { severity: undefined } })];

    const findings = deduplicateViolations(violations);
    expect(findings[0]!.severity).toBe('error');
  });
});

// ─── buildPRCommentMarkdown ──────────────────────────

describe('buildPRCommentMarkdown', () => {
  const baseSummary: PRSummaryData = {
    totalRules: 282,
    errors: 0,
    warnings: 0,
    findings: [],
    commitSha: 'abc1234567890',
    durationMs: 1500,
  };

  it('includes totem-lint marker', () => {
    const md = buildPRCommentMarkdown(baseSummary);
    expect(md).toContain('<!-- totem-lint -->');
  });

  it('shows PASS with green emoji for zero violations', () => {
    const md = buildPRCommentMarkdown(baseSummary);
    expect(md).toContain('🟢 **Totem Lint — PASS**');
    expect(md).toContain('282 rules');
    expect(md).toContain('No violations detected.');
  });

  it('shows FAIL with red emoji for errors', () => {
    const md = buildPRCommentMarkdown({
      ...baseSummary,
      errors: 2,
      warnings: 3,
      findings: [
        { file: 'a.ts', line: 1, message: 'Bad', severity: 'error', ruleCount: 1 },
        { file: 'b.ts', line: 2, message: 'Also bad', severity: 'error', ruleCount: 1 },
        { file: 'c.ts', line: 3, message: 'Meh', severity: 'warning', ruleCount: 3 },
      ],
    });
    expect(md).toContain('🔴 **Totem Lint — FAIL**');
    expect(md).toContain('2 error(s)');
    expect(md).toContain('3 warning(s)');
  });

  it('renders findings as a markdown table', () => {
    const md = buildPRCommentMarkdown({
      ...baseSummary,
      warnings: 1,
      findings: [
        {
          file: 'src/foo.ts',
          line: 42,
          message: 'Use onWarn callback',
          severity: 'warning',
          ruleCount: 5,
        },
      ],
    });
    expect(md).toContain('| `src/foo.ts` | 42 |');
    expect(md).toContain('5 rules');
    expect(md).toContain('🟡 warning');
  });

  it('truncates table to 50 rows and shows overflow message', () => {
    const findings = Array.from({ length: 75 }, (_, i) => ({
      file: `file-${i}.ts`,
      line: i + 1,
      message: `Violation ${i}`,
      severity: 'warning' as const,
      ruleCount: 1,
    }));

    const md = buildPRCommentMarkdown({
      ...baseSummary,
      warnings: 75,
      findings,
    });

    // Count table rows (lines starting with |, excluding header)
    const tableRows = md.split('\n').filter((l) => l.startsWith('| `'));
    expect(tableRows).toHaveLength(50);
    expect(md).toContain('...and 25 more finding(s)');
  });

  it('truncates long messages', () => {
    const longMsg = 'A'.repeat(100);
    const md = buildPRCommentMarkdown({
      ...baseSummary,
      warnings: 1,
      findings: [{ file: 'a.ts', line: 1, message: longMsg, severity: 'warning', ruleCount: 1 }],
    });
    expect(md).toContain('...');
    expect(md).not.toContain(longMsg);
  });

  it('includes commit SHA and duration in footer', () => {
    const md = buildPRCommentMarkdown(baseSummary);
    expect(md).toContain('abc1234');
    expect(md).toContain('1.5s');
    expect(md).toContain('zero LLM calls');
  });
});

// ─── deduplicateFindings (ADR-071) ─────────────────

describe('deduplicateFindings', () => {
  function makeFinding(overrides: Partial<TotemFinding> = {}): TotemFinding {
    return {
      id: 'rule1',
      source: 'lint',
      severity: 'error',
      message: 'Test finding',
      file: 'src/foo.ts',
      line: 10,
      confidence: 1.0,
      ...overrides,
    };
  }

  it('deduplicates findings at the same file:line', () => {
    const findings = [makeFinding({ id: 'rule1' }), makeFinding({ id: 'rule2' })];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
    expect(result[0]!.ruleCount).toBe(2);
  });

  it('preserves highest severity when deduplicating', () => {
    const findings = [
      makeFinding({ id: 'rule1', severity: 'warning' }),
      makeFinding({ id: 'rule2', severity: 'error' }),
    ];
    const result = deduplicateFindings(findings);
    expect(result[0]!.severity).toBe('error');
  });

  it('keeps findings at different locations separate', () => {
    const findings = [
      makeFinding({ file: 'a.ts', line: 1 }),
      makeFinding({ file: 'b.ts', line: 2 }),
    ];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(2);
  });

  it('handles findings with optional file/line', () => {
    const findings = [makeFinding({ file: undefined, line: undefined })];
    const result = deduplicateFindings(findings);
    expect(result).toHaveLength(1);
    expect(result[0]!.file).toBe('');
    expect(result[0]!.line).toBe(0);
  });
});
