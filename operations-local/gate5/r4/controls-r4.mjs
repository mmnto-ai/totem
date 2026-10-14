#!/usr/bin/env node
// Gate (5) — the R4 severity-lowering controls for the migration harness
// (mmnto-ai/totem#3044; the lift ruling's Q1 (a′) on mmnto-ai/totem-strategy#1486,
// the addendum's mechanism (ii)). The harness's fidelity leg admits ONE new expected
// divergence — a record severity LOWER than its legacy row's, declared as inventory
// item `iv`, on a rule named in `R4_SEVERITY_LOWERING_RULES` — and this script
// measures that admission and every refusal around it by spawning the harness over
// fixtures DERIVED under `--scratch` from the pin's own records and manifest (a
// derived fixture asserts its one-line delta, the K5b pattern), never from copies
// committed here. The committed artifacts are this script and `r4-controls-run.log`.
//
// Arms (each records its invocation, exit, the measured lines and PASS/FAIL):
//   A1  the admitted lowering: both named records at `warning` with `iv` declared
//       → exit 0, every row `expectedDivergence` = the string, `unexpected` empty
//   A2  the same records, `iv` NOT declared → exit 1, `unexpected` = ['severity']
//   A3  `iv` declared on a hash the ruling did not name → exit 2 before any record
//   A4  a raise under a declaration (synthetic manifest row at legacy `warning`, the
//       pin's record at `error`) → exit 1, `unexpected` = ['severity']
//   A5  the pin's records unmodified with `iv` declared → exit 0, identical, and the
//       inert-declaration note printed once per record
//   A6  `iv` under `--r14` (the K3 regression) → exit 2
//   A7  `iv` beside `ii` → exit 2
//   A8  the two existing runs reproduce their recorded fidelity lines unchanged:
//       K3 over the R14 22 at the record pin, and batch 1's `--set` run
//   A9  every A1/A5 row's `declaredInventory` is inside the updated schema's enum, and
//       a row carrying `iv` is OUTSIDE the enum of the schema at the base commit
//
// Usage:
//   node operations-local/gate5/r4/controls-r4.mjs --scratch <dir> \
//     --seed <strategy operations/310-r14-audit/seed-20.json> \
//     --corpus <strategy operations/310-r14-audit/inputs/compiled-rules.json> \
//     [--core <@mmnto/totem package dir>] [--r14-pin <sha>] [--base <sha>] [--out <log>]
//
// The R14 records for A6 and A8 are read from `--r14-pin` (default 78e7f196, the E26
// cure record pin K3 is recorded at) with `git show`, so no second worktree is needed.
// `--base` (default b1792d5a, the commit this change branches from) is where the OLD
// schema is read for A9. Nothing is written outside `--scratch` and `--out`.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE5 = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(GATE5, '..', '..');
const HARNESS = path.join(GATE5, 'mig-harness.mjs');
const SCHEMA = path.join(GATE5, 'harness-record.schema.json');
const MANIFEST = path.join(GATE5, 'manifest-2263305c.json');
const BATCH1_INVENTORY = path.join(GATE5, 'batch-1', 'mig-inventory.json');
const BATCH1_LOG = path.join(GATE5, 'batch-1', 'harness-run.log');
const K3_INVENTORY = path.join(GATE5, 'k3', 'k3-r14-inventory.json');
const K3_LOG = path.join(GATE5, 'k3', 'k3-run.log');
const RULES_DIR = path.join(REPO_ROOT, '.totem', 'rules');

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const die = (msg) => {
  console.error(`[Totem Error] controls-r4: ${msg}`);
  process.exit(2);
};
const SCRATCH = opt('--scratch') ? path.resolve(opt('--scratch')) : undefined;
if (SCRATCH === undefined) die('pass --scratch <dir> (every derived fixture is written there)');
const SEED = opt('--seed') ? path.resolve(opt('--seed')) : undefined;
const CORPUS = opt('--corpus') ? path.resolve(opt('--corpus')) : undefined;
if (SEED === undefined || CORPUS === undefined)
  die(
    'pass --seed <seed-20.json> and --corpus <compiled-rules.json> (the R14 inputs A6 and A8 read)',
  );
