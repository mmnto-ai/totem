// ─── ADR-112 §6/§9 Slice D1 — the AUTHORED certifying-corpus assembler ───────
//
// The SIBLING of the mined `buildCertifyingCorpus` (spine-cert-corpus.ts), NOT a
// branch inside it: the mined assembler's extract→classify deps (source / extractor
// / classifier) are irrelevant to an authored run, so a shared function would do two
// disjoint jobs (Tenet-9 anti-shape). This assembler runs the AUTHORED producer
// (`runRuleAuthor` → `toCompileFeed` → `runCompileStage`) over the SAME one G-series
// compiler, then assembles a `CertifyingCorpus` whose `authoredControls` channel is
// derived from the §6 emission builder. The mined path stays BYTE-UNCHANGED.
//
// D1 is INERT: nothing in scoring/persist/report consumes `authoredControls` yet
// (D3/D4 do). The leakage / rejected / compile / mixed-provenance / duplicate throws
// are assembly CONTRACT guards (fail-loud, Tenet-4) — NOT behind a feature flag.

import type {
  AuthoredControlsDeps,
  CompiledRule,
  GroundTruthLabel,
  ProvenanceRecord,
  ResolvedPrDiff,
  SplitArtifact,
  Stage4VerifierDeps,
} from '@mmnto/totem';

import type { FreezeBinding } from '../spine-freeze-proof.js';
import type { CertifyingCorpus } from './spine-windtunnel.js';

export interface BuildAuthoredCertifyingCorpusDeps {
  /** `.totem` dir holding `spine/authored-rules.yaml` + the authoring-ledger. */
  totemDir: string;
  // NOTE: there is NO `judgedBy` here — the §3 eligibility-check id is the §8 single source
  // recorded in the authoring-ledger (per-rule), and is DERIVED from it at run time, not
  // supplied. A run-level judgedBy (e.g. on the lock) would be a second source for a fact
  // §8 already owns = the Tenet-20 mirror (strategy couple-on-D ruling 2026-06-30 (iii), #787).
  /**
   * The splitRef THIS cert run is bound to (ADR-110 §6). Every authored record's
   * authoring split (file header → authoring-ledger entry) MUST equal this, or the
   * rules were authored under a DIFFERENT split — the run is voided BEFORE compile
   * (codex finding 4: `deriveAuthoredControls`'s train-side fixture check ALONE is
   * insufficient for leakage; the file/ledger split-binding is the load-bearing guard).
   */
  expectedSplitRef: string;
  /** The frozen split (the §5 leakage gate + `deriveAuthoredControls` train-side check). */
  split: SplitArtifact;
  /** Resolved-PR diffs — the producer-independent scoring substrate (passed through). */
  prDiffs: ResolvedPrDiff[];
  /** Frozen ground-truth labels keyed by firingLabelId (passed through). */
  groundTruth: Map<string, GroundTruthLabel>;
  /** Stage-4 verifier deps (listFiles/readFile) for the compile stage. */
  stage4: Stage4VerifierDeps;
  /** Injected timestamp (Tenet 15 determinism — no `new Date()` in the pipeline). */
  now: string;
  /** Optional §4 differential-evaluator injection for `deriveAuthoredControls` (defaults to the real one). */
  authoredControlsDeps?: AuthoredControlsDeps;
  /**
   * R1: the PROVEN freeze binding for a content-addressed `expectedSplitRef`
   * (constructed ONLY by `resolveProvenFreezeBinding` at the cert-run boundary —
   * this builder is git-free and never proves). Absent on a legacy free-text run;
   * absent on a content-addressed run ⇒ the intake's total partition fails loud.
   */
  freezeBinding?: FreezeBinding;
}

/**
 * Assemble an AUTHORED `CertifyingCorpus` from `.totem/spine/authored-rules.yaml`.
 *
 * Pipeline: `runRuleAuthor` (preserving ALL §3/§8 producer invariants — strict
 * authored-file shape, recursive producer-owned-key rejection, independent
 * structural-eligibility, stable id mint/reuse, fail-loud dup-identity, ledger
 * append/read-back, `judgedBy`≠author) → `rejected.length === 0` precondition →
 * file/ledger split-binding verification (BEFORE compile) → `toCompileFeed` →
 * `runCompileStage` (authored compile-rejection = HARD failure) → homogeneous
 * authored-provenance assembly from the `c.provenance` SIDECAR (never
 * `rule.legitimacy`) → `deriveAuthoredControls`.
 *
 * Pure of its own IO except the producer's authoring-ledger read/append (behind
 * `runRuleAuthor`) — `stage4`/diffs/ground-truth are injected, so it is fully
 * testable with a real temp `.totem` dir + fakes (no LLM, no network, no real git).
 */
