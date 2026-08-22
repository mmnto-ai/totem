#!/usr/bin/env node
// R14 trial (Prop 310 § Design 15 step 3/4) — the DIFFERENTIAL harness.
//
// `r14-validate.mjs` answers "does the record parse and lower?". This script
// answers the other half the notes assert: **does each record's `examples.bad`
// actually fire, and does its `examples.good` actually stay silent?** Those are
// measured claims in `.totem/rules/r14-translation-notes.md`, they are
// load-bearing trial evidence, and evidence that cannot be replayed is an
// assertion. Hence this file.
//
// REPLAYABILITY. The script runs from repo state ALONE: the repo root is derived
// from `import.meta.url`, matchers come from the built `packages/core/dist`, and
// nothing reads a path outside the tree. The one external artifact — the frozen
// seed-20 JSON — is OPTIONAL and gated behind `--seed <path>`; without it the
// differential and probe legs still run in full.
//
// DETERMINISM. No clock, no randomness, no network, no filesystem writes. Inputs
// are the committed record files plus the fixed snippets below; the same tree
// always yields the same output, byte for byte.
//
// MATCHER FIDELITY. The differential uses the SHIPPED matchers the way the
// runtime uses them, not a re-implementation:
//   - regex   → `new RegExp(rule.pattern)` evaluated PER LINE, mirroring
//               `rule-engine.ts:659`; `requires` suppression applies the
//               § Design 8 rule at the compiled scope.
//   - ast-grep → `matchAstGrepPattern(content, '.ts', payload, allLines)`.
//
// EXIT CODE. This is a replay check, not a gate on the records: it exits 0 when
// the measured results MATCH the recorded expectations below, and 1 when they
// diverge — a divergence means the world moved (engine upgrade, record edit) and
// the notes' measured claims need re-deriving, which is exactly the signal a
// replayable artifact exists to give. Measured values are printed before any
// comparison, so a reader sees the measurement rather than only a verdict.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const RULES_DIR = path.join(REPO_ROOT, '.totem', 'rules');
const CORE_DIST = path.join(REPO_ROOT, 'packages', 'core', 'dist', 'index.js');

const toFileUrl = (p) => (path.sep === '\\' ? `file:///${p.replace(/\\/g, '/')}` : `file://${p}`);
const { parseRuleRecord, compileRuleRecord, matchAstGrepPattern } = await import(
  toFileUrl(CORE_DIST)
);

/** Synthetic, harness-only — identity is producer-owned (§ Design 3 / R17). */
const SYNTHETIC_RULE_ID = '0123456789abcdef';
const FIXED_NOW = '2026-08-22T00:00:00.000Z';

// The frozen seed-20 draw order. This is the ORDER only — not the seed's
// content — and it is the same 1..20 numbering the translation notes publish, so
// this script's output maps one-to-one onto the notes' per-rule entries. Also an
// integrity check: a missing or extra record file fails the run loud.
const SEED_ORDER = [
  'd5faa14cbb8b50fb',
  'aa7a588d48e74503',
  '87aff037d7de47a7',
  '0e01112d5f18ffde',
  '54140f59be3e6e44',
  '6b1890e2dbda3331',
  '5b85fe53468964e1',
  '6467c35159c1504d',
  '65ede9bfdf6995fe',
  'b973609688ec2888',
  '6b2b62eb1e8693fc',
  '1a7080ebf6162de3',
  '5da43ea60b66e96e',
  'be74c55caa9fd60c',
  'b237bcf3b52381b1',
  '49dd9e4fd02d692b',
  'd940b2c9ffe92e99',
  '71935fe9a742137b',
  '0167a783f75b5ecd',
  '89184bb5fd960848',
];

/** The four differential outcomes § Design 15 step 4 can produce over a record. */
const SATISFIED = 'differential-satisfied';
const GOOD_FIRES = 'good-also-fires';
const BAD_SILENT = 'bad-does-not-fire';
const NOT_EVALUABLE = 'not-evaluable';

// Recorded expectations — the verdict the translation notes carry. Compared
// against the measurement at the end; divergence exits 1.
const EXPECTED_COUNTS = {
  [SATISFIED]: 15,
  [GOOD_FIRES]: 3,
  [BAD_SILENT]: 1,
  [NOT_EVALUABLE]: 1,
};

const allLines = (text) => text.split('\n').map((_, i) => i + 1);

/**
 * Does `rule` fire anywhere in `text`? Mirrors the shipped runtime per engine.
 * ast-grep records in this seed all declare `language: typescript`, so `.ts` is
 * the correct dispatch extension for every one of them.
 */
