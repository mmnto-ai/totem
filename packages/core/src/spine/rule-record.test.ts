// ─── Prop 310 § Design 14 — the V1 record-grammar CONFORMANCE SUITE ──────────
//
// § Design 14 flips normativity: the spec is normative and the parser is its
// implementation. This suite is the conformance instrument that flip names — one
// negative fixture per banned-silent behaviour (silent default / silent skip /
// silent expansion / silent promotion), one per § Design 7 dialect rule, plus the
// closed-key and inexpressible-key closure at multiple depths. § Falsifying
// Metric: "any shipped parser behavior that silently defaults, skips, expands, or
// promotes where this spec mandates an error" falsifies the grammar — these
// fixtures are how that is mechanically checked.

import { describe, expect, it } from 'vitest';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';

import { DeclaredEngineSchema } from './authored-rule.js';
import {
  checkGlobDialect,
  CURATION_PROCESS_FIELDS,
  GLOB_DIALECT_RULES,
  type GlobDialectRule,
  LEGACY_ENGINE_DETAIL,
  parseRuleRecord,
  RULE_RECORD_FORBIDDEN_PROTOTYPE_KEYS,
  RULE_RECORD_INEXPRESSIBLE_KEYS,
  RULE_RECORD_SCHEMA_VERSION,
  ruleExamplePairHash,
  RuleRecordNoSilentSkipError,
  RuleRecordParseError,
  RuleRecordProducerKeyError,
  RuleRecordPrototypeKeyError,
  RuleRecordSchema,
  RuleTargetTypeSchema,
} from './rule-record.js';

const FILE = '.totem/rules/fail-open-catch.rule.yaml';

/** One member of Prop 270 §8's Baseline-5 process trio. */
type CurationProcessField = (typeof CURATION_PROCESS_FIELDS)[number];

// Built via char codes, never source escapes, so no authoring layer can mangle
// the control bytes these CR-blindness fixtures depend on.
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);

/**
 * Prop 310 § Design 4's exemplar record, transcribed (comments stripped). This
 * document MUST parse — it is the spec's own coherent exemplar.
 */
const DESIGN4_EXEMPLAR = [
  'schemaVersion: 1',
  '',
  'severity: error',
  'message: "Catch blocks must re-throw or route the error — fail-open catch is banned."',
  'recoveryHint: "Re-throw after logging, or route to the error channel."',
  '',
  'target:',
  '  type: ast-grep',
  '  language: typescript',
  '  rule:',
  '    kind: catch_clause',
  '    not: { has: { kind: throw_statement, stopBy: end } }',
  '  scope:',
  '    fileGlobs: ["packages/**/*.ts"]',
  '    excludeGlobs: ["**/*.test.ts"]',
  '',
  'examples:',
  '  - bad: "try { risky() } catch (e) { log(e) }"',
  '    good: "try { risky() } catch (e) { log(e); throw e }"',
  '',
  'curation:',
  '  sourceLesson: "lesson-77c5e668389fb1a2"',
  '  curatedBy: "strategy-gemini"',
  '  curatedAt: "2026-06-15T14:00:00Z"',
  '  baseline5Phase: 3',
  '',
  'verification_shadow:',
  '  type: rego',
  '  source: |',
  '    package totem.rules.example',
  '',
].join(LF);

/**
 * Prop 310 § Design 8's `requires:` exemplar, transcribed (comments stripped).
 * This document MUST parse — it is the spec's coherent absence/must-contain shape.
 */
const DESIGN8_EXEMPLAR = [
  'schemaVersion: 1',
  'severity: warning',
  'message: "git output-consuming commands must pin LC_ALL=C on the same line."',
  'target:',
  '  type: regex',
  "  pattern: '\\bgit\\s+(log|diff|status)\\b'",
  '  scope:',
  '    fileGlobs: ["**/*.sh", "**/*.cjs"]',
  'requires:',
  "  pattern: 'LC_ALL=C'",
  '  scope: line',
  'examples:',
  '  - bad: "git log --oneline"',
  '    good: "LC_ALL=C git log --oneline"',
  '',
].join(LF);

/** A minimal dialect-clean ast-grep record, mutated per negative fixture. */
function astGrepRecord(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    severity: 'error',
    message: 'Catch blocks must re-throw or route the error.',
    target: {
      type: 'ast-grep',
      language: 'typescript',
      rule: { kind: 'catch_clause' },
      scope: { fileGlobs: ['packages/**/*.ts'] },
    },
    examples: [
      {
        bad: 'try { risky() } catch (e) { log(e) }',
        good: 'try { risky() } catch (e) { throw e }',
      },
    ],
  };
}

/** A minimal dialect-clean regex record, mutated per negative fixture. */
function regexRecord(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    severity: 'warning',
    message: 'git output-consuming commands must pin LC_ALL=C on the same line.',
    target: {
      type: 'regex',
      pattern: 'git log',
      scope: { fileGlobs: ['**/*.sh'] },
    },
    examples: [{ bad: 'git log --oneline', good: 'LC_ALL=C git log --oneline' }],
  };
}

function target(record: Record<string, unknown>): Record<string, unknown> {
  return record.target as Record<string, unknown>;
}

function scope(record: Record<string, unknown>): Record<string, unknown> {
  return target(record).scope as Record<string, unknown>;
}

function parseObject(record: unknown, file = FILE) {
  return parseRuleRecord(yamlStringify(record), file);
}

