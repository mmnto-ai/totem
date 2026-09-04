/**
 * Tests for the OIDC provenance verifier's visibility budget and the release
 * workflow contract that caps it (mmnto-ai/totem#2748).
 * Run: node --test tools/verify-oidc-provenance.test.mjs (root script test:verify-oidc).
 *
 * No npm is ever spawned here: `fetch`, `sleep`, `now`, `exit`, `env` and the
 * spawner itself are injected, and the clock is fake. Two fixture choices do
 * work: charging the clock inside `fetch` makes it reflect the poll's real
 * cost rather than its sleeps alone, and `sleep: (ms) => clock.advance(ms)`
 * advances by the value the poller ASKED for, so a poller that sleeps some
 * other amount fails. Neither of those is what kills a fixed-attempt poller —
 * the deadline assertion is.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertProvenance,
  fetchNpmView,
  main,
  POLL_INTERVAL_MS,
  pollUntilVisible,
  SPAWN_TIMEOUT_MS,
  VISIBILITY_DEADLINE_MS,
  worstCaseMs,
} from './verify-oidc-provenance.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const readRepoFile = (...rel) => readFileSync(join(repoRoot, ...rel), 'utf-8');

/** Fake clock: `now()` reads it, `advance()` moves it. Nothing here sleeps for real. */
const fakeClock = () => {
  let t = 0;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
};

/** The poller logs one line per round; keep the test output readable. */
const withSilencedConsole = async (fn) => {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
};

const releaseYamlLines = () => readRepoFile('.github', 'workflows', 'release.yml').split(/\r?\n/);

const releaseStepIndex = (lines, stepName) => {
  const start = lines.findIndex((line) => line.includes(`name: ${stepName}`));
  assert.notEqual(start, -1, `release.yml has no step named ${JSON.stringify(stepName)}`);
  return start;
};

/**
 * The lines belonging to one `- name: <stepName>` step in release.yml (up to
 * the next `- name:`/`- uses:`/`- run:`).
 */
const releaseStepLines = (stepName) => {
  const lines = releaseYamlLines();
  const block = [];
  for (let i = releaseStepIndex(lines, stepName) + 1; i < lines.length; i++) {
    if (/^\s*-\s+(name|uses|run):/.test(lines[i])) break;
    block.push(lines[i]);
  }
  return block;
};

