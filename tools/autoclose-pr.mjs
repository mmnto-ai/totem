#!/usr/bin/env node
/**
 * D1 — PR-time auto-close required check (mmnto-ai/totem#1762).
 *
 * Scans the PR corpus — title, description, and ALL branch commit messages
 * (config-verified: the governed repos compose squash bodies from
 * `COMMIT_MESSAGES`, so every branch commit is a squash-seed input) — for
 * close-keyword-adjacent issue references via the ONE shared evaluator
 * (`@mmnto/totem` autoclose). It FAILS on any reference that is not DECLARED,
 * and persists the declared-intended-close set (`closingIssuesReferences` ∪ a
 * structured-intent declaration) as the durable D2 receipt (`RECEIPT_PATH`).
 *
 * Never scans issue/PR COMMENT bodies — comments never auto-close.
 *
 * Usage: node tools/autoclose-pr.mjs
 * Env:   GH_TOKEN / GITHUB_TOKEN (gh auth), GITHUB_REPOSITORY (owner/repo),
 *        PR_NUMBER, RECEIPT_PATH (default ./autoclose-receipt.json)
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  buildReceipt,
  evaluateMergeConfigPosture,
  scanPrCorpus,
} from '../packages/core/dist/autoclose/index.js';

/** Run `gh` and return stdout; throws (with stderr) on a non-zero exit. */
export function gh(args) {
  const res = spawnSync('gh', args, { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`gh ${args.join(' ')} exited ${res.status}: ${res.stderr || ''}`);
  }
  return res.stdout;
}

/**
 * Assert the repo's merge config matches the required posture — E lever
 * (PR_TITLE + BLANK) AND squash-only (allow_squash_merge on, merge-commit +
 * rebase off) — and fail loud on drift (mmnto-ai/totem#1762 addendum
 * 2026-07-21T0235Z + codex squash-only supplement 0356Z).
 * A repo setting is one settings-page click from silently reverting.
 *
 * SOURCE IS GRAPHQL, not REST: the REST repos endpoint omits the merge-policy
 * fields for non-admin callers, and the Actions GITHUB_TOKEN is one — on D1's
 * first live run a healthy posture read as all-absent via REST. The GraphQL
 * repository fields are readable with a plain read token. An absent/null read
 * is reported as UNVERIFIABLE (fix the read path / token), never as drift.
 */
function assertMergeConfigPosture(repo, ghFn = gh) {
  const [owner, name] = repo.split('/');
  const query =
    'query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ' +
    'squashMergeAllowed mergeCommitAllowed rebaseMergeAllowed ' +
    'squashMergeCommitTitle squashMergeCommitMessage } }';
  const raw = ghFn([
    'api',
    'graphql',
    '-f',
    `query=${query}`,
    '-f',
    `owner=${owner}`,
    '-f',
    `name=${name}`,
    '--jq',
    '.data.repository',
  ]);
  const r = JSON.parse(raw) ?? {};
  const verdict = evaluateMergeConfigPosture({
    squash_merge_commit_title: r.squashMergeCommitTitle,
    squash_merge_commit_message: r.squashMergeCommitMessage,
    allow_squash_merge: r.squashMergeAllowed,
    allow_merge_commit: r.mergeCommitAllowed,
    allow_rebase_merge: r.rebaseMergeAllowed,
  });
  if (!verdict.conforms) {
    const title =
      verdict.status === 'unverifiable'
        ? 'Merge-config posture unverifiable'
        : 'Merge-config posture drift';
    console.error(`::error title=${title}::${verdict.message}`);
    process.exit(1);
  }
  console.log(`[autoclose D1] ${verdict.message}`);
}

/** Fetch title/body/headSha for the PR. */
function fetchPr(repo, pr) {
  const raw = gh([
    'api',
    `repos/${repo}/pulls/${pr}`,
    '--jq',
    '{title: .title, body: (.body // ""), headSha: .head.sha}',
  ]);
  return JSON.parse(raw);
}

/**
 * Fetch ALL branch commit messages, paginated to exhaustion (codex #4 — the
 * binding "scan ALL branch commit messages" contract; rarity is not a
 * deterministic bound). `gh api --paginate` merges the array pages into one JSON
 * array, parsed structurally so multi-line messages never split. `ghFn` is
 * injectable for the adapter test.
 */
