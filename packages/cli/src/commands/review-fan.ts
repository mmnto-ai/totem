/**
 * Multi-lane review fan, round chaining, predicates, and verdict emission
 * (Prop 304 R2, mmnto-ai/totem#2106).
 *
 * This module owns everything that turns `review.lanes` into a Prop 302 verdict
 * artifact: the config validator, the strict per-lane runner wrapper over
 * `runOrchestrator`, the #2104 panel + #2103 post-check wiring, the round-chain
 * lineage bookkeeping, the two derived predicates (`settled` and cache
 * eligibility), and the verdict emission + report line. `shieldCommand` calls
 * `runReviewFan` on the standard review path when lanes are configured; the
 * legacy single-lane path is untouched (invariant 7).
 *
 * The whole loop state machine lives here in the CLI (Tenet 16): any agent
 * driving `totem review` gets identical round-chaining/settle capability — the
 * `review-loop` skill is a thin driver, never a state owner.
 *
 * ── TWO HASH DOMAINS (codex fold 1, load-bearing) ────────────────────────────
 * `diffScope.diffHash` (the MASKED review-payload identity — what the lanes
 * reviewed) and `.reviewed-content-hash` (the extension-scoped tracked-source
 * hash that authorizes a push) bind DIFFERENT state and are never equal. The
 * caller captures the content hash once PRE-fan; the fan re-hashes ONCE POST-fan,
 * derives `reviewedState` from that single compare, and reuses it for BOTH the
 * verdict field and the stamp decision (codex rev-2 fold 1). Drift ⇒
 * `reviewedState='drifted'` ⇒ `settled=false` AND cache-ineligible; the fan
 * stamps the pre-fan hash directly via `writeReviewedContentHashValue` (bypassing
 * `stampReviewedContentHashIfTreeUnchanged`, whose recompute would be a second,
 * divergent compare — the single-lane path still uses that helper).
 */

import type {
  GroundingBundle,
  LineageKeyInput,
  PersistedPostCheckFinding,
  PostCheckReport,
  PostCheckRule,
  RunArtifact,
  TotemConfig,
  VerdictArtifact,
  VerdictDiffScope,
  VerdictLane,
  VerdictRound,
} from '@mmnto/totem';
import { TotemConfigError, VERDICT_ARTIFACT_SCHEMA_VERSION } from '@mmnto/totem';

import type { ExemptionShared } from '../exemptions/exemption-schema.js';
import {
  assertValidModelName,
  KNOWN_PROVIDERS,
  parseModelString,
} from '../orchestrators/orchestrator.js';
import {
  computeReviewedContentHash,
  deriveLaneOutcome,
  extractStructuredVerdict,
  writeReviewedContentHashValue,
} from './shield.js';
import { DISPLAY_TAG, MAX_DIFF_CHARS, type ShieldFinding, TAG } from './shield-templates.js';

/**
 * Round index at/above which the advisory max-rounds sensor line fires. A
 * constant (never a config knob this slice) — advisory only, NEVER a block.
 */
export const MAX_ROUNDS_ADVISORY = 5;

// ─── Config validation (item 1) ─────────────────────────────────────────────

/**
 * Validate a configured `review.lanes` array at review startup — a hard init
 * error on any violation (Prop 304 R2 config boundary; codex fold 7). Reuses
 * the CLI's `assertValidModelName` (shell-injection + leading-dash gate) and
 * `parseModelString`, so a lane accepted here resolves identically at invoke.
 *
 * Rules (design item 1):
 *   - every entry must be a known `provider:model` (a `:`-prefixed known
 *     provider, or a bare model resolved against the base provider),
 *   - the `shell` provider is REJECTED (a review lane is an LLM lane, never a
 *     shell command),
 *   - empty / whitespace-only entries are rejected,
 *   - duplicate NORMALIZED (`provider:model`) entries are rejected.
 *
 * `baseProvider` is the configured orchestrator provider used to resolve a bare
 * (prefix-less) lane; when absent, a bare lane is rejected (it has no provider
 * to resolve against). ABSENT `lanes` returns `[]` (the legacy path runs).
 *
 * Returns the NORMALIZED (`provider:model`) lane list — the fan's laneIds and
 * per-lane model routing use exactly these strings, so normalization has one
 * home.
 */
export function validateReviewLanes(
  lanes: readonly string[] | undefined,
  baseProvider: string | undefined,
): string[] {
  if (lanes === undefined) return [];
  const seen = new Set<string>();
  const normalizedLanes: string[] = [];
  for (const raw of lanes) {
    const trimmed = typeof raw === 'string' ? raw.trim() : '';
    if (trimmed.length === 0) {
      throw makeLaneConfigError(
        `review.lanes contains an empty or whitespace-only entry.`,
        'Every lane must be a non-empty "provider:model" string, e.g. "anthropic:claude-sonnet-4".',
      );
    }
    // Shell-safety gate (leading-dash + allow-list regex) — same gate the
    // resolver applies, so a lane accepted here is accepted at invoke time.
    assertValidModelName(trimmed);

    const { provider, model } = resolveLaneProvider(trimmed, baseProvider);
    if (provider === 'shell') {
      throw makeLaneConfigError(
        `review.lanes entry "${trimmed}" resolves to the 'shell' provider, which is not a valid review lane.`,
        'A review lane must be an LLM "provider:model" (anthropic/gemini/openai/ollama), never a shell command.',
      );
    }
    if (model.length === 0) {
      throw makeLaneConfigError(
        `review.lanes entry "${trimmed}" has an empty model portion.`,
        'Provide a model name after the provider prefix, e.g. "gemini:gemini-2.5-flash-preview".',
      );
    }
    const normalized = `${provider}:${model}`;
    if (seen.has(normalized)) {
      throw makeLaneConfigError(
        `review.lanes has a duplicate lane "${normalized}" (normalized from "${trimmed}").`,
        'Remove the duplicate — each fan lane must be a distinct provider:model.',
      );
    }
    seen.add(normalized);
    normalizedLanes.push(normalized);
  }
  return normalizedLanes;
}

