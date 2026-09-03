// Builds the arm-blind labelling file for R1 (mmnto-ai/totem-strategy#1193):
// reads r1-candidates.ndjson (the union of every arm's delivered chunks per query,
// with `deliveredBy`), strips the arm provenance, shuffles each query's candidates
// with a seed derived from the query id, and joins the anchor text from
// artifacts.ndjson so a labeller sees ONLY (anchor, chunk) pairs.
//
// Usage: node r1-blind-candidates.mjs --fixture <dir>
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => { if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] ?? 'true']); return acc; }, []));
const fixture = args.fixture;
if (!fixture) throw new Error('--fixture required');

const readNdjson = (name) => fs.readFileSync(path.join(fixture, name), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const artifacts = new Map(readNdjson('artifacts.ndjson').map((a) => [a.id, a]));
const candidates = readNdjson('r1-candidates.ndjson');

function seededShuffle(list, seedText) {
  const out = [...list];
  let seed = parseInt(crypto.createHash('sha256').update(seedText).digest('hex').slice(0, 8), 16);
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

const rows = candidates.map((c, index) => {
  const a = artifacts.get(c.id);
  const anchor = a.issue
    ? { kind: 'issue', ref: a.anchor.ref, title: a.issue.title, body: a.issue.bodyMasked.slice(0, 4000), anchorCount: a.anchorCount ?? 1 }
    : { kind: 'topic', ref: a.anchor.ref, title: null, body: a.topic, anchorCount: a.anchorCount ?? 1 };
  const shuffled = seededShuffle(c.candidates, c.id).map((x, i) => ({ n: i + 1, chunkId: x.chunkId, filePath: x.filePath, label: x.label, type: x.type, text: x.text, textChars: x.textChars }));
  return { index, id: c.id, anchorKind: c.anchorKind, anchor, candidateCount: shuffled.length, candidates: shuffled };
});

fs.writeFileSync(path.join(fixture, 'r1-candidates-blind.ndjson'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
const total = rows.reduce((s, r) => s + r.candidateCount, 0);
console.log(JSON.stringify({ queries: rows.length, candidatesTotal: total, perQuery: { min: Math.min(...rows.map((r) => r.candidateCount)), max: Math.max(...rows.map((r) => r.candidateCount)) }, byKind: rows.reduce((m, r) => { m[r.anchorKind] = (m[r.anchorKind] ?? 0) + r.candidateCount; return m; }, {}) }));
