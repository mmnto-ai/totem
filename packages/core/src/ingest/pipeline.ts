import * as fs from 'node:fs';
import * as path from 'node:path';

import { createChunker } from '../chunkers/chunker.js';
import type { TotemConfig } from '../config-schema.js';
import { requireEmbedding } from '../config-schema.js';
import { createEmbedder } from '../embedders/embedder.js';
import { TotemDatabaseError } from '../errors.js';
import { withLock } from '../lock.js';
import { sanitizeForIngestion } from '../sanitize.js';
import { LanceStore } from '../store/lance-store.js';
import type { Chunk, SyncOptions, SyncState } from '../types.js';
import type { ResolvedFile } from './file-resolver.js';
import { getChangedFiles, getHeadSha, resolveFiles } from './file-resolver.js';

const EMBED_BATCH_SIZE = 100;
const SYNC_STATE_FILE = 'cache/sync-state.json';
const INDEX_META_FILE = 'cache/index-meta.json';

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

function writeSyncState(totemDir: string, state: SyncState): void {
  const statePath = path.join(totemDir, SYNC_STATE_FILE);
  const dir = path.dirname(statePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

export async function runSync(
  config: TotemConfig,
  options: SyncOptions,
): Promise<{ chunksProcessed: number; filesProcessed: number; totalChunks: number }> {
  const { projectRoot, onProgress } = options;
  const log = onProgress ?? (() => {});
  const totemDir = path.join(projectRoot, config.totemDir);

  return withLock(
    totemDir,
    () => runSyncInner(config, options),
    (msg) => log(msg),
  );
}

async function runSyncInner(
  config: TotemConfig,
  options: SyncOptions,
): Promise<{ chunksProcessed: number; filesProcessed: number; totalChunks: number }> {
  const { projectRoot, onProgress } = options;
  let incremental = options.incremental;
  const log = onProgress ?? (() => {});

  // 0. Capture HEAD SHA early — before any async work that might race with new commits
  const headSha = getHeadSha(projectRoot, log);

  // 1. Create embedder
  const embedding = requireEmbedding(config);
  log('Initializing embedding provider...');
  const embedder = createEmbedder(embedding);

  // 2. Connect to store
  const storePath = path.join(projectRoot, config.lanceDir);
  const store = new LanceStore(storePath, embedder);
  await store.connect();

  // 2b. Auto-heal: force full sync when incremental is requested but DB is empty
  if (incremental && (await store.isEmpty())) {
    log('Empty database detected. Forcing full sync...');
    incremental = false;
  }

  // 3. Resolve files to process
  const totemDir = path.join(projectRoot, config.totemDir);
  const allFiles = resolveFiles(config.targets, projectRoot, config.ignorePatterns, log);
  let filesToProcess: ResolvedFile[];
  let deletedPaths: string[] = [];

  if (incremental) {
    // Determine the ref to diff against: saved sync state > fallback HEAD~1
    let sinceRef = 'HEAD~1';
    if (!options.changedFiles) {
      const syncState = readSyncState(totemDir, log);
      if (syncState) {
        sinceRef = syncState.lastSyncSha;
        log(`Resuming from last sync at ${sinceRef.slice(0, 8)}...`);
      }
    }

    const changedPaths = options.changedFiles ?? getChangedFiles(projectRoot, sinceRef, log);
    if (changedPaths === null) {
      log('Git diff failed, falling back to full sync...');
      await store.reset();
      filesToProcess = allFiles;
      log(`Full sync (fallback): ${filesToProcess.length} files to process`);
    } else {
      const changedSet = new Set(changedPaths);
      const allFileSet = new Set(allFiles.map((f) => f.relativePath));

      // Partition: files that still exist get re-indexed, missing files get deleted
      filesToProcess = allFiles.filter((f) => changedSet.has(f.relativePath));
      deletedPaths = changedPaths.filter((p) => !allFileSet.has(p));

      log(
        `Incremental sync: ${filesToProcess.length} changed files` +
          (deletedPaths.length > 0 ? `, ${deletedPaths.length} deleted` : '') +
          ` (of ${allFiles.length} total)`,
      );
    }
  } else {
    log('Full sync: resetting index...');
    await store.reset();
    filesToProcess = allFiles;
    log(`Full sync: ${filesToProcess.length} files to process`);
  }

  // 3b. Purge chunks from deleted files before ingesting new ones
  for (const deletedPath of deletedPaths) {
    try {
      await store.deleteByFile(deletedPath);
      log(`  Purged chunks for deleted file: ${deletedPath}`);
    } catch (err) {
      log(
        `  Warning: failed to purge ${deletedPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 4. Chunk files and stream to LanceDB in batches (bounded memory)
  let totalChunks = 0;
  let buffer: Chunk[] = [];

  async function flushBuffer(): Promise<void> {
    if (buffer.length === 0) return;
    await store.insert(buffer);
    totalChunks += buffer.length;
    log(`  Embedded ${totalChunks} chunks so far`);
    buffer = [];
  }

  for (const file of filesToProcess) {
    log(`Chunking ${file.relativePath}...`);

    let content: string;
    try {
      content = fs.readFileSync(file.absolutePath, 'utf-8');
    } catch (err) {
      log(
        `  Skipping (read error: ${err instanceof Error ? err.message : String(err)}): ${file.relativePath}`,
      );
      continue;
    }

    const chunker = createChunker(file.target.strategy);
    const chunks = chunker.chunk(content, file.relativePath, file.target.type);

    if (chunks.length === 0) {
      log(`  No chunks extracted from ${file.relativePath}`);
      continue;
    }

    // For incremental: delete old chunks for this file before inserting new ones
    if (incremental) {
      await store.deleteByFile(file.relativePath);
    }

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
    log(`  ${chunks.length} chunks from ${file.relativePath}`);

    // Flush when buffer reaches batch size to keep memory bounded
    if (buffer.length >= EMBED_BATCH_SIZE) {
      await flushBuffer();
    }
  }

  // Flush remaining chunks
  await flushBuffer();

  log(`Sync complete: ${totalChunks} chunks from ${filesToProcess.length} files`);

  // Build/rebuild FTS index for hybrid search (FTS indexes don't auto-update on add)
  if (totalChunks > 0) {
    log('Building FTS index for hybrid search...');
    await store.createFtsIndex();
    log(
      store.ftsIndexReady
        ? 'FTS index ready.'
        : 'FTS index skipped (hybrid search will use vector-only).',
    );
  }

  // Persist sync state so next incremental sync knows where to diff from
  if (headSha) {
    writeSyncState(totemDir, { lastSyncSha: headSha, timestamp: Date.now() });
  }

  // Persist index metadata for dimension mismatch detection
  writeIndexMeta(totemDir, {
    provider: embedding.provider,
    model: embedding.model ?? 'default',
    dimensions: embedder.dimensions,
    lastSync: new Date().toISOString(),
  });

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
  };
}
