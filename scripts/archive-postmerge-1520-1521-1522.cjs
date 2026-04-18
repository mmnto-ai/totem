#!/usr/bin/env node
/**
 * Archive the 10 compiled rules produced by the 2026-04-17 postmerge on
 * PRs #1520, #1521, #1522. Every one of them reflects meta-advice about
 * rule-authoring practices extracted from the bot-review cycles on the
 * security pack PRs, rather than an enforceable lint pattern on consumer
 * code. The compile worker saw authorial guidance and produced enforcement
 * patterns, which is the wrong shape — the lesson value lives in the
 * lesson body, not in an active rule.
 *
 * Match by lessonHash (headings auto-truncate and are not unique).
 * Pre-index the rule array, fail loud on duplicate hashes, and warn when
 * a heading has drifted since this script was written. Follow-up to bot
 * review on PR #1526.
 *
 * See scripts/archive-bad-postmerge-rules.cjs from #1366 for the
 * canonical shape this follows.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs');
const path = require('node:path');

const RULES_PATH = path.resolve(__dirname, '..', '.totem', 'compiled-rules.json');

/**
 * One entry per rule to archive. `heading` is the expected value at the
 * time the script was authored; if the shipped rule's heading differs,
 * the script warns but does not fail — hashes are authoritative.
 * `reason` MUST accurately describe the defect (Gemini catch on PR #1526
 * pointed out earlier reasons blamed "production over-fire" when the
 * rules were already test-scoped via fileGlobs).
 */
const archives = [
  {
    hash: '523b9893cb454e70',
    heading: 'Use boundary-guard anchors for domain blocklists',
    reason:
      "Rule captures regex-author text as an enforcement pattern. fileGlobs are scoped to packages/pack-agent-security/test/ but the rule fires on any source line that contains the literal `(?:^|\\.)` or `(?:^|\\.)|(?:^|\\.)` regex fragment — i.e. legitimate ast-grep patterns written by the pack's own test authors. The underlying guidance (prefer `[^\\w-]` boundary guards over `(?:^|\\.)` for sibling-domain bypass prevention) is authorial advice for rule authors, not a code-defect signal for consumer code.",
  },
  {
    hash: '4c219e8ad6230689',
    heading: 'Include low-level network primitives in exfil rules',
    reason:
      'Pattern `new net.Socket($$$ARGS)` fires on every legitimate net.Socket construction. The source lesson is authorial guidance about what to include when writing exfil detection rules — it is not a signal that consumer code using net.Socket is suspicious. Proper coverage of net.Socket as an exfil surface is tracked in follow-up #1524 (aliased-namespace spawn / socket coverage).',
  },
  {
    hash: 'a37823bcf1e849b5',
    heading: 'Include path context in walkDir errors',
    reason:
      'Pattern matches every catch_clause without a throw_statement. The source lesson targets walkDir-specific error handling, but the compiled rule fires on all empty or non-rethrowing catches across the codebase. Overlaps with the existing empty-catch detection shipped in 1.13.0 (#664). Authorial guidance about a specific helper, overfit into a general pattern.',
  },
  {
    hash: 'ec8e329a673cf601',
    heading: 'Cover all dynamic evaluation constructors',
    reason:
      'Pattern fires on every reference to the Function constructor, including legitimate type references, re-exports, and test fixtures exercising the primitive. The pack-agent-security rule a0b737fd43fb943e already covers dynamic code-eval constructors with proper context gating (literal-string filter, unconditional fire on Function / vm primitives); this compiled rule duplicates that coverage with a broader, over-firing shape.',
  },
  {
    hash: 'a24ec7272f1f670e',
    heading: 'Handle detached HEAD states in tests',
    reason:
      'fileGlobs are scoped to packages/mcp/src/**/*.test.ts, but the pattern fires on every test that mocks git state with a string-literal currentBranch — which is how nearly every git-mocking test sets up its fixture. The source lesson is authorial guidance about updating test fixtures to support detached-HEAD (currentBranch: null) cases, not a defect signal on existing test-fixture construction.',
  },
  {
    hash: '5a746a435d763ca6',
    heading: 'Use explicit monorepo test globs',
    reason:
      'fileGlobs are scoped to packages/pack-agent-security/compiled-rules.json itself. The rule pattern matches the literal broad-exclude glob `"!**/test/"`, but the file already uses the explicit `packages/**/test/**` form — i.e. the rule is self-referentially scoped to the artifact it lives in and will never match. Authorial guidance misclassified as an enforcement pattern.',
  },
  {
    hash: 'c0f652d54da5bed0',
    heading: 'Prevent eval bypasses via concatenation',
    reason:
      'Pattern duplicates the dynamic-code-evaluation coverage in pack-agent-security rule a0b737fd43fb943e, which handles the same non-literal-argument case (binary_expression / template_string / identifier) via its own constraint. Retaining both would double-fire on the same site without adding signal.',
  },
  {
    hash: 'fc2d6c1f6e298d28',
    heading: 'Include low-level socket APIs in network rules',
    reason:
      'Pattern `new net.Socket()` duplicates the semantic of 4c219e8ad6230689 (same lesson extracted twice with slightly different patterns — arg-count variants of the same constructor). Same over-fire concern: flags every legitimate net.Socket construction.',
  },
  {
    hash: 'de7ee11b427d201e',
    heading: 'Allow null branches for detached HEADs',
    reason:
      'Pattern is a single-quote-only variant of a24ec7272f1f670e. Same test-scoped fileGlobs (packages/mcp/src/**/*.test.ts), same misfire on legitimate test-fixture construction, same authorial-guidance scope mismatch.',
  },
  {
    hash: 'aeb65ba1a27ec781',
    heading: 'Use field scoping for argument validation',
    reason:
      'Pattern fires on any YAML snippet containing `has:` with `pattern:`, which is the standard ast-grep rule-definition syntax. Would flag every shipped rule spec in .totem/compiled-rules.json, .totem/lessons/, strategy docs, and every ast-grep rule authored downstream. Pure authorial guidance, not enforcement.',
  },
];

