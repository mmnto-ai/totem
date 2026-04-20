#!/usr/bin/env node
/**
 * Archives the over-matching rule compiled during the 1584 + 1585 postmerge.
 *
 * Target: lessonHash 501000ab9c41230b ([Inherit stdio for startup hooks])
 *
 * Reason: The regex pattern `stdio\s*:\s*['"]pipe['"]` targets the
 * string-shorthand form (`stdio: 'pipe'`), but the defect that motivated
 * the lesson used the array form (`stdio: ['ignore', 'pipe', 'pipe']`) in
 * `init-templates.ts` and `.gemini/hooks/SessionStart.js`. The compiled
 * pattern does not match the actual bug site in either file. Even within
 * the rule's narrow fileGlobs scope, `stdio: 'pipe'` is a legitimate
 * Node.js pattern when the caller wants to capture stdout via execSync's
 * return value; flagging it with a `warning` severity would produce
 * false positives on any intentional capture call added later.
 */

const fs = require('node:fs');
const path = require('node:path');

const RULES_PATH = path.resolve(__dirname, '..', '.totem', 'compiled-rules.json');
const TARGET_HASH = '501000ab9c41230b';
const ARCHIVED_REASON =
  "Over-matching: pattern targets the string-shorthand form `stdio: 'pipe'` but the defect it was generalized from used the array form `stdio: ['ignore', 'pipe', 'pipe']`, so the regex does not match the actual bug sites in .gemini/hooks/SessionStart.js or init-templates.ts. `stdio: 'pipe'` is also a legitimate Node.js pattern when the caller wants to capture stdout via execSync's return value. The lesson is valid guidance but the structural rule form cannot express it without false positives; revisit as an astGrepYamlRule compound rule after ADR-091 Stage 4 Codebase Verifier ships.";

const raw = fs.readFileSync(RULES_PATH, 'utf8');
const data = JSON.parse(raw);

let mutated = 0;
for (const rule of data.rules) {
  if (rule.lessonHash !== TARGET_HASH) continue;
  if (rule.status === 'archived') {
    console.error(`[skip] ${TARGET_HASH} already archived`);
    continue;
  }
  rule.status = 'archived';
  rule.archivedReason = ARCHIVED_REASON;
  rule.archivedAt = new Date().toISOString();
  mutated += 1;
}

if (mutated === 0) {
  console.error(`[fail] no active rule matched lessonHash ${TARGET_HASH}`);
  process.exit(1);
}

const tmp = `${RULES_PATH}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
fs.renameSync(tmp, RULES_PATH);
console.log(`[done] archived ${mutated} rule(s) with hash ${TARGET_HASH}`);
