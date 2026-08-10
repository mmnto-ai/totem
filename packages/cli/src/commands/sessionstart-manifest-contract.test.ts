/**
 * Contract of the RENDERED SessionStart templates' inline selection-manifest
 * rows (mmnto-ai/totem#2468 M1).
 *
 * The published `.cjs` templates run standalone in consumer repos, so they
 * hand-build their manifest rows instead of importing core's writer. That is
 * a drift hazard by construction; this suite is the coupling that makes it
 * safe: every row a rendered template emits MUST parse under the REAL
 * `SelectionManifestRowSchema` (strict at both levels). Change the schema or
 * a template and this suite forces the other to move in the same PR.
 *
 * Executed the way the host runtimes execute the hooks: `node <hook>` in a
 * temp cwd (the gemini-sessionstart-contract pattern).
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SelectionManifestRowSchema } from '@mmnto/totem';

import { cleanTmpDir } from '../test-utils.js';
import { CLAUDE_SESSION_START, GEMINI_SESSION_START } from './init-templates.js';

const SPAWN_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 90_000;

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-2468-ss-'));
});

afterEach(() => {
  cleanTmpDir(tmpDir);
});

function writeHook(rel: string, content: string): string {
  const hookPath = path.join(tmpDir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(hookPath), { recursive: true });
  fs.writeFileSync(hookPath, content, 'utf-8');
  return hookPath;
}

function runHook(
  hookPath: string,
  opts: { pathEnv?: string; seat?: string } = {},
): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const env = { ...process.env };
  // Deterministic attribution baseline: absent unless the test stamps a seat.
  // ADR-078 / leg round 1 MB-2 — agent_source comes ONLY from this env var.
  delete env.TOTEM_SELF_AGENT;
  if (opts.seat !== undefined) env.TOTEM_SELF_AGENT = opts.seat;
  if (opts.pathEnv !== undefined) {
    env.PATH = opts.pathEnv;
    env.Path = opts.pathEnv;
  }
  const run = spawnSync(process.execPath, [hookPath], {
    cwd: tmpDir,
    encoding: 'utf-8',
    timeout: SPAWN_TIMEOUT_MS,
    input: '',
    env,
  });
  if (run.error) throw run.error;
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

function readNdjson(rel: string): Array<Record<string, unknown>> {
  return fs
    .readFileSync(path.join(tmpDir, rel), 'utf-8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** Cross-platform `totem` shim for the Gemini template's shell-resolved legs. */
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

/** Stub `@mmnto/cli` dist so the Claude template's node-spawned legs emit. */
function writeCliStub(): void {
  const distDir = path.join(tmpDir, 'node_modules', '@mmnto', 'cli', 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(
    path.join(distDir, 'index.js'),
    "process.stdout.write('stub-' + process.argv[2] + ' output\\n');\n",
    'utf-8',
  );
}

function expectValidRow(row: Record<string, unknown>): void {
  const parsed = SelectionManifestRowSchema.safeParse(row);
  expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues, null, 2)).toBe(
    true,
  );
}

