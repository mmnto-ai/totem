import { describe, expect, it } from 'vitest';
import { stringify as yamlStringify } from 'yaml';

import { matchAstGrepPattern } from './ast-grep-query.js';
import { runSmokeGate } from './compile-smoke-gate.js';
import type { CompiledRule, DiffAddition } from './compiler-schema.js';
import { applyRulesToAdditionsBounded } from './regex-safety/apply-rules-bounded.js';
import { RegexEvaluator } from './regex-safety/evaluator.js';
import type { RuleEngineContext } from './rule-engine.js';
import { applyAstRulesToAdditions, applyRulesToAdditions } from './rule-engine.js';
import { design8ExemplarRecord } from './spine/record-exemplars.fixture.js';
import { compileRuleRecord } from './spine/record-lower.js';
import { parseRuleRecord } from './spine/rule-record.js';

// ─── Helpers ────────────────────────────────────────

function makeRegexRule(overrides: Partial<CompiledRule> = {}): CompiledRule {
  return {
    lessonHash: 'deadbeef1234',
    lessonHeading: 'No console.log',
    pattern: 'console\\.log',
    message: 'Do not use console.log',
    engine: 'regex',
    compiledAt: '2026-04-13T12:00:00Z',
    ...overrides,
  };
}

function makeAstGrepStringRule(overrides: Partial<CompiledRule> = {}): CompiledRule {
  return {
    lessonHash: 'cafeface5678',
    lessonHeading: 'No debugger',
    pattern: '',
    message: 'Do not commit debugger statements',
    engine: 'ast-grep',
    astGrepPattern: 'debugger',
    compiledAt: '2026-04-13T12:00:00Z',
    ...overrides,
  };
}

function makeCompoundRule(overrides: Partial<CompiledRule> = {}): CompiledRule {
  return {
    lessonHash: 'beefcafe9abc',
    lessonHeading: 'Empty catch',
    pattern: '',
    message: 'Empty catch swallows errors',
    engine: 'ast-grep',
    astGrepYamlRule: {
      rule: {
        kind: 'catch_clause',
        not: {
          has: {
            kind: 'statement_block',
            has: {
              any: [
                { kind: 'expression_statement' },
                { kind: 'variable_declaration' },
                { kind: 'if_statement' },
                { kind: 'return_statement' },
                { kind: 'throw_statement' },
              ],
              stopBy: 'end',
            },
          },
        },
      },
    },
    compiledAt: '2026-04-13T12:00:00Z',
    ...overrides,
  };
}

// ─── Prop 310 § Design 8 fixtures ────────────────────

/** § Design 8's exemplar target: the git verbs whose output must be locale-pinned. */
const GIT_TARGET = '\\bgit\\s+(log|diff|status)\\b';

/**
 * The exemplar's snippets, named ONCE.
 *
 * Each is inert fixture TEXT handed to `runSmokeGate` as rule INPUT — neither
 * this suite nor the dispatcher drive below runs a git command. The shipped
 * git-hygiene lessons that fire on the bare forms are ADVISORY here (regex
 * engine, no `ruleClass` ⇒ not hard-tier ⇒ excluded from the lint exit code), so
 * they are left to report rather than overridden; hoisting keeps them to one
 * finding per distinct literal.
 */
const BARE_LOG = 'git log --oneline';
const PINNED_DIFF = 'LC_ALL=C git diff HEAD';
/** The § Design 8 good example: the same target with the companion on the SAME line. */
const PINNED_LOG = `LC_ALL=C ${BARE_LOG}`;

// ─── runSmokeGate: regex rules ───────────────────────

describe('runSmokeGate — regex engine', () => {
  it('matches when the badExample contains the pattern', () => {
    const rule = makeRegexRule();
    const result = runSmokeGate(rule, 'console.log("debug")');
    expect(result.matched).toBe(true);
    expect(result.matchCount).toBeGreaterThanOrEqual(1);
  });

  it('does not match when the badExample is clean', () => {
    const rule = makeRegexRule();
    const result = runSmokeGate(rule, 'const x = 1;');
    expect(result.matched).toBe(false);
    expect(result.matchCount).toBe(0);
  });

  it('returns matched false for an empty badExample', () => {
    const rule = makeRegexRule();
    const result = runSmokeGate(rule, '');
    expect(result.matched).toBe(false);
    expect(result.matchCount).toBe(0);
  });

  it('returns matched false when the regex itself is invalid', () => {
    const rule = makeRegexRule({ pattern: '(unclosed' });
    const result = runSmokeGate(rule, 'console.log(1)');
    expect(result.matched).toBe(false);
    expect(result.matchCount).toBe(0);
    expect(result.reason).toContain('invalid');
  });
});

