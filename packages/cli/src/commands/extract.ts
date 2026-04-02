import type { ExtractedLesson } from '@mmnto/totem';
import { TotemConfigError } from '@mmnto/totem';

import { log } from '../ui.js';
import { isGlobalConfigPath, loadConfig, loadEnv, resolveConfigPath } from '../utils.js';
import { sharedPipeline } from './extract-shared.js';
import { MAX_INPUTS } from './extract-templates.js';

// ─── Re-exports: extract-templates ─────────────────────

export {
  EXTRACT_SYSTEM_PROMPT,
  LOCAL_EXTRACT_SYSTEM_PROMPT,
  MAX_EXISTING_LESSONS,
  MAX_INPUTS,
  MAX_REVIEW_BODY_CHARS,
  SCAN_EXTRACT_SYSTEM_PROMPT,
  SEMANTIC_DEDUP_THRESHOLD,
  SYSTEM_PROMPT,
} from './extract-templates.js';

// ─── Re-exports: core ──────────────────────────────────

export type { ExtractedLesson } from '@mmnto/totem';
export {
  cosineSimilarity,
  deduplicateLessons,
  flagSuspiciousLessons,
  isInstructionalContext,
} from '@mmnto/totem';

// ─── Re-exports: extract-shared ────────────────────────

export type { ExtractOptions } from './extract-shared.js';
export {
  appendLessons,
  assembleExtractPrompt,
  parseLessons,
  selectLessons,
} from './extract-shared.js';

// ─── Re-exports: extract-pr ────────────────────────────

export { assemblePrompt } from './extract-pr.js';

// ─── Re-exports: extract-scan ──────────────────────────

export { assembleFromScanPrompt } from './extract-scan.js';

// ─── Re-exports: extract-local ─────────────────────────

export { assembleLocalPrompt } from './extract-local.js';

// ─── Main command ──────────────────────────────────────

export async function extractCommand(
  prNumbers: string[],
  options: import('./extract-shared.js').ExtractOptions,
): Promise<void> {
  // ─── Local extraction mode (--local) ─────────────────
  if (options.local) {
    if (options.fromScan) {
      throw new TotemConfigError(
        'Cannot combine --local with --from-scan.',
        'Use --local for local diffs or --from-scan with PR numbers for code scanning alerts.',
        'CONFIG_INVALID',
      );
    }
    if (prNumbers.length > 0) {
      throw new TotemConfigError(
        'Cannot combine --local with PR numbers.',
        'Use either --local for local diffs or PR numbers for remote extraction.',
        'CONFIG_INVALID',
      );
    }

    const cwd = process.cwd();
    const { extractFromLocal } = await import('./extract-local.js');
    const lessons = await extractFromLocal(options, cwd);
    if (lessons.length === 0) return;

    await sharedPipeline(lessons, options, cwd, 'local changes');
    return;
  }

  // ─── PR number validation ────────────────────────────
  const unique = [...new Set(prNumbers)];
  if (unique.length > MAX_INPUTS) {
    throw new TotemConfigError(
      `Too many PR numbers (${unique.length}). Maximum is ${MAX_INPUTS}.`,
      `Pass at most ${MAX_INPUTS} PR numbers at a time.`,
      'CONFIG_INVALID',
    );
  }

  const nums: number[] = [];
  for (const prNumber of unique) {
    const num = parseInt(prNumber, 10);
    if (isNaN(num) || num <= 0) {
      throw new TotemConfigError(
        `Invalid PR number: '${prNumber}'. Must be a positive integer.`,
        'Pass a numeric PR number, e.g. `totem extract 123`.',
        'CONFIG_INVALID',
      );
    }
    nums.push(num);
  }

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  if (isGlobalConfigPath(configPath)) {
    throw new TotemConfigError(
      'Cannot extract lessons without a local project.',
      "Run 'totem init' to create a local .totem/ directory first.",
      'CONFIG_MISSING',
    );
  }
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // ─── Mode routing ────────────────────────────────────
  let allLessons: ExtractedLesson[];
  if (options.fromScan) {
    const { extractFromScans } = await import('./extract-scan.js');
    allLessons = await extractFromScans(nums, options, config, cwd, configPath);
  } else {
    const { extractFromPrs } = await import('./extract-pr.js');
    allLessons = await extractFromPrs(nums, options, config, cwd, configPath);
  }

  // In --raw mode, prompts were already output during the loop
  if (options.raw) return;

  if (allLessons.length === 0) {
    log.dim('Extract', 'No lessons extracted from any PR.');
    return;
  }

  // Shared pipeline: dedup, flag, select, persist, sync
  const prLabel = nums.length === 1 ? `PR #${nums[0]}` : `${nums.length} PRs`;
  await sharedPipeline(allLessons, options, cwd, prLabel, config, configPath);
}
