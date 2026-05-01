/**
 * Tests for pack manifest resolution + writer (mmnto-ai/totem#1768
 * Step 4, Q4 disposition).
 *
 * Covers invariant 18 from `.totem/specs/pack-substrate-bundle.md`:
 *
 * - Resolves a pack present in BOTH `package.json` deps AND
 *   `totem.config.ts` `extends` → manifest entry, no warning.
 * - Resolves a pack only in deps → no manifest entry, `dep-only` warning.
 * - Resolves a pack only in extends → no manifest entry, `extends-only` warning.
 * - Pack without `peerDependencies['@mmnto/totem']` → `not-a-pack` warning.
 * - Atomic write produces a stable JSON file.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { TotemConfig } from './config-schema.js';
import { type InstalledPacksManifest, InstalledPacksManifestSchema } from './pack-discovery.js';
import { resolveInstalledPacks, writeInstalledPacksManifest } from './pack-manifest-writer.js';

let tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch (err) {
      // best-effort cleanup — tmp dir already gone or held by AV scan
      void err;
    }
  }
  tmpRoots = [];
});

function makeTmpRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-writer-test-'));
  tmpRoots.push(root);
  return root;
}

function writeFixturePack(root: string, packName: string, peerRange: string | undefined): string {
  // Create a node_modules layout that `require.resolve` can find. The pack
  // directory holds package.json with `peerDependencies['@mmnto/totem']`.
  const packPath = path.join(root, 'node_modules', packName);
  fs.mkdirSync(packPath, { recursive: true });
  const pkgJson: Record<string, unknown> = {
    name: packName,
    version: '0.1.0',
  };
  if (peerRange !== undefined) {
    pkgJson.peerDependencies = { '@mmnto/totem': peerRange };
  }
  fs.writeFileSync(path.join(packPath, 'package.json'), JSON.stringify(pkgJson, null, 2));
  return packPath;
}

function makeConfig(extendsList: readonly string[] | undefined): TotemConfig {
  // Minimal TotemConfig — just enough for resolveInstalledPacks. The
  // resolver only reads `config.extends`.
  return {
    targets: [{ glob: '**/*.ts', type: 'code', strategy: 'typescript-ast' }],
    totemDir: '.totem',
    lanceDir: '.lancedb',
    ignorePatterns: [],
    shieldIgnorePatterns: [],
    contextWarningThreshold: 40_000,
    shieldAutoLearn: false,
    extends: extendsList ? [...extendsList] : undefined,
    review: {
      sourceExtensions: ['.ts'],
      defaultGracePeriodPushes: 50,
      defaultGracePeriodDays: 14,
      mergeReviewerIdentity: 'satur8d',
      pushReviewerIdentity: 'satur8d',
    },
  } as TotemConfig;
}

