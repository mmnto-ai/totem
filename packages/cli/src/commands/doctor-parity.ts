/**
 * Parity-drift sensor for `totem doctor --parity` (mmnto-ai/totem-strategy#448).
 *
 * Detection is wired across all three tractability classes (mmnto-ai/totem#2073):
 *   - **version-pinned** (PR-1, mmnto-ai/totem#2069): each deps contract whose id
 *     resolves an `@mmnto/*` package name runs through the core
 *     `detectVersionPinnedContract` engine (pin-currency verdict, local-only floor).
 *   - **mechanical content-equality** (mmnto-ai/totem#2073): three artifact shapes,
 *     all local-read-only against the running `@mmnto/cli`'s OWN in-process template:
 *       · **skills** (`claude-skills`): managed-block equality of
 *         `.claude/skills/<name>/SKILL.md` via `detectMechanicalContract`.
 *       · **git-hooks**: per-repo REGENERATED whole-file/region equality of the four
 *         `.git/hooks/*` (package-manager + tier parameterized) via
 *         `detectGeneratedArtifactContract` — catches stale-version drift (#1854).
 *       · **session-start-orientation**: STATIC whole-file equality of the
 *         `.claude/hooks/SessionStart.cjs` + `.gemini/hooks/SessionStart.js` templates,
 *         also via `detectGeneratedArtifactContract` (no parameterization).
 *   - **manual-attestation** (mmnto-ai/totem#2080): the no-mechanical-sensor class —
 *     `detectManualAttestationContract` surfaces the doctrine-currency row / vendor-SDK
 *     pin as `info` (or honest-absent `skip`), NEVER pass/warn/fail (the "never fails"
 *     contract; structurally cannot gate under `--strict`).
 *
 * The remaining contracts — the file-value-equality bot-configs (`cr-profile` etc.)
 * and the structural-presence dimensions — keep the `skip` "not yet implemented" stub;
 * their detection is a follow-on.
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
 *
 * The **trust-readout** (mmnto-ai/totem#2327, Prop 303 §5(a)) post-processes
 * the flat per-line dump into the doctor's aggregate output contract: verdict
 * rollup (per-seat + global, R1), the run-time coverage denominator (R2),
 * why-not per non-pass row at the level probed (R3), the `--json` verdict
 * artifact (R4), and the `--strict` declaredly-toothless honesty line (R5).
 * Spec: mmnto-ai/totem-strategy:doctrine/parity-manifest.md § "The
 * trust-readout — the doctor's output contract"; deltas raise there, never
 * silently diverge. Pure post-processing — zero probes added.
 */

import * as path from 'node:path';

import type {
  ManagedBlockMarkers,
  ParityContract,
  ParityContractVerdict,
  ValueEqualityField,
} from '@mmnto/totem';

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

// ─── Trust-readout types (mmnto-ai/totem#2327, Prop 303 §5(a)) ──────────
// The spec half lives at mmnto-ai/totem-strategy:doctrine/parity-manifest.md
// § "The trust-readout — the doctor's output contract" (R1–R5); build deltas
// are raised against that section, never silently diverged. Three raised
// deltas ride the 2026-07-09T2256Z totem-claude→strategy-claude dispatch:
// `info` joins the R1/R4 vocabulary (the shipped manual-attestation state),
// the rollup counts rendered verdict LINES while the R2 denominator counts
// CONTRACTS, and `attestation` joins the R3 reason classes.

/** Prop 296 §6(a)2 senses-ladder rung a detector actually probed. */
export type SensesLevel = 'declared' | 'present' | 'loaded' | 'usable';

/**
 * R2 coverage class for one contract — derived per run from the detector
 * registry ∩ the manifest (the yaml deliberately carries no per-row sensed
 * flag; Tenet 20). A contract whose detector exists but was scope-skipped this
 * run still classifies `mechanical` — the registry implements it; the skip is
 * a run-time verdict the rollup + why-not carry separately.
 */
export type ReadoutCoverageClass = 'mechanical' | 'attestation-only' | 'honest-absent';

/** R3 reason class for one verdict line (`pass` lines omit theirs; `attestation` is raised Delta 3). */
export type ReadoutReasonClass =
  | 'drift'
  | 'scoping-skip'
  | 'honest-absent'
  | 'detector-error'
  | 'attestation';

/**
 * Per-contract readout metadata, tagged at the routing branch that senses the
 * contract (single source — never re-derived from a mirrored registry, which
 * would be the Tenet 20 drift hazard).
 */
export interface ContractReadoutMeta {
  coverage: ReadoutCoverageClass;
  /** Absent when nothing was probed (attestation rows, honest-absent stubs). */
  sensesProbed?: SensesLevel;
}

/** The trust-readout raw materials `checkParity` carries out of the manifest `ok` path. */
export interface ParityReadoutInputs {
  manifest: { schemaVersion: number; status: string };
  contracts: ParityContract[];
  meta: Record<string, ContractReadoutMeta>;
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
  /**
   * Whether a repo-local `orient.parityManifest` field was configured (i.e.
   * `configValue !== undefined` after the global-leak guard). NOT whether the
   * manifest file loaded — a configured-but-broken manifest is `configured: true`
   * so the `--strict` fold surfaces the error instead of silently no-op'ing.
   * Lets the CLI edge fold parity into `--strict` only for repos that opted in
   * (mmnto-ai/totem#2085, mmnto-ai/totem-strategy#545 Half 2).
   */
  configured: boolean;
  /**
   * Manifest load status — the `--json` artifact's `manifest.status` on the
   * degenerate paths, where there is no manifest-declared status to carry
   * (mmnto-ai/totem#2327 R4).
   */
  loadStatus: 'ok' | 'not-configured' | 'not-found' | 'unparseable' | 'unsupported-schema';
  /**
   * Trust-readout raw materials (mmnto-ai/totem#2327) — present only on the
   * manifest `ok` path. The CLI edge assembles the rollup / denominator /
   * why-not via `buildParityReadout`; degenerate load states render no rollup
   * (nothing to roll up) and `--json` carries `loadStatus` instead.
   */
  readout?: ParityReadoutInputs;
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
  reviewLoopContent: string;
  markers: ManagedBlockMarkers;
}

/**
 * Resolve the on-disk artifact(s) a mechanical contract checks, or `undefined`
 * when this slice doesn't handle the contract (hooks / presence / value-equality
 * → kept as `skip` stubs). `claude-skills` yields one artifact PER distributed
 * skill; `review-reply-skill-content` and `review-loop-skill-content` are the
 * single per-skill contracts (each overlaps `claude-skills` by design — both are
 * distinct manifest contracts on the same file; flagged to strategy as a manifest
 * observation).
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
    case 'review-loop-skill-content':
      return [
        {
          consumerPath: path.join(gitRoot, '.claude', 'skills', 'review-loop', 'SKILL.md'),
          markers,
          canonicalBlock: extract(templates.reviewLoopContent, markers),
          lineName: 'Parity: review-loop-skill-content',
        },
      ];
    default:
      return undefined;
  }
}

// ─── Value-equality field registry (CLI-side, mmnto-ai/totem-strategy#738 Slice A) ──

/**
 * Resolve the on-disk config field(s) a `manifestation: value-equality` contract
 * checks, or `undefined` when this slice doesn't handle the id (→ a `skip` stub).
 * Each entry carries WHERE to look (file + dotted-path SEGMENTS + parse format);
 * the EXPECTED value is read by the detector from the contract's own
 * `expectedValueOrDerivation` (strategy#738 Q1 — the manifest field is the
 * canonical, no second source). Paths are pre-verified against the live cohort
 * config shapes: GCA nests its switches under a top-level `code_review:` block
 * (`code_review.pull_request_opened.*`), and `gca-on-demand` is split into two
 * independent rows per the strategy#738 Q3 ruling (each switch drifts on its own).
 */
