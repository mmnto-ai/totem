/**
 * Verdict-artifact tests (mmnto-ai/totem#2106, Proposal 302/304 R2 review runner).
 *
 * The invariants locked in by the design doc + panel rounds 1 and the dual
 * as-built round (rev 4):
 *   - content identity excludes `createdAt`; EEXIST is logical-identity dedup, a
 *     differing record at the same address is a hard identity violation.
 *   - content-address verification on load (finding 4): a schema-valid artifact
 *     stored under the WRONG 64-hex filename is rejected loud on direct load;
 *     warned + skipped during a lineage scan.
 *   - lane union: `completed` requires `runArtifactHash`; counts are validated,
 *     never mirrored on trust; a panelArtifactHash needs ≥2 completed lanes.
 *   - the persisted boundary re-derives `settled` (finding 5) — a fabricated flag
 *     is rejected.
 *   - cross-field invariants (finding 9): panel ⟺ diversity ⟺ ≥2 completed lanes;
 *     round-chain shape; nonempty unique lanes; source-discriminated lineage input.
 *   - LANE-BLINDNESS (Prop 302): no warm/cold runner discriminator KEY exists, and
 *     no runner class can be smuggled through a laneId VALUE (G1).
 *   - all-terminal-failure writes an honest, LEGAL verdict (G3).
 *   - the covariate line is core-owned, format v1 (G4).
 *   - tolerant-within-major (F1); composite lineage key with no delimiter-
 *     injection ambiguity; implicit round linkage = latest by round.index.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TotemError, TotemParseError } from '../errors.js';
import { cleanTmpDir } from '../test-utils.js';
import { calculateDeterministicHash } from './hash.js';
import { classifyDiversity } from './panel.js';
import {
  computeLineageKey,
  computeVerdictArtifactContentHash,
  deriveCacheEligible,
  deriveSettled,
  findLatestVerdictForLineage,
  listVerdictArtifacts,
  loadVerdictArtifact,
  renderCovariateLine,
  saveVerdictArtifact,
  VERDICT_ARTIFACT_SCHEMA_VERSION,
  type VerdictArtifact,
  VerdictArtifactSchema,
  type VerdictLane,
  type VerdictPredicateInput,
  verdictsDir,
} from './verdict.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────
//
// laneIds follow the backend-derived vocabulary `lane-<index>:<backend>` (G1),
// built from the lane's fan position + resolved backend / configured lane.

/** Test sink for the now-required scan `onWarn` (core is console-free; PR #2337 CR). */
const noWarn = (): void => {};

function completedLane(index: number, provider = 'gemini'): VerdictLane {
  const resolvedBackend = `${provider}:${provider}-model`;
  return {
    status: 'completed',
    laneId: `lane-${index}:${resolvedBackend}`,
    resolvedBackend,
    runArtifactHash: 'a'.repeat(64),
    verdictSummary: { critical: 0, warn: 0, info: 0 },
  };
}

function abstainedLane(index: number, provider = 'anthropic'): VerdictLane {
  const resolvedBackend = `${provider}:${provider}-model`;
  return {
    status: 'abstained',
    laneId: `lane-${index}:${resolvedBackend}`,
    resolvedBackend,
    runArtifactHash: 'b'.repeat(64),
    reason: 'output unextractable by the shared extractor',
  };
}

function failedLane(index: number, configured = 'openai:gpt-model'): VerdictLane {
  return {
    status: 'failed',
    laneId: `lane-${index}:${configured}`,
    typedReason: 'quota-exhausted',
    // rev-6 item 3: the configured lane the id suffix binds to (present even pre-resolution).
    configuredLane: configured,
  };
}

