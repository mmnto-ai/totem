/**
 * Network-read-only fetch edge for the Prop 296 §14 posture probes
 * (mmnto-ai/totem-strategy#962). The CLI EDGE owns the network — core's
 * `parity-detect.ts` keeps its module-wide never-networks + synchronous-pure
 * invariant, so this module resolves the per-repo, per-surface SNAPSHOTS the
 * pure detector then verdicts against.
 *
 * §14 hard edges honored here:
 *   1. Read-only, ever — every request is an authenticated `gh api` GET; nothing
 *      mutates ([Tenet 13]).
 *   2. Auth is the hard edge, rendered honestly — a missing/under-privileged
 *      token, an unreachable host, or a repo-scoped CI token that cannot see a
 *      sibling repo degrades to a per-SURFACE cannot-verify outcome
 *      (`auth`/`not-found`/`error`), never a drift verdict and never a
 *      manifest-wide outage. `no-transport` (gh absent / offline) is the distinct
 *      honest-absent (§14 clause 4) signal.
 *   3. Per-repo verdict lines — the roster resolves one snapshot per repo; the
 *      current repo (derived from the LOCAL git remote — no network) is always in
 *      the roster, cross-repo reads are opt-in via `orient.parityProbeRepos`.
 *   4. Offline degradation — gh unavailable ⇒ every surface `no-transport` ⇒
 *      every line renders as the honest-absent stub. NO retries.
 *
 * Transport is behind an INJECTABLE seam ({@link GhFetch}) so tests feed canned
 * JSON and NEVER spawn `gh`. The default spawns `gh api` via `safeExec` (arg
 * arrays, no `shell: true`, bounded timeout) — the git-subprocess pattern the
 * core detectors already use.
 */

import type {
  NetworkPostureRow,
  NetworkProbeRepoSnapshot,
  NetworkRepoSurfaces,
  NetworkSurfaceOutcome,
  NetworkSurfaceSnapshot,
} from '@mmnto/totem';

/** Bounded per-request `gh api` timeout (mirrors orient's GH adapters). */
const GH_TIMEOUT_MS = 15_000;

/**
 * The registry mapping a capability-probe contract id to its network-posture
 * row kind (mirrors `capabilityProbesFor` with a `default: undefined` → the
 * existing honest-skip stub). An unregistered id keeps the current
 * capability-probe path untouched. The identity mapping is the routing seam:
 * routing keys PRIMARILY on this id registry, not on the `probe-class` metadata.
 */
const NETWORK_POSTURE_ROW_IDS: Record<string, NetworkPostureRow> = {
  'repo-merge-posture': 'repo-merge-posture',
  'repo-required-checks-posture': 'repo-required-checks-posture',
  'repo-branch-protection-posture': 'repo-branch-protection-posture',
};

/** Resolve a contract id to its network-posture row kind, or undefined when unregistered. */
export function networkPostureRowFor(contractId: string): NetworkPostureRow | undefined {
  return NETWORK_POSTURE_ROW_IDS[contractId];
}

/** One fetched surface plus its outcome — what {@link GhFetch} returns. */
export interface GhFetchResult {
  outcome: NetworkSurfaceOutcome;
  /** Parsed JSON body when `outcome === 'ok'`. */
  data?: unknown;
  /** Optional render detail (e.g. `HTTP 403`). */
  detail?: string;
}

/**
 * Injectable transport seam: issue one read-only GitHub API GET against
 * `apiPath` (an absolute `/repos/...` path) from `cwd`. Tests inject a canned
 * implementation; production omits it and the default spawns `gh api`.
 */
export type GhFetch = (apiPath: string, cwd: string) => GhFetchResult;

/** Injectable local-remote reader (default `git remote get-url origin`). */
export type ReadRemote = (cwd: string) => string | undefined;

/** One network-posture row present in the manifest (id-derived row kind + its consumers scope). */
export interface NetworkRowSpec {
  row: NetworkPostureRow;
  consumers?: string[];
}

