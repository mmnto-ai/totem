import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { COMMAND_GROUPS, LLM_COMMANDS, TotemHelp } from './help.js';

describe('TotemHelp', () => {
  function createMockProgram(): Command {
    const program = new Command('totem');
    program.version('1.0.0');
    program.configureHelp(new TotemHelp());
    program.command('lint').description('Run compiled rules');
    program.command('review').description('AI-powered code review');
    program.command('rule').description('Manage compiled rules');
    program.command('init').description('Initialize Totem');
    program.command('unknown-cmd').description('Some new command');
    return program;
  }

  it('groups commands under defined categories', () => {
    const program = createMockProgram();
    const help = new TotemHelp();
    const output = help.formatHelp(program, help);
    expect(output).toContain('Core:');
    expect(output).toContain('Entities:');
    expect(output).toContain('Setup:');
  });

  it('adds [LLM] badge to LLM-dependent commands', () => {
    const program = createMockProgram();
    const help = new TotemHelp();
    const output = help.formatHelp(program, help);
    expect(output).toContain('review [LLM]');
    expect(output).not.toContain('lint [LLM]');
  });

  it('puts uncategorized commands in Other group', () => {
    const program = createMockProgram();
    const help = new TotemHelp();
    const output = help.formatHelp(program, help);
    expect(output).toContain('Other:');
    expect(output).toContain('unknown-cmd');
  });

  it('uses default help for subcommands', () => {
    const program = createMockProgram();
    const rule = program.commands.find((c) => c.name() === 'rule')!;
    rule.command('list').description('List all rules');
    const help = new TotemHelp();
    const output = help.formatHelp(rule, help);
    // Subcommand help should use Commander default — contains 'list'
    expect(output).toContain('list');
    // Should NOT contain our custom group headers
    expect(output).not.toContain('Core:');
  });

  it('does not show help command in Other group', () => {
    const program = createMockProgram();
    const help = new TotemHelp();
    const output = help.formatHelp(program, help);
    // 'help' is a built-in Commander command — should be excluded from Other
    // Extract the Other section lines (between "Other:" and the next blank line)
    const otherMatch = output.match(/Other:\n([\s\S]*?)\n\n/);
    if (otherMatch) {
      expect(otherMatch[1]).not.toMatch(/^\s+help\b/m);
    }
  });

  it('skips empty groups', () => {
    const program = new Command('totem');
    program.version('1.0.0');
    program.configureHelp(new TotemHelp());
    program.command('lint').description('Run compiled rules');
    // Only lint exists — Workflow group should not appear
    const help = new TotemHelp();
    const output = help.formatHelp(program, help);
    expect(output).toContain('Core:');
    expect(output).not.toContain('Workflow:');
  });

  it('includes version in output', () => {
    const program = createMockProgram();
    const help = new TotemHelp();
    const output = help.formatHelp(program, help);
    expect(output).toContain('Version: 1.0.0');
  });

  it('does not show hidden commands', () => {
    const program = createMockProgram();
    program.command('secret-cmd', { hidden: true }).description('Should not appear');
    const help = new TotemHelp();
    const output = help.formatHelp(program, help);
    expect(output).not.toContain('secret-cmd');
  });

  it('COMMAND_GROUPS covers expected categories', () => {
    const groupNames = COMMAND_GROUPS.map((g) => g.name);
    expect(groupNames).toEqual(['Core', 'Entities', 'Workflow', 'Setup']);
  });

  it('LLM_COMMANDS contains expected entries', () => {
    expect(LLM_COMMANDS.has('review')).toBe(true);
    expect(LLM_COMMANDS.has('lint')).toBe(false);
    expect(LLM_COMMANDS.has('spec')).toBe(true);
    expect(LLM_COMMANDS.has('wrap')).toBe(true);
  });
});
