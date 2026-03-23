import * as path from 'node:path';

import type { ContentType, LanceStore, SearchResult } from '@mmnto/totem';
import { TotemConfigError, TotemError } from '@mmnto/totem';

import {
  extractChangedFiles,
  filterDiffByPatterns,
  getDefaultBranch,
  getGitBranchDiff,
  getGitDiff,
} from '../git.js';
import { bold, errorColor, log, success as successColor } from '../ui.js';
import {
  formatLessonSection,
  formatResults,
  getSystemPrompt,
  loadConfig,
  loadEnv,
  partitionLessons,
  requireEmbedding,
  resolveConfigPath,
  runOrchestrator,
  sanitize,
  wrapXml,
  writeOutput,
} from '../utils.js';
import { appendLessons, flagSuspiciousLessons, parseLessons, selectLessons } from './extract.js';
import {
  MAX_CODE_RESULTS,
  MAX_DIFF_CHARS,
  MAX_LESSONS,
  MAX_SESSION_RESULTS,
  MAX_SPEC_RESULTS,
  QUERY_DIFF_TRUNCATE,
  SHIELD_LEARN_SYSTEM_PROMPT,
  SPEC_SEARCH_POOL,
  STRUCTURAL_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  TAG,
  VERDICT_RE,
} from './shield-templates.js';

// Re-export constants & prompts so existing consumers are not broken
export {
  MAX_DIFF_CHARS,
  SHIELD_LEARN_SYSTEM_PROMPT,
  STRUCTURAL_SYSTEM_PROMPT,
} from './shield-templates.js';

// ─── LanceDB retrieval ─────────────────────────────────

interface RetrievedContext {
  specs: SearchResult[];
  sessions: SearchResult[];
  code: SearchResult[];
  lessons: SearchResult[];
}

async function retrieveContext(query: string, store: LanceStore): Promise<RetrievedContext> {
  const search = (typeFilter: ContentType, maxResults: number) =>
    store.search({ query, typeFilter, maxResults });

  const [allSpecs, sessions, code] = await Promise.all([
    search('spec', SPEC_SEARCH_POOL),
    search('session_log', MAX_SESSION_RESULTS),
    search('code', MAX_CODE_RESULTS),
  ]);

  const { lessons, specs } = partitionLessons(allSpecs, MAX_LESSONS, MAX_SPEC_RESULTS);

  return { specs, sessions, code, lessons };
}

function buildSearchQuery(changedFiles: string[], diff: string): string {
  const fileNames = changedFiles.map((f) => path.basename(f)).join(' ');
  const diffSnippet = diff.slice(0, QUERY_DIFF_TRUNCATE);
  return `${fileNames} ${diffSnippet}`.trim();
}

// ─── Prompt assembly ────────────────────────────────────

export function assemblePrompt(
  diff: string,
  changedFiles: string[],
  context: RetrievedContext,
  systemPrompt: string,
): string {
  const sections: string[] = [systemPrompt];

  // Diff section
  sections.push('=== DIFF ===');
  sections.push(`Changed files: ${changedFiles.join(', ')}`);
  sections.push('');
  if (diff.length > MAX_DIFF_CHARS) {
    sections.push(
      wrapXml(
        'git_diff',
        diff.slice(0, MAX_DIFF_CHARS) + `\n... [diff truncated at ${MAX_DIFF_CHARS} chars] ...`,
      ),
    );
  } else {
    sections.push(wrapXml('git_diff', diff));
  }

  // Totem knowledge
  const specSection = formatResults(context.specs, 'RELATED SPECS & ADRs');
  const sessionSection = formatResults(
    context.sessions,
    'LESSONS & SESSION HISTORY (ENFORCE AS CHECKLIST)',
  );
  const codeSection = formatResults(context.code, 'RELATED CODE PATTERNS');

  if (specSection || sessionSection || codeSection) {
    sections.push('\n=== TOTEM KNOWLEDGE ===');
    if (specSection) sections.push(specSection);
    if (sessionSection) sections.push(sessionSection);
    if (codeSection) sections.push(codeSection);
  }

  // Lessons — full bodies for strict enforcement
  const lessonSection = formatLessonSection(context.lessons);
  if (lessonSection) sections.push(lessonSection);

  return sections.join('\n');
}

// ─── Structural prompt assembly ──────────────────────────

