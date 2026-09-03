#!/usr/bin/env node
/**
 * r2-referents.mjs — REFERENT EXTRACTOR over retained `totem spec` drafts.
 *
 * Mechanical evidence only. No verdicts. Reads the resident repo read-only
 * (git plumbing + artifact JSON); writes only into --out.
 *
 * Usage:
 *   node r2-referents.mjs --resident D:/Dev/totem --out <fixture dir> [--limit N]
 */

import { execFile } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------- args ----

function parseArgs(argv) {
  const out = { resident: null, out: null, limit: null, literalPathRegex: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--resident') out.resident = argv[++i];
    else if (a === '--out') out.out = argv[++i];
    else if (a === '--limit') out.limit = Number(argv[++i]);
    else if (a === '--literal-path-regex') out.literalPathRegex = true;
    else throw new Error(`unknown arg: ${a}`);
  }
  if (!out.resident || !out.out) throw new Error('--resident and --out are required');
  return out;
}

const ARGS = parseArgs(process.argv.slice(2));
const RESIDENT = ARGS.resident;
const OUTDIR = ARGS.out;
const HEAD = '8d5e2691';

const GREP_PATHSPECS_IDENT = [
  'packages',
  'docs',
  'AGENTS.md',
  '.totem/lessons',
  '.totem/lessons.md',
  'tools',
];
const GREP_PATHSPECS_FLAG = ['packages', 'docs'];

// ------------------------------------------------------------ stoplist ----

// Given verbatim in the dispatch (the "…" tail expanded with ubiquitous
// JS/TS globals and type helpers that survive the lowercase heuristic).
const STOPLIST_SPEC = [
  'function', 'export', 'import', 'string', 'number', 'boolean', 'undefined',
  'Promise', 'Record', 'Error', 'describe', 'expect', 'process', 'return',
  'interface', 'extends', 'default', 'object', 'module', 'require', 'console',
  'length', 'readonly', 'private', 'public', 'static', 'async', 'await',
  'typeof', 'instanceof', 'constructor', 'options', 'config', 'result',
  'results', 'params', 'message', 'timeout', 'version', 'README', 'AGENTS',
  'CLAUDE', 'totem', 'Totem', 'GitHub', 'Windows', 'Node',
];
const STOPLIST_ADDED = [
  'unknown', 'namespace', 'implements', 'abstract', 'declare', 'protected',
  'package', 'continue', 'finally', 'globalThis', '__dirname', '__filename',
  'Object', 'String', 'Number', 'Boolean', 'Symbol', 'Function', 'Partial',
  'Required', 'RegExp', 'Buffer', 'Uint8Array',
];
const STOPLIST = [...STOPLIST_SPEC, ...STOPLIST_ADDED];
const STOP = new Set(STOPLIST.map((s) => s.toLowerCase())); // matched case-insensitively

// ------------------------------------------------------------- regexes ----

// The dispatch's verbatim path regex. Its alternation is ordered shortest-first,
// so `foo.json` matches as `foo.js` and `foo.tsx` as `foo.ts` — a truncation that
// manufactures false "missing" referents. Kept for reproduction behind
// --literal-path-regex; the default is the same extension set, longest-first,
// with a trailing boundary so the extension is captured whole.
const RE_PATH_LITERAL =
  /(?:[A-Za-z0-9_.@-]+\/)+[A-Za-z0-9_.@-]+\.(?:ts|tsx|js|mjs|cjs|mts|md|json|yaml|yml|sh|toml|py|go|rs)/g;
const RE_PATH_FIXED =
  /(?:[A-Za-z0-9_.@-]+\/)+[A-Za-z0-9_.@-]+\.(?:tsx|mts|mjs|cjs|json|yaml|toml|yml|ts|js|md|sh|py|go|rs)(?![A-Za-z0-9])/g;
