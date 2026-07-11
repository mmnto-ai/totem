/**
 * Verdict-artifact contract — the single convergence point both review lanes
 * emit (mmnto-ai/totem#2106, Proposal 302 / 304 R2 local review runner).
 *
 * A verdict artifact is the immutable, content-addressed record of ONE review
 * round over ONE masked diff: the fan of lanes that attempted it (each a
 * terminal {@link RunArtifact} reference, one hop from provenance), the
 * deterministic #2103 post-checks, the normalized findings, the optional #2104
 * panel it assembled, and the derived round/lineage bookkeeping. Everything
 * downstream (the CLI round loop, the pilot ledger's covariate PR-line, the
 * Phase-2 disposition ledger) consumes this shape, so it stays minimal but
 * versioned.
 *
 * ── LANE-BLINDNESS INVARIANT (Proposal 302, DELIBERATE EXCLUSION) ────────────
 * There is NO warm/cold runner-lane discriminator field ANYWHERE in this schema
 * — not at the top level, not on a lane. This exclusion is deliberate: a
 * contract consumer reads the verdict and CANNOT discriminate WHICH runner lane
 * (a warm resident agent vs a cold SDK invocation) produced it. The wording
 * matters (strategy 1a): "consumers cannot discriminate lanes FROM the
 * artifact", NOT "lane identity is unknowable" — `lanes[].runArtifactHash`
 * reaches provenance one hop away and `resolvedBackend` is panel-DIVERSITY data,
 * neither of which is a warm/cold runner discriminator. The absence is enforced
 * by a structural test (snapshots the key set) IN ADDITION to this note.
 *
 * Schema-evolution policy mirrors {@link RunArtifactSchema} / the panel artifact
 * (F1): the reader is version-tolerant WITHIN the major — `schemaVersion`
 * validates as `1.x`, every post-1.0.0 field is additive-optional, and a MAJOR
 * bump requires a migration entry in `loadVerdictArtifact` before the writer
 * ships. Hard-reject only unknown majors. Zod is the persisted-JSON boundary
 * (read back from disk), per the repo's Zod-at-boundaries-only rule.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { rethrowAsParseError, TotemError, TotemParseError } from '../errors.js';
import { readJsonSafe } from '../sys/fs.js';
import { calculateDeterministicHash } from './hash.js';
import { PanelDiversitySchema, PersistedPostCheckFindingSchema } from './panel.js';

// ─── Schema version (mirrors RunArtifact / Panel F1) ────────────────────────

/** The verdict schemaVersion WRITTEN by this code. Readers accept any 1.x (F1). */
export const VERDICT_ARTIFACT_SCHEMA_VERSION = '1.0.0';

/** The major this reader understands; other majors need a migration entry. */
export const VERDICT_ARTIFACT_KNOWN_MAJOR = 1;

/** Major-1 semver literal — keep in sync with {@link VERDICT_ARTIFACT_KNOWN_MAJOR} (a literal beats runtime RegExp construction; the major only changes alongside a migration entry). */
const VERDICT_SCHEMA_VERSION_RE = /^1\.\d+\.\d+$/;

/** Accept any 1.x version; reject other majors with the version NAMED (F1) —
 * mirrors run-artifact's `schemaVersionField` refine so the rejection error
 * carries the offending value, not just a static string. */
const verdictSchemaVersionField = z.string().refine(
  (v) => VERDICT_SCHEMA_VERSION_RE.test(v),
  (v) => ({
    message: `unsupported verdict-artifact schemaVersion "${v}" — this reader understands major ${VERDICT_ARTIFACT_KNOWN_MAJOR}.x; a new major requires a migration entry in loadVerdictArtifact`,
  }),
);

/** sha256 hex content hash (full digest — identity, not display). */
const SHA256_HEX = /^[0-9a-f]{64}$/;
/** Zod guard for a sha256 hex content address (mirrors schema.ts; no bare RegExp.test at the boundary). */
const Sha256HexSchema = z.string().regex(SHA256_HEX, 'must be a sha256 hex digest');

// ─── Diff scope (source-discriminated) ──────────────────────────────────────

