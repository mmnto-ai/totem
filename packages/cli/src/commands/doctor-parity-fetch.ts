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
 *
 * The two 472-charter orientation rows (mmnto-ai/totem#2791) join the same
 * family here: `gh-issue-label-canon` adds a paginated REST label walk plus the
 * roster-wide canon text ({@link resolveLabelCanon}), and
 * `gh-project-vocabulary` adds a second read-only transport ({@link GhGraphql})
 * for the bound project's single-select fields. Both keep the §14 edges above:
 * read-only, per-surface honest degradation, no retries, never partial.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  NetworkPostureRow,
  NetworkProbeRepoSnapshot,
  NetworkRepoSurfaces,
  NetworkSurfaceOutcome,
  NetworkSurfaceSnapshot,
  ProjectBinding,
} from '@mmnto/totem';

/** Bounded per-request `gh api` timeout (mirrors orient's GH adapters). */
const GH_TIMEOUT_MS = 15_000;

/** Page size for the labels REST walk (the API max). */
const LABELS_PER_PAGE = 100;

/**
 * Hard ceiling on the labels walk. Beyond it the WHOLE surface degrades to
 * `error` — never a partial list (the rulesets-boundary precedent: an
 * undercount would let the detector certify conformance from a truncated read).
 */
const LABELS_MAX_PAGES = 10;

/** `first:` page size for the project single-select field read. */
const PROJECT_FIELDS_FIRST = 50;

/** The repo owning the canonical label script. */
const LABEL_CANON_REPO = 'mmnto-ai/totem';

/** The canonical label script's repo-relative path. */
const LABEL_CANON_PATH = 'scripts/sync-labels.ps1';

/** Detail prefix for a failed canonical (non-local) canon fetch. */
const LABEL_CANON_FETCH_PREFIX = `canonical fetch ${LABEL_CANON_REPO}:${LABEL_CANON_PATH}: `;

/** Short-sha length used in the canon's provenance detail. */
const CANON_SHA_LENGTH = 7;

/** Max chars of a GraphQL error message carried into a surface detail. */
const GRAPHQL_DETAIL_MAX = 120;

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
  'gh-issue-label-canon': 'gh-issue-label-canon',
  'gh-project-vocabulary': 'gh-project-vocabulary',
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

/**
 * Injectable GraphQL transport seam: issue one read-only `gh api graphql` query
 * from `cwd`. Same degradation contract as {@link GhFetch} — a transport throw
 * classifies through {@link classifyGhError}, and a 200 body carrying `errors`
 * classifies through {@link classifyGraphqlBody} (GraphQL reports authorization
 * and not-found failures in the BODY, not the HTTP status).
 */
export type GhGraphql = (
  query: string,
  variables: Record<string, string | number>,
  cwd: string,
) => GhFetchResult;

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
  /**
   * The CURRENT repo's bound GH Project number (`orient.projectNumber`). Only
   * the current repo's binding is locally derivable — a sibling's config is not
   * a surface this checkout reads (mmnto-ai/totem#2791).
   */
  projectNumber?: number;
  /** Injectable transport (default spawns `gh api`). */
  ghFetch?: GhFetch;
  /** Injectable GraphQL transport (default spawns `gh api graphql`). */
  ghGraphql?: GhGraphql;
  /** Injectable local-remote reader (default reads `git remote get-url origin`). */
  readRemote?: ReadRemote;
}

/** Which surfaces a row needs fetched. */
interface SurfaceNeed {
  repoSettings: boolean;
  rulesets: boolean;
  branchProtection: boolean;
  labels: boolean;
  projectFields: boolean;
}

/** A zero need — the per-repo accumulator's starting point. */
function noSurfaceNeed(): SurfaceNeed {
  return {
    repoSettings: false,
    rulesets: false,
    branchProtection: false,
    labels: false,
    projectFields: false,
  };
}

/** True when at least one surface is needed. */
function anySurfaceNeeded(need: SurfaceNeed): boolean {
  return (
    need.repoSettings || need.rulesets || need.branchProtection || need.labels || need.projectFields
  );
}

