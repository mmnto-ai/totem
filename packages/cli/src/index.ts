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
  .option('--prune', 'Detect and interactively remove lessons with stale file references')
  .action(async (opts: { full?: boolean; incremental?: boolean; prune?: boolean }) => {
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
  .option('--deterministic', 'Use compiled rules only — no LLM, no embeddings')
  .option(
    '--mode <mode>',
    'Review mode: standard (default, with Totem knowledge) or structural (context-blind paranoia)',
  )
  .option('--format <format>', 'Output format: text (default), sarif, or json (deterministic only)')
  .option('--learn', 'Extract lessons from failed verdicts into .totem/lessons/')
  .option('--yes', 'Auto-accept extracted lessons (for CI; suspicious lessons are dropped)')
  .action(
    async (opts: {
      raw?: boolean;
      out?: string;
      model?: string;
      fresh?: boolean;
      staged?: boolean;
      deterministic?: boolean;
      mode?: string;
      format?: string;
      learn?: boolean;
      yes?: boolean;
    }) => {
      try {
        const { shieldCommand } = await import('./commands/shield.js');
        await shieldCommand({
          ...opts,
          mode: opts.mode as 'standard' | 'structural' | undefined,
          format: opts.format as 'text' | 'sarif' | 'json' | undefined,
        });
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
  .command('audit')
  .description('Audit the open issue backlog against strategic context')
  .option('--raw', 'Output retrieved context without LLM synthesis')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .option('--model <name>', 'Override the default model for the orchestrator')
  .option('--fresh', 'Bypass cache and force a fresh LLM call (ignores cached responses)')
  .option('--dry-run', 'Show proposals without prompting for execution')
  .option('--yes', 'Auto-accept all actionable proposals without interactive confirmation')
  .option('--context <lens>', 'Strategic lens to guide the audit (e.g., "speed to 1.0")')
  .action(
    async (opts: {
      raw?: boolean;
      out?: string;
      model?: string;
      fresh?: boolean;
      dryRun?: boolean;
      yes?: boolean;
      context?: string;
    }) => {
      try {
        const { auditCommand } = await import('./commands/audit.js');
        await auditCommand(opts);
      } catch (err) {
        handleError(err);
      }
    },
  );

program
  .command('handoff')
  .description('Generate an end-of-session handoff snapshot for the next session')
  .option('--lite', 'Zero-LLM deterministic snapshot (git state + lessons, no API key needed)')
  .option('--raw', 'Output retrieved context without LLM synthesis')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .option('--model <name>', 'Override the default model for the orchestrator')
  .option('--fresh', 'Bypass cache and force a fresh LLM call (ignores cached responses)')
  .action(
    async (opts: {
      lite?: boolean;
      raw?: boolean;
      out?: string;
      model?: string;
      fresh?: boolean;
    }) => {
      try {
        const { handoffCommand } = await import('./commands/handoff.js');
        await handoffCommand(opts);
      } catch (err) {
        handleError(err);
      }
    },
  );

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
  .command('compile')
  .description('Compile lessons into deterministic regex rules for zero-LLM shield checks')
  .option('--raw', 'Output compiler prompts without LLM synthesis')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .option('--model <name>', 'Override the default model for the orchestrator')
  .option('--fresh', 'Bypass cache and force a fresh LLM call')
  .option('--force', 'Recompile all lessons (ignore existing compiled rules)')
  .option(
    '--export',
    'Export lessons as rules to AI assistant config files (uses exports from config)',
  )
  .action(
    async (opts: {
      raw?: boolean;
      out?: string;
      model?: string;
      fresh?: boolean;
      force?: boolean;
      export?: boolean;
    }) => {
      try {
        const { compileCommand } = await import('./commands/compile.js');
        await compileCommand(opts);
      } catch (err) {
        handleError(err);
      }
    },
  );

program
  .command('test')
  .description('Run test fixtures against compiled rules (TDD for governance rules)')
  .option('--filter <term>', 'Filter by rule hash or heading substring')
  .action(async (opts: { filter?: string }) => {
    try {
      const { testRulesCommand } = await import('./commands/test-rules.js');
      await testRulesCommand(opts);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('extract <pr-numbers...>')
  .description('Extract lessons from PR review(s) into .totem/lessons/ (interactive cherry-pick)')
  .option('--raw', 'Output assembled prompt without LLM synthesis')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .option('--model <name>', 'Override the default model for the orchestrator')
  .option('--fresh', 'Bypass cache and force a fresh LLM call (ignores cached responses)')
  .option('--dry-run', 'Show extracted lessons without writing to disk')
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
  .command('docs [paths...]')
  .description('Auto-update registered project docs using LLM synthesis')
  .option('--raw', 'Output assembled prompt without LLM synthesis')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .option('--model <name>', 'Override the default model for the orchestrator')
  .option('--fresh', 'Bypass cache and force a fresh LLM call (ignores cached responses)')
  .option('--only <names>', 'Comma-separated filter for doc names (e.g., --only roadmap,readme)')
  .option('--dry-run', 'Preview changes without writing files')
  .option('--yes', 'Skip confirmation prompt (use in scripts/CI)')
  .action(
    async (
      paths: string[],
      opts: {
        raw?: boolean;
        out?: string;
        model?: string;
        fresh?: boolean;
        only?: string;
        dryRun?: boolean;
        yes?: boolean;
      },
    ) => {
      try {
        const { docsCommand } = await import('./commands/docs.js');
        await docsCommand(paths, opts);
      } catch (err) {
        handleError(err);
      }
    },
  );

program
  .command('migrate-lessons')
  .description('Migrate .totem/lessons.md to .totem/lessons/ directory (one file per lesson)')
  .action(async () => {
    try {
      const { migrateLessonsCommand } = await import('./commands/migrate-lessons.js');
      await migrateLessonsCommand();
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('drift')
  .description('Check lessons for stale file references (CI gate)')
  .action(async () => {
    try {
      const { driftCommand } = await import('./commands/drift.js');
      await driftCommand();
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('hooks')
  .description('Install git hooks (pre-commit, pre-push, post-merge) non-interactively')
  .option('--check', 'Verify hooks are installed (exit 1 if missing)')
  .action(async (opts: { check?: boolean }) => {
    try {
      const { hooksCommand } = await import('./commands/install-hooks.js');
      hooksCommand(opts);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('install-hooks')
  .description('Install git hooks interactively (legacy — prefer `totem hooks`)')
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
