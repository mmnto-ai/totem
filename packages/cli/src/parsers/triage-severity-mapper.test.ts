import { describe, expect, it } from 'vitest';

import type { NormalizedBotFinding } from './bot-review-parser.js';
import { mapToTriageCategory } from './triage-severity-mapper.js';

// ─── Helpers ─────────────────────────────────────────

function makeFinding(overrides: Partial<NormalizedBotFinding> = {}): NormalizedBotFinding {
  return {
    tool: 'coderabbit',
    severity: 'info',
    file: 'src/foo.ts',
    body: 'Some finding body',
    ...overrides,
  };
}

// ─── mapToTriageCategory ─────────────────────────────

describe('mapToTriageCategory', () => {
  it('maps shell injection finding to security', () => {
    const finding = makeFinding({ body: 'Avoid shell injection via exec() call' });
    expect(mapToTriageCategory(finding)).toBe('security');
  });

  it('maps ReDoS finding to security', () => {
    const finding = makeFinding({ body: 'This regex is vulnerable to ReDoS attacks' });
    expect(mapToTriageCategory(finding)).toBe('security');
  });

  it('maps empty catch finding to architecture', () => {
    const finding = makeFinding({ body: 'Empty catch block silently swallows errors' });
    expect(mapToTriageCategory(finding)).toBe('architecture');
  });

  it('maps static import finding to architecture', () => {
    const finding = makeFinding({
      body: 'Convert static import to dynamic import for startup perf',
    });
    expect(mapToTriageCategory(finding)).toBe('architecture');
  });

  it('maps log.error tag finding to convention', () => {
    const finding = makeFinding({ body: 'Missing [Totem Error] tag on log.error call' });
    expect(mapToTriageCategory(finding)).toBe('convention');
  });

  it('maps styleguide rule reference to convention', () => {
    const finding = makeFinding({ body: 'Violates styleguide naming convention' });
    expect(mapToTriageCategory(finding)).toBe('convention');
  });

  it('maps nitpick finding to nit', () => {
    const finding = makeFinding({ body: 'Nitpick: maybe rename this variable' });
    expect(mapToTriageCategory(finding)).toBe('nit');
  });

  it('maps whitespace finding to nit', () => {
    const finding = makeFinding({ body: 'Trailing whitespace on line 42' });
    expect(mapToTriageCategory(finding)).toBe('nit');
  });

  it('does not match keywords inside larger words (mmnto-ai/totem#2626 falsification round)', () => {
    // ghcq's stock closing boilerplate contains "defi-nit-ions"; a bare
    // substring match routed 5 of the 7 in-org ghcq findings to NITS.
    const ghcqBoilerplate = makeFinding({
      tool: 'ghcq',
      body: '## Unused variable\n\nNo imports, new methods, or new definitions are needed.',
    });
    expect(mapToTriageCategory(ghcqBoilerplate)).not.toBe('nit');
    // "u-nit test" is the same containment class for every bot.
    const unitTest = makeFinding({ body: 'Missing unit test for the new branch' });
    expect(mapToTriageCategory(unitTest)).not.toBe('nit');
    // Word-bounded keywords still match when legitimately present.
    const realNit = makeFinding({ body: 'nit: prefer const here' });
    expect(mapToTriageCategory(realNit)).toBe('nit');
  });

  it('falls back to architecture for unknown findings', () => {
    const finding = makeFinding({ body: 'Something unusual happened here' });
    expect(mapToTriageCategory(finding)).toBe('architecture');
  });

  it('uses bot severity as fallback (critical -> security)', () => {
    const finding = makeFinding({ body: 'Something unusual happened here', severity: 'critical' });
    expect(mapToTriageCategory(finding)).toBe('security');
  });

  it('assigns nit category to findings with nitpick keywords regardless of case', () => {
    const finding = makeFinding({ body: 'NITPICK: This could be cleaner' });
    expect(mapToTriageCategory(finding)).toBe('nit');
  });
});
