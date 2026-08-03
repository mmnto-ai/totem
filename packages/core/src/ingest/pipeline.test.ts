import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { TotemConfig } from '../config-schema.js';
import { TotemConfigSchema } from '../config-schema.js';
import type { Embedder } from '../embedders/embedder.js';
import { cleanTmpDir } from '../test-utils.js';
import {
  buildIndexManifest,
  computeNewlyEligiblePaths,
  computeOrphanPaths,
  hashIndexExclusionSet,
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

describe('index-exclusion hash (hashIndexExclusionSet) — #2366', () => {
  it('(d) reordering patterns does NOT change the hash (order-normalized)', () => {
    // A config reorder must not read as an exclusion-set change and trigger a
    // spurious newly-eligible re-enqueue.
    expect(hashIndexExclusionSet(['a/**', 'b/**', 'c/**'])).toBe(
      hashIndexExclusionSet(['c/**', 'a/**', 'b/**']),
    );
  });

  it('a membership change (a removed pattern) DOES change the hash', () => {
    expect(hashIndexExclusionSet(['dist/**', 'vendor/**'])).not.toBe(
      hashIndexExclusionSet(['dist/**']),
    );
  });

  it('an empty set hashes stably and differs from any non-empty set', () => {
    expect(hashIndexExclusionSet([])).toBe(hashIndexExclusionSet([]));
    expect(hashIndexExclusionSet([])).not.toBe(hashIndexExclusionSet(['dist/**']));
  });
});

describe('newly-eligible reconciliation (computeNewlyEligiblePaths) — #2366', () => {
  it('(a) a previously-ignored file that is now live but not indexed is enqueued', () => {
    // vendor/lib.ts was excluded → never indexed; the pattern was removed → it is
    // now in the live set. Its bytes are unchanged (absent from the git diff), so
    // only the membership pass recovers it.
    expect(computeNewlyEligiblePaths(['src/a.ts', 'vendor/lib.ts'], ['src/a.ts'])).toEqual([
      'vendor/lib.ts',
    ]);
  });

  it('(b) hash match → the reconciliation branch never runs; an up-to-date index yields nothing new', () => {
    const patterns = ['dist/**', 'vendor/**'];
    // Same effective set across syncs → hashes equal → runSync guards the branch off.
    expect(hashIndexExclusionSet(patterns)).toBe(hashIndexExclusionSet([...patterns]));
    // And even if it were evaluated, an up-to-date index (live ⊆ indexed) adds nothing.
    expect(computeNewlyEligiblePaths(['src/a.ts', 'src/b.ts'], ['src/a.ts', 'src/b.ts'])).toEqual(
      [],
    );
  });

  it('(c) an absent stored hash is treated as a mismatch — the first-run scan recovers unindexed files and is benign when up to date', () => {
    // Sync state predating #2366 has no indexExclusionHash; runSync compares
    // `undefined !== currentHash` → mismatch → the newly-eligible pass runs.
    // On a partially-unindexed tree that one-time scan recovers exactly the gap…
    expect(computeNewlyEligiblePaths(['src/a.ts', 'docs/uncovered.md'], ['src/a.ts'])).toEqual([
      'docs/uncovered.md',
    ]);
    // …and on an up-to-date index (live ⊆ indexed) the enqueue is empty, so the
    // absent-hash mismatch costs existing consumers nothing.
    expect(computeNewlyEligiblePaths(['src/a.ts', 'src/b.ts'], ['src/a.ts', 'src/b.ts'])).toEqual(
      [],
    );
  });

  it('separator-normalized like the orphan pass: a backslash-indexed live file is not re-enqueued', () => {
    expect(computeNewlyEligiblePaths(['src/live.ts'], ['src\\live.ts'])).toEqual([]);
  });

  it('returns raw live paths so the caller re-embeds via the resolved file record', () => {
    expect(computeNewlyEligiblePaths(['docs/new.md', 'src/a.ts'], [])).toEqual([
      'docs/new.md',
      'src/a.ts',
    ]);
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

// ─── Full-sync crash recovery (#2562, ADR-115 Train-1 induced regression) ───
//
// The defect: `--full` reset the store, crashed mid-embed, and left the
// previous SUCCESSFUL sync's baseline behind — so the next plain `totem sync`
// diffed from the old SHA, saw 0 changed files, and reported "Sync complete:
// 0 files" over the gutted store. These tests reproduce that state with a
// crash-at-flush-K embedder and lock in the checkpoint/resume contract.

const FULL_SYNC_CHECKPOINT_FILE = 'cache/full-sync-checkpoint.json';
const HEAVY_TIMEOUT_MS = 60_000;

/** Embeds deterministically; throws a quota-shaped 429 from call N onward. */
class ScriptedEmbedder implements Embedder {
  readonly dimensions: number;
  embedCalls: string[][] = [];
  failFromCall: number | null = null;
  onCall: (() => void) | undefined;
  private calls = 0;

  constructor(dimensions: number = 4) {
    this.dimensions = dimensions;
  }

  embed(texts: string[]): Promise<number[][]> {
    this.calls++;
    this.onCall?.();
    if (this.failFromCall !== null && this.calls >= this.failFromCall) {
      return Promise.reject(
        Object.assign(new Error('quota exceeded: RESOURCE_EXHAUSTED'), { status: 429 }),
      );
    }
    this.embedCalls.push([...texts]);
    return Promise.resolve(texts.map((_, i) => new Array(this.dimensions).fill(i % 7)));
  }

  /** All text embedded across every call, joined for content assertions. */
  allText(): string {
    return this.embedCalls.flat().join('\n');
  }
}

describe('full-sync crash recovery (#2562)', () => {
  let tmpDir: string;
  let config: TotemConfig;

  const run = (embedder: Embedder, incremental: boolean) =>
    runSync(config, { projectRoot: tmpDir, incremental, embedder });

  const checkpointPath = () => path.join(tmpDir, '.totem', FULL_SYNC_CHECKPOINT_FILE);
  const syncStatePath = () => path.join(tmpDir, '.totem', 'cache/sync-state.json');
  const git = (cmd: string) => execSync(`git ${cmd}`, { cwd: tmpDir, stdio: 'pipe' });

  /** ~80 chunks per file — two files overflow EMBED_BATCH_SIZE (100), so the
   *  first flush lands at the b.md file boundary and the crash-at-flush-2
   *  embedder dies on c.md's flush with a+b already in the store. */
  const writeCorpusFile = (name: string, stem: string) => {
    const sections = Array.from(
      { length: 80 },
      (_, i) => `## ${stem} ${i}\n\n${stem}-content-${i}\n`,
    ).join('\n');
    fs.writeFileSync(path.join(tmpDir, name), `# ${stem}\n\n${sections}`, 'utf-8');
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-fullsync-'));
    config = TotemConfigSchema.parse({
      targets: [{ glob: '*.md', type: 'spec', strategy: 'markdown-heading' }],
      embedding: { provider: 'gemini', model: 'test-model', dimensions: 4 },
    });
    writeCorpusFile('a.md', 'alpha');
    writeCorpusFile('b.md', 'bravo');
    writeCorpusFile('c.md', 'charlie');
    git('init');
    git('config user.email "test@test.com"');
    git('config user.name "Test"');
    git('add a.md b.md c.md');
    git('commit -m init');
  });

  afterEach(() => {
    cleanTmpDir(tmpDir);
  });

  const ALL_FILES = ['a.md', 'b.md', 'c.md'];
  const STEM: Record<string, string> = { 'a.md': 'alpha', 'b.md': 'bravo', 'c.md': 'charlie' };

  const readCheckpoint = () =>
    JSON.parse(fs.readFileSync(checkpointPath(), 'utf-8')) as { completedFiles: string[] };

  /** The one file the crashed epoch never flushed (glob order is not guaranteed,
   *  so which file that is must be READ from the checkpoint, not assumed). */
  const unflushedFile = () => {
    const { completedFiles } = readCheckpoint();
    const missing = ALL_FILES.filter((f) => !completedFiles.includes(f));
    expect(missing).toHaveLength(1);
    return missing[0]!;
  };

  /** Crash a full sync at the second flush: two files land, the third does not. */
  async function crashFullSync(): Promise<ScriptedEmbedder> {
    const crasher = new ScriptedEmbedder();
    crasher.failFromCall = 2;
    await expect(run(crasher, false)).rejects.toThrow('RESOURCE_EXHAUSTED');
    return crasher;
  }

  it(
    'a crashed --full leaves the dirty marker with only fully-flushed files checkpointed',
    { timeout: HEAVY_TIMEOUT_MS },
    async () => {
      const crasher = new ScriptedEmbedder();
      crasher.failFromCall = 2;
      let markerSeenDuringEmbed = false;
      crasher.onCall = () => {
        markerSeenDuringEmbed ||= fs.existsSync(checkpointPath());
      };

      await expect(run(crasher, false)).rejects.toThrow('RESOURCE_EXHAUSTED');

      // The marker was already on disk when the first embed call ran — no
      // window exists where the store is reset but unmarked.
      expect(markerSeenDuringEmbed).toBe(true);

      // Exactly the two fully-flushed files are checkpointed; the file whose
      // flush crashed is not (whole-file flush boundaries).
      const cp = JSON.parse(fs.readFileSync(checkpointPath(), 'utf-8'));
      expect(cp.completedFiles).toHaveLength(2);
      expect(ALL_FILES.filter((f: string) => !cp.completedFiles.includes(f))).toHaveLength(1);
      expect(cp.embedder).toEqual({ provider: 'gemini', model: 'test-model', dimensions: 4 });
      expect(typeof cp.startedHeadSha).toBe('string');
      // No successful sync ever completed — no baseline may exist.
      expect(fs.existsSync(syncStatePath())).toBe(false);
    },
  );

  it(
    'INDUCED REGRESSION: the next plain sync resumes the full re-index instead of reporting complete over a partial store',
    { timeout: HEAVY_TIMEOUT_MS },
    async () => {
      await crashFullSync();
      const missing = unflushedFile();
      const flushed = ALL_FILES.filter((f) => f !== missing);

      const resumer = new ScriptedEmbedder();
      const result = await run(resumer, true); // plain `totem sync`

      // Pre-fix this reported 0 files processed over a partial store.
      expect(result.filesProcessed).toBe(1);
      expect(resumer.allText()).toContain(`${STEM[missing]}-content-1`);
      for (const kept of flushed) {
        expect(resumer.allText()).not.toContain(`${STEM[kept]}-content-1`);
      }

      // The store now holds the whole corpus, the marker is gone, and the
      // baseline points at HEAD — the epoch completed for real.
      const perFile = 81; // 80 sections + the h1 preamble section
      expect(result.totalChunks).toBeGreaterThanOrEqual(3 * (perFile - 2));
      expect(fs.existsSync(checkpointPath())).toBe(false);
      const state = JSON.parse(fs.readFileSync(syncStatePath(), 'utf-8'));
      const headSha = execSync('git rev-parse HEAD', { cwd: tmpDir, encoding: 'utf-8' }).trim();
      expect(state.lastSyncSha).toBe(headSha);
    },
  );

  it(
    'a file changed since the crashed epoch re-embeds on resume',
    { timeout: HEAVY_TIMEOUT_MS },
    async () => {
      await crashFullSync();
      const missing = unflushedFile();
      const [mutated, untouched] = ALL_FILES.filter((f) => f !== missing);

      fs.appendFileSync(
        path.join(tmpDir, mutated!),
        `\n## ${STEM[mutated!]} extra\n\n${STEM[mutated!]}-mutated\n`,
        'utf-8',
      );
      git(`add ${mutated}`);
      git('commit -m "mutate a flushed file"');

      const resumer = new ScriptedEmbedder();
      const result = await run(resumer, true);

      // The changed-since-epoch flushed file re-embeds alongside the
      // never-flushed one; the untouched flushed file stays skipped.
      expect(result.filesProcessed).toBe(2);
      expect(resumer.allText()).toContain(`${STEM[mutated!]}-mutated`);
      expect(resumer.allText()).toContain(`${STEM[missing]}-content-1`);
      expect(resumer.allText()).not.toContain(`${STEM[untouched!]}-content-1`);
    },
  );

  it(
    'a corrupt checkpoint is dirty-but-unusable: the full re-index restarts from zero',
    { timeout: HEAVY_TIMEOUT_MS },
    async () => {
      await crashFullSync();
      fs.writeFileSync(checkpointPath(), '{ not json !!', 'utf-8');

      const resumer = new ScriptedEmbedder();
      const result = await run(resumer, true);

      expect(result.filesProcessed).toBe(3);
      expect(fs.existsSync(checkpointPath())).toBe(false);
    },
  );

  it(
    'an embedder-config change makes checkpointed progress unusable — restart from zero',
    { timeout: HEAVY_TIMEOUT_MS },
    async () => {
      await crashFullSync();

      const differentDims = new ScriptedEmbedder(8);
      const result = await run(differentDims, true);

      expect(result.filesProcessed).toBe(3);
      expect(differentDims.allText()).toContain('alpha-content-1');
      expect(fs.existsSync(checkpointPath())).toBe(false);
    },
  );

  it(
    'a marker-write failure aborts BEFORE the store is destroyed',
    { timeout: HEAVY_TIMEOUT_MS },
    async () => {
      const healthy = new ScriptedEmbedder();
      const first = await run(healthy, false);
      expect(first.totalChunks).toBeGreaterThan(0);

      // Occupy the checkpoint path with a directory: the atomic rename in the
      // marker write must fail, and the reset must never run.
      fs.mkdirSync(checkpointPath(), { recursive: true });
      await expect(run(new ScriptedEmbedder(), false)).rejects.toThrow();

      fs.rmSync(checkpointPath(), { recursive: true, force: true });
      fs.rmSync(checkpointPath() + '.tmp', { force: true });

      // The store survived the aborted run: a plain incremental sync sees a
      // clean baseline and the full chunk count, not an empty or partial store.
      const after = await run(new ScriptedEmbedder(), true);
      expect(after.filesProcessed).toBe(0);
      expect(after.totalChunks).toBe(first.totalChunks);
    },
  );
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
