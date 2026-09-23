#!/usr/bin/env node
// Gate (5) — the migration harness: R14's two legs generalized, plus the four
// additions the pre-registration names (operations/310-migration-preregistration.md
// § 5.1, at strategy b9ed654d). A NEW file set: the two R14 scripts at 36312ed9
// (`operations-local/r14-validate.mjs`, `operations-local/r14-differential.mjs`)
// are untouched, so the K3 regression compares like with like.
//
// What is kept in METHOD from R14:
//   - validate: the real `parseRuleRecord` then `compileRuleRecord` with a SYNTHETIC
//     ruleId (identity is producer-owned; the intake mints it) and a fixed clock.
//   - differential: `examples[i].bad` must fire and `examples[i].good` must stay
//     silent under the SHIPPED matchers the way the runtime uses them — regex
//     `new RegExp(pattern)` per line with the § Design 8 `requires` suppression;
//     ast-grep `matchAstGrepPattern(content, ext, payload, allLines)` with the
//     extension dispatched from the compiled rule's registry-resolved language.
//   - N records per entry, joined by the `<hash8>` segment of the record basename
//     (the R14 `r14-<hash8>-` prefix is one spelling of it; `mig-<hash8>-` another);
//     an entry's verdict is the WORST over its records.
//
// The four additions (§ 5.1):
//   (1) the fidelity leg is MANDATORY: `message`, `severity`, the matcher payload
//       and `requires` are compared against the frozen legacy row; the DECLARED
//       inventory (--inventory, the notes' machine-readable half) replaces R14's
//       hand-typed divergence set; every other delta is UNEXPECTED and fails the exit.
//       Checked by mechanism as well: the engine (`target.type` vs the legacy
//       engine) and the scope declarations — `excludeGlobs` equal to the legacy
//       `!`-entries under a declared (i), record positives a subset of the legacy
//       positives, a dropped positive only under a declared (iii).
//   (2) legacy-row-over-pair-0: the frozen compiled row run over `examples[0]` under
//       the record's engine dispatch (the `defective-source` discriminator, § 3.2) —
//       for every record that PARSED, lowered or not.
//   (3) the tree firing-set leg (--tree): legacy row and record (union over an
//       N-record set) over the pinned tree's in-scope files, `(file, line)` firings,
//       `added` / `removed` (§ 3.1); a firing's line is the match's start line.
//   (4) one JSON line per record on --out, schema `gate5-harness-record/1`
//       (`harness-record.schema.json` beside this file; each row is checked against
//       the required field set before it is written).
// C7's `runSmokeGate` reason check (§ 3.1 C7): the shipped smoke gate runs over every
// pair beside the R14-method `fires`; a `reason`, or a verdict that disagrees with
// `fires`, is recorded on the pair as `reason` and the record reads `not-evaluable`.
//
// Modes:
//   --set <manifest.json>                     the migration run (rules[] carries the legacy row + curated pair)
//   --seed <seed-20.json> --corpus <compiled-rules.json> --r14
//                                             the K3 regression over the R14 22 (R14's EXPECTED_COUNTS + dead-matcher probe)
// Common:
//   --rules <dir>        records directory (default <repo>/.totem/rules)
//   --core <dir|file>    the @mmnto/totem package dir (or its dist/index.js) whose matchers run (default <repo>/packages/core)
//   --cli <dir>          optional: an @mmnto/cli package dir, named in the K4 header
//   --inventory <json>   the declared inventory + expectations per lessonHash16
//   --tree <root>        the pinned tree for the firing-set leg (optional; absent => firingSet null, exit unaffected)
//   --out <jsonl>        the per-record output (optional)
//   --only <hash8,...>   restrict the set to these rules (a batch)
//
// Exit contract (§ 5.1): 0 iff every validate expectation holds, every UNEXPECTED
// fidelity divergence is zero, and the differential matches the declared
// expectations (in --r14 mode: R14's EXPECTED_COUNTS, entry sets and probe).
// Determinism: no clock in any computed value, no network, no writes except --out.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');

// ── args ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const flag = (name) => argv.includes(name);
const SET = opt('--set');
const SEED = opt('--seed');
const CORPUS = opt('--corpus');
const R14_MODE = flag('--r14');
const RULES_DIR = path.resolve(opt('--rules') ?? path.join(REPO_ROOT, '.totem', 'rules'));
const CORE = path.resolve(opt('--core') ?? path.join(REPO_ROOT, 'packages', 'core'));
const CLI = opt('--cli');
const INVENTORY_PATH = opt('--inventory');
const TREE = opt('--tree') ? path.resolve(opt('--tree')) : undefined;
const OUT = opt('--out');
const ONLY = opt('--only')
  ? new Set(
      opt('--only')
        .split(',')
        .map((s) => s.trim()),
    )
  : undefined;

const die = (msg) => {
  console.error(`[Totem Error] mig-harness: ${msg}`);
  process.exit(2);
};
if (SET === undefined && !(SEED !== undefined && CORPUS !== undefined)) {
  die(
    'pass --set <manifest.json>, or --seed <seed-20.json> --corpus <compiled-rules.json> (add --r14 for the K3 regression).',
  );
}
// The two modes are exclusive: --r14 is the K3 regression's admission of the ruled
// E26 declaration, so a --set run may never carry it (leg 2, F4).
if (SET !== undefined && R14_MODE) {
  die('--r14 is the K3 regression mode and cannot be combined with --set (the migration run).');
}