/** Options for {@link resolveNetworkSnapshots}. */
export interface ResolveNetworkSnapshotsOptions {
  /** The network-posture rows present in the manifest (drives which surfaces to fetch). */
  rows: NetworkRowSpec[];
  /** Current repo's cohort id (for `consumers` scoping of the current-repo slug). */
  repoId?: string;
  /** The git root the local remote is read from + `gh` runs in. */
  gitRoot: string;
  /** Optional cross-repo read set (`orient.parityProbeRepos`), each an `owner/repo` slug. */
  probeRepos?: string[];
  /** Injectable transport (default spawns `gh api`). */
  ghFetch?: GhFetch;
  /** Injectable local-remote reader (default reads `git remote get-url origin`). */
  readRemote?: ReadRemote;
}

/** Which surfaces a row needs fetched. */
interface SurfaceNeed {
  repoSettings: boolean;
  rulesets: boolean;
  branchProtection: boolean;
}

/** Per-row surface requirements. */
function surfaceNeedsFor(row: NetworkPostureRow): SurfaceNeed {
  switch (row) {
    case 'repo-merge-posture':
      return { repoSettings: true, rulesets: false, branchProtection: false };
    case 'repo-required-checks-posture':
      return { repoSettings: false, rulesets: true, branchProtection: false };
    case 'repo-branch-protection-posture':
      return { repoSettings: false, rulesets: true, branchProtection: true };
    default:
      return { repoSettings: false, rulesets: false, branchProtection: false };
  }
}

/** A roster repo to probe. */
interface RosterEntry {
  repoSlug: string;
  repoId: string;
}

/**
 * Resolve the per-repo, per-surface snapshots the network-posture detector
 * verdicts against. Fetches ONCE per (repo, surface) — the union of surfaces the
 * in-scope rows need for each repo — with NO caching and NO retries. Never
 * throws: a transport/auth failure becomes a per-surface outcome, never a crash.
 *
 * The function is async to keep the network step BEFORE the synchronous detector
 * dispatch (the default transport is a synchronous `gh api` spawn; the async
 * boundary future-proofs an async transport).
 */
export async function resolveNetworkSnapshots(
  options: ResolveNetworkSnapshotsOptions,
): Promise<NetworkProbeRepoSnapshot[]> {
  // Import `safeExec` once for the default transport/remote seams (idempotent,
  // cached; the dynamic import matches the doctor's other lazy `@mmnto/totem`
  // loads). When both seams are injected — the test path — the real spawn is
  // never invoked, so no `gh`/`git` subprocess runs.
  const { safeExec } = await import('@mmnto/totem');
  const ghFetch = options.ghFetch ?? makeDefaultGhFetch(safeExec);
  const readRemote = options.readRemote ?? makeDefaultReadRemote(safeExec);
  const roster = resolveRoster(options, readRemote);

  const snapshots: NetworkProbeRepoSnapshot[] = [];
  for (const entry of roster) {
    // Per-repo needed surfaces = union over the rows in scope for THIS repo
    // (a `consumers: [totem]` row contributes its surfaces only to totem).
    const need: SurfaceNeed = { repoSettings: false, rulesets: false, branchProtection: false };
    for (const spec of options.rows) {
      if (spec.consumers !== undefined && !spec.consumers.includes(entry.repoId)) continue;
      const rowNeed = surfaceNeedsFor(spec.row);
      need.repoSettings ||= rowNeed.repoSettings;
      need.rulesets ||= rowNeed.rulesets;
      need.branchProtection ||= rowNeed.branchProtection;
    }
    if (!need.repoSettings && !need.rulesets && !need.branchProtection) continue;

    snapshots.push({
      repoSlug: entry.repoSlug,
      repoId: entry.repoId,
      surfaces: fetchSurfaces(entry.repoSlug, need, ghFetch, options.gitRoot),
    });
  }
  return snapshots;
}

