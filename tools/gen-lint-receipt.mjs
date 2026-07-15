// Generates (or verifies) docs/data/lint-receipt.json — the A3 real-diff
// zero-LLM lint receipt (strategy#531 ruled receipts trio).
//
//   node tools/gen-lint-receipt.mjs            regenerate the committed receipt
//   node tools/gen-lint-receipt.mjs --verify   recompute and compare the pinned
//                                              fields; exit 1 on mismatch
//
// The run is pinned to a real merged range of this repository and executes in
// a detached worktree at the pinned head, so the same command reproduces the
// same counts on any machine with full history (CI checks out fetch-depth: 0).
// Every provider API key is stripped from the child environment before lint
// runs — the receipt's zero-LLM claim is mechanical, not editorial.
'use strict';

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Pinned real merged range: PRs #2367–#2371 (the strategy#531 seam-repair
// burn-down + follow-ons), c14e90ab (Version Packages #2359) → ba8c591d.
const BASE_SHA = 'c14e90abefe25b6a334e6ac796dfcc3af3024a44';
const HEAD_SHA = 'ba8c591da7993451ecb08bc31d271ba3974e4eef';

// Fields that must reproduce exactly on recompute. elapsedMs / platform /
// node / cliVersion / generatedAt are environment labels, never gated.
const PINNED_FIELDS = [
  'baseSha',
  'headSha',
  'filesChanged',
  'rules',
  'errors',
  'warnings',
  'llmCalls',
];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RECEIPT_PATH = path.join(ROOT, 'docs', 'data', 'lint-receipt.json');
const CLI_DIST = path.join(ROOT, 'packages', 'cli', 'dist', 'index.js');
const WORKTREE = path.join(ROOT, '.totem', 'temp', 'a3-receipt-worktree');

function fail(message) {
  console.error(`[Totem Error] gen-lint-receipt: ${message}`);
  process.exit(1);
}

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8', ...opts }).trim();
}

function computeReceipt() {
  if (!fs.existsSync(CLI_DIST)) {
    fail(`${CLI_DIST} not found — run \`pnpm build\` first.`);
  }
  for (const sha of [BASE_SHA, HEAD_SHA]) {
    const type = spawnSync('git', ['cat-file', '-t', sha], { cwd: ROOT, encoding: 'utf-8' });
    if (type.stdout.trim() !== 'commit') {
      fail(
        `pinned commit ${sha} is not reachable — shallow clone? Fetch full history (fetch-depth: 0).`,
      );
    }
  }

  const filesChanged = git(['diff', '--name-only', `${BASE_SHA}...${HEAD_SHA}`])
    .split('\n')
    .filter(Boolean).length;

  // Detached worktree at the pinned head: lint sees exactly the committed
  // tree (including its own .totem/compiled-rules.json as of that commit).
  if (fs.existsSync(WORKTREE)) {
    spawnSync('git', ['worktree', 'remove', '--force', WORKTREE], { cwd: ROOT });
    fs.rmSync(WORKTREE, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(WORKTREE), { recursive: true });
  git(['worktree', 'add', '--detach', WORKTREE, HEAD_SHA]);

  try {
    const outFile = path.join(WORKTREE, 'lint-receipt-run.json');
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      // Strip every plausible provider credential so the zero-LLM claim is
      // mechanical: if anything in the lint path tried to call a model, it
      // would fail loudly instead of silently succeeding.
      if (/API_KEY|_TOKEN$|ANTHROPIC|GEMINI|OPENAI|GOOGLE_GENAI/i.test(key)) delete env[key];
    }

    const started = process.hrtime.bigint();
    const run = spawnSync(
      process.execPath,
      [CLI_DIST, 'lint', '--base', BASE_SHA, '--format', 'json', '--out', outFile],
      { cwd: WORKTREE, env, encoding: 'utf-8' },
    );
    const elapsedMs = Number((process.hrtime.bigint() - started) / 1_000_000n);

    // Exit 1 with violations is a legitimate lint outcome; anything without
    // parseable JSON output is not.
    if (!fs.existsSync(outFile)) {
      fail(
        `lint produced no JSON output (exit ${run.status}).\nstdout: ${run.stdout}\nstderr: ${run.stderr}`,
      );
    }
    const lint = JSON.parse(fs.readFileSync(outFile, 'utf-8'));

    const cliVersion = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'packages', 'cli', 'package.json'), 'utf-8'),
    ).version;

    return {
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      filesChanged,
      rules: lint.rules,
      errors: lint.errors,
      warnings: lint.warnings,
      llmCalls: 0,
      apiKeysStripped: true,
      elapsedMs,
      platform: `${os.platform()}-${os.arch()}`,
      node: process.versions.node,
      cliVersion,
      generatedAt: new Date().toISOString(),
    };
  } finally {
    spawnSync('git', ['worktree', 'remove', '--force', WORKTREE], { cwd: ROOT });
    fs.rmSync(WORKTREE, { recursive: true, force: true });
  }
}

const verify = process.argv.includes('--verify');
const fresh = computeReceipt();

if (verify) {
  if (!fs.existsSync(RECEIPT_PATH))
    fail(`${RECEIPT_PATH} not found — run without --verify to generate it.`);
  const committed = JSON.parse(fs.readFileSync(RECEIPT_PATH, 'utf-8'));
  const mismatches = PINNED_FIELDS.filter((f) => committed[f] !== fresh[f]);
  if (mismatches.length > 0) {
    for (const f of mismatches) {
      console.error(
        `  ${f}: committed=${JSON.stringify(committed[f])} recomputed=${JSON.stringify(fresh[f])}`,
      );
    }
    fail(
      'committed lint receipt does not reproduce — regenerate it (node tools/gen-lint-receipt.mjs) and commit.',
    );
  }
  console.log(
    `lint receipt reproduces: ${fresh.rules} rules, ${fresh.errors} errors, ${fresh.warnings} warnings ` +
      `over ${fresh.filesChanged} files (recomputed in ${fresh.elapsedMs} ms, zero LLM calls).`,
  );
} else {
  fs.writeFileSync(RECEIPT_PATH, JSON.stringify(fresh, null, 2) + '\n');
  console.log(
    `wrote ${RECEIPT_PATH}: ${fresh.rules} rules, ${fresh.errors} errors, ${fresh.warnings} warnings, ${fresh.elapsedMs} ms.`,
  );
}
