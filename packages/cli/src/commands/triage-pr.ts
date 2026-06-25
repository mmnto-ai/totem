/**
 * `totem triage-pr <pr-number>` — Categorized triage view of bot review
 * comments on a pull request.
 *
 * Fetches inline review comments, filters to bot authors, normalizes
 * into structured findings, deduplicates, categorizes by blast radius,
 * and renders a compact inbox to stdout.
 */

import type { StandardIssueComment, StandardReviewComment } from '../adapters/pr-adapter.js';
import type { BotTool, NormalizedBotFinding } from '../parsers/bot-review-parser.js';
import type { CategorizedFinding, TriageCategory } from '../parsers/triage-types.js';

// ─── Constants ───────────────────────────────────────

const TAG = 'TriagePR';

// ─── Thread grouping (mirrors review-learn.ts) ──────

interface CommentThread {
  path: string;
  diffHunk: string;
  comments: { id?: number; author: string; body: string }[];
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
      comments: threadComments.map((c) => ({ id: c.id, author: c.author, body: c.body })),
    });
  }

  return threads;
}

// ─── Bot finding normalization ───────────────────────

/**
 * Normalize all bot comment threads into structured findings.
 * Unlike extractResolvedBotFindings, this includes ALL bot findings
 * (not just resolved ones) — triage wants the full picture.
 */
function normalizeBotFindings(
  threads: CommentThread[],
  isBotComment: (author: string) => boolean,
  detectBot: (author: string) => BotTool,
  parseSeverityForTool: (tool: BotTool, body: string) => string,
  stripHtmlWrappers: (html: string) => string,
  extractSuggestion: (body: string) => string | undefined,
): NormalizedBotFinding[] {
  const findings: NormalizedBotFinding[] = [];

  for (const thread of threads) {
    const botComment = thread.comments[0];
    if (!botComment || !isBotComment(botComment.author)) continue;

    const tool = detectBot(botComment.author);
    const severity = parseSeverityForTool(tool, botComment.body);

    const body = stripHtmlWrappers(botComment.body);
    const suggestion = extractSuggestion(botComment.body);

    // Extract line number from diff hunk header (@@ -a,b +c,d @@)
    const hunkMatch = thread.diffHunk.match(/@@ .+?\+(\d+)/);
    const line = hunkMatch ? parseInt(hunkMatch[1]!, 10) : undefined;

    // Check for human replies (for resolution signal)
    const humanReplies = thread.comments.slice(1).filter((c) => !isBotComment(c.author));
    const resolutionSignal: 'reply' | 'none' = humanReplies.length > 0 ? 'reply' : 'none';

    findings.push({
      tool,
      severity,
      file: thread.path,
      line,
      body,
      suggestion,
      resolutionSignal,
      rootCommentId: botComment.id,
    });
  }

  return findings;
}

// ─── Output formatting ──────────────────────────────

/** Category display config: header emoji, label, and color function name */
interface CategoryConfig {
  emoji: string;
  label: string;
  colorFn: 'red' | 'yellow' | 'blue' | 'gray';
}

const CATEGORY_ORDER: TriageCategory[] = ['security', 'architecture', 'convention', 'nit'];

const CATEGORY_CONFIG: Record<TriageCategory, CategoryConfig> = {
  security: { emoji: '\u{1F534}', label: 'SECURITY', colorFn: 'red' },
  architecture: { emoji: '\u{1F7E1}', label: 'ARCHITECTURE', colorFn: 'yellow' },
  convention: { emoji: '\u{1F535}', label: 'CONVENTION', colorFn: 'blue' },
  nit: { emoji: '\u26AA', label: 'NITS', colorFn: 'gray' },
};

/** Compact display abbreviation for a bot tool (`??` for an unrecognized one). */
function toolAbbrev(tool: BotTool): string {
  switch (tool) {
    case 'coderabbit':
      return 'CR';
    case 'gca':
      return 'GCA';
    case 'greptile':
      return 'GT';
    default:
      return '??';
  }
}

