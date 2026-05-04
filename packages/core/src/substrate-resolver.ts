/**
 * Substrate-path resolver (mmnto-ai/totem#1820, ADR-100 Phase C).
 *
 * Single source of truth for "where are the substrate `.handoff/` and
 * `.journal/` directories on disk." After ADR-100, both directories live
 * in a sibling `mmnto-ai/totem-substrate` repo; the original in-repo paths
 * are sediment-frozen per ADR-100 Q7C and serve as fallback during the
 * sediment window.
 *
 * Resolution walks four precedence layers:
 *
 *   1. **env** — `TOTEM_SUBSTRATE_PATH`.
 *   2. **config** — `TotemConfig.substratePath`.
 *   3. **sibling-walk** — walk up to 3 levels from `configRoot` looking for
 *      `<parent>/totem-substrate/`.
 *   4. **repo-local sediment** — `<configRoot>/.handoff/` and
 *      `<configRoot>/.journal/`.
 *
 * Layers 1-3 require full substrate shape (a git metadata subdir plus
 * `.handoff/` and `.journal/` subdirs) to gate against stale empty
 * clones. Layer 4 (sediment) accepts partial state — `.handoff/` alone
 * OR `.journal/` alone is valid and returns the populated dir with the
 * missing one as null.
 *
 * Returns a `SubstratePaths` record whose `source` field discriminates
 * the resolution outcome. ADR-090 graceful degradation: if all four
 * layers fail, returns `{ handoffRoot: null, journalRoot: null,
 * source: 'none' }`. Consumers handle null per their existing contract.
 *
 * Pure utility. No caching, no side effects, no logging — same stance as
 * `resolveStrategyRoot` (PR mmnto-ai/totem#1743). Each call walks the chain
 * from scratch so a process that mutates `process.env` mid-run sees the
 * new value next call.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { resolveGitRoot } from './sys/git.js';

/**
 * Resolved substrate path triple. Non-null path values are absolute.
 *
 * - `source: 'substrate'` ⟹ both paths populated; layers 1-3 resolved.
 * - `source: 'repo-local'` ⟹ at least one path populated; layer 4 fallback.
 * - `source: 'none'` ⟹ both paths null; all layers failed.
 */
export interface SubstratePaths {
  handoffRoot: string | null;
  journalRoot: string | null;
  source: 'substrate' | 'repo-local' | 'none';
}

/**
 * Minimal config shape consumed by the resolver. Avoids importing the full
 * `TotemConfig` type to keep this module dependency-light and to let
 * callers pass partial config objects (e.g., during init or in tests).
 */
export interface SubstrateResolverConfig {
  substratePath?: string;
}

export interface SubstrateResolverOptions {
  /** Test seam — production callers omit and the resolver reads `process.env`. */
  env?: Record<string, string | undefined>;
  /** Loaded `totem.config.ts` shape (only `substratePath` is read). */
  config?: SubstrateResolverConfig;
  /** Test seam — production callers omit and the resolver invokes `resolveGitRoot(configRoot)` itself. Mirrors `StrategyResolverOptions.gitRoot`. */
  gitRoot?: string | null;
}

const ENV_VAR = 'TOTEM_SUBSTRATE_PATH';
const SIBLING_DIRNAME = 'totem-substrate';
const SIBLING_WALK_MAX_DEPTH = 3;

/**
 * Substrate shape predicate — a directory qualifies as a real substrate
 * clone only when it carries the git metadata subdir AND both the
 * handoff and journal subdirs. Used by layers 1-3 (env, config,
 * sibling-walk) to reject stale empty directories that would otherwise
 * satisfy a plain `isDirectory` check.
 *
 * Layer 4 (repo-local sediment) does NOT use this — sediment lives
 * inside the product repo so the nested git metadata isn't there.
 */
function validateSubstrateShape(dir: string): boolean {
  // totem-context: shape gate (substrate clone detection), not a gitRoot probe — the rule that flags raw git-metadata-dir checks is targeted at resolveGitRoot-style probing, not clone-shape detection.
  // `fs.existsSync` (not `isDirectory`) handles submodule + linked-worktree
  // setups where the git metadata path is a pointer file rather than a
  // directory. Per GCA review on mmnto-ai/totem#1821.
  return (
    fs.existsSync(path.join(dir, '.git')) && // totem-context: shape gate, not gitRoot probe; submodule/worktree compat.
    isDirectory(path.join(dir, '.handoff')) &&
    isDirectory(path.join(dir, '.journal'))
  );
}

/**
 * `fs.statSync` raises on missing paths and on EACCES/ENOTDIR; treat any
 * stat failure as "not a directory" and let the resolver fall through to
 * the next layer. Matches the `resolveStrategyRoot` pattern.
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
 * Read `TOTEM_SUBSTRATE_PATH` from the env map. Whitespace-only values
 * are treated as unset so a `TOTEM_SUBSTRATE_PATH="   "` accident does
 * not short-circuit the precedence chain.
 */
function readEnvValue(env: Record<string, string | undefined>): string | undefined {
  const raw = env[ENV_VAR];
  if (typeof raw === 'string' && raw.trim().length > 0) return raw;
  return undefined;
}

/**
 * Resolve a raw value (env or config) to an absolute path anchored at
 * `configRoot`. Absolute values are returned normalized as-is; relative
 * values are joined against the anchor. Mirrors `resolveStrategyRoot`'s
 * `resolveValue` pattern.
 */