// ─── runSmokeGate: flat ast-grep rules ───────────────

describe('runSmokeGate — ast-grep flat pattern', () => {
  it('matches when the pattern hits the badExample', () => {
    const rule = makeAstGrepStringRule();
    const result = runSmokeGate(rule, 'debugger;\n');
    expect(result.matched).toBe(true);
    expect(result.matchCount).toBeGreaterThanOrEqual(1);
  });

  it('does not match when the pattern misses the badExample', () => {
    const rule = makeAstGrepStringRule();
    const result = runSmokeGate(rule, 'const x = 1;\n');
    expect(result.matched).toBe(false);
    expect(result.matchCount).toBe(0);
  });

  it('returns matched false when the pattern itself throws at runtime', () => {
    // Invalid kind — the ast-grep engine throws. The gate must surface
    // this as a non-match with a reason rather than propagating.
    const rule = makeAstGrepStringRule({ astGrepPattern: undefined });
    const invalid = makeAstGrepStringRule({ astGrepPattern: 'catch ($E) { $$$ }' });
    // Force an invalid string pattern so findAll throws.
    const result = runSmokeGate(invalid, 'try { work() } catch (err) {}');
    // A bare catch string pattern is multi-root and throws; the gate
    // swallows the throw and reports no match with a reason.
    expect(result.matched).toBe(false);
    expect(rule).toBeDefined(); // silence unused
  });
});

// ─── runSmokeGate: compound ast-grep rules ───────────

describe('runSmokeGate — ast-grep compound (astGrepYamlRule)', () => {
  it('matches when the compound rule fires on the badExample', () => {
    const rule = makeCompoundRule();
    const result = runSmokeGate(rule, 'try {\n  work();\n} catch (err) {\n}\n');
    expect(result.matched).toBe(true);
  });

  it('does not match when the compound rule misses the badExample', () => {
    const rule = makeCompoundRule();
    const result = runSmokeGate(rule, 'try {\n  work();\n} catch (err) {\n  log(err);\n}\n');
    expect(result.matched).toBe(false);
    expect(result.matchCount).toBe(0);
  });

  it('returns matched false with a reason when the compound rule throws', () => {
    const rule = makeCompoundRule({
      astGrepYamlRule: { rule: { kind: '!!!INVALID_KIND!!!' } },
    });
    const result = runSmokeGate(rule, 'const x = 1;\n');
    expect(result.matched).toBe(false);
    expect(result.reason).toBeDefined();
  });
});

// ─── extension inference (GCA WARN on design review) ─

