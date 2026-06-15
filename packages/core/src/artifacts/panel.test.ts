/**
 * Panel-synthesis engine tests (mmnto-ai/totem#2104, strategy#474 slice 5).
 *
 * The invariants the cohort + strategy pre-build rounds locked in:
 *   - Tenet 9: aggregation is a pure deterministic script (order-independent).
 *   - dedup anchor = `ruleName`; divergence = pass∧fail present, abstain neutral.
 *   - honest diversity (Prop 291): distinctProviders is a cluster count only while
 *     provider-string ≡ family; an unrecognized string trips `coarse` (PP1 tripwire).
 *   - sensor-only: no panel-level gate field (PP3).
 *   - codex folds: persist reports w/ ADR-109 invariant at write+read; within-lane
 *     duplicate ruleName throws; conflicting tier throws; canonical-order hash.
 *   - agy folds: missing ruleName across lanes ⇒ implicit abstain (Σ === N); N=1.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TotemParseError } from '../errors.js';
import { cleanTmpDir } from '../test-utils.js';
import {
  assemblePanelArtifact,
  classifyDiversity,
  computePanelArtifactContentHash,
  PANEL_ARTIFACT_SCHEMA_VERSION,
  PanelArtifactSchema,
  type PanelLaneInput,
  panelsDir,
  readPanelArtifact,
  synthesizePanel,
  writePanelArtifact,
} from './panel.js';
import type {
  CheckVerdict,
  EnforcementTier,
  PostCheckFinding,
  PostCheckReport,
} from './post-checks.js';
import { RUN_ARTIFACT_SCHEMA_VERSION, type RunArtifact } from './schema.js';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function runArtifact(provider: string, seed = provider): RunArtifact {
  return {
    schemaVersion: RUN_ARTIFACT_SCHEMA_VERSION,
    inputBundle: { maskedPrompt: `prompt ${seed}` },
    inputHash: 'a'.repeat(64),
    grounding: { hash: 'b'.repeat(64), provenanceSummary: 'similarity-only' },
    backend: {
      provider,
      model: `${provider}-model`,
      qualifiedModel: `${provider}:${provider}-model`,
      admissionClass: 'completion_only',
      taskProfile: 'Review',
    },
    output: { content: `response ${seed}`, metrics: { durationMs: 1000 } },
    createdAt: '2026-06-14T00:00:00.000Z',
  };
}

function finding(
  ruleName: string,
  verdict: CheckVerdict,
  tier: EnforcementTier = 'decidable',
  message = `${ruleName}:${verdict}`,
): PostCheckFinding {
  return { ruleName, tier, verdict, message };
}

function report(findings: PostCheckFinding[], isRejected?: boolean): PostCheckReport {
  return {
    findings,
    isRejected: isRejected ?? findings.some((f) => f.tier === 'decidable' && f.verdict === 'fail'),
  };
}

function lane(
  laneId: string,
  provider: string,
  findings: PostCheckFinding[] = [],
  isRejected?: boolean,
): PanelLaneInput {
  return { laneId, artifact: runArtifact(provider, laneId), report: report(findings, isRejected) };
}

const AT = '2026-06-14T12:00:00.000Z';

// ─── classifyDiversity ───────────────────────────────────────────────────────

describe('classifyDiversity — honest labeling (Prop 291)', () => {
  it('two same-family lanes are same-vendor-isolated, not cross-vendor', () => {
    const d = classifyDiversity(['gemini', 'gemini']);
    expect(d).toMatchObject({
      distinctProviders: 1,
      class: 'same-vendor-isolated',
      diversityConfidence: 'verified',
      unrecognizedProviders: [],
    });
    expect(d.providers).toEqual(['gemini', 'gemini']); // lossless
  });

  it('distinct families are cross-vendor + verified', () => {
    expect(classifyDiversity(['gemini', 'anthropic'])).toMatchObject({
      distinctProviders: 2,
      class: 'cross-vendor',
      diversityConfidence: 'verified',
      unrecognizedProviders: [],
    });
  });

  it('PP1 tripwire: an unrecognized provider string is coarse, never a confident cross-vendor', () => {
    const d = classifyDiversity(['gemini', 'vertex']);
    expect(d.distinctProviders).toBe(2);
    expect(d.unrecognizedProviders).toEqual(['vertex']);
    // The class reflects the raw count, but confidence MUST flag it untrustworthy
    // so a consumer cannot read it as a confident independent-cluster claim.
    expect(d.diversityConfidence).toBe('coarse');
  });

  it('N=1 baseline labels cleanly without throwing', () => {
    expect(classifyDiversity(['anthropic'])).toMatchObject({
      distinctProviders: 1,
      class: 'same-vendor-isolated',
      diversityConfidence: 'verified',
    });
  });
});

// ─── synthesizePanel ─────────────────────────────────────────────────────────

describe('synthesizePanel — deterministic aggregation (Tenet 9)', () => {
  it('groups findings by ruleName across lanes (one entry per rule)', () => {
    const s = synthesizePanel([
      lane('l1', 'gemini', [finding('rA', 'pass')]),
      lane('l2', 'gemini', [finding('rA', 'pass')]),
      lane('l3', 'gemini', [finding('rA', 'pass')]),
    ]);
    expect(s.findings).toHaveLength(1);
    expect(s.findings[0]).toMatchObject({ ruleName: 'rA', tier: 'decidable' });
    expect(s.findings[0].verdicts).toEqual({ pass: 3, fail: 0, abstain: 0 });
  });

  it('is order-independent under lane permutation', () => {
    const lanes = [
      lane('l1', 'gemini', [finding('rA', 'pass'), finding('rB', 'fail')]),
      lane('l2', 'anthropic', [finding('rA', 'fail'), finding('rB', 'fail')]),
      lane('l3', 'openai', [finding('rA', 'pass')]),
    ];
    const forward = synthesizePanel(lanes);
    const reversed = synthesizePanel([...lanes].reverse());
    expect(reversed).toEqual(forward);
  });

  it('divergence: a rule with both pass and fail is divergent; abstain is neutral', () => {
    const s = synthesizePanel([
      lane('l1', 'gemini', [finding('rDiv', 'pass'), finding('rCalm', 'pass')]),
      lane('l2', 'gemini', [finding('rDiv', 'fail'), finding('rCalm', 'abstain')]),
    ]);
    const div = s.findings.find((f) => f.ruleName === 'rDiv')!;
    const calm = s.findings.find((f) => f.ruleName === 'rCalm')!;
    expect(div.divergent).toBe(true);
    expect(calm.divergent).toBe(false); // pass + abstain is NOT divergence
    expect(s.divergences).toBe(1);
  });

  it('missing ruleName across lanes counts as implicit abstain (Σ verdicts === lane count)', () => {
    const s = synthesizePanel([
      lane('l1', 'gemini', [finding('rOnly1', 'pass')]),
      lane('l2', 'gemini', []), // rOnly1 absent here
    ]);
    const f = s.findings.find((x) => x.ruleName === 'rOnly1')!;
    expect(f.verdicts).toEqual({ pass: 1, fail: 0, abstain: 1 });
    const sum = f.verdicts.pass + f.verdicts.fail + f.verdicts.abstain;
    expect(sum).toBe(2);
  });

  it('preserves lane messages verbatim, sorted', () => {
    const s = synthesizePanel([
      lane('l1', 'gemini', [finding('rA', 'pass', 'decidable', 'zebra reason')]),
      lane('l2', 'gemini', [finding('rA', 'pass', 'decidable', 'apple reason')]),
    ]);
    expect(s.findings[0].messages).toEqual(['apple reason', 'zebra reason']);
  });

  it('verdictDistribution tallies each lane isRejected (accepted/rejected, sums to N)', () => {
    const s = synthesizePanel([
      lane('l1', 'gemini', [finding('rA', 'fail')]), // decidable fail ⇒ rejected
      lane('l2', 'gemini', [finding('rA', 'pass')]), // accepted
      lane('l3', 'gemini', [finding('rA', 'pass')]), // accepted
    ]);
    expect(s.verdictDistribution).toEqual({ accepted: 2, rejected: 1 });
  });

  it('throws on a within-lane duplicate ruleName (codex #2)', () => {
    expect(() =>
      synthesizePanel([lane('l1', 'gemini', [finding('rDup', 'pass'), finding('rDup', 'fail')])]),
    ).toThrow(/duplicate finding for ruleName/);
  });

  it('throws on conflicting tier for one ruleName across lanes (codex #9)', () => {
    expect(() =>
      synthesizePanel([
        lane('l1', 'gemini', [finding('rT', 'pass', 'decidable')]),
        lane('l2', 'gemini', [finding('rT', 'pass', 'sensor')]),
      ]),
    ).toThrow(/conflicting tiers/);
  });

  it('throws on zero lanes', () => {
    expect(() => synthesizePanel([])).toThrow(/at least one lane/);
  });
});

// ─── sensor-only: NO panel gate field (PP3) ──────────────────────────────────

describe('panel is a sensor, never a gate (PP3)', () => {
  it('PanelSynthesis exposes only verdictDistribution/findings/divergences', () => {
    const s = synthesizePanel([lane('l1', 'gemini', [finding('rA', 'fail')])]);
    expect(Object.keys(s).sort()).toEqual(['divergences', 'findings', 'verdictDistribution']);
    expect(s).not.toHaveProperty('isRejected');
    expect(s).not.toHaveProperty('verdict');
    expect(s).not.toHaveProperty('accepted');
  });

  it('PanelArtifact exposes no top-level gate boolean', () => {
    const a = assemblePanelArtifact([lane('l1', 'gemini', [finding('rA', 'fail')])], AT);
    expect(Object.keys(a).sort()).toEqual([
      'createdAt',
      'diversity',
      'lanes',
      'schemaVersion',
      'synthesis',
    ]);
    expect(a).not.toHaveProperty('isRejected');
  });
});

// ─── assemble + schema version tolerance ─────────────────────────────────────

describe('assemblePanelArtifact + schema-version tolerance (F1)', () => {
  it('assembles a canonical artifact (lanes sorted by laneId)', () => {
    const a = assemblePanelArtifact(
      [
        lane('zzz', 'gemini', [finding('rA', 'pass')]),
        lane('aaa', 'anthropic', [finding('rA', 'pass')]),
      ],
      AT,
    );
    expect(a.lanes.map((l) => l.laneId)).toEqual(['aaa', 'zzz']);
    expect(a.diversity.class).toBe('cross-vendor');
    expect(a.schemaVersion).toBe(PANEL_ARTIFACT_SCHEMA_VERSION);
  });

  it('rejects an input lane whose report.isRejected breaks the ADR-109 invariant', () => {
    // isRejected:true but no decidable fail ⇒ corrupt; assemble validates on the way out.
    const bad = lane('l1', 'gemini', [finding('rA', 'pass')], /* isRejected */ true);
    expect(() => assemblePanelArtifact([bad], AT)).toThrow();
  });

  it('accepts any 1.x schemaVersion, rejects ≥2.x loud', () => {
    const a = assemblePanelArtifact([lane('l1', 'gemini', [finding('rA', 'pass')])], AT);
    expect(() => PanelArtifactSchema.parse({ ...a, schemaVersion: '1.5.0' })).not.toThrow();
    expect(() => PanelArtifactSchema.parse({ ...a, schemaVersion: '2.0.0' })).toThrow();
  });
});