function verdict(overrides: Partial<VerdictArtifact> = {}): VerdictArtifact {
  const lanes = overrides.lanes ?? [completedLane(0)];
  const v: VerdictArtifact = {
    schemaVersion: VERDICT_ARTIFACT_SCHEMA_VERSION,
    diffScope: { source: 'staged', diffHash: 'd'.repeat(64) },
    lanes,
    attemptedLaneCount: lanes.length,
    completedLaneCount: lanes.filter((l) => l.status === 'completed').length,
    postChecks: [],
    findings: [],
    round: { index: 0, lineageKey: 'lineage-fixture' },
    reviewedState: 'matched',
    settled: true, // recomputed below unless the caller pins it explicitly
    createdAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
  // Keep `settled` consistent with the finding-5 re-derivation by default so
  // structural fixtures satisfy the superRefine. A negative test that WANTS an
  // inconsistent `settled` passes it explicitly in `overrides` (honored here).
  if (!('settled' in overrides)) v.settled = deriveSettled(v);
  return v;
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
    const bad = structuredClone(verdict({ lanes: [completedLane(0), failedLane(1)] })) as Record<
      string,
      unknown
    >;
    bad.completedLaneCount = 2; // only one lane is actually completed
    expect(VerdictArtifactSchema.safeParse(bad).success).toBe(false);
    // sanity: the honest count parses
    expect(
      VerdictArtifactSchema.safeParse(verdict({ lanes: [completedLane(0), failedLane(1)] }))
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
    // one completed lane + a panel hash (+ diversity so only the ≥2 rule is tested) ⇒ rejected
    const one = {
      ...verdict(),
      panelArtifactHash: 'e'.repeat(64),
      diversity: classifyDiversity(['gemini']),
    };
    expect(VerdictArtifactSchema.safeParse(one).success).toBe(false);
    // two completed lanes + a panel hash + diversity ⇒ accepted
    const two = {
      ...verdict({ lanes: [completedLane(0), completedLane(1, 'anthropic')] }),
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

// ─── laneId value-channel lane-blindness (Prop 302 G1) ──────────────────────
// Closed STRUCTURALLY: the suffix must equal the lane's binding field, so free
// text (runner classes included) has no channel. The former substring blacklist
// was removed — it false-positived legitimate model names (PR #2337 greptile P2).

describe('laneId value-channel lane-blindness (Prop 302 G1, structural)', () => {
  it('accepts a well-formed backend-derived laneId', () => {
    expect(VerdictArtifactSchema.safeParse(verdict()).success).toBe(true);
  });

  it('rejects a laneId smuggling a runner class (warm) — suffix diverges from the binding field', () => {
    const smuggled = verdict({
      lanes: [{ ...completedLane(0), laneId: 'lane-0:warm-resident:some-model' }],
    });
    expect(VerdictArtifactSchema.safeParse(smuggled).success).toBe(false);
  });

  it('rejects each runner-class smuggle attempt (cold/headless/sdk-runner) structurally', () => {
    for (const smuggle of ['cold', 'headless', 'sdk-runner']) {
      const v = verdict({ lanes: [{ ...completedLane(0), laneId: `lane-0:${smuggle}-x:m` }] });
      expect(VerdictArtifactSchema.safeParse(v).success).toBe(false);
    }
  });

  it('ACCEPTS a legitimate model name containing a runner-class token when the suffix matches the binding (no substring false positive)', () => {
    const backend = 'anthropic:claude-cold-inference-mini';
    const lane = { ...completedLane(0), laneId: `lane-0:${backend}`, resolvedBackend: backend };
    const v = verdict({ lanes: [lane], diversity: undefined, panelArtifactHash: undefined });
    const parsed = VerdictArtifactSchema.safeParse(v);
    expect(parsed.success).toBe(true);
  });

  it('rejects a laneId that violates the backend-derived shape', () => {
    const malformed = verdict({ lanes: [{ ...completedLane(0), laneId: 'l1' }] });
    expect(VerdictArtifactSchema.safeParse(malformed).success).toBe(false);
  });
});

// ─── Structural laneId validation (rev-5 item 6) ─────────────────────────────

describe('structural laneId validation (rev-5 item 6)', () => {
  it('rejects a laneId whose index does not match the lane array position', () => {
    // completedLane(5) builds `lane-5:gemini:gemini-model` but sits at array index 0.
    const indexMismatch = verdict({ lanes: [completedLane(5)] });
    const parsed = VerdictArtifactSchema.safeParse(indexMismatch);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => /array position/.test(i.message))).toBe(true);
    }
  });

  it("rejects codex's example: `lane-99:gemini:fake` with resolvedBackend `anthropic:real`", () => {
    const smuggled = verdict({
      lanes: [
        {
          status: 'completed',
          laneId: 'lane-99:gemini:fake',
          resolvedBackend: 'anthropic:real',
          runArtifactHash: 'a'.repeat(64),
          verdictSummary: { critical: 0, warn: 0, info: 0 },
        },
      ],
    });
    expect(VerdictArtifactSchema.safeParse(smuggled).success).toBe(false);
  });

  it('rejects a completed lane whose suffix disagrees with resolvedBackend at the RIGHT index', () => {
    const suffixMismatch = verdict({
      lanes: [{ ...completedLane(0), laneId: 'lane-0:gemini:other-model' }],
    });
    const parsed = VerdictArtifactSchema.safeParse(suffixMismatch);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => /must equal resolvedBackend/.test(i.message))).toBe(
        true,
      );
    }
  });

  it('rejects an abstained lane with a suffix/backend mismatch', () => {
    const bad = verdict({
      lanes: [{ ...abstainedLane(0), laneId: 'lane-0:gemini:not-the-backend' }],
    });
    expect(VerdictArtifactSchema.safeParse(bad).success).toBe(false);
  });

  it('a failed lane binds its laneId suffix to configuredLane; resolvedBackend may differ (quota-fallback) (rev-6 item 3)', () => {
    // suffix (failedLane fixture: openai:gpt-model) === configuredLane ⇒ accepted.
    expect(VerdictArtifactSchema.safeParse(verdict({ lanes: [failedLane(0)] })).success).toBe(true);
    // A resolvedBackend that DIFFERS from configuredLane is a legitimate quota-fallback
    // record — the suffix still binds to configuredLane, so this is ACCEPTED.
    const quotaFallback = verdict({
      lanes: [{ ...failedLane(0), resolvedBackend: 'openai:fallback-model' }],
    });
    expect(VerdictArtifactSchema.safeParse(quotaFallback).success).toBe(true);
    // codex's tautology: an INVENTED suffix that disagrees with the declared
    // configuredLane ⇒ rejected (the suffix is no longer free-floating).
    const suffixMismatch = verdict({
      lanes: [
        {
          status: 'failed',
          laneId: 'lane-0:gemini:completely-invented',
          typedReason: 'config-error',
          configuredLane: 'openai:gpt-model',
        },
      ],
    });
    const parsed = VerdictArtifactSchema.safeParse(suffixMismatch);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => /must equal configuredLane/.test(i.message))).toBe(
        true,
      );
    }
  });

  it('conforming artifacts pass (mixed statuses, indexes in order)', () => {
    const mixed = verdict({ lanes: [completedLane(0), abstainedLane(1), failedLane(2)] });
    expect(VerdictArtifactSchema.safeParse(mixed).success).toBe(true);
  });
});

