import { describe, expect, it } from 'vitest';

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
    const parsed = CompilerOutputSchema.parse({
      compilable: true,
      engine: 'ast-grep',
      message: 'msg',
      astGrepYamlRule: { rule: { pattern: 'foo($A)' } },
    });
    expect(parsed.astGrepYamlRule).toBeDefined();
  });
});

// ─── badExample optional field ───────────────────────

describe('badExample optional field', () => {
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

  it('accepts a CompiledRule without badExample (optional)', () => {
    const parsed = CompiledRuleSchema.parse(baseRule);
    expect(parsed.badExample).toBeUndefined();
  });

  it('accepts CompilerOutput with badExample set', () => {
    const parsed = CompilerOutputSchema.parse({
      compilable: true,
      pattern: '\\bfoo\\b',
      message: 'No foo',
      engine: 'regex',
      badExample: 'const foo = 1;',
    });
    expect(parsed.badExample).toBe('const foo = 1;');
  });
});
