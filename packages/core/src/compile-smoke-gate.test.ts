import { describe, expect, it } from 'vitest';

import { matchAstGrepPattern } from './ast-grep-query.js';
import { runSmokeGate } from './compile-smoke-gate.js';
import type { CompiledRule } from './compiler-schema.js';

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
});
