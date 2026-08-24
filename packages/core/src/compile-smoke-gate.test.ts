import { describe, expect, it } from 'vitest';
import { stringify as yamlStringify } from 'yaml';

import { matchAstGrepPattern } from './ast-grep-query.js';
import { runSmokeGate } from './compile-smoke-gate.js';
import type { CompiledRule } from './compiler-schema.js';
import { design8ExemplarRecord } from './spine/record-exemplars.fixture.js';
import { compileRuleRecord } from './spine/record-lower.js';
import { requiresSuppressesMatch } from './spine/record-runtime.js';
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
 * Each is inert fixture TEXT handed to `runSmokeGate` as rule INPUT — this suite
 * runs no git command at all — so the shipped git-hygiene rules that fire on the
 * bare forms are overridden at these three definitions rather than at every
 * assertion that uses them.
 */
// totem-context: inert rule-input fixture, never a git invocation (mmnto-ai/totem#2678)
const BARE_LOG = 'git log --oneline';
// totem-context: inert rule-input fixture, never a git invocation (mmnto-ai/totem#2678)
const PINNED_DIFF = 'LC_ALL=C git diff HEAD';
// totem-context: inert rule-input fixture, never a git invocation (mmnto-ai/totem#2678)
const BARE_STATUS = 'git status';
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
    const rule = makeCompoundRule({
      requires: { pattern: 'intentionally empty', scope: 'file' },
    });
    const BAD = 'try {\n  work();\n} catch (err) {\n}\n';
    const GOOD = '// catch is intentionally empty — see the ticket\n' + BAD;

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

  describe('an unusable requires.pattern is reported, never propagated', () => {
    // Unreachable from a compiled record — the lowering runs the same
    // safe-regex2 gate — but reachable from a hand-built `CompiledRule`.

    it('reports it on the regex engine', () => {
      const rule = makeRequiresRegexRule({ pattern: '(', scope: 'line' });
      const result = runSmokeGate(rule, BARE_LOG);
      expect(result.matched).toBe(false);
      expect(result.matchCount).toBe(0);
      expect(result.reason).toMatch(/requires\.pattern/);
    });

    it('reports it on the ast-grep engine too — one handler, both engines', () => {
      const rule = makeAstGrepStringRule({ requires: { pattern: '(', scope: 'file' } });
      const result = runSmokeGate(rule, 'debugger;\n');
      expect(result.matched).toBe(false);
      expect(result.matchCount).toBe(0);
      expect(result.reason).toMatch(/requires\.pattern/);
      // NOT mislabelled as an engine throw: the requirement is not ast-grep's.
      expect(result.reason).not.toMatch(/ast-grep runtime error/);
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

  it('uses the runtime’s OWN § Design 8 evaluator — gate verdict equals the runtime predicate', () => {
    // The parity claim for `requires:` (mmnto-ai/totem#2678): the gate does not
    // reimplement pass two, it calls `requiresSuppressesMatch` — the same
    // function `rule-engine.ts` and `regex-safety/apply-rules-bounded.ts` call.
    // Recomputing the predicate here line-by-line with that function must
    // reproduce the gate's verdict exactly, count included.
    const rule = makeRegexRule({
      pattern: GIT_TARGET,
      requires: { pattern: 'LC_ALL=C', scope: 'line' },
      examples: [{ bad: BARE_LOG, good: PINNED_LOG }],
    });
    const snippet = `${BARE_LOG}\n${PINNED_DIFF}\nconst x = 1;\n${BARE_STATUS}\n`;

    const result = runSmokeGate(rule, snippet);

    const re = new RegExp(rule.pattern);
    const runtimeHits = snippet
      .split('\n')
      .filter(
        (line) => re.test(line) && !requiresSuppressesMatch(rule, { line, file: () => snippet }),
      );

    expect(result.matched).toBe(runtimeHits.length > 0);
    expect(result.matchCount).toBe(runtimeHits.length);
    // Pinned, so a change that made BOTH sides wrong the same way is still caught.
    expect(runtimeHits).toEqual([BARE_LOG, BARE_STATUS]);
  });
});
