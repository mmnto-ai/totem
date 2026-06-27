// ─── ADR-112 Gate-1 authored producer: the AuthoredRuleRecord envelope ───────
//
// The human-authored counterpart to ADR-111's mined `CandidateRuleRecord`. An
// authored rule is anchored to a real historical DEFECT (its `provenance` is the
// AUTHORED variant of the ADR-112 union — train-side preimage fixtures, §3/§4),
// carries an INDEPENDENTLY-judged structural-eligibility result (NOT author-
// asserted — §3), an accelerant-lineage marker (§7), and is minted
// `unverified`/Yellow (ADR-089) with zero enforcement blast radius.
//
// SLICE A scope: the schema spine + the deterministic eligibility check + the
// stable rule-id mint. The `totem rule author` CLI + the `.totem/spine/
// authored-rules.yaml` reader are slice B; the compile-feed integration into
// `runCompileStage` is gated on the `compileCandidate` param-widening flagged in
// the slice-A report (a controller decision). The whitelist REGISTRY of
// decidable classes lives in the CLI (slice B, mirroring `valueEqualityFieldsFor`);
// this core check takes it injected (DI), staying network-free + LLM-free.

import { createHash } from 'node:crypto';

import { z } from 'zod';

import { AuthoredProvenanceRecordSchema } from '../compiler-schema.js';
import type { CompileInputCandidate } from './candidate-rule.js';
import type { ClassifierLedger } from './ledgers.js';

/** The matcher engines an authored rule may declare (mirrors `CompiledRule.engine`). */
export const DeclaredEngineSchema = z.enum(['regex', 'ast', 'ast-grep']);
export type DeclaredEngine = z.infer<typeof DeclaredEngineSchema>;

/**
 * ADR-112 §3 — the result of the INDEPENDENT structural-eligibility check.
 * Produced by `evaluateStructuralEligibility` (NOT by the author): only
 * `decidable: true` reaches the compiler, mapping to the compiler's
 * `classifierDisposition: 'structural'`. `judgedBy` records who/what judged it
 * (ledger-recorded, never the author), so a human cannot smuggle a behavioral
 * policy past ADR-091's gate by hand-asserting "structural" (FM(d)).
 */
export const StructEligResultSchema = z.object({
  decidable: z.boolean(),
  /**
   * `whitelist:<class>` for the cert-#1 static-whitelist basis; the
   * `capability-check` / `draft-classifier+stage4` bases are contract-legal but
   * deferred (slice-A uses the deterministic whitelist only). On a `decidable:
   * false` verdict the basis still names the attempted whitelist class — the
   * diagnostic is "no/ambiguous whitelist match", carried in `judgedBy`'s log.
   */
  basis: z.string().refine((s) => s.trim().length > 0, {
    message: 'basis must be a non-empty eligibility basis',
  }),
  judgedBy: z.string().refine((s) => s.trim().length > 0, {
    message: 'judgedBy must name the check/agent that judged eligibility (never the author)',
  }),
});
export type StructEligResult = z.infer<typeof StructEligResultSchema>;

/** ADR-112 §3/§7 — accelerant-lineage marker. A mined hint that informed a human is recorded, never erased. */
export const AuthoredOriginSchema = z.union([
  z.object({ kind: z.literal('from-scratch') }),
  z.object({
    kind: z.literal('mined-accelerant'),
    sourceRunId: z.string().refine((s) => s.trim().length > 0, { message: 'sourceRunId required' }),
    suggestionHash: z.string().refine((s) => s.trim().length > 0, {
      message: 'suggestionHash required',
    }),
  }),
]);
export type AuthoredOrigin = z.infer<typeof AuthoredOriginSchema>;

// The persisted minted-rule-id shape (ADR-112 §8): a 16-char lowercase-hex base from
// `mintAuthoredRuleId`, with an optional collision suffix. The suffix is EXACTLY what the
// mint emits — `-<n>` for n≥1, never `-0` and never zero-padded — so schema-valid ≡
// mint-producible (#2259 CR: a looser `-\d+` admitted ids like `…-0`/`…-01` the mint can't
// make). Pinned as a shared constant binding the SCHEMA boundary to the mint's codomain.
const AUTHORED_RULE_ID_HEX_LEN = 16;
const AUTHORED_RULE_ID_RE = /^[0-9a-f]{16}(?:-[1-9]\d*)?$/;

