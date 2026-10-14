#!/usr/bin/env node
// Gate (5) — the R4 severity-lowering controls for the migration harness
// (mmnto-ai/totem#3044; the lift ruling's Q1 (a′) on mmnto-ai/totem-strategy#1486,
// the addendum's mechanism (ii)). The harness's fidelity leg admits ONE new expected
// divergence — a record severity LOWER than its legacy row's, declared as inventory
// item `iv`, on a rule named in `R4_SEVERITY_LOWERING_RULES` — and this script
// measures that admission and every refusal around it by spawning the harness over
// fixtures DERIVED under `--scratch` from the pin's own records and manifest (a
// derived fixture asserts its one-line delta, the K5b pattern), never from copies
// committed here. The committed artifacts are this script, the README beside it and
// `r4-controls-run.log`, the run of record at the commit that carries them.
//
// Arms (each records its invocation, exit, the measured lines and PASS/FAIL):
//   A0  the allow-list literal in the harness SOURCE is exactly the ruling's pair, under
//       the grammar strategy's parity control is asked to refuse outside (below)
//   A1  the admitted lowering: both named records at `warning` with `iv` declared
//       → exit 0, every row `expectedDivergence` = the string, `unexpected` empty
//   A2  the same records, `iv` NOT declared → exit 1, `unexpected` = ['severity']
//   A3  `iv` declared on a hash the ruling did not name → exit 2 before any record is
//       read, shown on a hash OUTSIDE the manifest and the --only selection (the
//       refusal reads the whole inventory, not the selected entries)
//   A4  a raise under a declaration (synthetic manifest row at legacy `warning`, the
//       pin's record at `error`) → exit 1, `unexpected` = ['severity']
//   A4b a severity OUTSIDE the closed pair on the legacy side (synthetic `info`) with the
//       record lowered and `iv` declared → exit 1, `unexpected` = ['severity']
//   A5  the pin's records unmodified with `iv` declared → exit 0, identical, and the
//       inert-declaration note printed once per record, AFTER the record's own line
//   A6  `iv` under `--r14` (the K3 regression) → exit 2
//   A7  `iv` beside `ii` → exit 2
//   A8  every recorded run reproduces its recorded fidelity lines unchanged (K3 and
//       batches 1 to 4), and the harness at `--base` and the harness here emit the
//       same stdout, stderr, per-record rows and exit over K3 and over the whole
//       53-entry set (the change is inert for every existing input)
//   A9  every row this script produced validates against the updated schema in full
//       (a keyword-subset validator over the schema file; an unimplemented keyword is
//       an error), the rows carrying `iv` fail the schema at `--base`, and the rows
//       without it pass both
//
// The allow-list grammar (A0; what strategy's parity control is asked to refuse
// outside) is a POSITIVE list: exactly one line of the form
//   export const R4_SEVERITY_LOWERING_RULES = ['<16 lowercase hex>', ...];
// whose bracket body is fully consumed by single-quoted lowercase 16-hex tokens and
// commas (no spread, no identifier, no double quote, no upper case, no residue, no
// repeat), and every other occurrence of the identifier in one of exactly four forms:
// the line `Object.freeze(R4_SEVERITY_LOWERING_RULES);` (the runtime freeze, required
// once), the token immediately followed by `.includes(`, the token immediately followed
// by `.join(`, or a mention on a comment line. Anything else is a violation (leg read 2,
// F1 named eleven widening shapes the earlier negative list let through). The limit: a
// source grammar sees occurrences of the identifier and nothing else; a mutation that
// never names it is invisible to it, which is why the harness also freezes the array —
// under ESM strict mode every write to it throws, whatever the route.
//
// Usage:
//   node operations-local/gate5/r4/controls-r4.mjs --scratch <new or empty dir> \
//     --seed <strategy operations/310-r14-audit/seed-20.json> \
//     --corpus <strategy operations/310-r14-audit/inputs/compiled-rules.json> \
//     [--core <@mmnto/totem package dir>] [--r14-pin <sha>] [--base <sha>] [--out <log>]
//
// `--scratch` must be new or empty (stale fixtures and rows would contaminate A3 and
// A9). The R14 records for A6 and A8 are read from `--r14-pin` (default 78e7f196, the
// E26 cure record pin K3 is recorded at) with `git show`, and the base harness for A8's
// differential and the base schema for A9 from `--base` (default b1792d5a, the commit
// this change branches from), so no second worktree is needed. `--out` defaults to the
// committed run log beside this script: a re-run REPLACES the run of record on purpose,
// and the diff shows it. Nothing is written outside `--scratch` and `--out`.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE5 = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(GATE5, '..', '..');
const HARNESS = path.join(GATE5, 'mig-harness.mjs');
const HARNESS_REL = 'operations-local/gate5/mig-harness.mjs';
const SCHEMA = path.join(GATE5, 'harness-record.schema.json');
const SCHEMA_REL = 'operations-local/gate5/harness-record.schema.json';
const MANIFEST = path.join(GATE5, 'manifest-2263305c.json');
const BATCHES = [1, 2, 3, 4].map((n) => ({
  n,
  inventory: path.join(GATE5, `batch-${n}`, 'mig-inventory.json'),
  log: path.join(GATE5, `batch-${n}`, 'harness-run.log'),
}));
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
if (existsSync(SCRATCH) && readdirSync(SCRATCH).length > 0)
  die(
    `--scratch ${SCRATCH} is not empty; pass a new or empty directory (stale fixtures and rows would contaminate A3 and A9)`,
  );
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
  ...BATCHES.flatMap((b) => [b.inventory, b.log]),
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
const pkgVersion = (dir) => {
  try {
    return readJson(path.join(dir, 'package.json')).version;
  } catch {
    return 'unknown';
  }
};

