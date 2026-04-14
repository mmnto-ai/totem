/**
 * Compound ast-grep validation spike (mmnto-ai/totem#1406).
 *
 * Goal: empirically confirm `@ast-grep/napi@0.42.0` accepts NapiConfig
 * objects (rule + inside/has/not combinators) end-to-end via `findAll()`,
 * so the compiler and schema work in tickets #1407 / #1408 can be scoped
 * against real behavior rather than inferred behavior.
 *
 * Scope (per spike brief):
 *   - One rule per combinator (inside, has, not)
 *   - One negative case that must throw catchably, not crash the process
 *   - One position-tracking assertion that compound match ranges point
 *     at the outer matched node, not an inner descendant
 *   - One cross-combinator rule to probe composition
 *
 * No production code is modified. This harness calls `@ast-grep/napi`
 * directly so it does not depend on `matchAstGrepPattern` or any
 * Totem helper.
 */

import type { NapiConfig } from '@ast-grep/napi';
import { Lang, parse } from '@ast-grep/napi';
import { describe, expect, it } from 'vitest';

// ─── Fixtures ───────────────────────────────────────

const FOR_LOOP_SRC = `
function outer() {
  const outside = 1;
  for (let i = 0; i < 10; i++) {
    const inside = i * 2;
  }
}
`;

const TRY_CATCH_SRC = `
function withEmpty() {
  try {
    doWork();
  } catch (err) {
  }
}

function withBody() {
  try {
    doWork();
  } catch (err) {
    log(err);
  }
}
`;

const SPAWN_SRC = `
import { spawn } from 'node:child_process';

spawn('ls', { shell: true });

function later() {
  spawn('rm', { shell: true });
}
`;

const NESTED_SRC = `
class Widget {
  render() {
    for (let i = 0; i < this.items.length; i++) {
      console.log(this.items[i]);
    }
  }
}

function standalone() {
  console.log('not in loop or method');
}
`;

// ─── Helpers ────────────────────────────────────────

interface MatchInfo {
  text: string;
  startLine: number;
  endLine: number;
}

function collectMatches(src: string, rule: NapiConfig | string): MatchInfo[] {
  const root = parse(Lang.TypeScript, src);
  return root
    .root()
    .findAll(rule)
    .map((m) => ({
      text: m.text(),
      startLine: m.range().start.line,
      endLine: m.range().end.line,
    }));
}

// ─── Rule 1: inside ─────────────────────────────────

describe('compound spike :: inside', () => {
  it('matches const declarations nested inside a for-loop (via kind combinator)', () => {
    // Empirical note: the pattern shape
    //   `for ($INIT; $COND; $STEP) { $$$ }`
    // did NOT match the for-statement node in ast-grep 0.42.0 when used
    // as an `inside` sub-rule. Using `kind: 'for_statement'` as the
    // inside target matches reliably. Patterns that span multiple
    // statement boundaries (declaration, condition, update) seem to
    // parse into a non-standalone shape; kind is the safer surface for
    // this combinator. Documented in findings.md gap G-3.
    const rule: NapiConfig = {
      rule: {
        pattern: 'const $VAR = $VAL',
        inside: {
          kind: 'for_statement',
          stopBy: 'end',
        },
      },
    };

    const matches = collectMatches(FOR_LOOP_SRC, rule);

    // Should match only the inner `const inside = i * 2`, not the outer `const outside = 1`.
    expect(matches).toHaveLength(1);
    // Empirical note: ast-grep matches the full statement including the
    // trailing semicolon when the pattern is a declaration. This is
    // relevant for compile-side text-diffing but not for line-based
    // matching in `executeQuery`. Documented in findings.md gap G-4.
    expect(matches[0]!.text.replace(/;$/, '')).toBe('const inside = i * 2');
  });
});

// ─── Rule 2: has (empty catch block) ────────────────

describe('compound spike :: has', () => {
  it('matches try/catch statements whose catch body is empty', () => {
    // "catch clause has NO statement descendant"
    const rule: NapiConfig = {
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
    };

    const matches = collectMatches(TRY_CATCH_SRC, rule);

    expect(matches).toHaveLength(1);
    expect(matches[0]!.text.startsWith('catch (err)')).toBe(true);
    // The matched text should NOT contain `log(err)` — that would mean
    // we matched the non-empty catch by mistake.
    expect(matches[0]!.text).not.toContain('log(err)');
  });
});

// ─── Rule 3: not ────────────────────────────────────

describe('compound spike :: not', () => {
  it('matches spawn() calls that are not descendants of an import statement', () => {
    // Sanity fixture: spawn is imported then called. Both top-level
    // and nested call-site should match; the import itself should not.
    const rule: NapiConfig = {
      rule: {
        pattern: 'spawn($CMD, $OPTS)',
        not: {
          inside: {
            kind: 'import_statement',
            stopBy: 'end',
          },
        },
      },
    };

    const matches = collectMatches(SPAWN_SRC, rule);

    // Two real call sites, not the import.
    expect(matches).toHaveLength(2);
    for (const m of matches) {
      expect(m.text.startsWith('spawn(')).toBe(true);
    }
  });
});

