// `totem orient` — derive session orientation from primitives (mmnto-ai/totem#2044, WS2).
//
// A DETERMINISTIC sensor (zero LLM, zero embedding): it derives "what's parked /
// in flight / open" from live `gh` / `git` / fs primitives — open PRs, open
// issues (with epic→child grouping), the GH Project board (in-flight only),
// `.totem/freeze.json`, and an index-freshness pointer — plus one new derived
// signal: a board↔issue coherence flag. Sibling to `totem triage` (LLM synthesis
// on top); they compose, not duplicate.
//
// Discipline (ported from the strategy seed tools/orient.cjs):
// - Fail loud, never drift (Tenet 4): an underivable section is an explicit
//   `⚠ could not derive` line / `{ error }` envelope — NEVER a silent empty.
// - Honest absence (Tenet 14): "not yet synced" / "no board configured" are
//   explicit states, not errors and not blanks.
// - Snapshot, not source (Tenet 20): every run re-derives; the output is a cache.
// - NO embedding/LanceDB path — this is what makes orient run green when
//   `@google/genai` is absent (it structurally dodges #2018).

import type { BoardItem } from '../adapters/github-cli-project.js';
import type { StandardIssueWithBody } from '../adapters/issue-adapter.js';
import type { StandardPrListItem } from '../adapters/pr-adapter.js';
import type { BoardIssueCoherenceFlag } from './orient-coherence.js';
import { flagBoardIssueDrift, isActiveBoardItem } from './orient-coherence.js';

// ─── Tunables ───────────────────────────────────────────

const ISSUE_LIMIT = 200;
const EPIC_LABEL = 'type: epic';
// Hide ai-workflow noise from the OTHER-issues label badges (matches the seed).
const NOISE_LABELS = new Set(['ai-workflow']);
// A registry entry older than this prints a [STALE] hint (matches `totem list`).
const STALE_MS = 30 * 24 * 60 * 60 * 1000;
// Matches "**Parent:** #N" AND fully-qualified "**Parent:** owner/repo#N".
// Group 1 captures the optional owner/repo prefix; group 2 the number. Only
// LOCAL parents (no prefix, or prefix == this repo's slug) attach children, so
// a cross-repo ref can't collide with a same-numbered LOCAL epic.
const PARENT_RE = /\*\*Parent:\*\*\s*([A-Za-z0-9._/-]+)?#(\d+)/;
// Validate the env-sourced project number so it can only ever be digits.
const PROJECT_NUMBER_RE = /^\d+$/;

// ─── Report shape (the `--json` surface) ────────────────

/** The `{ error }` envelope for an underivable section. The `error` key is the
 *  external JSON-API field name (same convention as `json-output.ts`). */
interface ErrorEnvelope {
  // eslint-disable-next-line id-match -- 'error' is the standard JSON API field name for external consumers
  error: string;
}

/** A section is EITHER its derived value OR an `{ error }` envelope — never silently omitted. */
type Section<T> = T | ErrorEnvelope;

export interface OrientParkedEntry {
  subsystem: string;
  since?: string;
  reason?: string;
  tracking?: string;
}

export interface OrientPr {
  number: number;
  title: string;
  headRefName: string;
  isDraft: boolean;
}

export interface OrientBoardItem {
  status: string;
  title: string;
  contentNumber?: number;
}

export interface OrientEpic {
  number: number;
  title: string;
  labels: string[];
  subIssues: { number: number; title: string }[];
}

export interface OrientOtherIssue {
  number: number;
  title: string;
  labels: string[];
}

/** Index-freshness pointer — either a derived staleness fact or an honest "not synced" absence. */
export interface OrientIndexFreshness {
  synced: boolean;
  /** Relative age of the registry `lastSync` (e.g. '2h ago'), when synced. */
  lastSync?: string;
  stale?: boolean;
}

