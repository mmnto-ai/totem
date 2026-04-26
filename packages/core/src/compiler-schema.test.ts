import { describe, expect, it } from 'vitest';

import type { RuleEventCallback } from './compiler-schema.js';
import {
  AstGrepYamlRuleSchema,
  CompiledRuleSchema,
  CompilerOutputSchema,
  LEDGER_RETRY_PENDING_CODES,
  NapiConfigSchema,
  NonCompilableEntryReadSchema,
  NonCompilableEntryWriteSchema,
  NonCompilableReasonCodeSchema,
  shouldWriteToLedger,
} from './compiler-schema.js';

// ─── NapiConfigSchema / AstGrepYamlRuleSchema ────────

describe('NapiConfigSchema', () => {
  it('accepts a minimal compound rule with a rule key', () => {
    const parsed = NapiConfigSchema.parse({
      rule: { pattern: 'foo($A)' },
    });
    expect(parsed.rule).toBeDefined();
  });

  it('accepts nested combinators (all / any / inside)', () => {
    const parsed = NapiConfigSchema.parse({
      rule: {
        all: [{ pattern: 'foo($A)' }, { inside: { kind: 'function_declaration' } }],
      },
    });
    expect(parsed.rule).toBeDefined();
  });

  it('rejects an object missing the rule key at parse time', () => {
    expect(() => NapiConfigSchema.parse({ notRule: {} })).toThrow();
  });

  it('is exported as an alias under AstGrepYamlRuleSchema', () => {
    const input = { rule: { pattern: 'foo($A)' } };
    const viaNapi = NapiConfigSchema.parse(input);
    const viaAlias = AstGrepYamlRuleSchema.parse(input);
    expect(viaAlias).toEqual(viaNapi);
  });
});

// ─── CompiledRuleSchema mutual exclusion ─────────────

describe('CompiledRuleSchema mutual exclusion', () => {
  const baseRule = {
    lessonHash: 'abc123def456',
    lessonHeading: 'Test rule',
    pattern: '',
    message: 'Use the right thing',
    engine: 'ast-grep' as const,
    compiledAt: '2026-04-13T12:00:00Z',
  };

  it('accepts ast-grep engine with only astGrepPattern', () => {
    const parsed = CompiledRuleSchema.parse({
      ...baseRule,
      astGrepPattern: 'console.log($A)',
    });
    expect(parsed.astGrepPattern).toBe('console.log($A)');
    expect(parsed.astGrepYamlRule).toBeUndefined();
  });

  it('accepts ast-grep engine with only astGrepYamlRule', () => {
    const parsed = CompiledRuleSchema.parse({
      ...baseRule,
      astGrepYamlRule: { rule: { pattern: 'console.log($A)' } },
    });
    expect(parsed.astGrepYamlRule).toBeDefined();
    expect(parsed.astGrepPattern).toBeUndefined();
  });

  it('CompiledRule rejects ast-grep engine with both pattern and yaml definitions', () => {
    expect(() =>
      CompiledRuleSchema.parse({
        ...baseRule,
        astGrepPattern: 'console.log($A)',
        astGrepYamlRule: { rule: { pattern: 'console.log($A)' } },
      }),
    ).toThrow(/cannot define both astGrepPattern and astGrepYamlRule/);
  });

  it('CompiledRule rejects ast-grep engine with neither pattern nor yaml definitions', () => {
    expect(() => CompiledRuleSchema.parse(baseRule)).toThrow(
      /must define either astGrepPattern or astGrepYamlRule/,
    );
  });

  it('treats empty-string astGrepPattern as "not present" for mutual exclusion', () => {
    // Empty-string pattern + yaml object is the legit compound-rule shape because
    // engineFields writes pattern: '' for ast-grep rules.
    const parsed = CompiledRuleSchema.parse({
      ...baseRule,
      astGrepPattern: '',
      astGrepYamlRule: { rule: { pattern: 'foo' } },
    });
    expect(parsed.astGrepYamlRule).toBeDefined();
  });

  it('accepts regex engine without either ast-grep field', () => {
    const parsed = CompiledRuleSchema.parse({
      ...baseRule,
      engine: 'regex',
      pattern: '\\bfoo\\b',
    });
    expect(parsed.engine).toBe('regex');
  });

  it('accepts ast engine without either ast-grep field', () => {
    const parsed = CompiledRuleSchema.parse({
      ...baseRule,
      engine: 'ast',
      astQuery: '(catch_clause) @c',
    });
    expect(parsed.engine).toBe('ast');
  });
});

