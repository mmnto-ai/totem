/**
 * Parity-drift sensor for `totem doctor --parity` (mmnto-ai/totem-strategy#448).
 *
 * SKELETON (first slice): resolve the consumer-configured `orient.parityManifest`
 * config-path → parse + Zod-validate the strategy-owned `parity-manifest.yaml`
 * → emit `DiagnosticResult`s. Per-contract drift detection is OUT OF SCOPE for
 * this skeleton (it needs populated deps contracts + per-dimension semantics);
 * each per-contract line is a `skip` info stub here.
 *
 * Sensor-not-gate: this surface emits `skip`/`warn`/`pass` only — it never
 * produces a `fail` in the skeleton. The `--strict` exit-code decision lives at
 * the CLI edge (reusing the existing doctor `--strict` logic); a `fail` only
 * becomes possible once per-contract drift detection lands. The `blocking`
 * contract field is parsed but unused here (per-contract gating is post-skeleton).
 *
 * Honest-absent (Tenet 14): unconfigured → exactly one `skip` line; never an
 * error. Configured-but-missing / unparseable / unsupported-schema → `warn`,
 * never a crash (mirrors the `findStaleRules` best-effort fallback idiom in
 * doctor.ts). Dynamic-import `@mmnto/totem` to keep core off the CLI cold-start
 * graph, matching the other doctor checks.
 */

import * as path from 'node:path';

import type { DiagnosticResult } from './doctor.js';

const CHECK_NAME = 'Parity';

/**
 * Resolve, parse, and report the parity manifest as `DiagnosticResult`s.
 *
 * Returns an ARRAY: the first entry is always the section summary line; in the
 * `ok` path it is followed by one `skip` info stub per contract (the
 * per-contract drift verdict is deferred). All other paths return a single
 * summary entry.
 *
 * @param cwd The directory to resolve config + manifest against (config/repo root).
 */
export async function checkParity(cwd: string): Promise<DiagnosticResult[]> {
  const { loadConfig, resolveConfigPath, isGlobalConfigPath } = await import('../utils.js');
  const { loadParityManifest, SUPPORTED_PARITY_SCHEMA_VERSION } = await import('@mmnto/totem');

  // Read the config best-effort: a missing/corrupt config is the honest-absent
  // path (no parity manifest configured), not a crash. Mirrors the config-load
  // fallback in doctorCommand — surface only on a defective error object so
  // sentinels still propagate.
  let configValue: string | undefined;
  try {
    const configPath = resolveConfigPath(cwd);
    // Repo-scoped by design: the manifest location is per-repo, so a config-less
    // repo that only resolves the GLOBAL ~/.totem profile is honest-absent for
    // parity. Never leak a global orient.parityManifest into a repo-less result
    // (that would make the sensor machine-dependent) — only a repo-local config
    // contributes the field.
    if (isGlobalConfigPath(configPath)) {
      configValue = undefined;
    } else {
      const config = await loadConfig(configPath);
      configValue = config.orient?.parityManifest;
    }
    // totem-context: a missing/corrupt totem config is the honest-absent path (treated as "no parity manifest configured"), not a sensor failure — the doctor runs against config-less repos by design.
  } catch (err) {
    if (err instanceof Error && err.message.length === 0) {
      throw err;
    }
    configValue = undefined;
  }

  const result = loadParityManifest(configValue, cwd);

  switch (result.status) {
    case 'not-configured':
      // Honest-absent: exactly one skip line. Not a failure.
      return [
        {
          name: CHECK_NAME,
          status: 'skip',
          message: 'no parity manifest configured',
        },
      ];

    case 'not-found':
      return [
        {
          name: CHECK_NAME,
          status: 'warn',
          message: `parity manifest not found at ${rel(cwd, result.path)}`,
          remediation: 'Fix orient.parityManifest in your totem config to point at the manifest.',
        },
      ];

    case 'unparseable':
      return [
        {
          name: CHECK_NAME,
          status: 'warn',
          message: `parity manifest unreadable at ${rel(cwd, result.path)}: ${result.reason}`,
          remediation: 'Fix the manifest YAML / schema, then re-run totem doctor --parity.',
        },
      ];

    case 'unsupported-schema':
      return [
        {
          name: CHECK_NAME,
          status: 'warn',
          message: `parity manifest schema v${result.schemaVersion} unsupported (this doctor supports v${SUPPORTED_PARITY_SCHEMA_VERSION})`,
          remediation: 'Upgrade @mmnto/cli or align the manifest schema-version.',
        },
      ];

    case 'ok': {
      const { contracts } = result.manifest;
      const summary: DiagnosticResult = {
        name: CHECK_NAME,
        status: 'pass',
        message: `parity manifest: ${contracts.length} contract(s) loaded`,
      };
      // Per-contract skeleton stubs. Drift detection is deferred — each line is
      // an info `skip` carrying the contract id + dimension + tractability so
      // the surface is shaped for the follow-on without asserting a verdict.
      const perContract: DiagnosticResult[] = contracts.map((c) => ({
        name: `Parity: ${c.id}`,
        status: 'skip',
        message: `${c.dimension} (${c.tractability}) — drift detection not yet implemented`,
      }));
      return [summary, ...perContract];
    }
  }
}

