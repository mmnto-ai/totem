// R1 reranker arms (mmnto-ai/totem-strategy#1193). Reads r1-retrieval.ndjson (the
// production path + raw legs at the pin) and produces, per query, three delivered sets:
//   baseline      — the production hybrid order as delivered (5 spec + 3 code)
//   ce-rerank     — the raw candidate pools (vector ∪ FTS, per type) re-scored by a local
//                   cross-encoder (Xenova/bge-reranker-base, ONNX q8 via transformers.js)
//   query-tasktype — the same hybrid fusion but with the query embedded as RETRIEVAL_QUERY
//                   (the production embedder sends RETRIEVAL_DOCUMENT for queries too)
// plus r1-candidates.ndjson: the union of every arm's delivered items with chunk text, for
// hand labelling. Measurement-only; nothing here ships.
//
// Usage: node r1-rerank.mjs --resident D:/Dev/totem --worktree <wt> --deps <dir with node_modules/@huggingface/transformers> --out <fixture dir> [--limit N]
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']);
    return acc;
  }, []),
);
const resident = args.resident ?? 'D:/Dev/totem';
const worktree = args.worktree ?? 'D:/Dev/worktrees/totem-totem-claude-r1193';
const depsDir = args.deps;
const outDir = args.out;
const limit = args.limit ? Number(args.limit) : Infinity;
if (!depsDir || !outDir) throw new Error('--deps and --out are required');

const RRF_K = 60; // packages/core/src/store/lance-search.ts
const MAX_SPECS = 5;
const MAX_CODE = 3;
const CANDIDATE_TEXT_CHARS = 2000;
const CE_MODEL = 'Xenova/bge-reranker-base';
const EMBED_MODEL = 'gemini-embedding-2-preview';
const EMBED_DIMS = 768;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = canonicalize(value[key]);
    return sorted;
  }
  return value;
}
// packages/core/src/artifacts/hash.ts — sha256 over the canonical JSON of the payload
const contentHash = (s) => crypto.createHash('sha256').update(JSON.stringify(canonicalize(s)), 'utf-8').digest('hex');
const keyOf = (r) => r.filePath + '\u0000' + r.label + '\u0000' + r.type;

// ── deps ──
const reqCore = createRequire(path.join(worktree, 'packages', 'core', 'package.json'));
const lancedb = await import(pathToFileURL(reqCore.resolve('@lancedb/lancedb')).href);
const reqDeps = createRequire(path.join(depsDir, 'package.json'));
const tfmMod = await import(pathToFileURL(reqDeps.resolve('@huggingface/transformers')).href);
const tfm = tfmMod.AutoTokenizer ? tfmMod : tfmMod.default;
const genaiPath = path.join(worktree, 'packages', 'cli', 'node_modules', '@google', 'genai', 'dist', 'node', 'index.mjs');
const { GoogleGenAI } = await import(pathToFileURL(genaiPath).href);
const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
if (!apiKey) throw new Error('GEMINI_API_KEY missing');
const ai = new GoogleGenAI({ apiKey });

// ── the index, read-only ──
const db = await lancedb.connect(path.join(resident, '.lancedb'));
const table = await db.openTable('totem_chunks');
const rowsAll = await table.query().select(['id', 'content', 'filePath', 'label', 'type', 'startLine', 'endLine']).limit(100000).toArray();
const byKey = new Map();
for (const r of rowsAll) {
  const k = keyOf(r);
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push({ id: r.id, content: r.content, filePath: r.filePath, label: r.label, type: r.type, startLine: r.startLine, endLine: r.endLine, contentHash: contentHash(r.content) });
}
let ambiguousResolutions = 0;
let unresolved = 0;
function resolve(hit, preferredHashes) {
  const list = byKey.get(keyOf(hit));
  if (!list || list.length === 0) { unresolved += 1; return null; }
  if (list.length === 1) return list[0];
  ambiguousResolutions += 1;
  const pref = list.find((r) => preferredHashes.has(r.contentHash));
  return pref ?? list[0];
}

// ── cross-encoder ──
const t0 = Date.now();
const tok = await tfm.AutoTokenizer.from_pretrained(CE_MODEL);
const ce = await tfm.AutoModelForSequenceClassification.from_pretrained(CE_MODEL, { dtype: 'q8' });
const ceLoadMs = Date.now() - t0;
async function ceScores(query, docs) {
  if (docs.length === 0) return [];
  const out = [];
  const B = 16;
  for (let i = 0; i < docs.length; i += B) {
    const batch = docs.slice(i, i + B);
    const inputs = tok(new Array(batch.length).fill(query), { text_pair: batch, padding: true, truncation: true });
    const res = await ce(inputs);
    out.push(...Array.from(res.logits.data));
  }
  return out;
}

