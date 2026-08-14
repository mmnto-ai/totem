/**
 * Command-surface (Commander parser) tests for the `totem mail` wiring —
 * the poll flags on the parent command (mmnto-ai/totem#2204) and the
 * `mail reply`/`mail mark` subcommands (mmnto-ai/totem#2396, CR outside-diff
 * on index.ts 881-931).
 *
 * `index.ts` builds its `program` at module scope and auto-runs `parseAsync`
 * on import, so it cannot be imported without executing the CLI against the
 * test runner's argv. This reconstructs the EXACT wiring — the parent poll
 * action's `as → asSeat` destructure rename (#2204), the `--no-mark`
 * boolean-negation translation (`const { mark, ...rest } = opts;
 * noMark: mark === false`), and the `mail mark <source>` positional dispatch —
 * with the command-module functions stubbed, verifying the Commander parser
 * produces the options the lib is invoked with. Kept intentionally light
 * (parser-level, no real fs/network).
 */

import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';

interface WiringHandlers {
  mailCommand: (opts: Record<string, unknown>) => void;
  mailReply: (source: string, opts: Record<string, unknown>) => void;
  markSource: (source: string, opts: Record<string, unknown>) => void;
}

/** Mirror of the `mail` poll + `mail reply` / `mail mark` registration in index.ts. */
function buildMailProgram(handlers: WiringHandlers): Command {
  const program = new Command();
  program.exitOverride(); // throw on parse error instead of process.exit
  const mailCmd = program
    .command('mail')
    .option('--json', 'Emit JSON to stdout')
    .option('--recursive', 'Walk the workspace recursively')
    .option('--workspace <path>', 'Workspace dir to scan')
    .option('--as <seat>', "Serve exactly this seat's mail")
    .option('--all-seats', 'Serve the full multi-seat union')
    .action(
      (opts: {
        json?: boolean;
        recursive?: boolean;
        workspace?: string;
        as?: string;
        allSeats?: boolean;
      }) => {
        // EXACT translation from index.ts (#2204): Commander stores `--as` under
        // `as`; the lib option is `asSeat` — the rename is the drift hazard this
        // mirror exists to sense.
        const { json, recursive, workspace, as: asSeat, allSeats } = opts;
        handlers.mailCommand({ json, recursive, workspace, asSeat, allSeats });
      },
    );

  mailCmd
    .command('reply <source>')
    .option('--from <agent>', 'Sender agent-id')
    .option('--to <agent>', 'Override the inferred recipient')
    .option('--subject <text>', 'Override the inferred subject')
    .option('--no-mark', 'Do NOT mark the source dispatch processed')
    .action((source: string, opts: { mark?: boolean } & Record<string, unknown>) => {
      // EXACT translation from index.ts: strip the CLI-only negation flag and
      // map it into the lib's opt-out.
      const { mark, ...rest } = opts;
      handlers.mailReply(source, { ...rest, noMark: mark === false });
    });

  mailCmd
    .command('mark <source>')
    .option('--agent-id <id>', 'Seat whose processed/ cursor to mark into')
    .action((source: string, opts: { agentId?: string }) => {
      handlers.markSource(source, opts);
    });

  return program;
}

function handlers() {
  return { mailCommand: vi.fn(), mailReply: vi.fn(), markSource: vi.fn() };
}

