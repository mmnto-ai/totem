// Merges the cold-index and warm-index runs into the canonical
// artifacts/serena-report.json, and states the kill-threshold verdict.
//
// The verdict is computed on the WARM (steady-state) run, which is the most
// favourable honest reading for serena: it excludes one-off index build cost.
// The cold run is retained because first-contact cost is a real adoption cost.

import fs from 'node:fs';
import path from 'node:path';
import { ARTIFACTS_DIR } from './config.mjs';

const read = (f) => JSON.parse(fs.readFileSync(path.join(ARTIFACTS_DIR, f), 'utf8'));
const cold = read('serena-run-cold.json');
const warm = read('serena-run-warm.json');

const steady = warm;
const thresholdMet = steady.verdict.criteria.medianReductionAtLeast25PctInBytesOrTime;
const noMissed = steady.verdict.criteria.zeroMissedAnswersOnSerenaArm;
const retrievalOnly = steady.verdict.criteria.retrievalOnlyBoundVerified;

// The plain-language reading is DERIVED from the measured values, never
// transcribed. A hardcoded sentence goes stale the moment the harness is re-run
// and would then contradict `criteria` and `rationale` in the same artifact.
const missedIds = steady.correctness.serenaMissedTasks.map((t) => t.id);
const num = (v, digits) => (typeof v === 'number' ? v.toFixed(digits) : 'n/a');
const plainReading =
  `Serena median wall time ${num(steady.medians.serenaMs, 0)}ms vs baseline ` +
  `${num(steady.medians.baselineMs, 0)}ms (${num(steady.medians.timeReductionPct, 1)}% reduction); ` +
  `median bytes ${steady.medians.serenaBytes} vs baseline ${steady.medians.baselineBytes} ` +
  `(${num(steady.medians.bytesReductionPct, 1)}% reduction); ` +
  `serena missed ${missedIds.length} ground-truth answer(s)` +
  `${missedIds.length ? ` (${missedIds.join(',')})` : ''} across ` +
  `${steady.correctness.tasksRun} task(s). A NEGATIVE reduction means serena was ` +
  `WORSE than the baseline. The >=25% reduction bar is ${thresholdMet ? 'MET' : 'NOT met'} ` +
  `and the no-missed-answer condition is ${noMissed ? 'MET' : 'NOT met'}, so the pilot ` +
  `${thresholdMet && noMissed ? 'clears' : 'does not clear'} its kill threshold.`;

const combined = {
  pilot: 'serena retrieval-only pilot (mmnto-ai/totem)',
  generatedAt: new Date().toISOString(),
  worktree: steady.worktree,
  pin: steady.pin,

  killThreshold: {
    statement:
      'The pilot FAILS unless median tool-output bytes OR median wall time drops ' +
      '>=25% versus the ripgrep baseline, with NO missed baseline answer on the ' +
      'serena arm, plus verified zero-mutation and clean uninstall.',
    evaluatedOn: 'warm (steady-state) run -- the most favourable honest reading',
    criteria: {
      medianBytesReductionPct: steady.medians.bytesReductionPct,
      medianTimeReductionPct: steady.medians.timeReductionPct,
      bytesOrTimeReduced25Pct: thresholdMet,
      zeroMissedAnswersOnSerenaArm: noMissed,
      serenaMissed: steady.correctness.serenaMissedTasks,
      retrievalOnlyBoundVerified: retrievalOnly,
      zeroMutationVerified: 'see PILOT.md -- shell-verified pre/post git status + filesystem sweep',
      uninstallVerified: 'see PILOT.md -- uv cache + tool venv removal executed and re-checked',
    },
    VERDICT: thresholdMet && noMissed ? 'PASS' : 'FAIL',
    rationale: steady.verdict.rationale,
    plainReading,
  },

  exposedTools: steady.exposedTools,
  indexing: { cold: cold.indexing, warm: warm.indexing },
  medians: { cold: cold.medians, warm: warm.medians },
  precision: { cold: cold.precision, warm: warm.precision },
  correctness: { cold: cold.correctness, warm: warm.correctness },

  perTask: steady.tasks.map((t) => {
    const c = cold.tasks.find((x) => x.id === t.id);
    return {
      id: t.id,
      kind: t.kind,
      question: t.question,
      groundTruthFiles: t.groundTruthFiles,
      serena: {
        bytes: t.serena.bytes,
        msWarm: t.serena.ms,
        msCold: c?.serena.ms ?? null,
        missed: t.serena.missed,
        falsePositives: t.serena.decoysReported,
        calls: t.serena.calls.map((k) => ({ name: k.name, bytes: k.bytes, ms: k.ms })),
      },
      baseline: {
        bytes: t.baseline.bytes,
        msWarm: t.baseline.ms,
        msCold: c?.baseline.ms ?? null,
        missed: t.baseline.missed,
        falsePositives: t.baseline.decoysReported,
        calls: t.baseline.calls.map((k) => ({ argv: k.argv, bytes: k.bytes, ms: k.ms })),
      },
    };
  }),

  runs: { cold, warm },
};

fs.writeFileSync(
  path.join(ARTIFACTS_DIR, 'serena-report.json'),
  JSON.stringify(combined, null, 2),
  'utf8',
);
console.log('VERDICT:', combined.killThreshold.VERDICT);
console.log('wrote', path.join(ARTIFACTS_DIR, 'serena-report.json'));
