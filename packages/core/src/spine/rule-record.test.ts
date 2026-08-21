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
import { stringify as yamlStringify } from 'yaml';

import {
  checkGlobDialect,
  parseRuleRecord,
  RULE_RECORD_INEXPRESSIBLE_KEYS,
  RULE_RECORD_SCHEMA_VERSION,
  ruleExamplePairHash,
  RuleRecordNoSilentSkipError,
  RuleRecordParseError,
  RuleRecordProducerKeyError,
  RuleRecordSchema,
} from './rule-record.js';

const FILE = '.totem/rules/fail-open-catch.rule.yaml';

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

  it('hashes a CRLF-authored document identically to its LF-authored twin', () => {
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

  it('rejects `type: ast` — dropped from the AUTHORING surface at V1 (R16, § Design 6)', () => {
    const record = astGrepRecord();
    target(record).type = 'ast';
    expect(reject(record)).toBeInstanceOf(RuleRecordNoSilentSkipError);
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
  const violations: ReadonlyArray<[string, string]> = [
    ['brace-expansion', 'packages/**/*.{ts,tsx}'],
    ['negation', '!**/*.test.ts'],
    ['adjacent-globstar', '**/**/*.ts'],
    ['embedded-globstar', 'src/**.ts'],
    ['regex-syntax', 'src/[abc]/*.ts'],
    ['regex-syntax', 'src/(a|b)/*.ts'],
    ['regex-syntax', 'src/?.ts'],
    ['regex-syntax', 'src/a+/*.ts'],
    ['separator', 'packages\\core\\*.ts'],
    ['absolute-path', '/packages/core/*.ts'],
    ['drive-letter', 'C:/packages/core/*.ts'],
    ['empty', ''],
    ['empty-segment', 'packages//core/*.ts'],
  ];

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
  ])('admits the dialect-clean glob %j', (glob) => {
    expect(checkGlobDialect(glob)).toBeNull();
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

  it('rejects a partial `curation` block — a mandated block is complete or absent (IR-4)', () => {
    const record = astGrepRecord();
    record.curation = { sourceLesson: 'lesson-77c5e668389fb1a2' };
    expect(reject(record).message).toContain('curatedBy');
  });

  it('rejects a `verification_shadow` missing its `source` (§ Design 12 closed keys)', () => {
    const record = astGrepRecord();
    record.verification_shadow = { type: 'rego' };
    expect(reject(record).message).toContain('source');
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

  it('rejects a producer-owned key inside an ARRAY element (`examples[i]`)', () => {
    const record = astGrepRecord();
    record.examples = [{ bad: 'x', good: 'y', origin: 'mined' }];
    expect(reject(record).keyPath).toBe('examples[0].origin');
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
