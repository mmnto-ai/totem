/**
 * Runtime deny/allow contract of the RENDERED `.gemini/hooks/BeforeTool.cjs`
 * artifact, executed the way Gemini CLI executes it: as a command hook —
 * `node BeforeTool.cjs` with the hook-input JSON on stdin (mmnto-ai/totem#2611).
 *
 * install-hooks-exit-contract.test.ts locks the INSTALLER's exit codes; nothing
 * there runs the guard itself, which is how a module.exports-only template
 * (defines a function, exits 0 = allow) shipped inert. This file supplies the
 * positive and negative controls of the Tenet 9 sense→enforce legitimacy gate
 * (provenance · positive control · negative control) ahead of the deferred
 * registration slice (mmnto-ai/totem#2478) arming the hook as blocking;
 * provenance is the leg receipts on mmnto-ai/totem#2611 and #2610's PR thread:
 *   - POSITIVE CONTROL (fires on the violation): a rule-violating write DENIES
 *     via structured stdout {"decision":"deny","reason"} AND exit 2 (either
 *     channel denies under Gemini's contract — exit 1 is allow-with-warning,
 *     so a throw can never deny). This case and both cannot-evaluate cases
 *     FAIL against the pre-fix inert artifact (mutation-checked);
 *   - NEGATIVE CONTROL (does not fire on the miss): a clean write ALLOWS with
 *     exit 0 and silent stdout/stderr. Passes against the inert artifact too —
 *     it guards regression, not the fix;
 *   - input the guard cannot evaluate (unparseable JSON, missing tool_name) is
 *     allow-with-warning (exit 1) with a stderr breadcrumb — loud, not silent,
 *     and never a seat-bricking deny-everything;
 *   - require() still yields the bare function (entry point gated on
 *     require.main) so unit consumers and fixtures keep working (regression
 *     guard; also passes pre-fix).
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import { GEMINI_BEFORE_TOOL, GEMINI_BEFORE_TOOL_REL } from './init-templates.js';

const SPAWN_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 30_000;

interface HookRun {
  status: number;
  stdout: string;
  stderr: string;
}

describe('rendered BeforeTool.cjs — Gemini command-hook contract (mmnto-ai/totem#2611)', () => {
  let tmpDir: string;
  let hookPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-2611-bt-'));
    hookPath = path.join(tmpDir, ...GEMINI_BEFORE_TOOL_REL.split('/'));
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    fs.writeFileSync(hookPath, GEMINI_BEFORE_TOOL, 'utf-8');
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  function runHook(stdin: string): HookRun {
    const run = spawnSync(process.execPath, [hookPath], {
      input: stdin,
      encoding: 'utf-8',
      timeout: SPAWN_TIMEOUT_MS,
      cwd: tmpDir,
    });
    // A spawn-layer failure (timeout, ENOENT, signal kill) carries no exit
    // status — surface it as itself rather than masquerading as a hook verdict.
    if (run.error) throw run.error;
    if (run.status === null) throw new Error('hook process terminated without an exit status');
    return { status: run.status, stdout: run.stdout, stderr: run.stderr };
  }

  it(
    'DENIES a rule-violating write: structured stdout decision AND exit 2 (positive control)',
    () => {
      const run = runHook(
        JSON.stringify({
          tool_name: 'write_file',
          tool_input: { file_path: 'notes.md', content: 'Closes #123 when this merges.' },
        }),
      );
      expect(run.status).toBe(2);
      const decision = JSON.parse(run.stdout) as { decision: string; reason: string };
      expect(decision.decision).toBe('deny');
      expect(decision.reason).toMatch(/auto-close keyword/i);
      // The human transcript gets the same reason via stderr.
      expect(run.stderr).toMatch(/auto-close keyword/i);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'ALLOWS a clean write: exit 0, silent stdout AND stderr (negative control)',
    () => {
      const run = runHook(
        JSON.stringify({
          tool_name: 'write_file',
          tool_input: { file_path: 'notes.md', content: 'Plain prose, no governed patterns.' },
        }),
      );
      expect(run.status).toBe(0);
      expect(run.stdout).toBe('');
      expect(run.stderr).toBe('');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'unparseable hook input is allow-WITH-WARNING (exit 1 + stderr breadcrumb), never a deny',
    () => {
      const run = runHook('not json {');
      expect(run.status).toBe(1);
      expect(run.stdout).toBe('');
      expect(run.stderr).toMatch(/not parseable JSON/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'parseable input without a tool_name is allow-WITH-WARNING (exit 1 + stderr breadcrumb)',
    () => {
      const run = runHook('{}');
      expect(run.status).toBe(1);
      expect(run.stdout).toBe('');
      expect(run.stderr).toMatch(/no tool_name/);
    },
    TEST_TIMEOUT_MS,
  );

  it('require() yields the bare guard function — entry point stays gated on require.main', () => {
    const requireCjs = createRequire(import.meta.url);
    const guard = requireCjs(hookPath) as (toolName: string, toolInput: unknown) => void;
    expect(typeof guard).toBe('function');
    // Clean input passes through the required surface without throwing.
    expect(() =>
      guard('write_file', { file_path: 'notes.md', content: 'Plain prose.' }),
    ).not.toThrow();
  });
});
