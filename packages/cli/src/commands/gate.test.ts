import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { knownGateEvents, knownGates, TotemError } from '@mmnto/totem';

import { gateCheckCommand, resolveGates } from './gate.js';

/**
 * CLI-boundary tests for `totem gate check` and the `gate install` selection
 * resolver `resolveGates`.
 *
 * The engine itself (allow/deny/no-file/fail-closed/side-effect-free) is
 * covered by `@mmnto/totem`'s gate-engine.test.ts. This file covers the
 * command seam the engine tests can't reach:
 *   - `--payload` JSON parsing (a command-layer concern, before the engine runs)
 *   - the unknown-event throw propagating through the command (never silent-allow)
 *   - the LOCKED host-agnostic contract: the command emits a raw `GateVerdict`
 *     to stdout and does NOT map the disposition onto an exit code (a `deny`
 *     leaves `process.exitCode` untouched — the PreToolUse wrapper owns 0/2).
 *
 * The non-zero exit on a thrown error is delegated to the shared `handleError`
 * entrypoint in index.ts (exercised by every command); these tests assert the
 * command's own contract — throw on failure, never default-allow.
 */

function makeTmpDir(): string {
  // `.native` expands Windows 8.3 short names so process.cwd()/realpath agree.
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'totem-gate-cli-')));
}

const MINIMAL_CONFIG = [
  'targets:',
  '  - glob: "**/*.ts"',
  '    type: code',
  '    strategy: typescript-ast',
  '',
].join('\n');

const FROZEN = JSON.stringify({
  _note: 'test fixture',
  frozen: [
    { subsystem: 'rule-compilation', since: '2026-05-17', reason: 'paused', tracking: '#1' },
  ],
});

