/**
 * Parity-drift sensor for `totem doctor --parity` (mmnto-ai/totem-strategy#448).
 *
 * Two detection slices are wired here:
 *   - **version-pinned** (PR-1, mmnto-ai/totem#2069): each deps contract whose id
 *     resolves an `@mmnto/*` package name runs through the core
 *     `detectVersionPinnedContract` engine (pin-currency verdict, local-only floor).
 *   - **mechanical content-equality** (mmnto-ai/totem#2073 skills slice): each
 *     managed-block contract this slice handles (`claude-skills`,
 *     `review-reply-skill-content`) compares the consumer's installed
 *     `.claude/skills/<name>/SKILL.md` managed-block against the running
 *     `@mmnto/cli`'s OWN canonical template (the in-process `init-templates`
 *     export — local-read-only, no node_modules reach-in), via the core
 *     `detectMechanicalContract` engine (CRLF/LF-normalized content-hash + a
 *     fork-marker → `info` escape + an `unknown` Stale-Doctor-Paradox guard).
 *
 * ALL other contracts — the parameterized hook contracts (`git-hooks`,
 * `session-start-orientation`), the file-value-equality bot-configs, the
 * structural-presence dimensions, and every `manual-attestation` contract —
 * keep the `skip` "not yet implemented" stub; their detection is a follow-on
 * slice (the #2073 tail).
 *
 * The parity sensor owns its OWN render + result type (`ParityLine`) carrying a
 * WIDER status vocabulary (pass/warn/fail/info/unknown/skip) than the shared
 * `CheckStatus`, so the verdict-state split (#2073 req #1) never ripples
 * `CheckStatus` across the unrelated doctor checks.
 *
 * Sensor-not-gate: the detectors return `skip`/`warn`/`pass`/`info`/`unknown` —
 * never `fail`. The `--strict` exit-code decision lives at the CLI edge: a
 * `warn` from a `blocking: true` contract is promoted to `fail` (non-zero) ONLY
 * under `--strict`. `info`/`unknown` are never gated. Honest-absent (Tenet 14):
 * unconfigured → exactly one `skip` line; configured-but-missing / unparseable /
 * unsupported-schema → `warn`, never a crash. Dynamic-import `@mmnto/totem` to
 * keep core off the CLI cold-start graph, matching the other doctor checks.
 */

import * as path from 'node:path';

import type { ManagedBlockMarkers, ParityContract, ParityContractVerdict } from '@mmnto/totem';

// init-templates (large canonical strings) + the node:url / node:module builtins
// are dynamic-imported inside checkParity per the packages/cli lazy-load
// guideline — see the `ok` branch.

const CHECK_NAME = 'Parity';

/**
 * A parity output line — the per-contract verdict plus its display name. Carries
 * the WIDER `ParityContractVerdict` status vocabulary (pass/warn/fail/info/
 * unknown/skip) rather than the shared `CheckStatus`, so the sensor honors the
 * verdict-state split (#2073 req #1) without rippling `CheckStatus` across the
 * other doctor checks. The parity command owns its own renderer.
 */
export interface ParityLine extends ParityContractVerdict {
  name: string;
}

/**
 * Result of a parity check: the rendered `ParityLine`s plus the set of contract
 * ids that produced a drift `warn` AND are `blocking: true`. The command
 * promotes exactly these to `fail` under `--strict` — carrying the ids here
 * avoids re-loading the manifest at the CLI edge to recover the `blocking` flag.
 */
export interface ParityCheckResult {
  results: ParityLine[];
  /** Contract ids whose `warn` is `--strict`-promotable (blocking + drift). */
  blockingDriftIds: string[];
}

// ─── Mechanical artifact registry (CLI-side) ────────────

/**
 * One on-disk artifact a mechanical contract maps to: the consumer file path,
 * its marker pair, the canonical block extracted from the running `@mmnto/cli`'s
 * own template, and the display name for its verdict line.
 */
interface MechanicalArtifact {
  consumerPath: string;
  markers: ManagedBlockMarkers;
  canonicalBlock: string | undefined;
  lineName: string;
}

