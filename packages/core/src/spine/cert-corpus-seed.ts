// ─── #709 Gate-1 cert-corpus materialization — seed manifest + pure producer ──
//
// The cert run's SCORING corpus (`split.json`, `pr-diffs.json`, the control dirs,
// and the lock that pins them) has no producer today — `loadCertRunFixtures`
// hard-requires them but only `record` (the minted-rules half) writes anything.
// This module is the PURE half of the producer (panel-ratified, strategy#709):
// it turns a small CURATED seed manifest + the git-enumerated `PrMeta[]` into the
// derived corpus + a validated frozen split + the per-held-out-PR control roles,
// and assembles the windtunnel lock once the I/O-derived integrity shas are known.
//
// Boundary (panel OQ1/OQ2): the SEED carries the irreducible answer-key decisions
// (asOfCommit, selection predicate/config, cutIndex, control designations +
// positive `targetRuleId`); EVERYTHING else is derived. All git I/O (enumeration,
// diff resolution, hashing) lives in the CLI; this module is pure + fully testable
// without git. Reuses `resolveSelectionRule` (corpus) + `resolveSplit` (the
// validated ancestry-cut split, with all its fail-loud cover/disjointness guards).

import { z } from 'zod';

import { type PrMeta, resolveSelectionRule, type SelectionRuleConfig } from './selection-rule.js';
import { mergeCommitMap, resolveSplit, type SplitArtifact } from './split.js';
import { type WindtunnelLock, WindtunnelLockSchema } from './windtunnel-lock.js';

const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;

/** A required string that rejects whitespace-only values (`.min(1)` alone would admit `"   "`). */
const nonBlank = (msg?: string): z.ZodString => z.string().trim().min(1, msg);

// ─── Seed manifest schema (the curated answer-key inputs) ────────────────────

const CodePathClassifierSeedSchema = z.object({
  includeGlobs: z.array(nonBlank()).min(1, 'includeGlobs must list at least one glob'),
  excludeGlobs: z.array(nonBlank()),
});

/**
 * Positive controls MUST name the rule expected to fire (fold-1, codex panel):
 * a positive control with no `targetRuleId` silently weakens the non-vacuity
 * contract (`buildFirings` only records a positive target when one is present),
 * so the seed makes it structurally required — the producer never relies on the
 * permissive consumer `ResolvedPrDiffSchema` (where `targetRuleId` is optional).
 */
const PositiveControlSeedSchema = z.object({
  pr: z.number().int().positive(),
  targetRuleId: nonBlank('a positive control must name its targetRuleId'),
});