/**
 * Resolve a lane string to its `{provider, model}`. A `:`-prefixed KNOWN
 * provider splits out that provider (reuse of `parseModelString`'s semantics);
 * a `:`-prefixed UNKNOWN provider is rejected here as an unknown provider (the
 * design's "unknown provider rejected"), rather than silently folded into the
 * model as `parseModelString` alone would. A prefix-less lane resolves against
 * `baseProvider` (rejected when there is none).
 */
function resolveLaneProvider(
  trimmed: string,
  baseProvider: string | undefined,
): { provider: string; model: string } {
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx > 0) {
    const prefix = trimmed.slice(0, colonIdx);
    if ((KNOWN_PROVIDERS as readonly string[]).includes(prefix)) {
      // Delegate to parseModelString so the split matches the resolver exactly
      // (it splits on the FIRST colon — ollama quantized tags like `x:8b` stay
      // in the model portion).
      return parseModelString(trimmed, prefix);
    }
    // A `:`-prefixed entry whose prefix is not a known provider is an unknown
    // provider, not a colon-bearing model name — reject it loud (a lane is an
    // explicit provider:model; a typo'd provider must never route silently).
    throw makeLaneConfigError(
      `review.lanes entry "${trimmed}" names an unknown provider "${prefix}".`,
      `Use one of the known providers (${KNOWN_PROVIDERS.filter((p) => p !== 'shell').join(', ')}), e.g. "anthropic:claude-sonnet-4".`,
    );
  }
  // Bare (prefix-less) lane — resolve against the base provider.
  if (baseProvider === undefined) {
    throw makeLaneConfigError(
      `review.lanes entry "${trimmed}" has no provider prefix and no orchestrator provider is configured to resolve it.`,
      'Prefix the lane with a provider, e.g. "anthropic:claude-sonnet-4", or configure an orchestrator.',
    );
  }
  return { provider: baseProvider, model: trimmed };
}

// ─── Predicates (item 6 — both derived, deterministic, never model-sourced) ──

/** The artifact-content inputs both predicates read. */
export interface PredicateInputs {
  /** Every attempted lane's terminal outcome. */
  lanes: readonly VerdictLane[];
  /** The completed lanes' exemption-filtered findings, unioned. */
  findingsUnion: readonly ShieldFinding[];
  /** Every recorded post-check row (flattened across completed lanes). */
  postChecks: readonly PersistedPostCheckFinding[];
  /**
   * Post-fan tree compare (codex rev-2 fold 1). `'drifted'` (the tracked-source
   * tree changed mid-fan) fails BOTH predicates: the verdict is bound to the
   * pre-fan diff, so a dry-but-drifted fan neither settles nor stamps the cache.
   */
  reviewedState: 'matched' | 'drifted';
}

/** First conjunct, shared by both predicates: every attempted lane completed. */
function everyLaneCompleted(lanes: readonly VerdictLane[]): boolean {
  return lanes.length > 0 && lanes.every((l) => l.status === 'completed');
}

/** A decidable-tier post-check row failed (sensor-tier rows never count). */
function hasDecidablePostCheckFail(postChecks: readonly PersistedPostCheckFinding[]): boolean {
  return postChecks.some((r) => r.tier === 'decidable' && r.verdict === 'fail');
}

/**
 * `settled` (item 6) — the current-round dryness predicate, pure over artifact
 * content (no cross-round input, no model output). As implemented:
 *
 *   settled = (every attempted lane status === 'completed')
 *             AND (zero actionable findings across completed lanes' filtered
 *                  findings union — actionable = WARN | CRITICAL; INFO cosmetic)
 *             AND (no decidable-tier post-check row with verdict 'fail')
 *             AND (reviewedState === 'matched' — the tree did not drift mid-fan)
 *
 * A failed/abstained lane ⇒ fan incomplete ⇒ never settled (a persistent
 * CRITICAL can never settle by lane dropout — agy fold 1, satisfied
 * structurally). The `reviewedState` clause (codex rev-2 fold 1): a dry fan over
 * a tree that mutated mid-fan is NOT settled — the verdict does not cover the
 * current tree, and the thin skill terminates on settled, so drift must fail the
 * predicate, not just the cache stamp.
 */
export function computeSettled(inputs: PredicateInputs): boolean {
  return (
    everyLaneCompleted(inputs.lanes) &&
    !inputs.findingsUnion.some((f) => f.severity === 'WARN' || f.severity === 'CRITICAL') &&
    !hasDecidablePostCheckFail(inputs.postChecks) &&
    inputs.reviewedState === 'matched'
  );
}

/**
 * Cache eligibility (item 6) — the distinct, WEAKER predicate (WARNs allowed,
 * matching today's PASS semantics). As implemented:
 *
 *   cacheEligible = (every attempted lane status === 'completed')
 *                   AND (zero CRITICAL findings across the filtered union)
 *                   AND (no decidable-tier post-check row with verdict 'fail')
 *                   AND (reviewedState === 'matched' — the tree did not drift mid-fan)
 *
 * The post-fan tree-drift guard IS now a conjunct here (codex rev-2 fold 1) — the
 * fan computes the compare ONCE (deriving `reviewedState`) and reuses that single
 * result for both the verdict field and the stamp decision, so what the artifact
 * records and what the stamp did can never diverge (no TOCTOU second compare). A
 * degraded fan (any failed/abstained lane) fails the first conjunct and is
 * therefore never cache-eligible.
 */
export function computeCacheEligible(inputs: PredicateInputs): boolean {
  return (
    everyLaneCompleted(inputs.lanes) &&
    !inputs.findingsUnion.some((f) => f.severity === 'CRITICAL') &&
    !hasDecidablePostCheckFail(inputs.postChecks) &&
    inputs.reviewedState === 'matched'
  );
}

