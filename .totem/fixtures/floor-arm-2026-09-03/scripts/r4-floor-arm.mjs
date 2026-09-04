// R4 — the calibrated-floor arm (mmnto-ai/totem#2727; synthesis § 2.1 falsifier, § 9.8).
// Deterministic computation over the committed R1 fixture: no network, no index, no LLM.
// Implements r4-preregistration.md in this directory; the precision() and RRF arithmetic are
// copied from ../spec-runs-2026-09-02/scripts/r1-score.mjs (copied, not imported).
// Usage: node r4-floor-arm.mjs --fixture <spec-runs-2026-09-02 dir> --out <this dir>
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] ?? 'true']);
    return acc;
  }, []),
);
const F = args.fixture;
const OUT = args.out;
if (!F || !OUT) {
  console.error('usage: node r4-floor-arm.mjs --fixture <dir> --out <dir>');
  process.exit(2);
}
const NL = String.fromCharCode(10);
const NUL = String.fromCharCode(0);
const readNdjson = (name) =>
  fs
    .readFileSync(path.join(F, name), 'utf8')
    .trim()
    .split(NL)
    .map((l) => JSON.parse(l));

const rerank = readNdjson('r1-rerank.ndjson');
const retrieval = readNdjson('r1-retrieval.ndjson');
const labelRows = [0, 1, 2].flatMap((k) =>
  fs.existsSync(path.join(F, 'r1-labels-part' + k + '.ndjson'))
    ? readNdjson('r1-labels-part' + k + '.ndjson')
    : [],
);
const labels = new Map(labelRows.map((r) => [r.id + NUL + r.chunkId, r.label]));
const r1Score = JSON.parse(fs.readFileSync(path.join(F, 'r1-score.json'), 'utf8'));

const RRF_K = 60;
const MAX_SPECS = 5;
const MAX_CODE = 3;
const PARTITIONS = ['spec', 'code'];
const CAPS = { spec: MAX_SPECS, code: MAX_CODE };
const BASELINE_KEY = { spec: 'specs', code: 'code' };

// --- R1 scorer arithmetic (copied) ---------------------------------------------------------
const rel = (id, chunkId) => {
  const v = labels.get(id + NUL + chunkId);
  return v === undefined ? null : v;
};
function precision(id, items) {
  let hits = 0;
  for (const it of items) {
    const v = rel(id, it.chunkId);
    if (v === null) continue;
    if (v === 2) hits += 1;
  }
  return items.length ? hits / items.length : 0;
}
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const r4 = (x) => +Number(x).toFixed(4);

const isIssue = (row) => row.anchorKind !== 'topic';
const issueRows = rerank.filter(isIssue);
const topicRows = rerank.filter((r) => !isIssue(r));

// --- control ---------------------------------------------------------------------------------
function scoreDelivered(rows, deliveredFor) {
  const p8 = [];
  const p5 = [];
  const p3 = [];
  for (const row of rows) {
    const d = deliveredFor(row);
    p8.push(precision(row.id, [...d.spec, ...d.code]));
    p5.push(precision(row.id, d.spec));
    p3.push(precision(row.id, d.code));
  }
  return { meanP8: mean(p8), meanP5spec: mean(p5), meanP3code: mean(p3) };
}
const baselineDelivered = (row) => ({ spec: row.arms.baseline.specs, code: row.arms.baseline.code });
const derived31 = scoreDelivered(issueRows, baselineDelivered);
const derived24 = scoreDelivered(topicRows, baselineDelivered);
const recorded31 = r1Score.issueAnchored.arms.baseline;
const recorded24 = r1Score.topicAnchored.arms.baseline;
const control = {
  n31: issueRows.length,
  n24: topicRows.length,
  derived: {
    meanP8: r4(derived31.meanP8),
    meanP5spec: r4(derived31.meanP5spec),
    meanP3code: r4(derived31.meanP3code),
  },
  recorded: {
    meanP8: recorded31.meanP8,
    meanP5spec: recorded31.meanP5spec,
    meanP3code: recorded31.meanP3code,
  },
};
control.match =
  control.derived.meanP8 === control.recorded.meanP8 &&
  control.derived.meanP5spec === control.recorded.meanP5spec &&
  control.derived.meanP3code === control.recorded.meanP3code &&
  issueRows.length === r1Score.issueAnchored.n &&
  topicRows.length === r1Score.topicAnchored.n;
