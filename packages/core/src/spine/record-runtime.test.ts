// ─── Prop 310 § Design 14 — conformance suite, slice 2: RUNTIME EVALUATION ───
//
// What a lowered record MEANS when `totem lint` runs. Three obligations:
//
//   § Design 7 — the two-array scope rule AND the dialect's own matching
//                semantics, including the "no silent promotion" clause slice 1
//                deferred to this slice: `*.ts` is ROOT-LEVEL, tree-wide is
//                written `**\/*.ts`. Slice 1 could only pin that a glob is
//                CARRIED verbatim; only a matcher can pin what it MEANS.
//   § Design 8 — the `requires:` two-pass, at both implemented scopes, positive
//                and negative, plus the end-to-end differential over the spec's
//                own exemplar (fire on `bad`, silent on `good` — ADR-112 §4).
//   Non-regression — the legacy corpus keeps the shipped matcher byte-for-byte.
//                    The record dialect is reachable ONLY through the § Design 12
//                    compiled homes, and the promotion tests below assert BOTH
//                    directions: promoted on the legacy path, not on the record
//                    path, from the same glob string.

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stringify as yamlStringify } from 'yaml';

import { type CompiledRule, CompiledRuleSchema, type DiffAddition } from '../compiler-schema.js';
import { applyRulesToAdditionsBounded } from '../regex-safety/apply-rules-bounded.js';
import { RegexEvaluator } from '../regex-safety/evaluator.js';
import {
  applyAstRulesToAdditions,
  applyRulesToAdditions,
  matchesGlob,
  type RuleEngineContext,
} from '../rule-engine.js';
import { verifyAgainstCodebase } from '../stage4-verifier.js';
import { matchesRecordGlob } from '../sys/glob.js';
import { design4ExemplarRecord, design8ExemplarRecord } from './record-exemplars.fixture.js';
import { compileRuleRecord } from './record-lower.js';
import {
  assertNoTornRecordRules,
  isRecordPathRule,
  recordScopeMatchesFile,
  requiresSuppressesMatch,
  ruleAppliesToFile,
} from './record-runtime.js';
import { parseRuleRecord } from './rule-record.js';
import { buildFirings } from './windtunnel-firing.js';

const FILE = '.totem/rules/exemplar.rule.yaml';
const RULE_ID = '0123456789abcdef';
const NOW = '2026-08-21T00:00:00.000Z';

function ctx(): RuleEngineContext {
  return { logger: { warn: () => {} }, state: { hasWarnedShieldContext: false } };
}

/** Parse (slice 1) → lower (slice 2). Throws on a rejection so a fixture defect is loud. */
function compile(record: Record<string, unknown>): CompiledRule {
  const outcome = compileRuleRecord(parseRuleRecord(yamlStringify(record), FILE), {
    ruleId: RULE_ID,
    now: NOW,
  });
  if (outcome.kind !== 'compiled') throw new Error(`fixture did not lower: ${outcome.reason}`);
  return outcome.rule;
}

function addition(file: string, line: string, lineNumber = 1): DiffAddition {
  return { file, line, lineNumber, precedingLine: null };
}

/** A record-path regex rule scoped to exactly the globs given. */
function scopedRegexRecord(fileGlobs: string[], excludeGlobs?: string[]): Record<string, unknown> {
  return {
    schemaVersion: 1,
    severity: 'error',
    message: 'no console.log',
    target: {
      type: 'regex',
      pattern: 'console\\.log',
      scope: { fileGlobs, ...(excludeGlobs ? { excludeGlobs } : {}) },
    },
    examples: [{ bad: 'console.log(1)', good: 'logger.info(1)' }],
  };
}

/** A LEGACY-shaped compiled rule: carries none of the § Design 12 homes. */
function legacyRule(fileGlobs: string[]): CompiledRule {
  return CompiledRuleSchema.parse({
    lessonHash: 'fedcba9876543210',
    lessonHeading: 'legacy rule',
    pattern: 'console\\.log',
    message: 'no console.log',
    engine: 'regex',
    severity: 'error',
    compiledAt: NOW,
    fileGlobs,
  });
}

// ─── F. § Design 7 — dialect semantics, and the silent-promotion half ────────