describe('runSmokeGate badExample extension inference', () => {
  it('defaults to a TSX parser so JSX-flavored bad examples still parse', () => {
    const rule = makeAstGrepStringRule({
      astGrepPattern: 'console.log($$$)',
    });
    const jsxSnippet = 'const page = <div>{console.log("hi")}</div>;\n';
    const result = runSmokeGate(rule, jsxSnippet);
    expect(result.matched).toBe(true);
  });

  it('honors a concrete extension from the rule fileGlobs when present', () => {
    const rule = makeAstGrepStringRule({
      fileGlobs: ['**/*.ts'],
      astGrepPattern: 'debugger',
    });
    const tsSnippet = 'debugger;\n';
    const result = runSmokeGate(rule, tsSnippet);
    expect(result.matched).toBe(true);
  });

  // Regression for CR finding on PR #1415: multi-extension fileGlobs must
  // try every declared extension, not just the first match. Otherwise
  // a rule scoped to both `.js` and `.jsx` would gate on JavaScript only
  // and false-reject JSX-flavored bad examples, breaking parity with
  // runtime (which picks Lang.Tsx for `.jsx` files).
  it('tries every positive extension in fileGlobs, not just the first match', () => {
    const rule = makeAstGrepStringRule({
      fileGlobs: ['**/*.js', '**/*.jsx'],
      astGrepPattern: 'console.log($$$)',
    });
    // JSX-flavored snippet: would fail under JavaScript parser but matches
    // under Tsx. Runtime would also use Tsx for a real `.jsx` file.
    const jsxSnippet = 'const el = <div>{console.log("hi")}</div>;\n';
    const result = runSmokeGate(rule, jsxSnippet);
    expect(result.matched).toBe(true);
  });

  // Regression for CR finding on PR #1415: an unscoped rule with a TS
  // angle-bracket cast must not be false-rejected by a TSX-only fallback.
  // TS allows `<Foo>bar` as a type cast; TSX rejects it as an ambiguous
  // JSX tag open. The gate tries `.ts` before `.tsx` in the fallback set.
  it('accepts TS angle-bracket cast syntax on unscoped rules (not just TSX)', () => {
    const rule = makeAstGrepStringRule({
      fileGlobs: undefined, // unscoped
      astGrepPattern: '<$TYPE>$EXPR',
    });
    const tsSnippet = 'const x = <Foo>bar;\n';
    const result = runSmokeGate(rule, tsSnippet);
    expect(result.matched).toBe(true);
  });

  // ─── #1654 regression coverage ───────────────────────

  // Pre-#1654, the regex `\.(ts|tsx|js|jsx|mjs|cjs)\b` could not pick up
  // `.rs`, `.py`, etc. — non-TS/JS globs silently fell back to the TS/JS
  // default set, which meant the gate parsed `.rs` badExamples under TSX.
  // Post-#1654, the trailing-extension capture pulls every extension out
  // of fileGlobs regardless of language family.
  it('extracts non-TS/JS extensions from fileGlobs (#1654 regression)', () => {
    // Unregistered .rs (no pack registered in this test) — extension is
    // captured but matchAstGrepPattern's `extensionToLang` returns
    // undefined, so the smoke gate gets an empty match list rather than
    // accidentally parsing under TSX. The result is "no false-positive
    // pass via TSX misinterpretation", which is the load-bearing #1654
    // invariant — Rust patterns don't accidentally pass the gate by
    // virtue of TSX accepting JSX-like syntax (e.g., `ResMut<TacticalState>`).
    const rule = makeAstGrepStringRule({
      fileGlobs: ['packages/zomboid-sim/src/**/*.rs'],
      astGrepPattern: 'ResMut<$T>',
    });
    // The historical LC exhibit: `ResMut<TacticalState>` parses under
    // TSX as a JSX tag with attribute, which would let the smoke gate
    // false-pass. Post-#1654, with `.rs` extracted but unregistered,
    // the engine cleanly returns no match — neither false-pass nor
    // false-fail under the wrong grammar.
    const rustSnippet = 'fn handle(state: ResMut<TacticalState>) {}\n';
    const result = runSmokeGate(rule, rustSnippet);
    expect(result.matched).toBe(false);
  });

  it('falls back to TS/JS default set when no fileGlob carries an extension', () => {
    // A glob like `packages/foo/**` has no trailing extension; the
    // post-#1654 regex returns empty, and the fallback default set
    // takes effect so unscoped-style rules keep working.
    const rule = makeAstGrepStringRule({
      fileGlobs: ['packages/foo/**'],
      astGrepPattern: 'console.log($$$)',
    });
    const tsSnippet = 'console.log("hi");\n';
    const result = runSmokeGate(rule, tsSnippet);
    expect(result.matched).toBe(true);
  });
});

// ─── over-matching check (mmnto-ai/totem#1580) ───────

