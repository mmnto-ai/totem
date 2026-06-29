// ─── ADR-112 §6/§9 — the authored-controls EMISSION builder (slice C2b) ──────
//
// An authored rule earns its §6 controls structurally, not by hand: a TRAIN-side
// positive fixture becomes a positive control ONLY when its preimage-differential
// HOLDS (fires on the defect preimage, silent on the fixed postimage — §4); a
// declared near-miss becomes a negative control DECLARATIVELY (a one-leg silence
// assertion the §6 scorer resolves at slice D). This module turns a set of
// compiled AUTHORED rules + the frozen split into those three emission lists.
//
// It is deliberately INERT (like the C1 preimage-differential primitive): it
// wires nothing into a cert run, mints no §5 verdict, and reads no git. The §4
// differential is injected (default = the real evaluator) so the producer stays
// pure + fully testable; slice D consumes the emission lists + joins the loci
// back (Tenet-20) to the run vocabulary.
//
// Two strategy-ratified asymmetries (strategy#777) are load-bearing here:
//   - POSITIVE controls are GATED on the §4 differential and carry the per-fixture
//     `contentHash` — the two-loci-one-PR disambiguator that prevents a wrong-
//     exemplar miscert when one PR contributes two fixtures (Q1 ruling (a)).
//   - NEGATIVE controls are DECLARATIVE — no differential, no silence gate, no
//     train-side check: a synthetic near-miss carries no `pr` and no corpus
//     position, so its (filePath, matchedSpan) locus is the disambiguator (Q2).
//
// The producer-kind contract (train-side positives, differential gate) is READ
// from `getRulePolicy('authored')` — the §9 single-home — and fail-loud-asserted,
// never hard-coded, so a policy/producer divergence surfaces here, not at slice D.

import { z } from 'zod';

import {
  type AuthoredFixture,
  type AuthoredProvenanceRecord,
  type CompiledRule,
  isAuthoredProvenance,
  provenanceKind,
} from '../compiler-schema.js';
import {
  evaluatePreimageDifferential,
  type PreimageDifferentialOutcome,
  type PreimageDifferentialResult,
} from './preimage-differential.js';
import { getRulePolicy } from './rule-policy.js';
import type { SplitArtifact } from './split.js';

/** Non-blank string field (trim-then-min — the house convention, cf. cert-corpus-seed.ts). */
const nonBlank = (msg?: string): z.ZodString => z.string().trim().min(1, msg);

// ─── Named constants (the §9 producer contract this builder asserts) ─────────

/** §6: an authored positive control is TRAIN-side (the rule is authored against the train slice). */
const EXPECTED_POSITIVE_CONTROL_SIDE = 'train';
/** §4: an authored positive control is admitted only through the preimage-differential gate. */
const EXPECTED_POSITIVE_CONTROL_GATE = 'preimage-differential';
/** The one differential outcome that EMITS a positive control (exact equality, never a negation). */
const EMITTING_OUTCOME = 'differential-holds';

// ─── Emission schemas (the .strict() boundary; types inferred) ───────────────

/**
 * The 3-way disposition of a positive fixture that did NOT emit a control
 * (strategy#777): `illegitimate` (the matcher is fix-shaped / over-matching /
 * vacuous — never a legitimate control), `undecidable` (the differential could
 * not be established — routes to operator adjudication), `deferred` (a typed
 * non-pass whose source is not yet supported, e.g. the commit-pair fallback).
 */
const AuthoredNonEmissionClassSchema = z.enum(['illegitimate', 'undecidable', 'deferred']);
export type AuthoredNonEmissionClass = z.infer<typeof AuthoredNonEmissionClassSchema>;

/**
 * The §4 differential vocabulary, mirrored as a Zod enum so `nonEmissions[].outcome`
 * validates at the `.strict()` boundary. The inverse class map below is a `Record`
 * over the NON-emitting outcomes, so a 7th primitive outcome (or a rename) fails
 * THIS build rather than silently emitting an unclassed control.
 */
const PreimageDifferentialOutcomeSchema = z.enum([
  'differential-holds',
  'fix-shaped',
  'over-match',
  'vacuous-silent',
  'needs-adjudication',
  'unsupported-source',
]);

