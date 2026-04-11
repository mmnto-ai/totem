// One-off mutation script for the 2026-04-11 postmerge cycle.
//
// Marks 4 auto-compiled rules as archived via the status+archivedReason
// fields. All 4 were flagged as over-broad or hallucinated during
// post-compile human review. Preserves them in the ledger so telemetry
// and prompt-regression analysis can inspect the LLM's failure modes
// when the compile worker prompt gets rewritten.
//
// Rule 2 of the 5 newly compiled (shell:true spawn tripwire) is left
// active because it encodes the #1329 security concern as a durable
// guard.
//
// Run: node scripts/archive-bad-postmerge-rules.cjs
//
// Safe to re-run: looks up rules by lessonHeading, skips any that are
// already archived. After running, re-run `totem lesson compile --export`
// to regenerate the manifest hash and the copilot/junie exports from the
// mutated rules file.

const fs = require('node:fs');
const path = require('node:path');

const RULES_FILE = path.join(__dirname, '..', '.totem', 'compiled-rules.json');

const ARCHIVE_TARGETS = [
  {
    lessonHeading: 'Prefer regex over split for line extraction',
    archivedReason:
      "Over-broad astGrepPattern `$STR.split('\\n')[0]` fires on any legitimate first-line extraction idiom. The underlying lesson was accurate (prefer regex for error-message parsing where the string may contain dots/newlines), but the rule as compiled does not encode that context. This is exactly the class of rule mmnto/totem#1352 was filed to archive yesterday. Auto-compiled on the 2026-04-11 PM postmerge (1.14.3/1.14.4/1.14.5 cycle). Archived via the mmnto/totem#1345 filter. Kept in the ledger so the compile worker prompt rewrite can use it as a negative training example.",
  },
  {
    lessonHeading: 'Lazy-load core libraries in CLI commands',
    archivedReason:
      'Hallucinated package name. Pattern references `@mcp-b/core`, which does not exist in this repository (the canonical core package is `@mmnto/totem`). Rule would never fire on any real code in the repo. Auto-compiled on the 2026-04-11 PM postmerge. Archived via the mmnto/totem#1345 filter. Kept in the ledger as a LLM hallucination data point: the compile worker drifted to a fabricated package name despite the source lesson referencing the correct `@mmnto/totem` import. Feeds the `quality > quantity` empirical record referenced in the Sonnet 4.6 routing analysis (Strategy #73).',
  },
  {
    lessonHeading: 'Consolidate dynamic imports in CLI handlers',
    archivedReason:
      'Pattern `const { $VAR } = await import($MODULE)` matches every dynamic import in the CLI package, not just cases where multiple dynamic imports could be consolidated. The underlying lesson was about consolidating multiple dynamic-import destructures into a single call, but the rule does not encode the multiplicity condition. Would produce thousands of false positives on every CLI command file. Auto-compiled on the 2026-04-11 PM postmerge. Archived via the mmnto/totem#1345 filter. Kept in the ledger as an example of the compile worker producing a syntactically valid but semantically broken generalization.',
  },
  {
    lessonHeading: 'Never split error messages on periods',
    archivedReason:
      "Pattern `$STR.split('.')` fires on all dot splits: filename extension parsing (`filename.split('.')`), semantic version parsing (`'1.14.5'.split('.')`), dot-notation handling, and any arbitrary string manipulation with `.`. The underlying lesson was specific to splitting error messages containing code patterns with dots (the regression fixed in mmnto/totem#1349), but the rule is indiscriminate. Auto-compiled on the 2026-04-11 PM postmerge. Archived via the mmnto/totem#1345 filter. Kept in the ledger as the canonical example of 'the rule should have been narrower than the pattern the LLM chose'.",
  },
];

function main() {
  const raw = fs.readFileSync(RULES_FILE, 'utf-8');
  const parsed = JSON.parse(raw);

  let mutated = 0;
  let alreadyArchived = 0;
  let notFound = 0;

  for (const target of ARCHIVE_TARGETS) {
    const rule = parsed.rules.find((r) => r.lessonHeading === target.lessonHeading);
    if (!rule) {
      console.error(`NOT FOUND: ${target.lessonHeading}`);
      notFound++;
      continue;
    }
    if (rule.status === 'archived') {
      console.log(`SKIP (already archived): ${target.lessonHeading}`);
      alreadyArchived++;
      continue;
    }
    rule.status = 'archived';
    rule.archivedReason = target.archivedReason;
    console.log(`ARCHIVED: ${target.lessonHeading} (hash: ${rule.lessonHash})`);
    mutated++;
  }

  if (mutated === 0 && notFound === 0) {
    console.log('\nNo changes. All targets already archived.');
    return;
  }

  if (notFound > 0) {
    console.error(`\nERROR: ${notFound} target(s) not found in rules file. Aborting write.`);
    process.exit(1);
  }

  // Preserve the existing formatting: 2-space indent with trailing newline
  // to match what `totem lesson compile` writes. Any drift here will make
  // the pre-commit formatter re-touch the file.
  fs.writeFileSync(RULES_FILE, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
  console.log(`\nSUCCESS: ${mutated} rule(s) archived, ${alreadyArchived} already archived.`);
  console.log('\nNext steps:');
  console.log('  1. Run `pnpm exec totem lesson compile --export` to refresh manifest + exports');
  console.log('  2. Verify `git diff .totem/compiled-rules.json` shows the 4 archives');
  console.log('  3. Stage + commit');
}

main();