/** Build the roster: the current repo (local-remote-derived) plus any opt-in cross-repo slugs. */
function resolveRoster(
  options: ResolveNetworkSnapshotsOptions,
  readRemote: ReadRemote,
): RosterEntry[] {
  const entries: RosterEntry[] = [];
  const seen = new Set<string>();

  const currentSlug = deriveCurrentSlug(options, readRemote);
  if (currentSlug !== undefined) {
    entries.push({ repoSlug: currentSlug, repoId: options.repoId ?? repoSegment(currentSlug) });
    seen.add(currentSlug);
  }

  for (const raw of options.probeRepos ?? []) {
    const slug = raw.trim();
    if (slug.length === 0 || seen.has(slug)) continue;
    // A cross-repo entry's cohort id is the repo segment of its own slug.
    entries.push({ repoSlug: slug, repoId: repoSegment(slug) });
    seen.add(slug);
  }
  return entries;
}

/** Derive the current repo's `owner/repo` slug from the LOCAL git remote (no network). */
function deriveCurrentSlug(
  options: ResolveNetworkSnapshotsOptions,
  readRemote: ReadRemote,
): string | undefined {
  let url: string | undefined;
  try {
    url = readRemote(options.gitRoot);
    // totem-context: a missing remote / non-git dir / absent git binary is a routine fall-through (the current repo is simply not probed), not a sensor failure.
  } catch {
    url = undefined;
  }
  return slugFromRemoteUrl(url);
}

/** The repo segment of an `owner/repo` slug (the cohort id). */
function repoSegment(slug: string): string {
  const parts = slug.split('/');
  return parts[parts.length - 1] ?? slug;
}

/**
 * Extract `owner/repo` from an ssh (`git@host:owner/repo.git`) or https
 * (`https://host/owner/repo.git`) remote URL, tolerating a trailing `.git` and
 * slashes. Returns undefined when no `owner/repo` pair resolves.
 */
export function slugFromRemoteUrl(remoteUrl: string | undefined): string | undefined {
  if (typeof remoteUrl !== 'string' || remoteUrl.trim().length === 0) return undefined;
  const trimmed = remoteUrl
    .trim()
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  const match = /[/:]([^/:]+)\/([^/]+)$/.exec(trimmed);
  if (match === null) return undefined;
  const owner = match[1];
  const repo = match[2];
  if (owner === undefined || repo === undefined || owner.length === 0 || repo.length === 0) {
    return undefined;
  }
  return `${owner}/${repo}`;
}

/** Fetch the union of needed surfaces for one repo. */
function fetchSurfaces(
  slug: string,
  need: SurfaceNeed,
  ghFetch: GhFetch,
  cwd: string,
): NetworkRepoSurfaces {
  const surfaces: NetworkRepoSurfaces = {};

  // Repo settings double as the source of `default_branch` for classic branch
  // protection, so fetch it whenever either surface is needed.
  let repoResult: GhFetchResult | undefined;
  if (need.repoSettings || need.branchProtection) {
    repoResult = ghFetch(`/repos/${slug}`, cwd);
  }
  if (need.repoSettings && repoResult !== undefined) {
    surfaces.repoSettings = toSnapshot(repoResult);
  }

  if (need.rulesets) {
    surfaces.rulesets = fetchRulesetsSurface(slug, ghFetch, cwd);
  }

  if (need.branchProtection) {
    surfaces.branchProtection = fetchBranchProtectionSurface(slug, repoResult, ghFetch, cwd);
  }
  return surfaces;
}

/** Narrow a {@link GhFetchResult} to a {@link NetworkSurfaceSnapshot}. */
function toSnapshot(result: GhFetchResult): NetworkSurfaceSnapshot {
  return {
    outcome: result.outcome,
    ...(result.data !== undefined ? { data: result.data } : {}),
    ...(result.detail !== undefined ? { detail: result.detail } : {}),
  };
}

