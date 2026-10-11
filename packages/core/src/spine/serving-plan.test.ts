// ─── The serving writer's planner (B2 of mmnto-ai/totem#3036, S6 step 2) ─────
//
// `planServingWrite` is PURE: it takes the serving file's plain rows, the
// authoring ledger, the ingested records and the validated input, and returns
// the new rows plus the row-level report. These tests pin the placement, the
// identity of every untouched row, the re-run fixpoint, the blocking-set report
// and every refusal the planner owns (mmnto-ai/totem#3045 folded in as the
// stale-floor refusal).

import { describe, expect, it } from 'vitest';
import { stringify as yamlStringify } from 'yaml';

import type { CompiledRule } from '../compiler-schema.js';
import type { AuthoringLedgerEntry } from './authoring-ledger.js';
import { compileRuleRecord } from './record-lower.js';
import { parseRuleRecord } from './rule-record.js';
import {
  assertServingInputSupported,
  planServingWrite,
  type ServingInput,
  ServingInputSchema,
  type ServingRecord,
} from './serving-plan.js';

const AS_OF = '2026-10-10T02:18:13.000Z';
const SHA = 'f'.repeat(64);

const LEGACY_A = 'aaaaaaaaaaaaaaaa';
const LEGACY_B = 'bbbbbbbbbbbbbbbb';
const ARCHIVE_C = 'cccccccccccccccc';
const ARCHIVED_D = 'dddddddddddddddd';
const CARRIED_E = 'eeeeeeeeeeeeeeee';

const RULE_A = '1111111111111111';
const RULE_B1 = '2222222222222222';
const RULE_B2 = '3333333333333333';
const RULE_N = '4444444444444444';

function recordText(opts: {
  sourceLesson?: string;
  engine: 'regex' | 'ast-grep';
  severity: 'error' | 'warning';
  requiresLine?: boolean;
}): string {
  const target =
    opts.engine === 'regex'
      ? { type: 'regex', pattern: 'forbiddenCall', scope: { fileGlobs: ['**/*.ts'] } }
      : {
          type: 'ast-grep',
          language: 'typescript',
          pattern: 'execSync($$$ARGS)',
          scope: { fileGlobs: ['**/*.ts'] },
        };
  return yamlStringify({
    schemaVersion: 1,
    severity: opts.severity,
    message: `A ${opts.engine} rule`,
    target,
    ...(opts.requiresLine ? { requires: { pattern: 'execFileSync', scope: 'line' } } : {}),
    examples: [
      opts.engine === 'regex'
        ? { bad: 'forbiddenCall();', good: 'allowedCall();' }
        : { bad: "execSync('git status');", good: "execFileSync('git', ['status']);" },
    ],
    ...(opts.sourceLesson !== undefined ? { curation: { sourceLesson: opts.sourceLesson } } : {}),
  });
}

function record(
  ruleId: string,
  path: string,
  opts: Parameters<typeof recordText>[0],
): ServingRecord {
  return {
    ruleId,
    path,
    contentHash: ruleId.slice(0, 1).repeat(64),
    parsed: parseRuleRecord(recordText(opts), path),
  };
}

function ledgerRow(rec: ServingRecord, authoredAt = '2026-09-23'): AuthoringLedgerEntry {
  // The planner reads ruleId, authoredAt and the record block only; the rest of
  // the §8 row is irrelevant to it and is cast past the type.
  return {
    ruleId: rec.ruleId,
    authoredAt,
    record: { path: rec.path, contentHash: rec.contentHash },
  } as unknown as AuthoringLedgerEntry;
}

function legacyRow(lessonHash: string, extra: Partial<CompiledRule> = {}): CompiledRule {
  return {
    lessonHash,
    lessonHeading: `Legacy ${lessonHash}`,
    pattern: 'dummy-never-matches',
    message: `Legacy ${lessonHash}`,
    engine: 'regex',
    compiledAt: '2026-01-01T00:00:00Z',
    ...extra,
  };
}

interface Fixture {
  rows: CompiledRule[];
  records: ServingRecord[];
  ledger: AuthoringLedgerEntry[];
  input: ServingInput;
}

