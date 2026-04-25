import { describe, expect, it, vi } from 'vitest';

import {
  buildCompiledRule,
  buildManualRule,
  compileLesson,
  type CompileLessonDeps,
  isSecurityContext,
  type LessonInput,
  validateAstGrepPattern,
  verifyRuleExamples,
} from './compile-lesson.js';
import type { CompiledRule, CompilerOutput } from './compiler-schema.js';
import { CompilerOutputSchema } from './compiler-schema.js';

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
      // Wrapped try/catch form — a bare `catch($E) { $$$ }` is rejected
      // by ast-grep as multi-root (#1339).
      astGrepPattern: 'try { $$$BODY } catch ($ERR) {}',
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

  it('preserves archive lifecycle fields (status, archivedReason, archivedAt) from existing rule (#1587)', () => {
    // When --force recompiles a rule that was previously archived by a
    // postmerge curation script, the archive lifecycle fields must carry
    // forward. Otherwise `--force` silently un-archives every archived
    // rule in the corpus — the exact bug LC Claude identified.
    const existing = new Map<string, CompiledRule>();
    existing.set('abc123', {
      lessonHash: 'abc123',
      lessonHeading: 'old',
      pattern: 'old',
      message: 'old',
      engine: 'regex',
      compiledAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2025-01-01T00:00:00.000Z',
      status: 'archived',
      archivedReason: 'Over-broad in test contexts',
      archivedAt: '2026-04-15T00:00:00.000Z',
    });
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: 'console\\.log',
      message: 'No console.log',
      engine: 'regex',
    };
    const result = buildCompiledRule(parsed, lesson, existing);
    expect(result.rule!.status).toBe('archived');
    expect(result.rule!.archivedReason).toBe('Over-broad in test contexts');
    expect(result.rule!.archivedAt).toBe('2026-04-15T00:00:00.000Z');
  });

  it('does not set lifecycle fields when existing rule has none (#1587)', () => {
    // Non-archived existing rule: lifecycle fields stay absent on the new
    // rule. Zod strips undefined; explicit absence is the canonical
    // "active" state per CompiledRuleSchema.
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
    expect(result.rule!.status).toBeUndefined();
    expect(result.rule!.archivedReason).toBeUndefined();
    expect(result.rule!.archivedAt).toBeUndefined();
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

  // ─── Declared severity override (mmnto-ai/totem#1656) ──

  it('honors declaredSeverityOverride when LLM emits a different severity', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: 'test',
      message: 'test',
      engine: 'regex',
      severity: 'warning',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash, {
      declaredSeverityOverride: 'error',
    });
    expect(result.rule!.severity).toBe('error');
    expect(result.severityOverride).toEqual({ from: 'warning', to: 'error' });
  });

  it('honors declaredSeverityOverride when LLM emits no severity', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: 'test',
      message: 'test',
      engine: 'regex',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash, {
      declaredSeverityOverride: 'error',
    });
    expect(result.rule!.severity).toBe('error');
    expect(result.severityOverride).toEqual({ from: undefined, to: 'error' });
  });

  it('omits severityOverride marker when declared severity matches LLM output', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: 'test',
      message: 'test',
      engine: 'regex',
      severity: 'error',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash, {
      declaredSeverityOverride: 'error',
    });
    expect(result.rule!.severity).toBe('error');
    expect(result.severityOverride).toBeUndefined();
  });

  it('omits severityOverride marker when no declared severity provided', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: 'test',
      message: 'test',
      engine: 'regex',
      severity: 'warning',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash);
    expect(result.rule!.severity).toBe('warning');
    expect(result.severityOverride).toBeUndefined();
  });

  it('omits severityOverride marker when declared warning matches the default fallback', () => {
    // LLM emits no severity AND declared is 'warning'. The emitted severity
    // would have defaulted to 'warning' anyway, so the override changes
    // nothing in the final rule. Marker must not fire — it would be
    // telemetry noise on every lesson that declares its severity as warning.
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: 'test',
      message: 'test',
      engine: 'regex',
      // severity deliberately omitted (undefined)
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash, {
      declaredSeverityOverride: 'warning',
    });
    expect(result.rule!.severity).toBe('warning');
    expect(result.severityOverride).toBeUndefined();
  });

  it('preserves severityOverride on rejection paths too', () => {
    // CR round-3 finding on mmnto-ai/totem#1658: if the LLM drifts on
    // severity AND emits an invalid pattern, the rejection path must still
    // surface severityOverride so telemetry captures exactly the
    // prompt-drift cases this signal is meant to detect.
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: '(unclosed',
      message: 'test',
      engine: 'regex',
      severity: 'warning',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash, {
      declaredSeverityOverride: 'error',
    });
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('Rejected regex');
    expect(result.severityOverride).toEqual({ from: 'warning', to: 'error' });
  });

  it('does not fabricate severityOverride on rejection paths when declared severity matches', () => {
    // Inverse of the above: rejection path + no actual drift = no marker.
    // The rejection is still reported; only the severity-override signal
    // stays absent.
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: '(unclosed',
      message: 'test',
      engine: 'regex',
      severity: 'error',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash, {
      declaredSeverityOverride: 'error',
    });
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('Rejected regex');
    expect(result.severityOverride).toBeUndefined();
  });

  // ─── scopeOverride (mmnto-ai/totem#1665) ──────────

  it('overrides LLM-dropped exclusions when source declares Scope', () => {
    // The exhibit case: lesson source declares test-exclusions but the LLM
    // emits a stripped fileGlobs. Author intent always wins.
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: 'test',
      message: 'test',
      engine: 'regex',
      fileGlobs: ['packages/zomboid-sim/src/**/*.rs'],
    };
    const lessonBody = '**Scope:** packages/zomboid-sim/src/**/*.rs, !**/*.test.*, !**/*.spec.*';
    const result = buildCompiledRule(parsed, lesson, existingByHash, { lessonBody });
    expect(result.rule!.fileGlobs).toEqual([
      'packages/zomboid-sim/src/**/*.rs',
      '!**/*.test.*',
      '!**/*.spec.*',
    ]);
    expect(result.scopeOverride).toEqual({
      from: ['packages/zomboid-sim/src/**/*.rs'],
      to: ['packages/zomboid-sim/src/**/*.rs', '!**/*.test.*', '!**/*.spec.*'],
    });
  });

  it('overrides LLM-hallucinated additions when source declares a different Scope', () => {
    // Inverse direction: LLM auto-includes test patterns the author did not declare.
    // #1626's auto-include heuristic is not honored when source declares Scope —
    // author intent wins over heuristic.
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: 'test',
      message: 'test',
      engine: 'regex',
      fileGlobs: ['packages/api/**/*.ts', '**/*.test.*', '**/*.spec.*'],
    };
    const lessonBody = '**Scope:** packages/api/**/*.ts';
    const result = buildCompiledRule(parsed, lesson, existingByHash, { lessonBody });
    expect(result.rule!.fileGlobs).toEqual(['packages/api/**/*.ts']);
    expect(result.scopeOverride).toEqual({
      from: ['packages/api/**/*.ts', '**/*.test.*', '**/*.spec.*'],
      to: ['packages/api/**/*.ts'],
    });
  });

  it('omits scopeOverride marker when LLM emission already matches source-Scope', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: 'test',
      message: 'test',
      engine: 'regex',
      fileGlobs: ['packages/api/**/*.ts', '!**/*.test.*'],
    };
    const lessonBody = '**Scope:** packages/api/**/*.ts, !**/*.test.*';
    const result = buildCompiledRule(parsed, lesson, existingByHash, { lessonBody });
    expect(result.rule!.fileGlobs).toEqual(['packages/api/**/*.ts', '!**/*.test.*']);
    expect(result.scopeOverride).toBeUndefined();
  });

  it('omits scopeOverride marker when set-equal but order differs', () => {
    // Order-insensitive set equality: same entries different order = no override.
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: 'test',
      message: 'test',
      engine: 'regex',
      fileGlobs: ['!**/*.test.*', 'packages/api/**/*.ts'],
    };
    const lessonBody = '**Scope:** packages/api/**/*.ts, !**/*.test.*';
    const result = buildCompiledRule(parsed, lesson, existingByHash, { lessonBody });
    expect(result.scopeOverride).toBeUndefined();
  });

  it('does not override when source omits Scope (preserves LLM emission, no marker)', () => {
    // Backward-compat path: lessons without **Scope:** keep the LLM emission
    // exactly as-is (including any #1626 test-contract auto-include).
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: 'test',
      message: 'test',
      engine: 'regex',
      fileGlobs: ['**/*.test.*', '**/*.spec.*'],
    };
    const lessonBody = 'A test-contract lesson body with no Scope line.';
    const result = buildCompiledRule(parsed, lesson, existingByHash, { lessonBody });
    expect(result.rule!.fileGlobs).toEqual(['**/*.test.*', '**/*.spec.*']);
    expect(result.scopeOverride).toBeUndefined();
  });

  it('does not override when lessonBody option is omitted (current-behavior preservation)', () => {
    // Caller that does not opt into the override path (e.g., ad-hoc test
    // harnesses) gets exactly today's behavior — no parsing, no marker.
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: 'test',
      message: 'test',
      engine: 'regex',
      fileGlobs: ['**/*.ts'],
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash);
    expect(result.rule!.fileGlobs).toEqual(['**/*.ts']);
    expect(result.scopeOverride).toBeUndefined();
  });

  it('overrides when source declares Scope but LLM emits nothing', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: 'test',
      message: 'test',
      engine: 'regex',
      // fileGlobs deliberately undefined
    };
    const lessonBody = '**Scope:** packages/core/**/*.ts';
    const result = buildCompiledRule(parsed, lesson, existingByHash, { lessonBody });
    expect(result.rule!.fileGlobs).toEqual(['packages/core/**/*.ts']);
    expect(result.scopeOverride).toEqual({
      from: undefined,
      to: ['packages/core/**/*.ts'],
    });
  });

  it('preserves scopeOverride on rejection paths too', () => {
    // Mirrors the severityOverride rejection-path test. If the LLM drifts on
    // Scope AND emits an invalid pattern, the rejection still surfaces the
    // marker so telemetry captures exactly the prompt-drift cases.
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: '(unclosed',
      message: 'test',
      engine: 'regex',
      fileGlobs: ['**/*.ts'],
    };
    const lessonBody = '**Scope:** packages/core/**/*.ts, !**/*.test.*';
    const result = buildCompiledRule(parsed, lesson, existingByHash, { lessonBody });
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('Rejected regex');
    expect(result.scopeOverride).toEqual({
      from: ['**/*.ts'],
      to: ['packages/core/**/*.ts', '!**/*.test.*'],
    });
  });

  it('normalizes shallow globs through sanitizeFileGlobs on the source-Scope path', () => {
    // sanitizeFileGlobs converts shallow `*.ts` to recursive `**/*.ts`. Both
    // source-derived and LLM-emitted lists pass through it, so an authored
    // `*.ts` matches an LLM-emitted `**/*.ts` and no override fires.
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: 'test',
      message: 'test',
      engine: 'regex',
      fileGlobs: ['**/*.ts'],
    };
    const lessonBody = '**Scope:** *.ts';
    const result = buildCompiledRule(parsed, lesson, existingByHash, { lessonBody });
    expect(result.rule!.fileGlobs).toEqual(['**/*.ts']);
    expect(result.scopeOverride).toBeUndefined();
  });

  it('expands brace groups via sanitizeFileGlobs on the source-Scope path (CR PR #1674)', () => {
    // Author writes brace-expansion form; parseDeclaredScope keeps it as a
    // single token (top-level-only comma split) so sanitizeFileGlobs can
    // expand it downstream. LLM emits the expanded form. After sanitization
    // both reduce to identical sets, so no override fires.
    const parsed: CompilerOutput = {
      compilable: true,
      pattern: 'test',
      message: 'test',
      engine: 'regex',
      fileGlobs: ['**/*.ts', '**/*.tsx'],
    };
    const lessonBody = '**Scope:** **/*.{ts,tsx}';
    const result = buildCompiledRule(parsed, lesson, existingByHash, { lessonBody });
    expect(result.rule!.fileGlobs).toEqual(['**/*.ts', '**/*.tsx']);
    expect(result.scopeOverride).toBeUndefined();
  });
});

