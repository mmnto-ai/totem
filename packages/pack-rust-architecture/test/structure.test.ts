import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CompiledRulesFileSchema, readJsonSafe } from '@mmnto/totem';

const PACK_ROOT = path.resolve(__dirname, '..');

describe('@mmnto/pack-rust-architecture structure', () => {
  it('compiled-rules.json matches canonical schema with a rules array', () => {
    const manifest = readJsonSafe(
      path.join(PACK_ROOT, 'compiled-rules.json'),
      CompiledRulesFileSchema,
    );
    expect(manifest.version).toBe(1);
    expect(Array.isArray(manifest.rules)).toBe(true);
    expect(manifest.rules).not.toEqual([]);
  });

  it('.totemignore contains the four required path exemptions', () => {
    const content = fs.readFileSync(path.join(PACK_ROOT, '.totemignore'), 'utf-8');
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const required = ['scripts/', '.github/**', '**/*.test.*', '**/*.spec.*'];
    for (const pattern of required) {
      expect(lines, `missing required .totemignore entry: ${pattern}`).toContain(pattern);
    }
  });

  it('package.json exports declares root + every shippable asset with explicit ./ prefixes', () => {
    const pkg = readJsonSafe<{
      exports?: Record<string, string>;
      files?: string[];
      main?: string;
    }>(path.join(PACK_ROOT, 'package.json'));

    expect(pkg.exports).toBeDefined();
    expect(pkg.main).toBe('./register.cjs');
    // Lock the exports surface with exact-key equality so an accidentally-
    // added export key fails this test rather than slipping into the
    // published surface (CR nitpick on #1775; mirrors the precedent in
    // pack-agent-security/test/structure.test.ts).
    expect(new Set(Object.keys(pkg.exports ?? {}))).toEqual(
      new Set([
        '.',
        './compiled-rules.json',
        './tree-sitter-rust.wasm',
        './.totemignore',
        './package.json',
      ]),
    );
    expect(pkg.exports?.['.']).toBe('./register.cjs');
    expect(pkg.exports?.['./compiled-rules.json']).toBe('./compiled-rules.json');
    expect(pkg.exports?.['./tree-sitter-rust.wasm']).toBe('./tree-sitter-rust.wasm');
    expect(pkg.exports?.['./.totemignore']).toBe('./.totemignore');
    expect(pkg.exports?.['./package.json']).toBe('./package.json');
  });

  it('package.json files array lists exactly the five shippable artifacts', () => {
    const pkg = readJsonSafe<{ files?: string[] }>(path.join(PACK_ROOT, 'package.json'));
    expect(pkg.files).toBeDefined();
    expect(pkg.files).toHaveLength(5);
    expect(new Set(pkg.files)).toEqual(
      new Set([
        'register.cjs',
        'tree-sitter-rust.wasm',
        'compiled-rules.json',
        '.totemignore',
        'README.md',
      ]),
    );
  });

  it('package.json runtime dependencies are limited to the documented v0.1 substrate-gap allowlist', () => {
    const pkg = readJsonSafe<{ dependencies?: Record<string, string> }>(
      path.join(PACK_ROOT, 'package.json'),
    );
    const deps = pkg.dependencies ?? {};
    // @ast-grep/lang-rust is the napi-side parser binding required by the
    // v0.1 side-channel registration in register.cjs (mmnto-ai/totem#1774).
    // No other runtime deps are admitted: peerDep covers @ast-grep/napi
    // (external); devDeps cover @mmnto/totem (workspace), @vscode/tree-sitter-wasm
    // (build-time WASM source), and vitest. The @mmnto/totem engine version
    // constraint lives in the `engines` field per ADR-097 § Q6 (amended
    // 2026-05-03 via mmnto-ai/totem#1803) — see the engines invariant below.
    expect(Object.keys(deps).sort()).toEqual(['@ast-grep/lang-rust']);
  });

  it('package.json peerDependencies pin only the external @ast-grep/napi engine', () => {
    const pkg = readJsonSafe<{ peerDependencies?: Record<string, string> }>(
      path.join(PACK_ROOT, 'package.json'),
    );
    // Exact-key equality: @mmnto/totem MUST NOT appear here. The engine
    // version constraint is declared via the `engines` field instead
    // (mmnto-ai/totem#1803). Rationale: pack-rust-architecture lives in the
    // changesets `fixed` group with @mmnto/totem and the rest of the
    // @mmnto/* cohort; declaring @mmnto/totem as a peerDep on a fixed-group
    // sibling creates a circular constraint on every minor bump that
    // pre-empts the cluster to a major (#1776 wiggle on #1775's first
    // auto-cut). The `engines` field is npm-canonical for engine-version
    // constraints, isn't touched by changesets fixed-group auto-bump, and
    // makes the resolver-vs-peer separation explicit. Only the external
    // napi engine is pinned via peerDep.
    expect(Object.keys(pkg.peerDependencies ?? {}).sort()).toEqual(['@ast-grep/napi']);
    expect(pkg.peerDependencies?.['@ast-grep/napi']).toBe('^0.42.0');
  });

  it('package.json engines declares @mmnto/totem with a non-empty semver range (ADR-097 § Q6)', () => {
    const pkg = readJsonSafe<{ engines?: Record<string, string> }>(
      path.join(PACK_ROOT, 'package.json'),
    );
    // ADR-097 § Q6 (amended 2026-05-03 via mmnto-ai/totem#1803): pack engine
    // version constraint MUST live in `engines['@mmnto/totem']`. The
    // resolver (`pack-manifest-writer.ts:readEngineRange`) reads this field
    // to populate `installed-packs.json#packs[].declaredEngineRange`; the
    // boot path (`pack-discovery.ts:assertEngineRangeSatisfied`) cross-checks
    // it against the running engine version via semver.satisfies.
    expect(pkg.engines).toBeDefined();
    const range = pkg.engines?.['@mmnto/totem'];
    expect(typeof range).toBe('string');
    expect(range).not.toBe('');
  });

  it('tree-sitter-rust.wasm is present and non-empty', () => {
    const wasmPath = path.join(PACK_ROOT, 'tree-sitter-rust.wasm');
    expect(fs.existsSync(wasmPath)).toBe(true);
    const stats = fs.statSync(wasmPath);
    expect(stats.size).toBeGreaterThan(100_000);
  });
});
