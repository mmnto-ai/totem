import * as fs from 'node:fs';
import * as path from 'node:path';

import { isCancel, multiselect } from '@clack/prompts';

import type { DriftResult, TotemConfig } from '@mmnto/totem';
// totem-ignore-next-line — existing top-level imports for this module
import {
  detectDrift,
  parseLessonsFile,
  readAllLessons,
  rewriteLessonsFile,
  runSync,
  TotemError,
  updateRegistryEntry,
} from '@mmnto/totem';

import type { Spinner } from '../ui.js';
import { createSpinner, log } from '../ui.js';
import { loadConfig, loadEnv, requireEmbedding, resolveConfigPath, sanitize } from '../utils.js';

const TAG = 'Sync';
const PRUNE_LABEL_MAX = 70;

export async function syncCommand(options: {
  full?: boolean;
  prune?: boolean;
  quiet?: boolean;
}): Promise<void> {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);

  loadEnv(cwd);

  const config = await loadConfig(configPath);
  requireEmbedding(config);
  const incremental = !options.full;

  const noopSpinner: Spinner = {
    update() {},
    succeed() {},
    fail() {},
    stop() {},
  };

  const spinner = options.quiet
    ? noopSpinner
    : await createSpinner(TAG, incremental ? 'Incremental sync...' : 'Full re-index...');

  try {
    const result = await runSync(config, {
      projectRoot: cwd,
      incremental,
      onProgress: (msg) => spinner.update(msg),
    });

    spinner.succeed(`Done: ${result.chunksProcessed} chunks from ${result.filesProcessed} files`);

    // Update global workspace registry (non-fatal on failure)
    try {
      const embedderString = config.embedding
        ? `${config.embedding.provider}/${config.embedding.dimensions ? `${config.embedding.dimensions}d` : 'auto'}`
        : 'none';

      await updateRegistryEntry({
        path: fs.realpathSync(path.resolve(cwd)),
        chunkCount: result.totalChunks,
        lastSync: new Date().toISOString(),
        embedder: embedderString,
      });
    } catch (err) {
      // Registry update is best-effort — don't break sync
      const detail = err instanceof Error ? err.message : String(err);
      log.dim(TAG, `Registry update skipped: ${detail}`);
    }
  } catch (err) {
    spinner.fail('Sync failed');
    throw err;
  }

  // Drift detection and pruning (after sync so the index is fresh for detection)
  if (options.prune) {
    try {
      await runPrune(cwd, config);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(TAG, `Prune failed: ${message}`);
      throw new TotemError(
        'SYNC_FAILED',
        `Prune failed: ${message}`,
        'Check the error above and ensure the .totem/lessons directory is readable.',
      );
    }
  }
}

// ─── Prune flow ──────────────────────────────────────

