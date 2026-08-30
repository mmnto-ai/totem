/**
 * Pre-push hook gate-mapped review invocation tests (mmnto-ai/totem#2473).
 *
 * The managed pre-push hook's strict arm consumes the gate-mapped review form:
 * probe `review --help` for `--gate` support, invoke `review --gate` when
 * present, fall back to the bare sensor form with a VISIBLE compat line when
 * absent (the `--scope-to-diff` defensive-degrade precedent). Structural
 * assertions cover every platform; the behavioral matrix executes the real
 * generated hook under `sh` with a stub CLI and is POSIX-only (the stub is a
 * shell script on PATH, which Windows CreateProcess cannot resolve — the
 * ubuntu/macos CI legs carry this coverage, the string assertions carry win32).
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
    const gateIdx = hook.indexOf('$TOTEM_CMD review --gate || exit 1');
    const compatIdx = hook.indexOf('Hook running review in compat mode');
    const bareIdx = hook.indexOf('$TOTEM_CMD review || exit 1');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(compatIdx).toBeGreaterThan(gateIdx);
    expect(bareIdx).toBeGreaterThan(compatIdx);
    // The compat disclosure is stderr-routed (a hook's stdout can be swallowed).
    expect(hook).toMatch(/Hook running review in compat mode[^\n]*" >&2/);
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
   */
  function writeStub(params: { helpText: string; helpExit: number; reviewExit: number }): void {
    const stub = `#!/bin/sh
printf '%s\\n' "$*" >> "${logPath}"
if [ "$1" = "doctor" ]; then exit 0; fi
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

  it('supported --gate: invokes the gate-mapped form and passes', () => {
    writeStub({
      helpText: 'Usage: totem review\n  --gate  declared mapping',
      helpExit: 0,
      reviewExit: 0,
    });
    const result = runHook();
    expect(result.status).toBe(0);
    expect(invocations()).toContain('review --gate');
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
    expect(invocations()).not.toContain('review --gate');
    expect(result.stderr).toContain('compat mode');
  });

  it('probe failure (help errors, no output): falls back to the bare form', () => {
    writeStub({ helpText: '', helpExit: 1, reviewExit: 0 });
    const result = runHook();
    expect(result.status).toBe(0);
    expect(invocations()).toContain('review');
    expect(invocations()).not.toContain('review --gate');
    expect(result.stderr).toContain('compat mode');
  });

  it('hard failure under --gate blocks the push (any nonzero — the unknown-disposition fail-closed exit rides this same arm)', () => {
    writeStub({ helpText: '  --gate', helpExit: 0, reviewExit: 3 });
    const result = runHook();
    expect(result.status).toBe(1);
    expect(invocations()).toContain('review --gate');
  });
});
