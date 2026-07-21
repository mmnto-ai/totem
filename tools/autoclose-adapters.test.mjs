// Adapter-seam tests for the D1/D2 gh glue (mmnto-ai/totem#1762 review round):
// codex #4 (>100-commit pagination), codex #6 (closingIssuesReferences
// pagination), and the squash-subject PR-number resolver. Run with:
//   node --test tools/autoclose-adapters.test.mjs
// gh is dependency-injected, so no network / gh binary is touched.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fetchClosingIssueRefs, fetchCommitMessages } from './autoclose-pr.mjs';
import { resolvePrNumberFromSubject } from './autoclose-postmerge.mjs';

test('fetchCommitMessages returns ALL commits past 100 (codex #4 — no cap)', () => {
  // Simulate `gh api --paginate` merging pages into one 150-element array.
  const merged = Array.from({ length: 150 }, (_, i) => ({
    commit: { message: i === 130 ? 'fixes #999 in passing' : `chore: commit ${i}` },
  }));
  const fakeGh = (args) => {
    assert.ok(args.includes('--paginate'), 'must paginate the commit fetch');
    return JSON.stringify(merged);
  };
  const messages = fetchCommitMessages('mmnto-ai/totem', 42, fakeGh);
  assert.equal(messages.length, 150);
  assert.equal(messages[130], 'fixes #999 in passing');
});

test('fetchClosingIssueRefs paginates the GraphQL cursor to exhaustion (codex #6)', () => {
  const pages = [
    {
      data: {
        repository: {
          pullRequest: {
            closingIssuesReferences: {
              pageInfo: { hasNextPage: true, endCursor: 'CUR1' },
              nodes: [{ number: 1, repository: { nameWithOwner: 'mmnto-ai/totem' } }],
            },
          },
        },
      },
    },
    {
      data: {
        repository: {
          pullRequest: {
            closingIssuesReferences: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [{ number: 2, repository: { nameWithOwner: 'mmnto-ai/totem' } }],
            },
          },
        },
      },
    },
  ];
  let call = 0;
  const fakeGh = (args) => {
    // page 2 must carry the endCursor from page 1.
    if (call === 1)
      assert.ok(
        args.some((a) => a === 'after=CUR1'),
        'page 2 must pass the cursor',
      );
    return JSON.stringify(pages[call++]);
  };
  const refs = fetchClosingIssueRefs('mmnto-ai/totem', 42, fakeGh);
  assert.equal(call, 2, 'both pages fetched');
  assert.deepEqual(
    refs.map((r) => r.number),
    [1, 2],
  );
});

test('resolvePrNumberFromSubject picks the trailing (#N)', () => {
  assert.equal(resolvePrNumberFromSubject('build(deps): bump x (#948)'), 948);
  // A stacked title with two parentheticals resolves to the LAST (the squash PR).
  assert.equal(resolvePrNumberFromSubject('fix: thing (#2466) (#2471)'), 2471);
  assert.equal(resolvePrNumberFromSubject('chore: no pr number here'), undefined);
});
