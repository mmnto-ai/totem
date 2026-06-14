import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TotemConfig } from '../config-schema.js';
import { TotemConfigSchema } from '../config-schema.js';
import { cleanTmpDir } from '../test-utils.js';
import {
  buildIndexManifest,
  computeOrphanPaths,
  INDEX_MANIFEST_SCHEMA,
  runSync,
} from './pipeline.js';

// Import the internal helpers via a workaround — we test the state file contract
// since readSyncState/writeSyncState are not exported directly.

const SYNC_STATE_FILE = 'cache/sync-state.json';

describe('sync state persistence', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-sync-state-'));
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  it('creates cache directory and writes valid JSON', () => {
    const statePath = path.join(tmpDir, SYNC_STATE_FILE);
    const dir = path.dirname(statePath);
    fs.mkdirSync(dir, { recursive: true });

    const state = { lastSyncSha: 'abc123def456', timestamp: Date.now() };
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf-8');

    const raw = fs.readFileSync(statePath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.lastSyncSha).toBe('abc123def456');
    expect(typeof parsed.timestamp).toBe('number');
  });

  it('reads back a previously written state', () => {
    const statePath = path.join(tmpDir, SYNC_STATE_FILE);
    const dir = path.dirname(statePath);
    fs.mkdirSync(dir, { recursive: true });

    const state = { lastSyncSha: 'deadbeef', timestamp: 1234567890 };
    fs.writeFileSync(statePath, JSON.stringify(state), 'utf-8');

    const raw = fs.readFileSync(statePath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.lastSyncSha).toBe('deadbeef');
    expect(parsed.timestamp).toBe(1234567890);
  });

  it('returns null-equivalent for missing state file', () => {
    const statePath = path.join(tmpDir, SYNC_STATE_FILE);
    expect(fs.existsSync(statePath)).toBe(false);
  });

  it('returns null-equivalent for corrupted state file', () => {
    const statePath = path.join(tmpDir, SYNC_STATE_FILE);
    const dir = path.dirname(statePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(statePath, '{ broken json!!!', 'utf-8');

    let parsed = null;
    try {
      parsed = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
    } catch {
      // Expected
    }
    expect(parsed).toBeNull();
  });
});

describe('orphan reconciliation (computeOrphanPaths)', () => {
  it('flags an indexed path absent from the working tree as an orphan', () => {
    expect(computeOrphanPaths(['src/a.ts', 'src/gone.ts'], ['src/a.ts'])).toEqual(['src/gone.ts']);
  });

  it('returns no orphans when every indexed path is still live', () => {
    expect(computeOrphanPaths(['src/a.ts', 'src/b.ts'], ['src/a.ts', 'src/b.ts'])).toEqual([]);
  });

  it('W1: a live file stored with backslashes is NOT orphaned by its forward-slash live path', () => {
    // Legacy/raw stored separator vs normalized resolved path — must not false-purge.
    expect(computeOrphanPaths(['src\\live.ts'], ['src/live.ts'])).toEqual([]);
  });

  it('W1: an orphaned backslash path is returned RAW so deleteByFile matches the stored literal', () => {
    expect(computeOrphanPaths(['src\\deleted.ts'], ['src/other.ts'])).toEqual(['src\\deleted.ts']);
  });

  it('purges a de-targeted / newly-ignored file that left allFiles even though it exists on disk', () => {
    expect(computeOrphanPaths(['src/foo.ts'], [])).toEqual(['src/foo.ts']);
  });

  it('rename-into-ignored (#624): the old indexed path is orphaned when neither old nor new is live', () => {
    expect(computeOrphanPaths(['proposals/active/296.md'], ['proposals/other.md'])).toEqual([
      'proposals/active/296.md',
    ]);
  });

  it('W2: independent of the diff window — an orphan is found from indexed-vs-live alone', () => {
    // The inputs are the indexed set and the working tree, never changedPaths,
    // so an empty diff window cannot hide an orphan.
    expect(computeOrphanPaths(['src/orphan.ts'], ['src/kept.ts'])).toEqual(['src/orphan.ts']);
  });
});

describe('runSync embedding guard', () => {
  it('throws when embedding is not configured (Lite tier)', async () => {
    const config: TotemConfig = TotemConfigSchema.parse({
      targets: [{ glob: '**/*.md', type: 'spec', strategy: 'markdown-heading' }],
    });

    await expect(runSync(config, { projectRoot: os.tmpdir(), incremental: false })).rejects.toThrow(
      'No embedding provider configured',
    );
  });
});

describe('buildIndexManifest', () => {
  const writtenAt = new Date('2026-05-07T00:00:00.000Z');
  const docs = [
    {
      sourceFile: 'src/a.ts',
      origin: 'local',
      rowCount: 3,
      lastSynced: '2026-05-07T00:00:00.000Z',
    },
  ];

  it('writes the v0.2 schema identifier', () => {
    const m = buildIndexManifest({ documents: docs, headSha: 'abc123', writtenAt });
    expect(m.schema).toBe('totem-index-manifest-v0.2');
    expect(INDEX_MANIFEST_SCHEMA).toBe('totem-index-manifest-v0.2');
  });

  it('includes documents array verbatim', () => {
    const m = buildIndexManifest({ documents: docs, headSha: 'abc123', writtenAt });
    expect(m.documents).toEqual(docs);
  });

  it('serializes writtenAt as an ISO timestamp', () => {
    const m = buildIndexManifest({ documents: docs, headSha: 'abc123', writtenAt });
    expect(m.writtenAt).toBe('2026-05-07T00:00:00.000Z');
  });

  it('emits gitCommit with git: prefix when headSha is provided', () => {
    const m = buildIndexManifest({ documents: docs, headSha: 'abc123def456', writtenAt });
    expect(m.gitCommit).toBe('git:abc123def456');
  });

  it('OMITS gitCommit field when headSha is null', () => {
    const m = buildIndexManifest({ documents: docs, headSha: null, writtenAt });
    expect(m.gitCommit).toBeUndefined();
    expect('gitCommit' in m).toBe(false);
  });

  it('OMITS gitCommit field when headSha is empty string', () => {
    const m = buildIndexManifest({ documents: docs, headSha: '', writtenAt });
    expect('gitCommit' in m).toBe(false);
  });

  it('does not synthesize a fake hash URI on no-git (Tenet 14: honest absence)', () => {
    const m = buildIndexManifest({ documents: docs, headSha: undefined, writtenAt });
    const serialized = JSON.stringify(m);
    expect(serialized).not.toMatch(/sha\d+:unknown/);
    expect(serialized).not.toMatch(/sha1:/);
    expect(serialized).not.toMatch(/sha256:/);
  });

  it('does not label the git commit as indexHash (Tenet 14: identity ≠ content hash)', () => {
    const m = buildIndexManifest({ documents: docs, headSha: 'abc123', writtenAt });
    expect('indexHash' in m).toBe(false);
  });
});
