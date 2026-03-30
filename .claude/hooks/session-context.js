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

function buildStaticContext(gitRoot, branch, ticket) {
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

  // Latest journal entry
  const journalDir = join(gitRoot, '.strategy', '.journal');
  if (existsSync(journalDir)) {
    try {
      const files = readdirSync(journalDir)
        .filter((f) => f.endsWith('.md'))
        .sort()
        .reverse();
      if (files.length > 0) {
        const latest = files[0];
        lines.push(`Latest journal: ${latest}`);
        const content = readFileSync(join(journalDir, latest), 'utf-8');
        const journalLines = content.split('\n').slice(0, 20);
        lines.push(...journalLines);
        lines.push('...');
        lines.push('');
      }
    } catch {
      // Skip journal if unreadable
    }
  }

  // Active proposal matching ticket
  const proposalsDir = join(gitRoot, '.strategy', 'proposals', 'active');
  if (existsSync(proposalsDir) && ticket) {
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
    } catch {
      // Skip proposals if unreadable
    }
  }

  return lines.join('\n');
}

// ─── Vector Context (V2 new) ─────────────────────────────

async function buildVectorContext(gitRoot, branch) {
  try {
    // Dynamic import — the CLI must be built for this to resolve
    const { getAutoContext } = await import(
      join(gitRoot, 'packages', 'cli', 'dist', 'hooks', 'auto-context.js')
    );

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

  const staticContext = buildStaticContext(gitRoot, branch, ticket);
  const vectorContext = await buildVectorContext(gitRoot, branch);

  const fullContext = staticContext + vectorContext + '\n\n── End Session Context ──';

  // Claude Code hook protocol: JSON with additionalContext field
  const output = JSON.stringify({ additionalContext: fullContext });
  process.stdout.write(output);
}

main().catch((err) => {
  process.stderr.write(`[session-context] Fatal: ${err.message}\n`);
  // Exit 0 — never crash the agent's session boot
  process.exit(0);
});
