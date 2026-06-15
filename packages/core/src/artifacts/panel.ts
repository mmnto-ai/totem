/**
 * Panel synthesis — independent lanes, deterministic script aggregation
 * (mmnto-ai/totem#2104, strategy#474 slice 5).
 *
 * A "panel" is N independent runs (lanes) of the same task over one immutable
 * grounding bundle, each emitting a #2100 {@link RunArtifact} plus its #2103
 * {@link PostCheckReport}. This module is the ENGINE: a pure, zero-LLM script
 * (Tenet 9) that aggregates the lanes — group findings by `ruleName`, tally
 * lane verdicts, surface divergence, and label vendor diversity HONESTLY — plus
 * content-addressed storage for the resulting {@link PanelArtifact}. It does NOT
 * run backends or dispatch lanes (the CLI runner is a deferred fast-follow), and
 * it emits NO panel-level gate: the panel is a SENSOR (a verdict *distribution*,
 * never a single accept/reject), leaving any gating policy to a later consumer.
 *
 * Diversity-labeling honesty is the load-bearing decision (strategy#474 / Prop
 * 291 / Tenet 19): cross-VENDOR convergence is the strong signal, NOT vote count.
 * The raw `providers[]` is always emitted lossless so a label can never overclaim
 * rigor, and an unrecognized provider string trips a fail-loud `coarse` marker
 * (see {@link classifyDiversity}).
 *
 * Schema-evolution policy mirrors {@link RunArtifactSchema} (F1): the reader is
 * version-tolerant within major 1; a major bump needs a migration entry before
 * the writer ships. Zod is the persisted-JSON boundary (read back from disk).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { rethrowAsParseError, TotemParseError } from '../errors.js';
import { readJsonSafe } from '../sys/fs.js';
import { calculateDeterministicHash } from './hash.js';
import type { CheckVerdict, PostCheckReport } from './post-checks.js';
import type { RunArtifact } from './schema.js';
import { RunArtifactSchema } from './schema.js';

// ─── Schema version (mirrors RunArtifact F1) ────────────────────────────────

/** The panel schemaVersion WRITTEN by this code. Readers accept any 1.x. */
export const PANEL_ARTIFACT_SCHEMA_VERSION = '1.0.0';

/** The major this reader understands; other majors need a migration entry. */
export const PANEL_ARTIFACT_KNOWN_MAJOR = 1;

/** Major-1 semver literal — keep in sync with {@link PANEL_ARTIFACT_KNOWN_MAJOR} (a literal beats runtime RegExp construction; the major only changes alongside a migration entry). */
const PANEL_SCHEMA_VERSION_RE = /^1\.\d+\.\d+$/;

/** Accept any 1.x version; reject other majors loud (F1). Zod `.regex()` is the
 * validation boundary (mirrors schema.ts's `z.string().regex(...)`) — not a bare
 * RegExp.test; the ZodError carries the offending value. */
const panelSchemaVersionField = z.string().regex(PANEL_SCHEMA_VERSION_RE, {
  message: `unsupported panel-artifact schemaVersion — this reader understands major ${PANEL_ARTIFACT_KNOWN_MAJOR}.x; a new major requires a migration entry in readPanelArtifact`,
});

/** sha256 hex content hash (full digest — identity, not display). */
const SHA256_HEX = /^[0-9a-f]{64}$/;
/** Zod guard for the content-address id — the validation boundary (mirrors schema.ts; no bare RegExp.test). */
const Sha256HexSchema = z.string().regex(SHA256_HEX);

// ─── Diversity ──────────────────────────────────────────────────────────────

/**
 * The two honest diversity labels.
 *
 * `same-vendor-isolated` means **context-isolation, NOT rater-independence**: the
 * lanes ran in isolated contexts but on one vendor family, so the panel's
 * `verdictDistribution` is **N correlated samples, not N independent votes**
 * (Prop 277 correlated-raters; strategy-claude PP2). A consumer must never read a
 * same-vendor split as independent agreement. `cross-vendor` means ≥2 distinct
 * provider families ran — the Tenet-19 strong-signal case — and is trustworthy
 * only when `diversityConfidence === 'verified'` (see {@link classifyDiversity}).
 */
export const PanelDiversityClassSchema = z.enum(['cross-vendor', 'same-vendor-isolated']);
export type PanelDiversityClass = z.infer<typeof PanelDiversityClassSchema>;

