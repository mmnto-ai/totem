import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  CompiledRule,
  DiffAddition,
  RuleEventCallback,
  RuleEventContext,
} from './compiler-schema.js';
import {
  applyAstRulesToAdditions,
  applyRulesToAdditions,
  extractJustification,
  matchesGlob,
  type RuleEngineContext,
} from './rule-engine.js';
import { cleanTmpDir, makeRuleEngineCtx } from './test-utils.js';

// ─── Helpers ────────────────────────────────────────

let tmpDir: string;
let ctx: RuleEngineContext & { warnings: string[] };

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-rule-engine-'));
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  ctx = makeRuleEngineCtx();
});

afterEach(() => {
  cleanTmpDir(tmpDir);
});

function makeRule(overrides: Partial<CompiledRule>): CompiledRule {
  return {
    lessonHash: 'deadbeef12345678',
    lessonHeading: 'Test rule',
    pattern: '.*',
    message: 'Test violation',
    engine: 'regex',
    compiledAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeAddition(file: string, line: string, lineNumber: number): DiffAddition {
  return { file, line, lineNumber, precedingLine: null };
}

// ─── Error propagation (fail-closed) ────────────────

describe('applyAstRulesToAdditions', () => {
  it('gracefully degrades on invalid tree-sitter queries and emits warning (#988)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'app.ts'), 'const x = 1;\n');

    const rule = makeRule({
      engine: 'ast',
      astQuery: '(this is not valid S-expression!!!',
    });

    const additions = [makeAddition('src/app.ts', 'const x = 1;', 1)];

    // Bad queries return empty results with a warning — prevents TS-specific node names
    // from crashing lint when run against JS files (#988)
    const warnings: string[] = [];
    const violations = await applyAstRulesToAdditions(
      ctx,
      [rule],
      additions,
      tmpDir,
      undefined,
      (msg) => warnings.push(msg),
    );
    expect(violations).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain('AST query skipped');
  });

  it('swallows ast-grep query errors on a single rule and emits a failure event (mmnto/totem#1408)', async () => {
    const filePath = path.join(tmpDir, 'src', 'app.ts');
    fs.writeFileSync(filePath, 'const x = 1;\n');

    // Runtime-invalid ast-grep string pattern. The pattern is a bare
    // catch clause, which ast-grep rejects as multi-root. Pre-#1408 this
    // threw TotemParseError and killed the whole batch; post-#1408 the
    // per-rule try/catch isolates the failure to a single rule, emits a
    // 'failure' event, and lets subsequent rules and files continue.
    const rule = makeRule({
      engine: 'ast-grep',
      lessonHash: 'bad-rule-hash',
      astGrepPattern: 'catch ($ERR) { $$$BODY }',
    });

    const additions = [makeAddition('src/app.ts', 'const x = 1;', 1)];
    const events: Array<{ event: string; hash: string; reason?: string }> = [];

    const violations = await applyAstRulesToAdditions(
      ctx,
      [rule],
      additions,
      tmpDir,
      (event, hash, ctx) => {
        events.push({ event, hash, reason: ctx?.failureReason });
      },
    );

    expect(violations).toEqual([]);
    const failureEvent = events.find((e) => e.event === 'failure');
    expect(failureEvent).toBeDefined();
    expect(failureEvent!.hash).toBe('bad-rule-hash');
    expect(failureEvent!.reason?.length ?? 0).toBeGreaterThan(0);
  });

  it('one malformed ast-grep rule does not prevent subsequent rules on the same file', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.ts'),
      'debugger;\nconsole.log("hi");\nconst x = 1;\n',
    );

    const badRule = makeRule({
      engine: 'ast-grep',
      lessonHash: 'bad-rule',
      astGrepPattern: 'catch ($ERR) { $$$BODY }', // multi-root, throws
    });
    const goodRule = makeRule({
      engine: 'ast-grep',
      lessonHash: 'good-rule',
      astGrepPattern: 'console.log($$$)',
    });

    const additions = [
      makeAddition('src/app.ts', 'debugger;', 1),
      makeAddition('src/app.ts', 'console.log("hi");', 2),
      makeAddition('src/app.ts', 'const x = 1;', 3),
    ];

    const events: Array<{ event: string; hash: string }> = [];
    const violations = await applyAstRulesToAdditions(
      ctx,
      [badRule, goodRule],
      additions,
      tmpDir,
      (event, hash) => events.push({ event, hash }),
    );

    expect(violations).toHaveLength(1);
    expect(violations[0]!.rule.lessonHash).toBe('good-rule');
    expect(events.some((e) => e.event === 'failure' && e.hash === 'bad-rule')).toBe(true);
  });

  it('routes compound rules through NAPI object matcher and handles binding errors gracefully', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.ts'),
      'try {\n  doWork();\n} catch (err) {\n}\n',
    );

    const compoundRule = makeRule({
      engine: 'ast-grep',
      lessonHash: 'compound-has',
      // Empty catch — matches catch_clause nodes with no expression_statement descendants
      astGrepPattern: undefined,
      pattern: '',
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
    });

    const additions = [
      makeAddition('src/app.ts', 'try {', 1),
      makeAddition('src/app.ts', '  doWork();', 2),
      makeAddition('src/app.ts', '} catch (err) {', 3),
      makeAddition('src/app.ts', '}', 4),
    ];

    const violations = await applyAstRulesToAdditions(ctx, [compoundRule], additions, tmpDir);
    expect(violations.length).toBeGreaterThanOrEqual(1);
    // The outer catch_clause spans lines 3-4; the first overlapping added
    // line (3) is where the violation gets reported.
    expect(violations[0]!.lineNumber).toBe(3);
  });

  it('compound rule with invalid NAPI config emits failure event without crashing', async () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'app.ts'), 'const x = 1;\n');

    const compoundRule = makeRule({
      engine: 'ast-grep',
      lessonHash: 'compound-bad',
      astGrepPattern: undefined,
      pattern: '',
      astGrepYamlRule: { rule: { kind: '!!!INVALID_KIND!!!' } },
    });

    const additions = [makeAddition('src/app.ts', 'const x = 1;', 1)];
    const events: Array<{ event: string; hash: string; reason?: string }> = [];

    const violations = await applyAstRulesToAdditions(
      ctx,
      [compoundRule],
      additions,
      tmpDir,
      (event, hash, ctx) => events.push({ event, hash, reason: ctx?.failureReason }),
    );

    expect(violations).toEqual([]);
    const failure = events.find((e) => e.event === 'failure');
    expect(failure).toBeDefined();
    expect(failure!.hash).toBe('compound-bad');
  });

  it('still returns violations for valid AST rules (regression check)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'app.ts'), 'console.log("hello");\nconst x = 1;\n');

    const rule = makeRule({
      engine: 'ast-grep',
      astGrepPattern: 'console.log($$$)',
    });

    const additions = [makeAddition('src/app.ts', 'console.log("hello");', 1)];

    const violations = await applyAstRulesToAdditions(ctx, [rule], additions, tmpDir);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.lineNumber).toBe(1);
  });

  it('supports injected readStrategy for staged content', async () => {
    // The file doesn't exist on disk, or has different content on disk
    fs.writeFileSync(path.join(tmpDir, 'src', 'app.ts'), 'console.log("disk content");\n');

    const rule = makeRule({
      engine: 'ast-grep',
      astGrepPattern: 'console.log("staged content")',
    });

    const additions = [makeAddition('src/app.ts', 'console.log("staged content");', 1)];

    // Inject a readStrategy that returns staged content
    const mockReadStrategy = async (filePath: string) => {
      if (filePath === 'src/app.ts') return 'console.log("staged content");\n';
      return null;
    };

    const violations = await applyAstRulesToAdditions(
      ctx,
      [rule],
      additions,
      tmpDir,
      undefined,
      undefined,
      mockReadStrategy,
    );
    expect(violations).toHaveLength(1);
    expect(violations[0]!.line).toBe('console.log("staged content");');
  });

  it('skips file when readStrategy returns null', async () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'app.ts'), 'console.log("disk content");\n');

    const rule = makeRule({
      engine: 'ast-grep',
      astGrepPattern: 'console.log("disk content")',
    });

    const additions = [makeAddition('src/app.ts', 'console.log("disk content");', 1)];

    // readStrategy returns null (simulating a symlink or unreadable file)
    const mockReadStrategyReturningNull = async () => null;

    const violations = await applyAstRulesToAdditions(
      ctx,
      [rule],
      additions,
      tmpDir,
      undefined,
      undefined,
      mockReadStrategyReturningNull,
    );
    expect(violations).toHaveLength(0); // Violation from disk content is ignored because readStrategy returned null
  });

  it('uses disk read when no readStrategy provided (Invariant #4 backward compat)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'app.ts'), 'console.log("disk content");\n');

    const rule = makeRule({
      engine: 'ast-grep',
      astGrepPattern: 'console.log("disk content")',
    });

    const additions = [makeAddition('src/app.ts', 'console.log("disk content");', 1)];

    // No readStrategy argument passed
    const violations = await applyAstRulesToAdditions(ctx, [rule], additions, tmpDir);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.line).toBe('console.log("disk content");');
  });

  it('respects workingDirectory explicitly rather than cwd', async () => {
    // The bug (#1304) was that applyAstRulesToAdditions used process.cwd() instead of the repo root
    // To simulate this, we pass a workingDirectory that is different from cwd
    const repoRoot = path.join(tmpDir, 'repo-root');
    fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
    fs.writeFileSync(path.join(repoRoot, 'src', 'app.ts'), 'console.log("hello");\n');

    const rule = makeRule({
      engine: 'ast-grep',
      astGrepPattern: 'console.log($$$)',
    });

    const additions = [makeAddition('src/app.ts', 'console.log("hello");', 1)];

    // We pass repoRoot as the workingDirectory. If it uses something else (like process.cwd()), it will fail to read the file.
    const violations = await applyAstRulesToAdditions(ctx, [rule], additions, repoRoot);
    expect(violations).toHaveLength(1);
  });

  it('emits suppress event for ast-grep rules on totem-ignore lines', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.ts'),
      'console.log("hello"); // totem-ignore\nconst x = 1;\n',
    );

    const rule = makeRule({
      engine: 'ast-grep',
      lessonHash: 'suppress-ast-grep-test',
      astGrepPattern: 'console.log($$$)',
    });

    const additions: DiffAddition[] = [
      {
        file: 'src/app.ts',
        line: 'console.log("hello"); // totem-ignore',
        lineNumber: 1,
        precedingLine: null,
      },
    ];

    const events: Array<{ event: string; hash: string }> = [];
    const onRuleEvent: RuleEventCallback = (event, hash) => {
      events.push({ event, hash });
    };

    const violations = await applyAstRulesToAdditions(ctx, [rule], additions, tmpDir, onRuleEvent);
    expect(violations).toHaveLength(0);
    expect(events).toEqual([{ event: 'suppress', hash: 'suppress-ast-grep-test' }]);
  });

  it('emits suppress event for tree-sitter AST rules on totem-ignore-next-line', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.ts'),
      '// totem-ignore-next-line\nconst x = 1;\n',
    );

    const rule = makeRule({
      engine: 'ast',
      lessonHash: 'suppress-tree-sitter-test',
      astQuery: '(lexical_declaration) @violation',
    });

    const additions: DiffAddition[] = [
      {
        file: 'src/app.ts',
        line: 'const x = 1;',
        lineNumber: 2,
        precedingLine: '// totem-ignore-next-line',
      },
    ];

    const events: Array<{ event: string; hash: string }> = [];
    const onRuleEvent: RuleEventCallback = (event, hash) => {
      events.push({ event, hash });
    };

    const violations = await applyAstRulesToAdditions(ctx, [rule], additions, tmpDir, onRuleEvent);
    expect(violations).toHaveLength(0);
    expect(events).toEqual([{ event: 'suppress', hash: 'suppress-tree-sitter-test' }]);
  });
});

