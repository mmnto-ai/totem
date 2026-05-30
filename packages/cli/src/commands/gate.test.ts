import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TotemError } from '@mmnto/totem';

import { gateCheckCommand } from './gate.js';

/**
 * CLI-boundary tests for `totem gate check`.
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
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup (Windows ENOTEMPTY tolerance) */
    }
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
});