export const CertCorpusSeedSchema = z
  .object({
    // ADR-112 §7/§8 Slice D5 — the PRODUCER this seed materializes. Absent ⇒ 'mined' (the
    // canonical absent-⇒-mined default). Read ONCE at the materialize entry (single
    // kind-resolution) to dispatch the mined path vs the authored sibling; never a
    // downstream branch. Additive-optional: every existing mined seed parses unchanged.
    producerKind: z.enum(['mined', 'authored']).optional(),
    gate: nonBlank(),
    canonicalPath: nonBlank(),
    repo: nonBlank(),
    // The producer materializes the CERTIFYING scoring corpus; the harness phase
    // has no real corpus to materialize.
    phase: z.literal('certifying'),
    selectionRule: z.object({
      state: z.string(),
      predicate: z.string().refine((s) => s.trim().length > 0, {
        message: 'selectionRule.predicate must be a non-empty expression',
      }),
      window: z.discriminatedUnion('type', [
        z.object({ type: z.literal('all') }),
        z.object({ type: z.literal('bounded'), n: z.number().int().positive() }),
      ]),
      asOfCommit: z.string().regex(COMMIT_SHA_RE, 'asOfCommit must be a 40-hex SHA'),
      codePathClassifier: CodePathClassifierSeedSchema,
      excludeRevertPairs: z.boolean().default(true),
      excludeBotPrs: z.boolean().default(true),
    }),
    split: z.object({
      cutIndex: z.number().int().nonnegative(),
      // The atomic revert pairs to drop from train/held-out (kept in the cover).
      // Usually empty when `excludeRevertPairs` already culls reverts at selection.
      excludedPrs: z.array(z.number().int().positive()).default([]),
      // ADR-112 §5.1 D5 — the REAL pre-authoring freeze instant (full ISO-8601). The authored
      // producer BINDS `split.frozenAt` to this (loaded, NEVER re-stamped at materialize) so the
      // Q3 temporal gate checks the actual freeze-before-authoring chronology. Required for an
      // authored run — materialize fails loud if absent (a materialize-`now()` freeze is
      // necessarily AFTER authoring ⇒ the gate would always throw, #2287 couple HOLD). A mined
      // seed omits it (byte-unchanged).
      frozenAt: z.string().datetime({ offset: true }).optional(),
    }),
    controls: z.object({
      positiveRef: nonBlank(),
      negativeRef: nonBlank(),
      mechanism: nonBlank(),
      positive: z.array(PositiveControlSeedSchema).default([]),
      negative: z.array(z.number().int().positive()).default([]),
    }),
    fpDefinition: z.object({
      rubricRef: z.string(),
      groundTruthRef: z.string(),
      adjudicator: z.string(),
    }),
    cullRateThreshold: z.number().min(0).lt(1),
    exposureDenominator: z.object({
      activeRulesEvaluated: z.object({ floor: z.number().int().min(2) }),
      filesTouchedInWindow: z.object({ floor: z.number().int().nonnegative() }),
      positiveControlsExercised: z.object({ floor: z.number().int().nonnegative() }),
    }),
  })
  .superRefine((seed, ctx) => {
    // Amendment-C seed-level guard (fold-4): reject a contradictory seed BEFORE
    // emit, so a producer bug can never "repair" it by silently moving a control.
    const posPrs = seed.controls.positive.map((p) => p.pr);
    const negPrs = seed.controls.negative;
    const posSet = new Set(posPrs);
    const negSet = new Set(negPrs);
    if (posSet.size !== posPrs.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'controls.positive contains duplicate PRs',
        path: ['controls', 'positive'],
      });
    }
    if (negSet.size !== negPrs.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'controls.negative contains duplicate PRs',
        path: ['controls', 'negative'],
      });
    }
    const both = posPrs.filter((pr) => negSet.has(pr));
    if (both.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `control PRs tagged BOTH positive and negative: [${both.join(', ')}] (a PR cannot be both)`,
        path: ['controls'],
      });
    }
    // ADR-112 D5 couple ruling (strategy#804): parse-time owns PRESENCE — an authored
    // seed without the pre-authoring freeze instant is invalid-by-construction (the
    // materialize Q3 gate is production-unsatisfiable without it, #2287 couple HOLD).
    // Temporal SEMANTICS (ordering vs authoredAt, loaded-not-stamped sourcing) stay
    // enforced at materialize — layered clauses, not a second home for one fact.
    if (seed.producerKind === 'authored' && seed.split.frozenAt === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "producerKind 'authored' requires split.frozenAt (the pre-authoring freeze instant)",
        path: ['split', 'frozenAt'],
      });
    }
  });

export type CertCorpusSeed = z.infer<typeof CertCorpusSeedSchema>;

// ─── Derivation output ───────────────────────────────────────────────────────

export type PrControlKind = 'corpus' | 'positive' | 'negative';

/** The control role of one held-out (scored) PR — drives pr-diffs.json + control-dir routing. */
export interface PrDiffRole {
  pr: number;
  controlKind: PrControlKind;
  /** Present iff `controlKind === 'positive'` (the rule that MUST fire). */
  targetRuleId?: string;
}

export interface DerivedCorpus {
  /** The full corpus = `resolveSelectionRule(metas, config)` = the lock's resolvedPrs PR set. */
  corpus: number[];
  /** The validated frozen split (train/held-out/excluded + control tags). */
  split: SplitArtifact;
  /**
   * Per-held-out-PR control roles — the SCORED slice (`pr-diffs.json` covers
   * held-out, controls are tags within it; mining runs over train, never scored).
   */
  prDiffRoles: PrDiffRole[];
}

