#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { Command } from 'commander';
import { z } from 'zod';

import { initCommand } from './commands/init.js';
import { reapOrphanedTempFiles } from './utils.js';

const require = createRequire(import.meta.url);
const { version } = z.object({ version: z.string() }).parse(require('../package.json'));

function requireGhCli(): void {
  try {
    execSync('gh --version', { stdio: 'ignore', timeout: 3000 });
  } catch {
    console.error('[Totem Error] This command requires the GitHub CLI (gh).');
    console.error('  Install: https://cli.github.com');
    console.error('  Core commands (init, sync, lint) work without it.');
    process.exit(1);
  }
}

function handleError(err: unknown): never {
  const debug = process.env['TOTEM_DEBUG'] === '1' || process.argv.includes('--debug');

  if (err instanceof Error) {
    const msg = err.message.startsWith('[Totem Error]')
      ? err.message
      : `[Totem Error] ${err.message}`;
    console.error(msg);
    if ('recoveryHint' in err && typeof err.recoveryHint === 'string') {
      console.error(`  Fix: ${err.recoveryHint}`);
    }
    if (debug && err.stack) {
      console.error('\nStack trace:');
      console.error(err.stack);
      // Traverse cause chain
      const seen = new Set<unknown>([err]);
      let current: unknown = err.cause;
      while (current instanceof Error && !seen.has(current)) {
        seen.add(current);
        console.error(`\nCaused by: ${current.message}`);
        if (current.stack) console.error(current.stack);
        current = current.cause;
      }
    }
  } else {
    console.error('[Totem Error] An unknown error occurred:', err);
  }

  if (!debug) {
    console.error('  (Set TOTEM_DEBUG=1 for full stack trace)');
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
  .option(
    '--bare',
    'Initialize without package manager checks or Git hooks (ideal for notes/docs repos)',
  )
  .action(async (options: { bare?: boolean }) => {
    try {
      await initCommand({ bare: options.bare });
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
  .option('-q, --quiet', 'Suppress output (for background/hook usage)')
  .action(
    async (opts: { full?: boolean; incremental?: boolean; prune?: boolean; quiet?: boolean }) => {
      try {
        const { syncCommand } = await import('./commands/sync.js');
        await syncCommand(opts);
      } catch (err) {
        handleError(err);
      }
    },
  );

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
  .command('explain <hash>')
  .description('Look up the lesson behind a compiled rule violation')
  .action(async (hash: string) => {
    try {
      const { explainCommand } = await import('./commands/explain.js');
      await explainCommand(hash);
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
  .command('lint')
  .description('Run compiled rules against your diff (zero LLM, fast)')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .option('--format <format>', 'Output format: text (default), sarif, or json')
  .option('--staged', 'Lint only staged changes (default: all uncommitted)')
  .option(
    '--pr-comment [number]',
    'Post a summary comment on a PR (auto-infers number in GitHub Actions)',
  )
  .action(
    async (opts: {
      out?: string;
      format?: string;
      staged?: boolean;
      prComment?: string | true;
    }) => {
      try {
        const { lintCommand } = await import('./commands/lint.js');
        const prComment =
          opts.prComment === true
            ? true
            : opts.prComment
              ? parseInt(opts.prComment, 10)
              : undefined;
        await lintCommand({
          ...opts,
          format: opts.format as 'text' | 'sarif' | 'json' | undefined,
          prComment,
        });
      } catch (err) {
        handleError(err);
      }
    },
  );

// ─── Review options shared between `review` (primary) and `shield` (deprecated alias) ───
const reviewOptions = (cmd: Command) =>
  cmd
    .option('--raw', 'Output retrieved context without LLM synthesis')
    .option('--out <path>', 'Write output to a file instead of stdout')
    .option('--model <name>', 'Override the default model for the orchestrator')
    .option('--fresh', 'Bypass cache and force a fresh LLM call (ignores cached responses)')
    .option('--staged', 'Review only staged changes (default: all uncommitted)')
    .option('--deterministic', 'REMOVED — use `totem lint` instead', false)
    .option('--format <format>', 'REMOVED — use `totem lint --format` instead')
    .option(
      '--mode <mode>',
      'Review mode: standard (default, with Totem knowledge) or structural (context-blind paranoia)',
    )
    .option('--learn', 'Extract lessons from failed verdicts into .totem/lessons/')
    .option('--yes', 'Auto-accept extracted lessons (for CI; suspicious lessons are dropped)')
    .option(
      '--override <reason>',
      'Override review FAIL with a reason (min 10 chars, logged to trap ledger)',
    )
    .option(
      '--suppress <label>',
      'Suppress a pattern class by label (repeatable)',
      (val: string, prev: string[]) => [...prev, val],
      [] as string[], // totem-context: Commander accumulator default — not untrusted input
    );

async function runReview(opts: {
  raw?: boolean;
  out?: string;
  model?: string;
  fresh?: boolean;
  staged?: boolean;
  deterministic?: boolean;
  format?: string;
  mode?: string;
  learn?: boolean;
  yes?: boolean;
  override?: string;
  suppress?: string[];
}): Promise<void> {
  // Redirect removed --deterministic flag to totem lint
  if (opts.deterministic) {
    console.error('[Review] --deterministic has been removed. Redirecting to `totem lint`.');
    const { lintCommand } = await import('./commands/lint.js');
    await lintCommand({
      format: (opts.format as 'text' | 'sarif' | 'json') ?? 'text',
      staged: opts.staged,
      out: opts.out,
    });
    return;
  }
  // --format is only valid with totem lint, not review
  if (opts.format) {
    const { TotemConfigError } = await import('@mmnto/totem');
    throw new TotemConfigError(
      '--format is not supported by totem review. Use `totem lint --format sarif` instead.',
      'Review outputs human-readable text. Use `totem lint` for SARIF/JSON output.',
      'CONFIG_INVALID',
    );
  }
  const { shieldCommand } = await import('./commands/shield.js');
  await shieldCommand({
    ...opts,
    mode: opts.mode as 'standard' | 'structural' | undefined,
  });
}

reviewOptions(
  program
    .command('review')
    .description('AI-powered code review: analyze your diff against Totem knowledge'),
).action(async (opts) => {
  try {
    await runReview(opts);
  } catch (err) {
    handleError(err);
  }
});

// Deprecated alias — hidden from --help
reviewOptions(
  program.command('shield', { hidden: true }).description('Deprecated alias for `totem review`'),
).action(async (opts) => {
  try {
    console.error("\u26a0 'totem shield' is deprecated. Use 'totem review' instead.");
    await runReview(opts);
  } catch (err) {
    handleError(err);
  }
});

program
  .command('triage-pr <pr-number>')
  .description('Categorized triage view of bot review comments on a PR')
  .option('-i, --interactive', 'Interactive mode: triage findings with Clack prompts')
  .action(async (prNumber: string, opts: { interactive?: boolean }) => {
    requireGhCli();
    try {
      const { triagePrCommand } = await import('./commands/triage-pr.js');
      await triagePrCommand(prNumber, { interactive: opts.interactive });
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
  .option('--fresh', 'Bypass cache and force a fresh LLM call (ignores cached responses)')
  .action(async (opts: { raw?: boolean; out?: string; model?: string; fresh?: boolean }) => {
    requireGhCli();
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
  .command('add-lesson [lesson]', { hidden: true })
  .description('Deprecated alias for `totem lesson add`')
  .action(async (lesson?: string) => {
    try {
      console.error("\u26a0 'totem add-lesson' is deprecated. Use 'totem lesson add' instead.");
      const { addLessonCommand } = await import('./commands/add-lesson.js');
      await addLessonCommand(lesson);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('add-secret <value>')
  .description('Add a custom secret pattern to .totem/secrets.json (local, gitignored)')
  .option('--pattern', 'Treat value as a regex pattern instead of a literal string')
  .action(async (value: string, opts: { pattern?: boolean }) => {
    try {
      const { addSecretCommand } = await import('./commands/add-secret.js');
      await addSecretCommand(value, opts);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('list-secrets')
  .description('List all configured custom secrets (shared + local) with source labels')
  .action(async () => {
    try {
      const { listSecretsCommand } = await import('./commands/list-secrets.js');
      await listSecretsCommand();
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('remove-secret <index>')
  .description('Remove a custom secret from .totem/secrets.json by index (from list-secrets)')
  .action(async (index: string) => {
    try {
      const { removeSecretCommand } = await import('./commands/remove-secret.js');
      await removeSecretCommand(index);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('compile', { hidden: true })
  .description('Deprecated alias for `totem lesson compile`')
  .option('--raw', 'Output compiler prompts without LLM synthesis')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .option('--model <name>', 'Override the default model for the orchestrator')
  .option('--fresh', 'Bypass cache and force a fresh LLM call')
  .option('--force', 'Recompile all lessons (ignore existing compiled rules)')
  .option(
    '--export',
    'Export lessons as rules to AI assistant config files (uses exports from config)',
  )
  .option('--from-cursor', 'Ingest .cursorrules and .cursor/rules/*.mdc files as lessons')
  .option('--concurrency <n>', 'Number of parallel LLM compilations (default: 5)', '5')
  .option('--cloud <url>', 'Use a cloud compilation endpoint for parallel fan-out')
  .option('--verbose', 'Show details for skipped (non-compilable) lessons')
  .action(
    async (opts: {
      raw?: boolean;
      out?: string;
      model?: string;
      fresh?: boolean;
      force?: boolean;
      export?: boolean;
      fromCursor?: boolean;
      concurrency?: string;
      cloud?: string;
      verbose?: boolean;
    }) => {
      try {
        console.error("\u26a0 'totem compile' is deprecated. Use 'totem lesson compile' instead.");
        const { compileCommand } = await import('./commands/compile.js');
        await compileCommand(opts);
      } catch (err) {
        handleError(err);
      }
    },
  );

program
  .command('verify-manifest')
  .description('Verify compiled-rules.json matches the compile manifest (CI gate)')
  .action(async () => {
    try {
      const { verifyManifestCommand } = await import('./commands/verify-manifest.js');
      await verifyManifestCommand();
    } catch (err) {
      handleError(err);
    }
  });

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
  .command('extract <pr-numbers...>', { hidden: true })
  .description('Deprecated alias for `totem lesson extract`')
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
      requireGhCli();
      try {
        console.error("\u26a0 'totem extract' is deprecated. Use 'totem lesson extract' instead.");
        const { extractCommand } = await import('./commands/extract.js');
        await extractCommand(prNumbers, opts);
      } catch (err) {
        handleError(err);
      }
    },
  );

program
  .command('review-learn <pr-number>')
  .description('Extract lessons from resolved bot review comments on a merged PR')
  .option('--raw', 'Output assembled prompt without LLM synthesis')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .option('--model <name>', 'Override the default model for the orchestrator')
  .option('--fresh', 'Bypass cache and force a fresh LLM call (ignores cached responses)')
  .option('--dry-run', 'Show extracted lessons without writing to disk')
  .option('--yes', 'Skip confirmation prompt (use in scripts/CI)')
  .action(
    async (
      prNumber: string,
      opts: {
        raw?: boolean;
        out?: string;
        model?: string;
        fresh?: boolean;
        dryRun?: boolean;
        yes?: boolean;
      },
    ) => {
      requireGhCli();
      try {
        const { reviewLearnCommand } = await import('./commands/review-learn.js');
        await reviewLearnCommand(prNumber, opts);
      } catch (err) {
        handleError(err);
      }
    },
  );

program
  .command('link <path>')
  .description('Link a neighboring repo into this project')
  .option('--unlink', 'Remove a previously linked repo')
  .option('-y, --yes', 'Skip the security confirmation prompt')
  .action(async (targetPath: string, opts: { unlink?: boolean; yes?: boolean }) => {
    try {
      const { linkCommand } = await import('./commands/link.js');
      await linkCommand(targetPath, opts);
    } catch (err) {
      handleError(err);
    }
  });

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
    requireGhCli();
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
  .command('migrate-lessons', { hidden: true })
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
  .command('lint-lessons')
  .description('Validate lesson metadata (patterns, scopes, severity)')
  .option('--strict', 'Promote warnings to errors (exit non-zero on any diagnostic)')
  .action(async (opts) => {
    try {
      const { lintLessonsCommand } = await import('./commands/lint-lessons.js');
      await lintLessonsCommand({ strict: opts.strict ?? false });
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
  .command('doctor')
  .description('Run workspace health diagnostics')
  .option('--pr', 'Auto-downgrade noisy rules and open a PR')
  .action(async (opts: { pr?: boolean }) => {
    try {
      const { doctorCommand } = await import('./commands/doctor.js');
      await doctorCommand(opts);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('status')
  .description('Show current project health (manifest, shield, rules)')
  .action(async () => {
    try {
      const { statusCommand } = await import('./commands/status.js');
      await statusCommand();
    } catch (err) {
      handleError(err);
    }
  });

// ─── Lesson noun-verb subcommands ────────────────────────

const lessonCmd = program.command('lesson').description('Manage project lessons');

lessonCmd
  .command('list')
  .description('List all lessons with hash, heading, and tags')
  .action(async () => {
    try {
      const { lessonListCommand } = await import('./commands/lesson.js');
      await lessonListCommand();
    } catch (err) {
      handleError(err);
    }
  });

lessonCmd
  .command('add <text>')
  .description('Add a lesson to project memory')
  .action(async (text: string) => {
    try {
      const { lessonAddCommand } = await import('./commands/lesson.js');
      await lessonAddCommand(text);
    } catch (err) {
      handleError(err);
    }
  });

lessonCmd
  .command('compile')
  .description('Compile lessons into deterministic regex rules')
  .option('--raw', 'Output compiler prompts without LLM synthesis')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .option('--model <name>', 'Override the default model for the orchestrator')
  .option('--fresh', 'Bypass cache and force a fresh LLM call')
  .option('--force', 'Recompile all lessons (ignore existing compiled rules)')
  .option(
    '--export',
    'Export lessons as rules to AI assistant config files (uses exports from config)',
  )
  .option('--from-cursor', 'Ingest .cursorrules and .cursor/rules/*.mdc files as lessons')
  .option('--concurrency <n>', 'Number of parallel LLM compilations (default: 5)', '5')
  .option('--cloud <url>', 'Use a cloud compilation endpoint for parallel fan-out')
  .option('--verbose', 'Show details for skipped (non-compilable) lessons')
  .action(
    async (opts: {
      raw?: boolean;
      out?: string;
      model?: string;
      fresh?: boolean;
      force?: boolean;
      export?: boolean;
      fromCursor?: boolean;
      concurrency?: string;
      cloud?: string;
      verbose?: boolean;
    }) => {
      try {
        const { compileCommand } = await import('./commands/compile.js');
        await compileCommand(opts);
      } catch (err) {
        handleError(err);
      }
    },
  );

lessonCmd
  .command('extract <pr-numbers...>')
  .description('Extract lessons from PR review(s) into .totem/lessons/')
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
      requireGhCli();
      try {
        const { extractCommand } = await import('./commands/extract.js');
        await extractCommand(prNumbers, opts);
      } catch (err) {
        handleError(err);
      }
    },
  );

// ─── Exemption noun-verb subcommands ────────────────────
const exemptionCmd = program.command('exemption').description('Manage pattern exemptions');

exemptionCmd
  .command('list')
  .description('List all shared and local exemptions')
  .action(async () => {
    try {
      const { exemptionListCommand } = await import('./commands/exemption.js');
      await exemptionListCommand();
    } catch (err) {
      handleError(err);
    }
  });

exemptionCmd
  .command('add')
  .description('Add a manual exemption for a pattern label')
  .requiredOption('--rule <label>', 'Pattern label to exempt')
  .requiredOption('--reason <text>', 'Justification for the exemption')
  .action(async (opts: { rule: string; reason: string }) => {
    try {
      const { exemptionAddCommand } = await import('./commands/exemption.js');
      await exemptionAddCommand(opts);
    } catch (err) {
      handleError(err);
    }
  });

exemptionCmd
  .command('audit')
  .description('Show exemption audit report with ledger events')
  .action(async () => {
    try {
      const { exemptionAuditCommand } = await import('./commands/exemption.js');
      await exemptionAuditCommand();
    } catch (err) {
      handleError(err);
    }
  });

// ─── Rule noun-verb subcommands ──────────────────────────
const ruleCmd = program.command('rule').description('Manage compiled rules');

ruleCmd
  .command('list')
  .description('List all compiled rules')
  .action(async () => {
    try {
      const { ruleListCommand } = await import('./commands/rule.js');
      await ruleListCommand();
    } catch (err) {
      handleError(err);
    }
  });

ruleCmd
  .command('inspect <id>')
  .description('Show rule details by hash (supports prefix matching)')
  .action(async (id: string) => {
    try {
      const { ruleInspectCommand } = await import('./commands/rule.js');
      await ruleInspectCommand(id);
    } catch (err) {
      handleError(err);
    }
  });

ruleCmd
  .command('test <id>')
  .description('Test rule against inline Example Hit/Miss')
  .action(async (id: string) => {
    try {
      const { ruleTestCommand } = await import('./commands/rule.js');
      await ruleTestCommand(id);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('check')
  .description('Run lint + review sequentially')
  .option('--staged', 'Only check staged changes')
  .option('-m, --model <model>', 'Override orchestrator model')
  .option('--fresh', 'Skip cache')
  .action(async (opts) => {
    try {
      const { checkCommand } = await import('./commands/check.js');
      await checkCommand({
        model: opts.model,
        fresh: opts.fresh,
        staged: opts.staged,
      });
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('demo', { hidden: true })
  .description('Show the Totem spinner with movie quotes')
  .option('--duration <seconds>', 'How long to run (default: 6)', '6')
  .action(async (opts: { duration: string }) => {
    const { createSpinner } = await import('./ui.js');
    const seconds = Math.max(1, Math.min(60, parseInt(opts.duration, 10) || 6));
    const spinner = await createSpinner('Totem');
    setTimeout(() => {
      spinner.succeed(`Done — ${seconds}s of vibes`);
    }, seconds * 1000);
  });

program
  .command('install-hooks', { hidden: true })
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

program.addHelpText(
  'after',
  `
Commands by tier:
  Core (no API keys):    init, sync, lint, test, verify-manifest, hooks, link, stats, drift, doctor, status, lesson, rule, exemption
  AI-Powered (needs LLM): review, spec, handoff, docs, lesson compile (with LLM), check
  GitHub Workflows:      lesson extract, review-learn, triage, triage-pr, wrap
  Utilities:             lesson add, add-secret, list-secrets, remove-secret, explain, eject
`,
);

program.parse();