if (!control.match) {
  console.error(
    'CONTROL MISMATCH — apparatus fault, run stopped. derived=' +
      JSON.stringify(control.derived) +
      ' recorded=' +
      JSON.stringify(control.recorded) +
      ' n31=' +
      issueRows.length +
      '/' +
      r1Score.issueAnchored.n +
      ' n24=' +
      topicRows.length +
      '/' +
      r1Score.topicAnchored.n,
  );
  process.exit(2);
}

const baseline = {
  on31: control.derived,
  topic24: {
    meanP8: r4(derived24.meanP8),
    meanP5spec: r4(derived24.meanP5spec),
    meanP3code: r4(derived24.meanP3code),
  },
  falsifierThresholdP8: 0.3952,
};

// --- exactness bound: per query, per partition worstRelevance ---------------------------------
const worst = new Map(); // query id -> { spec, code } (null where the leg is empty)
for (const r of retrieval) {
  const m = {};
  for (const p of PARTITIONS) {
    const leg = r.raw && r.raw.legs ? r.raw.legs[p] : undefined;
    m[p] = leg && leg.worstRelevance !== null && leg.worstRelevance !== undefined ? leg.worstRelevance : null;
  }
  worst.set(r.id, m);
}

// --- arm mechanics ----------------------------------------------------------------------------
// A-post: withhold delivered items below tau; an item with no relevance (FTS-only) is exempt.
function deliveredPost(row, tau) {
  const out = {};
  for (const p of PARTITIONS) {
    out[p] = row.arms.baseline[BASELINE_KEY[p]].filter(
      (it) => it.relevance === null || it.relevance === undefined || it.relevance >= tau,
    );
  }
  return out;
}
// A-pre: drop sub-tau items from the VECTOR leg, compact the surviving vector ranks to 1..n in
// their original order, re-fuse with RRF k=60 over the pool, take the top 5 specs / 3 code.
// An item left in neither leg (no surviving vector rank, no FTS rank) is not a candidate.
function deliveredPre(row, tau) {
  const out = {};
  for (const p of PARTITIONS) {
    const survivors = row.poolItems[p]
      .filter(
        (it) =>
          it.vectorRank !== null &&
          it.vectorRank !== undefined &&
          it.relevance !== null &&
          it.relevance !== undefined &&
          it.relevance >= tau,
      )
      .sort((a, b) => a.vectorRank - b.vectorRank);
    const compacted = new Map(survivors.map((it, i) => [it.chunkId, i + 1]));
    const fused = row.poolItems[p]
      .map((it) => {
        const v = compacted.get(it.chunkId) ?? null;
        const rrf = (v ? 1 / (RRF_K + v) : 0) + (it.ftsRank ? 1 / (RRF_K + it.ftsRank) : 0);
        return { ...it, vectorRank: v, rrf };
      })
      .filter((it) => it.rrf > 0);
    fused.sort((a, b) => b.rrf - a.rrf);
    out[p] = fused.slice(0, CAPS[p]);
  }
  return out;
}
// B: best_q = the query's best vector relevance across its partitions' pools.
function bestQ(row) {
  let b = null;
  for (const p of PARTITIONS) {
    for (const it of row.poolItems[p]) {
      if (it.relevance === null || it.relevance === undefined) continue;
      if (b === null || it.relevance > b) b = it.relevance;
    }
  }
  return b;
}
const bestByQuery = new Map(rerank.map((row) => [row.id, bestQ(row)]));

