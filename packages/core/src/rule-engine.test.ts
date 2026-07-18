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
import { TotemError, TotemParseError } from './errors.js';
import { resolveEngineVersion } from './pack-discovery.js';
import {
  applyAstRulesToAdditions,
  applyRulesToAdditions,
  extractJustification,
  getRustTestSpans,
  isProductionRustRule,
  matchesGlob,
  parseFailSoftAttestation,
  type RuleEngineContext,
} from './rule-engine.js';
import { cleanTmpDir, makeRuleEngineCtx } from './test-utils.js';

/**
 * Seed `.totem/installed-packs.json` at `dir` so the stale-manifest
 * detector (mmnto-ai/totem#1811, ADR-101) sees a fresh cohort and
 * the rule-engine falls through to the original `TotemParseError`
 * path. Pre-1811, the existence check wasn't there so test fixtures
 * didn't need a manifest.
 */
function seedFreshManifest(dir: string, cohort: string = resolveEngineVersion()): void {
  const totemDir = path.join(dir, '.totem');
  fs.mkdirSync(totemDir, { recursive: true });
  // totem-context: writing a totem manifest fixture under tmpDir, not a git hook
  fs.writeFileSync(
    path.join(totemDir, 'installed-packs.json'),
    JSON.stringify({ version: 1, cohort, packs: [] }),
    'utf-8',
  );
}

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

  // ── Inline-suppression anchoring under diff scope (mmnto-ai/totem#2214) ──
  // The reported match line is the first *added* line within a multi-line
  // construct's range, so when only the catch BODY is in the diff the line
  // drifts off the catch keyword line — and a directive on (or above) the
  // catch line was missed. Suppression must anchor to the construct start.
  const failOpenCatchRule = (): CompiledRule =>
    makeRule({
      engine: 'ast-grep',
      lessonHash: 'fail-open-catch-ban',
      astGrepPattern: undefined,
      pattern: '',
      astGrepYamlRule: {
        rule: { kind: 'catch_clause', not: { has: { kind: 'throw_statement', stopBy: 'end' } } },
      },
    });

  it('suppresses a fail-open catch via a totem-context directive ABOVE the catch when only the body is in the diff (#2214)', async () => {
    // The try/catch wrapper + the directive pre-existed; only the body line
    // changed. In diff scope the match line drifts to the added body line, so
    // pre-#2214 the directive on line 3 (above the catch on line 4) was missed.
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.ts'),
      [
        'try {', // 1
        '  doWork();', // 2
        '  // totem-context: best-effort cleanup, fail-soft', // 3
        '} catch (err) {', // 4
        '  return [];', // 5
        '}', // 6
        '',
      ].join('\n'),
    );

    // Diff scope: ONLY the body line (5) is an addition; the catch line (4)
    // and the directive (3) are unchanged context, absent from `additions`.
    const additions = [makeAddition('src/app.ts', '  return [];', 5)];

    const violations = await applyAstRulesToAdditions(
      ctx,
      [failOpenCatchRule()],
      additions,
      tmpDir,
    );
    expect(violations).toHaveLength(0);
  });

  it('suppresses a fail-open catch via an INLINE totem-context directive on the catch line when only the body is in the diff (#2214)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.ts'),
      [
        'try {', // 1
        '  doWork();', // 2
        '} catch (err) { // totem-context: best-effort cleanup, fail-soft', // 3
        '  return [];', // 4
        '}', // 5
        '',
      ].join('\n'),
    );

    const additions = [makeAddition('src/app.ts', '  return [];', 4)];

    const violations = await applyAstRulesToAdditions(
      ctx,
      [failOpenCatchRule()],
      additions,
      tmpDir,
    );
    expect(violations).toHaveLength(0);
  });

  it('still fires on a fail-open catch with NO directive when only the body is in the diff (#2214 — no over-suppression)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.ts'),
      [
        'try {', // 1
        '  doWork();', // 2
        '} catch (err) {', // 3
        '  return [];', // 4
        '}', // 5
        '',
      ].join('\n'),
    );

    const additions = [makeAddition('src/app.ts', '  return [];', 4)];

    const violations = await applyAstRulesToAdditions(
      ctx,
      [failOpenCatchRule()],
      additions,
      tmpDir,
    );
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  // The same start-line suppression anchor flows through the tree-sitter
  // (engine: 'ast') match path, whose AstMatch results gained the same
  // startLineText/startPrecedingLineText fields. Cover it directly so a
  // divergence in how the tree-sitter loop populates the anchor can't
  // silently regress diff-scoped suppression (greptile #2216).
  const treeSitterCatchRule = (): CompiledRule =>
    makeRule({
      engine: 'ast',
      lessonHash: 'ts-fail-open-catch',
      astQuery: '(catch_clause) @violation',
    });

  it('suppresses via a totem-context directive on the tree-sitter (ast) path when only the body is in the diff (#2214)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.ts'),
      [
        'try {', // 1
        '  doWork();', // 2
        '  // totem-context: best-effort cleanup, fail-soft', // 3
        '} catch (err) {', // 4
        '  return [];', // 5
        '}', // 6
        '',
      ].join('\n'),
    );

    const additions = [makeAddition('src/app.ts', '  return [];', 5)];

    const violations = await applyAstRulesToAdditions(
      ctx,
      [treeSitterCatchRule()],
      additions,
      tmpDir,
    );
    expect(violations).toHaveLength(0);
  });

  it('still fires on the tree-sitter (ast) path with NO directive when only the body is in the diff (#2214 — no over-suppression)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.ts'),
      [
        'try {', // 1
        '  doWork();', // 2
        '} catch (err) {', // 3
        '  return [];', // 4
        '}', // 5
        '',
      ].join('\n'),
    );

    const additions = [makeAddition('src/app.ts', '  return [];', 4)];

    const violations = await applyAstRulesToAdditions(
      ctx,
      [treeSitterCatchRule()],
      additions,
      tmpDir,
    );
    expect(violations.length).toBeGreaterThanOrEqual(1);
  });

  // ── Fail-soft attestation carve-out (mmnto-ai/totem#2214 acceptance-#3) ──
  // Tenet-4 shape 2: a blanket fail-soft catch is licensed when it names a loud
  // systemic backstop. The structured `// totem-context: fail-soft backstop=<name>`
  // attestation is RECOGNIZED (parsed + surfaced) so authors keep the honest
  // catch_clause instead of the `.catch()` syntax dodge. A fail-soft claim with
  // NO backstop always surfaces a WARN (never blocks) — strategy#702/#708 ruling.
  describe('fail-soft attestation (shape 2)', () => {
    it('parses a well-formed attestation to its named backstop', () => {
      expect(parseFailSoftAttestation('fail-soft backstop=assertPipelineProductive')).toEqual({
        kind: 'fail-soft',
        backstop: 'assertPipelineProductive',
      });
    });

    it('tolerates whitespace around `backstop=` (a common authoring habit) (#2220 CR+GCA)', () => {
      // `backstop = foo` / `backstop= foo` must NOT silently read as malformed —
      // the parser strips optional whitespace on BOTH sides of `=` rather than
      // surprising the author with a false missing-backstop warning.
      for (const reason of [
        'fail-soft backstop= assertPipelineProductive',
        'fail-soft backstop =assertPipelineProductive',
        'fail-soft backstop = assertPipelineProductive',
      ]) {
        expect(parseFailSoftAttestation(reason)).toEqual({
          kind: 'fail-soft',
          backstop: 'assertPipelineProductive',
        });
      }
    });

    it('parses a backstop-less fail-soft claim as malformed (backstop: null)', () => {
      expect(parseFailSoftAttestation('fail-soft')).toEqual({ kind: 'fail-soft', backstop: null });
      expect(parseFailSoftAttestation('fail-soft backstop=')).toEqual({
        kind: 'fail-soft',
        backstop: null,
      });
    });

    it('does NOT treat embedded "fail-soft" prose as an attestation (non-breaking)', () => {
      // The ~25 existing `// totem-context:` escapes lead with prose; only a
      // LEADING `fail-soft` token is the structured attestation, so they are
      // unaffected (additive, never re-flagging committed code).
      expect(parseFailSoftAttestation('best-effort cleanup, fail-soft')).toBeNull();
      expect(parseFailSoftAttestation('intentional cleanup — telemetry sink')).toBeNull();
    });

    const writeCatch = (directiveLine: string): void =>
      fs.writeFileSync(
        path.join(tmpDir, 'src', 'app.ts'),
        [
          'try {',
          '  doWork();',
          `  ${directiveLine}`,
          '} catch (err) {',
          '  return [];',
          '}',
          '',
        ].join('\n'),
      );

    it('suppresses with NO warn when the attestation names a backstop', async () => {
      writeCatch('// totem-context: fail-soft backstop=assertPipelineProductive');
      const additions = [makeAddition('src/app.ts', '  return [];', 5)];
      const violations = await applyAstRulesToAdditions(
        ctx,
        [failOpenCatchRule()],
        additions,
        tmpDir,
      );
      expect(violations).toHaveLength(0);
    });

    it('suppresses the error BUT emits a WARN when the attestation names no backstop', async () => {
      writeCatch('// totem-context: fail-soft');
      const additions = [makeAddition('src/app.ts', '  return [];', 5)];
      const violations = await applyAstRulesToAdditions(
        ctx,
        [failOpenCatchRule()],
        additions,
        tmpDir,
      );
      // The catch-ban error is suppressed; the only finding is the warn-severity
      // missing-backstop diagnostic — non-blocking, never the original error.
      expect(violations).toHaveLength(1);
      expect(violations[0]!.rule.severity).toBe('warning');
      expect(violations[0]!.rule.lessonHash).toBe('totem/fail-soft-missing-backstop');
    });

    it('emits the WARN on the tree-sitter (ast) path too (parity)', async () => {
      writeCatch('// totem-context: fail-soft');
      const additions = [makeAddition('src/app.ts', '  return [];', 5)];
      const violations = await applyAstRulesToAdditions(
        ctx,
        [treeSitterCatchRule()],
        additions,
        tmpDir,
      );
      expect(violations).toHaveLength(1);
      expect(violations[0]!.rule.severity).toBe('warning');
      // Assert the lessonHash too (greptile #2220): a future warning rule reusing
      // severity:'warning' would otherwise pass this parity test while emitting the
      // wrong diagnostic.
      expect(violations[0]!.rule.lessonHash).toBe('totem/fail-soft-missing-backstop');
    });

    it('does NOT warn for a generic (non-fail-soft) context escape', async () => {
      writeCatch('// totem-context: best-effort cleanup');
      const additions = [makeAddition('src/app.ts', '  return [];', 5)];
      const violations = await applyAstRulesToAdditions(
        ctx,
        [failOpenCatchRule()],
        additions,
        tmpDir,
      );
      expect(violations).toHaveLength(0);
    });

    it('surfaces the typed attestation on the suppress rule-event (#697 ledger surface)', async () => {
      writeCatch('// totem-context: fail-soft backstop=assertProductive');
      const additions = [makeAddition('src/app.ts', '  return [];', 5)];
      const events: Array<{ event: string; context?: RuleEventContext }> = [];
      await applyAstRulesToAdditions(
        ctx,
        [failOpenCatchRule()],
        additions,
        tmpDir,
        (event, _hash, context) => events.push({ event, context }),
      );
      const suppress = events.find((e) => e.event === 'suppress');
      expect(suppress?.context?.attestation).toEqual({
        kind: 'fail-soft',
        backstop: 'assertProductive',
      });
    });
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

// ─── Behavior change: ast-grep dispatch fail-loud (mmnto-ai/totem#1653) ──

describe('applyAstRulesToAdditions fail-loud on unmapped extension (mmnto-ai/totem#1653)', () => {
  // totem-context: test fixtures genuinely need async — they `await applyAstRulesToAdditions(...)` whose contract is async
  it('throws when an AST rule is scoped to an unregistered extension', async () => {
    // totem-context: seed the manifest with a fresh cohort so mmnto-ai/totem#1811's STALE_MANIFEST nudge stays silent and the original install-hint path stays under test
    seedFreshManifest(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'src', 'main.py'), 'print("x")\n'); // totem-context: writing a python source fixture under tmpDir, not a git hook
    const rule = makeRule({
      engine: 'ast',
      astQuery: '(call_expression)',
      fileGlobs: ['**/*.py'],
      lessonHash: 'py-rule-hash',
      lessonHeading: 'Python rule',
    });
    const additions = [makeAddition('src/main.py', 'print("x")', 1)];

    // Pre-#1653 this would silently skip with no signal — the rule
    // intended to fire on .py files but `extensionToLanguage('.py')`
    // returns undefined. Now: fail loud via TotemParseError. Capture the
    // thrown error so we can assert both `message` (rule identity) and
    // `recoveryHint` (install-the-pack guidance) — `toThrowError(regex)`
    // resolves to void and can't reach the recoveryHint property.
    let caught: unknown;
    try {
      await applyAstRulesToAdditions(ctx, [rule], additions, tmpDir);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TotemParseError);
    const tpe = caught as TotemParseError; // totem-context: narrowing a thrown error after toBeInstanceOf — not parsing untrusted input
    // The `[Totem Error]` prefix is auto-prepended by the TotemError
    // base class constructor (`errors.ts:40`). Asserting on the resolved
    // message keeps the runtime contract visible at the test boundary.
    expect(tpe.message).toMatch(/^\[Totem Error\]/);
    expect(tpe.message).toMatch(
      /AST rule 'py-rule-hash'.*scoped to.*extension '\.py'.*no Tree-sitter language is registered/,
    );
    expect(tpe.recoveryHint).toMatch(/Install the pack that provides '\.py'/);
  });

  // mmnto-ai/totem#1811 (ADR-101): stale-manifest UX nudge — when the
  // installed-packs.json cohort doesn't match the running engine, the
  // unmapped-extension throw is replaced with a structured
  // STALE_MANIFEST error pointing at `totem sync --packs-only`. Two
  // parallel tests below establish the contract: cohort-match passes
  // through to the original TotemParseError; everything else fires
  // the nudge.

  // totem-context: test fixture genuinely awaits async API (`applyAstRulesToAdditions`)
  it('surfaces STALE_MANIFEST when installed-packs.json is missing', async () => {
    // Note: NO seedFreshManifest call — tmpDir has no .totem/.
    fs.writeFileSync(path.join(tmpDir, 'src', 'main.py'), 'print("x")\n'); // totem-context: writing a python source fixture under tmpDir, not a git hook
    const rule = makeRule({
      engine: 'ast',
      astQuery: '(call_expression)',
      fileGlobs: ['**/*.py'],
      lessonHash: 'py-rule-hash',
    });
    const additions = [makeAddition('src/main.py', 'print("x")', 1)];

    let caught: unknown;
    try {
      await applyAstRulesToAdditions(ctx, [rule], additions, tmpDir);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TotemError);
    expect(caught).not.toBeInstanceOf(TotemParseError);
    // totem-context: narrowing a thrown error after toBeInstanceOf — not parsing untrusted input
    const te = caught as TotemError;
    expect(te.code).toBe('STALE_MANIFEST');
    expect(te.recoveryHint).toMatch(/--packs-only/);
  });

  // totem-context: test fixture genuinely awaits async API (`applyAstRulesToAdditions`)
  it('surfaces STALE_MANIFEST when manifest cohort is from a prior minor version', async () => {
    // Seed cohort '0.0.0' so semver-minor compare always reads stale
    // regardless of the running engine version.
    seedFreshManifest(tmpDir, '0.0.0');
    fs.writeFileSync(path.join(tmpDir, 'src', 'main.py'), 'print("x")\n'); // totem-context: writing a python source fixture under tmpDir, not a git hook
    const rule = makeRule({
      engine: 'ast',
      astQuery: '(call_expression)',
      fileGlobs: ['**/*.py'],
      lessonHash: 'py-rule-hash',
    });
    const additions = [makeAddition('src/main.py', 'print("x")', 1)];

    let caught: unknown;
    try {
      await applyAstRulesToAdditions(ctx, [rule], additions, tmpDir);
    } catch (err) {
      caught = err;
    }
    // totem-context: narrowing a thrown error after toBeInstanceOf — not parsing untrusted input
    const te1 = caught as TotemError;
    expect(te1.code).toBe('STALE_MANIFEST');
    expect(te1.message).toMatch(/0\.0\.0/);
  });

  // totem-context: test fixture genuinely awaits async API (`applyAstRulesToAdditions`)
  it('surfaces STALE_MANIFEST when manifest is pre-1.27.0 (no cohort field)', async () => {
    // Pre-1.27.0 manifest shape: schema-valid but missing cohort.
    const totemDir = path.join(tmpDir, '.totem');
    fs.mkdirSync(totemDir, { recursive: true });
    // totem-context: writing a totem manifest fixture under tmpDir, not a git hook
    fs.writeFileSync(
      path.join(totemDir, 'installed-packs.json'),
      JSON.stringify({ version: 1, packs: [] }),
      'utf-8',
    );
    fs.writeFileSync(path.join(tmpDir, 'src', 'main.py'), 'print("x")\n'); // totem-context: writing a python source fixture under tmpDir, not a git hook
    const rule = makeRule({
      engine: 'ast',
      astQuery: '(call_expression)',
      fileGlobs: ['**/*.py'],
      lessonHash: 'py-rule-hash',
    });
    const additions = [makeAddition('src/main.py', 'print("x")', 1)];

    let caught: unknown;
    try {
      await applyAstRulesToAdditions(ctx, [rule], additions, tmpDir);
    } catch (err) {
      caught = err;
    }
    // totem-context: narrowing a thrown error after toBeInstanceOf — not parsing untrusted input
    const te2 = caught as TotemError;
    expect(te2.code).toBe('STALE_MANIFEST');
    expect(te2.message).toMatch(/pre-1\.27\.0/);
  });

  // totem-context: test fixture genuinely awaits async API
  it('does NOT throw when an unmapped-extension file is in the diff but no rule scopes to it', async () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'main.py'), 'print("x")\n'); // totem-context: writing a python source fixture under tmpDir, not a git hook
    fs.writeFileSync(path.join(tmpDir, 'src', 'app.ts'), 'const x = 1;\n'); // totem-context: writing a typescript source fixture under tmpDir, not a git hook

    // Rule scoped to .ts only; .py file in the diff has no rule that
    // cares about it. Silent skip on the .py file is correct behavior —
    // fail-loud is surgical to the case where a rule actually expected
    // to run.
    const rule = makeRule({
      engine: 'ast',
      astQuery: '(variable_declaration)',
      fileGlobs: ['**/*.ts'],
      lessonHash: 'ts-only-rule',
    });
    const additions = [
      makeAddition('src/main.py', 'print("x")', 1),
      makeAddition('src/app.ts', 'const x = 1;', 1),
    ];

    // No throw. Returns whatever the .ts rule produces; the key invariant
    // is "doesn't throw on unrelated unmapped files."
    await expect(applyAstRulesToAdditions(ctx, [rule], additions, tmpDir)).resolves.toEqual(
      expect.any(Array),
    );
  });

  // totem-context: test fixture genuinely awaits async API
  it('does NOT throw when rule has no fileGlobs at all (rule applies everywhere by default)', async () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'main.py'), 'print("x")\n'); // totem-context: writing a python source fixture under tmpDir, not a git hook
    const rule = makeRule({
      engine: 'ast',
      astQuery: '(variable_declaration)',
      fileGlobs: undefined,
      lessonHash: 'unscoped-rule',
    });
    const additions = [makeAddition('src/main.py', 'print("x")', 1)];

    // A rule with no fileGlobs doesn't claim any specific extension —
    // silent skip on unmapped extensions is the right behavior here.
    // Fail-loud is reserved for the explicit "I scope to .py" case.
    await expect(applyAstRulesToAdditions(ctx, [rule], additions, tmpDir)).resolves.toEqual([]);
  });
});

