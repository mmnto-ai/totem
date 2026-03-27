/**
 * `totem triage-pr <pr-number>` — Categorized triage view of bot review
 * comments on a pull request.
 *
 * Fetches inline review comments, filters to bot authors, normalizes
 * into structured findings, deduplicates, categorizes by blast radius,
 * and renders a compact inbox to stdout.
 */

import type { StandardReviewComment } from '../adapters/pr-adapter.js';
import type { NormalizedBotFinding } from '../parsers/bot-review-parser.js';
import type { CategorizedFinding, TriageCategory } from '../parsers/triage-types.js';

// ─── Constants ───────────────────────────────────────

const TAG = 'TriagePR';

// ─── Thread grouping (mirrors review-learn.ts) ──────

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

// ─── Bot finding normalization ───────────────────────

/**
 * Normalize all bot comment threads into structured findings.
 * Unlike extractResolvedBotFindings, this includes ALL bot findings
 * (not just resolved ones) — triage wants the full picture.
 */
function normalizeBotFindings(
  threads: CommentThread[],
  isBotComment: (author: string) => boolean,
  detectBot: (author: string) => 'coderabbit' | 'gca' | 'unknown',
  parseCRSeverity: (body: string) => string,
  parseGCASeverity: (body: string) => string,
  stripHtmlWrappers: (html: string) => string,
  extractSuggestion: (body: string) => string | undefined,
): NormalizedBotFinding[] {
  const findings: NormalizedBotFinding[] = [];

  for (const thread of threads) {
    const botComment = thread.comments[0];
    if (!botComment || !isBotComment(botComment.author)) continue;

    const tool = detectBot(botComment.author);
    const severity =
      tool === 'coderabbit'
        ? parseCRSeverity(botComment.body)
        : tool === 'gca'
          ? parseGCASeverity(botComment.body)
          : 'info';

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

/** Format bot attribution string like [CR/minor, GCA/medium] */
function formatBotAttribution(finding: CategorizedFinding): string {
  const entries: string[] = [];

  // Primary finding
  const toolAbbrev = finding.tool === 'coderabbit' ? 'CR' : finding.tool === 'gca' ? 'GCA' : '??';
  entries.push(`${toolAbbrev}/${finding.severity}`);

  // Merged findings
  if (finding.mergedWith) {
    for (const m of finding.mergedWith) {
      const mAbbrev = m.tool === 'coderabbit' ? 'CR' : m.tool === 'gca' ? 'GCA' : '??';
      entries.push(`${mAbbrev}/${m.severity}`);
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

export async function triagePrCommand(prNumber: string): Promise<void> {
  const pc = await import('picocolors');
  const { TotemConfigError } = await import('@mmnto/totem');
  const { GitHubCliPrAdapter } = await import('../adapters/github-cli-pr.js');
  const { log } = await import('../ui.js');
  const {
    isBotComment,
    detectBot,
    parseCRSeverity,
    parseGCASeverity,
    stripHtmlWrappers,
    extractSuggestion,
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

  // 3b. Extract findings from CodeRabbit review bodies (outside-diff + nits)
  const { extractReviewBodyFindings } = await import('../parsers/bot-review-parser.js');
  const reviewBodyFindings = extractReviewBodyFindings(pr.reviews);
  if (reviewBodyFindings.length > 0) {
    log.info(TAG, `Found ${reviewBodyFindings.length} finding(s) in review bodies`);
  }

  if (reviewComments.length === 0 && reviewBodyFindings.length === 0) {
    log.dim(TAG, 'No review comments found. Nothing to triage.');
    return;
  }

  // 4. Group into threads
  const threads = groupIntoThreads(reviewComments);

  // 5. Filter to threads starting with bot comments
  const botThreads = threads.filter(
    (t) => t.comments.length > 0 && isBotComment(t.comments[0]!.author),
  );

  if (botThreads.length === 0 && reviewBodyFindings.length === 0) {
    log.dim(TAG, 'No bot review comments found. Nothing to triage.');
    return;
  }
  if (botThreads.length > 0) {
    log.info(TAG, `Found ${botThreads.length} bot review thread(s)`);
  }

  // 6. Normalize into findings
  const findings = normalizeBotFindings(
    botThreads,
    isBotComment,
    detectBot,
    parseCRSeverity,
    parseGCASeverity,
    stripHtmlWrappers,
    extractSuggestion,
  );

  // Append review body findings
  findings.push(...reviewBodyFindings);

  log.info(TAG, `Normalized ${findings.length} bot finding(s)`);

  // 7. Deduplicate and categorize
  const categorized = deduplicateFindings(findings);
  log.info(TAG, `${categorized.length} distinct finding(s) after dedup`);

  // 8. Render output to stdout
  // Count bot comments (not all review comments) + review bodies with findings
  const reviewBodiesWithFindings = reviewBodyFindings.length > 0 ? 1 : 0;
  const botCommentCount =
    reviewComments.filter((c) => isBotComment(c.author)).length + reviewBodiesWithFindings;
  const output = formatTriageOutput(num, categorized, botCommentCount, {
    red: pc.default.red,
    yellow: pc.default.yellow,
    blue: pc.default.blue,
    gray: pc.default.gray,
    bold: pc.default.bold,
  });

  console.log(output); // totem-ignore — stdout for piping to skill prompt
}
