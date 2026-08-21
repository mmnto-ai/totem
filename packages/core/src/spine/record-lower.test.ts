// ─── Prop 310 § Design 14 — conformance suite, slice 2: LOWERING ─────────────
//
// Slice 1's suite pins what the parser ADMITS; this one pins what lowering DOES
// with what was admitted. The § Design 12 obligation under test is total
// lowering: "every construct the parser admits either lands on the compiled
// record or fails compile LOUD — no construct is accepted at parse and dropped at
// compile." Each cannot-lower construct class gets a negative fixture, each
// verbatim carry gets a positive one, and the freeze boundary gets a guard that
// fails the moment the record path starts sanitizing (or the legacy path stops).

import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { stringify as yamlStringify } from 'yaml';

import { extensionToLang, resolveAstGrepLangs } from '../ast-grep-query.js';
import { canonicalStringify } from '../compile-manifest.js';
import { sanitizeFileGlobs } from '../compiler.js';
import { CompiledRuleSchema, CompiledRulesFileSchema } from '../compiler-schema.js';
import { design4ExemplarRecord, design8ExemplarRecord } from './record-exemplars.fixture.js';
import {
  compileRuleRecord,
  languageProbeGlobs,
  resolveRecordLanguage,
  V1_INEXPRESSIBLE_NAPI_KEYS,
} from './record-lower.js';
import { isRecordPathRule, RECORD_COMPILED_HOME_KEYS } from './record-runtime.js';
import {
  type ParsedRuleRecord,
  parseRuleRecord,
  RequiresScopeSchema,
  RuleCurationSchema,
  RuleRecordExampleSchema,
} from './rule-record.js';

const FILE = '.totem/rules/fail-open-catch.rule.yaml';
/** A well-formed ADR-112 §8 minted id (16 lowercase hex, no collision suffix). */
const RULE_ID = '0123456789abcdef';
const NOW = '2026-08-21T00:00:00.000Z';

function lower(record: Record<string, unknown>, ruleId = RULE_ID) {
  const parsed = parseRuleRecord(yamlStringify(record), FILE);
  return compileRuleRecord(parsed, { ruleId, now: NOW });
}

/** Lower and assert success, returning the compiled rule (a rejection fails loudly, with its reason). */
function lowerOk(record: Record<string, unknown>, ruleId = RULE_ID) {
  const outcome = lower(record, ruleId);
  if (outcome.kind !== 'compiled') {
    throw new Error(`expected a compiled outcome, got rejected: ${outcome.reason}`);
  }
  return outcome.rule;
}

/** Lower and assert rejection, returning the reason (a compile fails loudly). */
function lowerRejected(record: Record<string, unknown>): string {
  const outcome = lower(record);
  if (outcome.kind !== 'rejected') {
    throw new Error('expected a rejected outcome, got a compiled rule');
  }
  return outcome.reason;
}

/** A minimal dialect-clean ast-grep record (compound tree payload). */
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

/** A minimal dialect-clean regex record. */
function regexRecord(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    severity: 'warning',
    message: 'git output-consuming commands must pin LC_ALL=C on the same line.',
    target: {
      type: 'regex',
      pattern: '\\bgit\\s+(log|diff|status)\\b',
      scope: { fileGlobs: ['**/*.sh'] },
    },
    examples: [{ bad: 'git log --oneline', good: 'LC_ALL=C git log --oneline' }],
  };
}

// ─── A. The compiled homes (§ Design 12) + mined-path byte identity ──────────