// ─── CompilerOutputSchema parallels ──────────────────

describe('CompilerOutputSchema mutual exclusion', () => {
  it('rejects compiler output with both ast-grep fields', () => {
    expect(() =>
      CompilerOutputSchema.parse({
        compilable: true,
        engine: 'ast-grep',
        message: 'msg',
        astGrepPattern: 'foo($A)',
        astGrepYamlRule: { rule: { pattern: 'foo($A)' } },
      }),
    ).toThrow(/cannot define both astGrepPattern and astGrepYamlRule/);
  });

  it('accepts compiler output with only astGrepYamlRule', () => {
    // Post mmnto-ai/totem#1409: every compilable ast-grep output must
    // carry a non-empty badExample, so the happy path here includes one.
    const parsed = CompilerOutputSchema.parse({
      compilable: true,
      engine: 'ast-grep',
      message: 'msg',
      astGrepYamlRule: { rule: { pattern: 'foo($A)' } },
      badExample: 'foo(1)',
      goodExample: 'bar(1)',
    });
    expect(parsed.astGrepYamlRule).toBeDefined();
  });
});

// ─── CompiledRule badExample optional field ──────────

describe('CompiledRule badExample field', () => {
  const baseRule = {
    lessonHash: 'abc123def456',
    lessonHeading: 'Test rule',
    pattern: '\\bfoo\\b',
    message: 'No foo',
    engine: 'regex' as const,
    compiledAt: '2026-04-13T12:00:00Z',
  };

  it('accepts a CompiledRule with badExample set', () => {
    const parsed = CompiledRuleSchema.parse({
      ...baseRule,
      badExample: 'const foo = 1;',
    });
    expect(parsed.badExample).toBe('const foo = 1;');
  });

  it('accepts a CompiledRule without badExample (optional on the persisted shape)', () => {
    // CompiledRule stays optional because Pipeline 1 (manual) rules
    // have not yet been taught to emit badExample — that work is
    // deferred to mmnto-ai/totem#1414. Only CompilerOutput (the LLM
    // gate) flips to required in mmnto-ai/totem#1409.
    const parsed = CompiledRuleSchema.parse(baseRule);
    expect(parsed.badExample).toBeUndefined();
  });
});

// ─── CompiledRule archivedAt field (mmnto-ai/totem#1589) ─────

