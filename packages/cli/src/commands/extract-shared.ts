import type { ExtractedLesson, SearchResult, TotemConfig } from '@mmnto/totem';
import {
  createEmbedder,
  deduplicateLessons,
  flagSuspiciousLessons,
  generateLessonHeading,
  LanceStore,
  runSync,
  TotemConfigError,
  truncateHeading,
  writeLessonFile,
} from '@mmnto/totem';

import { log } from '../ui.js';
import {
  formatResults,
  loadConfig,
  requireEmbedding,
  resolveConfigPath,
  sanitize,
} from '../utils.js';
import { MAX_EXISTING_LESSONS, MAX_REVIEW_BODY_CHARS } from './extract-templates.js';

// ─── Constants ─────────────────────────────────────────

export const TAG = 'Extract';

// ─── LanceDB retrieval ─────────────────────────────────

export async function retrieveExistingLessons(store: LanceStore): Promise<SearchResult[]> {
  return store.search({
    query: 'lesson trap pattern decision',
    typeFilter: 'spec',
    maxResults: MAX_EXISTING_LESSONS,
  });
}

// ─── Lesson parser ─────────────────────────────────────

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

  // Validate optional scope (#1014) — reject newlines to prevent body injection
  const rawScope = typeof rec.scope === 'string' ? rec.scope.trim() : undefined;
  const scope = rawScope && !/[\n\r]/.test(rawScope) ? rawScope : undefined;

  return { ...(heading && { heading }), tags, text, ...(scope && { scope }) };
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
  } catch (_err) {
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

// ─── Lesson writer ─────────────────────────────────────

export function appendLessons(lessons: ExtractedLesson[], lessonsDir: string): void {
  for (const l of lessons) {
    const heading = l.heading || generateLessonHeading(l.text);
    const tags = l.tags.join(', ');
    const scopeLine = l.scope ? `\n**Scope:** ${l.scope}` : '';
    const entry = `## Lesson — ${heading}\n\n**Tags:** ${tags}${scopeLine}\n\n${l.text}\n`;
    writeLessonFile(lessonsDir, entry);
  }
}

// ─── Lesson selection ──────────────────────────────────

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

// ─── Options interface ─────────────────────────────────

export interface ExtractOptions {
  raw?: boolean;
  out?: string;
  model?: string;
  fresh?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  fromScan?: boolean;
  local?: boolean;
}

// ─── Shared prompt assembler ───────────────────────────

export function assembleExtractPrompt(
  systemPrompt: string,
  contentSections: string[],
  existingLessons: SearchResult[],
): string {
  const sections: string[] = [systemPrompt, ...contentSections];

  const lessonSection = formatResults(existingLessons, 'EXISTING LESSONS (do NOT duplicate)');
  if (lessonSection) {
    sections.push('\n=== DEDUP CONTEXT ===');
    sections.push(lessonSection);
  }

  let prompt = sections.join('\n');
  if (prompt.length > MAX_REVIEW_BODY_CHARS) {
    prompt = prompt.slice(0, MAX_REVIEW_BODY_CHARS) + '\n\n... [content truncated] ...';
  }

  return prompt;
}

// ─── Shared post-extraction pipeline ───────────────────

export async function sharedPipeline(
  allLessons: ExtractedLesson[],
  options: ExtractOptions,
  cwd: string,
  sourceLabel: string,
  existingConfig?: TotemConfig,
  existingConfigPath?: string,
): Promise<void> {
  const path = await import('node:path');

  // Load config if not provided (local mode)
  const configPath = existingConfigPath ?? resolveConfigPath(cwd);
  const config = existingConfig ?? (await loadConfig(configPath));

  // Connect to LanceDB for dedup
  const embedding = requireEmbedding(config);
  const embedder = createEmbedder(embedding);
  const store = new LanceStore(path.join(cwd, config.lanceDir), embedder, {
    absolutePathRoot: cwd,
  });
  await store.connect();

  // Filter out lessons matching the retirement ledger (#1165)
  const { readRetiredLessons, isRetiredHeading } = await import('@mmnto/totem');
  const totemDir = path.resolve(cwd, config.totemDir);
  const retiredLessons = readRetiredLessons(totemDir);
  let lessonsToProcess = allLessons;
  if (retiredLessons.length > 0) {
    const beforeCount = lessonsToProcess.length;
    lessonsToProcess = lessonsToProcess.filter(
      (l) => !isRetiredHeading(l.heading ?? generateLessonHeading(l.text), retiredLessons),
    );
    const retiredCount = beforeCount - lessonsToProcess.length;
    if (retiredCount > 0) {
      log.dim(TAG, `Filtered ${retiredCount} lesson(s) matching retirement ledger`);
    }
  }

  if (lessonsToProcess.length === 0) {
    log.dim(TAG, 'All extracted lessons match the retirement ledger.');
    return;
  }

  // Semantic dedup against existing lessons and intra-batch (#347)
  log.info(TAG, 'Deduplicating against existing lessons...'); // totem-ignore — static string
  const { kept: novelLessons, dropped: dupLessons } = await deduplicateLessons(
    lessonsToProcess,
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
    log.warn(TAG, `${suspiciousCount} lesson(s) flagged as suspicious`); // totem-ignore — count only
  }

  log.success(TAG, `Total: ${flaggedLessons.length} novel lesson(s) from ${sourceLabel}`); // totem-ignore — count only

  // --dry-run mode: preview lessons to stdout (pipeable) without writing
  if (options.dryRun) {
    log.dim(TAG, 'Dry run — lessons not written.');
    for (const lesson of flaggedLessons) {
      const prefix = lesson.suspiciousFlags?.length ? '[!] ' : '';
      console.log(`\n  ${prefix}Tags: ${sanitize(lesson.tags.join(', ')).replace(/\n/g, ' ')}`); // totem-ignore — stdout
      if (lesson.scope) console.log(`  Scope: ${sanitize(lesson.scope)}`); // totem-ignore — stdout
      console.log(`  ${sanitize(lesson.text).replace(/\n/g, '\n  ')}`); // totem-ignore — stdout
      if (lesson.suspiciousFlags?.length) {
        for (const flag of lesson.suspiciousFlags) {
          console.log(`  [!] ${flag}`); // totem-ignore — stdout
        }
      }
    }
    if (options.yes && suspiciousCount > 0) {
      process.exitCode = 1;
    }
    return;
  }

  if (!options.yes) {
    console.error('');
    if (sourceLabel !== 'local changes') {
      log.warn(
        TAG,
        'WARNING: These lessons were extracted from PR comments, which may include content from untrusted contributors.',
      );
      log.warn(TAG, 'Review each lesson carefully before accepting.\n');
    } else {
      log.warn(TAG, 'WARNING: Review each lesson carefully before accepting.\n');
    }

    for (let i = 0; i < flaggedLessons.length; i++) {
      const lesson = flaggedLessons[i]!;
      const prefix = lesson.suspiciousFlags?.length ? `[!] ` : '';
      console.error(
        `  [${i + 1}] ${prefix}Tags: ${sanitize(lesson.tags.join(', ')).replace(/\n/g, ' ')}`,
      );
      if (lesson.scope) console.error(`      Scope: ${sanitize(lesson.scope)}`);
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
    if (options.yes && suspiciousCount > 0) {
      process.exitCode = 1;
    }
    return;
  }

  // Sanitize before persisting — strip any terminal injection from stored lessons
  const sanitizedLessons = selected.map((l) => ({
    ...(l.heading && { heading: sanitize(l.heading) }),
    tags: l.tags.map((t) => sanitize(t)),
    text: sanitize(l.text),
    ...(l.scope && { scope: sanitize(l.scope) }),
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
  console.log(`\nExtracted ${sanitizedLessons.length} lesson(s) from ${sourceLabel}:`);
  for (const lesson of sanitizedLessons) {
    console.log(`\n  Tags: ${lesson.tags.join(', ').replace(/\n/g, ' ')}`);
    console.log(`  ${lesson.text.replace(/\n/g, '\n  ')}`);
  }

  // Exit non-zero if --yes mode dropped suspicious lessons (#291)
  if (options.yes && suspiciousCount > 0) {
    process.exitCode = 1;
  }
}