function fixture(legacyRow_: 'archive' | 'remove' = 'archive'): Fixture {
  const recA = record(RULE_A, '.totem/rules/a.rule.yaml', {
    sourceLesson: `lesson-${LEGACY_A}`,
    engine: 'ast-grep',
    severity: 'error',
  });
  const recB1 = record(RULE_B1, '.totem/rules/b1.rule.yaml', {
    sourceLesson: `lesson-${LEGACY_B}`,
    engine: 'regex',
    severity: 'error',
  });
  const recB2 = record(RULE_B2, '.totem/rules/b2.rule.yaml', {
    sourceLesson: `lesson-${LEGACY_B}`,
    engine: 'regex',
    severity: 'warning',
  });
  const recN = record(RULE_N, '.totem/rules/n.rule.yaml', {
    engine: 'regex',
    severity: 'warning',
  });
  const records = [recA, recB1, recB2, recN];
  // A row whose keys are deliberately NOT in schema order: the planner must
  // carry it as the same object, untouched.
  const oddOrder = {
    message: 'Odd order',
    lessonHash: CARRIED_E,
    engine: 'ast-grep',
    lessonHeading: 'Odd order',
    pattern: '',
    astGrepPattern: 'foo($A)',
    compiledAt: '2026-01-01T00:00:00Z',
  } as CompiledRule;
  const rows: CompiledRule[] = [
    legacyRow(LEGACY_A),
    oddOrder,
    legacyRow(LEGACY_B, { engine: 'ast-grep', astGrepPattern: 'bar($A)', pattern: '' }),
    legacyRow(ARCHIVE_C),
    legacyRow(ARCHIVED_D, {
      status: 'archived',
      archivedReason: 'Stage 4 silenced it',
      archivedAt: '2026-02-02T00:00:00Z',
    }),
  ];
  const input: ServingInput = {
    schema: 'serving-input/1',
    asOf: AS_OF,
    source: 'a test fixture',
    dispositions: { legacyRow: legacyRow_, stamp: 'none' },
    floor: [
      { legacyHash: LEGACY_A, records: [{ path: recA.path, ruleId: RULE_A }] },
      {
        legacyHash: LEGACY_B,
        records: [
          { path: recB1.path, ruleId: RULE_B1 },
          { path: recB2.path, ruleId: RULE_B2 },
        ],
      },
      { records: [{ path: recN.path, ruleId: RULE_N }] },
    ],
    archive: [
      { lessonHash: ARCHIVE_C, reason: 'no-intent', ref: 'curation row 7' },
      { lessonHash: ARCHIVED_D, reason: 'no-intent', ref: 'curation row 8' },
    ],
  };
  return { rows, records, ledger: records.map((r) => ledgerRow(r)), input };
}

function plan(f: Fixture) {
  return planServingWrite({
    rows: f.rows,
    ledger: f.ledger,
    records: f.records,
    input: f.input,
    inputSha256: SHA,
  });
}

function lowered(rec: ServingRecord): CompiledRule {
  const out = compileRuleRecord(rec.parsed, { ruleId: rec.ruleId, now: AS_OF });
  if (out.kind !== 'compiled') throw new Error(out.reason);
  return out.rule;
}