describe('CompiledRule archivedAt field', () => {
  const baseArchivedRule = {
    lessonHash: 'abc123def456',
    lessonHeading: 'Archived rule',
    pattern: '\\bfoo\\b',
    message: 'No foo',
    engine: 'regex' as const,
    compiledAt: '2026-04-13T12:00:00Z',
    status: 'archived' as const,
    archivedReason: 'Over-matching pattern',
    archivedAt: '2026-04-13T12:05:00Z',
  };

  it('accepts a CompiledRule with archivedAt set', () => {
    const parsed = CompiledRuleSchema.parse(baseArchivedRule);
    expect(parsed.archivedAt).toBe('2026-04-13T12:05:00Z');
  });

  it('preserves archivedAt across a parse → serialize → parse round-trip', () => {
    // The pre-#1589 bug: CompiledRuleBaseSchema had no archivedAt field,
    // so Zod silently stripped it on every round-trip. Every compile-write
    // cycle erased prior archivedAt values from compiled-rules.json,
    // eroding the institutional first-archive-provenance ledger.
    const firstParse = CompiledRuleSchema.parse(baseArchivedRule);
    const serialized: unknown = JSON.parse(JSON.stringify(firstParse));
    const secondParse = CompiledRuleSchema.parse(serialized);
    expect(secondParse.archivedAt).toBe('2026-04-13T12:05:00Z');
    expect(secondParse.archivedReason).toBe('Over-matching pattern');
    expect(secondParse.status).toBe('archived');
  });

  it('accepts an active CompiledRule without archivedAt (optional, absent for active rules)', () => {
    const activeRule = {
      lessonHash: 'abc123def456',
      lessonHeading: 'Active rule',
      pattern: '\\bfoo\\b',
      message: 'No foo',
      engine: 'regex' as const,
      compiledAt: '2026-04-13T12:00:00Z',
    };
    const parsed = CompiledRuleSchema.parse(activeRule);
    expect(parsed.archivedAt).toBeUndefined();
    expect(parsed.status).toBeUndefined();
  });

  it('preserves the full archive tuple (status + archivedReason + archivedAt) together', () => {
    // Pins the invariant that the three archive-related fields survive
    // together so `totem doctor` telemetry and the postmerge ledger have
    // a complete record. Archive scripts set all three via raw JSON
    // mutation; the schema must not strip any of them.
    const parsed = CompiledRuleSchema.parse(baseArchivedRule);
    expect(parsed.status).toBe('archived');
    expect(parsed.archivedReason).toBe('Over-matching pattern');
    expect(parsed.archivedAt).toBe('2026-04-13T12:05:00Z');
  });
});

// ─── CompilerOutput badExample required per engine (mmnto-ai/totem#1409) ──