// ─── Review-specific post-check rule set (item 4) ────────────────────────────

/**
 * The CLI-side review structured-output rule (DECIDABLE). The shipped generic
 * `structuredOutputRule` bare-`JSON.parse`s `output.content` and would
 * MIS-VERDICT valid XML-wrapped / fenced Shield output as malformed — so it is
 * deliberately NOT wired here. This rule runs the SINGLE shared
 * `extractStructuredVerdict` cascade (the same parser the CLI path uses): an
 * extractable verdict passes, unextractable output is a decidable fail.
 * Caller-scoped to `review` runs.
 */
export const reviewStructuredOutputRule: PostCheckRule = {
  name: 'review-structured-verdict',
  tier: 'decidable',
  appliesTo: (a) => a.admission?.runMetadata?.caller === 'review',
  evaluate: (a) => {
    const verdict = extractStructuredVerdict(a.output.content);
    if (verdict === null) {
      return {
        verdict: 'fail',
        message: 'review lane output is not extractable by the shared Shield verdict cascade',
      };
    }
    return { verdict: 'pass', message: 'review lane output parses via the shared verdict cascade' };
  },
};

/**
 * The review rule set: the CLI review structured-verdict rule PLUS the shipped
 * default rules EXCEPT the generic `structured-output` rule (see above). Built
 * lazily from `DEFAULT_RULES` at call time so it always tracks the shipped set.
 */
async function buildReviewRules(): Promise<PostCheckRule[]> {
  const { DEFAULT_RULES } = await import('@mmnto/totem');
  return [
    reviewStructuredOutputRule,
    ...DEFAULT_RULES.filter((r) => r.name !== 'structured-output'),
  ];
}

// ─── Per-lane runner wrapper (item 3) ────────────────────────────────────────

/**
 * A single lane's raw invocation result, as the runner wrapper surfaces it. The
 * production invoker (`makeLaneInvoker`) forces a fresh invoke, captures the run
 * artifact via the `onEmitted` callback, and LOADS it so `runArtifact` is
 * present iff `runArtifactHash` is. Test invokers construct this directly.
 */
export interface LaneInvocation {
  /** The model output. A response-cache hit is impossible (fresh forced). */
  content: string | undefined;
  /** The captured run-artifact content address; `undefined` ⇒ no emission fired. */
  runArtifactHash: string | undefined;
  /** The loaded run artifact; present iff `runArtifactHash` is present. */
  runArtifact: RunArtifact | undefined;
}

/**
 * A per-lane invoker: runs one lane over the shared pre-assembled `deliveredPrompt`
 * (the masked bytes every lane sees, identical across lanes — codex rev-2 fold 4)
 * and returns its raw invocation (or throws). The production invoker sends
 * `deliveredPrompt` verbatim; a test invoker may echo it into the run artifact's
 * `maskedPrompt` so the persisted `<git_diff>` segment recomputes the stored
 * `diffHash` (invariant 12/15).
 */
export type LaneInvoker = (laneModel: string, deliveredPrompt: string) => Promise<LaneInvocation>;

/** One lane's fully-classified outcome plus the by-products the fan needs downstream. */
export interface LaneRunResult {
  /** The verdict-artifact lane record (status-discriminated union). */
  lane: VerdictLane;
  /** The completed/abstained lane's run artifact (for panel + post-checks). */
  runArtifact?: RunArtifact;
  /** The completed lane's exemption-filtered findings (drives predicates + verdict.findings). */
  filteredFindings: ShieldFinding[];
}

/**
 * Classify one lane. The invoker is called once; a throw is classified as a
 * typed `failed` lane (quota vs invoke-error), a missing artifact emission is a
 * `failed` lane, unextractable output is `abstained`, and an extractable verdict
 * is `completed` with a severity tally from its exemption-filtered findings.
 *
 * NO retry lives here beyond `runOrchestrator`'s existing logged quota fallback
 * (the design's "no runner retry"); `resolvedBackend` records what actually ran.
 */
export async function runLane(
  laneModel: string,
  invoker: LaneInvoker,
  shared: ExemptionShared,
  deliveredPrompt: string,
): Promise<LaneRunResult> {
  let invocation: LaneInvocation;
  try {
    invocation = await invoker(laneModel, deliveredPrompt);
  } catch (err) {
    const typedReason = await classifyInvokeFailure(err);
    return { lane: { status: 'failed', laneId: laneModel, typedReason }, filteredFindings: [] };
  }

  // A response-cache hit emits no run artifact (fresh is forced, so it cannot
  // occur — but defense in depth): missing emission is a terminal lane failure,
  // never a completed lane without genuine provenance (invariant 2).
  if (invocation.runArtifactHash === undefined || invocation.runArtifact === undefined) {
    return {
      lane: { status: 'failed', laneId: laneModel, typedReason: 'missing-artifact-emission' },
      filteredFindings: [],
    };
  }

  const resolvedBackend = invocation.runArtifact.backend.qualifiedModel;

  if (invocation.content === undefined) {
    // The invoke produced no content (only the degenerate --raw path). Treat as
    // an abstention — there is a run artifact but no usable structured verdict.
    return {
      lane: {
        status: 'abstained',
        laneId: laneModel,
        resolvedBackend,
        runArtifactHash: invocation.runArtifactHash,
        reason: 'lane produced no content to extract a verdict from',
      },
      runArtifact: invocation.runArtifact,
      filteredFindings: [],
    };
  }

  const outcome = await deriveLaneOutcome(invocation.content, shared);
  if (outcome.structuredVerdict === null) {
    return {
      lane: {
        status: 'abstained',
        laneId: laneModel,
        resolvedBackend,
        runArtifactHash: invocation.runArtifactHash,
        reason: 'lane output not extractable by the shared Shield verdict cascade',
      },
      runArtifact: invocation.runArtifact,
      filteredFindings: [],
    };
  }

  const verdictSummary = tallyFindings(outcome.filteredFindings);
  return {
    lane: {
      status: 'completed',
      laneId: laneModel,
      resolvedBackend,
      runArtifactHash: invocation.runArtifactHash,
      verdictSummary,
    },
    runArtifact: invocation.runArtifact,
    filteredFindings: outcome.filteredFindings,
  };
}