/**
 * Provider strings whose vendor FAMILY is known and currently 1:1 with the
 * string. INVARIANT: `distinctProviders` is a valid independent-cluster count
 * only while provider-string ≡ provider-family (1:1). The day a string that
 * ALIASES one of these families appears (`vertex`→Gemini, `bedrock`→Anthropic,
 * `azure`→OpenAI), counting it as a separate cluster would silently overclaim
 * `cross-vendor`. So an unrecognized string trips `diversityConfidence='coarse'`
 * rather than confidently asserting diversity — the sensor speaking at its own
 * failure point. The actual provider→family MAP is deliberately deferred until a
 * real aliasing string exists (Tenet 21); this allowlist is the tripwire, not
 * the map.
 */
const KNOWN_PROVIDER_FAMILIES: ReadonlySet<string> = new Set(['gemini', 'anthropic', 'openai']);

/**
 * Honest vendor-diversity label for a panel. `providers[]` is ALWAYS present and
 * lossless (per-lane, canonical laneId order) so no derived field can overclaim.
 */
export const PanelDiversitySchema = z.object({
  /** Per-lane provider strings, lossless, in canonical (laneId-sorted) order. */
  providers: z.array(z.string()),
  /** `new Set(providers).size` — a true cluster count ONLY while confidence is `verified`. */
  distinctProviders: z.number().int().nonnegative(),
  class: PanelDiversityClassSchema,
  /** Sorted unique providers outside {@link KNOWN_PROVIDER_FAMILIES} — the overclaim risk. */
  unrecognizedProviders: z.array(z.string()),
  /** `verified` when every provider's family is known; `coarse` otherwise (don't trust `cross-vendor`). */
  diversityConfidence: z.enum(['verified', 'coarse']),
});
export type PanelDiversity = z.infer<typeof PanelDiversitySchema>;

// ─── Synthesis ──────────────────────────────────────────────────────────────

/**
 * One rule's outcome aggregated across all lanes. The dedup anchor is `ruleName`
 * (PostCheckFinding has no path:line anchor); `messages` are preserved VERBATIM
 * (Tenet 9 — no LLM rewrite) and sorted for determinism.
 */
export const SynthesisFindingSchema = z.object({
  ruleName: z.string(),
  tier: z.enum(['decidable', 'sensor']),
  /** Lane verdict tally; the three keys always sum to `lanes.length` (absent lanes count as `abstain`). */
  verdicts: z.object({
    pass: z.number().int().nonnegative(),
    fail: z.number().int().nonnegative(),
    abstain: z.number().int().nonnegative(),
  }),
  /** True IFF both `pass` and `fail` appear across lanes (`abstain` is neutral). */
  divergent: z.boolean(),
  /** Verbatim lane messages (present lanes only), sorted. */
  messages: z.array(z.string()),
});
export type SynthesisFinding = z.infer<typeof SynthesisFindingSchema>;

/**
 * The deterministic aggregation. SENSOR ONLY: a `verdictDistribution` tally (of
 * each lane's own `PostCheckReport.isRejected`) plus per-rule findings and a
 * divergence count — and deliberately NO panel-level `isRejected`/gate boolean.
 * A bare tally invites the vote-counting Tenet 19 forbids, so consumers must
 * lead with divergence + diversity; the tally is one subordinate raw signal.
 */
export const PanelSynthesisSchema = z.object({
  /** Tally of lane outcomes: `isRejected===false ⟹ accepted`, `true ⟹ rejected`. Sums to lane count. */
  verdictDistribution: z.object({
    accepted: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
  }),
  findings: z.array(SynthesisFindingSchema),
  /** `=== findings.filter(f => f.divergent).length`. */
  divergences: z.number().int().nonnegative(),
});
export type PanelSynthesis = z.infer<typeof PanelSynthesisSchema>;

// ─── Persisted post-check report (a JSON-safe Zod copy of the slice-4 shape) ──

/**
 * A persisted copy of a {@link PostCheckFinding}. slice-4's report is plain TS
 * (in-memory only); persisting the panel's audit inputs across the disk boundary
 * needs a Zod boundary (codex #1). `context` is OMITTED from the persisted copy:
 * it is rule-specific, unbounded, not JSON-safe by contract, and never load-bearing
 * for synthesis (which keys on `ruleName`) — "constrain JSON-safe or omit", omitted.
 */
export const PersistedPostCheckFindingSchema = z.object({
  ruleName: z.string(),
  tier: z.enum(['decidable', 'sensor']),
  verdict: z.enum(['pass', 'fail', 'abstain']),
  message: z.string(),
});
export type PersistedPostCheckFinding = z.infer<typeof PersistedPostCheckFindingSchema>;

