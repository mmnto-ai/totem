import type { ExtractedLesson, SearchResult } from '@mmnto/totem';
import {
  createEmbedder,
  deduplicateLessons,
  flagSuspiciousLessons,
  generateLessonHeading,
  LanceStore,
  loadCustomSecrets,
  runSync,
  TotemConfigError,
  truncateHeading,
  writeLessonFile,
} from '@mmnto/totem';

import type { StandardPr, StandardReviewComment } from '../adapters/pr-adapter.js';
import { log } from '../ui.js';
import {
  formatResults,
  getSystemPrompt,
  loadConfig,
  loadEnv,
  requireEmbedding,
  resolveConfigPath,
  runOrchestrator,
  sanitize,
  wrapUntrustedXml,
} from '../utils.js';
import {
  MAX_EXISTING_LESSONS,
  MAX_INPUTS,
  MAX_REVIEW_BODY_CHARS,
  SYSTEM_PROMPT,
} from './extract-templates.js';

// ─── Constants (re-exported from extract-templates) ─────

export {
  EXTRACT_SYSTEM_PROMPT,
  MAX_EXISTING_LESSONS,
  MAX_INPUTS,
  MAX_REVIEW_BODY_CHARS,
  SEMANTIC_DEDUP_THRESHOLD,
  SYSTEM_PROMPT,
} from './extract-templates.js';

// ─── Re-exports from core (moved from this file) ────────

export type { ExtractedLesson } from '@mmnto/totem';
export {
  cosineSimilarity,
  deduplicateLessons,
  flagSuspiciousLessons,
  isInstructionalContext,
} from '@mmnto/totem';

const TAG = 'Extract';

// ─── Thread grouping ────────────────────────────────────

interface CommentThread {
  path: string;
  diffHunk: string;
  comments: { author: string; body: string }[];
}

function groupIntoThreads(comments: StandardReviewComment[]): CommentThread[] {
  const byId = new Map<number, StandardReviewComment>();
  for (const c of comments) byId.set(c.id, c);

  const threadMap = new Map<number, StandardReviewComment[]>();
  for (const c of comments) {
    const rootId = c.inReplyToId ?? c.id;
    const thread = threadMap.get(rootId) ?? [];
    thread.push(c);
    threadMap.set(rootId, thread);
  }

  const threads: CommentThread[] = [];
  for (const [rootId, threadComments] of threadMap) {
    threadComments.sort((a, b) => {
      if (!a.createdAt || !b.createdAt) return 0;
      return a.createdAt.localeCompare(b.createdAt);
    });

    const root = byId.get(rootId) ?? threadComments[0]!;
    threads.push({
      path: root.path,
      diffHunk: root.diffHunk,
      comments: threadComments.map((c) => ({ author: c.author, body: c.body })),
    });
  }

  return threads;
}

// ─── LanceDB retrieval ─────────────────────────────────

async function retrieveExistingLessons(store: LanceStore): Promise<SearchResult[]> {
  return store.search({
    query: 'lesson trap pattern decision',
    typeFilter: 'spec',
    maxResults: MAX_EXISTING_LESSONS,
  });
}

// ─── Prompt assembly ────────────────────────────────────

const DEFAULT_BOT_MARKERS: readonly string[] = ['Using Gemini Code Assist', 'Gemini Code Assist'];

function isGcaBoilerplate(body: string, botMarkers: readonly string[]): boolean {
  return botMarkers.some((marker) => body.includes(marker));
}