const RE_PATH = ARGS.literalPathRegex ? RE_PATH_LITERAL : RE_PATH_FIXED;
const RE_BAREFILE = /`([A-Za-z0-9_.-]+\.(?:ts|tsx|js|mjs|md|json|yaml|yml|sh|toml))`/g;
const RE_IDENT = /`([A-Za-z_$][A-Za-z0-9_$]{5,})(?:\(\))?`/g;
const RE_FLAG = /--[a-z][a-z0-9-]{2,}/g;
const RE_ISSUE = /#\d+/g;
const RE_PROPOSE =
  /\b(create|add|new|introduce|will|should|propose|extract|implement|rename|move|split|define|write)\b/i;

// Drop all-lowercase short dictionary-ish words: lowercase, no digit/underscore, <= 8 chars.
function isLowercaseDictionaryish(tok) {
  return /^[a-z]+$/.test(tok) && tok.length <= 8;
}

// ------------------------------------------------------------ git seam ----

function git(args, { allowExit1 = false } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', RESIDENT, ...args],
      { maxBuffer: 128 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          if (allowExit1 && err.code === 1) return resolve('');
          return reject(new Error(`git ${args.join(' ')} failed (${err.code}): ${stderr}`));
        }
        resolve(stdout);
      },
    );
  });
}

async function pool(items, concurrency, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// ------------------------------------------------------------- caches -----

const treeCache = new Map(); // commit -> { exact:Set, byBase:Map<base, string[]>, bases:Set }
const grepCache = new Map(); // `${commit}\u0000${kind}\u0000${needle}` -> string[] hit paths
const commitCache = new Map(); // createdAt -> commit sha | null

async function getTree(commit) {
  if (treeCache.has(commit)) return treeCache.get(commit);
  const raw = await git(['ls-tree', '-r', '--name-only', commit]);
  const exact = new Set();
  const byBase = new Map();
  const bases = new Set();
  for (const line of raw.split('\n')) {
    const p = line.trim();
    if (!p) continue;
    exact.add(p);
    const b = p.slice(p.lastIndexOf('/') + 1);
    bases.add(b);
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(p);
  }
  const t = { exact, byBase, bases };
  treeCache.set(commit, t);
  return t;
}

async function resolveCommit(createdAt) {
  if (commitCache.has(createdAt)) return commitCache.get(createdAt);
  let sha = null;
  try {
    sha = (await git(['rev-list', '-1', `--before=${createdAt}`, 'main'])).trim() || null;
  } catch {
    sha = null;
  }
  commitCache.set(createdAt, sha);
  return sha;
}

async function grepHits(commit, needle, pathspecs, kind) {
  const key = `${commit}\u0000${kind}\u0000${needle}`;
  if (grepCache.has(key)) return grepCache.get(key);
  let hits = [];
  try {
    const raw = await git(['grep', '-l', '-F', '-e', needle, commit, '--', ...pathspecs], {
      allowExit1: true,
    });
    hits = raw
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => (l.startsWith(`${commit}:`) ? l.slice(commit.length + 1) : l));
  } catch {
    hits = [];
  }
  grepCache.set(key, hits);
  return hits;
}

// ---------------------------------------------------------- extraction ----

function normWs(s) {
  return s.replace(/\s+/g, ' ').trim();
}

function contextAt(text, idx, len) {
  return normWs(text.slice(Math.max(0, idx - 80), Math.min(text.length, idx + len + 80)));
}

// Sentence = maximal span free of '.' / newline that contains the occurrence's
// START index (a referent may itself contain a '.', which truncates forward).
function sentenceAt(text, idx) {
  let s = idx;
  while (s > 0 && text[s - 1] !== '.' && text[s - 1] !== '\n') s -= 1;
  let e = idx;
  while (e < text.length && text[e] !== '.' && text[e] !== '\n') e += 1;
  return text.slice(s, e);
}