/** Per-row surface requirements. */
function surfaceNeedsFor(row: NetworkPostureRow): SurfaceNeed {
  const need = noSurfaceNeed();
  switch (row) {
    case 'repo-merge-posture':
      return { ...need, repoSettings: true };
    case 'repo-required-checks-posture':
      return { ...need, rulesets: true };
    case 'repo-branch-protection-posture':
      return { ...need, rulesets: true, branchProtection: true };
    case 'gh-issue-label-canon':
      return { ...need, labels: true };
    case 'gh-project-vocabulary':
      return { ...need, projectFields: true };
    default:
      return need;
  }
}

/** A roster repo to probe. */
interface RosterEntry {
  repoSlug: string;
  repoId: string;
  /** True ONLY for the local-remote-derived entry (cross-repo probes are false). */
  current: boolean;
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
  const ghGraphql = options.ghGraphql ?? makeDefaultGhGraphql(safeExec);
  const readRemote = options.readRemote ?? makeDefaultReadRemote(safeExec);
  const roster = resolveRoster(options, readRemote);

  const snapshots: NetworkProbeRepoSnapshot[] = [];
  for (const entry of roster) {
    // Per-repo needed surfaces = union over the rows in scope for THIS repo
    // (a `consumers: [totem]` row contributes its surfaces only to totem).
    const need = noSurfaceNeed();
    let vocabularyInScope = false;
    for (const spec of options.rows) {
      if (spec.consumers !== undefined && !spec.consumers.includes(entry.repoId)) continue;
      if (spec.row === 'gh-project-vocabulary') vocabularyInScope = true;
      const rowNeed = surfaceNeedsFor(spec.row);
      need.repoSettings ||= rowNeed.repoSettings;
      need.rulesets ||= rowNeed.rulesets;
      need.branchProtection ||= rowNeed.branchProtection;
      need.labels ||= rowNeed.labels;
      need.projectFields ||= rowNeed.projectFields;
    }
    // The project BINDING is part of the snapshot only when the vocabulary row
    // is in scope here — every other snapshot keeps its exact prior shape.
    const project = vocabularyInScope ? projectBindingFor(entry, options.projectNumber) : undefined;
    // Only a BOUND project is addressable: an unbound current repo / a sibling
    // renders honest-absent in the detector, so nothing is read for it.
    if (project?.kind !== 'bound') need.projectFields = false;
    // A repo whose only in-scope row is the vocabulary row still gets a
    // snapshot (binding, no surfaces) so the detector can render its line.
    if (!anySurfaceNeeded(need) && project === undefined) continue;

    snapshots.push({
      repoSlug: entry.repoSlug,
      repoId: entry.repoId,
      surfaces: fetchSurfaces(entry.repoSlug, need, ghFetch, ghGraphql, options.gitRoot, project),
      ...(project !== undefined ? { project } : {}),
    });
  }
  return snapshots;
}

/**
 * The project binding for one roster repo: the current repo binds
 * `orient.projectNumber` under its own owner; an unset number is `unbound`; a
 * cross-repo probe is `sibling` (its binding lives in ITS checkout's config,
 * which this doctor does not read).
 */