/**
 * A persisted copy of a {@link PostCheckReport}. The `isRejected` ADR-109
 * invariant is re-validated here at BOTH write and read (codex #1): a stored
 * report whose `isRejected` disagrees with its findings is a corrupt audit
 * record and must be rejected loud, never trusted.
 */
export const PersistedPostCheckReportSchema = z
  .object({
    findings: z.array(PersistedPostCheckFindingSchema),
    isRejected: z.boolean(),
  })
  .refine(
    (r) => r.isRejected === r.findings.some((f) => f.tier === 'decidable' && f.verdict === 'fail'),
    {
      message:
        'persisted report isRejected must equal "some decidable finding failed" (ADR-109) — record is corrupt',
    },
  );
export type PersistedPostCheckReport = z.infer<typeof PersistedPostCheckReportSchema>;

// ─── Panel artifact ───────────────────────────────────────────────────────────

/**
 * One persisted lane: its stable id, the #2100 run artifact, and the persisted
 * #2103 report. The full inputs are stored (not just the aggregate) so a panel
 * is re-auditable offline without re-running rules that may have since changed
 * (codex #1 — the same immutability principle behind RunArtifact).
 */
export const PanelLaneSchema = z.object({
  laneId: z.string().min(1),
  artifact: RunArtifactSchema,
  report: PersistedPostCheckReportSchema,
});
export type PanelLane = z.infer<typeof PanelLaneSchema>;

export const PanelArtifactSchema = z
  .object({
    schemaVersion: panelSchemaVersionField,
    /** Persisted lanes, canonical laneId order. At least one — a zero-lane panel is structurally meaningless. */
    lanes: z.array(PanelLaneSchema).min(1),
    diversity: PanelDiversitySchema,
    synthesis: PanelSynthesisSchema,
    /**
     * ISO-8601 emission time. EXCLUDED from the content address (identical panels
     * dedup regardless of when they ran) — observability only.
     */
    createdAt: z.string(),
  })
  // Cross-field invariants the sensor DOCUMENTS are now ENFORCED at the persisted
  // boundary (greptile P2 on mmnto-ai/totem#2179): a hand-edited / corrupt artifact
  // with inconsistent tallies must FAIL parse, not silently violate the stated
  // guarantees — the same .refine() discipline as the ADR-109 isRejected check.
  .superRefine((a, ctx) => {
    const n = a.lanes.length;
    if (a.diversity.providers.length !== n) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `diversity.providers length (${a.diversity.providers.length}) must equal lane count (${n})`,
      });
    } else {
      // providers[] must be GROUNDED in the lane records, not merely correct-length
      // (CodeRabbit on mmnto-ai/totem#2179): both are in canonical laneId order, so
      // providers[i] must equal lanes[i]'s backend.provider. Only run when lengths
      // align — otherwise the length issue above already names the root cause, so
      // skipping avoids duplicate issues for one fault (CR noise note on #2179).
      a.lanes.forEach((lane, i) => {
        if (a.diversity.providers[i] !== lane.artifact.backend.provider) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `diversity.providers[${i}] must equal lanes[${i}].artifact.backend.provider ("${lane.artifact.backend.provider}")`,
          });
        }
      });
    }
    // The diversity LABEL fields (distinctProviders / class / unrecognizedProviders /
    // diversityConfidence) are PURE FUNCTIONS of providers[] — re-derive and require a
    // match, so a tampered artifact can't carry diversityConfidence:'verified' or
    // class:'cross-vendor' over an unrecognized alias and bypass the PP1 tripwire at
    // READ (greptile on mmnto-ai/totem#2179). classifyDiversity is the single source of truth.
    const derived = classifyDiversity(a.diversity.providers);
    if (a.diversity.distinctProviders !== derived.distinctProviders) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `diversity.distinctProviders (${a.diversity.distinctProviders}) must equal the value derived from providers (${derived.distinctProviders})`,
      });
    }
    if (a.diversity.class !== derived.class) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `diversity.class "${a.diversity.class}" must equal the value derived from providers ("${derived.class}")`,
      });
    }
    if (a.diversity.diversityConfidence !== derived.diversityConfidence) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `diversity.diversityConfidence "${a.diversity.diversityConfidence}" must equal the value derived from providers ("${derived.diversityConfidence}")`,
      });
    }
    if (
      a.diversity.unrecognizedProviders.length !== derived.unrecognizedProviders.length ||
      !a.diversity.unrecognizedProviders.every((p, i) => p === derived.unrecognizedProviders[i])
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `diversity.unrecognizedProviders must equal the set derived from providers ([${derived.unrecognizedProviders.join(', ')}])`,
      });
    }
    const vd = a.synthesis.verdictDistribution;
    if (vd.accepted + vd.rejected !== n) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `verdictDistribution (accepted ${vd.accepted} + rejected ${vd.rejected}) must sum to lane count (${n})`,
      });
    }
    for (const f of a.synthesis.findings) {
      const sum = f.verdicts.pass + f.verdicts.fail + f.verdicts.abstain;
      if (sum !== n) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `finding "${f.ruleName}" verdicts sum (${sum}) must equal lane count (${n}) — present verdicts plus implicit abstain`,
        });
      }
      if (f.divergent !== (f.verdicts.pass > 0 && f.verdicts.fail > 0)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `finding "${f.ruleName}" divergent flag must equal (pass > 0 && fail > 0)`,
        });
      }
    }
    const divergent = a.synthesis.findings.filter((f) => f.divergent).length;
    if (a.synthesis.divergences !== divergent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `synthesis.divergences (${a.synthesis.divergences}) must equal the count of divergent findings (${divergent})`,
      });
    }
  });
