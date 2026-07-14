import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { CONSUMER_TIER, LLM_COMMANDS, TotemHelp } from './help.js';

describe('TotemHelp (tiered — mmnto-ai/totem#2336 D2)', () => {
  function createMockProgram(): Command {
    const program = new Command('totem');
    program.version('1.0.0');
    program.description('Totem — test description');
    // Consumer tier (top-level)
    program.command('init').description('Initialize Totem');
    program.command('lint').description('Run compiled rules');
    program.command('doctor').description('Run workspace health diagnostics');
    program.command('search <query>').description('Search the knowledge index');
    program.command('status').description('Show current project health');
    // Consumer tier entries that are subcommand paths under `lesson`
    const lesson = program.command('lesson').description('Manage project lessons');
    lesson.command('add <text>').description('Add a lesson to project memory');
    lesson.command('compile').description('Compile lesson files into deterministic lint rules');
    lesson.command('list').description('List all lessons');
    // Advanced-only commands (must NOT appear in default help)
    program.command('mail').description('Show unread cross-repo mail');
    program.command('orient').description('Derive session orientation');
    program.command('handoff').description('Scaffold a journal entry for handoff');
    program.command('review').description('AI-powered code review');
    return program;
  }

  it('default help renders exactly the consumer tier plus the pointer', () => {
    const program = createMockProgram();
    const help = new TotemHelp();
    const output = help.formatHelp(program, help);

    expect(output.startsWith('Totem — test description')).toBe(true);
    expect(output).toContain('Commands:');
    for (const entry of CONSUMER_TIER) {
      expect(output).toContain(entry);
    }
    expect(output).toContain("Run 'totem help --all' for the full command surface.");
    // Advanced commands are hidden from the default surface
    expect(output).not.toContain('mail');
    expect(output).not.toContain('orient');
    // No --all section headers in the default view
    expect(output).not.toContain('Advanced commands:');
  });

  it('--all lists both tiers and includes advanced + continuity commands', () => {
    const program = createMockProgram();
    const help = new TotemHelp({ all: true });
    const output = help.formatHelp(program, help);

    expect(output).toContain('Consumer commands:');
    expect(output).toContain('Advanced commands:');
    // Known advanced command surfaces under --all
    expect(output).toContain('mail');
    expect(output).toContain('orient');
    // Continuity primitives (D5 caveat) stay visibly present in advanced
    expect(output).toContain('handoff');
    // Consumer entries still render
    expect(output).toContain('lesson compile');
    // The `lesson` NOUN stays discoverable in advanced even though two of its
    // verbs are promoted to the consumer tier
    expect(output).toMatch(/Advanced commands:[\s\S]*\blesson\b/);
  });

  it('badges LLM commands in the advanced tier', () => {
    const program = createMockProgram();
    const help = new TotemHelp({ all: true });
    const output = help.formatHelp(program, help);
    expect(output).toContain('review [LLM]');
  });

  it('prefixes the lesson compile line with [frozen] only when a freeze is active', () => {
    const program = createMockProgram();

    const frozen = new TotemHelp({ freezeActive: true });
    const frozenOut = frozen.formatHelp(program, frozen);
    expect(frozenOut).toContain('[frozen] Compile lesson files into deterministic lint rules');

    const plain = new TotemHelp({ freezeActive: false });
    const plainOut = plain.formatHelp(program, plain);
    expect(plainOut).not.toContain('[frozen]');
  });

  it('the freeze badge is present under --all too', () => {
    const program = createMockProgram();
    const help = new TotemHelp({ all: true, freezeActive: true });
    const output = help.formatHelp(program, help);
    expect(output).toContain('[frozen] Compile lesson files into deterministic lint rules');
  });

  it('uses default Commander help for subcommands', () => {
    const program = createMockProgram();
    const lesson = program.commands.find((c) => c.name() === 'lesson')!;
    const help = new TotemHelp();
    const output = help.formatHelp(lesson, help);
    // Subcommand help lists the noun's subcommands and does NOT use the tiered
    // root render.
    expect(output).toContain('add');
    expect(output).not.toContain('Consumer commands:');
  });

  it('includes version in output', () => {
    const program = createMockProgram();
    const help = new TotemHelp();
    expect(help.formatHelp(program, help)).toContain('Version: 1.0.0');
  });

  it('does not surface hidden commands under --all', () => {
    const program = createMockProgram();
    program.command('secret-cmd', { hidden: true }).description('Should not appear');
    const help = new TotemHelp({ all: true });
    expect(help.formatHelp(program, help)).not.toContain('secret-cmd');
  });

  it('CONSUMER_TIER is the declared consumer surface (order-stable)', () => {
    expect([...CONSUMER_TIER]).toEqual([
      'init',
      'lint',
      'lesson add',
      'lesson compile',
      'doctor',
      'search',
      'status',
    ]);
  });

  it('LLM_COMMANDS contains expected entries', () => {
    expect(LLM_COMMANDS.has('review')).toBe(true);
    expect(LLM_COMMANDS.has('lint')).toBe(false);
    expect(LLM_COMMANDS.has('spec')).toBe(true);
  });
});
