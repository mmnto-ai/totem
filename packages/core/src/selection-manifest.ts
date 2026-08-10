/**
 * Per-seat selection manifests — the Prop 308 / strategy#467 M1 instrument
 * (mmnto-ai/totem#2468).
 *
 * A selection manifest is a read-only record of one selection event: which
 * candidates a consumer (session-start hook, `search_knowledge`, `totem
 * orient`) considered on a seat's behalf, which it selected or excluded, what
 * each cost, and the policy's own stated reason. It is a record of what each
 * policy did — never a ranker, and it never adjudicates between policies.
 *
 * ## Contract (binding, from the Prop 308 round + the armed #467 pre-registration)
 *
 * - **No shared relevance score, no common weights** (Prop 308 F1, unanimous;
 *   lc-codex refute condition). Both schema levels are `.strict()` so a shared
 *   score field cannot be added without failing parse of existing rows — the
 *   guard is structural, not a promise. Per-candidate `reason` strings carry
 *   each policy's OWN words (a floor value in a search reason is that policy's
 *   stated reason, not a common weight).
 * - **Senses, never gates** (Tenet 13). Emission must never block, filter, or
 *   alter a selection. Command call sites use {@link senseSelectionManifest};
 *   the throwing writer exists so the contract is testable and a programming
 *   error is never silent (the `qbd/record.ts` posture, mirrored).
 * - **Named cost basis** (#467 outcome 3's naming requirement): every figure
 *   names its aggregation — {@link SELECTION_COST_BASIS} is a fixed literal
 *   stamped on every row. What the manifest emits is a PAYLOAD-BYTE census
 *   with a declared token approximation; it is NOT the ruled `<total>` basis
 *   (measured cache-aware consumption), and whether it may substitute for a
 *   `<total>` surface is the pre-registration's call via versioned revision
 *   (#467 §9), never this module's claim.
 * - **No fabricated measurement:** a manifest records only what the policy
 *   observed. Candidates the policy never read (recency-excluded journals,
 *   first-match-losing proposals) are recorded id-only — no fingerprint, no
 *   bytes. Emitters never over-fetch to manufacture exclusions, which would
 *   alter the thing being measured.
 * - **Recorded absence, never silent skip** (the #2466 clause): the
 *   denominator lives in `events.ndjson` rows (`session_start`, `mcp_call`,
 *   `derive_action`) that ship independently of this instrument. A denominator
 *   row with no matching manifest row IS the recorded absence; a failed write
 *   additionally warns on the emitter's accounting channel.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { z } from 'zod';

import { TotemError } from './errors.js';
import { resolveQbdAgentSource } from './qbd/record.js';
import { readSessionId } from './session-id.js';

// ─── Constants ──────────────────────────────────────────

const LEDGER_DIR = 'ledger';

/**
 * Sidecar file, NOT rows in `events.ndjson` (ruled 2026-08-10, #2468 OQ1):
 * per-candidate arrays are bulky, and the event stream's existing consumers
 * (QBD scanner, stats) keep their scan economics. Same directory, same
 * append-only + gitignored conventions; growth is bounded the same way
 * `events.ndjson` is (janitorial rotation is a separate, pre-existing class).
 */
export const SELECTION_MANIFESTS_FILE = 'selection-manifests.ndjson';

/**
 * The named aggregation stamped on every row (#467 outcome-3 requirement:
 * a measure without its basis reports NOT OBSERVED — so the basis rides the
 * data). `bytes` is the UTF-8 byte length of the exact content the policy
 * considered; `approxTokens` is declared as the chars/4 approximation, never
 * presented as a measured token count.
 */
export const SELECTION_COST_BASIS = {
  bytes: 'utf8-length',
  approxTokens: 'ceil(bytes/4) approximation',
} as const;

/** Emitting consumers — the three selection surfaces named by #2468. */
export const SELECTION_EMITTERS = ['session-start', 'search_knowledge', 'orient'] as const;
export type SelectionEmitter = (typeof SELECTION_EMITTERS)[number];

// ─── Schema ─────────────────────────────────────────────

/**
 * One candidate the policy observed. `.strict()` — see the module contract:
 * no field can be added silently, which is the structural half of the Prop 308
 * refute-condition guard.
 */