/**
 * The four `getDiffForReview` sources. Canonical order matches the design doc.
 */
export const VERDICT_DIFF_SOURCES = [
  'explicit-range',
  'staged',
  'uncommitted',
  'branch-vs-base',
] as const;
export type VerdictDiffSource = (typeof VERDICT_DIFF_SOURCES)[number];

/**
 * The reviewed diff's scope, DISCRIMINATED by `source`. `diffHash` is ALWAYS
 * required (sha256 over the MASKED review-payload bytes the lanes actually
 * reviewed — hash symmetry with the artifact chain, never binds secret-bearing
 * bytes; agy fold 5). The git ref fields are required only where the source
 * makes them meaningful:
 *   - `explicit-range` — `base` AND `head` (the two endpoints).
 *   - `branch-vs-base`  — `base` only (head is the working ref, implicit).
 *   - `staged` / `uncommitted` — NO refs (the index / worktree has none).
 */
export const VerdictDiffScopeSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('explicit-range'),
    diffHash: Sha256HexSchema,
    base: z.string().min(1),
    head: z.string().min(1),
  }),
  z.object({
    source: z.literal('branch-vs-base'),
    diffHash: Sha256HexSchema,
    base: z.string().min(1),
  }),
  z.object({
    source: z.literal('staged'),
    diffHash: Sha256HexSchema,
  }),
  z.object({
    source: z.literal('uncommitted'),
    diffHash: Sha256HexSchema,
  }),
]);
export type VerdictDiffScope = z.infer<typeof VerdictDiffScopeSchema>;

// ─── Lanes (status-discriminated union) ─────────────────────────────────────

/**
 * Typed terminal-failure reasons for a `failed` lane. A failed lane is never
 * handed to `assemblePanelArtifact` and never stamps the cache. NOTE (Prop 302
 * lane-blindness): these classify the FAILURE, never the runner lane — none of
 * them names warm/cold.
 */
export const VERDICT_LANE_FAILURE_REASONS = [
  'invoke-error',
  'quota-exhausted',
  'missing-artifact-emission',
  'config-error',
] as const;
export type VerdictLaneFailureReason = (typeof VERDICT_LANE_FAILURE_REASONS)[number];

/** A `completed` lane's own severity tally (from its extracted structured verdict). */
export const VerdictLaneSummarySchema = z.object({
  critical: z.number().int().nonnegative(),
  warn: z.number().int().nonnegative(),
  info: z.number().int().nonnegative(),
});
export type VerdictLaneSummary = z.infer<typeof VerdictLaneSummarySchema>;

/**
 * One lane's terminal outcome, DISCRIMINATED by `status`. The union makes
 * impossible records unrepresentable (codex fold 2): a `completed` lane STRUCTURALLY
 * requires its `runArtifactHash` (a response-cache hit emits no run artifact and so
 * can never be `completed`); a `failed` lane carries a typed reason and never a
 * `runArtifactHash`. `resolvedBackend` records what actually ran (post quota
 * fallback) and is panel-diversity data — NOT a runner discriminator.
 */
export const VerdictLaneSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('completed'),
    laneId: z.string().min(1),
    resolvedBackend: z.string().min(1),
    runArtifactHash: Sha256HexSchema,
    verdictSummary: VerdictLaneSummarySchema,
  }),
  z.object({
    status: z.literal('abstained'),
    laneId: z.string().min(1),
    resolvedBackend: z.string().min(1),
    runArtifactHash: Sha256HexSchema,
    /** Why no usable structured verdict was extractable (invoke happened, output unparseable). */
    reason: z.string().min(1),
  }),
  z.object({
    status: z.literal('failed'),
    laneId: z.string().min(1),
    typedReason: z.enum(VERDICT_LANE_FAILURE_REASONS),
    /** Optional: a lane can fail BEFORE a backend resolves (e.g. `config-error`). */
    resolvedBackend: z.string().min(1).optional(),
  }),
]);
export type VerdictLane = z.infer<typeof VerdictLaneSchema>;

// ─── Findings (aligned with ShieldFinding — core must not import from cli) ────