// ─── cross-field invariants Zod-enforced, not just documented (greptile P2 / CR) ──

describe('cross-field invariants fail parse, not silently pass (greptile P2, CR F1/F2)', () => {
  // rA: fail in l1, pass in l2 ⇒ divergent; 2 lanes ⇒ N=2, verdictDistribution {1,1}.
  const valid = () =>
    assemblePanelArtifact(
      [
        lane('l1', 'gemini', [finding('rA', 'fail')]),
        lane('l2', 'anthropic', [finding('rA', 'pass')]),
      ],
      AT,
    );

  it('a verdictDistribution that does not sum to lane count fails parse', () => {
    const c = structuredClone(valid());
    c.synthesis.verdictDistribution.accepted = 99;
    expect(() => PanelArtifactSchema.parse(c)).toThrow();
  });

  it('a finding whose verdicts do not sum to lane count fails parse', () => {
    const c = structuredClone(valid());
    c.synthesis.findings[0].verdicts.pass += 5;
    expect(() => PanelArtifactSchema.parse(c)).toThrow();
  });

  it('a stale divergences count fails parse', () => {
    const c = structuredClone(valid());
    c.synthesis.divergences += 1;
    expect(() => PanelArtifactSchema.parse(c)).toThrow();
  });

  it('a divergent flag inconsistent with its verdicts fails parse', () => {
    const c = structuredClone(valid());
    c.synthesis.findings[0].divergent = false; // rA is genuinely divergent
    c.synthesis.divergences = 0; // keep the count consistent so only the flag check fires
    expect(() => PanelArtifactSchema.parse(c)).toThrow();
  });

  it('a diversity.providers length mismatch with lane count fails parse', () => {
    const c = structuredClone(valid());
    c.diversity.providers = [...c.diversity.providers, 'extra'];
    expect(() => PanelArtifactSchema.parse(c)).toThrow();
  });

  it('a providers array with wrong contents (right length + distinct count) fails parse', () => {
    const c = structuredClone(valid());
    // lanes are l1=gemini, l2=anthropic; swap providers so length (2) and distinct
    // count (2) still match but the per-lane mapping is wrong (CodeRabbit round 2).
    c.diversity.providers = ['anthropic', 'gemini'];
    expect(() => PanelArtifactSchema.parse(c)).toThrow();
  });

  it('a diversityConfidence overclaiming "verified" over an unrecognized provider fails parse (greptile — PP1 read guard)', () => {
    // A lane genuinely on an unrecognized provider assembles correctly as coarse.
    const a = assemblePanelArtifact(
      [
        lane('l1', 'gemini', [finding('rA', 'pass')]),
        lane('l2', 'vertex', [finding('rA', 'pass')]),
      ],
      AT,
    );
    expect(a.diversity.diversityConfidence).toBe('coarse'); // sanity: correct assembly
    const c = structuredClone(a);
    c.diversity.diversityConfidence = 'verified'; // overclaim — must not pass read
    expect(() => PanelArtifactSchema.parse(c)).toThrow();
  });

  it('a class inconsistent with providers fails parse (greptile — re-derived label)', () => {
    const a = assemblePanelArtifact(
      [
        lane('l1', 'gemini', [finding('rA', 'pass')]),
        lane('l2', 'gemini', [finding('rA', 'pass')]),
      ],
      AT,
    );
    const c = structuredClone(a); // providers ['gemini','gemini'] ⇒ same-vendor-isolated
    c.diversity.class = 'cross-vendor'; // overclaim
    expect(() => PanelArtifactSchema.parse(c)).toThrow();
  });
});

