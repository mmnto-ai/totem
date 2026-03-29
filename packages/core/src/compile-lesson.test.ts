import { describe, expect, it, vi } from 'vitest';

import {
  buildCompiledRule,
  buildManualRule,
  compileLesson,
  type CompileLessonDeps,
  type LessonInput,
  validateAstGrepPattern,
  verifyRuleExamples,
} from './compile-lesson.js';
import type { CompiledRule, CompilerOutput } from './compiler-schema.js';

// ─── Helpers ────────────────────────────────────────

const lesson: LessonInput = {
  index: 0,
  heading: 'Use err not error in catch blocks',
  body: 'Always use `err` as the variable name in catch blocks.',
  hash: 'abc123',
};

const manualLesson: LessonInput = {
  index: 1,
  heading: 'No console.log in production',
  body: '**Pattern:** `console\\.log`\n**Engine:** regex\n**Severity:** warning\n**Scope:** **/*.ts',
  hash: 'manual456',
};

const existingByHash = new Map<string, CompiledRule>();

// ─── buildCompiledRule ──────────────────────────────

describe('buildCompiledRule', () => {
  it('builds a regex rule from valid compiler output', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: 'console\\.log',
      message: 'No console.log',
      engine: 'regex',
      severity: 'warning',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash);
    expect(result.rule).not.toBeNull();
    expect(result.rule!.engine).toBe('regex');
    expect(result.rule!.pattern).toBe('console\\.log');
    expect(result.rule!.message).toBe('No console.log');
    expect(result.rule!.lessonHash).toBe('abc123');
    expect(result.rule!.severity).toBe('warning');
  });

  it('builds an ast-grep rule', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'Use err in catch',
      engine: 'ast-grep',
      astGrepPattern: 'catch($ERR) { $$$ }',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash);
    expect(result.rule).not.toBeNull();
    expect(result.rule!.engine).toBe('ast-grep');
  });

  it('builds an ast rule', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'AST check',
      engine: 'ast',
      astQuery: '(catch_clause parameter: (identifier) @name)',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash);
    expect(result.rule).not.toBeNull();
    expect(result.rule!.engine).toBe('ast');
  });

  it('returns null rule for non-compilable output', () => {
    const parsed: CompilerOutput = { compilable: false };
    expect(buildCompiledRule(parsed, lesson, existingByHash).rule).toBeNull();
  });

  it('returns rejectReason for regex with missing pattern', () => {
    const parsed: CompilerOutput = { compilable: true, message: 'test', engine: 'regex' };
    const result = buildCompiledRule(parsed, lesson, existingByHash);
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('Missing');
  });

  it('returns rejectReason for invalid regex', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: '(unclosed',
      message: 'test',
      engine: 'regex',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash);
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('Rejected regex');
  });

  it('returns rejectReason for ast-grep with missing pattern', () => {
    const parsed: CompilerOutput = { compilable: true, message: 'test', engine: 'ast-grep' };
    const result = buildCompiledRule(parsed, lesson, existingByHash);
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('astGrepPattern');
  });

  it('returns rejectReason for ast-grep with missing message', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      engine: 'ast-grep',
      astGrepPattern: 'catch($ERR) { $$$ }',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash);
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('message');
  });

  it('returns rejectReason for ast with missing query', () => {
    const parsed: CompilerOutput = { compilable: true, message: 'test', engine: 'ast' };
    const result = buildCompiledRule(parsed, lesson, existingByHash);
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('astQuery');
  });

  it('returns rejectReason for ast with missing message', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      engine: 'ast',
      astQuery: '(catch_clause)',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash);
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('message');
  });

  it('preserves createdAt from existing rule', () => {
    const existing = new Map<string, CompiledRule>();
    existing.set('abc123', {
      lessonHash: 'abc123',
      lessonHeading: 'old',
      pattern: 'old',
      message: 'old',
      engine: 'regex',
      compiledAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2025-01-01T00:00:00.000Z',
    });
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: 'console\\.log',
      message: 'No console.log',
      engine: 'regex',
    };
    const result = buildCompiledRule(parsed, lesson, existing);
    expect(result.rule!.createdAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('includes sanitized fileGlobs when provided', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: 'test',
      message: 'test',
      engine: 'regex',
      fileGlobs: ['**/*.ts'],
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash);
    expect(result.rule!.fileGlobs).toEqual(['**/*.ts']);
  });

  it('defaults severity to warning', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: 'test',
      message: 'test',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash);
    expect(result.rule!.severity).toBe('warning');
  });
});

