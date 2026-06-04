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
 *     (the totem monorepo at the current git root) or a `../totem` sibling
 *     checkout. Neither reachable → honest-absent `skip` with a reason.
 *   - **Side-effect-free / no caching:** every call reads from scratch. Each
 *     filesystem / git seam is injectable so tests drive synthetic fixtures.
 *   - **Never throws:** every read failure degrades to a `skip`/`warn` verdict;
 *     the sensor must never crash the doctor pipeline.
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import semver from 'semver';

import type { ParityContract } from './parity-manifest.js';
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
  | { resolved: true; version: string; source: 'self-in-tree' | 'sibling' }
  | { resolved: false; reason: string };

/**
 * Resolve the "current published version" cohort floor for `packageName`,
 * derived LOCALLY (NEVER networks), in precedence order:
 *   (a) **self-in-tree** — the current git root IS the canonical-source repo
 *       (the totem monorepo): glob `<gitRoot>/packages/*​/package.json`, find
 *       the one whose `name === packageName`, read its `version`.
 *   (b) **sibling** — `<gitRoot>/../totem` exists as a directory: glob its
 *       `packages/*​/package.json` the same way.
 *   (c) **honest-absent** — neither reachable → `{ resolved: false, reason }`.
 *
 * NEVER fabricates a floor and NEVER fetches. Anchors at `gitRoot`, not cwd
 * (mirroring `strategy-resolver.ts`). Read failures within the glob are
 * swallowed per-file so one corrupt package.json can't crash the resolver.
 *
 * The floor is keyed structurally on `packageName` (the matching
 * `packages/*​/package.json` `name`), NOT on the consumer's cohort id — a
 * misderived repoId can't mask a genuine in-tree floor.
 */
export function resolveCohortFloor(packageName: string, gitRoot: string): CohortFloorStatus {
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

  // ── (c) honest-absent ──
  return {
    resolved: false,
    reason: `cohort floor for ${packageName} not locally determinable; clone mmnto-ai/totem as a sibling (../${SIBLING_TOTEM_DIRNAME}) or run from the totem monorepo`,
  };
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
  const installed = resolveInstalledVersion(ctx.cwd, packageName, declaredRange);
  if (installed === undefined) {
    return {
      status: 'skip',
      message: `${packageName} pinned (${declaredRange}) but no resolvable installed version`,
    };
  }

  // ── Resolve the cohort floor (local-only; honest-absent on miss) ──
  const floor = resolveCohortFloor(packageName, ctx.gitRoot);
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
    return {
      status: 'pass',
      message: `${packageName} pin current — installed ${installed} ≥ cohort floor ${floor.version} (${floor.source})`,
    };
  }

  return {
    status: 'warn',
    message: `${packageName} pin stale — declared ${declaredRange}, installed ${installed} < cohort floor ${floor.version} (${floor.source})`,
    remediation: `Bump the ${packageName} dependency to >= ${floor.version} and reinstall, then re-run totem doctor --parity.`,
  };
}

/**
 * Resolve the consumer's installed `@mmnto/*` version. Walks UP the directory
 * tree from `cwd` reading `<dir>/node_modules/<pkg>/package.json#version` at each
 * ancestor — monorepo / pnpm / npm-workspace installs hoist deps to a parent or
 * root `node_modules` rather than the sub-package's, so a cwd-only read would
 * miss them (GCA review #2071). Mirrors Node's own upward node_modules
 * resolution. On no hit, falls back to `semver.minVersion(declaredRange)` (the
 * floor the caret range implies). Returns undefined only when neither resolves
 * to a valid version.
 */
function resolveInstalledVersion(
  cwd: string,
  packageName: string,
  declaredRange: string,
): string | undefined {
  const segments = packageName.split('/');
  let dir = path.resolve(cwd);
  for (;;) {
    const installedPkg = readPackageJson(
      path.join(dir, 'node_modules', ...segments, 'package.json'),
    );
    if (installedPkg?.version !== undefined && semver.valid(installedPkg.version) !== null) {
      return installedPkg.version;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached the filesystem root
    dir = parent;
  }
  // Fallback: the minimum version the declared range admits. `minVersion`
  // returns a SemVer or null; coerce to the bare version string.
  const min = semver.minVersion(declaredRange);
  return min?.version;
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
   * OPTIONAL local attestation date (ISO-8601). Absent today — the manifest schema
   * has no `last-attested:` field yet; strategy owns that follow-on (#2073 design
   * 2045Z). RESERVED seam so date-staleness is a clean drop-in: when a date lands
   * the message reports it, but the VERDICT stays `info` regardless — staleness is
   * a message refinement, NEVER a status change (manual-attestation never warns).
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

  // The last-attested suffix: a date if one was supplied (the reserved seam — the
  // manifest has no `last-attested:` field yet), else the honest "not recorded".
  // NEVER fabricated; a present date refines the MESSAGE, never the status.
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
  const installed =
    semver.validRange(declaredRange) !== null
      ? resolveInstalledVersion(ctx.cwd, pkg, declaredRange)
      : undefined;
  const installedText =
    installed !== undefined ? `installed ${installed}` : 'installed: unresolved';

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
  return (
    (fork.attested !== undefined ? `, attested ${fork.attested}` : '') +
    (fork.owner !== undefined ? `, owner ${fork.owner}` : '')
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
 * Whether a hook is a totem-OWNED whole file (generated verbatim by `build*Hook`)
 * rather than a totem block APPENDED into a pre-existing user hook. A generated
 * hook is `#!/bin/sh\n# <marker> …`, so the only content before the marker is the
 * shebang line plus the start of its comment; an appended hook carries the user's
 * prior hook content there.
 */
function isOwnedGeneratedFile(content: string, marker: string): boolean {
  const idx = content.indexOf(marker);
  if (idx === -1) return false;
  return /^#![^\n]*\n#[ \t]*$/.test(content.slice(0, idx));
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

  // ── Canonical unregenerable → unknown (Stale-Doctor-Paradox guard) ──
  if (ctx.canonicalContent === undefined) {
    return {
      status: 'unknown',
      message: tag(
        'cannot regenerate canonical hook from the running @mmnto/cli — verdict unprovable',
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
      message: `git hook not installed at ${ctx.consumerPath} — cohort permits absence`,
      remediation:
        'Run totem hook install to install the managed git hooks, or ignore if this repo intentionally omits them.',
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
          'cannot resolve the canonical hook region (end marker absent in the regenerated template) — verdict unprovable',
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
        remediation:
          'Re-run totem hook install to regenerate the managed block, or add a totem:fork marker if the divergence is intentional.',
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
      remediation:
        'Re-run totem hook install to regenerate the hook from the current @mmnto/cli, or add a totem:fork marker if the divergence is intentional.',
    };
  }

  // ── Totem block appended inside a user-modified hook with no end marker to ──
  // isolate it: can prove neither drift nor currency → unknown (claim-class-tight).
  if (fork !== undefined) {
    return {
      status: 'info',
      message: tag(
        `intentional fork${formatForkMeta(fork)} — totem block embedded in a user-modified hook (${ctx.consumerPath})`,
      ),
    };
  }
  return {
    status: 'unknown',
    message: tag(
      `totem block embedded in a user-modified hook at ${ctx.consumerPath} — cannot isolate it for comparison`,
    ),
    remediation:
      'Re-run totem hook install (or adopt a hook manager) so the managed block can be verified independently.',
  };
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