function fires(rule, text) {
  if (rule.engine === 'regex') {
    const re = new RegExp(rule.pattern);
    const hits = text.split('\n').filter((line) => re.test(line));
    if (hits.length === 0) return false;
    if (rule.requires === undefined) return true;
    // § Design 8 — a match survives only where the REQUIRED context is absent.
    const requirement = new RegExp(rule.requires.pattern);
    if (rule.requires.scope === 'line') {
      return hits.some((line) => !requirement.test(line));
    }
    return !requirement.test(text);
  }
  const payload = rule.astGrepYamlRule !== undefined ? rule.astGrepYamlRule : rule.astGrepPattern;
  return matchAstGrepPattern(text, '.ts', payload, allLines(text)).length > 0;
}

// ── Leg 1: the per-record differential ───────────────────────────────────────

const files = readdirSync(RULES_DIR).filter((name) => name.endsWith('.rule.yaml'));
const byHashPrefix = new Map(files.map((name) => [name.slice(4, 12), name]));

if (files.length !== SEED_ORDER.length) {
  console.error(
    `[Totem Error] r14-differential: found ${files.length} record file(s) but the frozen seed draw is ${SEED_ORDER.length} — the evidence set and the record set must agree.`,
  );
  process.exit(1);
}

const counts = {
  [SATISFIED]: 0,
  [GOOD_FIRES]: 0,
  [BAD_SILENT]: 0,
  [NOT_EVALUABLE]: 0,
};
const classified = [];

console.log(`R14 differential harness — ${SEED_ORDER.length} record(s), seed order\n`);

for (let i = 0; i < SEED_ORDER.length; i += 1) {
  const hash = SEED_ORDER[i];
  const entry = i + 1;
  const name = byHashPrefix.get(hash.slice(0, 8));
  if (name === undefined) {
    console.error(
      `[Totem Error] r14-differential: no record file for seed entry ${entry} (${hash}) — expected .totem/rules/r14-${hash.slice(0, 8)}-<slug>.rule.yaml.`,
    );
    process.exit(1);
  }

  const parsed = parseRuleRecord(
    readFileSync(path.join(RULES_DIR, name), 'utf8'),
    path.posix.join('.totem/rules', name),
  );
  const outcome = compileRuleRecord(parsed, { ruleId: SYNTHETIC_RULE_ID, now: FIXED_NOW });

  let verdict;
  let detail;
  if (outcome.kind !== 'compiled') {
    verdict = NOT_EVALUABLE;
    detail = 'lowering rejected — no compiled rule to evaluate';
  } else {
    const rule = outcome.rule;
    const legs = parsed.record.examples.map((example, ordinal) => ({
      ordinal,
      bad: fires(rule, example.bad),
      good: fires(rule, example.good),
    }));
    const badSilent = legs.some((leg) => !leg.bad);
    const goodFires = legs.some((leg) => leg.good);
    verdict = badSilent ? BAD_SILENT : goodFires ? GOOD_FIRES : SATISFIED;
    detail = legs
      .map(
        (leg) =>
          `pair${leg.ordinal}: bad=${leg.bad ? 'FIRES' : 'silent'} good=${leg.good ? 'FIRES' : 'silent'}`,
      )
      .join(' | ');
  }

  counts[verdict] += 1;
  classified.push({ entry, hash, verdict });
  console.log(`${String(entry).padStart(2)}. ${hash}  ${verdict}`);
  console.log(`    ${detail}`);
}

console.log('\nDifferential split (measured):');
for (const [verdict, count] of Object.entries(counts)) {
  const entries = classified
    .filter((row) => row.verdict === verdict)
    .map((row) => row.entry)
    .join(', ');
  console.log(`  ${verdict.padEnd(24)} ${count}${entries ? `  (entries ${entries})` : ''}`);
}

// ── Leg 2: the `d940b2c9` dead-matcher probe, with controls ──────────────────
//
// The notes claim the legacy pattern `{ $$$BEFORE, stdio: $VAL, $$$AFTER }` is a
// DEAD matcher, and attribute the cause to the bare-brace-with-leading-`$$$`
// shape parsing as a statement block rather than an object literal. That is a
// causal claim, so it needs controls: candidates that SHOULD match if the
// pattern worked, plus two variants that isolate which half is at fault.

const DEAD_PATTERN = '{ $$$BEFORE, stdio: $VAL, $$$AFTER }';

/** Snippets a working `stdio`-in-options matcher would have to fire on. */
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

/**
 * Controls over ONE fixed subject. Each isolates a different suspect:
 *   - the same pattern in expression position (metavariables work?)
 *   - the same braces written literally (bare-brace object matching works?)
 * Both matching while the dead pattern does not localizes the fault to the
 * bare-brace + leading-`$$$` combination specifically.
 */
