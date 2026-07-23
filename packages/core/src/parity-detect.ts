/**
 * Version-pinned parity drift detector (PR-1, mmnto-ai/totem#2069).
 *
 * First detection slice on top of the merged manifest-parser skeleton (#2070).
 * Senses ONE tractability class — `version-pinned` — and only its DEPS subset
 * (the four `@mmnto/*` cohort-floor contracts: `mmnto-cli-version`,
 * `mmnto-totem-version`, `mmnto-mcp-version`,
 * `mmnto-pack-rust-architecture-version`). The verdict is **pin currency only**
 * (Tenet 20 claim-class bound): does the consumer's `@mmnto/*` pin resolve to
 * the current published cohort floor? It NEVER asserts semantic / file-content
 * drift — that would over-claim the `version-pinned` class.
 *
 * Layering: core must NOT import cli's `DiagnosticResult` (wrong dependency
 * direction). This module returns a core-local `ParityContractVerdict`; the CLI
 * (`doctor-parity.ts`) maps it to `DiagnosticResult` and owns the
 * `--strict`/`blocking` fail-promotion. The detector itself returns ONLY
 * `pass`/`warn`/`skip` — never `fail` — so the gate edge stays a CLI concern.
 *
 * Design invariants (mirroring `parity-manifest.ts` + `strategy-resolver.ts`):
 *   - **Honest-absent (Tenet 14):** absence is never an error. Not-a-consumer,
 *     floor-unresolvable, or a doctrine pin this slice doesn't handle → `skip`
 *     (the manifest's `-` "cohort permits absence"). An *applicable* consumer
 *     missing an expected pin is also `skip` while the manifest is scaffold, but
 *     kept DISTINCT (expected-but-absent → a `warn` once the consumers lists are
 *     verified) so the `consumers` field still catches the missing case. Never a
 *     fabricated verdict.
 *   - **NEVER networks:** the cohort floor is derived LOCALLY — self-in-tree
 *     (the totem monorepo at the current git root), a `../totem` sibling
 *     checkout, or — for a package totem doesn't publish — the contract's own
 *     canonical-source repo (e.g. `../totem-strategy`). None reachable →
 *     honest-absent `skip` with a reason.
 *   - **Side-effect-free / no caching:** every call reads from scratch. Each
 *     filesystem / git seam is injectable so tests drive synthetic fixtures.
 *   - **Never throws:** every read failure degrades to a `skip`/`warn` verdict;
 *     the sensor must never crash the doctor pipeline.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import semver from 'semver';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { PARITY_SENSES, type ParityContract, type ParitySense } from './parity-manifest.js';
import { escapeRegex } from './regex-utils.js';
import { sanitize } from './sanitize.js';
import {
  resolveStrategyRoot,
  type StrategyResolverOptions,
  type StrategyRootStatus,
} from './strategy-resolver.js';
import { safeExec } from './sys/exec.js';
import { resolveGitRoot } from './sys/git.js';

// ─── Constants ──────────────────────────────────────────

/**
 * Fixed scope for every PR-1 deps contract. The id slug (`mmnto-<x>-version`)
 * is the literal middle of the package name `@mmnto/<x>`; the scope is constant.
 */
const MMNTO_SCOPE = '@mmnto/';

/** The `mmnto-…-version` id convention PR-1 maps to a deps package name. */
const DEPS_CONTRACT_ID = /^mmnto-(.+)-version$/;

/** Sibling totem-monorepo dirname probed for a cohort floor (mirrors `resolveStrategyRoot` layer 3). */
const SIBLING_TOTEM_DIRNAME = 'totem';

/**
 * Canonical-source repo basename for strategy-published packages (e.g.
 * `@mmnto/strategy-doctrine`). When a contract's `canonicalSource` names this
 * repo, the cohort floor lives in `../totem-strategy/packages/*`, NOT in totem
 * — so `resolveCohortFloor` probes it via `resolveStrategyRoot`. mmnto-ai/totem#2108.
 */
const SIBLING_STRATEGY_DIRNAME = 'totem-strategy';

/**
 * Parity dimension for toolchain-version rows. A row in this dimension that
 * resolves NO deps package (e.g. `pnpm-engine-version`) pins its engine via the
 * consumer's `packageManager` field instead — the toolchain reader senses it
 * (mmnto-ai/totem#2115). `mmnto-cli-version` shares this dimension but resolves
 * `@mmnto/cli`, so it stays on the deps path.
 */
export const TOOLCHAIN_DIMENSION = 'toolchain-version';

/** Bounded git-command timeout for the origin-remote probe (matches `sys/git.ts`). */
const GIT_REMOTE_TIMEOUT_MS = 15_000;

/**
 * The dep fields, in resolution order, that a consumer can declare an `@mmnto/*`
 * pin under. `dependencies` first so a normal runtime dep wins display, but the
 * detector treats a declaration in ANY of these as "the pin is declared here."
 */
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

// ─── Verdict type ───────────────────────────────────────

/**
 * Core-local per-contract verdict. The CLI renders this directly (core cannot
 * depend on cli's `DiagnosticResult`/`CheckStatus`). The verdict vocabulary is
 * intentionally WIDER than the shared `CheckStatus` so the parity sensor can
 * honor the round's verdict-state split (mmnto-ai/totem#2073 req #1 — don't
 * collapse to a binary pass/fail) without rippling `CheckStatus` across every
 * unrelated doctor check:
 *   - `pass`    — verified equal / current.
 *   - `warn`    — drift (sensor-not-gate default; the CLI promotes a `warn` from
 *                 a `blocking: true` contract to `fail` ONLY under `--strict`).
 *   - `info`    — an intentional, attested fork (req #7) — NEVER gated/promoted.
 *   - `unknown` — the Stale-Doctor-Paradox state: the canonical could not be
 *                 resolved, so the doctor can prove neither drift NOR currency.
 *                 NEVER rendered as `pass` (no self-certification); NEVER gated.
 *   - `skip`    — not-applicable / cohort-permits-absence / out of this slice.
 *
 * `fail` stays in the union as the CLI-edge promotion target, but a DETECTOR
 * never emits it (the gate edge is a CLI concern, unchanged from PR-1).
 */
export interface ParityContractVerdict {
  status: 'pass' | 'warn' | 'fail' | 'info' | 'unknown' | 'skip';
  message: string;
  remediation?: string;
}

// ─── deriveCohortRepoId ─────────────────────────────────

/** Test seams for {@link deriveCohortRepoId} (mirrors `StrategyResolverOptions`). */
export interface DeriveCohortRepoIdOptions {
  /**
   * Pre-resolved git `origin` remote URL. Production callers omit it and the
   * helper shells out via `git remote get-url origin`. When provided (even as
   * `undefined`, signalling "no remote"), the shell-out is skipped.
   */
  remoteUrl?: string;
  /**
   * Full override of the remote reader. Takes precedence over `remoteUrl`. A
   * throwing reader is swallowed (git failure → fall through), so passing one
   * that throws exercises the no-network / no-throw path.
   */
  readRemote?: (cwd: string) => string | undefined;
  /** Test seam — production callers omit and the helper invokes `resolveGitRoot(cwd)`. */
  gitRoot?: string | null;
}

/**
 * Derive the current repo's cohort id (e.g. `totem-status`) used to evaluate a
 * contract's `consumers` applicability. Precedence:
 *   1. git `origin` remote — `…mmnto-ai/<name>(.git)?` → `<name>`.
 *   2. `package.json` `name` basename (scope stripped) — `@mmnto/totem-status`
 *      → `totem-status`.
 *   3. git-root directory basename.
 *
 * Returns `undefined` only when nothing resolves. NEVER throws and NEVER
 * networks beyond the local `git remote get-url` read (which is swallowed on
 * failure — git being unavailable is a routine fall-through, not an error).
 */
export function deriveCohortRepoId(
  cwd: string,
  options: DeriveCohortRepoIdOptions = {},
): string | undefined {
  // ── 1. git origin remote ──
  const remoteUrl = readOriginRemote(cwd, options);
  const fromRemote = repoIdFromRemoteUrl(remoteUrl);
  if (fromRemote !== undefined) return fromRemote;

  // Anchor the fallbacks at the git root (not the deep cwd) so the dir-basename
  // fallback names the repo, not a nested subdir. Lazy: only probed when the
  // remote miss forces a fallback.
  const root = resolveRootForFallback(cwd, options.gitRoot);

  // ── 2. package.json name basename (scope stripped) ──
  const fromPkg = repoIdFromPackageName(root);
  if (fromPkg !== undefined) return fromPkg;

  // ── 3. git-root dir basename ──
  const base = path.basename(root);
  return base.length > 0 ? base : undefined;
}

/**
 * Read the git `origin` remote URL, honoring the injected seams. A throwing
 * reader (or a real git failure) is swallowed — the caller falls through to the
 * package.json / dir-basename fallbacks.
 */
function readOriginRemote(cwd: string, options: DeriveCohortRepoIdOptions): string | undefined {
  if (options.readRemote !== undefined) {
    try {
      return options.readRemote(cwd);
      // totem-context: an injected remote-reader that throws is treated as "no remote resolvable" (fall through to the package.json / dir-basename fallbacks); rethrowing would break the never-throws contract for a routine git miss.
    } catch {
      return undefined;
    }
  }
  if ('remoteUrl' in options) return options.remoteUrl;
  try {
    return safeExec('git', ['remote', 'get-url', 'origin'], {
      cwd,
      timeout: GIT_REMOTE_TIMEOUT_MS,
    });
    // totem-context: a missing remote / non-git dir / absent git binary is a routine fall-through to the package.json + dir-basename fallbacks, not a sensor failure — the doctor runs against repos without an origin remote by design.
  } catch {
    return undefined;
  }
}

/** Extract `<name>` from a `…mmnto-ai/<name>(.git)?` remote URL, else undefined. */
function repoIdFromRemoteUrl(remoteUrl: string | undefined): string | undefined {
  if (typeof remoteUrl !== 'string' || remoteUrl.trim().length === 0) return undefined;
  // Match the org segment in both ssh (`git@…:mmnto-ai/x.git`) and https
  // (`https://…/mmnto-ai/x.git`) forms; tolerate a trailing `.git` + slashes.
  const match = remoteUrl.trim().match(/mmnto-ai\/([^/\s]+?)(?:\.git)?\/?$/);
  return match?.[1];
}

/** Read `package.json` `name`, strip a leading `@scope/`, return the basename. */
function repoIdFromPackageName(root: string): string | undefined {
  const name = readPackageName(path.join(root, 'package.json'));
  if (name === undefined) return undefined;
  // `@mmnto/totem-status` → `totem-status`; `plain-name` → `plain-name`.
  const slash = name.lastIndexOf('/');
  const base = slash === -1 ? name : name.slice(slash + 1);
  return base.length > 0 ? base : undefined;
}

/** Resolve the anchor for fallbacks: injected gitRoot, else `resolveGitRoot(cwd)`, else cwd. */
function resolveRootForFallback(cwd: string, injected: string | null | undefined): string {
  if (injected !== undefined) return injected ?? cwd;
  try {
    return resolveGitRoot(cwd) ?? cwd;
    // totem-context: resolveGitRoot throws on permission errors / corrupted index; falling back to cwd keeps the dir-basename fallback working rather than crashing the sensor on a git hiccup.
  } catch {
    return cwd;
  }
}

// ─── packageNameForContract ─────────────────────────────

/**
 * Resolve the `@mmnto/*` (or vendor) package name a deps/vendor contract pins.
 * Precedence:
 *   1. **explicit `package:` field** (mmnto-ai/totem-strategy#517) — the
 *      machine-parseable name, derive-not-guess. Preferred when present.
 *   2. **canonical-source path locator** — when `canonicalSource` carries a
 *      `:path/to/package.json` segment (e.g. `mmnto-cli-version`'s
 *      `mmnto-ai/totem:packages/cli/package.json#version`), read the `name`
 *      from that package.json under `floorRoot`. Authoritative — no id guess.
 *   3. **id convention** — `mmnto-<x>-version` → `@mmnto/<x>` (fallback until all
 *      contracts carry `package:`).
 *
 * Returns `undefined` for contracts with no `package:`, no path locator, and an
 * id that doesn't match the convention (e.g. `governance-doctrine`, `gate-config`)
 * so ONLY the contracts this slice handles resolve a name; the CLI keeps the rest
 * as `skip` stubs.
 *
 * @param floorRoot Optional root the canonical-source path locator anchors at
 *                  (the resolved cohort-floor repo). Omit when only `package:` /
 *                  the id convention is wanted.
 */
export function packageNameForContract(
  contract: ParityContract,
  floorRoot?: string,
): string | undefined {
  // ── 1. explicit `package:` field (derive-not-guess; strategy#517) ──
  if (typeof contract.package === 'string' && contract.package.trim().length > 0) {
    return contract.package.trim();
  }

  // ── 2. canonical-source path locator → read `name` from that package.json ──
  if (floorRoot !== undefined) {
    const fromLocator = packageNameFromCanonicalSource(contract.canonicalSource, floorRoot);
    if (fromLocator !== undefined) return fromLocator;
  }

  // ── 3. id convention (mmnto-<x>-version → @mmnto/<x>) ──
  const match = contract.id.match(DEPS_CONTRACT_ID);
  if (match?.[1] === undefined) return undefined;
  // Concatenate (not template-interpolate) so the `@mmnto/` scope's own trailing
  // `/` reads as the delimiter between scope and package slug.
  return MMNTO_SCOPE + match[1];
}

/**
 * Read the `name` from the package.json referenced by a `repo:path#fragment`
 * canonical-source locator, anchored at `floorRoot`. Returns undefined when the
 * locator has no `:package.json` path segment or the file is unreadable.
 */
function packageNameFromCanonicalSource(
  canonicalSource: string | null,
  floorRoot: string,
): string | undefined {
  if (typeof canonicalSource !== 'string') return undefined;
  // Shape: `<repo>:<path>#<fragment>` — we only want the `<path>` between the
  // first `:` and an optional `#`. A bare `mmnto-ai/totem` (no `:`) has no path.
  const colon = canonicalSource.indexOf(':');
  if (colon === -1) return undefined;
  const afterColon = canonicalSource.slice(colon + 1);
  const hash = afterColon.indexOf('#');
  const relPath = (hash === -1 ? afterColon : afterColon.slice(0, hash)).trim();
  if (!relPath.endsWith('package.json')) return undefined;
  return readPackageName(path.join(floorRoot, relPath));
}

/**
 * The repo basename a `canonicalSource` names — the `<repo>` before the first
 * `:` (or the whole string when there's no path segment), then its trailing
 * path component. `mmnto-ai/totem-strategy:packages/strategy-doctrine/package.json`
 * → `totem-strategy`; `mmnto-ai/totem` → `totem`. Lets `resolveCohortFloor`
 * route a strategy-published package to the `../totem-strategy` repo instead of
 * the totem monorepo. mmnto-ai/totem#2108.
 */
function canonicalRepoBasename(canonicalSource: string | null | undefined): string | undefined {
  if (typeof canonicalSource !== 'string') return undefined;
  const colon = canonicalSource.indexOf(':');
  const repo = (colon === -1 ? canonicalSource : canonicalSource.slice(0, colon)).trim();
  if (repo.length === 0) return undefined;
  const slash = repo.lastIndexOf('/');
  return slash === -1 ? repo : repo.slice(slash + 1);
}

// ─── resolveCohortFloor ─────────────────────────────────

/**
 * Honest-absent cohort-floor resolution outcome (discriminated union, mirroring
 * `StrategyRootStatus`):
 *   - `resolved: true`  — `version` is the floor; `source` tags WHICH local
 *     layer supplied it (`self-in-tree` | `sibling`).
 *   - `resolved: false` — `reason` is an agent-surfacing string (e.g. clone the
 *     monorepo as a sibling). The sensor renders this as a `skip`.
 */
export type CohortFloorStatus =
  | { resolved: true; version: string; source: 'self-in-tree' | 'sibling' | 'canonical-source' }
  | { resolved: false; reason: string };

/**
 * Resolve the "current published version" cohort floor for `packageName`,
 * derived LOCALLY (NEVER networks), in precedence order:
 *   (a) **self-in-tree** — the current git root IS the canonical-source repo
 *       (the totem monorepo): glob `<gitRoot>/packages/*​/package.json`, find
 *       the one whose `name === packageName`, read its `version`.
 *   (b) **sibling** — `<gitRoot>/../totem` exists as a directory: glob its
 *       `packages/*​/package.json` the same way.
 *   (c) **canonical-source repo** — when `canonicalSource` names a repo totem
 *       does NOT publish (e.g. `mmnto-ai/totem-strategy` for
 *       `@mmnto/strategy-doctrine`), the floor lives in that repo's
 *       `packages/*`, not totem's. Locate it via `resolveStrategyRoot`
 *       (env / config / `../totem-strategy` sibling) and glob the same way.
 *       Without this, strategy-published rows resolve `skip` instead of the
 *       consumer-side `pass`/`warn` (mmnto-ai/totem#2108).
 *   (d) **honest-absent** — none reachable → `{ resolved: false, reason }`.
 *
 * NEVER fabricates a floor and NEVER fetches (`resolveStrategyRoot` is local
 * fs only). Anchors at `gitRoot`, not cwd (mirroring `strategy-resolver.ts`).
 * Read failures within the glob are swallowed per-file so one corrupt
 * package.json can't crash the resolver.
 *
 * The floor is keyed structurally on `packageName` (the matching
 * `packages/*​/package.json` `name`), NOT on the consumer's cohort id — a
 * misderived repoId can't mask a genuine in-tree floor.
 */
export function resolveCohortFloor(
  packageName: string,
  gitRoot: string,
  canonicalSource?: string | null,
): CohortFloorStatus {
  // ── (a) self-in-tree ──
  // The canonical-source repo for every deps contract is the totem monorepo. If
  // the current repo IS that monorepo, its own packages/*/package.json is the
  // floor. We detect "is the monorepo" structurally (a packages/*/package.json
  // whose name === packageName), not just by id, so a misderived repoId can't
  // mask a genuine in-tree floor.
  const selfVersion = readVersionFromPackagesGlob(gitRoot, packageName);
  if (selfVersion !== undefined) {
    return { resolved: true, version: selfVersion, source: 'self-in-tree' };
  }

  // ── (b) sibling ../totem ──
  const sibling = path.normalize(path.join(gitRoot, '..', SIBLING_TOTEM_DIRNAME));
  if (isDirectory(sibling)) {
    const siblingVersion = readVersionFromPackagesGlob(sibling, packageName);
    if (siblingVersion !== undefined) {
      return { resolved: true, version: siblingVersion, source: 'sibling' };
    }
  }

  // ── (c) canonical-source repo (strategy-published packages) ──
  // A package totem doesn't publish (e.g. @mmnto/strategy-doctrine) has its
  // floor in its OWN canonical-source repo, not totem's. Today the only such
  // repo is mmnto-ai/totem-strategy; reuse `resolveStrategyRoot` (env / config /
  // ../totem-strategy sibling — NEVER networks) rather than duplicating the
  // sibling probe. Self-in-tree (a) / ../totem sibling (b) match structurally on
  // `name`, so a strategy package never false-matches them and always falls here.
  const canonicalRepo = canonicalRepoBasename(canonicalSource);
  let strategyRootResolvedAt: string | undefined;
  if (canonicalRepo === SIBLING_STRATEGY_DIRNAME) {
    const strategyRoot = resolveStrategyRoot(gitRoot, { gitRoot });
    if (strategyRoot.resolved) {
      strategyRootResolvedAt = strategyRoot.path;
      const stratVersion = readVersionFromPackagesGlob(strategyRoot.path, packageName);
      if (stratVersion !== undefined) {
        return { resolved: true, version: stratVersion, source: 'canonical-source' };
      }
    }
  }

  // ── (d) honest-absent ──
  // Point the remediation at the package's OWN canonical-source repo — never
  // recommend ../totem for a package totem doesn't publish (mmnto-ai/totem#2108).
  // When the strategy repo DID resolve but the package isn't in it, say exactly
  // that — don't tell the developer to clone / set what they already have (GCA #2252).
  let reason: string;
  if (canonicalRepo === SIBLING_STRATEGY_DIRNAME) {
    reason =
      strategyRootResolvedAt !== undefined
        ? `cohort floor for ${packageName} not found in the resolved ${SIBLING_STRATEGY_DIRNAME} repo at ${strategyRootResolvedAt}`
        : `cohort floor for ${packageName} not locally determinable; clone mmnto-ai/${SIBLING_STRATEGY_DIRNAME} as a sibling (../${SIBLING_STRATEGY_DIRNAME}) or set STRATEGY_ROOT`;
  } else {
    reason = `cohort floor for ${packageName} not locally determinable; clone mmnto-ai/totem as a sibling (../${SIBLING_TOTEM_DIRNAME}) or run from the totem monorepo`;
  }
  return { resolved: false, reason };
}