// ─── Regex rule event context ────────────────────────

describe('applyRulesToAdditions — event context', () => {
  it('onRuleEvent callback receives file and line context on suppress', () => {
    const rule = makeRule({
      engine: 'regex',
      pattern: 'console\\.log',
      lessonHash: 'ctx-suppress-test',
    });

    const additions: DiffAddition[] = [
      {
        file: 'src/app.ts',
        line: 'console.log("debug"); // totem-ignore',
        lineNumber: 42,
        precedingLine: null,
      },
    ];

    const events: Array<{ event: string; hash: string; context?: RuleEventContext }> = [];
    const onRuleEvent: RuleEventCallback = (event, hash, context) => {
      events.push({ event, hash, context });
    };

    const violations = applyRulesToAdditions(ctx, [rule], additions, onRuleEvent);
    expect(violations).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe('suppress');
    expect(events[0]!.hash).toBe('ctx-suppress-test');
    expect(events[0]!.context).toEqual({
      file: 'src/app.ts',
      line: 42,
      justification: '',
    });
  });

  it('threads rule.immutable into the suppress event context for pack enforcement audit', () => {
    // ADR-089 / mmnto-ai/totem#1485 — when a pack-shipped immutable rule
    // is bypassed by an inline totem-ignore directive, the suppress event
    // must carry `immutable: true` so the Trap Ledger writer can flag it
    // for pack enforcement audit.
    const rule = makeRule({
      engine: 'regex',
      pattern: 'dangerous\\.call',
      lessonHash: 'immut-suppress-test',
      immutable: true,
      severity: 'error',
    });

    const additions: DiffAddition[] = [
      {
        file: 'src/attack.ts',
        line: 'dangerous.call(); // totem-ignore',
        lineNumber: 10,
        precedingLine: null,
      },
    ];

    const events: Array<{ event: string; hash: string; context?: RuleEventContext }> = [];
    const onRuleEvent: RuleEventCallback = (event, hash, context) => {
      events.push({ event, hash, context });
    };

    applyRulesToAdditions(ctx, [rule], additions, onRuleEvent);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe('suppress');
    expect(events[0]!.context?.immutable).toBe(true);
  });

  it('onRuleEvent callback receives file and line context on trigger', () => {
    const rule = makeRule({
      engine: 'regex',
      pattern: 'console\\.log',
      lessonHash: 'ctx-trigger-test',
    });

    const additions: DiffAddition[] = [
      {
        file: 'src/handler.ts',
        line: 'console.log("hello");',
        lineNumber: 10,
        precedingLine: null,
      },
    ];

    const events: Array<{ event: string; hash: string; context?: RuleEventContext }> = [];
    const onRuleEvent: RuleEventCallback = (event, hash, context) => {
      events.push({ event, hash, context });
    };

    const violations = applyRulesToAdditions(ctx, [rule], additions, onRuleEvent);
    expect(violations).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe('trigger');
    expect(events[0]!.context).toEqual({
      file: 'src/handler.ts',
      line: 10,
    });
  });

  it('totem-context: directive suppresses rule and extracts justification', () => {
    const rule = makeRule({
      engine: 'regex',
      pattern: 'console\\.log',
      lessonHash: 'ctx-override-test',
    });

    const additions: DiffAddition[] = [
      {
        file: 'src/app.ts',
        line: 'console.log("debug"); // totem-context: needed for observability',
        lineNumber: 5,
        precedingLine: null,
      },
    ];

    const events: Array<{ event: string; hash: string; context?: RuleEventContext }> = [];
    const onRuleEvent: RuleEventCallback = (event, hash, context) => {
      events.push({ event, hash, context });
    };

    const violations = applyRulesToAdditions(ctx, [rule], additions, onRuleEvent);
    expect(violations).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe('suppress');
    expect(events[0]!.context).toEqual({
      file: 'src/app.ts',
      line: 5,
      justification: 'needed for observability',
    });
  });

  it('totem-context: on preceding line suppresses and extracts justification', () => {
    const rule = makeRule({
      engine: 'regex',
      pattern: 'console\\.log',
      lessonHash: 'ctx-prev-line-test',
    });

    const additions: DiffAddition[] = [
      {
        file: 'src/app.ts',
        line: 'console.log("debug");',
        lineNumber: 6,
        precedingLine: '// totem-context: required for production monitoring',
      },
    ];

    const events: Array<{ event: string; hash: string; context?: RuleEventContext }> = [];
    const onRuleEvent: RuleEventCallback = (event, hash, context) => {
      events.push({ event, hash, context });
    };

    const violations = applyRulesToAdditions(ctx, [rule], additions, onRuleEvent);
    expect(violations).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]!.event).toBe('suppress');
    expect(events[0]!.context).toEqual({
      file: 'src/app.ts',
      line: 6,
      justification: 'required for production monitoring',
    });
  });

  it('shield-context: legacy alias suppresses rule with deprecation warning', () => {
    const rule = makeRule({
      engine: 'regex',
      pattern: 'console\\.log',
      lessonHash: 'legacy-ctx-test',
    });

    const additions: DiffAddition[] = [
      {
        file: 'src/app.ts',
        line: 'console.log("debug"); // shield-context: legacy reason',
        lineNumber: 5,
        precedingLine: null,
      },
    ];

    const violations = applyRulesToAdditions(ctx, [rule], additions);
    expect(violations).toHaveLength(0);
    expect(ctx.warnings).toHaveLength(1);
    expect(ctx.warnings[0]).toContain('shield-context');
  });

  it('shield-context: on preceding line suppresses with deprecation warning', () => {
    const rule = makeRule({
      engine: 'regex',
      pattern: 'console\\.log',
      lessonHash: 'legacy-prev-test',
    });

    const additions: DiffAddition[] = [
      {
        file: 'src/app.ts',
        line: 'console.log("debug");',
        lineNumber: 6,
        precedingLine: '// shield-context: legacy preceding reason',
      },
    ];

    const violations = applyRulesToAdditions(ctx, [rule], additions);
    expect(violations).toHaveLength(0);
    expect(ctx.warnings).toHaveLength(1);
  });

  it('isolates deprecation-warning state across distinct ctx instances (mmnto/totem#1441)', () => {
    // Concurrency-isolation invariant: two sequential applyRulesToAdditions
    // calls with distinct ctx objects each see their own one-shot deprecation
    // warning. Pre-#1441, module-level `shieldContextDeprecationWarned` would
    // latch after the first call and silently swallow the second.
    const rule = makeRule({
      engine: 'regex',
      pattern: 'console\\.log',
      lessonHash: 'isolation-test',
    });
    const additions: DiffAddition[] = [
      {
        file: 'src/app.ts',
        line: 'console.log("hi"); // shield-context: reason',
        lineNumber: 1,
        precedingLine: null,
      },
    ];

    const ctxA = makeRuleEngineCtx();
    const ctxB = makeRuleEngineCtx();
    applyRulesToAdditions(ctxA, [rule], additions);
    applyRulesToAdditions(ctxB, [rule], additions);

    expect(ctxA.warnings).toHaveLength(1);
    expect(ctxB.warnings).toHaveLength(1);
    expect(ctxA.state.hasWarnedShieldContext).toBe(true);
    expect(ctxB.state.hasWarnedShieldContext).toBe(true);
  });

  it('latches deprecation warning per ctx (repeat hits on same ctx warn once)', () => {
    const rule = makeRule({
      engine: 'regex',
      pattern: 'console\\.log',
      lessonHash: 'latch-test',
    });
    const additions: DiffAddition[] = [
      {
        file: 'src/app.ts',
        line: 'console.log("a"); // shield-context: one',
        lineNumber: 1,
        precedingLine: null,
      },
      {
        file: 'src/app.ts',
        line: 'console.log("b"); // shield-context: two',
        lineNumber: 2,
        precedingLine: null,
      },
    ];

    applyRulesToAdditions(ctx, [rule], additions);
    expect(ctx.warnings).toHaveLength(1);
  });
});