export type PanelArtifact = z.infer<typeof PanelArtifactSchema>;

/**
 * In-memory lane input to the pure aggregators: a stable `laneId`, the run
 * artifact, and slice-4's live {@link PostCheckReport}. The caller (a future CLI
 * runner) computes the report via `evaluatePostChecks`; this engine stays pure
 * over the precomputed pairs.
 */
export interface PanelLaneInput {
  laneId: string;
  artifact: RunArtifact;
  report: PostCheckReport;
}

// ─── Pure aggregators ─────────────────────────────────────────────────────────

/**
 * Label the vendor diversity of a panel from its per-lane provider strings.
 * Pure. The `class` is the mechanical reading of `distinctProviders`; the
 * `diversityConfidence` marker is whether that reading is trustworthy — `coarse`
 * means an unrecognized provider string is present, so a `cross-vendor` class
 * MUST NOT be taken as a confident independent-cluster claim (strategy-claude
 * PP1/OQ2 tripwire). See {@link KNOWN_PROVIDER_FAMILIES} for the invariant.
 */
export function classifyDiversity(providers: readonly string[]): PanelDiversity {
  const distinctProviders = new Set(providers).size;
  const unrecognizedProviders = [
    ...new Set(providers.filter((p) => !KNOWN_PROVIDER_FAMILIES.has(p))),
  ].sort();
  return {
    providers: [...providers],
    distinctProviders,
    class: distinctProviders >= 2 ? 'cross-vendor' : 'same-vendor-isolated',
    unrecognizedProviders,
    diversityConfidence: unrecognizedProviders.length === 0 ? 'verified' : 'coarse',
  };
}

/**
 * Aggregate N lanes into a {@link PanelSynthesis}. Pure, deterministic, zero-LLM.
 * Output is identical under any permutation of `lanes` (findings sorted by
 * `ruleName`; per-rule lanes walked in laneId order; messages sorted).
 *
 * Throws (fail-loud, never silently degrade — Tenet 4) on a corrupt input
 * contract: a lane with two findings sharing one `ruleName` (would masquerade as
 * cross-lane agreement — codex #2), or one `ruleName` carrying conflicting
 * `tier`s across lanes (a rule's tier is static — codex #9). A `ruleName` simply
 * ABSENT from some lanes is NOT an error: those lanes count as implicit
 * `abstain` (agy #4), so each finding's verdicts sum to `lanes.length`.
 */