// ─── Diversity grounded in completed-lane backends (rev-5 item 7) ─────────────

describe('diversity summary re-derived from completed lanes (rev-5 item 7)', () => {
  it('rejects a fabricated cross-vendor diversity over two same-vendor lanes', () => {
    const twoAnthropic = verdict({
      lanes: [completedLane(0, 'anthropic'), completedLane(1, 'anthropic')],
    });
    const fabricated = {
      ...twoAnthropic,
      panelArtifactHash: 'e'.repeat(64),
      // classifyDiversity output for a FAKE provider mix — internally consistent
      // (would pass the panel-style pure-function checks) but NOT grounded in the
      // lanes' resolved backends, which are both anthropic.
      diversity: classifyDiversity(['anthropic', 'gemini']),
    };
    const parsed = VerdictArtifactSchema.safeParse(fabricated);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((i) => /derived from the completed lanes/.test(i.message)),
      ).toBe(true);
    }
  });

  it("rejects codex's forged diversity: distinctProviders/unrecognized/confidence fabricated over same-vendor lanes (rev-6 item 2)", () => {
    // Two anthropic lanes should derive providers ['anthropic','anthropic'], distinct 1,
    // same-vendor-isolated, [] unrecognized, verified. This hand-forged diversity lies on
    // EVERY field — it even collapses the multiset to one entry — yet passes the field
    // types (PanelDiversitySchema has no re-derivation of its own). The verdict boundary
    // must reject it via the FULL re-derivation (not just the provider set + class).
    const twoAnthropic = verdict({
      lanes: [completedLane(0, 'anthropic'), completedLane(1, 'anthropic')],
    });
    const forged = {
      ...twoAnthropic,
      panelArtifactHash: 'e'.repeat(64),
      diversity: {
        providers: ['anthropic'],
        distinctProviders: 99,
        class: 'cross-vendor' as const,
        unrecognizedProviders: ['totally-made-up'],
        diversityConfidence: 'coarse' as const,
      },
    };
    const parsed = VerdictArtifactSchema.safeParse(forged);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const msgs = parsed.error.issues.map((i) => i.message).join('\n');
      // The full re-derivation fires on the multiset, distinctProviders, and confidence.
      expect(msgs).toMatch(/multiset/);
      expect(msgs).toMatch(/distinctProviders/);
      expect(msgs).toMatch(/diversityConfidence/);
    }
  });

  it('accepts the honest same-vendor summary for the same lanes', () => {
    const twoAnthropic = verdict({
      lanes: [completedLane(0, 'anthropic'), completedLane(1, 'anthropic')],
    });
    const honest = {
      ...twoAnthropic,
      panelArtifactHash: 'e'.repeat(64),
      diversity: classifyDiversity(['anthropic', 'anthropic']),
    };
    expect(VerdictArtifactSchema.safeParse(honest).success).toBe(true);
  });

  it('accepts an honest cross-vendor summary grounded in genuinely mixed lanes', () => {
    const mixed = verdict({
      lanes: [completedLane(0, 'gemini'), completedLane(1, 'anthropic')],
    });
    const honest = {
      ...mixed,
      panelArtifactHash: 'e'.repeat(64),
      diversity: classifyDiversity(['gemini', 'anthropic']),
    };
    expect(VerdictArtifactSchema.safeParse(honest).success).toBe(true);
  });
});

// ─── createdAt validation (rev-5 item 8) ──────────────────────────────────────