/** Severity vocabulary — aligned VERBATIM with cli `ShieldFindingSeveritySchema` (defined here so core stays cli-independent). */
export const VerdictFindingSeveritySchema = z.enum(['CRITICAL', 'WARN', 'INFO']);
export type VerdictFindingSeverity = z.infer<typeof VerdictFindingSeveritySchema>;

/**
 * A normalized finding from the shared review-output extractor. Field names
 * align with cli `ShieldFinding` (`severity` / `confidence` / `message` /
 * `file` / `line`); `confidence` is optional here because not every extracted
 * lane output carries one, but when present it is a 0..1 probability (same
 * bound as ShieldFinding). The diagnostic `message` is NEVER dropped or
 * renamed.
 */
export const VerdictFindingSchema = z.object({
  severity: VerdictFindingSeveritySchema,
  confidence: z.number().min(0).max(1).optional(),
  file: z.string().optional(),
  line: z.number().optional(),
  message: z.string(),
});
export type VerdictFinding = z.infer<typeof VerdictFindingSchema>;

// ─── Round / lineage ─────────────────────────────────────────────────────────

/**
 * Round bookkeeping (all DERIVED — see the CLI lifecycle). `lineageKey` is the
 * composite hash over the RESOLVED scope selector (see {@link computeLineageKey}
 * — worktree identity + branch + source + the meaningful range selectors), NOT
 * the diff bytes, so legitimate fix rounds still chain; `priorVerdictHash` links
 * the implicit prior round (latest verdict sharing the lineage key) or an
 * explicit `--continues` override; absent at round 0.
 */
export const VerdictRoundSchema = z.object({
  index: z.number().int().nonnegative(),
  priorVerdictHash: Sha256HexSchema.optional(),
  lineageKey: z.string().min(1),
});
export type VerdictRound = z.infer<typeof VerdictRoundSchema>;

// ─── Verdict artifact ──────────────────────────────────────────────────────

/**
 * The verdict artifact. See the module docstring for the LANE-BLINDNESS
 * invariant (Prop 302): NO warm/cold runner-lane discriminator field exists,
 * deliberately.
 *
 * `superRefine` enforces the count/panel invariants that a hand-edited or
 * builder-buggy record could otherwise violate silently — mirrored counts are
 * NEVER accepted on trust (codex): `attemptedLaneCount === lanes.length`,
 * `completedLaneCount === #completed lanes`, and `panelArtifactHash` present ⇒
 * at least two completed lanes (a panel is assembled only from ≥2 usable lanes).
 */
export const VerdictArtifactSchema = z
  .object({
    schemaVersion: verdictSchemaVersionField,
    /** The reviewed diff's scope + masked-payload hash (source-discriminated). */
    diffScope: VerdictDiffScopeSchema,
    /** Every attempted lane's terminal outcome (status-discriminated union). */
    lanes: z.array(VerdictLaneSchema),
    /** MUST equal `lanes.length` (validated below — never trusted). */
    attemptedLaneCount: z.number().int().nonnegative(),
    /** MUST equal the count of `completed` lanes (validated below — never trusted). */
    completedLaneCount: z.number().int().nonnegative(),
    /** Present IFF a #2104 panel was actually assembled (≥2 completed lanes; guarded below). */
    panelArtifactHash: Sha256HexSchema.optional(),
    /** Deterministic #2103 post-checks — the persisted vocabulary VERBATIM (`ruleName`/`tier`/`verdict`/`message`). */
    postChecks: z.array(PersistedPostCheckFindingSchema),
    /** Normalized findings from the shared extractor (exemption-filtered by the CLI before it lands here). */
    findings: z.array(VerdictFindingSchema),
    /** A SINGLE top-level panel-diversity summary (classifyDiversity output) — present only with a panel; NEVER mirrored per finding. */
    diversity: PanelDiversitySchema.optional(),
    round: VerdictRoundSchema,
    /**
     * Post-fan tree compare against the PRE-fan content hash (codex rev-2 fold 1):
     * `'matched'` when the tracked-source tree is byte-identical before and after
     * the fan, `'drifted'` when it changed mid-fan. A DERIVED, non-sentinel field
     * (the two hash domains stay separate — this records the OUTCOME of the compare,
     * not the content hash itself). Drift forces `settled=false` and blocks the
     * cache stamp: the verdict is bound to the pre-fan diff, so a dry fan over a
     * mutated tree does NOT cover the current tree and must not settle the loop.
     */
    reviewedState: z.enum(['matched', 'drifted']),
    /** Current-round dryness predicate (see the CLI lifecycle) — pure over artifact content. */
    settled: z.boolean(),
    /**
     * ISO-8601 emission time. EXCLUDED from the content address (identical
     * rounds dedup to one artifact regardless of when they ran) — observability
     * only. See {@link computeVerdictArtifactContentHash}.
     */
    createdAt: z.string(),
  })
  .superRefine((a, ctx) => {
    if (a.attemptedLaneCount !== a.lanes.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attemptedLaneCount'],
        message: `attemptedLaneCount (${a.attemptedLaneCount}) must equal lanes.length (${a.lanes.length}) — counts are never mirrored on trust`,
      });
    }
    const completed = a.lanes.filter((l) => l.status === 'completed').length;
    if (a.completedLaneCount !== completed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['completedLaneCount'],
        message: `completedLaneCount (${a.completedLaneCount}) must equal the number of completed lanes (${completed}) — counts are never mirrored on trust`,
      });
    }
    // A panel is assembled only from ≥2 usable (completed) lanes; a panelArtifactHash
    // over fewer completed lanes is a structurally impossible record.
    if (a.panelArtifactHash !== undefined && completed < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['panelArtifactHash'],
        message: `panelArtifactHash present requires at least 2 completed lanes (found ${completed}) — a panel is assembled only from usable lanes`,
      });
    }
  });