// ─── self-suppression guard (#1177) ────────────────

describe('self-suppression guard (#1177)', () => {
  it('rejects regex pattern containing totem-ignore', () => {
    const result = buildCompiledRule(
      {
        compilable: true,
        pattern: '\\btotem-ignore\\b',
        message: 'test',
        engine: 'regex',
      } as CompilerOutput,
      { hash: 'abc123', heading: 'Test' },
      new Map(),
    );
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('self-suppress');
  });

  it('rejects regex pattern containing totem-context', () => {
    const result = buildCompiledRule(
      {
        compilable: true,
        pattern: 'totem-context:',
        message: 'test',
        engine: 'regex',
      } as CompilerOutput,
      { hash: 'def456', heading: 'Test' },
      new Map(),
    );
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('self-suppress');
  });

  it('allows normal regex patterns', () => {
    const result = buildCompiledRule(
      {
        compilable: true,
        pattern: '\\bconsole\\.log\\b',
        message: 'no console',
        engine: 'regex',
      } as CompilerOutput,
      { hash: 'ghi789', heading: 'Test' },
      new Map(),
    );
    expect(result.rule).not.toBeNull();
  });

  it('rejects ast-grep string pattern containing totem-ignore', () => {
    const result = buildCompiledRule(
      {
        compilable: true,
        astGrepPattern: '// totem-ignore',
        message: 'test',
        engine: 'ast-grep',
      } as CompilerOutput,
      { hash: 'ast123', heading: 'Test' },
      new Map(),
    );
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('self-suppress');
  });

  it('rejects ast-grep compound rule containing totem-context', () => {
    const result = buildCompiledRule(
      {
        compilable: true,
        astGrepYamlRule: { rule: { pattern: 'totem-context: something' } },
        message: 'test',
        engine: 'ast-grep',
      } as CompilerOutput,
      { hash: 'ast456', heading: 'Test' },
      new Map(),
    );
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('self-suppress');
  });

  it('allows normal ast-grep patterns', () => {
    const result = buildCompiledRule(
      {
        compilable: true,
        astGrepPattern: 'try { $$$BODY } catch ($ERR) {}',
        message: 'test',
        engine: 'ast-grep',
      } as CompilerOutput,
      { hash: 'ast789', heading: 'Test' },
      new Map(),
    );
    expect(result.rule).not.toBeNull();
  });
});

// ─── validateAstGrepPattern ────────────────────────

describe('validateAstGrepPattern', () => {
  it('accepts a valid simple string pattern', () => {
    // Note: `catch($E) { $$$ }` used to be the sample here. That was an
    // aspirational test — ast-grep's actual parser rejects bare `catch`
    // clauses as multi-root (they can only exist inside a try statement).
    // The #1339 parser-based validation surfaced the mismatch. Using
    // `throw new Error($MSG)` instead — a real single-root statement that
    // is used by several production compiled rules.
    const result = validateAstGrepPattern('throw new Error($MSG)');
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

  // ─── Parser-based semantic validation (#1339) ────
  //
  // The heuristic checks above catch obvious multi-root patterns
  // (semicolons, newlines) but miss single-line expressions that
  // ast-grep still rejects because they can't be extracted as a single
  // AST node. The canonical failure from the 1.14.1 postmerge compile
  // was `.option("--no-$FLAG", $$$REST)` — a floating member call with
  // no receiver, which ast-grep rejects with "Multiple AST nodes are
  // detected. Please check the pattern source". Before #1339, rules
  // with these patterns slipped through the compile gate, landed in
  // compiled-rules.json, and crashed `totem lint` at runtime.
  //
  // Fix: after the heuristic checks, actually invoke ast-grep's parser
  // by calling `parse(Lang.Tsx, '').root().findAll(pattern)`. If
  // ast-grep cannot compile the pattern into a rule, translate the
  // error into `{ valid: false, reason }`. Empty source + Tsx (the
  // most permissive language; superset of TypeScript) is the fastest
  // possible invocation.

  it('rejects floating member call with no receiver (the #1339 canonical case)', () => {
    // The exact pattern that slipped past validation during the 1.14.1
    // postmerge compile and crashed lint on every rebased PR until
    // someone manually deleted the rule from compiled-rules.json.
    const result = validateAstGrepPattern('.option("--no-$FLAG", $$$REST)');
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/ast-grep/i);
    // GCA finding on PR mmnto/totem#1349: error reason must preserve the
    // verbatim pattern source so users can identify WHICH of their 394+
    // compiled rules is broken. An earlier split-on-dot implementation
    // truncated the most useful part of the message; split-on-newline
    // keeps it intact. Locking in with a substring assertion.
    expect(result.reason).toContain('.option(');
  });

  it('rejects bare floating method call without receiver', () => {
    const result = validateAstGrepPattern('.method($ARG)');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('.method(');
  });

  it('rejects bare catch clause (only valid inside a try statement)', () => {
    // ast-grep treats `catch(...)` as a multi-root construct because a
    // catch clause can only exist as a child of a try statement, not as
    // a standalone root. The pre-#1339 heuristic accepted this pattern
    // because it sees balanced parens and no `;`/`\n` at depth 0.
    const result = validateAstGrepPattern('catch($E) { $$$ }');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('catch(');
  });

  it('rejects bare else clause (only valid inside an if statement)', () => {
    const result = validateAstGrepPattern('else { $$$ }');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('else {');
  });

  it('accepts try/catch wrapped form used by production rules', () => {
    // The idiomatic way to match catch clauses in production Totem rules:
    // wrap in a full try statement so ast-grep has a single root.
    const result = validateAstGrepPattern('try { $$$BODY } catch ($ERR) {}');
    expect(result.valid).toBe(true);
  });

  it('accepts explicit-receiver member call (the fixed shape of #1339)', () => {
    // This is what the broken `.option(...)` rule should have been.
    const result = validateAstGrepPattern('$PROG.option("--no-$FLAG", $$$REST)');
    expect(result.valid).toBe(true);
  });

  it('accepts compound NapiConfig rule with valid inner pattern', () => {
    const result = validateAstGrepPattern({
      rule: { pattern: 'console.log($A)' },
    });
    expect(result.valid).toBe(true);
  });

  it('accepts compound NapiConfig rule using kind selector', () => {
    // `{ rule: { kind: 'catch_clause' } }` is the correct way to match
    // catch clauses — by their AST node kind rather than a bare string
    // pattern. Compound rules bypass the pattern parser and go through
    // ast-grep's rule compiler, which understands kind selectors.
    const result = validateAstGrepPattern({
      rule: { kind: 'catch_clause' },
    });
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

  it('rejects ast-grep rule where Zod blocks a yaml rule missing the rule key', () => {
    // The rule parameter is required by the Zod schema; construct the
    // object as unknown to sidestep the type-narrowing and prove that
    // parseCompilerResponse rejects it at the schema boundary rather
    // than at buildCompiledRule. This is the invariant from the design
    // doc: missing-rule-key is a parse-time failure, not a runtime one.
    const malformed = {
      compilable: true,
      message: 'test',
      engine: 'ast-grep',
      astGrepYamlRule: { pattern: 'console.log($A)' },
    };
    // Parse with the authoritative schema to prove Zod rejects.
    const parsed = CompilerOutputSchema.safeParse(malformed);
    expect(parsed.success).toBe(false);
  });

  it('accepts valid ast-grep string pattern', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'Use err in catch',
      engine: 'ast-grep',
      astGrepPattern: 'try { $$$BODY } catch ($ERR) {}',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash);
    expect(result.rule).not.toBeNull();
    expect(result.rule!.engine).toBe('ast-grep');
  });

  it('accepts valid ast-grep compound rule via astGrepYamlRule', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'No console.log',
      engine: 'ast-grep',
      astGrepYamlRule: { rule: { pattern: 'console.log($A)' } },
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash);
    expect(result.rule).not.toBeNull();
    expect(result.rule!.engine).toBe('ast-grep');
    expect(result.rule!.astGrepYamlRule).toEqual({ rule: { pattern: 'console.log($A)' } });
    expect(result.rule!.astGrepPattern).toBeUndefined();
  });

  it('buildCompiledRule passes astGrepYamlRule to validateAstGrepPattern and propagates NAPI rejections', () => {
    // Syntactically-valid Zod shape (has `rule` key) but the leaf kind
    // is a node type ast-grep does not recognize. Zod lets it through;
    // napi rejects it. That is the precise boundary this test pins.
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'nope',
      engine: 'ast-grep',
      astGrepYamlRule: { rule: { kind: '!!!NOT_A_REAL_NODE_KIND!!!' } },
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash);
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('Invalid ast-grep pattern');
    // First-line napi error quoting per #1349
    expect(result.rejectReason).toContain('ast-grep rejected pattern');
  });

  it('isSelfSuppressing still catches compound rules with deep totem-ignore leaves', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'nope',
      engine: 'ast-grep',
      astGrepYamlRule: {
        rule: { all: [{ pattern: 'foo($A)' }, { pattern: 'totem-ignore marker' }] },
      },
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash);
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('self-suppress');
  });
});