/**
 * Glob `<root>/packages/*​/package.json`, return the `version` of the one whose
 * `name === packageName`. Returns undefined when `<root>/packages` is absent,
 * no package matches, or every read fails. Per-file read failures are swallowed
 * so one corrupt manifest doesn't sink the whole probe.
 */
function readVersionFromPackagesGlob(root: string, packageName: string): string | undefined {
  const packagesDir = path.join(root, 'packages');
  let names: string[];
  try {
    names = fs.readdirSync(packagesDir);
    // totem-context: an absent or unreadable packages/ dir is the "not the monorepo here" signal — return undefined so the resolver falls through to the sibling / honest-absent layer rather than throwing.
  } catch {
    return undefined;
  }

  for (const name of names) {
    const entryPath = path.join(packagesDir, name);
    // Use the statSync-based `isDirectory` (follows symlinks) rather than a
    // `Dirent.isDirectory()` filter — pnpm / workspace setups symlink package
    // dirs, which the lstat-like Dirent check reports as non-directories and
    // would skip (GCA review #2071).
    if (!isDirectory(entryPath)) continue;
    const parsed = readPackageJson(path.join(entryPath, 'package.json'));
    if (parsed?.name === packageName && typeof parsed.version === 'string') {
      return parsed.version;
    }
  }
  return undefined;
}

// ─── detectVersionPinnedContract ────────────────────────

/** Test seams + context for {@link detectVersionPinnedContract}. */
export interface DetectVersionPinnedContext {
  /** The consumer repo to read `package.json` / `node_modules` from. */
  cwd: string;
  /** The git root to anchor cohort-floor resolution at (NOT cwd — mirrors the resolver). */
  gitRoot: string;
  /** The current repo's cohort id (from {@link deriveCohortRepoId}) for `consumers` applicability. */
  repoId?: string;
  /**
   * Package name pre-resolved by the caller (the CLI resolves it once for
   * routing — {@link packageNameForContract}). When provided, the detector skips
   * re-resolving it (avoids a duplicate locator package.json read). Omit and the
   * detector resolves it itself.
   */
  packageName?: string;
  /**
   * Test seam — override the consumer package.json read. Production callers omit
   * it and the detector reads `<cwd>/package.json`.
   */
  readPackageJson?: (absPath: string) => PackageJsonShape | undefined;
}

/**
 * Minimal package.json shape the detector reads. Deliberately loose — the file
 * is untrusted on-disk JSON, so every field is optional + runtime-checked.
 */
export interface PackageJsonShape {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  /** Corepack engine pin (`<name>@<version>(+<hash>)?`) — read by the toolchain reader (mmnto-ai/totem#2115). */
  packageManager?: string;
}

/**
 * Detect drift for ONE `version-pinned` deps contract. Returns a
 * `ParityContractVerdict`:
 *   - **pass** — the consumer's resolved-installed `@mmnto/*` version is ≥ the
 *     cohort floor (current).
 *   - **warn** — installed < floor (stale pin). Sensor-not-gate default: the
 *     detector returns `warn` even for a `blocking` contract; the CLI promotes
 *     to `fail` only under `--strict`.
 *   - **skip** — not-a-consumer / pin not declared / floor unresolvable / not a
 *     deps contract this slice handles / unparseable range (honest-absent).
 *
 * NEVER emits `fail` (CLI-edge concern). NEVER throws (read failures degrade to
 * `skip`). NEVER networks (floor is local-only). NEVER asserts content drift
 * (claim-class bound to pin currency).
 */
export function detectVersionPinnedContract(
  contract: ParityContract,
  ctx: DetectVersionPinnedContext,
): ParityContractVerdict {
  // ── Applicability: consumers list ──
  if (contract.consumers !== undefined) {
    if (ctx.repoId === undefined) {
      // Can't decide applicability without a cohort id — surface it (honest-
      // absent) rather than silently treating the contract as applicable, which
      // would make the consumers scope a no-op for this repo (Tenet 4 / Greptile
      // review #2071).
      return {
        status: 'skip',
        message: `cannot determine applicability — repo id unresolvable; contract is scoped to consumers [${contract.consumers.join(', ')}]`,
      };
    }
    if (!contract.consumers.includes(ctx.repoId)) {
      return {
        status: 'skip',
        message: `cohort permits absence here (${ctx.repoId} not in consumers)`,
      };
    }
  }

  // ── Resolve the package name (`package:` → locator → id convention) ──
  // Prefer a name pre-resolved by the CLI (avoids re-reading a locator's
  // package.json — Greptile review #2071); fall back to resolving here for
  // standalone callers (tests). gitRoot is the floorRoot for a path locator.
  const packageName = ctx.packageName ?? packageNameForContract(contract, ctx.gitRoot);
  if (packageName === undefined) {
    // A toolchain-version row with no deps package pins its engine via the
    // consumer's `packageManager` field (e.g. pnpm-engine-version) — route it to
    // the packageManager reader rather than skipping (mmnto-ai/totem#2115).
    if (contract.dimension === TOOLCHAIN_DIMENSION) {
      return detectPackageManagerToolchain(contract, ctx);
    }
    return {
      status: 'skip',
      message: `not a deps version-pinned contract this slice handles (${contract.id})`,
    };
  }

  // ── Read the consumer package.json + its declared range for this pkg ──
  const readPkg = ctx.readPackageJson ?? readPackageJson;
  const consumerPkg = readPkg(path.join(ctx.cwd, 'package.json'));
  const declaredRange = consumerPkg ? findDeclaredRange(consumerPkg, packageName) : undefined;
  if (declaredRange === undefined) {
    // Applicable-but-missing: we already passed the `consumers` gate above, so
    // this repo IS an applicable consumer (in `consumers`, or `consumers` absent
    // = applies to all) — an expected pin that's absent is drift, NOT
    // cohort-permitted absence. Held as
    // a skip-with-note while the manifest is scaffold (consumers lists are
    // best-effort); flips to `warn` once verified. Kept DISTINCT from the
    // not-a-consumer skip so the `consumers` field still does its job (strategy
    // ack 2026-06-03T0156Z, design-call 3).
    return {
      status: 'skip',
      message: `${packageName} expected but not declared — applicable consumer (scaffold: skip; becomes a drift warn once consumers are verified)`,
      remediation: `Declare ${packageName} in this repo's package.json, or drop this repo from the contract's consumers list if it genuinely does not apply here.`,
    };
  }

  // Guard an unparseable declared range BEFORE resolving anything else — a
  // garbage range can't yield a currency verdict, so honest-absent skip.
  if (semver.validRange(declaredRange) === null) {
    return {
      status: 'skip',
      message: `${packageName} declared range "${declaredRange}" is not a valid semver range`,
    };
  }

  // ── Resolve the consumer's installed version (fallback: minVersion(range)) ──
  const resolved = resolveInstalledVersion(ctx.cwd, packageName, declaredRange);
  if (resolved === undefined) {
    return {
      status: 'skip',
      message: `${packageName} pinned (${declaredRange}) but no resolvable installed version`,
    };
  }
  const installed = resolved.version;
  // The verdict-format constraint (296 §6(a)3 post-#605): a minVersion-derived
  // version is a DECLARED-level claim — the message must carry the degraded
  // level + the originating range, never read as installed-level.
  const declaredOnly = resolved.source === 'declared-min';

  // ── Resolve the cohort floor (local-only; honest-absent on miss) ──
  // Pass canonicalSource so a strategy-published package routes to its own
  // canonical-source repo (../totem-strategy) for the floor (mmnto-ai/totem#2108).
  const floor = resolveCohortFloor(packageName, ctx.gitRoot, contract.canonicalSource);
  if (!floor.resolved) {
    return { status: 'skip', message: floor.reason };
  }

  // Guard an invalid floor version (corrupt in-tree manifest) → honest-absent.
  if (semver.valid(floor.version) === null) {
    return {
      status: 'skip',
      message: `cohort floor for ${packageName} ("${floor.version}") is not a valid version`,
    };
  }

  // ── Verdict: pin currency only (semver compare) ──
  // installed ≥ floor → current; installed < floor → stale. The claim is pin
  // currency, NOT semantic content — a version-pinned contract may never assert
  // file/content equality.
  if (semver.gte(installed, floor.version)) {
    if (declaredOnly) {
      return {
        status: 'pass',
        message: `${packageName} pin current at the declared level — declared-min ${installed} from range ${declaredRange} ≥ cohort floor ${floor.version} (${floor.source}); no installed copy resolved`,
      };
    }
    return {
      status: 'pass',
      message: `${packageName} pin current — installed ${installed} ≥ cohort floor ${floor.version} (${floor.source})`,
    };
  }

  if (declaredOnly) {
    return {
      status: 'warn',
      message: `${packageName} pin stale at the declared level — declared-min ${installed} from range ${declaredRange} < cohort floor ${floor.version} (${floor.source}); no installed copy resolved`,
      remediation: `Bump the ${packageName} dependency to >= ${floor.version} and reinstall, then re-run totem doctor --parity.`,
    };
  }
  return {
    status: 'warn',
    message: `${packageName} pin stale — declared ${declaredRange}, installed ${installed} < cohort floor ${floor.version} (${floor.source})`,
    remediation: `Bump the ${packageName} dependency to >= ${floor.version} and reinstall, then re-run totem doctor --parity.`,
  };
}

// ─── detectPackageManagerToolchain ──────────────────────

/** A parsed corepack `packageManager` spec: `<name>@<version>(+<hash>)?`. */
interface PackageManagerSpec {
  name: string;
  version: string;
  /** The corepack integrity hash (after `+`), or undefined for a hashless pin. */
  hash: string | undefined;
}

/**
 * Parse a `<name>@<version>(+<hash>)?` corepack spec.
 *
 * Two modes (greptile review mmnto-ai/totem#2254):
 *   - `exact: false` (default) — match the LEADING token, tolerating trailing
 *     prose. For the manifest FLOOR, expressed as `pnpm@11.2.2 floor; pin >= floor`.
 *   - `exact: true` — the WHOLE trimmed value must match. For the consumer's
 *     `packageManager` field: corepack requires the entire value to be a valid
 *     `<name>@<version>[+<hash>]`, so a declaration like `pnpm@11.2.2 garbage`
 *     is MALFORMED — doctor must not report it current off a leading-token match.
 *
 * Returns undefined when no spec matches. Pure + total — never throws (mmnto-ai/totem#2115).
 */
function parsePackageManagerSpec(
  raw: string | undefined | null,
  opts: { exact?: boolean } = {},
): PackageManagerSpec | undefined {
  if (typeof raw !== 'string') return undefined;
  // <name> = a package-manager slug; <version> = a semver core (+ optional
  // prerelease/build that stops at whitespace or the `+hash` delimiter). Under
  // `exact`, a trailing `$` rejects anything after the (optional) hash.
  const pattern = opts.exact
    ? /^([a-z][a-z0-9-]*)@(\d+\.\d+\.\d+[^\s+]*)(\+\S+)?$/i
    : /^([a-z][a-z0-9-]*)@(\d+\.\d+\.\d+[^\s+]*)(\+\S+)?/i;
  const m = raw.trim().match(pattern);
  if (m?.[1] === undefined || m[2] === undefined) return undefined;
  return { name: m[1], version: m[2], hash: m[3] !== undefined ? m[3].slice(1) : undefined };
}

/**
 * Sense a toolchain-version row that pins its engine via the consumer's
 * `packageManager` field (e.g. `pnpm-engine-version`). The manifest row carries
 * the floor in `expected-value-or-derivation` (`<engine>@<floor>` — there is no
 * `packages/*​/package.json` to glob, `canonical-source` is null). Reads the
 * DECLARATION only (`senses: declared`) — never probes the installed binary.
 *
 * Verdicts (claim-class bound to pin currency, mirroring the deps path):
 *   - **pass** — consumer's `packageManager` engine matches + version ≥ floor.
 *   - **warn** — engine matches but version < floor (stale).
 *   - **skip** — no floor derivable / no `packageManager` field / unparseable pin
 *     / a DIFFERENT engine (the floor doesn't apply) / invalid versions.
 * NEVER throws, NEVER networks (mmnto-ai/totem#2115).
 */
function detectPackageManagerToolchain(
  contract: ParityContract,
  ctx: DetectVersionPinnedContext,
): ParityContractVerdict {
  const floorSpec = parsePackageManagerSpec(contract.expectedValueOrDerivation);
  if (floorSpec === undefined) {
    return {
      status: 'skip',
      message: `${contract.id}: cohort floor not derivable from expected-value "${contract.expectedValueOrDerivation}"`,
    };
  }

  const readPkg = ctx.readPackageJson ?? readPackageJson;
  const consumerPkg = readPkg(path.join(ctx.cwd, 'package.json'));
  const pmField = consumerPkg?.packageManager;
  if (typeof pmField !== 'string' || pmField.trim().length === 0) {
    return {
      status: 'skip',
      message: `${contract.id}: no packageManager field declared (honest-absent)`,
    };
  }

  // Exact match: the WHOLE field must be a valid corepack pin — a malformed
  // declaration (trailing junk after the version/hash) must not pass off a
  // leading-token match (greptile mmnto-ai/totem#2254).
  const pin = parsePackageManagerSpec(pmField, { exact: true });
  if (pin === undefined) {
    return {
      status: 'skip',
      message: `${contract.id}: packageManager "${pmField}" is not a parseable <name>@<version> pin`,
    };
  }

  // A different engine → this row's floor simply doesn't apply here.
  if (pin.name !== floorSpec.name) {
    return {
      status: 'skip',
      message: `${contract.id}: consumer pins ${pin.name}@${pin.version}, not ${floorSpec.name} — cohort floor does not apply`,
    };
  }

  if (semver.valid(pin.version) === null || semver.valid(floorSpec.version) === null) {
    return {
      status: 'skip',
      message: `${contract.id}: unparseable version (pin "${pin.version}", floor "${floorSpec.version}")`,
    };
  }

  // Hashless pins lose corepack integrity verification — surfaced as a note, not
  // a failure (strategy#566 Greptile P2: hashless pins are a derive-before-authoring smell).
  const hashNote =
    pin.hash === undefined ? ' (pin is hashless — corepack integrity not pinned)' : '';
  if (semver.gte(pin.version, floorSpec.version)) {
    return {
      status: 'pass',
      message: `${pin.name} engine pin current — packageManager ${pin.version} ≥ cohort floor ${floorSpec.version}${hashNote}`,
    };
  }
  return {
    status: 'warn',
    message: `${pin.name} engine pin stale — packageManager ${pin.version} < cohort floor ${floorSpec.version}${hashNote}`,
    remediation: `Bump the packageManager field to ${pin.name}@${floorSpec.version} (or a newer EXACT version — corepack requires an exact pin, not a range), then re-run totem doctor --parity.`,
  };
}

/**
 * A consumer version resolution, tagged with WHICH state-level produced it
 * (mmnto-ai/totem#2140, the 296 §6(a)3 `declared` floor):
 *   - `installed`    — read from an actual on-disk `node_modules` copy.
 *   - `declared-min` — `semver.minVersion(declaredRange)`: derived from the
 *     DECLARATION alone, below `present` on the sensed-state scale. Verdicts
 *     built on this source must render the degraded level (the settled
 *     verdict-format constraint, strategy#605) — never read as installed-level.
 */
interface ResolvedConsumerVersion {
  version: string;
  source: 'installed' | 'declared-min';
}

/**
 * Resolve the consumer's installed `@mmnto/*` version. Walks UP the directory
 * tree from `cwd` reading `<dir>/node_modules/<pkg>/package.json#version` at each
 * ancestor — monorepo / pnpm / npm-workspace installs hoist deps to a parent or
 * root `node_modules` rather than the sub-package's, so a cwd-only read would
 * miss them (GCA review #2071). Mirrors Node's own upward node_modules
 * resolution. On no hit, falls back to `semver.minVersion(declaredRange)` (the
 * floor the caret range implies), tagged `declared-min` so callers render the
 * degraded claim level. Returns undefined only when neither resolves to a
 * valid version.
 */