/**
 * ADR-112 §3 — the authored producer's sole output envelope. Parallel to
 * ADR-111's `CandidateRuleRecord` but carrying the AUTHORED provenance variant,
 * the INDEPENDENTLY-judged eligibility result, and the accelerant lineage.
 * Minted `unverified: true` (ADR-089) — zero enforcement blast radius.
 */
export const AuthoredRuleRecordSchema = z.object({
  /**
   * ADR-112 §3/§8 — the stable, minted rule identity (`mintAuthoredRuleId`),
   * assigned ONCE at authoring time and PERSISTED on the record; NEVER re-derived
   * from content at read time. `firingLabelId` + the §5.3
   * `controls.positive[].targetRuleId` ground-truth labels embed it, so a
   * content-re-derived id would orphan them (§8). Slice A reserves the field (this
   * IS the schema spine); the authoring flow (slice B) mints it, and threading it
   * into the compiled artifact's identity (`firingLabelId ← ruleId`, replacing the
   * `dslSource`-derived `lessonHash`) is slice C/D. The RESOLVED id (with any `-N`
   * collision suffix) is what is stored.
   */
  ruleId: z.string().regex(AUTHORED_RULE_ID_RE, {
    message:
      'ruleId must be a minted authored rule id — 16 hex chars + optional -<n> suffix (ADR-112 §3/§8)',
  }),
  provenance: AuthoredProvenanceRecordSchema,
  /** INDEPENDENTLY established (§3) — the author never sets this; the check does. */
  structuralEligibility: StructEligResultSchema,
  origin: AuthoredOriginSchema,
  declaredEngine: DeclaredEngineSchema,
  /** Reference to the §8 authoring-ledger entry (author/date/engine/splitRef/attestations). */
  authoringLedgerRef: z.string().refine((s) => s.trim().length > 0, {
    message: 'authoringLedgerRef must be a non-empty ledger reference',
  }),
  /** The human-written matcher (same DSL the compiler accepts from the miner). */
  dslSource: z.string().refine((s) => s.trim().length > 0, {
    message: 'dslSource must be non-empty',
  }),
  /** Zero-trust mint (ADR-089 / ADR-112 §1) — always literally `true`. */
  unverified: z.literal(true),
});
export type AuthoredRuleRecord = z.infer<typeof AuthoredRuleRecordSchema>;

// ── The independent structural-eligibility check (ADR-112 §3) ─────────────────

/**
 * One decidable `(engine, structuralClass)` pair. The whitelist of these lives
 * in the CLI registry (slice B); the registry lists ONLY pairs the engine can
 * actually represent, so "exactly one match" subsumes ADR-112 §3's "AND the
 * engine can represent that class" condition.
 */
export interface WhitelistEntry {
  engine: DeclaredEngine;
  structuralClass: string;
}

/**
 * ADR-112 §3 — the INDEPENDENT structural-eligibility check. A CLOSED registry
 * predicate, NOT prose: `decidable` is true iff EXACTLY ONE whitelist entry
 * matches `(declaredEngine, structuralClass)`. Unknown class, unsupported
 * engine, or multiple matches → `decidable: false` (NO default-to-structural).
 * The author supplies `declaredEngine` + `structuralClass`; this check OWNS the
 * verdict — any author-supplied disposition is irrelevant here (FM(d)).
 * Deterministic + pure (no IO, no LLM) — the same input always yields the same
 * verdict (Tenet-15).
 */
export function evaluateStructuralEligibility(
  input: { declaredEngine: DeclaredEngine; structuralClass: string },
  whitelist: readonly WhitelistEntry[],
  judgedBy: string,
): StructEligResult {
  const matches = whitelist.filter(
    (e) => e.engine === input.declaredEngine && e.structuralClass === input.structuralClass,
  );
  return {
    decidable: matches.length === 1,
    basis: `whitelist:${input.structuralClass}`,
    judgedBy,
  };
}

// ── Stable rule-id mint (ADR-112 §8) ──────────────────────────────────────────