describe('CompiledRuleSchema additions — the § Design 12 compiled homes', () => {
  const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
  const manifestPath = `${repoRoot}.totem/compiled-rules.json`;
  const rawManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as {
    rules: Record<string, unknown>[];
  };

  it('re-validates the shipped 485-rule manifest BYTE-IDENTICALLY under the extended schema', () => {
    // The freeze-compatibility proof (Amendment R11 / § Data model deltas): the
    // additions are optional, so the frozen corpus parses unchanged — and
    // "unchanged" is checked on the MANIFEST-HASH basis (canonical, key-sorted),
    // which is the identity that actually matters to `verify-manifest`. A
    // required addition, or one that introduced a default, would move every hash.
    const parsed = CompiledRulesFileSchema.parse(rawManifest);
    expect(parsed.rules.length).toBe(rawManifest.rules.length);
    expect(canonicalStringify(parsed.rules)).toBe(canonicalStringify(rawManifest.rules));
  });

  it('leaves every legacy rule OUTSIDE the record path — the discriminator cannot flip one', () => {
    // The runtime reads field PRESENCE as the record-path discriminator, so this
    // is what makes "legacy rules keep their matching behaviour byte-for-byte" a
    // fact rather than an intention. If a future writer ever puts one of these
    // fields on a mined rule, this fails before the matcher silently changes.
    const carriers = rawManifest.rules.filter((rule) =>
      RECORD_COMPILED_HOME_KEYS.some((key) => rule[key] !== undefined),
    );
    expect(carriers).toEqual([]);
    const compiled = CompiledRulesFileSchema.parse(rawManifest).rules;
    expect(compiled.filter(isRecordPathRule)).toEqual([]);
  });

  it('accepts a rule carrying NONE of the additions (every one is optional)', () => {
    const minimal = CompiledRuleSchema.parse({
      lessonHash: 'abcdef0123456789',
      lessonHeading: 'legacy',
      pattern: 'foo',
      message: 'no',
      engine: 'regex',
      compiledAt: NOW,
    });
    for (const key of RECORD_COMPILED_HOME_KEYS) {
      expect(minimal[key]).toBeUndefined();
    }
  });

  it('couples the compiled `requires.scope` enum to the grammar’s RequiresScopeSchema', () => {
    // `compiler-schema.ts` is an import-graph leaf and cannot import the grammar
    // (it would close a cycle), so the two enums are mirrored in source and
    // COUPLED here. `block` stays reserved-unimplemented on both sides.
    const rule = lowerOk({ ...regexRecord(), requires: { pattern: 'x', scope: 'file' } });
    expect(RequiresScopeSchema.options).toEqual(['line', 'file']);
    expect(rule.requires?.scope).toBe('file');
    for (const scope of RequiresScopeSchema.options) {
      expect(
        CompiledRuleSchema.safeParse({
          lessonHash: RULE_ID,
          lessonHeading: 'h',
          pattern: 'p',
          message: 'm',
          engine: 'regex',
          compiledAt: NOW,
          requires: { pattern: 'x', scope },
        }).success,
      ).toBe(true);
    }
    expect(
      CompiledRuleSchema.safeParse({
        lessonHash: RULE_ID,
        lessonHeading: 'h',
        pattern: 'p',
        message: 'm',
        engine: 'regex',
        compiledAt: NOW,
        requires: { pattern: 'x', scope: 'block' },
      }).success,
    ).toBe(false);
  });

  it('couples the compiled `examples` and `curation` shapes to the grammar’s schemas', () => {
    expect(Object.keys(RuleRecordExampleSchema.shape).sort()).toEqual(['bad', 'good']);
    expect(Object.keys(RuleCurationSchema._def.schema.shape).sort()).toEqual([
      'baseline5Phase',
      'curatedAt',
      'curatedBy',
      'sourceLesson',
    ]);
    const rule = lowerOk(design4ExemplarRecord());
    expect(Object.keys(rule.examples![0]!).sort()).toEqual(['bad', 'good']);
    expect(Object.keys(rule.curation!).sort()).toEqual([
      'baseline5Phase',
      'curatedAt',
      'curatedBy',
      'sourceLesson',
    ]);
  });
});

// ─── B. The freeze boundary (§ Design 7 conformance scope) ───────────────────

