import * as path from 'node:path';

import type { ContentType, LanceStore, SearchResult } from '@mmnto/totem';

import { getDiffForReview } from '../git.js';
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
import { extractShieldHints } from './shield-hints.js';

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
  smartHints?: string[],
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

  // Smart review hints — auto-detected context to reduce false positives
  if (smartHints && smartHints.length > 0) {
    sections.push('\n=== SMART REVIEW HINTS ===');
    sections.push(
      'The following context was auto-detected from the diff. Apply these when reviewing:',
    );
    for (const hint of smartHints) {
      sections.push(`- ${hint}`);
    }
  }

  return sections.join('\n');
}

// ─── Structural prompt assembly ──────────────────────────

export function assembleStructuralPrompt(
  diff: string,
  changedFiles: string[],
  systemPrompt: string,
  smartHints?: string[],
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

  // Smart review hints — auto-detected context to reduce false positives
  if (smartHints && smartHints.length > 0) {
    sections.push('\n=== SMART REVIEW HINTS ===');
    sections.push(
      'The following context was auto-detected from the diff. Apply these when reviewing:',
    );
    for (const hint of smartHints) {
      sections.push(`- ${hint}`);
    }
  }

  return sections.join('\n');
}

// ─── Verdict parsing ────────────────────────────────────

export function parseVerdict(content: string): { pass: boolean; reason: string } | null {
  const match = VERDICT_RE.exec(content);
  if (!match) return null;
  return { pass: match[1] === 'PASS', reason: match[2].trim() };
}

/**
 * Write the .shield-passed gate flag on PASS so pre-push hooks can verify.
 */
export async function writeShieldPassedFlag(cwd: string, totemDir: string): Promise<void> {
  try {
    const fs = await import('node:fs');
    const { execSync } = await import('node:child_process');
    const head = execSync('git rev-parse HEAD', { cwd, encoding: 'utf-8' }).trim();
    const cacheDir = path.join(cwd, totemDir, 'cache');
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, '.shield-passed'), head);
  } catch (err) {
    // Non-fatal — flag is a convenience for pre-push hooks
    // Log at debug level so failures are diagnosable
    if (process.env['TOTEM_DEBUG'] === '1') {
      console.error(
        '[Shield] Failed to write .shield-passed:',
        err instanceof Error ? err.message : err,
      );
    }
  }
}

// ─── Main command ───────────────────────────────────────

export type ShieldFormat = 'text' | 'sarif' | 'json';

export interface ShieldOptions {
  raw?: boolean;
  out?: string;
  model?: string;
  fresh?: boolean;
  staged?: boolean;
  mode?: 'standard' | 'structural';
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

  const content = await runOrchestrator({ prompt, tag: TAG, options, config, cwd, temperature: 0 });
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

export async function shieldCommand(options: ShieldOptions): Promise<void> {
  const { TotemConfigError, TotemError } = await import('@mmnto/totem');
  if (options.mode && options.mode !== 'standard' && options.mode !== 'structural') {
    throw new TotemConfigError(
      `Invalid --mode "${options.mode}". Use "standard" or "structural".`,
      'Check `totem shield --help` for valid options.',
      'CONFIG_INVALID',
    );
  }
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // Get git diff — shared helper merges ignore patterns, tries staged/all
  // then falls back to branch diff, and extracts changed file paths.
  const diffResult = await getDiffForReview(options, config, cwd, TAG);
  if (!diffResult) return;

  const { diff, changedFiles } = diffResult;

  // Auto-detect smart review hints from the diff
  const smartHints = extractShieldHints(diff, changedFiles, cwd);
  if (smartHints.length > 0) {
    log.dim(TAG, `${smartHints.length} smart hint(s) detected`);
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
    const prompt = assembleStructuralPrompt(diff, changedFiles, systemPrompt, smartHints);
    log.dim(TAG, `Prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

    const content = await runOrchestrator({
      prompt,
      tag: TAG,
      options,
      config,
      cwd,
      temperature: 0,
    });
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
          if (verdict.pass) {
            await writeShieldPassedFlag(cwd, config.totemDir);
          } else {
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
  const prompt = assemblePrompt(diff, changedFiles, context, systemPrompt, smartHints);
  log.dim(TAG, `Prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

  const content = await runOrchestrator({
    prompt,
    tag: TAG,
    options,
    config,
    cwd,
    totalResults,
    temperature: 0,
  });
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
        if (verdict.pass) {
          await writeShieldPassedFlag(cwd, config.totemDir);
        } else {
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
