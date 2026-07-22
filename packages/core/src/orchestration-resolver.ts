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

/**
 * Characters that no cohort agent-id legitimately contains and that are unsafe
 * in a filename token or a logged/rendered string: Unicode control characters
 * (`\p{Cc}` — terminal-injection into CLI logs and dispatch markdown),
 * whitespace, and the win32-reserved set `< > : " | ? *`. Complements
 * `AGENT_ID_TRAVERSAL_PATTERN` (separators, null byte, `..`) so that
 * `isPathSafeAgentId` is a full path-segment guard, not only a traversal
 * guard (CR R2 on mmnto-ai/totem#2134).
 */
const AGENT_ID_UNSAFE_CHAR_PATTERN = /[\p{Cc}\s<>:"|?*]/u;

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
 * Since mmnto-ai/totem#2141 this is the BOOTSTRAP FALLBACK, not the roster:
 * seat discovery derives from the orchestration directory layout (the dirs
 * ARE the state, Tenet 20) and the map's job is keeping roster seats visible
 * where no dirs exist yet (fresh clones — the tree is gitignored) or only
 * some seats have written (partial-dir union, `resolveSelfAgents` layer 3).
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
  // status-claude seated per the cohort-roles §1.1 roster ruling
  // (mmnto-ai/totem-strategy#958, 2026-07-22) — without the map entry,
  // dispatches addressed `to: status-claude` are invisible to CLI polls on
  // checkouts where the gitignored seat dir is absent.
  'totem-status': Object.freeze(['status-claude', 'status-gemini']),
  'totem-playground': Object.freeze([]),
});

/**
 * Enumerate the seat directories registered in a repo's orchestration tree:
 * immediate child DIRECTORIES of `<repoRoot>/.totem/orchestration/` whose
 * names pass the full path-segment guard, excluding `.`/`_`-prefixed entries
 * (`config.json` is a file; `_broadcast`-class dirs are routing surfaces, not
 * seats). The dirs ARE the registration (Tenet 20; mmnto-ai/totem#2141
 * roster ruling: repo+1 touches zero surfaces — a seat's first write creates
 * its dir, and from that moment it is sensed). One-level, dirent-only, no
 * symlink following (`Dirent.isDirectory()` is false for symlinks).
 *
 * Any readdir failure (missing tree on a fresh clone — orchestration is
 * gitignored — EACCES, raced rename) degrades to an empty contribution so
 * callers fall back to the basename map, preserving pre-dirs behavior.
 */
