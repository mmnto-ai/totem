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

import { z } from 'zod';

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
/**
 * Path-traversal pattern for `agentId` validation. Matches:
 * - `/` or `\` (POSIX or Windows path separators)
 * - `\0` (null byte — POSIX path-truncation class)
 * - `..` (parent-directory traversal)
 *
 * Regex form rather than `.includes()` is deliberate: the lint corpus
 * treats `.includes()` as file-identification (`.test.`, `README`, marker
 * scans) and produces false-positive findings on input-sanitization
 * checks. A single anchored predicate keeps both intent and lint clean.
 */
const AGENT_ID_TRAVERSAL_PATTERN = /[/\\\0]|\.\./;

export function resolveOrchestrationPaths(repoRoot: string, agentId: string): OrchestrationPaths {
  // Defense-in-depth: reject path-traversal patterns in `agentId` before
  // composing the base path. The hardcoded map in the /signoff skill is
  // safe, but `.totem/orchestration/config.json` carries a `host_agents`
  // override (intentionally — for repos that legitimately host an agent
  // outside the default map). A malicious or buggy override
  // (`'..', '../..', 'a/b'`) would otherwise escape `.totem/orchestration/`
  // because `path.normalize` collapses `..` segments before the existence
  // check sees them. Same 'none' return shape as a missing tree — callers
  // already tolerate that branch.
  if (
    typeof agentId !== 'string' ||
    agentId.length === 0 ||
    AGENT_ID_TRAVERSAL_PATTERN.test(agentId)
  ) {
    return { outbox: null, processed: null, journal: null, source: 'none' };
  }

  // Resolve `repoRoot` to absolute before composition. Without this, a
  // caller that supplies a relative anchor (against the contract on the
  // `repoRoot` JSDoc above) returns relative paths in `outbox` /
  // `processed` / `journal` — a quiet correctness slip rather than a
  // loud error. `resolveSubstratePaths` runs the same anchor through
  // `path.resolve` for the same reason; symmetric guarantee.
  const resolvedRoot = path.resolve(repoRoot);
  const base = path.normalize(path.join(resolvedRoot, '.totem', 'orchestration', agentId));
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

/**
 * Cohort agent-id map (Proposal 282 § Scope item 3 — keep in sync with the
 * ADR-106 cohort list and the prose copy in the `signoff` skill at
 * `packages/cli/src/commands/init-templates.ts:SIGNOFF_SKILL_CONTENT`).
 *
 * Keyed by the repo-root basename (the bottom segment of the repo's
 * absolute path). Each value is the list of agent-ids this repo natively
 * hosts (zero, one, or two — the Claude + Gemini pair where both
 * variants ship). Empty array marks an orphan-stream repo with no native
 * agent (`totem-playground`).
 */
const COHORT_AGENT_MAP: Readonly<Record<string, readonly string[]>> = Object.freeze({
  totem: Object.freeze(['totem-claude', 'totem-gemini']),
  'totem-strategy': Object.freeze(['strategy-claude', 'strategy-gemini']),
  'liquid-city': Object.freeze(['lc-claude', 'lc-gemini']),
  arhgap11: Object.freeze(['arhgap11-claude', 'arhgap11-gemini']),
  'totem-status': Object.freeze(['status-gemini']),
  'totem-playground': Object.freeze([]),
});

/**
 * Zod schema for the optional `<repoRoot>/.totem/orchestration/config.json`
 * override file. Only `host_agents` is consumed by the resolver; the
 * `passthrough()` allows unrelated fields (downstream consumers may add
 * their own keys to the same file) without rejecting the parse.
 */
const ConfigSchema = z
  .object({
    host_agents: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

/**
 * Resolution result for `resolveSelfAgents`. `source` discriminates which
 * precedence layer answered:
 *
 * - `'env'`        — `TOTEM_SELF_AGENT` env var (highest precedence; for hooks/tests)
 * - `'config'`     — `.totem/orchestration/config.json` `host_agents` override
 * - `'map'`        — hardcoded basename → agent-ids cohort map
 * - `'none'`       — no resolution; `agents: []`
 */
export interface SelfAgentResolution {
  agents: string[];
  source: 'env' | 'config' | 'map' | 'none';
}

/**
 * Parse a comma-separated `TOTEM_SELF_AGENT` value into a clean list.
 * Empty / whitespace-only entries dropped; path-traversal entries dropped.
 */
function parseEnvAgentList(raw: string): string[] {
  return (
    raw
      .split(',')
      .map((s) => s.trim())
      // totem-context: AGENT_ID_TRAVERSAL_PATTERN is a non-global regex (no `g` flag), so `.test()` is stateless here; this is path-traversal sanitization, not shell-command identification.
      .filter((s) => s.length > 0 && !AGENT_ID_TRAVERSAL_PATTERN.test(s))
  );
}

/**
 * Resolve the set of agent-ids "self" for the calling repo. Used by
 * `totem mail` and any consumer that needs to filter cross-repo handoffs
 * by recipient.
 *
 * Precedence (highest → lowest):
 *
 *   1. `TOTEM_SELF_AGENT` env var (comma-separated; hook + test contexts)
 *   2. `<repoRoot>/.totem/orchestration/config.json` `host_agents: string[]`
 *   3. Hardcoded `COHORT_AGENT_MAP` by `path.basename(repoRoot)`
 *   4. `{ agents: [], source: 'none' }`
 *
 * Path-traversal entries (`..`, `/`, `\`, null byte) are dropped at every
 * layer — same guard as `resolveOrchestrationPaths`. An empty list from a
 * higher-precedence layer falls through to the next (so a malformed env
 * var doesn't shadow a valid config or map entry).
 *
 * Pure utility — no caching, no logging, no side effects other than a
 * single `fs.readFileSync` of the config.json when present.
 *
 * @param repoRoot — Absolute path to the consuming repo's root.
 * @param env — Optional env override (default: `process.env`). Injection
 *   surface for tests so the env-precedence branch can be exercised
 *   without mutating real env state.
 */
export function resolveSelfAgents(
  repoRoot: string,
  env: Record<string, string | undefined> = process.env,
): SelfAgentResolution {
  const envRaw = env['TOTEM_SELF_AGENT'];
  if (typeof envRaw === 'string' && envRaw.trim().length > 0) {
    const agents = parseEnvAgentList(envRaw);
    if (agents.length > 0) {
      return { agents, source: 'env' };
    }
  }

  const resolvedRoot = path.resolve(repoRoot);
  const configPath = path.join(resolvedRoot, '.totem', 'orchestration', 'config.json');
  if (fs.existsSync(configPath)) {
    try {
      // totem-context: synchronous read of a small user-supplied config file at resolver invocation time; matches the sync stance of `resolveOrchestrationPaths` / `resolveSubstratePaths`. This is a real user-config file (not a static-analysis tool reading staged tree state) so `git show :path` would read the wrong thing.
      const content = fs.readFileSync(configPath, 'utf-8');
      const parseResult = ConfigSchema.safeParse(JSON.parse(content));
      if (parseResult.success && parseResult.data.host_agents !== undefined) {
        const agents = parseResult.data.host_agents
          .filter((a) => a.length > 0)
          // totem-context: AGENT_ID_TRAVERSAL_PATTERN is non-global (no `g` flag), so `.test()` is stateless here; this is path-traversal sanitization on repo-controlled config input, not shell-command identification.
          .filter((a) => !AGENT_ID_TRAVERSAL_PATTERN.test(a));
        if (agents.length > 0) {
          return { agents, source: 'config' };
        }
      }
      // totem-context: malformed config.json or schema-mismatch falls through to the basename map; the resolver is best-effort and never throws on a user-supplied config (the path-traversal guard above is the only invariant enforced).
    } catch {
      // fall through to basename map
    }
  }

  const basename = path.basename(resolvedRoot);
  const mapped = COHORT_AGENT_MAP[basename];
  if (mapped !== undefined && mapped.length > 0) {
    return { agents: [...mapped], source: 'map' };
  }

  return { agents: [], source: 'none' };
}
