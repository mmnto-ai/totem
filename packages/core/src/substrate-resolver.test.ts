/**
 * Tests for `resolveSubstratePaths` (mmnto-ai/totem#1820, ADR-100 Phase C).
 *
 * Filesystem-driven; tests construct real temp directories for each
 * precedence layer (env / config / sibling-walk / repo-local sediment)
 * and pass `env` / `config` via the option seams to avoid touching
 * `process.env`. Per-test cleanup wipes the tmp tree so a re-run starts
 * from a clean state.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resolveSubstratePaths,
  type SubstrateResolverConfig,
  type SubstrateResolverOptions,
} from './substrate-resolver.js';
import { cleanTmpDir } from './test-utils.js';

const ENV_KEYS = ['TOTEM_SUBSTRATE_PATH'] as const;
type EmptyEnv = Record<string, string | undefined>;

let tmpRoot: string;
let configRoot: string;
let parent: string;

function emptyEnv(): EmptyEnv {
  return {};
}

function mkDir(p: string): string {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

/**
 * Build a fully-shaped substrate clone at `dir` — git metadata subdir +
 * handoff + journal subdirs all present. Returns the absolute dir path.
 */
function mkSubstrate(dir: string): string {
  mkDir(dir);
  // totem-context: building a fake substrate fixture for shape-gate test; not a gitRoot probe — see substrate-resolver.ts validateSubstrateShape JSDoc.
  mkDir(path.join(dir, '.git'));
  mkDir(path.join(dir, '.handoff'));
  mkDir(path.join(dir, '.journal'));
  return dir;
}

beforeEach(() => {
  // Layout:
  //   <tmpRoot>/
  //     parent/
  //       repo/             ← configRoot
  //       totem-substrate/  ← sibling target (per-test)
  //     elsewhere/          ← env / config target (per-test)
  // totem-context: test fixture only; agents do not consume this temp dir.
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-substrate-resolver-'));
  parent = mkDir(path.join(tmpRoot, 'parent'));
  configRoot = mkDir(path.join(parent, 'repo'));
});

afterEach(() => {
  cleanTmpDir(tmpRoot);
  for (const k of ENV_KEYS) delete process.env[k];
});

// ─── Task 1 — substrate shape validation ───────────────────────────────────

describe('resolveSubstratePaths shape validation', () => {
  // TEST DIRECTIVE (Task 1): a valid directory missing one of the three
  // expected subdirs MUST be rejected by the internal validator and the
  // resolver MUST fall through to the next layer.
  it('rejects empty directory without required substrate shape', () => {
    const incomplete = mkDir(path.join(tmpRoot, 'incomplete-substrate'));
    // totem-context: fake substrate fixture; shape gate, not gitRoot probe.
    mkDir(path.join(incomplete, '.git'));
    mkDir(path.join(incomplete, '.handoff'));
    // .journal intentionally missing → shape invalid

    const result = resolveSubstratePaths(configRoot, {
      env: { TOTEM_SUBSTRATE_PATH: incomplete },
    });

    // Env layer rejects on shape miss; no other layers populated → 'none'.
    expect(result).toEqual({
      handoffRoot: null,
      journalRoot: null,
      source: 'none',
    });
  });

  it('rejects directory missing the git subdir (sibling-walk layer)', () => {
    // No git metadata subdir — looks like an empty `totem-substrate` dir
    // created by accident, not a real clone.
    const stale = mkDir(path.join(parent, 'totem-substrate'));
    mkDir(path.join(stale, '.handoff'));
    mkDir(path.join(stale, '.journal'));

    const result = resolveSubstratePaths(configRoot, { env: emptyEnv() });

    // Sibling-walk layer rejects on shape miss; no other layers populated → 'none'.
    expect(result.source).toBe('none');
  });

  it('accepts a fully-shaped substrate (env layer)', () => {
    const real = mkSubstrate(path.join(tmpRoot, 'elsewhere'));

    const result = resolveSubstratePaths(configRoot, {
      env: { TOTEM_SUBSTRATE_PATH: real },
    });

    expect(result).toEqual({
      handoffRoot: path.normalize(path.join(real, '.handoff')),
      journalRoot: path.normalize(path.join(real, '.journal')),
      source: 'substrate',
    });
  });
});

