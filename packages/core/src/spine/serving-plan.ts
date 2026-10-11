// ─── The serving writer's planner (B2 of mmnto-ai/totem#3036, S6 step 2) ─────
//
// `totem rule serve <input.json>` lowers the records one input file names into
// `compiled-rules.json`, disposes of each floor rule's legacy row as the file
// says, and archives the rows the file's `archive[]` names. This module is the
// PURE half: no IO, no clock. It takes the serving file's rows as PLAIN parsed
// objects (never re-shaped through `CompiledRulesFileSchema`, which re-orders
// keys on some rows), the authoring ledger, the ingested records and the
// validated input, and returns the new rows plus a row-level report. The CLI
// library `serving-writer.ts` does the reads and the writes around it.
//
// Every refusal here is thrown before the caller writes anything.

import { z } from 'zod';

import { isActiveCompiledRule } from '../compiler.js';
import { AUTHORED_RULE_ID_RE, type CompiledRule } from '../compiler-schema.js';
import { TotemError, TotemParseError } from '../errors.js';
import { isBlockingRule } from '../rule-tier.js';
import { type AuthoringLedgerEntry, foldEffectiveLedgerEntries } from './authoring-ledger.js';
import { compileRuleRecord } from './record-lower.js';
import { isRecordPathRule } from './record-runtime.js';
import type { ParsedRuleRecord } from './rule-record.js';

// ─── The input file (`serving-input/1`) ─────────────────────────────────────

const LESSON_HASH_RE = /^[0-9a-f]{16}$/;

const lessonHash = (field: string) =>
  z.string().regex(LESSON_HASH_RE, { message: `${field} must be 16 lowercase hex characters` });

const nonEmpty = (field: string) => z.string().min(1, { message: `${field} must be non-empty` });

/**
 * The serving writer's input: one file, so one sha256 names a run. Strict at
 * every level: an unknown key anywhere is refused. Both dispositions are
 * required, with no default.
 */
export const ServingInputSchema = z
  .object({
    schema: z.literal('serving-input/1'),
    /** The `now` for every lowered row and for the manifest, so a re-run is byte-identical. */
    asOf: z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
      message: 'asOf must be an instant Date.parse accepts (ISO-8601)',
    }),
    /** Free text naming the runs of record and the ruling; not machine-read. */
    source: nonEmpty('source'),
    dispositions: z
      .object({
        legacyRow: z.enum(['archive', 'remove']),
        stamp: z.enum(['none', 'advisory']),
      })
      .strict(),
    floor: z.array(
      z
        .object({
          legacyHash: lessonHash('floor[].legacyHash').optional(),
          records: z
            .array(
              z
                .object({
                  path: nonEmpty('floor[].records[].path'),
                  ruleId: z.string().regex(AUTHORED_RULE_ID_RE, {
                    message:
                      'floor[].records[].ruleId must be a minted rule id (16 hex, optional -<n>)',
                  }),
                })
                .strict(),
            )
            .min(1),
        })
        .strict(),
    ),
    archive: z.array(
      z
        .object({
          lessonHash: lessonHash('archive[].lessonHash'),
          reason: nonEmpty('archive[].reason'),
          ref: nonEmpty('archive[].ref'),
        })
        .strict(),
    ),
  })
  .strict();

export type ServingInput = z.infer<typeof ServingInputSchema>;

/**
 * Refuse an input whose mode is not built. `stamp: 'advisory'` waits on the
 * ADR-110 reading; only `none` (unstamped) is implemented. Called by the writer
 * right after the schema check and again by the planner, so neither path can
 * reach a write with it.
 */
export function assertServingInputSupported(input: ServingInput): void {
  if (input.dispositions.stamp !== 'none') {
    throw new TotemError(
      'SERVING_INPUT_INVALID',
      `The serving input asks for dispositions.stamp '${input.dispositions.stamp}': the advisory stamp mode waits on the ADR-110 reading and is not built; nothing was written.`,
      "Set dispositions.stamp to 'none' in the input file.",
    );
  }
}

// ─── Planner types ──────────────────────────────────────────────────────────

/** One floor record, ingested by the caller (`ingestRecord`): its content hash and parsed value. */
export interface ServingRecord {
  path: string;
  ruleId: string;
  /** sha256 (64 hex) of the record file's LF image, as the intake computes it. */
  contentHash: string;
  parsed: ParsedRuleRecord;
}

