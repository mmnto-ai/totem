#!/usr/bin/env node
/**
 * SessionStart hook V2 — combines static filesystem context with
 * LanceDB vector search for relevant knowledge injection.
 *
 * stdout → agent context (JSON: hookSpecificOutput.additionalContext envelope)
 * stderr → diagnostics only
 *
 * Budget: ~2-3k tokens max (ADR-013).
 */

import { execSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// ─── totem-status refresh-gh — GH-federation snapshot refresh ───
// (mmnto-ai/totem-status#127 C3; tracking mmnto-ai/totem#2556.) This repo does
// NOT run the managed SessionStart.cjs template (this bespoke V2 hook is the
// sole SessionStart entry in .claude/settings.json), so the C3 session-start
// moment is wired here directly — the same spawn-and-forget block the managed
// templates carry: detached+unref (never blocks the briefing), presence-gated
// (ENOENT = sidecar not adopted, silent), primary-checkout-gated (a detached
// child inheriting a linked-worktree cwd holds a Windows directory lock that
// breaks worktree removal).
try {
  let primaryCheckout = false;
  try {
    primaryCheckout = statSync(join(process.cwd(), '.git')).isDirectory();
  } catch {
    // not a git checkout — no refresh moment here
  }
  if (primaryCheckout) {
    // Observability leg (mmnto-ai/totem#2570, routed from the status seat's
    // 2026-08-03 silent no-write): under stdio:'ignore' plus the verb's
    // exit-0-or-nothing contract, a reaped or dying child leaves NO trace.
    // Each firing stamps a workspace-root log and hands the child the same
    // fd; a stamp with nothing after it means the child never finished. Log
    // failures degrade to the previous blind firing.
    // Repo-local inside .git (falsification round): never tracked, per-repo,
    // writable wherever git itself writes; 1 MiB self-cap. Control characters
    // are scrubbed from path-derived fields (terminal-injection guideline).
    const logPath = join(process.cwd(), '.git', 'totem-status-refresh-hook.log');
    const scrub = (v) => String(v).replace(/[\x00-\x1f\x7f]/g, '?');
    let stdio = 'ignore';
    let logFd = null;
    try {
      try {
        if (statSync(logPath).size > 1048576) writeFileSync(logPath, '');
      } catch {
        // no log yet — nothing to cap
      }
      appendFileSync(
        logPath,
        '[' +
          new Date().toISOString() +
          '] claude spawn cwd=' +
          scrub(process.cwd()) +
          ' path-has-go-bin=' +
          /go[\\/]bin/i.test(process.env.PATH || '') +
          ' cwd-shadow-exe=' +
          existsSync(join(process.cwd(), 'totem-status.exe')) +
          '\n',
      );
      logFd = openSync(logPath, 'a');
      stdio = ['ignore', logFd, logFd];
    } catch {
      // log unavailable — refresh still fires blind, as before
    }
    const refresh = spawn('totem-status', ['refresh-gh'], {
      detached: true,
      stdio,
    });
    refresh.on('error', (err) => {
      try {
        appendFileSync(
          logPath,
          '[' +
            new Date().toISOString() +
            '] claude spawn-error code=' +
            ((err && err.code) || 'unknown') +
            '\n',
        );
      } catch {
        // log write failed — fall through to the stderr breadcrumb
      }
      if (err && err.code === 'ENOENT') return;
      process.stderr.write(
        '[SessionStart] totem-status refresh-gh spawn failed (non-fatal): ' +
          (err instanceof Error ? err.message : String(err)) +
          '\n',
      );
    });
    refresh.unref();
    // The child holds its own copy of the fd from spawn time; release the parent's.
    if (logFd !== null) {
      try {
        closeSync(logFd);
      } catch {
        // nothing to release
      }
    }
  }
} catch (err) {
  process.stderr.write(
    '[SessionStart] totem-status refresh-gh unavailable (non-fatal): ' +
      (err instanceof Error ? err.message : String(err)) +
      '\n',
  );
}

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

// ─── A.3.a: mint session ID + log session_start event ───
// This bespoke V2 hook is the SOLE SessionStart entry in this repo, and until
// mmnto-ai/totem#2468 it never took over the managed template's A.3.a duty —
// measured on the live ledger: 5 session_start rows against 132 mcp_call. The
// session UUID is the selection-manifest join key AND the session_start row is
// the emitter's recorded-absence denominator, so the mint block lands with the
// M1 instrument (same shape as CLAUDE_SESSION_START in init-templates.ts —
// including its attribution discipline: agent_source is stamped ONLY from
// TOTEM_SELF_AGENT, omitted when absent, never guessed from SELF_AGENT, which
// is hook CONFIG (whose mail to poll), not session attribution; ADR-078 +
// leg round 1 MB-2). Anchored at gitRoot, not cwd, so the row and the
// manifest's .session-id read can never split roots (leg round 1 H-8).
// Fire-and-forget: a ledger failure must NOT block the briefing.
// Hoisted so the manifest emission in main() can stamp the SAME minted UUID
// without re-reading the shared pointer (PR #2625 CR round, partial).
let mintedSessionId = null;
try {
  const ledgerDir = join(getGitRoot(), '.totem', 'ledger');
  mkdirSync(ledgerDir, { recursive: true });
  const sessionId = randomUUID();
  mintedSessionId = sessionId;
  writeFileSync(join(ledgerDir, '.session-id'), sessionId, 'utf-8');
  const mintSelfAgent = (process.env.TOTEM_SELF_AGENT || '')
    .split(',')
    .map((s) => s.trim())
    .find((s) => s.length > 0);
  const event = {
    timestamp: new Date().toISOString(),
    type: 'session_start',
    activity_name: 'SessionStart',
    source: 'bot',
    ...(mintSelfAgent ? { agent_source: mintSelfAgent } : {}),
    justification: '',
    session_id: sessionId,
  };
  appendFileSync(join(ledgerDir, 'events.ndjson'), JSON.stringify(event) + '\n', 'utf-8');
} catch (err) {
  process.stderr.write(
    '[session-context] session-start telemetry unavailable (non-fatal): ' +
      (err instanceof Error ? err.message : String(err)) +
      '\n',
  );
}

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
    // Match the sibling pollInboundMail's null-safe extraction: `err.message`
    // alone throws a TypeError when `err` is null/undefined (crashing the very
    // boot this catch protects) and prints "undefined" for non-Error throws.
    process.stderr.write(
      `[session-context] orient block skipped: ${err && err.message ? err.message : String(err)}\n`,
    );
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

// `records` collects selection-manifest candidates (mmnto-ai/totem#2468) as
// each block makes its selection: content-bearing records carry the exact
// bytes the policy read; id-only records are candidates the policy never read
// (recorded without fabricated measurement); `premeasured` records come from
// auto-context's own metadata. Purely observational — nothing here alters
// what any block selects.
async function buildStaticContext(gitRoot, branch, ticket, records) {
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
        // Selection manifest (#2468): the latest journal is the recency
        // policy's one read; every sibling lost to that policy id-only.
        const journalTruncated = allJournalLines.length > JOURNAL_DISPLAY_LINE_CAP;
        records.push({
          id: `journal/${latest}`,
          content,
          disposition: journalTruncated ? 'truncated' : 'selected',
          reason: journalTruncated
            ? `recency-policy: latest journal; display-cap ${JOURNAL_DISPLAY_LINE_CAP} lines`
            : 'recency-policy: latest journal, no display-cap cut (the global char slice may still apply — see finalTruncation)',
          ...(journalTruncated && {
            deliveredBytes: Buffer.byteLength(journalLines.join('\n'), 'utf-8'),
          }),
        });
        for (const f of files.slice(1)) {
          records.push({
            id: `journal/${f}`,
            disposition: 'excluded',
            reason: 'recency-policy: only latest journal injected',
          });
        }
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
      // Selection manifest (#2468): the considered bytes are the two display
      // lines — the poll surfaces headers, never dispatch bodies.
      records.push({
        id: `mail/${m.file}`,
        content: `${m.file} (from ${m.from} @ ${m.repo}) subject: ${m.subject}`,
        disposition: 'selected',
        reason: 'inbox unread (display cap 10)',
      });
    });
    if (inbox.files.length > 10) {
      lines.push(`  ... and ${inbox.files.length - 10} more.`);
      inbox.files.slice(10).forEach((m) => {
        records.push({ id: `mail/${m.file}`, disposition: 'excluded', reason: 'display-cap 10' });
      });
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
    // Selection manifest (#2468): one candidate — the bounded render's
    // per-item caps are that render's internal policy; orient is derived
    // state, so the overlap join needs no finer grain (design OQ3).
    records.push({
      id: 'orient:session-block',
      content: orientBlock,
      disposition: 'selected',
      reason: 'bounded session render (renderOrientForSession caps)',
    });
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
          for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const content = readFileSync(join(proposalsDir, file), 'utf-8');
            if (ticketRe.test(content)) {
              lines.push(`Active proposal: ${file}`);
              const proposalLines = content.split('\n').slice(0, 10);
              lines.push(...proposalLines);
              lines.push('...');
              lines.push('');
              // Selection manifest (#2468): the match ships a 10-line excerpt;
              // files after it lose to first-match-wins WITHOUT being read
              // (id-only — no fabricated measurement). Files before it were
              // read and non-matching: query non-hits, not selection losses.
              records.push({
                id: `proposal/${file}`,
                content,
                disposition: 'truncated',
                reason: `ticket-match #${ticket}; 10-line excerpt`,
                deliveredBytes: Buffer.byteLength(proposalLines.join('\n'), 'utf-8'),
              });
              for (const untested of files.slice(i + 1)) {
                records.push({
                  id: `proposal/${untested}`,
                  disposition: 'excluded',
                  reason: 'first-match-wins: untested after first match',
                });
              }
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

async function buildVectorContext(gitRoot, branch, records) {
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

    // Selection manifest (#2468): auto-context measures its own candidates
    // (formatted-block bytes + fingerprint), including the char-budget cut —
    // carried through as premeasured records. `|| []` tolerates a stale CLI
    // dist that predates the metadata field.
    for (const c of result.candidates || []) {
      records.push({
        id: `knowledge/${c.filePath}`,
        premeasured: { bytes: c.bytes, approxTokens: c.approxTokens, fingerprint: c.fingerprint },
        disposition: c.included ? 'selected' : 'excluded',
        reason: c.included
          ? `vector-rank (relevance ${typeof c.relevance === 'number' ? c.relevance.toFixed(3) : 'n/a'})`
          : 'char-budget 6000',
      });
    }

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

  const records = [];
  const staticContext = await buildStaticContext(gitRoot, branch, ticket, records);
  const vectorContext = await buildVectorContext(gitRoot, branch, records);

  // Hard cap: ~10k chars total (~2.5k tokens) per ADR-013
  const MAX_TOTAL_CHARS = 10_000;
  const combined = staticContext + vectorContext + '\n\n── End Session Context ──';
  const fullContext =
    combined.length > MAX_TOTAL_CHARS
      ? combined.slice(0, MAX_TOTAL_CHARS) + '\n...(truncated)'
      : combined;

  // ─── Selection manifest (mmnto-ai/totem#2468 M1) ───
  // Emitted AFTER the context is fully composed and BEFORE the stdout write —
  // a pure sensor over a finished selection; its own try so no failure can
  // reach the hookSpecificOutput envelope. The core writer is loaded from the
  // workspace dist (same pattern as loadResolvers); a stale dist that predates
  // the writer skips with a breadcrumb, and the absence stays recorded via the
  // session_start denominator row minted above.
  try {
    const corePath = join(gitRoot, 'packages', 'core', 'dist', 'index.js');
    const core = await import(pathToFileURL(corePath).href);
    if (
      typeof core.senseSelectionManifest === 'function' &&
      typeof core.buildMeasuredCandidate === 'function'
    ) {
      let cliVersion;
      try {
        cliVersion = JSON.parse(
          readFileSync(join(gitRoot, 'packages', 'cli', 'package.json'), 'utf-8'),
        ).version;
      } catch {
        // best-effort enrichment only — the row is valid without it
      }
      const warnings = [];
      const candidates = records.map((rec) => {
        if (rec.content !== undefined) {
          const { candidate, warning } = core.buildMeasuredCandidate({
            id: rec.id,
            content: rec.content,
            disposition: rec.disposition,
            reason: rec.reason,
            ...(rec.deliveredBytes !== undefined && { deliveredBytes: rec.deliveredBytes }),
          });
          if (warning !== undefined) warnings.push(warning);
          return candidate;
        }
        if (rec.premeasured !== undefined) {
          return { id: rec.id, disposition: rec.disposition, reason: rec.reason, ...rec.premeasured };
        }
        return { id: rec.id, disposition: rec.disposition, reason: rec.reason };
      });
      core.senseSelectionManifest(
        {
          totemDir: join(gitRoot, '.totem'),
          emitter: 'session-start',
          // The minted UUID is passed DIRECTLY — re-reading the shared
          // .session-id pointer here would race a concurrent session's
          // rotation between this hook's mint and its emission (PR #2625 CR
          // round, partial absorption of the concurrent-hook finding).
          ...(mintedSessionId ? { sessionId: mintedSessionId } : {}),
          context: { branch, ticket: ticket ?? null, selfAgent: SELF_AGENT },
          universe:
            'session-start blocks: journal dir + inbox poll + orient render + ticket-matched proposals + vector top-5',
          candidates,
          warnings,
          finalTruncation: {
            cap: MAX_TOTAL_CHARS,
            totalChars: combined.length,
            applied: combined.length > MAX_TOTAL_CHARS,
          },
          ...(cliVersion !== undefined && { cliVersion }),
          // No env override: agent_source resolves from the REAL environment
          // (stamped absence when TOTEM_SELF_AGENT is unset — ADR-078, leg
          // round 1 MB-2). SELF_AGENT is hook config and already disclosed in
          // `context.selfAgent`; forcing it into the env would fabricate the
          // instrument's per-seat axis on exactly the seat baselines run on.
        },
        (msg) => process.stderr.write(`[session-context] ${msg}\n`),
      );
    } else {
      process.stderr.write(
        '[session-context] selection manifest skipped: core dist predates the writer\n',
      );
    }
  } catch (err) {
    process.stderr.write(
      `[session-context] selection manifest skipped: ${err && err.message ? err.message : String(err)}\n`,
    );
  }

  // Claude Code hook protocol: SessionStart context is ingested ONLY from the
  // hookSpecificOutput envelope. A top-level additionalContext key is not part
  // of the protocol — the harness records hook_success, then silently injects
  // nothing (mmnto-ai/totem#2522: every session 2026-07-17 → 07-29 booted cold).
  const output = JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: fullContext },
  });
  process.stdout.write(output);
}

main().catch((err) => {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`[session-context] Fatal: ${detail}\n`);
  // Exit 0 — never crash the agent's session boot
  process.exit(0);
});