// --- candidate evaluation ----------------------------------------------------------------------
function evaluate(candidate) {
  const tauFor = candidate.tauFor;
  const deliver = candidate.shape === 'A-post' ? deliveredPost : deliveredPre;
  const withheldByLabel = { 0: 0, 1: 0, 2: 0, unlabelled: 0 };
  let withheldAll55 = 0;
  let withheldOn31 = 0;
  let refusals = 0;
  const perRow = new Map();
  for (const row of rerank) {
    const tau = tauFor(row);
    const d = deliver(row, tau);
    perRow.set(row.id, d);
    if (d.spec.length + d.code.length === 0) refusals += 1;
    const kept = new Set([...d.spec, ...d.code].map((it) => it.chunkId));
    for (const p of PARTITIONS) {
      for (const it of row.arms.baseline[BASELINE_KEY[p]]) {
        if (kept.has(it.chunkId)) continue;
        withheldAll55 += 1;
        if (isIssue(row)) withheldOn31 += 1;
        const l = rel(row.id, it.chunkId);
        withheldByLabel[l === null ? 'unlabelled' : l] += 1;
      }
    }
  }
  const on31raw = scoreDelivered(issueRows, (row) => perRow.get(row.id));
  const on24raw = scoreDelivered(topicRows, (row) => perRow.get(row.id));
  const on31 = {
    meanP8: r4(on31raw.meanP8),
    meanP5spec: r4(on31raw.meanP5spec),
    meanP3code: r4(on31raw.meanP3code),
    dP8: r4(on31raw.meanP8 - derived31.meanP8),
    dP5spec: r4(on31raw.meanP5spec - derived31.meanP5spec),
    dP3code: r4(on31raw.meanP3code - derived31.meanP3code),
  };
  const topic24 = {
    meanP8: r4(on24raw.meanP8),
    meanP5spec: r4(on24raw.meanP5spec),
    meanP3code: r4(on24raw.meanP3code),
    dP8: r4(on24raw.meanP8 - derived24.meanP8),
    dP5spec: r4(on24raw.meanP5spec - derived24.meanP5spec),
    dP3code: r4(on24raw.meanP3code - derived24.meanP3code),
  };
  // Exactness: the bound is stated for the A-pre shape (a floor below the recorded 60-hit vector
  // window could admit unrecorded backfill). A-post never re-queries the index, so it is exact.
  let exactness = 'exact';
  if (candidate.shape !== 'A-post') {
    for (const row of rerank) {
      const tau = tauFor(row);
      const w = worst.get(row.id);
      for (const p of PARTITIONS) {
        if (w[p] !== null && tau < w[p]) exactness = 'lower-bound';
      }
    }
  }
  const passes = withheldAll55 >= 1 && on31.meanP8 >= baseline.falsifierThresholdP8;
  const outCandidate = {
    shape: candidate.shape,
    param: candidate.param,
    ...(candidate.tau !== undefined ? { tau: candidate.tau } : {}),
    ...(candidate.delta !== undefined ? { delta: candidate.delta } : {}),
    ...(candidate.rho !== undefined ? { rho: candidate.rho } : {}),
    withheld: { all55: withheldAll55, on31: withheldOn31, byLabel: withheldByLabel },
    refusals,
    on31,
    topic24,
    exactness,
    passes,
  };
  return outCandidate;
}

// --- candidate set (r4-preregistration.md) -------------------------------------------------------
const deliveredBorderline = [];
for (const row of rerank) {
  for (const p of PARTITIONS) {
    for (const it of row.arms.baseline[BASELINE_KEY[p]]) {
      if (it.relevance === null || it.relevance === undefined) continue;
      deliveredBorderline.push({ relevance: it.relevance, label: rel(row.id, it.chunkId) });
    }
  }
}
const minRelWhere = (pred) =>
  deliveredBorderline.filter(pred).reduce((m, x) => (m === null || x.relevance < m ? x.relevance : m), null);
const tauCal2 = minRelWhere((x) => x.label === 2) - 0.0005;
const tauCal1 = minRelWhere((x) => x.label !== null && x.label >= 1) - 0.0005;

const sweep = [];
for (let i = 0; i <= 50; i++) sweep.push(+(0.5 + i * 0.005).toFixed(3));
const aTaus = [
  ...sweep.map((t) => ({ param: 'tau=' + t.toFixed(3), tau: t })),
  { param: 'tau_cal2', tau: tauCal2 },
  { param: 'tau_cal1', tau: tauCal1 },
];
const candidates = [];
for (const shape of ['A-post', 'A-pre']) {
  for (const t of aTaus) {
    candidates.push({ shape, param: t.param, tau: t.tau, tauFor: () => t.tau });
  }
}
for (const delta of [0.02, 0.05, 0.1, 0.15]) {
  candidates.push({
    shape: 'B',
    param: 'delta=' + delta.toFixed(2),
    delta,
    tauFor: (row) => bestByQuery.get(row.id) - delta,
  });
}
for (const rho of [0.05, 0.1, 0.15, 0.2]) {
  candidates.push({
    shape: 'B',
    param: 'rho=' + rho.toFixed(2),
    rho,
    tauFor: (row) => bestByQuery.get(row.id) * (1 - rho),
  });
}

const results = candidates.map(evaluate);

