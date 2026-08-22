#!/usr/bin/env node
// R14 trial (Prop 310 § Design 15 step 3) — authoring-hygiene harness for the
// seed-20 record translations. NOT a scorer: it runs the REAL shipped parser and
// lowering over every `.totem/rules/*.rule.yaml` and prints what each record did.
//
// Contract:
//   - Every record MUST parse (`parseRuleRecord`). A parse failure is a harness
//     failure — the grammar is the authoring surface and a record that cannot be
//     read is not a translation.
//   - Lowering (`compileRuleRecord`) MAY reject. Fidelity beats compilability:
//     a faithful record whose lowering rejects is a typed-miss candidate, which
//     is trial DATA. The rejection reason is printed VERBATIM here and copied
//     verbatim into `.totem/rules/r14-translation-notes.md`.
//   - A THROW out of `compileRuleRecord` is a producer-contract violation
//     (`record-lower.ts` reserves throws for caller bugs), so it fails the run.
//
// `ruleId` is a SYNTHETIC harness value: identity is producer-owned (§ Design 3 /
// R17) and is minted at the ADR-112 intake seam, which this trial does not run.
// It is fixed and shared across records so the harness stays deterministic.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');
const RULES_DIR = path.join(REPO_ROOT, '.totem', 'rules');

const CORE_DIST = path.join(REPO_ROOT, 'packages', 'core', 'dist', 'index.js');
const { parseRuleRecord, compileRuleRecord } = await import(
  path.sep === '\\' ? `file:///${CORE_DIST.replace(/\\/g, '/')}` : `file://${CORE_DIST}`
);

/** Synthetic, harness-only — see the header note on producer-owned identity. */
const SYNTHETIC_RULE_ID = '0123456789abcdef';
const FIXED_NOW = '2026-08-22T00:00:00.000Z';

const files = readdirSync(RULES_DIR)
  .filter((name) => name.endsWith('.rule.yaml'))
  .sort();

let parsed = 0;
let compiled = 0;
let rejected = 0;
let failed = 0;

console.log(`R14 record harness — ${files.length} record(s) under .totem/rules/\n`);

for (const name of files) {
  const filePath = path.join(RULES_DIR, name);
  const content = readFileSync(filePath, 'utf8');

  let record;
  try {
    record = parseRuleRecord(content, path.posix.join('.totem/rules', name));
  } catch (err) {
    failed += 1;
    console.log(`[PARSE-FAIL] ${name}`);
    console.log(`             ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }
  parsed += 1;

  let outcome;
  try {
    outcome = compileRuleRecord(record, { ruleId: SYNTHETIC_RULE_ID, now: FIXED_NOW });
  } catch (err) {
    failed += 1;
    console.log(`[THROW] ${name}`);
    console.log(`        ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }

  if (outcome.kind === 'compiled') {
    compiled += 1;
    const r = outcome.rule;
    const scope = `${r.fileGlobs.length} glob(s)${r.excludeGlobs ? ` / ${r.excludeGlobs.length} exclude(s)` : ''}`;
    const extras = [
      r.language ? `language=${r.language}` : null,
      r.requires ? `requires(scope=${r.requires.scope})` : null,
      r.curation ? `curation=${r.curation.sourceLesson}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    console.log(`[OK]        ${name}`);
    console.log(
      `             parse=ok lower=compiled engine=${r.engine} severity=${r.severity} ${scope} examples=${r.examples.length}${extras ? ` · ${extras}` : ''}`,
    );
  } else {
    rejected += 1;
    console.log(`[REJECTED]  ${name}`);
    console.log(`             parse=ok lower=rejected`);
    console.log(`             reason (verbatim): ${outcome.reason}`);
  }
}

console.log(
  `\nSummary: ${files.length} record(s) — parsed ${parsed}, compiled ${compiled}, lowering-rejected ${rejected}, harness failures ${failed}`,
);

process.exit(failed === 0 ? 0 : 1);