describe('§ Design 7 — the record dialect means what the glob says', () => {
  it('matches `*.ts` at ROOT LEVEL ONLY (no silent promotion)', () => {
    expect(matchesRecordGlob('a.ts', '*.ts')).toBe(true);
    expect(matchesRecordGlob('src/a.ts', '*.ts')).toBe(false);
    expect(matchesRecordGlob('packages/core/src/a.ts', '*.ts')).toBe(false);
  });

  it('matches `**\\/*.ts` TREE-WIDE, including the root', () => {
    expect(matchesRecordGlob('a.ts', '**/*.ts')).toBe(true);
    expect(matchesRecordGlob('src/a.ts', '**/*.ts')).toBe(true);
    expect(matchesRecordGlob('packages/core/src/a.ts', '**/*.ts')).toBe(true);
    expect(matchesRecordGlob('src/a.js', '**/*.ts')).toBe(false);
  });

  it('keeps the LEGACY matcher’s promotion byte-for-byte (the non-regression half)', () => {
    // Same glob string, opposite meaning, and that is the point: the shipped
    // rule-engine profile promotes a shallow glob tree-wide, which is exactly the
    // silent semantic rewrite § Design 7 removes — on the record path ONLY.
    expect(matchesGlob('src/a.ts', '*.ts')).toBe(true);
    expect(matchesGlob('a.ts', '*.ts')).toBe(true);
  });

  it('anchors segments: `**` is whole-segment and `packages/**` is a subtree', () => {
    expect(matchesRecordGlob('packages/core/src/a.ts', 'packages/**/*.ts')).toBe(true);
    expect(matchesRecordGlob('packages/a.ts', 'packages/**/*.ts')).toBe(true);
    expect(matchesRecordGlob('other/core/a.ts', 'packages/**/*.ts')).toBe(false);
    expect(matchesRecordGlob('packages/core/src/a.ts', 'packages/**')).toBe(true);
    expect(matchesRecordGlob('packages', 'packages/**')).toBe(false);
    // `*` never crosses a separator.
    expect(matchesRecordGlob('src/core/a.ts', 'src/*/a.ts')).toBe(true);
    expect(matchesRecordGlob('src/core/deep/a.ts', 'src/*/a.ts')).toBe(false);
  });

  it('is CASE-SENSITIVE against path names, regardless of host case-folding', () => {
    expect(matchesRecordGlob('a.ts', '*.TS')).toBe(false);
    expect(matchesRecordGlob('SRC/a.ts', 'src/*.ts')).toBe(false);
    expect(matchesRecordGlob('src/a.ts', 'src/*.ts')).toBe(true);
  });

  it('normalizes HOST separators on the path before evaluating', () => {
    // Records use `/` exclusively (a backslash in a glob is a parse error), and
    // "matchers normalize host separators before evaluation" — so a Windows-shaped
    // path still matches a `/`-written glob.
    expect(matchesRecordGlob('src\\a.ts', 'src/*.ts')).toBe(true);
    expect(matchesRecordGlob('packages\\core\\src\\a.ts', 'packages/**/*.ts')).toBe(true);
  });

  it('admits NO brace expansion (a hand-edited manifest cannot smuggle one in)', () => {
    expect(matchesRecordGlob('a.ts', '*.{ts,js}')).toBe(false);
    expect(matchesRecordGlob('a.{ts,js}', '*.{ts,js}')).toBe(true);
  });
});

// ─── G. § Design 7 — the two-array scope rule ────────────────────────────────

