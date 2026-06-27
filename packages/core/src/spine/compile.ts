// ─── ADR-111 Gate-1 miner slice 4: Stage-3 Compile + Stage-4 Verify ──────────
//
// The fresh, non-frozen G-series compile actuator. For each compile-routed
// (structural) `CandidateRuleRecord` it parses the lesson-markdown `dslSource`
// into a `CompiledRule`, runs the shipped Stage-4 codebase verifier, maps the
// outcome onto the rule's status/confidence/severity, and records the outcome on
// the classifier ledger (flips `stage4Confirmed` + sets `stage4Outcome`).
//
// FREEZE BOUNDARY (flag-3, BINDING): the frozen thing is the legacy `LessonInput`
// ACTUATOR (`compileLesson`/`buildCompiledRule`/`buildManualRule`, the
// `totem lesson compile` path), NOT the lesson-markdown format, its parser, or the
// pure validators. This module REUSES `extractManualPattern`/`engineFields`/
// `hashLesson`/`validateRegex`/`validateAstGrepPattern`/`verifyAgainstCodebase`
// (data-format + pure-validator + verifier reuse — Tenet 21) and NEVER imports or
// calls the frozen actuator. The compiled rule is minted `unverified: true` with
// `legitimacy`/`ruleClass` ABSENT (the wind-tunnel stamps them in slice 5) and is
// never persisted to a loadable manifest here (slice-5 stamp-before-persist).

// `validateAstGrepPattern` is a PURE validator (no IO/state) that happens to be
// defined in `compile-lesson.ts`. Importing it is validator reuse — OUTSIDE the
// freeze boundary, which is the `LessonInput` actuator path, not the validators
// (strategy-claude 2226Z, structural: the validator is already a shared leaf). We
// deliberately import ONLY this validator and NEVER the frozen actuator functions.
import { validateAstGrepPattern } from '../compile-lesson.js';
import { engineFields, hashLesson, sanitizeFileGlobs, validateRegex } from '../compiler.js';
import {
  type CompiledRule,
  CompiledRuleSchema,
  type ProvenanceRecord,
} from '../compiler-schema.js';
import { extractManualPattern, type ManualPattern } from '../lesson-pattern.js';
import {
  getDefaultBaseline,
  type Stage4Baseline,
  type Stage4Outcome,
  type Stage4VerificationResult,
  type Stage4VerifierDeps,
  verifyAgainstCodebase,
} from '../stage4-verifier.js';
import type { CompileInputCandidate } from './candidate-rule.js';
import type { ClassifierLedger, Stage4LedgerOutcome } from './ledgers.js';

/**
 * The slice-4 output: a compiled, Stage-4-verified candidate. Carries `provenance`
 * UN-PROJECTED (slice 5 projects it into `legitimacy.provenance` when it stamps the
 * wind-tunnel verdict) and the full `stage4` payload (so the `no-matches` vs
 * `out-of-scope` distinction survives downstream — codex). The `rule` is
 * `unverified: true`, `legitimacy`/`ruleClass`-free, never `manual`.
 */
export interface CompiledCandidate {
  provenance: ProvenanceRecord;
  classifierLedgerRef: string;
  rule: CompiledRule;
  stage4: Stage4VerificationResult;
}

/**
 * ADR-112 §2 — the minimal input `runCompileStage` consumes: the candidates + the
 * classifier ledger. A miner `ClassifyStageResult` satisfies it structurally (its
 * extra `emissionLedger` is never read here); the authored producer's
 * `toCompileFeed` builds it WITHOUT a mining emission ledger (an authored rule has
 * no review-thread emission to attest, and the classifier ledger carries
 * `dispositionSource: 'authored-whitelist'`, not a fabricated `'classified'`). One
 * compiler, two producers — neither masquerading as the other.
 */
export interface CompileStageInput {
  candidates: readonly CompileInputCandidate[];
  classifierLedger: ClassifierLedger;
}

/** Pure compile outcome (no IO): a compiled rule, or a loud per-engine validation rejection. */
export type CompileOutcome =
  | { kind: 'compiled'; rule: CompiledRule }
  | { kind: 'rejected'; reason: string };

