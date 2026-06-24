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

/**
 * The review bots whose comment formats triage-pr knows how to parse, plus
 * `unknown` for an unrecognized author. Adding a bot is a single-place change
 * here + its severity parser in {@link parseSeverityForTool}.
 *
 * NOTE: `gca` is triage's local id for `gemini-code-assist` — it intentionally
 * diverges from the core actor-id scheme in `@mmnto/totem`'s `resolveActorId`
 * (which uses `gemini-code-assist` and EXACT-login matching for hit-rate
 * attribution). Triage's goal is broad recognition (surface every finding) with
 * a compact display id; it matches coderabbit/gca by substring and greptile by
 * its bot-login shape (see `GREPTILE_BOT_LOGIN`). The two schemes serve
 * different purposes and are deliberately not coupled.
 */
export type BotTool = 'coderabbit' | 'gca' | 'greptile' | 'unknown';

export interface NormalizedBotFinding {
  tool: BotTool;
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
  /**
   * Round disposition per the canonical decline taxonomy
   * (doctrine bot-protocols.md §8.1; mmnto-ai/totem#2124). `declined` findings are
   * kept out of lesson extraction so a refuted claim is never laundered into a rule.
   * `undefined` means no disposition signal was available (treated as not-declined).
   */
  disposition?: 'accepted' | 'declined';
  /** For `declined` findings: the human reply that signalled the decline (audit-breadcrumb / mmnto-ai/totem#2038 backfill reference). */
  dispositionRationale?: string;
}

export interface CommentThread {
  path: string;
  diffHunk: string;
  comments: Array<{ id?: number; author: string; body: string }>;
}

// ─── Bot Detection ──────────────────────────────────

// greptile is matched by its bot-login SHAPE — `greptile[bot]`,
// `greptile-apps[bot]`, `greptile-enterprise[bot]` — rather than a bare
// `greptile` substring, so a human account like `alice-greptile` is NOT
// misclassified as a bot (which would hide real human replies in
// `isThreadResolved` and ingest human comments as bot findings — CR Major on
// mmnto-ai/totem#2244), while future bot variants are still surfaced. The
// reviewer's suggested regex carried a trailing `\b` that fails right after the
// closing `]` (non-word char at end-of-string), so it is dropped here.
// coderabbit / gca keep their established bare-substring match (canonical
// exact-login map lives in `@mmnto/totem`'s `review-catch.ts`).
const GREPTILE_BOT_LOGIN = /\bgreptile(?:-[^[]+)?\[bot\]/i;

export function isBotComment(author: string): boolean {
  const lower = author.toLowerCase();
  return (
    lower.includes('coderabbit') ||
    lower.includes('gemini-code-assist') ||
    GREPTILE_BOT_LOGIN.test(author)
  );
}

export function detectBot(author: string): BotTool {
  const lower = author.toLowerCase();
  if (lower.includes('coderabbit')) return 'coderabbit';
  if (lower.includes('gemini-code-assist')) return 'gca';
  if (GREPTILE_BOT_LOGIN.test(author)) return 'greptile';
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

// ─── Greptile Parser ────────────────────────────────

/**
 * Extract severity from a greptile inline comment body via its P1/P2/P3
 * priority label (greptile's severity vocabulary), mapped onto the shared
 * high/medium/low scale that {@link mapToTriageCategory} consumes.
 *
 * Best-effort: greptile's inline format is less structured than CR's emoji or
 * GCA's SVG marker, so when no explicit priority token is present this returns
 * `info` and the body-keyword categorizer does the real bucketing. Word-bounded
 * so `P1`/`p1` matches but a mid-token `GP1X` does not. P0 is greptile's
 * critical/blocking level (greptile review on mmnto-ai/totem#2244) — without it,
 * a `P0` finding would silently fall through to `info`, the opposite of safe.
 */
export function parseGreptileSeverity(body: string): string {
  if (/\bP0\b/i.test(body)) return 'critical';
  if (/\bP1\b/i.test(body)) return 'high';
  if (/\bP2\b/i.test(body)) return 'medium';
  if (/\bP3\b/i.test(body)) return 'low';
  return 'info';
}

/**
 * Single source of truth for "which severity parser applies to which bot".
 * Keeps the per-tool dispatch in one place so adding a bot does not require
 * touching every finding-normalizer (triage-pr, extractResolved, extractPushback).
 */
export function parseSeverityForTool(tool: BotTool, body: string): string {
  switch (tool) {
    case 'coderabbit':
      return parseCRSeverity(body);
    case 'gca':
      return parseGCASeverity(body);
    case 'greptile':
      return parseGreptileSeverity(body);
    default:
      return 'info';
  }
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
  // Canonical decline taxonomy (doctrine bot-protocols.md §8.1 / mmnto-ai/totem-strategy#590):
  // the inline free-text surface MUST recognize `decline`/`declined` + the `decline-*` classes,
  // so a soft-decline ("addressed — declined, by design") is never misread as resolved and
  // laundered into extraction (mmnto-ai/totem#2124). `[ds]?` also catches the `declines` inflection.
  // Because `-` is a non-word character, `\b` fires before the hyphen in `decline-*` class tokens
  // (decline-stylistic / -substantive / -hallucination), so this single pattern covers them too.
  // (Deliberately object-free: requiring an object would miss bare `Declined` and the `decline-*`
  // tokens, re-opening the mmnto-ai/totem#2124 laundering vector; over-matching cuts the safe way —
  // a lost lesson, never a laundered one. Finer precision is the mmnto-ai/totem-strategy#474
  // disposition-ledger's job, not this heuristic.)
  /\bdecline[ds]?\b/i,
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
        // No thread reply exists for review-body findings, so no acceptance signal is
        // available — leave `disposition` undefined (the JSDoc contract treats that as
        // "not-declined"), rather than overstating it as `accepted`.
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

    const pushbackReply = humanReplies.find((reply) =>
      PUSHBACK_PATTERNS.some((p) => p.test(reply.body)),
    );
    if (!pushbackReply) continue;

    const tool = detectBot(botComment.author);
    const severity = parseSeverityForTool(tool, botComment.body);

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
      disposition: 'declined',
      dispositionRationale: pushbackReply.body,
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
    const severity = parseSeverityForTool(tool, botComment.body);

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
      disposition: 'accepted',
    });
  }

  return findings;
}
