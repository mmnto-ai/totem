/**
 * Tests for the OIDC provenance verifier's visibility budget and the release
 * workflow contract that caps it (mmnto-ai/totem#2748).
 * Run: node --test tools/verify-oidc-provenance.test.mjs (root script test:verify-oidc).
 *
 * No npm is ever spawned here: `fetch`, `sleep` and `now` are injected, and
 * the clock is fake — `sleep` advances it by the poll interval.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertProvenance,
  POLL_INTERVAL_MS,
  pollUntilVisible,
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

/**
 * Reads the block of lines belonging to one `- name: <stepName>` step in
 * .github/workflows/release.yml (up to the next `- name:`/`- uses:`/`- run:`).
 */
const releaseStepLines = (stepName) => {
  const lines = readRepoFile('.github', 'workflows', 'release.yml').split(/\r?\n/);
  const start = lines.findIndex((line) => line.includes(`name: ${stepName}`));
  assert.notEqual(start, -1, `release.yml has no step named ${JSON.stringify(stepName)}`);
  const block = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*-\s+(name|uses|run):/.test(lines[i])) break;
    block.push(lines[i]);
  }
  return block;
};

const SPEC_A = '@mmnto/cli@1.124.0';
const SPEC_B = '@mmnto/totem@1.124.0';
const SPEC_C = '@mmnto/mcp@1.124.0';

/**
 * One shared three-package poll: A visible in round 1, B in round 3, C never.
 * T3 and T4 both read its call log, so it runs once and is memoised.
 */
let threeSpecRun = null;
const runThreeSpecPoll = () => {
  threeSpecRun ??= withSilencedConsole(async () => {
    const clock = fakeClock();
    const callLog = [];
    let round = 1;
    const fetch = (spec) => {
      callLog.push({ round, spec });
      if (spec === SPEC_A) return { ok: true, data: { spec: SPEC_A } };
      if (spec === SPEC_B && round >= 3) return { ok: true, data: { spec: SPEC_B } };
      return { ok: false, err: `E404 ${spec}` };
    };
    const sleep = async () => {
      round += 1;
      clock.advance(POLL_INTERVAL_MS);
    };
    const { resolved, missing } = await pollUntilVisible([SPEC_A, SPEC_B, SPEC_C], {
      fetch,
      sleep,
      now: clock.now,
    });
    return { resolved, missing, callLog };
  });
  return threeSpecRun;
};

test('deadline covers the measured 7-minute propagation', () => {
  assert.ok(
    VISIBILITY_DEADLINE_MS >= 7 * 60_000,
    `VISIBILITY_DEADLINE_MS = ${VISIBILITY_DEADLINE_MS}ms, expected >= ${7 * 60_000}ms (mmnto-ai/totem#2748 measured 6m57s)`,
  );
});

test('a persistently invisible package is polled until the deadline, not a fixed attempt count', async () => {
  const clock = fakeClock();
  const deadlineMs = VISIBILITY_DEADLINE_MS;
  const intervalMs = POLL_INTERVAL_MS;
  let calls = 0;

  const { resolved, missing } = await withSilencedConsole(() =>
    pollUntilVisible([SPEC_B], {
      fetch: () => {
        calls += 1;
        return { ok: false, err: 'E404' };
      },
      sleep: async () => clock.advance(intervalMs),
      now: clock.now,
      deadlineMs,
      intervalMs,
    }),
  );

  assert.equal(resolved.size, 0);
  assert.ok(
    clock.now() >= deadlineMs,
    `poller returned at t=${clock.now()}ms, before the deadline ${deadlineMs}ms`,
  );
  assert.ok(
    calls >= Math.floor(deadlineMs / intervalMs),
    `only ${calls} fetch call(s); expected >= ${Math.floor(deadlineMs / intervalMs)} (deadline / interval)`,
  );
  assert.equal(missing.get(SPEC_B), 'E404');
});

test('all packages are polled before failing; one slow package does not hide the others', async () => {
  const { resolved, missing, callLog } = await runThreeSpecPoll();

  assert.deepEqual([...resolved.keys()], [SPEC_A, SPEC_B]);
  assert.deepEqual(resolved.get(SPEC_A), { spec: SPEC_A });
  assert.deepEqual(resolved.get(SPEC_B), { spec: SPEC_B });
  assert.deepEqual([...missing.keys()], [SPEC_C]);
  assert.equal(missing.get(SPEC_C), `E404 ${SPEC_C}`);

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
});

test('the tag push rides the publish verdict, not the verify verdict', () => {
  const block = releaseStepLines('Push release tags');
  const ifLine = block.find((line) => /^\s*if:/.test(line));
  assert.ok(ifLine, 'the Push release tags step has no if: condition');
  assert.match(ifLine, /!cancelled\(\)/);
  assert.ok(
    ifLine.includes("steps.publish.outputs.published == 'true'"),
    `the tag push must gate on the publish output; got: ${ifLine.trim()}`,
  );
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
  const oidc = {
    _npmUser: 'GitHub Actions <npm-oidc-no-reply@github.com>',
    dist: {
      attestations: {
        url: 'https://registry.npmjs.org/-/npm/v1/attestations/@mmnto%2fcli@1.124.0',
        provenance: { predicateType: 'https://slsa.dev/provenance/v1' },
      },
      signatures: [{ keyid: 'SHA256:jl3bwswu80PjjokCgh0o2w5c2U4LhQAE57gj9cz1kzA', sig: 'MEUCIQ' }],
    },
  };
  const tokenAuth = {
    _npmUser: 'someone <dev@example.com>',
    dist: { signatures: oidc.dist.signatures },
  };

  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    assert.equal(assertProvenance(SPEC_A, oidc), true);
    assert.equal(assertProvenance(SPEC_A, tokenAuth), false);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});
