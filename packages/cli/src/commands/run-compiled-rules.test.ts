import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompiledRule, TotemConfig } from '@mmnto/totem';
import * as totem from '@mmnto/totem';
import { readLedgerEvents, saveCompiledRules, TotemError, TotemParseError } from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import { runCompiledRules } from './run-compiled-rules.js';

// ─── Helpers ─────────────────────────────────────────

const TOTEM_DIR = '.totem';

function makeRule(
  pattern: string,
  message: string,
  heading: string,
  overrides: Partial<CompiledRule> = {},
): CompiledRule {
  return {
    lessonHash: 'test' + Math.random().toString(36).slice(2, 10),
    lessonHeading: heading,
    pattern,
    message,
    engine: 'regex',
    compiledAt: new Date().toISOString(),
    ...overrides,
  };
}

/** Build a minimal unified diff that adds a single line in the given file. */
function makeDiff(file: string, addedLine: string, precedingLine?: string): string {
  const contextLine = precedingLine ?? ' // existing code';
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,3 +1,4 @@`,
    contextLine,
    `+${addedLine}`,
    ` // end`,
  ].join('\n');
}

/** Save compiled rules to the .totem directory inside tmpDir. */
function writeRules(tmpDir: string, rules: CompiledRule[]): void {
  const rulesPath = path.join(tmpDir, TOTEM_DIR, 'compiled-rules.json');
  saveCompiledRules(rulesPath, rules);
}

// ─── Tests ───────────────────────────────────────────

