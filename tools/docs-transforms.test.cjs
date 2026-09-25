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
  // The active set renders beside the compiled total, from the same predicate
  // ACTIVE_RULE_COUNT uses, and the page says which measure the receipt takes
  // (mmnto-ai/totem#2931 item 4).
  assert.ok(
    result.includes(`**${transforms.ACTIVE_RULE_COUNT()} are active**`),
    'active count must equal ACTIVE_RULE_COUNT',
  );
  assert.ok(result.includes('the active set at its pinned head'), 'must name the receipt measure');
});

test('RULE_PROVENANCE takes the active predicate as a parameter and derives the inactive reasons from status', () => {
  const mixed = writeTmpJson('provenance-mixed.json', {
    rules: [
      { lessonHash: 'a', compiledAt: '2026-04-06T00:00:00.000Z', engine: 'regex' },
      {
        lessonHash: 'b',
        compiledAt: '2026-04-07T00:00:00.000Z',
        engine: 'regex',
        status: 'archived',
      },
      {
        lessonHash: 'c',
        compiledAt: '2026-04-08T00:00:00.000Z',
        engine: 'ast-grep',
        status: 'untested-against-codebase',
      },
      {
        lessonHash: 'd',
        compiledAt: '2026-04-09T00:00:00.000Z',
        engine: 'ast-grep',
        status: 'pending-verification',
      },
    ],
  });
  // A predicate that DISAGREES with core's (which would count 1 active here):
  // everything active. The parameter is honoured only if the text follows it.
  const all = transforms._renderRuleProvenance(mixed, () => true);
  assert.ok(all.includes('**4 compiled rules**'));
  assert.ok(all.includes('**4 are active**'));
  assert.ok(all.includes('none are inactive'));
  // A second disagreeing predicate: archived is the only inactive status.
  const noArchived = transforms._renderRuleProvenance(mixed, (r) => r.status !== 'archived');
  assert.ok(noArchived.includes('**3 are active**'));
  assert.ok(noArchived.includes('the other 1 are inactive (1 archived)'));
  // Core's own shape: every status inactive, each named from the artifact.
  const coreLike = transforms._renderRuleProvenance(mixed, (r) => r.status === undefined);
  assert.ok(coreLike.includes('**1 are active**'));
  assert.ok(
    coreLike.includes(
      'the other 3 are inactive (1 archived, 1 pending verification, 1 untested against the codebase)',
    ),
  );
});

// ── Inline figures (fragments for prose) ─────────────────────────────────
// Each derives from the committed file with the same predicate the page's
// prose states, never from a literal, so a rotted hand-typed copy cannot
// pass here while the artifact says otherwise.

test('RULE_PROVENANCE_RATIO renders hashed-over-total from committed data and fails loud on a hash-less rule', () => {
  const hashed = compiledRules.rules.filter(
    (r) => typeof r.lessonHash === 'string' && r.lessonHash.length > 0,
  ).length;
  assert.equal(transforms.RULE_PROVENANCE_RATIO(), `${hashed} of ${compiledRules.rules.length}`);
  assert.match(transforms.RULE_PROVENANCE_RATIO(), /^\d+ of \d+$/);
  // Discriminating: three hashed rules render "3 of 3"; a rule with no hash
  // (or an empty one) is the corruption the sentence denies, so the figure
  // refuses to render rather than publishing a ratio that contradicts it —
  // the same guard the block transform carries for the maturity page.
  const hashedOnly = writeTmpJson('ratio-hashed.json', {
    rules: [{ lessonHash: 'a' }, { lessonHash: 'b' }, { lessonHash: 'c' }],
  });
  assert.equal(transforms._renderRuleProvenanceRatio(hashedOnly), '3 of 3');
  const hashless = writeTmpJson('ratio-hashless.json', {
    rules: [{ lessonHash: 'a' }, {}],
  });
  assert.throws(() => transforms._renderRuleProvenanceRatio(hashless), /no lessonHash/);
  const emptyHash = writeTmpJson('ratio-empty-hash.json', {
    rules: [{ lessonHash: '' }],
  });
  assert.throws(() => transforms._renderRuleProvenanceRatio(emptyHash), /no lessonHash/);
});

