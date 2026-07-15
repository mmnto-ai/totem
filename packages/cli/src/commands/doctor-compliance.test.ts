import { describe, expect, it } from 'vitest';

import {
  type CommitRecord,
  type ComplianceLogEntry,
  type ComplianceReport,
  computeCompliance,
  formatRate,
  parseSearchLog,
} from './doctor-compliance.js';

// ─── Fixture helpers (pure — no fs, no git, no temp dirs) ───

const H = 60 * 60 * 1000;
const MIN = 60 * 1000;
const BASE = Date.parse('2026-07-15T10:00:00.000Z');
const iso = (ms: number): string => new Date(ms).toISOString();

function entry(
  offsetMs: number,
  agent_source: string | null = null,
  session_id: string | null = null,
): ComplianceLogEntry {
  return { timestamp: iso(BASE + offsetMs), agent_source, session_id };
}

function commit(offsetMs: number, sha = `sha-${offsetMs}`): CommitRecord {
  return { sha, timestamp: iso(BASE + offsetMs) };
}

/** Coverage entry-count for a bucket (undefined when the bucket is absent). */
function coverage(report: ComplianceReport, name: string): number | undefined {
  return report.coverage.find((c) => c.bucket === name)?.entries;
}

/** Raw overall rate for the algebraic invariants (compliant / n). */
function rate(report: ComplianceReport): number {
  return report.overall.n === 0 ? 0 : report.overall.compliant / report.overall.n;
}

/** Invariant: the overall stat satisfies 0 ≤ compliant ≤ n (⇒ 0 ≤ rate ≤ 1). */
function assertRateBounds(report: ComplianceReport): void {
  expect(report.overall.n).toBeGreaterThanOrEqual(0);
  expect(report.overall.compliant).toBeGreaterThanOrEqual(0);
  expect(report.overall.compliant).toBeLessThanOrEqual(report.overall.n);
}

// ─── parseSearchLog ─────────────────────────────────────

describe('parseSearchLog', () => {
  it('empty log → no entries, no malformed', () => {
    expect(parseSearchLog('')).toEqual({ entries: [], malformedCount: 0 });
  });

  it('single-entry log parses one entry', () => {
    const line = JSON.stringify({ timestamp: iso(BASE), agent_source: 'claude' });
    const result = parseSearchLog(line);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.agent_source).toBe('claude');
    expect(result.malformedCount).toBe(0);
  });

  it('skips a corrupt JSONL line with a warn count, still parses the rest', () => {
    const good1 = JSON.stringify({ timestamp: iso(BASE), agent_source: 'claude' });
    const good2 = JSON.stringify({ timestamp: iso(BASE + H), agent_source: 'gemini' });
    const content = [good1, '{ this is not valid json', good2].join('\n');
    const result = parseSearchLog(content);
    expect(result.entries).toHaveLength(2);
    expect(result.malformedCount).toBe(1);
  });

  it('treats a line with a missing/unparseable timestamp as malformed', () => {
    const noTs = JSON.stringify({ agent_source: 'claude' });
    const badTs = JSON.stringify({ timestamp: 'not-a-date', agent_source: 'claude' });
    const result = parseSearchLog([noTs, badTs].join('\n'));
    expect(result.entries).toHaveLength(0);
    expect(result.malformedCount).toBe(2);
  });

  it('absent agent_source normalizes to null (→ unattributed at compute time)', () => {
    const line = JSON.stringify({ timestamp: iso(BASE) });
    const result = parseSearchLog(line);
    expect(result.entries[0]!.agent_source).toBeNull();
  });
});

// ─── computeCompliance — the merged-stream § 2 lock set ─

