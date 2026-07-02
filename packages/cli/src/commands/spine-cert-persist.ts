import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type {
  CompiledRule,
  Gate2Eligibility,
  LegitimacyProjectionSkip,
  ProvenanceRecord,
  RuleFiring,
  WindtunnelVerdict,
} from '@mmnto/totem';

// ─── Certifying-run persistence (fold-B project → fold-C persist + report) ───

export interface CertPersistInput {
  /** The scorer verdict for this run. */
  verdict: WindtunnelVerdict;
  /** Firings the verdict was computed over (for the C1 control map + report). */
  firings: RuleFiring[];
  /** Minted (active) rule ids the scorer evaluated. */
  mintedRuleIds: string[];
  /** Positive-control targets (for the per-rule control map). */
  positiveControlTargets: Array<{ pr: number; targetRuleId: string }>;
  /** Candidate compiled rules eligible for stamping (the corpus rules). */
  candidates: CompiledRule[];
  /** Mining provenance per rule (lessonHash → provenance). */
  provenanceByRule: Map<string, ProvenanceRecord>;
  /**
   * Where PASS-survivors are written (the cert OUTPUT compiled-rules file under
   * the gate-1 dir — NOT the repo's live `.totem/compiled-rules.json`, which the
   * strategy#516 populator owns). Required: no default to the live corpus, so a
   * cert run can never clobber it.
   */
  certifiedRulesOutPath: string;
  /** Directory for the transient cert-run report (§6 L3). */
  reportDir: string;
  /** Injected ISO timestamp (report filename + body) — keeps the call testable. */
  nowIso: string;
  /** Corpus identity for the report (the lock's asOfCommit). */
  asOfCommit: string;
  /**
   * ADR-112 §5.3 Slice D4 (strategy Q2) — the downstream, VERDICT-INERT Gate-2-eligible
   * set for an authored run (`survivors ∩ {heldOut>0}`, §1(k)-guarded + illegitimate-window
   * disqualifier). Absent on mined runs. Persisted as a top-level report field (a sibling of
   * `verdict`, NOT folded into it): it is DERIVED from the verdict, never part of it, so the
   * durable artifact keeps the two altitudes legibly separate.
   */
  gate2?: Gate2Eligibility;
}

export interface CertPersistResult {
  /** True iff PASS-survivors were written to the cert output (PASS only). */
  persisted: boolean;
  /** Number of survivor rules stamped + written. */
  stampedCount: number;
  /** Absolute path of the transient cert-run report. */
  reportPath: string;
  /** Path of the written cert rules file (only when persisted). */
  certifiedRulesPath?: string;
  /** Projection skips (non-survivors / missing-provenance / verdict-not-pass). */
  skips: LegitimacyProjectionSkip[];
}

/** Filesystem-safe slug for an ISO timestamp (`2026-06-20T23:59:59.000Z` → `20260620T235959`). */
function timestampSlug(nowIso: string): string {
  return nowIso
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, '')
    .replace('Z', '');
}

/**
 * The certifying-run persistence boundary (§6 L3 + bindings 1+4).
 *
 * 1. Computes the C1 per-rule control map from the firings (survivor-only).
 * 2. fold-B `projectLegitimacy`: stamps survivors PASS-only, from their OWN
 *    control results (never the global nonVacuity); non-PASS stamps nothing.
 * 3. fold-C `buildCertifiedRulesFile`: parses the payload BEFORE any write, so a
 *    half-stamp fails loud pre-disk. On PASS with ≥1 survivor, the validated
 *    file is written to `certifiedRulesOutPath` (the cert OUTPUT, never the live
 *    corpus — strategy#516 promotes from here).
 * 4. Always writes a transient cert-run report (verdict + skips + cull ledger +
 *    needs-adjudication + exposure) under `reportDir` — including for non-PASS
 *    runs, which write a report but NO rules (L3: non-terminals never reach the
 *    corpus).
 *
 * The clock + paths are injected so the whole step is deterministically testable
 * with a tmpdir, no real lock required.
 */
export async function persistCertifyingOutcome(
  input: CertPersistInput,
): Promise<CertPersistResult> {
  const {
    computePerRuleControlResults,
    projectLegitimacy,
    buildCertifiedRulesFile,
    saveCompiledRulesFile,
  } = await import('@mmnto/totem');

  const perRuleControls = computePerRuleControlResults({
    firings: input.firings,
    mintedRuleIds: input.mintedRuleIds,
    positiveControlTargets: input.positiveControlTargets,
  });

  // fold-B — survivor-only, PASS-only legitimacy projection.
  const projection = projectLegitimacy({
    verdict: input.verdict,
    perRuleControls,
    candidates: input.candidates,
    provenanceByRule: input.provenanceByRule,
  });

  let persisted = false;
  let certifiedRulesPath: string | undefined;
  if (input.verdict.verdict === 'PASS' && projection.stamped.length > 0) {
    // fold-C — parse-before-write net (throws loud on any half-stamp pre-disk).
    const file = buildCertifiedRulesFile(projection.stamped);
    fs.mkdirSync(path.dirname(input.certifiedRulesOutPath), { recursive: true });
    saveCompiledRulesFile(input.certifiedRulesOutPath, file);
    persisted = true;
    certifiedRulesPath = input.certifiedRulesOutPath;
  }

  // Transient cert-run report (§6 L3) — never the live corpus.
  const report = {
    kind: 'windtunnel-cert-run.v1' as const,
    generatedAt: input.nowIso,
    asOfCommit: input.asOfCommit,
    verdict: input.verdict,
    // D4 (strategy Q2): verdict-inert Gate-2 eligibility, authored runs only. Top-level
    // sibling of `verdict` — derived from it, never part of it (mined runs omit the key).
    ...(input.gate2 ? { gate2: input.gate2 } : {}),
    persisted,
    stampedRuleIds: projection.stamped.map((r) => r.lessonHash),
    skips: projection.skips,
    firingCount: input.firings.length,
    // #2237 papercut-3: persist per-firing detail REGARDLESS of verdict. The verdict
    // surfaces only `needsAdjudication` labelId hashes; a FAIL / honest-negative run
    // dropped the (rule, pr, file, matched-line) records entirely, blocking
    // blind-by-pattern adjudication observability (e.g. cert #1's 2 firings could not
    // be re-surfaced without a re-run). Persist them on every verdict.
    firings: input.firings.map((f) => ({
      labelId: f.labelId,
      ruleId: f.ruleId,
      pr: f.pr,
      filePath: f.filePath,
      matchedLine: f.matchedLine,
      controlKind: f.controlKind,
      ...(f.targetRuleId ? { targetRuleId: f.targetRuleId } : {}),
    })),
  };
  // Content hash over the run identity (NOT the timestamp) so the same run is
  // recognizable across re-runs; the timestamp disambiguates the filename.
  const reportHash = createHash('sha256')
    .update(
      JSON.stringify({
        asOfCommit: input.asOfCommit,
        verdict: input.verdict.verdict,
        labelIds: input.firings.map((f) => f.labelId).sort(),
      }),
    )
    .digest('hex')
    .slice(0, 12);
  const reportPath = path.join(
    input.reportDir,
    `run-${timestampSlug(input.nowIso)}-${reportHash}.json`,
  );
  fs.mkdirSync(input.reportDir, { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');

  return {
    persisted,
    stampedCount: projection.stamped.length,
    reportPath,
    certifiedRulesPath,
    skips: projection.skips,
  };
}
