import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RegistryEntry } from './registry.js';
import { cleanTmpDir } from './test-utils.js';

// Mock os.homedir() so tests don't touch the real ~/.totem
let tmpDir: string;

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    default: new Proxy(actual, {
      get(target, prop) {
        if (prop === 'homedir') return () => tmpDir;
        return target[prop as keyof typeof target];
      },
    }),
    homedir: () => tmpDir,
  };
});

// Must import AFTER vi.mock so the mock takes effect
const { readRegistry, updateRegistryEntry } = await import('./registry.js');

describe('readRegistry', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-registry-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('returns empty object when file does not exist', () => {
    const result = readRegistry();
    expect(result).toEqual({});
  });

  it('returns empty object when file contains invalid JSON', () => {
    const dir = path.join(tmpDir, '.totem');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'registry.json'), 'not json');
    const result = readRegistry();
    expect(result).toEqual({});
  });

  it('returns empty object when file contains invalid schema', () => {
    const dir = path.join(tmpDir, '.totem');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ bad: 'data' }));
    const result = readRegistry();
    expect(result).toEqual({});
  });

  it('returns parsed registry when file is valid', () => {
    const dir = path.join(tmpDir, '.totem');
    fs.mkdirSync(dir, { recursive: true });
    const entry: RegistryEntry = {
      path: '/projects/foo',
      chunkCount: 42,
      lastSync: '2026-01-01T00:00:00.000Z',
      embedder: 'openai/1536d',
    };
    fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify({ '/projects/foo': entry }));
    const result = readRegistry();
    expect(result['/projects/foo']).toEqual(entry);
  });
});

describe('updateRegistryEntry', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-registry-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('creates registry file and writes entry', async () => {
    const entry: RegistryEntry = {
      path: '/projects/foo',
      chunkCount: 42,
      lastSync: '2026-01-01T00:00:00.000Z',
      embedder: 'openai/1536d',
    };

    await updateRegistryEntry(entry);

    const registryPath = path.join(tmpDir, '.totem', 'registry.json');
    expect(fs.existsSync(registryPath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as Record<string, unknown>;
    expect(content['/projects/foo']).toEqual(entry);
  });

  it('merges entries without overwriting others (atomic merge)', async () => {
    const entryA: RegistryEntry = {
      path: '/projects/a',
      chunkCount: 10,
      lastSync: '2026-01-01T00:00:00.000Z',
      embedder: 'openai/1536d',
    };
    const entryB: RegistryEntry = {
      path: '/projects/b',
      chunkCount: 20,
      lastSync: '2026-01-02T00:00:00.000Z',
      embedder: 'gemini/768d',
    };

    await updateRegistryEntry(entryA);
    await updateRegistryEntry(entryB);

    const registry = readRegistry();
    expect(registry['/projects/a']).toEqual(entryA);
    expect(registry['/projects/b']).toEqual(entryB);
  });

  it('is idempotent', async () => {
    const entry: RegistryEntry = {
      path: '/projects/foo',
      chunkCount: 42,
      lastSync: '2026-01-01T00:00:00.000Z',
      embedder: 'openai/1536d',
    };

    await updateRegistryEntry(entry);
    await updateRegistryEntry(entry);

    const registry = readRegistry();
    expect(Object.keys(registry)).toHaveLength(1);
    expect(registry['/projects/foo']).toEqual(entry);
  });

  it('updates an existing entry with new values', async () => {
    const entry: RegistryEntry = {
      path: '/projects/foo',
      chunkCount: 42,
      lastSync: '2026-01-01T00:00:00.000Z',
      embedder: 'openai/1536d',
    };

    await updateRegistryEntry(entry);

    const updated: RegistryEntry = {
      path: '/projects/foo',
      chunkCount: 100,
      lastSync: '2026-02-01T00:00:00.000Z',
      embedder: 'openai/1536d',
    };

    await updateRegistryEntry(updated);

    const registry = readRegistry();
    expect(Object.keys(registry)).toHaveLength(1);
    expect(registry['/projects/foo']).toEqual(updated);
  });

  it('refuses to overwrite when existing file is corrupted (data-loss protection)', async () => {
    // Write a valid entry first
    const entry: RegistryEntry = {
      path: '/projects/foo',
      chunkCount: 42,
      lastSync: '2026-01-01T00:00:00.000Z',
      embedder: 'openai/1536d',
    };
    await updateRegistryEntry(entry);

    // Corrupt the file
    const registryFile = path.join(tmpDir, '.totem', 'registry.json');
    fs.writeFileSync(registryFile, 'not valid json');

    // Attempt to update — should throw, not wipe
    await expect(
      updateRegistryEntry({
        path: '/projects/bar',
        chunkCount: 10,
        lastSync: '2026-02-01T00:00:00.000Z',
        embedder: 'gemini/768d',
      }),
    ).rejects.toThrow();

    // Original corrupted file should be untouched (not overwritten with just /projects/bar)
    expect(fs.readFileSync(registryFile, 'utf-8')).toBe('not valid json');
  });
});