// ─── Task 2 — precedence cascade ───────────────────────────────────────────

describe('resolveSubstratePaths precedence', () => {
  it('returns substrate source when TOTEM_SUBSTRATE_PATH points to a valid clone', () => {
    const target = mkSubstrate(path.join(tmpRoot, 'env-target'));
    const result = resolveSubstratePaths(configRoot, {
      env: { TOTEM_SUBSTRATE_PATH: target },
    });
    expect(result.source).toBe('substrate');
    expect(result.handoffRoot).toBe(path.normalize(path.join(target, '.handoff')));
  });

  it('returns substrate source when env is unset and config.substratePath is set', () => {
    const target = mkSubstrate(path.join(tmpRoot, 'config-target'));
    const result = resolveSubstratePaths(configRoot, {
      env: emptyEnv(),
      config: { substratePath: target },
    });
    expect(result.source).toBe('substrate');
    expect(result.handoffRoot).toBe(path.normalize(path.join(target, '.handoff')));
  });

  it('prefers env over config when both are set', () => {
    const envTarget = mkSubstrate(path.join(tmpRoot, 'env-pref'));
    const configTarget = mkSubstrate(path.join(tmpRoot, 'config-pref'));
    const result = resolveSubstratePaths(configRoot, {
      env: { TOTEM_SUBSTRATE_PATH: envTarget },
      config: { substratePath: configTarget },
    });
    expect(result.handoffRoot).toBe(path.normalize(path.join(envTarget, '.handoff')));
  });

  it('returns substrate source when env+config unset and ../totem-substrate exists', () => {
    const sibling = mkSubstrate(path.join(parent, 'totem-substrate'));
    const result = resolveSubstratePaths(configRoot, { env: emptyEnv() });
    expect(result).toEqual({
      handoffRoot: path.normalize(path.join(sibling, '.handoff')),
      journalRoot: path.normalize(path.join(sibling, '.journal')),
      source: 'substrate',
    });
  });

  it('prefers config over sibling-walk when both resolve', () => {
    mkSubstrate(path.join(parent, 'totem-substrate'));
    const configTarget = mkSubstrate(path.join(tmpRoot, 'config-pref'));
    const result = resolveSubstratePaths(configRoot, {
      env: emptyEnv(),
      config: { substratePath: configTarget },
    });
    expect(result.handoffRoot).toBe(path.normalize(path.join(configTarget, '.handoff')));
  });

  it('falls through env when path is missing — config takes over', () => {
    const configTarget = mkSubstrate(path.join(tmpRoot, 'config-fallback'));
    const result = resolveSubstratePaths(configRoot, {
      env: { TOTEM_SUBSTRATE_PATH: path.join(tmpRoot, 'does-not-exist') },
      config: { substratePath: configTarget },
    });
    expect(result.source).toBe('substrate');
    expect(result.handoffRoot).toBe(path.normalize(path.join(configTarget, '.handoff')));
  });

  it('treats whitespace-only env value as unset', () => {
    const sibling = mkSubstrate(path.join(parent, 'totem-substrate'));
    const result = resolveSubstratePaths(configRoot, {
      env: { TOTEM_SUBSTRATE_PATH: '   ' },
    });
    expect(result.handoffRoot).toBe(path.normalize(path.join(sibling, '.handoff')));
  });

  it('treats whitespace-only config value as unset', () => {
    const sibling = mkSubstrate(path.join(parent, 'totem-substrate'));
    const result = resolveSubstratePaths(configRoot, {
      env: emptyEnv(),
      config: { substratePath: '   ' },
    });
    expect(result.handoffRoot).toBe(path.normalize(path.join(sibling, '.handoff')));
  });

  it('treats non-string config.substratePath as unset (R5 — runtime type guard)', () => {
    const sibling = mkSubstrate(path.join(parent, 'totem-substrate'));
    const result = resolveSubstratePaths(configRoot, {
      env: emptyEnv(),
      // totem-context: cast is the SUBJECT of the test — proves the resolver's runtime guard catches non-string inputs that bypass TS type-checking.
      config: { substratePath: 42 as unknown as string },
    });
    expect(result.source).toBe('substrate');
    expect(result.handoffRoot).toBe(path.normalize(path.join(sibling, '.handoff')));
  });
});