// ─── Smoke gate wiring (mmnto/totem#1408) ────────────

describe('buildCompiledRule smoke gate (mmnto/totem#1408)', () => {
  it('rejects Pipeline 2 ast-grep rule that is missing badExample', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'No debugger',
      engine: 'ast-grep',
      astGrepPattern: 'debugger',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash, {
      enforceSmokeGate: true,
    });
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('smoke gate');
    expect(result.rejectReason).toContain('badExample');
  });

  it('rejects Pipeline 2 ast-grep rule whose badExample produces zero matches', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'No debugger',
      engine: 'ast-grep',
      astGrepPattern: 'debugger',
      badExample: 'const x = 1;\n',
      goodExample: '// placeholder\n',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash, {
      enforceSmokeGate: true,
    });
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('smoke gate');
    expect(result.rejectReason).toContain('zero matches');
  });

  it('rejects Pipeline 2 regex rule that is missing badExample', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'No console.log',
      engine: 'regex',
      pattern: 'console\\.log',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash, {
      enforceSmokeGate: true,
    });
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('smoke gate');
    expect(result.rejectReason).toContain('badExample');
  });

  it('accepts Pipeline 2 ast-grep rule whose badExample produces matches', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'No debugger',
      engine: 'ast-grep',
      astGrepPattern: 'debugger',
      badExample: 'debugger;\n',
      goodExample: '// placeholder\n',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash, {
      enforceSmokeGate: true,
    });
    expect(result.rule).not.toBeNull();
    expect(result.rule!.badExample).toBe('debugger;\n');
  });

  it('persists badExample on the CompiledRule when the gate accepts', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'No console.log',
      engine: 'regex',
      pattern: 'console\\.log',
      badExample: 'console.log("debug")',
      goodExample: '// placeholder\n',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash, {
      enforceSmokeGate: true,
    });
    expect(result.rule).not.toBeNull();
    expect(result.rule!.badExample).toBe('console.log("debug")');
  });

  it('honors badExampleOverride so Pipeline 3 can reuse its Bad snippet', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'No console.log',
      engine: 'regex',
      pattern: 'console\\.log',
      // No badExample on parsed; caller supplies it via override
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash, {
      enforceSmokeGate: true,
      badExampleOverride: 'console.log("bad")',
      goodExampleOverride: 'logger.info("good")',
    });
    expect(result.rule).not.toBeNull();
    expect(result.rule!.badExample).toBe('console.log("bad")');
    expect(result.rule!.goodExample).toBe('logger.info("good")');
  });

  it('Pipeline 1 is unaffected (gate is opt-in via enforceSmokeGate)', () => {
    // Without the option flag, buildCompiledRule must behave exactly as before.
    // This pins the design invariant that Pipeline 1 / ad-hoc callers do not
    // break in mmnto/totem#1408. The gate-flip for Pipeline 1 is a follow-up.
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'No console.log',
      engine: 'regex',
      pattern: 'console\\.log',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash);
    expect(result.rule).not.toBeNull();
    expect(result.rejectReason).toBeUndefined();
  });
});

// ─── Compound rule + smoke gate invariants (mmnto-ai/totem#1409) ────

describe('compound rule smoke gate (mmnto-ai/totem#1409)', () => {
  const compoundLesson: LessonInput = {
    index: 0,
    heading: 'No const declarations inside for loops',
    body: 'Hoist the const out of the loop or use let.',
    hash: 'compound-1409',
  };

  it('accepts a compound rule with inside: { kind: for_statement } against a matching badExample', () => {
    // Happy path from the spike harness test 1: kind-based outer target
    // is the supported way to express "inside a for-loop". The smoke
    // gate must accept this when the badExample contains a for-loop
    // body; that pins the canonical compound shape against silent
    // regression.
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'No const inside for-loop',
      engine: 'ast-grep',
      astGrepYamlRule: {
        rule: {
          pattern: 'const $VAR = $VAL',
          inside: { kind: 'for_statement', stopBy: 'end' },
        },
      },
      badExample: 'for (let i = 0; i < 10; i++) {\n  const inside = i * 2;\n}',
      goodExample: '// placeholder\n',
    };
    const result = buildCompiledRule(parsed, compoundLesson, existingByHash, {
      enforceSmokeGate: true,
    });
    expect(result.rule).not.toBeNull();
    expect(result.rule!.engine).toBe('ast-grep');
    expect(result.rule!.astGrepYamlRule).toBeDefined();
  });

  it('rejects the inside: { pattern: for ($A; $B; $C) { $$$ } } sharp edge at the smoke gate', () => {
    // Spike harness test 8 (compound.spike.test.ts:247) pins that
    // pattern-shaped outer targets silently match zero in 0.42.0. The
    // prompt forbids this shape; the smoke gate is the backstop. This
    // test holds the gate honest: feed it the forbidden shape against
    // the same snippet that the kind-based version matches, and the
    // gate must reject because the runtime returns zero matches.
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'No const inside for-loop',
      engine: 'ast-grep',
      astGrepYamlRule: {
        rule: {
          pattern: 'const $VAR = $VAL',
          inside: {
            pattern: 'for ($INIT; $COND; $STEP) { $$$ }',
            stopBy: 'end',
          },
        },
      },
      badExample: 'for (let i = 0; i < 10; i++) {\n  const inside = i * 2;\n}',
      goodExample: '// placeholder\n',
    };
    const result = buildCompiledRule(parsed, compoundLesson, existingByHash, {
      enforceSmokeGate: true,
    });
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('smoke gate');
  });

  it('rejects a compound rule with no badExample at all (schema-shaped CompilerOutput, gate-shaped test)', () => {
    // Test the buildCompiledRule layer directly - the schema layer is
    // covered in compiler-schema.test.ts. Here we prove the smoke-gate
    // path also rejects a compound rule that arrives with no
    // badExample, so callers that bypass the schema (e.g., the
    // upgrade flow) still get the gate's protection.
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'No const inside for-loop',
      engine: 'ast-grep',
      astGrepYamlRule: {
        rule: {
          pattern: 'const $VAR = $VAL',
          inside: { kind: 'for_statement', stopBy: 'end' },
        },
      },
    };
    const result = buildCompiledRule(parsed, compoundLesson, existingByHash, {
      enforceSmokeGate: true,
    });
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('smoke gate');
    expect(result.rejectReason).toContain('badExample');
  });
});

// ─── over-matching check (mmnto-ai/totem#1580) ───────