function valueEqualityFieldsFor(
  contractId: string,
  gitRoot: string,
): ValueEqualityField[] | undefined {
  switch (contractId) {
    case 'cr-profile':
      return [
        {
          consumerPath: path.join(gitRoot, '.coderabbit.yaml'),
          pathSegments: ['reviews', 'profile'],
          format: 'yaml',
          lineName: 'Parity: cr-profile',
        },
      ];
    case 'cr-on-demand':
      return [
        {
          consumerPath: path.join(gitRoot, '.coderabbit.yaml'),
          pathSegments: ['reviews', 'auto_review', 'enabled'],
          format: 'yaml',
          lineName: 'Parity: cr-on-demand',
        },
      ];
    case 'gca-code-review':
      return [
        {
          consumerPath: path.join(gitRoot, '.gemini', 'config.yaml'),
          pathSegments: ['code_review', 'pull_request_opened', 'code_review'],
          format: 'yaml',
          lineName: 'Parity: gca-code-review',
        },
      ];
    case 'gca-summary':
      return [
        {
          consumerPath: path.join(gitRoot, '.gemini', 'config.yaml'),
          pathSegments: ['code_review', 'pull_request_opened', 'summary'],
          format: 'yaml',
          lineName: 'Parity: gca-summary',
        },
      ];
    case 'greptile-on-demand':
      return [
        {
          consumerPath: path.join(gitRoot, 'greptile.json'),
          pathSegments: ['skipReview'],
          format: 'json',
          lineName: 'Parity: greptile-on-demand',
        },
      ];
    default:
      return undefined;
  }
}

// ─── Lock-content package registry (CLI-side, mmnto-ai/totem#2107) ──

/**
 * Resolve the installed `@mmnto/strategy-doctrine` package dir a
 * `manifestation: content-hash` contract reads (the lock + its `artifacts[].path`
 * resolve under it), or `undefined` when this slice doesn't handle the id (→ a `skip`
 * stub). For these cohort repos node_modules is hoisted to the repo root, so the
 * package dir is `<gitRoot>/node_modules/@mmnto/strategy-doctrine`; the detector reports
 * honest-absent when the package / lock is missing under it (it never assumes presence).
 */
function lockContentPackageDirFor(contractId: string, gitRoot: string): string | undefined {
  switch (contractId) {
    case 'strategy-doctrine-lock-content':
      return path.join(gitRoot, 'node_modules', '@mmnto', 'strategy-doctrine');
    default:
      return undefined;
  }
}

// ─── Git-hook artifact registry (CLI-side, mmnto-ai/totem#2073 hooks slice) ──

/**
 * The running `@mmnto/cli`'s own hook generators + markers, dynamic-imported by the
 * caller from `install-hooks` (kept off the CLI cold-start graph) and threaded in so
 * the registry stays a pure function. The canonical for each hook is REGENERATED for
 * THIS repo (its package manager via `fallbackCmd`, its `tier`) — never a frozen
 * string, so an npm consumer's `npx`-flavored hook does not read as drift against a
 * pnpm canonical (the parameterization-aware contract, mmnto-ai/totem#2053).
 */
interface HookBuilderSource {
  buildPreCommitHook: (tier?: 'strict' | 'standard') => string;
  buildPrePushHook: (fallbackCmd: string, tier?: 'strict' | 'standard') => string;
  buildHookContent: (fallbackCmd: string) => string;
  buildPostCheckoutHookContent: (fallbackCmd: string) => string;
  markers: {
    preCommit: string;
    prePush: string;
    postMerge: { start: string; end: string };
    postCheckout: { start: string; end: string };
  };
}

/**
 * One on-disk git hook a `git-hooks` contract maps to: the consumer path under
 * `.git/hooks/`, the regenerated canonical content, the ownership/presence marker,
 * an optional end marker (post-merge / post-checkout carry one; pre-commit / pre-push
 * do not), and the display name for its verdict line.
 */
interface GeneratedArtifact {
  consumerPath: string;
  canonicalContent: string | undefined;
  ownershipMarker: string;
  endMarker?: string;
  lineName: string;
}

/**
 * Resolve the four git-hook artifacts the `git-hooks` contract checks, each with a
 * per-repo regenerated canonical. `hooksDir` is the repo's RESOLVED hooks directory
 * (worktree-aware — mmnto-ai/totem#2418). Checks git hooks only — hook-manager installs
 * (`.totem/hooks/*.sh` for husky / lefthook) are a follow-on (no cohort consumer uses
 * one today); the detector's present-without-marker → `skip` keeps a manager repo
 * honest in the meantime.
 */
function gitHookArtifactsFor(
  hooksDir: string,
  tier: 'strict' | 'standard',
  fallbackCmd: string,
  builders: HookBuilderSource,
): GeneratedArtifact[] {
  const m = builders.markers;
  return [
    {
      consumerPath: path.join(hooksDir, 'pre-commit'),
      canonicalContent: builders.buildPreCommitHook(tier),
      ownershipMarker: m.preCommit,
      lineName: 'Parity: git-hooks (pre-commit)',
    },
    {
      consumerPath: path.join(hooksDir, 'pre-push'),
      canonicalContent: builders.buildPrePushHook(fallbackCmd, tier),
      ownershipMarker: m.prePush,
      lineName: 'Parity: git-hooks (pre-push)',
    },
    {
      consumerPath: path.join(hooksDir, 'post-merge'),
      canonicalContent: builders.buildHookContent(fallbackCmd),
      ownershipMarker: m.postMerge.start,
      endMarker: m.postMerge.end,
      lineName: 'Parity: git-hooks (post-merge)',
    },
    {
      consumerPath: path.join(hooksDir, 'post-checkout'),
      canonicalContent: builders.buildPostCheckoutHookContent(fallbackCmd),
      ownershipMarker: m.postCheckout.start,
      endMarker: m.postCheckout.end,
      lineName: 'Parity: git-hooks (post-checkout)',
    },
  ];
}

// ─── SessionStart hook artifact registry (CLI-side, mmnto-ai/totem#2073 orientation slice) ──

/**
 * The running `@mmnto/cli`'s own whole-file SessionStart hook templates, dynamic-
 * imported by the caller from `init-templates` (kept off the cold-start graph) and
 * threaded in so the registry stays a pure function. Unlike the git hooks these are
 * STATIC — no package-manager / tier parameterization — so the canonical is the
 * verbatim template string. Both vendor templates open with the same `marker`.
 */
interface SessionStartTemplateSource {
  claude: string;
  gemini: string;
  marker: string;
}

/**
 * Resolve the two whole-file SessionStart hook artifacts the `session-start-orientation`
 * contract checks: `.claude/hooks/SessionStart.cjs` (canonical `CLAUDE_SESSION_START`)
 * and `.gemini/hooks/SessionStart.js` (canonical `GEMINI_SESSION_START`). Whole-file
 * static canonical, no end marker, no regeneration. A vendor file absent here is
 * honest-absent `skip` (cohort permits absence) via the detector's presence semantics;
 * a present file whose marker opens it but whose body drifted is `warn` (the orientation
 * slice generalized `isOwnedGeneratedFile` to treat a marker-at-start JS file as owned).
 */
