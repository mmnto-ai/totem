/**
 * Tests for the version-pinned parity drift detector (PR-1,
 * mmnto-ai/totem#2069 on top of skeleton #2070).
 *
 * The detector is pure + side-effect-free: every filesystem / git seam is
 * injectable so these tests drive it against synthetic fixtures, NOT the live
 * cohort. Each invariant from the spec's "Invariants to lock via tests" list
 * gets a case: pass / warn / fail-under-blocking+strict (the fail-promotion is a
 * CLI-edge concern — the detector itself only ever returns warn here) / skip on
 * not-declared / skip on not-a-consumer / skip on floor-unresolved /
 * no-throw-on-read-failure / never-networks / claim-class-bound (pin currency
 * only, never content equality).
 *
 * Mirrors the temp-file + discriminated-union style of `parity-manifest.test.ts`
 * and the injected-seam style of `strategy-resolver.test.ts`.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TotemConfigError } from './errors.js';
import {
  deriveCohortRepoId,
  detectCapabilityProbeContract,
  detectDeclaredContract,
  type DetectGeneratedArtifactContext,
  detectGeneratedArtifactContract,
  type DetectManualAttestationContext,
  detectManualAttestationContract,
  type DetectMechanicalContext,
  detectMechanicalContract,
  detectValueEqualityContract,
  type DetectVersionPinnedContext,
  detectVersionPinnedContract,
  extractManagedBlock,
  hashManagedBlock,
  normalizeManagedBlock,
  type PackageJsonShape,
  packageNameForContract,
  parseDeclarationMarker,
  parseForkMarker,
  resolveCohortFloor,
  type ValueEqualityField,
} from './parity-detect.js';
import type { ParityContract } from './parity-manifest.js';
import { cleanTmpDir } from './test-utils.js';

let tmpRoot: string;

// Strategy-root env vars resolveCohortFloor's canonical-source probe honors
// (via resolveStrategyRoot). Neutralized per-test so the floor probe stays
// fixture-driven and never resolves a real ../totem-strategy on the dev/CI box
// (mmnto-ai/totem#2108).
const STRATEGY_ENV_VARS = ['TOTEM_STRATEGY_ROOT', 'STRATEGY_ROOT'] as const;
let savedStrategyEnv: Record<string, string | undefined>;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-parity-detect-'));
  savedStrategyEnv = {};
  for (const key of STRATEGY_ENV_VARS) {
    savedStrategyEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  cleanTmpDir(tmpRoot);
  for (const key of STRATEGY_ENV_VARS) {
    if (savedStrategyEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedStrategyEnv[key];
  }
});

// ─── Fixture builders ───────────────────────────────────

/** Build a minimal version-pinned deps contract for one of the 4 PR-1 ids. */
function depsContract(over: Partial<ParityContract> = {}): ParityContract {
  return {
    id: 'mmnto-totem-version',
    dimension: 'dependency-cohort',
    canonicalSource: 'mmnto-ai/totem',
    detectionMethod: 'consumer package.json caret range + resolved install vs floor',
    expectedValueOrDerivation: 'consumer pin resolves to the current published @mmnto/totem',
    tractability: 'version-pinned',
    trackingIssue: 'mmnto-ai/totem-strategy#482',
    ...over,
  };
}

/** Write a `packages/<dir>/package.json` with the given name + version. */
function writePackage(rootDir: string, dir: string, name: string, version: string): void {
  const pkgDir = path.join(rootDir, 'packages', dir);
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name, version }, null, 2),
    'utf-8',
  );
}

/**
 * Write a self-in-tree totem monorepo at `rootDir` carrying `@mmnto/totem` at
 * `version`, plus a marker package so the glob has more than one entry.
 */
function writeSelfInTree(rootDir: string, version: string): void {
  writePackage(rootDir, 'totem', '@mmnto/totem', version);
  writePackage(rootDir, 'cli', '@mmnto/cli', version);
}

/**
 * Write a `<parent>/totem-strategy` sibling carrying `@mmnto/strategy-doctrine`
 * at `version` — the canonical-source repo `resolveCohortFloor` probes for a
 * strategy-published package (mmnto-ai/totem#2108).
 */
function writeStrategySibling(parentDir: string, version: string): void {
  const stratRoot = path.join(parentDir, 'totem-strategy');
  writePackage(stratRoot, 'strategy-doctrine', '@mmnto/strategy-doctrine', version);
}

/** A `canonicalSource` that names the totem-strategy repo + its package.json path. */
const STRATEGY_DOCTRINE_CANONICAL =
  'mmnto-ai/totem-strategy:packages/strategy-doctrine/package.json#version';

/** Build a base context with all seams pointed at the temp consumer repo. */
function baseCtx(over: Partial<DetectVersionPinnedContext> = {}): DetectVersionPinnedContext {
  return {
    cwd: tmpRoot,
    gitRoot: tmpRoot,
    repoId: 'totem-status',
    ...over,
  };
}

/** Write the consumer's package.json declaring `name` in `dependencies`. */
function writeConsumerPkg(
  rootDir: string,
  deps: Record<string, string>,
  field: 'dependencies' | 'devDependencies' | 'optionalDependencies' = 'dependencies',
): void {
  fs.writeFileSync(
    path.join(rootDir, 'package.json'),
    JSON.stringify({ name: 'consumer-repo', [field]: deps }, null, 2),
    'utf-8',
  );
}

/** Write `node_modules/<pkg>/package.json#version` so install resolution wins. */
function writeInstalled(rootDir: string, pkg: string, version: string): void {
  const dir = path.join(rootDir, 'node_modules', ...pkg.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: pkg, version }, null, 2),
    'utf-8',
  );
}

// ─── packageNameForContract ─────────────────────────────

describe('packageNameForContract', () => {
  it('derives @mmnto/<x> from an `mmnto-<x>-version` id with no path locator', () => {
    expect(packageNameForContract(depsContract({ id: 'mmnto-totem-version' }))).toBe(
      '@mmnto/totem',
    );
    expect(packageNameForContract(depsContract({ id: 'mmnto-mcp-version' }))).toBe('@mmnto/mcp');
    expect(packageNameForContract(depsContract({ id: 'mmnto-cli-version' }))).toBe('@mmnto/cli');
    expect(
      packageNameForContract(depsContract({ id: 'mmnto-pack-rust-architecture-version' })),
    ).toBe('@mmnto/pack-rust-architecture');
  });

  it('prefers the canonical-source package.json `name` when a path locator is present', () => {
    writePackage(tmpRoot, 'cli', '@mmnto/cli', '1.0.0');
    const contract = depsContract({
      id: 'mmnto-cli-version',
      canonicalSource: 'mmnto-ai/totem:packages/cli/package.json#version',
    });
    expect(packageNameForContract(contract, tmpRoot)).toBe('@mmnto/cli');
  });

  it('returns undefined for ids that are not deps-version contracts', () => {
    expect(packageNameForContract(depsContract({ id: 'governance-doctrine' }))).toBeUndefined();
    expect(packageNameForContract(depsContract({ id: 'agent-memory-doctrine' }))).toBeUndefined();
    expect(packageNameForContract(depsContract({ id: 'gate-config' }))).toBeUndefined();
  });

  it('prefers an explicit package: field over the id convention (derive-not-guess, strategy#517)', () => {
    // Vendor name + a non-conventional id: only the package: field can resolve it.
    expect(
      packageNameForContract(
        depsContract({ id: 'google-genai-coupling', package: '@google/genai' }),
      ),
    ).toBe('@google/genai');
    // package: wins even when the id convention WOULD match (no silent divergence).
    expect(
      packageNameForContract(depsContract({ id: 'mmnto-totem-version', package: '@mmnto/totem' })),
    ).toBe('@mmnto/totem');
  });
});

// ─── deriveCohortRepoId ─────────────────────────────────

describe('deriveCohortRepoId', () => {
  it('extracts <name> from an mmnto-ai/<name> git origin remote (ssh + https, .git suffix)', () => {
    expect(
      deriveCohortRepoId(tmpRoot, { remoteUrl: 'git@github.com:mmnto-ai/totem-status.git' }),
    ).toBe('totem-status');
    expect(
      deriveCohortRepoId(tmpRoot, { remoteUrl: 'https://github.com/mmnto-ai/totem.git' }),
    ).toBe('totem');
    expect(
      deriveCohortRepoId(tmpRoot, { remoteUrl: 'https://github.com/mmnto-ai/liquid-city' }),
    ).toBe('liquid-city');
  });

  it('falls back to package.json name basename (scope stripped) when no remote', () => {
    writeConsumerPkg(tmpRoot, {});
    fs.writeFileSync(
      path.join(tmpRoot, 'package.json'),
      JSON.stringify({ name: '@mmnto/totem-status' }, null, 2),
      'utf-8',
    );
    expect(deriveCohortRepoId(tmpRoot, { remoteUrl: undefined, gitRoot: tmpRoot })).toBe(
      'totem-status',
    );
  });

  it('falls back to the git-root dir basename when neither remote nor package name resolve', () => {
    const named = path.join(tmpRoot, 'my-cohort-repo');
    fs.mkdirSync(named, { recursive: true });
    expect(deriveCohortRepoId(named, { remoteUrl: undefined, gitRoot: named })).toBe(
      'my-cohort-repo',
    );
  });

  it('never networks / never throws on a git failure (returns a fallback or undefined)', () => {
    // A remote-reader that throws must not propagate — the helper degrades.
    expect(() =>
      deriveCohortRepoId(tmpRoot, {
        readRemote: () => {
          throw new Error('git exploded');
        },
        gitRoot: tmpRoot,
      }),
    ).not.toThrow();
  });
});

// ─── resolveCohortFloor ─────────────────────────────────

