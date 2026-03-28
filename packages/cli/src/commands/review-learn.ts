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

import type { StandardReviewComment } from '../adapters/pr-adapter.js';
import type { NormalizedBotFinding } from '../parsers/bot-review-parser.js';
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
// Reuse parsing and selection helpers from extract (they are exported)
import { parseLessons, selectLessons } from './extract.js';
import {
  MAX_EXISTING_LESSONS,
  MAX_PROMPT_CHARS,
  REVIEW_LEARN_SYSTEM_PROMPT,
} from './review-learn-templates.js';

const TAG = 'ReviewLearn';

// ─── Thread grouping (mirrors extract.ts — not exported there) ──

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

// ─── LanceDB retrieval ───────────────────────────────

async function retrieveExistingLessons(store: LanceStore): Promise<SearchResult[]> {
  return store.search({
    query: 'lesson trap pattern decision',
    typeFilter: 'spec',
    maxResults: MAX_EXISTING_LESSONS,
  });
}

// ─── Prompt assembly ─────────────────────────────────

export function assembleReviewLearnPrompt(
  findings: NormalizedBotFinding[],
  existingLessons: SearchResult[],
  systemPrompt: string,
): string {
  const sections: string[] = [systemPrompt];

  sections.push('\n=== RESOLVED BOT FINDINGS ===');
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i]!;
    sections.push(`\n--- Finding ${i + 1} [${f.tool}/${f.severity}] ${sanitize(f.file)} ---`);
    sections.push(wrapUntrustedXml('finding_body', f.body));
    if (f.suggestion) {
      sections.push('Suggestion:');
      sections.push(wrapUntrustedXml('suggestion', f.suggestion));
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
  if (prompt.length > MAX_PROMPT_CHARS) {
    prompt = prompt.slice(0, MAX_PROMPT_CHARS) + '\n\n... [content truncated] ...';
  }

  return prompt;
}

// ─── Nursery lesson writer ───────────────────────────

/**
 * Append lessons with `lifecycle: nursery` YAML frontmatter.
 * Wraps each lesson entry with frontmatter before writing.
 */
function appendNurseryLessons(lessons: ExtractedLesson[], lessonsDir: string): void {
  for (const l of lessons) {
    const heading = l.heading || generateLessonHeading(l.text);
    const tags = l.tags;

    // Build YAML frontmatter with lifecycle: nursery
    const frontmatter = [
      '---',
      `tags: [${tags.map((t) => `"${t}"`).join(', ')}]`,
      'lifecycle: nursery',
      '---',
    ].join('\n');

    const body = `## Lesson — ${truncateHeading(heading) || 'Lesson'}\n\n**Tags:** ${tags.join(', ')}\n\n${l.text}\n`;
    const entry = `${frontmatter}\n\n${body}`;
    writeLessonFile(lessonsDir, entry);
  }
}

// ─── Main command ────────────────────────────────────

export interface ReviewLearnOptions {
  raw?: boolean;
  out?: string;
  model?: string;
  fresh?: boolean;
  dryRun?: boolean;
  yes?: boolean;
}