describe('rendered Gemini SessionStart — manifest + A.3.a contract (mmnto-ai/totem#2468)', () => {
  it(
    'emits a schema-valid manifest row keyed to the minted session id, and the session_start denominator row',
    () => {
      const hookPath = writeHook('.gemini/hooks/SessionStart.cjs', GEMINI_SESSION_START);
      const shimDir = path.join(tmpDir, 'shim');
      writeTotemShim(shimDir);
      const run = runHook(hookPath, { pathEnv: shimDir + path.delimiter + process.env.PATH });
      expect(run.status).toBe(0);

      // Envelope untouched by the new blocks — stdout is still one JSON payload.
      const envelope = JSON.parse(run.stdout) as {
        hookSpecificOutput: { hookEventName: string };
      };
      expect(envelope.hookSpecificOutput.hookEventName).toBe('SessionStart');

      const sessionId = fs
        .readFileSync(path.join(tmpDir, '.totem', 'ledger', '.session-id'), 'utf-8')
        .trim();

      // A.3.a denominator row — new for the Gemini template with this slice.
      const events = readNdjson('.totem/ledger/events.ndjson');
      const sessionStart = events.filter((e) => e.type === 'session_start');
      expect(sessionStart).toHaveLength(1);
      expect(sessionStart[0]!.session_id).toBe(sessionId);

      const rows = readNdjson('.totem/ledger/selection-manifests.ndjson');
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expectValidRow(row);
      expect(row.emitter).toBe('session-start');
      expect(row.session_id).toBe(sessionId);
      expect(row.context).toEqual({ template: 'gemini-managed' });
      const candidates = row.candidates as Array<Record<string, unknown>>;
      expect(candidates.map((c) => c.id)).toEqual(['describe', 'orient:session-block']);
      expect(candidates.every((c) => c.disposition === 'selected')).toBe(true);
      expect(candidates.every((c) => (c.bytes as number) > 0)).toBe(true);
      expect(candidates.every((c) => /^[0-9a-f]{16}$/.test(String(c.fingerprint)))).toBe(true);

      // Attribution is stamped absence (ADR-078; leg round 1 MB-2): with
      // TOTEM_SELF_AGENT unset, NEITHER row guesses a seat.
      expect(sessionStart[0]!.agent_source).toBeUndefined();
      expect(row.agent_source).toBeUndefined();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'stamps the seat on both rows when TOTEM_SELF_AGENT is set',
    () => {
      const hookPath = writeHook('.gemini/hooks/SessionStart.cjs', GEMINI_SESSION_START);
      const shimDir = path.join(tmpDir, 'shim');
      writeTotemShim(shimDir);
      const run = runHook(hookPath, {
        pathEnv: shimDir + path.delimiter + process.env.PATH,
        seat: 'seat-x, seat-y',
      });
      expect(run.status).toBe(0);
      const events = readNdjson('.totem/ledger/events.ndjson');
      expect(events.find((e) => e.type === 'session_start')!.agent_source).toBe('seat-x');
      const rows = readNdjson('.totem/ledger/selection-manifests.ndjson');
      expect(rows[0]!.agent_source).toBe('seat-x');
    },
    TEST_TIMEOUT_MS,
  );
});

describe('rendered Claude SessionStart — manifest contract (mmnto-ai/totem#2468)', () => {
  it(
    'emits a schema-valid two-candidate row when the CLI is installed',
    () => {
      const hookPath = writeHook('.claude/hooks/SessionStart.cjs', CLAUDE_SESSION_START);
      writeCliStub();
      const run = runHook(hookPath, { seat: 'seat-x' });
      expect(run.status).toBe(0);
      // The briefing itself still reaches stdout ahead of any telemetry.
      expect(run.stdout).toContain('stub-describe output');

      const sessionId = fs
        .readFileSync(path.join(tmpDir, '.totem', 'ledger', '.session-id'), 'utf-8')
        .trim();
      const rows = readNdjson('.totem/ledger/selection-manifests.ndjson');
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expectValidRow(row);
      expect(row.session_id).toBe(sessionId);
      expect(row.agent_source).toBe('seat-x');
      // The A.3.a denominator row stamps the same seat (leg round 2,
      // finding 6 — symmetry with the Gemini pinning).
      const events = readNdjson('.totem/ledger/events.ndjson');
      expect(events.find((e) => e.type === 'session_start')!.agent_source).toBe('seat-x');
      expect(row.context).toEqual({ template: 'claude-managed' });
      const candidates = row.candidates as Array<Record<string, unknown>>;
      expect(candidates.map((c) => c.id)).toEqual(['describe', 'orient:session-block']);
      expect(candidates.every((c) => (c.bytes as number) > 0)).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'emits an honest zero-candidate row when the CLI is not installed (nothing was injected), with no guessed seat',
    () => {
      const hookPath = writeHook('.claude/hooks/SessionStart.cjs', CLAUDE_SESSION_START);
      const run = runHook(hookPath);
      expect(run.status).toBe(0);
      const rows = readNdjson('.totem/ledger/selection-manifests.ndjson');
      expect(rows).toHaveLength(1);
      expectValidRow(rows[0]!);
      expect(rows[0]!.candidates).toEqual([]);
      // Attribution is stamped absence (ADR-078; leg round 1 MB-2) — on the
      // denominator row too (leg round 2, finding 6).
      expect(rows[0]!.agent_source).toBeUndefined();
      const events = readNdjson('.totem/ledger/events.ndjson');
      expect(events.find((e) => e.type === 'session_start')!.agent_source).toBeUndefined();
    },
    TEST_TIMEOUT_MS,
  );
});
