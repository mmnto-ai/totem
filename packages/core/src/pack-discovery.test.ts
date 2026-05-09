/**
 * Tests for the pack discovery substrate (mmnto-ai/totem#1768, ADR-097
 * § 5 Q5 + § 10).
 *
 * Covers invariants 1, 2, 3, 4, 8 from `.totem/specs/pack-substrate-bundle.md`:
 *
 * - Missing manifest → empty packs, no throw.
 * - Malformed manifest → fail loud.
 * - peerDependencies engine version mismatch → structured fail loud.
 * - Re-load after seal → throw.
 * - Pack callback can register chunker + language; lookups return registered values.
 *
 * Uses the `inMemoryPacks` test escape hatch to drive the registration
 * phase without writing fixture pack packages to `node_modules`.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  __resetLangRegistryForTests,
  extensionToLanguage,
  registeredExtensions,
} from './ast-classifier.js';
import type { Chunker } from './chunkers/chunker.js';
import {
  __resetForTests as __resetChunkerRegistryForTests,
  lookup as lookupChunker,
  registeredNames as registeredChunkerStrategies,
} from './chunkers/chunker-registry.js';
import type { ContentType } from './config-schema.js';
import {
  __resetForTests as __resetPackDiscoveryForTests,
  isEngineSealed,
  type LoadedPack,
  loadInstalledPacks,
  type PackRegisterCallback,
} from './pack-discovery.js';
import type { Chunk } from './types.js';

class FakeChunker implements Chunker {
  readonly strategy: string = 'rust-ast';
  chunk(_content: string, _filePath: string, _type: ContentType): Chunk[] {
    return [];
  }
}

afterEach(() => {
  // Order matters: pack-discovery's seal flag and registries are
  // independent state containers — reset all three each test so seal
  // state from one case doesn't leak into the next.
  __resetPackDiscoveryForTests();
  __resetChunkerRegistryForTests();
  __resetLangRegistryForTests();
});

describe('loadInstalledPacks: missing manifest', () => {
  it('returns empty packs and does not throw when installed-packs.json is absent', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-discovery-test-'));
    try {
      const packs = loadInstalledPacks({ projectRoot: tmpRoot, totemDir: '.totem' });
      expect(packs).toEqual([]);
      expect(isEngineSealed()).toBe(true);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

describe('loadInstalledPacks: malformed manifest', () => {
  it('throws structured error on invalid JSON', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-discovery-test-'));
    try {
      const totemDir = path.join(tmpRoot, '.totem');
      fs.mkdirSync(totemDir, { recursive: true });
      fs.writeFileSync(path.join(totemDir, 'installed-packs.json'), '{ this is not json');
      expect(() => loadInstalledPacks({ projectRoot: tmpRoot, totemDir: '.totem' })).toThrowError(
        /not valid JSON/,
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('throws structured error on schema validation failure', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-discovery-test-'));
    try {
      const totemDir = path.join(tmpRoot, '.totem');
      fs.mkdirSync(totemDir, { recursive: true });
      fs.writeFileSync(
        path.join(totemDir, 'installed-packs.json'),
        JSON.stringify({ version: 99, packs: [] }),
      );
      expect(() => loadInstalledPacks({ projectRoot: tmpRoot, totemDir: '.totem' })).toThrowError(
        /failed schema validation/,
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('throws on unknown sibling keys (strict schema)', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-discovery-test-'));
    try {
      const totemDir = path.join(tmpRoot, '.totem');
      fs.mkdirSync(totemDir, { recursive: true });
      fs.writeFileSync(
        path.join(totemDir, 'installed-packs.json'),
        JSON.stringify({ version: 1, packs: [], extra: 'oops' }),
      );
      expect(() => loadInstalledPacks({ projectRoot: tmpRoot, totemDir: '.totem' })).toThrowError(
        /failed schema validation/,
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('rejects manifest with duplicate pack names at the schema boundary', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-discovery-test-'));
    try {
      const totemDir = path.join(tmpRoot, '.totem');
      fs.mkdirSync(totemDir, { recursive: true });
      fs.writeFileSync(
        path.join(totemDir, 'installed-packs.json'),
        JSON.stringify({
          version: 1,
          packs: [
            {
              name: '@mmnto/pack-rust',
              resolvedPath: path.resolve('/abs/a'),
              declaredEngineRange: '^1.19.0',
            },
            {
              name: '@mmnto/pack-rust',
              resolvedPath: path.resolve('/abs/b'),
              declaredEngineRange: '^1.19.0',
            },
          ],
        }),
      );
      expect(() => loadInstalledPacks({ projectRoot: tmpRoot, totemDir: '.totem' })).toThrowError(
        /duplicate pack entry '@mmnto\/pack-rust'/,
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('rejects manifest entries with a relative resolvedPath at the schema boundary', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-discovery-test-'));
    try {
      const totemDir = path.join(tmpRoot, '.totem');
      fs.mkdirSync(totemDir, { recursive: true });
      fs.writeFileSync(
        path.join(totemDir, 'installed-packs.json'),
        JSON.stringify({
          version: 1,
          packs: [
            {
              name: '@mmnto/pack-relative',
              resolvedPath: 'node_modules/@mmnto/pack-relative',
              declaredEngineRange: '^1.19.0',
            },
          ],
        }),
      );
      expect(() => loadInstalledPacks({ projectRoot: tmpRoot, totemDir: '.totem' })).toThrowError(
        /resolvedPath must be an absolute path/,
      );
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

describe('loadInstalledPacks: engines[@mmnto/totem] version mismatch', () => {
  it('throws structured error naming pack name + declared range + actual engine version', () => {
    const fakeCallback: PackRegisterCallback = () => {};
    const fakePack: LoadedPack = {
      name: '@mmnto/pack-fake',
      resolvedPath: '/fake/path',
      declaredEngineRange: '^2.0.0',
    };
    expect(() =>
      loadInstalledPacks({
        engineVersion: '1.21.0',
        inMemoryPacks: [{ pack: fakePack, callback: fakeCallback }],
      }),
    ).toThrowError(
      /Pack '@mmnto\/pack-fake' requires @mmnto\/totem '\^2\.0\.0'.*running engine is 1\.21\.0/,
    );
  });

  it('passes when engine version satisfies declared range', () => {
    const fakeCallback: PackRegisterCallback = () => {};
    const fakePack: LoadedPack = {
      name: '@mmnto/pack-fake',
      resolvedPath: '/fake/path',
      declaredEngineRange: '^1.19.0',
    };
    const packs = loadInstalledPacks({
      engineVersion: '1.21.0',
      inMemoryPacks: [{ pack: fakePack, callback: fakeCallback }],
    });
    expect(packs).toHaveLength(1);
    expect(packs[0]?.name).toBe('@mmnto/pack-fake');
  });

  it('throws when declared range is invalid semver', () => {
    const fakeCallback: PackRegisterCallback = () => {};
    const fakePack: LoadedPack = {
      name: '@mmnto/pack-fake',
      resolvedPath: '/fake/path',
      declaredEngineRange: 'not-a-semver-range',
    };
    expect(() =>
      loadInstalledPacks({
        engineVersion: '1.21.0',
        inMemoryPacks: [{ pack: fakePack, callback: fakeCallback }],
      }),
    ).toThrowError(/not a valid semver range/);
  });
});

describe('loadInstalledPacks: re-load after seal', () => {
  it('throws when called twice', () => {
    loadInstalledPacks({ inMemoryPacks: [] });
    expect(() => loadInstalledPacks({ inMemoryPacks: [] })).toThrowError(
      /called after engine seal/,
    );
  });
});

describe('loadInstalledPacks: pack callback registration', () => {
  it('invokes pack callback with PackRegistrationAPI; lookups return registered values', () => {
    const fakeCallback: PackRegisterCallback = (api) => {
      api.registerChunkStrategy('rust-ast', FakeChunker);
      api.registerLanguage('.rs', 'rust', () => '/fake/tree-sitter-rust.wasm');
    };
    const fakePack: LoadedPack = {
      name: '@mmnto/pack-rust-architecture',
      resolvedPath: '/fake/path',
      declaredEngineRange: '^1.19.0',
    };
    loadInstalledPacks({
      engineVersion: '1.21.0',
      inMemoryPacks: [{ pack: fakePack, callback: fakeCallback }],
    });
    expect(lookupChunker('rust-ast')).toBe(FakeChunker);
    expect(registeredChunkerStrategies()).toContain('rust-ast');
    expect(extensionToLanguage('.rs')).toBe('rust');
    expect(registeredExtensions()).toContain('.rs');
  });

  it('seals both registries after every callback returns', () => {
    const fakeCallback: PackRegisterCallback = (api) => {
      api.registerChunkStrategy('rust-ast', FakeChunker);
    };
    const fakePack: LoadedPack = {
      name: '@mmnto/pack-rust-architecture',
      resolvedPath: '/fake/path',
      declaredEngineRange: '^1.19.0',
    };
    loadInstalledPacks({
      engineVersion: '1.21.0',
      inMemoryPacks: [{ pack: fakePack, callback: fakeCallback }],
    });
    expect(isEngineSealed()).toBe(true);
  });

  it('rejects an async (Promise-returning) registration callback before sealing', () => {
    const asyncCallback = (async (api: {
      registerChunkStrategy: (n: string, c: new () => Chunker) => void;
    }) => {
      api.registerChunkStrategy('async-strat', FakeChunker);
    }) as unknown as PackRegisterCallback;
    const fakePack: LoadedPack = {
      name: '@mmnto/pack-async',
      resolvedPath: '/fake/path',
      declaredEngineRange: '^1.19.0',
    };
    let caught: unknown;
    try {
      loadInstalledPacks({
        engineVersion: '1.21.0',
        inMemoryPacks: [{ pack: fakePack, callback: asyncCallback }],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/registration must be synchronous/);
    expect((caught as Error).message).toMatch(/ADR-097 § 5 Q5/);
    expect(isEngineSealed()).toBe(false);
  });

  it('throws and names the pack when callback throws', () => {
    const errorThrowingCallback: PackRegisterCallback = () => {
      throw new Error('pack-side bug');
    };
    const fakePack: LoadedPack = {
      name: '@mmnto/pack-broken',
      resolvedPath: '/fake/path',
      declaredEngineRange: '^1.19.0',
    };
    let caught: unknown;
    try {
      loadInstalledPacks({
        engineVersion: '1.21.0',
        inMemoryPacks: [{ pack: fakePack, callback: errorThrowingCallback }],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const outer = caught as Error;
    expect(outer.message).toMatch(/Pack '@mmnto\/pack-broken' registration callback threw/);
    expect(outer.message).toMatch(/must be fixed or removed/);
    expect(outer.cause).toBeInstanceOf(Error);
    expect((outer.cause as Error).message).toBe('pack-side bug');
  });

  it('two packs registering same chunk strategy: second fails loud', () => {
    const callback1: PackRegisterCallback = (api) => {
      api.registerChunkStrategy('shared', FakeChunker);
    };
    const callback2: PackRegisterCallback = (api) => {
      api.registerChunkStrategy('shared', FakeChunker);
    };
    let caught: unknown;
    try {
      loadInstalledPacks({
        engineVersion: '1.21.0',
        inMemoryPacks: [
          {
            pack: {
              name: '@mmnto/pack-a',
              resolvedPath: '/a',
              declaredEngineRange: '^1.19.0',
            },
            callback: callback1,
          },
          {
            pack: {
              name: '@mmnto/pack-b',
              resolvedPath: '/b',
              declaredEngineRange: '^1.19.0',
            },
            callback: callback2,
          },
        ],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/Pack '@mmnto\/pack-b' registration callback threw/);
    expect(((caught as Error).cause as Error).message).toMatch(/already registered/);
  });

  it('two packs registering same extension to different langs: second fails loud', () => {
    const callback1: PackRegisterCallback = (api) => {
      api.registerLanguage('.shared', 'lang-a', () => '/a.wasm');
    };
    const callback2: PackRegisterCallback = (api) => {
      api.registerLanguage('.shared', 'lang-b', () => '/b.wasm');
    };
    let caught: unknown;
    try {
      loadInstalledPacks({
        engineVersion: '1.21.0',
        inMemoryPacks: [
          {
            pack: {
              name: '@mmnto/pack-a',
              resolvedPath: '/a',
              declaredEngineRange: '^1.19.0',
            },
            callback: callback1,
          },
          {
            pack: {
              name: '@mmnto/pack-b',
              resolvedPath: '/b',
              declaredEngineRange: '^1.19.0',
            },
            callback: callback2,
          },
        ],
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/Pack '@mmnto\/pack-b' registration callback threw/);
    expect(((caught as Error).cause as Error).message).toMatch(/already registered to language/);
  });
});

// ─── Data-only pack archetype (mmnto-ai/totem#1848 — 1.30.1 patch) ────────
//
// Bot Interpretive Packs (e.g. @mmnto/pack-bot-coderabbit,
// @mmnto/pack-bot-gemini-code-assist) ship workflows + templates only,
// with no `main`/`exports`/`register.*`. They are intentionally data-only
// per docs/wiki/pack-ecosystem.md; resolvePackCallback must accept them
// via require.resolve() probe and return a no-op callback rather than
// throwing.
//
// These tests exercise the on-disk path through readManifestAndResolveCallbacks;
// the inMemoryPacks escape hatch bypasses resolvePackCallback entirely, so
// fixture packs on tmpdir are required.

function writePackFixture(
  tmpRoot: string,
  packageJson: Record<string, unknown>,
  files: Record<string, string> = {},
): string {
  const packDir = path.join(tmpRoot, 'fixture-pack');
  fs.mkdirSync(packDir, { recursive: true });
  fs.writeFileSync(path.join(packDir, 'package.json'), JSON.stringify(packageJson, null, 2));
  for (const [relPath, content] of Object.entries(files)) {
    const filePath = path.join(packDir, relPath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return packDir;
}

function writeInstalledPacksManifest(
  tmpRoot: string,
  entries: Array<{ name: string; resolvedPath: string; declaredEngineRange: string }>,
): void {
  const totemDir = path.join(tmpRoot, '.totem');
  fs.mkdirSync(totemDir, { recursive: true });
  fs.writeFileSync(
    path.join(totemDir, 'installed-packs.json'),
    JSON.stringify({ version: 1, packs: entries }),
  );
}

describe('loadInstalledPacks: data-only pack archetype (mmnto-ai/totem#1848)', () => {
  it('returns no-op callback for a data-only pack with no main/exports/register', () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-discovery-data-only-'));
    try {
      const packDir = writePackFixture(
        tmpRoot,
        {
          name: '@fixture/data-only-pack',
          version: '0.1.0',
          files: ['workflows'],
          engines: { '@mmnto/totem': '^1.30.0' },
        },
        { 'workflows/orientation.md': '# orientation' },
      );
      writeInstalledPacksManifest(tmpRoot, [
        {
          name: '@fixture/data-only-pack',
          resolvedPath: packDir,
          declaredEngineRange: '^1.30.0',
        },
      ]);
      const packs = loadInstalledPacks({
        projectRoot: tmpRoot,
        totemDir: '.totem',
        engineVersion: '1.30.1',
      });
      expect(packs).toHaveLength(1);
      expect(packs[0]?.name).toBe('@fixture/data-only-pack');
      expect(isEngineSealed()).toBe(true);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('reproduces the @mmnto/pack-bot-coderabbit@0.2.0 LC consumer scenario without throwing', () => {
    // Exact shape from mmnto-ai/totem-strategy:upstream-feedback/065:
    // type: "module", files: ["workflows", "templates", "README.md", "LICENSE"],
    // no main, no exports, no register.*.
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-discovery-lc-repro-'));
    try {
      const packDir = writePackFixture(
        tmpRoot,
        {
          name: '@mmnto/pack-bot-coderabbit',
          version: '0.2.0',
          type: 'module',
          files: ['workflows', 'templates', 'README.md', 'LICENSE'],
          engines: { '@mmnto/totem': '^1.26.0' },
        },
        {
          'workflows/01-protocol.md': '# protocol',
          'templates/reply.md': '# reply template',
        },
      );
      writeInstalledPacksManifest(tmpRoot, [
        {
          name: '@mmnto/pack-bot-coderabbit',
          resolvedPath: packDir,
          declaredEngineRange: '^1.26.0',
        },
      ]);
      expect(() =>
        loadInstalledPacks({
          projectRoot: tmpRoot,
          totemDir: '.totem',
          engineVersion: '1.30.1',
        }),
      ).not.toThrow();
      expect(isEngineSealed()).toBe(true);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('does NOT swallow MODULE_NOT_FOUND thrown from inside a code packs entry point', () => {
    // Code pack whose register.cjs requires a non-existent sibling file.
    // The error originates inside require(), not require.resolve(), so the
    // existing wrap fires and the new try/catch must not mask it.
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-discovery-mnf-'));
    try {
      const packDir = writePackFixture(
        tmpRoot,
        {
          name: '@fixture/broken-code-pack',
          version: '0.1.0',
          main: './register.cjs',
          engines: { '@mmnto/totem': '^1.30.0' },
        },
        {
          'register.cjs': "module.exports = require('./this-file-does-not-exist.cjs');",
        },
      );
      writeInstalledPacksManifest(tmpRoot, [
        {
          name: '@fixture/broken-code-pack',
          resolvedPath: packDir,
          declaredEngineRange: '^1.30.0',
        },
      ]);
      let caught: unknown;
      try {
        loadInstalledPacks({
          projectRoot: tmpRoot,
          totemDir: '.totem',
          engineVersion: '1.30.1',
        });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).message).toMatch(/could not be loaded/);
      expect((caught as Error).cause).toBeInstanceOf(Error);
      expect(((caught as Error).cause as NodeJS.ErrnoException).code).toBe('MODULE_NOT_FOUND');
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('does NOT silently no-op a code pack that resolves but exports the wrong shape', () => {
    // The "missing callback shape" guard must still fire when require.resolve
    // succeeds but the module exports neither default nor register.
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-discovery-shape-'));
    try {
      const packDir = writePackFixture(
        tmpRoot,
        {
          name: '@fixture/empty-export-pack',
          version: '0.1.0',
          main: './register.cjs',
          engines: { '@mmnto/totem': '^1.30.0' },
        },
        { 'register.cjs': 'module.exports = {};' },
      );
      writeInstalledPacksManifest(tmpRoot, [
        {
          name: '@fixture/empty-export-pack',
          resolvedPath: packDir,
          declaredEngineRange: '^1.30.0',
        },
      ]);
      expect(() =>
        loadInstalledPacks({
          projectRoot: tmpRoot,
          totemDir: '.totem',
          engineVersion: '1.30.1',
        }),
      ).toThrowError(/did not export a registration callback/);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
