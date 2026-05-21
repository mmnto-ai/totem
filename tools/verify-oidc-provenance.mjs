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
 * The npm registry has read-replica lag of a few seconds after `npm publish`
 * returns, so each `npm view` is retried up to MAX_ATTEMPTS times with
 * RETRY_DELAY_MS between attempts. After publish-oidc finishes, registry
 * convergence is typically <10s.
 */
import { spawnSync } from 'node:child_process';

const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 5000;
// Bound the per-call npm view to defend against a wedged registry/network
// (otherwise the CI step could hang up to the job-level timeout).
const SPAWN_TIMEOUT_MS = 20_000;

// On Windows, `npm` is a `.cmd` shim, and Node ≥ 20 refuses to spawnSync
// .bat/.cmd files without shell: true (EINVAL). The workflow runs on
// ubuntu-latest where shell:false is fine, but local sanity-tests run on
// Windows. Apply shell:true conditionally so both work.
const SPAWN_OPTS_BASE = process.platform === 'win32' ? { shell: true } : {};

const EXPECTED_NPM_USER_EMAIL = 'npm-oidc-no-reply@github.com';
const EXPECTED_NPM_USER_NAME = 'GitHub Actions';
const EXPECTED_PROVENANCE_PREDICATE = 'https://slsa.dev/provenance/v1';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// fetchNpmView throws on hard failures (spawn, JSON parse) — those aren't
// recoverable by retry, so a "loud crash" via thrown Error is the right
// shape (.gemini/styleguide.md § 120 cause-chain rule). For soft failures
// (registry returned non-zero status, often propagation lag), returns
// `{ ok: false, err }` so the caller's retry loop can drive backoff.
const fetchNpmView = (spec) => {
  const result = spawnSync('npm', ['view', spec, '--json'], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: SPAWN_TIMEOUT_MS,
    ...SPAWN_OPTS_BASE,
  });
  if (result.error) {
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

const fetchWithRetry = async (spec) => {
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const result = fetchNpmView(spec);
    if (result.ok) return result.data;
    lastErr = result.err;
    if (attempt < MAX_ATTEMPTS) {
      console.log(
        `[verify-oidc] ${spec} not yet visible on registry (attempt ${attempt}/${MAX_ATTEMPTS}); retrying in ${RETRY_DELAY_MS}ms`,
      );
      await sleep(RETRY_DELAY_MS);
    }
  }
  console.error(`[verify-oidc] Failed to fetch ${spec} after ${MAX_ATTEMPTS} attempts:`, lastErr);
  throw new Error(`[Totem Error] verify-oidc: registry fetch exhausted retries for ${spec}`);
};

// `npm view --json` returns `_npmUser` as a `<name> <<email>>` string
// (e.g., `"GitHub Actions <npm-oidc-no-reply@github.com>"`), not an object.
const parseNpmUser = (raw) => {
  if (typeof raw !== 'string') return { name: null, email: null };
  const match = raw.match(/^(.+)\s+<(.+)>$/);
  if (!match) return { name: raw.trim(), email: null };
  return { name: match[1].trim(), email: match[2].trim() };
};

const assertProvenance = (spec, data) => {
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

const main = async () => {
  const published = (process.env.PUBLISHED_PACKAGES ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (published.length === 0) {
    console.log('[verify-oidc] No packages reported as published; nothing to verify.');
    return;
  }

  console.log(`[verify-oidc] Verifying ${published.length} package(s): ${published.join(', ')}`);

  const failed = [];
  for (const spec of published) {
    const data = await fetchWithRetry(spec);
    if (!assertProvenance(spec, data)) failed.push(spec);
  }

  if (failed.length > 0) {
    console.error(
      `[verify-oidc] ${failed.length} package(s) failed provenance check: ${failed.join(', ')}`,
    );
    process.exit(1);
  }

  console.log(
    `[verify-oidc] All ${published.length} package(s) verified OIDC-published with attestations + signatures.`,
  );
};

main();
