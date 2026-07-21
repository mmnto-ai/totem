#!/usr/bin/env node
/**
 * D2 — post-merge auto-close reconciliation, OBSERVATION MODE (mmnto-ai/totem#1762).
 *
 * On push-to-main, reconciles the merged HEAD commit message against the D1
 * receipt via the ONE shared evaluator (`@mmnto/totem` autoclose `reconcile`).
 * NEVER auto-reopens (the Tenet 9 sense→enforce gate: reopen arms only after
 * positive+negative controls).
 *
 * Body-presence-first under the E lever (squash message = BLANK, PR_TITLE title —
 * mmnto-ai/totem#1762 addendum 2026-07-21T0235Z): a non-empty squash body should
 * not exist under BLANK, so its presence is itself a posture signal.
 *
 *   - clean            → exit 0 (empty body + no undeclared close-keyword ref).
 *   - anomaly          → exit 1. An undeclared close-keyword ref (the accidental-
 *                        closure harm). The zero-allowed-set (receipt `[]`) + a
 *                        closure-capable message is the #2471 specimen.
 *   - missing-receipt  → exit 1. A closure-capable message but no receipt (PR
 *                        merged before D1 existed, or the artifact expired).
 *   - ambiguous-receipt→ exit 1. Malformed / wrong-PR receipt. Never guess.
 *   - unexpected-body  → exit 0 + `::warning`. A non-empty body under BLANK with
 *                        NO undeclared close-keyword ref: posture-drift / local
 *                        `--body`-override EVIDENCE (no closure harm). Surfaced,
 *                        not silent, not a hard anomaly (interpretation call).
 *
 * Never scans issue/PR COMMENT bodies — comments never auto-close.
 *
 * Usage: node tools/autoclose-postmerge.mjs
 * Env:   GH_TOKEN / GITHUB_TOKEN (gh auth), GITHUB_REPOSITORY (owner/repo),
 *        GITHUB_SHA (merged HEAD), RECEIPT_PATH (optional pre-downloaded receipt),
 *        AUTOCLOSE_WORKFLOW (D1 workflow file, default autoclose-guard.yml)
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as process from 'node:process';
import { pathToFileURL } from 'node:url';

import { reconcile } from '../packages/core/dist/autoclose/index.js';

/** Run `gh` and return stdout; throws (with stderr) on a non-zero exit. */
export function gh(args) {
  const res = spawnSync('gh', args, { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`gh ${args.join(' ')} exited ${res.status}: ${res.stderr || ''}`);
  }
  return res.stdout;
}

/** Extract the PR number from a squash subject's trailing `(#N)`, else undefined. */
export function resolvePrNumberFromSubject(subject) {
  const firstLine = String(subject || '').split(/\r?\n/, 1)[0];
  const all = [...firstLine.matchAll(/\(#(\d+)\)/g)];
  const last = all[all.length - 1];
  return last ? Number(last[1]) : undefined;
}

/**
 * Best-effort load of the D1 receipt for `prNumber`. Returns the parsed receipt
 * or `null` on ANY failure — the single funnel to reconcile's "missing-receipt →
 * alert, never guess" branch (incl. PRs merged before D1 existed).
 */
export function loadReceipt(repo, prNumber, workflowFile) {
  // A pre-downloaded receipt (workflow actions/download-artifact) wins.
  const preset = process.env.RECEIPT_PATH;
  if (preset && fs.existsSync(preset)) {
    try {
      return JSON.parse(fs.readFileSync(preset, 'utf-8'));
    } catch {
      return null;
    }
  }
  if (!Number.isFinite(prNumber)) return null;
  try {
    const headSha = gh(['api', `repos/${repo}/pulls/${prNumber}`, '--jq', '.head.sha']).trim();
    const runsRaw = gh([
      'api',
      `repos/${repo}/actions/runs?head_sha=${headSha}&per_page=100`,
      '--jq',
      `[.workflow_runs[] | select(.path | endswith("${workflowFile}")) | .id]`,
    ]);
    const runIds = JSON.parse(runsRaw);
    if (!Array.isArray(runIds) || runIds.length === 0) return null;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoclose-receipt-'));
    gh(['run', 'download', String(runIds[0]), '-n', 'autoclose-receipt', '-D', dir]);
    return JSON.parse(fs.readFileSync(path.join(dir, 'autoclose-receipt.json'), 'utf-8'));
  } catch {
    return null;
  }
}

export function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA;
  const workflowFile = process.env.AUTOCLOSE_WORKFLOW || 'autoclose-guard.yml';
  if (!repo || !sha) {
    console.error('[autoclose D2] GITHUB_REPOSITORY and GITHUB_SHA are required.');
    process.exit(2);
  }

  const mergedBody = gh(['api', `repos/${repo}/commits/${sha}`, '--jq', '.commit.message']);
  const prNumber = resolvePrNumberFromSubject(mergedBody);
  const receipt = loadReceipt(repo, prNumber, workflowFile);

  const result = reconcile(receipt, mergedBody, {
    repo,
    ...(Number.isFinite(prNumber) ? { expectedPrNumber: prNumber } : {}),
  });

  console.log(
    `[autoclose D2] repo=${repo} sha=${sha} pr=${prNumber ? `#${prNumber}` : '(unresolved)'}`,
  );
  console.log(`[autoclose D2] status=${result.status} findings=${JSON.stringify(result.findings)}`);

  if (result.status === 'clean') {
    console.log(`[autoclose D2] OK — ${result.message}`);
    process.exit(0);
  }

  // Posture-drift EVIDENCE (E-lever addendum, mmnto-ai/totem#1762): a non-empty
  // body under BLANK with NO undeclared close-keyword ref — no accidental-closure
  // harm, so surface a NON-failing annotation (not a hard anomaly, not silent).
  if (result.status === 'unexpected-body') {
    console.log(`::warning title=Unexpected non-empty body under BLANK posture::${result.message}`);
    process.exit(0);
  }

  // OBSERVATION MODE: alert loud on a close-anomaly, never auto-reopen.
  console.error(`::error title=Auto-close anomaly (${result.status})::${result.message}`);
  console.error(
    `[autoclose D2] reopen candidates (NOT acted on — observation mode): ${result.reopenCandidates.join(', ')}`,
  );
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
