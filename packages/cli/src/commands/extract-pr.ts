import type { ExtractedLesson, SearchResult, TotemConfig } from '@mmnto/totem';
import { createEmbedder, LanceStore, loadCustomSecrets } from '@mmnto/totem';

import type { StandardPr, StandardReviewComment } from '../adapters/pr-adapter.js';
import { log } from '../ui.js';
import {
  getSystemPrompt,
  GH_TIMEOUT_MS,
  requireEmbedding,
  runOrchestrator,
  sanitize,
  wrapUntrustedXml,
} from '../utils.js';
import type { ExtractOptions } from './extract-shared.js';
import {
  assembleExtractPrompt,
  parseLessons,
  retrieveExistingLessons,
  TAG,
} from './extract-shared.js';
import { SYSTEM_PROMPT } from './extract-templates.js';

// ─── Thread grouping ───────────────────────────────────

interface CommentThread {
  path: string;
  diffHunk: string;
  comments: { id?: number; author: string; body: string }[];
}

export function groupIntoThreads(comments: StandardReviewComment[]): CommentThread[] {
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
      comments: threadComments.map((c) => ({ id: c.id, author: c.author, body: c.body })),
    });
  }

  return threads;
}

// ─── GCA boilerplate filter ────────────────────────────

export const DEFAULT_BOT_MARKERS: readonly string[] = [
  'Using Gemini Code Assist',
  'Gemini Code Assist',
];

export function isGcaBoilerplate(body: string, botMarkers: readonly string[]): boolean {
  return botMarkers.some((marker) => body.includes(marker));
}

// ─── PR prompt assembly ────────────────────────────────

export function assemblePrompt(
  pr: StandardPr,
  threads: CommentThread[],
  existingLessons: SearchResult[],
  systemPrompt: string,
  nits?: string[],
  botMarkers: readonly string[] = DEFAULT_BOT_MARKERS,
  scopeGlobs?: string[],
): string {
  const contentSections: string[] = [];

  // Scope context from PR diff analysis (#1014) — globs derived from PR filenames (untrusted)
  if (scopeGlobs && scopeGlobs.length > 0) {
    contentSections.push('\n=== SCOPE CONTEXT (from PR diff analysis) ===');
    contentSections.push(
      wrapUntrustedXml('scope_context', `Suggested file scope: ${scopeGlobs.join(', ')}`),
    );
    contentSections.push('Use this scope as the default unless a lesson truly applies globally.');
    contentSections.push(
      'Include a "scope" field in each lesson JSON with the appropriate glob pattern.',
    );
  }

  // PR metadata — sanitize untrusted fields (title, state come from PR author)
  contentSections.push('=== PR METADATA ===');
  contentSections.push(`PR #${pr.number}: ${sanitize(pr.title)}`);
  contentSections.push(`State: ${sanitize(pr.state)}`);
  if (pr.body) {
    contentSections.push('');
    contentSections.push(wrapUntrustedXml('pr_body', pr.body));
  }

  // Review summaries (non-empty review bodies)
  const reviewBodies = pr.reviews.filter((r) => r.body.trim());
  if (reviewBodies.length > 0) {
    contentSections.push('\n=== REVIEW SUMMARIES ===');
    for (const r of reviewBodies) {
      contentSections.push(`[${sanitize(r.author)} — ${sanitize(r.state)}]`);
      contentSections.push(wrapUntrustedXml('review_body', r.body));
      contentSections.push('');
    }
  }

  // CodeRabbit nits (pre-parsed and passed in)
  if (nits && nits.length > 0) {
    contentSections.push('\n=== CODERABBIT NITS (extract valuable architectural insights) ===');
    for (const nit of nits) {
      contentSections.push(wrapUntrustedXml('nit_body', nit));
    }
  }

  // Regular PR comments (filter GCA boilerplate)
  const prComments = pr.comments.filter((c) => !isGcaBoilerplate(c.body, botMarkers));
  if (prComments.length > 0) {
    contentSections.push('\n=== PR COMMENTS ===');
    for (const c of prComments) {
      contentSections.push(`[${sanitize(c.author)}]`);
      contentSections.push(wrapUntrustedXml('comment_body', c.body));
      contentSections.push('');
    }
  }

  // Inline review comment threads
  if (threads.length > 0) {
    contentSections.push('\n=== INLINE REVIEW THREADS ===');
    for (const thread of threads) {
      contentSections.push(`--- ${sanitize(thread.path)} ---`); // totem-ignore — thread.path is untrusted PR data, not local git
      contentSections.push(wrapUntrustedXml('diff_hunk', thread.diffHunk));
      for (const c of thread.comments) {
        contentSections.push(
          `[${sanitize(c.author)}]:\n${wrapUntrustedXml('comment_body', c.body)}`,
        );
      }
      contentSections.push('');
    }
  }

  return assembleExtractPrompt(systemPrompt, contentSections, existingLessons);
}

// ─── PR extraction ─────────────────────────────────────

export async function extractFromPrs(
  nums: number[],
  options: ExtractOptions,
  config: TotemConfig,
  cwd: string,
  configRoot: string,
): Promise<ExtractedLesson[]> {
  const path = await import('node:path');
  const { GitHubCliPrAdapter } = await import('../adapters/github-cli-pr.js');

  const customSecrets = loadCustomSecrets(cwd, config.totemDir, (msg) => log.warn(TAG, msg));
  const botMarkers: readonly string[] = config.botMarkers ?? DEFAULT_BOT_MARKERS;
  const systemPrompt = getSystemPrompt('extract', SYSTEM_PROMPT, cwd, config.totemDir);
  const adapter = new GitHubCliPrAdapter(cwd);

  // Connect to LanceDB for dedup context
  const embedding = requireEmbedding(config);
  const embedder = createEmbedder(embedding);
  const store = new LanceStore(path.join(cwd, config.lanceDir), embedder);
  await store.connect();

  log.info(TAG, 'Querying existing lessons for dedup...');
  const existingLessons = await retrieveExistingLessons(store);
  log.info(TAG, `Found ${existingLessons.length} existing lessons for context`);

  const allLessons: ExtractedLesson[] = [];

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

    // Scope inference (#1014): analyze PR changed files for scope suggestion
    let scopeGlobs: string[] = [];
    try {
      const { safeExec: exec, inferScopeFromFiles } = await import('@mmnto/totem');
      const diff = exec('gh', ['pr', 'diff', String(num), '--name-only'], {
        cwd,
        timeout: GH_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024, // 10MB for large PRs
        env: { ...process.env, GH_PROMPT_DISABLED: '1' },
      });
      const files = diff.trim().split(/\r?\n/).filter(Boolean);
      scopeGlobs = inferScopeFromFiles(files);
      if (scopeGlobs.length > 0) {
        log.dim(TAG, `Inferred scope: ${scopeGlobs.join(', ')}`);
      }
    } catch (err) {
      log.dim(TAG, `Skipping scope inference: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Assemble prompt
    const prompt = assemblePrompt(
      pr,
      threads,
      existingLessons,
      systemPrompt,
      prNits,
      botMarkers,
      scopeGlobs,
    );
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

  return allLessons;
}
