import * as fs from 'node:fs';
import * as path from 'node:path';

import { createChunker } from '../chunkers/chunker.js';
import type { TotemConfig } from '../config-schema.js';
import { createEmbedder } from '../embedders/embedder.js';
import { LanceStore } from '../store/lance-store.js';
import type { Chunk, SyncOptions } from '../types.js';
import type { ResolvedFile } from './file-resolver.js';
import { getChangedFiles, resolveFiles } from './file-resolver.js';

const EMBED_BATCH_SIZE = 100;

export async function runSync(
  config: TotemConfig,
  options: SyncOptions,
): Promise<{ chunksProcessed: number; filesProcessed: number }> {
  const { projectRoot, onProgress } = options;
  let incremental = options.incremental;
  const log = onProgress ?? (() => {});

  // 1. Create embedder
  log('Initializing embedding provider...');
  const embedder = createEmbedder(config.embedding);

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
  const allFiles = resolveFiles(config.targets, projectRoot, config.ignorePatterns, log);
  let filesToProcess: ResolvedFile[];

  if (incremental) {
    const changedPaths = options.changedFiles ?? getChangedFiles(projectRoot, 'HEAD~1', log);
    if (changedPaths === null) {
      log('Git diff failed, falling back to full sync...');
      await store.reset();
      filesToProcess = allFiles;
      log(`Full sync (fallback): ${filesToProcess.length} files to process`);
    } else {
      const changedSet = new Set(changedPaths);
      filesToProcess = allFiles.filter((f) => changedSet.has(f.relativePath));
      log(`Incremental sync: ${filesToProcess.length} changed files (of ${allFiles.length} total)`);
    }
  } else {
    log('Full sync: resetting index...');
    await store.reset();
    filesToProcess = allFiles;
    log(`Full sync: ${filesToProcess.length} files to process`);
  }

  // 4. Chunk files and stream to LanceDB in batches (bounded memory)
  let totalChunks = 0;
  let buffer: Chunk[] = [];

  async function flushBuffer(): Promise<void> {
    if (buffer.length === 0) return;
    // Slice into EMBED_BATCH_SIZE batches to respect embedder limits
    for (let i = 0; i < buffer.length; i += EMBED_BATCH_SIZE) {
      const batch = buffer.slice(i, i + EMBED_BATCH_SIZE);
      await store.insert(batch);
    }
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

  return {
    chunksProcessed: totalChunks,
    filesProcessed: filesToProcess.length,
  };
}