function sessionStartArtifactsFor(
  gitRoot: string,
  templates: SessionStartTemplateSource,
): GeneratedArtifact[] {
  return [
    {
      consumerPath: path.join(gitRoot, '.claude', 'hooks', 'SessionStart.cjs'),
      canonicalContent: templates.claude,
      ownershipMarker: templates.marker,
      lineName: 'Parity: session-start-orientation (claude)',
    },
    {
      consumerPath: path.join(gitRoot, '.gemini', 'hooks', 'SessionStart.js'),
      canonicalContent: templates.gemini,
      ownershipMarker: templates.marker,
      lineName: 'Parity: session-start-orientation (gemini)',
    },
  ];
}

// ─── Capability-probe registry (CLI-side, mmnto-ai/totem#2140) ──

/**
 * One probe a `manifestation: capability-probe` contract maps to: the core
 * detector context minus the per-row `declaredSenses` (threaded at the call
 * site from the contract), plus the display name. Mirrors the mechanical /
 * generated-artifact registries: CLI owns the wiring, core owns the verdict.
 */
interface CapabilityProbeArtifact {
  kind: 'mcp-registration' | 'settings-floor';
  consumerPath: string;
  mcpJsonPath?: string;
  probedLevel: 'declared' | 'present' | 'loaded' | 'usable';
  lineName: string;
}

/**
 * Resolve the probe(s) a capability-probe contract runs, or `undefined` when
 * this build ships no probe for the row (→ honest skip stub). Both deliverable-1
 * probes are PRESENT-rung by design: `knowledge-search-access`'s usable rung (a
 * live bounded search exec) is deliberately NOT shipped — real `totem search`
 * embeds the query via a cloud API, which a 296 §12.5 never-network probe cannot
 * run; the core detector caps the verdict at `unknown` accordingly (the
 * green-halo cap) and the rung contradiction is flagged to strategy.
 */
function capabilityProbesFor(
  contractId: string,
  gitRoot: string,
): CapabilityProbeArtifact[] | undefined {
  switch (contractId) {
    case 'knowledge-search-access':
      return [
        {
          kind: 'mcp-registration',
          consumerPath: path.join(gitRoot, '.mcp.json'),
          probedLevel: 'present',
          lineName: 'Parity: knowledge-search-access',
        },
      ];
    case 'claude-settings-minimum-capability':
      return [
        {
          kind: 'settings-floor',
          consumerPath: path.join(gitRoot, '.claude', 'settings.json'),
          mcpJsonPath: path.join(gitRoot, '.mcp.json'),
          probedLevel: 'present',
          lineName: 'Parity: claude-settings-minimum-capability',
        },
      ];
    default:
      return undefined;
  }
}

// ─── Declared-contract registry (CLI-side, Prop 305 §3 agent-bus) ──

/**
 * One declaration surface a `manifestation: declared` contract maps to: the file
 * that carries the `<!-- totem:<token> role="…" seat="…" -->` marker plus the
 * bare marker token to sense it under. Mirrors {@link capabilityProbesFor}: the
 * CLI owns the wiring (which file, which token per contract-id), core owns the
 * verdict (`detectDeclaredContract`).
 */
interface DeclarationMarkerTarget {
  filePath: string;
  markerToken: string;
}

/**
 * Resolve the declaration surface a `declared` contract senses, or `undefined`
 * when this build wires no marker for the row (→ honest-absent stub, mirroring
 * how `capabilityProbesFor` handles an unknown probe id). Today only `agent-bus`
 * (Prop 305 §3): its role→seat binding is declared in the repo's own AGENTS.md.
 */
