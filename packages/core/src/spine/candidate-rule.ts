// ─── ADR-111 Gate-1 producer: the CandidateRuleRecord envelope ──────────────
//
// The miner's SOLE output type (ADR-111 §3) — a NEW envelope, distinct from a
// persisted CompiledRule. It carries the provenance tuple (reusing the shipped
// ProvenanceRecordSchema, #2183, verbatim — single source of truth), the
// Stage-2 classifier disposition + its ledger reference, the generated DSL
// source, and the zero-trust mint flag. It does NOT populate `legitimacy` /
// `ruleClass`: those are stamped DOWNSTREAM by the wind-tunnel once the
// positive/negative controls run (ADR-110 §2-3). How a candidate later projects
// into a CompiledRule is an ADR-103 concern, not this envelope's. Minted
// `unverified`/Yellow with zero enforcement blast radius by construction
// (ADR-089): `unverified: true` forces `deriveRuleClass` to 'advisory' on any
// later projection, so a candidate can never mint as `hard`.

import { z } from 'zod';

import { MinedProvenanceWireSchema, type ProvenanceRecord } from '../compiler-schema.js';

/**
 * Stage-2 classifier disposition (ADR-091 funnel, the gate). A `structural`
 * (syntactic-invariant) candidate is compile-eligible; a `behavioral` candidate
 * is RAG-only and MUST NEVER reach the compiler (ADR-111 FM(c) — the
 * misclassification the 0-31% prior failure is made of). The split is enforced,
 * not advisory.
 */
export const ClassifierDispositionSchema = z.enum(['structural', 'behavioral']);
export type ClassifierDisposition = z.infer<typeof ClassifierDispositionSchema>;

/**
 * ADR-112 — the minimal candidate shape the compile actuator (`compileCandidate`
 * / `runCompileStage`) actually reads. BOTH the mined `CandidateRuleRecord` and an
 * authored-derived candidate (via `toCompileFeed`) satisfy it: `provenance` is the
 * `mined | authored` union, so ONE compiler accepts either producer without an
 * authored rule masquerading as a classify result (ADR-112 §2 — a parallel
 * front-end to one compiler, never a second compiler). The mined
 * `CandidateRuleRecord` (whose `provenance` is the narrower `MinedProvenanceRecord`)
 * is assignable to this shape; so is the authored compile-feed candidate.
 */
export interface CompileInputCandidate {
  provenance: ProvenanceRecord;
  classifierDisposition: ClassifierDisposition;
  classifierLedgerRef: string;
  dslSource: string;
  /**
   * ADR-112 §3 (#2259/#7) — the engine the structural-eligibility whitelist judged
   * this rule for (AUTHORED producer only). When present, `compileCandidate` asserts
   * the compiled engine MATCHES it: a regex-whitelisted rule whose `dslSource` parses
   * as ast-grep is a contract violation (the eligibility verdict was engine-specific),
   * not a silent re-route. The MINED producer omits it — its engine + identity are
   * `dslSource`-derived, so it carries no independent declaration to bind against.
   */
  declaredEngine?: 'regex' | 'ast' | 'ast-grep';
  unverified: true;
}

/**
 * ADR-111 §3 — the miner's sole output envelope, minted `unverified`/Yellow
 * with no hand-curation. A candidate that cannot produce a complete provenance
 * tuple is dropped loudly to the drop ledger (Tenet 4 / FM(a)), never emitted
 * as a partial — the schema makes a partial unconstructible.
 */
export const CandidateRuleRecordSchema = z.object({
  /**
   * Provenance tuple (PR# + review-thread ref + commit SHA), reusing the
   * shipped `ProvenanceRecordSchema` (#2183) verbatim so a candidate's
   * provenance embeds byte-identically into `legitimacy.provenance` on the
   * downstream projection — no rename seam. An incomplete tuple is
   * schema-unconstructible (FM(a)).
   */
  provenance: MinedProvenanceWireSchema,
  /** Stage-2 disposition. `behavioral` ⇒ RAG-only, never compiled (FM(c)). */
  classifierDisposition: ClassifierDispositionSchema,
  /**
   * Reference into the classifier-ledger entry recording this candidate's
   * structural/behavioral disposition + Stage-4 confirmation. Non-empty
   * (non-mutating refine, matching `reviewThread`'s hash-stability discipline):
   * every emitted candidate is traceable to its classifier-ledger attestation —
   * "no compile output without a classifier-ledger entry" (FM(c)).
   */
  classifierLedgerRef: z.string().refine((s) => s.trim().length > 0, {
    message: 'classifierLedgerRef must be a non-empty ledger reference',
  }),
  /**
   * The generated DSL source (ADR-103 compiler input). LLM-draft-only until the
   * deterministic funnel verifies it (ADR-111 §6 / Tenet-15 corollary). Non-empty
   * (same discipline as the reference fields): an empty DSL source is a degenerate
   * candidate that must take the loud-drop path, not emit as valid.
   */
  dslSource: z.string().refine((s) => s.trim().length > 0, {
    message: 'dslSource must be non-empty',
  }),
  /**
   * Zero-trust mint flag (ADR-089 / ADR-111 FM(b)). Literally `true` — a
   * candidate is ALWAYS minted unverified/Yellow; anything else is a
   * producer-side promotion across sense→enforce. Forces `deriveRuleClass` to
   * 'advisory' on any later projection into a CompiledRule.
   */
  unverified: z.literal(true),
});

export type CandidateRuleRecord = z.infer<typeof CandidateRuleRecordSchema>;
