import { enrichWithAstContext } from '../ast-gate.js';
import type { CompiledRule, DiffAddition, Violation } from '../compiler-schema.js';
import { extractAddedLines } from '../diff-parser.js';
import type { RuleEngineContext } from '../rule-engine.js';
import { applyAstRulesToAdditions, applyRulesToAdditions } from '../rule-engine.js';
import { firingLabelId } from './windtunnel-lock.js';
import type { RuleFiring } from './windtunnel-scorer.js';

// ─── Types ───────────────────────────────────────────

/**
 * One resolved PR's diff plus its role in the wind-tunnel. The certifying run
 * (5c-ii) builds these from each resolved-PR diff + the controls; 5c-i is the
 * deterministic engine that turns them into `RuleFiring[]`.
 *
 * `controlKind` is the role of the PR/corpus item being scanned, NOT a property
 * of any individual rule — every rule that fires on a `negative` item is culled
 * (fold-H: neg-control firings pass through as `controlKind:'negative'`, never
 * dropped pre-score). `targetRuleId` is the rule a `positive` control MUST fire
 * to prove non-vacuousness (the positive-control contract the scorer checks).
 */
export interface ResolvedPrDiff {
  pr: number;
  /** Unified diff text for the PR (post-image additions are extracted from it). */
  diff: string;
  controlKind: 'corpus' | 'positive' | 'negative';
  /** For positive controls: the rule expected to fire (proves non-vacuousness). */
  targetRuleId?: string;
}

/**
 * C1 (fold-B's data prerequisite) — a PER-RULE control result over the
 * surviving (active, non-culled) rules. `positiveControl`/`negativeControl` are
 * derived from THIS rule's actual firings, NEVER from the run-level
 * `nonVacuity` (which is a global AND across all positive-control targets and
 * would over-stamp a rule that never exercised a control). 5c-ii consumes this
 * to stamp legitimacy per-rule, survivor-only.
 */
export interface PerRuleControlResult {
  /** True iff this rule fired its positive-control target (per-rule, not global). */
  positiveControl: boolean;
  /** True iff this rule did NOT fire on any negative control (clean = passed). */
  negativeControl: boolean;
  /** Evidence: the firingLabelIds that establish each control result. */
  evidenceRefs: string[];
}

/**
 * A1 (fold-D) collision detail — surfaced when two firings normalize to the
 * same `labelId` (the `labelId→evidenceRef`/ground-truth join would silently
 * overwrite). Emitted into the thrown error so the cert-run report can name the
 * colliding labelIds + their evidence refs.
 */
export interface FiringLabelCollision {
  labelId: string;
  /** The colliding firings' evidence (ruleId/pr/filePath/matchedLine). */
  evidenceRefs: Array<{ ruleId: string; pr: number; filePath: string; matchedLine: string }>;
}

/** Thrown by `assertUniqueFiringLabels` (A1 hard-gate floor, Tenet 4). */
export class FiringLabelCollisionError extends Error {
  readonly collisions: FiringLabelCollision[];
  constructor(collisions: FiringLabelCollision[]) {
    const detail = collisions
      .map(
        (c) =>
          `  • labelId ${c.labelId.slice(0, 12)}… collides across ${c.evidenceRefs.length} firings: ` +
          c.evidenceRefs
            .map((e) => `[rule ${e.ruleId} pr#${e.pr} ${e.filePath} "${e.matchedLine}"]`)
            .join(', '),
      )
      .join('\n');
    super(
      `Wind-tunnel firing-label collision (A1, fold-D): ${collisions.length} labelId(s) map to ` +
        `multiple firings — the labelId→evidenceRef contract is violated and ground-truth ` +
        `joins would silently overwrite.\n${detail}`,
    );
    this.name = 'FiringLabelCollisionError';
    this.collisions = collisions;
  }
}