describe('freeze guard — sanitizeFileGlobs is untouched and never runs on the record path', () => {
  it('keeps the legacy brace EXPANSION byte-for-byte', () => {
    expect(sanitizeFileGlobs(['**/*.{ts,js}'])).toEqual(['**/*.ts', '**/*.js']);
    expect(sanitizeFileGlobs(['src/*.{ts,tsx,js}'])).toEqual(['src/*.ts', 'src/*.tsx', 'src/*.js']);
  });

  it('keeps the legacy shallow-glob PROMOTION byte-for-byte', () => {
    expect(sanitizeFileGlobs(['*.ts'])).toEqual(['**/*.ts']);
    expect(sanitizeFileGlobs(['*'])).toEqual(['**/*']);
    expect(sanitizeFileGlobs(['!*.ts'])).toEqual(['!**/*.ts']);
    expect(sanitizeFileGlobs(['src/*.ts'])).toEqual(['src/*.ts']);
  });

  it('carries record globs VERBATIM — no promotion, no expansion, no trimming', () => {
    // The negative half of the two guards above: the same `*.ts` the sanitizer
    // promotes tree-wide survives lowering unchanged. Braces never reach here
    // (a parse error), so the only observable transform would be promotion.
    const record = regexRecord();
    (record.target as Record<string, unknown>).scope = {
      fileGlobs: ['*.ts', 'src/*.ts', '**/*.sh'],
      excludeGlobs: ['**/*.test.ts'],
    };
    const rule = lowerOk(record);
    expect(rule.fileGlobs).toEqual(['*.ts', 'src/*.ts', '**/*.sh']);
    expect(rule.excludeGlobs).toEqual(['**/*.test.ts']);
  });
});

// ─── C. § Design 6 — language resolution moves to the declared language ──────

describe('§ Design 6 — the declared language resolves against the registry', () => {
  it('resolves a registered language and reports its representative extension', () => {
    const resolution = resolveRecordLanguage('typescript');
    expect(resolution.resolved).toBe(true);
    if (!resolution.resolved) return;
    expect(resolution.language).toBe('typescript');
    expect(['.cts', '.mts', '.ts']).toContain(resolution.extension);
  });

  it('fails loud on an unresolvable language, naming the registry as the authority', () => {
    const resolution = resolveRecordLanguage('rust');
    expect(resolution.resolved).toBe(false);
    if (resolution.resolved) return;
    expect(resolution.reason).toContain('§ Design 6');
    expect(resolution.reason).toContain('extensionToLanguage registry');
    expect(resolution.reason).toContain('typescript');
  });

  it('pins the validator probe to EXACTLY one Lang (coupling guard on resolveAstGrepLangs)', () => {
    // The record path pins `validateAstGrepPattern` to one grammar by handing it
    // a probe glob carrying one registered extension. That indirection is only
    // safe while the shipped derivation still maps one extension to one Lang —
    // so this asserts the coupling instead of trusting it.
    for (const language of ['typescript', 'tsx', 'javascript']) {
      const resolution = resolveRecordLanguage(language);
      expect(resolution.resolved).toBe(true);
      if (!resolution.resolved) continue;
      const langs = resolveAstGrepLangs(languageProbeGlobs(resolution.extension));
      expect(langs).toEqual([extensionToLang(resolution.extension)]);
      expect(langs).toHaveLength(1);
    }
  });

  it('validates under the DECLARED language, not the glob-derived one (the “moves” row)', () => {
    // `type_alias_declaration` exists in the TypeScript/TSX grammars and not in
    // JavaScript. The shipped try-each-glob-derived-Lang validator would resolve
    // TypeScript from `**/*.ts` and ACCEPT this payload; the record path resolves
    // ONLY the declared `javascript` and must reject it. This is the
    // mmnto-ai/totem#1654 cross-grammar acceptance being retired on this path.
    const record = astGrepRecord();
    const target = record.target as Record<string, unknown>;
    target.rule = { kind: 'type_alias_declaration' };
    target.scope = { fileGlobs: ['**/*.ts'] };

    target.language = 'typescript';
    expect(lower(record).kind).toBe('compiled');

    target.language = 'javascript';
    const reason = lowerRejected(record);
    expect(reason).toContain('§ Design 6');
    expect(reason).toContain("declared language 'javascript'");
    expect(reason).toContain('try-each-glob-derived-Lang');
  });
});

// ─── D. Cannot-lower negatives, one per construct class ──────────────────────

