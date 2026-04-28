#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { Command } from 'commander';
import { z } from 'zod';

import { initCommand } from './commands/init.js';
import { TotemHelp } from './help.js';
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
  .version(version)
  .option('--json', 'Output structured JSON to stdout')
  .configureHelp({
    formatHelp: (cmd, helper) => new TotemHelp().formatHelp(cmd, helper),
  });

// Set JSON mode early — preAction may not fire on parse errors
if (process.argv.includes('--json')) {
  process.env['TOTEM_JSON_OUTPUT'] = '1';
}

program
  .command('init')
  .description('Initialize Totem in the current project')
  .option(
    '--bare',
    'Initialize without package manager checks or Git hooks (ideal for notes/docs repos)',
  )
  .option('--pilot', 'Enable pilot mode — hooks warn instead of block during initial adoption')
  .option('--strict', 'Use strict enforcement tier (spec-required + review gate for agents)')
  .option('--global', 'Create a personal profile in ~/.totem/ for use across all projects')
  .action(
    async (options: { bare?: boolean; pilot?: boolean; strict?: boolean; global?: boolean }) => {
      try {
        await initCommand({
          bare: options.bare,
          pilot: options.pilot,
          strict: options.strict,
          global: options.global,
        });
      } catch (err) {
        handleError(err);
      }
    },
  );

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
  .option(
    '--timeout-mode <mode>',
    'Regex timeout mode: strict (default, fail CI on timeout) or lenient (skip timing-out rules with warning)',
  )
  .action(
    async (opts: {
      out?: string;
      format?: string;
      staged?: boolean;
      prComment?: string | true;
      timeoutMode?: string;
    }) => {
      try {
        const { lintCommand } = await import('./commands/lint.js');
        const prComment =
          opts.prComment === true
            ? true
            : opts.prComment
              ? parseInt(opts.prComment, 10)
              : undefined;
        if (opts.timeoutMode && opts.timeoutMode !== 'strict' && opts.timeoutMode !== 'lenient') {
          const { TotemConfigError } = await import('@mmnto/totem');
          throw new TotemConfigError(
            `Invalid --timeout-mode "${opts.timeoutMode}". Use "strict" or "lenient".`,
            "Run 'totem lint --help' for valid options.",
            'CONFIG_INVALID',
          );
        }
        await lintCommand({
          ...opts,
          format: opts.format as 'text' | 'sarif' | 'json' | undefined,
          prComment,
          timeoutMode: opts.timeoutMode as 'strict' | 'lenient' | undefined,
        });
      } catch (err) {
        handleError(err);
      }
    },
  );

// ─── Review options shared between `review` (primary) and the deprecated `shield` alias ───
const reviewOptions = (cmd: Command) =>
  cmd
    .option('--raw', 'Output retrieved context without LLM synthesis')
    .option('--out <path>', 'Write output to a file instead of stdout')
    .option('--model <name>', 'Override the default model for the orchestrator')
    .option('--fresh', 'Bypass cache and force a fresh LLM call (ignores cached responses)')
    .option('--staged', 'Review only staged changes (default: all uncommitted)')
    .option(
      '--diff <ref-range>',
      'Review an explicit git diff range (e.g. "HEAD^..HEAD" or "main...feature"). Bypasses the implicit working-tree → staged → branch-vs-base fallback.',
    )
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
    )
    .option(
      '--auto-capture',
      'Enable Pipeline 5 auto-capture of observation rules from findings (off by default; captured rules are context-less and apply globally)',
    )
    .addHelpText(
      'after',
      [
        '',
        'Diff resolution (when --diff is omitted):',
        '  1. --staged          → staged-only diff',
        '  2. (default)         → working-tree diff (all uncommitted)',
        '  3. (fallback)        → branch-vs-base diff when 1/2 produce nothing',
        'The chosen path is logged to stderr; large diffs (>50000 chars)',
        'trigger an explicit truncation warning before the LLM call.',
        '',
      ].join('\n'),
    );