/** Format bot attribution string like [CR/minor, GCA/medium] */
function formatBotAttribution(finding: CategorizedFinding): string {
  const entries: string[] = [];

  // Primary finding
  entries.push(`${toolAbbrev(finding.tool)}/${finding.severity}`);

  // Merged findings
  if (finding.mergedWith) {
    for (const m of finding.mergedWith) {
      entries.push(`${toolAbbrev(m.tool)}/${m.severity}`);
    }
  }

  return `[${entries.join(', ')}]`;
}

/** Truncate body to a concise one-liner for display */
function summarizeBody(body: string): string {
  // Take first meaningful line, strip markdown
  const firstLine = body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('<!--'));

  if (!firstLine) return body.slice(0, 80);

  const cleaned = firstLine
    .replace(/\*\*/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

  return cleaned.length > 80 ? cleaned.slice(0, 77) + '...' : cleaned;
}

/** Format the file:line location string */
function formatLocation(finding: CategorizedFinding): string {
  if (finding.line != null) {
    return `${finding.file}:${finding.line}`;
  }
  return finding.file;
}

/** Surface counts feeding the empty-state decision. */
export interface TriageSurfaceCounts {
  /** Inline comment threads whose root author is a recognized review bot. */
  botThreads: number;
  /** Findings parsed from review-bodies + bot issue-comment summaries. */
  bodyFindings: number;
  /** Bot-authored issue comments fetched (summaries), regardless of parsed findings. */
  botIssueComments: number;
  /** Total inline review comments fetched (any author). */
  inlineComments: number;
  /** Total review submissions fetched (any author). */
  reviews: number;
  /** Total issue comments fetched (any author). */
  issueComments: number;
}

/**
 * Decide whether there is anything to triage, and — when not — what to report.
 *
 * Invariant (mmnto-ai/totem#2192): triage is "empty" ONLY when zero bot material
 * was found across every surface (inline bot threads + parsed body/summary
 * findings + bot summary issue-comments). When raw comments WERE fetched but none
 * came from a recognized bot, the message surfaces the counts rather than a bare
 * "Nothing to triage", so a stale/incomplete classifier can never masquerade as a
 * clean PR (the #2190 miss). Pure + exported for testing.
 */
export function evaluateTriageEmptyState(counts: TriageSurfaceCounts): {
  empty: boolean;
  message?: string;
  /** True when raw material existed (→ log visibly), false when the PR was truly bare. */
  surfaced?: boolean;
} {
  const botMaterial = counts.botThreads + counts.bodyFindings + counts.botIssueComments;
  if (botMaterial > 0) return { empty: false };

  const rawFetched = counts.inlineComments + counts.reviews + counts.issueComments;
  if (rawFetched === 0) {
    return {
      empty: true,
      surfaced: false,
      message: 'Nothing to triage — no comments, reviews, or issue-comments on this PR.',
    };
  }
  return {
    empty: true,
    surfaced: true,
    message:
      `Fetched ${counts.inlineComments} inline comment(s), ${counts.reviews} review(s), ` +
      `${counts.issueComments} issue-comment(s) — none from a recognized review bot. ` +
      `Nothing to triage (no bot findings).`,
  };
}

/**
 * Format the complete triage output. Exported for testing.
 */