/** Fail-loud producer fault (Tenet 4): a contradictory seed never materializes. */
export class CertCorpusSeedError extends Error {
  constructor(message: string) {
    super(`[Totem Error] cert-corpus producer: ${message}`);
    this.name = 'CertCorpusSeedError';
  }
}

/**
 * Pure derivation: corpus + frozen split + held-out control roles from the seed
 * and the git-enumerated `PrMeta[]` (newest-first `--topo-order`, as
 * `enumeratePrMetas` returns). Throws `CertCorpusSeedError` on any contradiction
 * BEFORE emit (Amendment-C: controls must be corpus members; `resolveSplit` then
 * enforces controls ⊆ held-out + the disjoint cover). No git, no I/O.
 */
export function deriveCorpus(params: { seed: CertCorpusSeed; metas: PrMeta[] }): DerivedCorpus {
  const { seed, metas } = params;

  const config: SelectionRuleConfig = {
    codePathClassifier: seed.selectionRule.codePathClassifier,
    excludeRevertPairs: seed.selectionRule.excludeRevertPairs,
    excludeBotPrs: seed.selectionRule.excludeBotPrs,
    window: seed.selectionRule.window,
  };

  const corpus = resolveSelectionRule(metas, config);
  if (corpus.length === 0) {
    throw new CertCorpusSeedError(
      `selectionRule(${seed.selectionRule.asOfCommit}) resolved an EMPTY corpus — no qualifying ` +
        `code-touching PRs. Check the codePathClassifier globs and the enumerated history.`,
    );
  }

  // Amendment-C (fold-4): every designated control must be a corpus member, else
  // the answer key references a PR outside the scored universe (non-vacuity).
  const corpusSet = new Set(corpus);
  const posPrs = seed.controls.positive.map((p) => p.pr);
  const negPrs = seed.controls.negative;
  const outOfCorpus = [...posPrs, ...negPrs].filter((pr) => !corpusSet.has(pr));
  if (outOfCorpus.length > 0) {
    throw new CertCorpusSeedError(
      `control PRs not in the resolved corpus: [${outOfCorpus.join(', ')}] — controls must be ` +
        `corpus members (Amendment-C / non-vacuity).`,
    );
  }

  // resolveSplit needs corpus-covering ancestry order + merge commits; metas
  // (⊇ corpus) provide both. It fail-loud-validates the cut, excludedPrs ⊆ corpus,
  // controls ⊆ held-out, and the three-way disjoint cover.
  const split = resolveSplit({
    asOfCommit: seed.selectionRule.asOfCommit,
    corpus,
    orderedNewestFirst: metas.map((m) => m.pr),
    excludedPrs: seed.split.excludedPrs,
    cutIndex: seed.split.cutIndex,
    positiveControlPrs: posPrs,
    negativeControlPrs: negPrs,
    predicate: seed.selectionRule.predicate,
    mergeCommitByPr: mergeCommitMap(metas),
  });

  const posSet = new Set(posPrs);
  const negSet = new Set(negPrs);
  const targetByPr = new Map(seed.controls.positive.map((p) => [p.pr, p.targetRuleId]));
  const prDiffRoles: PrDiffRole[] = split.heldOutPrs.map((pr) => {
    if (posSet.has(pr)) return { pr, controlKind: 'positive', targetRuleId: targetByPr.get(pr)! };
    if (negSet.has(pr)) return { pr, controlKind: 'negative' };
    return { pr, controlKind: 'corpus' };
  });

  return { corpus, split, prDiffRoles };
}

// ─── Lock assembly (pure; the CLI supplies the I/O-derived integrity shas) ────

/** A resolved corpus PR with the git-derived base/head the lock pins. */
export interface ResolvedPrInput {
  pr: number;
  mergeCommit: string;
  baseSha: string;
  headSha: string;
}