describe('§ Design 12 — a construct that cannot lower fails compile LOUD', () => {
  it('rejects a bad regex in `requires.pattern` (gated on EVERY engine)', () => {
    const reason = lowerRejected({
      ...regexRecord(),
      requires: { pattern: '(a+)+$', scope: 'line' },
    });
    expect(reason).toContain('§ Design 8');
    expect(reason).toContain('requires.pattern');
    expect(reason).toContain('ReDoS');
  });

  it('gates `requires.pattern` on an ast-grep rule too — the check is engine-independent', () => {
    const reason = lowerRejected({
      ...astGrepRecord(),
      requires: { pattern: '(a+)+$', scope: 'file' },
    });
    expect(reason).toContain('§ Design 8');
    expect(reason).toContain('independent of target.type');
  });

  it('rejects an unresolvable `language`', () => {
    const record = astGrepRecord();
    (record.target as Record<string, unknown>).language = 'brainfuck';
    const reason = lowerRejected(record);
    expect(reason).toContain('§ Design 6');
    expect(reason).toContain("'brainfuck' is not registered");
  });

  it('rejects a malformed ast-grep tree at the engine gate', () => {
    const record = astGrepRecord();
    (record.target as Record<string, unknown>).rule = { notARule: 1 };
    const reason = lowerRejected(record);
    expect(reason).toContain('§ Design 6');
    expect(reason).toContain('target.rule failed ast-grep validation');
  });

  it('rejects a bad regex in `target.pattern`', () => {
    const record = regexRecord();
    (record.target as Record<string, unknown>).pattern = '(';
    const reason = lowerRejected(record);
    expect(reason).toContain('§ Design 6');
    expect(reason).toContain('invalid syntax');
  });

  it('rejects V1-inexpressible NapiConfig siblings smuggled into the rule tree', () => {
    for (const key of V1_INEXPRESSIBLE_NAPI_KEYS) {
      const record = astGrepRecord();
      (record.target as Record<string, unknown>).rule = { kind: 'catch_clause', [key]: {} };
      const reason = lowerRejected(record);
      expect(reason).toContain('operator ruling 2026-08-21');
      expect(reason).toContain(`'${key}' is a NapiConfig SIBLING`);
      expect(reason).toContain('construct-gap');
    }
  });

  it('THROWS on a malformed ruleId — identity is a producer contract, not authored content', () => {
    expect(() => lower(regexRecord(), 'not-a-minted-id')).toThrow(/malformed ruleId/);
    expect(() => lower(regexRecord(), '')).toThrow(/malformed ruleId/);
    // A 16-hex base with the mint's own collision suffix is well-formed.
    expect(lowerOk(regexRecord(), '0123456789abcdef-2').lessonHash).toBe('0123456789abcdef-2');
  });

  it('THROWS on a record key with no defined lowering (the runtime totality check)', () => {
    // A key that got past the parser — via a cast, a schema/table desync, or a
    // future grammar edit that forgot this file — must never be silently dropped.
    const parsed = parseRuleRecord(yamlStringify(regexRecord()), FILE);
    const smuggled = {
      ...parsed,
      record: { ...parsed.record, futureConstruct: 'x' },
    } as unknown as ParsedRuleRecord;
    expect(() => compileRuleRecord(smuggled, { ruleId: RULE_ID, now: NOW })).toThrow(
      /record key 'futureConstruct' has no defined lowering/,
    );
  });

  it('THROWS on an engine-binding divergence (the assert is NOT tautological)', () => {
    // § Design 3: the two sides originate differently — the record's `target.type`
    // and the payload's actual compilation path. Tamper with one and the assert
    // must still fire, which is exactly what makes the derivation safe.
    const parsed = parseRuleRecord(yamlStringify(regexRecord()), FILE);
    const tampered = { ...parsed, derivedEngine: 'ast-grep' } as unknown as ParsedRuleRecord;
    expect(() => compileRuleRecord(tampered, { ruleId: RULE_ID, now: NOW })).toThrow(
      /declared target.type 'ast-grep' but its payload compiled as 'regex'/,
    );
  });
});

// ─── E. Identity, verbatim carries, and the tree-form ruling ─────────────────