// --- verdict -------------------------------------------------------------------------------------
const passing = results.filter((c) => c.passes);
const armPasses = passing.some((c) => c.shape === 'A-pre');
const zeroLabel2 = results.filter((c) => c.withheld.byLabel[2] === 0);
let mostWithheldNoLabel2 = null;
for (const c of zeroLabel2) {
  if (mostWithheldNoLabel2 === null || c.withheld.all55 > mostWithheldNoLabel2.withheld.all55) {
    mostWithheldNoLabel2 = c;
  }
}

const record = {
  preregistration: 'r4-preregistration.md',
  at: new Date().toISOString(),
  control,
  baseline,
  candidates: results,
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'r4-floor-arm.json'), JSON.stringify(record, null, 2) + NL);

// --- summary ---------------------------------------------------------------------------------------
const f4 = (x) => Number(x).toFixed(4);
const sgn = (x) => (x >= 0 ? '+' + f4(x) : f4(x));
const name = (c) => c.shape + ' ' + c.param;
function table(shape) {
  const rows = results.filter((c) => c.shape === shape);
  const head = [
    '| candidate | tau | withheld (55) | 0 / 1 / 2 / unlab | withheld (31) | refusals | mean p@8 | Δ p@8 | p@5 spec | p@3 code | exactness | passes |',
    '| --- | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |',
  ];
  const body = rows.map((c) => {
    const tauCell =
      c.tau !== undefined
        ? f4(c.tau)
        : c.delta !== undefined
          ? 'best_q − ' + c.delta.toFixed(2)
          : 'best_q × ' + (1 - c.rho).toFixed(2);
    const b = c.withheld.byLabel;
    return (
      '| ' +
      c.param +
      ' | ' +
      tauCell +
      ' | ' +
      c.withheld.all55 +
      ' | ' +
      b[0] +
      ' / ' +
      b[1] +
      ' / ' +
      b[2] +
      ' / ' +
      b.unlabelled +
      ' | ' +
      c.withheld.on31 +
      ' | ' +
      c.refusals +
      ' | ' +
      f4(c.on31.meanP8) +
      ' | ' +
      sgn(c.on31.dP8) +
      ' | ' +
      f4(c.on31.meanP5spec) +
      ' | ' +
      f4(c.on31.meanP3code) +
      ' | ' +
      c.exactness +
      ' | ' +
      (c.passes ? 'PASS' : 'no') +
      ' |'
    );
  });
  return head.concat(body).join(NL);
}

const passingNames = passing.map(name);
const verdictLine =
  'R4 ' +
  (armPasses ? 'PASSES' : 'FAILS') +
  ': ' +
  (armPasses
    ? passing.filter((c) => c.shape === 'A-pre').length +
      ' A-pre candidate(s) withhold at least one delivered item over the 55 without dropping mean p@8 on the 31 below ' +
      f4(baseline.falsifierThresholdP8)
    : 'no A-pre candidate withholds at least one delivered item over the 55 while holding mean p@8 on the 31 at or above ' +
      f4(baseline.falsifierThresholdP8));