/**
 * The distributed-skill canonical sources, dynamic-imported by the caller from
 * `init-templates` (kept off the CLI cold-start graph per the packages/cli
 * lazy-load guideline) and threaded in so this registry stays a pure function.
 */
interface SkillTemplateSource {
  distributedSkills: ReadonlyArray<{ name: string; content: string }>;
  reviewReplyContent: string;
  markers: ManagedBlockMarkers;
}

/**
 * Resolve the on-disk artifact(s) a mechanical contract checks, or `undefined`
 * when this slice doesn't handle the contract (hooks / presence / value-equality
 * → kept as `skip` stubs). `claude-skills` yields one artifact PER distributed
 * skill; `review-reply-skill-content` is the single review-reply skill (it
 * overlaps `claude-skills` by design — both are distinct manifest contracts on
 * the same file; flagged to strategy as a manifest observation).
 *
 * The canonical block is extracted from the running CLI's OWN `init-templates`
 * export (passed-in `extract` is the core `extractManagedBlock`, dynamic-imported
 * by the caller to keep `@mmnto/totem` off the cold-start graph) — local-read-only.
 */
function mechanicalArtifactsFor(
  contractId: string,
  gitRoot: string,
  extract: (content: string, markers: ManagedBlockMarkers) => string | undefined,
  templates: SkillTemplateSource,
): MechanicalArtifact[] | undefined {
  const { markers } = templates;
  switch (contractId) {
    case 'claude-skills':
      return templates.distributedSkills.map((s) => ({
        consumerPath: path.join(gitRoot, '.claude', 'skills', s.name, 'SKILL.md'),
        markers,
        canonicalBlock: extract(s.content, markers),
        lineName: `Parity: claude-skills (${s.name})`,
      }));
    case 'review-reply-skill-content':
      return [
        {
          consumerPath: path.join(gitRoot, '.claude', 'skills', 'review-reply', 'SKILL.md'),
          markers,
          canonicalBlock: extract(templates.reviewReplyContent, markers),
          lineName: 'Parity: review-reply-skill-content',
        },
      ];
    default:
      return undefined;
  }
}

/**
 * Resolve the running `@mmnto/cli`'s version + install path for the req-#5
 * binary self-report (the Stale-Doctor-Paradox guard — surface WHICH binary
 * computed the skills verdict so a shadowed/stale global is visible). Best-effort:
 * a resolution failure degrades the self-report to absent (the verdict still
 * renders, just without provenance), never a crash. Resolves from THIS module's
 * own URL, so it names the actual running install (workspace dist vs a
 * node_modules vendor vs a global shadow).
 */
function resolveRunningBinary(
  urlMod: typeof import('node:url'),
  createRequireFn: typeof import('node:module').createRequire,
): { version: string; path: string } | undefined {
  try {
    const here = urlMod.fileURLToPath(import.meta.url);
    // dist/commands/doctor-parity.js → up two → the @mmnto/cli package root.
    const cliRoot = path.resolve(path.dirname(here), '..', '..');
    const req = createRequireFn(import.meta.url);
    const pkg = req('../../package.json') as { version?: unknown };
    if (typeof pkg.version !== 'string') return undefined;
    return { version: pkg.version, path: cliRoot };
    // totem-context: best-effort cosmetic read — the binary self-report degrades to absent on ANY resolution failure and NEVER re-throws (GCA review), so a shadowed / broken install can't crash the doctor pipeline (Tenet 13: a cosmetic read must not break the sensor).
  } catch {
    return undefined;
  }
}

/**
 * Resolve, parse, and report the parity manifest as `ParityLine`s.
 *
 * Returns `{ results, blockingDriftIds }`: `results[0]` is always the section
 * summary line; in the `ok` path it is followed by one line per contract (or
 * per artifact, for multi-artifact mechanical contracts) — a pin-currency
 * verdict for the deps version-pinned contracts, a content-equality verdict for
 * the mechanical skills contracts, and a `skip` stub for everything else. All
 * non-`ok` paths return a single summary entry and an empty `blockingDriftIds`.
 *
 * @param cwd The directory to resolve config + manifest against (config/repo root).
 */