// ── the shipped matchers (K4 header) ────────────────────────────────────────
const coreDist = CORE.endsWith('.js') ? CORE : path.join(CORE, 'dist', 'index.js');
const corePkgDir = CORE.endsWith('.js') ? path.resolve(path.dirname(CORE), '..') : CORE;
if (!existsSync(coreDist)) die(`core dist not found at ${coreDist}`);
const core = await import(pathToFileURL(coreDist).href);
const {
  parseRuleRecord,
  compileRuleRecord,
  matchAstGrepPattern,
  sanitizeFileGlobs,
  fileMatchesGlobs,
  ruleAppliesToFile,
  requiresSuppressesMatch,
  registeredExtensions,
  extensionToLanguage,
  runSmokeGate,
} = core;
for (const [name, fn] of Object.entries({
  parseRuleRecord,
  compileRuleRecord,
  matchAstGrepPattern,
  sanitizeFileGlobs,
  fileMatchesGlobs,
  ruleAppliesToFile,
  requiresSuppressesMatch,
  registeredExtensions,
  extensionToLanguage,
  runSmokeGate,
})) {
  if (typeof fn !== 'function') die(`the core module at ${coreDist} does not export ${name}`);
}
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const coreRequire = createRequire(coreDist);
const pkgVersion = (dir) => {
  try {
    return readJson(path.join(dir, 'package.json')).version;
  } catch {
    return 'unknown';
  }
};
let napiVersion = 'unresolved';
try {
  napiVersion = readJson(coreRequire.resolve('@ast-grep/napi/package.json')).version;
} catch {
  /* reported as unresolved */
}
const extensions = registeredExtensions();
const languages = [...new Set(extensions.map((e) => extensionToLanguage(e)))].sort();
// Installed packs are a property of the CHECKOUT the records live in (a pack
// contributes languages to the registry the harness just printed), so the file is
// read from the RECORDS' checkout (`<records>/../..`), not from this script's own.
// With no pack declared, `packsLoaded === packs.length` holds trivially (0 === 0)
// and is printed so; with packs declared, this harness does not measure how many
// the registry loaded and says so rather than inferring it (leg 2, F6).
const packsPath = path.join(path.resolve(RULES_DIR, '..', '..'), '.totem', 'installed-packs.json');
let packsDeclared = [];
if (existsSync(packsPath)) {
  try {
    const packs = readJson(packsPath);
    packsDeclared = Array.isArray(packs) ? packs : (packs.packs ?? []);
  } catch {
    packsDeclared = null;
  }
}
const packsLine =
  packsDeclared === null
    ? 'unreadable .totem/installed-packs.json'
    : `${packsDeclared.length === 0 ? 'none declared' : packsDeclared.map((p) => (typeof p === 'string' ? p : (p.name ?? JSON.stringify(p)))).join(', ')} (packs.length ${packsDeclared.length}, packsLoaded ${packsDeclared.length === 0 ? 0 : 'n/a'} — packsLoaded === packs.length ${packsDeclared.length === 0 ? 'holds' : 'not measured by this harness'})`;
console.log('K4 header');
console.log(`  @mmnto/totem   ${pkgVersion(corePkgDir)}  (${coreDist})`);
if (CLI) console.log(`  @mmnto/cli     ${pkgVersion(path.resolve(CLI))}  (${path.resolve(CLI)})`);
console.log(
  `  checkout       ${pkgVersion(path.join(REPO_ROOT, 'packages', 'core'))} declared by ${path.join(REPO_ROOT, 'packages', 'core', 'package.json')}`,
);
console.log(`  node           ${process.version}`);
console.log(`  @ast-grep/napi ${napiVersion}`);
console.log(`  languages      ${languages.join(' · ')}  (extensions ${extensions.join(' ')})`);
console.log(`  packs          ${packsLine}`);
console.log(`  records        ${RULES_DIR}`);
if (TREE) console.log(`  tree           ${TREE}`);
console.log('');

/** Synthetic, harness-only — identity is producer-owned (§ Design 3 / R17). */
const SYNTHETIC_RULE_ID = '0123456789abcdef';
const FIXED_NOW = '2026-08-22T00:00:00.000Z';
const SCHEMA = 'gate5-harness-record/1';

const SATISFIED = 'differential-satisfied';
const GOOD_FIRES = 'good-also-fires';
const BAD_SILENT = 'bad-does-not-fire';
const NOT_EVALUABLE = 'not-evaluable';
const VERDICT_SEVERITY = [SATISFIED, GOOD_FIRES, BAD_SILENT, NOT_EVALUABLE];
const worse = (a, b) => (VERDICT_SEVERITY.indexOf(b) > VERDICT_SEVERITY.indexOf(a) ? b : a);