/** Thrown when an archived rule reaches the scored set (fold-F, Tenet 4). */
export class ArchivedRuleInScopeError extends Error {
  readonly archivedRuleIds: string[];
  constructor(archivedRuleIds: string[]) {
    super(
      `Wind-tunnel scorer-input (fold-F): ${archivedRuleIds.length} archived rule(s) reached the ` +
        `scored set — archived rules must never enter the wind-tunnel (archived ≠ wind-tunnel FP). ` +
        `Filter to active rules before building firings. Offending: [${archivedRuleIds.join(', ')}]`,
    );
    this.name = 'ArchivedRuleInScopeError';
    this.archivedRuleIds = archivedRuleIds;
  }
}

// ─── Helpers ─────────────────────────────────────────

/**
 * Normalize a matched line for the content-based labelId (A2/A3). Trailing
 * whitespace is dropped so cosmetic EOL drift between the post-image and the
 * diff does not split a firing into a new labelId; interior content is
 * preserved (the label must still distinguish genuinely different lines).
 */
function normalizeMatchedLine(line: string): string {
  return line.replace(/\s+$/, '');
}

/** The rule id used for firings + ground-truth joins (the lessonHash). */
function ruleIdOf(rule: CompiledRule): string {
  return rule.lessonHash;
}

// ─── fold-F: archived-excluded loud assert ───────────

/**
 * fold-F — assert no `status:'archived'` rule is in the scored set (Tenet 4).
 * Called at the scorer input boundary BEFORE the engine runs, so
 * `applyAstRulesToAdditions` is never invoked on an archived rule and zero
 * archived refs can reach `RuleFiring[]`. Archived ≠ wind-tunnel FP: an
 * archived rule that "fires" is not evidence of imprecision, it is a corpus
 * contamination that must fail loud.
 */
export function assertNoArchivedRules(rules: CompiledRule[]): void {
  const archived = rules.filter((r) => r.status === 'archived').map(ruleIdOf);
  if (archived.length > 0) {
    throw new ArchivedRuleInScopeError(archived);
  }
}

// ─── A1 (fold-D): hard-gate-unique FLOOR ─────────────

/**
 * A1 (fold-D) — hard-gate `firings.length === unique(labelIds).size` BEFORE
 * `scoreWindtunnel` (Tenet 4). On collision THROW, surfacing the colliding
 * labelIds + their evidence refs. We do NOT add an occurrence discriminator /
 * ordinal (strategy ruling: ordinal regresses `firingLabelId`'s line-drift
 * resistance); we measure collisions on the frozen corpus and fail loud if any
 * occur. Preserves the `labelId→evidenceRef` contract: a 1:1 labelId→firing map
 * is the invariant the ground-truth join depends on.
 */
export function assertUniqueFiringLabels(firings: RuleFiring[]): void {
  const byLabel = new Map<string, RuleFiring[]>();
  for (const f of firings) {
    const existing = byLabel.get(f.labelId);
    if (existing) existing.push(f);
    else byLabel.set(f.labelId, [f]);
  }
  const collisions: FiringLabelCollision[] = [];
  for (const [labelId, group] of byLabel) {
    if (group.length > 1) {
      collisions.push({
        labelId,
        evidenceRefs: group.map((f) => ({
          ruleId: f.ruleId,
          pr: f.pr,
          filePath: f.filePath,
          matchedLine: f.matchedLine,
        })),
      });
    }
  }
  if (collisions.length > 0) {
    throw new FiringLabelCollisionError(collisions);
  }
}

// ─── Real engine path (replaces runMockEngine) ───────

export interface BuildFiringsInput {
  /** Active compiled rules (already loaded; archived must be pre-filtered). */
  rules: CompiledRule[];
  /** Resolved-PR diffs + controls (corpus / positive / negative). */
  prDiffs: ResolvedPrDiff[];
  /** Repo root for AST file resolution (NOT process.cwd() — #1304). */
  cwd: string;
  /** Post-image content seam (S1/C1 — same content for regex astContext + AST). */
  readStrategy: (file: string) => Promise<string | null>;
  /** Per-invocation rule-engine context (logger + per-ctx state). */
  ruleEngineCtx: RuleEngineContext;
  onWarn?: (msg: string) => void;
}