export type VerdictArtifact = z.infer<typeof VerdictArtifactSchema>;

// ─── Lineage key ──────────────────────────────────────────────────────────

/**
 * The round-chain lineage key is composite over the RESOLVED scope selector (agy
 * fold 3; codex rev-2 fold 2) — NOT the source enum alone. The selector fields
 * describe the *lineage*, never the changing diff bytes, so legitimate fix rounds
 * still chain. Per-source contribution (the CLI resolver populates only the fields
 * a source makes meaningful):
 *   - `repoIdentity` — the stable worktree identity (absolute resolved
 *     `git rev-parse --show-toplevel`), ALWAYS present.
 *   - `branch` — the current branch (or the `DETACHED:<sha>` marker), ALWAYS present.
 *   - `source` — the `getDiffForReview` source, ALWAYS present.
 *   - `explicit-range` — normalized `base` + `head` (the two endpoints).
 *   - `branch-vs-base` — resolved `base` + `mergeBase`.
 *   - `staged` / `uncommitted` — NO range fields (worktree identity + branch +
 *     source carry the lineage).
 */
export interface LineageKeyInput {
  /** Stable worktree identity — the absolute resolved `git rev-parse --show-toplevel`. */
  repoIdentity: string;
  branch: string;
  source: VerdictDiffSource;
  /** Resolved merge-base sha (branch-vs-base). */
  mergeBase?: string;
  /** Range base selector (explicit-range / branch-vs-base). */
  base?: string;
  /** Range head selector (explicit-range). */
  head?: string;
}

/**
 * The composite round-chain lineage key: a domain-tagged sha256 over the resolved
 * scope selector (agy fold 3; codex rev-2 fold 2). Two branches sharing `base=main`
 * can NEVER cross-link because `branch` participates, and two DIFFERENT explicit
 * ranges on one branch + merge-base cannot cross-link because `base`/`head`
 * participate.
 *
 * The selector is hashed as a canonicalized (recursively key-sorted) JSON object
 * with a fixed domain tag, so there is NO delimiter-injection ambiguity —
 * `branch='a', mergeBase='b|c'` and `branch='a|b', mergeBase='c'` serialize to
 * distinct JSON and therefore distinct keys, which a naive `join('|')` would
 * collide. Absent selector fields are pinned to `null` (a stable, unambiguous
 * hole) so a source that omits a field can never collide with one that supplies
 * an empty string for it.
 */