describe('lowering — identity, verbatim carries, and the derived NapiConfig wrapper', () => {
  it('takes identity as an INPUT: lessonHash ← ruleId, never a dslSource hash', () => {
    const rule = lowerOk(regexRecord());
    expect(rule.lessonHash).toBe(RULE_ID);
    expect(rule.lessonHeading).toBe(`Prop 310 rule record (${RULE_ID})`);
    // The heading is NOT a copy of the author's message (Tenet 20 — one home).
    expect(rule.lessonHeading).not.toBe(rule.message);
  });

  it('mints Yellow: unverified true, legitimacy and ruleClass absent', () => {
    const rule = lowerOk(regexRecord());
    expect(rule.unverified).toBe(true);
    expect(rule.legitimacy).toBeUndefined();
    expect(rule.ruleClass).toBeUndefined();
    expect(rule.compiledAt).toBe(NOW);
    expect(rule.createdAt).toBe(NOW);
  });

  it('carries every § Design 4 construct verbatim onto the compiled rule', () => {
    const record = design4ExemplarRecord();
    const rule = lowerOk(record);
    expect(rule.severity).toBe('error');
    expect(rule.message).toBe(record.message);
    expect(rule.recoveryHint).toBe(record.recoveryHint);
    expect(rule.examples).toEqual(record.examples);
    expect(rule.curation).toEqual(record.curation);
    expect(rule.fileGlobs).toEqual(['packages/**/*.ts']);
    expect(rule.excludeGlobs).toEqual(['**/*.test.ts']);
    expect(rule.language).toBe('typescript');
    expect(rule.engine).toBe('ast-grep');
  });

  it('renames `verification_shadow` → `verificationShadow` exactly once, verbatim', () => {
    const record = design4ExemplarRecord();
    const rule = lowerOk(record);
    expect(rule.verificationShadow).toEqual(record.verification_shadow);
    // The snake_case record key never survives onto the compiled artifact.
    expect((rule as Record<string, unknown>).verification_shadow).toBeUndefined();
  });

  it('derives the NapiConfig wrapper from the rule TREE (operator ruling 2026-08-21)', () => {
    const record = design4ExemplarRecord();
    const rule = lowerOk(record);
    const tree = (record.target as Record<string, unknown>).rule;
    // `{rule: <tree>}` plus the napi language derived from the RESOLVED
    // `target.language` — so the record carries no duplicate language home.
    expect(rule.astGrepYamlRule).toEqual({ rule: tree, language: extensionToLang('.ts') });
    expect(rule.astGrepPattern).toBeUndefined();
    expect(rule.pattern).toBe('');
  });

  it('routes a FLAT ast-grep payload to astGrepPattern, still language-pinned', () => {
    const record = astGrepRecord();
    const target = record.target as Record<string, unknown>;
    delete target.rule;
    target.pattern = 'console.log($A)';
    const rule = lowerOk(record);
    expect(rule.astGrepPattern).toBe('console.log($A)');
    expect(rule.astGrepYamlRule).toBeUndefined();
    expect(rule.language).toBe('typescript');
  });

  it('omits `language` for a regex rule — the grammar forbids it there', () => {
    const rule = lowerOk(regexRecord());
    expect(rule.language).toBeUndefined();
    expect(rule.pattern).toBe('\\bgit\\s+(log|diff|status)\\b');
  });

  it('omits every optional home the record did not declare', () => {
    const rule = lowerOk(regexRecord());
    expect(rule.excludeGlobs).toBeUndefined();
    expect(rule.requires).toBeUndefined();
    expect(rule.curation).toBeUndefined();
    expect(rule.verificationShadow).toBeUndefined();
    expect(rule.recoveryHint).toBeUndefined();
  });

  it('does NOT mirror examples onto the legacy badExample/goodExample pair', () => {
    // Amendment 1 makes the record's `examples` the single hand-editable home;
    // projecting it onto the legacy pair would be a second copy (Tenet 20).
    const rule = lowerOk(design4ExemplarRecord());
    expect(rule.badExample).toBeUndefined();
    expect(rule.goodExample).toBeUndefined();
    expect(rule.examples).toHaveLength(1);
  });

  it('is deterministic — the same record and inputs lower to a deep-equal rule', () => {
    expect(lowerOk(design4ExemplarRecord())).toEqual(lowerOk(design4ExemplarRecord()));
  });

  it('lowers BOTH Prop 310 exemplars (slice 1 parse → slice 2 compile)', () => {
    const design4 = lowerOk(design4ExemplarRecord());
    expect(design4.engine).toBe('ast-grep');

    const design8 = lowerOk(design8ExemplarRecord());
    expect(design8.engine).toBe('regex');
    expect(design8.requires).toEqual({ pattern: 'LC_ALL=C', scope: 'line' });
    expect(design8.fileGlobs).toEqual(['**/*.sh', '**/*.cjs']);
    expect(design8.severity).toBe('warning');
  });
});
