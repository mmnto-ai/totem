/**
 * Runtime contract of the RENDERED `.gemini/hooks/SessionStart.cjs` artifact,
 * executed the way Gemini CLI executes it (mmnto-ai/totem#2613).
 *
 * Interactive Gemini ingests SessionStart CONTEXT only from the
 * `hookSpecificOutput.additionalContext` envelope — plain exit-0 stdout wraps
 * as `systemMessage`, which the interactive startup consumer never injects, so
 * a plain-text briefing never reached model context in the primary dev flow.
 * The template emits BOTH keys: the envelope for model context, and
 * `systemMessage` for the human surfaces (interactive startup and `/clear`
 * render it as a UI info item via the hook-system-message path; `-p` echoes it
 * to stderr).
 *
 * The shim emits on BOTH streams because the real verbs do: `totem describe`
 * writes its whole banner to STDERR (the CLI routes all logging there) — a
 * stdout-only capture drops that leg entirely, and a stdout-only shim would
 * mask it (exactly what round 1 of the mmnto-ai/totem#2613 falsification
 * caught in this file's first draft).
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cleanTmpDir } from '../test-utils.js';
import { GEMINI_SESSION_START, GEMINI_SESSION_START_REL } from './init-templates.js';

const SPAWN_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 90_000;

interface Envelope {
  systemMessage: string;
  hookSpecificOutput: { hookEventName: string; additionalContext: string };
}

/** Cross-platform `totem` shim tagging BOTH streams with its argv — the real
 *  describe banner lands on stderr, orient's block on stdout. */
function writeTotemShim(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'totem.cmd'),
    '@echo off\r\necho shim-out %*\r\necho shim-err %* 1>&2\r\n',
    'utf-8',
  );
  const sh = path.join(dir, 'totem');
  fs.writeFileSync(sh, '#!/bin/sh\necho "shim-out $@"\necho "shim-err $@" 1>&2\n', 'utf-8');
  fs.chmodSync(sh, 0o755);
}