const CORE = path.resolve(opt('--core') ?? path.join(REPO_ROOT, 'packages', 'core'));
const R14_PIN = opt('--r14-pin') ?? '78e7f196';
const BASE = opt('--base') ?? 'b1792d5a';
const OUT = path.resolve(opt('--out') ?? path.join(HERE, 'r4-controls-run.log'));
for (const p of [
  HARNESS,
  SCHEMA,
  MANIFEST,
  BATCH1_INVENTORY,
  BATCH1_LOG,
  K3_INVENTORY,
  K3_LOG,
  SEED,
  CORPUS,
])
  if (!existsSync(p)) die(`missing input ${p}`);
mkdirSync(SCRATCH, { recursive: true });

/** The string the harness writes and the scorer's `typeC5Fidelity` must admit (the contract). */
const R4_STRING = 'severity (inventory iv: lowered under R4)';

// ── helpers ──────────────────────────────────────────────────────────────────
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`, 'utf8');
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const git = (args) =>
  execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sub = (name) => {
  const d = path.join(SCRATCH, name);
  mkdirSync(d, { recursive: true });
  return d;
};

/** Spawn the harness; never throws on a non-zero exit (the exit IS the measurement). */
function runHarness(args) {
  const r = spawnSync(process.execPath, [HARNESS, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) die(`spawning the harness failed: ${r.error.message}`);
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const rowsOf = (outPath) =>
  existsSync(outPath)
    ? readFileSync(outPath, 'utf8')
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l))
    : [];
const fidelityLines = (text) =>
  text.split(/\r?\n/).filter((l) => /^Fidelity \((records|entries)\):/.test(l));

/**
 * The allow-list, read from the harness SOURCE by the same deterministic parse the
 * scorer's parity control makes (a named export whose value is one array literal of
 * plain string hashes) — never by importing the script, which would run it.
 */
function allowListFromSource() {
  const src = readFileSync(HARNESS, 'utf8');
  const m = /export const R4_SEVERITY_LOWERING_RULES = \[([^\]]*)\];/.exec(src);
  if (m === null)
    die('the harness source carries no `export const R4_SEVERITY_LOWERING_RULES = [...]` literal');
  const items = [...m[1].matchAll(/'([0-9a-f]{16})'/g)].map((x) => x[1]);
  if (items.length === 0) die('the allow-list literal holds no 16-hex hash');
  return items;
}

/** A copy of one pin record with exactly its top-level `severity: error` line lowered to `warning`. */
function lowerRecordCopy(srcName, dstDir) {
  const src = readFileSync(path.join(RULES_DIR, srcName), 'utf8');
  const lines = src.split('\n');
  const hits = lines.map((l, i) => (l === 'severity: error' ? i : -1)).filter((i) => i >= 0);
  if (hits.length !== 1)
    die(`${srcName}: expected exactly one top-level 'severity: error' line, found ${hits.length}`);
  const out = [...lines];
  out[hits[0]] = 'severity: warning';
  const delta = out.filter((l, i) => l !== lines[i]).length;
  if (delta !== 1) die(`${srcName}: the derived copy differs on ${delta} lines, not one`);
  const dst = path.join(dstDir, srcName);
  writeFileSync(dst, out.join('\n'), 'utf8');
  return { dst, sha256: sha256(readFileSync(dst)), changedLine: hits[0] + 1 };
}
const recordFor = (hash8) => {
  const names = execFileSync('git', ['ls-files', '.totem/rules'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => path.basename(l))
    .filter((n) => new RegExp(`(^|-)${hash8}(-|\\.)`).test(n));
  if (names.length !== 1)
    die(`${hash8}: expected one tracked record, found ${names.length} (${names.join(', ')})`);
  return names[0];
};
/** An inventory with the batch-1 entry for each hash (or an empty one), the listed items set. */
function inventoryFor(entries, control) {
  const base = readJson(BATCH1_INVENTORY);
  const inv = {
    _schema: 'gate5-declared-inventory/1',
    _control: `R4 control ${control} — never a run inventory`,
  };
  for (const [hash, items] of Object.entries(entries)) {
    const row = base[hash] ?? {
      records: 1,
      expect: { validate: 'compiled', differential: 'differential-satisfied' },
    };
    inv[hash] = { ...row, inventory: items };
  }
  return inv;
}
/** The R14 records at the pin, materialised with `git show` (no second worktree). */
function r14RecordsDir() {
  const dir = sub('r14-rules');
  const listing = git(['ls-tree', '--name-only', R14_PIN, '.totem/rules/']);
  const files = listing
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.endsWith('.rule.yaml'));
  if (files.length === 0) die(`no records under .totem/rules at ${R14_PIN}`);
  for (const f of files)
    writeFileSync(path.join(dir, path.basename(f)), git(['show', `${R14_PIN}:${f}`]), 'utf8');
  return { dir, count: files.length };
}

// ── the arms ─────────────────────────────────────────────────────────────────
const log = [];
const say = (line) => {
  log.push(line);
  console.log(line);
};
const results = [];
function arm(name, body) {
  say(`\n── ${name} ──`);
  const checks = [];
  const expect = (label, ok, measured) => {
    checks.push({ label, ok, measured });
    say(
      `  ${ok ? 'ok  ' : 'FAIL'} ${label}${measured === undefined ? '' : ` — measured: ${measured}`}`,
    );
  };
  try {
    body(expect);
  } catch (err) {
    checks.push({
      label: 'arm threw',
      ok: false,
      measured: err instanceof Error ? err.message : String(err),
    });
    say(`  FAIL arm threw — ${err instanceof Error ? err.message : String(err)}`);
  }
  const pass = checks.length > 0 && checks.every((c) => c.ok);
  results.push({ name, pass, checks });
  say(`  ${name}: ${pass ? 'PASS' : 'FAIL'}`);
}
const invoke = (args) => {
  say(`  invocation: node operations-local/gate5/mig-harness.mjs ${args.join(' ')}`);
  const r = runHarness(args);
  say(`  exit: ${r.status}`);
  return r;
};

say(`controls-r4 — ${new Date().toISOString()}`);
say(`  repo root ${REPO_ROOT}`);
say(`  harness   ${path.relative(REPO_ROOT, HARNESS)} (sha256 ${sha256(readFileSync(HARNESS))})`);
say(`  schema    ${path.relative(REPO_ROOT, SCHEMA)} (sha256 ${sha256(readFileSync(SCHEMA))})`);
say(`  core      ${CORE}`);
say(`  scratch   ${SCRATCH}`);
say(`  r14 pin   ${R14_PIN} · base ${BASE}`);

const ALLOW = allowListFromSource();
say(`  allow-list (parsed from the harness source): ${ALLOW.join(', ')}`);
arm('A0 the allow-list is the ruling’s pair', (expect) => {
  expect('two hashes', ALLOW.length === 2, String(ALLOW.length));
  expect('2266fc0dfe824f24 listed', ALLOW.includes('2266fc0dfe824f24'));
  expect('87aff037d7de47a7 listed', ALLOW.includes('87aff037d7de47a7'));
});
const LISTED = ALLOW.map((h) => ({
  hash: h,
  hash8: h.slice(0, 8),
  record: recordFor(h.slice(0, 8)),
}));
const manifest = readJson(MANIFEST);
const byHash = new Map(manifest.rules.map((r) => [r.lessonHash, r]));
for (const l of LISTED)
  if (byHash.get(l.hash)?.legacy?.severity !== 'error')
    die(`${l.hash}: the manifest's legacy severity is not 'error'`);

