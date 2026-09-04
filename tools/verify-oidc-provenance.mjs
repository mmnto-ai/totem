#!/usr/bin/env node
/**
 * Verifies that just-published `@mmnto/*` packages carry sigstore-signed
 * OIDC provenance — and not token-auth metadata.
 *
 * Runs after `tools/publish-oidc.mjs` in the release workflow. Reads
 * `PUBLISHED_PACKAGES` (newline-separated `name@version` list, produced by
 * publish-oidc's GITHUB_OUTPUT) and asserts, per package, against the npm
 * registry:
 *
 *   1. `_npmUser.email === 'npm-oidc-no-reply@github.com'`
 *   2. `_npmUser.name === 'GitHub Actions'`
 *   3. `dist.attestations.url` is non-empty
 *   4. `dist.attestations.provenance.predicateType === 'https://slsa.dev/provenance/v1'`
 *   5. `dist.signatures` is non-empty
 *
 * Failure of any assertion exits non-zero with a diagnostic, failing the
 * release workflow loud. Catches silent regression to token-auth publishing
 * (e.g., if a future change re-introduces `NPM_TOKEN` or `registry-url` and
 * OIDC negotiation falls back unnoticed).
 *
 * VISIBILITY BUDGET (mmnto-ai/totem#2748). The npm registry makes a
 * just-published package readable on a lag that is minutes, not seconds, and
 * the lag is per-package inside a single publish. Two measured data from that
 * issue: on the 1.123.0 cut npm made `@mmnto/totem` visible 2 min 20 s AFTER
 * this step had already given up (its budget then was 5 attempts separated by
 * 4 × 5 s sleeps — about 20 s of waiting; the step itself ran 21 s); on the
 * 1.124.0 cut the same package was visible 6 min 57 s after the merge, with a
 * per-package spread inside that one publish of 0:56 → 6:57.
 *
 * So the script polls rather than retries per package: `pollUntilVisible`
 * walks every still-pending spec once per round, then sleeps
 * POLL_INTERVAL_MS, and a spec resolved in an earlier round is never fetched
 * again. One slow package therefore cannot hide the others.
 *
 *   FLOOR   — VISIBILITY_DEADLINE_MS (10 min). A package that stays invisible
 *             is polled for AT LEAST this long from the start of polling.
 *             The 1.124.0 datum is 6 min 57 s measured from the merge but
 *             5 min 45 s measured from this step's start, and the poller's
 *             clock starts at the step — so the deadline bounds the step's
 *             clock, with margin over both figures.
 *   CEILING — worstCaseMs(n) = VISIBILITY_DEADLINE_MS + POLL_INTERVAL_MS
 *             + n × SPAWN_TIMEOUT_MS. The deadline is checked AFTER a round
 *             and BEFORE the sleep, so the final round can start up to one
 *             POLL_INTERVAL_MS past the deadline; that round can then burn a
 *             full SPAWN_TIMEOUT_MS on each of the n packages still pending,
 *             because a spawnSync timeout is reported as `{ ok: false }` —
 *             the package stays pending — rather than aborting the run.
 *
 * The release workflow's `timeout-minutes` on this step is the OUTER cap and
 * must stay ≥ the ceiling for the number of published packages;
 * `tools/verify-oidc-provenance.test.mjs` pins that relation so lowering one
 * without the other fails CI.
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/** How long to wait between polling rounds. */
export const POLL_INTERVAL_MS = 15_000;
/** FLOOR: a package that stays invisible is polled for at least this long. */
export const VISIBILITY_DEADLINE_MS = 10 * 60_000;
// Bound the per-call npm view to defend against a wedged registry/network
// (otherwise the CI step could hang up to the job-level timeout).
export const SPAWN_TIMEOUT_MS = 20_000;
/**
 * CEILING: the deadline, plus the one poll interval the final round can start
 * past it (the deadline is checked after a round and before the sleep), plus
 * one spawn timeout per package still pending in that final round.
 */
export const worstCaseMs = (pendingCount) =>
  VISIBILITY_DEADLINE_MS + POLL_INTERVAL_MS + pendingCount * SPAWN_TIMEOUT_MS;

// On Windows, `npm` is a `.cmd` shim, and Node ≥ 20 refuses to spawnSync
// .bat/.cmd files without shell: true (EINVAL). The workflow runs on
// ubuntu-latest where shell:false is fine, but local sanity-tests run on
// Windows. Apply shell:true conditionally so both work.
const SPAWN_OPTS_BASE = process.platform === 'win32' ? { shell: true } : {};

