import type { ExtractedLesson, SearchResult } from '@mmnto/totem';
import { createEmbedder, LanceStore, TotemConfigError } from '@mmnto/totem';

import { log } from '../ui.js';
import {
  formatResults,
  getSystemPrompt,
  isGlobalConfigPath,
  loadConfig,
  loadEnv,
  requireEmbedding,
  resolveConfigPath,
  runOrchestrator,
  wrapUntrustedXml,
} from '../utils.js';
import type { ExtractOptions } from './extract-shared.js';
import { parseLessons, retrieveExistingLessons, TAG } from './extract-shared.js';
import { LOCAL_EXTRACT_SYSTEM_PROMPT, MAX_REVIEW_BODY_CHARS } from './extract-templates.js';

// ─── Constants ─────────────────────────────────────────

export const LOCKFILE_PATTERNS = [
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
];

// ─── Local prompt assembly ─────────────────────────────

export function assembleLocalPrompt(
  diff: string,
  existingLessons: SearchResult[],
  systemPrompt: string,
  scopeGlobs?: string[],
): string {
  const sections: string[] = [systemPrompt];

  if (scopeGlobs && scopeGlobs.length > 0) {
    sections.push('\n=== SCOPE CONTEXT ===');
    sections.push(
      wrapUntrustedXml('scope_context', `Suggested file scope: ${scopeGlobs.join(', ')}`),
    );
  }

  sections.push('\n=== LOCAL CHANGES ===');
  const truncatedDiff =
    diff.length > MAX_REVIEW_BODY_CHARS
      ? diff.slice(0, MAX_REVIEW_BODY_CHARS) + '\n... [diff truncated] ...'
      : diff;
  sections.push(wrapUntrustedXml('local_diff', truncatedDiff));

  const lessonSection = formatResults(existingLessons, 'EXISTING LESSONS (do NOT duplicate)');
  if (lessonSection) {
    sections.push('\n=== DEDUP CONTEXT ===');
    sections.push(lessonSection);
  }

  return sections.join('\n');
}

// ─── Local extraction ──────────────────────────────────

// totem-context: extractFromLocal uses TotemConfigError and log from static imports at top of file
export async function extractFromLocal(
  options: ExtractOptions,
  cwd: string,
): Promise<ExtractedLesson[]> {
  const path = await import('node:path');
  const {
    extractChangedFiles,
    getDefaultBranch,
    getGitDiff,
    inferScopeFromFiles,
    loadCustomSecrets: loadSecrets,
    resolveGitRoot,
    safeExec: exec,
  } = await import('@mmnto/totem');

  // 1. Resolve git root
  const gitRoot = resolveGitRoot(cwd);
  if (!gitRoot) {
    throw new TotemConfigError(
      'Not inside a Git repository.',
      'Run this command from within a Git repository.',
      'CONFIG_INVALID',
    );
  }

  // 2. Get local diff using cascade
  let diff = '';
  let diffSource = '';

  const all = getGitDiff('all', cwd);
  if (all) {
    diff = all;
    diffSource = 'local changes';
  } else {
    // Try unpushed commits
    try {
      const defaultBranch = getDefaultBranch(cwd);
      const currentBranch = exec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
      let unpushed = '';
      if (currentBranch && currentBranch !== 'HEAD') {
        try {
          unpushed = exec('git', ['log', '-p', `origin/${currentBranch}..HEAD`], { cwd });
        } catch {
          // Remote tracking branch may not exist — fall back to default branch
        }
      }
      if (!unpushed) {
        unpushed = exec('git', ['log', '-p', `origin/${defaultBranch}..HEAD`], { cwd });
      }
      if (unpushed) {
        diff = unpushed;
        diffSource = 'unpushed commits';
      }
    } catch {
      // No remote or no commits — fall through to error
    }
  }

  if (!diff) {
    throw new TotemConfigError(
      'No local changes found.',
      'Stage changes, make commits, or push to create diffs for lesson extraction.',
      'CONFIG_INVALID',
    );
  }

  log.info(TAG, `Using ${diffSource} for lesson extraction`);

  // 3. Filter diff — skip lockfiles and binaries
  const changedFiles = extractChangedFiles(diff).filter(
    (f) => !LOCKFILE_PATTERNS.some((p) => f.endsWith(p)),
  );

  if (changedFiles.length === 0) {
    log.dim(TAG, 'All changed files are lockfiles or binaries. Nothing to extract.');
    return [];
  }

  log.dim(TAG, `Changed files: ${changedFiles.length}`);

  // 4. Infer scope
  const scopeGlobs = inferScopeFromFiles(changedFiles);
  if (scopeGlobs.length > 0) {
    log.dim(TAG, `Inferred scope: ${scopeGlobs.join(', ')}`);
  }

  // 5. Load config, env, embedding, connect to LanceDB
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
  const customSecrets = loadSecrets(cwd, config.totemDir, (msg) => log.warn(TAG, msg));
  const embedding = requireEmbedding(config);
  const embedder = createEmbedder(embedding);
  const store = new LanceStore(path.join(cwd, config.lanceDir), embedder);
  await store.connect();

  // 6. Query existing lessons for dedup
  log.info(TAG, 'Querying existing lessons for dedup...');
  const existingLessons = await retrieveExistingLessons(store);
  log.info(TAG, `Found ${existingLessons.length} existing lessons for context`);

  // 7. Assemble prompt
  const systemPrompt = getSystemPrompt(
    'extract-local',
    LOCAL_EXTRACT_SYSTEM_PROMPT,
    cwd,
    config.totemDir,
  );
  const prompt = assembleLocalPrompt(diff, existingLessons, systemPrompt, scopeGlobs);
  log.dim(TAG, `Prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

  // 8. Run orchestrator
  const content = await runOrchestrator({
    prompt,
    tag: TAG,
    options,
    config,
    cwd,
    temperature: 0.4,
    customSecrets,
  });
  if (content == null) return []; // --raw mode

  // 9. Parse lessons
  const lessons = parseLessons(content);

  if (lessons.length === 0) {
    log.dim(TAG, 'No lessons extracted from local changes.');
    return [];
  }

  log.success(TAG, `Extracted ${lessons.length} lesson(s) from local changes`);
  return lessons;
}