/** A legitimate, differential-gated positive control. */
export const AuthoredPositiveControlSchema = z
  .object({
    /** The in-corpus PR the fixture anchors to (train-side; §5). */
    pr: z.number().int().positive(),
    /** The authored rule's stable id — its `lessonHash` (the C2a `firingLabelId ← ruleId` unification). */
    targetRuleId: nonBlank(),
    /** Per-fixture, line-drift-stable content hash — the two-loci-one-PR disambiguator (strategy#777 Q1(a)). */
    contentHash: nonBlank(),
  })
  .strict();
export type AuthoredPositiveControl = z.infer<typeof AuthoredPositiveControlSchema>;

/** A declared, silence-only negative control (no differential, no `pr` — strategy#777 Q2). */
export const AuthoredNegativeControlSchema = z
  .object({
    /** The authored rule's stable id (its `lessonHash`). */
    targetRuleId: nonBlank(),
    /** Near-miss locus file — half of the (filePath, matchedSpan) disambiguator. */
    filePath: nonBlank(),
    /** Line-range or AST-node path — the near-miss locus, not just the file. */
    matchedSpan: nonBlank(),
  })
  .strict();
export type AuthoredNegativeControl = z.infer<typeof AuthoredNegativeControlSchema>;

/** A positive fixture that did NOT clear the §4 gate — kept (never silently dropped) with its differential outcome + class. */
export const AuthoredNonEmissionSchema = z
  .object({
    /** The authored rule's stable id (its `lessonHash`). */
    targetRuleId: nonBlank(),
    /** The train-side PR the non-emitting fixture anchored to. */
    pr: z.number().int().positive(),
    /** The source differential outcome (exact, never derived from a negation). */
    outcome: PreimageDifferentialOutcomeSchema,
    /** The 3-way class derived from `outcome` (strategy#777 classOf). */
    class: AuthoredNonEmissionClassSchema,
    /** First-line differential reason — present for `needs-adjudication` / `unsupported-source`. */
    reason: z.string().optional(),
  })
  .strict();
export type AuthoredNonEmission = z.infer<typeof AuthoredNonEmissionSchema>;

/** The three emission lists this builder produces (the §6 controls surface, inert-until-D). */
export const AuthoredControlsSchema = z
  .object({
    positive: z.array(AuthoredPositiveControlSchema),
    negative: z.array(AuthoredNegativeControlSchema),
    nonEmissions: z.array(AuthoredNonEmissionSchema),
  })
  .strict();
export type AuthoredControls = z.infer<typeof AuthoredControlsSchema>;

/**
 * Injection port for the §4 differential evaluator (the test seam). Defaults to
 * the real `evaluatePreimageDifferential`; the co-located suite injects a stub so
 * it needs NO git/engine and can drive each of the 6 outcomes + an artificial
 * per-index delay (the determinism probe).
 *
 * NOTE — this is NOT the C1 `PreimageDifferentialDeps` git-read port
 * (`{ readFileAtCommit }`). That port threads INTO the evaluator at the deferred
 * commit-source slice; here the whole evaluator is the unit under injection, which
 * is what lets the suite control outcomes (a git-read stub cannot).
 */
export interface AuthoredControlsDeps {
  evaluate: (rule: CompiledRule, fixture: AuthoredFixture) => Promise<PreimageDifferentialResult>;
}

// ─── Classification (strategy#777 classOf; doubles as the build-time exhaustiveness guard) ─

/**
 * Maps every NON-emitting differential outcome to its emission class. A `Record`
 * over `Exclude<…, 'differential-holds'>`, so it is exhaustive by construction: a
 * new primitive outcome breaks this build (missing key) instead of slipping through
 * unclassed. `fix-shaped | over-match | vacuous-silent` are all illegitimate (the
 * matcher is not a legitimate control); `needs-adjudication` is undecidable;
 * `unsupported-source` is deferred.
 */
const NON_EMISSION_CLASS_BY_OUTCOME: Record<
  Exclude<PreimageDifferentialOutcome, typeof EMITTING_OUTCOME>,
  AuthoredNonEmissionClass
