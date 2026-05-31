import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { knownGateEvents, TotemError } from '@mmnto/totem';

import { ejectCommand } from './eject.js';
import { gateInstallCommand, resolveGateEvents } from './gate.js';
import { commandInstallsGate, GATE_WRAPPER_REL, installGates } from './gate-install.js';
import { initCommand } from './init.js';
import { CLAUDE_GATE_WRAPPER } from './init-templates.js';

/**
 * CLI-seam tests for `totem gate install` + the parameterized gate wrapper
 * (PR-C, mmnto-ai/totem#2048).
 *
 * Locks the invariants in spec 2048.md §"Invariants the tests lock":
 *   - idempotent merge (re-run is a no-op)
 *   - `--all` enumerates `knownGateEvents()`; unknown `--<name>` / `--gates=`
 *     member fails loud (no default-install)
 *   - the wrapper's disposition → exit-code map, including the LOAD-BEARING
 *     empty-subsystem pass-through and the applicable-gate-source-broken
 *     fail-closed
 *   - `eject` removes the gate entry (parity with install)
 *   - `init --gates=` routes through the SAME installer as the verb
 *
 * The engine itself (allow/deny/no-file/side-effect-free) is covered by
 * `@mmnto/totem`'s gate-engine.test.ts and is NOT duplicated here.
 */

function makeTmpDir(): string {
  // `.native` expands Windows 8.3 short names so process.cwd()/realpath agree.
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-gate-install-')));
}

function readSettings(cwd: string): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(cwd, '.claude', 'settings.json'), 'utf-8');
  return JSON.parse(raw);
}

function preToolUseEntries(cwd: string): Array<{ matcher?: string; hooks?: Array<unknown> }> {
  const parsed = readSettings(cwd);
  const hooks = (parsed.hooks ?? {}) as Record<string, unknown>;
  return (hooks.PreToolUse ?? []) as Array<{ matcher?: string; hooks?: Array<unknown> }>;
}

/** Count Write|Edit PreToolUse entries whose command references a given gate. */
function gateEntryCount(cwd: string, event: string): number {
  return preToolUseEntries(cwd).filter(
    (e) =>
      e.matcher === 'Write|Edit' &&
      Array.isArray(e.hooks) &&
      e.hooks.some((h) => {
        const cmd = typeof h === 'string' ? h : ((h as { command?: string })?.command ?? '');
        // Collision-safe exact --event match (tier-independent).
        return commandInstallsGate(cmd, event);
      }),
  ).length;
}

describe('installGates / gate install (settings merge)', () => {
  let cwd: string;
  let originalCwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(cwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it('scaffolds the wrapper and merges one PreToolUse entry per gate', () => {
    const results = installGates(cwd, ['freeze-check']);
    // wrapper scaffold + one entry merge
    expect(results.some((r) => r.file === GATE_WRAPPER_REL && r.action === 'created')).toBe(true);
    expect(fs.existsSync(path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs'))).toBe(true);
    expect(gateEntryCount(cwd, 'freeze-check')).toBe(1);
  });

  it('is idempotent: a second install of the same gate is a no-op', () => {
    installGates(cwd, ['freeze-check']);
    const before = JSON.stringify(readSettings(cwd));

    const second = installGates(cwd, ['freeze-check']);
    const entryResult = second.find((r) => r.event === 'freeze-check');
    expect(entryResult?.action).toBe('skipped');
    expect(gateEntryCount(cwd, 'freeze-check')).toBe(1);
    expect(JSON.stringify(readSettings(cwd))).toBe(before);
  });

  it('keys idempotency on the per-gate command substring (distinct gates → distinct entries)', () => {
    // freeze-check installed; a hypothetical future gate keyed on a different
    // --event substring produces a SECOND entry rather than colliding.
    installGates(cwd, ['freeze-check']);
    installGates(cwd, ['some-future-gate']);
    expect(gateEntryCount(cwd, 'freeze-check')).toBe(1);
    expect(gateEntryCount(cwd, 'some-future-gate')).toBe(1);
    // Two distinct Write|Edit gate entries under one matcher.
    const gateEntries = preToolUseEntries(cwd).filter(
      (e) =>
        e.matcher === 'Write|Edit' &&
        Array.isArray(e.hooks) &&
        e.hooks.some((h) => {
          const cmd = typeof h === 'string' ? h : ((h as { command?: string })?.command ?? '');
          return cmd.includes('gate-wrapper.cjs --event ');
        }),
    );
    expect(gateEntries.length).toBe(2);
  });

  it('preserves a pre-existing user PreToolUse entry when merging', () => {
    fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'my-hook' }] }],
        },
      }),
    );
    installGates(cwd, ['freeze-check']);
    const entries = preToolUseEntries(cwd);
    expect(entries.some((e) => e.matcher === 'Bash')).toBe(true);
    expect(gateEntryCount(cwd, 'freeze-check')).toBe(1);
  });

  it('gateInstallCommand --all installs every known gate', async () => {
    await gateInstallCommand({ all: true });
    for (const event of knownGateEvents()) {
      expect(gateEntryCount(cwd, event)).toBe(1);
    }
  });
});