test("ACTIVE_RULE_COUNT derives the runnable count through core's canonical predicate, never a mirrored status test", () => {
  const core = require('../packages/core/dist/index.js');
  const active = compiledRules.rules.filter(core.isActiveCompiledRule).length;
  assert.equal(transforms.ACTIVE_RULE_COUNT(), String(active));
  // The artifact carries archived and untested-against-codebase rules today,
  // so the canonical count sits at or below the non-archived count — the
  // figure the pages used to publish as if it were what the linter runs.
  const nonArchived = compiledRules.rules.filter((r) => r.status !== 'archived').length;
  assert.ok(active <= nonArchived, `active ${active} must not exceed non-archived ${nonArchived}`);
  // Discriminating: every status the predicate excludes, plus one it keeps.
  const mixed = writeTmpJson('mixed-status.json', {
    rules: [
      { lessonHash: 'a', status: 'archived' },
      { lessonHash: 'b' },
      { lessonHash: 'c', status: 'untested-against-codebase' },
      { lessonHash: 'd', status: 'pending-verification' },
    ],
  });
  assert.equal(transforms._renderActiveRuleCount(mixed), '1');
  // A hash-less rule fails loud here too: the validation lives in the loader,
  // so every figure derived from the file shares it.
  const hashless = writeTmpJson('active-hashless.json', { rules: [{ status: 'archived' }] });
  assert.throws(() => transforms._renderActiveRuleCount(hashless), /no lessonHash/);
  const lessonHashless = writeTmpJson('lesson-hashless.json', {
    rules: [{ lessonHash: 'a' }, {}],
    nonCompilable: Array.from({ length: 200 }, () => ({})),
  });
  assert.throws(() => transforms._renderLessonRecordCount(lessonHashless), /no lessonHash/);
});

test('LESSON_RECORD_COUNT rounds distinct-plus-non-compilable to the nearest hundred', () => {
  const distinct = new Set(compiledRules.rules.map((r) => r.lessonHash)).size;
  const rest = Array.isArray(compiledRules.nonCompilable) ? compiledRules.nonCompilable.length : 0;
  const rounded = Math.round((distinct + rest) / 100) * 100;
  assert.equal(transforms.LESSON_RECORD_COUNT(), `about ${rounded.toLocaleString('en-US')}`);
  // Discriminating fixtures, one per behaviour the name asserts. Rounding:
  // 150 distinct + 1500 = 1650 rounds UP to 1,700 (a floor would say 1,600).
  const round = writeTmpJson('round-rules.json', {
    rules: Array.from({ length: 150 }, (_, i) => ({ lessonHash: `h${i}` })),
    nonCompilable: Array.from({ length: 1500 }, () => ({})),
  });
  assert.equal(transforms._renderLessonRecordCount(round), 'about 1,700');
  // Distinct: 150 rules over 50 hashes + 1600 = 1650 → 1,700 (counting rules
  // instead of distinct lessons would say 1,750 → 1,800).
  const duplicates = writeTmpJson('duplicate-hash-rules.json', {
    rules: Array.from({ length: 150 }, (_, i) => ({ lessonHash: `h${i % 50}` })),
    nonCompilable: Array.from({ length: 1600 }, () => ({})),
  });
  assert.equal(transforms._renderLessonRecordCount(duplicates), 'about 1,700');
  // A corpus under one hundred cannot be stated as "about N hundred": the
  // figure refuses (it used to publish "about 0" for five records).
  const tiny = writeTmpJson('tiny-rules.json', {
    rules: [{ lessonHash: 'a' }, { lessonHash: 'b' }],
    nonCompilable: [{}, {}, {}],
  });
  assert.throws(() => transforms._renderLessonRecordCount(tiny), /too few/);
  const ninetyNine = writeTmpJson('ninety-nine-rules.json', {
    rules: [{ lessonHash: 'a' }],
    nonCompilable: Array.from({ length: 98 }, () => ({})),
  });
  assert.throws(() => transforms._renderLessonRecordCount(ninetyNine), /too few/);
  const hundred = writeTmpJson('hundred-rules.json', {
    rules: [{ lessonHash: 'a' }],
    nonCompilable: Array.from({ length: 99 }, () => ({})),
  });
  assert.equal(transforms._renderLessonRecordCount(hundred), 'about 100');
  const empty = writeTmpJson('empty-rules.json', { rules: [] });
  assert.throws(() => transforms._renderLessonRecordCount(empty), /no rules array/);
});

test('FREEZE_SINCE_MONTH renders the month and year of freeze.since in UTC, and fails loud without the entry', () => {
  const freeze = JSON.parse(fs.readFileSync(path.join(ROOT, '.totem', 'freeze.json'), 'utf-8'));
  const since = freeze.frozen.find((f) => f.id === 'rule-compilation').since;
  const d = new Date(since);
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  assert.equal(transforms.FREEZE_SINCE_MONTH(), `${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`);
  // The render reads UTC fields, so a date-only since (midnight UTC) never
  // shifts in-process whatever the zone. The hazard a local-time getter would
  // introduce lies WEST of UTC on a first-of-month since, where midnight UTC
  // is still the previous evening — and the previous month, and on January 1
  // the previous year. In-process this test runs in whatever zone the machine
  // has, so the discriminating check runs the render in a child process pinned
  // to the westmost zone (Etc/GMT+12 is UTC-12 in POSIX's inverted sign).
  const lifted = writeTmpJson('lifted-freeze.json', { frozen: [] });
  assert.throws(() => transforms._renderFreezeSinceMonth(lifted), /no rule-compilation entry/);
  const { execFileSync } = require('node:child_process');
  const modulePath = path.join(__dirname, 'docs-transforms.cjs');
  const renderWest = (since) => {
    const fixture = writeTmpJson(`west-${since}.json`, {
      frozen: [{ id: 'rule-compilation', since }],
    });
    const script = `process.stdout.write(require(${JSON.stringify(modulePath)})._renderFreezeSinceMonth(${JSON.stringify(fixture)}))`;
    return execFileSync(process.execPath, ['-e', script], {
      env: { ...process.env, TZ: 'Etc/GMT+12' },
      encoding: 'utf-8',
    });
  };
  assert.equal(renderWest('2026-06-01'), 'June 2026');
  assert.equal(renderWest('2026-01-01'), 'January 2026');
  assert.equal(renderWest('2026-05-31'), 'May 2026');
});