// ── the entry set ────────────────────────────────────────────────────────────
/** @type {Array<{entry:number, lessonHash:string, hash8:string, legacy:object, curatedPair?:object, r14?:object}>} */
let entries;
if (SET !== undefined) {
  const manifest = readJson(SET);
  const setSha256 = createHash('sha256').update(readFileSync(SET)).digest('hex');
  console.log(`set sha256: ${setSha256} (the freeze's splitRef suffix is its first 8 hex)`);
  entries = manifest.rules.map((r, i) => ({
    entry: i + 1,
    lessonHash: r.lessonHash,
    hash8: r.lessonHash.slice(0, 8),
    legacy: r.legacy,
    curatedPair: r.curatedPair,
    r14: r.r14,
    rank: r.rank,
    engine: r.engine,
  }));
  console.log(`set: ${SET} — ${entries.length} rule(s), manifest order`);
} else {
  const seedDoc = readJson(SEED);
  const corpus = readJson(CORPUS);
  const byHash = new Map(corpus.rules.map((r) => [r.lessonHash, r]));
  const picks = Array.isArray(seedDoc) ? seedDoc : seedDoc.picks;
  if (!Array.isArray(picks))
    die('--seed must be a bare array of compiled forms or a draw envelope with picks[]');
  entries = picks.map((pick, i) => {
    const hash = typeof pick === 'string' ? pick : pick.lessonHash;
    const legacy = byHash.get(hash);
    if (legacy === undefined) die(`pick ${hash} is not in the --corpus`);
    return {
      entry: i + 1,
      lessonHash: hash,
      hash8: hash.slice(0, 8),
      legacy,
      engine: legacy.engine,
    };
  });
  console.log(`seed: ${SEED} joined to ${CORPUS} — ${entries.length} entries, draw order`);
}
if (ONLY) {
  entries = entries.filter((e) => ONLY.has(e.hash8) || ONLY.has(e.lessonHash));
  console.log(`--only: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} selected`);
}

const inventory = INVENTORY_PATH ? readJson(INVENTORY_PATH) : {};
const declared = (lessonHash) => {
  const row = inventory[lessonHash] ?? {};
  // A payload divergence declared OUTSIDE the closed inventory (i)–(iii) is
  // admissible ONLY in the K3 regression (--r14): the ruled E26 cure on
  // `0e01112d` at 78e7f196 is the one case. In the migration run (--set) every
  // payload delta is (ii) or UNEXPECTED, so the key is REFUSED there rather than
  // honoured — the translator writes the inventory file, and a key the translator
  // could use to excuse a delta would be a bypass of § 3.1 C5 (leg finding F2).
  if (row.expectedPayloadDivergence !== undefined && !R14_MODE) {
    die(
      `inventory entry ${lessonHash} carries expectedPayloadDivergence, which is admissible only under --r14 (the K3 regression's ruled E26 cure); in the migration run every payload delta is inventory (ii) or unexpected (§ 3.1 C5).`,
    );
  }
  return {
    inventory: Array.isArray(row.inventory) ? row.inventory : [],
    expectedPayloadDivergence:
      R14_MODE &&
      typeof row.expectedPayloadDivergence === 'string' &&
      row.expectedPayloadDivergence.length > 0
        ? row.expectedPayloadDivergence
        : null,
    expect: {
      validate: row.expect?.validate ?? 'compiled',
      differential: row.expect?.differential ?? SATISFIED,
    },
  };
};

// ── records, joined by the hash8 segment ─────────────────────────────────────
const files = readdirSync(RULES_DIR)
  .filter((n) => n.endsWith('.rule.yaml'))
  .sort();
const segmentRe = (hash8) => new RegExp(`(^|-)${hash8}(-|\\.)`);
const groups = new Map();
const claimed = new Set();
for (const e of entries) {
  const names = files.filter((n) => segmentRe(e.hash8).test(n));
  groups.set(e.lessonHash, names);
  for (const n of names) claimed.add(n);
}
const orphans = files.filter((n) => !claimed.has(n));
if (orphans.length > 0 && R14_MODE) {
  die(
    `${orphans.length} record file(s) key to no seed entry (${orphans.join(', ')}) — the evidence set and the record set must agree.`,
  );
}
if (orphans.length > 0)
  console.log(
    `note: ${orphans.length} record file(s) outside the selected set are ignored: ${orphans.join(', ')}`,
  );

// ── matchers ─────────────────────────────────────────────────────────────────
const allLines = (text) => text.split('\n').map((_, i) => i + 1);
const EXT_BY_LANGUAGE = { typescript: '.ts', javascript: '.js', tsx: '.tsx' };
const dispatchExt = (language) => EXT_BY_LANGUAGE[language] ?? '.ts';
// A line is tested AS-IS: R14's `fires` (r14-differential.mjs) and the runtime's
// regex loop (rule-engine.ts) never strip a trailing CR, and a file's extension is
// dispatched as `path.extname` returns it, never lowercased (leg finding F9).
const lineOf = (s) => s;

/** Legacy compiled row's payload for the ast-grep matcher (config form or pattern). */
const legacyAstPayload = (legacy) =>
  legacy.astGrepYamlRule !== undefined ? legacy.astGrepYamlRule : legacy.astGrepPattern;

/** Does the compiled RECORD rule fire anywhere in `text`? (R14's `fires`, verbatim in method.) */
function recordFires(rule, text, ext) {
  if (rule.engine === 'regex') {
    const re = new RegExp(rule.pattern);
    const lines = text.split('\n').map(lineOf);
    const hits = lines.filter((line) => re.test(line));
    if (hits.length === 0) return false;
    if (rule.requires === undefined) return true;
    const requirement = new RegExp(rule.requires.pattern);
    if (rule.requires.scope === 'line') return hits.some((line) => !requirement.test(line));
    return !requirement.test(text);
  }
  const payload = rule.astGrepYamlRule !== undefined ? rule.astGrepYamlRule : rule.astGrepPattern;
  const hits = matchAstGrepPattern(
    text,
    ext ?? dispatchExt(rule.language),
    payload,
    allLines(text),
  );
  if (hits.length === 0) return false;
  if (rule.requires === undefined) return true;
  const requirement = new RegExp(rule.requires.pattern);
  return !requirement.test(text);
}

