import { describe, expect, it } from 'vitest';

import {
  AuthoredRuleRecordSchema,
  evaluateStructuralEligibility,
  mintAuthoredRuleId,
  type WhitelistEntry,
} from './authored-rule.js';

const WHITELIST: readonly WhitelistEntry[] = [
  { engine: 'regex', structuralClass: 'float-finite-assert' },
  { engine: 'ast-grep', structuralClass: 'divisor-le-zero' },
];

describe('evaluateStructuralEligibility (ADR-112 §3 — closed predicate)', () => {
  it('decidable:true on EXACTLY ONE (engine,class) match', () => {
    const r = evaluateStructuralEligibility(
      { declaredEngine: 'regex', structuralClass: 'float-finite-assert' },
      WHITELIST,
      'static-whitelist@cert-1',
    );
    expect(r.decidable).toBe(true);
    expect(r.basis).toBe('whitelist:float-finite-assert');
    expect(r.judgedBy).toBe('static-whitelist@cert-1');
  });

  it('decidable:false on an UNKNOWN class (no default-to-structural)', () => {
    const r = evaluateStructuralEligibility(
      { declaredEngine: 'regex', structuralClass: 'unbounded-recursion-behavioral' },
      WHITELIST,
      'static-whitelist@cert-1',
    );
    expect(r.decidable).toBe(false);
  });

  it('decidable:false when the engine cannot represent the class (no matching pair)', () => {
    // class is whitelisted for ast-grep, not regex → no (regex, divisor-le-zero) entry.
    const r = evaluateStructuralEligibility(
      { declaredEngine: 'regex', structuralClass: 'divisor-le-zero' },
      WHITELIST,
      'static-whitelist@cert-1',
    );
    expect(r.decidable).toBe(false);
  });

  it('decidable:false on MULTIPLE matches (ambiguous)', () => {
    const dupes: WhitelistEntry[] = [
      { engine: 'regex', structuralClass: 'float-finite-assert' },
      { engine: 'regex', structuralClass: 'float-finite-assert' },
    ];
    const r = evaluateStructuralEligibility(
      { declaredEngine: 'regex', structuralClass: 'float-finite-assert' },
      dupes,
      'static-whitelist@cert-1',
    );
    expect(r.decidable).toBe(false);
  });

  it('is deterministic — 100 sequential iterations yield an identical verdict (LLM-free)', () => {
    const first = JSON.stringify(
      evaluateStructuralEligibility(
        { declaredEngine: 'ast-grep', structuralClass: 'divisor-le-zero' },
        WHITELIST,
        'static-whitelist@cert-1',
      ),
    );
    for (let i = 0; i < 100; i += 1) {
      const again = JSON.stringify(
        evaluateStructuralEligibility(
          { declaredEngine: 'ast-grep', structuralClass: 'divisor-le-zero' },
          WHITELIST,
          'static-whitelist@cert-1',
        ),
      );
      expect(again).toBe(first);
    }
  });
});

describe('AuthoredRuleRecord schema (ADR-112 §3)', () => {
  const base = {
    provenance: {
      kind: 'authored' as const,
      author: 'totem-claude',
      authoredAt: '2026-06-27',
      targetDefect: 'float equality compared with == instead of a finite-tolerance check',
      positiveFixtures: [
        {
          pr: 100,
          mergeCommitSha: 'b'.repeat(40),
          preimageCommitSha: 'c'.repeat(40),
          filePath: 'src/physics/step.ts',
          matchedSpan: 'L10-L12',
          contentHash: 'deadbeefcafe',
        },
      ],
    },
    structuralEligibility: {
      decidable: true,
      basis: 'whitelist:float-finite-assert',
      judgedBy: 's',
    },
    origin: { kind: 'from-scratch' as const },
    declaredEngine: 'regex' as const,
    authoringLedgerRef: 'alr-0001',
    dslSource: '**Pattern:** `== *\\d+\\.\\d+f?`',
    unverified: true as const,
  };

  it('accepts a complete authored record', () => {
    expect(() => AuthoredRuleRecordSchema.parse(base)).not.toThrow();
  });

  it('has NO author-settable disposition/routing field (the check owns eligibility — FM(d))', () => {
    const parsed = AuthoredRuleRecordSchema.parse(base);
    expect('classifierDisposition' in parsed).toBe(false);
    expect('routing' in parsed).toBe(false);
  });

  it('requires the independent structuralEligibility result', () => {
    const { structuralEligibility: _omit, ...without } = base;
    expect(() => AuthoredRuleRecordSchema.parse(without)).toThrow();
  });

  it('forces unverified:true (zero blast radius — ADR-089/§1)', () => {
    expect(() => AuthoredRuleRecordSchema.parse({ ...base, unverified: false })).toThrow();
  });
});

describe('mintAuthoredRuleId (ADR-112 §8)', () => {
  it('is deterministic for the same (author,targetDefect) and excludes dslSource', () => {
    const a = mintAuthoredRuleId('totem-claude', 'float-finite-assert', new Set());
    const b = mintAuthoredRuleId('totem-claude', 'float-finite-assert', new Set());
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('appends a stable counter on collision and yields distinct persisted ids', () => {
    const first = mintAuthoredRuleId('totem-claude', 'divisor-le-zero', new Set());
    const second = mintAuthoredRuleId('totem-claude', 'divisor-le-zero', new Set([first]));
    const third = mintAuthoredRuleId('totem-claude', 'divisor-le-zero', new Set([first, second]));
    expect(second).toBe(`${first}-1`);
    expect(third).toBe(`${first}-2`);
    expect(new Set([first, second, third]).size).toBe(3);
  });

  it('is stable across re-runs given the already-resolved id set', () => {
    const resolved = mintAuthoredRuleId('a', 'd', new Set());
    expect(mintAuthoredRuleId('a', 'd', new Set([resolved]))).toBe(`${resolved}-1`);
    expect(mintAuthoredRuleId('a', 'd', new Set([resolved]))).toBe(`${resolved}-1`);
  });
});
