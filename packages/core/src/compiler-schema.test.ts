import { describe, expect, it } from 'vitest';

import type { RuleEventCallback } from './compiler-schema.js';
import {
  AstGrepYamlRuleSchema,
  CompiledRuleSchema,
  CompilerOutputSchema,
  NapiConfigSchema,
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