describe('planServingWrite: lowering and placement (mmnto-ai/totem#3036 B2)', () => {
  it('a lowered row carries the ruleId as its lessonHash and deep-equals what compileRuleRecord returns for asOf', () => {
    const f = fixture();
    const result = plan(f);
    const row = result.rows.find((r) => r.lessonHash === RULE_A);
    expect(row).toBeDefined();
    expect(row).toEqual(lowered(f.records[0]!));
  });

  it('under archive the legacy row stays at its index, archived with a reason naming its record, and the lowered row follows it', () => {
    const f = fixture('archive');
    const result = plan(f);
    expect(result.rows[0]).toMatchObject({
      lessonHash: LEGACY_A,
      status: 'archived',
      archivedReason: `served by record ${RULE_A}`,
      archivedAt: AS_OF,
    });
    expect(result.rows[1]!.lessonHash).toBe(RULE_A);
    // The input row object itself is never mutated (the planner is pure).
    expect(f.rows[0]!.status).toBeUndefined();
  });

  it('under archive keeps an existing archivedAt (first transition owns it)', () => {
    const f = fixture('archive');
    f.rows[0] = legacyRow(LEGACY_A, { status: 'archived', archivedAt: '2026-03-03T00:00:00Z' });
    const result = plan(f);
    expect(result.rows[0]).toMatchObject({
      archivedReason: `served by record ${RULE_A}`,
      archivedAt: '2026-03-03T00:00:00Z',
    });
  });

  it('under remove the legacy row is gone and the lowered rows sit at its index', () => {
    const f = fixture('remove');
    const result = plan(f);
    const ids = result.rows.map((r) => r.lessonHash);
    expect(ids).toEqual([RULE_A, CARRIED_E, RULE_B1, RULE_B2, ARCHIVE_C, ARCHIVED_D, RULE_N]);
  });

  it('a two-record floor entry yields two rows from one legacy row, in record order, and the reason names both', () => {
    const f = fixture('archive');
    const result = plan(f);
    const ids = result.rows.map((r) => r.lessonHash);
    expect(ids).toEqual([
      LEGACY_A,
      RULE_A,
      CARRIED_E,
      LEGACY_B,
      RULE_B1,
      RULE_B2,
      ARCHIVE_C,
      ARCHIVED_D,
      RULE_N,
    ]);
    expect(result.rows[3]!.archivedReason).toBe(`served by records ${RULE_B1}, ${RULE_B2}`);
  });

  it('a floor entry with no legacyHash appends its lowered rows at the end, in floor order', () => {
    const f = fixture('archive');
    const result = plan(f);
    expect(result.rows[result.rows.length - 1]!.lessonHash).toBe(RULE_N);
  });

  it('an archive[] row is archived with `<reason> (<ref>)`; one already archived is the same object and reported', () => {
    const f = fixture('archive');
    const result = plan(f);
    const c = result.rows.find((r) => r.lessonHash === ARCHIVE_C)!;
    expect(c).toMatchObject({
      status: 'archived',
      archivedReason: 'no-intent (curation row 7)',
      archivedAt: AS_OF,
    });
    const d = result.rows.find((r) => r.lessonHash === ARCHIVED_D)!;
    expect(d).toBe(f.rows[4]);
    expect(result.report.rows).toContainEqual(
      expect.objectContaining({
        class: 'already-archived',
        action: 'none',
        lessonHash: ARCHIVED_D,
      }),
    );
  });

  it('every untouched row is the same object reference in the output', () => {
    const f = fixture('archive');
    const result = plan(f);
    expect(result.rows.find((r) => r.lessonHash === CARRIED_E)).toBe(f.rows[1]);
  });

  it('planning the result again with the same input reports no change and returns every row as the same object', () => {
    const f = fixture('archive');
    const first = plan(f);
    expect(first.changed).toBe(true);
    const second = planServingWrite({
      rows: first.rows,
      ledger: f.ledger,
      records: f.records,
      input: f.input,
      inputSha256: SHA,
    });
    expect(second.changed).toBe(false);
    second.rows.forEach((r, i) => expect(r).toBe(first.rows[i]));
  });

  it('the remove disposition is a fixpoint too: the legacy row is absent on the re-run and the lowered rows are already there', () => {
    const f = fixture('remove');
    const first = plan(f);
    const second = planServingWrite({
      rows: first.rows,
      ledger: f.ledger,
      records: f.records,
      input: f.input,
      inputSha256: SHA,
    });
    expect(second.changed).toBe(false);
  });
});