/** Spawn a harness script; never throws on a non-zero exit (the exit IS the measurement). */
function runScript(script, args) {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) die(`spawning ${script} failed: ${r.error.message}`);
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
 * For the base-vs-new differential: the two harness files sit in different directories,
 * so the K4 header's `checkout` line (read relative to the script) and the `per-record
 * output:` line (the --out path) differ by construction; every other line must agree.
 */
const comparable = (text) =>
  text
    .split(/\r?\n/)
    .filter((l) => !/^ {2}checkout {2}/.test(l) && !/^per-record output:/.test(l))
    .join('\n');

/**
 * The allow-list, read from the harness SOURCE under the grammar strategy's parity
 * control is asked to refuse outside (the header comment) — never by importing the
 * script, which would run it. Returns the hashes and every grammar violation found.
 */
function allowListFromSource() {
  return parseAllowListSource(readFileSync(HARNESS, 'utf8'));
}
/**
 * The grammar over any source string: the hashes it declares and every violation found.
 * A POSITIVE list — the declaration line, the freeze line, `.includes(`, `.join(` and
 * comment lines are the only places the identifier may occur; everything else is a
 * violation. Line-based on purpose: a member access split by whitespace, a newline or
 * an inline comment is not "immediately followed by" and is refused.
 */
function parseAllowListSource(src) {
  const violations = [];
  const ID = 'R4_SEVERITY_LOWERING_RULES';
  const lines = src.split('\n');
  const declRe = /^export const R4_SEVERITY_LOWERING_RULES = \[([^\]]*)\];\r?$/;
  const declLines = lines.map((l, i) => (declRe.test(l) ? i : -1)).filter((i) => i >= 0);
  if (declLines.length !== 1)
    violations.push(`expected exactly one declaration line, found ${declLines.length}`);
  const body = declLines.length > 0 ? declRe.exec(lines[declLines[0]])[1] : '';
  // The body is fully consumed by single-quoted lowercase 16-hex tokens and commas.
  const tokens = [...body.matchAll(/'([0-9a-f]{16})'/g)].map((x) => x[1]);
  const residue = body.replace(/'[0-9a-f]{16}'/g, '').replace(/[,\s]/g, '');
  if (residue.length > 0)
    violations.push(`residue in the array literal: ${JSON.stringify(residue)}`);
  if (tokens.length === 0) violations.push('the array literal holds no 16-hex hash');
  if (new Set(tokens).size !== tokens.length) violations.push('a hash repeats');
  const FREEZE_LINE = `Object.freeze(${ID});`;
  let freezeLines = 0;
  lines.forEach((rawLine, i) => {
    if (i === declLines[0]) return;
    const line = rawLine.replace(/\r$/, '');
    if (!line.includes(ID)) return;
    const trimmed = line.trimStart();
    // A comment line: `//`, `/*`, `/**` or a block comment's interior `*`.
    if (/^(\/\/|\/\*|\*)/.test(trimmed)) return;
    if (trimmed === FREEZE_LINE) {
      freezeLines += 1;
      return;
    }
    // A code line: every occurrence must be the token immediately followed by
    // `.includes(` or `.join(` — no whitespace, no optional chaining, no other member,
    // no assignment, no argument position, no alias, no shadowing binding.
    let idx = line.indexOf(ID);
    while (idx !== -1) {
      const after = line.slice(idx + ID.length);
      if (!/^\.(includes|join)\(/.test(after))
        violations.push(
          `line ${i + 1}: an occurrence outside the allowed forms: ${JSON.stringify(line.trim().slice(0, 80))}`,
        );
      idx = line.indexOf(ID, idx + ID.length);
    }
  });
  if (freezeLines !== 1) violations.push(`expected exactly one freeze line, found ${freezeLines}`);
  return { hashes: tokens, violations };
}

