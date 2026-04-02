import type { ExtractedLesson, SearchResult, TotemConfig } from '@mmnto/totem';
import { createEmbedder, LanceStore, loadCustomSecrets } from '@mmnto/totem';

import type { StandardCodeScanAlert } from '../adapters/pr-adapter.js';
import { log } from '../ui.js';
import {
  formatResults,
  getSystemPrompt,
  GH_TIMEOUT_MS,
  requireEmbedding,
  runOrchestrator,
  sanitize,
  wrapUntrustedXml,
} from '../utils.js';
import type { ExtractOptions } from './extract-shared.js';
import { parseLessons, retrieveExistingLessons, TAG } from './extract-shared.js';
import { MAX_REVIEW_BODY_CHARS, SCAN_EXTRACT_SYSTEM_PROMPT } from './extract-templates.js';

// ─── Scan prompt assembly ──────────────────────────────

export function assembleFromScanPrompt(
  alerts: StandardCodeScanAlert[],
  diff: string,
  existingLessons: SearchResult[],
  systemPrompt: string,
): string {
  const sections: string[] = [systemPrompt];

  sections.push('\n=== FIXED CODE SCANNING ALERTS ===');
  for (const alert of alerts) {
    sections.push(`\n--- Alert #${alert.number} ---`);
    sections.push(wrapUntrustedXml('alert_rule', sanitize(alert.rule_id)));
    sections.push(wrapUntrustedXml('alert_message', alert.most_recent_instance.message.text));
    sections.push(
      wrapUntrustedXml(
        'alert_location',
        `${alert.most_recent_instance.location.path}:${alert.most_recent_instance.location.start_line}`,
      ),
    );
  }

  sections.push('\n=== FIX DIFF ===');
  const truncatedDiff =
    diff.length > MAX_REVIEW_BODY_CHARS
      ? diff.slice(0, MAX_REVIEW_BODY_CHARS) + '\n... [diff truncated] ...'
      : diff;
  sections.push(wrapUntrustedXml('fix_diff', truncatedDiff));

  // Existing lessons for dedup context
  const lessonSection = formatResults(existingLessons, 'EXISTING LESSONS (do NOT duplicate)');
  if (lessonSection) {
    sections.push('\n=== DEDUP CONTEXT ===');
    sections.push(lessonSection);
  }

  return sections.join('\n');
}

// ─── Scan extraction ───────────────────────────────────

export async function extractFromScans(
  nums: number[],
  options: ExtractOptions,
  config: TotemConfig,
  cwd: string,
  configRoot: string,
): Promise<ExtractedLesson[]> {
  const path = await import('node:path');
  const { GitHubCliPrAdapter } = await import('../adapters/github-cli-pr.js');
  const { TotemConfigError } = await import('@mmnto/totem');

  const customSecrets = loadCustomSecrets(cwd, config.totemDir, (msg) => log.warn(TAG, msg));
  const adapter = new GitHubCliPrAdapter(cwd);

  // Connect to LanceDB for dedup context
  const embedding = requireEmbedding(config);
  const embedder = createEmbedder(embedding);
  const store = new LanceStore(path.join(cwd, config.lanceDir), embedder);
  await store.connect();

  log.info(TAG, 'Querying existing lessons for dedup...');
  const existingLessons = await retrieveExistingLessons(store);
  log.info(TAG, `Found ${existingLessons.length} existing lessons for context`);

  // Resolve system prompt (allow .totem/prompts/extract-scan.md override)
  const scanSystemPrompt = getSystemPrompt(
    'extract-scan',
    SCAN_EXTRACT_SYSTEM_PROMPT,
    cwd,
    config.totemDir,
  );

  const allLessons: ExtractedLesson[] = [];

  for (const num of nums) {
    if (!adapter.fetchCodeScanningAlerts) {
      throw new TotemConfigError(
        'The current PR adapter does not support code scanning alerts.',
        'Use the GitHub CLI adapter (default) to enable --from-scan.',
        'CONFIG_INVALID',
      );
    }

    // Fetch code scanning alerts for this PR
    const { safeExec: exec } = await import('@mmnto/totem');
    log.info(TAG, `Fetching code scanning alerts for PR #${num}...`);
    const allAlerts = adapter.fetchCodeScanningAlerts(num);
    const fixedAlerts = allAlerts.filter((a) => a.state === 'fixed');
    log.info(TAG, `Found ${allAlerts.length} alert(s), ${fixedAlerts.length} fixed`);

    if (fixedAlerts.length === 0) {
      log.dim(TAG, `No fixed code scanning alerts for PR #${num}. Skipping.`);
      continue;
    }

    // Fetch the PR diff filtered to affected files only (avoids truncation in large PRs)
    const affectedFiles = [
      ...new Set(fixedAlerts.map((a) => a.most_recent_instance.location.path)),
    ];
    log.info(TAG, `Fetching PR diff for ${affectedFiles.length} affected file(s)...`);
    const diffArgs = ['pr', 'diff', String(num), '--', ...affectedFiles];
    const diff = exec('gh', diffArgs, {
      cwd,
      timeout: GH_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: '1' },
    });

    // Assemble scan-specific prompt
    const prompt = assembleFromScanPrompt(fixedAlerts, diff, existingLessons, scanSystemPrompt);
    log.dim(TAG, `Prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

    // Run orchestrator
    const content = await runOrchestrator({
      prompt,
      tag: TAG,
      options,
      config,
      cwd,
      temperature: 0.4,
      customSecrets,
    });
    if (content == null) continue; // --raw mode

    // Parse lessons from LLM output
    const lessons = parseLessons(content);

    if (lessons.length === 0) {
      log.dim(TAG, `No lessons extracted from scan alerts in PR #${num}.`);
    } else {
      log.success(TAG, `Extracted ${lessons.length} lesson(s) from scan alerts in PR #${num}`);
      allLessons.push(...lessons);
    }
  }

  return allLessons;
}
