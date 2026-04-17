// One-off mutation script for the 2026-04-16 postmerge cycle.
//
// Extract+compile run over PRs 1477, 1496, 1501, 1503, 1505, 1506 produced
// 8 newly compiled rules. Human review flagged 2 of the 8 as over-broad and
// marks them archived via the status+archivedReason fields. The remaining
// 6 are kept live. Archive filter (mmnto-ai/totem#1345) in loadCompiledRules
// silences archived rules at lint time but preserves them in the ledger for
// compile-worker prompt regression analysis.
//
// Run: node scripts/archive-bad-postmerge-rules-20260416.cjs
//
// Safe to re-run: looks up rules by lessonHash, skips any already archived,
// and fails loud with a non-zero exit code if a target hash is not found.
// After running, re-run `totem lesson compile --export` to regenerate the
// manifest hash and the copilot/junie exports from the mutated rules file.

const fs = require('node:fs');
const path = require('node:path');

const RULES_FILE = path.join(__dirname, '..', '.totem', 'compiled-rules.json');

const ARCHIVE_TARGETS = [
  {
    lessonHash: '2f09502117f56a77',
    lessonHeading: 'Prefer replacer functions over back-references',
    archivedReason:
      'Over-broad astGrepPattern `$STR.replace($PATTERN, $REPLACEMENT)` matches every two-arg `.replace()` call in `packages/core/src`, not just cases where the replacement string contains a back-reference like `$&`, `$1`, etc. The underlying lesson (from PR #1501) is accurate — prefer a replacer function when the replacement may contain special sequences — but the rule as compiled cannot encode that content-level check with a simple ast-grep pattern. Would produce many false positives on legitimate `.replace()` calls that use literal strings or already use a function replacer. Auto-compiled on the 2026-04-16 postmerge (1477/1496/1501/1503/1505/1506 cycle). Archived via the mmnto-ai/totem#1345 filter. Kept in the ledger as a compile-worker failure mode: the LLM could not distinguish the back-reference content within the replacement string and produced a generalization that covers all two-arg replace calls.',
  },
  {
    lessonHash: '9e95301d0ccc339b',
    lessonHeading: 'Restrict fallback to specific error codes',
    archivedReason:
      "Over-broad astGrepYamlRule. The `has: { pattern: 'null' }` matcher with `stopBy: end` fires on any `null` literal anywhere inside a catch clause — assignments (`result = null`), returns (`return null`), comparisons (`x !== null`), type narrowings, and casts all match. Combined with the `not: has: $ERR.code` absence check, this flags many legitimate catch blocks that use `null` for reasons unrelated to the fallback-swallow pattern the lesson (PR #1506) was trying to guard. The rule's intent — require a specific error-code check before swallowing to null — is valid, but the ast-grep encoding cannot express 'fallback-assignment to null' without additional structural constraints. Auto-compiled on the 2026-04-16 postmerge. Archived via the mmnto-ai/totem#1345 filter. Kept in the ledger as a compile-worker failure mode where a positional `has:` clause under-constrains the target.",
  },
];

function main() {
  const raw = fs.readFileSync(RULES_FILE, 'utf-8');
  const parsed = JSON.parse(raw);

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

  fs.writeFileSync(RULES_FILE, JSON.stringify(parsed, null, 2) + '\n', 'utf-8');
  console.log(`\nSUCCESS: ${mutated} rule(s) archived, ${alreadyArchived} already archived.`);
  console.log('\nNext steps:');
  console.log('  1. Run `pnpm exec totem lesson compile --export` to refresh manifest + exports');
  console.log('  2. Verify `git diff .totem/compiled-rules.json` shows the expected archives');
  console.log('  3. Stage + commit');
}

main();