describe('§ Design 7 — a file is in scope iff it matches a positive and NO exclusion', () => {
  it('applies exclusions as POSITIVE-form globs (`positiveMatch && !excludeMatch`)', () => {
    const rule = compile(design4ExemplarRecord());
    expect(rule.excludeGlobs).toEqual(['**/*.test.ts']);
    expect(ruleAppliesToFile(rule, 'packages/core/src/a.ts')).toBe(true);
    expect(ruleAppliesToFile(rule, 'packages/core/src/a.test.ts')).toBe(false);
    expect(ruleAppliesToFile(rule, 'scripts/a.ts')).toBe(false);
  });

  it('needs a positive match first — an exclusion alone never widens scope', () => {
    expect(recordScopeMatchesFile('src/a.ts', ['src/*.ts'], ['**/*.test.ts'])).toBe(true);
    expect(recordScopeMatchesFile('src/a.test.ts', ['src/*.ts'], ['**/*.test.ts'])).toBe(false);
    expect(recordScopeMatchesFile('other/a.ts', ['src/*.ts'], undefined)).toBe(false);
    // Empty positives match NOTHING on the record path — never everything.
    expect(recordScopeMatchesFile('src/a.ts', [], undefined)).toBe(false);
    expect(recordScopeMatchesFile('src/a.ts', undefined, undefined)).toBe(false);
  });

  it('carries the no-promotion rule THROUGH the engine, not just the matcher', () => {
    // The end-to-end half of slice 1's deferred silent-promotion fixture: a
    // COMPILED `*.ts` scopes a real lint dispatch to the repo root, and the same
    // rule written `**\/*.ts` scopes it tree-wide. Same source line, same engine,
    // two globs — the only difference is what the dialect says they mean.
    const shallow = compile(scopedRegexRecord(['*.ts']));
    const deep = compile(scopedRegexRecord(['**/*.ts']));
    const hit = 'console.log(1)';

    expect(applyRulesToAdditions(ctx(), [shallow], [addition('a.ts', hit)])).toHaveLength(1);
    expect(applyRulesToAdditions(ctx(), [shallow], [addition('src/a.ts', hit)])).toEqual([]);
    expect(applyRulesToAdditions(ctx(), [deep], [addition('a.ts', hit)])).toHaveLength(1);
    expect(applyRulesToAdditions(ctx(), [deep], [addition('src/a.ts', hit)])).toHaveLength(1);

    // The legacy path from the SAME glob string still promotes — non-regression.
    expect(
      applyRulesToAdditions(ctx(), [legacyRule(['*.ts'])], [addition('src/a.ts', hit)]),
    ).toHaveLength(1);
  });

  it('applies exclusions through the engine as well as the predicate', () => {
    const rule = compile(scopedRegexRecord(['**/*.ts'], ['**/*.test.ts']));
    const hit = 'console.log(1)';
    expect(applyRulesToAdditions(ctx(), [rule], [addition('src/a.ts', hit)])).toHaveLength(1);
    expect(applyRulesToAdditions(ctx(), [rule], [addition('src/a.test.ts', hit)])).toEqual([]);
  });

  it('routes a LEGACY rule through the shipped predicate, `!`-negation included', () => {
    const legacy = legacyRule(['**/*.ts', '!**/*.test.ts']);
    expect(isRecordPathRule(legacy)).toBe(false);
    expect(ruleAppliesToFile(legacy, 'src/a.ts')).toBe(true);
    expect(ruleAppliesToFile(legacy, 'src/a.test.ts')).toBe(false);
    // Shipped unscoped behaviour: a rule with no globs applies everywhere.
    expect(ruleAppliesToFile(legacyRule([]), 'anything.rs')).toBe(true);
  });
});

// ─── H. § Design 8 — the requires two-pass ───────────────────────────────────

describe('§ Design 8 — requires fires on ABSENT context and stays silent on PRESENT', () => {
  const lineRule = compile(design8ExemplarRecord());
  const fileRule = compile({
    ...design8ExemplarRecord(),
    requires: { pattern: 'LC_ALL=C', scope: 'file' },
  });

  it('line scope — absent context suppresses nothing, present context suppresses', () => {
    expect(requiresSuppressesMatch(lineRule, { line: 'git log --oneline', file: () => null })).toBe(
      false,
    );
    expect(
      requiresSuppressesMatch(lineRule, {
        line: 'LC_ALL=C git log --oneline',
        file: () => null,
      }),
    ).toBe(true);
  });

  it('line scope is LINE-local — the same token elsewhere in the file does not count', () => {
    const elsewhere = ['LC_ALL=C echo hi', 'git log --oneline'].join('\n');
    expect(
      requiresSuppressesMatch(lineRule, {
        line: 'git log --oneline',
        file: () => elsewhere,
      }),
    ).toBe(false);
  });

  it('file scope — the requirement is satisfied ANYWHERE in the file', () => {
    const elsewhere = ['export LC_ALL=C', 'git log --oneline'].join('\n');
    expect(
      requiresSuppressesMatch(fileRule, { line: 'git log --oneline', file: () => elsewhere }),
    ).toBe(true);
    expect(
      requiresSuppressesMatch(fileRule, {
        line: 'git log --oneline',
        file: () => 'git log --oneline',
      }),
    ).toBe(false);
  });

  it('file scope with an UNREADABLE file fails toward FLAGGING, never suppression', () => {
    expect(requiresSuppressesMatch(fileRule, { line: 'git log --oneline', file: () => null })).toBe(
      false,
    );
  });

  it('never suppresses a rule that carries no requires block (every legacy rule)', () => {
    expect(
      requiresSuppressesMatch(legacyRule(['**/*.ts']), { line: 'anything', file: () => 'x' }),
    ).toBe(false);
  });

  it('fails LOUD on an uncompilable requires.pattern (a hand-edited manifest)', () => {
    const tampered = CompiledRuleSchema.parse({
      ...lineRule,
      requires: { pattern: '(', scope: 'line' },
    });
    expect(() => requiresSuppressesMatch(tampered, { line: 'x', file: () => null })).toThrow(
      /invalid `requires.pattern`/,
    );
  });
});

