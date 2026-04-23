#!/usr/bin/env node
// Idempotent archive mutation for PR #1615 postmerge curation.
//
// Target: rule `8dbddb677f738249` ("Warn on non-critical hook failures").
// Compiled pattern: `throw_statement` inside `catch_clause`.
//
// Defect: the compiled pattern fires on every re-throw inside a catch block
// anywhere in packages/**/*.ts. The lesson's actual scope is post-scaffold
// hooks (git add, docs:inject) where warn-and-continue is preferred. The
// structural gap between "post-scaffold hook catch" and "any catch" is not
// captured by the pattern. Rule directly contradicts `lesson-fail-open-catch-ban`,
// which bans silent-swallow semantics for non-terminal handlers. Terminal-handler
// refinement of the fail-open ban is already tracked as #1614.

const fs = require('node:fs');
const path = require('node:path');

const RULES_PATH = path.join(__dirname, '..', '.totem', 'compiled-rules.json');

const TARGET = {
  lessonHash: '8dbddb677f738249',
  archivedReason:
    'Pattern `throw_statement` inside `catch_clause` fires on every re-throw in packages/**/*.ts, not just the post-scaffold-hook catches the lesson targets. ' +
    'Directly contradicts `lesson-fail-open-catch-ban` (bans silent-swallow semantics for non-terminal handlers). Terminal-handler refinement tracked in #1614. ' +
    'The lesson itself is valid guidance for scaffold-orchestrator code paths, but the context constraint (post-scaffold hooks only) cannot be captured structurally via ast-grep. ' +
    'Sibling class to #1598 (compile-worker context-sensitive lesson extraction gap). Archived during PR #1615 postmerge 2026-04-22.',
  archivedAt: '2026-04-23T00:14:18.341Z',
};

const manifest = JSON.parse(fs.readFileSync(RULES_PATH, 'utf8'));
const idx = manifest.rules.findIndex((r) => r.lessonHash === TARGET.lessonHash);
if (idx === -1) {
  console.error(`Rule with lessonHash ${TARGET.lessonHash} not found. Nothing to do.`);
  process.exit(0);
}

const rule = manifest.rules[idx];
if (rule.status === 'archived') {
  console.log(
    `Rule ${TARGET.lessonHash} already archived. Refreshing archivedReason + archivedAt.`,
  );
}

rule.status = 'archived';
rule.archivedReason = TARGET.archivedReason;
rule.archivedAt = TARGET.archivedAt;

fs.writeFileSync(RULES_PATH, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Archived rule ${TARGET.lessonHash} (${rule.lessonHeading}).`);
