import { describe, expect, it } from 'vitest';
import { stringify as yamlStringify } from 'yaml';

import {
  AuthoredRuleInputSchema,
  type AuthoredRuleRecord,
  AuthoredRuleRecordSchema,
  evaluateStructuralEligibility,
  mintAuthoredRuleId,
  toCompileFeed,
  type WhitelistEntry,
} from './authored-rule.js';
import { type ParsedRuleRecord, parseRuleRecord } from './rule-record.js';

// ── Prop 310 § Design 1 — the record carrier the envelope now holds ──────────

const RECORD_PATH = '.totem/rules/float-finite-assert.rule.yaml';
const RECORD_YAML = yamlStringify({
  schemaVersion: 1,
  severity: 'error',
  message: 'Float equality must use a finite-tolerance check.',
  target: {
    type: 'regex',
    pattern: '== *\\d+\\.\\d+f?',
    scope: { fileGlobs: ['src/**/*.ts'] },
  },
  examples: [{ bad: 'if (a == 1.0f) {}', good: 'if (abs(a - 1.0f) < EPS) {}' }],
});
const parsedRecord = (): ParsedRuleRecord => parseRuleRecord(RECORD_YAML, RECORD_PATH);
const recordCarrier = () => ({
  path: RECORD_PATH,
  contentHash: 'a'.repeat(64),
  parsed: parsedRecord(),
});

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
          preimageSource: {
            kind: 'commit' as const,
            preimageCommitSha: 'c'.repeat(40),
            mergeCommitSha: 'b'.repeat(40),
          },
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
    record: recordCarrier(),
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
      // non-canonical suffixes the mint never emits (n≥1, no zero-pad) — #2259 CR
      '0f1e2d3c4b5a6978-0',
      '0f1e2d3c4b5a6978-01',
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

  it('constrains structuralEligibility.basis to the §3 forms — not free-form (strategy item 2, #2259)', () => {
    const withBasis = (basis: string) => ({
      ...base,
      structuralEligibility: { ...base.structuralEligibility, basis },
    });
    for (const bad of [
      '',
      'freeform',
      'whitelist:',
      'whitelisted',
      'stage4',
      ' capability-check',
    ]) {
      expect(() => AuthoredRuleRecordSchema.parse(withBasis(bad))).toThrow();
    }
    for (const ok of [
      'whitelist:float-finite-assert',
      'capability-check',
      'draft-classifier+stage4',
    ]) {
      expect(() => AuthoredRuleRecordSchema.parse(withBasis(ok))).not.toThrow();
    }
  });
});

describe('AuthoredRuleInputSchema — Prop 310 § Design 1 records-only carrier (OQ-1)', () => {
  const input = (over: Record<string, unknown> = {}) => ({
    author: 'alice',
    authoredAt: '2026-08-22',
    targetDefect: 'float equality compared with ==',
    structuralClass: 'float-finite-assert',
    record: RECORD_PATH,
    positiveFixtures: [
      {
        pr: 101,
        filePath: 'src/physics/step.ts',
        matchedSpan: 'L10-L12',
        contentHash: 'deadbeefcafe',
        example: 0,
      },
    ],
    ...over,
  });

  it('accepts a record-carried entry and trims the reference', () => {
    const parsed = AuthoredRuleInputSchema.parse(input({ record: `  ${RECORD_PATH}  ` }));
    expect(parsed.record).toBe(RECORD_PATH);
    expect(parsed.positiveFixtures[0]?.example).toBe(0);
  });

  it('REQUIRES the record reference — there is no other rule carrier', () => {
    const { record: _dropped, ...noRecord } = input();
    expect(() => AuthoredRuleInputSchema.parse(noRecord)).toThrow();
    expect(() => AuthoredRuleInputSchema.parse(input({ record: '   ' }))).toThrow(
      /record must reference a rule record/,
    );
  });

  it('rejects the migrated keys at the entry level (closed key space)', () => {
    // The CLI intake ALSO rejects these by name at any depth with a migration
    // message — this pins the schema half, which is what stops a nested-free
    // top-level occurrence from being silently stripped.
    for (const migrated of [
      { dslSource: '**Pattern:** `x`' },
      { declaredEngine: 'regex' },
      { preimageSource: { kind: 'lesson' } },
    ]) {
      expect(() => AuthoredRuleInputSchema.parse(input(migrated))).toThrow();
    }
  });

  it('rejects an inline preimageSource on a FIXTURE — the envelope side is derived, never authored', () => {
    expect(() =>
      AuthoredRuleInputSchema.parse(
        input({
          positiveFixtures: [
            {
              ...input().positiveFixtures[0],
              preimageSource: {
                kind: 'lesson',
                lessonRef: 'a1b2c3d4e5f60718',
                badExample: 'x',
                goodExample: 'y',
              },
            },
          ],
        }),
      ),
    ).toThrow();
  });

  it('requires each fixture to reference an ordinal, and rejects a negative one', () => {
    const { example: _dropped, ...noOrdinal } = input().positiveFixtures[0]!;
    expect(() => AuthoredRuleInputSchema.parse(input({ positiveFixtures: [noOrdinal] }))).toThrow();
    expect(() =>
      AuthoredRuleInputSchema.parse(
        input({ positiveFixtures: [{ ...input().positiveFixtures[0], example: -1 }] }),
      ),
    ).toThrow(/non-negative/);
  });

  it('keeps `origin` optional and `negativeFixtures` unchanged', () => {
    expect(() =>
      AuthoredRuleInputSchema.parse(
        input({
          origin: { kind: 'mined-accelerant', sourceRunId: 'run-1', suggestionHash: 'h' },
          negativeFixtures: [
            {
              filePath: 'src/x.ts',
              matchedSpan: 'L9',
              nearMissSource: { kind: 'lesson', example: 'abs(a - b) < EPS' },
            },
          ],
        }),
      ),
    ).not.toThrow();
  });
});

