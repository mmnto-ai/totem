#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

import { Command } from 'commander';
import { z } from 'zod';

import { initCommand } from './commands/init.js';
import { TOTEM_DESCRIPTION } from './description.js';
import { REVIEW_DIFF_TRUNCATION_THRESHOLD } from './git.js';
import { TotemHelp } from './help.js';
import { reapOrphanedTempFiles } from './utils.js';

const require = createRequire(import.meta.url);
const { version } = z.object({ version: z.string() }).parse(require('../package.json'));

// mmnto-ai/totem#2018 L1: when a foreign binary (ambient global) starts inside
// a project carrying its own @mmnto/cli, delegate to the project-local build
// BEFORE any command wiring — the wrong dependency tree must never get to run.
// Dynamic import per the CLI lazy-load convention; it still resolves eagerly
// here by design — delegation has to happen before everything else.
const { maybeReexecLocal } = await import('./reexec-local.js');
const reexecStatus = maybeReexecLocal({ selfVersion: version });
if (reexecStatus !== undefined) {
  process.exit(reexecStatus);
}

// Retrospect thresholds (mmnto-ai/totem#1713). Shared across option default,
// help text, and validation so they don't drift.
const RETROSPECT_DEFAULT_THRESHOLD = 5;
const RETROSPECT_MIN_THRESHOLD = 1;

// ECL outbox retention default (doctrine/ecl-discipline.md § 4.4) — help-text
// mirror only; the authoritative default lives in `commands/ecl-gc.ts`
// (lazy-loaded), so passing `retainDays: undefined` still resolves to it.
const DEFAULT_ECL_RETAIN_DAYS = 14;

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

// Root-help tier state (mmnto-ai/totem#2336 D2). Mutated before help renders
// (the `--help` option path precomputes below; the `help` command action sets
// it directly) and read back by the configured formatHelp via this closure —
// the bridge between commander's SYNCHRONOUS help render and the ASYNC freeze
// read that derives the `[frozen]` badge.
const helpState: { all: boolean; freezeActive: boolean } = { all: false, freezeActive: false };