export function synthesizePanel(lanes: readonly PanelLaneInput[]): PanelSynthesis {
  if (lanes.length === 0) {
    throw new Error('synthesizePanel requires at least one lane (got 0).');
  }

  const ordered = [...lanes].sort((a, b) => a.laneId.localeCompare(b.laneId));

  // Index each lane's findings by ruleName, hard-erroring on within-lane dupes.
  const perLane = ordered.map((lane) => {
    const byRule = new Map<
      string,
      { tier: 'decidable' | 'sensor'; verdict: CheckVerdict; message: string }
    >();
    for (const f of lane.report.findings) {
      if (byRule.has(f.ruleName)) {
        throw new Error(
          `lane "${lane.laneId}" has duplicate finding for ruleName "${f.ruleName}" — within-lane duplicates would masquerade as cross-lane agreement.`,
        );
      }
      byRule.set(f.ruleName, { tier: f.tier, verdict: f.verdict, message: f.message });
    }
    return byRule;
  });

  const ruleNames = [...new Set(perLane.flatMap((m) => [...m.keys()]))].sort();

  const findings: SynthesisFinding[] = ruleNames.map((ruleName) => {
    const verdicts = { pass: 0, fail: 0, abstain: 0 };
    const messages: string[] = [];
    let tier: 'decidable' | 'sensor' | undefined;
    for (const byRule of perLane) {
      const hit = byRule.get(ruleName);
      if (hit === undefined) {
        // Absent here = the rule did not apply to this lane (heterogeneous
        // appliesTo) → implicit abstain, keeping Σ verdicts === lanes.length.
        verdicts.abstain += 1;
        continue;
      }
      if (tier !== undefined && tier !== hit.tier) {
        throw new Error(
          `ruleName "${ruleName}" has conflicting tiers across lanes ("${tier}" vs "${hit.tier}") — a rule's tier is static.`,
        );
      }
      tier = hit.tier;
      verdicts[hit.verdict] += 1;
      messages.push(hit.message);
    }
    return {
      ruleName,
      // `tier` is defined: a ruleName is in the set only if ≥1 lane carried it.
      tier: tier as 'decidable' | 'sensor',
      verdicts,
      divergent: verdicts.pass > 0 && verdicts.fail > 0,
      messages: messages.sort(),
    };
  });

  const verdictDistribution = { accepted: 0, rejected: 0 };
  for (const lane of ordered) {
    if (lane.report.isRejected) verdictDistribution.rejected += 1;
    else verdictDistribution.accepted += 1;
  }

  return {
    verdictDistribution,
    findings,
    divergences: findings.filter((f) => f.divergent).length,
  };
}

/**
 * Assemble a full {@link PanelArtifact} from lane inputs. Pure. Canonicalizes
 * lane order by `laneId` so the content address is stable regardless of caller /
 * completion order, derives diversity from the per-lane providers (same canonical
 * order), synthesizes, and validates the whole shape (which re-checks each
 * persisted report's ADR-109 invariant). `createdAt` is supplied by the caller
 * (this module reads no clock — determinism).
 */
export function assemblePanelArtifact(
  lanes: readonly PanelLaneInput[],
  createdAt: string,
): PanelArtifact {
  if (lanes.length === 0) {
    throw new Error('assemblePanelArtifact requires at least one lane (got 0).');
  }
  // synthesizePanel owns its own canonical sort (it is independently callable), so
  // hand it the raw lanes rather than a pre-sorted copy it would only re-sort (CR
  // nit on mmnto-ai/totem#2179). `ordered` is assemble's OWN canonical order, needed
  // for the persisted lanes[] and the per-lane diversity providers[] (both go to disk).
  const synthesis = synthesizePanel(lanes);
  const ordered = [...lanes].sort((a, b) => a.laneId.localeCompare(b.laneId));
  const diversity = classifyDiversity(ordered.map((l) => l.artifact.backend.provider));
  const persistedLanes: PanelLane[] = ordered.map((l) => ({
    laneId: l.laneId,
    artifact: l.artifact,
    report: {
      isRejected: l.report.isRejected,
      findings: l.report.findings.map((f) => ({
        ruleName: f.ruleName,
        tier: f.tier,
        verdict: f.verdict,
        message: f.message,
      })),
    },
  }));
  // parse() validates the assembled shape AND each report's isRejected invariant
  // on the way out — a builder bug must never poison the ledger (Tenet 4).
  return PanelArtifactSchema.parse({
    schemaVersion: PANEL_ARTIFACT_SCHEMA_VERSION,
    lanes: persistedLanes,
    diversity,
    synthesis,
    createdAt,
  });
}

// ─── Content-addressed storage (mirrors storage.ts exactly) ───────────────────

/** Storage layout segments under the totem dir. */
const PANELS_DIR_SEGMENTS = ['artifacts', 'panels'] as const;

/**
 * Migration-on-read registry (F1). Keyed by MAJOR. EMPTY at 1.0.0 by design —
 * the policy requires a major bump to land its migration entry here before the
 * writer ships, so empty is the honest statement that no other major exists. Each
 * entry MUST return current-schema output; readPanelArtifact re-validates it via
 * parse() before returning (CR note on mmnto-ai/totem#2179).
 */
const MIGRATIONS: ReadonlyMap<number, (raw: unknown) => PanelArtifact> = new Map();

