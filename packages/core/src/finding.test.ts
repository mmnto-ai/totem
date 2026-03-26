import { describe, expect, it } from 'vitest';

import type { CompiledRule, Violation } from './compiler-schema.js';
import { violationToFinding } from './finding.js';

// ─── Helpers ────────────────────────────────────────

function makeRule(overrides: Partial<CompiledRule> = {}): CompiledRule {
  return {
    lessonHash: 'abc123',
    lessonHeading: 'Test rule heading',
    pattern: 'console\\.log',
    message: 'Avoid console.log in production code',
    engine: 'regex',
    compiledAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeViolation(overrides: Partial<Violation> = {}): Violation {
  return {
    rule: makeRule(),
    file: 'src/foo.ts',
    line: '  console.log("debug");',
    lineNumber: 42,
    ...overrides,
  };
}

// ─── violationToFinding ─────────────────────────────

describe('violationToFinding', () => {
  it('converts a basic violation to a finding', () => {
    const v = makeViolation();
    const f = violationToFinding(v);

    expect(f.id).toBe('abc123');
    expect(f.source).toBe('lint');
    expect(f.severity).toBe('error');
    expect(f.message).toBe('Avoid console.log in production code');
    expect(f.file).toBe('src/foo.ts');
    expect(f.line).toBe(42);
    expect(f.matchedLine).toBe('  console.log("debug");');
    expect(f.ruleHeading).toBe('Test rule heading');
    expect(f.confidence).toBe(1.0);
  });

  it('maps warning severity correctly', () => {
    const v = makeViolation({ rule: makeRule({ severity: 'warning' }) });
    const f = violationToFinding(v);
    expect(f.severity).toBe('warning');
  });

  it('defaults to error when severity is undefined', () => {
    const v = makeViolation({ rule: makeRule({ severity: undefined }) });
    const f = violationToFinding(v);
    expect(f.severity).toBe('error');
  });

  it('preserves category from rule', () => {
    const v = makeViolation({ rule: makeRule({ category: 'security' }) });
    const f = violationToFinding(v);
    expect(f.category).toBe('security');
  });

  it('handles missing category gracefully', () => {
    const v = makeViolation({ rule: makeRule({ category: undefined }) });
    const f = violationToFinding(v);
    expect(f.category).toBeUndefined();
  });
});