// ─── extractJustification ────────────────────────────

describe('extractJustification', () => {
  it('returns empty string for plain totem-ignore', () => {
    expect(extractJustification(ctx, 'code(); // totem-ignore', null)).toBe('');
  });

  it('extracts justification from same-line totem-context:', () => {
    expect(extractJustification(ctx, 'code(); // totem-context: needed for DLP', null)).toBe(
      'needed for DLP',
    );
  });

  it('extracts justification from preceding line totem-context:', () => {
    expect(extractJustification(ctx, 'code();', '// totem-context: audit trail')).toBe(
      'audit trail',
    );
  });

  it('prefers same-line over preceding line', () => {
    expect(
      extractJustification(
        ctx,
        'code(); // totem-context: same-line reason',
        '// totem-context: preceding reason',
      ),
    ).toBe('same-line reason');
  });

  it('trims whitespace from justification', () => {
    expect(extractJustification(ctx, 'code(); // totem-context:   extra spaces  ', null)).toBe(
      'extra spaces',
    );
  });

  it('extracts justification from same-line shield-context: (legacy)', () => {
    expect(extractJustification(ctx, 'code(); // shield-context: legacy DLP', null)).toBe(
      'legacy DLP',
    );
    expect(ctx.warnings).toHaveLength(1);
  });

  it('extracts justification from preceding line shield-context: (legacy)', () => {
    expect(extractJustification(ctx, 'code();', '// shield-context: legacy audit')).toBe(
      'legacy audit',
    );
    expect(ctx.warnings).toHaveLength(1);
  });

  it('prefers totem-context: over shield-context: (precedence)', () => {
    // Same-line totem-context wins over preceding-line shield-context
    expect(
      extractJustification(
        ctx,
        'code(); // totem-context: new reason',
        '// shield-context: old reason',
      ),
    ).toBe('new reason');
    // totem-context matched first — shield-context deprecation warning should NOT fire
    expect(ctx.warnings).toHaveLength(0);
  });
});