export function assemblePrompt(
  pr: StandardPr,
  threads: CommentThread[],
  existingLessons: SearchResult[],
  systemPrompt: string,
  nits?: string[],
  botMarkers: readonly string[] = DEFAULT_BOT_MARKERS,
): string {
  const sections: string[] = [systemPrompt];

  // PR metadata — sanitize untrusted fields (title, state come from PR author)
  sections.push('=== PR METADATA ===');
  sections.push(`PR #${pr.number}: ${sanitize(pr.title)}`);
  sections.push(`State: ${sanitize(pr.state)}`);
  if (pr.body) {
    sections.push('');
    sections.push(wrapUntrustedXml('pr_body', pr.body));
  }

  // Review summaries (non-empty review bodies)
  const reviewBodies = pr.reviews.filter((r) => r.body.trim());
  if (reviewBodies.length > 0) {
    sections.push('\n=== REVIEW SUMMARIES ===');
    for (const r of reviewBodies) {
      sections.push(`[${sanitize(r.author)} — ${sanitize(r.state)}]`);
      sections.push(wrapUntrustedXml('review_body', r.body));
      sections.push('');
    }
  }

  // CodeRabbit nits (pre-parsed and passed in)
  if (nits && nits.length > 0) {
    sections.push('\n=== CODERABBIT NITS (extract valuable architectural insights) ===');
    for (const nit of nits) {
      sections.push(wrapUntrustedXml('nit_body', nit));
    }
  }

  // Regular PR comments (filter GCA boilerplate)
  const prComments = pr.comments.filter((c) => !isGcaBoilerplate(c.body, botMarkers));
  if (prComments.length > 0) {
    sections.push('\n=== PR COMMENTS ===');
    for (const c of prComments) {
      sections.push(`[${sanitize(c.author)}]`);
      sections.push(wrapUntrustedXml('comment_body', c.body));
      sections.push('');
    }
  }

  // Inline review comment threads
  if (threads.length > 0) {
    sections.push('\n=== INLINE REVIEW THREADS ===');
    for (const thread of threads) {
      sections.push(`--- ${sanitize(thread.path)} ---`); // totem-ignore — thread.path is untrusted PR data, not local git
      sections.push(wrapUntrustedXml('diff_hunk', thread.diffHunk));
      for (const c of thread.comments) {
        sections.push(`[${sanitize(c.author)}]:\n${wrapUntrustedXml('comment_body', c.body)}`);
      }
      sections.push('');
    }
  }

  // Existing lessons for dedup context
  const lessonSection = formatResults(existingLessons, 'EXISTING LESSONS (do NOT duplicate)');
  if (lessonSection) {
    sections.push('\n=== DEDUP CONTEXT ===');
    sections.push(lessonSection);
  }

  // Truncate if needed
  let prompt = sections.join('\n');
  if (prompt.length > MAX_REVIEW_BODY_CHARS) {
    prompt = prompt.slice(0, MAX_REVIEW_BODY_CHARS) + '\n\n... [content truncated] ...';
  }

  return prompt;
}

// ─── Lesson parser ──────────────────────────────────────

const LESSON_RE = /---LESSON---\s*\n(?:Heading:\s*(.+)\n)?Tags:\s*(.+)\n([\s\S]+?)---END---/g;

/** Strip markdown heading markers and "Lesson —" prefixes, then enforce max length. */
function sanitizeHeading(heading: string): string {
  const cleaned = heading
    .replace(/^#+\s*/, '')
    .replace(/^Lesson\s*[-—:]\s*/i, '')
    .trim();
  return truncateHeading(cleaned);
}

/** Max allowed length for a single lesson's text to prevent corrupted/hallucinated output. */
const MAX_LESSON_TEXT_LENGTH = 2000;
/** Max allowed tags per lesson. */
const MAX_TAGS_PER_LESSON = 10;
/** Max allowed length for a single tag. */
const MAX_TAG_LENGTH = 50;

/** Extract a JSON array from LLM output, handling code fences and conversational wrapping. */
function extractJsonArray(input: string): string | null {
  const trimmed = input.trim();

  // Try markdown code fences (backtick or tilde)
  const fenced = trimmed.match(/(?:```|~~~)(?:json)?\s*\n?([\s\S]*?)(?:```|~~~)/i);
  if (fenced) return fenced[1]!.trim();

  // Look for `[` followed by optional whitespace then `{` — handles both compact and pretty-printed
  const arrayStart = trimmed.search(/\[\s*\{/);
  if (arrayStart !== -1) {
    // Find matching ] respecting JSON string literals (brackets inside strings don't count)
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = arrayStart; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\' && inString) {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) return trimmed.slice(arrayStart, i + 1);
      }
    }
  }

  return null;
}

/** Validate a single parsed lesson object. Returns null if invalid. */
function validateLesson(obj: unknown): ExtractedLesson | null {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return null;
  const rec = obj as Record<string, unknown>;

  // Normalize text
  const text = typeof rec.text === 'string' ? rec.text.trim() : null;
  if (!text || text.length > MAX_LESSON_TEXT_LENGTH) return null;

  // Normalize tags — trim and filter empty
  const tags = Array.isArray(rec.tags)
    ? rec.tags
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim())
        .filter(Boolean)
    : null;
  if (!tags || tags.length === 0 || tags.length > MAX_TAGS_PER_LESSON) return null;
  if (tags.some((t) => t.length > MAX_TAG_LENGTH)) return null;

  // Validate optional heading
  const heading = typeof rec.heading === 'string' ? sanitizeHeading(rec.heading) : undefined;

  return { ...(heading && { heading }), tags, text };
}

