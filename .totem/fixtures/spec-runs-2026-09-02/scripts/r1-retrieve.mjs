#!/usr/bin/env node
/**
 * R1 RE-RETRIEVAL HARNESS (round 1193 measurements).
 *
 * Re-runs every retained `totem spec` query against the index at its pin
 * through the PRODUCTION retrieval path (imported from the built `dist`, never
 * reimplemented), captures the raw vector/FTS legs, and measures the stored
 * embedding vector norms plus the LanceDB SDK's distance metric.
 *
 * Usage:
 *   node r1-retrieve.mjs --resident D:/Dev/totem --out <fixture dir> [--limit N] [--skip-norms]
 *
 * READ-ONLY against the resident index: no sync/add/delete/createTable/optimize.
 * Mutating LanceStore methods are shadowed with throwing guards before connect().
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

// ─── Args ───────────────────────────────────────────────

function parseArgs(argv) {
  const out = { resident: null, out: null, limit: null, skipNorms: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--resident') out.resident = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--skip-norms') out.skipNorms = true;
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!out.resident || !out.out) throw new Error('Both --resident and --out are required');
  return out;
}

const ARGS = parseArgs(process.argv.slice(2));
const RESIDENT = path.resolve(ARGS.resident);
const OUT_DIR = path.resolve(ARGS.out);
// The worktree root is two levels above <out>/scripts/ ... resolve from this file.
const SCRIPT_DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const WORKTREE = path.resolve(SCRIPT_DIR, '..', '..', '..', '..');

const CLI_DIST = path.join(WORKTREE, 'packages', 'cli', 'dist');
const CORE_DIST = path.join(WORKTREE, 'packages', 'core', 'dist');
const LANCEDB_PKG = path.join(WORKTREE, 'packages', 'core', 'node_modules', '@lancedb', 'lancedb');

const notes = [];
const note = (s) => {
  notes.push(s);
  console.error(`[note] ${s}`);
};

// ─── Imports from the BUILT production path ─────────────

const specMod = await import(pathToFileURL(path.join(CLI_DIST, 'commands', 'spec.js')).href);
const cliUtils = await import(pathToFileURL(path.join(CLI_DIST, 'utils.js')).href);
const core = await import(pathToFileURL(path.join(CORE_DIST, 'index.js')).href);
const lancedb = await import(pathToFileURL(path.join(LANCEDB_PKG, 'dist', 'index.js')).href);

const { retrieveContext, expandSpecQuery } = specMod;
const { buildRetrievalGroundingBundle, loadConfig, resolveConfigPath, requireEmbedding, loadEnv } =
  cliUtils;
const { LanceStore, createEmbedder, calculateDeterministicHash } = core;

for (const [name, fn] of Object.entries({
  retrieveContext,
  expandSpecQuery,
  buildRetrievalGroundingBundle,
  LanceStore,
  createEmbedder,
  calculateDeterministicHash,
})) {
  if (typeof fn !== 'function') throw new Error(`Missing production export: ${name}`);
}

const TOTEM_TABLE_NAME = 'totem_chunks';
const RRF_OVERFETCH = 3;
// Mirrors spec.ts: SPEC_SEARCH_POOL 20, MAX_SESSIONS 5, MAX_CODE_RESULTS 3.
const RAW_LEGS = [
  { typeFilter: 'spec', maxResults: 20 },
  { typeFilter: 'session_log', maxResults: 5 },
  { typeFilter: 'code', maxResults: 3 },
];

// ─── buildWhereClause — verbatim mirror of lance-search.ts ──

function escapeBoundaryPrefix(raw) {
  const normalized = raw.replace(/\\/g, '/');
  return normalized.replace(/%/g, '\\%').replace(/_/g, '\\_').replace(/'/g, "''");
}

function buildWhereClause(typeFilter, boundary) {
  const conditions = [];
  if (typeFilter) {
    const safeType = typeFilter.replace(/'/g, "''");
    conditions.push('`type` = ' + `'${safeType}'`);
  }
  const prefixes = boundary
    ? (Array.isArray(boundary) ? boundary : [boundary]).filter((b) => b.length > 0)
    : [];
  if (prefixes.length > 0) {
    const orClauses = prefixes
      .map((p) => '`filePath` LIKE ' + `'${escapeBoundaryPrefix(p)}%'`)
      .join(' OR ');
    conditions.push(prefixes.length > 1 ? `(${orClauses})` : orClauses);
  }
  return conditions.length > 0 ? conditions.join(' AND ') : undefined;
}

// ─── Query-corpus derivation from the retained artifacts ──

const CLOSE_TAG_UNESCAPE = /<\\\/(\s*[a-z_]+\s*)>/gi;
const unescapeWrapXml = (s) => s.replace(CLOSE_TAG_UNESCAPE, '</$1>');

const QUERY_BODY_TRUNCATE = 500;

function parseAnchors(maskedPrompt) {
  const cut = maskedPrompt.indexOf('\n=== TOTEM KNOWLEDGE ===');
  const region = cut >= 0 ? maskedPrompt.slice(0, cut) : maskedPrompt;
  const parts = [];

  const markerRe = /\n=== (?:ISSUE #(\d+): |TOPIC ===|RECORD )/g;
  const starts = [];
  let m;
  while ((m = markerRe.exec(region)) !== null) starts.push(m.index);

  for (let i = 0; i < starts.length; i++) {
    const chunk = region.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : region.length);
    const issueHead = chunk.match(
      /^\n=== ISSUE #(\d+): [\s\S]*? ===\n<issue_title>\n([\s\S]*?)\n<\/issue_title>\nLabels: (.*)\nState: (.*)$/m,
    );
    if (issueHead) {
      const number = Number(issueHead[1]);
      const title = unescapeWrapXml(issueHead[2]);
      const labelsRaw = issueHead[3].trim();
      const labels = labelsRaw === '(none)' ? [] : labelsRaw.split(',').map((s) => s.trim());
      const bodyMatch = chunk.match(/\n<issue_body>\n([\s\S]*?)\n<\/issue_body>/);
      const body = bodyMatch ? unescapeWrapXml(bodyMatch[1]) : '';
      // Verbatim mirror of spec.ts buildSearchQuery().
      const raw = `${title} ${labels.join(' ')} ${body.slice(0, QUERY_BODY_TRUNCATE)}`.trim();
      parts.push({ kind: 'issue', number, raw });
      continue;
    }
    const topic = chunk.match(/^\n=== TOPIC ===\n<topic_text>\n([\s\S]*?)\n<\/topic_text>/m);
    if (topic) {
      parts.push({ kind: 'topic', raw: unescapeWrapXml(topic[1]).trim() });
      continue;
    }
    const record = chunk.match(
      /^\n=== RECORD (\S+) \(sha256 ([0-9a-f]+)\) ===\n<record_body>\n([\s\S]*?)\n<\/record_body>/m,
    );
    if (record) {
      parts.push({ kind: 'record', path: record[1], raw: '<<UNRECONSTRUCTIBLE-RECORD-QUERY>>' });
      continue;
    }
    parts.push({ kind: 'unparsed', raw: '', head: chunk.slice(0, 120) });
  }
  return parts;
}

function deriveCorpus(residentRoot) {
  const dir = path.join(residentRoot, '.totem', 'artifacts', 'runs');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const rows = [];
  let totalArtifacts = 0;
  for (const f of files) {
    totalArtifacts++;
    let j;
    try {
      j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (err) {
      note(`artifact ${f} failed to parse: ${err.message}`);
      continue;
    }
    if (j?.admission?.runMetadata?.caller !== 'spec') continue;
    const maskedPrompt = j?.inputBundle?.maskedPrompt ?? '';
    const parts = parseAnchors(maskedPrompt);
    if (parts.length === 0) {
      note(`artifact ${f}: no anchor parsed`);
    }
    const kinds = [...new Set(parts.map((p) => p.kind))];
    const anchorKind =
      kinds.length === 0 ? 'none' : kinds.length === 1 ? kinds[0] : `mixed(${kinds.join('+')})`;
    // Mirrors specCommand: queryParts.join(' ') then expandSpecQuery().
    const raw = parts.map((p) => p.raw).join(' ');
    rows.push({
      id: path.basename(f, '.json'),
      anchorKind,
      anchorParts: parts.map((p) => ({ kind: p.kind, ...(p.number ? { number: p.number } : {}) })),
      raw,
      expanded: expandSpecQuery(raw),
      historical: j?.grounding?.bundle?.items ?? [],
      createdAt: j?.createdAt ?? null,
      artifactFile: path.join(dir, f),
    });
  }
  return { rows, totalArtifacts };
}

// ─── Numeric helpers ────────────────────────────────────

const toNums = (v) => {
  if (v == null) return null;
  if (Array.isArray(v)) return v;
  if (ArrayBuffer.isView(v)) return Array.from(v);
  if (typeof v.toArray === 'function') return Array.from(v.toArray());
  if (typeof v[Symbol.iterator] === 'function') return Array.from(v);
  return null;
};

const l2norm = (v) => Math.sqrt(v.reduce((s, x) => s + x * x, 0));

function quantile(sortedAsc, q) {
  if (sortedAsc.length === 0) return null;
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

function stats(values) {
  if (values.length === 0) return { n: 0 };
  const s = [...values].sort((a, b) => a - b);
  return {
    n: s.length,
    min: s[0],
    p5: quantile(s, 0.05),
    median: quantile(s, 0.5),
    mean: s.reduce((a, b) => a + b, 0) / s.length,
    p95: quantile(s, 0.95),
    max: s[s.length - 1],
  };
}

const jaccard = (a, b) => {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
};

// ─── Embedder instrumentation ───────────────────────────

const embedStats = { productionCalls: 0, harnessCalls: 0, chars: 0, retries: 0, failures: 0 };
let embedPhase = 'production';

function instrumentEmbedder(embedder) {
  const orig = embedder.embed.bind(embedder);
  embedder.embed = async (texts) => {
    const chars = texts.reduce((s, t) => s + t.length, 0);
    embedStats.chars += chars;
    if (embedPhase === 'production') embedStats.productionCalls++;
    else embedStats.harnessCalls++;
    // The production GeminiEmbedder already retries 429/503 with exponential
    // backoff (MAX_RETRIES 3). This outer loop only covers the terminal
    // EMBEDDING_UNAVAILABLE after that budget is spent, and logs every retry.
    let lastErr;
    for (let attempt = 0; attempt <= 2; attempt++) {
      try {
        return await orig(texts);
      } catch (err) {
        lastErr = err;
        embedStats.retries++;
        const wait = 30_000 * (attempt + 1);
        console.error(
          `[embed-retry] attempt ${attempt + 1}/3 failed (${err?.message ?? err}); waiting ${wait}ms`,
        );
        if (attempt === 2) break;
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    embedStats.failures++;
    throw lastErr;
  };
  return embedder;
}

// ─── Read-only guards on the store ──────────────────────

function guardStore(store) {
  const forbidden = [
    'add',
    'addChunks',
    'nukeAndReset',
    'clear',
    'deleteByPath',
    'delete',
    'createIndex',
    'createFtsIndex',
    'optimize',
    'sync',
  ];
  const guarded = [];
  for (const name of forbidden) {
    if (typeof store[name] === 'function' || typeof Object.getPrototypeOf(store)[name] === 'function') {
      store[name] = async () => {
        throw new Error(`R1 GUARD: refused mutating LanceStore.${name}() on the read-only index`);
      };
      guarded.push(name);
    }
  }
  return guarded;
}

// ─── Main ───────────────────────────────────────────────

const runStartedAt = new Date().toISOString();
const t0 = Date.now();

fs.mkdirSync(OUT_DIR, { recursive: true });

// 1. Corpus
const { rows: corpusAll, totalArtifacts } = deriveCorpus(RESIDENT);
const corpus = ARGS.limit ? corpusAll.slice(0, ARGS.limit) : corpusAll;
console.error(
  `[r1] artifacts=${totalArtifacts} spec-artifacts=${corpusAll.length} selected=${corpus.length}`,
);

fs.writeFileSync(
  path.join(OUT_DIR, 'r1-queries.ndjson'),
  corpusAll
    .map((r) =>
      JSON.stringify({
        id: r.id,
        anchorKind: r.anchorKind,
        anchorParts: r.anchorParts,
        raw: r.raw,
        expanded: r.expanded,
        rawChars: r.raw.length,
        expandedChars: r.expanded.length,
        createdAt: r.createdAt,
      }),
    )
    .join('\n') + '\n',
);

// 2. Config + embedder + store (mirrors specCommand construction)
loadEnv(RESIDENT);
let embeddingConfig;
let lanceDir;
let configSource;
try {
  const configPath = resolveConfigPath(RESIDENT);
  const config = await loadConfig(configPath);
  embeddingConfig = requireEmbedding(config);
  lanceDir = config.lanceDir;
  configSource = configPath;
} catch (err) {
  note(`loadConfig failed (${err?.message ?? err}); falling back to the literal embedding block`);
  embeddingConfig = { provider: 'gemini', model: 'gemini-embedding-2-preview', dimensions: 768 };
  lanceDir = '.lancedb';
  configSource = 'LITERAL FALLBACK';
}
const dbPath = path.join(RESIDENT, lanceDir);
console.error(`[r1] config=${configSource} embedding=${JSON.stringify(embeddingConfig)}`);
console.error(`[r1] dbPath=${dbPath}`);

// 2a. Raw read-only handle (also the dimension pre-check, so LanceStore.connect()
// can never take its dimension-mismatch auto-heal branch).
const rawDb = await lancedb.connect(dbPath);
const tableNames = await rawDb.tableNames();
if (!tableNames.includes(TOTEM_TABLE_NAME)) {
  throw new Error(`Table ${TOTEM_TABLE_NAME} not found in ${dbPath} (have: ${tableNames})`);
}
const table = await rawDb.openTable(TOTEM_TABLE_NAME);
const tableRowCount = await table.countRows();
const indices = await table.listIndices();
const typeCensusRows = await table.query().select(['type']).limit(1_000_000).toArray();
const typeCensus = {};
for (const r of typeCensusRows) typeCensus[r.type] = (typeCensus[r.type] ?? 0) + 1;
const probe = await table.query().limit(1).toArray();
const probeVec = toNums(probe[0]?.vector);
if (!probeVec) throw new Error('Could not read a stored vector for the dimension pre-check');
const expectedDims = embeddingConfig.dimensions ?? 768;
if (probeVec.length !== expectedDims) {
  throw new Error(
    `ABORT: stored dims ${probeVec.length} !== embedder dims ${expectedDims} — connect() would auto-heal (nuke) the index`,
  );
}
console.error(
  `[r1] table rows=${tableRowCount} dims=${probeVec.length} indices=${JSON.stringify(indices.map((i) => ({ name: i.name, type: i.indexType })))}`,
);

const embedder = instrumentEmbedder(createEmbedder(embeddingConfig));
const store = new LanceStore(dbPath, embedder, { absolutePathRoot: RESIDENT });
const guarded = guardStore(store);
console.error(`[r1] guarded mutating store methods: ${guarded.join(', ')}`);
await store.connect();

// 3. Norms + metric
let normsReport = null;
if (!ARGS.skipNorms) {
  embedPhase = 'harness';
  const normT0 = Date.now();
  const sampleRows = await table.query().select(['vector', 'filePath']).limit(2000).toArray();
  const norms = [];
  for (const r of sampleRows) {
    const v = toNums(r.vector);
    if (v) norms.push(l2norm(v));
  }
  const normStats = stats(norms);
  const unitNorm = norms.every((n) => Math.abs(1 - n) < 1e-3);

  // Sample query embeddings (3 real from the corpus + 2 nonsense).
  const realSamples = corpusAll.slice(0, 3).map((r) => r.expanded);
  const nonsense = ['xyzzy plugh qwertyuiop zzz', 'blorptak fnord wibblewobble quux'];
  const sampleQueries = [...realSamples, ...nonsense];
  const queryNorms = [];
  for (const q of sampleQueries) {
    const [v] = await embedder.embed([q]);
    queryNorms.push({
      chars: q.length,
      preview: q.slice(0, 60),
      dims: v.length,
      norm: l2norm(v),
    });
  }

  // Metric determination over 3 stored rows — one per content type present,
  // so the trials are not three neighbours out of the same file.
  const metricTrials = [];
  const anchorRows = [];
  for (const t of ['code', 'spec', 'lesson']) {
    const rows = await table
      .query()
      .where(buildWhereClause(t, undefined))
      .select(['vector', 'filePath', 'label', 'type'])
      .limit(1)
      .toArray();
    if (rows[0]) anchorRows.push(rows[0]);
  }
  for (const a of anchorRows) {
    const vecA = toNums(a.vector);
    const hits = await table.vectorSearch(vecA).limit(3).toArray();
    const top = hits[0];
    const topVec = toNums(top?.vector);
    const b = hits[1];
    const vecB = toNums(b?.vector);
    let l2 = null,
      l2sq = null,
      cos = null,
      oneMinusCos = null;
    if (vecB) {
      let sq = 0,
        dot = 0;
      for (let i = 0; i < vecA.length; i++) {
        const d = vecA[i] - vecB[i];
        sq += d * d;
        dot += vecA[i] * vecB[i];
      }
      l2sq = sq;
      l2 = Math.sqrt(sq);
      cos = dot / (l2norm(vecA) * l2norm(vecB));
      oneMinusCos = 1 - cos;
    }
    const sdk = b?._distance ?? null;
    const near = (x) => x != null && sdk != null && Math.abs(x - sdk) < 1e-5;
    // Same query under an explicit cosine metric.
    let cosineDistanceForB = null;
    try {
      const cosHits = await table.vectorSearch(vecA).distanceType('cosine').limit(3).toArray();
      const match = cosHits.find(
        (h) => h.filePath === b?.filePath && h.label === b?.label && h.content === b?.content,
      );
      cosineDistanceForB = match ? match._distance : { note: 'B not in cosine top-3', top3: cosHits.map((h) => ({ filePath: h.filePath, label: h.label, _distance: h._distance })) };
    } catch (err) {
      cosineDistanceForB = { error: String(err?.message ?? err) };
    }
    metricTrials.push({
      a: { filePath: a.filePath, label: a.label, type: a.type },
      selfHit: {
        isSelf: top?.filePath === a.filePath && top?.label === a.label,
        filePath: top?.filePath,
        label: top?.label,
        _distance: top?._distance ?? null,
        vectorIdentical: topVec ? topVec.every((x, i) => x === vecA[i]) : null,
      },
      b: { filePath: b?.filePath, label: b?.label, sdkDistance: sdk },
      handComputed: { l2, l2sq, cos, oneMinusCos },
      matches: { l2: near(l2), l2sq: near(l2sq), cos: near(cos), oneMinusCos: near(oneMinusCos) },
      cosineDistanceForB,
    });
  }

  const verdictCounts = { l2: 0, l2sq: 0, cos: 0, oneMinusCos: 0 };
  for (const t of metricTrials) for (const k of Object.keys(verdictCounts)) if (t.matches[k]) verdictCounts[k]++;
  const metric =
    Object.entries(verdictCounts).find(([, c]) => c === metricTrials.length)?.[0] ?? 'INDETERMINATE';

  // Algebraic range of 1/(1+_distance) for UNIT vectors, given the metric.
  const RANGES = {
    l2: { distance: '[0, 2]', relevance: '[1/3, 1] = [0.3333, 1]' },
    l2sq: { distance: '[0, 4]', relevance: '[1/5, 1] = [0.2, 1]' },
    oneMinusCos: { distance: '[0, 2]', relevance: '[1/3, 1] = [0.3333, 1]' },
    cos: { distance: '[-1, 1] (a similarity, not a distance)', relevance: 'n/a' },
    INDETERMINATE: { distance: 'unknown', relevance: 'unknown' },
  };

  normsReport = {
    generatedAt: new Date().toISOString(),
    dbPath,
    table: TOTEM_TABLE_NAME,
    tableRowCount,
    indices: indices.map((i) => ({ name: i.name, indexType: i.indexType, columns: i.columns })),
    storedVectorNorms: { ...normStats, unitNorm, tolerance: 1e-3, sampled: sampleRows.length },
    queryVectorNorms: queryNorms,
    queryVectorsUnitNorm: queryNorms.every((q) => Math.abs(1 - q.norm) < 1e-3),
    metric: {
      determined: metric,
      trials: metricTrials,
      sdkVersion: '0.26.2',
      sdkDefaultDoc:
        'query.d.ts VectorQuery.distanceType: "Set the distance metric to use ... By default \\"l2\\" is used."',
      sdkMetricDoc:
        'indices.d.ts IvfPqOptions.distanceType: "l2" - Euclidean distance ... range of [0, inf). "cosine" - Cosine distance ... range of [0, 2]. "dot" - Dot product ... range of (-inf, inf).',
    },
    relevanceRangeForUnitVectors: RANGES[metric],
    embedderTaskType: 'RETRIEVAL_DOCUMENT (gemini-embedder.ts embedWithRetry — same for queries)',
    wallMs: Date.now() - normT0,
  };
  fs.writeFileSync(path.join(OUT_DIR, 'r1-norms.json'), JSON.stringify(normsReport, null, 2));
  console.error(`[r1] norms+metric done in ${normsReport.wallMs}ms — metric=${metric}`);
}

// 4. Per-query re-retrieval
const outStream = fs.createWriteStream(path.join(OUT_DIR, 'r1-retrieval.ndjson'), { flags: 'w' });
const prodTimes = [];
const rawTimes = [];
const resultRows = [];

const hitRow = (r) => ({
  filePath: r.filePath,
  type: r.type,
  label: r.label,
  score: r.score,
  ...(r.relevance !== undefined ? { relevance: r.relevance } : {}),
  searchMethod: r.searchMethod,
  contentHash: calculateDeterministicHash(r.content),
  contentChars: (r.content ?? '').length,
});

for (let i = 0; i < corpus.length; i++) {
  const q = corpus[i];
  console.error(`[r1] (${i + 1}/${corpus.length}) ${q.id} [${q.anchorKind}] ${q.expanded.length}ch`);

  // 4a. Production path.
  embedPhase = 'production';
  const prodEmbedBefore = embedStats.productionCalls;
  const pT0 = Date.now();
  const context = await retrieveContext(q.expanded, store);
  const prodMs = Date.now() - pT0;
  prodTimes.push(prodMs);
  const prodEmbedCalls = embedStats.productionCalls - prodEmbedBefore;

  const production = {
    specs: context.specs.map(hitRow),
    sessions: context.sessions.map(hitRow),
    code: context.code.map(hitRow),
    lessons: context.lessons.map(hitRow),
  };
  const bundle = buildRetrievalGroundingBundle(context);
  const bundleItems = bundle.items;

  // 4b. Overlap vs the historical bundle.
  const histPaths = q.historical.map((it) => it.filePath);
  const histHashes = q.historical.map((it) => it.contentHash);
  const newPaths = bundleItems.map((it) => it.filePath);
  const newHashes = bundleItems.map((it) => it.contentHash);
  const sharedPaths = [...new Set(newPaths)].filter((p) => new Set(histPaths).has(p));
  const overlap = {
    byPath: jaccard(histPaths, newPaths),
    byContentHash: jaccard(histHashes, newHashes),
    historicalCount: q.historical.length,
    reRetrievedCount: bundleItems.length,
    historicalDistinctPaths: new Set(histPaths).size,
    reRetrievedDistinctPaths: new Set(newPaths).size,
    sharedPaths,
    sharedContentHashes: [...new Set(newHashes)].filter((h) => new Set(histHashes).has(h)).length,
  };

  // 4c. Raw legs — one embed for the whole set.
  embedPhase = 'harness';
  const rT0 = Date.now();
  const [queryVector] = await embedder.embed([q.expanded]);
  const raw = { embeddedChars: q.expanded.length, queryVectorNorm: l2norm(queryVector), legs: {} };
  let overallBest = null;
  let overallWorst = null;
  let below025 = 0;
  let below0333 = 0;
  for (const leg of RAW_LEGS) {
    const limit = leg.maxResults * RRF_OVERFETCH;
    const whereClause = buildWhereClause(leg.typeFilter, undefined);
    // Vector leg — mirrors runVectorLeg().
    let vq = table.vectorSearch(queryVector).limit(limit).withRowId();
    if (whereClause) vq = vq.where(whereClause);
    const vRows = await vq.toArray();
    const vector = vRows.map((row, idx) => ({
      rank: idx + 1,
      filePath: row.filePath,
      type: row.type,
      label: row.label,
      _distance: row._distance,
      relevance: 1 / (1 + row._distance),
    }));
    // FTS leg — mirrors runFtsLeg(), including its graceful degradation.
    let fts = [];
    let ftsError = null;
    try {
      let fq = table.search(q.expanded, 'fts', 'content').withRowId();
      if (whereClause) fq = fq.where(whereClause);
      fq = fq.limit(limit);
      const fRows = await fq.toArray();
      fts = fRows.map((row, idx) => ({
        rank: idx + 1,
        filePath: row.filePath,
        type: row.type,
        label: row.label,
        _score: row._score ?? null,
      }));
    } catch (err) {
      ftsError = String(err?.message ?? err);
      note(`FTS leg failed for ${q.id} / ${leg.typeFilter}: ${ftsError}`);
    }
    const rels = vector.map((v) => v.relevance);
    const best = rels.length ? Math.max(...rels) : null;
    const worst = rels.length ? Math.min(...rels) : null;
    below025 += rels.filter((r) => r < 0.25).length;
    below0333 += rels.filter((r) => r < 1 / 3).length;
    if (best !== null) overallBest = overallBest === null ? best : Math.max(overallBest, best);
    if (worst !== null) overallWorst = overallWorst === null ? worst : Math.min(overallWorst, worst);
    raw.legs[leg.typeFilter] = {
      limit,
      whereClause,
      vectorCount: vector.length,
      ftsCount: fts.length,
      bestRelevance: best,
      worstRelevance: worst,
      vectorBelow0_25: rels.filter((r) => r < 0.25).length,
      vectorBelow0_333: rels.filter((r) => r < 1 / 3).length,
      vector,
      fts,
      ...(ftsError ? { ftsError } : {}),
    };
  }
  raw.overall = {
    bestRelevance: overallBest,
    worstRelevance: overallWorst,
    vectorBelow0_25: below025,
    vectorBelow0_333: below0333,
  };
  const rawMs = Date.now() - rT0;
  rawTimes.push(rawMs);

  const row = {
    id: q.id,
    anchorKind: q.anchorKind,
    createdAt: q.createdAt,
    rawQueryChars: q.raw.length,
    expandedChars: q.expanded.length,
    expandedApplied: q.expanded !== q.raw,
    production,
    bundleItems,
    provenanceSummary: undefined,
    overlap,
    raw,
    cost: { productionMs: prodMs, rawLegsMs: rawMs, productionEmbedCalls: prodEmbedCalls, harnessEmbedCalls: 1 },
  };
  delete row.provenanceSummary;
  resultRows.push(row);
  outStream.write(JSON.stringify(row) + '\n');
}
await new Promise((res) => outStream.end(res));

// 5. Cost
const totalMs = Date.now() - t0;
const cost = {
  runStartedAt,
  runEndedAt: new Date().toISOString(),
  queries: corpus.length,
  specArtifactsTotal: corpusAll.length,
  artifactsScanned: totalArtifacts,
  embedCalls: {
    production: embedStats.productionCalls,
    harness: embedStats.harnessCalls,
    total: embedStats.productionCalls + embedStats.harnessCalls,
    outerRetries: embedStats.retries,
    failures: embedStats.failures,
  },
  charsEmbedded: embedStats.chars,
  wallMs: totalMs,
  productionCallMs: { mean: prodTimes.length ? prodTimes.reduce((a, b) => a + b, 0) / prodTimes.length : null, p95: quantile([...prodTimes].sort((a, b) => a - b), 0.95), ...stats(prodTimes) },
  rawLegsMs: { mean: rawTimes.length ? rawTimes.reduce((a, b) => a + b, 0) / rawTimes.length : null, p95: quantile([...rawTimes].sort((a, b) => a - b), 0.95), ...stats(rawTimes) },
  machine: {
    platform: `${os.platform()} ${os.release()}`,
    cpuModel: os.cpus()[0]?.model ?? null,
    cpuCount: os.cpus().length,
    totalMemGiB: +(os.totalmem() / 1024 ** 3).toFixed(2),
    node: process.version,
  },
  notes,
};
fs.writeFileSync(path.join(OUT_DIR, 'r1-cost.json'), JSON.stringify(cost, null, 2));

// 6. Summary
const fmt = (x, d = 4) => (x === null || x === undefined || Number.isNaN(x) ? 'n/a' : Number(x).toFixed(d));
const _byKind = (kind) => resultRows.filter((r) => (kind === 'issue' ? r.anchorKind.startsWith('issue') || r.anchorKind.startsWith('mixed') : r.anchorKind === kind));
const kindGroups = {
  all: resultRows,
  issue: resultRows.filter((r) => r.anchorKind === 'issue'),
  topic: resultRows.filter((r) => r.anchorKind === 'topic'),
  mixed: resultRows.filter((r) => r.anchorKind.startsWith('mixed')),
};

const lines = [];
lines.push('# R1 re-retrieval measurements');
lines.push('');
lines.push(`Generated ${cost.runEndedAt} · index ${dbPath} · table ${TOTEM_TABLE_NAME} (${tableRowCount} rows)`);
lines.push('');
lines.push('## Census');
lines.push('');
lines.push(`- artifacts scanned: ${totalArtifacts}`);
lines.push(`- \`caller === 'spec'\`: ${corpusAll.length}`);
const censusKinds = {};
for (const r of corpusAll) censusKinds[r.anchorKind] = (censusKinds[r.anchorKind] ?? 0) + 1;
for (const [k, v] of Object.entries(censusKinds).sort()) lines.push(`- anchorKind \`${k}\`: ${v}`);
lines.push(`- queries re-run this pass: ${corpus.length}`);
lines.push(`- index chunk types: ${JSON.stringify(typeCensus)} (total ${typeCensusRows.length})`);
lines.push(`- expansion (\`expandSpecQuery\`) applied: ${resultRows.filter((r) => r.expandedApplied).length}/${resultRows.length}`);
lines.push('');
if (normsReport) {
  const s = normsReport.storedVectorNorms;
  lines.push('## Stored vector norms');
  lines.push('');
  lines.push(`- n=${s.n} (of ${tableRowCount} rows) · min=${fmt(s.min, 6)} · p5=${fmt(s.p5, 6)} · median=${fmt(s.median, 6)} · mean=${fmt(s.mean, 6)} · p95=${fmt(s.p95, 6)} · max=${fmt(s.max, 6)}`);
  lines.push(`- unit-norm (|1 − norm| < 1e-3 for all): ${s.unitNorm}`);
  lines.push('');
  lines.push('## Query vector norms');
  lines.push('');
  for (const qn of normsReport.queryVectorNorms) lines.push(`- ${fmt(qn.norm, 6)} · dims=${qn.dims} · ${qn.chars}ch · \`${qn.preview.replace(/`/g, "'")}…\``);
  lines.push(`- all unit-norm: ${normsReport.queryVectorsUnitNorm}`);
  lines.push('');
  lines.push('## Distance metric');
  lines.push('');
  lines.push(`- determined: \`${normsReport.metric.determined}\` (3/3 trials, |diff| < 1e-5)`);
  for (const t of normsReport.metric.trials) {
    lines.push(`  - self-hit \`${t.selfHit.filePath}\` isSelf=${t.selfHit.isSelf} _distance=${fmt(t.selfHit._distance, 8)}; B sdk=${fmt(t.b.sdkDistance, 8)} l2=${fmt(t.handComputed.l2, 8)} l2sq=${fmt(t.handComputed.l2sq, 8)} 1−cos=${fmt(t.handComputed.oneMinusCos, 8)} cos=${fmt(t.handComputed.cos, 8)}; cosine-metric B=${typeof t.cosineDistanceForB === 'number' ? fmt(t.cosineDistanceForB, 8) : JSON.stringify(t.cosineDistanceForB)}`);
  }
  lines.push(`- SDK ${normsReport.metric.sdkVersion}; ${normsReport.metric.sdkDefaultDoc}`);
  lines.push(`- range for unit vectors: _distance ∈ ${normsReport.relevanceRangeForUnitVectors.distance} ⇒ 1/(1+_distance) ∈ ${normsReport.relevanceRangeForUnitVectors.relevance}`);
  lines.push('');
}
lines.push('## Overlap vs the historical grounding bundle');
lines.push('');
lines.push('| group | n | mean J(path) | median J(path) | mean J(hash) | median J(hash) | J(path)=0 | J(hash)=0 |');
lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (const [name, group] of Object.entries(kindGroups)) {
  if (group.length === 0) continue;
  const jp = group.map((r) => r.overlap.byPath).sort((a, b) => a - b);
  const jh = group.map((r) => r.overlap.byContentHash).sort((a, b) => a - b);
  lines.push(
    `| ${name} | ${group.length} | ${fmt(jp.reduce((a, b) => a + b, 0) / jp.length)} | ${fmt(quantile(jp, 0.5))} | ${fmt(jh.reduce((a, b) => a + b, 0) / jh.length)} | ${fmt(quantile(jh, 0.5))} | ${group.filter((r) => r.overlap.byPath === 0).length} | ${group.filter((r) => r.overlap.byContentHash === 0).length} |`,
  );
}
lines.push('');
lines.push(`- historical bundle sizes: ${JSON.stringify(stats(resultRows.map((r) => r.overlap.historicalCount)))}`);
lines.push(`- re-retrieved bundle sizes: ${JSON.stringify(stats(resultRows.map((r) => r.overlap.reRetrievedCount)))}`);
lines.push('');
lines.push('## Vector-leg relevance');
lines.push('');
lines.push('| group | n | min best | median best | max best | best < 0.333 | best < 0.25 |');
lines.push('| --- | --- | --- | --- | --- | --- | --- |');
for (const [name, group] of Object.entries(kindGroups)) {
  if (group.length === 0) continue;
  const bests = group.map((r) => r.raw.overall.bestRelevance).filter((x) => x !== null).sort((a, b) => a - b);
  lines.push(
    `| ${name} | ${group.length} | ${fmt(bests[0])} | ${fmt(quantile(bests, 0.5))} | ${fmt(bests[bests.length - 1])} | ${group.filter((r) => r.raw.overall.bestRelevance !== null && r.raw.overall.bestRelevance < 1 / 3).length} | ${group.filter((r) => r.raw.overall.bestRelevance !== null && r.raw.overall.bestRelevance < 0.25).length} |`,
  );
}
lines.push('');
for (const type of ['spec', 'session_log', 'code']) {
  const bests = resultRows.map((r) => r.raw.legs[type]?.bestRelevance).filter((x) => x != null).sort((a, b) => a - b);
  const worsts = resultRows.map((r) => r.raw.legs[type]?.worstRelevance).filter((x) => x != null).sort((a, b) => a - b);
  lines.push(
    `- \`${type}\` leg: bestRelevance min=${fmt(bests[0])} median=${fmt(quantile(bests, 0.5))} max=${fmt(bests[bests.length - 1])}; worstRelevance min=${fmt(worsts[0])} max=${fmt(worsts[worsts.length - 1])}; queries with best < 0.333 = ${resultRows.filter((r) => r.raw.legs[type]?.bestRelevance != null && r.raw.legs[type].bestRelevance < 1 / 3).length}, < 0.25 = ${resultRows.filter((r) => r.raw.legs[type]?.bestRelevance != null && r.raw.legs[type].bestRelevance < 0.25).length}`,
  );
}
const totalVecHits = resultRows.reduce((s, r) => s + Object.values(r.raw.legs).reduce((t, l) => t + l.vectorCount, 0), 0);
const totalFtsHits = resultRows.reduce((s, r) => s + Object.values(r.raw.legs).reduce((t, l) => t + l.ftsCount, 0), 0);
lines.push(`- all vector hits: ${totalVecHits}; below 0.333 = ${resultRows.reduce((s, r) => s + r.raw.overall.vectorBelow0_333, 0)}; below 0.25 = ${resultRows.reduce((s, r) => s + r.raw.overall.vectorBelow0_25, 0)}`);
lines.push(`- all raw FTS hits: ${totalFtsHits}`);
const allProdHits = resultRows.flatMap((r) => [...r.production.specs, ...r.production.sessions, ...r.production.code, ...r.production.lessons]);
const allBundleItems = resultRows.flatMap((r) => r.bundleItems);
lines.push(`- delivered production hits: ${allProdHits.length}; carrying \`relevance\` (vector leg present): ${allProdHits.filter((h) => h.relevance !== undefined).length}; FTS-only (no \`relevance\`): ${allProdHits.filter((h) => h.relevance === undefined).length}`);
const deliveredRels = allProdHits.map((h) => h.relevance).filter((x) => x !== undefined).sort((a, b) => a - b);
lines.push(`- delivered-hit relevance: min=${fmt(deliveredRels[0])} median=${fmt(quantile(deliveredRels, 0.5))} max=${fmt(deliveredRels[deliveredRels.length - 1])}; below 0.333 = ${deliveredRels.filter((r) => r < 1 / 3).length}; below 0.25 = ${deliveredRels.filter((r) => r < 0.25).length}`);
lines.push(`- bundle items: ${allBundleItems.length}; carrying \`relevance\`: ${allBundleItems.filter((it) => it.relevance !== undefined).length}`);
const partTotals = resultRows.reduce(
  (a, r) => {
    a.specs += r.production.specs.length;
    a.sessions += r.production.sessions.length;
    a.code += r.production.code.length;
    a.lessons += r.production.lessons.length;
    return a;
  },
  { specs: 0, sessions: 0, code: 0, lessons: 0 },
);
lines.push(`- delivered by partition: ${JSON.stringify(partTotals)} over ${resultRows.length} queries (caps: specs 5, sessions 5, code 3, lessons 10)`);
lines.push(`- queries delivering 0 sessions: ${resultRows.filter((r) => r.production.sessions.length === 0).length}; 0 lessons: ${resultRows.filter((r) => r.production.lessons.length === 0).length}; 0 code: ${resultRows.filter((r) => r.production.code.length === 0).length}`);
lines.push('');
lines.push('## Cost');
lines.push('');
lines.push(`- wall: ${(cost.wallMs / 1000).toFixed(1)}s for ${cost.queries} queries`);
lines.push(`- embed calls: production ${cost.embedCalls.production}, harness ${cost.embedCalls.harness}, total ${cost.embedCalls.total} (outer retries ${cost.embedCalls.outerRetries}, failures ${cost.embedCalls.failures})`);
lines.push(`- chars embedded: ${cost.charsEmbedded}`);
lines.push(`- production call ms: mean ${fmt(cost.productionCallMs.mean, 1)} · median ${fmt(cost.productionCallMs.median, 1)} · p95 ${fmt(cost.productionCallMs.p95, 1)} · max ${fmt(cost.productionCallMs.max, 1)}`);
lines.push(`- raw-legs ms: mean ${fmt(cost.rawLegsMs.mean, 1)} · median ${fmt(cost.rawLegsMs.median, 1)} · p95 ${fmt(cost.rawLegsMs.p95, 1)} · max ${fmt(cost.rawLegsMs.max, 1)}`);
lines.push(`- machine: ${cost.machine.cpuModel} (${cost.machine.cpuCount} threads), ${cost.machine.totalMemGiB} GiB, ${cost.machine.platform}, node ${cost.machine.node}`);
lines.push('');
if (notes.length) {
  lines.push('## Notes / substitutions');
  lines.push('');
  for (const n of notes) lines.push(`- ${n}`);
  lines.push('');
}
fs.writeFileSync(path.join(OUT_DIR, 'r1-summary.md'), lines.join('\n'));

console.error(`[r1] DONE in ${(totalMs / 1000).toFixed(1)}s — wrote r1-queries.ndjson, r1-retrieval.ndjson, r1-norms.json, r1-cost.json, r1-summary.md`);
