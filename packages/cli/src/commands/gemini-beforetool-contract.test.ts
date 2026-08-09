/**
 * Runtime deny/allow contract of the RENDERED `.gemini/hooks/BeforeTool.cjs`
 * artifact, executed the way Gemini CLI executes it: as a command hook —
 * `node BeforeTool.cjs` with the hook-input JSON on stdin (mmnto-ai/totem#2611).
 *
 * install-hooks-exit-contract.test.ts locks the INSTALLER's exit codes; nothing
 * there runs the guard itself, which is how a module.exports-only template
 * (defines a function, exits 0 = allow) shipped inert. This file is the
 * positive + negative control pair the Tenet 9 sense→enforce legitimacy gate
 * requires before the deferred registration slice (mmnto-ai/totem#2478) arms
 * the hook as blocking:
 *   - a rule-violating write DENIES: structured stdout
 *     {"decision":"deny","reason"} AND exit 2 (either channel denies under
 *     Gemini's contract — exit 1 is allow-with-warning, so a throw can never
 *     deny);
 *   - a clean write ALLOWS: exit 0, empty stdout;
 *   - input the guard cannot evaluate (unparseable JSON, missing tool_name) is
 *     allow-with-warning (exit 1) with a stderr breadcrumb — loud, not silent,
 *     and never a seat-bricking deny-everything;
 *   - require() still yields the bare function (entry point gated on
 *     require.main) so unit consumers and fixtures keep working.
 */
import { execFileSync } from 'node:child_process';
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
    try {
      const stdout = execFileSync(process.execPath, [hookPath], {
        input: stdin,
        encoding: 'utf-8',
        timeout: SPAWN_TIMEOUT_MS,
        cwd: tmpDir,
      });
      return { status: 0, stdout, stderr: '' };
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      // A spawn-layer failure (timeout, ENOENT) carries no status — rethrow so
      // it fails the test as itself rather than masquerading as a hook verdict.
      if (typeof e.status !== 'number') throw err;
      return { status: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
    }
  }

  it(
    'DENIES a rule-violating write: structured stdout decision AND exit 2 (negative control)',
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
    'ALLOWS a clean write: exit 0, empty stdout (positive control)',
    () => {
      const run = runHook(
        JSON.stringify({
          tool_name: 'write_file',
          tool_input: { file_path: 'notes.md', content: 'Plain prose, no governed patterns.' },
        }),
      );
      expect(run.status).toBe(0);
      expect(run.stdout).toBe('');
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