export const SelectionCandidateSchema = z
  .object({
    /**
     * Candidate identity: repo-relative path or logical id. The coarse join
     * key for the overlap number — a whole-file fingerprint and a chunk
     * fingerprint of the same source will not collide, so cross-emitter joins
     * anchor on `id` first and use `fingerprint` for exactness. Join policy
     * belongs to the measurement pass, declared here rather than solved.
     */
    id: z.string().trim().min(1),
    /** Linked-repo origin for federated hits; absent for primary/local. */
    sourceRepo: z.string().trim().min(1).optional(),
    /**
     * sha256 hex, first 16 chars, over the EXACT bytes the policy considered.
     * Absent when the policy never read the content (id-only exclusion) or
     * when hashing failed (which also appends to `warnings` — an absent
     * fingerprint is honest, a fabricated one never is).
     */
    fingerprint: z
      .string()
      .regex(/^[0-9a-f]{16}$/)
      .optional(),
    /** UTF-8 byte length of the considered content. Absent on id-only rows. */
    bytes: z.number().int().nonnegative().optional(),
    /** ceil(bytes/4), under the declared approximation basis. */
    approxTokens: z.number().int().nonnegative().optional(),
    /**
     * What the policy did with this candidate. `truncated` = selected but
     * partially delivered (`deliveredBytes` carries what actually shipped).
     */
    disposition: z.enum(['selected', 'truncated', 'excluded']),
    /**
     * The policy's own stated reason — the why-selected / why-excluded half
     * that is invisible today. Free text owned by the emitting policy.
     */
    reason: z.string().trim().min(1),
    /** For `truncated` rows: bytes actually delivered after the cut. */
    deliveredBytes: z.number().int().nonnegative().optional(),
  })
  .strict()
  // Measured-candidate invariants (PR #2625 CR round): the builders produce
  // exactly two shapes — id-only (nothing measured) or fully measured — so
  // the schema refuses the partial states in between, and `deliveredBytes`
  // is meaningful only on a truncated row and can never exceed the full
  // measurement it was cut from.
  .superRefine((c, ctx) => {
    const measuredPresent = [c.fingerprint, c.bytes, c.approxTokens].filter(
      (v) => v !== undefined,
    ).length;
    if (measuredPresent !== 0 && measuredPresent !== 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'measured fields (fingerprint, bytes, approxTokens) travel together — a candidate is id-only or fully measured, never partial',
      });
    }
    if (c.deliveredBytes !== undefined) {
      if (c.disposition !== 'truncated') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['deliveredBytes'],
          message: 'deliveredBytes is only meaningful on a truncated candidate',
        });
      }
      if (c.bytes !== undefined && c.deliveredBytes > c.bytes) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['deliveredBytes'],
          message: 'deliveredBytes cannot exceed the full measured bytes',
        });
      }
    }
  });

export type SelectionCandidate = z.infer<typeof SelectionCandidateSchema>;

/**
 * The CLOSED set of per-emitter context keys. Closing the key space is the
 * context-layer half of the Prop 308 refute-condition guard (PR #2625 CR
 * round): with an open record, `context.sharedRelevanceScore` would have
 * parsed cleanly and the "no shared score without a schema change" claim held
 * only at the row/candidate layers. Adding a context key is now a deliberate
 * schema change, exactly like adding a field.
 */
export const SELECTION_CONTEXT_KEYS = [
  // search_knowledge
  'query',
  'boundary',
  'typeFilter',
  'floor',
  'finalLimit',
  'method',
  'status',
  'storesFailed',
  'storesUnavailable',
  // orient
  'render',
  // session-start (V2 hook + published templates)
  'branch',
  'ticket',
  'selfAgent',
  'template',
] as const;

export type SelectionContextKey = (typeof SELECTION_CONTEXT_KEYS)[number];

/**
 * Per-emitter context: a FLAT scalar map over the closed key set. Flat by
 * design — a nested structure is where a shared relevance model would grow,
 * and the schema refuses it room; closed-keyed so it cannot grow one either.
 */
