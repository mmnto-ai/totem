// Proves the proof-kit loop with zero LLM calls: the committed compiled rule
// (produced from the fixture's lesson by compile-fixture.mjs) must BLOCK the
// recurrence of the banked mistake, and must stay quiet on a clean change.
// Timing of the clean run recomputes the README's public "under 2 seconds"
// lint claim — measured here, never asserted from memory.
//
//   node examples/proof-kit/run.mjs         prove the loop, write receipt.json
//   node examples/proof-kit/run.mjs --ci    prove the loop, verify the committed
//                                           receipt's pinned fields, write nothing
'use strict';

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(KIT, '..', '..');
const FIXTURE = path.join(KIT, 'fixture');
const CLI_DIST = path.join(ROOT, 'packages', 'cli', 'dist', 'index.js');
const TMP = path.join(ROOT, '.totem', 'temp', 'proof-kit-run');
const RECEIPT_PATH = path.join(KIT, 'receipt.json');

// The public claim under test (README: "completes in under 2 seconds").
const TIMING_BOUND_MS = 2000;

function fail(message) {
  console.error(`[Totem Error] proof-kit run: ${message}`);
  process.exit(1);
}

function git(args) {
  const g = spawnSync('git', args, { cwd: TMP, encoding: 'utf-8' });
  if (g.status !== 0) fail(`git ${args.join(' ')} failed: ${g.stderr}`);
  return g.stdout;
}

if (!fs.existsSync(CLI_DIST)) fail(`${CLI_DIST} not found — run \`pnpm build\` first.`);

const committedRules = JSON.parse(
  fs.readFileSync(path.join(FIXTURE, '.totem', 'compiled-rules.json'), 'utf-8'),
);
if (committedRules.rules?.length !== 1) fail('fixture must carry exactly one committed rule.');
const committedRule = committedRules.rules[0];

// Materialize the fixture as its own git repo.
fs.rmSync(TMP, { recursive: true, force: true });
fs.cpSync(FIXTURE, TMP, { recursive: true });
git(['init', '-q']);
git(['add', '-A']);
git([
  '-c',
  'user.name=proof-kit',
  '-c',
  'user.email=proof-kit@local',
  'commit',
  '-q',
  '-m',
  'fixture baseline',
]);

// Zero-LLM is mechanical, not editorial: strip every plausible provider
// credential so anything trying to call a model fails loudly.
const env = { ...process.env };
for (const key of Object.keys(env)) {
  if (/API_KEY|_TOKEN$|ANTHROPIC|GEMINI|OPENAI|GOOGLE_GENAI/i.test(key)) delete env[key];
}

function lint(label) {
  const outFile = path.join(TMP, `lint-${label}.json`);
  const started = process.hrtime.bigint();
  const run = spawnSync(
    process.execPath,
    [CLI_DIST, 'lint', '--format', 'json', '--out', outFile],
    {
      cwd: TMP,
      env,
      encoding: 'utf-8',
    },
  );
  const elapsedMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
  if (!fs.existsSync(outFile)) {
    fail(
      `lint (${label}) produced no JSON output (exit ${run.status}).\nstdout: ${run.stdout}\nstderr: ${run.stderr}`,
    );
  }
  const json = JSON.parse(fs.readFileSync(outFile, 'utf-8'));
  fs.rmSync(outFile);
  return { status: run.status, json, elapsedMs };
}

// ── 1. The banked mistake comes back — the rule must block it. ──────
const apply = spawnSync('git', ['apply', path.join(KIT, 'mistake.diff')], {
  cwd: TMP,
  encoding: 'utf-8',
});
if (apply.status !== 0) fail(`mistake.diff no longer applies to the fixture: ${apply.stderr}`);

const mistake = lint('mistake');
if (mistake.status === 0 || mistake.json.pass !== false || mistake.json.errors < 1) {
  fail(
    `the recurrence was NOT blocked (exit ${mistake.status}, errors ${mistake.json.errors}) — the loop is broken.\n` +
      JSON.stringify(mistake.json, null, 2),
  );
}
const firing = (mistake.json.violations ?? []).find(
  (v) => v.rule?.lessonHash === committedRule.lessonHash,
);
if (!firing) {
  fail(
    'a violation fired but not from the fixture lesson’s rule — provenance chain broken.\n' +
      JSON.stringify(mistake.json.violations, null, 2),
  );
}
console.log(
  `[proof-kit] recurrence BLOCKED: ${firing.file ?? 'src/notify.js'} — rule ${committedRule.lessonHash} (${mistake.elapsedMs} ms)`,
);

// ── 2. A clean change on the same file — the rule must stay quiet. ──
git(['checkout', '--', '.']);
fs.appendFileSync(
  path.join(TMP, 'src', 'notify.js'),
  '\nexport function notifyCount(messages) {\n  return messages.length;\n}\n',
);
const clean = lint('clean');
if (clean.status !== 0 || clean.json.pass !== true || clean.json.errors !== 0) {
  fail(
    `clean change was flagged (exit ${clean.status}) — false positive.\n` +
      JSON.stringify(clean.json, null, 2),
  );
}
console.log(`[proof-kit] clean change passes (${clean.elapsedMs} ms)`);

// ── 3. The public timing number, recomputed. ─────────────────────────
if (clean.elapsedMs >= TIMING_BOUND_MS) {
  fail(
    `clean lint took ${clean.elapsedMs} ms — the public "under ${TIMING_BOUND_MS} ms" claim did not reproduce here.`,
  );
}

const cliVersion = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'packages', 'cli', 'package.json'), 'utf-8'),
).version;
const fresh = {
  mistakeBlocked: true,
  cleanPass: true,
  rules: 1,
  lessonHash: committedRule.lessonHash,
  chainIntact: true,
  mistakeElapsedMs: mistake.elapsedMs,
  cleanElapsedMs: clean.elapsedMs,
  timingBoundMs: TIMING_BOUND_MS,
  llmCalls: 0,
  apiKeysStripped: true,
  platform: `${os.platform()}-${os.arch()}`,
  node: process.versions.node,
  cliVersion,
  generatedAt: new Date().toISOString(),
};

fs.rmSync(TMP, { recursive: true, force: true });

if (process.argv.includes('--ci')) {
  if (!fs.existsSync(RECEIPT_PATH))
    fail('receipt.json not committed — run without --ci to generate it.');
  const committed = JSON.parse(fs.readFileSync(RECEIPT_PATH, 'utf-8'));
  for (const field of [
    'mistakeBlocked',
    'cleanPass',
    'rules',
    'lessonHash',
    'chainIntact',
    'timingBoundMs',
  ]) {
    if (committed[field] !== fresh[field]) {
      fail(
        `receipt field ${field}: committed=${JSON.stringify(committed[field])} recomputed=${JSON.stringify(fresh[field])}`,
      );
    }
  }
  console.log(
    `[proof-kit] PROVEN in CI: mistake blocked, clean pass, chain intact, clean lint ${fresh.cleanElapsedMs} ms < ${TIMING_BOUND_MS} ms, zero LLM calls.`,
  );
} else {
  fs.writeFileSync(RECEIPT_PATH, JSON.stringify(fresh, null, 2) + '\n');
  console.log(
    `[proof-kit] wrote receipt.json (clean lint ${fresh.cleanElapsedMs} ms, bound ${TIMING_BOUND_MS} ms).`,
  );
}