function resolveInstalledVersion(
  cwd: string,
  packageName: string,
  declaredRange: string,
): ResolvedConsumerVersion | undefined {
  const segments = packageName.split('/');
  let dir = path.resolve(cwd);
  for (;;) {
    const installedPkg = readPackageJson(
      path.join(dir, 'node_modules', ...segments, 'package.json'),
    );
    if (installedPkg?.version !== undefined && semver.valid(installedPkg.version) !== null) {
      return { version: installedPkg.version, source: 'installed' };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }
  // Fallback: the minimum version the declared range admits. `minVersion`
  // returns a SemVer or null; coerce to the bare version string.
  const min = semver.minVersion(declaredRange);
  return min === null ? undefined : { version: min.version, source: 'declared-min' };
}

/** Find the declared range for `packageName` across the three dep fields, in order. */
function findDeclaredRange(pkg: PackageJsonShape, packageName: string): string | undefined {
  for (const field of DEP_FIELDS) {
    // `pkg` is loose untrusted JSON; optional-chain the field read so a missing
    // or non-object dep section yields undefined instead of throwing, then
    // type-check the value itself. Avoids a null-guard idiom that two compiled
    // rules disagree on.
    const range = pkg[field]?.[packageName];
    if (typeof range === 'string' && range.trim().length > 0) return range;
  }
  return undefined;
}

// ─── Manual-attestation detector (mmnto-ai/totem#2073 manual-attestation slice) ──

/**
 * Inputs + test seams for {@link detectManualAttestationContract}. The sub-class
 * discriminant (`package:`) + the canonical source are read DIRECTLY off the
 * `contract` argument (single source of truth) — the context carries only the
 * consumer-local read seams + the reserved attestation date.
 */
export interface DetectManualAttestationContext {
  /** The consumer repo to read `package.json` from (the vendor-SDK pin read). */
  cwd: string;
  /** The current repo's cohort id (from {@link deriveCohortRepoId}) for `consumers` applicability. */
  repoId?: string;
  /**
   * OPTIONAL local attestation date (ISO-8601), sourced from the manifest's
   * `last-attested:` field (strategy#540 shipped the producer; the doctor wires
   * it through per mmnto-ai/totem#2125). When present the message reports it,
   * but the VERDICT stays `info` regardless — staleness is a message
   * refinement, NEVER a status change (manual-attestation never warns).
   */
  attested?: string;
  /**
   * Test seam — override the consumer package.json read. Production callers omit it
   * and the detector reads `<cwd>/package.json`. Invoked ONLY on the vendor-SDK
   * path; the doctrine-row path performs no read at all (a throwing seam proves it).
   *
   * Scope note (Greptile review on mmnto-ai/totem#2080): this seam covers ONLY the
   * top-level consumer package.json read (the declared-range lookup). The
   * installed-version half (`resolveInstalledVersion`) reads the REAL `node_modules`
   * ancestry and, for any VALID range, falls back to `semver.minVersion(range)` — so
   * `"installed: unresolved"` arises solely from an UNPARSEABLE range, never from
   * absent node_modules. A test injecting this seam with a valid range but no on-disk
   * install therefore sees the minVersion fallback BY DESIGN. The boundary is shared
   * verbatim with `detectVersionPinnedContract` (same `resolveInstalledVersion`, same
   * seam scope) — deliberately not widened here to keep the two detectors aligned.
   */
  readPackageJson?: (absPath: string) => PackageJsonShape | undefined;
}

/**
 * Detect "drift" for ONE `manual-attestation` contract — the claim-class with NO
 * mechanical sensor (Tenet 19). The verdict ceiling is **`info` or `skip` ONLY**:
 * the doctor may SURFACE the tracked coupling/doctrine + FLAG staleness, but may
 * NEVER assert drift (`warn`), failure (`fail`), currency (`pass`), or an
 * unprovable-canonical (`unknown`) — there is no canonical to prove against. This
 * is the manifest's "surfaces last-attested + flags staleness only, NEVER fails"
 * contract, claim-class-tighter than the mechanical / version-pinned detectors
 * (which may `warn`). The `info`/`skip` ceiling means the contract can never enter
 * the CLI's `blockingDriftIds`, so it is structurally incapable of failing even
 * under `--strict`.
 *
 * Two sub-classes, discriminated by the contract's `package:`:
 *   - **vendor-SDK coupling** (`packageName` set — `@google/genai`,
 *     `@anthropic-ai/sdk`): reads the consumer's LOCAL pin (declared range +
 *     resolved installed version, reusing the version-pinned machinery) and
 *     surfaces it as `info` — NO cohort floor exists, so NO currency claim is made
 *     (Tenet 16, attest-don't-enforce). The DURABLE manual-attestation case.
 *   - **doctrine row** (`packageName` unset — `governance-doctrine`,
 *     `agent-memory-doctrine`): `canonicalSource` is a cross-repo AGENTS.md the
 *     local-read-only doctor must NOT fetch. Emits a pure `info` doctrine-currency
 *     surface from the contract fields with ZERO on-disk I/O. TRANSIENT — graduates
 *     to version-pinned when doctrine-distribution ships (strategy#511 / #526).
 *
 * NEVER throws (reads degrade to skip), NEVER networks, NEVER reads the cross-repo
 * `canonicalSource`, and NEVER emits `pass`/`warn`/`fail`/`unknown`.
 */
export function detectManualAttestationContract(
  contract: ParityContract,
  ctx: DetectManualAttestationContext,
): ParityContractVerdict {
  // ── Applicability: consumers list (verbatim parity with detectVersionPinnedContract) ──
  if (contract.consumers !== undefined) {
    if (ctx.repoId === undefined) {
      return {
        status: 'skip',
        message: `cannot determine applicability — repo id unresolvable; contract is scoped to consumers [${contract.consumers.join(', ')}]`,
      };
    }
    if (!contract.consumers.includes(ctx.repoId)) {
      return {
        status: 'skip',
        message: `cohort permits absence here (${ctx.repoId} not in consumers)`,
      };
    }
  }

  // The last-attested suffix: the manifest's `last-attested:` date when one was
  // supplied (strategy#540 via mmnto-ai/totem#2125), else the honest "not
  // recorded". NEVER fabricated; a present date refines the MESSAGE, never the
  // status.
  const trimmedAttested = ctx.attested?.trim();
  const attestedSuffix = trimmedAttested
    ? `last attested ${trimmedAttested}`
    : 'last attested: not recorded';

  // The `package:` field is the sub-class discriminant, read directly off the
  // contract (single source of truth). A whitespace-only value is treated as
  // absent (doctrine-like) rather than a degenerate vendor pin (`|| undefined`
  // collapses an empty trim to the doctrine-row branch).
  const pkg = contract.package?.trim() || undefined;

  // ── Doctrine row (no package): a pure info surface, ZERO on-disk I/O ──
  // canonicalSource is cross-repo (mmnto-ai/totem-strategy:AGENTS.md); the
  // local-read-only doctor surfaces it as TEXT and never resolves it.
  if (pkg === undefined) {
    const source = contract.canonicalSource?.trim() || 'no external canonical source';
    return {
      status: 'info',
      message: `doctrine currency tracked — ${contract.dimension} (canonical: ${source}); no local pin mechanism, pending doctrine-distribution (${contract.trackingIssue}). ${attestedSuffix}`,
    };
  }

  // ── Vendor-SDK coupling (package set): surface the consumer's LOCAL pin ──
  // Reuse the version-pinned package.json read, but STOP before any floor compare —
  // there is no agreed cohort floor (Tenet 16), so the doctor asserts NO currency;
  // the verdict is an info visibility surface, never pass/warn.
  const readPkg = ctx.readPackageJson ?? readPackageJson;
  const consumerPkg = readPkg(path.join(ctx.cwd, 'package.json'));
  const declaredRange = consumerPkg ? findDeclaredRange(consumerPkg, pkg) : undefined;

  if (declaredRange === undefined) {
    // Applicable consumer, but the vendor SDK is not declared here. UNLIKE the
    // version-pinned applicable-but-missing case (which becomes a drift `warn` once
    // consumers are verified), a manual-attestation coupling NEVER warns: vendor
    // spread is permitted by design (no cohort floor) → honest-absent skip.
    return {
      status: 'skip',
      message: `${pkg} coupling not present here — cohort permits vendor spread (attest-don't-enforce)`,
    };
  }

  // Resolve the installed version only for a valid range — guard FIRST so a garbage
  // range never reaches semver.minVersion (resolveInstalledVersion's fallback). An
  // unparseable range still surfaces as info (the coupling IS declared), just with
  // installed unresolved — never a throw, never a warn.
  const resolved =
    semver.validRange(declaredRange) !== null
      ? resolveInstalledVersion(ctx.cwd, pkg, declaredRange)
      : undefined;
  // Same verdict-format constraint as the version-pinned path (296 §6(a)3): a
  // minVersion-derived value is a declared-level claim, marked as such.
  const installedText =
    resolved === undefined
      ? 'installed: unresolved'
      : resolved.source === 'installed'
        ? `installed ${resolved.version}`
        : `declared-min ${resolved.version} from range ${declaredRange} (no installed copy resolved)`;

  return {
    status: 'info',
    message: `${pkg} coupling tracked — declared ${declaredRange}, ${installedText}; no cohort floor (Tenet 16, attest only). ${attestedSuffix}`,
  };
}

// ─── Mechanical content-equality detector (mmnto-ai/totem#2073) ──

/**
 * A consumer's hand-added fork/override marker (mmnto-ai/totem#2073 req #7).
 * When present on a managed-block artifact, a content difference reads as an
 * INTENTIONAL, attested fork (`info`) rather than drift (`warn`). Sibling to —
 * NOT merged with — Proposal 292's publisher-generated currency sidecar
 * (strategy-claude 2026-06-04T0158Z: shared `totem:` namespace + `attested`
 * (ISO-8601) / `owner` field conventions, but separate author + lifecycle).
 *
 * Shape: `<!-- totem:fork reason="…" owner="…" attested="YYYY-MM-DD" -->`.
 * Every attribute is optional — a bare `totem:fork` marker still flags a fork.
 */
export interface ForkMarker {
  reason?: string;
  owner?: string;
  /** ISO-8601 date the fork was last attested (as authored; not validated here). */
  attested?: string;
}

/** The marker pair delimiting a managed block within a distributed artifact. */
export interface ManagedBlockMarkers {
  start: string;
  end: string;
}

/** Inputs + test seams for {@link detectMechanicalContract}. */
export interface DetectMechanicalContext {
  /**
   * The canonical managed-block content, ALREADY extracted from the running
   * `@mmnto/cli`'s own template by the CLI (core cannot import init-templates —
   * wrong dependency direction). `undefined`/empty signals the canonical was
   * unresolvable → `unknown` (the Stale-Doctor-Paradox guard).
   */
  canonicalBlock: string | undefined;
  /** Absolute path to the consumer artifact on disk (e.g. `.claude/skills/<n>/SKILL.md`). */
  consumerPath: string;
  /** The marker pair delimiting the managed block in BOTH canonical + consumer. */
  markers: ManagedBlockMarkers;
  /**
   * Running `@mmnto/cli` provenance for the req-#5 self-report. The
   * Stale-Doctor-Paradox includes the doctor ITSELF being a shadowed/stale
   * binary supplying a stale in-process canonical; surfacing which binary
   * computed the verdict keeps the skills verdict honest about its own
   * provenance (a one-line self-report, not a resolver cascade — that's the
   * on-disk hooks case).
   */
  binary?: { version: string; path: string };
  /**
   * Test seam — override the consumer file read. Production callers omit it and
   * the detector reads `<consumerPath>` (UTF-8); a read failure is honest-absent.
   */
  readFile?: (absPath: string) => string | undefined;
}

/**
 * Normalize a managed block for content comparison (req #3): CRLF / lone-CR → LF,
 * strip trailing whitespace per line, and trim leading/trailing blank lines. Two
 * blocks that differ ONLY in line endings or trailing whitespace — the win32
 * checkout false-positive class — normalize equal.
 */
export function normalizeManagedBlock(block: string): string {
  return block
    .replace(/\r\n?/g, '\n') // CRLF + lone CR → LF
    .replace(/[ \t]+$/gm, '') // trailing whitespace per line
    .replace(/^\n+/, '') // leading blank lines
    .replace(/\n+$/, ''); // trailing blank lines
}

/**
 * Extract the content BETWEEN the first `markers.start` and the first following
 * `markers.end`. Returns undefined when either marker is absent (an unmanaged or
 * marker-stripped file). The markers themselves are excluded from the result.
 */
export function extractManagedBlock(
  content: string,
  markers: ManagedBlockMarkers,
): string | undefined {
  const startIdx = content.indexOf(markers.start);
  if (startIdx === -1) return undefined;
  const afterStart = startIdx + markers.start.length;
  const endIdx = content.indexOf(markers.end, afterStart);
  if (endIdx === -1) return undefined;
  return content.slice(afterStart, endIdx);
}

/**
 * Parse a `<!-- totem:fork reason="…" owner="…" attested="…" -->` marker from
 * anywhere in `content`. Whitespace-tolerant (mirrors `REFLEX_VERSION_RE`).
 * Returns undefined when no marker is present; each attribute is independently
 * optional, so a bare `<!-- totem:fork -->` returns an empty marker object
 * (still a fork signal). The attribute patterns are fixed literals (no dynamic
 * RegExp) and linear (no nested quantifiers) — ReDoS-safe.
 */
export function parseForkMarker(content: string): ForkMarker | undefined {
  // `s` (dotAll) so a marker authored across multiple lines still matches; `.*?`
  // stays non-greedy + bounded by the first `-->`, so it remains linear (ReDoS-safe).
  const markerMatch = /<!--\s*totem:fork\b(.*?)-->/is.exec(content);
  if (markerMatch === null) return undefined;
  const attrsText = markerMatch[1] ?? '';
  const marker: ForkMarker = {};
  // Iterate ALL key="value" pairs with matchAll (not a single match() — per the
  // security lesson, one match() lets a safe prefix shadow later pairs); a
  // marker's attributes are unordered + each independently optional.
  for (const pair of attrsText.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) {
    const value = pair[2] ?? '';
    if (pair[1] === 'reason') marker.reason = value;
    else if (pair[1] === 'owner') marker.owner = value;
    else if (pair[1] === 'attested') marker.attested = value;
  }
  return marker;
}

/**
 * Short content hash (sha256, first 12 hex chars) of a normalized block, for the
 * verdict's machine-readable record (req #6). The hash IS the content-equality
 * evidence — bytes, never prose-parsing (req #2's spirit).
 */
export function hashManagedBlock(normalized: string): string {
  return crypto.createHash('sha256').update(normalized, 'utf-8').digest('hex').slice(0, 12);
}

/** Format a fork marker's attested/owner attributes as a message suffix. */
function formatForkMeta(fork: ForkMarker): string {
  // attested/owner are repository content: strip ANSI/control sequences so a
  // hostile marker cannot spoof terminal output (CR round 2, mmnto-ai/totem#2400).
  return (
    (fork.attested !== undefined ? `, attested ${sanitize(fork.attested)}` : '') +
    (fork.owner !== undefined ? `, owner ${sanitize(fork.owner)}` : '')
  );
}

/**
 * Detect drift for ONE mechanical managed-block contract (the #2073 mechanical
 * skills slice). Compares the consumer's installed managed-block against the
 * running `@mmnto/cli`'s own canonical block (passed in by the CLI), normalized
 * for line-endings + trailing whitespace (req #3) and content-hashed (req #6).
 * Honors the verdict-state split (req #1) + the fork marker (req #7):
 *
 *   - `pass`    — normalized blocks equal.
 *   - `warn`    — blocks differ, no fork marker (drift); reports both short hashes.
 *   - `info`    — blocks differ AND a `totem:fork` marker is present (attested fork).
 *   - `unknown` — canonical unresolvable (the doctor may itself be stale/shadowed);
 *                 never self-certify as `pass`.
 *   - `skip`    — consumer artifact not installed (cohort permits absence).
 *
 * NEVER throws (reads degrade), NEVER networks (canonical is in-process), NEVER
 * emits `fail` (the gate edge is a CLI concern, unchanged from PR-1).
 */
export function detectMechanicalContract(ctx: DetectMechanicalContext): ParityContractVerdict {
  const provenance =
    ctx.binary !== undefined
      ? ` (checked by @mmnto/cli@${ctx.binary.version} at ${ctx.binary.path})`
      : '';
  // Append the binary self-report (req #5) by concatenation (not interpolation)
  // so the provenance suffix never reads as a jammed token in a message.
  const tag = (msg: string): string => msg + provenance;

  // ── Canonical unresolvable → unknown (Stale-Doctor-Paradox guard) ──
  // `undefined` = the CLI could not extract the canonical (a build/marker bug);
  // an EMPTY string is a legitimately empty template that must still be COMPARED,
  // not conflated with unresolvable (GCA + Greptile review on the PR). `=== undefined`
  // is a single condition, so there's no boolean `||` for a numeric-default rule to misread.
  if (ctx.canonicalBlock === undefined) {
    return {
      status: 'unknown',
      message: tag(
        'cannot resolve canonical template from the running @mmnto/cli — verdict unprovable',
      ),
      remediation:
        'Reinstall @mmnto/cli (the running binary may be stale or shadowed), then re-run totem doctor --parity.',
    };
  }
  const canonical = ctx.canonicalBlock;

  // ── Read the consumer artifact (absent → skip; cohort permits absence) ──
  const readFile = ctx.readFile ?? readFileText;
  const consumerContent = readFile(ctx.consumerPath);
  if (consumerContent === undefined) {
    return {
      status: 'skip',
      message: `artifact not installed at ${ctx.consumerPath} — cohort permits absence`,
      remediation:
        'Run totem init to install the distributed artifact, or ignore if this repo intentionally omits it.',
    };
  }

  // ── Extract the consumer's managed block ──
  const consumerBlock = extractManagedBlock(consumerContent, ctx.markers);
  if (consumerBlock === undefined) {
    // Markers absent. A fork marker still signals an INTENTIONAL override (a
    // heavy fork can strip the managed-block markers entirely) → `info`; only an
    // unmarked, unmanaged file is drift `warn`.
    const strippedFork = parseForkMarker(consumerContent);
    if (strippedFork !== undefined) {
      return {
        status: 'info',
        message: tag(
          `intentional fork${formatForkMeta(strippedFork)} — managed-block markers absent in ${ctx.consumerPath}`,
        ),
      };
    }
    return {
      status: 'warn',
      message: `managed-block markers absent in ${ctx.consumerPath} — file is unmanaged or marker-stripped`,
      remediation:
        'Re-run totem init to restore the managed block, or add a totem:fork marker if this divergence is intentional.',
    };
  }

  // ── Normalize + compare (req #3) ──
  const canonicalNorm = normalizeManagedBlock(canonical);
  const consumerNorm = normalizeManagedBlock(consumerBlock);

  if (canonicalNorm === consumerNorm) {
    return {
      status: 'pass',
      message: tag(`matches canonical — hash ${hashManagedBlock(consumerNorm)}`),
    };
  }

  // ── Differ: an attested fork is `info`; otherwise drift `warn` (req #7 + #1) ──
  const fork = parseForkMarker(consumerContent);
  if (fork !== undefined) {
    return {
      status: 'info',
      message: tag(
        `intentional fork${formatForkMeta(fork)} — differs from canonical (consumer ${hashManagedBlock(consumerNorm)} vs canonical ${hashManagedBlock(canonicalNorm)})`,
      ),
    };
  }

  return {
    status: 'warn',
    message: tag(
      `drift — consumer ${hashManagedBlock(consumerNorm)} != canonical ${hashManagedBlock(canonicalNorm)}`,
    ),
    remediation:
      'Reconcile the artifact to the canonical (re-run totem init), or add a totem:fork marker if the divergence is intentional.',
  };
}

// ─── Generated-artifact content-equality detector (mmnto-ai/totem#2073 hooks slice) ──

/** Inputs + test seams for {@link detectGeneratedArtifactContract}. */
export interface DetectGeneratedArtifactContext {
  /**
   * The canonical artifact content, REGENERATED by the CLI from the running
   * `@mmnto/cli`'s own generator (e.g. `buildPrePushHook(getFallbackCommand(repo), tier)`)
   * for THIS repo's package-manager + tier — never a frozen string (a pnpm-flavored
   * canonical would false-positive an npm consumer). `undefined` signals the
   * generator could not produce it → `unknown` (the Stale-Doctor-Paradox guard).
   */
  canonicalContent: string | undefined;
  /** Absolute path to the consumer artifact on disk (e.g. `.git/hooks/pre-push`). */
  consumerPath: string;
  /**
   * The totem ownership/presence marker substring (e.g. `[totem] pre-push hook`).
   * Its ABSENCE in a present file means the artifact is a pure user file with no
   * totem content → `skip` (cohort permits absence), NOT drift. This presence
   * semantics is why generated artifacts need their own detector vs the skills
   * managed-block model — there, a markerless file IS stripped-drift.
   */
  ownershipMarker: string;
  /**
   * Optional end marker bracketing the totem-owned region. post-merge / post-checkout
   * carry one; pre-commit / pre-push do not. When present, a totem block APPENDED
   * into a user-modified hook can be isolated for comparison; when absent, an
   * appended block degrades to `unknown` (cannot prove drift — claim-class-tight).
   */
  endMarker?: string;
  /**
   * Running `@mmnto/cli` provenance for the req-#5 self-report (Stale-Doctor-Paradox:
   * a shadowed/stale doctor would regenerate a stale canonical — surface which binary
   * computed the verdict). The full ADR-072 resolver cascade lives in the CLI's
   * canonical-generator resolution; the detector just reports the resolved binary.
   */
  binary?: { version: string; path: string };
  /**
   * Human-facing noun for this artifact class in the absence/drift copy (e.g.
   * `'git hook'`, `'SessionStart hook'`). Defaults to `'artifact'`. Threaded so the
   * detector — now shared across git hooks AND the static SessionStart hooks — never
   * hardcodes one class's terminology (Greptile review on mmnto-ai/totem#2082).
   */
  artifactLabel?: string;
  /**
   * The install/repair command the remediation points at — `'totem hook install'` for
   * git hooks, `'totem init'` for SessionStart hooks. Defaults to `'totem init'` so a
   * SessionStart absence/drift is never told to run the git-hook installer.
   */
  installCommand?: string;
  /** Test seam — override the consumer file read. Production callers omit it. */
  readFile?: (absPath: string) => string | undefined;
}

/**
 * Extract the totem-owned region INCLUSIVE of both markers (start through end), or
 * undefined when either is absent. Isolates an appended totem block embedded in a
 * user-modified hook (post-merge / post-checkout carry an end marker) so the user's
 * surrounding content is excluded from the comparison.
 */
function extractInclusiveRegion(content: string, start: string, end: string): string | undefined {
  const s = content.indexOf(start);
  if (s === -1) return undefined;
  const e = content.indexOf(end, s + start.length);
  if (e === -1) return undefined;
  return content.slice(s, e + end.length);
}

/**
 * Whether a file is a totem-OWNED whole file (generated verbatim by a `build*`
 * template) rather than a totem block APPENDED into a pre-existing user file. Two
 * generated shapes are owned:
 *   - **whole-file marker-at-start** — the ownership marker OPENS the file, so
 *     nothing meaningful precedes it. The JS SessionStart hooks (`// [totem]
 *     auto-generated …` at index 0, no shebang — mmnto-ai/totem#2073 orientation
 *     slice) are this shape.
 *   - **shell shebang + comment** — a shell hook generated as `#!/bin/sh\n#
 *     <marker> …`, so the only content before the marker is the shebang line plus
 *     the start of its comment (the git-hooks slice).
 * An APPENDED block carries the user's prior content before the marker → NOT owned
 * (the detector degrades it to `unknown`, claim-class-tight).
 */
function isOwnedGeneratedFile(content: string, marker: string): boolean {
  const idx = content.indexOf(marker);
  if (idx === -1) return false;
  const before = content.slice(0, idx);
  // Marker opens the file (whole-file JS templates), OR only a shebang + comment-
  // start precedes it (shell hooks). User content before the marker → appended.
  return before.trim().length === 0 || /^#![^\n]*\n#[ \t]*$/.test(before);
}

/**
 * Detect drift for ONE generated-artifact contract (the mmnto-ai/totem#2073 hooks
 * slice) — the git hooks (`pre-commit` / `pre-push` / `post-merge` / `post-checkout`),
 * which the CLI regenerates per-repo via `build*Hook(getFallbackCommand(repo), tier)`
 * so the canonical matches THIS repo's package manager + tier (no frozen-string
 * false-positive). Honors the verdict-state split + the fork marker, and detects
 * STALE-VERSION drift (a hook frozen at an older generator's output differs from
 * today's regenerated canonical → `warn` — the detection half of mmnto-ai/totem#1854):
 *
 *   - `pass`    — the totem-owned content equals the regenerated canonical.
 *   - `warn`    — an owned hook drifted (incl. a stale pre-mmnto-ai/totem#2053 resolve order); reports both hashes.
 *   - `info`    — drift AND a `totem:fork` marker — an attested intentional fork.
 *   - `unknown` — canonical unregenerable, OR a totem block appended inside a user
 *                 hook with no end marker to isolate it (cannot prove drift).
 *   - `skip`    — hook absent, OR present but not totem-managed (cohort permits absence).
 *
 * NEVER throws (reads degrade), NEVER networks (canonical is in-process), NEVER
 * emits `fail` (the gate edge is a CLI concern, unchanged from PR-1).
 */
export function detectGeneratedArtifactContract(
  ctx: DetectGeneratedArtifactContext,
): ParityContractVerdict {
  const provenance =
    ctx.binary !== undefined
      ? ` (checked by @mmnto/cli@${ctx.binary.version} at ${ctx.binary.path})`
      : '';
  // Append the binary self-report (req #5) by concatenation (not interpolation) so
  // the provenance suffix never reads as a jammed token in a message.
  const tag = (msg: string): string => msg + provenance;

  // Artifact-class copy (Greptile review on mmnto-ai/totem#2082): this detector serves
  // both git hooks and the static SessionStart hooks, so the noun + install command are
  // threaded in rather than hardcoded. Defaults keep standalone callers SessionStart-safe
  // (never "run totem hook install" for a non-git artifact).
  const label = ctx.artifactLabel ?? 'artifact';
  const install = ctx.installCommand ?? 'totem init';

  // ── Canonical unresolvable → unknown (Stale-Doctor-Paradox guard) ──
  if (ctx.canonicalContent === undefined) {
    return {
      status: 'unknown',
      message: tag(
        `cannot resolve canonical ${label} from the running @mmnto/cli — verdict unprovable`,
      ),
      remediation:
        'Reinstall @mmnto/cli (the running binary may be stale or shadowed), then re-run totem doctor --parity.',
    };
  }
  const canonical = ctx.canonicalContent;

  // ── Read the consumer artifact (absent → skip; cohort permits absence) ──
  const readFile = ctx.readFile ?? readFileText;
  const consumerContent = readFile(ctx.consumerPath);
  if (consumerContent === undefined) {
    return {
      status: 'skip',
      message: `${label} not installed at ${ctx.consumerPath} — cohort permits absence`,
      remediation: `Run ${install} to install the managed ${label}, or ignore if this repo intentionally omits it.`,
    };
  }

  // ── Presence semantics: a present hook with no totem marker is a pure user hook ──
  // (NOT drift — totem simply is not installed here). Distinct from the skills model,
  // where a markerless file is a marker-stripped managed artifact.
  if (!consumerContent.includes(ctx.ownershipMarker)) {
    return {
      status: 'skip',
      message: `${ctx.consumerPath} present but not totem-managed — cohort permits absence`,
    };
  }

  // ── Clean owned-whole-file match (the common cohort case) ──
  const canonicalNorm = normalizeManagedBlock(canonical);
  if (normalizeManagedBlock(consumerContent) === canonicalNorm) {
    return {
      status: 'pass',
      message: tag(`matches canonical — hash ${hashManagedBlock(canonicalNorm)}`),
    };
  }

  // ── Differ. An attested fork is always `info` (req #7); never `warn`/`unknown`. ──
  const fork = parseForkMarker(consumerContent);

  // ── post-merge / post-checkout carry an end marker → isolate the totem region so a
  // user's surrounding content does not read as drift, and a drifted region does. ──
  if (ctx.endMarker !== undefined) {
    const canonicalRegion = extractInclusiveRegion(canonical, ctx.ownershipMarker, ctx.endMarker);
    // The regenerated canonical must contain its own end-marked region. If it does not
    // (a generator/marker misconfig, or a truncated canonical), the region comparison is
    // unprovable → unknown — mirroring the canonicalContent === undefined guard above,
    // never a fall-through that could emit a false `warn` (Greptile review on mmnto-ai/totem#2079).
    if (canonicalRegion === undefined) {
      return {
        status: 'unknown',
        message: tag(
          `cannot resolve the canonical ${label} region (end marker absent in the regenerated template) — verdict unprovable`,
        ),
        remediation:
          'Reinstall @mmnto/cli (the running binary may be stale or shadowed), then re-run totem doctor --parity.',
      };
    }
    const consumerRegion = extractInclusiveRegion(
      consumerContent,
      ctx.ownershipMarker,
      ctx.endMarker,
    );
    if (consumerRegion !== undefined) {
      const consumerRegionNorm = normalizeManagedBlock(consumerRegion);
      const canonicalRegionNorm = normalizeManagedBlock(canonicalRegion);
      if (consumerRegionNorm === canonicalRegionNorm) {
        // The totem-owned region is current; the whole-file diff is the user's own
        // surrounding content — totem is not drifted.
        return {
          status: 'pass',
          message: tag(`totem block current — hash ${hashManagedBlock(consumerRegionNorm)}`),
        };
      }
      // Scope the fork attestation to the ISOLATED totem region — a totem:fork marker in
      // the user's OWN surrounding shell must not suppress genuine totem-block drift
      // (Greptile review on mmnto-ai/totem#2079).
      const regionFork = parseForkMarker(consumerRegion);
      if (regionFork !== undefined) {
        return {
          status: 'info',
          message: tag(
            `intentional fork${formatForkMeta(regionFork)} — totem block differs in ${ctx.consumerPath}`,
          ),
        };
      }
      return {
        status: 'warn',
        message: tag(
          `drift — totem block ${hashManagedBlock(consumerRegionNorm)} != canonical ${hashManagedBlock(canonicalRegionNorm)}`,
        ),
        remediation: `Re-run ${install} to regenerate the managed block, or add a totem:fork marker if the divergence is intentional.`,
      };
    }
    // Consumer has the start marker but not the end (truncated / stripped) → fall through
    // to the ownership heuristic below (owned → drift warn; appended → unknown).
  }

  // ── No end marker (pre-commit / pre-push), or the region could not be bracketed. ──
  if (isOwnedGeneratedFile(consumerContent, ctx.ownershipMarker)) {
    // Owned whole-file that drifted (e.g. a stale pre-mmnto-ai/totem#2053 resolve order).
    const consumerNorm = normalizeManagedBlock(consumerContent);
    if (fork !== undefined) {
      return {
        status: 'info',
        message: tag(
          `intentional fork${formatForkMeta(fork)} — differs from canonical (consumer ${hashManagedBlock(consumerNorm)} vs canonical ${hashManagedBlock(canonicalNorm)})`,
        ),
      };
    }
    return {
      status: 'warn',
      message: tag(
        `drift — consumer ${hashManagedBlock(consumerNorm)} != canonical ${hashManagedBlock(canonicalNorm)}`,
      ),
      remediation: `Re-run ${install} to regenerate the ${label} from the current @mmnto/cli, or add a totem:fork marker if the divergence is intentional.`,
    };
  }

  // ── Totem block appended inside a user-modified artifact with no end marker to ──
  // isolate it: can prove neither drift nor currency → unknown (claim-class-tight).
  if (fork !== undefined) {
    return {
      status: 'info',
      message: tag(
        `intentional fork${formatForkMeta(fork)} — totem block embedded in a user-modified ${label} (${ctx.consumerPath})`,
      ),
    };
  }
  return {
    status: 'unknown',
    message: tag(
      `totem block embedded in a user-modified ${label} at ${ctx.consumerPath} — cannot isolate it for comparison`,
    ),
    remediation: `Re-run ${install} to restore the managed ${label}, or remove the local edits before the totem marker so it can be verified independently.`,
  };
}

// ─── Capability-probe detector (mmnto-ai/totem#2140, 296 §6(a)2 probe rung) ──

/**
 * The probe sub-kinds this slice ships (the two deliverable-1 rows):
 *   - `mcp-registration` — does `.mcp.json` register a totem MCP server? The
 *     PRESENT rung of `knowledge-search-access` ("a working query path exists
 *     from this agent surface"). The usable rung (a live bounded search exec)
 *     is deliberately NOT shipped: real `totem search` embeds the query via a
 *     cloud API, which a §12.5 never-network probe cannot run — flagged to
 *     strategy with the row-downshift question.
 *   - `settings-floor` — does `.claude/settings.json` suppress the governance
 *     floor (`claude-settings-minimum-capability`)? Canonical-at-intent-altitude
 *     (296 §6(c)): the canonical is a minimum-capability CONTRACT, so the probe
 *     senses explicit SUPPRESSION only — an absent file (or any unrelated
 *     content) is `pass`; the doctor never prescribes settings content.
 */
export type CapabilityProbeKind = 'mcp-registration' | 'settings-floor';

/** Inputs + test seams for {@link detectCapabilityProbeContract}. */
export interface DetectCapabilityProbeContext {
  kind: CapabilityProbeKind;
  /** Absolute path of the probed file (`.mcp.json` / `.claude/settings.json`). */
  consumerPath: string;
  /**
   * `settings-floor` only: absolute path to `.mcp.json`, read to DERIVE the
   * totem MCP server names cross-checked against `disabledMcpjsonServers`
   * (derive-not-hardcode, Tenet 20). Absent/unreadable → nothing to cross-check
   * (the MCP half of the floor is vacuous; the hooks half still applies).
   */
  mcpJsonPath?: string;
  /** The state-level THIS probe proves by design (`present` for both kinds today). */
  probedLevel: ParitySense;
  /**
   * The row's declared `senses:` (open string off the contract). When it names
   * a RECOGNIZED level stronger than `probedLevel`, a would-be `pass` is capped
   * at `unknown` — the green-halo invariant at probe altitude: a presence-PASS
   * must never render as a capability-PASS (296 §6(a)3 / strategy#591).
   */
  declaredSenses?: string;
  /** Test seam — override the file read. Production callers omit it. */
  readFile?: (absPath: string) => string | undefined;
}

/** Rank a senses level on the §6(a)3 scale; -1 for unrecognized values. */
function senseRank(level: string | undefined): number {
  return level === undefined ? -1 : PARITY_SENSES.indexOf(level as ParitySense);
}

/** JSON file read that NEVER throws: absent / unparseable are first-class outcomes. */
type JsonReadResult =
  | { status: 'absent' }
  | { status: 'unparseable' }
  | { status: 'ok'; value: unknown };

function readJsonResult(
  readFile: (absPath: string) => string | undefined,
  absPath: string,
): JsonReadResult {
  let raw: string | undefined;
  try {
    raw = readFile(absPath);
    // totem-context: a throwing injected reader is the probe's degraded-read signal (the never-throws contract); treated as absent rather than crashing the doctor pipeline.
  } catch {
    raw = undefined;
  }
  if (raw === undefined) return { status: 'absent' };
  try {
    return { status: 'ok', value: JSON.parse(raw) };
    // totem-context: malformed JSON is a first-class `unparseable` outcome the probe maps to an honest `unknown` — never a throw.
  } catch {
    return { status: 'unparseable' };
  }
}

/**
 * Derive the totem MCP server names registered in a parsed `.mcp.json` doc.
 * Derivation, not a hardcoded name list, so renamed or per-repo servers still
 * match (Tenet 20) — but the signals are deliberately BOUNDED (GCA + Greptile
 * round on the PR): a bare `totem` substring anywhere in a command/arg path
 * would false-positive on unrelated servers under totem-named directories
 * (`/home/totem-projects/other-mcp/run.sh`), and in the settings-floor probe a
 * false positive becomes a spurious governance-floor WARN. An entry counts when:
 *   - its NAME contains `totem`, or
 *   - its command BASENAME is the totem binary, or
 *   - an arg references the `@mmnto` package scope.
 */
function totemServerNames(doc: unknown): string[] {
  if (typeof doc !== 'object' || doc === null) return [];
  const servers = (doc as { mcpServers?: unknown }).mcpServers;
  // Array.isArray guard: a malformed array still satisfies `typeof === 'object'`,
  // and Object.entries over it would derive index-keyed "names" (GCA review).
  if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) return [];
  const names: string[] = [];
  for (const [name, config] of Object.entries(servers as Record<string, unknown>)) {
    if (isTotemServer(name, config)) names.push(name);
  }
  return names;
}