> = {
  'fix-shaped': 'illegitimate',
  'over-match': 'illegitimate',
  'vacuous-silent': 'illegitimate',
  'needs-adjudication': 'undecidable',
  'unsupported-source': 'deferred',
};

// ─── Internals ──────────────────────────────────────

/** A single positional positive-control task (rule order × declared fixture order). */
interface PositiveTask {
  rule: CompiledRule;
  targetRuleId: string;
  fixture: AuthoredFixture;
}

/**
 * Read a rule's AUTHORED provenance, fail-loud if it is missing or mined. The id
 * the controls join on is the rule's `lessonHash` — for an authored rule that IS
 * its persisted, minted `ruleId` (the C2a `firingLabelId ← ruleId` unification),
 * NOT a content hash. We gate on `isAuthoredProvenance` so a mined rule (whose
 * `lessonHash` is a content hash) can never be read as a control target.
 */
function readAuthoredProvenance(rule: CompiledRule): AuthoredProvenanceRecord {
  const provenance = rule.legitimacy?.provenance;
  if (provenance === undefined) {
    throw new Error(
      `[Totem Error] deriveAuthoredControls: rule '${rule.lessonHash}' has no legitimacy.provenance — ` +
        `deriveAuthoredControls requires compiled AUTHORED rules (ADR-112 §3)`,
    );
  }
  if (!isAuthoredProvenance(provenance)) {
    throw new Error(
      `[Totem Error] deriveAuthoredControls: rule '${rule.lessonHash}' is not authored ` +
        `(provenance.kind='${provenanceKind(provenance)}') — only authored rules carry §6 controls`,
    );
  }
  return provenance;
}

// ─── Public API ─────────────────────────────────────

/**
 * Build the §6 authored controls (positive + negative + the kept non-emissions)
 * for a set of compiled AUTHORED rules, gating positives on the §4 preimage-
 * differential. Inert: emits nothing into a cert run.
 *
 * Determinism (Tenet-15): the output arrays are byte-identical across re-runs for
 * identical inputs. Positives/non-emissions follow input order (rule order ×
 * declared `positiveFixtures` order); negatives follow rule order × declared
 * `negativeFixtures` order. The differential runs under `Promise.all`, which
 * preserves the positional task order regardless of settle timing — never a
 * push-on-settle / Set/Map iteration.
 */