export function assembleStructuralPrompt(
  diff: string,
  changedFiles: string[],
  systemPrompt: string,
): string {
  const sections: string[] = [systemPrompt];

  sections.push('=== DIFF ===');
  if (changedFiles.length > 0) {
    sections.push(`Changed files: ${changedFiles.join(', ')}`);
  }
  sections.push('');
  if (diff.length > MAX_DIFF_CHARS) {
    sections.push(
      wrapXml(
        'git_diff',
        diff.slice(0, MAX_DIFF_CHARS) + `\n... [diff truncated at ${MAX_DIFF_CHARS} chars] ...`,
      ),
    );
  } else {
    sections.push(wrapXml('git_diff', diff));
  }

  return sections.join('\n');
}

// ─── Verdict parsing ────────────────────────────────────

export function parseVerdict(content: string): { pass: boolean; reason: string } | null {
  const match = VERDICT_RE.exec(content);
  if (!match) return null;
  return { pass: match[1] === 'PASS', reason: match[2].trim() };
}

// ─── Main command ───────────────────────────────────────

export type ShieldFormat = 'text' | 'sarif' | 'json';

export interface ShieldOptions {
  raw?: boolean;
  out?: string;
  model?: string;
  fresh?: boolean;
  staged?: boolean;
  deterministic?: boolean;
  mode?: 'standard' | 'structural';
  format?: ShieldFormat;
  learn?: boolean;
  yes?: boolean;
}

// ─── Deterministic mode (delegates to shared engine) ─

// ─── Learn: extract lessons from failed verdict ─────