export function computeLineageKey(input: LineageKeyInput): string {
  return calculateDeterministicHash({
    domain: 'verdict-lineage/2',
    repoIdentity: input.repoIdentity,
    branch: input.branch,
    source: input.source,
    mergeBase: input.mergeBase ?? null,
    base: input.base ?? null,
    head: input.head ?? null,
  });
}

// ─── Content-addressed storage (mirrors storage.ts / panel.ts) ──────────────

/** Storage layout segments under the totem dir (exact layout = impl call). */
const VERDICTS_DIR_SEGMENTS = ['artifacts', 'verdicts'] as const;

/** Matches a stored verdict file name and captures its content-address stem. */
const VERDICT_FILE_RE = /^([0-9a-f]{64})\.json$/;

/**
 * Migration-on-read registry (F1). Keyed by MAJOR; each entry lifts a parsed
 * raw object of that major to the current shape. EMPTY at 1.0.0 by design — the
 * policy requires a major bump to land its migration entry here BEFORE the
 * writer ships, so empty is the honest statement that no other major exists.
 * Each entry MUST return current-schema output; the loader re-validates via
 * parse() before returning.
 */
const MIGRATIONS: ReadonlyMap<number, (raw: unknown) => VerdictArtifact> = new Map();

/** Absolute verdicts directory for a given absolute totem dir. */
export function verdictsDir(totemDirAbs: string): string {
  return path.join(totemDirAbs, ...VERDICTS_DIR_SEGMENTS);
}

/**
 * Content address of a verdict: deterministic hash over everything EXCEPT
 * `createdAt` (observability, not identity). Identical rounds dedup to one
 * artifact regardless of when they ran.
 */
export function computeVerdictArtifactContentHash(artifact: VerdictArtifact): string {
  const { createdAt: _excluded, ...identity } = artifact;
  return calculateDeterministicHash(identity);
}

export interface SaveVerdictArtifactResult {
  /** The content address (= filename stem). */
  hash: string;
  /** Absolute path of the stored artifact. */
  path: string;
  /** True when an identical logical verdict was already recorded (no write happened). */
  existed: boolean;
}

/**
 * Persist a verdict at its content address, write-if-absent (`wx` create-
 * exclusive). Validates on the way OUT so a writer bug never poisons the ledger
 * with a record the reader would reject.
 *
 * EEXIST is LOGICAL-IDENTITY DEDUP (`createdAt` excluded from the address; codex
 * fold 8 / agy fold 4): the existing record is loaded and its content hash
 * recomputed. If it matches this address (equal MODULO `createdAt`), the stored
 * record IS this save's outcome — first-write-wins, dedup return. If the record
 * at this address recomputes to a DIFFERENT hash, its bytes disagree with the
 * content address — a hard identity violation (a corrupted/tampered record or a
 * sha256 collision), never silently accepted.
 */
export function saveVerdictArtifact(
  totemDirAbs: string,
  artifact: VerdictArtifact,
): SaveVerdictArtifactResult {
  const validated = VerdictArtifactSchema.parse(artifact);
  const hash = computeVerdictArtifactContentHash(validated);
  const dir = verdictsDir(totemDirAbs);
  const filePath = path.join(dir, `${hash}.json`);

  fs.mkdirSync(dir, { recursive: true });
  try {
    // `wx` = atomic create-exclusive: the write fails EEXIST if a record already
    // occupies this address, so the identity-verification path below always sees
    // the durable record (no TOCTOU between a check and the write).
    fs.writeFileSync(filePath, JSON.stringify(validated, null, 2), {
      encoding: 'utf-8',
      mode: 0o600, // matches run/panel storage — verdicts reach masked prompt content one hop away
      flag: 'wx',
    });
  } catch (err) {
    if (err !== null && typeof err === 'object' && 'code' in err && err.code === 'EEXIST') {
      // Load + validate the incumbent, then verify it is the SAME logical verdict
      // modulo createdAt (its content hash must recompute back to this address).
      const existing = loadVerdictArtifact(totemDirAbs, hash);
      if (computeVerdictArtifactContentHash(existing) === hash) {
        return { hash, path: filePath, existed: true };
      }
      throw new TotemError(
        'DATABASE_MISMATCH',
        `Verdict artifact identity violation at ${filePath}: the record already stored at this content address does not match the verdict being saved (differs beyond createdAt).`,
        'This should be unreachable (content-addressed store). Investigate a corrupted/hand-edited verdict file or a hash collision before re-running.',
        err,
      );
    }
    throw err;
  }
  return { hash, path: filePath, existed: false };
}