/** Collect deduped referents with per-occurrence proposed-context evidence. */
function collect(text, re, group) {
  const map = new Map();
  for (const m of text.matchAll(re)) {
    const ref = group === 0 ? m[0] : m[group];
    if (!ref) continue;
    const idx = group === 0 ? m.index : m.index + m[0].indexOf(ref);
    const proposed = RE_PROPOSE.test(sentenceAt(text, idx));
    let rec = map.get(ref);
    if (!rec) {
      rec = {
        ref,
        occurrences: 0,
        proposedOccurrences: 0,
        context: contextAt(text, idx, ref.length),
        contextNotProposed: null,
      };
      map.set(ref, rec);
    }
    rec.occurrences += 1;
    if (proposed) rec.proposedOccurrences += 1;
    else if (rec.contextNotProposed === null) rec.contextNotProposed = contextAt(text, idx, ref.length);
  }
  // proposedContext = true when ANY occurrence sits in a proposing sentence
  // (conservative: fewer refs flagged as bare claims).
  for (const rec of map.values()) rec.proposedContext = rec.proposedOccurrences > 0;
  return [...map.values()];
}

function extract(text) {
  const paths = collect(text, RE_PATH, 0);
  const bareFiles = collect(text, RE_BAREFILE, 1);
  const identsRaw = collect(text, RE_IDENT, 1);
  const identifiers = identsRaw.filter(
    (r) => !STOP.has(r.ref.toLowerCase()) && !isLowercaseDictionaryish(r.ref),
  );
  const flags = collect(text, RE_FLAG, 0);
  const issueRefCount = (text.match(RE_ISSUE) || []).length;
  return {
    paths,
    bareFiles,
    identifiers,
    flags,
    issueRefCount,
    identsDroppedByStoplist: identsRaw.length - identifiers.length,
  };
}

// ---------------------------------------------------------- resolution ----