/** The bounded totem-server signals for one `.mcp.json` entry (see {@link totemServerNames}). */
function isTotemServer(name: string, config: unknown): boolean {
  if (name.toLowerCase().includes('totem')) return true;
  if (typeof config !== 'object' || config === null) return false;
  const command = (config as { command?: unknown }).command;
  if (typeof command === 'string') {
    // Basename only, extension-tolerant — the command must BE the totem binary,
    // not merely live under a totem-named path (the Greptile P2 class).
    const base = path.basename(command.trim()).toLowerCase();
    if (base === 'totem' || base === 'totem.exe' || base === 'totem.cmd') return true;
  }
  const args = (config as { args?: unknown }).args;
  return Array.isArray(args) && args.some((a) => typeof a === 'string' && a.includes('@mmnto'));
}

/**
 * Apply the green-halo cap to a would-be `pass`: when the row DECLARES a
 * recognized senses level stronger than what this probe proved, the verdict is
 * `unknown` (the declared contract is unprovable by this probe), never `pass`.
 * Failure verdicts are NOT capped — a failed weaker rung disproves the stronger
 * one (no registration ⇒ certainly not usable).
 */
function passAtProbedLevel(
  ctx: DetectCapabilityProbeContext,
  confirmation: string,
): ParityContractVerdict {
  const probed = senseRank(ctx.probedLevel);
  const declared = senseRank(ctx.declaredSenses);
  if (declared !== -1 && probed !== -1 && probed < declared) {
    return {
      status: 'unknown',
      message: `manifest declares senses: ${ctx.declaredSenses}; this probe proves ${ctx.probedLevel} only — ${confirmation}; ${ctx.declaredSenses} is unprovable by a no-network probe (296 §12.5)`,
    };
  }
  return {
    status: 'pass',
    message: `probed level: ${ctx.probedLevel} — ${confirmation}`,
  };
}

/**
 * Detect ONE capability-probe contract (`manifestation: capability-probe`,
 * 296 §6(a)2). Deterministic, local-read-only, NEVER networks, NEVER throws,
 * and NEVER emits `fail` (CLI edge owns promotion) or `info` (probes decide,
 * they do not attest — "sense-only" means no actuator, not an info ceiling;
 * the 296 §6(a)4 settled vocabulary is pass/warn/skip/unknown).
 */