describe('resolveCohortFloor', () => {
  it('resolves self-in-tree when the current git root IS the canonical-source repo', () => {
    writeSelfInTree(tmpRoot, '1.53.3');
    const result = resolveCohortFloor('@mmnto/totem', tmpRoot);
    expect(result.resolved).toBe(true);
    if (result.resolved) {
      expect(result.version).toBe('1.53.3');
      expect(result.source).toBe('self-in-tree');
    }
  });

  it('resolves a sibling ../totem checkout when not self-in-tree', () => {
    // gitRoot is the consumer; the floor lives in a sibling totem checkout.
    const consumer = path.join(tmpRoot, 'totem-status');
    const sibling = path.join(tmpRoot, 'totem');
    fs.mkdirSync(consumer, { recursive: true });
    writeSelfInTree(sibling, '2.0.0');
    const result = resolveCohortFloor('@mmnto/totem', consumer);
    expect(result.resolved).toBe(true);
    if (result.resolved) {
      expect(result.version).toBe('2.0.0');
      expect(result.source).toBe('sibling');
    }
  });

  it('is honest-absent (resolved:false + reason) when no floor is reachable + NEVER networks', () => {
    const consumer = path.join(tmpRoot, 'lonely');
    fs.mkdirSync(consumer, { recursive: true });
    const result = resolveCohortFloor('@mmnto/totem', consumer);
    expect(result.resolved).toBe(false);
    if (!result.resolved) {
      expect(result.reason).toMatch(/not locally determinable|sibling/i);
    }
  });

  it('does not throw when a package.json in the glob is unreadable/corrupt', () => {
    const pkgDir = path.join(tmpRoot, 'packages', 'totem');
    fs.mkdirSync(pkgDir, { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), '{ not valid json', 'utf-8');
    expect(() => resolveCohortFloor('@mmnto/totem', tmpRoot)).not.toThrow();
  });

  // ── (c) canonical-source repo for strategy-published packages (#2108) ──

  it('resolves the floor from the ../totem-strategy canonical-source repo for a strategy-published package', () => {
    // Consumer is neither self-in-tree nor a ../totem sibling for this package;
    // the floor lives in the strategy repo named by canonicalSource.
    const consumer = path.join(tmpRoot, 'consumer');
    fs.mkdirSync(consumer, { recursive: true });
    writeStrategySibling(tmpRoot, '0.1.13');
    const result = resolveCohortFloor(
      '@mmnto/strategy-doctrine',
      consumer,
      STRATEGY_DOCTRINE_CANONICAL,
    );
    expect(result.resolved).toBe(true);
    if (result.resolved) {
      expect(result.version).toBe('0.1.13');
      expect(result.source).toBe('canonical-source');
    }
  });

  it('does NOT probe the strategy repo when canonicalSource names totem (no false cross-repo floor)', () => {
    // Seed @mmnto/totem INTO the strategy sibling: were the canonical-source layer
    // not gated on the repo basename, it would (wrongly) resolve this floor from
    // ../totem-strategy. The gate must keep it honest-absent (coderabbit #2252 —
    // the prior fixture only held strategy-doctrine, so this passed trivially).
    const consumer = path.join(tmpRoot, 'consumer');
    fs.mkdirSync(consumer, { recursive: true });
    const stratRoot = path.join(tmpRoot, 'totem-strategy');
    writePackage(stratRoot, 'totem', '@mmnto/totem', '9.9.9');
    const result = resolveCohortFloor('@mmnto/totem', consumer, 'mmnto-ai/totem');
    expect(result.resolved).toBe(false);
  });

  it('honest-absent reason says "not found in the resolved repo" when totem-strategy resolves but lacks the package (#2252 GCA)', () => {
    // The strategy repo resolves, but the package isn't in it — the remediation
    // must NOT tell the developer to clone / set what they already have.
    const consumer = path.join(tmpRoot, 'consumer');
    fs.mkdirSync(consumer, { recursive: true });
    const stratRoot = path.join(tmpRoot, 'totem-strategy');
    writePackage(stratRoot, 'other', '@mmnto/something-else', '1.0.0');
    const result = resolveCohortFloor(
      '@mmnto/strategy-doctrine',
      consumer,
      STRATEGY_DOCTRINE_CANONICAL,
    );
    expect(result.resolved).toBe(false);
    if (!result.resolved) {
      expect(result.reason).toContain('not found in the resolved');
      expect(result.reason).not.toMatch(/clone|STRATEGY_ROOT/);
    }
  });

  it('honest-absent reason points at totem-strategy (never ../totem) for a strategy package', () => {
    const consumer = path.join(tmpRoot, 'consumer');
    fs.mkdirSync(consumer, { recursive: true });
    const result = resolveCohortFloor(
      '@mmnto/strategy-doctrine',
      consumer,
      STRATEGY_DOCTRINE_CANONICAL,
    );
    expect(result.resolved).toBe(false);
    if (!result.resolved) {
      expect(result.reason).toContain('totem-strategy');
      expect(result.reason).not.toMatch(/sibling \(\.\.\/totem\)/);
    }
  });

  it('remains backward-compatible (self-in-tree) when canonicalSource is omitted', () => {
    writeSelfInTree(tmpRoot, '1.53.3');
    const result = resolveCohortFloor('@mmnto/totem', tmpRoot);
    expect(result.resolved).toBe(true);
    if (result.resolved) expect(result.source).toBe('self-in-tree');
  });
});

// ─── detectVersionPinnedContract ────────────────────────

describe('detectVersionPinnedContract', () => {
  it('PASS — installed ≥ floor, consumer declares the pin (sensor reports pass)', () => {
    writeSelfInTree(tmpRoot, '1.50.0');
    writeConsumerPkg(tmpRoot, { '@mmnto/totem': '^1.50.0' });
    writeInstalled(tmpRoot, '@mmnto/totem', '1.53.3');
    const verdict = detectVersionPinnedContract(depsContract(), baseCtx({ repoId: 'totem' }));
    expect(verdict.status).toBe('pass');
  });

  it('WARN — installed < floor (stale pin); message carries declared/installed/floor', () => {
    writeSelfInTree(tmpRoot, '1.53.3');
    writeConsumerPkg(tmpRoot, { '@mmnto/totem': '^1.40.0' });
    writeInstalled(tmpRoot, '@mmnto/totem', '1.40.0');
    const verdict = detectVersionPinnedContract(depsContract(), baseCtx({ repoId: 'totem' }));
    expect(verdict.status).toBe('warn');
    expect(verdict.message).toContain('1.40.0'); // installed
    expect(verdict.message).toContain('1.53.3'); // floor
  });

  it('PASS — strategy-published row resolves its floor from ../totem-strategy (was SKIP; #2108)', () => {
    // The empirical #2108 scenario: a wired consumer pins @mmnto/strategy-doctrine,
    // has it installed, and the floor lives in the ../totem-strategy sibling — not
    // totem. Before the canonical-source probe this verdict was a false SKIP.
    const consumer = path.join(tmpRoot, 'consumer');
    fs.mkdirSync(consumer, { recursive: true });
    writeStrategySibling(tmpRoot, '0.1.13');
    writeConsumerPkg(consumer, { '@mmnto/strategy-doctrine': '^0.1.13' }, 'optionalDependencies');
    writeInstalled(consumer, '@mmnto/strategy-doctrine', '0.1.13');
    const contract = depsContract({
      id: 'parity-manifest-currency',
      canonicalSource: STRATEGY_DOCTRINE_CANONICAL,
      package: '@mmnto/strategy-doctrine',
    });
    const verdict = detectVersionPinnedContract(
      contract,
      baseCtx({ cwd: consumer, gitRoot: consumer, repoId: 'totem-status' }),
    );
    expect(verdict.status).toBe('pass');
    expect(verdict.message).toContain('canonical-source');
  });

  it('detector NEVER emits fail — even a blocking contract returns warn (CLI promotes)', () => {
    // Claim-class + layering invariant: fail-promotion is a CLI-edge concern.
    writeSelfInTree(tmpRoot, '1.53.3');
    writeConsumerPkg(tmpRoot, { '@mmnto/totem': '^1.40.0' });
    writeInstalled(tmpRoot, '@mmnto/totem', '1.40.0');
    const verdict = detectVersionPinnedContract(
      depsContract({ blocking: true }),
      baseCtx({ repoId: 'totem' }),
    );
    expect(verdict.status).toBe('warn');
    expect(verdict.status).not.toBe('fail');
  });

  it('SKIP (distinct) — applicable consumer missing an expected pin is expected-but-absent, NOT cohort-permitted', () => {
    writeSelfInTree(tmpRoot, '1.53.3');
    writeConsumerPkg(tmpRoot, { 'unrelated-dep': '^1.0.0' });
    const verdict = detectVersionPinnedContract(depsContract(), baseCtx({ repoId: 'totem' }));
    expect(verdict.status).toBe('skip');
    expect(verdict.message).toMatch(/expected but not declared|applicable consumer/i);
    // Must stay DISTINCT from the not-a-consumer skip — else the consumers field
    // does nothing for the missing case (strategy design-call 3).
    expect(verdict.message).not.toMatch(/permits absence|not in consumers/i);
  });

  it('SKIP — consumers present and current repo not listed (not-a-consumer)', () => {
    writeSelfInTree(tmpRoot, '1.53.3');
    writeConsumerPkg(tmpRoot, { '@mmnto/totem': '^1.50.0' });
    const verdict = detectVersionPinnedContract(
      depsContract({ consumers: ['totem-strategy', 'liquid-city'] }),
      baseCtx({ repoId: 'totem-status' }),
    );
    expect(verdict.status).toBe('skip');
  });

  it('SKIP — consumers present but repo id unresolvable: surface it, do NOT silently apply (Greptile P1)', () => {
    writeSelfInTree(tmpRoot, '1.53.3');
    writeConsumerPkg(tmpRoot, { '@mmnto/totem': '^1.50.0' });
    const verdict = detectVersionPinnedContract(
      depsContract({ consumers: ['totem-strategy'] }),
      baseCtx({ repoId: undefined }),
    );
    expect(verdict.status).toBe('skip');
    expect(verdict.message).toMatch(/cannot determine applicability|repo id unresolvable/i);
  });

  it('resolves an installed version hoisted to a PARENT node_modules (monorepo, GCA-1)', () => {
    // Floor 2.0.0 self-in-tree at the git root; the consumer cwd is a nested
    // subdir whose dep is hoisted to the root node_modules, not its own.
    writeSelfInTree(tmpRoot, '2.0.0');
    const sub = path.join(tmpRoot, 'apps', 'web');
    fs.mkdirSync(sub, { recursive: true });
    writeConsumerPkg(sub, { '@mmnto/totem': '^2.0.0' });
    writeInstalled(tmpRoot, '@mmnto/totem', '2.0.0'); // hoisted at the root, not in sub
    const verdict = detectVersionPinnedContract(
      depsContract(),
      baseCtx({ cwd: sub, gitRoot: tmpRoot, repoId: 'totem' }),
    );
    expect(verdict.status).toBe('pass');
    expect(verdict.message).toContain('2.0.0');
  });

  it('SKIP — floor unresolvable (no self-in-tree, no sibling); reason in message, no throw', () => {
    const consumer = path.join(tmpRoot, 'lonely');
    fs.mkdirSync(consumer, { recursive: true });
    writeConsumerPkg(consumer, { '@mmnto/totem': '^1.50.0' });
    const verdict = detectVersionPinnedContract(
      depsContract(),
      baseCtx({ cwd: consumer, gitRoot: consumer, repoId: 'totem-status' }),
    );
    expect(verdict.status).toBe('skip');
  });

  it('SKIP — id resolves no deps package name (doctrine pin handed back to CLI as skip)', () => {
    const verdict = detectVersionPinnedContract(
      depsContract({ id: 'governance-doctrine' }),
      baseCtx({ repoId: 'totem' }),
    );
    expect(verdict.status).toBe('skip');
  });

  it('no-throw on a corrupt consumer package.json — degrades to skip/warn', () => {
    fs.writeFileSync(path.join(tmpRoot, 'package.json'), '{ broken', 'utf-8');
    writeSelfInTree(tmpRoot, '1.53.3');
    expect(() =>
      detectVersionPinnedContract(depsContract(), baseCtx({ repoId: 'totem' })),
    ).not.toThrow();
  });

  it('falls back to semver.minVersion(range) when node_modules is absent', () => {
    // No install — minVersion('^1.53.0') = 1.53.0, equals floor → pass.
    writeSelfInTree(tmpRoot, '1.53.0');
    writeConsumerPkg(tmpRoot, { '@mmnto/totem': '^1.53.0' });
    const verdict = detectVersionPinnedContract(depsContract(), baseCtx({ repoId: 'totem' }));
    expect(verdict.status).toBe('pass');
  });

  it('SKIP (never throws) on an invalid declared range — claim guarded', () => {
    writeSelfInTree(tmpRoot, '1.53.3');
    writeConsumerPkg(tmpRoot, { '@mmnto/totem': 'not-a-range' });
    const verdict = detectVersionPinnedContract(depsContract(), baseCtx({ repoId: 'totem' }));
    expect(verdict.status).toBe('skip');
  });

  it('claim-class bound — the verdict is pin-currency only, never a content-equality verdict', () => {
    // A version-pinned contract must never assert content drift. We assert the
    // message is framed around versions/pins, not file content equality.
    writeSelfInTree(tmpRoot, '1.53.3');
    writeConsumerPkg(tmpRoot, { '@mmnto/totem': '^1.40.0' });
    writeInstalled(tmpRoot, '@mmnto/totem', '1.40.0');
    const verdict = detectVersionPinnedContract(depsContract(), baseCtx({ repoId: 'totem' }));
    expect(verdict.message).not.toMatch(/content|file|hash|byte/i);
    expect(verdict.message).toMatch(/version|pin|floor|install/i);
  });
});