describe('runSmokeGate over-matching check', () => {
  it('reports matched=true when a regex rule fires on a goodExample (the caller then rejects)', () => {
    // Simulates the mmnto-ai/totem#1580 over-matching detection flow:
    // the caller runs the rule against `goodExample` and treats a match
    // as a rejection signal. The gate itself is role-agnostic.
    const rule = makeRegexRule({ pattern: 'console\\.log' });
    const overlyGood = 'console.log("this should not match a good example");\n';
    const result = runSmokeGate(rule, overlyGood);
    expect(result.matched).toBe(true);
    expect(result.matchCount).toBeGreaterThan(0);
  });

  it('reports matched=false when a well-scoped regex rule does not fire on goodExample', () => {
    const rule = makeRegexRule({ pattern: 'console\\.log' });
    const goodExample = 'logger.info("correct usage")\n';
    const result = runSmokeGate(rule, goodExample);
    expect(result.matched).toBe(false);
    expect(result.matchCount).toBe(0);
  });

  it('reports matched=true when an ast-grep rule fires on a goodExample', () => {
    const rule = makeAstGrepStringRule();
    const overlyGood = 'debugger;\nconst x = 1;\n';
    const result = runSmokeGate(rule, overlyGood);
    expect(result.matched).toBe(true);
  });

  it('reports matched=false when an ast-grep rule does not fire on goodExample', () => {
    const rule = makeAstGrepStringRule();
    const goodExample = 'const x = 1;\n';
    const result = runSmokeGate(rule, goodExample);
    expect(result.matched).toBe(false);
  });

  it('treats an empty goodExample as no-op (early return, matched=false)', () => {
    // The smoke gate's caller treats matched=false against goodExample
    // as "over-matching check passed". An empty goodExample short-circuits
    // to matched=false so the check is effectively a no-op rather than
    // crashing the engine on an empty snippet.
    const rule = makeRegexRule();
    const result = runSmokeGate(rule, '');
    expect(result.matched).toBe(false);
    expect(result.matchCount).toBe(0);
  });
});

// ─── Prop 310 § Design 8 — `requires:` pass two ──────