// ── query embedding with the QUERY task type ──
let embedCalls = 0;
async function embedQuery(text) {
  embedCalls += 1;
  const response = await ai.models.embedContent({
    model: EMBED_MODEL,
    contents: [{ parts: [{ text }] }],
    config: { taskType: 'RETRIEVAL_QUERY', outputDimensionality: EMBED_DIMS },
  });
  return response.embeddings[0].values;
}
async function vectorLeg(vec, type, n) {
  const rows = await table.vectorSearch(vec).where('`type` = \'' + type + '\'').limit(n).select(['id', 'content', 'filePath', 'label', 'type', 'startLine', 'endLine']).toArray();
  return rows.map((r, i) => ({ rank: i + 1, id: r.id, filePath: r.filePath, label: r.label, type: r.type, _distance: r._distance, relevance: 1 / (1 + r._distance), content: r.content, contentHash: contentHash(r.content), startLine: r.startLine, endLine: r.endLine }));
}
function rrf(listA, listB, limitN) {
  const scores = new Map();
  for (const list of [listA, listB]) {
    for (const item of list) {
      const k = item.id ?? keyOf(item);
      const e = scores.get(k) ?? { score: 0, item };
      e.score += 1 / (RRF_K + item.rank);
      scores.set(k, e);
    }
  }
  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limitN).map(({ score, item }) => ({ ...item, rrfScore: score }));
}