function resolveValue(raw: string, anchor: string): string {
  const trimmed = raw.trim();
  if (path.isAbsolute(trimmed)) return path.normalize(trimmed);
  return path.normalize(path.join(anchor, trimmed));
}

/**
 * Build the substrate-shaped `SubstratePaths` record for a resolved
 * substrate directory. Both paths populated; source is 'substrate'.
 */
function substrateResult(dir: string): SubstratePaths {
  return {
    handoffRoot: path.normalize(path.join(dir, '.handoff')),
    journalRoot: path.normalize(path.join(dir, '.journal')),
    source: 'substrate',
  };
}

/**
 * Walk the four-layer precedence chain. Returns a `SubstratePaths` record
 * whose `source` discriminates the resolution outcome.
 *
 * Layer order: env → config → sibling-walk (up to 3 levels from
 * `configRoot`) → repo-local sediment (`<configRoot>/.handoff/` and
 * `<configRoot>/.journal/`).
 *
 * @param configRoot Anchor for relative env / config values and start
 *   of the sibling-walk. Typically the directory containing
 *   `totem.config.ts` (the project root).
 */
export function resolveSubstratePaths(
  configRoot: string,
  options: SubstrateResolverOptions = {},
): SubstratePaths {
  const env = options.env ?? process.env;
  const config = options.config;

  // Anchor resolution mirrors `resolveStrategyRoot` (PR mmnto-ai/totem#1743).
  // Lazy `resolveGitRoot` probe lets monorepo subpackage callers anchor at
  // the actual repo root for sibling-walk; falls back to `path.resolve` for
  // non-git callers (tests, fresh clones with no git metadata, etc.). The
  // `path.resolve` fallback handles the relative-`configRoot` case
  // (`path.dirname('.') === '.'` breaks the walk loop unless absolutized).
  let cachedAnchor: string | undefined;
  const getAnchor = (): string => {
    if (cachedAnchor !== undefined) return cachedAnchor;
    let gitRoot: string | null;
    if (options.gitRoot !== undefined) {
      gitRoot = options.gitRoot;
    } else {
      try {
        gitRoot = resolveGitRoot(configRoot);
        // totem-context: intentional fall-through — resolveGitRoot throws on permission errors / corrupted index; fall back to absolutized configRoot so the precedence chain still completes.
      } catch {
        gitRoot = null;
      }
    }
    cachedAnchor = gitRoot ?? path.resolve(configRoot);
    return cachedAnchor;
  };
  const anchor = getAnchor();

  // Layer 1 — env var. Validate substrate shape; fall through on shape miss.
  const envValue = readEnvValue(env);
  if (envValue !== undefined) {
    const candidate = resolveValue(envValue, anchor);
    if (validateSubstrateShape(candidate)) {
      return substrateResult(candidate);
    }
  }

  // Layer 2 — config field. The `typeof string` guard is load-bearing:
  // a JS caller (or unsafe cast) could pass a non-string `substratePath`
  // that would crash `.trim()` with `TypeError`. Treating non-string as
  // unset preserves the contract. Mirrors `resolveStrategyRoot`.
  if (typeof config?.substratePath === 'string' && config.substratePath.trim().length > 0) {
    const candidate = resolveValue(config.substratePath, anchor);
    if (validateSubstrateShape(candidate)) {
      return substrateResult(candidate);
    }
  }

  // Layer 3 — sibling-walk. Walk up to SIBLING_WALK_MAX_DEPTH levels
  // from the anchor looking for `<parent>/totem-substrate/`. Cap
  // protects against pathological resolution when configRoot is
  // accidentally a deep subpath.
  let walkAnchor = anchor;
  for (let i = 0; i < SIBLING_WALK_MAX_DEPTH; i++) {
    const parent = path.dirname(walkAnchor);
    // path.dirname returns the path itself at filesystem root; break to
    // avoid an infinite loop if SIBLING_WALK_MAX_DEPTH outruns the
    // tree depth.
    if (parent === walkAnchor) break;
    const candidate = path.normalize(path.join(parent, SIBLING_DIRNAME));
    if (validateSubstrateShape(candidate)) {
      return substrateResult(candidate);
    }
    walkAnchor = parent;
  }

  // Layer 4 — repo-local sediment. Per-directory presence: either
  // `.handoff/` alone OR `.journal/` alone is a valid partial sediment
  // result; consumer reads non-null only. The Phase B cutover left
  // both as `.gitkeep`-only frozen markers in the product repos, so
  // existence-of-directory (not existence-of-content) is the right
  // gate here — matches `isDirectory`'s semantic on layers 1-3.
  const localHandoff = path.normalize(path.join(anchor, '.handoff'));
  const localJournal = path.normalize(path.join(anchor, '.journal'));
  const handoffExists = isDirectory(localHandoff);
  const journalExists = isDirectory(localJournal);
  // totem-context: boolean-or for presence check; nullish-coalescing rule is targeted at numeric-metric defaults, not booleans.
  if (handoffExists || journalExists) {
    return {
      handoffRoot: handoffExists ? localHandoff : null,
      journalRoot: journalExists ? localJournal : null,
      source: 'repo-local',
    };
  }

  // All four layers failed — graceful degradation per ADR-090.
  return { handoffRoot: null, journalRoot: null, source: 'none' };
}