export async function checkParity(cwd: string): Promise<ParityCheckResult> {
  const { loadConfig, resolveConfigPath, isGlobalConfigPath } = await import('../utils.js');
  const {
    deriveCohortRepoId,
    detectMechanicalContract,
    detectVersionPinnedContract,
    extractManagedBlock,
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
      const summary: ParityLine = {
        name: CHECK_NAME,
        status: 'pass',
        message: `parity manifest: ${contracts.length} contract(s) loaded`,
      };

      // Lazy-load init-templates (large canonical strings) + the node builtins
      // only on the ok path — the honest-absent cases above never pay for them
      // (packages/cli lazy-load guideline).
      const { createRequire } = await import('node:module');
      const url = await import('node:url');
      const {
        DISTRIBUTED_CLAUDE_SKILLS,
        REVIEW_REPLY_SKILL_CONTENT,
        SKILL_MARKER_START,
        SKILL_MARKER_END,
      } = await import('./init-templates.js');
      const skillTemplates: SkillTemplateSource = {
        distributedSkills: DISTRIBUTED_CLAUDE_SKILLS,
        reviewReplyContent: REVIEW_REPLY_SKILL_CONTENT,
        markers: { start: SKILL_MARKER_START, end: SKILL_MARKER_END },
      };

      // Shared detection context. The cohort floor + repoId derive from the git
      // root (anchored there, not the deep cwd — mirrors the core resolver).
      // resolveGitRoot returns null outside a repo; fall back to cwd so the
      // local self-in-tree / sibling probes still have an anchor.
      const gitRoot = safeGitRoot(resolveGitRoot, cwd) ?? cwd;
      const repoId = deriveCohortRepoId(cwd, { gitRoot });
      const binary = resolveRunningBinary(url, createRequire);

      const blockingDriftIds: string[] = [];
      // flatMap, not map: a mechanical contract (claude-skills) expands to one
      // line PER distributed skill, so the per-contract count can exceed the
      // contract count.
      const perContract: ParityLine[] = contracts.flatMap((c) => {
        // ── version-pinned deps (PR-1) ──
        if (c.tractability === 'version-pinned') {
          const packageName = packageNameForContract(c, gitRoot);
          if (packageName === undefined) {
            return [
              stub(c, `${c.dimension} (version-pinned) — drift detection not yet implemented`),
            ];
          }
          const verdict = detectVersionPinnedContract(c, { cwd, gitRoot, repoId, packageName });
          if (verdict.status === 'warn' && c.blocking === true) blockingDriftIds.push(c.id);
          return [verdictToLine(c, verdict)];
        }

        // ── mechanical managed-block content-equality (mmnto-ai/totem#2073 skills slice) ──
        if (c.tractability === 'mechanical') {
          const artifacts = mechanicalArtifactsFor(
            c.id,
            gitRoot,
            extractManagedBlock,
            skillTemplates,
          );
          if (artifacts === undefined) {
            return [
              stub(
                c,
                `${c.dimension} (mechanical) — drift detection not yet implemented for this sub-class`,
              ),
            ];
          }
          // A multi-artifact contract (claude-skills) can drift on several
          // artifacts; tag the contract id at most ONCE so the --strict count
          // reflects contracts, not artifacts.
          let blockingDrift = false;
          const lines = artifacts.map((a) => {
            const verdict = detectMechanicalContract({
              canonicalBlock: a.canonicalBlock,
              consumerPath: a.consumerPath,
              markers: a.markers,
              ...(binary !== undefined ? { binary } : {}),
            });
            if (verdict.status === 'warn' && c.blocking === true) blockingDrift = true;
            return lineFor(a.lineName, verdict);
          });
          if (blockingDrift) blockingDriftIds.push(c.id);
          return lines;
        }

        // ── manual-attestation + anything else → skip stub (the mmnto-ai/totem#2073 tail) ──
        return [
          stub(c, `${c.dimension} (${c.tractability}) — drift detection not yet implemented`),
        ];
      });

      return { results: [summary, ...perContract], blockingDriftIds };
    }
  }
}