export interface PlanServingWriteArgs {
  /** The serving file's rows, as plain parsed JSON. Never mutated. */
  rows: readonly CompiledRule[];
  /** The authoring ledger as read (all revisions); folded here to the effective row per ruleId. */
  ledger: readonly AuthoringLedgerEntry[];
  /** Every record the floor names, ingested. */
  records: readonly ServingRecord[];
  input: ServingInput;
  /** sha256 of the input file's bytes, carried into the report. */
  inputSha256: string;
}

export type ServingRowClass = 'floor-legacy' | 'lowered' | 'archive' | 'already-archived';
/**
 * `replace` is a lowered row already in the file at that ruleId whose lowering
 * now differs (a new asOf, say); `none` is a touched row whose bytes stay.
 */
export type ServingRowAction = 'archive' | 'remove' | 'insert' | 'replace' | 'none';

export interface ServingReportRow {
  class: ServingRowClass;
  action: ServingRowAction;
  lessonHash: string;
  /** For a lowered row and a floor legacy row: the floor entry's legacy hash, when it has one. */
  legacyHash?: string;
  /** For a lowered row: its rule id. For a floor legacy row: the record ids that serve it, joined by ', '. */
  ruleId?: string;
  /** For a lowered row: its record path. */
  recordPath?: string;
}

export interface ServingReport {
  inputSha256: string;
  asOf: string;
  legacyRow: ServingInput['dispositions']['legacyRow'];
  /** True when the planned rows serialize differently from the input rows; false means nothing to write. */
  changed: boolean;
  rows: ServingReportRow[];
  /** Report rows per class, plus every other row of the input file counted as `carried`. */
  totals: Record<ServingRowClass | 'carried', number>;
  rowsBefore: number;
  rowsAfter: number;
  /** Floor legacy rows removed under `remove` (counted in `rowsBefore`, absent from `rowsAfter`). */
  removed: number;
  /** Lowered rows already present in the input file (counted in `rowsBefore`). */
  loweredExisting: number;
  /** Rows `isActiveCompiledRule` counts. */
  active: { before: number; after: number };
  /** Rows with `status: 'archived'`. */
  archived: { before: number; after: number };
  /** Sorted lesson hashes of the ACTIVE rows `isBlockingRule` marks (lint loads active rows only). */
  blocking: { before: string[]; after: string[] };
}