describe('mail CLI command-surface (Commander wiring, mmnto-ai/totem#2396 + #2204)', () => {
  it('bare `mail` dispatches the poll with no seat selector', () => {
    const h = handlers();
    buildMailProgram(h).parse(['node', 'totem', 'mail']);
    expect(h.mailCommand).toHaveBeenCalledTimes(1);
    const opts = h.mailCommand.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts['asSeat']).toBeUndefined();
    expect(opts['allSeats']).toBeUndefined();
  });

  it('`mail --as <seat>` lands on the lib as asSeat (the rename drift hazard, #2204)', () => {
    const h = handlers();
    buildMailProgram(h).parse(['node', 'totem', 'mail', '--as', 'totem-gemini']);
    const opts = h.mailCommand.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts['asSeat']).toBe('totem-gemini');
    expect('as' in opts).toBe(false); // the Commander-side key never leaks into the lib
  });

  it('`mail --all-seats` lands on the lib as allSeats: true', () => {
    const h = handlers();
    buildMailProgram(h).parse(['node', 'totem', 'mail', '--all-seats']);
    const opts = h.mailCommand.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts['allSeats']).toBe(true);
  });

  it('reply WITHOUT --no-mark → noMark: false (marking on by default)', () => {
    const h = handlers();
    buildMailProgram(h).parse(['node', 'totem', 'mail', 'reply', 'SRC.md']);
    expect(h.mailReply).toHaveBeenCalledTimes(1);
    expect(h.mailReply.mock.calls[0]![0]).toBe('SRC.md');
    expect((h.mailReply.mock.calls[0]![1] as { noMark: boolean }).noMark).toBe(false);
    expect(h.markSource).not.toHaveBeenCalled();
    expect(h.mailCommand).not.toHaveBeenCalled(); // subcommand does not fire the poll
  });

  it('reply --no-mark → noMark: true (Commander boolean-negation)', () => {
    const h = handlers();
    buildMailProgram(h).parse(['node', 'totem', 'mail', 'reply', 'SRC.md', '--no-mark']);
    expect((h.mailReply.mock.calls[0]![1] as { noMark: boolean }).noMark).toBe(true);
  });

  it('reply strips the CLI-only `mark` flag out of the lib options (GCA @1392)', () => {
    const h = handlers();
    buildMailProgram(h).parse([
      'node',
      'totem',
      'mail',
      'reply',
      'SRC.md',
      '--from',
      'totem-claude',
    ]);
    const opts = h.mailReply.mock.calls[0]![1] as Record<string, unknown>;
    expect('mark' in opts).toBe(false); // never leaks into the core actuator
    expect(opts['from']).toBe('totem-claude');
    expect(opts['noMark']).toBe(false);
  });

  it('mark <source> is registered and dispatches to markSource with --agent-id', () => {
    const h = handlers();
    buildMailProgram(h).parse([
      'node',
      'totem',
      'mail',
      'mark',
      'SRC.md',
      '--agent-id',
      'totem-claude',
    ]);
    expect(h.markSource).toHaveBeenCalledTimes(1);
    expect(h.markSource.mock.calls[0]![0]).toBe('SRC.md');
    expect((h.markSource.mock.calls[0]![1] as { agentId?: string }).agentId).toBe('totem-claude');
    expect(h.mailReply).not.toHaveBeenCalled();
  });

  it('mark <source> without --agent-id dispatches with agentId undefined (self-resolve)', () => {
    const h = handlers();
    buildMailProgram(h).parse(['node', 'totem', 'mail', 'mark', 'SRC.md']);
    expect(h.markSource).toHaveBeenCalledTimes(1);
    expect((h.markSource.mock.calls[0]![1] as { agentId?: string }).agentId).toBeUndefined();
  });

  it('a poll flag after a subcommand never leaks into the subcommand actuator', () => {
    // Commander tolerates the parent-scoped `--as` here rather than erroring;
    // the invariant that matters is containment: the reply actuator's options
    // must not carry it, and the poll must not fire.
    const h = handlers();
    buildMailProgram(h).parse(['node', 'totem', 'mail', 'reply', 'SRC.md', '--as', 'x']);
    expect(h.mailReply).toHaveBeenCalledTimes(1);
    const opts = h.mailReply.mock.calls[0]![1] as Record<string, unknown>;
    expect('as' in opts).toBe(false);
    expect('asSeat' in opts).toBe(false);
    expect(h.mailCommand).not.toHaveBeenCalled();
  });
});
