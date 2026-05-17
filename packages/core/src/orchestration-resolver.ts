/**
 * Orchestration-path resolver (mmnto-ai/totem-strategy#341, ADR-106 — Proposal 282).
 *
 * Per Proposal 282 (Local-Only Orchestration), inter-agent coordination
 * (handoffs + journals) lives in per-repo
 * `.totem/orchestration/<agent-id>/{outbox,processed,journal}/` directories,
 * gitignored. Each agent writes only to its own subdirectory in its home
 * repo; cross-repo handoffs work via sender-side outbox writes that
 * recipients discover by polling.
 *
 * This is an ADDITIVE sibling to `resolveSubstratePaths`. The substrate
 * remains live as a frozen-archive read path through and after the
 * cohort cutover — new writes flow through this resolver; legacy reads
 * (forensic / historical) continue through `resolveSubstratePaths`. Per
 * Proposal 282 § Scope and the totem-Claude impl-lane review (substrate
 * `.handoff/strategy-claude/inbox/2026-05-17T0220Z-totem-claude.md` Q3),
 * the two resolvers stay parallel rather than rename + deprecate so
 * downstream consumers can migrate independently.
 *
 * Pure utility. No caching, no side effects, no logging — same stance
 * as `resolveStrategyRoot` / `resolveSubstratePaths`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Resolved orchestration path triple for a single agent's tree within
 * a single repo. Non-null path values are absolute and normalized.
 *
 * - `source: 'orchestration'` ⟹ at least one subdir exists for the agent.
 * - `source: 'none'` ⟹ no agent tree found at the repo root.
 *
 * Partial-presence is valid: an agent may have a populated `journal/`
 * but no `outbox/` (because it has not yet sent any handoffs in this
 * repo). Consumers MUST tolerate any combination of null fields.
 */
export interface OrchestrationPaths {
  outbox: string | null;
  processed: string | null;
  journal: string | null;
  source: 'orchestration' | 'none';
}

/**
 * `fs.statSync` raises on missing paths and on EACCES/ENOTDIR; treat any
 * stat failure as "not a directory." Mirrors the `substrate-resolver`
 * pattern so the precedence-chain "miss" signal is uniform across
 * resolvers.
 */
function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
    // totem-context: intentional fall-through — stat failures (ENOENT, EACCES, ENOTDIR) are the precedence-chain "miss" signal; rethrowing would force every consumer to wrap the resolver in try/catch for a routine outcome.
  } catch {
    return false;
  }
}

/**
 * Resolve the per-repo orchestration paths for a given agent.
 *
 * @param repoRoot — Absolute path to the repo root (where
 *   `.totem/orchestration/` lives). For self-discovery, this is
 *   typically the consumer's cwd or git root. For cross-repo discovery
 *   (e.g. finding `strategy-claude`'s journal from inside `totem`), pass
 *   the target repo's root — resolve it via `resolveStrategyRoot` or
 *   equivalent first.
 * @param agentId — The agent's full identifier (e.g. `'totem-claude'`,
 *   `'strategy-claude'`, `'lc-gemini'`). Per Proposal 282 § Scope item 3,
 *   the identifier is `<stream>-<vendor>` and disambiguates from human
 *   names or repo names.
 */
export function resolveOrchestrationPaths(repoRoot: string, agentId: string): OrchestrationPaths {
  const base = path.normalize(path.join(repoRoot, '.totem', 'orchestration', agentId));
  const outbox = path.normalize(path.join(base, 'outbox'));
  const processed = path.normalize(path.join(base, 'processed'));
  const journal = path.normalize(path.join(base, 'journal'));

  const outboxExists = isDirectory(outbox);
  const processedExists = isDirectory(processed);
  const journalExists = isDirectory(journal);

  if (!outboxExists && !processedExists && !journalExists) {
    return { outbox: null, processed: null, journal: null, source: 'none' };
  }

  return {
    outbox: outboxExists ? outbox : null,
    processed: processedExists ? processed : null,
    journal: journalExists ? journal : null,
    source: 'orchestration',
  };
}