function declarationMarkersFor(
  contractId: string,
  gitRoot: string,
): DeclarationMarkerTarget | undefined {
  switch (contractId) {
    case 'agent-bus':
      return {
        filePath: path.join(gitRoot, 'AGENTS.md'),
        markerToken: 'totem:agent-bus',
      };
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
    detectCapabilityProbeContract,
    detectDeclaredContract,
    detectGeneratedArtifactContract,
    detectLockContentContract,
    detectManualAttestationContract,
    detectMechanicalContract,
    detectValueEqualityContract,
    detectVersionPinnedContract,
    extractManagedBlock,
    loadParityManifest,
    packageNameForContract,
    PARITY_MANIFESTATIONS,
    resolveGitRoot,
    SUPPORTED_PARITY_SCHEMA_VERSION,
    TOOLCHAIN_DIMENSION,
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
  // Tier the git hooks were generated at. Resolved the SAME way `hooksCommand` does
  // (config.hooks.tier, default 'standard') so the doctor regenerates the canonical
  // at the CONFIGURED tier — a hook on disk that does not match its repo's configured
  // tier is genuine drift, which the content compare correctly surfaces.
  let hookTier: 'strict' | 'standard' = 'standard';
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
      hookTier = config.hooks?.tier ?? 'standard';
    }
    // totem-context: a missing/corrupt totem config is the honest-absent path (treated as "no parity manifest configured"), not a sensor failure — the doctor runs against config-less repos by design.
  } catch (err) {
    if (err instanceof Error && err.message.length === 0) {
      throw err;
    }
    configValue = undefined;
  }

  // Single source of truth for "is parity configured here" — derived from the
  // SAME resolution (incl. the isGlobalConfigPath guard above) so the CLI edge
  // never re-derives config and never leaks a global manifest into the fold.
  const configured = configValue !== undefined;

  const result = loadParityManifest(configValue, manifestRoot);

  switch (result.status) {
    case 'not-configured':
      // Honest-absent: exactly one skip line. Not a failure.
      return single(
        {
          name: CHECK_NAME,
          status: 'skip',
          message: 'no parity manifest configured',
        },
        configured,
        'not-configured',
      );

    case 'not-found': {
      // mmnto-ai/totem#2094 — when the configured manifest path lives under
      // node_modules/ (the strategy-doctrine optional-pin shape), the normal
      // unauthed-CI state is "pin not installed" (optional deps skipped without
      // npm read-auth), NOT a misconfigured path. Name the install-side cause so
      // the hint stops misdiagnosing the expected CI condition as a config error.
      // Match node_modules as a path segment at the start, middle, or end of the
      // path — a bare/relative `node_modules` or one with no trailing separator
      // still counts (greptile #2252). In that state the config is presumed
      // correct (the pin path is right), so the remediation is install-focused,
      // not "fix your config" (coderabbit #2252).
      const underNodeModules = /(?:^|[\\/])node_modules(?:[\\/]|$)/.test(result.path);
      const remediation = underNodeModules
        ? 'Install the pin dependency (npm read-auth required; optional deps are skipped in unauthed installs).'
        : 'Fix orient.parityManifest in your totem config to point at the manifest.';
      return single(
        {
          name: CHECK_NAME,
          status: 'warn',
          message: `parity manifest not found at ${rel(cwd, result.path)}`,
          remediation,
        },
        configured,
        'not-found',
      );
    }

    case 'unparseable':
      return single(
        {
          name: CHECK_NAME,
          status: 'warn',
          message: `parity manifest unreadable at ${rel(cwd, result.path)}: ${result.reason}`,
          remediation: 'Fix the manifest YAML / schema, then re-run totem doctor --parity.',
        },
        configured,
        'unparseable',
      );

    case 'unsupported-schema':
      return single(
        {
          name: CHECK_NAME,
          status: 'warn',
          message: `parity manifest schema v${result.schemaVersion} unsupported (this doctor supports v${SUPPORTED_PARITY_SCHEMA_VERSION})`,
          remediation: 'Upgrade @mmnto/cli or align the manifest schema-version.',
        },
        configured,
        'unsupported-schema',
      );

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
        REVIEW_LOOP_SKILL_CONTENT,
        SKILL_MARKER_START,
        SKILL_MARKER_END,
        CLAUDE_SESSION_START,
        GEMINI_SESSION_START,
        SESSION_START_MARKER,
      } = await import('./init-templates.js');
      const skillTemplates: SkillTemplateSource = {
        distributedSkills: DISTRIBUTED_CLAUDE_SKILLS,
        reviewReplyContent: REVIEW_REPLY_SKILL_CONTENT,
        reviewLoopContent: REVIEW_LOOP_SKILL_CONTENT,
        markers: { start: SKILL_MARKER_START, end: SKILL_MARKER_END },
      };
      // The running CLI's own whole-file SessionStart hook templates (static — no
      // parameterization), lazy-loaded on the ok path only (mmnto-ai/totem#2073 orientation slice).
      const sessionStartTemplates: SessionStartTemplateSource = {
        claude: CLAUDE_SESSION_START,
        gemini: GEMINI_SESSION_START,
        marker: SESSION_START_MARKER,
      };

      // The running CLI's own hook generators + markers + package-manager probe,
      // lazy-loaded on the ok path only (cold-start guideline). The canonical for
      // each git hook is regenerated per-repo from these (mmnto-ai/totem#2073 hooks slice).
      const {
        buildPreCommitHook,
        buildPrePushHook,
        buildHookContent,
        buildPostCheckoutHookContent,
        getFallbackCommand,
        resolveHooksDir,
        TOTEM_PRECOMMIT_MARKER,
        TOTEM_PREPUSH_MARKER,
        TOTEM_HOOK_MARKER,
        TOTEM_HOOK_END,
        TOTEM_CHECKOUT_MARKER,
        TOTEM_CHECKOUT_END,
      } = await import('./install-hooks.js');
      const hookBuilders: HookBuilderSource = {
        buildPreCommitHook,
        buildPrePushHook,
        buildHookContent,
        buildPostCheckoutHookContent,
        markers: {
          preCommit: TOTEM_PRECOMMIT_MARKER,
          prePush: TOTEM_PREPUSH_MARKER,
          postMerge: { start: TOTEM_HOOK_MARKER, end: TOTEM_HOOK_END },
          postCheckout: { start: TOTEM_CHECKOUT_MARKER, end: TOTEM_CHECKOUT_END },
        },
      };

      // Shared detection context. The cohort floor + repoId derive from the git
      // root (anchored there, not the deep cwd — mirrors the core resolver).
      // resolveGitRoot returns null outside a repo; fall back to cwd so the
      // local self-in-tree / sibling probes still have an anchor.
      const gitRoot = safeGitRoot(resolveGitRoot, cwd) ?? cwd;
      const repoId = deriveCohortRepoId(cwd, { gitRoot });
      const binary = resolveRunningBinary(url, createRequire);
      // Derived from the repo's lockfile (the SAME probe the installer uses), so the
      // regenerated git-hook canonical matches THIS repo's package manager — no false drift.
      const fallbackCmd = getFallbackCommand(gitRoot);

      const blockingDriftIds: string[] = [];
      // Trust-readout per-contract metadata (mmnto-ai/totem#2327), tagged at the
      // routing branch that owns each contract so the R2 coverage split derives
      // from the run itself — never from a mirrored registry (Tenet 20).
      const readoutMeta: Record<string, ContractReadoutMeta> = {};
      // The consumers-scope guard shared by the routing branches that don't
      // self-guard in core (mechanical + capability-probe): a scoped contract
      // must not emit drift in a repo that is not an intended consumer.
      const consumersSkip = (c: ParityContract): ParityLine[] | undefined => {
        if (c.consumers === undefined) return undefined;
        if (repoId === undefined) {
          return [
            lineFor(`Parity: ${c.id}`, {
              status: 'skip',
              message: `cannot determine applicability — repo id unresolvable; contract is scoped to consumers [${c.consumers.join(', ')}]`,
            }),
          ];
        }
        if (!c.consumers.includes(repoId)) {
          return [
            lineFor(`Parity: ${c.id}`, {
              status: 'skip',
              message: `cohort permits absence here (${repoId} not in consumers)`,
            }),
          ];
        }
        return undefined;
      };

      // flatMap, not map: a mechanical contract (claude-skills) expands to one
      // line PER distributed skill, so the per-contract count can exceed the
      // contract count.
      const perContract: ParityLine[] = contracts.flatMap((c) => {
        // ── manifestation routing (promoted field, mmnto-ai/totem#2140) ──
        // capability-probe rows route BEFORE the tractability dispatch: both
        // deliverable-1 rows are `tractability: mechanical` (Green-decidable)
        // but sense via probes, not artifact content-equality. Recognized
        // NON-probe rungs (managed-block, version-pin, …) are informational —
        // they fall through to the existing tractability routing unchanged.
        if (c.manifestation === 'capability-probe') {
          // Probe resolution BEFORE the scope guard is meta-only (pure switch, no
          // probe executes): a scoped-out row still classifies by whether the
          // registry implements it (#2327 R2).
          const probes = capabilityProbesFor(c.id, gitRoot);
          readoutMeta[c.id] =
            probes === undefined
              ? { coverage: 'honest-absent' }
              : {
                  coverage: 'mechanical',
                  ...(probes[0] !== undefined ? { sensesProbed: probes[0].probedLevel } : {}),
                };
          const scopeSkip = consumersSkip(c);
          if (scopeSkip !== undefined) return scopeSkip;
          if (probes === undefined) {
            return [
              stub(c, `${c.dimension} (capability-probe) — probe not yet implemented for this row`),
            ];
          }
          let blockingDrift = false;
          const lines = probes.map((p) => {
            const verdict = detectCapabilityProbeContract({
              kind: p.kind,
              consumerPath: p.consumerPath,
              probedLevel: p.probedLevel,
              ...(p.mcpJsonPath !== undefined ? { mcpJsonPath: p.mcpJsonPath } : {}),
              ...(c.senses !== undefined ? { declaredSenses: c.senses } : {}),
            });
            if (verdict.status === 'warn' && c.blocking === true) blockingDrift = true;
            return lineFor(p.lineName, verdict);
          });
          if (blockingDrift) blockingDriftIds.push(c.id);
          return lines;
        }

        // ── value-equality routing (mmnto-ai/totem-strategy#738 Slice A) ──
        // Routes on `manifestation` BEFORE the tractability dispatch (same as
        // capability-probe): these bot-review-config rows are `tractability:
        // mechanical` but sense a SCALAR at a dotted path, not artifact content-
        // equality. The expected value is the contract's own
        // `expectedValueOrDerivation` (the canonical); the registry supplies only
        // the file + path + format. No `consumersSkip` here — like
        // detectVersionPinnedContract, detectValueEqualityContract SELF-guards the
        // consumers scope in core (greptile review on #2249); a second CLI guard
        // would be the dead-letter / message-divergence risk consumersSkip is
        // documented to avoid.
        if (c.manifestation === 'value-equality') {
          const fields = valueEqualityFieldsFor(c.id, gitRoot);
          // The scalar read is a config-declaration probe (#2327 R3): 'declared'.
          readoutMeta[c.id] =
            fields === undefined
              ? { coverage: 'honest-absent' }
              : { coverage: 'mechanical', sensesProbed: 'declared' };
          if (fields === undefined) {
            return [
              stub(
                c,
                `${c.dimension} (value-equality) — drift detection not yet implemented for this row`,
              ),
            ];
          }
          // A row maps to ≥1 field (the gca two-row split shares one file); tag the
          // contract id at most ONCE for --strict so the count reflects contracts.
          let blockingDrift = false;
          const lines = fields.map((field) => {
            const verdict = detectValueEqualityContract(c, { repoId, field });
            if (verdict.status === 'warn' && c.blocking === true) blockingDrift = true;
            return lineFor(field.lineName, verdict);
          });
          if (blockingDrift) blockingDriftIds.push(c.id);
          return lines;
        }

        // ── content-hash routing (mmnto-ai/totem#2107, strategy#754) ──
        // Routes on `manifestation` BEFORE the tractability dispatch (like value-
        // equality + capability-probe): the lock-content row is `tractability:
        // mechanical` but senses normalized-artifact hash equality of a DISTRIBUTED
        // package, not a managed-block or dotted scalar. The detector SELF-guards the
        // consumers scope (verbatim with the other detectors); the registry supplies
        // only the installed package dir. One line per artifact × per layer; tag the
        // contract id at most ONCE for --strict so the count reflects contracts.
        if (c.manifestation === 'content-hash') {
          const packageDir = lockContentPackageDirFor(c.id, gitRoot);
          // Installed-artifact hash equality probes on-disk content (#2327 R3): 'present'.
          readoutMeta[c.id] =
            packageDir === undefined
              ? { coverage: 'honest-absent' }
              : { coverage: 'mechanical', sensesProbed: 'present' };
          if (packageDir === undefined) {
            return [
              stub(
                c,
                `${c.dimension} (content-hash) — drift detection not yet implemented for this row`,
              ),
            ];
          }
          let blockingDrift = false;
          const lines = detectLockContentContract(c, { repoId, packageDir, gitRoot }).map((l) => {
            if (l.verdict.status === 'warn' && c.blocking === true) blockingDrift = true;
            return lineFor(l.lineName, l.verdict);
          });
          if (blockingDrift) blockingDriftIds.push(c.id);
          return lines;
        }

        // ── declared routing (Prop 305 §3 agent-bus) ──
        // Routes on `manifestation` BEFORE the tractability dispatch (like the
        // other promoted rungs). A declaration SURFACE: the repo authors a
        // `<!-- totem:<token> role="…" seat="…" -->` marker in its OWN agent
        // config (AGENTS.md); the detector senses marker PRESENCE only, never
        // duty execution (adherence-class, Tenet 19 / Prop 305 §3.5). The registry
        // supplies the file + token; an unwired contract id gets an honest-absent
        // stub (mirrors capability-probe). NEVER warns on absence — an undeclared
        // repo is "honest-absent until a repo declares", not drift, so the class
        // never enters blockingDriftIds (cannot gate even under --strict).
        if (c.manifestation === 'declared') {
          // Registry resolution BEFORE the scope guard is meta-only (pure switch,
          // no read): a scoped-out row still classifies by whether the registry
          // wires it (mmnto-ai/totem#2327 R2).
          const target = declarationMarkersFor(c.id, gitRoot);
          // A declaration-presence probe reads the repo's own config (mmnto-ai/totem#2327 R3): 'present'.
          readoutMeta[c.id] =
            target === undefined
              ? { coverage: 'honest-absent' }
              : { coverage: 'mechanical', sensesProbed: 'present' };
          const scopeSkip = consumersSkip(c);
          if (scopeSkip !== undefined) return scopeSkip;
          if (target === undefined) {
            return [
              stub(c, `${c.dimension} (declared) — no declaration marker wired for this row`),
            ];
          }
          const verdict = detectDeclaredContract({
            filePath: target.filePath,
            markerToken: target.markerToken,
          });
          return [verdictToLine(c, verdict)];
        }

        if (
          c.manifestation !== undefined &&
          !(PARITY_MANIFESTATIONS as readonly string[]).includes(c.manifestation)
        ) {
          // Fail-loud PER ROW, never per manifest (the total-outage guard): an
          // unrecognized rung value surfaces verbatim instead of darking the
          // sensor or silently mis-routing.
          readoutMeta[c.id] = { coverage: 'honest-absent' };
          return [
            stub(
              c,
              `manifestation '${c.manifestation}' unrecognized by this doctor — drift detection not yet implemented`,
            ),
          ];
        }

        // ── version-pinned deps (PR-1) ──
        if (c.tractability === 'version-pinned') {
          const packageName = packageNameForContract(c, gitRoot);
          // A toolchain-version row with no deps package pins its engine via the
          // consumer's `packageManager` field; detectVersionPinnedContract
          // self-routes those to the toolchain reader (mmnto-ai/totem#2115). Only
          // stub a version-pinned row that's neither a deps package nor a toolchain.
          if (packageName === undefined && c.dimension !== TOOLCHAIN_DIMENSION) {
            readoutMeta[c.id] = { coverage: 'honest-absent' };
            return [
              stub(c, `${c.dimension} (version-pinned) — drift detection not yet implemented`),
            ];
          }
          // Pin-currency reads the consumer's dependency declaration (#2327 R3): 'declared'.
          readoutMeta[c.id] = { coverage: 'mechanical', sensesProbed: 'declared' };
          const verdict = detectVersionPinnedContract(c, { cwd, gitRoot, repoId, packageName });
          if (verdict.status === 'warn' && c.blocking === true) blockingDriftIds.push(c.id);
          return [verdictToLine(c, verdict)];
        }

        // ── mechanical content-equality (mmnto-ai/totem#2073) ──
        if (c.tractability === 'mechanical') {
          // Skills resolution is pure (no probe executes) — resolved BEFORE the
          // scope guard so a scoped-out row still classifies by whether the
          // registry implements it (#2327 R2); reused as `artifacts` below.
          const skillArtifacts = mechanicalArtifactsFor(
            c.id,
            gitRoot,
            extractManagedBlock,
            skillTemplates,
          );
          const mechanicalImplemented =
            c.id === 'git-hooks' ||
            c.id === 'session-start-orientation' ||
            skillArtifacts !== undefined;
          // Content-equality probes on-disk artifacts (#2327 R3): 'present'.
          readoutMeta[c.id] = mechanicalImplemented
            ? { coverage: 'mechanical', sensesProbed: 'present' }
            : { coverage: 'honest-absent' };

          // Honor the contract's `consumers` scope before sensing drift (mirrors
          // detectVersionPinnedContract, which self-guards). A scoped mechanical
          // contract must not emit drift — or, under --strict, fail — in a repo that
          // is not an intended consumer (CodeRabbit review on mmnto-ai/totem#2079).
          const scopeSkip = consumersSkip(c);
          if (scopeSkip !== undefined) return scopeSkip;

          // Generated-artifact contracts (whole-file / region content-equality): the git
          // hooks (regenerated per-repo for this package manager + tier — catches the
          // stale-version drift half of mmnto-ai/totem#1854) and the static whole-file
          // SessionStart hooks (orientation slice). Both resolve a GeneratedArtifact[] and
          // run the same presence-aware detector + once-per-contract blocking tag.
          let generatedArtifacts: GeneratedArtifact[] | undefined;
          // Artifact-class copy threaded into the detector so the absence/drift
          // remediation names the RIGHT installer per class (Greptile review on
          // mmnto-ai/totem#2082): git hooks → `totem hook install`; the static
          // SessionStart hooks → `totem init`.
          let artifactLabel = 'artifact';
          let installCommand = 'totem init';
          if (c.id === 'git-hooks') {
            // Worktree-aware hooks location (mmnto-ai/totem#2418): a linked
            // worktree's hooks live behind the `.git` gitdir pointer, so a blind
            // `.git/hooks` join would report every hook missing there. The
            // read-only join fallback keeps the pre-#2418 behavior when even the
            // resolver comes up empty.
            const parityHooksDir = resolveHooksDir(gitRoot) ?? path.join(gitRoot, '.git', 'hooks');
            generatedArtifacts = gitHookArtifactsFor(
              parityHooksDir,
              hookTier,
              fallbackCmd,
              hookBuilders,
            );
            artifactLabel = 'git hook';
            // --force so the remediation actually repairs a stale hook: bare
            // `totem hook install` only drift-repairs a totem-OWNED whole file, but
            // --force is the always-correct instruction for any drift class incl. a
            // user hook with an appended totem block (mmnto-ai/totem#2138).
            installCommand = 'totem hook install --force';
          } else if (c.id === 'session-start-orientation') {
            generatedArtifacts = sessionStartArtifactsFor(gitRoot, sessionStartTemplates);
            artifactLabel = 'SessionStart hook';
            installCommand = 'totem init';
          }
          if (generatedArtifacts !== undefined) {
            // A drift on any artifact tags the contract id at most ONCE so the --strict
            // count reflects contracts, not artifacts (mirrors the skills branch).
            let blockingDrift = false;
            const lines = generatedArtifacts.map((a) => {
              const verdict = detectGeneratedArtifactContract({
                canonicalContent: a.canonicalContent,
                consumerPath: a.consumerPath,
                ownershipMarker: a.ownershipMarker,
                artifactLabel,
                installCommand,
                ...(a.endMarker !== undefined ? { endMarker: a.endMarker } : {}),
                ...(binary !== undefined ? { binary } : {}),
              });
              if (verdict.status === 'warn' && c.blocking === true) blockingDrift = true;
              return lineFor(a.lineName, verdict);
            });
            if (blockingDrift) blockingDriftIds.push(c.id);
            return lines;
          }

          // skills: managed-block content equality against the in-process template
          // (resolved above, pre-scope-guard, for the readout classification).
          const artifacts = skillArtifacts;
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

        // ── manual-attestation (mmnto-ai/totem#2073 manual-attestation slice) ──
        // The claim-class with no mechanical sensor: the detector surfaces the
        // tracked vendor-SDK pin (package set) or doctrine-currency row (no package)
        // as `info`, or honest-absent `skip` — NEVER pass/warn/fail/unknown. An
        // `info` can't enter blockingDriftIds, so these contracts cannot fail even
        // under --strict (the manifest's "never fails" contract).
        if (c.tractability === 'manual-attestation') {
          // Declared-covered but mechanically uncovered (#2327 R2 — human-asserted
          // judgment is not code-verified truth); nothing is probed.
          readoutMeta[c.id] = { coverage: 'attestation-only' };
          // The detector reads the sub-class discriminant (`c.package`) + the
          // canonical source directly off the contract. `package:` set ⇒ vendor-SDK
          // pin read; unset ⇒ doctrine-row pure-info surface. `attested` carries the
          // manifest's `last-attested:` date when present (strategy#540 /
          // mmnto-ai/totem#2125) — message refinement only, never a verdict input.
          const verdict = detectManualAttestationContract(c, {
            cwd,
            repoId,
            ...(c.lastAttested !== undefined ? { attested: c.lastAttested } : {}),
          });
          return [verdictToLine(c, verdict)];
        }

        // ── anything else (a future tractability) → skip stub; the slice boundary stays observable ──
        readoutMeta[c.id] = { coverage: 'honest-absent' };
        return [
          stub(c, `${c.dimension} (${c.tractability}) — drift detection not yet implemented`),
        ];
      });

      return {
        results: [summary, ...perContract],
        blockingDriftIds,
        configured,
        loadStatus: 'ok',
        readout: {
          manifest: {
            schemaVersion: result.manifest.schemaVersion,
            status: result.manifest.status,
          },
          contracts,
          meta: readoutMeta,
        },
      };
    }
  }
}