describe('buildCompiledRule goodExample over-matching check', () => {
  it('rejects a regex rule that fires on its goodExample', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'No console.log',
      engine: 'regex',
      pattern: 'console\\.log',
      // badExample exercises the pattern (matches) — gate under-match passes.
      badExample: 'console.log("debug")',
      // goodExample also matches the pattern, which means the rule is
      // over-broad and fires on known-correct code. The gate must reject.
      goodExample: 'console.log("intentional system message")',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash, {
      enforceSmokeGate: true,
    });
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('smoke gate');
    expect(result.rejectReason).toContain('matches goodExample');
    expect(result.rejectReason).toContain('over-matching');
  });

  it('rejects an ast-grep rule that fires on its goodExample', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'No debugger',
      engine: 'ast-grep',
      astGrepPattern: 'debugger',
      badExample: 'debugger;',
      goodExample: 'debugger;\n// should have been removed before commit',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash, {
      enforceSmokeGate: true,
    });
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('matches goodExample');
  });

  it('accepts a regex rule whose pattern fires on badExample but not goodExample', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'No console.log',
      engine: 'regex',
      pattern: 'console\\.log',
      badExample: 'console.log("debug")',
      goodExample: 'logger.info("intentional")',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash, {
      enforceSmokeGate: true,
    });
    expect(result.rule).not.toBeNull();
    expect(result.rule!.goodExample).toBe('logger.info("intentional")');
  });

  it('rejects a rule that is missing goodExample (required for Pipeline 2/3)', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'No console.log',
      engine: 'regex',
      pattern: 'console\\.log',
      badExample: 'console.log("debug")',
      // goodExample absent — caller did not supply it and schema
      // layer was bypassed. Gate must still reject.
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash, {
      enforceSmokeGate: true,
    });
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('smoke gate');
    expect(result.rejectReason).toContain('missing goodExample');
  });

  it('honors goodExampleOverride so Pipeline 3 can reuse its Good snippet', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'No console.log',
      engine: 'regex',
      pattern: 'console\\.log',
      badExample: 'console.log("bad")',
      // No goodExample on parsed; caller supplies it via override.
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash, {
      enforceSmokeGate: true,
      goodExampleOverride: 'logger.info("good")',
    });
    expect(result.rule).not.toBeNull();
    expect(result.rule!.goodExample).toBe('logger.info("good")');
  });

  it('persists goodExample on the CompiledRule when the gate accepts', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'No debugger',
      engine: 'ast-grep',
      astGrepPattern: 'debugger',
      badExample: 'debugger;',
      goodExample: 'const x = 1;',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash, {
      enforceSmokeGate: true,
    });
    expect(result.rule).not.toBeNull();
    expect(result.rule!.goodExample).toBe('const x = 1;');
  });

  it('falls back to parsed.goodExample when goodExampleOverride is undefined', () => {
    // Pins the Pipeline 3 contract: the call site passes `undefined`
    // (not an empty string) when snippets.good is empty, so buildCompiledRule's
    // `options.goodExampleOverride ?? parsed.goodExample` correctly resolves
    // to the LLM-echoed value.
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'No console.log',
      engine: 'regex',
      pattern: 'console\\.log',
      badExample: 'console.log("bad")',
      goodExample: 'logger.info("from parsed")',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash, {
      enforceSmokeGate: true,
      goodExampleOverride: undefined,
    });
    expect(result.rule).not.toBeNull();
    expect(result.rule!.goodExample).toBe('logger.info("from parsed")');
  });

  it('rejects a whitespace-only goodExample with missing-goodexample (parity with schema refine)', () => {
    // Shield flagged on mmnto-ai/totem#1591: `if (!effectiveGoodExample)`
    // treats `'   '` as truthy, and runSmokeGate's early-return on
    // `trim().length === 0` then reports matched: false, so a
    // whitespace-only goodExample would otherwise pass the gate with
    // zero coverage. The `.trim().length > 0` guard closes the hole.
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'No console.log',
      engine: 'regex',
      pattern: 'console\\.log',
      badExample: 'console.log("bad")',
      goodExample: '   \t\n  ',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash, {
      enforceSmokeGate: true,
    });
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('missing goodExample');
  });

  it('rejects a whitespace-only badExample with missing-badexample (symmetric guard)', () => {
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'No console.log',
      engine: 'regex',
      pattern: 'console\\.log',
      badExample: '   \t\n  ',
      goodExample: 'logger.info("good")',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash, {
      enforceSmokeGate: true,
    });
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('missing badExample');
  });

  it('empty-string goodExampleOverride clobbers parsed.goodExample (the trap the Pipeline 3 guard exists to prevent)', () => {
    // Nullish coalescing (`??`) treats `''` as defined, so passing an
    // empty string override suppresses the parsed value. This test pins
    // that behavior so the Pipeline 3 call site's .length guard in
    // compile-lesson.ts (snippets.good.length > 0 ? ... : undefined)
    // stays load-bearing.
    const parsed: CompilerOutput = {
      compilable: true,
      message: 'No console.log',
      engine: 'regex',
      pattern: 'console\\.log',
      badExample: 'console.log("bad")',
      goodExample: 'logger.info("from parsed")',
    };
    const result = buildCompiledRule(parsed, lesson, existingByHash, {
      enforceSmokeGate: true,
      goodExampleOverride: '',
    });
    expect(result.rule).toBeNull();
    expect(result.rejectReason).toContain('missing goodExample');
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
      body: '**Pattern:** try { $$$BODY } catch ($ERR) {}\n**Engine:** ast-grep\n**Severity:** warning',
      hash: 'astgood1',
    };
    const result = buildManualRule(validLesson, existingByHash);
    expect(result.rule).not.toBeNull();
    expect(result.rule!.engine).toBe('ast-grep');
  });

  it('uses extracted **Message:** field over heading when present (#1265)', () => {
    // Pre-#1265, buildManualRule hardcoded `message: lesson.heading`. Pipeline 1
    // rules lost their rich body prose. Now the parser extracts the Message field
    // and buildManualRule prefers it over the heading fallback.
    const lessonWithMessage: LessonInput = {
      index: 5,
      heading: 'console-log',
      body: [
        '**Pattern:** console\\.log\\(',
        '**Engine:** regex',
        '**Severity:** warning',
        '**Message:** Use the structured logger (logger.info) instead of console.log to keep production output filterable.',
      ].join('\n'),
      hash: 'msg-override-1',
    };
    const result = buildManualRule(lessonWithMessage, existingByHash);
    expect(result.rule).not.toBeNull();
    expect(result.rule!.message).toBe(
      'Use the structured logger (logger.info) instead of console.log to keep production output filterable.',
    );
    expect(result.rule!.message).not.toBe('console-log');
  });

  it('falls back to heading when Message field is absent (backward compatible #1265)', () => {
    // Existing Pipeline 1 lessons that pre-date #1265 don't have a Message field.
    // buildManualRule must continue producing a rule with message === heading
    // for those lessons so existing compiled-rules.json output is byte-stable.
    const lessonWithoutMessage: LessonInput = {
      index: 6,
      heading: 'Direct env access',
      body: ['**Pattern:** process\\.env\\[', '**Engine:** regex', '**Severity:** warning'].join(
        '\n',
      ),
      hash: 'msg-fallback-1',
    };
    const result = buildManualRule(lessonWithoutMessage, existingByHash);
    expect(result.rule).not.toBeNull();
    expect(result.rule!.message).toBe('Direct env access');
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
            // mmnto/totem#1408: Pipeline 2 now requires a badExample that the
            // smoke gate can match. Every existing happy-path test here still
            // wants the rule to compile, so give the helper a known-good
            // snippet that matches the pattern.
            badExample: 'console.log("debug")',
            goodExample: '// placeholder\n',
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

  // ─── Smoke gate on Pipeline 2 (mmnto/totem#1408) ──

  it('Pipeline 2 rejects a rule whose LLM output omits badExample', async () => {
    // Post-ADR-088 (mmnto-ai/totem#1479): missing badExample short-circuits
    // to `status: 'skipped'` with reasonCode `'missing-badexample'` rather
    // than `'failed'`. The Layer 4 explicit-failure contract requires every
    // skipped lesson to carry a machine-readable reason; emitting `'failed'`
    // would drop the entry without a trace. No retry because the compiler
    // system prompt already requires the field (mmnto-ai/totem#1409) and
    // retrying won't teach the LLM to emit a field it just omitted.
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn().mockReturnValue({
        compilable: true,
        pattern: 'console\\.log',
        message: 'No console.log',
        engine: 'regex' as const,
        // No badExample — gate must reject
      }),
      runOrchestrator: vi.fn().mockResolvedValue('{"compilable": true}'),
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };
    const result = await compileLesson(lesson, 'system prompt', deps);
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reasonCode).toBe('missing-badexample');
      expect(result.reason).toContain('missing badExample');
    }
    expect(deps.runOrchestrator).toHaveBeenCalledTimes(1);
    expect(deps.callbacks!.onWarn).toHaveBeenCalledWith(
      lesson.heading,
      expect.stringContaining('smoke gate'),
    );
  });

  it('Pipeline 2 accepts a rule whose LLM output supplies a matching badExample', async () => {
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn().mockReturnValue({
        compilable: true,
        pattern: 'console\\.log',
        message: 'No console.log',
        engine: 'regex' as const,
        badExample: 'console.log("debug")',
        goodExample: '// placeholder\n',
      }),
      runOrchestrator: vi.fn().mockResolvedValue('{"compilable": true}'),
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };
    const result = await compileLesson(lesson, 'system prompt', deps);
    expect(result.status).toBe('compiled');
  });

  // ─── Phase 3 systemPrompt threading (mmnto/totem#1291) ─────

  it('passes compilerPrompt as the systemPrompt argument (Phase 3 cache target)', async () => {
    const deps = makeDeps('{"compilable": true}');
    await compileLesson(lesson, 'COMPILER_PROMPT_50KB', deps);

    const callArgs = (deps.runOrchestrator as ReturnType<typeof vi.fn>).mock.calls[0];
    const userPrompt = callArgs[0] as string;
    const systemPrompt = callArgs[1] as string | undefined;

    // The compiler template MUST land on the second arg so the orchestrator
    // can mark it as a cache target. If it leaks into the user prompt, the
    // cache directive lands on per-lesson content and never hits.
    expect(systemPrompt).toBe('COMPILER_PROMPT_50KB');
    expect(userPrompt).not.toContain('COMPILER_PROMPT_50KB');
    // The user prompt still carries the lesson markers
    expect(userPrompt).toContain('Lesson to Compile');
    expect(userPrompt).toContain(lesson.heading);
  });

  it('keeps systemPrompt stable across calls so the cache key is identical', async () => {
    // The whole point of Phase 3: bulk-compile sends the same systemPrompt
    // bytes for every lesson, so the second + Nth call hit the cache. Verify
    // that two compileLesson calls with the same compilerPrompt result in two
    // identical systemPrompt arguments to runOrchestrator.
    const deps = makeDeps('{"compilable": true}');

    const lessonA: LessonInput = {
      index: 0,
      heading: 'Lesson A',
      body: 'body of lesson A',
      hash: 'hashA',
    };
    const lessonB: LessonInput = {
      index: 1,
      heading: 'Lesson B',
      body: 'body of lesson B',
      hash: 'hashB',
    };

    await compileLesson(lessonA, 'STABLE_COMPILER_PROMPT', deps);
    await compileLesson(lessonB, 'STABLE_COMPILER_PROMPT', deps);

    const callA = (deps.runOrchestrator as ReturnType<typeof vi.fn>).mock.calls[0];
    const callB = (deps.runOrchestrator as ReturnType<typeof vi.fn>).mock.calls[1];

    // System prompts must be byte-identical. The user prompts differ.
    expect(callA[1]).toBe('STABLE_COMPILER_PROMPT');
    expect(callB[1]).toBe('STABLE_COMPILER_PROMPT');
    expect(callA[1]).toBe(callB[1]);
    expect(callA[0]).not.toBe(callB[0]);
  });

  it('threads telemetryPrefix into the Pipeline 2 system prompt (mmnto/totem#1131)', async () => {
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn().mockReturnValue({
        compilable: true,
        pattern: 'console\\.log',
        message: 'No console.log',
        engine: 'regex' as const,
        badExample: 'console.log("debug")',
        goodExample: '// placeholder\n',
      }),
      runOrchestrator: vi.fn().mockResolvedValue('{"compilable": true}'),
      existingByHash: new Map(),
      telemetryPrefix:
        'This rule was flagged because 60% of its matches occur in non-code contexts (strings: 3, comments: 0, regex literals: 0). Please prefer an ast-grep structural pattern.',
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };
    const result = await compileLesson(lesson, 'BASE_SYSTEM_PROMPT', deps);
    expect(result.status).toBe('compiled');
    expect(deps.runOrchestrator).toHaveBeenCalledTimes(1);

    // mmnto/totem#1291 Phase 3: compilerPrompt is now passed as the SECOND
    // argument (systemPrompt) so the orchestrator can mark it as a cache
    // target. The first argument is the per-lesson user prompt, which carries
    // the telemetry directive (per-rule, not cacheable) and the lesson body.
    const callArgs = (deps.runOrchestrator as ReturnType<typeof vi.fn>).mock.calls[0];
    const sentUserPrompt = callArgs[0] as string;
    const sentSystemPrompt = callArgs[1] as string | undefined;

    expect(sentSystemPrompt).toBe('BASE_SYSTEM_PROMPT');
    expect(sentUserPrompt).not.toContain('BASE_SYSTEM_PROMPT');
    expect(sentUserPrompt).toContain('Telemetry-Driven Refinement Directive');
    expect(sentUserPrompt).toContain('60% of its matches occur in non-code contexts');

    // Order check inside the user prompt: directive < lesson
    const directiveIdx = sentUserPrompt.indexOf('Telemetry-Driven Refinement Directive');
    const lessonIdx = sentUserPrompt.indexOf('Lesson to Compile');
    expect(directiveIdx >= 0).toBe(true);
    expect(lessonIdx > directiveIdx).toBe(true);
  });

  it('omits the telemetry directive when telemetryPrefix is undefined', async () => {
    const deps = makeDeps('{"compilable": true}');
    await compileLesson(lesson, 'BASE_SYSTEM_PROMPT', deps);
    const callArgs = (deps.runOrchestrator as ReturnType<typeof vi.fn>).mock.calls[0];
    const sentUserPrompt = callArgs[0] as string;
    const sentSystemPrompt = callArgs[1] as string | undefined;
    expect(sentUserPrompt).not.toContain('Telemetry-Driven Refinement Directive');
    // Pipeline 2 still threads the compilerPrompt as systemPrompt even when
    // telemetry is absent — this is the cache-eligible bulk-compile path.
    expect(sentSystemPrompt).toBe('BASE_SYSTEM_PROMPT');
    expect(sentUserPrompt).not.toContain('BASE_SYSTEM_PROMPT');
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

  it('returns skipped with pattern-syntax-invalid when parseCompilerResponse returns null', async () => {
    // mmnto-ai/totem#1481: the Pipeline 2 parse-failure exit route was
    // upgraded from 'failed' to 'skipped' with a machine-readable
    // reasonCode so ADR-088 Layer 4 telemetry sees every LLM-output
    // parse error rather than losing them to the 'failed' bucket.
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn().mockReturnValue(null),
      runOrchestrator: vi.fn().mockResolvedValue('bad response'),
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };
    const result = await compileLesson(lesson, 'system prompt', deps);
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reasonCode).toBe('pattern-syntax-invalid');
    }
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

  it('routes LLM context-required signal to reasonCode context-required (Pipeline 2, mmnto-ai/totem#1598)', async () => {
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn().mockReturnValue({
        compilable: false,
        reasonCode: 'context-required',
        reason:
          'Lesson constrains scope to an enclosing function ("inside _process") the pattern cannot express.',
      }),
      runOrchestrator: vi.fn().mockResolvedValue('response'),
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };
    const result = await compileLesson(lesson, 'system prompt', deps);
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reasonCode).toBe('context-required');
    }
  });

  it('routes LLM semantic-analysis-required signal to reasonCode semantic-analysis-required (Pipeline 2, mmnto-ai/totem#1634)', async () => {
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn().mockReturnValue({
        compilable: false,
        reasonCode: 'semantic-analysis-required',
        reason:
          'Lesson requires closure-body AST analysis (captured-float assignment inside par_iter_mut().for_each).',
      }),
      runOrchestrator: vi.fn().mockResolvedValue('response'),
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };
    const result = await compileLesson(lesson, 'system prompt', deps);
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reasonCode).toBe('semantic-analysis-required');
    }
  });

  it('falls back to out-of-scope when LLM omits reasonCode on a non-compilable response', async () => {
    // Backward compatibility: LLM responses that mark compilable:false without
    // the reasonCode field continue to route through the generic out-of-scope
    // exit path. Only the narrow context-required signal opts into the new
    // classifier bucket.
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
      expect(result.reasonCode).toBe('out-of-scope');
    }
  });

  it('anti-lazy: compiles a structurally-capturable scope-sensitive lesson when LLM supplies a pattern', async () => {
    // The context-required escape hatch (mmnto-ai/totem#1598) risks lazy-
    // rejection of lessons whose scope CAN be captured structurally (fileGlobs,
    // kind-scoped ast-grep, etc.). Lock in that a valid compilable response
    // with a pattern still compiles even when the lesson body literally
    // contains the escape-hatch trigger keywords ("inside", "only for new").
    // The compiler routing must trust `compilable:true` and must not scan the
    // lesson body for escape-hatch triggers. CR PR mmnto-ai/totem#1639 round-1
    // flagged that a fixture without scope markers left this invariant
    // untested; the explicit scope-sensitive body closes that gap.
    const scopeSensitiveLesson: LessonInput = {
      index: 0,
      heading: 'Use logger inside request handlers (anti-lazy #1598)',
      body: 'Always use logger inside request handlers; only for new handlers, console.log is forbidden. The scope here IS expressible structurally via fileGlobs, so the LLM must compile despite the "inside" and "only for new" trigger keywords in the body.',
      hash: 'antilazy1598scopesensitive',
    };
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn().mockReturnValue({
        compilable: true,
        pattern: 'console\\.log',
        message: 'Use logger inside request handlers instead of console.log',
        engine: 'regex' as const,
        badExample: 'console.log("debug")',
        goodExample: 'logger.info("debug")',
      }),
      runOrchestrator: vi.fn().mockResolvedValue('response'),
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };
    const result = await compileLesson(scopeSensitiveLesson, 'system prompt', deps);
    expect(result.status).toBe('compiled');
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
            badExample: 'console.log("debug")',
            goodExample: '// placeholder\n',
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

// ─── compileLesson Pipeline 3 ─────────────────────────

describe('compileLesson Pipeline 3 (Bad/Good snippets)', () => {
  const pipeline3Lesson: LessonInput = {
    index: 0,
    heading: 'Use logger not console.log',
    body: [
      '**Bad:**',
      '```ts',
      'console.log("debug");',
      '```',
      '',
      '**Good:**',
      '```ts',
      'logger.info("debug");',
      '```',
    ].join('\n'),
    hash: 'p3hash1',
  };

  it('compiles when Bad/Good snippets present and LLM returns valid pattern', async () => {
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn().mockReturnValue({
        compilable: true,
        pattern: 'console\\.log',
        message: 'Use logger instead of console.log',
        engine: 'regex' as const,
      }),
      runOrchestrator: vi.fn().mockResolvedValue('{"compilable": true}'),
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };
    const result = await compileLesson(pipeline3Lesson, 'system prompt', deps);
    expect(result.status).toBe('compiled');
    expect(deps.runOrchestrator).toHaveBeenCalled();
    // mmnto/totem#1291 Phase 3: Pipeline 3 markers (Bad/Good code, lesson body)
    // live in the user prompt; the base prompt (Pipeline 3 template OR
    // compilerPrompt fallback) is passed as the second-arg systemPrompt so the
    // orchestrator can mark it as a cache target.
    const callArgs = (deps.runOrchestrator as ReturnType<typeof vi.fn>).mock.calls[0];
    const userPrompt = callArgs[0] as string;
    const systemPrompt = callArgs[1] as string | undefined;
    expect(userPrompt).toContain('Pipeline 3');
    expect(userPrompt).toContain('Bad Code');
    expect(userPrompt).toContain('Good Code');
    // Falls back to compilerPrompt when no pipeline3Prompt was provided
    expect(systemPrompt).toBe('system prompt');
  });

  it('returns skipped when LLM says not compilable', async () => {
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn().mockReturnValue({
        compilable: false,
        reason: 'Not a code pattern',
      }),
      runOrchestrator: vi.fn().mockResolvedValue('response'),
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };
    const result = await compileLesson(pipeline3Lesson, 'system prompt', deps);
    expect(result.status).toBe('skipped');
    expect(deps.callbacks!.onDim).toHaveBeenCalledWith(
      pipeline3Lesson.heading,
      expect.stringContaining('Pipeline 3'),
    );
  });

  it('routes LLM context-required signal to reasonCode context-required (Pipeline 3, mmnto-ai/totem#1598)', async () => {
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn().mockReturnValue({
        compilable: false,
        reasonCode: 'context-required',
        reason:
          'Lesson constrains scope to "only for NEW proposal IDs"; pattern cannot distinguish new from existing.',
      }),
      runOrchestrator: vi.fn().mockResolvedValue('response'),
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };
    const result = await compileLesson(pipeline3Lesson, 'system prompt', deps);
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reasonCode).toBe('context-required');
    }
  });

  it('routes LLM semantic-analysis-required signal to reasonCode semantic-analysis-required (Pipeline 3, mmnto-ai/totem#1634)', async () => {
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn().mockReturnValue({
        compilable: false,
        reasonCode: 'semantic-analysis-required',
        reason:
          'Multi-file contract: rule applies cross-system; single-lesson-body pattern cannot express the multi-file hazard.',
      }),
      runOrchestrator: vi.fn().mockResolvedValue('response'),
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };
    const result = await compileLesson(pipeline3Lesson, 'system prompt', deps);
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reasonCode).toBe('semantic-analysis-required');
    }
  });

  it('rejects at the smoke gate when the pattern does not match the Bad snippet (mmnto/totem#1408)', async () => {
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn().mockReturnValue({
        compilable: true,
        // Pattern matches neither Bad nor Good - smoke gate catches this
        // before the old self-verification step ever runs. Pre-#1408 the
        // test asserted on the self-verification message; post-#1408 the
        // smoke gate is the earlier (and stricter) filter. mmnto-ai/totem#1481
        // further promotes the smoke-gate zero-match branch from 'failed'
        // to 'skipped' with reasonCode 'pattern-syntax-invalid' so Layer 4
        // telemetry gets a machine-readable entry.
        pattern: 'this_matches_nothing_at_all',
        message: 'Wrong pattern',
        engine: 'regex' as const,
      }),
      runOrchestrator: vi.fn().mockResolvedValue('response'),
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };
    const result = await compileLesson(pipeline3Lesson, 'system prompt', deps);
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reasonCode).toBe('pattern-zero-match');
      expect(result.reason).toContain('smoke gate');
    }
    expect(deps.callbacks!.onWarn).toHaveBeenCalledWith(
      pipeline3Lesson.heading,
      expect.stringContaining('smoke gate'),
    );
  });

  it('passes self-verification when pattern matches Bad but not Good', async () => {
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn().mockReturnValue({
        compilable: true,
        pattern: 'console\\.log',
        message: 'Use logger instead of console.log',
        engine: 'regex' as const,
      }),
      runOrchestrator: vi.fn().mockResolvedValue('response'),
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };
    const result = await compileLesson(pipeline3Lesson, 'system prompt', deps);
    expect(result.status).toBe('compiled');
    if (result.status === 'compiled') {
      expect(result.rule.pattern).toBe('console\\.log');
    }
  });

  it('Pipeline 1 takes priority over Pipeline 3', async () => {
    const bothLesson: LessonInput = {
      index: 0,
      heading: 'Lesson with both Pattern and Bad/Good',
      body: [
        '**Pattern:** console\\.log',
        '**Engine:** regex',
        '**Severity:** warning',
        '**Scope:** **/*.ts',
        '',
        '**Bad:**',
        '```ts',
        'console.log("bad");',
        '```',
        '',
        '**Good:**',
        '```ts',
        'logger.info("good");',
        '```',
      ].join('\n'),
      hash: 'bothHash',
    };
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn(),
      runOrchestrator: vi.fn(),
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };
    const result = await compileLesson(bothLesson, 'system prompt', deps);
    expect(result.status).toBe('compiled');
    // Pipeline 1 should handle it — no LLM call
    expect(deps.runOrchestrator).not.toHaveBeenCalled();
  });

  it('returns noop when orchestrator returns null', async () => {
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn(),
      runOrchestrator: vi.fn().mockResolvedValue(undefined),
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };
    const result = await compileLesson(pipeline3Lesson, 'system prompt', deps);
    expect(result.status).toBe('noop');
  });

  it('returns skipped with pattern-syntax-invalid when Pipeline 3 LLM response cannot be parsed', async () => {
    // mmnto-ai/totem#1481: Pipeline 3 parse-failure now lands in the ledger
    // with a machine-readable reasonCode per ADR-088 Layer 4.
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn().mockReturnValue(null),
      runOrchestrator: vi.fn().mockResolvedValue('bad response'),
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };
    const result = await compileLesson(pipeline3Lesson, 'system prompt', deps);
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reasonCode).toBe('pattern-syntax-invalid');
    }
    expect(deps.callbacks!.onWarn).toHaveBeenCalledWith(
      pipeline3Lesson.heading,
      expect.stringContaining('Pipeline 3'),
    );
  });
});