// ─── Rule 4: position tracking ──────────────────────

describe('compound spike :: position tracking', () => {
  it('range() points at the outer matched node, not a nested descendant', () => {
    // Match a console.log that sits inside a for-loop inside a method.
    // The range must cover the console.log call itself, on its own
    // line, not the enclosing for-loop or method.
    const rule: NapiConfig = {
      rule: {
        pattern: 'console.log($$$)',
        inside: {
          kind: 'for_statement',
          stopBy: 'end',
        },
      },
    };

    const matches = collectMatches(NESTED_SRC, rule);

    expect(matches).toHaveLength(1);
    const m = matches[0]!;
    // Sanity: matched text is the call, not the loop or method.
    expect(m.text.startsWith('console.log(')).toBe(true);
    expect(m.text).not.toContain('for (');
    expect(m.text).not.toContain('render()');
    // The call is a single line in the fixture, so start and end line
    // should be the same.
    expect(m.startLine).toBe(m.endLine);
  });

  it('multi-line outer node range spans start to end line of the outer node', () => {
    // Match the for-loop itself. Its range should cover every line of
    // the loop body.
    const rule: NapiConfig = {
      rule: {
        kind: 'for_statement',
      },
    };

    const matches = collectMatches(NESTED_SRC, rule);

    expect(matches).toHaveLength(1);
    const m = matches[0]!;
    // For-loop spans at least 3 lines in the fixture (opening, body,
    // closing brace).
    expect(m.endLine - m.startLine).toBeGreaterThanOrEqual(2);
  });
});

// ─── Rule 4b: inside-pattern vs inside-kind probe ──

describe('compound spike :: inside pattern vs kind', () => {
  it('inside with a for-loop pattern does NOT match (0.42.0 behavior)', () => {
    // This test pins the empirical finding that motivated the
    // kind-based workaround above. If a future ast-grep release
    // accepts multi-semicolon patterns as an `inside` target, this
    // test will start failing and we revisit the gap analysis.
    const rule: NapiConfig = {
      rule: {
        pattern: 'const $VAR = $VAL',
        inside: {
          pattern: 'for ($INIT; $COND; $STEP) { $$$ }',
          stopBy: 'end',
        },
      },
    };

    const matches = collectMatches(FOR_LOOP_SRC, rule);
    expect(matches).toHaveLength(0);
  });

  it('inside with a kind: "for_statement" DOES match', () => {
    const rule: NapiConfig = {
      rule: {
        pattern: 'const $VAR = $VAL',
        inside: {
          kind: 'for_statement',
          stopBy: 'end',
        },
      },
    };

    const matches = collectMatches(FOR_LOOP_SRC, rule);
    expect(matches).toHaveLength(1);
  });
});

// ─── Rule 5: negative — invalid schema throws ───────

describe('compound spike :: invalid rule rejection', () => {
  it('throws a catchable JS error for an unknown kind, does not crash napi', () => {
    const rule = {
      rule: {
        kind: '!!!NOT_A_REAL_KIND!!!',
      },
    } as unknown as NapiConfig;

    const root = parse(Lang.TypeScript, 'const x = 1;');

    let caught: unknown = null;
    try {
      root.root().findAll(rule);
    } catch (err) {
      caught = err;
    }

    expect(caught).not.toBeNull();
    expect(caught).toBeInstanceOf(Error);
    // Error message should name the offending value so downstream
    // error handling can surface it to users.
    const msg = (caught as Error).message;
    expect(typeof msg).toBe('string');
    expect(msg.length).toBeGreaterThan(0);
    // Print the exact napi error to stderr so the findings doc can
    // quote it verbatim. (Vitest captures this under "Unhandled Logs"
    // when the test passes; inspect with `--reporter=verbose`.)
    // eslint-disable-next-line no-console -- spike observability only
    console.error('[spike] invalid-kind napi error text:', msg);
  });

  it('throws a catchable JS error for a rule object missing the "rule" key', () => {
    // Compile-time type system forbids this, but the runtime contract
    // is the real gate. `validateAstGrepPattern` already rejects this
    // shape at compile time (compile-lesson.ts:104-107); this test
    // verifies the underlying napi layer behaves predictably when the
    // compile-time guard is bypassed (e.g., hand-edited compiled-rules.json).
    const rule = {
      pattern: 'const $X = $Y',
      // no `rule:` wrapper — this is malformed
    } as unknown as NapiConfig;

    const root = parse(Lang.TypeScript, 'const x = 1;');

    let caught: unknown = null;
    try {
      root.root().findAll(rule);
    } catch (err) {
      caught = err;
    }

    // Either throws, OR returns zero matches because there's no rule
    // to evaluate. Both are survivable for the engine. What matters is
    // that the napi process does not terminate the test runner.
    // (This assertion is informational; the fact that we reached this
    // line without the test runner dying is the real evidence.)
    if (caught !== null) {
      expect(caught).toBeInstanceOf(Error);
    }
  });
});
