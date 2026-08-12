/**
 * Command-surface (Commander parser) tests for the `totem seat` wiring
 * (mmnto-ai/totem#2511 slice 2).
 *
 * `index.ts` builds its `program` at module scope and auto-runs `parseAsync` on
 * import, so it cannot be imported without executing the CLI against the test
 * runner's argv. This therefore tests a hand-maintained MIRROR of the
 * registration (`buildSeatProgram` below), not `index.ts` itself — the same
 * structural limit `mail-cli-wiring.test.ts` documents. What it verifies is
 * Commander's parsing of the mirrored shape: group-only `seat` with four
 * subcommands, the `--reactivate` / `--reason` flags, and the
 * `optsWithGlobals()` read that keeps `totem seat list --json` and
 * `totem --json seat list` in agreement (the mmnto-ai/totem#2097 parent/child
 * option collision). A drift between index.ts and this mirror is NOT caught
 * here; the verb→poll behavior is covered in-repo by `seat.test.ts` +
 * `seat-poll-chain.test.ts`, and built-binary runs accompany the change's
 * review round. Parser-level only: no real fs, no core import.
 */

import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';

interface WiringHandlers {
  seatAdd: (seatId: string, opts: Record<string, unknown>) => void;
  seatSuspend: (seatId: string, opts: Record<string, unknown>) => void;
  seatRemove: (seatId: string, opts: Record<string, unknown>) => void;
  seatList: (opts: Record<string, unknown>) => void;
}

/** Mirror of the `seat` group registration in index.ts. */
function buildSeatProgram(handlers: WiringHandlers): Command {
  const program = new Command();
  program.exitOverride(); // throw on parse error instead of process.exit
  // The program-level `--json` is what makes the collision reachable.
  program.option('--json', 'Output structured JSON to stdout');
  const seatCmd = program.command('seat');

  seatCmd
    .command('add <seat-id>')
    .option('--reactivate', 'Transition an existing SUSPENDED seat back to active')
    .action((seatId: string, opts: { reactivate?: boolean }) => {
      handlers.seatAdd(seatId, opts);
    });

  seatCmd
    .command('suspend <seat-id>')
    .option('--reason <text>', 'Recorded ruling for the suspension')
    .action((seatId: string, opts: { reason?: string }) => {
      handlers.seatSuspend(seatId, opts);
    });

  seatCmd
    .command('remove <seat-id>')
    .option('--reason <text>', 'Recorded ruling for the retirement')
    .action((seatId: string, opts: { reason?: string }) => {
      handlers.seatRemove(seatId, opts);
    });

  seatCmd
    .command('list')
    .option('--json', 'Emit the full seat-status array as JSON on stdout')
    .action((_opts: { json?: boolean }, cmd: Command) => {
      // EXACT read from index.ts: optsWithGlobals merges the parent scope so a
      // post-subcommand `--json` (which lands on program.opts()) still arrives.
      const { json } = cmd.optsWithGlobals<{ json?: boolean }>();
      handlers.seatList({ json });
    });

  return program;
}

function handlers(): WiringHandlers & { calls: Record<string, ReturnType<typeof vi.fn>> } {
  const seatAdd = vi.fn();
  const seatSuspend = vi.fn();
  const seatRemove = vi.fn();
  const seatList = vi.fn();
  return {
    seatAdd,
    seatSuspend,
    seatRemove,
    seatList,
    calls: { seatAdd, seatSuspend, seatRemove, seatList },
  };
}