const PROBE_CONTROLS = [
  { pattern: 'const $X = { $$$BEFORE, stdio: $VAL, $$$AFTER }', expect: 1 },
  { pattern: "{ cwd: repoRoot, stdio: 'pipe', encoding: 'utf8' }", expect: 1 },
];

console.log('\n\nDead-matcher probe — seed entry 17 (d940b2c9ffe92e99)');
console.log(`Pattern under test: ${DEAD_PATTERN}\n`);

let probeHits = 0;
for (const snippet of PROBE_CANDIDATES) {
  const hits = matchAstGrepPattern(snippet, '.ts', DEAD_PATTERN, allLines(snippet)).length;
  probeHits += hits;
  console.log(`  hits=${hits}  ${JSON.stringify(snippet)}`);
}
console.log(
  `\n  candidates: ${PROBE_CANDIDATES.length}, total hits: ${probeHits} (a dead matcher scores 0)`,
);

console.log('\n  Controls, over one fixed subject:');
console.log(`  subject: ${JSON.stringify(CONTROL_SUBJECT)}`);
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

// ── Leg 3 (OPTIONAL): fidelity against the frozen seed artifact ──────────────
//
// Runs only when `--seed <path>` points at the frozen seed-20 JSON, which lives
// outside the repo. Without it the two legs above still stand on their own.

const seedFlagIndex = process.argv.indexOf('--seed');
if (seedFlagIndex !== -1) {
  const seedPath = process.argv[seedFlagIndex + 1];
  if (seedPath === undefined) {
    console.error(
      '[Totem Error] r14-differential: --seed requires a path to the frozen seed JSON.',
    );
    process.exit(1);
  }
  const seed = JSON.parse(readFileSync(seedPath, 'utf8'));
  console.log('\n\nFidelity leg — parsed record values vs the frozen seed');
  // The ONE divergence the translation intends: § Design 8's absence→`requires`
  // transformation drops the lookahead from the target pattern.
  const EXPECTED_PATTERN_DIVERGENCE = new Set(['5da43ea60b66e96e']);
  let drifts = 0;
  for (const source of seed) {
    const name = byHashPrefix.get(source.lessonHash.slice(0, 8));
    if (name === undefined) continue;
    const record = parseRuleRecord(readFileSync(path.join(RULES_DIR, name), 'utf8'), name).record;
    const issues = [];
    if (record.severity !== source.severity) issues.push('severity');
    if (record.message !== source.message) issues.push('message');
    if (source.engine === 'regex' && record.target.pattern !== source.pattern) {
      issues.push(
        EXPECTED_PATTERN_DIVERGENCE.has(source.lessonHash) ? 'pattern (EXPECTED)' : 'pattern',
      );
    }
    if (source.astGrepPattern !== undefined && record.target.pattern !== source.astGrepPattern) {
      issues.push('astGrepPattern');
    }
    if (
      source.astGrepYamlRule !== undefined &&
      JSON.stringify(record.target.rule) !== JSON.stringify(source.astGrepYamlRule.rule)
    ) {
      issues.push('rule tree');
    }
    const unexpected = issues.filter((issue) => !issue.endsWith('(EXPECTED)'));
    if (unexpected.length > 0) drifts += 1;
    console.log(
      `  ${source.lessonHash}  ${issues.length === 0 ? 'identical to seed' : issues.join(', ')}`,
    );
  }
  console.log(`\n  Unexpected divergences: ${drifts} (expected 0)`);
}

// ── Replay verdict ───────────────────────────────────────────────────────────

const mismatches = Object.entries(EXPECTED_COUNTS).filter(
  ([verdict, expected]) => counts[verdict] !== expected,
);

console.log('\n\nReplay check against the recorded verdict:');
if (mismatches.length === 0 && controlsHeld && probeHits === 0) {
  console.log('  REPRODUCED — differential split and dead-matcher probe match the notes.');
  process.exit(0);
}
for (const [verdict, expected] of mismatches) {
  console.log(`  DIVERGED — ${verdict}: measured ${counts[verdict]}, notes record ${expected}`);
}
if (probeHits !== 0) {
  console.log(`  DIVERGED — dead-matcher probe scored ${probeHits} hits, notes record 0`);
}
if (!controlsHeld) {
  console.log(
    '  DIVERGED — a probe control did not hold; the causal attribution needs re-deriving',
  );
}
console.log(
  '  The notes’ measured claims no longer reproduce at this tree — re-derive them before relying on them.',
);
process.exit(1);