// A1 — the admitted lowering.
const loweredDir = sub('rules-lowered');
const lowered = LISTED.map((l) => ({ ...l, ...lowerRecordCopy(l.record, loweredDir) }));
for (const l of lowered)
  say(
    `  derived ${path.relative(SCRATCH, l.dst)} — line ${l.changedLine} 'severity: error' → 'severity: warning' (sha256 ${l.sha256})`,
  );
const onlyListed = LISTED.map((l) => l.hash8).join(',');
arm('A1 the admitted lowering (iv declared, listed rules, warning against error)', (expect) => {
  const inv = path.join(sub('inv'), 'a1.json');
  writeJson(inv, inventoryFor(Object.fromEntries(LISTED.map((l) => [l.hash, ['i', 'iv']])), 'A1'));
  const out = path.join(sub('out'), 'a1.jsonl');
  const r = invoke([
    '--set',
    MANIFEST,
    '--only',
    onlyListed,
    '--inventory',
    inv,
    '--rules',
    loweredDir,
    '--core',
    CORE,
    '--out',
    out,
  ]);
  expect('exit 0', r.status === 0, String(r.status));
  const rows = rowsOf(out);
  expect('two rows', rows.length === 2, String(rows.length));
  for (const row of rows) {
    const f = row.fidelity;
    expect(
      `${row.lessonHash}: fidelity.severity false (measured, not masked)`,
      f?.severity === false,
      String(f?.severity),
    );
    expect(
      `${row.lessonHash}: expectedDivergence is the string`,
      f?.expectedDivergence === R4_STRING,
      JSON.stringify(f?.expectedDivergence),
    );
    expect(
      `${row.lessonHash}: unexpected empty`,
      Array.isArray(f?.unexpected) && f.unexpected.length === 0,
      JSON.stringify(f?.unexpected),
    );
    expect(
      `${row.lessonHash}: declaredInventory carries iv`,
      Array.isArray(f?.declaredInventory) && f.declaredInventory.includes('iv'),
      JSON.stringify(f?.declaredInventory),
    );
  }
  const fl = fidelityLines(r.stdout);
  expect(
    'records line',
    fl.includes('Fidelity (records): 0/2 identical, 2 expected divergence(s), 0 UNEXPECTED'),
    fl.join(' | '),
  );
});

