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

/**
 * `--packs-only` (Phase A) is mutually exclusive with every Phase B
 * flag (`--index-only`, `--full`, `--prune`). Hard error before any
 * sync logic runs so callers get a clean, actionable diagnostic
 * instead of a silently-mixed run (mmnto-ai/totem#1811, ADR-101).
 */
function assertNoPhaseBFlags(
  options: SyncCommandOptions,
  TotemError: typeof import('@mmnto/totem').TotemError,
): void {
  if (!options.packsOnly) return;
  const conflicts: string[] = [];
  if (options.indexOnly) conflicts.push('--index-only');
  if (options.full) conflicts.push('--full');
  if (options.prune) conflicts.push('--prune');
  if (conflicts.length === 0) return;
  throw new TotemError(
    'FLAG_CONFLICT',
    `--packs-only cannot be combined with ${conflicts.join(', ')}: those flags drive the embedding-side phase, which --packs-only skips.`,
    'Re-run with --packs-only alone, or drop --packs-only to run the full sync.',
  );
}

export interface SyncCommandOptions {
  full?: boolean;
  prune?: boolean;
  quiet?: boolean;
  /**
   * Run only Phase A — deterministic pack-resolution + manifest write
   * (`installed-packs.json`). Skips `requireEmbedding`, `runSync`, the
   * post-sync `review-extensions.txt` write, the global-registry
   * update, and prune. Designed for CI environments without API keys
   * after a `@mmnto/totem` cohort bump (mmnto-ai/totem#1811, ADR-101).
   * Mutually exclusive with `indexOnly`, `full`, and `prune`.
   */
  packsOnly?: boolean;
  /**
   * Run only Phase B — `runSync` + post-sync side outputs. Skips
   * pack-resolution + `installed-packs.json` write. Use when the
   * manifest is already current and only the vector-store needs to
   * re-embed (mmnto-ai/totem#1811, ADR-101). Mutually exclusive with
   * `packsOnly`.
   */
  indexOnly?: boolean;
}

export async function syncCommand(options: SyncCommandOptions): Promise<void> {
  const {
    resolveInstalledPacks,
    runSync,
    TotemError,
    updateRegistryEntry,
    writeInstalledPacksManifest,
  } = await import('@mmnto/totem');
  const { createSpinner, log } = await import('../ui.js');
  const { isGlobalConfigPath, loadConfig, loadEnv, requireEmbedding, resolveConfigPath, sanitize } =
    await import('../utils.js');

  // Validate flag mutex BEFORE loading config or constructing any
  // embedder-touching surface — keeps --packs-only clean of init-time
  // failures from the gates it's specifically designed to skip.
  assertNoPhaseBFlags(options, TotemError);

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);

  loadEnv(cwd);

  const config = await loadConfig(configPath);

  // Phase B requires an embedding key. Skipping `requireEmbedding`
  // when `--packs-only` is the load-bearing CI-unblock invariant of
  // ADR-101: a baseline environment can rebuild `installed-packs.json`
  // without an API key.
  if (!options.packsOnly) {
    requireEmbedding(config);
  }

  const targetRoot = isGlobalConfigPath(configPath) ? cwd : path.dirname(configPath);
  const totemDirAbs = path.resolve(targetRoot, config.totemDir);

  // ─── Phase A — pack-resolution + manifest write ─────
  // Re-ordered to BEFORE `runSync` so `--packs-only` can short-circuit
  // cleanly without invoking embedding (mmnto-ai/totem#1811 OQ3).
  // `runSync` operates against pack registrations resolved at boot, so
  // the re-order is observably equivalent for the default case.
  if (!options.indexOnly) {
    try {
      const { resolved, warnings } = resolveInstalledPacks({
        projectRoot: targetRoot,
        config,
      });
      writeInstalledPacksManifest(totemDirAbs, { version: 1, packs: resolved });
      for (const warning of warnings) {
        const packName = sanitize(warning.name);
        const reasonText =
          warning.reason === 'dep-only'
            ? `present in package.json but not in totem.config.ts \`extends\` — pack rules will not be merged. Add to \`extends\` or remove the dependency.`
            : warning.reason === 'extends-only'
              ? `declared in totem.config.ts \`extends\` but not installed — install via \`pnpm add -D ${packName}\` (or equivalent).`
              : `missing engines['@mmnto/totem'] declaration — pack cannot satisfy the engine-version cross-check (ADR-097 § 5 Q6). Add '"engines": { "@mmnto/totem": "^<version>" }' to the pack's package.json and republish.`;
        log.warn(TAG, `Pack '${packName}': ${reasonText}`);
      }
      if (resolved.length > 0) {
        log.dim(
          TAG,
          `Wrote installed-packs.json (${resolved.length} pack${resolved.length === 1 ? '' : 's'}).`,
        );
      }
      // totem-context: intentional cleanup — manifest write is best-effort in DEFAULT sync (mirrors writeReviewExtensionsFile below). Under --packs-only it's the entire scope of work, so failure must propagate (#1828 review).
    } catch (err) {
      if (options.packsOnly) {
        throw new TotemError(
          'SYNC_FAILED',
          'Failed to write installed-packs.json',
          'Fix the manifest error above and re-run `totem sync --packs-only`.',
          err,
        );
      }
      // totem-context: String(err) is the canonical non-Error fallback for catch-block normalization — matches L188 pattern in this file
      const detail = err instanceof Error ? err.message : String(err);
      log.warn(TAG, `Skipped installed-packs.json write: ${sanitize(detail)}`);
    }
  }

  // `--packs-only` short-circuit: Phase B (embedding sync, review
  // extensions, registry update, prune) is the entire scope of work
  // that's skipped. Surface a confirmation so the operator sees the
  // command did the deterministic work it advertised.
  if (options.packsOnly) {
    log.success(TAG, 'Pack manifest synced (--packs-only).');
    return;
  }

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

  // ─── Phase B — embedding-driven sync ─────────────────
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
    try {
      writeReviewExtensionsFile(totemDirAbs, config.review.sourceExtensions); // totem-context: intentional cleanup — canonical file write is a convenience for the bash PreToolUse hook
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      log.dim(TAG, `Skipped review-extensions.txt write: ${sanitize(detail)}`);
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
