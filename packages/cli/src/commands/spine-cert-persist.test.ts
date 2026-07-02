import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  CompiledRule,
  Gate2Eligibility,
  ProvenanceRecord,
  RuleFiring,
  WindtunnelVerdict,
  WindtunnelVerdictKind,
} from '@mmnto/totem';

import { persistCertifyingOutcome } from './spine-cert-persist.js';

// ─── Fixtures ────────────────────────────────────────

const COMMIT = 'a'.repeat(40);
const NOW = '2026-06-20T23:59:59.000Z';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-cert-persist-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function provenance(mergedPr = 100): ProvenanceRecord {
  return { mergedPr, reviewThread: `pr#${mergedPr}/t1`, commitSha: COMMIT };
}

function makeRule(lessonHash: string): CompiledRule {
  return {
    lessonHash,
    lessonHeading: `Rule ${lessonHash}`,
    pattern: 'debugger',
    message: 'no debugger',
    engine: 'regex',
    compiledAt: '2026-06-20T00:00:00.000Z',
  };
}

function makeVerdict(kind: WindtunnelVerdictKind): WindtunnelVerdict {
  return {
    verdict: kind,
    precision: kind === 'PASS' ? 1.0 : null,
    mintedRuleCount: 1,
    culledCount: 0,
    survivingRuleCount: 1,
    exposureTuple: [2, 1, 1],
    cullLedger: [],
    nonVacuity: kind === 'PASS',
    needsAdjudication: [],
    diagnostics: { survivorPrecision: kind === 'PASS' ? 1.0 : null },
  };
}

/** A positive-control firing for rule r1 on pr 1, so its per-rule positiveControl is true. */
function positiveFiring(): RuleFiring {
  return {
    ruleId: 'r1',
    pr: 1,
    filePath: 'src/a.ts',
    matchedLine: 'debugger;',
    controlKind: 'positive',
    targetRuleId: 'r1',
    labelId: 'label-r1-pos',
  };
}

function baseInput(verdict: WindtunnelVerdict) {
  return {
    verdict,
    firings: [positiveFiring()],
    mintedRuleIds: ['r1'],
    positiveControlTargets: [{ pr: 1, targetRuleId: 'r1' }],
    candidates: [makeRule('r1')],
    provenanceByRule: new Map([['r1', provenance()]]),
    certifiedRulesOutPath: path.join(tmpDir, 'gate-1', 'compiled-rules.json'),
    reportDir: path.join(tmpDir, 'gate-1', 'run-reports'),
    nowIso: NOW,
    asOfCommit: COMMIT,
  };
}

// ─── Tests ───────────────────────────────────────────

describe('persistCertifyingOutcome', () => {
  it('PASS ⟹ writes stamped PASS-survivors to the cert output + a run report', async () => {
    const result = await persistCertifyingOutcome(baseInput(makeVerdict('PASS')));

    expect(result.persisted).toBe(true);
    expect(result.stampedCount).toBe(1);
    expect(result.certifiedRulesPath).toBeDefined();

    // The certified-rules file exists and carries the hard-stamped survivor.
    const written = JSON.parse(fs.readFileSync(result.certifiedRulesPath!, 'utf-8'));
    expect(written.rules).toHaveLength(1);
    expect(written.rules[0].lessonHash).toBe('r1');
    expect(written.rules[0].ruleClass).toBe('hard');
    expect(written.rules[0].legitimacy.positiveControl).toBe(true);
    expect(written.rules[0].unverified).toBe(false);

    // The transient report exists and records the PASS outcome.
    const report = JSON.parse(fs.readFileSync(result.reportPath, 'utf-8'));
    expect(report.kind).toBe('windtunnel-cert-run.v1');
    expect(report.persisted).toBe(true);
    expect(report.verdict.verdict).toBe('PASS');
    expect(report.stampedRuleIds).toEqual(['r1']);
  });

  it('non-PASS ⟹ writes NO cert rules (corpus untouched) but STILL writes a report (§6 L3)', async () => {
    const result = await persistCertifyingOutcome(baseInput(makeVerdict('HONEST-NEGATIVE')));

    expect(result.persisted).toBe(false);
    expect(result.stampedCount).toBe(0);
    expect(result.certifiedRulesPath).toBeUndefined();
    // No compiled-rules file written anywhere under the cert output dir.
    expect(fs.existsSync(path.join(tmpDir, 'gate-1', 'compiled-rules.json'))).toBe(false);

    // The report IS written, recording the non-terminal outcome.
    const report = JSON.parse(fs.readFileSync(result.reportPath, 'utf-8'));
    expect(report.persisted).toBe(false);
    expect(report.verdict.verdict).toBe('HONEST-NEGATIVE');
    expect(report.skips).toContainEqual({ reason: 'verdict-not-pass', verdict: 'HONEST-NEGATIVE' });

    // #2237 papercut-3: firing detail is persisted REGARDLESS of verdict — a non-PASS
    // run must still carry the (rule, pr, file, matched-line) records for blind-by-pattern
    // adjudication, not only the needsAdjudication labelId hashes the verdict surfaces.
    expect(report.firings).toEqual([
      {
        labelId: 'label-r1-pos',
        ruleId: 'r1',
        pr: 1,
        filePath: 'src/a.ts',
        matchedLine: 'debugger;',
        controlKind: 'positive',
        targetRuleId: 'r1',
      },
    ]);
  });

  it('the report filename embeds the injected timestamp slug + a run-identity hash', async () => {
    const result = await persistCertifyingOutcome(baseInput(makeVerdict('PASS')));
    expect(path.basename(result.reportPath)).toMatch(/^run-20260620T235959-[0-9a-f]{12}\.json$/);
  });

  it('authored run ⟹ the verdict-inert gate2 set persists as a TOP-LEVEL report field, not folded into verdict (D4 Q2)', async () => {
    const gate2: Gate2Eligibility = {
      eligibleRuleIds: ['r1'],
      survivors: [
        { ruleId: 'r1', heldOutActivations: 3, gate2Eligible: true },
        { ruleId: 'r2', heldOutActivations: 0, gate2Eligible: false },
      ],
      windowDisqualified: false,
    };
    const result = await persistCertifyingOutcome({ ...baseInput(makeVerdict('PASS')), gate2 });

    const report = JSON.parse(fs.readFileSync(result.reportPath, 'utf-8'));
    // Serialized in full (shape, not just presence) as a top-level sibling of `verdict`.
    expect(report.gate2).toEqual(gate2);
    // Altitude separation: gate2 is DERIVED from the verdict, never part of it.
    expect('gate2' in report.verdict).toBe(false);
  });

  it('mined/default run ⟹ the report OMITS the gate2 key entirely (not null)', async () => {
    const result = await persistCertifyingOutcome(baseInput(makeVerdict('PASS')));
    const report = JSON.parse(fs.readFileSync(result.reportPath, 'utf-8'));
    // Key is absent, not serialized-as-null — a mined run has no Gate-2 emission.
    expect('gate2' in report).toBe(false);
  });
});