/**
 * A validator for the keyword subset `harness-record.schema.json` uses (type, enum,
 * const, pattern, minimum, required, properties, additionalProperties, items, plus the
 * annotation keywords); an unimplemented keyword is an ERROR, never a silent pass.
 */
function validateAgainstSchema(schema, value, at = '$') {
  const KNOWN = new Set([
    '$schema',
    '$id',
    'title',
    'description',
    'type',
    'required',
    'additionalProperties',
    'properties',
    'enum',
    'const',
    'items',
    'pattern',
    'minimum',
  ]);
  for (const k of Object.keys(schema))
    if (!KNOWN.has(k))
      throw new Error(`schema keyword ${k} at ${at} is not implemented by this validator`);
  const errs = [];
  const typeOk = (t, v) =>
    t === 'null'
      ? v === null
      : t === 'array'
        ? Array.isArray(v)
        : t === 'object'
          ? v !== null && typeof v === 'object' && !Array.isArray(v)
          : t === 'integer'
            ? Number.isInteger(v)
            : typeof v === t;
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => typeOk(t, value)))
      errs.push(`${at}: type ${JSON.stringify(schema.type)}`);
  }
  if (schema.enum !== undefined && !schema.enum.some((e) => deepEqual(e, value)))
    errs.push(`${at}: enum ${JSON.stringify(value)}`);
  if (schema.const !== undefined && !deepEqual(schema.const, value)) errs.push(`${at}: const`);
  if (
    schema.pattern !== undefined &&
    typeof value === 'string' &&
    !new RegExp(schema.pattern).test(value)
  )
    errs.push(`${at}: pattern`);
  if (schema.minimum !== undefined && typeof value === 'number' && value < schema.minimum)
    errs.push(`${at}: minimum`);
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const r of schema.required ?? [])
      if (!Object.hasOwn(value, r)) errs.push(`${at}: missing ${r}`);
    for (const [k, v] of Object.entries(value)) {
      const prop = schema.properties?.[k];
      if (prop !== undefined) errs.push(...validateAgainstSchema(prop, v, `${at}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${at}: additional property ${k}`);
    }
  }
  if (Array.isArray(value) && schema.items !== undefined)
    value.forEach((v, i) => errs.push(...validateAgainstSchema(schema.items, v, `${at}[${i}]`)));
  return errs;
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
const trackedRecords = execFileSync('git', ['ls-files', '.totem/rules'], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
})
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l.length > 0)
  .map((l) => path.basename(l));
const recordFor = (hash8) => {
  const names = trackedRecords.filter((n) => new RegExp(`(^|-)${hash8}(-|\\.)`).test(n));
  if (names.length !== 1)
    die(`${hash8}: expected one tracked record, found ${names.length} (${names.join(', ')})`);
  return names[0];
};
const hasRecord = (hash8) =>
  trackedRecords.filter((n) => new RegExp(`(^|-)${hash8}(-|\\.)`).test(n)).length === 1;
