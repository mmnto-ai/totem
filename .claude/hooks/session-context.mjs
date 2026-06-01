#!/usr/bin/env node
/**
 * SessionStart hook V2 — combines static filesystem context with
 * LanceDB vector search for relevant knowledge injection.
 *
 * stdout → agent context (JSON with additionalContext field)
 * stderr → diagnostics only
 *
 * Budget: ~2-3k tokens max (ADR-013).
 */

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Workspace-relative dynamic import for the @mmnto/totem resolvers.
// Mirrors the auto-context import pattern below — this hook ships in the
// totem monorepo, so we read the freshly-built dist instead of taking a
// circular workspace dep on @mmnto/totem at the repo root.
async function loadResolvers(gitRoot) {
  const corePath = join(gitRoot, 'packages', 'core', 'dist', 'index.js');
  const mod = await import(pathToFileURL(corePath).href);
  return {
    resolveSubstratePaths: mod.resolveSubstratePaths,
    resolveStrategyRoot: mod.resolveStrategyRoot,
    resolveOrchestrationPaths: mod.resolveOrchestrationPaths,
  };
}

// Per-repo convention per ADR-106 § 3. Env override for hook validation
// (e.g. simulating another agent's view); not used in production.
// Reject path separators / traversal in override — SELF_AGENT feeds into
// pollMail's filename-matching, where a malicious value could route to
// unintended outboxes.
const DEFAULT_SELF_AGENT = 'totem-claude';
const _agentOverride = process.env.TOTEM_HOOK_SELF_AGENT_OVERRIDE;
const SELF_AGENT =
  _agentOverride && !/[\\/]/.test(_agentOverride) && !_agentOverride.includes('..')
    ? _agentOverride
    : DEFAULT_SELF_AGENT;

// Cross-repo inbound mail (ADR-106 § 3). Delegates to the canonical
// `pollMail()` from `@mmnto/cli` (mmnto-ai/totem#1971, shipped in 1.44.0).
// The mail command lives in the same workspace; load from packages/cli/dist
// (the same workspace-relative pattern as loadResolvers above) rather than
// node_modules — this hook ships in the totem monorepo.
async function pollInboundMail(gitRoot) {
  try {
    const mailPath = join(gitRoot, 'packages', 'cli', 'dist', 'commands', 'mail.js');
    if (!existsSync(mailPath)) {
      return {
        count: 0,
        files: [],
        warnings: [],
        scanError: '@mmnto/cli not built at packages/cli/dist; run pnpm -F @mmnto/cli build',
      };
    }
    const { pollMail } = await import(pathToFileURL(mailPath).href);
    // `|| {}` defensive: pollMail could theoretically return undefined on
    // internal failure (its own catch path); destructuring null would throw.
    const result =
      pollMail({
        repoRoot: gitRoot,
        env: { TOTEM_SELF_AGENT: SELF_AGENT },
      }) || {};
    return {
      count: (result.mail || []).length,
      files: result.mail || [],
      // Per-source repo poll failures (e.g. EACCES on a sibling's outbox,
      // mid-rename race) surface here; pollMail does not throw on them.
      // Surfaced in the session context per Tenet 13 (sensor visibility).
      warnings: result.warnings || [],
      scanError: null,
      scanned: result.scanned,
      truncated: result.truncated,
    };
  } catch (err) {
    return {
      count: 0,
      files: [],
      warnings: [],
      scanError: String(err && err.message ? err.message : err),
    };
  }
}