test('every docs marker in README.md and docs/**/*.md names a registered transform (a misspelled name is fail-quiet in the injector)', () => {
  // markdown-magic reports a missing transform to stdout and still resolves,
  // so docs-inject exits 0 and the hand-typed literal survives — the drift
  // gate stays green on exactly the figure the markers exist to abolish. This
  // lock fails the docs test instead.
  const config = require('../md.config.cjs');
  const registered = new Set(Object.keys(config.transforms));
  const files = [path.join(ROOT, 'README.md')];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.md')) files.push(p);
    }
  };
  walk(path.join(ROOT, 'docs'));
  const unknown = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf-8');
    for (const match of text.matchAll(/<!-- docs ([A-Za-z0-9_]+)/g)) {
      if (!registered.has(match[1])) unknown.push(`${path.relative(ROOT, file)}: ${match[1]}`);
    }
  }
  assert.deepEqual(unknown, [], 'every marker must name a registered transform');
  // The landed page's three figures ride markers, not literals.
  const page = fs.readFileSync(path.join(ROOT, 'docs', 'wiki', 'how-totem-gets-built.md'), 'utf-8');
  for (const name of ['RULE_PROVENANCE_RATIO', 'LESSON_RECORD_COUNT', 'FREEZE_SINCE_MONTH']) {
    assert.ok(page.includes(`<!-- docs ${name} -->`), `page must carry the ${name} marker`);
  }
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
  // The page separates what CI recomputes (the pinned fields) from what a
  // maintainer's regeneration stamps (the environment labels) — the old
  // sentence read as if CI refreshed the whole receipt (mmnto-ai/totem#2931 item 1).
  assert.ok(result.includes('the active set at the pinned head'), 'must scope the rule count');
  assert.ok(result.includes('the pinned fields'), 'must name what CI recomputes');
  // The consequence is the check that fails, not a merge block the repository's
  // required checks do not enforce (leg F1 on mmnto-ai/totem#2931).
  assert.ok(result.includes('the Docs Governance check fails'), 'must name the real consequence');
  assert.ok(!result.includes('merge blocks'), 'must not claim a merge block');
  assert.ok(
    result.includes('the last time a maintainer regenerated the receipt'),
    'must say what the environment line records',
  );
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

test('LINT_RECEIPT posture fields render disclosed, absent, or fail loud — never undefined', () => {
  const base = {
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    filesChanged: 1,
    rules: 1,
    errors: 0,
    warnings: 0,
    elapsedMs: 1,
    llmCalls: 0,
    apiKeysStripped: true,
    platform: 'test-x64',
    node: '24.0.0',
    cliVersion: '0.0.0',
    generatedAt: '2026-07-15T00:00:00.000Z',
  };
  // Legacy receipt (no posture fields): renders, with no posture sentence.
  const legacy = transforms._renderLintReceipt(writeTmpJson('legacy-receipt.json', base));
  assert.ok(!legacy.includes('ast-parse-mode'), 'legacy receipt must not render a posture clause');
  // Lenient + boolean: posture disclosed on the page, value interpolated.
  const lenient = transforms._renderLintReceipt(
    writeTmpJson('lenient-receipt.json', {
      ...base,
      astParseMode: 'lenient',
      targetMismatchGuardWarning: true,
    }),
  );
  assert.ok(
    lenient.includes('--ast-parse-mode lenient') &&
      lenient.includes('targetMismatchGuardWarning: true'),
    'lenient receipt must disclose the posture and the guard outcome',
  );
  // Unknown mode: fail loud, never silently hide the posture.
  assert.throws(
    () =>
      transforms._renderLintReceipt(
        writeTmpJson('badmode-receipt.json', { ...base, astParseMode: 'permissive' }),
      ),
    /invalid astParseMode/,
  );
  // Lenient without the guard boolean: fail loud, never interpolate undefined.
  assert.throws(
    () =>
      transforms._renderLintReceipt(
        writeTmpJson('noflag-receipt.json', { ...base, astParseMode: 'lenient' }),
      ),
    /missing boolean targetMismatchGuardWarning/,
  );
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