describe('createdAt is a validated ISO datetime (rev-5 item 8)', () => {
  it('rejects a malformed createdAt at parse', () => {
    expect(VerdictArtifactSchema.safeParse(verdict({ createdAt: 'yesterday-ish' })).success).toBe(
      false,
    );
    expect(VerdictArtifactSchema.safeParse(verdict({ createdAt: '2026-07-10' })).success).toBe(
      false,
    );
  });

  it('accepts a well-formed ISO datetime', () => {
    expect(
      VerdictArtifactSchema.safeParse(verdict({ createdAt: '2026-07-10T12:34:56.789Z' })).success,
    ).toBe(true);
  });
});

// ─── settled re-derivation at the persisted boundary (finding 5) ─────────────

describe('persisted boundary re-derives settled (finding 5)', () => {
  it('rejects settled:true when the tree drifted mid-fan', () => {
    expect(
      VerdictArtifactSchema.safeParse(verdict({ reviewedState: 'drifted', settled: true })).success,
    ).toBe(false);
    // honest counterpart passes
    expect(
      VerdictArtifactSchema.safeParse(verdict({ reviewedState: 'drifted', settled: false }))
        .success,
    ).toBe(true);
  });

  it('rejects settled:true when a lane failed (fan incomplete)', () => {
    const lanes = [completedLane(0), failedLane(1)];
    expect(VerdictArtifactSchema.safeParse(verdict({ lanes, settled: true })).success).toBe(false);
    expect(VerdictArtifactSchema.safeParse(verdict({ lanes, settled: false })).success).toBe(true);
  });

  it('rejects settled:true with an actionable WARN finding', () => {
    const findings: VerdictArtifact['findings'] = [{ severity: 'WARN', message: 'drip' }];
    expect(VerdictArtifactSchema.safeParse(verdict({ findings, settled: true })).success).toBe(
      false,
    );
    expect(VerdictArtifactSchema.safeParse(verdict({ findings, settled: false })).success).toBe(
      true,
    );
  });

  it('rejects settled:true with a decidable-tier post-check failure', () => {
    const postChecks: VerdictArtifact['postChecks'] = [
      { ruleName: 'review-structured-verdict', tier: 'decidable', verdict: 'fail', message: 'no' },
    ];
    expect(VerdictArtifactSchema.safeParse(verdict({ postChecks, settled: true })).success).toBe(
      false,
    );
    expect(VerdictArtifactSchema.safeParse(verdict({ postChecks, settled: false })).success).toBe(
      true,
    );
    // a SENSOR-tier fail never gates settled (ADR-109) — settled:true stays honest.
    const sensor: VerdictArtifact['postChecks'] = [
      { ruleName: 'provenance', tier: 'sensor', verdict: 'fail', message: 'advisory' },
    ];
    expect(
      VerdictArtifactSchema.safeParse(verdict({ postChecks: sensor, settled: true })).success,
    ).toBe(true);
  });

  it('a genuinely dry current round is settled:true', () => {
    expect(VerdictArtifactSchema.safeParse(verdict({ settled: true })).success).toBe(true);
  });
});

// ─── deriveSettled / deriveCacheEligible — pure single source of truth ───────

describe('deriveSettled / deriveCacheEligible (pure predicates)', () => {
  it('a dry matched fan is both settled and cache-eligible', () => {
    const v = verdict();
    expect(deriveSettled(v)).toBe(true);
    expect(deriveCacheEligible(v)).toBe(true);
  });

  it('a WARN-only fan is cache-eligible but NOT settled (settled is stricter)', () => {
    const input: VerdictPredicateInput = {
      lanes: [completedLane(0)],
      findings: [{ severity: 'WARN', message: 'drip' }],
      postChecks: [],
      reviewedState: 'matched',
    };
    expect(deriveSettled(input)).toBe(false);
    expect(deriveCacheEligible(input)).toBe(true);
  });

  it('a CRITICAL fan is neither settled nor cache-eligible', () => {
    const input: VerdictPredicateInput = {
      lanes: [completedLane(0)],
      findings: [{ severity: 'CRITICAL', message: 'boom' }],
      postChecks: [],
      reviewedState: 'matched',
    };
    expect(deriveSettled(input)).toBe(false);
    expect(deriveCacheEligible(input)).toBe(false);
  });

  it('lane dropout or drift fails both (a persistent finding can never settle by dropout)', () => {
    const dropout: VerdictPredicateInput = {
      lanes: [completedLane(0), failedLane(1)],
      findings: [],
      postChecks: [],
      reviewedState: 'matched',
    };
    expect(deriveSettled(dropout)).toBe(false);
    expect(deriveCacheEligible(dropout)).toBe(false);
    const drift: VerdictPredicateInput = {
      lanes: [completedLane(0)],
      findings: [],
      postChecks: [],
      reviewedState: 'drifted',
    };
    expect(deriveSettled(drift)).toBe(false);
    expect(deriveCacheEligible(drift)).toBe(false);
  });
});

// ─── Cross-field invariants (finding 9) ──────────────────────────────────────

