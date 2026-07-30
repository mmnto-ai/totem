import { describe, expect, it } from 'vitest';

import { LEDGER_EVENT_TYPES, QBD_EVENT_TYPES } from '../ledger.js';
import {
  computeQbdCompliance,
  formatQbdRate,
  groupQbdSessions,
  QBD_PRE_REGISTERED_THRESHOLD,
  QBD_PRE_REGISTERED_WINDOW_SESSIONS,
  QBD_PRE_REGISTRATION_STATEMENT,
  scanQbdLedger,
} from './compliance.js';
import { mintQbdCorrelationId } from './correlation-id.js';

const T0 = Date.parse('2026-07-28T12:00:00.000Z');

/** Deterministic distinct session UUIDs. */
function sid(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function queryLine(
  ms: number,
  sessionId?: string,
  agentSource?: string,
): { line: string; id: string } {
  const id = mintQbdCorrelationId(ms);
  return {
    id,
    line: JSON.stringify({
      timestamp: new Date(ms).toISOString(),
      type: 'corpus_query',
      activity_name: 'totem_search',
      source: 'lint',
      justification: '',
      qbd_correlation_id: id,
      ...(sessionId !== undefined && { session_id: sessionId }),
      ...(agentSource !== undefined && { agent_source: agentSource }),
    }),
  };
}

function deriveLine(
  ms: number,
  sessionId?: string,
  correlationId?: string,
  agentSource?: string,
): string {
  return JSON.stringify({
    timestamp: new Date(ms).toISOString(),
    type: 'derive_action',
    activity_name: 'spec',
    source: 'lint',
    justification: '',
    ...(correlationId !== undefined && { qbd_correlation_id: correlationId }),
    ...(sessionId !== undefined && { session_id: sessionId }),
    ...(agentSource !== undefined && { agent_source: agentSource }),
  });
}

describe('scanQbdLedger', () => {
  it('lifts QBD rows and ignores other subsystems’ rows without degrading', () => {
    const q = queryLine(T0, sid(1));
    const content = [
      JSON.stringify({
        timestamp: new Date(T0).toISOString(),
        type: 'suppress',
        ruleId: 'abc',
        file: 'a.ts',
        source: 'lint',
        justification: '',
      }),
      q.line,
      deriveLine(T0 + 1000, sid(1), q.id),
      '',
    ].join('\n');

    const scan = scanQbdLedger(content);
    expect(scan.rows).toHaveLength(2);
    expect(scan.degraded).toBe(false);
    expect(scan.linesScanned).toBe(3);
  });

  it('counts a torn JSON line per-item and degrades', () => {
    const q = queryLine(T0, sid(1));
    const content = [q.line, '{ not json', deriveLine(T0 + 1000, sid(1), q.id)].join('\n');

    const scan = scanQbdLedger(content);
    expect(scan.anomalies.malformedJson).toBe(1);
    expect(scan.degraded).toBe(true);
    expect(scan.anomalies.details.some((d) => d.includes('not valid JSON'))).toBe(true);
  });

  it('counts a BACKFILLED correlation row as a contract violation, not as data', () => {
    // A hand-edited ledger row: an ID minted an hour after the derive it is
    // attached to. The schema rejects it; the scan must COUNT that rejection
    // rather than let `readLedgerEvents`-style silent skipping hide it.
    const backfilled = mintQbdCorrelationId(T0 + 3_600_000);
    const content = [deriveLine(T0, sid(1), backfilled)].join('\n');

    const scan = scanQbdLedger(content);
    expect(scan.rows).toHaveLength(0);
    expect(scan.anomalies.correlationContractViolations).toBe(1);
    expect(scan.degraded).toBe(true);
  });

  it('does not CRASH on an out-of-range mint instant — counts it instead', () => {
    // `qbd1-zzzzzzzzzzz-<hex>` decodes to ~1.3e17, past the max Date value.
    // It used to pass the finite/non-negative guards, then reach
    // `new Date(...).toISOString()` while building a violation detail INSIDE
    // `LedgerEventSchema`'s refinement. Zod does not trap refinement throws, so
    // `safeParse` threw and one forged line killed the whole scan.
    const forged = `qbd1-zzzzzzzzzzz-${'a'.repeat(16)}`;
    const content = [
      JSON.stringify({
        timestamp: new Date(T0).toISOString(),
        type: 'derive_action',
        activity_name: 'spec',
        source: 'lint',
        justification: '',
        qbd_correlation_id: forged,
        session_id: sid(1),
      }),
      // A clean row after it: the scan must survive to reach this.
      deriveLine(T0 + 1000, sid(1)),
    ].join('\n');

    const scan = scanQbdLedger(content);
    expect(scan.anomalies.correlationContractViolations).toBe(1);
    expect(scan.degraded).toBe(true);
    // The following row was still scanned — the failure was contained.
    expect(scan.rows).toHaveLength(1);
  });

  it('is clean on an empty ledger', () => {
    const scan = scanQbdLedger('');
    expect(scan.rows).toHaveLength(0);
    expect(scan.degraded).toBe(false);
  });

  it('CATCHES a forged correlation ID smuggled onto a non-QBD event type', () => {
    // The scanner used to short-circuit on "this type belongs to another
    // subsystem" BEFORE testing for QBD markers, so a row that claimed
    // type `mcp_call` while carrying a `qbd_correlation_id` was dropped with
    // zero anomalies — a tampered ledger rendering perfectly clean. The QBD
    // marker test must win.
    const content = JSON.stringify({
      timestamp: new Date(T0).toISOString(),
      type: 'mcp_call',
      source: 'bot',
      justification: '',
      qbd_correlation_id: mintQbdCorrelationId(T0),
      session_id: sid(1),
    });

    const scan = scanQbdLedger(content);
    expect(scan.anomalies.correlationContractViolations).toBe(1);
    expect(scan.degraded).toBe(true);
  });

  it('leaves a schema-failed non-QBD row alone when it carries no QBD markers', () => {
    // Control for the test above: another subsystem's row failing its OWN
    // schema is not this metric's integrity problem.
    const content = JSON.stringify({
      timestamp: new Date(T0).toISOString(),
      type: 'suppress',
      source: 'lint',
      justification: '',
      ruleId: '', // invalid: min(1)
    });

    const scan = scanQbdLedger(content);
    expect(scan.anomalies.correlationContractViolations).toBe(0);
    expect(scan.anomalies.unclassifiedInvalid).toBe(0);
    expect(scan.degraded).toBe(false);
  });

  it('treats an unknown event type as ADVISORY version skew, not tampering', () => {
    // Polarity check: benign skew must not flip DEGRADED, or routine skew
    // drowns the signal that real tampering produces.
    const content = JSON.stringify({
      timestamp: new Date(T0).toISOString(),
      type: 'some_future_event_type',
      source: 'lint',
      justification: '',
    });

    const scan = scanQbdLedger(content);
    expect(scan.anomalies.unknownTypeRows).toBe(1);
    expect(scan.degraded).toBe(false);
    expect(scan.anomalies.details.some((d) => d.includes('version skew'))).toBe(true);
  });

  it('DEGRADES on backdated appends into an append-only ledger', () => {
    // The cheap attack on a "first N sessions" window: append rows stamped in
    // the past. Each row is individually contract-valid, so only cross-row
    // monotonicity can see it.
    const recent = queryLine(T0, sid(1));
    const backdatedMs = Date.parse('2019-01-01T00:00:00.000Z');
    const content = [
      recent.line,
      deriveLine(T0 + 1000, sid(1), recent.id),
      deriveLine(backdatedMs, sid(2)),
    ].join('\n');

    const scan = scanQbdLedger(content);
    expect(scan.anomalies.backdatedRows).toBe(1);
    expect(scan.degraded).toBe(true);
    // The backdated row is still COUNTED — dropping it would shrink the
    // denominator, which is the other failure mode.
    expect(scan.rows).toHaveLength(3);
  });

  it('DEGRADES on backdated QBD rows appended after NON-QBD-only history', () => {
    // The fresh-adopter state, which is exactly the state the pre-registered
    // first-20 window is filled from. The monotonicity reference used to advance
    // only on QBD rows, so a ledger whose history is all `suppress`/`mcp_call`
    // offered no baseline and 20 backdated pairs read PASS, degraded=false.
    // Existing non-QBD history IS the baseline.
    const suppressRow = JSON.stringify({
      timestamp: new Date(T0).toISOString(),
      type: 'suppress',
      ruleId: 'abc',
      file: 'a.ts',
      source: 'lint',
      justification: '',
    });
    const backdatedMs = Date.parse('2019-01-01T00:00:00.000Z');
    const q = queryLine(backdatedMs, sid(1));
    const content = [suppressRow, q.line, deriveLine(backdatedMs + 1000, sid(1), q.id)].join('\n');

    const scan = scanQbdLedger(content);
    expect(scan.anomalies.backdatedRows).toBeGreaterThan(0);
    expect(scan.degraded).toBe(true);
  });

  it('stays clean when QBD rows follow non-QBD history in order (control)', () => {
    const suppressRow = JSON.stringify({
      timestamp: new Date(T0).toISOString(),
      type: 'suppress',
      ruleId: 'abc',
      file: 'a.ts',
      source: 'lint',
      justification: '',
    });
    const q = queryLine(T0 + 1000, sid(1));
    const content = [suppressRow, q.line, deriveLine(T0 + 2000, sid(1), q.id)].join('\n');

    const scan = scanQbdLedger(content);
    expect(scan.anomalies.backdatedRows).toBe(0);
    expect(scan.degraded).toBe(false);
  });

  it('tolerates small out-of-order jitter from concurrent writers', () => {
    const q = queryLine(T0, sid(1));
    const content = [
      q.line,
      deriveLine(T0 + 1000, sid(1), q.id),
      deriveLine(T0 + 500, sid(1)),
    ].join('\n');
    const scan = scanQbdLedger(content);
    expect(scan.anomalies.backdatedRows).toBe(0);
    expect(scan.degraded).toBe(false);
  });
});

describe('ledger type parity', () => {
  it('derives the non-QBD type set from the schema instead of hand-mirroring it', () => {
    // A hand-copied list rots the moment a type is added to ledger.ts, and here
    // that rot changes a DEGRADED verdict. Pin the partition to the schema.
    //
    // The fixtures MUST be schema-INVALID (`ruleId: ''` fails `min(1)`).
    // `NON_QBD_TYPES` is consulted only inside the `!result.success` branch, so
    // rows that parse never reach it — an earlier version of this test used
    // valid rows and would have passed with the set emptied entirely.
    const qbd = new Set<string>(QBD_EVENT_TYPES);
    const expectedNonQbd = LEDGER_EVENT_TYPES.filter((t) => !qbd.has(t));

    for (const type of expectedNonQbd) {
      const row = JSON.stringify({
        timestamp: new Date(T0).toISOString(),
        type,
        source: 'lint',
        justification: '',
        ruleId: '',
        file: 'a.ts',
      });
      const scan = scanQbdLedger(row);
      // Recognised as another subsystem's row: skipped silently, NOT counted as
      // an unknown type and NOT counted as unclassifiable.
      expect(scan.anomalies.unknownTypeRows, `type '${type}' should be known`).toBe(0);
      expect(scan.anomalies.unclassifiedInvalid, `type '${type}' should be skipped`).toBe(0);
      expect(scan.degraded, `type '${type}' must not degrade`).toBe(false);
    }

    // And the two QBD types are exactly the metric's own.
    expect([...QBD_EVENT_TYPES].sort()).toEqual(['corpus_query', 'derive_action']);
  });

  it('flags a schema-invalid row whose type is NOT in the schema list', () => {
    // The discriminating control: if NON_QBD_TYPES were empty, the loop above
    // would still pass only if this also changed — pinning both directions.
    const row = JSON.stringify({
      timestamp: new Date(T0).toISOString(),
      type: 'not_a_real_type',
      source: 'lint',
      justification: '',
      ruleId: '',
    });
    const scan = scanQbdLedger(row);
    expect(scan.anomalies.unknownTypeRows).toBe(1);
  });
});

describe('read-side 1:1 enforcement (consume-on-use)', () => {
  it('refuses to credit several derives citing ONE query', () => {
    // The leg's exact probe. Before this, one query and three derives read as
    // compliance 1.00, degraded=false — because 1:1 was enforced only at write
    // time, where a failed/raced/bypassed pointer consume leaves it unenforced.
    const q = queryLine(T0, sid(1));
    const content = [
      q.line,
      deriveLine(T0 + 1000, sid(1), q.id),
      deriveLine(T0 + 2000, sid(1), q.id),
      deriveLine(T0 + 3000, sid(1), q.id),
    ].join('\n');

    const report = computeQbdCompliance(scanQbdLedger(content));
    // First derive earns the credit; the other two are anomalies.
    expect(report.window).toEqual({ derives: 3, correlated: 1 });
    expect(report.compliance).toBeCloseTo(1 / 3);
    expect(report.anomalies.duplicateCorrelations).toBe(2);
    expect(report.degraded).toBe(true);
  });

  it('credits the EARLIEST citation, not an arbitrary one', () => {
    const q = queryLine(T0, sid(1));
    const content = [
      q.line,
      deriveLine(T0 + 5000, sid(1), q.id),
      deriveLine(T0 + 1000, sid(1), q.id),
    ].join('\n');

    const report = computeQbdCompliance(scanQbdLedger(content));
    expect(report.window).toEqual({ derives: 2, correlated: 1 });
    expect(
      report.anomalies.details.some((d) => d.includes(new Date(T0 + 5000).toISOString())),
    ).toBe(true);
  });

  it('leaves a clean 1:1 ledger uncounted as duplicate (control)', () => {
    const q1 = queryLine(T0, sid(1));
    const q2 = queryLine(T0 + 2000, sid(1));
    const content = [
      q1.line,
      deriveLine(T0 + 1000, sid(1), q1.id),
      q2.line,
      deriveLine(T0 + 3000, sid(1), q2.id),
    ].join('\n');

    const report = computeQbdCompliance(scanQbdLedger(content));
    expect(report.window).toEqual({ derives: 2, correlated: 2 });
    expect(report.anomalies.duplicateCorrelations).toBe(0);
    expect(report.degraded).toBe(false);
  });
});

describe('seat-mismatch diagnostic', () => {
  it('hints when an uncorrelated derive had an in-window query from another seat', () => {
    // One-sided seat plumbing (seated CLI, unseated MCP server) produces a
    // truthful-looking 0.00 with no other tell. Surface it as a config smell.
    const q = queryLine(T0, sid(1), 'seat-a');
    const content = [q.line, deriveLine(T0 + 1000, sid(1), undefined, 'seat-b')].join('\n');

    const report = computeQbdCompliance(scanQbdLedger(content));
    expect(report.compliance).toBe(0);
    expect(report.anomalies.seatMismatchHints).toBe(1);
    // A config smell is NOT tampering — it must not degrade the read.
    expect(report.degraded).toBe(false);
  });

  it('does NOT hint when a same-seat query is also in the window', () => {
    // Mixed-seat window. The derive has a same-seat query available, so its
    // being uncorrelated has an ordinary explanation (spent pointer, different
    // session) and seat plumbing is not implicated. Flagging on the first
    // different-seat query found — which both this walk and the `.some()` it
    // replaced did — reported a config problem that was not there.
    const own = queryLine(T0, sid(1), 'seat-a');
    const other = queryLine(T0 + 500, sid(2), 'seat-b');
    const content = [own.line, other.line, deriveLine(T0 + 1000, sid(1), undefined, 'seat-a')].join(
      '\n',
    );

    const report = computeQbdCompliance(scanQbdLedger(content));
    expect(report.anomalies.seatMismatchHints).toBe(0);
  });

  it('hints when the ONLY in-window queries are from another seat', () => {
    // Same fixture minus the same-seat query — the genuine one-sided signature.
    const other = queryLine(T0 + 500, sid(2), 'seat-b');
    const content = [other.line, deriveLine(T0 + 1000, sid(1), undefined, 'seat-a')].join('\n');

    const report = computeQbdCompliance(scanQbdLedger(content));
    expect(report.anomalies.seatMismatchHints).toBe(1);
  });

  it('does not hint when both sides are unseated (the solo default)', () => {
    const q = queryLine(T0, sid(1));
    const content = [q.line, deriveLine(T0 + 1000, sid(1))].join('\n');

    const report = computeQbdCompliance(scanQbdLedger(content));
    expect(report.anomalies.seatMismatchHints).toBe(0);
  });
});

describe('computeQbdCompliance — denominator discipline (#2510 falsifier 1)', () => {
  it('counts derives from ZERO-QUERY sessions in the denominator', () => {
    const q = queryLine(T0, sid(1));
    const content = [
      // Session 1: queried, then derived → compliant.
      q.line,
      deriveLine(T0 + 1000, sid(1), q.id),
      // Session 2: derived twice, never queried → both count, neither compliant.
      deriveLine(T0 + 10_000, sid(2)),
      deriveLine(T0 + 11_000, sid(2)),
    ].join('\n');

    const report = computeQbdCompliance(scanQbdLedger(content));
    expect(report.window.derives).toBe(3);
    expect(report.window.correlated).toBe(1);
    expect(report.compliance).toBeCloseTo(1 / 3);
  });

  it('counts a zero-query session as an instrumented session (window level)', () => {
    // The operator-pinned window is "sessions carrying ≥1 derive-class event,
    // REGARDLESS OF QUERY COUNT". A query-less session must enter the window.
    const content = [deriveLine(T0, sid(1)), deriveLine(T0 + 1000, sid(2))].join('\n');
    const report = computeQbdCompliance(scanQbdLedger(content));
    expect(report.instrumentedSessions).toBe(2);
    expect(report.compliance).toBe(0);
  });

  it('does NOT count a session that only queried', () => {
    const q = queryLine(T0, sid(1));
    const report = computeQbdCompliance(scanQbdLedger(q.line));
    expect(report.instrumentedSessions).toBe(0);
    expect(report.compliance).toBeNull();
    expect(formatQbdRate(report.window)).toContain('n/a');
  });
});

describe('computeQbdCompliance — numerator integrity (#2510 falsifier 2)', () => {
  it('refuses to credit a derive citing a query row that does not exist', () => {
    const orphan = mintQbdCorrelationId(T0);
    const content = deriveLine(T0 + 1000, sid(1), orphan);

    const report = computeQbdCompliance(scanQbdLedger(content));
    expect(report.window).toEqual({ derives: 1, correlated: 0 });
    expect(report.anomalies.orphanCorrelations).toBe(1);
    expect(report.degraded).toBe(true);
  });

  it('refuses to credit a derive whose query came from another session', () => {
    const q = queryLine(T0, sid(1));
    const content = [q.line, deriveLine(T0 + 1000, sid(2), q.id)].join('\n');

    const report = computeQbdCompliance(scanQbdLedger(content));
    expect(report.window.correlated).toBe(0);
    expect(report.anomalies.crossSessionCorrelations).toBe(1);
    expect(report.degraded).toBe(true);
  });

  it('rejects — and SURFACES — a derive whose cited query came after it', () => {
    // This row is refused by the schema outright (the charter's "a backfilled ID
    // is a schema violation, not a data point"), so it never reaches the join
    // check. That removes it from the denominator too, which is precisely why
    // the rejection must be COUNTED and the scan marked degraded: a tampered
    // ledger may not quietly shrink the denominator and still render clean.
    const q = queryLine(T0 + 5000, sid(1));
    const content = [q.line, deriveLine(T0 + 1000, sid(1), q.id)].join('\n');

    const report = computeQbdCompliance(scanQbdLedger(content));
    expect(report.window.correlated).toBe(0);
    expect(report.anomalies.correlationContractViolations).toBe(1);
    expect(report.degraded).toBe(true);
    expect(report.anomalies.details.some((d) => d.includes('derive-id-minted-after-derive'))).toBe(
      true,
    );
  });
});

describe('computeQbdCompliance — the pre-registered threshold and window', () => {
  function sessionsWith(count: number, correlated: boolean): string {
    const lines: string[] = [];
    for (let i = 0; i < count; i++) {
      const ms = T0 + i * 86_400_000;
      if (correlated) {
        const q = queryLine(ms, sid(i));
        lines.push(q.line, deriveLine(ms + 1000, sid(i), q.id));
      } else {
        lines.push(deriveLine(ms, sid(i)));
      }
    }
    return lines.join('\n');
  }

  it('exposes the operator-pinned statement verbatim', () => {
    expect(QBD_PRE_REGISTRATION_STATEMENT).toBe(
      'compliance ≥ 0.50, evaluated over the first 20 instrumented sessions carrying ≥1 derive-class event, regardless of query count',
    );
    expect(QBD_PRE_REGISTERED_THRESHOLD).toBe(0.5);
    expect(QBD_PRE_REGISTERED_WINDOW_SESSIONS).toBe(20);
  });

  it('stays PENDING until the window fills', () => {
    const report = computeQbdCompliance(scanQbdLedger(sessionsWith(19, false)));
    expect(report.instrumentedSessions).toBe(19);
    expect(report.verdict).toBe('PENDING');
  });

  it('records FAIL when the filled window is below the floor', () => {
    const report = computeQbdCompliance(scanQbdLedger(sessionsWith(20, false)));
    expect(report.instrumentedSessions).toBe(20);
    expect(report.compliance).toBe(0);
    expect(report.verdict).toBe('FAIL');
  });

  it('records PASS when the filled window is at or above the floor', () => {
    const report = computeQbdCompliance(scanQbdLedger(sessionsWith(20, true)));
    expect(report.compliance).toBe(1);
    expect(report.verdict).toBe('PASS');
  });

  it('evaluates the FIRST 20 sessions, not the most recent 20', () => {
    // 20 uncorrelated sessions, then a 21st that is perfectly compliant. The
    // pre-registration is a fixed window: the late good session must not rescue
    // the verdict.
    const lines = sessionsWith(20, false).split('\n');
    const lateMs = T0 + 100 * 86_400_000;
    const q = queryLine(lateMs, sid(999));
    lines.push(q.line, deriveLine(lateMs + 1000, sid(999), q.id));

    const report = computeQbdCompliance(scanQbdLedger(lines.join('\n')));
    expect(report.instrumentedSessions).toBe(21);
    expect(report.evaluatedSessions).toBe(20);
    expect(report.window.derives).toBe(20);
    expect(report.compliance).toBe(0);
    expect(report.verdict).toBe('FAIL');
  });

  it('pins first-20 ordering from the other direction', () => {
    // Mirror image: 20 GOOD sessions first, then a bad 21st. Under a
    // `slice(-20)` bug this reads 19/20 instead of 20/20, so the two tests
    // together pin the window's direction rather than just its size.
    const lines = sessionsWith(20, true).split('\n');
    const lateMs = T0 + 100 * 86_400_000;
    lines.push(deriveLine(lateMs, sid(999)));

    const report = computeQbdCompliance(scanQbdLedger(lines.join('\n')));
    expect(report.instrumentedSessions).toBe(21);
    expect(report.evaluatedSessions).toBe(20);
    expect(report.window).toEqual({ derives: 20, correlated: 20 });
    expect(report.compliance).toBe(1);
    expect(report.verdict).toBe('PASS');
  });

  it('reports a trend once there are enough sessions on both sides', () => {
    const lines: string[] = [];
    // Two bad sessions, then two good ones.
    for (let i = 0; i < 2; i++) lines.push(deriveLine(T0 + i * 86_400_000, sid(i)));
    for (let i = 2; i < 4; i++) {
      const ms = T0 + i * 86_400_000;
      const q = queryLine(ms, sid(i));
      lines.push(q.line, deriveLine(ms + 1000, sid(i), q.id));
    }

    const report = computeQbdCompliance(scanQbdLedger(lines.join('\n')));
    expect(report.trend).not.toBeNull();
    expect(report.trend!.earlier).toEqual({ derives: 2, correlated: 0 });
    expect(report.trend!.recent).toEqual({ derives: 2, correlated: 2 });
  });

  it('withholds a trend below four instrumented sessions', () => {
    const report = computeQbdCompliance(scanQbdLedger(sessionsWith(3, false)));
    expect(report.trend).toBeNull();
  });
});

describe('session grouping', () => {
  it('never merges two SEATS into one rolling-window session', () => {
    // Cohort seats share one working tree, so both write to the same ledger
    // inside the same span. Merging them would put seat A's query in the same
    // session as seat B's derive.
    const rows = [
      { ms: T0, type: 'corpus_query' as const, agentSource: 'seat-a' },
      { ms: T0 + 1000, type: 'derive_action' as const, agentSource: 'seat-b' },
    ];
    const sessions = groupQbdSessions(rows);
    expect(sessions).toHaveLength(2);
  });

  it('refuses to credit a derive correlated to another SEAT’s query', () => {
    const q = queryLine(T0, sid(1), 'seat-a');
    const content = [q.line, deriveLine(T0 + 1000, sid(1), q.id, 'seat-b')].join('\n');

    const report = computeQbdCompliance(scanQbdLedger(content));
    expect(report.window.correlated).toBe(0);
    expect(report.anomalies.crossSessionCorrelations).toBe(1);
    expect(report.degraded).toBe(true);
  });

  it('rolls id-less rows into windows rather than dropping them', () => {
    const q = queryLine(T0);
    const content = [
      q.line,
      deriveLine(T0 + 1000, undefined, q.id),
      // Well outside the rolling window → a separate session.
      deriveLine(T0 + 10 * 60 * 60 * 1000),
    ].join('\n');

    const report = computeQbdCompliance(scanQbdLedger(content));
    expect(report.instrumentedSessions).toBe(2);
    expect(report.window).toEqual({ derives: 2, correlated: 1 });
  });
});

describe('formatQbdRate', () => {
  it('renders a rate with its raw counts', () => {
    expect(formatQbdRate({ derives: 4, correlated: 3 })).toBe('0.75 (3/4)');
  });

  it('never renders an empty denominator as 0%', () => {
    expect(formatQbdRate({ derives: 0, correlated: 0 })).toBe('n/a (0 derive-class events)');
  });
});
