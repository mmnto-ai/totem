#!/usr/bin/env node
/**
 * Rule audit cleanup — Phase 1 + Phase 2
 * Removes garbage rules and deduplicates overlapping patterns.
 * Run: node scripts/clean-rules.js
 */
const fs = require('fs');

const RULES_PATH = '.totem/compiled-rules.json';
const data = JSON.parse(fs.readFileSync(RULES_PATH, 'utf-8'));
const before = data.rules.length;

// ─── Phase 1: Kill timestamp-headed and catastrophically broad rules ───

const broadKillHeadings = [
  'Manually suppress "unused export" errors in styleguide',
  'Using synchronous file operations like fs.readFileSync',
  'Convert top-level static imports to dynamic import() calls',
  'Hardcoded default values for properties like rule',
  'Hardcoding strings for categories in both reporting and CLI',
];

const killed = [];
data.rules = data.rules.filter((r) => {
  // Kill all timestamp-headed rules
  if (r.lessonHeading && /^\d{4}-\d{2}-\d{2}T/.test(r.lessonHeading)) {
    killed.push(r);
    return false;
  }
  // Kill catastrophically broad rules
  if (r.lessonHeading && broadKillHeadings.some((k) => r.lessonHeading.startsWith(k))) {
    killed.push(r);
    return false;
  }
  return true;
});

// Add killed hashes to non-compilable cache
const nonCompSet = new Set(data.nonCompilable || []);
for (const r of killed) {
  nonCompSet.add(r.lessonHash);
}

console.log(
  `Phase 1: Killed ${killed.length} rules (${killed.filter((r) => r.severity === 'error').length} error, ${killed.filter((r) => r.severity === 'warning').length} warning)`,
);

// ─── Phase 2: Deduplicate overlapping patterns ───

const patternGroups = new Map();
for (const r of data.rules) {
  const key = r.pattern || r.astGrepPattern || r.astQuery || '';
  if (!key) continue;
  if (!patternGroups.has(key)) patternGroups.set(key, []);
  patternGroups.get(key).push(r);
}

let dedupCount = 0;
const survivorHashes = new Set();

for (const [, group] of patternGroups) {
  if (group.length <= 1) {
    survivorHashes.add(group[0].lessonHash);
    continue;
  }

  // Pick survivor: prefer error severity, then most specific fileGlobs, then earliest createdAt
  group.sort((a, b) => {
    if (a.severity === 'error' && b.severity !== 'error') return -1;
    if (b.severity === 'error' && a.severity !== 'error') return 1;
    const aGlobs = (a.fileGlobs || []).length;
    const bGlobs = (b.fileGlobs || []).length;
    if (aGlobs > 0 && bGlobs === 0) return -1;
    if (bGlobs > 0 && aGlobs === 0) return 1;
    return (a.createdAt || '').localeCompare(b.createdAt || '');
  });

  survivorHashes.add(group[0].lessonHash);
  for (let i = 1; i < group.length; i++) {
    nonCompSet.add(group[i].lessonHash);
    dedupCount++;
  }
}

// Remove duplicates
data.rules = data.rules.filter((r) => {
  const key = r.pattern || r.astGrepPattern || r.astQuery || '';
  if (!key) return true;
  return survivorHashes.has(r.lessonHash);
});

console.log(`Phase 2: Deduped ${dedupCount} rules`);

// ─── Save ───

data.nonCompilable = [...nonCompSet];

console.log('');
console.log(`Before: ${before} rules`);
console.log(`After: ${data.rules.length} rules`);
console.log(`Non-compilable cache: ${data.nonCompilable.length} hashes`);

fs.writeFileSync(RULES_PATH, JSON.stringify(data, null, 2) + '\n');
console.log(`\nSaved to ${RULES_PATH}`);
