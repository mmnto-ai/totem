/**
 * Bot review comment parsing and resolution filtering.
 *
 * Normalizes CodeRabbit and GCA inline review comments into
 * structured findings, then filters to only resolved (accepted) threads
 * so that `review-learn` extracts lessons only from findings the
 * developer actually fixed.
 */

import { parseCodeRabbitReviewFindings } from '../parse-nits.js';

// ─── Types ──────────────────────────────────────────

export interface NormalizedBotFinding {
  tool: 'coderabbit' | 'gca' | 'unknown';
  severity: string;
  file: string;
  line?: number;
  body: string;
  /** The raw suggestion text if present */
  suggestion?: string;
  /** How we determined this was resolved */
  resolutionSignal?: 'reply' | 'resolved_thread' | 'none';
  /** The root comment ID of the thread this finding originated from */
  rootCommentId?: number;
}

export interface CommentThread {
  path: string;
  diffHunk: string;
  comments: Array<{ id?: number; author: string; body: string }>;
}

// ─── Bot Detection ──────────────────────────────────

export function isBotComment(author: string): boolean {
  const lower = author.toLowerCase();
  return lower.includes('coderabbit') || lower.includes('gemini-code-assist');
}

export function detectBot(author: string): 'coderabbit' | 'gca' | 'unknown' {
  const lower = author.toLowerCase();
  if (lower.includes('coderabbit')) return 'coderabbit';
  if (lower.includes('gemini-code-assist')) return 'gca';
  return 'unknown';
}

// ─── CodeRabbit Parser ──────────────────────────────

/** Extract severity from CR comment body (red circle Critical, orange circle Major, yellow circle Minor) */
export function parseCRSeverity(body: string): string {
  if (body.includes('\u{1F534}') || body.toLowerCase().includes('critical')) return 'critical';
  if (body.includes('\u{1F7E0}') || body.toLowerCase().includes('major')) return 'major';
  if (body.includes('\u{1F7E1}') || body.toLowerCase().includes('minor')) return 'minor';
  return 'info';
}

/** Strip HTML wrapper tags but keep content. Unwraps <details>, <summary>, <blockquote>. */
export function stripHtmlWrappers(html: string): string {
  return html
    .replace(/<\/?details>/gi, '')
    .replace(/<summary>[\s\S]*?<\/summary>/gi, '')
    .replace(/<\/?blockquote>/gi, '')
    .replace(/<!-- .*? -->/gs, '') // strip HTML comments (fingerprints, etc.)
    .replace(/<\/?code>/gi, '')
    .trim();
}

/** Extract suggestion blocks from CR/GCA comments */
export function extractSuggestion(body: string): string | undefined {
  const match = body.match(/```suggestion\n([\s\S]*?)```/);
  return match ? match[1]?.trim() : undefined;
}

// ─── GCA Parser ─────────────────────────────────────

/** Extract severity from GCA comment body (SVG priority images) */
export function parseGCASeverity(body: string): string {
  if (body.includes('high-priority.svg') || body.includes('security-high-priority.svg'))
    return 'high';
  if (body.includes('medium-priority.svg')) return 'medium';
  if (body.includes('low-priority.svg')) return 'low';
  return 'info';
}

// ─── Resolution Filter ──────────────────────────────

/** Patterns indicating human pushback (false positive signal). */
export const PUSHBACK_PATTERNS = [
  /\bnot\s+(?:applicable|relevant|needed|correct)\b/i,
  /\bintentional\b/i,
  /\bby\s+design\b/i,
  /\bwon'?t\s+fix\b/i,
  /\bignor(?:e|ed|ing)\s+(?:this|it|the)\b/i,
  /\bdismiss(?:ed|ing)?\b/i,
  /\bjust\s+a\s+nit\b/i,
];

/**
 * Check if a bot comment thread was "fixed" (resolved positively).
 * Conservative heuristic: requires explicit agreement, not just thread resolution.
 */
