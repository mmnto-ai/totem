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
 * Assert the repo's squash-merge config matches the E-lever posture (PR_TITLE +
 * BLANK) and fail loud on drift (mmnto-ai/totem#1762 addendum, 2026-07-21T0235Z).
 * A repo setting is one settings-page click from silently reverting.
 */
function assertMergeConfigPosture(repo) {
  const raw = gh([
    'api',
    `repos/${repo}`,
    '--jq',
    '{squash_merge_commit_title: .squash_merge_commit_title, squash_merge_commit_message: .squash_merge_commit_message}',
  ]);
  const verdict = evaluateMergeConfigPosture(JSON.parse(raw));
  if (!verdict.conforms) {
    console.error(`::error title=Merge-config posture drift::${verdict.message}`);
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
 * Fetch branch commit messages (first page, per_page=100 — PRs rarely exceed
 * 100 commits; parsed as structured JSON so multi-line messages never split).
 */
function fetchCommitMessages(repo, pr) {
  const raw = gh(['api', `repos/${repo}/pulls/${pr}/commits?per_page=100`]);
  const commits = JSON.parse(raw);
  return Array.isArray(commits) ? commits.map((c) => c?.commit?.message ?? '') : [];
}

/** Fetch GitHub's own linked closing references (the primary declared channel). */
function fetchClosingIssueRefs(repo, pr) {
  const [owner, name] = repo.split('/');
  const query =
    'query($owner:String!,$name:String!,$pr:Int!){repository(owner:$owner,name:$name)' +
    '{pullRequest(number:$pr){closingIssuesReferences(first:100)' +
    '{nodes{number repository{nameWithOwner}}}}}}';
  const raw = gh([
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
  ]);
  const nodes =
    JSON.parse(raw)?.data?.repository?.pullRequest?.closingIssuesReferences?.nodes ?? [];
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
  console.log(`[autoclose D1] declared-intended-close: ${JSON.stringify(scan.declaredCloseKeys)}`);
  console.log(`[autoclose D1] corpus findings: ${JSON.stringify(scan.findings)}`);

  if (!scan.ok) {
    console.error(
      `[autoclose D1] FAIL — undeclared close-keyword ref(s): ${scan.undeclared.join(', ')}.\n` +
        'A close-keyword adjacent to an issue ref (genuine OR negated) in the PR title, ' +
        'description, or ANY branch commit message auto-closes the linked issue when it reaches ' +
        'the squash merge-commit body. Declare intended closures via the PR linked issue ' +
        '(closingIssuesReferences) or a `<!-- totem-close: #N -->` marker; otherwise rephrase to a ' +
        'non-keyword form (references / see / tracks). mmnto-ai/totem#1762.',
    );
    process.exit(1);
  }

  console.log('[autoclose D1] PASS — every close-keyword ref is declared. Receipt written.');
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