/** The contiguous `#` comment block directly above a step. */
const releaseStepComment = (stepName) => {
  const lines = releaseYamlLines();
  const comment = [];
  for (let i = releaseStepIndex(lines, stepName) - 1; i >= 0; i--) {
    if (!/^\s*#/.test(lines[i])) break;
    comment.unshift(lines[i]);
  }
  return comment;
};

const SPEC_A = '@mmnto/cli@1.124.0';
const SPEC_B = '@mmnto/totem@1.124.0';
const SPEC_C = '@mmnto/mcp@1.124.0';

const OIDC_RECORD = {
  _npmUser: 'GitHub Actions <npm-oidc-no-reply@github.com>',
  dist: {
    attestations: {
      url: 'https://registry.npmjs.org/-/npm/v1/attestations/@mmnto%2fcli@1.124.0',
      provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
    },
    signatures: [{ keyid: 'SHA256:jl3bwswu80PjjokCgh0o2w5c2U4LhQAE57gj9cz1kzA', sig: 'MEUCIQ' }],
  },
};

/** The same record with a human publisher and no attestations — token auth. */
const TOKEN_AUTH_RECORD = {
  _npmUser: 'someone <dev@example.com>',
  dist: { signatures: OIDC_RECORD.dist.signatures },
};

/**
 * One shared three-package poll: A visible in round 1, B in round 3, C never.
 * T3 and T4 both read its call log, so it runs once and is memoised. The
 * poller is called on its shipped defaults (no deadlineMs/intervalMs).
 */
let threeSpecRun = null;
const runThreeSpecPoll = () => {
  threeSpecRun ??= withSilencedConsole(async () => {
    const clock = fakeClock();
    const callLog = [];
    let round = 1;
    const fetch = (spec) => {
      callLog.push({ round, spec });
      clock.advance(500);
      if (spec === SPEC_A) return { ok: true, data: { spec: SPEC_A } };
      if (spec === SPEC_B && round >= 3) return { ok: true, data: { spec: SPEC_B } };
      return { ok: false, err: `E404 ${spec}` };
    };
    const sleep = async (ms) => {
      round += 1;
      clock.advance(ms);
    };
    const { resolved, missing } = await pollUntilVisible([SPEC_A, SPEC_B, SPEC_C], {
      fetch,
      sleep,
      now: clock.now,
    });
    return { resolved, missing, callLog, clock };
  });
  return threeSpecRun;
};

/** Sentinel thrown by the injected `exit` so `main` stops where process.exit would. */
const EXIT_SENTINEL = Symbol('process.exit');

/**
 * Drives `main` with an injected clock, exit and env; captures both streams.
 * `throwOnExit: false` records the code and lets `main` keep running, which
 * is how the `return` guarding the fall-through past `exit(1)` gets observed.
 */
const runMain = async ({ publishedPackages, fetch, throwOnExit = true }) => {
  const clock = fakeClock();
  const exitCodes = [];
  const stdout = [];
  const stderr = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => stdout.push(args.map(String).join(' '));
  console.error = (...args) => stderr.push(args.map(String).join(' '));
  try {
    await main({
      fetch,
      sleep: async (ms) => clock.advance(ms),
      now: clock.now,
      exit: (code) => {
        exitCodes.push(code);
        if (throwOnExit) throw EXIT_SENTINEL;
      },
      env: { PUBLISHED_PACKAGES: publishedPackages },
    });
  } catch (err) {
    if (err !== EXIT_SENTINEL) throw err;
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return { exitCodes, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
};

test('deadline covers the measured 7-minute propagation', () => {
  assert.ok(
    VISIBILITY_DEADLINE_MS >= 7 * 60_000,
    `VISIBILITY_DEADLINE_MS = ${VISIBILITY_DEADLINE_MS}ms, expected >= ${7 * 60_000}ms (mmnto-ai/totem#2748 measured 6m57s)`,
  );
});

test('a persistently invisible package is polled until the deadline, not a fixed attempt count', async () => {
  const clock = fakeClock();
  // Local mirrors of the shipped defaults, for the assertions only: the
  // poller below is called WITHOUT deadlineMs/intervalMs, so what runs is the
  // default budget the release workflow actually gets.
  const deadlineMs = VISIBILITY_DEADLINE_MS;
  const intervalMs = POLL_INTERVAL_MS;
  let calls = 0;

  const { resolved, missing } = await withSilencedConsole(() =>
    pollUntilVisible([SPEC_B], {
      fetch: () => {
        calls += 1;
        clock.advance(500);
        return { ok: false, err: 'E404' };
      },
      sleep: async (ms) => clock.advance(ms),
      now: clock.now,
    }),
  );

  assert.equal(resolved.size, 0);
  assert.ok(
    clock.now() >= deadlineMs,
    `poller returned at t=${clock.now()}ms, before the deadline ${deadlineMs}ms`,
  );
  // Loose on purpose: the clock-vs-deadline assertion above is the
  // contract-bearing one. A tight deadline/interval count would false-red the
  // moment the fixture's per-fetch cost grows.
  assert.ok(
    calls >= Math.floor(deadlineMs / (intervalMs * 2)),
    `only ${calls} fetch call(s); expected >= ${Math.floor(deadlineMs / (intervalMs * 2))}`,
  );
  assert.equal(missing.get(SPEC_B), 'E404');
});

test('all packages are polled before failing; one slow package does not hide the others', async () => {
  const { resolved, missing, callLog, clock } = await runThreeSpecPoll();

  assert.deepEqual([...resolved.keys()], [SPEC_A, SPEC_B]);
  assert.deepEqual(resolved.get(SPEC_A), { spec: SPEC_A });
  assert.deepEqual(resolved.get(SPEC_B), { spec: SPEC_B });
  assert.deepEqual([...missing.keys()], [SPEC_C]);
  assert.equal(missing.get(SPEC_C), `E404 ${SPEC_C}`);

  // C never resolves, so a poll on the shipped defaults runs to the default
  // deadline — the constant the workflow ships is what this exercises.
  assert.ok(
    clock.now() >= VISIBILITY_DEADLINE_MS,
    `poll returned at t=${clock.now()}ms, before the default deadline ${VISIBILITY_DEADLINE_MS}ms`,
  );

  // Every round fetches exactly the specs still pending when it starts, in
  // input order: A drops out after round 1, B after round 3, C never — so
  // rounds 4..N (the deadline decides N) poll C alone.
  const byRound = new Map();
  for (const { round, spec } of callLog) {
    if (!byRound.has(round)) byRound.set(round, []);
    byRound.get(round).push(spec);
  }
  const rounds = [...byRound.keys()];
  assert.deepEqual(
    rounds,
    Array.from({ length: rounds.length }, (_unused, i) => i + 1),
    'rounds must be contiguous from 1',
  );
  assert.ok(rounds.length >= 3, `only ${rounds.length} round(s); B resolves in round 3`);
  assert.deepEqual(byRound.get(1), [SPEC_A, SPEC_B, SPEC_C]);
  assert.deepEqual(byRound.get(2), [SPEC_B, SPEC_C]);
  assert.deepEqual(byRound.get(3), [SPEC_B, SPEC_C]);
  for (const round of rounds.slice(3)) {
    assert.deepEqual(byRound.get(round), [SPEC_C], `round ${round} must poll only ${SPEC_C}`);
  }
});

test('a resolved package is not fetched again', async () => {
  const { callLog } = await runThreeSpecPoll();
  assert.equal(
    callLog.filter((call) => call.spec === SPEC_A).length,
    1,
    `${SPEC_A} resolved in round 1 and must never be fetched again`,
  );
});

test('a throwing fetch propagates (hard failures stay loud)', async () => {
  await assert.rejects(
    () =>
      withSilencedConsole(() =>
        pollUntilVisible([SPEC_A], {
          fetch: () => {
            throw new Error('[Totem Error] verify-oidc: npm view spawn failed');
          },
          sleep: async () => {},
          now: () => 0,
        }),
      ),
    /npm view spawn failed/,
  );
});

test("the workflow's outer cap covers the ceiling for every published package", () => {
  const block = releaseStepLines('Verify OIDC provenance on published packages');

  // The cap must sit on the step that actually runs the poller.
  assert.ok(
    block.some((line) => line.includes('run: node tools/verify-oidc-provenance.mjs')),
    'the located step does not run tools/verify-oidc-provenance.mjs',
  );

  const timeoutLine = block.find((line) => /^\s*timeout-minutes:\s*\d+\s*$/.test(line));
  assert.ok(timeoutLine, 'the verify step has no timeout-minutes');
  const timeoutMinutes = Number(timeoutLine.match(/timeout-minutes:\s*(\d+)/)[1]);

  const packagesDir = join(repoRoot, 'packages');
  const publishedCount = readdirSync(packagesDir)
    .map((name) => join(packagesDir, name, 'package.json'))
    .filter((manifest) => {
      try {
        return statSync(manifest).isFile();
      } catch {
        return false;
      }
    })
    .filter((manifest) => JSON.parse(readFileSync(manifest, 'utf-8')).private !== true).length;

  assert.ok(publishedCount >= 1, 'no publishable packages found under packages/');
  assert.ok(
    timeoutMinutes * 60_000 >= worstCaseMs(publishedCount),
    `timeout-minutes: ${timeoutMinutes} (${timeoutMinutes * 60_000}ms) is below the ceiling worstCaseMs(${publishedCount}) = ${worstCaseMs(publishedCount)}ms`,
  );

  // The budget is stated twice — beside the constants and in the workflow
  // comment. Pin the workflow copy so a constant change without the prose
  // fails CI rather than leaving stale arithmetic in the release lane. Each
  // pin is anchored to ITS OWN line: matching anywhere in the block would let
  // the CEILING line's "11 min 35 s" satisfy a floor pin for 11 min.
  const comment = releaseStepComment('Verify OIDC provenance on published packages');

  const floorLine = comment.find((line) => /FLOOR/.test(line));
  assert.ok(floorLine, "the verify step's comment block has no FLOOR line");
  const floorMinutes = `${VISIBILITY_DEADLINE_MS / 60_000} min`;
  assert.ok(
    floorLine.includes(floorMinutes),
    `the FLOOR line must state ${JSON.stringify(floorMinutes)}; got: ${floorLine.trim()}`,
  );

  const ceilingLine = comment.find((line) => /CEILING/.test(line));
  assert.ok(ceilingLine, "the verify step's comment block has no CEILING line");
  const intervalSeconds = `${POLL_INTERVAL_MS / 1000} s`;
  const spawnSeconds = `${SPAWN_TIMEOUT_MS / 1000} s`;
  assert.ok(
    ceilingLine.includes(intervalSeconds),
    `the CEILING line must state the poll interval as ${JSON.stringify(intervalSeconds)}; got: ${ceilingLine.trim()}`,
  );
  assert.ok(
    ceilingLine.includes(spawnSeconds),
    `the CEILING line must state the spawn timeout as ${JSON.stringify(spawnSeconds)}; got: ${ceilingLine.trim()}`,
  );
});

test('the tag push rides the publish verdict, not the verify verdict', () => {
  const block = releaseStepLines('Push release tags');
  const ifLine = block.find((line) => /^\s*if:/.test(line));
  assert.ok(ifLine, 'the Push release tags step has no if: condition');
  // Conjunction, not disjunction: an `||` mutant would still contain both
  // operands as substrings, so match the whole relation.
  assert.match(ifLine, /!cancelled\(\)\s*&&\s*steps\.publish\.outputs\.published\s*==\s*'true'/);
  assert.ok(
    !ifLine.includes('steps.verify'),
    `the tag push must not gate on the verify step; got: ${ifLine.trim()}`,
  );
  assert.ok(
    !ifLine.includes('success()'),
    `success() would re-couple the tag push to every prior step; got: ${ifLine.trim()}`,
  );
});

test('assertProvenance accepts an OIDC-shaped record and rejects a token-auth one', () => {
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    assert.equal(assertProvenance(SPEC_A, OIDC_RECORD), true);
    assert.equal(assertProvenance(SPEC_A, TOKEN_AUTH_RECORD), false);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});

test('main exits 1 when a package never becomes visible, exits 1 on a token-auth record, and does not exit when every package verifies', async () => {
  const published = `${SPEC_A}\n${SPEC_B}`;

  // Non-throwing exit: `main` runs on past `exit(1)`, so the `return` that
  // guards the fall-through is what keeps the all-verified line off stdout.
  const miss = await runMain({
    publishedPackages: published,
    fetch: (spec) =>
      spec === SPEC_A ? { ok: true, data: OIDC_RECORD } : { ok: false, err: 'E404' },
    throwOnExit: false,
  });
  assert.deepEqual(miss.exitCodes, [1], 'a package that never becomes visible must exit 1');
  assert.match(miss.stderr, /never became visible/);
  assert.match(miss.stderr, /registry propagation, not a provenance verdict/);
  assert.doesNotMatch(miss.stdout, /All \d+ package\(s\) verified/);

  const tokenAuth = await runMain({
    publishedPackages: published,
    fetch: (spec) => ({ ok: true, data: spec === SPEC_A ? OIDC_RECORD : TOKEN_AUTH_RECORD }),
  });
  assert.deepEqual(tokenAuth.exitCodes, [1], 'a token-auth record must exit 1');
  assert.match(tokenAuth.stderr, /failed provenance check/);

  const allVerified = await runMain({
    publishedPackages: published,
    fetch: () => ({ ok: true, data: OIDC_RECORD }),
  });
  assert.deepEqual(allVerified.exitCodes, [], 'a clean run must not exit');
  assert.match(allVerified.stdout, /All 2 package\(s\) verified/);
});

test('worstCaseMs is a tight upper bound on the poller wall time', async () => {
  // Worst case: every package burns a full spawn timeout, every round, and
  // none ever resolves. Bounding from BOTH sides is the point — an
  // upper-bound-only assertion is satisfied by any overstated formula, so an
  // understated one (dropping the final interval, say) has to fail too.
  for (const n of [1, 2, 4, 8]) {
    const specs = Array.from({ length: n }, (_unused, i) => `@mmnto/pkg-${i}@1.0.0`);
    const clock = fakeClock();

    await withSilencedConsole(() =>
      pollUntilVisible(specs, {
        fetch: () => {
          clock.advance(SPAWN_TIMEOUT_MS);
          return { ok: false, err: 'E404' };
        },
        sleep: async (ms) => clock.advance(ms),
        now: clock.now,
      }),
    );

    const elapsed = clock.now();
    const ceiling = worstCaseMs(n);
    const understated = ceiling - POLL_INTERVAL_MS - n * SPAWN_TIMEOUT_MS;
    assert.ok(
      elapsed <= ceiling,
      `n=${n}: the poll ran ${elapsed}ms, past the ceiling worstCaseMs(${n}) = ${ceiling}ms`,
    );
    assert.ok(
      elapsed > understated,
      `n=${n}: the poll ran ${elapsed}ms, which a ceiling of ${understated}ms would already cover — worstCaseMs(${n}) = ${ceiling}ms overstates`,
    );
  }
});

test('a timed-out npm view keeps the package pending; a spawn failure still throws', () => {
  const timedOut = () => ({ error: Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' }) });
  const result = fetchNpmView(SPEC_A, timedOut);
  assert.equal(result.ok, false);
  assert.equal(result.err, `npm view timed out after ${SPAWN_TIMEOUT_MS}ms`);

  const enoent = () => ({ error: Object.assign(new Error('nope'), { code: 'ENOENT' }) });
  assert.throws(() => fetchNpmView(SPEC_A, enoent), /npm view spawn failed/);
});