/** Severity tally for a completed lane's `verdictSummary`. */
function tallyFindings(findings: readonly ShieldFinding[]): {
  critical: number;
  warn: number;
  info: number;
} {
  let critical = 0;
  let warn = 0;
  let info = 0;
  for (const f of findings) {
    if (f.severity === 'CRITICAL') critical += 1;
    else if (f.severity === 'WARN') warn += 1;
    else info += 1;
  }
  return { critical, warn, info };
}

/** Classify an invoke throw as a typed `failed` reason (quota vs generic invoke error). */
async function classifyInvokeFailure(err: unknown): Promise<'quota-exhausted' | 'invoke-error'> {
  const { isQuotaError } = await import('../orchestrators/orchestrator.js');
  return isQuotaError(err) ? 'quota-exhausted' : 'invoke-error';
}

// ─── Diff scope + lineage (item 5, item 7 diffHash) ──────────────────────────

/** The additive diff-scope metadata `getDiffForReview` now returns. */
export interface DiffScopeMeta {
  source: 'explicit-range' | 'staged' | 'uncommitted' | 'branch-vs-base';
  base?: string;
  head?: string;
}

/**
 * Build the source-discriminated `VerdictDiffScope` from the resolved scope
 * metadata + the masked-payload `diffHash`. For `explicit-range` the schema
 * requires both endpoints; a bare `--diff <ref>` (working-tree comparison) has
 * no explicit head, so `HEAD` is recorded as the implicit head.
 */
export function buildDiffScope(meta: DiffScopeMeta, diffHash: string): VerdictDiffScope {
  switch (meta.source) {
    case 'explicit-range':
      return {
        source: 'explicit-range',
        diffHash,
        base: meta.base ?? 'HEAD',
        head: meta.head ?? 'HEAD',
      };
    case 'branch-vs-base':
      return { source: 'branch-vs-base', diffHash, base: meta.base ?? 'HEAD' };
    case 'staged':
      return { source: 'staged', diffHash };
    case 'uncommitted':
      return { source: 'uncommitted', diffHash };
  }
}

/** A git command runner seam (injectable for tests). Returns trimmed stdout. */
export type GitExec = (args: readonly string[]) => string;

/** The resolved lineage components (item 5). */
export interface LineageResolution {
  branch: string;
  mergeBase: string;
  lineageKey: string;
}

/**
 * Resolve the composite lineage key over the RESOLVED scope selector (item 5;
 * codex rev-2 fold 2). `repoIdentity` is the stable worktree identity (absolute
 * `git rev-parse --show-toplevel`); `branch` is the current branch
 * (`git symbolic-ref --short HEAD`), a detached HEAD becoming the literal
 * `DETACHED:<sha>`. The per-source range selectors are contributed to the key so
 * they describe the *lineage*, never the diff bytes:
 *   - `explicit-range` — the normalized `base` + `head` endpoints (two different
 *     ranges on one branch never cross-link — gate 2).
 *   - `branch-vs-base` — the resolved `base` + `mergeBase` sha (a moved merge-base
 *     forks the chain).
 *   - `staged` / `uncommitted` — no range fields; worktree identity + branch +
 *     source carry the lineage (the index/worktree has no second endpoint).
 */
export async function resolveLineage(
  meta: DiffScopeMeta,
  gitExec: GitExec,
): Promise<LineageResolution> {
  const { computeLineageKey } = await import('@mmnto/totem');
  const path = await import('node:path');
  const repoIdentity = resolveRepoIdentity(gitExec, path);
  const branch = resolveBranch(gitExec);
  const mergeBase = resolveMergeBase(meta, gitExec);
  const keyInput: LineageKeyInput = { repoIdentity, branch, source: meta.source };
  if (meta.source === 'explicit-range') {
    keyInput.base = meta.base ?? 'HEAD';
    keyInput.head = meta.head ?? 'HEAD';
  } else if (meta.source === 'branch-vs-base') {
    keyInput.base = meta.base ?? '';
    keyInput.mergeBase = mergeBase;
  }
  const lineageKey = computeLineageKey(keyInput);
  return { branch, mergeBase, lineageKey };
}

/**
 * The stable worktree identity: the absolute resolved `git rev-parse
 * --show-toplevel` (codex rev-2 fold 2). Distinct worktrees of the same repo have
 * distinct toplevels and so never cross-link. Falls back to a stable literal when
 * git is unavailable, keeping the lineage key deterministic.
 */
function resolveRepoIdentity(gitExec: GitExec, path: typeof import('node:path')): string {
  try {
    const top = gitExec(['rev-parse', '--show-toplevel']).trim();
    if (top.length > 0) return path.resolve(top);
  } catch {
    /* not a git worktree (or git unavailable) — fall through */
  }
  return 'WORKTREE:unknown';
}

function resolveBranch(gitExec: GitExec): string {
  try {
    const branch = gitExec(['symbolic-ref', '--short', 'HEAD']).trim();
    if (branch.length > 0) return branch;
  } catch {
    /* detached HEAD — fall through */
  }
  // Detached HEAD: use a stable literal so distinct detached states do not
  // collide with a real branch named the same as a sha prefix.
  try {
    const sha = gitExec(['rev-parse', 'HEAD']).trim();
    return `DETACHED:${sha}`;
  } catch {
    return 'DETACHED:unknown';
  }
}

function resolveMergeBase(meta: DiffScopeMeta, gitExec: GitExec): string {
  // staged / uncommitted have no second endpoint — the branch + source carry
  // the lineage (documented on the schema); '' keeps the key stable per-branch.
  if (meta.source === 'staged' || meta.source === 'uncommitted') return '';
  const base = meta.base;
  if (base === undefined) return '';
  const head = meta.head ?? 'HEAD';
  try {
    return gitExec(['merge-base', base, head]).trim();
  } catch {
    // No shared history (or the ref moved): fall back to '' — the branch +
    // source still key the lineage; a moved merge-base forks the chain.
    return '';
  }
}