// ── inputs ──
const retrieval = fs.readFileSync(path.join(outDir, 'r1-retrieval.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const queries = new Map(fs.readFileSync(path.join(outDir, 'r1-queries.ndjson'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((q) => [q.id, q]));

const rerankRows = [];
const candidateRows = [];
const perQueryMs = { ce: [], tasktype: [] };
let pairsScored = 0;
let n = 0;
for (const row of retrieval) {
  if (n >= limit) break;
  n += 1;
  const q = queries.get(row.id);
  const preferred = new Set([...row.production.specs, ...row.production.code].map((h) => h.contentHash));

  // baseline: the production delivered set (5 spec + 3 code), resolved to chunks for text
  const baseline = { specs: row.production.specs.map((h) => ({ ...h, chunk: resolve(h, preferred) })), code: row.production.code.map((h) => ({ ...h, chunk: resolve(h, preferred) })) };

  // ce-rerank over the raw pools (vector ∪ FTS per type)
  const tCe = Date.now();
  const pools = {};
  for (const type of ['spec', 'code']) {
    const leg = row.raw.legs[type];
    const seen = new Map();
    for (const h of [...leg.vector, ...leg.fts]) {
      const chunk = resolve(h, preferred);
      if (!chunk) continue;
      if (!seen.has(chunk.id)) seen.set(chunk.id, { chunk, vectorRank: null, ftsRank: null, relevance: null });
      const e = seen.get(chunk.id);
      if (h._distance !== undefined) { e.vectorRank = e.vectorRank ?? h.rank; e.relevance = e.relevance ?? h.relevance; } else { e.ftsRank = e.ftsRank ?? h.rank; }
    }
    pools[type] = [...seen.values()];
  }
  const ceQuery = q.raw;
  for (const type of ['spec', 'code']) {
    const docs = pools[type].map((p) => p.chunk.content);
    const scores = await ceScores(ceQuery, docs);
    pairsScored += docs.length;
    pools[type].forEach((p, i) => { p.ceScore = scores[i]; });
    pools[type].sort((a, b) => b.ceScore - a.ceScore);
  }
  const ceMs = Date.now() - tCe;
  perQueryMs.ce.push(ceMs);
  const reranked = { specs: pools.spec.slice(0, MAX_SPECS), code: pools.code.slice(0, MAX_CODE) };
  // CE score of the baseline items (diagnostic: score separation, never the verdict)
  const ceByChunk = new Map([...pools.spec, ...pools.code].map((p) => [p.chunk.id, p.ceScore]));

  // query-tasktype arm: RETRIEVAL_QUERY embedding → vector legs → RRF with the recorded FTS legs
  const tTt = Date.now();
  const qvec = await embedQuery(q.expanded);
  const tt = {};
  for (const [type, cap, over] of [['spec', MAX_SPECS, 60], ['code', MAX_CODE, 9]]) {
    const vec = await vectorLeg(qvec, type, over);
    const fts = row.raw.legs[type].fts.map((h) => { const c = resolve(h, preferred); return c ? { rank: h.rank, id: c.id, filePath: c.filePath, label: c.label, type: c.type, content: c.content, contentHash: c.contentHash, _score: h._score } : null; }).filter(Boolean);
    tt[type] = rrf(vec, fts, cap);
  }
  const ttMs = Date.now() - tTt;
  perQueryMs.tasktype.push(ttMs);

  const item = (x, extra) => ({ chunkId: x.chunk?.id ?? x.id, filePath: x.filePath ?? x.chunk?.filePath, label: x.label ?? x.chunk?.label, type: x.type ?? x.chunk?.type, contentHash: x.contentHash ?? x.chunk?.contentHash, ...extra });
  rerankRows.push({
    id: row.id,
    anchorKind: row.anchorKind,
    ceQueryChars: ceQuery.length,
    pools: { spec: pools.spec.length, code: pools.code.length },
    arms: {
      baseline: { specs: baseline.specs.map((h, i) => item(h, { rank: i + 1, score: h.score, relevance: h.relevance ?? null, ceScore: ceByChunk.get(h.chunk?.id) ?? null })), code: baseline.code.map((h, i) => item(h, { rank: i + 1, score: h.score, relevance: h.relevance ?? null, ceScore: ceByChunk.get(h.chunk?.id) ?? null })) },
      'ce-rerank': { specs: reranked.specs.map((p, i) => item(p, { rank: i + 1, ceScore: p.ceScore, vectorRank: p.vectorRank, ftsRank: p.ftsRank, relevance: p.relevance })), code: reranked.code.map((p, i) => item(p, { rank: i + 1, ceScore: p.ceScore, vectorRank: p.vectorRank, ftsRank: p.ftsRank, relevance: p.relevance })) },
      'query-tasktype': { specs: tt.spec.map((x, i) => item(x, { rank: i + 1, rrfScore: x.rrfScore, relevance: x.relevance ?? null, ceScore: ceByChunk.get(x.id) ?? null })), code: tt.code.map((x, i) => item(x, { rank: i + 1, rrfScore: x.rrfScore, relevance: x.relevance ?? null, ceScore: ceByChunk.get(x.id) ?? null })) },
    },
    poolItems: { spec: pools.spec.map((p) => ({ chunkId: p.chunk.id, filePath: p.chunk.filePath, label: p.chunk.label, ceScore: p.ceScore, vectorRank: p.vectorRank, ftsRank: p.ftsRank, relevance: p.relevance })), code: pools.code.map((p) => ({ chunkId: p.chunk.id, filePath: p.chunk.filePath, label: p.chunk.label, ceScore: p.ceScore, vectorRank: p.vectorRank, ftsRank: p.ftsRank, relevance: p.relevance })) },
    ms: { ce: ceMs, tasktype: ttMs },
  });

  // candidate union for labelling
  const union = new Map();
  const add = (arm, part, list) => list.forEach((x, i) => {
    const id = x.chunkId ?? x.chunk?.id ?? x.id;
    if (!id) return;
    const chunk = x.chunk ?? x;
    if (!union.has(id)) union.set(id, { chunkId: id, filePath: chunk.filePath, label: chunk.label, type: chunk.type, text: String(chunk.content ?? '').slice(0, CANDIDATE_TEXT_CHARS), textChars: String(chunk.content ?? '').length, deliveredBy: {} });
    union.get(id).deliveredBy[arm + ':' + part] = i + 1;
  });
  add('baseline', 'specs', baseline.specs); add('baseline', 'code', baseline.code);
  add('ce-rerank', 'specs', reranked.specs); add('ce-rerank', 'code', reranked.code);
  add('query-tasktype', 'specs', tt.spec); add('query-tasktype', 'code', tt.code);
  candidateRows.push({ id: row.id, anchorKind: row.anchorKind, queryRaw: q.raw, candidates: [...union.values()] });
  console.log(JSON.stringify({ id: row.id.slice(0, 8), kind: row.anchorKind, pools: { spec: pools.spec.length, code: pools.code.length }, union: union.size, ceMs, ttMs }));
}

fs.writeFileSync(path.join(outDir, 'r1-rerank.ndjson'), rerankRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(path.join(outDir, 'r1-candidates.ndjson'), candidateRows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const pct = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const cost = {
  at: new Date().toISOString(),
  ceModel: CE_MODEL, ceDtype: 'q8', transformersJs: JSON.parse(fs.readFileSync(path.join(depsDir, 'node_modules', '@huggingface', 'transformers', 'package.json'), 'utf8')).version,
  ceLoadMs, pairsScored, queries: rerankRows.length,
  ceMsPerQuery: { mean: Math.round(perQueryMs.ce.reduce((a, b) => a + b, 0) / perQueryMs.ce.length), p50: pct(perQueryMs.ce, 0.5), p95: pct(perQueryMs.ce, 0.95), max: Math.max(...perQueryMs.ce) },
  tasktypeMsPerQuery: { mean: Math.round(perQueryMs.tasktype.reduce((a, b) => a + b, 0) / perQueryMs.tasktype.length), p50: pct(perQueryMs.tasktype, 0.5), p95: pct(perQueryMs.tasktype, 0.95), max: Math.max(...perQueryMs.tasktype) },
  embedCallsQueryTaskType: embedCalls, embedModel: EMBED_MODEL, embedDims: EMBED_DIMS,
  chunkResolution: { tableRows: rowsAll.length, distinctKeys: byKey.size, ambiguousResolutions, unresolved },
  ceTruncation: 'tokenizer truncation=true at the model max (512 tokens per pair); the query is the RAW query (title + labels + body[:500] for issues, the topic text for topics)',
  machine: { cpu: os.cpus()[0]?.model, cores: os.cpus().length, node: process.version, gpu: 'none used (onnxruntime CPU EP)' },
};
fs.writeFileSync(path.join(outDir, 'r1-rerank-cost.json'), JSON.stringify(cost, null, 2));
console.log(JSON.stringify(cost, null, 2));