const EXPECTED_NPM_USER_EMAIL = 'npm-oidc-no-reply@github.com';
const EXPECTED_NPM_USER_NAME = 'GitHub Actions';
const EXPECTED_PROVENANCE_PREDICATE = 'https://slsa.dev/provenance/v1';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// fetchNpmView throws on hard failures (spawn, JSON parse) — those aren't
// recoverable by polling, so a "loud crash" via thrown Error is the right
// shape (.gemini/styleguide.md § 9 "Error Handling & Logging Conventions",
// the "Error cause chains (ES2022)" bullet). For soft failures the poller can
// ride out, returns `{ ok: false, err }` so the spec stays pending: a
// non-zero npm view status (usually propagation lag), and a spawnSync
// timeout — which arrives as `result.error` with `code: 'ETIMEDOUT'`
// (measured on Node 24.16.0). Throwing on the timeout would let ONE wedged
// `npm view` abort the whole poll, which is exactly the "one slow package
// hides the others" failure mmnto-ai/totem#2748 removes. `spawn` is a
// parameter so the test can drive both arms without spawning npm.
export const fetchNpmView = (spec, spawn = spawnSync) => {
  const result = spawn('npm', ['view', spec, '--json'], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: SPAWN_TIMEOUT_MS,
    ...SPAWN_OPTS_BASE,
  });
  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') {
      return { ok: false, err: `npm view timed out after ${SPAWN_TIMEOUT_MS}ms` };
    }
    throw new Error('[Totem Error] verify-oidc: npm view spawn failed', {
      cause: result.error,
    });
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    return { ok: false, err: stderr || stdout || `npm view exited ${result.status}` };
  }
  try {
    return { ok: true, data: JSON.parse(result.stdout) };
  } catch (err) {
    throw new Error('[Totem Error] verify-oidc: JSON parse failed', { cause: err });
  }
};

/**
 * Round-robin poller: every still-pending spec is fetched once per round, in
 * input order, until nothing is pending or the deadline has passed. The first
 * round runs immediately (no initial sleep). A spec that resolves is removed
 * from the pending set and never fetched again.
 *
 * Returns `{ resolved, missing }` — `resolved` is a `Map<spec, data>`,
 * `missing` a `Map<spec, lastErr>` of the specs still pending at return.
 * A `fetch` that THROWS propagates unchanged (hard failures stay loud).
 */
export const pollUntilVisible = async (
  specs,
  {
    fetch = fetchNpmView,
    sleep = defaultSleep,
    now = Date.now,
    deadlineMs = VISIBILITY_DEADLINE_MS,
    intervalMs = POLL_INTERVAL_MS,
  } = {},
) => {
  const start = now();
  const resolved = new Map();
  const missing = new Map();
  let pending = [...specs];

  const elapsedSeconds = () => Math.round((now() - start) / 1000);

  for (;;) {
    const stillPending = [];
    for (const spec of pending) {
      const result = fetch(spec);
      if (result.ok) {
        resolved.set(spec, result.data);
        missing.delete(spec);
        console.log(`[verify-oidc] ${spec} visible after ${elapsedSeconds()}s`);
      } else {
        missing.set(spec, result.err);
        stillPending.push(spec);
      }
    }
    pending = stillPending;

    if (pending.length === 0) return { resolved, missing };
    if (now() - start >= deadlineMs) return { resolved, missing };

    console.log(
      `[verify-oidc] ${pending.length} package(s) not yet visible after ${elapsedSeconds()}s (${pending.join(', ')}); next poll in ${intervalMs}ms`,
    );
    await sleep(intervalMs);
  }
};

// `npm view --json` returns `_npmUser` as a `<name> <<email>>` string
// (e.g., `"GitHub Actions <npm-oidc-no-reply@github.com>"`), not an object.
export const parseNpmUser = (raw) => {
  if (typeof raw !== 'string') return { name: null, email: null };
  const match = raw.match(/^(.+)\s+<(.+)>$/);
  if (!match) return { name: raw.trim(), email: null };
  return { name: match[1].trim(), email: match[2].trim() };
};