async function runReview(opts: {
  raw?: boolean;
  out?: string;
  model?: string;
  fresh?: boolean;
  staged?: boolean;
  diff?: string;
  deterministic?: boolean;
  format?: string;
  mode?: string;
  learn?: boolean;
  yes?: boolean;
  override?: string;
  suppress?: string[];
  autoCapture?: boolean;
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
  .description('Scaffold a structured journal entry for end-of-session handoff')
  .option('--stdout', 'Print scaffold to stdout instead of opening in $EDITOR')
  .option('--lite', 'Alias for --stdout')
  .option('--out <path>', 'Write journal entry to a specific path')
  .action(async (opts: { stdout?: boolean; lite?: boolean; out?: string }) => {
    try {
      const { handoffCommand } = await import('./commands/handoff.js');
      await handoffCommand(opts);
    } catch (err) {
      handleError(err);
    }
  });

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
    '--upgrade <hash>',
    'Re-compile a single rule with telemetry-driven ast-grep guidance (mmnto/totem#1131)',
  )
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
      upgrade?: string;
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
  .command('import')
  .description('Import rules from external linter configs (ESLint, Semgrep)')
  .option('--from-semgrep <path>', 'Import rules from a Semgrep YAML rules file')
  .option('--from-eslint <path>', 'Import rules from an ESLint JSON config file')
  .option('--out <path>', 'Custom output path for compiled-rules.json')
  .option('--dry-run', 'Preview imported rules without writing')
  .action(async (opts) => {
    try {
      const { importCommand } = await import('./commands/import.js');
      await importCommand(opts);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('install <target>')
  .description('Install a Totem pack (e.g., pack/my-rules)')
  .option('--yes', 'Auto-approve .totemignore merge (required for non-interactive CI)')
  .action(async (target: string, options: { yes?: boolean }) => {
    try {
      const { installCommand } = await import('./commands/install.js');
      await installCommand(target, { yes: options.yes }); // totem-context: intentional cleanup — handleError is never-typed and calls process.exit(1)
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
  .command('extract [pr-numbers...]', { hidden: true })
  .description('Deprecated alias for `totem lesson extract`')
  .option('--raw', 'Output assembled prompt without LLM synthesis')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .option('--model <name>', 'Override the default model for the orchestrator')
  .option('--fresh', 'Bypass cache and force a fresh LLM call (ignores cached responses)')
  .option('--dry-run', 'Show extracted lessons without writing to disk')
  .option('--yes', 'Skip confirmation prompt (use in scripts/CI)')
  .option(
    '--from-scan',
    'Extract lessons from fixed code scanning alerts instead of review comments',
  )
  .option('--local', 'Extract lessons from local git diff instead of PR reviews')
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
        fromScan?: boolean;
        local?: boolean;
      },
    ) => {
      try {
        if (!opts.local && (!prNumbers || prNumbers.length === 0)) {
          const { TotemConfigError } = await import('@mmnto/totem');
          throw new TotemConfigError(
            'No PR numbers provided.',
            "Pass PR numbers (e.g. 'totem lesson extract 123') or use --local for local diffs.",
            'CONFIG_INVALID',
          );
        }
        if (!opts.local) {
          requireGhCli();
        }
        console.error("\u26a0 'totem extract' is deprecated. Use 'totem lesson extract' instead.");
        const { extractCommand } = await import('./commands/extract.js');
        await extractCommand(prNumbers ?? [], opts);
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

// `totem wrap` is retired pending mmnto-ai/totem#1361. The command is
// hidden from --help but still wired so invocation produces the
// retirement error with the manual workaround sequence. Do NOT remove
// the registration — deleting it would silently mask the error with
// commander's "unknown command" path and lose the workaround hint.
program
  .command('wrap <pr-numbers...>', { hidden: true })
  .description('RETIRED (mmnto-ai/totem#1361) — post-merge workflow')
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
  .option('-f, --force', 'Force overwrite existing hooks')
  .option('--strict', 'Use strict enforcement tier (spec-required + review gate)')
  .option('--standard', 'Use standard enforcement tier (default)')
  .action(
    async (opts: { check?: boolean; force?: boolean; strict?: boolean; standard?: boolean }) => {
      try {
        const { hooksCommand } = await import('./commands/install-hooks.js');
        await hooksCommand(opts);
      } catch (err) {
        handleError(err);
      }
    },
  );

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
  .description('Show current project health (manifest, review, rules)')
  .action(async () => {
    try {
      const { statusCommand } = await import('./commands/status.js');
      await statusCommand();
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('describe')
  .description('Show project governance scope (rules, lessons, tier, partitions)')
  .action(async () => {
    try {
      const { describeCommand } = await import('./commands/describe.js');
      await describeCommand();
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
  .command('archive <hash>')
  .description('Archive a compiled rule (flip status, refresh manifest, regenerate exports)')
  .option('--reason <string>', 'Reason for archiving (recorded in archivedReason)')
  .action(async (hash: string, opts: { reason?: string }) => {
    try {
      const { lessonArchiveCommand } = await import('./commands/lesson.js');
      await lessonArchiveCommand(hash, opts);
    } catch (err) {
      handleError(err); // handleError returns `never`; unreachable throw below satisfies the fail-loud check
      throw err;
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
  .option(
    '--upgrade <hash>',
    'Re-compile a single rule with telemetry-driven ast-grep guidance (mmnto/totem#1131)',
  )
  .option(
    '--refresh-manifest',
    'Recompute compile-manifest.json output_hash from current compiled-rules.json (no LLM; mmnto-ai/totem#1587)',
  )
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
      upgrade?: string;
      refreshManifest?: boolean;
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
  .command('extract [pr-numbers...]')
  .description('Extract lessons from PR review(s) or local git diff into .totem/lessons/')
  .option('--raw', 'Output assembled prompt without LLM synthesis')
  .option('--out <path>', 'Write output to a file instead of stdout')
  .option('--model <name>', 'Override the default model for the orchestrator')
  .option('--fresh', 'Bypass cache and force a fresh LLM call (ignores cached responses)')
  .option('--dry-run', 'Show extracted lessons without writing to disk')
  .option('--yes', 'Skip confirmation prompt (use in scripts/CI)')
  .option(
    '--from-scan',
    'Extract lessons from fixed code scanning alerts instead of review comments',
  )
  .option('--local', 'Extract lessons from local git diff instead of PR reviews')
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
        fromScan?: boolean;
        local?: boolean;
      },
    ) => {
      try {
        if (!opts.local && (!prNumbers || prNumbers.length === 0)) {
          const { TotemConfigError } = await import('@mmnto/totem');
          throw new TotemConfigError(
            'No PR numbers provided.',
            "Pass PR numbers (e.g. 'totem lesson extract 123') or use --local for local diffs.",
            'CONFIG_INVALID',
          );
        }
        if (!opts.local) {
          requireGhCli();
        }
        const { extractCommand } = await import('./commands/extract.js');
        await extractCommand(prNumbers ?? [], opts);
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

ruleCmd
  .command('scaffold <id>')
  .description('Generate a test fixture skeleton for a compiled rule')
  .option('--out <path>', 'Write fixture to a custom path')
  .action(async (id: string, opts: { out?: string }) => {
    try {
      const { ruleScaffoldCommand } = await import('./commands/rule.js');
      await ruleScaffoldCommand(id, opts);
    } catch (err) {
      handleError(err);
    }
  });

ruleCmd
  .command('promote <id>')
  .description('Promote an unverified rule to active (removes the unverified flag; ADR-089)')
  .action(async (id: string) => {
    try {
      const { rulePromoteCommand } = await import('./commands/rule.js');
      await rulePromoteCommand(id);
    } catch (err) {
      handleError(err);
      // handleError is typed `: never` and calls process.exit, so this throw
      // never executes. It is here only to satisfy the ast-grep structural
      // rule that scans catch bodies for a throw_statement (Tenet 4 fail-loud
      // enforcement). Removing it re-introduces the lint error without any
      // behavioral change.
      throw err;
    }
  });

// ─── Proposal noun-verb subcommands ─────────────────────
// mmnto/totem#1288: scaffold NNN-prefixed proposals in <strategy>/proposals/active/.
const proposalCmd = program.command('proposal').description('Manage governance proposals');

proposalCmd
  .command('new <title>')
  .description('Scaffold a new NNN-prefixed proposal under proposals/active/')
  .action(async (title: string) => {
    try {
      const { proposalNewCommand } = await import('./commands/proposal.js');
      await proposalNewCommand(title); // totem-context: handleError (catch below) is terminal — declared `: never` and exits via process.exit.
    } catch (err) {
      handleError(err);
    }
  });

// ─── ADR noun-verb subcommands ──────────────────────────
// mmnto/totem#1288: scaffold NNN-prefixed ADRs in <strategy>/adr/ per ADR-091 heading convention.
const adrCmd = program.command('adr').description('Manage Architecture Decision Records');

adrCmd
  .command('new <title>')
  .description('Scaffold a new NNN-prefixed ADR under adr/ (heading: `# ADR NNN: Title`)')
  .action(async (title: string) => {
    try {
      const { adrNewCommand } = await import('./commands/adr.js');
      await adrNewCommand(title); // totem-context: handleError (catch below) is terminal — declared `: never` and exits via process.exit.
    } catch (err) {
      handleError(err);
    }
  });

// ─── Config noun-verb subcommands ───────────────────────
const configCmd = program.command('config').description('Read and manage project configuration');

configCmd
  .command('get <key>')
  .description('Read a configuration value by dot-notation key')
  .action(async (key: string) => {
    try {
      const { configGetCommand } = await import('./commands/config.js');
      await configGetCommand(key);
    } catch (err) {
      handleError(err);
    }
  });

configCmd
  .command('set <key> <value>')
  .description('Set a configuration value (not yet implemented)')
  .action(async (key: string, value: string) => {
    try {
      const { configSetCommand } = await import('./commands/config.js');
      await configSetCommand(key, value);
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

try {
  await program.parseAsync();
} catch (err) {
  if (process.env['TOTEM_JSON_OUTPUT'] === '1') {
    const { printJson } = await import('./json-output.js');
    const message = err instanceof Error ? err.message : String(err);
    const fix =
      err instanceof Error && 'recoveryHint' in err && typeof err.recoveryHint === 'string'
        ? err.recoveryHint
        : undefined;
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : undefined;
    printJson({
      status: 'error',
      command: process.argv.slice(2).join(' '),
      // eslint-disable-next-line id-match -- JSON API field name
      error: { message, fix, code },
    });
    process.exit(1);
  }
  handleError(err);
}