/** Wrap a single summary line in the `ParityCheckResult` shape (no blocking ids). */
function single(result: ParityLine): ParityCheckResult {
  return { results: [result], blockingDriftIds: [] };
}

/** Map a core `ParityContractVerdict` to a `ParityLine` keyed by the contract id. */
function verdictToLine(contract: ParityContract, verdict: ParityContractVerdict): ParityLine {
  return lineFor(`Parity: ${contract.id}`, verdict);
}

/** Build a `ParityLine` from an explicit display name + a core verdict. */
function lineFor(name: string, verdict: ParityContractVerdict): ParityLine {
  return {
    name,
    status: verdict.status,
    message: verdict.message,
    ...(verdict.remediation !== undefined ? { remediation: verdict.remediation } : {}),
  };
}

/** The `skip` "not yet implemented" stub for a contract this build doesn't sense. */
function stub(contract: ParityContract, message: string): ParityLine {
  return { name: `Parity: ${contract.id}`, status: 'skip', message };
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
   * non-zero exit. Non-blocking drift stays a `warn` even under `--strict`, and
   * `info` (attested fork) / `unknown` (unprovable) NEVER promote — the
   * contract's `blocking` flag on a `warn`, not the flag alone, gates the exit.
   */
  strict?: boolean;
  /** Test seam — production callers omit and the command uses `process.cwd()`. */
  cwdForTest?: string;
}

/**
 * CLI entry — runs `checkParity`, renders each `ParityLine`, and throws a
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
  // FAIL. A contract's drift can render across MULTIPLE artifact lines
  // (e.g. `Parity: claude-skills (signoff)`), so a line is promotable when its
  // name is the `Parity: <id>` summary OR a `Parity: <id> (…)` artifact line —
  // an exact-name Set would leave the artifact lines rendered as WARN while the
  // command still exits non-zero (GCA review on the PR). The trailing space
  // guards against a contract id that is a prefix of another.
  const isPromotable = (name: string): boolean =>
    blockingDriftIds.some((id) => name === `Parity: ${id}` || name.startsWith(`Parity: ${id} `));

  for (const r of results) {
    const status =
      options.strict && r.status === 'warn' && isPromotable(r.name) ? 'fail' : r.status;
    switch (status) {
      case 'pass':
        log.success(TAG, `${successColor(bold('PASS'))} — ${render(r.message)}`);
        break;
      case 'warn':
        log.warn(TAG, `${warnColor(bold('WARN'))} — ${render(r.message)}`);
        if (r.remediation) log.dim(TAG, `→ ${render(r.remediation)}`);
        break;
      case 'info':
        // An attested, intentional fork — neutral/informational, never gated.
        log.info(TAG, `${bold('INFO')} — ${render(r.message)}`);
        if (r.remediation) log.dim(TAG, `→ ${render(r.remediation)}`);
        break;
      case 'unknown':
        // The Stale-Doctor-Paradox state: the canonical was unresolvable, so the
        // verdict is unprovable (NOT a pass — no self-certification). A caution,
        // not drift; never gated.
        log.warn(TAG, `${warnColor(bold('UNKNOWN'))} — ${render(r.message)}`);
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

  // Sensor-not-gate: drift is report-only by default (exit 0). Only `--strict`
  // promotes a `blocking: true` contract's drift to a non-zero exit; non-blocking
  // drift never gates, and `info`/`unknown` are never promoted. The detectors
  // emit no raw `fail` status, so the gate is purely the strict+blocking
  // promotion — the gating model for a future slice that DOES emit a `fail` is
  // settled when that slice lands (CR review mmnto-ai/totem#2071: keep the gate from
  // suggesting a non-strict path that would break sensor-not-gate).
  if (options.strict && blockingDriftIds.length > 0) {
    throw new TotemError(
      'PARITY_DRIFT_DETECTED',
      `${blockingDriftIds.length} parity contract(s) reported blocking drift under --strict.`,
      'Reconcile each blocking contract against its canonical source, then re-run totem doctor --parity --strict.',
    );
  }
}
