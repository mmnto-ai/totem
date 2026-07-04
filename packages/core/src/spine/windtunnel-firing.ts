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
  /** True iff this rule's positive control is proven (per-rule, not global): a target firing (mined) or a §4 differential held at emission (authored). */
  positiveControl: boolean;
  /** True iff this rule did NOT fire on any negative control (clean = passed). */
  negativeControl: boolean;
  /**
   * Evidence for the positive result: MINED — the establishing firingLabelIds;
   * AUTHORED — `§6-emission:`-prefixed locus refs (option (i), #2291; see
   * `computeAuthoredPerRuleControlResults`). Never both shapes in one map.
   */
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
 *
 * Exported so the 5d-iii label-deriver's span-join normalizes a disposition's
 * added hunk rows with the EXACT same rule the firing's `matchedLine` uses —
 * the content bind keys on the same bytes the labelId keys on, so the two can
 * never silently drift apart (codex hard fold + the panel anti-drift mandate).
 */
export function normalizeMatchedLine(line: string): string {
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

// ─── A1 (fold-D): post-dedup uniqueness INVARIANT ────

/**
 * A1 (fold-D) — assert `firings.length === unique(labelIds).size` BEFORE
 * `scoreWindtunnel` (Tenet 4). Originally specced as a hard-gate FLOOR that
 * threw on any collision; the strategy ruling (2026-06-20) DEMOTED it to a
 * post-dedup invariant once `buildFirings` learned to collapse same-labelId
 * matches (`dedupeFirings`). It still THROWS on a collision — but a collision
 * here now means a dedup BUG (or a caller that bypassed `buildFirings`), not an
 * honest multi-match line, so failing loud is correct. We deliberately do NOT
 * add an occurrence discriminator / ordinal (it would regress `firingLabelId`'s
 * line-drift resistance); a diff-hunk-span discriminator stays reserved. The
 * invariant guards the `labelId→evidenceRef` contract the ground-truth join
 * depends on: a 1:1 labelId→firing map.
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
 * fold-D: before returning, same-`labelId` matches are collapsed to ONE logical
 * firing (`dedupeFirings`), retaining every raw match as `evidence`. The caller's
 * `assertUniqueFiringLabels` is therefore a post-dedup INVARIANT (it can no
 * longer fire on an honest multi-match line), not a pre-score floor.
 */
export async function buildFirings(input: BuildFiringsInput): Promise<BuildFiringsResult> {
  const { rules, prDiffs, cwd, readStrategy, ruleEngineCtx, onWarn } = input;

  // fold-F: hard-gate the scored set BEFORE touching the engine.
  assertNoArchivedRules(rules);

  // Pre-dedup firings (one per raw engine match); collapsed by labelId at return.
  const rawFirings: RuleFiring[] = [];
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

    // Both engines receive the FULL rule set and self-filter by `rule.engine`
    // into DISJOINT partitions — applyRulesToAdditions takes `engine === 'regex'
    // || !engine`; applyAstRulesToAdditions takes `engine === 'ast' | 'ast-grep'`
    // (rule-engine.ts). No rule is processed by both, so double-processing can
    // never manufacture a same-rule labelId self-collision at the A1 gate. (CR #2215.)
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
      rawFirings.push(violationToFiring(v, prDiff));
    }
  }

  return {
    // fold-D: collapse same-labelId matches to ONE logical firing before scoring.
    firings: dedupeFirings(rawFirings),
    filesTouchedInWindow: touchedFiles.size,
    positiveControlTargets,
  };
}

/**
 * fold-D — collapse raw firings that share a `labelId` into ONE logical firing,
 * retaining every raw match as `evidence`. Same-labelId matches arise when a
 * rule matches more than once under the identical (ruleId, pr, filePath,
 * normalizedLine) key — multiple matches on one line, or distinct physical lines
 * whose trailing-whitespace difference normalizes away. Per the strategy ruling
 * (2026-06-20) we DEDUP rather than throw or add an occurrence discriminator: an
 * ordinal would regress `firingLabelId`'s deliberate line-drift resistance, and
 * the collapse is verdict-safe under ADR-110's 1.0 precision floor (it only
 * affects the precision denominator, never the binary verdict). A diff-hunk-span
 * discriminator stays RESERVED (measure-first) if the frozen corpus ever needs
 * it. The retained firing keeps the FIRST match's fields (identical across the
 * group by construction of the key) and accumulates all matches' evidence; the
 * caller's `assertUniqueFiringLabels` is then a post-dedup invariant, not a gate.
 */
function dedupeFirings(rawFirings: RuleFiring[]): RuleFiring[] {
  const byLabel = new Map<string, RuleFiring>();
  for (const f of rawFirings) {
    const existing = byLabel.get(f.labelId);
    if (!existing) {
      byLabel.set(f.labelId, f);
      continue;
    }
    // Collapse: append this raw match's evidence to the retained firing.
    existing.evidence = [...(existing.evidence ?? []), ...(f.evidence ?? [])];
  }
  return [...byLabel.values()];
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
    // fold-D: the raw match backing this firing (≥1 after dedup collapse).
    evidence: [{ lineNumber: violation.lineNumber, rawLine: violation.line }],
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
    result.set(ruleId, {
      // Per-rule, NOT global nonVacuity: true only if THIS rule fired its target.
      positiveControl: posEvidence.length > 0,
      // Survivors are non-culled by construction (a negative-control firing culls
      // the rule and we `continue` above), so a rule reaching here fired on NO
      // negative control → negativeControl is invariantly true; the negative leg
      // carries no evidence refs (it is an absence, not a firing). (greptile #2215 P2.)
      negativeControl: true,
      evidenceRefs: posEvidence,
    });
  }
  return result;
}