/** Wrap a single summary line in the `ParityCheckResult` shape (no blocking ids, no readout). */
function single(
  result: ParityLine,
  configured: boolean,
  loadStatus: ParityCheckResult['loadStatus'],
): ParityCheckResult {
  return { results: [result], blockingDriftIds: [], configured, loadStatus };
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

// ─── Trust-readout assembly (mmnto-ai/totem#2327) ────────

/** The `--json` artifact's own version stamp (`readout-schema-version`). */
const READOUT_SCHEMA_VERSION = 1;

/**
 * R2 claim-boundary sentence — the readout states its own scope in its own
 * output: an active-but-unmanifested surface (an undeclared MCP server, a
 * user-global plugin) is outside the claim, stated not implied.
 */
const CLAIM_BOUNDARY =
  'covers the manifest-declared contract set only; active-but-unmanifested surfaces are outside this claim';

/** Counts over rendered verdict lines — the R1 rollup unit (raised Delta 2). */
export type ReadoutCounts = Record<ParityLine['status'], number>;

/** One `--json` `rows[]` entry — 1:1 with a rendered verdict line (ids repeat for multi-artifact contracts). */
export interface ReadoutRow {
  id: string;
  /** Line verdict AFTER the strict blocking promotion, so the artifact matches the rendered output. */
  verdict: ParityLine['status'];
  sensesProbed?: SensesLevel;
  reasonClass?: ReadoutReasonClass;
  message: string;
  lastAttested?: string;
  /** Display name of the underlying verdict line (human render only — not a `--json` field; R4 names are fixed). */
  lineName: string;
  /** R5: a `blocking: true` contract's line skipped by scoping — rendered skipped-not-gated, never a silent pass. */
  skippedNotGated: boolean;
}

/** The assembled trust-readout — everything R1–R5 render from. */
export interface ParityReadout {
  manifest: { schemaVersion: number; status: string };
  rollup: { global: ReadoutCounts; perSeat: Record<string, ReadoutCounts> };
  denominator: { mechanical: number; attestationOnly: number; honestAbsent: number };
  strict: { armed: boolean; blockingIds: string[]; gatesAnything: boolean };
  rows: ReadoutRow[];
}

/**
 * Whether a verdict line belongs to a `--strict`-promotable contract. A
 * contract's drift can render across MULTIPLE artifact lines (e.g.
 * `Parity: claude-skills (signoff)`), so a line is promotable when its name is
 * the `Parity: <id>` summary OR a `Parity: <id> (…)` artifact line — an
 * exact-name Set would leave the artifact lines rendered as WARN while the
 * command still exits non-zero (GCA review). The trailing space guards against
 * a contract id that is a prefix of another. Shared by the CLI render and the
 * readout builder so the two can't disagree on what promoted.
 */
function isPromotableLineName(name: string, blockingDriftIds: string[]): boolean {
  return blockingDriftIds.some(
    (id) => name === `Parity: ${id}` || name.startsWith(`Parity: ${id} `),
  );
}

/** Resolve the contract a verdict line belongs to (same prefix rule as promotion). */
function contractForLineName(
  name: string,
  contracts: ParityContract[],
): ParityContract | undefined {
  return contracts.find((c) => name === `Parity: ${c.id}` || name.startsWith(`Parity: ${c.id} `));
}

// The CLI-side stubs' "not yet implemented" message shape — the one code-owned
// string the classifier keys on. A future optional reasonClass on the core
// verdict type retires this coupling (flagged to strategy in the
// 2026-07-09T2256Z deltas dispatch as an observation).
const HONEST_ABSENT_RE = /not yet implemented/;

/**
 * R3 reason class for one verdict line. `pass` omits its class. A `skip` is
 * `honest-absent` when the stub message or the contract's coverage class says
 * the detector is unbuilt; every other skip — scope-guard skips and
 * scope-indeterminate skips (e.g. applicable-but-missing scaffolds) alike —
 * classifies `scoping-skip`, never silently `honest-absent`, which would
 * understate what the registry implements.
 */
function reasonClassFor(
  verdict: ParityLine['status'],
  message: string,
  coverage: ReadoutCoverageClass | undefined,
): ReadoutReasonClass | undefined {
  switch (verdict) {
    case 'pass':
      return undefined;
    case 'warn':
    case 'fail':
      return 'drift';
    case 'info':
      return 'attestation';
    case 'unknown':
      return 'detector-error';
    case 'skip':
      if (HONEST_ABSENT_RE.test(message) || coverage === 'honest-absent') return 'honest-absent';
      return 'scoping-skip';
  }
}

/**
 * Assemble the trust-readout from `checkParity`'s raw materials — pure
 * post-processing over the existing detector output (Prop 303 non-goal 2:
 * zero probes added here).
 */
export function buildParityReadout(
  inputs: ParityReadoutInputs,
  results: ParityLine[],
  blockingDriftIds: string[],
  strict: boolean,
): ParityReadout {
  const { contracts, meta } = inputs;

  const rows: ReadoutRow[] = [];
  for (const line of results) {
    const contract = contractForLineName(line.name, contracts);
    // The section summary line (`Parity`) is not a contract row.
    if (contract === undefined) continue;
    const promoted =
      strict && line.status === 'warn' && isPromotableLineName(line.name, blockingDriftIds);
    const verdict: ParityLine['status'] = promoted ? 'fail' : line.status;
    const m = meta[contract.id];
    const reasonClass = reasonClassFor(verdict, line.message, m?.coverage);
    rows.push({
      id: contract.id,
      verdict,
      ...(m?.sensesProbed !== undefined ? { sensesProbed: m.sensesProbed } : {}),
      ...(reasonClass !== undefined ? { reasonClass } : {}),
      message: line.message,
      ...(contract.lastAttested !== undefined ? { lastAttested: contract.lastAttested } : {}),
      lineName: line.name,
      skippedNotGated: verdict === 'skip' && contract.blocking === true,
    });
  }

  const zero = (): ReadoutCounts => ({ pass: 0, warn: 0, info: 0, unknown: 0, skip: 0, fail: 0 });
  const global = zero();
  for (const r of rows) global[r.verdict] += 1;

  // Seats = the sorted union of declared vendor-adapter values. A line counts
  // toward seat S when its contract is vendor-neutral (no vendor-adapter — it
  // manifests on every seat) or declares S. An EMPTY vendor-adapter list is
  // treated as vendor-neutral too: the schema admits `[]`, and excluding such
  // a row from every seat while counting it globally would reopen the exact
  // per-seat honesty hole R1 exists to close (spec-owner review on #2328).
  // Per-seat exists precisely so a seat-scoped skip cannot hide inside the
  // global number (R1).
  const seats = [...new Set(contracts.flatMap((c) => c.vendorAdapter ?? []))].sort();
  const perSeat: Record<string, ReadoutCounts> = {};
  for (const seat of seats) perSeat[seat] = zero();
  const adapterById = new Map(contracts.map((c) => [c.id, c.vendorAdapter]));
  for (const r of rows) {
    const adapter = adapterById.get(r.id);
    for (const seat of seats) {
      if (adapter === undefined || adapter.length === 0 || adapter.includes(seat)) {
        perSeat[seat]![r.verdict] += 1;
      }
    }
  }

  // R2: the denominator counts CONTRACTS (registry ∩ manifest is contract-
  // granular), while the rollup above counts rendered verdict LINES — two
  // populations, named apart in the render (raised Delta 2).
  const denominator = { mechanical: 0, attestationOnly: 0, honestAbsent: 0 };
  for (const c of contracts) {
    const cls = meta[c.id]?.coverage ?? 'honest-absent';
    if (cls === 'mechanical') denominator.mechanical += 1;
    else if (cls === 'attestation-only') denominator.attestationOnly += 1;
    else denominator.honestAbsent += 1;
  }

  // R5: blocking-ids = the manifest's DECLARED `blocking: true` set, derived
  // from the yaml at run time (never from prose — Tenet 20); gates-anything =
  // that set is non-empty. Which blocking contracts actually drifted is
  // visible as `fail` rows (strict) / promotable warns (default).
  const blockingIds = contracts.filter((c) => c.blocking === true).map((c) => c.id);

  return {
    manifest: inputs.manifest,
    rollup: { global, perSeat },
    denominator,
    strict: { armed: strict, blockingIds, gatesAnything: blockingIds.length > 0 },
    rows,
  };
}

/** One-line count rendering shared by the global + per-seat rollup lines. */
function renderCounts(c: ReadoutCounts): string {
  return `${c.pass} pass · ${c.warn} warn · ${c.info} info · ${c.unknown} unknown · ${c.skip} skip · ${c.fail} fail`;
}

/**
 * R3 attestation-age fragment: days since `last-attested:` ("not recorded"
 * when absent). Staleness refines the message, never the status (the existing
 * manifest constraint, unchanged).
 */
function attestationAge(lastAttested: string | undefined): string {
  if (lastAttested === undefined) return 'last attested: not recorded';
  const t = Date.parse(lastAttested);
  if (Number.isNaN(t)) return `last attested: ${lastAttested} (unparseable date)`;
  const days = Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
  return `last attested ${days} day(s) ago`;
}

/**
 * The `--json` verdict artifact (R4) — field names fixed by the spec section
 * (kebab-case, no local envelope: the spec's top-level shape overrides the
 * `json-output.ts` success/error wrapper). Emitted bare on stdout so the
 * artifact is diffable (Prop 302 verdict-artifact discipline). On degenerate
 * manifest-load states the artifact carries the load status and empty
 * rollup/rows — the honest "nothing to roll up" shape.
 */
function readoutJsonArtifact(
  readout: ParityReadout | undefined,
  loadStatus: ParityCheckResult['loadStatus'],
  strict: boolean,
): Record<string, unknown> {
  const countsJson = (c: ReadoutCounts): Record<string, number> => ({
    pass: c.pass,
    warn: c.warn,
    info: c.info,
    unknown: c.unknown,
    skip: c.skip,
    fail: c.fail,
  });
  if (readout === undefined) {
    const zero: ReadoutCounts = { pass: 0, warn: 0, info: 0, unknown: 0, skip: 0, fail: 0 };
    return {
      'readout-schema-version': READOUT_SCHEMA_VERSION,
      manifest: { status: loadStatus },
      rollup: { global: countsJson(zero), 'per-seat': {} },
      denominator: {
        mechanical: 0,
        'attestation-only': 0,
        'honest-absent': 0,
        'claim-boundary': CLAIM_BOUNDARY,
      },
      strict: { armed: strict, 'blocking-ids': [], 'gates-anything': false },
      rows: [],
    };
  }
  return {
    'readout-schema-version': READOUT_SCHEMA_VERSION,
    manifest: {
      'schema-version': readout.manifest.schemaVersion,
      status: readout.manifest.status,
    },
    rollup: {
      global: countsJson(readout.rollup.global),
      'per-seat': Object.fromEntries(
        Object.entries(readout.rollup.perSeat).map(([seat, c]) => [seat, countsJson(c)]),
      ),
    },
    denominator: {
      mechanical: readout.denominator.mechanical,
      'attestation-only': readout.denominator.attestationOnly,
      'honest-absent': readout.denominator.honestAbsent,
      'claim-boundary': CLAIM_BOUNDARY,
    },
    strict: {
      armed: readout.strict.armed,
      'blocking-ids': readout.strict.blockingIds,
      'gates-anything': readout.strict.gatesAnything,
    },
    rows: readout.rows.map((r) => ({
      id: r.id,
      verdict: r.verdict,
      ...(r.sensesProbed !== undefined ? { 'senses-probed': r.sensesProbed } : {}),
      ...(r.reasonClass !== undefined ? { 'reason-class': r.reasonClass } : {}),
      message: r.message,
      ...(r.lastAttested !== undefined ? { 'last-attested': r.lastAttested } : {}),
      // R5 (build delta 4, mmnto-ai/totem-strategy#851): a qualifying row —
      // `verdict: skip` on a `blocking: true` contract (id ∈ strict.blocking-ids)
      // — carries `skipped-not-gated: true`. Presence-only, mirroring the
      // `last-attested?` convention: emitted true or the key is ABSENT, never
      // `false`. The fact is derivable, but R5's never-a-silent-pass posture
      // states it outright in the spec-shaped artifact rather than making every
      // consumer join two sections. Additive — `readout-schema-version` stays 1.
      ...(r.skippedNotGated ? { 'skipped-not-gated': true } : {}),
    })),
  };
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
  /**
   * Folded-into-`--strict` mode (mmnto-ai/totem#2085, mmnto-ai/totem-strategy#545
   * Half 2): when set, the command no-ops (renders nothing, throws nothing, exits 0)
   * if no repo-local `orient.parityManifest` is configured — so `doctor --strict`
   * exercises parity for opted-in repos while staying byte-identical for non-adopters
   * (satur8d's zero-churn condition). Default (omitted) preserves the standalone
   * `doctor --parity` behavior, which still renders the honest-absent SKIP line.
   */
  onlyWhenConfigured?: boolean;
  /**
   * Emit the trust-readout as the schema'd `--json` verdict artifact
   * (mmnto-ai/totem#2327 R4) on stdout INSTEAD of the human render — the
   * artifact is diffable, so nothing else may share stdout. The `--strict`
   * exit-code semantics are unchanged (artifact + non-zero exit both happen).
   */
  json?: boolean;
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
  const {
    results,
    blockingDriftIds,
    configured,
    loadStatus,
    readout: readoutInputs,
  } = await checkParity(cwd);

  // Folded-into-`--strict` no-op: when this run is the strict fold (not an explicit
  // `doctor --parity`) and no repo-local manifest is configured, render and gate
  // nothing — a non-adopter's `doctor --strict` stays byte-identical to before the
  // fold. Explicit `--parity` (onlyWhenConfigured omitted) still shows the SKIP.
  if (options.onlyWhenConfigured && !configured) return;

  const strict = options.strict === true;
  const readout =
    readoutInputs !== undefined
      ? buildParityReadout(readoutInputs, results, blockingDriftIds, strict)
      : undefined;

  // `--json` replaces the human render wholesale: the artifact owns stdout so
  // it stays diffable (R4). The strict throw below still applies — artifact
  // AND exit code, matching R5's "exits non-zero iff ≥1 fail".
  if (options.json) {
    process.stdout.write(
      JSON.stringify(readoutJsonArtifact(readout, loadStatus, strict), null, 2) + '\n',
    );
  } else {
    renderParityHuman(
      results,
      blockingDriftIds,
      strict,
      { log, bold, errorColor, successColor, warnColor },
      render,
    );
    if (readout !== undefined) {
      renderTrustReadout(readout, { log, bold }, render);
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

/** The ui.js pieces the human renderers borrow from the command scope. */
interface ParityUi {
  log: typeof import('../ui.js').log;
  bold: (s: string) => string;
  errorColor?: (s: string) => string;
  successColor?: (s: string) => string;
  warnColor?: (s: string) => string;
}

/** The pre-readout flat per-line render (unchanged output, extracted for the `--json` split). */
function renderParityHuman(
  results: ParityLine[],
  blockingDriftIds: string[],
  strict: boolean,
  ui: ParityUi,
  render: (text: string) => string,
): void {
  const { log, bold } = ui;
  const errorColor = ui.errorColor ?? ((s: string) => s);
  const successColor = ui.successColor ?? ((s: string) => s);
  const warnColor = ui.warnColor ?? ((s: string) => s);

  for (const r of results) {
    const status =
      strict && r.status === 'warn' && isPromotableLineName(r.name, blockingDriftIds)
        ? 'fail'
        : r.status;
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
}

/**
 * The trust-readout tail render (mmnto-ai/totem#2327 R1–R3, R5) — replaces the
 * bare "N loaded" ending with the rollup, coverage denominator, why-not lines,
 * and the `--strict` honesty statement. Verdict lines above stay untouched.
 */
function renderTrustReadout(
  readout: ParityReadout,
  ui: Pick<ParityUi, 'log' | 'bold'>,
  render: (text: string) => string,
): void {
  const { log, bold } = ui;

  log.info(TAG, bold('── trust-readout ──'));

  // R1 — one vocabulary, two scopes. Units named (verdict lines ≠ contracts).
  log.info(TAG, `rollup (verdict lines) — global: ${renderCounts(readout.rollup.global)}`);
  const seats = Object.keys(readout.rollup.perSeat);
  if (seats.length === 0) {
    log.dim(TAG, 'rollup — no seat-scoped rows declared (per-seat = global)');
  } else {
    for (const seat of seats) {
      log.info(
        TAG,
        `rollup — seat ${render(seat)}: ${renderCounts(readout.rollup.perSeat[seat]!)}`,
      );
    }
  }

  // R2 — three counts on their own line, never one "covered" number; the
  // claim boundary stated in the readout's own words.
  const d = readout.denominator;
  log.info(
    TAG,
    `coverage (contracts) — ${d.mechanical} mechanically sensed · ${d.attestationOnly} attestation-only · ${d.honestAbsent} honest-absent`,
  );
  log.dim(TAG, `claim boundary: ${CLAIM_BOUNDARY}`);

  // R3 — one why-not line per non-pass row, at the level actually probed
  // (green-halo cap: nothing renders above what was probed).
  const whyNot = readout.rows.filter((r) => r.verdict !== 'pass');
  if (whyNot.length > 0) {
    log.info(TAG, 'why-not (per non-pass row):');
    for (const r of whyNot) {
      const level = r.sensesProbed !== undefined ? ` at ${r.sensesProbed}` : '';
      const reason = r.reasonClass !== undefined ? ` [${r.reasonClass}]` : '';
      // R3 age-in-days for attestation rows. The detector message already
      // carries the raw date / "not recorded" text — append the derived age
      // only when a date exists to derive it from (no duplicate "not recorded").
      const age =
        r.reasonClass === 'attestation' && r.lastAttested !== undefined
          ? ` · ${attestationAge(r.lastAttested)}`
          : '';
      const gate = r.skippedNotGated ? ' · blocking — skipped-not-gated, never a silent pass' : '';
      log.dim(
        TAG,
        `  ${render(r.lineName)}: ${r.verdict.toUpperCase()}${level}${reason} — ${render(r.message)}${age}${gate}`,
      );
    }
  }

  // R5 — declaredly-toothless in the readout's own words; derived from the
  // manifest's blocking set at run time, never from prose.
  const s = readout.strict;
  const armed = s.armed ? 'armed' : 'not armed';
  if (!s.gatesAnything) {
    log.info(
      TAG,
      `--strict (${armed}): currently gates nothing — the manifest declares no blocking: true contracts`,
    );
  } else {
    log.info(
      TAG,
      `--strict (${armed}): gates ${s.blockingIds.length} blocking contract(s): ${s.blockingIds.map(render).join(', ')}`,
    );
  }
}
