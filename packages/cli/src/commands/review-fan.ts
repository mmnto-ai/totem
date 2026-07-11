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
  VerdictPredicateInput,
  VerdictRound,
} from '@mmnto/totem';
import {
  deriveCacheEligible,
  deriveSettled,
  renderCovariateLine,
  TotemConfigError,
  VERDICT_ARTIFACT_SCHEMA_VERSION,
} from '@mmnto/totem';

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
      // Capability-admission framing (strategy-codex G2): a support-limit error naming
      // the unsupported adapter — NOT an allowlist / "structurally ineligible" rejection.
      throw makeLaneConfigError(
        `review.lanes entry "${trimmed}" uses the 'shell' provider — an unsupported adapter for review fan lanes.`,
        'Fan lanes are served by the LLM adapters (anthropic/gemini/openai/ollama); the shell adapter is not supported for review fan lanes. Use an LLM "provider:model".',
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
 * Reject fan-incompatible flags at review startup when the fan is active (finding 12).
 * `--suppress`, `--learn`, and `--auto-capture` have NO defined fan semantics yet, so a
 * fan-active run rejects them LOUDLY (naming the unsupported combination) rather than
 * silently ignoring them. Note: `--raw` is diverted to the legacy zero-LLM path upstream
 * (so the fan never activates with `--raw`; finding 1), and `--out` IS supported by the
 * fan (it writes the human-readable fan report; finding 2).
 */
export function assertFanFlagsSupported(options: {
  suppress?: string[];
  learn?: boolean;
  autoCapture?: boolean;
}): void {
  const unsupported: string[] = [];
  if (options.suppress !== undefined && options.suppress.length > 0) unsupported.push('--suppress');
  if (options.learn === true) unsupported.push('--learn');
  if (options.autoCapture === true) unsupported.push('--auto-capture');
  if (unsupported.length > 0) {
    throw makeLaneConfigError(
      `${unsupported.join(', ')} ${unsupported.length === 1 ? 'is' : 'are'} not supported with the multi-lane review fan (review.lanes configured).`,
      'These flags have no defined fan semantics yet — drop them, or run a single-lane review (an explicit --model selects a one-lane invocation on the legacy path).',
    );
  }
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

// ─── Predicates (item 6 — core-owned; consumed, never re-implemented) ────────
//
// `settled` and cache-eligibility are the SINGLE-SOURCE-OF-TRUTH pure predicates
// exported by core (`deriveSettled` / `deriveCacheEligible`, over
// `VerdictPredicateInput = { lanes, findings, postChecks, reviewedState }`). The
// fan builds the verdict and derives both from it — the assembled artifact IS a
// valid `VerdictPredicateInput`, so what the persisted boundary re-derives
// (finding 5) and what the CLI acts on can never diverge. Only the private
// `everyLaneCompleted` helper below stays local, for the honest exit-reason
// prose in `describeIneligibility`.

/** First conjunct (local mirror, for exit-reason prose only): every attempted lane completed. */
function everyLaneCompleted(lanes: readonly VerdictLane[]): boolean {
  return lanes.length > 0 && lanes.every((l) => l.status === 'completed');
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
 * The lane-blind laneId (Prop 302 G1): `lane-<index>:<resolvedBackendOrConfiguredLane>`.
 * `<index>` is the lane's zero-based position in the configured fan;
 * `<resolvedBackendOrConfiguredLane>` is the resolved backend (`provider:model`) for a
 * lane that reached one, or the configured lane string for a lane that failed before
 * a backend resolved. Backend-derived vocabulary only — the `LaneIdSchema` refinement
 * rejects any warm/cold/headless runner class.
 */
function laneId(index: number, resolvedBackendOrConfiguredLane: string): string {
  return `lane-${index}:${resolvedBackendOrConfiguredLane}`;
}

/**
 * Classify one lane's INVOCATION result (index-tagged for the laneId). The invoker is
 * called once and NOT wrapped here: an invoker throw REJECTS this promise and the fan's
 * `Promise.allSettled` maps the rejection to a `failed` lane via
 * {@link classifyRejectedLane} — an explicit terminal classification, never a bare
 * swallow (finding 13). A missing artifact emission is a `failed` lane, unextractable
 * output is `abstained`, and an extractable verdict is `completed` with a severity tally
 * from its exemption-filtered findings.
 *
 * NO retry lives here beyond `runOrchestrator`'s existing logged quota fallback
 * (the design's "no runner retry"); `resolvedBackend` records what actually ran.
 */
export async function runLane(
  index: number,
  laneModel: string,
  invoker: LaneInvoker,
  shared: ExemptionShared,
  deliveredPrompt: string,
): Promise<LaneRunResult> {
  // No try/catch: a throw here is classified by the fan's allSettled handler
  // (classifyRejectedLane) so the classification is not a bare swallow (finding 13).
  const invocation: LaneInvocation = await invoker(laneModel, deliveredPrompt);

  // A response-cache hit emits no run artifact (fresh is forced, so it cannot
  // occur — but defense in depth): missing emission is a terminal lane failure,
  // never a completed lane without genuine provenance (invariant 2). The laneId
  // uses the CONFIGURED lane (no backend resolved).
  if (invocation.runArtifactHash === undefined || invocation.runArtifact === undefined) {
    return {
      lane: {
        status: 'failed',
        laneId: laneId(index, laneModel),
        typedReason: 'missing-artifact-emission',
        // rev-6 item 3: persist the configured lane the id suffix binds to (no backend
        // resolved, so the suffix has nothing else to ground against).
        configuredLane: laneModel,
      },
      filteredFindings: [],
    };
  }

  const resolvedBackend = invocation.runArtifact.backend.qualifiedModel;
  const id = laneId(index, resolvedBackend);

  if (invocation.content === undefined) {
    // The invoke produced no content (only the degenerate --raw path). Treat as
    // an abstention — there is a run artifact but no usable structured verdict.
    return {
      lane: {
        status: 'abstained',
        laneId: id,
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
        laneId: id,
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
      laneId: id,
      resolvedBackend,
      runArtifactHash: invocation.runArtifactHash,
      verdictSummary,
    },
    runArtifact: invocation.runArtifact,
    filteredFindings: outcome.filteredFindings,
  };
}

/**
 * Map a REJECTED lane promise to a `failed` lane record (finding 13): an invoker throw
 * is classified (quota vs generic invoke error) and lands in the verdict as a terminal
 * `failed` lane — a lane is never lost to a rejection. The laneId uses the CONFIGURED
 * lane (a rejection means no backend resolved).
 */
export async function classifyRejectedLane(
  index: number,
  laneModel: string,
  reason: unknown,
): Promise<LaneRunResult> {
  const typedReason = await classifyInvokeFailure(reason);
  return {
    // rev-6 item 3: a rejected lane resolved no backend — the laneId suffix binds to the
    // configured lane, persisted here so the schema can validate that binding.
    lane: {
      status: 'failed',
      laneId: laneId(index, laneModel),
      typedReason,
      configuredLane: laneModel,
    },
    filteredFindings: [],
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
  /**
   * The RAW CLI selector form (finding 10) — the operator's exact `--diff` string. It
   * distinguishes selectors that resolve to the same refs but describe different
   * lineages: `--diff main` (base-vs-working-tree, no head) vs `--diff main..HEAD`
   * (range mode) both resolve base='main' head='HEAD' but must NOT share a lineage.
   * Threaded into `LineageKeyInput.selectorForm` so the two forms produce distinct keys.
   */
  selectorForm?: string;
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
  const selectorForm = meta.selectorForm;
  // `LineageKeyInput` is a SOURCE-DISCRIMINATED union: each variant carries only the
  // range fields its source makes meaningful, so it is built as a full per-source
  // literal (mutation would not typecheck). `selectorForm` (finding 10) rides every
  // variant's common fields.
  let keyInput: LineageKeyInput;
  switch (meta.source) {
    case 'explicit-range':
      keyInput = {
        repoIdentity,
        branch,
        selectorForm,
        source: 'explicit-range',
        base: meta.base ?? 'HEAD',
        head: meta.head ?? 'HEAD',
      };
      break;
    case 'branch-vs-base':
      keyInput = {
        repoIdentity,
        branch,
        selectorForm,
        source: 'branch-vs-base',
        base: meta.base ?? '',
        mergeBase,
      };
      break;
    case 'staged':
      keyInput = { repoIdentity, branch, selectorForm, source: 'staged' };
      break;
    case 'uncommitted':
      keyInput = { repoIdentity, branch, selectorForm, source: 'uncommitted' };
      break;
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
/**
 * Run a git probe through the injected seam and return its trimmed stdout, or
 * `undefined` when git exits non-zero. For these lineage probes a non-zero exit is an
 * EXPECTED state (a detached HEAD, a missing merge-base, a non-repo cwd), not an error.
 * This is the ONE explicit degrade point (finding 12): the failure is surfaced as a
 * Result (`undefined`), never rethrown, and every caller reads the `undefined` and
 * applies its documented fallback — so no probe site carries a bare swallow.
 */
function tryGit(gitExec: GitExec, args: readonly string[]): string | undefined {
  // totem-context: intentional fail-open — a non-zero git exit on a lineage probe is an
  // EXPECTED state (detached HEAD / missing merge-base / non-repo cwd), surfaced as a
  // Result (`undefined`) for the caller's documented fallback, never a silent drop.
  try {
    return gitExec(args).trim();
    // totem-context: intentional fail-open — expected git-probe miss → Result (undefined).
  } catch (_err) {
    return undefined;
  }
}

function resolveRepoIdentity(gitExec: GitExec, path: typeof import('node:path')): string {
  const top = tryGit(gitExec, ['rev-parse', '--show-toplevel']);
  if (top !== undefined && top.length > 0) return path.resolve(top);
  return 'WORKTREE:unknown';
}

function resolveBranch(gitExec: GitExec): string {
  const branch = tryGit(gitExec, ['symbolic-ref', '--short', 'HEAD']);
  if (branch !== undefined && branch.length > 0) return branch;
  // Detached HEAD: use a stable literal so distinct detached states do not
  // collide with a real branch named the same as a sha prefix.
  const sha = tryGit(gitExec, ['rev-parse', 'HEAD']);
  return sha !== undefined && sha.length > 0 ? `DETACHED:${sha}` : 'DETACHED:unknown';
}

function resolveMergeBase(meta: DiffScopeMeta, gitExec: GitExec): string {
  // staged / uncommitted have no second endpoint — the branch + source carry
  // the lineage (documented on the schema); '' keeps the key stable per-branch.
  if (meta.source === 'staged' || meta.source === 'uncommitted') return '';
  const base = meta.base;
  if (base === undefined) return '';
  const head = meta.head ?? 'HEAD';
  // No shared history (or the ref moved) ⇒ `undefined` ⇒ '' — the branch + source
  // still key the lineage; a moved merge-base forks the chain.
  return tryGit(gitExec, ['merge-base', base, head]) ?? '';
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
  const { findLatestVerdictForLineage, loadVerdictArtifact } = await import('@mmnto/totem');
  const warnings: string[] = [];

  if (continuesHash !== undefined) {
    // Explicit override — an honest load failure is loud (the user named it). The
    // loader returns the artifact WITH its verified address; the user-supplied
    // `continuesHash` IS that verified stored address (load verified it), so the link
    // uses it directly.
    const prior = loadVerdictArtifact(totemDirAbs, continuesHash);
    if (prior.artifact.round.lineageKey !== lineageKey) {
      warnings.push(
        `--continues ${continuesHash.slice(0, 8)} links a verdict from a DIFFERENT lineage; honoring the explicit intent and recording the current lineage key (branch/base/source moved).`,
      );
    }
    return {
      round: {
        index: prior.artifact.round.index + 1,
        priorVerdictHash: continuesHash,
        lineageKey,
      },
      warnings,
    };
  }

  // Implicit linkage on the composite lineage key. A corrupt / mis-addressed prior in
  // this lineage is content-address-verified, warned, and SKIPPED inside the scan
  // (finding 4, core-owned) — it returns `undefined` ⇒ the chain honestly restarts at
  // round 0 (the failure-table "prior verdict missing/corrupt" row). No bare catch is
  // needed here, and an UNEXPECTED failure (e.g. a filesystem permission error) now
  // propagates loud instead of masquerading as a chain restart (finding 12). The
  // per-entry skip warnings route into `warnings` for the sensor line.
  const prior = findLatestVerdictForLineage(totemDirAbs, lineageKey, (msg) => warnings.push(msg));
  if (prior === undefined) {
    return { round: { index: 0, lineageKey }, warnings };
  }
  // Link to the prior's STORED, verified content address (rev-6 item 1) — never a
  // recompute over the Zod-stripped shape, which would diverge for a forward-minor prior
  // and point `priorVerdictHash` at a nonexistent file.
  return {
    round: {
      index: prior.artifact.round.index + 1,
      priorVerdictHash: prior.contentHash,
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
 * Run the #2103 post-check engine over every lane that emitted a run artifact
 * (completed AND abstained — finding 8) and, with ≥2 COMPLETED lanes, assemble + write
 * the #2104 panel from the completed lanes' run artifacts ONLY (failed/abstained lanes
 * never reach `assemblePanelArtifact`).
 *
 * Panel inputs stay completed-only, but post-checks ALSO cover abstained lanes: an
 * abstained lane's unextractable output is exactly what the review-specific decidable
 * structured-output rule must persist a 'fail' row for, so its failure lands honestly
 * in `verdict.postChecks` instead of vanishing.
 */
export async function runPanelAndPostChecks(
  laneResults: readonly LaneRunResult[],
  totemDirAbs: string,
  configRoot: string,
  createdAt: string,
): Promise<PanelAndChecks> {
  const { evaluatePostChecks, assemblePanelArtifact, writePanelArtifact } =
    await import('@mmnto/totem');
  const rules = await buildReviewRules();

  const postChecks: PersistedPostCheckFinding[] = [];
  const laneReports = new Map<string, PostCheckReport>();

  // Completed AND abstained lanes both carry a run artifact; failed lanes do not.
  const withArtifact = laneResults.filter((lr) => lr.runArtifact !== undefined);
  for (const lr of withArtifact) {
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
  const completed = laneResults.filter((lr) => lr.lane.status === 'completed');
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
  const findings = toVerdictFindings(findingsUnion);

  // `settled` is the core-owned dryness predicate over THIS artifact's own content
  // (the persisted boundary re-derives + checks it — finding 5).
  const settled = deriveSettled({
    lanes,
    findings,
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
    findings,
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
  /**
   * The shield options the fan reads. The fan forces `fresh` per lane and forces `raw`
   * OFF (a fan-configured `--raw` is diverted to the legacy zero-LLM path upstream, so
   * `raw` never reaches here true). `out` writes the human-readable fan report;
   * `failOn` (`critical`|`warn`) opts into a non-zero exit; `override` converts a
   * `--fail-on` failure to pass AND authorizes the trap-ledgered stamp (finding 3).
   */
  options: {
    raw?: boolean;
    out?: string;
    model?: string;
    fresh?: boolean;
    override?: string;
    failOn?: 'critical' | 'warn';
  };
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

// ─── Findings render + human-readable report (finding 2) ─────────────────────

/** One normalized finding plus how many lanes converged on it (identical bytes). */
interface AttributedFinding {
  finding: ShieldFinding;
  /** Distinct completed lanes that emitted this identical (severity,file,line,message). */
  laneCount: number;
}

/** Display order — CRITICAL first, INFO last (echoes the single-lane display). */
const FAN_SEVERITY_ORDER: readonly ShieldFinding['severity'][] = ['CRITICAL', 'WARN', 'INFO'];

/**
 * Dedupe the completed lanes' exemption-filtered findings on
 * `(severity, file, line, message)` and count how many distinct lanes converged on
 * each (finding 2). Failed/abstained lanes contribute nothing (no findings).
 */
function dedupeFanFindings(laneResults: readonly LaneRunResult[]): AttributedFinding[] {
  const map = new Map<string, { finding: ShieldFinding; lanes: Set<string> }>();
  for (const lr of laneResults) {
    if (lr.lane.status !== 'completed') continue;
    const id = lr.lane.laneId;
    for (const f of lr.filteredFindings) {
      const key = JSON.stringify([f.severity, f.file ?? null, f.line ?? null, f.message]);
      const existing = map.get(key);
      if (existing !== undefined) existing.lanes.add(id);
      else map.set(key, { finding: f, lanes: new Set([id]) });
    }
  }
  const out = [...map.values()].map((e) => ({ finding: e.finding, laneCount: e.lanes.size }));
  out.sort(
    (a, b) =>
      FAN_SEVERITY_ORDER.indexOf(a.finding.severity) -
      FAN_SEVERITY_ORDER.indexOf(b.finding.severity),
  );
  return out;
}

/**
 * One rendered finding line — echoes the single-lane display styling
 * (`  <SEVERITY> [<conf>] <file>:<line> — <message>`) plus a lane-convergence
 * annotation (`(N lanes)`).
 */
function formatFanFinding(af: AttributedFinding): string {
  const f = af.finding;
  const location =
    f.file !== undefined ? (f.line !== undefined ? `${f.file}:${f.line} ` : `${f.file} `) : '';
  const conf = f.confidence !== undefined ? ` [${f.confidence}]` : '';
  const conv = ` (${af.laneCount} lane${af.laneCount === 1 ? '' : 's'})`;
  return `  ${f.severity}${conf} ${location}— ${f.message}${conv}`;
}

/**
 * Render the normalized finding union to stderr BEFORE the summary (finding 2) — the
 * actual finding MESSAGES, with lane attribution, in severity order.
 */
function renderFanFindingsToStderr(findings: readonly AttributedFinding[]): void {
  if (findings.length === 0) {
    console.error('Review fan — 0 finding(s) across lanes.');
    return;
  }
  console.error(`Review fan — ${findings.length} finding(s) (deduped across lanes):`);
  for (const af of findings) console.error(formatFanFinding(af));
}

/**
 * The human-readable fan report written by `--out` (finding 2): the findings, the
 * per-lane outcomes, and the summary (covariate line + settled/cache/drift state).
 */
function renderFanReport(
  laneResults: readonly LaneRunResult[],
  verdict: VerdictArtifact,
  verdictHash: string,
  findings: readonly AttributedFinding[],
  cacheEligible: boolean,
): string {
  const lines: string[] = [];
  lines.push(
    `Review fan — ${verdict.completedLaneCount}/${verdict.attemptedLaneCount} lane(s) completed`,
  );
  lines.push('');
  lines.push('Lanes:');
  for (const lr of laneResults) {
    const l = lr.lane;
    if (l.status === 'completed') {
      const s = l.verdictSummary;
      lines.push(
        `  ${l.laneId} — completed (${s.critical} critical, ${s.warn} warn, ${s.info} info)`,
      );
    } else if (l.status === 'abstained') {
      lines.push(`  ${l.laneId} — abstained (${l.reason})`);
    } else {
      lines.push(`  ${l.laneId} — failed (${l.typedReason})`);
    }
  }
  lines.push('');
  lines.push(`Findings (${findings.length}):`);
  if (findings.length === 0) lines.push('  (none)');
  else for (const af of findings) lines.push(formatFanFinding(af));
  lines.push('');
  // Pair the artifact with its STORED address (rev-6 item 1) so the rendered hash8 is the
  // on-disk file address, not a recompute over the normalized shape.
  lines.push(renderCovariateLine({ artifact: verdict, contentHash: verdictHash }));
  lines.push(
    `settled=${verdict.settled} cache-eligible=${cacheEligible} reviewedState=${verdict.reviewedState}`,
  );
  return lines.join('\n');
}

/**
 * The standard-path fan entry. Runs every configured lane IN PARALLEL (finding 13),
 * canonicalizes the results into configured-lane order, runs the panel + post-checks,
 * resolves the round chain, takes the single post-fan tree compare in a short critical
 * section (finding 6), assembles + saves the verdict, renders the findings + covariate
 * line, and enforces the exit contract (finding 3 / Gate G5):
 *
 *   - DEFAULT: sensor exit 0 — the verdict, the covariate line, and the findings render
 *     are always emitted; a findings-bearing or degraded-coverage round does NOT throw.
 *   - `--fail-on <severity>`: throw `SHIELD_FAILED` when the round has findings at/above
 *     that severity OR is not cache-eligible.
 *   - `--override <reason>`: converts a `--fail-on` failure to pass AND authorizes the
 *     trap-ledgered cache stamp on a non-cache-eligible round (matched trees only —
 *     drift is never stampable, even overridden).
 *
 * Cache-eligible ⇒ stamp the pre-fan hash. ALL lanes terminal-failed (Gate G3) ⇒ the
 * honest verdict is WRITTEN FIRST, then the run hard-errors. Zero configured lanes ⇒ a
 * pre-attempt hard error with no verdict.
 */
export async function runReviewFan(ctx: ReviewFanContext): Promise<void> {
  const { log } = await import('../ui.js');
  const { TotemError, maskSecrets } = await import('@mmnto/totem');

  // ── Pre-attempt guard: zero configured lanes ⇒ no verdict (the schema requires a
  // nonempty lanes array; there is nothing to converge). This is a pre-attempt failure,
  // NOT the all-lanes-failed case (which writes an honest verdict first, Gate G3). ──
  if (ctx.laneModels.length === 0) {
    throw new TotemError(
      'SHIELD_FAILED',
      'All 0 review lane(s) configured — no verdict written (configure at least one review.lanes entry).',
      'Add a `provider:model` entry to `review.lanes`, then re-run `totem review`.',
    );
  }

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

  // ── Run every lane IN PARALLEL over the immutable shared deliveredPrompt (finding 13) ──
  // `Promise.allSettled` preserves input order, so the results are already in
  // configured-lane order — the artifact is deterministic regardless of completion
  // order. A rejected lane promise is mapped to a `failed` lane classification
  // (classifyRejectedLane) so a lane is never lost.
  const settledLanes = await Promise.allSettled(
    ctx.laneModels.map((laneModel, index) =>
      runLane(index, laneModel, invoker, ctx.shared, deliveredPrompt),
    ),
  );
  const laneResults: LaneRunResult[] = [];
  for (let index = 0; index < settledLanes.length; index++) {
    const s = settledLanes[index]!;
    laneResults.push(
      s.status === 'fulfilled'
        ? s.value
        : await classifyRejectedLane(index, ctx.laneModels[index]!, s.reason),
    );
  }

  // ── Log per-lane outcomes in configured order (deterministic) ──
  for (let index = 0; index < laneResults.length; index++) {
    const laneModel = ctx.laneModels[index]!;
    const lane = laneResults[index]!.lane;
    if (lane.status === 'failed') {
      log.warn(DISPLAY_TAG, `Lane ${laneModel} FAILED (${lane.typedReason}).`);
    } else if (lane.status === 'abstained') {
      log.warn(DISPLAY_TAG, `Lane ${laneModel} ABSTAINED (${lane.reason}).`);
    } else {
      const s = lane.verdictSummary;
      log.info(
        DISPLAY_TAG,
        `Lane ${laneModel} completed — ${s.critical} critical, ${s.warn} warn, ${s.info} info.`,
      );
    }
  }

  const anyWithOutput = laneResults.some(
    (lr) => lr.lane.status === 'completed' || lr.lane.status === 'abstained',
  );
  const createdAt = now();

  // ── Panel + post-checks (over completed AND abstained lanes; finding 8) ──
  const panelAndChecks = await runPanelAndPostChecks(
    laneResults,
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

  // ── Post-fan tree compare — the REAL critical section (finding 6) ──
  // Sampled here, AFTER the post-check / panel / lineage work, immediately before
  // verdict assembly + report + stamp: a mutation DURING any of that work is caught.
  // This single compare feeds BOTH predicates AND the stamp decision — no second
  // compare, no TOCTOU divergence. A `null` pre-fan hash means there was no tracked
  // source to authorize (legacy no-op).
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

  // ── Assemble + save the verdict — kept ADJACENT to the compare above and the stamp
  // below (rev-5 item 2). The compare→stamp interval is deliberately narrowed to
  // exactly assemble (pure, in-memory) + save (one `wx` write): this window is
  // INHERENT, because `reviewedState` is persisted verdict content — the compare must
  // precede assembly, and the artifact must exist before a stamp can claim the round
  // is recorded. Every render/report/covariate/--out side effect happens AFTER the
  // stamp decision, so mutation during that I/O can never influence it. ──
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

  // ── ALL lanes terminal-failed (Gate G3): the honest verdict is now WRITTEN — hard-error ──
  // (A pure boolean check — it does not widen the compare→stamp window, and an
  // all-failed round is never cache-eligible nor override-stampable: the run ends here.)
  if (!anyWithOutput) {
    throw new TotemError(
      'SHIELD_FAILED',
      `All ${laneResults.length} review lane(s) failed to invoke — an honest verdict was written (all lanes failed, not settled), then the run hard-errors.`,
      'Check backend API keys / quota, then re-run `totem review`.',
    );
  }

  // ── Predicates (the verdict IS a valid VerdictPredicateInput) ──
  const cacheEligible = deriveCacheEligible(verdict);

  // ── Cache stamp — ADJACENT to the save (rev-5 item 2), BEFORE any render/report I/O;
  // independent of the sensor/fail-on exit decision (finding 3) ──
  const override = ctx.options.override;
  if (cacheEligible) {
    // cacheEligible carries `reviewedState === 'matched'`, so drift can never reach
    // here. Stamp EXACTLY the PRE-fan hash via the primitive writer (reusing the single
    // compare above), never a second recompute. A `null` pre-fan hash ⇒ nothing to stamp.
    if (ctx.preFanContentHash !== null) {
      await writeReviewedContentHashValue(
        ctx.preFanContentHash,
        ctx.cwd,
        ctx.config.totemDir,
        ctx.configRoot,
        ctx.config.review.sourceExtensions,
      );
    }
  } else if (override !== undefined) {
    if (reviewedState === 'matched') {
      // `--override` authorizes the trap-ledgered cache stamp on a non-cache-eligible
      // round — through the ledger+explicit-hash primitive (rev-5 item 1, codex
      // critical): it binds the PRE-FAN hash and recomputes the CURRENT tree hash once
      // more immediately adjacent to the stamp write. An edit landing after the fan's
      // one compare (which derived `reviewedState`) is caught there — loud refusal,
      // ledgered override WITHOUT a stamp. The current tree hash is NEVER stamped.
      log.warn(DISPLAY_TAG, `SHIELD OVERRIDE APPLIED: ${override}`);
      const { recordShieldOverrideWithExpectedHash } = await import('./shield.js');
      await recordShieldOverrideWithExpectedHash({
        override,
        cwd: ctx.cwd,
        totemDir: ctx.config.totemDir,
        configRoot: ctx.configRoot,
        sourceExtensions: ctx.config.review.sourceExtensions,
        expectedContentHash: ctx.preFanContentHash,
        // The SAME seam the fan's own compare used (production: re-hash the tracked
        // tree), so tests can inject a post-compare mutation and prove the refusal.
        computeCurrentHash: contentHash,
      });
    } else {
      // Drift is NEVER stampable, even overridden (finding 3) — say it loudly.
      log.warn(
        DISPLAY_TAG,
        'OVERRIDE CANNOT STAMP A DRIFTED TREE: the worktree changed mid-review, so the reviewed-content-hash was NOT stamped even under --override. The verdict stands (bound to the pre-fan tree); no push is authorized. Re-run `totem review` against the current tree.',
      );
    }
  }

  // ── Findings render (finding 2) — the actual messages, AFTER the stamp decision ──
  const fanFindings = dedupeFanFindings(laneResults);
  renderFanFindingsToStderr(fanFindings);

  // ── The core-owned, grep-able covariate line (contract v1; finding 14) ──
  // Pair the freshly-saved verdict with the address `saveVerdictArtifact` returned
  // (its verified on-disk address) so the rendered hash8 always names the stored file.
  log.info(DISPLAY_TAG, renderCovariateLine({ artifact: verdict, contentHash: verdictHash }));

  // ── --out: write the human-readable fan report (findings + lanes + summary) ──
  if (ctx.options.out) {
    const { writeOutput } = await import('../utils.js');
    writeOutput(
      renderFanReport(laneResults, verdict, verdictHash, fanFindings, cacheEligible),
      ctx.options.out,
    );
    log.success(DISPLAY_TAG, `Fan report written to ${ctx.options.out}`);
  }

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

  // ── Exit contract (finding 3 / Gate G5) ──
  // Default: sensor exit 0. `--fail-on <severity>` opts into a non-zero exit when the
  // round has findings at/above that severity OR is not cache-eligible; `--override`
  // converts that failure to a pass.
  const failOn = ctx.options.failOn;
  if (failOn !== undefined) {
    const hasAtOrAbove =
      failOn === 'critical'
        ? verdict.findings.some((f) => f.severity === 'CRITICAL')
        : verdict.findings.some((f) => f.severity === 'WARN' || f.severity === 'CRITICAL');
    if (hasAtOrAbove || !cacheEligible) {
      if (override === undefined) {
        throw new TotemError(
          'SHIELD_FAILED',
          `Shield review failed (--fail-on ${failOn}): ${describeFailOnFailure(verdict, failOn, cacheEligible)}`,
          'Fix the issues in the verdict above, then re-run `totem review` (or pass --override <reason> to convert this --fail-on failure to a pass).',
        );
      }
      log.warn(
        DISPLAY_TAG,
        `SHIELD OVERRIDE: --fail-on ${failOn} failure converted to pass by override (${override}).`,
      );
    }
  }

  log.success(
    DISPLAY_TAG,
    `Review complete — verdict ${verdictHash.slice(0, 8)} (round ${verdict.round.index}, settled=${verdict.settled}).`,
  );
}

// ─── Covariate transport (rev-5 item 4 — executable, read-only, zero-LLM) ─────

/** `printCovariateLine` inputs — the resolved diff-scope metadata plus store location. */
export interface CovariateQuery {
  /**
   * Resolved diff-scope metadata from `getDiffForReview`, or `null` when no diff was
   * detected (no scope ⇒ no lineage ⇒ loud sensor message, exit 0).
   */
  diffMeta: DiffScopeMeta | null;
  /** Absolute `.totem` dir. */
  totemDirAbs: string;
  cwd: string;
  /** Injected git runner (tests); production uses `safeExec('git', ...)`. */
  gitExec?: GitExec;
}

/**
 * `totem review --covariate` (rev-5 item 4): the EXECUTABLE covariate transport.
 * Read-only and zero-LLM — resolves the CURRENT lineage through exactly the same
 * {@link resolveLineage} path `runReviewFan` uses (never a re-implementation), loads
 * the latest verdict for that lineage, and prints the core-owned
 * {@link renderCovariateLine} to STDOUT (the skills pipe it into the consolidated
 * round-disposition comment). No verdict for the lineage ⇒ a LOUD sensor message and
 * a clean return (exit 0) — the caller learns there is no line to carry, nothing gates.
 */
export async function printCovariateLine(query: CovariateQuery): Promise<void> {
  const { log } = await import('../ui.js');
  if (query.diffMeta === null) {
    log.warn(
      DISPLAY_TAG,
      'Covariate: no diff detected — no review lineage resolves, so there is no covariate line to print (sensor; exit 0).',
    );
    return;
  }
  const gitExec = query.gitExec ?? (await defaultGitExec(query.cwd));
  const lineage = await resolveLineage(query.diffMeta, gitExec);
  const { findLatestVerdictForLineage } = await import('@mmnto/totem');
  const verdict = findLatestVerdictForLineage(query.totemDirAbs, lineage.lineageKey, (msg) =>
    log.warn(DISPLAY_TAG, `Sensor: ${msg}`),
  );
  if (verdict === undefined) {
    log.warn(
      DISPLAY_TAG,
      'Covariate: no verdict artifact recorded for the current lineage — run `totem review` with review.lanes configured to emit one (sensor; exit 0).',
    );
    return;
  }
  // STDOUT, not the stderr log: this line IS the transport payload (format v1). The
  // loader returns the artifact WITH its verified stored address (rev-6 item 1), so a
  // forward-minor verdict advertises its RAW file address — byte-equal to the filename.
  console.log(renderCovariateLine(verdict));
}

/** Name the failing cache-eligibility conjunct(s) for an honest exit reason. */
function describeIneligibility(inputs: VerdictPredicateInput): string {
  const parts: string[] = [];
  const completed = inputs.lanes.filter((l) => l.status === 'completed').length;
  if (!everyLaneCompleted(inputs.lanes)) {
    parts.push(`lane coverage ${completed}/${inputs.lanes.length} (a lane failed or abstained)`);
  }
  const criticals = inputs.findings.filter((f) => f.severity === 'CRITICAL').length;
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

/**
 * The honest reason a `--fail-on <severity>` gate tripped: the findings at/above the
 * threshold (WARNs are surfaced only for `--fail-on warn`, since they don't affect
 * cache-eligibility) plus any cache-ineligibility conjunct.
 */
function describeFailOnFailure(
  verdict: VerdictArtifact,
  failOn: 'critical' | 'warn',
  cacheEligible: boolean,
): string {
  const parts: string[] = [];
  if (failOn === 'warn') {
    const warns = verdict.findings.filter((f) => f.severity === 'WARN').length;
    if (warns > 0) parts.push(`${warns} WARN finding(s)`);
  }
  if (!cacheEligible) parts.push(describeIneligibility(verdict));
  return parts.length > 0 ? parts.join('; ') : `findings at or above ${failOn}`;
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
