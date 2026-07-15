// LOCAL-ONLY: compiles the proof-kit fixture's one lesson into its committed
// rule using the real `totem lesson compile` pipeline, then copies the
// compiled artifacts back into fixture/.totem/.
//
// Freeze scope (adjudicated, mmnto-ai/totem-strategy#531 comment 4976403990):
// the host repo's rule-compilation freeze is corpus-scoped. This script runs
// the compiler ONLY against the fixture's own corpus in a temp directory —
// it never reads or writes the host repo's .totem/lessons/** or
// compiled-rules.json, and it refuses to run in CI (CI stays zero-LLM and
// asserts the committed rule blocks the mistake; see run.mjs).
'use strict';

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(KIT, '..', '..');
const FIXTURE = path.join(KIT, 'fixture');
const CLI_DIST = path.join(ROOT, 'packages', 'cli', 'dist', 'index.js');
const TMP = path.join(ROOT, '.totem', 'temp', 'proof-kit-compile');

function fail(message) {
  console.error(`[Totem Error] proof-kit compile: ${message}`);
  process.exit(1);
}

// House rule: sanitize subprocess-derived strings before they reach a
// terminal (ANSI + control chars stripped; newline/tab kept for readability).
const ESC = String.fromCharCode(27);
const ANSI_RE = new RegExp(ESC + '\\[[0-9;]*[A-Za-z]', 'g');
function sanitize(s) {
  return String(s ?? '')
    .replace(ANSI_RE, '')
    .split('')
    .filter((c) => c === '\n' || c === '\t' || (c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127))
    .join('');
}

if (process.env.CI) {
  fail(
    'refusing to run in CI — the compile step is local + recorded only; CI asserts the committed rule (run.mjs --ci).',
  );
}
if (!fs.existsSync(CLI_DIST)) fail(`${CLI_DIST} not found — run \`pnpm build\` first.`);

fs.rmSync(TMP, { recursive: true, force: true });
fs.cpSync(FIXTURE, TMP, { recursive: true });

// Compile fresh: the fixture ships the PREVIOUS compile's artifacts, and the
// compiler skips already-processed lessons if they ride along.
for (const artifact of ['compiled-rules.json', 'compile-manifest.json']) {
  fs.rmSync(path.join(TMP, '.totem', artifact), { force: true });
}

// The materialized fixture must be its own git repo: repo-root resolution
// walks up otherwise, and Stage-4 verification would baseline against the
// HOST repo's files instead of the fixture's.
for (const args of [
  ['init', '-q'],
  ['add', '-A'],
  [
    '-c',
    'user.name=proof-kit',
    '-c',
    'user.email=proof-kit@local',
    'commit',
    '-q',
    '-m',
    'fixture baseline',
  ],
]) {
  const g = spawnSync('git', args, { cwd: TMP, encoding: 'utf-8' });
  if (g.status !== 0) fail(`git ${args.join(' ')} failed: ${sanitize(g.stderr)}`);
}

// The CLI loads .env relative to where it runs; the materialized fixture has
// none, so pass the host repo's provider keys through the child environment
// (values never printed). Without this the SDK reports "unavailable" and the
// compile silently rides whatever vendor CLI happens to be on PATH.
const env = { ...process.env };
const hostEnvFile = path.join(ROOT, '.env');
if (fs.existsSync(hostEnvFile)) {
  for (const line of fs.readFileSync(hostEnvFile, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && /API_KEY$/.test(m[1]) && !env[m[1]]) {
      // Dotenv-style quoted values must be unwrapped — a quoted key reaches
      // the SDK malformed and the compile silently rides the CLI fallback.
      let value = m[2].trim();
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      env[m[1]] = value;
    }
  }
}

console.log('[proof-kit] compiling the fixture lesson with the real pipeline...');
const run = spawnSync(process.execPath, [CLI_DIST, 'lesson', 'compile'], {
  cwd: TMP,
  env,
  encoding: 'utf-8',
  stdio: 'inherit',
});
if (run.status !== 0) fail(`totem lesson compile exited ${run.status}.`);

const rulesPath = path.join(TMP, '.totem', 'compiled-rules.json');
if (!fs.existsSync(rulesPath)) fail('compile produced no compiled-rules.json.');
const compiled = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
if (!Array.isArray(compiled.rules) || compiled.rules.length !== 1) {
  fail(`expected exactly 1 compiled rule, got ${compiled.rules?.length ?? 0}.`);
}
const rule = compiled.rules[0];
console.log(
  `[proof-kit] compiled rule: severity=${rule.severity} engine=${rule.engine} lessonHash=${rule.lessonHash}`,
);
console.log(`[proof-kit] pattern: ${rule.pattern}`);
if (rule.severity !== 'error') {
  fail(
    `rule compiled to severity "${rule.severity}" — the kit needs a blocking rule; sharpen the lesson's ban wording and recompile.`,
  );
}
// Only the ast/ast-grep engine class can BLOCK: `totem lint` demotes the
// whole regex class to advisory regardless of severity (#2181/#2183
// hard-tier split). A lesson that compiles to regex cannot prove
// blocked-recurrence.
if (rule.engine !== 'ast' && rule.engine !== 'ast-grep') {
  fail(
    `rule compiled to engine "${rule.engine}" — only the ast class blocks (#2181); refine the lesson toward a structural pattern.`,
  );
}
// Stage-4 structural equivalence is exact-line against badExample: the
// quarantined repro must read as the positive control (in-scope-bad-example
// → active + confidence high), not candidate debt (→ forced warning).
if (!rule.badExample?.includes('} catch {}')) {
  fail(
    `compiled badExample does not carry the historical empty-catch shape — Stage 4 would read the repro as candidate debt. Got: ${rule.badExample}`,
  );
}
if (rule.status !== undefined && rule.status !== 'active') {
  fail(`rule status is "${rule.status}" — lint treats non-active rules as inert; recompile.`);
}

// ADR-089 zero-trust: every LLM-generated rule ships `unverified: true`,
// which lint enforces as ADVISORY only. Promotion to blocking is a human
// act — running this script IS that review: you have the compiled pattern
// printed above; promoting is your sign-off. Same register as the rest of
// the product ("a human merges every change").
console.log('[proof-kit] promoting the rule to blocking (human sign-off step, ADR-089)...');
const promote = spawnSync(process.execPath, [CLI_DIST, 'rule', 'promote', rule.lessonHash], {
  cwd: TMP,
  encoding: 'utf-8',
  stdio: 'inherit',
});
if (promote.status !== 0) fail(`totem rule promote exited ${promote.status}.`);
const promoted = JSON.parse(fs.readFileSync(rulesPath, 'utf-8')).rules[0];
if (promoted.unverified !== undefined) {
  fail('promotion did not clear the unverified flag — the rule would stay advisory.');
}

for (const artifact of ['compiled-rules.json', 'compile-manifest.json']) {
  const src = path.join(TMP, '.totem', artifact);
  if (!fs.existsSync(src)) fail(`compile did not produce ${artifact}.`);
  // Atomic copy (tmp + rename) — manifest-class files must never land torn.
  const dest = path.join(FIXTURE, '.totem', artifact);
  const tmpDest = `${dest}.tmp`;
  fs.copyFileSync(src, tmpDest);
  fs.renameSync(tmpDest, dest);
  console.log(`[proof-kit] committed fixture/.totem/${artifact}`);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(
  '[proof-kit] done — commit the fixture artifacts and run `node examples/proof-kit/run.mjs` to prove the loop.',
);
