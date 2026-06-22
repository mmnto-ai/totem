import type { CorpusDisposition } from './corpus-dispositions.js';
import { classifyDisposition, dispositionToLabel } from './disposition-taxonomy.js';
import { normalizeMatchedLine } from './windtunnel-firing.js';
import type { GroundTruthLabel, RuleFiring } from './windtunnel-scorer.js';

/**
 * strategy#709 5d-iii — the ground-truth label deriver (pure core).
 *
 * Produces the cert-run answer key (`firingLabelId → TP|FP`) by joining the
 * enumerated `RuleFiring`s against the frozen held-out `CorpusDisposition`s, then
 * classifying each bound thread through the closed 5d-i taxonomy. The CLI
 * `derive-labels` command supplies firings enumerated byte-identically to the
 * certifying run (shared firing-setup) and the integrity-gated dispositions;
 * this function is the deterministic, zero-LLM transform between them.
 *
 * Span-join invariant (codex hard fold): a corpus firing binds to a disposition
 * thread on the SAME pr ONLY when (a) the thread's path matches the firing's
 * file and (b) the firing's normalized `matchedLine` equals an ADDED (`+`)
 * post-image row of the thread's `diffHunk`. Context rows, removed rows, hunk
 * headers, and file headers are INELIGIBLE — a disposition labels a firing only
 * by content the PR actually added, never by a line it merely sits near. 0 or
 * >1 bound threads ⟹ omit (the scorer routes the un-keyed firing to
 * `needsAdjudication`).
 */

/** Why a non-negative firing received no label (diagnostic only; never in the answer key). */
export type UnlabeledReason =
  /** corpus firing: no disposition thread bound by path + added-line content. */
  | 'no-matching-disposition'
  /** corpus firing: >1 disposition thread bound — ambiguous, never labels. */
  | 'ambiguous-multiple-dispositions'
  /** corpus firing: a thread bound, but its taxonomy class is non-label-bearing (UNLABELED). */
  | 'unlabeled-class'
  /** positive-control firing that is NOT the declared (pr, targetRuleId) target. */
  | 'incidental-positive';

/**
 * Deriver-side data-quality diagnostics (gemini: deriver reports DATA QUALITY,
 * the scorer reports MODEL PERFORMANCE). Deterministic + zero-LLM. Surfaced so a
 * sparse first verdict reads as "here's the coverage + why", not a silent fail.
 */
export interface DeriveLabelDiagnostics {
  /** Total firings enumerated (all control kinds). */
  totalFirings: number;
  /** Negative-control firings (no label — the scorer culls the rule). */
  negativeFirings: number;
  /** Corpus firings (the real precision surface). */
  corpusFirings: number;
  /** Positive-control firings. */
  positiveFirings: number;
  /** Corpus firings that received a TP/FP label. */
  boundCorpusFirings: number;
  /** boundCorpusFirings / corpusFirings — 0 when there are no corpus firings. */
  dispositionDensity: number;
  /** Non-negative firings with no label (the scorer's future `needsAdjudication` set). */
  unlabeledFirings: number;
  /** unlabeledFirings / (corpusFirings + positiveFirings) — 0 when that denominator is 0. */
  unlabeledRate: number;
  /** Label counts in the emitted answer key. */
  labelCounts: { TP: number; FP: number };
  /** Per-rule labeled-firing counts (ruleId → {TP, FP}); only rules that labeled appear. */
  perRuleLabeled: Record<string, { TP: number; FP: number }>;
  /** Breakdown of why firings went unlabeled. */
  unlabeledByReason: Record<UnlabeledReason, number>;
}

/**
 * Provenance for one emitted label — links the answer-key entry back to its
 * disposition source for audit. NOT part of the hashed answer key (whose values
 * stay a bare `TP|FP`); surfaced in the deriver's report only.
 */
export interface LabelEvidence {
  labelId: string;
  label: GroundTruthLabel;
  pr: number;
  ruleId: string;
  filePath: string;
  /** Source disposition thread id (corpus labels only; positive-target labels omit it). */
  threadId?: string;
  /** Root review-comment databaseId of the bound thread (corpus labels only). */
  commentId?: number;
  source: 'corpus-disposition' | 'positive-control-target';
}

export interface DeriveLabelsResult {
  /**
   * The answer key: `firingLabelId → TP|FP`. The ONLY thing written to
   * `ground-truth-labels.json` (and the bytes `groundTruthSha` covers).
   */
  labels: Record<string, GroundTruthLabel>;
  diagnostics: DeriveLabelDiagnostics;
  /** Per-label provenance (audit; surfaced in the report, never in the hashed key). */
  evidence: LabelEvidence[];
}

/**
 * Extract the normalized ADDED (`+`) post-image rows of a unified-diff hunk.
 * Only `+`-prefixed content rows are eligible: context rows (leading space),
 * removed rows (`-`), the hunk header (`@@`), file headers (`+++`/`---`), and
 * the no-newline marker (`\`) are all excluded. Each eligible row is stripped of
 * its leading `+` and normalized with `normalizeMatchedLine` (the SAME rule the
 * firing's `matchedLine` is built with) so the content bind keys on identical
 * bytes.
 */