describe('cross-field invariants (finding 9)', () => {
  it('panelArtifactHash ⟺ diversity, both directions', () => {
    const twoCompleted = verdict({ lanes: [completedLane(0), completedLane(1, 'anthropic')] });
    const diversity = classifyDiversity(['gemini', 'anthropic']);
    // panel without diversity → reject
    expect(
      VerdictArtifactSchema.safeParse({ ...twoCompleted, panelArtifactHash: 'e'.repeat(64) })
        .success,
    ).toBe(false);
    // diversity without panel → reject
    expect(VerdictArtifactSchema.safeParse({ ...twoCompleted, diversity }).success).toBe(false);
    // both present with ≥2 completed → accept
    expect(
      VerdictArtifactSchema.safeParse({
        ...twoCompleted,
        panelArtifactHash: 'e'.repeat(64),
        diversity,
      }).success,
    ).toBe(true);
  });

  it('≥2 completed lanes require a panel (reverse direction)', () => {
    // two completed lanes but NO panel / diversity → reject (a panel is assembled from all usable lanes)
    expect(
      VerdictArtifactSchema.safeParse(verdict({ lanes: [completedLane(0), completedLane(1)] }))
        .success,
    ).toBe(false);
  });

  it('round.index === 0 ⟺ priorVerdictHash absent, both directions', () => {
    // round 0 with a prior → reject
    expect(
      VerdictArtifactSchema.safeParse(
        verdict({ round: { index: 0, lineageKey: 'lk', priorVerdictHash: 'a'.repeat(64) } }),
      ).success,
    ).toBe(false);
    // round > 0 without a prior → reject
    expect(
      VerdictArtifactSchema.safeParse(verdict({ round: { index: 1, lineageKey: 'lk' } })).success,
    ).toBe(false);
    // round > 0 with a prior → accept
    expect(
      VerdictArtifactSchema.safeParse(
        verdict({ round: { index: 1, lineageKey: 'lk', priorVerdictHash: 'a'.repeat(64) } }),
      ).success,
    ).toBe(true);
    // round 0 without a prior (the default) → accept
    expect(VerdictArtifactSchema.safeParse(verdict()).success).toBe(true);
  });

  it('lanes must be nonempty', () => {
    const empty = {
      ...verdict(),
      lanes: [],
      attemptedLaneCount: 0,
      completedLaneCount: 0,
    };
    expect(VerdictArtifactSchema.safeParse(empty).success).toBe(false);
  });

  it('laneIds must be unique across the fan', () => {
    // two failed lanes with an identical laneId (0 completed ⇒ no panel confound)
    const dup = verdict({ lanes: [failedLane(0), failedLane(0)] });
    expect(VerdictArtifactSchema.safeParse(dup).success).toBe(false);
  });
});

// ─── Gate G3: all-terminal-failure is a LEGAL, honest verdict ────────────────

describe('all-lanes-failed verdict is legal (gate G3)', () => {
  it('accepts an honest total-failure fan (no panel, no diversity, settled:false)', () => {
    const totalFailure = verdict({
      lanes: [failedLane(0), failedLane(1)],
      findings: [],
      round: { index: 0, lineageKey: 'lk' },
    });
    expect(totalFailure.completedLaneCount).toBe(0);
    expect(totalFailure.attemptedLaneCount).toBe(2);
    expect(totalFailure.settled).toBe(false);
    expect(totalFailure.panelArtifactHash).toBeUndefined();
    expect(totalFailure.diversity).toBeUndefined();
    expect(VerdictArtifactSchema.safeParse(totalFailure).success).toBe(true);
  });
});

// ─── Gate G4: core-owned covariate line, format v1 ───────────────────────────

describe('renderCovariateLine (gate G4, format v1)', () => {
  it('emits exactly `local-lane: <hash8> round=<n> settled=<bool> lanes=<c>/<a>`', () => {
    const v = verdict(); // 1/1 completed, round 0, dry ⇒ settled true
    const contentHash = computeVerdictArtifactContentHash(v);
    expect(renderCovariateLine({ artifact: v, contentHash })).toBe(
      `local-lane: ${contentHash.slice(0, 8)} round=0 settled=true lanes=1/1`,
    );
  });

  it('reflects a degraded, unsettled round (completed < attempted)', () => {
    const v = verdict({ lanes: [completedLane(0), failedLane(1)] });
    const contentHash = computeVerdictArtifactContentHash(v);
    expect(renderCovariateLine({ artifact: v, contentHash })).toBe(
      `local-lane: ${contentHash.slice(0, 8)} round=0 settled=false lanes=1/2`,
    );
  });
});

// ─── LANE-BLINDNESS structural test (Prop 302) ──────────────────────────────