export interface CompileStageDeps {
  stage4: Stage4VerifierDeps;
  /** Injected timestamp — no `new Date()` in core (Tenet 15 determinism, OQ1). */
  now: string;
  /** Stage-4 baseline; defaults to `getDefaultBaseline()` (test/fixture globs). */
  baseline?: Stage4Baseline;
}

export interface CompileStageResult {
  compiled: CompiledCandidate[];
  /** The classifier ledger with `stage4Confirmed` + `stage4Outcome` filled on every compile-routed entry. */
  classifierLedger: ClassifierLedger;
}

/** Stable, deterministic lesson heading for a candidate (unique via its `clr-…` ledger ref). */
function candidateHeading(candidate: CompileInputCandidate): string {
  return `Gate-1 rule candidate (${candidate.classifierLedgerRef})`;
}

/**
 * Compile a single compile-routed candidate's `dslSource` into a `CompiledRule`.
 * PURE (no IO). Throws — fail loud, never a silent skip — on a behavioral candidate
 * (FM(c) code backstop) or a structural candidate whose `dslSource` yields no usable
 * pattern (a producer-contract violation: slice-2's `isUsableDsl` preflight should
 * have prevented emission, so this surfaces a preflight↔parser desync). Returns a
 * `rejected` outcome (NOT a throw) when the pattern parses but fails per-engine
 * safety validation (e.g. ReDoS) — a counted, reported `compile-rejected` state.
 */
export function compileCandidate(
  candidate: CompileInputCandidate,
  opts: { now: string },
): CompileOutcome {
  if (candidate.classifierDisposition === 'behavioral') {
    throw new Error(
      `[Totem Error] compileCandidate: behavioral candidate '${candidate.classifierLedgerRef}' must never be compiled (FM(c))`,
    );
  }
  // May throw TotemParseError (e.g. a yaml fence under a non-ast-grep engine) — that
  // propagates loudly as a producer bug; it would also have been dropped at extract.
  const mp: ManualPattern | null = extractManualPattern(candidate.dslSource);
  if (mp === null) {
    throw new Error(
      `[Totem Error] compileCandidate: structural candidate '${candidate.classifierLedgerRef}' has no usable pattern — slice-2 preflight (isUsableDsl) should have dropped it (preflight↔parser desync)`,
    );
  }

  const fileGlobs = sanitizeFileGlobs(mp.fileGlobs ?? []);

  // Per-engine safety validation, fail loud → `compile-rejected` (strategy sharpening:
  // call the validator and reject on `{valid:false}`, never a silent/skipped compile).
  if (mp.engine === 'regex') {
    const v = validateRegex(mp.pattern);
    if (!v.valid) return { kind: 'rejected', reason: v.reason ?? 'invalid regex pattern' };
  } else if (mp.engine === 'ast-grep') {
    const v = validateAstGrepPattern(mp.astGrepYamlRule ?? mp.pattern, fileGlobs);
    if (!v.valid) return { kind: 'rejected', reason: v.reason ?? 'invalid ast-grep rule' };
  }
  // engine 'ast' (tree-sitter S-expression): no ReDoS-class validator applies — the
  // query was already structurally parsed by `extractManualPattern`.

  const heading = candidateHeading(candidate);
  const ef = engineFields(mp.engine, mp.astGrepYamlRule ?? mp.pattern);
  const rule = CompiledRuleSchema.parse({
    lessonHash: hashLesson(heading, candidate.dslSource),
    lessonHeading: heading,
    message: mp.message ?? heading,
    engine: mp.engine,
    ...ef,
    ...(fileGlobs.length > 0 ? { fileGlobs } : {}),
    severity: mp.severity,
    ...(mp.badExample !== undefined ? { badExample: mp.badExample } : {}),
    compiledAt: opts.now,
    createdAt: opts.now,
    // Yellow/sensor-only: legitimacy + ruleClass ABSENT (slice-5 wind-tunnel stamps
    // them); never `manual` (the markdown is the DSL carrier, NOT a Pipeline-1 trust
    // claim — codex). `deriveRuleClass` forces 'advisory' on `unverified:true`.
    unverified: true,
  });
  // §3 engine-binding (#2259/#7): an AUTHORED candidate carries the engine its
  // structural-eligibility whitelist was judged for. The compiler derives the engine
  // INDEPENDENTLY from `dslSource`, so a regex-whitelisted rule whose source parses as
  // ast-grep would otherwise compile + emit as `authored-whitelist` under an engine the
  // whitelist never cleared. Fail loud — the eligibility verdict was engine-specific.
  // MINED candidates carry no `declaredEngine` and skip the bind (engine is source-derived).
  if (candidate.declaredEngine !== undefined && rule.engine !== candidate.declaredEngine) {
    throw new Error(
      `[Totem Error] compileCandidate: candidate '${candidate.classifierLedgerRef}' declared engine '${candidate.declaredEngine}' but its dslSource compiled as '${rule.engine}' — the structural-eligibility whitelist was judged for a different engine (ADR-112 §3)`,
    );
  }
  return { kind: 'compiled', rule };
}

