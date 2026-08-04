import { execFileSync } from 'node:child_process';
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
  /** Awaited at embed entry — lets a cell hold the embed open while timers fire (#2564). */
  onCallAsync: (() => Promise<void>) | undefined;
  describeEffective?: () => { provider: string; model: string; dimensions: number } | null;
  resolveEffective?: () => Promise<{ provider: string; model: string; dimensions: number }>;
  private calls = 0;

  constructor(dimensions: number = 4) {
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<number[][]> {
    this.calls++;
    this.onCall?.();
    if (this.onCallAsync) await this.onCallAsync();
    if (this.failFromCall !== null && this.calls >= this.failFromCall) {
      throw Object.assign(new Error('quota exceeded: RESOURCE_EXHAUSTED'), { status: 429 });
    }
    this.embedCalls.push([...texts]);
    return texts.map((_, i) => new Array(this.dimensions).fill(i % 7));
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
  const git = (...args: string[]) => execFileSync('git', args, { cwd: tmpDir, stdio: 'pipe' });

  /** Exactly 80 chunks per file (one per `##` section; the `#` preamble has
   *  no body text, so it yields no chunk) — 240 total. Two files overflow
   *  EMBED_BATCH_SIZE (100), so the first flush lands at a file boundary and
   *  the crash-at-flush-2 embedder dies on the third file's flush with two
   *  files already in the store. */
  const TOTAL_CHUNKS = 240;
  const writeCorpusFileTo = (dir: string, name: string, stem: string) => {
    const sections = Array.from(
      { length: 80 },
      (_, i) => `## ${stem} ${i}\n\n${stem}-content-${i}\n`,
    ).join('\n');
    fs.writeFileSync(path.join(dir, name), `# ${stem}\n\n${sections}`, 'utf-8');
  };
  const writeCorpusFile = (name: string, stem: string) => writeCorpusFileTo(tmpDir, name, stem);

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
    git('config', 'user.email', 'test@test.com');
    git('config', 'user.name', 'Test');
    git('add', '--', 'a.md', 'b.md', 'c.md');
    git('commit', '-m', 'init');
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
    '#2564: a lock stolen mid-embed aborts loudly at the flush boundary, keeps the marker, and leaves the thief lock intact',
    { timeout: HEAVY_TIMEOUT_MS },
    async () => {
      const lockFile = path.join(tmpDir, '.totem', 'sync.lock');
      const foreign = {
        pid: 424242,
        timestamp: Date.now(),
        createdAt: Date.now(),
        holderId: 'thief-holder',
      };

      const embedder = new ScriptedEmbedder();
      let swapped = false;
      embedder.onCallAsync = async () => {
        // First flush (two files) lands clean; the theft hits during the
        // second flush's embed — the paced multi-minute window from the issue.
        if (embedder.embedCalls.length >= 1 && !swapped) {
          swapped = true;
          fs.writeFileSync(lockFile, JSON.stringify(foreign));
          // Idle long enough for a 25ms heartbeat to observe and latch.
          await new Promise((r) => setTimeout(r, 300));
        }
      };

      await expect(
        runSync(config, {
          projectRoot: tmpDir,
          incremental: false,
          embedder,
          lockOptions: { heartbeatIntervalMs: 25 },
        }),
      ).rejects.toThrow('Sync lock was lost');
      expect(swapped).toBe(true);

      // The mutating degraded path preserved crash safety: the marker is
      // intact...
      expect(fs.existsSync(checkpointPath())).toBe(true);
      // ...and the abort came from the flush EXIT probe, BEFORE the
      // post-theft checkpoint append: only the two pre-theft files are
      // checkpointed. Deleting the exit probe lets the last flush append the
      // third file and fails here (leg MAJOR-1 — an existsSync check alone
      // cannot tell WHICH probe fired). The ENTRY probe is not inducible
      // in-process on the full path — no await exists between one flush's
      // exit probe and the next flush's entry probe for a beat to latch in
      // (leg MINOR-R1, disclosed); its marginal window is the incremental
      // purge gap, and a miss converges at the next probe.
      expect(readCheckpoint().completedFiles).toHaveLength(2);
      // ...no completion-claiming baseline was written...
      expect(fs.existsSync(syncStatePath())).toBe(false);
      // ...and the thief's lock survived our release (no cascade theft).
      expect(JSON.parse(fs.readFileSync(lockFile, 'utf-8'))).toEqual(foreign);

      // Recovery control: with the thief gone, the next sync resumes the
      // epoch and completes the full corpus — and actually re-embeds the
      // un-checkpointed file (store.count() alone would pass on a zero-work
      // resume, leg MAJOR-1).
      fs.unlinkSync(lockFile);
      const finisher = new ScriptedEmbedder();
      const result = await run(finisher, false);
      expect(result.totalChunks).toBe(TOTAL_CHUNKS);
      expect(finisher.embedCalls.length).toBeGreaterThan(0);
      expect(fs.existsSync(checkpointPath())).toBe(false);
    },
  );

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
      // The lying sensor NEEDS a surviving baseline from a previous
      // SUCCESSFUL sync: pre-fix, the crashed --full left this state file
      // intact over the reset store, the next plain sync diffed
      // lastSyncSha..HEAD, saw 0 changed files, and reported "Sync
      // complete: 0 files" (falsification round 1, MAJOR 5 — without this
      // baseline the pre-fix code fails via the git-diff fallback instead).
      const first = await run(new ScriptedEmbedder(), false);
      expect(first.totalChunks).toBe(TOTAL_CHUNKS);
      const staleState = fs.readFileSync(syncStatePath(), 'utf-8');

      await crashFullSync();
      const missing = unflushedFile();
      const flushed = ALL_FILES.filter((f) => f !== missing);

      // The crash left the stale baseline byte-identical — the defect's
      // exact precondition.
      expect(fs.readFileSync(syncStatePath(), 'utf-8')).toBe(staleState);

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
      expect(result.totalChunks).toBe(TOTAL_CHUNKS);
      expect(fs.existsSync(checkpointPath())).toBe(false);
      const state = JSON.parse(fs.readFileSync(syncStatePath(), 'utf-8'));
      const headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: tmpDir,
        encoding: 'utf-8',
      }).trim();
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
      git('add', '--', mutated!);
      git('commit', '-m', 'mutate a flushed file');

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
    'GT round: a completed file EMPTIED since the epoch purges its stale rows on resume',
    { timeout: HEAVY_TIMEOUT_MS },
    async () => {
      await crashFullSync();
      const missing = unflushedFile();
      const [emptied] = ALL_FILES.filter((f) => f !== missing);

      // The file now yields ZERO chunks. Its old rows must still purge —
      // after this run the baseline advances past the change, so no later
      // incremental diff revisits it and stale rows would be searchable
      // forever (#2569 Greptile P1).
      fs.writeFileSync(path.join(tmpDir, emptied!), `# ${STEM[emptied!]}\n`, 'utf-8');
      git('add', '--', emptied!);
      git('commit', '-m', 'empty a flushed file');

      const resumer = new ScriptedEmbedder();
      const result = await run(resumer, true);

      // The emptied file's 80 rows are gone; the never-flushed file's 80 landed.
      expect(result.totalChunks).toBe(TOTAL_CHUNKS - 80);
      expect(resumer.allText()).not.toContain(`${STEM[emptied!]}-content-1`);
      expect(fs.existsSync(checkpointPath())).toBe(false);
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
      expect(first.totalChunks).toBe(TOTAL_CHUNKS);

      // Occupy the checkpoint path with a directory. The run first reads it
      // as a checkpoint (EISDIR → dirty-but-unusable), then the restart's
      // marker write fails at the atomic rename — and the reset never runs.
      fs.mkdirSync(checkpointPath(), { recursive: true });
      await expect(run(new ScriptedEmbedder(), false)).rejects.toThrow();

      fs.rmSync(checkpointPath(), { recursive: true, force: true });
      fs.rmSync(`${checkpointPath()}.${process.pid}.tmp`, { force: true });

      // The store survived the aborted run: a plain incremental sync sees a
      // clean baseline and the full chunk count, not an empty or partial store.
      const after = await run(new ScriptedEmbedder(), true);
      expect(after.filesProcessed).toBe(0);
      expect(after.totalChunks).toBe(first.totalChunks);
    },
  );

  // ─── Falsification round 1 regressions ───

  it(
    'MAJOR 1: a store emptied under a live checkpoint is re-embedded in full, not trusted from paper',
    { timeout: HEAVY_TIMEOUT_MS },
    async () => {
      const first = await run(new ScriptedEmbedder(), false);
      expect(first.totalChunks).toBe(TOTAL_CHUNKS);
      await crashFullSync();

      // Simulate the heal-by-nuke path (LanceStore.connect on a corrupt
      // dataset): the store vanishes while the checkpoint still claims two
      // files are embedded.
      fs.rmSync(path.join(tmpDir, config.lanceDir), { recursive: true, force: true });

      const resumer = new ScriptedEmbedder();
      const result = await run(resumer, true);

      // Pre-fold this embedded ONLY the unflushed file over an empty store
      // and wrote a clean baseline — the #2562 lying sensor by another door.
      expect(result.filesProcessed).toBe(3);
      expect(result.totalChunks).toBe(TOTAL_CHUNKS);
      expect(fs.existsSync(checkpointPath())).toBe(false);
    },
  );

  it(
    'MAJOR 2: untracked corpus files stay checkpointed across a resume (quota convergence)',
    { timeout: HEAVY_TIMEOUT_MS },
    async () => {
      // Make the corpus untracked-but-live: git has no history for it, so it
      // is a PERMANENT member of git's changed-union. Pre-fold that union
      // evicted these files from the completed set on every resume — quota
      // re-spent on the same files forever, never converging.
      git('rm', '--cached', '--', 'a.md', 'b.md', 'c.md');
      git('commit', '-m', 'untrack corpus');

      await crashFullSync();
      const missing = unflushedFile();

      const resumer = new ScriptedEmbedder();
      const result = await run(resumer, true);

      expect(result.filesProcessed).toBe(1);
      expect(resumer.allText()).toContain(`${STEM[missing]}-content-1`);
      expect(result.totalChunks).toBe(TOTAL_CHUNKS);
      expect(fs.existsSync(checkpointPath())).toBe(false);
    },
  );

  it(
    'MAJOR 2: an untracked completed file MODIFIED after the crash still re-embeds (mtime arm)',
    { timeout: HEAVY_TIMEOUT_MS },
    async () => {
      git('rm', '--cached', '--', 'a.md', 'b.md', 'c.md');
      git('commit', '-m', 'untrack corpus');

      await crashFullSync();
      const missing = unflushedFile();
      const [mutated] = ALL_FILES.filter((f) => f !== missing);

      // Ensure the edit's mtime lands measurably after the epoch start.
      await new Promise((resolve) => setTimeout(resolve, 20));
      fs.appendFileSync(
        path.join(tmpDir, mutated!),
        `\n## ${STEM[mutated!]} extra\n\n${STEM[mutated!]}-mutated\n`,
        'utf-8',
      );

      const resumer = new ScriptedEmbedder();
      const result = await run(resumer, true);

      expect(result.filesProcessed).toBe(2); // mutated (mtime > epoch) + never-flushed
      expect(resumer.allText()).toContain(`${STEM[mutated!]}-mutated`);
      expect(resumer.allText()).toContain(`${STEM[missing]}-content-1`);
    },
  );

  it(
    'MAJOR 3: a checkpoint stamped with a fallback embedder identity restarts instead of resuming',
    { timeout: HEAVY_TIMEOUT_MS },
    async () => {
      // The crashing run's embedder reports an EFFECTIVE identity (the
      // LazyEmbedder Ollama-fallback shape) that differs from the configured
      // gemini fingerprint — the checkpoint must record the effective one.
      const crasher = new ScriptedEmbedder();
      crasher.failFromCall = 2;
      crasher.describeEffective = () => ({
        provider: 'ollama',
        model: 'nomic-embed-text',
        dimensions: 4,
      });
      await expect(run(crasher, false)).rejects.toThrow('RESOURCE_EXHAUSTED');
      const cp = JSON.parse(fs.readFileSync(checkpointPath(), 'utf-8'));
      expect(cp.embedder.provider).toBe('ollama');

      // The resume runs under the configured gemini fingerprint — the
      // stamped ollama progress is unusable: vector spaces must not mix.
      const resumer = new ScriptedEmbedder();
      const result = await run(resumer, true);
      expect(result.filesProcessed).toBe(3);
      expect(result.totalChunks).toBe(TOTAL_CHUNKS);
    },
  );

  it(
    'F2: a PERSISTENT fallback resumes as itself instead of restart-looping',
    { timeout: HEAVY_TIMEOUT_MS },
    async () => {
      const ollamaId = { provider: 'ollama', model: 'nomic-embed-text', dimensions: 4 };
      const crasher = new ScriptedEmbedder();
      crasher.failFromCall = 2;
      crasher.describeEffective = () => ollamaId;
      await expect(run(crasher, false)).rejects.toThrow('RESOURCE_EXHAUSTED');
      const missing = unflushedFile();

      // The fallback persists into the next run: it resolves to the SAME
      // effective identity, so the epoch continues. Pre-fold, the gate
      // compared the stamped ollama identity against the CONFIG (gemini)
      // fingerprint and restart-looped forever, resetting the store on
      // every attempt — a corpus needing more than one run never completed.
      const resumer = new ScriptedEmbedder();
      resumer.resolveEffective = () => Promise.resolve(ollamaId);
      const result = await run(resumer, true);

      expect(result.filesProcessed).toBe(1);
      expect(resumer.allText()).toContain(`${STEM[missing]}-content-1`);
      expect(result.totalChunks).toBe(TOTAL_CHUNKS);
      expect(fs.existsSync(checkpointPath())).toBe(false);
    },
  );

  it(
    'F1: a run falling back mid-resume restarts BEFORE inserting into the genuine epoch',
    { timeout: HEAVY_TIMEOUT_MS },
    async () => {
      await crashFullSync(); // checkpoint carries the genuine (gemini) fingerprint

      // This run's embedder RESOLVES to an ollama fallback. The gate must
      // compare effective-vs-effective and restart — pre-fold it compared
      // config-vs-stamped (gemini vs gemini → match) and ollama vectors were
      // inserted beside the epoch's gemini rows, mixing vector spaces.
      const resumer = new ScriptedEmbedder();
      resumer.resolveEffective = () =>
        Promise.resolve({ provider: 'ollama', model: 'nomic-embed-text', dimensions: 4 });
      const result = await run(resumer, true);

      expect(result.filesProcessed).toBe(3);
      expect(result.totalChunks).toBe(TOTAL_CHUNKS);
      expect(fs.existsSync(checkpointPath())).toBe(false);
    },
  );

  it(
    'MINOR 10: a zero-work resume clears the marker WITHOUT requiring an embedder',
    { timeout: HEAVY_TIMEOUT_MS },
    async () => {
      // Epoch crashed between its final flush and the marker delete: the
      // store is complete but the marker survives. The resume has nothing to
      // embed, so the identity gate must not force embedder resolution — a
      // missing embedder would otherwise wedge the epoch closed forever.
      const first = await run(new ScriptedEmbedder(), false);
      expect(first.totalChunks).toBe(TOTAL_CHUNKS);
      const headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: tmpDir,
        encoding: 'utf-8',
      }).trim();
      fs.writeFileSync(
        checkpointPath(),
        JSON.stringify({
          startedHeadSha: headSha,
          startedAt: Date.now(),
          indexExclusionHash: 'whatever',
          embedder: { provider: 'gemini', model: 'test-model', dimensions: 4 },
          completedFiles: ALL_FILES,
        }),
        'utf-8',
      );

      const unresolvable = new ScriptedEmbedder();
      unresolvable.resolveEffective = () => Promise.reject(new Error('no embedder available'));
      const result = await run(unresolvable, true);

      expect(result.filesProcessed).toBe(0);
      expect(unresolvable.embedCalls).toHaveLength(0);
      expect(result.totalChunks).toBe(TOTAL_CHUNKS);
      expect(fs.existsSync(checkpointPath())).toBe(false);
    },
  );

  it(
    'ROUND 4: a RESOLVABLE identity mismatch restarts even with zero work remaining',
    { timeout: HEAVY_TIMEOUT_MS },
    async () => {
      // The zero-work exemption is for RESOLUTION FAILURE only. A resolvable
      // mismatch with nothing left to embed must still restart: clearing the
      // marker would rewrite index-meta to the new identity and launder the
      // DATABASE_MISMATCH evidence over a store built in the old space.
      const first = await run(new ScriptedEmbedder(), false);
      expect(first.totalChunks).toBe(TOTAL_CHUNKS);
      const headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: tmpDir,
        encoding: 'utf-8',
      }).trim();
      fs.writeFileSync(
        checkpointPath(),
        JSON.stringify({
          startedHeadSha: headSha,
          startedAt: Date.now(),
          indexExclusionHash: 'whatever',
          embedder: { provider: 'ollama', model: 'nomic-embed-text', dimensions: 4 },
          completedFiles: ALL_FILES,
        }),
        'utf-8',
      );

      // Plain resolvable embedder — falls back to the config (gemini)
      // fingerprint, which mismatches the stamped ollama identity.
      const resumer = new ScriptedEmbedder();
      const result = await run(resumer, true);

      expect(result.filesProcessed).toBe(3); // restarted, not cleared
      expect(result.totalChunks).toBe(TOTAL_CHUNKS);
      expect(fs.existsSync(checkpointPath())).toBe(false);
    },
  );

  it(
    'MAJOR 4: a non-git project resumes via the mtime arm instead of restarting every run',
    { timeout: HEAVY_TIMEOUT_MS },
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'totem-nongit-'));
      try {
        writeCorpusFileTo(dir, 'a.md', 'alpha');
        writeCorpusFileTo(dir, 'b.md', 'bravo');
        writeCorpusFileTo(dir, 'c.md', 'charlie');

        const crasher = new ScriptedEmbedder();
        crasher.failFromCall = 2;
        await expect(
          runSync(config, { projectRoot: dir, incremental: false, embedder: crasher }),
        ).rejects.toThrow('RESOURCE_EXHAUSTED');

        const cpPath = path.join(dir, '.totem', FULL_SYNC_CHECKPOINT_FILE);
        const cp = JSON.parse(fs.readFileSync(cpPath, 'utf-8'));
        expect(cp.startedHeadSha).toBeNull();
        expect(cp.completedFiles).toHaveLength(2);

        const resumer = new ScriptedEmbedder();
        const result = await runSync(config, {
          projectRoot: dir,
          incremental: true,
          embedder: resumer,
        });

        // Pre-fold, null startedHeadSha mapped to restart-from-zero on every
        // run — the population with no diff signal could never converge.
        expect(result.filesProcessed).toBe(1);
        expect(result.totalChunks).toBe(TOTAL_CHUNKS);
        expect(fs.existsSync(cpPath)).toBe(false);
      } finally {
        cleanTmpDir(dir);
      }
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
