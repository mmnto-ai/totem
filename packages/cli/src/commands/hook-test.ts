import path from 'node:path';

import { runHookTests } from '../hook/test-runner.js';
import { resolveInstalledPackVersions } from './hook-run.js';

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

export async function hookTestCommand(opts: HookTestCommandOptions): Promise<void> {
  const { log, bold, errorColor, success: successColor } = await import('../ui.js');
  const { loadConfig, loadEnv, resolveConfigPath } = await import('../utils.js');
  const { TotemError, sanitize } = await import('@mmnto/totem');

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

  for (const w of summary.loadWarnings) {
    log.warn(TAG, w);
  }
  for (const e of summary.loadErrors) {
    log.error('Totem Error', `${e.code}: ${e.message}`);
  }

  for (const unknown of summary.unknownHooks) {
    log.warn(
      TAG,
      `Fixture ${path.basename(unknown.fixturePath)} references hook id "${unknown.hookId}" not present in compiled manifest`,
    );
  }

  let results = summary.results;
  if (opts.filter) {
    const term = opts.filter.toLowerCase();
    results = results.filter((r) => r.hookId.toLowerCase().includes(term));
  }

  if (results.length === 0 && summary.total === 0) {
    log.dim(TAG, `No hook fixtures (surface: hooks) found in ${config.totemDir}/tests/`); // totem-ignore — config.totemDir is our own config, not untrusted
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
    const label = `${result.packId}/${result.hookId}`;
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
  if (failedCount === 0) {
    const label = successColor(bold('PASS'));
    log.info(TAG, `${label} — ${passedCount} hook test(s) passed`);
    return;
  }
  const label = errorColor(bold('FAIL'));
  log.info(TAG, `${label} — ${failedCount} failed, ${passedCount} passed`);
  throw new TotemError(
    'TEST_FAILED',
    `${failedCount} hook test(s) failed.`,
    'Fix the failing hook patterns or update test fixtures, then re-run `totem hook test`.',
  );
}