interface Stage4Mapping {
  rulePatch: Partial<CompiledRule>;
  stage4Confirmed: boolean;
  stage4Outcome: Stage4LedgerOutcome;
}

/**
 * Map a Stage-4 verifier outcome onto the rule's status/confidence/severity + the
 * classifier-ledger fields (mirrors the frozen `applyStage4` semantics, but injects
 * `now` instead of `new Date()` and sets `status` EXPLICITLY rather than relying on
 * "missing status ⇒ active"). `stage4Confirmed` = "Stage-4 produced positive in-scope
 * evidence sufficient for an active rule" → only the two active outcomes are confirmed.
 */
function mapStage4Outcome(outcome: Stage4Outcome, now: string): Stage4Mapping {
  switch (outcome) {
    case 'in-scope-bad-example':
      return {
        rulePatch: { status: 'active', confidence: 'high' },
        stage4Confirmed: true,
        stage4Outcome: 'confirmed',
      };
    case 'candidate-debt':
      // Real code differs from the authored badExample — force severity to the warning
      // floor (never elevate), keep active (mirrors applyStage4).
      return {
        rulePatch: { status: 'active', severity: 'warning' },
        stage4Confirmed: true,
        stage4Outcome: 'confirmed',
      };
    case 'no-matches':
      return {
        rulePatch: { status: 'untested-against-codebase' },
        stage4Confirmed: false,
        stage4Outcome: 'untested-no-matches',
      };
    case 'out-of-scope':
      // The §4 deterministic backstop ACTIVELY rejected a mis-structural candidate
      // (fired on the verification baseline ⇒ over-broad). Archival is the SAFE
      // direction (demote, never promote) and is the producer's call (slice 4), a
      // distinct axis from the wind-tunnel's legitimacy gate (slice 5).
      return {
        rulePatch: {
          status: 'archived',
          archivedAt: now,
          archivedReason:
            'Stage 4 (mmnto-ai/totem#1682): pattern fired on the verification baseline (test/fixture scope) — over-broad. reasonCode: stage4-out-of-scope-match.',
        },
        stage4Confirmed: false,
        stage4Outcome: 'archived-out-of-scope',
      };
    default: {
      const _exhaustive: never = outcome;
      throw new Error(
        `[Totem Error] mapStage4Outcome: unknown Stage-4 outcome '${String(_exhaustive)}'`,
      );
    }
  }
}

/**
 * Run the Stage-3 Compile + Stage-4 Verify stage over a classify result. Selects
 * ONLY compile-routed (structural) candidates and compiles them SEQUENTIALLY in
 * stable classify-output order (deterministic ordinals before any async reorder).
 * Returns the `CompiledCandidate[]` + the classifier ledger with `stage4Confirmed`
 * and `stage4Outcome` filled on every compile-routed entry (behavioral/rag-only
 * entries are left untouched). Mutates nothing: returns a new ledger object with a
 * new entries array — updated entries are spread copies, unmodified entries share
 * the original reference (a structural copy, not a deep copy).
 */