/** The default `git` runner (production). */
export async function defaultGitExec(cwd: string): Promise<GitExec> {
  const { safeExec } = await import('@mmnto/totem');
  return (args) => safeExec('git', [...args], { cwd });
}

// ─── Round resolution (item 5) ───────────────────────────────────────────────

export interface RoundResolution {
  round: VerdictRound;
  /** Warnings to surface (chain restart / lineage mismatch) — never blocks. */
  warnings: string[];
}

/**
 * Resolve the round record (item 5). Implicit path: the latest verdict sharing
 * the computed lineage key links as prior (round = prior + 1); a corrupt/missing
 * prior restarts the chain at round 0 with a warning. Explicit `--continues
 * <hash>`: load that verdict and link to it (its round + 1); a lineage mismatch
 * WARNS (honoring the explicit intent) and records the CURRENT lineage key.
 */
export async function resolveRound(
  totemDirAbs: string,
  lineageKey: string,
  continuesHash: string | undefined,
): Promise<RoundResolution> {
  const { findLatestVerdictForLineage, loadVerdictArtifact, computeVerdictArtifactContentHash } =
    await import('@mmnto/totem');
  const warnings: string[] = [];

  if (continuesHash !== undefined) {
    // Explicit override — an honest load failure is loud (the user named it).
    const prior = loadVerdictArtifact(totemDirAbs, continuesHash);
    if (prior.round.lineageKey !== lineageKey) {
      warnings.push(
        `--continues ${continuesHash.slice(0, 8)} links a verdict from a DIFFERENT lineage; honoring the explicit intent and recording the current lineage key (branch/base/source moved).`,
      );
    }
    return {
      round: {
        index: prior.round.index + 1,
        priorVerdictHash: continuesHash,
        lineageKey,
      },
      warnings,
    };
  }

  // Implicit linkage on the composite lineage key.
  let prior: VerdictArtifact | undefined;
  try {
    prior = findLatestVerdictForLineage(totemDirAbs, lineageKey);
  } catch (err) {
    // A corrupt verdict in the ledger must not wedge the chain — restart at 0.
    warnings.push(
      `prior verdict in this lineage failed to load (${err instanceof Error ? err.message : String(err)}); restarting the round chain at 0.`,
    );
    return { round: { index: 0, lineageKey }, warnings };
  }
  if (prior === undefined) {
    return { round: { index: 0, lineageKey }, warnings };
  }
  return {
    round: {
      index: prior.round.index + 1,
      priorVerdictHash: computeVerdictArtifactContentHash(prior),
      lineageKey,
    },
    warnings,
  };
}

// ─── Panel + post-checks (item 4) ────────────────────────────────────────────

/** The panel + post-check by-products the verdict assembly consumes. */
export interface PanelAndChecks {
  /** All post-check rows across completed lanes, flattened. */
  postChecks: PersistedPostCheckFinding[];
  /** The panel content address — present iff ≥2 completed lanes assembled a panel. */
  panelArtifactHash?: string;
  /** The top-level panel diversity summary — present iff a panel was assembled. */
  diversity?: VerdictArtifact['diversity'];
}

/**
 * Run the #2103 post-check engine per completed lane and, with ≥2 completed
 * lanes, assemble + write the #2104 panel from the completed lanes' run
 * artifacts ONLY (failed/abstained lanes never reach `assemblePanelArtifact`).
 */
export async function runPanelAndPostChecks(
  completed: readonly LaneRunResult[],
  totemDirAbs: string,
  configRoot: string,
  createdAt: string,
): Promise<PanelAndChecks> {
  const { evaluatePostChecks, assemblePanelArtifact, writePanelArtifact } =
    await import('@mmnto/totem');
  const rules = await buildReviewRules();

  const postChecks: PersistedPostCheckFinding[] = [];
  const laneReports = new Map<string, PostCheckReport>();

  for (const lr of completed) {
    // Completed lanes always carry a run artifact (structural invariant).
    const artifact = lr.runArtifact!;
    const report = await evaluatePostChecks(artifact, rules, { configRoot });
    laneReports.set(lr.lane.laneId, report);
    for (const f of report.findings) {
      postChecks.push({
        ruleName: f.ruleName,
        tier: f.tier,
        verdict: f.verdict,
        message: f.message,
      });
    }
  }

  // A panel is assembled ONLY from ≥2 usable (completed) lanes.
  if (completed.length < 2) {
    return { postChecks };
  }

  const laneInputs = completed.map((lr) => ({
    laneId: lr.lane.laneId,
    artifact: lr.runArtifact!,
    report: laneReports.get(lr.lane.laneId)!,
  }));
  const panel = assemblePanelArtifact(laneInputs, createdAt);
  const saved = writePanelArtifact(totemDirAbs, panel);
  return { postChecks, panelArtifactHash: saved.hash, diversity: panel.diversity };
}

// ─── Verdict assembly (item 7) ───────────────────────────────────────────────

/** Normalize a completed lane's exemption-filtered findings into verdict findings. */
function toVerdictFindings(findings: readonly ShieldFinding[]): VerdictArtifact['findings'] {
  return findings.map((f) => ({
    severity: f.severity,
    ...(f.confidence !== undefined ? { confidence: f.confidence } : {}),
    ...(f.file !== undefined ? { file: f.file } : {}),
    ...(f.line !== undefined ? { line: f.line } : {}),
    message: f.message,
  }));
}

/** All inputs needed to assemble the full verdict artifact in memory. */
export interface VerdictAssemblyInputs {
  diffScope: VerdictDiffScope;
  laneResults: readonly LaneRunResult[];
  panelAndChecks: PanelAndChecks;
  round: VerdictRound;
  /** Post-fan tree compare (codex rev-2 fold 1) — recorded AND fed into `settled`. */
  reviewedState: 'matched' | 'drifted';
  createdAt: string;
}

