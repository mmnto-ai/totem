import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';

import type { SearchResult } from '@mmnto/totem';
import { createEmbedder, LanceStore, runSync } from '@mmnto/totem';

import { GitHubCliPrAdapter } from '../adapters/github-cli-pr.js';
import type { StandardPr, StandardReviewComment } from '../adapters/pr-adapter.js';
import {
  formatResults,
  loadConfig,
  loadEnv,
  resolveConfigPath,
  runOrchestrator,
  wrapXml,
} from '../utils.js';

// ─── Constants ──────────────────────────────────────────

const TAG = 'Learn';
const MAX_EXISTING_LESSONS = 10;
const MAX_REVIEW_BODY_CHARS = 50_000;

// ─── System prompt ──────────────────────────────────────

const SYSTEM_PROMPT = `# Learn System Prompt — PR Lesson Extraction

## Purpose
Extract tactical lessons from a pull request's review comments and discussion.

## Role
You are a knowledge curator analyzing a PR's review threads. Your job is to distill non-obvious lessons — traps, patterns, decisions with rationale — that will prevent future mistakes.

## Rules
- Extract ONLY non-obvious lessons (traps, surprising behaviors, pattern decisions with rationale)
- Ignore GCA boilerplate, simple acknowledgments, nits, and formatting suggestions
- When a suggestion was DECLINED, the author's rationale is often the most valuable lesson
- Each lesson should be 1-2 sentences capturing WHAT happened and WHY it matters
- Tags should be lowercase, comma-separated, reflecting the technical domain
- If existing lessons are provided, do NOT extract duplicates or near-duplicates
- If no lessons are worth extracting, output exactly: NONE

## Output Format
For each lesson, use this exact delimiter format:

---LESSON---
Tags: tag1, tag2, tag3
The lesson text. One or two sentences capturing the trap/pattern and WHY it matters.
---END---

If no lessons found, output exactly: NONE
`;

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

const GCA_MARKERS = ['Using Gemini Code Assist', 'Gemini Code Assist'];

function isGcaBoilerplate(body: string): boolean {
  return GCA_MARKERS.some((marker) => body.includes(marker));
}

