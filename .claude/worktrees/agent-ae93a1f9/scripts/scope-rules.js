#!/usr/bin/env node
/**
 * Phase 4: Kill bad patterns, narrow bad scoping.
 * Run: node scripts/scope-rules.js
 */
const fs = require('fs');

const RULES_PATH = '.totem/compiled-rules.json';
const data = JSON.parse(fs.readFileSync(RULES_PATH, 'utf-8'));
const nonCompSet = new Set(data.nonCompilable || []);
let killed = 0;
let scoped = 0;

// ─── Category 2: Kill bad patterns (mark non-compilable) ───

const killHashes = [
  // "Swallowing errors" — matches all console.log, intent was empty catch blocks
  'ff50cadc6e05631c',
  '5b9058bd289a1dbb',
  // "Trailing slashes" — pattern too generic
  '1a6aacfb227f5afa',
];

data.rules = data.rules.filter((r) => {
  if (killHashes.includes(r.lessonHash)) {
    nonCompSet.add(r.lessonHash);
    killed++;
    console.log(`KILLED: ${(r.lessonHeading || '').slice(0, 60)}`);
    console.log(`  Reason: Pattern too broad for structural intent`);
    return false;
  }
  return true;
});

// ─── Category 3: Fix bad scoping ───

const scopeFixes = {
  // execFileSync shell:true rules — only applies to git.ts where we call git
  '94936169ab6f8d32': ['packages/cli/src/git.ts'],
  e66544fffe1bbab8: ['packages/cli/src/git.ts'],
  e2269aee2505521c: ['packages/cli/src/git.ts'],
  // CLI action try/catch — only index.ts
  '411562e8bdcec9a2': ['packages/cli/src/index.ts'],
  // GCA import revert — CLI commands only
  '1408ec626c931051': ['packages/cli/src/commands/**/*.ts', '!**/*.test.ts'],
  // .git/hooks detection — install-hooks only
  b2c7f68af90dfeae: ['packages/cli/src/commands/install-hooks.ts'],
};

for (const rule of data.rules) {
  if (scopeFixes[rule.lessonHash]) {
    rule.fileGlobs = scopeFixes[rule.lessonHash];
    scoped++;
    console.log(`SCOPED: ${(rule.lessonHeading || '').slice(0, 60)}`);
    console.log(`  → ${JSON.stringify(rule.fileGlobs)}`);
  }
}

// ─── Save ───

data.nonCompilable = [...nonCompSet];
fs.writeFileSync(RULES_PATH, JSON.stringify(data, null, 2) + '\n');
console.log(`\nKilled ${killed}, scoped ${scoped}. ${data.rules.length} rules remaining.`);
