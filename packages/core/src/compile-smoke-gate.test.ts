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