// Derived session orientation (mmnto-ai/totem#2044 PR-2). Loads the orient
// command's programmatic entry from the freshly-built workspace dist — the same
// pattern as pollInboundMail / buildVectorContext, deliberately NOT the global
// `totem` binary (sidesteps the stale-resolve trap mmnto-ai/totem#2053).
//
// Best-effort + bounded. orient runs ~4 sequential synchronous gh calls
// (repo view + PRs + issues + board), each bounded by the adapter's per-call
// timeout — a few seconds on a responsive gh. A SessionStart hook must never
// crash the boot (lesson 8d363778): on a missing dist OR any failure we emit a
// stderr diagnostic and return '' so the block is simply omitted. The rendered
// block is itself hard-bounded by renderOrientForSession, so it can never
// displace high-value content (the #467 net-neutral-truncation guardrail).
async function buildOrientBlock(gitRoot) {
  try {
    const orientPath = join(gitRoot, 'packages', 'cli', 'dist', 'commands', 'orient.js');
    if (!existsSync(orientPath)) {
      process.stderr.write(
        '[session-context] orient block skipped: @mmnto/cli not built at packages/cli/dist; run pnpm -F @mmnto/cli build\n',
      );
      return '';
    }
    const { deriveOrientReport, renderOrientForSession } = await import(
      pathToFileURL(orientPath).href
    );
    const report = await deriveOrientReport(gitRoot);
    return renderOrientForSession(report);
  } catch (err) {
    process.stderr.write(`[session-context] orient block skipped: ${err.message}\n`);
    return '';
  }
}

// ─── Helpers ──────────────────────────────────────────────

function getBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    return 'main';
  }
}

function getGitRoot() {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
  } catch {
    return process.cwd();
  }
}

function extractTicket(branch) {
  const match = branch.match(/(\d+)/);
  return match ? match[1] : null;
}

// ─── Static Context (V1 preserved) ───────────────────────