const SelectionContextSchema = z.record(
  z.enum(SELECTION_CONTEXT_KEYS),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

/** One selection event — one NDJSON row in `selection-manifests.ndjson`. */
export const SelectionManifestRowSchema = z
  .object({
    schemaVersion: z.literal(1),
    /** ISO 8601 instant of the selection event. */
    timestamp: z.string().datetime(),
    emitter: z.enum(SELECTION_EMITTERS),
    /** Session UUID from `.totem/ledger/.session-id` — the denominator join key. */
    session_id: z.string().uuid().optional(),
    /** Seat id from TOTEM_SELF_AGENT (ADR-078). Absent = stamped absence, never guessed. */
    agent_source: z.string().trim().min(1).optional(),
    /** Emitting package version, when the emitter can resolve it cheaply. */
    cli_version: z.string().trim().min(1).optional(),
    context: SelectionContextSchema,
    /**
     * Names the observable candidate pool (e.g. `store-returned-pool
     * perStoreLimit=5`) — the honest boundary: exclusions are recorded only
     * over candidates the emitter actually saw.
     */
    universe: z.string().trim().min(1),
    costBasis: z
      .object({
        bytes: z.literal(SELECTION_COST_BASIS.bytes),
        approxTokens: z.literal(SELECTION_COST_BASIS.approxTokens),
      })
      .strict(),
    /**
     * The session-start hook's global char slice — string-level, so its cut
     * is NOT attributed per-candidate (declared limitation, not a gap).
     */
    finalTruncation: z
      .object({
        cap: z.number().int().positive(),
        totalChars: z.number().int().nonnegative(),
        applied: z.boolean(),
      })
      .strict()
      .optional(),
    candidates: z.array(SelectionCandidateSchema),
    /** Per-row accounting: every non-fatal degradation names itself here. */
    warnings: z.array(z.string()),
  })
  .strict();

export type SelectionManifestRow = z.infer<typeof SelectionManifestRowSchema>;

// ─── Measurement helpers ────────────────────────────────

/**
 * Fingerprint the exact bytes a policy considered: sha256 hex, first 16.
 * 64 bits of collision resistance is ample for a per-workspace corpus join
 * key; the full digest would double every row's bulk for no analytical gain.
 */
export function fingerprintContent(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/** Cost of a considered candidate under {@link SELECTION_COST_BASIS}. */
export function measureCandidateCost(content: string | Buffer): {
  bytes: number;
  approxTokens: number;
} {
  const bytes = typeof content === 'string' ? Buffer.byteLength(content, 'utf-8') : content.length;
  return { bytes, approxTokens: Math.ceil(bytes / 4) };
}

/**
 * Build a fully-measured candidate from content the policy actually read.
 *
 * TOTAL over its input space (leg round 1, H-7): a non-string/non-Buffer
 * `content` (a store row whose unchecked cast lied) or a hash failure
 * degrades to an ID-ONLY row with the failure named on the returned warning —
 * it never throws into the emitting command, and it never persists a
 * fabricated or NaN measurement.
 */
export function buildMeasuredCandidate(input: {
  id: string;
  content: string | Buffer;
  disposition: SelectionCandidate['disposition'];
  reason: string;
  sourceRepo?: string;
  deliveredBytes?: number;
}): { candidate: SelectionCandidate; warning?: string } {
  const idOnly: SelectionCandidate = {
    id: input.id,
    disposition: input.disposition,
    reason: input.reason,
    ...(input.sourceRepo !== undefined && { sourceRepo: input.sourceRepo }),
    ...(input.deliveredBytes !== undefined && { deliveredBytes: input.deliveredBytes }),
  };
  const content: unknown = input.content;
  if (typeof content !== 'string' && !Buffer.isBuffer(content)) {
    return {
      candidate: idOnly,
      warning: `selection-manifest: unmeasurable content for ${input.id} (got ${typeof content}) — recorded id-only`,
    };
  }
  try {
    const { bytes, approxTokens } = measureCandidateCost(content);
    return {
      candidate: { ...idOnly, bytes, approxTokens, fingerprint: fingerprintContent(content) },
    };
    // totem-context: intentional degradation — a measurement/hash failure records the candidate ID-ONLY and names the failure on the accounting channel; fabricating or dropping the row would both lie (Tenet 13).
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      candidate: idOnly,
      warning: `selection-manifest: measurement failed for ${input.id}: ${msg} — recorded id-only`,
    };
  }
}

// ─── Row assembly ───────────────────────────────────────

export interface SelectionManifestInput {
  /** Absolute path to the resolved `.totem` directory. */
  totemDir: string;
  emitter: SelectionEmitter;
  context: Partial<Record<SelectionContextKey, string | number | boolean | null>>;
  universe: string;
  candidates: SelectionCandidate[];
  warnings?: string[];
  finalTruncation?: { cap: number; totalChars: number; applied: boolean };
  cliVersion?: string;
  /** Test seam — production callers omit and the writer reads the clock. */
  nowMs?: number;
  /** Test seam — production callers omit and the writer reads `process.env`. */
  env?: NodeJS.ProcessEnv;
  /**
   * Session UUID override for emitters that minted the id themselves (the
   * session-start hooks). When absent, the id is read from the
   * `.totem/ledger/.session-id` pointer.
   */
  sessionId?: string;
}

export interface SelectionManifestResult {
  /** True when the manifest row reached disk. */
  written: boolean;
  /**
   * True when nothing was recorded because this is not an instrumented
   * project (no `.totem` directory) — a normal state, not a degradation.
   */
  skipped?: boolean;
  warnings: string[];
}

/**
 * Is this an instrumented project at all? Same convention as
 * `qbd/record.ts`: an absent `.totem` (ENOENT, or ENOTDIR — a path component
 * being a file, the cross-platform divergence `session-id.ts` documents) is
 * the honest "nothing here to instrument" state — skip silently rather than
 * materialising a stray `.totem/ledger/` in whatever cwd an instrumented
 * command ran from. Every OTHER errno (EACCES, I/O) is a real probe failure
 * that must not masquerade as not-a-project (PR #2625 CR round): it returns a
 * named warning so the skip lands on the accounting channel.
 */
function probeInstrumentedProject(totemDir: string): { instrumented: boolean; warning?: string } {
  try {
    return { instrumented: fs.statSync(totemDir).isDirectory() };
    // totem-context: intentional degradation — a missing `.totem` is the honest "not a Totem project" state; any OTHER errno is reported via the returned warning (the accounting channel), never swallowed.
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null ? (err as NodeJS.ErrnoException).code : undefined;
    if (code === 'ENOENT' || code === 'ENOTDIR') return { instrumented: false };
    const msg = err instanceof Error ? err.message : String(err);
    return {
      instrumented: false,
      warning: `selection-manifest: .totem probe failed (${msg}) — not recording`,
    };
  }
}

/** Stamp attribution + basis onto an emitter's assembled input. */
export function buildSelectionManifestRow(input: SelectionManifestInput): SelectionManifestRow {
  const env = input.env ?? process.env;
  const nowMs = input.nowMs ?? Date.now();
  // An emitter that MINTED the session id this event belongs to passes it
  // directly (the session-start hooks) — immune to the shared-pointer being
  // rotated by a concurrent session between mint and emission (PR #2625 CR
  // round, partial). Everyone else joins via the pointer.
  const sessionId = input.sessionId ?? readSessionId(input.totemDir);
  const agentSource = resolveQbdAgentSource(env);
  return {
    schemaVersion: 1,
    timestamp: new Date(nowMs).toISOString(),
    emitter: input.emitter,
    ...(sessionId !== undefined && { session_id: sessionId }),
    ...(agentSource !== undefined && { agent_source: agentSource }),
    ...(input.cliVersion !== undefined && { cli_version: input.cliVersion }),
    context: input.context,
    universe: input.universe,
    costBasis: { ...SELECTION_COST_BASIS },
    ...(input.finalTruncation !== undefined && { finalTruncation: input.finalTruncation }),
    candidates: input.candidates,
    warnings: input.warnings ?? [],
  };
}

// ─── Writers ────────────────────────────────────────────

/**
 * Validate and append one manifest row.
 *
 * Throws `SELECTION_MANIFEST_CONTRACT` on a schema-invalid row — that is a
 * programming error in an emitter, and persisting it would hand the
 * measurement pass a row `readSelectionManifests` silently skips (data loss
 * dressed as data). I/O failures do not throw; they report through the
 * returned `warnings` (the accounting channel).
 */
export function appendSelectionManifest(input: SelectionManifestInput): SelectionManifestResult {
  const warnings: string[] = [...(input.warnings ?? [])];

  const probe = probeInstrumentedProject(input.totemDir);
  if (!probe.instrumented) {
    if (probe.warning !== undefined) warnings.push(probe.warning);
    return { written: false, skipped: true, warnings };
  }

  const row = buildSelectionManifestRow({ ...input, warnings });
  const parsed = SelectionManifestRowSchema.safeParse(row);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new TotemError(
      'SELECTION_MANIFEST_CONTRACT',
      `Refusing to write a selection-manifest row that violates the schema: ${detail}`,
      'This is an emitter programming error — the manifest schema is strict by contract (Prop 308 F1 refute-condition guard); fix the emitter rather than widening the schema.',
    );
  }

  let written = true;
  try {
    const ledgerDir = path.join(input.totemDir, LEDGER_DIR);
    fs.mkdirSync(ledgerDir, { recursive: true });
    fs.appendFileSync(
      path.join(ledgerDir, SELECTION_MANIFESTS_FILE),
      JSON.stringify(parsed.data) + '\n',
      'utf-8',
    );
    // totem-context: intentional degradation — the manifest is telemetry; an I/O failure is recorded on the `warnings` accounting channel and the absence stays detectable via the denominator ledger rows (never a silent skip).
  } catch (err) {
    written = false;
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`selection-manifest: append failed: ${msg}`);
  }
  return { written, warnings };
}

