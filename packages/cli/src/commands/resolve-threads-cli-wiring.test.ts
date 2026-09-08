/**
 * Command-surface (Commander parser) tests for the `totem resolve-threads`
 * wiring (mmnto-ai/totem#2841).
 *
 * `index.ts` builds its `program` at module scope and auto-runs `parseAsync` on
 * import, so it cannot be imported without executing the CLI against the test
 * runner's argv. This therefore tests a hand-maintained MIRROR of the
 * registration (`buildProgram` below), not `index.ts` itself — the same
 * structural limit `mail-cli-wiring.test.ts` and `seat-cli-wiring.test.ts`
 * document.
 *
 * The lock that earns this file: the program-level `--json` SWALLOWS a
 * post-subcommand `--json` (the mmnto-ai/totem#2097 parent/child option
 * collision). A built-binary run of `totem resolve-threads 2839 --json` printed
 * the human rows and no JSON before the action was switched to
 * `optsWithGlobals()`. Parser-level only: no gh, no network, no core import.
 */

import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';

interface ParsedOptions {
  apply: boolean;
  ids?: string;
  json: boolean;
}

/** Mirror of the `resolve-threads` registration in index.ts. */
function buildProgram(handler: (pr: string, opts: ParsedOptions) => void): Command {
  const program = new Command();
  program.exitOverride(); // throw on parse error instead of process.exit
  // The program-level `--json` is what makes the collision reachable.
  program.option('--json', 'Output structured JSON to stdout');

  program
    .command('resolve-threads <pr-number>')
    .option('--apply', 'Run the resolveReviewThread mutation (default: print the plan only)')
    .option('--ids <ids>', 'Comma-separated REST root comment ids to narrow the batch')
    .option('--json', 'Emit the plan rows as one JSON document')
    .action((prNumber: string, _opts: unknown, cmd: Command) => {
      // EXACT read from index.ts.
      const { apply, ids, json } = cmd.optsWithGlobals<{
        apply?: boolean;
        ids?: string;
        json?: boolean;
      }>();
      handler(prNumber, {
        apply: apply === true,
        ...(ids === undefined ? {} : { ids }),
        json: json === true,
      });
    });

  return program;
}

describe('resolve-threads CLI command-surface (Commander wiring, mmnto-ai/totem#2841)', () => {
  it('defaults to dry-run: no --apply, no --ids, no --json', () => {
    const handler = vi.fn();
    buildProgram(handler).parse(['node', 'totem', 'resolve-threads', '2839']);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0]).toBe('2839');
    expect(handler.mock.calls[0]![1]).toEqual({ apply: false, json: false });
  });

  it('--apply parses to apply: true', () => {
    const handler = vi.fn();
    buildProgram(handler).parse(['node', 'totem', 'resolve-threads', '2839', '--apply']);
    expect((handler.mock.calls[0]![1] as ParsedOptions).apply).toBe(true);
  });

  it('--ids carries the comma list through verbatim', () => {
    const handler = vi.fn();
    buildProgram(handler).parse([
      'node',
      'totem',
      'resolve-threads',
      '2839',
      '--ids',
      '3954062164,3954067481',
    ]);
    expect((handler.mock.calls[0]![1] as ParsedOptions).ids).toBe('3954062164,3954067481');
  });

  it('--json AFTER the subcommand still arrives (the #2097 collision)', () => {
    const handler = vi.fn();
    buildProgram(handler).parse(['node', 'totem', 'resolve-threads', '2839', '--json']);
    expect((handler.mock.calls[0]![1] as ParsedOptions).json).toBe(true);
  });

  it('--json BEFORE the subcommand arrives too, so both spellings agree', () => {
    const handler = vi.fn();
    buildProgram(handler).parse(['node', 'totem', '--json', 'resolve-threads', '2839']);
    expect((handler.mock.calls[0]![1] as ParsedOptions).json).toBe(true);
  });

  it('requires the PR positional', () => {
    const handler = vi.fn();
    expect(() => buildProgram(handler).parse(['node', 'totem', 'resolve-threads'])).toThrow();
    expect(handler).not.toHaveBeenCalled();
  });
});