async function buildStaticContext(gitRoot, branch, ticket) {
  const lines = [];

  lines.push('── Session Context ──');
  lines.push(`Branch: ${branch}`);
  if (ticket) lines.push(`Ticket: #${ticket}`);
  lines.push('');

  // MCP tool reminders
  lines.push('Knowledge tools available via MCP:');
  lines.push('  - mcp__totem-dev__search_knowledge: lessons, specs, code');
  lines.push('  - mcp__totem-strategy__search_knowledge: ADRs, proposals, research');
  lines.push('');

  let resolveSubstratePaths;
  let resolveStrategyRoot;
  let resolveOrchestrationPaths;
  try {
    ({ resolveSubstratePaths, resolveStrategyRoot, resolveOrchestrationPaths } =
      await loadResolvers(gitRoot));
  } catch (err) {
    process.stderr.write(
      `[session-context] Resolvers unavailable (core dist missing?): ${err.message}\n`,
    );
    return lines.join('\n');
  }

  // Journal source resolution (per ADR-106 § 3 — per-repo orchestration ECL
  // is canonical; substrate is frozen-archive, legacy fallback only).
  // Mirrors the strategy-side fix at mmnto-ai/totem-strategy#371.
  let journalDir = null;
  let journalSourceLabel = null;

  // Guard against stale dist exports: if a consumer ran the hook after pulling
  // the new code but before rebuilding core, `resolveOrchestrationPaths` may
  // be undefined on the imported module. Degrade to substrate fallback instead
  // of throwing TypeError on the call site.
  const orchestration =
    typeof resolveOrchestrationPaths === 'function'
      ? resolveOrchestrationPaths(gitRoot, SELF_AGENT)
      : null;

  if (orchestration && orchestration.journal) {
    // Commit to orchestration only when it has at least one .md entry.
    // A directory that exists but is empty (fresh agent bootstrap with no
    // session writes yet) should fall through to substrate so historical
    // journals stay visible during the transition window.
    try {
      if (readdirSync(orchestration.journal).some((f) => f.endsWith('.md'))) {
        journalDir = orchestration.journal;
        journalSourceLabel = 'orchestration';
      }
    } catch (err) {
      process.stderr.write(
        `[session-context] Could not enumerate orchestration journal: ${err.message}\n`,
      );
    }
  }

  if (!journalDir) {
    // Fall back to substrate for legacy/pre-cutover repos whose agent ECL
    // hasn't been bootstrapped yet, OR repos whose per-repo journal directory
    // exists but is empty.
    const substrate = resolveSubstratePaths(gitRoot);
    if (substrate.source === 'none') {
      process.stderr.write(
        `[session-context] Per-repo journal at .totem/orchestration/${SELF_AGENT}/journal/ missing or empty + substrate unreachable. ` +
          'Setup: write a journal entry, OR clone mmnto-ai/totem-substrate as sibling, OR set TOTEM_SUBSTRATE_PATH.\n',
      );
    } else if (substrate.journalRoot) {
      const totemJournalDir = join(substrate.journalRoot, 'totem');
      if (existsSync(totemJournalDir)) {
        journalDir = totemJournalDir;
        journalSourceLabel = substrate.source;
      }
    }
  }

  if (journalDir) {
    try {
      const files = readdirSync(journalDir)
        .filter((f) => f.endsWith('.md'))
        .sort()
        .reverse();
      if (files.length > 0) {
        const latest = files[0];
        lines.push(`Latest journal (${journalSourceLabel}): ${latest}`);
        const content = readFileSync(join(journalDir, latest), 'utf-8');
        // Cap was 20 — far below the size of a normal journal entry
        // (recent claude-006x entries are 87–170 lines, with the FIRST MOVE
        // block and load-bearing context past line 20). The 20-line truncation
        // was cutting off the cross-session-context surface for every cohort
        // session start. See mmnto-ai/totem#1993.
        //
        // 250 is a headroom-vs-budget compromise: it fully covers every recent
        // claude-006x journal (max 170 lines) without paying the worst-case
        // cost against the MAX_TOTAL_CHARS budget below (a 250-cap journal at
        // ~100 chars/line approaches but doesn't routinely exceed the 10k
        // budget; a 500-cap would routinely exceed it and crowd out vector
        // context). Deeper rebalancing (raise the budget, switch to char-based
        // truncation, re-order static vs vector concatenation) is out of scope
        // for the truncation-bug fix and is being tracked separately.
        const JOURNAL_DISPLAY_LINE_CAP = 250;
        const allJournalLines = content.split('\n');
        const journalLines = allJournalLines.slice(0, JOURNAL_DISPLAY_LINE_CAP);
        lines.push(...journalLines);
        if (allJournalLines.length > JOURNAL_DISPLAY_LINE_CAP) lines.push('...');
        lines.push('');
      }
    } catch (err) {
      process.stderr.write(`[session-context] Could not read journal: ${err.message}\n`);
    }
  }

  // Cross-repo inbound mail (ADR-106 § 3). Surface BEFORE the active-proposal
  // lookup so any unread handoff is the first inbound signal at session start.
  // Per claude-0080 standing list (mmnto-ai/totem-strategy → cohort): this
  // wiring is the consumer-side half of the canonical pollMail() loop;
  // until now totem-claude's hook only emitted static context + vector search,
  // leaving cross-repo handoffs invisible.
  const inbox = await pollInboundMail(gitRoot);
  lines.push('── Inbound mail (cross-repo outbox poll, ADR-106 § 3) ──');
  if (inbox.scanError) {
    lines.push(`Poll failed: ${inbox.scanError}`);
  } else if (inbox.count === 0) {
    lines.push(`No unread mail addressed to ${SELF_AGENT} or broadcast.`);
  } else {
    lines.push(`${inbox.count} unread for ${SELF_AGENT}:`);
    inbox.files.slice(0, 10).forEach((m) => {
      lines.push(`  - ${m.file} (from ${m.from} @ ${m.repo})`);
      lines.push(`      subject: ${m.subject}`);
    });
    if (inbox.files.length > 10) {
      lines.push(`  ... and ${inbox.files.length - 10} more.`);
    }
    if (inbox.truncated) {
      lines.push(`  [scan truncated at ${inbox.scanned} files]`);
    }
  }
  // Surface per-source warnings (e.g. unreadable sibling outboxes) independently
  // of the unread-count path — they can co-exist with both zero-mail and
  // populated-mail states. Per Tenet 13: sensor visibility is the contract.
  (inbox.warnings || []).forEach((w) => {
    lines.push(`  Warning: ${w}`);
  });
  lines.push('');

  // Derived orientation (parked / open PRs / coherence drift / counts pointer),
  // mmnto-ai/totem#2044 PR-2. Placed in the high-value early tier but AFTER the
  // journal carryforward and inbound mail: the main() slice keeps the first
  // MAX_TOTAL_CHARS, so anything later is the first to truncate. orient is
  // bounded and high-value, but journal + mail are higher — so orient sits ahead
  // of only the (situational) active-proposal excerpt and the low-value vector
  // tail. Net result: truncation eats the already-truncating vector tail, never
  // journal/mail (strategy charter (A), 2026-06-01; #467 net-neutral guardrail).
  const orientBlock = await buildOrientBlock(gitRoot);
  if (orientBlock) {
    lines.push(orientBlock);
    lines.push('');
  }

  // Active proposal matching ticket — proposals live in totem-strategy
  // (NOT substrate; only `.handoff/` + `.journal/` were extracted per
  // ADR-100). Use resolveStrategyRoot per the dual-resolver pattern.
  if (ticket) {
    const strategy = resolveStrategyRoot(gitRoot);
    if (strategy.resolved) {
      const proposalsDir = join(strategy.path, 'proposals', 'active');
      if (existsSync(proposalsDir)) {
        try {
          const files = readdirSync(proposalsDir).filter((f) => f.endsWith('.md'));
          const ticketRe = new RegExp(`\\b${ticket}\\b`);
          for (const file of files) {
            const content = readFileSync(join(proposalsDir, file), 'utf-8');
            if (ticketRe.test(content)) {
              lines.push(`Active proposal: ${file}`);
              const proposalLines = content.split('\n').slice(0, 10);
              lines.push(...proposalLines);
              lines.push('...');
              lines.push('');
              break;
            }
          }
        } catch (err) {
          process.stderr.write(`[session-context] Could not read proposals: ${err.message}\n`);
        }
      }
    }
  }

  return lines.join('\n');
}