describe('resolveInstalledPacks: union of deps + extends', () => {
  it('resolves a pack present in both deps and extends with no warning', () => {
    const root = makeTmpRoot();
    writeFixturePack(root, '@mmnto/pack-fake', '^1.19.0');
    const result = resolveInstalledPacks({
      projectRoot: root,
      config: makeConfig(['@mmnto/pack-fake']),
      packageJsonDeps: { '@mmnto/pack-fake': '0.1.0' },
    });
    expect(result.warnings).toEqual([]);
    expect(result.resolved).toHaveLength(1);
    expect(result.resolved[0]?.name).toBe('@mmnto/pack-fake');
    expect(result.resolved[0]?.declaredEngineRange).toBe('^1.19.0');
  });

  it('emits dep-only warning when pack is in deps but not extends', () => {
    const root = makeTmpRoot();
    writeFixturePack(root, '@mmnto/pack-orphan-dep', '^1.19.0');
    const result = resolveInstalledPacks({
      projectRoot: root,
      config: makeConfig([]),
      packageJsonDeps: { '@mmnto/pack-orphan-dep': '0.1.0' },
    });
    expect(result.warnings).toEqual([{ name: '@mmnto/pack-orphan-dep', reason: 'dep-only' }]);
    expect(result.resolved).toEqual([]);
  });

  it('emits extends-only warning when pack is in extends but not deps', () => {
    const root = makeTmpRoot();
    const result = resolveInstalledPacks({
      projectRoot: root,
      config: makeConfig(['@mmnto/pack-orphan-extends']),
      packageJsonDeps: {},
    });
    expect(result.warnings).toEqual([
      { name: '@mmnto/pack-orphan-extends', reason: 'extends-only' },
    ]);
    expect(result.resolved).toEqual([]);
  });

  it('emits not-a-pack warning when pack lacks peerDependencies[@mmnto/totem]', () => {
    const root = makeTmpRoot();
    writeFixturePack(root, '@mmnto/pack-broken', undefined);
    const result = resolveInstalledPacks({
      projectRoot: root,
      config: makeConfig(['@mmnto/pack-broken']),
      packageJsonDeps: { '@mmnto/pack-broken': '0.1.0' },
    });
    expect(result.warnings).toEqual([{ name: '@mmnto/pack-broken', reason: 'not-a-pack' }]);
    expect(result.resolved).toEqual([]);
  });

  it('ignores non-pack dependencies (no @mmnto/pack- prefix)', () => {
    const root = makeTmpRoot();
    const result = resolveInstalledPacks({
      projectRoot: root,
      config: makeConfig(['react', 'lodash']),
      packageJsonDeps: { react: '18.0.0', lodash: '4.0.0' },
    });
    expect(result.warnings).toEqual([]);
    expect(result.resolved).toEqual([]);
  });

  it('returns sorted output (alphabetical by pack name)', () => {
    const root = makeTmpRoot();
    writeFixturePack(root, '@mmnto/pack-zulu', '^1.19.0');
    writeFixturePack(root, '@mmnto/pack-alpha', '^1.19.0');
    const result = resolveInstalledPacks({
      projectRoot: root,
      config: makeConfig(['@mmnto/pack-zulu', '@mmnto/pack-alpha']),
      packageJsonDeps: {
        '@mmnto/pack-zulu': '0.1.0',
        '@mmnto/pack-alpha': '0.1.0',
      },
    });
    expect(result.resolved.map((p) => p.name)).toEqual(['@mmnto/pack-alpha', '@mmnto/pack-zulu']);
  });
});

describe('writeInstalledPacksManifest', () => {
  it('writes a schema-valid JSON file atomically', () => {
    const root = makeTmpRoot();
    const totemDir = path.join(root, '.totem');
    const manifest: InstalledPacksManifest = {
      version: 1,
      packs: [
        {
          name: '@mmnto/pack-fake',
          resolvedPath: '/fake/path',
          declaredEngineRange: '^1.19.0',
        },
      ],
    };
    const finalPath = writeInstalledPacksManifest(totemDir, manifest);
    expect(fs.existsSync(finalPath)).toBe(true);

    const raw = fs.readFileSync(finalPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const validation = InstalledPacksManifestSchema.safeParse(parsed);
    expect(validation.success).toBe(true);
    expect(validation.success && validation.data.packs[0]?.name).toBe('@mmnto/pack-fake');
  });

  it('creates the totemDir if it does not exist', () => {
    const root = makeTmpRoot();
    const totemDir = path.join(root, 'newly-created', '.totem');
    expect(fs.existsSync(totemDir)).toBe(false);
    writeInstalledPacksManifest(totemDir, { version: 1, packs: [] });
    expect(fs.existsSync(totemDir)).toBe(true);
    expect(fs.existsSync(path.join(totemDir, 'installed-packs.json'))).toBe(true);
  });

  it('does not leave the temp file behind on success', () => {
    const root = makeTmpRoot();
    const totemDir = path.join(root, '.totem');
    writeInstalledPacksManifest(totemDir, { version: 1, packs: [] });
    expect(fs.existsSync(path.join(totemDir, 'installed-packs.json.tmp'))).toBe(false);
  });
});
