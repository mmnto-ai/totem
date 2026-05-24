#!/usr/bin/env node
/**
 * Tests for tools/augment-cohort-changelog-headers.mjs
 *
 * Bare-node test runner (matches docs-transforms.test.cjs pattern). Exits 0
 * on all green; non-zero on any failure.
 */

import { strict as assert } from 'node:assert';

import {
  COHORT_NOTE,
  TARGET_CHANGELOGS,
  augmentChangelog,
} from './augment-cohort-changelog-headers.mjs';

let testCount = 0;
let failCount = 0;

function test(name, fn) {
  testCount++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failCount++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

console.log('augment-cohort-changelog-headers:');

test('empty header followed by next version header → augment', () => {
  const input = ['# Pkg', '', '## 1.49.1', '', '## 1.49.0', '', '_existing body_', ''].join('\n');
  const { content, augmented } = augmentChangelog(input);
  assert.equal(augmented, 1);
  assert.ok(content.includes(COHORT_NOTE));
  // The pre-existing 1.49.0 body should be untouched.
  assert.ok(content.includes('_existing body_'));
});

test('empty header at EOF → augment', () => {
  const input = ['# Pkg', '', '## 1.49.1', ''].join('\n');
  const { content, augmented } = augmentChangelog(input);
  assert.equal(augmented, 1);
  assert.ok(content.includes(COHORT_NOTE));
});

test('header with existing cohort-link body → no-op (idempotency anchor)', () => {
  const input = [
    '# Pkg',
    '',
    '## 1.49.1',
    '',
    COHORT_NOTE,
    '',
    '## 1.49.0',
    '',
    '_prior cohort note_',
    '',
  ].join('\n');
  const { content, augmented } = augmentChangelog(input);
  assert.equal(augmented, 0);
  assert.equal(content, input);
});

test('idempotency: re-running on augmented output → no-op', () => {
  const input = ['# Pkg', '', '## 1.49.1', '', '## 1.49.0', '', '_prior cohort note_', ''].join(
    '\n',
  );
  const { content: pass1, augmented: a1 } = augmentChangelog(input);
  assert.equal(a1, 1, 'first pass should augment the empty 1.49.1');
  const { content: pass2, augmented: a2 } = augmentChangelog(pass1);
  assert.equal(a2, 0, 'second pass should be a no-op');
  assert.equal(pass1, pass2);
});

test('header with ### Patch Changes body → no-op (cli case)', () => {
  const input = [
    '# Pkg',
    '',
    '## 1.49.1',
    '',
    '### Patch Changes',
    '',
    '- e4a24ec: chore(deps): bump packageManager',
    '',
    '## 1.49.0',
    '',
    '### Minor Changes',
    '',
    '- abc: prior change',
    '',
  ].join('\n');
  const { content, augmented } = augmentChangelog(input);
  assert.equal(augmented, 0);
  assert.equal(content, input);
});

test('multiple empty headers in one file → augment all with canonical spacing', () => {
  const input = ['# Pkg', '', '## 1.49.1', '', '## 1.49.0', '', '## 1.48.0', ''].join('\n');
  const { content, augmented } = augmentChangelog(input);
  // 1.49.1 + 1.49.0 are followed by another `## ` header (empty); 1.48.0 is at EOF (empty).
  assert.equal(augmented, 3);
  const escaped = COHORT_NOTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const occurrences = (content.match(new RegExp(escaped, 'g')) || []).length;
  assert.equal(occurrences, 3);
  // Output shape: each augmented section must end with a blank line
  // before the next `## ` (or EOF). Asserting this guards against the
  // `_NOTE_\n## 1.48.0` malformed spacing class.
  assert.ok(
    !content.includes(`${COHORT_NOTE}\n## `),
    'note must be separated from the next ## header by a blank line',
  );
});

test('mixed empty + non-empty → augment only empty', () => {
  const input = [
    '# Pkg',
    '',
    '## 1.49.1',
    '',
    '### Patch Changes',
    '',
    '- abc: change',
    '',
    '## 1.49.0',
    '',
    '## 1.48.0',
    '',
    '_pre-existing note_',
    '',
  ].join('\n');
  const { content, augmented } = augmentChangelog(input);
  // 1.49.1 has body → skip; 1.49.0 empty (followed by 1.48.0) → augment; 1.48.0 has body → skip.
  assert.equal(augmented, 1);
  assert.ok(content.includes('_pre-existing note_'));
  assert.ok(content.includes('### Patch Changes'));
});

test('version header regex: rejects malformed headers', () => {
  // Should not augment a header that doesn't match the `## X.Y.Z` pattern.
  const input = ['# Pkg', '', '## 1.49', '', '## not-a-version', '', '## 1.49.0-rc.1', ''].join(
    '\n',
  );
  const { content, augmented } = augmentChangelog(input);
  // None of these match `^## \d+\.\d+\.\d+$` exactly (prerelease suffix breaks it; 1.49 has only 2 segments).
  assert.equal(augmented, 0);
  assert.equal(content, input);
});

test('target list exposes the three exhibiting packs', () => {
  assert.deepEqual(TARGET_CHANGELOGS, [
    'packages/core/CHANGELOG.md',
    'packages/pack-agent-security/CHANGELOG.md',
    'packages/pack-rust-architecture/CHANGELOG.md',
  ]);
});

console.log(`\n${testCount - failCount}/${testCount} tests passed.`);
process.exit(failCount > 0 ? 1 : 0);