export const assertProvenance = (spec, data) => {
  const failures = [];

  const npmUser = parseNpmUser(data._npmUser);
  if (npmUser.email !== EXPECTED_NPM_USER_EMAIL) {
    failures.push(
      `_npmUser email = ${JSON.stringify(npmUser.email)}, expected ${JSON.stringify(EXPECTED_NPM_USER_EMAIL)} (raw _npmUser = ${JSON.stringify(data._npmUser)})`,
    );
  }
  if (npmUser.name !== EXPECTED_NPM_USER_NAME) {
    failures.push(
      `_npmUser name = ${JSON.stringify(npmUser.name)}, expected ${JSON.stringify(EXPECTED_NPM_USER_NAME)} (raw _npmUser = ${JSON.stringify(data._npmUser)})`,
    );
  }

  const attestations = data.dist?.attestations ?? {};
  if (!attestations.url || typeof attestations.url !== 'string') {
    failures.push(
      `dist.attestations.url missing or non-string (got ${JSON.stringify(attestations.url)})`,
    );
  }
  const predicateType = attestations.provenance?.predicateType;
  if (predicateType !== EXPECTED_PROVENANCE_PREDICATE) {
    failures.push(
      `dist.attestations.provenance.predicateType = ${JSON.stringify(predicateType)}, expected ${JSON.stringify(EXPECTED_PROVENANCE_PREDICATE)}`,
    );
  }

  const signatures = data.dist?.signatures;
  const hasSignatures =
    (Array.isArray(signatures) && signatures.length > 0) ||
    (signatures && typeof signatures === 'object' && Object.keys(signatures).length > 0);
  if (!hasSignatures) {
    failures.push(`dist.signatures missing or empty (got ${JSON.stringify(signatures)})`);
  }

  if (failures.length > 0) {
    console.error(`[verify-oidc] FAIL ${spec}:`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error(
      '[verify-oidc] An empty/wrong-shape provenance set means OIDC did NOT engage on this publish.',
    );
    console.error(
      '[verify-oidc] Likely causes: NPM_TOKEN/NODE_AUTH_TOKEN re-introduced in env; .npmrc with _authToken written by setup-node registry-url; trusted publisher misconfigured on npm.com.',
    );
    return false;
  }

  console.log(`[verify-oidc] PASS ${spec}`);
  return true;
};

/**
 * `exit` and `env` are parameters (not `process.exit` / `process.env` reached
 * for inline) so the fail-loud arm below is reachable from a test — it is
 * conditional now, and an untested exit path is how a gate goes quietly
 * green. `fetch`/`sleep`/`now` are forwarded to `pollUntilVisible` only when
 * given, so the shipped call `main()` runs on the poller's real defaults.
 */
export const main = async ({ fetch, sleep, now, exit = process.exit, env = process.env } = {}) => {
  const published = (env.PUBLISHED_PACKAGES ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (published.length === 0) {
    console.log('[verify-oidc] No packages reported as published; nothing to verify.');
    return;
  }

  console.log(`[verify-oidc] Verifying ${published.length} package(s): ${published.join(', ')}`);

  const pollOptions = {};
  if (fetch !== undefined) pollOptions.fetch = fetch;
  if (sleep !== undefined) pollOptions.sleep = sleep;
  if (now !== undefined) pollOptions.now = now;

  const { resolved, missing } = await pollUntilVisible(published, pollOptions);

  const failed = [];
  for (const [spec, data] of resolved) {
    if (!assertProvenance(spec, data)) failed.push(spec);
  }

  if (missing.size > 0) {
    console.error(
      `[verify-oidc] ${missing.size} package(s) never became visible within ${VISIBILITY_DEADLINE_MS / 1000}s:`,
    );
    for (const [spec, lastErr] of missing) {
      console.error(`  - ${spec} (${lastErr})`);
    }
    console.error(
      '[verify-oidc] A miss here is registry propagation, not a provenance verdict — the publish may be complete; check with npm view. Observed propagation for one package: ~7 min (mmnto-ai/totem#2748).',
    );
  }

  if (failed.length > 0) {
    console.error(
      `[verify-oidc] ${failed.length} package(s) failed provenance check: ${failed.join(', ')}`,
    );
  }

  if (missing.size > 0 || failed.length > 0) {
    exit(1);
    // `process.exit` never returns; an injected `exit` might, and falling
    // through would print the all-verified line over a failure.
    return;
  }

  console.log(
    `[verify-oidc] All ${published.length} package(s) verified OIDC-published with attestations + signatures.`,
  );
};

// Only run main() when executed directly (not when imported by tests).
// Bare `main()` would leave the hard-throw paths as unhandled rejections.
// Node 24's default `--unhandled-rejections=throw` makes that exit non-zero
// today, but a future flag flip or wrapper that downgrades unhandled
// rejections to warnings would silently let the workflow pass green on a
// real provenance regression. Make the intent explicit.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('[verify-oidc] Fatal:', err);
    process.exit(1);
  });
}