describe('runCompiledRules', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-rcr-'));
    fs.mkdirSync(path.join(tmpDir, TOTEM_DIR), { recursive: true });
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  // ─── Regex matching ──────────────────────────────────

  it('detects a regex violation but treats it as advisory — no throw (mmnto-ai/totem#2181)', async () => {
    const rules = [makeRule('console\\.log', 'Remove debug logging', 'No console.log')];
    writeRules(tmpDir, rules);

    const diff = makeDiff('src/app.ts', '  console.log("debug");');

    // mmnto-ai/totem#2181: regex-engine (frozen-lesson) rules are advisory. The
    // violation is still detected and printed, but it does NOT block — no throw,
    // exit 0, counted as a (non-blocking) warning.
    const result = await runCompiledRules({
      diff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'json',
      tag: 'Test',
    });

    expect(result.violations).toHaveLength(1);
    const parsed = JSON.parse(result.output);
    expect(parsed.pass).toBe(true);
    expect(parsed.errors).toBe(0);
    expect(parsed.warnings).toBe(1);
  });

  it('returns no violations when regex does not match', async () => {
    const rules = [makeRule('console\\.log', 'Remove debug logging', 'No console.log')];
    writeRules(tmpDir, rules);

    const diff = makeDiff('src/app.ts', '  const x = 42;');

    const result = await runCompiledRules({
      diff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'text',
      tag: 'Test',
    });

    expect(result.violations).toHaveLength(0);
  });

  // ─── Empty rules ─────────────────────────────────────

  // totem-context: runCompiledRules is genuinely async (it awaits internal dynamic imports + safeExec); test runs in <100ms so the orchestrator-tier 15s timeout rule does not apply
  it('returns empty result and skips gracefully when compiled-rules.json has no rules (mmnto-ai/totem#1831)', async () => {
    // Empty corpus is a legitimate state for early-adoption repos.
    const rulesPath = path.join(tmpDir, TOTEM_DIR, 'compiled-rules.json');
    fs.writeFileSync(rulesPath, JSON.stringify({ version: 1, rules: [] }));

    const diff = makeDiff('src/app.ts', '  const x = 1;');

    const result = await runCompiledRules({
      diff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'text',
      tag: 'Test',
    });

    expect(result.violations).toHaveLength(0);
    expect(result.findings).toHaveLength(0);
    expect(result.rules).toHaveLength(0);
    expect(result.regexTimeouts).toHaveLength(0);
    expect(result.output).toBe('');
  });

  // ─── Suppression via totem-ignore ────────────────────

  it('suppresses violation on line with totem-ignore comment', async () => {
    const rules = [makeRule('console\\.log', 'Remove debug logging', 'No console.log')];
    writeRules(tmpDir, rules);

    const diff = makeDiff('src/app.ts', '  console.log("ok"); // totem-ignore');

    const result = await runCompiledRules({
      diff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'json',
      tag: 'Test',
    });

    expect(result.violations).toHaveLength(0);
    const parsed = JSON.parse(result.output);
    expect(parsed.pass).toBe(true);
  });

  it('suppresses violation on line after totem-ignore-next-line', async () => {
    const rules = [makeRule('console\\.log', 'Remove debug logging', 'No console.log')];
    writeRules(tmpDir, rules);

    // Build diff where preceding context line contains the suppression directive
    const diff = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,3 +1,5 @@',
      ' // setup',
      '+// totem-ignore-next-line',
      '+  console.log("suppressed");',
      ' // end',
    ].join('\n');

    const result = await runCompiledRules({
      diff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'json',
      tag: 'Test',
    });

    expect(result.violations).toHaveLength(0);
  });

  // ─── File glob filtering ─────────────────────────────

  it('skips files that do not match fileGlobs', async () => {
    const rules = [
      makeRule('TODO', 'No TODOs in shell scripts', 'No TODOs in shell', {
        fileGlobs: ['*.sh'],
      }),
    ];
    writeRules(tmpDir, rules);

    // Diff with a .ts file — should NOT match the shell-only rule
    const tsDiff = makeDiff('src/app.ts', '  // TODO: fix later');

    const tsResult = await runCompiledRules({
      diff: tsDiff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'json',
      tag: 'Test',
    });

    expect(tsResult.violations).toHaveLength(0);
  });

  it('applies rule when file matches fileGlobs', async () => {
    const rules = [
      makeRule('TODO', 'No TODOs in shell scripts', 'No TODOs in shell', {
        fileGlobs: ['*.sh'],
      }),
    ];
    writeRules(tmpDir, rules);

    // Diff with a .sh file — should match the shell-only rule
    const shDiff = makeDiff('scripts/build.sh', '# TODO: fix later');

    // mmnto-ai/totem#2181: the glob still matches and the regex violation is
    // recorded, but it is advisory (non-blocking) — no throw.
    const result = await runCompiledRules({
      diff: shDiff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'json',
      tag: 'Test',
    });

    expect(result.violations).toHaveLength(1);
    expect(JSON.parse(result.output).pass).toBe(true);
  });

  // ─── Output formats ─────────────────────────────────

  it('produces JSON output with correct structure for clean pass', async () => {
    const rules = [makeRule('badPattern', 'Found bad pattern', 'Bad pattern rule')];
    writeRules(tmpDir, rules);

    // Diff that does NOT match the rule — clean pass
    const diff = makeDiff('src/index.ts', '  goodPattern();');

    const result = await runCompiledRules({
      diff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'json',
      tag: 'Test',
    });

    const parsed = JSON.parse(result.output);
    expect(parsed).toHaveProperty('pass', true);
    expect(parsed).toHaveProperty('rules', 1);
    expect(parsed).toHaveProperty('errors', 0);
    expect(parsed).toHaveProperty('warnings', 0);
    expect(parsed).toHaveProperty('violations');
    expect(parsed.violations).toHaveLength(0);
  });

  it('throws SHIELD_FAILED for ast-grep (hard-engine) error-severity violations (mmnto-ai/totem#2181)', async () => {
    // ast/ast-grep is the hard engine that STAYS blocking under #2181.
    const rules = [
      makeRule('console\\.log\\("foo"\\)', 'No foo log', 'No foo log', {
        engine: 'ast-grep',
        astGrepPattern: 'console.log("foo")',
      }),
    ];
    writeRules(tmpDir, rules);

    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.ts'),
      '// context\n  console.log("foo");\n// context\n',
    );

    const diff = makeDiff('src/app.ts', '  console.log("foo");');

    await expect(
      runCompiledRules({
        diff,
        cwd: tmpDir,
        totemDir: TOTEM_DIR,
        format: 'text',
        tag: 'Test',
      }),
    ).rejects.toThrow('Violations detected');
  });

  // ─── Warning severity (PASS with warnings) ──────────

  it('passes with warnings when violations are warning-severity only', async () => {
    const rules = [
      makeRule('TODO', 'Consider removing TODOs', 'TODO cleanup', {
        severity: 'warning',
      }),
    ];
    writeRules(tmpDir, rules);

    const diff = makeDiff('src/app.ts', '  // TODO: clean up later');

    const result = await runCompiledRules({
      diff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'json',
      tag: 'Test',
    });

    const parsed = JSON.parse(result.output);
    expect(parsed.pass).toBe(true);
    expect(parsed.warnings).toBe(1);
    expect(parsed.errors).toBe(0);
    expect(result.violations).toHaveLength(1);
  });

  // ─── Multiple rules ─────────────────────────────────

  it('applies multiple rules and reports all violations', async () => {
    const rules = [
      makeRule('console\\.log', 'Remove debug logging', 'No console.log'),
      makeRule('catch\\s*\\(\\s*error\\b', 'Use err not error in catch', 'Use err not error'),
    ];
    writeRules(tmpDir, rules);

    const diff = [
      'diff --git a/src/handler.ts b/src/handler.ts',
      '--- a/src/handler.ts',
      '+++ b/src/handler.ts',
      '@@ -1,3 +1,6 @@',
      ' export function handler() {',
      '+  console.log("debug");',
      '+  try { work(); } catch (error) {',
      '+    console.log(error);',
      '+  }',
      ' }',
    ].join('\n');

    // mmnto-ai/totem#2181: both rules are regex-engine → advisory. All violations
    // are still reported, but the run does not block (no throw, pass true).
    const result = await runCompiledRules({
      diff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'json',
      tag: 'Test',
    });

    expect(result.violations.length).toBeGreaterThanOrEqual(2);
    const parsed = JSON.parse(result.output);
    expect(parsed.pass).toBe(true);
    expect(parsed.errors).toBe(0);
  });

  // ─── Engine-type advisory split (mmnto-ai/totem#2181) ─────────

  it('mixed run: the ast-grep error blocks even though the regex match is advisory', async () => {
    const rules = [
      // regex-engine → advisory (matches console.log on the added line)
      makeRule('console\\.log', 'regex advisory', 'Regex rule'),
      // ast-grep-engine → hard (matches the same line structurally)
      makeRule('console\\.log\\("foo"\\)', 'No foo log', 'No foo log', {
        engine: 'ast-grep',
        astGrepPattern: 'console.log("foo")',
      }),
    ];
    writeRules(tmpDir, rules);

    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.ts'),
      '// context\n  console.log("foo");\n// context\n',
    );
    const diff = makeDiff('src/app.ts', '  console.log("foo");');

    // The regex match alone would not block; the ast-grep error makes the run fail.
    await expect(
      runCompiledRules({
        diff,
        cwd: tmpDir,
        totemDir: TOTEM_DIR,
        format: 'text',
        tag: 'Test',
      }),
    ).rejects.toThrow('Violations detected');
  });

  it('emits the frozen-lesson advisory note when a regex advisory is present (mmnto-ai/totem#2182)', async () => {
    const rules = [makeRule('console\\.log', 'Remove debug logging', 'No console.log')];
    writeRules(tmpDir, rules);

    const diff = makeDiff('src/app.ts', '  console.log("debug");');

    const result = await runCompiledRules({
      diff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'text',
      tag: 'Test',
    });

    expect(result.output).toContain('sensed-not-enforced');
  });

  it('does NOT emit the frozen-lesson note for an ast-grep warning-only run (gemini #2182)', async () => {
    // ast-grep severity:warning lands in `warnings` too, but it is NOT a
    // frozen-lesson regex advisory — the note must not mislabel it.
    const rules = [
      makeRule('console\\.log\\("foo"\\)', 'No foo log', 'No foo log', {
        engine: 'ast-grep',
        astGrepPattern: 'console.log("foo")',
        severity: 'warning',
      }),
    ];
    writeRules(tmpDir, rules);

    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.ts'),
      '// context\n  console.log("foo");\n// context\n',
    );
    const diff = makeDiff('src/app.ts', '  console.log("foo");');

    const result = await runCompiledRules({
      diff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'text',
      tag: 'Test',
    });

    expect(result.violations).toHaveLength(1);
    expect(result.output).not.toContain('sensed-not-enforced');
  });

  // ─── Excluded files ──────────────────────────────────

  it('excludes compiled-rules.json from scanning', async () => {
    const rules = [makeRule('pattern', 'Found pattern in rules file', 'Self-match prevention')];
    writeRules(tmpDir, rules);

    // Diff that changes the compiled-rules.json itself
    const diff = makeDiff('.totem/compiled-rules.json', '  "pattern": "pattern"');

    const result = await runCompiledRules({
      diff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'json',
      tag: 'Test',
    });

    expect(result.violations).toHaveLength(0);
  });

  it('excludes binary files from scanning', async () => {
    const rules = [
      makeRule('console\\.log\\("foo"\\)', 'No foo log', 'No foo log', {
        engine: 'ast-grep',
        astGrepPattern: 'console.log("foo")',
      }),
    ];
    writeRules(tmpDir, rules);

    // Diff that changes a binary file (.png)
    const diff = makeDiff('assets/logo.png', '  console.log("foo");');

    const result = await runCompiledRules({
      diff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'json',
      tag: 'Test',
    });

    expect(result.violations).toHaveLength(0);
  });

  // ─── Ignore patterns ────────────────────────────────

  // ─── SARIF output ──────────────────────────────────

  it('SARIF output excludes advisory (non-blocking) findings, emitting only a summary note (mmnto-ai/totem#2181)', async () => {
    // Both a regex error-severity finding (now advisory under #2181) and a
    // warning-severity finding are non-blocking, so neither appears as a SARIF
    // result annotation — only the single summary note does. No throw.
    const rules = [
      makeRule('errorPattern', 'This is a regex error', 'Error rule', { severity: 'error' }),
      makeRule('warnPattern', 'This is a warning', 'Warning rule', { severity: 'warning' }),
    ];
    writeRules(tmpDir, rules);

    const diff = [
      'diff --git a/src/app.ts b/src/app.ts',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,3 +1,5 @@',
      ' // existing code',
      '+  errorPattern();',
      '+  warnPattern();',
      ' // end',
    ].join('\n');

    const result = await runCompiledRules({
      diff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'sarif',
      tag: 'Test',
    });

    const sarif = JSON.parse(result.output);
    const results = sarif.runs[0].results;
    // Non-blocking findings produce a single summary note, not individual annotations.
    expect(results).toHaveLength(1);
    expect(results[0].level).toBe('note');
    expect(results[0].ruleId).toBe('totem/warning-summary');
    // Tightened back (greptile #2182): assert the corrected, accurate message and
    // guard against regressing to the stale "warning-severity" label — the bucket
    // now includes regex error-severity findings demoted to advisory. Both rules are
    // regex, so the frozen-lesson mention IS present.
    expect(results[0].message.text).toContain('advisory (non-blocking) finding(s) detected');
    expect(results[0].message.text).not.toContain('warning-severity');
    expect(results[0].message.text).toContain('frozen-lesson');
    expect(results[0].message.text).toContain('totem lint');
  });

  it('SARIF advisory note omits the frozen-lesson mention for an ast-grep warning-only run (greptile #2182)', async () => {
    // ast-grep severity:warning is non-blocking but NOT a frozen-lesson regex
    // advisory — the SARIF summary must not claim frozen-lesson regex rules.
    const rules = [
      makeRule('console\\.log\\("foo"\\)', 'No foo log', 'No foo log', {
        engine: 'ast-grep',
        astGrepPattern: 'console.log("foo")',
        severity: 'warning',
      }),
    ];
    writeRules(tmpDir, rules);

    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.ts'),
      '// context\n  console.log("foo");\n// context\n',
    );
    const diff = makeDiff('src/app.ts', '  console.log("foo");');

    const result = await runCompiledRules({
      diff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'sarif',
      tag: 'Test',
    });

    const sarif = JSON.parse(result.output);
    const results = sarif.runs[0].results;
    expect(results).toHaveLength(1);
    expect(results[0].message.text).toContain('advisory (non-blocking) finding(s) detected');
    expect(results[0].message.text).not.toContain('frozen-lesson');
  });

  // ─── Ignore patterns ────────────────────────────────

  it('respects ignorePatterns to skip matching files', async () => {
    const rules = [makeRule('TODO', 'No TODOs', 'No TODOs')];
    writeRules(tmpDir, rules);

    const diff = makeDiff('vendor/lib.ts', '  // TODO: third party');

    const result = await runCompiledRules({
      diff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'json',
      tag: 'Test',
      ignorePatterns: ['vendor/**'],
    });

    expect(result.violations).toHaveLength(0);
  });

  // ─── Trap Ledger integration ──────────────────────────

  it('writes suppress event to trap ledger when totem-ignore is encountered', async () => {
    const rules = [
      makeRule('console\\.log', 'Remove debug logging', 'No console.log', {
        lessonHash: 'ledger-suppress-test',
      }),
    ];
    writeRules(tmpDir, rules);

    const diff = makeDiff('src/app.ts', '  console.log("ok"); // totem-ignore');

    const result = await runCompiledRules({
      diff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'json',
      tag: 'Test',
    });

    expect(result.violations).toHaveLength(0);

    const resolvedTotemDir = path.join(tmpDir, TOTEM_DIR);
    const events = readLedgerEvents(resolvedTotemDir);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('suppress');
    expect(events[0]!.ruleId).toBe('ledger-suppress-test');
    expect(events[0]!.file).toBe('src/app.ts');
    expect(events[0]!.justification).toBe('');
    expect(events[0]!.source).toBe('lint');
  });

  // ─── RuleEngineContext wiring (mmnto/totem#1441) ────

  it('threads a RuleEngineContext with a working warn logger into the bounded regex path', async () => {
    // mmnto-ai/totem#1641 swapped the runtime regex path from the sync
    // `applyRulesToAdditions` to the bounded worker-backed
    // `applyRulesToAdditionsBounded`. The test spies on the new function
    // to confirm the RuleEngineContext still threads through correctly.
    const spy = vi.spyOn(totem, 'applyRulesToAdditionsBounded');
    try {
      const rules = [makeRule('neverMatchXYZ123', 'No match', 'No match rule')];
      writeRules(tmpDir, rules);

      const diff = makeDiff('src/app.ts', '  const x = 1;');

      await runCompiledRules({
        diff,
        cwd: tmpDir,
        totemDir: TOTEM_DIR,
        format: 'json',
        tag: 'Test',
      });

      // First positional arg is the RuleEngineContext — verify it carries a
      // callable warn method and a fresh hasWarnedShieldContext flag.
      expect(spy).toHaveBeenCalled();
      const ctxArg = spy.mock.calls[0]![0];
      expect(ctxArg).toHaveProperty('logger');
      expect(typeof ctxArg.logger.warn).toBe('function');
      expect(ctxArg.state.hasWarnedShieldContext).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  // ─── Zero-match rule detection (#1061) ──────────────

  it('logs dim message when rules have fileGlobs that match no diff files', async () => {
    const rules = [
      makeRule('TODO', 'No TODOs in shell scripts', 'No TODOs in shell', {
        fileGlobs: ['*.sh'],
      }),
      makeRule('console\\.log', 'Remove debug logging', 'No console.log'),
    ];
    writeRules(tmpDir, rules);

    // Diff only has a .ts file — the *.sh rule should be zero-match
    const diff = makeDiff('src/app.ts', '  const x = 1;');

    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await runCompiledRules({
        diff,
        cwd: tmpDir,
        totemDir: TOTEM_DIR,
        format: 'json',
        tag: 'Test',
      });

      const dimMessages = stderrSpy.mock.calls.map((c) => c[0] as string);
      const zeroMatchMsg = dimMessages.find((m) => m.includes('rule(s) matched no files'));
      expect(zeroMatchMsg).toBeDefined();
      expect(zeroMatchMsg).toContain('1 rule(s)');
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('does not log zero-match message when all rules match diff files', async () => {
    const rules = [
      makeRule('TODO', 'No TODOs in TS', 'No TODOs', {
        fileGlobs: ['*.ts'],
      }),
    ];
    writeRules(tmpDir, rules);

    const diff = makeDiff('src/app.ts', '  const x = 1;');

    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await runCompiledRules({
        diff,
        cwd: tmpDir,
        totemDir: TOTEM_DIR,
        format: 'json',
        tag: 'Test',
      });

      const dimMessages = stderrSpy.mock.calls.map((c) => c[0] as string);
      const zeroMatchMsg = dimMessages.find((m) => m.includes('rule(s) matched no files'));
      expect(zeroMatchMsg).toBeUndefined();
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('does not count rules without fileGlobs as zero-match', async () => {
    const rules = [makeRule('neverMatchXYZ123', 'Will not match', 'No match rule')];
    writeRules(tmpDir, rules);

    const diff = makeDiff('src/app.ts', '  const x = 1;');

    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await runCompiledRules({
        diff,
        cwd: tmpDir,
        totemDir: TOTEM_DIR,
        format: 'json',
        tag: 'Test',
      });

      const dimMessages = stderrSpy.mock.calls.map((c) => c[0] as string);
      const zeroMatchMsg = dimMessages.find((m) => m.includes('rule(s) matched no files'));
      expect(zeroMatchMsg).toBeUndefined();
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('writes override event to trap ledger when totem-context is encountered', async () => {
    const rules = [
      makeRule('console\\.log', 'Remove debug logging', 'No console.log', {
        lessonHash: 'ledger-override-test',
      }),
    ];
    writeRules(tmpDir, rules);

    const diff = makeDiff(
      'src/app.ts',
      '  console.log("ok"); // totem-context: needed for monitoring',
    );

    const result = await runCompiledRules({
      diff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'json',
      tag: 'Test',
    });

    expect(result.violations).toHaveLength(0);

    const resolvedTotemDir = path.join(tmpDir, TOTEM_DIR);
    const events = readLedgerEvents(resolvedTotemDir);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('override');
    expect(events[0]!.ruleId).toBe('ledger-override-test');
    expect(events[0]!.file).toBe('src/app.ts');
    expect(events[0]!.justification).toBe('needed for monitoring');
    expect(events[0]!.source).toBe('lint');
  });

  // ─── readStrategy / isStaged ────────────────────────

  describe('readStrategy / isStaged', () => {
    it('constructs readStrategy and reads staged content via the underlying staged read when isStaged is true', async () => {
      const rules = [
        makeRule('console\\.log\\("foo"\\)', 'No foo log', 'No foo log', {
          engine: 'ast-grep',
          astGrepPattern: 'console.log("foo")',
        }),
      ];
      writeRules(tmpDir, rules);

      const diff = makeDiff('src/app.ts', '  console.log("foo");');

      const mockResolveGitRoot = vi.spyOn(totem, 'resolveGitRoot').mockReturnValue(tmpDir);

      const mockExec = vi
        .spyOn(totem, 'safeExec')
        .mockImplementation((cmd: string, args?: string[]) => {
          if (!args) return '';
          if (args[0] === 'ls-files' && args[1] === '--recurse-submodules' && args[2] === '-s') {
            return '100644 hash 0\tsrc/app.ts\n';
          }
          if (args[0] === 'show') {
            return '// context\n  console.log("foo");\n// context\n';
          }
          return '';
        });

      let violations: unknown[] = [];
      try {
        const result = await runCompiledRules({
          diff,
          cwd: tmpDir,
          totemDir: TOTEM_DIR,
          format: 'json',
          tag: 'Test',
          isStaged: true,
        });
        violations = result.violations;
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          err.name === 'TotemError' &&
          err.message.includes('Violations detected')
        ) {
          violations = [1]; // We just need to know it matched
        } else {
          throw err;
        }
      }

      expect(violations).toHaveLength(1);
      mockResolveGitRoot.mockRestore();
      mockExec.mockRestore();
    });

    it('filters symlinks via the underlying index check mode 120000', async () => {
      const rules = [
        makeRule('console\\.log\\("foo"\\)', 'No foo log', 'No foo log', {
          engine: 'ast-grep',
          astGrepPattern: 'console.log("foo")',
        }),
      ];
      writeRules(tmpDir, rules);

      const diff = makeDiff('src/app.ts', '  console.log("foo");');

      const mockResolveGitRoot = vi.spyOn(totem, 'resolveGitRoot').mockReturnValue(tmpDir);

      const mockExec = vi
        .spyOn(totem, 'safeExec')
        .mockImplementation((cmd: string, args?: string[]) => {
          if (!args) return '';
          if (args[0] === 'ls-files' && args[1] === '--recurse-submodules' && args[2] === '-s') {
            return '120000 hash 0\tsrc/app.ts\n'; // Symlink
          }
          if (args[0] === 'show') {
            return 'console.log("foo");\n'; // Should not be called
          }
          return '';
        });

      try {
        const result = await runCompiledRules({
          diff,
          cwd: tmpDir,
          totemDir: TOTEM_DIR,
          format: 'json',
          tag: 'Test',
          isStaged: true,
        });

        expect(result.violations).toHaveLength(0);
      } finally {
        mockResolveGitRoot.mockRestore();
        mockExec.mockRestore();
      }
    });

    it('normalizes CRLF to LF in staged content', async () => {
      const rules = [
        makeRule('console\\.log\\("foo"\\)', 'No foo log', 'No foo log', {
          engine: 'ast-grep',
          astGrepPattern: 'console.log("foo")',
        }),
      ];
      writeRules(tmpDir, rules);

      const diff = makeDiff('src/app.ts', '  console.log("foo");');

      const mockResolveGitRoot = vi.spyOn(totem, 'resolveGitRoot').mockReturnValue(tmpDir);

      const mockExec = vi
        .spyOn(totem, 'safeExec')
        .mockImplementation((cmd: string, args?: string[]) => {
          if (!args) return '';
          if (args[0] === 'ls-files' && args[1] === '--recurse-submodules' && args[2] === '-s') {
            return '100644 hash 0\tsrc/app.ts\n';
          }
          if (args[0] === 'show') {
            return '// context\r\n  console.log("foo");\r\n// context\r\n';
          }
          return '';
        });

      let violations: unknown[] = [];
      try {
        const result = await runCompiledRules({
          diff,
          cwd: tmpDir,
          totemDir: TOTEM_DIR,
          format: 'json',
          tag: 'Test',
          isStaged: true,
        });
        violations = result.violations;
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          err.name === 'TotemError' &&
          err.message.includes('Violations detected')
        ) {
          violations = [1];
        } else {
          throw err;
        }
      }

      expect(violations).toHaveLength(1);
      mockResolveGitRoot.mockRestore();
      mockExec.mockRestore();
    });

    it('throws STAGED_READ_FAILED when the underlying staged read fails', async () => {
      const rules = [
        makeRule('console\\.log\\("foo"\\)', 'No foo log', 'No foo log', {
          engine: 'ast-grep',
          astGrepPattern: 'console.log("foo")',
        }),
      ];
      writeRules(tmpDir, rules);

      const diff = makeDiff('src/app.ts', '  console.log("foo");');

      const mockResolveGitRoot = vi.spyOn(totem, 'resolveGitRoot').mockReturnValue(tmpDir);

      const mockExec = vi
        .spyOn(totem, 'safeExec')
        .mockImplementation((cmd: string, args?: string[]) => {
          if (!args) return '';
          if (args[0] === 'ls-files' && args[1] === '--recurse-submodules' && args[2] === '-s') {
            return '100644 hash 0\tsrc/app.ts\n';
          }
          if (args[0] === 'show') {
            throw new Error('[Totem Error] Command failed: show :src/app.ts');
          }
          return '';
        });

      try {
        await expect(
          runCompiledRules({
            diff,
            cwd: tmpDir,
            totemDir: TOTEM_DIR,
            format: 'json',
            tag: 'Test',
            isStaged: true,
          }),
        ).rejects.toThrow('Failed to read staged content');
      } finally {
        mockResolveGitRoot.mockRestore();
        mockExec.mockRestore();
      }
    });

    it('does not construct readStrategy when isStaged is false', async () => {
      const rules = [
        makeRule('console\\.log\\("foo"\\)', 'No foo log', 'No foo log', {
          engine: 'ast-grep',
          astGrepPattern: 'console.log("foo")',
        }),
      ];
      writeRules(tmpDir, rules);

      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'src', 'app.ts'),
        '// context\n  console.log("foo");\n// context\n',
      );

      const diff = makeDiff('src/app.ts', '  console.log("foo");');

      const mockExec = vi.spyOn(totem, 'safeExec').mockImplementation(() => {
        throw new Error('[Totem Error] Should not be called');
      });

      let violations: unknown[] = [];
      try {
        const result = await runCompiledRules({
          diff,
          cwd: tmpDir,
          totemDir: TOTEM_DIR,
          format: 'json',
          tag: 'Test',
          isStaged: false,
        });
        violations = result.violations;
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          err.name === 'TotemError' &&
          err.message.includes('Violations detected')
        ) {
          violations = [1];
        } else {
          throw err;
        }
      }

      // AST engine runs with disk-read fallback
      expect(violations).toHaveLength(1);
      mockExec.mockRestore();
    });

    it('uses repo root as workingDirectory when cwd is a subdirectory', async () => {
      const rules = [
        makeRule('console\\.log\\("foo"\\)', 'No foo log', 'No foo log', {
          engine: 'ast-grep',
          astGrepPattern: 'console.log("foo")',
        }),
      ];
      writeRules(tmpDir, rules);

      const diff = makeDiff('src/app.ts', '  console.log("foo");');

      const subDir = path.join(tmpDir, 'sub', 'dir');
      fs.mkdirSync(subDir, { recursive: true });

      const mockResolveGitRoot = vi.spyOn(totem, 'resolveGitRoot').mockReturnValue(tmpDir);

      const mockExec = vi
        .spyOn(totem, 'safeExec')
        .mockImplementation((cmd: string, args?: string[]) => {
          if (!args) return '';
          if (args[0] === 'ls-files' && args[1] === '--recurse-submodules' && args[2] === '-s') {
            return '100644 hash 0\tsrc/app.ts\n';
          }
          if (args[0] === 'show') {
            return '// context\n  console.log("foo");\n// context\n';
          }
          return '';
        });

      const spyAst = vi.spyOn(totem, 'applyAstRulesToAdditions');

      let violations: unknown[] = [];
      try {
        const result = await runCompiledRules({
          diff,
          cwd: subDir,
          totemDir: TOTEM_DIR,
          format: 'json',
          tag: 'Test',
          isStaged: true,
          configRoot: tmpDir,
        });
        violations = result.violations;
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          err.name === 'TotemError' &&
          err.message.includes('Violations detected')
        ) {
          violations = [1];
        } else {
          throw err;
        }
      }

      expect(violations).toHaveLength(1);
      expect(spyAst).toHaveBeenCalled();
      // Check that workingDirectory passed to applyAstRulesToAdditions is tmpDir (repo root), not subDir
      expect(spyAst.mock.calls[0]![3]).toBe(tmpDir);
      mockResolveGitRoot.mockRestore();
      mockExec.mockRestore();
      spyAst.mockRestore();
    });

    it('uses repo root as workingDirectory for non-staged path from a subdirectory (#1312)', async () => {
      const rules = [
        makeRule('console\\.log\\("foo"\\)', 'No foo log', 'No foo log', {
          engine: 'ast-grep',
          astGrepPattern: 'console.log("foo")',
        }),
      ];
      writeRules(tmpDir, rules);

      // Write the file at repo root so AST can read it
      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'src', 'app.ts'),
        '// context\n  console.log("foo");\n// context\n',
      );

      const diff = makeDiff('src/app.ts', '  console.log("foo");');

      const subDir = path.join(tmpDir, 'sub', 'dir');
      fs.mkdirSync(subDir, { recursive: true });

      const mockResolveGitRoot = vi.spyOn(totem, 'resolveGitRoot').mockReturnValue(tmpDir);

      const spyAst = vi.spyOn(totem, 'applyAstRulesToAdditions');

      let violations: unknown[] = [];
      try {
        const result = await runCompiledRules({
          diff,
          cwd: subDir,
          totemDir: TOTEM_DIR,
          format: 'json',
          tag: 'Test',
          isStaged: false,
          configRoot: tmpDir,
        });
        violations = result.violations;
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          err.name === 'TotemError' &&
          err.message.includes('Violations detected')
        ) {
          violations = [1];
        } else {
          throw err;
        }
      }

      expect(violations).toHaveLength(1);
      expect(spyAst).toHaveBeenCalled();
      // Non-staged path must also resolve against repo root, not subDir
      expect(spyAst.mock.calls[0]![3]).toBe(tmpDir);
      mockResolveGitRoot.mockRestore();
      spyAst.mockRestore();
    });

    it('falls back to original cwd when not in a git repo (resolveGitRoot returns null)', async () => {
      const rules = [
        makeRule('console\\.log\\("foo"\\)', 'No foo log', 'No foo log', {
          engine: 'ast-grep',
          astGrepPattern: 'console.log("foo")',
        }),
      ];
      writeRules(tmpDir, rules);

      fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'src', 'app.ts'),
        '// context\n  console.log("foo");\n// context\n',
      );

      const diff = makeDiff('src/app.ts', '  console.log("foo");');

      const mockResolveGitRoot = vi.spyOn(totem, 'resolveGitRoot').mockReturnValue(null);
      const mockExec = vi.spyOn(totem, 'safeExec').mockImplementation(() => {
        throw new Error('[Totem Error] Should not be called');
      });

      let violations: unknown[] = [];
      try {
        const result = await runCompiledRules({
          diff,
          cwd: tmpDir,
          totemDir: TOTEM_DIR,
          format: 'json',
          tag: 'Test',
          isStaged: true,
        });
        violations = result.violations;
      } catch (err: unknown) {
        if (
          err instanceof Error &&
          err.name === 'TotemError' &&
          err.message.includes('Violations detected')
        ) {
          violations = [1];
        } else {
          throw err;
        }
      }

      // Should gracefully fallback to disk read and process rules
      expect(violations).toHaveLength(1);
      mockResolveGitRoot.mockRestore();
      mockExec.mockRestore();
    });
  });

  // ─── evaluationCount per-rule per-run (mmnto-ai/totem#1483) ──

  describe('evaluationCount (mmnto-ai/totem#1483)', () => {
    it('increments evaluationCount exactly once per rule per lint run', async () => {
      const rule1 = makeRule('console\\.log', 'No console', 'No console', {
        lessonHash: 'hash-eval-1',
      });
      const rule2 = makeRule('debugger', 'No debugger', 'No debugger', {
        lessonHash: 'hash-eval-2',
      });
      writeRules(tmpDir, [rule1, rule2]);

      // Diff carries multiple additions including several matches for rule1.
      // The counter still ticks once per rule regardless of match count.
      const diff = [
        'diff --git a/src/app.ts b/src/app.ts',
        '--- a/src/app.ts',
        '+++ b/src/app.ts',
        '@@ -1,3 +1,5 @@',
        ' // existing',
        '+  console.log("first");',
        '+  console.log("second");',
        '+  console.log("third");',
        ' // end',
      ].join('\n');

      try {
        await runCompiledRules({
          diff,
          cwd: tmpDir,
          totemDir: TOTEM_DIR,
          format: 'json',
          tag: 'Test',
        });
      } catch (err: unknown) {
        if (!(err instanceof TotemError) || err.code !== 'SHIELD_FAILED') throw err;
      }

      const metricsPath = path.join(tmpDir, TOTEM_DIR, 'cache', 'rule-metrics.json');
      expect(fs.existsSync(metricsPath)).toBe(true);
      const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf-8')) as {
        rules: Record<string, { evaluationCount?: number; triggerCount: number }>;
      };
      expect(metrics.rules['hash-eval-1']!.evaluationCount).toBe(1);
      expect(metrics.rules['hash-eval-2']!.evaluationCount).toBe(1);
      expect(metrics.rules['hash-eval-1']!.triggerCount).toBe(3);
      expect(metrics.rules['hash-eval-2']!.triggerCount).toBe(0);
    });

    it('increments evaluationCount on each invocation (monotonic across runs)', async () => {
      const rule = makeRule('NEVER_MATCHES_XYZ', 'Dormant rule', 'Dormant rule', {
        lessonHash: 'hash-dormant',
      });
      writeRules(tmpDir, [rule]);

      const diff = makeDiff('src/app.ts', '  const x = 1;');

      for (let i = 0; i < 4; i++) {
        await runCompiledRules({
          diff,
          cwd: tmpDir,
          totemDir: TOTEM_DIR,
          format: 'json',
          tag: 'Test',
        });
      }

      const metricsPath = path.join(tmpDir, TOTEM_DIR, 'cache', 'rule-metrics.json');
      const metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf-8')) as {
        rules: Record<string, { evaluationCount?: number; triggerCount: number }>;
      };
      expect(metrics.rules['hash-dormant']!.evaluationCount).toBe(4);
      expect(metrics.rules['hash-dormant']!.triggerCount).toBe(0);
    });
  });
});