describe('resolveGateEvents (registry-driven validation)', () => {
  it('--all enumerates knownGateEvents()', async () => {
    expect(await resolveGateEvents({ all: true })).toEqual(knownGateEvents());
  });

  it('a known --<name> resolves to itself', async () => {
    expect(await resolveGateEvents({ name: 'freeze-check' })).toEqual(['freeze-check']);
  });

  it('an unknown --<name> fails loud (never default-install)', async () => {
    await expect(resolveGateEvents({ name: 'made-up-gate' })).rejects.toBeInstanceOf(TotemError);
    await expect(resolveGateEvents({ name: 'made-up-gate' })).rejects.toThrow(/unknown gate/i);
  });

  it('no --all and no --<name> fails loud (no default-install)', async () => {
    await expect(resolveGateEvents({})).rejects.toThrow(/no gate selected/i);
  });
});

// ─── The parameterized wrapper's disposition → exit-code map ───────────
//
// We render the wrapper template to a temp dir and drive it via stdin with
// synthetic PreToolUse envelopes. A stub `node_modules/@mmnto/cli/dist/index.js`
// stands in for the local CLI: it echoes a verdict / exit code driven by env
// vars so the test controls each disposition deterministically WITHOUT the
// real engine (the engine is covered by gate-engine.test.ts).
describe('gate-wrapper.cjs disposition → exit code', () => {
  let cwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
    // Render the wrapper exactly as `installGates` would.
    fs.mkdirSync(path.join(cwd, '.claude', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs'), CLAUDE_GATE_WRAPPER);
  });

  afterEach(() => {
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  /** Install a stub local CLI that emits a controlled verdict / exit code. */
  function writeStubCli(opts: { verdict?: unknown; exit?: number }): void {
    const distDir = path.join(cwd, 'node_modules', '@mmnto', 'cli', 'dist');
    fs.mkdirSync(distDir, { recursive: true });
    const verdictJson = opts.verdict === undefined ? '' : JSON.stringify(opts.verdict);
    const exitCode = opts.exit ?? 0;
    // CommonJS stub (the wrapper invokes via `node <path>`); .js is fine here
    // because there is no package.json type:module in the temp dir.
    const stub = [
      '"use strict";',
      `const out = ${JSON.stringify(verdictJson)};`,
      'if (out) process.stdout.write(out + "\\n");',
      `process.exit(${exitCode});`,
      '',
    ].join('\n');
    fs.writeFileSync(path.join(distDir, 'index.js'), stub);
  }

  /** Run the rendered wrapper with the given envelope + baked extra args. */
  function runWrapper(
    envelope: unknown,
    extraArgs: string[] = [],
  ): { status: number | null; stderr: string } {
    const wrapperPath = path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs');
    const res = spawnSync(
      process.execPath,
      [wrapperPath, '--event', 'freeze-check', ...extraArgs],
      {
        cwd,
        input: JSON.stringify(envelope),
        encoding: 'utf-8',
        timeout: 30000,
      },
    );
    return { status: res.status, stderr: res.stderr ?? '' };
  }

  const EDIT_NO_SUBSYSTEM = { tool_name: 'Edit', tool_input: { file_path: 'src/foo.ts' } };
  const DECLARED = { tool_name: 'Edit', tool_input: { subsystem: 'rule-compilation' } };

  it('allow → exit 0 (silent)', () => {
    writeStubCli({ verdict: { disposition: 'allow', reason: 'ok', provenance: {} }, exit: 0 });
    const { status } = runWrapper(DECLARED);
    expect(status).toBe(0);
  });

  it('warn → exit 0 + reason/provenance to stderr (advisory, never blocks)', () => {
    writeStubCli({
      verdict: { disposition: 'warn', reason: 'heads up', provenance: { source: 's' } },
      exit: 0,
    });
    const { status, stderr } = runWrapper(DECLARED);
    expect(status).toBe(0);
    expect(stderr).toMatch(/warn/i);
    expect(stderr).toContain('heads up');
  });

  it('deny → exit 2 under --strict (default) + stderr', () => {
    writeStubCli({
      verdict: { disposition: 'deny', reason: 'frozen', provenance: { matched: 'x' } },
      exit: 0,
    });
    const { status, stderr } = runWrapper(DECLARED);
    expect(status).toBe(2);
    expect(stderr).toContain('frozen');
  });

  it('deny → exit 0 under --pilot + stderr (advisory tier)', () => {
    writeStubCli({
      verdict: { disposition: 'deny', reason: 'frozen', provenance: {} },
      exit: 0,
    });
    const { status, stderr } = runWrapper(DECLARED, ['--pilot']);
    expect(status).toBe(0);
    expect(stderr).toContain('frozen');
  });

  it('no-declared-subsystem Edit → exit 0 pass-through (gate NOT invoked)', () => {
    // Stub emits a DENY; if the wrapper invoked it, exit would be 2. The
    // empty-subsystem guardrail must short-circuit to exit 0 WITHOUT shelling
    // out (LOAD-BEARING: protects every ordinary edit from being blocked).
    writeStubCli({ verdict: { disposition: 'deny', reason: 'should not run', provenance: {} } });
    const { status } = runWrapper(EDIT_NO_SUBSYSTEM);
    expect(status).toBe(0);
  });

  it('applicable-gate-source-broken (non-zero gate check) → exit 2 fail-closed', () => {
    // A declared subsystem IS present (gate applies) and `gate check` exits
    // non-zero (corrupt freeze.json etc.) → fail-closed block.
    writeStubCli({ exit: 1 });
    const { status, stderr } = runWrapper(DECLARED);
    expect(status).toBe(2);
    expect(stderr).toMatch(/fail-closed/i);
  });

  it('malformed stdin envelope → exit 0 fail-soft', () => {
    writeStubCli({ verdict: { disposition: 'deny' } });
    const wrapperPath = path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs');
    const res = spawnSync(process.execPath, [wrapperPath, '--event', 'freeze-check'], {
      cwd,
      input: '{ not valid json',
      encoding: 'utf-8',
      timeout: 30000,
    });
    expect(res.status).toBe(0);
  });

  // ─── FIX 2: applicable gate but no local CLI dist → fail-closed ────────
  it('applicable gate but the local CLI dist is missing → exit 2 fail-closed (FIX 2)', () => {
    // Deliberately do NOT write the stub CLI. A declared subsystem makes the
    // gate APPLY, but @mmnto/cli is not resolvable. freeze-check has no
    // commit-time hard floor, so an applicable-but-unevaluable gate must fail
    // closed (exit 2) rather than silently allow (exit 0).
    const { status, stderr } = runWrapper(DECLARED);
    expect(status).toBe(2);
    expect(stderr).toMatch(/not resolvable|not installed|failing closed/i);
  });

  it('gate check exits 0 with unparseable stdout → exit 2 fail-closed', () => {
    // verdict undefined → stub emits nothing; the wrapper cannot parse a
    // verdict from a 0-exit gate → fail-closed.
    writeStubCli({ verdict: undefined, exit: 0 });
    const { status, stderr } = runWrapper(DECLARED);
    expect(status).toBe(2);
    expect(stderr).toMatch(/unparseable|parse/i);
  });

  it('well-formed verdict with an unknown disposition → exit 2 fail-closed', () => {
    writeStubCli({ verdict: { disposition: 'bogus', reason: 'x', provenance: {} }, exit: 0 });
    const { status, stderr } = runWrapper(DECLARED);
    expect(status).toBe(2);
    expect(stderr).toMatch(/unknown disposition/i);
  });

  // ─── FIX 3: valid JSON but non-object stdin → fail-soft ────────────────
  it('stdin is valid JSON but non-object (the bytes `null`) → exit 0 fail-soft (FIX 3)', () => {
    writeStubCli({ verdict: { disposition: 'deny' } });
    const wrapperPath = path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs');
    const res = spawnSync(process.execPath, [wrapperPath, '--event', 'freeze-check'], {
      cwd,
      input: 'null',
      encoding: 'utf-8',
      timeout: 30000,
    });
    expect(res.status).toBe(0);
  });
});

// ─── eject parity ──────────────────────────────────────────────────────
describe('eject removes the gate entry (parity with install)', () => {
  let cwd: string;
  let originalCwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(cwd);
    fs.mkdirSync(path.join(cwd, '.git', 'hooks'), { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it('scrubs the gate PreToolUse entry and the wrapper script on eject', async () => {
    installGates(cwd, ['freeze-check']);
    expect(gateEntryCount(cwd, 'freeze-check')).toBe(1);
    expect(fs.existsSync(path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs'))).toBe(true);

    await ejectCommand({ force: true });

    expect(fs.existsSync(path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs'))).toBe(false);
    // Settings file may be removed entirely (if it only held the gate entry)
    // or scrubbed of the gate entry — either way no gate entry survives.
    if (fs.existsSync(path.join(cwd, '.claude', 'settings.json'))) {
      expect(gateEntryCount(cwd, 'freeze-check')).toBe(0);
    }
  });

  it('preserves a user PreToolUse entry while scrubbing the gate entry', async () => {
    fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'mine' }] }] },
      }),
    );
    installGates(cwd, ['freeze-check']);

    await ejectCommand({ force: true });

    expect(fs.existsSync(path.join(cwd, '.claude', 'settings.json'))).toBe(true);
    const entries = preToolUseEntries(cwd);
    expect(entries.some((e) => e.matcher === 'Bash')).toBe(true);
    expect(gateEntryCount(cwd, 'freeze-check')).toBe(0);
  });
});

