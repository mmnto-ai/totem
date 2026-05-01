import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { CompiledRulesFileSchema, readJsonSafe } from '@mmnto/totem';

const PACK_ROOT = path.resolve(__dirname, '..');

describe('@totem/pack-rust-architecture structure', () => {
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
    // No other runtime deps are admitted: peerDeps cover @mmnto/totem and
    // @ast-grep/napi; devDeps cover @vscode/tree-sitter-wasm (build-time
    // WASM source) and vitest.
    expect(Object.keys(deps).sort()).toEqual(['@ast-grep/lang-rust']);
  });

  it('package.json peerDependencies pin both engine surfaces (totem + ast-grep napi)', () => {
    const pkg = readJsonSafe<{ peerDependencies?: Record<string, string> }>(
      path.join(PACK_ROOT, 'package.json'),
    );
    expect(pkg.peerDependencies?.['@ast-grep/napi']).toBe('^0.42.0');
  });

  it('package.json peerDependencies pins @mmnto/totem to ^1.22.0 (Pack v0.1 substrate version)', () => {
    const pkg = readJsonSafe<{ peerDependencies?: Record<string, string> }>(
      path.join(PACK_ROOT, 'package.json'),
    );
    expect(pkg.peerDependencies?.['@mmnto/totem']).toBe('^1.22.0');
    expect(pkg.peerDependencies?.['@ast-grep/napi']).toBe('^0.42.0');
  });

  it('tree-sitter-rust.wasm is present and non-empty', () => {
    const wasmPath = path.join(PACK_ROOT, 'tree-sitter-rust.wasm');
    expect(fs.existsSync(wasmPath)).toBe(true);
    const stats = fs.statSync(wasmPath);
    expect(stats.size).toBeGreaterThan(100_000);
  });
});