export interface BuildFiringsResult {
  firings: RuleFiring[];
  /** Distinct files touched across all PR diffs (C2 — real exposure). */
  filesTouchedInWindow: number;
  /** Positive-control targets, derived from the prDiffs (for the scorer). */
  positiveControlTargets: Array<{ pr: number; targetRuleId: string }>;
}

/**
 * The real-engine firing path (replaces `runMockEngine` for the certifying
 * phase). For each resolved-PR diff: extract additions → `enrichWithAstContext`
 * (regex astContext via the shared post-image readStrategy) → regex engine +
 * `applyAstRulesToAdditions` (AST/ast-grep, same readStrategy) → map every
 * `Violation` to a `RuleFiring` with `labelId = firingLabelId(...)`.
 *
 * Invariants honored here:
 *  - **fold-F**: throws if any archived rule is present (assertNoArchivedRules),
 *    so the engine is never invoked on an archived rule.
 *  - **fold-H**: a firing on a `negative` PR is emitted as `controlKind:'negative'`
 *    (the scorer culls + ledgers it — never dropped pre-score). Unlabeled firings
 *    stay in `firings` (no ground-truth) so the scorer routes them to
 *    needsAdjudication.
 *  - **C2**: `filesTouchedInWindow` is the count of distinct post-image files
 *    across all diffs — the real third exposure leg.
 *
 * Note: A1 (assertUniqueFiringLabels) is the caller's pre-score gate so the
 * collision report can be threaded into the cert-run report; this function does
 * not swallow it.
 */
export async function buildFirings(input: BuildFiringsInput): Promise<BuildFiringsResult> {
  const { rules, prDiffs, cwd, readStrategy, ruleEngineCtx, onWarn } = input;

  // fold-F: hard-gate the scored set BEFORE touching the engine.
  assertNoArchivedRules(rules);

  const firings: RuleFiring[] = [];
  const touchedFiles = new Set<string>();
  const positiveControlTargets: Array<{ pr: number; targetRuleId: string }> = [];

  for (const prDiff of prDiffs) {
    if (prDiff.controlKind === 'positive' && prDiff.targetRuleId) {
      positiveControlTargets.push({ pr: prDiff.pr, targetRuleId: prDiff.targetRuleId });
    }

    const additions: DiffAddition[] = extractAddedLines(prDiff.diff);
    for (const a of additions) {
      touchedFiles.add(a.file.replace(/\\/g, '/'));
    }
    if (additions.length === 0 || rules.length === 0) continue;

    // Enrich with AST context (regex over-fire suppression parity, C1) using the
    // SAME post-image content the AST engine will parse (S1).
    await enrichWithAstContext(additions, { cwd, readStrategy, onWarn });

    // Regex-engine violations.
    const regexViolations = applyRulesToAdditions(ruleEngineCtx, rules, additions);
    // AST / ast-grep violations (whole post-image via the shared readStrategy).
    const astViolations = await applyAstRulesToAdditions(
      ruleEngineCtx,
      rules,
      additions,
      cwd,
      undefined,
      onWarn,
      readStrategy,
    );

    for (const v of [...regexViolations, ...astViolations]) {
      firings.push(violationToFiring(v, prDiff));
    }
  }

  return {
    firings,
    filesTouchedInWindow: touchedFiles.size,
    positiveControlTargets,
  };
}