/**
 * The rulesets surface: list the repo's rulesets, then fetch each one's DETAIL
 * (the list omits conditions/rules/bypass_actors). The detail array is the
 * surface `data`. A list-level failure propagates its outcome; a per-detail 404
 * (ruleset deleted mid-read) is skipped; any other per-detail failure propagates
 * (conservative — a partial read cannot certify the union).
 */
function fetchRulesetsSurface(slug: string, ghFetch: GhFetch, cwd: string): NetworkSurfaceSnapshot {
  const list = ghFetch(`/repos/${slug}/rulesets?includes_parents=true`, cwd);
  if (list.outcome !== 'ok') return toSnapshot(list);

  const summaries = Array.isArray(list.data) ? list.data : [];
  const details: unknown[] = [];
  for (const summary of summaries) {
    const id = rulesetId(summary);
    if (id === undefined) continue;
    const detail = ghFetch(`/repos/${slug}/rulesets/${id}`, cwd);
    if (detail.outcome === 'ok') {
      details.push(detail.data);
      continue;
    }
    if (detail.outcome === 'not-found') continue; // deleted mid-read — omit
    // A non-404 per-detail failure means we cannot fully enumerate the union.
    return {
      outcome: detail.outcome,
      ...(detail.detail !== undefined ? { detail: detail.detail } : {}),
    };
  }
  return { outcome: 'ok', data: details };
}

/** Extract a ruleset id from a list-summary object. */
function rulesetId(summary: unknown): number | string | undefined {
  if (typeof summary !== 'object' || summary === null) return undefined;
  const id = (summary as { id?: unknown }).id;
  return typeof id === 'number' || typeof id === 'string' ? id : undefined;
}

/**
 * The classic-branch-protection surface: `GET …/branches/{default_branch}/protection`.
 * The default branch comes from the repo-settings read; when that read failed (or
 * omitted `default_branch`), the branch is unaddressable → propagate the
 * repo-settings failure (or an auth-class `unknown` for a field-shy 200).
 */
function fetchBranchProtectionSurface(
  slug: string,
  repoResult: GhFetchResult | undefined,
  ghFetch: GhFetch,
  cwd: string,
): NetworkSurfaceSnapshot {
  if (repoResult === undefined) {
    return { outcome: 'error', detail: 'repo settings unavailable — default branch unresolved' };
  }
  if (repoResult.outcome !== 'ok') return toSnapshot(repoResult);

  const defaultBranch = defaultBranchOf(repoResult.data);
  if (defaultBranch === undefined) {
    return {
      outcome: 'auth',
      detail: 'repo 200 without default_branch — cannot address branch protection (auth-class)',
    };
  }
  const encoded = defaultBranch
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  return toSnapshot(ghFetch(`/repos/${slug}/branches/${encoded}/protection`, cwd));
}

/** Read `default_branch` from a repo-settings payload, or undefined when absent/mis-typed. */
function defaultBranchOf(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const branch = (data as { default_branch?: unknown }).default_branch;
  return typeof branch === 'string' && branch.length > 0 ? branch : undefined;
}

// ─── Default transport (spawns `gh api`; never used in tests) ─────────────────

/** The `safeExec` signature the default seams close over (subset of core's export). */
type SafeExecFn = (
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv },
) => string;

/**
 * Build the default {@link GhFetch}: spawn `gh api <path>` via `safeExec` (arg
 * array, no shell, bounded timeout) and classify the outcome. `safeExec` is
 * injected (imported once in {@link resolveNetworkSnapshots}) so this module
 * stays ESM-clean and test-injectable.
 */