/**
 * Load + validate a verdict by content address. Throws {@link TotemParseError}
 * on a missing file, corrupt JSON, schema violation, or an unknown major with
 * no migration entry — loud, never a silent partial (Tenet 4).
 */
export function loadVerdictArtifact(totemDirAbs: string, hash: string): VerdictArtifact {
  if (!Sha256HexSchema.safeParse(hash).success) {
    throw new TotemParseError(
      `Invalid verdict-artifact id "${hash}" — expected a 64-char sha256 hex content address.`,
      'Pass the hash exactly as reported at emission (or from the artifacts/verdicts/ filename).',
    );
  }
  const filePath = path.join(verdictsDir(totemDirAbs), `${hash}.json`);

  // Migration seam (F1): peek the major BEFORE strict validation so a known older
  // major routes through its migration. Empty registry ⇒ straight fall-through.
  const raw = readJsonSafe(filePath);
  const major = readMajor(raw);
  if (major !== undefined) {
    const migrate = MIGRATIONS.get(major);
    // Re-validate migrated output against the CURRENT schema before returning: a
    // migration's contract is to PRODUCE the current shape, so a migration bug must
    // fail loud here — never return it unvalidated.
    if (migrate !== undefined) return VerdictArtifactSchema.parse(migrate(raw));
  }

  try {
    return VerdictArtifactSchema.parse(raw);
    // totem-context: rethrowAsParseError always throws (returns `never`) — this catch
    // RE-throws via the shared helper, normalizing ZodError to the module's stated
    // TotemParseError load contract; nothing is swallowed.
  } catch (err) {
    rethrowAsParseError(
      `Verdict artifact ${hash} failed schema validation`,
      err,
      'The artifact may be corrupted or written by an incompatible totem version; re-emit it (or add the migration entry for its major).',
    );
  }
}

/**
 * Load every stored verdict under `artifacts/verdicts/`, validating each. A
 * missing directory yields `[]` (nothing has been written yet). Non-verdict file
 * names are skipped; a corrupt verdict file fails loud via {@link loadVerdictArtifact}.
 */
export function listVerdictArtifacts(totemDirAbs: string): VerdictArtifact[] {
  const dir = verdictsDir(totemDirAbs);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: VerdictArtifact[] = [];
  for (const name of names) {
    const match = VERDICT_FILE_RE.exec(name);
    if (match === null) continue;
    out.push(loadVerdictArtifact(totemDirAbs, match[1]));
  }
  return out;
}

/**
 * The latest verdict sharing `lineageKey` — highest `round.index`, ties broken
 * by latest `createdAt` (ISO strings sort chronologically). Returns `undefined`
 * when no verdict carries the key. Used for implicit round linkage (the next
 * round's `priorVerdictHash` = `computeVerdictArtifactContentHash` of this).
 */
export function findLatestVerdictForLineage(
  totemDirAbs: string,
  lineageKey: string,
): VerdictArtifact | undefined {
  const matching = listVerdictArtifacts(totemDirAbs).filter(
    (v) => v.round.lineageKey === lineageKey,
  );
  if (matching.length === 0) return undefined;
  matching.sort((a, b) => {
    if (b.round.index !== a.round.index) return b.round.index - a.round.index;
    return b.createdAt.localeCompare(a.createdAt);
  });
  return matching[0];
}

/** Best-effort major extraction from a raw parsed payload; undefined when absent/garbled. */
function readMajor(raw: unknown): number | undefined {
  if (typeof raw !== 'object' || raw === null || !('schemaVersion' in raw)) return undefined;
  const version = raw.schemaVersion;
  if (typeof version !== 'string') return undefined;
  const major = Number.parseInt(version.split('.')[0] ?? '', 10);
  return Number.isNaN(major) ? undefined : major;
}