/** Absolute panels directory for a given absolute totem dir. */
export function panelsDir(totemDirAbs: string): string {
  return path.join(totemDirAbs, ...PANELS_DIR_SEGMENTS);
}

/**
 * Content address of a panel: deterministic hash over everything EXCEPT
 * `createdAt` (observability, not identity). The artifact is already canonical
 * (assemblePanelArtifact sorts lanes/findings/messages), so the address is a
 * pure function of the logical panel.
 */
export function computePanelArtifactContentHash(artifact: PanelArtifact): string {
  const { createdAt: _excluded, ...identity } = artifact;
  return calculateDeterministicHash(identity);
}

export interface SavePanelArtifactResult {
  /** The content address (= filename stem). */
  hash: string;
  /** Absolute path of the stored artifact. */
  path: string;
  /** True when an identical logical panel was already recorded (no write happened). */
  existed: boolean;
}

/**
 * Persist a panel at its content address, write-if-absent. An existing file is
 * NEVER rewritten (append-only: first write wins). Validates on the way out so a
 * writer bug cannot poison the ledger with a record the reader would reject.
 */
export function writePanelArtifact(
  totemDirAbs: string,
  artifact: PanelArtifact,
): SavePanelArtifactResult {
  const validated = PanelArtifactSchema.parse(artifact);
  const hash = computePanelArtifactContentHash(validated);
  const dir = panelsDir(totemDirAbs);
  const filePath = path.join(dir, `${hash}.json`);

  if (fs.existsSync(filePath)) {
    return { hash, path: filePath, existed: true };
  }

  fs.mkdirSync(dir, { recursive: true });
  try {
    // `wx` = atomic create-exclusive: closes the TOCTOU window between the
    // existsSync fast-path and the write so concurrent saves of the same hash
    // can never overwrite the first record — first-write-wins is enforced by
    // the filesystem. mode 0o600 matches run storage: panels embed run records
    // that carry masked prompt content.
    fs.writeFileSync(filePath, JSON.stringify(validated, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
      flag: 'wx',
    });
  } catch (err) {
    if (err !== null && typeof err === 'object' && 'code' in err && err.code === 'EEXIST') {
      return { hash, path: filePath, existed: true };
    }
    throw err;
  }
  return { hash, path: filePath, existed: false };
}

/**
 * Load + validate a panel by content address. Throws {@link TotemParseError} on
 * a missing file, corrupt JSON, schema violation, an unknown major with no
 * migration entry, or a persisted report whose `isRejected` invariant is broken
 * — loud, never a silent partial (Tenet 4).
 */
export function readPanelArtifact(totemDirAbs: string, hash: string): PanelArtifact {
  if (!Sha256HexSchema.safeParse(hash).success) {
    throw new TotemParseError(
      `Invalid panel-artifact id "${hash}" — expected a 64-char sha256 hex content address.`,
      'Pass the hash exactly as reported at emission (or from the artifacts/panels/ filename).',
    );
  }
  const filePath = path.join(panelsDir(totemDirAbs), `${hash}.json`);

  // Migration seam (F1): peek the major BEFORE strict validation so a known
  // older major routes through its migration. Empty registry ⇒ straight
  // fall-through today.
  const raw = readJsonSafe(filePath);
  const major = readMajor(raw);
  if (major !== undefined) {
    const migrate = MIGRATIONS.get(major);
    // Re-validate migrated output against the CURRENT schema before returning (CR
    // note on mmnto-ai/totem#2179): a migration's contract is to PRODUCE the current
    // shape, so a migration bug must fail loud here — never return it unvalidated.
    if (migrate !== undefined) return PanelArtifactSchema.parse(migrate(raw));
  }

  try {
    return PanelArtifactSchema.parse(raw);
    // totem-context: rethrowAsParseError always throws (returns `never`) — this catch RE-throws via the shared helper, normalizing ZodError to the module's stated TotemParseError load contract; nothing is swallowed.
  } catch (err) {
    rethrowAsParseError(
      `Panel artifact ${hash} failed schema validation`,
      err,
      'The artifact may be corrupted or written by an incompatible totem version; re-emit it (or add the migration entry for its major).',
    );
  }
}

/** Best-effort major extraction from a raw parsed payload; undefined when absent/garbled. */
function readMajor(raw: unknown): number | undefined {
  if (typeof raw !== 'object' || raw === null || !('schemaVersion' in raw)) return undefined;
  const version = raw.schemaVersion;
  if (typeof version !== 'string') return undefined;
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isNaN(major) ? undefined : major;
}