/**
 * Assemble the full verdict artifact in memory (item 7). Counts are DERIVED
 * from `lanes` (never mirrored on trust — the schema re-validates them), the
 * findings union is the completed lanes' exemption-filtered findings, and
 * `settled` is the derived predicate over this artifact's own content (including
 * the `reviewedState` drift clause — codex rev-2 fold 1).
 */
export function assembleVerdict(inputs: VerdictAssemblyInputs): VerdictArtifact {
  const lanes = inputs.laneResults.map((lr) => lr.lane);
  const completed = inputs.laneResults.filter((lr) => lr.lane.status === 'completed');
  const findingsUnion = completed.flatMap((lr) => lr.filteredFindings);

  const settled = computeSettled({
    lanes,
    findingsUnion,
    postChecks: inputs.panelAndChecks.postChecks,
    reviewedState: inputs.reviewedState,
  });

  return {
    schemaVersion: VERDICT_ARTIFACT_SCHEMA_VERSION,
    diffScope: inputs.diffScope,
    lanes,
    attemptedLaneCount: lanes.length,
    completedLaneCount: completed.length,
    ...(inputs.panelAndChecks.panelArtifactHash !== undefined
      ? { panelArtifactHash: inputs.panelAndChecks.panelArtifactHash }
      : {}),
    postChecks: inputs.panelAndChecks.postChecks,
    findings: toVerdictFindings(findingsUnion),
    ...(inputs.panelAndChecks.diversity !== undefined
      ? { diversity: inputs.panelAndChecks.diversity }
      : {}),
    round: inputs.round,
    reviewedState: inputs.reviewedState,
    settled,
    createdAt: inputs.createdAt,
  };
}

// ─── Delivered masked diff segment + diffHash (codex rev-2 fold 4) ────────────

/**
 * The diff segment EXACTLY as delivered inside the shared per-lane prompt's
 * `<git_diff>` block: post file-filtering, post `MAX_DIFF_CHARS` truncation
 * INCLUDING the truncation marker. Mirrors `assemblePrompt`'s truncation VERBATIM
 * (the single-lane path's assembly is untouched); used only as a fallback when the
 * `<git_diff>` block cannot be located in the assembled prompt.
 */
function deliveredDiffSegment(diff: string): string {
  return diff.length > MAX_DIFF_CHARS
    ? diff.slice(0, MAX_DIFF_CHARS) + `\n... [diff truncated at ${MAX_DIFF_CHARS} chars] ...`
    : diff;
}

/** The `<git_diff>` block wrapper (see `wrapXml`) delimits the delivered segment. */
const GIT_DIFF_SEGMENT_RE = /<git_diff>\n([\s\S]*?)\n<\/git_diff>/;

/**
 * Extract the exact bytes inside the assembled prompt's `<git_diff>` block —
 * what every lane actually reviewed (post-truncation). `wrapXml('git_diff', …)`
 * emits `<git_diff>\n{content}\n</git_diff>`, so the captured group is the
 * delivered segment. Returns `null` when no block is present (structural mode /
 * malformed prompt), letting the caller fall back to `deliveredDiffSegment`.
 */
function extractGitDiffSegment(prompt: string): string | null {
  const m = GIT_DIFF_SEGMENT_RE.exec(prompt);
  return m === null ? null : m[1]!;
}

// ─── Fan orchestration (the shieldCommand entry) ─────────────────────────────

/** Everything `shieldCommand` hands the fan on the standard review path. */
export interface ReviewFanContext {
  /** Normalized fan lane models (each a `provider:model` string). */
  laneModels: string[];
  /** The assembled review prompt — identical for every lane (identical-kit discipline). */
  prompt: string;
  /** The code-only filtered diff the lanes review (masked here for `diffHash`). */
  filteredDiff: string;
  /** Resolved diff-scope metadata from `getDiffForReview`. */
  diffMeta: DiffScopeMeta;
  config: TotemConfig;
  cwd: string;
  configRoot: string;
  /** Absolute `.totem` dir (`configRoot`/`config.totemDir`). */
  totemDirAbs: string;
  /** The shield options (model/fresh/out/raw) — the fan forces `fresh` per lane. */
  options: { raw?: boolean; out?: string; model?: string; fresh?: boolean };
  /** Grounding identity for the run-artifact request (same as the single-lane path). */
  groundingHash: string;
  provenanceSummary: string;
  groundingBundle: GroundingBundle;
  totalResults: number;
  codeBlind: boolean;
  /** Shared exemptions (read once by the caller; passed in side-effect-free). */
  shared: ExemptionShared;
  /** The pre-fan content hash (codex fold 1) — the stamp binds exactly this tree. */
  preFanContentHash: string | null;
  /** Explicit `--continues <hash>` round override. */
  continues?: string;
  // ── Test seams ──
  /** Injected per-lane invoker (production builds one over `runOrchestrator`). */
  invoker?: LaneInvoker;
  /** Injected git runner (production uses `safeExec('git', ...)`). */
  gitExec?: GitExec;
  /** Injected clock (production uses `new Date().toISOString`). */
  now?: () => string;
  /**
   * Injected POST-fan content-hash computer (codex rev-2 fold 1) — production
   * re-hashes the tracked-source tree via `computeReviewedContentHash`. Called
   * ONCE after the fan; its result vs `preFanContentHash` derives `reviewedState`
   * (and, transitively, the stamp decision). Tests inject a value that differs
   * from `preFanContentHash` to simulate a mid-fan tree mutation.
   */
  contentHash?: () => Promise<string | null>;
}

/**
 * Build the production per-lane invoker over `runOrchestrator`: forces a fresh
 * invoke (so a response-cache hit can never masquerade as a completed lane),
 * captures the run-artifact hash via `onEmitted`, and loads the artifact for the
 * panel + post-checks. Every lane gets the IDENTICAL prompt at temperature 0.
 */