/** The integrity shas the CLI computes off disk after materializing the fixtures. */
export interface LockIntegrityInput {
  /** 40-hex `git hash-object` digest over the control dirs (`computeFixtureSha`). */
  fixtureSha: string;
  /** 64-hex sha256 over the canonical `pr-diffs.json` (fold-2). */
  prDiffsSha: string;
  /** 64-hex sha256 over the frozen `llm-replay.v1` — stamped by `freeze` after `record` (two-phase). */
  llmReplaySha?: string;
}

/**
 * Assemble + validate the windtunnel lock (pure). The producer authors the WHOLE
 * lock (panel OQ4 — single writer); the I/O-derived integrity shas are passed in.
 * `llmReplaySha` is OMITTED at producer time and stamped later by `freeze` (the
 * two-phase sealed lock, panel OQ-seq). Parses through `WindtunnelLockSchema`, so
 * a malformed assembly (unsorted/duplicate resolvedPrs, bad sha) fails loud here.
 */
export function buildWindtunnelLock(params: {
  seed: CertCorpusSeed;
  resolvedPrs: ResolvedPrInput[];
  integrity: LockIntegrityInput;
  /**
   * ADR-112 §8 Slice D5 — the authored producer stamps `producerKind:'authored'` so the
   * resolver selects the authored sibling. Absent ⇒ mined (the canonical absent-⇒-mined
   * default). Additive-optional: the mined producer never passes it, so the emitted lock is
   * BYTE-IDENTICAL to the pre-D5 shape (conditional-spread below, no `key:undefined`).
   */
  producerKind?: 'authored';
  /** ADR-112 §8 D5 — the authored cert-run input binding (present ONLY with `producerKind:'authored'`). */
  authored?: { expectedSplitRef: string };
}): WindtunnelLock {
  const { seed, resolvedPrs, integrity, producerKind, authored } = params;
  const sortedPrs = [...resolvedPrs].sort((a, b) => a.pr - b.pr);

  const lock = {
    schema: 'windtunnel.lock.v1' as const,
    canonicalPath: seed.canonicalPath,
    gate: seed.gate,
    phase: seed.phase,
    // D5 authored producer fields — conditional-spread so a mined lock omits them entirely
    // and serializes byte-identically (the §7 no-blast-radius guard; schema `.superRefine`
    // rejects a stray `authored` block on a non-authored lock).
    ...(producerKind !== undefined ? { producerKind } : {}),
    ...(authored !== undefined ? { authored } : {}),
    corpus: {
      repo: seed.repo,
      selectionRule: {
        state: seed.selectionRule.state,
        predicate: seed.selectionRule.predicate,
        window: seed.selectionRule.window,
        asOfCommit: seed.selectionRule.asOfCommit,
        codePathClassifier: seed.selectionRule.codePathClassifier,
        excludeRevertPairs: seed.selectionRule.excludeRevertPairs,
        excludeBotPrs: seed.selectionRule.excludeBotPrs,
      },
      resolvedPrs: sortedPrs.map((p) => ({
        pr: p.pr,
        mergeCommit: p.mergeCommit,
        baseSha: p.baseSha,
        headSha: p.headSha,
      })),
    },
    fpDefinition: {
      rubricRef: seed.fpDefinition.rubricRef,
      groundTruthRef: seed.fpDefinition.groundTruthRef,
      adjudicator: seed.fpDefinition.adjudicator,
      precisionFloor: 1.0 as const,
    },
    controls: {
      positiveRef: seed.controls.positiveRef,
      negativeRef: seed.controls.negativeRef,
      integrity: {
        mechanism: seed.controls.mechanism,
        fixtureSha: integrity.fixtureSha,
        prDiffsSha: integrity.prDiffsSha,
        // `!== undefined` (not truthy): an explicit `''` must reach the schema and
        // fail its 64-hex regex, never be silently dropped (CR panel — fail-loud).
        ...(integrity.llmReplaySha !== undefined ? { llmReplaySha: integrity.llmReplaySha } : {}),
      },
    },
    cullRateThreshold: seed.cullRateThreshold,
    exposureDenominator: seed.exposureDenominator,
  };

  return WindtunnelLockSchema.parse(lock);
}
