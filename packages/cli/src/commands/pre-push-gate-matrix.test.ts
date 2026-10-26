/**
 * Pre-push hook gate-mapped review invocation tests (mmnto-ai/totem#2473).
 *
 * The managed pre-push hook's strict arm consumes the gate-mapped review form:
 * probe `review --help` for `--gate` support, invoke `review --gate --branch`
 * when present, fall back to the bare sensor form with a VISIBLE compat line
 * when absent (the `--scope-to-diff` defensive-degrade precedent). Structural
 * assertions cover every platform; the behavioral matrix executes the real
 * generated hook under `sh` with a stub CLI and is POSIX-only (the stub is a
 * shell script on PATH, which Windows CreateProcess cannot resolve — the
 * ubuntu/macos CI legs carry this coverage, the string assertions carry win32).
 *
 * Since mmnto-ai/totem#3048 both diff-reading steps of the hook grade the pushed
 * range: the lint step probes `lint --help` for `--branch` and runs `lint --branch`
 * (bare `lint` behind a visible compat line when absent), and the gate-mapped
 * review form carries `--branch` under the existing `--gate` probe. Both are
 * pinned structurally and, on POSIX, behaviorally with the stub below.
 *
 * Byte-parity between this template and `tools/pre-push` is enforced by
 * `tools-hook-parity.test.ts` — not duplicated here.
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import { buildPrePushHook } from './install-hooks.js';

// The default render options the builder takes since mmnto-ai/totem#2692
// (required options object, no defaulted parameter).
const RENDER = {
  tier: 'standard' as const,
  totemDir: '.totem',
  fallbackCmd: 'pnpm dlx @mmnto/cli',
};

describe('buildPrePushHook — gate-mapped strict arm (structural, all platforms)', () => {
  const hook = buildPrePushHook(RENDER);

  it('probes review --help for --gate before invoking it', () => {
    expect(hook).toContain(`if $TOTEM_CMD review --help 2>/dev/null | grep -q -- '--gate'; then`);
  });

  it('carries the gate-mapped invocation, the visible compat fallback, and the bare form — in that order', () => {
    const gateIdx = hook.indexOf('$TOTEM_CMD review --gate --branch || exit 1');
    const compatIdx = hook.indexOf('Hook running review in compat mode');
    const bareIdx = hook.indexOf('$TOTEM_CMD review || exit 1');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(compatIdx).toBeGreaterThan(gateIdx);
    expect(bareIdx).toBeGreaterThan(compatIdx);
    // The compat disclosure is stderr-routed (a hook's stdout can be swallowed).
    expect(hook).toMatch(/Hook running review in compat mode[^\n]*" >&2/);
    // Its wording names what a bare run reads (mmnto-ai/totem#3048); the
    // pre-fix line said only that the mapping was off.
    expect(hook).toContain(
      "Hook running review in compat mode (CLI without --gate): the declared gate mapping and the branch-vs-base scope are both off, so this run reads uncommitted edits first and the checked-out HEAD's branch diff only on a clean tree",
    );
  });

  // mmnto-ai/totem#3048: the lint step grades the checked-out HEAD's branch range too. A pre-fix
  // render carries the bare `lint` line only and none of the four below.
  it('the lint step probes lint --help for --branch, runs lint --branch, and keeps the bare form behind a visible compat line — in that order, before the shield arm', () => {
    const probeIdx = hook.indexOf(
      `if $TOTEM_CMD lint --help 2>/dev/null | grep -q -- '--branch'; then`,
    );
    const branchIdx = hook.indexOf('if ! $TOTEM_CMD lint --branch; then');
    const compatIdx = hook.indexOf('Hook running lint in compat mode');
    const bareIdx = hook.indexOf('if ! $TOTEM_CMD lint; then');
    expect(probeIdx).toBeGreaterThan(-1);
    expect(branchIdx).toBeGreaterThan(probeIdx);
    expect(compatIdx).toBeGreaterThan(branchIdx);
    expect(bareIdx).toBeGreaterThan(compatIdx);
    expect(hook).toMatch(/Hook running lint in compat mode[^\n]*" >&2/);
    expect(hook).toContain(
      "Hook running lint in compat mode (CLI without --branch): this run reads uncommitted edits first and the checked-out HEAD's branch diff only on a clean tree",
    );
    expect(bareIdx).toBeLessThan(hook.indexOf('$TOTEM_CMD review --gate --branch || exit 1'));
  });

  it('each diff-reading verb appears once in its forced form and once in its compat arm, nowhere else', () => {
    const count = (needle: string): number => hook.split(needle).length - 1;
    expect(count('$TOTEM_CMD lint --branch')).toBe(1);
    expect(count('if ! $TOTEM_CMD lint; then')).toBe(1);
    expect(count('$TOTEM_CMD review --gate --branch')).toBe(1);
    expect(count('$TOTEM_CMD review || exit 1')).toBe(1);
    // No bare `review --gate` survives outside the forced form.
    expect(count('$TOTEM_CMD review --gate ')).toBe(1);
  });
});

// Behavioral coverage of the probe/fallback/blocking branches (string
// assertions alone are satisfiable without the behavior). POSIX-only — see the
// file doc comment; win32 carries the structural suite above (#2473).
describe.skipIf(process.platform === 'win32')('pre-push gate matrix (POSIX behavior)', () => {
  let tmpDir: string;
  let repoDir: string;
  let binDir: string;
  let logPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prepush-gate-'));
    repoDir = path.join(tmpDir, 'repo');
    binDir = path.join(tmpDir, 'stub-bin');
    fs.mkdirSync(repoDir, { recursive: true });
    fs.mkdirSync(binDir);
    logPath = path.join(tmpDir, 'totem-invocations.log');
    fs.writeFileSync(path.join(repoDir, 'pre-push'), buildPrePushHook(RENDER), {
      mode: 0o755,
    });
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  /**
   * A stub `totem` on PATH: records every invocation, serves `review --help`
   * from a canned help text, and exits per-branch with the configured codes.
   * The bare repo dir skips every earlier hook gate (no manifest, no compiled
   * rules, no lockfile, no package.json), so the strict arm under
   * CLAUDE_CODE_AGENT=1 is the only live block.
   *
   * Since mmnto-ai/totem#2698 the hook probes `legs gate --help` for
   * `--advisory` and runs `legs gate` BEFORE the shield arm, failing closed on
   * strict when the CLI lacks the verb. The stub models a CLI that HAS it and
   * answers "not owed" (exit 0), so the shield arm stays the only live block;
   * the legs arm's own matrix lives in install-hooks.test.ts.
   *
   * The lint step (mmnto-ai/totem#3048) is armed only by `armLint()` below:
   * `lintHelpText` is what `lint --help` prints (the probe greps it for
   * `--branch`) and `lintExit` is every other `lint` invocation's exit.
   */
  function writeStub(params: {
    helpText: string;
    helpExit: number;
    reviewExit: number;
    lintHelpText?: string;
    lintExit?: number;
  }): void {
    const stub = `#!/bin/sh
printf '%s\\n' "$*" >> "${logPath}"
if [ "$1" = "doctor" ]; then exit 0; fi
if [ "$1" = "legs" ] && [ "$2" = "gate" ] && [ "$3" = "--help" ]; then
  printf '%s\\n' '  --advisory  Print the same lines for every gate state'
  exit 0
fi
if [ "$1" = "legs" ]; then
  printf '%s\\n' '[Totem] legs: not owed — no changed path matched hooks.legsOwed.globs (0 globs; head 00000000)'
  exit 0
fi
if [ "$1" = "lint" ] && [ "$2" = "--help" ]; then
  printf '%s\\n' '${params.lintHelpText ?? ''}'
  exit 0
fi
if [ "$1" = "lint" ]; then exit ${params.lintExit ?? 0}; fi
if [ "$1" = "review" ] && [ "$2" = "--help" ]; then
  cat <<'TOTEM_STUB_HELP'
${params.helpText}
TOTEM_STUB_HELP
  exit ${params.helpExit}
fi
if [ "$1" = "review" ]; then exit ${params.reviewExit}; fi
exit 0
`;
    fs.writeFileSync(path.join(binDir, 'totem'), stub, { mode: 0o755 });
  }

  function runHook(): { status: number | null; stderr: string } {
    const result = spawnSync('sh', ['./pre-push'], {
      cwd: repoDir,
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        CLAUDE_CODE_AGENT: '1',
      },
      encoding: 'utf-8',
    });
    return { status: result.status, stderr: result.stderr ?? '' };
  }

  const invocations = () =>
    fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf-8').trim().split('\n') : [];

  /**
   * Arms the lint step and nothing else: `compiled-rules.json` is the file test
   * the lint block reads, and the other gates that share it (verify-badges, the
   * claim-discipline walk) also need a README.md, AGENTS.md, design-tenets.md or
   * docs/wiki, none of which the bare repo dir has.
   */
  function armLint(): void {
    fs.mkdirSync(path.join(repoDir, '.totem'), { recursive: true });
    fs.writeFileSync(path.join(repoDir, '.totem', 'compiled-rules.json'), '[]');
  }

  it('supported --gate: invokes the gate-mapped form over the branch-vs-base range and passes', () => {
    writeStub({
      helpText: 'Usage: totem review\n  --gate  declared mapping',
      helpExit: 0,
      reviewExit: 0,
    });
    const result = runHook();
    expect(result.status).toBe(0);
    expect(invocations()).toContain('review --gate --branch');
    expect(invocations()).toContain('doctor --strict');
    expect(result.stderr).not.toContain('compat mode');
  });

  it('unsupported CLI: falls back to the bare form with a VISIBLE compat line', () => {
    writeStub({
      helpText: 'Usage: totem review\n  --covariate  transport',
      helpExit: 0,
      reviewExit: 0,
    });
    const result = runHook();
    expect(result.status).toBe(0);
    expect(invocations()).toContain('review');
    expect(invocations()).not.toContain('review --gate --branch');
    expect(invocations()).not.toContain('review --gate');
    expect(result.stderr).toContain('compat mode');
  });

  it('probe failure (help errors, no output): falls back to the bare form', () => {
    writeStub({ helpText: '', helpExit: 1, reviewExit: 0 });
    const result = runHook();
    expect(result.status).toBe(0);
    expect(invocations()).toContain('review');
    expect(invocations()).not.toContain('review --gate --branch');
    expect(invocations()).not.toContain('review --gate');
    expect(result.stderr).toContain('compat mode');
  });

  it('hard failure under --gate blocks the push (any nonzero — the unknown-disposition fail-closed exit rides this same arm)', () => {
    writeStub({ helpText: '  --gate', helpExit: 0, reviewExit: 3 });
    const result = runHook();
    expect(result.status).toBe(1);
    expect(invocations()).toContain('review --gate --branch');
  });

  // The lint step (mmnto-ai/totem#3048). On a pre-fix render the first case
  // logs a bare `lint` and never `lint --branch`; the second never prints the
  // compat line; the third still blocks, but on `lint`, not `lint --branch`.
  it('lint: a CLI whose help names --branch is run with --branch and never bare, no compat line', () => {
    armLint();
    writeStub({
      helpText: '  --gate',
      helpExit: 0,
      reviewExit: 0,
      lintHelpText: '  --branch  Force the branch-vs-base diff scope the pre-push gate checks',
    });
    const result = runHook();
    expect(result.status).toBe(0);
    expect(invocations()).toContain('lint --help');
    expect(invocations()).toContain('lint --branch');
    expect(invocations()).not.toContain('lint');
    expect(result.stderr).not.toContain('compat mode');
  });

  it('lint: a CLI without --branch runs the bare form behind a VISIBLE compat line that names what a bare run reads', () => {
    armLint();
    writeStub({
      helpText: '  --gate',
      helpExit: 0,
      reviewExit: 0,
      lintHelpText: '  --staged  Lint only staged changes',
    });
    const result = runHook();
    expect(result.status).toBe(0);
    expect(invocations()).toContain('lint');
    expect(invocations()).not.toContain('lint --branch');
    expect(result.stderr).toMatch(
      /Hook running lint in compat mode \(CLI without --branch\): this run reads uncommitted edits first and the checked-out HEAD's branch diff only on a clean tree/,
    );
  });

  it('lint: a failing lint --branch blocks the push before the shield arm runs', () => {
    armLint();
    writeStub({
      helpText: '  --gate',
      helpExit: 0,
      reviewExit: 0,
      lintHelpText: '  --branch',
      lintExit: 1,
    });
    const result = runHook();
    expect(result.status).toBe(1);
    expect(invocations()).toContain('lint --branch');
    expect(invocations()).not.toContain('review --gate --branch');
  });
});
