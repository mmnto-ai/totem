import { describe, expect, it } from 'vitest';

import type { AuthoredFixture, CompiledRule } from '../compiler-schema.js';
import { evaluatePreimageDifferential } from './preimage-differential.js';

// ─── Rule helpers (mirror compile-smoke-gate.test.ts) ─

function regexRule(overrides: Partial<CompiledRule> = {}): CompiledRule {
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

function astGrepRule(overrides: Partial<CompiledRule> = {}): CompiledRule {
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

function emptyCatchRule(overrides: Partial<CompiledRule> = {}): CompiledRule {
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

// ─── Fixture helpers ────────────────────────────────

function lessonFixture(badExample: string, goodExample: string): AuthoredFixture {
  return {
    pr: 130,
    preimageSource: { kind: 'lesson', lessonRef: 'deadbeefdeadbeef', badExample, goodExample },
    filePath: 'src/sim/level.rs',
    matchedSpan: 'L10-L12',
    contentHash: 'abc123def456',
  };
}

function commitFixture(): AuthoredFixture {
  return {
    pr: 130,
    preimageSource: {
      kind: 'commit',
      preimageCommitSha: 'a'.repeat(40),
      mergeCommitSha: 'b'.repeat(40),
    },
    filePath: 'src/sim/level.rs',
    matchedSpan: 'L10-L12',
    contentHash: 'abc123def456',
  };
}

// ─── differential-holds (the legitimate control) ─────

describe('evaluatePreimageDifferential — differential-holds', () => {
  it('regex: fires on the preimage and is silent on the postimage', async () => {
    const result = await evaluatePreimageDifferential(
      regexRule(),
      lessonFixture('console.log("debug")', 'logger.info("ok")'),
    );
    expect(result.outcome).toBe('differential-holds');
    // Non-vacuity: BOTH legs must hold. If the classifier checked only
    // firesOnPreimage, the over-match case below would also read as "holds".
    expect(result.firesOnPreimage).toBe(true);
    expect(result.silentOnPostimage).toBe(true);
    expect(result.preimageMatchCount).toBeGreaterThanOrEqual(1);
    expect(result.postimageMatchCount).toBe(0);
    expect(result.sourceKind).toBe('lesson');
  });

  it('ast-grep: fires on the preimage and is silent on the postimage (TS exemplar)', async () => {
    const result = await evaluatePreimageDifferential(
      astGrepRule(),
      lessonFixture('debugger;\n', 'const x = 1;\n'),
    );
    expect(result.outcome).toBe('differential-holds');
    expect(result.firesOnPreimage).toBe(true);
    expect(result.silentOnPostimage).toBe(true);
    expect(result.preimageMatchCount).toBeGreaterThanOrEqual(1);
  });

  it('ast-grep compound (multi-line exemplar): fires on empty catch, silent on a catch with a body', async () => {
    // Locks multi-line exemplar faithfulness — the differential must survive a
    // real multi-line snippet, not just a single token.
    const result = await evaluatePreimageDifferential(
      emptyCatchRule(),
      lessonFixture(
        'try {\n  work();\n} catch (err) {\n}\n',
        'try {\n  work();\n} catch (err) {\n  log(err);\n}\n',
      ),
    );
    expect(result.outcome).toBe('differential-holds');
    expect(result.firesOnPreimage).toBe(true);
    expect(result.silentOnPostimage).toBe(true);
  });
});

// ─── fix-shaped (the literal Falsifying Metric §1(i)) ─

describe('evaluatePreimageDifferential — fix-shaped is never a charitable pass (FM §1(i))', () => {
  it('regex: a matcher that fires on the FIXED form and is silent on the defect is fix-shaped', async () => {
    // pattern matches the GOOD form (logger.info), not the defect (console.log).
    const result = await evaluatePreimageDifferential(
      regexRule({ pattern: 'logger\\.info' }),
      lessonFixture('console.log("bad")', 'logger.info("fixed")'),
    );
    expect(result.outcome).toBe('fix-shaped');
    expect(result.outcome).not.toBe('differential-holds');
    // Non-vacuity: the classification must rest on BOTH legs being wrong, not
    // just one. fix-shaped (here) and vacuous-silent (below) share
    // firesOnPreimage=false but differ on silentOnPostimage — so the silent leg
    // is load-bearing.
    expect(result.firesOnPreimage).toBe(false);
    expect(result.silentOnPostimage).toBe(false);
  });

  it('ast-grep: silent on the defect, fires on the fixed form → fix-shaped', async () => {
    const result = await evaluatePreimageDifferential(
      astGrepRule(),
      lessonFixture('const x = 1;\n', 'debugger;\n'),
    );
    expect(result.outcome).toBe('fix-shaped');
    expect(result.firesOnPreimage).toBe(false);
    expect(result.silentOnPostimage).toBe(false);
  });
});

// ─── over-match (the scorer-invisible escape, contract §4/§5.3) ─

describe('evaluatePreimageDifferential — over-match is surfaced (the silent-on-postimage leg)', () => {
  it('regex: a matcher that fires on BOTH the defect and the fixed form is over-match, not holds', async () => {
    const result = await evaluatePreimageDifferential(
      regexRule(),
      lessonFixture('console.log("bad")', 'console.log("still here in the fix")'),
    );
    expect(result.outcome).toBe('over-match');
    // The cert-critical assertion: this MUST NOT read as differential-holds.
    expect(result.outcome).not.toBe('differential-holds');
    expect(result.firesOnPreimage).toBe(true);
    // Non-vacuity: if the code ignored the postimage, silentOnPostimage would be
    // true and this would be misclassified as holds — the escape the scorer
    // cannot catch on a synthetic exemplar.
    expect(result.silentOnPostimage).toBe(false);
    expect(result.postimageMatchCount).toBeGreaterThanOrEqual(1);
  });

  it('ast-grep: fires on both sides → over-match', async () => {
    const result = await evaluatePreimageDifferential(
      astGrepRule(),
      lessonFixture('debugger;\n', 'debugger;\nconst x = 1;\n'),
    );
    expect(result.outcome).toBe('over-match');
    expect(result.silentOnPostimage).toBe(false);
  });
});

// ─── vacuous-silent (fires on neither) ──────────────

describe('evaluatePreimageDifferential — vacuous-silent (fires on neither)', () => {
  it('regex: a matcher silent on both sides catches nothing', async () => {
    const result = await evaluatePreimageDifferential(
      regexRule(),
      lessonFixture('const x = 1;', 'const y = 2;'),
    );
    expect(result.outcome).toBe('vacuous-silent');
    expect(result.firesOnPreimage).toBe(false);
    expect(result.silentOnPostimage).toBe(true);
    // Contrast with fix-shaped (same firesOnPreimage=false): proves the silent
    // leg distinguishes the two and is not ignored.
  });
});

// ─── needs-adjudication (engine refusal, fail-loud) ──

describe('evaluatePreimageDifferential — needs-adjudication on engine refusal', () => {
  it('invalid regex pattern → needs-adjudication with a reason, not a silent clean result', async () => {
    const result = await evaluatePreimageDifferential(
      regexRule({ pattern: '(unclosed' }),
      lessonFixture('console.log("x")', 'logger.info("ok")'),
    );
    expect(result.outcome).toBe('needs-adjudication');
    expect(result.reason).toBeDefined();
    expect(result.reason).toContain('invalid');
    // The preimage leg could not be evaluated → null, not a false "silent".
    expect(result.firesOnPreimage).toBeNull();
  });

  it('ast-grep rule that throws at runtime (invalid kind) → needs-adjudication', async () => {
    const result = await evaluatePreimageDifferential(
      emptyCatchRule({ astGrepYamlRule: { rule: { kind: '!!!INVALID_KIND!!!' } } }),
      lessonFixture('try {\n} catch (e) {\n}\n', 'const x = 1;\n'),
    );
    expect(result.outcome).toBe('needs-adjudication');
    expect(result.reason).toBeDefined();
  });

  it('an engine the smoke gate does not cover (tree-sitter ast) → needs-adjudication', async () => {
    const result = await evaluatePreimageDifferential(
      regexRule({ engine: 'ast', pattern: '' }),
      lessonFixture('whatever', 'something else'),
    );
    expect(result.outcome).toBe('needs-adjudication');
    expect(result.reason).toBeDefined();
  });

  it('a whitespace-only badExample → needs-adjudication, not a silent vacuous result', async () => {
    // Direct (unparsed) construction can bypass the schema's non-empty refine; a
    // whitespace preimage carries no evaluable code, so the preimage leg is null.
    const result = await evaluatePreimageDifferential(
      regexRule(),
      lessonFixture('   \n  ', 'logger.info("ok")'),
    );
    expect(result.outcome).toBe('needs-adjudication');
    expect(result.firesOnPreimage).toBeNull();
    expect(result.reason).toContain('badExample');
  });

  it('a whitespace-only goodExample → needs-adjudication, NOT a false differential-holds (Greptile #2264)', async () => {
    // The cert-critical case: the rule fires on the defect, and the postimage is
    // whitespace. Pre-fix this read as differential-holds (silentOnPostimage true
    // because there was nothing to match) — masking an unevaluable fixed side.
    const result = await evaluatePreimageDifferential(
      regexRule(),
      lessonFixture('console.log("bad")', '   \n  '),
    );
    expect(result.outcome).toBe('needs-adjudication');
    expect(result.outcome).not.toBe('differential-holds');
    expect(result.silentOnPostimage).toBeNull();
    expect(result.reason).toContain('goodExample');
  });
});

// ─── commit-source deferral (typed non-pass, slice C2) ─

describe('evaluatePreimageDifferential — commit source is a typed deferral (slice C2)', () => {
  it('commit-pair fixture → unsupported-source, never a passing control', async () => {
    const result = await evaluatePreimageDifferential(astGrepRule(), commitFixture());
    expect(result.outcome).toBe('unsupported-source');
    expect(result.outcome).not.toBe('differential-holds');
    expect(result.sourceKind).toBe('commit');
    expect(result.firesOnPreimage).toBeNull();
    expect(result.silentOnPostimage).toBeNull();
    expect(result.reason).toContain('slice C2');
  });
});

// ─── determinism (Tenet-15) ─────────────────────────

describe('evaluatePreimageDifferential — determinism', () => {
  it('is a pure function of (rule, fixture): identical inputs yield identical results', async () => {
    const rule = astGrepRule();
    const fixture = lessonFixture('debugger;\n', 'const x = 1;\n');
    const a = await evaluatePreimageDifferential(rule, fixture);
    const b = await evaluatePreimageDifferential(rule, fixture);
    expect(a).toEqual(b);
  });
});
