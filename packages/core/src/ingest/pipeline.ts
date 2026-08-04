import * as fs from 'node:fs';
import * as path from 'node:path';

import { calculateDeterministicHash } from '../artifacts/hash.js';
import { createChunker } from '../chunkers/chunker.js';
import type { TotemConfig } from '../config-schema.js';
import { requireEmbedding } from '../config-schema.js';
import { createEmbedder } from '../embedders/embedder.js';
import { TotemDatabaseError, TotemError } from '../errors.js';
import type { LockRelease } from '../lock.js';
import { withLock } from '../lock.js';
import { sanitizeForIngestion } from '../sanitize.js';
import { LanceStore } from '../store/lance-store.js';
import { sanitizeForTerminal } from '../terminal-sanitize.js';
import type { Chunk, FullSyncCheckpoint, SyncOptions, SyncState } from '../types.js';
import type { ResolvedFile } from './file-resolver.js';
import {
  getChangedFiles,
  getChangedFilesDetailed,
  getHeadSha,
  resolveFiles,
} from './file-resolver.js';

const EMBED_BATCH_SIZE = 100;
const SYNC_STATE_FILE = 'cache/sync-state.json';
const INDEX_META_FILE = 'cache/index-meta.json';
const FULL_SYNC_CHECKPOINT_FILE = 'cache/full-sync-checkpoint.json';

interface IndexMeta {
  provider: string;
  model: string;
  dimensions: number;
  lastSync: string; // ISO timestamp
}