// ─── storage: content-address, dedup, round-trip, invariant-at-read ──────────

describe('panel storage (mirrors run storage)', () => {
  let totemDir: string;

  beforeEach(() => {
    totemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-panel-'));
  });
  afterEach(() => {
    cleanTmpDir(totemDir);
  });

  it('writes at artifacts/panels/<hash>.json and reads it back', () => {
    const a = assemblePanelArtifact([lane('l1', 'gemini', [finding('rA', 'pass')])], AT);
    const saved = writePanelArtifact(totemDir, a);
    expect(saved.existed).toBe(false);
    expect(saved.path).toBe(path.join(totemDir, 'artifacts', 'panels', `${saved.hash}.json`));
    expect(panelsDir(totemDir)).toBe(path.join(totemDir, 'artifacts', 'panels'));
    expect(readPanelArtifact(totemDir, saved.hash)).toEqual(a);
  });

  it('content address excludes createdAt — identical panels dedup across time', () => {
    const lanes = [lane('l1', 'gemini', [finding('rA', 'pass')])];
    const early = assemblePanelArtifact(lanes, '2026-06-14T00:00:00.000Z');
    const late = assemblePanelArtifact(lanes, '2026-06-15T09:30:00.000Z');
    expect(computePanelArtifactContentHash(early)).toBe(computePanelArtifactContentHash(late));
    const first = writePanelArtifact(totemDir, early);
    const second = writePanelArtifact(totemDir, late);
    expect(second.existed).toBe(true);
    expect(second.hash).toBe(first.hash);
    // first-write-wins: the stored createdAt is the early one.
    expect(readPanelArtifact(totemDir, first.hash).createdAt).toBe('2026-06-14T00:00:00.000Z');
  });

  it('content address is stable under lane input permutation', () => {
    const a = [
      lane('a', 'gemini', [finding('rA', 'pass')]),
      lane('b', 'anthropic', [finding('rA', 'fail')]),
    ];
    const h1 = computePanelArtifactContentHash(assemblePanelArtifact(a, AT));
    const h2 = computePanelArtifactContentHash(assemblePanelArtifact([...a].reverse(), AT));
    expect(h1).toBe(h2);
  });

  it('throws TotemParseError on a ≥2.x panel on disk', () => {
    const a = assemblePanelArtifact([lane('l1', 'gemini', [finding('rA', 'pass')])], AT);
    const hash = 'c'.repeat(64);
    fs.mkdirSync(panelsDir(totemDir), { recursive: true });
    fs.writeFileSync(
      path.join(panelsDir(totemDir), `${hash}.json`),
      JSON.stringify({ ...a, schemaVersion: '2.0.0' }),
    );
    expect(() => readPanelArtifact(totemDir, hash)).toThrow(TotemParseError);
  });

  it('throws on a disk panel whose persisted report breaks the isRejected invariant', () => {
    const a = assemblePanelArtifact([lane('l1', 'gemini', [finding('rA', 'pass')])], AT);
    const corrupt = structuredClone(a);
    corrupt.lanes[0].report.isRejected = true; // no decidable fail ⇒ invariant broken
    const hash = 'd'.repeat(64);
    fs.mkdirSync(panelsDir(totemDir), { recursive: true });
    fs.writeFileSync(path.join(panelsDir(totemDir), `${hash}.json`), JSON.stringify(corrupt));
    expect(() => readPanelArtifact(totemDir, hash)).toThrow(TotemParseError);
  });

  it('rejects a disk panel with an inconsistent tally (greptile P2 / CR — re-auditable contract)', () => {
    const a = assemblePanelArtifact([lane('l1', 'gemini', [finding('rA', 'pass')])], AT);
    const corrupt = structuredClone(a);
    corrupt.synthesis.verdictDistribution.accepted = 99; // no longer sums to lane count
    const badHash = 'e'.repeat(64);
    fs.mkdirSync(panelsDir(totemDir), { recursive: true });
    fs.writeFileSync(path.join(panelsDir(totemDir), `${badHash}.json`), JSON.stringify(corrupt));
    expect(() => readPanelArtifact(totemDir, badHash)).toThrow(TotemParseError);
  });

  it('rejects an invalid id (not a sha256 hex)', () => {
    expect(() => readPanelArtifact(totemDir, 'not-a-hash')).toThrow(TotemParseError);
  });

  it('throws TotemParseError when a valid hash points to a non-existent file (greptile P2, doc contract)', () => {
    const missing = 'f'.repeat(64); // well-formed id, but no file on disk
    expect(() => readPanelArtifact(totemDir, missing)).toThrow(TotemParseError);
  });
});