// ─── Vector Context (V2 new) ─────────────────────────────

async function buildVectorContext(gitRoot, branch) {
  try {
    // Dynamic import — the CLI must be built for this to resolve.
    // Use pathToFileURL for Windows ESM compatibility (ERR_UNSUPPORTED_ESM_URL_SCHEME).
    const modulePath = join(gitRoot, 'packages', 'cli', 'dist', 'hooks', 'auto-context.js');
    const { getAutoContext } = await import(pathToFileURL(modulePath).href);

    const result = await getAutoContext({
      branchRef: branch,
      maxCharacters: 6000, // Leave room for static context within 10k total
      limit: 5,
      projectRoot: gitRoot,
    });

    if (result.content) {
      const header = `\nRelevant knowledge (${result.searchMethod}, ${result.resultsIncluded} results, ${result.durationMs}ms):`;
      return `${header}\n${result.content}`;
    }

    return '';
  } catch (err) {
    process.stderr.write(`[session-context] Vector context skipped: ${err.message}\n`);
    return '';
  }
}

// ─── Main ─────────────────────────────────────────────────

async function main() {
  const gitRoot = getGitRoot();
  const branch = getBranch();
  const ticket = extractTicket(branch);

  const staticContext = await buildStaticContext(gitRoot, branch, ticket);
  const vectorContext = await buildVectorContext(gitRoot, branch);

  // Hard cap: ~10k chars total (~2.5k tokens) per ADR-013
  const MAX_TOTAL_CHARS = 10_000;
  const combined = staticContext + vectorContext + '\n\n── End Session Context ──';
  const fullContext =
    combined.length > MAX_TOTAL_CHARS
      ? combined.slice(0, MAX_TOTAL_CHARS) + '\n...(truncated)'
      : combined;

  // Claude Code hook protocol: JSON with additionalContext field
  const output = JSON.stringify({ additionalContext: fullContext });
  process.stdout.write(output);
}

main().catch((err) => {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`[session-context] Fatal: ${detail}\n`);
  // Exit 0 — never crash the agent's session boot
  process.exit(0);
});
