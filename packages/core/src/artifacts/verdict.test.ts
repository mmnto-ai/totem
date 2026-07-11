/**
 * Verdict-artifact tests (mmnto-ai/totem#2106, Proposal 302/304 R2 review runner).
 *
 * The invariants locked in by the design doc + panel round 1:
 *   - content identity excludes `createdAt`; EEXIST is logical-identity dedup, a
 *     differing record at the same address is a hard identity violation.
 *   - lane union: `completed` requires `runArtifactHash`; counts are validated,
 *     never mirrored on trust; a panelArtifactHash needs ≥2 completed lanes.
 *   - LANE-BLINDNESS (Prop 302): no warm/cold runner discriminator key exists —
 *     asserted structurally over the top-level + per-lane key sets.
 *   - tolerant-within-major (F1); composite lineage key with no delimiter-
 *     injection ambiguity; implicit round linkage = latest by round.index.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TotemError, TotemParseError } from '../errors.js';
import { cleanTmpDir } from '../test-utils.js';
import { classifyDiversity } from './panel.js';
import {
  computeLineageKey,
  computeVerdictArtifactContentHash,
  findLatestVerdictForLineage,
  listVerdictArtifacts,
  loadVerdictArtifact,
  saveVerdictArtifact,
  VERDICT_ARTIFACT_SCHEMA_VERSION,
  type VerdictArtifact,
  VerdictArtifactSchema,
  type VerdictLane,
  verdictsDir,
} from './verdict.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function completedLane(laneId: string, provider = 'gemini'): VerdictLane {
  return {
    status: 'completed',
    laneId,
    resolvedBackend: `${provider}:${provider}-model`,
    runArtifactHash: 'a'.repeat(64),
    verdictSummary: { critical: 0, warn: 0, info: 0 },
  };
}

function abstainedLane(laneId: string, provider = 'anthropic'): VerdictLane {
  return {
    status: 'abstained',
    laneId,
    resolvedBackend: `${provider}:${provider}-model`,
    runArtifactHash: 'b'.repeat(64),
    reason: 'output unextractable by the shared extractor',
  };
}

function failedLane(laneId: string): VerdictLane {
  return { status: 'failed', laneId, typedReason: 'quota-exhausted' };
}

function verdict(overrides: Partial<VerdictArtifact> = {}): VerdictArtifact {
  const lanes = overrides.lanes ?? [completedLane('l1')];
  return {
    schemaVersion: VERDICT_ARTIFACT_SCHEMA_VERSION,
    diffScope: { source: 'staged', diffHash: 'd'.repeat(64) },
    lanes,
    attemptedLaneCount: lanes.length,
    completedLaneCount: lanes.filter((l) => l.status === 'completed').length,
    postChecks: [],
    findings: [],
    round: { index: 0, lineageKey: 'lineage-fixture' },
    reviewedState: 'matched',
    settled: true,
    createdAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

const FORBIDDEN_RUNNER_KEY = /(^|[^a-z])(runner|lanemode|lane-mode|warm|cold)([^a-z]|$)/i;

// ─── Schema: diff scope, lane union, counts, panel guard ────────────────────

describe('VerdictArtifactSchema — structure', () => {
  it('accepts a minimal valid 1.0.0 verdict', () => {
    expect(VerdictArtifactSchema.safeParse(verdict()).success).toBe(true);
  });

  it('diffScope: refs required only where the source makes them meaningful', () => {
    const dh = 'd'.repeat(64);
    const withScope = (diffScope: unknown) =>
      VerdictArtifactSchema.safeParse({ ...verdict(), diffScope }).success;
    // explicit-range needs base AND head.
    expect(
      withScope({ source: 'explicit-range', diffHash: dh, base: 'HEAD~3', head: 'HEAD' }),
    ).toBe(true);
    expect(withScope({ source: 'explicit-range', diffHash: dh, base: 'HEAD~3' })).toBe(false);
    // branch-vs-base needs base only.
    expect(withScope({ source: 'branch-vs-base', diffHash: dh, base: 'main' })).toBe(true);
    expect(withScope({ source: 'branch-vs-base', diffHash: dh })).toBe(false);
    // staged / uncommitted carry no refs.
    expect(withScope({ source: 'staged', diffHash: dh })).toBe(true);
    expect(withScope({ source: 'uncommitted', diffHash: dh })).toBe(true);
    // diffHash is always required.
    expect(withScope({ source: 'staged' })).toBe(false);
  });

  it('rejects attemptedLaneCount ≠ lanes.length (counts never mirrored on trust)', () => {
    const bad = structuredClone(verdict()) as Record<string, unknown>;
    bad.attemptedLaneCount = 5;
    expect(VerdictArtifactSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a completedLaneCount that disagrees with the completed lanes', () => {
    const bad = structuredClone(
      verdict({ lanes: [completedLane('l1'), failedLane('l2')] }),
    ) as Record<string, unknown>;
    bad.completedLaneCount = 2; // only one lane is actually completed
    expect(VerdictArtifactSchema.safeParse(bad).success).toBe(false);
    // sanity: the honest count parses
    expect(
      VerdictArtifactSchema.safeParse(verdict({ lanes: [completedLane('l1'), failedLane('l2')] }))
        .success,
    ).toBe(true);
  });

  it('the lane union enforces runArtifactHash on a completed lane', () => {
    const bad = structuredClone(verdict()) as {
      lanes: Array<Record<string, unknown>>;
    };
    delete bad.lanes[0].runArtifactHash;
    expect(VerdictArtifactSchema.safeParse(bad).success).toBe(false);
  });

  it('panelArtifactHash requires ≥2 completed lanes', () => {
    // one completed lane + a panel hash ⇒ rejected
    const one = structuredClone(verdict()) as Record<string, unknown>;
    one.panelArtifactHash = 'e'.repeat(64);
    expect(VerdictArtifactSchema.safeParse(one).success).toBe(false);
    // two completed lanes + a panel hash ⇒ accepted
    const two = {
      ...verdict({ lanes: [completedLane('l1'), completedLane('l2', 'anthropic')] }),
      panelArtifactHash: 'e'.repeat(64),
      diversity: classifyDiversity(['gemini', 'anthropic']),
    };
    expect(VerdictArtifactSchema.safeParse(two).success).toBe(true);
  });

  it('postChecks reuse the persisted #2103 vocabulary verbatim (ruleName/tier/verdict/message)', () => {
    const v = verdict({
      postChecks: [
        { ruleName: 'structured-output', tier: 'decidable', verdict: 'pass', message: 'parses' },
        {
          ruleName: 'provenance-fail-safe-down',
          tier: 'sensor',
          verdict: 'abstain',
          message: 'n/a',
        },
      ],
    });
    expect(VerdictArtifactSchema.safeParse(v).success).toBe(true);
    // verdict vocabulary is the CheckVerdict enum — an alien value is rejected.
    const bad = structuredClone(v) as { postChecks: Array<Record<string, unknown>> };
    bad.postChecks[0].verdict = 'accepted';
    expect(VerdictArtifactSchema.safeParse(bad).success).toBe(false);
  });

  it('findings align with ShieldFinding fields (confidence optional, 0..1)', () => {
    const v = verdict({
      findings: [
        { severity: 'CRITICAL', confidence: 0.9, file: 'src/x.ts', line: 42, message: 'boom' },
        { severity: 'INFO', message: 'a cross-cutting note with no file/line/confidence' },
      ],
    });
    expect(VerdictArtifactSchema.safeParse(v).success).toBe(true);
    const outOfRange = structuredClone(v) as { findings: Array<Record<string, unknown>> };
    outOfRange.findings[0].confidence = 1.5;
    expect(VerdictArtifactSchema.safeParse(outOfRange).success).toBe(false);
    const badSeverity = structuredClone(v) as { findings: Array<Record<string, unknown>> };
    badSeverity.findings[0].severity = 'BLOCKER';
    expect(VerdictArtifactSchema.safeParse(badSeverity).success).toBe(false);
  });
});

// ─── LANE-BLINDNESS structural test (Prop 302) ──────────────────────────────

describe('lane-blindness: no runner/lane-mode discriminator (Prop 302)', () => {
  it('the known top-level key set contains no warm/cold/runner key', () => {
    // Populate EVERY field (incl. the optionals) so Object.keys is the full known set.
    const full = {
      ...verdict({ lanes: [completedLane('l1'), completedLane('l2', 'anthropic')] }),
      panelArtifactHash: 'e'.repeat(64),
      diversity: classifyDiversity(['gemini', 'anthropic']),
    };
    expect(VerdictArtifactSchema.safeParse(full).success).toBe(true);
    const topKeys = Object.keys(full).sort();
    expect(topKeys).toEqual([
      'attemptedLaneCount',
      'completedLaneCount',
      'createdAt',
      'diffScope',
      'diversity',
      'findings',
      'lanes',
      'panelArtifactHash',
      'postChecks',
      'reviewedState',
      'round',
      'schemaVersion',
      'settled',
    ]);
    for (const k of topKeys) expect(k).not.toMatch(FORBIDDEN_RUNNER_KEY);
  });

  it('no lane variant carries a runner-mode key; the discriminator is status', () => {
    const mixed = verdict({
      lanes: [completedLane('c1'), abstainedLane('a1'), failedLane('f1')],
    });
    expect(VerdictArtifactSchema.safeParse(mixed).success).toBe(true);
    for (const lane of mixed.lanes) {
      expect('status' in lane).toBe(true);
      for (const k of Object.keys(lane)) expect(k).not.toMatch(FORBIDDEN_RUNNER_KEY);
    }
    const byStatus = Object.fromEntries(mixed.lanes.map((l) => [l.status, Object.keys(l).sort()]));
    expect(byStatus.completed).toEqual([
      'laneId',
      'resolvedBackend',
      'runArtifactHash',
      'status',
      'verdictSummary',
    ]);
    expect(byStatus.abstained).toEqual([
      'laneId',
      'reason',
      'resolvedBackend',
      'runArtifactHash',
      'status',
    ]);
    expect(byStatus.failed).toEqual(['laneId', 'status', 'typedReason']);
  });
});

// ─── Schema-version tolerance (F1) ──────────────────────────────────────────

describe('schema-version tolerance (F1)', () => {
  it('accepts any 1.x minor, rejects ≥2.x loud', () => {
    const v = verdict();
    expect(VerdictArtifactSchema.safeParse({ ...v, schemaVersion: '1.9.3' }).success).toBe(true);
    const major = VerdictArtifactSchema.safeParse({ ...v, schemaVersion: '2.0.0' });
    expect(major.success).toBe(false);
  });
});

// ─── computeLineageKey ──────────────────────────────────────────────────────

describe('computeLineageKey — composite over the resolved scope selector, injection-proof', () => {
  const REPO = '/abs/worktree';

  it('distinct branches sharing a merge base produce distinct keys', () => {
    const a = computeLineageKey({
      repoIdentity: REPO,
      branch: 'feat/x',
      mergeBase: 'main',
      source: 'branch-vs-base',
    });
    const b = computeLineageKey({
      repoIdentity: REPO,
      branch: 'feat/y',
      mergeBase: 'main',
      source: 'branch-vs-base',
    });
    expect(a).not.toBe(b);
  });

  it('distinct worktree identities on the same branch/base produce distinct keys', () => {
    const a = computeLineageKey({
      repoIdentity: '/abs/wt-a',
      branch: 'feat/x',
      mergeBase: 'main',
      source: 'branch-vs-base',
    });
    const b = computeLineageKey({
      repoIdentity: '/abs/wt-b',
      branch: 'feat/x',
      mergeBase: 'main',
      source: 'branch-vs-base',
    });
    expect(a).not.toBe(b);
  });

  it('two different explicit ranges on one branch + merge-base produce distinct keys (codex rev-2 gate 2)', () => {
    // Same branch, same repo, same resolved merge-base — only the range endpoints differ.
    const a = computeLineageKey({
      repoIdentity: REPO,
      branch: 'feat/x',
      mergeBase: 'shared',
      source: 'explicit-range',
      base: 'HEAD~3',
      head: 'HEAD',
    });
    const b = computeLineageKey({
      repoIdentity: REPO,
      branch: 'feat/x',
      mergeBase: 'shared',
      source: 'explicit-range',
      base: 'HEAD~5',
      head: 'HEAD',
    });
    expect(a).not.toBe(b);
  });

  it('a delimiter-injection attempt does not collide', () => {
    // 'a' + 'b|c'  vs  'a|b' + 'c' — a naive join('|') would collide these.
    const a = computeLineageKey({
      repoIdentity: REPO,
      branch: 'a',
      mergeBase: 'b|c',
      source: 'uncommitted',
    });
    const b = computeLineageKey({
      repoIdentity: REPO,
      branch: 'a|b',
      mergeBase: 'c',
      source: 'uncommitted',
    });
    expect(a).not.toBe(b);
  });

  it('is stable for identical components and discriminates on source', () => {
    const base = { repoIdentity: REPO, branch: 'a', mergeBase: 'main' } as const;
    expect(computeLineageKey({ ...base, source: 'staged' })).toBe(
      computeLineageKey({ ...base, source: 'staged' }),
    );
    expect(computeLineageKey({ ...base, source: 'staged' })).not.toBe(
      computeLineageKey({ ...base, source: 'uncommitted' }),
    );
  });
});

// ─── Storage: content-address, dedup, identity violation, lineage ───────────

describe('verdict storage (mirrors run/panel storage)', () => {
  let totemDir: string;

  beforeEach(() => {
    totemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-verdict-'));
  });
  afterEach(() => {
    cleanTmpDir(totemDir);
  });

  it('writes at artifacts/verdicts/<hash>.json and reads it back', () => {
    const v = verdict();
    const saved = saveVerdictArtifact(totemDir, v);
    expect(saved.existed).toBe(false);
    expect(saved.path).toBe(path.join(totemDir, 'artifacts', 'verdicts', `${saved.hash}.json`));
    expect(verdictsDir(totemDir)).toBe(path.join(totemDir, 'artifacts', 'verdicts'));
    expect(loadVerdictArtifact(totemDir, saved.hash)).toEqual(v);
  });

  it('content address excludes createdAt — identical rounds dedup across time', () => {
    const early = verdict({ createdAt: '2026-07-10T00:00:00.000Z' });
    const late = verdict({ createdAt: '2026-07-11T09:30:00.000Z' });
    expect(computeVerdictArtifactContentHash(early)).toBe(computeVerdictArtifactContentHash(late));
    const first = saveVerdictArtifact(totemDir, early);
    const second = saveVerdictArtifact(totemDir, late);
    expect(second.existed).toBe(true); // logical-identity dedup, no throw
    expect(second.hash).toBe(first.hash);
    // first-write-wins: the stored createdAt is the early one.
    expect(loadVerdictArtifact(totemDir, first.hash).createdAt).toBe('2026-07-10T00:00:00.000Z');
  });

  it('EEXIST with content differing modulo createdAt is a hard identity violation', () => {
    const target = verdict({ settled: true });
    const hash = computeVerdictArtifactContentHash(target);
    // Plant a DIFFERENT but valid verdict at target's content address.
    const impostor = verdict({ settled: false, createdAt: '2020-01-01T00:00:00.000Z' });
    expect(computeVerdictArtifactContentHash(impostor)).not.toBe(hash); // sanity
    fs.mkdirSync(verdictsDir(totemDir), { recursive: true });
    fs.writeFileSync(path.join(verdictsDir(totemDir), `${hash}.json`), JSON.stringify(impostor));
    expect(() => saveVerdictArtifact(totemDir, target)).toThrow(TotemError);
    expect(() => saveVerdictArtifact(totemDir, target)).toThrow(/identity violation/i);
  });

  it('loads a minor-newer verdict from disk; rejects a major-newer one loud', () => {
    const v = verdict();
    fs.mkdirSync(verdictsDir(totemDir), { recursive: true });
    const minorHash = 'a'.repeat(64);
    fs.writeFileSync(
      path.join(verdictsDir(totemDir), `${minorHash}.json`),
      JSON.stringify({ ...v, schemaVersion: '1.7.0' }),
    );
    expect(loadVerdictArtifact(totemDir, minorHash).schemaVersion).toBe('1.7.0');
    const majorHash = 'b'.repeat(64);
    fs.writeFileSync(
      path.join(verdictsDir(totemDir), `${majorHash}.json`),
      JSON.stringify({ ...v, schemaVersion: '2.0.0' }),
    );
    expect(() => loadVerdictArtifact(totemDir, majorHash)).toThrow(/2\.0\.0/);
  });

  it('rejects a non-hash id before touching the filesystem', () => {
    expect(() => loadVerdictArtifact(totemDir, '../../secrets')).toThrow(/sha256/i);
  });

  it('a missing but well-formed hash throws TotemParseError', () => {
    expect(() => loadVerdictArtifact(totemDir, 'f'.repeat(64))).toThrow(TotemParseError);
  });

  it('listVerdictArtifacts returns [] when nothing has been written', () => {
    expect(listVerdictArtifacts(totemDir)).toEqual([]);
  });

  it('findLatestVerdictForLineage picks the highest round.index in the lineage', () => {
    const lineageKey = computeLineageKey({
      repoIdentity: '/r',
      branch: 'a',
      mergeBase: 'main',
      source: 'staged',
    });
    const other = computeLineageKey({
      repoIdentity: '/r',
      branch: 'z',
      mergeBase: 'main',
      source: 'staged',
    });
    // Same lineage, three rounds with distinct content (index differs ⇒ distinct address).
    saveVerdictArtifact(totemDir, verdict({ round: { index: 0, lineageKey }, settled: false }));
    saveVerdictArtifact(totemDir, verdict({ round: { index: 1, lineageKey } }));
    const r2 = saveVerdictArtifact(totemDir, verdict({ round: { index: 2, lineageKey } }));
    // A different lineage that must be ignored even though its index is higher.
    saveVerdictArtifact(totemDir, verdict({ round: { index: 9, lineageKey: other } }));

    const latest = findLatestVerdictForLineage(totemDir, lineageKey);
    expect(latest?.round.index).toBe(2);
    expect(computeVerdictArtifactContentHash(latest!)).toBe(r2.hash);
    expect(findLatestVerdictForLineage(totemDir, 'no-such-lineage')).toBeUndefined();
  });

  it('findLatestVerdictForLineage breaks round-index ties by latest createdAt', () => {
    const lineageKey = computeLineageKey({
      repoIdentity: '/r',
      branch: 'a',
      mergeBase: 'main',
      source: 'staged',
    });
    // Same round.index, distinct content (settled differs ⇒ distinct address), distinct createdAt.
    saveVerdictArtifact(
      totemDir,
      verdict({
        round: { index: 1, lineageKey },
        settled: true,
        createdAt: '2026-07-10T00:00:00.000Z',
      }),
    );
    saveVerdictArtifact(
      totemDir,
      verdict({
        round: { index: 1, lineageKey },
        settled: false,
        createdAt: '2026-07-11T00:00:00.000Z',
      }),
    );
    expect(findLatestVerdictForLineage(totemDir, lineageKey)?.createdAt).toBe(
      '2026-07-11T00:00:00.000Z',
    );
  });
});