// A2 — the same records, undeclared.
arm('A2 the lowering undeclared (iv absent)', (expect) => {
  const inv = path.join(sub('inv'), 'a2.json');
  writeJson(inv, inventoryFor(Object.fromEntries(LISTED.map((l) => [l.hash, ['i']])), 'A2'));
  const out = path.join(sub('out'), 'a2.jsonl');
  const r = invoke([
    '--set',
    MANIFEST,
    '--only',
    onlyListed,
    '--inventory',
    inv,
    '--rules',
    loweredDir,
    '--core',
    CORE,
    '--out',
    out,
  ]);
  expect('exit 1', r.status === 1, String(r.status));
  const rows = rowsOf(out);
  expect('two rows', rows.length === 2, String(rows.length));
  for (const row of rows) {
    expect(
      `${row.lessonHash}: unexpected = ['severity']`,
      deepEqual(row.fidelity?.unexpected, ['severity']),
      JSON.stringify(row.fidelity?.unexpected),
    );
    expect(
      `${row.lessonHash}: expectedDivergence null`,
      row.fidelity?.expectedDivergence === null,
      JSON.stringify(row.fidelity?.expectedDivergence),
    );
  }
  const fl = fidelityLines(r.stdout);
  expect(
    'records line',
    fl.includes('Fidelity (records): 0/2 identical, 0 expected divergence(s), 2 UNEXPECTED'),
    fl.join(' | '),
  );
});

// A3 — iv on a hash the ruling did not name.
arm('A3 iv declared on a hash outside the allow-list', (expect) => {
  const other = manifest.rules.find(
    (r) =>
      !ALLOW.includes(r.lessonHash) &&
      r.legacy?.severity === 'error' &&
      (() => {
        try {
          recordFor(r.lessonHash.slice(0, 8));
          return true;
        } catch {
          return false;
        }
      })(),
  );
  if (other === undefined)
    throw new Error('no non-listed error-severity rule with a tracked record in the manifest');
  say(`  non-listed rule: ${other.lessonHash} (${recordFor(other.lessonHash.slice(0, 8))})`);
  const dir = sub('rules-a3');
  const copy = lowerRecordCopy(recordFor(other.lessonHash.slice(0, 8)), dir);
  say(`  derived ${path.relative(SCRATCH, copy.dst)} — line ${copy.changedLine} lowered`);
  const inv = path.join(sub('inv'), 'a3.json');
  const base = readJson(BATCH1_INVENTORY)[other.lessonHash]?.inventory ?? [];
  writeJson(inv, inventoryFor({ [other.lessonHash]: [...base, 'iv'] }, 'A3'));
  const out = path.join(sub('out'), 'a3.jsonl');
  const r = invoke([
    '--set',
    MANIFEST,
    '--only',
    other.lessonHash.slice(0, 8),
    '--inventory',
    inv,
    '--rules',
    dir,
    '--core',
    CORE,
    '--out',
    out,
  ]);
  expect('exit 2', r.status === 2, String(r.status));
  expect(
    'stderr names the allow-list',
    /not in R4_SEVERITY_LOWERING_RULES/.test(r.stderr),
    r.stderr.trim().split('\n')[0],
  );
  expect('refused before any record was read (no Validate line)', !/^Validate:/m.test(r.stdout));
  expect('no rows written', rowsOf(out).length === 0, String(rowsOf(out).length));
});