describe('seat CLI command-surface (Commander wiring, mmnto-ai/totem#2511)', () => {
  it('add <seat-id> dispatches the positional with no --reactivate by default', () => {
    const h = handlers();
    buildSeatProgram(h).parse(['node', 'totem', 'seat', 'add', 'totem-kimi']);
    expect(h.calls['seatAdd']).toHaveBeenCalledTimes(1);
    expect(h.calls['seatAdd']!.mock.calls[0]![0]).toBe('totem-kimi');
    expect((h.calls['seatAdd']!.mock.calls[0]![1] as { reactivate?: boolean }).reactivate).toBe(
      undefined,
    );
    expect(h.calls['seatSuspend']).not.toHaveBeenCalled();
  });

  it('add --reactivate parses to reactivate: true', () => {
    const h = handlers();
    buildSeatProgram(h).parse(['node', 'totem', 'seat', 'add', 'totem-kimi', '--reactivate']);
    expect((h.calls['seatAdd']!.mock.calls[0]![1] as { reactivate?: boolean }).reactivate).toBe(
      true,
    );
  });

  it('suspend <seat-id> --reason carries the text through verbatim', () => {
    const h = handlers();
    buildSeatProgram(h).parse([
      'node',
      'totem',
      'seat',
      'suspend',
      'totem-kimi',
      '--reason',
      'operator ruling 2026-08-11',
    ]);
    expect(h.calls['seatSuspend']!.mock.calls[0]![0]).toBe('totem-kimi');
    expect((h.calls['seatSuspend']!.mock.calls[0]![1] as { reason?: string }).reason).toBe(
      'operator ruling 2026-08-11',
    );
  });

  it('suspend without --reason leaves reason undefined (the encouragement path)', () => {
    const h = handlers();
    buildSeatProgram(h).parse(['node', 'totem', 'seat', 'suspend', 'totem-kimi']);
    expect((h.calls['seatSuspend']!.mock.calls[0]![1] as { reason?: string }).reason).toBe(
      undefined,
    );
  });

  it('remove <seat-id> --reason dispatches to the retirement verb, not suspend', () => {
    const h = handlers();
    buildSeatProgram(h).parse([
      'node',
      'totem',
      'seat',
      'remove',
      'totem-kimi',
      '--reason',
      'stream closed',
    ]);
    expect(h.calls['seatRemove']!.mock.calls[0]![0]).toBe('totem-kimi');
    expect((h.calls['seatRemove']!.mock.calls[0]![1] as { reason?: string }).reason).toBe(
      'stream closed',
    );
    expect(h.calls['seatSuspend']).not.toHaveBeenCalled();
  });

  it('list --json (flag AFTER the subcommand) arrives via optsWithGlobals', () => {
    const h = handlers();
    buildSeatProgram(h).parse(['node', 'totem', 'seat', 'list', '--json']);
    expect((h.calls['seatList']!.mock.calls[0]![0] as { json?: boolean }).json).toBe(true);
  });

  it('totem --json seat list (flag BEFORE the subcommand) agrees — the #2097 collision', () => {
    const h = handlers();
    buildSeatProgram(h).parse(['node', 'totem', '--json', 'seat', 'list']);
    expect((h.calls['seatList']!.mock.calls[0]![0] as { json?: boolean }).json).toBe(true);
  });

  it('list without --json leaves json undefined (human table path)', () => {
    const h = handlers();
    buildSeatProgram(h).parse(['node', 'totem', 'seat', 'list']);
    expect((h.calls['seatList']!.mock.calls[0]![0] as { json?: boolean }).json).toBe(undefined);
  });

  it('group-only registration rejects an unknown seat verb instead of silently no-op-ing', () => {
    const h = handlers();
    const program = buildSeatProgram(h);
    expect(() => program.parse(['node', 'totem', 'seat', 'frobnicate'])).toThrow();
    expect(h.calls['seatAdd']).not.toHaveBeenCalled();
    expect(h.calls['seatList']).not.toHaveBeenCalled();
  });

  it('add requires the seat-id positional', () => {
    const h = handlers();
    const program = buildSeatProgram(h);
    expect(() => program.parse(['node', 'totem', 'seat', 'add'])).toThrow();
    expect(h.calls['seatAdd']).not.toHaveBeenCalled();
  });
});