export function fetchCommitMessages(repo, pr, ghFn = gh) {
  const raw = ghFn(['api', '--paginate', `repos/${repo}/pulls/${pr}/commits?per_page=100`]);
  const commits = JSON.parse(raw);
  return Array.isArray(commits) ? commits.map((c) => c?.commit?.message ?? '') : [];
}

/**
 * Fetch GitHub's linked closing references (OBSERVED state — recorded on the
 * receipt as informational, NOT authorizing; the marker is the sole authorizer,
 * codex #3). Paginated to exhaustion via the GraphQL cursor (codex #6) so the
 * informational audit record is complete. `ghFn` is injectable for the test.
 */
export function fetchClosingIssueRefs(repo, pr, ghFn = gh) {
  const [owner, name] = repo.split('/');
  const nodes = [];
  let after = null;
  for (let page = 0; page < 50; page++) {
    // `$after: String` is nullable — omitting the arg on page 1 means null.
    const query =
      'query($owner:String!,$name:String!,$pr:Int!,$after:String){repository(owner:$owner,name:$name)' +
      '{pullRequest(number:$pr){closingIssuesReferences(first:100,after:$after)' +
      '{pageInfo{hasNextPage endCursor} nodes{number repository{nameWithOwner}}}}}}';
    const args = [
      'api',
      'graphql',
      '-f',
      `query=${query}`,
      '-f',
      `owner=${owner}`,
      '-f',
      `name=${name}`,
      '-F',
      `pr=${pr}`,
    ];
    if (after) args.push('-f', `after=${after}`);
    const conn = JSON.parse(ghFn(args))?.data?.repository?.pullRequest?.closingIssuesReferences;
    for (const n of conn?.nodes ?? []) nodes.push(n);
    if (!conn?.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return nodes.map((n) => ({
    number: n.number,
    ...(n.repository?.nameWithOwner &&
    n.repository.nameWithOwner.toLowerCase() !== repo.toLowerCase()
      ? { repoWithOwner: n.repository.nameWithOwner }
      : {}),
  }));
}

export function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const pr = Number(process.env.PR_NUMBER);
  const receiptPath = process.env.RECEIPT_PATH || './autoclose-receipt.json';
  if (!repo || !Number.isFinite(pr)) {
    console.error('[autoclose D1] GITHUB_REPOSITORY and PR_NUMBER are required.');
    process.exit(2);
  }

  // Assert the E-lever merge-config posture FIRST — fail loud on drift.
  assertMergeConfigPosture(repo);

  const { title, body, headSha } = fetchPr(repo, pr);
  const commitMessages = fetchCommitMessages(repo, pr);
  const closingIssuesReferences = fetchClosingIssueRefs(repo, pr);

  const scan = scanPrCorpus({ title, body, commitMessages, closingIssuesReferences, repo });
  const receipt = buildReceipt({ repo }, pr, headSha, scan);
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf-8');

  console.log(`[autoclose D1] repo=${repo} pr=#${pr} head=${headSha}`);
  console.log(
    `[autoclose D1] declared-by-marker (authorizing): ${JSON.stringify(scan.declaredByMarker)}; ` +
      `closingIssuesReferences (informational): ${JSON.stringify(scan.closingIssuesReferences)}`,
  );
  console.log(`[autoclose D1] corpus findings: ${JSON.stringify(scan.findings)}`);

  if (!scan.ok) {
    console.error(
      `[autoclose D1] FAIL — unauthorized close-keyword ref(s): ${scan.undeclared.join(', ')}.\n` +
        'A close-keyword adjacent to an issue ref (genuine OR negated) in the PR title, ' +
        'description, or ANY branch commit message auto-closes the linked issue when it reaches ' +
        'the squash merge-commit body. Declare each intended closure with a ' +
        '`<!-- totem-close: #N -->` marker (or a `Totem-Close: #N` trailer) — the SOLE authorizing ' +
        "channel, since GitHub's closingIssuesReferences is DERIVED from the same keyword and " +
        'cannot authorize it (the circularity fix). Otherwise rephrase to a non-keyword form ' +
        '(references / see / tracks). mmnto-ai/totem#1762.',
    );
    process.exit(1);
  }

  console.log('[autoclose D1] PASS — every close-keyword ref is declared. Receipt written.');
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
