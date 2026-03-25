/**
 * Bot review comment parsing and resolution filtering.
 *
 * Normalizes CodeRabbit and GCA inline review comments into
 * structured findings, then filters to only resolved (accepted) threads
 * so that `review-learn` extracts lessons only from findings the
 * developer actually fixed.
 */

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
}

export interface CommentThread {
  path: string;
  diffHunk: string;
  comments: Array<{ author: string; body: string }>;
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

  // If human pushed back, NOT resolved
  const pushbackPatterns = [
    /\bnot\s+(?:applicable|relevant|needed|correct)\b/i,
    /\bintentional\b/i,
    /\bby\s+design\b/i,
    /\bwon'?t\s+fix\b/i,
    /\bignor/i,
    /\bdismiss/i,
    /\bnit\b/i,
  ];

  for (const reply of humanReplies) {
    if (pushbackPatterns.some((p) => p.test(reply.body))) return false;
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

    findings.push({
      tool,
      severity,
      file: thread.path,
      body,
      suggestion,
      resolutionSignal: 'reply',
    });
  }

  return findings;
}