// ─── Pipeline 2 Layer 3 verify-retry loop (ADR-088, mmnto-ai/totem#1479) ──

describe('compileLesson Pipeline 2 verify-retry', () => {
  const lesson: LessonInput = {
    index: 0,
    heading: 'No console.log in production code',
    body: 'Do not use console.log in production.',
    hash: 'h-retry',
  };

  it('retries after smoke-gate zero-match and succeeds when a later attempt produces a matching pattern', async () => {
    // Attempt 1 returns a pattern that does not match the badExample.
    // Attempt 2 returns a pattern that does. Expected outcome: compiled,
    // two orchestrator calls, retry feedback threaded into attempt 2.
    const parseMock = vi
      .fn()
      .mockReturnValueOnce({
        compilable: true,
        pattern: 'never_matches_xyz',
        message: 'No console.log',
        engine: 'regex' as const,
        badExample: 'console.log("debug")',
        goodExample: '// placeholder\n',
      })
      .mockReturnValueOnce({
        compilable: true,
        pattern: 'console\\.log',
        message: 'No console.log',
        engine: 'regex' as const,
        badExample: 'console.log("debug")',
        goodExample: '// placeholder\n',
      });
    const orchestratorMock = vi
      .fn()
      .mockResolvedValueOnce('attempt-1')
      .mockResolvedValueOnce('attempt-2');
    const deps: CompileLessonDeps = {
      parseCompilerResponse: parseMock,
      runOrchestrator: orchestratorMock,
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };

    const result = await compileLesson(lesson, 'system prompt', deps);
    expect(result.status).toBe('compiled');
    expect(orchestratorMock).toHaveBeenCalledTimes(2);

    // The retry-directive must appear in the user prompt of attempt 2 and
    // must not appear in attempt 1. The directive carries the failed
    // pattern and the badExample so the LLM can correct its output.
    const userPrompt1 = orchestratorMock.mock.calls[0]![0] as string;
    const userPrompt2 = orchestratorMock.mock.calls[1]![0] as string;
    expect(userPrompt1).not.toContain('Previous Attempt Failed Verification');
    expect(userPrompt2).toContain('Previous Attempt Failed Verification');
    expect(userPrompt2).toContain('never_matches_xyz');
    expect(userPrompt2).toContain('console.log("debug")');
  });

  it('returns skipped with reasonCode verify-retry-exhausted after MAX_VERIFY_ATTEMPTS failures', async () => {
    // Every attempt returns a pattern that does not match the badExample.
    // Expected outcome: skipped, reasonCode 'verify-retry-exhausted',
    // exactly 3 orchestrator calls.
    const parseMock = vi.fn().mockReturnValue({
      compilable: true,
      pattern: 'never_matches_xyz',
      message: 'No console.log',
      engine: 'regex' as const,
      badExample: 'console.log("debug")',
      goodExample: '// placeholder\n',
    });
    const orchestratorMock = vi.fn().mockResolvedValue('always-bad');
    const deps: CompileLessonDeps = {
      parseCompilerResponse: parseMock,
      runOrchestrator: orchestratorMock,
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };

    const result = await compileLesson(lesson, 'system prompt', deps);
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reasonCode).toBe('verify-retry-exhausted');
      expect(result.reason).toContain('Verify retry exhausted after 3 attempts');
    }
    expect(orchestratorMock).toHaveBeenCalledTimes(3);
  });

  it('rejects a security-context rule without retry when verify fails', async () => {
    // securityContext: true + zero-match on attempt 1. Zero tolerance per
    // ADR-088 Decision 3 means no retry. Expected outcome: skipped,
    // reasonCode 'security-rule-rejected', exactly 1 orchestrator call.
    //
    // mmnto-ai/totem#1480 added an upfront Example-Hit short-circuit for
    // security context, so this test uses a lesson body that includes a
    // non-empty Example Hit block. That keeps the test exercising the
    // verify-path security branch, not the new no-example-hit short-circuit.
    const securityLesson: LessonInput = {
      index: 0,
      heading: 'No shell injection in spawn',
      body: [
        'Do not pass untrusted input to spawn with shell: true.',
        '**Example Hit:** spawn("sh", ["-c", userInput])',
      ].join('\n'),
      hash: 'h-security-verify',
    };
    const parseMock = vi.fn().mockReturnValue({
      compilable: true,
      pattern: 'never_matches_xyz',
      message: 'Security rule that failed to verify',
      engine: 'regex' as const,
      badExample: 'spawn("sh", ["-c", userInput])',
    });
    const orchestratorMock = vi.fn().mockResolvedValue('security-bad');
    const deps: CompileLessonDeps = {
      parseCompilerResponse: parseMock,
      runOrchestrator: orchestratorMock,
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
      securityContext: true,
    };

    const result = await compileLesson(securityLesson, 'system prompt', deps);
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reasonCode).toBe('security-rule-rejected');
      expect(result.reason).toContain('zero matches');
    }
    expect(orchestratorMock).toHaveBeenCalledTimes(1);
    expect(deps.callbacks!.onWarn).toHaveBeenCalledWith(
      securityLesson.heading,
      expect.stringContaining('Security rule rejected on verify failure'),
    );
  });

  it('does not retry when the smoke-gate rejection is missing badExample (short-circuit to skipped)', async () => {
    // Missing badExample is a structural-output failure. Retrying cannot
    // teach the LLM to emit a field it just omitted. Expected outcome:
    // skipped, reasonCode 'missing-badexample', exactly 1 orchestrator
    // call. Same contract exercised by the pre-retry test above but
    // explicitly scoped to the retry-loop branch.
    const parseMock = vi.fn().mockReturnValue({
      compilable: true,
      pattern: 'console\\.log',
      message: 'No console.log',
      engine: 'regex' as const,
      // no badExample
    });
    const orchestratorMock = vi.fn().mockResolvedValue('no-badexample');
    const deps: CompileLessonDeps = {
      parseCompilerResponse: parseMock,
      runOrchestrator: orchestratorMock,
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };

    const result = await compileLesson(lesson, 'system prompt', deps);
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reasonCode).toBe('missing-badexample');
    }
    expect(orchestratorMock).toHaveBeenCalledTimes(1);
  });

  it('propagates non-compilable LLM verdict with reasonCode out-of-scope', async () => {
    // Conceptual/architectural lessons that the LLM classifies as
    // non-compilable. ADR-088 Layer 4 requires a machine-readable reason.
    // mmnto-ai/totem#1481 renamed `'non-compilable'` to `'out-of-scope'`
    // to align the internal reason code with the persisted enum.
    const parseMock = vi.fn().mockReturnValue({
      compilable: false,
      reason: 'Architectural principle, not a pattern.',
    });
    const orchestratorMock = vi.fn().mockResolvedValue('{"compilable": false}');
    const deps: CompileLessonDeps = {
      parseCompilerResponse: parseMock,
      runOrchestrator: orchestratorMock,
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };

    const result = await compileLesson(lesson, 'system prompt', deps);
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reasonCode).toBe('out-of-scope');
      expect(result.reason).toBe('Architectural principle, not a pattern.');
    }
    expect(orchestratorMock).toHaveBeenCalledTimes(1);
  });

  it('retries when Example Hit/Miss verification fails and succeeds on a later attempt', async () => {
    // ADR-088 AC (mmnto-ai/totem#1479): "verifies every LLM-generated pattern
    // against the lesson's Example Hit block. Zero-match triggers a retry."
    // Attempt 1 produces a pattern that passes the smoke gate (matches its
    // own badExample) but does NOT match the lesson's Example Hit.
    // verifyRuleExamples fails; the retry path fires. Attempt 2 returns a
    // pattern that matches both the badExample and the Example Hit.
    const lessonWithExample: LessonInput = {
      index: 0,
      heading: 'No console.log in production',
      body: 'Do not use console.log in production.\n**Example Hit:** console.log(x)',
      hash: 'h-retry-verify',
    };
    const parseMock = vi
      .fn()
      .mockReturnValueOnce({
        compilable: true,
        pattern: 'zzz_only_matches_itself',
        message: 'No console.log',
        engine: 'regex' as const,
        badExample: 'zzz_only_matches_itself',
        goodExample: '// placeholder\n',
      })
      .mockReturnValueOnce({
        compilable: true,
        pattern: 'console\\.log',
        message: 'No console.log',
        engine: 'regex' as const,
        badExample: 'console.log("x")',
        goodExample: '// placeholder\n',
      });
    const orchestratorMock = vi
      .fn()
      .mockResolvedValueOnce('attempt-1')
      .mockResolvedValueOnce('attempt-2');
    const deps: CompileLessonDeps = {
      parseCompilerResponse: parseMock,
      runOrchestrator: orchestratorMock,
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };

    const result = await compileLesson(lessonWithExample, 'system prompt', deps);
    expect(result.status).toBe('compiled');
    expect(orchestratorMock).toHaveBeenCalledTimes(2);

    // The retry directive must reflect the Example Hit failure (generic
    // wording so it can serve both smoke-gate and verify failures), it
    // must carry the prior pattern so the LLM sees what it produced, and
    // — when the failure source is verifyRuleExamples — the "Code
    // snippet the pattern had to match" field must show the missed
    // Example Hit line, not the LLM's own badExample (which the pattern
    // did match, since the smoke gate passed).
    const userPrompt2 = orchestratorMock.mock.calls[1]![0] as string;
    expect(userPrompt2).toContain('Previous Attempt Failed Verification');
    expect(userPrompt2).toContain('zzz_only_matches_itself'); // pattern field
    expect(userPrompt2).toContain('console.log(x)'); // missed Example Hit
  });

  it('exhausts retries when Example Hit/Miss verification fails on every attempt', async () => {
    // Same Example Hit lesson as above, but the LLM never produces a
    // pattern that matches the lesson's Example Hit. Three attempts, each
    // passing the smoke gate but failing verifyRuleExamples. Expected
    // outcome: skipped, reasonCode 'verify-retry-exhausted'.
    const lessonWithExample: LessonInput = {
      index: 0,
      heading: 'No console.log in production',
      body: 'Do not use console.log in production.\n**Example Hit:** console.log(x)',
      hash: 'h-verify-exhaust',
    };
    const parseMock = vi.fn().mockReturnValue({
      compilable: true,
      pattern: 'zzz_only_matches_itself',
      message: 'No console.log',
      engine: 'regex' as const,
      badExample: 'zzz_only_matches_itself',
      goodExample: '// placeholder\n',
    });
    const orchestratorMock = vi.fn().mockResolvedValue('always-misses');
    const deps: CompileLessonDeps = {
      parseCompilerResponse: parseMock,
      runOrchestrator: orchestratorMock,
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };

    const result = await compileLesson(lessonWithExample, 'system prompt', deps);
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reasonCode).toBe('verify-retry-exhausted');
    }
    expect(orchestratorMock).toHaveBeenCalledTimes(3);
  });

  it('returns skipped with pattern-syntax-invalid when the LLM emits an invalid regex (validator rejection)', async () => {
    // Validator-level rejection (ADR-088 Layer 4, mmnto-ai/totem#1481).
    // Retrying an invalid regex produces more invalid regexes and wastes
    // tokens, so no retry fires. Pre-#1481 this returned 'failed'; post-
    // #1481 it returns 'skipped' with reasonCode 'pattern-syntax-invalid'
    // so the ledger carries a machine-readable record per the Layer 4
    // explicit-failure contract.
    const parseMock = vi.fn().mockReturnValue({
      compilable: true,
      pattern: '[unclosed-bracket-class',
      message: 'Invalid regex test',
      engine: 'regex' as const,
      badExample: 'any string',
      goodExample: '// placeholder\n',
    });
    const orchestratorMock = vi.fn().mockResolvedValue('invalid-regex-output');
    const deps: CompileLessonDeps = {
      parseCompilerResponse: parseMock,
      runOrchestrator: orchestratorMock,
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };

    const result = await compileLesson(lesson, 'system prompt', deps);
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reasonCode).toBe('pattern-syntax-invalid');
      expect(result.reason).toContain('Rejected regex');
    }
    expect(orchestratorMock).toHaveBeenCalledTimes(1);
  });
});

