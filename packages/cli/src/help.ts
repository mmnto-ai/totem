import { Command, Help } from 'commander';

export interface CommandGroup {
  name: string;
  commands: string[];
}

/** Commands that require an LLM orchestrator */
export const LLM_COMMANDS = new Set([
  'review',
  'spec',
  'handoff',
  'docs',
  'check',
  'wrap',
  'review-learn',
  'triage',
  'triage-pr',
]);

/** Command grouping for root help */
export const COMMAND_GROUPS: CommandGroup[] = [
  {
    name: 'Core',
    commands: ['lint', 'review', 'check', 'spec'],
  },
  {
    name: 'Entities',
    commands: ['rule', 'lesson', 'exemption', 'config'],
  },
  {
    name: 'Workflow',
    commands: ['wrap', 'triage', 'triage-pr', 'review-learn'],
  },
  {
    name: 'Setup',
    commands: ['init', 'sync', 'hooks', 'doctor', 'status', 'eject'],
  },
];

export class TotemHelp extends Help {
  formatHelp(cmd: Command, helper: Help): string {
    // Only override root command help
    if (cmd.parent) {
      return super.formatHelp(cmd, helper);
    }

    const visible = helper
      .visibleCommands(cmd)
      .filter((c) => c.name() !== 'help')
      .map((c) => ({
        name: c.name(),
        description: helper.subcommandDescription(c),
      }));

    const visibleNames = new Set(visible.map((c) => c.name));
    const usedNames = new Set<string>();

    let output = `Totem — governance engine for AI-assisted codebases\n\n`;
    output += `Usage: totem [command]\n\n`;

    const COLUMN_PADDING = 2;

    // Render each group
    for (const group of COMMAND_GROUPS) {
      const groupCmds = group.commands
        .filter((name) => visibleNames.has(name))
        .map((name) => {
          usedNames.add(name);
          const entry = visible.find((c) => c.name === name)!;
          const badge = LLM_COMMANDS.has(name) ? ' [LLM]' : '';
          return { displayName: name + badge, description: entry.description };
        });

      if (groupCmds.length === 0) continue;

      output += `${group.name}:\n`;
      const pad = Math.max(...groupCmds.map((c) => c.displayName.length)) + COLUMN_PADDING;
      for (const c of groupCmds) {
        output += `  ${c.displayName.padEnd(pad)}${c.description}\n`;
      }
      output += '\n';
    }

    // Fallback: any commands not in a group
    const ungrouped = visible.filter((c) => !usedNames.has(c.name));
    if (ungrouped.length > 0) {
      output += `Other:\n`;
      const allNames = ungrouped.map((c) => {
        const badge = LLM_COMMANDS.has(c.name) ? ' [LLM]' : '';
        return c.name + badge;
      });
      const pad = Math.max(...allNames.map((n) => n.length)) + COLUMN_PADDING;
      for (let i = 0; i < ungrouped.length; i++) {
        const c = ungrouped[i]!;
        const displayName = allNames[i]!;
        output += `  ${displayName.padEnd(pad)}${c.description}\n`;
      }
      output += '\n';
    }

    output += `Run 'totem <command> --help' for details on a specific command.\n`;
    output += `Version: ${cmd.version()}\n`;

    return output;
  }
}