describe('lane-blindness: no runner/lane-mode discriminator (Prop 302)', () => {
  it('the known top-level key set contains no warm/cold/runner key', () => {
    // Populate EVERY field (incl. the optionals) so Object.keys is the full known set.
    const full = {
      ...verdict({ lanes: [completedLane(0), completedLane(1, 'anthropic')] }),
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
      lanes: [completedLane(0), abstainedLane(1), failedLane(2)],
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
    expect(byStatus.failed).toEqual(['configuredLane', 'laneId', 'status', 'typedReason']);
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

describe('computeLineageKey — source-discriminated selector, injection-proof', () => {
  const REPO = '/abs/worktree';

  it('distinct branches sharing a merge base produce distinct keys', () => {
    const a = computeLineageKey({
      repoIdentity: REPO,
      branch: 'feat/x',
      source: 'branch-vs-base',
      base: 'main',
      mergeBase: 'sha-shared',
    });
    const b = computeLineageKey({
      repoIdentity: REPO,
      branch: 'feat/y',
      source: 'branch-vs-base',
      base: 'main',
      mergeBase: 'sha-shared',
    });
    expect(a).not.toBe(b);
  });

  it('distinct worktree identities on the same branch/base produce distinct keys', () => {
    const a = computeLineageKey({
      repoIdentity: '/abs/wt-a',
      branch: 'feat/x',
      source: 'branch-vs-base',
      base: 'main',
      mergeBase: 'sha-shared',
    });
    const b = computeLineageKey({
      repoIdentity: '/abs/wt-b',
      branch: 'feat/x',
      source: 'branch-vs-base',
      base: 'main',
      mergeBase: 'sha-shared',
    });
    expect(a).not.toBe(b);
  });

  it('two different explicit ranges on one branch produce distinct keys (codex rev-2 gate 2)', () => {
    // Same branch, same repo — only the range endpoints differ.
    const a = computeLineageKey({
      repoIdentity: REPO,
      branch: 'feat/x',
      source: 'explicit-range',
      base: 'HEAD~3',
      head: 'HEAD',
    });
    const b = computeLineageKey({
      repoIdentity: REPO,
      branch: 'feat/x',
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
      source: 'branch-vs-base',
      base: 'main',
      mergeBase: 'b|c',
    });
    const b = computeLineageKey({
      repoIdentity: REPO,
      branch: 'a|b',
      source: 'branch-vs-base',
      base: 'main',
      mergeBase: 'c',
    });
    expect(a).not.toBe(b);
  });

  it('is stable for identical components and discriminates on source', () => {
    const staged = { repoIdentity: REPO, branch: 'a', source: 'staged' } as const;
    const uncommitted = { repoIdentity: REPO, branch: 'a', source: 'uncommitted' } as const;
    expect(computeLineageKey(staged)).toBe(computeLineageKey(staged));
    expect(computeLineageKey(staged)).not.toBe(computeLineageKey(uncommitted));
  });

  it('selectorForm participates in the key (finding-10 stability seam)', () => {
    const withoutForm = computeLineageKey({
      repoIdentity: REPO,
      branch: 'a',
      source: 'uncommitted',
    });
    const withForm = computeLineageKey({
      repoIdentity: REPO,
      branch: 'a',
      source: 'uncommitted',
      selectorForm: '--diff main',
    });
    expect(withoutForm).not.toBe(withForm);
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
    const loaded = loadVerdictArtifact(totemDir, saved.hash);
    expect(loaded.artifact).toEqual(v);
    // rev-6 item 1: the load carries the verified stored address (= the filename stem).
    expect(loaded.contentHash).toBe(saved.hash);
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
    expect(loadVerdictArtifact(totemDir, first.hash).artifact.createdAt).toBe(
      '2026-07-10T00:00:00.000Z',
    );
  });

  it('rejects a schema-valid artifact stored under a mismatched content address (finding 4)', () => {
    const v = verdict();
    const realHash = computeVerdictArtifactContentHash(v);
    const wrongHash = 'a'.repeat(64);
    expect(wrongHash).not.toBe(realHash); // sanity
    fs.mkdirSync(verdictsDir(totemDir), { recursive: true });
    fs.writeFileSync(path.join(verdictsDir(totemDir), `${wrongHash}.json`), JSON.stringify(v));
    expect(() => loadVerdictArtifact(totemDir, wrongHash)).toThrow(TotemError);
    expect(() => loadVerdictArtifact(totemDir, wrongHash)).toThrow(
      /content-address|does not match/i,
    );
  });

  it('EEXIST with content differing modulo createdAt is a hard identity violation', () => {
    const target = verdict();
    const hash = computeVerdictArtifactContentHash(target);
    // Plant a DIFFERENT but schema-valid verdict at target's content address.
    const impostor = verdict({ diffScope: { source: 'staged', diffHash: 'e'.repeat(64) } });
    expect(computeVerdictArtifactContentHash(impostor)).not.toBe(hash); // sanity
    fs.mkdirSync(verdictsDir(totemDir), { recursive: true });
    fs.writeFileSync(path.join(verdictsDir(totemDir), `${hash}.json`), JSON.stringify(impostor));
    expect(() => saveVerdictArtifact(totemDir, target)).toThrow(TotemError);
    expect(() => saveVerdictArtifact(totemDir, target)).toThrow(
      /content-address|does not match|identity/i,
    );
  });

  it('loads a minor-newer verdict from disk; rejects a major-newer one loud', () => {
    const v17 = verdict({ schemaVersion: '1.7.0' });
    const minorHash = computeVerdictArtifactContentHash(v17);
    fs.mkdirSync(verdictsDir(totemDir), { recursive: true });
    fs.writeFileSync(path.join(verdictsDir(totemDir), `${minorHash}.json`), JSON.stringify(v17));
    expect(loadVerdictArtifact(totemDir, minorHash).artifact.schemaVersion).toBe('1.7.0');

    const v20 = verdict({ schemaVersion: '2.0.0' });
    const majorHash = computeVerdictArtifactContentHash(v20);
    fs.writeFileSync(path.join(verdictsDir(totemDir), `${majorHash}.json`), JSON.stringify(v20));
    expect(() => loadVerdictArtifact(totemDir, majorHash)).toThrow(/2\.0\.0/);
  });

  it('rejects a non-hash id before touching the filesystem', () => {
    expect(() => loadVerdictArtifact(totemDir, '../../secrets')).toThrow(/sha256/i);
  });

  it('a missing but well-formed hash throws TotemParseError', () => {
    expect(() => loadVerdictArtifact(totemDir, 'f'.repeat(64))).toThrow(TotemParseError);
  });

  it('listVerdictArtifacts returns [] when nothing has been written', () => {
    expect(listVerdictArtifacts(totemDir, noWarn)).toEqual([]);
  });

  it('a corrupt / mis-addressed artifact is warned + skipped during a lineage scan, not crashed', () => {
    const lineageKey = computeLineageKey({
      repoIdentity: '/r',
      branch: 'a',
      source: 'staged',
    });
    const good = saveVerdictArtifact(totemDir, verdict({ round: { index: 0, lineageKey } }));
    // Plant a schema-valid verdict under a WRONG filename (finding-4 mismatch).
    fs.writeFileSync(
      path.join(verdictsDir(totemDir), `${'c'.repeat(64)}.json`),
      JSON.stringify(verdict({ round: { index: 0, lineageKey } })),
    );
    const warnings: string[] = [];
    const found = findLatestVerdictForLineage(totemDir, lineageKey, (m) => warnings.push(m));
    // the good one still wins; the mis-addressed one is announced + dropped
    expect(found!.contentHash).toBe(good.hash);
    expect(warnings.some((w) => /content-address|corrupt|mis-addressed/i.test(w))).toBe(true);
  });

  it('findLatestVerdictForLineage picks the highest round.index in the lineage', () => {
    const lineageKey = computeLineageKey({
      repoIdentity: '/r',
      branch: 'a',
      source: 'staged',
    });
    const other = computeLineageKey({
      repoIdentity: '/r',
      branch: 'z',
      source: 'staged',
    });
    // Same lineage, three rounds with distinct content (index differs ⇒ distinct address).
    saveVerdictArtifact(totemDir, verdict({ round: { index: 0, lineageKey } }));
    saveVerdictArtifact(
      totemDir,
      verdict({ round: { index: 1, lineageKey, priorVerdictHash: 'a'.repeat(64) } }),
    );
    const r2 = saveVerdictArtifact(
      totemDir,
      verdict({ round: { index: 2, lineageKey, priorVerdictHash: 'b'.repeat(64) } }),
    );
    // A different lineage that must be ignored even though its index is higher.
    saveVerdictArtifact(
      totemDir,
      verdict({ round: { index: 9, lineageKey: other, priorVerdictHash: 'c'.repeat(64) } }),
    );

    const latest = findLatestVerdictForLineage(totemDir, lineageKey, noWarn);
    expect(latest?.artifact.round.index).toBe(2);
    expect(latest!.contentHash).toBe(r2.hash);
    expect(findLatestVerdictForLineage(totemDir, 'no-such-lineage', noWarn)).toBeUndefined();
  });

  it('findLatestVerdictForLineage breaks round-index ties by lexical content hash, NOT createdAt (rev-5 item 8)', () => {
    const lineageKey = computeLineageKey({
      repoIdentity: '/r',
      branch: 'a',
      source: 'staged',
    });
    // Same round.index, distinct content (priorVerdictHash differs ⇒ distinct address).
    const a = verdict({ round: { index: 1, lineageKey, priorVerdictHash: 'a'.repeat(64) } });
    const b = verdict({ round: { index: 1, lineageKey, priorVerdictHash: 'c'.repeat(64) } });
    const hashA = computeVerdictArtifactContentHash(a);
    const hashB = computeVerdictArtifactContentHash(b);
    const [winner, loser] = hashA.localeCompare(hashB) > 0 ? [a, b] : [b, a];
    const winnerHash = computeVerdictArtifactContentHash(winner);
    // Give the LOSER the LATER createdAt: a createdAt tie-break would pick it — the
    // identity-bound hash tie-break must not (createdAt excluded from identity, so
    // this does not perturb the hashes computed above).
    winner.createdAt = '2026-07-10T00:00:00.000Z';
    loser.createdAt = '2026-07-11T00:00:00.000Z';
    saveVerdictArtifact(totemDir, winner);
    saveVerdictArtifact(totemDir, loser);
    const found = findLatestVerdictForLineage(totemDir, lineageKey, noWarn)!;
    expect(found.contentHash).toBe(winnerHash);
    // Deterministic + timestamp-independent: the earlier-stamped record won on hash.
    expect(found.artifact.createdAt).toBe('2026-07-10T00:00:00.000Z');
  });

  // ── rev-5 item 5: content-address verification over the RAW logical payload ──

  it('rejects an unknown-field tamper under the old filename (rev-5 item 5a)', () => {
    const v = verdict();
    const saved = saveVerdictArtifact(totemDir, v);
    // Tamper: inject an unknown key into the stored bytes, keeping the filename.
    // The tolerant Zod parse STRIPS the key, so a normalized-output recompute would
    // still match the address and load silently — the raw-payload hash must not.
    const filePath = path.join(verdictsDir(totemDir), `${saved.hash}.json`);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    raw['injectedUnknownField'] = 'tampered';
    fs.writeFileSync(filePath, JSON.stringify(raw));
    expect(() => loadVerdictArtifact(totemDir, saved.hash)).toThrow(TotemError);
    expect(() => loadVerdictArtifact(totemDir, saved.hash)).toThrow(/content-address/i);
  });

  it('a simulated forward-minor artifact addressed over its RAW payload (extra field included) loads and verifies (rev-5 item 5b)', () => {
    // A future 1.x writer adds an additive field this reader's schema strips. Its
    // content address was computed over the RAW payload INCLUDING that field — a
    // normalized-output recompute would wrongly reject it; the raw-payload hash verifies.
    const future = {
      ...verdict({ schemaVersion: '1.7.0' }),
      futureAdditiveField: 'from-a-newer-minor',
    } as Record<string, unknown>;
    const { createdAt: _excluded, ...identity } = future;
    const rawHash = calculateDeterministicHash(identity);
    fs.mkdirSync(verdictsDir(totemDir), { recursive: true });
    fs.writeFileSync(path.join(verdictsDir(totemDir), `${rawHash}.json`), JSON.stringify(future));
    const loaded = loadVerdictArtifact(totemDir, rawHash);
    expect(loaded.artifact.schemaVersion).toBe('1.7.0');
    // The tolerant reader strips the unknown field from the RETURNED shape.
    expect('futureAdditiveField' in loaded.artifact).toBe(false);
    // rev-6 item 1: the VERIFIED stored address survives the tolerant parse.
    expect(loaded.contentHash).toBe(rawHash);
  });

  // ── rev-6 item 1: the verified stored address survives the tolerant parse ──

  it('a forward-minor artifact: covariate line, lineage selection, and round linkage all use the RAW file address (rev-6 item 1)', () => {
    const lineageKey = computeLineageKey({ repoIdentity: '/r', branch: 'a', source: 'staged' });
    // A future 1.x writer added an additive field; the on-disk address was computed over
    // the RAW payload INCLUDING it. A recompute over the Zod-stripped shape DIVERGES.
    const future = {
      ...verdict({ schemaVersion: '1.7.0', round: { index: 0, lineageKey } }),
      futureAdditiveField: 'from-a-newer-minor',
    } as Record<string, unknown>;
    const { createdAt: _excluded, ...identity } = future;
    const rawHash = calculateDeterministicHash(identity);
    fs.mkdirSync(verdictsDir(totemDir), { recursive: true });
    fs.writeFileSync(path.join(verdictsDir(totemDir), `${rawHash}.json`), JSON.stringify(future));

    const loaded = loadVerdictArtifact(totemDir, rawHash);
    // The falsifier is LIVE: the normalized recompute diverges from the raw file address.
    expect(loaded.contentHash).toBe(rawHash);
    expect(computeVerdictArtifactContentHash(loaded.artifact)).not.toBe(rawHash);

    // (a) covariate line emits the RAW file address (hash8), not the divergent recompute.
    expect(renderCovariateLine(loaded)).toBe(
      `local-lane: ${rawHash.slice(0, 8)} round=0 settled=${loaded.artifact.settled} lanes=1/1`,
    );

    // (b) lineage selection returns the RAW file address as its contentHash.
    const found = findLatestVerdictForLineage(totemDir, lineageKey, noWarn)!;
    expect(found.contentHash).toBe(rawHash);

    // (c) round linkage would set priorVerdictHash = found.contentHash — byte-equal to the
    //     filename, so it points at a REAL file (not a nonexistent recompute address).
    expect(fs.existsSync(path.join(verdictsDir(totemDir), `${found.contentHash}.json`))).toBe(true);
  });
});