// ─── validateAstGrepPattern ────────────────────────

describe('validateAstGrepPattern', () => {
  it('accepts a valid simple string pattern', () => {
    const result = validateAstGrepPattern('catch($ERR) { $$$ }');
    expect(result.valid).toBe(true);
  });

  it('accepts a valid object pattern with rule key', () => {
    const result = validateAstGrepPattern({ rule: { pattern: 'console.log($A)' } });
    expect(result.valid).toBe(true);
  });

  it('rejects an empty string pattern', () => {
    const result = validateAstGrepPattern('');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('empty');
  });

  it('rejects a whitespace-only string pattern', () => {
    const result = validateAstGrepPattern('   ');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('empty');
  });

  it('rejects an object pattern without rule key', () => {
    const result = validateAstGrepPattern({ pattern: 'console.log($A)' });
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('rule');
  });

  it('rejects multi-root pattern with semicolons', () => {
    const result = validateAstGrepPattern('foo(); bar()');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('top-level expressions');
  });

  it('rejects multi-root pattern with newlines', () => {
    const result = validateAstGrepPattern('foo()\nbar()');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('top-level expressions');
  });

  it('accepts pattern with braces containing semicolons (single root)', () => {
    const result = validateAstGrepPattern('function $NAME($$$) { $$$ }');
    expect(result.valid).toBe(true);
  });

  it('accepts pattern with nested parens and braces', () => {
    const result = validateAstGrepPattern('if ($COND) { $$$BODY }');
    expect(result.valid).toBe(true);
  });

  it('rejects the componentDidCatch multi-root case from issue #1062', () => {
    // "componentDidCatch($$$) {}" has a call expression + block → two roots
    const result = validateAstGrepPattern('componentDidCatch($$$)\n{}');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('top-level expressions');
  });

  it('accepts pattern with semicolons inside string literals', () => {
    const result = validateAstGrepPattern('const x = "a;b"');
    expect(result.valid).toBe(true);
  });

  it('accepts pattern with newlines inside template literals', () => {
    const result = validateAstGrepPattern('const x = `a\nb`');
    expect(result.valid).toBe(true);
  });

  it('accepts pattern with braces inside string literals', () => {
    const result = validateAstGrepPattern('const x = "{ }"');
    expect(result.valid).toBe(true);
  });
});

// ─── buildCompiledRule with ast-grep validation ────

describe('buildCompiledRule ast-grep validation (#1062)', () => {
  it('rejects ast-grep rule with empty pattern (falsy check)', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'test',
      engine: 'ast-grep',
      astGrepPattern: '',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash);
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('Missing astGrepPattern');
  });

  it('rejects ast-grep rule with whitespace-only pattern', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'test',
      engine: 'ast-grep',
      astGrepPattern: '   ',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash);
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('Invalid ast-grep pattern');
    expect(result.rejectReason).toContain('empty');
  });

  it('rejects ast-grep rule with multi-root pattern', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'test',
      engine: 'ast-grep',
      astGrepPattern: 'foo(); bar()',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash);
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('Invalid ast-grep pattern');
    expect(result.rejectReason).toContain('top-level expressions');
  });

  it('rejects ast-grep rule with object pattern missing rule key', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'test',
      engine: 'ast-grep',
      astGrepPattern: { pattern: 'console.log($A)' },
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash);
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('Invalid ast-grep pattern');
    expect(result.rejectReason).toContain('rule');
  });

  it('accepts valid ast-grep string pattern', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'Use err in catch',
      engine: 'ast-grep',
      astGrepPattern: 'catch($ERR) { $$$ }',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash);
    expect(result.rule).not.toBeNull();
    expect(result.rule!.engine).toBe('ast-grep');
  });

  it('accepts valid ast-grep object pattern with rule key', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'No console.log',
      engine: 'ast-grep',
      astGrepPattern: { rule: { pattern: 'console.log($A)' } },
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash);
    expect(result.rule).not.toBeNull();
    expect(result.rule!.engine).toBe('ast-grep');
  });
});

