// R1 scorer (mmnto-ai/totem-strategy#1193): precision@k per arm against the blind labels,
// judged against r1-preregistration.md. Also derives reduced-pool cross-encoder variants
// from the recorded per-item scores (rerank only the top-N of the hybrid order).
// Usage: node r1-score.mjs --fixture <dir>
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] ?? 'true']); return acc; }, []));
const F = args.fixture;
const readNdjson = (name) => fs.readFileSync(path.join(F, name), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

const rerank = readNdjson('r1-rerank.ndjson');
const cost = JSON.parse(fs.readFileSync(path.join(F, 'r1-rerank-cost.json'), 'utf8'));
const labelRows = [0, 1, 2].flatMap((k) => (fs.existsSync(path.join(F, 'r1-labels-part' + k + '.ndjson')) ? readNdjson('r1-labels-part' + k + '.ndjson') : []));
const labels = new Map(labelRows.map((r) => [r.id + '\u0000' + r.chunkId, r.label]));
const RRF_K = 60;
const MAX_SPECS = 5;
const MAX_CODE = 3;

const rel = (id, chunkId) => {
  const v = labels.get(id + '\u0000' + chunkId);
  return v === undefined ? null : v;
};
const missingItems = new Set();
function precision(id, items) {
  let hits = 0;
  for (const it of items) {
    const v = rel(id, it.chunkId);
    if (v === null) { missingItems.add(id + '|' + it.chunkId); continue; }
    if (v === 2) hits += 1;
  }
  return items.length ? hits / items.length : 0;
}
function reducedPoolVariant(row, N) {
  // hybrid order of the pool = RRF over the recorded vector/FTS ranks (k=60), then top-N re-sorted by CE score
  const out = {};
  for (const [type, cap] of [['spec', MAX_SPECS], ['code', MAX_CODE]]) {
    const pool = row.poolItems[type].map((p) => ({ ...p, rrf: (p.vectorRank ? 1 / (RRF_K + p.vectorRank) : 0) + (p.ftsRank ? 1 / (RRF_K + p.ftsRank) : 0) }));
    pool.sort((a, b) => b.rrf - a.rrf);
    const top = pool.slice(0, N).sort((a, b) => b.ceScore - a.ceScore).slice(0, cap);
    out[type] = { items: top, pairs: Math.min(N, pool.length) };
  }
  return out;
}

const armNames = ['baseline', 'ce-rerank', 'query-tasktype'];
const variants = [10, 20];
const per = []; // per query
for (const row of rerank) {
  const q = { id: row.id, kind: row.anchorKind === 'topic' ? 'topic' : 'issue', p8: {}, p5spec: {}, p3code: {}, pairs: {} };
  for (const arm of armNames) {
    const specs = row.arms[arm].specs;
    const code = row.arms[arm].code;
    q.p8[arm] = precision(row.id, [...specs, ...code]);
    q.p5spec[arm] = precision(row.id, specs);
    q.p3code[arm] = precision(row.id, code);
  }
  for (const N of variants) {
    const v = reducedPoolVariant(row, N);
    const name = 'ce-top' + N;
    q.p8[name] = precision(row.id, [...v.spec.items, ...v.code.items]);
    q.p5spec[name] = precision(row.id, v.spec.items);
    q.p3code[name] = precision(row.id, v.code.items);
    q.pairs[name] = v.spec.pairs + v.code.pairs;
    q.unlabelledDelivered = q.unlabelledDelivered ?? {};
    q.unlabelledDelivered[name] = [...v.spec.items, ...v.code.items].filter((it) => rel(row.id, it.chunkId) === null).length;
  }
  q.pairs['ce-rerank'] = row.pools.spec + row.pools.code;
  per.push(q);
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const arms = [...armNames, ...variants.map((N) => 'ce-top' + N)];
function summarize(kind) {
  const qs = per.filter((q) => q.kind === kind);
  const out = { n: qs.length, arms: {} };
  for (const arm of arms) {
    const p8 = qs.map((q) => q.p8[arm]);
    const gains = qs.map((q) => q.p8[arm] - q.p8.baseline);
    out.arms[arm] = {
      meanP8: +mean(p8).toFixed(4),
      meanP5spec: +mean(qs.map((q) => q.p5spec[arm])).toFixed(4),
      meanP3code: +mean(qs.map((q) => q.p3code[arm])).toFixed(4),
      gainP8: +mean(gains).toFixed(4),
      noRegression: gains.filter((g) => g >= 0).length,
      improved: gains.filter((g) => g > 0).length,
      regressed: gains.filter((g) => g < 0).length,
    };
  }
  return out;
}
const issue = summarize('issue');
const topic = summarize('topic');

// cost: measured for the three arms; derived (pairs × measured ms/pair) for the reduced-pool variants
const msPerPair = cost.ceMsPerQuery.mean / (cost.pairsScored / cost.queries);
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const issueRows = rerank.filter((r) => r.anchorKind !== 'topic');
const costRows = {
  baseline: { addedMsP95: 0, note: 'production path; no added latency' },
  // p95 on the pre-registered denominator (the 31 issue-anchored queries); the all-55 figure beside it
  'ce-rerank': { addedMsP95: pct(issueRows.map((r) => r.ms.ce), 0.95), addedMsP95Over55: cost.ceMsPerQuery.p95, addedMsMeanOver55: cost.ceMsPerQuery.mean, measured: true, pairsMean: +(cost.pairsScored / cost.queries).toFixed(1) },
  'query-tasktype': { addedMsP95: pct(issueRows.map((r) => r.ms.tasktype), 0.95), addedMsP95Over55: cost.tasktypeMsPerQuery.p95, addedMsMeanOver55: cost.tasktypeMsPerQuery.mean, measured: true, note: 'one extra embed call per query (RETRIEVAL_QUERY) + two vector legs; replaces the production embed in a real deployment' },
};
for (const N of variants) {
  const pairs31 = issueRows.map((q) => Math.min(N, q.poolItems.spec.length) + Math.min(N, q.poolItems.code.length));
  costRows['ce-top' + N] = { addedMsMeanDerived: Math.round(mean(pairs31) * msPerPair), addedMsMaxDerived: Math.round(Math.max(...pairs31) * msPerPair), measured: false, pairsMeanOn31: +mean(pairs31).toFixed(1), note: 'derived from the measured ms/pair (' + msPerPair.toFixed(1) + ') over the 31; not a timed run' };
}

// pre-registered verdicts on the 31
const verdicts = {};
for (const arm of arms.filter((a) => a !== 'baseline')) {
  const s = issue.arms[arm];
  const c = costRows[arm];
  const p95 = c.addedMsP95 ?? c.addedMsMaxDerived;
  const conds = { i_gain_ge_0_10: s.gainP8 >= 0.10, ii_noRegression_ge_24: s.noRegression >= 24, iii_p95_le_2000ms: p95 <= 2000 };
  const issuePer = per.filter((q) => q.kind === 'issue');
  const unlabelled = armNames.includes(arm) ? 0 : issuePer.reduce((n, q) => n + q.unlabelledDelivered[arm], 0);
  const delivered = issuePer.length * 8;
  const lowerBound = unlabelled > 0;
  verdicts[arm] = { ...conds, pass: !lowerBound && Object.values(conds).every(Boolean), preRegistered: armNames.includes(arm), p95Ms: p95, p95Measured: c.measured === true, ...(lowerBound ? { precisionIsLowerBound: true, unlabelledDeliveredItems: unlabelled + '/' + delivered, i_and_ii: 'indeterminate (unlabelled items count as misses)' } : {}) };
}

const labelStats = { pairsLabelled: labelRows.length, byLabel: labelRows.reduce((m, r) => { m[r.label] = (m[r.label] ?? 0) + 1; return m; }, {}), unlabelledDeliveredItemsDistinct: missingItems.size, note: 'unlabelled items occur only in the derived ce-topN variants; every item of the three pre-registered arms is labelled' };
const result = { at: new Date().toISOString(), labelStats, issueAnchored: issue, topicAnchored: topic, cost: costRows, verdictsOnThe31: verdicts, perQuery: per };
fs.writeFileSync(path.join(F, 'r1-score.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ labelStats, issueAnchored: issue, topicAnchored: topic, cost: costRows, verdicts }, null, 1));