export function detectCapabilityProbeContract(
  ctx: DetectCapabilityProbeContext,
): ParityContractVerdict {
  const readFile = ctx.readFile ?? readFileText;

  if (ctx.kind === 'mcp-registration') {
    const probe = readJsonResult(readFile, ctx.consumerPath);
    if (probe.status === 'absent') {
      return {
        status: 'warn',
        message: `no .mcp.json at ${ctx.consumerPath} — no registered query path on this agent surface`,
        remediation:
          'Register the totem MCP server in .mcp.json (totem init scaffolds it), or use `pnpm exec totem search` as the non-MCP transport.',
      };
    }
    if (probe.status === 'unparseable') {
      return {
        status: 'unknown',
        message: `${ctx.consumerPath} is unparseable JSON — registration unprovable either way`,
        remediation: 'Fix the .mcp.json syntax, then re-run totem doctor --parity.',
      };
    }
    const names = totemServerNames(probe.value);
    if (names.length === 0) {
      return {
        status: 'warn',
        message: `.mcp.json registers no totem MCP server — no registered query path on this agent surface`,
        remediation:
          'Register the totem MCP server in .mcp.json (totem init scaffolds it), or use `pnpm exec totem search` as the non-MCP transport.',
      };
    }
    return passAtProbedLevel(
      ctx,
      `totem MCP server(s) [${names.join(', ')}] registered in .mcp.json`,
    );
  }

  // ── settings-floor ──
  const probe = readJsonResult(readFile, ctx.consumerPath);
  if (probe.status === 'absent') {
    // The floor is "not suppressed", never "explicitly configured" — an absent
    // settings file suppresses nothing (canonical-at-intent-altitude, 296 §6(c)).
    return passAtProbedLevel(
      ctx,
      `no ${path.basename(ctx.consumerPath)} present; governance floor not suppressed (absent = unsuppressed)`,
    );
  }
  if (probe.status === 'unparseable') {
    return {
      status: 'unknown',
      message: `${ctx.consumerPath} is unparseable JSON — the governance floor is unprovable either way`,
      remediation: 'Fix the settings JSON syntax, then re-run totem doctor --parity.',
    };
  }
  // Array guard mirrors totemServerNames (GCA round 3): an array settings doc
  // is shape-invalid, cannot express suppression, and must not be walked as a
  // key-value object — it degrades to the empty (suppresses-nothing) shape.
  const settings =
    typeof probe.value === 'object' && probe.value !== null && !Array.isArray(probe.value)
      ? (probe.value as Record<string, unknown>)
      : {};

  if (settings['disableAllHooks'] === true) {
    return {
      status: 'warn',
      message: `governance floor suppressed — disableAllHooks: true in ${ctx.consumerPath} (SessionStart orientation cannot fire)`,
      remediation:
        'Remove disableAllHooks (or scope the suppression below the governance hooks) to restore the minimum-capability floor.',
    };
  }

  const disabledRaw = settings['disabledMcpjsonServers'];
  const disabled = Array.isArray(disabledRaw)
    ? disabledRaw.filter((v): v is string => typeof v === 'string')
    : [];
  if (disabled.length > 0 && ctx.mcpJsonPath !== undefined) {
    const mcpProbe = readJsonResult(readFile, ctx.mcpJsonPath);
    const totemNames = mcpProbe.status === 'ok' ? totemServerNames(mcpProbe.value) : [];
    const suppressed = totemNames.filter((n) => disabled.includes(n));
    if (suppressed.length > 0) {
      return {
        status: 'warn',
        message: `governance floor suppressed — totem MCP server(s) [${suppressed.join(', ')}] listed in disabledMcpjsonServers in ${ctx.consumerPath}`,
        remediation:
          'Remove the totem MCP server(s) from disabledMcpjsonServers to restore the minimum-capability floor.',
      };
    }
  }

  return passAtProbedLevel(
    ctx,
    `governance floor not suppressed in ${path.basename(ctx.consumerPath)}`,
  );
}

// ─── Declared-contract detector (Prop 305 §3 agent-bus) ──

/**
 * A parsed `<!-- totem:<token> role="…" seat="…" declared="…" -->` declaration
 * marker (Prop 305 §3 agent-bus class). Every attribute is independently
 * optional at PARSE time; the VALIDITY rule (a real declaration binds BOTH a
 * role and a seat) lives in {@link detectDeclaredContract} so a missing
 * attribute surfaces as a NAMED why-not, never a silent drop (fail loud, Tenet 4).
 */
export interface DeclarationMarker {
  role?: string;
  seat?: string;
  /** ISO-8601 date the declaration was authored (as authored; not validated here). */
  declared?: string;
}

/**
 * Parse a `<!-- totem:<token> key="value" … -->` declaration marker from
 * anywhere in `content`. Modeled on {@link parseForkMarker}: dotAll + whitespace
 * tolerant, `.*?` non-greedy + bounded by the first `-->` (linear, no nested
 * quantifiers → ReDoS-safe). `token` is the full bare marker name (e.g.
 * `totem:agent-bus`) and is regex-escaped via the shared `escapeRegex`, so a
 * `:` or any metachar is matched as a literal, never as a live pattern (the
 * token is code-owned by the CLI registry, but escaping keeps it robust
 * regardless). The FIRST marker for `token` wins — duplicates are ignored, the
 * same single-match posture as {@link parseForkMarker}. The token must be
 * followed by whitespace or `-->` (a lookahead, not `\b`), so a token never
 * prefix-matches a longer sibling (`totem:agent-bus` vs `totem:agent-bus-v2`)
 * and non-word-char-ending tokens need no special casing. Returns undefined
 * when no marker for `token` is present.
 */
export function parseDeclarationMarker(
  content: string,
  token: string,
): DeclarationMarker | undefined {
  const markerRe = new RegExp(`<!--\\s*${escapeRegex(token)}(?=\\s|-->)(.*?)-->`, 'is');
  const markerMatch = markerRe.exec(content);
  if (markerMatch === null) return undefined;
  const attrsText = markerMatch[1] ?? '';
  const marker: DeclarationMarker = {};
  // matchAll (not a single match()) so a safe prefix pair cannot shadow later
  // pairs — the security lesson parseForkMarker documents; attributes are
  // unordered + each independently optional.
  for (const pair of attrsText.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) {
    const value = pair[2] ?? '';
    if (pair[1] === 'role') marker.role = value;
    else if (pair[1] === 'seat') marker.seat = value;
    else if (pair[1] === 'declared') marker.declared = value;
  }
  return marker;
}

/** Inputs + test seams for {@link detectDeclaredContract}. */
export interface DetectDeclaredContext {
  /** Absolute path of the file that carries the declaration marker (AGENTS.md). */
  filePath: string;
  /** The bare `totem:<token>` marker name the declaration is authored under (e.g. `totem:agent-bus`). */
  markerToken: string;
  /** Test seam — override the file read. Production callers omit it. */
  readFile?: (absPath: string) => string | undefined;
}

/**
 * Detect ONE `manifestation: declared` contract (Prop 305 §3 agent-bus class).
 * A declaration SURFACE — the repo AUTHORS the binding itself in a file
 * (AGENTS.md) via a `<!-- totem:<token> role="…" seat="…" -->` HTML-comment
 * marker rather than installing a managed block. This sensor claims DECLARATION
 * PRESENCE ONLY; whether the declared bus actually EXECUTES its duties is
 * adherence-class (Tenet 19 / Prop 305 §3.5) and is NEVER inferred from this row.
 *
 * Deterministic, local-read-only, NEVER networks, NEVER throws, NEVER emits
 * `fail` (CLI edge owns promotion), and NEVER `warn`/`fail` on absence — an
 * undeclared repo is honest-absent (`skip`), the row's own "honest-absent until
 * a repo declares" semantics, not drift.
 *
 *   - `pass` — marker present with BOTH role + seat parsed (a well-formed binding).
 *   - `skip` — file absent, marker absent, or the marker is missing role/seat
 *              (the why-not names the missing attribute — fail loud, Tenet 4).
 */
export function detectDeclaredContract(ctx: DetectDeclaredContext): ParityContractVerdict {
  const readFile = ctx.readFile ?? readFileText;
  const fileLabel = path.basename(ctx.filePath);
  // The human declaration name is the marker token minus the `totem:` namespace
  // (e.g. `totem:agent-bus` → `agent-bus`), so the message reads as the contract.
  const declarationName = ctx.markerToken.startsWith('totem:')
    ? ctx.markerToken.slice('totem:'.length)
    : ctx.markerToken;

  // File absent / unreadable → honest-absent (NEVER warn on absence).
  let content: string | undefined;
  try {
    content = readFile(ctx.filePath);
    // totem-context: the default readFileText already degrades a missing / unreadable file to undefined; wrapping the call treats a throwing INJECTED reader as the same honest-absent signal, so a degraded read can NEVER crash the doctor pipeline (the never-throws invariant, mirroring readJsonResult).
  } catch {
    content = undefined;
  }
  if (content === undefined) {
    return {
      status: 'skip',
      message: `${declarationName}: no ${fileLabel} present — honest-absent until a repo declares`,
    };
  }

  const marker = parseDeclarationMarker(content, ctx.markerToken);
  if (marker === undefined) {
    return {
      status: 'skip',
      message: `${declarationName}: no ${ctx.markerToken} declaration marker in ${fileLabel} — honest-absent until a repo declares`,
    };
  }

  // A marker missing role OR seat is NOT a valid declaration: name the missing
  // attribute (fail loud, Tenet 4) but stay honest-absent (`skip`) — a malformed
  // marker is still "not yet declared", never drift. Blank counts as missing:
  // role="" / seat="  " would mint a degenerate binding with no real referent
  // (greptile P2 on mmnto-ai/totem#2400).
  const { role, seat } = marker;
  const missing: string[] = [];
  if (role === undefined || role.trim().length === 0) missing.push('role');
  if (seat === undefined || seat.trim().length === 0) missing.push('seat');
  if (
    role === undefined ||
    role.trim().length === 0 ||
    seat === undefined ||
    seat.trim().length === 0
  ) {
    return {
      status: 'skip',
      message: `${declarationName}: ${ctx.markerToken} marker in ${fileLabel} is missing ${missing.join(
        ' + ',
      )} — not a valid declaration (honest-absent until a repo declares)`,
    };
  }

  // Presence claim ONLY — the declaration is present + well-formed. This is NOT a
  // claim that the bus executes its duties (adherence-class, Tenet 19 / §3.5).
  // role/seat are repository content: strip ANSI/control sequences so a
  // hostile marker cannot spoof terminal output (CR round 2, mmnto-ai/totem#2400).
  return {
    status: 'pass',
    message: `${declarationName} declared — role "${sanitize(role)}" → seat "${sanitize(seat)}" in ${fileLabel}`,
  };
}

// ─── Value-equality detector (mmnto-ai/totem-strategy#738 Slice A, Proposal 296 §13) ──

/**
 * The parse mode for a value-equality field's on-disk config file. Declared per
 * row in the CLI registry (`valueEqualityFieldsFor`) — derive-not-guess, so an
 * unrecognized format yields `unknown`, never a silent mis-parse.
 */
export type ValueEqualityFormat = 'yaml' | 'json';

/**
 * One value-equality field spec, resolved by the CLI registry from a contract id.
 * The EXPECTED value is deliberately NOT carried here — it is read from the
 * contract's own `expectedValueOrDerivation` (strategy#738 Q1: the manifest field
 * is the canonical, derived LOCALLY per Tenet 6). The registry supplies only WHERE
 * to look, never WHAT to expect (no second source of truth).
 */
export interface ValueEqualityField {
  /** Absolute path to the consumer config file (e.g. `<root>/.coderabbit.yaml`). */
  consumerPath: string;
  /**
   * The dotted config path as discrete SEGMENTS (`['reviews', 'profile']`), NOT a
   * pre-split string — a literal key containing a `.` would be mis-split otherwise
   * (totem-codex panel, strategy#738). The CLI registry owns the segments.
   */
  pathSegments: string[];
  /** Parse mode for {@link consumerPath}. */
  format: ValueEqualityFormat;
  /** Display name for the verdict line. */
  lineName: string;
}

/** Inputs + test seams for {@link detectValueEqualityContract}. */
export interface DetectValueEqualityContext {
  /** Current repo's cohort id for `consumers` applicability (verbatim parity with the other detectors). */
  repoId?: string;
  /** The field spec (file + path + format) the CLI registry resolved for this contract. */
  field: ValueEqualityField;
  /** Test seam — override the consumer file read. Production callers omit it. */
  readFile?: (absPath: string) => string | undefined;
}

/**
 * The typed expected scalar a value-equality row asserts. Only the exact tokens
 * `true` / `false` become booleans; every other token stays a string (exact,
 * case-sensitive). Numeric / set-semantic comparison is explicitly OUT of Slice A
 * — it would be a registry-declared expected-kind, never global coercion (the
 * `false` vs `"false"`, `0` vs `"0"`, `null` vs `"null"` over-claim class the
 * totem-codex panel flagged against a blanket `String(value)` compare).
 */
type ExpectedScalar = boolean | string;

/** Parse the manifest's `expected-value-or-derivation` token into a typed scalar. */
function parseExpectedScalar(rawTrimmed: string): ExpectedScalar {
  if (rawTrimmed === 'true') return true;
  if (rawTrimmed === 'false') return false;
  return rawTrimmed;
}

/**
 * Navigate discrete path segments through a parsed YAML/JSON document. Returns
 * `found: false` when any segment is absent OR when traversal hits a non-object
 * (array / scalar / null) before consuming every segment — both are "the field is
 * not declared at this path" (a drift `warn` per the totem-codex panel), distinct
 * from a present-but-mismatched value. Uses `hasOwnProperty` so an inherited
 * prototype key (e.g. `constructor`) can't masquerade as a declared field.
 */