// ─── matchesGlob ──────────────────────────────────

describe('matchesGlob', () => {
  it('matches *.ext anywhere in path', () => {
    expect(matchesGlob('src/foo.ts', '*.ts')).toBe(true);
    expect(matchesGlob('src/foo.js', '*.ts')).toBe(false);
  });

  it('matches *.test.* for test file patterns', () => {
    expect(matchesGlob('src/foo.test.ts', '*.test.*')).toBe(true);
    expect(matchesGlob('src/foo.test.js', '*.test.*')).toBe(true);
    expect(matchesGlob('src/foo.spec.tsx', '*.spec.*')).toBe(true);
    expect(matchesGlob('src/foo.ts', '*.test.*')).toBe(false);
    // Directory segments containing ".test." should NOT match
    expect(matchesGlob('src/.test.fixtures/foo.ts', '*.test.*')).toBe(false);
  });

  it('matches **/*.test.* recursively', () => {
    expect(matchesGlob('packages/cli/src/install-hooks.test.ts', '**/*.test.*')).toBe(true);
    expect(matchesGlob('packages/cli/src/install-hooks.ts', '**/*.test.*')).toBe(false);
  });

  it('matches directory prefixed globs', () => {
    expect(matchesGlob('packages/cli/src/foo.ts', 'packages/cli/**/*.ts')).toBe(true);
    expect(matchesGlob('packages/core/src/foo.ts', 'packages/cli/**/*.ts')).toBe(false);
  });

  it('matches literal filenames', () => {
    expect(matchesGlob('Dockerfile', 'Dockerfile')).toBe(true);
    expect(matchesGlob('src/Dockerfile', 'Dockerfile')).toBe(true);
  });

  it('matches dir/*.test.* (single-star with trailing wildcard)', () => {
    expect(matchesGlob('src/foo.test.ts', 'src/*.test.*')).toBe(true);
    expect(matchesGlob('src/foo.test.js', 'src/*.test.*')).toBe(true);
    expect(matchesGlob('src/foo.ts', 'src/*.test.*')).toBe(false);
    // Nested files should NOT match single-star
    expect(matchesGlob('src/sub/foo.test.ts', 'src/*.test.*')).toBe(false);
  });

  // mmnto-ai/totem#1758: `**/dir/**` must match any path containing the
  // directory segment, not just paths starting with the directory. The
  // pre-fix matcher stripped `**/` and required the rest to match at
  // path-root, so `**/__tests__/**` failed on `packages/cli/src/__tests__/foo.ts`.
  it('matches **/dir/** at any depth (mmnto-ai/totem#1758)', () => {
    // Directory at root depth
    expect(matchesGlob('__tests__/foo.ts', '**/__tests__/**')).toBe(true);
    // Directory nested several segments deep
    expect(matchesGlob('packages/cli/src/__tests__/foo.ts', '**/__tests__/**')).toBe(true);
    // Same shape with `tests/` (different default-baseline glob)
    expect(matchesGlob('packages/cli/src/tests/integration.ts', '**/tests/**')).toBe(true);
    expect(matchesGlob('a/b/c/d/fixtures/data.json', '**/fixtures/**')).toBe(true);
    // Negative: directory name as substring of another segment must NOT match
    expect(matchesGlob('packages/cli/src/contests/foo.ts', '**/tests/**')).toBe(false);
    // Negative: directory not present at all
    expect(matchesGlob('packages/cli/src/main.ts', '**/__tests__/**')).toBe(false);
  });

  it('matches **/dir/file at any depth (mmnto-ai/totem#1758)', () => {
    expect(matchesGlob('foo/bar.ts', '**/foo/bar.ts')).toBe(true);
    expect(matchesGlob('a/b/foo/bar.ts', '**/foo/bar.ts')).toBe(true);
    expect(matchesGlob('a/b/foo/baz.ts', '**/foo/bar.ts')).toBe(false);
  });

  // mmnto-ai/totem#1758 second hole (CR mmnto-ai/totem#1766 R1 catch):
  // path-shaped literal globs MUST match exactly, not as a "/"-prefix
  // suffix. The pre-fix matcher returned `endsWith('/' + glob)`, so
  // `src/foo.ts` spuriously matched `packages/src/foo.ts`. Bare filenames
  // (no `/`) keep their original behavior — `Dockerfile` continues to
  // match `src/Dockerfile`.
  it('requires exact match for path-shaped literal globs (mmnto-ai/totem#1758)', () => {
    // Exact match: yes
    expect(matchesGlob('src/foo.ts', 'src/foo.ts')).toBe(true);
    // Suffix-only match must FAIL: this is the bug the consolidation fixes
    expect(matchesGlob('packages/src/foo.ts', 'src/foo.ts')).toBe(false);
    expect(matchesGlob('a/b/c/src/foo.ts', 'src/foo.ts')).toBe(false);
  });

  it('preserves bare-filename suffix matching for paths without `/` (mmnto-ai/totem#1758)', () => {
    // Bare literal still matches at any depth (no `/` means "filename only")
    expect(matchesGlob('Dockerfile', 'Dockerfile')).toBe(true);
    expect(matchesGlob('src/Dockerfile', 'Dockerfile')).toBe(true);
    expect(matchesGlob('packages/cli/Dockerfile', 'Dockerfile')).toBe(true);
    expect(matchesGlob('Dockerfile.dev', 'Dockerfile')).toBe(false);
  });
});