export async function runCompileStage(
  classify: CompileStageInput,
  deps: CompileStageDeps,
): Promise<CompileStageResult> {
  const baseline = deps.baseline ?? getDefaultBaseline();
  // Determinism (codex fold) + perf (GCA): resolve the file list ONCE, sorted, and
  // reuse that snapshot for every candidate. `verifyAgainstCodebase` calls
  // `listFiles()` on each invocation, so an un-memoized wrapper would re-walk the
  // repo once per structural candidate (N walks); the frozen snapshot also keeps the
  // file order identical across candidates. Lazy — a zero-candidate run never walks.
  let fileSnapshot: readonly string[] | undefined;
  const stage4: Stage4VerifierDeps = {
    ...deps.stage4,
    listFiles: async () => (fileSnapshot ??= [...(await deps.stage4.listFiles())].sort()),
  };
  const compiled: CompiledCandidate[] = [];
  const updates = new Map<
    string,
    { stage4Confirmed: boolean; stage4Outcome: Stage4LedgerOutcome }
  >();

  const structural = classify.candidates.filter((c) => c.classifierDisposition === 'structural');
  // Duplicate-candidate-ref guard (#2259, greptile-P1 outside-diff): the per-candidate
  // ledger join below requires EXACTLY ONE ledger entry, but two CANDIDATES sharing one
  // `classifierLedgerRef` would BOTH pass that check against a single entry — then the
  // later Stage-4 update silently overwrites the earlier in `updates`, leaving one compiled
  // rule bound to the wrong outcome. The widened input accepts either producer, so uniqueness
  // is no longer guaranteed by a single front-end; assert it here, fail loud before any
  // compile work (symmetric with `toCompileFeed`'s authored-side dedup).
  const seenRefs = new Set<string>();
  for (const candidate of structural) {
    if (seenRefs.has(candidate.classifierLedgerRef)) {
      throw new Error(
        `[Totem Error] runCompileStage: duplicate classifierLedgerRef '${candidate.classifierLedgerRef}' across structural candidates — each compile candidate needs a unique ledger ref for the 1:1 Stage-4 join`,
      );
    }
    seenRefs.add(candidate.classifierLedgerRef);
  }
  for (const candidate of structural) {
    // Classifier-ledger join: require EXACTLY ONE entry (missing or duplicate fails
    // loud — else the Stage-4 confirmation is lost or applied to the wrong row).
    const matches = classify.classifierLedger.entries.filter(
      (e) => e.candidateRef === candidate.classifierLedgerRef,
    );
    if (matches.length !== 1) {
      throw new Error(
        `[Totem Error] runCompileStage: classifierLedgerRef '${candidate.classifierLedgerRef}' matches ${matches.length} classifier-ledger entries (expected exactly 1)`,
      );
    }

    const outcome = compileCandidate(candidate, { now: deps.now });
    if (outcome.kind === 'rejected') {
      updates.set(candidate.classifierLedgerRef, {
        stage4Confirmed: false,
        stage4Outcome: 'compile-rejected',
      });
      continue;
    }

    // ast / ast-grep rules need a working directory — fail loud, never degrade to
    // `no-matches` (agy fold). Regex verification does not need it.
    if (outcome.rule.engine !== 'regex' && deps.stage4.workingDirectory === undefined) {
      throw new Error(
        `[Totem Error] runCompileStage: ${outcome.rule.engine} rule for '${candidate.classifierLedgerRef}' requires deps.stage4.workingDirectory`,
      );
    }

    // A `readFile` failure inside the verifier propagates loudly (fail-loud Tenet 4) —
    // no swallowing catch here.
    const stage4Result = await verifyAgainstCodebase(outcome.rule, baseline, stage4);
    const mapping = mapStage4Outcome(stage4Result.outcome, deps.now);
    const rule = CompiledRuleSchema.parse({ ...outcome.rule, ...mapping.rulePatch });
    compiled.push({
      provenance: candidate.provenance,
      classifierLedgerRef: candidate.classifierLedgerRef,
      rule,
      stage4: stage4Result,
    });
    updates.set(candidate.classifierLedgerRef, {
      stage4Confirmed: mapping.stage4Confirmed,
      stage4Outcome: mapping.stage4Outcome,
    });
  }

  const classifierLedger: ClassifierLedger = {
    entries: classify.classifierLedger.entries.map((e) => {
      const u = updates.get(e.candidateRef);
      return u ? { ...e, stage4Confirmed: u.stage4Confirmed, stage4Outcome: u.stage4Outcome } : e;
    }),
  };

  return { compiled, classifierLedger };
}
