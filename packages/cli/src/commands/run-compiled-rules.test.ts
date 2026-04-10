import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompiledRule } from '@mmnto/totem';
import * as totem from '@mmnto/totem';
import { readLedgerEvents, saveCompiledRules, TotemError } from '@mmnto/totem';

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

  it('detects a violation when regex matches added line', async () => {
    const rules = [makeRule('console\\.log', 'Remove debug logging', 'No console.log')];
    writeRules(tmpDir, rules);

    const diff = makeDiff('src/app.ts', '  console.log("debug");');

    // runCompiledRules throws SHIELD_FAILED for error-severity violations
    await expect(
      runCompiledRules({
        diff,
        cwd: tmpDir,
        totemDir: TOTEM_DIR,
        format: 'json',
        tag: 'Test',
      }),
    ).rejects.toThrow('Violations detected');
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

  it('throws NO_RULES when compiled-rules.json has no rules', async () => {
    // Write an empty rules array
    const rulesPath = path.join(tmpDir, TOTEM_DIR, 'compiled-rules.json');
    fs.writeFileSync(rulesPath, JSON.stringify({ version: 1, rules: [] }));

    const diff = makeDiff('src/app.ts', '  const x = 1;');

    await expect(
      runCompiledRules({
        diff,
        cwd: tmpDir,
        totemDir: TOTEM_DIR,
        format: 'text',
        tag: 'Test',
      }),
    ).rejects.toThrow('No compiled rules found');
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

    // Diff with a .sh file — should match and throw
    const shDiff = makeDiff('scripts/build.sh', '# TODO: fix later');

    await expect(
      runCompiledRules({
        diff: shDiff,
        cwd: tmpDir,
        totemDir: TOTEM_DIR,
        format: 'json',
        tag: 'Test',
      }),
    ).rejects.toThrow('Violations detected');
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

  it('throws SHIELD_FAILED for error-severity violations in text format', async () => {
    const rules = [makeRule('badPattern', 'Found bad pattern', 'Bad pattern rule')];
    writeRules(tmpDir, rules);

    const diff = makeDiff('src/index.ts', '  badPattern();');

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

    // This will throw SHIELD_FAILED because there are error-severity violations
    let caughtErr: unknown;
    try {
      await runCompiledRules({
        diff,
        cwd: tmpDir,
        totemDir: TOTEM_DIR,
        format: 'json',
        tag: 'Test',
      });
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr).toBeDefined();
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

  it('SARIF output excludes warning-severity findings', async () => {
    const rules = [
      makeRule('errorPattern', 'This is an error', 'Error rule', { severity: 'error' }),
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

    // Error-severity violations cause a throw, but we need the SARIF output
    let caughtErr: unknown;
    try {
      await runCompiledRules({
        diff,
        cwd: tmpDir,
        totemDir: TOTEM_DIR,
        format: 'sarif',
        tag: 'Test',
      });
    } catch (err) {
      caughtErr = err;
    }

    expect(caughtErr).toBeDefined();

    // Read the SARIF output from the error or capture it via --out
    // Since the function throws, check that warning-only runs produce clean SARIF
    const warningOnlyRules = [
      makeRule('warnPattern', 'This is a warning', 'Warning rule', { severity: 'warning' }),
    ];
    writeRules(tmpDir, warningOnlyRules);

    const result = await runCompiledRules({
      diff: makeDiff('src/app.ts', '  warnPattern();'),
      cwd: tmpDir,
      totemDir: TOTEM_DIR,
      format: 'sarif',
      tag: 'Test',
    });

    const sarif = JSON.parse(result.output);
    const results = sarif.runs[0].results;
    // Warning-only violations produce a single summary note, not individual annotations
    expect(results).toHaveLength(1);
    expect(results[0].level).toBe('note');
    expect(results[0].ruleId).toBe('totem/warning-summary');
    expect(results[0].message.text).toContain('1 warning-severity finding(s) detected');
    expect(results[0].message.text).toContain('totem lint');
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

  // ─── setCoreLogger wiring ──────────────────────────

  it('calls setCoreLogger with a warn method during execution', async () => {
    const spy = vi.spyOn(totem, 'setCoreLogger');
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

      // setCoreLogger is called once to wire the logger, once in finally to reset
      expect(spy).toHaveBeenCalled();
      const firstCall = spy.mock.calls[0]![0];
      expect(firstCall).toHaveProperty('warn');
      expect(typeof firstCall.warn).toBe('function');
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
      expect(spyAst.mock.calls[0]![2]).toBe(tmpDir);
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
      expect(spyAst.mock.calls[0]![2]).toBe(tmpDir);
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

    const astRule = makeRule('console.log($$$)', 'no console', 'No console', {
      engine: 'ast-grep',
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

    const astRule = makeRule('console.log($$$)', 'no console', 'No console', {
      engine: 'ast-grep',
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
