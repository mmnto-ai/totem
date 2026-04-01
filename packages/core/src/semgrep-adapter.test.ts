import { describe, expect, it } from 'vitest';

import { parseSemgrepRules } from './semgrep-adapter.js';

describe('parseSemgrepRules', () => {
  it('parses rule with pattern-regex', () => {
    const yaml = `
rules:
  - id: no-eval
    pattern-regex: "\\\\beval\\\\s*\\\\("
    message: Do not use eval()
    severity: ERROR
    languages: [javascript, typescript]
`;
    const result = parseSemgrepRules(yaml);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]!.lessonHeading).toBe('[semgrep] no-eval');
    expect(result.rules[0]!.pattern).toBe('\\beval\\s*\\(');
    expect(result.rules[0]!.severity).toBe('error');
    expect(result.rules[0]!.engine).toBe('regex');
    expect(result.rules[0]!.fileGlobs).toEqual(['**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx']);
  });

  it('parses rule with simple string pattern', () => {
    const yaml = `
rules:
  - id: no-print
    pattern: "print(...)"
    message: Use logging module instead of print
    severity: WARNING
    languages: [python]
`;
    const result = parseSemgrepRules(yaml);
    expect(result.rules).toHaveLength(1);
    expect(result.rules[0]!.pattern).toContain('print');
    expect(result.rules[0]!.pattern).toContain('.*'); // ... converted to .*
    expect(result.rules[0]!.severity).toBe('warning');
  });

  it('maps severity correctly', () => {
    const yaml = `
rules:
  - id: rule-error
    pattern-regex: "err"
    message: Error rule
    severity: ERROR
  - id: rule-warn
    pattern-regex: "warn"
    message: Warn rule
    severity: WARNING
  - id: rule-info
    pattern-regex: "info"
    message: Info rule
    severity: INFO
`;
    const result = parseSemgrepRules(yaml);
    expect(result.rules[0]!.severity).toBe('error');
    expect(result.rules[1]!.severity).toBe('warning');
    expect(result.rules[2]!.severity).toBe('warning'); // INFO maps to warning
  });

  it('handles paths.include and paths.exclude', () => {
    const yaml = `
rules:
  - id: scoped-rule
    pattern-regex: "TODO"
    message: No TODOs
    severity: WARNING
    paths:
      include:
        - "src/**/*.ts"
      exclude:
        - "**/*.test.ts"
`;
    const result = parseSemgrepRules(yaml);
    expect(result.rules[0]!.fileGlobs).toEqual(['src/**/*.ts', '!**/*.test.ts']);
  });

  it('skips compound patterns and reports them', () => {
    const yaml = `
rules:
  - id: compound-rule
    patterns:
      - pattern: "eval(...)"
      - pattern-not: "safe_eval(...)"
    message: Compound rule
    severity: ERROR
`;
    const result = parseSemgrepRules(yaml);
    expect(result.rules).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]!.id).toBe('compound-rule');
    expect(result.skipped[0]!.reason).toContain('Compound');
  });

  it('skips rules without pattern fields', () => {
    const yaml = `
rules:
  - id: no-pattern
    message: No pattern
    severity: WARNING
`;
    const result = parseSemgrepRules(yaml);
    expect(result.rules).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });

  it('handles invalid YAML gracefully', () => {
    const result = parseSemgrepRules('{{{{not yaml');
    expect(result.rules).toHaveLength(0);
    expect(result.skipped[0]!.reason).toContain('Invalid YAML');
  });

  it('handles missing rules array', () => {
    const result = parseSemgrepRules('other: value');
    expect(result.rules).toHaveLength(0);
    expect(result.skipped[0]!.reason).toContain('No "rules" array');
  });

  it('produces deterministic lessonHash', () => {
    const yaml = `
rules:
  - id: deterministic
    pattern-regex: "test"
    message: Test rule
    severity: WARNING
`;
    const r1 = parseSemgrepRules(yaml);
    const r2 = parseSemgrepRules(yaml);
    expect(r1.rules[0]!.lessonHash).toBe(r2.rules[0]!.lessonHash);
  });

  it('maps metadata.category', () => {
    const yaml = `
rules:
  - id: sec-rule
    pattern-regex: "secret"
    message: Secret detected
    severity: ERROR
    metadata:
      category: security
`;
    const result = parseSemgrepRules(yaml);
    expect(result.rules[0]!.category).toBe('security');
  });
});