/** An inventory with the batch-1 entry for each hash (or an empty one), the listed items set. */
function inventoryFor(entries, control) {
  const base = readJson(BATCHES[0].inventory);
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
/** The four batch inventories merged (their keys are disjoint) for a whole-set run. */
function mergedInventory() {
  const merged = {
    _schema: 'gate5-declared-inventory/1',
    _control: 'R4 control A8 — the four batch inventories merged; never a run inventory',
  };
  for (const b of BATCHES)
    for (const [k, v] of Object.entries(readJson(b.inventory)))
      if (!k.startsWith('_')) merged[k] = v;
  return merged;
}
const onlyOf = (inventoryPath) =>
  Object.keys(readJson(inventoryPath))
    .filter((k) => !k.startsWith('_'))
    .map((k) => k.slice(0, 8))
    .join(',');
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
/** The harness at `--base`, materialised under scratch at its own repo-relative depth. */
function baseHarness() {
  const dir = path.join(sub('base'), 'operations-local', 'gate5');
  mkdirSync(dir, { recursive: true });
  const p = path.join(dir, 'mig-harness.mjs');
  const text = git(['show', `${BASE}:${HARNESS_REL}`]);
  writeFileSync(p, text, 'utf8');
  return { path: p, sha256: sha256(Buffer.from(text, 'utf8')) };
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
const invoke = (args, script = HARNESS) => {
  say(
    `  invocation: node ${script === HARNESS ? HARNESS_REL : path.relative(SCRATCH, script)} ${args.join(' ')}`,
  );
  const r = runScript(script, args);
  say(`  exit: ${r.status}`);
  return r;
};
const k4Line = (stdout) =>
  stdout.split(/\r?\n/).find((l) => /^ {2}@mmnto\/totem {3}/.test(l)) ?? '(no K4 line)';

say(`controls-r4 — ${new Date().toISOString()}`);
say(`  repo root ${REPO_ROOT}`);
say(`  harness   ${HARNESS_REL} (sha256 ${sha256(readFileSync(HARNESS))})`);
say(`  schema    ${SCHEMA_REL} (sha256 ${sha256(readFileSync(SCHEMA))})`);
say(`  core      ${CORE} (@mmnto/totem ${pkgVersion(CORE)} by its package.json)`);
say(`  node      ${process.version}`);
say(`  scratch   ${SCRATCH}`);
say(`  r14 pin   ${R14_PIN} · base ${BASE}`);

const parsed = allowListFromSource();
say(`  allow-list (parsed from the harness source): ${parsed.hashes.join(', ')}`);
arm(
  'A0 the allow-list literal is the ruling’s pair under the refused-outside grammar',
  (expect) => {
    expect(
      'no grammar violation',
      parsed.violations.length === 0,
      parsed.violations.join('; ') || 'none',
    );
    expect('two hashes', parsed.hashes.length === 2, String(parsed.hashes.length));
    expect('2266fc0dfe824f24 listed', parsed.hashes.includes('2266fc0dfe824f24'));
    expect('87aff037d7de47a7 listed', parsed.hashes.includes('87aff037d7de47a7'));
    // The grammar is exercised on a VALID base (the declaration and the freeze line),
    // on the four allowed occurrence forms (each accepted), and on twenty wrong sources
    // — the five read 1 named and the eleven widening shapes read 2 named, plus a
    // missing freeze, a double declaration, an indexed write and a shadowing binding —
    // each built on the valid base so the ONE violation reported is the defect's own.
    const DECL =
      "export const R4_SEVERITY_LOWERING_RULES = ['2266fc0dfe824f24', '87aff037d7de47a7'];";
    const FREEZE = 'Object.freeze(R4_SEVERITY_LOWERING_RULES);';
    const base = `${DECL}\n${FREEZE}\n`;
    const x = "'0123456789abcdef'";
    const probe = (source) => parseAllowListSource(source);
    expect(
      'the valid base passes',
      probe(base).violations.length === 0,
      probe(base).violations.join('; ') || 'none',
    );
    const allowed = {
      includes: `${base}if (!R4_SEVERITY_LOWERING_RULES.includes(h)) die('x');\n`,
      join: `${base}die(\`not in the list (\${R4_SEVERITY_LOWERING_RULES.join(', ')})\`);\n`,
      lineComment: `${base}// R4_SEVERITY_LOWERING_RULES is the ruling's pair\n`,
      blockComment: `${base}/**\n * R4_SEVERITY_LOWERING_RULES is read here.\n */\n`,
    };
    for (const [label, source] of Object.entries(allowed))
      expect(
        `the grammar accepts the ${label} form`,
        probe(source).violations.length === 0,
        probe(source).violations.join('; ') || 'none',
      );
    const wrong = {
      spread: `${DECL.replace("'];", `', ...EXTRA];`)}\n${FREEZE}\n`,
      identifier: `${DECL.replace("'];", `', OTHER];`)}\n${FREEZE}\n`,
      doubleQuoted: `${DECL.replace("'];", `', "0123456789abcdef"];`)}\n${FREEZE}\n`,
      upperCase: `${DECL.replace("'];", `', '0123456789ABCDEF'];`)}\n${FREEZE}\n`,
      repeat: `${DECL.replace("'];", `', '2266fc0dfe824f24'];`)}\n${FREEZE}\n`,
      push: `${base}R4_SEVERITY_LOWERING_RULES.push(${x});\n`,
      pushSpace: `${base}R4_SEVERITY_LOWERING_RULES .push(${x});\n`,
      pushNewline: `${base}R4_SEVERITY_LOWERING_RULES\n  .push(${x});\n`,
      optionalChain: `${base}R4_SEVERITY_LOWERING_RULES?.push(${x});\n`,
      commentSplit: `${base}R4_SEVERITY_LOWERING_RULES/**/.push(${x});\n`,
      includesAssigned: `${base}R4_SEVERITY_LOWERING_RULES.includes = () => true;\n`,
      alias: `${base}const L = R4_SEVERITY_LOWERING_RULES;\nL.push(${x});\n`,
      prototypeCall: `${base}Array.prototype.push.call(R4_SEVERITY_LOWERING_RULES, ${x});\n`,
      objectAssign: `${base}Object.assign(R4_SEVERITY_LOWERING_RULES, { 2: ${x} });\n`,
      reflectSet: `${base}Reflect.set(R4_SEVERITY_LOWERING_RULES, 2, ${x});\n`,
      callbackMutation: `${base}R4_SEVERITY_LOWERING_RULES.forEach((h, i, a) => a.push(${x}));\n`,
      lengthWrite: `${base}R4_SEVERITY_LOWERING_RULES.length = 3;\n`,
      indexedWrite: `${base}R4_SEVERITY_LOWERING_RULES [2] = ${x};\n`,
      shadowing: `${base}{\n  let R4_SEVERITY_LOWERING_RULES = [${x}];\n}\n`,
      noFreeze: `${DECL}\n`,
      doubleDeclaration: `${base}${DECL}\n`,
    };
    for (const [label, source] of Object.entries(wrong)) {
      const v = probe(source).violations;
      expect(
        `the grammar refuses the ${label} variant`,
        v.length > 0,
        v.join('; ') || 'no violation',
      );
    }
    expect(
      'twenty-one wrong sources probed',
      Object.keys(wrong).length === 21,
      String(Object.keys(wrong).length),
    );
  },
);
if (parsed.violations.length > 0 || parsed.hashes.length !== 2)
  die('A0 failed; the remaining arms would measure against a list this control does not trust');
const ALLOW = parsed.hashes;
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

const commonArgs = (extra) => [...extra, '--core', CORE];
const setArgs = (manifestPath, only, inventory, rules, out) =>
  commonArgs([
    '--set',
    manifestPath,
    ...(only === null ? [] : ['--only', only]),
    '--inventory',
    inventory,
    '--rules',
    rules,
    ...(out === null ? [] : ['--out', out]),
  ]);

// A1 — the admitted lowering.
const loweredDir = sub('rules-lowered');
const lowered = LISTED.map((l) => ({ ...l, ...lowerRecordCopy(l.record, loweredDir) }));
for (const l of lowered)
  say(
    `  derived ${path.relative(SCRATCH, l.dst)} — line ${l.changedLine} 'severity: error' → 'severity: warning' (sha256 ${l.sha256})`,
  );
const onlyListed = LISTED.map((l) => l.hash8).join(',');
const producedRows = []; // every row this script produced, for A9
const collect = (outPath) => {
  const rows = rowsOf(outPath);
  producedRows.push(...rows);
  return rows;
};
arm('A1 the admitted lowering (iv declared, listed rules, warning against error)', (expect) => {
  const inv = path.join(sub('inv'), 'a1.json');
  writeJson(inv, inventoryFor(Object.fromEntries(LISTED.map((l) => [l.hash, ['i', 'iv']])), 'A1'));
  const out = path.join(sub('out'), 'a1.jsonl');
  const r = invoke(setArgs(MANIFEST, onlyListed, inv, loweredDir, out));
  say(`  K4: ${k4Line(r.stdout)}`);
  expect('exit 0', r.status === 0, String(r.status));
  const rows = collect(out);
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
  expect(
    'the printed row line carries the string as expected',
    new RegExp(`fidelity: ${R4_STRING.replace(/[()]/g, '\\$&')} \\(expected\\)`).test(r.stdout),
  );
});

// A2 — the same records, undeclared.
arm('A2 the lowering undeclared (iv absent)', (expect) => {
  const inv = path.join(sub('inv'), 'a2.json');
  writeJson(inv, inventoryFor(Object.fromEntries(LISTED.map((l) => [l.hash, ['i']])), 'A2'));
  const out = path.join(sub('out'), 'a2.jsonl');
  const r = invoke(setArgs(MANIFEST, onlyListed, inv, loweredDir, out));
  expect('exit 1', r.status === 1, String(r.status));
  const rows = collect(out);
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

// A3 — iv on a hash the ruling did not name; the refusal reads the whole inventory.
arm('A3 iv declared on a hash outside the allow-list (refused at inventory read)', (expect) => {
  const other = manifest.rules.find(
    (r) =>
      !ALLOW.includes(r.lessonHash) &&
      r.legacy?.severity === 'error' &&
      hasRecord(r.lessonHash.slice(0, 8)),
  );
  if (other === undefined)
    throw new Error('no non-listed error-severity rule with a tracked record in the manifest');
  say(`  non-listed rule: ${other.lessonHash} (${recordFor(other.lessonHash.slice(0, 8))})`);
  const dir = sub('rules-a3');
  const copy = lowerRecordCopy(recordFor(other.lessonHash.slice(0, 8)), dir);
  say(`  derived ${path.relative(SCRATCH, copy.dst)} — line ${copy.changedLine} lowered`);
  // (a) the declaration on the selected, lowered, non-listed rule.
  const invA = path.join(sub('inv'), 'a3a.json');
  const base = readJson(BATCHES[0].inventory)[other.lessonHash]?.inventory ?? [];
  writeJson(invA, inventoryFor({ [other.lessonHash]: [...base, 'iv'] }, 'A3a'));
  const outA = path.join(sub('out'), 'a3a.jsonl');
  const ra = invoke(setArgs(MANIFEST, other.lessonHash.slice(0, 8), invA, dir, outA));
  expect('(a) exit 2', ra.status === 2, String(ra.status));
  expect(
    '(a) stderr names the hash and the allow-list',
    new RegExp(
      `inventory entry ${other.lessonHash} declares iv .*not in the harness's R4 allow-list \\(2266fc0dfe824f24, 87aff037d7de47a7,`,
    ).test(ra.stderr),
    ra.stderr.trim().split('\n')[0],
  );
  expect('(a) no rows written', rowsOf(outA).length === 0, String(rowsOf(outA).length));
  // (b) the discriminating input for EAGER refusal: a declaration on a hash that is in
  // neither the manifest nor the --only selection; a lazy, per-entry refusal would
  // never reach it and the run would exit 0 (leg read 1, F3).
  const stray = '0000000000000000';
  const invB = path.join(sub('inv'), 'a3b.json');
  writeJson(invB, inventoryFor({ [stray]: ['iv'], [other.lessonHash]: base }, 'A3b'));
  const outB = path.join(sub('out'), 'a3b.jsonl');
  const rb = invoke(setArgs(MANIFEST, other.lessonHash.slice(0, 8), invB, RULES_DIR, outB));
  expect(
    '(b) exit 2 on a hash outside the manifest and the selection',
    rb.status === 2,
    String(rb.status),
  );
  expect(
    '(b) stderr names the stray hash',
    new RegExp(`inventory entry ${stray} declares iv`).test(rb.stderr),
    rb.stderr.trim().split('\n')[0],
  );
  expect('(b) no rows written', rowsOf(outB).length === 0, String(rowsOf(outB).length));
  expect(
    '(b) no entry line printed (refused before the entry loop)',
    !/^ *\d+\. [0-9a-f]{16}/m.test(rb.stdout),
  );
});

// A4 — a raise under a declaration; A4b — a legacy severity outside the pair.
const syntheticManifest = (target, legacySeverity, label) => {
  const row = JSON.parse(JSON.stringify(byHash.get(target.hash)));
  row.legacy.severity = legacySeverity;
  const synth = {
    ...manifest,
    _control: `R4 control ${label} synthetic — the legacy row's severity set to ${JSON.stringify(legacySeverity)}; never a manifest of the run`,
    rules: [row],
  };
  const p = path.join(sub('manifest'), `${label.toLowerCase()}-manifest.json`);
  writeJson(p, synth);
  return p;
};
arm(
  'A4 a raise under a declaration (synthetic legacy warning, the pin record at error)',
  (expect) => {
    const target = LISTED[0];
    const synthPath = syntheticManifest(target, 'warning', 'A4');
    const inv = path.join(sub('inv'), 'a4.json');
    writeJson(inv, inventoryFor({ [target.hash]: ['i', 'iv'] }, 'A4'));
    const out = path.join(sub('out'), 'a4.jsonl');
    const r = invoke(setArgs(synthPath, null, inv, RULES_DIR, out));
    expect('exit 1', r.status === 1, String(r.status));
    const rows = collect(out);
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
arm(
  'A4b a legacy severity outside the pair (synthetic info) with the record lowered and iv declared',
  (expect) => {
    const target = LISTED[0];
    const synthPath = syntheticManifest(target, 'info', 'A4b');
    const inv = path.join(sub('inv'), 'a4b.json');
    writeJson(inv, inventoryFor({ [target.hash]: ['i', 'iv'] }, 'A4b'));
    const out = path.join(sub('out'), 'a4b.jsonl');
    const r = invoke(setArgs(synthPath, null, inv, loweredDir, out));
    expect('exit 1', r.status === 1, String(r.status));
    const rows = collect(out);
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
  const r = invoke(setArgs(MANIFEST, onlyListed, inv, RULES_DIR, out));
  expect('exit 0', r.status === 0, String(r.status));
  const rows = collect(out);
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
  const outLines = r.stdout.split(/\r?\n/);
  for (const l of LISTED) {
    const recordIdx = outLines.findIndex((x) => x.startsWith(`    ${l.record} [`));
    const noteIdx = outLines.findIndex((x) =>
      x.startsWith(
        `      note: ${l.record} declares inventory iv (severity lowered under R4) but the record severity equals the legacy row`,
      ),
    );
    expect(
      `${l.record}: the inert note names the record and prints directly after its line`,
      recordIdx >= 0 && noteIdx === recordIdx + 1,
      `record line ${recordIdx}, note line ${noteIdx}`,
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
const k3Args = (inventory, extra = []) =>
  commonArgs([
    '--seed',
    SEED,
    '--corpus',
    CORPUS,
    '--r14',
    '--inventory',
    inventory,
    '--rules',
    r14.dir,
    ...extra,
  ]);
arm('A6 iv under --r14 (the K3 regression mode)', (expect) => {
  const k3 = readJson(K3_INVENTORY);
  const inv = path.join(sub('inv'), 'a6.json');
  const target = '87aff037d7de47a7';
  writeJson(inv, {
    ...k3,
    _control: 'R4 control A6 — the K3 inventory plus iv; never a run inventory',
    [target]: { ...(k3[target] ?? {}), inventory: [...((k3[target] ?? {}).inventory ?? []), 'iv'] },
  });
  const r = invoke(k3Args(inv));
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
  const r = invoke(setArgs(MANIFEST, LISTED[0].hash8, inv, loweredDir, null));
  expect('exit 2', r.status === 2, String(r.status));
  expect(
    'stderr names the pair',
    /declares iv beside ii/.test(r.stderr),
    r.stderr.trim().split('\n')[0],
  );
});

// A8 — the recorded runs reproduce, and the harness is inert for every existing input.
arm('A8a the K3 regression reproduces its recorded fidelity lines', (expect) => {
  const recorded = fidelityLines(readFileSync(K3_LOG, 'utf8'));
  const out = path.join(sub('out'), 'a8-k3.jsonl');
  const r = invoke(k3Args(K3_INVENTORY, ['--out', out]));
  collect(out);
  expect('exit 0', r.status === 0, String(r.status));
  const measured = fidelityLines(r.stdout);
  expect(
    'fidelity lines equal the recorded ones',
    deepEqual(measured, recorded),
    `${measured.join(' | ')} vs recorded ${recorded.join(' | ')}`,
  );
  expect('K3 reproduced', /K3 reproduced/.test(r.stdout));
});
for (const b of BATCHES)
  arm(`A8b batch ${b.n}’s --set run reproduces its recorded fidelity lines`, (expect) => {
    const recorded = fidelityLines(readFileSync(b.log, 'utf8'));
    const out = path.join(sub('out'), `a8-batch-${b.n}.jsonl`);
    const r = invoke(setArgs(MANIFEST, onlyOf(b.inventory), b.inventory, RULES_DIR, out));
    collect(out);
    expect('exit 0', r.status === 0, String(r.status));
    const measured = fidelityLines(r.stdout);
    expect(
      'fidelity lines equal the recorded ones',
      deepEqual(measured, recorded),
      `${measured.join(' | ')} vs recorded ${recorded.join(' | ')}`,
    );
  });
const base = baseHarness();
say(`\n  base harness ${BASE}:${HARNESS_REL} materialised (sha256 ${base.sha256})`);
const differential = (label, argsFor) => {
  const outNew = path.join(sub('out'), `a8c-${label}-new.jsonl`);
  const outBase = path.join(sub('out'), `a8c-${label}-base.jsonl`);
  const rNew = invoke(argsFor(outNew));
  const rBase = invoke(argsFor(outBase), base.path);
  return { rNew, rBase, outNew, outBase };
};
arm(`A8c the harness at ${BASE} and the harness here agree byte-for-byte over K3`, (expect) => {
  const { rNew, rBase, outNew, outBase } = differential('k3', (out) =>
    k3Args(K3_INVENTORY, ['--out', out]),
  );
  expect('exits equal', rNew.status === rBase.status, `${rNew.status} vs ${rBase.status}`);
  expect(
    'stdout equal (less the two path-bearing lines)',
    comparable(rNew.stdout) === comparable(rBase.stdout),
  );
  expect('stderr equal', rNew.stderr === rBase.stderr);
  expect(
    'per-record rows byte-equal',
    readFileSync(outNew, 'utf8') === readFileSync(outBase, 'utf8'),
    `${rowsOf(outNew).length} rows`,
  );
});
arm(
  `A8c the harness at ${BASE} and the harness here agree byte-for-byte over the whole 53-entry set`,
  (expect) => {
    const inv = path.join(sub('inv'), 'a8c-merged.json');
    writeJson(inv, mergedInventory());
    const { rNew, rBase, outNew, outBase } = differential('set', (out) =>
      setArgs(MANIFEST, null, inv, RULES_DIR, out),
    );
    collect(outNew);
    expect('exits equal', rNew.status === rBase.status, `${rNew.status} vs ${rBase.status}`);
    expect(
      'stdout equal (less the two path-bearing lines)',
      comparable(rNew.stdout) === comparable(rBase.stdout),
    );
    expect('stderr equal', rNew.stderr === rBase.stderr);
    expect(
      'per-record rows byte-equal',
      readFileSync(outNew, 'utf8') === readFileSync(outBase, 'utf8'),
      `${rowsOf(outNew).length} rows`,
    );
    expect('the whole set ran (53 entries)', /^set: .* 53 rule\(s\)/m.test(rNew.stdout));
  },
);

// A9 — the schema moved, the move is load-bearing, and every produced row validates.
arm(
  'A9 every produced row validates in full against the updated schema; iv rows fail the base schema',
  (expect) => {
    const schemaNow = readJson(SCHEMA);
    const schemaBase = JSON.parse(git(['show', `${BASE}:${SCHEMA_REL}`]));
    const enumOf = (s) => s?.properties?.fidelity?.properties?.declaredInventory?.items?.enum;
    expect(
      'updated enum carries iv',
      (enumOf(schemaNow) ?? []).includes('iv'),
      JSON.stringify(enumOf(schemaNow)),
    );
    expect(
      `enum at ${BASE} lacks iv`,
      !(enumOf(schemaBase) ?? []).includes('iv'),
      JSON.stringify(enumOf(schemaBase)),
    );
    expect('rows were produced', producedRows.length > 0, String(producedRows.length));
    const failingNow = producedRows
      .map((row) => validateAgainstSchema(schemaNow, row))
      .filter((e) => e.length > 0);
    expect(
      `every produced row (${producedRows.length}) validates against the updated schema`,
      failingNow.length === 0,
      failingNow
        .slice(0, 3)
        .map((e) => e.join('; '))
        .join(' || ') || 'none',
    );
    const ivRows = producedRows.filter(
      (row) =>
        Array.isArray(row.fidelity?.declaredInventory) &&
        row.fidelity.declaredInventory.includes('iv'),
    );
    const otherRows = producedRows.filter((row) => !ivRows.includes(row));
    expect('rows carrying iv were produced', ivRows.length >= 4, String(ivRows.length));
    expect(
      `every iv row (${ivRows.length}) FAILS the schema at ${BASE}`,
      ivRows.every((row) => validateAgainstSchema(schemaBase, row).length > 0),
    );
    expect(
      `every other row (${otherRows.length}) passes the schema at ${BASE} too`,
      otherRows.every((row) => validateAgainstSchema(schemaBase, row).length === 0),
    );
    const ivFailureNamesEnum = ivRows.every((row) =>
      validateAgainstSchema(schemaBase, row).some((e) =>
        /declaredInventory\[\d+\]: enum "iv"/.test(e),
      ),
    );
    expect(
      'the base-schema failure is the declaredInventory enum and nothing else',
      ivFailureNamesEnum &&
        ivRows.every((row) =>
          validateAgainstSchema(schemaBase, row).every((e) => /declaredInventory/.test(e)),
        ),
    );
  },
);

// ── verdict ──────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.pass);
say(
  `\nArms: ${results.length} run, ${results.length - failed.length} PASS, ${failed.length} FAIL${failed.length > 0 ? ` (${failed.map((r) => r.name.split(' ')[0]).join(', ')})` : ''}`,
);
say(`Verdict: ${failed.length === 0 ? 'PASS (exit 0)' : 'FAIL (exit 1)'}`);
writeFileSync(OUT, `${log.join('\n')}\n`, 'utf8');
console.log(`log → ${OUT}`);
process.exit(failed.length === 0 ? 0 : 1);