const md = [
  '# R4 run record — the calibrated-floor arm (mmnto-ai/totem#2727)',
  '',
  'Pre-registered in `r4-preregistration.md` (commit 1, script unexecuted); this record is commit 2. Generated ' +
    record.at +
    ' by `scripts/r4-floor-arm.mjs` over `../spec-runs-2026-09-02/` at pin `14daff4d`.',
  '',
  '## Method',
  '',
  '1. Two floor shapes over the 55 recorded `totem spec` queries: **A-post** withholds delivered baseline items whose vector relevance is below τ (an FTS-only item, which has no relevance, is exempt); **A-pre** removes sub-τ items from the vector leg, compacts the surviving vector ranks, re-fuses the recorded pool with RRF k = 60 and re-takes the top 5 specs / 3 code. **B** is the A-pre shape with a per-query τ derived from that query’s best vector relevance.',
  '2. Correctness is the R1 scorer’s `precision()`: a hit is label 2, the denominator is the delivered count, an unlabelled delivered item is a non-hit. Mean p@8 / p@5-spec / p@3-code over the 31 issue-anchored queries; the 24 topic queries are reported beside and do not enter the falsifier.',
  '3. A candidate PASSES iff it withholds ≥ 1 item over the 55 AND mean p@8 on the 31 is ≥ ' +
    f4(baseline.falsifierThresholdP8) +
    '. The arm PASSES iff at least one A-pre candidate passes. `exactness: lower-bound` marks an A-pre/B candidate whose τ falls below some query-partition’s recorded `worstRelevance`, where an unrecorded 61st-plus vector hit could have backfilled the window.',
  '',
  '## Control',
  '',
  'Baseline re-derived from `arms.baseline` + labels on the ' +
    control.n31 +
    ' issue-anchored queries: mean p@8 ' +
    f4(control.derived.meanP8) +
    ', p@5-spec ' +
    f4(control.derived.meanP5spec) +
    ', p@3-code ' +
    f4(control.derived.meanP3code) +
    ' — recorded in `r1-score.json` as ' +
    f4(control.recorded.meanP8) +
    ' / ' +
    f4(control.recorded.meanP5spec) +
    ' / ' +
    f4(control.recorded.meanP3code) +
    '. Match: ' +
    (control.match ? 'yes' : 'NO') +
    '. Topic baseline (' +
    control.n24 +
    ' queries): ' +
    f4(baseline.topic24.meanP8) +
    ' / ' +
    f4(baseline.topic24.meanP5spec) +
    ' / ' +
    f4(baseline.topic24.meanP3code) +
    '.',
  '',
  'Calibrated points from the borderline set (the ' +
    deliveredBorderline.length +
    ' labelled delivered baseline items carrying a relevance, over all 55): τ_cal2 = ' +
    f4(tauCal2) +
    ' (min relevance over label-2 items − 0.0005), τ_cal1 = ' +
    f4(tauCal1) +
    ' (the same over label ≥ 1).',
  '',
  '## A-post (post-fusion withholding, the MCP `min_relevance` shape)',
  '',
  table('A-post'),
  '',
  '## A-pre (pre-fusion removal, the `distanceRange` shape)',
  '',
  table('A-pre'),
  '',
  '## B (distribution-relative τ, A-pre shape)',
  '',
  table('B'),
  '',
  '## Verdict',
  '',
  verdictLine +
    '. Passing candidates (' +
    passing.length +
    ' of ' +
    results.length +
    '): ' +
    (passingNames.length ? passingNames.join(', ') : 'none') +
    '. Among the ' +
    zeroLabel2.length +
    ' candidates that withhold no label-2 item, the one withholding the most is ' +
    (mostWithheldNoLabel2
      ? name(mostWithheldNoLabel2) +
        ' (' +
        mostWithheldNoLabel2.withheld.all55 +
        ' items over the 55; ' +
        mostWithheldNoLabel2.withheld.byLabel[0] +
        ' label-0, ' +
        mostWithheldNoLabel2.withheld.byLabel[1] +
        ' label-1; mean p@8 ' +
        f4(mostWithheldNoLabel2.on31.meanP8) +
        ', Δ ' +
        sgn(mostWithheldNoLabel2.on31.dP8) +
        '; refusals ' +
        mostWithheldNoLabel2.refusals +
        '; ' +
        mostWithheldNoLabel2.exactness +
        ')'
      : 'none') +
    '.',
  '',
  '## Limits',
  '',
  'One profile (gemini-embedding-2-preview, 768-d, squared-L2 distance, relevance = 1/(1+_distance)). Labels cover only the delivered sets and pools R1 labelled (814 pairs); an unlabelled item is a non-hit, as in R1. The pool is the recorded retrieval window — 60 vector hits per spec leg, 9 per code leg — so no re-embedding and no backfill beyond it. Topic queries are unscored against the falsifier. The arm measures the floor as a withholding device, not the refusal envelope’s wording.',
  '',
].join(NL);
fs.writeFileSync(path.join(OUT, 'r4-summary.md'), md);

console.log(verdictLine + '.');
console.log(
  'control: derived ' +
    f4(control.derived.meanP8) +
    ' / ' +
    f4(control.derived.meanP5spec) +
    ' / ' +
    f4(control.derived.meanP3code) +
    ' == recorded (' +
    (control.match ? 'match' : 'MISMATCH') +
    ')',
);
console.log('candidates: ' + results.length + ', passing: ' + passing.length);
if (passing.length) console.log('passing: ' + passingNames.join(', '));
if (mostWithheldNoLabel2)
  console.log(
    'most-withholding zero-label-2 candidate: ' +
      name(mostWithheldNoLabel2) +
      ' (' +
      mostWithheldNoLabel2.withheld.all55 +
      ' withheld, mean p@8 ' +
      f4(mostWithheldNoLabel2.on31.meanP8) +
      ')',
  );
