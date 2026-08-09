/**
 * Runtime contract of the RENDERED `.gemini/hooks/SessionStart.cjs` artifact,
 * executed the way Gemini CLI executes it (mmnto-ai/totem#2613).
 *
 * Interactive Gemini ingests SessionStart output ONLY from the
 * `hookSpecificOutput.additionalContext` envelope — plain exit-0 stdout wraps
 * as `systemMessage`, which the interactive startup consumer never reads, so a
 * plain-text briefing is silently dropped in the primary dev flow. This file
 * pins the envelope contract on the rendered artifact:
 *   - with a resolvable `totem`, stdout is EXACTLY one JSON envelope whose
 *     additionalContext carries both briefing legs (describe + orient);
 *   - with no resolvable `totem`, the hook still exits 0 (fail-soft boot
 *     contract) and the unavailable note rides the envelope so it reaches
 *     interactive context rather than only stderr.
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
  hookSpecificOutput: { hookEventName: string; additionalContext: string };
}

describe('rendered SessionStart.cjs — Gemini envelope contract (mmnto-ai/totem#2613)', () => {
  let tmpDir: string;
  let hookPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-2613-ss-'));
    hookPath = path.join(tmpDir, ...GEMINI_SESSION_START_REL.split('/'));
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    fs.writeFileSync(hookPath, GEMINI_SESSION_START, 'utf-8');
    // No `.git` in the temp cwd: the refresh-gh leg gates on `.git` being a
    // directory, so it stays quiet and the test exercises the briefing legs.
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  /** Write a cross-platform `totem` shim that echoes a tag plus its argv. */
  function writeTotemShim(dir: string): void {
    fs.mkdirSync(dir, { recursive: true });
    // Windows resolution goes through PATHEXT (.CMD); POSIX through the
    // executable bit on the extension-less file. Both are written; only the
    // platform-appropriate one resolves.
    fs.writeFileSync(path.join(dir, 'totem.cmd'), '@echo off\r\necho shim-run %*\r\n', 'utf-8');
    const sh = path.join(dir, 'totem');
    fs.writeFileSync(sh, '#!/bin/sh\necho "shim-run $@"\n', 'utf-8');
    fs.chmodSync(sh, 0o755);
  }

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
    'emits exactly one envelope carrying BOTH briefing legs when totem resolves',
    () => {
      const shimDir = path.join(tmpDir, 'shim');
      writeTotemShim(shimDir);
      const run = runHook(shimDir + path.delimiter + process.env.PATH);

      expect(run.status).toBe(0);
      // The whole stdout is the envelope — nothing outside it (plain leakage
      // ahead of the JSON would break Gemini's parse back into systemMessage).
      const envelope = JSON.parse(run.stdout) as Envelope;
      expect(envelope.hookSpecificOutput.hookEventName).toBe('SessionStart');
      expect(envelope.hookSpecificOutput.additionalContext).toMatch(/shim-run describe/);
      expect(envelope.hookSpecificOutput.additionalContext).toMatch(/shim-run orient --session/);
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
      // The orient leg's failure stays a stderr breadcrumb (its pre-fix surface).
      expect(run.stderr).toMatch(/orient briefing unavailable/);
    },
    TEST_TIMEOUT_MS,
  );
});
