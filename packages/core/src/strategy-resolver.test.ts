/**
 * Tests for `resolveStrategyRoot` (mmnto-ai/totem#1710).
 *
 * The resolver is filesystem-driven, so tests construct real temp directories
 * for the four precedence layers (env / config / sibling / submodule) and
 * pass `gitRoot` via the test seam to avoid mocking `cross-spawn`. The seam
 * mirrors `governance.ts`'s `ScaffoldArtifactInternals.exec` pattern:
 * production callers omit `gitRoot` and the resolver invokes
 * `resolveGitRoot(cwd)` internally; tests pass it explicitly.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveStrategyRoot } from './strategy-resolver.js';
import { cleanTmpDir } from './test-utils.js';

let tmpRoot: string;
let gitRoot: string;
let cwd: string;
let strategyParent: string;

const ENV_KEYS = ['TOTEM_STRATEGY_ROOT', 'STRATEGY_ROOT'] as const;
type EmptyEnv = Record<string, string | undefined>;

function emptyEnv(): EmptyEnv {
  return {};
}

function mkDir(p: string): string {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

function mkFile(p: string, content = ''): string {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

beforeEach(() => {
  // Layout per test:
  //   <tmpRoot>/
  //     repo/             ← gitRoot + cwd
  //     totem-strategy/   ← sibling target (created per-test as needed)
  //     elsewhere/        ← env / config target (created per-test as needed)
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-strategy-resolver-'));
  gitRoot = mkDir(path.join(tmpRoot, 'repo'));
  cwd = gitRoot;
  strategyParent = tmpRoot;
});

afterEach(() => {
  cleanTmpDir(tmpRoot);
  // Ensure no env leakage between tests — defensive even though tests pass
  // an explicit `env` to the resolver.
  for (const k of ENV_KEYS) delete process.env[k];
});

// ─── Precedence ────────────────────────────────────────────────────────────

describe('resolveStrategyRoot precedence', () => {
  it('returns env source when TOTEM_STRATEGY_ROOT points to a directory', () => {
    const target = mkDir(path.join(tmpRoot, 'elsewhere'));
    const status = resolveStrategyRoot(cwd, {
      gitRoot,
      env: { TOTEM_STRATEGY_ROOT: target },
    });
    expect(status).toEqual({ resolved: true, path: path.normalize(target), source: 'env' });
  });

  it('accepts STRATEGY_ROOT as a fallback alias when TOTEM_STRATEGY_ROOT is unset', () => {
    const target = mkDir(path.join(tmpRoot, 'elsewhere'));
    const status = resolveStrategyRoot(cwd, {
      gitRoot,
      env: { STRATEGY_ROOT: target },
    });
    expect(status).toEqual({ resolved: true, path: path.normalize(target), source: 'env' });
  });

  it('prefers TOTEM_STRATEGY_ROOT over STRATEGY_ROOT when both are set', () => {
    const preferred = mkDir(path.join(tmpRoot, 'preferred'));
    const alias = mkDir(path.join(tmpRoot, 'alias'));
    const status = resolveStrategyRoot(cwd, {
      gitRoot,
      env: { TOTEM_STRATEGY_ROOT: preferred, STRATEGY_ROOT: alias },
    });
    expect(status).toEqual({
      resolved: true,
      path: path.normalize(preferred),
      source: 'env',
    });
  });

  it('returns config source when env is unset and config.strategyRoot is set', () => {
    const target = mkDir(path.join(tmpRoot, 'elsewhere'));
    const status = resolveStrategyRoot(cwd, {
      gitRoot,
      env: emptyEnv(),
      config: { strategyRoot: target },
    });
    expect(status).toEqual({
      resolved: true,
      path: path.normalize(target),
      source: 'config',
    });
  });

  it('returns sibling source when env+config unset and ../totem-strategy exists', () => {
    const sibling = mkDir(path.join(strategyParent, 'totem-strategy'));
    const status = resolveStrategyRoot(cwd, { gitRoot, env: emptyEnv() });
    expect(status).toEqual({
      resolved: true,
      path: path.normalize(sibling),
      source: 'sibling',
    });
  });

  it('returns submodule source when env+config+sibling missing and .strategy exists', () => {
    const submodule = mkDir(path.join(gitRoot, '.strategy'));
    const status = resolveStrategyRoot(cwd, { gitRoot, env: emptyEnv() });
    expect(status).toEqual({
      resolved: true,
      path: path.normalize(submodule),
      source: 'submodule',
    });
  });

  it('falls through to unresolved when all four layers fail', () => {
    const status = resolveStrategyRoot(cwd, { gitRoot, env: emptyEnv() });
    expect(status.resolved).toBe(false);
    if (!status.resolved) {
      expect(status.reason).not.toBe('');
    }
  });

  it('short-circuits at env even when sibling and submodule both exist', () => {
    mkDir(path.join(strategyParent, 'totem-strategy'));
    mkDir(path.join(gitRoot, '.strategy'));
    const target = mkDir(path.join(tmpRoot, 'elsewhere'));
    const status = resolveStrategyRoot(cwd, {
      gitRoot,
      env: { TOTEM_STRATEGY_ROOT: target },
    });
    expect(status).toMatchObject({ resolved: true, source: 'env' });
  });

  it('short-circuits at sibling before falling through to submodule', () => {
    const sibling = mkDir(path.join(strategyParent, 'totem-strategy'));
    mkDir(path.join(gitRoot, '.strategy'));
    const status = resolveStrategyRoot(cwd, { gitRoot, env: emptyEnv() });
    expect(status).toEqual({
      resolved: true,
      path: path.normalize(sibling),
      source: 'sibling',
    });
  });
});

// ─── isDirectory guard ─────────────────────────────────────────────────────

describe('resolveStrategyRoot isDirectory guard', () => {
  it('rejects env value pointing at a file (not a directory) and falls through', () => {
    const file = mkFile(path.join(tmpRoot, 'not-a-dir'));
    const sibling = mkDir(path.join(strategyParent, 'totem-strategy'));
    const status = resolveStrategyRoot(cwd, {
      gitRoot,
      env: { TOTEM_STRATEGY_ROOT: file },
    });
    expect(status).toEqual({
      resolved: true,
      path: path.normalize(sibling),
      source: 'sibling',
    });
  });

  it('rejects config value pointing at a file and falls through', () => {
    const file = mkFile(path.join(tmpRoot, 'not-a-dir'));
    const submodule = mkDir(path.join(gitRoot, '.strategy'));
    const status = resolveStrategyRoot(cwd, {
      gitRoot,
      env: emptyEnv(),
      config: { strategyRoot: file },
    });
    expect(status).toEqual({
      resolved: true,
      path: path.normalize(submodule),
      source: 'submodule',
    });
  });

  it('rejects sibling that exists but is a file', () => {
    mkFile(path.join(strategyParent, 'totem-strategy'));
    const submodule = mkDir(path.join(gitRoot, '.strategy'));
    const status = resolveStrategyRoot(cwd, { gitRoot, env: emptyEnv() });
    expect(status).toEqual({
      resolved: true,
      path: path.normalize(submodule),
      source: 'submodule',
    });
  });

  it('rejects submodule that exists but is a file', () => {
    mkFile(path.join(gitRoot, '.strategy'));
    const status = resolveStrategyRoot(cwd, { gitRoot, env: emptyEnv() });
    expect(status.resolved).toBe(false);
  });
});

// ─── Git-root anchoring ───────────────────────────────────────────────────

describe('resolveStrategyRoot git-root anchoring', () => {
  it('anchors relative env values at gitRoot, not at deep cwd', () => {
    const sibling = mkDir(path.join(strategyParent, 'totem-strategy'));
    const deepCwd = mkDir(path.join(gitRoot, 'packages', 'mcp', 'src'));
    const status = resolveStrategyRoot(deepCwd, {
      gitRoot,
      env: { TOTEM_STRATEGY_ROOT: '../totem-strategy' },
    });
    expect(status).toEqual({
      resolved: true,
      path: path.normalize(sibling),
      source: 'env',
    });
  });

  it('anchors relative config values at gitRoot', () => {
    const sibling = mkDir(path.join(strategyParent, 'totem-strategy'));
    const deepCwd = mkDir(path.join(gitRoot, 'packages', 'core', 'src'));
    const status = resolveStrategyRoot(deepCwd, {
      gitRoot,
      env: emptyEnv(),
      config: { strategyRoot: '../totem-strategy' },
    });
    expect(status).toEqual({
      resolved: true,
      path: path.normalize(sibling),
      source: 'config',
    });
  });

  it('returns unresolved when gitRoot is null and no env/config override is set', () => {
    const status = resolveStrategyRoot(cwd, { gitRoot: null, env: emptyEnv() });
    expect(status.resolved).toBe(false);
    if (!status.resolved) {
      expect(status.reason).toMatch(/git/i);
    }
  });

  it('still resolves env when gitRoot is null but env is absolute', () => {
    const target = mkDir(path.join(tmpRoot, 'elsewhere'));
    const status = resolveStrategyRoot(cwd, {
      gitRoot: null,
      env: { TOTEM_STRATEGY_ROOT: target },
    });
    expect(status).toEqual({
      resolved: true,
      path: path.normalize(target),
      source: 'env',
    });
  });

  it('still resolves config when gitRoot is null but config value is absolute', () => {
    const target = mkDir(path.join(tmpRoot, 'elsewhere'));
    const status = resolveStrategyRoot(cwd, {
      gitRoot: null,
      env: emptyEnv(),
      config: { strategyRoot: target },
    });
    expect(status).toEqual({
      resolved: true,
      path: path.normalize(target),
      source: 'config',
    });
  });

  it('returns unresolved when gitRoot is null and env value is relative', () => {
    const status = resolveStrategyRoot(cwd, {
      gitRoot: null,
      env: { TOTEM_STRATEGY_ROOT: '../totem-strategy' },
    });
    expect(status.resolved).toBe(false);
  });
});

// ─── Returned shape ────────────────────────────────────────────────────────

describe('resolveStrategyRoot returned shape', () => {
  it('returns an absolute path on the resolved branch', () => {
    const sibling = mkDir(path.join(strategyParent, 'totem-strategy'));
    const status = resolveStrategyRoot(cwd, { gitRoot, env: emptyEnv() });
    expect(status).toMatchObject({ resolved: true, source: 'sibling' });
    if (status.resolved) {
      expect(path.isAbsolute(status.path)).toBe(true);
      expect(status.path).toBe(path.normalize(sibling));
    }
  });

  it('exposes a non-empty reason on the unresolved branch', () => {
    const status = resolveStrategyRoot(cwd, { gitRoot, env: emptyEnv() });
    expect(status.resolved).toBe(false);
    if (!status.resolved) {
      expect(status.reason).toMatch(/strategy/i);
      expect(status.reason).toMatch(/sibling|submodule|env|config/i);
    }
  });

  it('treats whitespace-only env values as unset (falls through)', () => {
    const submodule = mkDir(path.join(gitRoot, '.strategy'));
    const status = resolveStrategyRoot(cwd, {
      gitRoot,
      env: { TOTEM_STRATEGY_ROOT: '   ' },
    });
    expect(status).toEqual({
      resolved: true,
      path: path.normalize(submodule),
      source: 'submodule',
    });
  });
});