// A4 — a raise under a declaration.
arm(
  'A4 a raise under a declaration (synthetic legacy warning, the pin record at error)',
  (expect) => {
    const target = LISTED[0];
    const row = JSON.parse(JSON.stringify(byHash.get(target.hash)));
    row.legacy.severity = 'warning';
    const synth = {
      ...manifest,
      _control:
        'R4 control A4 synthetic — the legacy row lowered to warning; never a manifest of the run',
      rules: [row],
    };
    const synthPath = path.join(sub('manifest'), 'a4-manifest.json');
    writeJson(synthPath, synth);
    const inv = path.join(sub('inv'), 'a4.json');
    writeJson(inv, inventoryFor({ [target.hash]: ['i', 'iv'] }, 'A4'));
    const out = path.join(sub('out'), 'a4.jsonl');
    const r = invoke([
      '--set',
      synthPath,
      '--inventory',
      inv,
      '--rules',
      RULES_DIR,
      '--core',
      CORE,
      '--out',
      out,
    ]);
    expect('exit 1', r.status === 1, String(r.status));
    const rows = rowsOf(out);
    expect('one row', rows.length === 1, String(rows.length));
    expect(
      "unexpected = ['severity']",
      deepEqual(rows[0]?.fidelity?.unexpected, ['severity']),
      JSON.stringify(rows[0]?.fidelity?.unexpected),
    );
    expect(
      'expectedDivergence null',
      rows[0]?.fidelity?.expectedDivergence === null,
      JSON.stringify(rows[0]?.fidelity?.expectedDivergence),
    );
  },
);

// A5 — equal severity under a declaration.
arm('A5 the pin records unmodified with iv declared (inert declaration)', (expect) => {
  const inv = path.join(sub('inv'), 'a5.json');
  writeJson(inv, inventoryFor(Object.fromEntries(LISTED.map((l) => [l.hash, ['i', 'iv']])), 'A5'));
  const out = path.join(sub('out'), 'a5.jsonl');
  const r = invoke([
    '--set',
    MANIFEST,
    '--only',
    onlyListed,
    '--inventory',
    inv,
    '--rules',
    RULES_DIR,
    '--core',
    CORE,
    '--out',
    out,
  ]);
  expect('exit 0', r.status === 0, String(r.status));
  const rows = rowsOf(out);
  expect('two rows', rows.length === 2, String(rows.length));
  for (const row of rows) {
    expect(
      `${row.lessonHash}: fidelity.severity true`,
      row.fidelity?.severity === true,
      String(row.fidelity?.severity),
    );
    expect(
      `${row.lessonHash}: expectedDivergence null`,
      row.fidelity?.expectedDivergence === null,
      JSON.stringify(row.fidelity?.expectedDivergence),
    );
    expect(
      `${row.lessonHash}: unexpected empty`,
      deepEqual(row.fidelity?.unexpected, []),
      JSON.stringify(row.fidelity?.unexpected),
    );
  }
  const notes = (
    r.stdout.match(
      /declares inventory iv \(severity lowered under R4\) but the record severity equals the legacy row/g,
    ) ?? []
  ).length;
  expect('the inert-declaration note printed once per record', notes === 2, String(notes));
  const fl = fidelityLines(r.stdout);
  expect(
    'records line',
    fl.includes('Fidelity (records): 2/2 identical, 0 expected divergence(s), 0 UNEXPECTED'),
    fl.join(' | '),
  );
});

// A6 — iv under --r14.
const r14 = r14RecordsDir();
say(
  `\n  R14 records at ${R14_PIN}: ${r14.count} file(s) materialised under ${path.relative(SCRATCH, r14.dir)}`,
);
arm('A6 iv under --r14 (the K3 regression mode)', (expect) => {
  const k3 = readJson(K3_INVENTORY);
  const inv = path.join(sub('inv'), 'a6.json');
  const target = '87aff037d7de47a7';
  writeJson(inv, {
    ...k3,
    _control: 'R4 control A6 — the K3 inventory plus iv; never a run inventory',
    [target]: { ...(k3[target] ?? {}), inventory: [...((k3[target] ?? {}).inventory ?? []), 'iv'] },
  });
  const r = invoke([
    '--seed',
    SEED,
    '--corpus',
    CORPUS,
    '--r14',
    '--inventory',
    inv,
    '--rules',
    r14.dir,
    '--core',
    CORE,
  ]);
  expect('exit 2', r.status === 2, String(r.status));
  expect(
    'stderr names the mode',
    /admissible only in the migration run/.test(r.stderr),
    r.stderr.trim().split('\n')[0],
  );
});

