// R1 diagnostics (mmnto-ai/totem-strategy#1193): the numbers quoted in r1-results.md
// § Diagnostics, regenerated from r1-rerank.ndjson + the three label files. Never a verdict.
// Usage: node r1-diagnostics.mjs --fixture <dir>
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] ?? 'true']); return acc; }, []));
const F = args.fixture;
if (!F) throw new Error('--fixture required');
const readNdjson = (name) => fs.readFileSync(path.join(F, name), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

const rerank = readNdjson('r1-rerank.ndjson');
const labels = new Map([0, 1, 2].flatMap((k) => readNdjson('r1-labels-part' + k + '.ndjson')).map((r) => [r.id + '|' + r.chunkId, r.label]));
const arms = ['baseline', 'ce-rerank', 'query-tasktype'];
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const auc = (pos, neg) => { let win = 0, tot = 0; for (const a of pos) for (const b of neg) { tot++; if (a > b) win++; else if (a === b) win += 0.5; } return tot ? win / tot : NaN; };
const jaccard = (a, b) => { const i = [...a].filter((x) => b.has(x)).length; return i / new Set([...a, ...b]).size; };

// 1. Score separation over the labelled UNION of delivered items (each chunk once per query):
//    population = every delivered item of the three arms that carries the score in question.
const ce = { 0: [], 1: [], 2: [] };
const rel = { 0: [], 1: [], 2: [] };
const byType = { spec: { 0: 0, 1: 0, 2: 0 }, code: { 0: 0, 1: 0, 2: 0 } };
for (const r of rerank) {
  const seen = new Set();
  for (const arm of arms) for (const part of ['specs', 'code']) for (const it of r.arms[arm][part]) {
    if (seen.has(it.chunkId)) continue;
    seen.add(it.chunkId);
    const L = labels.get(r.id + '|' + it.chunkId);
    if (L === undefined) continue;
    if (it.ceScore != null) ce[L].push(it.ceScore);
    if (it.relevance != null) rel[L].push(it.relevance);
    byType[it.type === 'code' ? 'code' : 'spec'][L] += 1;
  }
}

// 2. Baseline per-partition coverage on the 31 issue-anchored queries, and the spec partition's sources.
const issue = rerank.filter((r) => r.anchorKind !== 'topic');
let specAny = 0, codeAny = 0;
const sources = {};
for (const r of issue) {
  const s = r.arms.baseline.specs.filter((it) => labels.get(r.id + '|' + it.chunkId) === 2).length;
  const c = r.arms.baseline.code.filter((it) => labels.get(r.id + '|' + it.chunkId) === 2).length;
  if (s > 0) specAny += 1;
  if (c > 0) codeAny += 1;
  for (const it of r.arms.baseline.specs) { const k = it.filePath.split('/').slice(0, 2).join('/'); sources[k] = (sources[k] ?? 0) + 1; }
}

// 3. Delivered-set overlap between arms (all 55).
const overlap = { 'baseline~ce-rerank': [], 'baseline~query-tasktype': [], 'ce-rerank~query-tasktype': [] };
const identical = { 'baseline~ce-rerank': 0, 'baseline~query-tasktype': 0, 'ce-rerank~query-tasktype': 0 };
const ids = (arm, r) => new Set([...r.arms[arm].specs, ...r.arms[arm].code].map((x) => x.chunkId));
for (const r of rerank) {
  for (const key of Object.keys(overlap)) {
    const [a, b] = key.split('~');
    const j = jaccard(ids(a, r), ids(b, r));
    overlap[key].push(j);
    if (j === 1) identical[key] += 1;
  }
}

// 4. Cost percentiles on the pre-registered denominator (the 31) beside all 55.
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const cost = {};
for (const k of ['ce', 'tasktype']) {
  cost[k] = { on31: { p50: pct(issue.map((r) => r.ms[k]), 0.5), p95: pct(issue.map((r) => r.ms[k]), 0.95), max: Math.max(...issue.map((r) => r.ms[k])) }, on55: { p50: pct(rerank.map((r) => r.ms[k]), 0.5), p95: pct(rerank.map((r) => r.ms[k]), 0.95), max: Math.max(...rerank.map((r) => r.ms[k])) } };
}

// 5. The CE-arm query asymmetry: the cross-encoder scored q.raw while the embedder saw q.expanded.
const queries = new Map(readNdjson('r1-queries.ndjson').map((q) => [q.id, q]));
const p8 = (r, arm) => { const items = [...r.arms[arm].specs, ...r.arms[arm].code]; return items.filter((it) => labels.get(r.id + '|' + it.chunkId) === 2).length / items.length; };
const expandedQ = issue.filter((r) => queries.get(r.id).expanded !== queries.get(r.id).raw);
const plainQ = issue.filter((r) => queries.get(r.id).expanded === queries.get(r.id).raw);
const gain = (rows) => mean(rows.map((r) => p8(r, 'ce-rerank') - p8(r, 'baseline')));

const out = {
  at: new Date().toISOString(),
  scoreSeparation: {
    population: 'labelled union of the three arms’ delivered items, one entry per (query, chunk); ceScore where the chunk was in a CE pool, relevance where it carried a vector-leg relevance',
    ceScore: { n: { 2: ce[2].length, 1: ce[1].length, 0: ce[0].length }, mean: { 2: +mean(ce[2]).toFixed(3), 1: +mean(ce[1]).toFixed(3), 0: +mean(ce[0]).toFixed(3) }, median: { 2: +median(ce[2]).toFixed(3), 0: +median(ce[0]).toFixed(3) }, aucRelevantVsNot: +auc(ce[2], ce[0]).toFixed(3) },
    vectorRelevance: { n: { 2: rel[2].length, 1: rel[1].length, 0: rel[0].length }, mean: { 2: +mean(rel[2]).toFixed(3), 1: +mean(rel[1]).toFixed(3), 0: +mean(rel[0]).toFixed(3) }, median: { 2: +median(rel[2]).toFixed(3), 0: +median(rel[0]).toFixed(3) }, aucRelevantVsNot: +auc(rel[2], rel[0]).toFixed(3) },
    labelsByChunkType: byType,
  },
  baselineOnThe31: { queriesWithARelevantSpecItem: specAny, queriesWithARelevantCodeItem: codeAny, specPartitionSources: Object.entries(sources).sort((a, b) => b[1] - a[1]) },
  deliveredSetOverlap: Object.fromEntries(Object.keys(overlap).map((k) => [k, { meanJaccard: +mean(overlap[k]).toFixed(3), medianJaccard: +median(overlap[k]).toFixed(3), identicalOf55: identical[k] }])),
  costMs: cost,
  ceQueryAsymmetry: { note: 'ce-rerank scored q.raw; the baseline and query-tasktype arms embedded q.expanded', issueQueriesWhereExpansionFired: expandedQ.length, ceGainWhereExpansionFired: +gain(expandedQ).toFixed(4), issueQueriesWithoutExpansion: plainQ.length, ceGainWithoutExpansion: +gain(plainQ).toFixed(4) },
};
fs.writeFileSync(path.join(F, 'r1-diagnostics.json'), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