// ─── ADR-088 Phase 1 Layer 3: unverified flag (mmnto-ai/totem#1480) ──

describe('compileLesson unverified flag', () => {
  const lessonWithoutExampleHit: LessonInput = {
    index: 0,
    heading: 'Use err not error in catch blocks',
    body: 'Always use `err` as the variable name in catch blocks.',
    hash: 'h-no-example',
  };

  const lessonWithExampleHit: LessonInput = {
    index: 0,
    heading: 'No console.log in production',
    body: 'Do not ship console.log.\n**Example Hit:** console.log(x)',
    hash: 'h-with-example',
  };

  it('flags non-security Pipeline 2 rules as unverified when the lesson has no Example Hit', async () => {
    // Invariant #2: non-security rule without Example Hit ships with
    // `unverified: true`. Severity passes through from the LLM output —
    // no warning-downgrade happens here. A doctor advisory for
    // `unverified: true` + `severity: 'error'` combos ships with #1483.
    const parseMock = vi.fn().mockReturnValue({
      compilable: true,
      pattern: 'console\\.log',
      message: 'No console.log',
      engine: 'regex' as const,
      severity: 'error' as const,
      badExample: 'console.log(x)',
      goodExample: '// placeholder\n',
    });
    const orchestratorMock = vi.fn().mockResolvedValue('{"compilable": true}');
    const deps: CompileLessonDeps = {
      parseCompilerResponse: parseMock,
      runOrchestrator: orchestratorMock,
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };

    const result = await compileLesson(lessonWithoutExampleHit, 'system prompt', deps);
    expect(result.status).toBe('compiled');
    if (result.status === 'compiled') {
      expect(result.rule.unverified).toBe(true);
      expect(result.rule.severity).toBe('error');
    }
  });

  it('applies the general omitted-severity default on an unverified rule', async () => {
    // Companion to the severity-pass-through invariant. When the LLM emits
    // no severity, buildCompiledRule applies the general `'warning'`
    // default (compile-lesson.ts line ~299: `parsed.severity ?? 'warning'`).
    // That default is not ADR-088 specific: it fires for any rule without
    // an emitted severity, unverified or not. Pinning it here guards
    // against a future ADR-088 change that tries to force severity in
    // addition to the existing default.
    const parseMock = vi.fn().mockReturnValue({
      compilable: true,
      pattern: 'console\\.log',
      message: 'No console.log',
      engine: 'regex' as const,
      badExample: 'console.log(x)',
      goodExample: '// placeholder\n',
    });
    const orchestratorMock = vi.fn().mockResolvedValue('{"compilable": true}');
    const deps: CompileLessonDeps = {
      parseCompilerResponse: parseMock,
      runOrchestrator: orchestratorMock,
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };

    const result = await compileLesson(lessonWithoutExampleHit, 'system prompt', deps);
    expect(result.status).toBe('compiled');
    if (result.status === 'compiled') {
      expect(result.rule.unverified).toBe(true);
      expect(result.rule.severity).toBe('warning');
    }
  });

  it('ships Pipeline 2 rules as unverified: true even when the lesson carries a non-empty Example Hit (ADR-089 zero-trust default, mmnto-ai/totem#1581)', async () => {
    // Pre-#1581 invariant: presence of Example Hit produced
    // unverified: undefined. Post-#1581: LLM-generated rules (Pipeline 2
    // and Pipeline 3) always ship unverified: true regardless of Example
    // Hit presence. The LLM cannot self-certify structural invariants;
    // Example Hit/Miss is an LLM-produced artifact of the compile process,
    // not a human sign-off. Activation requires `totem rule promote
    // <hash>` or the ADR-091 Stage 4 Codebase Verifier in 1.16.0.
    // Pipeline 1 (manual) keeps its pre-#1581 conditional semantics; see
    // the Pipeline 1 test below.
    const parseMock = vi.fn().mockReturnValue({
      compilable: true,
      pattern: 'console\\.log',
      message: 'No console.log',
      engine: 'regex' as const,
      badExample: 'console.log(x)',
      goodExample: '// placeholder\n',
    });
    const orchestratorMock = vi.fn().mockResolvedValue('{"compilable": true}');
    const deps: CompileLessonDeps = {
      parseCompilerResponse: parseMock,
      runOrchestrator: orchestratorMock,
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };

    const result = await compileLesson(lessonWithExampleHit, 'system prompt', deps);
    expect(result.status).toBe('compiled');
    if (result.status === 'compiled') {
      expect(result.rule.unverified).toBe(true);
    }
  });

  it('treats an Example Hit that is whitespace-only as absent for the unverified flag', async () => {
    // Edge case from spec: `**Example Hit:**   ` (whitespace-only value) is
    // treated as no ground truth for the `unverified` signal. `trim()` on
    // every extracted line before counting guards against false-negatives
    // on whitespace-only examples. (The existing verify step still runs
    // against whatever extractRuleExamples returns, so the test pattern
    // matches the empty string to avoid tangling the test with verify
    // semantics — scope is the unverified flag only.)
    const lessonEmptyExample: LessonInput = {
      index: 0,
      heading: 'Edge case lesson',
      body: 'Body text.\n**Example Hit:**   ',
      hash: 'h-empty-example',
    };
    const parseMock = vi.fn().mockReturnValue({
      compilable: true,
      // Pattern that matches both the trimmed-empty Example Hit (via
      // `^$`) AND the badExample "anything" (via `\banything\b`) so
      // verifyRuleExamples passes without interference. The goodExample
      // `// placeholder` is constructed to not satisfy either alternative
      // so the mmnto-ai/totem#1580 over-matching check also passes.
      // No trailing newline on goodExample so the line-split doesn't
      // produce an empty trailing line that would match `^$`.
      pattern: '^$|\\banything\\b',
      message: 'msg',
      engine: 'regex' as const,
      badExample: 'anything',
      goodExample: '// placeholder',
    });
    const orchestratorMock = vi.fn().mockResolvedValue('{"compilable": true}');
    const deps: CompileLessonDeps = {
      parseCompilerResponse: parseMock,
      runOrchestrator: orchestratorMock,
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };

    const result = await compileLesson(lessonEmptyExample, 'system prompt', deps);
    expect(result.status).toBe('compiled');
    if (result.status === 'compiled') {
      expect(result.rule.unverified).toBe(true);
    }
  });

  it('rejects security-context lessons that lack an Example Hit with security-rule-rejected', async () => {
    // Invariant #3: security-context lesson without Example Hit produces
    // no rule; ledger entry carries reasonCode 'security-rule-rejected'.
    // No orchestrator call fires (short-circuit before Pipeline 2).
    const orchestratorMock = vi.fn();
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn(),
      runOrchestrator: orchestratorMock,
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
      securityContext: true,
    };

    const result = await compileLesson(lessonWithoutExampleHit, 'system prompt', deps);
    expect(result.status).toBe('skipped');
    if (result.status === 'skipped') {
      expect(result.reasonCode).toBe('security-rule-rejected');
      expect(result.reason).toContain('Example Hit');
    }
    expect(orchestratorMock).not.toHaveBeenCalled();
  });

  it('flags Pipeline 1 manual rules as unverified when the lesson has no Example Hit', async () => {
    // Pipeline 1 consistency (design doc Open Question 2, resolution (a)):
    // manual rules authored without an Example Hit ship unverified too.
    // The #1414 backfill sweep will eliminate this population eventually.
    const manualLessonNoExample: LessonInput = {
      index: 0,
      heading: 'No console.log in production',
      body: '**Pattern:** `console\\.log`\n**Engine:** regex\n**Severity:** warning\n**Scope:** **/*.ts',
      hash: 'h-manual-no-example',
    };
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn(),
      runOrchestrator: vi.fn(),
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };

    const result = await compileLesson(manualLessonNoExample, 'system prompt', deps);
    expect(result.status).toBe('compiled');
    if (result.status === 'compiled') {
      expect(result.rule.unverified).toBe(true);
    }
    expect(deps.runOrchestrator).not.toHaveBeenCalled();
  });
});