/**
 * ADR-112 §8 — mint a stable, deterministic authored rule-id. The seed is
 * `sha256(JSON.stringify([author, targetDefect]))[:16]` (an INJECTIVE encoding —
 * see the inline note) — `dslSource` is DELIBERATELY EXCLUDED so an author can
 * tighten/refactor the matcher without orphaning the rule's ledger history. On collision with an already-resolved id (two rules sharing the same
 * `(author, targetDefect)`), a stable `-N` counter is appended. The RESOLVED id
 * is what callers persist — never recompute the raw seed at read time, or a
 * later sibling could shift the suffix (the gemini/agy break). The
 * `never-remine` marker is keyed to `targetDefect`, handled by the accelerant
 * miner, not here.
 */
export function mintAuthoredRuleId(
  author: string,
  targetDefect: string,
  existingIds: ReadonlySet<string>,
): string {
  // Unambiguous seed encoding (GCA-high + CR-major, #2259): a bare `author·targetDefect`
  // ALIASES distinct tuples — ('a·b','c') and ('a','b·c') collapse onto one seed. A JSON
  // array of the two inputs is injective: distinct (author, targetDefect) pairs can never
  // serialize to the same string, so a persisted id can't collide by encoding.
  const seed = createHash('sha256')
    .update(JSON.stringify([author, targetDefect]))
    .digest('hex')
    .slice(0, AUTHORED_RULE_ID_HEX_LEN);
  if (!existingIds.has(seed)) return seed;
  for (let n = 1; ; n += 1) {
    const candidate = `${seed}-${n}`;
    if (!existingIds.has(candidate)) return candidate;
  }
}

// ── Compile-feed adapter (ADR-112 §2/§8) ──────────────────────────────────────

/**
 * The authored producer's compile-stage input — what `toCompileFeed` builds for
 * `runCompileStage`. Deliberately NOT a `ClassifyStageResult`: an authored rule
 * has no mining emission ledger, so faking one would be a provenance lie. The
 * classifier ledger it carries records `dispositionSource: 'authored-whitelist'`.
 */
export interface AuthoredCompileFeed {
  candidates: CompileInputCandidate[];
  classifierLedger: ClassifierLedger;
}

/**
 * ADR-112 §2/§8 — turn structurally-DECIDABLE authored rules into the input
 * `runCompileStage` consumes, reusing the ONE G-series compiler (never a second).
 * The disposition is set HERE to `'structural'` from the INDEPENDENT eligibility
 * verdict (§3) — the author never sets it. A NON-decidable record is a contract
 * violation → FAIL LOUD (the FM(d) backstop in code), never a silent skip.
 * `classifierLedgerRef = authored:<authoringLedgerRef>` is unique per rule (the
 * authoring ledger is 1:1 with the rule); a duplicate fails loud so the downstream
 * 1:1 classifier-ledger join can't silently collapse.
 */
export function toCompileFeed(records: readonly AuthoredRuleRecord[]): AuthoredCompileFeed {
  const candidates: CompileInputCandidate[] = [];
  const entries: ClassifierLedger['entries'] = [];
  const seen = new Set<string>();
  for (const record of records) {
    if (!record.structuralEligibility.decidable) {
      throw new Error(
        `[Totem Error] toCompileFeed: authored rule '${record.authoringLedgerRef}' is not structurally decidable — a non-decidable rule must never reach the compiler (ADR-112 §3 / FM(d))`,
      );
    }
    const classifierLedgerRef = `authored:${record.authoringLedgerRef}`;
    if (seen.has(classifierLedgerRef)) {
      throw new Error(
        `[Totem Error] toCompileFeed: duplicate authoringLedgerRef '${record.authoringLedgerRef}' — each authored rule needs a unique ledger ref for the 1:1 compile join`,
      );
    }
    seen.add(classifierLedgerRef);
    candidates.push({
      provenance: record.provenance,
      classifierDisposition: 'structural',
      classifierLedgerRef,
      dslSource: record.dslSource,
      // §3 (#7): carry the whitelist-judged engine so the compiler can assert it
      // compiled under THAT engine — a regex-whitelisted rule whose dslSource parses
      // as ast-grep must fail loud, not silently re-route to a different engine.
      declaredEngine: record.declaredEngine,
      unverified: true,
    });
    entries.push({
      candidateRef: classifierLedgerRef,
      disposition: 'structural',
      stage4Confirmed: false,
      dispositionSource: 'authored-whitelist',
    });
  }
  return { candidates, classifierLedger: { entries } };
}