// ─── Sibling-walk depth cap ────────────────────────────────────────────────

describe('resolveSubstratePaths sibling-walk', () => {
  // TEST DIRECTIVE (Task 2): a configRoot deeper than 3 levels from the
  // substrate sibling MUST NOT find it via walk; falls through.
  it('bounds sibling discovery to maximum 3 directory levels', () => {
    // Layout: <tmpRoot>/totem-substrate/ + <tmpRoot>/a/b/c/d/e/repo
    // Walk from repo: depth 1 = e, 2 = d, 3 = c. Looking for
    // c/totem-substrate, d/totem-substrate, e/totem-substrate at each
    // level. None is at <tmpRoot>/, so depth-cap stops the walk
    // before finding the substrate at <tmpRoot>/totem-substrate.
    mkSubstrate(path.join(tmpRoot, 'totem-substrate'));
    const deepRepo = mkDir(path.join(tmpRoot, 'a', 'b', 'c', 'd', 'e', 'repo'));

    const result = resolveSubstratePaths(deepRepo, { env: emptyEnv() });

    // Walk doesn't find substrate within 3 levels → falls through to
    // repo-local sediment (which is also absent) → 'none'.
    expect(result.source).toBe('none');
  });

  it('finds sibling within 3 levels — depth 1 (parent)', () => {
    const sibling = mkSubstrate(path.join(parent, 'totem-substrate'));
    const result = resolveSubstratePaths(configRoot, { env: emptyEnv() });
    expect(result.handoffRoot).toBe(path.normalize(path.join(sibling, '.handoff')));
  });

  it('finds sibling within 3 levels — depth 3 (grandparent of grandparent)', () => {
    // Layout: <tmpRoot>/totem-substrate/ + <tmpRoot>/a/b/repo
    // Walk: depth 1 = b, 2 = a, 3 = tmpRoot. Substrate at depth 3.
    const sibling = mkSubstrate(path.join(tmpRoot, 'totem-substrate'));
    const repo = mkDir(path.join(tmpRoot, 'a', 'b', 'repo'));
    const result = resolveSubstratePaths(repo, { env: emptyEnv() });
    expect(result.handoffRoot).toBe(path.normalize(path.join(sibling, '.handoff')));
  });

  it('does not loop infinitely when configRoot is at filesystem root', () => {
    // path.dirname('/') === '/' on posix; 'C:\\' on win32. Walk loop must
    // detect dirname-equals-self and break, not spin forever.
    const rootishPath = path.parse(tmpRoot).root;
    const result = resolveSubstratePaths(rootishPath, { env: emptyEnv() });
    // No assertion on source — just proving the call returns within the
    // test's effective timeout.
    expect(result).toBeDefined();
  });
});

// ─── Layer 4 — repo-local sediment ─────────────────────────────────────────

describe('resolveSubstratePaths repo-local sediment', () => {
  it('returns repo-local source when both .handoff/ and .journal/ exist locally', () => {
    mkDir(path.join(configRoot, '.handoff'));
    mkDir(path.join(configRoot, '.journal'));
    const result = resolveSubstratePaths(configRoot, { env: emptyEnv() });
    expect(result).toEqual({
      handoffRoot: path.normalize(path.join(configRoot, '.handoff')),
      journalRoot: path.normalize(path.join(configRoot, '.journal')),
      source: 'repo-local',
    });
  });

  it('returns partial repo-local when only .journal/ exists', () => {
    mkDir(path.join(configRoot, '.journal'));
    const result = resolveSubstratePaths(configRoot, { env: emptyEnv() });
    expect(result).toEqual({
      handoffRoot: null,
      journalRoot: path.normalize(path.join(configRoot, '.journal')),
      source: 'repo-local',
    });
  });

  it('returns partial repo-local when only .handoff/ exists', () => {
    mkDir(path.join(configRoot, '.handoff'));
    const result = resolveSubstratePaths(configRoot, { env: emptyEnv() });
    expect(result).toEqual({
      handoffRoot: path.normalize(path.join(configRoot, '.handoff')),
      journalRoot: null,
      source: 'repo-local',
    });
  });

  it('repo-local accepts placeholder-marker-only sediment dirs (Phase B cutover state)', () => {
    // Sediment-frozen dirs in product repos retain a placeholder marker
    // after Phase B markers landed. The resolver must accept these as
    // valid fallback (the consumer is responsible for handling
    // empty-content cases).
    const handoff = mkDir(path.join(configRoot, '.handoff'));
    // totem-context: writing a tracked-empty placeholder for fixture; not a hooks-manager bypass.
    fs.writeFileSync(path.join(handoff, '.gitkeep'), '');
    const journal = mkDir(path.join(configRoot, '.journal'));
    // totem-context: writing a tracked-empty placeholder for fixture; not a hooks-manager bypass.
    fs.writeFileSync(path.join(journal, '.gitkeep'), '');

    const result = resolveSubstratePaths(configRoot, { env: emptyEnv() });
    expect(result.source).toBe('repo-local');
    expect(result.handoffRoot).toBe(path.normalize(handoff));
    expect(result.journalRoot).toBe(path.normalize(journal));
  });
});

