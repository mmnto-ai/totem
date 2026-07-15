'use strict';

/**
 * Tests for docs-transforms.cjs.
 * Run with: node tools/docs-transforms.test.cjs
 *
 * Uses Node's built-in assert — no test framework dependency
 * so tools/ stays zero-dependency and fast.
 */
const assert = require('node:assert/strict');
const transforms = require('./docs-transforms.cjs');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err.message}`);
  }
}

console.log('\ndocs-transforms tests\n');

// ── RULE_COUNT ──────────────────────────────────────────

test('RULE_COUNT returns a positive integer string', () => {
  const count = transforms.RULE_COUNT();
  assert.match(count, /^\d+$/);
  assert.ok(Number(count) > 0, `Expected count > 0, got ${count}`);
});

// ── HOOK_LIST ───────────────────────────────────────────

test('HOOK_LIST returns all four hooks as inline code', () => {
  const result = transforms.HOOK_LIST();
  assert.ok(result.includes('`pre-commit`'), 'Missing pre-commit');
  assert.ok(result.includes('`pre-push`'), 'Missing pre-push');
  assert.ok(result.includes('`post-merge`'), 'Missing post-merge');
  assert.ok(result.includes('`post-checkout`'), 'Missing post-checkout');
});

test('HOOK_LIST hooks are comma-separated', () => {
  const result = transforms.HOOK_LIST();
  const parts = result.split(', ');
  assert.equal(parts.length, 4, `Expected 4 parts, got ${parts.length}`);
});

// ── CHMOD_HOOKS ─────────────────────────────────────────

test('CHMOD_HOOKS generates fenced bash code block', () => {
  const result = transforms.CHMOD_HOOKS();
  assert.ok(result.startsWith('```bash\n'), 'Must start with ```bash');
  assert.ok(result.endsWith('\n```'), 'Must end with ```');
});

test('CHMOD_HOOKS includes chmod for all hooks', () => {
  const result = transforms.CHMOD_HOOKS();
  assert.ok(result.includes('chmod +x'), 'Missing chmod +x');
  assert.ok(result.includes('.git/hooks/pre-commit'), 'Missing pre-commit');
  assert.ok(result.includes('.git/hooks/pre-push'), 'Missing pre-push');
  assert.ok(result.includes('.git/hooks/post-merge'), 'Missing post-merge');
  assert.ok(result.includes('.git/hooks/post-checkout'), 'Missing post-checkout');
});

// ── COMMAND_TABLE ───────────────────────────────────────

test('COMMAND_TABLE generates a markdown table header', () => {
  const result = transforms.COMMAND_TABLE();
  assert.ok(result.includes('| Command | Description |'), 'Missing header');
  assert.ok(result.includes('| --- | --- |'), 'Missing separator');
});

test('COMMAND_TABLE includes known core commands', () => {
  const result = transforms.COMMAND_TABLE();
  assert.ok(result.includes('`lint`'), 'Missing lint');
  assert.ok(result.includes('`sync`'), 'Missing sync');
  assert.ok(result.includes('`init`'), 'Missing init');
  assert.ok(result.includes('`review`'), 'Missing review');
});

test('COMMAND_TABLE excludes hidden commands', () => {
  const result = transforms.COMMAND_TABLE();
  assert.ok(!result.includes('`migrate-lessons`'), 'Should exclude migrate-lessons');
  assert.ok(!result.includes('`install-hooks`'), 'Should exclude install-hooks');
  assert.ok(!result.includes('`demo`'), 'Should exclude demo');
  // shield is registered `{ hidden: true }` as a deprecated alias of review —
  // the table derives hiddenness from the registration, not a hardcoded list.
  assert.ok(!result.includes('`shield`'), 'Should exclude hidden deprecated alias shield');
});

test('COMMAND_TABLE preserves registration order (not alphabetical)', () => {
  const result = transforms.COMMAND_TABLE();
  const rows = result.split('\n').filter((r) => r.startsWith('| `'));
  const names = rows.map((r) => r.match(/\| `([^`]+)` \|/)[1]);
  // init should come before lint (registration order), not after (alphabetical)
  const initIdx = names.indexOf('init');
  const lintIdx = names.indexOf('lint');
  assert.ok(
    initIdx < lintIdx,
    `init (${initIdx}) should come before lint (${lintIdx}) in registration order`,
  );
});

// ── A3 maturity surface ─────────────────────────────────

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, '.totem', 'temp', 'docs-transforms-test');
fs.mkdirSync(TMP, { recursive: true });

function writeTmpJson(name, value) {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, JSON.stringify(value, null, 2));
  return p;
}

const maturityData = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'docs', 'data', 'maturity.json'), 'utf-8'),
);
const compiledRules = JSON.parse(
  fs.readFileSync(path.join(ROOT, '.totem', 'compiled-rules.json'), 'utf-8'),
);

test('MATURITY_TABLE renders header and all three status registers', () => {
  const result = transforms.MATURITY_TABLE();
  assert.ok(result.includes('| Mechanism | Status | Notes |'), 'Missing header');
  assert.ok(result.includes('**Shipped**'), 'Missing Shipped row');
  assert.ok(result.includes('**Partial**'), 'Missing Partial row');
  assert.ok(result.includes('**Goal:**'), 'Missing Goal: row');
});

test('MATURITY_TABLE renders one row per data row (no silent drops)', () => {
  const result = transforms.MATURITY_TABLE();
  const rows = result
    .split('\n')
    .filter((l) => l.startsWith('| ') && !l.startsWith('| Mechanism') && !l.startsWith('| ---'));
  assert.equal(rows.length, maturityData.rows.length);
});

test('ECL row is locked to the ruled register (shipped, non-headline, local-only opt-in)', () => {
  const row = maturityData.rows.find((r) => r.id === 'multi-seat-coordination');
  assert.ok(row, 'multi-seat-coordination row must exist');
  assert.equal(row.status, 'shipped');
  assert.equal(row.headline, false, 'ECL row must stay excluded from headline mechanism billing');
  assert.ok(row.note.includes('local-only'), 'note must carry local-only');
  assert.ok(row.note.includes('opt-in'), 'note must carry opt-in');
});

test('rendered maturity surface contains no purge-list vocabulary', () => {
  const rendered = [
    transforms.MATURITY_TABLE(),
    transforms.RULE_PROVENANCE(),
    transforms.DAYS_UNDER_FREEZE(),
    transforms.LINT_RECEIPT(),
  ].join('\n');
  for (const banned of [
    /governance os/i,
    /auto-?heal/i,
    /self-?healing/i,
    /\bfleet\b/i,
    /shared cognition/i,
    /\bspine\b/i,
  ]) {
    assert.ok(!banned.test(rendered), `Purge-list vocabulary leaked: ${banned}`);
  }
});

test('MATURITY_TABLE fails loud on an unresolvable anchor (the staleness sensor)', () => {
  const bad = writeTmpJson('bad-anchor.json', {
    asOf: maturityData.asOf,
    rows: [
      {
        id: 'x',
        mechanism: 'X',
        status: 'shipped',
        headline: true,
        anchors: [{ kind: 'file', ref: 'does/not/exist.ts' }],
        note: 'n',
      },
    ],
  });
  assert.throws(() => transforms._renderMaturityTable(bad), /staleness sensor/);
});

test('MATURITY_TABLE rejects an unknown status and a missing headline flag', () => {
  const badStatus = writeTmpJson('bad-status.json', {
    asOf: maturityData.asOf,
    rows: [
      {
        id: 'x',
        mechanism: 'X',
        status: 'soon',
        headline: true,
        anchors: [{ kind: 'command', ref: 'lint' }],
        note: 'n',
      },
    ],
  });
  assert.throws(() => transforms._renderMaturityTable(badStatus), /unknown status/);
  const noHeadline = writeTmpJson('no-headline.json', {
    asOf: maturityData.asOf,
    rows: [
      {
        id: 'x',
        mechanism: 'X',
        status: 'shipped',
        anchors: [{ kind: 'command', ref: 'lint' }],
        note: 'n',
      },
    ],
  });
  assert.throws(() => transforms._renderMaturityTable(noHeadline), /headline boolean/);
});

test('RULE_PROVENANCE derives the count from committed data, never a literal', () => {
  const result = transforms.RULE_PROVENANCE();
  assert.ok(
    result.includes(`**${compiledRules.rules.length} compiled rules**`),
    'count must equal rules.length of the committed file',
  );
  assert.ok(result.includes('lessonHash'), 'must name the provenance mechanism');
});

test('DAYS_UNDER_FREEZE derives days from freeze.since and the committed asOf', () => {
  const freeze = JSON.parse(fs.readFileSync(path.join(ROOT, '.totem', 'freeze.json'), 'utf-8'));
  const since = freeze.frozen.find((f) => f.id === 'rule-compilation').since;
  const days = Math.floor((Date.parse(maturityData.asOf) - Date.parse(since)) / 86_400_000);
  const result = transforms.DAYS_UNDER_FREEZE();
  assert.ok(result.includes(`**${since}**`), 'must render the since date');
  assert.ok(result.includes(`**${days} days**`), `must render the derived day count (${days})`);
});

test('LINT_RECEIPT renders the zero-LLM claim only from an attesting receipt', () => {
  const result = transforms.LINT_RECEIPT();
  assert.ok(result.includes('zero LLM calls'), 'must render the receipted claim');
  const fullReceipt = {
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    filesChanged: 1,
    rules: 1,
    errors: 0,
    warnings: 0,
    elapsedMs: 1,
    llmCalls: 1,
    apiKeysStripped: true,
    platform: 'test-x64',
    node: '24.0.0',
    cliVersion: '0.0.0',
    generatedAt: '2026-07-15T00:00:00.000Z',
  };
  const lying = writeTmpJson('bad-receipt.json', fullReceipt);
  assert.throws(() => transforms._renderLintReceipt(lying), /refusing to render/);
  const undefinedField = writeTmpJson('undef-receipt.json', {
    ...fullReceipt,
    llmCalls: 0,
    platform: undefined,
  });
  assert.throws(() => transforms._renderLintReceipt(undefinedField), /missing platform/);
});

test('maturity asOf rejects impossible calendar dates without consulting the clock', () => {
  const badDate = writeTmpJson('bad-date.json', {
    asOf: '2026-02-31',
    rows: maturityData.rows,
  });
  assert.throws(() => transforms._renderMaturityTable(badDate), /not a valid YYYY-MM-DD/);
});

fs.rmSync(TMP, { recursive: true, force: true });

// ── Summary ─────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