export async function buildAuthoredCertifyingCorpus(
  deps: BuildAuthoredCertifyingCorpusDeps,
): Promise<CertifyingCorpus> {
  const {
    toCompileFeed,
    runCompileStage,
    deriveAuthoredControls,
    isAuthoredProvenance,
    provenanceKind,
    readAuthoringLedger,
    sanitizeForTerminal,
    TotemError,
  } = await import('@mmnto/totem');
  const { runRuleAuthor } = await import('../authored-rule-intake.js');

  // Escape every authored/ledger-derived value before it lands in CLI-facing TotemError
  // text: authored fields (author / targetDefect / reason / splitRef) are free-text from
  // the authored YAML and could carry ANSI/control bytes (terminal injection — CR outside-
  // diff). Applied uniformly via `safe` so all error strings are consistently escaped (a
  // no-op on the minted-hex ids, but it keeps the "all CLI error text sanitized" invariant).
  const safe = sanitizeForTerminal;

  // 0. Derive the §8 single-source `judgedBy` from the authoring-ledger (NOT the lock —
  //    strategy couple-on-D ruling 2026-06-30 (iii): a run-level judgedBy on the lock is a
  //    second source for a fact §8 already owns per-rule = the Tenet-20 mirror, #787). The
  //    ledger MUST pre-exist — authoring (`totem rule author`) records each rule's §3 judgedBy
  //    before a cert run reads it; a cert run is NOT the first author. For cert 1 the §3 check
  //    is one static whitelist, so judgedBy is uniform across the set; a mixed-check ledger is
  //    ambiguous ("which is THE run's check?") → fail loud (single-check cert; multi-check is
  //    an ADR-112 Deferred Decision). This is the source the step-1 re-run + the step-3 per-
  //    record assert-equal both bind to (never a freshly-substituted value — strategy's drift guard).
  const priorLedger = readAuthoringLedger(deps.totemDir);
  if (priorLedger.length === 0) {
    throw new TotemError(
      'GATE_INVALID',
      'Authored cert corpus: the authoring-ledger is empty — there are no authored rules to certify.',
      'Run `totem rule author` to author + record rules (with their §3 judgedBy) before the cert run.',
    );
  }
  const priorEffective = new Map<string, (typeof priorLedger)[number]>();
  for (const entry of priorLedger) priorEffective.set(entry.ruleId, entry);
  const judgedBys = new Set(
    [...priorEffective.values()].map((e) => e.structuralEligibility.judgedBy),
  );
  if (judgedBys.size !== 1) {
    throw new TotemError(
      'GATE_INVALID',
      `Authored cert corpus: the authoring-ledger records ${judgedBys.size} distinct judgedBy values ` +
        `(${safe([...judgedBys].join(', '))}) — a single cert run binds ONE §3 eligibility check.`,
      'Certify a single-check authored set (multi-check corpora are out of scope for cert 1, ADR-112 Deferred Decisions).',
    );
  }
  const judgedBy = [...judgedBys][0]!;

  // 1. Re-derive the authored records under the LEDGER-SOURCED judgedBy in verifyOnly mode
  //    (ADR-112 §8 no-mint precondition — strategy ruling 2026-06-30, Q4 cert-path-only). The
  //    re-derive is read-only against the authoring-ledger: it asserts every current rule already
  //    has an `unchanged` recorded entry and fails loud (zero writes) if any would be minted/revised
  //    — a cert run is NOT the first author. This is the gate the empty-ledger step-0 above does not
  //    cover (non-empty-but-stale): step-0 empty → no-mint stale → step-3 verdict/binding (Q3 layered).
  //    The producer establishes eligibility/identity; NEVER construct AuthoredRuleRecord[] ad hoc or
  //    read YAML→record here.
  //    R1: a content-addressed expectedSplitRef binds the run to a FROZEN artifact — the caller
  //    resolves + PROVES the binding at the cert-run boundary (`resolveProvenFreezeBinding`) and
  //    threads it here, or the intake's own content-ref gate voids the verifyOnly re-derive
  //    (CR #2293 round 1: the cert re-derive ran bindingless). This builder stays git-free:
  //    it CONSUMES a proven binding, never constructs one (the never-unverified-binding
  //    invariant — proof lives with the boundary that has git).
  const authorResult = runRuleAuthor(deps.totemDir, {
    judgedBy,
    verifyOnly: true,
    ...(deps.freezeBinding !== undefined ? { freezeBinding: deps.freezeBinding } : {}),
  });

  // 2. rejected.length === 0 precondition: a partially-invalid authored file is broken
  //    cert input — never certify the eligible subset (fail loud, not a partial corpus).
  if (authorResult.rejected.length > 0) {
    const summary = authorResult.rejected
      .map((r) => `(${safe(r.author)} · ${safe(r.targetDefect)}: ${safe(r.reason)})`)
      .join('; ');
    throw new TotemError(
      'GATE_INVALID',
      `Authored cert corpus: ${authorResult.rejected.length} authored rule(s) were rejected by the ` +
        `structural-eligibility check — ${summary}`,
      'Fix or remove the rejected rules; a certifying run must not certify the eligible subset of a ' +
        'partially-invalid authored file (ADR-112 §3).',
    );
  }
  const records = authorResult.records;
  if (records.length === 0) {
    throw new TotemError(
      'GATE_INVALID',
      'Authored cert corpus: runRuleAuthor produced zero eligible authored records.',
      'Declare ≥1 structurally-decidable authored rule in .totem/spine/authored-rules.yaml (ADR-112 §3).',
    );
  }

  // 3. Verify the file/ledger SPLIT-BINDING before compile: every materialized record
  //    MUST have been authored under THIS cert run's split. This is the §5 leakage guard
  //    `deriveAuthoredControls`'s train-side fixture check alone cannot cover (codex
  //    finding-4) — `splitRef` is the run-binding the FILE does not self-enforce.
  //    The §5 embargo attestations themselves (`authoredAfterSplit`,
  //    `heldOutNonInspectionAttestation`) are NOT re-checked here: `AuthoredRulesFileSchema`
  //    types them as `z.literal(true)`, so `runRuleAuthor` rejects any file lacking them
  //    BEFORE this point — a runtime re-check would be an unreachable branch (CR; bot-
  //    finding reachability). The ledger entry only exists because the file already passed.
  const ledger = readAuthoringLedger(deps.totemDir);
  const effectiveByRuleId = new Map<string, (typeof ledger)[number]>();
  for (const entry of ledger) effectiveByRuleId.set(entry.ruleId, entry);
  for (const record of records) {
    const entry = effectiveByRuleId.get(record.ruleId);
    if (entry === undefined) {
      throw new TotemError(
        'GATE_INVALID',
        `Authored cert corpus: no authoring-ledger entry for rule '${safe(record.ruleId)}' — the §8 ` +
          'attestation chain is missing its split-binding.',
        'Re-author the rule so the ledger records its splitRef + attestations (ADR-112 §8).',
      );
    }
    if (entry.splitRef !== deps.expectedSplitRef) {
      throw new TotemError(
        'GATE_INVALID',
        `Authored cert corpus: rule '${safe(record.ruleId)}' was authored under split '${safe(entry.splitRef)}', but ` +
          `this cert run is bound to split '${safe(deps.expectedSplitRef)}' — the rules were authored under a ` +
          'different split (ADR-112 §5 leakage guard).',
        'Re-author against the current frozen split, or run the cert against the split the rules were authored under.',
      );
    }
    // judgedBy assert-equal (strategy ruling 2026-06-30 (iii)): `judgedBy` was DERIVED from the
    // ledger's §8 record (step 0), and the step-1 re-run carried it — so this asserts the
    // post-re-run effective row STILL carries that single §8 value, never a silently-substituted
    // one. It backstops the §8 single-source invariant: a divergent verdict reaching the cert
    // corpus (e.g. a re-run that appended a row under a different check) fails loud, Tenet 4.
    if (entry.structuralEligibility.judgedBy !== judgedBy) {
      throw new TotemError(
        'GATE_INVALID',
        `Authored cert corpus: rule '${safe(record.ruleId)}' carries judgedBy ` +
          `'${safe(entry.structuralEligibility.judgedBy)}', but this cert run binds the ledger-sourced ` +
          `judgedBy '${safe(judgedBy)}' — the §8 eligibility verdict diverged (ADR-112 §3/§8).`,
        'Re-author the set under one §3 eligibility check; a cert run binds a single judgedBy.',
      );
    }
  }

  // 4. Compile via the ONE G-series compiler (authored producer). toCompileFeed builds
  //    the exact CompileStageInput shape; runCompileStage runs Stage-3/4.
  const feed = toCompileFeed(records);
  const compileResult = await runCompileStage(
    { candidates: feed.candidates, classifierLedger: feed.classifierLedger },
    { stage4: deps.stage4, now: deps.now },
  );

  // Authored compile-rejection = HARD failure: an authored record reaching compile and
  // being rejected (e.g. per-engine ReDoS validation) is BROKEN cert input, not mined
  // noise — fail before emitting an incomplete controls set.
  const rejectedRefs = compileResult.classifierLedger.entries
    .filter((e) => e.stage4Outcome === 'compile-rejected')
    .map((e) => e.candidateRef);
  if (rejectedRefs.length > 0) {
    throw new TotemError(
      'GATE_INVALID',
      `Authored cert corpus: ${rejectedRefs.length} authored candidate(s) were rejected at compile ` +
        `(${safe(rejectedRefs.join(', '))}) — an authored record must compile cleanly (ADR-112 §2).`,
      "Fix the authored rule's dslSource so it compiles under its declared engine.",
    );
  }

  // Exclude Stage-4 out-of-scope (archived) rules from the scored set — archived ≠
  // wind-tunnel FP (fold-F throws if one reaches firing); their provenance drops with
  // them. Mirrors the mined assembler's binding-2 (a distinct axis from compile-rejection).
  const scored = compileResult.compiled.filter((c) => c.rule.status !== 'archived');
  if (scored.length === 0) {
    throw new TotemError(
      'GATE_INVALID',
      'Authored cert corpus: every authored rule was Stage-4 out-of-scope (archived) — no scorable ' +
        'authored rule remains.',
      'Tighten the authored matchers so they do not fire on the verification baseline (ADR-112 §4 / Stage-4).',
    );
  }

  // 5. Assemble rules + provenanceByRule from the c.provenance SIDECAR (NOT
  //    rule.legitimacy — stamped only post-scoring). Enforce HOMOGENEOUS authored
  //    provenance (single-provenance §7) + a unique join identity per rule.
  const rules: CompiledRule[] = [];
  const provenanceByRule = new Map<string, ProvenanceRecord>();
  for (const c of scored) {
    // `isAuthoredProvenance` is the single runtime+type-narrowing check (greptile: the
    // earlier `provenanceKind(...) !== 'authored'` leg was redundant — both derive from
    // `p.kind === 'authored'`). Compute the kind only for the fail-loud message.
    if (!isAuthoredProvenance(c.provenance)) {
      throw new TotemError(
        'GATE_INVALID',
        `Authored cert corpus: rule '${safe(c.rule.lessonHash)}' carries '${provenanceKind(c.provenance)}' ` +
          'provenance — an authored corpus must be wholly authored (ADR-112 §7 single-provenance).',
        'Do not mix mined and authored rules in one cert run; author them as separate runs.',
      );
    }
    if (provenanceByRule.has(c.rule.lessonHash)) {
      throw new TotemError(
        'GATE_INVALID',
        `Authored cert corpus: duplicate rule identity '${safe(c.rule.lessonHash)}' across scored authored ` +
          'rules — the §6 control join key would resolve ambiguously.',
        'Each authored rule needs a unique minted ruleId (ADR-112 §8); de-duplicate the authored set.',
      );
    }
    rules.push(c.rule);
    provenanceByRule.set(c.rule.lessonHash, c.provenance);
  }

  // 6. Derive the §6 authored controls from the SIDECAR provenance (the D1 fold-#1
  //    reshape). Defined-with-empty-arrays if no fixtures — never undefined-for-authored.
  const authoredControls = await deriveAuthoredControls({
    rules,
    split: deps.split,
    provenanceByRule,
    ...(deps.authoredControlsDeps ? { deps: deps.authoredControlsDeps } : {}),
  });

  return {
    rules,
    prDiffs: deps.prDiffs,
    groundTruth: deps.groundTruth,
    provenanceByRule,
    authoredControls,
  };
}