export function isThreadResolved(thread: CommentThread): boolean {
  const botComment = thread.comments[0];
  if (!botComment) return false;

  // Must be a bot comment
  if (!isBotComment(botComment.author)) return false;

  // Check reply comments from humans
  const humanReplies = thread.comments.slice(1).filter((c) => !isBotComment(c.author));

  // No human replies — be conservative, skip
  if (humanReplies.length === 0) return false;

  for (const reply of humanReplies) {
    if (PUSHBACK_PATTERNS.some((p) => p.test(reply.body))) return false;
  }

  // Positive signals: "fixed", "done", commit SHA reference, ticket reference
  const fixedPatterns = [
    /\bfixed\b/i,
    /\bdone\b/i,
    /\baddressed\b/i,
    /\bapplied\b/i,
    /\b[0-9a-f]{7,40}\b/, // commit SHA
    /\btracked\s+in\s+#\d+/i, // ticket reference
  ];

  for (const reply of humanReplies) {
    if (fixedPatterns.some((p) => p.test(reply.body))) return true;
  }

  // No explicit signal — be conservative, skip
  return false;
}

/**
 * Normalize bot review comments into structured findings.
 * Only returns findings from threads that were resolved positively.
 */
/**
 * Extract findings from CodeRabbit review bodies (outside-diff + nits).
 * Shared by triage-pr and review-learn to avoid duplication.
 */
export function extractReviewBodyFindings(
  reviews: Array<{ author: string; body: string }>,
): NormalizedBotFinding[] {
  const findings: NormalizedBotFinding[] = [];
  for (const review of reviews) {
    if (!review.author || !isBotComment(review.author)) continue;

    const tool = detectBot(review.author);
    let parsed: Array<{ type: 'nitpick' | 'outside-diff'; content: string }> = [];

    // Only CodeRabbit parser is implemented for now
    if (tool === 'coderabbit') {
      parsed = parseCodeRabbitReviewFindings(review.body);
    }

    for (const finding of parsed) {
      findings.push({
        tool,
        severity: finding.type === 'outside-diff' ? 'warning' : 'info',
        file: '(review body)',
        line: undefined,
        body: finding.content,
        suggestion: undefined,
        resolutionSignal: 'none',
      });
    }
  }
  return findings;
}

/**
 * Extract findings from threads where the human explicitly pushed back (false positive signals).
 * Inverse of extractResolvedBotFindings — captures "intentional", "by design", "won't fix" threads.
 */
export function extractPushbackFindings(threads: CommentThread[]): NormalizedBotFinding[] {
  const findings: NormalizedBotFinding[] = [];

  for (const thread of threads) {
    const botComment = thread.comments[0];
    if (!botComment || !isBotComment(botComment.author)) continue;

    const humanReplies = thread.comments.slice(1).filter((c) => !isBotComment(c.author));
    if (humanReplies.length === 0) continue;

    const hasPushback = humanReplies.some((reply) =>
      PUSHBACK_PATTERNS.some((p) => p.test(reply.body)),
    );
    if (!hasPushback) continue;

    const tool = detectBot(botComment.author);
    const severity =
      tool === 'coderabbit'
        ? parseCRSeverity(botComment.body)
        : tool === 'gca'
          ? parseGCASeverity(botComment.body)
          : 'info';

    const body = stripHtmlWrappers(botComment.body);
    const hunkMatch = thread.diffHunk.match(/@@ .+?\+(\d+)/);
    const line = hunkMatch ? parseInt(hunkMatch[1]!, 10) : undefined;

    findings.push({
      tool,
      severity,
      file: thread.path,
      line,
      body,
      suggestion: extractSuggestion(botComment.body),
      resolutionSignal: 'none',
      rootCommentId: botComment.id,
    });
  }

  return findings;
}

export function extractResolvedBotFindings(threads: CommentThread[]): NormalizedBotFinding[] {
  const findings: NormalizedBotFinding[] = [];

  for (const thread of threads) {
    if (!isThreadResolved(thread)) continue;

    const botComment = thread.comments[0]!;
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

    findings.push({
      tool,
      severity,
      file: thread.path,
      line,
      body,
      suggestion,
      resolutionSignal: 'reply',
      rootCommentId: botComment.id,
    });
  }

  return findings;
}