async function runPrune(cwd: string, config: TotemConfig): Promise<void> {
  const totemDir = path.join(cwd, config.totemDir);
  const lessons = readAllLessons(totemDir);

  if (lessons.length === 0) {
    log.dim(TAG, 'No lessons found — nothing to prune.');
    return;
  }

  log.info(TAG, `Scanning ${lessons.length} lessons for stale file references...`);
  const drift = detectDrift(lessons, cwd);

  if (drift.length === 0) {
    log.success(TAG, 'No stale references found — all lessons are current.');
    return;
  }

  log.warn(TAG, `Found ${drift.length} lesson(s) with stale file references:\n`);

  // Display each stale lesson with its orphaned refs
  for (const result of drift) {
    const heading = sanitize(result.lesson.heading).replace(/\n/g, ' ');
    const refs = result.orphanedRefs.map((r) => `    → ${sanitize(r)}`).join('\n');
    console.error(`  [${result.lesson.index + 1}] ${heading}`);
    console.error(refs);
    console.error('');
  }

  // Interactive selection
  const selected = await selectLessonsToPrune(drift);

  if (selected.length === 0) {
    log.dim(TAG, 'No lessons selected for pruning.');
    return;
  }

  // Group selected lessons by sourcePath
  const legacyPath = path.join(totemDir, 'lessons.md');
  const bySource = new Map<string, DriftResult[]>();
  for (const d of selected) {
    const src = d.lesson.sourcePath ?? legacyPath;
    const group = bySource.get(src) ?? [];
    group.push(d);
    bySource.set(src, group);
  }

  let prunedCount = 0;
  for (const [sourcePath, driftResults] of bySource) {
    if (sourcePath === legacyPath) {
      // Legacy file: rewrite with lessons removed (same as before)
      const content = fs.readFileSync(sourcePath, 'utf-8');
      // Map global indices back to indices within this file
      const fileLessons = parseLessonsFile(content);
      const rawContentToRemove = new Set(driftResults.map((d) => d.lesson.raw));
      const fileIndicesToRemove = new Set(
        fileLessons.filter((l) => rawContentToRemove.has(l.raw)).map((l) => l.index),
      );
      const newContent = rewriteLessonsFile(content, fileIndicesToRemove);
      const tmpPath = sourcePath + '.tmp';
      fs.writeFileSync(tmpPath, newContent, 'utf-8');
      fs.renameSync(tmpPath, sourcePath);
      prunedCount += driftResults.length;
    } else {
      // Directory file: may contain one or more lessons — rewrite or delete
      const content = fs.readFileSync(sourcePath, 'utf-8');
      const fileLessons = parseLessonsFile(content);
      const rawContentToRemove = new Set(driftResults.map((d) => d.lesson.raw));
      const fileIndicesToRemove = new Set(
        fileLessons.filter((l) => rawContentToRemove.has(l.raw)).map((l) => l.index),
      );

      if (fileIndicesToRemove.size >= fileLessons.length) {
        // All lessons removed — delete the file
        fs.unlinkSync(sourcePath);
      } else {
        // Rewrite with stale lessons removed
        const newContent = rewriteLessonsFile(content, fileIndicesToRemove);
        const tmpPath = sourcePath + '.tmp';
        fs.writeFileSync(tmpPath, newContent, 'utf-8');
        fs.renameSync(tmpPath, sourcePath);
      }
      prunedCount += driftResults.length;
    }
  }

  log.success(TAG, `Pruned ${prunedCount} stale lesson(s)`); // totem-ignore

  // Re-sync so the vector index reflects the pruned lessons
  log.info(TAG, 'Re-indexing after prune...');
  const syncResult = await runSync(config, {
    projectRoot: cwd,
    incremental: true,
    onProgress: (msg) => log.dim(TAG, msg),
  });
  log.success(
    TAG,
    `Re-index complete: ${syncResult.chunksProcessed} chunks from ${syncResult.filesProcessed} files`,
  );
}

// ─── Interactive prompt ──────────────────────────────

function truncateLabel(text: string): string {
  const oneLine = text.replace(/\n/g, ' ');
  if (oneLine.length <= PRUNE_LABEL_MAX) return oneLine;
  return oneLine.slice(0, PRUNE_LABEL_MAX - 1) + '…';
}

async function selectLessonsToPrune(drift: DriftResult[]): Promise<DriftResult[]> {
  if (!process.stdin.isTTY) {
    log.warn(
      TAG,
      'Non-interactive mode — cannot prompt for pruning. Run in a TTY to prune interactively.',
    );
    return [];
  }

  const result = await multiselect({
    message: `Select lessons to prune (${drift.length} stale):`,
    options: drift.map((d) => ({
      value: d.lesson.index,
      label: truncateLabel(sanitize(d.lesson.heading)),
      hint: d.orphanedRefs.map((r) => sanitize(r)).join(', '),
    })),
    initialValues: drift.map((d) => d.lesson.index),
    required: false,
  });

  if (isCancel(result)) {
    return [];
  }

  const selectedIndices = new Set(result as number[]);
  return drift.filter((d) => selectedIndices.has(d.lesson.index));
}
