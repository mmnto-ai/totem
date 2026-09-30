import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyPublishFailure, stagedCountsAsPublished } from './publish-oidc-lib.mjs';

// mmnto-ai/totem#2953: a re-run's E409 on a staged version is "published, awaiting promotion".

test('E409 "previously staged version" classifies as staged', () => {
  const stderr = [
    'npm error code E409',
    'npm error 409 Conflict - PUT https://registry.npmjs.org/@mmnto%2fcli - Cannot publish over previously staged version "2.11.1".',
  ].join('\n');
  assert.equal(classifyPublishFailure(stderr), 'staged');
});

test('any other failure classifies as failed', () => {
  assert.equal(classifyPublishFailure('npm error code E404\nnpm error 404 Not Found'), 'failed');
  assert.equal(classifyPublishFailure('npm error code E403\nnpm error 403 Forbidden'), 'failed');
  // A 409 that is not the staged conflict (a plain "cannot publish over existing version") is not staged.
  assert.equal(
    classifyPublishFailure(
      'npm error code E409\nYou cannot publish over the previously published versions: 2.11.1.',
    ),
    'failed',
  );
  assert.equal(classifyPublishFailure(''), 'failed');
  assert.equal(classifyPublishFailure(undefined), 'failed');
  // npm's real refusal of a re-publish over an existing version is an E403 with
  // "previously published versions" — the text half of the staged match is absent.
  assert.equal(
    classifyPublishFailure(
      'npm error code E403\nnpm error 403 403 Forbidden - PUT https://registry.npmjs.org/@mmnto%2fcli - You cannot publish over the previously published versions: 2.11.1.',
    ),
    'failed',
  );
});

test('a staged version counts as published only on a re-run of the same workflow run', () => {
  // A re-run keeps the sha that built the tarball the registry holds.
  assert.equal(stagedCountsAsPublished({ GITHUB_RUN_ATTEMPT: '2' }), true);
  assert.equal(stagedCountsAsPublished({ GITHUB_RUN_ATTEMPT: '3' }), true);
  // A first attempt meeting a staged version is another run's publish at
  // another commit: counting it would tag this commit for a tarball it did not build.
  assert.equal(stagedCountsAsPublished({ GITHUB_RUN_ATTEMPT: '1' }), false);
  assert.equal(stagedCountsAsPublished({}), false);
  assert.equal(stagedCountsAsPublished(undefined), false);
  assert.equal(stagedCountsAsPublished({ GITHUB_RUN_ATTEMPT: 'x' }), false);
});