// ─── packageManager toolchain reader (mmnto-ai/totem#2115) ──

describe('detectVersionPinnedContract — packageManager toolchain (#2115)', () => {
  /** A toolchain-version row that pins via packageManager (no deps package). */
  function toolchainContract(over: Partial<ParityContract> = {}): ParityContract {
    return depsContract({
      id: 'pnpm-engine-version',
      dimension: 'toolchain-version',
      canonicalSource: null,
      expectedValueOrDerivation: 'pnpm@11.2.2 floor; pin >= floor',
      ...over,
    });
  }
  /** Context whose consumer package.json declares `packageManager: pm` (undefined → no field). */
  function ctxWithPackageManager(pm: string | undefined): DetectVersionPinnedContext {
    return baseCtx({ readPackageJson: () => (pm === undefined ? {} : { packageManager: pm }) });
  }

  it('PASS — packageManager pnpm pin ≥ cohort floor', () => {
    const v = detectVersionPinnedContract(
      toolchainContract(),
      ctxWithPackageManager('pnpm@11.2.2+sha512abc'),
    );
    expect(v.status).toBe('pass');
    expect(v.message).toContain('11.2.2');
    expect(v.message).not.toContain('hashless');
  });

  it('WARN — packageManager pnpm pin < cohort floor (stale); remediation is EXACT, never a range', () => {
    const v = detectVersionPinnedContract(
      toolchainContract(),
      ctxWithPackageManager('pnpm@11.1.0+sha512abc'),
    );
    expect(v.status).toBe('warn');
    expect(v.message).toContain('stale');
    expect(v.message).toContain('11.1.0');
    // corepack rejects a range in `packageManager`, so the hint must be exact (GCA #2254).
    expect(v.remediation).toContain('pnpm@11.2.2');
    expect(v.remediation).not.toContain('>=');
  });

  it('SKIP — a malformed packageManager with trailing junk does NOT pass off a leading-token match (greptile #2254)', () => {
    for (const pm of [
      'pnpm@11.2.2 trailing-junk',
      'pnpm@11.2.2+sha512 garbage',
      'pnpm@11.2.2 ; rm -rf',
    ]) {
      const v = detectVersionPinnedContract(toolchainContract(), ctxWithPackageManager(pm));
      expect(v.status).toBe('skip');
      expect(v.message).toContain('not a parseable');
    }
  });

  it('surfaces a hashless-pin note (strategy#566 — corepack integrity not pinned)', () => {
    const v = detectVersionPinnedContract(
      toolchainContract(),
      ctxWithPackageManager('pnpm@11.2.2'),
    );
    expect(v.status).toBe('pass');
    expect(v.message).toContain('hashless');
  });

  it('SKIP — no packageManager field (honest-absent)', () => {
    const v = detectVersionPinnedContract(toolchainContract(), ctxWithPackageManager(undefined));
    expect(v.status).toBe('skip');
    expect(v.message).toContain('no packageManager field');
  });

  it('SKIP — a different engine: the pnpm floor does not apply', () => {
    const v = detectVersionPinnedContract(toolchainContract(), ctxWithPackageManager('yarn@4.0.0'));
    expect(v.status).toBe('skip');
    expect(v.message).toContain('does not apply');
  });

  it('SKIP — unparseable packageManager pin', () => {
    const v = detectVersionPinnedContract(
      toolchainContract(),
      ctxWithPackageManager('not-a-valid-pin'),
    );
    expect(v.status).toBe('skip');
    expect(v.message).toContain('not a parseable');
  });

  it('SKIP — floor not derivable from a prose-only expected-value', () => {
    const v = detectVersionPinnedContract(
      toolchainContract({ expectedValueOrDerivation: 'see the rider for the floor' }),
      ctxWithPackageManager('pnpm@11.2.2+sha512abc'),
    );
    expect(v.status).toBe('skip');
    expect(v.message).toContain('floor not derivable');
  });

  it('never throws on adversarial packageManager input', () => {
    for (const pm of ['', '@', 'pnpm@', '@1.2.3', 'pnpm@@@', 'pnpm@notsemver']) {
      expect(() =>
        detectVersionPinnedContract(toolchainContract(), ctxWithPackageManager(pm)),
      ).not.toThrow();
    }
  });

  it('a toolchain-version row WITH a deps package stays on the deps floor path (mmnto-cli-version)', () => {
    // dimension is toolchain-version but the id resolves @mmnto/totem → the deps
    // path owns it; the packageManager reader must NOT intercept it.
    writeSelfInTree(tmpRoot, '1.50.0');
    writeConsumerPkg(tmpRoot, { '@mmnto/totem': '^1.50.0' });
    writeInstalled(tmpRoot, '@mmnto/totem', '1.53.3');
    const v = detectVersionPinnedContract(
      depsContract({ dimension: 'toolchain-version' }),
      baseCtx({ repoId: 'totem' }),
    );
    expect(v.status).toBe('pass');
    expect(v.message).toContain('cohort floor');
    expect(v.message).not.toContain('engine pin');
  });
});

// ─── Mechanical content-equality detector (mmnto-ai/totem#2073) ──

const MARKERS = { start: '<!-- totem:skill-start -->', end: '<!-- totem:skill-end -->' };

/**
 * Build a distributed skill artifact: a managed block between the markers, with
 * an optional `fork` marker placed AFTER the end marker (user-customization
 * territory — outside the compared block, so the marker itself never drifts).
 */
function skillFile(body: string, opts: { fork?: string } = {}): string {
  const trailer = opts.fork !== undefined ? `\n${opts.fork}\n` : '';
  return `---\nname: x\n---\n\n${MARKERS.start}\n${body}\n${MARKERS.end}\n${trailer}`;
}

/** Write a consumer artifact at `<tmpRoot>/<rel>`; returns the absolute path. */
function writeArtifact(rel: string, content: string): string {
  const abs = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
  return abs;
}

/** Base mechanical context; canonicalBlock + consumerPath default to a known artifact. */
function mechCtx(over: Partial<DetectMechanicalContext> = {}): DetectMechanicalContext {
  return {
    canonicalBlock: 'CANONICAL BODY\nline two',
    consumerPath: path.join(tmpRoot, '.claude/skills/x/SKILL.md'),
    markers: MARKERS,
    ...over,
  };
}