describe('AuthoredRuleRecordSchema — the record carrier (Prop 310 § Design 1)', () => {
  const base = () => ({
    ruleId: '0f1e2d3c4b5a6978',
    provenance: {
      kind: 'authored' as const,
      author: 'alice',
      authoredAt: '2026-08-22',
      targetDefect: 'float equality compared with ==',
      positiveFixtures: [
        {
          pr: 101,
          preimageSource: {
            kind: 'record' as const,
            ruleId: '0f1e2d3c4b5a6978',
            ordinal: 0,
            pairHash: parsedRecord().examplePairHashes[0]!.hash,
            badExample: 'if (a == 1.0f) {}',
            goodExample: 'if (abs(a - 1.0f) < EPS) {}',
          },
          filePath: 'src/physics/step.ts',
          matchedSpan: 'L10-L12',
          contentHash: 'deadbeefcafe',
        },
      ],
    },
    structuralEligibility: {
      decidable: true,
      basis: 'whitelist:float-finite-assert',
      judgedBy: 'static-whitelist@cert-1',
    },
    origin: { kind: 'from-scratch' as const },
    declaredEngine: 'regex' as const,
    authoringLedgerRef: '0f1e2d3c4b5a6978',
    record: recordCarrier(),
    unverified: true as const,
  });

  it('accepts the carrier and preserves the parsed record verbatim', () => {
    const parsed = AuthoredRuleRecordSchema.parse(base());
    expect(parsed.record.path).toBe(RECORD_PATH);
    expect(parsed.record.parsed).toEqual(parsedRecord());
    expect(parsed.record.parsed.derivedEngine).toBe('regex');
  });

  it('rejects a contentHash that is not a sha256 hex — it is the attestation basis', () => {
    for (const bad of ['a'.repeat(63), 'A'.repeat(64), 'not-a-hash']) {
      expect(() =>
        AuthoredRuleRecordSchema.parse({
          ...base(),
          record: { ...recordCarrier(), contentHash: bad },
        }),
      ).toThrow(/record.contentHash must be the sha256 hex/);
    }
  });

  it('rejects a `parsed` value the V1 grammar would not admit (one grammar, not two)', () => {
    const torn = parsedRecord();
    expect(() =>
      AuthoredRuleRecordSchema.parse({
        ...base(),
        record: {
          ...recordCarrier(),
          parsed: { ...torn, record: { ...torn.record, schemaVersion: 2 } },
        },
      }),
    ).toThrow();
  });

  it('has NO dslSource field — the record is the only carrier (OQ-1 records-only)', () => {
    const parsed = AuthoredRuleRecordSchema.parse(base());
    expect('dslSource' in parsed).toBe(false);
  });
});

describe('mintAuthoredRuleId (ADR-112 §8)', () => {
  it('is deterministic for the same (author,targetDefect) and excludes the matcher', () => {
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
          preimageSource: {
            kind: 'commit' as const,
            preimageCommitSha: 'b'.repeat(40),
            mergeCommitSha: 'a'.repeat(40),
          },
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
    record: recordCarrier(),
    unverified: true,
  });

  it('emits one structural candidate + a 1:1 authored-whitelist ledger entry per decidable rule', () => {
    const feed = toCompileFeed([decidable('alr-1'), decidable('alr-2')]);
    expect(feed.candidates).toHaveLength(2);
    // the adapter — not the author — sets the disposition to structural.
    expect(feed.candidates.every((c) => c.classifierDisposition === 'structural')).toBe(true);
    // authored provenance is carried through, not flattened to a mined shape.
    expect(feed.candidates[0]!.provenance.kind).toBe('authored');
    // Prop 310 § Design 1: the PARSED record is the carrier and `dslSource` is
    // absent — a candidate carrying both would fail `compileCandidate`'s XOR.
    expect(feed.candidates[0]!.record).toEqual(parsedRecord());
    expect(feed.candidates[0]!.dslSource).toBeUndefined();
    // The whitelist-judged engine still rides along for the §3 binding.
    expect(feed.candidates[0]!.declaredEngine).toBe('regex');
    expect(feed.candidates[0]!.ruleId).toBe(decidable('alr-1').ruleId);
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
