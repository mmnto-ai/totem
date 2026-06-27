import { describe, expect, it } from 'vitest';

import {
  type AuthoredRuleRecord,
  AuthoredRuleRecordSchema,
  evaluateStructuralEligibility,
  mintAuthoredRuleId,
  toCompileFeed,
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
    ruleId: '0f1e2d3c4b5a6978',
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

  it('reserves the minted ruleId on the record (ADR-112 §3/§8 — persisted, never re-derived)', () => {
    const { ruleId: _omit, ...without } = base;
    expect(() => AuthoredRuleRecordSchema.parse(without)).toThrow();
    expect(() => AuthoredRuleRecordSchema.parse({ ...base, ruleId: '  ' })).toThrow();
    expect(AuthoredRuleRecordSchema.parse(base).ruleId).toBe('0f1e2d3c4b5a6978');
  });

  it('enforces the minted ruleId SHAPE at the boundary — 16 hex + optional -<n> (#2259 CR-major)', () => {
    for (const bad of [
      'NOTHEXNOTHEXNOTH',
      '0f1e2d3c',
      '0f1e2d3c4b5a6978abcd',
      '0F1E2D3C4B5A6978',
      'rid-alr-1',
    ]) {
      expect(() => AuthoredRuleRecordSchema.parse({ ...base, ruleId: bad })).toThrow();
    }
    for (const ok of ['0f1e2d3c4b5a6978', '0f1e2d3c4b5a6978-1', 'abcdef0123456789-42']) {
      expect(() => AuthoredRuleRecordSchema.parse({ ...base, ruleId: ok })).not.toThrow();
    }
    // the mint always produces a schema-valid id (the shared shape constant binds both).
    expect(() =>
      AuthoredRuleRecordSchema.parse({
        ...base,
        ruleId: mintAuthoredRuleId('totem-claude', 'float-finite-assert', new Set()),
      }),
    ).not.toThrow();
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

  it('encodes (author,targetDefect) injectively — delimiter-aliased tuples do NOT collide (#2259)', () => {
    // A bare `author·targetDefect` seed would alias these two distinct tuples onto one id.
    const a = mintAuthoredRuleId('a·b', 'c', new Set());
    const b = mintAuthoredRuleId('a', 'b·c', new Set());
    expect(a).not.toBe(b);
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

describe('toCompileFeed (ADR-112 §2/§8 — authored → compile-stage input)', () => {
  const decidable = (ref: string): AuthoredRuleRecord => ({
    ruleId: mintAuthoredRuleId('totem-claude', ref, new Set()),
    provenance: {
      kind: 'authored',
      author: 'totem-claude',
      authoredAt: '2026-06-27',
      targetDefect: 'float equality compared with == instead of a finite check',
      positiveFixtures: [
        {
          pr: 1,
          mergeCommitSha: 'a'.repeat(40),
          preimageCommitSha: 'b'.repeat(40),
          filePath: 'src/a.ts',
          matchedSpan: 'L1',
          contentHash: 'h1',
        },
      ],
    },
    structuralEligibility: {
      decidable: true,
      basis: 'whitelist:float-finite-assert',
      judgedBy: 's',
    },
    origin: { kind: 'from-scratch' },
    declaredEngine: 'regex',
    authoringLedgerRef: ref,
    dslSource: '**Pattern:** `== *\\d`',
    unverified: true,
  });

  it('emits one structural candidate + a 1:1 authored-whitelist ledger entry per decidable rule', () => {
    const feed = toCompileFeed([decidable('alr-1'), decidable('alr-2')]);
    expect(feed.candidates).toHaveLength(2);
    // the adapter — not the author — sets the disposition to structural.
    expect(feed.candidates.every((c) => c.classifierDisposition === 'structural')).toBe(true);
    // authored provenance is carried through, not flattened to a mined shape.
    expect(feed.candidates[0]!.provenance.kind).toBe('authored');
    expect(feed.candidates.map((c) => c.classifierLedgerRef)).toEqual([
      'authored:alr-1',
      'authored:alr-2',
    ]);
    // the classifier ledger NEVER claims an LLM judged a human rule (Tenet-20).
    expect(
      feed.classifierLedger.entries.every((e) => e.dispositionSource === 'authored-whitelist'),
    ).toBe(true);
    // the join key is 1:1 between candidate and ledger entry (runCompileStage requires it).
    expect(feed.classifierLedger.entries.map((e) => e.candidateRef)).toEqual(
      feed.candidates.map((c) => c.classifierLedgerRef),
    );
  });

  it('FAILS LOUD on a non-decidable record (FM(d) — never reaches the compiler)', () => {
    const nd: AuthoredRuleRecord = {
      ...decidable('alr-x'),
      structuralEligibility: { decidable: false, basis: 'whitelist:foo', judgedBy: 's' },
    };
    expect(() => toCompileFeed([nd])).toThrow(/not structurally decidable/);
  });

  it('FAILS LOUD on a duplicate authoringLedgerRef (protects the 1:1 compile join)', () => {
    expect(() => toCompileFeed([decidable('dup'), decidable('dup')])).toThrow(
      /duplicate authoringLedgerRef/,
    );
  });
});
