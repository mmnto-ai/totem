#!/usr/bin/env node

import { createRequire } from 'node:module';

import { Command } from 'commander';
import { z } from 'zod';

import { initCommand } from './commands/init.js';
import { reapOrphanedTempFiles } from './utils.js';

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
  .command('spec <inputs...>')
  .description('Generate a pre-work spec briefing for GitHub issue(s) or topic(s)')
  .option('--raw', 'Output retrieved context without LLM synthesis')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .option('--model <name>', 'Override the default model for the orchestrator')
  .option('--fresh', 'Bypass cache and force a fresh LLM call (ignores cached responses)')
  .action(
    async (
      inputs: string[],
      opts: { raw?: boolean; out?: string; model?: string; fresh?: boolean },
    ) => {
      try {
        const { specCommand } = await import('./commands/spec.js');
        await specCommand(inputs, opts);
      } catch (err) {
        handleError(err);
      }
    },
  );

program
  .command('briefing')
  .description('Generate a session startup briefing with current context')
  .option('--raw', 'Output retrieved context without LLM synthesis')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .option('--model <name>', 'Override the default model for the orchestrator')
  .option('--fresh', 'Bypass cache and force a fresh LLM call (ignores cached responses)')
  .action(async (opts: { raw?: boolean; out?: string; model?: string; fresh?: boolean }) => {
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
  .option('--fresh', 'Bypass cache and force a fresh LLM call (ignores cached responses)')
  .option('--staged', 'Review only staged changes (default: all uncommitted)')
  .action(
    async (opts: {
      raw?: boolean;
      out?: string;
      model?: string;
      fresh?: boolean;
      staged?: boolean;
    }) => {
      try {
        const { shieldCommand } = await import('./commands/shield.js');
        await shieldCommand(opts);
      } catch (err) {
        handleError(err);
      }
    },
  );

program
  .command('triage')
  .description('Prioritize open issues into an active work roadmap')
  .option('--raw', 'Output retrieved context without LLM synthesis')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .option('--model <name>', 'Override the default model for the orchestrator')
  .option('--fresh', 'Bypass cache and force a fresh LLM call (ignores cached responses)')
  .action(async (opts: { raw?: boolean; out?: string; model?: string; fresh?: boolean }) => {
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
  .option('--fresh', 'Bypass cache and force a fresh LLM call (ignores cached responses)')
  .action(async (opts: { raw?: boolean; out?: string; model?: string; fresh?: boolean }) => {
    try {
      const { handoffCommand } = await import('./commands/handoff.js');
      await handoffCommand(opts);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('bridge')
  .description('Generate a lightweight context bridge for mid-session compaction')
  .option('-m, --message <text>', 'Breadcrumb message describing current task state')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .action(async (opts: { message?: string; out?: string }) => {
    try {
      const { bridgeCommand } = await import('./commands/bridge.js');
      bridgeCommand(opts);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('add-lesson [lesson]')
  .description('Interactively add a lesson to project memory (or pass string as argument)')
  .action(async (lesson?: string) => {
    try {
      const { addLessonCommand } = await import('./commands/add-lesson.js');
      await addLessonCommand(lesson);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('extract <pr-numbers...>')
  .description('Extract lessons from PR review(s) into .totem/lessons.md')
  .option('--raw', 'Output assembled prompt without LLM synthesis')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .option('--model <name>', 'Override the default model for the orchestrator')
  .option('--fresh', 'Bypass cache and force a fresh LLM call (ignores cached responses)')
  .option('--dry-run', 'Show extracted lessons without writing to lessons.md')
  .option('--yes', 'Skip confirmation prompt (use in scripts/CI)')
  .action(
    async (
      prNumbers: string[],
      opts: {
        raw?: boolean;
        out?: string;
        model?: string;
        fresh?: boolean;
        dryRun?: boolean;
        yes?: boolean;
      },
    ) => {
      try {
        const { extractCommand } = await import('./commands/extract.js');
        await extractCommand(prNumbers, opts);
      } catch (err) {
        handleError(err);
      }
    },
  );

program
  .command('eject')
  .description('Remove all Totem hooks, config, and data from this project')
  .option('--force', 'Skip confirmation prompt')
  .action(async (opts: { force?: boolean }) => {
    try {
      const { ejectCommand } = await import('./commands/eject.js');
      await ejectCommand(opts);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('wrap <pr-numbers...>')
  .description('Post-merge workflow: learn from PR(s), sync index, then triage')
  .option('--model <name>', 'Override the default model for the orchestrator')
  .option('--fresh', 'Bypass cache and force fresh LLM calls')
  .option('--yes', 'Skip confirmation prompt for lesson extraction')
  .action(async (prNumbers: string[], opts: { model?: string; fresh?: boolean; yes?: boolean }) => {
    try {
      const { wrapCommand } = await import('./commands/wrap.js');
      await wrapCommand(prNumbers, opts);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('docs')
  .description('Auto-update registered project docs using LLM synthesis')
  .option('--raw', 'Output assembled prompt without LLM synthesis')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .option('--model <name>', 'Override the default model for the orchestrator')
  .option('--fresh', 'Bypass cache and force a fresh LLM call (ignores cached responses)')
  .option('--only <names>', 'Comma-separated filter for doc names (e.g., --only roadmap,readme)')
  .option('--dry-run', 'Preview changes without writing files')
  .option('--yes', 'Skip confirmation prompt (use in scripts/CI)')
  .action(
    async (opts: {
      raw?: boolean;
      out?: string;
      model?: string;
      fresh?: boolean;
      only?: string;
      dryRun?: boolean;
      yes?: boolean;
    }) => {
      try {
        const { docsCommand } = await import('./commands/docs.js');
        await docsCommand(opts);
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

// Fire-and-forget: reap orphaned temp files from previous crashed runs
reapOrphanedTempFiles(process.cwd(), '.totem').catch(() => {});

program.parse();