// ─── ADR-088 Decision 3: security-context signal (mmnto-ai/totem#1480) ──

describe('isSecurityContext', () => {
  // Covers both signals the helper accepts. The `deps.securityContext`
  // branch is exercised end-to-end by compileLesson tests above; the
  // `rule.immutable === true` branch is defense-in-depth for pack-merged
  // rules (ADR-089) and cannot reach compileLesson's public surface today
  // because CompilerOutput has no immutable field and the manual pattern
  // parser does not parse `**Immutable:**`. Unit tests on the helper lock
  // both signals so a future CompilerOutput or parser change cannot drop
  // the rule-based branch silently.

  const baseDeps: CompileLessonDeps = {
    parseCompilerResponse: vi.fn(),
    runOrchestrator: vi.fn(),
    existingByHash: new Map(),
  };

  it('returns true when deps.securityContext is true', () => {
    expect(isSecurityContext({ ...baseDeps, securityContext: true }, null)).toBe(true);
  });

  it('returns true when the built rule carries immutable: true', () => {
    expect(isSecurityContext(baseDeps, { immutable: true })).toBe(true);
  });

  it('returns true when both signals are present', () => {
    expect(isSecurityContext({ ...baseDeps, securityContext: true }, { immutable: true })).toBe(
      true,
    );
  });

  it('returns false when neither signal is present', () => {
    expect(isSecurityContext(baseDeps, null)).toBe(false);
    expect(isSecurityContext(baseDeps, { immutable: false })).toBe(false);
    expect(isSecurityContext(baseDeps, {})).toBe(false);
  });
});