// ─── Rust Inline Test Module Exemption (#2397) ─────────────────────

describe('Rust Inline Test Module Exemption (#2397)', () => {
  it('isProductionRustRule identifies production-only Rust rules', () => {
    // Production Rust rule with explicit exclusions
    const rule1 = makeRule({
      fileGlobs: ['**/*.rs', '!**/tests/**', '!**/*test*.rs'],
      lessonHash: 'unwrap-rule',
    });
    expect(isProductionRustRule(rule1)).toBe(true);

    // Production Rust rule with implicit exclusions (no test globs matched)
    const rule2 = makeRule({
      fileGlobs: ['src/**/*.rs'],
      lessonHash: 'safe-rule',
    });
    expect(isProductionRustRule(rule2)).toBe(true);

    // Test-specific rule (targets test files)
    const rule3 = makeRule({
      fileGlobs: ['**/*test*.rs'],
      lessonHash: 'test-rule',
    });
    expect(isProductionRustRule(rule3)).toBe(false);

    // Non-Rust rule
    const rule4 = makeRule({
      fileGlobs: ['**/*.ts'],
      lessonHash: 'ts-rule',
    });
    expect(isProductionRustRule(rule4)).toBe(false);

    // Non-string fileGlobs (ast-grep compound object rules)
    const rule5 = makeRule({
      fileGlobs: ['**/*.rs', { pattern: 'src/**/*.rs' } as any, '!**/tests/**', '!**/*test*.rs'],
      lessonHash: 'unwrap-rule-obj',
    });
    expect(isProductionRustRule(rule5)).toBe(true);
  });

  it('getRustTestSpans parses Rust content to find #[cfg(test)] mod spans', () => {
    const code = `
fn prod_code() {
    let x = 1;
    let module_name = "test"; // offset test: 'module' starts with 'mod'
    let mode_active = true;   // offset test: 'mode' starts with 'mod'
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_something() {
        assert_eq!(1, 1);
    }
}

fn more_prod_code() {}

#[cfg(test)]
#[allow(non_snake_case)]
mod MoreTests {
    use super::*;
}

mod non_test_mod {
    // not exempt
}

#[cfg(test)]
mod external; // non-inline mod
`;

    const spans = getRustTestSpans(code);
    // There are 2 inline test modules
    expect(spans).toHaveLength(2);

    // First inline module: #[cfg(test)] mod tests
    // #[cfg(test)] is on line 8 (1-based)
    // Closing brace is on line 14
    expect(spans[0]).toEqual({ startLine: 8, endLine: 14 });

    // Second inline module: #[cfg(test)] mod MoreTests
    // #[cfg(test)] is on line 18
    // Closing brace is on line 22
    expect(spans[1]).toEqual({ startLine: 18, endLine: 22 });
  });

  it('getRustTestSpans: lifetimes are not char-literal openers; pub test mods are spanned', () => {
    // Regression (review round): the char-literal skip must not treat a
    // lifetime tick (`'a`, `'static`) as a string opener — swallowing braces
    // between two lifetimes corrupts depth tracking and mis-sizes the span
    // (over-exemption suppresses REAL violations after the test module).
    const code = `
#[cfg(test)]
mod tests {
    struct Wrap<'a> { inner: &'a str }
    fn mk<'a>(s: &'a str) -> Wrap<'a> { Wrap { inner: s } }
}

fn prod_after_mod() {
    let x = Some('x').unwrap();
}

#[cfg(test)]
pub mod pub_tests {
    use super::*;
}
`;
    const spans = getRustTestSpans(code);
    expect(spans).toHaveLength(2);
    // Lifetime-laden module closes on its real brace (line 6), so line 9's
    // production unwrap stays OUTSIDE every span.
    expect(spans[0]).toEqual({ startLine: 2, endLine: 6 });
    expect(spans[0]!.endLine).toBeLessThan(9);
    // `pub mod` after #[cfg(test)] is still a test module.
    expect(spans[1]).toEqual({ startLine: 12, endLine: 15 });
  });

  it('applyRulesToAdditions exempts regex violations inside inline Rust test modules', () => {
    const rule = makeRule({
      engine: 'regex',
      pattern: '\\.unwrap\\(\\)',
      fileGlobs: ['**/*.rs', '!**/tests/**', '!**/*test*.rs'],
      lessonHash: 'b2c3d4e5f6a70001',
    });

    const rsContent = `
fn prod_code() {
    let val = Some(1).unwrap(); // line 3, violation!
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_val() {
        let val = Some(1).unwrap(); // line 10, exempt!
    }
}
`;

    // Write file to temporary directory
    const filePath = 'src/lib.rs';
    fs.writeFileSync(path.join(tmpDir, filePath), rsContent, 'utf-8');

    const additions: DiffAddition[] = [
      {
        file: filePath,
        line: '    let val = Some(1).unwrap(); // line 3, violation!',
        lineNumber: 3,
        precedingLine: null,
      },
      {
        file: filePath,
        line: '        let val = Some(1).unwrap(); // line 10, exempt!',
        lineNumber: 10,
        precedingLine: null,
      },
    ];

    const violations = applyRulesToAdditions(ctx, [rule], additions, undefined, tmpDir);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.lineNumber).toBe(3);
  });

  // NOTE (review round): the original AST-path e2e test here asserted exemption
  // through a fixture no real rule can produce — Rust source in a `.ts` file
  // under `.ts` fileGlobs, reachable only via a production hardcode
  // (`lessonHash === 'unwrap-ast-rule'`) that existed to serve the fixture. Both
  // are removed. The AST-path exemption shares `isProductionRustRule` +
  // `getRustTestSpans` (unit-tested above) with the regex/bounded paths
  // (e2e-tested below); an honest AST e2e needs the Rust grammar registered,
  // which core's test env does not have (the #2308/#2387 language-pack lane).

  it('applyRulesToAdditionsBounded exempts bounded-regex violations inside Rust test modules', async () => {
    const { applyRulesToAdditionsBounded } = await import('./regex-safety/apply-rules-bounded.js');
    const { RegexEvaluator } = await import('./regex-safety/evaluator.js');

    const evaluator = new RegexEvaluator();
    try {
      const rule = makeRule({
        engine: 'regex',
        pattern: '\\.unwrap\\(\\)',
        fileGlobs: ['**/*.rs', '!**/tests/**', '!**/*test*.rs'],
        lessonHash: 'b2c3d4e5f6a70001',
      });

      const rsContent = `
fn prod_code() {
    let val = Some(1).unwrap(); // line 3, violation!
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_val() {
        let val = Some(1).unwrap(); // line 10, exempt!
    }
}
`;

      const filePath = 'src/lib.rs';
      fs.writeFileSync(path.join(tmpDir, filePath), rsContent, 'utf-8');

      const additions: DiffAddition[] = [
        {
          file: filePath,
          line: '    let val = Some(1).unwrap(); // line 3, violation!',
          lineNumber: 3,
          precedingLine: null,
        },
        {
          file: filePath,
          line: '        let val = Some(1).unwrap(); // line 10, exempt!',
          lineNumber: 10,
          precedingLine: null,
        },
      ];

      const result = await applyRulesToAdditionsBounded(ctx, [rule], additions, {
        evaluator,
        timeoutMode: 'strict',
        repoRoot: tmpDir,
      });

      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]?.lineNumber).toBe(3);
    } finally {
      evaluator.dispose();
    }
  });
});