function readSeatDirs(repoRoot: string): string[] {
  const orchDir = path.join(path.resolve(repoRoot), '.totem', 'orchestration');
  try {
    return fs
      .readdirSync(orchDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter((name) => !name.startsWith('.') && !name.startsWith('_') && isPathSafeAgentId(name))
      .sort();
    // totem-context: intentional fall-through — a missing/unreadable orchestration tree is the routine "no dirs registered here" signal (fresh clone, gitignored tree); the map layer keeps roster seats visible, so degrading silently here is the documented contract, not drift.
  } catch {
    return [];
  }
}

/**
 * Known cohort agent-ids, sorted. Zero-arg: the `COHORT_AGENT_MAP` flatten
 * (one source of truth for the pre-known roster — sorted so both call shapes
 * share one ordering contract, CR on mmnto-ai/totem#2160). With
 * `workspace`: the map UNION every seat directory registered in any immediate
 * workspace repo (`<workspace>/<repo>/.totem/orchestration/<seat>/`), so a
 * dir-registered seat (e.g. totem-codex) is a known recipient with zero
 * registration surfaces (mmnto-ai/totem#2141). One-level traversal only,
 * dirent-only directories, no symlink following, the same dot/`_`/
 * node_modules exclusions as the mail scan.
 *
 * Consumed by the outbound mail validator (`mail send`) to flag an unknown
 * recipient — a *content* warning, never a block (ADR-106 inv6 fail-open).
 * `broadcast` is a valid recipient too, but it is a routing literal, not an
 * agent, so callers handle it separately.
 */
export function knownCohortAgents(workspace?: string): string[] {
  const fromMap = Object.values(COHORT_AGENT_MAP).flat();
  if (workspace === undefined) {
    return [...fromMap].sort();
  }
  const known = new Set(fromMap);
  const resolvedWorkspace = path.resolve(workspace);
  let repos: fs.Dirent[];
  try {
    repos = fs.readdirSync(resolvedWorkspace, { withFileTypes: true });
    // totem-context: intentional fall-through — an unreadable workspace degrades to the map flatten; recipient validation is advisory (inv6), so fewer known agents can only widen a warn, never block a send.
  } catch {
    return [...known].sort();
  }
  for (const repo of repos) {
    if (!repo.isDirectory() || repo.name.startsWith('.') || repo.name === 'node_modules') {
      continue;
    }
    for (const seat of readSeatDirs(path.join(resolvedWorkspace, repo.name))) {
      known.add(seat);
    }
  }
  return [...known].sort();
}

/**
 * True iff `id` is safe to use as a `.totem/orchestration/<id>/…` path segment
 * (or any filename token): a non-empty string with no path separators, null
 * byte, or `..` traversal, and no control/whitespace/win32-reserved characters
 * (which would otherwise propagate into dispatch markdown, filenames, and CLI
 * logs — terminal-injection class). The single source of truth for the guard —
 * consumers (e.g. `totem mail send`'s `--from`/`--to` validation) reuse this
 * rather than re-deriving the pattern (Greptile P2 + CR R2 on
 * mmnto-ai/totem#2134).
 */
export function isPathSafeAgentId(id: string): boolean {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    !AGENT_ID_TRAVERSAL_PATTERN.test(id) &&
    !AGENT_ID_UNSAFE_CHAR_PATTERN.test(id)
  );
}

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
 * precedence layer answered (tri-state honesty for the union layer —
 * mmnto-ai/totem#2141):
 *
 * - `'env'`        — `TOTEM_SELF_AGENT` env var (highest precedence; for hooks/tests)
 * - `'config'`     — `.totem/orchestration/config.json` `host_agents` override
 * - `'dirs'`       — orchestration seat dirs (the map contributed nothing novel)
 * - `'map'`        — hardcoded basename → agent-ids cohort map (no usable dirs)
 * - `'dirs+map'`   — both layers contributed unique seats (partial-dir state)
 * - `'none'`       — no resolution; `agents: []`
 */
export interface SelfAgentResolution {
  agents: string[];
  source: 'env' | 'config' | 'dirs' | 'map' | 'dirs+map' | 'none';
  /**
   * Loud diagnostics that must reach the user (Tenet 4): today the single
   * producer is the config warn-shape — `host_agents` answered while omitting
   * a PRESENT safe seat dir, the silent-unbind class from mmnto-ai/totem#2141
   * (config keeps its shipped replace semantics; the suppression stops being
   * silent). Absent = nothing to report. Consumers (mail) append these to
   * their warning stream.
   */
  warnings?: string[];
}

/**
 * Parse a comma-separated `TOTEM_SELF_AGENT` value into a clean list.
 * Empty / whitespace-only entries dropped; entries failing the full
 * path-segment guard (traversal, control/whitespace/win32-reserved) dropped —
 * the read path enforces the same contract as the mail actuator's recipient
 * validation (CR R3 on mmnto-ai/totem#2134).
 */
function parseEnvAgentList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(isPathSafeAgentId);
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
 *      — replace semantics preserved (shipped contract), but omitting a
 *      PRESENT safe seat dir attaches a loud warning naming the omitted
 *      seat(s) (mmnto-ai/totem#2141 warn-shape; the in-repo mirror of the
 *      strategy-side `ecl-self-agent-binding` superset-of-dirs probe)
 *   3. Seat dirs UNION `COHORT_AGENT_MAP[basename]` — union, not replace:
 *      orchestration is gitignored, so on a partial-dir fresh clone a
 *      dirs-only answer would vanish roster siblings; the map keeps them
 *      visible while present dirs admit unmapped seats with zero
 *      registration surfaces (Tenet 20; the totem-codex exhibit)
 *   4. `{ agents: [], source: 'none' }`
 *
 * Entries failing `isPathSafeAgentId` (path traversal, null byte, control/
 * whitespace/win32-reserved characters) are dropped at every layer — the
 * same contract the mail actuator enforces on recipients. An empty list from
 * a higher-precedence layer falls through to the next (so a malformed env
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
        // Same full path-segment guard as the env layer (CR R3 on
        // mmnto-ai/totem#2134): traversal AND control/whitespace/win32-reserved
        // entries dropped from repo-controlled config input too.
        const agents = parseResult.data.host_agents.filter(isPathSafeAgentId);
        if (agents.length > 0) {
          // Warn-shape (mmnto-ai/totem#2141): config keeps its shipped
          // replace semantics, but a PRESENT safe seat dir it omits is the
          // silent-unbind class — the seat exists by registration (the dir)
          // yet its mail stops surfacing while totem-status's additive
          // display still shows it bound. Never silent (Tenet 4): name the
          // omitted seats loudly; config-exclusion is not a sanctioned
          // decommission mechanism (delete or archive the dir instead).
          const configSet = new Set(agents);
          const omitted = readSeatDirs(resolvedRoot).filter((seat) => !configSet.has(seat));
          if (omitted.length > 0) {
            return {
              agents,
              source: 'config',
              warnings: [
                `config.json host_agents omits present seat dir(s): ${omitted.join(', ')} — the dir is the registration (mmnto-ai/totem#2141); add them to host_agents or remove the stale dir(s)`,
              ],
            };
          }
          return { agents, source: 'config' };
        }
      }
      // totem-context: intentional cleanup — malformed config.json or schema-mismatch falls through to the dirs∪map layer; the resolver is best-effort and never throws on a user-supplied config (the path-traversal guard above is the only invariant enforced).
    } catch (err) {
      // totem-context: intentional cleanup — best-effort fallback to the dirs∪map layer on parse/read failures; dual placement so the rule fires on either the catch-keyword line or the catch-body line.
      void err;
    }
  }

  // Layer 3: seat dirs UNION the basename map. Union, not replace — on a
  // partial-dir fresh clone (orchestration is gitignored) a dirs-only answer
  // would vanish roster siblings that simply haven't written here yet, while
  // a map-only answer is the stale cache mmnto-ai/totem#2141 indicts (the
  // totem-codex exhibit: a registered dir invisible to mail). The tri-state
  // source keeps the derivation honest.
  const basename = path.basename(resolvedRoot);
  const mapped = COHORT_AGENT_MAP[basename] ?? [];
  const dirs = readSeatDirs(resolvedRoot);
  const dirSet = new Set(dirs);
  const mapExtra = mapped.filter((agent) => !dirSet.has(agent));
  if (dirs.length > 0) {
    return {
      agents: [...dirs, ...mapExtra].sort(),
      source: mapExtra.length > 0 ? 'dirs+map' : 'dirs',
    };
  }
  if (mapped.length > 0) {
    return { agents: [...mapped], source: 'map' };
  }

  return { agents: [], source: 'none' };
}
