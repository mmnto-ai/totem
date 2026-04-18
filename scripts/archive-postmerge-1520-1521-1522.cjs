#!/usr/bin/env node
/**
 * Archive the 9 compiled rules produced by the 2026-04-17 postmerge on
 * PRs #1520, #1521, #1522. Every one of them reflects meta-advice about
 * rule-authoring practices extracted from the bot-review cycles on the
 * security pack PRs, rather than an enforceable lint pattern on consumer
 * code. The compile worker saw authorial guidance ("include net.Socket
 * in exfil rules") and produced enforcement patterns ("every new net.Socket
 * is a violation"), which is the wrong shape — the lesson value lives in
 * the lesson body, not in an active rule.
 *
 * Match by lessonHash (headings auto-truncate and are not unique). See
 * scripts/archive-bad-postmerge-rules.cjs from #1366 for the canonical
 * shape this follows.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');

const RULES_PATH = path.resolve(__dirname, '..', '.totem', 'compiled-rules.json');

const archives = [
  {
    hash: '523b9893cb454e70',
    reason:
      'Pattern matches the literal regex-author text for a boundary anchor in source/docs — meta-advice to rule authors, not an enforcement rule on consumer code. Would fire on strategy docs, compiler corpus, and any regex authoring discussion without identifying a real defect.',
  },
  {
    hash: '4c219e8ad6230689',
    reason:
      'Pattern fires on every legitimate net.Socket construction. The source lesson is authorial guidance about what to include when writing exfil detection rules — it is not a signal that consumer code using net.Socket is suspicious.',
  },
  {
    hash: 'a37823bcf1e849b5',
    reason:
      'Pattern matches every catch_clause without a throw_statement. The source lesson targets walkDir-specific error handling, but the compiled rule fires on all empty or non-rethrowing catches across the codebase. Overlaps with the existing empty-catch detection shipped in 1.13.0 (#664).',
  },
  {
    hash: 'ec8e329a673cf601',
    reason:
      'Pattern fires on every reference to the Function constructor, including legitimate type references and re-exports. The pack-agent-security rule a0b737fd43fb943e already covers dynamic code-eval constructors with proper context gating (literal-string filter, unconditional fire on Function/vm primitives).',
  },
  {
    hash: 'a24ec7272f1f670e',
    reason:
      'Pattern fires globally on any occurrence of currentBranch with a string literal value. The source lesson is about test-fixture null-handling for detached-HEAD coverage, but the rule has no way to scope to tests only and would over-fire on production git-state code.',
  },
  {
    hash: '5a746a435d763ca6',
    reason:
      'Pattern matches a broad exclude glob literally. The source lesson recommends preferring more explicit forms, which is authorial guidance — the compiled rule would flag legitimate uses of the broader glob across unrelated config files without identifying a real defect.',
  },
  {
    hash: 'c0f652d54da5bed0',
    reason:
      'Pattern duplicates the dynamic-code-evaluation coverage in pack-agent-security rule a0b737fd43fb943e, which handles the same non-literal-argument case via its own constraint. Retaining both would double-fire on the same site.',
  },
  {
    hash: 'fc2d6c1f6e298d28',
    reason:
      'Pattern duplicates the semantic of 4c219e8ad6230689 (same lesson extracted twice with slightly different patterns). Same over-fire concern: flags every legitimate net.Socket construction.',
  },
  {
    hash: 'de7ee11b427d201e',
    reason:
      'Pattern is a single-quote-only variant of a24ec7272f1f670e. Same over-fire concern across production code; same authorial-guidance scope mismatch.',
  },
  {
    hash: 'aeb65ba1a27ec781',
    reason:
      'Pattern fires on any YAML snippet containing `has:` with `pattern:`, which is the standard ast-grep rule-definition syntax. Would flag every shipped rule spec in .totem/compiled-rules.json, .totem/lessons/, strategy docs, and every ast-grep rule authored downstream. Pure authorial guidance, not enforcement.',
  },
];

const raw = fs.readFileSync(RULES_PATH, 'utf8');
const manifest = JSON.parse(raw);

let archived = 0;
const missing = [];
for (const { hash, reason } of archives) {
  const rule = manifest.rules.find((r) => r.lessonHash === hash);
  if (!rule) {
    missing.push(hash);
    continue;
  }
  if (rule.status === 'archived') {
    // Already archived — skip to keep archival idempotent.
    continue;
  }
  rule.status = 'archived';
  rule.archivedAt = new Date().toISOString();
  rule.archivedReason = reason;
  archived += 1;
}

if (missing.length > 0) {
  console.error('Hashes not found in compiled-rules.json:', missing);
  process.exit(1);
}

fs.writeFileSync(RULES_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Archived ${archived} rules in ${RULES_PATH}`);