function addedHunkLines(diffHunk: string): Set<string> {
  const added = new Set<string>();
  for (const row of diffHunk.split('\n')) {
    if (row.charCodeAt(0) !== 0x2b /* '+' */) continue; // added rows only
    if (row.startsWith('+++')) continue; // file header, not added content
    added.add(normalizeMatchedLine(row.slice(1)));
  }
  return added;
}

/**
 * Derive the cert-run ground-truth answer key from enumerated firings + frozen
 * held-out dispositions. Pure + deterministic — no I/O, no clock, no LLM.
 */
export function deriveLabelsFromDispositions(
  firings: readonly RuleFiring[],
  dispositions: readonly CorpusDisposition[],
): DeriveLabelsResult {
  const dispByPr = new Map<number, CorpusDisposition>();
  for (const d of dispositions) dispByPr.set(d.pr, d);

  const labels: Record<string, GroundTruthLabel> = {};
  const evidence: LabelEvidence[] = [];
  const perRuleLabeled: Record<string, { TP: number; FP: number }> = {};
  const labelCounts = { TP: 0, FP: 0 };
  const unlabeledByReason: Record<UnlabeledReason, number> = {
    'no-matching-disposition': 0,
    'ambiguous-multiple-dispositions': 0,
    'unlabeled-class': 0,
    'incidental-positive': 0,
  };
  let negativeFirings = 0;
  let corpusFirings = 0;
  let positiveFirings = 0;
  let boundCorpusFirings = 0;

  const emit = (firing: RuleFiring, label: GroundTruthLabel, ev: LabelEvidence): void => {
    labels[firing.labelId] = label;
    labelCounts[label] += 1;
    (perRuleLabeled[firing.ruleId] ??= { TP: 0, FP: 0 })[label] += 1;
    evidence.push(ev);
  };

  for (const firing of firings) {
    switch (firing.controlKind) {
      case 'negative':
        // Negative controls never label — the scorer culls the firing rule (S2/C5).
        negativeFirings += 1;
        break;
      case 'positive': {
        positiveFirings += 1;
        // TP structurally ONLY for the declared (pr, targetRuleId) target firing
        // (codex BLOCKING-1). An incidental non-target firing on a positive
        // fixture is NOT laundered TP — omit it and report; the scorer routes the
        // un-keyed firing to needsAdjudication.
        if (firing.targetRuleId !== undefined && firing.ruleId === firing.targetRuleId) {
          emit(firing, 'TP', {
            labelId: firing.labelId,
            label: 'TP',
            pr: firing.pr,
            ruleId: firing.ruleId,
            filePath: firing.filePath,
            source: 'positive-control-target',
          });
        } else {
          unlabeledByReason['incidental-positive'] += 1;
        }
        break;
      }
      case 'corpus': {
        corpusFirings += 1;
        const disp = dispByPr.get(firing.pr);
        const bound = disp
          ? disp.threads.filter(
              (t) =>
                t.path.replace(/\\/g, '/') === firing.filePath &&
                addedHunkLines(t.diffHunk).has(firing.matchedLine),
            )
          : [];
        if (bound.length !== 1) {
          unlabeledByReason[
            bound.length === 0 ? 'no-matching-disposition' : 'ambiguous-multiple-dispositions'
          ] += 1;
          break;
        }
        const thread = bound[0]!;
        const label = dispositionToLabel(classifyDisposition(thread.comments));
        if (label === null) {
          unlabeledByReason['unlabeled-class'] += 1;
          break;
        }
        boundCorpusFirings += 1;
        emit(firing, label, {
          labelId: firing.labelId,
          label,
          pr: firing.pr,
          ruleId: firing.ruleId,
          filePath: firing.filePath,
          threadId: thread.threadId,
          commentId: thread.comments[0]?.commentId,
          source: 'corpus-disposition',
        });
        break;
      }
    }
  }

  const unlabeledFirings =
    unlabeledByReason['no-matching-disposition'] +
    unlabeledByReason['ambiguous-multiple-dispositions'] +
    unlabeledByReason['unlabeled-class'] +
    unlabeledByReason['incidental-positive'];
  const scoredDenominator = corpusFirings + positiveFirings;

  return {
    labels,
    evidence,
    diagnostics: {
      totalFirings: firings.length,
      negativeFirings,
      corpusFirings,
      positiveFirings,
      boundCorpusFirings,
      dispositionDensity: corpusFirings === 0 ? 0 : boundCorpusFirings / corpusFirings,
      unlabeledFirings,
      unlabeledRate: scoredDenominator === 0 ? 0 : unlabeledFirings / scoredDenominator,
      labelCounts,
      perRuleLabeled,
      unlabeledByReason,
    },
  };
}
