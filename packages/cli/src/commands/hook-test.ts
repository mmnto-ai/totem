import path from 'node:path';

import { TotemError } from '@mmnto/totem';

import type { HookTestResult, HookTestSummary } from '../hook/test-runner.js';

// Static `TotemError` import is intentional: `applyFilter` below is a pure
// synchronous helper that throws TEST_FAILED on a typoed `--filter`, and an
// async wrapper would defeat the testability win of extracting it. The
// per-codebase guideline against top-level heavy internal value imports is
// applied to `runHookTests` and `resolveInstalledPackVersions` (lazy-loaded
// inside the command handler below) instead.

const TAG = 'HookTest';

/**
 * `totem hook test [--filter <term>]` — run fixture-based verification for
 * compiled bot-pack hooks (ADR-104 § Convergence).
 *
 * Loads `surface: hooks` fixtures from `.totem/tests/`, evaluates each
 * against the matching compiled hook, and reports per-line failures so
 * authors can iterate on specific payloads. The runner is deterministic
 * Node.js — no LLM calls — mirroring the `totem hook run` contract.
 *
 * `--filter <term>` matches against hook id (case-insensitive substring).
 */

export interface HookTestCommandOptions {
  filter?: string;
}

/**
 * Apply `--filter` to a hook-test summary, failing loud when the filter
 * matches nothing despite fixtures being present. Pure helper extracted
 * from `hookTestCommand` so the filter contract is unit-testable without
 * driving the command end-to-end through `process.cwd()` + `loadConfig`.
 *
 * Returns the filtered result slice when the filter matches (or is absent).
 * Throws TEST_FAILED when `--filter` is set, `summary.total > 0`, and the
 * filter matches no fixtures — a typoed filter must never look like a
 * successful zero-test run.
 */
export function applyFilter(
  summary: HookTestSummary,
  filter: string | undefined,
): HookTestResult[] {
  if (!filter) return summary.results;
  const term = filter.toLowerCase();
  const filtered = summary.results.filter((r) => r.hookId.toLowerCase().includes(term));
  if (filtered.length === 0 && summary.total > 0) {
    throw new TotemError(
      'TEST_FAILED',
      `No hook tests matched --filter "${filter}".`,
      'Use an existing hook id substring or omit --filter to run all hook tests.',
    );
  }
  return filtered;
}

export async function hookTestCommand(opts: HookTestCommandOptions): Promise<void> {
  const { log, bold, errorColor, success: successColor } = await import('../ui.js');
  const { loadConfig, loadEnv, resolveConfigPath } = await import('../utils.js');
  const { sanitize } = await import('@mmnto/totem');
  const { runHookTests } = await import('../hook/test-runner.js');
  const { resolveInstalledPackVersions } = await import('./hook-run.js');

  const cwd = process.cwd();
  loadEnv(cwd);
  const configPath = resolveConfigPath(cwd);
  const config = await loadConfig(configPath);
  const configRoot = path.dirname(configPath);
  const manifestPath = path.join(configRoot, config.totemDir, 'compiled-hooks.json');
  const testsDir = path.join(configRoot, config.totemDir, 'tests');
  const installedPackVersions = resolveInstalledPackVersions(configRoot);

  log.info(TAG, 'Running hook tests...');

  const summary = runHookTests({ manifestPath, testsDir, installedPackVersions });

  // Sanitize every value that flows in from pack-supplied data (manifest
  // contents, fixture paths) before it reaches the terminal — third-party
  // packs are an untrusted boundary and identifiers like `hookId`/`packId`
  // could carry ANSI control sequences that would mangle the operator's
  // shell. The loader-emitted warnings/errors carry our own message text
  // but may interpolate user-controlled paths, so they get sanitized too.
  for (const w of summary.loadWarnings) {
    log.warn(TAG, sanitize(w));
  }
  for (const e of summary.loadErrors) {
    log.error('Totem Error', `${sanitize(e.code)}: ${sanitize(e.message)}`);
  }

  for (const unknown of summary.unknownHooks) {
    const safeFixture = sanitize(path.basename(unknown.fixturePath));
    const safeHookId = sanitize(unknown.hookId);
    log.warn(
      TAG,
      `Fixture ${safeFixture} references hook id "${safeHookId}" not present in compiled manifest`,
    );
  }

  const results = applyFilter(summary, opts.filter);

  // "No fixtures" only fires when no fixtures exist at all — neither
  // evaluatable results nor orphans referencing an absent hook. A directory
  // containing only orphan fixtures must fail loud below, not show the
  // "create a fixture" placeholder.
  if (
    results.length === 0 &&
    summary.total === 0 &&
    summary.unknownHooks.length === 0 &&
    summary.loadErrors.length === 0
  ) {
    log.dim(TAG, `No hook fixtures (surface: hooks) found in ${sanitize(config.totemDir)}/tests/`);
    log.dim(TAG, 'Create a fixture with:');
    log.dim(TAG, '');
    log.dim(TAG, '  ---');
    log.dim(TAG, '  rule: <hook-id>');
    log.dim(TAG, '  surface: hooks');
    log.dim(TAG, '  corpus: fail');
    log.dim(TAG, '  ---');
    log.dim(TAG, '');
    log.dim(TAG, '  ## Should fail');
    log.dim(TAG, '  ```text');
    log.dim(TAG, '  <args payload that should be rejected>');
    log.dim(TAG, '  ```');
    return;
  }

  for (const result of results) {
    const label = `${sanitize(result.packId)}/${sanitize(result.hookId)}`;
    if (result.passed) {
      log.success(TAG, `${label} — PASS`);
      continue;
    }
    log.error('Totem Error', `${label} — FAIL`);
    for (const failure of result.failures) {
      const direction = failure.expected === 'reject' ? 'missed reject' : 'false positive';
      console.error(`    [${direction}] expected ${failure.expected}, got ${failure.actual}`);
      console.error(`      payload: ${sanitize(failure.line.trim())}`);
    }
  }

  const passedCount = results.filter((r) => r.passed).length;
  const failedCount = results.length - passedCount;

  console.error('');

  // Tenet 4: load errors or orphan fixtures must fail loud — they are
  // never "success" states. A corrupt manifest or a fixture pointing at a
  // typoed hook id silently passing would mask broken pack wiring.
  const hasOrphans = summary.unknownHooks.length > 0;
  const hasLoadErrors = summary.loadErrors.length > 0;

  if (failedCount === 0 && !hasOrphans && !hasLoadErrors) {
    const label = successColor(bold('PASS'));
    log.info(TAG, `${label} — ${passedCount} hook test(s) passed`);
    return;
  }

  const label = errorColor(bold('FAIL'));
  const parts: string[] = [];
  if (failedCount > 0) parts.push(`${failedCount} failed`);
  if (hasOrphans) parts.push(`${summary.unknownHooks.length} unknown-hook reference(s)`);
  if (hasLoadErrors) parts.push(`${summary.loadErrors.length} manifest load error(s)`);
  parts.push(`${passedCount} passed`);
  log.info(TAG, `${label} — ${parts.join(', ')}`);

  const reasons: string[] = [];
  if (failedCount > 0) reasons.push(`${failedCount} hook test(s) failed`);
  if (hasOrphans)
    reasons.push(`${summary.unknownHooks.length} fixture(s) reference unknown hook id`);
  if (hasLoadErrors)
    reasons.push(`${summary.loadErrors.length} compiled-hooks manifest load error(s)`);

  throw new TotemError(
    'TEST_FAILED',
    reasons.join('; ') + '.',
    'Fix failing patterns, orphan fixtures, or manifest issues, then re-run `totem hook test`.',
  );
}