export async function reviewLearnCommand(
  prNumber: string,
  options: ReviewLearnOptions,
): Promise<void> {
  const path = await import('node:path');
  const { GitHubCliPrAdapter } = await import('../adapters/github-cli-pr.js');
  const { isBotComment, extractResolvedBotFindings } =
    await import('../parsers/bot-review-parser.js');

  // 1. Parse and validate PR number
  const num = parseInt(prNumber, 10);
  if (isNaN(num) || num <= 0 || String(num) !== prNumber) {
    throw new TotemConfigError(
      `Invalid PR number: '${prNumber}'. Must be a positive integer.`,
      'Pass a numeric PR number, e.g. `totem review-learn 123`.',
      'CONFIG_INVALID',
    );
  }

  // 2. Load config, env, connect to LanceDB for dedup
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  loadEnv(cwd);
  const config = await loadConfig(configPath);

  // Load user-defined custom secrets for DLP (#921)
  const customSecrets = loadCustomSecrets(cwd, config.totemDir, (msg) => log.warn(TAG, msg));

  // Connect to LanceDB for dedup context
  const embedding = requireEmbedding(config);
  const embedder = createEmbedder(embedding);
  const store = new LanceStore(path.join(cwd, config.lanceDir), embedder);
  await store.connect();

  log.info(TAG, 'Querying existing lessons for dedup...');
  const existingLessons = await retrieveExistingLessons(store);
  log.info(TAG, `Found ${existingLessons.length} existing lessons for context`);

  // 3. Fetch PR — error if not MERGED/CLOSED
  log.info(TAG, `Fetching PR #${num}...`);
  const adapter = new GitHubCliPrAdapter(cwd);
  const pr = adapter.fetchPr(num);
  log.info(TAG, `Title: ${pr.title}`);

  const prState = pr.state.toUpperCase();
  if (prState !== 'MERGED' && prState !== 'CLOSED') {
    throw new TotemConfigError(
      `PR #${num} is ${pr.state}. review-learn only works on merged or closed PRs.`,
      'Wait for the PR to be merged, or use `totem extract` for open PRs.',
      'CONFIG_INVALID',
    );
  }

  // 4. Fetch review comments
  log.info(TAG, 'Fetching review comments...');
  const reviewComments = adapter.fetchReviewComments(num);
  log.info(TAG, `Found ${reviewComments.length} inline review comments`);

  // 4b. Extract findings from CodeRabbit review bodies (outside-diff + nits)
  const { extractReviewBodyFindings } = await import('../parsers/bot-review-parser.js');
  const reviewBodyFindings = extractReviewBodyFindings(pr.reviews);
  if (reviewBodyFindings.length > 0) {
    log.info(TAG, `Found ${reviewBodyFindings.length} finding(s) in review bodies`);
  }

  // 5. Group ALL comments into threads first (need human replies for resolution detection)
  const allThreads = groupIntoThreads(reviewComments);

  // 6. Filter to threads that START with a bot comment
  const threads = allThreads.filter(
    (t) => t.comments.length > 0 && isBotComment(t.comments[0]!.author),
  );
  if (threads.length === 0 && reviewBodyFindings.length === 0) {
    log.dim(TAG, 'No bot review comments found. Nothing to learn from.');
    return;
  }
  if (threads.length > 0) {
    log.info(TAG, `Found ${threads.length} bot review thread(s)`);
  }

  // 7. Apply resolution filter
  const findings = extractResolvedBotFindings(threads);

  // Append review body findings (treat as actionable — no thread/reply to check resolution on)
  findings.push(...reviewBodyFindings);

  // 7b. Track pushback findings in exemption engine (false positive signals)
  const { extractPushbackFindings } = await import('../parsers/bot-review-parser.js');
  const pushbackFindings = extractPushbackFindings(threads);
  if (pushbackFindings.length > 0) {
    log.dim(
      TAG,
      `Found ${pushbackFindings.length} pushback finding(s) — tracking for exemption engine`,
    );
    try {
      const pathMod = await import('node:path');
      const resolvedTotemDir = pathMod.join(cwd, config.totemDir);
      const cacheDir = pathMod.join(resolvedTotemDir, 'cache');
      const {
        readLocalExemptions,
        writeLocalExemptions,
        readSharedExemptions,
        writeSharedExemptions,
      } = await import('../exemptions/exemption-store.js');
      const { computePatternId, recordFalsePositive, promoteToShared } =
        await import('../exemptions/exemption-engine.js');
      const { PROMOTION_THRESHOLD } = await import('../exemptions/exemption-schema.js');

      let localExemptions = readLocalExemptions(cacheDir, (msg) => log.dim(TAG, msg));
      let shared = readSharedExemptions(resolvedTotemDir, (msg) => log.dim(TAG, msg));
      let promotedAny = false;

      for (const pf of pushbackFindings) {
        const pid = computePatternId(pf.body);
        const { updatedLocal, promoted } = recordFalsePositive(
          localExemptions,
          pid,
          'bot',
          pf.body,
        );
        localExemptions = updatedLocal;
        if (promoted) {
          shared = promoteToShared(shared, pid, updatedLocal.patterns[pid]!);
          promotedAny = true;
          log.warn(
            TAG,
            `Bot pattern auto-suppressed after ${PROMOTION_THRESHOLD} pushbacks: ${pf.body.slice(0, 80)}`,
          );
        }
      }

      writeLocalExemptions(cacheDir, localExemptions, (msg) => log.dim(TAG, msg));
      if (promotedAny) {
        writeSharedExemptions(resolvedTotemDir, shared, (msg) => log.dim(TAG, msg));
        const { appendLedgerEvent } = await import('@mmnto/totem');
        appendLedgerEvent(
          resolvedTotemDir,
          {
            timestamp: new Date().toISOString(),
            type: 'exemption',
            ruleId: 'exemption-promoted',
            file: '(review-learn)',
            justification: `Auto-promoted after ${PROMOTION_THRESHOLD} bot false positives`,
            source: 'shield',
          },
          (msg) => log.dim(TAG, msg),
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.dim(TAG, `Exemption tracking failed (non-fatal): ${msg}`);
    }
  }

  if (findings.length === 0) {
    log.dim(TAG, 'No resolved bot findings found. Only fixed findings produce lessons.');
    return;
  }
  log.info(TAG, `Found ${findings.length} resolved bot finding(s)`);

  // 8. Resolve system prompt (allow .totem/prompts/review-learn.md override)
  const systemPrompt = getSystemPrompt(
    'review-learn',
    REVIEW_LEARN_SYSTEM_PROMPT,
    cwd,
    config.totemDir,
  );

  // 9. Assemble prompt
  const prompt = assembleReviewLearnPrompt(findings, existingLessons, systemPrompt);
  log.dim(TAG, `Prompt: ${(prompt.length / 1024).toFixed(0)}KB`);

  // 10. Run orchestrator
  const content = await runOrchestrator({
    prompt,
    tag: TAG,
    options,
    config,
    cwd,
    temperature: 0.4,
    customSecrets,
  });
  if (content == null) return; // --raw mode — prompt already output

  // 11. Parse lessons from LLM output
  const lessons = parseLessons(content);

  if (lessons.length === 0) {
    log.dim(TAG, 'No lessons extracted from resolved bot findings.');
    return;
  }
  log.success(TAG, `Extracted ${lessons.length} lesson(s)`);

  // 12. Semantic dedup against existing lessons and intra-batch
  log.info(TAG, 'Deduplicating against existing lessons...');
  const { kept: novelLessons, dropped: dupLessons } = await deduplicateLessons(
    lessons,
    store,
    embedder,
  );
  if (dupLessons.length > 0) {
    log.dim(TAG, `Dropped ${dupLessons.length} semantically duplicate lesson(s)`);
  }

  if (novelLessons.length === 0) {
    log.dim(TAG, 'All extracted lessons are duplicates of existing ones.');
    return;
  }

  // 13. Flag suspicious lessons
  const flaggedLessons = flagSuspiciousLessons(novelLessons);
  const suspiciousCount = flaggedLessons.filter((l) => l.suspiciousFlags?.length).length;
  if (suspiciousCount > 0) {
    log.warn(TAG, `${suspiciousCount} lesson(s) flagged as suspicious`);
  }

  log.success(TAG, `Total: ${flaggedLessons.length} nursery lesson(s) from PR #${num}`);

  // --dry-run mode: preview lessons to stdout without writing
  if (options.dryRun) {
    log.dim(TAG, 'Dry run — lessons not written.');
    for (const lesson of flaggedLessons) {
      const prefix = lesson.suspiciousFlags?.length ? '[!] ' : '';
      console.log(`\n  ${prefix}Tags: ${sanitize(lesson.tags.join(', ')).replace(/\n/g, ' ')}`); // totem-ignore — stdout for piping
      console.log(`  Lifecycle: nursery`); // totem-ignore — stdout for piping
      console.log(`  ${sanitize(lesson.text).replace(/\n/g, '\n  ')}`); // totem-ignore — stdout for piping
      if (lesson.suspiciousFlags?.length) {
        for (const flag of lesson.suspiciousFlags) {
          console.log(`  [!] ${flag}`); // totem-ignore — stdout for piping
        }
      }
    }
    if (options.yes && suspiciousCount > 0) {
      process.exitCode = 1;
    }
    return;
  }

  // 14. Interactive selection
  if (!options.yes) {
    console.error('');
    log.warn(
      TAG,
      'WARNING: These lessons were extracted from bot review comments. Review each carefully before accepting.',
    );
    log.warn(
      TAG,
      'All accepted lessons will have lifecycle: nursery (unproven until validated).\n',
    );

    for (let i = 0; i < flaggedLessons.length; i++) {
      const lesson = flaggedLessons[i]!;
      const prefix = lesson.suspiciousFlags?.length ? `[!] ` : '';
      console.error(
        `  [${i + 1}] ${prefix}Tags: ${sanitize(lesson.tags.join(', ')).replace(/\n/g, ' ')}`,
      );
      console.error(`      Lifecycle: nursery`);
      console.error(`      ${sanitize(lesson.text).replace(/\n/g, '\n      ')}`);
      if (lesson.suspiciousFlags?.length) {
        for (const flag of lesson.suspiciousFlags) {
          console.error(`      [!] ${flag}`);
        }
      }
      console.error('');
    }
  }

  const selected = await selectLessons(flaggedLessons, {
    yes: options.yes,
    isTTY: !!process.stdin.isTTY,
  });

  if (selected.length === 0) {
    log.dim(TAG, 'No lessons selected — nothing written.');
    return;
  }

  // Sanitize before persisting
  const sanitizedLessons = selected.map((l) => ({
    tags: l.tags.map((t) => sanitize(t)),
    text: sanitize(l.text),
    heading: l.heading,
  }));

  // 15. Write lessons with lifecycle: nursery frontmatter
  const lessonsDir = path.join(cwd, config.totemDir, 'lessons');
  appendNurseryLessons(sanitizedLessons, lessonsDir);
  log.success(
    TAG,
    `Appended ${sanitizedLessons.length} nursery lesson(s) to ${config.totemDir}/lessons/`,
  ); // totem-ignore

  // 16. Incremental sync
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
  console.log(`\nExtracted ${sanitizedLessons.length} nursery lesson(s) from PR #${num}:`);
  for (const lesson of sanitizedLessons) {
    console.log(`\n  Tags: ${lesson.tags.join(', ').replace(/\n/g, ' ')}`);
    console.log(`  Lifecycle: nursery`);
    console.log(`  ${lesson.text.replace(/\n/g, '\n  ')}`);
  }

  // Exit non-zero if --yes mode dropped suspicious lessons
  if (options.yes && suspiciousCount > 0) {
    process.exitCode = 1;
  }
}