function makeLaneInvoker(ctx: ReviewFanContext): LaneInvoker {
  return async (laneModel, deliveredPrompt) => {
    const { runOrchestrator } = await import('../utils.js');
    const { ADMISSION_COMPLETION_ONLY, loadRunArtifact } = await import('@mmnto/totem');

    let runArtifactHash: string | undefined;
    const content = await runOrchestrator({
      // The PRE-MASKED, pre-assembled payload (codex rev-2 fold 4). Every lane
      // gets the identical bytes the `diffHash` binds; `runOrchestrator`'s DLP
      // pass re-masks idempotently (a no-op on already-masked text), so the
      // persisted `maskedPrompt` equals these bytes for remote AND local providers.
      prompt: deliveredPrompt,
      tag: TAG,
      // Force a fresh invoke: a response-cache hit emits no run artifact and so
      // must never yield a completed lane. `raw` is forced off — the fan needs
      // real content. `model` routes this lane's provider.
      options: { ...ctx.options, model: laneModel, fresh: true, raw: false },
      config: ctx.config,
      cwd: ctx.cwd,
      configRoot: ctx.configRoot,
      totalResults: ctx.totalResults,
      temperature: 0,
      backendAdmissionClass: ADMISSION_COMPLETION_ONLY,
      runMetadata: { caller: 'review', codeBlind: ctx.codeBlind },
      artifact: {
        groundingHash: ctx.groundingHash,
        provenanceSummary: ctx.provenanceSummary,
        bundle: ctx.groundingBundle,
        onEmitted: (hash) => {
          runArtifactHash = hash;
        },
      },
    });
    const runArtifact =
      runArtifactHash !== undefined ? loadRunArtifact(ctx.totemDirAbs, runArtifactHash) : undefined;
    return { content, runArtifactHash, runArtifact };
  };
}

/**
 * The standard-path fan entry. Runs every configured lane, assembles the panel +
 * post-checks + verdict, resolves the round chain, derives the predicates,
 * emits the verdict, prints the one-line report + sensor lines, and enforces the
 * exit contract: cache-eligible ⇒ PASS (stamp attempted); not ⇒ SHIELD_FAILED
 * with an honest reason. All lanes failing ⇒ a hard error with NO verdict.
 */
