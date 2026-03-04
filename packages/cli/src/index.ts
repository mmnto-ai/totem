#!/usr/bin/env node

import { createRequire } from 'node:module';

import { Command } from 'commander';
import { z } from 'zod';

import { initCommand } from './commands/init.js';

const require = createRequire(import.meta.url);
const { version } = z.object({ version: z.string() }).parse(require('../package.json'));

function handleError(err: unknown): never {
  if (err instanceof Error) {
    console.error(err.message);
  } else {
    console.error('[Totem Error] An unknown error occurred:', err);
  }
  process.exit(1);
}

const program = new Command();

program
  .name('totem')
  .description('Totem — persistent memory and context layer for AI agents')
  .version(version);

program
  .command('init')
  .description('Initialize Totem in the current project')
  .action(async () => {
    try {
      await initCommand();
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('sync')
  .description('Re-index project files into the local vector store')
  .option('--full', 'Force a full re-index (ignores incremental)')
  .option('--incremental', 'Run an incremental sync (default behavior)')
  .action(async (opts: { full?: boolean; incremental?: boolean }) => {
    try {
      const { syncCommand } = await import('./commands/sync.js');
      await syncCommand(opts);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('search <query>')
  .description('Search the knowledge index')
  .option('-t, --type <type>', 'Filter by content type (code, session_log, spec)')
  .option('-n, --max-results <n>', 'Maximum results to return', '5')
  .action(async (query: string, opts: { type?: string; maxResults?: string }) => {
    try {
      const { searchCommand } = await import('./commands/search.js');
      await searchCommand(query, opts);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('stats')
  .description('Show index statistics')
  .action(async () => {
    try {
      const { statsCommand } = await import('./commands/stats.js');
      await statsCommand();
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('spec <input>')
  .description('Generate a pre-work spec briefing for a GitHub issue or topic')
  .option('--raw', 'Output retrieved context without LLM synthesis')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .option('--model <name>', 'Override the default model for the orchestrator')
  .option('--no-cache', 'Bypass cache and force a fresh LLM call')
  .action(async (input: string, opts: { raw?: boolean; out?: string; model?: string }) => {
    try {
      const { specCommand } = await import('./commands/spec.js');
      await specCommand(input, opts);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('briefing')
  .description('Generate a session startup briefing with current context')
  .option('--raw', 'Output retrieved context without LLM synthesis')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .option('--model <name>', 'Override the default model for the orchestrator')
  .option('--no-cache', 'Bypass cache and force a fresh LLM call')
  .action(async (opts: { raw?: boolean; out?: string; model?: string }) => {
    try {
      const { briefingCommand } = await import('./commands/briefing.js');
      await briefingCommand(opts);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('shield')
  .description('Pre-flight code review: analyze your diff against Totem knowledge')
  .option('--raw', 'Output retrieved context without LLM synthesis')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .option('--model <name>', 'Override the default model for the orchestrator')
  .option('--no-cache', 'Bypass cache and force a fresh LLM call')
  .option('--staged', 'Review only staged changes (default: all uncommitted)')
  .action(async (opts: { raw?: boolean; out?: string; model?: string; staged?: boolean }) => {
    try {
      const { shieldCommand } = await import('./commands/shield.js');
      await shieldCommand(opts);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('triage')
  .description('Prioritize open issues into an active work roadmap')
  .option('--raw', 'Output retrieved context without LLM synthesis')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .option('--model <name>', 'Override the default model for the orchestrator')
  .option('--no-cache', 'Bypass cache and force a fresh LLM call')
  .action(async (opts: { raw?: boolean; out?: string; model?: string }) => {
    try {
      const { triageCommand } = await import('./commands/triage.js');
      await triageCommand(opts);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('handoff')
  .description('Generate an end-of-session handoff snapshot for the next session')
  .option('--raw', 'Output retrieved context without LLM synthesis')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .option('--model <name>', 'Override the default model for the orchestrator')
  .option('--no-cache', 'Bypass cache and force a fresh LLM call')
  .action(async (opts: { raw?: boolean; out?: string; model?: string }) => {
    try {
      const { handoffCommand } = await import('./commands/handoff.js');
      await handoffCommand(opts);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('add-lesson [lesson]')
  .alias('anchor')
  .description('Interactively add a lesson to project memory (or pass string as argument)')
  .action(async (lesson?: string) => {
    try {
      const { anchorCommand } = await import('./commands/anchor.js');
      await anchorCommand(lesson);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('learn <pr-number>')
  .description('Extract lessons from a PR review into .totem/lessons.md')
  .option('--raw', 'Output assembled prompt without LLM synthesis')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .option('--model <name>', 'Override the default model for the orchestrator')
  .option('--dry-run', 'Show extracted lessons without writing to lessons.md')
  .action(
    async (
      prNumber: string,
      opts: { raw?: boolean; out?: string; model?: string; dryRun?: boolean },
    ) => {
      try {
        const { learnCommand } = await import('./commands/learn.js');
        await learnCommand(prNumber, opts);
      } catch (err) {
        handleError(err);
      }
    },
  );

program
  .command('install-hooks')
  .description('Install post-merge git hook for automatic Totem sync')
  .action(async () => {
    try {
      const { installHooksCommand } = await import('./commands/install-hooks.js');
      await installHooksCommand();
    } catch (err) {
      handleError(err);
    }
  });

program.parse();