/** Does the frozen LEGACY row fire anywhere in `text` under the given dispatch? (No `requires` exists on a legacy row.) */
function legacyFires(legacy, text, ext) {
  if (legacy.engine === 'regex') {
    const re = new RegExp(legacy.pattern);
    return text
      .split('\n')
      .map(lineOf)
      .some((line) => re.test(line));
  }
  return matchAstGrepPattern(text, ext, legacyAstPayload(legacy), allLines(text)).length > 0;
}

/** `(file, line)` firings of the compiled RECORD rule over one tree file. */
function recordFirings(rule, file, text) {
  const out = [];
  const ext = path.extname(file);
  if (rule.engine === 'regex') {
    const re = new RegExp(rule.pattern);
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lineOf(lines[i]);
      if (!re.test(line)) continue;
      if (rule.requires !== undefined && requiresSuppressesMatch(rule, { line, file: () => text }))
        continue;
      out.push(`${file}:${i + 1}`);
    }
    return out;
  }
  const payload = rule.astGrepYamlRule !== undefined ? rule.astGrepYamlRule : rule.astGrepPattern;
  const hits = matchAstGrepPattern(text, ext, payload, allLines(text));
  if (
    hits.length > 0 &&
    rule.requires !== undefined &&
    new RegExp(rule.requires.pattern).test(text)
  )
    return out;
  for (const h of hits) out.push(`${file}:${h.lineNumber}`);
  return out;
}

/** `(file, line)` firings of the frozen LEGACY row over one tree file. */
function legacyFirings(legacy, file, text) {
  const out = [];
  const ext = path.extname(file);
  if (legacy.engine === 'regex') {
    const re = new RegExp(legacy.pattern);
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1)
      if (re.test(lineOf(lines[i]))) out.push(`${file}:${i + 1}`);
    return out;
  }
  for (const h of matchAstGrepPattern(text, ext, legacyAstPayload(legacy), allLines(text)))
    out.push(`${file}:${h.lineNumber}`);
  return out;
}

