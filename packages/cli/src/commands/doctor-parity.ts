/**
 * Parity-drift sensor for `totem doctor --parity` (mmnto-ai/totem-strategy#448).
 *
 * PR-1 (mmnto-ai/totem#2069): resolve the consumer-configured
 * `orient.parityManifest` config-path → parse + Zod-validate the strategy-owned
 * `parity-manifest.yaml` → emit `DiagnosticResult`s. The FIRST detection slice
 * is wired here: each `version-pinned` contract whose id resolves a deps package
 * name (`mmnto-cli-version`, `mmnto-totem-version`, `mmnto-mcp-version`,
 * `mmnto-pack-rust-architecture-version`) runs through the core
 * `detectVersionPinnedContract` engine (pin-currency verdict, local-only floor).
 * ALL other contracts — mechanical, manual-attestation, and the version-pinned
 * DOCTRINE pins (`governance-doctrine` / `agent-memory-doctrine`, which derive
 * no deps package name) — keep the `skip` info stub (their drift detection is a
 * follow-on).
 *
 * Sensor-not-gate: the core detector returns `skip`/`warn`/`pass` only — never
 * `fail`. The `--strict` exit-code decision lives at the CLI edge: a `warn` from
 * a `blocking: true` contract is promoted to `fail` (non-zero) ONLY under
 * `--strict`. The detector carries that promotion eligibility back via
 * `blockingDriftIds` so the command can gate without re-loading the manifest.
 *
 * Honest-absent (Tenet 14): unconfigured → exactly one `skip` line; never an
 * error. Configured-but-missing / unparseable / unsupported-schema → `warn`,
 * never a crash (mirrors the `findStaleRules` best-effort fallback idiom in
 * doctor.ts). Dynamic-import `@mmnto/totem` to keep core off the CLI cold-start
 * graph, matching the other doctor checks.
 */

import * as path from 'node:path';

import type { ParityContract, ParityContractVerdict } from '@mmnto/totem';

import type { DiagnosticResult } from './doctor.js';

const CHECK_NAME = 'Parity';

/**
 * Result of a parity check: the rendered `DiagnosticResult` lines plus the set
 * of contract ids that produced a drift `warn` AND are `blocking: true`. The
 * command promotes exactly these to `fail` under `--strict` — carrying the ids
 * here avoids re-loading the manifest at the CLI edge to recover the `blocking`
 * flag (which `DiagnosticResult` does not carry).
 */
export interface ParityCheckResult {
  results: DiagnosticResult[];
  /** Contract ids whose `warn` is `--strict`-promotable (blocking + drift). */
  blockingDriftIds: string[];
}

/**
 * Resolve, parse, and report the parity manifest as `DiagnosticResult`s.
 *
 * Returns `{ results, blockingDriftIds }`: `results[0]` is always the section
 * summary line; in the `ok` path it is followed by one line per contract — a
 * pin-currency verdict for the deps version-pinned contracts, a `skip` stub for
 * everything else. All non-`ok` paths return a single summary entry and an empty
 * `blockingDriftIds`.
 *
 * @param cwd The directory to resolve config + manifest against (config/repo root).
 */
export async function checkParity(cwd: string): Promise<ParityCheckResult> {
  const { loadConfig, resolveConfigPath, isGlobalConfigPath } = await import('../utils.js');
  const {
    deriveCohortRepoId,
    detectVersionPinnedContract,
    loadParityManifest,
    packageNameForContract,
    resolveGitRoot,
    SUPPORTED_PARITY_SCHEMA_VERSION,
  } = await import('@mmnto/totem');

  // Read the config best-effort: a missing/corrupt config is the honest-absent
  // path (no parity manifest configured), not a crash. Mirrors the config-load
  // fallback in doctorCommand — surface only on a defective error object so
  // sentinels still propagate.
  let configValue: string | undefined;
  // Relative manifest paths anchor at the config's OWN directory, not the
  // invocation cwd, so the field resolves consistently no matter which subdir
  // the doctor runs from. resolveConfigPath only checks cwd + the global profile
  // today (no upward walk), so this equals cwd for the local case — the explicit
  // anchor just keeps it correct if resolution ever changes.
  let manifestRoot = cwd;
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
      manifestRoot = path.dirname(configPath);
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

  const result = loadParityManifest(configValue, manifestRoot);

  switch (result.status) {
    case 'not-configured':
      // Honest-absent: exactly one skip line. Not a failure.
      return single({
        name: CHECK_NAME,
        status: 'skip',
        message: 'no parity manifest configured',
      });

    case 'not-found':
      return single({
        name: CHECK_NAME,
        status: 'warn',
        message: `parity manifest not found at ${rel(cwd, result.path)}`,
        remediation: 'Fix orient.parityManifest in your totem config to point at the manifest.',
      });

    case 'unparseable':
      return single({
        name: CHECK_NAME,
        status: 'warn',
        message: `parity manifest unreadable at ${rel(cwd, result.path)}: ${result.reason}`,
        remediation: 'Fix the manifest YAML / schema, then re-run totem doctor --parity.',
      });

    case 'unsupported-schema':
      return single({
        name: CHECK_NAME,
        status: 'warn',
        message: `parity manifest schema v${result.schemaVersion} unsupported (this doctor supports v${SUPPORTED_PARITY_SCHEMA_VERSION})`,
        remediation: 'Upgrade @mmnto/cli or align the manifest schema-version.',
      });

    case 'ok': {
      const { contracts } = result.manifest;
      const summary: DiagnosticResult = {
        name: CHECK_NAME,
        status: 'pass',
        message: `parity manifest: ${contracts.length} contract(s) loaded`,
      };

      // Shared detection context. The cohort floor + repoId derive from the git
      // root (anchored there, not the deep cwd — mirrors the core resolver).
      // resolveGitRoot returns null outside a repo; fall back to cwd so the
      // local self-in-tree / sibling probes still have an anchor.
      const gitRoot = safeGitRoot(resolveGitRoot, cwd) ?? cwd;
      const repoId = deriveCohortRepoId(cwd, { gitRoot });

      const blockingDriftIds: string[] = [];
      const perContract: DiagnosticResult[] = contracts.map((c) => {
        // PR-1 only senses version-pinned DEPS contracts (those that resolve a
        // package name). Everything else — mechanical, manual-attestation, and
        // the version-pinned doctrine pins (no deps package name) — keeps the
        // skip stub until its detection slice lands.
        const packageName =
          c.tractability === 'version-pinned' ? packageNameForContract(c, gitRoot) : undefined;
        if (packageName === undefined) {
          return {
            name: `Parity: ${c.id}`,
            status: 'skip',
            message: `${c.dimension} (${c.tractability}) — drift detection not yet implemented`,
          };
        }

        const verdict = detectVersionPinnedContract(c, { cwd, gitRoot, repoId });
        if (verdict.status === 'warn' && c.blocking === true) {
          blockingDriftIds.push(c.id);
        }
        return verdictToDiagnostic(c, verdict);
      });

      return { results: [summary, ...perContract], blockingDriftIds };
    }
  }
}

