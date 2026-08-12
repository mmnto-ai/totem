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

  it('the NITS bucket ignores keywords inside word context (mmnto-ai/totem#2626 falsification rounds)', () => {
    // ghcq's stock closing boilerplate contains "defi-nit-ions"; a bare
    // substring match routed 5 of the 7 in-org ghcq findings to NITS. With no
    // other keyword hit, both bodies fall to the architecture default —
    // pinned exactly, not merely not-nit.
    const ghcqBoilerplate = makeFinding({
      tool: 'ghcq',
      body: '## Unused variable\n\nNo imports, new methods, or new definitions are needed.',
    });
    expect(mapToTriageCategory(ghcqBoilerplate)).toBe('architecture');
    // "u-nit test" is the same containment class for every bot.
    const unitTest = makeFinding({ body: 'Missing unit test for the new branch' });
    expect(mapToTriageCategory(unitTest)).toBe('architecture');
    // snake_case identifiers are word context too — `_` is in the blocked
    // class (round-3 catch: "is_minor_bump" bucketed to nit).
    expect(mapToTriageCategory(makeFinding({ body: 'the is_minor_bump flag is never read' }))).toBe(
      'architecture',
    );
    // Non-ASCII letters are word context. Both normalization forms are pinned
    // (round-3 catch: an NFC-only fixture hid the decomposed-form leak — the
    // combining mark U+0308 is neither letter nor number, so \p{M} must be in
    // the blocked class; GitHub does not normalize comment bodies). Bodies are
    // built via fromCharCode so this source file stays deterministic ASCII.
    const nfcBody = String.fromCharCode(0x00fc) + 'nit coverage discussion';
    expect(mapToTriageCategory(makeFinding({ body: nfcBody }))).toBe('architecture');
    const nfdBody = 'u' + String.fromCharCode(0x0308) + 'nit coverage discussion';
    expect(mapToTriageCategory(makeFinding({ body: nfdBody }))).toBe('architecture');
    // Boundary-anchored NIT keywords still match when legitimately present,
    // including CodeRabbit's real severity markup, which keeps a space or
    // emoji before the token (parse-nits.ts `\s*`).
    expect(mapToTriageCategory(makeFinding({ body: 'nit: prefer const here' }))).toBe('nit');
    expect(mapToTriageCategory(makeFinding({ body: 'de quality_ | _🟡 minor_ | _⚡ quick' }))).toBe(
      'nit',
    );
    // Inflections keep matching under the open trail.
    expect(mapToTriageCategory(makeFinding({ body: 'two typos in this paragraph' }))).toBe('nit');
  });

  it('security/architecture/convention keep substring semantics — stems, inflections, negations (rounds 2–3 regression guards)', () => {
    // The security list deliberately carries stems ('sanitiz', 'authenticat');
    // round 2 proved a trailing \b killed every inflection, and round 3 proved
    // a leading boundary killed the negation class — substring keeps both.
    expect(mapToTriageCategory(makeFinding({ body: 'Please sanitize the user input' }))).toBe(
      'security',
    );
    expect(mapToTriageCategory(makeFinding({ body: 'unsanitized input reaches the sink' }))).toBe(
      'security',
    );
    expect(mapToTriageCategory(makeFinding({ body: 'unauthorized access is possible' }))).toBe(
      'security',
    );
    expect(mapToTriageCategory(makeFinding({ body: 'authentication bypass possible' }))).toBe(
      'security',
    );
    // Non-vacuous inflection guard (round-3 catch: without the decoy this
    // assertion passed even with keyword matching switched off): if
    // 'race condition' stops matching inside 'race conditions', the body
    // falls to NIT via 'consider' instead of architecture.
    expect(
      mapToTriageCategory(makeFinding({ body: 'Consider the race conditions in the write path' })),
    ).toBe('architecture');
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
