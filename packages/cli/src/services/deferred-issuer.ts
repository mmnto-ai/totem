import type { PrAdapter } from '../adapters/pr-adapter.js';
import type { CommentThread } from '../parsers/bot-review-parser.js';
import { inferNextMilestone } from '../utils/milestone-inference.js';

const DEFERRED_MARKER = /Deferred to (?:issue )?#(\d+)/i;

export interface DeferredIssueResult {
  issueUrl: string;
  issueNumber: string;
  skipped: boolean;
}

/**
 * Check if a thread already has a deferred issue link.
 */
export function isAlreadyDeferred(thread: CommentThread): boolean {
  return thread.comments.some((c) => DEFERRED_MARKER.test(c.body));
}

/**
 * Create a GitHub issue for a deferred bot review finding and reply on the thread.
 * Returns the issue URL, or skips if already deferred (idempotent).
 */
export function createDeferredIssue(
  adapter: PrAdapter,
  prNumber: number,
  thread: CommentThread,
  currentMilestone: string | undefined,
  onLog?: (msg: string) => void,
): DeferredIssueResult {
  // Idempotency check
  if (isAlreadyDeferred(thread)) {
    onLog?.(`Thread on ${thread.path} already deferred — skipping`);
    return { issueUrl: '', issueNumber: '', skipped: true };
  }

  const botComment = thread.comments[0];
  if (!botComment) {
    return { issueUrl: '', issueNumber: '', skipped: true };
  }

  // Build issue content
  const summary = botComment.body.slice(0, 120).replace(/\n/g, ' ').trim();
  const title = `Deferred: ${summary}`;

  const hunkMatch = thread.diffHunk.match(/@@ .+?\+(\d+)/);
  const lineRef = hunkMatch ? `:${hunkMatch[1]}` : '';

  const body = [
    `## Deferred Bot Review Finding`,
    '',
    `**File:** \`${thread.path}${lineRef}\``,
    `**PR:** #${prNumber}`,
    `**Bot:** ${botComment.author}`,
    '',
    '### Finding',
    '',
    botComment.body,
  ].join('\n');

  const nextMilestone = inferNextMilestone(currentMilestone);

  // Create the issue
  const issueUrl = adapter.createIssue({
    title,
    body,
    labels: ['tech-debt', 'deferred'],
    milestone: nextMilestone,
  });

  // Extract issue number from URL (e.g., "https://github.com/owner/repo/issues/123")
  const issueNumMatch = issueUrl.match(/\/issues\/(\d+)/);
  const issueNumber = issueNumMatch ? issueNumMatch[1]! : '';

  // Reply on the thread with the issue link
  const rootCommentId = thread.comments[0]!.id;
  if (rootCommentId !== undefined && issueNumber) {
    try {
      adapter.replyToComment(prNumber, rootCommentId, `Deferred to #${issueNumber}`);
    } catch (err) {
      // Non-fatal — issue was created, reply is best-effort
      const msg = err instanceof Error ? err.message : String(err);
      onLog?.(`Failed to reply on thread (issue created): ${msg}`);
    }
  }

  return { issueUrl, issueNumber, skipped: false };
}