// ─── I. End-to-end through the rule engine ───────────────────────────────────

describe('end-to-end — parse → lower → evaluate (§ Design 8 exemplar, regex path)', () => {
  const rule = compile(design8ExemplarRecord());

  it('FIRES on its own `bad` example and stays SILENT on its `good`', () => {
    const bad = applyRulesToAdditions(
      ctx(),
      [rule],
      [addition('scripts/x.sh', 'git log --oneline')],
    );
    expect(bad).toHaveLength(1);
    expect(bad[0]!.rule.lessonHash).toBe(RULE_ID);

    const good = applyRulesToAdditions(
      ctx(),
      [rule],
      [addition('scripts/x.sh', 'LC_ALL=C git log --oneline')],
    );
    expect(good).toEqual([]);
  });

  it('emits NO rule event when the required context is present — silence, not suppression', () => {
    // § Design 8 makes the requirement part of the MATCH PREDICATE: a locus with
    // its context present is not a match, so it is neither a violation nor a
    // `suppress` telemetry row (which would misreport it as a directive escape).
    const events: string[] = [];
    applyRulesToAdditions(
      ctx(),
      [rule],
      [addition('scripts/x.sh', 'LC_ALL=C git log --oneline')],
      (kind) => events.push(kind),
    );
    expect(events).toEqual([]);

    const firing: string[] = [];
    applyRulesToAdditions(ctx(), [rule], [addition('scripts/x.sh', 'git log --oneline')], (kind) =>
      firing.push(kind),
    );
    expect(firing).toEqual(['trigger']);
  });

  it('respects the record dialect at dispatch — `**\\/*.sh` matches, other extensions do not', () => {
    expect(
      applyRulesToAdditions(ctx(), [rule], [addition('scripts/x.ts', 'git log --oneline')]),
    ).toEqual([]);
    expect(
      applyRulesToAdditions(ctx(), [rule], [addition('deep/nest/x.cjs', 'git log --oneline')]),
    ).toHaveLength(1);
  });
});

describe('end-to-end — a file-scoped requires reads the real file', () => {
  let workDir: string;

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-p310-'));
    fs.mkdirSync(path.join(workDir, 'scripts'), { recursive: true });
    fs.writeFileSync(
      path.join(workDir, 'scripts', 'pinned.sh'),
      ['export LC_ALL=C', 'git log --oneline'].join('\n'),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(workDir, 'scripts', 'unpinned.sh'),
      ['git log --oneline'].join('\n'),
      'utf-8',
    );
  });

  afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  const rule = compile({
    ...design8ExemplarRecord(),
    requires: { pattern: 'LC_ALL=C', scope: 'file' },
  });

  it('stays silent when the requirement is satisfied elsewhere in the file', () => {
    const violations = applyRulesToAdditions(
      ctx(),
      [rule],
      [addition('scripts/pinned.sh', 'git log --oneline', 2)],
      undefined,
      workDir,
    );
    expect(violations).toEqual([]);
  });

  it('fires when the file never satisfies the requirement', () => {
    const violations = applyRulesToAdditions(
      ctx(),
      [rule],
      [addition('scripts/unpinned.sh', 'git log --oneline')],
      undefined,
      workDir,
    );
    expect(violations).toHaveLength(1);
  });

  it('fires when the file cannot be read at all (fails toward flagging)', () => {
    const violations = applyRulesToAdditions(
      ctx(),
      [rule],
      [addition('scripts/absent.sh', 'git log --oneline')],
      undefined,
      workDir,
    );
    expect(violations).toHaveLength(1);
  });
});