/** Try to parse JSON lessons with manual validation. Returns null on failure. */
function tryParseJson(llmOutput: string): ExtractedLesson[] | null {
  try {
    const jsonStr = extractJsonArray(llmOutput);
    if (!jsonStr) return null;

    const parsed: unknown = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return null;

    const lessons: ExtractedLesson[] = [];
    for (const item of parsed) {
      const validated = validateLesson(item);
      if (validated) lessons.push(validated);
    }

    // JSON was detected and parsed — return results even if empty.
    // Returning [] (not null) prevents regex fallback from accepting
    // injected ---LESSON--- content after JSON was already found.
    return lessons;
  } catch {
    return null;
  }
}

/** Fallback: parse lessons using the legacy ---LESSON---...---END--- regex format. */
function parseWithRegex(llmOutput: string): ExtractedLesson[] {
  const lessons: ExtractedLesson[] = [];
  let match: RegExpExecArray | null;

  while ((match = LESSON_RE.exec(llmOutput)) !== null) {
    const rawHeading = match[1]; // undefined if Heading: line was absent
    const tags = match[2]!
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const text = match[3]!.trim();

    // Validate: reject malformed or hallucinated lessons before they reach disk
    if (!text) continue;
    if (text.length > MAX_LESSON_TEXT_LENGTH) continue;
    if (tags.length === 0 || tags.length > MAX_TAGS_PER_LESSON) continue;
    if (tags.some((t) => t.length > MAX_TAG_LENGTH)) continue;

    const heading = rawHeading ? sanitizeHeading(rawHeading) : undefined;
    lessons.push({ ...(heading && { heading }), tags, text });
  }

  return lessons;
}

export function parseLessons(llmOutput: string): ExtractedLesson[] {
  if (llmOutput.trim() === 'NONE') return [];

  // Primary path: JSON + manual validation
  const jsonLessons = tryParseJson(llmOutput);
  if (jsonLessons !== null) return jsonLessons;

  // Fallback: regex parsing for models that don't produce clean JSON
  return parseWithRegex(llmOutput);
}

// ─── Lesson writer ──────────────────────────────────────

export function appendLessons(lessons: ExtractedLesson[], lessonsDir: string): void {
  for (const l of lessons) {
    const heading = l.heading || generateLessonHeading(l.text);
    const tags = l.tags.join(', ');
    const entry = `## Lesson — ${heading}\n\n**Tags:** ${tags}\n\n${l.text}\n`;
    writeLessonFile(lessonsDir, entry);
  }
}

// ─── Lesson selection ───────────────────────────────────

const LABEL_MAX_CHARS = 70;

function truncateLabel(text: string): string {
  const oneLine = text.replace(/\n/g, ' ');
  if (oneLine.length <= LABEL_MAX_CHARS) return oneLine;
  return oneLine.slice(0, LABEL_MAX_CHARS - 1) + '…';
}

/**
 * Prompts the user to select which lessons to keep via multi-select.
 * In --yes mode, suspicious lessons are blocked (dropped with warnings).
 * Returns the selected lessons.
 * Throws in non-interactive environments without --yes.
 */
export async function selectLessons(
  lessons: ExtractedLesson[],
  opts: { yes?: boolean; isTTY?: boolean },
): Promise<ExtractedLesson[]> {
  if (opts.yes) {
    // --yes mode: block suspicious lessons (#291)
    const clean = lessons.filter((l) => !l.suspiciousFlags?.length);
    const dropped = lessons.filter((l) => l.suspiciousFlags?.length);
    if (dropped.length > 0) {
      for (const l of dropped) {
        log.warn(TAG, `Blocked suspicious lesson: ${truncateLabel(sanitize(l.text))}`);
        for (const flag of l.suspiciousFlags!) {
          log.warn(TAG, `  - ${flag}`);
        }
      }
    }
    return clean;
  }

  if (!opts.isTTY) {
    throw new TotemConfigError(
      'Refusing to write lessons in non-interactive mode.',
      'Use --yes to bypass confirmation, or run in an interactive terminal.',
      'CONFIG_INVALID',
    );
  }

  const { isCancel, multiselect } = await import('@clack/prompts');
  const result = await multiselect({
    message: `Select lessons to persist (${lessons.length} extracted):`,
    options: lessons.map((lesson, i) => ({
      value: i,
      label: lesson.suspiciousFlags?.length
        ? `[!] ${truncateLabel(sanitize(lesson.text))}`
        : truncateLabel(sanitize(lesson.text)),
      hint: lesson.suspiciousFlags?.length
        ? `${sanitize(lesson.tags.join(', '))} -- ${lesson.suspiciousFlags.join('; ')}`
        : sanitize(lesson.tags.join(', ')),
    })),
    // Pre-select only non-suspicious lessons
    initialValues: lessons
      .map((l, i) => (l.suspiciousFlags?.length ? null : i))
      .filter((i): i is number => i !== null),
    required: false,
  });

  if (isCancel(result)) {
    return [];
  }

  return (result as number[]).map((i) => lessons[i]!);
}