/**
 * Sensor-safe `appendSelectionManifest` — command call sites use this.
 * Every degradation, including a thrown contract breach, surfaces through
 * `onWarn`; there is no path that discards a failure silently, and no path
 * that fails the instrumented command (Tenet 13).
 */
/**
 * Deliver a warning to the caller's sink without letting the sink's own
 * failure escape — an accounting-channel exception altering the instrumented
 * command would invert Tenet 13 at the last step (PR #2625 CR round).
 */
function safeWarn(onWarn: ((msg: string) => void) | undefined, msg: string): void {
  try {
    onWarn?.(msg);
    // totem-context: intentional swallow — a throwing warning SINK must not fail the instrumented command; the warning also remains in the returned `warnings` array, so nothing is lost.
  } catch (err) {
    void err;
  }
}

export function senseSelectionManifest(
  input: SelectionManifestInput,
  onWarn?: (msg: string) => void,
): SelectionManifestResult {
  try {
    const result = appendSelectionManifest(input);
    for (const warning of result.warnings) safeWarn(onWarn, warning);
    return result;
    // totem-context: instrumentation is a sensor — a telemetry failure must never fail the instrumented command (Tenet 13); the failure is reported through onWarn, never discarded.
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const warning = `selection-manifest sensor failed: ${msg}`;
    safeWarn(onWarn, warning);
    return { written: false, warnings: [warning] };
  }
}