export async function learnFromVerdict(
  verdictContent: string,
  diff: string,
  options: ShieldOptions,
  config: Awaited<ReturnType<typeof loadConfig>>,
  cwd: string,
): Promise<void> {
  log.info(TAG, 'Extracting lessons from failed verdict...'); // totem-ignore: hardcoded string

  // Assemble extraction prompt: shield verdict + diff as context
  const systemPrompt = getSystemPrompt(
    'shield-learn',
    SHIELD_LEARN_SYSTEM_PROMPT,
    cwd,
    config.totemDir,
  );
  const sections = [
    systemPrompt,
    '=== SHIELD VERDICT (failed review) ===',
    wrapXml('shield_verdict', verdictContent),
    '',
    '=== DIFF UNDER REVIEW ===',
    wrapXml(
      'diff_under_review',
      diff.length > MAX_DIFF_CHARS
        ? diff.slice(0, MAX_DIFF_CHARS) + `\n... [diff truncated at ${MAX_DIFF_CHARS} chars] ...`
        : diff,
    ),
  ];

  // Add existing lessons for dedup if embedding is available
  if (config.embedding) {
    try {
      const { createEmbedder, LanceStore: Store } = await import('@mmnto/totem');
      const embedder = createEmbedder(config.embedding);
      const store = new Store(path.join(cwd, config.lanceDir), embedder);
      await store.connect();
      const existing = await store.search({
        query: 'lesson trap pattern decision',
        typeFilter: 'spec',
        maxResults: 10,
      });
      const lessonSection = formatResults(existing, 'EXISTING LESSONS (do NOT duplicate)');
      if (lessonSection) {
        sections.push('\n=== DEDUP CONTEXT ===');
        sections.push(lessonSection);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.dim(TAG, `Could not query existing lessons for dedup (non-fatal): ${msg}`); // totem-ignore: msg from Error.message
    }
  }

  const prompt = sections.join('\n');
  log.dim(TAG, `Learn prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

  const content = await runOrchestrator({ prompt, tag: TAG, options, config, cwd });
  if (content == null) return; // --raw mode

  const lessons = parseLessons(content);
  if (lessons.length === 0) {
    log.dim(TAG, 'No systemic lessons extracted from verdict.'); // totem-ignore: hardcoded string
    return;
  }

  log.success(TAG, `Extracted ${lessons.length} lesson(s) from verdict`); // totem-ignore: count only

  // Flag and select
  const flagged = flagSuspiciousLessons(lessons);

  // Display for review
  if (!options.yes) {
    console.error('');
    for (let i = 0; i < flagged.length; i++) {
      const lesson = flagged[i]!;
      const prefix = lesson.suspiciousFlags?.length ? `[!] ` : '';
      console.error(
        `  [${i + 1}] ${prefix}Tags: ${sanitize(lesson.tags.join(', ')).replace(/\n/g, ' ')}`,
      );
      console.error(`      ${sanitize(lesson.text).replace(/\n/g, '\n      ')}`);
      if (lesson.suspiciousFlags?.length) {
        for (const flag of lesson.suspiciousFlags) {
          console.error(`      [!] ${flag}`);
        }
      }
      console.error('');
    }
  }

  const selected = await selectLessons(flagged, {
    yes: options.yes,
    isTTY: !!process.stdin.isTTY,
  });

  if (selected.length === 0) {
    log.dim(TAG, 'No lessons selected — nothing written.'); // totem-ignore: hardcoded string
    return;
  }

  // Sanitize and persist
  const sanitized = selected.map((l) => ({
    tags: l.tags.map((t) => sanitize(t)),
    text: sanitize(l.text), // totem-ignore: already sanitized
  }));

  const lessonsDir = path.join(cwd, config.totemDir, 'lessons');
  appendLessons(sanitized, lessonsDir);
  log.success(TAG, `Appended ${sanitized.length} lesson(s) to ${config.totemDir}/lessons/`); // totem-ignore: count only

  // Incremental sync (non-fatal — lessons are already written to disk)
  try {
    log.info(TAG, 'Running incremental sync...');
    const { runSync } = await import('@mmnto/totem');
    const syncResult = await runSync(config, {
      projectRoot: cwd,
      incremental: true,
      onProgress: (msg) => log.dim(TAG, msg),
    });
    log.success(
      TAG,
      `Sync complete: ${syncResult.chunksProcessed} chunks from ${syncResult.filesProcessed} files`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(TAG, `Sync failed (lessons saved but not yet indexed): ${msg}`); // totem-ignore: msg from Error.message
  }
}

// ─── Main command ───────────────────────────────────

const VALID_FORMATS: ShieldFormat[] = ['text', 'sarif', 'json'];

export async function shieldCommand(options: ShieldOptions): Promise<void> {
  if (options.mode && options.mode !== 'standard' && options.mode !== 'structural') {
    throw new TotemConfigError(
      `Invalid --mode "${options.mode}". Use "standard" or "structural".`,
      'Check `totem shield --help` for valid options.',
      'CONFIG_INVALID',
    );
  }
  if (options.format && !VALID_FORMATS.includes(options.format)) {
    throw new TotemConfigError(
      `Invalid --format "${options.format}". Use "text", "sarif", or "json".`,
      'Check `totem shield --help` for valid options.',
      'CONFIG_INVALID',
    );
  }
  if (options.format && options.format !== 'text' && !options.deterministic) {
    throw new TotemConfigError(
      '--format sarif/json is only supported with `totem lint`.',
      'Use `totem lint --format sarif` or `totem lint --format json` instead.',
      'CONFIG_INVALID',
    );
  }

  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // Get git diff — filter ignored patterns before fallback check so that
  // noise (e.g., .strategy submodule pointer) doesn't suppress the branch diff.
  const allIgnore = [...config.ignorePatterns, ...(config.shieldIgnorePatterns ?? [])];

  const mode = options.staged ? 'staged' : 'all';
  log.info(TAG, `Getting ${mode === 'staged' ? 'staged' : 'uncommitted'} diff...`);
  let diff = await filterDiffByPatterns(getGitDiff(mode, cwd), allIgnore);

  if (!diff.trim()) {
    const base = getDefaultBranch(cwd);
    log.dim(TAG, `No relevant changes. Falling back to branch diff (${base}...HEAD)...`);
    diff = await filterDiffByPatterns(getGitBranchDiff(cwd, base), allIgnore);
  }

  if (!diff.trim()) {
    log.warn(TAG, 'No changes detected. Nothing to review.');
    return;
  }

  const changedFiles = extractChangedFiles(diff);
  log.info(TAG, `Changed files (${changedFiles.length}): ${changedFiles.join(', ')}`);

  // Deterministic mode — DEPRECATED, use `totem lint` instead
  if (options.deterministic) {
    log.warn(TAG, '⚠ --deterministic is deprecated. Use `totem lint` instead.');
    log.warn(TAG, '  This flag will be removed in a future release.');
    const exportPaths = config.exports ? Object.values(config.exports) : undefined;
    const { runCompiledRules } = await import('./run-compiled-rules.js');
    await runCompiledRules({
      diff,
      cwd,
      totemDir: config.totemDir,
      format: options.format ?? 'text',
      outPath: options.out,
      exportPaths,
      ignorePatterns: [...config.ignorePatterns, ...(config.shieldIgnorePatterns ?? [])],
      tag: TAG,
    });
    return;
  }

  // Structural mode — context-blind LLM review, no embeddings, no Totem knowledge
  if (options.mode === 'structural') {
    log.info(TAG, 'Running structural review (context-blind, no Totem knowledge)...');

    const systemPrompt = getSystemPrompt(
      'shield-structural',
      STRUCTURAL_SYSTEM_PROMPT,
      cwd,
      config.totemDir,
    );
    const prompt = assembleStructuralPrompt(diff, changedFiles, systemPrompt);
    log.dim(TAG, `Prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

    const content = await runOrchestrator({ prompt, tag: TAG, options, config, cwd });
    if (content == null && !options.raw) {
      throw new TotemError(
        'SHIELD_FAILED',
        'Orchestrator returned no content (defaulting to FAIL).',
        'Check your orchestrator API key and model configuration.',
      );
    }
    if (content != null) {
      writeOutput(content, options.out);
      if (options.out) log.success(TAG, `Written to ${options.out}`);

      if (!options.raw) {
        const verdict = parseVerdict(content);
        if (verdict) {
          const verdictLabel = verdict.pass ? successColor(bold('PASS')) : errorColor(bold('FAIL'));
          const reason = verdict.reason ? ` — ${verdict.reason}` : '';
          log.info(TAG, `Verdict: ${verdictLabel}${reason}`);
          if (!verdict.pass) {
            if (options.learn) await learnFromVerdict(content, diff, options, config, cwd);
            throw new TotemError(
              'SHIELD_FAILED',
              `Shield structural review failed: ${verdict.reason || 'no reason given'}`,
              'Fix the issues identified in the review above, then re-run `totem shield`.',
            );
          }
        } else {
          throw new TotemError(
            'SHIELD_FAILED',
            'Verdict not found in LLM output (defaulting to FAIL).',
            'Fix LLM output format — expected VERDICT: PASS/FAIL.',
          );
        }
      }
    }
    return;
  }

  // Standard mode — full Totem knowledge retrieval + LLM review
  // Connect to LanceDB
  const embedding = requireEmbedding(config);
  const { createEmbedder, LanceStore: Store } = await import('@mmnto/totem');
  const embedder = createEmbedder(embedding);
  const store = new Store(path.join(cwd, config.lanceDir), embedder);
  await store.connect();

  // Retrieve context from LanceDB
  const query = buildSearchQuery(changedFiles, diff);
  log.info(TAG, 'Querying Totem index...');
  const context = await retrieveContext(query, store);
  const totalResults =
    context.specs.length + context.sessions.length + context.code.length + context.lessons.length;
  log.info(
    TAG,
    `Found: ${context.specs.length} specs, ${context.sessions.length} sessions, ${context.code.length} code, ${context.lessons.length} lessons`,
  );

  // Resolve system prompt (allow .totem/prompts/shield.md override)
  const systemPrompt = getSystemPrompt('shield', SYSTEM_PROMPT, cwd, config.totemDir);

  // Assemble prompt
  const prompt = assemblePrompt(diff, changedFiles, context, systemPrompt);
  log.dim(TAG, `Prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

  const content = await runOrchestrator({ prompt, tag: TAG, options, config, cwd, totalResults });
  if (content != null) {
    writeOutput(content, options.out);
    if (options.out) log.success(TAG, `Written to ${options.out}`);

    // Parse verdict and gate on failure (skip in --raw mode — no LLM output)
    if (!options.raw) {
      const verdict = parseVerdict(content);
      if (verdict) {
        const verdictLabel = verdict.pass ? successColor(bold('PASS')) : errorColor(bold('FAIL'));
        const reason = verdict.reason ? ` — ${verdict.reason}` : '';
        log.info(TAG, `Verdict: ${verdictLabel}${reason}`);
        if (!verdict.pass) {
          if (options.learn) await learnFromVerdict(content, diff, options, config, cwd);
          throw new TotemError(
            'SHIELD_FAILED',
            `Shield review failed: ${verdict.reason || 'no reason given'}`,
            'Fix the issues identified in the review above, then re-run `totem shield`.',
          );
        }
      } else {
        throw new TotemError(
          'SHIELD_FAILED',
          'Verdict not found in LLM output (defaulting to FAIL).',
          'Fix LLM output format — expected VERDICT: PASS/FAIL.',
        );
      }
    }
  }
}