describe('CompilerOutput badExample required by engine', () => {
  it('accepts a regex CompilerOutput with a non-empty badExample', () => {
    const parsed = CompilerOutputSchema.parse({
      compilable: true,
      pattern: '\\bfoo\\b',
      message: 'No foo',
      engine: 'regex',
      badExample: 'const foo = 1;',
      goodExample: 'const bar = 1;',
    });
    expect(parsed.badExample).toBe('const foo = 1;');
  });

  it('accepts an ast-grep CompilerOutput with a non-empty badExample', () => {
    const parsed = CompilerOutputSchema.parse({
      compilable: true,
      message: 'No console.log',
      engine: 'ast-grep',
      astGrepPattern: 'console.log($A)',
      badExample: 'console.log("debug");',
      goodExample: 'logger.info("debug");',
    });
    expect(parsed.badExample).toBe('console.log("debug");');
  });

  it('rejects a regex CompilerOutput missing badExample', () => {
    const result = CompilerOutputSchema.safeParse({
      compilable: true,
      pattern: '\\bfoo\\b',
      message: 'No foo',
      engine: 'regex',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a regex CompilerOutput with an empty badExample string', () => {
    const result = CompilerOutputSchema.safeParse({
      compilable: true,
      pattern: '\\bfoo\\b',
      message: 'No foo',
      engine: 'regex',
      badExample: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an ast-grep CompilerOutput missing badExample', () => {
    const result = CompilerOutputSchema.safeParse({
      compilable: true,
      message: 'No console.log',
      engine: 'ast-grep',
      astGrepPattern: 'console.log($A)',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an ast-grep compound CompilerOutput missing badExample', () => {
    const result = CompilerOutputSchema.safeParse({
      compilable: true,
      message: 'No const inside for-loop',
      engine: 'ast-grep',
      astGrepYamlRule: {
        rule: {
          pattern: 'const $VAR = $VAL',
          inside: { kind: 'for_statement', stopBy: 'end' },
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts an ast engine CompilerOutput without badExample (exempt engine)', () => {
    // Tree-sitter S-expression rules are not covered by the smoke gate
    // in mmnto-ai/totem#1408, so the schema does not force a badExample
    // on them. The exemption is load-bearing: removing it would reject
    // every ast-engine rule the LLM emits today.
    const parsed = CompilerOutputSchema.parse({
      compilable: true,
      message: 'AST check',
      engine: 'ast',
      astQuery: '(catch_clause) @c',
    });
    expect(parsed.engine).toBe('ast');
    expect(parsed.badExample).toBeUndefined();
  });

  it('accepts a non-compilable CompilerOutput without badExample', () => {
    // When compilable is false, there is no rule to smoke-test, so
    // badExample stays optional. The reason field is what matters.
    const parsed = CompilerOutputSchema.parse({
      compilable: false,
      reason: 'Conceptual architectural principle',
    });
    expect(parsed.compilable).toBe(false);
  });

  it('rejects a CompilerOutput with no engine field but no badExample (defaults to regex)', () => {
    // buildCompiledRule defaults a missing engine to regex, so the
    // schema treats the absent case the same way for gate purposes.
    // This closes the back door where the LLM could omit engine to
    // skip the required badExample.
    const result = CompilerOutputSchema.safeParse({
      compilable: true,
      pattern: '\\bnpm\\b',
      message: 'Use pnpm instead of npm',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a regex CompilerOutput with a whitespace-only badExample', () => {
    // Flagged by CodeRabbit on mmnto-ai/totem#1591: a blank string passes
    // `length > 0` but the smoke gate's early-return on `trim().length === 0`
    // would treat it as a no-op, so the required-field check must use
    // `.trim().length > 0` to close the hole.
    const result = CompilerOutputSchema.safeParse({
      compilable: true,
      pattern: '\\bfoo\\b',
      message: 'No foo',
      engine: 'regex',
      badExample: '   \t\n  ',
      goodExample: 'const bar = 1;',
    });
    expect(result.success).toBe(false);
  });
});

// ─── CompilerOutput goodExample required per engine (mmnto-ai/totem#1580) ──

describe('CompilerOutput goodExample required by engine', () => {
  it('accepts a regex CompilerOutput with a non-empty goodExample', () => {
    const parsed = CompilerOutputSchema.parse({
      compilable: true,
      pattern: '\\bfoo\\b',
      message: 'No foo',
      engine: 'regex',
      badExample: 'const foo = 1;',
      goodExample: 'const bar = 1;',
    });
    expect(parsed.goodExample).toBe('const bar = 1;');
  });

  it('rejects a regex CompilerOutput missing goodExample', () => {
    const result = CompilerOutputSchema.safeParse({
      compilable: true,
      pattern: '\\bfoo\\b',
      message: 'No foo',
      engine: 'regex',
      badExample: 'const foo = 1;',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a regex CompilerOutput with an empty goodExample string', () => {
    const result = CompilerOutputSchema.safeParse({
      compilable: true,
      pattern: '\\bfoo\\b',
      message: 'No foo',
      engine: 'regex',
      badExample: 'const foo = 1;',
      goodExample: '',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a regex CompilerOutput with a whitespace-only goodExample', () => {
    // The case CodeRabbit flagged directly on mmnto-ai/totem#1591: a
    // blank string satisfies `length > 0` but has zero over-matching
    // coverage because the smoke gate treats it as no-op.
    const result = CompilerOutputSchema.safeParse({
      compilable: true,
      pattern: '\\bfoo\\b',
      message: 'No foo',
      engine: 'regex',
      badExample: 'const foo = 1;',
      goodExample: '   \t\n  ',
    });
    expect(result.success).toBe(false);
  });

  it('accepts an ast engine CompilerOutput without goodExample (exempt engine)', () => {
    const parsed = CompilerOutputSchema.parse({
      compilable: true,
      message: 'AST check',
      engine: 'ast',
      astQuery: '(catch_clause) @c',
    });
    expect(parsed.engine).toBe('ast');
    expect(parsed.goodExample).toBeUndefined();
  });

  it('rejects an ast-grep CompilerOutput missing goodExample', () => {
    const result = CompilerOutputSchema.safeParse({
      compilable: true,
      message: 'No console.log',
      engine: 'ast-grep',
      astGrepPattern: 'console.log($A)',
      badExample: 'console.log("debug");',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an ast-grep CompilerOutput with a whitespace-only goodExample', () => {
    const result = CompilerOutputSchema.safeParse({
      compilable: true,
      message: 'No console.log',
      engine: 'ast-grep',
      astGrepPattern: 'console.log($A)',
      badExample: 'console.log("debug");',
      goodExample: '   \n\t ',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an ast-grep compound CompilerOutput missing goodExample', () => {
    const result = CompilerOutputSchema.safeParse({
      compilable: true,
      message: 'No const inside for-loop',
      engine: 'ast-grep',
      astGrepYamlRule: {
        rule: {
          pattern: 'const $VAR = $VAL',
          inside: { kind: 'for_statement', stopBy: 'end' },
        },
      },
      badExample: 'for (let i = 0; i < 10; i++) { const x = 1; }',
    });
    expect(result.success).toBe(false);
  });
});

// ─── RuleEventCallback discriminator (mmnto/totem#1408) ─────

describe('RuleEventCallback discriminator', () => {
  it('accepts the three distinct event variants without conflating them', () => {
    const events: string[] = [];
    const cb: RuleEventCallback = (event, hash, context) => {
      events.push(`${event}:${hash}:${context?.failureReason ?? ''}`);
    };

    cb('trigger', 'h1');
    cb('suppress', 'h2', { file: 'f', line: 1, justification: 'ok' });
    cb('failure', 'h3', { file: 'f', line: 1, failureReason: 'napi panic' });

    expect(events).toEqual(['trigger:h1:', 'suppress:h2:', 'failure:h3:napi panic']);
  });

  it('keeps suppress and failure as separate values per the #1412 postmerge GCA boundary', () => {
    // The two discriminator values are not string-equal and must be handled on
    // distinct code paths. This test locks that in at the type level so a
    // future refactor that collapses them fails here loudly.
    const suppress: 'trigger' | 'suppress' | 'failure' = 'suppress';
    const failure: 'trigger' | 'suppress' | 'failure' = 'failure';
    expect(suppress).not.toBe(failure);
  });
});

// ─── NonCompilableReasonCode 'context-required' (mmnto-ai/totem#1598) ────

describe("NonCompilableReasonCodeSchema 'context-required'", () => {
  it('accepts the context-required reason code', () => {
    expect(() => NonCompilableReasonCodeSchema.parse('context-required')).not.toThrow();
  });

  it('keeps legacy-unknown as the terminal enum value', () => {
    const values = NonCompilableReasonCodeSchema.options;
    expect(values[values.length - 1]).toBe('legacy-unknown');
    expect(values).toContain('context-required');
  });

  it('round-trips a NonCompilable ledger entry carrying context-required', () => {
    const entry = {
      hash: 'a'.repeat(16),
      title: 'sim.tick() must not advance inside _process',
      reasonCode: 'context-required' as const,
      reason: 'Lesson constrains scope to an enclosing function; regex cannot capture the guard.',
    };
    const written = NonCompilableEntryWriteSchema.parse(entry);
    const read = NonCompilableEntryReadSchema.parse(written);
    expect(read).toEqual(entry);
  });
});

describe('CompilerOutputSchema context-required reasonCode', () => {
  it('accepts a non-compilable output with reasonCode context-required', () => {
    const parsed = CompilerOutputSchema.parse({
      compilable: false,
      reasonCode: 'context-required',
      reason:
        'Lesson references an enclosing scope ("inside _process") the pattern cannot express.',
    });
    expect(parsed.compilable).toBe(false);
    expect(parsed.reasonCode).toBe('context-required');
  });

  it('accepts a non-compilable output without a reasonCode (falls back to generic out-of-scope)', () => {
    // Backward compatibility: LLM responses that set compilable:false without
    // a reasonCode continue to route through the existing out-of-scope exit.
    const parsed = CompilerOutputSchema.parse({
      compilable: false,
      reason: 'Conceptual architectural principle.',
    });
    expect(parsed.compilable).toBe(false);
    expect(parsed.reasonCode).toBeUndefined();
  });

  it('rejects compilable output with a reasonCode (reasonCode is for non-compilable exits only)', () => {
    const result = CompilerOutputSchema.safeParse({
      compilable: true,
      pattern: 'foo',
      badExample: 'foo()',
      goodExample: 'bar()',
      reasonCode: 'context-required',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a reasonCode value outside the LLM-emittable vocabulary', () => {
    // Internal codes like verify-retry-exhausted are emitted by core routing,
    // never by the LLM. Locking this in prevents the LLM from bypassing core
    // classification by emitting an internal sentinel.
    const result = CompilerOutputSchema.safeParse({
      compilable: false,
      reasonCode: 'verify-retry-exhausted',
      reason: 'stolen sentinel',
    });
    expect(result.success).toBe(false);
  });
});

// ─── NonCompilableReasonCode 'semantic-analysis-required' (mmnto-ai/totem#1634) ────

describe("NonCompilableReasonCodeSchema 'semantic-analysis-required'", () => {
  it('accepts the semantic-analysis-required reason code', () => {
    expect(() => NonCompilableReasonCodeSchema.parse('semantic-analysis-required')).not.toThrow();
  });

  it('keeps legacy-unknown as the terminal enum value after the #1634 addition', () => {
    const values = NonCompilableReasonCodeSchema.options;
    expect(values[values.length - 1]).toBe('legacy-unknown');
    expect(values).toContain('semantic-analysis-required');
  });

  it('round-trips a NonCompilable ledger entry carrying semantic-analysis-required', () => {
    const entry = {
      hash: 'b'.repeat(16),
      title: 'Parallel float reductions break lockstep determinism',
      reasonCode: 'semantic-analysis-required' as const,
      reason:
        'Closure-body AST analysis required to detect captured-float assignment inside par_iter_mut().for_each.',
    };
    const written = NonCompilableEntryWriteSchema.parse(entry);
    const read = NonCompilableEntryReadSchema.parse(written);
    expect(read).toEqual(entry);
  });
});

describe('CompilerOutputSchema semantic-analysis-required reasonCode', () => {
  it('accepts a non-compilable output with reasonCode semantic-analysis-required', () => {
    const parsed = CompilerOutputSchema.parse({
      compilable: false,
      reasonCode: 'semantic-analysis-required',
      reason: 'Hazard requires walking the SystemParam tuple; pattern cannot see other params.',
    });
    expect(parsed.compilable).toBe(false);
    expect(parsed.reasonCode).toBe('semantic-analysis-required');
  });

  it('still accepts context-required (existing #1598 value stays in the narrow enum)', () => {
    const parsed = CompilerOutputSchema.parse({
      compilable: false,
      reasonCode: 'context-required',
      reason: 'Enclosing-function guard.',
    });
    expect(parsed.reasonCode).toBe('context-required');
  });
});

// ─── LEDGER_RETRY_PENDING_CODES + shouldWriteToLedger (mmnto-ai/totem#1627) ───

describe('LEDGER_RETRY_PENDING_CODES', () => {
  it('is a strict subset of NonCompilableReasonCodeSchema.options', () => {
    // Locks in that every retry-pending code is a legitimate enum member.
    // A typo like 'patern-syntax-invalid' would fail here before it ships.
    const enumValues = new Set<string>(NonCompilableReasonCodeSchema.options);
    for (const code of LEDGER_RETRY_PENDING_CODES) {
      expect(enumValues.has(code)).toBe(true);
    }
  });

  it('does not include legacy-unknown (legacy is a migration sentinel, not retry-eligible)', () => {
    expect(LEDGER_RETRY_PENDING_CODES.has('legacy-unknown')).toBe(false);
  });

  it('does not include terminal classifier codes (out-of-scope, context-required, semantic-analysis-required, self-suppressing-pattern)', () => {
    // These describe structural incapacity — the rule will never compile
    // cleanly no matter how many retries. They are permanent ledger entries.
    expect(LEDGER_RETRY_PENDING_CODES.has('out-of-scope')).toBe(false);
    expect(LEDGER_RETRY_PENDING_CODES.has('context-required')).toBe(false);
    expect(LEDGER_RETRY_PENDING_CODES.has('semantic-analysis-required')).toBe(false);
    expect(LEDGER_RETRY_PENDING_CODES.has('security-rule-rejected')).toBe(false);
    // mmnto-ai/totem#1664: self-suppression is structural (the pattern would
    // match totem-ignore / totem-context tokens at runtime). Retrying compile
    // produces the same self-suppressing pattern, so it is terminal.
    expect(LEDGER_RETRY_PENDING_CODES.has('self-suppressing-pattern')).toBe(false);
  });

  it('includes every known smoke-gate + LLM-output transient failure code', () => {
    // Explicit whitelist so a future refactor that narrows the set fails
    // here loudly rather than silently re-introducing ledger pollution.
    expect(LEDGER_RETRY_PENDING_CODES.has('pattern-syntax-invalid')).toBe(true);
    expect(LEDGER_RETRY_PENDING_CODES.has('pattern-zero-match')).toBe(true);
    expect(LEDGER_RETRY_PENDING_CODES.has('verify-retry-exhausted')).toBe(true);
    expect(LEDGER_RETRY_PENDING_CODES.has('missing-badexample')).toBe(true);
    expect(LEDGER_RETRY_PENDING_CODES.has('missing-goodexample')).toBe(true);
    expect(LEDGER_RETRY_PENDING_CODES.has('matches-good-example')).toBe(true);
  });
});

describe('shouldWriteToLedger', () => {
  it('writes permanent classifier codes to the ledger', () => {
    expect(shouldWriteToLedger('out-of-scope')).toBe(true);
    expect(shouldWriteToLedger('context-required')).toBe(true);
    expect(shouldWriteToLedger('semantic-analysis-required')).toBe(true);
    expect(shouldWriteToLedger('security-rule-rejected')).toBe(true);
    expect(shouldWriteToLedger('no-pattern-found')).toBe(true);
    expect(shouldWriteToLedger('no-pattern-generated')).toBe(true);
    expect(shouldWriteToLedger('legacy-unknown')).toBe(true);
    // mmnto-ai/totem#1664: self-suppressing-pattern is terminal (structural,
    // not transient) — the audit trail in nonCompilable lets bot reviewers
    // cite a stable reasonCode instead of synthesizing "missing from manifest".
    expect(shouldWriteToLedger('self-suppressing-pattern')).toBe(true);
  });

  it('suppresses retry-pending smoke-gate and LLM-output failures from the ledger', () => {
    // mmnto-ai/totem#1627: writing these to nonCompilable marks retriable
    // transient failures as permanent, blocking future re-compile cycles
    // from ever producing a rule once the prompt improves.
    expect(shouldWriteToLedger('pattern-syntax-invalid')).toBe(false);
    expect(shouldWriteToLedger('pattern-zero-match')).toBe(false);
    expect(shouldWriteToLedger('verify-retry-exhausted')).toBe(false);
    expect(shouldWriteToLedger('missing-badexample')).toBe(false);
    expect(shouldWriteToLedger('missing-goodexample')).toBe(false);
    expect(shouldWriteToLedger('matches-good-example')).toBe(false);
  });
});