function assemblePrompt(
  pr: StandardPr,
  threads: CommentThread[],
  existingLessons: SearchResult[],
): string {
  const sections: string[] = [SYSTEM_PROMPT];

  // PR metadata
  sections.push('=== PR METADATA ===');
  sections.push(`PR #${pr.number}: ${pr.title}`);
  sections.push(`State: ${pr.state}`);
  if (pr.body) {
    sections.push('');
    sections.push(wrapXml('pr_body', pr.body));
  }

  // Review summaries (non-empty review bodies)
  const reviewBodies = pr.reviews.filter((r) => r.body.trim());
  if (reviewBodies.length > 0) {
    sections.push('\n=== REVIEW SUMMARIES ===');
    for (const r of reviewBodies) {
      sections.push(`[${r.author} — ${r.state}]`);
      sections.push(wrapXml('review_body', r.body));
      sections.push('');
    }
  }

  // Regular PR comments (filter GCA boilerplate)
  const prComments = pr.comments.filter((c) => !isGcaBoilerplate(c.body));
  if (prComments.length > 0) {
    sections.push('\n=== PR COMMENTS ===');
    for (const c of prComments) {
      sections.push(`[${c.author}]`);
      sections.push(wrapXml('comment_body', c.body));
      sections.push('');
    }
  }

  // Inline review comment threads
  if (threads.length > 0) {
    sections.push('\n=== INLINE REVIEW THREADS ===');
    for (const thread of threads) {
      sections.push(`--- ${thread.path} ---`);
      sections.push(wrapXml('diff_hunk', thread.diffHunk));
      for (const c of thread.comments) {
        sections.push(`[${c.author}]:\n${wrapXml('comment_body', c.body)}`);
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

export interface ExtractedLesson {
  tags: string[];
  text: string;
}

const LESSON_RE = /---LESSON---\s*\nTags:\s*(.+)\n([\s\S]+?)---END---/g;

export function parseLessons(llmOutput: string): ExtractedLesson[] {
  if (llmOutput.trim() === 'NONE') return [];

  const lessons: ExtractedLesson[] = [];
  let match: RegExpExecArray | null;

  while ((match = LESSON_RE.exec(llmOutput)) !== null) {
    const tags = match[1]!
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const text = match[2]!.trim();
    if (text) {
      lessons.push({ tags, text });
    }
  }

  return lessons;
}

// ─── Lesson writer ──────────────────────────────────────

export function appendLessons(lessons: ExtractedLesson[], lessonsPath: string): void {
  const dir = path.dirname(lessonsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const entries = lessons
    .map((l) => {
      const timestamp = new Date().toISOString();
      const tags = l.tags.join(', ');
      return `\n## Lesson — ${timestamp}\n\n**Tags:** ${tags}\n\n${l.text}\n`;
    })
    .join('');

  fs.appendFileSync(lessonsPath, entries, 'utf-8');
}

// ─── Main command ───────────────────────────────────────

export interface LearnOptions {
  raw?: boolean;
  out?: string;
  model?: string;
  fresh?: boolean;
  dryRun?: boolean;
  yes?: boolean;
}

export async function learnCommand(prNumber: string, options: LearnOptions): Promise<void> {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // Validate PR number
  const num = parseInt(prNumber, 10);
  if (isNaN(num) || num <= 0) {
    throw new Error(`[Totem Error] Invalid PR number: '${prNumber}'. Must be a positive integer.`);
  }

  // Fetch PR data
  console.error(`[${TAG}] Fetching PR #${num}...`);
  const adapter = new GitHubCliPrAdapter(cwd);
  const pr = adapter.fetchPr(num);
  console.error(`[${TAG}] Title: ${pr.title}`);

  // Fetch inline review comments
  console.error(`[${TAG}] Fetching review comments...`);
  const reviewComments = adapter.fetchReviewComments(num);
  console.error(`[${TAG}] Found ${reviewComments.length} inline review comments`);

  // Filter GCA boilerplate from inline comments
  const filteredComments = reviewComments.filter((c) => !isGcaBoilerplate(c.body));

  // Early exit if no review content
  const hasReviewContent =
    pr.reviews.some((r) => r.body.trim()) ||
    pr.comments.some((c) => !isGcaBoilerplate(c.body)) ||
    filteredComments.length > 0;

  if (!hasReviewContent) {
    console.error(`[${TAG}] No review content found in PR #${num}. Nothing to extract.`);
    return;
  }

  // Group inline comments into threads
  const threads = groupIntoThreads(filteredComments);
  console.error(`[${TAG}] Grouped into ${threads.length} review threads`);

  // Connect to LanceDB for dedup context
  const embedder = createEmbedder(config.embedding);
  const store = new LanceStore(path.join(cwd, config.lanceDir), embedder);
  await store.connect();

  console.error(`[${TAG}] Querying existing lessons for dedup...`);
  const existingLessons = await retrieveExistingLessons(store);
  console.error(`[${TAG}] Found ${existingLessons.length} existing lessons for context`);

  // Assemble prompt
  const prompt = assemblePrompt(pr, threads, existingLessons);
  console.error(`[${TAG}] Prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

  // Run orchestrator (handles --raw mode, validation, invocation, telemetry)
  const content = runOrchestrator({ prompt, tag: TAG, options, config, cwd });
  if (content == null) return; // --raw mode handled

  // Parse lessons from LLM output
  const lessons = parseLessons(content);

  if (lessons.length === 0) {
    console.error(`[${TAG}] No lessons extracted from PR #${num}.`);
    return;
  }

  console.error(`[${TAG}] Extracted ${lessons.length} lesson(s)`);

  // Display extracted lessons for review
  console.error('');
  console.error(
    `[${TAG}] ⚠ WARNING: These lessons were extracted from PR comments, which may include content from untrusted contributors.`,
  );
  console.error(`[${TAG}] Review each lesson carefully before accepting.\n`);

  for (let i = 0; i < lessons.length; i++) {
    const lesson = lessons[i]!;
    console.error(`  [${i + 1}] Tags: ${lesson.tags.join(', ')}`);
    console.error(`      ${lesson.text}`);
    console.error('');
  }

  // --dry-run mode: preview lessons without writing
  if (options.dryRun) {
    console.error(`[${TAG}] Dry run — lessons not written.`);
    return;
  }

  // Confirmation gate
  if (!options.yes) {
    if (!process.stdin.isTTY) {
      throw new Error(
        `[Totem Error] Refusing to write lessons in non-interactive mode. Use --yes to bypass confirmation.`,
      );
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    try {
      const answer = await rl.question(
        `[${TAG}] Write ${lessons.length} lesson(s) to lessons.md? [Y/n] `,
      );
      if (answer.trim().toLowerCase() === 'n') {
        console.error(`[${TAG}] Aborted — no lessons written.`);
        return;
      }
    } finally {
      rl.close();
    }
  }

  // Append lessons to .totem/lessons.md
  const lessonsPath = path.join(cwd, config.totemDir, 'lessons.md');
  appendLessons(lessons, lessonsPath);
  console.error(`[${TAG}] Appended ${lessons.length} lesson(s) to ${config.totemDir}/lessons.md`);

  // Run incremental sync so lessons are immediately searchable
  console.error(`[${TAG}] Running incremental sync...`);
  const syncResult = await runSync(config, {
    projectRoot: cwd,
    incremental: true,
    onProgress: (msg) => console.error(`[${TAG}] ${msg}`),
  });
  console.error(
    `[${TAG}] Sync complete: ${syncResult.chunksProcessed} chunks from ${syncResult.filesProcessed} files`,
  );

  // Print summary
  console.log(`\nExtracted ${lessons.length} lesson(s) from PR #${num}:`);
  for (const lesson of lessons) {
    console.log(`\n  Tags: ${lesson.tags.join(', ')}`);
    console.log(`  ${lesson.text}`);
  }
}