// ─── buildManualRule ────────────────────────────────

describe('buildManualRule', () => {
  it('returns null rule for lessons without manual patterns', () => {
    const result = buildManualRule(lesson, existingByHash);
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toBeUndefined();
  });

  it('builds a rule from a manual pattern lesson', () => {
    const result = buildManualRule(manualLesson, existingByHash);
    expect(result.rule).not.toBeNull();
    expect(result.rule!.message).toBe(manualLesson.heading);
    expect(result.rule!.engine).toBe('regex');
  });

  it('returns rejectReason for invalid manual regex', () => {
    const invalidLesson: LessonInput = {
      index: 2,
      heading: 'Bad regex',
      body: '**Pattern:** `(unclosed`\n**Engine:** regex\n**Severity:** warning',
      hash: 'bad789',
    };
    const result = buildManualRule(invalidLesson, existingByHash);
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('rejected');
  });

  it('returns rejectReason for invalid manual ast-grep pattern (multi-root)', () => {
    const invalidLesson: LessonInput = {
      index: 3,
      heading: 'Multi-root ast-grep',
      body: '**Pattern:** foo(); bar()\n**Engine:** ast-grep\n**Severity:** warning',
      hash: 'astbad1',
    };
    const result = buildManualRule(invalidLesson, existingByHash);
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('ast-grep');
    expect(result.rejectReason).toContain('top-level expressions');
  });

  it('builds valid manual ast-grep rule', () => {
    const validLesson: LessonInput = {
      index: 4,
      heading: 'Catch err not error',
      body: '**Pattern:** catch($ERR) { $$$ }\n**Engine:** ast-grep\n**Severity:** warning',
      hash: 'astgood1',
    };
    const result = buildManualRule(validLesson, existingByHash);
    expect(result.rule).not.toBeNull();
    expect(result.rule!.engine).toBe('ast-grep');
  });
});

// ─── compileLesson ──────────────────────────────────

describe('compileLesson', () => {
  const makeDeps = (response: string | undefined): CompileLessonDeps => ({
    parseCompilerResponse: vi.fn().mockReturnValue(
      response
        ? {
            compilable: true,
            pattern: 'console\\.log',
            message: 'No console.log',
            engine: 'regex' as const,
          }
        : null,
    ),
    runOrchestrator: vi.fn().mockResolvedValue(response),
    existingByHash: new Map(),
    callbacks: {
      onWarn: vi.fn(),
      onDim: vi.fn(),
    },
  });

  it('compiles via LLM when no manual pattern', async () => {
    const deps = makeDeps('{"compilable": true}');
    const result = await compileLesson(lesson, 'system prompt', deps);
    expect(result.status).toBe('compiled');
    expect(deps.runOrchestrator).toHaveBeenCalled();
  });

  it('uses manual pattern when available (skips LLM)', async () => {
    const deps = makeDeps('should not be called');
    const result = await compileLesson(manualLesson, 'system prompt', deps);
    expect(result.status).toBe('compiled');
    expect(deps.runOrchestrator).not.toHaveBeenCalled();
  });

  it('returns noop when orchestrator returns null', async () => {
    const deps = makeDeps(undefined);
    const result = await compileLesson(lesson, 'system prompt', deps);
    expect(result.status).toBe('noop');
  });

  it('returns failed when parseCompilerResponse returns null', async () => {
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn().mockReturnValue(null),
      runOrchestrator: vi.fn().mockResolvedValue('bad response'),
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };
    const result = await compileLesson(lesson, 'system prompt', deps);
    expect(result.status).toBe('failed');
    expect(deps.callbacks!.onWarn).toHaveBeenCalled();
  });

  it('returns skipped for non-compilable lessons', async () => {
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn().mockReturnValue({ compilable: false }),
      runOrchestrator: vi.fn().mockResolvedValue('response'),
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };
    const result = await compileLesson(lesson, 'system prompt', deps);
    expect(result.status).toBe('skipped');
    expect(deps.callbacks!.onDim).toHaveBeenCalled();
  });

  it('returns reason in skipped result when LLM provides one', async () => {
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn().mockReturnValue({
        compilable: false,
        reason: 'Describes a conceptual principle, not a code pattern',
      }),
      runOrchestrator: vi.fn().mockResolvedValue('response'),
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };
    const result = await compileLesson(lesson, 'system prompt', deps);
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reason).toBe('Describes a conceptual principle, not a code pattern');
    }
  });

  it('returns undefined reason in skipped result when LLM omits it', async () => {
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn().mockReturnValue({ compilable: false }),
      runOrchestrator: vi.fn().mockResolvedValue('response'),
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };
    const result = await compileLesson(lesson, 'system prompt', deps);
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reason).toBeUndefined();
    }
  });

  it('calls onWarn callback on failures', async () => {
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn().mockReturnValue(null),
      runOrchestrator: vi.fn().mockResolvedValue('bad'),
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };
    await compileLesson(lesson, 'system prompt', deps);
    expect(deps.callbacks!.onWarn).toHaveBeenCalledWith(
      lesson.heading,
      expect.stringContaining('parse'),
    );
  });
});