describe('planServingWrite: the report (mmnto-ai/totem#3036 B2)', () => {
  it('reports the blocking set before and after from isBlockingRule: the error ast-grep record joins it, the regex ones do not', () => {
    const f = fixture('archive');
    const { report } = plan(f);
    // Sorted hashes. Before: LEGACY_B and CARRIED_E are active ast-grep rows at the default severity.
    expect(report.blocking.before).toEqual([LEGACY_B, CARRIED_E]);
    // After: LEGACY_B is archived; RULE_A (ast-grep, error) joins; RULE_B1 (regex, error) does not.
    expect(report.blocking.after).toEqual([RULE_A, CARRIED_E]);
  });

  it('carries the input sha256 and asOf, the active and archived counts, and class counts that add up to the row counts', () => {
    const f = fixture('archive');
    const { report, rows } = plan(f);
    expect(report.inputSha256).toBe(SHA);
    expect(report.asOf).toBe(AS_OF);
    expect(report.rowsBefore).toBe(5);
    expect(report.rowsAfter).toBe(rows.length);
    expect(report.active).toEqual({ before: 4, after: 5 });
    expect(report.archived).toEqual({ before: 1, after: 4 });
    expect(report.totals).toEqual({
      'floor-legacy': 2,
      lowered: 4,
      archive: 1,
      'already-archived': 1,
      carried: 1,
    });
    const t = report.totals;
    expect(t.carried + t.archive + t['already-archived'] + t['floor-legacy'] + t.lowered).toBe(
      report.rowsAfter,
    );
  });

  it('under remove the class counts still add up: removed legacy rows count before, not after', () => {
    const f = fixture('remove');
    const { report } = plan(f);
    expect(report.rowsBefore).toBe(5);
    expect(report.rowsAfter).toBe(7);
    expect(report.removed).toBe(2);
    const t = report.totals;
    expect(t.carried + t.archive + t['already-archived'] + t.lowered).toBe(report.rowsAfter);
    expect(
      t.carried + t.archive + t['already-archived'] + t['floor-legacy'] + report.loweredExisting,
    ).toBe(report.rowsBefore);
  });
});

