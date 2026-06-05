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
  /**
   * Whether a repo-local `orient.parityManifest` field was configured (i.e.
   * `configValue !== undefined` after the global-leak guard). NOT whether the
   * manifest file loaded — a configured-but-broken manifest is `configured: true`
   * so the `--strict` fold surfaces the error instead of silently no-op'ing.
   * Lets the CLI edge fold parity into `--strict` only for repos that opted in
   * (mmnto-ai/totem#2085, mmnto-ai/totem-strategy#545 Half 2).
   */
  configured: boolean;
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
 * per-repo regenerated canonical. Checks `.git/hooks/*` only — hook-manager installs
 * (`.totem/hooks/*.sh` for husky / lefthook) are a follow-on (no cohort consumer uses
 * one today); the detector's present-without-marker → `skip` keeps a manager repo
 * honest in the meantime.
 */
function gitHookArtifactsFor(
  gitRoot: string,
  tier: 'strict' | 'standard',
  fallbackCmd: string,
  builders: HookBuilderSource,
): GeneratedArtifact[] {
  const hooksDir = path.join(gitRoot, '.git', 'hooks');
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
    detectGeneratedArtifactContract,
    detectManualAttestationContract,
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
      );

    case 'not-found':
      return single(
        {
          name: CHECK_NAME,
          status: 'warn',
          message: `parity manifest not found at ${rel(cwd, result.path)}`,
          remediation: 'Fix orient.parityManifest in your totem config to point at the manifest.',
        },
        configured,
      );

    case 'unparseable':
      return single(
        {
          name: CHECK_NAME,
          status: 'warn',
          message: `parity manifest unreadable at ${rel(cwd, result.path)}: ${result.reason}`,
          remediation: 'Fix the manifest YAML / schema, then re-run totem doctor --parity.',
        },
        configured,
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
        SKILL_MARKER_START,
        SKILL_MARKER_END,
        CLAUDE_SESSION_START,
        GEMINI_SESSION_START,
        SESSION_START_MARKER,
      } = await import('./init-templates.js');
      const skillTemplates: SkillTemplateSource = {
        distributedSkills: DISTRIBUTED_CLAUDE_SKILLS,
        reviewReplyContent: REVIEW_REPLY_SKILL_CONTENT,
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

        // ── mechanical content-equality (mmnto-ai/totem#2073) ──
        if (c.tractability === 'mechanical') {
          // Honor the contract's `consumers` scope before sensing drift (mirrors
          // detectVersionPinnedContract, which self-guards). A scoped mechanical
          // contract must not emit drift — or, under --strict, fail — in a repo that
          // is not an intended consumer (CodeRabbit review on mmnto-ai/totem#2079).
          if (c.consumers !== undefined) {
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
          }

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
            generatedArtifacts = gitHookArtifactsFor(gitRoot, hookTier, fallbackCmd, hookBuilders);
            artifactLabel = 'git hook';
            installCommand = 'totem hook install';
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

          // skills: managed-block content equality against the in-process template.
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

        // ── manual-attestation (mmnto-ai/totem#2073 manual-attestation slice) ──
        // The claim-class with no mechanical sensor: the detector surfaces the
        // tracked vendor-SDK pin (package set) or doctrine-currency row (no package)
        // as `info`, or honest-absent `skip` — NEVER pass/warn/fail/unknown. An
        // `info` can't enter blockingDriftIds, so these contracts cannot fail even
        // under --strict (the manifest's "never fails" contract).
        if (c.tractability === 'manual-attestation') {
          // The detector reads the sub-class discriminant (`c.package`) + the
          // canonical source directly off the contract. `package:` set ⇒ vendor-SDK
          // pin read; unset ⇒ doctrine-row pure-info surface. No `attested` yet (the
          // schema has no last-attested field — strategy's follow-on lane).
          const verdict = detectManualAttestationContract(c, { cwd, repoId });
          return [verdictToLine(c, verdict)];
        }

        // ── anything else (a future tractability) → skip stub; the slice boundary stays observable ──
        return [
          stub(c, `${c.dimension} (${c.tractability}) — drift detection not yet implemented`),
        ];
      });

      return { results: [summary, ...perContract], blockingDriftIds, configured };
    }
  }
}

/** Wrap a single summary line in the `ParityCheckResult` shape (no blocking ids). */
function single(result: ParityLine, configured: boolean): ParityCheckResult {
  return { results: [result], blockingDriftIds: [], configured };
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
  /**
   * Folded-into-`--strict` mode (mmnto-ai/totem#2085, mmnto-ai/totem-strategy#545
   * Half 2): when set, the command no-ops (renders nothing, throws nothing, exits 0)
   * if no repo-local `orient.parityManifest` is configured — so `doctor --strict`
   * exercises parity for opted-in repos while staying byte-identical for non-adopters
   * (satur8d's zero-churn condition). Default (omitted) preserves the standalone
   * `doctor --parity` behavior, which still renders the honest-absent SKIP line.
   */
  onlyWhenConfigured?: boolean;
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
  const { results, blockingDriftIds, configured } = await checkParity(cwd);

  // Folded-into-`--strict` no-op: when this run is the strict fold (not an explicit
  // `doctor --parity`) and no repo-local manifest is configured, render and gate
  // nothing — a non-adopter's `doctor --strict` stays byte-identical to before the
  // fold. Explicit `--parity` (onlyWhenConfigured omitted) still shows the SKIP.
  if (options.onlyWhenConfigured && !configured) return;

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
