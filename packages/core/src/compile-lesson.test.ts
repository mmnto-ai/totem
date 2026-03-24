import { describe, expect, it, vi } from 'vitest';

import {
  buildCompiledRule,
  buildManualRule,
  compileLesson,
  type CompileLessonDeps,
  type LessonInput,
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
    const rule = buildCompiledRule(parsed, lesson, existingByHash);
    expect(rule).not.toBeNull();
    expect(rule!.engine).toBe('regex');
    expect(rule!.pattern).toBe('console\\.log');
    expect(rule!.message).toBe('No console.log');
    expect(rule!.lessonHash).toBe('abc123');
    expect(rule!.severity).toBe('warning');
  });

  it('builds an ast-grep rule', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'Use err in catch',
      engine: 'ast-grep',
      astGrepPattern: 'catch($ERR) { $$$ }',
    };
    const rule = buildCompiledRule(parsed, lesson, existingByHash);
    expect(rule).not.toBeNull();
    expect(rule!.engine).toBe('ast-grep');
  });

  it('builds an ast rule', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'AST check',
      engine: 'ast',
      astQuery: '(catch_clause parameter: (identifier) @name)',
    };
    const rule = buildCompiledRule(parsed, lesson, existingByHash);
    expect(rule).not.toBeNull();
    expect(rule!.engine).toBe('ast');
  });

  it('returns null for non-compilable output', () => {
    const parsed: CompilerOutput = { compilable: false };
    expect(buildCompiledRule(parsed, lesson, existingByHash)).toBeNull();
  });

  it('returns null for regex with missing pattern', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'test',
      engine: 'regex',
    };
    expect(buildCompiledRule(parsed, lesson, existingByHash)).toBeNull();
  });

  it('returns null for invalid regex', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: '(unclosed',
      message: 'test',
      engine: 'regex',
    };
    expect(buildCompiledRule(parsed, lesson, existingByHash)).toBeNull();
  });

  it('returns null for ast-grep with missing pattern', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'test',
      engine: 'ast-grep',
    };
    expect(buildCompiledRule(parsed, lesson, existingByHash)).toBeNull();
  });

  it('returns null for ast with missing query', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'test',
      engine: 'ast',
    };
    expect(buildCompiledRule(parsed, lesson, existingByHash)).toBeNull();
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
    const rule = buildCompiledRule(parsed, lesson, existing);
    expect(rule!.createdAt).toBe('2025-01-01T00:00:00.000Z');
  });

  it('includes sanitized fileGlobs when provided', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: 'test',
      message: 'test',
      engine: 'regex',
      fileGlobs: ['**/*.ts'],
    };
    const rule = buildCompiledRule(parsed, lesson, existingByHash);
    expect(rule!.fileGlobs).toEqual(['**/*.ts']);
  });

  it('defaults severity to warning', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: 'test',
      message: 'test',
    };
    const rule = buildCompiledRule(parsed, lesson, existingByHash);
    expect(rule!.severity).toBe('warning');
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