describe('normalizeManagedBlock', () => {
  it('collapses CRLF and lone CR to LF', () => {
    expect(normalizeManagedBlock('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('strips trailing whitespace per line and trims surrounding blank lines', () => {
    expect(normalizeManagedBlock('\n\na  \nb\t\n\n')).toBe('a\nb');
  });
});

describe('extractManagedBlock', () => {
  it('returns the content between the first start and the following end marker', () => {
    expect(extractManagedBlock(`pre ${MARKERS.start}INNER${MARKERS.end} post`, MARKERS)).toBe(
      'INNER',
    );
  });

  it('returns undefined when either marker is absent', () => {
    expect(extractManagedBlock(`only ${MARKERS.start} no end`, MARKERS)).toBeUndefined();
    expect(extractManagedBlock('no markers at all', MARKERS)).toBeUndefined();
  });
});

describe('parseForkMarker', () => {
  it('parses reason/owner/attested, whitespace-tolerant', () => {
    expect(
      parseForkMarker('<!--  totem:fork   reason="x y"  owner="me" attested="2026-06-03" -->'),
    ).toEqual({ reason: 'x y', owner: 'me', attested: '2026-06-03' });
  });

  it('returns an empty object for a bare marker, undefined when absent', () => {
    expect(parseForkMarker('<!-- totem:fork -->')).toEqual({});
    expect(parseForkMarker('no marker here')).toBeUndefined();
  });

  it('matches a fork marker authored across multiple lines (dotAll)', () => {
    expect(parseForkMarker('<!-- totem:fork\n  reason="multi line"\n  owner="me"\n-->')).toEqual({
      reason: 'multi line',
      owner: 'me',
    });
  });
});

describe('parseDeclarationMarker', () => {
  it('parses role/seat/declared, whitespace-tolerant, token with a colon matched literally', () => {
    expect(
      parseDeclarationMarker(
        'preamble\n<!--  totem:agent-bus   role="bus"  seat="totem-claude" declared="2026-07-16" -->\ntrailer',
        'totem:agent-bus',
      ),
    ).toEqual({ role: 'bus', seat: 'totem-claude', declared: '2026-07-16' });
  });

  it('returns an empty object for a bare marker, undefined when the token is absent', () => {
    expect(parseDeclarationMarker('<!-- totem:agent-bus -->', 'totem:agent-bus')).toEqual({});
    expect(parseDeclarationMarker('no marker here', 'totem:agent-bus')).toBeUndefined();
    // A DIFFERENT totem marker is not this token — no cross-token match.
    expect(
      parseDeclarationMarker('<!-- totem:fork reason="x" -->', 'totem:agent-bus'),
    ).toBeUndefined();
  });

  it('does not prefix-match a longer sibling token (agent-bus vs agent-bus-v2)', () => {
    // The post-token lookahead (whitespace or `-->`) — not `\b` — is what makes
    // this fail: `\b` would match between the `s` and the `-` of `-v2`.
    expect(
      parseDeclarationMarker('<!-- totem:agent-bus-v2 role="bus" -->', 'totem:agent-bus'),
    ).toBeUndefined();
    // Bare marker (token directly against `-->`) still parses.
    expect(parseDeclarationMarker('<!-- totem:agent-bus-->', 'totem:agent-bus')).toEqual({});
  });

  it('matches a marker authored across multiple lines (dotAll)', () => {
    expect(
      parseDeclarationMarker(
        '<!-- totem:agent-bus\n  role="bus"\n  seat="totem-claude"\n-->',
        'totem:agent-bus',
      ),
    ).toEqual({ role: 'bus', seat: 'totem-claude' });
  });

  it('stays linear on a pathological unterminated input (ReDoS-safe, no catastrophic backtrack)', () => {
    // A very long run with no closing `-->`: the non-greedy `.*?` bounded by the
    // first `-->` cannot backtrack catastrophically. Guard on wall-clock so a
    // regression to a nested quantifier is caught, mirroring the marker family.
    const pathological = `<!-- totem:agent-bus ${'role="bus" '.repeat(50_000)}`;
    const start = Date.now();
    expect(parseDeclarationMarker(pathological, 'totem:agent-bus')).toBeUndefined();
    expect(Date.now() - start).toBeLessThan(1_000);
  });
});

describe('detectDeclaredContract', () => {
  const AGENTS_PATH = path.join('repo', 'AGENTS.md');
  const AGENTS =
    (body: string) =>
    (p: string): string | undefined =>
      p === AGENTS_PATH ? body : undefined;

  it('pass — marker present with role + seat names the binding + the file', () => {
    const verdict = detectDeclaredContract({
      filePath: AGENTS_PATH,
      markerToken: 'totem:agent-bus',
      readFile: AGENTS(
        '<!-- totem:agent-bus role="bus" seat="totem-claude" declared="2026-07-16" -->',
      ),
    });
    expect(verdict.status).toBe('pass');
    expect(verdict.message).toContain('agent-bus declared');
    expect(verdict.message).toContain('role "bus"');
    expect(verdict.message).toContain('seat "totem-claude"');
    expect(verdict.message).toContain('AGENTS.md');
  });

  it('skip (honest-absent) — no marker in an otherwise-present file, never warn', () => {
    const verdict = detectDeclaredContract({
      filePath: AGENTS_PATH,
      markerToken: 'totem:agent-bus',
      readFile: AGENTS('# AGENTS\n\nno declaration here\n'),
    });
    expect(verdict.status).toBe('skip');
    expect(verdict.message).toContain('honest-absent until a repo declares');
  });

  it('skip (honest-absent) — file absent, never warn', () => {
    const verdict = detectDeclaredContract({
      filePath: AGENTS_PATH,
      markerToken: 'totem:agent-bus',
      readFile: () => undefined,
    });
    expect(verdict.status).toBe('skip');
    expect(verdict.message).toContain('no AGENTS.md present');
  });

  it('skip — a marker missing the seat attr is not a valid declaration, names the missing attr (fail loud)', () => {
    const verdict = detectDeclaredContract({
      filePath: AGENTS_PATH,
      markerToken: 'totem:agent-bus',
      readFile: AGENTS('<!-- totem:agent-bus role="bus" -->'),
    });
    expect(verdict.status).toBe('skip');
    expect(verdict.message).toContain('missing seat');
    expect(verdict.message).not.toContain('missing role');
  });

  it('skip — a marker missing the role attr names role in the why-not', () => {
    const verdict = detectDeclaredContract({
      filePath: AGENTS_PATH,
      markerToken: 'totem:agent-bus',
      readFile: AGENTS('<!-- totem:agent-bus seat="totem-claude" -->'),
    });
    expect(verdict.status).toBe('skip');
    expect(verdict.message).toContain('missing role');
  });

  it('skip — an empty-string role is a degenerate binding, counts as missing (greptile P2, mmnto-ai/totem#2400)', () => {
    const verdict = detectDeclaredContract({
      filePath: AGENTS_PATH,
      markerToken: 'totem:agent-bus',
      readFile: AGENTS('<!-- totem:agent-bus role="" seat="totem-claude" -->'),
    });
    expect(verdict.status).toBe('skip');
    expect(verdict.message).toContain('missing role');
    expect(verdict.message).not.toContain('missing role + seat');
  });

  it('skip — a whitespace-only seat counts as missing', () => {
    const verdict = detectDeclaredContract({
      filePath: AGENTS_PATH,
      markerToken: 'totem:agent-bus',
      readFile: AGENTS('<!-- totem:agent-bus role="bus" seat="   " -->'),
    });
    expect(verdict.status).toBe('skip');
    expect(verdict.message).toContain('missing seat');
  });

  it('pass message strips ANSI/control sequences from repo-provided role/seat (CR round 2, mmnto-ai/totem#2400)', () => {
    const ESC = String.fromCharCode(27);
    const verdict = detectDeclaredContract({
      filePath: AGENTS_PATH,
      markerToken: 'totem:agent-bus',
      readFile: AGENTS(
        `<!-- totem:agent-bus role="${ESC}[31mbus" seat="totem${ESC}[0m-claude" -->`,
      ),
    });
    expect(verdict.status).toBe('pass');
    expect(verdict.message).not.toContain(ESC);
    expect(verdict.message).toContain('role "bus"');
    expect(verdict.message).toContain('seat "totem-claude"');
  });

  it('never throws — a throwing reader degrades to honest-absent skip', () => {
    const verdict = detectDeclaredContract({
      filePath: AGENTS_PATH,
      markerToken: 'totem:agent-bus',
      readFile: () => {
        throw new Error('boom');
      },
    });
    // The default readFileText swallows read failures; an injected thrower is the
    // never-throw contract at the CLI seam — but detectDeclaredContract calls the
    // reader directly, so a thrower here would surface. Guard the honest degrade.
    expect(verdict.status).toBe('skip');
  });
});

describe('detectMechanicalContract', () => {
  it('pass — consumer block equals canonical after normalization', () => {
    const consumerPath = writeArtifact(
      '.claude/skills/x/SKILL.md',
      skillFile('CANONICAL BODY\nline two'),
    );
    expect(detectMechanicalContract(mechCtx({ consumerPath })).status).toBe('pass');
  });

  it('pass — CRLF consumer vs LF canonical, otherwise identical (win32 guard, req #3)', () => {
    const crlf = skillFile('CANONICAL BODY\nline two').replace(/\n/g, '\r\n');
    const consumerPath = writeArtifact('.claude/skills/x/SKILL.md', crlf);
    expect(detectMechanicalContract(mechCtx({ consumerPath })).status).toBe('pass');
  });

  it('pass — a trailing-whitespace-only difference normalizes equal', () => {
    const consumerPath = writeArtifact(
      '.claude/skills/x/SKILL.md',
      skillFile('CANONICAL BODY  \nline two\t'),
    );
    expect(detectMechanicalContract(mechCtx({ consumerPath })).status).toBe('pass');
  });

  it('warn — drift with no fork marker, reporting the consumer content-hash', () => {
    const consumerPath = writeArtifact('.claude/skills/x/SKILL.md', skillFile('DRIFTED BODY'));
    const v = detectMechanicalContract(mechCtx({ consumerPath }));
    expect(v.status).toBe('warn');
    expect(v.message).toMatch(/drift/i);
    expect(v.message).toContain(hashManagedBlock(normalizeManagedBlock('DRIFTED BODY')));
  });

  it('info — drift WITH a fork marker is an attested intentional fork, never warn (req #7)', () => {
    const consumerPath = writeArtifact(
      '.claude/skills/x/SKILL.md',
      skillFile('DRIFTED BODY', {
        fork: '<!-- totem:fork reason="local override" owner="satur8d" attested="2026-06-03" -->',
      }),
    );
    const v = detectMechanicalContract(mechCtx({ consumerPath }));
    expect(v.status).toBe('info');
    expect(v.message).toMatch(/intentional fork/i);
    expect(v.message).toContain('2026-06-03');
  });

  it('intentional-fork message strips ANSI/control sequences from repo-provided owner/attested (mmnto-ai/totem#2403)', () => {
    const ESC = String.fromCharCode(27);
    const consumerPath = writeArtifact(
      '.claude/skills/x/SKILL.md',
      skillFile('DRIFTED BODY', {
        fork: `<!-- totem:fork reason="x" owner="${ESC}[31msatur8d" attested="2026${ESC}[0m-06-03" -->`,
      }),
    );
    const v = detectMechanicalContract(mechCtx({ consumerPath }));
    expect(v.status).toBe('info');
    expect(v.message).not.toContain(ESC);
    expect(v.message).toContain('owner satur8d');
    expect(v.message).toContain('attested 2026-06-03');
  });

  it('pass — a fork marker present but content actually matching is still pass (no false fork)', () => {
    const consumerPath = writeArtifact(
      '.claude/skills/x/SKILL.md',
      skillFile('CANONICAL BODY\nline two', { fork: '<!-- totem:fork reason="x" -->' }),
    );
    expect(detectMechanicalContract(mechCtx({ consumerPath })).status).toBe('pass');
  });

  it('unknown — an unresolvable canonical is never rendered pass (Stale-Doctor-Paradox guard)', () => {
    const consumerPath = writeArtifact('.claude/skills/x/SKILL.md', skillFile('whatever'));
    const v = detectMechanicalContract(mechCtx({ consumerPath, canonicalBlock: undefined }));
    expect(v.status).toBe('unknown');
    expect(v.status).not.toBe('pass');
  });

  it('pass — a legitimately EMPTY canonical block is compared, not conflated with unknown', () => {
    // Markers present but no content on both sides → equal → pass, NOT unknown
    // (empty `''` is distinct from an unresolvable `undefined`).
    const consumerPath = writeArtifact('.claude/skills/x/SKILL.md', skillFile(''));
    const v = detectMechanicalContract(mechCtx({ consumerPath, canonicalBlock: '' }));
    expect(v.status).toBe('pass');
  });

  it('skip — consumer artifact absent (cohort permits absence), distinct from drift', () => {
    const v = detectMechanicalContract(
      mechCtx({ consumerPath: path.join(tmpRoot, 'nope/SKILL.md') }),
    );
    expect(v.status).toBe('skip');
  });

  it('warn — a present file with markers stripped is unmanaged drift, not pass', () => {
    const consumerPath = writeArtifact('.claude/skills/x/SKILL.md', 'no markers, just text');
    const v = detectMechanicalContract(mechCtx({ consumerPath }));
    expect(v.status).toBe('warn');
    expect(v.message).toMatch(/markers absent|unmanaged/i);
  });

  it('info — a marker-stripped file carrying a totem:fork marker is an intentional fork, not drift', () => {
    const consumerPath = writeArtifact(
      '.claude/skills/x/SKILL.md',
      'heavily customized, no skill markers\n<!-- totem:fork reason="full rewrite" attested="2026-06-03" -->',
    );
    const v = detectMechanicalContract(mechCtx({ consumerPath }));
    expect(v.status).toBe('info');
    expect(v.message).toMatch(/intentional fork/i);
  });

  it('never emits fail and degrades a missing read to skip (detector invariant)', () => {
    const v = detectMechanicalContract(mechCtx({ readFile: () => undefined }));
    expect(v.status).toBe('skip');
    expect(v.status).not.toBe('fail');
  });

  it('binary self-report (req #5) — names the resolving @mmnto/cli in the verdict', () => {
    const consumerPath = writeArtifact(
      '.claude/skills/x/SKILL.md',
      skillFile('CANONICAL BODY\nline two'),
    );
    const v = detectMechanicalContract(
      mechCtx({ consumerPath, binary: { version: '1.53.5', path: '/usr/local/bin/totem' } }),
    );
    expect(v.message).toContain('@mmnto/cli@1.53.5');
  });
});

// ─── Generated-artifact (git-hooks) content-equality detector (mmnto-ai/totem#2073) ──

const PREPUSH_MARKER = '[totem] pre-push hook';
const POSTMERGE_MARKER = '[totem] post-merge hook';
const POSTMERGE_END = '[totem] end post-merge';

/** A totem-OWNED whole-file hook (pre-push style — start marker only, no end). */
function ownedPrePush(body: string): string {
  return `#!/bin/sh\n# ${PREPUSH_MARKER} — stateless enforcement.\n${body}\n`;
}

/** A totem-OWNED whole-file hook with start + end markers (post-merge style). */
function ownedPostMerge(body: string): string {
  return `#!/bin/sh\n# ${POSTMERGE_MARKER} — background re-index.\n${body}\n# ${POSTMERGE_END}\n`;
}

/** A user's own hook with the totem block APPENDED (shebang stripped, post-merge style). */
function appendedPostMerge(userBody: string, totemBody: string): string {
  return `#!/usr/bin/env bash\n${userBody}\n\n# ${POSTMERGE_MARKER} — background re-index.\n${totemBody}\n# ${POSTMERGE_END}\n`;
}

/** A user's own hook with the totem block APPENDED (pre-push style — no end marker). */
function appendedPrePush(userBody: string, totemBody: string): string {
  return `#!/usr/bin/env bash\n${userBody}\n\n# ${PREPUSH_MARKER} — stateless enforcement.\n${totemBody}\n`;
}

/** Base context for a pre-push (no end marker) artifact at `.git/hooks/pre-push`. */
function genCtx(
  over: Partial<DetectGeneratedArtifactContext> = {},
): DetectGeneratedArtifactContext {
  return {
    canonicalContent: ownedPrePush('echo current'),
    consumerPath: path.join(tmpRoot, '.git/hooks/pre-push'),
    ownershipMarker: PREPUSH_MARKER,
    ...over,
  };
}

describe('detectGeneratedArtifactContract', () => {
  it('pass — totem-owned hook equals the regenerated canonical', () => {
    const consumerPath = writeArtifact('.git/hooks/pre-push', ownedPrePush('echo current'));
    expect(detectGeneratedArtifactContract(genCtx({ consumerPath })).status).toBe('pass');
  });

  it('pass — CRLF consumer vs LF canonical, otherwise identical (win32 checkout guard)', () => {
    const consumerPath = writeArtifact(
      '.git/hooks/pre-push',
      ownedPrePush('echo current').replace(/\n/g, '\r\n'),
    );
    expect(detectGeneratedArtifactContract(genCtx({ consumerPath })).status).toBe('pass');
  });

  it('warn — a hook frozen at an older generator (stale pre-#2053 resolve order) is drift (the mmnto-ai/totem#1854 keystone)', () => {
    // The detection half of mmnto-ai/totem#1854: a consumer sitting on an old hook the
    // current generator would no longer emit MUST surface as drift, not a false pass.
    const stale = ownedPrePush('if command -v totem; then TOTEM_CMD="totem"; fi');
    const current = ownedPrePush('if [ -f node_modules/@mmnto/cli/dist/index.js ]; then :; fi');
    const consumerPath = writeArtifact('.git/hooks/pre-push', stale);
    const v = detectGeneratedArtifactContract(genCtx({ consumerPath, canonicalContent: current }));
    expect(v.status).toBe('warn');
    expect(v.message).toMatch(/drift/i);
  });

  it('pass — parameterized canonical: an npm-flavored hook matches an npm-flavored canonical (no false drift)', () => {
    // The detector compares against a canonical regenerated with THIS repo's package
    // manager (npx), so an npm consumer never reads as drift against a pnpm canonical.
    const npm = ownedPrePush('TOTEM_CMD="npx @mmnto/cli"');
    const consumerPath = writeArtifact('.git/hooks/pre-push', npm);
    expect(
      detectGeneratedArtifactContract(genCtx({ consumerPath, canonicalContent: npm })).status,
    ).toBe('pass');
  });

  it('info — an owned hook that drifted but carries a totem:fork marker is an attested fork, not warn', () => {
    const consumerPath = writeArtifact(
      '.git/hooks/pre-push',
      ownedPrePush(
        'echo drifted\n# <!-- totem:fork reason="local gate" owner="satur8d" attested="2026-06-04" -->',
      ),
    );
    const v = detectGeneratedArtifactContract(genCtx({ consumerPath }));
    expect(v.status).toBe('info');
    expect(v.message).toMatch(/intentional fork/i);
    expect(v.message).toContain('2026-06-04');
  });

  it('skip — hook absent (cohort permits absence), distinct from drift', () => {
    const v = detectGeneratedArtifactContract(
      genCtx({ consumerPath: path.join(tmpRoot, '.git/hooks/nope') }),
    );
    expect(v.status).toBe('skip');
    expect(v.message).toMatch(/not installed|permits absence/i);
  });

  it('skip — a present hook with NO totem marker is a pure user hook, not drift (presence semantics)', () => {
    const consumerPath = writeArtifact('.git/hooks/pre-push', '#!/bin/sh\necho my own hook\n');
    const v = detectGeneratedArtifactContract(genCtx({ consumerPath }));
    expect(v.status).toBe('skip');
    expect(v.message).toMatch(/not totem-managed|permits absence/i);
    // Must NOT be a warn — totem simply is not installed here.
    expect(v.status).not.toBe('warn');
  });

  it('unknown — an unregenerable canonical is never rendered pass (Stale-Doctor-Paradox guard)', () => {
    const consumerPath = writeArtifact('.git/hooks/pre-push', ownedPrePush('echo current'));
    const v = detectGeneratedArtifactContract(
      genCtx({ consumerPath, canonicalContent: undefined }),
    );
    expect(v.status).toBe('unknown');
    expect(v.status).not.toBe('pass');
  });

  it('pass — appended post-merge: totem region current within a user-managed hook (diff is user content)', () => {
    const consumerPath = writeArtifact(
      '.git/hooks/post-merge',
      appendedPostMerge('echo user pre-step', 'sync incremental'),
    );
    const v = detectGeneratedArtifactContract({
      canonicalContent: ownedPostMerge('sync incremental'),
      consumerPath,
      ownershipMarker: POSTMERGE_MARKER,
      endMarker: POSTMERGE_END,
    });
    expect(v.status).toBe('pass');
    expect(v.message).toMatch(/totem block current/i);
  });

  it('warn — appended post-merge: the totem region itself drifted', () => {
    const consumerPath = writeArtifact(
      '.git/hooks/post-merge',
      appendedPostMerge('echo user pre-step', 'sync OLD'),
    );
    const v = detectGeneratedArtifactContract({
      canonicalContent: ownedPostMerge('sync NEW'),
      consumerPath,
      ownershipMarker: POSTMERGE_MARKER,
      endMarker: POSTMERGE_END,
    });
    expect(v.status).toBe('warn');
    expect(v.message).toMatch(/drift/i);
  });

  it('unknown — totem block appended in a user pre-push hook (no end marker) cannot be isolated', () => {
    const consumerPath = writeArtifact(
      '.git/hooks/pre-push',
      appendedPrePush('echo user pre-step', 'echo current'),
    );
    const v = detectGeneratedArtifactContract(genCtx({ consumerPath }));
    expect(v.status).toBe('unknown');
    expect(v.message).toMatch(/cannot isolate|embedded/i);
    // Never a false warn — claim-class-tight.
    expect(v.status).not.toBe('warn');
  });

  it('info — an appended (no-end-marker) hook carrying a totem:fork marker is an attested fork, not unknown', () => {
    const consumerPath = writeArtifact(
      '.git/hooks/pre-push',
      appendedPrePush(
        'echo user',
        'echo custom\n# <!-- totem:fork reason="vendored" attested="2026-06-04" -->',
      ),
    );
    const v = detectGeneratedArtifactContract(genCtx({ consumerPath }));
    expect(v.status).toBe('info');
    expect(v.message).toMatch(/intentional fork/i);
  });

  it('never emits fail and degrades a missing read to skip (detector invariant)', () => {
    const v = detectGeneratedArtifactContract(genCtx({ readFile: () => undefined }));
    expect(v.status).toBe('skip');
    expect(v.status).not.toBe('fail');
  });

  it('binary self-report (req #5) — names the resolving @mmnto/cli in the verdict', () => {
    const consumerPath = writeArtifact('.git/hooks/pre-push', ownedPrePush('echo current'));
    const v = detectGeneratedArtifactContract(
      genCtx({ consumerPath, binary: { version: '1.53.5', path: '/usr/local/bin/totem' } }),
    );
    expect(v.message).toContain('@mmnto/cli@1.53.5');
  });

  it('warn — a fork marker in the USER preamble does NOT suppress totem-block drift (region-scoped, Greptile)', () => {
    // Appended post-merge: the totem region drifted, but the fork marker sits in the
    // user's OWN preamble (outside the totem block) — it must not demote warn → info.
    const consumerPath = writeArtifact(
      '.git/hooks/post-merge',
      appendedPostMerge(
        'echo user step\n# <!-- totem:fork reason="my own preamble" owner="someone" -->',
        'sync OLD',
      ),
    );
    const v = detectGeneratedArtifactContract({
      canonicalContent: ownedPostMerge('sync NEW'),
      consumerPath,
      ownershipMarker: POSTMERGE_MARKER,
      endMarker: POSTMERGE_END,
    });
    expect(v.status).toBe('warn');
    expect(v.status).not.toBe('info');
  });

  it('info — a fork marker INSIDE the totem region is a genuine attestation', () => {
    const consumerPath = writeArtifact(
      '.git/hooks/post-merge',
      appendedPostMerge(
        'echo user step',
        'sync OLD\n# <!-- totem:fork reason="vendored sync" attested="2026-06-04" -->',
      ),
    );
    const v = detectGeneratedArtifactContract({
      canonicalContent: ownedPostMerge('sync NEW'),
      consumerPath,
      ownershipMarker: POSTMERGE_MARKER,
      endMarker: POSTMERGE_END,
    });
    expect(v.status).toBe('info');
    expect(v.message).toMatch(/intentional fork/i);
  });

  it('unknown — endMarker set but the canonical lacks its end marker is unprovable, never a false warn (Greptile)', () => {
    // A regenerated canonical missing its own end marker (generator/marker misconfig)
    // must not fall through to an owned-file `warn` — the comparison is unprovable.
    const canonicalNoEnd = `#!/bin/sh\n# ${POSTMERGE_MARKER} — background re-index.\nsync\n`;
    const consumerPath = writeArtifact('.git/hooks/post-merge', ownedPostMerge('sync'));
    const v = detectGeneratedArtifactContract({
      canonicalContent: canonicalNoEnd,
      consumerPath,
      ownershipMarker: POSTMERGE_MARKER,
      endMarker: POSTMERGE_END,
    });
    expect(v.status).toBe('unknown');
    expect(v.status).not.toBe('warn');
    expect(v.message).toMatch(/canonical hook region|unprovable/i);
  });

  // ── whole-file JS SessionStart hooks (mmnto-ai/totem#2073 orientation slice) ──
  // The `// [totem] auto-generated` marker OPENS the file (no shell shebang), so
  // isOwnedGeneratedFile must treat it as OWNED — a drifted JS hook is `warn`, not
  // `unknown`. This exercises the generalization the orientation slice adds.
  const SESSION_MARKER = '// [totem] auto-generated';
  function ownedSessionStart(body: string): string {
    return `${SESSION_MARKER} — SessionStart hook\nconst { execSync } = require('child_process');\n${body}\n`;
  }

  it('pass — owned whole-file JS SessionStart equals canonical (marker opens the file, no shebang)', () => {
    const consumerPath = writeArtifact(
      '.claude/hooks/SessionStart.cjs',
      ownedSessionStart('run();'),
    );
    const v = detectGeneratedArtifactContract(
      genCtx({
        consumerPath,
        canonicalContent: ownedSessionStart('run();'),
        ownershipMarker: SESSION_MARKER,
      }),
    );
    expect(v.status).toBe('pass');
  });

  it('warn — a drifted owned JS SessionStart is drift, NOT unknown (the orientation-slice keystone)', () => {
    const consumerPath = writeArtifact(
      '.gemini/hooks/SessionStart.js',
      ownedSessionStart('runOld();'),
    );
    const v = detectGeneratedArtifactContract(
      genCtx({
        consumerPath,
        canonicalContent: ownedSessionStart('runNew();'),
        ownershipMarker: SESSION_MARKER,
      }),
    );
    expect(v.status).toBe('warn');
    expect(v.status).not.toBe('unknown');
    expect(v.message).toMatch(/drift/i);
  });

  it('unknown — a JS file with USER content before the marker is appended, not owned (preserved)', () => {
    const consumerPath = writeArtifact(
      '.claude/hooks/SessionStart.cjs',
      `// my own preamble\nconsole.log('user');\n${ownedSessionStart('run();')}`,
    );
    const v = detectGeneratedArtifactContract(
      genCtx({
        consumerPath,
        canonicalContent: ownedSessionStart('run();'),
        ownershipMarker: SESSION_MARKER,
      }),
    );
    expect(v.status).toBe('unknown');
    expect(v.status).not.toBe('warn');
  });

  it('skip — a present JS file with no totem marker is a user hook (presence semantics, not drift)', () => {
    const consumerPath = writeArtifact(
      '.gemini/hooks/SessionStart.js',
      `console.log('my own session start');\n`,
    );
    const v = detectGeneratedArtifactContract(
      genCtx({ consumerPath, ownershipMarker: SESSION_MARKER }),
    );
    expect(v.status).toBe('skip');
    expect(v.status).not.toBe('warn');
  });

  it('SessionStart absence + drift copy names the artifact + totem init, never the git-hook installer (Greptile #2082)', () => {
    // Absent → skip copy + remediation must NOT point at the git-hook installer.
    const absent = detectGeneratedArtifactContract(
      genCtx({
        consumerPath: path.join(tmpRoot, '.claude/hooks/SessionStart.cjs'),
        ownershipMarker: SESSION_MARKER,
        artifactLabel: 'SessionStart hook',
        installCommand: 'totem init',
      }),
    );
    expect(absent.status).toBe('skip');
    expect(absent.message).toContain('SessionStart hook');
    expect(absent.remediation).toContain('totem init');
    expect(absent.remediation).not.toMatch(/totem hook install/i);

    // Drifted owned → warn remediation points at totem init, not totem hook install.
    const consumerPath = writeArtifact(
      '.gemini/hooks/SessionStart.js',
      ownedSessionStart('old();'),
    );
    const drifted = detectGeneratedArtifactContract(
      genCtx({
        consumerPath,
        canonicalContent: ownedSessionStart('new();'),
        ownershipMarker: SESSION_MARKER,
        artifactLabel: 'SessionStart hook',
        installCommand: 'totem init',
      }),
    );
    expect(drifted.status).toBe('warn');
    expect(drifted.remediation).toContain('totem init');
    expect(drifted.remediation).not.toMatch(/totem hook install/i);
  });
});

// ─── detectManualAttestationContract (mmnto-ai/totem#2073 manual-attestation slice) ──

describe('detectManualAttestationContract', () => {
  /** A vendor-SDK manual-attestation coupling (`package` set → local pin readable). */
  function vendorContract(over: Partial<ParityContract> = {}): ParityContract {
    return {
      id: 'google-genai-coupling',
      dimension: 'dependency-cohort',
      canonicalSource: null,
      detectionMethod: "doctor surfaces each consumer's pin + last-attested; flags staleness only",
      expectedValueOrDerivation:
        'tracked for coupling visibility; cohort floor is a pending decision',
      tractability: 'manual-attestation',
      trackingIssue: 'mmnto-ai/totem#2018',
      package: '@google/genai',
      ...over,
    };
  }

  /** A doctrine manual-attestation row (no `package`; cross-repo canonical). */
  function doctrineContract(over: Partial<ParityContract> = {}): ParityContract {
    return {
      id: 'governance-doctrine',
      dimension: 'doctrine',
      canonicalSource: 'mmnto-ai/totem-strategy:AGENTS.md',
      detectionMethod: 'doctor surfaces "last attested <date/SHA>" and flags staleness only',
      expectedValueOrDerivation:
        'tracked for doctrine-currency visibility; the mechanical pin is a pending deliverable',
      tractability: 'manual-attestation',
      trackingIssue: 'mmnto-ai/totem-strategy#511',
      ...over,
    };
  }

  function maCtx(
    over: Partial<DetectManualAttestationContext> = {},
  ): DetectManualAttestationContext {
    return { cwd: tmpRoot, repoId: 'totem', ...over };
  }

  /** A read seam that throws — proves the doctrine-row path performs NO package.json read. */
  const throwingRead = (): PackageJsonShape | undefined => {
    throw new Error('readPackageJson must not be called on the doctrine-row path');
  };

  // ── Vendor-SDK sub-class ──
  it('vendor-SDK: declared + installed → info naming pkg, range, installed version, no-floor', () => {
    writeConsumerPkg(tmpRoot, { '@google/genai': '^0.3.0' });
    writeInstalled(tmpRoot, '@google/genai', '0.3.1');
    const v = detectManualAttestationContract(vendorContract(), maCtx());
    expect(v.status).toBe('info');
    expect(v.message).toContain('@google/genai');
    expect(v.message).toContain('^0.3.0');
    expect(v.message).toContain('installed 0.3.1');
    expect(v.message).toMatch(/no cohort floor|attest only/i);
  });

  it('vendor-SDK: applicable consumer but package NOT declared → skip, NOT warn (vendor spread permitted)', () => {
    writeConsumerPkg(tmpRoot, { 'some-other-dep': '^1.0.0' });
    const v = detectManualAttestationContract(vendorContract(), maCtx());
    expect(v.status).toBe('skip');
    expect(v.status).not.toBe('warn');
    expect(v.message).toMatch(/not present here|vendor spread/i);
  });

  it('vendor-SDK: an unparseable declared range → info with installed unresolved (never throws, never warn)', () => {
    writeConsumerPkg(tmpRoot, { '@google/genai': 'not-a-range' });
    const v = detectManualAttestationContract(vendorContract(), maCtx());
    expect(v.status).toBe('info');
    expect(v.status).not.toBe('warn');
    expect(v.message).toContain('installed: unresolved');
  });

  it('vendor-SDK with no consumer package.json at all → skip, never throws (production honest-absent reader)', () => {
    // tmpRoot has no package.json written this case.
    const v = detectManualAttestationContract(vendorContract(), maCtx());
    expect(v.status).toBe('skip');
  });

  // ── consumers-scope guard (verbatim parity with detectVersionPinnedContract) ──
  it('consumers scope: repo not in consumers → skip cohort-permits-absence', () => {
    const v = detectManualAttestationContract(
      vendorContract({
        id: 'anthropic-sdk-coupling',
        package: '@anthropic-ai/sdk',
        consumers: ['totem', 'liquid-city'],
      }),
      maCtx({ repoId: 'totem-status' }),
    );
    expect(v.status).toBe('skip');
    expect(v.message).toMatch(/cohort permits absence/i);
  });

  it('consumers scope: repoId unresolvable on a scoped contract → skip (cannot determine applicability)', () => {
    const v = detectManualAttestationContract(
      vendorContract({ consumers: ['totem'] }),
      maCtx({ repoId: undefined }),
    );
    expect(v.status).toBe('skip');
    expect(v.message).toMatch(/cannot determine applicability/i);
  });

  // ── Doctrine sub-class (zero I/O — local-read-only) ──
  it('doctrine row: info naming canonicalSource + tracking issue + not-recorded; performs ZERO package.json read', () => {
    const v = detectManualAttestationContract(
      doctrineContract(),
      // A throwing read seam proves the doctrine path never touches package.json.
      maCtx({ readPackageJson: throwingRead }),
    );
    expect(v.status).toBe('info');
    expect(v.message).toContain('mmnto-ai/totem-strategy:AGENTS.md');
    expect(v.message).toContain('mmnto-ai/totem-strategy#511');
    expect(v.message).toMatch(/last attested: not recorded/i);
  });

  it('doctrine row with a null canonicalSource → info with the no-external-source phrasing', () => {
    const v = detectManualAttestationContract(
      doctrineContract({ canonicalSource: null }),
      maCtx({ readPackageJson: throwingRead }),
    );
    expect(v.status).toBe('info');
    expect(v.message).toMatch(/no external canonical source/i);
  });

  // ── attested seam (forward-compat for the strategy `last-attested:` follow-on) ──
  it('attested date supplied → message reports it; status stays info (staleness is a message refinement, not a status)', () => {
    const v = detectManualAttestationContract(
      doctrineContract(),
      maCtx({ attested: '2026-06-04', readPackageJson: throwingRead }),
    );
    expect(v.status).toBe('info');
    expect(v.message).toContain('last attested 2026-06-04');
  });

  // ── Claim-class ceiling KEYSTONE: info|skip ONLY, never pass/warn/fail/unknown ──
  it('claim-class ceiling: across every input shape the verdict is ONLY info or skip', () => {
    writeConsumerPkg(tmpRoot, { '@google/genai': '^0.3.0' });
    const verdicts = [
      // vendor declared (resolves via minVersion fallback) → info
      detectManualAttestationContract(vendorContract(), maCtx()),
      // vendor not declared → skip
      detectManualAttestationContract(vendorContract({ package: '@not/installed' }), maCtx()),
      // vendor invalid range → info (installed unresolved)
      detectManualAttestationContract(
        vendorContract({ package: '@google/genai' }),
        maCtx({ readPackageJson: () => ({ dependencies: { '@google/genai': '@@bad@@' } }) }),
      ),
      // not-a-consumer → skip
      detectManualAttestationContract(
        vendorContract({ consumers: ['liquid-city'] }),
        maCtx({ repoId: 'totem-status' }),
      ),
      // repoId unresolvable on a scoped contract → skip
      detectManualAttestationContract(
        vendorContract({ consumers: ['totem'] }),
        maCtx({ repoId: undefined }),
      ),
      // doctrine row → info
      detectManualAttestationContract(doctrineContract(), maCtx({ readPackageJson: throwingRead })),
      // doctrine null source → info
      detectManualAttestationContract(
        doctrineContract({ canonicalSource: null }),
        maCtx({ readPackageJson: throwingRead }),
      ),
    ];
    for (const v of verdicts) {
      expect(['info', 'skip']).toContain(v.status);
      expect(v.status).not.toBe('pass');
      expect(v.status).not.toBe('warn');
      expect(v.status).not.toBe('fail');
      expect(v.status).not.toBe('unknown');
    }
  });
});

// ─── detectCapabilityProbeContract (mmnto-ai/totem#2140) ──

/** Write a JSON file at an arbitrary repo-relative path. */
function writeJson(rootDir: string, rel: string, value: unknown): string {
  const abs = path.join(rootDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(value, null, 2), 'utf-8');
  return abs;
}

/** A realistic .mcp.json registering the totem MCP server. */
const MCP_JSON_WITH_TOTEM = {
  mcpServers: {
    'totem-dev': { command: 'node', args: ['packages/mcp/dist/index.js'] },
    'totem-strategy': { command: 'totem', args: ['mcp', '--root', '../totem-strategy'] },
  },
};

describe('detectCapabilityProbeContract — mcp-registration probe', () => {
  it('WARN when .mcp.json is absent — no registered query path is the drift this row exists for', () => {
    const v = detectCapabilityProbeContract({
      kind: 'mcp-registration',
      consumerPath: path.join(tmpRoot, '.mcp.json'),
      probedLevel: 'present',
    });
    expect(v.status).toBe('warn');
    expect(v.message).toMatch(/no .mcp.json|not registered|no registered/i);
  });

  it('WARN when .mcp.json registers no totem server', () => {
    const abs = writeJson(tmpRoot, '.mcp.json', {
      mcpServers: { 'some-other': { command: 'other-tool', args: [] } },
    });
    const v = detectCapabilityProbeContract({
      kind: 'mcp-registration',
      consumerPath: abs,
      probedLevel: 'present',
    });
    expect(v.status).toBe('warn');
  });

  it('PASS at the probed level when registered AND the row declares no stronger level', () => {
    const abs = writeJson(tmpRoot, '.mcp.json', MCP_JSON_WITH_TOTEM);
    const v = detectCapabilityProbeContract({
      kind: 'mcp-registration',
      consumerPath: abs,
      probedLevel: 'present',
      declaredSenses: 'present',
    });
    expect(v.status).toBe('pass');
    // The §6(a)3 scoping: the verdict names the level it actually probed.
    expect(v.message).toContain('present');
  });

  it('UNKNOWN (green-halo cap) when the row declares usable but the probe only proves present', () => {
    // codex W3 / the 296 settlement class: a presence-only PASS must never read
    // as a capability PASS. probedLevel < declared senses → cap at unknown.
    const abs = writeJson(tmpRoot, '.mcp.json', MCP_JSON_WITH_TOTEM);
    const v = detectCapabilityProbeContract({
      kind: 'mcp-registration',
      consumerPath: abs,
      probedLevel: 'present',
      declaredSenses: 'usable',
    });
    expect(v.status).toBe('unknown');
    expect(v.message).toMatch(/usable/i);
    expect(v.message).toMatch(/present/i);
  });

  it('UNKNOWN on unparseable .mcp.json (can prove neither registration nor absence)', () => {
    const abs = path.join(tmpRoot, '.mcp.json');
    fs.writeFileSync(abs, '{ not valid json', 'utf-8');
    const v = detectCapabilityProbeContract({
      kind: 'mcp-registration',
      consumerPath: abs,
      probedLevel: 'present',
    });
    expect(v.status).toBe('unknown');
  });

  it('WARN (no crash, no index-keyed names) when mcpServers is a malformed ARRAY', () => {
    // GCA high on the #2140 PR: an array satisfies `typeof === 'object'` and
    // Object.entries over it would derive index-keyed "names" ('0', '1').
    const abs = writeJson(tmpRoot, '.mcp.json', {
      mcpServers: [{ command: 'totem', args: ['mcp'] }],
    });
    const v = detectCapabilityProbeContract({
      kind: 'mcp-registration',
      consumerPath: abs,
      probedLevel: 'present',
    });
    expect(v.status).toBe('warn');
    expect(v.message).not.toContain('[0]');
  });

  it('does NOT match a non-totem server whose command path merely contains "totem"', () => {
    // Greptile P2 on the #2140 PR: a path segment like /home/totem-projects/
    // must not classify an unrelated server as a totem server.
    const abs = writeJson(tmpRoot, '.mcp.json', {
      mcpServers: {
        'other-mcp': { command: '/home/totem-projects/other-mcp/run.sh', args: ['--serve'] },
      },
    });
    const v = detectCapabilityProbeContract({
      kind: 'mcp-registration',
      consumerPath: abs,
      probedLevel: 'present',
    });
    expect(v.status).toBe('warn'); // not recognized as totem → no registered query path
  });

  it('DOES match a totem server by command basename or @mmnto arg (derive-not-hardcode)', () => {
    const abs = writeJson(tmpRoot, '.mcp.json', {
      mcpServers: {
        'renamed-knowledge': { command: 'C:/tools/totem.exe', args: ['mcp'] },
        'scoped-runner': { command: 'node', args: ['node_modules/@mmnto/mcp/dist/index.js'] },
      },
    });
    const v = detectCapabilityProbeContract({
      kind: 'mcp-registration',
      consumerPath: abs,
      probedLevel: 'present',
      declaredSenses: 'present',
    });
    expect(v.status).toBe('pass');
    expect(v.message).toContain('renamed-knowledge');
    expect(v.message).toContain('scoped-runner');
  });

  it('NEVER throws — a throwing readFile seam degrades to a verdict', () => {
    const v = detectCapabilityProbeContract({
      kind: 'mcp-registration',
      consumerPath: path.join(tmpRoot, '.mcp.json'),
      probedLevel: 'present',
      readFile: () => {
        throw new TotemConfigError('synthetic read failure (test seam)', 'n/a — test fixture');
      },
    });
    expect(['warn', 'unknown', 'skip']).toContain(v.status);
  });
});

describe('detectCapabilityProbeContract — settings-floor probe', () => {
  it('PASS when .claude/settings.json is absent — the floor is "not suppressed", not "configured"', () => {
    const v = detectCapabilityProbeContract({
      kind: 'settings-floor',
      consumerPath: path.join(tmpRoot, '.claude', 'settings.json'),
      mcpJsonPath: path.join(tmpRoot, '.mcp.json'),
      probedLevel: 'present',
      declaredSenses: 'present',
    });
    expect(v.status).toBe('pass');
  });

  it('PASS when settings exist but suppress nothing', () => {
    writeJson(tmpRoot, '.mcp.json', MCP_JSON_WITH_TOTEM);
    const abs = writeJson(tmpRoot, '.claude/settings.json', {
      permissions: { allow: ['Read', 'Glob'] },
    });
    const v = detectCapabilityProbeContract({
      kind: 'settings-floor',
      consumerPath: abs,
      mcpJsonPath: path.join(tmpRoot, '.mcp.json'),
      probedLevel: 'present',
      declaredSenses: 'present',
    });
    expect(v.status).toBe('pass');
  });

  it('WARN when disableAllHooks suppresses the hook floor', () => {
    const abs = writeJson(tmpRoot, '.claude/settings.json', { disableAllHooks: true });
    const v = detectCapabilityProbeContract({
      kind: 'settings-floor',
      consumerPath: abs,
      mcpJsonPath: path.join(tmpRoot, '.mcp.json'),
      probedLevel: 'present',
      declaredSenses: 'present',
    });
    expect(v.status).toBe('warn');
    expect(v.message).toContain('disableAllHooks');
  });

  it('WARN when a totem MCP server (derived from .mcp.json) is explicitly disabled', () => {
    writeJson(tmpRoot, '.mcp.json', MCP_JSON_WITH_TOTEM);
    const abs = writeJson(tmpRoot, '.claude/settings.json', {
      disabledMcpjsonServers: ['totem-dev'],
    });
    const v = detectCapabilityProbeContract({
      kind: 'settings-floor',
      consumerPath: abs,
      mcpJsonPath: path.join(tmpRoot, '.mcp.json'),
      probedLevel: 'present',
      declaredSenses: 'present',
    });
    expect(v.status).toBe('warn');
    expect(v.message).toContain('totem-dev');
  });

  it('PASS when a NON-totem server is disabled — only the governance floor is in scope', () => {
    writeJson(tmpRoot, '.mcp.json', MCP_JSON_WITH_TOTEM);
    const abs = writeJson(tmpRoot, '.claude/settings.json', {
      disabledMcpjsonServers: ['some-other'],
    });
    const v = detectCapabilityProbeContract({
      kind: 'settings-floor',
      consumerPath: abs,
      mcpJsonPath: path.join(tmpRoot, '.mcp.json'),
      probedLevel: 'present',
      declaredSenses: 'present',
    });
    expect(v.status).toBe('pass');
  });

  it('PASS when settings.json is a shape-invalid ARRAY (cannot express suppression; not walked as an object)', () => {
    // GCA round 3: `typeof === 'object'` accepts arrays — guard mirrors
    // totemServerNames. An array settings doc degrades to suppresses-nothing.
    const abs = writeJson(tmpRoot, '.claude/settings.json', [{ disableAllHooks: true }]);
    const v = detectCapabilityProbeContract({
      kind: 'settings-floor',
      consumerPath: abs,
      mcpJsonPath: path.join(tmpRoot, '.mcp.json'),
      probedLevel: 'present',
      declaredSenses: 'present',
    });
    expect(v.status).toBe('pass');
  });

  it('UNKNOWN on unparseable settings JSON (cannot prove the floor either way)', () => {
    const abs = path.join(tmpRoot, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '{ nope', 'utf-8');
    const v = detectCapabilityProbeContract({
      kind: 'settings-floor',
      consumerPath: abs,
      mcpJsonPath: path.join(tmpRoot, '.mcp.json'),
      probedLevel: 'present',
      declaredSenses: 'present',
    });
    expect(v.status).toBe('unknown');
  });

  it('probe verdicts never include fail or info', () => {
    const abs = writeJson(tmpRoot, '.claude/settings.json', { disableAllHooks: true });
    const verdicts = [
      detectCapabilityProbeContract({
        kind: 'settings-floor',
        consumerPath: abs,
        mcpJsonPath: path.join(tmpRoot, '.mcp.json'),
        probedLevel: 'present',
      }),
      detectCapabilityProbeContract({
        kind: 'mcp-registration',
        consumerPath: path.join(tmpRoot, '.mcp.json'),
        probedLevel: 'present',
      }),
    ];
    for (const v of verdicts) {
      expect(['pass', 'warn', 'skip', 'unknown']).toContain(v.status);
    }
  });
});

// ─── Declared-floor verdict rendering (mmnto-ai/totem#2140, 296 §6(a)3 post-#605) ──

describe('declared-min fallback rendering', () => {
  it('version-pinned PASS via the minVersion fallback renders the declared level + originating range', () => {
    writeSelfInTree(tmpRoot, '1.50.0');
    writeConsumerPkg(tmpRoot, { '@mmnto/totem': '^1.53.0' });
    // NO writeInstalled — resolution falls back to minVersion of the range.
    const verdict = detectVersionPinnedContract(depsContract(), baseCtx({ repoId: 'totem' }));
    expect(verdict.status).toBe('pass');
    expect(verdict.message).toMatch(/declared/i);
    expect(verdict.message).toContain('^1.53.0'); // the originating range (codex I1)
    expect(verdict.message).not.toMatch(/installed 1\.53\.0/);
  });

  it('version-pinned WARN via the minVersion fallback renders the declared level', () => {
    writeSelfInTree(tmpRoot, '2.0.0');
    writeConsumerPkg(tmpRoot, { '@mmnto/totem': '^1.40.0' });
    const verdict = detectVersionPinnedContract(depsContract(), baseCtx({ repoId: 'totem' }));
    expect(verdict.status).toBe('warn');
    expect(verdict.message).toMatch(/declared/i);
    expect(verdict.message).toContain('^1.40.0');
  });

  it('a RESOLVED install still renders as installed (no declared marking)', () => {
    writeSelfInTree(tmpRoot, '1.50.0');
    writeConsumerPkg(tmpRoot, { '@mmnto/totem': '^1.50.0' });
    writeInstalled(tmpRoot, '@mmnto/totem', '1.53.3');
    const verdict = detectVersionPinnedContract(depsContract(), baseCtx({ repoId: 'totem' }));
    expect(verdict.status).toBe('pass');
    expect(verdict.message).toContain('installed 1.53.3');
    expect(verdict.message).not.toMatch(/declared-min/i);
  });

  it('manual-attestation vendor-SDK info renders declared-min when no install resolves (shared helper)', () => {
    writeConsumerPkg(tmpRoot, { '@anthropic-ai/sdk': '^0.98.0' });
    const v = detectManualAttestationContract(
      depsContract({
        id: 'anthropic-sdk-coupling',
        tractability: 'manual-attestation',
        package: '@anthropic-ai/sdk',
        canonicalSource: null,
      }),
      { cwd: tmpRoot, repoId: 'totem' },
    );
    expect(v.status).toBe('info');
    expect(v.message).toMatch(/declared/i);
    expect(v.message).toContain('^0.98.0');
    expect(v.message).not.toMatch(/installed 0\.98\.0/);
  });
});

// ─── detectValueEqualityContract (mmnto-ai/totem-strategy#738 Slice A) ──

describe('detectValueEqualityContract', () => {
  /** A value-equality bot-review-config contract (defaults to the cr-profile shape). */
  function veContract(over: Partial<ParityContract> = {}): ParityContract {
    return {
      id: 'cr-profile',
      dimension: 'bot-review-configs',
      canonicalSource: 'mmnto-ai/totem-strategy:.coderabbit.yaml#reviews.profile',
      detectionMethod: 'file-value-equality',
      expectedValueOrDerivation: 'assertive',
      tractability: 'mechanical',
      trackingIssue: 'mmnto-ai/totem-strategy#501',
      manifestation: 'value-equality',
      senses: 'present',
      ...over,
    };
  }

  function veField(over: Partial<ValueEqualityField> = {}): ValueEqualityField {
    return {
      consumerPath: '/repo/.coderabbit.yaml',
      pathSegments: ['reviews', 'profile'],
      format: 'yaml',
      lineName: 'Parity: cr-profile',
      ...over,
    };
  }

  /** An injected read seam backed by a fixed path→content map (undefined = absent). */
  function reader(map: Record<string, string>): (p: string) => string | undefined {
    return (p) => map[p];
  }

  const CR_YAML = '/repo/.coderabbit.yaml';
  const GCA_YAML = '/repo/.gemini/config.yaml';
  const GREPTILE_JSON = '/repo/greptile.json';

  it('pass — string scalar matches the expected', () => {
    const v = detectValueEqualityContract(veContract(), {
      field: veField(),
      readFile: reader({ [CR_YAML]: 'reviews:\n  profile: assertive\n' }),
    });
    expect(v.status).toBe('pass');
    expect(v.message).toContain('reviews.profile');
  });

  it('warn — present-but-mismatched string scalar', () => {
    const v = detectValueEqualityContract(veContract(), {
      field: veField(),
      readFile: reader({ [CR_YAML]: 'reviews:\n  profile: chill\n' }),
    });
    expect(v.status).toBe('warn');
    expect(v.message).toMatch(/found "chill", expected assertive/);
  });

  it('pass — YAML boolean false matches expected token "false" (typed compare)', () => {
    const v = detectValueEqualityContract(
      veContract({ id: 'cr-on-demand', expectedValueOrDerivation: 'false' }),
      {
        field: veField({
          pathSegments: ['reviews', 'auto_review', 'enabled'],
          lineName: 'Parity: cr-on-demand',
        }),
        readFile: reader({ [CR_YAML]: 'reviews:\n  auto_review:\n    enabled: false\n' }),
      },
    );
    expect(v.status).toBe('pass');
  });

  it('warn — the STRING "false" does not match a boolean expected (no laundering)', () => {
    const v = detectValueEqualityContract(
      veContract({ id: 'cr-on-demand', expectedValueOrDerivation: 'false' }),
      {
        field: veField({
          pathSegments: ['reviews', 'auto_review', 'enabled'],
          lineName: 'Parity: cr-on-demand',
        }),
        // Quoted → YAML parses a STRING "false", not the boolean.
        readFile: reader({ [CR_YAML]: 'reviews:\n  auto_review:\n    enabled: "false"\n' }),
      },
    );
    expect(v.status).toBe('warn');
  });

  it('skip — file wholly absent is applicable-but-missing (scaffold hedge)', () => {
    const v = detectValueEqualityContract(veContract(), {
      field: veField(),
      readFile: reader({}),
    });
    expect(v.status).toBe('skip');
    expect(v.message).toMatch(/not present.*scaffold/i);
  });

  it('warn — path absent on a present file', () => {
    const v = detectValueEqualityContract(veContract(), {
      field: veField(),
      readFile: reader({ [CR_YAML]: 'reviews: {}\n' }),
    });
    expect(v.status).toBe('warn');
    expect(v.message).toMatch(/not declared/i);
  });

  it('warn — traversal through a non-object yields path-absent drift', () => {
    const v = detectValueEqualityContract(veContract(), {
      field: veField(),
      // `reviews` is a scalar, so `reviews.profile` cannot resolve.
      readFile: reader({ [CR_YAML]: 'reviews: assertive\n' }),
    });
    expect(v.status).toBe('warn');
    expect(v.message).toMatch(/not declared/i);
  });

  it('unknown — present-but-unparseable file (not a config-validity detector)', () => {
    const v = detectValueEqualityContract(
      veContract({ id: 'greptile-on-demand', expectedValueOrDerivation: 'AUTOMATIC' }),
      {
        field: veField({
          consumerPath: GREPTILE_JSON,
          pathSegments: ['skipReview'],
          format: 'json',
          lineName: 'Parity: greptile-on-demand',
        }),
        readFile: reader({ [GREPTILE_JSON]: '{ "skipReview": ' }), // truncated JSON
      },
    );
    expect(v.status).toBe('unknown');
    expect(v.message).toMatch(/unparseable JSON/i);
  });

  it('pass — JSON greptile skipReview string scalar', () => {
    const v = detectValueEqualityContract(
      veContract({ id: 'greptile-on-demand', expectedValueOrDerivation: 'AUTOMATIC' }),
      {
        field: veField({
          consumerPath: GREPTILE_JSON,
          pathSegments: ['skipReview'],
          format: 'json',
          lineName: 'Parity: greptile-on-demand',
        }),
        readFile: reader({ [GREPTILE_JSON]: '{ "skipReview": "AUTOMATIC" }' }),
      },
    );
    expect(v.status).toBe('pass');
  });

  it('pass — gca switch nested under the top-level code_review block', () => {
    const gca =
      'code_review:\n  pull_request_opened:\n    summary: false\n    code_review: false\n';
    const v = detectValueEqualityContract(
      veContract({ id: 'gca-summary', expectedValueOrDerivation: 'false' }),
      {
        field: veField({
          consumerPath: GCA_YAML,
          pathSegments: ['code_review', 'pull_request_opened', 'summary'],
          lineName: 'Parity: gca-summary',
        }),
        readFile: reader({ [GCA_YAML]: gca }),
      },
    );
    expect(v.status).toBe('pass');
  });

  it('pass — CRLF in a YAML string value is normalized before compare', () => {
    const v = detectValueEqualityContract(veContract(), {
      field: veField(),
      // win32 checkout: CRLF line endings must not change a scalar read.
      readFile: reader({ [CR_YAML]: 'reviews:\r\n  profile: assertive\r\n' }),
    });
    expect(v.status).toBe('pass');
  });

  it('skip — not a consumer (scoped out)', () => {
    const v = detectValueEqualityContract(veContract({ consumers: ['totem-status'] }), {
      repoId: 'liquid-city',
      field: veField(),
      readFile: reader({ [CR_YAML]: 'reviews:\n  profile: chill\n' }),
    });
    expect(v.status).toBe('skip');
    expect(v.message).toMatch(/cohort permits absence/i);
  });

  it('skip — repo id unresolvable under a consumers scope', () => {
    const v = detectValueEqualityContract(veContract({ consumers: ['totem'] }), {
      field: veField(),
      readFile: reader({ [CR_YAML]: 'reviews:\n  profile: chill\n' }),
    });
    expect(v.status).toBe('skip');
    expect(v.message).toMatch(/repo id unresolvable/i);
  });

  it('skip — no expected value declared', () => {
    const v = detectValueEqualityContract(veContract({ expectedValueOrDerivation: '   ' }), {
      field: veField(),
      readFile: reader({ [CR_YAML]: 'reviews:\n  profile: assertive\n' }),
    });
    expect(v.status).toBe('skip');
    expect(v.message).toMatch(/no expected value/i);
  });

  it('never emits fail (the CLI edge owns --strict promotion)', () => {
    const statuses = new Set<string>();
    for (const content of [
      'reviews:\n  profile: assertive\n',
      'reviews:\n  profile: chill\n',
      'reviews: {}\n',
    ]) {
      statuses.add(
        detectValueEqualityContract(veContract(), {
          field: veField(),
          readFile: reader({ [CR_YAML]: content }),
        }).status,
      );
    }
    expect(statuses.has('fail')).toBe(false);
  });

  it('claim-class bound — a pass never asserts enforcement/loaded behavior', () => {
    const v = detectValueEqualityContract(veContract(), {
      field: veField(),
      readFile: reader({ [CR_YAML]: 'reviews:\n  profile: assertive\n' }),
    });
    expect(v.status).toBe('pass');
    expect(v.message).not.toMatch(/enforc|on-demand|loaded|disabled/i);
  });

  it('unknown — unsupported format (a JS caller / registry typo, never a silent YAML parse)', () => {
    const v = detectValueEqualityContract(veContract(), {
      field: veField({ format: 'xml' as unknown as ValueEqualityField['format'] }),
      readFile: reader({ [CR_YAML]: 'reviews:\n  profile: assertive\n' }),
    });
    expect(v.status).toBe('unknown');
    expect(v.message).toMatch(/unsupported value-equality format/i);
  });

  it('unknown — the unparseable message carries the parser error detail', () => {
    const v = detectValueEqualityContract(
      veContract({ id: 'greptile-on-demand', expectedValueOrDerivation: 'AUTOMATIC' }),
      {
        field: veField({
          consumerPath: GREPTILE_JSON,
          pathSegments: ['skipReview'],
          format: 'json',
          lineName: 'Parity: greptile-on-demand',
        }),
        readFile: reader({ [GREPTILE_JSON]: '{ "skipReview": ' }), // truncated JSON
      },
    );
    expect(v.status).toBe('unknown');
    // The detail suffix (`: <parser first line>`) follows the format label.
    expect(v.message).toMatch(/unparseable JSON: \S/);
  });
});