/**
 * Read all manifest rows, skipping schema-invalid lines (the generic-consumer
 * convention shared with `readLedgerEvents`; a measurement pass that must
 * count rejects reads the file raw — same division of labor as QBD's
 * compliance scanner).
 */
export function readSelectionManifests(
  totemDir: string,
  onWarn?: (msg: string) => void,
): SelectionManifestRow[] {
  const filePath = path.join(totemDir, LEDGER_DIR, SELECTION_MANIFESTS_FILE);
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
    // totem-context: intentional degradation — ENOENT is the normal no-manifests-yet state; every other read failure is REPORTED through onWarn (the accounting channel), never swallowed, and the reader degrades to empty rather than failing its caller (Tenet 13 sensor posture, mirroring readLedgerEvents).
  } catch (err) {
    const code =
      typeof err === 'object' && err !== null ? (err as NodeJS.ErrnoException).code : undefined;
    if (code === 'ENOENT') return [];
    const msg = err instanceof Error ? err.message : String(err);
    onWarn?.(`selection-manifest read failed: ${msg}`);
    return [];
  }
  const rows: SelectionManifestRow[] = [];
  let malformed = 0;
  for (const line of content.split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = SelectionManifestRowSchema.safeParse(JSON.parse(line));
      if (parsed.success) rows.push(parsed.data);
      // totem-context: intentional skip of malformed lines — generic consumers mirror readLedgerEvents; the AGGREGATE count is reported through onWarn below, and reject-counting consumers read the file raw by contract.
    } catch (err) {
      void err;
      malformed += 1;
    }
  }
  // One aggregate line, not one per row — a torn or hand-edited file must not
  // turn the accounting channel into a firehose (PR #2625 CR round).
  if (malformed > 0) {
    onWarn?.(
      `selection-manifest: skipped ${malformed} malformed line(s) — reject-counting consumers read the file raw`,
    );
  }
  return rows;
}