function projectBindingFor(entry: RosterEntry, projectNumber: number | undefined): ProjectBinding {
  if (!entry.current) return { kind: 'sibling' };
  if (projectNumber === undefined) return { kind: 'unbound' };
  return { kind: 'bound', owner: ownerSegment(entry.repoSlug), number: projectNumber };
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
    entries.push({
      repoSlug: currentSlug,
      repoId: options.repoId ?? repoSegment(currentSlug),
      current: true,
    });
    seen.add(currentSlug);
  }

  for (const raw of options.probeRepos ?? []) {
    const slug = raw.trim();
    if (slug.length === 0 || seen.has(slug)) continue;
    // A cross-repo entry's cohort id is the repo segment of its own slug.
    entries.push({ repoSlug: slug, repoId: repoSegment(slug), current: false });
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

/** The owner segment of an `owner/repo` slug (the GH Project's org login). */
function ownerSegment(slug: string): string {
  const parts = slug.split('/');
  return parts[0] ?? slug;
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
  ghGraphql: GhGraphql,
  cwd: string,
  project: ProjectBinding | undefined,
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

  if (need.labels) {
    surfaces.labels = fetchLabelsSurface(slug, ghFetch, cwd);
  }

  // `need.projectFields` is already gated on a BOUND binding by the caller; the
  // narrowing here is what carries owner/number into the query.
  if (need.projectFields && project !== undefined && project.kind === 'bound') {
    surfaces.projectFields = fetchProjectFieldsSurface(
      project.owner,
      project.number,
      ghGraphql,
      cwd,
    );
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
  // per_page=100 (the API max). Deliberately NOT `--paginate`: paged gh output
  // concatenates JSON documents (or needs --slurp, a newer-gh dependency); the
  // boundary sentinel below keeps the never-silently-undercount invariant
  // instead (CR round 1) — a repo at the cap degrades to cannot-verify, never
  // to a partial union.
  const list = ghFetch(`/repos/${slug}/rulesets?includes_parents=true&per_page=100`, cwd);
  if (list.outcome !== 'ok') return toSnapshot(list);

  // A non-array 200 payload must degrade to cannot-verify — coercing it to []
  // would let the detector certify "no rulesets" from garbage (greptile P1).
  if (!Array.isArray(list.data)) {
    return { outcome: 'error', detail: 'unparseable rulesets list response' };
  }
  const summaries = list.data;
  if (summaries.length >= 100) {
    return {
      outcome: 'error',
      detail:
        'rulesets list at the pagination boundary (100) — possible truncation, cannot certify the union',
    };
  }
  const details: unknown[] = [];
  for (const summary of summaries) {
    const id = rulesetId(summary);
    if (id === undefined) {
      // An id-less entry cannot be detail-fetched — a partial read cannot
      // certify the union (same posture as the per-detail failure below).
      return {
        outcome: 'error',
        detail: 'ruleset list entry without a usable id — cannot enumerate the union',
      };
    }
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

/**
 * The labels surface: walk `GET /repos/<slug>/labels?per_page=100&page=N` until
 * a page returns fewer than a full page. NEVER partial — a non-ok page
 * propagates its outcome, a non-array page degrades, and a walk that reaches the
 * page cap degrades the WHOLE surface (an undercount would let the detector
 * certify canon-conformance from a truncated list).
 */
function fetchLabelsSurface(slug: string, ghFetch: GhFetch, cwd: string): NetworkSurfaceSnapshot {
  const all: unknown[] = [];
  for (let page = 1; page <= LABELS_MAX_PAGES; page += 1) {
    const result = ghFetch(`/repos/${slug}/labels?per_page=${LABELS_PER_PAGE}&page=${page}`, cwd);
    if (result.outcome !== 'ok') return toSnapshot(result);
    if (!Array.isArray(result.data)) {
      return { outcome: 'error', detail: 'unparseable labels page' };
    }
    all.push(...result.data);
    if (result.data.length < LABELS_PER_PAGE) return { outcome: 'ok', data: all };
  }
  return {
    outcome: 'error',
    detail: `label list exceeds ${LABELS_MAX_PAGES * LABELS_PER_PAGE} — cannot certify`,
  };
}

/**
 * The bound project's single-select vocabulary. `hasNextPage` rides in the body
 * so the detector (not this edge) decides that an overflowed field list cannot
 * certify — the edge stays a transport.
 */
const PROJECT_FIELDS_QUERY = `query($org: String!, $number: Int!) { organization(login: $org) { projectV2(number: $number) { title fields(first: ${PROJECT_FIELDS_FIRST}) { pageInfo { hasNextPage } nodes { ... on ProjectV2SingleSelectField { name options { name } } } } } } }`;

/** Read the bound project's single-select fields (one GraphQL query). */
function fetchProjectFieldsSurface(
  owner: string,
  number: number,
  ghGraphql: GhGraphql,
  cwd: string,
): NetworkSurfaceSnapshot {
  return toSnapshot(ghGraphql(PROJECT_FIELDS_QUERY, { org: owner, number }, cwd));
}

/** Seams + anchor for {@link resolveLabelCanon}. */
export interface ResolveLabelCanonOptions {
  /** The git root the local read is anchored at + `gh` runs in. */
  gitRoot: string;
  /** Current repo's cohort id — `totem` reads the canon from this checkout. */
  repoId?: string;
  /** Transport for the canonical (non-totem) read. Tests inject; production builds one. */
  ghFetch?: GhFetch;
  /** Test seam for the local read (default: UTF-8 `readFileSync`). */
  readFile?: (absPath: string) => string;
}

/**
 * Resolve the ROSTER-WIDE label canon: the TEXT of
 * `mmnto-ai/totem:scripts/sync-labels.ps1`, plus a `detail` naming its
 * provenance. In the totem checkout the file is local (no network, no rate
 * limit); every other repo reads the canonical blob over the contents API and
 * discloses the blob sha. Parsing happens in core (Tenet 20) — this only
 * resolves TEXT. Never throws: an unreadable canon is a cannot-verify outcome.
 */
export function resolveLabelCanon(options: ResolveLabelCanonOptions): NetworkSurfaceSnapshot {
  if (options.repoId === 'totem') {
    const readFile = options.readFile ?? ((absPath: string) => fs.readFileSync(absPath, 'utf-8'));
    try {
      const text = readFile(path.join(options.gitRoot, ...LABEL_CANON_PATH.split('/')));
      return { outcome: 'ok', data: text, detail: `local checkout ${LABEL_CANON_PATH}` };
      // totem-context: an absent/unreadable script in this checkout is a cannot-verify outcome for the canon (the detector renders `unknown`), never a throw and never a conformance verdict.
    } catch (err) {
      void err;
      return { outcome: 'error', detail: `local checkout ${LABEL_CANON_PATH} unreadable` };
    }
  }

  const ghFetch = options.ghFetch;
  if (ghFetch === undefined) {
    return { outcome: 'no-transport', detail: `${LABEL_CANON_FETCH_PREFIX}no transport` };
  }
  const result = ghFetch(
    `/repos/${LABEL_CANON_REPO}/contents/${LABEL_CANON_PATH}`,
    options.gitRoot,
  );
  if (result.outcome !== 'ok') {
    return {
      outcome: result.outcome,
      detail: `${LABEL_CANON_FETCH_PREFIX}${result.detail ?? result.outcome}`,
    };
  }
  const contents = narrowContentsResponse(result.data);
  if (contents === undefined) {
    return { outcome: 'error', detail: 'unparseable contents response' };
  }
  // The API wraps the base64 payload at 60 columns and the script itself is
  // CRLF — `Buffer.from(…, 'base64')` skips the wrapping newlines and the
  // decoded bytes keep their own line endings verbatim.
  const text = Buffer.from(contents.content, 'base64').toString('utf8');
  return {
    outcome: 'ok',
    data: text,
    detail: `${LABEL_CANON_REPO}:${LABEL_CANON_PATH}@${contents.sha.slice(0, CANON_SHA_LENGTH)}`,
  };
}

/** Narrow a contents-API 200 to the base64 payload we can decode, else undefined. */
function narrowContentsResponse(data: unknown): { content: string; sha: string } | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const body = data as { content?: unknown; encoding?: unknown; sha?: unknown };
  if (body.encoding !== 'base64') return undefined;
  if (typeof body.content !== 'string' || typeof body.sha !== 'string') return undefined;
  return { content: body.content, sha: body.sha };
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

/**
 * Build the production {@link GhFetch} for callers OUTSIDE
 * {@link resolveNetworkSnapshots} (e.g. the label-canon resolution in
 * `doctor-parity.ts`). Async only because `safeExec` is lazily imported — the
 * returned transport is synchronous, and NOTHING spawns until it is called, so
 * a test that never calls it never touches `gh`.
 */
export async function defaultGhFetch(): Promise<GhFetch> {
  const { safeExec } = await import('@mmnto/totem');
  return makeDefaultGhFetch(safeExec);
}

/**
 * Build the default {@link GhGraphql}: `gh api graphql -f query=… -f/-F k=v`
 * (a `-F` variable is sent typed, which the `$number: Int!` argument requires).
 * Read-only like the REST default; a spawn/HTTP failure classifies through
 * {@link classifyGhError}, and a 200 body classifies through
 * {@link classifyGraphqlBody}.
 */
function makeDefaultGhGraphql(safeExec: SafeExecFn): GhGraphql {
  return (
    query: string,
    variables: Record<string, string | number>,
    cwd: string,
  ): GhFetchResult => {
    const args = ['api', 'graphql', '-f', `query=${query}`];
    for (const [key, value] of Object.entries(variables)) {
      args.push(typeof value === 'number' ? '-F' : '-f', `${key}=${value}`);
    }
    let raw: string;
    try {
      raw = safeExec('gh', args, {
        cwd,
        timeout: GH_TIMEOUT_MS,
        env: { ...process.env, GH_PROMPT_DISABLED: '1' },
      });
      // totem-context: a gh failure (no token, 4xx/5xx, offline, gh absent) is classified into a per-surface outcome (§14 clause 2/4), never rethrown — the sensor must degrade honestly, not crash.
    } catch (err) {
      return classifyGhError(err);
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
      // totem-context: an unparseable 200 body is a transient `error` outcome (→ unknown), not a throw.
    } catch {
      return { outcome: 'error', detail: 'unparseable gh api graphql response' };
    }
    return classifyGraphqlBody(body);
  };
}

/**
 * Classify a GraphQL 200 BODY (GraphQL reports authorization + not-found in the
 * body, not the HTTP status). ANY `errors` entry is decisive: GraphQL returns
 * partial data beside its errors (a nested FORBIDDEN, a node-limit hit, a
 * SERVICE_UNAVAILABLE on one field), and a partial field list verdicted as if
 * complete is a drift verdict on a cannot-verify read — the one outcome §14
 * clause 2 forbids (falsification pass 1, F1: a FORBIDDEN body with a half-read
 * project rendered "Priority: field absent"). Pure: no I/O, exported for test.
 */
export function classifyGraphqlBody(body: unknown): GhFetchResult {
  const errors = graphqlErrorsOf(body);
  if (errors.length === 0) {
    return { outcome: 'ok', data: body };
  }
  const haystack = errors
    .map(
      (e) =>
        `${typeof e.message === 'string' ? e.message : ''} ${typeof e.type === 'string' ? e.type : ''}`,
    )
    .join(' ');
  const first = errors.find((e) => typeof e.message === 'string' && e.message.length > 0);
  const detail = (typeof first?.message === 'string' ? first.message : 'graphql error').slice(
    0,
    GRAPHQL_DETAIL_MAX,
  );
  if (/permission|scope|not accessible|FORBIDDEN|INSUFFICIENT_SCOPES/i.test(haystack)) {
    return { outcome: 'auth', detail };
  }
  if (/NOT_FOUND|could not resolve/i.test(haystack)) {
    return { outcome: 'not-found', detail };
  }
  return { outcome: 'error', detail };
}

/** The `errors` array of a GraphQL body (empty when absent / mis-shaped). */
function graphqlErrorsOf(body: unknown): { message?: unknown; type?: unknown }[] {
  if (typeof body !== 'object' || body === null) return [];
  const errors = (body as { errors?: unknown }).errors;
  if (!Array.isArray(errors)) return [];
  return errors.filter((e): e is { message?: unknown; type?: unknown } => {
    return typeof e === 'object' && e !== null;
  });
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
