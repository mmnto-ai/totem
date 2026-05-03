import * as fs from 'node:fs';
import * as path from 'node:path';

import type { DriftResult, TotemConfig } from '@mmnto/totem';

import type { Spinner } from '../ui.js';

const TAG = 'Sync';
const PRUNE_LABEL_MAX = 70;

/**
 * Write the canonical review-extensions.txt file consumed by
 * .claude/hooks/content-hash.sh. One extension per line, leading dot,
 * trailing newline. Atomic via temp + rename so a concurrent hook fire
 * sees either the old or new contents, never a partial write. (#1527)
 */
export function writeReviewExtensionsFile(
  totemDirAbs: string,
  extensions: readonly string[],
): string {
  if (!fs.existsSync(totemDirAbs)) {
    fs.mkdirSync(totemDirAbs, { recursive: true });
  }

  const finalPath = path.join(totemDirAbs, 'review-extensions.txt');
  const tmpPath = finalPath + '.tmp';
  const payload = extensions.join('\n') + '\n';

  fs.writeFileSync(tmpPath, payload, 'utf-8');
  fs.renameSync(tmpPath, finalPath);

  return finalPath;
}

export async function syncCommand(options: {
  full?: boolean;
  prune?: boolean;
  quiet?: boolean;
}): Promise<void> {
  const { runSync, TotemError, updateRegistryEntry } = await import('@mmnto/totem');
  const { createSpinner, log } = await import('../ui.js');
  const { isGlobalConfigPath, loadConfig, loadEnv, requireEmbedding, resolveConfigPath, sanitize } =
    await import('../utils.js');

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

    // Emit canonical review-extensions.txt for .claude/hooks/content-hash.sh (#1527).
    // Written on every sync, even when the user omits review.sourceExtensions
    // (default set persisted), so downstream bash consumers see a consistent file.
    // Resolves against configRoot for local configs so monorepo users invoking
    // from a subdirectory land the file at <project-root>/.totem/, where shield
    // and the bash hook read it (lesson 61975bb96c9bf27f / f5a75d98a43e0721).
    // Falls back to cwd for global-only configs: if the user customized
    // review.sourceExtensions in ~/.totem/totem.config.ts, skipping the write
    // would break TS/bash parity (TS uses the custom set, bash defaults). cwd
    // is the best proxy for git-toplevel available without shelling to git.
    const targetRoot = isGlobalConfigPath(configPath) ? cwd : path.dirname(configPath);
    const totemDirAbs = path.resolve(targetRoot, config.totemDir);
    try {
      writeReviewExtensionsFile(totemDirAbs, config.review.sourceExtensions); // totem-context: intentional cleanup — canonical file write is a convenience for the bash PreToolUse hook
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      log.dim(TAG, `Skipped review-extensions.txt write: ${sanitize(detail)}`);
    }

    // Emit `.totem/installed-packs.json` for boot-time pack registration
    // (mmnto-ai/totem#1768, ADR-097 § 10). Resolved from the deduplicated
    // union of `package.json` `@mmnto/pack-*` deps + `totem.config.ts`
    // `extends` array. Mismatch surfaces (dep without extends, extends
    // without dep, missing peerDependencies) emit per-pack warnings;
    // resolved entries are written to the manifest atomically.
    try {
      const { resolveInstalledPacks, writeInstalledPacksManifest } = await import('@mmnto/totem');
      const { resolved, warnings } = resolveInstalledPacks({
        projectRoot: targetRoot,
        config,
      });
      writeInstalledPacksManifest(totemDirAbs, { version: 1, packs: resolved });
      for (const warning of warnings) {
        const reasonText =
          warning.reason === 'dep-only'
            ? `present in package.json but not in totem.config.ts \`extends\` — pack rules will not be merged. Add to \`extends\` or remove the dependency.`
            : warning.reason === 'extends-only'
              ? `declared in totem.config.ts \`extends\` but not installed — install via \`pnpm add -D ${warning.name}\` (or equivalent).`
              : `missing engines['@mmnto/totem'] declaration — pack cannot satisfy the engine-version cross-check (ADR-097 § 5 Q6). Add '"engines": { "@mmnto/totem": "^<version>" }' to the pack's package.json and republish.`;
        log.warn(TAG, `Pack '${warning.name}': ${reasonText}`);
      }
      if (resolved.length > 0) {
        log.dim(
          TAG,
          `Wrote installed-packs.json (${resolved.length} pack${resolved.length === 1 ? '' : 's'}).`,
        );
      }
      // totem-context: intentional cleanup — manifest write is best-effort, mirrors the writeReviewExtensionsFile pattern above (failure logs at warn but does not abort sync)
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'unknown error';
      log.warn(TAG, `Skipped installed-packs.json write: ${sanitize(detail)}`);
    }

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
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { detectDrift, parseLessonsFile, readAllLessons, rewriteLessonsFile, runSync } =
    await import('@mmnto/totem');
  const { log } = await import('../ui.js');
  const { sanitize } = await import('../utils.js');

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
  return oneLine.slice(0, PRUNE_LABEL_MAX - 1) + '\u2026';
}

async function selectLessonsToPrune(drift: DriftResult[]): Promise<DriftResult[]> {
  const { isCancel, multiselect } = await import('@clack/prompts');
  const { log } = await import('../ui.js');
  const { sanitize } = await import('../utils.js');

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