describe('TOTEM_LITE graceful AST degradation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-lite-test-'));
    fs.mkdirSync(path.join(tmpDir, TOTEM_DIR), { recursive: true });
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
    delete process.env['TOTEM_LITE'];
  });

  it('skips AST rules with warning when TOTEM_LITE=1 and AST engine fails', async () => {
    process.env['TOTEM_LITE'] = '1';

    const astRule = makeRule('', 'no console', 'No console', {
      engine: 'ast-grep',
      astGrepPattern: 'console.log($$$)',
      fileGlobs: ['**/*.ts'],
    });
    saveCompiledRules(path.join(tmpDir, TOTEM_DIR, 'compiled-rules.json'), [astRule]);

    const diff = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1,2 @@
+console.log("hello");
`;

    // Mock applyAstRulesToAdditions to throw (simulating WASM failure)
    const spy = vi
      .spyOn(totem, 'applyAstRulesToAdditions')
      .mockRejectedValueOnce(
        new TotemError('LINT_LESSONS_FAILED', 'AST engine not initialized — WASM unavailable', ''),
      );

    const result = await runCompiledRules({
      diff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'text',
      tag: 'Test',
    });

    // Should pass despite AST failure — regex rules still run, AST skipped
    expect(result.violations).toHaveLength(0);
    spy.mockRestore();
  });

  it('re-throws AST errors when NOT in lite mode', async () => {
    delete process.env['TOTEM_LITE'];

    const astRule = makeRule('', 'no console', 'No console', {
      engine: 'ast-grep',
      astGrepPattern: 'console.log($$$)',
      fileGlobs: ['**/*.ts'],
    });
    saveCompiledRules(path.join(tmpDir, TOTEM_DIR, 'compiled-rules.json'), [astRule]);

    const diff = `diff --git a/src/app.ts b/src/app.ts
--- a/src/app.ts
+++ b/src/app.ts
@@ -1 +1,2 @@
+console.log("hello");
`;

    const spy = vi
      .spyOn(totem, 'applyAstRulesToAdditions')
      .mockRejectedValueOnce(new TotemError('LINT_LESSONS_FAILED', 'AST engine crashed', ''));

    await expect(
      runCompiledRules({
        diff,
        cwd: tmpDir,
        totemDir: TOTEM_DIR,
        format: 'text',
        tag: 'Test',
      }),
    ).rejects.toThrow('[Totem Error] AST engine crashed');

    spy.mockRestore();
  });
});

// mmnto-ai/totem#1982 — operator escape for AST parse failures
describe('--ast-parse-mode lenient', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-ast-parse-test-'));
    fs.mkdirSync(path.join(tmpDir, TOTEM_DIR), { recursive: true });
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
    delete process.env['TOTEM_LINT_AST_PARSE_MODE'];
  });

  // totem-context: helper has no OrExit suffix; the rule misclassifies test-fixture builders that return literal objects
  function makeAstRuleAndDiff() {
    const astRule = makeRule('', 'rust pattern', 'No unsafe', {
      engine: 'ast-grep',
      astGrepPattern: 'unsafe { $$$ }',
      fileGlobs: ['**/*.rs'],
    });
    saveCompiledRules(path.join(tmpDir, TOTEM_DIR, 'compiled-rules.json'), [astRule]);

    const diff = `diff --git a/src/lib.rs b/src/lib.rs
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1 +1,2 @@
+unsafe { let p = std::ptr::null::<u8>(); }
`;
    return { astRule, diff };
  }

  it('strict mode (default): re-throws TotemParseError on parse failure', async () => {
    const { diff } = makeAstRuleAndDiff();

    const spy = vi
      .spyOn(totem, 'applyAstRulesToAdditions')
      .mockRejectedValueOnce(
        new TotemParseError('ast-grep batch parse failed: rust is not supported in napi', ''),
      );

    await expect(
      runCompiledRules({
        diff,
        cwd: tmpDir,
        totemDir: TOTEM_DIR,
        format: 'text',
        tag: 'Test',
      }),
    ).rejects.toThrow('rust is not supported in napi');

    spy.mockRestore();
  });

  it('lenient mode (CLI flag): captures parse failure, returns empty astViolations', async () => {
    const { diff } = makeAstRuleAndDiff();

    const spy = vi
      .spyOn(totem, 'applyAstRulesToAdditions')
      .mockRejectedValueOnce(
        new TotemParseError('ast-grep batch parse failed: rust is not supported in napi', ''),
      );

    const result = await runCompiledRules({
      diff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'text',
      tag: 'Test',
      astParseMode: 'lenient',
    });

    expect(result.violations).toHaveLength(0);
    expect(result.astParseFailures).toHaveLength(1);
    expect(result.astParseFailures[0]).toMatchObject({
      file: '*',
      language: 'rust',
      mode: 'lenient',
    });
    expect(result.astParseFailures[0]!.message).toContain('rust is not supported in napi');

    spy.mockRestore();
  });

  it('lenient mode (env var TOTEM_LINT_AST_PARSE_MODE): same behavior as CLI flag', async () => {
    process.env['TOTEM_LINT_AST_PARSE_MODE'] = 'lenient';
    const { diff } = makeAstRuleAndDiff();

    const spy = vi
      .spyOn(totem, 'applyAstRulesToAdditions')
      .mockRejectedValueOnce(
        new TotemParseError('ast-grep batch parse failed: rust is not supported in napi', ''),
      );

    const result = await runCompiledRules({
      diff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'text',
      tag: 'Test',
      // No explicit astParseMode — env var takes effect
    });

    expect(result.astParseFailures).toHaveLength(1);
    expect(result.astParseFailures[0]!.language).toBe('rust');

    spy.mockRestore();
  });

  it('CLI flag overrides env var (flag wins)', async () => {
    process.env['TOTEM_LINT_AST_PARSE_MODE'] = 'lenient';
    const { diff } = makeAstRuleAndDiff();

    const spy = vi
      .spyOn(totem, 'applyAstRulesToAdditions')
      .mockRejectedValueOnce(
        new TotemParseError('ast-grep batch parse failed: rust is not supported in napi', ''),
      );

    // CLI flag explicitly says strict — should throw even though env says lenient
    await expect(
      runCompiledRules({
        diff,
        cwd: tmpDir,
        totemDir: TOTEM_DIR,
        format: 'text',
        tag: 'Test',
        astParseMode: 'strict',
      }),
    ).rejects.toThrow('rust is not supported in napi');

    spy.mockRestore();
  });

  it('lenient mode with unrecognized failure message: language = "unknown"', async () => {
    const { diff } = makeAstRuleAndDiff();

    const spy = vi
      .spyOn(totem, 'applyAstRulesToAdditions')
      .mockRejectedValueOnce(new TotemParseError('AST parse failed: some other error format', ''));

    const result = await runCompiledRules({
      diff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'text',
      tag: 'Test',
      astParseMode: 'lenient',
    });

    expect(result.astParseFailures).toHaveLength(1);
    expect(result.astParseFailures[0]!.language).toBe('unknown');

    spy.mockRestore();
  });

  it('lenient mode does NOT swallow non-parse errors (preserves loud-crash for other failures)', async () => {
    const { diff } = makeAstRuleAndDiff();

    // Some other error class that's NOT TotemParseError (no PARSE_FAILED code)
    const spy = vi
      .spyOn(totem, 'applyAstRulesToAdditions')
      .mockRejectedValueOnce(
        new TotemError('LINT_LESSONS_FAILED', 'unrelated AST engine crash', ''),
      );

    await expect(
      runCompiledRules({
        diff,
        cwd: tmpDir,
        totemDir: TOTEM_DIR,
        format: 'text',
        tag: 'Test',
        astParseMode: 'lenient',
      }),
    ).rejects.toThrow('unrelated AST engine crash');

    spy.mockRestore();
  });

  // ─── ruleClass marker (mmnto-ai/totem#2183) ─────────

  const VALID_SHA = 'a'.repeat(40);
  const passingLegitimacy = {
    provenance: { mergedPr: 2183, reviewThread: 'pr#2183-thread', commitSha: VALID_SHA },
    positiveControl: true,
    negativeControl: true,
  };
  const failingLegitimacy = { ...passingLegitimacy, positiveControl: false };

  it('keeps a legacy (un-stamped) ast-grep rule blocking — zero regression via the engine proxy (mmnto-ai/totem#2183, greptile #2186)', async () => {
    // The spec invariant: a rule with no legitimacy/ruleClass falls to the
    // engine proxy and ast/ast-grep STILL blocks. Guards hardTier's legacy
    // fallback against a silent regression if it or isHardEngine is refactored.
    const rules = [
      makeRule('console\\.log\\("foo"\\)', 'No foo log', 'No foo log', {
        engine: 'ast-grep',
        astGrepPattern: 'console.log("foo")',
      }),
    ];
    writeRules(tmpDir, rules);

    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.ts'),
      '// context\n  console.log("foo");\n// context\n',
    );

    const diff = makeDiff('src/app.ts', '  console.log("foo");');

    await expect(
      runCompiledRules({ diff, cwd: tmpDir, totemDir: TOTEM_DIR, format: 'text', tag: 'Test' }),
    ).rejects.toThrow('Violations detected');
  });

  it('blocks on a minted ruleClass:hard regex rule — overrides the engine proxy upward (mmnto-ai/totem#2183)', async () => {
    const rules = [
      makeRule('console\\.log', 'No console.log', 'No console.log', {
        legitimacy: passingLegitimacy,
        ruleClass: 'hard',
      }),
    ];
    writeRules(tmpDir, rules);

    const diff = makeDiff('src/app.ts', '  console.log("x");');

    await expect(
      runCompiledRules({ diff, cwd: tmpDir, totemDir: TOTEM_DIR, format: 'text', tag: 'Test' }),
    ).rejects.toThrow('Violations detected');
  });

  it('does not block on a minted ruleClass:advisory ast-grep rule — overrides the engine proxy downward (mmnto-ai/totem#2183)', async () => {
    const rules = [
      makeRule('console\\.log\\("foo"\\)', 'No foo log', 'No foo log', {
        engine: 'ast-grep',
        astGrepPattern: 'console.log("foo")',
        legitimacy: failingLegitimacy,
        ruleClass: 'advisory',
      }),
    ];
    writeRules(tmpDir, rules);

    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.ts'),
      '// context\n  console.log("foo");\n// context\n',
    );

    const diff = makeDiff('src/app.ts', '  console.log("foo");');

    const result = await runCompiledRules({
      diff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'json',
      tag: 'Test',
    });

    const parsed = JSON.parse(result.output);
    expect(parsed.pass).toBe(true);
    expect(parsed.errors).toBe(0);
    expect(parsed.warnings).toBe(1);
  });

  it('preserves the severity gate — a minted hard rule with severity:warning does not block (mmnto-ai/totem#2183, codex fold 2)', async () => {
    const rules = [
      makeRule('console\\.log', 'No console.log', 'No console.log', {
        legitimacy: passingLegitimacy,
        ruleClass: 'hard',
        severity: 'warning',
      }),
    ];
    writeRules(tmpDir, rules);

    const diff = makeDiff('src/app.ts', '  console.log("x");');

    const result = await runCompiledRules({
      diff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'json',
      tag: 'Test',
    });

    const parsed = JSON.parse(result.output);
    expect(parsed.pass).toBe(true);
    expect(parsed.warnings).toBe(1);
    expect(parsed.errors).toBe(0);
  });

  it('labels a legacy (un-stamped) regex advisory as a frozen-lesson rule (mmnto-ai/totem#2181)', async () => {
    const rules = [makeRule('console\\.log', 'No console.log', 'No console.log')];
    writeRules(tmpDir, rules);

    const diff = makeDiff('src/app.ts', '  console.log("x");');

    const result = await runCompiledRules({
      diff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'text',
      tag: 'Test',
    });

    expect(result.output).toContain('Frozen-lesson');
  });

  it('does not mislabel a minted ruleClass:advisory regex rule as frozen-lesson (mmnto-ai/totem#2183, codex fold 2)', async () => {
    const rules = [
      makeRule('console\\.log', 'No console.log', 'No console.log', {
        legitimacy: failingLegitimacy,
        ruleClass: 'advisory',
      }),
    ];
    writeRules(tmpDir, rules);

    const diff = makeDiff('src/app.ts', '  console.log("x");');

    const result = await runCompiledRules({
      diff,
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'text',
      tag: 'Test',
    });

    expect(result.violations).toHaveLength(1);
    expect(result.output).not.toContain('Frozen-lesson');
  });
});

// ─── Corpus-bearing zero-rules hard-error (mmnto-ai/totem-strategy#971, Prop 309) ──
//
// A repo that carries a lesson corpus but loads ZERO compiled rules has its
// entire enforcement gate silently disarmed behind a green exit. `totem lint`
// must fail loud in that case (induced-failure triple below), while still
// preserving the legitimate empty-corpus skip (mmnto-ai/totem#1831) and the
// archived-in-place zero-active-rules lifecycle state (the controls).
describe('corpus-bearing zero-rules hard-error (mmnto-ai/totem-strategy#971)', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-rcr-corpus-'));
    fs.mkdirSync(path.join(tmpDir, TOTEM_DIR), { recursive: true });
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  /** Write a real lesson `.md` under `.totem/lessons/` so the repo is corpus-bearing. */
  function writeLesson(dir: string, name = 'baseline.md'): void {
    const lessonsDir = path.join(dir, TOTEM_DIR, 'lessons');
    fs.mkdirSync(lessonsDir, { recursive: true });
    fs.writeFileSync(path.join(lessonsDir, name), '# A lesson\n\nBody.\n');
  }

  /** A config whose only lesson-kind target matches `.totem/lessons/*.md`. */
  function lessonConfig(glob = '.totem/lessons/*.md'): Pick<TotemConfig, 'targets'> {
    return { targets: [{ glob, type: 'lesson', strategy: 'markdown-heading' }] };
  }

  const cleanDiff = (): string => makeDiff('src/app.ts', '  const x = 1;');

  // ── Induced-failure triple ──────────────────────────

  it('hard-errors when the manifest is missing but the repo carries lessons', async () => {
    writeLesson(tmpDir); // corpus-bearing; no compiled-rules.json written

    await expect(
      runCompiledRules({
        diff: cleanDiff(),
        cwd: tmpDir,
        totemDir: TOTEM_DIR,
        format: 'text',
        tag: 'Test',
        config: lessonConfig(),
      }),
    ).rejects.toThrow(/enforcement disarmed/i);
  });

  it('hard-errors on a truncated manifest instead of passing vacuously', async () => {
    writeLesson(tmpDir);
    // Truncated mid-array — JSON.parse throws SyntaxError, which core reports via
    // onWarn and returns []. Unmodified code passes vacuously here; the fix throws.
    fs.writeFileSync(path.join(tmpDir, TOTEM_DIR, 'compiled-rules.json'), '{"version":1,"rules":[');

    await expect(
      runCompiledRules({
        diff: cleanDiff(),
        cwd: tmpDir,
        totemDir: TOTEM_DIR,
        format: 'text',
        tag: 'Test',
        config: lessonConfig(),
      }),
    ).rejects.toThrow(/enforcement disarmed/i);
  });

  it('hard-errors on an EISDIR I/O fault and surfaces the load-warning accounting text', async () => {
    writeLesson(tmpDir);
    // Replace the manifest with a DIRECTORY at the same path — the portable,
    // Windows-safe I/O fault (readFileSync throws EISDIR on win32 and posix).
    fs.mkdirSync(path.join(tmpDir, TOTEM_DIR, 'compiled-rules.json'), { recursive: true });

    let message = '';
    try {
      await runCompiledRules({
        diff: cleanDiff(),
        cwd: tmpDir,
        totemDir: TOTEM_DIR,
        format: 'text',
        tag: 'Test',
        config: lessonConfig(),
      });
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }

    expect(message).toMatch(/enforcement disarmed/i);
    // The onWarn accounting text (dropped before the fix) is surfaced in the throw.
    expect(message).toContain('Could not load compiled rules');
  });

  // ── Controls ────────────────────────────────────────

  it('control: an empty-corpus repo (no lesson files) with a missing manifest still exits clean (mmnto-ai/totem#1831)', async () => {
    // Config DECLARES a lesson target, but no lesson files exist on disk, so the
    // discriminator treats the repo as empty-corpus — the info-skip is preserved.
    const result = await runCompiledRules({
      diff: cleanDiff(),
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'text',
      tag: 'Test',
      config: lessonConfig(),
    });

    expect(result.violations).toHaveLength(0);
    expect(result.rules).toHaveLength(0);
    expect(result.output).toBe('');
  });

  it('control: a corpus-bearing repo whose manifest holds only archived rules exits clean with a zero-active-rules message', async () => {
    writeLesson(tmpDir);
    // Valid manifest, present and parseable, but every rule is inert (archived).
    // loadCompiledRules filters it to [] with no warning — a legitimate lifecycle
    // state, NOT a disarmed gate.
    writeRules(tmpDir, [
      makeRule('console\\.log', 'No console', 'No console', { status: 'archived' }),
    ]);

    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const result = await runCompiledRules({
        diff: cleanDiff(),
        cwd: tmpDir,
        totemDir: TOTEM_DIR,
        format: 'text',
        tag: 'Test',
        config: lessonConfig(),
      });

      expect(result.rules).toHaveLength(0);
      expect(result.violations).toHaveLength(0);
      const messages = stderrSpy.mock.calls.map((c) => c[0] as string);
      expect(messages.find((m) => m.includes('zero ACTIVE rules'))).toBeDefined();
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('control: a repo with valid active rules is unaffected by the corpus-bearing gate', async () => {
    writeLesson(tmpDir);
    writeRules(tmpDir, [makeRule('neverMatchXYZ123', 'no match', 'No match rule')]);

    const result = await runCompiledRules({
      diff: cleanDiff(),
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'json',
      tag: 'Test',
      config: lessonConfig(),
    });

    expect(result.rules).toHaveLength(1);
    expect(result.violations).toHaveLength(0);
    expect(JSON.parse(result.output).pass).toBe(true);
  });

  it('control: a config-less caller with a truncated manifest surfaces the load warning but never hard-errors (the shield-estimate opt-out contract)', async () => {
    writeLesson(tmpDir);
    fs.writeFileSync(path.join(tmpDir, TOTEM_DIR, 'compiled-rules.json'), '{"version":1,"rules":[');

    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // No `config` option — the caller opts out of the corpus-bearing hard
      // error (e.g. `shield estimate`). The accounting line must still render:
      // the opt-out covers the exit code, not the disclosure.
      const result = await runCompiledRules({
        diff: cleanDiff(),
        cwd: tmpDir,
        totemDir: TOTEM_DIR,
        format: 'text',
        tag: 'Test',
      });

      expect(result.rules).toHaveLength(0);
      expect(result.violations).toHaveLength(0);
      const messages = stderrSpy.mock.calls.map((c) => String(c[0]));
      expect(messages.find((m) => m.includes('Could not load compiled rules'))).toBeDefined();
    } finally {
      stderrSpy.mockRestore();
    }
  });

  it('hard-errors via a concrete (non-wildcard) lesson target — the aggregated .totem/lessons.md shape', async () => {
    // The production config declares BOTH a wildcard dir target and a concrete
    // aggregated-file target; this exercises the statSync existence branch (and
    // mixed-target iteration) that the wildcard-walk tests never reach.
    fs.writeFileSync(path.join(tmpDir, TOTEM_DIR, 'lessons.md'), '# Lessons\n\n## One\n\nBody.\n');

    await expect(
      runCompiledRules({
        diff: cleanDiff(),
        cwd: tmpDir,
        totemDir: TOTEM_DIR,
        format: 'text',
        tag: 'Test',
        config: {
          targets: [
            { glob: '.totem/lessons/*.md', type: 'lesson', strategy: 'markdown-heading' },
            { glob: '.totem/lessons.md', type: 'lesson', strategy: 'markdown-heading' },
          ],
        },
      }),
    ).rejects.toThrow(/enforcement disarmed/i);
  });
});