describe('runSmokeGate — Prop 310 § Design 8 requires (mmnto-ai/totem#2678)', () => {
  /** § Design 8's own exemplar, as a hand-built compiled rule. */
  function makeRequiresRegexRule(
    requires: NonNullable<CompiledRule['requires']>,
    overrides: Partial<CompiledRule> = {},
  ): CompiledRule {
    return makeRegexRule({
      lessonHeading: 'git output-consuming commands must pin LC_ALL=C',
      pattern: GIT_TARGET,
      message: 'git output-consuming commands must pin LC_ALL=C on the same line.',
      requires,
      examples: [{ bad: BARE_LOG, good: PINNED_LOG }],
      ...overrides,
    });
  }

  describe('regex engine, scope: line', () => {
    const rule = makeRequiresRegexRule({ pattern: 'LC_ALL=C', scope: 'line' });

    it('FIRES on the bad example — target present, requirement absent', () => {
      const result = runSmokeGate(rule, BARE_LOG);
      expect(result.matched).toBe(true);
      expect(result.matchCount).toBe(1);
    });

    it('stays SILENT on the good example — the defect #2678 fixed', () => {
      // Pre-fix the gate ran pass ONE only, so the good example (which keeps the
      // target and adds the companion) read as over-matching and no
      // `requires:`-bearing record could pass `totem rule test`.
      const result = runSmokeGate(rule, PINNED_LOG);
      expect(result.matched).toBe(false);
      expect(result.matchCount).toBe(0);
      // Silence for the RIGHT reason: "the snippet simply contains nothing the
      // rule fires on", which callers read as good-silent, not as a gate refusal.
      expect(result.reason).toBeUndefined();
    });

    it('counts only the unsatisfied loci in a mixed snippet', () => {
      const result = runSmokeGate(rule, `${BARE_LOG}\n${PINNED_DIFF}`);
      expect(result.matched).toBe(true);
      expect(result.matchCount).toBe(1);
    });
  });

  describe('regex engine, scope: file', () => {
    const fileScoped = makeRequiresRegexRule({ pattern: 'LC_ALL=C', scope: 'file' });
    /** Target on one line, companion on ANOTHER — satisfied at file scope only. */
    const SPLIT_SNIPPET = `export LC_ALL=C\n${BARE_LOG}`;

    it('stays SILENT when the companion sits on a different line', () => {
      const result = runSmokeGate(fileScoped, SPLIT_SNIPPET);
      expect(result.matched).toBe(false);
      expect(result.matchCount).toBe(0);
      expect(result.reason).toBeUndefined();
    });

    it('FIRES when the companion is nowhere in the snippet', () => {
      const result = runSmokeGate(fileScoped, BARE_LOG);
      expect(result.matched).toBe(true);
      expect(result.matchCount).toBe(1);
    });

    it('still FIRES on the same snippet at scope: line — the scope distinction is real', () => {
      const lineScoped = makeRequiresRegexRule({ pattern: 'LC_ALL=C', scope: 'line' });
      const result = runSmokeGate(lineScoped, SPLIT_SNIPPET);
      expect(result.matched).toBe(true);
      expect(result.matchCount).toBe(1);
    });
  });

  describe('ast-grep flat pattern, scope: file', () => {
    const rule = makeAstGrepStringRule({
      requires: { pattern: '// debug-ok', scope: 'file' },
      examples: [{ bad: 'debugger;\n', good: '// debug-ok\ndebugger;\n' }],
    });

    it('FIRES on the bad example', () => {
      const result = runSmokeGate(rule, 'debugger;\n');
      expect(result.matched).toBe(true);
      expect(result.matchCount).toBe(1);
    });

    it('stays SILENT on the good example', () => {
      const result = runSmokeGate(rule, '// debug-ok\ndebugger;\n');
      expect(result.matched).toBe(false);
      expect(result.matchCount).toBe(0);
      expect(result.reason).toBeUndefined();
    });
  });

  describe('ast-grep compound (astGrepYamlRule), scope: file', () => {
    const BAD = 'try {\n  work();\n} catch (err) {\n}\n';
    const GOOD = '// catch is intentionally empty — see the ticket\n' + BAD;
    const rule = makeCompoundRule({
      requires: { pattern: 'intentionally empty', scope: 'file' },
      // `examples` is non-optional for a `requires:` rule: without it the rule is
      // TORN (a § Design 12 home with no discriminator) and the gate's
      // `assertNoTornRecordRules` precondition refuses it, as the runtime does.
      examples: [{ bad: BAD, good: GOOD }],
    });

    it('FIRES on the bad example', () => {
      const result = runSmokeGate(rule, BAD);
      expect(result.matched).toBe(true);
      expect(result.matchCount).toBe(1);
    });

    it('stays SILENT on the good example', () => {
      const result = runSmokeGate(rule, GOOD);
      expect(result.matched).toBe(false);
      expect(result.matchCount).toBe(0);
      expect(result.reason).toBeUndefined();
    });
  });

  describe('the evaluator’s PRECONDITIONS are enforced, never propagated', () => {
    // Each of these is refused by a runtime dispatcher before any
    // `requiresSuppressesMatch` runs. A gate that skipped them would ACCEPT a
    // rule the runtime rejects — the exact divergence this module rules out.
    // All are unreachable from a compiled record (the lowering gates them) and
    // reachable from a hand-built `CompiledRule` or a hand-edited manifest.

    it('assertRequiresPatternsSafe refuses an UNCOMPILABLE pattern (regex engine)', () => {
      // `validateRegex` COMPILES before it runs safe-regex2, so an uncompilable
      // pattern is a precondition failure — reported as `invalid syntax` — and
      // never reaches `requiresContextPresent`'s own throw.
      const rule = makeRequiresRegexRule({ pattern: '(', scope: 'line' });
      const result = runSmokeGate(rule, BARE_LOG);
      expect(result.matched).toBe(false);
      expect(result.matchCount).toBe(0);
      expect(result.reason).toMatch(/requires\.pattern/);
      expect(result.reason).toMatch(/invalid syntax/);
    });

    it('assertRequiresPatternsSafe refuses it on the ast-grep engine too — one handler, both engines', () => {
      const rule = makeAstGrepStringRule({
        requires: { pattern: '(', scope: 'file' },
        examples: [{ bad: 'debugger;\n', good: 'const x = 1;\n' }],
      });
      const result = runSmokeGate(rule, 'debugger;\n');
      expect(result.matched).toBe(false);
      expect(result.matchCount).toBe(0);
      expect(result.reason).toMatch(/requires\.pattern/);
      expect(result.reason).toMatch(/invalid syntax/);
      // NOT mislabelled as an engine throw: the requirement is not ast-grep's.
      expect(result.reason).not.toMatch(/ast-grep runtime error/);
    });

    it('assertRequiresPatternsSafe refuses an UNSAFE-but-compilable pattern instead of backtracking on it', () => {
      // `(a+)+$` compiles fine and is a catastrophic backtracker. Measured before
      // the precondition landed: 86 SECONDS inside `runSmokeGate` on this input,
      // reachable straight from `totem rule test` (`loadRulesOrExit` runs no
      // safe-regex2 pass of its own). This is the safe-regex2 arm of the same
      // check, so the reason names ReDoS rather than a syntax defect.
      const rule = makeRegexRule({
        requires: { pattern: '(a+)+$', scope: 'line' },
        examples: [{ bad: 'console.log(1)', good: 'logger.info(1)' }],
      });
      const snippet = 'console.log(1) ' + 'a'.repeat(34) + '!';

      const startedAt = Date.now();
      const result = runSmokeGate(rule, snippet);
      const elapsedMs = Date.now() - startedAt;

      expect(result.matched).toBe(false);
      expect(result.matchCount).toBe(0);
      expect(result.reason).toMatch(/requires\.pattern/);
      expect(result.reason).toMatch(/ReDoS/);
      // A gate that evaluated this pattern would still be running.
      expect(elapsedMs).toBeLessThan(2000);
    });

    it('assertNoAstGrepLineScope refuses ast-grep + requires.scope: line, as the ast dispatcher does', () => {
      // An ast-grep match is a SPAN; reading it as its start line makes the
      // verdict depend on how the author wrapped their source. The lowering
      // rejects the combination and `assertNoAstGrepLineScope` backstops it at
      // the ast dispatcher — pre-cure this rule PASSED the gate.
      const rule = makeAstGrepStringRule({
        requires: { pattern: '// debug-ok', scope: 'line' },
        examples: [{ bad: 'debugger;\n', good: 'debugger; // debug-ok\n' }],
      });
      const result = runSmokeGate(rule, 'debugger;\n');
      expect(result.matched).toBe(false);
      expect(result.matchCount).toBe(0);
      expect(result.reason).toMatch(/requires\.scope: line/);
    });

    it('assertNoTornRecordRules refuses a TORN rule — `requires` present, `examples` absent', () => {
      // `isRecordPathRule` keys on `examples`, so this rule would read as LEGACY
      // and have its requirement silently unevaluated. § Design 12 bans the
      // silence, not just the unsafe direction.
      const torn = makeRegexRule({ requires: { pattern: 'LC_ALL=C', scope: 'line' } });
      expect(torn.examples).toBeUndefined();
      const result = runSmokeGate(torn, 'console.log(1)');
      expect(result.matched).toBe(false);
      expect(result.matchCount).toBe(0);
      expect(result.reason).toMatch(/examples/);
    });

    it('assertNoTornRecordRules refuses a torn rule carrying NO `requires` — `excludeGlobs` alone', () => {
      // Tornness is not a property of `requires`: the assert fires on ANY of the
      // seven `RECORD_COMPILED_HOME_KEYS` without `examples`, because such a rule
      // is UNCLASSIFIABLE, not because an evaluator needs protecting. With the
      // torn check scoped to `requires` this rule reported `{matched: true}` from
      // the gate while `applyRulesToAdditions` threw on it.
      const torn = makeRegexRule({ fileGlobs: ['**/*.ts'], excludeGlobs: ['**/*.spec.ts'] });
      expect(torn.requires).toBeUndefined();
      expect(torn.examples).toBeUndefined();
      const result = runSmokeGate(torn, 'console.log(1)');
      expect(result.matched).toBe(false);
      expect(result.matchCount).toBe(0);
      expect(result.reason).toMatch(/examples/);
    });
  });

  it('leaves a LEGACY rule untouched — the companion text is not magic', () => {
    // No `requires` block ⇒ pass two never runs, so a snippet carrying the
    // would-be companion still fires exactly as it did before #2678.
    const legacy = makeRegexRule({ pattern: GIT_TARGET });
    expect(legacy.requires).toBeUndefined();
    const result = runSmokeGate(legacy, PINNED_LOG);
    expect(result.matched).toBe(true);
    expect(result.matchCount).toBe(1);
  });

  it('passes § Design 8’s exemplar END-TO-END through the real lowering', () => {
    // The whole point of the ticket: parse → lower → gate, with no hand-built
    // rule anywhere, so the gate is proved against the shape the record path
    // actually emits.
    const parsed = parseRuleRecord(
      yamlStringify(design8ExemplarRecord()),
      '.totem/rules/lc-all-c.rule.yaml',
    );
    const outcome = compileRuleRecord(parsed, {
      ruleId: '0123456789abcdef',
      now: '2026-08-24T00:00:00.000Z',
    });
    if (outcome.kind !== 'compiled') {
      throw new Error(`expected the § Design 8 exemplar to lower, got: ${outcome.reason}`);
    }
    const compiled = outcome.rule;
    expect(compiled.requires).toEqual({ pattern: 'LC_ALL=C', scope: 'line' });

    const pair = compiled.examples?.[0];
    expect(pair).toBeDefined();
    const bad = runSmokeGate(compiled, pair!.bad);
    const good = runSmokeGate(compiled, pair!.good);
    expect(bad.matched).toBe(true);
    expect(good.matched).toBe(false);
    expect(good.reason).toBeUndefined();
  });
});