/** Assert the record is REJECTED and return the error, so a fixture can pin its class + path. */
function reject(record: unknown, file = FILE): RuleRecordParseError {
  let thrown: unknown;
  try {
    parseObject(record, file);
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(RuleRecordParseError);
  const failure = thrown as RuleRecordParseError;
  // § Failure modes — every diagnostic names the FILE.
  expect(failure.message).toContain(file);
  expect(failure.filePath).toBe(file);
  return failure;
}

/** Assert a raw YAML document is REJECTED (for carrier-level fixtures). */
function rejectRaw(content: string, file = FILE): RuleRecordParseError {
  let thrown: unknown;
  try {
    parseRuleRecord(content, file);
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(RuleRecordParseError);
  const failure = thrown as RuleRecordParseError;
  expect(failure.message).toContain(file);
  return failure;
}

// ── Positives ────────────────────────────────────────────────────────────────

describe('Prop 310 exemplars parse (§ Design 4, § Design 8)', () => {
  it('parses § Design 4’s exemplar record verbatim', () => {
    const parsed = parseRuleRecord(DESIGN4_EXEMPLAR, FILE);
    expect(parsed.record.schemaVersion).toBe(RULE_RECORD_SCHEMA_VERSION);
    expect(parsed.record.severity).toBe('error');
    expect(parsed.record.message).toContain('fail-open catch is banned');
    expect(parsed.record.recoveryHint).toBe(
      'Re-throw after logging, or route to the error channel.',
    );
    expect(parsed.record.target.type).toBe('ast-grep');
    expect(parsed.record.target.language).toBe('typescript');
    expect(parsed.record.target.pattern).toBeUndefined();
    expect(parsed.record.target.scope.fileGlobs).toEqual(['packages/**/*.ts']);
    expect(parsed.record.target.scope.excludeGlobs).toEqual(['**/*.test.ts']);
    expect(parsed.record.examples).toHaveLength(1);
  });

  it('carries the § Design 4 compound payload interior verbatim (IR-2 — opaque at parse)', () => {
    const parsed = parseRuleRecord(DESIGN4_EXEMPLAR, FILE);
    // NapiConfig structural validation is the COMPILE-stage engine gate (slice 2);
    // the record grammar closes its own key space, not the engine's.
    expect(parsed.record.target.rule).toEqual({
      kind: 'catch_clause',
      not: { has: { kind: 'throw_statement', stopBy: 'end' } },
    });
  });

  it('carries the § Design 4 curation block under its camelCase keys', () => {
    const parsed = parseRuleRecord(DESIGN4_EXEMPLAR, FILE);
    expect(parsed.record.curation).toEqual({
      sourceLesson: 'lesson-77c5e668389fb1a2',
      curatedBy: 'strategy-gemini',
      curatedAt: '2026-06-15T14:00:00Z',
      baseline5Phase: 3,
    });
  });

  it('retains `verification_shadow` verbatim under its deliberate snake_case name (§ Design 4 named exception)', () => {
    const parsed = parseRuleRecord(DESIGN4_EXEMPLAR, FILE);
    expect(parsed.record.verification_shadow).toEqual({
      type: 'rego',
      source: `package totem.rules.example${LF}`,
    });
    // The key is NEVER renamed — it is already reserved in shipped forward-compat readers.
    expect(Object.keys(parsed.record)).toContain('verification_shadow');
    expect(Object.keys(parsed.record)).not.toContain('verificationShadow');
  });

  it('parses § Design 8’s `requires:` exemplar verbatim', () => {
    const parsed = parseRuleRecord(DESIGN8_EXEMPLAR, FILE);
    expect(parsed.record.target.type).toBe('regex');
    expect(parsed.record.target.language).toBeUndefined();
    expect(parsed.record.requires).toEqual({ pattern: 'LC_ALL=C', scope: 'line' });
    expect(parsed.record.target.scope.fileGlobs).toEqual(['**/*.sh', '**/*.cjs']);
  });

  it('accepts `requires.scope: file` — the other implemented V1 unit (§ Design 8)', () => {
    const record = regexRecord();
    record.requires = { pattern: 'LC_ALL=C', scope: 'file' };
    expect(parseObject(record).record.requires).toEqual({ pattern: 'LC_ALL=C', scope: 'file' });
  });

  it('accepts an optional record with neither requires, curation, nor verification_shadow', () => {
    const parsed = parseObject(astGrepRecord());
    expect(parsed.record.requires).toBeUndefined();
    expect(parsed.record.curation).toBeUndefined();
    expect(parsed.record.verification_shadow).toBeUndefined();
    expect(parsed.record.recoveryHint).toBeUndefined();
  });

  it('accepts a flat `pattern:` ast-grep payload (the other half of the XOR)', () => {
    const record = astGrepRecord();
    delete target(record).rule;
    target(record).pattern = 'try { $$$ } catch ($E) { $$$ }';
    expect(parseObject(record).record.target.pattern).toBe('try { $$$ } catch ($E) { $$$ }');
  });
});

describe('§ Design 3 — `declaredEngine` is DERIVED from `target.type`, never authored', () => {
  it('maps `type: ast-grep` to derivedEngine `ast-grep`', () => {
    expect(parseRuleRecord(DESIGN4_EXEMPLAR, FILE).derivedEngine).toBe('ast-grep');
  });

  it('maps `type: regex` to derivedEngine `regex`', () => {
    expect(parseRuleRecord(DESIGN8_EXEMPLAR, FILE).derivedEngine).toBe('regex');
  });

  it('keeps the V1 target enum a SUBSET of the reader-side DeclaredEngineSchema (R16)', () => {
    // The compile-time half is the `_ruleTargetTypeSubsetCheck` assignment in
    // rule-record.ts; this is the runtime half. A target-enum widening that
    // outruns the enum the compiled artifact is read under fails HERE.
    for (const option of RuleTargetTypeSchema.options) {
      expect(DeclaredEngineSchema.options).toContain(option);
    }
    // `ast` is the reader-side inert legacy member the AUTHORING enum drops (R16).
    expect(DeclaredEngineSchema.options).toContain('ast');
    expect(RuleTargetTypeSchema.options).not.toContain('ast');
  });
});

describe('§ Design 10 / Amendment 1 item 3 — CR-blind per-pair content hashes', () => {
  it('emits one hash per examples[i], in ordinal order', () => {
    const record = astGrepRecord();
    record.examples = [
      { bad: 'bad-0', good: 'good-0' },
      { bad: 'bad-1', good: 'good-1' },
      { bad: 'bad-2', good: 'good-2' },
    ];
    const parsed = parseObject(record);
    expect(parsed.examplePairHashes.map((h) => h.ordinal)).toEqual([0, 1, 2]);
    expect(new Set(parsed.examplePairHashes.map((h) => h.hash)).size).toBe(3);
    for (const entry of parsed.examplePairHashes) {
      expect(entry.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('a CRLF-authored FILE parses to the same hashes — pins YAML line-break normalization, NOT the CR-blind hash', () => {
    // Deliberately weak, and labelled so: `split(LF).join(CRLF)` puts CR only into
    // LINE BREAKS, which the YAML reader normalizes before this module sees a
    // value. It pins the file-level authoring case; the load-bearing CR-blindness
    // fixture is the escape-smuggled one below, where a real CR reaches a parsed
    // value (the trial's P3 `serialization-admit` class).
    const lfDoc = DESIGN4_EXEMPLAR;
    const crlfDoc = lfDoc.split(LF).join(CR + LF);
    expect(crlfDoc).not.toBe(lfDoc);
    expect(parseRuleRecord(crlfDoc, FILE).examplePairHashes).toEqual(
      parseRuleRecord(lfDoc, FILE).examplePairHashes,
    );
  });

  it('hashes an escape-smuggled CRLF exemplar identically to its LF twin (the trial’s P3 `serialization-admit` class)', () => {
    const lfRecord = astGrepRecord();
    lfRecord.examples = [{ bad: `a${LF}b`, good: `c${LF}d` }];
    const crlfRecord = astGrepRecord();
    crlfRecord.examples = [{ bad: `a${CR}${LF}b`, good: `c${CR}${LF}d` }];

    const crlfParsed = parseObject(crlfRecord);
    // The smuggle must actually survive the YAML round-trip, else the fixture is vacuous.
    expect(crlfParsed.record.examples[0]!.bad).toContain(CR);
    expect(crlfParsed.examplePairHashes).toEqual(parseObject(lfRecord).examplePairHashes);
  });

  it('is a real drift SENSOR — a changed exemplar changes its pair hash', () => {
    expect(ruleExamplePairHash({ bad: 'x', good: 'y' })).not.toBe(
      ruleExamplePairHash({ bad: 'x', good: 'z' }),
    );
  });

  it('does not confuse the bad and good legs of a pair', () => {
    expect(ruleExamplePairHash({ bad: 'x', good: 'y' })).not.toBe(
      ruleExamplePairHash({ bad: 'y', good: 'x' }),
    );
  });
});

describe('§ Design 3 — the parser is pure and deterministic', () => {
  it('returns a deep-equal result for the same bytes, twice', () => {
    expect(parseRuleRecord(DESIGN4_EXEMPLAR, FILE)).toEqual(
      parseRuleRecord(DESIGN4_EXEMPLAR, FILE),
    );
    expect(parseRuleRecord(DESIGN8_EXEMPLAR, FILE)).toEqual(
      parseRuleRecord(DESIGN8_EXEMPLAR, FILE),
    );
  });
});

// ── § Design 14 — one negative fixture per banned-silent behaviour ────────────

describe('§ Design 14 — banned silent behaviour: SILENT DEFAULT', () => {
  it('rejects an omitted `severity` — the census’s silent warning-default is killed (§ Design 4)', () => {
    const record = astGrepRecord();
    delete record.severity;
    expect(reject(record).message).toContain('severity');
  });

  it('rejects an out-of-vocab `severity` (`info` is not in the closed V1 enum)', () => {
    const record = astGrepRecord();
    record.severity = 'info';
    expect(reject(record).keyPath).toBe('severity');
  });

  it('rejects an omitted `requires.scope` — file-as-default is a silent default reborn (§ Design 8)', () => {
    const record = regexRecord();
    record.requires = { pattern: 'LC_ALL=C' };
    expect(reject(record).message).toContain('requires.scope');
  });

  it('rejects an out-of-vocab `requires.scope` (§ Design 8 closed name space)', () => {
    const record = regexRecord();
    record.requires = { pattern: 'LC_ALL=C', scope: 'paragraph' };
    expect(reject(record).keyPath).toBe('requires.scope');
  });
});

describe('§ Design 14 — banned silent behaviour: SILENT SKIP (§ Design 2 no-silent-skip gate)', () => {
  it('rejects an unknown `schemaVersion` with the distinct no-silent-skip diagnostic', () => {
    const record = astGrepRecord();
    record.schemaVersion = 2;
    const failure = reject(record);
    expect(failure).toBeInstanceOf(RuleRecordNoSilentSkipError);
    expect((failure as RuleRecordNoSilentSkipError).construct).toBe('schemaVersion');
  });

  it('rejects a string `schemaVersion` — the version axis is an INTEGER (§ Design 2)', () => {
    const record = astGrepRecord();
    record.schemaVersion = '1';
    expect(reject(record)).toBeInstanceOf(RuleRecordNoSilentSkipError);
  });

  it('rejects a missing `schemaVersion` — every record opens with it (§ Design 2/§ Design 5)', () => {
    const record = astGrepRecord();
    delete record.schemaVersion;
    expect(reject(record).keyPath).toBe('schemaVersion');
  });

  it('rejects an unknown `target.type` (`rego` joins by version bump, § Design 6)', () => {
    const record = astGrepRecord();
    target(record).type = 'rego';
    const failure = reject(record);
    expect(failure).toBeInstanceOf(RuleRecordNoSilentSkipError);
    expect((failure as RuleRecordNoSilentSkipError).construct).toBe('target.type');
  });

  it('rejects `type: ast` with the DROPPED-not-deferred message, never the version-bump text (R16, § Design 6)', () => {
    const record = astGrepRecord();
    target(record).type = 'ast';
    const failure = reject(record);
    expect(failure).toBeInstanceOf(RuleRecordNoSilentSkipError);
    // Pinned exactly: `ast` does not come back by version bump the way `rego` and
    // ADR-109's action-rule type do, and telling an author to wait for one would
    // be a wrong answer, not a terse one.
    expect(failure.message).toBe(`[Totem Error] ${FILE}: target.type — ${LEGACY_ENGINE_DETAIL}`);
    expect(failure.message).toContain('does NOT return by version bump');
    // The generic unknown-type text — which DOES promise a bump — must not be reused here.
    expect(failure.message).not.toContain('join by grammar version bump');
  });

  it.each(['AST', 'Ast', 'ast ', ' ast'])(
    'gives the near-miss %j the DROPPED-tier answer, and still rejects it',
    (nearMiss) => {
      // Case-folded + trimmed for DIAGNOSTIC SELECTION only: these are the same
      // authoring mistake and deserve the same answer, not a promise of a version
      // bump that will never carry `ast`.
      const record = astGrepRecord();
      target(record).type = nearMiss;
      const failure = reject(record);
      expect(failure).toBeInstanceOf(RuleRecordNoSilentSkipError);
      expect(failure.message).toBe(`[Totem Error] ${FILE}: target.type — ${LEGACY_ENGINE_DETAIL}`);
    },
  );

  it.each([' ast-grep ', 'AST-GREP', 'Regex'])(
    'still REJECTS the near-miss %j — admission stays the closed case-sensitive enum',
    (nearMiss) => {
      // The diagnostic softening must not soften ADMISSION: only the exact
      // lowercase tokens parse, so a case/whitespace variant of a LIVE type is
      // still an unknown type, not a silent accept.
      const record = astGrepRecord();
      target(record).type = nearMiss;
      const failure = reject(record);
      expect(failure).toBeInstanceOf(RuleRecordNoSilentSkipError);
      expect((failure as RuleRecordNoSilentSkipError).construct).toBe('target.type');
    },
  );

  it('lets the VERSION gate win over the V1 key set — an unknown version is diagnosed first', () => {
    // `version:` is inexpressible at V1 (§ Design 3) but is the field § Design 3
    // itself names as "can return by version bump". A future-version record
    // carrying it must be told its VERSION is unknown — the V1 reserved set has no
    // standing over a document that does not declare V1.
    const record: Record<string, unknown> = { ...astGrepRecord(), schemaVersion: 2, version: '3' };
    const failure = reject(record);
    expect(failure).toBeInstanceOf(RuleRecordNoSilentSkipError);
    expect(failure).not.toBeInstanceOf(RuleRecordProducerKeyError);
    expect((failure as RuleRecordNoSilentSkipError).construct).toBe('schemaVersion');
  });

  it('rejects the reserved-unimplemented `requires.scope: block` (§ Design 8)', () => {
    const record = regexRecord();
    record.requires = { pattern: 'LC_ALL=C', scope: 'block' };
    const failure = reject(record);
    expect(failure).toBeInstanceOf(RuleRecordNoSilentSkipError);
    expect((failure as RuleRecordNoSilentSkipError).construct).toBe('requires.scope');
    expect(failure.message).toContain('RESERVED-UNIMPLEMENTED');
  });
});

describe('§ Design 14 — banned silent behaviour: SILENT EXPANSION', () => {
  it('rejects a brace-expanded glob on the record path (§ Design 7 brace ruling)', () => {
    const record = astGrepRecord();
    scope(record).fileGlobs = ['packages/**/*.{ts,tsx}'];
    const failure = reject(record);
    expect(failure.message).toContain('brace expansion');
    // The tolerant `sanitizeFileGlobs` behaviour serving the FROZEN legacy lesson
    // corpus is untouched — this dialect binds the record path only (§ Design 7
    // conformance scope). That freeze-isolation guard is slice 2's, beside the
    // legacy path it must not perturb.
  });
});

describe('§ Design 14 — banned silent behaviour: SILENT PROMOTION', () => {
  it('retains a shallow `*.ts` glob BYTE-VERBATIM — no promotion to tree-wide (§ Design 7)', () => {
    const record = astGrepRecord();
    scope(record).fileGlobs = ['*.ts'];
    const parsed = parseObject(record);
    // A glob means what it says: `*.ts` is root-level, tree-wide is written `**/*.ts`.
    // The parser performs NO transformation of any glob, ever.
    expect(parsed.record.target.scope.fileGlobs).toEqual(['*.ts']);
    // NOTE: asserting that the shallow glob MATCHES root-level only (effective
    // scope == declared scope) needs the matcher, which lands with the compiled
    // homes in slice 2; this fixture pins the parse-side half — verbatim retention.
  });

  it('retains every declared glob byte-verbatim, exclusions included', () => {
    const record = astGrepRecord();
    scope(record).fileGlobs = ['packages/**/*.ts', 'tools/*.mjs'];
    scope(record).excludeGlobs = ['**/*.test.ts', 'packages/core/dist/*.js'];
    const parsed = parseObject(record);
    expect(parsed.record.target.scope.fileGlobs).toEqual(['packages/**/*.ts', 'tools/*.mjs']);
    expect(parsed.record.target.scope.excludeGlobs).toEqual([
      '**/*.test.ts',
      'packages/core/dist/*.js',
    ]);
  });
});

// ── § Design 7 — one negative fixture per dialect rule ───────────────────────

describe('§ Design 7 — the normative glob dialect', () => {
  const violations: ReadonlyArray<[GlobDialectRule, string]> = [
    ['brace-expansion', 'packages/**/*.{ts,tsx}'],
    ['negation', '!**/*.test.ts'],
    ['adjacent-globstar', '**/**/*.ts'],
    ['embedded-globstar', 'src/**.ts'],
    ['regex-syntax', 'src/[abc]/*.ts'],
    ['regex-syntax', 'src/(a|b)/*.ts'],
    ['regex-syntax', 'src/?.ts'],
    ['regex-syntax', 'src/a+/*.ts'],
    // Each regex construct varied INDEPENDENTLY of the others: bare alternation
    // with no parens, and each anchor with no brackets — otherwise an earlier
    // blacklist entry would mask a missing one.
    ['regex-syntax', 'src/a|b/*.ts'],
    ['regex-syntax', 'src/^foo/*.ts'],
    ['regex-syntax', 'src/foo$/*.ts'],
    // Same masking cure applied to the CLOSING halves. `src/[abc]/*.ts` and
    // `src/(a|b)/*.ts` above contain BOTH members of their pair, so `]` and `)`
    // were only ever rejected by their opening partner's blacklist entry — drop
    // `]` or `)` from the set and every fixture above still passed. These pin
    // each one alone (Prop 310 Amendment 2's strict set is ruled spec text, so
    // every member needs its own fixture).
    ['regex-syntax', 'src/abc]/*.ts'],
    ['regex-syntax', 'src/ab)/*.ts'],
    ['separator', 'packages\\core\\*.ts'],
    ['absolute-path', '/packages/core/*.ts'],
    ['drive-letter', 'C:/packages/core/*.ts'],
    ['empty', ''],
    ['empty-segment', 'packages//core/*.ts'],
    ['current-segment', './packages/*.ts'],
    ['current-segment', 'a/./b/*.ts'],
    ['parent-segment', '../sibling-repo/src/*.ts'],
    ['parent-segment', 'packages/../tools/*.mjs'],
    ['surrounding-whitespace', ' packages/**/*.ts'],
    ['surrounding-whitespace', 'packages/**/*.ts '],
  ];

  it('every § Design 7 rule has a negative fixture (no rule ships unexercised)', () => {
    // Mirrors the inexpressible-key guard: a rule added to the dialect without a
    // fixture is a rule nothing pins (§ Design 14).
    expect(GLOB_DIALECT_RULES.length).toBe(13);
    const exercised = new Set(violations.map(([rule]) => rule));
    for (const rule of GLOB_DIALECT_RULES) {
      expect(exercised.has(rule)).toBe(true);
    }
    // …and no fixture cites a rule outside the closed set.
    for (const rule of exercised) {
      expect(GLOB_DIALECT_RULES).toContain(rule);
    }
  });

  it.each(violations)('cites the `%s` rule for %j', (rule, glob) => {
    const violation = checkGlobDialect(glob);
    expect(violation).not.toBeNull();
    expect(violation!.rule).toBe(rule);
    expect(violation!.message).toContain('§ Design 7');
  });

  it.each(violations)('rejects the `%s` violation %j in fileGlobs', (_rule, glob) => {
    const record = astGrepRecord();
    scope(record).fileGlobs = [glob];
    expect(reject(record).keyPath).toBe('target.scope.fileGlobs.0');
  });

  it.each(violations)('rejects the `%s` violation %j in excludeGlobs', (_rule, glob) => {
    const record = astGrepRecord();
    scope(record).excludeGlobs = [glob];
    expect(reject(record).keyPath).toBe('target.scope.excludeGlobs.0');
  });

  it.each([
    'packages/**/*.ts',
    '**/*.test.ts',
    '*.ts',
    'src/*',
    '**',
    'tools/install-hooks.js',
    'packages/*/src/**/*.ts',
    // Dots are rejected as WHOLE segments only — inside a segment a dot is an
    // ordinary literal, which is what every extension form is built on.
    '.github/workflows/*.yml',
    'src/a..b/*.ts',
    'docs/release.notes.md',
  ])('admits the dialect-clean glob %j', (glob) => {
    expect(checkGlobDialect(glob)).toBeNull();
  });

  // Per-character LEGAL NEAR-MISS: the same glob shape with the banned character
  // removed and nothing else changed. Without these, the negative fixtures above
  // are satisfiable by a validator that rejects far too much — every one of them
  // would still pass if `checkGlobDialect` simply refused any glob containing a
  // letter from `abc`. Pairing each rejection with the minimally-different
  // acceptance is what makes the boundary a boundary rather than a wall.
  it.each([
    ['[', 'src/[abc]/*.ts', 'src/abc/*.ts'],
    [']', 'src/abc]/*.ts', 'src/abc/*.ts'],
    ['(', 'src/(ab/*.ts', 'src/ab/*.ts'],
    [')', 'src/ab)/*.ts', 'src/ab/*.ts'],
    ['?', 'src/?.ts', 'src/a.ts'],
    ['+', 'src/a+/*.ts', 'src/a/*.ts'],
    ['|', 'src/a|b/*.ts', 'src/ab/*.ts'],
    ['^', 'src/^foo/*.ts', 'src/foo/*.ts'],
    ['$', 'src/foo$/*.ts', 'src/foo/*.ts'],
  ])('bans %j but admits the construct-free literal beside it', (char, banned, clean) => {
    const violation = checkGlobDialect(banned);
    expect(violation?.rule).toBe('regex-syntax');
    expect(violation?.message).toContain(`'${char}'`);
    expect(checkGlobDialect(clean)).toBeNull();
  });

  it('never rewrites a glob — the validator is a pure predicate', () => {
    const record = astGrepRecord();
    scope(record).fileGlobs = ['packages/*/src/**/*.ts'];
    expect(parseObject(record).record.target.scope.fileGlobs[0]).toBe('packages/*/src/**/*.ts');
  });

  it('rejects a `!`-negated entry inside excludeGlobs — exclusion is STRUCTURAL (§ Design 7)', () => {
    const record = astGrepRecord();
    scope(record).excludeGlobs = ['!**/*.test.ts'];
    expect(reject(record).message).toContain('`!`-negation');
  });

  it('rejects an empty `fileGlobs` array (§ Design 5 mandatory set)', () => {
    const record = astGrepRecord();
    scope(record).fileGlobs = [];
    expect(reject(record).keyPath).toBe('target.scope.fileGlobs');
  });

  it('rejects an empty `excludeGlobs` array — "no exclusions" is expressed by OMISSION', () => {
    // An empty list is a silent no-op, and no key in this grammar carries a
    // do-nothing value (§ Design 4).
    const record = astGrepRecord();
    scope(record).excludeGlobs = [];
    expect(reject(record).keyPath).toBe('target.scope.excludeGlobs');
  });

  it('accepts an OMITTED `excludeGlobs` — the optional key stays optional', () => {
    const record = astGrepRecord();
    expect(parseObject(record).record.target.scope.excludeGlobs).toBeUndefined();
  });

  it('enforces the dialect through `RuleRecordSchema` itself, not only the parser', () => {
    const record = astGrepRecord();
    scope(record).fileGlobs = ['packages/**/*.{ts,tsx}'];
    expect(RuleRecordSchema.safeParse(record).success).toBe(false);
  });
});

// ── § Design 4 — closed keys at every depth of the record's key space ────────

describe('§ Design 4 — closed keys (unknown keys are parse errors at any depth)', () => {
  it('rejects an unknown key at the TOP level', () => {
    const record = { ...astGrepRecord(), notes: 'hello' };
    expect(reject(record).message).toContain('notes');
  });

  it('rejects an unknown key inside `target`', () => {
    const record = astGrepRecord();
    target(record).engine = 'ast-grep';
    expect(reject(record).message).toContain('engine');
  });

  it('rejects an unknown key inside `target.scope`', () => {
    const record = astGrepRecord();
    scope(record).ignoreGlobs = ['**/*.test.ts'];
    expect(reject(record).message).toContain('ignoreGlobs');
  });

  it('rejects an unknown key inside `examples[i]`', () => {
    const record = astGrepRecord();
    record.examples = [{ bad: 'x', good: 'y', note: 'z' }];
    expect(reject(record).message).toContain('note');
  });

  it('rejects an unknown key inside `requires`', () => {
    const record = regexRecord();
    record.requires = { pattern: 'LC_ALL=C', scope: 'line', within: 'line' };
    expect(reject(record).message).toContain('within');
  });

  it('rejects an unknown key inside `curation` (Prop 270 §8’s snake_case is NORMALIZED, not admitted)', () => {
    const record = astGrepRecord();
    record.curation = {
      sourceLesson: 'lesson-77c5e668389fb1a2',
      curatedBy: 'strategy-gemini',
      curatedAt: '2026-06-15T14:00:00Z',
      baseline5Phase: 3,
      source_lesson: 'lesson-77c5e668389fb1a2',
    };
    expect(reject(record).message).toContain('source_lesson');
  });

  it('rejects an unknown key inside `verification_shadow`', () => {
    const record = astGrepRecord();
    record.verification_shadow = { type: 'rego', source: 'package x', verified: true };
    expect(reject(record).message).toContain('verified');
  });

  it('rejects a `verification_shadow` missing its `source` (§ Design 12 closed keys)', () => {
    const record = astGrepRecord();
    record.verification_shadow = { type: 'rego' };
    expect(reject(record).message).toContain('source');
  });
});

// ── § Design 4 — the curation block, per operator ruling 2026-08-21 ──────────

describe('§ Design 4 — `curation`: the link stands alone, the process trio is all-or-none', () => {
  const SOURCE_LESSON = 'lesson-77c5e668389fb1a2';
  const TRIO = {
    curatedBy: 'strategy-gemini',
    curatedAt: '2026-06-15T14:00:00Z',
    baseline5Phase: 3,
  } as const;

  function withCuration(curation: unknown): Record<string, unknown> {
    const record = astGrepRecord();
    record.curation = curation;
    return record;
  }

  it('ADMITS `sourceLesson` alone — the direct-authored record→lesson link (§ Design 1)', () => {
    // Superseded IR-4: the build-time complete-or-absent reading rejected this
    // record; the operator ruling makes the link the block's only mandatory half.
    const parsed = parseObject(withCuration({ sourceLesson: SOURCE_LESSON }));
    expect(parsed.record.curation).toEqual({ sourceLesson: SOURCE_LESSON });
  });

  it('ADMITS the full block — link plus the whole Baseline-5 process record', () => {
    const parsed = parseObject(withCuration({ sourceLesson: SOURCE_LESSON, ...TRIO }));
    expect(parsed.record.curation).toEqual({ sourceLesson: SOURCE_LESSON, ...TRIO });
  });

  // Every PROPER non-empty subset of the trio — the three 1-of-3s and the three
  // 2-of-3s. All-or-none has exactly these six ways to be broken.
  const partialTrios: Array<[string, CurationProcessField[]]> = [
    ['curatedBy only', ['curatedBy']],
    ['curatedAt only', ['curatedAt']],
    ['baseline5Phase only', ['baseline5Phase']],
    ['curatedBy + curatedAt', ['curatedBy', 'curatedAt']],
    ['curatedBy + baseline5Phase', ['curatedBy', 'baseline5Phase']],
    ['curatedAt + baseline5Phase', ['curatedAt', 'baseline5Phase']],
  ];

  it.each(partialTrios)(
    'REJECTS the partial trio (%s), naming every missing member',
    (_label, present) => {
      const curation: Record<string, unknown> = { sourceLesson: SOURCE_LESSON };
      for (const field of present) curation[field] = TRIO[field];
      const failure = reject(withCuration(curation));
      const missing = CURATION_PROCESS_FIELDS.filter((field) => !present.includes(field));
      for (const field of missing) {
        expect(failure.message).toContain(`curation.${field} is REQUIRED`);
      }
      // …and never reports a member that IS present as missing.
      for (const field of present) {
        expect(failure.message).not.toContain(`curation.${field} is REQUIRED`);
      }
      expect(failure.keyPath).toBe(`curation.${missing[0]!}`);
    },
  );

  it('REJECTS the trio WITHOUT `sourceLesson` — the link is not the optional half', () => {
    const failure = reject(withCuration({ ...TRIO }));
    expect(failure.keyPath).toBe('curation.sourceLesson');
  });

  it('REJECTS an empty `curation: {}` block', () => {
    expect(reject(withCuration({})).keyPath).toBe('curation.sourceLesson');
  });

  it('REJECTS an empty-string `sourceLesson`', () => {
    expect(reject(withCuration({ sourceLesson: '   ' })).keyPath).toBe('curation.sourceLesson');
  });

  it('keeps the block CLOSED under the relaxation — an unknown key still fails', () => {
    const failure = reject(withCuration({ sourceLesson: SOURCE_LESSON, curatedFor: 'baseline-5' }));
    expect(failure.message).toContain('curatedFor');
  });

  it('introduces NO default — an absent trio stays ABSENT, never filled in', () => {
    const parsed = parseObject(withCuration({ sourceLesson: SOURCE_LESSON }));
    for (const field of CURATION_PROCESS_FIELDS) {
      expect(parsed.record.curation).not.toHaveProperty(field);
    }
  });

  it('still admits an OMITTED curation block — optional for direct-authored rules', () => {
    expect(parseObject(astGrepRecord()).record.curation).toBeUndefined();
  });
});

// ── § Design 4 — the inexpressible producer-owned / intake-seam key set ──────

describe('§ Design 4 — producer-owned and intake-seam keys are INEXPRESSIBLE', () => {
  it('pins the closed inexpressible set (a silent shrink would reopen the smuggle)', () => {
    expect(RULE_RECORD_INEXPRESSIBLE_KEYS.size).toBe(21);
    for (const key of [
      'id',
      'version',
      'ruleId',
      'declaredEngine',
      'provenance',
      'author',
      'authoredAt',
      'targetDefect',
      'structuralClass',
      'positiveFixtures',
      'negativeFixtures',
      'origin',
      'unverified',
      'authoringLedgerRef',
      'structuralEligibility',
      'decidable',
      'judgedBy',
      'basis',
      'classifierDisposition',
      'disposition',
      'routing',
    ]) {
      expect(RULE_RECORD_INEXPRESSIBLE_KEYS.has(key)).toBe(true);
    }
  });

  it.each([...RULE_RECORD_INEXPRESSIBLE_KEYS])(
    'rejects the producer-owned key `%s` with a SPECIFIC diagnostic, not a generic unknown-key message',
    (key) => {
      const record: Record<string, unknown> = { ...astGrepRecord(), [key]: 'smuggled' };
      const failure = reject(record);
      expect(failure).toBeInstanceOf(RuleRecordProducerKeyError);
      expect((failure as RuleRecordProducerKeyError).producerKey).toBe(key);
      expect(failure.message).toContain('producer-owned');
      expect(failure.message).toContain('INEXPRESSIBLE');
      expect(failure.keyPath).toBe(key);
    },
  );

  it('rejects a producer-owned key NESTED inside `curation` (`.strict()` alone is not recursive)', () => {
    const record = astGrepRecord();
    record.curation = {
      sourceLesson: 'lesson-77c5e668389fb1a2',
      curatedBy: 'strategy-gemini',
      curatedAt: '2026-06-15T14:00:00Z',
      baseline5Phase: 3,
      ruleId: '0123456789abcdef',
    };
    const failure = reject(record);
    expect(failure).toBeInstanceOf(RuleRecordProducerKeyError);
    expect(failure.keyPath).toBe('curation.ruleId');
  });

  it('rejects a producer-owned key nested inside `target.scope`', () => {
    const record = astGrepRecord();
    scope(record).provenance = { mergedPr: 1 };
    expect(reject(record).keyPath).toBe('target.scope.provenance');
  });

  it('rejects a producer-owned key inside an ARRAY element, in DOT-form (one path grammar)', () => {
    const record = astGrepRecord();
    record.examples = [{ bad: 'x', good: 'y', origin: 'mined' }];
    const failure = reject(record);
    // Dot-form at every depth, ordinals included — the same grammar Zod renders
    // (`examples.0.bad`). Two renderings of one address make a diagnostic ungreppable.
    expect(failure.keyPath).toBe('examples.0.origin');
  });

  it('renders scan paths and Zod paths in the SAME grammar for the same address', () => {
    const scanRecord = astGrepRecord();
    scanRecord.examples = [{ bad: 'x', good: 'y', origin: 'mined' }];
    const zodRecord = astGrepRecord();
    zodRecord.examples = [{ bad: '', good: 'y' }];
    const [scanHead] = reject(scanRecord).keyPath.split('.');
    const [zodHead, zodOrdinal] = reject(zodRecord).keyPath.split('.');
    expect(scanHead).toBe(zodHead);
    expect(zodOrdinal).toBe('0');
    expect(reject(scanRecord).keyPath.split('.')[1]).toBe('0');
  });

  it('uses dot-form in the FULL rendered message, not just keyPath — no bracket-index residue', () => {
    // The one-path-grammar rule governs what the author READS, so it is swept over
    // whole messages: a bracket INDEX (`[0]`, `[]`) from either the scan or a Zod
    // label is the residue class. A bare `'['` — as in the regex-syntax diagnostic
    // that quotes the offending character — is content, not a path, and stays legal.
    const BRACKET_INDEX = /\[\d*\]/;
    const fixtures: Array<() => Record<string, unknown>> = [
      () => {
        const r = astGrepRecord();
        r.examples = [{ bad: '', good: 'y' }];
        return r;
      },
      () => {
        const r = astGrepRecord();
        r.examples = [{ bad: 'x', good: '   ' }];
        return r;
      },
      () => {
        const r = astGrepRecord();
        r.examples = [{ bad: 'x' }];
        return r;
      },
      () => {
        const r = astGrepRecord();
        r.examples = [{ bad: 'x', good: 'y', note: 'z' }];
        return r;
      },
      () => {
        const r = astGrepRecord();
        r.examples = [{ bad: 'x', good: 'y', origin: 'mined' }];
        return r;
      },
      () => {
        const r = astGrepRecord();
        scope(r).fileGlobs = ['packages/**/*.{ts,tsx}'];
        return r;
      },
      () => {
        const r = astGrepRecord();
        scope(r).excludeGlobs = ['!**/*.test.ts'];
        return r;
      },
    ];
    for (const build of fixtures) {
      const failure = reject(build());
      expect(failure.message).not.toMatch(BRACKET_INDEX);
      expect(failure.keyPath).not.toMatch(BRACKET_INDEX);
      expect(failure.recoveryHint).not.toMatch(BRACKET_INDEX);
    }
    // Guard the guard: the regex-syntax diagnostic DOES quote a bracket, and that
    // is content the sweep must not be tuned to forbid.
    const bracketGlob = astGrepRecord();
    scope(bracketGlob).fileGlobs = ['src/[abc]/*.ts'];
    const quoted = reject(bracketGlob);
    expect(quoted.message).toContain('[');
    expect(quoted.message).not.toMatch(BRACKET_INDEX);
  });

  it('rejects a producer-owned key inside the OPAQUE ast-grep payload interior (IR-3)', () => {
    // IR-2 keeps the payload interior opaque to NapiConfig validation; § Design 4’s
    // "inexpressible at ANY depth" still binds, so the closure scan descends.
    const record = astGrepRecord();
    target(record).rule = { kind: 'catch_clause', declaredEngine: 'regex' };
    const failure = reject(record);
    expect(failure).toBeInstanceOf(RuleRecordProducerKeyError);
    expect(failure.keyPath).toBe('target.rule.declaredEngine');
  });

  it('adds the PASTED-CONFIG hint on `target.rule.id` when a whole ast-grep config is pasted in', () => {
    // A complete ast-grep config carries `id` AND `language` at ITS top level; the
    // record's `target.rule` carries only the payload. `id` is the only half that
    // TRIPS here — it is inexpressible, while `language` is a legal record key at
    // `target.language`, so no producer-key error can ever fire for it. The single
    // reachable diagnostic therefore has to tell the author where BOTH halves go.
    const record = astGrepRecord();
    target(record).rule = {
      id: 'no-fail-open-catch',
      language: 'typescript',
      rule: { kind: 'catch_clause' },
      message: 'pasted from a standalone ast-grep config',
    };
    const failure = reject(record);
    expect(failure).toBeInstanceOf(RuleRecordProducerKeyError);
    expect(failure.keyPath).toBe('target.rule.id');
    expect((failure as RuleRecordProducerKeyError).producerKey).toBe('id');
    expect(failure.recoveryHint).toContain('PASTED complete ast-grep config');
    expect(failure.recoveryHint).toContain('target.language');
  });

  it('never fires a producer-key error for `language` — it is a LEGAL record key, not an inexpressible one', () => {
    // Pins the premise the hint rests on: `language` is absent from the closed
    // inexpressible set, so a `language` inside the opaque payload is carried, not
    // rejected, and the hint has exactly one reachable trigger (`id`).
    expect(RULE_RECORD_INEXPRESSIBLE_KEYS.has('language')).toBe(false);
    const record = astGrepRecord();
    target(record).rule = { kind: 'catch_clause', language: 'typescript' };
    expect(parseObject(record).record.target.rule).toEqual({
      kind: 'catch_clause',
      language: 'typescript',
    });
  });

  it('does NOT add the pasted-config hint for the same key at the record top level', () => {
    const record: Record<string, unknown> = { ...astGrepRecord(), id: 'hand-written' };
    const failure = reject(record);
    expect(failure.keyPath).toBe('id');
    expect(failure.recoveryHint).not.toContain('PASTED');
  });
});

// ── Security floor — JS prototype machinery is never a mapping key ───────────

describe('security floor — prototype-machinery keys are rejected at any depth', () => {
  const PROTO_KEYS = [...RULE_RECORD_FORBIDDEN_PROTOTYPE_KEYS];

  function payloadCarrying(key: string): string {
    return [
      'schemaVersion: 1',
      'severity: error',
      'message: "m"',
      'target:',
      '  type: ast-grep',
      '  language: typescript',
      '  rule:',
      `    ${key}:`,
      '      polluted: true',
      '  scope:',
      '    fileGlobs: ["src/*.ts"]',
      'examples:',
      '  - bad: "b"',
      '    good: "g"',
      '',
    ].join(LF);
  }

  function topLevelCarrying(key: string): string {
    return [
      'schemaVersion: 1',
      'severity: error',
      'message: "m"',
      `${key}:`,
      '  polluted: true',
      'target:',
      '  type: regex',
      '  pattern: "x"',
      '  scope:',
      '    fileGlobs: ["src/*.ts"]',
      'examples:',
      '  - bad: "b"',
      '    good: "g"',
      '',
    ].join(LF);
  }

  it('PREMISE: `yaml` materializes `__proto__` as an OWN ENUMERABLE key the scan can see', () => {
    // Pinned, not assumed: the whole floor rests on the scan's `Object.entries`
    // actually visiting these keys. If a `yaml` upgrade ever stopped materializing
    // them as own properties, this fails and tells us the premise moved — rather
    // than the rejection fixtures passing vacuously for a new reason.
    const parsed = yamlParse('rule:\n  __proto__:\n    polluted: true\n') as {
      rule: Record<string, unknown>;
    };
    expect(Object.keys(parsed.rule)).toContain('__proto__');
    expect(Object.entries(parsed.rule).map(([k]) => k)).toContain('__proto__');
    expect(Object.getOwnPropertyDescriptor(parsed.rule, '__proto__')).toBeDefined();
  });

  it.each(PROTO_KEYS)('rejects `%s` directly inside the opaque `target.rule` payload', (key) => {
    const failure = rejectRaw(payloadCarrying(key));
    expect(failure).toBeInstanceOf(RuleRecordPrototypeKeyError);
    expect((failure as RuleRecordPrototypeKeyError).prototypeKey).toBe(key);
    expect(failure.keyPath).toBe(`target.rule.${key}`);
    expect(failure.message).toContain('prototype machinery');
    // Rejected on SECURITY grounds, not as a § Design 4 producer-owned key.
    expect(failure.message).not.toContain('producer-owned');
    expect(failure).not.toBeInstanceOf(RuleRecordProducerKeyError);
  });

  it.each(PROTO_KEYS)('rejects `%s` at the document TOP LEVEL', (key) => {
    const failure = rejectRaw(topLevelCarrying(key));
    expect(failure).toBeInstanceOf(RuleRecordPrototypeKeyError);
    expect(failure.keyPath).toBe(key);
    expect(failure.message).not.toContain('producer-owned');
  });

  it('rejects `__proto__` DEEP-nested inside a compound payload (under `has:`)', () => {
    const failure = rejectRaw(
      [
        'schemaVersion: 1',
        'severity: error',
        'message: "m"',
        'target:',
        '  type: ast-grep',
        '  language: typescript',
        '  rule:',
        '    kind: catch_clause',
        '    not:',
        '      has:',
        '        __proto__:',
        '          polluted: true',
        '  scope:',
        '    fileGlobs: ["src/*.ts"]',
        'examples:',
        '  - bad: "b"',
        '    good: "g"',
        '',
      ].join(LF),
    );
    expect(failure).toBeInstanceOf(RuleRecordPrototypeKeyError);
    expect(failure.keyPath).toBe('target.rule.not.has.__proto__');
  });

  it('is a SEPARATE set from the § Design 4 inexpressible keys — the 21-key guard is untouched', () => {
    // The spec-defined set stays exactly 21 producer-owned keys; the floor is
    // three keys rejected on different grounds, with a different diagnostic.
    expect(RULE_RECORD_INEXPRESSIBLE_KEYS.size).toBe(21);
    expect(RULE_RECORD_FORBIDDEN_PROTOTYPE_KEYS.size).toBe(3);
    for (const key of PROTO_KEYS) {
      expect(RULE_RECORD_INEXPRESSIBLE_KEYS.has(key)).toBe(false);
    }
  });

  it('still admits the censused ast-grep payload vocabulary — the floor is narrow', () => {
    const record = astGrepRecord();
    target(record).rule = {
      kind: 'catch_clause',
      not: { has: { kind: 'throw_statement', stopBy: 'end' } },
      inside: { kind: 'function_declaration' },
    };
    expect(parseObject(record).record.target.rule).toBeDefined();
  });
});

// ── § Design 1 / § Design 12 — a record is a finite tree ─────────────────────

describe('§ Design 1 — a cyclic anchor is a parse error, never a crash', () => {
  it('rejects a recursive `&anchor`/`*alias` with a RuleRecordParseError, not a RangeError', () => {
    // `yaml` resolves a recursive alias into a genuinely cyclic object; unguarded
    // recursion over it blows the stack, which would break this module's totality
    // contract (a parse either returns a value or throws RuleRecordParseError).
    const cyclic = [
      'schemaVersion: 1',
      'severity: error',
      'message: "m"',
      'target: &t',
      '  type: ast-grep',
      '  language: typescript',
      '  rule:',
      '    loop: *t',
      '  scope:',
      '    fileGlobs: ["src/*.ts"]',
      'examples:',
      '  - bad: "b"',
      '    good: "g"',
      '',
    ].join(LF);
    let thrown: unknown;
    try {
      parseRuleRecord(cyclic, FILE);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(RuleRecordParseError);
    expect(thrown).not.toBeInstanceOf(RangeError);
    const failure = thrown as RuleRecordParseError;
    expect(failure.filePath).toBe(FILE);
    expect(failure.keyPath).toBe('target.rule.loop');
    expect(failure.message).toContain(FILE);
    expect(failure.message).toContain('cyclic YAML anchor');
  });

  it('rejects a cycle reached through an ARRAY element too', () => {
    const cyclic = [
      'schemaVersion: 1',
      'severity: error',
      'message: "m"',
      'target: &t',
      '  type: ast-grep',
      '  language: typescript',
      '  rule:',
      '    any:',
      '      - *t',
      '  scope:',
      '    fileGlobs: ["src/*.ts"]',
      'examples:',
      '  - bad: "b"',
      '    good: "g"',
      '',
    ].join(LF);
    const failure = rejectRaw(cyclic);
    expect(failure.keyPath).toBe('target.rule.any.0');
    expect(failure.message).toContain('cyclic YAML anchor');
  });

  it('still admits a legal SHARED anchor — a DAG is not a cycle', () => {
    // The guard tracks ANCESTORS, not visits: aliasing one node twice as siblings
    // is legal YAML and must not be misdiagnosed as recursion.
    const shared = [
      'schemaVersion: 1',
      'severity: error',
      'message: "m"',
      'target:',
      '  type: ast-grep',
      '  language: typescript',
      '  rule:',
      '    all:',
      '      - &leaf { kind: catch_clause }',
      '      - *leaf',
      '  scope:',
      '    fileGlobs: ["src/*.ts"]',
      'examples:',
      '  - bad: "b"',
      '    good: "g"',
      '',
    ].join(LF);
    const parsed = parseRuleRecord(shared, FILE);
    expect(parsed.record.target.rule).toEqual({
      all: [{ kind: 'catch_clause' }, { kind: 'catch_clause' }],
    });
  });
});

// ── § Design 4 / § Design 6 — the language binding ───────────────────────────

describe('§ Design 4/§ Design 6 — `language` is required iff ast-grep', () => {
  it('rejects a missing `language` for `type: ast-grep` (undefined-for-type is an error)', () => {
    const record = astGrepRecord();
    delete target(record).language;
    const failure = reject(record);
    expect(failure.keyPath).toBe('target.language');
    expect(failure.message).toContain('REQUIRED');
  });

  it('rejects a present `language` for `type: regex`', () => {
    const record = regexRecord();
    target(record).language = 'bash';
    const failure = reject(record);
    expect(failure.keyPath).toBe('target.language');
    expect(failure.message).toContain('FORBIDDEN');
  });

  it('rejects an empty `language` token', () => {
    const record = astGrepRecord();
    target(record).language = '   ';
    expect(reject(record).keyPath).toBe('target.language');
  });

  it('carries `language` as an identifier TOKEN — resolution against the registry is compile-stage (§ Design 6)', () => {
    // An unregistered language must NOT fail at parse: parse results stay
    // installation-independent while resolution stays explicit-or-error at compile.
    const record = astGrepRecord();
    target(record).language = 'brainfuck';
    expect(parseObject(record).record.target.language).toBe('brainfuck');
  });
});

// ── § Design 4 — the payload XOR ─────────────────────────────────────────────

describe('§ Design 4 — the target payload is exactly one of `pattern` / `rule`', () => {
  it('rejects an ast-grep target carrying BOTH `pattern` and `rule`', () => {
    const record = astGrepRecord();
    target(record).pattern = 'try { $$$ }';
    expect(reject(record).keyPath).toBe('target.rule');
  });

  it('rejects an ast-grep target carrying NEITHER `pattern` nor `rule`', () => {
    const record = astGrepRecord();
    delete target(record).rule;
    expect(reject(record).keyPath).toBe('target.pattern');
  });

  it('rejects a regex target carrying a compound `rule` payload', () => {
    const record = regexRecord();
    target(record).rule = { kind: 'catch_clause' };
    expect(reject(record).keyPath).toBe('target.rule');
  });

  it('rejects a regex target carrying NO `pattern`', () => {
    const record = regexRecord();
    delete target(record).pattern;
    expect(reject(record).keyPath).toBe('target.pattern');
  });

  it('rejects an empty compound payload — a degenerate `rule: {}` satisfies no XOR', () => {
    const record = astGrepRecord();
    target(record).rule = {};
    expect(reject(record).message).toContain('target.rule');
  });

  it('rejects an empty `pattern`', () => {
    const record = regexRecord();
    target(record).pattern = '   ';
    expect(reject(record).keyPath).toBe('target.pattern');
  });
});

// ── § Design 5 — the mandatory set + IR-1 exemplar non-emptiness ─────────────

describe('§ Design 5 — the mandatory set is non-omittable', () => {
  it('rejects a missing `message` (R8 — 4 of 140 hand-authored lessons carried one)', () => {
    const record = astGrepRecord();
    delete record.message;
    expect(reject(record).keyPath).toBe('message');
  });

  it('rejects an empty `message`', () => {
    const record = astGrepRecord();
    record.message = '   ';
    expect(reject(record).keyPath).toBe('message');
  });

  it('rejects an empty `recoveryHint` when the optional key is present', () => {
    const record = astGrepRecord();
    record.recoveryHint = '';
    expect(reject(record).keyPath).toBe('recoveryHint');
  });

  it('rejects a missing `target`', () => {
    const record = astGrepRecord();
    delete record.target;
    expect(reject(record).keyPath).toBe('target');
  });

  it('rejects a missing `target.scope`', () => {
    const record = astGrepRecord();
    delete target(record).scope;
    expect(reject(record).keyPath).toBe('target.scope');
  });

  it('rejects a missing `target.scope.fileGlobs`', () => {
    const record = astGrepRecord();
    delete scope(record).fileGlobs;
    expect(reject(record).keyPath).toBe('target.scope.fileGlobs');
  });

  it('rejects a missing `examples` — certification’s primary preimage source', () => {
    const record = astGrepRecord();
    delete record.examples;
    expect(reject(record).keyPath).toBe('examples');
  });

  it('rejects an EMPTY `examples` list (§ Design 5 minimum one pair)', () => {
    const record = astGrepRecord();
    record.examples = [];
    expect(reject(record).keyPath).toBe('examples');
  });

  it('accepts multiple pairs — a single-pair cap would narrow the shipped ADR-112 arity', () => {
    const record = astGrepRecord();
    record.examples = [
      { bad: 'b0', good: 'g0' },
      { bad: 'b1', good: 'g1' },
    ];
    expect(parseObject(record).record.examples).toHaveLength(2);
  });

  it('rejects a zero-byte `bad` exemplar (IR-1 — it cannot serve as a preimage differential)', () => {
    const record = astGrepRecord();
    record.examples = [{ bad: '', good: 'ok' }];
    expect(reject(record).keyPath).toBe('examples.0.bad');
  });

  it('rejects a zero-byte `good` exemplar (IR-1)', () => {
    const record = astGrepRecord();
    record.examples = [{ bad: 'ok', good: '' }];
    expect(reject(record).keyPath).toBe('examples.0.good');
  });

  it('rejects an exemplar pair missing its `good` leg', () => {
    const record = astGrepRecord();
    record.examples = [{ bad: 'ok' }];
    expect(reject(record).keyPath).toBe('examples.0.good');
  });

  it('rejects an empty `requires.pattern`', () => {
    const record = regexRecord();
    record.requires = { pattern: '   ', scope: 'line' };
    expect(reject(record).keyPath).toBe('requires.pattern');
  });

  it('rejects a LIST of `requires` blocks — V1 carries exactly one (§ Design 8)', () => {
    const record = regexRecord();
    record.requires = [{ pattern: 'LC_ALL=C', scope: 'line' }];
    expect(reject(record).keyPath).toBe('requires');
  });

  it('rejects a non-integer `curation.baseline5Phase`', () => {
    const record = astGrepRecord();
    record.curation = {
      sourceLesson: 'lesson-77c5e668389fb1a2',
      curatedBy: 'strategy-gemini',
      curatedAt: '2026-06-15T14:00:00Z',
      baseline5Phase: 3.5,
    };
    expect(reject(record).keyPath).toBe('curation.baseline5Phase');
  });
});

// ── § Design 1 — carrier-level failures ─────────────────────────────────────

describe('§ Design 1 — the carrier: one rule = one YAML document = one file', () => {
  it('rejects a YAML syntax error, naming the file', () => {
    const failure = rejectRaw(`schemaVersion: 1${LF}target: [unclosed${LF}`);
    expect(failure.message).toContain('invalid YAML');
    expect(failure.keyPath).toBe('(document)');
  });

  it('rejects DUPLICATE keys — picking one value silently is the killed class', () => {
    const failure = rejectRaw(
      [
        'schemaVersion: 1',
        'severity: error',
        'severity: warning',
        'message: "m"',
        'target:',
        '  type: regex',
        '  pattern: "x"',
        '  scope:',
        '    fileGlobs: ["**/*.sh"]',
        'examples:',
        '  - bad: "b"',
        '    good: "g"',
        '',
      ].join(LF),
    );
    expect(failure.message).toContain('invalid YAML');
    expect(failure.message).toContain('unique');
  });

  it('rejects a MULTI-document file — one rule is one YAML document is one file', () => {
    const failure = rejectRaw(
      [
        'schemaVersion: 1',
        'severity: error',
        'message: "first"',
        '---',
        'schemaVersion: 1',
        'severity: error',
        'message: "second"',
        '',
      ].join(LF),
    );
    expect(failure.message).toContain('invalid YAML');
    expect(failure.message).toContain('multiple documents');
    expect(failure.keyPath).toBe('(document)');
  });

  it('rejects a document that is a LIST, not a mapping', () => {
    expect(rejectRaw(`- schemaVersion: 1${LF}`).message).toContain('not a YAML mapping');
  });

  it('rejects an EMPTY document', () => {
    expect(rejectRaw('').message).toContain('not a YAML mapping');
  });

  it('rejects a scalar document', () => {
    expect(rejectRaw(`just a string${LF}`).message).toContain('not a YAML mapping');
  });

  it('names the file path it was handed, whatever the slug (identity never lives in the filename)', () => {
    const other = '.totem/rules/some-other-slug.rule.yaml';
    const record = astGrepRecord();
    delete record.severity;
    expect(reject(record, other).filePath).toBe(other);
  });
});