describe('end-to-end — parse → lower → evaluate (§ Design 4 exemplar, ast-grep path)', () => {
  const rule = compile(design4ExemplarRecord());
  const example = design4ExemplarRecord().examples as { bad: string; good: string }[];
  const bad = example[0]!.bad;
  const good = example[0]!.good;

  async function run(file: string, source: string) {
    return applyAstRulesToAdditions(
      ctx(),
      [rule],
      [addition(file, source)],
      os.tmpdir(),
      undefined,
      undefined,
      async () => source,
    );
  }

  it('FIRES on its own `bad` example (ADR-112 §4 fire-on-preimage)', async () => {
    const violations = await run('packages/core/src/a.ts', bad);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.rule.lessonHash).toBe(RULE_ID);
    expect(violations[0]!.rule.message).toContain('fail-open catch is banned');
  });

  it('stays SILENT on its own `good` example (silent-on-postimage)', async () => {
    expect(await run('packages/core/src/a.ts', good)).toEqual([]);
  });

  it('honours `excludeGlobs` at dispatch — the same bad source in a test file is out of scope', async () => {
    expect(await run('packages/core/src/a.test.ts', bad)).toEqual([]);
  });

  it('honours the positive glob — the same bad source outside `packages/` is out of scope', async () => {
    expect(await run('scripts/a.ts', bad)).toEqual([]);
  });
});

// ─── Cure 1 — the requirement reads the bytes the lint is judging ────────────

describe('§ Design 8 — a file-scoped requirement honours the caller’s read seam', () => {
  let workDir: string;
  const rule = compile({
    ...design8ExemplarRecord(),
    requires: { pattern: 'LC_ALL=C', scope: 'file' },
  });
  const hit = addition('scripts/x.sh', 'git log --oneline');

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-p310-seam-'));
    fs.mkdirSync(path.join(workDir, 'scripts'), { recursive: true });
    // The WORKTREE satisfies the requirement.
    fs.writeFileSync(
      path.join(workDir, 'scripts', 'x.sh'),
      ['export LC_ALL=C', 'git log --oneline'].join('\n'),
      'utf-8',
    );
  });

  afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('FAIL-OPEN COUNTEREXAMPLE: context deleted in the staged edit is not excused by the worktree', () => {
    // Without the seam this is the hole: the requirement is satisfied on disk,
    // so the staged violation is suppressed and the commit passes. With the
    // staged reader threaded, the requirement is judged on the staged bytes and
    // the rule fires.
    expect(applyRulesToAdditions(ctx(), [rule], [hit], undefined, workDir)).toEqual([]);
    const staged = applyRulesToAdditions(
      ctx(),
      [rule],
      [hit],
      undefined,
      workDir,
      () => 'git log --oneline',
    );
    expect(staged).toHaveLength(1);
  });

  it('the inverse direction too: context added in the staged edit silences the rule', () => {
    const worktreeOnly = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-p310-inv-'));
    try {
      fs.mkdirSync(path.join(worktreeOnly, 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(worktreeOnly, 'scripts', 'x.sh'), 'git log --oneline', 'utf-8');
      expect(applyRulesToAdditions(ctx(), [rule], [hit], undefined, worktreeOnly)).toHaveLength(1);
      expect(
        applyRulesToAdditions(ctx(), [rule], [hit], undefined, worktreeOnly, () =>
          ['export LC_ALL=C', 'git log --oneline'].join('\n'),
        ),
      ).toEqual([]);
    } finally {
      fs.rmSync(worktreeOnly, { recursive: true, force: true });
    }
  });

  it('a reader that reports the file absent still FIRES (direction unchanged)', () => {
    expect(
      applyRulesToAdditions(ctx(), [rule], [hit], undefined, workDir, () => null),
    ).toHaveLength(1);
  });

  it('a reader that THROWS propagates — its failure contract is not swallowed', () => {
    // Staged mode's reader throws `STAGED_READ_FAILED` precisely so an unreadable
    // index entry surfaces; converting that to "context absent" would turn a loud
    // failure into a quiet one.
    expect(() =>
      applyRulesToAdditions(ctx(), [rule], [hit], undefined, workDir, () => {
        throw new Error('STAGED_READ_FAILED');
      }),
    ).toThrow(/STAGED_READ_FAILED/);
  });

  it('never consults the reader for a LINE-scoped requirement', () => {
    const lineRule = compile(design8ExemplarRecord());
    let calls = 0;
    applyRulesToAdditions(ctx(), [lineRule], [hit], undefined, workDir, () => {
      calls += 1;
      return null;
    });
    expect(calls).toBe(0);
  });
});