export function formatTriageOutput(
  prNumber: number,
  findings: CategorizedFinding[],
  totalComments: number,
  colorize: {
    red: (s: string) => string;
    yellow: (s: string) => string;
    blue: (s: string) => string;
    gray: (s: string) => string;
    bold: (s: string) => string;
  },
): string {
  const lines: string[] = [];

  // Header
  lines.push(colorize.bold(`PR #${prNumber} Bot Review Summary`));
  lines.push(
    `${findings.length} distinct finding${findings.length === 1 ? '' : 's'} across ${totalComments} comment${totalComments === 1 ? '' : 's'}`,
  );
  lines.push('');

  // Group by category
  const grouped = new Map<TriageCategory, CategorizedFinding[]>();
  for (const f of findings) {
    const group = grouped.get(f.triageCategory) ?? [];
    group.push(f);
    grouped.set(f.triageCategory, group);
  }

  // Global finding counter (across all categories)
  let findingIndex = 1;

  for (const category of CATEGORY_ORDER) {
    const group = grouped.get(category);
    if (!group || group.length === 0) continue;

    const config = CATEGORY_CONFIG[category];
    const colorFn = colorize[config.colorFn];

    // Category header
    lines.push(
      colorFn(
        `${config.emoji} ${config.label} (${group.length} finding${group.length === 1 ? '' : 's'})`,
      ),
    );

    for (const finding of group) {
      const mergedCount = finding.mergedWith?.length ?? 0;
      const attribution = formatBotAttribution(finding);

      if (mergedCount > 0) {
        // Merged finding — show index range and file list
        const startIdx = findingIndex;
        const endIdx = findingIndex + mergedCount;
        const indices = Array.from({ length: mergedCount + 1 }, (_, i) => startIdx + i).join(',');

        // Collect all unique files
        const allFiles = [formatLocation(finding)];
        for (const m of finding.mergedWith!) {
          const loc = m.line != null ? `${m.file}:${m.line}` : m.file;
          allFiles.push(loc);
        }

        const summary = summarizeBody(finding.body);
        lines.push(
          `  [${indices}] (merged)${' '.repeat(Math.max(1, 8 - '(merged)'.length))}${summary} (${allFiles.join(', ')}) ${attribution}`,
        );

        findingIndex = endIdx + 1;
      } else {
        // Single finding
        const location = formatLocation(finding);
        const padded = location.padEnd(16);
        const summary = summarizeBody(finding.body);

        lines.push(`  [${findingIndex}] ${padded}${summary} ${attribution}`);
        findingIndex++;
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

// ─── Main command ────────────────────────────────────

export interface TriagePrOptions {
  interactive?: boolean;
}

export async function triagePrCommand(
  prNumber: string,
  options: TriagePrOptions = {},
): Promise<void> {
  const pc = await import('picocolors');
  const { TotemConfigError } = await import('@mmnto/totem');
  const { GitHubCliPrAdapter } = await import('../adapters/github-cli-pr.js');
  const { log } = await import('../ui.js');
  const {
    isBotComment,
    detectBot,
    parseSeverityForTool,
    stripHtmlWrappers,
    extractSuggestion,
    parseGreptileConfidence,
  } = await import('../parsers/bot-review-parser.js');
  const { deduplicateFindings } = await import('../parsers/triage-dedup.js');

  // 1. Parse and validate PR number
  const num = parseInt(prNumber, 10);
  if (isNaN(num) || num <= 0 || String(num) !== prNumber) {
    throw new TotemConfigError(
      `Invalid PR number: '${prNumber}'. Must be a positive integer.`,
      'Pass a numeric PR number, e.g. `totem triage-pr 123`.',
      'CONFIG_INVALID',
    );
  }

  const cwd = process.cwd();

  // 2. Fetch PR data
  log.info(TAG, `Fetching PR #${num}...`);
  const adapter = new GitHubCliPrAdapter(cwd);
  const pr = adapter.fetchPr(num);
  log.info(TAG, `Title: ${pr.title}`);

  // 3. Fetch review comments
  log.info(TAG, 'Fetching review comments...');
  const reviewComments = adapter.fetchReviewComments(num);
  log.info(TAG, `Found ${reviewComments.length} inline review comments`);

  // 3b. Extract findings from review-bot SUMMARY surfaces:
  //   - review submission bodies (CodeRabbit outside-diff + nits) from `pr.reviews`
  //   - PR issue comments (greptile "Comments Outside Diff" summary) via `gh api`,
  //     which preserves the `[bot]` suffix + `user.type` that `gh pr view` strips,
  //     so the conservative greptile bot-login regex actually matches the summary.
  const { extractReviewBodyFindings } = await import('../parsers/bot-review-parser.js');
  const reviewBodyFindings = extractReviewBodyFindings(pr.reviews);

  // `fetchIssueComments` is optional on the adapter interface — guard for adapters
  // and test doubles that don't implement it. Wrap the call so an issue-comment
  // fetch failure (network / rate-limit / creds) DEGRADES GRACEFULLY — warn and
  // continue with inline + review-body triage rather than crashing the whole
  // command (Tenet 4 + the failure-recovery design in .totem/specs/2192.md;
  // gemini High on #2246).
  let issueComments: StandardIssueComment[] = [];
  if (adapter.fetchIssueComments) {
    try {
      issueComments = adapter.fetchIssueComments(num);
      // totem-context: intentional fail-soft-but-named (Tenet 4) — logged loudly via log.warn then continue with inline + review-body triage; never silent. Re-throwing would crash the command on a non-critical surface (gemini High #2246; failure-recovery design in 2192.md).
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(TAG, `Could not fetch issue-comments: ${msg}; triaging inline + review-body only.`);
    }
  }
  // Filter to RECOGNIZED review bots only. The `gh api` route preserves the
  // `[bot]` suffix, so `isBotComment` matches CR/GCA/greptile reliably — using
  // the broad `authorType === 'Bot'` would pull in non-review automation
  // (dependabot/renovate/github-actions), falsely suppressing "Nothing to triage"
  // and mislabeling them `unknown` (gemini + CR + greptile review on #2246).
  const botIssueComments = issueComments.filter((c) => isBotComment(c.author));
  const issueCommentFindings = extractReviewBodyFindings(
    botIssueComments.map((c) => ({ author: c.author, body: c.body })),
  );

  const bodyFindings = [...reviewBodyFindings, ...issueCommentFindings];
  if (bodyFindings.length > 0) {
    log.info(TAG, `Found ${bodyFindings.length} finding(s) in review/issue-comment bodies`);
  }

  // Surface greptile's documented merge-readiness Confidence Score (N/5) as a
  // triage CONTEXT signal — an operator reads it directly (5 = production-ready
  // … 0–1 = critical). Context, not a finding; it never enters the categorized set.
  for (const c of botIssueComments) {
    if (detectBot(c.author) !== 'greptile') continue;
    const score = parseGreptileConfidence(c.body);
    if (score !== undefined) {
      log.info(
        TAG,
        `greptile Confidence Score: ${score}/5${score < 5 ? ' (below 5 — unaddressed findings likely)' : ''}`,
      );
    }
  }

  // 4. Group inline comments into threads
  const threads = groupIntoThreads(reviewComments);

  // 5. Filter to threads starting with bot comments
  const botThreads = threads.filter(
    (t) => t.comments.length > 0 && isBotComment(t.comments[0]!.author),
  );

  // 5b. Empty-state guard (mmnto-ai/totem#2192): NEVER print a bare "Nothing to
  // triage" when bot material was actually fetched. `triage-pr` runs live
  // mid-review, when a bot's standing summary is in its findings-rich state;
  // returning silently would reproduce the exact #2190 miss this command exists
  // to catch. Bot issue-comments count as material even if the (provisional)
  // summary parser extracted no discrete findings from them.
  const emptyState = evaluateTriageEmptyState({
    botThreads: botThreads.length,
    bodyFindings: bodyFindings.length,
    botIssueComments: botIssueComments.length,
    inlineComments: reviewComments.length,
    reviews: pr.reviews.length,
    issueComments: issueComments.length,
  });
  if (emptyState.empty) {
    if (emptyState.surfaced) log.info(TAG, emptyState.message!);
    else log.dim(TAG, emptyState.message!);
    return;
  }
  if (botThreads.length > 0) {
    log.info(TAG, `Found ${botThreads.length} bot review thread(s)`);
  }
  // (No "parser gap" warning: the marker-anchored parser always surfaces whatever
  // sits under the marker — falling back to the whole block — so a content-present
  // /findings-empty "gap" is logically impossible (gemini High + greptile P1 on
  // #2246). Anti-glance is carried by the empty-state guard, which counts a bot
  // summary as material, plus the greptile Confidence line above.)

  // 6. Normalize into findings
  const findings = normalizeBotFindings(
    botThreads,
    isBotComment,
    detectBot,
    parseSeverityForTool,
    stripHtmlWrappers,
    extractSuggestion,
  );

  // Append review-body + issue-comment summary findings
  findings.push(...bodyFindings);

  log.info(TAG, `Normalized ${findings.length} bot finding(s)`);

  // 7. Deduplicate and categorize
  const categorized = deduplicateFindings(findings);
  log.info(TAG, `${categorized.length} distinct finding(s) after dedup`);

  // 8. Render output to stdout
  // Count bot comments (not all review comments) + the review-body and
  // issue-comment summary surfaces SEPARATELY. The issue-comment surface counts
  // when a bot summary was PRESENT (botIssueComments), not only when it parsed
  // findings — otherwise a summary-present-but-0-findings PR renders "0 comments"
  // right after the empty-state guard (which counts the same surface as material)
  // intentionally kept it in triage (CR Outside-diff on #2246).
  const bodySummarySurfaces =
    (reviewBodyFindings.length > 0 ? 1 : 0) + (botIssueComments.length > 0 ? 1 : 0);
  const botCommentCount =
    reviewComments.filter((c) => isBotComment(c.author)).length + bodySummarySurfaces;
  const output = formatTriageOutput(num, categorized, botCommentCount, {
    red: pc.default.red,
    yellow: pc.default.yellow,
    blue: pc.default.blue,
    gray: pc.default.gray,
    bold: pc.default.bold,
  });

  console.log(output); // totem-ignore — stdout for piping to skill prompt

  // ─── Interactive mode ─────────────────────────────────
  if (!options.interactive) return;

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new TotemConfigError(
      'Interactive triage requires a TTY.',
      'Run in an interactive terminal, or omit --interactive for non-interactive output.',
      'CONFIG_INVALID',
    );
  }

  const {
    intro,
    outro,
    select,
    multiselect,
    text,
    confirm,
    isCancel,
    cancel,
    log: clackLog,
  } = await import('@clack/prompts');

  intro(`PR #${num} Interactive Triage (${categorized.length} findings)`);

  // Build selection options from categorized findings
  const optionsList = categorized.map((f, i) => {
    const location = f.line != null ? `${f.file}:${f.line}` : f.file;
    const summary =
      f.body
        .split('\n')
        .find((l: string) => l.trim())
        ?.slice(0, 60) ?? f.body.slice(0, 60);
    return {
      value: i,
      label: `[${toolAbbrev(f.tool)}/${f.severity}] ${location}`,
      hint: summary.replace(/\n/g, ' '),
    };
  });

  if (optionsList.length === 0) {
    outro('No findings to triage.');
    return;
  }

  const selected = await multiselect({
    message: 'Select findings to act on:',
    options: optionsList,
    required: false,
  });

  if (isCancel(selected)) {
    cancel('Triage cancelled.');
    return;
  }

  const selectedIndices = selected as number[];
  if (selectedIndices.length === 0) {
    outro('No findings selected.');
    return;
  }

  // Lazy-loaded fix runtime (only initialized when first "fix" action is selected)
  let fixRuntime: {
    dispatchFix: (typeof import('../services/fix-dispatcher.js'))['dispatchFix'];
    runOrch: (typeof import('../utils.js'))['runOrchestrator'];
    config: Awaited<ReturnType<(typeof import('../utils.js'))['loadConfig']>>;
  } | null = null;

  async function getFixRuntime() {
    if (!fixRuntime) {
      const { loadConfig, resolveConfigPath, loadEnv, runOrchestrator } =
        await import('../utils.js');
      const { dispatchFix } = await import('../services/fix-dispatcher.js');
      const cfgPath = resolveConfigPath(cwd);
      loadEnv(cwd);
      const config = await loadConfig(cfgPath);
      fixRuntime = { dispatchFix, runOrch: runOrchestrator, config };
    }
    return fixRuntime;
  }

  // Process each selected finding
  let fixedBotFindings = false;

  for (const idx of selectedIndices) {
    const finding = categorized[idx]!;
    const location = finding.line != null ? `${finding.file}:${finding.line}` : finding.file;
    const summary =
      finding.body
        .split('\n')
        .find((l: string) => l.trim())
        ?.slice(0, 80) ?? '';

    clackLog.info(`${location}: ${summary.replace(/\n/g, ' ')}`);

    const action = await select({
      message: `Action for ${location}:`,
      options: [
        { value: 'fix' as const, label: 'Fix — generate and apply code fix' },
        { value: 'defer' as const, label: 'Defer — create issue and reply with link' },
        { value: 'dismiss' as const, label: 'Dismiss — reply with pushback reason' },
        { value: 'learn' as const, label: 'Learn — extract lesson from this finding' },
        { value: 'skip' as const, label: 'Skip — do nothing' },
      ],
    });

    if (isCancel(action)) {
      cancel('Triage cancelled.');
      return;
    }

    if (action === 'skip') continue;

    // Use the propagated rootCommentId for direct thread reference,
    // falling back to heuristic file+line lookup for review-body findings
    const commentId =
      finding.rootCommentId ??
      botThreads.find((t) => {
        if (t.path !== finding.file) return false;
        if (finding.line == null) return true;
        const hunk = t.diffHunk.match(/@@ .+?\+(\d+)/);
        return hunk ? parseInt(hunk[1]!, 10) === finding.line : true;
      })?.comments[0]?.id;
    const thread =
      commentId != null ? botThreads.find((t) => t.comments[0]?.id === commentId) : undefined;

    if (action === 'fix') {
      const ok = await confirm({ message: `Generate and apply fix for ${location}?` });
      if (isCancel(ok)) {
        cancel('Triage cancelled.');
        return;
      }
      if (ok) {
        try {
          const rt = await getFixRuntime();
          const result = await rt.dispatchFix({
            filePath: finding.file,
            line: finding.line ?? undefined,
            findingBody: finding.body,
            findingTool: finding.tool,
            cwd,
            runOrchestrator: (prompt) =>
              rt.runOrch({
                prompt,
                tag: TAG,
                options: {},
                config: rt.config,
                cwd,
                temperature: 0,
              }),
            onLog: (msg) => log.dim(TAG, msg),
          });

          if (result.applied && result.commitSha) {
            log.success(TAG, `Fix applied: ${result.commitSha}`);
            fixedBotFindings = true;
            if (commentId) {
              try {
                adapter.replyToComment(num, commentId, `Fixed in ${result.commitSha}`);
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                log.dim(TAG, `Reply failed (fix still applied): ${msg}`);
              }
            }
          } else {
            log.warn(TAG, `Fix not applied: ${result.reason ?? 'unknown'}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn(TAG, `Fix dispatch failed: ${msg}`);
        }
      }
    }

    if (action === 'defer') {
      if (thread) {
        const ok = await confirm({ message: `Create deferred issue for ${location}?` });
        if (isCancel(ok)) {
          cancel('Triage cancelled.');
          return;
        }
        if (ok) {
          try {
            const { createDeferredIssue } = await import('../services/deferred-issuer.js');
            const result = createDeferredIssue(adapter, num, thread, undefined, (msg) =>
              log.dim(TAG, msg),
            );
            if (result.skipped) {
              log.dim(TAG, 'Already deferred — skipped.');
            } else {
              log.success(TAG, `Created issue: ${result.issueUrl}`);
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.warn(TAG, `Failed to create deferred issue: ${msg}`);
          }
        }
      } else {
        log.dim(TAG, 'No thread found for this finding.');
      }
    }

    if (action === 'learn') {
      const ok = await confirm({ message: `Save lesson from this finding?` });
      if (isCancel(ok)) {
        cancel('Triage cancelled.');
        return;
      }
      if (ok) {
        try {
          const { writeLessonFile } = await import('@mmnto/totem');
          const { loadConfig: loadCfg2, resolveConfigPath: resolveCfg2 } =
            await import('../utils.js');
          const cfg = await loadCfg2(resolveCfg2(cwd));
          const pathMod = await import('node:path');
          const lessonsDir = pathMod.join(cwd, cfg.totemDir, 'lessons');

          // Lesson tag wants a readable tool id (unknown → 'unknown', not the
          // display helper's '??'), so it keeps its own mapping.
          const toolTag =
            finding.tool === 'coderabbit'
              ? 'CR'
              : finding.tool === 'gca'
                ? 'GCA'
                : finding.tool === 'greptile'
                  ? 'GT'
                  : finding.tool;
          const tags = [finding.triageCategory, toolTag.toLowerCase(), 'bot-review'];
          const lessonEntry = `## Lesson — ${
            finding.body
              .split('\n')
              .find((l: string) => l.trim())
              ?.slice(0, 80) ?? 'Bot review finding'
          }\n\n**Tags:** ${tags.join(', ')}\n\n${finding.body.slice(0, 500)}`;

          const filePath = writeLessonFile(lessonsDir, lessonEntry);
          log.success(TAG, `Lesson saved: ${filePath}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.warn(TAG, `Failed to save lesson: ${msg}`);
        }
      }
    }

    if (action === 'dismiss') {
      const reason = await text({
        message: 'Pushback reason:',
        placeholder: 'e.g., "Intentional — this is by design"',
        validate: (val) => {
          if (!val?.trim()) return 'Reason is required.';
          return undefined;
        },
      });

      if (isCancel(reason)) {
        cancel('Triage cancelled.');
        return;
      }

      if (commentId) {
        const ok = await confirm({ message: `Reply "${reason}" on ${location}?` });
        if (isCancel(ok)) {
          cancel('Triage cancelled.');
          return;
        }
        if (ok) {
          try {
            adapter.replyToComment(num, commentId, reason as string);
            log.success(TAG, `Replied on ${location}`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            log.warn(TAG, `Failed to reply: ${msg}`);
          }
        }
      } else {
        log.dim(TAG, 'No comment ID available for reply.');
      }
    }
  }

  // Bot re-trigger: if any bot findings were fixed, post /gemini-review
  if (fixedBotFindings) {
    try {
      const doRetrigger = await confirm({
        message: 'Bot findings were fixed. Trigger Gemini re-review?',
      });
      if (!isCancel(doRetrigger) && doRetrigger) {
        adapter.addPrComment(num, '/gemini-review');
        log.success(TAG, 'Posted /gemini-review to re-trigger bot review');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn(TAG, `Failed to trigger re-review: ${msg}`);
    }
  }

  // Offer to run review-learn for full batch lesson extraction
  try {
    const doLearn = await confirm({
      message: 'Run review-learn to extract lessons from all resolved findings?',
    });
    if (!isCancel(doLearn) && doLearn) {
      const { reviewLearnCommand } = await import('./review-learn.js');
      await reviewLearnCommand(String(num), { yes: false });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn(TAG, `review-learn failed: ${msg}`);
  }

  outro('Triage complete.');
}
