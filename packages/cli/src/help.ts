import { Command, Help } from 'commander';

/** Commands that require an LLM orchestrator (rendered with an [LLM] badge). */
export const LLM_COMMANDS = new Set([
  'review',
  'spec',
  'docs',
  'check',
  'wrap',
  'review-learn',
  'triage',
  'triage-pr',
]);

/**
 * The ONE declared consumer tier (mmnto-ai/totem#2336 D2, panel-ruled; ADR-094
 * "operator memory cliff"). Default `totem --help` renders EXACTLY these entries
 * plus a pointer to the full surface; every other command is the advanced tier,
 * enumerable via `totem help --all`. This single exported surface is the source
 * of truth — tiering must NEVER be scattered as per-command flags (a per-command
 * flag re-opens the drift this consolidates). Entries may be subcommand paths
 * ('lesson add'); the renderer resolves them against the LIVE command tree so
 * their descriptions never drift from the registration.
 *
 * `status` is a panel addition — the first-hour health check.
 *
 * Hiding is an information surface, never a gate (Tenet 12/13): every advanced
 * command stays 100% functional and is one `totem help --all` away.
 */
export const CONSUMER_TIER: readonly string[] = [
  'init',
  'lint',
  'lesson add',
  'lesson compile',
  'doctor',
  'search',
  'status',
];

/**
 * Render-time freeze badge (mmnto-ai/totem#2336 D2.4). Prefixes the frozen
 * command's help line. Derived from the freeze primitive by the caller
 * (see help-freeze.ts) and passed in as a boolean — NEVER hardcoded here
 * (Tenet 20): the freeze is a cohort fact, not a product fact, so a consumer
 * with no freeze.json/doctrine pin renders the plain line.
 */
const FROZEN_BADGE = '[frozen] ';

/** The command whose help line the rule-compilation freeze decorates. */
const FREEZE_BADGED_COMMAND = 'lesson compile';

const COLUMN_PADDING = 2;

export interface TotemHelpOptions {
  /** `totem help --all` — render the full command surface, tiered. */
  readonly all?: boolean;
  /** A rule-compilation freeze is visible → badge the `lesson compile` line. */
  readonly freezeActive?: boolean;
}

interface HelpEntry {
  readonly name: string;
  readonly description: string;
}

export class TotemHelp extends Help {
  constructor(private readonly totemOpts: TotemHelpOptions = {}) {
    super();
  }

  formatHelp(cmd: Command, helper: Help): string {
    // Only override ROOT help; subcommand help uses Commander's default.
    if (cmd.parent) {
      return super.formatHelp(cmd, helper);
    }

    const all = this.totemOpts.all === true;
    const freezeActive = this.totemOpts.freezeActive === true;
    const cliName = cmd.name();
    const cliDescription = cmd.description() || 'Totem';

    // Resolve a declared tier entry (possibly a subcommand path like
    // 'lesson add') to its live description. Unresolvable entries are skipped
    // so a partial program (e.g. a test harness) degrades gracefully.
    const resolve = (entryPath: string): HelpEntry | undefined => {
      const parts = entryPath.split(' ');
      let current: Command | undefined = cmd;
      for (const part of parts) {
        current = current?.commands.find((c) => c.name() === part);
        if (current === undefined) return undefined;
      }
      const base = current.description();
      const description =
        freezeActive && entryPath === FREEZE_BADGED_COMMAND ? FROZEN_BADGE + base : base;
      return { name: entryPath, description };
    };

    const consumerEntries = CONSUMER_TIER.map(resolve).filter(
      (e): e is HelpEntry => e !== undefined,
    );

    let output = `${cliDescription}\n\n`;
    output += `Usage: ${cliName} [command]\n\n`;

    if (!all) {
      output += this.renderSection('Commands:', consumerEntries);
      output += `Run '${cliName} help --all' for the full command surface.\n`;
      output += `Run '${cliName} <command> --help' for details on a specific command.\n`;
      output += `Version: ${cmd.version()}\n`;
      return output;
    }

    // --all: consumer tier + everything else (advanced), tiered. Advanced is
    // derived from the LIVE command tree (visibleCommands respects `hidden`),
    // so it can never drift from the registration. A top-level command whose
    // full name is itself a consumer entry (init/lint/doctor/search/status) is
    // omitted from advanced; a noun like `lesson` STAYS in advanced so its
    // other verbs remain discoverable even though `lesson add`/`lesson compile`
    // are promoted to the consumer tier.
    output += this.renderSection('Consumer commands:', consumerEntries);

    const consumerTopLevel = new Set(CONSUMER_TIER.filter((p) => !p.includes(' ')));
    const advancedEntries: HelpEntry[] = helper
      .visibleCommands(cmd)
      .filter((c) => c.name() !== 'help' && !consumerTopLevel.has(c.name()))
      .map((c) => ({
        name: LLM_COMMANDS.has(c.name()) ? `${c.name()} [LLM]` : c.name(),
        description: c.description(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    output += this.renderSection('Advanced commands:', advancedEntries);
    output += `Run '${cliName} <command> --help' for details on a specific command.\n`;
    output += `Version: ${cmd.version()}\n`;
    return output;
  }

  private renderSection(title: string, entries: readonly HelpEntry[]): string {
    if (entries.length === 0) return '';
    const pad = Math.max(...entries.map((e) => e.name.length)) + COLUMN_PADDING;
    let s = `${title}\n`;
    for (const e of entries) {
      s += `  ${e.name.padEnd(pad)}${e.description}\n`;
    }
    return s + '\n';
  }
}