// ─── ADR-090 graceful degradation ──────────────────────────────────────────

describe('resolveSubstratePaths graceful degradation', () => {
  it('returns source: none when all four layers fail (ADR-090 contract)', () => {
    // No env, no config, no sibling, no repo-local sediment.
    const result = resolveSubstratePaths(configRoot, { env: emptyEnv() });
    expect(result).toEqual({
      handoffRoot: null,
      journalRoot: null,
      source: 'none',
    });
  });

  it('tolerates configRoot at tmp root without crashing', () => {
    // Ensure resolver tolerates a configRoot whose dirname() may not exist
    // as a real ancestor (filesystem root edge cases). The body assertion
    // proves the call returned cleanly under any source.
    const result = resolveSubstratePaths(tmpRoot, { env: emptyEnv() });
    expect(result.source).toMatch(/^(repo-local|none)$/);
  });
});

// ─── Path normalization ────────────────────────────────────────────────────

describe('resolveSubstratePaths path normalization', () => {
  it('normalizes mixed separators in env value (cross-platform)', () => {
    // Construct a path with mixed slashes: D:/dev\subdir or /tmp/dev\sub.
    // path.normalize should collapse to OS-native separators.
    const target = mkSubstrate(path.join(tmpRoot, 'mixed-seps'));
    // Inject mixed separators by doing string-level concatenation.
    const mixed = target.replace(path.sep, path.sep === '/' ? '\\' : '/');

    const result = resolveSubstratePaths(configRoot, {
      env: { TOTEM_SUBSTRATE_PATH: mixed },
    });

    // Whatever the resolver returns must be normalized — no mixed separators.
    expect(result.handoffRoot).toBe(path.normalize(path.join(target, '.handoff')));
  });

  it('normalizes . and .. segments in env value', () => {
    const target = mkSubstrate(path.join(tmpRoot, 'nested', 'real-substrate'));
    const noisy = path.join(tmpRoot, 'nested', '.', 'real-substrate', '..', 'real-substrate');

    const result = resolveSubstratePaths(configRoot, {
      env: { TOTEM_SUBSTRATE_PATH: noisy },
    });

    expect(result.handoffRoot).toBe(path.normalize(path.join(target, '.handoff')));
  });

  it('returns absolute paths regardless of caller anchor', () => {
    const sibling = mkSubstrate(path.join(parent, 'totem-substrate'));
    const result = resolveSubstratePaths(configRoot, { env: emptyEnv() });
    expect(path.isAbsolute(result.handoffRoot ?? '')).toBe(true);
    expect(path.isAbsolute(result.journalRoot ?? '')).toBe(true);
    // Sanity: the absolute path points at the sibling we built.
    expect(result.handoffRoot).toBe(path.normalize(path.join(sibling, '.handoff')));
  });
});

// ─── Type compile-checks (no runtime behavior) ─────────────────────────────

describe('resolveSubstratePaths type contract', () => {
  it('accepts SubstrateResolverOptions with all optional fields omitted', () => {
    // Compile-time check — these calls just need to typecheck and not throw.
    const opts: SubstrateResolverOptions = {};
    const cfg: SubstrateResolverConfig = {};
    expect(() => resolveSubstratePaths(configRoot, opts)).not.toThrow();
    expect(() => resolveSubstratePaths(configRoot, { config: cfg })).not.toThrow();
  });
});
