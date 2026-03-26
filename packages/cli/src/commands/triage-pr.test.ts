import { describe, expect, it } from 'vitest';

import type { CategorizedFinding } from '../parsers/triage-types.js';
import { formatTriageOutput } from './triage-pr.js';

// ─── Identity color functions (no ANSI for test assertions) ──

const noColor = {
  red: (s: string) => s,
  yellow: (s: string) => s,
  blue: (s: string) => s,
  gray: (s: string) => s,
  bold: (s: string) => s,
};

// ─── Test data factories ─────────────────────────────

function makeFinding(overrides: Partial<CategorizedFinding> = {}): CategorizedFinding {
  return {
    tool: 'coderabbit',
    severity: 'minor',
    file: 'src/handler.ts',
    line: 42,
    body: 'Avoid using `any` type here.',
    triageCategory: 'convention',
    dedupKey: 'test-key',
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────

describe('formatTriageOutput', () => {
  it('groups findings by category', () => {
    const findings: CategorizedFinding[] = [
      makeFinding({
        triageCategory: 'security',
        body: 'Shell injection risk',
        file: 'doctor.ts',
        line: 412,
      }),
      makeFinding({
        triageCategory: 'convention',
        body: 'Missing tag',
        file: 'utils.ts',
        line: 10,
      }),
      makeFinding({ triageCategory: 'nit', body: 'Typo in docs', file: 'README.md', line: 5 }),
    ];

    const output = formatTriageOutput(953, findings, 10, noColor);

    // Categories should appear in order: security, convention, nit
    const secIdx = output.indexOf('SECURITY');
    const convIdx = output.indexOf('CONVENTION');
    const nitIdx = output.indexOf('NITS');

    expect(secIdx).toBeGreaterThan(-1);
    expect(convIdx).toBeGreaterThan(-1);
    expect(nitIdx).toBeGreaterThan(-1);
    expect(secIdx).toBeLessThan(convIdx);
    expect(convIdx).toBeLessThan(nitIdx);
  });

  it('shows merged findings with file list', () => {
    const merged = makeFinding({
      triageCategory: 'architecture',
      body: 'Empty catch blocks',
      file: 'add-secret.ts',
      line: 78,
      mergedWith: [
        {
          tool: 'coderabbit',
          severity: 'minor',
          file: 'sanitize.ts',
          line: 161,
          body: 'Empty catch blocks',
        },
      ],
    });

    const output = formatTriageOutput(953, [merged], 5, noColor);

    expect(output).toContain('(merged)');
    expect(output).toContain('add-secret.ts:78');
    expect(output).toContain('sanitize.ts:161');
    expect(output).toContain('[1,2]');
  });

  it('shows bot attribution', () => {
    const findings: CategorizedFinding[] = [
      makeFinding({
        triageCategory: 'security',
        tool: 'coderabbit',
        severity: 'minor',
        body: 'Shell injection risk',
        mergedWith: [
          {
            tool: 'gca',
            severity: 'medium',
            file: 'doctor.ts',
            line: 412,
            body: 'Shell injection risk',
          },
        ],
      }),
    ];

    const output = formatTriageOutput(953, findings, 4, noColor);

    expect(output).toContain('CR/minor');
    expect(output).toContain('GCA/medium');
  });

  it('handles empty categories', () => {
    // Only convention findings — security/architecture/nit should not appear
    const findings: CategorizedFinding[] = [
      makeFinding({ triageCategory: 'convention', body: 'Missing tag' }),
    ];

    const output = formatTriageOutput(953, findings, 2, noColor);

    expect(output).toContain('CONVENTION');
    expect(output).not.toContain('SECURITY');
    expect(output).not.toContain('ARCHITECTURE');
    expect(output).not.toContain('NITS');
  });

  it('shows correct finding count', () => {
    const findings: CategorizedFinding[] = [
      makeFinding({ triageCategory: 'security', body: 'Issue 1' }),
      makeFinding({ triageCategory: 'architecture', body: 'Issue 2', dedupKey: 'k2' }),
      makeFinding({ triageCategory: 'convention', body: 'Issue 3', dedupKey: 'k3' }),
    ];

    const output = formatTriageOutput(953, findings, 18, noColor);

    expect(output).toContain('PR #953 Bot Review Summary');
    expect(output).toContain('3 distinct findings across 18 comments');
  });

  it('shows singular form for 1 finding and 1 comment', () => {
    const findings: CategorizedFinding[] = [
      makeFinding({ triageCategory: 'security', body: 'One issue' }),
    ];

    const output = formatTriageOutput(123, findings, 1, noColor);

    expect(output).toContain('1 distinct finding across 1 comment');
  });

  it('handles zero findings gracefully', () => {
    const output = formatTriageOutput(42, [], 0, noColor);

    expect(output).toContain('PR #42 Bot Review Summary');
    expect(output).toContain('0 distinct findings across 0 comments');
  });

  it('numbers findings sequentially across categories', () => {
    const findings: CategorizedFinding[] = [
      makeFinding({ triageCategory: 'security', body: 'Sec issue', file: 'a.ts', dedupKey: 'k1' }),
      makeFinding({
        triageCategory: 'architecture',
        body: 'Arch issue',
        file: 'b.ts',
        dedupKey: 'k2',
      }),
      makeFinding({
        triageCategory: 'convention',
        body: 'Conv issue',
        file: 'c.ts',
        dedupKey: 'k3',
      }),
    ];

    const output = formatTriageOutput(100, findings, 6, noColor);

    expect(output).toContain('[1]');
    expect(output).toContain('[2]');
    expect(output).toContain('[3]');
  });

  it('truncates long finding bodies', () => {
    const longBody = 'A'.repeat(200);
    const findings: CategorizedFinding[] = [
      makeFinding({ triageCategory: 'convention', body: longBody }),
    ];

    const output = formatTriageOutput(1, findings, 1, noColor);

    // Body should be truncated to ~80 chars with ellipsis
    expect(output).toContain('...');
    // Full 200 chars should NOT appear
    expect(output).not.toContain(longBody);
  });
});