// ─── Cure 1 (extended) — the dispatcher `totem lint` actually uses ───────────

describe('applyRulesToAdditionsBounded — the record semantics reach the lint path', () => {
  it('applies the § Design 7 two-array scope, not the legacy predicate', async () => {
    // This dispatcher — not `applyRulesToAdditions` — is what `totem lint` runs
    // regex rules through. Without the shared predicate a record rule's
    // `excludeGlobs` is ignored here and its `*.ts` is promoted tree-wide: a
    // silent scope WIDENING on the only path that ships.
    const evaluator = new RegexEvaluator();
    try {
      const rule = compile(scopedRegexRecord(['*.ts'], ['**/*.test.ts']));
      const result = await applyRulesToAdditionsBounded(
        ctx(),
        [rule],
        [
          addition('a.ts', 'console.log(1)'),
          addition('src/a.ts', 'console.log(1)'),
          addition('a.test.ts', 'console.log(1)'),
        ],
        { evaluator, timeoutMode: 'strict', repoRoot: os.tmpdir() },
      );
      expect(result.violations.map((v) => v.file)).toEqual(['a.ts']);
    } finally {
      await evaluator.dispose();
    }
  });

  it('applies the § Design 8 two-pass, at line scope', async () => {
    const evaluator = new RegexEvaluator();
    try {
      const rule = compile(design8ExemplarRecord());
      const result = await applyRulesToAdditionsBounded(
        ctx(),
        [rule],
        [
          addition('scripts/a.sh', 'git log --oneline'),
          addition('scripts/b.sh', 'LC_ALL=C git log --oneline'),
        ],
        { evaluator, timeoutMode: 'strict', repoRoot: os.tmpdir() },
      );
      expect(result.violations.map((v) => v.file)).toEqual(['scripts/a.sh']);
    } finally {
      await evaluator.dispose();
    }
  });

  it('threads the staged reader into a FILE-scoped requirement', async () => {
    const evaluator = new RegexEvaluator();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-p310-bnd-'));
    try {
      fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'scripts', 'x.sh'),
        ['export LC_ALL=C', 'git log --oneline'].join('\n'),
        'utf-8',
      );
      const rule = compile({
        ...design8ExemplarRecord(),
        requires: { pattern: 'LC_ALL=C', scope: 'file' },
      });
      const additions = [addition('scripts/x.sh', 'git log --oneline')];
      const opts = { evaluator, timeoutMode: 'strict' as const, repoRoot: dir };

      // Worktree read: the requirement is satisfied → silent.
      const worktree = await applyRulesToAdditionsBounded(ctx(), [rule], additions, opts);
      expect(worktree.violations).toEqual([]);

      // Staged read: the requirement is gone from the index → fires.
      const staged = await applyRulesToAdditionsBounded(ctx(), [rule], additions, {
        ...opts,
        readStrategy: async () => 'git log --oneline',
      });
      expect(staged.violations).toHaveLength(1);
    } finally {
      await evaluator.dispose();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('leaves a LEGACY rule on the shipped predicate byte-for-byte', async () => {
    const evaluator = new RegexEvaluator();
    try {
      const result = await applyRulesToAdditionsBounded(
        ctx(),
        [legacyRule(['*.ts'])],
        [addition('src/a.ts', 'console.log(1)')],
        { evaluator, timeoutMode: 'strict', repoRoot: os.tmpdir() },
      );
      // Shallow-glob promotion survives on the legacy path.
      expect(result.violations).toHaveLength(1);
    } finally {
      await evaluator.dispose();
    }
  });
});

// ─── Torn-manifest guard (§ Design 12) ───────────────────────────────────────

describe('§ Design 12 — a rule that is neither record nor legacy fails LOUD', () => {
  function tornRule(extra: Record<string, unknown>): CompiledRule {
    return CompiledRuleSchema.parse({
      lessonHash: 'fedcba9876543210',
      lessonHeading: 'hand-edited torn rule',
      pattern: 'console\\.log',
      message: 'x',
      engine: 'regex',
      compiledAt: NOW,
      fileGlobs: ['**/*.ts'],
      ...extra,
    });
  }

  it('throws on a record home with no `examples` — the dropped constructs get a signal', () => {
    for (const extra of [
      { excludeGlobs: ['**/*.test.ts'] },
      { requires: { pattern: 'x', scope: 'line' } },
      { language: 'typescript' },
      { verificationShadow: { type: 'rego', source: 'p' } },
    ]) {
      expect(() => assertNoTornRecordRules([tornRule(extra)])).toThrow(
        /carries Prop 310 record field\(s\).*but no `examples`/s,
      );
    }
  });

  it('names the offending homes so the operator knows what would have been dropped', () => {
    expect(() =>
      assertNoTornRecordRules([
        tornRule({ excludeGlobs: ['**/*.test.ts'], language: 'typescript' }),
      ]),
    ).toThrow(/excludeGlobs, language/);
  });

  it('leaves a clean LEGACY rule and a clean RECORD rule untouched', () => {
    expect(() => assertNoTornRecordRules([legacyRule(['**/*.ts'])])).not.toThrow();
    expect(() => assertNoTornRecordRules([compile(design4ExemplarRecord())])).not.toThrow();
    expect(() => assertNoTornRecordRules([])).not.toThrow();
  });

  it('fires at DISPATCHER altitude on every regex path', async () => {
    const torn = tornRule({ excludeGlobs: ['**/*.test.ts'] });
    const hit = addition('src/a.ts', 'console.log(1)');
    expect(() => applyRulesToAdditions(ctx(), [torn], [hit])).toThrow(/no `examples`/);

    const evaluator = new RegexEvaluator();
    try {
      await expect(
        applyRulesToAdditionsBounded(ctx(), [torn], [hit], {
          evaluator,
          timeoutMode: 'strict',
          repoRoot: os.tmpdir(),
        }),
      ).rejects.toThrow(/no `examples`/);
    } finally {
      await evaluator.dispose();
    }
  });
});

// ─── Certification seams — Stage 4 and the wind tunnel ───────────────────────

describe('Stage 4 — record scope is visible, and “unscoped” does not invert', () => {
  // An EMPTY baseline, so every classification below is the RULE's scope talking
  // and nothing else. Regex engine on purpose: this is a scope-classification
  // test, and routing it through ast-grep would add a parser to the equation.
  const emptyBaseline = {
    excludeFileGlobs: [],
    extendedFromIgnoreFile: [],
    extendedFromConfig: [],
    excludedFromConfig: [],
  };
  const record = compile(scopedRegexRecord(['packages/**/*.ts'], ['**/*.test.ts']));

  function deps(file: string, content: string) {
    return {
      listFiles: async () => [file],
      readFile: async () => content,
      workingDirectory: os.tmpdir(),
    };
  }

  it('classifies an EXCLUDED file as out-of-scope instead of over-broad firing', async () => {
    // Passing bare `rule.fileGlobs` made `excludeGlobs` structurally invisible
    // here, so a hit on a file the rule's own scope EXCLUDES read as an in-scope
    // match — the rule looked over-broad because of a scope it never had.
    const result = await verifyAgainstCodebase(
      record,
      emptyBaseline,
      deps('packages/core/src/a.test.ts', 'console.log(1)\n'),
    );
    expect(result.outcome).toBe('out-of-scope');
  });

  it('still finds an IN-SCOPE match — the strip does not zero the record path', async () => {
    // The inversion this guards: `runRuleAgainstAllFiles` expresses "fires
    // everywhere" as ABSENT `fileGlobs`, which means include-all on the legacy
    // matcher and match-NOTHING on the record dialect. Unfixed, every record rule
    // Stage 4 ever verified would have reported `no-matches`.
    const result = await verifyAgainstCodebase(
      record,
      emptyBaseline,
      deps('packages/core/src/a.ts', 'console.log(1)\n'),
    );
    expect(result.outcome).not.toBe('no-matches');
    expect(result.baselineMatches).toEqual([]);
  });

  it('leaves a LEGACY rule’s classification byte-identical', async () => {
    const result = await verifyAgainstCodebase(
      legacyRule(['**/*.ts']),
      emptyBaseline,
      deps('src/a.ts', 'console.log(1)\n'),
    );
    expect(result.outcome).not.toBe('no-matches');
    expect(result.outcome).not.toBe('out-of-scope');
  });
});

describe('wind tunnel — a file-scoped requirement reads the POST-IMAGE', () => {
  const rule = compile({
    ...design8ExemplarRecord(),
    requires: { pattern: 'LC_ALL=C', scope: 'file' },
  });
  const diff = [
    'diff --git a/scripts/x.sh b/scripts/x.sh',
    '--- a/scripts/x.sh',
    '+++ b/scripts/x.sh',
    '@@ -1,1 +1,1 @@',
    '+git log --oneline',
    '',
  ].join('\n');

  async function fire(postImage: string) {
    return buildFirings({
      rules: [rule],
      prDiffs: [{ pr: 1, diff, controlKind: 'corpus' as const }],
      cwd: os.tmpdir(),
      readStrategy: async () => postImage,
      ruleEngineCtx: ctx(),
    });
  }

  it('stays silent when the POST-IMAGE satisfies the requirement', async () => {
    const result = await fire(['export LC_ALL=C', 'git log --oneline'].join('\n'));
    expect(result.firings).toEqual([]);
  });

  it('fires when the POST-IMAGE does not — the local worktree never decides', async () => {
    // The seam this closes: `applyRulesToAdditions` was called with five args, so
    // the requirement was judged against whatever happened to be on the
    // certifying machine's disk rather than the PR's post-image — the same class
    // of divergence as the staged-read hole, in the certification corpus.
    const result = await fire('git log --oneline');
    expect(result.firings).toHaveLength(1);
    expect(result.firings[0]!.ruleId).toBe(RULE_ID);
  });
});

// ─── Fail-loud backstop on the unevaluated branch ────────────────────────────

describe('§ Design 12 — `requires` is never silently unevaluated', () => {
  it('throws when a tree-sitter rule carries a requires block', async () => {
    const astRule = CompiledRuleSchema.parse({
      lessonHash: 'fedcba9876543210',
      lessonHeading: 'hand-edited ast rule',
      pattern: '',
      message: 'x',
      engine: 'ast',
      astQuery: '(call_expression) @c',
      compiledAt: NOW,
      // `examples` present, so this is a well-formed RECORD-shaped rule on the
      // wrong engine — it reaches the tree-sitter backstop rather than being
      // caught upstream as a torn manifest.
      examples: [{ bad: 'b', good: 'g' }],
      requires: { pattern: 'LC_ALL=C', scope: 'line' },
    });
    await expect(
      applyAstRulesToAdditions(
        ctx(),
        [astRule],
        [addition('src/a.ts', 'foo()')],
        os.tmpdir(),
        undefined,
        undefined,
        async () => 'foo()',
      ),
    ).rejects.toThrow(/has no two-pass evaluator/);
  });

  it('throws even when the ast rule carries NO astQuery (the widened search)', async () => {
    // The backstop searched `treeSitterRules`, which is pre-filtered on
    // `astQuery` being present — so this shape slipped past the throw and had its
    // `requires` silently unevaluated, which is the exact hole the backstop
    // exists to close.
    const astRule = CompiledRuleSchema.parse({
      lessonHash: 'fedcba9876543210',
      lessonHeading: 'hand-edited ast rule, no query',
      pattern: '',
      message: 'x',
      engine: 'ast',
      compiledAt: NOW,
      examples: [{ bad: 'b', good: 'g' }],
      requires: { pattern: 'LC_ALL=C', scope: 'file' },
    });
    await expect(
      applyAstRulesToAdditions(
        ctx(),
        [astRule],
        [addition('src/a.ts', 'foo()')],
        os.tmpdir(),
        undefined,
        undefined,
        async () => 'foo()',
      ),
    ).rejects.toThrow(/has no two-pass evaluator/);
  });
});
