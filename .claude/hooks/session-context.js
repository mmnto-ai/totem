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
  };
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
  try {
    ({ resolveSubstratePaths, resolveStrategyRoot } = await loadResolvers(gitRoot));
  } catch (err) {
    process.stderr.write(
      `[session-context] Resolvers unavailable (core dist missing?): ${err.message}\n`,
    );
    return lines.join('\n');
  }

  // Substrate journal (per ADR-100 Phase C — `<substrate>/.journal/totem/`).
  const substrate = resolveSubstratePaths(gitRoot);
  if (substrate.source === 'none') {
    process.stderr.write(
      '[session-context] Substrate unreachable + repo-local sediment empty. ' +
        'Setup: clone mmnto-ai/totem-substrate as sibling, OR set TOTEM_SUBSTRATE_PATH.\n',
    );
  } else if (substrate.journalRoot) {
    const totemJournalDir = join(substrate.journalRoot, 'totem');
    if (existsSync(totemJournalDir)) {
      try {
        const files = readdirSync(totemJournalDir)
          .filter((f) => f.endsWith('.md'))
          .sort()
          .reverse();
        if (files.length > 0) {
          const latest = files[0];
          lines.push(`Latest journal (${substrate.source}): ${latest}`);
          const content = readFileSync(join(totemJournalDir, latest), 'utf-8');
          const journalLines = content.split('\n').slice(0, 20);
          lines.push(...journalLines);
          lines.push('...');
          lines.push('');
        }
      } catch (err) {
        process.stderr.write(`[session-context] Could not read journal: ${err.message}\n`);
      }
    }
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