// ─── runtime-parity invariant ────────────────────────

describe('runSmokeGate runtime parity invariant', () => {
  it('uses the same engine entry points as the runtime — gate-pass implies runtime-match', () => {
    // If runSmokeGate reports matched === true with a non-zero matchCount,
    // matchAstGrepPattern (the runtime entry point) invoked on the same
    // snippet must also produce at least one match. The gate is a thin
    // wrapper around that exact function, so this is a structural
    // guarantee - the test locks in the guarantee against drift.
    const rule = makeAstGrepStringRule();
    const snippet = 'debugger;\nconst x = 1;\n';
    const result = runSmokeGate(rule, snippet);
    expect(result.matched).toBe(true);
    // Reuse the same engine entry point to verify runtime parity.
    const matches = matchAstGrepPattern(
      snippet,
      '.ts',
      'debugger',
      snippet.split('\n').map((_, i) => i + 1),
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  // ── § Design 8 parity, driven through the REAL dispatchers ──
  //
  // The parity claim for `requires:` (mmnto-ai/totem#2678) is that the gate's
  // verdict equals `totem lint`'s. Recomputing the predicate in the test body
  // with `requiresSuppressesMatch` could not establish that: it re-implemented
  // `runRegexGate` and agreed with the gate whether or not the gate agreed with
  // the dispatcher — it passed green while the gate was accepting rules the
  // dispatchers refuse. So these drive all THREE shipped dispatchers themselves
  // and compare COUNTS: `applyRulesToAdditions` (the sync regex one),
  // `applyRulesToAdditionsBounded` (the regex one `totem lint` actually runs —
  // `run-compiled-rules.ts:668` — and a structurally different § Design 8 path,
  // eagerly awaiting whole-file text at `scope: file` rather than resolving it
  // lazily), and `applyAstRulesToAdditions`.
  //
  // All three take an injected reader, so no snippet is ever written to disk:
  // the `scope: file` resolver sees exactly the bytes the gate saw.

  /** One `DiffAddition` per snippet line, as a diff of a wholly-new file produces. */
  function additionsFor(snippet: string, file: string): DiffAddition[] {
    const lines = snippet.split('\n');
    return lines.map((line, i) => ({
      file,
      line,
      lineNumber: i + 1,
      precedingLine: i === 0 ? null : lines[i - 1]!,
    }));
  }

  function engineCtx(): RuleEngineContext {
    return { logger: { warn: () => {} }, state: { hasWarnedShieldContext: false } };
  }

  const SH_FILE = 'tools/lint.sh';
  const MIXED = `${BARE_LOG}\n${PINNED_DIFF}`;
  // `expected` is PINNED, not derived from either side: an agreement of two
  // zeroes would otherwise satisfy the equality without exercising anything.
  // The two scopes disagree on MIXED — at `line` the bare locus still fires,
  // at `file` the companion anywhere in the snippet silences both — so this
  // also pins that the scope distinction survives each dispatcher.
  const REGEX_CASES = [
    { name: 'bad — target only', snippet: BARE_LOG, line: 1, file: 1 },
    { name: 'good — companion on the SAME line', snippet: PINNED_LOG, line: 0, file: 0 },
    { name: 'mixed — one bare locus, one companioned', snippet: MIXED, line: 1, file: 0 },
  ];

  /** The § Design 8 exemplar as a record-path rule scoped to the shell fixture. */
  function parityRegexRule(scope: 'line' | 'file'): CompiledRule {
    return makeRegexRule({
      lessonHeading: 'git output-consuming commands must pin LC_ALL=C',
      pattern: GIT_TARGET,
      requires: { pattern: 'LC_ALL=C', scope },
      fileGlobs: ['**/*.sh'],
      examples: [{ bad: BARE_LOG, good: PINNED_LOG }],
    });
  }

  it('gate matchCount equals the SYNC REGEX dispatcher’s violation count, at both scopes', () => {
    for (const scope of ['line', 'file'] as const) {
      const rule = parityRegexRule(scope);

      for (const c of REGEX_CASES) {
        const where = `${scope} / ${c.name}`;
        const expected = c[scope];
        const gate = runSmokeGate(rule, c.snippet);
        const violations = applyRulesToAdditions(
          engineCtx(),
          [rule],
          additionsFor(c.snippet, SH_FILE),
          undefined,
          process.cwd(),
          // The § Design 8 `scope: file` resolver, fed the snippet instead of a
          // disk read — the same seam `totem lint --staged` uses for the index.
          () => c.snippet,
        );
        expect(gate.matchCount, where).toBe(expected);
        expect(violations.length, where).toBe(expected);
        expect(gate.matched, where).toBe(violations.length > 0);
      }
    }
  });

  it('gate matchCount equals the BOUNDED regex dispatcher’s violation count, at both scopes', async () => {
    // The leg that matters most: `applyRulesToAdditionsBounded` is the dispatcher
    // `totem lint` runs regex rules through (`rule-engine.ts:576-578`,
    // `run-compiled-rules.ts:668`), and it reaches § Design 8 by a structurally
    // different route — an EAGER `await getFileText(file)` at `scope: file`,
    // where the sync dispatcher and the gate both resolve the text lazily. Parity
    // measured only on the sync path would leave the shipping path unmeasured.
    const evaluator = new RegexEvaluator();
    try {
      for (const scope of ['line', 'file'] as const) {
        const rule = parityRegexRule(scope);

        for (const c of REGEX_CASES) {
          const where = `bounded / ${scope} / ${c.name}`;
          const expected = c[scope];
          const gate = runSmokeGate(rule, c.snippet);
          const { violations } = await applyRulesToAdditionsBounded(
            engineCtx(),
            [rule],
            additionsFor(c.snippet, SH_FILE),
            {
              evaluator,
              timeoutMode: 'strict',
              repoRoot: process.cwd(),
              // Same seam as the other two legs — staged mode's
              // `git show :<file>` reader threads in here.
              readStrategy: () => Promise.resolve(c.snippet),
            },
          );
          expect(gate.matchCount, where).toBe(expected);
          expect(violations.length, where).toBe(expected);
          expect(gate.matched, where).toBe(violations.length > 0);
        }
      }
    } finally {
      await evaluator.dispose();
    }
  });

  it('gate matchCount equals the AST-GREP dispatcher’s violation count', async () => {
    const TS_FILE = 'src/fixture.ts';
    const rule = makeAstGrepStringRule({
      requires: { pattern: '// debug-ok', scope: 'file' },
      fileGlobs: ['**/*.ts'],
      examples: [{ bad: 'debugger;\n', good: '// debug-ok\ndebugger;\n' }],
    });
    const cases = [
      { snippet: 'debugger;\n', expected: 1 },
      { snippet: '// debug-ok\ndebugger;\n', expected: 0 },
    ];

    for (const { snippet, expected } of cases) {
      const gate = runSmokeGate(rule, snippet);
      const violations = await applyAstRulesToAdditions(
        engineCtx(),
        [rule],
        additionsFor(snippet, TS_FILE),
        process.cwd(),
        undefined,
        undefined,
        () => Promise.resolve(snippet),
      );
      expect(gate.matchCount, snippet).toBe(expected);
      expect(violations.length, snippet).toBe(expected);
      expect(gate.matched, snippet).toBe(violations.length > 0);
    }
  });
});