describe('rendered SessionStart.cjs — Gemini envelope contract (mmnto-ai/totem#2613)', () => {
  let tmpDir: string;
  let hookPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-2613-ss-'));
    hookPath = path.join(tmpDir, ...GEMINI_SESSION_START_REL.split('/'));
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    fs.writeFileSync(hookPath, GEMINI_SESSION_START, 'utf-8');
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  function runHook(pathEnv: string): { status: number | null; stdout: string; stderr: string } {
    const run = spawnSync(process.execPath, [hookPath], {
      cwd: tmpDir,
      encoding: 'utf-8',
      timeout: SPAWN_TIMEOUT_MS,
      input: '',
      env: { ...process.env, PATH: pathEnv, Path: pathEnv },
    });
    if (run.error) throw run.error;
    return { status: run.status, stdout: run.stdout, stderr: run.stderr };
  }

  it(
    'captures BOTH streams of both legs, in order, into the envelope AND systemMessage',
    () => {
      const shimDir = path.join(tmpDir, 'shim');
      writeTotemShim(shimDir);
      const run = runHook(shimDir + path.delimiter + process.env.PATH);

      expect(run.status).toBe(0);
      // The whole stdout is one JSON payload — anything outside it would break
      // Gemini's parse back into the plain-text systemMessage wrap.
      const envelope = JSON.parse(run.stdout) as Envelope;
      expect(envelope.hookSpecificOutput.hookEventName).toBe('SessionStart');
      const ctx = envelope.hookSpecificOutput.additionalContext;
      // Both streams of both legs (describe's banner is a STDERR artifact).
      expect(ctx).toMatch(/shim-out describe/);
      expect(ctx).toMatch(/shim-err describe/);
      expect(ctx).toMatch(/shim-out orient --session/);
      expect(ctx).toMatch(/shim-err orient --session/);
      // Leg order: describe (static identity) before orient (live state).
      expect(ctx.indexOf('shim-out describe')).toBeLessThan(ctx.indexOf('shim-out orient'));
      // systemMessage carries the same briefing for the /clear and -p surfaces.
      expect(envelope.systemMessage).toBe(ctx);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'fails soft with no resolvable totem: exit 0, unavailable note rides the envelope',
    () => {
      const emptyDir = path.join(tmpDir, 'empty-path');
      fs.mkdirSync(emptyDir, { recursive: true });
      const run = runHook(emptyDir);

      expect(run.status).toBe(0);
      const envelope = JSON.parse(run.stdout) as Envelope;
      expect(envelope.hookSpecificOutput.hookEventName).toBe('SessionStart');
      expect(envelope.hookSpecificOutput.additionalContext).toMatch(/Briefing unavailable/);
      // The note must ALSO ride systemMessage — that key is what the human
      // surfaces render, and it is the assertion that distinguishes the
      // dual-key contract from the envelope-only intermediate shape.
      expect(envelope.systemMessage).toMatch(/Briefing unavailable/);
      // The orient gap is noted in the briefing too (a stderr-only note is
      // invisible to the model), and the breadcrumb stays for diagnostics.
      expect(envelope.hookSpecificOutput.additionalContext).toMatch(/Orient briefing unavailable/);
      expect(run.stderr).toMatch(/orient briefing unavailable/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'a failing orient leg carries its partial stdout plus the unavailable note in both keys',
    () => {
      // Shim: both legs emit on both streams; the orient invocation exits 3.
      const shimDir = path.join(tmpDir, 'shim-orient-fail');
      fs.mkdirSync(shimDir, { recursive: true });
      fs.writeFileSync(
        path.join(shimDir, 'totem.cmd'),
        '@echo off\r\necho shim-out %*\r\necho shim-err %* 1>&2\r\nif "%1"=="orient" exit /b 3\r\n',
        'utf-8',
      );
      const sh = path.join(shimDir, 'totem');
      fs.writeFileSync(
        sh,
        '#!/bin/sh\necho "shim-out $@"\necho "shim-err $@" 1>&2\ncase "$1" in orient) exit 3;; esac\n',
        'utf-8',
      );
      fs.chmodSync(sh, 0o755);
      const run = runHook(shimDir + path.delimiter + process.env.PATH);

      expect(run.status).toBe(0);
      const envelope = JSON.parse(run.stdout) as Envelope;
      const ctx = envelope.hookSpecificOutput.additionalContext;
      // Describe leg intact (both streams), orient partial stdout carried, and
      // the note (reason = the leg's stderr) rides the briefing.
      expect(ctx).toMatch(/shim-out describe/);
      expect(ctx).toMatch(/shim-err describe/);
      expect(ctx).toMatch(/shim-out orient --session/);
      expect(ctx).toMatch(/Orient briefing unavailable: shim-err orient --session/);
      expect(envelope.systemMessage).toBe(ctx);
      expect(run.stderr).toMatch(/orient briefing unavailable/);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('rendered SessionStart.cjs — refresh-gh armed path stays out of the decision channel', () => {
  let tmpDir: string;
  let hookPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-2613-gh-'));
    hookPath = path.join(tmpDir, ...GEMINI_SESSION_START_REL.split('/'));
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    fs.writeFileSync(hookPath, GEMINI_SESSION_START, 'utf-8');
  });

  afterEach(() => {
    // A real `.git` dir in a temp cwd hits the known Windows lock class (a
    // detached-child exit racing cleanup, or a scanner holding the fresh dir)
    // — the repo's long-path/temp-cwd lesson. Settle-and-retry before failing.
    for (let attempt = 0; ; attempt++) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
        return;
      } catch (err) {
        if (attempt >= 3) throw err;
        const until = Date.now() + 400;
        while (Date.now() < until) {
          // settle window — release of the root-dir handle is external
        }
      }
    }
  });

  it(
    'stdout stays exactly one JSON payload even with the refresh-gh leg armed',
    () => {
      // A `.git` DIRECTORY arms the refresh-gh spawn — the only other code in
      // the template that could conceivably touch stdout. Which branch this
      // proves is platform-split: on win32 the extension-less spawn (no shell)
      // cannot resolve the .cmd shim, so this pins the spawn-reject-quiet
      // branch; on the POSIX CI legs the 0755 shim executes and this pins that
      // a chatty child's output routes to the log fd. Both must keep stdout as
      // exactly the JSON payload.
      fs.mkdirSync(path.join(tmpDir, '.git'));
      const shimDir = path.join(tmpDir, 'shim');
      writeTotemShim(shimDir);
      fs.writeFileSync(
        path.join(shimDir, 'totem-status.cmd'),
        '@echo off\r\necho STATUS-NOISE-OUT\r\necho STATUS-NOISE-ERR 1>&2\r\n',
        'utf-8',
      );
      const statusSh = path.join(shimDir, 'totem-status');
      fs.writeFileSync(
        statusSh,
        '#!/bin/sh\necho STATUS-NOISE-OUT\necho STATUS-NOISE-ERR 1>&2\n',
        'utf-8',
      );
      fs.chmodSync(statusSh, 0o755);

      // PATH is the shim dir ALONE: appending the real PATH here let the
      // hook's detached spawn resolve the machine's actual totem-status.exe
      // sidecar, which ran a real multi-second refresh holding the temp cwd
      // (deterministic EPERM on cleanup). The shell and node resolve via
      // absolute paths (ComSpec / execPath), so nothing else is needed.
      const run = spawnSync(process.execPath, [hookPath], {
        cwd: tmpDir,
        encoding: 'utf-8',
        timeout: SPAWN_TIMEOUT_MS,
        input: '',
        env: { ...process.env, PATH: shimDir, Path: shimDir },
      });
      if (run.error) throw run.error;

      expect(run.status).toBe(0);
      expect(run.stdout).not.toContain('STATUS-NOISE');
      const envelope = JSON.parse(run.stdout) as Envelope;
      expect(envelope.hookSpecificOutput.additionalContext).toMatch(/shim-out describe/);
    },
    TEST_TIMEOUT_MS,
  );
});