// ─── verifyRuleExamples ──────────────────────────────

describe('verifyRuleExamples', () => {
  it('returns null when lesson has no examples', () => {
    const rule: CompiledRule = {
      lessonHash: 'h1',
      lessonHeading: 'test',
      pattern: 'console\\.log',
      message: 'no console.log',
      engine: 'regex',
      compiledAt: new Date().toISOString(),
    };
    const result = verifyRuleExamples(rule, 'no examples here');
    expect(result).toBeNull();
  });

  it('returns null for non-regex engine', () => {
    const rule: CompiledRule = {
      lessonHash: 'h2',
      lessonHeading: 'test',
      message: 'ast rule',
      engine: 'ast-grep',
      astGrepPattern: 'console.log($A)',
      pattern: '',
      compiledAt: new Date().toISOString(),
    };
    const body = '**Example Hit:** console.log(x)';
    expect(verifyRuleExamples(rule, body)).toBeNull();
  });

  it('passes when hits match and misses do not', () => {
    const rule: CompiledRule = {
      lessonHash: 'h3',
      lessonHeading: 'test',
      pattern: 'console\\.log',
      message: 'no console.log',
      engine: 'regex',
      compiledAt: new Date().toISOString(),
    };
    const body = '**Example Hit:** console.log("test")\n**Example Miss:** logger.info("test")';
    const result = verifyRuleExamples(rule, body);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
  });

  it('fails when a hit does not match', () => {
    const rule: CompiledRule = {
      lessonHash: 'h4',
      lessonHeading: 'test',
      pattern: 'console\\.log',
      message: 'no console.log',
      engine: 'regex',
      compiledAt: new Date().toISOString(),
    };
    const body = '**Example Hit:** logger.info("test")';
    const result = verifyRuleExamples(rule, body);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.missedFails.length).toBeGreaterThan(0);
  });

  it('fails when a miss matches', () => {
    const rule: CompiledRule = {
      lessonHash: 'h5',
      lessonHeading: 'test',
      pattern: 'console\\.log',
      message: 'no console.log',
      engine: 'regex',
      compiledAt: new Date().toISOString(),
    };
    const body = '**Example Miss:** console.log("oops")';
    const result = verifyRuleExamples(rule, body);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(false);
    expect(result!.falsePositives.length).toBeGreaterThan(0);
  });

  it('respects fileGlobs when deriving virtual file path', () => {
    const rule: CompiledRule = {
      lessonHash: 'h6',
      lessonHeading: 'test',
      pattern: 'console\\.log',
      message: 'no console.log',
      engine: 'regex',
      compiledAt: new Date().toISOString(),
      fileGlobs: ['**/*.py'],
    };
    const body = '**Example Hit:** console.log("test")';
    const result = verifyRuleExamples(rule, body);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
  });

  it('handles compound extension globs like **/*.test.ts', () => {
    const rule: CompiledRule = {
      lessonHash: 'h7',
      lessonHeading: 'test',
      pattern: 'console\\.log',
      message: 'no console.log',
      engine: 'regex',
      compiledAt: new Date().toISOString(),
      fileGlobs: ['**/*.test.ts'],
    };
    const body = '**Example Hit:** console.log("test")';
    const result = verifyRuleExamples(rule, body);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
  });

  it('handles exact file globs like package.json', () => {
    const rule: CompiledRule = {
      lessonHash: 'h8',
      lessonHeading: 'test',
      pattern: '"version"',
      message: 'version field',
      engine: 'regex',
      compiledAt: new Date().toISOString(),
      fileGlobs: ['package.json'],
    };
    const body = '**Example Hit:** "version": "1.0.0"';
    const result = verifyRuleExamples(rule, body);
    expect(result).not.toBeNull();
    expect(result!.passed).toBe(true);
  });
});