program
  .name('totem')
  .description(TOTEM_DESCRIPTION)
  .version(version)
  .option('--json', 'Output structured JSON to stdout')
  // Disable commander's built-in help command so our tiered `help [command...]
  // --all` command (registered below) owns `totem help`.
  .helpCommand(false)
  .configureHelp({
    formatHelp: (cmd, helper) =>
      new TotemHelp({ all: helpState.all, freezeActive: helpState.freezeActive }).formatHelp(
        cmd,
        helper,
      ),
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
  .option(
    '--force-skill-refresh',
    'Force-overwrite skill files lacking canonical markers (may destroy user content; review the diff after)',
  )
  .option(
    '--gates <list>',
    'Install action-gate PreToolUse hooks: a comma-list of gate names (e.g. freeze-check) or "all"',
  )
  .option(
    '--doctrine',
    'Wire orient.parityManifest to the installed @mmnto/strategy-doctrine pin (no-op until the pin is added)',
  )
  .action(
    async (options: {
      bare?: boolean;
      pilot?: boolean;
      strict?: boolean;
      global?: boolean;
      forceSkillRefresh?: boolean;
      gates?: string;
      doctrine?: boolean;
    }) => {
      try {
        await initCommand({
          bare: options.bare,
          pilot: options.pilot,
          strict: options.strict,
          global: options.global,
          forceSkillRefresh: options.forceSkillRefresh,
          gates: options.gates,
          doctrine: options.doctrine,
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
  .option(
    '--packs-only',
    'Run only the deterministic pack manifest write (no API key required); skips embedding sync, prune, and the global registry update (mmnto-ai/totem#1811)',
  )
  .option(
    '--index-only',
    'Run only the embedding sync; skip the pack manifest write (use when installed-packs.json is already current)',
  )
  .option('-q, --quiet', 'Suppress output (for background/hook usage)')
  .action(
    async (opts: {
      full?: boolean;
      incremental?: boolean;
      prune?: boolean;
      packsOnly?: boolean;
      indexOnly?: boolean;
      quiet?: boolean;
    }) => {
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
  .option(
    '--pattern-recurrence',
    'Cluster bot-review findings + trap-ledger overrides across the most recent merged PRs and write .totem/recurrence-stats.json (mmnto-ai/totem#1715)',
  )
  .option(
    '--threshold <n>',
    'Recurrence mode: minimum occurrences for a pattern to land in the headline output (default: 5)',
    '5',
  )
  .option(
    '--history-depth <n>',
    'Recurrence mode: number of recent merged PRs to scan (default: 50, capped at 200)',
    '50',
  )
  .option(
    '--yes',
    'Recurrence mode: auto-confirm overwrite when an existing recurrence-stats.json is newer',
  )
  .addHelpText(
    'after',
    [
      '',
      'Recurrence mode (--pattern-recurrence):',
      '  Fetches bot-review findings across the most recent merged PRs (default 50,',
      '  capped at 200 via --history-depth) plus trap-ledger override events,',
      '  clusters them by a normalized signature, filters out clusters covered by',
      '  existing compiled rules (Jaccard >= 0.6 on rule message), and writes the',
      '  surviving patterns at-or-above --threshold to .totem/recurrence-stats.json.',
      '  Requires the GitHub CLI (`gh`) authenticated against the current repo.',
      '',
    ].join('\n'),
  )
  .action(
    async (opts: {
      patternRecurrence?: boolean;
      threshold?: string;
      historyDepth?: string;
      yes?: boolean;
    }) => {
      try {
        const threshold = opts.threshold ? parseInt(opts.threshold, 10) : undefined;
        const historyDepth = opts.historyDepth ? parseInt(opts.historyDepth, 10) : undefined;
        if (opts.patternRecurrence) {
          requireGhCli();
        }
        const { statsCommand } = await import('./commands/stats.js');
        await statsCommand({
          patternRecurrence: opts.patternRecurrence,
          threshold,
          historyDepth,
          yes: opts.yes,
        });
      } catch (err) {
        handleError(err); // handleError returns `never`; unreachable throw below satisfies the fail-loud check
        throw err;
      }
    },
  );

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
  .option(
    '--out <path>',
    'Write output to a specific file (overrides default .totem/specs/<topic>.md)',
  )
  .option(
    '--stdout',
    'Print to stdout instead of saving to .totem/specs/<topic>.md (mutually exclusive with --out)',
  )
  .option('--model <name>', 'Override the default model for the orchestrator')
  .option('--fresh', 'Bypass cache and force a fresh LLM call (ignores cached responses)')
  .action(
    async (
      inputs: string[],
      opts: { raw?: boolean; out?: string; stdout?: boolean; model?: string; fresh?: boolean },
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
    '--branch',
    'Force the branch-vs-base diff scope the pre-push gate checks, regardless of working-tree state (mutually exclusive with --staged)',
  )
  .option(
    '--base <ref>',
    'Base branch for the push-gate scope (implies --branch; resolved as origin/<ref>...HEAD, else local <ref>)',
  )
  .option(
    '--pr-comment [number]',
    'Post a summary comment on a PR (auto-infers number in GitHub Actions)',
  )
  .option(
    '--timeout-mode <mode>',
    'Regex timeout mode: strict (default, fail CI on timeout) or lenient (skip timing-out rules with warning)',
  )
  .option(
    '--ast-parse-mode <mode>',
    'AST parse failure mode: strict (default, fail CI on parse error) or lenient (skip all AST rules with warning). Env: TOTEM_LINT_AST_PARSE_MODE. Operator escape for mmnto-ai/totem#1786 gap.',
  )
  .action(
    async (opts: {
      out?: string;
      format?: string;
      staged?: boolean;
      branch?: boolean;
      base?: string;
      prComment?: string | true;
      timeoutMode?: string;
      astParseMode?: string;
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
        if (
          opts.astParseMode &&
          opts.astParseMode !== 'strict' &&
          opts.astParseMode !== 'lenient'
        ) {
          const { TotemConfigError } = await import('@mmnto/totem');
          throw new TotemConfigError(
            `Invalid --ast-parse-mode "${opts.astParseMode}". Use "strict" or "lenient".`,
            "Run 'totem lint --help' for valid options.",
            'CONFIG_INVALID',
          );
        }
        await lintCommand({
          ...opts,
          format: opts.format as 'text' | 'sarif' | 'json' | undefined,
          prComment,
          timeoutMode: opts.timeoutMode as 'strict' | 'lenient' | undefined,
          astParseMode: opts.astParseMode as 'strict' | 'lenient' | undefined,
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
    .option(
      '--branch',
      'Force the branch-vs-base diff scope the pre-push gate checks, regardless of working-tree state (mutually exclusive with --staged and --diff)',
    )
    .option(
      '--base <ref>',
      'Base branch for the push-gate scope (implies --branch; resolved as origin/<ref>...HEAD, else local <ref>)',
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
    .option(
      '--estimate',
      'Pre-flight deterministic-rule estimator (zero-LLM). Runs compiled-rules.json against the diff and prints predicted findings tagged [Estimate]. Bypasses the LLM Verification Layer entirely. Incompatible with --learn, --auto-capture, --override, --suppress, --fresh, --mode, and --raw.',
    )
    .option(
      '--no-history',
      'Pattern-history overlay (effective only with --estimate). On by default; pass --no-history to skip the overlay even when .totem/recurrence-stats.json is present. No effect on the LLM review path.',
    )
    .option(
      '--continues <hash>',
      'Explicit round-chain link for the multi-lane review fan (review.lanes): the prior verdict artifact hash this round continues. A lineage mismatch warns and proceeds. Ignored unless review.lanes is configured and --model is absent.',
    )
    .option(
      '--fail-on <severity>',
      'Multi-lane fan (review.lanes) exit gate: "critical" or "warn". When set, the fan exits non-zero (SHIELD_FAILED) on findings at/above that severity OR a non-cache-eligible round; --override converts the failure to a pass. Omit for the default sensor exit 0. Ignored on the legacy single-lane path.',
    )
    .option(
      '--covariate',
      'Read-only, zero-LLM: resolve the current review lineage (same resolution as the fan), load its latest verdict artifact, and print the canonical local-lane covariate line to stdout. No verdict for the lineage prints a loud sensor message; always exits 0. Writes nothing.',
    )
    .addHelpText(
      'after',
      [
        '',
        'Multi-lane fan (review.lanes configured):',
        '  Each configured provider:model lane reviews the same masked diff and',
        '  converges on a verdict artifact (.totem/artifacts/verdicts/). An explicit',
        '  --model selects a ONE-lane invocation and NEVER joins or overrides the',
        '  configured fan (precedence pinned). --continues <hash> links the round chain.',
        '',
        'Diff resolution (when --diff and --branch/--base are omitted):',
        '  1. --staged          → staged-only diff',
        '  2. (default)         → working-tree diff (all uncommitted)',
        '  3. (fallback)        → branch-vs-base diff when 1/2 produce nothing',
        '--branch (or --base <ref>) forces scope 3 — the exact diff the pre-push',
        'gate checks — regardless of working-tree state (mmnto-ai/totem#2091).',
        `The chosen path is logged to stderr; large diffs (>${REVIEW_DIFF_TRUNCATION_THRESHOLD} chars)`,
        'trigger an explicit truncation warning before the LLM call.',
        '',
        'Pre-flight estimator (--estimate):',
        '  Runs the same deterministic engine as `totem lint` against the diff',
        '  resolved by the chain above and returns immediately — no orchestrator,',
        '  no embedding, no LanceDB. Output is labeled [Estimate] (not [Review])',
        '  so log lines unmistakably read as a forecast. Use this to predict bot',
        '  findings before opening a PR. Example:',
        // totem-context: documented git-range example in --help text for users of --diff, not a hardcoded base-branch reference in product code
        '    totem review --estimate --diff main...HEAD',
        '',
        'Pattern-history layer (default on with --estimate; opt out via --no-history):',
        '  After the deterministic pass, the estimator reads',
        '  .totem/recurrence-stats.json (mmnto-ai/totem#1715 substrate) and emits a',
        '  separate stanza listing historically recurring patterns whose tokens',
        '  are present in the diff additions above a containment threshold of 0.4.',
        '  Patterns already covered by a compiled rule are skipped; missing or',
        '  malformed substrate degrades gracefully with a single hint line.',
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
  branch?: boolean;
  base?: string;
  deterministic?: boolean;
  format?: string;
  mode?: string;
  learn?: boolean;
  yes?: boolean;
  override?: string;
  suppress?: string[];
  autoCapture?: boolean;
  estimate?: boolean;
  history?: boolean;
  continues?: string;
  failOn?: string;
  covariate?: boolean;
}): Promise<void> {
  // Redirect removed --deterministic flag to totem lint
  if (opts.deterministic) {
    console.error('[Review] --deterministic has been removed. Redirecting to `totem lint`.');
    const { lintCommand } = await import('./commands/lint.js');
    await lintCommand({
      format: (opts.format as 'text' | 'sarif' | 'json') ?? 'text',
      staged: opts.staged,
      branch: opts.branch,
      base: opts.base,
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
    // Validated inside shieldCommand (Gate G5) — a bad value is a hard CONFIG_INVALID.
    failOn: opts.failOn as 'critical' | 'warn' | undefined,
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

// Grounded run artifacts (mmnto-ai/totem#2100): thin verbs over the
// rerun/compare primitives — JSON out, no interactivity.
const artifactCommand = program
  .command('artifact')
  .description('Inspect grounded run artifacts (.totem/artifacts/runs/)');

artifactCommand
  .command('rerun <hash>')
  .description(
    'Re-invoke a recorded run with its exact stored bundle + backend (emits a new artifact)',
  )
  .action(async (hash: string) => {
    try {
      const { artifactRerunCommand } = await import('./commands/artifact.js');
      await artifactRerunCommand(hash);
      // totem-context: handleError is the CLI error boundary (returns `never` — prints + process.exit), identical to every sibling command action in this file; nothing is swallowed.
    } catch (err) {
      handleError(err);
    }
  });

artifactCommand
  .command('compare <hashA> <hashB>')
  .description('Deterministic artifact-vs-artifact diff (structural equality + metric deltas)')
  .action(async (hashA: string, hashB: string) => {
    try {
      const { artifactCompareCommand } = await import('./commands/artifact.js');
      await artifactCompareCommand(hashA, hashB);
      // totem-context: handleError is the CLI error boundary (returns `never` — prints + process.exit), identical to every sibling command action in this file; nothing is swallowed.
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
  .command('retrospect <pr-number>')
  .description(
    'Bot-tax circuit-breaker — push-grouped review-round retrospective with route-out heuristics (mmnto-ai/totem#1713)',
  )
  .option(
    '--threshold <n>',
    `Minimum bot-review round count to render the report (default: ${RETROSPECT_DEFAULT_THRESHOLD})`,
    String(RETROSPECT_DEFAULT_THRESHOLD),
  )
  .option('--force', 'Bypass the threshold gate and render even if rounds < threshold')
  .option('--out <path>', 'Write the JSON report to a file (deterministic two-space indent)')
  // totem-context: --auto-file is intentionally NOT exposed in v0.1 per
  // .totem/specs/1713.md Q2 — mass-filing follow-up issues is irreversible
  // and the human can copy-paste the suggested titles + bodies. Re-add via a
  // follow-up ticket.
  .addHelpText(
    'after',
    [
      '',
      'Reads PR review history live, groups findings into push-based rounds via',
      "each review submission's commit_id, enriches findings with cross-PR",
      'recurrence + rule-coverage flags from .totem/recurrence-stats.json and',
      '.totem/compiled-rules.json (read-only; both are graceful-degrade), and',
      'classifies each finding as route-out / in-pr-fix / undetermined via a',
      'deterministic table. No LLM. No GitHub API writes. Sub-threshold runs',
      'exit 0 (pass --force to inspect anyway).',
      '',
      'Requires the GitHub CLI (`gh`) authenticated against the current repo.',
      '',
    ].join('\n'),
  )
  .action(async (prNumber: string, opts: { threshold?: string; force?: boolean; out?: string }) => {
    requireGhCli();
    try {
      // Strict integer parse — `parseInt` accepts trailing non-numerics
      // ("5foo" → 5). Per GCA mmnto-ai/totem#1734 review-1.
      let threshold: number | undefined;
      if (opts.threshold !== undefined) {
        const n = Number(opts.threshold);
        if (!Number.isInteger(n) || n < RETROSPECT_MIN_THRESHOLD) {
          const { TotemConfigError } = await import('@mmnto/totem');
          throw new TotemConfigError(
            `Invalid --threshold value: ${opts.threshold}`,
            `Pass an integer >= ${RETROSPECT_MIN_THRESHOLD} (e.g. '--threshold ${RETROSPECT_DEFAULT_THRESHOLD}').`,
            'CONFIG_INVALID',
          );
        }
        threshold = n;
      }
      const { runRetrospect } = await import('./commands/retrospect.js');
      await runRetrospect({
        prNumber,
        threshold,
        force: opts.force,
        out: opts.out,
      });
    } catch (err) {
      handleError(err);
      // totem-context: handleError returns `never` (process.exit), so the throw is unreachable but required to satisfy the Tenet 4 fail-loud rule that bans bare-catch silent-degrade. Mirrors the stats command at line ~192.
      throw err;
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
  .command('orient')
  .description(
    'Derive session orientation from primitives (open PRs/issues/board/freeze) — zero LLM',
  )
  .option('--json', 'Output the OrientReport as structured JSON')
  .option(
    '--session',
    'Emit the bounded session-orientation block for a SessionStart hook (boot-safe; empty when nothing high-signal)',
  )
  .action(async (opts: { json?: boolean; session?: boolean }) => {
    // Session-render mode runs INSIDE a SessionStart hook and must never hard-fail
    // the boot: skip the hard `gh` gate. A missing/unauthenticated gh then degrades
    // to per-section `⚠ could not derive` lines via renderOrientForSession (or an
    // omitted block), never a process.exit(1) that would surface an error banner in
    // the consumer's session context.
    if (!opts.session) requireGhCli();
    try {
      const { orientCommand } = await import('./commands/orient.js');
      await orientCommand(opts);
    } catch (err) {
      handleError(err);
      // totem-context: handleError returns `never` (process.exit), so the throw is unreachable but required to satisfy the Tenet 4 fail-loud rule that bans bare-catch silent-degrade. Mirrors the mail/verify-badges pattern.
      throw err;
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

// Canonical cross-repo outbox poll (mmnto-ai/totem#1970; ADR-106 § 3 / ADR-107).
// Replaces ad-hoc per-hook implementations with one cohort-portable surface.
// `send`/`reply` subcommands (mmnto-ai/totem#2042) are the actuator half;
// registering them also closes the silent fall-through trap — Commander now
// rejects `totem mail <unknown>` instead of running the read as a no-op.
const mailCmd = program
  .command('mail')
  .description('Show unread cross-repo mail addressed to this repo’s agent(s) (ADR-106 § 3)')
  .option('--json', 'Emit JSON to stdout instead of human-readable text to stderr')
  .option(
    '--recursive',
    'Walk the workspace recursively for nested layouts (default: single-level siblings)',
  )
  .option(
    '--workspace <path>',
    'Workspace dir to scan (default: $TOTEM_WORKSPACE, else parent of cwd)',
  )
  .action(
    async (_opts: { json?: boolean; recursive?: boolean; workspace?: string }, cmd: Command) => {
      try {
        const { mailCommand } = await import('./commands/mail.js');
        // The program-level `--json` (top of file) swallows the flag when it
        // appears after the subcommand (commander parent/child option collision,
        // mmnto-ai/totem#2097): the value lands on program.opts() and the action
        // receives {}. optsWithGlobals() merges both scopes so `totem mail --json`
        // and `totem --json mail` agree. Typed destructure so a future global
        // option can't silently shadow a MailCommandOptions field.
        const { json, recursive, workspace } = cmd.optsWithGlobals<{
          json?: boolean;
          recursive?: boolean;
          workspace?: string;
        }>();
        // Custom exit-code contract (mmnto-ai/totem#2312): pollMail never throws,
        // so the wrapper returns the code and we set process.exitCode (never
        // process.exit mid-flow — same pattern as the ecl-gc action). Exit 2 when
        // no self agent resolves: the verdict is NOT DERIVED, not a clean inbox.
        const { exitCode } = await mailCommand({ json, recursive, workspace });
        if (exitCode !== 0) process.exitCode = exitCode;
      } catch (err) {
        handleError(err);
        // totem-context: handleError returns `never` (process.exit), so the throw is unreachable but required to satisfy the Tenet 4 fail-loud rule that bans bare-catch silent-degrade. Mirrors the verify-badges pattern above.
        throw err;
      }
    },
  );

mailCmd
  .command('send')
  .description(
    'Compose + write a validated ADR-098 v0.4 dispatch to your outbox (mmnto-ai/totem#2042)',
  )
  .requiredOption('--to <agent>', 'Recipient agent-id (or "broadcast")')
  .requiredOption('--subject <text>', 'Subject line')
  .option('--from <agent>', 'Sender agent-id (default: resolved self; required if ambiguous)')
  .option('--body-file <path>', 'Read the dispatch body from this file')
  .option('--in-reply-to <path>', 'Source dispatch path this replies to')
  .option('--priority <level>', 'priority: frontmatter value')
  .option('--related <refs...>', 'related-issues: frontmatter refs')
  .option('--expected-action <text>', 'expected-action: frontmatter (default: none)')
  .option('--slug <slug>', 'Filename slug override (default: derived from subject)')
  .option(
    '--workspace <path>',
    'Workspace for dir-derived recipient validation (default: $TOTEM_WORKSPACE, else parent of cwd)',
  )
  .action(
    async (opts: {
      to: string;
      subject: string;
      from?: string;
      bodyFile?: string;
      inReplyTo?: string;
      priority?: string;
      related?: string[];
      expectedAction?: string;
      slug?: string;
      workspace?: string;
    }) => {
      try {
        const { mailSend, mailSendCommand } = await import('./commands/mail.js');
        await mailSendCommand(mailSend(opts));
        // totem-context: handleError is the CLI error boundary (returns `never` — prints + process.exit), identical to every sibling command action; nothing is swallowed.
      } catch (err) {
        handleError(err);
      }
    },
  );

mailCmd
  .command('reply <source>')
  .description(
    'Reply to a dispatch — infers recipient + subject from the source (mmnto-ai/totem#2042)',
  )
  .option('--from <agent>', 'Sender agent-id (default: resolved self; required if ambiguous)')
  .option('--body-file <path>', 'Read the reply body from this file')
  .option('--subject <text>', 'Override the inferred "Re: …" subject')
  .option('--to <agent>', 'Override the inferred recipient')
  .option('--priority <level>', 'priority: frontmatter value')
  .option('--related <refs...>', 'related-issues: frontmatter refs')
  .option('--expected-action <text>', 'expected-action: frontmatter (default: none)')
  .option(
    '--workspace <path>',
    'Workspace for dir-derived recipient validation (default: $TOTEM_WORKSPACE, else parent of cwd)',
  )
  .option(
    '--no-mark',
    'Do NOT mark the source dispatch processed (stage-only reply; default marks it — ADR-106 § A1.4)',
  )
  .action(
    async (
      source: string,
      opts: {
        from?: string;
        bodyFile?: string;
        subject?: string;
        to?: string;
        priority?: string;
        related?: string[];
        expectedAction?: string;
        workspace?: string;
        // Commander `--no-mark` sets `mark: false`; absent ⇒ `true` (default).
        mark?: boolean;
      },
    ) => {
      try {
        const { mailReply, mailSendCommand } = await import('./commands/mail.js');
        // Translate the Commander boolean-negation flag into the lib's opt-out
        // and keep `mark` out of the spread (mmnto-ai/totem#2396).
        const { mark, ...rest } = opts;
        await mailSendCommand(mailReply(source, { ...rest, noMark: mark === false }));
        // totem-context: handleError is the CLI error boundary (returns `never` — prints + process.exit), identical to every sibling command action; nothing is swallowed.
      } catch (err) {
        handleError(err);
      }
    },
  );

mailCmd
  .command('mark <source>')
  .description(
    'Mark a consumed dispatch processed in your OWN processed/ cursor — consume-without-reply (ADR-106 § A1.4; mmnto-ai/totem#2396)',
  )
  .option(
    '--agent-id <id>',
    'Seat whose processed/ cursor to mark into (default: resolved self; required if ambiguous — same self-resolving discipline as ecl-gc)',
  )
  .action(async (source: string, opts: { agentId?: string }) => {
    try {
      const { markSource, mailMarkCommand } = await import('./commands/mail.js');
      await mailMarkCommand(markSource(source, opts));
      // totem-context: handleError is the CLI error boundary (returns `never` — prints + process.exit), identical to every sibling command action; nothing is swallowed.
    } catch (err) {
      handleError(err);
    }
  });

// ECL outbox retention prune (mmnto-ai/totem#2279; parent mmnto-ai/totem-strategy#700;
// doctrine/ecl-discipline.md § 4.4). The binary-guaranteed cohort-wide replacement
// for `scripts/prune-outbox.mjs` — self-resolves the caller's agent so a seat can
// only ever prune its OWN `<repoRoot>/.totem/orchestration/<agent>/outbox/`, never a
// peer's, never journal/ or processed/. Dry-run by default; --apply deletes.
program
  .command('ecl-gc')
  .description(
    'Prune your own aged ECL outbox dispatches; with --compact, also compact your processed-mark cursor (self-resolving; dry-run unless --apply)',
  )
  .option('--apply', 'Actually delete aged dispatches (default: dry-run — list only)')
  .option(
    '--retain-days <n>',
    `Retention window in days (default ${DEFAULT_ECL_RETAIN_DAYS}; doctrine § 4.4)`,
  )
  .option(
    '--agent-id <id>',
    'Override the self-resolved agent whose outbox/cursor to gc (visiting/orchestrator case)',
  )
  .option(
    '--compact',
    'Also compact your processed-mark cursor (ADR-106 § A2 / ecl-discipline § 4.5): delete marks whose inbound dispatch its sender already swept — runs AFTER the prune',
  )
  .option(
    '--force-incomplete',
    'UNSAFE: proceed with compaction even when a declared cohort repo is absent from the workspace (waives only the roster-presence gate; scan warnings/truncation still abort)',
  )
  .option('--json', 'Emit the structured result as JSON to stdout instead of human text')
  .action(
    async (
      _opts: {
        apply?: boolean;
        retainDays?: string;
        agentId?: string;
        compact?: boolean;
        forceIncomplete?: boolean;
        json?: boolean;
      },
      cmd: Command,
    ) => {
      // optsWithGlobals() merges the program-level `--json` (top of file) with the
      // subcommand scope, same collision fix as `mail` (mmnto-ai/totem#2097).
      const { apply, retainDays, agentId, compact, forceIncomplete, json } = cmd.optsWithGlobals<{
        apply?: boolean;
        retainDays?: string;
        agentId?: string;
        compact?: boolean;
        forceIncomplete?: boolean;
        json?: boolean;
      }>();
      // Custom exit-code contract (AGENTS.md: throw in lib, wrapper decides exit).
      // eclGc/eclCompact throw ONLY on usage errors (self-resolution failure,
      // invalid --retain-days); fs failures land in structured results, never
      // thrown. Combined precedence (codex panel, mmnto-ai/totem#2307):
      //   2 = usage error (thrown; before any mutation)
      //   3 = compaction ABORT — A2.2 gate red OR A2.4 falsifier tripped
      //   1 = partial janitorial delete failure (prune or compact)
      //   0 = clean.
      // 3 outranks 1: a prune-partial + compact-abort exits 3, prune count still
      // reported in the structured result. We do NOT call handleError (it exits
      // 1, colliding with the sensor codes). (Custom-exit precedent: index-lite.ts 78.)
      try {
        const {
          eclGc,
          eclGcCommand,
          eclCompact,
          eclCompactCommand,
          loadEclConfig,
          resolveEclGcExitCode,
        } = await import('./commands/ecl-gc.js');
        const pruneResult = eclGc({
          apply,
          retainDays: retainDays !== undefined ? Number(retainDays) : undefined,
          agentId,
        });
        // Compaction runs AFTER the prune (ecl-discipline § 4.5). A seat's own
        // prune shrinks PEERS' inbound, not its own marks, so ordering is
        // independent — but the doctrine sequences them within /signoff.
        let compactResult: ReturnType<typeof eclCompact> | undefined;
        if (compact === true) {
          // Resolve the A2.2 completeness roster from consumer config
          // (`ecl.cohortRepos`, mmnto-ai/totem#2310) at this process boundary and
          // inject it. A MISSING config ⇒ undefined ⇒ the gate's undeclared
          // hard-abort (exit 3). A PRESENT-but-INVALID config (e.g. an empty
          // roster) throws here and is caught below as a usage error (exit 2,
          // loud) — never silently degraded into the undeclared arm.
          const config = await loadEclConfig(process.cwd());
          compactResult = eclCompact({ apply, agentId, forceIncomplete, config });
        }
        if (json === true && compactResult !== undefined) {
          // Single combined document so a --json consumer parses one object
          // rather than two concatenated JSON blobs. NOTE (greptile): under
          // --json the human-readable A2.4/failure alerts (normally logged to
          // stderr by eclCompactCommand) are intentionally omitted — the data is
          // in the payload (`resurfaced`/`failed`/`verifyComplete`) and the exit
          // code still fires, matching the prune-only --json path's contract.
          process.stdout.write(
            JSON.stringify({ prune: pruneResult, compact: compactResult }, null, 2) + '\n',
          );
        } else {
          await eclGcCommand(pruneResult, json === true);
          if (compactResult !== undefined) await eclCompactCommand(compactResult, false);
        }
        const code = resolveEclGcExitCode(pruneResult, compactResult);
        if (code !== 0) process.exitCode = code;
        // totem-context: the catch below is the deliberate CLI exit-code boundary, not a silent swallow — eclGc/eclCompact throw ONLY usage errors, printed LOUDLY via log.error and mapped to exit 2 (handleError is intentionally NOT used here: it exits 1, colliding with the janitorial sensor code).
      } catch (err) {
        const { log } = await import('./ui.js');
        log.error('Totem Error', err instanceof Error ? err.message : String(err));
        process.exitCode = 2;
      }
    },
  );

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
  .option(
    '--allow-compile-drift',
    'Override compile-worker fingerprint drift. CI requires a `## Compile Drift Justification` heading in the PR body; pre-push without an open PR requires TOTEM_DRIFT_JUSTIFICATION env var to be set.',
  )
  .action(async (options: { allowCompileDrift?: boolean }) => {
    try {
      const { verifyManifestCommand } = await import('./commands/verify-manifest.js');
      await verifyManifestCommand({ allowCompileDrift: options.allowCompileDrift });
    } catch (err) {
      handleError(err);
    }
  });

program
  .command('verify-badges')
  .description('Verify shields.io badges in README.md (deterministic claim-discipline gate)')
  .action(async () => {
    try {
      const { verifyBadgesCliCommand } = await import('./commands/verify-badges.js');
      await verifyBadgesCliCommand();
    } catch (err) {
      handleError(err);
      // totem-context: handleError returns `never` (process.exit), so the throw is unreachable but required to satisfy the Tenet 4 fail-loud rule that bans bare-catch silent-degrade. Mirrors the stats command pattern.
      throw err;
    }
  });

program
  .command('verify-lockfile-sync')
  .description(
    'Verify pnpm-lock.yaml is in the diff range when a package.json adds a dependency pin (cohort-sync gate, mmnto-ai/totem#1961)',
  )
  .action(async () => {
    try {
      const { verifyLockfileSyncCliCommand } = await import('./commands/verify-lockfile-sync.js');
      await verifyLockfileSyncCliCommand();
    } catch (err) {
      handleError(err);
      // totem-context: handleError returns `never` (process.exit), so the throw is unreachable but required to satisfy the Tenet 4 fail-loud rule that bans bare-catch silent-degrade. Mirrors the verify-badges pattern above.
      throw err;
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
      handleError(err); // handleError returns `never`; unreachable throw below satisfies the fail-loud check
      throw err;
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
  .command('hooks', { hidden: true })
  .description('Deprecated alias for `totem hook install`')
  .option('--check', 'Verify hooks are installed (exit 1 if missing)')
  .option('-f, --force', 'Force overwrite existing hooks')
  .option('--strict', 'Use strict enforcement tier (spec-required + review gate)')
  .option('--standard', 'Use standard enforcement tier (default)')
  .action(
    async (opts: { check?: boolean; force?: boolean; strict?: boolean; standard?: boolean }) => {
      try {
        console.error("⚠ 'totem hooks' is deprecated. Use 'totem hook install' instead.");
        const { hooksCommand } = await import('./commands/install-hooks.js');
        await hooksCommand(opts);
      } catch (err) {
        handleError(err); // handleError returns `never`; unreachable throw below satisfies the fail-loud check
        throw err;
      }
    },
  );

program
  .command('doctor')
  .description('Run workspace health diagnostics')
  .option('--pr', 'Auto-downgrade noisy rules and open a PR')
  .option(
    '--strict [tier]',
    'Exit non-zero on fail-class diagnostics (gating mode for hooks / CI); --strict=warn also gates on warn-class diagnostics — the machine-checkable all-wiring oracle (mmnto-ai/totem#2385)',
  )
  .option(
    '--claim-discipline',
    'Run only the WWND claim-discipline checks against public surfaces (Proposal 279)',
  )
  .option(
    '--scope-to-diff',
    'Narrow --claim-discipline scan to files in the current push diff (mmnto-ai/totem#2002 — prevents pre-existing standing-gate warnings from firing on unrelated diffs)',
  )
  .option(
    '--parity',
    'Run only the parity-drift sensor against the cohort parity manifest (mmnto-ai/totem-strategy#448)',
  )
  .option(
    '--compliance',
    'Run only the ADR-029 recall-compliance sensor (search-before-commit rate from .totem/.search-log.jsonl + git history). Sensor-only readout — never gates (mmnto-ai/totem#2362)',
  )
  .option(
    '--json',
    'With --parity: emit the trust-readout as a diffable JSON verdict artifact on stdout (mmnto-ai/totem#2327)',
  )
  .action(
    async (
      opts: {
        pr?: boolean;
        strict?: boolean | string;
        claimDiscipline?: boolean;
        scopeToDiff?: boolean;
        parity?: boolean;
        compliance?: boolean;
        json?: boolean;
      },
      cmd: Command,
    ) => {
      try {
        // The program-level `--json` (top of file) swallows the flag when it
        // appears after the subcommand (commander parent/child option collision,
        // mmnto-ai/totem#2097, same fix as `totem mail --json`): merge both
        // scopes so `totem doctor --parity --json` and `totem --json doctor
        // --parity` agree.
        opts.json = cmd.optsWithGlobals<{ json?: boolean }>().json;
        // Resolve the strict tier up front so an unknown `--strict=<tier>`
        // errors identically across every doctor mode (mmnto-ai/totem#2385).
        const { doctorCommand, doctorGateFailed, resolveStrictTier } =
          await import('./commands/doctor.js');
        const strictTier = await resolveStrictTier(opts.strict);
        const specializedModes = [
          opts.claimDiscipline && '--claim-discipline',
          opts.parity && '--parity',
          opts.compliance && '--compliance',
        ].filter((m): m is string => typeof m === 'string');
        if (specializedModes.length > 1) {
          const { TotemConfigError } = await import('@mmnto/totem');
          throw new TotemConfigError(
            `Cannot combine ${specializedModes.join(' with ')}.`,
            'Choose exactly one specialized doctor mode.',
          );
        }
        if (opts.json && !opts.parity) {
          const { TotemConfigError } = await import('@mmnto/totem');
          throw new TotemConfigError(
            '--json is the --parity trust-readout artifact (mmnto-ai/totem#2327).',
            'Run totem doctor --parity --json.',
          );
        }
        if (opts.claimDiscipline) {
          const { doctorClaimDisciplineCliCommand } =
            await import('./commands/doctor-claim-discipline.js');
          await doctorClaimDisciplineCliCommand({
            strict: strictTier !== undefined,
            scopeToDiff: opts.scopeToDiff,
          });
          return;
        }
        if (opts.parity) {
          const { doctorParityCliCommand } = await import('./commands/doctor-parity.js');
          await doctorParityCliCommand({ strict: strictTier !== undefined, json: opts.json });
          return;
        }
        if (opts.compliance) {
          // Sensor-only (Tenet 13): renders the ADR-029 recall-compliance
          // readout and returns. Never gates — no exit-code effect, so `--strict`
          // is intentionally not threaded here.
          const { doctorComplianceCliCommand } = await import('./commands/doctor-compliance.js');
          await doctorComplianceCliCommand();
          return;
        }
        const results = await doctorCommand(opts);
        if (strictTier && doctorGateFailed(results, strictTier)) {
          process.exitCode = 1;
        }
        // S0 (mmnto-ai/totem#2085, mmnto-ai/totem-strategy#545 Half 2): fold parity
        // into the strict suite. When a repo-local orient.parityManifest is configured,
        // `doctor --strict` also exercises the parity sensor — so consumer CI (which
        // runs `--strict`, not `--parity --strict`) is no longer green-by-not-checking.
        // `onlyWhenConfigured` makes it a no-op (no output, no throw) for repos that
        // never configured a manifest — zero churn for non-adopters. Per ADR-109 /
        // Tenet 13 the throw-gate lives here at the CLI edge, not inside the composable
        // doctorCommand. The `--parity` branch returned above, so this never double-runs.
        if (strictTier) {
          const { doctorParityCliCommand } = await import('./commands/doctor-parity.js');
          await doctorParityCliCommand({ strict: true, onlyWhenConfigured: true });
        }
        // totem-context: handleError() returns `never` (calls process.exit), so this catch terminates the process rather than silently swallowing — matches the CLI-entrypoint pattern used by every other commander action in this file.
      } catch (err) {
        handleError(err);
      }
    },
  );

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

// ─── Hook noun-verb subcommands (ADR-104 bot-pack wiring engine) ─────

const hookCmd = program
  .command('hook')
  .description('Hook engine — install git hooks, run PreToolUse rules, test fixtures');

hookCmd
  .command('install')
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
        handleError(err); // handleError returns `never`; unreachable throw below satisfies the fail-loud check
        throw err;
      }
    },
  );

hookCmd
  .command('run')
  .description(
    'Evaluate compiled-hooks against a tool-call payload (PreToolUse runtime entrypoint)',
  )
  .requiredOption('--tool <name>', 'Tool the agent is attempting to invoke (e.g. bash)')
  .requiredOption('--args <args>', 'Serialized tool arguments (passed as a single argv element)')
  .action(async (opts: { tool: string; args: string }) => {
    try {
      const { hookRunCommand } = await import('./commands/hook-run.js');
      await hookRunCommand(opts);
    } catch (err) {
      handleError(err); // handleError returns `never`; unreachable throw below satisfies the fail-loud check
      throw err;
    }
  });

hookCmd
  .command('test')
  .description('Run hook fixtures (surface: hooks) against compiled-hooks rules')
  .option('--filter <term>', 'Filter results by hook id substring')
  .action(async (opts: { filter?: string }) => {
    try {
      const { hookTestCommand } = await import('./commands/hook-test.js');
      await hookTestCommand(opts);
    } catch (err) {
      handleError(err); // handleError returns `never`; unreachable throw below satisfies the fail-loud check
      throw err;
    }
  });

// ─── Gate noun-verb subcommands (WS3 — action-gate engine) ───

const gateCmd = program
  .command('gate')
  .description('Gate engine — evaluate decidable predicates against deterministic state');

gateCmd
  .command('check')
  .description('Evaluate a gate predicate; emit a GateVerdict (allow|warn|deny) as JSON to stdout')
  .requiredOption('--event <type>', 'Gate event type (e.g. freeze-check)')
  .requiredOption('--payload <json>', 'Gate-specific JSON payload')
  .addHelpText(
    'after',
    `\nExample:\n  $ totem gate check --event freeze-check --payload '{"subsystem":"rule-compilation"}'\n`,
  )
  .action(async (opts: { event: string; payload: string }) => {
    try {
      const { gateCheckCommand } = await import('./commands/gate.js');
      await gateCheckCommand(opts);
    } catch (err) {
      handleError(err); // handleError returns `never`; unreachable throw below satisfies the fail-loud check
      throw err;
    }
  });

gateCmd
  .command('install [name]')
  .description('Install a gate PreToolUse hook into committed .claude/settings.json (idempotent)')
  .option('--all', 'Install every known gate (the knownGateEvents() registry)')
  .option(
    '--pilot',
    'Bake the advisory pilot tier into the installed command (deny → exit 0 + stderr). Default is strict (deny → exit 2).',
  )
  .option('--strict', 'Bake the strict enforcement tier (the default; deny → exit 2)')
  .addHelpText(
    'after',
    `\nExamples:\n  $ totem gate install --all\n  $ totem gate install freeze-check\n  $ totem gate install freeze-check --pilot\n`,
  )
  .action(
    async (
      name: string | undefined,
      opts: { all?: boolean; pilot?: boolean; strict?: boolean },
    ) => {
      try {
        const { gateInstallCommand } = await import('./commands/gate.js');
        await gateInstallCommand({ all: opts.all, name, pilot: opts.pilot, strict: opts.strict });
      } catch (err) {
        handleError(err); // handleError returns `never`; unreachable throw below satisfies the fail-loud check
        throw err;
      }
    },
  );

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
  .description('Compile lesson files into deterministic lint rules')
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

ruleCmd
  .command('author')
  .description(
    'Ingest .totem/spine/authored-rules.yaml into authored rules + the §8 authoring-ledger (ADR-112, strategy#591)',
  )
  .option(
    '--judged-by <id>',
    'Identity of the independent eligibility check recorded on each verdict',
  )
  .option(
    '--lc-dir <path>',
    'lc clone for the §5.4 author sandbox — REQUIRED when the splitRef names a frozen artifact (env: TOTEM_LC_DIR)',
    process.env['TOTEM_LC_DIR'],
  )
  .action(async (opts: { judgedBy?: string; lcDir?: string }) => {
    try {
      const { ruleAuthorCommand } = await import('./commands/rule-author.js');
      await ruleAuthorCommand(opts);
    } catch (err) {
      handleError(err);
      // handleError is `: never` (process.exit); the throw satisfies the Tenet-4
      // catch-body fail-loud ast-grep rule (see `rule promote` above).
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

// ─── Spine noun-verb subcommands (mmnto-ai/totem#2188) ──────────────────────

const spineCmd = program
  .command('spine')
  .description('Spine evidence harness — Gate-1 wind-tunnel evaluation');

const windtunnelCmd = spineCmd
  .command('windtunnel')
  .description('Gate-1 wind-tunnel: freeze corpus lock + run evidence harness');

windtunnelCmd
  .command('freeze')
  .description('Validate and freeze the wind-tunnel corpus lock (schema + S4 completeness)')
  .option(
    '--lc-dir <path>',
    'Path to the lc clone (env: TOTEM_LC_DIR)',
    process.env['TOTEM_LC_DIR'],
  )
  .option(
    '--lock-path <path>',
    'Override the lock file path (default: .totem/spine/gate-1/windtunnel.lock.json)',
  )
  .action(async (opts: { lcDir?: string; lockPath?: string }) => {
    try {
      const { freezeCommand } = await import('./commands/spine-windtunnel.js');
      await freezeCommand({ lcDir: opts.lcDir, lockPath: opts.lockPath });
    } catch (err) {
      handleError(err);
      throw err;
    }
  });

windtunnelCmd
  .command('run')
  .description('Run the wind-tunnel against the frozen corpus lock')
  .option(
    '--lc-dir <path>',
    'Path to the lc clone (env: TOTEM_LC_DIR)',
    process.env['TOTEM_LC_DIR'],
  )
  .option(
    '--lock-path <path>',
    'Override the lock file path (default: .totem/spine/gate-1/windtunnel.lock.json)',
  )
  .option('--phase <phase>', 'Required phase for this run (certifying rejects a harness lock, P1)')
  .action(async (opts: { lcDir?: string; lockPath?: string; phase?: string }) => {
    try {
      const { runCommand } = await import('./commands/spine-windtunnel.js');
      await runCommand({ lcDir: opts.lcDir, lockPath: opts.lockPath, phase: opts.phase });
    } catch (err) {
      handleError(err);
      throw err;
    }
  });

windtunnelCmd
  .command('record')
  .description('Record the frozen llm-replay.v1 fixture (live extract+classify) for replay (A2)')
  .option(
    '--lock-path <path>',
    'Override the lock file path (default: .totem/spine/gate-1/windtunnel.lock.json)',
  )
  .option('--provider <provider>', 'LLM provider for the live record run', 'anthropic')
  .requiredOption('--model <model>', 'LLM model id for the live record run (no safe default)')
  .option(
    '--seed-classes-provided',
    'Attest that seed classes were supplied to the live extract (fold-I FM-f). Default: false (seed-blind).',
    false,
  )
  .action(
    async (opts: {
      lockPath?: string;
      provider: string;
      model: string;
      seedClassesProvided?: boolean;
    }) => {
      try {
        const fsm = await import('node:fs');
        const { WindtunnelLockSchema } = await import('@mmnto/totem');
        const { recordCommand, buildLiveRecordDeps } =
          await import('./commands/spine-cert-record.js');
        const { loadEnv } = await import('./utils.js');
        const cwd = process.cwd();
        // #2237 papercut-1: load .env BEFORE buildLiveRecordDeps reads process.env
        // for the provider credential — the spine commands (unlike ~18 others) did
        // not loadEnv, so an `.env`-only ANTHROPIC_API_KEY fail-closed as "no
        // credential resolved" until exported manually.
        loadEnv(cwd);
        const lockPath = opts.lockPath ?? `${cwd}/.totem/spine/gate-1/windtunnel.lock.json`;
        const lock = WindtunnelLockSchema.parse(JSON.parse(fsm.readFileSync(lockPath, 'utf-8')));
        const deps = await buildLiveRecordDeps(lock, {
          provider: opts.provider,
          model: opts.model,
          cwd,
          totemVersion: version,
        });
        await recordCommand({
          lockPath: opts.lockPath,
          deps,
          seedClassesProvided: opts.seedClassesProvided,
        });
      } catch (err) {
        handleError(err);
        throw err;
      }
    },
  );

windtunnelCmd
  .command('materialize')
  .description(
    'Materialize the cert-run scoring corpus (lock + split + pr-diffs + control dirs) from a seed manifest + lc clone (strategy#709)',
  )
  .requiredOption('--manifest <path>', 'Path to the curated cert-corpus seed manifest (JSON)')
  .option(
    '--lc-dir <path>',
    'Path to the lc clone (env: TOTEM_LC_DIR)',
    process.env['TOTEM_LC_DIR'],
  )
  .option(
    '--out <dir>',
    'Override the gate-1 output dir (default: dirname of the seed canonicalPath, under the repo root)',
  )
  .action(async (opts: { manifest: string; lcDir?: string; out?: string }) => {
    try {
      const { materializeCommand } = await import('./commands/spine-cert-materialize.js');
      await materializeCommand({
        manifestPath: opts.manifest,
        lcDir: opts.lcDir,
        outDir: opts.out,
      });
    } catch (err) {
      handleError(err);
      throw err;
    }
  });

spineCmd
  .command('freeze-split')
  .description(
    'Freeze the pre-authoring split: derive the window from lc HEAD, stamp frozenAt, write the tamper-evident tracked artifact (ADR-112 §5.1/§8 R1)',
  )
  .requiredOption(
    '--params <path>',
    'Path to the curated freeze params (JSON, FreezeSplitParamsSchema)',
  )
  .option(
    '--lc-dir <path>',
    'Path to the lc clone (env: TOTEM_LC_DIR)',
    process.env['TOTEM_LC_DIR'],
  )
  .option(
    '--refreeze',
    'Explicitly authorize overwriting an existing frozen split (a re-freeze orphans every ledger entry chained to the old commitment)',
  )
  .action(async (opts: { params: string; lcDir?: string; refreeze?: boolean }) => {
    try {
      const { freezeSplitCommand } = await import('./commands/spine-freeze-split.js');
      await freezeSplitCommand({
        paramsPath: opts.params,
        lcDir: opts.lcDir,
        refreeze: opts.refreeze,
      });
    } catch (err) {
      handleError(err);
      throw err;
    }
  });

windtunnelCmd
  .command('fetch-dispositions')
  .description(
    'Freeze corpus-dispositions.json — the held-out PRs’ span-anchored review threads — and stamp corpusDispositionsSha (strategy#709, by-hand/live; never CI)',
  )
  .option(
    '--lock-path <path>',
    'Override the lock file path (default: .totem/spine/gate-1/windtunnel.lock.json)',
  )
  .option('--output-dir <dir>', 'Override the gate-1 output dir (default: the lock’s dir)')
  .action(async (opts: { lockPath?: string; outputDir?: string }) => {
    try {
      const { fetchDispositionsCommand } = await import('./commands/spine-fetch-dispositions.js');
      await fetchDispositionsCommand({ lockPath: opts.lockPath, outputDir: opts.outputDir });
    } catch (err) {
      handleError(err);
      throw err;
    }
  });

windtunnelCmd
  .command('derive-labels')
  .description(
    'Derive ground-truth-labels.json — the cert-run answer key (firingLabelId → TP|FP) — from the frozen dispositions, hard-gating corpusDispositionsSha and stamping groundTruthSha (strategy#709 5d-iii; by-hand/live, never CI)',
  )
  .option(
    '--lc-dir <path>',
    'Path to the lc clone (env: TOTEM_LC_DIR)',
    process.env['TOTEM_LC_DIR'],
  )
  .option(
    '--lock-path <path>',
    'Override the lock file path (default: .totem/spine/gate-1/windtunnel.lock.json)',
  )
  .option('--output-dir <dir>', 'Override the gate-1 output dir (default: the lock’s dir)')
  .action(async (opts: { lcDir?: string; lockPath?: string; outputDir?: string }) => {
    try {
      const { deriveLabelsCommand } = await import('./commands/spine-derive-labels.js');
      await deriveLabelsCommand({
        lcDir: opts.lcDir,
        lockPath: opts.lockPath,
        outputDir: opts.outputDir,
      });
    } catch (err) {
      handleError(err);
      throw err;
    }
  });

// Derive the `[frozen]` badge state for root help (mmnto-ai/totem#2336 D2.4)
// from the canonical freeze primitive. Only ever called on a help render, so
// ordinary commands never pay for the freeze read.
async function computeFreezeActive(): Promise<boolean> {
  const { deriveRuleCompilationFrozen } = await import('./help-freeze.js');
  return deriveRuleCompilationFrozen(process.cwd());
}

// Tiered help surface (mmnto-ai/totem#2336 D2). Replaces commander's built-in
// help command (disabled via .helpCommand(false)) so `totem help --all` renders
// the FULL command surface, tiered, while `totem help <command>` still delegates
// to the default per-command help. Bare `totem help` / `totem --help` show only
// the consumer tier plus the pointer to `--all` (partially addresses the
// progressive-disclosure ask in mmnto-ai/totem#1722; grouping is left to it).
program
  .command('help [command...]')
  .description('Show help; add --all for the full command surface (consumer + advanced tiers)')
  .option('--all', 'List every command, grouped into consumer and advanced tiers')
  .action(async (commandPath: string[], opts: { all?: boolean }) => {
    try {
      if (commandPath.length > 0) {
        let target: Command | undefined = program;
        for (const part of commandPath) {
          target = target?.commands.find((c) => c.name() === part);
        }
        if (target !== undefined && target !== program) {
          target.outputHelp();
          return;
        }
        const { TotemConfigError } = await import('@mmnto/totem');
        throw new TotemConfigError(
          `Unknown command: ${commandPath.join(' ')}`,
          "Run 'totem help --all' to list every command.",
          'CONFIG_INVALID',
        );
      }
      helpState.all = opts.all === true;
      helpState.freezeActive = await computeFreezeActive();
      program.outputHelp();
    } catch (err) {
      handleError(err);
      // handleError returns `never` (process.exit); the throw is unreachable but
      // required to satisfy the Tenet 4 fail-loud rule that bans bare-catch
      // silent-degrade. Mirrors the stats/mail command pattern in this file.
      throw err;
    }
  });

// Precompute root-help tier state for the `--help`/`-h` OPTION path (the `help`
// COMMAND path sets it in its own action above). `--all` is cheap to read
// always. The freeze read fires ONLY for ROOT help (`totem --help`), never for
// subcommand help (`totem lint --help`) — the badge renders only on the root
// surface, and gating on isRootHelpInvocation keeps a corrupt freeze.json from
// breaking unrelated `totem <command> --help`. A corrupt freeze on the root
// path still surfaces loudly via handleError (no fail-open).
helpState.all = process.argv.includes('--all');
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  const { isRootHelpInvocation } = await import('./help-freeze.js');
  if (isRootHelpInvocation(process.argv.slice(2))) {
    try {
      helpState.freezeActive = await computeFreezeActive();
    } catch (err) {
      handleError(err);
      // handleError returns `never` (process.exit); the throw is unreachable
      // but required to satisfy the Tenet 4 fail-loud rule that bans bare-catch
      // silent-degrade. Mirrors the stats/mail command pattern in this file.
      throw err;
    }
  }
}

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