function normPath(p) {
  return p.replace(/^\.\//, '');
}

function pathExists(tree, ref) {
  const p = normPath(ref);
  if (tree.exact.has(p)) return { exact: true, bySuffix: false };
  const base = p.slice(p.lastIndexOf('/') + 1);
  const cands = tree.byBase.get(base) || [];
  const bySuffix = cands.some((full) => full.endsWith(`/${p}`));
  return { exact: false, bySuffix };
}

// -------------------------------------------------------------- main -----

async function main() {
  const t0 = Date.now();
  const runsDir = path.join(RESIDENT, '.totem', 'artifacts', 'runs');
  const files = readdirSync(runsDir).filter((f) => f.endsWith('.json'));

  const artifacts = [];
  for (const f of files) {
    let j;
    try {
      j = JSON.parse(readFileSync(path.join(runsDir, f), 'utf8'));
    } catch (e) {
      process.stderr.write(`ANOMALY unparseable-artifact ${f}: ${e.message}\n`);
      continue;
    }
    if (j?.admission?.runMetadata?.caller !== 'spec') continue;
    const mp = j?.inputBundle?.maskedPrompt || '';
    const anchorKind = /=== ISSUE #\d+:/.test(mp)
      ? 'issue'
      : /=== TOPIC ===/.test(mp)
        ? 'topic'
        : 'unknown';
    artifacts.push({
      artifactId: f.replace(/\.json$/, ''),
      anchorKind,
      createdAt: j.createdAt,
      content: typeof j?.output?.content === 'string' ? j.output.content : '',
    });
  }
  artifacts.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  const selected = ARGS.limit ? artifacts.slice(0, ARGS.limit) : artifacts;
  process.stderr.write(`spec artifacts: ${artifacts.length}; processing ${selected.length}\n`);

  const anomalies = [];
  await getTree(HEAD);

  const rows = [];
  for (const art of selected) {
    const ex = extract(art.content);
    const commit = await resolveCommit(art.createdAt);
    if (!commit) anomalies.push(`${art.artifactId.slice(0, 8)}: commit resolution FAILED for ${art.createdAt}`);
    if (art.content.length <= 1)
      anomalies.push(`${art.artifactId.slice(0, 8)}: output.content length ${art.content.length}`);

    const runTree = commit ? await getTree(commit) : null;
    const headTree = treeCache.get(HEAD);

    // paths
    for (const r of ex.paths) {
      const atRun = runTree ? pathExists(runTree, r.ref) : { exact: false, bySuffix: false };
      const atHead = pathExists(headTree, r.ref);
      r.existsAtRun = atRun.exact;
      r.existsAtRunBySuffix = atRun.bySuffix;
      r.existsAtHead = atHead.exact || atHead.bySuffix;
      r.existsAtHeadExact = atHead.exact;
    }
    // bareFiles
    for (const r of ex.bareFiles) {
      r.existsAtRunByBasename = runTree ? runTree.bases.has(r.ref) : false;
      r.existsAtHeadByBasename = headTree.bases.has(r.ref);
    }

    // identifiers + flags via pooled greps
    const jobs = [];
    for (const r of ex.identifiers) {
      jobs.push({ r, kind: 'ident', specs: GREP_PATHSPECS_IDENT });
    }
    for (const r of ex.flags) {
      jobs.push({ r, kind: 'flag', specs: GREP_PATHSPECS_FLAG });
    }
    await pool(jobs, 4, async (job) => {
      const runHits = commit ? await grepHits(commit, job.r.ref, job.specs, job.kind) : [];
      const headHits = await grepHits(HEAD, job.r.ref, job.specs, job.kind);
      job.r.foundAtRun = runHits.length > 0;
      job.r.foundAtHead = headHits.length > 0;
      job.r.hitFiles = runHits.slice(0, 3);
      job.r.hitFilesAtHead = headHits.slice(0, 3);
    });

    const pathMissing = (r) => !r.existsAtRun && !r.existsAtRunBySuffix;
    const identMissing = (r) => !r.foundAtRun;
    const flagMissing = (r) => !r.foundAtRun;
    const bareMissing = (r) => !r.existsAtRunByBasename;

    const counts = {
      pathsNamed: ex.paths.length,
      pathsMissingAtRun: ex.paths.filter(pathMissing).length,
      pathsMissingAtRunNotProposed: ex.paths.filter((r) => pathMissing(r) && !r.proposedContext).length,
      identsNamed: ex.identifiers.length,
      identsMissingAtRun: ex.identifiers.filter(identMissing).length,
      identsMissingAtRunNotProposed: ex.identifiers.filter((r) => identMissing(r) && !r.proposedContext)
        .length,
      flagsNamed: ex.flags.length,
      flagsMissingAtRun: ex.flags.filter(flagMissing).length,
      flagsMissingAtRunNotProposed: ex.flags.filter((r) => flagMissing(r) && !r.proposedContext).length,
      bareFilesNamed: ex.bareFiles.length,
      bareFilesMissingAtRun: ex.bareFiles.filter(bareMissing).length,
      bareFilesMissingAtRunNotProposed: ex.bareFiles.filter((r) => bareMissing(r) && !r.proposedContext)
        .length,
      identsDroppedByStoplist: ex.identsDroppedByStoplist,
    };

    const missingNotProposed = [
      ...ex.paths.filter((r) => pathMissing(r) && !r.proposedContext).map((r) => ({ kind: 'path', ref: r.ref })),
      ...ex.identifiers
        .filter((r) => identMissing(r) && !r.proposedContext)
        .map((r) => ({ kind: 'ident', ref: r.ref })),
      ...ex.flags.filter((r) => flagMissing(r) && !r.proposedContext).map((r) => ({ kind: 'flag', ref: r.ref })),
    ].slice(0, 15);

    rows.push({
      artifactId: art.artifactId,
      anchorKind: art.anchorKind,
      createdAt: art.createdAt,
      commitAtRun: commit,
      commitAtRunIsApprox: true,
      outputLength: art.content.length,
      paths: ex.paths,
      bareFiles: ex.bareFiles,
      identifiers: ex.identifiers,
      flags: ex.flags,
      issueRefCount: ex.issueRefCount,
      counts,
      missingNotProposed,
    });
    process.stderr.write(
      `. ${art.artifactId.slice(0, 8)} ${art.anchorKind} p=${counts.pathsNamed}/${counts.pathsMissingAtRunNotProposed} i=${counts.identsNamed}/${counts.identsMissingAtRunNotProposed} f=${counts.flagsNamed}/${counts.flagsMissingAtRunNotProposed}\n`,
    );
  }

  // ------------------------------------------------------------- write ----
  mkdirSync(OUTDIR, { recursive: true });
  const sfx = ARGS.literalPathRegex ? '.literal' : '';
  const ndjsonPath = path.join(OUTDIR, `r2-referents${sfx}.ndjson`);
  writeFileSync(ndjsonPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

  const ratio = (r) => {
    const named = r.counts.pathsNamed + r.counts.identsNamed + r.counts.flagsNamed;
    const miss =
      r.counts.pathsMissingAtRunNotProposed +
      r.counts.identsMissingAtRunNotProposed +
      r.counts.flagsMissingAtRunNotProposed;
    return named === 0 ? null : miss / named;
  };
  const sorted = [...rows].sort((a, b) => (ratio(b) ?? -1) - (ratio(a) ?? -1));

  const freq = new Map(); // `${kind}\u0000${ref}` -> Set(artifactId)
  for (const r of rows) {
    const seen = new Set();
    const all = [
      ...r.paths.filter((x) => !x.existsAtRun && !x.existsAtRunBySuffix && !x.proposedContext).map((x) => ['path', x.ref]),
      ...r.identifiers.filter((x) => !x.foundAtRun && !x.proposedContext).map((x) => ['ident', x.ref]),
      ...r.flags.filter((x) => !x.foundAtRun && !x.proposedContext).map((x) => ['flag', x.ref]),
    ];
    for (const [kind, ref] of all) {
      const k = `${kind}\u0000${ref}`;
      if (seen.has(k)) continue;
      seen.add(k);
      if (!freq.has(k)) freq.set(k, new Set());
      freq.get(k).add(r.artifactId);
    }
  }
  const top = [...freq.entries()]
    .map(([k, set]) => {
      const [kind, ref] = k.split('\u0000');
      return { kind, ref, artifacts: set.size };
    })
    .sort((a, b) => b.artifacts - a.artifacts || a.ref.localeCompare(b.ref))
    .slice(0, 25);

  const rerun = `node "${path.join(OUTDIR, 'scripts', 'r2-referents.mjs').replace(/\\/g, '/')}" --resident "${RESIDENT}" --out "${OUTDIR}"`;

  const L = [];
  L.push('# r2 referent extraction — `totem spec` drafts');
  L.push('');
  L.push(
    `Mechanical evidence only, no verdicts. Artifacts: ${rows.length} (caller=\`spec\`). Resident: \`${RESIDENT}\` (read-only). HEAD referent: \`${HEAD}\`.`,
  );
  L.push('');
  L.push(
    '`commitAtRun` = `git rev-list -1 --before=<createdAt> main` — **approximate**: the artifact records no commit, and a run may have been made on a branch.',
  );
  L.push(
    '`proposedContext` is true when **any** occurrence of the referent sits in a sentence matching `/\\b(create|add|new|introduce|will|should|propose|extract|implement|rename|move|split|define|write)\\b/i` (sentence = span free of `.`/newline containing the occurrence start).',
  );
  L.push(
    'Path "missing" = neither exact nor suffix match in the run tree. Ident/flag "missing" = `git grep -l -F` at the run commit returned nothing.',
  );
  L.push('');
  L.push(
    ARGS.literalPathRegex
      ? '**Path regex: the dispatch\'s verbatim alternation** (`--literal-path-regex`). Its ordering is shortest-first, so `foo.json` is captured as `foo.js` and `foo.tsx` as `foo.ts`; those truncated referents cannot exist in any tree and inflate every "missing" path count.'
      : '**Path regex: extension set as dispatched, alternation reordered longest-first with a trailing `(?![A-Za-z0-9])` boundary.** The dispatch\'s verbatim ordering captured `foo.json` as `foo.js` and `foo.tsx` as `foo.ts`, manufacturing missing referents; re-run with `--literal-path-regex` to reproduce that behaviour into `*.literal.*` files.',
  );
  L.push('');
  L.push(
    `Resolution scope (as dispatched): identifiers are grepped under \`${GREP_PATHSPECS_IDENT.join(' ')}\`, flags under \`${GREP_PATHSPECS_FLAG.join(' ')}\`. A referent that belongs to an external tool (a \`git\`/\`node\`/\`pnpm\` flag, a platform token) therefore reads as missing.`,
  );
  L.push('');
  L.push('## Per-artifact counts');
  L.push('');
  L.push(
    '| id | anchor | bytes | paths named | p miss | p miss-notprop | idents named | i miss | i miss-notprop | flags named | f miss | f miss-notprop | issue refs | ratio |',
  );
  L.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const r of sorted) {
    const c = r.counts;
    const ra = ratio(r);
    L.push(
      `| ${r.artifactId.slice(0, 8)} | ${r.anchorKind} | ${r.outputLength} | ${c.pathsNamed} | ${c.pathsMissingAtRun} | ${c.pathsMissingAtRunNotProposed} | ${c.identsNamed} | ${c.identsMissingAtRun} | ${c.identsMissingAtRunNotProposed} | ${c.flagsNamed} | ${c.flagsMissingAtRun} | ${c.flagsMissingAtRunNotProposed} | ${r.issueRefCount} | ${ra === null ? 'n/a' : ra.toFixed(3)} |`,
    );
  }
  const tot = rows.reduce(
    (a, r) => {
      for (const k of Object.keys(r.counts)) a[k] = (a[k] || 0) + r.counts[k];
      a.issueRefCount += r.issueRefCount;
      return a;
    },
    { issueRefCount: 0 },
  );
  L.push('');
  L.push(
    `Totals: paths named ${tot.pathsNamed}, missing ${tot.pathsMissingAtRun}, missing-not-proposed ${tot.pathsMissingAtRunNotProposed}; idents named ${tot.identsNamed}, missing ${tot.identsMissingAtRun}, missing-not-proposed ${tot.identsMissingAtRunNotProposed}; flags named ${tot.flagsNamed}, missing ${tot.flagsMissingAtRun}, missing-not-proposed ${tot.flagsMissingAtRunNotProposed}; issue refs ${tot.issueRefCount}.`,
  );
  L.push('');
  L.push(
    `Backticked bare filenames (resolved by basename, excluded from the ratio): named ${tot.bareFilesNamed}, missing at run ${tot.bareFilesMissingAtRun}, missing-not-proposed ${tot.bareFilesMissingAtRunNotProposed}. Backticked identifier candidates dropped by the stoplist/heuristic: ${tot.identsDroppedByStoplist}.`,
  );
  L.push('');
  L.push('## 25 most frequent missing-not-proposed referents');
  L.push('');
  L.push('| kind | referent | artifacts naming it |');
  L.push('| --- | --- | ---: |');
  for (const t of top) L.push(`| ${t.kind} | \`${t.ref}\` | ${t.artifacts} |`);
  L.push('');
  L.push('## Stoplist');
  L.push('');
  L.push('Matched case-insensitively against the backticked identifier token.');
  L.push('');
  L.push(`Dispatch-given: ${STOPLIST_SPEC.map((s) => `\`${s}\``).join(', ')}`);
  L.push('');
  L.push(`Added (expansion of the dispatch\'s "…"): ${STOPLIST_ADDED.map((s) => `\`${s}\``).join(', ')}`);
  L.push('');
  L.push(
    'Plus a heuristic drop: all-lowercase tokens with no digit/underscore and length \u2264 8 (dictionary words).',
  );
  L.push('');
  L.push('## Anomalies');
  L.push('');
  if (anomalies.length === 0) L.push('None.');
  else for (const a of anomalies) L.push(`- ${a}`);
  L.push('');
  L.push('## Re-run');
  L.push('');
  L.push('```');
  L.push(rerun);
  L.push('```');
  L.push('');
  L.push(`Wall time: ${((Date.now() - t0) / 1000).toFixed(1)}s. Node ${process.version}.`);
  L.push('');

  const mdPath = path.join(OUTDIR, `r2-referents-summary${sfx}.md`);
  writeFileSync(mdPath, L.join('\n'), 'utf8');

  process.stderr.write(`\nwrote ${ndjsonPath}\nwrote ${mdPath}\n`);
  process.stderr.write(`anomalies: ${anomalies.length}\n`);
  for (const a of anomalies) process.stderr.write(`  - ${a}\n`);
  process.stderr.write(`wall ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
}

main().catch((e) => {
  process.stderr.write(`FATAL: ${e.stack || e.message}\n`);
  process.exit(1);
});
