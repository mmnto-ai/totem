/**
 * Tests for the VP-PR cut sensor's pure functions (mmnto-ai/totem#2325).
 * Run: node --test tools/vp-pr-cut-sensor.test.mjs (root script test:cut-sensor).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  addedChangelogLines,
  classifyPaths,
  COMMENT_MARKER,
  composeComment,
  parseChangelogAdditions,
} from './vp-pr-cut-sensor.mjs';

test('addedChangelogLines: only CHANGELOG.md additions, +++ header excluded', () => {
  const files = [
    {
      filename: 'packages/cli/CHANGELOG.md',
      patch:
        '+++ b/packages/cli/CHANGELOG.md\n+## 1.92.0\n+- abc1234: feat: thing\n-old line\n context',
    },
    { filename: 'packages/cli/package.json', patch: '+  "version": "1.92.0",' },
    { filename: '.changeset/some-entry.md', patch: '-Consumer-impact: CLI surface' },
  ];
  assert.deepEqual(addedChangelogLines(files), ['## 1.92.0', '- abc1234: feat: thing']);
});

test('parseChangelogAdditions: tags bind to their opening entry; dependency echoes never scope', () => {
  const { entries } = parseChangelogAdditions([
    '- abc1234: feat(cli): tagged thing',
    '',
    '  Some body prose.',
    '',
    '  Consumer-impact: CLI surface — new flag',
    '- def5678: fix(core): untagged thing',
    '- Updated dependencies [abc1234]',
    '  - @mmnto/totem@1.92.0',
    '  Consumer-impact: orphaned tag outside any entry scope',
  ]);
  assert.deepEqual([...entries.keys()], ['abc1234', 'def5678']);
  assert.deepEqual(entries.get('abc1234').tags, ['CLI surface — new flag']);
  assert.deepEqual(entries.get('def5678').tags, []);
});

test('classifyPaths: seam table hits with matched paths; non-seam paths silent', () => {
  const hits = classifyPaths([
    'packages/core/src/config-schema.ts',
    'packages/cli/src/commands/mail.ts',
    'packages/cli/src/commands/shield-eval.integration.test.ts',
    'docs/reference/architecture.md',
  ]);
  assert.deepEqual([...hits.keys()], ['consumer config schema', 'ECL / file / wire formats']);
  assert.deepEqual(hits.get('ECL / file / wire formats'), ['packages/cli/src/commands/mail.ts']);
});

test('classifyPaths: test files never flag, even on seam paths', () => {
  const hits = classifyPaths([
    'packages/cli/src/commands/mail.test.ts',
    'packages/cli/src/commands/ecl-gc.test.ts',
    'packages/core/src/config-schema.test.ts',
  ]);
  assert.equal(hits.size, 0);
});

test('classifyPaths: machine surfaces + root manifest classes', () => {
  const hits = classifyPaths(['action.yml', 'packages/mcp/src/tools/search.ts', 'package.json']);
  assert.deepEqual(
    [...hits.keys()],
    ['machine surfaces', 'toolchain floors / restricted-pin (root manifest)'],
  );
  assert.deepEqual(hits.get('machine surfaces'), [
    'action.yml',
    'packages/mcp/src/tools/search.ts',
  ]);
});

test('composeComment: internal-only shape when nothing declared or flagged', () => {
  const body = composeComment({ declared: [], flagged: [], scannedEntryCount: 3 });
  assert.ok(body.startsWith(COMMENT_MARKER));
  assert.match(body, /internal-only: cut freely/);
  assert.match(body, /3 changelog entries/);
  assert.match(body, /Advisory only \(Tenet 13\)/);
  assert.doesNotMatch(body, /Choreography/);
});

test('composeComment: contract-bearing shape carries declared tags, untagged flags, and the choreography template', () => {
  const body = composeComment({
    declared: [{ hash: 'abc1234', tag: 'CLI surface — new flag' }],
    flagged: [
      {
        hash: 'def5678',
        classes: new Map([['ECL / file / wire formats', ['packages/cli/src/commands/mail.ts']]]),
      },
    ],
    scannedEntryCount: 2,
  });
  assert.match(body, /contract-bearing/);
  assert.match(body, /`abc1234`: CLI surface — new flag/);
  assert.match(body, /untagged ⚠/);
  assert.match(body, /`def5678`: ECL \/ file \/ wire formats/);
  assert.match(body, /Which consumers move/);
  assert.match(body, /operator's merge word on this VP-PR remains the gate/);
});