export async function deriveAuthoredControls(params: {
  rules: CompiledRule[];
  split: SplitArtifact;
  deps?: AuthoredControlsDeps;
}): Promise<AuthoredControls> {
  const { rules, split } = params;
  const evaluate = params.deps?.evaluate ?? evaluatePreimageDifferential;

  // §9 single-home: READ the authored policy (do NOT hard-code "train"), then
  // fail-loud-assert the producer contract this builder is wired for. A policy
  // that diverges from train-side / differential-gated is a producer mismatch that
  // must surface HERE, never silently mis-emit at slice D.
  const policy = getRulePolicy('authored');
  if (policy.positiveControlSide !== EXPECTED_POSITIVE_CONTROL_SIDE) {
    throw new Error(
      `[Totem Error] deriveAuthoredControls: authored policy.positiveControlSide is ` +
        `'${policy.positiveControlSide}', expected '${EXPECTED_POSITIVE_CONTROL_SIDE}' (ADR-112 §6 producer mismatch)`,
    );
  }
  if (policy.positiveControlGate !== EXPECTED_POSITIVE_CONTROL_GATE) {
    throw new Error(
      `[Totem Error] deriveAuthoredControls: authored policy.positiveControlGate is ` +
        `'${policy.positiveControlGate}', expected '${EXPECTED_POSITIVE_CONTROL_GATE}' (ADR-112 §4 producer mismatch)`,
    );
  }

  const trainSet = new Set(split.trainPrs);

  // ── First pass: collect positional positive tasks + the declarative negatives.
  const positiveTasks: PositiveTask[] = [];
  const negative: AuthoredNegativeControl[] = [];
  // The §6 controls are an ANSWER KEY — each emitted control must be a unique join
  // target for slice D. Two fixtures emitting the same key would resolve ambiguously
  // (the minimal #777 shape drops the locus/source that would tell them apart), so a
  // duplicate is a fail-loud contract fault, never a silent double-entry.
  const negativeKeys = new Set<string>();

  for (const rule of rules) {
    const provenance = readAuthoredProvenance(rule);
    const targetRuleId = rule.lessonHash;

    // POSITIVE: build a positional task per declared fixture (input order). A
    // held-out fixture.pr is a §5 leakage violation — fail loud, NEVER a silent
    // skip (a silent skip would let a leaked exemplar weaken the train/test bar).
    for (const fixture of provenance.positiveFixtures) {
      if (!trainSet.has(fixture.pr)) {
        throw new Error(
          `[Totem Error] deriveAuthoredControls: positive fixture pr #${fixture.pr} (rule '${targetRuleId}') ` +
            `is not in the train slice — a held-out positive fixture is an ADR-112 §5 leakage violation`,
        );
      }
      positiveTasks.push({ rule, targetRuleId, fixture });
    }

    // NEGATIVE: DECLARATIVE (strategy#777 Q2) — no differential, no silence gate,
    // no trainSet check. A synthetic near-miss carries no `pr` and no corpus
    // position; the (filePath, matchedSpan) locus is the disambiguator. We do NOT
    // inline `nearMissSource` — it is resolved at D (Tenet-20 join-back).
    for (const nf of provenance.negativeFixtures ?? []) {
      const negativeKey = `${targetRuleId}\0${nf.filePath}\0${nf.matchedSpan}`;
      if (negativeKeys.has(negativeKey)) {
        throw new Error(
          `[Totem Error] deriveAuthoredControls: duplicate negative control (rule '${targetRuleId}', ` +
            `filePath '${nf.filePath}', matchedSpan '${nf.matchedSpan}') — two near-misses emit an ` +
            `indistinguishable §6 silence-control key; differentiate the loci or drop one`,
        );
      }
      negativeKeys.add(negativeKey);
      negative.push({ targetRuleId, filePath: nf.filePath, matchedSpan: nf.matchedSpan });
    }
  }

  // ── Evaluate the §4 differential for every positive task. `Promise.all` resolves
  // in the original task order regardless of which evaluation settles first, so the
  // emitted order is the stable declared order (a push-on-settle impl would not be).
  const evaluated = await Promise.all(
    positiveTasks.map(async (task) => ({ task, result: await evaluate(task.rule, task.fixture) })),
  );

  // ── Second pass: split into emitted positives vs kept non-emissions.
  const positive: AuthoredPositiveControl[] = [];
  const positiveKeys = new Set<string>();
  const nonEmissions: AuthoredNonEmission[] = [];
  for (const { task, result } of evaluated) {
    if (result.outcome === EMITTING_OUTCOME) {
      // contentHash is the per-fixture disambiguator (strategy#777 Q1(a)) — it is
      // ITS OWN fixture's hash, so two loci sharing one PR never cross-certify. The
      // residual edge (two fixtures sharing pr AND contentHash — byte-identical span
      // content) would still collide, so the emitted key must be unique: fail loud.
      const positiveKey = `${task.targetRuleId}\0${task.fixture.pr}\0${task.fixture.contentHash}`;
      if (positiveKeys.has(positiveKey)) {
        throw new Error(
          `[Totem Error] deriveAuthoredControls: duplicate positive control (rule '${task.targetRuleId}', ` +
            `pr #${task.fixture.pr}, contentHash '${task.fixture.contentHash}') — two fixtures emit an ` +
            `indistinguishable §6 answer-key entry; differentiate the fixtures or drop one`,
        );
      }
      positiveKeys.add(positiveKey);
      positive.push({
        pr: task.fixture.pr,
        targetRuleId: task.targetRuleId,
        contentHash: task.fixture.contentHash,
      });
    } else {
      nonEmissions.push({
        targetRuleId: task.targetRuleId,
        pr: task.fixture.pr,
        outcome: result.outcome,
        class: NON_EMISSION_CLASS_BY_OUTCOME[result.outcome],
        // Omit `reason` when absent (house convention, cf. buildWindtunnelLock) —
        // keeps the emitted JSON clean + byte-identical across re-runs.
        ...(result.reason !== undefined ? { reason: result.reason } : {}),
      });
    }
  }

  return { positive, negative, nonEmissions };
}
