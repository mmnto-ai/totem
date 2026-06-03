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
 *   - **Honest-absent (Tenet 14):** absence is never an error. Pin not declared,
 *     not-a-consumer, floor-unresolvable, or a doctrine pin this slice doesn't
 *     handle → `skip` (the manifest's `-` "cohort permits absence"), never a
 *     fabricated verdict.
 *   - **NEVER networks:** the cohort floor is derived LOCALLY — self-in-tree
 *     (the totem monorepo at the current git root) or a `../totem` sibling
 *     checkout. Neither reachable → honest-absent `skip` with a reason.
 *   - **Side-effect-free / no caching:** every call reads from scratch. Each
 *     filesystem / git seam is injectable so tests drive synthetic fixtures.
 *   - **Never throws:** every read failure degrades to a `skip`/`warn` verdict;
 *     the sensor must never crash the doctor pipeline.
 */

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
 * Core-local per-contract verdict. The CLI maps this to its `DiagnosticResult`
 * (core cannot depend on cli). The detector emits ONLY `pass`/`warn`/`skip` —
 * `fail` is reserved for the CLI's `--strict`/`blocking` promotion edge — but
 * `fail` stays in the union so the CLI mapping is total over the same shape.
 */
export interface ParityContractVerdict {
  status: 'pass' | 'warn' | 'fail' | 'skip';
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
 * Resolve the `@mmnto/*` package name a deps contract pins. Precedence:
 *   1. **canonical-source path locator** — when `canonicalSource` carries a
 *      `:path/to/package.json` segment (e.g. `mmnto-cli-version`'s
 *      `mmnto-ai/totem:packages/cli/package.json#version`), read the `name`
 *      from that package.json under `floorRoot`. Authoritative — no id guess.
 *   2. **id convention** — `mmnto-<x>-version` → `@mmnto/<x>`.
 *
 * Returns `undefined` for ids that don't match the `mmnto-…-version` convention
 * (e.g. `governance-doctrine`, `gate-config`) so ONLY the deps contracts this
 * slice handles resolve a package name; the CLI keeps the rest as `skip` stubs.
 *
 * @param floorRoot Optional root the canonical-source path locator anchors at
 *                  (the resolved cohort-floor repo). Omit when only the id
 *                  convention is wanted.
 */
export function packageNameForContract(
  contract: ParityContract,
  floorRoot?: string,
): string | undefined {
  // ── 1. canonical-source path locator → read `name` from that package.json ──
  if (floorRoot !== undefined) {
    const fromLocator = packageNameFromCanonicalSource(contract.canonicalSource, floorRoot);
    if (fromLocator !== undefined) return fromLocator;
  }

  // ── 2. id convention (mmnto-<x>-version → @mmnto/<x>) ──
  const match = contract.id.match(DEPS_CONTRACT_ID);
  if (match?.[1] === undefined) return undefined;
  return `${MMNTO_SCOPE}${match[1]}`;
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
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(packagesDir, { withFileTypes: true });
    // totem-context: an absent or unreadable packages/ dir is the "not the monorepo here" signal — return undefined so the resolver falls through to the sibling / honest-absent layer rather than throwing.
  } catch {
    return undefined;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgJson = path.join(packagesDir, entry.name, 'package.json');
    const parsed = readPackageJson(pkgJson);
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
  if (contract.consumers !== undefined && ctx.repoId !== undefined) {
    if (!contract.consumers.includes(ctx.repoId)) {
      return {
        status: 'skip',
        message: `cohort permits absence here (${ctx.repoId} not in consumers)`,
      };
    }
  }

  // ── Resolve the package name (id convention + canonical-source locator) ──
  // Pass gitRoot as the floorRoot so a canonical-source path locator
  // (mmnto-cli-version) reads the name from the in-tree package.json.
  const packageName = packageNameForContract(contract, ctx.gitRoot);
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
    return {
      status: 'skip',
      message: `${packageName} not declared in this consumer (cohort permits absence)`,
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
 * Resolve the consumer's installed `@mmnto/*` version, mirroring
 * `resolveEngineVersion`'s require-with-ENOENT-fallback idiom: read
 * `<cwd>/node_modules/<pkg>/package.json#version`; on any read failure fall back
 * to `semver.minVersion(declaredRange)` (the floor the caret range implies).
 * Returns undefined only when neither resolves to a valid version.
 */
function resolveInstalledVersion(
  cwd: string,
  packageName: string,
  declaredRange: string,
): string | undefined {
  const installedPkg = readPackageJson(
    path.join(cwd, 'node_modules', ...packageName.split('/'), 'package.json'),
  );
  if (installedPkg?.version !== undefined && semver.valid(installedPkg.version) !== null) {
    return installedPkg.version;
  }
  // Fallback: the minimum version the declared range admits. `minVersion`
  // returns a SemVer or null; coerce to the bare version string.
  const min = semver.minVersion(declaredRange);
  return min?.version;
}

/** Find the declared range for `packageName` across the three dep fields, in order. */
function findDeclaredRange(pkg: PackageJsonShape, packageName: string): string | undefined {
  for (const field of DEP_FIELDS) {
    const section = pkg[field];
    if (section && typeof section === 'object') {
      const range = section[packageName];
      if (typeof range === 'string' && range.trim().length > 0) return range;
    }
  }
  return undefined;
}

// ─── Shared filesystem helpers ──────────────────────────

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