// ─── Layer-trace events (mmnto-ai/totem#1482) ────────────

describe('compileLesson trace events', () => {
  it('Pipeline 1 manual compile emits a single layer-1 result event', async () => {
    // Invariant: Pipeline 1 is deterministic (no LLM, no retry). One event,
    // outcome 'compiled', layer 1.
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn(),
      runOrchestrator: vi.fn(),
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };

    const result = await compileLesson(manualLesson, 'system prompt', deps);
    expect(result.status).toBe('compiled');
    expect(result.trace).toBeDefined();
    expect(result.trace).toHaveLength(1);
    expect(result.trace![0]).toMatchObject({
      layer: 1,
      action: 'result',
      outcome: 'compiled',
    });
    expect(deps.runOrchestrator).not.toHaveBeenCalled();
  });

  it('Pipeline 2 first-try compile emits generate + verify(MATCH) + result(compiled)', async () => {
    const lessonOk: LessonInput = {
      index: 0,
      heading: 'No console.log in production',
      body: 'Do not use console.log.\n**Example Hit:** console.log(x)',
      hash: 'h-trace-first-try',
    };
    const parseMock = vi.fn().mockReturnValue({
      compilable: true,
      pattern: 'console\\.log',
      message: 'No console.log',
      engine: 'regex' as const,
      badExample: 'console.log("x")',
      goodExample: '// placeholder\n',
    });
    const orchestratorMock = vi.fn().mockResolvedValue('attempt-1');
    const deps: CompileLessonDeps = {
      parseCompilerResponse: parseMock,
      runOrchestrator: orchestratorMock,
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };

    const result = await compileLesson(lessonOk, 'system prompt', deps);
    expect(result.status).toBe('compiled');
    expect(result.trace).toBeDefined();
    expect(result.trace).toHaveLength(3);

    const [gen, verify, res] = result.trace!;
    expect(gen).toMatchObject({ layer: 3, action: 'generate', outcome: 'attempt-1' });
    expect(gen!.patternHash).toMatch(/^[0-9a-f]{16}$/);
    expect(verify).toMatchObject({ layer: 3, action: 'verify', outcome: 'MATCH' });
    expect(res).toMatchObject({ layer: 3, action: 'result', outcome: 'compiled' });
  });

  it('Pipeline 2 verify-retry-exhausted emits generate+verify per attempt plus retry scheduling and terminal result', async () => {
    // Three attempts, each passing smoke gate but failing verifyRuleExamples.
    // Trace should contain (generate, verify, retry) for attempts 1 and 2, then
    // (generate, verify, result) for attempt 3.
    const lessonWithExample: LessonInput = {
      index: 0,
      heading: 'No console.log in production',
      body: 'Do not use console.log in production.\n**Example Hit:** console.log(x)',
      hash: 'h-trace-exhaust',
    };
    const parseMock = vi.fn().mockReturnValue({
      compilable: true,
      pattern: 'zzz_only_matches_itself',
      message: 'No console.log',
      engine: 'regex' as const,
      badExample: 'zzz_only_matches_itself',
      goodExample: '// placeholder\n',
    });
    const orchestratorMock = vi.fn().mockResolvedValue('always-misses');
    const deps: CompileLessonDeps = {
      parseCompilerResponse: parseMock,
      runOrchestrator: orchestratorMock,
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };

    const result = await compileLesson(lessonWithExample, 'system prompt', deps);
    expect(result.status).toBe('skipped');
    expect(result.trace).toBeDefined();

    // 3 attempts × (generate + verify) = 6 events, plus 2 retry events between
    // the first two attempts, plus 1 terminal result = 9 events total.
    const actions = result.trace!.map((e) => e.action);
    expect(actions).toEqual([
      'generate',
      'verify',
      'retry',
      'generate',
      'verify',
      'retry',
      'generate',
      'verify',
      'result',
    ]);
    const terminal = result.trace![result.trace!.length - 1]!;
    expect(terminal).toMatchObject({
      layer: 3,
      action: 'result',
      outcome: 'skipped',
      reasonCode: 'verify-retry-exhausted',
    });
  });

  it('Pipeline 2 out-of-scope skip emits a single layer-3 result event with reasonCode', async () => {
    const parseMock = vi.fn().mockReturnValue({
      compilable: false,
      reason: 'Architectural principle, not a pattern.',
    });
    const orchestratorMock = vi.fn().mockResolvedValue('{"compilable": false}');
    const deps: CompileLessonDeps = {
      parseCompilerResponse: parseMock,
      runOrchestrator: orchestratorMock,
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };

    const result = await compileLesson(lesson, 'system prompt', deps);
    expect(result.status).toBe('skipped');
    expect(result.trace).toHaveLength(1);
    expect(result.trace![0]).toMatchObject({
      layer: 3,
      action: 'result',
      outcome: 'skipped',
      reasonCode: 'out-of-scope',
    });
  });

  it('Pipeline 2 validator rejection emits generate + verify(validator-rejected) + result(skipped)', async () => {
    // Invalid regex is terminal. No retry fires. Trace should show the
    // generate event then the validator-rejected verify event then result.
    const parseMock = vi.fn().mockReturnValue({
      compilable: true,
      pattern: '[unclosed-bracket',
      message: 'bad regex',
      engine: 'regex' as const,
      badExample: 'anything',
      goodExample: '// placeholder\n',
    });
    const orchestratorMock = vi.fn().mockResolvedValue('invalid-regex-output');
    const deps: CompileLessonDeps = {
      parseCompilerResponse: parseMock,
      runOrchestrator: orchestratorMock,
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };

    const result = await compileLesson(lesson, 'system prompt', deps);
    expect(result.status).toBe('skipped');
    const actions = result.trace!.map((e) => e.action);
    expect(actions).toEqual(['generate', 'verify', 'result']);
    expect(result.trace![1]).toMatchObject({
      layer: 3,
      action: 'verify',
      outcome: 'validator-rejected',
    });
    expect(result.trace![2]).toMatchObject({
      layer: 3,
      action: 'result',
      outcome: 'skipped',
      reasonCode: 'pattern-syntax-invalid',
    });
  });

  it('Pipeline 3 example-based compile emits generate + verify + result events at layer 2', async () => {
    const pipeline3Lesson: LessonInput = {
      index: 0,
      heading: 'Example-based lesson',
      body: [
        'Do not use console.log.',
        '',
        '**Bad:**',
        '```ts',
        'console.log("x")',
        '```',
        '',
        '**Good:**',
        '```ts',
        'log.info("x")',
        '```',
      ].join('\n'),
      hash: 'h-trace-pipeline3',
    };
    const parseMock = vi.fn().mockReturnValue({
      compilable: true,
      pattern: 'console\\.log',
      message: 'No console.log',
      engine: 'regex' as const,
      badExample: 'console.log("x")',
      goodExample: '// placeholder\n',
    });
    const orchestratorMock = vi.fn().mockResolvedValue('pipeline-3-response');
    const deps: CompileLessonDeps = {
      parseCompilerResponse: parseMock,
      runOrchestrator: orchestratorMock,
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
    };

    const result = await compileLesson(pipeline3Lesson, 'system prompt', deps);
    expect(result.status).toBe('compiled');
    const actions = result.trace!.map((e) => e.action);
    expect(actions).toEqual(['generate', 'verify', 'result']);
    // Pipeline 3 emits at layer 2 per the design doc reservation.
    expect(result.trace![0]!.layer).toBe(2);
    expect(result.trace![0]!.patternHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('security-context short-circuit emits a single result event with security-rule-rejected', async () => {
    const securityLesson: LessonInput = {
      index: 0,
      heading: 'No shell injection',
      body: 'Never pass user input to spawn.',
      hash: 'h-trace-security-short-circuit',
    };
    const orchestratorMock = vi.fn();
    const deps: CompileLessonDeps = {
      parseCompilerResponse: vi.fn(),
      runOrchestrator: orchestratorMock,
      existingByHash: new Map(),
      callbacks: { onWarn: vi.fn(), onDim: vi.fn() },
      securityContext: true,
    };

    const result = await compileLesson(securityLesson, 'system prompt', deps);
    expect(result.status).toBe('skipped');
    expect(result.trace).toHaveLength(1);
    expect(result.trace![0]).toMatchObject({
      layer: 3,
      action: 'result',
      outcome: 'skipped',
      reasonCode: 'security-rule-rejected',
    });
    expect(orchestratorMock).not.toHaveBeenCalled();
  });
});