export interface ServingPlan {
  rows: CompiledRule[];
  changed: boolean;
  report: ServingReport;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function inputInvalid(message: string, hint = 'Fix the input file, then re-run.'): TotemError {
  return new TotemError('SERVING_INPUT_INVALID', `${message}; nothing was written.`, hint);
}

function servedByReason(ruleIds: readonly string[]): string {
  return ruleIds.length === 1
    ? `served by record ${ruleIds[0]}`
    : `served by records ${ruleIds.join(', ')}`;
}

function serialize(row: unknown): string {
  return JSON.stringify(row, null, 2);
}

/**
 * Archive a row the way `totem lesson archive` does: `status` and
 * `archivedReason` set, `archivedAt` set only on the first transition. Returns
 * the SAME object when nothing would change, else a shallow copy (spread keeps
 * the existing key order; a new key appends, as an in-place assignment would).
 */
function archived(row: CompiledRule, reason: string, at: string): CompiledRule {
  if (row.status === 'archived' && row.archivedReason === reason && row.archivedAt) return row;
  const next: CompiledRule = { ...row, status: 'archived', archivedReason: reason };
  if (!next.archivedAt) next.archivedAt = at;
  return next;
}

function blockingSet(rows: readonly CompiledRule[]): string[] {
  return rows
    .filter((r) => isActiveCompiledRule(r) && isBlockingRule(r))
    .map((r) => r.lessonHash)
    .sort();
}

// ─── The planner ────────────────────────────────────────────────────────────

interface FloorEntryPlan {
  legacyHash?: string;
  ruleIds: string[];
  lowered: Array<{ rule: CompiledRule; recordPath: string }>;
}

/**
 * Plan one serving write. PURE: no IO, no clock (`input.asOf` is the `now`).
 *
 * Placement. Under `archive` a floor entry's legacy row stays at its index,
 * archived with a reason naming its record ids, and the lowered rows follow it
 * in the entry's record order; under `remove` the lowered rows replace it at its
 * index. An entry with no `legacyHash` appends its lowered rows at the end, in
 * floor order. An entry whose lowered rows are already in the file (a re-run)
 * keeps them where they are, so a second run with the same input is a fixpoint
 * that changes nothing.
 *
 * Untouched rows are the same object references in the output.
 */
export function planServingWrite(args: PlanServingWriteArgs): ServingPlan {
  const { rows, input } = args;
  assertServingInputSupported(input);
  const asOf = input.asOf;
  const asOfMs = Date.parse(asOf);
  if (Number.isNaN(asOfMs)) {
    throw inputInvalid(`The serving input's asOf '${asOf}' does not parse as an instant`);
  }

  // ── The serving file: one row per lessonHash ──
  const rowByHash = new Map<string, CompiledRule>();
  const duplicates = new Set<string>();
  for (const r of rows) {
    if (rowByHash.has(r.lessonHash)) duplicates.add(r.lessonHash);
    else rowByHash.set(r.lessonHash, r);
  }
  if (duplicates.size > 0) {
    throw new TotemParseError(
      `The serving file holds more than one row for lessonHash ${[...duplicates].join(', ')}; nothing was written.`,
      'Repair compiled-rules.json first (one row per lessonHash), for example by restoring it from git, then re-run.',
    );
  }

  // ── The input's own consistency ──
  const floorLegacy = new Set<string>();
  const floorRuleIds = new Set<string>();
  for (const entry of input.floor) {
    if (entry.legacyHash !== undefined) {
      if (floorLegacy.has(entry.legacyHash)) {
        throw inputInvalid(
          `The serving input names legacyHash ${entry.legacyHash} in more than one floor entry`,
        );
      }
      floorLegacy.add(entry.legacyHash);
    }
    for (const rec of entry.records) {
      if (floorRuleIds.has(rec.ruleId)) {
        throw inputInvalid(
          `The serving input names ruleId ${rec.ruleId} more than once in floor[]`,
        );
      }
      floorRuleIds.add(rec.ruleId);
    }
  }
  const archiveByHash = new Map<string, ServingInput['archive'][number]>();
  for (const a of input.archive) {
    if (archiveByHash.has(a.lessonHash)) {
      throw inputInvalid(
        `The serving input names archive lessonHash ${a.lessonHash} more than once`,
      );
    }
    if (floorLegacy.has(a.lessonHash)) {
      throw inputInvalid(
        `The serving input names ${a.lessonHash} in both floor[] (as a legacyHash) and archive[]`,
      );
    }
    archiveByHash.set(a.lessonHash, a);
  }

  // ── Every record-path row in the file must be one the floor names ──
  for (const r of rows) {
    if (isRecordPathRule(r) && !floorRuleIds.has(r.lessonHash)) {
      throw inputInvalid(
        `The serving file holds a record-path row ${r.lessonHash} that the serving input's floor does not name`,
        'Name its record in floor[], or remove the row deliberately, then re-run.',
      );
    }
  }
  // A lowered ruleId must not collide with a row that is not a record-path row.
  for (const id of floorRuleIds) {
    const existing = rowByHash.get(id);
    if (existing !== undefined && !isRecordPathRule(existing)) {
      throw inputInvalid(
        `The serving input's floor ruleId ${id} collides with a non-record row of the same lessonHash in the serving file`,
      );
    }
  }

  // ── Archive targets must be in the file ──
  for (const hash of archiveByHash.keys()) {
    if (!rowByHash.has(hash)) {
      throw inputInvalid(
        `The serving input's archive[] names lessonHash ${hash}, which is not in the serving file`,
      );
    }
  }

  // ── Each floor record against the ledger, then lowered ──
  const effective = new Map(foldEffectiveLedgerEntries(args.ledger).map((e) => [e.ruleId, e]));
  const recordById = new Map(args.records.map((r) => [r.ruleId, r]));
  const entries: FloorEntryPlan[] = [];
  for (const entry of input.floor) {
    const plan: FloorEntryPlan = {
      ...(entry.legacyHash !== undefined ? { legacyHash: entry.legacyHash } : {}),
      ruleIds: entry.records.map((r) => r.ruleId),
      lowered: [],
    };
    for (const ref of entry.records) {
      const row = effective.get(ref.ruleId);
      if (row === undefined) {
        throw new TotemError(
          'SERVING_RECORD_MISMATCH',
          `Floor record ${ref.path} (ruleId ${ref.ruleId}) has no effective authoring-ledger row; nothing was written.`,
          'Re-run the intake (`totem rule author`) so the record is admitted, or fix the ruleId in the input file.',
        );
      }
      if (row.record === undefined) {
        throw new TotemError(
          'SERVING_RECORD_MISMATCH',
          `The effective authoring-ledger row for ruleId ${ref.ruleId} has no record block (it predates the record path); nothing was written.`,
          'Re-run the intake (`totem rule author`) so the rule is admitted from its record, or fix the input file.',
        );
      }
      if (row.record.path !== ref.path) {
        throw new TotemError(
          'SERVING_RECORD_MISMATCH',
          `Floor record ${ref.path} (ruleId ${ref.ruleId}) differs from its effective ledger row's record.path ${row.record.path}; nothing was written.`,
          'Fix the path in the input file, or re-run the intake (`totem rule author`) if the record moved.',
        );
      }
      const rec = recordById.get(ref.ruleId);
      if (rec === undefined || rec.path !== ref.path) {
        throw new Error(
          `[Totem Error] planServingWrite: floor record ${ref.path} (ruleId ${ref.ruleId}) was not ingested by the caller — a caller bug.`,
        );
      }
      if (rec.contentHash !== row.record.contentHash) {
        throw new TotemError(
          'SERVING_RECORD_MISMATCH',
          `Record ${ref.path} (ruleId ${ref.ruleId}) has content hash ${rec.contentHash}, but its effective ledger row admitted ${row.record.contentHash}: the record was edited after admission; nothing was written.`,
          'Re-admit the record (`totem rule author`) and regenerate the floor file, or restore the admitted record bytes.',
        );
      }
      // mmnto-ai/totem#3045 — the stale-floor refusal. A record edited and
      // RE-ADMITTED after the floor file was built carries a new ledger row the
      // floor's scoring never saw. Measured limit: the live ledger writes
      // `authoredAt` as a DATE (2026-09-23, no time), which parses as 00:00:00Z,
      // so a same-day re-admission is NOT caught. The check is necessary, not
      // sufficient; the other half is the strategy lane's rule of conduct (a
      // re-admission is coupled to a re-scoring and a regenerated floor file).
      const authoredMs = Date.parse(row.authoredAt);
      if (Number.isNaN(authoredMs) || authoredMs > asOfMs) {
        throw new TotemError(
          'SERVING_FLOOR_STALE',
          Number.isNaN(authoredMs)
            ? `Floor record ${ref.path} (ruleId ${ref.ruleId}): its effective ledger row's authoredAt '${row.authoredAt}' does not parse, so the floor's asOf ${asOf} cannot be shown to postdate it; nothing was written.`
            : `Floor record ${ref.path} (ruleId ${ref.ruleId}) was admitted at ${row.authoredAt}, after the serving input's asOf ${asOf}: the floor predates the record it would lower; nothing was written.`,
          'Regenerate the floor file from the current ledger (and re-score the re-admitted record), then re-run.',
        );
      }
      if (entry.legacyHash !== undefined) {
        const source = rec.parsed.record.curation?.sourceLesson;
        if (source !== `lesson-${entry.legacyHash}`) {
          throw inputInvalid(
            `Floor entry legacyHash ${entry.legacyHash} disagrees with record ${ref.path}'s curation.sourceLesson (${source ?? 'absent'})`,
          );
        }
      }
      const outcome = compileRuleRecord(rec.parsed, { ruleId: ref.ruleId, now: asOf });
      if (outcome.kind === 'rejected') {
        throw new TotemError(
          'COMPILE_FAILED',
          `Record ${ref.path} (ruleId ${ref.ruleId}) is rejected by the lowering: ${outcome.reason}; nothing was written.`,
          `Fix the record (${outcome.reason}), re-admit it, and re-run.`,
        );
      }
      plan.lowered.push({ rule: outcome.rule, recordPath: ref.path });
    }
    // The legacy row must be in the file, unless this entry was already served
    // and its legacy row removed (a re-run under `remove`).
    if (entry.legacyHash !== undefined && !rowByHash.has(entry.legacyHash)) {
      const allPresent = plan.ruleIds.every((id) => rowByHash.has(id));
      if (!allPresent) {
        throw inputInvalid(
          `The serving input's floor names legacyHash ${entry.legacyHash}, which is not in the serving file`,
        );
      }
    }
    entries.push(plan);
  }

  // ── Placement ──
  const entryByLegacy = new Map<string, FloorEntryPlan>();
  const entryByRuleId = new Map<string, FloorEntryPlan>();
  for (const e of entries) {
    if (e.legacyHash !== undefined) entryByLegacy.set(e.legacyHash, e);
    for (const id of e.ruleIds) entryByRuleId.set(id, e);
  }
  const anchoredAtExisting = new Set<FloorEntryPlan>(
    entries.filter((e) => e.ruleIds.some((id) => rowByHash.has(id))),
  );
  const emitted = new Set<FloorEntryPlan>();
  const out: CompiledRule[] = [];
  const reportRows: ServingReportRow[] = [];
  let removed = 0;
  let loweredExisting = 0;

  const emitLowered = (e: FloorEntryPlan): void => {
    emitted.add(e);
    for (const { rule, recordPath } of e.lowered) {
      const existing = rowByHash.get(rule.lessonHash);
      let action: ServingRowAction = 'insert';
      let row: CompiledRule = rule;
      if (existing !== undefined) {
        loweredExisting++;
        if (serialize(existing) === serialize(rule)) {
          action = 'none';
          row = existing;
        } else {
          action = 'replace';
        }
      }
      out.push(row);
      reportRows.push({
        class: 'lowered',
        action,
        lessonHash: rule.lessonHash,
        ...(e.legacyHash !== undefined ? { legacyHash: e.legacyHash } : {}),
        ruleId: rule.lessonHash,
        recordPath,
      });
    }
  };

  for (const row of rows) {
    const legacyOf = entryByLegacy.get(row.lessonHash);
    if (legacyOf !== undefined) {
      const ids = legacyOf.ruleIds.join(', ');
      if (input.dispositions.legacyRow === 'archive') {
        const next = archived(row, servedByReason(legacyOf.ruleIds), asOf);
        out.push(next);
        reportRows.push({
          class: 'floor-legacy',
          action: next === row ? 'none' : 'archive',
          lessonHash: row.lessonHash,
          legacyHash: row.lessonHash,
          ruleId: ids,
        });
      } else {
        removed++;
        reportRows.push({
          class: 'floor-legacy',
          action: 'remove',
          lessonHash: row.lessonHash,
          legacyHash: row.lessonHash,
          ruleId: ids,
        });
      }
      if (!anchoredAtExisting.has(legacyOf)) emitLowered(legacyOf);
      continue;
    }
    const loweredOf = entryByRuleId.get(row.lessonHash);
    if (loweredOf !== undefined) {
      // An already-lowered row (a re-run): the entry's block is emitted at the
      // first such row; any later one is part of that block.
      if (!emitted.has(loweredOf)) emitLowered(loweredOf);
      continue;
    }
    const archiveEntry = archiveByHash.get(row.lessonHash);
    if (archiveEntry !== undefined) {
      if (row.status === 'archived') {
        out.push(row);
        reportRows.push({ class: 'already-archived', action: 'none', lessonHash: row.lessonHash });
      } else {
        out.push(archived(row, `${archiveEntry.reason} (${archiveEntry.ref})`, asOf));
        reportRows.push({ class: 'archive', action: 'archive', lessonHash: row.lessonHash });
      }
      continue;
    }
    out.push(row);
  }
  for (const e of entries) {
    if (!emitted.has(e)) emitLowered(e);
  }

  // ── The report ──
  const totals: ServingReport['totals'] = {
    'floor-legacy': 0,
    lowered: 0,
    archive: 0,
    'already-archived': 0,
    carried: 0,
  };
  for (const r of reportRows) totals[r.class]++;
  const touchedBefore =
    totals['floor-legacy'] + totals.archive + totals['already-archived'] + loweredExisting;
  totals.carried = rows.length - touchedBefore;
  const keptLegacy = totals['floor-legacy'] - removed;
  const sumAfter =
    totals.carried + totals.archive + totals['already-archived'] + keptLegacy + totals.lowered;
  if (sumAfter !== out.length) {
    throw new TotemError(
      'SERVING_INVARIANT_BROKEN',
      `The serving plan's class counts (${sumAfter}) do not add up to its row count (${out.length}); nothing was written.`,
      'This is a bug in the serving writer; report it with the input file.',
    );
  }

  const changed =
    out.length !== rows.length ||
    out.some((r, i) => r !== rows[i] && serialize(r) !== serialize(rows[i]));

  const report: ServingReport = {
    inputSha256: args.inputSha256,
    asOf,
    legacyRow: input.dispositions.legacyRow,
    changed,
    rows: reportRows,
    totals,
    rowsBefore: rows.length,
    rowsAfter: out.length,
    removed,
    loweredExisting,
    active: {
      before: rows.filter(isActiveCompiledRule).length,
      after: out.filter(isActiveCompiledRule).length,
    },
    archived: {
      before: rows.filter((r) => r.status === 'archived').length,
      after: out.filter((r) => r.status === 'archived').length,
    },
    blocking: { before: blockingSet(rows), after: blockingSet(out) },
  };
  return { rows: out, changed, report };
}