// ─── compileLesson with inline examples ─────────────

describe('compileLesson with inline examples', () => {
  const makeDeps = (response: string | undefined): CompileLessonDeps => ({
    parseCompilerResponse: vi.fn().mockReturnValue(
      response
        ? {
            compilable: true,
            pattern: 'console\\.log',
            message: 'No console.log',
            engine: 'regex' as const,
          }
        : null,
    ),
    runOrchestrator: vi.fn().mockResolvedValue(response),
    existingByHash: new Map(),
    callbacks: {
      onWarn: vi.fn(),
      onDim: vi.fn(),
    },
  });

  it('compiles when examples pass for manual pattern', async () => {
    const lessonWithExamples: LessonInput = {
      index: 0,
      heading: 'No console.log',
      hash: 'ex1',
      body: '**Pattern:** console\\.log\n**Engine:** regex\n**Severity:** warning\n**Scope:** **/*.ts\n**Example Hit:** console.log("test")\n**Example Miss:** logger.info("test")',
    };
    const deps = makeDeps(undefined);
    const result = await compileLesson(lessonWithExamples, 'system prompt', deps);
    expect(result.status).toBe('compiled');
  });

  it('fails when example hit does not match manual pattern', async () => {
    const lessonBadHit: LessonInput = {
      index: 0,
      heading: 'No console.log',
      hash: 'ex2',
      body: '**Pattern:** console\\.log\n**Engine:** regex\n**Severity:** warning\n**Scope:** **/*.ts\n**Example Hit:** logger.info("test")',
    };
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn(),
      runOrchestrator: vi.fn(),
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };
    const result = await compileLesson(lessonBadHit, 'system prompt', deps);
    expect(result.status).toBe('failed');
    expect(deps.callbacks!.onWarn).toHaveBeenCalledWith(
      lessonBadHit.heading,
      expect.stringContaining('Example Hit'),
    );
  });

  it('fails when example miss matches the pattern', async () => {
    const lessonBadMiss: LessonInput = {
      index: 0,
      heading: 'No console.log',
      hash: 'ex3',
      body: '**Pattern:** console\\.log\n**Engine:** regex\n**Severity:** warning\n**Scope:** **/*.ts\n**Example Miss:** console.log("oops")',
    };
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn(),
      runOrchestrator: vi.fn(),
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };
    const result = await compileLesson(lessonBadMiss, 'system prompt', deps);
    expect(result.status).toBe('failed');
    expect(deps.callbacks!.onWarn).toHaveBeenCalledWith(
      lessonBadMiss.heading,
      expect.stringContaining('Example Miss'),
    );
  });

  it('compiles without verification when no examples present (backward compat)', async () => {
    const deps = makeDeps('{"compilable": true}');
    const result = await compileLesson(lesson, 'system prompt', deps);
    expect(result.status).toBe('compiled');
  });
});