/** Repo-root-relative display path; falls back to the absolute path. */
function rel(cwd: string, target: string): string {
  const r = path.relative(cwd, target);
  return r.length > 0 ? r : target;
}

// ─── CLI entry ──────────────────────────────────────────

// Same value as CHECK_NAME — aliased (not re-literal'd) so the two can't drift.
const TAG = CHECK_NAME;

export interface ParityCliOptions {
  /**
   * Strict mode (Proposal 273 / 279 `--strict` semantics): promote any `fail`
   * DiagnosticResult to a gate failure (non-zero exit) via a thrown TotemError.
   *
   * In the SKELETON this never fires — `checkParity` emits only `skip`/`warn`/
   * `pass`, never `fail` (per-contract drift detection is deferred). The wiring
   * is present so `--strict` composes once a `fail` becomes possible. Default
   * (non-strict) is sensor-not-gate: `warn`s report and exit 0.
   */
  strict?: boolean;
  /** Test seam — production callers omit and the command uses `process.cwd()`. */
  cwdForTest?: string;
}

/**
 * CLI entry — runs `checkParity`, renders each `DiagnosticResult`, and throws a
 * `TotemError` on `fail` under `--strict` so the top-level `handleError`
 * produces the non-zero exit code (no direct `process.exit` per AGENTS.md).
 */
export async function doctorParityCliCommand(options: ParityCliOptions = {}): Promise<void> {
  const { TotemError, sanitizeForTerminal } = await import('@mmnto/totem');
  const {
    bold,
    errorColor,
    log,
    success: successColor,
    warn: warnColor,
  } = await import('../ui.js');

  // Manifest-derived text (paths, parse reasons, contract metadata) is sourced
  // from repo-controlled files; sanitize + flatten before logging so embedded
  // ANSI / newlines can't forge extra doctor lines (matches checkStrategyRoot
  // in doctor.ts).
  const render = (text: string): string =>
    sanitizeForTerminal(text)
      .replace(/[\t\n]+/g, ' ')
      .replace(/ {2,}/g, ' ')
      .trim();

  const cwd = options.cwdForTest ?? process.cwd();
  const results = await checkParity(cwd);

  for (const r of results) {
    switch (r.status) {
      case 'pass':
        log.success(TAG, `${successColor(bold('PASS'))} — ${render(r.message)}`);
        break;
      case 'warn':
        log.warn(TAG, `${warnColor(bold('WARN'))} — ${render(r.message)}`);
        if (r.remediation) log.dim(TAG, `→ ${render(r.remediation)}`);
        break;
      case 'fail':
        log.error(TAG, `${errorColor(bold('FAIL'))} — ${render(r.message)}`);
        if (r.remediation) log.dim(TAG, `→ ${render(r.remediation)}`);
        break;
      case 'skip':
        log.dim(TAG, `SKIP — ${render(r.message)}`);
        break;
    }
  }

  // Sensor-not-gate: only `--strict` promotes `fail` to a non-zero exit. The
  // skeleton never emits `fail`, so this is inert until per-contract drift
  // detection lands; the wiring composes ahead of that follow-on.
  const failures = results.filter((r) => r.status === 'fail');
  if (options.strict && failures.length > 0) {
    throw new TotemError(
      'PARITY_DRIFT_DETECTED',
      `${failures.length} parity contract(s) reported drift under --strict.`,
      'Reconcile each failing contract against its canonical source, then re-run totem doctor --parity --strict.',
    );
  }
}
