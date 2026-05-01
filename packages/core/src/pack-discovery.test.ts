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
              name: '@totem/pack-rust',
              resolvedPath: path.resolve('/abs/a'),
              declaredEngineRange: '^1.19.0',
            },
            {
              name: '@totem/pack-rust',
              resolvedPath: path.resolve('/abs/b'),
              declaredEngineRange: '^1.19.0',
            },
          ],
        }),
      );
      expect(() => loadInstalledPacks({ projectRoot: tmpRoot, totemDir: '.totem' })).toThrowError(
        /duplicate pack entry '@totem\/pack-rust'/,
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
              name: '@totem/pack-relative',
              resolvedPath: 'node_modules/@totem/pack-relative',
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

describe('loadInstalledPacks: peerDependencies engine version mismatch', () => {
  it('throws structured error naming pack name + declared range + actual engine version', () => {
    const fakeCallback: PackRegisterCallback = () => {};
    const fakePack: LoadedPack = {
      name: '@totem/pack-fake',
      resolvedPath: '/fake/path',
      declaredEngineRange: '^2.0.0',
    };
    expect(() =>
      loadInstalledPacks({
        engineVersion: '1.21.0',
        inMemoryPacks: [{ pack: fakePack, callback: fakeCallback }],
      }),
    ).toThrowError(
      /Pack '@totem\/pack-fake' requires @mmnto\/totem '\^2\.0\.0'.*running engine is 1\.21\.0/,
    );
  });

  it('passes when engine version satisfies declared range', () => {
    const fakeCallback: PackRegisterCallback = () => {};
    const fakePack: LoadedPack = {
      name: '@totem/pack-fake',
      resolvedPath: '/fake/path',
      declaredEngineRange: '^1.19.0',
    };
    const packs = loadInstalledPacks({
      engineVersion: '1.21.0',
      inMemoryPacks: [{ pack: fakePack, callback: fakeCallback }],
    });
    expect(packs).toHaveLength(1);
    expect(packs[0]?.name).toBe('@totem/pack-fake');
  });

  it('throws when declared range is invalid semver', () => {
    const fakeCallback: PackRegisterCallback = () => {};
    const fakePack: LoadedPack = {
      name: '@totem/pack-fake',
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
      name: '@totem/pack-rust-architecture',
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
      name: '@totem/pack-rust-architecture',
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
      name: '@totem/pack-async',
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
      name: '@totem/pack-broken',
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
    expect(outer.message).toMatch(/Pack '@totem\/pack-broken' registration callback threw/);
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
              name: '@totem/pack-a',
              resolvedPath: '/a',
              declaredEngineRange: '^1.19.0',
            },
            callback: callback1,
          },
          {
            pack: {
              name: '@totem/pack-b',
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
    expect((caught as Error).message).toMatch(/Pack '@totem\/pack-b' registration callback threw/);
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
              name: '@totem/pack-a',
              resolvedPath: '/a',
              declaredEngineRange: '^1.19.0',
            },
            callback: callback1,
          },
          {
            pack: {
              name: '@totem/pack-b',
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
    expect((caught as Error).message).toMatch(/Pack '@totem\/pack-b' registration callback threw/);
    expect(((caught as Error).cause as Error).message).toMatch(/already registered to language/);
  });
});
