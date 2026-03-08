import * as fs from 'node:fs';
import * as path from 'node:path';

import { isCancel, multiselect } from '@clack/prompts';

import type { DriftResult, TotemConfig } from '@mmnto/totem';
import { detectDrift, parseLessonsFile, rewriteLessonsFile, runSync } from '@mmnto/totem';

import { createSpinner, log } from '../ui.js';
import { loadConfig, loadEnv, requireEmbedding, resolveConfigPath, sanitize } from '../utils.js';

const TAG = 'Sync';
const PRUNE_LABEL_MAX = 70;

export async function syncCommand(options: { full?: boolean; prune?: boolean }): Promise<void> {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);

  loadEnv(cwd);

  const config = await loadConfig(configPath);
  requireEmbedding(config);
  const incremental = !options.full;

  const spinner = await createSpinner(
    TAG,
    incremental ? 'Incremental sync...' : 'Full re-index...',
  );

  try {
    const result = await runSync(config, {
      projectRoot: cwd,
      incremental,
      onProgress: (msg) => spinner.update(msg),
    });

    spinner.succeed(`Done: ${result.chunksProcessed} chunks from ${result.filesProcessed} files`);
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
      throw new Error(`[Totem Error] Prune failed: ${message}`);
    }
  }
}

// ─── Prune flow ──────────────────────────────────────

async function runPrune(cwd: string, config: TotemConfig): Promise<void> {
  const lessonsPath = path.join(cwd, config.totemDir, 'lessons.md');

  if (!fs.existsSync(lessonsPath)) {
    log.dim(TAG, 'No lessons file found — nothing to prune.');
    return;
  }

  const content = fs.readFileSync(lessonsPath, 'utf-8');
  const lessons = parseLessonsFile(content);

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

  // Atomic write: write to temp file, then rename
  const indicesToRemove = new Set(selected.map((d) => d.lesson.index));
  const newContent = rewriteLessonsFile(content, indicesToRemove);
  const tmpPath = lessonsPath + '.tmp';
  fs.writeFileSync(tmpPath, newContent, 'utf-8');
  fs.renameSync(tmpPath, lessonsPath);

  log.success(TAG, `Pruned ${selected.length} stale lesson(s) from ${config.totemDir}/lessons.md`);

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