export interface OrientReport {
  repo: Section<string>;
  derivedAt: string;
  indexFreshness: OrientIndexFreshness;
  parked: Section<OrientParkedEntry[]>;
  openPRs: Section<OrientPr[]>;
  board: Section<OrientBoardItem[]>;
  coherence: Section<BoardIssueCoherenceFlag[]>;
  epics: Section<OrientEpic[]>;
  otherOpenIssues: Section<OrientOtherIssue[]>;
  /** Whether a board project number is configured. Distinguishes the JSON's
   *  "no board configured" (false) from "board configured but empty" (true,
   *  `board: []`) — without it the two collapse to the same shape (Tenet 14). */
  boardConfigured: boolean;
}

// ─── Internal derived state ─────────────────────────────

interface RepoSlug {
  owner: string;
  name: string;
}

interface IssueDerivation {
  epics: OrientEpic[];
  others: OrientOtherIssue[];
  openNumbers: Set<number>;
}

interface DerivedState {
  repo: Section<string>;
  localSlug: string | null;
  indexFreshness: OrientIndexFreshness;
  parked: Section<OrientParkedEntry[]>;
  openPRs: Section<OrientPr[]>;
  board: Section<OrientBoardItem[]>;
  /** null when the board could not be derived → coherence can't be computed. */
  boardItems: BoardItem[] | null;
  issues: Section<IssueDerivation>;
  boardConfigured: boolean;
}