// ─── init --gates= routes through the SAME installer ───────────────────
describe('init --gates= routes through the shared installer', () => {
  let cwd: string;
  let originalCwd: string;

  beforeEach(() => {
    cwd = makeTmpDir();
    originalCwd = process.cwd();
    process.chdir(cwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(cwd, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it('init --gates=freeze-check installs the same entry installGates would', async () => {
    await initCommand({ bare: true, gates: 'freeze-check' });
    expect(gateEntryCount(cwd, 'freeze-check')).toBe(1);
    expect(fs.existsSync(path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs'))).toBe(true);
  });

  it('init --gates=all installs every known gate', async () => {
    await initCommand({ bare: true, gates: 'all' });
    for (const event of knownGateEvents()) {
      expect(gateEntryCount(cwd, event)).toBe(1);
    }
  });

  it('init --gates= with an unknown member fails loud', async () => {
    await expect(initCommand({ bare: true, gates: 'made-up-gate' })).rejects.toThrow(
      /unknown gate/i,
    );
  });

  // ─── FIX 4: empty --gates= selection fails loud, installs nothing ──────
  it('init --gates=, (empty after parse) throws GATE_INVALID and writes no gate wrapper/entry', async () => {
    const err = await initCommand({ bare: true, gates: ',' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TotemError);
    expect((err as TotemError).code).toBe('GATE_INVALID');
    // No orphan wrapper scaffolded, no PreToolUse gate entry merged.
    expect(fs.existsSync(path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs'))).toBe(false);
    if (fs.existsSync(path.join(cwd, '.claude', 'settings.json'))) {
      expect(gateEntryCount(cwd, 'freeze-check')).toBe(0);
    }
  });

  it('init --gates= (whitespace-only) throws GATE_INVALID and writes no gate wrapper/entry', async () => {
    const err = await initCommand({ bare: true, gates: '   ' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TotemError);
    expect((err as TotemError).code).toBe('GATE_INVALID');
    expect(fs.existsSync(path.join(cwd, '.claude', 'hooks', 'gate-wrapper.cjs'))).toBe(false);
  });
});