/** Wrap a single summary line in the `ParityCheckResult` shape (no blocking ids). */
function single(result: DiagnosticResult): ParityCheckResult {
  return { results: [result], blockingDriftIds: [] };
}

/** Map a core `ParityContractVerdict` to a CLI `DiagnosticResult` for one contract. */
function verdictToDiagnostic(
  contract: ParityContract,
  verdict: ParityContractVerdict,
): DiagnosticResult {
  return {
    name: `Parity: ${contract.id}`,
    status: verdict.status,
    message: verdict.message,
    ...(verdict.remediation !== undefined ? { remediation: verdict.remediation } : {}),
  };
}

/**
 * Resolve the git root, swallowing the `TotemGitError` that `resolveGitRoot`
 * throws on a git hiccup (permission error / corrupted index) — the parity
 * sensor degrades to the cwd anchor rather than crashing the doctor pipeline.
 */
function safeGitRoot(resolve: (cwd: string) => string | null, cwd: string): string | null {
  try {
    return resolve(cwd);
    // totem-context: resolveGitRoot throws on permission errors / corrupted index; the parity sensor degrades to a cwd anchor rather than crashing — a git hiccup must not sink the doctor pipeline.
  } catch {
    return null;
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
   * Strict mode (Proposal 273 / 279 `--strict` semantics): promote drift to a
   * gate failure (non-zero exit) via a thrown TotemError.
   *
   * Sensor-not-gate is the default: a drift `warn` reports and exits 0. Under
   * `--strict`, a `warn` from a `blocking: true` contract (its id carried in
   * `checkParity`'s `blockingDriftIds`) is rendered as `FAIL` and promoted to a
   * non-zero exit. Non-blocking drift stays a `warn` even under `--strict` — the
   * contract's `blocking` flag, not the flag alone, gates the exit code.
   */
  strict?: boolean;
  /** Test seam — production callers omit and the command uses `process.cwd()`. */
  cwdForTest?: string;
}

/**
 * CLI entry — runs `checkParity`, renders each `DiagnosticResult`, and throws a
 * `TotemError` when a blocking contract drifted under `--strict` so the
 * top-level `handleError` produces the non-zero exit code (no direct
 * `process.exit` per AGENTS.md).
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
  const { results, blockingDriftIds } = await checkParity(cwd);

  // Under --strict, a blocking contract's drift `warn` is rendered + gated as a
  // FAIL. We match by the `Parity: <id>` line name so the rendered status agrees
  // with the exit code. blockingDriftIds is empty in the non-strict path's
  // effect (the promotion only fires under --strict), so this Set is cheap.
  const promotable = new Set(blockingDriftIds.map((id) => `Parity: ${id}`));

  for (const r of results) {
    const status =
      options.strict && r.status === 'warn' && promotable.has(r.name) ? 'fail' : r.status;
    switch (status) {
      case 'pass':
        log.success(TAG, `${successColor(bold('PASS'))} — ${render(r.message)}`);
        break;
      case 'warn':
        log.warn(TAG, `${warnColor(bold('WARN'))} — ${render(r.message)}`);
        if (r.remediation) log.dim(TAG, `→ ${render(r.remediation)}`);
        break;
      case 'fail':
        // Mandated 'Totem Error' tag (packages/cli convention) — marks internal
        // error output, distinct from the contextual TAG used for pass/warn/skip.
        log.error('Totem Error', `${errorColor(bold('FAIL'))} — ${render(r.message)}`);
        if (r.remediation) log.dim(TAG, `→ ${render(r.remediation)}`);
        break;
      case 'skip':
        log.dim(TAG, `SKIP — ${render(r.message)}`);
        break;
    }
  }

  // Sensor-not-gate: only `--strict` + a `blocking: true` contract's drift
  // promotes to a non-zero exit. A pre-existing `fail` status (none today, but
  // future detection slices may emit one) also gates. Non-blocking drift never
  // gates, even under `--strict`.
  const failingFromStatus = results.filter((r) => r.status === 'fail').length;
  const failingFromBlocking = options.strict ? blockingDriftIds.length : 0;
  const totalFailures = failingFromStatus + failingFromBlocking;
  if (options.strict && totalFailures > 0) {
    throw new TotemError(
      'PARITY_DRIFT_DETECTED',
      `${totalFailures} parity contract(s) reported blocking drift under --strict.`,
      'Reconcile each failing contract against its canonical source, then re-run totem doctor --parity --strict.',
    );
  }
}
