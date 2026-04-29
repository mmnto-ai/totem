/**
 * Strategy-root resolver (mmnto-ai/totem#1710).
 *
 * Single source of truth for "where is the strategy repo on disk." Replaces
 * the hardcoded `.strategy/` submodule path with a configurable resolver that
 * checks four precedence layers:
 *
 *   1. **env** — `TOTEM_STRATEGY_ROOT` (canonical) or `STRATEGY_ROOT` (alias).
 *   2. **config** — `TotemConfig.strategyRoot`.
 *   3. **sibling** — `<gitRoot>/../totem-strategy`.
 *   4. **submodule** — `<gitRoot>/.strategy`.
 *
 * Each layer must resolve to a real directory (`fs.statSync(...).isDirectory()`)
 * before it counts; a value that points at a file or a missing path falls
 * through to the next layer. Returns a `StrategyRootStatus` discriminated
 * union so callers can pattern-match on `resolved` without a TS-side type
 * assertion.
 *
 * Anchors relative env / config values at `gitRoot`, not at the literal cwd —
 * a deep cwd like `packages/mcp/src/` with `STRATEGY_ROOT=../totem-strategy`
 * would otherwise resolve to `packages/mcp/totem-strategy`, which is wrong.
 *
 * Pure utility. No caching, no side effects, no logging. Each call walks the
 * precedence chain from scratch so a process that mutates `process.env` mid-run
 * sees the new value on the next call.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { resolveGitRoot } from './sys/git.js';

/**
 * Discriminated union. The `resolved: true` branch carries an absolute `path`
 * and a `source` tag so callers can route per-layer (e.g., the `submodule`
 * source is the legacy path that the gitlink-removal follow-up will retire).
 * The `resolved: false` branch carries a `reason` string suitable for
 * surfacing to agents and for the `totem doctor` advisory.
 */
export type StrategyRootStatus =
  | {
      resolved: true;
      path: string;
      source: 'env' | 'config' | 'sibling' | 'submodule';
    }
  | { resolved: false; reason: string };

/**
 * Minimal config shape consumed by the resolver. Avoids importing the full
 * `TotemConfig` type to keep the resolver dependency-light and to let
 * callers pass partial config objects (e.g., during init or in tests).
 */
export interface StrategyResolverConfig {
  strategyRoot?: string;
}

export interface StrategyResolverOptions {
  /** Test seam — production callers omit and the resolver invokes `resolveGitRoot(cwd)` itself. */
  gitRoot?: string | null;
  /** Test seam — production callers omit and the resolver reads `process.env`. */
  env?: Record<string, string | undefined>;
  /** Loaded `totem.config.ts` shape (only `strategyRoot` is read). */
  config?: StrategyResolverConfig;
}

const ENV_PRIMARY = 'TOTEM_STRATEGY_ROOT';
const ENV_ALIAS = 'STRATEGY_ROOT';
const SIBLING_DIRNAME = 'totem-strategy';
const SUBMODULE_DIRNAME = '.strategy';

/**
 * Read the canonical env var, falling back to the legacy alias. Whitespace-only
 * values are treated as unset so a `STRATEGY_ROOT="   "` accident does not
 * short-circuit the precedence chain.
 */
function readEnvValue(env: Record<string, string | undefined>): string | undefined {
  const primary = env[ENV_PRIMARY];
  if (typeof primary === 'string' && primary.trim().length > 0) return primary;
  const alias = env[ENV_ALIAS];
  if (typeof alias === 'string' && alias.trim().length > 0) return alias;
  return undefined;
}

/**
 * Resolve a raw value (env or config) to an absolute path. Absolute values
 * are returned as-is and bypass the anchor; relative values anchor at the
 * lazily-evaluated base (`anchorThunk()`) via `path.join` so that an
 * absolute user-provided value doesn't override the anchor (which
 * `path.resolve` would). The thunk lets the resolver defer the
 * `resolveGitRoot` probe until the relative path actually needs it.
 */