// ─── Main command ───────────────────────────────────────

export interface ExtractOptions {
  raw?: boolean;
  out?: string;
  model?: string;
  fresh?: boolean;
  dryRun?: boolean;
  yes?: boolean;
}

export async function extractCommand(prNumbers: string[], options: ExtractOptions): Promise<void> {
  const path = await import('node:path');
  const { GitHubCliPrAdapter } = await import('../adapters/github-cli-pr.js');

  // Validate and deduplicate PR numbers
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
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // Load user-defined custom secrets for DLP (#921)
  const customSecrets = loadCustomSecrets(cwd, config.totemDir, (msg) => log.warn(TAG, msg));

  // Use project-configured bot markers if provided, otherwise keep defaults
  const botMarkers: readonly string[] = config.botMarkers ?? DEFAULT_BOT_MARKERS;

  // Connect to LanceDB for dedup context
  const embedding = requireEmbedding(config);
  const embedder = createEmbedder(embedding);
  const store = new LanceStore(path.join(cwd, config.lanceDir), embedder);
  await store.connect();

  log.info(TAG, 'Querying existing lessons for dedup...');
  const existingLessons = await retrieveExistingLessons(store);
  log.info(TAG, `Found ${existingLessons.length} existing lessons for context`);

  // Resolve system prompt (allow .totem/prompts/extract.md override)
  const systemPrompt = getSystemPrompt('extract', SYSTEM_PROMPT, cwd, config.totemDir);

  // Process each PR sequentially, accumulating lessons
  const allLessons: ExtractedLesson[] = [];
  const adapter = new GitHubCliPrAdapter(cwd);

  for (const num of nums) {
    // Fetch PR data
    log.info(TAG, `Fetching PR #${num}...`);
    const pr = adapter.fetchPr(num);
    log.info(TAG, `Title: ${pr.title}`);

    // Fetch inline review comments
    log.info(TAG, 'Fetching review comments...');
    const reviewComments = adapter.fetchReviewComments(num);
    log.info(TAG, `Found ${reviewComments.length} inline review comments`);

    // Filter GCA boilerplate from inline comments
    const filteredComments = reviewComments.filter((c) => !isGcaBoilerplate(c.body, botMarkers));

    // Skip if no review content
    const hasReviewContent =
      pr.reviews.some((r) => r.body.trim()) ||
      pr.comments.some((c) => !isGcaBoilerplate(c.body, botMarkers)) ||
      filteredComments.length > 0;

    if (!hasReviewContent) {
      log.dim(TAG, `No review content found in PR #${num}. Skipping.`);
      continue;
    }

    // Group inline comments into threads
    const threads = groupIntoThreads(filteredComments);
    log.info(TAG, `Grouped into ${threads.length} review threads`);

    // Extract CodeRabbit nits from review bodies (lazy import)
    const { parseCodeRabbitNits } = await import('../parse-nits.js');
    const prNits: string[] = [];
    for (const r of pr.reviews) {
      if (r.author?.toLowerCase().includes('coderabbit')) {
        prNits.push(...parseCodeRabbitNits(r.body));
      }
    }

    // Assemble prompt
    const prompt = assemblePrompt(pr, threads, existingLessons, systemPrompt, prNits, botMarkers);
    log.dim(TAG, `Prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

    // Run orchestrator (handles --raw mode, validation, invocation, telemetry)
    const content = await runOrchestrator({
      prompt,
      tag: TAG,
      options,
      config,
      cwd,
      temperature: 0.4,
      customSecrets,
    });
    if (content == null) continue; // --raw mode — prompt already output, process next PR

    // Parse lessons from LLM output
    const lessons = parseLessons(content);

    if (lessons.length === 0) {
      log.dim(TAG, `No lessons extracted from PR #${num}.`);
    } else {
      log.success(TAG, `Extracted ${lessons.length} lesson(s) from PR #${num}`);
      allLessons.push(...lessons);
    }
  }

  // In --raw mode, prompts were already output during the loop
  if (options.raw) return;

  if (allLessons.length === 0) {
    log.dim(TAG, 'No lessons extracted from any PR.');
    return;
  }

  // Semantic dedup against existing lessons and intra-batch (#347)
  log.info(TAG, 'Deduplicating against existing lessons...'); // totem-ignore — static string
  const { kept: novelLessons, dropped: dupLessons } = await deduplicateLessons(
    allLessons,
    store,
    embedder,
  );
  if (dupLessons.length > 0) {
    log.dim(TAG, `Dropped ${dupLessons.length} semantically duplicate lesson(s)`); // totem-ignore — integer count
  }

  if (novelLessons.length === 0) {
    log.dim(TAG, 'All extracted lessons are duplicates of existing ones.'); // totem-ignore — static string
    return;
  }

  // Flag suspicious lessons before review (#290)
  const flaggedLessons = flagSuspiciousLessons(novelLessons);
  const suspiciousCount = flaggedLessons.filter((l) => l.suspiciousFlags?.length).length;
  if (suspiciousCount > 0) {
    log.warn(TAG, `${suspiciousCount} lesson(s) flagged as suspicious`); // totem-ignore — count only, no untrusted content
  }

  log.success(TAG, `Total: ${flaggedLessons.length} lesson(s) from ${nums.length} PR(s)`); // totem-ignore — count only, no untrusted content

  // --dry-run mode: preview lessons to stdout (pipeable) without writing
  if (options.dryRun) {
    log.dim(TAG, 'Dry run — lessons not written.');
    for (const lesson of flaggedLessons) {
      const prefix = lesson.suspiciousFlags?.length ? '[!] ' : '';
      console.log(`\n  ${prefix}Tags: ${sanitize(lesson.tags.join(', ')).replace(/\n/g, ' ')}`); // totem-ignore — stdout for piping
      console.log(`  ${sanitize(lesson.text).replace(/\n/g, '\n  ')}`); // totem-ignore — stdout for piping
      if (lesson.suspiciousFlags?.length) {
        for (const flag of lesson.suspiciousFlags) {
          console.log(`  [!] ${flag}`); // totem-ignore — stdout for piping
        }
      }
    }
    // Exit non-zero if suspicious lessons detected in --yes mode (#291)
    if (options.yes && suspiciousCount > 0) {
      process.exitCode = 1;
    }
    return;
  }

  if (!options.yes) {
    // Display full text of each lesson for review before prompting
    console.error('');
    log.warn(
      TAG,
      'WARNING: These lessons were extracted from PR comments, which may include content from untrusted contributors.',
    );
    log.warn(TAG, 'Review each lesson carefully before accepting.\n');

    for (let i = 0; i < flaggedLessons.length; i++) {
      const lesson = flaggedLessons[i]!;
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

  // Interactive multi-select (or --yes bypass with suspicious blocking)
  const selected = await selectLessons(flaggedLessons, {
    yes: options.yes,
    isTTY: !!process.stdin.isTTY,
  });

  if (selected.length === 0) {
    log.dim(TAG, 'No lessons selected — nothing written.');
    return;
  }

  // Sanitize before persisting — strip any terminal injection from stored lessons
  const sanitizedLessons = selected.map((l) => ({
    tags: l.tags.map((t) => sanitize(t)),
    text: sanitize(l.text),
  }));

  // Append lessons to .totem/lessons/
  const lessonsDir = path.join(cwd, config.totemDir, 'lessons');
  appendLessons(sanitizedLessons, lessonsDir);
  log.success(TAG, `Appended ${sanitizedLessons.length} lesson(s) to ${config.totemDir}/lessons/`); // totem-ignore

  // Run incremental sync so lessons are immediately searchable
  log.info(TAG, 'Running incremental sync...');
  const syncResult = await runSync(config, {
    projectRoot: cwd,
    incremental: true,
    onProgress: (msg) => log.dim(TAG, msg),
  });
  log.success(
    TAG,
    `Sync complete: ${syncResult.chunksProcessed} chunks from ${syncResult.filesProcessed} files`,
  );

  // Print summary
  const prLabel = nums.length === 1 ? `PR #${nums[0]}` : `${nums.length} PRs`;
  console.log(`\nExtracted ${sanitizedLessons.length} lesson(s) from ${prLabel}:`);
  for (const lesson of sanitizedLessons) {
    console.log(`\n  Tags: ${lesson.tags.join(', ').replace(/\n/g, ' ')}`);
    console.log(`  ${lesson.text.replace(/\n/g, '\n  ')}`);
  }

  // Exit non-zero if --yes mode dropped suspicious lessons (#291)
  if (options.yes && suspiciousCount > 0) {
    process.exitCode = 1;
  }
}