// ── the pinned tree (firing-set leg) ─────────────────────────────────────────
let treeFiles = null;
const treeText = new Map();
if (TREE !== undefined) {
  const listing = execFileSync('git', ['-C', TREE, 'ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  treeFiles = listing.split('\0').filter((f) => f.length > 0);
  console.log(`tree: ${TREE} — ${treeFiles.length} git-tracked path(s)`);
}
const readTree = (file) => {
  if (treeText.has(file)) return treeText.get(file);
  let text = null;
  try {
    const abs = path.join(TREE, file);
    if (statSync(abs).isFile()) text = readFileSync(abs, 'utf8');
  } catch {
    text = null;
  }
  treeText.set(file, text);
  return text;
};

/**
 * The pre-registered field set (§ 5.1 (4)) every output row must carry — the
 * required half of `harness-record.schema.json`; a row that fails it is a harness
 * fault and part of the exit. Additive keys are allowed and named in the schema.
 */
function rowShapeErrors(row) {
  const errs = [];
  const has = (o, k) => o !== null && typeof o === 'object' && Object.hasOwn(o, k);
  for (const k of [
    'schema',
    'lessonHash',
    'recordPath',
    'language',
    'validate',
    'fidelity',
    'differential',
    'legacyOverPair0',
    'firingSet',
  ])
    if (!has(row, k)) errs.push(`missing ${k}`);
  if (row.schema !== SCHEMA) errs.push('schema');
  if (!/^[0-9a-f]{16}$/.test(String(row.lessonHash))) errs.push('lessonHash');
  for (const k of ['parse', 'lower', 'reason'])
    if (!has(row.validate, k)) errs.push(`validate.${k}`);
  if (row.fidelity !== null)
    for (const k of [
      'message',
      'severity',
      'payload',
      'requires',
      'declaredInventory',
      'unexpected',
    ])
      if (!has(row.fidelity, k)) errs.push(`fidelity.${k}`);
  if (!Array.isArray(row.differential)) errs.push('differential');
  else
    for (const l of row.differential)
      for (const k of ['pair', 'badFires', 'goodSilent', 'reason'])
        if (!has(l, k)) errs.push(`differential[].${k}`);
  if (row.legacyOverPair0 !== null)
    for (const k of ['badFires', 'goodSilent'])
      if (!has(row.legacyOverPair0, k)) errs.push(`legacyOverPair0.${k}`);
  if (row.firingSet !== null)
    for (const k of ['legacy', 'record', 'added', 'removed'])
      if (!has(row.firingSet, k)) errs.push(`firingSet.${k}`);
  return errs;
}

// ── per record ───────────────────────────────────────────────────────────────
const outLines = [];
const validateCounts = { parsed: 0, compiled: 0, rejected: 0, failed: 0 };
const fidelity = { records: 0, identical: 0, expectedDivergent: 0, unexpected: 0 };
const fidelityEntries = { identical: 0, expectedDivergent: 0, unexpected: 0 };
const splitCounts = { [SATISFIED]: 0, [GOOD_FIRES]: 0, [BAD_SILENT]: 0, [NOT_EVALUABLE]: 0 };
const classified = [];
let validateMismatches = 0;
let differentialMismatches = 0;
let harnessThrows = 0;

console.log('');
for (const e of entries) {
  const names = groups.get(e.lessonHash) ?? [];
  const decl = declared(e.lessonHash);
  if (names.length === 0) {
    console.log(
      `${String(e.entry).padStart(2)}. ${e.lessonHash}  NO RECORD (expected ${decl.expect.validate} / ${decl.expect.differential})`,
    );
    validateMismatches += 1;
    classified.push({
      entry: e.entry,
      lessonHash: e.lessonHash,
      verdict: 'no-record',
      expected: decl.expect.differential,
    });
    continue;
  }
  let entryVerdict = SATISFIED;
  let entryFidelity = 'identical';
  const entryLegacyFirings = new Set();
  const entryRecordFirings = new Set();
  const entryRows = [];
  const lines = [];
  for (const name of names) {
    const relPath = path.posix.join('.totem/rules', name);
    const raw = readFileSync(path.join(RULES_DIR, name), 'utf8').replace(/\r\n/g, '\n');
    const row = {
      schema: SCHEMA,
      lessonHash: e.lessonHash,
      recordPath: relPath,
      language: null,
      validate: { parse: false, lower: null, reason: null },
      fidelity: null,
      differential: [],
      legacyOverPair0: null,
      firingSet: null,
    };
    let parsed;
    try {
      parsed = parseRuleRecord(raw, relPath);
      row.validate.parse = true;
      validateCounts.parsed += 1;
    } catch (err) {
      row.validate.reason = err instanceof Error ? err.message : String(err);
      validateCounts.failed += 1;
    }
    let rule;
    if (parsed !== undefined) {
      try {
        const outcome = compileRuleRecord(parsed, { ruleId: SYNTHETIC_RULE_ID, now: FIXED_NOW });
        if (outcome.kind === 'compiled') {
          rule = outcome.rule;
          row.validate.lower = 'compiled';
          validateCounts.compiled += 1;
        } else {
          row.validate.lower = 'rejected';
          row.validate.reason = outcome.reason;
          validateCounts.rejected += 1;
        }
      } catch (err) {
        row.validate.lower = 'throw';
        row.validate.reason = err instanceof Error ? err.message : String(err);
        validateCounts.failed += 1;
        harnessThrows += 1;
      }
    }
    const measuredValidate = !row.validate.parse ? 'parse-fail' : row.validate.lower;
    if (measuredValidate !== decl.expect.validate) validateMismatches += 1;
    if (rule !== undefined) row.language = rule.language ?? null;

    // (1) fidelity — mandatory, against the frozen legacy row, modulo the declared inventory.
    if (parsed !== undefined) {
      const rec = parsed.record;
      const legacy = e.legacy;
      const f = {
        message: rec.message === legacy.message,
        severity: rec.severity === legacy.severity,
        payload: null,
        requires: null,
        declaredInventory: decl.inventory,
        unexpected: [],
      };
      if (legacy.engine === 'regex') {
        f.payload = rec.target.pattern === legacy.pattern;
      } else if (typeof legacy.astGrepPattern === 'string' && legacy.astGrepPattern.length > 0) {
        f.payload = rec.target.pattern === legacy.astGrepPattern;
      } else if (legacy.astGrepYamlRule !== undefined) {
        f.payload = JSON.stringify(rec.target.rule) === JSON.stringify(legacy.astGrepYamlRule.rule);
      } else {
        f.payload = false;
      }
      const declaresRequires = decl.inventory.includes('ii');
      f.requires = (rec.requires !== undefined) === declaresRequires;
      const payloadExplained = declaresRequires
        ? 'payload (inventory ii)'
        : decl.expectedPayloadDivergence !== null
          ? `payload (declared: ${decl.expectedPayloadDivergence})`
          : null;
      // The engine and the SCOPE DECLARATIONS are checked by mechanism too (leg
      // finding F10): `target.type` must equal the legacy engine; `excludeGlobs`
      // must equal the legacy `!`-entries (inventory (i), declared); every record
      // positive glob must be a legacy positive; a legacy positive may be dropped
      // only under a declared (iii). The file-set comparison itself is C5's scope
      // half, the scorer's.
      f.engine = rec.target.type === legacy.engine;
      const legacyGlobs = Array.isArray(legacy.fileGlobs) ? legacy.fileGlobs : [];
      const legacyPositives = legacyGlobs.filter((g) => !g.startsWith('!'));
      const legacyExcludes = legacyGlobs.filter((g) => g.startsWith('!')).map((g) => g.slice(1));
      const recPositives = rec.target.scope.fileGlobs;
      const recExcludes = rec.target.scope.excludeGlobs ?? [];
      // True SET equality (a repeated entry cannot stand in for a missing one; leg 2, F3).
      const sameSet = (a, b) => {
        const A = new Set(a);
        const B = new Set(b);
        return A.size === B.size && [...A].every((x) => B.has(x));
      };
      // A dropped positive is a language split ONLY when its extension resolves to
      // a registered language other than the record's declared one (leg 2, F2);
      // a dropped glob of the record's own language, or of no registered language,
      // is a scope change no inventory item covers.
      const droppedPositives = legacyPositives.filter((g) => !recPositives.includes(g));
      const globLanguage = (g) => {
        const m = /\.([A-Za-z0-9]+)$/.exec(g);
        return m === null ? null : extensionToLanguage(`.${m[1].toLowerCase()}`);
      };
      const droppedSameLanguage = droppedPositives.filter((g) => {
        const lang = globLanguage(g);
        return lang === null || lang === undefined || lang === rec.target.language;
      });
      f.scope = {
        excludesMatch: sameSet(recExcludes, legacyExcludes),
        positivesSubset: recPositives.every((g) => legacyPositives.includes(g)),
        droppedPositives,
        droppedSameLanguage,
        declaredI: decl.inventory.includes('i'),
        declaredIII: decl.inventory.includes('iii'),
      };
      if (!f.message) f.unexpected.push('message');
      if (!f.severity) f.unexpected.push('severity');
      if (!f.payload && payloadExplained === null) f.unexpected.push('payload');
      if (!f.requires) f.unexpected.push('requires');
      if (!f.engine) f.unexpected.push('engine');
      if (!f.scope.excludesMatch) f.unexpected.push('scope.excludeGlobs');
      if (!f.scope.positivesSubset) f.unexpected.push('scope.fileGlobs');
      if (f.scope.droppedPositives.length > 0 && !f.scope.declaredIII)
        f.unexpected.push('scope.droppedPositives (no inventory iii)');
      if (f.scope.droppedSameLanguage.length > 0)
        f.unexpected.push(
          `scope.droppedPositives (not a language split: ${f.scope.droppedSameLanguage.join(', ')})`,
        );
      if (legacyExcludes.length > 0 && !f.scope.declaredI)
        f.unexpected.push('scope.excludeGlobs (inventory i undeclared)');
      f.expectedDivergence = !f.payload && payloadExplained !== null ? payloadExplained : null;
      row.fidelity = f;
      fidelity.records += 1;
      if (f.unexpected.length > 0) {
        fidelity.unexpected += 1;
        entryFidelity = 'unexpected';
      } else if (f.expectedDivergence !== null) {
        fidelity.expectedDivergent += 1;
        if (entryFidelity === 'identical') entryFidelity = 'expected-divergent';
      } else {
        fidelity.identical += 1;
      }
    }

    // (2) the frozen row over pair 0 under the record's dispatch — whenever the
    // record PARSED, lowered or not (leg finding F8): the `defective-source`
    // discriminator needs the legacy row and pair 0 only. A record whose declared
    // language has no registered grammar (K3's `1a7080eb`, `language: json`) gets
    // no substituted grammar: the leg reads `null` with the reason (leg 2, F1).
    if (parsed !== undefined && parsed.record.examples.length > 0) {
      const pair0 = parsed.record.examples[0];
      const recordLanguage = rule !== undefined ? rule.language : parsed.record.target.language;
      const legacyExt =
        e.legacy.engine === 'ast-grep' ? (EXT_BY_LANGUAGE[recordLanguage] ?? null) : '.ts';
      try {
        if (legacyExt === null) {
          row.legacyOverPair0 = {
            badFires: null,
            goodSilent: null,
            reason: `no registered grammar for language '${recordLanguage}' — the legacy row cannot be dispatched over pair 0`,
          };
        } else {
          const lb = legacyFires(e.legacy, pair0.bad, legacyExt);
          const lg = legacyFires(e.legacy, pair0.good, legacyExt);
          row.legacyOverPair0 = { badFires: lb, goodSilent: !lg, reason: null };
        }
      } catch (err) {
        row.legacyOverPair0 = {
          badFires: null,
          goodSilent: null,
          reason: err instanceof Error ? err.message : String(err),
        };
      }
    }

    // differential (C7) + (3) firing set
    let recordVerdict;
    let grammar;
    if (rule === undefined) {
      recordVerdict = NOT_EVALUABLE;
      grammar = row.validate.parse ? 'rejected' : 'unparsed';
      row.differential = [
        { pair: 0, badFires: null, goodSilent: null, reason: 'no compiled rule to evaluate' },
      ];
    } else {
      const ext = rule.engine === 'ast-grep' ? dispatchExt(rule.language) : null;
      grammar = rule.engine === 'ast-grep' ? `ast-grep@${ext}` : 'regex';
      const legs = [];
      let badSilent = false;
      let goodFires = false;
      let reasoned = false;
      parsed.record.examples.forEach((example, ordinal) => {
        try {
          const bad = recordFires(rule, example.bad, ext);
          const good = recordFires(rule, example.good, ext);
          // C7's `runSmokeGate` reason check (§ 3.1 C7; leg finding F1): the SHIPPED
          // smoke gate over the same pair; a `reason` from either side is an
          // `intake-defect` signal, never a pass, and a verdict that disagrees with
          // the R14-method `fires` is reported as a reason too (a harness↔shipped
          // divergence the scorer must see).
          const sgBad = runSmokeGate(rule, example.bad);
          const sgGood = runSmokeGate(rule, example.good);
          const reasons = [];
          if (typeof sgBad.reason === 'string') reasons.push(`smoke gate (bad): ${sgBad.reason}`);
          if (typeof sgGood.reason === 'string')
            reasons.push(`smoke gate (good): ${sgGood.reason}`);
          if (sgBad.matched !== bad)
            reasons.push(`smoke gate (bad) matched=${sgBad.matched} but fires=${bad}`);
          if (sgGood.matched !== good)
            reasons.push(`smoke gate (good) matched=${sgGood.matched} but fires=${good}`);
          const reason = reasons.length === 0 ? null : reasons.join('; ');
          legs.push({
            pair: ordinal,
            badFires: bad,
            goodSilent: !good,
            reason,
            smokeGate: { badMatched: sgBad.matched, goodMatched: sgGood.matched },
          });
          if (reason !== null) reasoned = true;
          if (!bad) badSilent = true;
          if (good) goodFires = true;
        } catch (err) {
          legs.push({
            pair: ordinal,
            badFires: null,
            goodSilent: null,
            reason: err instanceof Error ? err.message : String(err),
          });
          reasoned = true;
        }
      });
      row.differential = legs;
      recordVerdict = reasoned
        ? NOT_EVALUABLE
        : badSilent
          ? BAD_SILENT
          : goodFires
            ? GOOD_FIRES
            : SATISFIED;

      // (3) the tree firing set
      if (treeFiles !== null) {
        const legacyGlobs = sanitizeFileGlobs(e.legacy.fileGlobs ?? []);
        const legacySet = [];
        const recordSet = [];
        let unreadable = 0;
        for (const file of treeFiles) {
          const inLegacy = fileMatchesGlobs(file, legacyGlobs);
          const inRecord = ruleAppliesToFile(rule, file);
          if (!inLegacy && !inRecord) continue;
          const text = readTree(file);
          if (text === null) {
            unreadable += 1;
            continue;
          }
          if (inLegacy) legacySet.push(...legacyFirings(e.legacy, file, text));
          if (inRecord) recordSet.push(...recordFirings(rule, file, text));
        }
        const L = new Set(legacySet);
        const R = new Set(recordSet);
        for (const x of L) entryLegacyFirings.add(x);
        for (const x of R) entryRecordFirings.add(x);
        // The delta is the ENTRY's (§ 3.1: the union over an N-record set against the
        // legacy row); a single language record of a set covers one language's files
        // by construction, so its own `removed` would count the other languages' firings.
        // Per-record counts are kept; `added`/`removed` are filled at the entry level below.
        row.firingSet = {
          legacy: L.size,
          record: R.size,
          added: null,
          removed: null,
          unreadable,
          deltaScope: names.length > 1 ? 'entry-union' : 'record',
        };
      }
    }
    entryVerdict = worse(entryVerdict, recordVerdict);
    const legs = row.differential
      .map(
        (l) =>
          `pair${l.pair}: bad=${l.badFires === null ? 'n/a' : l.badFires ? 'FIRES' : 'silent'} good=${l.goodSilent === null ? 'n/a' : l.goodSilent ? 'silent' : 'FIRES'}${l.reason ? ` (${l.reason})` : ''}`,
      )
      .join(' | ');
    const fid =
      row.fidelity === null
        ? 'fidelity: n/a'
        : row.fidelity.unexpected.length > 0
          ? `fidelity: UNEXPECTED ${row.fidelity.unexpected.join(',')}`
          : row.fidelity.expectedDivergence
            ? `fidelity: ${row.fidelity.expectedDivergence} (expected)`
            : 'fidelity: identical';
    const lop =
      row.legacyOverPair0 === null
        ? ''
        : row.legacyOverPair0.badFires === null
          ? ` · legacy/pair0: n/a (${row.legacyOverPair0.reason})`
          : ` · legacy/pair0: bad=${row.legacyOverPair0.badFires ? 'FIRES' : 'silent'} good=${row.legacyOverPair0.goodSilent ? 'silent' : 'FIRES'}`;
    const fs =
      row.firingSet === null
        ? ''
        : ` · firings legacy=${row.firingSet.legacy} record=${row.firingSet.record}${names.length > 1 ? ' (this language; delta at the entry union)' : ''}`;
    lines.push(
      `    ${name} [${grammar}] validate=${measuredValidate}${measuredValidate === decl.expect.validate ? '' : ` (EXPECTED ${decl.expect.validate})`} · ${recordVerdict}: ${legs} · ${fid}${lop}${fs}`,
    );
    if (row.validate.reason && measuredValidate !== 'compiled')
      lines.push(`      reason (verbatim): ${row.validate.reason}`);
    entryRows.push(row);
  }
  // The entry-level firing-set delta (the union over the set's records vs the legacy row).
  if (treeFiles !== null) {
    const added = [...entryRecordFirings].filter((x) => !entryLegacyFirings.has(x)).sort();
    const removed = [...entryLegacyFirings].filter((x) => !entryRecordFirings.has(x)).sort();
    for (const row of entryRows) {
      if (row.firingSet === null) continue;
      row.firingSet.added = added;
      row.firingSet.removed = removed;
    }
  }
  for (const row of entryRows) {
    const shapeErrors = rowShapeErrors(row);
    if (shapeErrors.length > 0) {
      harnessThrows += 1;
      console.log(
        `    [SHAPE] ${row.recordPath}: per-record row fails the pre-registered field set — ${shapeErrors.join(', ')}`,
      );
    }
    outLines.push(JSON.stringify(row));
  }
  splitCounts[entryVerdict] += 1;
  if (entryVerdict !== decl.expect.differential) differentialMismatches += 1;
  if (entryFidelity === 'identical') fidelityEntries.identical += 1;
  else if (entryFidelity === 'expected-divergent') fidelityEntries.expectedDivergent += 1;
  else fidelityEntries.unexpected += 1;
  classified.push({
    entry: e.entry,
    lessonHash: e.lessonHash,
    verdict: entryVerdict,
    expected: decl.expect.differential,
  });
  const union =
    treeFiles === null
      ? ''
      : `  firing-set union: legacy=${entryLegacyFirings.size} record=${entryRecordFirings.size} added=${[...entryRecordFirings].filter((x) => !entryLegacyFirings.has(x)).length} removed=${[...entryLegacyFirings].filter((x) => !entryRecordFirings.has(x)).length}`;
  console.log(
    `${String(e.entry).padStart(2)}. ${e.lessonHash}${e.rank !== undefined ? ` (rank ${e.rank})` : ''}  ${entryVerdict}${entryVerdict === decl.expect.differential ? '' : `  (EXPECTED ${decl.expect.differential})`}${names.length > 1 ? `  (${names.length} records)` : ''}${union}`,
  );
  for (const l of lines) console.log(l);
}

// ── summaries ────────────────────────────────────────────────────────────────
const recordTotal = validateCounts.parsed + validateCounts.failed;
console.log(
  `\nValidate: ${recordTotal} record(s) — parsed ${validateCounts.parsed}, compiled ${validateCounts.compiled}, lowering-rejected ${validateCounts.rejected}, harness failures ${validateCounts.failed}; expectation mismatches ${validateMismatches}`,
);
console.log(
  `Fidelity (records): ${fidelity.identical}/${fidelity.records} identical, ${fidelity.expectedDivergent} expected divergence(s), ${fidelity.unexpected} UNEXPECTED`,
);
console.log(
  `Fidelity (entries): ${fidelityEntries.identical}/${entries.length} identical, ${fidelityEntries.expectedDivergent} expected divergence(s), ${fidelityEntries.unexpected} UNEXPECTED`,
);
console.log('Differential split (measured, per entry):');
for (const [verdict, count] of Object.entries(splitCounts)) {
  const list = classified
    .filter((r) => r.verdict === verdict)
    .map((r) => r.entry)
    .join(', ');
  console.log(`  ${verdict.padEnd(24)} ${count}${list ? `  (entries ${list})` : ''}`);
}
console.log(`Differential expectation mismatches: ${differentialMismatches}`);

// ── R14 mode: EXPECTED_COUNTS + the dead-matcher probe (verbatim from r14-differential.mjs) ──
let r14Ok = true;
if (R14_MODE) {
  const EXPECTED_COUNTS = { [SATISFIED]: 15, [GOOD_FIRES]: 3, [BAD_SILENT]: 1, [NOT_EVALUABLE]: 1 };
  const mismatches = Object.entries(EXPECTED_COUNTS).filter(([v, n]) => splitCounts[v] !== n);
  const DEAD_PATTERN = '{ $$$BEFORE, stdio: $VAL, $$$AFTER }';
  const PROBE_CANDIDATES = [
    "const out = execSync(cmd, { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' });",
    "const opts = { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' };",
    "({ cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' })",
    "const opts = { stdio: 'pipe', encoding: 'utf8' };",
    "const opts = { cwd: repoRoot, stdio: 'pipe' };",
    "const opts = { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8', shell: true };",
    "const opts = { a: 1, stdio: 'pipe', b: 2 };",
  ];
  const CONTROL_SUBJECT = "const opts = { cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' };";
  const PROBE_CONTROLS = [
    { pattern: 'const $X = { $$$BEFORE, stdio: $VAL, $$$AFTER }', expect: 1 },
    { pattern: "{ cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' }", expect: 1 },
  ];
  console.log('\nDead-matcher probe — seed entry 17 (d940b2c9ffe92e99)');
  console.log(`Pattern under test: ${DEAD_PATTERN}`);
  let probeHits = 0;
  for (const snippet of PROBE_CANDIDATES) {
    const hits = matchAstGrepPattern(snippet, '.ts', DEAD_PATTERN, allLines(snippet)).length;
    probeHits += hits;
    console.log(`  hits=${hits}  ${JSON.stringify(snippet)}`);
  }
  console.log(
    `  candidates: ${PROBE_CANDIDATES.length}, total hits: ${probeHits} (a dead matcher scores 0)`,
  );
  let controlsHeld = true;
  for (const control of PROBE_CONTROLS) {
    const hits = matchAstGrepPattern(
      CONTROL_SUBJECT,
      '.ts',
      control.pattern,
      allLines(CONTROL_SUBJECT),
    ).length;
    if (hits !== control.expect) controlsHeld = false;
    console.log(
      `    hits=${hits} (expected ${control.expect})  pattern: ${JSON.stringify(control.pattern)}`,
    );
  }
  console.log('\nK3 replay check against R14’s recorded verdict:');
  if (mismatches.length === 0 && controlsHeld && probeHits === 0) {
    console.log('  REPRODUCED — differential split and dead-matcher probe match the notes.');
  } else {
    r14Ok = false;
    for (const [v, n] of mismatches)
      console.log(`  DIVERGED — ${v}: measured ${splitCounts[v]}, notes record ${n}`);
    if (probeHits !== 0)
      console.log(`  DIVERGED — dead-matcher probe scored ${probeHits} hits, notes record 0`);
    if (!controlsHeld) console.log('  DIVERGED — a probe control did not hold');
  }
}

if (OUT !== undefined) {
  writeFileSync(OUT, outLines.join('\n') + '\n', { encoding: 'utf8' });
  console.log(`\nper-record output: ${outLines.length} line(s) → ${OUT} (schema ${SCHEMA})`);
}

const ok =
  validateMismatches === 0 &&
  harnessThrows === 0 &&
  fidelity.unexpected === 0 &&
  differentialMismatches === 0 &&
  r14Ok;
console.log(
  `\nVerdict: ${ok ? 'PASS (exit 0)' : 'FAIL (exit 1)'} — validate mismatches ${validateMismatches}, harness throws ${harnessThrows}, unexpected fidelity ${fidelity.unexpected}, differential mismatches ${differentialMismatches}${R14_MODE ? `, K3 ${r14Ok ? 'reproduced' : 'diverged'}` : ''}`,
);
process.exit(ok ? 0 : 1);