const raw = fs.readFileSync(RULES_PATH, 'utf8');
const manifest = JSON.parse(raw);

// Pre-index by hash and fail loud on duplicates. Using .find() per hash
// could silently archive the wrong rule if duplicate lessonHash rows ever
// exist (CR catch on #1526).
const byHash = new Map();
const duplicateHashes = new Set();
for (const rule of manifest.rules) {
  const h = rule.lessonHash;
  if (byHash.has(h)) duplicateHashes.add(h);
  else byHash.set(h, rule);
}
if (duplicateHashes.size > 0) {
  console.error('[Totem Error] Duplicate lessonHash entries found in compiled-rules.json:', [
    ...duplicateHashes,
  ]);
  process.exit(1);
}

let updated = 0;
const missing = [];
const headingDrifts = [];
for (const { hash, heading, reason } of archives) {
  const rule = byHash.get(hash);
  if (!rule) {
    missing.push(hash);
    continue;
  }
  if (heading && rule.lessonHeading && rule.lessonHeading !== heading) {
    headingDrifts.push({ hash, expected: heading, got: rule.lessonHeading });
  }
  // Idempotent on status, but always refresh reason so script edits can
  // correct earlier inaccurate reasons without requiring a status reset.
  if (rule.status !== 'archived' || rule.archivedReason !== reason) {
    rule.status = 'archived';
    rule.archivedReason = reason;
    updated += 1;
  }
}

if (missing.length > 0) {
  console.error('[Totem Error] Hashes not found in compiled-rules.json:', missing);
  process.exit(1);
}

for (const drift of headingDrifts) {
  console.warn(`Heading drift for ${drift.hash}: expected "${drift.expected}", got "${drift.got}"`);
}

fs.writeFileSync(RULES_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Archived or refreshed ${updated} rules in ${RULES_PATH}`);
