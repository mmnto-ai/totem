/**
 * Command-surface (Commander parser) tests for the `totem mail reply`/`mail
 * mark` wiring (mmnto-ai/totem#2396, CR outside-diff on index.ts 881-931).
 *
 * `index.ts` builds its `program` at module scope and auto-runs `parseAsync`
 * on import, so it cannot be imported without executing the CLI against the
 * test runner's argv. This reconstructs the EXACT subcommand wiring — the
 * `--no-mark` boolean-negation translation (`const { mark, ...rest } = opts;
 * noMark: mark === false`) and the `mail mark <source>` positional dispatch —
 * with the command-module functions stubbed, verifying the Commander parser
 * produces the options the lib is invoked with. Kept intentionally light
 * (parser-level, no real fs/network).
 */

import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';

interface WiringHandlers {
  mailReply: (source: string, opts: Record<string, unknown>) => void;
  markSource: (source: string, opts: Record<string, unknown>) => void;
}

/** Mirror of the `mail reply` / `mail mark` registration in index.ts. */
function buildMailProgram(handlers: WiringHandlers): Command {
  const program = new Command();
  program.exitOverride(); // throw on parse error instead of process.exit
  const mailCmd = program.command('mail');

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

describe('mail CLI command-surface (Commander wiring, mmnto-ai/totem#2396)', () => {
  it('reply WITHOUT --no-mark → noMark: false (marking on by default)', () => {
    const mailReply = vi.fn();
    const markSource = vi.fn();
    buildMailProgram({ mailReply, markSource }).parse(['node', 'totem', 'mail', 'reply', 'SRC.md']);
    expect(mailReply).toHaveBeenCalledTimes(1);
    expect(mailReply.mock.calls[0]![0]).toBe('SRC.md');
    expect((mailReply.mock.calls[0]![1] as { noMark: boolean }).noMark).toBe(false);
    expect(markSource).not.toHaveBeenCalled();
  });

  it('reply --no-mark → noMark: true (Commander boolean-negation)', () => {
    const mailReply = vi.fn();
    const markSource = vi.fn();
    buildMailProgram({ mailReply, markSource }).parse([
      'node',
      'totem',
      'mail',
      'reply',
      'SRC.md',
      '--no-mark',
    ]);
    expect((mailReply.mock.calls[0]![1] as { noMark: boolean }).noMark).toBe(true);
  });

  it('reply strips the CLI-only `mark` flag out of the lib options (GCA @1392)', () => {
    const mailReply = vi.fn();
    const markSource = vi.fn();
    buildMailProgram({ mailReply, markSource }).parse([
      'node',
      'totem',
      'mail',
      'reply',
      'SRC.md',
      '--from',
      'totem-claude',
    ]);
    const opts = mailReply.mock.calls[0]![1] as Record<string, unknown>;
    expect('mark' in opts).toBe(false); // never leaks into the core actuator
    expect(opts['from']).toBe('totem-claude');
    expect(opts['noMark']).toBe(false);
  });

  it('mark <source> is registered and dispatches to markSource with --agent-id', () => {
    const mailReply = vi.fn();
    const markSource = vi.fn();
    buildMailProgram({ mailReply, markSource }).parse([
      'node',
      'totem',
      'mail',
      'mark',
      'SRC.md',
      '--agent-id',
      'totem-claude',
    ]);
    expect(markSource).toHaveBeenCalledTimes(1);
    expect(markSource.mock.calls[0]![0]).toBe('SRC.md');
    expect((markSource.mock.calls[0]![1] as { agentId?: string }).agentId).toBe('totem-claude');
    expect(mailReply).not.toHaveBeenCalled();
  });

  it('mark <source> without --agent-id dispatches with agentId undefined (self-resolve)', () => {
    const mailReply = vi.fn();
    const markSource = vi.fn();
    buildMailProgram({ mailReply, markSource }).parse(['node', 'totem', 'mail', 'mark', 'SRC.md']);
    expect(markSource).toHaveBeenCalledTimes(1);
    expect((markSource.mock.calls[0]![1] as { agentId?: string }).agentId).toBeUndefined();
  });
});