function isError<T>(s: Section<T>): s is ErrorEnvelope {
  return typeof s === 'object' && s !== null && 'error' in s;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── Per-section derivations (each fails in isolation) ──

const GH_TIMEOUT_MS = 20_000;

/**
 * Derive `{ owner, name }` for the current repo via `gh repo view`.
 *
 * Uses `safeExec` (an `execFileSync` wrapper with an argument array — no shell),
 * matching the codebase convention; static args only, so there is no injection
 * surface. Returns `{ error }` on failure (Tenet 4 — never a silent empty).
 */
async function deriveRepoSlug(cwd: string): Promise<{ slug: RepoSlug } | ErrorEnvelope> {
  try {
    const { safeExec } = await import('@mmnto/totem');
    const raw = safeExec('gh', ['repo', 'view', '--json', 'owner,name'], {
      cwd,
      timeout: GH_TIMEOUT_MS,
      env: { ...process.env, GH_PROMPT_DISABLED: '1' },
    });
    const parsed = JSON.parse(raw) as { owner?: { login?: string }; name?: string };
    if (!parsed.owner?.login || !parsed.name) {
      return { error: 'unexpected `gh repo view` shape' };
    }
    return { slug: { owner: parsed.owner.login, name: parsed.name } };
    // totem-context: a gh failure becomes a fail-loud { error } envelope (Tenet 4 — surfaced in the report, not swallowed); every other section still derives independently
  } catch (err) {
    return { error: errMessage(err) || 'gh repo view failed' };
  }
}

async function deriveParked(repoRoot: string): Promise<Section<OrientParkedEntry[]>> {
  try {
    const { readFreezeConfig } = await import('@mmnto/totem');
    const path = await import('node:path');
    const totemDir = path.join(repoRoot, '.totem');
    const config = readFreezeConfig(totemDir);
    if (!config) return [];
    return config.frozen.map((f) => ({
      subsystem: f.subsystem,
      since: f.since,
      reason: f.reason,
      tracking: f.tracking,
    }));
    // totem-context: a freeze-read failure becomes a fail-loud { error } envelope (Tenet 4 — surfaced, not swallowed)
  } catch (err) {
    return { error: errMessage(err) };
  }
}

async function derivePRs(cwd: string): Promise<Section<OrientPr[]>> {
  try {
    const { GitHubCliPrAdapter } = await import('../adapters/github-cli-pr.js');
    const adapter = new GitHubCliPrAdapter(cwd);
    const prs: StandardPrListItem[] = adapter.fetchOpenPRs();
    return prs.map((p) => ({
      number: p.number,
      title: p.title,
      headRefName: p.headRefName,
      isDraft: p.isDraft,
    }));
    // totem-context: a gh PR-list failure becomes a fail-loud { error } envelope (Tenet 4 — surfaced, not swallowed)
  } catch (err) {
    return { error: errMessage(err) };
  }
}

async function deriveIssues(
  cwd: string,
  localSlug: string | null,
): Promise<Section<IssueDerivation>> {
  let all: StandardIssueWithBody[];
  try {
    const { GitHubCliAdapter } = await import('../adapters/github-cli.js');
    const adapter = new GitHubCliAdapter(cwd);
    all = adapter.fetchOpenIssuesWithBody(ISSUE_LIMIT);
    // totem-context: a gh issue-list failure becomes a fail-loud { error } envelope (Tenet 4 — surfaced, not swallowed)
  } catch (err) {
    return { error: errMessage(err) };
  }

  const openNumbers = new Set(all.map((i) => i.number));

  // Build parent# → [child] from primitives (LOCAL parent refs only).
  const childOf = new Map<number, StandardIssueWithBody[]>();
  for (const it of all) {
    const m = (it.body || '').match(PARENT_RE);
    // Case-folded compare: GitHub owner/repo slugs are case-insensitive, so a
    // casing skew must not stop a child attaching to its LOCAL parent epic.
    if (m && (!m[1] || (localSlug && m[1].toLowerCase() === localSlug.toLowerCase()))) {
      const parent = Number(m[2]);
      const list = childOf.get(parent) ?? [];
      list.push(it);
      childOf.set(parent, list);
    }
  }

  const isEpic = (it: StandardIssueWithBody) => it.labels.includes(EPIC_LABEL);
  const epicIssues = all.filter(isEpic);
  const epicNums = new Set(epicIssues.map((e) => e.number));

  // A child is "covered" (omitted from OTHER) ONLY if its parent is a rendered
  // epic; a child whose parent isn't an epic stays in OTHER so it is never dropped.
  const coveredChildNums = new Set<number>();
  for (const [parent, kids] of childOf) {
    if (epicNums.has(parent)) kids.forEach((k) => coveredChildNums.add(k.number));
  }

  const epics: OrientEpic[] = epicIssues.map((e) => ({
    number: e.number,
    title: e.title,
    labels: e.labels,
    subIssues: (childOf.get(e.number) ?? []).map((c) => ({ number: c.number, title: c.title })),
  }));

  const others: OrientOtherIssue[] = all
    .filter((it) => !isEpic(it) && !coveredChildNums.has(it.number))
    .map((i) => ({ number: i.number, title: i.title, labels: i.labels }));

  return { epics, others, openNumbers };
}

interface BoardDerivation {
  section: Section<OrientBoardItem[]>;
  items: BoardItem[] | null;
  configured: boolean;
}

/** Project-number resolution: a positive int, an honest "no board configured"
 *  absence, or a LOUD set-but-malformed env state (Tenet 4 — never silent). */
type ProjectNumberResolution =
  | { kind: 'resolved'; projectNumber: number }
  | { kind: 'unconfigured' }
  | { kind: 'invalid'; raw: string };

/**
 * Resolve the project number (consumer-safety, Q5): config `orient.projectNumber`
 * → env `TOTEM_ORIENT_PROJECT` (last override). No project configured ⇒ honest
 * absence (`unconfigured`). A set-but-non-numeric env var is `invalid` — surfaced
 * loudly by the caller, NOT masqueraded as "no board configured" (Tenet 4).
 */
async function resolveProjectNumber(cwd: string): Promise<ProjectNumberResolution> {
  const env = process.env['TOTEM_ORIENT_PROJECT'];
  if (env !== undefined && env !== '') {
    // Explicitly-set-but-malformed ⇒ LOUD: a user who set it expects a board, so
    // don't degrade to silent "unconfigured" (the exact Tenet-4 drift greptile flagged).
    if (!PROJECT_NUMBER_RE.test(env)) return { kind: 'invalid', raw: env };
    return { kind: 'resolved', projectNumber: Number(env) };
  }
  // Optional config: orient must work even with NO totem.config.ts at all.
  try {
    const { loadConfig, resolveConfigPath } = await import('../utils.js');
    const configPath = resolveConfigPath(cwd);
    const config = await loadConfig(configPath);
    const projectNumber = config.orient?.projectNumber;
    return projectNumber === undefined
      ? { kind: 'unconfigured' }
      : { kind: 'resolved', projectNumber };
    // totem-context: intentional — a missing/unreadable totem.config.ts is honest board-absence (Tenet 14), not an orient failure
  } catch {
    // No config / unreadable config is not an orient failure — board absence
    // is the honest state. (resolveConfigPath throws when no config exists.)
    return { kind: 'unconfigured' };
  }
}

async function deriveBoard(cwd: string, owner: string | null): Promise<BoardDerivation> {
  const resolution = await resolveProjectNumber(cwd);
  if (resolution.kind === 'unconfigured') {
    return { section: [], items: null, configured: false };
  }
  if (resolution.kind === 'invalid') {
    // Fail loud (Tenet 4): a set-but-malformed TOTEM_ORIENT_PROJECT is an { error }
    // board section + configured:true, NOT a silent "no board configured" absence.
    return {
      section: {
        error: `TOTEM_ORIENT_PROJECT="${resolution.raw}" is not a positive integer (board not derived)`,
      },
      items: null,
      configured: true,
    };
  }
  const { projectNumber } = resolution;
  if (owner === null) {
    return {
      section: { error: 'board configured but repo owner could not be derived (gh repo view)' },
      items: null,
      configured: true,
    };
  }
  try {
    const { fetchBoardItems } = await import('../adapters/github-cli-project.js');
    const items = fetchBoardItems(owner, projectNumber, cwd);
    const active = items.filter(isActiveBoardItem).map((i) => ({
      status: i.status || 'Todo',
      title: i.title,
      contentNumber: i.contentNumber,
    }));
    return { section: active, items, configured: true };
    // totem-context: a gh board-fetch failure becomes a fail-loud { error } section envelope (Tenet 4 — surfaced, not swallowed)
  } catch (err) {
    return { section: { error: errMessage(err) }, items: null, configured: true };
  }
}

/**
 * Derive the index-freshness pointer INLINE from the registry `lastSync` for the
 * current repo root (Q1: no `@mmnto/cli`→`@mmnto/mcp` dependency). No registry
 * entry ⇒ honest "not yet synced" absence.
 */
async function deriveIndexFreshness(repoRoot: string): Promise<OrientIndexFreshness> {
  try {
    const { readRegistry } = await import('@mmnto/totem');
    const { formatRelativeTime } = await import('./list.js');
    const path = await import('node:path');
    const registry = readRegistry();
    const normalizedRoot = path.normalize(repoRoot);
    const entry = Object.values(registry).find((e) => path.normalize(e.path) === normalizedRoot);
    if (!entry) return { synced: false };
    const age = Date.now() - new Date(entry.lastSync).getTime();
    return { synced: true, lastSync: formatRelativeTime(age), stale: age > STALE_MS };
    // totem-context: intentional — an unreadable registry is honest "not synced" absence (Tenet 14) for a regenerable-cache pointer, not an orient failure
  } catch {
    // Registry unreadable → treat as not-synced honest absence, not an error
    // (it's a regenerable cache pointer, never load-bearing for orientation).
    return { synced: false };
  }
}

// ─── Orchestration ──────────────────────────────────────

async function derive(cwd: string): Promise<DerivedState> {
  const { resolveGitRoot } = await import('@mmnto/totem');
  const repoRoot = resolveGitRoot(cwd) ?? cwd;

  const slugResult = await deriveRepoSlug(cwd);
  const repo: Section<string> = isError(slugResult)
    ? { error: slugResult.error }
    : `${slugResult.slug.owner}/${slugResult.slug.name}`;
  const localSlug = isError(slugResult) ? null : `${slugResult.slug.owner}/${slugResult.slug.name}`;
  const owner = isError(slugResult) ? null : slugResult.slug.owner;

  const [indexFreshness, parked, openPRs, issues, board] = await Promise.all([
    deriveIndexFreshness(repoRoot),
    deriveParked(repoRoot),
    derivePRs(cwd),
    deriveIssues(cwd, localSlug),
    deriveBoard(cwd, owner),
  ]);

  return {
    repo,
    localSlug,
    indexFreshness,
    parked,
    openPRs,
    board: board.section,
    boardItems: board.items,
    issues,
    boardConfigured: board.configured,
  };
}

/** Coherence flags derive purely from the board + open-issue primitives (no extra gh call). */
function deriveCoherence(state: DerivedState): Section<BoardIssueCoherenceFlag[]> {
  if (isError(state.board)) return { error: state.board.error };
  if (isError(state.issues)) return { error: state.issues.error };
  if (state.boardItems === null) return [];
  return flagBoardIssueDrift(state.boardItems, state.issues.openNumbers, state.localSlug);
}

function toReport(state: DerivedState): OrientReport {
  const coherence = deriveCoherence(state);
  return {
    repo: state.repo,
    derivedAt: new Date().toISOString(),
    indexFreshness: state.indexFreshness,
    parked: state.parked,
    openPRs: state.openPRs,
    board: state.board,
    coherence,
    epics: isError(state.issues) ? { error: state.issues.error } : state.issues.epics,
    otherOpenIssues: isError(state.issues) ? { error: state.issues.error } : state.issues.others,
    boardConfigured: state.boardConfigured,
  };
}

/**
 * Programmatic entry: derive the full `OrientReport` for `cwd` WITHOUT writing
 * stdout. Identical report to `orient --json` (one derivation, two callers —
 * cannot diverge). Reused by `orientCommand` (the CLI surface) and the
 * SessionStart hook (`.claude/hooks/session-context.mjs`, mmnto-ai/totem#2044
 * PR-2), which dynamic-imports this from `packages/cli/dist/commands/orient.js`
 * — the workspace-dist pattern, deliberately NOT the global `totem` binary
 * (sidesteps the stale-resolve trap mmnto-ai/totem#2053).
 *
 * Latency note: orient's gh adapters are synchronous (`safeExec`/execFileSync),
 * so this runs ~4 sequential blocking gh calls (repo view + PRs + issues + board),
 * each bounded by the adapter's per-call timeout. Callers on a latency-sensitive
 * path (the hook) wrap it best-effort and degrade on failure.
 */
export async function deriveOrientReport(cwd: string): Promise<OrientReport> {
  const state = await derive(cwd);
  return toReport(state);
}

// ─── Human render ───────────────────────────────────────

const FOOTER = [
  '— end orient. State derives from the primitives above (Tenet 20); this output is a',
  '  snapshot/cache, not a source. Deeper judgment is perceptual: ask the human; no',
  '  deeper/fleet pass needed unless you are doing an audit (a different task).',
].join('\n');

function renderFreshness(f: OrientIndexFreshness): string {
  if (!f.synced) return '  freshness unknown — not yet synced (run `totem sync`)';
  return '  index synced ' + f.lastSync + (f.stale ? ' [STALE]' : '');
}

export function renderReport(report: OrientReport): string {
  const out: string[] = [];
  const repo = isError(report.repo) ? `(repo undetermined: ${report.repo.error})` : report.repo;
  out.push(`═══ totem orient — ${repo} ═══  derived ${report.derivedAt}`);
  out.push(
    '  (derived from primitives — open PRs / open issues / GH Project board / .totem/freeze.json)',
  );

  // PARKED
  out.push('\n⛔ PARKED / FROZEN  (.totem/freeze.json)');
  if (isError(report.parked)) out.push(`  ⚠ could not derive: ${report.parked.error}`);
  else if (report.parked.length === 0) out.push('  none');
  else
    for (const f of report.parked) {
      const reason = (f.reason || '').split('. ')[0];
      out.push(`  • ${f.subsystem} (since ${f.since || '?'})${reason ? ` — ${reason}` : ''}`);
      if (f.tracking) out.push(`      tracking: ${f.tracking}`);
    }

  // OPEN PRs
  out.push('\n◐ OPEN PRs');
  if (isError(report.openPRs)) out.push(`  ⚠ could not derive: ${report.openPRs.error}`);
  else if (report.openPRs.length === 0) out.push('  none');
  else
    for (const p of report.openPRs) {
      const head = `#${p.number}` + (p.isDraft ? ' [draft]' : '');
      out.push(`  ${head} ${p.title}  (${p.headRefName})`);
    }

  // BOARD in-flight
  out.push('\n▣ BOARD in-flight  (active statuses only)');
  if (isError(report.board)) out.push(`  ⚠ could not derive: ${report.board.error}`);
  else if (!report.boardConfigured)
    out.push('  no board configured (set orient.projectNumber in totem.config.ts)');
  else if (report.board.length === 0) out.push('  none (no items in an active status)');
  else
    for (const i of report.board) {
      const num = i.contentNumber ? `#${i.contentNumber} ` : '';
      out.push(`  [${i.status}] ${num}` + i.title);
    }

  // BOARD↔ISSUE COHERENCE (the new derived signal)
  out.push('\n⚖ BOARD↔ISSUE COHERENCE  (active card whose issue is closed/absent = drift)');
  if (isError(report.coherence)) out.push(`  ⚠ could not derive: ${report.coherence.error}`);
  else if (report.coherence.length === 0) out.push('  none (board and open issues are coherent)');
  else
    for (const c of report.coherence) {
      out.push(
        `  ⚠ [${c.boardStatus}] "${c.boardItemTitle}" → issue #${c.issueNumber} is closed/absent`,
      );
    }

  // EPICS + children
  out.push('\n✦ EPICS + sub-issues  (label "type: epic"; children via body Parent ref)');
  if (isError(report.epics)) out.push(`  ⚠ could not derive: ${report.epics.error}`);
  else if (report.epics.length === 0) out.push('  none');
  else
    for (const e of report.epics) {
      out.push(`  #${e.number} ${e.title}`);
      if (e.subIssues.length === 0) out.push('     (no tracked sub-issues)');
      else
        e.subIssues.forEach((c, idx) =>
          out.push(`     ${idx === e.subIssues.length - 1 ? '└' : '├'} #${c.number} ${c.title}`),
        );
    }

  // OTHER open issues
  out.push('\n● OTHER open issues  (non-epic, non-child)');
  if (isError(report.otherOpenIssues))
    out.push(`  ⚠ could not derive: ${report.otherOpenIssues.error}`);
  else if (report.otherOpenIssues.length === 0) out.push('  none');
  else
    for (const i of report.otherOpenIssues) {
      const labels = i.labels.filter((l) => !NOISE_LABELS.has(l));
      const labelTag = labels.length ? `  [${labels.join(', ')}]` : '';
      out.push(`  #${i.number} ${i.title}` + labelTag);
    }

  // INDEX FRESHNESS pointer (honest absence when never synced)
  out.push('\n⟳ INDEX FRESHNESS  (registry lastSync for this repo)');
  out.push(renderFreshness(report.indexFreshness));

  out.push('');
  out.push(FOOTER);
  return out.join('\n');
}

// ─── Session-start projection (the auto-injected Tier-A block) ──

// Bounds for the session-start orient block (mmnto-ai/totem#2044 PR-2).
// Binding guardrail (strategy charter 2026-06-01T0229Z, mmnto-ai/totem-strategy#467):
// the block must be HARD-BOUNDED so it can never displace high-value session
// content (journal carryforward, parked, inbound mail) past the hook's
// MAX_TOTAL_CHARS cap — favorable ordering alone is insufficient, a runaway block
// would itself crowd out high-value content. Net-neutral-or-positive on
// high-value-content truncation; truncation absorbs the low-value vector tail.
const SESSION_BLOCK_MAX_CHARS = 1500;
const SESSION_PARKED_CAP = 8;
const SESSION_PR_CAP = 10;
const SESSION_COHERENCE_CAP = 10;

/**
 * Compact projection of an `OrientReport` for auto-injection at session start.
 *
 * Emits ONLY high-signal state — parked/frozen subsystems, open PRs, and board↔
 * issue coherence drift — plus a one-line COUNTS pointer for epics/other-issues
 * (NOT the full enumeration: "pointers not bodies", mmnto-ai/totem-strategy#467
 * Tier-A discipline). An underivable section stays a `⚠ could not derive` line
 * (Tenet 4 — never a silent omit), so the projection inherits orient's fail-loud
 * contract. Hard-bounded by `SESSION_BLOCK_MAX_CHARS` (the guardrail above).
 *
 * Returns '' when there is nothing high-signal to surface (no parked, no PRs, no
 * drift, no derivable counts) so the hook can omit the block entirely rather than
 * inject an empty header.
 */
export function renderOrientForSession(report: OrientReport): string {
  const out: string[] = [];
  const repo = isError(report.repo) ? '(repo undetermined)' : report.repo;
  out.push(`── orient (derived state): ${repo} ──`);
  const headerLen = out.length;

  // PARKED / FROZEN — you must not touch these subsystems (high value).
  if (isError(report.parked)) {
    out.push(`⛔ parked: ⚠ could not derive: ${report.parked.error}`);
  } else if (report.parked.length > 0) {
    const shown = report.parked.slice(0, SESSION_PARKED_CAP).map((f) => f.subsystem);
    const more = report.parked.length > SESSION_PARKED_CAP ? ' …' : '';
    out.push(`⛔ parked/frozen (${report.parked.length}): ${shown.join(', ')}` + more);
  }

  // OPEN PRs — what's in flight.
  if (isError(report.openPRs)) {
    out.push(`◐ open PRs: ⚠ could not derive: ${report.openPRs.error}`);
  } else if (report.openPRs.length > 0) {
    for (const p of report.openPRs.slice(0, SESSION_PR_CAP)) {
      const draft = p.isDraft ? ' [draft]' : '';
      out.push(`◐ PR #${p.number}` + draft + ` ${p.title} (${p.headRefName})`);
    }
    if (report.openPRs.length > SESSION_PR_CAP) {
      out.push(`  … and ${report.openPRs.length - SESSION_PR_CAP} more open PRs`);
    }
  }

  // BOARD↔ISSUE COHERENCE drift — the anomaly signal (active card, issue closed/absent).
  if (isError(report.coherence)) {
    out.push(`⚖ coherence: ⚠ could not derive: ${report.coherence.error}`);
  } else if (report.coherence.length > 0) {
    for (const c of report.coherence.slice(0, SESSION_COHERENCE_CAP)) {
      out.push(
        `⚖ drift: [${c.boardStatus}] "${c.boardItemTitle}" → #${c.issueNumber} closed/absent`,
      );
    }
    if (report.coherence.length > SESSION_COHERENCE_CAP) {
      out.push(`  … and ${report.coherence.length - SESSION_COHERENCE_CAP} more drift flags`);
    }
  }

  // COUNTS pointer — NOT the enumeration (Tier-A lean: the agent runs `totem
  // orient` on demand for the full epic/issue board). One fail-loud line if the
  // issue derivation failed — epics + otherOpenIssues share `deriveIssues`, so
  // they error together with the same message; surface it once, never drop it
  // silently (Tenet 4). A zero count emits nothing (no "0 epics" noise).
  if (isError(report.epics)) {
    out.push(`● issues: ⚠ could not derive: ${report.epics.error}`);
  } else {
    // `epics` and `otherOpenIssues` share `deriveIssues`, so `toReport` errors
    // them together today — but the type (`Section<...>`) permits an independent
    // split. Surface an errored `otherOpenIssues` explicitly rather than silently
    // coercing its count to 0 (Tenet 4 — never a silent omit, even type-only).
    if (isError(report.otherOpenIssues)) {
      out.push(`● other open issues: ⚠ could not derive: ${report.otherOpenIssues.error}`);
    }
    const epicCount = report.epics.length;
    const otherCount = isError(report.otherOpenIssues) ? 0 : report.otherOpenIssues.length;
    const parts: string[] = [];
    if (epicCount > 0) parts.push(`${epicCount} epic${epicCount === 1 ? '' : 's'}`);
    if (otherCount > 0) {
      parts.push(`${otherCount} other open issue${otherCount === 1 ? '' : 's'}`);
    }
    if (parts.length > 0) {
      out.push(`● ${parts.join(' · ')} — run \`totem orient\` for the full board`);
    }
  }

  // Nothing high-signal beyond the header ⇒ let the hook omit the block.
  if (out.length === headerLen) return '';

  const block = out.join('\n');
  return block.length > SESSION_BLOCK_MAX_CHARS
    ? block.slice(0, SESSION_BLOCK_MAX_CHARS) + '\n  …(orient block truncated)'
    : block;
}

// ─── Command entry ──────────────────────────────────────

export async function orientCommand(opts: { json?: boolean; session?: boolean }): Promise<void> {
  const cwd = process.cwd();

  // Session-render mode (mmnto-ai/totem#2044 PR-3): emit ONLY the bounded
  // `renderOrientForSession` projection so a SessionStart hook can inject it.
  // The third caller of the single `deriveOrientReport` derivation (alongside
  // `orient --json`, the human render, and the PR-2 in-process hook
  // `session-context.mjs:buildOrientBlock`) — they cannot diverge.
  //
  // Boot-safety contract (lesson 8d363778): a SessionStart consumer must never
  // have its boot crashed by orient. On ANY failure, write a stderr breadcrumb
  // and NOTHING to stdout (the hook simply omits the block) — never throw, never
  // exit non-zero. An empty block (nothing high-signal) likewise emits nothing,
  // so the hook omits it rather than printing a bare header. Checked before
  // `--json` so a `--session --json` invocation stays in the boot-safe path.
  if (opts.session === true) {
    try {
      // --session is the hook render contract (raw text) and takes precedence over
      // --json; surface the ignored flag on stderr rather than dropping it silently
      // (mmnto-ai/totem#2062 greptile G2). Kept INSIDE the boot-safe try so it can never crash the
      // hook, and on stderr so it never pollutes the session block on stdout.
      const { isJsonMode } = await import('../json-output.js');
      if (opts.json === true || isJsonMode()) {
        process.stderr.write('[orient] --session takes precedence over --json; --json ignored\n');
      }
      const report = await deriveOrientReport(cwd);
      const block = renderOrientForSession(report);
      if (block) process.stdout.write(block + '\n');
      // Boot-safe degradation: a SessionStart hook must never crash the agent's
      // boot (lesson 8d363778), so this catch must NOT rethrow. The failure is
      // surfaced LOUDLY via the stderr breadcrumb below (Tenet 4 satisfied by
      // REPORTING, not propagating) and stdout stays empty so the hook omits the
      // block. Mirrors the sibling session-context.mjs:buildOrientBlock (PR-2).
      // totem-context: intentional boot-safe degradation, not a fail-open swallow.
    } catch (err) {
      process.stderr.write(
        `[orient] session block skipped: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
    return;
  }

  // Honor the subcommand flag AND the root program's global `--json` (commander
  // routes a leading `--json` to the root option; the root sets this env). Same
  // dual-source pattern other JSON-emitting commands use.
  const { isJsonMode } = await import('../json-output.js');
  const json = opts.json === true || isJsonMode();

  const report = await deriveOrientReport(cwd);

  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }
  process.stdout.write(renderReport(report) + '\n');
}