function readIndexMeta(totemDir: string): IndexMeta | null {
  const metaPath = path.join(totemDir, INDEX_META_FILE);
  try {
    const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as IndexMeta;
    if (
      parsed &&
      typeof parsed.provider === 'string' &&
      typeof parsed.model === 'string' &&
      typeof parsed.dimensions === 'number' &&
      typeof parsed.lastSync === 'string'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function writeIndexMeta(totemDir: string, meta: IndexMeta): void {
  const metaPath = path.join(totemDir, INDEX_META_FILE);
  const dir = path.dirname(metaPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf-8');
}

/**
 * Verify that the current embedding config matches the index.
 * Throws TotemDatabaseError if there's a mismatch.
 */
/**
 * Verify that the current embedding config matches the index.
 * Compares provider name only — dimensions are checked at sync time
 * when the actual embedder resolves its effective dimensions.
 * Throws TotemDatabaseError if the provider has changed.
 */
export function verifyIndexMeta(totemDir: string, config: TotemConfig): void {
  const embedding = config.embedding;
  if (!embedding) return; // Lite tier — no index to verify

  const meta = readIndexMeta(totemDir);
  if (!meta) return; // No meta yet — first sync hasn't happened

  if (meta.provider !== embedding.provider) {
    throw new TotemDatabaseError(
      `Index was built with ${meta.provider} (${meta.dimensions}d) but config now uses ${embedding.provider}.`,
      "Run 'totem sync --full' to rebuild the index.",
      'DATABASE_MISMATCH',
    );
  }

  // If explicit dimensions are set and don't match, warn
  if (embedding.dimensions && meta.dimensions !== embedding.dimensions) {
    throw new TotemDatabaseError(
      `Index was built with ${meta.dimensions}d vectors but config now specifies ${embedding.dimensions}d.`,
      "Run 'totem sync --full' to rebuild the index.",
      'DATABASE_MISMATCH',
    );
  }
}

function readSyncState(totemDir: string, onProgress?: (msg: string) => void): SyncState | null {
  const statePath = path.join(totemDir, SYNC_STATE_FILE);
  try {
    const raw = fs.readFileSync(statePath, 'utf-8');
    const parsed = JSON.parse(raw) as SyncState;
    if (
      typeof parsed.lastSyncSha === 'string' &&
      parsed.lastSyncSha &&
      typeof parsed.timestamp === 'number'
    ) {
      return parsed;
    }
    onProgress?.(`Warning: Ignoring malformed sync state file at ${statePath}.`);
    return null;
  } catch (err) {
    // ENOENT is expected on first run — don't warn
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    onProgress?.(
      `Warning: Failed to read sync state: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Atomic JSON write (tmp + rename): a crash mid-write must never leave a torn
 * state file — sync state and the full-sync checkpoint are both trusted by the
 * NEXT run's control flow (#2562), matching the index-manifest write pattern.
 */
function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  // PID-unique tmp name: two writers racing under a stolen stale lock must
  // not interleave through one tmp path (falsification round 1, MINOR 6).
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

function writeSyncState(totemDir: string, state: SyncState): void {
  writeJsonAtomic(path.join(totemDir, SYNC_STATE_FILE), state);
}

/**
 * Read the full-sync checkpoint (#2562). The caller has already established
 * the file EXISTS (existence = the dirty marker); a parse/shape failure here
 * means "dirty but unusable" — the caller restarts the full re-index from
 * zero. A present-but-corrupt checkpoint is never treated as a clean state.
 */
function readFullSyncCheckpoint(
  totemDir: string,
  onProgress?: (msg: string) => void,
): FullSyncCheckpoint | null {
  const cpPath = path.join(totemDir, FULL_SYNC_CHECKPOINT_FILE);
  try {
    const parsed = JSON.parse(fs.readFileSync(cpPath, 'utf-8')) as FullSyncCheckpoint;
    if (
      parsed &&
      (parsed.startedHeadSha === null || typeof parsed.startedHeadSha === 'string') &&
      typeof parsed.startedAt === 'number' &&
      typeof parsed.indexExclusionHash === 'string' &&
      typeof parsed.embedder?.provider === 'string' &&
      typeof parsed.embedder?.model === 'string' &&
      typeof parsed.embedder?.dimensions === 'number' &&
      Array.isArray(parsed.completedFiles) &&
      parsed.completedFiles.every((f) => typeof f === 'string')
    ) {
      return parsed;
    }
    onProgress?.(`Warning: malformed full-sync checkpoint at ${cpPath} — ignoring its progress.`);
    return null;
    // totem-context: intentional warn+null on an unreadable checkpoint (mmnto-ai/totem#2562) — dirty-but-unusable restarts the full re-index from zero; failing the sync over a torn checkpoint would wedge every subsequent run.
  } catch (err) {
    onProgress?.(
      `Warning: failed to read full-sync checkpoint: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

function writeFullSyncCheckpoint(totemDir: string, checkpoint: FullSyncCheckpoint): void {
  writeJsonAtomic(path.join(totemDir, FULL_SYNC_CHECKPOINT_FILE), checkpoint);
}

/**
 * Whether a full re-index epoch is in progress (its dirty marker exists) for
 * the given totem dir (#2562). Exposed for callers that spawn or gate syncs
 * under bounded budgets — e.g. the MCP add-lesson tool's 60s-killed
 * convenience sync, which a promoted paced resume can never finish
 * (falsification round 3, MAJOR 1): such callers should skip and defer to the
 * running epoch instead of timing out against it.
 */
export function hasFullSyncCheckpoint(totemDir: string): boolean {
  return fs.existsSync(path.join(totemDir, FULL_SYNC_CHECKPOINT_FILE));
}

/**
 * Best-effort marker delete at successful completion. A failed delete is loud
 * but non-fatal: the next run resumes-full as a near-noop and retries the
 * delete, so correctness converges (#2562).
 */
function deleteFullSyncCheckpoint(totemDir: string, onProgress?: (msg: string) => void): void {
  try {
    fs.rmSync(path.join(totemDir, FULL_SYNC_CHECKPOINT_FILE), { force: true });
    // totem-context: intentional best-effort delete (mmnto-ai/totem#2562) — a failed marker delete only makes the next run resume-full as a near-noop and retry it; aborting a fully-successful sync over it would be the drift.
  } catch (err) {
    onProgress?.(
      `Warning: failed to delete full-sync checkpoint: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * One entry in the index-manifest `documents[]` array.
 *
 * `lastSynced` is the time the manifest itself was written, not a per-document
 * sync timestamp — LanceDB rows do not currently carry per-row sync timestamps,
 * so every document in a single manifest carries the same `lastSynced` value
 * (equal to `IndexManifest.writtenAt`). Treat it as a manifest-level signal,
 * not as per-document staleness data.
 */
export interface ManifestDocument {
  sourceFile: string;
  /**
   * Pack name (`@scope/pkg` or `pkg`) when the source file lives under
   * `node_modules/`; otherwise `local`. Derived from path structure only;
   * never from filename- or path-identity matches.
   */
  origin: string;
  rowCount: number;
  /** See `ManifestDocument` doc-comment — this is manifest-write time, not per-doc sync time. */
  lastSynced: string;
}

/**
 * Persisted contents of `.totem/index-manifest.json`.
 *
 * Schema is versioned via {@link INDEX_MANIFEST_SCHEMA}. Consumers (e.g. the
 * `totem-status` Visor TUI) read this file to enumerate indexed documents
 * without needing the LanceDB Go/CGO bindings.
 *
 * `gitCommit` carries `git:<sha>` when a HEAD SHA is available at sync time.
 * The field is OMITTED entirely when no git SHA is available — never
 * synthesized as a fake-presence value (Tenet 14: honest absence over fake
 * presence; identity hashes must not masquerade as content hashes).
 */
export interface IndexManifest {
  schema: string;
  writtenAt: string;
  documents: ManifestDocument[];
  gitCommit?: string;
}

/** Current schema identifier persisted to `.totem/index-manifest.json`. */
export const INDEX_MANIFEST_SCHEMA = 'totem-index-manifest-v0.2';

/**
 * Builds an {@link IndexManifest} payload from the per-document data and the
 * sync run's HEAD SHA + write timestamp.
 *
 * - `writtenAt` is serialized to ISO-8601.
 * - `gitCommit` is included as `git:<sha>` only when `input.headSha` is a
 *   non-empty string; null / undefined / `''` cause the field to be omitted
 *   entirely (no `sha1:unknown` or other synthesized fake-presence values).
 * - `schema` is always set to {@link INDEX_MANIFEST_SCHEMA}.
 *
 * Pure helper — does not touch the filesystem. The sync pipeline is
 * responsible for atomic write/rename of the returned payload.
 */
export function buildIndexManifest(input: {
  documents: ManifestDocument[];
  headSha: string | null | undefined;
  writtenAt: Date;
}): IndexManifest {
  const manifest: IndexManifest = {
    schema: INDEX_MANIFEST_SCHEMA,
    writtenAt: input.writtenAt.toISOString(),
    documents: input.documents,
  };
  if (input.headSha) {
    manifest.gitCommit = `git:${input.headSha}`;
  }
  return manifest;
}

export async function runSync(
  config: TotemConfig,
  options: SyncOptions,
): Promise<{
  chunksProcessed: number;
  filesProcessed: number;
  totalChunks: number;
  orphansPurged: number;
}> {
  const { projectRoot, onProgress } = options;
  const log = onProgress ?? (() => {});
  const totemDir = path.join(projectRoot, config.totemDir);

  return withLock(
    totemDir,
    (lock) => runSyncInner(config, options, lock),
    (msg) => log(msg),
    options.lockOptions,
  );
}

/**
 * #2564: the checkpoint invariant stands on mutual exclusion. Once the
 * heartbeat observed the lock stolen, another sync may be mutating the store
 * or the checkpoint under its own epoch — abort loudly before writing
 * anything more. The marker stays on disk, so the next sync resumes this
 * epoch (ADR-115: a mutating degraded path fails loud and preserves state).
 */
function assertLockHeld(lock: LockRelease | undefined): void {
  if (lock?.isLost() === true) {
    throw new TotemError(
      'SYNC_FAILED',
      'Sync lock was lost mid-run — another process took it over.',
      'The interrupted re-index resumes from its checkpoint on the next totem sync.',
    );
  }
}

/**
 * Normalize a path separator to forward slashes for orphan COMPARISON only.
 * Deletes always use the raw stored path (mmnto-ai/totem#2151 W1): `deleteByFile`
 * matches the stored literal, so a legacy `src\x.ts` row must delete with
 * backslashes while never being false-orphaned against a forward-slash live path.
 */
function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Reconcile indexed paths against the working tree: an indexed path with no live
 * counterpart is an orphan to purge (mmnto-ai/totem#2151). Compares on a
 * separator-normalized key but RETURNS THE RAW indexed path (the caller deletes
 * via `deleteByFile`, a stored-literal match). Independent of the git diff
 * window — that independence is what self-heals deletions the baseline already
 * advanced past, and de-targeted / newly-ignored files git never reports.
 */
export function computeOrphanPaths(
  indexedRawPaths: string[],
  liveRelativePaths: string[],
): string[] {
  const live = new Set(liveRelativePaths.map(normalizeRel));
  return indexedRawPaths.filter((raw) => !live.has(normalizeRel(raw)));
}

/**
 * Order-normalized content hash of the effective index-exclusion set
 * (`ignorePatterns` ∪ `indexIgnorePatterns`). Patterns are sorted before hashing
 * so reordering the config is not a spurious mismatch — only a membership change
 * (a pattern added or removed) moves the hash. Persisted in sync state to detect
 * ignore-pattern REMOVALS between incremental syncs (mmnto-ai/totem#2366), which
 * the git-diff window alone never surfaces. Uses the one deterministic-hash
 * convention shared with run artifacts.
 */
export function hashIndexExclusionSet(patterns: string[]): string {
  // calculateDeterministicHash treats array order as significant — the .sort()
  // here IS the order-independence invariant. Do not remove or move it.
  return calculateDeterministicHash([...patterns].sort());
}

/**
 * Files that are index-eligible now but absent from the index — the symmetric
 * complement of {@link computeOrphanPaths} (mmnto-ai/totem#2366). Removing an
 * ignore pattern makes files eligible without changing their bytes, so the git
 * diff window never reports them; this recovers them by membership alone
 * (live-vs-indexed), independent of the diff. Compares on a separator-normalized
 * key like the orphan pass but RETURNS THE RAW live relative path (the caller
 * re-embeds via the resolved file record).
 */
export function computeNewlyEligiblePaths(
  liveRelativePaths: string[],
  indexedRawPaths: string[],
): string[] {
  const indexed = new Set(indexedRawPaths.map(normalizeRel));
  return liveRelativePaths.filter((rel) => !indexed.has(normalizeRel(rel)));
}

async function runSyncInner(
  config: TotemConfig,
  options: SyncOptions,
  lock?: LockRelease,
): Promise<{
  chunksProcessed: number;
  filesProcessed: number;
  totalChunks: number;
  orphansPurged: number;
}> {
  const { projectRoot, onProgress } = options;
  let incremental = options.incremental;
  const log = onProgress ?? (() => {});

  // 0. Capture HEAD SHA early — before any async work that might race with new commits
  const headSha = getHeadSha(projectRoot, log);

  // 1. Create embedder (or take the injected one — tests / embedding hosts).
  // `log` is threaded through so a LazyEmbedder Ollama fallback is AUDIBLE —
  // a silent vector-space switch mid-sync is sensor degradation (#2562).
  const embedding = requireEmbedding(config);
  log('Initializing embedding provider...');
  const embedder = options.embedder ?? createEmbedder(embedding, log);

  // Resume-compatibility fingerprint (#2562): a checkpointed epoch may only
  // continue under the embedder configuration that started it — vectors from
  // two configurations must never mix in one store. Mirrors writeIndexMeta.
  const embedderFingerprint = {
    provider: embedding.provider,
    model: embedding.model ?? 'default',
    dimensions: embedder.dimensions,
  };

  // 2. Connect to store
  const storePath = path.join(projectRoot, config.lanceDir);
  const store = new LanceStore(storePath, embedder, { absolutePathRoot: projectRoot });
  await store.connect();

  const totemDir = path.join(projectRoot, config.totemDir);

  // 2b (#2562). A live checkpoint marks an unfinished full re-index. It takes
  // precedence over the requested mode — the partial store must complete
  // before any incremental diff can be trusted again — and it subsumes the
  // empty-store heal below (an interrupted full that never flushed).
  let resumeFrom: FullSyncCheckpoint | null = null;
  if (hasFullSyncCheckpoint(totemDir)) {
    incremental = false;
    resumeFrom = readFullSyncCheckpoint(totemDir, log);
    log(
      resumeFrom
        ? `Previous full re-index did not complete — resuming it (${resumeFrom.completedFiles.length} file(s) checkpointed).`
        : 'Previous full re-index did not complete — restarting it from zero.',
    );
  }

  // 2c. Auto-heal: force full sync when incremental is requested but DB is empty
  if (incremental && (await store.isEmpty())) {
    log('Empty database detected. Forcing full sync...');
    incremental = false;
  }

  // 3. Resolve files to process. Index exclusion unions both keys:
  // `ignorePatterns` (legacy dual-scope) + `indexIgnorePatterns` (index-only,
  // mmnto-ai/totem#1748) — only the former also gates lint/shield scope.
  const exclusionPatterns = [...config.ignorePatterns, ...config.indexIgnorePatterns];
  const allFiles = resolveFiles(config.targets, projectRoot, exclusionPatterns, log);
  // Order-normalized hash of the effective exclusion set — persisted below and
  // compared on the next incremental sync to catch pattern REMOVALS (#2366).
  const indexExclusionHash = hashIndexExclusionSet(exclusionPatterns);
  let filesToProcess: ResolvedFile[];
  let deletedPaths: string[] = [];

  // #2562: active-epoch checkpoint (full mode only) — written before the store
  // is destroyed, appended after each successful flush, deleted on success.
  let checkpoint: FullSyncCheckpoint | null = null;
  let resumedWithoutReset = false;

  const freshCheckpoint = (): FullSyncCheckpoint => ({
    startedHeadSha: headSha,
    startedAt: Date.now(),
    indexExclusionHash,
    embedder: embedderFingerprint,
    completedFiles: [],
  });

  // The dirty marker MUST hit disk before the store is destroyed: a marker
  // write failure aborts loudly with the store intact, so no window exists in
  // which a reset store is unmarked (#2562).
  async function beginFullSync(cp: FullSyncCheckpoint): Promise<void> {
    writeFullSyncCheckpoint(totemDir, cp);
    checkpoint = cp;
    log('Full sync: resetting index...');
    await store.reset();
  }

  if (incremental) {
    // Persisted sync state carries both the diff baseline (lastSyncSha) and the
    // exclusion-set hash used for removal reconciliation (mmnto-ai/totem#2366).
    const syncState = readSyncState(totemDir, log);

    // Determine the ref to diff against: saved sync state > fallback HEAD~1
    let sinceRef = 'HEAD~1';
    if (!options.changedFiles && syncState) {
      sinceRef = syncState.lastSyncSha;
      log(`Resuming from last sync at ${sinceRef.slice(0, 8)}...`);
    }

    const changedPaths = options.changedFiles ?? getChangedFiles(projectRoot, sinceRef, log);
    if (changedPaths === null) {
      log('Git diff failed, falling back to full sync...');
      await beginFullSync(freshCheckpoint());
      filesToProcess = allFiles;
      log(`Full sync (fallback): ${filesToProcess.length} files to process`);
    } else {
      const changedSet = new Set(changedPaths);
      let newlyEligible = new Set<string>();

      // Reconciliation is NOT diff-derived (mmnto-ai/totem#2151, #2366): both the
      // orphan purge and the newly-eligible enqueue below read the indexed set
      // once and compare against the live tree, independent of the git diff
      // window. On a getDistinctPaths read failure, skip BOTH this run (warn, no
      // false purge / no spurious enqueue); a later sync reconciles.
      try {
        const indexedPaths = await store.getDistinctPaths();
        const liveRelPaths = allFiles.map((f) => f.relativePath);

        // Deletion (ADDITION direction): purge any indexed path no longer in the
        // working tree — self-heals deletions, renames-into-ignored, and
        // de-targeted / newly-ignored files even after the baseline advanced past
        // them.
        deletedPaths = computeOrphanPaths(indexedPaths, liveRelPaths);

        // Ignore-pattern REMOVAL reconciliation: symmetric to the orphan pass. A
        // pattern removed from the exclusion set makes files index-eligible
        // without changing their bytes, so the diff window never surfaces them. A
        // change in the stored order-normalized exclusion hash — or its ABSENCE
        // (state predating #2366) — enqueues the newly-eligible set (live −
        // indexed). The union naturally reduces to the diff alone when the
        // exclusion set is unchanged, and on a pure ADDITION the newly-eligible
        // files are all already in the changed set.
        if (syncState?.indexExclusionHash !== indexExclusionHash) {
          newlyEligible = new Set(computeNewlyEligiblePaths(liveRelPaths, indexedPaths));
        }
        // totem-context: intentional warn+skip on a getDistinctPaths read failure (mmnto-ai/totem#2151 Q3, cohort-endorsed) — never a false purge; a later sync reconciles, and the Warning below means it is not silent degradation.
      } catch (err) {
        log(
          `  Warning: orphan reconciliation skipped (getDistinctPaths failed): ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // Re-embed the changed files (diff-scoped) UNION the newly-eligible set an
      // ignore-pattern removal exposed (#2366); every path in either set still
      // exists (both derive from allFiles / the live tree).
      filesToProcess = allFiles.filter(
        (f) => changedSet.has(f.relativePath) || newlyEligible.has(f.relativePath),
      );

      // Count only the extras the exclusion-set change pulled back in (those not
      // already surfaced by the diff), so the log reports honest reconciliation work.
      const reconciledCount = [...newlyEligible].filter((rel) => !changedSet.has(rel)).length;

      log(
        `Incremental sync: ${filesToProcess.length} file(s) to process` +
          (reconciledCount > 0 ? `, ${reconciledCount} newly-eligible` : '') +
          (deletedPaths.length > 0 ? `, ${deletedPaths.length} orphan candidate(s)` : '') +
          ` (of ${allFiles.length} total)`,
      );
    }
  } else if (resumeFrom) {
    // #2562 resume: NO reset — the interrupted epoch continues. Already-done
    // derives from FOUR signals, not the checkpoint alone:
    //   1. checkpointed (the epoch flushed it);
    //   2. ∩ live (still resolved by the current target set);
    //   3. ∩ actually-in-the-store — the store is ground truth: a store
    //      healed/nuked under a live checkpoint must not be trusted from
    //      paper (falsification round 1, MAJOR 1);
    //   4. − moved-since-epoch: anything in git's tracked diff against
    //      startedHeadSha, PLUS anything whose mtime postdates the epoch
    //      start. The mtime arm applies to EVERY file, not only untracked
    //      ones (falsification round 2, F3: submodule and assume-unchanged
    //      files appear in neither git list, so an untracked-only mtime arm
    //      silently kept them stale) — a false-positive eviction is just a
    //      harmless re-embed. Untracked files are deliberately NOT evicted by
    //      git-list membership (it is permanent — round 1, MAJOR 2), and a
    //      non-git epoch (null startedHeadSha) has an empty tracked set, so
    //      the mtime arm carries it alone (MAJOR 4).
    // The epoch diff never derives from options.changedFiles — a caller's
    // diff window says nothing about what the crashed epoch covered.
    const detailed: { tracked: string[]; untracked: string[] } | null = resumeFrom.startedHeadSha
      ? getChangedFilesDetailed(projectRoot, resumeFrom.startedHeadSha, log)
      : { tracked: [], untracked: [] };

    if (detailed === null) {
      log('Cannot diff against the interrupted epoch — restarting the full re-index from zero.');
      await beginFullSync(freshCheckpoint());
      filesToProcess = allFiles;
      log(`Full sync: ${filesToProcess.length} files to process`);
    } else {
      let indexedRaw: string[] | null = null;
      try {
        indexedRaw = await store.getDistinctPaths();
        // totem-context: intentional warn+degrade on a getDistinctPaths failure (mmnto-ai/totem#2562, falsification round 2 F7 + round 3 MINOR 9a) — the completed set collapses to EMPTY below (every file re-embeds via delete-first, same cost as a reset-restart) but the table is NOT destroyed over a possibly-transient read failure, and the checkpoint's paper progress is RETAINED untrusted so a second crash does not erase a prior epoch's flushed work.
      } catch (err) {
        log(
          `Warning: cannot verify the checkpoint against the store (getDistinctPaths failed: ${err instanceof Error ? err.message : String(err)}) — re-embedding everything without trusting the checkpoint.`,
        );
      }

      const epochStart = resumeFrom.startedAt;
      const byRel = new Map(allFiles.map((f) => [normalizeRel(f.relativePath), f]));
      const tracked = new Set(detailed.tracked.map(normalizeRel));
      const movedSinceEpoch = (rel: string): boolean => {
        if (tracked.has(rel)) return true;
        const file = byRel.get(rel);
        if (!file) return true;
        try {
          return fs.statSync(file.absolutePath).mtimeMs > epochStart;
          // totem-context: intentional treat-as-moved on a stat failure (mmnto-ai/totem#2562) — the file re-embeds (idempotent via delete-first) or the read site skips a vanished file loudly.
        } catch {
          return true;
        }
      };
      const indexed = indexedRaw === null ? null : new Set(indexedRaw.map(normalizeRel));
      const completed = new Set(
        indexed === null
          ? []
          : resumeFrom.completedFiles
              .map(normalizeRel)
              .filter((rel) => byRel.has(rel) && indexed.has(rel) && !movedSinceEpoch(rel)),
      );
      filesToProcess = allFiles.filter((f) => !completed.has(normalizeRel(f.relativePath)));

      // EFFECTIVE-vs-effective identity gate (falsification rounds 2–4). The
      // epoch may only continue under the embedder identity that will
      // ACTUALLY serve this run's embeds — config-vs-stamped is wrong in both
      // directions (a silent fallback would mix vector spaces at the first
      // insert; a persistent fallback would restart-loop forever). The
      // exemption is RESOLUTION FAILURE with zero work remaining (round 3
      // MINOR 10: an epoch that merely needs its marker cleared must not
      // wedge behind a missing embedder) — NOT zero work itself: a resolvable
      // mismatch must restart even with nothing left, or clearing the marker
      // would rewrite index-meta to the new identity and launder the
      // DATABASE_MISMATCH evidence the next incremental needs (round 4,
      // MAJOR 1 — probed: dimension change + zero-work resume ⇒ silent mixed
      // store).
      let identityOk = true;
      let effectiveNow: { provider: string; model: string; dimensions: number } | null = null;
      try {
        effectiveNow = (await embedder.resolveEffective?.()) ?? embedderFingerprint;
      } catch (err) {
        if (filesToProcess.length > 0) throw err; // work remains ⇒ fail loud, state intact
        log(
          `Nothing left to embed and no embedder resolved (${err instanceof Error ? err.message : String(err)}) — clearing the marker unverified.`,
        );
      }
      if (effectiveNow !== null) {
        const fp = resumeFrom.embedder;
        if (
          fp.provider !== effectiveNow.provider ||
          fp.model !== effectiveNow.model ||
          fp.dimensions !== effectiveNow.dimensions
        ) {
          log(
            `The embedder serving this run (${effectiveNow.provider}/${effectiveNow.model}) differs from the interrupted epoch's (${fp.provider}/${fp.model}) — its progress is unusable; restarting from zero.`,
          );
          identityOk = false;
        }
      }

      if (!identityOk) {
        await beginFullSync(freshCheckpoint());
        filesToProcess = allFiles;
        log(`Full sync: ${filesToProcess.length} files to process`);
      } else {
        // Carry forward the verified entries, re-keyed to the current run's
        // resolved paths — EXCEPT when the store was unreadable: then the
        // paper progress is retained untrusted (round 3, MINOR 9a) so a
        // second crash does not erase a prior epoch's flushed work; the next
        // resume re-verifies it against a hopefully-readable store.
        // startedHeadSha stays the ORIGINAL epoch SHA so every later resume
        // re-diffs the full window (superset-safe).
        const carried =
          indexed === null
            ? [...resumeFrom.completedFiles]
            : allFiles.map((f) => f.relativePath).filter((rel) => completed.has(normalizeRel(rel)));
        checkpoint = { ...resumeFrom, indexExclusionHash, completedFiles: carried };
        writeFullSyncCheckpoint(totemDir, checkpoint);
        resumedWithoutReset = true;
        log(
          `Resuming full re-index: ${filesToProcess.length} file(s) remaining of ${allFiles.length} ` +
            `(${completed.size} verified already embedded). Delete ${config.totemDir}/${FULL_SYNC_CHECKPOINT_FILE} to restart from scratch.`,
        );
      }
    }
  } else {
    await beginFullSync(freshCheckpoint());
    filesToProcess = allFiles;
    log(`Full sync: ${filesToProcess.length} files to process`);
  }

  // 3b. Purge orphaned chunks (reconciliation result) before ingesting new ones.
  let orphansPurged = 0;
  for (const deletedPath of deletedPaths) {
    try {
      await store.deleteByFile(deletedPath);
      orphansPurged++;
      log(`  Purged chunks for orphaned file: ${deletedPath}`);
      // totem-context: best-effort per-file purge — warn+skip; the orphan stays
      // indexed and the next reconciliation retries it (deleteByFile is idempotent),
      // so one bad row never aborts the whole sync (mmnto-ai/totem#2151).
    } catch (err) {
      log(
        `  Warning: failed to purge ${deletedPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (orphansPurged > 0) {
    log(`Purged ${orphansPurged} orphaned file(s) from the index.`);
  }

  // 4. Chunk files and stream to LanceDB in batches (bounded memory)
  let totalChunks = 0;
  let buffer: Chunk[] = [];
  let pendingFiles: string[] = [];

  async function flushBuffer(): Promise<void> {
    // Probe BEFORE the empty-buffer return so the final flush always checks
    // mutual exclusion, even when nothing is left to write (#2564).
    assertLockHeld(lock);
    if (buffer.length === 0) return;
    await store.insert(buffer);
    // Re-probe after the insert: the embed inside it is exactly the
    // multi-minute paced/throttled window a theft happens in (#2564), and
    // the next entry probe may be a whole batch away.
    assertLockHeld(lock);
    totalChunks += buffer.length;
    log(`  Embedded ${totalChunks} chunks so far`);
    buffer = [];
    // #2562: chunks buffer at whole-file boundaries and store.insert embeds
    // before any row lands, so a successful flush means every pending file is
    // complete in the store — checkpoint them. An append failure is
    // survivable: the file re-embeds on resume via the delete-first path.
    const cp = checkpoint;
    if (cp && pendingFiles.length > 0) {
      cp.completedFiles.push(...pendingFiles);
      // Persist the EFFECTIVE embedder identity once known (falsification
      // round 1, MAJOR 3): a LazyEmbedder that silently fell back to Ollama
      // must not leave a checkpoint fingerprinted as the configured provider,
      // or the next resume would mix vector spaces across the epoch.
      const effective = embedder.describeEffective?.();
      if (effective) cp.embedder = effective;
      try {
        writeFullSyncCheckpoint(totemDir, cp);
        // totem-context: intentional warn+continue on a checkpoint-append failure (mmnto-ai/totem#2562) — the flushed chunks are safe in the store; worst case the file re-embeds on resume via the delete-first path.
      } catch (err) {
        log(
          `  Warning: failed to update full-sync checkpoint: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    pendingFiles = [];
  }

  for (const file of filesToProcess) {
    const safeRel = sanitizeForTerminal(file.relativePath);
    log(`Chunking ${safeRel}...`);

    // A file whose CURRENT state legitimately yields no rows (emptied of
    // chunkable content, or swapped to a symlink the guard refuses) must
    // still purge its OLD rows when re-processing in place — the baseline
    // advances past the change at the end of this run, so no later
    // incremental diff revisits it and the stale rows would be searchable
    // forever (#2569 Greptile round: stale-rows-on-skip). The transient
    // read-error skip below deliberately does NOT purge: deleting on a
    // maybe-transient failure would LOSE good rows, worse than stale ones.
    const purgeStaleRows = async (): Promise<void> => {
      if (incremental || resumedWithoutReset) {
        await store.deleteByFile(file.relativePath);
      }
    };

    // Symlink guard at the READ site (mmnto-ai/totem#2354, #2356 review):
    // resolveFiles skips symlinks at discovery, but this read happens later,
    // so a path swapped to a symlink after resolution would still be followed
    // by readFileSync. Re-check here and skip — closes the discovery→read
    // TOCTOU gap. The purge runs OUTSIDE the read-error catches (#2569 CR
    // round 2): caught there, a purge failure would be mislabeled a read
    // error and silently downgraded to a skip — permanent staleness. Outside
    // them it fails loud and CONVERGES: the marker/stale baseline makes the
    // next run re-evict the file and retry the delete.
    let isSymlink: boolean;
    try {
      isSymlink = fs.lstatSync(file.absolutePath).isSymbolicLink();
      // totem-context: intentional skip — a per-file stat failure (vanished/raced file, permission) logs and skips just that file so sync continues over the rest; aborting the whole sync over one unreadable file would be the drift, not the skip.
    } catch (err) {
      log(
        `  Skipping (read error: ${sanitizeForTerminal(err instanceof Error ? err.message : String(err))}): ${safeRel}`,
      );
      continue;
    }
    if (isSymlink) {
      log(`  Skipping symlink (not indexed): ${safeRel}`);
      await purgeStaleRows();
      continue;
    }

    let content: string;
    try {
      content = fs.readFileSync(file.absolutePath, 'utf-8');
      // totem-context: intentional skip — a per-file read failure (vanished/raced file, permission, decode) logs and skips just that file so sync continues over the rest; aborting the whole sync over one unreadable file would be the drift, not the skip.
    } catch (err) {
      log(
        `  Skipping (read error: ${sanitizeForTerminal(err instanceof Error ? err.message : String(err))}): ${safeRel}`,
      );
      continue;
    }

    const chunker = createChunker(file.target.strategy);
    const chunks = chunker.chunk(content, file.relativePath, file.target.type);

    if (chunks.length === 0) {
      log(`  No chunks extracted from ${file.relativePath}`);
      await purgeStaleRows();
      continue;
    }

    // Delete old chunks for this file before inserting new ones — incremental
    // re-embeds in place, and a #2562 resume (no reset) can hold this file's
    // chunks already (changed-since-epoch, or a flush whose checkpoint append
    // failed). Idempotent either way.
    await purgeStaleRows();

    // Sanitize chunk content before embedding (adversarial ingestion scrubbing)
    // Deduplicate warnings per file to avoid log spam on files with widespread issues
    const warnedMessages = new Set<string>();
    const dedupeWarn = (msg: string) => {
      if (!warnedMessages.has(msg)) {
        warnedMessages.add(msg);
        log(msg);
      }
    };
    for (const chunk of chunks) {
      const sanitizeOpts = {
        chunkType: chunk.type,
        filePath: file.relativePath,
        onWarn: dedupeWarn,
      };
      chunk.content = sanitizeForIngestion(chunk.content, sanitizeOpts);
      chunk.contextPrefix = sanitizeForIngestion(chunk.contextPrefix, sanitizeOpts);
    }

    buffer.push(...chunks);
    pendingFiles.push(file.relativePath);
    log(`  ${chunks.length} chunks from ${file.relativePath}`);

    // Flush when buffer reaches batch size to keep memory bounded
    if (buffer.length >= EMBED_BATCH_SIZE) {
      await flushBuffer();
    }
  }

  // Flush remaining chunks
  await flushBuffer();

  log(`Sync complete: ${totalChunks} chunks from ${filesToProcess.length} files`);

  // Build/rebuild FTS index for hybrid search (FTS indexes don't auto-update on
  // add — or on delete: a purge-only sync must still rebuild so the FTS view
  // drops the orphaned files' content, mmnto-ai/totem#2151 Tenet 20).
  // Sum (not ||): both are non-negative counts, so > 0 iff either is — and it
  // sidesteps the logical-OR numeric-default lint without changing the meaning.
  if (totalChunks + orphansPurged > 0) {
    log('Building FTS index for hybrid search...');
    await store.createFtsIndex();
    log(
      store.ftsIndexReady
        ? 'FTS index ready.'
        : 'FTS index skipped (hybrid search will use vector-only).',
    );
  }

  // Persist sync state so the next incremental sync knows where to diff from and
  // can detect an ignore-pattern change (including a removal) via the hash (#2366).
  // #2564: not under a lost lock — a completion-claiming baseline must not land
  // while another process's epoch owns the store.
  assertLockHeld(lock);
  if (headSha) {
    writeSyncState(totemDir, { lastSyncSha: headSha, timestamp: Date.now(), indexExclusionHash });
  }

  // #2562: the epoch is complete — clear the dirty marker only AFTER the fresh
  // baseline is on disk. A crash between the two writes leaves marker + fresh
  // baseline, which the next run resumes as a near-noop; the reverse order
  // would leave a clean-claiming baseline over a still-marked store.
  if (checkpoint) {
    // #2564: after a theft, the on-disk marker may already belong to the
    // thief's epoch — deleting it would erase THAT run's crash safety.
    assertLockHeld(lock);
    deleteFullSyncCheckpoint(totemDir, log);
  }

  // Persist index metadata for dimension mismatch detection
  writeIndexMeta(totemDir, {
    provider: embedding.provider,
    model: embedding.model ?? 'default',
    dimensions: embedder.dimensions,
    lastSync: new Date().toISOString(),
  });

  // Persist index manifest for downstream consumers (e.g. totem-status Visor)
  try {
    // Single timestamp threaded through both manifestDocuments() and buildIndexManifest
    // so documents[].lastSynced == manifest.writtenAt, per the v0.2 contract.
    const writtenAt = new Date();
    const docs = await store.manifestDocuments(writtenAt);
    const manifest = buildIndexManifest({ documents: docs, headSha, writtenAt });
    writeJsonAtomic(path.join(totemDir, 'index-manifest.json'), manifest);
  } catch (err) {
    const detail =
      err instanceof Error ? err.message : typeof err === 'string' ? err : 'unknown error';
    log(`Warning: Failed to write index-manifest.json: ${detail}`);
  }

  // Get total chunk count from the store (includes pre-existing chunks from incremental syncs)
  let totalStoredChunks = totalChunks;
  try {
    totalStoredChunks = await store.count();
  } catch {
    // Count failure should not break sync — fall back to chunks processed this run
  }

  return {
    chunksProcessed: totalChunks,
    filesProcessed: filesToProcess.length,
    totalChunks: totalStoredChunks,
    orphansPurged,
  };
}
