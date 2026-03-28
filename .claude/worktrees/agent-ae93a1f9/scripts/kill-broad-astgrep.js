#!/usr/bin/env node
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('.totem/compiled-rules.json', 'utf-8'));
const nonCompSet = new Set(data.nonCompilable || []);
const before = data.rules.length;

const astGrep = data.rules.filter((r) => r.engine === 'ast-grep');

// Kill by heading substring — Gemini's red list
const killHeadings = [
  'When timing out a child process',
  'When normalizing diverse SDK errors',
  'Avoid refactoring synchronous factory',
  'Ollama num_ctx',
  'Always iterate through all regex matches',
  'Include a space or delimiter when concatenating',
  'Iterative string replacements',
  'Using child.kill',
  'Using [val].flat',
  'Avoid using partial matchers',
];

const killHashes = [];
for (const r of astGrep) {
  if (killHeadings.some((h) => (r.lessonHeading || '').includes(h))) {
    killHashes.push(r.lessonHash);
  }
}

console.log(`Kill list: ${killHashes.length} rules`);

data.rules = data.rules.filter((r) => {
  if (killHashes.includes(r.lessonHash)) {
    nonCompSet.add(r.lessonHash);
    console.log(`  KILLED: ${(r.lessonHeading || '').slice(0, 60)}`);
    return false;
  }
  return true;
});

// Narrow: verify scoping on the 4 yellow rules
const narrowChecks = {
  // #13 import($PATH) — must exclude commands/
  a1fd35ee696110b0: ['packages/cli/src/**/*.ts', '!packages/cli/src/commands/**', '!**/*.test.ts'],
  // #20 console.$METHOD — must be core only
  a5da42b79e964510: ['packages/core/**/*.ts', '!**/*.test.ts'],
  // #21 import from @mmnto/totem — CLI commands only
  // Already scoped: ["packages/cli/**/*.ts","!**/*.test.ts"] — narrow to commands
};

// Check and fix scoping
for (const r of data.rules) {
  if (narrowChecks[r.lessonHash]) {
    const oldGlobs = JSON.stringify(r.fileGlobs);
    r.fileGlobs = narrowChecks[r.lessonHash];
    console.log(`  NARROWED: ${(r.lessonHeading || '').slice(0, 50)}`);
    console.log(`    Old: ${oldGlobs}`);
    console.log(`    New: ${JSON.stringify(r.fileGlobs)}`);
  }
}

data.nonCompilable = [...nonCompSet];
fs.writeFileSync('.totem/compiled-rules.json', JSON.stringify(data, null, 2) + '\n');
console.log(`\n${before} -> ${data.rules.length} rules`);