function resolveValue(raw: string, anchorThunk: () => string): string {
  const trimmed = raw.trim();
  if (path.isAbsolute(trimmed)) return path.normalize(trimmed);
  return path.normalize(path.join(anchorThunk(), trimmed));
}

/**
 * `fs.statSync` raises on missing paths and on EACCES/ENOTDIR; treat any
 * stat failure as "not a directory" and let the resolver fall through to
 * the next layer.
 */
function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
    // totem-context: intentional fall-through — stat failures (ENOENT, EACCES, ENOTDIR) are the precedence-chain "miss" signal; rethrowing would force every consumer to wrap the resolver in try/catch for a routine outcome.
  } catch {
    return false;
  }
}

/**
 * Walk the four-layer precedence chain. Returns a `StrategyRootStatus`
 * discriminated union.
 *
 * The git-root probe is lazy. `resolveGitRoot` can throw `TotemGitError` on
 * permission errors or a corrupted index; an eager probe would short-circuit
 * an absolute env / config override that doesn't need git context at all.
 * `getAnchor` defers the probe and swallows throws, so absolute overrides
 * always get their precedence-1 / precedence-2 chance.
 */
export function resolveStrategyRoot(
  cwd: string,
  options: StrategyResolverOptions = {},
): StrategyRootStatus {
  const env = options.env ?? process.env;
  const config = options.config;

  let cachedAnchor: string | undefined;
  const getAnchor = (): string => {
    if (cachedAnchor !== undefined) return cachedAnchor;
    let gitRoot: string | null;
    if (options.gitRoot !== undefined) {
      gitRoot = options.gitRoot;
    } else {
      try {
        gitRoot = resolveGitRoot(cwd);
        // totem-context: intentional fall-through — resolveGitRoot throws on permission errors / corrupted index; fall back to cwd so absolute overrides and downstream consumers (governance throw, doctor warn, MCP unresolved payload) handle the wrong-path case explicitly.
      } catch {
        gitRoot = null;
      }
    }
    cachedAnchor = gitRoot ?? cwd;
    return cachedAnchor;
  };

  // Layer 1 — env var. Absolute values bypass the anchor probe entirely
  // (resolveValue's `path.isAbsolute` short-circuits before calling the thunk).
  const envValue = readEnvValue(env);
  if (envValue !== undefined) {
    const resolved = resolveValue(envValue, getAnchor);
    if (isDirectory(resolved)) {
      return { resolved: true, path: resolved, source: 'env' };
    }
  }

  // Layer 2 — config field. Same absolute-bypass behavior. The
  // `typeof string` guard is load-bearing: `resolveStrategyRoot` is
  // exported, and a JS caller (or unsafe cast) could pass a non-string
  // `strategyRoot` that would crash `.trim()` with `TypeError`. Treating
  // a non-string as "unset" preserves the discriminated-union contract.
  if (typeof config?.strategyRoot === 'string' && config.strategyRoot.trim().length > 0) {
    const resolved = resolveValue(config.strategyRoot, getAnchor);
    if (isDirectory(resolved)) {
      return { resolved: true, path: resolved, source: 'config' };
    }
  }

  // Layers 3 + 4 require an anchor — sibling and submodule are both relative
  // to the anchor by construction.
  const anchor = getAnchor();

  // Layer 3 — sibling at <anchor>/../totem-strategy
  const sibling = path.normalize(path.join(anchor, '..', SIBLING_DIRNAME));
  if (isDirectory(sibling)) {
    return { resolved: true, path: sibling, source: 'sibling' };
  }

  // Layer 4 — submodule at <anchor>/.strategy (legacy path; kept until
  // the gitlink-removal follow-up retires `.gitmodules`).
  const submodule = path.normalize(path.join(anchor, SUBMODULE_DIRNAME));
  if (isDirectory(submodule)) {
    return { resolved: true, path: submodule, source: 'submodule' };
  }

  return {
    resolved: false,
    reason: `No strategy root resolvable. Tried env (${ENV_PRIMARY} / ${ENV_ALIAS}), config.strategyRoot, sibling ${sibling}, and submodule ${submodule}. Clone the strategy repo as a sibling or set ${ENV_PRIMARY}.`,
  };
}
