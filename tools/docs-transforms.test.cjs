'use strict';

/**
 * Tests for docs-transforms.cjs.
 * Run with: node tools/docs-transforms.test.cjs
 *
 * Uses Node's built-in assert — no test framework dependency
 * so tools/ stays zero-dependency and fast.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const transforms = require('./docs-transforms.cjs');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
  }
}

console.log('\ndocs-transforms tests\n');

// ── RULE_COUNT ──────────────────────────────────────────

test('RULE_COUNT returns a positive integer string', () => {
  const count = transforms.RULE_COUNT();
  assert.match(count, /^\d+$/);
  assert.ok(Number(count) > 0, `Expected count > 0, got ${count}`);
});

// ── HOOK_LIST ───────────────────────────────────────────

test('HOOK_LIST returns all four hooks as inline code', () => {
  const result = transforms.HOOK_LIST();
  assert.ok(result.includes('`pre-commit`'), 'Missing pre-commit');
  assert.ok(result.includes('`pre-push`'), 'Missing pre-push');
  assert.ok(result.includes('`post-merge`'), 'Missing post-merge');
  assert.ok(result.includes('`post-checkout`'), 'Missing post-checkout');
});

test('HOOK_LIST hooks are comma-separated', () => {
  const result = transforms.HOOK_LIST();
  const parts = result.split(', ');
  assert.equal(parts.length, 4, `Expected 4 parts, got ${parts.length}`);
});

// ── CHMOD_HOOKS ─────────────────────────────────────────

test('CHMOD_HOOKS generates fenced bash code block', () => {
  const result = transforms.CHMOD_HOOKS();
  assert.ok(result.startsWith('```bash\n'), 'Must start with ```bash');
  assert.ok(result.endsWith('\n```'), 'Must end with ```');
});

test('CHMOD_HOOKS includes chmod for all hooks', () => {
  const result = transforms.CHMOD_HOOKS();
  assert.ok(result.includes('chmod +x'), 'Missing chmod +x');
  assert.ok(result.includes('.git/hooks/pre-commit'), 'Missing pre-commit');
  assert.ok(result.includes('.git/hooks/pre-push'), 'Missing pre-push');
  assert.ok(result.includes('.git/hooks/post-merge'), 'Missing post-merge');
  assert.ok(result.includes('.git/hooks/post-checkout'), 'Missing post-checkout');
});

// ── COMMAND_TABLE ───────────────────────────────────────

test('COMMAND_TABLE generates a markdown table header', () => {
  const result = transforms.COMMAND_TABLE();
  assert.ok(result.includes('| Command | Description |'), 'Missing header');
  assert.ok(result.includes('| --- | --- |'), 'Missing separator');
});

test('COMMAND_TABLE includes known core commands', () => {
  const result = transforms.COMMAND_TABLE();
  assert.ok(result.includes('`lint`'), 'Missing lint');
  assert.ok(result.includes('`sync`'), 'Missing sync');
  assert.ok(result.includes('`init`'), 'Missing init');
  assert.ok(result.includes('`shield`'), 'Missing shield');
});

test('COMMAND_TABLE excludes hidden commands', () => {
  const result = transforms.COMMAND_TABLE();
  assert.ok(!result.includes('`migrate-lessons`'), 'Should exclude migrate-lessons');
  assert.ok(!result.includes('`install-hooks`'), 'Should exclude install-hooks');
  assert.ok(!result.includes('`demo`'), 'Should exclude demo');
});

test('COMMAND_TABLE rows are sorted alphabetically', () => {
  const result = transforms.COMMAND_TABLE();
  const rows = result.split('\n').filter((r) => r.startsWith('| `'));
  const names = rows.map((r) => r.match(/\| `([^`]+)` \|/)[1]);
  const sorted = [...names].sort();
  assert.deepEqual(names, sorted, `Commands not sorted: ${names.join(', ')}`);
});

// ── Summary ─────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
