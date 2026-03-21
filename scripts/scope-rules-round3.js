#!/usr/bin/env node
/**
 * Phase 4 round 3: Final cleanup — kill stragglers, scope remaining.
 */
const fs = require('fs');

const RULES_PATH = '.totem/compiled-rules.json';
const data = JSON.parse(fs.readFileSync(RULES_PATH, 'utf-8'));
const nonCompSet = new Set(data.nonCompilable || []);
let killed = 0;
let scoped = 0;

// ─── Kill ───

const killHashes = [
  'afda0df95f960602', // Timestamp-headed straggler
  'bd31e87e32cfeefd', // "Drift detector flags file paths" — too broad
  'f52f5615a0543837', // "Generic function names like applyRules" — useless
  '6d6d70d5a0f0fa7d', // "Restrict subagent tasks" — matches callTool/fetch generically
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

// ─── Scope ───

const scopeFixes = {
  // "Semantic constraints" rules → prompt template files only
  bc73f8d7eb600d30: [
    'packages/cli/src/commands/spec-templates.ts',
    'packages/cli/src/commands/compile-templates.ts',
    'packages/cli/src/commands/docs.ts',
  ],
  '463721b73bcacdc3': [
    'packages/cli/src/commands/spec-templates.ts',
    'packages/cli/src/commands/compile-templates.ts',
    'packages/cli/src/commands/docs.ts',
  ],
  '73517376e8d9dca5': [
    'packages/cli/src/commands/spec-templates.ts',
    'packages/cli/src/commands/compile-templates.ts',
    'packages/cli/src/commands/docs.ts',
  ],
  // "Fully qualified cache identifiers" → orchestrator config
  '1c7a70ec1752a212': ['packages/cli/src/orchestrators/**/*.ts', '!**/*.test.ts'],
  // "execSync piped stdio" → git.ts only
  bb937a42753289f1: ['packages/cli/src/git.ts'],
  // "Thrown errors must use Totem Error" → CLI commands
  d2f1385aecbf1d51: ['packages/cli/src/commands/**/*.ts', '!**/*.test.ts'],
  // "XML escaping" → MCP only (that's where formatXmlResponse lives)
  f1ff2ef77ef09ea2: ['packages/mcp/**/*.ts', '!**/*.test.ts'],
  // "Hook should run unconditionally" → hook files
  '6a08238fdff2f808': ['.claude/hooks/**', 'packages/cli/src/commands/install-hooks.ts'],
  // "Brace expansion in globs" → compiler
  '838b6ed91dd41f9b': ['packages/core/src/compiler.ts', 'packages/core/src/rule-engine.ts'],
  // "Directory glob patterns" → rule engine
  ddb842bcd2ea76d3: ['packages/core/src/rule-engine.ts'],
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