function makeDefaultGhFetch(safeExec: SafeExecFn): GhFetch {
  return (apiPath: string, cwd: string): GhFetchResult => {
    let raw: string;
    try {
      raw = safeExec('gh', ['api', apiPath, '-H', 'Accept: application/vnd.github+json'], {
        cwd,
        timeout: GH_TIMEOUT_MS,
        env: { ...process.env, GH_PROMPT_DISABLED: '1' },
      });
      // totem-context: a gh failure (no token, 4xx/5xx, offline, gh absent) is classified into a per-surface outcome (§14 clause 2/4), never rethrown — the sensor must degrade honestly, not crash.
    } catch (err) {
      return classifyGhError(err);
    }
    try {
      return { outcome: 'ok', data: JSON.parse(raw) };
      // totem-context: an unparseable 200 body is a transient `error` outcome (→ unknown), not a throw.
    } catch {
      return { outcome: 'error', detail: 'unparseable gh api response' };
    }
  };
}

/** Fields a `safeExec` throw carries (status/stderr) — mirrors core's `SafeExecErrorFields`. */
interface GhErrorShape {
  status?: number | null;
  stderr?: string;
  message?: string;
  cause?: unknown;
}

/**
 * Classify a `gh api` failure into a network-read-only outcome (§14 clause 2/4):
 *   - spawn failure (gh absent) → `no-transport` (offline honest-absent).
 *   - 401 / bad credentials / not-authenticated → `auth`.
 *   - 403 → `auth` unless it is a rate-limit (→ `error`, transient).
 *   - 404 → `not-found`.
 *   - 5xx / timeout / DNS → `error`.
 *   - anything else → `error` (transient), never a drift verdict.
 */
function classifyGhError(err: unknown): GhFetchResult {
  const e = (err ?? {}) as GhErrorShape;
  const stderr = `${e.stderr ?? ''} ${e.message ?? ''}`.toLowerCase();

  if (isSpawnFailure(e)) {
    return { outcome: 'no-transport', detail: 'gh not found — offline (§14 clause 4)' };
  }
  if (/http 401|bad credentials|requires authentication|gh auth login|not logged in/.test(stderr)) {
    return { outcome: 'auth', detail: 'HTTP 401 / not authenticated' };
  }
  if (/http 403/.test(stderr)) {
    return /rate limit/.test(stderr)
      ? { outcome: 'error', detail: 'HTTP 403 rate limited' }
      : { outcome: 'auth', detail: 'HTTP 403 — under-privileged token' };
  }
  if (/http 404|not found/.test(stderr)) {
    return { outcome: 'not-found', detail: 'HTTP 404' };
  }
  if (
    /http 5\d\d|timeout|timed out|could not resolve host|network is unreachable|econnreset|dial tcp/.test(
      stderr,
    )
  ) {
    return { outcome: 'error', detail: 'transient / unreachable host' };
  }
  // A gh with no token at all often reports an auth hint without an HTTP code.
  if (/authentication|gh auth|no token|token/.test(stderr)) {
    return { outcome: 'auth', detail: 'not authenticated' };
  }
  return { outcome: 'error', detail: 'gh api failed' };
}

/** True when the throw is a spawn-level failure (gh binary missing), not an HTTP error. */
function isSpawnFailure(e: GhErrorShape): boolean {
  const causeCode =
    typeof e.cause === 'object' && e.cause !== null
      ? (e.cause as { code?: unknown }).code
      : undefined;
  if (causeCode === 'ENOENT') return true;
  const msg = `${e.message ?? ''}`;
  // safeExec renders a spawn-level failure as `…: spawn failed` (no HTTP status).
  return /enoent|spawn failed/i.test(msg) && !/http \d{3}/i.test(msg);
}

/** Build the default local-remote reader: `git remote get-url origin` (swallowed to undefined on failure). */
function makeDefaultReadRemote(safeExec: SafeExecFn): ReadRemote {
  return (cwd: string): string | undefined => {
    try {
      return safeExec('git', ['remote', 'get-url', 'origin'], { cwd, timeout: GH_TIMEOUT_MS });
      // totem-context: a missing remote / non-git dir / absent git binary is a routine fall-through (the current repo is simply not probed), not a sensor failure.
    } catch {
      return undefined;
    }
  };
}
