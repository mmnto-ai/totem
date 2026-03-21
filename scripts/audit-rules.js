#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { loadCompiledRulesFile } = require('../packages/core/dist/compiler.js');

function simpleGlobMatch(filePath, globs) {
  for (const g of globs) {
    if (typeof g !== 'string') continue;
    const isNeg = g.startsWith('!');
    const pattern = isNeg ? g.slice(1) : g;
    // Simple checks: *.ext, dir/**/*.ext, dir/**
    if (pattern.startsWith('*.')) {
      if (filePath.endsWith(pattern.slice(1))) return !isNeg;
    } else if (pattern.includes('**')) {
      const prefix = pattern.split('**')[0];
      const suffix = pattern.split('**').pop();
      if (
        filePath.startsWith(prefix) &&
        (!suffix || filePath.endsWith(suffix.replace('/*.', '.')))
      ) {
        return !isNeg;
      }
    }
  }
  // No explicit match — if there were globs, don't match; if no globs, match all
  return globs.length === 0;
}

const rulesFile = loadCompiledRulesFile('.totem/compiled-rules.json');
const rules = rulesFile.rules;

function walk(dir, exts) {
  let results = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      if (
        stat.isDirectory() &&
        !f.includes('node_modules') &&
        !f.includes('dist') &&
        !f.includes('.lancedb')
      ) {
        results = results.concat(walk(full, exts));
      } else if (
        exts.some((e) => f.endsWith(e)) &&
        !f.endsWith('.test.ts') &&
        !f.endsWith('.d.ts')
      ) {
        results.push(full);
      }
    }
  } catch (err) { /* walk errors are expected for inaccessible dirs */ } // eslint-disable-line no-empty
  return results;
}

const files = [
  ...walk('packages/core/src', ['.ts']),
  ...walk('packages/cli/src', ['.ts']),
  ...walk('packages/mcp/src', ['.ts']),
  'README.md',
  'CONTRIBUTING.md',
];

console.log(`Scanning ${files.length} files against ${rules.length} rules...\n`);

let totalViolations = 0;
const ruleHits = new Map();

for (const filePath of files) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const relPath = path.relative('.', filePath).replace(/\\/g, '/');
  const regexRules = rules.filter((r) => {
    if (r.engine !== 'regex' || !r.pattern) return false;
    if (!r.fileGlobs || r.fileGlobs.length === 0) return true;
    return simpleGlobMatch(relPath, r.fileGlobs);
  });

  for (const rule of regexRules) {
    try {
      const re = new RegExp(rule.pattern);
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          totalViolations++;
          const key = rule.lessonHeading || rule.message;
          if (!ruleHits.has(key)) {
            ruleHits.set(key, {
              count: 0,
              files: new Set(),
              severity: rule.severity,
              pattern: rule.pattern,
            });
          }
          ruleHits.get(key).count++;
          ruleHits.get(key).files.add(relPath);
        }
      }
    } catch (err) { /* invalid regex patterns are expected and skipped */ } // eslint-disable-line no-empty
  }
}

console.log(`Total violations (regex only): ${totalViolations}`);
console.log(`Unique rules that fired: ${ruleHits.size}`);
console.log('');

const sorted = [...ruleHits.entries()].sort((a, b) => b[1].count - a[1].count);

console.log('=== TOP 25 NOISIEST ===');
sorted.slice(0, 25).forEach(([heading, data]) => {
  console.log(`[${data.severity}] ${data.count} hits / ${data.files.size} files`);
  console.log(`  Rule: ${heading.slice(0, 80)}`);
  console.log(`  Pattern: /${data.pattern.slice(0, 60)}/`);
  console.log('');
});

console.log('=== SUMMARY ===');
const regexCount = rules.filter((r) => r.engine === 'regex').length;
console.log(`Rules that fired: ${ruleHits.size} of ${regexCount} regex rules`);
console.log(`Rules that never fired: ${regexCount - ruleHits.size}`);

const errorHits = sorted.filter(([, d]) => d.severity === 'error');
const warnHits = sorted.filter(([, d]) => d.severity === 'warning');
console.log(
  `ERROR rules that fired: ${errorHits.length} (total hits: ${errorHits.reduce((s, [, d]) => s + d.count, 0)})`,
);
console.log(
  `WARNING rules that fired: ${warnHits.length} (total hits: ${warnHits.reduce((s, [, d]) => s + d.count, 0)})`,
);
