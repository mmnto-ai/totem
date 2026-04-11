// One-off mutation script for the 2026-04-11 postmerge cycle.
//
// Marks 4 auto-compiled rules as archived via the status+archivedReason
// fields. All 4 were flagged as over-broad or hallucinated during
// post-compile human review. Preserves them in the ledger so telemetry
// and prompt-regression analysis can inspect the LLM's failure modes
// when the compile worker prompt gets rewritten.
//
// Rule 2 of the 5 newly compiled (shell:true spawn tripwire) is left
// active because it encodes the mmnto/totem#1329 security concern as
// a durable guard. Its pattern is narrow (mmnto/totem#1368 tracks
// broadening it), but narrow-and-live is still better than absent.
//
// Run: node scripts/archive-bad-postmerge-rules.cjs
//
// Safe to re-run: looks up rules by lessonHash (the stable unique
// identifier), skips any already archived, and fails loud with a
// non-zero exit code if a target hash is not found in the rules
// file. After running, re-run `totem lesson compile --export` to
// regenerate the manifest hash and the copilot/junie exports from
// the mutated rules file.
//
// IMPORTANT: This script uses `lessonHash` for lookups, not
// `lessonHeading`. Lesson headings are auto-truncated to ≤60 chars
// by the compile worker and collide semantically across extracted
// lessons (known tooling gap). Only `lessonHash` is guaranteed
// unique. The `lessonHeading` field on each target entry below is
// purely documentation for humans reading the script.

const fs = require('node:fs');
const path = require('node:path');

const RULES_FILE = path.join(__dirname, '..', '.totem', 'compiled-rules.json');

const ARCHIVE_TARGETS = [
  {
    lessonHash: '48f755d9a388e87f',
    lessonHeading: 'Prefer regex over split for line extraction',
    archivedReason:
      "Over-broad astGrepPattern `$STR.split('\\n')[0]` fires on any legitimate first-line extraction idiom. The underlying lesson was accurate (prefer regex for error-message parsing where the string may contain dots/newlines), but the rule as compiled does not encode that context. This is exactly the class of rule mmnto/totem#1352 was filed to archive yesterday. Auto-compiled on the 2026-04-11 PM postmerge (1.14.3/1.14.4/1.14.5 cycle). Archived via the mmnto/totem#1345 filter. Kept in the ledger so the compile worker prompt rewrite can use it as a negative training example.",
  },
  {
    lessonHash: '0d0bbae4392c0255',
    lessonHeading: 'Lazy-load core libraries in CLI commands',
    archivedReason:
      'Hallucinated package name. Pattern references `@mcp-b/core`, which does not exist in this repository (the canonical core package is `@mmnto/totem`). Rule would never fire on any real code in the repo. Auto-compiled on the 2026-04-11 PM postmerge. Archived via the mmnto/totem#1345 filter. Kept in the ledger as a LLM hallucination data point: the compile worker drifted to a fabricated package name despite the source lesson referencing the correct `@mmnto/totem` import. Feeds the `quality > quantity` empirical record referenced in the Sonnet 4.6 routing analysis (Strategy #73).',
  },
  {
    lessonHash: 'eb59a093e36afaf2',
    lessonHeading: 'Consolidate dynamic imports in CLI handlers',
    archivedReason:
      'Pattern `const { $VAR } = await import($MODULE)` matches every dynamic import in the CLI package, not just cases where multiple dynamic imports could be consolidated. The underlying lesson was about consolidating multiple dynamic-import destructures into a single call, but the rule does not encode the multiplicity condition. Would produce thousands of false positives on every CLI command file. Auto-compiled on the 2026-04-11 PM postmerge. Archived via the mmnto/totem#1345 filter. Kept in the ledger as an example of the compile worker producing a syntactically valid but semantically broken generalization.',
  },
  {
    lessonHash: '3c4931d9071af448',
    lessonHeading: 'Never split error messages on periods',
    archivedReason:
      "Pattern `$STR.split('.')` fires on all dot splits: filename extension parsing (`filename.split('.')`), semantic version parsing (`'1.14.5'.split('.')`), dot-notation handling, and any arbitrary string manipulation with `.`. The underlying lesson was specific to splitting error messages containing code patterns with dots (the regression fixed in mmnto/totem#1349), but the rule is indiscriminate. Auto-compiled on the 2026-04-11 PM postmerge. Archived via the mmnto/totem#1345 filter. Kept in the ledger as the canonical example of 'the rule should have been narrower than the pattern the LLM chose'.",
  },
];

function main() {
  const raw = fs.readFileSync(RULES_FILE, 'utf-8');
  const parsed = JSON.parse(raw);

  // Build a lookup map from lessonHash to rule. Detect any collisions
  // up front so a duplicate hash does not silently swallow a mutation.
  const byHash = new Map();
  for (const rule of parsed.rules) {
    if (byHash.has(rule.lessonHash)) {
      console.error(
        `COLLISION: duplicate lessonHash ${rule.lessonHash} in compiled-rules.json. Aborting.`,
      );
      console.error(`  First:  "${byHash.get(rule.lessonHash).lessonHeading}"`);
      console.error(`  Second: "${rule.lessonHeading}"`);
      process.exit(1);
    }
    byHash.set(rule.lessonHash, rule);
  }

  let mutated = 0;
  let alreadyArchived = 0;
  const notFound = [];

  for (const target of ARCHIVE_TARGETS) {
    const rule = byHash.get(target.lessonHash);
    if (!rule) {
      notFound.push(target);
      continue;
    }
    if (rule.status === 'archived') {
      console.log(`SKIP (already archived): ${target.lessonHash} "${target.lessonHeading}"`);
      alreadyArchived++;
      continue;
    }
    // Sanity-check: if the heading in the rules file no longer matches
    // the heading on the target entry, the compile worker may have
    // re-titled the rule. The mutation is still correct (hash is
    // stable) but log the divergence so a human can verify intent.
    if (rule.lessonHeading !== target.lessonHeading) {
      console.warn(
        `  HEADING DRIFT: target "${target.lessonHeading}" ≠ rule "${rule.lessonHeading}" (hash ${target.lessonHash})`,
      );
    }
    rule.status = 'archived';
    rule.archivedReason = target.archivedReason;
    console.log(`ARCHIVED: ${target.lessonHash} "${target.lessonHeading}"`);
    mutated++;
  }

  if (notFound.length > 0) {
    console.error('');
    console.error(`ERROR: ${notFound.length} target hash(es) not found in rules file:`);
    for (const target of notFound) {
      console.error(`  - ${target.lessonHash} ("${target.lessonHeading}")`);
    }
    console.error(
      'Aborting write. Verify ARCHIVE_TARGETS against the current compiled-rules.json.',
    );
    process.exit(1);
  }

  if (mutated === 0) {
    console.log('\nNo changes. All targets already archived.');
    return;
  }

  // Preserve the existing formatting: 2-space indent with trailing newline
  // to match what `totem lesson compile` writes. Any drift here will make
  // the pre-commit formatter re-touch the file.
  fs.writeFileSync(RULES_FILE, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
  console.log(`\nSUCCESS: ${mutated} rule(s) archived, ${alreadyArchived} already archived.`);
  console.log('\nNext steps:');
  console.log('  1. Run `pnpm exec totem lesson compile --export` to refresh manifest + exports');
  console.log('  2. Verify `git diff .totem/compiled-rules.json` shows the expected archives');
  console.log('  3. Stage + commit');
}

main();
