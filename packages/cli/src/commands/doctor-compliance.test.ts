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

/** Look up a bucket's stat by name (undefined when the bucket has no counted sessions). */
function bucket(report: ComplianceReport, name: string) {
  return report.buckets.find((b) => b.bucket === name)?.stat;
}

/** Raw overall rate for the algebraic invariants (compliant / n). */
function rate(report: ComplianceReport): number {
  return report.overall.n === 0 ? 0 : report.overall.compliant / report.overall.n;
}

/** Invariant: every stat satisfies 0 ≤ compliant ≤ n (⇒ 0 ≤ rate ≤ 1). */
function assertRateBounds(report: ComplianceReport): void {
  const stats = [report.overall, ...report.buckets.map((b) => b.stat)];
  for (const s of stats) {
    expect(s.n).toBeGreaterThanOrEqual(0);
    expect(s.compliant).toBeGreaterThanOrEqual(0);
    expect(s.compliant).toBeLessThanOrEqual(s.n);
  }
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

// ─── computeCompliance — the lock set ───────────────────

describe('computeCompliance', () => {
  it('search-only session (no commits after) → excluded from the rate', () => {
    const report = computeCompliance([entry(0, 'claude')], []);
    expect(report.overall.n).toBe(0);
    expect(report.searchOnlySessions).toBe(1);
    expect(report.buckets).toEqual([]);
    assertRateBounds(report);
  });

  it('commits with no preceding search → non-compliant baseline in the unattributed bucket', () => {
    const report = computeCompliance([], [commit(0), commit(30 * MIN)]);
    // Two commits 30m apart cluster into one commit-only session.
    const u = bucket(report, 'unattributed');
    expect(u).toEqual({ n: 1, compliant: 0 });
    expect(report.overall).toEqual({ n: 1, compliant: 0 });
    assertRateBounds(report);
  });

  it('clock skew (search after commit) → non-compliant', () => {
    // search at BASE, commit an hour earlier (still inside the session window).
    const report = computeCompliance([entry(0, 'claude')], [commit(-1 * H)]);
    expect(bucket(report, 'claude')).toEqual({ n: 1, compliant: 0 });
    assertRateBounds(report);
  });

  it('UTC/ISO parsing discipline — offset and Z timestamps compare on the same instant', () => {
    // Search written with a +02:00 offset that equals BASE (10:00Z); commit 30m later in Z.
    const offsetSearch: ComplianceLogEntry = {
      timestamp: '2026-07-15T12:00:00+02:00',
      agent_source: 'claude',
      session_id: null,
    };
    const zCommit: CommitRecord = { sha: 'z', timestamp: '2026-07-15T10:30:00Z' };
    const report = computeCompliance([offsetSearch], [zCommit]);
    // Search instant (10:00Z) precedes commit instant (10:30Z) → compliant.
    expect(bucket(report, 'claude')).toEqual({ n: 1, compliant: 1 });
    assertRateBounds(report);
  });

  it('empty log → nothing counted', () => {
    const report = computeCompliance([], []);
    expect(report.overall).toEqual({ n: 0, compliant: 0 });
    expect(report.buckets).toEqual([]);
    assertRateBounds(report);
  });

  it('single-entry log (one search, no commit) → search-only, nothing counted', () => {
    const report = computeCompliance([entry(0, 'claude')], []);
    expect(report.overall.n).toBe(0);
    expect(report.searchOnlySessions).toBe(1);
  });

  it('explicit session_id OVERRIDE — entries >2h apart stay ONE session', () => {
    const report = computeCompliance(
      [entry(0, 'claude', 'sid-1'), entry(5 * H, 'claude', 'sid-1')],
      [commit(0)],
    );
    // Despite the 5h gap, the shared session_id keeps them one session (n=1).
    expect(bucket(report, 'claude')).toEqual({ n: 1, compliant: 1 });
    assertRateBounds(report);
  });

  it('CLUSTERING path — id-less entries >2h apart split into two sessions', () => {
    const report = computeCompliance(
      [entry(0, 'claude'), entry(5 * H, 'claude')],
      [commit(0), commit(5 * H)],
    );
    // 5h gap > 2h → two rolling-window sessions, each with its own commit.
    expect(bucket(report, 'claude')).toEqual({ n: 2, compliant: 2 });
    assertRateBounds(report);
  });

  it('interleaved multi-seat entries stay per-seat (partition before clustering)', () => {
    // claude and gemini searches interleave inside one ~2h span. Unpartitioned,
    // rolling-2h would MERGE all four into a single pseudo-session (n=1);
    // partitioned, each seat keeps its own session (n=2, one per bucket).
    const entries: ComplianceLogEntry[] = [
      entry(0, 'claude'),
      entry(10 * MIN, 'gemini'),
      entry(15 * MIN, 'claude'),
      entry(130 * MIN, 'gemini'), // 1h55m after the prior gemini entry → same gemini cluster
    ];
    const commits = [commit(30 * MIN), commit(180 * MIN)];
    const report = computeCompliance(entries, commits);
    expect(bucket(report, 'claude')).toEqual({ n: 1, compliant: 1 });
    expect(bucket(report, 'gemini')).toEqual({ n: 1, compliant: 1 });
    expect(report.overall.n).toBe(2);
    assertRateBounds(report);
  });

  it('absent agent_source lands in the unattributed bucket', () => {
    const report = computeCompliance([entry(0, null)], [commit(30 * MIN)]);
    expect(report.buckets.map((b) => b.bucket)).toContain('unattributed');
    expect(report.unattributedEntries).toBe(1);
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
    // Base: one compliant + one non-compliant claude session → rate 0.5.
    const baseEntries: ComplianceLogEntry[] = [entry(0, 'claude'), entry(5 * H, 'claude')];
    const baseCommits = [commit(30 * MIN), commit(4 * H)]; // 2nd commit precedes its search → non-compliant
    const before = computeCompliance(baseEntries, baseCommits);
    expect(rate(before)).toBeCloseTo(0.5, 5);

    // Add one clearly-compliant session (search then commit, its own window).
    const afterEntries = [...baseEntries, entry(10 * H, 'claude')];
    const afterCommits = [...baseCommits, commit(10 * H + 30 * MIN)];
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
