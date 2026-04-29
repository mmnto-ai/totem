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
 * are returned as-is; relative values anchor at the supplied base
 * (`gitRoot ?? cwd`) via `path.join` so that an absolute user-provided
 * value doesn't override the anchor (which `path.resolve` would).
 */
function resolveValue(raw: string, anchor: string): string {
  const trimmed = raw.trim();
  if (path.isAbsolute(trimmed)) return path.normalize(trimmed);
  return path.normalize(path.join(anchor, trimmed));
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
 */
export function resolveStrategyRoot(
  cwd: string,
  options: StrategyResolverOptions = {},
): StrategyRootStatus {
  const env = options.env ?? process.env;
  const gitRoot = options.gitRoot !== undefined ? options.gitRoot : resolveGitRoot(cwd);
  const config = options.config;
  // Unified anchor — gitRoot when available, cwd otherwise. The cwd fallback
  // matches the design spec's "Missing git context" trap and lets relative
  // env / config / sibling / submodule layers resolve in non-git contexts
  // (e.g., a one-off script outside a checkout). Downstream consumers
  // validate the resolved path and fail loudly if the cwd-anchored result
  // isn't viable.
  const anchor = gitRoot ?? cwd;

  // Layer 1 — env var
  const envValue = readEnvValue(env);
  if (envValue !== undefined) {
    const resolved = resolveValue(envValue, anchor);
    if (isDirectory(resolved)) {
      return { resolved: true, path: resolved, source: 'env' };
    }
  }

  // Layer 2 — config field
  if (config?.strategyRoot !== undefined && config.strategyRoot.trim().length > 0) {
    const resolved = resolveValue(config.strategyRoot, anchor);
    if (isDirectory(resolved)) {
      return { resolved: true, path: resolved, source: 'config' };
    }
  }

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
