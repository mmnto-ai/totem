#!/usr/bin/env node
/**
 * Phase 4 round 2: Kill duplicates, scope remaining noisy rules.
 */
const fs = require('fs');

const RULES_PATH = '.totem/compiled-rules.json';
const data = JSON.parse(fs.readFileSync(RULES_PATH, 'utf-8'));
const nonCompSet = new Set(data.nonCompilable || []);
let killed = 0;
let scoped = 0;

// ─── Kill: duplicates + bad patterns ───

const killHashes = [
  '5d34d2d1c2262add', // Duplicate RegExp escape rule (keep 342d)
  'cbb308940a59e34a', // Duplicate "new Error" rule (keep cdc8)
  '16d10e42d757de78', // Duplicate hook manager detection (keep 06f8)
  'a8ade9d9b017f7b3', // Duplicate git sanitize (keep 4688)
  'd8e71d6900e46d8c', // "Zod import → type literals" too broad
  '1c4b3232555e41c8', // Case-insensitive XML regex — too obscure
];

data.rules = data.rules.filter((r) => {
  if (killHashes.includes(r.lessonHash)) {
    nonCompSet.add(r.lessonHash);
    killed++;
    console.log(`KILLED: ${(r.lessonHeading || '').slice(0, 60)}`);
    return false;
  }
  return true;
});

// ─── Scope: narrow remaining noisy rules ───

const scopeFixes = {
  // child.kill() → orchestrators only
  '4c53a4cd45410edf': ['packages/cli/src/orchestrators/**/*.ts', '!**/*.test.ts'],
  // RegExp escape → core only (where we construct regexes)
  '342da7b7572c73b6': ['packages/core/**/*.ts', '!**/*.test.ts'],
  // Wrap user-controlled fields → extract/shield (prompt assembly)
  '4fab6d3fd93f1a87': [
    'packages/cli/src/commands/extract.ts',
    'packages/cli/src/commands/shield.ts',
    'packages/cli/src/commands/spec.ts',
  ],
  // Gemini CLI reference → gemini config only
  '2d3ac4b9516ed9b6': ['.gemini/**'],
  // Sanitize git metadata → git.ts
  '468830cbb3cf0e71': ['packages/cli/src/git.ts'],
  // MCP fields optional → mcp package
  fe49bb51fe20e80b: ['packages/mcp/**/*.ts', '!**/*.test.ts'],
  // Detect hook managers → install-hooks
  '06f8480a32a4a1d0': ['packages/cli/src/commands/install-hooks.ts'],
  // Anchor command validation → hooks
  '72faae2c99fddc2c': ['.claude/hooks/**', 'packages/cli/src/commands/install-hooks.ts'],
  // Resolve git root → git.ts
  d245b21395563e6f: ['packages/cli/src/git.ts'],
  // Concat delimiter rule (error) → narrow to string builders
  '3629f9e09986b8f4': [
    'packages/cli/src/utils.ts',
    'packages/core/src/sanitize.ts',
    'packages/core/src/sarif.ts',
  ],
};

for (const rule of data.rules) {
  if (scopeFixes[rule.lessonHash]) {
    rule.fileGlobs = scopeFixes[rule.lessonHash];
    scoped++;
    console.log(`SCOPED: ${(rule.lessonHeading || '').slice(0, 60)}`);
    console.log(`  → ${JSON.stringify(rule.fileGlobs)}`);
  }
}

data.nonCompilable = [...nonCompSet];
fs.writeFileSync(RULES_PATH, JSON.stringify(data, null, 2) + '\n');
console.log(`\nKilled ${killed}, scoped ${scoped}. ${data.rules.length} rules remaining.`);