function navigateConfigPath(
  root: unknown,
  segments: string[],
): { found: true; value: unknown } | { found: false } {
  let cursor: unknown = root;
  for (const segment of segments) {
    if (typeof cursor !== 'object' || cursor === null || Array.isArray(cursor)) {
      return { found: false };
    }
    if (!Object.prototype.hasOwnProperty.call(cursor, segment)) {
      return { found: false };
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return { found: true, value: cursor };
}

/** CRLF/lone-CR → LF + trim — the CRLF-insensitive normalize applied to BOTH compare sides. */
function normalizeScalarString(s: string): string {
  return s.replace(/\r\n?/g, '\n').trim();
}

/**
 * Whether a parsed on-disk value equals the typed expected scalar. Boolean
 * expected ⟹ the actual must be a boolean and strictly equal (YAML `false` the
 * bool matches; the STRING `"false"` does NOT — value-equality must not launder
 * an ambiguous string into a boolean config claim). String expected ⟹ the actual
 * must be a string and exactly equal after a CRLF/trim normalize applied to BOTH
 * sides — symmetric so the compare is genuinely CRLF-insensitive (win32-checkout
 * safe). The YAML parser already LF-normalizes scalar content (spec §5.4) and the
 * manifest value is single-line, so normalizing `expected` is belt-and-suspenders,
 * but symmetry removes the half-normalized smell (GCA review on #2249).
 */
function valueMatchesExpected(actual: unknown, expected: ExpectedScalar): boolean {
  if (typeof expected === 'boolean') return actual === expected;
  return (
    typeof actual === 'string' && normalizeScalarString(actual) === normalizeScalarString(expected)
  );
}

/** Render a parsed value for a verdict message (strings quoted; bool/number/null inline; else JSON). */
function renderConfigValue(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean' || typeof value === 'number' || value === null) {
    return String(value);
  }
  try {
    // `JSON.stringify` returns `undefined` (not a string) for undefined / function /
    // symbol inputs — none arise from parsed YAML/JSON at today's call sites, but the
    // helper takes `unknown`, so coalesce to keep the `: string` contract total (GCA
    // review on #2249). `??` not `||` (a valid "" / "0" render must survive).
    return JSON.stringify(value) ?? String(value);
    // totem-context: a value that can't be JSON-stringified (a cycle is impossible from a freshly parsed YAML/JSON doc, but be defensive) degrades to String() for the message only — rendering must never throw inside a verdict.
  } catch {
    return String(value);
  }
}

/**
 * Detect drift for ONE `manifestation: value-equality` contract (strategy#738
 * Slice A, the Proposal 296 §13 promotion of the bot-review-config rows up from
 * `attestation`). Reads a scalar at a dotted path in the consumer's on-disk
 * config file and compares it — typed, never blanket-stringified — against the
 * row's own `expectedValueOrDerivation` (the canonical, read LOCALLY; NEVER
 * networks). Honors the verdict-state split + the honest-absent taxonomy the
 * cohort panel settled (strategy#738):
 *
 *   - `pass`    — the path resolves and the value equals the expected scalar.
 *   - `warn`    — present-but-mismatched, OR the path is absent on a present file
 *                 (incl. traversal through a non-object): applicable drift.
 *   - `unknown` — the file is present but unparseable: equality is unprovable
 *                 either way (value-equality is NOT a config-validity detector).
 *   - `skip`    — not-a-consumer / repo-id-unresolvable-under-scope / the file is
 *                 wholly absent (applicable-but-missing scaffold hedge, mirroring
 *                 detectVersionPinnedContract — flips to a drift `warn` once the
 *                 consumers lists are verified) / no expected declared.
 *
 * NEVER emits `fail` (the CLI edge owns `--strict` promotion). NEVER throws
 * (reads/parses degrade to skip/unknown). NEVER networks. Claim-class bound: a
 * `pass` asserts ONLY "this dotted path holds this scalar" — never that the bot
 * is on-demand, that the vendor loads it, or that the surface is enforced (those
 * are loaded/usable claims outside Slice A).
 */
export function detectValueEqualityContract(
  contract: ParityContract,
  ctx: DetectValueEqualityContext,
): ParityContractVerdict {
  // ── Applicability: consumers scope (verbatim parity with detectVersionPinnedContract) ──
  if (contract.consumers !== undefined) {
    if (ctx.repoId === undefined) {
      return {
        status: 'skip',
        message: `cannot determine applicability — repo id unresolvable; contract is scoped to consumers [${contract.consumers.join(', ')}]`,
      };
    }
    if (!contract.consumers.includes(ctx.repoId)) {
      return {
        status: 'skip',
        message: `cohort permits absence here (${ctx.repoId} not in consumers)`,
      };
    }
  }

  const { field } = ctx;
  const fileLabel = path.basename(field.consumerPath);
  const pathLabel = field.pathSegments.join('.');

  // ── Expected scalar from the manifest's own field (strategy#738 Q1; zero-network) ──
  const rawExpected = contract.expectedValueOrDerivation.trim();
  if (rawExpected.length === 0) {
    return {
      status: 'skip',
      message: `${contract.id}: no expected value declared (expected-value-or-derivation is empty)`,
    };
  }
  const expected = parseExpectedScalar(rawExpected);

  // ── Read the consumer config file ──
  // Wholly-absent is the applicable-but-missing case: held as a scaffold skip
  // (mirroring detectVersionPinnedContract) — these rows carry no `consumers`, so
  // it flips to a drift `warn` once the cohort's per-repo applicability is
  // verified. Kept DISTINCT from the not-a-consumer skip above.
  const readFile = ctx.readFile ?? readFileText;
  const raw = readFile(field.consumerPath);
  if (raw === undefined) {
    return {
      status: 'skip',
      message: `${fileLabel} not present — applicable-but-missing (scaffold: skip; becomes a drift warn once consumers are verified)`,
      remediation: `Add ${pathLabel}: ${rawExpected} to ${fileLabel}, or scope this contract's consumers to exclude repos that legitimately omit ${fileLabel}.`,
    };
  }

  // ── Guard the format up front (public-core-surface contract) ──
  // This detector is exported, so a JS caller (no compile-time check) or a future
  // registry typo can pass an unsupported format. Enforce the docblock's
  // unknown-not-mis-parse contract HERE rather than letting a non-`json` value
  // fall through to the YAML parser (a silent mis-parse that could mint a false
  // pass/warn) — and it keeps the unparseable label off a maybe-non-string value
  // (CodeRabbit review on #2249).
  if (field.format !== 'json' && field.format !== 'yaml') {
    return {
      status: 'unknown',
      message: `${fileLabel}: unsupported value-equality format '${String(field.format)}' — value-equality for ${pathLabel} is unprovable`,
      remediation: `Declare a supported format (yaml | json) for ${pathLabel} in the value-equality registry.`,
    };
  }

  // ── Parse (unparseable → unknown; do NOT smuggle in a config-validity detector) ──
  let doc: unknown;
  try {
    doc = field.format === 'json' ? JSON.parse(raw) : parseYaml(raw);
    // totem-context: a malformed consumer config degrades to an honest `unknown` (equality unprovable either way) — never a throw that would sink the doctor pipeline, and never a `warn`/`pass` that would over-claim on unparseable bytes.
  } catch (err) {
    // Surface the parser's OWN first line (split on \n only — a YAML/JSON error can
    // carry a `.`-laden path) so a syntax issue is locatable (GCA review on #2249).
    const detail = err instanceof Error ? `: ${err.message.split('\n')[0]}` : '';
    return {
      status: 'unknown',
      message: `${fileLabel} is unparseable ${field.format === 'json' ? 'JSON' : 'YAML'}${detail} — value-equality for ${pathLabel} is unprovable either way`,
      remediation: `Fix the ${fileLabel} syntax, then re-run totem doctor --parity.`,
    };
  }

  // ── Navigate the dotted path (absent / through-non-object → drift warn) ──
  const nav = navigateConfigPath(doc, field.pathSegments);
  if (!nav.found) {
    return {
      status: 'warn',
      message: `${pathLabel} not declared in ${fileLabel} — expected ${rawExpected}`,
      remediation: `Set ${pathLabel}: ${rawExpected} in ${fileLabel}, or update the contract if the cohort canonical changed.`,
    };
  }

  // ── Compare (typed; never blanket String()) ──
  if (valueMatchesExpected(nav.value, expected)) {
    return {
      status: 'pass',
      message: `${pathLabel} = ${renderConfigValue(nav.value)} matches the cohort canonical in ${fileLabel}`,
    };
  }
  return {
    status: 'warn',
    message: `${pathLabel} drift in ${fileLabel} — found ${renderConfigValue(nav.value)}, expected ${rawExpected}`,
    remediation: `Reconcile ${pathLabel} to ${rawExpected} in ${fileLabel}, or update the contract if the cohort canonical changed.`,
  };
}

// ─── Lock-content detector (mmnto-ai/totem#2107, strategy#754 content-hash rung) ──

/**
 * §6 normalize-before-hash for a distributed lock artifact — byte-for-byte the
 * canonical `tools/build-strategy-doctrine.cjs` `normalize()` the publisher hashes
 * with (the builder header MANDATES the verifier reconcile with it): CRLF / lone-CR
 * → LF, strip trailing spaces/tabs per line, pop ALL trailing blank lines, join with
 * exactly one terminal `\n`. Idempotent — re-normalizing a shipped (already-normalized)
 * file is a no-op, so `hash(shipped)` holds cross-platform.
 *
 * DISTINCT from {@link normalizeManagedBlock} (which ALSO trims LEADING blank lines and
 * leaves NO terminal newline) — the two must not be conflated; this one mirrors the lock
 * publisher exactly. A golden test pins the byte-for-byte parity against a precomputed hash.
 */
export function normalizeLockArtifact(text: string): string {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n') + '\n';
}

/**
 * Full sha256 of a normalized lock artifact, `sha256:`-prefixed hex — byte-for-byte
 * the publisher's `sha256` helper (`'sha256:' + sha256hex(utf8)`). DISTINCT from
 * {@link hashManagedBlock} (a 12-char SHORT hash for managed-block verdict records);
 * the lock content-hash is the FULL digest the lock records.
 */
export function hashLockArtifact(normalized: string): string {
  return 'sha256:' + crypto.createHash('sha256').update(normalized, 'utf-8').digest('hex');
}

/** The single lock schema version this reader understands (mirrors the manifest gate). */
export const SUPPORTED_LOCK_SCHEMA_VERSION = 1;

/** One parsed `artifacts[]` entry from a strategy-doctrine lock (camelCase). */
export interface LockArtifact {
  /** Package-relative path to the distributed snapshot (resolves under the package dir). */
  path: string;
  /** `repo:path` strategy-canonical source for the vs-canonical layer. */
  canonicalSource: string;
  /** `sha256:`-prefixed hex of the normalized canonical content at publish. */
  contentHash: string;
  /** Strategy-canonical commit the snapshot was cut from (provenance-info only). */
  lastPublishedSha: string;
}

/** A parsed + validated strategy-doctrine lock (Proposal 292 §10.6). */
export interface StrategyDoctrineLock {
  schemaVersion: number;
  package: string;
  version: string;
  published: string;
  artifacts: LockArtifact[];
}

const RawLockArtifactSchema = z.object({
  path: z.string(),
  'canonical-source': z.string(),
  'content-hash': z.string(),
  'last-published-sha': z.string(),
});

const RawStrategyDoctrineLockSchema = z.object({
  'schema-version': z.number(),
  package: z.string(),
  version: z.string(),
  published: z.string(),
  artifacts: z.array(RawLockArtifactSchema),
});

/**
 * Honest-absent lock parse outcome (discriminated union, mirroring
 * {@link parseParityManifest}):
 *   - `unparseable`        — invalid JSON or schema-validation failure.
 *   - `unsupported-schema` — `schema-version` ≠ the supported version.
 *   - `ok`                 — a fully parsed + validated lock.
 * NEVER throws — every failure is a first-class return value.
 */
export type LockParseResult =
  | { status: 'unparseable'; reason: string }
  | { status: 'unsupported-schema'; schemaVersion: number }
  | { status: 'ok'; lock: StrategyDoctrineLock };

/**
 * Parse raw `strategy-doctrine.lock` JSON into a validated {@link StrategyDoctrineLock}.
 * The `schema-version` gate runs BEFORE full validation so an incompatible future shape
 * is rejected with a clear `unsupported-schema` signal rather than a confusing
 * v1-shaped Zod failure (mirrors {@link parseParityManifest}). NEVER throws.
 */
export function parseStrategyDoctrineLock(jsonText: string): LockParseResult {
  let doc: unknown;
  try {
    doc = JSON.parse(jsonText);
    // totem-context: malformed lock JSON degrades to an `unparseable` signal (the sensor warns) — never a throw that would sink the doctor pipeline.
  } catch (err) {
    const reason = err instanceof Error ? err.message.split('\n')[0] : String(err);
    return { status: 'unparseable', reason: `Invalid JSON: ${reason}` };
  }

  // schema-version gate BEFORE full validation (a non-mapping / missing version → unparseable).
  const versionProbe = z.object({ 'schema-version': z.number() }).safeParse(doc);
  if (!versionProbe.success) {
    return {
      status: 'unparseable',
      reason: 'Lock is not a mapping with a numeric `schema-version`',
    };
  }
  const rawVersion = versionProbe.data['schema-version'];
  if (rawVersion !== SUPPORTED_LOCK_SCHEMA_VERSION) {
    return { status: 'unsupported-schema', schemaVersion: rawVersion };
  }

  const parsed = RawStrategyDoctrineLockSchema.safeParse(doc);
  if (!parsed.success) {
    return {
      status: 'unparseable',
      reason: `Lock failed schema validation: ${parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')}`,
    };
  }

  return {
    status: 'ok',
    lock: {
      schemaVersion: parsed.data['schema-version'],
      package: parsed.data.package,
      version: parsed.data.version,
      published: parsed.data.published,
      artifacts: parsed.data.artifacts.map((a) => ({
        path: a.path,
        canonicalSource: a['canonical-source'],
        contentHash: a['content-hash'],
        lastPublishedSha: a['last-published-sha'],
      })),
    },
  };
}

/** One verdict line from {@link detectLockContentContract} — per artifact × per layer. */
export interface LockContentLine {
  lineName: string;
  verdict: ParityContractVerdict;
}

/** The canonical-source repo prefix this slice resolves for the vs-canonical layer. */
const STRATEGY_CANONICAL_PREFIX = 'mmnto-ai/totem-strategy:';

/** Default lock filename inside the `@mmnto/strategy-doctrine` package. */
const STRATEGY_DOCTRINE_LOCK_FILENAME = 'strategy-doctrine.lock';

/** The package name the lock-content slice senses (for honest-absent messages). */
const STRATEGY_DOCTRINE_PACKAGE = '@mmnto/strategy-doctrine';

/** Inputs + test seams for {@link detectLockContentContract}. */
export interface DetectLockContentContext {
  /** Current repo's cohort id for `consumers` applicability (verbatim parity with the other detectors). */
  repoId?: string;
  /**
   * The installed `@mmnto/strategy-doctrine` package dir (e.g.
   * `<gitRoot>/node_modules/@mmnto/strategy-doctrine`). The lock + each
   * `artifacts[].path` resolve under it; the CLI registry constructs it.
   */
  packageDir: string;
  /** Lock filename within {@link packageDir} (default `strategy-doctrine.lock`). */
  lockFileName?: string;
  /** Anchor for the vs-canonical sibling resolution (the git root). */
  gitRoot: string;
  /** Test seam — override file reads. Production callers omit it (reads UTF-8 on disk). */
  readFile?: (absPath: string) => string | undefined;
  /** Test seam — override the dir-exists probe. Production callers omit it. */
  dirExists?: (absPath: string) => boolean;
  /**
   * Test seam — override the real-path resolver for the symlink-escape guard (default
   * {@link defaultRealpath}). Returns the canonicalized absolute path, or undefined when
   * the target does not exist / is unresolvable.
   */
  realpath?: (absPath: string) => string | undefined;
  /** Test seam — override the strategy-root resolver (default {@link resolveStrategyRoot}). */
  resolveStrategyRootFn?: (cwd: string, options?: StrategyResolverOptions) => StrategyRootStatus;
  /** Test seam — local git-object existence check for the last-published-sha note. */
  gitObjectExists?: (sha: string, cwd: string) => boolean;
}

/** A short, render-only form of a commit sha for provenance evidence. */
function shortSha(sha: string): string {
  return /^[0-9a-f]{7,}$/i.test(sha) ? sha.slice(0, 8) : sha;
}

/**
 * Parse a lock `canonical-source` into its strategy-repo-relative path, ONLY for the
 * `mmnto-ai/totem-strategy:<path>` shape this slice resolves. Any other repo / shape →
 * undefined (the vs-canonical layer skips that artifact rather than over-claiming).
 */
function parseStrategyCanonicalPath(canonicalSource: string): string | undefined {
  if (!canonicalSource.startsWith(STRATEGY_CANONICAL_PREFIX)) return undefined;
  const rel = canonicalSource.slice(STRATEGY_CANONICAL_PREFIX.length).trim();
  return rel.length > 0 ? rel : undefined;
}

/**
 * Real-path resolver for the symlink-escape guard. Returns the canonicalized absolute
 * path, or undefined when the target does not exist / is unresolvable.
 */
function defaultRealpath(p: string): string | undefined {
  try {
    return fs.realpathSync(p);
    // totem-context: a non-existent path (ENOENT) makes realpathSync throw — the honest "no real target to follow" signal; the caller keeps the lexical path and the subsequent read degrades to honest-absent, never a sensor crash.
  } catch {
    return undefined;
  }
}

/**
 * Resolve `relPath` under `baseDir`, or undefined if it escapes (path-escape guard —
 * a malformed lock must never read outside the package / sibling root). Also rejects a
 * path that resolves to `baseDir` itself (a dir, not an artifact file).
 *
 * The lexical `path.relative` check proves only LEXICAL containment; a symlink INSIDE
 * `baseDir` can still redirect the real read outside it (CR + greptile security review on
 * mmnto-ai/totem#2256). So the real paths are re-checked: `realpath(baseDir)` canonicalizes
 * pnpm's own symlinked `node_modules` (both sides resolve into `.pnpm`, so a legitimate
 * install stays contained), while a malformed lock pointing THROUGH an escaping symlink
 * fails the real-path containment. An absent target (`realpath` → undefined) keeps the
 * lexical path — the subsequent read degrades to honest-absent, never a false escape.
 */
function resolveWithinDir(
  baseDir: string,
  relPath: string,
  realpath: (absPath: string) => string | undefined,
): string | undefined {
  const resolved = path.resolve(baseDir, relPath);
  const rel = path.relative(baseDir, resolved);
  if (rel.length === 0 || rel.startsWith('..') || path.isAbsolute(rel)) return undefined;

  // Symlink-escape guard: re-check containment on the REAL paths.
  const realTarget = realpath(resolved);
  if (realTarget === undefined) return resolved; // target absent → lexical guard holds; read honest-absents
  const realBase = realpath(baseDir);
  if (realBase === undefined) return resolved; // base unresolvable → keep the lexical result
  const realRel = path.relative(realBase, realTarget);
  if (realRel.length === 0 || realRel.startsWith('..') || path.isAbsolute(realRel))
    return undefined;
  return resolved;
}

/**
 * Local git-object existence check (`git cat-file -e <sha>^{commit}`) for the
 * last-published-sha provenance note — NEVER networks, NEVER gates. A non-existent /
 * non-commit object exits non-zero (the honest "not a local object" signal).
 */
function defaultGitObjectExists(sha: string, cwd: string): boolean {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return false;
  try {
    safeExec('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd, timeout: GIT_REMOTE_TIMEOUT_MS });
    return true;
    // totem-context: a missing / non-commit object makes `git cat-file -e` exit non-zero (safeExec throws) — the honest "not a local object" signal for a provenance-INFO note, never a sensor failure.
  } catch {
    return false;
  }
}

/**
 * The self-consistency line for ONE artifact: `sha256(normalize(packaged file)) == lock
 * content-hash`. ALWAYS local — proves the shipped snapshot is internally intact. The
 * `last-published-sha` rides as provenance-info evidence (never a comparator).
 */
function selfConsistencyLine(
  contract: ParityContract,
  artifact: LockArtifact,
  packageDir: string,
  readFile: (absPath: string) => string | undefined,
  realpath: (absPath: string) => string | undefined,
): LockContentLine {
  const lineName = `Parity: ${contract.id} (${artifact.path} · self)`;
  const provenance = ` [last-published-sha ${shortSha(artifact.lastPublishedSha)}, provenance-info]`;
  const pkg = contract.package ?? STRATEGY_DOCTRINE_PACKAGE;

  const filePath = resolveWithinDir(packageDir, artifact.path, realpath);
  if (filePath === undefined) {
    return {
      lineName,
      verdict: {
        status: 'warn',
        message: `artifact path '${artifact.path}' escapes the package dir — refusing to read (lock may be malformed)`,
      },
    };
  }
  const raw = readFile(filePath);
  if (raw === undefined) {
    return {
      lineName,
      verdict: {
        status: 'warn',
        message: `packaged artifact ${artifact.path} absent — expected ${artifact.contentHash}${provenance}`,
        remediation: `Reinstall ${pkg} to restore the packaged artifact, then re-run totem doctor --parity.`,
      },
    };
  }
  const actual = hashLockArtifact(normalizeLockArtifact(raw));
  if (actual === artifact.contentHash) {
    return {
      lineName,
      verdict: {
        status: 'pass',
        message: `packaged ${artifact.path} intact — ${artifact.contentHash}${provenance}`,
      },
    };
  }
  return {
    lineName,
    verdict: {
      status: 'warn',
      message: `integrity drift — recomputed ${actual} != lock ${artifact.contentHash} at ${artifact.path}${provenance}`,
      remediation: `The packaged ${artifact.path} does not match its own lock record — reinstall ${pkg}.`,
    },
  };
}

/**
 * The vs-canonical line for ONE artifact: the same recompute against the artifact's
 * lock `canonical-source` within a resolved local `../totem-strategy` sibling. Runs ONLY
 * when a sibling resolves (else SKIP honest-absent) — NEVER a fetch. A mismatch is
 * currency drift (the pin lags local canonical), not an integrity failure.
 */
function vsCanonicalLine(
  contract: ParityContract,
  artifact: LockArtifact,
  ctx: DetectLockContentContext,
  readFile: (absPath: string) => string | undefined,
  realpath: (absPath: string) => string | undefined,
  sibling: StrategyRootStatus,
): LockContentLine {
  const lineName = `Parity: ${contract.id} (${artifact.path} · vs-canonical)`;

  if (!sibling.resolved) {
    return {
      lineName,
      verdict: {
        status: 'skip',
        message: `no local ../totem-strategy sibling resolvable — vs-canonical honest-absent (never a fetch): ${sibling.reason}`,
      },
    };
  }

  const relPath = parseStrategyCanonicalPath(artifact.canonicalSource);
  if (relPath === undefined) {
    return {
      lineName,
      verdict: {
        status: 'skip',
        message: `canonical-source '${artifact.canonicalSource}' is not a ${STRATEGY_CANONICAL_PREFIX}<path> ref — vs-canonical unprovable this slice`,
      },
    };
  }

  const canonicalPath = resolveWithinDir(sibling.path, relPath, realpath);
  if (canonicalPath === undefined) {
    return {
      lineName,
      verdict: {
        status: 'warn',
        message: `canonical-source path '${relPath}' escapes the strategy sibling root — refusing to read`,
      },
    };
  }
  const raw = readFile(canonicalPath);
  const lpsNote = lastPublishedNote(artifact.lastPublishedSha, sibling.path, ctx);
  if (raw === undefined) {
    return {
      lineName,
      verdict: {
        status: 'warn',
        message: `canonical source ${relPath} absent under the resolved sibling (${sibling.path}) — vs-canonical drift${lpsNote}`,
        remediation: `The local ../totem-strategy no longer carries ${relPath}; sync it, or this pin no longer reflects canonical.`,
      },
    };
  }
  const actual = hashLockArtifact(normalizeLockArtifact(raw));
  if (actual === artifact.contentHash) {
    return {
      lineName,
      verdict: {
        status: 'pass',
        message: `lock matches local strategy-canonical at ${relPath} — ${artifact.contentHash}${lpsNote}`,
      },
    };
  }
  return {
    lineName,
    verdict: {
      status: 'warn',
      message: `currency drift — lock ${artifact.contentHash} != current canonical ${actual} at ${relPath}${lpsNote}`,
      remediation: `The consumed ${contract.package ?? STRATEGY_DOCTRINE_PACKAGE} pin lags the local ../totem-strategy canonical for ${relPath}; bump the pin when a new doctrine bundle publishes (a local sibling ahead of the published pin is expected currency drift, not a defect).`,
    },
  };
}

/** Render the last-published-sha provenance note (+ a local git-object existence check). */
function lastPublishedNote(
  sha: string,
  strategyRoot: string,
  ctx: DetectLockContentContext,
): string {
  const exists = ctx.gitObjectExists ?? defaultGitObjectExists;
  const resolvable = exists(sha, strategyRoot) ? 'resolvable in sibling' : 'not a local git object';
  return ` [last-published-sha ${shortSha(sha)} ${resolvable}, provenance-info]`;
}

/**
 * Detect drift for the `manifestation: content-hash` strategy-doctrine lock-content
 * contract (mmnto-ai/totem#2107, strategy#754). Re-derives each distributed artifact's
 * `content-hash` from the consumed lock via the §6 normalize+sha256 contract and compares
 * it in TWO honest-absent layers, NEVER a fetch (Tenet 6/13):
 *
 *   - **self-consistency** (ALWAYS, local): `sha256(normalize(packaged file at path)) ==
 *     its lock content-hash` — proves the shipped snapshot is internally intact.
 *   - **vs-canonical** (ONLY when a local `../totem-strategy` sibling resolves): the same
 *     recompute against the artifact's lock `canonical-source` within the sibling — proves
 *     the pin still reflects strategy-canonical. SKIP honest-absent otherwise.
 *
 * Returns ONE line per artifact × per layer (the layers render SEPARATELY — a collapsed
 * "content drift" verdict would over-claim which layer drifted). `last-published-sha` is
 * provenance-INFO only (a LOCAL git-object existence note when a sibling resolves) — NEVER
 * a gating comparator, NEVER `sha == HEAD`.
 *
 * Top-level honest-absent: not-a-consumer / repo-id-unresolvable → skip; package not
 * installed → skip (the version-pin currency row senses the pin); lock absent while the
 * package is present → warn (structurally incomplete); lock unparseable / unsupported-schema
 * → warn.
 *
 * NEVER emits `fail` (the CLI edge owns `--strict` promotion). NEVER throws (reads
 * degrade). NEVER networks.
 */
export function detectLockContentContract(
  contract: ParityContract,
  ctx: DetectLockContentContext,
): LockContentLine[] {
  const idLine = (verdict: ParityContractVerdict): LockContentLine[] => [
    { lineName: `Parity: ${contract.id}`, verdict },
  ];

  // ── Applicability: consumers scope (verbatim parity with the other detectors) ──
  if (contract.consumers !== undefined) {
    if (ctx.repoId === undefined) {
      return idLine({
        status: 'skip',
        message: `cannot determine applicability — repo id unresolvable; contract is scoped to consumers [${contract.consumers.join(', ')}]`,
      });
    }
    if (!contract.consumers.includes(ctx.repoId)) {
      return idLine({
        status: 'skip',
        message: `cohort permits absence here (${ctx.repoId} not in consumers)`,
      });
    }
  }

  const readFile = ctx.readFile ?? readFileText;
  const realpath = ctx.realpath ?? defaultRealpath;
  const dirExists = ctx.dirExists ?? isDirectory;
  const lockFileName = ctx.lockFileName ?? STRATEGY_DOCTRINE_LOCK_FILENAME;
  const pkg = contract.package ?? STRATEGY_DOCTRINE_PACKAGE;

  // ── Package not installed → honest-absent skip (the currency row senses the pin) ──
  if (!dirExists(ctx.packageDir)) {
    return idLine({
      status: 'skip',
      message: `${pkg} not installed at ${ctx.packageDir} — lock-content unprovable (the version-pin currency row senses the pin)`,
    });
  }

  // ── Read the consumed lock (package present but lock absent → structurally incomplete) ──
  // Route the lock filename through the same containment guard as artifacts/canonical
  // sources so the exported `lockFileName` seam can't `../`-escape the package dir
  // (CR review on mmnto-ai/totem#2256 — uniform "no raw path.join in this detector").
  const lockPath = resolveWithinDir(ctx.packageDir, lockFileName, realpath);
  if (lockPath === undefined) {
    return idLine({
      status: 'warn',
      message: `${lockFileName} escapes the package dir — refusing to read (lock filename may be malformed)`,
    });
  }
  const lockRaw = readFile(lockPath);
  if (lockRaw === undefined) {
    return idLine({
      status: 'warn',
      message: `${pkg} installed but ${lockFileName} is absent — distributed package is structurally incomplete`,
      remediation: `Reinstall ${pkg} (a publish without its lock is a packaging defect), then re-run totem doctor --parity.`,
    });
  }

  // ── Parse (unparseable / unsupported-schema → warn; never throw) ──
  const parsed = parseStrategyDoctrineLock(lockRaw);
  if (parsed.status === 'unparseable') {
    return idLine({
      status: 'warn',
      message: `${lockFileName} is unparseable — ${parsed.reason}`,
      remediation: `Reinstall ${pkg} to restore a valid lock, then re-run totem doctor --parity.`,
    });
  }
  if (parsed.status === 'unsupported-schema') {
    return idLine({
      status: 'warn',
      message: `${lockFileName} schema-version ${parsed.schemaVersion} unsupported (this doctor understands ${SUPPORTED_LOCK_SCHEMA_VERSION}) — content-hash unprovable`,
      remediation: `Upgrade @mmnto/cli to a build that understands lock schema ${parsed.schemaVersion}, or reinstall a compatible ${pkg}.`,
    });
  }

  const { lock } = parsed;
  // Wrong-package guard (CR review on mmnto-ai/totem#2256): a stale / mispackaged lock from
  // ANOTHER package could self-consistently `pass` (its hashes match its own bundled files),
  // masking a packaging defect. The lock declaring a different package than the one it was
  // loaded under IS the structural inconsistency this sensor exists to catch.
  if (lock.package !== pkg) {
    return idLine({
      status: 'warn',
      message: `${lockFileName} declares package ${lock.package} but was loaded from ${pkg} — distributed package is structurally inconsistent`,
      remediation: `Reinstall ${pkg} to restore the correct lock, then re-run totem doctor --parity.`,
    });
  }
  if (lock.artifacts.length === 0) {
    return idLine({
      status: 'warn',
      message: `${lockFileName} declares no artifacts[] — nothing to verify (structurally incomplete)`,
    });
  }

  // ── Resolve the vs-canonical sibling ONCE (honest-absent; never a fetch) ──
  const resolveRoot = ctx.resolveStrategyRootFn ?? resolveStrategyRoot;
  const sibling = resolveRoot(ctx.gitRoot, { gitRoot: ctx.gitRoot });

  // ── Per artifact × per layer (rendered SEPARATELY — no collapsed verdict) ──
  const lines: LockContentLine[] = [];
  for (const artifact of lock.artifacts) {
    lines.push(selfConsistencyLine(contract, artifact, ctx.packageDir, readFile, realpath));
    lines.push(vsCanonicalLine(contract, artifact, ctx, readFile, realpath, sibling));
  }
  return lines;
}

// ─── Shared filesystem helpers ──────────────────────────

/** Read a UTF-8 text file, or undefined on any read failure (honest-absent). */
function readFileText(absPath: string): string | undefined {
  try {
    // totem-context: a runtime sensor must read the ACTUAL on-disk installed artifact (not the git-index version — a consumer's installed skill may be untracked), and this detector is synchronous by design (mirrors readPackageJson / isDirectory below); making one reader async would ripple through the whole pure detector.
    return fs.readFileSync(absPath, 'utf-8');
    // totem-context: a missing / unreadable artifact is the honest-absent signal the mechanical detector degrades to a skip on; rethrowing would force the caller to wrap a routine absence in try/catch.
  } catch {
    return undefined;
  }
}

/**
 * Read + JSON-parse a package.json into the loose {@link PackageJsonShape}.
 * Returns undefined on any read / parse failure or a non-object payload —
 * mirroring `readEngineRange`'s ENOENT-tolerant JSON read so a missing or
 * corrupt manifest is honest-absent, never a throw.
 */
function readPackageJson(absPath: string): PackageJsonShape | undefined {
  let raw: string;
  try {
    raw = fs.readFileSync(absPath, 'utf-8');
    // totem-context: a missing / unreadable package.json is the honest-absent signal callers degrade to a skip on; rethrowing would force every caller to wrap a routine absence in try/catch.
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
    // totem-context: a corrupt package.json degrades to undefined (honest-absent skip), not a crash — the sensor must never sink the doctor pipeline on a malformed consumer manifest.
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  return parsed as PackageJsonShape;
}

/** Read just the `name` from a package.json, or undefined on any failure. */
function readPackageName(absPath: string): string | undefined {
  const parsed = readPackageJson(absPath);
  return typeof parsed?.name === 'string' ? parsed.name : undefined;
}

/**
 * `fs.statSync` raises on missing paths and on EACCES/ENOTDIR; treat any stat
 * failure as "not a directory" (mirrors `strategy-resolver.ts`).
 */
function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
    // totem-context: stat failures (ENOENT, EACCES, ENOTDIR) are the sibling-miss signal; rethrowing would force the resolver to wrap a routine absence in try/catch.
  } catch {
    return false;
  }
}

// ─── Network-read-only posture detector family (Prop 296 §14) ─────────────────
//
// The parity-posture rows (`repo-merge-posture`, `repo-required-checks-posture`,
// `repo-branch-protection-posture`; strategy#962 / strategy#482) sense
// externally-hosted GOVERNED STATE — GitHub repo settings / rulesets / branch
// protection — which no repo file records. Prop 296 §14 carved a named
// `network-read-only` sub-class out of §12.5's never-network default for exactly
// this: authenticated READ-ONLY GETs, never a mutation ([Tenet 13]).
//
// This module keeps its module-wide NEVER-networks + synchronous-pure invariant
// (header :27-35): the fetches happen at the CLI EDGE (doctor-parity-fetch.ts),
// which resolves per-repo, per-surface SNAPSHOTS BEFORE detector dispatch. The
// detector here is the SYNC PURE verdict step — it takes the pre-fetched
// snapshots (untrusted boundary JSON) + the canonical declaration text and emits
// per-repo verdict LINES. The fetched JSON is Zod-narrowed max-tolerance: a
// mis-shaped / field-shy payload degrades to auth-class `unknown` for THAT
// surface, never a throw and never a false drift (§14 clause 2).
//
// Verdict vocabulary ({@link ParityContractVerdict}, :119-123):
//   - `pass`    — the surface was read and the posture holds.
//   - `warn`    — the surface was read and the posture DRIFTED (sensor, not gate).
//   - `skip`    — honest-absent: no transport / offline (§14 clause 4), or the
//                 row-2 canonical declaration is not yet committed, or no roster
//                 repo is in the row's `consumers` scope.
//   - `unknown` — auth-class / transient / unparseable: a 200 WITHOUT the posture
//                 fields, a no/under-privileged token, a 404 on a governed
//                 surface (indistinguishable from under-privilege), a 5xx/timeout,
//                 or an unparseable payload. NEVER a drift verdict (§14 clause 2).

/**
 * Per-surface fetch outcome the CLI edge resolves for one governed-state read
 * (Prop 296 §14 clause 2). The detector maps each to a verdict WITHOUT ever
 * networking:
 *   - `ok`           — a 200 with a parseable body (the detector inspects it).
 *   - `no-transport` — `gh` unavailable / spawn failed / offline → honest-absent
 *                      `skip` (§14 clause 4). Distinct from an auth failure.
 *   - `auth`         — no token, an under-privileged token, or a 401/403 → `unknown`.
 *   - `not-found`    — a 404 on the governed surface (repo/branch invisible, or a
 *                      repo-scoped CI token that cannot see the sibling) → `unknown`.
 *   - `error`        — a 5xx / timeout / unparseable body → `unknown` (transient).
 */
export type NetworkSurfaceOutcome = 'ok' | 'no-transport' | 'auth' | 'not-found' | 'error';

/**
 * One fetched governed-state surface. `data` carries the RAW parsed JSON only on
 * an `ok` outcome — untrusted boundary input the detector Zod-narrows before
 * trusting any field. `detail` is optional render context (e.g. `HTTP 403`).
 */
export interface NetworkSurfaceSnapshot {
  outcome: NetworkSurfaceOutcome;
  /** Raw parsed JSON payload when `outcome === 'ok'`; undefined otherwise. Untrusted — narrowed in the detector. */
  data?: unknown;
  /** Optional human-readable outcome detail for the rendered line (e.g. an HTTP status). */
  detail?: string;
}

/**
 * The three externally-hosted surfaces a network-read-only probe reads for one
 * repo. Each is present only when the CLI edge attempted it (the fetch step
 * fetches per repo the union of surfaces the in-scope rows need):
 *   - `repoSettings`     — `GET /repos/{owner}/{repo}` (row-1 merge posture).
 *   - `rulesets`         — the repo's ruleset DETAILS (rows 2 + 3).
 *   - `branchProtection` — classic `GET …/branches/{branch}/protection` (row-3).
 */
export interface NetworkRepoSurfaces {
  repoSettings?: NetworkSurfaceSnapshot;
  rulesets?: NetworkSurfaceSnapshot;
  branchProtection?: NetworkSurfaceSnapshot;
}

/**
 * One repo's pre-fetched network snapshot. `repoSlug` is the `owner/repo`
 * addressed on the API; `repoId` is the cohort id used for `consumers`
 * applicability (the repo segment / {@link deriveCohortRepoId} result). §14
 * clause 3: one verdict LINE is emitted per repo, never one blended verdict.
 */
export interface NetworkProbeRepoSnapshot {
  repoSlug: string;
  repoId: string;
  surfaces: NetworkRepoSurfaces;
}

/** The posture rows the network-read-only family senses (routing key = the contract id). */
export type NetworkPostureRow =
  | 'repo-merge-posture'
  | 'repo-required-checks-posture'
  | 'repo-branch-protection-posture';

/** Inputs + test seams for {@link detectNetworkPostureContract}. */
export interface DetectNetworkPostureContext {
  /** Which posture row to evaluate — selects the surface reads + verdict logic. */
  row: NetworkPostureRow;
  /**
   * Pre-fetched per-repo snapshots (roster resolved + fetched at the CLI edge).
   * The detector NEVER networks — it only inspects these. The row's `consumers`
   * scope is applied PER-REPO against each snapshot's `repoId`.
   */
  repos: NetworkProbeRepoSnapshot[];
  /**
   * `repo-required-checks-posture` only: absolute path to the totem-side
   * canonical ruleset declaration (`.totem/rulesets/main.json`). Read via
   * {@link readFile}. Absent file → honest-absent `skip` ("declaration not yet
   * committed"), never an error.
   */
  declarationPath?: string;
  /** Test seam — override the declaration read. Production callers omit it (reads UTF-8 on disk). */
  readFile?: (absPath: string) => string | undefined;
}

/**
 * The pinned squash-merge body/title posture (row-1). GitHub encodes these as
 * enums; the ruled values are a BLANK squash body + a PR_TITLE squash title.
 */
const EXPECTED_SQUASH_MESSAGE = 'BLANK';
const EXPECTED_SQUASH_TITLE = 'PR_TITLE';

/** The symbolic ref-name includes that mark a ruleset as targeting the default branch. */
const DEFAULT_BRANCH_INCLUDES = new Set(['~DEFAULT_BRANCH', '~ALL']);

/**
 * The ruleset rule types that gate writes to a branch (the "push/PR-class" set,
 * row-3). Any active ruleset carrying one of these for the default branch must
 * itself be un-bypassable — a permissive/bypassable ruleset must not undercut
 * classic branch protection.
 */
const PUSH_PR_RULE_TYPES = new Set([
  'pull_request',
  'non_fast_forward',
  'deletion',
  'creation',
  'update',
  'required_linear_history',
  'required_signatures',
  'required_status_checks',
  'required_deployments',
  'merge_queue',
]);

// ── Boundary Zod schemas (untrusted fetched JSON; max-tolerance) ──

/** Row-1 repo-settings posture fields. A 200 missing any of these is auth-class (`unknown`). */
const RepoMergeSettingsSchema = z.object({
  allow_squash_merge: z.boolean(),
  allow_merge_commit: z.boolean(),
  allow_rebase_merge: z.boolean(),
  squash_merge_commit_message: z.string(),
  squash_merge_commit_title: z.string(),
});

/** One ruleset rule (`{ type, parameters }`) — parameters stay `unknown` until a per-type narrow. */
const RulesetRuleSchema = z.object({
  type: z.string(),
  parameters: z.unknown().optional(),
});

/** One ruleset detail object (max-tolerance — every field optional so a slim payload still narrows). */
const RulesetSchema = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  name: z.string().optional(),
  enforcement: z.string().optional(),
  target: z.string().optional(),
  conditions: z
    .object({
      ref_name: z
        .object({
          include: z.array(z.string()).optional(),
          exclude: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
  bypass_actors: z.array(z.unknown()).optional(),
  rules: z.array(RulesetRuleSchema).optional(),
});

/** The rulesets surface payload is an array of ruleset details. */
const RulesetsArraySchema = z.array(RulesetSchema);

/** Parameters of a `required_status_checks` rule (row-2 union + strict-policy read). */
const StatusCheckParamsSchema = z.object({
  required_status_checks: z.array(z.object({ context: z.string() })).optional(),
  strict_required_status_checks_policy: z.boolean().optional(),
});

/** A classic branch-protection `{ enabled }` toggle. */
const ProtectionToggleSchema = z.object({ enabled: z.boolean() });

/**
 * Row-3 classic branch-protection posture. The three toggles are ALWAYS present
 * in a full admin read, so their absence marks an under-privileged 200
 * (auth-class `unknown`). `required_pull_request_reviews` is legitimately absent
 * when PR review is not required — that absence is real drift, not auth-class.
 */
const BranchProtectionSchema = z.object({
  required_pull_request_reviews: z
    .object({ required_approving_review_count: z.number().optional() })
    .optional(),
  enforce_admins: ProtectionToggleSchema,
  allow_force_pushes: ProtectionToggleSchema,
  allow_deletions: ProtectionToggleSchema,
});

/**
 * The totem-side canonical ruleset declaration (`.totem/rulesets/main.json`,
 * schema-version 1). The canonical required-checks list + pinned strict policy
 * come from `required_status_checks`; the surface is compared against THIS, never
 * against itself (Tenet 20).
 */
const RulesetDeclarationSchema = z.object({
  'schema-version': z.number(),
  'ruleset-name': z.string().optional(),
  enforcement: z.string().optional(),
  bypass_actors: z.array(z.unknown()).optional(),
  required_status_checks: z
    .object({
      strict_required_status_checks_policy: z.boolean().optional(),
      contexts: z.array(z.string()).optional(),
    })
    .optional(),
});

/**
 * Sense the three Prop 296 §14 network-read-only posture rows against pre-fetched
 * snapshots. Returns an ARRAY of per-repo verdict lines (the {@link LockContentLine}
 * pattern — the CLI's flatMap render + R2 contract-counting already support
 * multi-line rows). NEVER networks (the fetches ran at the CLI edge), NEVER
 * throws (every read/parse failure degrades to a verdict), NEVER emits `fail`
 * (the CLI edge owns `--strict` promotion) and NEVER a drift verdict on an
 * auth/transport failure (§14 clause 2).
 *
 * Applicability: the row's `consumers` scope is applied PER-REPO against each
 * snapshot's `repoId` (verbatim with {@link detectLockContentContract}). A row
 * scoped `consumers: [totem]` senses only the roster repos whose id is `totem`;
 * an empty in-scope set yields one honest-absent `skip`.
 */
export function detectNetworkPostureContract(
  contract: ParityContract,
  ctx: DetectNetworkPostureContext,
): LockContentLine[] {
  const inScope = ctx.repos.filter((r) => repoInConsumerScope(contract, r.repoId));
  if (inScope.length === 0) {
    return [
      {
        lineName: `Parity: ${contract.id}`,
        verdict: {
          status: 'skip',
          message:
            contract.consumers !== undefined
              ? `cohort permits absence here (no roster repo in consumers [${contract.consumers.join(', ')}])`
              : 'no roster repo resolved to probe (current-repo slug unresolvable)',
        },
      },
    ];
  }

  switch (ctx.row) {
    case 'repo-merge-posture':
      return inScope.map((repo) => mergePostureLine(contract, repo));
    case 'repo-required-checks-posture':
      return requiredChecksLines(contract, ctx, inScope);
    case 'repo-branch-protection-posture':
      return inScope.flatMap((repo) => branchProtectionLines(contract, repo));
    default:
      // Defensive: an unrecognized row degrades to a single honest-absent skip
      // rather than darking the sensor (mirrors the manifestation fail-loud).
      return [
        {
          lineName: `Parity: ${contract.id}`,
          verdict: { status: 'skip', message: `network-posture row unrecognized by this doctor` },
        },
      ];
  }
}

/** True when `repoId` is inside the contract's `consumers` scope (undefined = applies to all). */
function repoInConsumerScope(contract: ParityContract, repoId: string): boolean {
  return contract.consumers === undefined || contract.consumers.includes(repoId);
}

/** Append ` (detail)` to a message when the snapshot carries render detail. */
function detailSuffix(surface: NetworkSurfaceSnapshot): string {
  return surface.detail !== undefined && surface.detail.length > 0 ? ` (${surface.detail})` : '';
}

/**
 * Map a non-`ok` (or absent) surface to its cannot-verify verdict, or `undefined`
 * when the surface is `ok` and the caller should inspect the payload. §14 clause
 * 2/4: `no-transport` → `skip` (honest-absent), every other failure → `unknown`
 * (never a drift verdict).
 */
function surfaceCannotVerify(
  surface: NetworkSurfaceSnapshot | undefined,
  surfaceLabel: string,
): ParityContractVerdict | undefined {
  if (surface === undefined) {
    return { status: 'unknown', message: `${surfaceLabel}: not probed — cannot verify` };
  }
  switch (surface.outcome) {
    case 'ok':
      return undefined;
    case 'no-transport':
      return {
        status: 'skip',
        message: `${surfaceLabel}: no transport (gh unavailable / offline) — honest-absent per §14 clause 4${detailSuffix(surface)}`,
      };
    case 'auth':
      return {
        status: 'unknown',
        message: `${surfaceLabel}: auth-class — cannot verify (missing / under-privileged token; never posture-false per §14 clause 2)${detailSuffix(surface)}`,
      };
    case 'not-found':
      return {
        status: 'unknown',
        message: `${surfaceLabel}: 404 on a governed surface — indistinguishable from under-privilege; cannot verify per §14 clause 2${detailSuffix(surface)}`,
      };
    case 'error':
      return {
        status: 'unknown',
        message: `${surfaceLabel}: transient / unreachable — cannot verify${detailSuffix(surface)}`,
      };
    default:
      return {
        status: 'unknown',
        message: `${surfaceLabel}: unrecognized outcome — cannot verify`,
      };
  }
}

// ── Row 1: repo-merge-posture ──

/**
 * One repo's merge-posture line: `GET /repos/{owner}/{repo}` must report
 * squash-only merges + a BLANK squash body + a PR_TITLE squash title. A 200
 * missing those fields is auth-class (`unknown`); a read mismatch is drift
 * (`warn`). Silent by choice on `delete_branch_on_merge`.
 */
function mergePostureLine(
  contract: ParityContract,
  repo: NetworkProbeRepoSnapshot,
): LockContentLine {
  const lineName = `Parity: ${contract.id} [${repo.repoSlug}]`;
  const surface = repo.surfaces.repoSettings;
  const cannot = surfaceCannotVerify(surface, 'repo settings');
  if (cannot !== undefined) return { lineName, verdict: cannot };

  const parsed = RepoMergeSettingsSchema.safeParse(surface?.data);
  if (!parsed.success) {
    return {
      lineName,
      verdict: {
        status: 'unknown',
        message:
          'repo settings: 200 without the merge-posture fields — auth-class (under-privileged token), never posture-false (§14 clause 2)',
      },
    };
  }
  const s = parsed.data;
  const drift: string[] = [];
  if (s.allow_squash_merge !== true) drift.push('allow_squash_merge≠true');
  if (s.allow_merge_commit !== false) drift.push('allow_merge_commit≠false');
  if (s.allow_rebase_merge !== false) drift.push('allow_rebase_merge≠false');
  if (s.squash_merge_commit_message !== EXPECTED_SQUASH_MESSAGE)
    drift.push(
      `squash_merge_commit_message=${s.squash_merge_commit_message}≠${EXPECTED_SQUASH_MESSAGE}`,
    );
  if (s.squash_merge_commit_title !== EXPECTED_SQUASH_TITLE)
    drift.push(`squash_merge_commit_title=${s.squash_merge_commit_title}≠${EXPECTED_SQUASH_TITLE}`);

  if (drift.length > 0) {
    return {
      lineName,
      verdict: {
        status: 'warn',
        message: `merge posture drifted: ${drift.join(', ')}`,
        remediation:
          'Restore squash-only merges with a BLANK squash body + PR_TITLE title in the repo Settings → General → Pull Requests.',
      },
    };
  }
  return {
    lineName,
    verdict: { status: 'pass', message: 'squash-only + BLANK squash body + PR_TITLE title' },
  };
}

// ── Row 2: repo-required-checks-posture ──

/**
 * The required-checks lines: the active-ruleset UNION of `required_status_checks`
 * must set-equal the canonical list (BOTH directions), AND every ruleset
 * contributing a canonical check must itself hold enforcement=active,
 * target ~DEFAULT_BRANCH, `bypass_actors=[]`, and the pinned
 * `strict_required_status_checks_policy` — the union must not hide a bypassable
 * contributing ruleset. Canonical + pin come from `.totem/rulesets/main.json`;
 * an absent declaration is honest-absent `skip`.
 */
function requiredChecksLines(
  contract: ParityContract,
  ctx: DetectNetworkPostureContext,
  inScope: NetworkProbeRepoSnapshot[],
): LockContentLine[] {
  // ── Canonical declaration (read ONCE; absent → honest-absent skip) ──
  const readFile = ctx.readFile ?? readFileText;
  const declPath = ctx.declarationPath;
  const declRaw = declPath !== undefined ? safeReadFile(readFile, declPath) : undefined;
  if (declRaw === undefined) {
    return inScope.map((repo) => ({
      lineName: `Parity: ${contract.id} [${repo.repoSlug}]`,
      verdict: {
        status: 'skip' as const,
        message:
          'canonical ruleset declaration (.totem/rulesets/main.json) not yet committed — honest-absent (interim canonical is prose, never parser input)',
      },
    }));
  }

  const canonical = parseRulesetDeclaration(declRaw);
  if (canonical === undefined) {
    // Malformed / unsupported canonical: cannot prove drift NOR currency (the
    // Stale-Doctor-Paradox) → unknown, never a fabricated pass/warn.
    return inScope.map((repo) => ({
      lineName: `Parity: ${contract.id} [${repo.repoSlug}]`,
      verdict: {
        status: 'unknown' as const,
        message:
          '.totem/rulesets/main.json is unparseable / missing required_status_checks.contexts — canonical list underivable, cannot verify',
      },
    }));
  }

  return inScope.map((repo) => requiredChecksLine(contract, repo, canonical));
}

/** The narrowed canonical required-checks declaration. */
interface CanonicalRequiredChecks {
  contexts: Set<string>;
  strictPolicy: boolean;
}

/** Parse + narrow the declaration; undefined when unparseable / unsupported / context-less. */
function parseRulesetDeclaration(raw: string): CanonicalRequiredChecks | undefined {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
    // totem-context: a malformed canonical declaration is a first-class "canonical underivable" signal (→ unknown), not a throw — the sensor must never crash on a mis-authored totem-side file.
  } catch {
    return undefined;
  }
  const parsed = RulesetDeclarationSchema.safeParse(doc);
  if (!parsed.success) return undefined;
  if (parsed.data['schema-version'] !== 1) return undefined;
  const contexts = parsed.data.required_status_checks?.contexts;
  if (contexts === undefined || contexts.length === 0) return undefined;
  return {
    contexts: new Set(contexts),
    // Pinned posture; the row's expected value is `false`, but the PIN is whatever
    // the canonical declares (derive-not-hardcode, Tenet 20).
    strictPolicy: parsed.data.required_status_checks?.strict_required_status_checks_policy ?? false,
  };
}

/** One repo's required-checks line (union set-compare + per-contributing-ruleset enforcement). */
function requiredChecksLine(
  contract: ParityContract,
  repo: NetworkProbeRepoSnapshot,
  canonical: CanonicalRequiredChecks,
): LockContentLine {
  const lineName = `Parity: ${contract.id} [${repo.repoSlug}]`;
  const surface = repo.surfaces.rulesets;
  const cannot = surfaceCannotVerify(surface, 'rulesets');
  if (cannot !== undefined) return { lineName, verdict: cannot };

  const parsed = RulesetsArraySchema.safeParse(surface?.data);
  if (!parsed.success) {
    return {
      lineName,
      verdict: {
        status: 'unknown',
        message: 'rulesets: 200 with an unparseable body — cannot verify (§14 clause 2)',
      },
    };
  }

  // Every ruleset targeting the default branch (any enforcement mode) is
  // considered for the union so a check supplied ONLY by an evaluate-mode ruleset
  // still appears in the set-compare — the per-contributing-ruleset gate below is
  // what catches the bypassable/evaluate case with a precise reason, rather than a
  // blunt "missing" (round finding + greptile P1 on strategy#962).
  const defaultRulesets = parsed.data.filter(rulesetTargetsDefault);
  const union = new Set<string>();
  const contributing: { ruleset: z.infer<typeof RulesetSchema>; contexts: string[] }[] = [];
  for (const ruleset of defaultRulesets) {
    const contexts = statusCheckContexts(ruleset);
    if (contexts.length === 0) continue; // a zero-rule / copilot-class ruleset never satisfies presence
    for (const c of contexts) union.add(c);
    contributing.push({ ruleset, contexts });
  }

  const drift: string[] = [];

  // ── Set-compare BOTH directions ──
  const missing = [...canonical.contexts].filter((c) => !union.has(c));
  const extra = [...union].filter((c) => !canonical.contexts.has(c));
  if (missing.length > 0)
    drift.push(`missing required check(s): ${missing.join(', ')} (re-opens the gated vector)`);
  if (extra.length > 0)
    drift.push(`stale extra required check(s): ${extra.join(', ')} (silent merge-block)`);

  // ── Per-contributing-ruleset enforcement posture ──
  const unobserved: string[] = [];
  for (const { ruleset, contexts } of contributing) {
    const read = enforcementProblems(ruleset, canonical.strictPolicy);
    const name = ruleset.name ?? String(ruleset.id ?? '(unnamed)');
    if (read.problems.length > 0) {
      drift.push(
        `contributing ruleset '${name}' (supplies ${contexts.join(', ')}) is ${read.problems.join(' / ')}`,
      );
    }
    if (read.unobserved.length > 0) {
      unobserved.push(`contributing ruleset '${name}' omitted ${read.unobserved.join(', ')}`);
    }
  }

  if (drift.length > 0) {
    return {
      lineName,
      verdict: {
        status: 'warn',
        message: `required-checks posture drifted: ${drift.join('; ')}`,
        remediation:
          'Align the default-branch ruleset union to the canonical required-checks list and make every contributing ruleset enforcement=active with no bypass actors.',
      },
    };
  }
  // Observed drift outranks an observability gap (a definite finding is never
  // hidden behind unknown); with no drift, a field-shy contributing ruleset is
  // auth-class — never a silent pass (§14 clause 2).
  if (unobserved.length > 0) {
    return {
      lineName,
      verdict: {
        status: 'unknown',
        message: `rulesets detail field-shy — cannot certify enforcement posture: ${unobserved.join('; ')} (auth-class, §14 clause 2)`,
      },
    };
  }
  return {
    lineName,
    verdict: {
      status: 'pass',
      message: `active-ruleset union == canonical required checks (${canonical.contexts.size}); every contributing ruleset un-bypassable`,
    },
  };
}

/**
 * The enforcement-posture read for one contributing ruleset: OBSERVED problems
 * (real drift → warn) kept separate from UNOBSERVED fields — a field-shy detail
 * is auth-class (§14 clause 2, greptile P1 round 1) and must cap the row at
 * `unknown`, never mint a drift verdict and never fall through to a silent pass.
 */
interface EnforcementRead {
  problems: string[];
  unobserved: string[];
}

function enforcementProblems(
  ruleset: z.infer<typeof RulesetSchema>,
  pinnedStrict?: boolean,
): EnforcementRead {
  const problems: string[] = [];
  const unobserved: string[] = [];
  if (ruleset.enforcement === undefined) unobserved.push('enforcement');
  else if (ruleset.enforcement !== 'active') problems.push(`enforcement=${ruleset.enforcement}`);
  if (ruleset.bypass_actors === undefined) unobserved.push('bypass_actors');
  else if (ruleset.bypass_actors.length > 0) problems.push('bypassable (bypass_actors non-empty)');
  // Row-3 callers omit the pin: protection rulesets are judged on enforcement +
  // bypass only — the strict policy is a required-checks (row-2) concern.
  if (pinnedStrict === undefined) return { problems, unobserved };
  const strict = strictPolicy(ruleset);
  if (strict === undefined) unobserved.push('strict_required_status_checks_policy');
  else if (strict !== pinnedStrict)
    problems.push(`strict_required_status_checks_policy=${strict}≠${pinnedStrict}`);
  return { problems, unobserved };
}

// ── Row 3: repo-branch-protection-posture ──

/**
 * One repo's TWO branch-protection lines — classic branch protection AND the
 * rulesets surface (reading one senses a subset). Classic: PR-required with a
 * ruled `required_approving_review_count=0`, `enforce_admins=true`, force pushes
 * + deletions disallowed. Rulesets: any active ruleset carrying push/PR-class
 * rules for the default branch must be enforcement=active with `bypass_actors=[]`.
 */
function branchProtectionLines(
  contract: ParityContract,
  repo: NetworkProbeRepoSnapshot,
): LockContentLine[] {
  return [classicProtectionLine(contract, repo), rulesetProtectionLine(contract, repo)];
}

/** The classic-branch-protection line (row-3 surface 1). */
function classicProtectionLine(
  contract: ParityContract,
  repo: NetworkProbeRepoSnapshot,
): LockContentLine {
  const lineName = `Parity: ${contract.id} [${repo.repoSlug} · classic]`;
  const surface = repo.surfaces.branchProtection;
  const cannot = surfaceCannotVerify(surface, 'classic branch protection');
  if (cannot !== undefined) return { lineName, verdict: cannot };

  const parsed = BranchProtectionSchema.safeParse(surface?.data);
  if (!parsed.success) {
    // The three toggles are always present in a full admin read; their absence
    // marks an under-privileged 200 → auth-class, never posture-false.
    return {
      lineName,
      verdict: {
        status: 'unknown',
        message:
          'classic branch protection: 200 without the enforce_admins/force-push/deletion toggles — auth-class (§14 clause 2)',
      },
    };
  }
  const p = parsed.data;
  const drift: string[] = [];
  if (p.required_pull_request_reviews === undefined) {
    drift.push('required_pull_request_reviews absent (PR not required — direct-push vector open)');
  } else {
    const count = p.required_pull_request_reviews.required_approving_review_count;
    if (count === undefined) {
      // reviews object present but count field shy → auth-class read.
      return {
        lineName,
        verdict: {
          status: 'unknown',
          message:
            'classic branch protection: reviews object present without required_approving_review_count — auth-class (§14 clause 2)',
        },
      };
    }
    if (count !== 0)
      drift.push(
        `required_approving_review_count=${count}≠0 (ruled posture — nonzero deadlocks the solo-operator merge)`,
      );
  }
  if (p.enforce_admins.enabled !== true) drift.push('enforce_admins≠true');
  if (p.allow_force_pushes.enabled !== false) drift.push('allow_force_pushes≠false');
  if (p.allow_deletions.enabled !== false) drift.push('allow_deletions≠false');

  if (drift.length > 0) {
    return {
      lineName,
      verdict: {
        status: 'warn',
        message: `classic branch protection drifted: ${drift.join(', ')}`,
        remediation:
          'Restore the default-branch protection: PR required with required_approving_review_count=0, enforce_admins on, force pushes + deletions off.',
      },
    };
  }
  return {
    lineName,
    verdict: {
      status: 'pass',
      message: 'PR required (approving-count 0), enforce_admins on, force pushes + deletions off',
    },
  };
}

/** The rulesets-surface line for row-3 (surface 2 — a bypassable protection ruleset must not undercut classic). */
function rulesetProtectionLine(
  contract: ParityContract,
  repo: NetworkProbeRepoSnapshot,
): LockContentLine {
  const lineName = `Parity: ${contract.id} [${repo.repoSlug} · rulesets]`;
  const surface = repo.surfaces.rulesets;
  const cannot = surfaceCannotVerify(surface, 'rulesets');
  if (cannot !== undefined) return { lineName, verdict: cannot };

  const parsed = RulesetsArraySchema.safeParse(surface?.data);
  if (!parsed.success) {
    return {
      lineName,
      verdict: {
        status: 'unknown',
        message: 'rulesets: 200 with an unparseable body — cannot verify (§14 clause 2)',
      },
    };
  }

  const protectionRulesets = parsed.data
    .filter(rulesetTargetsDefault)
    .filter((r) => (r.rules ?? []).some((rule) => PUSH_PR_RULE_TYPES.has(rule.type)));

  const drift: string[] = [];
  const unobserved: string[] = [];
  for (const ruleset of protectionRulesets) {
    const name = ruleset.name ?? String(ruleset.id ?? '(unnamed)');
    const read = enforcementProblems(ruleset);
    if (read.problems.length > 0)
      drift.push(`protection ruleset '${name}' is ${read.problems.join(' / ')}`);
    if (read.unobserved.length > 0)
      unobserved.push(`protection ruleset '${name}' omitted ${read.unobserved.join(', ')}`);
  }

  if (drift.length > 0) {
    return {
      lineName,
      verdict: {
        status: 'warn',
        message: `ruleset protection drifted: ${drift.join('; ')}`,
        remediation:
          'Make every default-branch push/PR ruleset enforcement=active with no bypass actors so it cannot undercut classic protection.',
      },
    };
  }
  // Same precedence as row 2: a field-shy protection ruleset is auth-class —
  // never certified un-bypassable without observing the field (§14 clause 2).
  if (unobserved.length > 0) {
    return {
      lineName,
      verdict: {
        status: 'unknown',
        message: `rulesets detail field-shy — cannot certify protection posture: ${unobserved.join('; ')} (auth-class, §14 clause 2)`,
      },
    };
  }
  return {
    lineName,
    verdict: {
      status: 'pass',
      message:
        protectionRulesets.length === 0
          ? 'no default-branch push/PR ruleset present to undercut classic protection'
          : `${protectionRulesets.length} default-branch push/PR ruleset(s) active + un-bypassable`,
    },
  };
}

// ── Shared ruleset helpers ──

/** True when a ruleset's ref-name conditions target the default branch (and don't exclude it). */
function rulesetTargetsDefault(ruleset: z.infer<typeof RulesetSchema>): boolean {
  const refName = ruleset.conditions?.ref_name;
  if (refName === undefined) return false;
  const include = refName.include ?? [];
  const exclude = refName.exclude ?? [];
  const included = include.some((r) => DEFAULT_BRANCH_INCLUDES.has(r));
  const excluded = exclude.some((r) => DEFAULT_BRANCH_INCLUDES.has(r));
  return included && !excluded;
}

/** The `required_status_checks` contexts a ruleset supplies (empty when it carries no such rule). */
function statusCheckContexts(ruleset: z.infer<typeof RulesetSchema>): string[] {
  const contexts: string[] = [];
  for (const rule of ruleset.rules ?? []) {
    if (rule.type !== 'required_status_checks') continue;
    const params = StatusCheckParamsSchema.safeParse(rule.parameters);
    if (!params.success) continue;
    for (const check of params.data.required_status_checks ?? []) contexts.push(check.context);
  }
  return contexts;
}

/** The `strict_required_status_checks_policy` a ruleset pins, or undefined when it carries no such rule. */
function strictPolicy(ruleset: z.infer<typeof RulesetSchema>): boolean | undefined {
  for (const rule of ruleset.rules ?? []) {
    if (rule.type !== 'required_status_checks') continue;
    const params = StatusCheckParamsSchema.safeParse(rule.parameters);
    if (params.success) return params.data.strict_required_status_checks_policy;
  }
  return undefined;
}

/** Read a file through the injected seam, swallowing a throwing reader to undefined (honest-absent). */
function safeReadFile(
  readFile: (absPath: string) => string | undefined,
  absPath: string,
): string | undefined {
  try {
    return readFile(absPath);
    // totem-context: a throwing injected reader is the honest-absent signal (declaration file unreadable → skip); rethrowing would break the never-throws contract for a routine absence.
  } catch {
    return undefined;
  }
}
