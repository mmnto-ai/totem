#!/usr/bin/env node
process.env['TOTEM_LITE'] = '1';

// Build-time version constant injected by esbuild
declare const __TOTEM_VERSION__: string;

import { Command } from 'commander';

import { TotemHelp } from './help.js';

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

// ─── WASM ast-grep lazy init (only when AST rules are needed) ──
async function initAstGrepWasm(): Promise<void> {
  try {
    const mod = await import('@ast-grep/napi');
    if ('ensureInit' in mod && typeof mod.ensureInit === 'function') {
      await (mod as { ensureInit: () => Promise<void> }).ensureInit();
    }
  } catch (err) {
    if (process.env['TOTEM_DEBUG'] === '1' || process.argv.includes('--debug')) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Totem Debug] AST WASM init failed: ${msg}`);
    }
  }
}

// ─── Excluded command stub ──────────────────────────────────
function registerExcluded(name: string, description: string): void {
  program
    .command(name, { hidden: false })
    .description(`${description} [requires full install]`)
    .allowUnknownOption(true)
    .allowExcessArguments(true)
    .action(() => {
      console.error('[Totem Lite] This command requires the full Totem installation.');
      console.error(
        'The standalone binary includes only deterministic commands (lint, hooks, init, etc.).',
      );
      console.error('Install the full version: npm install -g @mmnto/cli');
      process.exitCode = 78;
    });
}

// ─── Program setup ──────────────────────────────────────────
const program = new Command();

program
  .name('totem')
  .description('Totem — deterministic governance for AI agents [Lite]')
  .version(__TOTEM_VERSION__)
  .option('--json', 'Output structured JSON to stdout')
  .configureHelp({
    formatHelp: (cmd, helper) => new TotemHelp().formatHelp(cmd, helper),
  });

// Set JSON mode early — preAction may not fire on parse errors
if (process.argv.includes('--json')) {
  process.env['TOTEM_JSON_OUTPUT'] = '1';
}

// ─── Included commands ──────────────────────────────────────

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
        const { initCommand } = await import('./commands/init.js');
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
        await initAstGrepWasm();
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
  .description('Show current project health (manifest, shield, rules)')
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
  .command('test')
  .description('Run test fixtures against compiled rules (TDD for governance rules)')
  .option('--filter <term>', 'Filter by rule hash or heading substring')
  .action(async (opts: { filter?: string }) => {
    try {
      await initAstGrepWasm();
      const { testRulesCommand } = await import('./commands/test-rules.js');
      await testRulesCommand(opts);
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
      await initAstGrepWasm();
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

// ─── Excluded commands (require LLM, LanceDB, or gh CLI) ──
registerExcluded('sync', 'Re-index project files into the local vector store');
registerExcluded('search <query>', 'Search the knowledge index');
registerExcluded('stats', 'Show index statistics');
registerExcluded('review', 'AI-powered code review');
registerExcluded('spec <inputs...>', 'Generate a pre-work spec briefing');
registerExcluded('handoff', 'Generate an end-of-session handoff snapshot');
registerExcluded('triage-pr <pr-number>', 'Categorized triage view of bot review comments');
registerExcluded('triage', 'Prioritize open issues into an active work roadmap');
registerExcluded('check', 'Run lint + review sequentially');
registerExcluded('wrap <pr-numbers...>', 'Post-merge workflow: learn from PR(s)');
registerExcluded('docs [paths...]', 'Auto-update registered project docs');
registerExcluded('review-learn <pr-number>', 'Extract lessons from resolved bot review comments');
registerExcluded('extract [pr-numbers...]', 'Extract lessons from PR review(s)');
registerExcluded('link <path>', 'Link a neighboring repo into this project');

// Excluded lesson subcommands (require LLM)
lessonCmd
  .command('extract [pr-numbers...]')
  .description('Extract lessons from PR review(s) [requires full install]')
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .action(() => {
    console.error('[Totem Lite] This command requires the full Totem installation.');
    console.error(
      'The standalone binary includes only deterministic commands (lint, hooks, init, etc.).',
    );
    console.error('Install the full version: npm install -g @mmnto/cli');
    process.exitCode = 78;
  });

lessonCmd
  .command('compile')
  .description('Compile lessons into deterministic regex rules [requires full install]')
  .allowUnknownOption(true)
  .allowExcessArguments(true)
  .action(() => {
    console.error('[Totem Lite] This command requires the full Totem installation.');
    console.error(
      'The standalone binary includes only deterministic commands (lint, hooks, init, etc.).',
    );
    console.error('Install the full version: npm install -g @mmnto/cli');
    process.exitCode = 78;
  });

// ─── Parse and run ──────────────────────────────────────────
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
