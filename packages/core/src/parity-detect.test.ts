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

import {
  deriveCohortRepoId,
  type DetectVersionPinnedContext,
  detectVersionPinnedContract,
  packageNameForContract,
  resolveCohortFloor,
} from './parity-detect.js';
import type { ParityContract } from './parity-manifest.js';
import { cleanTmpDir } from './test-utils.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-parity-detect-'));
});

afterEach(() => {
  cleanTmpDir(tmpRoot);
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