// A7 — iv beside ii.
arm('A7 iv beside ii', (expect) => {
  const inv = path.join(sub('inv'), 'a7.json');
  writeJson(inv, inventoryFor({ [LISTED[0].hash]: ['i', 'ii', 'iv'] }, 'A7'));
  const r = invoke([
    '--set',
    MANIFEST,
    '--only',
    LISTED[0].hash8,
    '--inventory',
    inv,
    '--rules',
    loweredDir,
    '--core',
    CORE,
  ]);
  expect('exit 2', r.status === 2, String(r.status));
  expect(
    'stderr names the pair',
    /declares iv beside ii/.test(r.stderr),
    r.stderr.trim().split('\n')[0],
  );
});

// A8 — the recorded runs reproduce.
arm('A8a the K3 regression reproduces its recorded fidelity lines', (expect) => {
  const recorded = fidelityLines(readFileSync(K3_LOG, 'utf8'));
  const r = invoke([
    '--seed',
    SEED,
    '--corpus',
    CORPUS,
    '--r14',
    '--inventory',
    K3_INVENTORY,
    '--rules',
    r14.dir,
    '--core',
    CORE,
  ]);
  expect('exit 0', r.status === 0, String(r.status));
  const measured = fidelityLines(r.stdout);
  expect(
    'fidelity lines equal the recorded ones',
    deepEqual(measured, recorded),
    `${measured.join(' | ')} vs recorded ${recorded.join(' | ')}`,
  );
  expect('K3 reproduced', /K3 reproduced/.test(r.stdout));
});
arm('A8b batch 1’s --set run reproduces its recorded fidelity lines', (expect) => {
  const recorded = fidelityLines(readFileSync(BATCH1_LOG, 'utf8'));
  const inv = readJson(BATCH1_INVENTORY);
  const only = Object.keys(inv)
    .filter((k) => !k.startsWith('_'))
    .map((k) => k.slice(0, 8))
    .join(',');
  const r = invoke([
    '--set',
    MANIFEST,
    '--only',
    only,
    '--inventory',
    BATCH1_INVENTORY,
    '--rules',
    RULES_DIR,
    '--core',
    CORE,
  ]);
  expect('exit 0', r.status === 0, String(r.status));
  const measured = fidelityLines(r.stdout);
  expect(
    'fidelity lines equal the recorded ones',
    deepEqual(measured, recorded),
    `${measured.join(' | ')} vs recorded ${recorded.join(' | ')}`,
  );
});

// A9 — the schema moved, and the move is load-bearing.
arm('A9 the schema enum admits iv now and refused it at the base commit', (expect) => {
  const enumOf = (schemaJson) =>
    schemaJson?.properties?.fidelity?.properties?.declaredInventory?.items?.enum;
  const now = enumOf(readJson(SCHEMA));
  expect('updated enum carries iv', Array.isArray(now) && now.includes('iv'), JSON.stringify(now));
  const old = enumOf(
    JSON.parse(git(['show', `${BASE}:operations-local/gate5/harness-record.schema.json`])),
  );
  expect(
    `enum at ${BASE} lacks iv`,
    Array.isArray(old) && !old.includes('iv'),
    JSON.stringify(old),
  );
  const rows = [
    ...rowsOf(path.join(SCRATCH, 'out', 'a1.jsonl')),
    ...rowsOf(path.join(SCRATCH, 'out', 'a5.jsonl')),
  ];
  expect('A1/A5 rows exist', rows.length === 4, String(rows.length));
  expect(
    'every A1/A5 declaredInventory item is in the updated enum',
    rows.every((row) => row.fidelity.declaredInventory.every((i) => now.includes(i))),
  );
  expect(
    'every A1/A5 row carries an item outside the base enum',
    rows.every((row) => row.fidelity.declaredInventory.some((i) => !old.includes(i))),
  );
  expect(
    'the string is the contract literal',
    R4_STRING === 'severity (inventory iv: lowered under R4)',
  );
});

// ── verdict ──────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.pass);
say(
  `\nArms: ${results.length} run, ${results.length - failed.length} PASS, ${failed.length} FAIL${failed.length > 0 ? ` (${failed.map((r) => r.name.split(' ')[0]).join(', ')})` : ''}`,
);
say(`Verdict: ${failed.length === 0 ? 'PASS (exit 0)' : 'FAIL (exit 1)'}`);
writeFileSync(OUT, `${log.join('\n')}\n`, 'utf8');
console.log(`log → ${OUT}`);
process.exit(failed.length === 0 ? 0 : 1);
