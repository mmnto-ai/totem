/**
 * Command-surface (Commander parser) tests for the `totem spec` wiring
 * (mmnto-ai/totem#2700 B2).
 *
 * `index.ts` builds its `program` at module scope and auto-runs `parseAsync` on
 * import, so it cannot be imported without executing the CLI against the test
 * runner's argv. This therefore tests a hand-maintained MIRROR of the
 * registration (`buildSpecProgram` below), the same structural limit
 * `seat-cli-wiring.test.ts` and `mail-cli-wiring.test.ts` document.
 *
 * What it locks is the B2 regression: `spec <inputs...>` — a REQUIRED variadic —
 * made `--from <record>` unreachable, because commander refused the invocation
 * before `specCommand` could ever bind a record. The mirror proves the parser
 * accepts the flag with no positionals; the source-text check below proves both
 * real registrations (full CLI and lite binary) still spell the optional form,
 * which the mirror by construction cannot see.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';

interface SpecAction {
  (inputs: string[], opts: Record<string, unknown>): void;
}

/** Mirror of the `spec` registration in index.ts (the option set as registered). */
function buildSpecProgram(action: SpecAction): Command {
  const program = new Command();
  program.exitOverride(); // throw on parse error instead of process.exit
  program
    .command('spec [inputs...]')
    .description(
      'Generate a pre-work spec briefing for GitHub issue(s), topic(s), or a design record',
    )
    .option('--raw', 'Output retrieved context without LLM synthesis')
    .option(
      '--from <record>',
      'Ground the run on a hand-authored design record (the record is the anchor; it is never written)',
    )
    .option('--out <path>', 'Write output to a specific file')
    .option('--stdout', 'Print to stdout')
    .option('--model <name>', 'Override the default model for the orchestrator')
    .option('--fresh', 'Bypass cache and force a fresh LLM call')
    .action((inputs: string[], opts: Record<string, unknown>) => {
      action(inputs, opts);
    });
  return program;
}

const CLI_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readCliSource(file: string): string {
  return fs.readFileSync(path.join(CLI_SRC, file), 'utf-8');
}

describe('totem spec command surface (mmnto-ai/totem#2700)', () => {
  it('`totem spec --from x` reaches the action with NO positionals — the B2 regression', () => {
    const action = vi.fn();
    buildSpecProgram(action).parse(['node', 'totem', 'spec', '--from', 'x']);

    expect(action).toHaveBeenCalledTimes(1);
    const [inputs, opts] = action.mock.calls[0] as [string[], Record<string, unknown>];
    expect(inputs).toEqual([]);
    expect(opts['from']).toBe('x');
  });

  it('`totem spec 2700 extra` still reaches the action with both positionals', () => {
    const action = vi.fn();
    buildSpecProgram(action).parse(['node', 'totem', 'spec', '2700', 'extra']);

    expect(action).toHaveBeenCalledTimes(1);
    const [inputs, opts] = action.mock.calls[0] as [string[], Record<string, unknown>];
    expect(inputs).toEqual(['2700', 'extra']);
    expect(opts['from']).toBeUndefined();
  });

  it('bare `totem spec` parses too — "no inputs and no --from" is the command`s own error, not commander`s', () => {
    const action = vi.fn();
    buildSpecProgram(action).parse(['node', 'totem', 'spec']);

    expect(action).toHaveBeenCalledTimes(1);
    const [inputs] = action.mock.calls[0] as [string[], Record<string, unknown>];
    expect(inputs).toEqual([]);
  });

  // The mirror above cannot see index.ts. This does: a REQUIRED variadic in
  // either real registration is the exact shape that made --from unreachable,
  // and the lite binary's excluded-command stub must not re-introduce it.
  it('both real registrations (index.ts and index-lite.ts) spell the OPTIONAL variadic', () => {
    for (const file of ['index.ts', 'index-lite.ts']) {
      const source = readCliSource(file);
      expect(source).toContain('spec [inputs...]');
      expect(source).not.toContain('spec <inputs...>');
    }
  });
});