export async function runReviewFan(ctx: ReviewFanContext): Promise<void> {
  const { log } = await import('../ui.js');
  const { TotemError, maskSecrets } = await import('@mmnto/totem');

  const now = ctx.now ?? (() => new Date().toISOString());
  const invoker = ctx.invoker ?? makeLaneInvoker(ctx);
  const gitExec = ctx.gitExec ?? (await defaultGitExec(ctx.cwd));
  const contentHash =
    ctx.contentHash ??
    (() => computeReviewedContentHash(ctx.cwd, ctx.configRoot, ctx.config.review.sourceExtensions));

  log.info(
    DISPLAY_TAG,
    `Review fan: ${ctx.laneModels.length} lane(s) — ${ctx.laneModels.join(', ')}`,
  );

  // ── Pre-assemble the shared masked payload ONCE (codex rev-2 fold 4) ──
  // `diffHash` binds the EXACT masked `<git_diff>` segment every lane sees —
  // post file-filter, post-truncation (marker included), post-DLP. Masking the
  // whole assembled prompt once here (idempotent — verified) makes the segment
  // inside it the delivered bytes; each lane gets this identical payload and
  // `runOrchestrator`'s DLP pass is a no-op, so the persisted `maskedPrompt`'s
  // `<git_diff>` segment recomputes this hash (invariant 12/15, reproducible;
  // never binds bytes a lane did not see, never binds secret-bearing bytes).
  const deliveredPrompt = maskSecrets(ctx.prompt);
  const diffSegment =
    extractGitDiffSegment(deliveredPrompt) ?? maskSecrets(deliveredDiffSegment(ctx.filteredDiff));
  const diffHash = await sha256Hex(diffSegment);

  // ── Run every lane (sequentially — each is a fresh invoke) ──
  const laneResults: LaneRunResult[] = [];
  for (const laneModel of ctx.laneModels) {
    const result = await runLane(laneModel, invoker, ctx.shared, deliveredPrompt);
    if (result.lane.status === 'failed') {
      log.warn(DISPLAY_TAG, `Lane ${laneModel} FAILED (${result.lane.typedReason}).`);
    } else if (result.lane.status === 'abstained') {
      log.warn(DISPLAY_TAG, `Lane ${laneModel} ABSTAINED (${result.lane.reason}).`);
    } else {
      const s = result.lane.verdictSummary;
      log.info(
        DISPLAY_TAG,
        `Lane ${laneModel} completed — ${s.critical} critical, ${s.warn} warn, ${s.info} info.`,
      );
    }
    laneResults.push(result);
  }

  // ── ALL lanes failed (no completed AND no abstained) ⇒ hard error, no verdict ──
  const anyWithOutput = laneResults.some(
    (lr) => lr.lane.status === 'completed' || lr.lane.status === 'abstained',
  );
  if (!anyWithOutput) {
    throw new TotemError(
      'SHIELD_FAILED',
      `All ${laneResults.length} review lane(s) failed to invoke — no verdict written.`,
      'Check backend API keys / quota, then re-run `totem review`.',
    );
  }

  const completed = laneResults.filter((lr) => lr.lane.status === 'completed');
  const createdAt = now();

  // ── Post-fan tree compare, computed ONCE (codex rev-2 fold 1) ──
  // Re-hash the tracked-source tree AFTER the fan and compare to the PRE-fan hash
  // captured before any lane ran. This single result feeds BOTH the verdict's
  // `reviewedState` field AND the stamp decision — no second compare, no TOCTOU
  // divergence between what the artifact records and what the stamp did. A `null`
  // pre-fan hash means there was no tracked source to authorize (legacy no-op).
  const postFanContentHash = await contentHash();
  const reviewedState: 'matched' | 'drifted' =
    ctx.preFanContentHash === null || postFanContentHash === ctx.preFanContentHash
      ? 'matched'
      : 'drifted';
  if (reviewedState === 'drifted') {
    log.warn(
      DISPLAY_TAG,
      'WORKTREE DRIFT: tracked source files changed during the review fan. The verdict is bound to the pre-fan tree, so it is NOT settled and the reviewed-content-hash was NOT stamped — this review does not authorize a push. Re-run `totem review` against the current tree.',
    );
  }

  // ── Panel + post-checks (from completed lanes' run artifacts only) ──
  const panelAndChecks = await runPanelAndPostChecks(
    completed,
    ctx.totemDirAbs,
    ctx.configRoot,
    createdAt,
  );

  // ── diffScope binds the delivered masked `<git_diff>` segment (fold 4, above) ──
  const diffScope = buildDiffScope(ctx.diffMeta, diffHash);

  // ── Round chain / lineage ──
  const lineage = await resolveLineage(ctx.diffMeta, gitExec);
  const roundRes = await resolveRound(ctx.totemDirAbs, lineage.lineageKey, ctx.continues);
  for (const w of roundRes.warnings) log.warn(DISPLAY_TAG, `Sensor: ${w}`);

  // ── Assemble + save the verdict ──
  const verdict = assembleVerdict({
    diffScope,
    laneResults,
    panelAndChecks,
    round: roundRes.round,
    reviewedState,
    createdAt,
  });
  const { saveVerdictArtifact } = await import('@mmnto/totem');
  // The saved hash IS the content address (dedup-safe: an identical round returns
  // the existing address).
  const verdictHash = saveVerdictArtifact(ctx.totemDirAbs, verdict).hash;

  // ── Predicates ──
  const findingsUnion = completed.flatMap((lr) => lr.filteredFindings);
  const predicateInputs: PredicateInputs = {
    lanes: verdict.lanes,
    findingsUnion,
    postChecks: panelAndChecks.postChecks,
    reviewedState,
  };
  const cacheEligible = computeCacheEligible(predicateInputs);

  // ── The one-line, grep-able report (contract — versioned with the skill) ──
  log.info(
    DISPLAY_TAG,
    `local-lane: ${verdictHash.slice(0, 8)} round=${verdict.round.index} settled=${verdict.settled} lanes=${verdict.completedLaneCount}/${verdict.attemptedLaneCount}`,
  );

  // ── Sensor lines (warnings-class, never blocks) ──
  if (ctx.laneModels.length === 1) {
    log.warn(
      DISPLAY_TAG,
      'Sensor: single-lane fan — degenerate diversity (no cross-lane corroboration). Add lanes for panel diversity.',
    );
  }
  if (verdict.round.index >= MAX_ROUNDS_ADVISORY) {
    log.warn(
      DISPLAY_TAG,
      `Sensor: round ${verdict.round.index} reached the max-rounds advisory threshold (${MAX_ROUNDS_ADVISORY}) — advisory only; consider human judgment.`,
    );
  }

  // ── Exit contract ──
  if (cacheEligible) {
    // cacheEligible already carries `reviewedState === 'matched'`, so a mid-fan
    // drift can never reach here. Stamp EXACTLY the PRE-fan hash via the primitive
    // writer — the fan bypasses `stampReviewedContentHashIfTreeUnchanged` (which
    // would re-compute a SECOND compare) and reuses the single compare above, so
    // the artifact and the stamp can never disagree (the single-lane path keeps
    // the helper). A `null` pre-fan hash means nothing to stamp (legacy no-op).
    if (ctx.preFanContentHash !== null) {
      await writeReviewedContentHashValue(
        ctx.preFanContentHash,
        ctx.cwd,
        ctx.config.totemDir,
        ctx.configRoot,
        ctx.config.review.sourceExtensions,
      );
    }
    log.success(
      DISPLAY_TAG,
      `Review PASS — verdict ${verdictHash.slice(0, 8)} (round ${verdict.round.index}).`,
    );
    return;
  }

  throw new TotemError(
    'SHIELD_FAILED',
    `Shield review failed: ${describeIneligibility(predicateInputs)}`,
    'Fix the issues in the verdict above, then re-run `totem review`.',
  );
}

/** Name the failing cache-eligibility conjunct(s) for an honest exit reason. */
function describeIneligibility(inputs: PredicateInputs): string {
  const parts: string[] = [];
  const completed = inputs.lanes.filter((l) => l.status === 'completed').length;
  if (!everyLaneCompleted(inputs.lanes)) {
    parts.push(`lane coverage ${completed}/${inputs.lanes.length} (a lane failed or abstained)`);
  }
  const criticals = inputs.findingsUnion.filter((f) => f.severity === 'CRITICAL').length;
  if (criticals > 0) {
    parts.push(`${criticals} CRITICAL finding(s)`);
  }
  const failedRules = inputs.postChecks
    .filter((r) => r.tier === 'decidable' && r.verdict === 'fail')
    .map((r) => r.ruleName);
  if (failedRules.length > 0) {
    parts.push(`decidable post-check failure(s): ${[...new Set(failedRules)].join(', ')}`);
  }
  if (inputs.reviewedState === 'drifted') {
    parts.push('worktree drifted mid-review (verdict bound to the pre-fan tree; not authorized)');
  }
  return parts.length > 0 ? parts.join('; ') : 'not cache-eligible';
}

/** sha256 hex of a UTF-8 string (the masked-diff payload identity). */
async function sha256Hex(text: string): Promise<string> {
  const crypto = await import('node:crypto');
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

/** Config-error factory for the lane validator — a hard `CONFIG_INVALID` init error. */
function makeLaneConfigError(message: string, hint: string): TotemConfigError {
  return new TotemConfigError(message, hint, 'CONFIG_INVALID');
}