describe('planServingWrite: refusals, before any write (mmnto-ai/totem#3036 B2)', () => {
  it('refuses stamp: advisory (the mode is not built)', () => {
    const f = fixture();
    f.input.dispositions.stamp = 'advisory';
    expect(() => plan(f)).toThrow(/advisory/);
    expect(() => assertServingInputSupported(f.input)).toThrow(
      expect.objectContaining({ code: 'SERVING_INPUT_INVALID' }),
    );
  });

  it('refuses a floor record with no effective ledger row', () => {
    const f = fixture();
    f.ledger = f.ledger.filter((e) => e.ruleId !== RULE_A);
    expect(() => plan(f)).toThrow(
      expect.objectContaining({
        code: 'SERVING_RECORD_MISMATCH',
        message: expect.stringContaining(RULE_A),
      }),
    );
  });

  it('refuses a ledger row with no record block', () => {
    const f = fixture();
    f.ledger[0] = { ...f.ledger[0]!, record: undefined };
    expect(() => plan(f)).toThrow(
      expect.objectContaining({
        code: 'SERVING_RECORD_MISMATCH',
        message: expect.stringContaining('record block'),
      }),
    );
  });

  it('refuses a ledger row whose record.path differs from the floor path', () => {
    const f = fixture();
    f.ledger[0] = {
      ...f.ledger[0]!,
      record: { path: '.totem/rules/other.rule.yaml', contentHash: f.records[0]!.contentHash },
    };
    expect(() => plan(f)).toThrow(
      expect.objectContaining({
        code: 'SERVING_RECORD_MISMATCH',
        message: expect.stringContaining('other.rule.yaml'),
      }),
    );
  });

  it('refuses a record whose content hash differs from its ledger row', () => {
    const f = fixture();
    f.records[0] = { ...f.records[0]!, contentHash: '9'.repeat(64) };
    expect(() => plan(f)).toThrow(
      expect.objectContaining({
        code: 'SERVING_RECORD_MISMATCH',
        message: expect.stringContaining('content hash'),
      }),
    );
  });

  it('refuses a floor record whose effective ledger row was admitted the day after asOf (mmnto-ai/totem#3045)', () => {
    const f = fixture();
    f.ledger[0] = ledgerRow(f.records[0]!, '2026-10-11');
    expect(() => plan(f)).toThrow(
      expect.objectContaining({
        code: 'SERVING_FLOOR_STALE',
        message: expect.stringMatching(/2026-10-11.*2026-10-10T02:18:13.000Z/),
      }),
    );
  });

  it('passes a same-day re-admission: authoredAt is a date, so the check is necessary, not sufficient (the stated limit)', () => {
    const f = fixture();
    f.ledger[0] = ledgerRow(f.records[0]!, '2026-10-10');
    expect(() => plan(f)).not.toThrow();
  });

  it('refuses an authoredAt that does not parse', () => {
    const f = fixture();
    f.ledger[0] = ledgerRow(f.records[0]!, 'not a date');
    expect(() => plan(f)).toThrow(expect.objectContaining({ code: 'SERVING_FLOOR_STALE' }));
  });

  it('refuses a record the lowering rejects, with the lowering reason', () => {
    const f = fixture();
    f.records[0] = {
      ...f.records[0]!,
      parsed: parseRuleRecord(
        recordText({
          sourceLesson: `lesson-${LEGACY_A}`,
          engine: 'ast-grep',
          severity: 'error',
          requiresLine: true,
        }),
        f.records[0]!.path,
      ),
    };
    expect(() => plan(f)).toThrow(
      expect.objectContaining({
        code: 'COMPILE_FAILED',
        message: expect.stringContaining('requires.scope'),
      }),
    );
  });

  it('refuses a legacyHash that is not in the file', () => {
    const f = fixture();
    f.rows = f.rows.filter((r) => r.lessonHash !== LEGACY_A);
    expect(() => plan(f)).toThrow(
      expect.objectContaining({
        code: 'SERVING_INPUT_INVALID',
        message: expect.stringContaining(LEGACY_A),
      }),
    );
  });

  it('refuses an archive lessonHash that is not in the file', () => {
    const f = fixture();
    f.rows = f.rows.filter((r) => r.lessonHash !== ARCHIVE_C);
    expect(() => plan(f)).toThrow(
      expect.objectContaining({
        code: 'SERVING_INPUT_INVALID',
        message: expect.stringContaining(ARCHIVE_C),
      }),
    );
  });

  it('refuses a hash named in both the floor and archive lists', () => {
    const f = fixture();
    f.input.archive.push({ lessonHash: LEGACY_A, reason: 'no-intent', ref: 'x' });
    expect(() => plan(f)).toThrow(
      expect.objectContaining({
        code: 'SERVING_INPUT_INVALID',
        message: expect.stringContaining('both'),
      }),
    );
  });

  it('refuses a legacyHash that disagrees with the record curation.sourceLesson', () => {
    const f = fixture();
    f.records[0] = record(RULE_A, f.records[0]!.path, {
      sourceLesson: `lesson-${'0'.repeat(16)}`,
      engine: 'ast-grep',
      severity: 'error',
    });
    f.ledger[0] = ledgerRow(f.records[0]);
    expect(() => plan(f)).toThrow(
      expect.objectContaining({
        code: 'SERVING_INPUT_INVALID',
        message: expect.stringContaining('sourceLesson'),
      }),
    );
  });

  it('refuses a record-path row in the file that the floor does not name', () => {
    const f = fixture();
    f.rows.push({ ...legacyRow('9999999999999999'), examples: [{ bad: 'x', good: 'y' }] });
    expect(() => plan(f)).toThrow(
      expect.objectContaining({
        code: 'SERVING_INPUT_INVALID',
        message: expect.stringContaining('9999999999999999'),
      }),
    );
  });

  it('refuses a serving file that holds two rows with one lessonHash', () => {
    const f = fixture();
    f.rows.push(legacyRow(CARRIED_E));
    expect(() => plan(f)).toThrow(
      expect.objectContaining({
        code: 'PARSE_FAILED',
        message: expect.stringContaining(CARRIED_E),
      }),
    );
  });
});

describe('ServingInputSchema (mmnto-ai/totem#3036 B2)', () => {
  it('accepts the fixture input and refuses an unknown key, a missing disposition and a bad asOf', () => {
    const f = fixture();
    expect(ServingInputSchema.safeParse(f.input).success).toBe(true);
    expect(ServingInputSchema.safeParse({ ...f.input, extra: 1 }).success).toBe(false);
    expect(
      ServingInputSchema.safeParse({ ...f.input, dispositions: { legacyRow: 'archive' } }).success,
    ).toBe(false);
    expect(ServingInputSchema.safeParse({ ...f.input, asOf: 'yesterday' }).success).toBe(false);
    expect(
      ServingInputSchema.safeParse({
        ...f.input,
        floor: [{ legacyHash: LEGACY_A, records: [{ path: 'p', ruleId: RULE_A, extra: true }] }],
      }).success,
    ).toBe(false);
  });
});