describe('computeCompliance', () => {
  it('search-only window (no commits) → excluded from the rate, surfaced', () => {
    const report = computeCompliance([entry(0, 'claude')], []);
    expect(report.overall.n).toBe(0);
    expect(report.searchOnlySessions).toBe(1);
    assertRateBounds(report);
  });

  it('commits with no preceding search → one non-compliant window', () => {
    const report = computeCompliance([], [commit(0), commit(30 * MIN)]);
    // Two commits 30m apart roll into one commit-only window.
    expect(report.overall).toEqual({ n: 1, compliant: 0 });
    assertRateBounds(report);
  });

  it('search before commit in one window → compliant', () => {
    const report = computeCompliance([entry(0, 'claude')], [commit(30 * MIN)]);
    expect(report.overall).toEqual({ n: 1, compliant: 1 });
    assertRateBounds(report);
  });

  it('clock skew (commit precedes the search in the same window) → non-compliant', () => {
    const report = computeCompliance([entry(0, 'claude')], [commit(-1 * H)]);
    expect(report.overall).toEqual({ n: 1, compliant: 0 });
    assertRateBounds(report);
  });

  it('equal search/commit timestamps do NOT credit ("preceded" per § 3 is strict)', () => {
    const report = computeCompliance([entry(0, 'claude')], [commit(0)]);
    expect(report.overall).toEqual({ n: 1, compliant: 0 });
    assertRateBounds(report);
  });

  it('§ 2 merged stream: an intervening commit EXTENDS the session', () => {
    // search t0 · commit +1.5h · commit +3h — each gap ≤ 2h through the merged
    // stream, so this is ONE session and the t0 search covers it (compliant).
    // Under search-only clustering with window-attach this would split; this
    // test locks the merged § 2 semantics (2026-07-15 panel fold).
    const report = computeCompliance([entry(0, 'claude')], [commit(90 * MIN), commit(180 * MIN)]);
    expect(report.overall).toEqual({ n: 1, compliant: 1 });
    expect(report.searchOnlySessions).toBe(0);
    assertRateBounds(report);
  });

  it('the same events WITHOUT the bridging commit split at the 2h gap', () => {
    // search t0 · commit +3h — the 3h gap splits the stream: a search-only
    // window plus a non-compliant commit-only window.
    const report = computeCompliance([entry(0, 'claude')], [commit(180 * MIN)]);
    expect(report.overall).toEqual({ n: 1, compliant: 0 });
    expect(report.searchOnlySessions).toBe(1);
    assertRateBounds(report);
  });

  it('UTC/ISO parsing discipline — offset and Z timestamps compare on the same instant', () => {
    const offsetSearch: ComplianceLogEntry = {
      timestamp: '2026-07-15T12:00:00+02:00', // = 10:00Z
      agent_source: 'claude',
      session_id: null,
    };
    const zCommit: CommitRecord = { sha: 'z', timestamp: '2026-07-15T10:30:00Z' };
    const report = computeCompliance([offsetSearch], [zCommit]);
    expect(report.overall).toEqual({ n: 1, compliant: 1 });
    assertRateBounds(report);
  });

  it('empty log + no commits → nothing counted', () => {
    const report = computeCompliance([], []);
    expect(report.overall).toEqual({ n: 0, compliant: 0 });
    expect(report.coverage).toEqual([]);
    assertRateBounds(report);
  });

  it('attribution does NOT change the repo-wide rate (identical timelines, different seats)', () => {
    // Commits carry no seat identity, so seat labels must be rate-inert: the
    // same instants produce the same overall stat whether entries are
    // attributed, mixed, or all unattributed.
    const times: Array<[number, string | null]> = [
      [0, 'claude'],
      [10 * MIN, 'gemini'],
      [15 * MIN, 'claude'],
      [130 * MIN, null],
    ];
    const commits = [commit(30 * MIN), commit(180 * MIN)];
    const attributed = computeCompliance(
      times.map(([ms, seat]) => entry(ms, seat)),
      commits,
    );
    const unattributed = computeCompliance(
      times.map(([ms]) => entry(ms, null)),
      commits,
    );
    expect(attributed.overall).toEqual(unattributed.overall);
    expect(attributed.searchOnlySessions).toBe(unattributed.searchOnlySessions);
    assertRateBounds(attributed);
  });

  it('coverage counts entries per seat; null lands in the unattributed bucket', () => {
    const report = computeCompliance(
      [entry(0, 'totem-claude'), entry(5 * MIN, 'totem-claude'), entry(10 * MIN, null)],
      [commit(30 * MIN)],
    );
    expect(coverage(report, 'totem-claude')).toBe(2);
    expect(coverage(report, 'unattributed')).toBe(1);
    expect(report.unattributedEntries).toBe(1);
    // Sorted by bucket name.
    expect(report.coverage.map((c) => c.bucket)).toEqual(['totem-claude', 'unattributed']);
  });

  it('session_id is deliberately inert in the windowing (no commit-side join exists)', () => {
    // Two searches sharing a session_id 5h apart do NOT bridge the 2h gap:
    // the stamp is a forward primitive for the commit-side join, not a
    // windowing input in the minimal slice (see the module header).
    const report = computeCompliance(
      [entry(0, 'claude', 'sid-1'), entry(5 * H, 'claude', 'sid-1')],
      [commit(30 * MIN)],
    );
    expect(report.overall).toEqual({ n: 1, compliant: 1 }); // first window: search+commit
    expect(report.searchOnlySessions).toBe(1); // the 5h-later search stands alone
    assertRateBounds(report);
  });
});

// ─── Algebraic invariants ───────────────────────────────

describe('algebraic invariants', () => {
  it('rate always sits in [0, 1] across a mixed fixture', () => {
    const entries: ComplianceLogEntry[] = [
      entry(0, 'claude'),
      entry(5 * H, 'claude'),
      entry(0, 'gemini'),
    ];
    const commits = [commit(30 * MIN), commit(4 * H), commit(10 * MIN)];
    assertRateBounds(computeCompliance(entries, commits));
  });

  it('adding a compliant session never lowers the rate', () => {
    // Base: one compliant window + one non-compliant commit-only window.
    const baseEntries: ComplianceLogEntry[] = [entry(0, 'claude')];
    const baseCommits = [commit(30 * MIN), commit(6 * H)];
    const before = computeCompliance(baseEntries, baseCommits);
    expect(rate(before)).toBeCloseTo(0.5, 5);

    // Add one clearly-compliant far-future window (search then commit).
    const afterEntries = [...baseEntries, entry(20 * H, 'claude')];
    const afterCommits = [...baseCommits, commit(20 * H + 30 * MIN)];
    const after = computeCompliance(afterEntries, afterCommits);

    expect(rate(after)).toBeGreaterThanOrEqual(rate(before));
    assertRateBounds(after);
  });
});

// ─── formatRate ─────────────────────────────────────────

describe('formatRate', () => {
  it('renders "insufficient data (n=x)" below the sample floor', () => {
    expect(formatRate({ n: 0, compliant: 0 })).toBe('insufficient data (n=0)');
    expect(formatRate({ n: 4, compliant: 4 })).toBe('insufficient data (n=4)');
  });

  it('renders a percentage at or above the sample floor (name stays "Compliance Rate")', () => {
    expect(formatRate({ n: 5, compliant: 4 })).toBe('80% (n=5)');
    expect(formatRate({ n: 10, compliant: 10 })).toBe('100% (n=10)');
    expect(formatRate({ n: 8, compliant: 0 })).toBe('0% (n=8)');
  });
});