describe('gateCheckCommand', () => {
  let tmpDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    originalCwd = process.cwd();
    // The command resolves config + totemDir from process.cwd().
    fs.writeFileSync(path.join(tmpDir, 'totem.yaml'), MINIMAL_CONFIG);
    fs.mkdirSync(path.join(tmpDir, '.totem'), { recursive: true });
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    process.exitCode = undefined;
    // maxRetries/retryDelay rides out transient Windows ENOTEMPTY/EBUSY without
    // an empty catch swallowing real teardown failures (repo test-cleanup idiom).
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  it('throws GATE_INVALID on malformed --payload JSON — never silent-allow', async () => {
    // Payload parsing fails before the engine (or even config) runs.
    try {
      await gateCheckCommand({ event: 'freeze-check', payload: '{ not valid json' });
      expect.unreachable('expected gateCheckCommand to throw on malformed payload');
    } catch (err) {
      expect(err).toBeInstanceOf(TotemError);
      expect((err as TotemError).code).toBe('GATE_INVALID');
      expect((err as TotemError).message).toMatch(/invalid --payload json/i);
    }
  });

  it('throws on an unknown --event — never default-allow', async () => {
    await expect(gateCheckCommand({ event: 'made-up-gate', payload: '{}' })).rejects.toThrow(
      /unknown gate event/i,
    );
  });

  it('--payload - reads the JSON from stdin (the wrapper channel; no argv limit) and evaluates it', async () => {
    // The stdin reader is the injectable seam; the CLI default reads fd 0. A
    // 40,000-character command — past win32's 32,767-character argv cap — is the
    // shape the argv form could not carry (mmnto-ai/totem#2799, pass 3).
    const long = 'x'.repeat(40_000);
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    let reads = 0;
    const readStdin = (): string => {
      reads += 1;
      return JSON.stringify({ tool: 'Bash', command: long, platform: 'win32' });
    };

    await gateCheckCommand({ event: 'transport-shield', payload: '-' }, readStdin);

    expect(reads).toBe(1);
    expect(spy.mock.calls).toHaveLength(1);
    const verdict = JSON.parse(spy.mock.calls[0]![0] as string) as { disposition: string };
    expect(verdict.disposition).toBe('allow');
  });

  it('--payload - with malformed stdin JSON throws GATE_INVALID like the argv form, and the reader was consulted', async () => {
    // The reader count is what discriminates: on the pre-fold code `JSON.parse('-')`
    // throws the same GATE_INVALID without ever reading stdin (re-armed pass, P3b-F2).
    let reads = 0;
    await expect(
      gateCheckCommand({ event: 'freeze-check', payload: '-' }, () => {
        reads += 1;
        return '{ not valid json';
      }),
    ).rejects.toThrow(/invalid --payload json/i);
    expect(reads).toBe(1);
  });

  it('emits a raw GateVerdict to stdout and does NOT map disposition to an exit code', async () => {
    fs.writeFileSync(path.join(tmpDir, '.totem', 'freeze.json'), FROZEN);
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await gateCheckCommand({ event: 'freeze-check', payload: '{"subsystem":"rule-compilation"}' });

    // Exactly one JSON line written.
    expect(spy.mock.calls).toHaveLength(1);
    const output = spy.mock.calls[0]![0] as string;
    expect(output.endsWith('\n')).toBe(true);

    const verdict = JSON.parse(output);
    // Host-agnostic GateVerdict shape (the output-contract-stability invariant).
    expect(verdict.disposition).toBe('deny');
    expect(verdict).toHaveProperty('reason');
    expect(verdict.provenance.source).toBe('.totem/freeze.json');
    expect(verdict.provenance.matched).toBe('rule-compilation');
    expect(verdict.provenance.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // LOCKED: a `deny` is a successful evaluation — the command must not couple
    // itself to Claude's 0/2 contract. Exit-code mapping is the wrapper's job.
    expect(process.exitCode).toBeFalsy();
  });

  it('emits an allow verdict (exit code untouched) when nothing matches', async () => {
    fs.writeFileSync(path.join(tmpDir, '.totem', 'freeze.json'), FROZEN);
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    await gateCheckCommand({ event: 'freeze-check', payload: '{"subsystem":"something-else"}' });

    const output = spy.mock.calls[0]![0] as string;
    const verdict = JSON.parse(output);
    expect(verdict.disposition).toBe('allow');
    expect(verdict.provenance.matched).toBeNull();
    expect(process.exitCode).toBeFalsy();
  });

  // ─── --tier (mmnto-ai/totem#2800 R1) ──────────────────────────────────
  //
  // The verb carries the tier the wrapper was installed with to the engine,
  // which applies it to the evaluated gate's OWN unevaluable class. The
  // merge-ready evaluator is exercised in core; what these lock is the command
  // seam: the default, the validation, and that no tier softens freeze-check.

  it('rejects an unknown --tier rather than defaulting one silently', async () => {
    await expect(
      gateCheckCommand({
        event: 'freeze-check',
        payload: '{"subsystem":"x"}',
        tier: 'advisory',
      }),
    ).rejects.toThrow(/unknown --tier "advisory"/i);
  });

  it('accepts strict and pilot, and defaults to strict when omitted', async () => {
    fs.writeFileSync(path.join(tmpDir, '.totem', 'freeze.json'), FROZEN);
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    for (const tier of [undefined, 'strict', 'pilot']) {
      await gateCheckCommand({
        event: 'freeze-check',
        payload: '{"subsystem":"rule-compilation"}',
        ...(tier === undefined ? {} : { tier }),
      });
    }

    // freeze-check ignores the tier entirely: a frozen subsystem is a `deny` at
    // every tier — the ruling's "freeze-check keeps failing closed".
    expect(spy.mock.calls).toHaveLength(3);
    for (const call of spy.mock.calls) {
      expect(JSON.parse(call[0] as string).disposition).toBe('deny');
    }
  });

  it('merge-ready is dispatchable through the verb (payload validated at the boundary)', async () => {
    // No gh runs: the payload fails validation first, which is the arm that
    // must throw rather than emit a default allow.
    await expect(
      gateCheckCommand({ event: 'merge-ready', payload: '{"repo":"","pr":null}' }),
    ).rejects.toThrow(/merge-ready payload is invalid/i);
  });
});

/**
 * `resolveGates` (registry-driven selection, mmnto-ai/totem#2799).
 *
 * Successor to `resolveGateEvents`, which returned bare event strings; it now
 * returns `{event, matcher}` pairs read from `knownGates()` so `installGates`
 * never has to guess a matcher — and so `gate-install.ts` can stay free of any
 * `@mmnto/totem` import (ADR-072 §3). The fail-loud messages are unchanged.
 * (These four validation arms moved here from gate-install.test.ts, where they
 * sat beside the installer they no longer call directly.)
 */
describe('resolveGates (registry-driven validation)', () => {
  it('--all enumerates knownGates() — every gate, in registry order, with matchers', async () => {
    const resolved = await resolveGates({ all: true });
    expect(resolved).toEqual(knownGates());
    // Spelled out, so a registry edit that moved a gate to another matcher
    // fails here instead of being followed silently.
    expect(resolved).toEqual([
      { event: 'freeze-check', matcher: 'Write|Edit' },
      { event: 'transport-shield', matcher: 'Bash|PowerShell' },
      { event: 'merge-ready', matcher: 'Bash|PowerShell' },
    ]);
    // Order is the registry's, and it is what `--all` installs in.
    expect(resolved.map((g) => g.event)).toEqual(knownGateEvents());
  });

  it('a known --<name> resolves to its own pair (freeze-check → Write|Edit)', async () => {
    expect(await resolveGates({ name: 'freeze-check' })).toEqual([
      { event: 'freeze-check', matcher: 'Write|Edit' },
    ]);
  });

  it('transport-shield resolves to the Bash|PowerShell pair', async () => {
    expect(await resolveGates({ name: 'transport-shield' })).toEqual([
      { event: 'transport-shield', matcher: 'Bash|PowerShell' },
    ]);
  });

  it('merge-ready resolves to the Bash|PowerShell pair (mmnto-ai/totem#2800)', async () => {
    expect(await resolveGates({ name: 'merge-ready' })).toEqual([
      { event: 'merge-ready', matcher: 'Bash|PowerShell' },
    ]);
  });

  it('an unknown --<name> fails loud (never default-install)', async () => {
    await expect(resolveGates({ name: 'made-up-gate' })).rejects.toBeInstanceOf(TotemError);
    await expect(resolveGates({ name: 'made-up-gate' })).rejects.toThrow(/unknown gate/i);
    // The message still enumerates the known EVENT names, unchanged wording.
    await expect(resolveGates({ name: 'made-up-gate' })).rejects.toThrow(
      `Unknown gate "made-up-gate". Known gates: ${knownGateEvents().join(', ')}.`,
    );
  });

  it('no --all and no --<name> fails loud (no default-install)', async () => {
    await expect(resolveGates({})).rejects.toThrow(/no gate selected/i);
  });
});