/** Map one engine `Violation` to a scored `RuleFiring` (content-based labelId). */
function violationToFiring(violation: Violation, prDiff: ResolvedPrDiff): RuleFiring {
  const ruleId = ruleIdOf(violation.rule);
  const filePath = violation.file.replace(/\\/g, '/');
  const matchedLine = normalizeMatchedLine(violation.line);
  const firing: RuleFiring = {
    ruleId,
    pr: prDiff.pr,
    filePath,
    matchedLine,
    controlKind: prDiff.controlKind,
    labelId: firingLabelId(ruleId, prDiff.pr, filePath, matchedLine),
  };
  // Carry the positive control's target so the scorer's non-vacuity check can
  // match on (pr, ruleId) — only meaningful for positive-control firings.
  if (prDiff.controlKind === 'positive' && prDiff.targetRuleId) {
    firing.targetRuleId = prDiff.targetRuleId;
  }
  return firing;
}

// ─── C1: per-rule control results ────────────────────

/**
 * C1 (fold-B's data prerequisite) — build a `Map<ruleId, PerRuleControlResult>`
 * over the SURVIVING rules (active rules that were NOT culled by a negative
 * control). `positiveControl` is true ONLY when THIS rule fired its declared
 * positive-control target — derived from the rule's own firings, never from the
 * global `nonVacuity`. `negativeControl` is true when the rule fired on NO
 * negative control. 5c-ii reads this to stamp legitimacy survivor-only.
 *
 * Survivors = mintedRuleIds minus rules that fired on any negative control
 * (those are culled; the scorer records them in the cullLedger and we do not
 * stamp them).
 */
export function computePerRuleControlResults(input: {
  firings: RuleFiring[];
  mintedRuleIds: string[];
  positiveControlTargets: Array<{ pr: number; targetRuleId: string }>;
}): Map<string, PerRuleControlResult> {
  const { firings, mintedRuleIds, positiveControlTargets } = input;

  // Rules culled by a negative-control firing (not survivors).
  const culled = new Set<string>();
  for (const f of firings) {
    if (f.controlKind === 'negative') culled.add(f.ruleId);
  }

  // Per-rule negative-control evidence: the firings that PROVE a rule fired on a
  // negative control (its negativeControl is therefore false — it gets culled).
  // A clean rule has no negative-control firing → negativeControl true by absence.
  const negFiringsByRule = new Map<string, string[]>();
  for (const f of firings) {
    if (f.controlKind !== 'negative') continue;
    const arr = negFiringsByRule.get(f.ruleId) ?? [];
    arr.push(f.labelId);
    negFiringsByRule.set(f.ruleId, arr);
  }

  // Per-rule positive-control evidence: a firing whose (pr, ruleId) matches a
  // declared positive-control target on a positive-control item.
  const targetByRule = new Map<string, Set<number>>();
  for (const t of positiveControlTargets) {
    const prs = targetByRule.get(t.targetRuleId) ?? new Set<number>();
    prs.add(t.pr);
    targetByRule.set(t.targetRuleId, prs);
  }
  const posFiringsByRule = new Map<string, string[]>();
  for (const f of firings) {
    if (f.controlKind !== 'positive') continue;
    const prs = targetByRule.get(f.ruleId);
    if (prs && prs.has(f.pr)) {
      const arr = posFiringsByRule.get(f.ruleId) ?? [];
      arr.push(f.labelId);
      posFiringsByRule.set(f.ruleId, arr);
    }
  }

  const result = new Map<string, PerRuleControlResult>();
  for (const ruleId of mintedRuleIds) {
    if (culled.has(ruleId)) continue; // not a survivor — never stamped
    const posEvidence = posFiringsByRule.get(ruleId) ?? [];
    const negEvidence = negFiringsByRule.get(ruleId) ?? [];
    result.set(ruleId, {
      // Per-rule, NOT global nonVacuity: true only if THIS rule fired its target.
      positiveControl: posEvidence.length > 0,
      // Clean (passed) when the rule fired on NO negative control.
      negativeControl: negEvidence.length === 0,
      evidenceRefs: [...posEvidence, ...negEvidence],
    });
  }
  return result;
}
